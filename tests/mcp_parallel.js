// mcp_parallel.js — several machines at once through ONE MCP server, as an editor runs it: Cursor and Claude share one
// server between all their chats. A visit per machine, side by side; a call names its machine with `host` (refused,
// never guessed, once several have been open -- the visit left over is never handed the calls of an agent whose own
// visit ended); a second agent's connect never ends the first one's visit; calls for two machines do not wait on each
// other, while one machine's calls still run one after another.
// It runs the real mcp/server.js against a stand-in client (SM_MCP_CLIENT) that speaks the serve's files -- ready.json,
// cmd.json, done.json -- so it needs no relay and no machine. No dependencies.
//   node tests/mcp_parallel.js
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const SERVER = path.join(__dirname, '..', 'mcp', 'server.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// THE STAND-IN for core/agent-join.js --serve: says its Allow code, writes ready.json, then answers each cmd.json in
// done.json -- `served` is the machine it serves, and `leaked` would be a `host` the MCP server should have kept.
const FAKE = `'use strict';
const fs = require('fs'), path = require('path');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : ''; };
const host = arg('host'), dir = arg('serve');
process.stderr.write('[>] code FAKE-' + host + ' -- somebody who can see machine ' + host + ' has been asked.\\n');
setTimeout(() => {
  fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ w: 800, h: 600, host, at: Date.now() }));
  const cmdFile = path.join(dir, 'cmd.json'), outFile = path.join(dir, 'done.json');
  let busy = false, n = 0;
  setInterval(() => {
    if (busy || !fs.existsSync(cmdFile)) return;
    let cmd;
    try { cmd = JSON.parse(fs.readFileSync(cmdFile, 'utf8')); } catch (_) { return; }
    try { fs.unlinkSync(cmdFile); } catch (_) { return; }
    busy = true; n++;
    const t0 = Date.now(), ms = cmd.do === 'pause' ? Math.min(Number(cmd.ms) || 0, 5000) : 0;
    setTimeout(() => {
      const a = { ok: true, did: cmd.do, served: host, n, t0, t1: Date.now() };
      if (cmd.host !== undefined) a.leaked = cmd.host;
      fs.writeFileSync(outFile, JSON.stringify(a));
      busy = false;
      if (cmd.do === 'quit' || cmd.do === 'done') setTimeout(() => process.exit(0), 50);
    }, ms);
  }, 20);
}, 150);
`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-par-'));
  const fake = path.join(tmp, 'fake-serve.js');
  fs.writeFileSync(fake, FAKE);
  const srv = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'ignore'],
    env: Object.assign({}, process.env, { SM_MCP_CLIENT: fake, SM_MCP_WORK: path.join(tmp, 'work'), SM_MCP_MAX_VISITS: '2', SM_MCP_CONNECT_MS: '15000' }) });
  let buf = '', nextId = 1;
  const waiting = new Map();
  srv.stdout.setEncoding('utf8');
  srv.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch (_) { continue; }
      if (m.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { waiting.delete(id); reject(new Error(method + ' got no answer in 30 s')); }, 30000);
    waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  // a tool call: its first block's JSON, with isError
  const call = async (name, args) => {
    const m = await rpc('tools/call', { name, arguments: args || {} });
    const r = m.result || {}, b = (r.content || [])[0];
    let o = {}; try { o = JSON.parse(b.text); } catch (_) { o = { raw: b && b.text }; }
    return Object.assign(o, { isError: !!r.isError });
  };
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcp-parallel-test', version: '1' } });
    const tools = (await rpc('tools/list', {})).result.tools;
    const look = tools.find((t) => t.name === 'look'), disc = tools.find((t) => t.name === 'disconnect');
    ok(!!look && !!look.inputSchema.properties.host && !!disc && !!disc.inputSchema.properties.host,
       'every tool takes host -- look and disconnect among them');

    // ONE machine: a call that names none goes to it, as before
    let r = await call('connect', { host: '11111', task: 'the first job' });
    ok(r.ok === true && r.host === '11111' && !r.open, 'the first visit opens (' + JSON.stringify([r.ok, r.why]) + ')');
    r = await call('look', {});
    ok(r.ok === true && r.served === '11111' && r.host === '11111', 'with one visit open, a call without host goes to it, and its answer says which machine');

    // A SECOND MACHINE: opens alongside -- the refusal that once made an agent end another's visit is gone
    r = await call('connect', { host: '22222', task: 'the second job' });
    ok(r.ok === true && r.host === '22222' && Array.isArray(r.open) && r.open.length === 2 && /host "22222"/.test(r.next || ''),
       'a second machine opens alongside the first, and is told to name its machine on every call (' + JSON.stringify([r.ok, r.why, r.open]) + ')');
    r = await call('look', {});
    ok(r.isError && /2 visits/.test(r.why || '') && /11111/.test(r.why) && /22222/.test(r.why) && !/disconnect/.test(r.why),
       'with two open, a call without host is refused -- never guessed -- and is not told to disconnect anything (' + (r.why || '').slice(0, 90) + ')');
    r = await call('connect', { host: '11111', task: 'someone else' });
    ok(r.isError && /already open/.test(r.why || '') && /do not disconnect it/.test(r.why),
       'a connect to a machine already open here is refused, and told to leave that visit alone');
    r = await call('connect', { host: '33333', task: 'a third' });
    ok(r.isError && /limit/.test(r.why || ''), 'past the limit (SM_MCP_MAX_VISITS) a connect is refused');
    r = await call('look', { host: '33333' });
    ok(r.isError && /no visit to machine 33333 is open/.test(r.why || ''), 'a call for a machine with no visit says so');

    // ROUTED BY host, and host never reaches the serve
    const [a, b] = await Promise.all([call('look', { host: '11111' }), call('look', { host: '22222' })]);
    ok(a.served === '11111' && b.served === '22222' && a.host === '11111' && b.host === '22222', 'each call reaches the machine it names');
    ok(a.leaked === undefined && b.leaked === undefined, '...and host is the server\'s own: the serve never sees it');

    // SIDE BY SIDE: two machines' calls overlap; one machine's still run one after another
    let t0 = Date.now();
    const [p1, p2] = await Promise.all([call('pause', { host: '11111', ms: 1500 }), call('pause', { host: '22222', ms: 1500 })]);
    const both = Date.now() - t0;
    ok(p1.ok && p2.ok && p1.t0 < p2.t1 && p2.t0 < p1.t1 && both < 2700, 'two machines\' calls run side by side (' + both + ' ms for two 1.5 s pauses)');
    t0 = Date.now();
    const [q1, q2] = await Promise.all([call('pause', { host: '11111', ms: 1500 }), call('pause', { host: '11111', ms: 1500 })]);
    const one = Date.now() - t0;
    ok(q1.ok && q2.ok && (q1.t1 <= q2.t0 || q2.t1 <= q1.t0) && one >= 3000, 'one machine\'s calls still run one after another (' + one + ' ms)');

    // ENDING: only by name with several open; the other visit carries on -- by name, since it has had company
    r = await call('disconnect', {});
    ok(r.isError && /2 visits/.test(r.why || ''), 'disconnect without host is refused while two are open');
    r = await call('disconnect', { host: '11111' });
    ok(r.ok === true && r.host === '11111', 'disconnect {host} ends that visit');
    r = await call('look', {});
    ok(r.isError && /more than one visit/.test(r.why || '') && /host "22222"/.test(r.why),
       'the visit left over is NOT handed a call that names no machine -- it may be the agent whose visit just ended (' + (r.why || '').slice(0, 80) + ')');
    r = await call('look', { host: '22222' });
    ok(r.ok === true && r.served === '22222', '...and carries on for calls that name it');
    r = await call('disconnect', { host: '22222' });
    r = await call('look', {});
    ok(r.isError && /no visit is open/.test(r.why || ''), 'with every visit ended, a call says to connect first');

    // A VISIT ALONE takes calls that name no machine again -- until company comes
    r = await call('connect', { host: '33333', task: 'a job of its own' });
    ok(r.ok === true && !r.open, 'a visit opened on an empty server is alone (' + JSON.stringify([r.ok, r.why]) + ')');
    const pid3 = r.pid;
    r = await call('look', {});
    ok(r.ok === true && r.served === '33333', '...and a call without host goes to it, as with one visit before');
    r = await call('connect', { host: '44444', task: 'company' });
    ok(r.ok === true && Array.isArray(r.open) && r.open.length === 2, 'a second opens alongside');

    // A VISIT THAT DIES with another open still counts until its agent hears why
    try { process.kill(pid3); } catch (_) {}
    for (let i = 0; i < 60; i++) { try { process.kill(pid3, 0); } catch (_) { break; } await sleep(100); }
    await sleep(300);
    r = await call('look', {});
    ok(r.isError && /2 visits/.test(r.why || '') && /ended: 33333/.test(r.why), 'a visit whose client died still counts: a call without host is refused, never handed the other (' + (r.why || '').slice(0, 90) + ')');
    r = await call('look', { host: '33333' });
    ok(r.isError && r.ended === true && /visit is over/.test(r.why || '') && r.host === '33333', '...its own agent, naming it, hears it is over');
    r = await call('look', {});
    ok(r.isError && /host "44444"/.test(r.why || ''), '...and after that, a call that names no machine is still not given the other visit');
    r = await call('look', { host: '44444' });
    ok(r.ok === true && r.served === '44444', 'the other visit never noticed');
    r = await call('disconnect', { host: '44444' });
    ok(r.ok === true, 'and ends by name');
  } catch (e) { fail++; console.error('  FAIL (exception): ' + ((e && e.stack) || e)); }
  try { srv.stdin.end(); } catch (_) {}
  await new Promise((res) => { const t = setTimeout(() => { try { srv.kill(); } catch (_) {} res(); }, 8000); srv.on('exit', () => { clearTimeout(t); res(); }); });
  for (let i = 0; i < 20; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch (_) { await sleep(150); } }
  console.log((fail ? 'FAIL' : 'ok') + ' mcp_parallel: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();

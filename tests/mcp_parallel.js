// mcp_parallel.js -- the MCP server as an editor runs it: ONE server for all its chats, several machines at once, and a
// client that gives up on a call after a minute (Cursor: -32001).
//   - a visit per machine, side by side; EVERY call names its machine with `host` -- never guessed, never "the only one";
//   - a second agent's connect never ends the first one's visit;
//   - calls for two machines do not wait on each other, while one machine's calls still run one after another;
//   - no call blocks past SM_MCP_CALL_MS: a command still running answers `pending` and the next call collects it; a
//     connect still waiting for Allow answers `waiting`, and the next connect to that machine takes the wait up again;
//     chat_wait listens no longer than a call may;
//   - the tools a model is shown fit an editor's limit, and `more` reaches every other verb.
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

// THE STAND-IN for core/agent-join.js --serve: says its Allow code, writes ready.json (machine 55555 only after 6.5 s: a
// person slow to press Allow, 6.5 s), then answers each cmd.json in done.json -- `served` is the machine it serves, `leaked`
// would be a `host` the MCP server should have kept, and a chat-wait answers with the timeout it was given.
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
    const t0 = Date.now(), ms = cmd.do === 'pause' ? Math.min(Number(cmd.ms) || 0, 20000) : 0;
    setTimeout(() => {
      const a = { ok: true, did: cmd.do, served: host, n, t0, t1: Date.now() };
      if (cmd.host !== undefined) a.leaked = cmd.host;
      if (cmd.do === 'chat-wait') { a.ok = false; a.timedOut = true; a.why = 'nobody answered in time'; a.timeout = cmd.timeout; }
      fs.writeFileSync(outFile, JSON.stringify(a));
      busy = false;
      if (cmd.do === 'quit' || cmd.do === 'done') setTimeout(() => process.exit(0), 50);
    }, ms);
  }, 20);
}, host === '55555' ? 6500 : 150);
`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-par-'));
  const fake = path.join(tmp, 'fake-serve.js');
  fs.writeFileSync(fake, FAKE);
  // a call may take 6 s here (50 s by default): short enough to test what happens past it
  const srv = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'ignore'],
    env: Object.assign({}, process.env, { SM_MCP_CLIENT: fake, SM_MCP_WORK: path.join(tmp, 'work'), SM_MCP_MAX_VISITS: '3', SM_MCP_CONNECT_MS: '30000', SM_MCP_CALL_MS: '6000', SM_MCP_TOOLS: '' }) });
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
  // a tool call: its first block's JSON, with isError and how long it took; `late` = what rode on it from before
  const call = async (name, args) => {
    const t0 = Date.now();
    const m = await rpc('tools/call', { name, arguments: args || {} });
    const r = m.result || {}, blocks = r.content || [];
    let o = {}; try { o = JSON.parse(blocks[0].text); } catch (_) { o = { raw: blocks[0] && blocks[0].text }; }
    const late = blocks.slice(1).map((b) => { try { return JSON.parse(b.text); } catch (_) { return null; } }).filter((x) => x && x.previous);
    return Object.assign(o, { isError: !!r.isError, ms: Date.now() - t0, late });
  };
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcp-parallel-test', version: '1' } });
    const tools = (await rpc('tools/list', {})).result.tools;
    const names = tools.map((t) => t.name);
    ok(tools.length <= 40, 'the tools a model is shown fit an editor\'s limit (' + tools.length + ' tools; Cursor sends 40)');
    ok(['status', 'confirm', 'captcha', 'done', 'think', 'access', 'undo', 'chat_wait'].every((n) => names.indexOf(n) >= 0 && names.indexOf(n) < 40),
       'the tools the rules require are among them: status, confirm, captcha, done, think, access, undo, chat_wait');
    ok(!!tools.find((t) => t.name === 'more') && !names.includes('pause') && !names.includes('note_add'), 'the rest are reached through more (pause, note_add, ... have no tool of their own)');
    ok(tools.filter((t) => !['connect', 'intake'].includes(t.name)).every((t) => (t.inputSchema.required || []).includes('host')),
       'every call but connect and intake REQUIRES host');

    // ONE machine: a call still names it -- "the only one open" is not a guess this server makes
    let r = await call('connect', { host: '11111', task: 'the first job' });
    ok(r.ok === true && r.host === '11111' && /host "11111"/.test(r.next || ''), 'the first visit opens, and is told to give its host on every call (' + JSON.stringify([r.ok, r.why]) + ')');
    r = await call('look', {});
    ok(r.isError && /say which machine with host/.test(r.why || '') && /11111/.test(r.why), 'a call that names no machine is refused even with one visit open: it may come from a chat that never connected (' + (r.why || '').slice(0, 80) + ')');
    r = await call('look', { host: '11111' });
    ok(r.ok === true && r.served === '11111' && r.host === '11111', 'naming it, the call goes to it, and its answer says which machine');

    // A SECOND MACHINE: opens alongside -- the refusal that once made an agent end another's visit is gone
    r = await call('connect', { host: '22222', task: 'the second job' });
    ok(r.ok === true && r.host === '22222' && Array.isArray(r.open) && r.open.length === 2, 'a second machine opens alongside the first (' + JSON.stringify([r.ok, r.why, r.open]) + ')');
    r = await call('connect', { host: '11111', task: 'someone else' });
    ok(r.isError && /already open/.test(r.why || '') && /do not disconnect it/.test(r.why), 'a connect to a machine already open here is refused, and told to leave that visit alone');
    r = await call('look', { host: '33333' });
    ok(r.isError && /no visit to machine 33333 is open/.test(r.why || ''), 'a call for a machine with no visit says so');

    // ROUTED BY host, and host never reaches the serve
    const [a, b] = await Promise.all([call('look', { host: '11111' }), call('look', { host: '22222' })]);
    ok(a.served === '11111' && b.served === '22222', 'each call reaches the machine it names');
    ok(a.leaked === undefined && b.leaked === undefined, '...and host is the server\'s own: the serve never sees it');

    // SIDE BY SIDE: two machines' calls overlap; one machine's still run one after another (pause is reached through more)
    let t0 = Date.now();
    const [p1, p2] = await Promise.all([call('more', { do: 'pause', host: '11111', ms: 1500 }), call('more', { do: 'pause', host: '22222', ms: 1500 })]);
    const both = Date.now() - t0;
    ok(p1.ok && p2.ok && p1.did === 'pause' && p1.t0 < p2.t1 && p2.t0 < p1.t1 && both < 2700, 'two machines\' calls run side by side (' + both + ' ms for two 1.5 s pauses, through more)');
    t0 = Date.now();
    const [q1, q2] = await Promise.all([call('more', { do: 'pause', host: '11111', ms: 1500 }), call('more', { do: 'pause', host: '11111', ms: 1500 })]);
    const one = Date.now() - t0;
    ok(q1.ok && q2.ok && (q1.t1 <= q2.t0 || q2.t1 <= q1.t0) && one >= 3000, 'one machine\'s calls still run one after another (' + one + ' ms)');
    r = await call('more', { do: 'nosuchverb', host: '11111' });
    ok(r.isError && /more needs do/.test(r.why || ''), 'more with a verb the table does not have is refused');

    // NO CALL BLOCKS PAST ITS TIME: a command still running answers pending -- not an error -- and the next call collects it
    r = await call('more', { do: 'pause', host: '11111', ms: 7000 });
    ok(!r.isError && r.pending === true && r.running === 'pause' && r.ms < 7000, 'a command that outlasts a call answers pending within the call\'s time, not an error (' + r.ms + ' ms: ' + (r.why || '').slice(0, 70) + ')');
    r = await call('ping', { host: '11111' });
    ok(r.ok === true && r.late.length === 1 && r.late[0].previous === 'pause' && r.late[0].answeredLate && r.late[0].answeredLate.ok, 'ping collects its answer when it comes (' + JSON.stringify(r.late) + ')');
    r = await call('chat_wait', { host: '22222' });
    ok(r.timeout === 1000 && /call chat_wait/.test(r.next || ''), 'chat_wait listens no longer than a call may, and says to call it again (' + JSON.stringify([r.timeout, r.next]) + ')');
    r = await call('chat_wait', { host: '22222', timeout: 300000 });
    ok(r.timeout === 1000, '...even when it is asked to wait five minutes');

    // A CONNECT STILL WAITING FOR ALLOW past a call's time: it says so, and the next connect takes the wait up again
    await call('disconnect', { host: '22222' });
    r = await call('connect', { host: '55555', task: 'a slow Allow' });
    ok(!r.isError && r.ok === false && r.waiting === true && r.code === 'FAKE-55555' && r.ms < 7000, 'a connect nobody has let in yet answers waiting, with the code, within the call\'s time (' + JSON.stringify([r.waiting, r.code, r.ms]) + ')');
    r = await call('look', { host: '55555' });
    ok(r.isError && r.waiting === true && /not open yet/.test(r.why || ''), 'a call to it before then says it is not open yet, and how to keep waiting');
    r = await call('connect', { host: '55555', task: 'a slow Allow' });
    ok(r.ok === true && r.resumed === true && r.host === '55555', 'the next connect takes the wait up again and opens it (' + JSON.stringify([r.ok, r.resumed, r.why]) + ')');
    r = await call('look', { host: '55555' });
    ok(r.ok === true && r.served === '55555', '...and it serves');

    // ENDING: by name only; the other visit carries on
    r = await call('disconnect', {});
    ok(r.isError && /say which machine/.test(r.why || ''), 'disconnect without host is refused');
    r = await call('disconnect', { host: '11111' });
    ok(r.ok === true && r.host === '11111', 'disconnect {host} ends that visit');
    r = await call('look', { host: '55555' });
    ok(r.ok === true && r.served === '55555', 'the other visit carries on');
    r = await call('disconnect', { host: '55555' });
    r = await call('look', { host: '55555' });
    ok(r.isError && /connect \{host:"55555"/.test(r.why || ''), 'with the visit ended, a call to it says to connect first');
  } catch (e) { fail++; console.error('  FAIL (exception): ' + ((e && e.stack) || e)); }
  try { srv.stdin.end(); } catch (_) {}
  await new Promise((res) => { const t = setTimeout(() => { try { srv.kill(); } catch (_) {} res(); }, 8000); srv.on('exit', () => { clearTimeout(t); res(); }); });
  for (let i = 0; i < 20; i++) { try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch (_) { await sleep(150); } }
  console.log((fail ? 'FAIL' : 'ok') + ' mcp_parallel: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();

// mcp_icons.js — the MCP server's icon (MCP 2025-11-25 `icons` on serverInfo): ScreenMirror's mark as PNG data: URIs,
// each the size it says it is, sent to a client that negotiated 2025-11-25 and to no older one. Starts mcp/server.js and
// asks it to initialize, nothing more: no relay, no visit. No dependencies.
//   node tests/mcp_icons.js
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const SERVER = path.join(__dirname, '..', 'mcp', 'server.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// one `initialize` against a fresh server, its answer, then the server is let go
function initialize(protocolVersion) {
  return new Promise((resolve, reject) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-icons-'));
    const p = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'ignore'], env: Object.assign({}, process.env, { SM_MCP_WORK: work }) });
    let buf = '', done = false;
    const finish = (err, v) => { if (done) return; done = true; clearTimeout(t); try { p.stdin.end(); } catch (_) {} try { p.kill(); } catch (_) {}
      try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} if (err) reject(err); else resolve(v); };
    const t = setTimeout(() => finish(new Error('no answer to initialize in 15 s')), 15000);
    p.on('error', (e) => finish(e));
    p.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i < 0) return; try { finish(null, JSON.parse(buf.slice(0, i))); } catch (e) { finish(e); } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'mcp-icons-test', version: '1' } } }) + '\n');
  });
}

// a PNG's own width and height, from its IHDR -- what the icon says about itself has to be what it is
const pngSize = (b) => (b.length > 24 && b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && b.slice(12, 16).toString('latin1') === 'IHDR')
  ? b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) : '';

(async () => {
  try {
    const now = await initialize('2025-11-25');
    const si = now.result && now.result.serverInfo;
    ok(!!si && si.name === 'agent-drive' && si.title === 'ScreenMirror agent-drive', 'serverInfo still names the server (' + JSON.stringify(si && { name: si.name, title: si.title }) + ')');
    const icons = (si && si.icons) || [];
    ok(Array.isArray(icons) && icons.length === 2, 'a 2025-11-25 client is sent the icons (' + icons.length + ')');
    for (const ic of icons) {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(ic.src || ''));
      ok(!!m && ic.mimeType === 'image/png', 'each is a PNG, as a data: URI (no network) with its mime type');
      const b = m ? Buffer.from(m[1], 'base64') : Buffer.alloc(0);
      ok(Array.isArray(ic.sizes) && ic.sizes.length === 1 && pngSize(b) === ic.sizes[0], '...and is the size it says (' + JSON.stringify(ic.sizes) + ' is ' + (pngSize(b) || 'not a PNG') + ')');
      ok(b.length > 0 && b.length < 16 * 1024, '...and small (' + b.length + ' B)');
    }
    ok(JSON.stringify(icons.map((i) => i.sizes[0])) === '["32x32","64x64"]', 'at 32 and 64 px: a 16 px row at 2x and at 4x');
    const old = await initialize('2025-06-18');
    const so = old.result && old.result.serverInfo;
    ok(!!so && so.name === 'agent-drive' && !('icons' in so), 'an older client (2025-06-18) is not sent a field its revision does not have');
    const unknown = await initialize('2099-01-01');
    ok(unknown.result && unknown.result.protocolVersion === '2025-11-25' && Array.isArray(unknown.result.serverInfo.icons), 'a version it does not know is answered with its newest, icons and all');
  } catch (e) { fail++; console.error('  FAIL (exception): ' + (e && e.stack || e)); }
  console.log((fail ? 'FAIL' : 'ok') + ' mcp_icons: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();

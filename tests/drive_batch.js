// drive_batch.js — regression test for bin/drive.js, the shell-facing command tool (one cmd/done cycle, or
// a BATCH array that stops at the first ok:false). Uses the same race-robust fake-serve as run_recipe.js
// (answers each NEW cmd.json by mtime; forces ok:false for a keys:"FAIL" command). Asserts: a single
// command prints its answer and exits 0; a happy batch runs every step (tagged [i/n]) and exits 0; a batch
// stops at the first ok:false (exit 4) and never writes the following command (cmd.json is the failing one,
// which also proves the atomic write left a complete command); and the usage guards exit 2.
//   node tests/drive_batch.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawn } = require('child_process');
const DRIVE = path.join(__dirname, '..', 'drive', 'drive.js');
const node = process.execPath;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drv-'));
const FAKE = path.join(dir, '_fakeserve.js');
fs.writeFileSync(FAKE, [
  "const fs=require('fs'),path=require('path');",
  "const dir=process.argv[2],cmdFile=path.join(dir,'cmd.json'),doneFile=path.join(dir,'done.json');",
  "let lastM=-1;",
  "setInterval(()=>{try{",
  "  if(!fs.existsSync(cmdFile)||fs.existsSync(doneFile))return;",
  "  const m=fs.statSync(cmdFile).mtimeMs; if(m<=lastM)return;",
  "  let c={};try{c=JSON.parse(fs.readFileSync(cmdFile,'utf8'));}catch(e){return;}",
  "  const res=(c.do==='keys'&&c.text==='FAIL')?{ok:false,why:'forced'}:{ok:true};",
  "  fs.writeFileSync(doneFile,JSON.stringify(res)); lastM=m;",
  "}catch(e){}},10);",
].join('\n'));
const serve = spawn(node, [FAKE, dir], { stdio: 'ignore' });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const drive = (cmd) => { try { const out = execFileSync(node, [DRIVE, dir, cmd], { encoding: 'utf8', timeout: 25000 }); return { code: 0, out }; } catch (e) { return { code: (e && e.status != null) ? e.status : -1, out: ((e && e.stdout) || '') + ((e && e.stderr) || '') }; } };
const lastCmd = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'cmd.json'), 'utf8')); } catch (_) { return null; } };

try {
  // 1. single command -> prints the answer, exits 0
  let r = drive('{"do":"keys","text":"ls"}');
  ok(r.code === 0 && /"ok":\s*true/.test(r.out), 'single command runs and prints the answer (code ' + r.code + ')');

  // 2. happy batch -> every step runs, tagged [i/n], exit 0
  r = drive('[{"do":"keys","text":"ls"},{"do":"press","code":"Enter"}]');
  ok(r.code === 0 && r.out.indexOf('[1/2]') >= 0 && r.out.indexOf('[2/2]') >= 0, 'happy batch runs both steps (code ' + r.code + ')');

  // 3. batch stops at the first ok:false (exit 4) and does NOT run the step after it
  r = drive('[{"do":"keys","text":"ls"},{"do":"keys","text":"FAIL"},{"do":"keys","text":"AFTER"}]');
  ok(r.code === 4, 'batch stops with exit 4 at the first ok:false (got ' + r.code + ')');
  const lc = lastCmd();
  ok(lc && lc.text === 'FAIL', 'batch wrote the failing command last, never the one after it (cmd.json.text=' + (lc && lc.text) + ')');

  // 4. usage guards exit 2 (and never touch the host)
  ok(drive('[]').code === 2, 'empty batch -> exit 2');
  ok(drive('[{"x":1}]').code === 2, 'a command with no .do -> exit 2');
  ok(drive('not json').code === 2, 'bad JSON -> exit 2');
} catch (e) { fail++; console.error('  FAIL (exception): ' + (e && e.stack || e)); }

try { serve.kill(); } catch (_) {}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

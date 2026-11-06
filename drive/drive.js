#!/usr/bin/env node
// @tool send ONE command -- or a batch -- to the session and print its answer
// @run  node drive/drive.js ./work '{"do":"shot","out":"/abs/view.png"}'
// drive.js <work-dir> <cmdJson> — run ONE serve-mode command, OR a BATCH, against a host held open by
// `agent-join.js --serve <work-dir>`. It clears done.json, writes cmd.json, waits for the client to
// answer, prints done.json. This turns the cmd/done file channel into a call you issue from a shell turn.
//
//   node drive.js ./work '{"do":"shot","out":"/abs/path/view.png"}'
//   node drive.js ./work '{"do":"click","x":490,"y":305}'
//   node drive.js ./work '{"do":"plan","steps":[{"do":"click","x":490,"y":305},{"do":"keys","text":"3"}]}'
//
// BATCH: pass a JSON ARRAY of commands and they run in SEQUENCE, each printed with an [i/n] tag, stopping
// at the first that answers `ok:false` — ONE invocation instead of one per command, which is what makes a
// multi-step stretch of driving quick. Use it for a run of known-safe steps (and keep a shot at the end to
// verify); do not fire a long blind sequence of actions you have not reasoned about.
//
//   node drive.js ./work '[{"do":"status","at":1},{"do":"click","x":490,"y":305},{"do":"shot","out":"/abs/a.png"}]'
//
// See reference/serve-protocol.md for the verbs and gotchas. No dependencies.
const fs = require('fs'), path = require('path');
const { putCmd, budgetOf } = require('../core/cmd-file.js');
const dir = process.argv[2];
const cmd = process.argv[3];
if (!dir || !cmd) { console.error('usage: node drive.js <work-dir> <cmdJson | [cmd, ...]>'); process.exit(2); }
const cmdFile = path.join(dir, 'cmd.json'), outFile = path.join(dir, 'done.json');
let parsed;
try { parsed = JSON.parse(cmd); } catch (e) { console.error('bad cmd json: ' + e.message); process.exit(2); }
const list = Array.isArray(parsed) ? parsed : [parsed];
if (!list.length) { console.error('bad cmd json: empty batch'); process.exit(2); }
for (const c of list) if (!c || typeof c.do !== 'string') { console.error('bad cmd json: a command has no .do'); process.exit(2); }

// How long to wait for each answer: budgetOf in cmd-file.js, shared with the scripts that hand over in-process.
const runOne = (c) => new Promise((resolve, reject) => {
  try { fs.unlinkSync(outFile); } catch (_) {}
  // ATOMIC write: temp file + rename, so the client can never read cmd.json mid-write (a batch writes fast).
  putCmd(cmdFile, c);
  const t0 = Date.now(), budget = budgetOf(c);
  (function wait() {
    if (fs.existsSync(outFile)) { let txt = ''; try { txt = fs.readFileSync(outFile, 'utf8'); } catch (_) {} resolve(txt); return; }
    if (Date.now() - t0 > budget) { reject(new Error('TIMEOUT after ' + Math.round(budget / 1000) + 's waiting for done.json')); return; }
    setTimeout(wait, 80);
  })();
});
(async () => {
  const many = list.length > 1;
  for (let i = 0; i < list.length; i++) {
    const tag = many ? '[' + (i + 1) + '/' + list.length + '] ' : '';
    let txt;
    try { txt = await runOne(list[i]); } catch (e) { console.error(tag + e.message); process.exit(3); }
    process.stdout.write(tag + txt.trim() + '\n');
    if (many) { let r = null; try { r = JSON.parse(txt); } catch (_) {} if (r && r.ok === false) { console.error('batch stopped at step ' + (i + 1) + '/' + list.length + ' (ok:false)'); process.exit(4); } }
  }
})();

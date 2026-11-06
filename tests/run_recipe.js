// run_recipe.js — regression test for bin/run.js, the recipe runner (a plan tree + steps; it marks the
// panel, runs each step's command(s), verifies an `expect`, and STOPS at the first failure, marking that
// step a warning). Unlike plan.js, run.js acts on command RESULTS, so this uses a content-aware fake serve:
// it answers each NEW cmd.json (tracked by mtime, which sidesteps run.js's unlink->rename window) and forces
// ok:false for a `keys:"FAIL"` command or a `FAILEXPECT` predicate, so the happy path and every failure
// path can be exercised. Checks exit codes + the final tree run.js sent (cmd.json holds its last status).
//   node tests/run_recipe.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawn } = require('child_process');
const RUN = path.join(__dirname, '..', 'drive', 'run.js');
const node = process.execPath;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
const FRAMES = path.join(dir, '_frames.ndjson');
const FAKE = path.join(dir, '_fakeserve.js');
fs.writeFileSync(FAKE, [
  "const fs=require('fs'),path=require('path');",
  "const dir=process.argv[2],cmdFile=path.join(dir,'cmd.json'),doneFile=path.join(dir,'done.json');",
  "const frames=path.join(dir,'_frames.ndjson');let last=null;",
  "setInterval(()=>{try{",
  "  if(!fs.existsSync(cmdFile)||fs.existsSync(doneFile))return;",
  "  let raw='';try{raw=fs.readFileSync(cmdFile,'utf8');}catch(e){return;}if(!raw||raw===last)return;",   // only a NEW cmd (by content) than last answered
  "  let c={};try{c=JSON.parse(raw);}catch(e){return;} last=raw;",
  "  try{fs.appendFileSync(frames,JSON.stringify(c)+'\\n');}catch(e){}",
  "  let res={ok:true};",
  "  if(c.do==='keys'&&c.text==='FAIL')res={ok:false,why:'forced fail'};",
  "  else if(c.do==='expect')res=(JSON.stringify(c.until||c).indexOf('FAILEXPECT')>=0)?{ok:false,why:'expect forced'}:{ok:true};",
  "  else if(c.do==='shot')res={ok:true,w:100,h:100};",
  "  fs.writeFileSync(doneFile,JSON.stringify(res));",
  "}catch(e){}},8);",
].join('\n'));
const serve = spawn(node, [FAKE, dir], { stdio: 'ignore' });
const readFrames = () => { try { return fs.readFileSync(FRAMES, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; } };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const run = (recipe) => { try { execFileSync(node, [RUN, dir, JSON.stringify(recipe)], { encoding: 'utf8', timeout: 25000 }); return 0; } catch (e) { return (e && e.status != null) ? e.status : -1; } };
const lastTree = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'cmd.json'), 'utf8')).tree; } catch (_) { return null; } };
const stateOf = (tree, label) => { let s = null; (function w(ns) { (ns || []).forEach((n) => { if (n.t === label) s = n.s; if (n.k) w(n.k); }); })(tree); return s; };
const PLAN = [{ t: 'Step1', k: [{ t: 's1a' }] }, { t: 'Step2' }];

try {
  // 1. happy path: every step ok -> exit 0, final tree all done
  try { fs.writeFileSync(FRAMES, ''); } catch (_) {}
  let code = run({ plan: PLAN, steps: [{ at: 's1a', do: { do: 'keys', text: 'ls' } }, { at: 'Step2', do: { do: 'press', code: 'Enter' }, expect: { text: { rect: [0, 0, 10, 10], has: 'OK' } }, shot: path.join(dir, 's.png') }] });
  ok(code === 0, 'happy recipe exits 0 (got ' + code + ')');
  let t = lastTree();
  ok(t && stateOf(t, 'Step1') === 'done' && stateOf(t, 's1a') === 'done' && stateOf(t, 'Step2') === 'done', 'happy path leaves the whole tree done');

  // 1b. the SYSTEMIC guarantees for any recipe-based task: every acting command is sent quiet (so the
  // serve loop's generic "Clicking" can't stomp the tree), and completion settles the panel green (fin:1).
  const fr = readFrames();
  const acts = fr.filter((c) => c.do !== 'status');     // keys/press/expect/shot -- the work, not the narration
  ok(acts.length > 0 && acts.every((c) => c.quiet === 1), 'every recipe action command is sent quiet:1 (' + acts.length + ' actions)');
  const statuses = fr.filter((c) => c.do === 'status');
  const finFrames = statuses.filter((c) => c.fin);
  ok(finFrames.length === 1, 'exactly one completion frame carries fin:1 (panel goes green)');
  const lastStatus = statuses[statuses.length - 1];
  ok(lastStatus && lastStatus.fin === 1 && stateOf(lastStatus.tree, 'Step2') === 'done', 'the fin frame is last and its tree is all done');

  // 2. a command returning ok:false stops the run (exit 4) and marks the step a warning
  code = run({ plan: PLAN, steps: [{ at: 's1a', do: { do: 'keys', text: 'FAIL' } }, { at: 'Step2', do: { do: 'keys', text: 'ls' } }] });
  ok(code === 4, 'a failed command exits 4 (got ' + code + ')');
  t = lastTree();
  ok(t && stateOf(t, 's1a') === 'warn', 'the failed step is marked warn');
  ok(t && stateOf(t, 'Step2') !== 'done', 'the run stopped -- the next step did not complete');

  // 3. a failed expect stops the run (exit 5) and marks the step a warning
  code = run({ plan: PLAN, steps: [{ at: 'Step2', do: { do: 'keys', text: 'ls' }, expect: { text: { rect: [0, 0, 10, 10], has: 'FAILEXPECT' } } }] });
  ok(code === 5, 'a failed expect exits 5 (got ' + code + ')');
  t = lastTree();
  ok(t && stateOf(t, 'Step2') === 'warn', 'the step whose expect failed is marked warn');

  // 4. a step naming a non-existent plan label is a usage error (exit 2)
  code = run({ plan: PLAN, steps: [{ at: 'NoSuchStep', do: { do: 'keys', text: 'ls' } }] });
  ok(code === 2, 'an unknown plan step exits 2 (got ' + code + ')');
} catch (e) { fail++; console.error('  FAIL (exception): ' + (e && e.stack || e)); }

try { serve.kill(); } catch (_) {}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

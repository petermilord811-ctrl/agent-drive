// plan_tree.js — regression test for bin/plan.js tree marking (it drives the progress panel's nested plan).
// plan.js keeps the tree in <dir>/plan.json and sends a `status {tree}` command, waiting for done.json. We
// run it against a temp dir with a tiny FAKE SERVE (writes done.json as soon as cmd.json appears, so the
// wait returns in ms instead of 35s) and check the marking. plan.js writes the mutated tree to plan.json
// BEFORE the cmd/done dance, so reading plan.json is the assertion -- independent of the channel timing.
//   node tests/plan_tree.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawn } = require('child_process');
const PLAN = path.join(__dirname, '..', 'drive', 'plan.js');
const node = process.execPath;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
// fake serve: whenever cmd.json exists and done.json doesn't, satisfy it (so plan.js's wait returns fast)
const serve = spawn(node, ['-e', "const fs=require('fs'),p=process.argv[1];setInterval(()=>{try{if(fs.existsSync(p+'/cmd.json')&&!fs.existsSync(p+'/done.json'))fs.writeFileSync(p+'/done.json',JSON.stringify({ok:true}));}catch(e){}},15);", dir], { stdio: 'ignore' });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const plan = (...args) => { try { execFileSync(node, [PLAN, dir, ...args], { encoding: 'utf8', timeout: 20000 }); } catch (_) {} };
const readTree = () => JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
const stateOf = (tree, label) => { let s = null; (function walk(ns) { for (const n of ns) { if (n.t === label) s = (n.s === undefined ? 'todo' : n.s); if (n.k) walk(n.k); } })(tree); return s; };
const all = (tree, labels, st) => labels.every((l) => stateOf(tree, l) === st);
const TREE = '[{"t":"A","k":[{"t":"a1"},{"t":"a2"}]},{"t":"B","k":[{"t":"b1"}]},{"t":"C"}]';   // pre-order: A a1 a2 B b1 C

try {
  // set -> everything defaults to todo
  plan('set', TREE);
  ok(all(readTree(), ['A', 'a1', 'a2', 'B', 'b1', 'C'], 'todo'), 'set defaults every node to todo');

  // at "b1" -> nodes before = done, target + its ancestor = doing, nodes after = todo
  plan('set', TREE); plan('at', 'b1');
  let t = readTree();
  ok(all(t, ['A', 'a1', 'a2'], 'done'), 'at: nodes before the target are done');
  ok(stateOf(t, 'b1') === 'doing' && stateOf(t, 'B') === 'doing', 'at: the target and its ancestor are doing');
  ok(stateOf(t, 'C') === 'todo', 'at: nodes after the target are todo');

  // done "A" -> A and its whole subtree done; the rest untouched
  plan('set', TREE); plan('done', 'A');
  t = readTree();
  ok(all(t, ['A', 'a1', 'a2'], 'done'), 'done marks the node and its whole subtree');
  ok(all(t, ['B', 'b1', 'C'], 'todo'), 'done leaves the rest untouched');

  // warn "a2" -> a2 warn, its ancestor A doing
  plan('set', TREE); plan('warn', 'a2');
  t = readTree();
  ok(stateOf(t, 'a2') === 'warn', 'warn marks the node warn');
  ok(stateOf(t, 'A') === 'doing', 'warn sets the ancestor to doing');

  // finish -> everything done, and the sent frame carries fin:1 so the panel settles green
  plan('set', TREE); plan('finish');
  ok(all(readTree(), ['A', 'a1', 'a2', 'B', 'b1', 'C'], 'done'), 'finish marks everything done');
  let finCmd = null; try { finCmd = JSON.parse(fs.readFileSync(path.join(dir, 'cmd.json'), 'utf8')); } catch (_) {}
  ok(finCmd && finCmd.do === 'status' && finCmd.fin === 1, 'finish sends fin:1 (greens the panel without hanging up)');
  ok(finCmd && !('file' in finCmd), 'a bare finish sends no picture');
  // finish <picture> [line]: the result picture rides in the finish report, as a path the serve can read
  plan('set', TREE); plan('finish', 'result.jpg', 'Solved');
  let picCmd = null; try { picCmd = JSON.parse(fs.readFileSync(path.join(dir, 'cmd.json'), 'utf8')); } catch (_) {}
  ok(picCmd && picCmd.fin === 1 && picCmd.file === path.resolve('result.jpg') && picCmd.text === 'Solved',
     'finish <picture> <line> sends the picture (absolute) and the line');
  // a plain mark does NOT carry fin (still live)
  plan('set', TREE); plan('at', 'b1');
  let atCmd = null; try { atCmd = JSON.parse(fs.readFileSync(path.join(dir, 'cmd.json'), 'utf8')); } catch (_) {}
  ok(atCmd && !atCmd.fin, 'a plain `at` does NOT carry fin (the task is still live)');

  // index-path addressing: "0.1" == A's second child (a2)
  plan('set', TREE); plan('at', '0.1');
  t = readTree();
  ok(stateOf(t, 'a2') === 'doing' && stateOf(t, 'A') === 'doing' && stateOf(t, 'a1') === 'done', 'at accepts an index path (0.1 -> a2)');
} catch (e) { fail++; console.error('  FAIL (exception): ' + (e && e.stack || e)); }

try { serve.kill(); } catch (_) {}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

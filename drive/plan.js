#!/usr/bin/env node
// @tool drive the progress panel's tree with one-liners: set, at, done, warn, finish
// @run  node drive/plan.js ./work at "<step label>" "<live line>"
// plan.js <work-dir> <verb> [...] — a stateful wrapper around `status {tree}` so you drive the panel's
// NESTED plan tree with one-liners instead of re-sending the whole tree JSON every time. It keeps the
// tree in <work-dir>/plan.json, mutates one position, and sends the whole (updated) tree to the panel.
//
//   node plan.js ./work set '[{"t":"Open a paint app","k":[{"t":"Find the app"},{"t":"Launch GIMP"}]},{"t":"Draw"}]'
//   node plan.js ./work at  "Find the app"  "checking installed apps"   # <- label (substring) or index path "0.0"
//   node plan.js ./work at  "Launch GIMP"                               # advances: everything before = done
//   node plan.js ./work warn "Launch GIMP"  "it was slow to start"
//   node plan.js ./work done "Open a paint app"                         # mark a node + its subtree done
//   node plan.js ./work finish                                          # everything done
//   node plan.js ./work finish ./work/result.jpg "Solved in 18 s"       # ...with the picture of the result
//
// `at` sets the LINEAR position: in a pre-order walk, everything before the target is `done`, the target
// and its ancestors are `doing`, everything after is `todo`. That is the common case (step by step); use
// `done`/`warn` for explicit, non-linear marks. All of it is display-only -- it drives the panel, never
// the machine. No dependencies; same cmd/done channel as drive.js.
const fs = require('fs'), path = require('path');
const { exchangeAsync } = require('../core/cmd-file.js');
const [dir, verb, arg, note] = process.argv.slice(2);
if (!dir || !verb) { console.error('usage: node plan.js <work-dir> set|at|done|warn [path] [note] | finish [picture] [note]'); process.exit(2); }
const planFile = path.join(dir, 'plan.json'), cmdFile = path.join(dir, 'cmd.json'), outFile = path.join(dir, 'done.json');

const loadTree = () => { try { return JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch (_) { return []; } };
const setAll = (nodes, s) => { for (const n of nodes) { if (!n || typeof n !== 'object') continue; n.s = s; if (Array.isArray(n.k)) setAll(n.k, s); } };
// Pre-order list of {node, path(indices), ancestors[]} so we can address a node and reason about order.
const flat = (nodes, pre, anc, out) => {
  nodes.forEach((n, i) => { if (!n || typeof n !== 'object') return;
    const p = pre.concat(i); out.push({ n, p: p.join('.'), anc });
    if (Array.isArray(n.k)) flat(n.k, p, anc.concat(n), out);
  });
  return out;
};
const find = (rows, sel) => {
  if (/^[0-9]+(\.[0-9]+)*$/.test(sel)) return rows.find((r) => r.p === sel);       // index path "0.1.2"
  const s = String(sel).toLowerCase();
  return rows.find((r) => String(r.n.t || '').toLowerCase().includes(s));          // label substring, first pre-order match
};

let tree = loadTree();
if (verb === 'set') {
  try { tree = JSON.parse(arg); if (!Array.isArray(tree)) throw new Error('not an array'); }
  catch (e) { console.error('bad tree json: ' + e.message); process.exit(2); }
  // default everything not already stated to todo
  (function dflt(ns) { for (const n of ns) { if (!n || typeof n !== 'object') continue; if (!/^(done|doing|todo|warn)$/.test(n.s || '')) n.s = 'todo'; if (Array.isArray(n.k)) dflt(n.k); } })(tree);
} else if (verb === 'finish') {
  setAll(tree, 'done');
} else {
  const rows = flat(tree, [], [], []);
  const target = find(rows, arg || '');
  if (!target) { console.error('plan.js: no step matching "' + arg + '" (have: ' + rows.map((r) => r.n.t).join(' | ') + ')'); process.exit(2); }
  if (verb === 'at') {
    const ti = rows.indexOf(target);
    rows.forEach((r, i) => { r.n.s = i < ti ? 'done' : i === ti ? 'doing' : 'todo'; });
    target.anc.forEach((a) => { a.s = 'doing'; });                                 // ancestors of the current are in progress
  } else if (verb === 'done') {
    target.n.s = 'done'; if (Array.isArray(target.n.k)) setAll(target.n.k, 'done');
  } else if (verb === 'warn') {
    target.n.s = 'warn'; target.anc.forEach((a) => { if (a.s !== 'done') a.s = 'doing'; });
  } else { console.error('plan.js: unknown verb "' + verb + '"'); process.exit(2); }
}

fs.writeFileSync(planFile, JSON.stringify(tree));
// `finish` settles the panel GREEN (fin:1, display-only -- the serve session stays open, so you can start
// the next task; the next live frame lifts the green). A plain `at`/`done`/`warn`/`set` stays live.
// Its picture (a cropped .jpg of the result) rides in the finish report; the serve reads it, so the path
// goes absolute -- the serve's working folder need not be this one.
const cmd = { do: 'status', tree }; if (note) cmd.text = String(note);
if (verb === 'finish') { cmd.fin = 1; if (arg) cmd.file = path.resolve(String(arg)); }
// its own id, and the answer that carries it back (core/cmd-file.js): a late answer to something else is not this one's
exchangeAsync(dir, cmd).then((a) => process.stdout.write(a.txt + '\n'), (e) => { console.error(e.message); process.exit(3); });

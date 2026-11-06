#!/usr/bin/env node
// @tool run a recipe: a panel tree plus steps, each verified (expect) and marked as it goes
// @run  node drive/run.js ./work recipe.json
// run.js <work-dir> <recipe.json | inline-json> — run a declarative RECIPE: a plan tree + a list of steps.
// Each step marks its place in the panel's tree, runs its command(s), optionally VERIFIES with an `expect`,
// and optionally takes a shot. It advances the tree as it goes and STOPS at the first step that fails (a
// command's `ok:false`, or a failed expect), marking that step a warning. One invocation drives a whole
// phase -- faster than a turn per command, and verified as it goes, so it is NOT a blind sequence.
//
//   recipe = {
//     "plan":  [ {"t":"Open app","k":[{"t":"Find it"},{"t":"Launch"}]}, {"t":"Draw"} ],
//     "steps": [
//       { "at":"Find it", "note":"checking apps", "do":{"do":"keys","text":"ls /usr/bin"} },
//       { "at":"Launch",  "do":[{"do":"keys","text":"gimp &"},{"do":"press","code":"Enter"}],
//         "expect":{"text":{"rect":[0,0,500,60],"has":"GNU Image"}}, "shot":"/abs/win.png" }
//     ] }
//   node run.js ./work recipe.json
//
// Each step: `at` = the plan step (label substring) to light up; `do` = a command or array; `expect` = a
// predicate to check after (pass the predicate, with or without a wrapping {until:...}); `shot` = a path to
// capture after; `note` = the live line. No dependencies; same cmd/done channel as drive.js / plan.js.
const fs = require('fs'), path = require('path');
const { putCmd } = require('../core/cmd-file.js');
const [dir, src] = process.argv.slice(2);
if (!dir || !src) { console.error('usage: node run.js <work-dir> <recipe.json | inline-json>'); process.exit(2); }
let recipe;
try { recipe = JSON.parse(fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : src); } catch (e) { console.error('bad recipe: ' + e.message); process.exit(2); }
if (!Array.isArray(recipe.plan) || !Array.isArray(recipe.steps)) { console.error('recipe needs {plan:[...], steps:[...]}'); process.exit(2); }

const cmdFile = path.join(dir, 'cmd.json'), outFile = path.join(dir, 'done.json');
const tree = recipe.plan;
const setAll = (ns, s) => { for (const n of ns) { if (!n || typeof n !== 'object') continue; n.s = s; if (Array.isArray(n.k)) setAll(n.k, s); } };
const flat = (ns, anc, out) => { ns.forEach((n) => { if (!n || typeof n !== 'object') return; out.push({ n, anc }); if (Array.isArray(n.k)) flat(n.k, anc.concat(n), out); }); return out; };
setAll(tree, 'todo');
const markAt = (sel) => {   // linear pre-order position: before=done, this+ancestors=doing, after=todo
  const rows = flat(tree, [], []), s = String(sel).toLowerCase();
  const ti = rows.findIndex((r) => String(r.n.t || '').toLowerCase().includes(s));
  if (ti < 0) return null;
  rows.forEach((r, i) => { r.n.s = i < ti ? 'done' : i === ti ? 'doing' : 'todo'; });
  rows[ti].anc.forEach((a) => { a.s = 'doing'; });
  return rows[ti].n.t;
};
const markWarn = (sel) => { if (sel == null) return; const rows = flat(tree, [], []), s = String(sel).toLowerCase(); const r = rows.find((x) => String(x.n.t || '').toLowerCase().includes(s)); if (r) r.n.s = 'warn'; };

const budgetOf = (c) => { const b = Number(c.timeout) || 0; if (c.do === 'chat-wait') return (b || 120000) + 8000; if (c.do === 'plan' || c.do === 'strokes' || c.do === 'stroke') return Math.max(130000, b + 8000); return 35000; };
const runCmd = (c) => new Promise((resolve, reject) => {
  try { fs.unlinkSync(outFile); } catch (_) {}
  putCmd(cmdFile, c);   // atomic: no mid-write read
  const t0 = Date.now(), budget = budgetOf(c);
  (function w() { if (fs.existsSync(outFile)) { let r = null; try { r = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (_) {} resolve(r || {}); return; } if (Date.now() - t0 > budget) { reject(new Error('TIMEOUT ' + Math.round(budget / 1000) + 's')); return; } setTimeout(w, 80); })();
});
const sendStatus = (note, extra) => runCmd(Object.assign({ do: 'status', tree }, note ? { text: String(note) } : {}, extra || {}));
// Every step command runs QUIET so the serve loop's generic auto-phrase ("Clicking") can never stomp the
// tree this recipe is driving. (The serve loop also suppresses the phrase while a tree is active, so this
// is belt-and-suspenders -- and it keeps the recipe correct against an older client that lacks that guard.)
const runStepCmd = (c) => runCmd((c && typeof c === 'object' && c.quiet == null) ? Object.assign({ quiet: 1 }, c) : c);
const N = recipe.steps.length, tag = (i, st) => '[' + (i + 1) + '/' + N + '] ' + (st.at || st.note || ('step ' + (i + 1)));

(async () => {
  await sendStatus();                                   // declare the plan (all todo)
  for (let i = 0; i < N; i++) {
    const st = recipe.steps[i] || {};
    if (st.at != null && markAt(st.at) == null) { console.error('run.js: ' + tag(i, st) + ' names no plan step "' + st.at + '"'); process.exit(2); }
    await sendStatus(st.note);
    const t0 = Date.now();
    for (const c of (st.do == null ? [] : (Array.isArray(st.do) ? st.do : [st.do]))) {
      let r; try { r = await runStepCmd(c); } catch (e) { console.error(tag(i, st) + ' -- ' + e.message); markWarn(st.at); await sendStatus('error: ' + e.message); process.exit(3); }
      if (r && r.ok === false) { console.log(tag(i, st) + ' FAILED: ' + (r.why || 'ok:false')); markWarn(st.at); await sendStatus('failed: ' + (r.why || '')); process.exit(4); }
    }
    if (st.expect) { const r = await runStepCmd({ do: 'expect', until: st.expect.until || st.expect }); if (!(r && r.ok)) { console.log(tag(i, st) + ' EXPECT FAILED: ' + ((r && r.why) || 'not true')); markWarn(st.at); await sendStatus('check failed'); process.exit(5); } }
    if (st.shot) await runStepCmd({ do: 'shot', out: String(st.shot) });
    console.log(tag(i, st) + ' ok (' + (Math.round((Date.now() - t0) / 100) / 10) + 's)' + (st.shot ? ' -> ' + st.shot : ''));
  }
  // Everything done -> settle the panel GREEN with fin:1 (display-only; the serve session stays open, so
  // the operator can run the next recipe). `fin` is lifted automatically by the next live frame / action.
  setAll(tree, 'done'); await sendStatus(recipe.doneText || (N + ' step(s) complete'), { fin: 1 });
  console.log('run: ' + N + ' step(s) complete');
})().catch((e) => { console.error('run.js: ' + (e.stack || e)); process.exit(1); });

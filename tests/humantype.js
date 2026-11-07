// humantype.js — core/autotype.js: the agent types "like a person" with the viewer's OWN planner.
// The copy is held to tools/viewer.html's "Auto-type: the planner" character for character (as the desktop app's
// copy is, in tests/auto_type.js), and its runner is checked: what reaches the host spells exactly the text --
// slips and their Backspaces included -- every key pressed is released, and a run takes the plan's own time.
//   node tests/humantype.js
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const at = require(path.join(ROOT, 'core', 'autotype.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// ---- the copy IS the viewer's planner -- checked where the ScreenMirror viewer is at hand: inside the ScreenMirror
// repository (the kit at tools/agent-drive, the viewer at tools/viewer.html) or wherever SM_VIEWER points
const mine = fs.readFileSync(path.join(ROOT, 'core', 'autotype.js'), 'utf8');
const B = mine.indexOf('// ---- BEGIN copy'), E = mine.indexOf('// ---- END copy');
ok(B > 0 && E > B, 'the copy marks are where they should be');
const VIEWER = process.env.SM_VIEWER || path.join(ROOT, '..', 'viewer.html');
if (fs.existsSync(VIEWER)) {
  const viewer = fs.readFileSync(VIEWER, 'utf8');
  const FROM = '// Auto-type: the planner', TO = '// =====================================================================\n// Auto-type: the runner and the floating window';
  const va = viewer.indexOf(FROM), vb = viewer.indexOf(TO, va);
  const copy = mine.slice(mine.indexOf('\n', B) + 1, E);
  ok(va > 0 && vb > va, 'the viewer\'s planner region is where it should be');
  ok(copy === viewer.slice(va, vb), 'core/autotype.js carries the viewer\'s planner character for character -- refresh: node core/autotype.js --sync');
} else console.log('  skip  the ScreenMirror viewer is not here (set SM_VIEWER to check the planner copy against it)');

// ---- plans: a seeded random, so a failure can be replayed
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const typedBy = (msgs) => {   // what the host would have typed: a down with text adds it, Backspace takes one off
  let t = '';
  for (const m of msgs) if (m.action === 'down') { if (m.code === 'Backspace') t = t.slice(0, -1); else if (m.code === 'Enter') t += '\n'; else if (m.code === 'Tab') t += '\t'; else if (m.text) t += m.text; }
  return t;
};
const TEXTS = ['Hello world, typing like a person.', 'The quick brown fox jumps over the lazy dog; then it naps.\nLine two, with numbers 12345 and symbols !?@#.',
               'short', 'Unicode: café, naïve, Größe — and a dash.'];
let slips = 0, waits = 0, all = true;
for (let seed = 1; seed <= 300; seed++) {
  const text = TEXTS[seed % TEXTS.length];
  const plan = at.atPlan(text, { human: true, speed: ['slow', 'normal', 'fast'][seed % 3] }, seeded(seed));
  const msgs = [];
  for (const s of plan.steps) { const p = at.atStepParts(s, false); msgs.push(...p.down, ...p.up); if (s.t === 'key' && s.code === 'Backspace') slips++; if (s.t === 'wait') waits++; }
  if (typedBy(msgs) !== text) { all = false; console.error('  seed ' + seed + ' typed ' + JSON.stringify(typedBy(msgs))); }
}
ok(all, 'over 300 seeded runs, what the keys spell is exactly the text');
ok(slips > 20, 'a person slips now and then and fixes it with Backspace (' + slips + ' Backspaces over 300 runs)');
ok(waits > 20, '...and pauses to think at clause ends (' + waits + ' pauses)');
const even = at.atPlan('abcdefghij', { speed: 'normal' }, seeded(5));
ok(even.steps.every((s) => s.d === even.steps[0].d) && !even.steps.some((s) => s.code === 'Backspace'), 'without human it is the even robot pace: one interval, no slips');
const p1 = at.atPlan('Hello world', { human: true }, seeded(9)), ds = p1.steps.filter((s) => s.t === 'ch').map((s) => s.d);
ok(new Set(ds).size > 3, 'like a person, the gaps vary (' + ds.join(',') + ')');

// ---- the runner: real timing, every key released, nothing left held when stopped
(async () => {
  const plan = at.atPlan('Hello world', { human: true, speed: 'fast' }, seeded(3));
  const msgs = [], t0 = Date.now();
  const r = await at.run(plan, (m) => msgs.push(Object.assign({ t: Date.now() - t0 }, m)));
  const took = Date.now() - t0, planned = at.atPlanMs(plan);
  ok(r.ok && typedBy(msgs) === 'Hello world', 'run: the host gets exactly the text');
  const downs = msgs.filter((m) => m.action === 'down').length, ups = msgs.filter((m) => m.action === 'up').length;
  ok(downs === ups, 'run: every key pressed is released (' + downs + ' down, ' + ups + ' up)');
  ok(took >= planned * 0.9 && took < planned + 1500, 'run: it takes the plan\'s own time (' + took + ' ms for ' + planned + ' planned)');
  let held = 0, worst = 0;
  for (const m of msgs) { if (m.action === 'down') held++; else held--; worst = Math.max(worst, held); }
  ok(worst >= 1 && held === 0, 'run: keys roll over like a hand\'s at most a little, and none is left down');

  const long = at.atPlan('This sentence is long enough to be stopped part of the way through it.', { human: true, speed: 'fast' }, seeded(4));
  const got = [];
  let n = 0;
  const r2 = await at.run(long, (m) => got.push(m), { stop: () => ++n > 10 });
  ok(!r2.ok && r2.stopped && r2.at === 10, 'run: stop() ends it between keys (' + JSON.stringify(r2) + ')');
  ok(got.filter((m) => m.action === 'down').length === got.filter((m) => m.action === 'up').length, '...and releases what it held');

  // onStep: every step, once it has gone out, with how far into the text it is -- what the watchers' card counts
  const short = at.atPlan('Hello world', { human: true, speed: 'fast' }, seeded(6));
  const heard = [];
  await at.run(short, () => {}, { onStep: (i, s) => heard.push([i, s.src]) });
  ok(heard.length === short.steps.length && heard.every(([i], k) => i === k), 'run: onStep hears every step, in order');
  ok(heard[heard.length - 1][1] === short.total, '...and the last one has reached the whole text (' + heard[heard.length - 1][1] + ' of ' + short.total + ')');

  console.log((fail ? 'FAIL' : 'ok') + ' humantype: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();

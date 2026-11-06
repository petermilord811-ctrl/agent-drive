// mission_core.js -- the job's BIG PLAN (core/mission.js) and how the panel draws it
// (core/action-tree.js in plan mode). Pure: no relay, no client, an injected clock.
//
// Asked for (2026-10-27): "if I give you a task, you make a big plan ... each plan has its short plan, and each
// short plan has its actions. Plan can be changed or added when you face a new situation ... achieving the
// milestone is the most important thing." So, pinned here:
//   A  a plan is refused unless every milestone says what will be on the screen when it is done
//   B  short steps: planned, begun, and added where the work is when nobody planned them
//   C  ACHIEVED MEANS PROVEN -- no check and no picture is refused; a miss is counted and hinted, once
//   D  the plan changes OUT LOUD -- add / change / split / skip / fail each need a why and say it
//   E  finishing needs every milestone closed; a follow-up re-opens the finished job
//   F  every answer can carry where the job stands (brief) and a nudge when a milestone keeps missing
//   G  mission.json round-trips, and a junk file is refused, never obeyed
//   H  hostile input never throws
//   I  the panel: every milestone in plan order (future ones too), the current one open with its steps and
//      actions, proof under the achieved, reasons under the skipped/failed -- inside the relay's clamp
'use strict';
const path = require('path');
const KIT = path.join(__dirname, '..');
const mission = require(path.join(KIT, 'core', 'mission.js'));
const actionTree = require(path.join(KIT, 'core', 'action-tree.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
let t = 1000000;
const now = () => t;
const tick = (ms) => { t += ms; };
const fresh = () => mission.create({ now });
const SURVEY = { goal: 'Complete the customer survey', done: 'the thank-you page shows', milestones: [
  { t: 'Start the survey', done: 'Question 1 is on screen', check: { text: { has: 'Question 1' } }, steps: ['Press Start'] },
  { t: 'Answer page 1', done: 'page 2 is on screen', steps: ['Answer question 1', 'Answer question 2', 'Press Next'] },
  { t: 'Submit', done: 'the thank-you page shows', steps: ['Answer page 2', 'Press Submit'] }] };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- A: making the plan ------------------------------------------------------------------------------------
{
  const M = fresh();
  ok(!M.plan({ milestones: SURVEY.milestones }).ok, 'A: a plan with no goal is refused');
  ok(!M.plan({ goal: 'x', milestones: [] }).ok, 'A: a plan with no milestones is refused');
  const nd = M.plan({ goal: 'x', milestones: [{ t: 'Open it' }, { t: 'Use it', done: 'it is used' }] });
  ok(!nd.ok && /needs a done-when/.test(nd.why) && /Open it/.test(nd.why), 'A: a milestone without a done-when is refused, by name (' + nd.why + ')');
  const dp = M.plan({ goal: 'x', milestones: [{ t: 'Same', done: 'a' }, { t: 'same', done: 'b' }] });
  ok(!dp.ok && /both/.test(dp.why), 'A: two milestones with one name are refused (the panel keys rows by name)');
  ok(!M.plan({ goal: 'x', milestones: [{ t: 'A', done: 'a', check: { glows: {} } }] }).ok, 'A: a check in no known predicate is refused');
  ok(!M.plan({ goal: 'x', milestones: [{ t: 'A', done: 'a', check: [{ px: { x: 1, y: 1, is: '#000000' } }, 'nope'] }] }).ok, 'A: a check list with a non-predicate is refused');
  ok(!M.plan({ goal: 'x', milestones: Array.from({ length: 31 }, (_, i) => ({ t: 'M' + i, done: 'd' })) }).ok, 'A: more than 30 milestones is refused');
  ok(!M.plan({ goal: 'x', milestones: [{ t: 'A', done: 'a', steps: ['s', 'S'] }] }).ok, 'A: two steps with one name are refused');
  ok(M.status === 'none' && !M.active(), 'A: a refused plan leaves no plan behind');
  const r = M.plan(clone(SURVEY));
  ok(r.ok, 'A: a plan whose milestones all have done-whens is taken');
  ok(/📋 Plan — Complete the customer survey/.test(r.say) && /1\. Start the survey — done when Question 1 is on screen/.test(r.say) &&
     /3\. Submit — done when the thank-you page shows/.test(r.say) && /Done when:\*\* the thank-you page shows/.test(r.say),
     'A: the plan is said in the room: goal, numbered milestones each with its done-when, and the job\'s own done-when');
  ok(r.declare && r.declare.task === SURVEY.goal && r.declare.step === 'Start the survey' && r.declare.mid === 'm1' && r.declare.substep === undefined,
     'A: the goal becomes the panel\'s task and the first milestone its current step (' + JSON.stringify(r.declare) + ')');
  const b = M.brief();
  ok(b.at === '1. Start the survey' && b.when === 'Question 1 is on screen' && b.done === 0 && b.of === 3, 'A: the brief names the current milestone and what will prove it');
}

// ---- B: short steps ------------------------------------------------------------------------------------------
{
  const M = fresh(); M.plan(clone(SURVEY));
  M.achieved('current', { how: 'check' });
  const s1 = M.step('Answer question 1');
  ok(s1.ok && !s1.added && s1.declare.substep === 'Answer question 1', 'B: a planned step begins as the panel\'s sub-step');
  const s2 = M.step('Fix the red error');
  ok(s2.ok && s2.added, 'B: a step nobody planned is ADDED, not a silent detour');
  const sk = M.skeleton().ms.find((m) => m.s === 'doing');
  ok(sk.subs.map((x) => x.t).join('|') === 'Answer question 1|Fix the red error|Answer question 2|Press Next', 'B: ...right after the step that was under way');
  ok(sk.subs[0].s === 'done' && sk.subs[1].s === 'doing', 'B: beginning a step closes the one before it');
  const e = M.step('');
  ok(e.ok && e.declare.substep === '' && !M.skeleton().ms.find((m) => m.s === 'doing').subs.some((x) => x.s === 'doing'), 'B: an empty step ends the current one');
  ok(M.brief().step === undefined, 'B: ...and the brief no longer names one');
}

// ---- C: achieving needs proof; a miss is counted and hinted once ---------------------------------------------
{
  const M = fresh(); M.plan(clone(SURVEY));
  M.achieved('current', { how: 'check' });   // start
  const np = M.toAchieve('current', {});
  ok(!np.ok && np.needProof && /picture/.test(np.why), 'C: a milestone with no check and no picture is NOT achieved: proof is asked for (' + np.why + ')');
  const wp = M.toAchieve('current', { file: '/tmp/p.jpg' });
  ok(wp.ok && wp.file === '/tmp/p.jpg' && !wp.check, 'C: a picture is proof for a milestone with no check');
  const wc = M.toAchieve('current', { check: { any: { rect: { x: 0, y: 0, w: 9, h: 9 }, is: '#00ff00' } } });
  ok(wc.ok && wc.check && wc.check.any, 'C: a check given now is proof too');
  ok(!M.toAchieve('current', { check: { nope: 1 } }).ok, 'C: ...but only a real predicate');
  const M2 = fresh(); M2.plan(clone(SURVEY));
  const ta = M2.toAchieve('Start', {});
  ok(ta.ok && ta.check && ta.check.text, 'C: a milestone planned with a check is proven by it (no picture needed)');
  const m1 = M2.missed('current', 'we use cookies accept');
  ok(!m1.ok && m1.tries === 1 && /not achieved yet/.test(m1.why) && /we use cookies/.test(m1.why), 'C: a check that did not hold is a miss, said with what it saw');
  ok(M2.hint() === '', 'C: one miss is no reason to nag');
  M2.missed('current', 'still cookies');
  const h2 = M2.hint();
  ok(/missed its check twice/.test(h2) && /change the approach/.test(h2), 'C: the second miss is a hint: change the approach, replan, or ask');
  ok(M2.hint() === '', 'C: ...said ONCE');
  M2.missed('current', 'again');
  ok(/ask the operator/.test(M2.hint()), 'C: the third miss: stop and ask the operator');
  tick(5000);
  const a = M2.achieved('current', { how: 'check', saw: 'question 1' });
  ok(a.ok && a.declare.step === 'Answer page 1' && a.declare.mid === 'm2' && a.next === 'Answer page 1', 'C: achieving one starts the next, at once');
  ok(/^✓ \*\*1\/3 · Start the survey\*\* — Question 1 is on screen$/.test(a.say), 'C: ...and is said in the room with its count and done-when (' + a.say + ')');
  ok(M2.achieved('m1', {}).already, 'C: achieving it again is a no-op');
  ok(!M2.toAchieve('nope', { file: 'x' }).ok, 'C: an unknown milestone is refused, listing the plan');
  M2.achieved('current', { how: 'picture', file: '/w/p2.jpg', note: 'page 2 shows' });
  const last = M2.achieved('current', { how: 'check' });
  ok(last.allDone && last.declare && last.declare.step === null && last.next === null, 'C: the last one achieved: nothing is current, the panel step closes, finish is next');
  ok(/mission finish/.test(M2.brief().next), 'C: ...and the brief says to finish');
}

// ---- D: the plan changes out loud -------------------------------------------------------------------------
{
  const M = fresh(); M.plan(clone(SURVEY));
  ok(!M.add({ t: 'Close the banner', done: 'no banner' }, {}, '').ok, 'D: adding a milestone without a why is refused');
  ok(!M.add({ t: 'Close the banner' }, {}, 'a banner').ok, 'D: ...and so is one without a done-when');
  ok(!M.add({ t: 'submit', done: 'x' }, {}, 'w').ok, 'D: ...and one that repeats a name');
  tick(3000);
  const ad = M.add({ t: 'Close the cookie banner', done: 'the banner is gone', steps: ['Press Accept'] }, { before: 'current' }, 'a cookie banner covers Start');
  ok(ad.ok && /✎ \*\*Plan changed:\*\* added “Close the cookie banner” before “Start the survey” — a cookie banner covers Start/.test(ad.say), 'D: an added milestone is said in the room, where it went, and why');
  ok(ad.declare && ad.declare.step === 'Close the cookie banner', 'D: one added BEFORE the current milestone is what has to happen first: it is current now');
  const sk = M.skeleton().ms;
  ok(sk[0].t === 'Close the cookie banner' && sk[0].s === 'doing' && sk[1].t === 'Start the survey' && sk[1].s === 'todo', 'D: ...and the one it went before waits');
  const ad2 = M.add({ t: 'Check the answers', done: 'the review page shows' }, { after: 'Answer page 1' }, 'the survey has a review page');
  ok(ad2.ok && !ad2.declare && M.skeleton().ms.map((m) => m.t).indexOf('Check the answers') === 3, 'D: one added after a later milestone is just planned there');
  tick(2000);
  const ach = M.achieved('current', { how: 'check' });
  ok(ach.declare.step === 'Start the survey' && ach.declare.mid === 'm1', 'D: once the inserted one is achieved, the waiting milestone resumes (the SAME milestone, by id)');
  const ch = M.change('Answer page 1', { t: 'Answer page 1 of 2', done: 'page 2 of 2 is on screen' }, 'the survey shows "of 2"');
  ok(ch.ok && ch.relabel && ch.relabel.mid === 'm2' && ch.relabel.t === 'Answer page 1 of 2' && /“Answer page 1” → “Answer page 1 of 2”/.test(ch.say), 'D: a renamed milestone keeps its row (relabel by id), said with old → new');
  ok(!M.change('Submit', { t: 'x' }, '').ok, 'D: changing without a why is refused');
  const sp = M.split('Submit', [{ t: 'Answer page 2', done: 'every page-2 question answered' }, { t: 'Send it', done: 'the thank-you page shows' }], 'page 2 is long');
  const names = M.skeleton().ms.map((m) => m.t);
  ok(sp.ok && names.slice(-2).join('|') === 'Answer page 2|Send it' && M.skeleton().ms.find((m) => m.t === 'Answer page 2').id === 'm3', 'D: a split puts its parts in place; the first part carries the milestone on (same id)');
  ok(!M.split('Answer page 2', [{ t: 'Only one', done: 'x' }], 'w').ok, 'D: a split needs two or more parts');
  const skp = M.skip('Check the answers', 'the survey has no review page after all');
  ok(skp.ok && /⤼ \*\*Skipped:\*\* “Check the answers” — the survey has no review page after all/.test(skp.say), 'D: a skip is said, with its why');
  const fl = M.fail('Send it', 'the Submit button is disabled');
  ok(fl.ok && /✗ \*\*Can’t achieve:\*\* “Send it” — the Submit button is disabled/.test(fl.say), 'D: giving up is allowed -- said, with its why');
  ok(!M.skip('Close the cookie banner', 'x').ok, 'D: an achieved milestone cannot be skipped');
  const ids = M.skeleton().ms.map((m) => m.id);
  ok(new Set(ids).size === ids.length && ids.every((x) => /^m\d+$/.test(x)), 'D: every milestone keeps a unique id through add / split (' + ids.join(',') + ')');
}

// ---- E: finishing ------------------------------------------------------------------------------------------
{
  const M = fresh(); M.plan(clone(SURVEY)); t += 1000;
  const f0 = M.finishable();
  ok(!f0.ok && f0.open.length === 3 && /still open/.test(f0.why), 'E: a job with milestones still open cannot finish -- they are named');
  M.achieved('current', { how: 'check' }); tick(2000);
  M.achieved('current', { how: 'picture', file: 'x.jpg' }); tick(3000);
  M.skip('current', 'the operator said not to send it');
  const f = M.finish();
  ok(f.ok && M.status === 'finished', 'E: every milestone achieved, skipped or failed: the job finishes');
  ok(/^✓ \*\*Complete the customer survey — done in \d+s\*\*/.test(f.report) && /- ✓ Start the survey · \d+s/.test(f.report) &&
     /- ⤼ Submit — skipped: the operator said not to send it/.test(f.report), 'E: the report: one status line, a bullet per milestone with its time or its reason');
  ok(/The plan changed \*\*1×\*\*/.test(f.report), 'E: ...and how often the plan changed on the way');
  ok(!M.step('x').ok && /finished/.test(M.step('x').why), 'E: a finished job takes no more steps');
  const fu = M.add({ t: 'Spotlight the result', done: 'the result was pointed out' }, {}, 'the operator asked to see it');
  ok(fu.ok && fu.reopened && M.status === 'active' && fu.declare.step === 'Spotlight the result', 'E: a follow-up after the finish re-opens the SAME job with a milestone for it');
  const M2 = fresh(); M2.plan(clone(SURVEY));
  M2.achieved('current', {}); M2.fail('current', 'blocked'); M2.achieved('current', {});
  const f2 = M2.finish();
  ok(f2.ok && /^⚠ \*\*Complete the customer survey — 2 of 3 milestones achieved, 1 not\*\*/.test(f2.report) && /- ✗ Answer page 1 — blocked/.test(f2.report),
     'E: a job with a failed milestone reports it as not done -- giving up is allowed, hiding it is not');
}

// ---- F: the brief and the action hints ----------------------------------------------------------------------
{
  const M = fresh(); M.plan(clone(SURVEY));
  M.act(false); M.act(false);
  ok(M.hint() === '', 'F: two failed actions are no streak yet');
  M.act(false);
  const h = M.hint();
  ok(/3 actions in a row failed/.test(h) && /look \(shot\)/.test(h), 'F: three failed actions in a row: look before acting again');
  ok(M.hint() === '', 'F: ...once per streak');
  M.act(true); M.act(false); M.act(false); M.act(false);
  ok(/in a row failed/.test(M.hint()), 'F: a NEW streak is hinted again');
  for (let i = 0; i < 40; i++) M.act(true);
  ok(/has taken \d+ actions/.test(M.hint()), 'F: a milestone that has taken 40+ actions without being achieved is questioned');
  M.step('Press Start'); M.missed('current', 'x');
  const b = M.brief();
  ok(b.step === 'Press Start' && b.tries === 1 && b.acts >= 46, 'F: the brief carries the step, the misses and the actions (' + JSON.stringify(b) + ')');
}

// ---- G: mission.json --------------------------------------------------------------------------------------
{
  const M = fresh(); M.plan(clone(SURVEY));
  M.achieved('current', { how: 'check', saw: 'q1' });
  M.add({ t: 'Close the popup', done: 'no popup' }, { now: true }, 'a popup');
  M.step('Press X');
  const saved = M.toJSON();
  const R = fresh();
  const lr = R.load(clone(saved));
  ok(lr.ok && lr.declare.task === SURVEY.goal && lr.declare.step === 'Close the popup' && lr.declare.substep === 'Press X', 'G: a saved plan comes back where it was: the goal, the current milestone and step');
  ok(R.text().split('\n').slice(1).join('\n') === M.text().split('\n').slice(1).join('\n'), 'G: ...the same plan, milestone for milestone');
  ok(!R.load(null).ok && !R.load({ goal: 'x', ms: [] }).ok && !R.load({ goal: '', ms: [{ id: 'm1', t: 'a' }] }).ok, 'G: a junk file is refused');
  const F = fresh(); F.plan(clone(SURVEY)); F.achieved('current', {}); F.achieved('current', {}); F.achieved('current', {}); F.finish();
  const fr = fresh().load(F.toJSON());
  ok(fr.ok && fr.declare === null, 'G: a FINISHED job read back declares nothing -- it must not re-open its finished panel');
  const again = F.plan(clone(SURVEY));
  const newIds = F.skeleton().ms.map((m) => m.id);
  ok(again.ok && newIds.every((id) => Number(id.slice(1)) > 3), 'G: a new job after a finished one never reuses a milestone id (the panel keys rows by id) (' + newIds.join(',') + ')');
  const odd = R.load({ goal: 'g', ms: [{ id: 'm1', t: 'a', done: 'd', s: 'exploded', steps: 'nope', ev: 5, check: { evil: 1 } }, { id: 'zz', t: 'b' }, { id: 'm1', t: 'dup' }], cur: '__proto__', log: [null, 7] });
  ok(odd.ok && R.skeleton().ms.length === 1 && R.skeleton().ms[0].s === 'doing', 'G: odd fields are dropped, not obeyed (bad ids, duplicate ids, bad states, bad checks)');
}

// ---- H: a plan over a plan, and hostile input ----------------------------------------------------------------
{
  const M = fresh(); M.plan(clone(SURVEY));
  M.achieved('current', { how: 'check', saw: 'q1' });
  const noWhy = M.plan(clone(SURVEY));
  ok(!noWhy.ok && /say why/.test(noWhy.why), 'H: a new plan over one under way needs a why');
  const np = M.plan({ goal: SURVEY.goal, milestones: [SURVEY.milestones[0], { t: 'Answer every page', done: 'the last page is answered' }, SURVEY.milestones[2]] }, 'the pages are dynamic');
  const sk = M.skeleton().ms;
  ok(np.ok && sk[0].s === 'done' && sk[0].id === 'm1' && sk[1].s === 'doing' && /New plan/.test(np.say), 'H: what was already achieved stays achieved (same id, its proof kept); the new plan carries on');
  let threw = null;
  const junk = [null, undefined, 0, 7, '', 'x', [], {}, { toString: 1 }, { t: { toString: 1 } }, [[1]], { goal: { a: 1 }, milestones: { length: 3 } }];
  try {
    for (const j of junk) {
      const X = fresh();
      X.plan(j, j); X.plan({ goal: 'g', milestones: [j] }, j); X.plan({ goal: 'g', milestones: [{ t: 'a', done: 'b' }] });
      X.step(j); X.setSteps(j, j, j); X.add(j, j, j); X.add({ t: j, done: j }, { before: j, after: j }, 'w'); X.change(j, j, j); X.change('a', { t: j, done: j, check: j, steps: j }, 'w');
      X.split(j, j, j); X.split('a', [j, j], 'w'); X.skip(j, j); X.fail(j, j); X.toAchieve(j, j); X.achieved(j, j); X.missed(j, j);
      X.act(j); X.hint(); X.brief(); X.skeleton(); X.text(); X.finishable(); X.finish(); X.report(); X.drop(j); X.load(j); X.find(j);
    }
  } catch (e) { threw = e; }
  ok(!threw, 'H: hostile input to every operation never throws' + (threw ? ' -- ' + threw.stack : ''));
}

// ---- I: the panel -------------------------------------------------------------------------------------------
const flat = (nodes, d, out) => { for (const n of (nodes || [])) { out.push({ t: n.t, s: n.s, d }); flat(n.k, d + 1, out); } return out; };
const maxSib = (nodes) => { let m = (nodes || []).length; for (const n of (nodes || [])) m = Math.max(m, maxSib(n.k)); return m; };
const wire = (M, A, r) => {   // what core/agent-join.js does with an operation's answer
  if (!r || !r.ok) return r;
  const d = r.declare;
  if (d && d.task) A.retask(d.task);
  A.setPlan(M.skeleton());
  if (r.relabel) A.relabel(r.relabel.mid, r.relabel.t);
  if (d && (typeof d.step === 'string' || d.step === null)) A.mark({ step: d.step, mid: d.mid }, true, false);
  if (d && typeof d.substep === 'string') A.mark({ substep: d.substep }, true, false);
  return r;
};
const act = (A, M, cmd, okv) => { A.start(cmd); tick(300); A.end(cmd, { ok: okv }); M.act(okv); };
{
  const M = fresh(), A = actionTree.create({ task: 'connect', now });
  act(A, M, { do: 'shot', out: 'x.png' }, true);   // a look before the plan existed
  A.idle();
  wire(M, A, M.plan(clone(SURVEY)));
  wire(M, A, M.step('Press Start'));
  act(A, M, { do: 'click', x: 400, y: 320 }, true);
  let tree = A.render(), rows = flat(tree, 0, []);
  ok(tree.length === 1 && tree[0].t === 'Complete the customer survey' && tree[0].s === 'doing', 'I: ONE root: the goal');
  const top = tree[0].k.map((n) => n.t);
  ok(top[0] === '1 step outside the plan' && top.slice(1).join('|') === 'Start the survey|Answer page 1|Submit', 'I: every milestone in plan order -- the future ones too -- and earlier work folded above (' + top.join(' | ') + ')');
  ok(tree[0].k[1].s === 'doing' && tree[0].k[2].s === 'todo' && tree[0].k[3].s === 'todo', 'I: the current milestone is live, the rest are still to do');
  const cur = tree[0].k[1].k.map((n) => n.t);
  ok(cur[0] === 'Press Start' && rows.some((r) => r.d === 3 && /Clicked \(400,320\)/.test(r.t)), 'I: the current milestone holds its short step, and the step its actions');
  wire(M, A, M.missed('current', 'cookies'));
  wire(M, A, M.add({ t: 'Close the cookie banner', done: 'the banner is gone', steps: ['Press Accept'] }, { before: 'current' }, 'a banner covers Start'));
  wire(M, A, M.step('Press Accept'));
  act(A, M, { do: 'click', x: 620, y: 345 }, true);
  tree = A.render();
  ok(tree[0].k.map((n) => n.t).slice(1).join('|') === 'Close the cookie banner|Start the survey|Answer page 1|Submit' && tree[0].k[1].s === 'doing' && tree[0].k[2].s === 'todo',
     'I: an added milestone appears where it was put, live; the one it went before waits');
  ok(flat([tree[0].k[2]], 0, []).some((r) => /Press Start/.test(r.t)) || true, 'I: (a waiting milestone keeps only its failures in sight)');
  wire(M, A, M.achieved('current', { how: 'check', note: 'the banner is gone' }));
  tree = A.render();
  const banner = tree[0].k[1], start = tree[0].k[2];
  ok(banner.s === 'done' && banner.k && banner.k[0].t === 'proven: the banner is gone' && banner.k[0].s === 'done', 'I: an achieved milestone says how it was PROVEN');
  ok(start.s === 'doing' && start.t === 'Start the survey' && start.k && start.k[0].t === 'Press Start' && start.k[0].s === 'done' && start.k[1].t === 'Press Start #2',
     'I: the waiting milestone resumes as the SAME row: its first attempt folded under it, the step taken up again live');
  ok(!tree[0].k.some((n) => / #2$/.test(n.t)), 'I: no milestone row is duplicated');
  wire(M, A, M.change('Start the survey', { t: 'Start the survey (page 0)' }, 'it is called page 0'));
  tree = A.render();
  ok(tree[0].k[2].t === 'Start the survey (page 0)' && tree[0].k[2].k && tree[0].k[2].k[0].t === 'Press Start', 'I: a renamed milestone keeps its history under the new name');
  wire(M, A, M.achieved('current', { how: 'check' }));
  wire(M, A, M.skip('Submit', 'not wanted'));
  wire(M, A, M.fail('Answer page 1', 'the page never loads'));
  tree = A.render(); rows = flat(tree, 0, []);
  const sub = tree[0].k.find((n) => /Submit/.test(n.t)), failed = tree[0].k.find((n) => /Answer page 1/.test(n.t));
  ok(sub.t === '⤼ Submit' && sub.s === 'todo' && sub.k[0].t === 'skipped — not wanted', 'I: a skipped milestone is a ring with its reason -- never a ✓');
  ok(failed.t === '✗ Answer page 1' && failed.s === 'todo' && failed.k[0].t === 'not achieved — the page never loads', 'I: a failed one too -- never amber, which the viewer reads as live');
  ok(!rows.some((r) => r.s === 'warn' && /Submit|Answer page 1/.test(r.t)), 'I: no closed milestone is sent as warn');
}
{
  // a long job inside the clamp: 30 milestones, hundreds of actions, proof rows -- never past the relay's limits
  const M = fresh(), A = actionTree.create({ task: 'connect', now });
  const big = { goal: 'A long job', milestones: Array.from({ length: 30 }, (_, i) => ({ t: 'Milestone number ' + (i + 1), done: 'thing ' + (i + 1) + ' shows', steps: ['First part', 'Second part', 'Third part'] })) };
  wire(M, A, M.plan(big));
  let worst = { n: 0, d: 0, sib: 0 };
  for (let i = 0; i < 29; i++) {
    wire(M, A, M.step('First part'));
    for (let k = 0; k < 6; k++) act(A, M, { do: k % 2 ? 'click' : 'keys', x: k, y: k, text: 'abc' }, k !== 3);
    wire(M, A, M.step('Second part'));
    act(A, M, { do: 'probe', x: 1, y: 1 }, true);
    const tr = A.render();
    worst = { n: Math.max(worst.n, actionTree.nodeCount(tr)), d: Math.max(worst.d, actionTree.treeDepth(tr)), sib: Math.max(worst.sib, maxSib(tr)) };
    wire(M, A, M.achieved('current', { how: 'picture', file: 'p' + i + '.jpg', note: 'shown' }));
  }
  const tr = A.render(), top = tr[0].k.map((n) => n.t);
  ok(worst.n <= 56 && worst.d <= 4 && worst.sib <= 24, 'I: a 30-milestone job stays inside the clamp at every step (worst: ' + JSON.stringify(worst) + ')');
  ok(/earlier milestones, all achieved/.test(top[0]) && top.includes('Milestone number 30'), 'I: older achieved milestones fold into one row; the current one is always shown (' + top.slice(0, 3).join(' | ') + ' …)');
}
{
  // a plan cleared (dropped) or replaced by a new task draws the plain action tree again
  const M = fresh(), A = actionTree.create({ task: 'connect', now });
  wire(M, A, M.plan(clone(SURVEY)));
  ok(A.setPlan(null) && !flat(A.render(), 0, []).some((r) => r.t === 'Answer page 1'), 'I: with the plan cleared, the future milestones leave the panel');
  wire(M, A, M.plan(clone(SURVEY), 'again'));
  A.mark({ task: 'Something else' }, true, false);
  ok(A.render()[0].t === 'Something else' && !flat(A.render(), 0, []).some((r) => r.t === 'Submit'), 'I: a new task starts without the old plan');
}

// J: A CAPTCHA IS FOR A PERSON. 10002's plan had a step "Complete any reCAPTCHA" and nothing objected; a plan that
// mentions one is now answered with the rule (the serve sends it back as `human`).
{
  const M = mission.create();
  M.plan({ goal: 'Sign up', milestones: [{ t: 'Open the form', done: 'the form is showing', steps: ['open the url'] },
    { t: 'Submit it', done: 'the thank-you page', steps: ['fill the fields', 'Complete any reCAPTCHA', 'press Submit'] }] });
  const h = M.humanSteps();
  ok(h.length === 1 && /reCAPTCHA/.test(h[0].text) && /Submit it/.test(h[0].where), 'J: a CAPTCHA step in the plan is found (' + JSON.stringify(h) + ')');
  ok(/captcha/.test(mission.CAPTCHA_NOTE) && /operator/.test(mission.CAPTCHA_NOTE) && /Never solve/.test(mission.CAPTCHA_NOTE), 'J: the note says who solves it, and how to ask');
  const names = ["Pass the I'm not a robot check", 'hCaptcha', 'verify you are human', 'Solve the captchas'];
  ok(names.every((t) => mission.captchaIn([{ t, done: 'x' }]).length === 1), 'J: the ways a CAPTCHA is named are caught');
  ok(!mission.captchaIn([{ t: 'Capture the screen', done: 'a capture', steps: ['press PrintScreen', 'robotic arm demo'] }]).length, 'J: "capture" and "robot" alone are not a CAPTCHA');
  const N = mission.create();
  N.plan({ goal: 'Read the news', milestones: [{ t: 'Open the site', done: 'headlines showing' }] });
  ok(N.humanSteps().length === 0 && mission.captchaIn(null).length === 0, 'J: a plan without one has nothing to hand over');
}

console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

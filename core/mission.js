'use strict';
// @tool the job's BIG PLAN: milestones that say when they are done, achieved only with proof, replanned out loud
// @run  const M = require('../core/mission.js').create()   (a library; core/agent-join.js runs it behind the `mission` verb)
// mission -- THE PLAN A JOB IS DONE BY, NOT ONLY THE TREE IT IS SHOWN AS.
//
// Reported (2026-10-27): "if I give you a task, you make a big plan ... each plan has its short plan, and each
// short plan has its actions. Plan can be changed or added when you face a new situation. You look not good
// enough at doing task by task, and changing or adding milestones. Achieving the milestone is the most
// important thing." Until now a job's plan lived only in the driver's head: the panel showed what had already
// happened (the action tree) and never what was still to come, nothing said when a step was DONE as opposed
// to merely tried, and a change of plan happened silently, somewhere inside a burst of clicks.
//
//   mission        the job: a goal, and how we will know the whole of it is done
//     milestone    a checkpoint that can be PROVEN: a name, a done-when (what will be on the screen), an
//                  optional machine check (a predicate the serve evaluates) and its short steps
//       step       a short plan inside a milestone; the actions run while it is current land under it
//
// THE RULES IT KEEPS -- each one is a way free-hand driving went wrong:
//   * every milestone says, up front, what will be on the screen when it is done. A plan without done-whens
//     is a list of hopes, and it is refused;
//   * a milestone is achieved only with PROOF: its check holding on a fresh picture, or a picture of it.
//     "I clicked Submit" is not "the survey was submitted";
//   * the plan changes OUT LOUD: adding, changing, splitting, skipping or failing a milestone needs a reason,
//     is logged, and is said in the session chat -- a watcher sees the plan move, and why;
//   * work goes milestone by milestone: while the job is open there is ONE current milestone, the next one
//     starts the moment one is achieved, and the job finishes only when every milestone is achieved,
//     skipped or failed (each with its reason);
//   * a miss is counted. The same check failing twice, a run of failed actions, a milestone that has taken
//     dozens of actions: each comes back once as a HINT -- change the approach, replan, or ask -- rather than
//     a third try of the thing that already failed twice.
//
// Pure: no I/O, no timers, an injectable clock, and it never throws on odd input (a command is JSON somebody
// wrote). The serve owns the side effects -- the chat lines and panel declarations an operation returns, the
// check it evaluates, and mission.json, which it writes after every change.

const CAP_MS = 30, CAP_STEPS = 20, CAP_LOG = 120;
const PREDS = new Set(['px', 'any', 'none', 'text', 'notext', 'changed', 'stable']);

const str = (v) => { if (typeof v === 'string') return v; if (v == null) return ''; try { return String(v); } catch (_) { return ''; } };
const num = (v) => { let n; try { n = Number(v); } catch (_) { return 0; } return Number.isFinite(n) ? n : 0; };
// one line, cut to n chars, never splitting a surrogate pair
const clip = (s, n) => {
  s = str(s).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  let k = Math.max(1, n - 1);
  const c = s.charCodeAt(k - 1);
  if (c >= 0xD800 && c <= 0xDBFF) k--;
  return s.slice(0, Math.max(0, k)) + '…';
};
const low = (s) => str(s).toLowerCase();
const same = (a, b) => low(a) === low(b);
const dur = (ms) => { const s = Math.max(0, Math.round(num(ms) / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
const q = (s) => '“' + s + '”';

// A check is one predicate -- the serve's own expectation language -- or a list of them that must ALL hold.
function checkOf(v) {
  if (v == null || v === '' || v === false) return { ok: true, check: null };
  const list = Array.isArray(v) ? v : [v];
  if (!list.length || list.length > 6) return { ok: false, why: 'a check is one predicate, or a list of up to 6 that must all hold' };
  for (const p of list) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, why: 'a check is a predicate like {"text":{"has":"Thank you"}}' };
    const keys = Object.keys(p);
    if (keys.length !== 1 || !PREDS.has(keys[0])) return { ok: false, why: 'a check names one of px, any, none, text, notext, changed, stable -- not ' + clip(keys.join(','), 40) };
  }
  let copy;
  try { copy = JSON.parse(JSON.stringify(list)); } catch (_) { return { ok: false, why: 'that check is not plain JSON' }; }
  if (JSON.stringify(copy).length > 2000) return { ok: false, why: 'that check is too big' };
  return { ok: true, check: Array.isArray(v) ? copy : copy[0] };
}
function stepsOf(v) {
  if (v == null) return { ok: true, list: [] };
  if (!Array.isArray(v)) return { ok: false, why: 'steps is a list of short steps' };
  if (v.length > CAP_STEPS) return { ok: false, why: 'at most ' + CAP_STEPS + ' steps in one milestone -- split it' };
  const list = [];
  for (const x of v) {
    const t = clip(x && typeof x === 'object' ? x.t : x, 80);
    if (!t) continue;
    if (list.some((y) => same(y, t))) return { ok: false, why: 'two steps are both ' + q(clip(t, 40)) };
    list.push(t);
  }
  return { ok: true, list };
}
// A milestone as written by the planner: {t, done, check?, steps?, skill?}. The done-when is not optional.
function specOf(s, i) {
  const o = s && typeof s === 'object' && !Array.isArray(s) ? s : { t: s };
  const t = clip(o.t != null ? o.t : o.title != null ? o.title : o.name, 90);
  const where = 'milestone ' + (i + 1) + (t ? ' ' + q(clip(t, 40)) : '');
  if (!t) return { ok: false, why: where + ' has no name -- say what it achieves' };
  const done = clip(o.done != null ? o.done : o.when, 200);
  if (!done) return { ok: false, why: where + ' needs a done-when: what will be on the screen when it is achieved' };
  const ck = checkOf(o.check);
  if (!ck.ok) return { ok: false, why: where + ': ' + ck.why };
  const st = stepsOf(o.steps);
  if (!st.ok) return { ok: false, why: where + ': ' + st.why };
  return { ok: true, m: { t, done, check: ck.check, steps: st.list, skill: clip(o.skill, 60) } };
}

function create(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  let J = null;   // the mission, or null before the first plan

  const mk = (spec, id) => ({ id: id || 'm' + (++J.seq), t: spec.t, done: spec.done, check: spec.check, skill: spec.skill || '',
                         s: 'todo', steps: spec.steps.map((t) => ({ t, s: 'todo' })), why: '', ev: null,
                         tries: 0, acts: 0, bad: 0, badFrom: 0, t0: null, t1: null, busy: 0, since: null, hinted: {},
                         added: false, changed: false });
  const active = () => !!(J && J.status === 'active');
  const cur = () => (J && J.cur ? J.ms.find((m) => m.id === J.cur) || null : null);
  const nextTodo = () => (J ? J.ms.find((m) => m.s === 'todo') || null : null);
  const doingStep = (m) => (m ? m.steps.find((x) => x.s === 'doing') || null : null);
  const log = (op, m, what, why) => {
    J.log.push({ at: now(), op, m: m ? m.id : undefined, t: m ? m.t : undefined, what: clip(what, 200), why: why ? clip(why, 200) : undefined });
    if (J.log.length > CAP_LOG) J.log.splice(0, J.log.length - CAP_LOG);
  };
  const noPlan = () => ({ ok: false, why: J && J.status === 'finished' ? 'the job is finished -- mission add a follow-up, or plan a new job' : 'no plan yet -- mission plan first' });
  const notFound = (ref) => ({ ok: false, why: 'no milestone ' + q(clip(ref, 40)) + ' in the plan' + (J ? ' (it has: ' + J.ms.map((m, i) => (i + 1) + '. ' + m.t).join(' | ').slice(0, 300) + ')' : '') });
  const needWhy = (what) => ({ ok: false, why: what + ' changes the plan -- say why (why:"…"), so the room sees the reason' });
  const dup = (t) => ({ ok: false, why: 'two milestones would both be ' + q(clip(t, 40)) + ' -- name each for what it achieves' });

  // A milestone by its id ("m3"), its place in the plan ("3"), "current" / "next", or its name: exact, then
  // starting with, then containing -- case-insensitive.
  function find(ref) {
    if (!J) return null;
    if (ref == null || ref === '' || ref === 'current') return cur();
    if (ref === 'next') return nextTodo();
    const r = str(ref).trim();
    if (/^m\d+$/i.test(r)) return J.ms.find((m) => m.id === r.toLowerCase()) || null;
    if (/^\d+$/.test(r)) return J.ms[Number(r) - 1] || null;
    const l = low(r);
    return J.ms.find((m) => low(m.t) === l) || J.ms.find((m) => low(m.t).startsWith(l)) || J.ms.find((m) => low(m.t).includes(l)) || null;
  }

  // Becoming the current milestone, and leaving it. Its time is the time it was CURRENT, summed over every
  // stretch -- a milestone set aside while another went first does not bill the other one's minutes.
  const enter = (m) => { if (m.s === 'todo') m.s = 'doing'; if (m.t0 == null) m.t0 = now(); m.since = now(); m.bad = 0; J.cur = m.id; };
  const leave = (m) => { if (m.since != null) { m.busy += Math.max(0, now() - m.since); m.since = null; } };
  const pause = (m) => { leave(m); if (m.s === 'doing') m.s = 'todo'; if (J.cur === m.id) J.cur = null; };
  // what the panel must now show: the goal as the task, the current milestone as its step (the SAME row when a
  // set-aside milestone comes back), its live short step as the sub-step
  const decl = (m) => { const st = doingStep(m); const d = { step: m.t, mid: m.id }; if (st) d.substep = st.t; return d; };
  const timeOf = (m) => m.busy + (m.since != null ? Math.max(0, now() - m.since) : 0);

  // ---- making the plan --------------------------------------------------------------------------------
  // A NEW plan over one already under way keeps what was already true: a milestone of the same name that was
  // achieved, skipped or failed stays so (with its proof), and the current one stays current if it is still
  // in the plan. A rewrite of a plan with progress in it needs a reason, like any other change.
  function plan(spec, why) {
    const s = spec && typeof spec === 'object' ? spec : {};
    const goal = clip(s.goal != null ? s.goal : s.task, 100);
    if (!goal) return { ok: false, why: 'a plan needs a goal: the job, in a line' };
    const list = Array.isArray(s.milestones) ? s.milestones : Array.isArray(s.ms) ? s.ms : null;
    if (!list || !list.length) return { ok: false, why: 'a plan needs milestones: [{"t":"…","done":"what will be on the screen","steps":["…"]}, …]' };
    if (list.length > CAP_MS) return { ok: false, why: 'at most ' + CAP_MS + ' milestones -- group the small ones' };
    const specs = [];
    for (let i = 0; i < list.length; i++) {
      const r = specOf(list[i], i);
      if (!r.ok) return r;
      if (specs.some((x) => same(x.t, r.m.t))) return dup(r.m.t);
      specs.push(r.m);
    }
    const prev = active() ? J : null;
    const progressed = !!prev && prev.ms.some((m) => m.s !== 'todo' || m.t0 != null);
    if (progressed && !clip(why, 200)) return needWhy('a new plan over one under way');
    const was = prev ? cur() : null;
    if (was) leave(was);
    const old = prev ? prev.ms : [];
    // ids keep counting across jobs in one visit: the panel keys a milestone's row by its id, so a new job's "m1"
    // must never land on an old job's row (and its history)
    J = { v: 1, goal, done: clip(s.done != null ? s.done : s.when, 200), status: 'active', t0: prev ? prev.t0 : now(), t1: null,
          seq: J ? J.seq : 0, ms: [], cur: null, log: prev ? prev.log : [] };
    for (const sp of specs) {
      const p = old.find((m) => same(m.t, sp.t));
      const m = mk(sp, p ? p.id : '');
      if (p) {
        // the same milestone in the new plan: its identity, history and proof carry over
        Object.assign(m, { t0: p.t0, t1: p.t1, busy: p.busy, tries: p.tries, acts: p.acts, ev: p.ev, why: p.why });
        if (p.s === 'done' || p.s === 'skipped' || p.s === 'failed') m.s = p.s;
        m.steps = m.steps.map((x) => { const ps = p.steps.find((y) => same(y.t, x.t)); return ps ? { t: x.t, s: ps.s } : x; });
      }
      J.ms.push(m);
    }
    const keep = was ? J.ms.find((m) => m.id === was.id && m.s !== 'done' && m.s !== 'skipped' && m.s !== 'failed') : null;
    const first = keep || nextTodo();
    if (first) enter(first);
    log(prev ? 'replan' : 'plan', null, (prev ? 'a new plan: ' : 'the plan: ') + J.ms.length + ' milestones', why);
    const d = first ? decl(first) : {};
    d.task = goal;
    return { ok: true, say: planText(prev ? 'New plan' : 'Plan', prev ? why : ''), declare: d, cur: first ? first.id : null };
  }
  const glyph = (m) => (m.s === 'done' ? '✓ ' : m.s === 'skipped' ? '⤼ ' : m.s === 'failed' ? '✗ ' : '');
  function planText(head, why) {
    const lines = ['**📋 ' + head + ' — ' + J.goal + '**' + (why ? ' (' + clip(why, 120) + ')' : '')];
    J.ms.slice(0, 12).forEach((m, i) => lines.push((i + 1) + '. ' + glyph(m) + m.t + ' — done when ' + m.done));
    if (J.ms.length > 12) lines.push('… and ' + (J.ms.length - 12) + ' more');
    if (J.done) lines.push('', '**Done when:** ' + J.done);
    return lines.join('\n').slice(0, 1900);
  }

  // ---- working it -------------------------------------------------------------------------------------
  // A short step inside the current milestone. A step nobody planned is ADDED where the work is -- a new
  // situation met inside a milestone is a new step, not a silent detour. '' ends the current step.
  function step(label) {
    if (!active()) return noPlan();
    const m = cur();
    if (!m) return { ok: false, why: 'no milestone is current -- mission add one, or mission finish' };
    const t = clip(label, 80), open = doingStep(m);
    if (!t) { if (open) open.s = 'done'; return { ok: true, declare: { substep: '' } }; }
    let st = m.steps.find((x) => same(x.t, t)), added = false;
    if (!st) {
      if (m.steps.length >= CAP_STEPS) return { ok: false, why: q(m.t) + ' already has ' + CAP_STEPS + ' steps -- split it (mission split)' };
      st = { t, s: 'todo' }; added = true;
      m.steps.splice(open ? m.steps.indexOf(open) + 1 : m.steps.length, 0, st);
      log('step+', m, 'added the step ' + q(t));
    }
    if (open && open !== st) open.s = 'done';
    st.s = 'doing';
    return { ok: true, added, declare: { substep: st.t } };
  }
  // The short steps of a milestone, rewritten (a step kept by name keeps its state).
  function setSteps(ref, list, why) {
    if (!active()) return noPlan();
    const m = find(ref);
    if (!m) return notFound(ref);
    const r = stepsOf(list);
    if (!r.ok) return r;
    const hadOpen = !!doingStep(m);
    m.steps = r.list.map((t) => { const p = m.steps.find((x) => same(x.t, t)); return { t, s: p ? p.s : 'todo' }; });
    log('steps', m, 'set ' + m.steps.length + ' steps for ' + q(m.t), why);
    return { ok: true, declare: (m.id === J.cur && hadOpen && !doingStep(m)) ? { substep: '' } : null };
  }

  // ---- changing the plan out loud ---------------------------------------------------------------------
  // ADD: by default right after the current milestone. One put BEFORE the current milestone (or with now:1)
  // is what must happen first: the current one waits, keeping its time and history, and the new one is
  // worked on now. On a FINISHED job, adding re-opens it -- a follow-up is a milestone of the same job.
  function add(spec, where, why) {
    if (!J || J.status === 'dropped') return noPlan();
    if (!clip(why, 200)) return needWhy('adding a milestone');
    if (J.ms.length >= CAP_MS) return { ok: false, why: 'the plan already has ' + CAP_MS + ' milestones' };
    const r = specOf(spec, J.ms.length);
    if (!r.ok) return r;
    if (J.ms.some((x) => same(x.t, r.m.t))) return dup(r.m.t);
    const w = where || {}, c = cur();
    let at, rel;
    if (w.before != null && w.before !== '') { const b = find(w.before); if (!b) return notFound(w.before); at = J.ms.indexOf(b); rel = 'before ' + q(b.t); }
    else if (w.after != null && w.after !== '') { const a = find(w.after); if (!a) return notFound(w.after); at = J.ms.indexOf(a) + 1; rel = 'after ' + q(a.t); }
    else if (c) { at = J.ms.indexOf(c) + 1; rel = 'after ' + q(c.t); }
    else { at = J.ms.length; rel = J.ms.length ? 'at the end' : 'first'; }
    const reopened = J.status === 'finished';
    if (reopened) { J.status = 'active'; J.t1 = null; }
    const m = mk(r.m);
    m.added = true;
    J.ms.splice(at, 0, m);
    const first = !!w.now || (!!c && J.ms.indexOf(m) < J.ms.indexOf(c));
    let declare = null;
    if (first || !c) { if (c) pause(c); enter(m); declare = decl(m); }
    log('add', m, 'added ' + q(m.t) + ' ' + rel, why);
    return { ok: true, m: m.id, reopened, say: '✎ **Plan changed:** added ' + q(m.t) + ' ' + rel + ' — ' + clip(why, 200), declare };
  }
  // CHANGE a milestone's name, done-when, check or steps. Changing what PROVES an achieved milestone opens it
  // again: the old proof was about the old done-when.
  function change(ref, patch, why) {
    if (!active()) return noPlan();
    if (!clip(why, 200)) return needWhy('changing a milestone');
    const m = find(ref);
    if (!m) return notFound(ref);
    const p = patch || {};
    const nt = p.t != null && p.t !== '' ? clip(p.t, 90) : m.t;
    if (!same(nt, m.t) && J.ms.some((x) => x !== m && same(x.t, nt))) return dup(nt);
    const nd = p.done != null && p.done !== '' ? clip(p.done, 200) : m.done;
    let ck = null, st = null;
    if (p.check !== undefined) { ck = checkOf(p.check); if (!ck.ok) return ck; }
    if (p.steps !== undefined) { st = stepsOf(p.steps); if (!st.ok) return st; }
    const before = m.t, parts = [];
    if (!same(before, nt)) parts.push(q(before) + ' → ' + q(nt)); else parts.push(q(nt));
    if (nd !== m.done) parts.push('done when ' + nd);
    if (ck) parts.push(ck.check ? 'a new check' : 'no check');
    if (st) parts.push(st.list.length + ' steps');
    const proofChanged = nd !== m.done || !!ck;
    m.t = nt; m.done = nd;
    if (ck) m.check = ck.check;
    if (st) m.steps = st.list.map((t) => { const x = m.steps.find((y) => same(y.t, t)); return { t, s: x ? x.s : 'todo' }; });
    m.changed = true;
    let declare = null;
    if (proofChanged && m.s === 'done') { m.s = 'todo'; m.ev = null; m.t1 = null; if (!cur()) { enter(m); declare = decl(m); } }
    log('change', m, parts.join('; '), why);
    return { ok: true, say: '✎ **Plan changed:** ' + parts.join(' · ') + ' — ' + clip(why, 200),
             relabel: before === nt ? null : { mid: m.id, t: nt }, declare };
  }
  // SPLIT a milestone that turned out too big. The first part carries on as it (its identity, history and
  // time), the rest follow it in the plan.
  function split(ref, parts, why) {
    if (!active()) return noPlan();
    if (!clip(why, 200)) return needWhy('splitting a milestone');
    const m = find(ref);
    if (!m) return notFound(ref);
    if (m.s === 'done' || m.s === 'skipped' || m.s === 'failed') return { ok: false, why: q(m.t) + ' is already ' + (m.s === 'done' ? 'achieved' : m.s) + ' -- mission add a new milestone instead' };
    if (!Array.isArray(parts) || parts.length < 2) return { ok: false, why: 'split into two or more milestones: [{"t":"…","done":"…"}, …]' };
    if (J.ms.length - 1 + parts.length > CAP_MS) return { ok: false, why: 'that would make more than ' + CAP_MS + ' milestones' };
    const specs = [];
    for (let i = 0; i < parts.length; i++) {
      const r = specOf(parts[i], i);
      if (!r.ok) return r;
      if (specs.some((x) => same(x.t, r.m.t)) || J.ms.some((x) => x !== m && same(x.t, r.m.t))) return dup(r.m.t);
      specs.push(r.m);
    }
    const fresh = specs.map((s, i) => { const x = mk(s, i ? '' : m.id); x.added = i > 0; return x; });
    Object.assign(fresh[0], { t0: m.t0, busy: m.busy, since: m.since, acts: m.acts, s: m.s, changed: true });
    J.ms.splice(J.ms.indexOf(m), 1, ...fresh);
    log('split', fresh[0], 'split ' + q(m.t) + ' into ' + fresh.map((x) => q(x.t)).join(', '), why);
    return { ok: true, say: '✎ **Plan changed:** split ' + q(m.t) + ' into ' + fresh.map((x) => q(x.t)).join(', ') + ' — ' + clip(why, 200),
             relabel: { mid: m.id, t: fresh[0].t }, declare: J.cur === m.id ? decl(fresh[0]) : null };
  }
  // SKIP (no longer needed) or FAIL (cannot be done) -- both with the reason, and the plan moves on. A failed
  // milestone stays in the report as failed: giving up is allowed, hiding it is not.
  function close(ref, why, how) {
    if (!active()) return noPlan();
    if (!clip(why, 200)) return needWhy(how === 'skipped' ? 'skipping a milestone' : 'giving up on a milestone');
    const m = find(ref);
    if (!m) return notFound(ref);
    if (m.s === 'done') return { ok: false, why: q(m.t) + ' is already achieved' };
    if (m.s === how) return { ok: true, already: true };
    const wasCur = J.cur === m.id;
    if (wasCur) { leave(m); J.cur = null; }
    m.s = how; m.why = clip(why, 200); m.t1 = now();
    for (const x of m.steps) if (x.s === 'doing') x.s = 'done';
    log(how === 'skipped' ? 'skip' : 'fail', m, (how === 'skipped' ? 'skipped ' : 'could not achieve ') + q(m.t), why);
    let declare = null, nx = null;
    if (wasCur || !cur()) { nx = nextTodo(); if (nx) { enter(nx); declare = decl(nx); } else if (wasCur) declare = { step: null }; }
    const say = how === 'skipped' ? '⤼ **Skipped:** ' + q(m.t) + ' — ' + m.why : '✗ **Can’t achieve:** ' + q(m.t) + ' — ' + m.why;
    return { ok: true, say, declare, next: nx ? nx.t : null };
  }
  const skip = (ref, why) => close(ref, why, 'skipped');
  const fail = (ref, why) => close(ref, why, 'failed');

  // ---- achieving -- the part that matters most ---------------------------------------------------------
  // Two halves, because the serve has to LOOK in between. toAchieve says which milestone and what would prove
  // it; the serve evaluates the check on a fresh picture (or takes the picture it was given) and reports back
  // with achieved() or missed(). No check and no picture is refused: an unproven "done" is the very thing
  // this file exists to stop.
  function toAchieve(ref, opt) {
    if (!active()) return noPlan();
    const m = find(ref);
    if (!m) return notFound(ref);
    if (m.s === 'done') return { ok: true, m, already: true };
    if (m.s === 'skipped' || m.s === 'failed') return { ok: false, why: q(m.t) + ' was ' + m.s + ' -- if the job needs it after all, mission change it (with a why)' };
    const x = opt || {};
    let check = m.check;
    if (x.check !== undefined && x.check !== null && x.check !== '') { const ck = checkOf(x.check); if (!ck.ok) return ck; check = ck.check; }
    const file = x.file ? str(x.file) : '';
    if (!check && !file) return { ok: false, needProof: true, why: 'prove ' + q(m.t) + ': it has no check, so give a picture of it (file: a cropped .jpg) -- or a check that holds now (check:{…})' };
    return { ok: true, m, check, file };
  }
  function achieved(ref, ev) {
    const m = find(ref);
    if (!J || !m) return { ok: false, why: 'no such milestone' };
    if (m.s === 'done') return { ok: true, already: true, say: '' };
    const e = ev || {}, wasCur = J.cur === m.id;
    if (wasCur) { leave(m); J.cur = null; } else if (m.t0 == null) m.t0 = now();
    m.s = 'done'; m.t1 = now(); m.why = '';
    m.ev = { how: e.how === 'check' ? 'check' : 'picture', saw: clip(e.saw, 120), note: clip(e.note, 160), file: e.file ? str(e.file).slice(0, 400) : '', at: now() };
    for (const x of m.steps) if (x.s === 'doing') x.s = 'done';
    log('achieve', m, 'achieved ' + q(m.t) + (m.ev.how === 'check' ? ' (its check held)' : ' (a picture)'));
    let declare = null, nx = null;
    if (wasCur || !cur()) { nx = nextTodo(); if (nx) { enter(nx); declare = decl(nx); } else if (wasCur) declare = { step: null }; }
    const n = J.ms.filter((x) => x.s === 'done').length, of = J.ms.filter((x) => x.s !== 'skipped').length;
    const say = '✓ **' + n + '/' + of + ' · ' + m.t + '** — ' + (m.ev.note || m.done);
    const allDone = !J.ms.some((x) => x.s === 'todo' || x.s === 'doing');
    return { ok: true, say, declare, next: nx ? nx.t : null, allDone };
  }
  function missed(ref, saw) {
    const m = find(ref);
    if (!J || !m) return { ok: false, why: 'no such milestone' };
    m.tries++;
    log('miss', m, 'its check did not hold' + (saw ? ': ' + clip(saw, 100) : ''));
    return { ok: false, tries: m.tries, why: q(m.t) + ' is not achieved yet — ' + (saw ? 'the check saw: ' + clip(saw, 120) : 'its check did not hold') };
  }

  // ---- finishing --------------------------------------------------------------------------------------
  function finishable() {
    if (!J) return { ok: false, why: 'there is no plan' };
    if (J.status !== 'active') return { ok: false, why: 'the job is ' + J.status };
    const open = J.ms.filter((m) => m.s === 'todo' || m.s === 'doing');
    if (open.length) {
      return { ok: false, open: open.map((m) => m.t),
               why: open.length + (open.length === 1 ? ' milestone is' : ' milestones are') + ' still open: ' + open.slice(0, 4).map((m) => q(m.t)).join(', ') +
                    ' — achieve, skip or fail each (with a why) before finishing' };
    }
    return { ok: true };
  }
  function finish() {
    const f = finishable();
    if (!f.ok) return f;
    J.cur = null; J.status = 'finished'; J.t1 = now();
    log('finish', null, 'finished the job');
    return { ok: true, report: report() };
  }
  // The job as a report (etiquette §4): one status line, a bullet per milestone with its time or its reason,
  // and how often the plan had to change.
  function report() {
    if (!J) return '';
    const total = (J.t1 || now()) - J.t0;
    const done = J.ms.filter((m) => m.s === 'done').length, failed = J.ms.filter((m) => m.s === 'failed').length;
    const lines = [failed ? '⚠ **' + J.goal + ' — ' + done + ' of ' + J.ms.length + ' milestones achieved, ' + failed + ' not**'
                          : '✓ **' + J.goal + ' — done in ' + dur(total) + '**'];
    for (const m of J.ms.slice(0, 14)) {
      lines.push('- ' + (m.s === 'done' ? '✓ ' + m.t + ' · ' + dur(timeOf(m)) : m.s === 'skipped' ? '⤼ ' + m.t + ' — skipped: ' + m.why
                                                                                           : '✗ ' + m.t + ' — ' + (m.why || 'not achieved')));
    }
    if (J.ms.length > 14) lines.push('- … and ' + (J.ms.length - 14) + ' more');
    const changes = J.log.filter((l) => l.op === 'add' || l.op === 'change' || l.op === 'split' || l.op === 'skip' || l.op === 'fail' || l.op === 'replan').length;
    if (changes) lines.push('- The plan changed **' + changes + '×** on the way, each said in this chat');
    return lines.join('\n').slice(0, 1800);
  }
  function drop(why) {
    if (!active()) return { ok: false, why: 'no plan is under way' };
    const c = cur();
    if (c) leave(c);
    J.status = 'dropped'; J.cur = null; J.t1 = now();
    log('drop', null, 'dropped the plan', why);
    return { ok: true, say: '⏹ **Plan dropped** — ' + (clip(why, 200) || 'stopped') };
  }

  // ---- what every answer carries -------------------------------------------------------------------------
  // Each action run while a milestone is current counts against it, and a run of failed ones is a streak.
  function act(ok) {
    const m = active() ? cur() : null;
    if (!m) return;
    m.acts++;
    if (ok) m.bad = 0;
    else { if (!m.bad) m.badFrom = m.acts; m.bad++; }
  }
  // ONE nudge per threshold, when it is first crossed: a hint repeated on every answer is noise.
  function hint() {
    const m = active() ? cur() : null;
    if (!m) return '';
    const once = (k, s) => { if (m.hinted[k]) return ''; m.hinted[k] = 1; return s; };
    return (m.tries >= 3 && once('t3', q(m.t) + ' has missed its check ' + m.tries + ' times — stop and ask the operator, with numbered choices (or mission fail it, with a why)')) ||
           (m.tries === 2 && once('t2', q(m.t) + ' missed its check twice — do not try the same way again: change the approach, replan (mission add / change / split), or ask the operator')) ||
           (m.bad >= 3 && once('b' + m.badFrom, m.bad + ' actions in a row failed on ' + q(m.t) + ' — look (shot) before acting again; if the screen is not what the plan expects, replan')) ||
           (m.acts >= 40 && once('a' + Math.floor(m.acts / 40), q(m.t) + ' has taken ' + m.acts + ' actions without being achieved — check its done-when, split it, or ask')) || '';
  }
  // Where the job stands, short enough to ride every answer: the driver never has to remember the plan.
  function brief() {
    if (!J) return null;
    const m = cur(), st = doingStep(m);
    const o = { goal: clip(J.goal, 60), status: J.status, done: J.ms.filter((x) => x.s === 'done').length, of: J.ms.length };
    if (m) {
      o.at = (J.ms.indexOf(m) + 1) + '. ' + clip(m.t, 60);
      o.when = clip(m.done, 90);
      if (st) o.step = clip(st.t, 50);
      o.acts = m.acts;
      if (m.tries) o.tries = m.tries;
    } else if (J.status === 'active') o.next = 'every milestone is closed — mission finish (with file: a picture of the result)';
    return o;
  }

  // ---- what the panel draws, and what the driver reads ----------------------------------------------------
  // (no ✓ of its own: the panel draws one for a done row)
  const proofLine = (m) => !m.ev ? '' : m.ev.how === 'check' ? 'proven: ' + clip(m.ev.note || m.done, 80) : 'proven by a picture' + (m.ev.note ? ': ' + clip(m.ev.note, 70) : '');
  function skeleton() {
    if (!J || J.status === 'dropped') return null;
    return { goal: J.goal, ms: J.ms.map((m) => ({ id: m.id, t: m.t, s: m.s, why: m.why, ev: m.s === 'done' ? proofLine(m) : '',
                                                  subs: m.id === J.cur ? m.steps.map((x) => ({ t: x.t, s: x.s })) : null })) };
  }
  // The plan as plain text (mission show): where it stands, every milestone with its done-when, steps and
  // proof, and the recent changes with their reasons -- for a driver who has lost the thread.
  function text() {
    if (!J) return 'no plan yet';
    const G = { todo: '○', doing: '●', done: '✓', skipped: '⤼', failed: '✗' }, S = { todo: '·', doing: '›', done: '✓' };
    const lines = [J.goal + '   [' + J.status + ' · ' + J.ms.filter((m) => m.s === 'done').length + '/' + J.ms.length + ' achieved · ' + dur((J.t1 || now()) - J.t0) + ']'];
    if (J.done) lines.push('  done when: ' + J.done);
    J.ms.forEach((m, i) => {
      lines.push(String(i + 1).padStart(3) + '. ' + (G[m.s] || '?') + ' ' + m.t + '   (' + m.id + (m.id === J.cur ? ', NOW' : '') + (m.skill ? ', skill ' + m.skill : '') + ')');
      lines.push('       done when: ' + m.done + (m.check ? '   check: ' + JSON.stringify(m.check).slice(0, 120) : ''));
      for (const x of m.steps) lines.push('       ' + (S[x.s] || '·') + ' ' + x.t);
      if (m.s === 'done' && m.ev) lines.push('       proof: ' + (m.ev.how === 'check' ? 'the check held' + (m.ev.saw ? ' (saw: ' + m.ev.saw + ')' : '') : 'a picture ' + m.ev.file) + (m.ev.note ? ' — ' + m.ev.note : ''));
      if (m.why) lines.push('       why: ' + m.why);
      if (m.tries) lines.push('       missed its check ' + m.tries + '×');
    });
    const ch = J.log.filter((l) => l.why);
    if (ch.length) { lines.push('changes:'); for (const l of ch.slice(-8)) lines.push('  ' + l.op + ': ' + l.what + ' — ' + l.why); }
    return lines.join('\n');
  }

  // ---- kept on disk --------------------------------------------------------------------------------------
  const toJSON = () => (J ? JSON.parse(JSON.stringify(J)) : null);
  // Back from mission.json (a restarted serve picks the job up where it was). Checked, never trusted: a field
  // of the wrong shape is dropped, not obeyed. Time while nothing was serving is not billed to anything.
  function load(obj) {
    const x = obj && typeof obj === 'object' ? obj : null;
    if (!x || !Array.isArray(x.ms) || !x.ms.length || !clip(x.goal, 100)) return { ok: false, why: 'that is not a saved plan' };
    const ms = [];
    for (const r of x.ms.slice(0, CAP_MS)) {
      if (!r || typeof r !== 'object' || !/^m\d+$/.test(str(r.id)) || !clip(r.t, 90) || ms.some((y) => y.id === r.id)) continue;
      const ck = checkOf(r.check);
      ms.push({ id: r.id, t: clip(r.t, 90), done: clip(r.done, 200) || 'done', check: ck.ok ? ck.check : null, skill: clip(r.skill, 60),
                s: /^(todo|doing|done|skipped|failed)$/.test(str(r.s)) ? r.s : 'todo',
                steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, CAP_STEPS).map((y) => ({ t: clip(y && y.t, 80), s: /^(todo|doing|done)$/.test(str(y && y.s)) ? y.s : 'todo' })).filter((y) => y.t),
                why: clip(r.why, 200), ev: r.ev && typeof r.ev === 'object' ? { how: r.ev.how === 'check' ? 'check' : 'picture', saw: clip(r.ev.saw, 120), note: clip(r.ev.note, 160), file: str(r.ev.file).slice(0, 400), at: num(r.ev.at) } : null,
                tries: Math.max(0, num(r.tries)), acts: Math.max(0, num(r.acts)), bad: 0, badFrom: 0, t0: r.t0 == null ? null : num(r.t0), t1: r.t1 == null ? null : num(r.t1),
                busy: Math.max(0, num(r.busy)), since: null, hinted: {}, added: !!r.added, changed: !!r.changed });
    }
    if (!ms.length) return { ok: false, why: 'that saved plan has no usable milestones' };
    const seq = ms.reduce((n, m) => Math.max(n, num(m.id.slice(1))), num(x.seq));
    J = { v: 1, goal: clip(x.goal, 100), done: clip(x.done, 200), status: /^(active|finished|dropped)$/.test(str(x.status)) ? x.status : 'active',
          t0: num(x.t0) || now(), t1: x.t1 == null ? null : num(x.t1), seq, ms, cur: null,
          log: (Array.isArray(x.log) ? x.log : []).slice(-CAP_LOG).filter((l) => l && typeof l === 'object').map((l) => ({ at: num(l.at), op: clip(l.op, 20), m: l.m ? str(l.m).slice(0, 8) : undefined, t: l.t ? clip(l.t, 90) : undefined, what: clip(l.what, 200), why: l.why ? clip(l.why, 200) : undefined })) };
    let c = active() ? ms.find((m) => m.id === str(x.cur) && (m.s === 'doing' || m.s === 'todo')) || ms.find((m) => m.s === 'doing') || nextTodo() : null;
    for (const m of ms) if (m.s === 'doing' && m !== c) m.s = 'todo';
    if (c) enter(c);
    // a job still under way is drawn again where it was; a finished (or dropped) one is only read back --
    // naming its task again would re-open a finished panel
    const d = c ? decl(c) : null;
    if (d) d.task = J.goal;
    return { ok: true, declare: d };
  }

  // The parts of the plan only a PERSON may do (a CAPTCHA), still open -- see captchaIn below.
  const humanSteps = () => (J && J.status === 'active' ? captchaIn(J.ms.filter((m) => m.s === 'todo' || m.s === 'doing')) : []);

  return { plan, step, setSteps, add, change, split, skip, fail, toAchieve, achieved, missed, finishable, finish, report, drop,
           act, hint, brief, skeleton, text, toJSON, load, find, active, current: cur, humanSteps,
           get status() { return J ? J.status : 'none'; }, get goal() { return J ? J.goal : ''; } };
}

// A CAPTCHA IS FOR A PERSON. 10002's plan carried a step "Complete any reCAPTCHA" and nothing objected. A
// CAPTCHA checks that a person is there; an agent passing it would be passing for one. So a plan that mentions
// one is answered with a note: when you reach it, `captcha` (it asks the operator in the session chat and waits)
// -- never solve, bypass or click through it yourself.
const CAPTCHA = /\b(re-?captcha|h-?captcha|captchas?|i'?m not a robot|not a robot|are you (a )?human|verify (that )?you(?: a|')re (a )?human|human verification|turnstile)\b/i;
function captchaIn(milestones) {
  const hits = [];
  for (const m of Array.isArray(milestones) ? milestones : []) {
    if (!m || typeof m !== 'object') continue;
    const name = clip(m.t, 90);
    if (CAPTCHA.test(str(m.t)) || CAPTCHA.test(str(m.done))) hits.push({ m: m.id || '', where: 'milestone ' + q(clip(name, 40)), text: clip(CAPTCHA.test(str(m.t)) ? m.t : m.done, 90) });
    for (const s of Array.isArray(m.steps) ? m.steps : []) {
      const t = s && typeof s === 'object' ? s.t : s;
      if (CAPTCHA.test(str(t))) hits.push({ m: m.id || '', where: 'a step of ' + q(clip(name, 40)), text: clip(t, 90) });
    }
  }
  return hits;
}
const CAPTCHA_NOTE = 'a CAPTCHA is for a person: when you reach it, send {"do":"captcha"} -- it asks the operator in the session chat to solve it and waits for their reply. Never solve, bypass or click through one yourself.';

module.exports = { create, checkOf, captchaIn, CAPTCHA_NOTE, CAP_MS, CAP_STEPS };

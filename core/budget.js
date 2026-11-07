'use strict';
// @tool a task's budget: how many acting steps and minutes it may take before the agent stops and asks to go on
// @run  const B = require('./budget.js').create({ steps: 100, minutes: 30 })   (a library; core/agent-join.js keeps one per visit)
// budget -- AN AGENT THAT HAS LOST THE THREAD STOPS AND ASKS, INSTEAD OF GRINDING ON.
//
// The kit's roadmap: "Budgets. A per-task cap on time/steps, so an agent that's lost stops and asks rather than
// grinding." Where a job's time goes was measured (docs/plans/roadmap.md): the driver's own turns are 87% of it,
// a median of 46 s each. A driver that has lost the thread keeps taking them -- the same click, another look,
// the same click again -- and the people watching see a cursor circle for twenty minutes with nobody deciding
// that it should stop. A budget is that decision, made before the task starts:
//
//   * a TASK may take so many ACTING STEPS -- each top-level command that acts on the machine counts once, so a
//     `plan` of sixty clicks is one step: it was one decision -- and so many MINUTES, wall time since it began;
//   * when either is spent, the next acting command is NOT run. The answer says so, and the agent asks the room
//     whether to go on (`budget {more:1, why}`); only their yes -- or, with the standing yes on, a question
//     nobody answered -- raises it. Looking, talking, the panel and finishing are never refused: an agent out of
//     budget can still see, report and sign off;
//   * a NEW task starts the counts again: a mission's plan, a status that names another task, work after a finish;
//   * lowering a budget is free; raising it is asking the room (it is the same question);
//   * at 80% the answers carry a hint once, so the agent can wrap up or ask before it is stopped.
//
// Pure: no I/O, no timers, an injectable clock, and it never throws on odd input (commands are JSON somebody wrote).

// The verbs that ACT on the machine -- what a lost agent repeats. Talking, looking, the panel and the plan's own
// bookkeeping are not steps: refusing those would leave an agent out of budget unable to say so.
const ACTING = new Set(['click', 'clicks', 'dbl', 'right', 'clickText', 'keys', 'press', 'chord', 'open', 'scroll',
  'stroke', 'strokes', 'exec', 'terminal', 'launch', 'focus', 'plan', 'send', 'undo']);
const isActing = (cmd) => !!cmd && typeof cmd === 'object' && typeof cmd.do === 'string' && ACTING.has(cmd.do);

const num = (v) => { let n; try { n = Number(v); } catch (_) { return NaN; } return n; };
// a limit: a positive number, else 0 (no limit). Capped so a typo cannot ask for a year.
const lim = (v, cap) => { const n = num(v); return Number.isFinite(n) && n > 0 ? Math.min(cap, n) : 0; };
const MAX_STEPS = 100000, MAX_MIN = 24 * 60;
const str = (v) => { if (typeof v === 'string') return v; if (v == null) return ''; try { return String(v); } catch (_) { return ''; } };
const clip = (s, n) => { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const mins = (ms) => Math.max(0, Math.round(ms / 6000) / 10);   // to a tenth of a minute

function create(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const clock = typeof o.now === 'function' ? o.now : () => Date.now();
  const now = () => { const t = num(clock()); return Number.isFinite(t) ? t : Date.now(); };
  // what a task starts with, and what one `more` adds unless it names its own amounts
  const base = { steps: Math.round(lim(o.steps, MAX_STEPS)), minutes: lim(o.minutes, MAX_MIN) };
  let limit = { steps: base.steps, minutes: base.minutes };
  let task = '', t0 = now(), used = 0, hinted = false, extra = 0;

  const usedMin = () => mins(now() - t0 - extra);
  const over = () => {
    const s = limit.steps > 0 && used >= limit.steps, m = limit.minutes > 0 && usedMin() >= limit.minutes;
    return s || m ? { steps: s, minutes: m } : null;
  };
  const brief = () => {
    if (!limit.steps && !limit.minutes) return null;
    const b = { task, steps: { used, limit: limit.steps || null }, minutes: { used: usedMin(), limit: limit.minutes || null } };
    if (over()) b.spent = true;
    return b;
  };
  const words = () => {
    const parts = [];
    if (limit.steps) parts.push(used + ' of ' + limit.steps + ' steps');
    if (limit.minutes) parts.push(usedMin() + ' of ' + limit.minutes + ' minutes');
    return parts.join(', ');
  };

  return {
    ACTING,
    isActing,
    // a new task: the counts and the limits start again
    start(name) { task = clip(name, 120); t0 = now(); used = 0; hinted = false; extra = 0; limit = { steps: base.steps, minutes: base.minutes }; },
    task() { return task; },
    // is this the task already being counted? (a status that repeats its task is not a new one)
    same(name) { return clip(name, 120) === task; },
    // a top-level command was run (whatever its answer: a failed attempt is still a turn spent)
    count(cmd) { if (isActing(cmd)) used++; },
    // time spent WAITING ON PEOPLE (a confirm, a chat-wait, this budget's own question) is not the agent grinding:
    // it does not count against the minutes
    rest(ms) { const n = num(ms); if (Number.isFinite(n) && n > 0) extra += Math.min(n, MAX_MIN * 60000); },
    // BEFORE an acting command: null when it may run, else the refusal's words and the state
    check(cmd) {
      if (!isActing(cmd)) return null;
      const o2 = over();
      if (!o2) return null;
      return { why: 'this task\'s budget is spent (' + words() + (task ? ' on “' + task + '”' : '') + ')', budget: brief() };
    },
    spent() { return !!over(); },
    // once per task, at 80% of either limit
    hint() {
      if (hinted || over()) return null;
      const s = limit.steps ? used / limit.steps : 0, m = limit.minutes ? usedMin() / limit.minutes : 0;
      if (Math.max(s, m) < 0.8) return null;
      hinted = true;
      return 'this task\'s budget is nearly spent (' + words() + ') -- wrap up, or ask the room for more now: {"do":"budget","more":1,"why":"…"}';
    },
    // what a `budget` command asks for: a lower limit is simply taken; a higher one has to be asked for
    want(req) {
      const r = req && typeof req === 'object' ? req : {};
      const ns = r.steps != null ? Math.round(lim(r.steps, MAX_STEPS)) : null, nm = r.minutes != null ? lim(r.minutes, MAX_MIN) : null;
      const raises = (ns != null && (ns === 0 ? limit.steps !== 0 : (limit.steps !== 0 && ns > limit.steps))) ||
                     (nm != null && (nm === 0 ? limit.minutes !== 0 : (limit.minutes !== 0 && nm > limit.minutes)));
      return { steps: ns, minutes: nm, raises };
    },
    // set limits outright (after a yes when they raise); 0 = no limit
    set(req) {
      const r = req && typeof req === 'object' ? req : {};
      if (r.steps != null) limit.steps = Math.round(lim(r.steps, MAX_STEPS));
      if (r.minutes != null) limit.minutes = lim(r.minutes, MAX_MIN);
      hinted = false;
    },
    // the room said yes to going on: as much again as the task started with (or the amounts asked for), counted
    // from where it stands now -- a budget spent on time gets its minutes from now, not from the task's start
    more(req) {
      const r = req && typeof req === 'object' ? req : {};
      const addS = r.steps != null ? Math.round(lim(r.steps, MAX_STEPS)) : (base.steps || 0);
      const addM = r.minutes != null ? lim(r.minutes, MAX_MIN) : (base.minutes || 0);
      if (limit.steps) limit.steps = Math.min(MAX_STEPS, Math.max(limit.steps, used) + (addS || base.steps || 0));
      if (limit.minutes) limit.minutes = Math.min(MAX_MIN, Math.max(limit.minutes, usedMin()) + (addM || base.minutes || 0));
      hinted = false;
    },
    // the words for the room: what was used, and what one more round would give
    question(why) {
      const add = [];
      if (limit.steps) add.push(base.steps + ' more steps');
      if (limit.minutes) add.push(base.minutes + ' more minutes');
      return '⏱ **I have used this task\'s budget**' + (task ? ' on “' + task + '”' : '') + ' — ' + words() + '. ' +
             (why ? clip(why, 300) + ' ' : '') + 'Shall I carry on' + (add.length ? ' for ' + add.join(' and ') : '') + '?';
    },
    brief,
    words,
  };
}

module.exports = { create, isActing, ACTING };

'use strict';
// @tool the watchers' board: the requests its buttons send (marks), autonomy and approvals, risk, and where a task's time went
// @run  const BD = require('./board.js'); BD.parseMark('⏸ Pause — hold on until I say go on.')   (a library; core/agent-join.js reads the room with it)
// board -- WHAT THE PEOPLE WATCHING MAY ASK OF THE AGENT, FROM ITS PANEL, AND WHAT THE PANEL SHOWS OF IT.
//
// The panel every watcher sees (ScreenMirror's #agentDrive) used to be a display: what the agent did, and lately why.
// It is the room's control surface now. Its buttons speak through the session chat -- one record of the visit, read
// by the people and the agent alike -- each as a line that starts with a MARK only the panel sends (typing the words
// does not), so every one is an unambiguous request. The serve (core/agent-join.js) reads them in `parseMark` and acts
// on most of them itself, so a button works even while the driver is busy or thinking:
//
//   ⏸ pause / ▶ resume       acting commands are refused while paused ("Paused by Dana"); anyone may say go on
//   ⏹ stop the task          refused until the driver reports what is done (status fin) -- the visit stays
//   ⏯ stop after “step”      the same, from the moment that step ends
//   ⛔ end the visit          (handled before this module: stopNow)
//   ✅ yes / ✋ no [qN]        the answer to the question shown on the panel, by its id: a stale button never
//                            answers a newer question
//   🧩 solved [qN]           the CAPTCHA is done
//   ↩ undo c3 / all          put a change back (core/undo.js)
//   ⏭ skip / 🔁 redo “step”  for the driver: carried to it as a hint
//   🎚 autonomy               ask before each action / risky actions only / at checkpoints / not at all
//   💾 save as a skill  🔂 run again  🗓 schedule  👋 are you still there?
//   ❓ why “step”?           the reason the agent gave for that step: answered at once from what it said (its `why`),
//                            or carried to the driver to answer -- never an interruption
//   [@tag]                   any line may name one visit (two agents on one machine): the other ignores it
//
// Pure: no I/O, no clock of its own (callers pass `now`), so tests/board.js runs it in CI.

const VS = '️';   // the emoji presentation selector some keyboards and fonts add after a mark
// mark -> kind. Order matters only for readability; each mark is one code point.
const MARKS = [
  ['⏸', 'pause'],      // ⏸
  ['▶', 'resume'],     // ▶
  ['⏹', 'stop-task'],  // ⏹
  ['⏯', 'stop-after'], // ⏯
  ['⛔', 'end'],        // ⛔
  ['✅', 'yes'],        // ✅
  ['✋', 'no'],         // ✋
  ['\u{1F9E9}', 'solved'],  // 🧩
  ['↩', 'undo'],       // ↩
  ['⏭', 'skip'],       // ⏭
  ['\u{1F501}', 'redo'],    // 🔁
  ['\u{1F39A}', 'autonomy'],// 🎚
  ['\u{1F4BE}', 'save-skill'], // 💾
  ['\u{1F502}', 'run-again'],  // 🔂
  ['\u{1F5D3}', 'schedule'],   // 🗓
  ['\u{1F44B}', 'nudge'],      // 👋
  ['\u2753', 'why'],         // ❓
];
const KIND_OF = new Map(MARKS);
const MARK_OF = new Map(MARKS.map(([m, k]) => [k, m]));

// THE AUTONOMY DIAL. 'auto' is the serve as it always was: the driver asks (confirm) when it judges an action
// hard to undo. The others are the room's choice for this visit, and they hold whatever the driver judges.
const MODES = ['each', 'risky', 'checkpoints', 'auto'];
const MODE_WORDS = {
  each: 'Ask before each action',
  risky: 'Ask before risky actions only',
  checkpoints: 'Ask at each checkpoint',
  auto: 'Go on without asking',
};

const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const quoted = (s) => { const m = /[“"]([^”"]{1,200})[”"]/.exec(String(s || '')); return m ? m[1].trim() : ''; };

// A line from the room -> what it asks, or null when it is not a board request.
//   { kind, q: 'q7' | '', step: '<label>' | '', arg }   arg: 'c3' | 'all' (undo), a mode (autonomy),
//   a schedule phrase, or ''.
function parseMark(text) {
  const s = String(text == null ? '' : text).replace(/^\s+/, '');
  if (!s) return null;
  const first = String.fromCodePoint(s.codePointAt(0));
  const kind = KIND_OF.get(first);
  if (!kind) return null;
  let rest = s.slice(first.length);
  if (rest.startsWith(VS)) rest = rest.slice(1);
  rest = rest.trim();
  // A QUESTION'S ID NAMES ITS VISIT TOO -- [q3@7f2a] -- so with two agents on one machine, a press on one's q3 is not
  // an answer to the other's (each counts q1, q2, ... on its own). [@7f2a] alone scopes any other mark (a pause, a stop)
  // to that visit; a line with no tag is for every agent on the machine, as before.
  const qm = /\[(q\d{1,6})(?:@([a-z0-9]{2,8}))?\]/i.exec(rest);
  const vm = /\[@([a-z0-9]{2,8})\]/i.exec(rest);
  const vt = qm && qm[2] ? qm[2].toLowerCase() : vm ? vm[1].toLowerCase() : '';
  const out = { kind, q: qm ? qm[1] + (qm[2] ? '@' + qm[2].toLowerCase() : '') : '', vt, step: quoted(rest), arg: '' };
  if (kind === 'undo') {
    const m = /\b(c\d{1,5})\b/i.exec(rest);
    out.arg = m ? m[1].toLowerCase() : /\ball\b/i.test(rest) ? 'all' : '';
  } else if (kind === 'autonomy') {
    out.arg = /each action/i.test(rest) ? 'each' : /risky/i.test(rest) ? 'risky' : /checkpoint/i.test(rest) ? 'checkpoints'
            : /without asking|on your own|autonom/i.test(rest) ? 'auto' : '';
  } else if (kind === 'schedule') {
    const m = /:\s*(.+?)\.?\s*$/.exec(rest);
    out.arg = m ? m[1].trim() : '';
  }
  return out;
}

// The line a board button sends -- written here once, so the panel (viewer.html, which carries the same strings) and
// the tests agree on the wording. `o`: { q, step, id, mode, when }.
function markText(kind, o) {
  o = o || {};
  const m = MARK_OF.get(kind);
  if (!m) return '';
  const tag = o.q ? ' [' + o.q + ']' : o.vt ? ' [@' + o.vt + ']' : '';
  const st = o.step ? '“' + clip(o.step, 90) + '”' : '';
  const vtag = !o.q && o.vt ? ' [@' + o.vt + ']' : '';
  switch (kind) {
    case 'pause': return m + ' Pause — hold on until I say go on.' + vtag;
    case 'resume': return m + ' Go on.' + vtag;
    case 'stop-task': return m + ' Stop this task — say what is done, and wait.' + vtag;
    case 'stop-after': return m + ' Stop after ' + (st || 'this step') + '.' + vtag;
    case 'end': return m + ' Stop — please end the current task now.' + vtag;
    case 'yes': return m + ' Yes — go ahead.' + tag;
    case 'no': return m + ' No.' + tag;
    case 'solved': return m + ' Solved — the CAPTCHA is done.' + tag;
    case 'undo': return m + ' Undo ' + (o.id === 'all' ? 'all' : (o.id || '')) + '.' + vtag;
    case 'skip': return m + ' Skip ' + (st || 'this step') + '.' + vtag;
    case 'redo': return m + ' Redo ' + (st || 'this step') + '.' + vtag;
    case 'autonomy': return m + ' ' + (MODE_WORDS[o.mode] || MODE_WORDS.auto) + '.' + vtag;
    case 'save-skill': return m + ' Save this job as a skill.' + vtag;
    case 'run-again': return m + ' Run this job again.' + vtag;
    case 'schedule': return m + ' Schedule this job: ' + clip(o.when || 'every day at 09:00', 60) + '.' + vtag;
    case 'nudge': return m + ' Are you still there?' + vtag;
    case 'why': return m + ' Why ' + (st || 'this step') + '?' + vtag;
  }
  return '';
}
// Is this press an answer to that question? The same id -- or, for a line with no visit tag (an older panel), the same
// number: a press on another visit's q3 is never this visit's q3.
function sameQ(pressed, asked) {
  const p = String(pressed || ''), a = String(asked || '');
  if (!p || !a) return false;
  return p === a || (p.indexOf('@') < 0 && p === a.split('@')[0]);
}

// ---- risk: the actions the 'risky' autonomy mode asks about, and the panel marks ------------------------------------
// Deliberately small and conservative: what can lose work or change the machine beyond the task. A command the change
// record (core/undo.js) found to change something it cannot put back counts too -- the caller passes that in.
const RISKY_CHORDS = [/^Alt\+F4$/i, /^Shift\+Delete$/i, /^Ctrl\+Shift\+Delete$/i, /^Ctrl\+Alt\+Delete$/i, /^Meta\+L$/i, /^Win\+L$/i];
function riskOf(cmd, extra) {
  const c = cmd && typeof cmd === 'object' ? cmd : {};
  const x = extra || {};
  if (x.irreversible) return 'changes something that cannot be put back';
  if (x.risky) return 'a change that is risky to put back';
  switch (c.do) {
    case 'exec': return x.readOnly ? '' : 'runs a command on the machine';
    case 'terminal': return c.input != null || c.keys != null ? (x.readOnly ? '' : 'types into the Terminal') : '';
    case 'send': return c.overwrite ? 'overwrites a file on the machine' : '';
    case 'launch': return '';
    case 'chord': { const k = String(x.chord || ''); return RISKY_CHORDS.some((r) => r.test(k)) ? 'presses ' + k : ''; }
    case 'undo': return 'puts a change back';
  }
  return '';
}

// ---- approvals: the room's yes for ONE command ----------------------------------------------------------------------
// In 'each' (and, for risky commands, 'risky') mode an acting command is not run until the room says yes to it. The
// driver is answered at once (refused, with the question) instead of being held -- a held command would outlast the
// MCP call's own timeout -- and a yes is kept for that exact command, so the driver sending it again runs it once.
function sigOf(cmd) {
  const c = cmd && typeof cmd === 'object' ? cmd : {};
  const o = {};
  for (const k of Object.keys(c).sort()) if (!/^(cid|__vetted|look|intent|why|quiet|note|timeout)$/.test(k)) o[k] = c[k];
  return JSON.stringify(o);
}
function approvals() {
  const ok = new Map();   // sig -> expiry
  return {
    grant(cmd, now, ttlMs) { ok.set(sigOf(cmd), (now || 0) + (ttlMs || 10 * 60000)); },
    take(cmd, now) { const s = sigOf(cmd), t = ok.get(s); if (t == null) return false; ok.delete(s); return t >= (now || 0); },
    clear() { ok.clear(); },
    size() { return ok.size; },
  };
}

// ---- where a task's time goes: thinking, acting, waiting on people ---------------------------------------------------
// One clock per task. A command that waits on people (chat-wait, confirm, captcha, a question the serve asks) counts as
// waiting; any other command as acting; everything between commands is the driver deciding what to do -- thinking.
const WAITING = new Set(['chat-wait', 'confirm', 'captcha', 'access']);
function timeSplit(now0) {
  let t0 = now0 || 0, acting = 0, waiting = 0, cur = null;
  return {
    reset(now) { t0 = now || 0; acting = 0; waiting = 0; cur = null; },
    begin(cmd, now) { cur = { at: now || 0, wait: WAITING.has(cmd && cmd.do) }; },
    // a command the serve itself turned into a wait on the room (a plan's preview, a checkpoint, an approval) says so
    waitNow() { if (cur) cur.wait = true; },
    end(now) { if (!cur) return; const d = Math.max(0, (now || 0) - cur.at); if (cur.wait) waiting += d; else acting += d; cur = null; },
    addWait(ms) { waiting += Math.max(0, Number(ms) || 0); },
    brief(now) {
      const open = cur ? Math.max(0, (now || 0) - cur.at) : 0;
      const a = acting + (cur && !cur.wait ? open : 0), w = waiting + (cur && cur.wait ? open : 0);
      const all = Math.max(0, (now || 0) - t0);
      return { t: Math.max(0, Math.round(all - a - w)), a: Math.round(a), w: Math.round(w) };
    },
  };
}

module.exports = { MARKS, MODES, MODE_WORDS, parseMark, markText, sameQ, riskOf, sigOf, approvals, timeSplit, WAITING };

'use strict';
// @tool turn what a serve agent DOES into the progress panel's nested, described tree: task > step > sub-step > action group > the live action
// @run  const AT = require('../core/action-tree.js').create({ task: 'the job' })   (a library; core/agent-join.js feeds it every command it runs)
// action-tree -- WHAT THE WATCHERS SEE WHEN NO TOOL DECLARED A PLAN.
//
// REPORTED FROM A LIVE RUN (machine 10005, ~380 actions): the viewer's progress panel showed a flat feed
// of context-free verbs -- "Typing", "Clicking", "Keyboard shortcut", "Pressing Enter" -- with no task, no
// sub-steps and no detail. The operator: "all are useless action names and no even sub steps, sub-sub
// steps". The panel could already render a deep, timed tree (viewer 2.143+), but only a TOOL ever sent
// one. This builds the tree from what the serve loop actually executes, so ANY run reads as structure:
//
//   task                 `status {task}`, else the --task text
//     step               `status {step}` (stays open), a plain `status {text}` (closes at the pause after
//                        its work), else one per BURST of commands
//       sub-step         `status {substep}`
//         action group   consecutive commands of one kind MERGED and described:
//                          Ctrl+L, typed 11 characters, ⏎        Pressed 16 keys: ↓←↓←↓→↓←
//                          Clicked 4× — last (241,643)            Checked pixel (260,250) → #000000
//           live action  the newest command of a merged run: "Pressing ↑ · 23 so far"
//
// PRIVACY -- everything here is broadcast to EVERY watcher of the host and replayed to anyone who opens it
// later, so a label must never carry more than the screen already shows (adversarial reviews found typed
// passwords, DM text, Shift-typed capitals and magic-link tokens on the panel at one point or another):
//   * typed text is described by its SHAPE ("typed 11 characters") unless the command opts in with
//     `show:1` (type-text --show, for a search term or a plain address); `secret:1` hides it even then, a
//     capital typed with Shift is typing too, and the live leaf never quotes a typed character;
//   * a URL -- opened, or typed with show:1 -- never shows its query, fragment, credentials or a TOKEN-like
//     path segment or host label ("we.tl/…"); `open {secret:1}` shows the host only;
//   * chat / DM / sticky-note / confirm text never appears -- "Sent a direct message", "→ got a reply".
//
// SHAPE RULES. A burst ends when the driver goes quiet (the caller calls idle() after a pause; never while
// a command is still running): an auto or soft step closes there and "Planning the next step" stands in.
// A single command that has answered is DONE at once (✓, past tense, its result); the next command of the
// same kind reopens it as a run, which keeps ONE stable live label while it grows -- the viewer keys each
// row's stopwatch on its label path -- and its newest command as the leaf, until it closes. An open burst
// is headed by what it began with ("Clicked (5,5) …") until it closes, then by its bulk. A closed group or
// burst carries the time its COMMANDS took (" · 3s"; never a pause). A failure or bad answer leads with ⚠,
// a live one is sent as `warn` (amber), and it STAYS visible when its step or sub-step folds away. The
// most telling part of a label (a count, a result, a failure) comes first: the panel is ~40 characters.
// Sibling rows that share a label are numbered (#2) so their stopwatches can't collide. The tree has ONE
// root, the current task. render() stays inside the relay's clamp (depth <= 4, <= 60 nodes, <= 24
// siblings, labels <= 100) by windowing older rows into "N earlier …" and trimming the least useful detail
// first -- never the current action.
// Pure: no I/O and no timers (the caller owns both), an injectable clock for tests; it never throws on
// odd input (the serve wraps it anyway: the tree is display-only and must never take a session down).

const BUDGET = 56;                          // the relay clamps a tree at 60 nodes; keep headroom
const THINK = 'Planning the next step';
const CAP_TASKS = 200, CAP_STEPS = 400, CAP_ITEMS = 400;

// ---- strings ----------------------------------------------------------------------------------------
// A command is JSON a driver wrote, so a field can be any shape -- even {"toString":1}, which makes String()
// and Number() THROW (a review crashed the serve that way). Every input value is converted through these.
const str = (v) => { if (typeof v === 'string') return v; if (v == null) return ''; try { return String(v); } catch (_) { return ''; } };
const num = (v) => { let n; try { n = Number(v); } catch (_) { return 0; } return Number.isFinite(n) ? n : 0; };
// lookup tables with no prototype, so a command named "constructor" or "__proto__" finds nothing
const table = (o) => Object.freeze(Object.assign(Object.create(null), o));
const vis = (s) => str(s).replace(/\r/g, '').replace(/\n/g, '⏎').replace(/\t/g, '⇥');
// cut to n chars with an ellipsis, never splitting a surrogate pair (a lone half renders as U+FFFD)
const cut = (s, n) => {
  s = str(s);
  if (s.length <= n) return s;
  let k = Math.max(1, n - 1);
  const c = s.charCodeAt(k - 1);
  if (c >= 0xD800 && c <= 0xDBFF) k--;
  return s.slice(0, Math.max(0, k)) + '…';
};
// ...or at the last space before it, so a list of key names is never cut mid-name
const cutWords = (s, n) => { s = str(s); if (s.length <= n) return s; const sp = s.lastIndexOf(' ', n - 1); return sp > n / 3 ? s.slice(0, sp) + ' …' : cut(s, n); };
const clip = (s, n) => cut(vis(s).replace(/\s+/g, ' ').trim(), n);
const capFirst = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const lowerFirst = (s) => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;   // only ever applied to this file's own phrases
const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
const pt = (x, y) => '(' + Math.round(num(x)) + ',' + Math.round(num(y)) + ')';
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
const js = (v) => { try { return str(JSON.stringify(v)).slice(0, 200); } catch (_) { return ''; } };

// ---- URLs: the address, never the secret in it ------------------------------------------------------
// A path segment or host label that looks like a TOKEN (long, with letters AND digits) is elided: a share
// link, a reset link or a tunnel host carries its secret exactly there, where "host + path" showed it.
const tokenish = (s) => s.length >= 10 && /\d/.test(s) && /[a-z]/i.test(s);
function cleanUrl(u, hostOnly) {
  let s = str(u).trim();
  const scheme = (/^[a-z][a-z0-9+.-]*:\/\//i.exec(s) || [''])[0];
  s = s.slice(scheme.length).replace(/^[^/]*@/, '');            // user:password@ FIRST -- a password may hold ? or #
  const q = /[?#;]/.exec(s), body = q ? s.slice(0, q.index) : s;  // never the query, fragment or ;jsessionid=
  const i = body.indexOf('/'), host = i < 0 ? body : body.slice(0, i), path = i < 0 ? '' : body.slice(i);
  const h = host.split('.').map((x) => tokenish(x) ? '…' : x).join('.');
  const p = hostOnly ? '' : path.split('/').map((x) => tokenish(x) ? '…' : x).join('/');
  return { scheme, url: (h + p).replace(/\/+$/, ''), more: !!q };
}
const shortUrl = (u, hostOnly) => cut(cleanUrl(u, hostOnly).url, 40);
// Typed text shown with show:1 still never carries a URL's secret parts (a driver "showing the address it
// typed" must not broadcast a magic link): every URL-looking word in it is cleaned the same way.
const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S|^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/i;
const redactShown = (t) => str(t).split(/(\s+)/).map((w) => { if (!URLISH.test(w)) return w; const c = cleanUrl(w); return c.scheme + c.url + (c.more ? '?…' : ''); }).join('');

// ---- naming a key the way a person reads it -------------------------------------------------------
const KEY_GLYPH = table({ Enter: '⏎', NumpadEnter: '⏎', Tab: '⇥', Backspace: '⌫', Delete: '⌦', Escape: 'Esc',
                          ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn',
                          Home: 'Home', End: 'End', Insert: 'Ins' });
const NON_CHAR = /^(F\d{1,2}|Shift|Control|Alt|Meta|OS|CapsLock|NumLock|ScrollLock|PrintScreen|Pause|ContextMenu)/;
const CHAR_OF = table({ Space: ' ', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
                        Comma: ',', Period: '.', Slash: '/', Backquote: '`', NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*',
                        NumpadDivide: '/', NumpadDecimal: '.' });
// does pressing this key TYPE a character (and so count as text, hidden like any other typing)?
const isCharKey = (code) => { const c = str(code) || 'Enter'; return !KEY_GLYPH[c] && !NON_CHAR.test(c); };
function keyName(code) {
  const c = str(code) || 'Enter';
  if (KEY_GLYPH[c]) return KEY_GLYPH[c];
  let m;
  if ((m = /^Key([A-Z])$/.exec(c))) return m[1].toLowerCase();
  if ((m = /^(?:Digit|Numpad)(\d)$/.exec(c))) return m[1];
  if (CHAR_OF[c] != null) return c === 'Space' ? '␣' : CHAR_OF[c];
  return c;
}
const charOf = (code) => { const c = str(code); let m; if ((m = /^Key([A-Z])$/.exec(c))) return m[1].toLowerCase(); if ((m = /^(?:Digit|Numpad)(\d)$/.exec(c))) return m[1]; return CHAR_OF[c] != null ? CHAR_OF[c] : '?'; };
const modsOf = (mod) => (str(mod) || 'ControlLeft').split(/[+,\s]+/).filter(Boolean);
const modName = (mod) => modsOf(mod).map((x) =>
  /^Control/i.test(x) ? 'Ctrl' : /^Shift/i.test(x) ? 'Shift' : /^Alt/i.test(x) ? 'Alt' : /^(Meta|OS|Super)/i.test(x) ? 'Super' : x).join('+');
function chordName(cmd) { const k = keyName((cmd && cmd.code) || 'KeyA'); return modName(cmd && cmd.mod) + '+' + (k.length === 1 ? k.toUpperCase() : k); }
// Shift and/or AltGr on a character key TYPES that character (a capital, a symbol): typed text, hidden like
// any other -- not a shortcut to name ("Shift+A" on the panel spelled out a password a capital at a time)
const typingChord = (c) => isCharKey(c.code) && !!str(c.code) && modsOf(c.mod).every((m) => /^(Shift|AltRight|AltGraph)/i.test(m));
const aim = (c) => (typeof c.at === 'string' && c.at) ? "'" + clip(c.at, 30) + "'" : pt(c.x, c.y);
const reveals = (c) => !!(c && c.show) && !(c && c.secret);
const listOf = (v) => Array.isArray(v) ? v : [];
const word = (c) => c.secret ? '' : "'" + clip(c.text, 30) + "'";   // a word ON the screen -- unless the driver hides it

// ---- the atomic action, as it happens (present) and once done (past) ------------------------------
function actPhrase(cmd) {
  const c = cmd || {};
  switch (c.do) {
    case 'keys': { const t = str(c.text); const how = c.human ? ' like a person' : ''; return reveals(c) ? "Typing '" + cut(vis(redactShown(t)), 30) + "'" + how : (t.length === 1 ? 'Typing a character' + how : 'Typing ' + plural(t.length, 'character') + how); }
    case 'press': return isCharKey(c.code) ? (reveals(c) ? "Typing '" + vis(charOf(c.code)) + "'" : 'Typing a character') : 'Pressing ' + keyName(c.code);
    case 'chord': return typingChord(c) && !reveals(c) ? 'Typing a character' : 'Pressing ' + chordName(c);
    case 'click': return 'Clicking ' + aim(c);
    case 'dbl': return 'Double-clicking ' + aim(c);
    case 'right': return 'Right-clicking ' + aim(c);
    case 'clicks': return 'Clicking ' + plural(listOf(c.at).length, 'point');
    case 'clickText': return c.secret ? 'Clicking a word' : 'Clicking the word ' + word(c);
    case 'stroke': return 'Drawing a stroke (' + plural(listOf(c.points).length, 'point') + ')';
    case 'strokes': return 'Drawing ' + plural(listOf(c.list).length, 'stroke');
    case 'scroll': { const n = num(c.n); return 'Scrolling ' + (n < 0 ? '↓' : '↑') + Math.abs(n) + (c.x != null ? ' at ' + pt(c.x, c.y) : ''); }
    case 'open': return 'Opening ' + shortUrl(c.url, !!c.secret);
    case 'shot': return 'Capturing the screen';
    case 'look': return 'Looking at the screen';
    case 'hold': return 'Taking a fresh picture';
    case 'see': return 'Reading part of the picture';
    case 'probe': return 'Checking pixel ' + pt(c.x, c.y);
    case 'census': return 'Finding the regions on screen';
    case 'flood': return 'Previewing a fill at ' + pt(c.x, c.y);
    case 'diff': return 'Checking what changed';
    case 'mark': return 'Marking a baseline picture';
    case 'ocr': return 'Reading the text on screen';
    case 'find': return c.secret ? 'Looking for a word' : 'Looking for ' + word(c);
    case 'liveness': return 'Checking the capture is live';
    case 'expect': return 'Checking the screen';
    case 'wait': return 'Waiting for the screen';
    case 'ping': return 'Checking the connection';
    case 'humanize': return 'Rewriting text (Humanize)';
    case 'aicheck': return 'Checking text for AI';
    case 'chat': return c.to ? 'Sending a direct message' : 'Posting to the session chat';
    case 'chat-img': return c.to ? 'Sending an image privately' : 'Posting an image to the chat';
    case 'chat-wait': return 'Waiting for a reply';
    case 'confirm': return 'Asking for a go-ahead';
    case 'captcha': return 'Waiting for you to solve the CAPTCHA';
    case 'access': return 'Asking you for more access';
    case 'windows': return 'Listing the open windows';
    case 'controls': return 'Reading the controls of a window';
    case 'focus': return 'Bringing a window to the front';
    case 'launch': return 'Starting an app';
    case 'terminal': return c.input != null ? 'Typing in the Terminal' : 'Using the Terminal';
    case 'note-add': return 'Leaving a sticky note';
    case 'note-done': return 'Crossing off a sticky note';
    case 'note-list': return 'Reading the sticky notes';
    case 'spotlight': return 'Pointing something out';
    case 'beam': return 'Highlighting a spot';
    case 'spotlight-off': return 'Clearing the highlight';
    case 'plan': return 'Running a batch of ' + plural(listOf(c.steps).length, 'step');
    case 'lock': return c.on ? 'Taking exclusive control' : 'Releasing control';
    case 'exec': return 'Running a command on the host';
    case 'reconnect': return 'Reconnecting';
    default:
      if (c.if) return 'Checking a condition';
      if (c.until) return 'Repeating until it holds';
      if (c.repeat !== undefined) return 'Repeating ' + plural(Math.max(1, Math.min(500, num(c.repeat) || 20)), 'time');
      return "Running '" + clip(c.do || '?', 20) + "'";
  }
}
function pastPhrase(cmd) {
  const c = cmd || {};
  switch (c.do) {
    case 'shot': return 'Captured the screen';
    case 'look': return 'Looked at the screen';
    case 'hold': return 'Took a fresh picture';
    case 'see': return 'Read part of the picture';
    case 'probe': return 'Checked pixel ' + pt(c.x, c.y);
    case 'census': return 'Found the regions on screen';
    case 'flood': return 'Previewed a fill at ' + pt(c.x, c.y);
    case 'diff': return 'Checked what changed';
    case 'mark': return 'Marked a baseline picture';
    case 'ocr': return 'Read the text on screen';
    case 'find': return c.secret ? 'Looked for a word' : 'Looked for ' + word(c);
    case 'liveness': return 'Checked the capture is live';
    case 'expect': return 'Checked the screen';
    case 'wait': return 'Waited for the screen';
    case 'ping': return 'Checked the connection';
    case 'humanize': return 'Rewrote text (Humanize)';
    case 'aicheck': return 'Checked text for AI';
    case 'chat': return c.to ? 'Sent a direct message' : 'Posted to the session chat';
    case 'chat-img': return c.to ? 'Sent an image privately' : 'Posted an image to the chat';
    case 'chat-wait': return 'Waited for a reply';
    case 'confirm': return 'Asked for a go-ahead';
    case 'captcha': return 'Asked you to solve a CAPTCHA';
    case 'access': return 'Asked you for more access';
    case 'windows': return 'Listed the open windows';
    case 'controls': return 'Read the controls of a window';
    case 'focus': return 'Brought a window to the front';
    case 'launch': return 'Started an app';
    case 'terminal': return c.input != null ? 'Typed in the Terminal' : 'Used the Terminal';
    case 'note-add': return 'Left a sticky note';
    case 'note-done': return 'Crossed off a sticky note';
    case 'note-list': return 'Read the sticky notes';
    case 'spotlight': return 'Pointed something out';
    case 'beam': return 'Highlighted a spot';
    case 'spotlight-off': return 'Cleared the highlight';
    case 'plan': return 'Ran a batch of ' + plural(listOf(c.steps).length, 'step');
    case 'lock': return c.on ? 'Took exclusive control' : 'Released control';
    case 'exec': return 'Ran a command on the host';
    case 'reconnect': return 'Reconnected';
    case 'open': return 'Opened ' + shortUrl(c.url, !!c.secret);
    default: return lowerFirstPast(actPhrase(c));
  }
}
const lowerFirstPast = (p) => p.replace(/^Running /, 'Ran ').replace(/^Repeating /, 'Repeated ').replace(/^Checking a condition/, 'Checked a condition')
  .replace(/^Typing /, 'Typed ').replace(/^Pressing /, 'Pressed ').replace(/^Clicking /, 'Clicked ').replace(/^Double-clicking /, 'Double-clicked ')
  .replace(/^Right-clicking /, 'Right-clicked ').replace(/^Drawing /, 'Drew ').replace(/^Scrolling /, 'Scrolled ');
// The leaf under a run never quotes a typed character, shown or not: a word typed one key per command
// would otherwise be spelled out a frame at a time.
const maskedPhrase = (c) => actPhrase(Object.assign({}, c, { show: 0 }));
// What a command's ANSWER adds -- a look is only half told without what it saw. Never a message's text.
const RESULT_VERBS = new Set(['expect', 'wait', 'find', 'liveness', 'ping', 'chat-wait', 'confirm', 'captcha', 'access', 'plan']);
function resPhrase(cmd, r) {
  const c = cmd || {}, x = r || {};
  if (x.ok === false && !RESULT_VERBS.has(c.do)) return '→ failed';
  switch (c.do) {
    case 'probe': return x.is ? '→ ' + clip(x.is, 12) : '';
    case 'shot': return x.w ? '(' + num(x.w) + '×' + num(x.h) + ')' : '';
    case 'look': return x.w ? '(' + num(x.w) + '×' + num(x.h) + ')' : '';
    case 'liveness': return x.state ? '→ ' + clip(x.state, 12) : (x.ok === false ? '→ failed' : '');
    case 'find': return x.found ? '→ found' : '→ not found';
    case 'ocr': { const w = typeof x.words === 'number' ? x.words : Array.isArray(x.words) ? x.words.length : null; return w != null ? '→ ' + plural(num(w), 'word') : ''; }
    case 'expect': case 'wait': return x.ok ? '→ yes' : '→ not yet';
    case 'ping': return x.alive ? '→ alive' : '→ no reply';
    case 'chat-wait': return (x.ok && x.text) ? (x.dm ? '→ got a direct reply' : '→ got a reply') : '→ no reply';
    case 'confirm': return x.verdict ? '→ ' + clip(x.verdict, 12) : '';
    case 'captcha': return x.ok === false ? '→ no reply' : x.solved === false ? '→ not solved' : '→ solved';
    case 'access': return x.ok ? '→ allowed' : x.refused ? '→ declined' : '→ not allowed';
    case 'note-list': return Array.isArray(x.notes) ? '→ ' + plural(x.notes.length, 'note') : '';
    // `ran` is the 1-based TOP-LEVEL step a batch stopped on (stoppedAt.at can be a branch's own index)
    case 'plan': return x.ok ? '→ all done' : '→ stopped at step ' + (num(x.ran) || ((x.stoppedAt && x.stoppedAt.at != null) ? num(x.stoppedAt.at) + 1 : '?'));
    case 'exec': return x.ok ? '→ exit ' + (x.code != null ? num(x.code) : 0) : '';
    default: return '';
  }
}
// an outcome worth a warning glyph: an input refused, a look that came back empty, a batch that stopped
const BAD_RESULT = /^→ (failed|not found|no reply|not yet|stopped|blank|frozen|unknown|cancelled|unclear)/;

// ---- which commands make one group ----------------------------------------------------------------
const CLS = table({
  keys: 'kb', press: 'kb', chord: 'kb',
  click: 'ptr', clicks: 'ptr', dbl: 'ptr', right: 'ptr', clickText: 'ptr',
  stroke: 'drag', strokes: 'drag', scroll: 'scroll', open: 'open',
  shot: 'look', look: 'look', hold: 'look', see: 'look', probe: 'look', census: 'look', flood: 'look', diff: 'look', mark: 'look',
  ocr: 'look', find: 'look', liveness: 'look', expect: 'look', wait: 'look', ping: 'look',
  chat: 'talk', 'chat-img': 'talk', 'chat-wait': 'talk', confirm: 'talk', captcha: 'talk',
  'note-add': 'note', 'note-done': 'note', 'note-list': 'note',
  spotlight: 'spot', beam: 'spot', 'spotlight-off': 'spot',
  plan: 'plan', lock: 'sys', exec: 'sys', reconnect: 'sys', access: 'sys', focus: 'sys', launch: 'sys', terminal: 'sys',
  windows: 'look', controls: 'look',
});
// consecutive commands of these kinds merge; the rest are one group each (a chat, an open, a batch...)
const MERGE = new Set(['kb', 'ptr', 'drag', 'scroll', 'look', 'note', 'spot']);
const INPUT = new Set(['kb', 'ptr', 'drag', 'scroll']);       // an input fails or lands; a look answers
// not actions at all: the panel's own verbs and chat housekeeping
const NOT_ACTIONS = new Set(['status', 'think', 'warn', 'seen', 'typing', 'inbox', 'quit', 'done', 'mission']);
// CONVERSATION and housekeeping are not new work: after a finish, a check-in (chat-wait for "anything else?"),
// a receipt, a liveness ping, a reconnect, handing back the lock or crossing off the task's sticky note must
// not turn a green panel back to live and reopen the finished task. (A `mission` operation that DOES declare
// more work -- a follow-up milestone -- lifts the green itself, through its own declaration.)
const CONVERSATION = new Set(['chat', 'chat-img', 'chat-wait', 'confirm', 'seen', 'typing', 'inbox', 'think', 'warn', 'note-list', 'ping',
                              'reconnect', 'lock', 'note-add', 'note-done', 'spotlight-off', 'mission']);
const isAction = (cmd) => !!(cmd && typeof cmd.do === 'string' && !NOT_ACTIONS.has(cmd.do));
const isConversation = (cmd) => !!(cmd && CONVERSATION.has(cmd.do));
const NOUN = table({ shot: ['screenshot'], look: ['look', 'looks'], hold: ['fresh picture'], see: ['region read'], probe: ['pixel check'], census: ['region scan'],
                     flood: ['fill preview'], diff: ['change check'], mark: ['baseline'], ocr: ['text read'], find: ['search', 'searches'],
                     liveness: ['liveness check'], expect: ['screen check'], wait: ['wait'], ping: ['connection check'],
                     'note-add': ['note left', 'notes left'], 'note-done': ['note crossed off', 'notes crossed off'],
                     'note-list': ['look at the notes', 'looks at the notes'], spotlight: ['spotlight'], beam: ['highlight'],
                     'spotlight-off': ['highlight cleared', 'highlights cleared'] });
const nounOf = (k, n) => { const e = NOUN[k] || [k]; return plural(n, e[0], e[1]); };
// the stable label of a merged row while it grows (the viewer keys its stopwatch on it)
const KIND_LIVE = table({ ptr: 'Clicking…', drag: 'Drawing…', scroll: 'Scrolling…', look: 'Looking…', note: 'Working on sticky notes…', spot: 'Pointing things out…' });
const TALK_LIVE = table({ chat: 'posting to chat…', 'chat-img': 'posting an image…', 'chat-wait': 'waiting for a reply…', confirm: 'asking for a go-ahead…' });
// What a group keeps of a command: only what its labels read (a recorded 200-step batch used to pin the
// whole batch, and every look its whole command, for the life of the session).
const sparse = (a) => Array.isArray(a) ? new Array(Math.min(a.length, 100000)) : undefined;
const slim = (c) => ({ do: c.do, x: c.x, y: c.y, n: c.n, code: c.code, mod: c.mod, repeat: c.repeat,
                       at: typeof c.at === 'string' ? c.at.slice(0, 60) : sparse(c.at), text: typeof c.text === 'string' ? c.text.slice(0, 60) : undefined,
                       url: typeof c.url === 'string' ? c.url.slice(0, 400) : undefined, to: c.to ? 1 : 0, on: !!c.on, show: c.show ? 1 : 0,
                       secret: c.secret ? 1 : 0, steps: sparse(c.steps), points: sparse(c.points), list: sparse(c.list), if: !!c.if, until: !!c.until });
// A poll's identity: the same verb on the same thing. Only an identical look rejoins a run across a pause.
const pollSig = (c) => str(c.do) + '|' + num(c.x) + ',' + num(c.y) + '|' + str(c.text).slice(0, 60) + '|' + (typeof c.at === 'string' ? c.at : '') + '|' + js(c.until || c.expect || c.rect || '');

function accum(g, c) {
  g.n++;
  const d = g.d;
  switch (g.cls) {
    case 'kb': {
      d.segs = d.segs || [];
      const reveal = reveals(c);
      const addText = (v, n) => {
        const last = d.segs[d.segs.length - 1];
        if (last && last.k === 't' && last.shown === reveal) { last.n += n; if (reveal) { if (last.v.length < 200) last.v += v; else last.more = true; } }
        else d.segs.push({ k: 't', n, v: reveal ? v.slice(0, 200) : '', shown: reveal, more: reveal && v.length > 200 });
        d.chars = (d.chars || 0) + n; d.anyText = true;
      };
      const named = (v) => { d.segs.push({ k: 'c', v }); d.keys = (d.keys || 0) + 1; };
      if (c.do === 'keys') { const t = str(c.text); addText(t, t.length); }
      else if (c.do === 'press') {
        if (isCharKey(c.code)) addText(charOf(c.code), 1);
        else {
          const last = d.segs[d.segs.length - 1], v = keyName(c.code);
          if (last && last.k === 'k') { last.n++; if (last.v.length < 60) last.v.push(v); } else d.segs.push({ k: 'k', v: [v], n: 1 });
          d.keys = (d.keys || 0) + 1;
        }
      } else if (typingChord(c)) {
        // a typed capital or symbol: text like the rest (a shown Shift+letter reads as its capital)
        const m = /^Key([A-Z])$/.exec(str(c.code)), shiftOnly = modsOf(c.mod).every((x) => /^Shift/i.test(x));
        if (reveal && !(m && shiftOnly)) named(chordName(c)); else addText(m ? m[1] : '', 1);
      } else named(chordName(c));
      if (d.segs.length > 30) d.segs.splice(12, d.segs.length - 24, { k: 'x' });   // a very long, very mixed run keeps head and tail
      break;
    }
    case 'ptr': {
      d.kinds = d.kinds || Object.create(null);
      const list = c.do === 'clicks' ? listOf(c.at) : null;
      const add = list ? list.length : 1;
      d.clicks = (d.clicks || 0) + add;
      d.kinds[c.do] = (d.kinds[c.do] || 0) + add;
      if (list) { const p = list[list.length - 1]; if (Array.isArray(p)) d.last = pt(p[0], p[1]); }
      else d.last = c.do === 'clickText' ? (c.secret ? 'a word' : "'" + clip(c.text, 24) + "'") : aim(c);
      break;
    }
    case 'drag': {
      const sl = c.do === 'strokes' ? listOf(c.list) : null;
      d.strokes = (d.strokes || 0) + (sl ? sl.length : 1);
      d.points = (d.points || 0) + (sl ? sl.reduce((n, s) => n + (s && Array.isArray(s.points) ? s.points.length : Array.isArray(s) ? s.length : 0), 0) : listOf(c.points).length);
      break;
    }
    case 'scroll': { const n = num(c.n); if (n < 0) d.down = (d.down || 0) - n; else d.up = (d.up || 0) + n; if (c.x != null) d.at = pt(c.x, c.y); break; }
    case 'look': case 'note': case 'spot': {
      d.by = d.by || Object.create(null); d.by[c.do] = (d.by[c.do] || 0) + 1; d.cmd = slim(c); d.res = '';
      const sig = g.cls === 'look' ? pollSig(c) : '';
      d.sig = g.n === 1 ? sig : (d.sig === sig ? sig : '');
      break;
    }
    default: d.cmd = slim(c); d.res = ''; d.quiet = !!c.quiet; if (c.do === 'plan') d.mix = batchMix(c.steps);
  }
}

// What a batch DOES, read from its own steps -- "12 clicks, 1 look, typing" -- the title a watcher can use,
// where "Ran a batch of 14 steps → all 14 done" told them nothing (reported twice: "useless" titles).
// Counts only: never the text it types. Its own narration (status / think) is not work.
const MIX_NOUN = table({ ptr: ['click', 'clicks'], look: ['look', 'looks'], drag: ['stroke', 'strokes'], scroll: ['scroll', 'scrolls'],
                         talk: ['message', 'messages'], note: ['sticky-note step', 'sticky-note steps'], spot: ['pointer', 'pointers'],
                         open: ['page opened', 'pages opened'], sys: ['system step', 'system steps'], plan: ['inner batch', 'inner batches'],
                         keys: ['key press', 'key presses'], other: ['other step', 'other steps'] });
function batchMix(steps) {
  const counts = new Map();
  let typing = 0;
  const add = (k, n) => counts.set(k, (counts.get(k) || 0) + n);
  for (const s of listOf(steps).slice(0, 5000)) {
    const c = s && typeof s === 'object' ? s : {};
    if (c.do === 'status' || c.do === 'think' || c.do === 'warn') continue;
    if (c.if || c.until || c.repeat !== undefined) { add('other', 1); continue; }
    const cls = CLS[c.do] || 'other';
    if (cls === 'kb') {
      if (c.do === 'keys') typing += str(c.text).length || 1;
      else if ((c.do === 'press' && isCharKey(c.code)) || (c.do === 'chord' && typingChord(c))) typing++;
      else add('keys', 1);
    } else add(cls, cls === 'ptr' && c.do === 'clicks' ? listOf(c.at).length : cls === 'drag' && c.do === 'strokes' ? listOf(c.list).length : 1);
  }
  const parts = [...counts.entries()].map(([k, n]) => ({ n, s: plural(n, MIX_NOUN[k][0], MIX_NOUN[k][1]) }));
  if (typing) parts.push({ n: typing, s: 'typing' });
  parts.sort((a, b) => b.n - a.n);
  return parts.slice(0, 3).map((p) => p.s).join(', ') + (parts.length > 3 ? ', …' : '');
}

// ---- describing a group ----------------------------------------------------------------------------
// A run of special keys: single glyphs run together (↓←↓←), names are spaced and repeats collapse (PgDn ×8).
function keyRun(seg, max) {
  const v = seg.v || [];
  if (v.every((x) => [...x].length === 1)) return cut(v.join(''), max) + (seg.n > v.length && v.join('').length <= max ? '…' : '');
  const toks = [];
  for (const x of v) { const t = toks[toks.length - 1]; if (t && t.v === x) t.n++; else toks.push({ v: x, n: 1 }); }
  return cutWords(toks.map((t) => t.n > 1 ? t.v + ' ×' + t.n : t.v).join(' '), max);
}
const textOf = (s) => s.shown ? "'" + cut(vis(redactShown(s.v)), 40) + (s.more && s.v.length <= 40 ? '…' : '') + "'" : s.n === 1 ? 'a character' : plural(s.n, 'character');
function kbBody(d, live) {
  const parts = (d.segs || []).map((s) => s.k === 't' ? { k: 't', s: textOf(s) } : s.k === 'k' ? { k: 'k', n: s.n, s: keyRun(s, 24) } : s.k === 'c' ? { k: 'c', s: s.v } : { k: 'x', s: '…' });
  if (parts.length === 1) {
    const p = parts[0];
    if (p.k === 't') return (live ? 'typing ' : 'typed ') + p.s;
    if (p.k === 'k') return (live ? 'pressing ' : 'pressed ') + (p.n > 1 ? p.n + ' keys: ' : '') + p.s;
    if (p.k === 'c') return (live ? 'pressing ' : 'pressed ') + p.s;
  }
  return parts.map((p) => p.k === 't' ? (live ? 'typing ' : 'typed ') + p.s : (p.k === 'k' && p.n > 1) ? p.n + ' keys: ' + p.s : p.s).join(', ');
}
// The descriptive text, lower-case first so it reads alone (capitalised) and after an intent.
function gBody(g, live) {
  const d = g.d;
  switch (g.cls) {
    case 'kb': return kbBody(d, live);
    case 'ptr': {
      const k = d.kinds || {}, only = (v) => Object.keys(k).length === 1 && k[v];
      const verb = only('dbl') ? (live ? 'double-clicking' : 'double-clicked') : only('right') ? (live ? 'right-clicking' : 'right-clicked')
                 : only('clickText') ? (live ? 'clicking the word' : 'clicked the word') : (live ? 'clicking' : 'clicked');
      if (!d.clicks) return live ? 'clicking nothing' : 'clicked nothing';
      return d.clicks === 1 ? verb + ' ' + (d.last || '') : verb + ' ' + d.clicks + '×' + (d.last ? ' — last ' + d.last : '');
    }
    case 'drag': return (live ? 'drawing ' : 'drew ') + (num(d.strokes) === 1 ? 'a stroke' : num(d.strokes) + ' strokes') + ' (' + plural(num(d.points), 'point') + ')';
    case 'scroll': {
      const parts = []; if (d.down) parts.push('↓' + d.down); if (d.up) parts.push('↑' + d.up);
      return (live ? 'scrolling ' : 'scrolled ') + (parts.join(' ') || '0') + (d.at ? ' at ' + d.at : '');
    }
    case 'look': case 'note': case 'spot': {
      const by = d.by || {}, kinds = Object.keys(by), total = kinds.reduce((n, kk) => n + by[kk], 0);
      if (total <= 1) return lowerFirst(live ? actPhrase(d.cmd) : pastPhrase(d.cmd)) + (d.res ? ' ' + d.res : '');
      const lead = g.cls === 'look' ? 'looked ×' + total : g.cls === 'note' ? 'sticky notes ×' + total : 'pointed things out ×' + total;
      return lead + (d.res ? ' · last ' + d.res : '') + ' (' + kinds.map((kk) => nounOf(kk, by[kk])).join(', ') + ')';
    }
    // a batch by what it does, the same words while it runs (a stable label keeps its stopwatch); once done,
    // led by its own last status line when it narrated itself -- the most meaningful words it has
    case 'plan': {
      const n = listOf(d.cmd && d.cmd.steps).length, res = d.res ? ' ' + d.res : '';
      return !live && d.note ? d.note + ' · batch of ' + n + res : 'batch of ' + n + (d.mix ? ': ' + d.mix : '') + res;
    }
    default: return lowerFirst(live ? actPhrase(d.cmd) : pastPhrase(d.cmd)) + (d.res ? ' ' + d.res : '');
  }
}
const gIsBad = (g) => !!(g.d && (g.d.failed || (g.d.res && BAD_RESULT.test(g.d.res))));
// The row's label. A merged run while it grows: one STABLE label, so the viewer's stopwatch for it keeps
// running; the descriptive label once it closes, with the time its commands took (the viewer's own chip
// does not survive the relabel). A failure or a bad outcome leads with ⚠ -- live too, the moment it lands.
function gLabel(g, live) {
  const d = g.d;
  if (g.cls === 'ran') return d.label;                // a retired tool tree, kept where it ran ("Ran: …")
  if (live && g.n > 1) {
    if (g.intent) return clip(g.intent + '…', 100);
    if (g.cls === 'kb') return d.anyText ? 'Typing…' : 'Pressing keys…';
    return KIND_LIVE[g.cls] || 'Working…';
  }
  const desc = gBody(g, live);
  // an intent, or a batch's own narration, is the driver's own words: never re-cased
  let body = g.intent ? g.intent + ' — ' + desc : (g.cls === 'plan' && !live && d.note) ? desc : capFirst(desc);
  if (d.failed) body = '⚠ ' + (g.n === 1 ? 'Failed — ' : d.failed + ' of ' + g.n + ' failed — ') + (g.intent ? body : desc);
  else if (gIsBad(g)) body = '⚠ ' + body;
  const took = !live && num(g.busy) >= (g.n > 1 ? 1000 : 2000) ? ' · ' + dur(g.busy) : '';
  return clip(body, 100 - took.length) + took;
}
// A merged run's leaf: the newest command, and how far the run has got -- with ⚠ when its answer was bad.
const leafOf = (g, c, rp) => clip((rp && BAD_RESULT.test(rp) ? '⚠ ' : '') + (g.cls === 'kb' ? maskedPhrase(c) : actPhrase(c)) + (rp ? ' ' + rp : '') +
                                  (g.cls === 'plan' ? '' : ' · ' + g.n + ' so far'), 100);
// The short headline of a burst: its BULK (the biggest group), or -- while it is open -- what it began with.
function compactMain(g) {
  if (g.intent) return cut(g.intent, 26);
  if (g.cls === 'ran') return cut(g.d.label, 26);
  const d = g.d, segs = d.segs || [];
  switch (g.cls) {
    case 'kb': {
      const t = segs.find((s) => s.k === 't');
      if (t) return t.shown ? "typed '" + cut(vis(redactShown(t.v)), 14) + "'" : 'typed ' + plural(num(d.chars), 'char');
      const k = segs.find((s) => s.k === 'k');
      if (k) return k.n > 1 ? 'pressed ' + k.n + ' keys' : 'pressed ' + k.v[0];
      const c = segs.find((s) => s.k === 'c');
      return c ? 'pressed ' + c.v : 'typed';
    }
    case 'ptr': return d.clicks === 1 ? 'clicked ' + (d.last || '') : 'clicked ' + num(d.clicks) + '×';
    case 'drag': return 'drew ' + plural(num(d.strokes), 'stroke');
    case 'scroll': return 'scrolled';
    case 'look': { const tot = Object.values(d.by || {}).reduce((a, b) => a + b, 0); return tot > 1 ? 'looked ×' + tot : cut(lowerFirst(pastPhrase(d.cmd)), 26); }
    case 'plan': return cut('batch of ' + listOf(d.cmd && d.cmd.steps).length + (d.mix ? ': ' + d.mix : ''), 26);
    default: return cut(lowerFirst(pastPhrase(d.cmd)), 26);
  }
}
const kindLive = (g) => g.intent ? cut(g.intent, 24) + '…' : g.cls === 'kb' ? (g.d.anyText ? 'typing…' : 'pressing keys…') : g.cls === 'talk' ? (TALK_LIVE[g.d.cmd && g.d.cmd.do] || 'chatting…') : lowerFirst(KIND_LIVE[g.cls] || 'working…');

function create(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const defaultTask = clip(o.task || 'Working', 100) || 'Working';
  const budget = num(o.budget) > 0 ? num(o.budget) : BUDGET;
  const S = { tasks: [], thinking: false, inflight: false, cur: null, curStep: null, t0cmd: null };

  const newTask = (label) => {
    const nth = 1 + S.tasks.filter((t) => t.label === label).length;
    return { label, nth, done: false, steps: [], dropped: 0, t0: now() };
  };
  // kind: 'declared' (status {step}/{substep}: stays open), 'soft' (status {text}: closes at a pause), 'auto' (a burst)
  const pushStep = (task, label, kind) => {
    const nth = label ? 1 + task.steps.filter((s) => s.label === label && s.kind !== 'auto').length : 1;
    const st = { label, kind, nth, done: false, items: [], dropped: 0, droppedN: 0, t0: now(), t1: null, tLast: null, busy: 0 };
    task.steps.push(st);
    if (task.steps.length > CAP_STEPS) { const k = task.steps.length - (CAP_STEPS - 100); task.steps.splice(0, k); task.dropped += k; }
    return st;
  };
  const pushSub = (st, label, kind) => {
    const nth = 1 + st.items.filter((it) => it.sub && it.label === label).length;
    const sub = { sub: true, label, kind, nth, done: false, items: [], dropped: 0, droppedN: 0 };
    st.items.push(sub); capItems(st);
    return sub;
  };
  const capItems = (owner) => {
    const arr = owner.items;
    if (arr.length > CAP_ITEMS) {
      const k = arr.length - (CAP_ITEMS - 100), gone = arr.splice(0, k);
      owner.dropped += k; owner.droppedN += gone.reduce((n, it) => n + actionsIn(it), 0);
      owner.droppedBad = (owner.droppedBad || 0) + gone.reduce((n, it) => n + badCount(it), 0);
    }
  };
  const curTask = (make) => {
    let t = S.tasks[S.tasks.length - 1];
    if (!t && make) { t = newTask(defaultTask); S.tasks.push(t); }
    return t;
  };
  const openStep = (task) => { const s = task && task.steps[task.steps.length - 1]; return s && !s.done ? s : null; };
  const container = (step) => { const it = step.items[step.items.length - 1]; return (it && it.sub && !it.done) ? it : step; };
  // a group is CLOSED: no longer live, and no longer one command away from reopening as a run
  const closeGroup = (cont) => { const it = cont && cont.items[cont.items.length - 1]; if (it && !it.sub) { it.done = true; it.leaf = ''; it.settled = false; } };
  const closeSub = (st) => { const c = container(st); if (c === st) return false; closeGroup(c); c.done = true; return true; };
  const closeStep = (step) => {
    if (!step || step.done) return;
    const c = container(step); closeGroup(c);
    if (c !== step) { c.done = true; closeGroup(step); }
    step.done = true;
    step.t1 = (step.kind !== 'declared' && step.tLast != null) ? step.tLast : now();
  };
  // a finish SEALS the last step: work after it gets a step of its own (the poll merge must not reach back)
  const closeTask = (task) => { if (!task) return; closeStep(openStep(task)); const ls = task.steps[task.steps.length - 1]; if (ls) ls.sealed = true; task.done = true; };
  const reopen = (task) => { if (task.done) task.done = false; };

  function stepLabel(st) {
    if (st.kind !== 'auto') return st.label || 'Step';
    const gs = st.items.filter((it) => !it.sub);
    if (!gs.length) return 'Starting…';
    if (!st.done) {
      // An OPEN burst keeps ONE label from its second group on -- what it began with -- because the viewer
      // keys every stopwatch on the label PATH: a headline that changed at each group ("+1 · typing…",
      // "+2 · looking…") restarted the burst's timer and every child's. Its summary comes when it closes.
      if (gs.length < 2) return capFirst(kindLive(gs[0]));
      if (!st.head) st.head = clip(capFirst(compactMain(gs[0])) + ' …', 100);
      return st.head;
    }
    // a closed one-group burst has no rows under it, so its label is that group's FULL description
    if (gs.length === 1 && !st.dropped) return gLabel(gs[0], false);
    const main = gs.reduce((a, b) => (b.n > a.n ? b : a));
    const others = gs.length - 1 + (st.dropped || 0);
    const took = num(st.busy) >= 1000 ? ' · ' + dur(st.busy) : '';   // the time its commands took, never a pause
    return clip((gs.some(gIsBad) ? '⚠ ' : '') + capFirst(compactMain(main)) + (others > 0 ? ' +' + others : ''), 100 - took.length) + took;
  }

  // ---- inputs ---------------------------------------------------------------------------------------
  // `status` markers. `auto` = no explicit tree / flat plan is in charge. `inPlan` = sent from INSIDE a
  // batch: structure declared there is the batch's business, so the batch keeps its own row -- but a FINISH
  // still finishes the task (else the panel went green over a task still shown as running).
  // Returns whether the tree CHANGED: re-declaring what is already current is a no-op (it keeps even the
  // "Planning" row), so a driver that repeats its step on every turn costs nothing.
  function mark(cmd, auto, inPlan) {
    const c = cmd || {};
    if (inPlan) {
      const t = c.fin && auto ? curTask(false) : null;
      if (!t || t.done) return false;
      closeTask(t); S.thinking = false; S.cur = null; S.curStep = null;
      return true;
    }
    let ch = false;
    if (typeof c.task === 'string' && c.task.trim()) {
      const cur = curTask(false), label = clip(c.task, 100);
      if (cur && cur.label === label) { if (cur.done) { reopen(cur); ch = true; } }   // the same task again: reopen it, never a twin
      else if (cur && !cur.done && !cur.steps.length && !cur.dropped) { cur.label = label; cur.nth = 1 + S.tasks.filter((t) => t !== cur && t.label === label).length; cur.t0 = now(); ch = true; }   // the unused connect-time task BECOMES it
      else {
        // the task left behind keeps only what numbering reads: only the current task is ever drawn
        if (cur) { closeTask(cur); S.tasks[S.tasks.length - 1] = { label: cur.label, nth: cur.nth, done: true, steps: [], dropped: 0 }; }
        S.tasks.push(newTask(label));
        if (S.tasks.length > CAP_TASKS) S.tasks.splice(0, S.tasks.length - CAP_TASKS);
        ch = true;
      }
    }
    if (typeof c.step === 'string' || c.step === null) {
      const task = curTask(true), open = openStep(task), label = c.step ? clip(c.step, 100) : '';
      const mid = typeof c.mid === 'string' ? c.mid.slice(0, 12) : '';
      if (!label) { if (open) { closeStep(open); ch = true; } }                       // step:'' / null ends it (a finished task stays finished)
      else if (mid) {
        // A MILESTONE'S ROW (core/mission.js). The same milestone again -- one set aside while another went
        // first, now taken up again -- is the SAME row, its history kept and its stopwatch going on, never a "#2".
        if (open && open.mid === mid) { if (open.label !== label) { open.label = label; ch = true; } }
        else {
          reopen(task); closeStep(open);
          let i = -1;
          for (let k = task.steps.length - 1; k >= 0; k--) if (task.steps[k].mid === mid) { i = k; break; }
          if (i >= 0) { const st = task.steps.splice(i, 1)[0]; st.done = false; st.t1 = null; st.sealed = false; st.label = label; task.steps.push(st); }
          else pushStep(task, label, 'declared').mid = mid;
          ch = true;
        }
      }
      else if (!(open && open.kind === 'declared' && !open.fromSub && open.label === label)) { reopen(task); closeStep(open); pushStep(task, label, 'declared'); ch = true; }
    } else if (auto && typeof c.text === 'string' && c.text.trim() && !c.tree && !Array.isArray(c.steps) && c.at == null &&
               !c.fin && c.substep === undefined && c.task === undefined) {
      // a plain line from an ad-hoc driver is a SOFT step: it closes at the pause after its work, so one
      // banner can't swallow the rest of the run. Under a declared step it is a soft sub-step instead --
      // except while a DECLARED sub-step is open: a plain line must not close that ("Chunk 2 of 3" went ✓
      // mid-chunk), and the relay's depth limit leaves no level under it, so there it is only the live line.
      const task = curTask(true), open = openStep(task), label = clip(c.text, 100);
      if (open && open.kind === 'declared') {
        const cur = container(open);
        if ((cur === open || cur.kind === 'soft') && !(cur !== open && cur.label === label)) { reopen(task); closeSub(open); closeGroup(open); pushSub(open, label, 'soft'); ch = true; }
      } else if (!(open && open.kind === 'soft' && open.label === label)) { reopen(task); closeStep(open); pushStep(task, label, 'soft'); ch = true; }
    }
    if (typeof c.substep === 'string') {
      const task = curTask(true), st = openStep(task), label = clip(c.substep, 100);
      if (!label) {                                                                   // substep:'' ends the sub-step only
        if (st && st.fromSub) { closeStep(st); ch = true; }
        else if (st && st.kind === 'declared' && closeSub(st)) ch = true;
      }
      else if (!st || st.kind !== 'declared' || st.fromSub) {
        // nothing declared to nest in: sub-steps become SIBLINGS at the step level (never one inside the other)
        if (!(st && st.fromSub && st.label === label)) { reopen(task); closeStep(st); pushStep(task, label, 'declared').fromSub = true; ch = true; }
      } else {
        const cur = container(st);
        if (!(cur !== st && cur.label === label)) { reopen(task); closeSub(st); closeGroup(st); pushSub(st, label, 'declared'); ch = true; }
      }
    }
    if (c.fin && auto) { const t = curTask(false); if (t && !t.done) { closeTask(t); ch = true; } }
    if (ch) { S.thinking = false; S.cur = null; S.curStep = null; }
    return ch;
  }

  // An action is about to run: put it in the tree -- merged into the current group when it continues it.
  function start(cmd) {
    const c = cmd || {};
    const task = curTask(true);
    reopen(task);                                     // work after a finish EXTENDS the task, it isn't a new one
    const cls = CLS[c.do] || 'other';
    const intent = (typeof c.intent === 'string' && c.intent.trim()) ? clip(c.intent, 70) : '';
    const sig = cls === 'look' ? pollSig(c) : '';
    let st = openStep(task);
    if (!st) {
      // the SAME poll repeated turn after turn (a waiter's pings, one pixel it keeps checking) is ONE row:
      // an identical look, after nothing but a pause, rejoins the burst that ended at that pause
      const prev = task.steps[task.steps.length - 1], g0 = prev && prev.items.length === 1 ? prev.items[0] : null;
      if (sig && prev && prev.done && !prev.sealed && prev.kind === 'auto' && g0 && !g0.sub && g0.cls === 'look' && g0.d.sig === sig && g0.intent === intent) {
        prev.done = false; prev.t1 = null; g0.done = false; st = prev;
      } else st = pushStep(task, '', 'auto');
    }
    const cont = container(st);
    let g = cont.items[cont.items.length - 1];
    const same = !!(g && !g.sub && g.cls === cls && g.intent === intent && MERGE.has(cls));
    if (same && !g.done) { /* the live run goes on */ }
    else if (same && g.settled) { g.done = false; g.settled = false; }            // its one command had answered; this makes it a run
    else if (same && sig && g.d.sig === sig) { g.done = false; }                  // the same poll again, inside an open step
    else {
      closeGroup(cont);
      g = { cls, intent, done: false, n: 0, d: {}, leaf: '', busy: 0 };
      cont.items.push(g); capItems(cont);
    }
    accum(g, c);
    g.leaf = g.n > 1 || cls === 'plan' ? leafOf(g, c, '') : ''; g.leafBad = false;
    S.cur = g; S.curStep = st; S.thinking = false; S.inflight = true; S.t0cmd = now();
    return g;
  }
  // ...and it answered: a look keeps what it saw, an input whether it failed; its time is counted. One
  // command that has answered is DONE at once -- a ✓ and its result, not a live row ticking over a
  // finished action; the next command of its kind reopens it as a run.
  function end(cmd, r) {
    const took = S.t0cmd != null ? Math.max(0, now() - S.t0cmd) : 0;
    S.inflight = false; S.t0cmd = null;
    const g = S.cur;
    if (S.curStep) { S.curStep.tLast = now(); S.curStep.busy = (S.curStep.busy || 0) + took; }
    if (!g) return false;
    g.busy = (g.busy || 0) + took;
    const c = cmd || {}, x = r || {}, rp = resPhrase(c, x);
    if (INPUT.has(g.cls)) { if (x.ok === false) g.d.failed = (g.d.failed || 0) + 1; }
    else g.d.res = rp;
    if (!g.done && (g.n > 1 || g.cls === 'plan')) { g.leaf = leafOf(g, c, rp); g.leafBad = !!rp && BAD_RESULT.test(rp); }
    if (!g.done && g.n === 1) { g.done = true; g.settled = MERGE.has(g.cls); g.leaf = ''; }
    return true;
  }
  // A command that is NOT recorded (quiet, conversation after a finish, or not an action) must not inherit
  // the last group's live leaf. `busy`: it is still WORK (a quiet action) -- so not "Planning" either.
  function unbind(busy) {
    S.cur = null; S.inflight = false;
    if (busy && S.thinking) { S.thinking = false; return true; }
    return false;
  }
  // A batch is running its i-th of n sub-steps: its live leaf follows it -- by count only for a quiet
  // batch, and with the batch's own words while it narrates itself (a status line inside it).
  function tick(i, n, st) {
    const g = S.cur;
    if (!g || g.done || g.cls !== 'plan') return false;
    const s = st || {};
    if (s.do === 'status' && typeof s.text === 'string' && s.text.trim()) g.d.note = clip(s.text, 70);
    g.d.i = i + 1; g.d.total = n;
    const what = (g.d.quiet || g.d.note || !isAction(s) || s.do === 'plan') ? '' : ': ' + lowerFirst(maskedPhrase(s));
    g.leaf = clip((g.d.note ? g.d.note + ' · ' : '') + 'step ' + (i + 1) + '/' + n + what, 100); g.leafBad = false;
    return true;
  }
  // The driver went quiet: the burst is over. Never while a command is still running -- that is work, not
  // a pause. An auto step closes, a soft one once it has work in it; a declared one waits. The panel then
  // says the agent is planning.
  function idle() {
    if (S.inflight) return false;
    const task = curTask(false);
    if (!task || task.done) return false;
    const st = openStep(task);
    if (st) {
      const c = container(st);
      closeGroup(c);
      // a soft (sub-)step closes at a pause -- once it HAS work in it: the gap between a driver's
      // `status {text}` and its first action is that same pause, and closed there it stood empty
      if (c !== st && c.kind === 'soft' && c.items.length) c.done = true;
      if (st.kind === 'auto' || (st.kind === 'soft' && st.items.length)) closeStep(st);
    }
    S.cur = null; S.curStep = null;
    if (S.thinking) return false;
    S.thinking = true;
    return true;
  }
  // A tool's explicit tree or a flat plan just took the panel: end the burst cleanly (no planning row), so
  // nothing stale is still "live" -- or gets merged into -- when the action tree comes back.
  function suspend() {
    const task = curTask(false);
    if (task) { const st = openStep(task); if (st) { closeGroup(container(st)); if (st.kind !== 'declared') closeStep(st); } }
    S.cur = null; S.curStep = null; S.thinking = false; S.inflight = false;
    return true;
  }
  // A tool's explicit tree (or a flat plan) just retired: keep it in the history as one done row -- INSIDE
  // the driver's own open step (or sub-step) when there is one, since that is where the tool did its work.
  function adopt(tree) {
    const roots = listOf(tree).map((n) => str(n && n.t)).filter(Boolean);
    if (!roots.length) return false;
    const task = curTask(true), st = openStep(task), base = clip('Ran: ' + roots.join(' · '), 95);
    reopen(task);
    if (st && st.kind === 'declared') {
      const cont = container(st); closeGroup(cont);
      const nth = 1 + cont.items.filter((it) => it.cls === 'ran' && it.d.base === base).length;
      cont.items.push({ cls: 'ran', intent: '', done: true, n: 0, d: { base, label: nth > 1 ? base + ' #' + nth : base }, leaf: '', busy: 0 }); capItems(cont);
    } else {
      closeStep(st);
      const ns = pushStep(task, base, 'declared'); ns.done = true; ns.t1 = now();
    }
    S.cur = null; S.curStep = null; S.thinking = false;
    return true;
  }
  const ensureTask = () => curTask(true);
  // THE JOB'S PLAN (core/mission.js), drawn as the current task: every milestone in plan order, the ones
  // still to come too. null clears it. It belongs to the task it was set on -- a new task starts without one.
  function setPlan(skel) {
    const t = curTask(true), p = skel && Array.isArray(skel.ms) && skel.ms.length ? skel : null;
    if (!p && !t.plan) return false;
    t.plan = p;
    return true;
  }
  // THE PLAN NAMES THE TASK IT IS FOR. An open task -- the connect-time one, holding the looks taken while the
  // plan was being made -- BECOMES the job, and that work stays, above the plan; only a finished task is
  // followed by a new one. (`mark {task}` would close an open task with work in it and start afresh, dropping
  // exactly the looks the plan was made from.)
  function retask(label) {
    const l = clip(label, 100);
    if (!l) return false;
    const cur = curTask(false);
    if (cur && !cur.done) {
      if (cur.label === l) return false;
      cur.label = l; cur.nth = 1 + S.tasks.filter((x) => x !== cur && x.label === l).length;
      return true;
    }
    return mark({ task: l }, true, false);
  }
  // a milestone renamed (or split): its row keeps its history under the new name
  function relabel(mid, label) {
    const t = curTask(false), l = clip(label, 100);
    if (!t || !mid || !l) return false;
    let ch = false;
    for (const st of t.steps) if (st.mid === mid && st.label !== l) { st.label = l; ch = true; }
    return ch;
  }

  // ---- output -----------------------------------------------------------------------------------------
  const numbered = (label, nth) => nth > 1 ? clip(label, 95) + ' #' + nth : label;
  // `x`: the board's flags on a row (core/board.js) -- r risky, c changed the machine, p proven -- drawn as small badges
  const node = (t, s, k, x) => { const n = { t: clip(t, 100) || '…' }; if (s) n.s = s; if (k && k.length) n.k = k; if (x) n.x = x; return n; };
  // a fold of older rows -- no "✓" of its own (the done state draws one), but it keeps count of PROBLEMS
  // in what it folds, so a failure never reads as a pass once it scrolls out of the window
  const earlier = (n, what, bad) => node(plural(n, 'earlier ' + what) + (bad ? ' (⚠ ' + bad + ' failed)' : ''), 'done');
  // A row whose own state is live: amber `warn` when its latest answer was bad
  const gNode = (g) => {
    const live = !g.done, lbl = gLabel(g, live);
    return node(lbl, live ? (gIsBad(g) ? 'warn' : 'doing') : 'done', (live && g.leaf && g.leaf !== lbl) ? [node(g.leaf, g.leafBad ? 'warn' : 'doing')] : null, g.x || '');
  };
  // What FAILED in a step or sub-step whose rows are folded away: kept visible, one row, under it
  function failNodes(owner) {
    const f = failures(owner, []), total = badCount(owner);
    if (!total) return null;
    const last = f.length ? gLabel(f[f.length - 1], false) : '';
    return [node(total === 1 && last ? last : '⚠ ' + total + ' failed' + (last ? ' — the last: ' + lowerFirst(last.replace(/^⚠\s*/, '')) : ''), 'done')];
  }
  function itemNodes(owner, win) {
    const items = owner.items, shown = items.slice(-win), hiddenItems = items.slice(0, items.length - shown.length);
    const hid = hiddenItems.reduce((n, it) => n + actionsIn(it), 0) + (owner.droppedN || 0), out = [];
    if (hid > 0) out.push(earlier(hid, 'action', hiddenItems.reduce((n, it) => n + badCount(it), 0) + (owner.droppedBad || 0)));
    for (const it of shown) {
      if (it.sub) out.push(node(numbered(it.label, it.nth), it.done ? 'done' : 'doing', it.done ? failNodes(it) : itemNodes(it, win)));
      else out.push(gNode(it));
    }
    return out;
  }
  function stepNodes(task, P) {
    const steps = task.steps, shown = steps.slice(-P.stepWin), gone = steps.slice(0, steps.length - shown.length), out = [];
    const hid = gone.length + (task.dropped || 0);
    if (hid > 0) out.push(earlier(hid, 'step', gone.filter((s) => badCount(s) > 0).length));
    // the step that JUST finished is what the watcher just saw happen: it keeps the most detail
    const doneShown = shown.filter((s) => s.done), withKids = new Set(P.doneKids ? doneShown.slice(-P.doneKids) : []);
    const latestDone = doneShown[doneShown.length - 1];
    const thinking = S.thinking && !task.done;
    let placed = false;
    for (const st of shown) {
      let kids = null;
      // an open burst holding ONE group is that group: one row (its live label, its leaf under it), not a
      // step row and a group row saying the same thing
      const only = (st.kind === 'auto' && !st.done && st.items.length === 1 && !st.items[0].sub) ? st.items[0] : null;
      if (only) { out.push(gNode(only)); continue; }
      const oneGroup = st.kind === 'auto' && st.items.length <= 1;          // a closed one-group burst: its label IS the group
      if (!st.done) {
        kids = itemNodes(st, P.itemWin);
        if (thinking) {
          const last = st.items[st.items.length - 1], subNode = (last && last.sub && !last.done) ? kids[kids.length - 1] : null;
          if (subNode) subNode.k = (subNode.k || []).concat([node(THINK, 'doing')]); else kids.push(node(THINK, 'doing'));
          placed = true;
        }
      } else if (withKids.has(st) && !oneGroup) kids = itemNodes(st, st === latestDone ? P.lastDoneWin : P.doneItemWin);
      else if (!oneGroup) kids = failNodes(st);                             // folded: its failures stay visible
      out.push(node(numbered(stepLabel(st), st.kind === 'auto' ? 1 : st.nth), st.done ? 'done' : 'doing', kids));
    }
    if (thinking && !placed) out.push(node(THINK, 'doing'));
    return out;
  }
  // A JOB WITH A PLAN (core/mission.js): every milestone in PLAN order -- the ones still to come as well, which
  // is the point: a watcher sees the whole job, not only what has happened so far. The current milestone is
  // open with its work (the rows above: its short steps and their actions), then the steps still planned in
  // it; an achieved one says how it was PROVEN, and keeps its failures in sight; a skipped or failed one says
  // why -- as a ring, never a ✓, and never amber (the viewer reads amber as live). Work the plan does not own
  // (a burst before the plan was made) stays above it. Windowed around the current milestone, so a long plan
  // stays inside the relay's clamp (24 siblings, 60 nodes).
  function missionNodes(task, P) {
    const ms = listOf(task.plan.ms).filter((m) => m && typeof m === 'object' && str(m.t)), out = [];
    const byMid = new Map();
    for (const st of task.steps) if (st.mid) byMid.set(st.mid, st);
    const ids = new Set(ms.map((m) => str(m.id)));
    const loose = task.steps.filter((st) => !st.mid || !ids.has(st.mid));
    const thinking = S.thinking && !task.done;
    let placed = false;
    const looseDone = loose.filter((st) => st.done);
    if (looseDone.length) {
      const bad = looseDone.filter((st) => badCount(st) > 0).length;
      out.push(node(plural(looseDone.length, 'step') + ' outside the plan' + (bad ? ' (⚠ ' + bad + ' failed)' : ''), 'done'));
    }
    for (const st of loose.filter((s) => !s.done)) {
      const only = (st.kind === 'auto' && st.items.length === 1 && !st.items[0].sub) ? st.items[0] : null;
      out.push(only ? gNode(only) : node(numbered(stepLabel(st), st.kind === 'auto' ? 1 : st.nth), 'doing', itemNodes(st, P.itemWin)));
    }
    // the window: the current milestone (or the first still to do), a few before it, the rest after it
    let lo = 0, hi = ms.length;
    if (ms.length > P.msWin) {
      let piv = ms.findIndex((m) => m.s === 'doing');
      if (piv < 0) piv = ms.findIndex((m) => m.s === 'todo');
      if (piv < 0) piv = ms.length - 1;
      lo = Math.max(0, piv - Math.max(1, Math.floor((P.msWin - 1) / 3)));
      hi = Math.min(ms.length, lo + P.msWin);
      lo = Math.max(0, hi - P.msWin);
    }
    if (lo > 0) {
      const gone = ms.slice(0, lo), got = gone.filter((m) => m.s === 'done').length;
      out.push(node(plural(lo, 'earlier milestone') + (got === lo ? ', all achieved' : ' (' + got + ' achieved)'), 'done'));
    }
    const shown = ms.slice(lo, hi), doneShown = shown.filter((m) => m.s === 'done');
    const withProof = new Set(doneShown.slice(Math.max(0, doneShown.length - P.proofWin)).map((m) => m.id));
    for (const m of shown) {
      const st = byMid.get(str(m.id)) || null, label = clip(m.t, 100);
      if (m.s === 'doing') {
        const kids = st ? itemNodes(st, P.itemWin) : [];
        if (thinking && st && !st.done) {
          const last = st.items[st.items.length - 1], subNode = (last && last.sub && !last.done) ? kids[kids.length - 1] : null;
          if (subNode) subNode.k = (subNode.k || []).concat([node(THINK, 'doing')]); else kids.push(node(THINK, 'doing'));
          placed = true;
        }
        // the short steps still planned, after the work so far
        const begun = new Set(st ? st.items.filter((it) => it.sub).map((it) => str(it.label).toLowerCase()) : []);
        for (const sb of listOf(m.subs)) if (sb && sb.s === 'todo' && str(sb.t) && !begun.has(str(sb.t).toLowerCase())) kids.push(node(sb.t, 'todo'));
        out.push(node(label, 'doing', kids));
      } else if (m.s === 'done') {
        const kids = [];
        if (withProof.has(m.id)) { if (m.ev) kids.push(node(m.ev, 'done', null, 'p')); const f = st ? failNodes(st) : null; if (f) kids.push(...f); }
        out.push(node(label, 'done', kids, m.ev ? 'p' : ''));
      } else if (m.s === 'skipped') out.push(node('⤼ ' + label, 'todo', [node('skipped — ' + (str(m.why) || 'not needed'), 'todo')]));
      else if (m.s === 'failed') out.push(node('✗ ' + label, 'todo', [node('not achieved — ' + (str(m.why) || 'it could not be done'), 'todo')]));
      else out.push(node(label, 'todo', st ? failNodes(st) : null));   // set aside after a start: what failed stays in sight
    }
    if (hi < ms.length) out.push(node(plural(ms.length - hi, 'more milestone') + ' planned', 'todo'));
    if (thinking && !placed) out.push(node(THINK, 'doing'));
    return out;
  }
  // ONE root: the current task. Earlier tasks were each reported in chat when they finished, and as extra
  // top rows they made the viewer's top-level progress read "2/2", "3/3" -- full -- on open-ended work.
  function build(P) {
    const task = S.tasks[S.tasks.length - 1];
    return task ? [node(numbered(task.label, task.nth), task.done ? 'done' : 'doing', task.plan ? missionNodes(task, P) : stepNodes(task, P))] : [];
  }
  // The tree to send, inside the relay's clamp: shed the least useful detail first (the actions of steps
  // already done, the proof of milestones long achieved), then narrow the windows, so what is happening NOW
  // always survives.
  function render() {
    const P = { stepWin: 8, doneKids: 4, lastDoneWin: 8, doneItemWin: 4, itemWin: 8, msWin: 18, proofWin: 4 };
    let tree = build(P);
    const trims = [['proofWin', 2], ['doneItemWin', 3], ['doneKids', 2], ['lastDoneWin', 5], ['msWin', 14], ['proofWin', 1],
                   ['doneItemWin', 2], ['doneKids', 1], ['lastDoneWin', 3], ['msWin', 10], ['proofWin', 0],
                   ['doneKids', 0], ['itemWin', 6], ['msWin', 7], ['stepWin', 6], ['itemWin', 4], ['msWin', 5], ['stepWin', 4], ['itemWin', 3],
                   ['stepWin', 3], ['itemWin', 2], ['msWin', 3], ['stepWin', 2], ['itemWin', 1], ['stepWin', 1]];
    for (const [k, v] of trims) {
      if (nodeCount(tree) <= budget) break;
      if (P[k] > v) { P[k] = v; tree = build(P); }
    }
    return tree;
  }
  // The one live line (for an older viewer's feed, the screen reader, and a finish without its own words).
  function line() {
    const g = S.cur, t = curTask(false);
    if (g) return clip(gLabel(g, !g.done), 200);
    if (!t) return '';
    if (S.thinking && !t.done) return THINK;
    const st = openStep(t);
    return st ? stepLabel(st) : t.label;
  }
  const taskLabel = () => { const t = curTask(false); return t ? t.label : ''; };
  const hasContent = () => S.tasks.length > 0;

  // THE BOARD'S FLAGS on the group the last command went into (core/board.js): r = risky, c = it changed the machine
  function flag(f) {
    const g = S.cur;
    if (!g || g.sub || typeof f !== 'string') return false;
    for (const ch of f) if (/^[rcp]$/.test(ch) && !String(g.x || '').includes(ch)) g.x = String(g.x || '') + ch;
    return true;
  }
  return { mark, start, end, unbind, tick, idle, suspend, adopt, ensureTask, setPlan, retask, relabel, render, line, taskLabel, hasContent, flag, state: S };
}

// how many COMMANDS an item stands for (a merged group of 16 presses is 16, a sub-step all of its actions)
function actionsIn(it) { return it.sub ? it.items.reduce((n, x) => n + actionsIn(x), 0) + (it.droppedN || 0) : (it.n || 0); }
// the groups under an item (or a step) whose input failed or whose answer was bad
function failures(it, out) {
  if (it.items) for (const x of it.items) failures(x, out);
  else if (it.cls !== 'ran' && gIsBad(it)) out.push(it);
  return out;
}
// ...and how many there were, counting those already dropped from memory
const badCount = (it) => failures(it, []).length + (it.droppedBad || 0) + (it.items ? it.items.reduce((n, x) => n + (x.items ? (x.droppedBad || 0) : 0), 0) : 0);
function nodeCount(nodes) { let n = 0; for (const x of (nodes || [])) { n++; if (x.k) n += nodeCount(x.k); } return n; }
function treeDepth(nodes, d) { let m = -1; for (const x of (nodes || [])) { m = Math.max(m, d || 0); if (x.k) m = Math.max(m, treeDepth(x.k, (d || 0) + 1)); } return m; }

// A FLAT plan (status {steps, at}) as a tree. A watcher whose panel already shows a tree keeps it until a
// frame carries another tree (the viewer only replaces `tree` when one arrives, and the relay drops an
// empty one), so once the action tree has been on screen a flat plan must ride as a tree or nobody already
// watching ever sees it. Steps before `at` are done, `at` is doing (its sub-steps and the live line under
// it), the rest todo; `fin` settles them all. A per-step `stat` code wins where it is set (the flat panel's
// x = done, r = running, ! ~ ? = a warning). Repeated labels are numbered so stopwatches can't collide.
const STAT = table({ x: 'done', r: 'doing', '!': 'warn', '~': 'warn', '?': 'warn' });
function planToTree(p) {
  const o = p || {}, steps = listOf(o.steps).slice(0, 20), at = Math.max(0, num(o.at)), fin = !!o.fin;
  const sub = listOf(o.sub).slice(0, 8), subAt = num(o.subAt), text = o.text ? clip(o.text, 100) : '';
  const stat = typeof o.stat === 'string' ? o.stat : '';
  const seen = new Map(), out = [];
  steps.forEach((s, i) => {
    const base = clip(s, 95) || '…'; seen.set(base, (seen.get(base) || 0) + 1);
    const label = seen.get(base) > 1 ? base + ' #' + seen.get(base) : base;
    const st = fin ? 'done' : STAT[stat[i]] || (i < at ? 'done' : i === at ? 'doing' : 'todo');
    const n = { t: label, s: st };
    if (st === 'doing') {
      const k = sub.map((x, j) => ({ t: clip(x, 60) || '…', s: j < subAt ? 'done' : j === subAt ? 'doing' : 'todo' }));
      if (text && text !== label) { const cs = k.find((x) => x.s === 'doing'); if (cs) cs.k = [{ t: text, s: 'doing' }]; else k.push({ t: text, s: 'doing' }); }
      if (k.length) n.k = k;
    }
    out.push(n);
  });
  return out;
}

module.exports = { create, planToTree, actPhrase, pastPhrase, resPhrase, keyName, chordName, shortUrl, redactShown, isAction, isConversation,
                   nodeCount, treeDepth, BUDGET, THINK };

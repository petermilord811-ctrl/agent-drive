'use strict';
// @tool the serve's verb table: what each command takes, checked BEFORE it runs, with the common slips renamed
// @run  const { vet } = require('./verbs.js')   (a library; core/agent-join.js checks every command with it)
// verbs -- WHAT A COMMAND MAY SAY, decided before it runs.
//
// Reported from a live run (machine 10002, 2026-11-04): the driver sent {"do":"keys","keys":"chrome"} fifteen
// times. The verb reads `text`, so it typed NOTHING, answered ok:true in 0 ms, and every conclusion after it --
// "Start search opened a game", "Chrome is not installed", "where /r C:\ found nothing" -- was built on typing
// that never happened, while the operator said twice that Chrome was right there on the taskbar. The same run
// sent {"do":"key"} and {"do":"sleep"} and got "unknown command" for both. A field a verb does not read is a
// command that silently means something else, so every command is now held to its verb's own fields:
//
//   * a SLIP everyone makes is renamed and said so (keys.keys -> text, key -> press, sleep -> pause, "esc" ->
//     "Escape"): the answer carries `fixed`, so the driver learns the real name and the command does what it meant;
//   * any OTHER field the verb does not read is refused, naming the verb's real fields and the likeliest one
//     ("did you mean text?"), before anything is sent to the machine;
//   * a field a verb cannot work without is refused: keys with nothing to type, a click with no x/y and no `at`,
//     open with no url, chat with no text. Before, each of those answered ok:true having done nothing;
//   * a `plan` is checked WHOLE before its first step runs, so a slip at step 9 never leaves steps 1-8 done.
//
// Pure: no I/O, never throws on odd input. tests/verbs.js holds this table to the client (every verb it runs
// is here, and every verb here is run) and to docs/reference/serve-protocol.md (every verb is documented).
// `node kit.js verbs` prints it.

// Fields EVERY command may carry: the panel's name for it, keeping it off the panel, the after-the-fact check,
// what may be shown of it, and the few knobs several verbs share.
// `cid`: the caller's own id for the command, echoed on its answer (mcp/server.js ties the two together with it)
const COMMON = ['do', 'intent', 'quiet', 'expect', 'show', 'secret', 'note', 'fresh', 'timeout', 'why', 'cid', '__vetted'];
// ...and every verb that ACTS may also take a picture after it (look:{out,...}), as one command.
const ACT = ['look'];

// Only a number, or a string that is one. An object is never a coordinate -- and {"toString":1} is valid JSON whose
// Number() THROWS, which took the serve's command loop down (tests/agent_chat.js keeps it answered).
const num = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const nonEmpty = (v) => (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.length > 0);
// own keys only: "toString", "constructor" and "__proto__" are not verbs, aliases or fields
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
// a point: x/y in screen pixels, lx/ly in the last look's pixels, or `at` -- a name `find` remembered
const point = (c) => (typeof c.at === 'string' && !!c.at) || (num(c.x) && num(c.y)) || (num(c.lx) && num(c.ly));
const PT = ['x', 'y', 'lx', 'ly', 'at', 'dx', 'dy'];
const V = {
  // ---- acting (needs --control) ----
  click:     { f: PT.concat(['fast'], ACT), need: (c) => point(c) ? '' : 'a click needs x and y (screen pixels), lx and ly (the last look\'s pixels), or at:"<name>" from find', what: 'left click at a point' },
  clicks:    { f: ['at', 'fast'].concat(ACT), need: (c) => Array.isArray(c.at) && c.at.length ? '' : 'clicks needs at:[[x,y],...]', what: 'many left clicks, one round trip' },
  dbl:       { f: PT.concat(ACT), need: (c) => point(c) ? '' : 'a double-click needs x and y, lx and ly, or at:"<name>"', what: 'double click' },
  right:     { f: PT.concat(ACT), need: (c) => point(c) ? '' : 'a right-click needs x and y, lx and ly, or at:"<name>"', what: 'right click' },
  clickText: { f: ['text', 'rect', 'nth', 'as', 'lang', 'dx', 'dy', 'fast'].concat(ACT), need: (c) => nonEmpty(c.text) ? '' : 'clickText needs the text to look for', what: 'read the screen, find a word and click it' },
  keys:      { f: ['text', 'human', 'speed'].concat(ACT), need: (c) => nonEmpty(c.text) ? '' : 'keys needs text: the characters to type (keys {text:"…"}) -- nothing was typed', what: 'type text into the focused window -- like a person by default (human:0 = instant)' },
  press:     { f: ['code', 'n'].concat(ACT), need: (c) => nonEmpty(c.code) ? '' : 'press needs code: a key like "Enter", "Escape", "F5", "ArrowDown", "a"', what: 'press one key (n times)' },
  chord:     { f: ['mod', 'code'].concat(ACT), need: (c) => nonEmpty(c.code) ? '' : 'chord needs code (the key) and mod (the modifier, or several: "ControlLeft+ShiftLeft")', what: 'modifier(s) + key, e.g. Ctrl+Shift+Escape' },
  open:      { f: ['url', 'wait', 'tab', 'human', 'speed'].concat(ACT), need: (c) => nonEmpty(c.url) ? '' : 'open needs url', what: 'type a URL into the browser (tab:1 = in a NEW tab)' },
  scroll:    { f: ['x', 'y', 'lx', 'ly', 'n'].concat(ACT), need: (c) => num(c.n) && Number(c.n) !== 0 ? '' : 'scroll needs n: wheel notches (negative scrolls down)', what: 'mouse wheel at a point' },
  stroke:    { f: ['points', 'ms'].concat(ACT), need: (c) => Array.isArray(c.points) && c.points.length >= 2 ? '' : 'a stroke needs points:[[x,y],...] (at least two)', what: 'a held drag' },
  strokes:   { f: ['list', 'ms'].concat(ACT), need: (c) => Array.isArray(c.list) && c.list.length ? '' : 'strokes needs list:[{points:[...]}...]', what: 'many held drags' },
  pause:     { f: ['ms'].concat(ACT), need: (c) => num(c.ms) && Number(c.ms) > 0 ? '' : 'pause needs ms (how long to wait, up to 30000)', what: 'wait a fixed time (a wait on a pixel is better)' },
  quit:      { f: [], what: 'hand the grant back, no sign-off' },
  // ---- looking ----
  look:      { f: ['out', 'rect', 'max', 'settle', 'keep'], need: (c) => nonEmpty(c.out) ? '' : 'look needs out: the .png file to write the picture to', what: 'a fresh picture sized for reading (long edge <= max, 1280 by default), with the scale back to screen pixels' },
  shot:      { f: ['out', 'keep'], need: (c) => nonEmpty(c.out) ? '' : 'shot needs out: the file to write the picture to', what: 'the whole screen, full size, as a PNG' },
  hold:      { f: [], what: 'a new picture -- its identity only (~5 KB)' },
  see:       { f: ['rect'], what: 'decode the held picture down to a rectangle' },
  ocr:       { f: ['rect', 'lang', 'boxes'], what: 'the words in a rectangle' },
  find:      { f: ['text', 'rect', 'as', 'nth', 'lang', 'all'], need: (c) => nonEmpty(c.text) ? '' : 'find needs the text to look for', what: 'where a word is; remember it under `as`' },
  probe:     { f: ['x', 'y', 'lx', 'ly'], need: (c) => (num(c.x) && num(c.y)) || (num(c.lx) && num(c.ly)) ? '' : 'probe needs x and y (or lx and ly)', what: 'one pixel' },
  census:    { f: ['rect', 'cap', 'min'], what: 'the connected regions in a rectangle' },
  flood:     { f: ['x', 'y', 'bound'], need: (c) => num(c.x) && num(c.y) ? '' : 'flood needs x and y', what: 'where a bucket fill would go' },
  mark:      { f: ['rect'], what: 'the baseline changed/stable/diff compare to' },
  diff:      { f: ['rect'], what: 'what moved since the mark' },
  liveness:  { f: ['rect'], what: 'is the capture live, blank or frozen?' },
  // ---- knowing ----
  expect:    { f: ['until'], need: (c) => (c.until || c.expect) ? '' : 'expect needs until:<predicate>', what: 'is the predicate true now?' },
  wait:      { f: ['until', 'poll'], need: (c) => (c.until || c.expect) ? '' : 'wait needs until:<predicate>', what: 'poll until true, or time out' },
  plan:      { f: ['steps'], need: (c) => Array.isArray(c.steps) ? '' : 'plan needs steps:[...]', what: 'many steps in one command; if/then/else and repeat/until; stops at the first that fails' },
  mission:   { f: ['op', 'plan', 't', 'step', 'steps', 'm', 'milestone', 'before', 'after', 'now', 'to', 'done', 'check', 'into', 'file', 'say', 'w', 'h', 'skill', 'goal', 'milestones', 'preview', 'checkpoints', 'checkpoint', 'replay'], need: (c) => nonEmpty(c.op) ? '' : 'mission needs op: plan, step, steps, achieve, add, change, split, skip, fail, finish, show, resume, drop, ask', what: 'the job\'s big plan (drive/mission.js); preview:1 asks the room before it starts, checkpoints:1 after each milestone; ask asks again' },
  // ---- talking ----
  chat:        { f: ['text', 'to'], need: (c) => nonEmpty(c.text) ? '' : 'chat needs text', what: 'say it in the session chat' },
  'chat-img':  { f: ['file', 'text', 'to', 'name', 'w', 'h'], need: (c) => nonEmpty(c.file) ? '' : 'chat-img needs file: a .jpg/.png to post', what: 'post a picture to the chat' },
  'chat-wait': { f: ['since'], what: 'wait for the next human reply' },
  seen:        { f: ['ids', 'to'], what: 'mark the operator\'s messages read' },
  typing:      { f: ['on'], what: 'show "typing…" while composing' },
  inbox:       { f: [], what: 'the operator\'s recent messages' },
  ping:        { f: [], what: 'is the session alive?' },
  reconnect:   { f: [], what: 'drop the socket and dial again' },
  status:      { f: ['text', 'steps', 'at', 'tree', 'fin', 'task', 'step', 'substep', 'say', 'file', 'w', 'h', 'thought', 'next', 'conf', 'warn', 'stat', 'sub', 'subAt'], what: 'the progress panel: task/step/substep, a tree, a finish' },
  think:       { f: ['thought', 'text', 'conf', 'next'], what: 'the panel\'s thought line' },
  warn:        { f: ['text'], what: 'a caution line on the panel' },
  confirm:     { f: ['text'], need: (c) => nonEmpty(c.text) ? '' : 'confirm needs text: what you are about to do, said to everyone', what: 'ask before something hard to undo; a no always wins' },
  captcha:     { f: ['text'], what: 'a CAPTCHA is for a person: ask the operator in chat to solve it, and wait for their reply -- never solve one' },
  budget:      { f: ['steps', 'minutes', 'more'], what: 'the task\'s budget of acting steps and minutes: {} shows it; a lower limit is taken; a higher one, or more:1 once it is spent, is asked of the room' },
  done:        { f: ['text', 'file', 'w', 'h'], what: 'sign off (with a picture) and hand the grant back' },
  // ---- ScreenMirror's own features ----
  'note-list': { f: [], what: 'the host\'s sticky notes' },
  'note-add':  { f: ['text', 'x', 'y'], need: (c) => nonEmpty(c.text) ? '' : 'note-add needs text', what: 'leave a sticky note' },
  'note-done': { f: ['id', 'undo'], need: (c) => nonEmpty(c.id) ? '' : 'note-done needs id (from note-list)', what: 'cross a note off' },
  spotlight:   { f: ['x', 'y', 'r', 'rect', 'circle', 'cx', 'cy', 'points', 'close', 'rounds', 'laps', 'times', 'speed', 'forever'], what: 'circle a thing for the watchers, at a person\'s pace' },
  beam:        { f: ['x', 'y', 'size', 'hold', 'forever'], what: 'dim the watchers\' picture except a circle' },
  'spotlight-off': { f: ['x', 'y'], what: 'clear the beam' },
  lock:        { f: ['on'], what: 'take / release exclusive control' },
  // ---- windows, apps and controls by NAME, run on the host through exec (core/desk.js) -- they need the shell consent
  windows:     { f: [], what: 'the open windows: title, process, rect, which is in front -- and the monitors (needs shell)' },
  focus:       { f: ['title', 'id', 'dry'].concat(ACT), need: (c) => nonEmpty(c.title) || nonEmpty(c.id) ? '' : 'focus needs title (part of the window title) or id (from windows)', what: 'bring a window to the front by (part of) its title, or its id (needs shell)' },
  launch:      { f: ['app', 'args', 'cwd', 'wait', 'focus', 'dry'].concat(ACT), need: (c) => nonEmpty(c.app) ? '' : 'launch needs app: a name, a path or a URL', what: 'start an app by name, path or URL, as the signed-in user, and find its window (needs shell)' },
  controls:    { f: ['title', 'id', 'max', 'depth', 'budget'], what: 'the controls of a window by NAME (UI Automation / AT-SPI): name, type, rect, cx/cy to click -- never a value; password fields flagged (needs shell)' },
  terminal:    { f: ['open', 'input', 'keys', 'signal', 'close', 'wait', 'until'], need: (c) => (c.open || c.input != null || nonEmpty(c.keys) || c.signal || c.close) ? '' : 'terminal needs something to do: input:"a line", keys:"raw keys", signal:1 (Ctrl+C), open:1 or close:1', what: 'the Terminal panel shell, shared with everyone watching: type a line or keys, read what it prints (needs the terminal consent)' },
  access:      { f: ['shell', 'control', 'terminal', 'camera', 'audio', 'files'], need: (c) => (c.shell || c.control || c.terminal || c.camera || c.audio || c.files) ? '' : 'access needs what to ask for: shell:1 (run commands), terminal:1 (the Terminal panel), control:1 (keyboard and mouse), camera:1, audio:1 (what it plays) and/or files:1, and why', what: 'ask the operator for MORE access mid-visit -- a new Allow card; nothing changes unless they press Allow' },
  exec:        { f: ['cmd', 'text'], need: (c) => nonEmpty(c.cmd != null ? c.cmd : c.text) ? '' : 'exec needs cmd: the command line to run', what: 'run one command on the host (needs --shell)' },
  // ---- what the visit changed, and putting it back (core/undo.js)
  changes:     { f: ['all'], what: 'what this task changed on the machine (all:1 -- this visit), each with whether and how it can be put back' },
  undo:        { f: ['id', 'dry'], need: (c) => nonEmpty(c.id) ? '' : 'undo needs id: a change from `changes` (c3), or "last"', what: 'put one change back: a command after the room\'s yes (or because they asked: "undo c3"); a change put back by hand comes back as the how; dry:1 shows the command only' },
  changed:     { f: ['what', 'undo'], need: (c) => nonEmpty(c.what) ? '' : 'changed needs what: the change you made, in a few words', what: 'record a change you made by clicking (a setting, a toggle) and how it is put back -- it joins the task\'s record' },
  // ---- files and captures, through exec (core/desk.js) -- they need the shell consent; the room hears each one
  fetch:       { f: ['path', 'out'], need: (c) => !nonEmpty(c.path) ? 'fetch needs path: the file on the machine' : !nonEmpty(c.out) ? 'fetch needs out: where to save it here' : '', what: 'copy a file FROM the machine to here, in chunks (needs shell; said in the room)' },
  send:        { f: ['file', 'to', 'overwrite'], need: (c) => !nonEmpty(c.file) ? 'send needs file: the file here to put on the machine' : !nonEmpty(c.to) ? 'send needs to: the path (or folder) on the machine' : '', what: 'put a file from here ON the machine (needs shell; said in the room) -- never over one that is there unless overwrite:1, which asks the room' },
  camera:      { f: ['out', 'device', 'keep'], need: (c) => nonEmpty(c.out) ? '' : 'camera needs out: the .jpg to save the photo to', what: 'one photo from the machine\'s webcam -- the room is asked first, every time, and only a yes allows it (needs shell)' },
  audio:       { f: ['out', 'seconds', 'keep'], need: (c) => nonEmpty(c.out) ? '' : 'audio needs out: the .wav to save the recording to', what: 'up to 7 s of what the machine is PLAYING (never the microphone) -- the room is asked first, every time, and only a yes allows it (needs shell)' },
};
// inside a `plan`, a step may be a CHOICE or a LOOP instead of a verb
const CONTROL_KEYS = ['if', 'then', 'else', 'repeat', 'until', 'steps', 'poll', 'fresh', 'quiet', 'intent', 'note'];

// The slips seen in the field, and what they meant. Each comes back in `fixed` so the driver learns the name.
const VERB_ALIAS = { sleep: 'pause', delay: 'pause', type: 'keys', write: 'keys', screenshot: 'shot', capture: 'shot',
                     say: 'chat', message: 'chat', doubleclick: 'dbl', 'double-click': 'dbl', dblclick: 'dbl', rightclick: 'right',
                     'right-click': 'right', hotkey: 'chord', combo: 'chord', shortcut: 'chord', navigate: 'open', goto: 'open',
                     run: 'exec', shell: 'exec', view: 'look', recaptcha: 'captcha', hcaptcha: 'captcha', 'ask-access': 'access', 'request-access': 'access', term: 'terminal', console: 'terminal', 'list-windows': 'windows', activate: 'focus', 'bring-to-front': 'focus', start: 'launch', 'open-app': 'launch', ui: 'controls', accessibility: 'controls' };
const FIELD_ALIAS = {
  keys:      { keys: 'text', value: 'text', string: 'text', chars: 'text', input: 'text', person: 'human', natural: 'human', pace: 'speed' },
  chat:      { message: 'text', msg: 'text', body: 'text' },
  confirm:   { message: 'text', msg: 'text', question: 'text' },
  'note-add': { message: 'text' },
  press:     { key: 'code', keys: 'code', name: 'code', times: 'n', count: 'n', repeat: 'n' },
  chord:     { key: 'code', keys: 'code', modifier: 'mod', mods: 'mod', modifiers: 'mod' },
  open:      { href: 'url', link: 'url', address: 'url', newTab: 'tab', new_tab: 'tab' },
  pause:     { wait: 'ms', time: 'ms', duration: 'ms', delay: 'ms' },
  shot:      { file: 'out', path: 'out', to: 'out' },
  look:      { file: 'out', path: 'out', to: 'out', size: 'max' },
  'chat-img': { path: 'file', image: 'file', img: 'file' },
  exec:      { command: 'cmd', line: 'cmd' },
  scroll:    { notches: 'n', delta: 'n', amount: 'n' },
  undo:      { change: 'id', ref: 'id', which: 'id' },
  changed:   { text: 'what', change: 'what', revert: 'undo', back: 'undo' },
  fetch:     { from: 'path', source: 'path', file: 'path', dest: 'out', save: 'out', to: 'out' },
  send:      { from: 'file', source: 'file', path: 'to', dest: 'to' },
  camera:    { file: 'out', path: 'out', to: 'out', camera: 'device' },
  audio:     { file: 'out', path: 'out', to: 'out', secs: 'seconds', duration: 'seconds' },
};

// A key as people write it ("esc", "ctrl", "win", "a", "5", "f4") -> the code the hosts map. Unknown names pass
// through unchanged: the hosts know codes this table does not (Minus, Period, NumpadAdd, ...).
const KEY_NAMES = { enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'Space', spacebar: 'Space',
  backspace: 'Backspace', bksp: 'Backspace', del: 'Delete', delete: 'Delete', ins: 'Insert', insert: 'Insert', home: 'Home', end: 'End',
  pageup: 'PageUp', pgup: 'PageUp', pagedown: 'PageDown', pgdn: 'PageDown', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft',
  right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  ctrl: 'ControlLeft', control: 'ControlLeft', lctrl: 'ControlLeft', rctrl: 'ControlRight', shift: 'ShiftLeft', lshift: 'ShiftLeft',
  rshift: 'ShiftRight', alt: 'AltLeft', lalt: 'AltLeft', option: 'AltLeft', altgr: 'AltRight', ralt: 'AltRight',
  win: 'MetaLeft', windows: 'MetaLeft', meta: 'MetaLeft', super: 'MetaLeft', cmd: 'MetaLeft', command: 'MetaLeft', os: 'MetaLeft',
  menu: 'ContextMenu', apps: 'ContextMenu', capslock: 'CapsLock', printscreen: 'PrintScreen', prtsc: 'PrintScreen', prtscn: 'PrintScreen' };
function keyCode(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return s;
  if (/^(Key[A-Z]|Digit\d|Numpad\w+|F\d{1,2}|Arrow(Up|Down|Left|Right)|(Control|Shift|Alt|Meta|OS)(Left|Right))$/.test(s)) return s;
  const l = s.toLowerCase().replace(/[\s_-]+/g, '');
  if (own(KEY_NAMES, l)) return KEY_NAMES[l];
  if (/^[a-z]$/i.test(s)) return 'Key' + s.toUpperCase();
  if (/^\d$/.test(s)) return 'Digit' + s;
  if (/^f\d{1,2}$/i.test(s)) return 'F' + s.slice(1);
  return s;
}
// "ctrl+shift", ["ControlLeft","ShiftLeft"] -> "ControlLeft+ShiftLeft" (at most four)
function modCodes(mod) {
  const parts = (Array.isArray(mod) ? mod : String(mod == null || mod === '' ? 'ControlLeft' : mod).split(/[+,\s]+/)).map((m) => keyCode(m)).filter(Boolean);
  return parts.slice(0, 4).join('+') || 'ControlLeft';
}

// ~edit distance, for "did you mean"
function near(a, b) {
  a = String(a).toLowerCase(); b = String(b).toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const closest = (word, list) => {
  let best = '', bd = 99;
  for (const w of list) { const k = near(word, w); if (k < bd) { bd = k; best = w; } }
  return bd <= Math.max(1, Math.floor(String(word).length / 2)) ? best : '';
};

const VERBS = Object.keys(V);
function vet(input, opts) {
  try { return vetInner(input, opts); }
  catch (e) { return { ok: false, why: 'the command could not be read: ' + ((e && e.message) || 'bad value') }; }
}
function vetInner(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, why: 'a command is an object like {"do":"click","x":10,"y":20}' };
  if (typeof input.do !== 'string' || !input.do) return { ok: false, why: 'a command needs "do": the verb (e.g. "click", "keys", "shot")' };
  const fixed = [];
  const cmd = Object.assign({}, input);
  let verb = cmd.do;
  if (verb === 'key' || verb === 'Key') {
    // {do:"key", code:"F4", mod:"AltLeft"} and {do:"key", code:"AltLeft", modify:["F4"]} -- both meant Alt+F4
    if (cmd.mod != null || Array.isArray(cmd.modify)) {
      if (Array.isArray(cmd.modify) && cmd.mod == null) { cmd.mod = cmd.code; cmd.code = String(cmd.modify[cmd.modify.length - 1] || ''); delete cmd.modify; }
      verb = 'chord'; fixed.push('"do":"key" with a modifier is {"do":"chord","mod":…,"code":…}');
    } else { verb = 'press'; fixed.push('"do":"key" is "press"'); }
    cmd.do = verb;
  } else if (!own(V, verb)) {
    const lower = verb.toLowerCase();
    const alias = (own(VERB_ALIAS, verb) && VERB_ALIAS[verb]) || (own(VERB_ALIAS, lower) && VERB_ALIAS[lower]) || (own(V, lower) ? lower : '') || VERBS.find((v) => v.toLowerCase() === lower) || '';
    if (alias) { fixed.push('"do":"' + verb + '" is "' + alias + '"'); verb = alias; cmd.do = alias; }
    else {
      const guess = closest(verb, VERBS.concat(Object.keys(VERB_ALIAS)));
      const real = guess && own(VERB_ALIAS, guess) ? VERB_ALIAS[guess] : guess;
      return { ok: false, why: 'unknown command "' + verb + '"' + (real ? ' -- did you mean "' + real + '"?' : '') + ' (the verbs: ' + VERBS.join(', ') + ')' };
    }
  }
  const spec = V[verb];
  const fa = own(FIELD_ALIAS, verb) ? FIELD_ALIAS[verb] : {};
  for (const k of Object.keys(cmd)) {
    if (own(fa, k) && cmd[fa[k]] == null) {
      let v = cmd[k];
      if (Array.isArray(v) && fa[k] === 'text') v = v.join('');
      if (Array.isArray(v) && fa[k] === 'code') v = v[v.length - 1];
      cmd[fa[k]] = v; delete cmd[k];
      fixed.push(verb + '.' + k + ' is ' + verb + '.' + fa[k]);
    }
  }
  const allowed = new Set(COMMON.concat(spec.f));
  const unknown = Object.keys(cmd).filter((k) => !allowed.has(k));
  if (unknown.length) {
    const hints = unknown.map((k) => { const g = closest(k, spec.f); return g ? k + ' (did you mean ' + g + '?)' : k; });
    return { ok: false, why: verb + ' does not read ' + hints.join(', ') + ' -- nothing was sent. ' + verb + ' takes: ' +
             (spec.f.length ? spec.f.join(', ') : 'no fields') + ' (and any command: intent, quiet, expect, show, secret)' };
  }
  // key names as people write them
  if (verb === 'press' && cmd.code != null) { const k = keyCode(cmd.code); if (k !== cmd.code) { fixed.push('press.code "' + cmd.code + '" is "' + k + '"'); cmd.code = k; } }
  if (verb === 'chord') {
    if (cmd.code != null) { const k = keyCode(cmd.code); if (k !== cmd.code) { fixed.push('chord.code "' + cmd.code + '" is "' + k + '"'); cmd.code = k; } }
    const m = modCodes(cmd.mod);
    if (cmd.mod != null && m !== cmd.mod) fixed.push('chord.mod ' + JSON.stringify(cmd.mod) + ' is "' + m + '"');
    cmd.mod = m;
  }
  if (spec.need) { const miss = spec.need(cmd); if (miss) return { ok: false, why: miss }; }
  return { ok: true, cmd, fixed };
}

// A WHOLE PLAN, before its first step runs: every verb step vetted (and fixed), every choice and loop held to
// its own keys, nested plans and branches included. Returns the fixed steps, each marked vetted.
function vetPlan(steps, where, depth) {
  const d = depth || 0, fixed = [];
  if (!Array.isArray(steps)) return { ok: false, why: (where || 'the plan') + ': steps is a list of commands' };
  if (d > 6) return { ok: false, why: (where || 'the plan') + ': nested too deep' };
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const here = (where ? where + ' > ' : '') + 'step ' + (i + 1);
    if (st && typeof st === 'object' && !Array.isArray(st) && typeof st.do !== 'string' && (st.if || st.repeat !== undefined || st.until)) {
      const bad = Object.keys(st).filter((k) => !CONTROL_KEYS.includes(k));
      if (bad.length) return { ok: false, why: here + ': a step with if/repeat/until takes ' + CONTROL_KEYS.join(', ') + ' -- not ' + bad.join(', '), at: i };
      const copy = Object.assign({}, st);
      for (const k of ['then', 'else', 'steps']) {
        if (st[k] == null) continue;
        const sub = vetPlan(st[k], here + ' ' + k, d + 1);
        if (!sub.ok) return Object.assign({ at: i }, sub);
        copy[k] = sub.steps; fixed.push(...sub.fixed);
      }
      out.push(copy);
      continue;
    }
    const v = vet(st);
    if (!v.ok) return { ok: false, why: here + ': ' + v.why, at: i };
    if (v.cmd.do === 'plan') {
      const sub = vetPlan(v.cmd.steps, here, d + 1);
      if (!sub.ok) return Object.assign({ at: i }, sub);
      v.cmd.steps = sub.steps; fixed.push(...sub.fixed);
    }
    v.cmd.__vetted = 1;
    out.push(v.cmd);
    for (const f of v.fixed) fixed.push(here + ': ' + f);
  }
  return { ok: true, steps: out, fixed };
}

// THE TABLE AS MARKDOWN -- the block docs/reference/serve-protocol.md carries between its `verbs:begin` and
// `verbs:end` marks, written by `node kit.js verbs --write-doc`. tests/verbs.js fails when the doc's block is not
// this, so the fields a verb takes can never drift from the fields it is checked against.
const DOC_BEGIN = '<!-- verbs:begin -- generated from core/verbs.js by `node kit.js verbs --write-doc`; do not edit by hand -->';
const DOC_END = '<!-- verbs:end -->';
function markdown() {
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  const rows = VERBS.map((v) => {
    const spec = V[v];
    const fixed = Object.keys(VERB_ALIAS).filter((a) => VERB_ALIAS[a] === v).map((a) => '`' + a + '`');
    if (v === 'press') fixed.unshift('`key`');
    if (v === 'chord') fixed.unshift('`key` with a `mod`');
    const fa = own(FIELD_ALIAS, v) ? FIELD_ALIAS[v] : {};
    for (const k of Object.keys(fa)) fixed.push('`' + k + '`→`' + fa[k] + '`');
    const fields = spec.f.length ? spec.f.map((f) => '`' + f + '`').join(' ') : '—';
    return '| `' + v + '` | ' + fields + ' | ' + cell(spec.what || '') + ' | ' + (fixed.join(', ') || '') + ' |';
  });
  return [DOC_BEGIN, '',
    '| verb | its fields (any other is refused) | what it does | renamed for you, and said so in `fixed` |',
    '|------|------|------|------|'].concat(rows, ['',
    'Every command may also carry: ' + COMMON.filter((c) => c !== 'do' && c !== '__vetted').map((c) => '`' + c + '`').join(' ') + '.',
    DOC_END]).join('\n');
}
// Put the generated block into a document's text (between the marks; appended if it has none).
function withDocBlock(doc) {
  const s = String(doc || ''), a = s.indexOf(DOC_BEGIN), b = s.indexOf(DOC_END);
  if (a >= 0 && b > a) return s.slice(0, a) + markdown() + s.slice(b + DOC_END.length);
  return s.replace(/\s*$/, '\n\n') + markdown() + '\n';
}

module.exports = { vet, vetPlan, keyCode, modCodes, markdown, withDocBlock, DOC_BEGIN, DOC_END, VERBS, V, VERB_ALIAS, FIELD_ALIAS, COMMON, CONTROL_KEYS };

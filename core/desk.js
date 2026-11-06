'use strict';
// @tool window & app awareness on the host through `exec`: list windows + monitors, focus one, launch an app, read a window's controls (UI Automation / AT-SPI: names and rects, never values)
// @run  const desk = require('./core/desk.js'); const b = desk.build('windows', {}, 'windows'); /* exec {cmd: b.cmd} */ const w = desk.parse('windows', reply.output)
// desk -- SEEING THE DESKTOP AS WINDOWS AND CONTROLS, NOT ONLY AS PIXELS.
//
// Neither host has a verb for "which windows are open", "bring that one forward", "start this app" or "what
// are the buttons in it". Both have `exec` (the visit's separate --shell consent): cmd.exe /c on Windows,
// /bin/sh -c on Linux. So each of those is a SCRIPT, kept as a file under core/desk/, and this module turns an
// op + its args into the ONE command line that runs it there, and turns what comes back into an object.
// It is pure: it reads its own script files once, at require time, and does nothing else.
//
//   build(op, args, os) -> {ok, op, os, cmd, len} | {ok:false, why}      os: 'windows' | 'linux'
//   parse(op, output)   -> the answer object (always has ok; a failure has why)
//
// OPS AND ARGS
//   probe                         which OS and shell answered -- the same command line for both (see PROBE)
//   windows                       visible top-level windows, front to back, + the monitors
//   focus    {title | id, dry?}   restore + bring to the front; title = case-insensitive part of the title
//   launch   {app, args?, cwd?, wait?, focus?, dry?}   start detached; args = a string (Windows: passed as
//                                 is) or an array of strings (quoted for you); waits up to `wait` ms (4000)
//                                 for the new window and brings it forward unless focus:false
//   controls {title | id, max?=200, depth?=8, budget?=7000}   the UI tree of a window (default: the
//                                 foreground one): only what is on screen, names never values
//   dry:true finds the window (or resolves the app) and changes nothing.
//
// ANSWERS (parse) -- every one carries ok, op, os
//   windows  {foreground, awareness, windows:[{id, title, process, pid, class, rect:[x,y,w,h]|null, minimized,
//            maximized, foreground, owner}], monitors:[{name, rect, work, primary, dpi}]}
//   focus    {how, matches, popup, window}
//   launch   {started:{file, arguments (Windows) | argv (Linux), cwd, as, pid, process}, window|null, how, note?}
//            -- as = "the signed-in user" when the host runs as SYSTEM/root and hands the app to the person at
//            the desktop (it never starts one as SYSTEM or root), else "this account"
//   controls {window, matches, count, truncated, stop, controls:[{i, p, d, name, type, aid, class, rect,
//            enabled, focusable, focused, isPassword}]} -- in DOCUMENT order (parse reorders the scripts'
//            breadth-first list): i = position, p = the parent's i (-1 = the window itself), d = depth
//   probe    {os, shell, arch, user, ...}
//   Rectangles are PHYSICAL screen pixels on Windows (awareness:"per-monitor"; the scripts make themselves
//   DPI-aware first) -- the same space as the monitors' rects. `id` is a number: the HWND, or the X window id.
//   A failure: {ok:false, why} -- "no visible window's title contains ...", "not available on Wayland", a
//   missing tool by name, or what the shell said when the script never ran.
//
// SAFETY: `controls` reads names, never values; a password field is flagged isPassword and carries no name
// (AGENTS.md: never read, copy or send a password). See core/desk/uia.cs for why that needed native UI
// Automation on Windows rather than the managed client, which answered a WinForms password box's NAME as
// the password.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const DIR = path.join(__dirname, 'desk');
// cmd.exe refuses a command line over 8,191 characters ("The command line is too long."); the host adds
// `cmd.exe /c ` in front. 8000 leaves the margin, and Linux is held to it too, although its own limit is
// 128 KB an argument -- one budget, one test.
const LIMIT = 8000;
const OPS = ['probe', 'windows', 'focus', 'launch', 'controls'];

// The scripts each op ships, in order -- only the parts it calls, because every byte is command line. The
// Windows ones are PowerShell 5.1 (on every Windows 10/11) with one C# file for UI Automation; the Linux ones
// are python3 driving the X11 tools that are there.
const PARTS = {
  windows: {
    windows: ['common.ps1', 'screens.ps1', 'windows.ps1'],
    focus: ['common.ps1', 'front.ps1', 'focus.ps1'],
    launch: ['common.ps1', 'front.ps1', 'launch.ps1'],
    controls: ['common.ps1', 'controls.ps1'],
  },
  linux: {
    windows: ['linux/common.py', 'linux/xbase.py', 'linux/xgeo.py', 'linux/xlist.py', 'linux/windows.py'],
    focus: ['linux/common.py', 'linux/xbase.py', 'linux/xgeo.py', 'linux/xlist.py', 'linux/xfront.py', 'linux/focus.py'],
    launch: ['linux/common.py', 'linux/xbase.py', 'linux/xgeo.py', 'linux/xfront.py', 'linux/launch.py'],
    controls: ['linux/common.py', 'linux/xbase.py', 'linux/controls.py'],
  },
};
const SRC = {};
const load = (f) => { SRC[f] = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^\uFEFF/, ''); };
for (const os of Object.keys(PARTS)) for (const op of Object.keys(PARTS[os])) for (const f of PARTS[os][op]) if (!(f in SRC)) load(f);
load('uia.cs');

// THE PROBE is one line both shells run without an error. cmd.exe expands %OS% (Windows_NT) and prints the
// rest -- quotes, $(...) and all -- literally; sh leaves %OS% alone, runs the $(...) and expands ${...}.
// Inside double quotes neither shell treats | or > as anything, so the fields survive both.
const PROBE = 'echo "desk-probe|%OS%|%PROCESSOR_ARCHITECTURE%|%USERNAME%|%SESSIONNAME%|$(uname -sm 2>/dev/null)|$(id -un 2>/dev/null)|${XDG_SESSION_TYPE}|${DISPLAY}|${WAYLAND_DISPLAY}"';

// The python bootstrap; linux/common.py re-runs itself with it (as the desktop's user) and must say the same.
const PY_BOOT = 'import sys,base64,zlib;exec(zlib.decompress(base64.b64decode(sys.argv[1]),31))';

// A script as it travels: the parts joined, comment lines and blank lines dropped (the prose is for people
// reading the files; on the wire it is only length). Indentation means nothing to PowerShell or C#, so it
// goes; Python's is kept, one space a level instead of four (block lines are multiples of four; a
// continuation line inside brackets may land anywhere and means nothing either). For controls on Windows the
// C# walker rides along as a here-string the PowerShell compiles -- its closing '@ stays at the line start.
function script(op, os) {
  const parts = PARTS[os] && PARTS[os][op];
  if (!parts) return null;
  let text = parts.map((f) => SRC[f]).join('\n');
  if (os === 'windows' && op === 'controls') text = "$DESKUIA=@'\n" + SRC['uia.cs'] + "\n'@\n" + text;
  const drop = os === 'windows' ? /^\s*(#|\/\/)/ : /^\s*#/;
  const indent = os === 'windows' ? (l) => l.replace(/^\s+/, '') : (l) => l.replace(/^((?: {4})+)/, (m) => ' '.repeat(m.length / 4));
  return text.split(/\r?\n/).filter((l) => l.trim() && !drop.test(l)).map((l) => indent(l.replace(/\s+$/, ''))).join('\n') + '\n';
}
const packed = {};
function payload(op, os) {
  const k = os + ':' + op;
  if (!(k in packed)) packed[k] = zlib.gzipSync(Buffer.from(script(op, os), 'utf8'), { level: 9 }).toString('base64');
  return packed[k];
}
const b64json = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

// WINDOWS: one -Command bootstrap that gunzips the script and Invoke-Expressions it, with the args as base64
// in $DA. The bootstrap has no double quote inside and base64 has no % ! ^ & | < >, so cmd.exe passes it
// through untouched -- the shape the viewer's Task Manager gather has run on real hosts. (-EncodedCommand
// would cost 2.67 characters of command line per character: base64 of UTF-16. The UI Automation script would
// not fit.) The mode is a TYPED CompressionMode 0 (Decompress): GZipStream also has a (Stream, CompressionLevel)
// constructor, and PowerShell's binder calls a bare 0 or a 'Decompress' string ambiguous between the two
// (measured: "Multiple ambiguous overloads found for new"). StreamReader reads UTF-8 by default.
function psCommand(scriptB64, argsB64) {
  return 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
    "$DA='" + argsB64 + "';Invoke-Expression ([IO.StreamReader]::new([IO.Compression.GZipStream]::new([IO.MemoryStream]::new([Convert]::FromBase64String('" +
    scriptB64 + "')),[IO.Compression.CompressionMode]0)).ReadToEnd())" + '"';
}
// LINUX: python3 decodes its own payload, so the line needs no base64/gzip binaries and carries nothing a
// shell could split or expand. A machine without python3 still answers in JSON.
function shCommand(op, scriptB64, argsB64) {
  const none = JSON.stringify({ ok: false, op, os: 'linux', why: 'python3 is not installed on this machine -- the Linux desk ops run on it', missing: ['python3'] });
  return "command -v python3 >/dev/null 2>&1 || { echo '" + none + "'; exit 1; }; exec python3 -c '" + PY_BOOT + "' " + scriptB64 + ' ' + argsB64;
}

// CommandLineToArgvW's rules in reverse: quote when there is a space, tab or quote; a quote is \" and the
// backslashes before a quote (or before the closing one) are doubled.
function winQuote(a) {
  a = String(a);
  if (a !== '' && !/[\s"]/.test(a)) return a;
  let out = '"', bs = 0;
  for (const ch of a) {
    if (ch === '\\') { bs++; continue; }
    if (ch === '"') { out += '\\'.repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += '\\'.repeat(bs) + ch; bs = 0;
  }
  return out + '\\'.repeat(bs * 2) + '"';
}
// An args STRING for Linux, split the way a shell would split it without running anything: '...' literal,
// "..." with \" \\ \$ \`, a backslash outside quotes escapes the next character. No expansion of any kind.
function splitArgs(s) {
  const out = []; let cur = '', has = false, q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = ''; else cur += c; continue; }
    if (q === '"') {
      if (c === '"') q = '';
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += c;
  }
  if (has || cur) out.push(cur);
  return out;
}

const fail = (why) => ({ ok: false, why });
const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, n)) : dflt; };
// A window id: the number `windows` gave, or the same as a string -- decimal, or 0x hex (how X ids are written).
function winId(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  const s = String(v).trim();
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? Number(s) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
const NUL = /\u0000/;

// The args each op ships, checked and filled in here, so a script never sees a field it did not expect.
function norm(op, a, os) {
  a = a && typeof a === 'object' ? a : {};
  const o = { op };
  if (op === 'focus' || op === 'controls') {
    if (a.id != null && a.id !== '') {
      const id = winId(a.id);
      if (id == null) return fail('id must be a window id from `windows` -- a number, or a 0x hex string');
      o.id = id;
    } else if (a.title != null && String(a.title) !== '') {
      o.title = String(a.title);
      if (o.title.length > 512 || NUL.test(o.title)) return fail('title must be part of a window title (at most 512 characters, no NUL)');
    } else if (op === 'focus') return fail('focus needs a `title` (part of the window title) or an `id` (from `windows`)');
  }
  if (op === 'focus' && a.dry) o.dry = true;
  if (op === 'controls') {
    o.max = int(a.max, 1, 1000, 200);
    o.depth = int(a.depth, 1, 30, 8);
    o.budget = int(a.budget, 1000, 8000, 7000);
  }
  if (op === 'launch') {
    const app = a.app == null ? '' : String(a.app).trim();
    if (!app) return fail('launch needs `app`: a program name ("notepad"), a path, or a URL');
    if (app.length > 2048 || NUL.test(app)) return fail('app must be a program name, a path or a URL (at most 2048 characters, no NUL)');
    o.app = app;
    let list = null, str = '';
    if (Array.isArray(a.args)) {
      if (!a.args.every((x) => typeof x === 'string' || typeof x === 'number')) return fail('args must be a string or an array of strings');
      list = a.args.map(String);
    } else if (a.args != null && a.args !== '') {
      if (typeof a.args !== 'string' && typeof a.args !== 'number') return fail('args must be a string or an array of strings');
      str = String(a.args);
    }
    if ((list && list.some((x) => NUL.test(x))) || NUL.test(str)) return fail('args must not contain NUL');
    if (os === 'windows') o.argline = list ? list.map(winQuote).join(' ') : str;
    else o.argv = list || splitArgs(str);
    if (a.cwd != null && a.cwd !== '') o.cwd = String(a.cwd);
    o.wait = int(a.wait, 0, 6000, 4000);
    o.focus = a.focus === undefined ? true : !!a.focus;
    if (a.dry) o.dry = true;
  }
  return o;
}

function build(op, args, os) {
  if (!OPS.includes(op)) return fail('unknown op "' + op + '" -- one of ' + OPS.join(', '));
  if (op === 'probe') return { ok: true, op, os: os || '', cmd: PROBE, len: PROBE.length };
  const o2 = String(os || '').toLowerCase();
  const sys = /^(windows|win32|win)$/.test(o2) ? 'windows' : /^linux$/.test(o2) ? 'linux' : '';
  if (!sys) return fail('os must be "windows" or "linux" (run the probe op to find out which)');
  const a = norm(op, args, sys);
  if (a.ok === false) return a;
  const cmd = sys === 'windows' ? psCommand(payload(op, sys), b64json(a)) : shCommand(op, payload(op, sys), b64json(a));
  if (cmd.length >= LIMIT) return fail('the command would be ' + cmd.length + ' characters, over the ' + LIMIT + ' this keeps under cmd.exe\'s 8,191 -- shorten the title or the args');
  return { ok: true, op, os: sys, cmd, len: cmd.length };
}

// What the shell said when the script never got to answer.
function known(text) {
  if (/command line is too long/i.test(text)) return 'cmd.exe refused the command line as too long (its limit is 8,191 characters)';
  if (/'powershell' is not recognized/i.test(text)) return 'PowerShell is not available on this host (powershell is not on its PATH)';
  if (/language mode|Only core types are supported/i.test(text)) return 'PowerShell runs in Constrained Language Mode here (WDAC/AppLocker), which blocks the window APIs this needs';
  if (/malicious content and has been blocked by your antivirus/i.test(text)) return 'the antivirus on the host (AMSI) blocked the script';
  if (/python3: (command )?not found/i.test(text)) return 'python3 is not installed on this machine';
  const m = /^(.*is not recognized as an internal or external command.*)$/im.exec(text) || /^(.*: (?:command )?not found)$/im.exec(text);
  if (m) return 'the host could not run it: ' + m[1].trim();
  return '';
}

// CONTROL TYPES, NAMED HERE, where a table costs no command line. Windows sends UI Automation's control type
// ID (50000 Button ... 50040 AppBar, in UIAutomationClient.h's order); Linux sends AT-SPI's role name, which
// maps onto the same vocabulary so one reader serves both hosts (the role itself stays in `class`).
const UIA_TYPES = ('Button Calendar CheckBox ComboBox Edit Hyperlink Image ListItem List Menu MenuBar MenuItem ProgressBar ' +
  'RadioButton ScrollBar Slider Spinner StatusBar Tab TabItem Text ToolBar ToolTip Tree TreeItem Custom Group Thumb DataGrid ' +
  'DataItem Document SplitButton Window Pane Header HeaderItem Table TitleBar Separator SemanticZoom AppBar').split(' ');
const ATSPI_TYPES = {};
for (const [type, roles] of Object.entries({
  Button: 'push button|toggle button|button', CheckBox: 'check box', RadioButton: 'radio button', ComboBox: 'combo box',
  Edit: 'text|entry|password text', Spinner: 'spin button', Text: 'label|static|heading|paragraph', Hyperlink: 'link',
  Image: 'image|icon', List: 'list|list box', ListItem: 'list item', MenuBar: 'menu bar', Menu: 'menu|popup menu',
  MenuItem: 'menu item|check menu item|radio menu item|tearoff menu item', ProgressBar: 'progress bar', ScrollBar: 'scroll bar',
  Slider: 'slider', StatusBar: 'status bar', Tab: 'page tab list', TabItem: 'page tab', ToolBar: 'tool bar', ToolTip: 'tool tip',
  Tree: 'tree|tree table', TreeItem: 'tree item', Table: 'table', DataItem: 'table cell|table row',
  HeaderItem: 'column header|row header|table column header|table row header', Header: 'header',
  Document: 'document frame|document web|document text|document email', Window: 'frame|dialog|window|alert|file chooser',
  Separator: 'separator', Pane: 'panel|filler|scroll pane|split pane|viewport|layered pane|root pane|glass pane|internal frame',
  Group: 'section|grouping|form', TitleBar: 'title bar', Calendar: 'calendar',
})) for (const r of roles.split('|')) ATSPI_TYPES[r] = type;
function typeName(t) {
  if (typeof t === 'number') return UIA_TYPES[t - 50000] || (t ? String(t) : '');
  if (typeof t !== 'string' || !/^[a-z ]+$/.test(t)) return t;
  return ATSPI_TYPES[t] || t.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

// The scripts list controls breadth-first (so a cut keeps the layout); a reader wants them as an outline.
// Re-number them in document order -- every parent before its children, siblings in their order.
function docOrder(list) {
  const items = list.filter((e) => e && typeof e === 'object');
  const ids = new Set(items.map((e) => e.i));
  const kids = new Map(), roots = [];
  for (const e of items) {
    if (e.p != null && e.p !== -1 && e.p !== e.i && ids.has(e.p)) { if (!kids.has(e.p)) kids.set(e.p, []); kids.get(e.p).push(e); }
    else roots.push(e);
  }
  const out = [], at = new Map(), seen = new Set(), stack = roots.slice().reverse();
  while (stack.length) {
    const e = stack.pop();
    if (seen.has(e)) continue;
    seen.add(e); at.set(e.i, out.length); out.push(e);
    const k = kids.get(e.i);
    if (k) for (let j = k.length - 1; j >= 0; j--) stack.push(k[j]);
  }
  return out.map((e, n) => Object.assign({}, e, { i: n, p: e.p != null && e.p !== -1 && at.has(e.p) ? at.get(e.p) : -1, type: typeName(e.type) }));
}

function parseProbe(text) {
  const m = /desk-probe\|([^\r\n"]*)/.exec(text);
  if (!m) return { ok: false, op: 'probe', why: known(text) || 'no probe answer in the output', output: text.slice(0, 400) };
  const f = m[1].split('|');
  // cmd.exe leaves an UNSET %VAR% as written and prints $(...) and ${...} literally; sh prints every %VAR%
  // literally. Either leftover means "a field of the other shell", so it reads as empty.
  const val = (s) => (s == null || /^%\w+%$/.test(s) || /^\$[({]/.test(s)) ? '' : s.trim();
  if (f[0] === 'Windows_NT') return { ok: true, op: 'probe', os: 'windows', shell: 'cmd', arch: val(f[1]), user: val(f[2]), session: val(f[3]) };
  if (f[0] === '%OS%') {
    const un = val(f[4]).split(/\s+/);
    const os = /^linux$/i.test(un[0]) ? 'linux' : /^darwin$/i.test(un[0]) ? 'mac' : (un[0] || 'unix').toLowerCase();
    return { ok: true, op: 'probe', os, shell: 'sh', arch: un[1] || '', user: val(f[5]), sessionType: val(f[6]), display: val(f[7]), wayland: val(f[8]) };
  }
  return { ok: false, op: 'probe', why: 'the probe answer is not one this knows', output: text.slice(0, 400) };
}

function parse(op, output) {
  const text = output == null ? '' : String(output);
  if (!text.trim()) return { ok: false, op, why: 'no output -- the host answered with nothing (an exec the host ended at its 10 s deadline returns nothing)' };
  if (op === 'probe') return parseProbe(text);
  // The answer is ONE line of JSON whose op is this op; anything before it (a cmd.exe AutoRun banner, a
  // warning on stderr) is noise, and a JSON line about something else is not the answer.
  const lines = text.split(/\r?\n/);
  let cut = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(l); } catch (_) { if (/^\{"ok":/.test(l)) cut = true; continue; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.op !== op || typeof o.ok !== 'boolean') continue;
    if (op === 'controls' && Array.isArray(o.controls)) o.controls = docOrder(o.controls);
    return o;
  }
  const why = known(text) || (cut ? 'the answer was cut short (the output ends inside it)' : 'no answer in the output');
  return { ok: false, op, why, output: text.slice(0, 400) };
}

module.exports = { build, parse, script, OPS, LIMIT, PROBE, PY_BOOT, winQuote, splitArgs, docOrder };

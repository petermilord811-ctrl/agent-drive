'use strict';
// @tool window & app awareness on the host through `exec`: list windows + monitors, focus one, launch an app, read a window's controls (UI Automation / AT-SPI: names and rects, never values); files in chunks (stat, read, write), one webcam photo, a few seconds of what it is playing
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
// FILES, A WEBCAM PHOTO, A SOUND RECORDING -- the same exec, for the serve's fetch / send / camera / audio verbs
// (camera and audio need the operator's yes every time; that is the caller's part). Paths are LITERAL: they travel
// base64-encoded, so no shell sees them and nothing in them is expanded; 1..1024 characters, no control
// characters. A relative path resolves against the host's own folder -- every answer says `full`.
//   stat   {path}                     is there a file or folder there; never fails for "nothing there"
//   read   {path, off?=0, n?=256 KB}  one chunk, as base64; n at most READ_MAX (360 KB: base64 of it stays inside
//                                     the host's 512 KB of output). Read from off + n until total.
//   write  {path, b64, append?, at?}  one chunk: append:false creates or empties the file, append:true adds to it;
//                                     at = where this chunk starts (a resent chunk then lands once). b64 is whole
//                                     groups of 4 -- slice a file's base64 by writeChunk(os, path), which is how
//                                     much one command can carry (a short path: Windows 5,880, Linux 118,124)
//   rm     {path}                     remove a capture's temp file -- nothing else: refused unless the name is one a
//                                     capture made (agent-drive-cam-<16 hex>.jpg / agent-drive-rec-<16 hex>.wav) in
//                                     the host's temp folder
//   camera {device?, dry?}            one webcam photo -> a JPEG temp file; device = part of the camera's name
//   audio  {seconds?=5, dry?}         what the machine is PLAYING (loopback; never a microphone), 1..7 s -> a WAV
//                                     temp file (mono 16-bit); dry: find the device, record nothing
//   A capture is ONE command on both systems. Then: read its `path` in chunks, then rm it. (On Windows the C#
//   loopback recorder compiles inside the same command -- ~0.2 s measured -- and the clip is cut short, saying so,
//   if the host's 10 s would not hold it.)
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
//   stat     {exists, dir, size (null for a folder or nothing), full, mtime (ms since 1970)}
//   read     {total, off, n, full, b64} -- parse checks the base64 holds exactly n bytes
//   write    {size (the file's, after), wrote, full}
//   rm       {removed (false: already gone), full}
//   camera   {path, mime, bytes, device, cameras:[names], tool (Linux)} | dry: {device, cameras}
//   audio    {path, mime, seconds, rate, channels, bytes, peak (0..1), device, asked?, note?} | dry: {device, ...}
//            A clear why for each way these fail: no such file or folder, a folder, no permission, read-only, open
//            in another program, a chunk missing, no camera (or none of that name), no playback device, a tool not
//            installed (by name, in `missing`). A file op's failure also carries err (nofile, nodir, denied, ...):
//            the scripts answer the code and parse() says it in words (FILE_WHYS).
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
// 128 KB an argument -- one budget, one test. (The one exception is a write's data: WRITE_LIMIT.)
const LIMIT = 8000;
const OPS = ['probe', 'windows', 'focus', 'launch', 'controls', 'stat', 'read', 'write', 'rm', 'camera', 'audio'];
// A WRITE'S DATA may fill each system's own limit rather than the one budget above: cmd.exe's line on Windows (the
// same 8000), and on Linux the 128 KB the kernel allows ONE argument (MAX_ARG_STRLEN, 131,072 -- and `sh -c` takes
// the whole line as one) less a margin: 120,000, the figure the relay's own agent holds a Linux command to. A send
// is round trips, one per command, and 15x fewer of them is the difference between seconds and minutes.
const WRITE_LIMIT = { windows: LIMIT, linux: 120000 };
// A READ's answer is base64 (4/3 of the bytes) and the host keeps 512 KB of an exec's output (both hosts:
// RunCommandCapture / runCapture, then truncated:true): 360 KB of file is 491,520 characters of base64, which
// leaves ~26 KB for the JSON around it and any banner in front. 256 KB unless asked.
const READ_N = 256 * 1024, READ_MAX = 360 * 1024;
// A clip ends well inside the host's 10 s: PowerShell's start and the recorder's compile (~0.5 s measured), or
// python's start and finding the sound server (~0.3 s), come first. 7 s fits whole on a normal machine; a slow one
// cuts the clip and says so (audio.ps1, linux/audio.py).
const AUDIO_MAX = 7;
const PATH_MAX = 1024;
// The temp files camera and audio leave (core/desk/temp.ps1, linux/temp.py), and the only names rm accepts.
const CAPTURE = /^agent-drive-(cam-[0-9a-f]{16}\.jpg|rec-[0-9a-f]{16}\.wav)$/;

// The scripts each op ships, in order -- only the parts it calls, because every byte is command line. The
// Windows ones are PowerShell 5.1 (on every Windows 10/11), with C# for UI Automation (uia.cs) and for the
// loopback recorder (loop.cs); the Linux ones are python3 driving the tools that are there.
const PARTS = {
  windows: {
    windows: ['common.ps1', 'screens.ps1', 'windows.ps1'],
    focus: ['common.ps1', 'front.ps1', 'focus.ps1'],
    launch: ['common.ps1', 'front.ps1', 'launch.ps1'],
    controls: ['common.ps1', 'controls.ps1'],
    // The file and capture ops call no window API: lean.ps1 is common.ps1's DOut/DRun without the native calls,
    // and a write's chunk is what that leaves of the line.
    stat: ['lean.ps1', 'fs.ps1', 'stat.ps1'],
    read: ['lean.ps1', 'fs.ps1', 'read.ps1'],
    write: ['lean.ps1', 'fs.ps1', 'write.ps1'],
    rm: ['lean.ps1', 'fs.ps1', 'temp.ps1', 'rm.ps1'],
    camera: ['lean.ps1', 'temp.ps1', 'camera.ps1'],
    audio: ['lean.ps1', 'temp.ps1', 'audio.ps1'],
  },
  linux: {
    windows: ['linux/common.py', 'linux/xbase.py', 'linux/xgeo.py', 'linux/xlist.py', 'linux/windows.py'],
    focus: ['linux/common.py', 'linux/xbase.py', 'linux/xgeo.py', 'linux/xlist.py', 'linux/xfront.py', 'linux/focus.py'],
    launch: ['linux/common.py', 'linux/xbase.py', 'linux/xgeo.py', 'linux/xfront.py', 'linux/launch.py'],
    controls: ['linux/common.py', 'linux/xbase.py', 'linux/controls.py'],
    // lean.py: common.py's head without the desktop-session discovery, which a file has no use for. audio is
    // the one that needs the session (the sound server is the person's), so it ships common.py instead.
    stat: ['linux/lean.py', 'linux/fs.py', 'linux/stat.py'],
    read: ['linux/lean.py', 'linux/fs.py', 'linux/read.py'],
    write: ['linux/lean.py', 'linux/fs.py', 'linux/write.py'],
    rm: ['linux/lean.py', 'linux/fs.py', 'linux/temp.py', 'linux/rm.py'],
    camera: ['linux/lean.py', 'linux/temp.py', 'linux/media.py', 'linux/camera.py'],
    audio: ['linux/common.py', 'linux/temp.py', 'linux/media.py', 'linux/audio.py'],
  },
};
// C# that rides inside an op's script as a here-string its PowerShell compiles (its closing '@ stays at a line's
// start): [variable, file, where]. WHERE MATTERS, MEASURED: audio's script with the C# at the TOP took 1.7-3.6 s to
// start, every run, against 0.5 s with the very same text placed just before audio.ps1 -- the antimalware scan
// (AMSI) scoring the Invoke-Expression'd text as a whole, the effect launch.ps1 describes. controls keeps the
// place it has always run from on real hosts.
const EMBED = { controls: ['DESKUIA', 'uia.cs', 'first'], audio: ['DESKLOOP', 'loop.cs', 'before the op'] };
const SRC = {};
const load = (f) => { SRC[f] = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^\uFEFF/, ''); };
for (const os of Object.keys(PARTS)) for (const op of Object.keys(PARTS[os])) for (const f of PARTS[os][op]) if (!(f in SRC)) load(f);
for (const op of Object.keys(EMBED)) load(EMBED[op][1]);

// THE PROBE is one line both shells run without an error. cmd.exe expands %OS% (Windows_NT) and prints the
// rest -- quotes, $(...) and all -- literally; sh leaves %OS% alone, runs the $(...) and expands ${...}.
// Inside double quotes neither shell treats | or > as anything, so the fields survive both.
const PROBE = 'echo "desk-probe|%OS%|%PROCESSOR_ARCHITECTURE%|%USERNAME%|%SESSIONNAME%|$(uname -sm 2>/dev/null)|$(id -un 2>/dev/null)|${XDG_SESSION_TYPE}|${DISPLAY}|${WAYLAND_DISPLAY}"';

// The python bootstrap; linux/common.py re-runs itself with it (as the desktop's user) and must say the same.
const PY_BOOT = 'import sys,base64,zlib;exec(zlib.decompress(base64.b64decode(sys.argv[1]),31))';

// A script as it travels: the parts joined, comment lines and blank lines dropped (the prose is for people
// reading the files; on the wire it is only length). Indentation means nothing to PowerShell or C#, so it
// goes; Python's is kept, one space a level instead of four (block lines are multiples of four; a
// continuation line inside brackets may land anywhere and means nothing either). For controls and audio on
// Windows the C# (EMBED) rides along as a here-string the PowerShell compiles -- its closing '@ stays at the line start.
function script(op, os) {
  const parts = PARTS[os] && PARTS[os][op];
  if (!parts) return null;
  const texts = parts.map((f) => SRC[f]);
  if (os === 'windows' && EMBED[op]) {
    const [name, file, where] = EMBED[op], here = '$' + name + "=@'\n" + SRC[file] + "\n'@";
    if (where === 'first') texts.unshift(here); else texts.splice(texts.length - 1, 0, here);
  }
  const text = texts.join('\n');
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
// A write's chunk (dataB64) rides in $DB beside the args, base64 once, as bare as $DA.
function psCommand(scriptB64, argsB64, dataB64) {
  return 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
    "$DA='" + argsB64 + "';" + (dataB64 == null ? '' : "$DB='" + dataB64 + "';") +
    "Invoke-Expression ([IO.StreamReader]::new([IO.Compression.GZipStream]::new([IO.MemoryStream]::new([Convert]::FromBase64String('" +
    scriptB64 + "')),[IO.Compression.CompressionMode]0)).ReadToEnd())" + '"';
}
// LINUX: python3 decodes its own payload, so the line needs no base64/gzip binaries and carries nothing a
// shell could split or expand. A machine without python3 still answers in JSON. A write's chunk is a third
// argument ('' when the chunk is empty: an empty file is one write of nothing).
function shCommand(op, scriptB64, argsB64, dataB64) {
  const none = JSON.stringify({ ok: false, op, os: 'linux', why: 'python3 is not installed on this machine -- the Linux desk ops run on it', missing: ['python3'] });
  return "command -v python3 >/dev/null 2>&1 || { echo '" + none + "'; exit 1; }; exec python3 -c '" + PY_BOOT + "' " + scriptB64 + ' ' + argsB64 +
    (dataB64 == null ? '' : ' ' + (dataB64 || "''"));
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
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const b64bytes = (s) => s.length / 4 * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
// A path for the file ops: a string of 1..PATH_MAX characters with no control character (Windows allows none in a
// name, on Linux one is a name nobody typed, and each would cost six characters of JSON escape on the line).
function filePath(v, op) {
  if (typeof v !== 'string' || !v) return fail(op + ' needs `path`: the file on the host (absolute, or relative to the host\'s own folder)');
  if (v.length > PATH_MAX || /[\u0000-\u001f]/.test(v)) return fail('path must be at most ' + PATH_MAX + ' characters with no control characters');
  return v;
}
const whole = (v) => (typeof v === 'number' || (typeof v === 'string' && /^\s*\d+\s*$/.test(v))) && Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;

// The file and capture ops' args (see the header).
function normFile(op, a, o) {
  if (op === 'stat' || op === 'read' || op === 'write' || op === 'rm') {
    const p = filePath(a.path, op);
    if (typeof p !== 'string') return p;
    o.path = p;
  }
  if (op === 'read') {
    if (a.off != null && a.off !== '') {
      o.off = whole(a.off);
      if (o.off == null) return fail('off must be a byte offset: a whole number, 0 or more');
    } else o.off = 0;
    o.n = int(a.n, 1, READ_MAX, READ_N);
  }
  if (op === 'write') {
    if (typeof a.b64 !== 'string' || a.b64.length % 4 || !B64.test(a.b64)) {
      return fail('write needs `b64`: the chunk as base64, in whole groups of 4 characters -- slice the file\'s base64 by writeChunk(os, path), which is a multiple of 4');
    }
    o.append = !!a.append;
    if (a.at != null && a.at !== '') {
      const at = whole(a.at);
      if (at == null) return fail('at must be a byte offset: a whole number, 0 or more');
      if (!o.append && at !== 0) return fail('at goes with append:true -- the first chunk (append:false) starts the file at 0');
      if (o.append) o.at = at;
    }
  }
  if (op === 'rm') {
    const name = o.path.split(/[\\/]/).pop();
    if (!CAPTURE.test(name)) return fail('rm removes only the temp file a capture made (agent-drive-cam-<16 hex>.jpg or agent-drive-rec-<16 hex>.wav, the `path` camera or audio answered) -- "' + name.slice(0, 80) + '" is not one');
  }
  if (op === 'camera' && a.device != null && a.device !== '') {
    o.device = String(a.device);
    if (o.device.length > 200 || /[\u0000-\u001f]/.test(o.device)) return fail('device must be part of a camera\'s name (at most 200 characters)');
  }
  if (op === 'audio') {
    const s = Number(a.seconds);
    o.seconds = a.seconds == null || a.seconds === '' || !Number.isFinite(s) ? 5 : Math.max(1, Math.min(AUDIO_MAX, Math.round(s * 10) / 10));
  }
  if ((op === 'camera' || op === 'audio') && a.dry) o.dry = true;
  return o;
}

// The args each op ships, checked and filled in here, so a script never sees a field it did not expect.
function norm(op, a, os) {
  a = a && typeof a === 'object' ? a : {};
  const o = { op };
  if (['stat', 'read', 'write', 'rm', 'camera', 'audio'].includes(op)) return normFile(op, a, o);
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

const sysOf = (os) => {
  const o2 = String(os || '').toLowerCase();
  return /^(windows|win32|win)$/.test(o2) ? 'windows' : /^linux$/.test(o2) ? 'linux' : '';
};
// One op's command line: the bootstrap, the packed script, the args -- and a write's chunk beside them.
function line(op, sys, a, data) {
  return sys === 'windows' ? psCommand(payload(op, sys), b64json(a), data) : shCommand(op, payload(op, sys), b64json(a), data);
}

function build(op, args, os) {
  if (!OPS.includes(op)) return fail('unknown op "' + op + '" -- one of ' + OPS.join(', '));
  if (op === 'probe') return { ok: true, op, os: os || '', cmd: PROBE, len: PROBE.length };
  const sys = sysOf(os);
  if (!sys) return fail('os must be "windows" or "linux" (run the probe op to find out which)');
  const a = norm(op, args, sys);
  if (a.ok === false) return a;
  const cmd = line(op, sys, a, op === 'write' ? args.b64 : undefined);
  if (op === 'write' && cmd.length >= WRITE_LIMIT[sys]) {
    return fail('the command would be ' + cmd.length + ' characters, over the ' + WRITE_LIMIT[sys] + ' one write can carry on ' + sys +
      ' -- slice the base64 by writeChunk(os, path): ' + writeChunk(sys, a.path) + ' characters for this path');
  }
  if (op !== 'write' && cmd.length >= LIMIT) return fail('the command would be ' + cmd.length + ' characters, over the ' + LIMIT + ' this keeps under cmd.exe\'s 8,191 -- shorten the ' + (a.path ? 'path' : 'title or the args'));
  return { ok: true, op, os: sys, cmd, len: cmd.length };
}

// HOW MUCH ONE WRITE CARRIES: the base64 characters of a chunk that fit beside everything else on the line (the
// bootstrap, the packed script, the args -- with append and the largest `at`) under the system's limit, in whole
// groups of 4, so a file's base64 cut at every multiple of it gives chunks that each decode alone. Pass the path
// for the exact figure; without one it holds for any path of up to 260 characters (Windows' MAX_PATH), whatever
// they are made of -- the worst is 260 that each take three bytes of UTF-8 (U+4E2D, a CJK character). 0 for an
// os it does not know.
const WORST_PATH = String.fromCharCode(0x4e2d).repeat(260);
function writeChunk(os, p) {
  const sys = sysOf(os);
  if (!sys) return 0;
  const a = normFile('write', { path: p == null || p === '' ? WORST_PATH : String(p), b64: '', append: true, at: Number.MAX_SAFE_INTEGER }, { op: 'write' });
  if (a.ok === false) return 0;
  const base = line('write', sys, a, '').length - (sys === 'linux' ? 2 : 0);
  return Math.max(0, Math.floor((WRITE_LIMIT[sys] - 1 - base) / 4) * 4);
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

// THE FILE OPS' FAILURES, SAID HERE, where the words cost no command line (every byte of the write script is a
// byte of file a chunk cannot carry). fs.ps1 and linux/fs.py answer a code -- {err, verb, full, msg} -- so both
// systems say the same thing the same way.
const FILE_WHYS = {
  nofile: (o) => 'no such file: ' + o.full,
  nodir: (o) => 'no such folder: ' + (o.dir || (o.os === 'windows' ? path.win32 : path.posix).dirname(String(o.full || ''))),
  denied: (o) => 'no permission to ' + o.verb + ' ' + o.full,
  readonly: (o) => 'no permission to write ' + o.full + ': the file is read-only',
  isdir: (o) => o.full + (o.verb === 'write' ? ' is a folder -- write needs the path of a file' : ' is a folder, not a file'),
  notdir: (o) => 'a part of the path is not a folder: ' + o.full,
  inuse: (o) => o.full + ' is open in another program that does not let others ' + o.verb + ' it',
  diskfull: (o) => 'the disk is full: could not ' + o.verb + ' ' + o.full,
  rofs: (o) => 'could not ' + o.verb + ' ' + o.full + ': the file system is read-only',
  toolong: (o) => 'the path is too long for this system: ' + o.full,
  badpath: (o) => 'not a usable path: ' + o.full + (o.msg ? ' (' + String(o.msg).trim() + ')' : ''),
  special: (o) => o.full + ' is not a regular file (a device, a pipe or a socket) -- read takes files',
  noappend: (o) => 'nothing to add to: ' + o.full + ' does not exist (the first chunk, append:false, creates it)',
  gap: (o) => o.full + ' is ' + o.size + ' bytes, but this chunk starts at ' + o.at + ' -- a chunk before it is missing',
  notmine: (o) => 'not a file a capture made: rm removes only agent-drive-cam-*.jpg and agent-drive-rec-*.wav files in ' + (o.temp || "the host's temp folder"),
  other: (o) => 'could not ' + o.verb + ' ' + o.full + (o.msg ? ': ' + String(o.msg).trim() : ''),
};

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
    if (!o.ok && !o.why && typeof o.err === 'string') o.why = (Object.prototype.hasOwnProperty.call(FILE_WHYS, o.err) ? FILE_WHYS[o.err] : FILE_WHYS.other)(o);
    // A chunk is taken only whole: base64 that holds exactly the n bytes the script said it read.
    if (op === 'read' && o.ok && !(typeof o.b64 === 'string' && o.b64.length % 4 === 0 && B64.test(o.b64) && b64bytes(o.b64) === o.n &&
        Number.isSafeInteger(o.total) && Number.isSafeInteger(o.off))) {
      return { ok: false, op, why: 'the chunk arrived damaged (its base64 does not hold the ' + o.n + ' bytes the host read) -- read it again', full: o.full };
    }
    return o;
  }
  const why = known(text) || (cut ? 'the answer was cut short (the output ends inside it)' : 'no answer in the output');
  return { ok: false, op, why, output: text.slice(0, 400) };
}

module.exports = { build, parse, script, writeChunk, OPS, LIMIT, WRITE_LIMIT, READ_N, READ_MAX, AUDIO_MAX, PATH_MAX, CAPTURE, PROBE, PY_BOOT, winQuote, splitArgs, docOrder };

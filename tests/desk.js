// desk.js -- core/desk.js: window & app awareness on the host through `exec` (list the windows,
// focus one, launch an app, read a window's controls). Offline: what build() puts on the command line (length,
// quoting, the payload and args round trip), what parse() makes of answers and of garbage, that every shipped
// script parses, and the Linux AT-SPI walk against a stand-in `gi` module. LIVE on Windows only: a private
// WinForms window (shown without activation, at the bottom of the Z order, no taskbar button) is listed by
// `windows`, read by `controls` -- its button found, its password box flagged, and its secret NOWHERE in the
// output -- and found by `focus`/`launch` in dry mode; launch's run-as-the-signed-in-user path (the Windows host is
// LocalSystem) is driven with this account's own token against a stand-in Start-Process. focus and launch never
// run for real here: they would take the person's focus or open an app on their desktop. Everything the test
// starts is hidden and gone when it ends; the temp folder is removed.
//   node tests/desk.js            (DESK_VERBOSE=1 prints every check, with what it measured)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const desk = require(path.join(__dirname, '..', 'core', 'desk.js'));

let pass = 0, fail = 0;
const VERBOSE = !!process.env.DESK_VERBOSE;
const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('  ok: ' + m); } else { fail++; console.error('  FAIL: ' + m); } };
const WIN = process.platform === 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-test-'));
const b64d = (s) => Buffer.from(s, 'base64');

// The two halves of a built command line: the shipped script and the args.
function partsOf(b) {
  if (b.os === 'windows') {
    const a = /\$DA='([A-Za-z0-9+/=]*)'/.exec(b.cmd), s = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(b.cmd);
    return a && s ? { args: JSON.parse(b64d(a[1]).toString('utf8')), script: zlib.gunzipSync(b64d(s[1])).toString('utf8') } : null;
  }
  const m = / ([A-Za-z0-9+/=]+) ([A-Za-z0-9+/=]+)$/.exec(b.cmd);
  return m ? { args: JSON.parse(b64d(m[2]).toString('utf8')), script: zlib.gunzipSync(b64d(m[1])).toString('utf8'), payload: m[1], argsB64: m[2] } : null;
}
const sample = { windows: {}, focus: { title: 'Notepad' }, launch: { app: 'notepad' }, controls: {} };

// ---- build: every op, both systems, under the limit, and shaped so no shell can touch it --------------------
for (const sys of ['windows', 'linux']) {
  for (const op of ['windows', 'focus', 'launch', 'controls']) {
    const b = desk.build(op, sample[op], sys);
    ok(b.ok && typeof b.cmd === 'string' && b.cmd.length === b.len, sys + ' ' + op + ' builds (' + (b.why || '') + ')');
    if (!b.ok) continue;
    console.log('  ' + sys.padEnd(8) + op.padEnd(9) + String(b.len).padStart(5) + ' characters');
    ok(b.len < 8000, sys + ' ' + op + ' is under 8000 characters (' + b.len + ')');
    ok(!/[\r\n]/.test(b.cmd), sys + ' ' + op + ' is one line');
    const p = partsOf(b);
    ok(p && p.script === desk.script(op, sys), sys + ' ' + op + ': the payload unpacks to exactly the assembled script');
    ok(p && p.args.op === op, sys + ' ' + op + ': the args carry the op');
    if (sys === 'windows') {
      ok(b.cmd.startsWith('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "') && b.cmd.endsWith('"'), 'windows ' + op + ': the PowerShell bootstrap');
      ok((b.cmd.match(/"/g) || []).length === 2 && !/[%!^&|<>]/.test(b.cmd), 'windows ' + op + ": one quoted argument, none of cmd.exe's special characters");
    } else {
      ok(b.cmd.includes("exec python3 -c '" + desk.PY_BOOT + "' "), 'linux ' + op + ': the python bootstrap');
      ok(p && /^[A-Za-z0-9+/=]+$/.test(p.payload + p.argsB64), 'linux ' + op + ': payload and args are bare base64');
    }
  }
}
ok(desk.build('probe', {}, 'windows').cmd === desk.build('probe', {}, 'linux').cmd && desk.build('probe').ok, 'the probe is one command for every shell');
ok(desk.build('probe').cmd.length < 200, 'the probe is cheap');
const lin = desk.script('controls', 'linux');
ok(lin.includes(desk.PY_BOOT), "the Linux scripts re-run themselves with desk.js's own bootstrap (common.py BOOT matches PY_BOOT)");

// ---- quoting: what a person types never reaches a shell as text ------------------------------------------
const nasty = 'Tom & Jerry "100%" ^caret! <tag> | pipe \'single\' $(rm -rf ~) `tick` %PATH% \u4e2d\u6587 \ud83d\ude42';
for (const sys of ['windows', 'linux']) {
  const f = desk.build('focus', { title: nasty }, sys);
  ok(f.ok && partsOf(f).args.title === nasty, sys + ': a title with & " % ^ ! < > | \' $( ` and non-ASCII round-trips exactly');
  ok(f.ok && !f.cmd.includes('Jerry') && !f.cmd.includes('%PATH%') && !f.cmd.includes('rm -rf'), sys + ': ...and is nowhere on the command line as text');
  const l = desk.build('launch', { app: 'C:\\Program Files\\My App\\app.exe', args: ['--name', nasty] }, sys);
  ok(l.ok && !l.cmd.includes('Program Files'), sys + ': an app path with spaces travels encoded too');
}
const lw = partsOf(desk.build('launch', { app: 'notepad', args: ['C:\\a b\\', 'x"y', '', 'plain', 'tab\there'] }, 'windows')).args;
ok(lw.argline === '"C:\\a b\\\\" "x\\"y" "" plain "tab\there"', 'windows: an args array is quoted the CommandLineToArgvW way (' + lw.argline + ')');
ok(partsOf(desk.build('launch', { app: 'notepad', args: '/A "x y"' }, 'windows')).args.argline === '/A "x y"', 'windows: an args string is passed as it is');
ok(JSON.stringify(partsOf(desk.build('launch', { app: 'gedit', args: 'a "b c" \'d e\' f\\ g "q\\"q"' }, 'linux')).args.argv) === JSON.stringify(['a', 'b c', 'd e', 'f g', 'q"q']),
   'linux: an args string is split like a shell would, with nothing expanded');
ok(JSON.stringify(desk.splitArgs('$HOME `x` "$(y)"')) === JSON.stringify(['$HOME', '`x`', '$(y)']), 'linux: $VARS and backticks stay literal');
if (WIN) {
  // The real reader of a Windows command line: a program's own argv parser (node's is the MSVC runtime's).
  const want = ['C:\\a b\\', 'x"y', '', 'plain', 'back\\\\slash" quote', 'C:\\x\\'];
  const r = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', want.map(desk.winQuote).join(' ')], { windowsVerbatimArguments: true, encoding: 'utf8' });
  ok(r.stdout.trim() === JSON.stringify(want), 'windows: a program reads the quoted args back exactly (' + r.stdout.trim() + ')');
}

// ---- args are checked before anything is built ------------------------------------------------------------
const no = (op, a, sys, re, m) => { const b = desk.build(op, a, sys || 'windows'); ok(!b.ok && re.test(b.why || ''), m + ' (' + (b.why || 'built') + ')'); };
no('dance', {}, 'windows', /unknown op/, 'an unknown op is refused');
no('windows', {}, 'macos', /os must be/, 'an unknown os is refused');
no('focus', {}, 'windows', /title.*id/, 'focus without a title or id is refused');
no('focus', { id: 'abc' }, 'linux', /window id/, 'a malformed id is refused');
no('launch', {}, 'windows', /needs `app`/, 'launch without an app is refused');
no('launch', { app: 'x', args: [{}] }, 'windows', /args must be/, 'args that are not strings are refused');
no('launch', { app: 'x\u0000y' }, 'windows', /NUL/, 'a NUL in the app is refused');
no('controls', { title: 'x'.repeat(600) }, 'windows', /512/, 'an over-long title is refused');
no('controls', { title: 'y'.repeat(400) }, 'windows', /characters, over the 8000/, 'a title that would push the line past 8000 is refused, not sent');
ok(partsOf(desk.build('focus', { id: '0x1A2B' }, 'linux')).args.id === 0x1a2b && partsOf(desk.build('focus', { id: '4242' }, 'windows')).args.id === 4242, 'an id as hex or decimal text becomes a number');
const ca = partsOf(desk.build('controls', { max: 99999, depth: 0, budget: 50 }, 'windows')).args;
ok(ca.max === 1000 && ca.depth === 1 && ca.budget === 1000, 'max/depth/budget are clamped (' + JSON.stringify(ca) + ')');
const cd = partsOf(desk.build('controls', {}, 'linux')).args;
ok(cd.max === 200 && cd.depth === 8 && cd.budget === 7000 && cd.id === undefined && cd.title === undefined, 'controls defaults: max 200, depth 8, the foreground window');
const la = partsOf(desk.build('launch', { app: 'notepad' }, 'windows')).args;
ok(la.wait === 4000 && la.focus === true && la.argline === '' && !la.dry, 'launch defaults: wait 4 s, then bring its window forward');

// ---- parse: answers, noise, and the ways a command fails without one ---------------------------------------
const P = desk.parse;
ok(!P('windows', '').ok && /no output/.test(P('windows', '   \r\n').why) && !P('windows', null).ok, 'no output is a failure that says so');
const g = P('windows', 'garbage\x00\x01 nothing here');
ok(!g.ok && /no answer/.test(g.why) && g.output.includes('garbage'), 'garbage is a failure that shows what came back');
ok(/too long/.test(P('controls', 'The command line is too long.\r\n').why), 'cmd.exe refusing the length is named');
ok(/PowerShell is not available/.test(P('windows', "'powershell' is not recognized as an internal or external command,\r\noperable program or batch file.").why), 'a missing PowerShell is named');
ok(/Constrained Language/.test(P('windows', 'Cannot create type. Only core types are supported in this language mode.').why), 'Constrained Language Mode is named');
ok(/antivirus/.test(P('launch', 'This script contains malicious content and has been blocked by your antivirus software.').why), 'an antivirus block is named');
ok(/python3/.test(P('windows', 'sh: 1: python3: not found').why), 'a missing python3 is named');
const viaEcho = P('windows', spawnSafeEcho());
ok(viaEcho.ok === false && /python3 is not installed/.test(viaEcho.why) && viaEcho.missing[0] === 'python3', "the Linux line's own no-python3 answer parses");
const noisy = P('windows', 'AutoRun banner\r\n{"some":"json"}\r\n{"ok":true,"op":"focus","os":"windows"}\r\n{"ok":true,"op":"windows","os":"windows","windows":[],"monitors":[]}\r\n');
ok(noisy.ok && Array.isArray(noisy.windows), "a banner before the answer, and another op's JSON, are skipped");
ok(!P('windows', '{"ok":true,"op":"focus","os":"windows"}').ok, "another op's answer is not taken for this one");
const cut = P('windows', '{"ok":true,"op":"windows","os":"windows","windows":[{"id":1,"tit');
ok(!cut.ok && /cut short/.test(cut.why), 'an answer cut off mid-line says so');
ok(P('windows', '{"ok":false,"op":"windows","os":"linux","wayland":true,"why":"not available on Wayland: ..."}').wayland === true, 'a not-available answer passes through with its why');
const bfs = [
  { i: 0, p: -1, d: 0, type: 50032, name: 'win' }, { i: 1, p: 0, d: 1, type: 50037, name: 'title' }, { i: 2, p: 0, d: 1, type: 50004, name: 'edit' },
  { i: 3, p: 1, d: 2, type: 50000, name: 'close' }, { i: 4, p: 2, d: 2, type: 50020, name: 'x' }, { i: 5, p: 1, d: 2, type: 50000, name: 'min' },
];
const doc = P('controls', JSON.stringify({ ok: true, op: 'controls', os: 'windows', controls: bfs })).controls;
ok(doc.map((e) => e.name).join(',') === 'win,title,close,min,edit,x', 'controls come back in document order (' + doc.map((e) => e.name).join(',') + ')');
ok(doc.map((e) => e.p).join(',') === '-1,0,1,1,0,4' && doc.every((e, i) => e.i === i), '...with i and p renumbered to match');
ok(doc.map((e) => e.type).join(',') === 'Window,TitleBar,Button,Button,Edit,Text', 'UI Automation type IDs are named');
const roles = P('controls', JSON.stringify({ ok: true, op: 'controls', os: 'linux', controls: [
  { i: 0, p: -1, d: 0, type: 'frame' }, { i: 1, p: 0, d: 1, type: 'push button' }, { i: 2, p: 0, d: 1, type: 'password text' }, { i: 3, p: 0, d: 1, type: 'tree table' }, { i: 4, p: 0, d: 1, type: 'video thing' }] })).controls;
ok(roles.map((e) => e.type).join(',') === 'Window,Button,Edit,Tree,VideoThing', 'AT-SPI roles map to the same names (' + roles.map((e) => e.type).join(',') + ')');
const pw = P('probe', '"desk-probe|Windows_NT|AMD64|admin|%SESSIONNAME%|$(uname -sm 2>/dev/null)|$(id -un 2>/dev/null)|${XDG_SESSION_TYPE}|${DISPLAY}|${WAYLAND_DISPLAY}"\r\n');
ok(pw.ok && pw.os === 'windows' && pw.shell === 'cmd' && pw.arch === 'AMD64' && pw.user === 'admin' && pw.session === '', 'probe: cmd.exe answers as Windows');
const pl = P('probe', 'desk-probe|%OS%|%PROCESSOR_ARCHITECTURE%|%USERNAME%|%SESSIONNAME%|Linux x86_64|root|x11|:0|\n');
ok(pl.ok && pl.os === 'linux' && pl.shell === 'sh' && pl.arch === 'x86_64' && pl.user === 'root' && pl.sessionType === 'x11' && pl.display === ':0' && pl.wayland === '', 'probe: sh answers as Linux');
ok(!P('probe', 'hello').ok, 'probe: anything else is not an answer');

// The Linux bootstrap's own refusal, as sh would print it (extracted from the built line, not retyped).
function spawnSafeEcho() {
  const m = /echo '([^']+)'/.exec(desk.build('windows', {}, 'linux').cmd);
  return m ? m[1] + '\n' : '';
}

// ---- every shipped script parses (no execution) -----------------------------------------------------------
if (WIN) {
  const files = [];
  for (const op of ['windows', 'focus', 'launch', 'controls']) { const f = path.join(tmp, op + '.ps1'); fs.writeFileSync(f, desk.script(op, 'windows')); files.push(f); }
  // (Everything after -Command is joined into the command text, so the file list goes inside it.)
  const list = files.map((f) => "'" + f.replace(/'/g, "''") + "'").join(',');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '@(' + list + ") | ForEach-Object { $e = $null; [void][Management.Automation.Language.Parser]::ParseFile($_, [ref]$null, [ref]$e); [IO.Path]::GetFileName($_) + ' ' + $e.Count + ' ' + ($e | Select-Object -First 1) }"], { encoding: 'utf8' });
  const lines = r.stdout.trim().split(/\r?\n/).map((l) => l.trim());
  ok(lines.length === 4 && lines.every((l) => /^\w+\.ps1 0$/.test(l)), 'every Windows script parses as PowerShell (' + lines.join(' | ') + ')');
}
const PY = (() => {
  for (const c of WIN ? [['py', '-3'], ['python3'], ['python']] : [['python3']]) {
    const r = spawnSync(c[0], c.slice(1).concat(['-c', 'import sys; print(sys.version_info[0])']), { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return c;
  }
  return null;
})();
if (PY) {
  for (const op of ['windows', 'focus', 'launch', 'controls']) {
    const f = path.join(tmp, op + '.py');
    fs.writeFileSync(f, desk.script(op, 'linux'));
    const r = spawnSync(PY[0], PY.slice(1).concat(['-c', 'import sys; compile(open(sys.argv[1]).read(), sys.argv[1], "exec")', f]), { encoding: 'utf8' });
    ok(r.status === 0, 'the Linux ' + op + ' script compiles as Python 3 ' + (r.stderr || '').trim().split('\n').pop());
  }
} else console.log('  (skip: no python3 here -- the Linux scripts were not compiled)');

// ---- the Linux AT-SPI walk, against a stand-in gi.repository.Atspi ----------------------------------------
// The stand-in has a value reader on every node that prints VALUE-READ if anything calls it, a password field
// whose NAME and value are both secrets, a child under the password field, a node that is not SHOWING, and a
// panel of 30 items for max/depth.
if (PY) {
  const tok = Math.random().toString(36).slice(2, 8);
  const stub = path.join(tmp, 'stub');
  fs.mkdirSync(path.join(stub, 'gi', 'repository'), { recursive: true });
  fs.writeFileSync(path.join(stub, 'gi', '__init__.py'), 'def require_version(name, version):\n    pass\n');
  fs.writeFileSync(path.join(stub, 'gi', 'repository', '__init__.py'), 'from . import Atspi\n');
  fs.writeFileSync(path.join(stub, 'gi', 'repository', 'Atspi.py'), [
    'TOK = ' + JSON.stringify(tok),
    'class StateType: ACTIVE, SHOWING, ENABLED, SENSITIVE, FOCUSABLE, FOCUSED = "active", "showing", "enabled", "sensitive", "focusable", "focused"',
    'class Role: PASSWORD_TEXT = "ROLE_PASSWORD"',
    'class CoordType: SCREEN = "screen"',
    'def set_timeout(a, b): pass',
    'class _Box:',
    '    def __init__(self, r): self.x, self.y, self.width, self.height = r',
    'class _States:',
    '    def __init__(self, s): self.s = set(s)',
    '    def contains(self, x): return x in self.s',
    'class Acc:',
    '    def __init__(self, name, role, states, rect=(0, 0, 0, 0), kids=(), aid="", pid=0, secret=""):',
    '        self.n, self.r, self.st, self.rc, self.k, self.aid, self.pid, self.secret = name, role, states, rect, list(kids), aid, pid, secret',
    '    def get_name(self): return self.n',
    '    def get_role_name(self): return self.r',
    '    def get_role(self): return Role.PASSWORD_TEXT if self.r == "password text" else "ROLE_OTHER"',
    '    def get_state_set(self): return _States(self.st)',
    '    def get_extents(self, c): return _Box(self.rc)',
    '    def get_accessible_id(self): return self.aid',
    '    def get_child_count(self): return len(self.k)',
    '    def get_child_at_index(self, i): return self.k[i]',
    '    def get_process_id(self): return self.pid',
    '    def _value(self, *a):',
    '        print("VALUE-READ")',
    '        return self.secret',
    '    get_text = get_value = get_current_value = get_character_count = get_text_iface = _value',
    'S = ["showing", "enabled", "sensitive", "focusable"]',
    'items = [Acc("item-%d" % i, "list item", ["showing", "enabled"], (20, 200 + i * 20, 300, 18)) for i in range(30)]',
    'frame = Acc("Stub Editor " + TOK, "frame", ["active", "showing", "enabled"], (10, 20, 800, 600), [',
    '    Acc("OK-" + TOK, "push button", S, (30, 40, 80, 24), aid="ok-btn"),',
    '    Acc("pwname-" + TOK, "password text", S + ["focused"], (30, 80, 200, 24), [Acc("pwchild-" + TOK, "label", ["showing"])], secret="S3cr3t-" + TOK),',
    '    Acc("hidden-" + TOK, "label", ["enabled"], (0, 0, 10, 10)),',
    '    Acc("", "panel", ["showing"], (0, 100, 800, 400), items)], pid=4242)',
    'other = Acc("Other " + TOK, "frame", ["showing"], (900, 20, 300, 200), [Acc("Cancel", "push button", S, (910, 40, 60, 20))])',
    'class _App(Acc): pass',
    'desktop = Acc("desktop", "desktop frame", [], kids=[Acc("app1", "application", [], kids=[frame], pid=4242), Acc("app2", "application", [], kids=[other], pid=4343)])',
    'def get_desktop(i): return desktop',
  ].join('\n') + '\n');
  const walk = (a, type) => {
    const b = desk.build('controls', a, 'linux');
    const p = partsOf(b);
    const env = Object.assign({}, process.env, { PYTHONPATH: stub, XDG_SESSION_TYPE: type || 'x11', DISPLAY: ':0', WAYLAND_DISPLAY: '' });
    const r = spawnSync(PY[0], PY.slice(1).concat(['-c', desk.PY_BOOT, p.payload, p.argsB64]), { encoding: 'utf8', env, timeout: 30000 });
    const raw = (r.stdout || '') + (r.stderr || '');
    return { raw, o: desk.parse('controls', raw) };
  };
  const w = walk({});
  const c = w.o.controls || [];
  ok(w.o.ok && w.o.os === 'linux' && w.o.window && w.o.window.title === 'Stub Editor ' + tok && w.o.window.pid === 4242, 'AT-SPI: the active window is the default target (' + (w.o.why || '') + ')');
  const btn = c.find((e) => e.name === 'OK-' + tok);
  ok(btn && btn.type === 'Button' && btn.class === 'push button' && JSON.stringify(btn.rect) === '[30,40,80,24]' && btn.aid === 'ok-btn' && btn.focusable && btn.enabled, 'AT-SPI: the button is listed with its rect, id and states');
  const pwf = c.find((e) => e.isPassword);
  ok(pwf && pwf.name === '' && pwf.type === 'Edit' && pwf.focused, 'AT-SPI: the password field is flagged, as an Edit, with no name');
  ok(!w.raw.includes('S3cr3t') && !w.raw.includes('pwname-') && !w.raw.includes('pwchild-'), "AT-SPI: the password field's value, name and children are nowhere in the output");
  ok(!w.raw.includes('VALUE-READ'), 'AT-SPI: no value reader was ever called');
  ok(!w.raw.includes('hidden-'), 'AT-SPI: what is not SHOWING is not listed');
  ok(c.length === 34 && w.o.count === 34 && !w.o.truncated, 'AT-SPI: everything showing is listed -- the window, button, password field, panel and its 30 items (' + c.length + ')');
  ok(c[0].type === 'Window' && c[0].p === -1 && c.slice(1).every((e) => e.p >= 0 && e.p < e.i), 'AT-SPI: in document order, parents first');
  const m = walk({ max: 5 }).o;
  ok(m.ok && m.count === 5 && m.truncated && m.stop === 'max', 'AT-SPI: max cuts the walk and says so');
  const d1 = walk({ depth: 1 }).o;
  ok(d1.ok && d1.controls.every((e) => e.d <= 1) && !d1.controls.some((e) => /^item-/.test(e.name)), 'AT-SPI: depth bounds the walk');
  const t = walk({ title: 'OTHER ' + tok.toUpperCase() }).o;
  ok(t.ok && t.window.title === 'Other ' + tok && t.controls.some((e) => e.name === 'Cancel'), 'AT-SPI: a title picks the window, case-insensitively');
  const miss = walk({ title: 'nothing-like-it' }).o;
  ok(!miss.ok && /no window matches/.test(miss.why) && miss.windows.length === 2, 'AT-SPI: no match says so, with the windows there are');
  const byId = walk({ id: 123 }).o;
  ok(!byId.ok && /cannot read X window/.test(byId.why), 'AT-SPI: an X id without xprop is refused in words');
  ok(walk({}, 'wayland').o.rectsRelative === true, 'AT-SPI: under Wayland the answer says the rects are window-relative');
}

// ---- LIVE, Windows only -----------------------------------------------------------------------------------
// THE SYSTEM PATH OF launch, WITHOUT BEING SYSTEM. The Windows host runs as LocalSystem, so launch starts a hidden
// PowerShell as the signed-in user (CreateProcessAsUserW) that does the Start-Process and hands back the pid as its
// exit code. Here the same DAsUser + DUserScript run with THIS account's own token, in front of a stand-in
// Start-Process that launches nothing: it checks what it was given (against base64, not against the quoting
// under test) and exits 4243 if every value arrived exactly, 4244 if not. Hidden, and gone in a second.
function asUser() {
  const b64u = (s) => Buffer.from(s, 'utf8').toString('base64');
  const app = "C:\\it's \"odd\" & 100% app.exe", argline = "-x 'q' $HOME `n \"y\"", wd = "C:\\Users\\O'Brien $x";
  const s = desk.script('launch', 'windows');
  const test = s.slice(0, s.lastIndexOf('DRun {')) + [
    "$global:DNATS += ';advapi32 OpenProcessToken B PUP;advapi32 DuplicateTokenEx B PUPIIP;kernel32 GetCurrentProcess P -'",
    'DInit',
    '[void]$API::OpenProcessToken($API::GetCurrentProcess(), 0xF01FF, $DBUF); $t = $MR::ReadIntPtr($DBUF, 0)',
    '[void]$API::DuplicateTokenEx($t, 0xF01FF, [IntPtr]::Zero, 2, 1, $DBUF); $tok = $MR::ReadIntPtr($DBUF, 0)',
    "$u = { param($b) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) }",
    "$fake = 'function Start-Process { param($FilePath, [switch]$PassThru, $WorkingDirectory, $ArgumentList); $u = { param($b) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) };" +
      " if ($PassThru -and $FilePath -ceq (& $u ''" + b64u(app) + "'') -and $ArgumentList -ceq (& $u ''" + b64u(argline) + "'') -and $WorkingDirectory -ceq (& $u ''" + b64u(wd) + "'')) { exit 4243 }; exit 4244 };'",
    "[Console]::Out.Write('code=' + (DAsUser $tok ($fake + (DUserScript (& $u '" + b64u(app) + "') (& $u '" + b64u(argline) + "') (& $u '" + b64u(wd) + "')))))",
  ].join('\n');
  const f = path.join(tmp, 'asuser.ps1');
  fs.writeFileSync(f, test);
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  ok(/code=4243/.test(r.stdout), "live launch (as the user): CreateProcessAsUserW starts the user-side script, which hands Start-Process every value exactly and its exit code back (" + (r.stdout + r.stderr).trim().slice(0, 200) + ')');
}

function runCmd(cmd) {
  const r = spawnSync('cmd.exe', ['/c', cmd], { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  return { raw: (r.stdout || '') + (r.stderr || ''), code: r.status };
}
// A private test window: never activated (ShowWithoutActivation), sent to the BOTTOM of the Z order, no taskbar
// button, no "(Not Responding)" ghost (DisableProcessWindowsGhosting), and closed by its own timer if the test dies
// first. hangAfter: its UI thread then sleeps for 30 s -- an app that has stopped answering.
function startForm(tok, secret, plain, hangAfter) {
  const form = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    "Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'",
    'using System; using System.Runtime.InteropServices; using System.Windows.Forms;',
    'public class DeskTestForm : Form {',
    '  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);',
    '  [DllImport("user32.dll")] public static extern void DisableProcessWindowsGhosting();',
    '  protected override bool ShowWithoutActivation { get { return true; } }',
    '  protected override void OnShown(EventArgs e) {',
    '    base.OnShown(e);',
    '    SetWindowPos(Handle, new IntPtr(1), 0, 0, 0, 0, 0x0013);',
    '    Console.Out.WriteLine("READY " + Handle.ToInt64()); Console.Out.Flush();',
    '  }',
    '}',
    "'@",
    '[DeskTestForm]::DisableProcessWindowsGhosting()',
    '[Windows.Forms.Application]::EnableVisualStyles()',
    '$f = New-Object DeskTestForm',
    "$f.Text = 'desk-test " + tok + "'; $f.ShowInTaskbar = $false; $f.StartPosition = 'Manual'",
    '$f.Location = New-Object Drawing.Point(40, 40); $f.Size = New-Object Drawing.Size(460, 240)',
    "$b = New-Object Windows.Forms.Button; $b.Text = 'OK-" + tok + "'; $b.Location = New-Object Drawing.Point(20, 20); $b.Size = New-Object Drawing.Size(140, 32); $f.Controls.Add($b)",
    "$t = New-Object Windows.Forms.TextBox; $t.Text = '" + plain + "'; $t.Location = New-Object Drawing.Point(20, 70); $t.Size = New-Object Drawing.Size(200, 24); $f.Controls.Add($t)",
    "$p = New-Object Windows.Forms.TextBox; $p.UseSystemPasswordChar = $true; $p.Text = '" + secret + "'; $p.Location = New-Object Drawing.Point(20, 110); $p.Size = New-Object Drawing.Size(200, 24); $f.Controls.Add($p)",
    '$k = New-Object Windows.Forms.Timer; $k.Interval = 120000; $k.add_Tick({ $f.Close() }); $k.Start()',
    hangAfter ? '$z = New-Object Windows.Forms.Timer; $z.Interval = ' + hangAfter + '; $z.add_Tick({ $z.Stop(); [Threading.Thread]::Sleep(30000) }); $z.Start()' : '',
    '[Windows.Forms.Application]::Run($f)',
  ].join('\n');
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(form, 'utf16le').toString('base64')], { windowsHide: true });
  let out = '', err = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { err += b; });
  const exited = new Promise((res) => child.on('exit', res));
  const ready = new Promise((res) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      const m = /READY (\d+)/.exec(out);
      if (m || Date.now() - t0 > 45000 || child.exitCode != null) { clearInterval(tick); res(m ? { hwnd: Number(m[1]), at: Date.now() } : { hwnd: 0, why: (err || out).slice(0, 300) }); }
    }, 50);
  });
  const stop = async () => {
    child.kill();
    await Promise.race([exited, new Promise((res) => setTimeout(res, 5000))]);
    return child.exitCode != null || child.signalCode != null;
  };
  return { child, ready, stop };
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function live() {
  if (!WIN) { console.log('  (skip live: not Windows)'); return; }
  if (process.env.AGENT_DRIVE_LIVE === '0') { console.log('  (skip live: AGENT_DRIVE_LIVE=0 -- CI has no desktop to open a window on)'); return; }
  const probe = desk.parse('probe', runCmd(desk.build('probe').cmd).raw);
  ok(probe.ok && probe.os === 'windows' && probe.shell === 'cmd', 'live: the probe through cmd.exe says Windows');

  const tok = 'dk' + Math.random().toString(36).slice(2, 9);
  const secret = 'S3cr3t-' + tok, plain = 'plain-' + tok;
  const form = startForm(tok, secret, plain, 0), child = form.child;
  try {
    const up = await form.ready, hwnd = up.hwnd;
    ok(hwnd > 0, 'live: the private test window is up' + (hwnd ? '' : ' -- ' + up.why));
    if (!hwnd) return;

    // windows: it is listed, with a rectangle, as the child's
    let r = runCmd(desk.build('windows', {}, 'windows').cmd);
    const ws = desk.parse('windows', r.raw);
    ok(ws.ok && r.code === 0 && r.raw.trim().split(/\r?\n/).length === 1, 'live windows: one line of JSON, exit 0 (' + (ws.why || '') + ')');
    const me = (ws.windows || []).find((w) => w.id === hwnd);
    ok(me && me.title === 'desk-test ' + tok && me.pid === child.pid && me.process === 'powershell', 'live windows: the test window is listed by its HWND, title and process');
    ok(me && Array.isArray(me.rect) && me.rect[2] > 100 && me.rect[3] > 100 && !me.minimized, 'live windows: ...with a rectangle (' + JSON.stringify(me && me.rect) + ')');
    ok(ws.monitors && ws.monitors.length >= 1 && ws.monitors.filter((m) => m.primary).length === 1 && ws.monitors.every((m) => m.rect.length === 4), 'live windows: the monitors, one of them primary');
    ok(ws.awareness === 'per-monitor', 'live windows: per-monitor DPI-aware, so the rectangles are physical pixels (' + ws.awareness + ')');
    if (me && ws.monitors && ws.monitors.every((m) => m.dpi === 96)) {
      ok(Math.abs(me.rect[0] - 47) <= 12 && Math.abs(me.rect[1] - 40) <= 12 && Math.abs(me.rect[2] - 446) <= 20 && Math.abs(me.rect[3] - 233) <= 20, 'live windows: at 100% the visible frame is where the form put it (' + me.rect + ')');
    }
    ok(ws.windows.every((w) => typeof w.id === 'number' && typeof w.title === 'string' && w.title && 'foreground' in w && 'owner' in w), 'live windows: every entry has the documented fields');

    // controls: the button with its rect, the password box flagged, the secret and the text box's text nowhere
    r = runCmd(desk.build('controls', { title: tok }, 'windows').cmd);
    const cs = desk.parse('controls', r.raw);
    ok(cs.ok && r.raw.trim().split(/\r?\n/).length === 1, 'live controls: one line of JSON (' + (cs.why || '') + ')');
    ok(cs.window && cs.window.id === hwnd && cs.matches === 1, 'live controls: the window found by its title');
    const btn = (cs.controls || []).find((e) => e.name === 'OK-' + tok);
    ok(btn && btn.type === 'Button' && Array.isArray(btn.rect) && btn.rect[2] > 0 && btn.rect[3] > 0, 'live controls: the button is listed with a rect (' + JSON.stringify(btn) + ')');
    ok(btn && me && btn.rect[0] >= me.rect[0] - 10 && btn.rect[1] >= me.rect[1] && btn.rect[0] + btn.rect[2] <= me.rect[0] + me.rect[2] + 10, 'live controls: ...inside the window, in the same screen pixels');
    const pws = (cs.controls || []).filter((e) => e.isPassword);
    ok(pws.length === 1 && pws[0].type === 'Edit' && pws[0].name === '' && Array.isArray(pws[0].rect), 'live controls: the password box is flagged isPassword, with no name');
    ok(!r.raw.includes(secret) && !r.raw.includes('S3cr3t'), 'live controls: the SECRET appears nowhere in the output');
    ok(!r.raw.includes(plain), "live controls: nor does the plain text box's text -- names only, never values");
    ok((cs.controls || []).filter((e) => e.type === 'Edit').length === 2, 'live controls: both text boxes are listed as Edit');
    ok(cs.controls && cs.controls.every((e) => ['i', 'p', 'd', 'name', 'type', 'aid', 'class', 'rect', 'enabled', 'focusable', 'focused', 'isPassword'].every((k) => k in e)), 'live controls: every element has the documented fields');
    const cut2 = desk.parse('controls', runCmd(desk.build('controls', { id: hwnd, max: 2 }, 'windows').cmd).raw);
    ok(cut2.ok && cut2.count === 2 && cut2.truncated === true && cut2.stop === 'max' && cut2.window.id === hwnd, 'live controls: by id, and max cuts it with truncated/stop');

    // focus and launch: their construction and their lookups, dry -- never for real
    const fd = desk.parse('focus', runCmd(desk.build('focus', { title: tok, dry: true }, 'windows').cmd).raw);
    ok(fd.ok && fd.dry === true && fd.window && fd.window.id === hwnd && fd.matches === 1, 'live focus (dry): finds the test window by part of its title, and changes nothing');
    const fn = desk.parse('focus', runCmd(desk.build('focus', { title: 'no-such-window-' + tok }, 'windows').cmd).raw);
    ok(!fn.ok && /no visible window's title contains/.test(fn.why) && Array.isArray(fn.windows), 'live focus: no match is refused with the titles there are');
    const ld = desk.parse('launch', runCmd(desk.build('launch', { app: 'notepad', args: ['C:\\a b\\c.txt', 'x"y'], dry: true }, 'windows').cmd).raw);
    ok(ld.ok && ld.dry && ld.started.file === 'notepad' && ld.started.arguments === '"C:\\a b\\c.txt" "x\\"y"' && ld.started.cwd && ld.started.as === 'this account', 'live launch (dry): resolves the file, the quoted arguments, the working folder and as whom');
    asUser();
  } finally {
    ok(await form.stop(), 'live: the test window and its process are gone');
  }
  await hung();
}

// AN APP THAT STOPS ANSWERING. Its window's UI thread sleeps 1.2 s after it shows. Read while it has been stuck
// for under the 5 s after which Windows calls it "not responding", every UI Automation call into it blocks -- and
// the host would end the exec at 10 s with NOTHING returned. controls must come back by itself, in words, inside
// its budget (its walker is left blocked on a background thread, and the process exits around it). Read again
// once Windows calls it hung, it is refused before any UI Automation at all.
async function hung() {
  const tok = 'dh' + Math.random().toString(36).slice(2, 9);
  const form = startForm(tok, 'S3cr3t-' + tok, 'plain-' + tok, 1200);
  try {
    const up = await form.ready;
    ok(up.hwnd > 0, 'live hung: the second test window is up' + (up.hwnd ? '' : ' -- ' + up.why));
    if (!up.hwnd) return;
    await sleep(Math.max(0, up.at + 1700 - Date.now()));
    const t0 = Date.now();
    const r = runCmd(desk.build('controls', { id: up.hwnd, budget: 2500 }, 'windows').cmd);
    const ms = Date.now() - t0, a = desk.parse('controls', r.raw);
    ok(!a.ok && /did not answer UI Automation|UI Automation:|not responding/.test(a.why || '') && a.window && a.window.id === up.hwnd,
       'live hung: controls on a window that stopped answering fails in words (' + (a.why || JSON.stringify(a).slice(0, 120)) + ')');
    ok(ms < 6500, 'live hung: ...and comes back inside its budget, not at the host\'s 10 s kill (' + ms + ' ms)');
    await sleep(Math.max(0, up.at + 1200 + 6000 - Date.now()));
    const b = desk.parse('controls', runCmd(desk.build('controls', { id: up.hwnd }, 'windows').cmd).raw);
    ok(!b.ok && /not responding/.test(b.why || ''), 'live hung: once Windows calls it hung, it is refused before any UI Automation (' + b.why + ')');
  } finally {
    ok(await form.stop(), 'live hung: the hung test window and its process are gone');
  }
}

live().then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log((fail ? 'FAIL' : 'ok') + ' desk: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
}, (e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });

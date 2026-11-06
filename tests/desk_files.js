// desk_files.js -- core/desk.js's file, camera and audio ops: stat, read, write, rm, camera, audio (the serve's
// fetch / send / camera / audio verbs are built on them). Offline, everywhere: every build fits its line on both
// systems and carries nothing a shell could read; writeChunk is exact (a chunk of exactly that size fits, one group
// of 4 more is refused); the args are checked; parse() takes answers, says every failure code in words, refuses a
// damaged chunk and garbage; every script parses.
// REAL, where the machine can run it:
//   Windows -- through `cmd.exe /c <line>` exactly as the host runs it, in a temp folder whose name has spaces,
//     quotes, % & ! ^ [ ] and non-ASCII (accents, CJK, an emoji): files of 0 and 1 bytes, every byte value, sizes on
//     and just past the chunk boundaries, written in chunks, stat'ed, read back in chunks and compared byte for byte;
//     a resent chunk lands once, a missing one is refused; a missing file, a folder, no permission (a deny ACE), a
//     read-only file, a file another program holds open; rm refusing what is not a capture's; a full-size read stays
//     inside the host's 512 KB. The camera is LISTED (dry) and asked for one it does not have -- a photo is taken only
//     when this machine has no camera (then it must fail in words) or DESK_CAMERA=1 says to. The audio recorder is
//     compiled and its sample conversion fed known bytes; its loopback stream is opened (dry); and unless
//     AGENT_DRIVE_LIVE=0 it records 1 s of what this machine is playing -- read back as a WAV, checked for its
//     header and length only (never listened to), and removed.
//   Linux -- the same round trips through /bin/sh -c (Linux, or WSL from Windows with DESK_WSL=1 or =<distro>);
//     camera and audio against stand-in fswebcam / ffmpeg / pactl / parec on the PATH, and with none of them. On
//     Windows without WSL the Linux FILE scripts still run for real, straight under this machine's Python.
//   node tests/desk_files.js            (DESK_VERBOSE=1 prints every check)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const desk = require(path.join(__dirname, '..', 'core', 'desk.js'));

let pass = 0, fail = 0;
const VERBOSE = !!process.env.DESK_VERBOSE;
const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('  ok: ' + m); } else { fail++; console.error('  FAIL: ' + m); } };
const WIN = process.platform === 'win32';
const LIVE = process.env.AGENT_DRIVE_LIVE !== '0';
// realpath.native: a temp folder given in its short 8.3 form (GitHub's Windows runners: C:\Users\RUNNER~1\...) is
// worked in under its long name, which is the `full` path the scripts report
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-files-')));
const b64d = (s) => Buffer.from(s, 'base64');
const OPS = ['stat', 'read', 'write', 'rm', 'camera', 'audio'];
const SYSS = ['windows', 'linux'];
const CAP = 'agent-drive-cam-0123456789abcdef.jpg';
const sample = { stat: { path: 'C:\\x\\y.txt' }, read: { path: '/x/y.bin' }, write: { path: '/x/y.bin', b64: 'AAEC' }, rm: { path: '/tmp/' + CAP }, camera: {}, audio: {} };
// Every byte value, in a pattern that does not repeat on a 3- or 4-byte period (base64 groups) -- n bytes of it.
const bytes = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 167 + (seed || 0) + (i >> 8)) & 255; return b; };

// The halves of a built line: the args, the packed script and (a write) the data.
function partsOf(b) {
  if (b.os === 'windows') {
    const a = /\$DA='([A-Za-z0-9+/=]*)'/.exec(b.cmd), d = /\$DB='([A-Za-z0-9+/=]*)'/.exec(b.cmd), s = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(b.cmd);
    return a && s ? { args: JSON.parse(b64d(a[1]).toString('utf8')), script: zlib.gunzipSync(b64d(s[1])).toString('utf8'), data: d ? d[1] : null } : null;
  }
  const m = / ([A-Za-z0-9+/=]+) ([A-Za-z0-9+/=]+)(?: ([A-Za-z0-9+/=]+|''))?$/.exec(b.cmd);
  return m ? { args: JSON.parse(b64d(m[2]).toString('utf8')), script: zlib.gunzipSync(b64d(m[1])).toString('utf8'), data: m[3] == null ? null : m[3] === "''" ? '' : m[3], payload: m[1], argsB64: m[2] } : null;
}

// ---- build: every op, both systems, under its limit, one line, nothing a shell could read ------------------
for (const sys of SYSS) {
  for (const op of OPS) {
    const b = desk.build(op, sample[op], sys);
    ok(b.ok && b.cmd.length === b.len, sys + ' ' + op + ' builds (' + (b.why || b.len) + ')');
    if (!b.ok) continue;
    ok(b.len < desk.LIMIT && !/[\r\n]/.test(b.cmd), sys + ' ' + op + ': one line, under ' + desk.LIMIT + ' (' + b.len + ')');
    const p = partsOf(b);
    ok(p && p.script === desk.script(op, sys) && p.args.op === op, sys + ' ' + op + ': the payload unpacks to the assembled script, the args carry the op');
    ok(p && (op === 'write' ? p.data === 'AAEC' && !('b64' in p.args) : p.data === null), sys + ' ' + op + ': a write\'s chunk rides beside the args, once-encoded; nothing else carries one');
    if (sys === 'windows') ok((b.cmd.match(/"/g) || []).length === 2 && !/[%!^&|<>]/.test(b.cmd), 'windows ' + op + ": one quoted argument, none of cmd.exe's special characters");
    else ok(b.cmd.includes("exec python3 -c '" + desk.PY_BOOT + "' "), 'linux ' + op + ': the python bootstrap');
  }
}
for (const op of OPS) {
  const s = desk.script(op, 'windows');
  ok(!/\bDInit\b|\$global:DNATS/.test(s) && /function DRun/.test(s), 'windows ' + op + ': ships the lean head, not the native calls');
  ok(!/^function DMonitors|^function DTopWins/m.test(s), 'windows ' + op + ': nothing of the window ops');
}
ok(/^\$ErrorActionPreference/.test(desk.script('audio', 'windows')) && desk.script('audio', 'windows').indexOf('$DESKLOOP=@') < desk.script('audio', 'windows').indexOf('DRun {'),
   'windows audio: the C# sits just before audio.ps1, not at the top (measured: 3x slower to start there -- AMSI)');
ok(desk.script('controls', 'windows').startsWith("$DESKUIA=@'"), 'windows controls: its C# still leads, where it has always run from');
ok(desk.script('audio', 'linux').includes(desk.PY_BOOT) && !desk.script('stat', 'linux').includes('def session('), 'linux: audio ships the session finder (common.py), the file ops the lean head');

// The biggest args each op takes still fit.
const longCjk = '\u4e2d'.repeat(1024 - 40), capPath = (sys) => (sys === 'windows' ? 'C:\\' : '/') + longCjk + (sys === 'windows' ? '\\' : '/') + CAP;
for (const sys of SYSS) {
  for (const [op, a] of [['stat', { path: '\u4e2d'.repeat(1024) }], ['read', { path: '\u4e2d'.repeat(1024), off: Number.MAX_SAFE_INTEGER, n: 1 }], ['rm', { path: capPath(sys) }],
    ['camera', { device: '\u4e2d'.repeat(200), dry: true }], ['audio', { seconds: desk.AUDIO_MAX, dry: true }]]) {
    const b = desk.build(op, a, sys);
    ok(b.ok && b.len < desk.LIMIT, sys + ' ' + op + ' with its longest args fits (' + (b.len || b.why) + ')');
  }
}

// ---- writeChunk: exactly what one write can carry --------------------------------------------------------
const paths = { short: 'C:\\Users\\someone\\Desktop\\report.pdf', posix: '/home/someone/Desktop/report.pdf', ascii1024: 'p'.repeat(1024), cjk260: '\u4e2d'.repeat(260), cjk1024: '\u4e2d'.repeat(1024), mixed: "C:\\a b\\'q' \u00e9 \ud83d\ude42\\f.bin" };
for (const sys of SYSS) {
  const lim = desk.WRITE_LIMIT[sys];
  for (const [name, p] of Object.entries(paths)) {
    const w = desk.writeChunk(sys, p);
    ok(w > 0 && w % 4 === 0, sys + ' writeChunk(' + name + ') is a positive multiple of 4 (' + w + ')');
    const at = Number.MAX_SAFE_INTEGER;
    const full = desk.build('write', { path: p, b64: 'A'.repeat(w), append: true, at }, sys);
    ok(full.ok && full.len < lim && full.len >= lim - 4, sys + ' write to ' + name + ': a chunk of exactly writeChunk fits, within 4 of the limit (' + (full.len || full.why) + ' of ' + lim + ')');
    const over = desk.build('write', { path: p, b64: 'A'.repeat(w + 4), append: true, at }, sys);
    ok(!over.ok && /writeChunk\(os, path\): \d+ characters/.test(over.why), sys + ' write to ' + name + ': 4 more is refused, naming the right size (' + (over.why || 'built') + ')');
  }
  const dflt = desk.writeChunk(sys);
  ok(dflt === desk.writeChunk(sys, paths.cjk260) && dflt <= desk.writeChunk(sys, paths.short), sys + ': writeChunk(os) is the figure for the worst 260-character path (' + dflt + ')');
  console.log('  ' + sys.padEnd(8) + 'writeChunk: ' + desk.writeChunk(sys, paths.short) + ' (a short path), ' + dflt + ' (any path up to 260 characters), ' + desk.writeChunk(sys, paths.cjk1024) + ' (1024 CJK characters)');
}
ok(desk.writeChunk('linux', paths.posix) > 100000 && desk.writeChunk('windows', paths.short) > 5000, 'Linux carries ~120 KB a write, Windows ~6 KB');
ok(desk.writeChunk('macos') === 0, 'writeChunk of an unknown os is 0');

// ---- the args are checked before anything is built --------------------------------------------------------
const no = (op, a, re, m, sys) => { const b = desk.build(op, a, sys || 'windows'); ok(!b.ok && re.test(b.why || ''), m + ' (' + (b.why || 'built') + ')'); };
no('stat', {}, /needs `path`/, 'stat without a path is refused');
no('read', { path: '' }, /needs `path`/, 'an empty path is refused');
no('write', { path: 'a\nb', b64: '' }, /control characters/, 'a path with a control character is refused');
no('stat', { path: 'x'.repeat(1025) }, /at most 1024/, 'a path over 1024 characters is refused');
no('write', { path: 'x' }, /needs `b64`/, 'write without b64 is refused');
no('write', { path: 'x', b64: 'AAA' }, /whole groups of 4/, 'base64 not in whole groups of 4 is refused');
no('write', { path: 'x', b64: 'AA$A' }, /needs `b64`/, 'base64 with a foreign character is refused');
no('write', { path: 'x', b64: 'AAAA', at: 4 }, /at goes with append/, 'at without append is refused');
no('write', { path: 'x', b64: 'AAAA', append: true, at: -1 }, /byte offset/, 'a negative at is refused');
no('read', { path: 'x', off: 'abc' }, /byte offset/, 'an off that is not a number is refused');
no('read', { path: 'x', off: 1.5 }, /byte offset/, 'a fractional off is refused');
no('rm', { path: 'C:\\Users\\someone\\Documents\\thesis.docx' }, /only the temp file a capture made/, 'rm of an ordinary file is refused before anything is sent');
no('rm', { path: '/tmp/agent-drive-cam-0123456789abcdef.wav' }, /only the temp file/, 'rm of a capture name with the wrong extension is refused');
no('rm', { path: '/tmp/agent-drive-cam-0123456789ABCDEF.jpg' }, /only the temp file/, 'rm of a capture name in the wrong case is refused');
no('camera', { device: 'x'.repeat(201) }, /part of a camera/, 'an over-long camera name is refused');
no('write', { path: 'x', b64: '' }, /os must be/, 'an unknown os is refused', 'macos');
for (const [p, sys] of [['C:\\Windows\\Temp\\' + CAP, 'windows'], ['C:/Windows/Temp/' + CAP, 'windows'], ['/tmp/agent-drive-rec-fedcba9876543210.wav', 'linux']]) {
  ok(desk.build('rm', { path: p }, sys).ok, 'rm of a capture\'s own name builds (' + p + ')');
}
const A = (op, a, sys) => partsOf(desk.build(op, a, sys || 'windows')).args;
ok(A('read', { path: 'x' }).off === 0 && A('read', { path: 'x' }).n === desk.READ_N && desk.READ_N === 256 * 1024, 'read defaults: from 0, 256 KB');
ok(A('read', { path: 'x', n: 1e9 }).n === desk.READ_MAX && A('read', { path: 'x', n: 0 }).n === 1 && A('read', { path: 'x', off: '42' }).off === 42, 'read: n is held to 1..READ_MAX, a numeric string off is taken');
ok(Math.ceil(desk.READ_MAX / 3) * 4 + 8192 < 512 * 1024, 'a full-size read is ' + Math.ceil(desk.READ_MAX / 3) * 4 + ' characters of base64: inside the host\'s 512 KB with room for the JSON');
const wa = A('write', { path: 'x', b64: '', append: 1, at: '9' });
ok(wa.append === true && wa.at === 9 && !('b64' in wa), 'write: append is a boolean, at a number, and the data is not in the args');
ok(!('at' in A('write', { path: 'x', b64: '', at: 0 })) && A('write', { path: 'x', b64: '' }).append === false, 'write: at 0 on a first chunk is accepted and dropped');
ok(A('audio', {}).seconds === 5 && A('audio', { seconds: 99 }).seconds === desk.AUDIO_MAX && A('audio', { seconds: 0.2 }).seconds === 1 && A('audio', { seconds: 'x' }).seconds === 5 && desk.AUDIO_MAX === 7, 'audio: 5 s unless asked, held to 1..7');
ok(A('camera', { dry: 1, device: 'HD' }).dry === true && A('camera', {}).dry === undefined && A('camera', { device: 'HD' }).device === 'HD', 'camera: dry and device pass, nothing else');

// What a person typed is never on the line as text.
const nasty = 'C:\\Tom & Jerry "100%" ^caret! <tag> | pipe \'single\' $(rm -rf ~) `tick` %PATH% \u4e2d\u6587 \ud83d\ude42\\f.txt';
for (const sys of SYSS) {
  for (const op of ['stat', 'read', 'write']) {
    const b = desk.build(op, { path: nasty, b64: '' }, sys);
    ok(b.ok && partsOf(b).args.path === nasty && !b.cmd.includes('Jerry') && !b.cmd.includes('%PATH%') && !b.cmd.includes('rm -rf'), sys + ' ' + op + ': a path with & " % ^ ! < > | \' $( ` and non-ASCII round-trips exactly, and is nowhere on the line as text');
  }
}

// ---- parse: answers, failure codes said in words, damaged chunks, garbage --------------------------------
const P = desk.parse;
const j = (o) => JSON.stringify(o) + '\n';
const rd = P('read', 'banner\r\n' + j({ ok: true, op: 'read', os: 'windows', total: 5, off: 0, n: 5, full: 'C:\\f', b64: Buffer.from('hello').toString('base64') }));
ok(rd.ok && rd.n === 5 && b64d(rd.b64).toString() === 'hello', 'read: a good chunk is taken, behind a banner');
const dmg = P('read', j({ ok: true, op: 'read', os: 'linux', total: 9, off: 0, n: 6, full: '/f', b64: Buffer.from('hello').toString('base64') }));
ok(!dmg.ok && /damaged/.test(dmg.why) && dmg.full === '/f', 'read: base64 that does not hold n bytes is refused (' + dmg.why + ')');
ok(!P('read', j({ ok: true, op: 'read', os: 'linux', total: 3, off: 0, n: 3, b64: 'AA$A' })).ok, 'read: base64 with a foreign character is refused');
ok(!P('read', j({ ok: true, op: 'read', os: 'linux', total: 3, off: 0, n: 3 })).ok, 'read: an ok answer without b64 is refused');
const cutr = P('read', '{"ok":true,"op":"read","os":"windows","total":999999,"off":0,"n":368640,"full":"C:\\\\f","b64":"AAAA');
ok(!cutr.ok && /cut short/.test(cutr.why), 'read: an answer the host cut at its 512 KB says so');
ok(P('read', j({ ok: true, op: 'read', os: 'windows', total: 0, off: 0, n: 0, full: 'C:\\e', b64: '' })).ok, 'read: an empty chunk is a good chunk');
ok(!P('stat', j({ ok: true, op: 'read', os: 'windows', total: 0, off: 0, n: 0, b64: '' })).ok, "another op's answer is not taken for this one");
ok(!P('write', '').ok && /no output/.test(P('write', '  ').why) && /no answer/.test(P('rm', 'garbage \x00\x01').why), 'no output and garbage are failures that say so');
ok(/antivirus/.test(P('write', 'This script contains malicious content and has been blocked by your antivirus software.').why), 'an antivirus block is named');
ok(/python3 is not installed/.test(P('stat', /echo '([^']+)'/.exec(desk.build('stat', { path: 'x' }, 'linux').cmd)[1]).why), "the Linux line's own no-python3 answer parses");
const why = (o) => P(o.op || 'read', j(Object.assign({ ok: false, op: 'read', os: 'windows' }, o))).why || '';
const W = 'C:\\data\\f.bin', L = '/home/me/f.bin';
const words = [
  [{ err: 'nofile', verb: 'read', full: W }, /^no such file: C:\\data\\f\.bin$/],
  [{ err: 'nodir', verb: 'write', full: W, op: 'write' }, /^no such folder: C:\\data$/],
  [{ err: 'nodir', verb: 'write', full: L, op: 'write', os: 'linux' }, /^no such folder: \/home\/me$/],
  [{ err: 'denied', verb: 'read', full: W }, /^no permission to read C:/],
  [{ err: 'readonly', verb: 'write', full: W, op: 'write' }, /read-only/],
  [{ err: 'isdir', verb: 'read', full: W }, /is a folder, not a file/],
  [{ err: 'isdir', verb: 'write', full: W, op: 'write' }, /write needs the path of a file/],
  [{ err: 'notdir', verb: 'read', full: L, os: 'linux' }, /not a folder/],
  [{ err: 'inuse', verb: 'read', full: W }, /open in another program that does not let others read it/],
  [{ err: 'diskfull', verb: 'write', full: W, op: 'write' }, /disk is full/],
  [{ err: 'rofs', verb: 'write', full: L, op: 'write', os: 'linux' }, /read-only/],
  [{ err: 'toolong', verb: 'read', full: W }, /too long/],
  [{ err: 'badpath', verb: 'look at', full: 'C:\\a:b', msg: 'The given path\'s format is not supported.', op: 'stat' }, /not a usable path: C:\\a:b \(The given path/],
  [{ err: 'special', verb: 'read', full: '/dev/zero', os: 'linux' }, /not a regular file/],
  [{ err: 'noappend', verb: 'write', full: W, op: 'write' }, /nothing to add to: .* does not exist/],
  [{ err: 'gap', verb: 'write', full: W, size: 10, at: 20, op: 'write' }, /is 10 bytes, but this chunk starts at 20 -- a chunk before it is missing/],
  [{ err: 'notmine', verb: 'remove', full: W, temp: 'C:\\T\\', op: 'rm' }, /not a file a capture made: .* in C:\\T\\$/],
  [{ err: 'other', verb: 'read', full: W, msg: 'The device is not ready.' }, /^could not read C:\\data\\f\.bin: The device is not ready\.$/],
  [{ err: 'something-new', verb: 'read', full: W, msg: 'x' }, /^could not read C:\\data\\f\.bin: x$/],
  [{ err: 'toString', verb: 'read', full: W }, /^could not read/],
];
for (const [o, re] of words) ok(re.test(why(o)), 'parse says err "' + o.err + '" in words: ' + why(o));
ok(why({ err: 'nofile', verb: 'read', full: W, why: 'own words' }) === 'own words', "a script's own why is kept");

// ---- every shipped script parses ---------------------------------------------------------------------------
if (WIN) {
  const files = OPS.map((op) => { const f = path.join(tmp, op + '.ps1'); fs.writeFileSync(f, desk.script(op, 'windows')); return f; });
  const list = files.map((f) => "'" + f.replace(/'/g, "''") + "'").join(',');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '@(' + list + ") | ForEach-Object { $e = $null; [void][Management.Automation.Language.Parser]::ParseFile($_, [ref]$null, [ref]$e); [IO.Path]::GetFileName($_) + ' ' + $e.Count + ' ' + ($e | Select-Object -First 1) }"], { encoding: 'utf8' });
  const lines = r.stdout.trim().split(/\r?\n/).map((l) => l.trim());
  ok(lines.length === OPS.length && lines.every((l) => /^\w+\.ps1 0$/.test(l)), 'every Windows script parses as PowerShell (' + lines.join(' | ') + ')');
}
const PY = (() => {
  for (const c of WIN ? [['py', '-3'], ['python3'], ['python']] : [['python3']]) {
    const r = spawnSync(c[0], c.slice(1).concat(['-c', 'import sys; print(sys.version_info[0])']), { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return c;
  }
  return null;
})();
if (PY) {
  for (const op of OPS) {
    const f = path.join(tmp, op + '.py');
    fs.writeFileSync(f, desk.script(op, 'linux'));
    const r = spawnSync(PY[0], PY.slice(1).concat(['-c', 'import sys; compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")', f]), { encoding: 'utf8' });
    ok(r.status === 0, 'the Linux ' + op + ' script compiles as Python 3 ' + (r.stderr || '').trim().split('\n').pop());
  }
} else console.log('  (skip: no python3 here -- the Linux scripts were not compiled)');

// ---- REAL: running the lines ------------------------------------------------------------------------------
// A command line run the way a host runs it, answered as {raw, code}. Async, so independent files go in parallel.
function spawnRaw(file, argv, opts) {
  return new Promise((res) => {
    const c = spawn(file, argv, Object.assign({ windowsHide: true }, opts || {}));
    const out = [];
    c.stdout.on('data', (b) => out.push(b));
    c.stderr.on('data', (b) => out.push(b));
    const t = setTimeout(() => c.kill(), 60000);
    c.on('close', (code) => { clearTimeout(t); res({ raw: Buffer.concat(out).toString('utf8'), code }); });
    c.on('error', (e) => { clearTimeout(t); res({ raw: String(e), code: -1 }); });
  });
}
const winRun = (cmd) => spawnRaw('cmd.exe', ['/c', cmd], { windowsVerbatimArguments: true });

// THE LINUX SIDE, three ways: /bin/sh -c on a POSIX machine; through WSL from Windows (DESK_WSL=1, or a distro name);
// or, for the file ops only, the same scripts straight under this machine's Python (no shell in between).
const WSL = WIN && process.env.DESK_WSL ? String(process.env.DESK_WSL) : '';
const LIN = !WIN ? 'sh' : WSL ? 'wsl' : PY ? 'python' : '';
const toLin = (p) => (LIN === 'wsl' ? '/mnt/' + p[0].toLowerCase() + p.slice(2).replace(/\\/g, '/') : p);
let linSeq = 0;
function linRun(cmd, env) {
  if (LIN === 'sh') return spawnRaw('/bin/sh', ['-c', cmd], { env: Object.assign({}, process.env, env || {}) });
  if (LIN === 'wsl') {
    const f = path.join(tmp, 'lin-' + (linSeq++) + '.sh');
    fs.writeFileSync(f, cmd);
    const pre = Object.entries(env || {}).map(([k, v]) => k + '=' + v);
    return spawnRaw('wsl.exe', (WSL === '1' ? [] : ['-d', WSL]).concat(['-e', '/bin/sh', '-c', 'f="$1"; shift; exec env "$@" /bin/sh -c "$(cat "$f")"', 'sh', toLin(f)], pre));
  }
  // Windows' own command line holds 32,767 characters and a Linux write carries ~118,000: the arguments go in a
  // file, and a two-line shim hands them to PY_BOOT as the same sys.argv.
  const m = / ([A-Za-z0-9+/=]+) ([A-Za-z0-9+/=]+)(?: ([A-Za-z0-9+/=]+|''))?$/.exec(cmd);
  const f = path.join(tmp, 'argv-' + (linSeq++) + '.txt');
  fs.writeFileSync(f, [m[1], m[2]].concat(m[3] == null ? [] : [m[3] === "''" ? '' : m[3]]).join('\n'));
  return spawnRaw(PY[0], PY.slice(1).concat(['-c', 'import sys\nsys.argv = ["-c"] + open(sys.argv[1]).read().split("\\n")\n' + desk.PY_BOOT, f]));
}
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// One op on a system: build, run, parse.
async function op(sys, name, args, env) {
  const b = desk.build(name, args, sys);
  if (!b.ok) return { ok: false, why: 'build: ' + b.why, raw: '' };
  const r = sys === 'windows' ? await winRun(b.cmd) : await linRun(b.cmd, env);
  return Object.assign(desk.parse(name, r.raw), { rawLen: r.raw.length, code: r.code });
}
// A whole file sent the way the integrator will: its base64 cut at multiples of writeChunk(os, path); each chunk
// after the first appended `at` where it starts. Then read back from 0 in chunks of n until total.
async function send(sys, p, buf) {
  const s = buf.toString('base64'), w = desk.writeChunk(sys, p);
  let last = null;
  for (let at = 0, i = 0; i === 0 || at < s.length; at += w, i++) {
    last = await op(sys, 'write', { path: p, b64: s.slice(at, at + w), append: i > 0, at: i > 0 ? at / 4 * 3 : undefined });
    if (!last.ok) return Object.assign(last, { chunks: i + 1 });
    last.chunks = i + 1;
  }
  return last;
}
async function fetch(sys, p, n) {
  const parts = [];
  let off = 0, total = 0, reads = 0;
  do {
    const r = await op(sys, 'read', { path: p, off, n });
    reads++;
    if (!r.ok) return r;
    parts.push(b64d(r.b64));
    off += r.n;
    total = r.total;
    if (!r.n) break;
  } while (off < total);
  return { ok: true, buf: Buffer.concat(parts), reads, total };
}

// The round trips both systems run: names with everything awkward in them; sizes 0, 1, just under, on and just past
// the chunk boundaries of the write and of the read.
async function roundTrips(sys, dir, sep) {
  const w = desk.writeChunk(sys, dir + sep + 'on-the-boundary.bin') / 4 * 3;
  const cases = [
    ['empty.bin', 0, 1000], ['one byte.bin', 1, 1000],
    ['on-the-boundary.bin', w * 2, 7000],
    ['past the boundary \u00e9.bin', w * 2 + 1, 4096],
    ["every byte 'q' \u4e2d.bin", 3 * 4096, 4096],
  ];
  const each = cases.map(async ([name, size, n], k) => {
    const p = dir + sep + name, data = bytes(size, k);
    const wr = await send(sys, p, data);
    ok(wr.ok && wr.size === size, sys + ' send "' + name + '" (' + size + ' bytes, ' + (wr.chunks || '?') + ' chunks): the last write says the whole size (' + (wr.why || wr.size) + ')');
    const st = await op(sys, 'stat', { path: p });
    ok(st.ok && st.exists === true && st.dir === false && st.size === size && typeof st.mtime === 'number', sys + ' stat "' + name + '": exists, a file, ' + size + ' bytes (' + (st.why || st.size) + ')');
    ok(st.full === p, sys + ' stat "' + name + '": full is the path, every character intact (' + st.full + ')');
    const rd2 = await fetch(sys, p, n);
    ok(rd2.ok && rd2.buf.equals(data), sys + ' fetch "' + name + '" in ' + (rd2.reads || '?') + ' reads of ' + n + ': the same bytes back (' + (rd2.why || rd2.buf.length) + ')');
    if (size === 1) {
      const past = await op(sys, 'read', { path: p, off: 5 });
      ok(past.ok && past.n === 0 && past.b64 === '' && past.total === 1, sys + ' read past the end: an empty chunk, not an error');
    }
  });
  // a resent chunk lands once; a chunk after a missing one is refused
  const resend = (async () => {
    const p = dir + sep + 'resend.bin', d = bytes(30, 9), s = d.toString('base64');
    await op(sys, 'write', { path: p, b64: s.slice(0, 20), append: false });
    const r1 = await op(sys, 'write', { path: p, b64: s.slice(20), append: true, at: 15 });
    const r2 = await op(sys, 'write', { path: p, b64: s.slice(20), append: true, at: 15 });
    const back = await fetch(sys, p, 1000);
    ok(r1.ok && r2.ok && r2.size === 30 && back.ok && back.buf.equals(d), sys + ' write: the same chunk sent twice (at 15) lands once -- 30 bytes, the right ones');
    const gap = await op(sys, 'write', { path: p, b64: 'AAAA', append: true, at: 31 });
    ok(!gap.ok && gap.err === 'gap' && /is 30 bytes, but this chunk starts at 31/.test(gap.why), sys + ' write: a chunk after a missing one is refused (' + gap.why + ')');
    const st = await op(sys, 'stat', { path: p });
    ok(st.ok && st.size === 30, sys + ' write: ...and the refused chunk changed nothing (' + st.size + ')');
  })();
  // the ways it fails, each on its own
  const fails = [
    [['read', { path: dir + sep + 'nope.txt' }], (r) => !r.ok && r.err === 'nofile' && r.why === 'no such file: ' + dir + sep + 'nope.txt', 'read of a missing file'],
    [['stat', { path: dir + sep + 'nope.txt' }], (r) => r.ok && r.exists === false && r.size === null, 'stat of nothing is an answer, not a failure'],
    [['stat', { path: dir }], (r) => r.ok && r.exists && r.dir === true && r.size === null, 'stat of a folder: dir, no size'],
    [['read', { path: dir }], (r) => !r.ok && r.err === 'isdir' && /is a folder, not a file/.test(r.why), 'read of a folder'],
    [['write', { path: dir, b64: '' }], (r) => !r.ok && r.err === 'isdir' && /write needs the path of a file/.test(r.why), 'write to a folder'],
    [['write', { path: dir + sep + 'no folder' + sep + 'x.bin', b64: '' }], (r) => !r.ok && r.err === 'nodir' && r.why === 'no such folder: ' + dir + sep + 'no folder', 'write into a missing folder'],
    [['write', { path: dir + sep + 'never.bin', b64: 'AAAA', append: true }], (r) => !r.ok && r.err === 'noappend', 'append to a file that is not there'],
    [['rm', { path: dir + sep + CAP }], (r) => !r.ok && r.err === 'notmine' && /not a file a capture made/.test(r.why), 'rm of a capture-shaped name outside the temp folder is refused by the host'],
  ].map(async ([[name, args], test, what]) => { const r = await op(sys, name, args); ok(test(r), sys + ' ' + what + ': ' + (r.why || JSON.stringify(r).slice(0, 120))); });
  await Promise.all(each.concat([resend], fails));
}

// ---- REAL on Windows ----------------------------------------------------------------------------------------
async function windowsLive() {
  const dir = path.join(tmp, "with space & 'q' 100% !x^ [b] \u00e9 \u4e2d\u6587 \ud83d\ude42");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, CAP), 'not a capture');
  const trips = roundTrips('windows', dir, '\\');

  // a full-size read stays inside the host's 512 KB
  const full = (async () => {
    const big = path.join(dir, 'big.bin'), bigData = bytes(desk.READ_MAX + 1000, 3);
    fs.writeFileSync(big, bigData);
    const fr = await op('windows', 'read', { path: big, n: desk.READ_MAX });
    ok(fr.ok && fr.n === desk.READ_MAX && fr.rawLen < 512 * 1024 && b64d(fr.b64).equals(bigData.subarray(0, desk.READ_MAX)), 'windows read of READ_MAX: ' + fr.rawLen + ' characters of output, inside the host\'s 512 KB');
  })();

  // no permission: a deny-read ACE on our own file; a read-only file; a file another program holds open
  const denied = (async () => {
    const user = os.userInfo().username;
    const locked = path.join(dir, 'denied.txt'); fs.writeFileSync(locked, 'secret');
    const deny = spawnSync('icacls', [locked, '/deny', user + ':(R)'], { encoding: 'utf8', windowsHide: true });
    if (deny.status === 0) {
      const dn = await op('windows', 'read', { path: locked });
      ok(!dn.ok && dn.err === 'denied' && /^no permission to read /.test(dn.why), 'windows read without permission: ' + dn.why);
      spawnSync('icacls', [locked, '/remove:d', user], { windowsHide: true });
    } else console.log('  (skip: icacls could not deny ' + user + ' -- ' + (deny.stdout || deny.stderr || '').trim().slice(0, 80) + ')');
  })();
  const readOnly = (async () => {
    const ro = path.join(dir, 'read-only.txt'); fs.writeFileSync(ro, 'x'); fs.chmodSync(ro, 0o444);
    const rw = await op('windows', 'write', { path: ro, b64: 'AAAA' });
    ok(!rw.ok && rw.err === 'readonly' && /read-only/.test(rw.why), 'windows write to a read-only file: ' + rw.why);
    fs.chmodSync(ro, 0o666);
  })();
  const inUse = (async () => {
    const held = path.join(dir, 'held open.txt'); fs.writeFileSync(held, 'busy');
    const holder = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', "$f = [IO.File]::Open('" + held.replace(/'/g, "''") + "', 'Open', 'ReadWrite', 'None'); 'HELD'; Start-Sleep -Seconds 20"], { windowsHide: true });
    const isHeld = await new Promise((res) => { let o = ''; holder.stdout.on('data', (b) => { o += b; if (/HELD/.test(o)) res(true); }); holder.on('close', () => res(false)); setTimeout(() => res(false), 20000); });
    if (isHeld) {
      const iu = await op('windows', 'read', { path: held });
      ok(!iu.ok && iu.err === 'inuse' && /open in another program/.test(iu.why), 'windows read of a file another program holds: ' + iu.why);
    } else ok(false, 'windows: the stand-in program never held its file');
    holder.kill();
  })();

  // rm: a capture-shaped name in the temp folder is removed; gone already is not an error
  const rm = (async () => {
    const mineP = path.join(os.tmpdir(), 'agent-drive-rec-' + bytes(8, Date.now() & 255).toString('hex') + '.wav');
    fs.writeFileSync(mineP, 'RIFF');
    const r1 = await op('windows', 'rm', { path: mineP });
    ok(r1.ok && r1.removed === true && !fs.existsSync(mineP), 'windows rm of a capture\'s file in the temp folder removes it');
    const r2 = await op('windows', 'rm', { path: mineP });
    ok(r2.ok && r2.removed === false, 'windows rm of one already gone: removed:false, not an error');
  })();
  await Promise.all([trips, full, denied, readOnly, inUse, rm]);
  ok(fs.readFileSync(path.join(dir, CAP), 'utf8') === 'not a capture', 'windows rm: ...and the file it refused is untouched');
}

// THE CAMERA: listed for real; a photo only where there is no camera to take one with, or DESK_CAMERA=1.
async function windowsCamera() {
  const t0 = Date.now();
  const dry = await op('windows', 'camera', { dry: true });
  const ms = Date.now() - t0;
  ok((dry.ok && dry.dry && Array.isArray(dry.cameras) && dry.cameras.length > 0 && dry.cameras.includes(dry.device)) || (!dry.ok && /no camera|not available/.test(dry.why || '')),
     'windows camera (dry): lists the cameras and turns none on, or says there is none (' + (dry.why || dry.cameras.join(', ')) + ', ' + ms + ' ms)');
  const miss = await op('windows', 'camera', { device: 'no-such-camera-' + process.pid });
  ok(!miss.ok && /no camera/.test(miss.why || '') && Array.isArray(miss.cameras || []), 'windows camera by a name nothing has: ' + miss.why);
  if (!dry.ok || process.env.DESK_CAMERA === '1') {
    const shot = await op('windows', 'camera', {});
    if (dry.ok) {
      ok(shot.ok && shot.mime === 'image/jpeg' && shot.bytes > 1000 && desk.CAPTURE.test(path.basename(shot.path)), 'windows camera (DESK_CAMERA=1): a JPEG in the temp folder (' + (shot.why || shot.bytes + ' bytes') + ')');
      if (shot.ok) {
        const f = await fetch('windows', shot.path, desk.READ_N);
        ok(f.ok && f.buf.length === shot.bytes && f.buf[0] === 0xff && f.buf[1] === 0xd8, 'windows camera: read back, it is a JPEG');
        ok((await op('windows', 'rm', { path: shot.path })).removed === true, 'windows camera: removed');
      }
    } else ok(!shot.ok && /no camera|not available/.test(shot.why || ''), 'windows camera on a machine without one fails in words: ' + shot.why);
  } else console.log('  (camera: this machine has one (' + dry.cameras.join(', ') + ') -- no photo taken; DESK_CAMERA=1 takes one)');
}

// THE RECORDER: its conversion fed known bytes; its loopback stream opened (dry); and, live, 1 s recorded.
async function windowsAudio() {
  const cs = path.join(tmp, 'loop.cs'), ps = path.join(tmp, 'mix.ps1');
  fs.writeFileSync(cs, desk.script('audio', 'windows').split("$DESKLOOP=@'\n")[1].split("\n'@\n")[0]);
  fs.writeFileSync(ps, [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition ([IO.File]::ReadAllText('" + cs.replace(/'/g, "''") + "'))",
    '$f = [BitConverter]::GetBytes([single]0.5) + [BitConverter]::GetBytes([single]-0.25)',
    '$i16 = [BitConverter]::GetBytes([int16]-16384) + [BitConverter]::GetBytes([int16]16384)',
    "'float32 ' + [DeskLoop]::Mix($f, 0, 2, 32, $true)",
    "'pcm16 ' + [DeskLoop]::Mix($i16, 0, 1, 16, $false) + ' ' + [DeskLoop]::Mix($i16, 2, 1, 16, $false)",
    "'pcm24 ' + [DeskLoop]::Mix([byte[]](0, 0, 0x80, 0xFF, 0xFF, 0x7F), 0, 2, 24, $false)",
    "'pcm24neg ' + [DeskLoop]::Mix([byte[]](0, 0, 0xC0), 0, 1, 24, $false)",
    "'pcm32 ' + [DeskLoop]::Mix([BitConverter]::GetBytes([int32]1073741824), 0, 1, 32, $false)",
    "'pcm8 ' + [DeskLoop]::Mix([byte[]](0, 255), 0, 2, 8, $false)",
    "'clip ' + [DeskLoop]::Pcm(1.5) + ' ' + [DeskLoop]::Pcm(-2) + ' ' + [DeskLoop]::Pcm(0.5)",
  ].join('\n'));
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const v = {};
  for (const l of (r.stdout || '').split(/\r?\n/)) { const m = /^(\w+) (.*)$/.exec(l.trim()); if (m) v[m[1]] = m[2].split(' ').map(Number); }
  const near = (got, want) => Array.isArray(got) && got.length === want.length && got.every((x, i) => Math.abs(x - want[i]) < 1e-9);
  ok(near(v.float32, [0.125]), 'recorder: float32 stereo (0.5, -0.25) mixes to 0.125 (' + v.float32 + (r.stderr ? ' ' + r.stderr.trim().slice(0, 200) : '') + ')');
  ok(near(v.pcm16, [-0.5, 0.5]), 'recorder: 16-bit PCM reads signed (' + v.pcm16 + ')');
  ok(near(v.pcm24, [(-1 + 8388607 / 8388608) / 2]) && near(v.pcm24neg, [-0.5]), 'recorder: 24-bit PCM is sign-extended (' + v.pcm24 + ', ' + v.pcm24neg + ')');
  ok(near(v.pcm32, [0.5]) && near(v.pcm8, [(-1 + 127 / 128) / 2]), 'recorder: 32- and 8-bit PCM (' + v.pcm32 + ', ' + v.pcm8 + ')');
  ok(near(v.clip, [32767, -32767, 16384]), 'recorder: samples are clipped to 16 bits (' + v.clip + ')');

  const t0 = Date.now();
  const dry = await op('windows', 'audio', { dry: true });
  const ms = Date.now() - t0;
  ok((dry.ok && dry.dry && dry.source && dry.source.rate > 0 && dry.source.channels > 0 && /^(float|pcm)\d+$/.test(dry.source.format)) ||
     (!dry.ok && /playback device|Audio service|could not record/.test(dry.why || '')),
     'windows audio (dry): compiles the recorder and opens the loopback stream, or says why not (' + (dry.why || dry.device + ', ' + JSON.stringify(dry.source)) + ', ' + ms + ' ms)');
  ok(dry.ok ? ms < 6000 : true, 'windows audio (dry): starts in well under the host\'s 10 s (' + ms + ' ms)');
  if (!dry.ok) return;
  if (!LIVE) { console.log('  (skip the 1 s recording: AGENT_DRIVE_LIVE=0)'); return; }
  const t1 = Date.now();
  const rec = await op('windows', 'audio', { seconds: 1 });
  const rms = Date.now() - t1;
  ok(rec.ok && rec.mime === 'audio/wav' && rec.seconds === 1 && rec.channels === 1 && rec.rate === dry.source.rate && rec.bytes === 44 + rec.rate * 2 &&
     desk.CAPTURE.test(path.basename(rec.path)) && typeof rec.peak === 'number' && rec.peak >= 0 && rec.peak <= 1,
     'windows audio: 1 s of what is playing, as a mono WAV in the temp folder (' + (rec.why || rec.bytes + ' bytes, peak ' + rec.peak + ', ' + rms + ' ms') + ')');
  if (!rec.ok) return;
  ok(rec.peak === 0 ? rec.note === 'silent: nothing was playing on ' + rec.device : rec.note === undefined, 'windows audio: a silent clip says so, naming the device -- and only a silent one (' + rec.note + ')');
  const f = await fetch('windows', rec.path, desk.READ_N);
  const h = f.buf || Buffer.alloc(0);
  ok(f.ok && h.length === rec.bytes && h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 16) === 'WAVEfmt ' && h.readUInt16LE(22) === 1 &&
     h.readUInt32LE(24) === rec.rate && h.readUInt16LE(34) === 16 && h.toString('latin1', 36, 40) === 'data' && h.readUInt32LE(40) === rec.rate * 2,
     'windows audio: read back, a well-formed 16-bit mono WAV of exactly 1 s (its samples are not looked at)');
  const gone = await op('windows', 'rm', { path: rec.path });
  ok(gone.ok && gone.removed === true, 'windows audio: the recording is removed');
}

// ---- REAL on Linux --------------------------------------------------------------------------------------------
async function linuxLive() {
  if (!LIN) { console.log('  (skip Linux runs: no /bin/sh, no WSL, no Python)'); return; }
  console.log('  Linux scripts run ' + (LIN === 'sh' ? 'through /bin/sh -c' : LIN === 'wsl' ? 'through /bin/sh -c in WSL' : 'under this machine\'s Python (file ops only)'));
  const sh = LIN !== 'python';
  let base;
  if (sh) base = (await linRun('mktemp -d "${TMPDIR:-/tmp}/desk-files-XXXXXX"')).raw.trim();
  else { base = path.join(tmp, 'lin'); fs.mkdirSync(base); }
  const sep = LIN === 'python' ? path.sep : '/';
  const dir = base + sep + "with space 'q' $HOME %PATH% \u00e9 \u4e2d\u6587 \ud83d\ude42";
  if (sh) await linRun('mkdir -p ' + shq(dir) + ' && printf x > ' + shq(dir + '/' + CAP)); else { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, CAP), 'x'); }
  try {
    await roundTrips('linux', dir, sep);
    if (sh) {
      const root = (await linRun('id -u')).raw.trim() === '0';
      if (!root) {
        await linRun('printf secret > ' + shq(dir + '/denied.txt') + ' && chmod 000 ' + shq(dir + '/denied.txt'));
        const dn = await op('linux', 'read', { path: dir + '/denied.txt' });
        ok(!dn.ok && dn.err === 'denied' && /^no permission to read /.test(dn.why), 'linux read without permission: ' + dn.why);
      } else console.log('  (skip the permission check: running as root)');
      const z = await op('linux', 'read', { path: '/dev/zero' });
      ok(!z.ok && z.err === 'special' && /not a regular file/.test(z.why), 'linux read of /dev/zero is refused, not read forever: ' + z.why);
      await linuxCapture(base);
    }
  } finally {
    if (sh) await linRun('chmod -R u+rwx ' + shq(base) + '; rm -rf ' + shq(base));
  }
}

// Camera and audio on Linux, against stand-ins on the PATH: each writes its arguments to $STUB_LOG.
async function linuxCapture(base) {
  const stubs = path.join(tmp, 'stubs'), only = path.join(tmp, 'stubs-ffmpeg'), busy = path.join(tmp, 'stubs-busy');
  for (const d of [stubs, only, busy]) fs.mkdirSync(d);
  const put = (d, name, text) => { const f = path.join(d, name); fs.writeFileSync(f, text.replace(/\r\n/g, '\n')); fs.chmodSync(f, 0o755); };
  const JPEG = "printf '\\377\\330\\377\\340stub-jpeg\\377\\331'";
  put(stubs, 'fswebcam', '#!/bin/sh\necho "$@" > "$STUB_LOG"\n' + JPEG + '\n');
  put(only, 'ffmpeg', '#!/bin/sh\necho "$@" > "$STUB_LOG"\ncase "$*" in *v4l2*) ' + JPEG + ' ;; *) exec python3 -c "import sys; sys.stdout.buffer.write(bytes([0, 64]) * 48000)" ;; esac\n');
  put(busy, 'fswebcam', '#!/bin/sh\necho "Error opening device: $4: Device or resource busy" >&2\nexit 1\n');
  put(stubs, 'pactl', '#!/bin/sh\n[ "$1" = get-default-sink ] && echo alsa_output.stub\n');
  put(only, 'pactl', '#!/bin/sh\n[ "$1" = info ] && printf "Server Name: stub\\nDefault Sink: alsa_output.info\\n"\nexit 0\n');
  put(stubs, 'parec', '#!/usr/bin/env python3\nimport os, struct, sys, time\nopen(os.environ["STUB_LOG"], "w").write(" ".join(sys.argv[1:]))\nb = struct.pack("<2h", 16384, -16384) * 2400\nwhile True:\n    sys.stdout.buffer.write(b)\n    sys.stdout.flush()\n    time.sleep(0.02)\n');
  const log = path.join(tmp, 'stub.log');
  // The PATH of a stand-in run: the stand-ins, then a folder holding only python3 -- never the system's own
  // folders, where a real parec or fswebcam would answer instead.
  const bare = path.join(tmp, 'bare');
  fs.mkdirSync(bare);
  await linRun('ln -s "$(command -v python3)" ' + shq(toLin(bare) + '/python3'));
  const env = (d) => ({ PATH: toLin(d) + ':' + toLin(bare), STUB_LOG: toLin(log) });
  const cam = base + '/video-stub';
  await linRun('printf x > ' + shq(cam));
  const lastLog = () => { try { return fs.readFileSync(log, 'utf8').trim(); } catch (_) { return ''; } };

  const real = await op('linux', 'camera', {});
  ok(real.ok || /no camera|neither fswebcam nor ffmpeg|could not take|busy/.test(real.why || ''), 'linux camera on this machine: a photo or a reason (' + (real.why || real.path) + ')');
  if (real.ok) await op('linux', 'rm', { path: real.path });
  const shot = await op('linux', 'camera', { device: cam }, env(stubs));
  ok(shot.ok && shot.tool === 'fswebcam' && shot.mime === 'image/jpeg' && shot.bytes === 15 && desk.CAPTURE.test(shot.path.split('/').pop()), 'linux camera with fswebcam: a JPEG in the temp folder (' + (shot.why || shot.path) + ')');
  ok(/-d \S*video-stub .*-S \d+ .* -$/.test(lastLog()), 'linux camera: fswebcam is told the device, to skip the first frames, and to write to stdout (' + lastLog() + ')');
  if (shot.ok) {
    const f = await fetch('linux', shot.path, 1000);
    ok(f.ok && f.buf[0] === 0xff && f.buf[1] === 0xd8 && f.buf.length === 15, 'linux camera: read back, the stand-in\'s JPEG');
    ok((await op('linux', 'rm', { path: shot.path })).removed === true && (await op('linux', 'rm', { path: shot.path })).removed === false, 'linux camera: removed, and removing again is not an error');
  }
  const ff = await op('linux', 'camera', { device: cam }, env(only));
  ok(ff.ok && ff.tool === 'ffmpeg' && / -f v4l2 .* -ss \S+ .* pipe:1$/.test(lastLog()), 'linux camera with only ffmpeg: v4l2 in, the first frames dropped, one JPEG out (' + (ff.why || lastLog()) + ')');
  if (ff.ok) await op('linux', 'rm', { path: ff.path });
  const bz = await op('linux', 'camera', { device: cam }, env(busy));
  ok(!bz.ok && /busy -- another program is using it/.test(bz.why || ''), 'linux camera in use: ' + bz.why);
  const dry = await op('linux', 'camera', { device: cam, dry: true }, env(stubs));
  ok(dry.ok && dry.dry && dry.tools.includes('fswebcam'), 'linux camera (dry): names the device and the tools, takes nothing');
  const nt = await op('linux', 'camera', { device: cam }, { PATH: toLin(bare) });
  ok(!nt.ok && /neither fswebcam nor ffmpeg is installed/.test(nt.why) && nt.missing.join() === 'fswebcam,ffmpeg', 'linux camera with no tool says which: ' + nt.why);
  const nm = await op('linux', 'camera', { device: 'no-such-camera' }, env(stubs));
  ok(!nm.ok && /no camera/.test(nm.why), 'linux camera by a name nothing has: ' + nm.why);

  const rec = await op('linux', 'audio', { seconds: 1 }, env(stubs));
  ok(rec.ok && rec.tool === 'parec' && rec.device === 'alsa_output.stub.monitor' && rec.seconds === 1 && rec.bytes === 44 + 96000 && rec.peak === 0.5 && rec.note === undefined,
     'linux audio with parec: 1 s of the default sink\'s monitor, peak 0.5 (' + (rec.why || JSON.stringify({ device: rec.device, bytes: rec.bytes, peak: rec.peak })) + ')');
  ok(lastLog() === '--raw --device=alsa_output.stub.monitor --format=s16le --rate=48000 --channels=1 --latency-msec=50', 'linux audio: parec is asked for raw 16-bit mono 48 kHz from the monitor (' + lastLog() + ')');
  if (rec.ok) {
    const f = await fetch('linux', rec.path, desk.READ_N);
    ok(f.ok && f.buf.toString('latin1', 0, 4) === 'RIFF' && f.buf.readUInt32LE(24) === 48000 && f.buf.readUInt16LE(22) === 1 && f.buf.readUInt32LE(40) === 96000 && f.buf.readInt16LE(44) === 16384,
       'linux audio: read back, a mono 48 kHz WAV holding what the stand-in played');
    await op('linux', 'rm', { path: rec.path });
  }
  const rf = await op('linux', 'audio', { seconds: 1 }, env(only));
  ok(rf.ok && rf.tool === 'ffmpeg' && rf.device === 'alsa_output.info.monitor' && rf.bytes === 44 + 96000, 'linux audio with only ffmpeg, the sink from `pactl info` (an older server): ' + (rf.why || rf.device));
  ok(/-f pulse -i alsa_output\.info\.monitor -t 1\.000 -ac 1 -ar 48000 -f s16le pipe:1/.test(lastLog()), 'linux audio: ffmpeg records the monitor, mono 48 kHz raw, for the clip (' + lastLog() + ')');
  if (rf.ok) await op('linux', 'rm', { path: rf.path });
  const ad = await op('linux', 'audio', { dry: true }, env(stubs));
  ok(ad.ok && ad.dry && ad.tool === 'parec' && ad.device === 'alsa_output.stub.monitor', 'linux audio (dry): the tool and the source, nothing recorded');
  const na = await op('linux', 'audio', { seconds: 1 }, { PATH: toLin(bare) });
  ok(!na.ok && /neither parec\/parecord \(pulseaudio-utils\) nor ffmpeg/.test(na.why), 'linux audio with no tool says which: ' + na.why);
}

(async () => {
  if (WIN) {
    await Promise.all([windowsLive(), windowsCamera(), windowsAudio()]);
  } else console.log('  (skip the Windows runs: not Windows)');
  await linuxLive();
})().then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log((fail ? 'FAIL' : 'ok') + ' desk_files: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
}, (e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });

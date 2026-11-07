// undo.js -- core/undo.js: what a command changed on the host, and how it is put back.
// Offline: cmd.exe builtins, PowerShell (named, positional and abbreviated parameters, aliases, every quote it
// knows), POSIX sh, quoting that would have broken an undo, commands it cannot name, typed text never stored, the
// summary and the chat list -- and ROUND TRIPS: the undo of a move or rename, fed back to record(), reads as the
// move the other way. REAL round trips where the machine can run them: on Windows each undo runs the way the host
// runs an exec (cmd.exe /c) against files in a temp folder -- moved, then put back, then refused when the old place
// is taken; sh the same where there is one (Linux, or Git's sh on Windows). The temp folders are removed.
// CAPTURE BEFORE CHANGE: what prepare() reads first for each kind of change, and what record() makes of the answers
// (put back, refused, no change, why not); supersede() and cleanup(). For real: the serve's part played here --
// captures, command, captures, record, undo -- for overwrites, deletes, creations, copies and moves over a file, the
// registry (in a test key of its own, removed), icacls, a refused junction or link, the cap, and cleanup.
//   node tests/undo.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const undo = require(path.join(__dirname, '..', 'core', 'undo.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const r = String.raw;
const NOW = Date.UTC(2026, 10, 6, 9, 30);
const rec = (cmd, osName, res, ctx) => undo.record(cmd, res || { ok: true }, Object.assign({ os: osName, now: NOW, seq: 1 }, ctx || {}));
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const W = (c, ctx) => list(rec({ do: 'exec', cmd: c }, 'windows', null, ctx));
const L = (c, ctx) => list(rec({ do: 'exec', cmd: c }, 'linux', null, ctx));
const PS = (script) => 'powershell -NoProfile -Command "' + script + '"';
const ENC = (script) => 'powershell -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64');
const psq = (s) => "'" + s.replace(/['\u2018\u2019\u201A\u201B]/g, (m) => m + m) + "'";
const sq = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
const what = (es) => es.map((e) => e.what);
const is = (es, want, m) => ok(JSON.stringify(what(es)) === JSON.stringify(want), m + ' -> ' + JSON.stringify(what(es)) + ' (want ' + JSON.stringify(want) + ')');
const back = (e) => (e && e.undo && e.undo.kind === 'exec' ? e.undo.cmd : '');
const inner = (cmd) => { const m = /^powershell -NoProfile -NonInteractive -Command "([\s\S]*)"$/.exec(cmd); return m ? m[1] : null; };

// ---- what a journal entry is --------------------------------------------------------------------------------
{
  const e = W(r`move C:\a.txt D:\Archive`)[0];
  ok(e && JSON.stringify(Object.keys(e)) === JSON.stringify(['id', 'at', 'verb', 'what', 'md', 'kind', 'reversible', 'undo', 'paths']), 'an entry is {id, at, verb, what, md, kind, reversible, undo, paths}');
  ok(JSON.stringify(e.paths) === JSON.stringify({ os: 'windows', from: [r`C:\a.txt`], to: [r`D:\Archive`] }), 'paths: where it acted -> ' + JSON.stringify(e.paths));
  ok(!('paths' in rec({ do: 'keys', text: 'x' }, 'windows')) && !('paths' in rec({ do: 'changed', what: 'x' }, 'windows')) && !('paths' in W('git pull')[0]), 'typed text, a declared change, a command it cannot name: no paths');
  ok(e.id === 'c1' && e.at === new Date(NOW).toISOString() && e.verb === 'exec' && e.kind === 'exec' && e.reversible === true, 'id c<seq>, at from ctx.now, verb, kind');
  ok(e.undo && e.undo.kind === 'exec' && e.undo.os === 'windows' && typeof e.undo.cmd === 'string' && e.undo.risky === false && /moves it back/.test(e.undo.note), 'a move\'s undo: {kind:exec, os, cmd, risky:false, note}');
  const many = W(r`md C:\x C:\y C:\z`, { seq: 7 });
  ok(many.length === 3 && many.map((x) => x.id).join() === 'c7,c8,c9', 'one command, several changes: an ARRAY numbered seq, seq+1, ... (' + many.map((x) => x.id) + ')');
  ok(!Array.isArray(rec({ do: 'exec', cmd: r`md C:\x` }, 'windows')), 'a single change is one entry, not an array');
  ok(rec({ do: 'exec', cmd: 'move a b' }, 'windows', { ok: false }) === null, 'a failed command is not recorded');
  ok(rec({ do: 'exec', cmd: 'move a b' }, 'windows', { ok: 'true' }) === null && rec({ do: 'exec', cmd: 'move a b' }, 'windows', { ok: 1 }) === null, 'only ok === true counts');
  for (const v of ['click', 'look', 'chat', 'press', 'chord', 'open', 'scroll', 'focus', 'windows', 'status', 'note-add', 'plan', 'quit'])
    ok(rec({ do: v, x: 1, y: 2, text: 'rm -rf /' }, 'linux') === null, v + ' changes nothing nameable -> null');
  ok(rec({ do: 'terminal', keys: 'y\r' }, 'linux') === null, 'terminal keys (no line) -> null');
  ok(undo.record({ do: 'exec', cmd: 'mkdir x' }, { ok: true }).id === 'c1', 'no ctx: still an entry (c1)');
  for (const now of [NaN, 1e20, 'x', null, -1e18]) { const x = rec({ do: 'exec', cmd: 'mkdir x' }, 'linux', null, { now }); ok(x && !isNaN(Date.parse(x.at)), 'a bad ctx.now still gives a real time (' + now + ')'); }
}
// ---- never throws: commands are JSON somebody wrote ------------------------------------------------------------
{
  let threw = 0;
  const odd = [null, undefined, 0, 'exec', [], {}, { do: 'exec' }, { do: 'exec', cmd: { toString: 1 } }, { do: 'exec', cmd: ['mv', 'a', 'b'] }, { do: 'keys', text: { length: 5 } },
    { do: 'changed', what: { x: 1 }, undo: { cmd: { toString: 1 } } }, { do: 'launch', app: ['x'] }, { do: 'terminal', input: 42 }, { do: { toString: 1 } }];
  for (const c of odd) for (const res of [{ ok: true }, null, [], { ok: true, output: { toString: 1 } }, { ok: true, window: 'x' }]) {
    try { undo.record(c, res, { os: 'windows', now: NOW, seq: 1 }); undo.record(c, res, null); undo.record(c, res, 'linux'); } catch (e) { threw++; }
  }
  const trap = {}; Object.defineProperty(trap, 'ok', { get() { throw new Error('boom'); } });
  try { ok(undo.record({ do: 'exec', cmd: 'mkdir x' }, trap, {}) === null, 'a result that throws when read -> null'); } catch (e) { threw++; }
  const trap2 = { do: 'exec' }; Object.defineProperty(trap2, 'cmd', { get() { throw new Error('boom'); } });
  try { ok(undo.record(trap2, { ok: true }, {}) === null, 'a command that throws when read -> null'); } catch (e) { threw++; }
  try { undo.inverse(trap); undo.inverse(null); undo.summary([trap, null, 5]); undo.forChat({ length: 3 }); undo.summary(null, 'x'); } catch (e) { threw++; }
  // random command lines, rich in what shells treat specially
  const alphabet = ['a', 'b', ' ', '  ', '/', '\\', ':', 'C:\\', '"', "'", '’', '‘', '`', '$', '%', '^', '&', '&&', '|', '||', ';', '(', ')', '{', '}', '[', ']', '*', '?', '<', '>', '>>', '2>&1', '\n', '\r\n', '\t', '#', '~',
    '=', ',', '-', '--', 'mv ', 'move ', 'Move-Item ', 'rm -rf ', 'del ', 'mkdir ', 'cd ', 'powershell -Command "', 'sh -c \'', 'if ', 'then ', 'fi', '@\'\n', '\n\'@', '$(', '`n', '-Path', '-Dest', '$env:', '%TEMP%', 'é', '日本', '\u0000', '\uE000'];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let shapes = 0;
  for (let i = 0; i < 2500; i++) {
    let s = '';
    const len = 1 + rnd(14);
    for (let j = 0; j < len; j++) s += alphabet[rnd(alphabet.length)];
    for (const osName of ['windows', 'linux', '']) {
      for (const verb of ['exec', 'terminal']) {
        try {
          const got = undo.record(verb === 'exec' ? { do: 'exec', cmd: s } : { do: 'terminal', input: s }, { ok: true, output: rnd(2) ? 'PS C:\\x> ' : '' }, { os: osName, now: NOW, seq: 3 });
          for (const e of list(got)) {
            if (typeof e.id !== 'string' || typeof e.what !== 'string' || typeof e.md !== 'string' || typeof e.reversible !== 'boolean') shapes++;
            if (e.undo && e.undo.kind === 'exec' && e.undo.os === 'windows' && /^powershell /.test(e.undo.cmd)) {
              const sc = inner(e.undo.cmd);
              if (sc == null || /["%\r\n\u0000]/.test(sc)) shapes++;                   // nothing cmd.exe would still act on
            }
            undo.inverse(e);
          }
          undo.summary(list(got)); undo.forChat(list(got));
        } catch (e) { threw++; if (threw < 4) console.error('  threw on ' + JSON.stringify(s) + ': ' + e.stack); }
      }
    }
  }
  ok(threw === 0, 'nothing ever throws (' + threw + ' did)');
  ok(shapes === 0, 'every random entry has its shape, and every PowerShell undo is safe inside cmd.exe\'s quotes (' + shapes + ' were not)');
}

// ---- keys: typed text is NEVER stored --------------------------------------------------------------------------
{
  const k = rec({ do: 'keys', text: 'hello world' }, 'windows');
  ok(k.what === 'typed 11 characters' && k.kind === 'typed' && k.verb === 'keys' && k.reversible === true, 'keys: "typed 11 characters" -> ' + k.what);
  ok(k.undo.kind === 'hint' && k.undo.text === 'select what was typed and delete it (Ctrl+Z undoes it in most apps)', 'keys: the undo is a hint');
  ok(rec({ do: 'keys', text: 'hello world' }, 'windows', null, { window: 'Untitled - Notepad' }).what === 'typed 11 characters into “Untitled - Notepad”', 'keys: into “<window>”');
  for (const extra of [{ secret: 1, show: 0 }, { secret: 1, show: 1 }, { show: 1 }, {}]) {
    const e = rec(Object.assign({ do: 'keys', text: 'hunter2-PASSWORD' }, extra), 'linux', { ok: true, typed: 16 }, { window: 'Login' });
    const all = JSON.stringify(e) + undo.summary([e]) + undo.forChat([e]) + JSON.stringify(undo.inverse(e));
    ok(!/hunter2|PASSWORD/.test(all), 'the typed text is nowhere in the entry, the summary or the chat list ' + JSON.stringify(extra));
    ok(e.what === 'typed 16 characters into “Login”', 'only its length and the window ' + JSON.stringify(extra) + ' -> ' + e.what);
  }
  ok(rec({ do: 'keys', text: 'hi 👋' }, 'linux').what === 'typed 4 characters', 'an emoji is one character');
  ok(rec({ do: 'keys', text: 'x' }, 'linux').what === 'typed 1 character', 'one character, singular');
  ok(rec({ do: 'keys', text: 12345 }, 'linux').what === 'typed 5 characters', 'a number typed counts its digits');
  ok(rec({ do: 'keys', text: '' }, 'linux') === null && rec({ do: 'keys' }, 'linux') === null, 'nothing typed -> null');
  ok(rec({ do: 'keys', text: 'ab' }, 'linux', null, { window: 'a\nb\u0007' + 'x'.repeat(200) }).what.length < 90, 'the window title is one line, clipped');
}
// ---- launch and changed -----------------------------------------------------------------------------------------
{
  const l = rec({ do: 'launch', app: 'notepad' }, 'windows');
  ok(l.what === 'started notepad' && l.kind === 'launched' && l.reversible && l.undo.kind === 'hint' && l.undo.text === 'close its window', 'launch: "started notepad", hint "close its window"');
  ok(rec({ do: 'launch', app: 'notepad' }, 'windows', { ok: true, window: { title: 'Untitled - Notepad' } }).undo.text === 'close its window (“Untitled - Notepad”)', 'launch: the window it opened, named');
  ok(rec({ do: 'launch', app: 'notepad', dry: 1 }, 'windows') === null && rec({ do: 'launch' }, 'windows') === null, 'a dry launch, or none, changes nothing');
  const c = rec({ do: 'changed', what: 'turned on Dark mode', undo: 'Settings > Colors > Light' }, 'windows');
  ok(c.what === 'turned on Dark mode' && c.kind === 'declared' && c.verb === 'changed' && c.reversible && c.undo.kind === 'hint' && c.undo.text === 'Settings > Colors > Light', 'changed: the driver\'s own words, its undo a hint');
  const long = rec({ do: 'changed', what: 'x'.repeat(500) }, 'windows');
  ok(Array.from(long.what).length <= 200 && /…$/.test(long.what) && long.reversible === false && long.undo === null, 'changed: clipped to 200; no undo given -> not reversible');
  const cm = rec({ do: 'changed', what: 'moved the logs', undo: { cmd: 'mv /var/log/b /var/log/a', os: 'linux' } }, 'windows');
  ok(cm.undo.kind === 'exec' && cm.undo.os === 'linux' && cm.undo.cmd === 'mv /var/log/b /var/log/a' && cm.undo.risky === false, 'changed: {cmd, os} is a command; a move is not risky');
  ok(rec({ do: 'changed', what: 'x', undo: { cmd: 'rm -rf /tmp/x' } }, 'linux').undo.risky === true, 'changed: a command that deletes is risky');
  ok(rec({ do: 'changed', what: 'x', undo: { cmd: 'Remove-Item C:\\x', os: 'windows' } }, 'linux').undo.risky === true, 'changed: Remove-Item is risky');
  ok(rec({ do: 'changed', what: 'x', undo: { cmd: 'do-something-odd' } }, 'linux').undo.risky === true, 'changed: a command it cannot read is risky');
  ok(rec({ do: 'changed', what: 'x', undo: { text: 'press Undo' } }, 'linux').undo.text === 'press Undo', 'changed: {text} is a hint');
  ok(rec({ do: 'changed' }, 'linux').what === 'changed something (not described)', 'changed: no words -> said so');
  ok(undo.inverse(cm).ok && undo.inverse(cm).cmd === 'mv /var/log/b /var/log/a', 'changed: inverse runs the driver\'s command');
}

// ---- cmd.exe ---------------------------------------------------------------------------------------------------
{
  let e = W(r`move "C:\Users\me\a b.txt" D:\Archive`);
  is(e, [r`moved C:\Users\me\a b.txt to D:\Archive`], 'cmd move');
  const sc = inner(back(e[0]));
  ok(sc && sc.includes(r`$item = 'D:\Archive'`) && sc.includes('Test-Path -LiteralPath $item -PathType Container') && sc.includes("Join-Path $item 'a b.txt'") &&
     sc.includes(r`$back = 'C:\Users\me\a b.txt'`) && sc.includes('if (Test-Path -LiteralPath $back) { throw') && sc.endsWith('Move-Item -LiteralPath $item -Destination $back'),
     'cmd move: the undo looks at the destination when it runs (a folder? then the item inside it) and never moves over something -> ' + sc);
  e = W('move /Y C:\\a.txt D:\\Archive\\');
  is(e, [r`moved C:\a.txt to D:\Archive\a.txt`], 'a destination ending in \\ is a folder: the item is inside');
  ok(!back(e[0]).includes('Join-Path') && /a file it replaced there is gone/.test(e[0].undo.note), 'into a folder: no guessing; /Y said in the note');
  e = W(r`copy C:\a.txt D:\b.txt`);
  is(e, [r`copied C:\a.txt to D:\b.txt`], 'cmd copy');
  ok(e[0].reversible && e[0].undo.risky && back(e[0]).includes('Get-ChildItem -LiteralPath $item -Force') && back(e[0]).includes('Remove-Item -LiteralPath $item') && !/-Recurse/i.test(back(e[0])), 'copy: the undo deletes the copy -- risky, a folder only if empty, never -Recurse');
  e = W(r`ren C:\d\old.txt new.txt`);
  is(e, [r`renamed C:\d\old.txt to new.txt`], 'cmd ren');
  ok(inner(back(e[0])).endsWith(r`Rename-Item -LiteralPath 'C:\d\new.txt' -NewName 'old.txt'`), 'ren: renamed back');
  e = W(r`ren C:\d\*.txt *.bak`);
  ok(e.length === 1 && !e[0].reversible && /wildcard/.test(e[0].undo.text), 'ren with a wildcard: not put back, and why');
  e = W(r`del /q C:\tmp\a.log`);
  ok(e[0].what === r`deleted C:\tmp\a.log` && !e[0].reversible && /^del does not use the Recycle Bin/.test(e[0].undo.text), 'del: why it cannot be put back, plainly');
  e = W(r`md C:\x C:\y`);
  is(e, [r`created the folder C:\x`, r`created the folder C:\y`], 'md, two folders');
  ok(back(e[0]) === r`rd "C:\x"` && e[0].undo.risky && /if it is still empty/.test(e[0].undo.note), 'md: the undo is rd -- which removes a folder only while it is empty');
  e = W(r`rd C:\empty`);
  ok(e[0].what === r`removed the empty folder C:\empty` && back(e[0]) === r`md "C:\empty"` && !e[0].undo.risky, 'rd without /s: only an empty folder -- made again by md');
  e = W(r`rd /s /q C:\old`);
  ok(e[0].what === r`deleted C:\old and everything in it` && !e[0].reversible && /^rd \/s does not use the Recycle Bin/.test(e[0].undo.text), 'rd /s: deleted for good');
  is(W(r`echo hi > C:\x.txt`), [r`wrote C:\x.txt (with >: what was in it is replaced)`], 'cmd >');
  is(W(r`echo hi >> C:\x.txt`), [r`added to the end of C:\x.txt`], 'cmd >>');
  ok(!W(r`echo hi > C:\x.txt`)[0].reversible && /old contents were not kept/.test(W(r`echo hi > C:\x.txt`)[0].undo.text), 'an overwrite cannot be put back, and why');
  is(W(r`dir C:\ > nul 2>&1`), [], 'dir > nul 2>&1: nothing');
  is(W(r`type C:\x.txt 2>NUL & echo done & where notepad`), [], 'only reads: nothing');
  is(W(r`cd /d C:\work && move a.txt b`), [r`moved C:\work\a.txt to C:\work\b`], 'cd /d, then relative paths');
  is(W(r`pushd C:\w & mkdir new & popd & mkdir other`), [r`created the folder C:\w\new`, 'created the folder other'], 'pushd/popd');
  e = W('move a.txt b');
  ok(e[0].what === 'moved a.txt to b' && e[0].reversible && inner(back(e[0])).includes("$back = 'a.txt'"), 'a relative path with no cd: the undo runs from the same folder exec does');
  e = W(r`move %USERPROFILE%\Desktop\a.txt %USERPROFILE%\Documents`);
  ok(e[0].what === r`moved %USERPROFILE%\Desktop\a.txt to %USERPROFILE%\Documents` && inner(back(e[0])).includes(r`$back = ($env:USERPROFILE + '\Desktop\a.txt')`), '%USERPROFILE% is carried into the undo as $env:USERPROFILE');
  is(W(r`move C:\a^&b.txt D:\x`), [r`moved C:\a&b.txt to D:\x`], '^ escapes outside quotes');
  is(W(r`move "C:\a & b.txt" "D:\x" & echo done`), [r`moved C:\a & b.txt to D:\x`], '& inside quotes is a name; outside, a new statement');
  is(W('start "" notepad.exe'), ['started notepad.exe'], 'start: a launch');
  e = W(r`reg add HKCU\Software\X /v Name /t REG_SZ /d topsecret /f`);
  ok(e[0].what === r`set the registry value Name in HKCU\Software\X` && !e[0].reversible && /was not read/.test(e[0].undo.text) && !JSON.stringify(e).includes('topsecret'), 'reg add: old value unknown; the value itself never shown');
  is(W(r`reg delete HKCU\Software\X /v Name /f`), [r`deleted the registry value Name in HKCU\Software\X`], 'reg delete /v');
  is(W(r`reg delete HKCU\Software\X /f`), [r`deleted the registry key HKCU\Software\X and everything in it`], 'reg delete a key');
  is(W(r`reg add HKCU\Software\New`), [r`created the registry key HKCU\Software\New (if it was not there)`], 'reg add a key');
  is(W(r`reg query HKCU\Software`), [], 'reg query reads');
  e = W('sc stop Spooler');
  ok(e[0].what === 'stopped the service Spooler' && back(e[0]) === 'sc start "Spooler"' && !e[0].undo.risky, 'sc stop -> sc start');
  e = W('sc config Spooler start= disabled');
  ok(e[0].what === 'set the service Spooler to start disabled' && !e[0].reversible && /services\.msc/.test(e[0].undo.text), 'sc config start=: the old setting is unknown');
  is(W('sc query Spooler'), [], 'sc query reads');
  e = W('net stop "Print Spooler"');
  ok(e[0].what === 'stopped the service Print Spooler' && back(e[0]) === 'net start "Print Spooler"', 'net stop -> net start');
  is(W('net start'), [], 'net start alone lists');
  e = W('taskkill /IM notepad.exe /F');
  ok(e[0].what === 'closed the program notepad.exe' && !e[0].reversible && /cannot be resumed/.test(e[0].undo.text), 'taskkill: cannot be resumed');
  is(W('taskkill /PID 1234'), ['ended process 1234'], 'taskkill /PID');
  is(W(r`cmd /c "move C:\a.txt D:\x"`), [r`moved C:\a.txt to D:\x`], 'cmd /c "...": read inside');
  e = W('git pull && npm run build');
  ok(e.length === 1 && e[0].what === 'ran a command: git pull; npm run build' && !e[0].reversible && e[0].undo === null, 'what it cannot name is still an entry -> ' + e[0].what);
  e = list(rec({ do: 'exec', cmd: 'net user bob p@ssW0rd /add', secret: 1 }, 'windows'));
  ok(e.length === 1 && e[0].what === 'ran a command (its text is private)' && !JSON.stringify(e).includes('p@ss'), 'a secret command: its text is not repeated');
  e = W(r`if exist C:\x (move C:\x D:\y)`);
  ok(e.length === 1 && /^ran a command: if exist/.test(e[0].what), 'if ... (move): it may have moved -- a plain entry');
  is(W('for %f in (*.txt) do @echo %f'), [], 'a for that only echoes: nothing');
  e = W('somecommand ' + 'x'.repeat(200));
  ok(Array.from(e[0].what.replace('ran a command: ', '')).length === 80 && /…$/.test(e[0].what), 'the first 80 characters of what ran');
}

// ---- PowerShell ------------------------------------------------------------------------------------------------
{
  is(W(PS(r`Move-Item -Path 'C:\x\a.txt' -Destination 'D:\y'`)), [r`moved C:\x\a.txt to D:\y`], 'Move-Item, named');
  is(W(PS(r`Move-Item C:\a.txt D:\y`)), [r`moved C:\a.txt to D:\y`], 'Move-Item, positional');
  is(W(PS(r`Move-Item -Lit 'C:\a.txt' -Dest 'D:\y'`)), [r`moved C:\a.txt to D:\y`], 'parameters abbreviated (-Lit, -Dest)');
  is(W(PS(r`Move-Item -Path:'C:\a.txt' -Destination:D:\y`)), [r`moved C:\a.txt to D:\y`], '-Name:value');
  is(W(PS(r`mv C:\a D:\b; mi C:\c D:\d; move C:\e D:\f; Microsoft.PowerShell.Management\Move-Item C:\g D:\h`)), [r`moved C:\a to D:\b`, r`moved C:\c to D:\d`, r`moved C:\e to D:\f`, r`moved C:\g to D:\h`], 'aliases and a module-qualified name');
  let e = W(PS(r`Move-Item -Path 'C:\x\*.txt' -Destination D:\y`));
  ok(!e[0].reversible && /wildcard/.test(e[0].undo.text), '-Path with * is a wildcard: which files is not known');
  e = W(PS(r`Move-Item -Path 'C:\x\r[1].txt' -Destination D:\y`));
  ok(!e[0].reversible, '-Path with [1] is a wildcard too (PowerShell reads it as a pattern)');
  e = W(PS(r`Move-Item -LiteralPath 'C:\x\r[1].txt' -Destination D:\y`));
  ok(e[0].reversible && inner(back(e[0])).includes(r`$back = 'C:\x\r[1].txt'`), '-LiteralPath: [1] is a name');
  ok(!W(PS(r`Move-Item -Path C:\x -Filter *.log -Destination D:\y`))[0].reversible, '-Filter: which items is not known');
  e = W(PS(r`Move-Item -LiteralPath 'C:\x\Bob’’s it''s.docx' -Destination 'D:\y'`));
  ok(e[0].what === r`moved C:\x\Bob’s it's.docx to D:\y`, 'PowerShell\'s quote doubling, typographic too -> ' + e[0].what);
  ok(inner(back(e[0])).includes(r`'C:\x\Bob’’s it''s.docx'`), 'the undo doubles them again');
  e = W(ENC("Move-Item -LiteralPath " + psq('C:\\x\\‘a’ ‚b‛ c.txt') + " -Destination 'D:\\y'"));
  ok(e[0].what === 'moved C:\\x\\‘a’ ‚b‛ c.txt to D:\\y' && inner(back(e[0])).includes("'C:\\x\\‘‘a’’ ‚‚b‛‛ c.txt'"), 'every quote character PowerShell knows is doubled in the undo');
  e = W(PS(r`Move-Item -LiteralPath 'C:\100% done.txt' -Destination 'C:\done'`));
  ok(e[0].reversible && inner(back(e[0])).includes(r`('C:\100' + [char]37 + ' done.txt')`) && !/%/.test(inner(back(e[0]))), '% becomes [char]37: cmd.exe would expand %...% even inside quotes');
  is(W(PS(r`Rename-Item -LiteralPath 'C:\d\old.txt' -NewName 'new.txt'; ren C:\d\a.txt b.txt; rni C:\d\c.txt d.txt`)), [r`renamed C:\d\old.txt to new.txt`, r`renamed C:\d\a.txt to b.txt`, r`renamed C:\d\c.txt to d.txt`], 'Rename-Item, ren, rni');
  e = W(PS(r`Copy-Item C:\src -Destination D:\dst -Recurse`));
  ok(e[0].what === r`copied C:\src to D:\dst (with everything in it)` && !e[0].reversible && /never deleted for you/.test(e[0].undo.text), 'Copy-Item -Recurse: a folder with things in it is never deleted for you');
  e = W(PS(r`Copy-Item C:\a.txt D:\b.txt`));
  ok(e[0].reversible && e[0].undo.risky && /deletes the copy/.test(e[0].undo.note), 'Copy-Item: the undo deletes the copy (risky, said)');
  e = W(PS(r`New-Item -ItemType Directory -Path C:\p\new; New-Item C:\p\a.txt -Value hi; ni -Path C:\p -Name q -Type File; mkdir C:\p\m; md C:\p\n`));
  is(e, [r`created the folder C:\p\new`, r`created the file C:\p\a.txt`, r`created the file C:\p\q`, r`created the folder C:\p\m`, r`created the folder C:\p\n`], 'New-Item, ni, mkdir, md');
  ok(back(e[0]) === r`rd "C:\p\new"` && inner(back(e[1])).endsWith(r`Remove-Item -LiteralPath 'C:\p\a.txt'`) && e[1].undo.risky, 'a new folder: rd; a new file: Remove-Item (risky)');
  e = W(PS(r`New-Item -Force -ItemType File C:\p\a.txt`));
  ok(!e[0].reversible && /New-Item -Force replaces/.test(e[0].undo.text), 'New-Item -Force on a file: it may have replaced one');
  e = W(PS(r`Remove-Item -Recurse -Force C:\x; rm C:\y; del C:\z; ri C:\w`));
  is(e, [r`deleted C:\x and everything in it`, r`deleted C:\y`, r`deleted C:\z`, r`deleted C:\w`], 'Remove-Item and its aliases');
  ok(e.every((x) => !x.reversible && /^Remove-Item does not use the Recycle Bin/.test(x.undo.text)), 'Remove-Item: no Recycle Bin, said plainly');
  is(W(PS(r`Remove-Item C:\x -WhatIf`)), [], '-WhatIf changes nothing');
  is(W(PS(r`Remove-Item C:\x -WhatIf:$false`)), [r`deleted C:\x`], '-WhatIf:$false does');
  is(W(PS(r`Move-Item -?`)), [], '-? is help');
  e = W(PS(r`Set-ItemProperty -Path HKCU:\Software\X -Name AppsUseLightTheme -Value 0`));
  ok(e[0].what === r`set the registry value AppsUseLightTheme in HKCU:\Software\X` && !e[0].reversible && /Registry Editor/.test(e[0].undo.text), 'Set-ItemProperty: old value unknown');
  e = W(PS(r`New-ItemProperty -Path HKCU:\Software\X -Name Foo -Value 1 -PropertyType DWord`));
  ok(e[0].what === r`added the registry value Foo to HKCU:\Software\X` && e[0].undo.risky && inner(back(e[0])).endsWith(r`Remove-ItemProperty -LiteralPath 'HKCU:\Software\X' -Name 'Foo'`), 'New-ItemProperty: a new value, taken away again');
  ok(!W(PS(r`New-ItemProperty -Path HKCU:\Software\X -Name Foo -Value 1 -Force`))[0].reversible, 'New-ItemProperty -Force may have replaced a value');
  is(W(PS(r`Remove-ItemProperty -Path HKCU:\Software\X -Name Foo`)), [r`deleted the registry value Foo in HKCU:\Software\X`], 'Remove-ItemProperty');
  e = W(PS(r`New-Item -Path HKCU:\Software\NewKey`));
  ok(e[0].what === r`created the registry key HKCU:\Software\NewKey` && inner(back(e[0])).endsWith(r`Remove-Item -LiteralPath 'HKCU:\Software\NewKey'`), 'New-Item on the registry: a key');
  is(W(PS(r`Remove-Item HKCU:\Software\X`)), [r`deleted the registry key HKCU:\Software\X and everything in it`], 'Remove-Item on the registry');
  e = W(PS(r`Start-Service wuauserv; Stop-Service -Name Spooler -Force; Stop-Service -DisplayName 'Print Spooler'; Restart-Service x`));
  is(e, ['started the service wuauserv', 'stopped the service Spooler', 'stopped the service Print Spooler', 'restarted the service x'], 'services');
  ok(inner(back(e[0])).endsWith("Stop-Service -Name 'wuauserv'") && inner(back(e[1])).endsWith("Start-Service -Name 'Spooler'") && /not started/.test(e[1].undo.note), 'start <-> stop; -Force said in the note');
  ok(inner(back(e[2])).endsWith("Start-Service -DisplayName 'Print Spooler'") && !e[3].reversible && /nothing to put back/.test(e[3].undo.text), 'by display name; a restart has nothing to put back');
  e = W(PS(r`Set-Service -Name X -StartupType Disabled; Set-Service -Name Y -Status Stopped`));
  ok(e[0].what === 'set the service X to start Disabled' && !e[0].reversible && e[1].what === 'stopped the service Y' && e[1].reversible, 'Set-Service -StartupType (old unknown) and -Status');
  is(W(PS('Get-Service Spooler | Stop-Service')), ['stopped the service Spooler'], 'Get-Service X | Stop-Service: the name comes down the pipeline');
  ok(!W(PS("Get-Service '*sql*' | Stop-Service"))[0].reversible, '...but not a wildcard');
  e = W(PS(r`Get-ChildItem C:\logs -Filter *.log | Remove-Item`));
  ok(e[0].what === r`deleted the items from Get-ChildItem C:\logs -Filter *.log` && !e[0].reversible, 'items down a pipeline: named by where they came from');
  is(W(PS('Stop-Process -Name notepad; kill 1234; spps -Id 5,6')), ['closed the program notepad', 'ended process 1234', 'ended process 5', 'ended process 6'], 'Stop-Process, kill, an array of ids');
  e = W(PS(r`Set-Content -Path C:\x.txt -Value hi; sc C:\y.txt hi; Add-Content C:\z.txt more; Clear-Content C:\w.txt`));
  is(e, [r`wrote C:\x.txt (with Set-Content: what was in it is replaced)`, r`wrote C:\y.txt (with Set-Content: what was in it is replaced)`, r`added to the end of C:\z.txt`, r`emptied C:\w.txt`], 'Set-Content (and its alias sc), Add-Content, Clear-Content');
  is(W(PS(r`'x' | Out-File C:\o.txt; 'x' | Out-File C:\a.txt -Append; 'x' | Tee-Object -FilePath C:\t.txt`)), [r`wrote C:\o.txt (with Out-File: what was in it is replaced)`, r`added to the end of C:\a.txt`, r`wrote C:\t.txt (with Tee-Object: what was in it is replaced)`], 'Out-File, -Append, Tee-Object');
  e = W(PS(r`'x' | Out-File C:\n.txt -NoClobber`));
  ok(e[0].what === r`created the file C:\n.txt` && e[0].reversible && e[0].undo.risky, 'Out-File -NoClobber only makes a new file: that can be taken away');
  is(W(PS(r`Get-Date > C:\z.txt; Get-Date >> C:\z.txt; Get-Date 2> C:\err.txt; Get-Date > $null; Get-Date | Out-Null`)), [r`wrote C:\z.txt (with >: what was in it is replaced)`, r`added to the end of C:\z.txt`, r`wrote C:\err.txt (with >: what was in it is replaced)`], '> >> 2> and $null');
  is(W('sc.exe stop Spooler'), ['stopped the service Spooler'], 'sc.exe in cmd');
  is(W(PS('sc.exe stop Spooler')), ['stopped the service Spooler'], 'sc.exe in PowerShell is the service tool (sc alone is Set-Content)');
  e = W(PS(r`Copy-Item $env:USERPROFILE\a.txt -Destination (Join-Path $env:TEMP 'b.txt')`));
  ok(e[0].what === r`copied $env:USERPROFILE\a.txt to $env:TEMP\b.txt` && inner(back(e[0])).includes(r`$item = ($env:TEMP + '\b.txt')`), '$env:X and Join-Path are worked out');
  is(W(PS(r`$src = 'C:\a.txt'; $dst = \"D:\b\"; Move-Item -LiteralPath $src -Destination $dst`)), [r`moved C:\a.txt to D:\b`], 'variables set to a literal');
  ok(!W(PS(r`Move-Item $x D:\b`))[0].reversible && /variable/.test(W(PS(r`Move-Item $x D:\b`))[0].undo.text), 'a variable it never saw set: not put back, and why');
  ok(!W(PS(r`$f = Get-ChildItem C:\x; Move-Item $f D:\b`))[0].reversible, 'a variable set from a command: not known');
  is(W('powershell -Command "Move-Item \\"$env:TEMP\\a b.txt\\" D:\\x"'), [r`moved $env:TEMP\a b.txt to D:\x`], '\\" inside -Command "..." is a quote to PowerShell');
  is(W(PS('Move-Item "C:\\x\\`$name.txt" D:\\x')), [r`moved C:\x\$name.txt to D:\x`], 'a backtick escapes $ in double quotes');
  is(W(ENC(r`Move-Item 'C:\a.txt' 'D:\b'`)), [r`moved C:\a.txt to D:\b`], '-EncodedCommand is read');
  is(W(r`pwsh -c "Move-Item C:\a.txt D:\b"`), [r`moved C:\a.txt to D:\b`], 'pwsh -c');
  is(W(PS(r`& { Move-Item C:\a.txt D:\b }`)), [r`moved C:\a.txt to D:\b`], '& { ... }');
  e = W(PS(r`if (Test-Path D:\x) { Remove-Item D:\x }; Move-Item C:\a D:\b`));
  ok(e.length === 2 && /^ran a command: if \(Test-Path/.test(e[0].what) && e[1].what === r`moved C:\a to D:\b`, 'if { ... } that may have changed something: a plain entry; what follows still read');
  is(W(PS(r`try { Move-Item C:\a D:\b } catch { Write-Host failed }`)), [r`moved C:\a to D:\b`], 'try { }: the block ran; a catch that only writes is nothing');
  ok(/^ran a command: foreach/.test(W(PS(r`foreach ($f in Get-ChildItem) { Remove-Item $f }`))[0].what), 'foreach that deletes: a plain entry');
  ok(/^ran a command/.test(W(PS('Get-ChildItem | ForEach-Object { Remove-Item $_ }'))[0].what), 'ForEach-Object { Remove-Item }: a plain entry');
  is(W(PS('Get-ChildItem | Where-Object { $_.Length -gt 1MB } | Select-Object Name')), [], 'Where-Object { } that only reads: nothing');
  ok(/^ran a command/.test(W(PS(r`[IO.File]::Delete('C:\x.txt')`))[0].what) && /^ran a command/.test(W(PS(r`(Get-Item C:\x).Delete()`))[0].what), 'a .NET method that may change things: a plain entry');
  ok(/^ran a command/.test(W(PS(r`$f = Get-Item C:\x.txt; $f.IsReadOnly = $true`))[0].what), 'setting a property: a plain entry');
  is(W(PS(r`[IO.Path]::Combine('a', 'b'); Get-Process | Sort-Object CPU; Test-Path C:\x; Write-Host hi`)), [], 'reading: nothing');
  is(W(ENC("# Remove-Item C:\\x\n<# Remove-Item C:\\y #> Get-Date\nMove-Item C:\\a D:\\b `\n  -Force\nRename-Item D:\\b\\a c")), [r`moved C:\a to D:\b`, r`renamed D:\b\a to c`], 'comments, a line continued with `, several lines');
  is(W(ENC("Set-Content C:\\x.txt -Value @'\nRemove-Item C:\\y\n'@\nGet-Date")), [r`wrote C:\x.txt (with Set-Content: what was in it is replaced)`], 'a here-string is text, not commands');
  is(W(PS(r`cd C:\work; Move-Item a.txt b`)), [r`moved C:\work\a.txt to C:\work\b`], 'cd, then relative paths');
  is(W(PS(r`Set-Location C:\w; Push-Location sub; New-Item -ItemType Directory x; Pop-Location; New-Item -ItemType Directory y; cd ..\v; mkdir z`)), [r`created the folder C:\w\sub\x`, r`created the folder C:\w\y`, r`created the folder C:\v\z`], 'Push-Location / Pop-Location, cd ..');
  e = W(PS(r`Move-Item ~\a.txt ~\Documents`));
  ok(e[0].what === r`moved ~\a.txt to ~\Documents` && inner(back(e[0])).includes(r`$back = ($HOME + '\a.txt')`), '~ is $HOME in the undo');
  e = W(PS(r`Move-Item %USERPROFILE%\a.txt D:\x`));
  ok(e[0].what === r`moved %USERPROFILE%\a.txt to D:\x` && inner(back(e[0])).includes(r`$env:USERPROFILE + '\a.txt'`), '%NAME% inside -Command (cmd.exe filled it in) stays a variable');
  is(W(PS(r`Invoke-Expression 'Move-Item C:\a D:\b'`)), [r`moved C:\a to D:\b`], 'Invoke-Expression with a literal: read inside');
  is(W(PS(r`Invoke-WebRequest -Uri https://example.com/x.zip -OutFile C:\dl\x.zip`)), [r`wrote C:\dl\x.zip (with Invoke-WebRequest -OutFile: what was in it is replaced)`], 'Invoke-WebRequest -OutFile');
  is(W(PS('Start-Process notepad')), ['started notepad'], 'Start-Process');
  is(W(PS('Get-ChildItem C:\\; Get-Process; $x = 5; Write-Output $x')), [], 'only reading and a variable: nothing');
  ok(/^ran a command: Enable-NetAdapter/.test(W(PS('Enable-NetAdapter -Name Wi-Fi'))[0].what), 'a cmdlet it does not know: a plain entry');
  ok(/^ran a command/.test(W(PS(r`Move-Item C:\a D:\b -Credential $c`))[0].what), 'another account (-Credential): a plain entry');
  is(W(PS(r`Move-Item C:\a D:\b && Remove-Item C:\c || Rename-Item C:\d e`)), [r`moved C:\a to D:\b`, r`deleted C:\c`, r`renamed C:\d to e`], '&& and || (PowerShell 7) separate statements');
}

// ---- sh -------------------------------------------------------------------------------------------------------
{
  let e = L('mv /home/u/a.txt /home/u/b');
  is(e, ['moved /home/u/a.txt to /home/u/b'], 'mv');
  ok(back(e[0]) === "item='/home/u/b'; if [ -d \"$item\" ] && [ -e \"$item\"'/a.txt' ]; then item=\"$item\"'/a.txt'; fi; back='/home/u/a.txt'; " +
     'if [ -e "$back" ] || [ -L "$back" ]; then echo "$back is already there, so nothing was moved" >&2; exit 1; fi; mv -- "$item" "$back"', 'mv: the undo looks with [ -d ] and never moves over something -> ' + back(e[0]));
  is(L('mv a.txt dir/'), ['moved a.txt to dir/a.txt'], 'a destination ending in / is a folder');
  is(L('mv -t /dst a b'), ['moved a to /dst/a', 'moved b to /dst/b'], 'mv -t');
  is(L('mv a b c/'), ['moved a to c/a', 'moved b to c/b'], 'several sources');
  ok(!back(L('mv -T a b')[0]).includes('[ -d'), 'mv -T: the destination is exact');
  e = L("mv 'it'\\''s here.txt' x");
  ok(e[0].what === "moved it's here.txt to x" && back(e[0]).includes("back='it'\\''s here.txt'"), "'\\'' in, '\\'' out");
  e = L('mv "a b.txt" "$HOME/x"');
  ok(e[0].what === 'moved a b.txt to $HOME/x' && back(e[0]).includes(`item="\${HOME}"'/x'`), '$HOME is carried into the undo');
  e = L('mv ~/a.txt ~/Documents/');
  ok(e[0].what === 'moved ~/a.txt to ~/Documents/a.txt' && back(e[0]).includes(`back="$HOME"'/a.txt'`), '~ is "$HOME"');
  ok(!L('mv *.txt /dst')[0].reversible && /wildcard/.test(L('mv *.txt /dst')[0].undo.text), 'a glob: not put back, and why');
  ok(L("mv '*.txt' /dst")[0].reversible, 'a quoted * is a name');
  ok(!L('mv $(ls) /dst')[0].reversible, 'a command substitution: not known');
  is(L('mv -i -v a b'), ['moved a to b'], 'mv flags');
  e = L('cp a.txt b.txt');
  ok(e[0].reversible && e[0].undo.risky && back(e[0]).endsWith('then rmdir -- "$item"; else rm -- "$item"; fi') && !/rm -r|rm -f/.test(back(e[0])), 'cp: the undo deletes the copy -- never rm -r');
  ok(!L('cp -r src /backup')[0].reversible && !L('cp -a src dst')[0].reversible, 'cp -r / -a: never deleted for you');
  e = L('mkdir -p /opt/a/b');
  ok(e[0].what === 'created the folder /opt/a/b' && back(e[0]) === "rmdir -- '/opt/a/b'" && /may have been there already/.test(e[0].undo.note), 'mkdir -p: rmdir, and the doubt said');
  is(L('mkdir x y'), ['created the folder x', 'created the folder y'], 'mkdir, two');
  e = L('rm -rf /tmp/junk');
  ok(e[0].what === 'deleted /tmp/junk and everything in it' && !e[0].reversible && /^rm deletes for good/.test(e[0].undo.text), 'rm -rf: deleted for good, said plainly');
  e = L('rmdir /tmp/e');
  ok(e[0].what === 'removed the empty folder /tmp/e' && back(e[0]) === "mkdir -- '/tmp/e'", 'rmdir: made again');
  ok(back(L('rmdir -p a/b')[0]) === "mkdir -p -- 'a/b'", 'rmdir -p: mkdir -p');
  ok(!L('touch /x')[0].reversible && /touch either made the file/.test(L('touch /x')[0].undo.text), 'touch: made or only dated -- not known');
  is(L('touch -c /x'), [], 'touch -c never makes a file');
  e = L('ln -s /opt/app/bin/tool /usr/local/bin/');
  ok(e[0].what === 'made a link at /usr/local/bin/tool to /opt/app/bin/tool' && back(e[0]).includes('if [ ! -L "$item" ]') && back(e[0]).endsWith('rm -- "$item"'), 'ln -s: the undo removes only a link');
  ok(!L('ln -sf a b')[0].reversible, 'ln -f replaced something: not put back');
  e = L('systemctl stop nginx; systemctl enable --now redis; systemctl --user start x; systemctl restart sshd; systemctl mask y; systemctl status z');
  is(e, ['stopped the service nginx', 'enabled and started the service redis', 'started the service x (for this user)', 'restarted the service sshd', 'masked the service y'], 'systemctl');
  ok(back(e[0]) === "systemctl start 'nginx'" && back(e[1]) === "systemctl disable --now 'redis'" && back(e[2]) === "systemctl --user stop 'x'" && !e[3].reversible && back(e[4]) === "systemctl unmask 'y'", 'start <-> stop, enable <-> disable (--now), --user, mask <-> unmask');
  is(L('systemctl stop a b'), ['stopped the service a', 'stopped the service b'], 'two units');
  ok(/^ran a command/.test(L('systemctl -H host stop x')[0].what), 'another host: a plain entry');
  ok(back(L('service nginx stop')[0]) === "service 'nginx' start", 'service x stop -> start');
  e = L('sudo systemctl stop nginx');
  ok(back(e[0]) === "sudo -n sh -c 'systemctl start '\\''nginx'\\'''", 'sudo: the undo runs under sudo too -> ' + back(e[0]));
  ok(back(L('sudo -u www mv a b')[0]).startsWith("sudo -n -u 'www' sh -c '"), 'sudo -u: the same user');
  e = L('chmod 755 run.sh; chown -R www /var/www');
  is(e, ['changed the permissions of run.sh to 755', 'changed the owner of /var/www and everything in it to www'], 'chmod, chown');
  ok(e.every((x) => !x.reversible) && /old permissions/.test(e[0].undo.text) && /old owner was not recorded/.test(e[1].undo.text), 'chmod/chown: hints only');
  is(L('kill 1234; kill -0 1; kill -l'), ['ended process 1234'], 'kill; kill -0 and -l only ask');
  ok(!L('pkill firefox')[0].reversible, 'pkill');
  is(L('echo hi > /etc/motd; printf x >> ~/.bashrc; ls > /dev/null 2>&1; ls -R / &> /tmp/log'), ['wrote /etc/motd (with >: what was in it is replaced)', 'added to the end of ~/.bashrc', 'wrote /tmp/log (with >: what was in it is replaced)'], '> >> /dev/null &>');
  is(L('make &> /tmp/log'), ['ran a command: make &> /tmp/log', 'wrote /tmp/log (with >: what was in it is replaced)'], 'a command it cannot name, and the file it wrote');
  is(L("cat > /tmp/conf <<'EOF'\nrm -rf /\nmv a b\nEOF"), ['wrote /tmp/conf (with >: what was in it is replaced)'], 'a here-document is text, not commands');
  is(L('cat <<-EOF > f\n\trm -rf /\n\tEOF\nmv x y'), ['wrote f (with >: what was in it is replaced)', 'moved x to y'], '<<- here-document, then a command');
  is(L('echo x | tee -a /tmp/log'), ['added to the end of /tmp/log'], 'tee -a');
  ok(/kept next to it, with \.bak/.test(L("sed -i.bak 's/a/b/' /etc/x.conf")[0].undo.text) && L("sed -i 's/a/b/' /etc/x.conf")[0].what === 'edited /etc/x.conf in place (sed -i)', 'sed -i, and sed -i.bak');
  is(L("bash -c 'mv /a /b'"), ['moved /a to /b'], 'bash -c');
  is(L('sh -c "mkdir /x && rmdir /y"'), ['created the folder /x', 'removed the empty folder /y'], 'sh -c "..."');
  is(L('env FOO=1 mv a b; nohup mv c d; FOO=1 mv e f; timeout 5 mv g h'), ['moved a to b', 'moved c to d', 'moved e to f', 'moved g to h'], 'env, nohup, VAR=x, timeout');
  is(L('d=/srv/x; mkdir "$d"; mv /tmp/a "$d"/b'), ['created the folder /srv/x', 'moved /tmp/a to /srv/x/b'], 'a variable set to a literal');
  is(L('cd /srv && mv a b && cd .. && mkdir c'), ['moved /srv/a to /srv/b', 'created the folder /c'], 'cd, cd ..');
  is(L('cd sub && mkdir x'), ['created the folder sub/x'], 'cd to a relative folder');
  ok(/^ran a command: if \[ -d x \]/.test(L('if [ -d x ]; then rm -rf x; fi')[0].what), 'if ... fi that deletes: a plain entry');
  ok(/^ran a command: for f in/.test(L('for f in *.log; do rm "$f"; done')[0].what), 'for ... done: a plain entry');
  is(L('if [ -d x ]; then echo yes; fi; ls -la && cat /etc/hosts | grep x'), [], 'only reads: nothing');
  ok(/^ran a command: apt-get install/.test(L('apt-get install -y nginx')[0].what), 'apt-get: a plain entry');
  ok(L("find /tmp -name '*.tmp' -delete")[0].what === 'deleted what find matched' && !L("find /tmp -name '*.tmp' -delete")[0].reversible, 'find -delete');
  is(L("find . -name x; curl https://example.com"), [], 'find and curl that only read');
  ok(/^ran a command/.test(L('curl -o f https://example.com')[0].what), 'curl -o writes a file: a plain entry');
  e = L("mv $'a\\tb' c");
  ok(back(e[0]).includes("back='a\tb'"), "$'...' is decoded, and its tab single-quoted in the undo");
  is(L('mv a\\ b.txt c'), ['moved a b.txt to c'], 'a backslash escapes a space');
  e = L('mv -- -odd.txt x');
  ok(e[0].what === 'moved -odd.txt to x' && back(e[0]).endsWith('mv -- "$item" "$back"'), 'a name starting with - after --');
  is(L("mv '-f' a b"), ['moved a to b'], 'a quoted option is still an option (the shell removes the quotes)');
  // a variable the line set is never taken for the environment's: at undo time it would not be there
  e = L('export D=/srv/x; mkdir "$D/new"');
  ok(e[0].what === 'created the folder /srv/x/new' && back(e[0]) === "rmdir -- '/srv/x/new'", 'export D=literal: known');
  e = L('export D="$HOME/x"; mkdir "$D/new"');
  ok(e[0].what === 'created the folder $HOME/x/new' && back(e[0]) === `rmdir -- "\${HOME}"'/x/new'`, 'export D="$HOME/...": kept with its variable');
  for (const c of ['export D="$(pwd)"; mkdir "$D/new"', 'read d; mkdir "$d"', 'for x in a b; do :; done; mkdir "$x"', 'unset D; mkdir "$D"', 'mkdir /tmp/x$RANDOM', 'mkdir "$PWD/x"'])
    ok(L(c).length === 1 && !L(c)[0].reversible, 'a variable that is not known here is not taken for the environment\'s: ' + c);
  ok(!W(r`md C:\x%RANDOM%`)[0].reversible && !W(r`md %CD%\x`)[0].reversible, '%RANDOM% and %CD% change every time: not carried into an undo');
  ok(back(W(r`md %USERPROFILE%\x`)[0]) === r`rd "%USERPROFILE%\x"`, '%USERPROFILE% is (cmd.exe fills it in the same way for the undo)');
  is(W(r`cd C:\Program Files && md x`), [r`created the folder C:\Program Files\x`], 'cmd: cd takes the rest of the line');
  is(L('cd sub; cd ..; mkdir x'), ['created the folder x'], 'cd sub; cd ..: back where it started');
  ok(back(L('doas mv a b')[0]).startsWith("doas -n sh -c '"), 'doas: the undo runs under doas too');
  // a long, unbalanced line is read quickly and in one piece
  const t0 = Date.now();
  for (const big of ['('.repeat(60000), '"'.repeat(60001), "'".repeat(60001) + 'x', '$('.repeat(30000), 'mv a b; '.repeat(7000), '{'.repeat(60000), '['.repeat(60000), 'if '.repeat(20000)]) {
    W(big); L(big); W(PS(big.slice(0, 7000))); list(rec({ do: 'terminal', input: big }, 'windows'));
  }
  ok(Date.now() - t0 < 5000, 'pathological lines are read in time (' + (Date.now() - t0) + ' ms)');
  const lots = L('mv a b; '.repeat(200));
  ok(lots.length === 40 && lots[39].what === 'made 161 more changes in the same command', 'at most 40 entries for one command; the rest folded into one -> ' + lots.length + ' ' + (lots[39] && lots[39].what));
  const tooMany = L('mv a b; '.repeat(2000));
  ok(tooMany.length === 40 && /^made at least \d+ more changes in the same command$/.test(tooMany[39].what), 'past what it reads, it says "at least" -> ' + (tooMany[39] && tooMany[39].what));
}

// ---- the Terminal: relative paths only where its folder is known ------------------------------------------------
{
  const T = (input, osName, output) => list(rec({ do: 'terminal', input }, osName, { ok: true, output }));
  let e = T('Move-Item a.txt b', 'windows', 'Move-Item a.txt b\r\nPS C:\\Users\\me> ');
  ok(e[0].what === r`moved C:\Users\me\a.txt to C:\Users\me\b` && e[0].reversible && e[0].verb === 'terminal', 'PowerShell\'s prompt says the folder');
  e = T('move a.txt b', 'windows', 'C:\\work>');
  ok(e[0].what === r`moved C:\work\a.txt to C:\work\b`, 'cmd\'s prompt too');
  e = T('Move-Item a.txt b', 'windows', '');
  ok(e[0].what === 'moved a.txt to b' && !e[0].reversible && /Terminal/.test(e[0].undo.text), 'no prompt: relative paths are not put back, and why');
  ok(T(r`Move-Item C:\a.txt D:\b`, 'windows', '')[0].reversible, '...absolute ones are');
  e = T(r`cd C:\x; Move-Item a b`, 'windows', 'PS C:\\x> ');
  ok(e[0].what === r`moved C:\x\a to C:\x\b` && e[0].reversible, 'a cd to an absolute folder in the line: known again');
  ok(!T('cd sub; Move-Item a b', 'windows', 'PS C:\\x\\sub> ')[0].reversible, 'a cd to a relative folder: the start was not known');
  e = T('mv a.txt b/', 'linux', 'me@box:/srv/app$ ');
  ok(e[0].what === 'moved /srv/app/a.txt to /srv/app/b/a.txt' && e[0].reversible, 'a bash prompt with the folder');
  ok(!T('mv a.txt b/', 'linux', 'me@box:~$ ')[0].reversible, 'a ~ prompt: not the same as exec\'s home -- not put back');
  ok(!T(r`Move-Item $env:USERPROFILE\a.txt D:\x`, 'windows', 'PS C:\\x> ')[0].reversible && !T('mv ~/a /tmp/b', 'linux', 'me@box:/srv$ ')[0].reversible,
     'the Terminal\'s own %USERPROFILE% / ~ is not exec\'s (on Windows exec runs as LocalSystem): not put back');
  ok(list(rec({ do: 'terminal', input: 'git push --force', secret: 1 }, 'linux'))[0].what === 'ran a command (its text is private)', 'a secret line');
}

// ---- inverse ----------------------------------------------------------------------------------------------------
{
  const e = W(r`move C:\a.txt D:\x`)[0];
  const inv = undo.inverse(e);
  ok(inv.ok === true && JSON.stringify(Object.keys(inv).sort()) === JSON.stringify(['cmd', 'note', 'ok', 'os', 'risky']) && inv.cmd === e.undo.cmd && inv.os === 'windows' && inv.risky === false, 'inverse: {ok, cmd, os, risky, note}');
  const h = undo.inverse(rec({ do: 'keys', text: 'abc' }, 'linux'));
  ok(h.ok === false && /put back by hand: select what was typed/.test(h.why), 'inverse of a hint: by hand');
  const n = undo.inverse(L('rm -rf /x')[0]);
  ok(n.ok === false && /^c1 cannot be put back: rm deletes for good/.test(n.why), 'inverse of a delete: cannot, and why');
  for (const bad of [null, undefined, 5, 'c1', [], {}, { undo: { kind: 'exec', cmd: '' } }, { undo: { kind: 'exec', cmd: 5 } }, { undo: 'rm -rf /' }])
    ok(undo.inverse(bad).ok === false && typeof undo.inverse(bad).why === 'string', 'inverse of ' + JSON.stringify(bad) + ' -> ok:false with why');
}

// ---- ROUND TRIPS: an undo, recorded, reads as the change the other way; and its undo is the first again -----------
{
  const trip = (label, cmd, osName, want1, want2) => {
    const e1 = list(rec({ do: 'exec', cmd }, osName))[0];
    const i1 = undo.inverse(e1);
    const e2 = i1.ok ? list(rec({ do: 'exec', cmd: i1.cmd }, osName))[0] : null;
    const i2 = e2 ? undo.inverse(e2) : { ok: false };
    const e3 = i2.ok ? list(rec({ do: 'exec', cmd: i2.cmd }, osName))[0] : null;
    ok(e1 && e1.what === want1 && e2 && e2.what === want2 && e2.reversible, 'round trip, ' + label + ': ' + (e1 && e1.what) + ' => ' + (e2 && e2.what));
    ok(e3 && e3.what === (want1.startsWith('moved') ? e3.what : want1) && e3.reversible && i2.cmd !== i1.cmd, 'round trip, ' + label + ': and back again -> ' + (e3 && e3.what));
    return [e1, e2, e3];
  };
  let t = trip('cmd move (a folder?)', r`move "C:\Users\me\a b.txt" D:\Archive`, 'windows', r`moved C:\Users\me\a b.txt to D:\Archive`, r`moved a b.txt from D:\Archive to C:\Users\me\a b.txt`);
  ok(t[2] && t[2].what === t[0].what && inner(back(t[2])).endsWith('Move-Item -LiteralPath $item -Destination $back'), 'the undo of the undo of a move reads as the first move again');
  trip('move into a folder', 'move C:\\a.txt D:\\Archive\\', 'windows', r`moved C:\a.txt to D:\Archive\a.txt`, r`moved D:\Archive\a.txt to C:\a.txt`);
  trip('Move-Item, quotes and %', PS(r`Move-Item -LiteralPath 'C:\x\Bob’’s 100% file.txt' -Destination 'D:\y'`), 'windows', r`moved C:\x\Bob’s 100% file.txt to D:\y`, r`moved Bob’s 100% file.txt from D:\y to C:\x\Bob’s 100% file.txt`);
  trip('Rename-Item', PS(r`Rename-Item -LiteralPath 'C:\d\old.txt' -NewName new.txt`), 'windows', r`renamed C:\d\old.txt to new.txt`, r`renamed C:\d\new.txt to old.txt`);
  trip('%USERPROFILE%', r`move %USERPROFILE%\Desktop\a.txt %USERPROFILE%\Documents`, 'windows', r`moved %USERPROFILE%\Desktop\a.txt to %USERPROFILE%\Documents`, r`moved a.txt from $env:USERPROFILE\Documents to $env:USERPROFILE\Desktop\a.txt`);
  trip('net stop', 'net stop Spooler', 'windows', 'stopped the service Spooler', 'started the service Spooler');
  trip('Stop-Service', PS('Stop-Service -Name Spooler'), 'windows', 'stopped the service Spooler', 'started the service Spooler');
  trip('md', r`md C:\newdir`, 'windows', r`created the folder C:\newdir`, r`removed the empty folder C:\newdir`);
  trip('rd', r`rd C:\emptydir`, 'windows', r`removed the empty folder C:\emptydir`, r`created the folder C:\emptydir`);
  trip('mv (a folder?)', 'mv /home/u/a.txt /home/u/b', 'linux', 'moved /home/u/a.txt to /home/u/b', 'moved a.txt from /home/u/b to /home/u/a.txt');
  trip('mv into a folder', 'mv /home/u/a.txt /home/u/b/', 'linux', 'moved /home/u/a.txt to /home/u/b/a.txt', 'moved /home/u/b/a.txt to /home/u/a.txt');
  trip("mv, a ' in the name", "mv '/srv/it'\\''s.txt' /srv/x", 'linux', "moved /srv/it's.txt to /srv/x", "moved it's.txt from /srv/x to /srv/it's.txt");
  trip('sudo mv (renamed)', 'sudo mv /etc/a.conf /etc/b.conf', 'linux', 'moved /etc/a.conf to /etc/b.conf', 'moved /etc/b.conf to /etc/a.conf');
  trip('~', 'mv ~/a.txt ~/Documents', 'linux', 'moved ~/a.txt to ~/Documents', 'moved a.txt from $HOME/Documents to $HOME/a.txt');
  trip('systemctl --now', 'systemctl disable --now nginx', 'linux', 'disabled and stopped the service nginx', 'enabled and started the service nginx');
  trip('rmdir', 'rmdir /tmp/e', 'linux', 'removed the empty folder /tmp/e', 'created the folder /tmp/e');
  // ANY NAME AT ALL: what PowerShell and sh are handed back is exactly the name that was moved. Read here by an
  // independent reader of each shell's quoting -- not by the code that wrote it.
  const SQC = "'\u2018\u2019\u201A\u201B";
  const psRead = (s, i) => {                                    // '...' (any quote doubled), [char]N, + and ( )
    let out = '', depth = 0;
    for (;;) {
      while (s[i] === ' ') i++;
      if (s[i] === '(') { depth++; i++; continue; }
      if (s[i] === ')' && depth) { depth--; i++; continue; }
      if (s[i] === '+') { i++; continue; }
      if (SQC.includes(s[i])) {
        i++;
        for (;;) { if (i >= s.length) return null; if (SQC.includes(s[i])) { if (SQC.includes(s[i + 1] || '')) { out += s[i]; i += 2; continue; } i++; break; } out += s[i++]; }
        continue;
      }
      const m = /^\[char\](\d+)/.exec(s.slice(i));
      if (m) { out += String.fromCodePoint(+m[1]); i += m[0].length; continue; }
      return depth ? null : out;
    }
  };
  const shRead = (s, i) => {                                    // '...' and \x, up to an unquoted ; or space
    let out = '';
    while (i < s.length) {
      const c = s[i];
      if (c === "'") { const k = s.indexOf("'", i + 1); if (k < 0) return null; out += s.slice(i + 1, k); i = k + 1; continue; }
      if (c === '\\') { out += s[i + 1]; i += 2; continue; }
      if (c === ';' || c === ' ' || c === ']') break;
      out += c; i++;
    }
    return out;
  };
  let seed = 99;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const nasty = ["'", '’', '‘', '‚', '‛', '"', '“', '”', '%', '!', '^', '&', '|', '<', '>', '(', ')', '[', ']', '{', '}', '$', '`', ';', ',', ' ', 'é', '日', '😀', '#', '@', '~', '=', '+', 'a', 'Z', '.', '-', '\t', '\n'];
  let bad = 0;
  const squash = (s) => s.replace(/\s+/g, '');
  for (let i = 0; i < 300; i++) {
    let nm = 'x';
    for (let j = 0, n = 1 + rnd(10); j < n; j++) nm += nasty[rnd(nasty.length)];
    const winName = nm.replace(/["<>|\t\n]/g, '_');            // what Windows allows in a file name
    const w1 = list(rec({ do: 'exec', cmd: ENC('Move-Item -LiteralPath ' + psq('C:\\d\\' + winName) + " -Destination 'D:\\e'") }, 'windows'))[0];
    const s1 = w1 && w1.reversible ? inner(back(w1)) : null;
    const w2 = s1 ? list(rec({ do: 'exec', cmd: back(w1) }, 'windows'))[0] : null;
    if (!s1 || psRead(s1, s1.indexOf('$back = ') + 8) !== 'C:\\d\\' + winName || psRead(s1, s1.lastIndexOf('Join-Path $item ') + 16) !== winName ||
        !w2 || squash(w2.what) !== squash('moved ' + winName + ' from D:\\e to C:\\d\\' + winName)) { bad++; if (bad < 4) console.error('  name: ' + JSON.stringify(winName) + ' -> ' + (s1 || (w1 && w1.what))); }
    const l1 = list(rec({ do: 'exec', cmd: 'mv -- ' + sq('/d/' + nm) + ' /e' }, 'linux'))[0];
    const b1 = l1 && l1.reversible ? back(l1) : null;
    const l2 = b1 ? list(rec({ do: 'exec', cmd: b1 }, 'linux'))[0] : null;
    if (!b1 || shRead(b1, b1.indexOf('back=') + 5) !== '/d/' + nm || shRead(b1, b1.indexOf('[ -e "$item"') + 12) !== '/' + nm ||
        !l2 || squash(l2.what) !== squash('moved ' + nm + ' from /e to /d/' + nm)) { bad++; if (bad < 4) console.error('  name: ' + JSON.stringify(nm) + ' -> ' + b1); }
  }
  ok(bad === 0, 'any name -- quotes of every kind, % ! ^ & $ ` and the rest -- is handed back exactly by the undo, and reads back the same (' + bad + ' were not)');
}

// ---- the summary and the chat list -------------------------------------------------------------------------------
{
  const es = [].concat(W(r`move C:\a.txt D:\x & del C:\b.txt & mkdir D:\y`), list(rec({ do: 'keys', text: 'hello world' }, 'windows', null, { seq: 4, window: 'Untitled - Notepad' })));
  ok(es.map((e) => e.id).join() === 'c1,c2,c3,c4', 'four entries, c1..c4');
  const s = undo.summary(es);
  ok(s.startsWith('I changed 4 things on this machine: moved `C:\\a.txt` to `D:\\x` (c1), deleted `C:\\b.txt` (c2), created the folder `D:\\y` (c3) and 1 more.'), 'summary: what changed, paths as code -> ' + s);
  ok(/c1, c3 and c4 can be put back — say “undo” and its number \(like “undo c1”\), and I will ask before I put anything back; c2 cannot\.$/.test(s), 'summary: which can be put back, which cannot, and how to ask');
  ok(/and 3 more\./.test(undo.summary(es, 1)) && !/and \d+ more/.test(undo.summary(es, 10)), 'summary: max');
  ok(/Each can be put back/.test(undo.summary([es[0], es[2]])) && /None of it can be put back\.$/.test(undo.summary([es[1], es[1]])), 'summary: all, none');
  ok(/^I changed 1 thing on this machine: .*\. It can be put back/.test(undo.summary([es[0]])) && /It cannot be put back\.$/.test(undo.summary([es[1]])), 'summary: one');
  ok(undo.summary([]) === '' && undo.summary(null) === '' && undo.summary('x') === '' && undo.summary([{}, 5]) === '', 'summary: nothing -> \'\'');
  const c = undo.forChat(es).split('\n');
  ok(c.length === 4 && c.every((l) => /^- \*\*c\d\*\* /.test(l)), 'forChat: one Markdown line each');
  ok(c[0] === '- **c1** moved `C:\\a.txt` to `D:\\x` — can be put back', 'forChat: a move -> ' + c[0]);
  ok(c[1] === '- **c2** deleted `C:\\b.txt` — cannot be put back: del does not use the Recycle Bin; restore it from a backup or File History, if there is one', 'forChat: a delete -> ' + c[1]);
  ok(c[2] === '- **c3** created the folder `D:\\y` — can be put back (it deletes what was made)', 'forChat: risky said -> ' + c[2]);
  ok(c[3] === '- **c4** typed 11 characters into “Untitled - Notepad” — by hand: select what was typed and delete it (Ctrl+Z undoes it in most apps)', 'forChat: by hand -> ' + c[3]);
  const d = rec({ do: 'changed', what: 'set *bold* and `code` [link](x) <b>', undo: 'a_b' }, 'linux');
  ok(undo.forChat([d]) === '- **c1** set \\*bold\\* and \\`code\\` \\[link\\](x) \\<b> — by hand: a_b', 'forChat: the driver\'s words cannot turn into Markdown -> ' + undo.forChat([d]));
  const many = [];
  for (let i = 0; i < 25; i++) many.push(rec({ do: 'keys', text: 'x' }, 'linux', null, { seq: i + 1 }));
  const fl = undo.forChat(many).split('\n');
  ok(fl.length === 21 && fl[20] === '- …and 5 more changes', 'forChat: 20 lines at most');
  ok(undo.forChat([]) === '' && undo.forChat(null) === '', 'forChat: nothing -> \'\'');
  const tick = W(PS("Move-Item -LiteralPath 'C:\\a`b.txt' -Destination D:\\x"))[0];
  ok(tick.md.includes('`` C:\\a`b.txt ``'), 'a path with a backtick is still one code span -> ' + tick.md);
}

// ============================================================================================================
// CAPTURE BEFORE CHANGE, offline: what prepare() reads first, and what record() makes of the answers
// ============================================================================================================
const prep = (c, osName, ctx) => undo.prepare({ do: 'exec', cmd: c }, Object.assign({ os: osName, now: NOW, seq: 1, visit: 'v1' }, ctx || {}));
const kindsOf = (p) => (p ? p.captures.map((k) => k.kind + '/' + k.when).join(',') : 'null');
// a capture's answer as the host prints it: noise, then the one JSON line
const answer = (k, o) => ({ id: k.id, ok: !(o && o.ok === false), output: 'Microsoft Windows [Version 10]\r\n' + JSON.stringify(Object.assign({ undo: k.id, ok: true }, o)) + '\r\n' });
const withCaps = (c, osName, captured, ctx) => list(undo.record({ do: 'exec', cmd: c }, { ok: true }, Object.assign({ os: osName, now: NOW, seq: 1, visit: 'v1', captured }, ctx || {})));
const H64 = (ch) => ch.repeat(64);
const safeInCmd = (cmd) => { const sc = inner(cmd); return sc != null && !/["%\r\n\u0000]/.test(sc) && cmd.length <= 8000; };
{
  // ---- what is read first, for what
  const want = [
    ['windows', PS(r`Set-Content -Path C:\x\a.txt -Value hi`), 'backup/before,stamp/after'],
    ['windows', r`echo hi > C:\x\a.txt`, 'backup/before,stamp/after'],
    ['windows', PS(r`'x' | Out-File C:\x\a.txt; Add-Content C:\x\b.txt more; Clear-Content C:\x\c.txt`), 'backup/before,stamp/after,backup/before,stamp/after,backup/before,stamp/after'],
    ['windows', r`del C:\x\a.txt`, 'backup/before'],
    ['windows', PS(r`Remove-Item -Recurse -Force C:\x\a`), 'backup/before'],
    ['windows', r`copy /Y C:\a.txt C:\b.txt`, 'backup/before,stamp/after'],
    ['windows', PS(r`Copy-Item -Force C:\a.txt D:\dir`), 'backup/before,stamp/after'],
    ['windows', r`move /Y C:\a.txt C:\b.txt`, 'backup/before'],
    ['windows', PS(r`New-Item -Force -ItemType File C:\x\f.txt`), 'backup/before,stamp/after'],
    ['windows', PS(r`New-Item -Force -ItemType Directory C:\x\d`), 'exists/before'],
    ['windows', r`reg add HKCU\Software\X /v N /d 1 /f`, 'value/before,value/after'],
    ['windows', PS(r`Set-ItemProperty -Path HKCU:\Software\X -Name N -Value 1`), 'value/before,value/after'],
    ['windows', PS(r`New-ItemProperty -Path HKCU:\Software\X -Name N -Value 1 -Force`), 'value/before,value/after'],
    ['windows', r`reg delete HKLM\Software\X /v N /f /reg:64`, 'value/before'],
    ['windows', PS(r`Remove-ItemProperty -Path HKCU:\Software\X -Name N`), 'value/before'],
    ['windows', r`reg add HKCU\Software\X`, 'exists/before'],
    ['windows', PS('Set-Service -Name Spooler -StartupType Disabled'), 'value/before,value/after'],
    ['windows', 'sc config Spooler start= disabled', 'value/before,value/after'],
    ['windows', r`icacls C:\x\a.txt /grant *S-1-1-0:R`, 'value/before,value/after'],
    ['windows', r`echo a > C:\x\f.txt & echo b >> C:\x\f.txt`, 'backup/before,stamp/after'],
    ['linux', 'echo hi > /srv/a.txt', 'backup/before,stamp/after'],
    ['linux', "sed -i 's/a/b/' /etc/x.conf; truncate -s 0 /srv/a.log", 'backup/before,stamp/after,backup/before,stamp/after'],
    ['linux', 'rm /srv/a.txt', 'backup/before'],
    ['linux', 'cp a.txt b.txt', 'backup/before,stamp/after'],
    ['linux', 'mv a.txt b.txt', 'backup/before'],
    ['linux', 'touch /srv/a', 'backup/before,stamp/after'],
    ['linux', 'mkdir -p /srv/a/b', 'exists/before'],
    ['linux', 'chmod 600 /srv/a; chown www:www /srv/b', 'value/before,value/after,value/before,value/after'],
    ['linux', 'systemctl enable --now nginx', 'value/before,value/after'],
    ['linux', 'sudo systemctl disable nginx; sudo tee /etc/motd', 'value/before,value/after,backup/before,stamp/after'],
  ];
  for (const [o, c, k] of want) ok(kindsOf(prep(c, o)) === k, 'prepare ' + o + ': ' + c + ' -> ' + kindsOf(prep(c, o)) + ' (want ' + k + ')');
  for (const [o, c] of [['windows', 'dir C:\\'], ['windows', r`md C:\y`], ['windows', r`rd /s /q C:\y`], ['windows', r`del /s C:\x\a.tmp`], ['windows', PS(r`Remove-Item C:\x\*.txt`)],
    ['windows', PS(r`Get-ChildItem C:\x | Remove-Item`)], ['windows', PS(r`Set-Content -Path $f -Value 1`)], ['windows', r`icacls C:\x /T /grant *S-1-1-0:R`], ['windows', r`icacls C:\x\*.txt /grant *S-1-1-0:R`],
    ['windows', r`reg delete HKCU\Software\X /va /f`], ['windows', r`reg delete HKCU\Software\X /f`], ['windows', 'net stop Spooler'], ['windows', PS(r`'x' | Out-File C:\n.txt -NoClobber`)],
    ['windows', PS(r`New-Item -ItemType File C:\x\new.txt`)], ['windows', 'taskkill /IM notepad.exe'], ['linux', 'rm -rf $(pwd)/x'], ['linux', 'chmod -R 755 /srv'], ['linux', 'mkdir /srv/new'],
    ['linux', 'mv *.txt /dst'], ['linux', 'sudo cp a ~/b'], ['linux', 'sudo rm "$HOME/x"'], ['linux', 'git pull'], ['linux', 'systemctl restart nginx'], ['linux', 'cat /etc/hosts']])
    ok(prep(c, o) === null, 'nothing to read first: ' + c);
  ok(undo.prepare({ do: 'terminal', input: 'echo hi > /srv/a' }, { os: 'linux' }) === null && undo.prepare({ do: 'keys', text: 'x' }, {}) === null, 'a Terminal line and typing: nothing prepared');
  // the shape of a capture
  let p = prep(PS(r`Set-Content -Path C:\x\a.txt -Value hi`), 'windows');
  const k0 = p.captures[0];
  ok(JSON.stringify(Object.keys(k0)) === JSON.stringify(['id', 'kind', 'when', 'os', 'cmd', 'what', 'maxBytes']) && JSON.stringify(Object.keys(p.captures[1])) === JSON.stringify(['id', 'kind', 'when', 'os', 'cmd', 'what']),
    'a capture is {id, kind, when, os, cmd, what, maxBytes?}');
  ok(p.captures.every((k) => /^k\d+-[0-9a-f]{8}$/.test(k.id)) && k0.os === 'windows' && k0.maxBytes === 16 * 1024 * 1024, 'ids k<n>-<8 hex>; the cap 16 MB unless set');
  ok(/^keep a copy of C:\\x\\a\.txt, if it is a file of at most 16 MB, before the command changes it$/.test(k0.what) && /^read what is at C:\\x\\a\.txt after the command/.test(p.captures[1].what), 'what each does, in a sentence -> ' + k0.what);
  ok(JSON.stringify(prep(PS(r`Set-Content -Path C:\x\a.txt -Value hi`), 'windows')) === JSON.stringify(p), 'the same command, the same captures (record() finds them again by id)');
  ok(prep('echo a > /x/a', 'linux').captures[0].id !== prep('echo a > /x/b', 'linux').captures[0].id, 'an id names what it reads: another file, another id');
  ok(prep('echo a > /x/a', 'linux', { maxBytes: 1000 }).captures[0].maxBytes === 1000 && prep('echo a > /x/a', 'linux', { maxBytes: 1e12 }).captures[0].maxBytes === 64 * 1024 * 1024 &&
     prep('echo a > /x/a', 'linux', { maxBytes: -5 }).captures[0].maxBytes === 0 && prep('echo a > /x/a', 'linux', { maxBytes: 'x' }).captures[0].maxBytes === 16 * 1024 * 1024, 'ctx.maxBytes moves the cap, never past 64 MB');
  ok(prep('echo a > /x/a', 'linux', { visit: 'abc-1' }).captures[0].cmd.includes('/abc-1') && prep('echo a > /x/a', 'linux', { visit: 'a/../b' }).captures[0].cmd.includes('/visit') &&
     prep('echo a > /x/a', 'linux', { visit: "x'; rm -rf /" }).captures[0].cmd.includes('/visit'), 'ctx.visit names the folder; anything but [A-Za-z0-9_-] is not used');
  // every Windows capture: one line, nothing in it cmd.exe would act on; every one inside 8,000 characters
  let unsafe = 0, longest = 0;
  for (const [o, c] of want) for (const k of prep(c, o).captures) { longest = Math.max(longest, k.cmd.length); if (o === 'windows' ? !safeInCmd(k.cmd) : /[\r\n\u0000]/.test(k.cmd)) unsafe++; }
  ok(unsafe === 0 && longest <= 8000, 'every capture is one line, safe inside cmd.exe\'s quotes (' + unsafe + ' not), the longest ' + longest + ' characters');
  const nasty = prep(ENC('Set-Content -LiteralPath ' + psq('C:\\d\\Bob’s 100% "x" & y.txt') + ' -Value 1'), 'windows');
  ok(nasty && nasty.captures.every((k) => safeInCmd(k.cmd)) && inner(nasty.captures[0].cmd).includes("Bob’’s 100' + [char]37 + ' ' + [char]34 + 'x' + [char]34 + ' & y.txt"), 'a name with ’ % " &: quoted as every undo is');
  ok(prep(PS('Set-Content -LiteralPath C:\\' + 'x'.repeat(7900) + ' -Value 1'), 'windows') === null, 'a capture that would not fit one command line is not offered');
  // never throws, and every capture has its shape
  let threw = 0, shapes = 0;
  const alphabet = ['a', ' ', '/', '\\', 'C:\\', '"', "'", '’', '`', '$', '%', '&', '|', ';', '(', ')', '{', '}', '*', '>', '>>', '\n', '~', '-', 'echo x > ', 'del ', 'rm ', 'cp a ', 'Set-Content ',
    'reg add HKCU\\X /v N /f ', 'icacls ', '/grant ', 'chmod 600 ', 'mkdir -p ', 'sc config s start= auto ', 'systemctl enable ', 'touch ', 'mv a ', 'sudo ', '$env:', '%TEMP%', 'é', '\u0000'];
  let seed = 4242;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 1500; i++) {
    let s = '';
    for (let j = 0, n = 1 + rnd(10); j < n; j++) s += alphabet[rnd(alphabet.length)];
    for (const o of ['windows', 'linux', '']) {
      try {
        const q = undo.prepare({ do: 'exec', cmd: s }, { os: o, visit: 'v' });
        for (const k of q ? q.captures : []) {
          if (!/^k\d+-[0-9a-f]{8}$/.test(k.id) || typeof k.cmd !== 'string' || !k.cmd || k.cmd.length > 8000 || typeof k.what !== 'string') shapes++;
          if (k.os === 'windows' && !safeInCmd(k.cmd)) shapes++;
        }
        // and record() with answers of every wrong shape
        const junk = (q ? q.captures : []).map((k, j) => ({ id: k.id, ok: rnd(2) === 0, output: [null, '', '{', JSON.stringify({ undo: k.id, ok: true, was: 'file', size: -1, in: 1, at: 5, sig: 7 }), JSON.stringify({ undo: k.id }), JSON.stringify({ undo: k.id, ok: true, was: 'file', size: 3, hash: 'x', bak: '../../etc/passwd', crc: '1', at: { was: 'file' } })][(j + i) % 6] }));
        for (const x of list(undo.record({ do: 'exec', cmd: s }, { ok: true }, { os: o, captured: junk.concat([5, null, { id: 'k1-00000000' }]) }))) {
          if (typeof x.what !== 'string' || typeof x.reversible !== 'boolean') shapes++;
          if (x.undo && x.undo.kind === 'exec' && x.undo.os === 'windows' && /^powershell /.test(x.undo.cmd) && !safeInCmd(x.undo.cmd)) shapes++;
        }
      } catch (e) { threw++; if (threw < 4) console.error('  threw on ' + JSON.stringify(s) + ': ' + e.stack); }
    }
  }
  ok(threw === 0 && shapes === 0, 'prepare and record with any captured answer never throw, and keep their shapes (' + threw + ' threw, ' + shapes + ' misshapen)');
}
{
  // ---- record() with the answers: a file -------------------------------------------------------------------------
  const WBAK = (k, o) => answer(k, Object.assign({ in: 0, full: 'C:\\x\\a.txt', was: 'file', size: 8, attr: 33, ct: '133000000000000000', wt: '133000000000000001',
    bak: 'C:\\Windows\\Temp\\agent-drive-undo\\v1\\' + k.id + '-0123456789ab.bak', hash: H64('A') }, o));
  const LEFT = { was: 'file', size: 9, attr: 32, ct: '133000000000000000', wt: '133000000000000009', hash: H64('B') };
  const stamp = (k, at, inn) => answer(k, { full: 'C:\\x\\a.txt', at, inn });
  let c = PS(r`Set-Content -Path C:\x\a.txt -Value hi`);
  let p = prep(c, 'windows');
  let e = withCaps(c, 'windows', [WBAK(p.captures[0]), stamp(p.captures[1], LEFT)]);
  let sc = inner(back(e[0]));
  ok(e.length === 1 && e[0].what === r`wrote C:\x\a.txt (with Set-Content: what was in it is replaced)` && e[0].reversible && !e[0].undo.risky, 'an overwrite, read before and after: it can be put back -> ' + e[0].what);
  ok(sc.includes(H64('A')) && sc.includes(H64('B')) && sc.includes('($i.Length -ne 9)') && sc.includes("$w=[IO.File]::Open($t,'Open','Write','None')") && sc.includes('FromFileTimeUtc(133000000000000001)') &&
     sc.includes('[IO.FileAttributes]33') && sc.indexOf(H64('A')) < sc.indexOf(H64('B')) && sc.indexOf(H64('B')) < sc.indexOf('SetLength(0)'), 'the restore: the copy checked against its hash, the file against what was left, then the same bytes written, its time and attributes back');
  ok(/^puts back what C:\\x\\a\.txt held before \(8 bytes, from the copy kept of it\) — only if it is still exactly as this change left it$/.test(e[0].undo.note) && safeInCmd(back(e[0])), 'its note -> ' + e[0].undo.note);
  ok(JSON.stringify(e[0].backup) === JSON.stringify({ os: 'windows', path: 'C:\\Windows\\Temp\\agent-drive-undo\\v1\\' + p.captures[0].id + '-0123456789ab.bak', bytes: 8 }) &&
     JSON.stringify(e[0].paths) === JSON.stringify({ os: 'windows', made: [r`C:\x\a.txt`] }), 'backup: where the copy is (for cleanup); paths: where it changed');
  ok(JSON.stringify(withCaps(c, 'windows', [])) === JSON.stringify(W(c)) && JSON.stringify(withCaps(c, 'windows', [{ id: 'k9-00000000', ok: true, output: '{}' }])) === JSON.stringify(W(c)), 'no answers, or none of its own: as without');
  // the 'after' read missing: the copy is kept, said where, but nothing is put back for you
  e = withCaps(c, 'windows', [WBAK(p.captures[0])]);
  ok(!e[0].reversible && e[0].undo.kind === 'hint' && e[0].undo.text.includes('a copy of what was there before is kept at C:\\Windows\\Temp\\agent-drive-undo\\v1\\') && /what the command left was not read/.test(e[0].undo.text) && e[0].backup, 'no after read: not put back for you; where the copy is -> ' + e[0].undo.text);
  // the same bytes after as before: no change at all
  ok(undo.record({ do: 'exec', cmd: c }, { ok: true }, { os: 'windows', captured: [WBAK(p.captures[0]), stamp(p.captures[1], { was: 'file', size: 8, attr: 33, ct: '133000000000000000', wt: '133000000000000001', hash: H64('A') })] }) === null,
    'the same bytes and time after as before: no change, no entry');
  // nothing was there: it CREATED the file -- deleted, only if still as made
  c = r`echo hi > C:\x\new.txt`;
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [answer(p.captures[0], { in: 0, was: 'none' }), stamp(p.captures[1], LEFT)]);
  ok(e[0].what === r`created the file C:\x\new.txt (with >)` && e[0].reversible && e[0].undo.risky && inner(back(e[0])).endsWith('[IO.File]::Delete($t)') && inner(back(e[0])).includes(H64('B')) && !e[0].backup,
    'nothing was there: "created the file", its undo deletes it only if unchanged -> ' + e[0].what);
  ok(undo.record({ do: 'exec', cmd: c }, { ok: true }, { os: 'windows', captured: [answer(p.captures[0], { in: 0, was: 'none' }), stamp(p.captures[1], { was: 'none' })] }) === null, 'nothing there before or after: no entry');
  // a delete: made again from the copy, only if nothing is there
  c = r`del C:\x\a.txt`;
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [WBAK(p.captures[0])]);
  sc = inner(back(e[0]));
  ok(e[0].what === r`deleted C:\x\a.txt` && e[0].reversible && !e[0].undo.risky && sc.includes("is there again") && sc.includes("'CreateNew'") && sc.includes('SetCreationTimeUtc') && /only if nothing is there now$/.test(e[0].undo.note),
    'a delete: made again from its copy (CreateNew, times, attributes), never over anything');
  ok(undo.record({ do: 'exec', cmd: c }, { ok: true }, { os: 'windows', captured: [answer(p.captures[0], { in: 0, was: 'none' })] }) === null, 'a delete of nothing: no entry');
  // what is never copied, and why
  const why = (o) => { const x = withCaps(c, 'windows', [answer(p.captures[0], o)])[0]; return x.reversible ? 'REVERSIBLE' : x.undo.text; };
  ok(/^del does not use the Recycle Bin — .* \(no copy was kept: it was 40 MB, over the 16 MB a copy is kept of\)$/.test(why({ in: 0, was: 'file', size: 40 * 1048576, attr: 32, ct: '1', wt: '1', skip: 'big', cap: 16 * 1048576 })), 'too big: said, with the cap -> ' + why({ in: 0, was: 'file', size: 40 * 1048576, attr: 32, ct: '1', wt: '1', skip: 'big', cap: 16777216 }));
  ok(/no copy was kept: it was a folder, and a folder is never copied/.test(why({ in: 0, was: 'dir' })) && /no copy was kept: it was a link/.test(why({ in: 0, was: 'link' })), 'a folder, a link: never copied, said');
  ok(/not this account’s alone/.test(why({ in: 0, was: 'file', size: 3, attr: 32, ct: '1', wt: '1', skip: 'unsafe' })) && /already fill the 256 MB/.test(why({ in: 0, was: 'file', size: 3, attr: 32, ct: '1', wt: '1', skip: 'full' })), 'an unsafe folder, a full visit: said');
  ok(/no copy of it was kept: Access to the path is denied\.\)$/.test(why({ ok: false, why: 'Access to the path is denied.' })), 'a capture that failed: its why');
  ok(/no copy of it was kept: its answer could not be read \(powershell is not recognized\)\)$/.test(withCaps(c, 'windows', [{ id: p.captures[0].id, ok: false, output: 'powershell is not recognized\r\n' }])[0].undo.text), 'an answer with no JSON: what it said instead');
  ok(/no copy of it was kept: its answer could not be read\)$/.test(why({ in: 0, was: 'file', size: 3, attr: 32, ct: '1', wt: '1', bak: 'C:\\elsewhere\\x.bak', hash: 'zz' }).replace('REVERSIBLE', '')) || why({ in: 0, was: 'file', size: 3, attr: 32, ct: '1', wt: '1', bak: 'C:\\elsewhere\\x.bak', hash: H64('A') }) !== 'REVERSIBLE',
    'a kept copy not in a copies folder, or with no hash, is not put back from');
  // a copy INTO a folder, over a file there: the answer says which (in:1), and that is what is put back
  c = PS(r`Copy-Item -Force C:\src\a.txt D:\dir`);
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [WBAK(p.captures[0], { in: 1, full: r`D:\dir\a.txt` }), stamp(p.captures[1], { was: 'dir' }, LEFT)]);
  ok(e[0].what === r`copied C:\src\a.txt to D:\dir, replacing the file that was there` && e[0].reversible && inner(back(e[0])).includes(r`$t='D:\dir\a.txt'`) && JSON.stringify(e[0].paths.made) === JSON.stringify([r`D:\dir\a.txt`]),
    'a copy into a folder, over a file: put back exactly there -> ' + e[0].what);
  // a move that replaced a file: moved back, then the replaced one put back
  c = r`move /Y C:\a.txt C:\b.txt`;
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [WBAK(p.captures[0], { full: r`C:\b.txt` })]);
  sc = inner(back(e[0]));
  ok(e[0].what === r`moved C:\a.txt to C:\b.txt, replacing the file that was there` && e[0].reversible && sc.indexOf('Move-Item -LiteralPath $t -Destination $back') < sc.indexOf("'CreateNew'") && sc.indexOf(H64('A')) < sc.indexOf('Move-Item'),
    'a move over a file: the copy checked first, the move moved back, then the file it replaced put back');
  ok(JSON.stringify(withCaps(c, 'windows', [answer(p.captures[0], { in: 0, was: 'none' })]).map((x) => [x.what, back(x)])) === JSON.stringify(W(c).map((x) => [x.what, back(x)])), 'a move that replaced nothing: its own undo');
  // two changes to one file in one command: the last carries the undo, the first is put back with it
  c = r`echo a > C:\x\f.txt & echo b >> C:\x\f.txt`;
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [WBAK(p.captures[0]), stamp(p.captures[1], LEFT)]);
  ok(e.length === 2 && !e[0].reversible && /the same command changed it again after this/.test(e[0].undo.text) && e[1].what === r`added to the end of C:\x\f.txt` && e[1].reversible, 'two changes to one file: the last puts back both');
  // Linux: the same, with sh and cksum
  const LBAK = (k, o) => answer(k, Object.assign({ was: 'file', in: 0, size: 8, crc: '123', mode: '-rwsr-x--T', uid: 1000, gid: 100, bak: '/tmp/agent-drive-undo-1000/v1/' + k.id + '-AbCdEf123456' }, o));
  c = "echo hi > '/srv/it'\\''s.txt'";
  p = prep(c, 'linux');
  e = withCaps(c, 'linux', [LBAK(p.captures[0]), answer(p.captures[1], { at: { was: 'file', crc: '456', size: '9' }, inn: null })]);
  ok(e[0].reversible && back(e[0]) === "t='/srv/it'\\''s.txt'; b='/tmp/agent-drive-undo-1000/v1/" + p.captures[0].id + "-AbCdEf123456'; " +
     '[ -f "$b" ] || { echo "the copy kept of it ($b) is gone, so nothing was put back" >&2; exit 1; }; [ "$(cksum < "$b")" = \'123 8\' ] || { echo "the copy kept of it ($b) is not what was kept, so nothing was put back" >&2; exit 1; }; ' +
     'if [ -L "$t" ] || [ ! -f "$t" ] || [ "$(cksum < "$t")" != \'456 9\' ]; then echo "$t was changed again after this change, so it was left as it is" >&2; exit 1; fi; cat < "$b" > "$t" && touch -r "$b" "$t" && chmod 5750 -- "$t"',
     'sh: the copy checked by cksum, the file against what was left, then put back with its mode (-rwsr-x--T is 5750) -> ' + back(e[0]));
  c = 'sudo rm /etc/x.conf';
  p = prep(c, 'linux');
  e = withCaps(c, 'linux', [LBAK(p.captures[0])]);
  ok(e[0].reversible && back(e[0]).startsWith("sudo -n sh -c '") && back(e[0]).includes('set -C') && back(e[0]).includes("chown 1000:100 -- \"$t\"") && e[0].backup.sudo && e[0].backup.sudo.tool === 'sudo', 'sudo rm: made again under sudo, owner too; its copy noted as made under sudo');
  ok(p.captures[0].cmd.startsWith("sudo -n sh -c '"), 'and the capture ran under sudo as well');
  c = 'touch /srv/a';
  p = prep(c, 'linux');
  e = withCaps(c, 'linux', [LBAK(p.captures[0]), answer(p.captures[1], { at: { was: 'file', crc: '123', size: '8' }, inn: null })]);
  ok(e[0].what === 'changed the date of /srv/a (touch)' && e[0].reversible, 'touch of a file that was there: only its date -- put back');
  e = withCaps(c, 'linux', [answer(p.captures[0], { was: 'none', in: 0 }), answer(p.captures[1], { at: { was: 'file', crc: '4294967295', size: '0' }, inn: null })]);
  ok(e[0].what === 'created the file /srv/a (touch)' && e[0].undo.risky && back(e[0]).endsWith('rm -f -- "$t"'), 'touch where nothing was: it made the file');
}
{
  // ---- record() with the answers: the registry, services, units, permissions ---------------------------------------
  let c = r`reg add HKCU\Software\X /v N /t REG_DWORD /d 5 /f`;
  let p = prep(c, 'windows');
  ok(/^read the registry value N in HKEY_CURRENT_USER\\Software\\X before the command changes it$/.test(p.captures[0].what) && p.captures.every((k) => safeInCmd(k.cmd)), 'a registry value: read before and after -> ' + p.captures[0].what);
  const val = (k, o) => answer(k, Object.assign({ key: 1, sig: H64('C'), type: 'DWord', count: 0, data: 'AQAAAA==' }, o));
  let e = withCaps(c, 'windows', [val(p.captures[0]), val(p.captures[1], { sig: H64('D') })]);
  let sc = inner(back(e[0]));
  ok(e[0].what === r`set the registry value N in HKCU\Software\X` && e[0].reversible && !e[0].undo.risky && sc.includes("if ((Sg $k $n) -ne '" + H64('D') + "')") && sc.includes("$k.SetValue($n,[BitConverter]::ToInt32([Convert]::FromBase64String('AQAAAA=='),0),'DWord')"),
    'set: back to its old type and data, only if it is still what was set');
  e = withCaps(c, 'windows', [val(p.captures[0], { key: 0, sig: '-' }), val(p.captures[1], { sig: H64('D') })]);
  sc = inner(back(e[0]));
  ok(e[0].what === r`added the registry value N to HKEY_CURRENT_USER\Software\X (and made the key)` && e[0].undo.risky && sc.includes('$k.DeleteValue($n)') && sc.includes("$h.DeleteSubKey('Software\\X')"),
    'added, with the key: deleted again, and the key if nothing else is in it -> ' + e[0].what);
  ok(undo.record({ do: 'exec', cmd: c }, { ok: true }, { os: 'windows', captured: [val(p.captures[0]), val(p.captures[1])] }) === null, 'set to the value it had: no entry');
  for (const [type, data, n, expr] of [['String', 'aABpAA==', 0, "[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('aABpAA=='))"], ['ExpandString', 'JQA=', 0, "[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('JQA='))"],
    ['MultiString', 'YQAAAGIA', 2, "[string[]]([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('YQAAAGIA')).Split([char]0))"], ['MultiString', '', 0, '[string[]]@()'],
    ['QWord', 'AQAAAAAAAAA=', 0, "[BitConverter]::ToInt64([Convert]::FromBase64String('AQAAAAAAAAA='),0)"], ['Binary', 'AP8=', 0, "[Convert]::FromBase64String('AP8=')"]]) {
    e = withCaps(c, 'windows', [val(p.captures[0], { type, data, count: n }), val(p.captures[1], { sig: H64('D') })]);
    ok(inner(back(e[0])).includes('$k.SetValue($n,' + expr + ",'" + type + "')"), 'a ' + type + ' value goes back as itself');
  }
  ok(/a type \(Unknown\) this cannot write back/.test(withCaps(c, 'windows', [val(p.captures[0], { type: 'Unknown' }), val(p.captures[1], { sig: H64('D') })])[0].undo.text) &&
     /over 4 KB/.test(withCaps(c, 'windows', [val(p.captures[0], { data: undefined, skip: 'long' }), val(p.captures[1], { sig: H64('D') })])[0].undo.text), 'a type it cannot write, a value over 4 KB: said');
  ok(!withCaps(c, 'windows', [val(p.captures[0])])[0].reversible, 'no after read: not set back for you');
  c = PS(r`Remove-ItemProperty -Path HKCU:\Software\X -Name N`);
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [val(p.captures[0])]);
  ok(e[0].what === r`deleted the registry value N in HKCU:\Software\X` && e[0].reversible && inner(back(e[0])).includes("if ((Sg $k $n) -ne '-')") && /only if it has no value now$/.test(e[0].undo.note), 'a deleted value: put back, only if there is none now');
  c = r`reg add HKCU\Software\New`;
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [answer(p.captures[0], { was: 'none' })]);
  ok(e[0].what === r`created the registry key HKEY_CURRENT_USER\Software\New` && e[0].reversible && /only while nothing is in it/.test(e[0].undo.note), 'reg add of a new key: deleted again while empty');
  ok(undo.record({ do: 'exec', cmd: c }, { ok: true }, { os: 'windows', captured: [answer(p.captures[0], { was: 'key' })] }) === null, 'reg add of a key that was there: no entry');
  c = 'sc config Spooler start= disabled';
  p = prep(c, 'windows');
  e = withCaps(c, 'windows', [answer(p.captures[0], { name: 'Spooler', start: 2, delayed: 1 }), answer(p.captures[1], { name: 'Spooler', start: 4, delayed: 0 })]);
  sc = inner(back(e[0]));
  ok(e[0].what === 'set the service Spooler to start disabled (it was Automatic (Delayed Start))' && e[0].reversible && sc.includes('& sc.exe config $n start= delayed-auto') && sc.includes("-ne 4) -or ([int]$k.GetValue('DelayedAutostart',0) -ne 0)"),
    'a startup type: set back with sc.exe, only if still as left -> ' + e[0].what);
  ok(undo.record({ do: 'exec', cmd: c }, { ok: true }, { os: 'windows', captured: [answer(p.captures[0], { name: 'Spooler', start: 4 }), answer(p.captures[1], { name: 'Spooler', start: 4 })] }) === null, 'a startup type set to what it was: no entry');
  c = 'systemctl enable --now nginx';
  p = prep(c, 'linux');
  const unit = (k, en, act) => answer(k, { enabled: en, active: act });
  e = withCaps(c, 'linux', [unit(p.captures[0], 'disabled', 'inactive'), unit(p.captures[1], 'enabled', 'active')]);
  ok(e[0].reversible && back(e[0]) === "u='nginx'; e=$(systemctl is-enabled \"$u\" 2>/dev/null); if [ \"$e\" != 'enabled' ]; then echo \"the service $u was changed again after this change, so it was left as it is\" >&2; exit 1; fi; " +
     "x=$(systemctl is-active \"$u\" 2>/dev/null); if [ \"$x\" != 'active' ]; then echo \"the service $u was started or stopped again after this change, so it was left as it is\" >&2; exit 1; fi; systemctl disable \"$u\" || exit 1; systemctl stop \"$u\"",
     'systemctl enable --now: disabled and stopped again, only if still as left -> ' + back(e[0]));
  e = withCaps(c, 'linux', [unit(p.captures[0], 'disabled', 'active'), unit(p.captures[1], 'enabled', 'active')]);
  ok(back(e[0]).endsWith('systemctl disable "$u" || exit 1') && /^disables nginx again \(it was disabled\)/.test(e[0].undo.note), 'it was running already: only disabled again, not stopped');
  ok(undo.record({ do: 'exec', cmd: c }, { ok: true }, { os: 'linux', captured: [unit(p.captures[0], 'enabled', 'active'), unit(p.captures[1], 'enabled', 'active')] }) === null, 'enabled and running already: no entry');
  ok(JSON.stringify(withCaps(c, 'linux', [unit(p.captures[0], 'unknown', 'unknown'), unit(p.captures[1], 'enabled', 'active')]).map(back)) === JSON.stringify(L(c).map(back)), 'a state it could not read: the undo as without');
  ok(/it was static before/.test(withCaps('systemctl disable x', 'linux', prep('systemctl disable x', 'linux').captures.map((k, j) => unit(k, j ? 'disabled' : 'static', 'active')))[0].undo.text), 'a state no single command sets back: said');
  c = 'chmod 600 /srv/run.sh';
  p = prep(c, 'linux');
  const mode = (k, m, u) => answer(k, { mode: m, uid: String(u), gid: '100' });
  e = withCaps(c, 'linux', [mode(p.captures[0], '-rwxr-xr-x', 1000), mode(p.captures[1], '-rw-------', 1000)]);
  ok(e[0].what === 'changed the permissions of /srv/run.sh to 600 (it was 755)' && back(e[0]).endsWith("chmod 0755 -- \"$p\"") && back(e[0]).includes("'-rw------- 1000 100'") && !back(e[0]).includes('chown'), 'chmod: set back, only if still as left');
  c = 'chown www /srv/run.sh';
  p = prep(c, 'linux');
  e = withCaps(c, 'linux', [mode(p.captures[0], '-rwsr-xr-x', 0), mode(p.captures[1], '-rwxr-xr-x', 33)]);
  ok(back(e[0]).includes('chown 0:100 -- "$p" || exit 1; chmod 4755 -- "$p"'), 'chown: owner back, then the mode (chown clears setuid)');
  c = r`icacls C:\x\a.txt /grant *S-1-1-0:R`;
  p = prep(c, 'windows');
  const acl = (k, sddl, owner) => answer(k, { full: r`C:\x\a.txt`, dir: 0, sddl, owner });
  e = withCaps(c, 'windows', [acl(p.captures[0], 'D:AI(A;ID;FA;;;SY)', 'S-1-5-32-544'), acl(p.captures[1], 'D:AI(A;;FR;;;WD)(A;ID;FA;;;SY)', 'S-1-5-32-544')]);
  sc = inner(back(e[0]));
  ok(e.length === 1 && e[0].what === r`changed the permissions of C:\x\a.txt (icacls)` && e[0].reversible && sc.includes("$n.SetSecurityDescriptorSddlForm('D:AI(A;ID;FA;;;SY)','Access')") && !sc.includes('setowner'), 'icacls: the DACL set back, only if still as left');
  ok(JSON.stringify(withCaps(c, 'windows', [])) === JSON.stringify(W(c)) && /^ran a command: icacls/.test(W(c)[0].what), 'icacls without answers: the plain entry it always was');
}
// ============================================================================================================
// WHAT A LATER CHANGE MADE MOOT: supersede()
// ============================================================================================================
{
  const at = (c, osName, seq) => list(rec({ do: 'exec', cmd: c }, osName, null, { seq }));
  const pairs = (s) => JSON.stringify(s.map((x) => [x.id, x.by]));
  // the live run on Linux: a folder made (c1), a file put in it (c3, as the serve records a send), the folder deleted (c5)
  const l1 = at('mkdir /tmp/x', 'linux', 1)[0], l3 = at("cp -- '/tmp/agent-drive-sent' '/tmp/x/b.bin'", 'linux', 3)[0], l5 = at('rm -r /tmp/x', 'linux', 5)[0];
  Object.assign(l3, { verb: 'send', what: 'put b.bin on this machine at /tmp/x/b.bin' });
  let s = undo.supersede([l1, l3, l5]);
  ok(pairs(s) === JSON.stringify([['c1', 'c5'], ['c3', 'c5']]), 'Linux: c1 (the folder) and c3 (the file in it) are moot after c5 deleted the folder -> ' + pairs(s));
  ok(s[0].why === 'c5 deleted /tmp/x' && s[1].why === 'c5 deleted /tmp/x, with /tmp/x/b.bin in it', 'and why -> ' + JSON.stringify(s.map((x) => x.why)));
  ok(JSON.stringify(l1.paths) === JSON.stringify({ os: 'linux', made: ['/tmp/x'] }) && JSON.stringify(l3.paths) === JSON.stringify({ os: 'linux', made: ['/tmp/x/b.bin'] }) && JSON.stringify(l5.paths) === JSON.stringify({ os: 'linux', removed: ['/tmp/x'] }), 'the paths it read them from');
  // Windows: the same, as the serve sends it (md, New-Item for the file, rd /s or Remove-Item -Recurse; any case, either slash)
  const w1 = at(r`md C:\Work\x`, 'windows', 1)[0], w3 = at('powershell -NoProfile -Command "New-Item -ItemType File -Path \'C:\\Work\\x\\b.bin\'"', 'windows', 3)[0];
  for (const del of [r`rd /s /q C:\Work\x`, PS('Remove-Item -Recurse -Force c:/work/X')]) {
    s = undo.supersede([w1, w3, at(del, 'windows', 5)[0]]);
    ok(pairs(s) === JSON.stringify([['c1', 'c5'], ['c3', 'c5']]) && /^c5 deleted /.test(s[1].why), 'Windows (' + del + '): c1 and c3 moot after c5 -> ' + pairs(s) + ' ' + (s[1] && s[1].why));
  }
  // a later change put back is no longer in the way; one that can be put back says so
  const l5u = Object.assign({}, l5, { undone: '2026-11-06T10:00:00.000Z' });
  ok(undo.supersede([l1, l3, l5u]).length === 0, 'once c5 is put back, c1 and c3 are not moot');
  const lmv = at('mv /tmp/x /tmp/y', 'linux', 5)[0];
  s = undo.supersede([l1, l3, lmv]);
  ok(pairs(s) === JSON.stringify([['c1', 'c5'], ['c3', 'c5']]) && s[0].why === 'c5 moved away /tmp/x — put c5 back first', 'moved away: moot too, and c5 can be put back first -> ' + (s[0] && s[0].why));
  // moves and renames: what a later delete or move takes away
  s = undo.supersede([at(r`move C:\a.txt D:\b.txt`, 'windows', 1)[0], at(r`del D:\b.txt`, 'windows', 2)[0]]);
  ok(pairs(s) === JSON.stringify([['c1', 'c2']]), 'a move, then its destination deleted');
  s = undo.supersede([at('mv /home/u/a.txt /home/u/b.txt', 'linux', 1)[0], at('mv /home/u/b.txt /srv/c.txt', 'linux', 2)[0]]);
  ok(pairs(s) === JSON.stringify([['c1', 'c2']]) && /— put c2 back first$/.test(s[0].why), 'a move, then moved on: put the later one back first');
  s = undo.supersede([at(PS(r`Rename-Item C:\d\old.txt new.txt`), 'windows', 1)[0], at(r`rd /s /q C:\d`, 'windows', 2)[0]]);
  ok(pairs(s) === JSON.stringify([['c1', 'c2']]), 'a rename inside a folder, then the folder deleted');
  // where an undo would put something back: its folder gone
  s = undo.supersede([at('mv /tmp/x/a.txt /home/a.txt', 'linux', 1)[0], at('rm -rf /tmp/x', 'linux', 2)[0]]);
  ok(pairs(s) === JSON.stringify([['c1', 'c2']]) && s[0].why === 'c2 deleted /tmp/x, so /tmp/x/a.txt has no folder to go back to', 'moved out of a folder that was then deleted -> ' + (s[0] && s[0].why));
  s = undo.supersede([at('rm /tmp/x/a.txt', 'linux', 1)[0], at('rm -rf /tmp/x', 'linux', 2)[0]]);
  ok(pairs(s) === JSON.stringify([['c1', 'c2']]), 'deleted from a folder that was then deleted');
  // the registry: a key made, a value added to it, then the key deleted
  s = undo.supersede([at(PS(r`New-Item -Path HKCU:\Software\X`), 'windows', 1)[0], at(PS(r`New-ItemProperty -Path HKCU:\Software\X -Name Foo -Value 1`), 'windows', 2)[0], at(r`reg delete HKEY_CURRENT_USER\Software\X /f`, 'windows', 3)[0]]);
  ok(pairs(s) === JSON.stringify([['c1', 'c3'], ['c2', 'c3']]), 'a registry key and a value in it, then the key deleted -> ' + pairs(s));
  // never more than that
  const none = [
    [at('mkdir /tmp/xy', 'linux', 1)[0], at('rm -r /tmp/x', 'linux', 2)[0]],                         // a name that only starts the same
    [at('mkdir /tmp/X', 'linux', 1)[0], at('rm -r /tmp/x', 'linux', 2)[0]],                           // Linux: case matters
    [at('rm /tmp/a', 'linux', 1)[0], at('rm /tmp/a', 'linux', 2)[0]],                                 // the same place deleted again: its folder is there
    [at('rm -r /tmp/x', 'linux', 1)[0], at('mkdir /tmp/x', 'linux', 2)[0]],                           // the other way round
    [at(r`md C:\x`, 'windows', 1)[0], at('rm -r /x', 'linux', 2)[0]],                                  // another system
    [at('mkdir "$HOME/x"', 'linux', 1)[0], at('rm -r /home/u/x', 'linux', 2)[0]],                     // through a variable and written out: never meet
    [at(PS(r`New-ItemProperty -Path HKCU:\Software\X -Name Foo -Value 1`), 'windows', 1)[0], at(r`reg delete HKCU\Software\X /v Bar /f`, 'windows', 2)[0]],
  ];
  for (const [a, b] of none) ok(undo.supersede([a, b]).length === 0, 'not moot: ' + a.what + ' / ' + b.what);
  s = undo.supersede([at(r`md C:\Work\X`, 'windows', 1)[0], at(r`rd /s /q c:/work/x/`, 'windows', 2)[0], at('mkdir /a/b', 'linux', 3)[0], at('rm -r /a/./c/../b', 'linux', 4)[0]]);
  ok(pairs(s) === JSON.stringify([['c1', 'c2'], ['c3', 'c4']]), 'Windows: any case, either slash, a trailing one; . and .. resolved');
  let threw = 0;
  for (const bad of [null, 5, 'x', [null, 5, {}], [{ id: 'c1', what: 'x', paths: { os: 'linux', made: [5, null, '', '/'.repeat(9000)] } }, { id: 'c2', what: 'y', paths: { os: 'linux', removed: ['/'] } }],
    [{ id: 'c1', what: 'x', paths: { os: 'mac', made: ['/a'] } }, { id: 'c2', what: 'y', paths: { os: 'mac', removed: ['/a'] } }], [{ id: 'c1', what: 'x', paths: 'x' }]]) {
    try { const r0 = undo.supersede(bad); if (!Array.isArray(r0)) threw++; } catch (_) { threw++; }
  }
  ok(threw === 0 && undo.supersede([{ id: 'c1', what: 'x', paths: { os: 'linux', made: ['/a/b'] } }, { id: 'c2', what: 'y', paths: { os: 'linux', removed: ['/'] } }]).length === 1, 'supersede never throws; deleting / holds everything');
}
// ============================================================================================================
// cleanup(): the commands that remove a visit's copies
// ============================================================================================================
{
  ok(JSON.stringify(undo.cleanup([], {})) === '[]' && JSON.stringify(undo.cleanup(null, null)) === '[]', 'no system and no copies: nothing to run');
  let cl = undo.cleanup([], { os: 'windows', visit: 'v1' });
  ok(cl.length === 1 && cl[0].os === 'windows' && safeInCmd(cl[0].cmd) && inner(cl[0].cmd).includes("'agent-drive-undo','v1'") && inner(cl[0].cmd).includes("-cmatch '^k[0-9]+-[0-9a-f]{8}-[0-9a-f]{12}[.]bak$'"), 'Windows: the visit\'s folder, only files named as copies');
  cl = undo.cleanup([{ id: 'c1', what: 'x', backup: { os: 'windows', path: 'D:\\T\\agent-drive-undo\\v0\\k1-0123abcd-0123456789ab.bak' } }, { id: 'c2', what: 'y', backup: { os: 'windows', path: 'C:\\Windows\\System32\\x.dll' } }], { os: 'windows', visit: 'v1' });
  ok(cl.length === 1 && inner(cl[0].cmd).includes(r`'D:\T\agent-drive-undo\v0'`) && !inner(cl[0].cmd).includes('System32'), 'and the folders entries name -- never one that is not a copies folder');
  cl = undo.cleanup([{ id: 'c1', what: 'x', backup: { os: 'linux', path: '/tmp/agent-drive-undo-0/v1/k1-0123abcd-AbCdEf123456', sudo: { tool: 'sudo', user: null } } }], { os: 'linux', visit: 'v1' });
  ok(cl.length === 2 && cl.every((x) => x.os === 'linux') && !cl[0].cmd.startsWith('sudo') && cl[1].cmd.startsWith("sudo -n sh -c '") && cl[1].cmd.includes('/tmp/agent-drive-undo-0/v1'), 'Linux: this account\'s folder, and again under sudo for copies made under sudo');
}

// ============================================================================================================
// REAL ROUND TRIPS: run the change, then its undo, the way the host runs an exec
// ============================================================================================================
const T0 = Date.now();
function real(label, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-test-'));
  try { fn(tmp); } catch (e) { ok(false, label + ' threw: ' + (e && e.stack)); } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
}
const has = (p) => fs.existsSync(p);
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } };
if (process.platform === 'win32' && spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'exit 7'], { windowsHide: true, timeout: 30000 }).status === 7) {
  real('windows', (tmp) => {
    // the host runs an exec as `cmd.exe /c <line>`
    const run = (cmd) => { const x = spawnSync('cmd.exe', ['/c', cmd], { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', timeout: 30000, cwd: tmp }); return { code: x.status, out: (x.stdout || '') + (x.stderr || '') }; };
    const step = (cmd) => { const e = list(rec({ do: 'exec', cmd }, 'windows'))[0]; const x = run(cmd); return { e, x }; };
    const J = (...p) => path.join(tmp, ...p);
    // 1. a PowerShell move into a folder, of a file named with everything that breaks quoting
    const name = 'Bob’s [1] it\'s 100% & ^ ! $x `y` ; (z) {w} é 日本.txt';
    fs.writeFileSync(J(name), 'one');
    fs.mkdirSync(J('Archive'));
    let s = step(ENC('Move-Item -LiteralPath ' + psq(J(name)) + ' -Destination ' + psq(J('Archive'))));
    ok(s.x.code === 0 && has(J('Archive', name)), 'real: the move ran (' + s.x.out.trim().slice(0, 200) + ')');
    let x = run(back(s.e));
    ok(x.code === 0 && read(J(name)) === 'one' && !has(J('Archive', name)), 'real: its undo, run by cmd.exe, put the file back where it was (' + x.out.trim().slice(0, 200) + ')');
    const again = list(rec({ do: 'exec', cmd: back(s.e) }, 'windows'))[0];
    x = run(back(again));
    ok(x.code === 0 && read(J('Archive', name)) === 'one' && !has(J(name)), 'real: the undo of the undo moved it into the folder again');
    run(back(s.e));
    // 2. a cmd.exe move that RENAMED (the destination was not there): the undo sees that it is not a folder
    fs.writeFileSync(J('a b.txt'), 'two');
    s = step('move "' + J('a b.txt') + '" "' + J('c d.txt') + '"');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && read(J('a b.txt')) === 'two' && !has(J('c d.txt')), 'real: cmd move that renamed, put back');
    // 3. the old place is taken now: the undo refuses and touches nothing
    s = step('move "' + J('a b.txt') + '" "' + J('Archive') + '"');
    fs.writeFileSync(J('a b.txt'), 'newer');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code !== 0 && read(J('a b.txt')) === 'newer' && read(J('Archive', 'a b.txt')) === 'two' && /already there/.test(x.out), 'real: the undo never moves over something that is there now');
    // 4. a copy: the undo deletes the copy, the original stays
    s = step(PS("Copy-Item -LiteralPath '" + J('a b.txt') + "' -Destination '" + J('Archive') + "'"));
    ok(s.x.code === 0 && read(J('Archive', 'a b.txt')) === 'newer', 'real: the copy ran');
    x = run(back(s.e));
    ok(x.code === 0 && !has(J('Archive', 'a b.txt')) && read(J('a b.txt')) === 'newer', 'real: its undo deleted the copy and only the copy');
    // 5. a new folder: the undo removes it while it is empty, and refuses once something is in it
    s = step('mkdir "' + J('made') + '"');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && !has(J('made')), 'real: md, undone by rd');
    s = step('mkdir "' + J('made') + '"');
    fs.writeFileSync(J('made', 'keep.txt'), 'keep');
    x = run(back(s.e));
    ok(x.code !== 0 && read(J('made', 'keep.txt')) === 'keep', 'real: a folder with something in it is never removed');
    // 6. an empty folder removed: made again
    fs.mkdirSync(J('gone'));
    s = step('rd "' + J('gone') + '"');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && fs.statSync(J('gone')).isDirectory(), 'real: rd of an empty folder, undone by md');
    // 7. a rename and a new file
    fs.writeFileSync(J('old.txt'), 'seven');
    s = step(PS("Rename-Item -LiteralPath '" + J('old.txt') + "' -NewName 'new.txt'"));
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && read(J('old.txt')) === 'seven' && !has(J('new.txt')), 'real: Rename-Item, renamed back');
    s = step(PS("New-Item -ItemType File -Path '" + J('fresh.txt') + "' | Out-Null"));
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && !has(J('fresh.txt')), 'real: New-Item, taken away again');
  });
} else console.log('  (skip: no PowerShell here -- the Windows undos were not run for real)');

const SH = process.platform === 'win32' ? 'sh' : '/bin/sh';
if (spawnSync(SH, ['-c', 'exit 7'], { timeout: 30000 }).status === 7) {
  real('sh', (tmp) => {
    // the host runs an exec as `/bin/sh -c <line>`; relative paths, from the same folder each time
    const run = (cmd) => { const x = spawnSync(SH, ['-c', cmd], { encoding: 'utf8', timeout: 30000, cwd: tmp }); return { code: x.status, out: (x.stdout || '') + (x.stderr || '') }; };
    const step = (cmd) => { const e = list(rec({ do: 'exec', cmd }, 'linux'))[0]; const x = run(cmd); return { e, x }; };
    const J = (...p) => path.join(tmp, ...p);
    const name = "it's \"$x\" `y` & ; (z) * ? [1] é.txt";
    const fname = process.platform === 'win32' ? name.replace(/["*?]/g, '_') : name;
    fs.writeFileSync(J(fname), 'one');
    fs.mkdirSync(J('dir'));
    let s = step('mv -- ' + sq(fname) + ' dir');
    let x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && read(J(fname)) === 'one' && !has(J('dir', fname)), 'real sh: mv into a folder, put back (' + (s.x.out + x.out).trim().slice(0, 200) + ')');
    const again = list(rec({ do: 'exec', cmd: back(s.e) }, 'linux'))[0];
    x = run(back(again));
    ok(x.code === 0 && read(J('dir', fname)) === 'one', 'real sh: the undo of the undo moved it into the folder again');
    run(back(s.e));
    s = step('mv -- ' + sq(fname) + ' renamed.txt');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && read(J(fname)) === 'one' && !has(J('renamed.txt')), 'real sh: mv that renamed, put back');
    s = step('mv -- ' + sq(fname) + ' dir');
    fs.writeFileSync(J(fname), 'newer');
    x = run(back(s.e));
    ok(x.code !== 0 && read(J(fname)) === 'newer' && read(J('dir', fname)) === 'one', 'real sh: the undo never moves over something that is there now');
    s = step('cp -- ' + sq(fname) + ' copy.txt');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && !has(J('copy.txt')) && read(J(fname)) === 'newer', 'real sh: cp, the copy deleted and only the copy');
    s = step('mkdir made');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && !has(J('made')), 'real sh: mkdir, undone by rmdir');
    s = step('mkdir made');
    fs.writeFileSync(J('made', 'keep.txt'), 'keep');
    x = run(back(s.e));
    ok(x.code !== 0 && read(J('made', 'keep.txt')) === 'keep', 'real sh: a folder with something in it is never removed');
    fs.mkdirSync(J('gone'));
    s = step('rmdir gone');
    x = run(back(s.e));
    ok(s.x.code === 0 && x.code === 0 && fs.statSync(J('gone')).isDirectory(), 'real sh: rmdir, undone by mkdir');
    if (process.platform !== 'win32') {                       // Git's sh on Windows copies instead of linking
      s = step('ln -s ' + sq(fname) + ' link');
      x = run(back(s.e));
      ok(s.x.code === 0 && x.code === 0 && !has(J('link')) && read(J(fname)) === 'newer', 'real sh: ln -s, the link removed and not what it points to');
    }
  });
} else console.log('  (skip: no sh here -- the sh undos were not run for real)');

// ============================================================================================================
// REAL CAPTURES: the serve's part played here -- each 'before' capture, the command, each 'after' capture, record()
// with what they printed -- then the undo, all the way the host runs an exec, against a temp folder. The copies go
// in this test's own visit folder, which cleanup() removes (checked); a registry test key is made and removed.
// ============================================================================================================
const visitId = (tag) => 'undo-test-' + tag + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
function serveOf(run, osName, visit) {
  const all = [];
  const act = (cmd, o) => {
    o = o || {};
    const c = { do: 'exec', cmd };
    const ctx = Object.assign({ os: osName, now: Date.now(), seq: all.length + 1, visit }, o.ctx || {});
    const p = undo.prepare(c, ctx), caps = p ? p.captures : [], captured = [];
    for (const k of caps.filter((x) => x.when === 'before')) { const y = run(k.cmd); captured.push({ id: k.id, ok: y.code === 0, output: y.out }); }
    const x = run(cmd);
    if (!o.noAfter) for (const k of caps.filter((y) => y.when === 'after')) { const y = run(k.cmd); captured.push({ id: k.id, ok: y.code === 0, output: y.out }); }
    const e = list(undo.record(c, { ok: x.code === 0 }, Object.assign({}, ctx, { captured })));
    all.push(...e);
    return { x, e, last: e[e.length - 1] || {}, captured, caps };
  };
  return { act, all };
}
const mtimeOf = (p) => { try { return fs.statSync(p).mtimeMs; } catch (_) { return NaN; } };
const OLD = new Date(Date.UTC(2020, 0, 2, 3, 4, 5));
if (process.platform === 'win32' && spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'exit 7'], { windowsHide: true, timeout: 30000 }).status === 7) {
  real('windows capture', (tmp) => {
    const run = (cmd) => { const x = spawnSync('cmd.exe', ['/c', cmd], { windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', timeout: 60000, cwd: tmp }); return { code: x.status, out: (x.stdout || '') + (x.stderr || '') }; };
    const J = (...p) => path.join(tmp, ...p);
    // the temp folder by its LONG name: GitHub's Windows runners give TEMP in its 8.3 form (C:\Users\RUNNER~1\...), and a
    // copy's path is reported as Windows resolves it
    const TMPL = fs.realpathSync.native(os.tmpdir());
    const VISIT = visitId('w'), keep = path.join(TMPL, 'agent-drive-undo', VISIT);
    const { act, all } = serveOf(run, 'windows', VISIT);
    const attrs = (p) => (run('attrib "' + p + '"').out.split(/\r?\n/)[0] || '').slice(0, 12);
    try {
      // 1. Set-Content over a file named with everything that breaks quoting: a copy kept, put back with its time
      const name = 'Bob’s [1] it\'s 100% & ^ ! $x `y` ; (z) {w} é 日本.txt';
      fs.writeFileSync(J(name), 'the original'); fs.utimesSync(J(name), OLD, OLD);
      let s = act(ENC('Set-Content -LiteralPath ' + psq(J(name)) + " -Value 'the agent wrote this'"));
      ok(s.x.code === 0 && /^the agent/.test(read(J(name))) && s.caps.length === 2 && s.last.reversible && s.last.backup && has(s.last.backup.path) && path.dirname(s.last.backup.path).toLowerCase() === keep.toLowerCase(),
        'real capture: Set-Content over a file -- a copy kept in the visit\'s folder (' + (s.last.backup && s.last.backup.path) + ')');
      let u = run(back(s.last));
      ok(u.code === 0 && read(J(name)) === 'the original' && mtimeOf(J(name)) === OLD.getTime(), 'real capture: put back from the copy, its time too (' + u.out.trim().slice(0, 200) + ')');
      u = run(back(s.last));
      ok(u.code !== 0 && /was changed again after this change/.test(u.out) && read(J(name)) === 'the original', 'real capture: run again, it refuses -- the file is not what the change left any more');
      // 2. changed again by someone after the change: refused, untouched
      fs.writeFileSync(J('b.txt'), 'b original');
      s = act(PS("Set-Content -LiteralPath '" + J('b.txt') + "' -Value agent"));
      fs.writeFileSync(J('b.txt'), 'the person edited it after');
      u = run(back(s.last));
      ok(u.code !== 0 && /changed again after this change/.test(u.out) && read(J('b.txt')) === 'the person edited it after', 'real capture: changed again since -> refused, touched nothing');
      // 3. the copy changed in its folder: refused, nothing written
      fs.writeFileSync(J('c.txt'), 'c original');
      s = act(PS("Set-Content -LiteralPath '" + J('c.txt') + "' -Value agent"));
      fs.writeFileSync(s.last.backup.path, 'swapped');
      u = run(back(s.last));
      ok(u.code !== 0 && /is not what was kept/.test(u.out) && /^agent/.test(read(J('c.txt'))), 'real capture: a copy changed after it was kept -> refused, nothing written');
      // 4. del of a hidden, read-only file: made again with its content, time and attributes; never over a new one
      fs.writeFileSync(J('d.txt'), 'delete me'); fs.utimesSync(J('d.txt'), OLD, OLD); run('attrib +r +h "' + J('d.txt') + '"');
      s = act('del /f /a "' + J('d.txt') + '"');
      ok(s.x.code === 0 && !has(J('d.txt')) && s.last.what === 'deleted ' + J('d.txt') && s.last.reversible && !s.last.undo.risky, 'real capture: del of a hidden read-only file -- it can be put back');
      u = run(back(s.last));
      ok(u.code === 0 && read(J('d.txt')) === 'delete me' && mtimeOf(J('d.txt')) === OLD.getTime() && /R/.test(attrs(J('d.txt'))) && /H/.test(attrs(J('d.txt'))), 'real capture: made again -- content, time, hidden and read-only (' + attrs(J('d.txt')) + ')');
      s = act('del /f /a "' + J('d.txt') + '"');
      fs.writeFileSync(J('d.txt'), 'a new one');
      u = run(back(s.last));
      ok(u.code !== 0 && /is there again/.test(u.out) && read(J('d.txt')) === 'a new one', 'real capture: something there again -> the copy is not put over it');
      // 5. > where nothing was: deleted again -- only while it is as made
      s = act('echo made> "' + J('new.txt') + '"');
      ok(s.last.what === 'created the file ' + J('new.txt') + ' (with >)' && s.last.undo.risky, 'real capture: > made a new file -> ' + s.last.what);
      u = run(back(s.last));
      ok(u.code === 0 && !has(J('new.txt')), 'real capture: the file it made, deleted again');
      s = act('echo made> "' + J('new2.txt') + '"');
      fs.appendFileSync(J('new2.txt'), 'and more');
      u = run(back(s.last));
      ok(u.code !== 0 && has(J('new2.txt')), 'real capture: written to since -> not deleted');
      // 6. copy /Y over a file, and Copy-Item into a folder over the file of that name there
      fs.writeFileSync(J('src.txt'), 'source'); fs.writeFileSync(J('dst.txt'), 'dst original');
      s = act('copy /Y "' + J('src.txt') + '" "' + J('dst.txt') + '"');
      ok(s.x.code === 0 && read(J('dst.txt')) === 'source' && /, replacing the file that was there$/.test(s.last.what), 'real capture: copy /Y over a file -> ' + s.last.what);
      u = run(back(s.last));
      ok(u.code === 0 && read(J('dst.txt')) === 'dst original' && read(J('src.txt')) === 'source', 'real capture: the file it replaced, put back');
      fs.mkdirSync(J('folder')); fs.writeFileSync(J('folder', 'src.txt'), 'in the folder');
      s = act(PS("Copy-Item -Force -LiteralPath '" + J('src.txt') + "' -Destination '" + J('folder') + "'"));
      ok(read(J('folder', 'src.txt')) === 'source' && s.last.reversible && s.last.paths.made[0] === J('folder', 'src.txt'), 'real capture: Copy-Item into a folder -- the file inside it, exactly');
      u = run(back(s.last));
      ok(u.code === 0 && read(J('folder', 'src.txt')) === 'in the folder', 'real capture: put back inside the folder');
      // 7. move /Y over a file: moved back, and the file it replaced put back
      fs.writeFileSync(J('m1.txt'), 'moved one'); fs.writeFileSync(J('m2.txt'), 'replaced one');
      s = act('move /Y "' + J('m1.txt') + '" "' + J('m2.txt') + '"');
      ok(s.x.code === 0 && !has(J('m1.txt')) && read(J('m2.txt')) === 'moved one' && /replacing the file that was there/.test(s.last.what), 'real capture: move /Y over a file');
      u = run(back(s.last));
      ok(u.code === 0 && read(J('m1.txt')) === 'moved one' && read(J('m2.txt')) === 'replaced one', 'real capture: moved back, and the replaced file put back (' + u.out.trim().slice(0, 160) + ')');
      // 8. over the cap; a folder: nothing kept, and said
      fs.writeFileSync(J('big.txt'), '0123456789');
      s = act(PS("Set-Content -LiteralPath '" + J('big.txt') + "' -Value x"), { ctx: { maxBytes: 4 } });
      ok(!s.last.reversible && /no copy was kept: it was 10 bytes, over the 4 bytes a copy is kept of/.test(s.last.undo.text) && !s.last.backup, 'real capture: over the cap -> ' + s.last.undo.text);
      fs.mkdirSync(J('tree')); fs.writeFileSync(J('tree', 'a'), 'a');
      s = act(PS("Remove-Item -Recurse -Force -LiteralPath '" + J('tree') + "'"));
      ok(!has(J('tree')) && !s.last.reversible && /a folder is never copied/.test(s.last.undo.text), 'real capture: a folder deleted -> never copied, said');
      // 9. New-Item -Force of a folder: none when it was there; one, for certain, when it was not
      s = act(PS("New-Item -Force -ItemType Directory -Path '" + J('folder') + "' | Out-Null"));
      ok(s.x.code === 0 && s.e.length === 0, 'real capture: New-Item -Force of a folder that was there -> no change, no entry');
      s = act(PS("New-Item -Force -ItemType Directory -Path '" + J('fresh') + "' | Out-Null"));
      ok(s.e.length === 1 && s.last.reversible && !/may have been there/.test(s.last.undo.note), 'real capture: of a new one -> made, no doubt in it');
      u = run(back(s.last));
      ok(u.code === 0 && !has(J('fresh')), 'real capture: and removed again');
      // 10. icacls /grant and /inheritance:r: the permissions set back exactly
      fs.writeFileSync(J('perm.txt'), 'p');
      const sddl = () => run(PS("[IO.File]::GetAccessControl('" + J('perm.txt') + "','Access').GetSecurityDescriptorSddlForm('Access')")).out.trim();
      const was = sddl();
      for (const how of ['/grant *S-1-1-0:R', '/inheritance:r', '/deny *S-1-1-0:W']) {
        s = act('icacls "' + J('perm.txt') + '" ' + how);
        const mid = sddl();
        u = run(back(s.last));
        // every entry exactly as it was; the DACL's AI (auto-inherited) flag aside -- Windows sets it itself when a DACL with
        // inherited entries is written back (GitHub's runners' temp files start without it; this machine's with it)
        const noAI = (x) => String(x).replace(/^D:(P?)AI/, 'D:$1');
        ok(s.x.code === 0 && mid !== was && s.last.reversible && u.code === 0 && noAI(sddl()) === noAI(was), 'real capture: icacls ' + how + ' -> set back exactly, entry for entry (' + was + ' / ' + mid + ' / ' + sddl() + ')');
      }
      // 11. a service's startup type: only READ here (nothing is set)
      const pv = undo.prepare({ do: 'exec', cmd: PS('Set-Service -Name EventLog -StartupType Automatic') }, { os: 'windows' });
      const rv = run(pv.captures[0].cmd), av = (() => { try { return JSON.parse(rv.out.trim().split(/\r?\n/).pop()); } catch (_) { return {}; } })();
      ok(av.ok === true && av.undo === pv.captures[0].id && av.name === 'EventLog' && av.start === 2, 'real capture: a service\'s startup type read (read only) -> ' + rv.out.trim());
      // 12. the visit's folder a junction to elsewhere: refused, nothing copied
      const V2 = VISIT + '-j', jdir = path.join(TMPL, 'agent-drive-undo', V2);
      fs.mkdirSync(J('elsewhere'));
      run('mklink /J "' + jdir + '" "' + J('elsewhere') + '"');
      try {
        fs.writeFileSync(J('j.txt'), 'j');
        s = act(PS("Set-Content -LiteralPath '" + J('j.txt') + "' -Value x"), { ctx: { visit: V2 } });
        ok(!s.last.reversible && /not this account’s alone/.test(s.last.undo.text) && fs.readdirSync(J('elsewhere')).length === 0, 'real capture: the visit\'s folder a junction -> refused, nothing copied');
      } finally { run('rmdir "' + jdir + '"'); }
      // 13. the registry, in a key of this test's own
      const KEY = 'HKCU\\Software\\agent-drive-test-' + Math.random().toString(36).slice(2, 10);
      const q = (v) => run('reg query "' + KEY + '" ' + (v === '' ? '/ve' : '/v ' + v)).out.split(/\r?\n/).filter((l) => /REG_/.test(l)).join('|').trim();
      try {
        run('reg add "' + KEY + '" /v S /t REG_SZ /d old /f');
        s = act('reg add "' + KEY + '" /v S /t REG_SZ /d new /f');
        u = run(back(s.last));
        ok(s.x.code === 0 && s.last.reversible && u.code === 0 && /REG_SZ\s+old$/.test(q('S')), 'real capture: reg add over a value -> set back (' + q('S') + ')');
        s = act('reg add "' + KEY + '" /v D /t REG_DWORD /d 5 /f');
        u = run(back(s.last));
        ok(/^added the registry value D/.test(s.last.what) && u.code === 0 && q('D') === '', 'real capture: reg add of a new value -> deleted again');
        s = act('reg add "' + KEY + '\\Sub" /v N /d 1 /f');
        u = run(back(s.last));
        ok(/\(and made the key\)$/.test(s.last.what) && u.code === 0 && run('reg query "' + KEY + '\\Sub"').code !== 0, 'real capture: a value in a key it made -> both gone again');
        run('reg add "' + KEY + '" /ve /d dflt /f');
        s = act('reg add "' + KEY + '" /ve /d agent /f');
        u = run(back(s.last));
        ok(u.code === 0 && /REG_SZ\s+dflt$/.test(q('')), 'real capture: the default value -> set back (' + q('') + ')');
        // every type, deleted and put back as it was
        run(ENC("$k='Registry::" + KEY.replace('HKCU', 'HKEY_CURRENT_USER') + "'; New-ItemProperty -Path $k -Name M -PropertyType MultiString -Value @('a','','b') | Out-Null; " +
          "New-ItemProperty -Path $k -Name Q -PropertyType QWord -Value 81985529216486895 | Out-Null; New-ItemProperty -Path $k -Name B -PropertyType Binary -Value ([byte[]](0,255,7)) | Out-Null; " +
          "New-ItemProperty -Path $k -Name E -PropertyType ExpandString -Value '%TEMP%\\x' | Out-Null; New-ItemProperty -Path $k -Name Z -PropertyType String -Value '' | Out-Null; " +
          "New-ItemProperty -Path $k -Name N2 -PropertyType DWord -Value -2 | Out-Null"));
        for (const v of ['M', 'Q', 'B', 'E', 'Z', 'N2']) {
          const before = q(v);
          s = act('reg delete "' + KEY + '" /v ' + v + ' /f');
          const gone = q(v);
          u = run(back(s.last));
          ok(before && !gone && s.last.reversible && u.code === 0 && q(v) === before, 'real capture: a deleted value put back as it was: ' + before);
        }
        s = act(PS("Remove-ItemProperty -Path 'Registry::" + KEY.replace('HKCU', 'HKEY_CURRENT_USER') + "' -Name S"));
        u = run(back(s.last));
        ok(s.last.reversible && u.code === 0 && /REG_SZ\s+old$/.test(q('S')), 'real capture: Remove-ItemProperty -> put back');
        s = act('reg add "' + KEY + '" /v S /t REG_SZ /d agent /f');
        run('reg add "' + KEY + '" /v S /t REG_SZ /d person /f');
        u = run(back(s.last));
        ok(u.code !== 0 && /changed again/.test(u.out) && /person$/.test(q('S')), 'real capture: a value changed again since -> refused, left as it is');
        s = act('reg add "' + KEY + '\\Made"');
        u = run(back(s.last));
        ok(s.last.reversible && u.code === 0 && run('reg query "' + KEY + '\\Made"').code !== 0, 'real capture: reg add of a new key -> deleted again (' + u.out.trim().slice(0, 120) + ')');
        s = act('reg add "' + KEY + '\\Made"');
        run('reg add "' + KEY + '\\Made" /v Since /d 1 /f');
        u = run(back(s.last));
        ok(u.code !== 0 && /has values or keys in it now/.test(u.out) && run('reg query "' + KEY + '\\Made" /v Since').code === 0, 'real capture: a value put in it since -> the key is left as it is');
      } finally { run('reg delete "' + KEY + '" /f'); }
      ok(run('reg query "' + KEY + '"').code !== 0, 'real capture: the test registry key is gone');
      // 14. cleanup: the copies and the visit's folder go; an undo after it says the copy is gone
      const withCopy = all.find((x) => x.backup && x.reversible);
      const cl = undo.cleanup(all, { os: 'windows', visit: VISIT });
      const cx = cl.map((c) => run(c.cmd));
      ok(cl.length === 1 && cx.every((x) => x.code === 0 && /"removed":[1-9]\d*/.test(x.out)) && !has(keep), 'real capture: cleanup removed the copies and the folder (' + cx.map((x) => x.out.trim()).join(' ') + ')');
      fs.writeFileSync(J('b.txt'), 'b');
      u = withCopy ? run(back(withCopy)) : { code: 0, out: '' };
      ok(u.code !== 0 && /the copy kept of it is gone/.test(u.out), 'real capture: after cleanup an undo from a copy stops, and says why');
    } finally {
      try { fs.rmSync(keep, { recursive: true, force: true }); } catch (_) {}
      try { fs.rmdirSync(path.dirname(keep)); } catch (_) {}
    }
  });
} else console.log('  (skip: no PowerShell here -- the Windows captures were not run for real)');

if (spawnSync(SH, ['-c', 'exit 7'], { timeout: 30000 }).status === 7) {
  real('sh capture', (tmp) => {
    // relative paths, from the same folder each time, as the host's exec runs
    const run = (cmd) => { const x = spawnSync(SH, ['-c', cmd], { encoding: 'utf8', timeout: 30000, cwd: tmp }); return { code: x.status, out: (x.stdout || '') + (x.stderr || '') }; };
    const J = (...p) => path.join(tmp, ...p);
    const WIN = process.platform === 'win32';
    const VISIT = visitId('s');
    const { act, all } = serveOf(run, 'linux', VISIT);
    const shHas = (p) => run('[ -e ' + sq(p) + ' ]').code === 0;
    const keep = '"${TMPDIR:-/tmp}/agent-drive-undo-$(id -u)/' + VISIT + '"';
    try {
      const name = "it's \"$x\" `y` & ; (z) é.txt", fname = WIN ? name.replace(/["*?]/g, '_') : name;
      fs.writeFileSync(J(fname), 'the original\n'); if (!WIN) fs.chmodSync(J(fname), 0o640); fs.utimesSync(J(fname), OLD, OLD);
      let s = act('echo agent > ' + sq(fname));
      ok(s.x.code === 0 && read(J(fname)) === 'agent\n' && s.caps.length === 2 && s.last.reversible && s.last.backup && shHas(s.last.backup.path), 'real sh capture: > over a file -- a copy kept (' + (s.last.backup && s.last.backup.path) + ')');
      let u = run(back(s.last));
      ok(u.code === 0 && read(J(fname)) === 'the original\n' && Math.abs(mtimeOf(J(fname)) - OLD.getTime()) < 2000 && (WIN || (fs.statSync(J(fname)).mode & 0o777) === 0o640), 'real sh capture: put back, its time and mode too (' + u.out.trim().slice(0, 160) + ')');
      u = run(back(s.last));
      ok(u.code !== 0 && /changed again/.test(u.out) && read(J(fname)) === 'the original\n', 'real sh capture: run again -> refused');
      // changed since; the copy changed
      fs.writeFileSync(J('b.txt'), 'b original\n');
      s = act("printf 'agent' >> b.txt");
      fs.writeFileSync(J('b.txt'), 'the person edited it\n');
      u = run(back(s.last));
      ok(s.last.reversible && u.code !== 0 && read(J('b.txt')) === 'the person edited it\n', 'real sh capture: >> then changed again -> refused, untouched');
      fs.writeFileSync(J('c.txt'), 'c original\n');
      s = act('echo agent > c.txt');
      run('printf swapped > ' + sq(s.last.backup.path));
      u = run(back(s.last));
      ok(u.code !== 0 && /is not what was kept/.test(u.out) && read(J('c.txt')) === 'agent\n', 'real sh capture: the copy changed -> refused, nothing written');
      // rm: made again with its mode and time; never over a new one
      fs.writeFileSync(J('d.txt'), 'delete me\n'); if (!WIN) fs.chmodSync(J('d.txt'), 0o604); fs.utimesSync(J('d.txt'), OLD, OLD);
      s = act('rm d.txt');
      u = run(back(s.last));
      ok(s.x.code === 0 && s.last.reversible && u.code === 0 && read(J('d.txt')) === 'delete me\n' && Math.abs(mtimeOf(J('d.txt')) - OLD.getTime()) < 2000 && (WIN || (fs.statSync(J('d.txt')).mode & 0o777) === 0o604), 'real sh capture: rm, made again -- content, time, mode');
      s = act('rm d.txt');
      fs.writeFileSync(J('d.txt'), 'a new one');
      u = run(back(s.last));
      ok(u.code !== 0 && /is there again/.test(u.out) && read(J('d.txt')) === 'a new one', 'real sh capture: something there again -> not put over it');
      // > where nothing was; cp over a file; cp into a folder; mv over a file
      s = act('echo made > new.txt');
      u = run(back(s.last));
      ok(s.last.what === 'created the file new.txt (with >)' && u.code === 0 && !has(J('new.txt')), 'real sh capture: a file > made, deleted again');
      fs.writeFileSync(J('src.txt'), 'source'); fs.writeFileSync(J('dst.txt'), 'dst original');
      s = act('cp src.txt dst.txt');
      u = run(back(s.last));
      ok(/replacing the file that was there$/.test(s.last.what) && u.code === 0 && read(J('dst.txt')) === 'dst original', 'real sh capture: cp over a file, put back');
      fs.mkdirSync(J('dir')); fs.writeFileSync(J('dir', 'src.txt'), 'in dir');
      s = act('cp src.txt dir');
      u = run(back(s.last));
      ok(s.last.paths.made[0] === 'dir/src.txt' && u.code === 0 && read(J('dir', 'src.txt')) === 'in dir', 'real sh capture: cp into a folder over a file, put back there');
      fs.writeFileSync(J('m1.txt'), 'moved one'); fs.writeFileSync(J('m2.txt'), 'replaced one');
      s = act('mv m1.txt m2.txt');
      u = run(back(s.last));
      ok(s.x.code === 0 && /replacing the file that was there/.test(s.last.what) && u.code === 0 && read(J('m1.txt')) === 'moved one' && read(J('m2.txt')) === 'replaced one', 'real sh capture: mv over a file -- moved back, the replaced file put back');
      // the cap; a folder; mkdir -p; touch; chmod
      fs.writeFileSync(J('big.txt'), '0123456789');
      s = act('echo x > big.txt', { ctx: { maxBytes: 4 } });
      ok(!s.last.reversible && /over the 4 bytes a copy is kept of/.test(s.last.undo.text), 'real sh capture: over the cap -> said');
      fs.mkdirSync(J('tree')); fs.writeFileSync(J('tree', 'a'), 'a');
      s = act('rm -r tree');
      ok(!s.last.reversible && /a folder is never copied/.test(s.last.undo.text), 'real sh capture: rm -r of a folder -> never copied, said');
      s = act('mkdir -p dir');
      ok(s.x.code === 0 && s.e.length === 0, 'real sh capture: mkdir -p of a folder that was there -> no entry');
      s = act('mkdir -p fresh');
      u = run(back(s.last));
      ok(s.e.length === 1 && u.code === 0 && !has(J('fresh')), 'real sh capture: mkdir -p of a new one -> removed again');
      fs.writeFileSync(J('t.txt'), 'touch me'); fs.utimesSync(J('t.txt'), OLD, OLD);
      s = act('touch t.txt');
      u = run(back(s.last));
      ok(s.last.what === 'changed the date of t.txt (touch)' && u.code === 0 && Math.abs(mtimeOf(J('t.txt')) - OLD.getTime()) < 2000 && read(J('t.txt')) === 'touch me', 'real sh capture: touch -> its date put back');
      fs.writeFileSync(J('p.txt'), 'p'); fs.chmodSync(J('p.txt'), 0o644);
      s = act('chmod 444 p.txt');
      u = run(back(s.last));
      ok(s.last.reversible && u.code === 0 && (fs.statSync(J('p.txt')).mode & 0o222) !== 0 && (WIN || (fs.statSync(J('p.txt')).mode & 0o777) === 0o644), 'real sh capture: chmod -> set back (' + u.out.trim().slice(0, 120) + ')');
      if (!WIN) {   // a planted link where the visit's folder goes: refused (Git's sh on Windows copies instead of linking)
        const V2 = VISIT + '-l';
        fs.mkdirSync(J('elsewhere'));
        run('r=${TMPDIR:-/tmp}; mkdir -p "$r/agent-drive-undo-$(id -u)" && ln -s ' + sq(J('elsewhere')) + ' "$r/agent-drive-undo-$(id -u)/' + V2 + '"');
        try {
          fs.writeFileSync(J('j.txt'), 'j');
          s = act('echo x > j.txt', { ctx: { visit: V2 } });
          ok(!s.last.reversible && /not this account’s alone/.test(s.last.undo.text) && fs.readdirSync(J('elsewhere')).length === 0, 'real sh capture: the visit\'s folder a link -> refused, nothing copied');
        } finally { run('rm -f "${TMPDIR:-/tmp}/agent-drive-undo-$(id -u)/' + V2 + '"'); }
      }
      // cleanup
      const withCopy = all.find((x) => x.backup && x.reversible);
      const cl = undo.cleanup(all, { os: 'linux', visit: VISIT });
      const cx = cl.map((c) => run(c.cmd));
      ok(cl.length === 1 && cx.every((x) => x.code === 0 && /"removed":[1-9]\d*/.test(x.out)) && run('[ -d ' + keep + ' ]').code !== 0, 'real sh capture: cleanup removed the copies and the folder (' + cx.map((x) => x.out.trim()).join(' ') + ')');
      u = withCopy ? run(back(withCopy)) : { code: 0, out: '' };
      ok(u.code !== 0 && /the copy kept of it .* is gone/.test(u.out), 'real sh capture: after cleanup an undo from a copy stops, and says why');
    } finally { run('rm -rf ' + keep + '; rmdir "${TMPDIR:-/tmp}/agent-drive-undo-$(id -u)" 2>/dev/null; true'); }
  });
} else console.log('  (skip: no sh here -- the sh captures were not run for real)');
if (Date.now() - T0 > 20000) console.log('  (the real round trips took ' + Math.round((Date.now() - T0) / 1000) + ' s)');

console.log((fail ? 'FAIL' : 'ok') + ' undo: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

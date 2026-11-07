'use strict';
// @tool what a command changed on the host and how to put it back: a journal entry per change (moved, renamed, made, deleted, a service flipped, text typed) with an undo command or a plain hint; what to read or keep BEFORE a command runs so an overwrite, a delete or a reset can be put back; pure, offline
// @run  const undo = require('./undo.js'); const p = undo.prepare(cmd, ctx); /* run p.captures */ const e = undo.record(cmd, reply, {os, now, seq, window, captured})   (a library: the serve journals each entry, lists them at the finish, after a yes runs undo.inverse(e).cmd, and at the end runs undo.cleanup(entries, ctx))
// core/undo.js -- WHAT DID THE AGENT CHANGE, AND HOW IS IT PUT BACK?
//
// An agent on somebody's machine moves files, makes folders, flips services and types into windows. When the job
// is over the person should hear what changed -- "I changed 3 things, say undo to put any back" -- and be able to
// have any of it put back without knowing how. The serve calls record() after every command that succeeded and
// keeps what it returns; at the finish it says summary() and lists forChat(); and only after the operator says yes
// in chat does it run inverse(entry).cmd. This module decides what a command changed and what would reverse it.
// It never runs anything, reads no file, keeps no state, and never throws: commands are JSON somebody wrote.
//
//   record(cmd, result, ctx) -> entry | entry[] | null   ctx: {os:'windows'|'linux'|'', now, seq, window?, captured?}
//     entry {id:'c<seq>', at, verb, what, md, kind:'exec'|'typed'|'launched'|'declared', reversible,
//            undo: {kind:'exec', os, cmd, risky, note} | {kind:'hint', text} | null,
//            paths?: {os, made?, from?, to?, removed?},      where it changed something (WHAT A LATER CHANGE MADE MOOT)
//            backup?: {os, path, bytes, sudo?}}               the kept copy its undo puts back (CAPTURE BEFORE CHANGE)
//     One entry per change: a command that made several is an ARRAY numbered seq, seq+1, ... (advance the count by
//     its length). `md` is `what` as Markdown, its paths as code. Only result.ok === true is recorded.
//   inverse(entry)           -> {ok:true, cmd, os, risky, note} | {ok:false, why}    cmd: a line for exec, as is
//   summary(entries, max)    -> one short paragraph for the finish message ('' when nothing changed)
//   forChat(entries)         -> a short Markdown list, each line saying whether (and how) it can be put back
//   prepare(cmd, ctx)        -> null | {captures: [{id, kind, when, os, cmd, what, maxBytes?}]}   before an exec runs
//   cleanup(entries, ctx)    -> [{os, cmd}]          when the visit ends: the commands that remove its kept copies
//   supersede(entries)       -> [{id, by, why}]      the earlier entries a later one made moot
//
// CAPTURE BEFORE CHANGE. Some changes leave nothing to put back from once they are made: a file overwritten (Set-
// Content, Out-File, >, cp or Copy-Item onto one, New-Item -Force) or deleted (Remove-Item, del, rm), a registry
// value set or deleted (Set-ItemProperty, New-ItemProperty -Force, reg add /v, Remove-ItemProperty, reg delete /v),
// a service's startup type (Set-Service -StartupType, sc config start=), a unit enabled, disabled, masked (systemctl),
// permissions (chmod, chown, chgrp, icacls). The serve asks first:
//   prepare(cmd, ctx) -> null | {captures: [{id, kind, when, os, cmd, what, maxBytes?}]}
//     ctx as for record, and: visit -- the folder this visit's copies go in ([A-Za-z0-9_-], 1..64; 'visit' when none:
//     pass one, unique to the visit); maxBytes -- the copy cap (16 MB unless set; 64 MB at most). Only an exec is
//     prepared: a Terminal line runs as the Terminal's user, in a folder only its prompt says.
//     kind 'backup' (when 'before') keep a copy of a file before it is overwritten or deleted, with its size, times,
//                                   attributes (Windows) or mode and owner (Linux), and a hash of the copy
//          'stamp'  (when 'after')  what the command left there (size, time, hash), so that putting the copy back
//                                   can refuse when the file changed AGAIN since
//          'value'  (before, after) a registry value (type, data), a service's Start and DelayedAutostart, a unit's
//                                   is-enabled and is-active, a file's mode and owner (ls -ldn), a file's DACL and
//                                   owner (icacls); read after the command too, for the same refusal
//          'exists' (before)        was the folder (mkdir -p, New-Item -Force) or the registry key (reg add) there?
//     `what` says it in a sentence; `maxBytes` is the cap a backup holds to.
//   The serve runs every 'before' capture through exec as it is, then the command, then -- if it succeeded -- every
//   'after' one, and calls record(cmd, result, {..., captured: [{id, ok, output}]}) with what each printed (a failed
//   or missing one is fine: that change is then as it would be without). A capture prints ONE line,
//   {"undo":"<id>","ok":true|false,...}, ASCII with \uXXXX escapes, found by its id among whatever else is printed;
//   an id is k<n>-<8 hex>, the hex a hash of what it reads, so an answer from another command never matches. Each is
//   one PowerShell or sh line, well inside cmd.exe's 8,191 characters (a capture that would not fit is not offered).
//   Without ctx.captured record() is what it always was. With it:
//     * a file overwritten, emptied, appended to, edited in place or touched is put back from its copy, its time and
//       attributes (Windows) or mode (Linux) too -- only if it is still EXACTLY what the command left: size and
//       SHA-256 (Windows), cksum's CRC and size (Linux), against the 'stamp'. The copy is checked against the hash
//       taken when it was made; PowerShell reads it once and writes those very bytes, so a copy changed or swapped in
//       the folder is refused, never written. A file the command CREATED where nothing was (>, Set-Content, cp,
//       touch) is deleted -- only if it is still exactly as made. A file deleted is made again from its copy (times,
//       attributes; mode, and owner when run as root) -- only if nothing is at that path now, and never over anything
//       (CreateNew; set -C). A file a move or a copy replaced is put back: the move moved back first.
//     * a registry value goes back to its old type and data -- or is deleted, with its key when the command made the
//       key and nothing else is in it -- only if it is still what the command set; a deleted one is put back only if
//       there is none now. A key reg add made is deleted only while empty.
//     * a service's startup type (sc.exe config ... start= auto|delayed-auto|demand|disabled|boot|system), a unit's
//       enabled state (systemctl enable|disable|mask|unmask) and, after --now, its running state, a file's mode and
//       owner (chmod, chown), a file's DACL (SetAccessControl) and owner (icacls /setowner) -- each only if it is
//       still what the command left.
//     * what was that way already -- a folder or key already there, a value set to what it had, the same bytes --
//       is no change: no entry. The last change to a thing in a command carries the undo; an earlier one to the same
//       thing says it is put back with it.
//   WHERE THE COPIES GO. Windows: [IO.Path]::GetTempPath()\agent-drive-undo\<visit>\ -- C:\Windows\Temp\... for the
//   host's LocalSystem -- each folder made with a protected DACL (this account and Administrators only) and refused
//   when it is a link or owned by anyone else; a copy is k<n>-<8 hex>-<12 hex>.bak, created new. Linux: ${TMPDIR:-
//   /tmp}/agent-drive-undo-<uid>/<visit>/, mkdir -m 700, refused when it is a link or not this account's; a copy is
//   made by mktemp. A refusal answers "unsafe" and nothing is copied.
//   THE CAP: one file at most 16 MB, a visit's copies 256 MB together. A capture is one exec, which the host ends at
//   10 s: reading, writing and hashing 16 MB fits that with PowerShell's start on a slow disk; putting it back reads
//   the copy into memory to check and write the same bytes; and the temp folder sits on the system drive, no place
//   to duplicate a database or a video unasked. Over it the answer is "too big" and the change stays "cannot be put
//   back", saying so. A folder is never copied (no cap holds a tree), nor is a link.
//   STILL NOT REVERSIBLE, AND WHY: what a wildcard, a pipeline or an unknown variable named (which files is not known
//   before it runs); a folder deleted with what was in it, and cp -r / Copy-Item -Recurse of one (trees are never
//   copied); a file over the cap; a link deleted; a registry KEY deleted, or emptied by New-Item -Force (its content
//   is a tree); reg delete /va; a registry value of a type .NET cannot write back, or over 4 KB (an undo is one
//   command line); chmod -R, chown -R, icacls /T (trees); icacls /setintegritylevel, /restore, /substitute; a service
//   deleted, or reconfigured another way (sc config without start=, Set-Service -DisplayName); a process ended; a
//   Terminal line's changes; a sudo command's path through $HOME or a variable (root's would be read, not the
//   command's); an overwrite whose 'after' read is missing (it could not tell a later change from its own -- its copy
//   is kept, and the hint says where); past 16 captures in one command (8 files overwritten), the rest, as without --
//   each capture is an exec; anything once cleanup() has removed the copies.
//   cleanup(entries, ctx) -> [{os, cmd}]: run when the visit ends. Removes the copies in the visit's folder (ctx.visit
//   on ctx.os) and in each folder an entry's backup names -- only files named as a copy is named -- then each folder,
//   and agent-drive-undo itself, if empty; under sudo again for copies made under sudo. Prints
//   {"undo":"cleanup","ok":true,"removed":N}.
//
// WHAT A LATER CHANGE MADE MOOT. An entry's paths are lists of where it acted: made (created or changed there), from
// and to (a move or a rename), removed (deleted). On Windows a variable is written %NAME% and ~ %USERPROFILE%, on
// Linux $NAME and $HOME; a registry key Registry::HKEY_...\key, a value Registry::HKEY_...\key\name. supersede(entries)
// lists each earlier entry that a later one made moot -- neither put back (`undone`) -- because the later one deleted
// or moved away a path that IS or HOLDS what the earlier one made, changed or moved there, or that holds the folder
// the earlier one would put something back into: a folder made, a file put in it, then the folder deleted with all
// in it -- both earlier entries are moot, by the delete. Paths are compared as written (Windows: either slash, any
// case; . and .. resolved): one written through a variable never meets one written out, so it errs toward listing
// less. `why` names what the later one did, and "put cN back first" when that one can be.
//
// WHAT IT READS. exec runs `cmd.exe /c <line>` on Windows -- builtins, or `powershell -Command "..."` -- and
// `/bin/sh -c` on Linux; terminal types a line into the Terminal panel's shell. Each is read the way its shell reads
// it: statements (; && || | and line breaks), quoting ('...', "...", ^, `, \, PowerShell's '' doubling and its
// typographic quotes), named and positional parameters (-Dest is -Destination), %NAME% / $env:NAME / $HOME / ~, cd,
// a variable set to a literal, powershell / cmd / sh -c inside another shell, sudo. Recognised: moving, renaming,
// copying, making and deleting files and folders; registry values and keys; starting, stopping and enabling
// services; ending processes; writing files (Set-Content, Out-File, > and >>); links and permissions on Linux. A
// command it cannot name is still an entry -- "ran a command: ..." -- so nothing that ran is missing from the
// record; one that only reads (dir, Get-ChildItem, cat, systemctl status) is no change at all.
//
// THE RULES IT KEEPS
//   * an undo is offered only when it is sure what to put back, and it is written to FAIL rather than harm: every
//     path a quoted literal (PowerShell: single quotes with every quote character it knows doubled, -LiteralPath,
//     and % " as [char]N so cmd.exe passes them through untouched; sh: single quotes with '\'' and --); a move back
//     never lands on something that is there now; a delete removes only what was made -- a file, or a folder only
//     while it is EMPTY (never -Recurse, never rm -r);
//   * where a moved item went is worked out when the undo RUNS: "move a.txt D:\x" put it INSIDE D:\x when that was
//     a folder, else it became D:\x -- so the undo looks first (Test-Path -PathType Container, then Join-Path with
//     the name; sh: [ -d ], then the name), and the undo of THAT, fed back to record(), reads as the move it undoes;
//   * what cannot be put back says why, plainly: Remove-Item and rm use no Recycle Bin, Set-Content kept no old
//     contents, the registry value's old setting was never read (unless prepare() kept or read it first), a closed
//     program cannot be resumed;
//   * typed text is never stored: its length (what the panel shows anyway) and the window it went into.
//
// THE CASES IT IS BUILT FOR
//   * "move report.docx D:\Archive": if Archive was a folder the file is inside it, else the file became Archive --
//     only the disk can say which, so the undo asks it when it runs;
//   * "Bob’s report.docx": ’ is a quote character to PowerShell, so an undo that doubled only ' would end its string
//     there; and inside cmd.exe's double quotes % is still %NAME% expansion;
//   * a folder the agent made that somebody has since put files in is no longer only "what was made";
//   * a Terminal line's relative path, %USERPROFILE% or ~ belong to the Terminal (its folder, its user), not to the
//     exec an undo runs through -- on Windows that is LocalSystem -- so they are a hint, never a command;
//   * a variable the line set itself (export D=..., for x in ...) is not in the environment of a later undo, so it
//     is followed when it is a literal and otherwise not known -- never taken for the environment's;
//   * a command read as nothing (an alias, an abbreviated parameter, a pipeline) would leave no trace at all.
//
// Pure and offline; proven in tests/undo.js, which also runs the undo commands for real against a temp folder
// (PowerShell on Windows, sh where there is one) -- and the captures, the command, the restores and cleanup().

const MAX_DEPTH = 6;          // a shell inside a shell inside a block ...
const MAX_TEXT = 64 * 1024;   // a longer command is read as one opaque entry
const MAX_ENTRIES = 40;       // per command; the rest are folded into one
const CMD_MAX = 8000;         // cmd.exe refuses a line over 8191 characters (core/desk.js keeps the same margin)
const PH_OPEN = '\uE000', PH_CLOSE = '\uE001';   // %NAME% that cmd.exe filled in before PowerShell saw the line

// ---- small things -------------------------------------------------------------------------------------------
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const oneLine = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
function clip(s, n) { const a = Array.from(String(s)); return a.length > n ? a.slice(0, Math.max(1, n - 1)).join('') + '…' : String(s); }
// a long path keeps its start and its end: the drive and the name are what a person reads
function clipMid(s, n) {
  const a = Array.from(String(s));
  if (a.length <= n) return String(s);
  const h = Math.floor((n - 1) / 2);
  return a.slice(0, h).join('') + '…' + a.slice(a.length - (n - 1 - h)).join('');
}
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const joinAnd = (xs) => (xs.length <= 1 ? xs[0] || '' : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

// Markdown that still reads well bare (the viewer lays an agent's message out as Markdown; an older one shows it
// plain): escape only what Markdown would act on, and put each path in `code`.
function mdEsc(s) {
  const a = Array.from(String(s));
  let out = '';
  for (let i = 0; i < a.length; i++) {
    const c = a[i], prev = a[i - 1] || '', next = a[i + 1] || '';
    if (c === '\\') out += !next || /[!-/:-@[-`{-~]/.test(next) ? '\\\\' : '\\';
    else if ('`*[]<~'.includes(c)) out += '\\' + c;
    else if (c === '_' && !(/[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next))) out += '\\_';
    else out += c;
  }
  return out;
}
function mdCode(t) {
  const runs = String(t).match(/`+/g) || [];
  const n = runs.reduce((m, r) => Math.max(m, r.length), 0) + 1;
  const pad = n > 1 ? ' ' : '';
  return '`'.repeat(n) + pad + t + pad + '`'.repeat(n);
}
// A sentence with its paths marked: { what: plain text, md: the same with each path as code }
function say(...pieces) {
  let what = '', md = '';
  for (const p of pieces) {
    if (p == null || p === '') continue;
    if (typeof p === 'string') { what += p; md += mdEsc(p); }
    else { const t = clipMid(oneLine(p.code), 120); what += t; md += mdCode(t); }
  }
  return { what: clip(what, 400), md: clip(md, 700) };
}

// ---- a path as the command wrote it ---------------------------------------------------------------------------
// parts: literal text {s}, an environment variable {env} (%USERPROFILE%, $env:TEMP, $HOME), the home folder {home}
// (~). The shell fills those in when it runs -- and an undo run the same way (through exec) fills them in the same
// way, so they are carried into it as variables, never guessed. `inside`: "...or <inside> within it, when it is a
// folder" -- where a move put an item when its destination may have been a folder.
function V(parts, inside) {
  const out = [];
  for (const p of parts || []) {
    if (!p) continue;
    if (p.s != null) {
      if (p.s === '') continue;
      const l = out[out.length - 1];
      if (l && l.s != null) l.s += p.s; else out.push({ s: p.s });
    } else if (p.env != null) out.push({ env: p.env, st: p.st || '' });
    else if (p.home) out.push({ home: 1 });
  }
  return { parts: out, inside: inside || null };
}
const lit = (s) => V([{ s: String(s) }]);
const textOf = (v) => (v && v.parts.every((p) => p.s != null) ? v.parts.map((p) => p.s).join('') : null);
const isSepC = (c, os) => c === '/' || (os === 'windows' && c === '\\');
const lastSep = (s, os) => Math.max(s.lastIndexOf('/'), os === 'windows' ? s.lastIndexOf('\\') : -1);
function trimSeps(s, os) { let e = s.length; while (e > 1 && isSepC(s[e - 1], os)) e--; return s.slice(0, e); }
const pkey = (v) => JSON.stringify(v.parts.map((p) => (p.s != null ? ['s', p.s] : p.env != null ? ['e', p.env] : ['h'])));
function isAbs(v, os) {
  const f = v && v.parts[0];
  if (!f) return false;
  if (f.s == null) return true;                                                // %USERPROFILE%\..., $HOME/..., ~/...
  return os === 'windows' ? /^([A-Za-z]:[\\/]|[\\/]|[\w.]+::|[A-Za-z]\w+:([\\/]|$))/.test(f.s) : f.s[0] === '/';
}
function joinP(base, rel, os) {
  if (!base || !base.parts.length) return rel;
  const rp = rel.parts.slice();
  if (rp[0] && rp[0].s != null) {
    const t = rp[0].s.replace(os === 'windows' ? /^(\.[\\/]+)+/ : /^(\.\/+)+/, '');
    rp[0] = { s: t === '.' ? '' : t };
  }
  const r = V(rp);
  if (!r.parts.length) return base;
  const bl = base.parts[base.parts.length - 1];
  const sepEnd = bl && bl.s != null && isSepC(bl.s[bl.s.length - 1], os);
  return V(base.parts.concat(sepEnd ? [] : [{ s: os === 'windows' ? '\\' : '/' }], r.parts));
}
function leafOf(v, os) {
  const l = v && v.parts[v.parts.length - 1];
  if (!l || l.s == null) return null;
  const s = trimSeps(l.s, os), i = lastSep(s, os);
  if (i < 0 && v.parts.length > 1) return null;                                 // the name runs on from a variable
  const leaf = s.slice(i + 1);
  return !leaf || leaf === '.' || leaf === '..' || isSepC(leaf, os) || (os === 'windows' && /:$/.test(leaf)) ? null : leaf;
}
function parentOf(v, os) {
  const parts = v.parts.slice(), l = parts.pop();
  if (!l || l.s == null) return null;
  const s = trimSeps(l.s, os), i = lastSep(s, os);
  if (i < 0) return parts.length ? null : V([]);                                // a bare name: the current folder
  let head = s.slice(0, i + 1);
  if (!/^([A-Za-z]:)?[\\/]+$/.test(head)) head = trimSeps(head, os);           // 'C:\a\' -> 'C:\a'; 'C:\' and '/' stay
  return V(parts.concat([{ s: head }]));
}
const endsWithSep = (v, os) => { const l = v && v.parts[v.parts.length - 1]; return !!(l && l.s != null && l.s.length > 1 && isSepC(l.s[l.s.length - 1], os)); };
function normTail(v, os) {
  const parts = v.parts.slice(), l = parts[parts.length - 1];
  if (l && l.s != null) parts[parts.length - 1] = { s: trimSeps(l.s, os) };
  return V(parts);
}
const isReg = (v) => { const f = v && v.parts[0]; return !!(f && f.s != null && /^(HK(LM|CU|CR|U|CC)|HKEY_[A-Z_]+):?[\\/]|^(Microsoft\.PowerShell\.Core\\)?Registry::/i.test(f.s)); };
function shown(v) {
  if (!v) return '';
  return v.parts.map((p) => (p.s != null ? p.s : p.home ? '~' : p.st === 'cmd' ? '%' + p.env + '%' : p.st === 'ps' ? '$env:' + p.env : '$' + p.env)).join('');
}
const isHere = (v) => !v || !v.parts.length || textOf(v) === '.';
const P = (v) => (isHere(v) ? 'the current folder' : { code: shown(v) });      // a path in a sentence

// ---- writing a path into an undo -----------------------------------------------------------------------------
// PowerShell, inside cmd.exe's double quotes: single-quoted, every quote character PowerShell knows doubled (it
// takes ‘ ’ ‚ ‛ for ' -- "Bob’s report" ends a string written with only ' doubled), and % " and control characters,
// which cmd.exe would expand, end its quoting on, or cut the line at, as [char]N.
const PS_SQ_RE = /['\u2018\u2019\u201A\u201B]/g;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const psq = (s) => "'" + s.replace(PS_SQ_RE, (m) => m + m) + "'";
function psValue(v) {
  if (!v || !v.parts) return null;
  const pieces = [];
  for (const p of v.parts) {
    if (p.home) pieces.push('$HOME');
    else if (p.env != null) {
      if (/[%"\u0000-\u001f]/.test(p.env)) return null;
      pieces.push(NAME_RE.test(p.env) ? '$env:' + p.env : '${env:' + p.env.replace(/[`{}]/g, '`$&') + '}');
    } else {
      let buf = '';
      for (const ch of p.s) {
        const c = ch.codePointAt(0);
        if (ch === '%' || ch === '"' || c < 32 || c === 127) { if (buf) pieces.push(psq(buf)); buf = ''; pieces.push('[char]' + c); } else buf += ch;
      }
      if (buf) pieces.push(psq(buf));
    }
  }
  if (!pieces.length) return "''";
  if (pieces.length === 1 && pieces[0][0] === "'") return pieces[0];
  return '(' + (pieces[0][0] === '[' ? "'' + " : '') + pieces.join(' + ') + ')';
}
// sh: single quotes, a ' as '\'' ; a variable as "${NAME}" next to them (one word)
const sq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
function shValue(v) {
  if (!v || !v.parts) return null;
  const out = [];
  for (const p of v.parts) {
    if (p.home) out.push('"$HOME"');
    else if (p.env != null) { if (!NAME_RE.test(p.env)) return null; out.push('"${' + p.env + '}"'); }
    else { if (p.s.includes('\u0000')) return null; out.push(sq(p.s)); }
  }
  return out.length ? out.join('') : "''";
}
// cmd.exe: one double-quoted argument -- nothing inside that cmd.exe would still act on
const cmdq = (s) => (s && !/["%\u0000-\u001f]/.test(s) ? '"' + s + '"' : null);
// ...and a path that way: an environment part as %NAME% (cmd.exe fills it in, as it did for the command undone)
function cmdValue(v) {
  if (!v || !v.parts.length) return null;
  let out = '';
  for (const p of v.parts) {
    if (p.home) out += '%USERPROFILE%';
    else if (p.env != null) { if (!/^[A-Za-z_][^%"=:\s]*$/.test(p.env)) return null; out += '%' + p.env + '%'; }
    else { if (/["%\u0000-\u001f]/.test(p.s)) return null; out += p.s; }
  }
  return '"' + out + '"';
}
function psLine(lines) {
  if (lines.some((l) => l == null)) return null;
  const cmd = 'powershell -NoProfile -NonInteractive -Command "' + ["$ErrorActionPreference = 'Stop'"].concat(lines).join('; ') + '"';
  return cmd.length > CMD_MAX ? null : cmd;
}
function shLine(lines, sudo) {
  if (lines.some((l) => l == null)) return null;
  const script = lines.join('; ');
  // run as the original ran -- under sudo (or doas) when it was; -n: never stop to ask for a password
  const cmd = sudo ? (sudo.tool === 'doas' ? 'doas' : 'sudo') + ' -n ' + (sudo.user ? '-u ' + sq(sudo.user) + ' ' : '') + 'sh -c ' + sq(script) : script;
  return cmd.length > CMD_MAX ? null : cmd;
}

// ============================================================================================================
// THE THREE SHELLS. Each turns a line into ITEMS: {k:'pipe', els:[element...]} (an element is a command
// {k:'cmd', shell, ...} or an expression), {k:'assign'}, {k:'if'|'loop'|'try'|'group'|'compound'}, each with its
// source text `src`. Words are {parts:[{s}|{env}|{home}|{var}|{x}], ...}: literal text, a variable, an opaque
// piece ({x}: $(...), a sub-expression) that only an evaluator may read.
// ============================================================================================================

// ---- cmd.exe --------------------------------------------------------------------------------------------------
// Statements split on & && || | and line breaks outside quotes (a (...) block that opens a statement, or follows
// if/for, is one statement); ^ escapes outside quotes; " toggles quoting and is not part of the value; %NAME% is
// the environment, filled in inside quotes too.
function cmdStatements(src) {
  const out = [];
  let start = 0, i = 0, inQ = false, depth = 0;
  const n = src.length;
  const cut = (end) => { const t = src.slice(start, end); if (t.trim()) out.push(t); };
  while (i < n) {
    const c = src[i];
    if (c === '\r' || c === '\n') { cut(i); i++; start = i; inQ = false; depth = 0; continue; }
    if (inQ) { if (c === '"') inQ = false; i++; continue; }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === '^') { i += 2; continue; }
    if (c === '(' && (depth > 0 || /^[\s@]*(\(|(if|for)(?![^\s(]))/i.test(src.slice(start, i + 1)))) { depth++; i++; continue; }
    if (c === ')' && depth > 0) { depth--; i++; continue; }
    if (depth === 0 && (c === '&' || c === '|') && !(c === '&' && /[<>]$/.test(src.slice(start, i)))) {
      cut(i); i += src[i + 1] === c ? 2 : 1; start = i; continue;
    }
    i++;
  }
  cut(n);
  return out;
}
function cmdWord(text, i) {
  const parts = [], s = i, n = text.length;
  let buf = '', cooked = '', inQ = false, quoted = false, glob = false;
  const flush = () => { if (buf) { parts.push({ s: buf }); buf = ''; } };
  while (i < n) {
    const c = text[i];
    if (!inQ && (c === ' ' || c === '\t' || c === '>' || c === '<')) break;
    if (c === '"') { inQ = !inQ; quoted = true; cooked += c; i++; continue; }
    if (!inQ && c === '^') { if (i + 1 < n) { buf += text[i + 1]; cooked += text[i + 1]; } i += 2; continue; }
    if (c === '%') {
      const m = /^%([A-Za-z_][^%\r\n"=: ]*)%/.exec(text.slice(i, i + 260));
      if (m) { flush(); parts.push({ env: m[1], st: 'cmd' }); cooked += PH_OPEN + m[1] + PH_CLOSE; i += m[0].length; continue; }
      const m2 = /^%[A-Za-z_][^%\r\n"]*:[^%\r\n]*%/.exec(text.slice(i, i + 260));   // %NAME:~0,3% %NAME:a=b%
      if (m2) { flush(); parts.push({ x: m2[0] }); cooked += m2[0]; i += m2[0].length; continue; }
    }
    if (c === PH_OPEN) {
      const j = text.indexOf(PH_CLOSE, i);
      if (j > i) { flush(); parts.push({ env: text.slice(i + 1, j), st: 'cmd' }); cooked += text.slice(i, j + 1); i = j + 1; continue; }
    }
    if (c === '*' || c === '?') glob = true;
    buf += c; cooked += c; i++;
  }
  flush();
  return { t: 'w', parts, cooked, raw: text.slice(s, i), q: quoted, glob, s, e: i };
}
function cmdCommand(text) {
  const words = [], redirs = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
    if (i >= n) break;
    const r = /^([0-9]?)(>>|>|<)(&[0-9])?/.exec(text.slice(i, i + 6));
    if (r) {
      i += r[0].length;
      if (r[3]) continue;                                                     // 2>&1: one stream into another
      while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
      const w = cmdWord(text, i);
      i = Math.max(w.e, i + (w.e === i ? 1 : 0));
      if (r[2] !== '<') redirs.push({ op: r[2], fd: r[1] || '1', target: w });
      continue;
    }
    const w = cmdWord(text, i);
    if (w.e <= i) { i++; continue; }
    i = w.e;
    words.push(w);
  }
  // cd.. cd\ md\x -- cmd.exe ends a builtin's name at a dot or a slash
  if (words[0] && !words[0].q && words[0].parts.length === 1 && words[0].parts[0].s != null) {
    const m = /^(cd|chdir|md|mkdir|rd|rmdir)([.\\/].*)$/i.exec(words[0].parts[0].s);
    if (m) words.splice(0, 1, mkWord(m[1]), mkWord(m[2]));
  }
  return { k: 'cmd', shell: 'cmd', words, redirs, src: oneLine(text) };
}
const mkWord = (s) => ({ t: 'w', parts: [{ s }], cooked: s, raw: s, q: false, glob: /[*?]/.test(s) });
function cmdParse(src, depth) {
  const items = [];
  for (const raw of cmdStatements(String(src))) {
    const t = raw.replace(/^[\s@]+/, '');
    if (!t || /^(rem(\s|$)|::)/i.test(t)) continue;
    if (t[0] === '(') {
      const inner = t.slice(1).replace(/\)\s*$/, '');
      items.push(depth < MAX_DEPTH ? { k: 'group', items: cmdParse(inner, depth + 1), src: oneLine(raw) } : { k: 'compound', src: oneLine(raw) });
      continue;
    }
    if (/^(if|for)(?![^\s(])/i.test(t)) { items.push({ k: 'compound', src: oneLine(raw) }); continue; }
    const c = cmdCommand(t);
    if (c.words.length || c.redirs.length) items.push({ k: 'pipe', els: [c], src: c.src });
  }
  return items;
}

// The command line powershell.exe gets, split the way its runtime splits it (CommandLineToArgvW): " toggles,
// \" is a quote, backslashes count only before a quote, "" inside quotes is a quote.
function argv(line) {
  const out = [];
  let i = 0, cur = '', inQ = false, any = false;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (!inQ && (c === ' ' || c === '\t')) { if (any) { out.push(cur); cur = ''; any = false; } i++; continue; }
    if (c === '\\') {
      let k = i; while (k < n && line[k] === '\\') k++;
      const b = k - i;
      if (line[k] === '"') { cur += '\\'.repeat(b >> 1); if (b % 2) { cur += '"'; i = k + 1; } else i = k; any = true; continue; }
      cur += '\\'.repeat(b); i = k; any = true; continue;
    }
    if (c === '"') {
      any = true;
      if (inQ && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      inQ = !inQ; i++; continue;
    }
    cur += c; any = true; i++;
  }
  if (any) out.push(cur);
  return out;
}
// powershell.exe / pwsh's own options, up to the script: -Command (the rest, joined), -EncodedCommand, or -File
const PSEXE_OPTS = ['noprofile', 'noninteractive', 'nologo', 'noexit', 'sta', 'mta', 'login', 'interactive', 'nop', 'noni', 'nol', 'noe'];
const PSEXE_VALS = ['executionpolicy', 'ep', 'ex', 'windowstyle', 'w', 'inputformat', 'outputformat', 'o', 'of', 'if', 'version', 'v', 'psconsolefile', 'configurationname', 'config', 'workingdirectory', 'wd', 'settingsfile', 'custompipename'];
function psScriptOf(args, pwsh) {
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!/^[-/–]/.test(a)) return pwsh ? null : args.slice(k).join(' ');      // 5.1: the first plain argument is the command
    const nm = a.replace(/^(--?|\/|–)/, '').toLowerCase();
    if (!nm) continue;
    if (nm === 'c' || (nm.length >= 2 && 'command'.startsWith(nm))) { const rest = args.slice(k + 1); return rest.length === 1 && rest[0] === '-' ? null : rest.join(' '); }
    if (nm === 'e' || nm === 'ec' || (nm.length >= 2 && 'encodedcommand'.startsWith(nm))) {
      const b = args[k + 1] || '';
      if (!/^[A-Za-z0-9+/=]+$/.test(b)) return null;
      try { return Buffer.from(b, 'base64').toString('utf16le'); } catch (_) { return null; }
    }
    if (nm === 'f' || (nm.length >= 2 && 'file'.startsWith(nm))) return null;
    if (PSEXE_OPTS.some((o) => o === nm || (nm.length >= 3 && o.startsWith(nm)))) continue;
    if (PSEXE_VALS.some((o) => o === nm || (nm.length >= 2 && o.startsWith(nm)))) { k++; continue; }
    return null;
  }
  return null;
}

// ---- PowerShell -----------------------------------------------------------------------------------------------
const PS_SQC = "'\u2018\u2019\u201A\u201B", PS_DQC = '"\u201C\u201D\u201E', PS_DASH = '-\u2013\u2014\u2015';
const WS = (c) => c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff';
// the end of a bracketed piece, quotes and nesting respected (the index after its closer; the end of the text if none)
function balanced(src, i) {
  const n = src.length, stack = [];
  const close = { '(': ')', '{': '}', '[': ']' };
  let j = i;
  while (j < n) {
    const c = src[j];
    if (PS_SQC.includes(c)) { j = readSq(src, j).e; continue; }
    if (PS_DQC.includes(c)) { j = readDq(src, j).e; continue; }
    if (c === '`') { j += 2; continue; }
    if (own(close, c)) { stack.push(close[c]); j++; continue; }
    if (c === stack[stack.length - 1]) { stack.pop(); j++; if (!stack.length) return j; continue; }
    j++;
  }
  return n;
}
function varPart(name) {
  const m = /^([A-Za-z]+):(.+)$/.exec(name);
  if (m && m[1].toLowerCase() === 'env') return { env: m[2], st: 'ps' };
  const base = m && /^(global|script|local|private|using|variable)$/i.test(m[1]) ? m[2] : name;
  return { var: base.toLowerCase(), st: 'ps' };
}
function readPsVar(src, i) {
  if (src[i + 1] === '{') { const j = src.indexOf('}', i + 2); return j < 0 ? null : { part: varPart(src.slice(i + 2, j)), e: j + 1 }; }
  const m = /^(?:[A-Za-z]+:(?=[A-Za-z0-9_?]))?(?:[A-Za-z0-9_]+|\?|\^|\$)/.exec(src.slice(i + 1, i + 260));
  return m ? { part: varPart(m[0]), e: i + 1 + m[0].length } : null;
}
function readSq(src, i) {
  const parts = [], n = src.length;
  let j = i + 1, v = '';
  const flush = () => { if (v) { parts.push({ s: v }); v = ''; } };
  while (j < n) {
    const c = src[j];
    if (PS_SQC.includes(c)) { if (src[j + 1] && PS_SQC.includes(src[j + 1])) { v += c; j += 2; continue; } flush(); return { parts, e: j + 1 }; }
    if (c === PH_OPEN) { const k = src.indexOf(PH_CLOSE, j); if (k > j) { flush(); parts.push({ env: src.slice(j + 1, k), st: 'cmd' }); j = k + 1; continue; } }
    v += c; j++;
  }
  flush();
  return { parts, e: n };
}
const DQ_ESC = { n: '\n', r: '\r', t: '\t', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', 0: '\0' };
function readDqBody(src, j, stopAtQuote) {
  const parts = [], n = src.length;
  let buf = '';
  const flush = () => { if (buf) { parts.push({ s: buf }); buf = ''; } };
  while (j < n) {
    const c = src[j];
    if (stopAtQuote && PS_DQC.includes(c)) { if (src[j + 1] && PS_DQC.includes(src[j + 1])) { buf += c; j += 2; continue; } flush(); return { parts, e: j + 1 }; }
    if (c === '`') { const d = src[j + 1] || ''; buf += own(DQ_ESC, d) ? DQ_ESC[d] : d; j += 2; continue; }
    if (c === '$') {
      if (src[j + 1] === '(') { const k = balanced(src, j + 1); flush(); parts.push({ x: src.slice(j + 2, Math.max(j + 2, k - 1)) }); j = k; continue; }
      const r = readPsVar(src, j);
      if (r) { flush(); parts.push(r.part); j = r.e; continue; }
    }
    if (c === PH_OPEN) { const k = src.indexOf(PH_CLOSE, j); if (k > j) { flush(); parts.push({ env: src.slice(j + 1, k), st: 'cmd' }); j = k + 1; continue; } }
    buf += c; j++;
  }
  flush();
  return { parts, e: n };
}
const readDq = (src, i) => readDqBody(src, i + 1, true);
function psWord(src, i) {
  const n = src.length, s = i, parts = [];
  let buf = '', q = false, wild = false;
  const flush = () => { if (buf) { parts.push({ s: buf }); buf = ''; } };
  const c0 = src[i];
  // an expression in parentheses, $(...), @(...), @{...}: one opaque piece only an evaluator reads
  if (c0 === '(' || ((c0 === '$' || c0 === '@') && src[i + 1] === '(') || (c0 === '@' && src[i + 1] === '{')) {
    const at = c0 === '(' ? i : i + 1, j = balanced(src, at);
    return { t: 'w', parts: [{ x: src.slice(at + 1, Math.max(at + 1, j - 1)), paren: c0 === '(' }], s, e: j, q: false, wild: false, expr: true };
  }
  // here-strings @'...'@ and @"..."@
  if (c0 === '@' && (PS_SQC.includes(src[i + 1]) || PS_DQC.includes(src[i + 1]))) {
    const m = /^[ \t]*\r?\n/.exec(src.slice(i + 2, i + 200));
    if (m) {
      const dq = PS_DQC.includes(src[i + 1]);
      const body = i + 2 + m[0].length;
      const re = dq ? /\r?\n[ \t]*["\u201C\u201D\u201E]@/g : /\r?\n[ \t]*['\u2018\u2019\u201A\u201B]@/g;
      re.lastIndex = body - 1;
      const hit = re.exec(src);
      const end = hit ? hit.index : n, after = hit ? hit.index + hit[0].length : n;
      const content = src.slice(body, Math.max(body, end));
      const ps = dq ? readDqBody(content, 0, false).parts : [{ s: content }];
      return { t: 'w', parts: ps, s, e: after, q: true, wild: false };
    }
  }
  if (c0 === '~' && (i + 1 >= n || src[i + 1] === '\\' || src[i + 1] === '/' || WS(src[i + 1]))) { parts.push({ home: 1 }); i++; }
  while (i < n) {
    const c = src[i];
    if (WS(c) || c === '\n' || c === '\r' || ';|&,)}{'.includes(c) || c === '>' || c === '<') break;
    if (c === '(' && i > s) break;
    if (PS_SQC.includes(c)) { flush(); const r = readSq(src, i); for (const p of r.parts) { parts.push(p); if (p.s && /[*?[]/.test(p.s)) wild = true; } q = true; i = r.e; continue; }
    if (PS_DQC.includes(c)) { flush(); const r = readDq(src, i); for (const p of r.parts) { parts.push(p); if (p.s && /[*?[]/.test(p.s)) wild = true; } q = true; i = r.e; continue; }
    if (c === '`') { if (i + 1 < n) buf += src[i + 1]; i += 2; continue; }
    if (c === '$') {
      const r = readPsVar(src, i);
      if (r) {
        flush(); parts.push(r.part); i = r.e;
        if (parts.length === 1 && (src[i] === '=' || ('+-*/'.includes(src[i]) && src[i + 1] === '='))) break;   // $x = ...
        continue;
      }
    }
    if (c === PH_OPEN) { const k = src.indexOf(PH_CLOSE, i); if (k > i) { flush(); parts.push({ env: src.slice(i + 1, k), st: 'cmd' }); i = k + 1; continue; } }
    if (c === '[') { wild = true; const j = balanced(src, i); buf += src.slice(i, j); i = j; continue; }
    if (c === '*' || c === '?') wild = true;
    buf += c; i++;
  }
  flush();
  return { t: 'w', parts, s, e: i, q, wild };
}
function psLex(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (WS(c)) { i++; continue; }
    if (c === '`' && (src[i + 1] === '\n' || src[i + 1] === '\r')) { i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 3 : 2; continue; }
    if (c === '\n' || c === '\r') { toks.push({ t: 'nl', s: i, e: i + 1 }); i++; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
    if (c === '<' && src[i + 1] === '#') { const j = src.indexOf('#>', i + 2); i = j < 0 ? n : j + 2; continue; }
    const two = src.slice(i, i + 2);
    if (two === '&&' || two === '||') { toks.push({ t: 'op', v: two, s: i, e: i + 2 }); i += 2; continue; }
    if (';|&,)}'.includes(c)) { toks.push({ t: 'op', v: c, s: i, e: i + 1 }); i++; continue; }
    if (c === '{') { const j = balanced(src, i); toks.push({ t: 'blk', inner: src.slice(i + 1, Math.max(i + 1, j - 1)), s: i, e: j }); i = j; continue; }
    const rd = /^(?:[1-6*]?>>?(?:&[12])?)/.exec(src.slice(i, i + 5));
    if (rd && rd[0] && (c === '>' || src[i + 1] === '>')) { toks.push({ t: 'rd', v: rd[0], s: i, e: i + rd[0].length }); i += rd[0].length; continue; }
    if (c === '<') { toks.push({ t: 'rd', v: '<', s: i, e: i + 1 }); i++; continue; }
    if (c === '=' || ('+-*/'.includes(c) && src[i + 1] === '=')) { const l = c === '=' ? 1 : 2; toks.push({ t: 'op', v: '=', a: c, s: i, e: i + l }); i += l; continue; }
    if (PS_DASH.includes(c)) {
      if (src[i + 1] === '-' && (i + 2 >= n || WS(src[i + 2]))) { toks.push({ t: 'op', v: '--', s: i, e: i + 2 }); i += 2; continue; }
      const m = /^[A-Za-z_?][\w?]*/.exec(src.slice(i + 1, i + 200));
      if (m) {
        let j = i + 1 + m[0].length, val = null, next = false;
        if (src[j] === ':') {
          if (j + 1 < n && !WS(src[j + 1]) && !';|&,)}\r\n'.includes(src[j + 1])) { val = psWord(src, j + 1); j = val.e; } else { next = true; j++; }
        }
        toks.push({ t: 'par', name: m[0], val, next, s: i, e: j });
        i = j;
        continue;
      }
    }
    const w = psWord(src, i);
    if (w.e <= i) { i++; continue; }
    toks.push(w);
    i = w.e;
  }
  return toks;
}
// a method that only reads (anything else on an object -- .Delete(), ::Move() -- might change something)
const SAFE_METHODS = new Set(['tostring', 'tolower', 'toupper', 'tolowerinvariant', 'toupperinvariant', 'trim', 'trimstart', 'trimend', 'replace',
  'split', 'substring', 'contains', 'startswith', 'endswith', 'indexof', 'lastindexof', 'padleft', 'padright', 'equals', 'gettype', 'join',
  'format', 'exists', 'combine', 'getfilename', 'getfilenamewithoutextension', 'getdirectoryname', 'getextension', 'getfullpath',
  'gettemppath', 'getenvironmentvariable', 'getfolderpath', 'isnullorempty', 'isnullorwhitespace', 'compare', 'parse', 'tryparse',
  'getbytes', 'getstring', 'tobase64string', 'frombase64string', 'new', 'getenumerator', 'count', 'where', 'foreach', 'add', 'sleep']);
function psExprUnsafe(toks, src) {
  if (toks.some((t) => t.t === 'op' && t.v === '=')) return true;           // $file.IsReadOnly = $true
  const re = /(?:\.|::)\s*([A-Za-z_]\w*)\s*\(/g;
  const code = String(src).replace(/'(?:[^']|'')*'|"(?:[^"`]|`.|"")*"/g, "''");   // a quoted '.Delete()' is text
  let m;
  while ((m = re.exec(code))) if (!SAFE_METHODS.has(m[1].toLowerCase())) return true;
  return false;
}
function psParse(src, depth) {
  src = String(src);
  const toks = psLex(src);
  let k = 0;
  const isSep = (t) => t.t === 'nl' || (t.t === 'op' && (t.v === ';' || t.v === '&&' || t.v === '||'));
  const kwOf = (t) => (t && t.t === 'w' && !t.q && !t.expr && t.parts.length === 1 && t.parts[0].s != null ? t.parts[0].s.toLowerCase() : '');
  const srcOf = (a, b) => oneLine(src.slice(a, b));
  const endOf = () => (toks[k - 1] ? toks[k - 1].e : src.length);
  const sub = (blk) => (depth < MAX_DEPTH ? psParse(blk.inner, depth + 1) : [{ k: 'compound', src: oneLine(blk.inner) }]);
  const skipNl = () => { while (k < toks.length && toks[k].t === 'nl') k++; };
  const nextBlk = () => { skipNl(); const t = toks[k]; if (t && t.t === 'blk') { k++; return t; } return null; };
  const condOf = () => { const c = toks[k]; if (c && c.t === 'w' && c.expr && c.parts[0] && c.parts[0].paren) { k++; return c.parts[0].x; } return ''; };
  const items = [];

  function element(list, redirs) {
    if (!list.length) return null;
    const a = list[0];
    const s = a.s, e = list[list.length - 1].e;
    // & {...} and . {...}: a block run here; & 'C:\x\tool.exe' args: a command by path
    if ((a.t === 'op' && a.v === '&') || (a.t === 'w' && kwOf(a) === '.' && list.length > 1)) {
      const b = list[1];
      if (b && b.t === 'blk') return { k: 'group', items: sub(b), src: srcOf(s, e), redirs };
      if (b && b.t === 'w') return { k: 'cmd', shell: 'ps', name: b, args: commas(list.slice(2)), redirs, src: srcOf(s, e) };
      return { k: 'expr', toks: list, unsafe: true, src: srcOf(s, e), redirs };
    }
    if (a.t === 'blk' || (a.t === 'w' && (a.q || a.expr || a.parts.length === 0 || a.parts[0].var != null || a.parts[0].env != null ||
        (a.parts[0].s != null && /^[\d[@]/.test(a.parts[0].s))))) {
      return { k: 'expr', toks: list, unsafe: psExprUnsafe(list, src.slice(s, e)), src: srcOf(s, e), redirs };
    }
    if (a.t !== 'w') return { k: 'expr', toks: list, unsafe: true, src: srcOf(s, e), redirs };
    return { k: 'cmd', shell: 'ps', name: a, args: commas(list.slice(1)), redirs, src: srcOf(s, e) };
  }
  // a, b, c in argument mode is ONE argument: an array
  function commas(list) {
    const out = [];
    for (let j = 0; j < list.length; j++) {
      const t = list[j];
      if (t.t === 'op' && t.v === ',') {
        const prev = out[out.length - 1], nx = list[j + 1];
        if (prev && nx && (prev.t === 'w' || prev.t === 'list') && nx.t === 'w') {
          if (prev.t === 'list') prev.items.push(nx); else out[out.length - 1] = { t: 'list', items: [prev, nx], s: prev.s, e: nx.e };
          j++;
        }
        continue;
      }
      out.push(t);
    }
    return out;
  }
  function pipeline() {
    const s = toks[k] ? toks[k].s : src.length, els = [];
    let cur = [], redirs = [];
    while (k < toks.length) {
      const t = toks[k];
      if (isSep(t) || (t.t === 'op' && (t.v === ')' || t.v === '}'))) break;
      if (t.t === 'op' && t.v === '|') { const el = element(cur, redirs); if (el) els.push(el); cur = []; redirs = []; k++; continue; }
      if (t.t === 'rd') {
        k++;
        if (t.v.includes('&') || t.v === '<') continue;
        const tg = toks[k];
        if (tg && tg.t === 'w') { redirs.push({ op: t.v.replace(/^[1-6*]/, ''), fd: /^[2-6]/.test(t.v) ? t.v[0] : '1', target: tg }); k++; }
        continue;
      }
      cur.push(t); k++;
    }
    const el = element(cur, redirs);
    if (el) els.push(el);
    return { k: 'pipe', els, src: srcOf(s, endOf()) };
  }

  while (k < toks.length) {
    const t = toks[k];
    if (isSep(t) || (t.t === 'op' && (t.v === ')' || t.v === '}' || t.v === ','))) { k++; continue; }
    const s0 = t.s, kw = kwOf(t);
    if (kw === 'if') {
      k++;
      const conds = [], bodies = [];
      conds.push(condOf());
      let b = nextBlk();
      if (b) bodies.push(sub(b));
      for (;;) {
        const save = k;
        skipNl();
        const w = kwOf(toks[k]);
        if (w === 'elseif') { k++; conds.push(condOf()); b = nextBlk(); if (b) bodies.push(sub(b)); continue; }
        if (w === 'else') { k++; b = nextBlk(); if (b) bodies.push(sub(b)); continue; }
        k = save;
        break;
      }
      items.push({ k: 'if', conds, bodies, src: srcOf(s0, endOf()) });
      continue;
    }
    if ((kw === 'foreach' || kw === 'for' || kw === 'while' || kw === 'until') && toks[k + 1] && toks[k + 1].t === 'w' && toks[k + 1].expr || kw === 'switch' || kw === 'do') {
      k++;
      let body = null;
      while (k < toks.length) { const x = toks[k]; if (x.t === 'blk') { body = x; k++; break; } if (isSep(x) && x.t !== 'nl') break; k++; }
      if (kw === 'do') { skipNl(); const w = kwOf(toks[k]); if (w === 'while' || w === 'until') { k++; condOf(); } }
      items.push({ k: 'loop', body: body ? sub(body) : [], src: srcOf(s0, endOf()) });
      continue;
    }
    if (kw === 'try') {
      k++;
      const b = nextBlk(), catches = [];
      let fin = [];
      for (;;) {
        const save = k;
        skipNl();
        const w = kwOf(toks[k]);
        if (w === 'catch') { k++; while (k < toks.length && toks[k].t !== 'blk' && !isSep(toks[k])) k++; const cb = nextBlk(); if (cb) catches.push(sub(cb)); continue; }
        if (w === 'finally') { k++; const fb = nextBlk(); if (fb) fin = sub(fb); continue; }
        k = save;
        break;
      }
      items.push({ k: 'try', body: b ? sub(b) : [], catches, fin, src: srcOf(s0, endOf()) });
      continue;
    }
    if (kw === 'function' || kw === 'filter' || kw === 'workflow' || kw === 'configuration' || kw === 'class' || kw === 'enum' || kw === 'trap') {
      k++;
      while (k < toks.length && toks[k].t !== 'blk' && !(isSep(toks[k]) && toks[k].t !== 'nl')) k++;
      if (toks[k] && toks[k].t === 'blk') k++;
      continue;
    }
    if (kw === 'begin' || kw === 'process' || kw === 'end') {
      const b = toks[k + 1];
      if (b && b.t === 'blk') { k += 2; items.push({ k: 'group', items: sub(b), src: srcOf(s0, endOf()) }); continue; }
    }
    if (kw === 'param' || kw === 'using' || kw === 'throw' || kw === 'return' || kw === 'exit' || kw === 'break' || kw === 'continue') {
      while (k < toks.length && !isSep(toks[k])) k++;
      continue;
    }
    // $x = ..., $env:X = ..., $x += ...
    if (t.t === 'w' && !t.q && t.parts.length === 1 && (t.parts[0].var != null || t.parts[0].env != null) && toks[k + 1] && toks[k + 1].t === 'op' && toks[k + 1].v === '=') {
      const p0 = t.parts[0], how = toks[k + 1].a;
      k += 2;
      const rhs = pipeline();
      items.push({ k: 'assign', name: p0.var != null ? p0.var : 'env:' + p0.env.toLowerCase(), add: how !== '=', rhs, src: srcOf(s0, endOf()) });
      continue;
    }
    const before = k;
    const p = pipeline();
    if (p.els.length) items.push(p);
    if (k === before) k++;
  }
  return items;
}

// ---- POSIX sh ---------------------------------------------------------------------------------------------------
function shDollar(src, i) {
  const c = src[i + 1];
  if (c === '{') {
    let d = 0, j = i + 1;
    for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
    const inner = src.slice(i + 2, j);
    return { part: NAME_RE.test(inner) ? { var: inner, st: 'sh' } : { x: inner }, e: Math.min(src.length, j + 1) };
  }
  if (c === '(') { const j = shBalanced(src, i + 1); return { part: { x: src.slice(i, j) }, e: j }; }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1, i + 260));
  if (m) return { part: { var: m[0], st: 'sh' }, e: i + 1 + m[0].length };
  if (c && /[0-9@*#?$!-]/.test(c)) return { part: { x: '$' + c }, e: i + 2 };
  return null;
}
function shBalanced(src, i) {
  let d = 0, j = i;
  const n = src.length;
  while (j < n) {
    const c = src[j];
    if (c === "'") { const k = src.indexOf("'", j + 1); j = k < 0 ? n : k + 1; continue; }
    if (c === '"') { j = shDq(src, j).e; continue; }
    if (c === '\\') { j += 2; continue; }
    if (c === '(') d++;
    else if (c === ')' && --d === 0) return j + 1;
    j++;
  }
  return n;
}
function shDq(src, i) {
  const parts = [], n = src.length;
  let j = i + 1, buf = '';
  const flush = () => { if (buf) { parts.push({ s: buf, q: 2 }); buf = ''; } };
  while (j < n) {
    const c = src[j];
    if (c === '"') { flush(); return { parts, e: j + 1 }; }
    if (c === '\\' && '$`"\\\n'.includes(src[j + 1] || 'x')) { if (src[j + 1] !== '\n') buf += src[j + 1]; j += 2; continue; }
    if (c === '$') { const r = shDollar(src, j); if (r) { flush(); parts.push(r.part); j = r.e; continue; } }
    if (c === '`') { const k = src.indexOf('`', j + 1); flush(); parts.push({ x: src.slice(j, k < 0 ? n : k + 1) }); j = k < 0 ? n : k + 1; continue; }
    buf += c; j++;
  }
  flush();
  return { parts, e: n };
}
const ANSI_C = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
function shWord(src, i) {
  const n = src.length, s = i, parts = [];
  let buf = '', glob = false, quoted = false;
  const flush = () => { if (buf) { parts.push({ s: buf, q: 0 }); buf = ''; } };
  if (src[i] === '~' && (i + 1 >= n || src[i + 1] === '/' || ' \t\n;&|()<>'.includes(src[i + 1]))) { parts.push({ home: 1 }); i++; }
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || ';&|()<>'.includes(c)) break;
    if (c === "'") { const j = src.indexOf("'", i + 1), e = j < 0 ? n : j; flush(); parts.push({ s: src.slice(i + 1, e), q: 1 }); quoted = true; i = e + 1; continue; }
    if (c === '$' && src[i + 1] === "'") {
      let j = i + 2, v = '';
      while (j < n && src[j] !== "'") {
        if (src[j] === '\\' && j + 1 < n) {
          const d = src[j + 1];
          const hx = d === 'x' && /^[0-9A-Fa-f]{1,2}/.exec(src.slice(j + 2, j + 4));
          if (hx) { v += String.fromCharCode(parseInt(hx[0], 16)); j += 2 + hx[0].length; continue; }
          v += own(ANSI_C, d) ? ANSI_C[d] : '\\' + d; j += 2; continue;
        }
        v += src[j]; j++;
      }
      flush(); parts.push({ s: v, q: 1 }); quoted = true; i = j + 1; continue;
    }
    if (c === '"') { const r = shDq(src, i); flush(); parts.push(...r.parts); quoted = true; i = r.e; continue; }
    if (c === '\\') { if (src[i + 1] === '\n') { i += 2; continue; } if (i + 1 < n) { flush(); parts.push({ s: src[i + 1], q: 1 }); } i += 2; continue; }
    if (c === '$') { const r = shDollar(src, i); if (r) { flush(); parts.push(r.part); i = r.e; continue; } }
    if (c === '`') { const k = src.indexOf('`', i + 1); flush(); parts.push({ x: src.slice(i, k < 0 ? n : k + 1) }); i = k < 0 ? n : k + 1; continue; }
    if (c === '*' || c === '?' || c === '[') glob = true;
    if (c === '{' && /^\{[^{}\s]*(,|\.\.)[^{}\s]*\}/.test(src.slice(i, i + 200))) glob = true;
    buf += c; i++;
  }
  flush();
  return { t: 'w', parts, s, e: i, glob, q: quoted };
}
function shLex(src) {
  const toks = [], heredocs = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '\n' || c === '\r') {
      toks.push({ t: 'nl', s: i, e: i + 1 });
      i += c === '\r' && src[i + 1] === '\n' ? 2 : 1;
      // a here-document's body starts on the next line: skip it to its delimiter
      while (heredocs.length) {
        const h = heredocs.shift();
        while (i < n) {
          let j = src.indexOf('\n', i);
          if (j < 0) j = n;
          let line = src.slice(i, j).replace(/\r$/, '');
          if (h.strip) line = line.replace(/^\t+/, '');
          i = Math.min(n, j + 1);
          if (line === h.delim) break;
        }
      }
      continue;
    }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    const rd = /^([0-9]*|&)(>>|>\||>&|>|<<<|<<-|<<|<>|<&|<)/.exec(src.slice(i, i + 8));
    if (rd && (rd[1] !== '&' || rd[2][0] === '>')) {
      i += rd[0].length;
      while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
      const w = shWord(src, i);
      i = Math.max(w.e, i);
      const op = rd[2];
      if (op === '<<' || op === '<<-') { const d = w.parts.map((p) => (p.s != null ? p.s : '')).join(''); if (d) heredocs.push({ delim: d, strip: op === '<<-' }); continue; }
      if ((op === '>&' || op === '<&') && /^(\d+|-)$/.test(w.parts.map((p) => p.s || '').join(''))) continue;   // 2>&1, >&-
      toks.push({ t: 'rd', op: rd[1] === '&' ? '&' + op : op, fd: rd[1] === '&' ? 'all' : rd[1] || (op[0] === '<' ? '0' : '1'), target: w, s: i, e: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === ';;' || two === '|&') { toks.push({ t: 'op', v: two, s: i, e: i + 2 }); i += 2; continue; }
    if (';&|()'.includes(c)) { toks.push({ t: 'op', v: c, s: i, e: i + 1 }); i++; continue; }
    const w = shWord(src, i);
    if (w.e <= i) { i++; continue; }
    toks.push(w);
    i = w.e;
  }
  return toks;
}
function shParse(src, depth) {
  src = String(src);
  const toks = shLex(src);
  let k = 0;
  const isSep = (t) => t.t === 'nl' || (t.t === 'op' && (t.v === ';' || t.v === '&' || t.v === '&&' || t.v === '||' || t.v === ';;'));
  const kw = (t) => (t && t.t === 'w' && t.parts.length === 1 && t.parts[0].s != null && t.parts[0].q === 0 ? t.parts[0].s : '');
  const srcOf = (a, b) => oneLine(src.slice(a, b));
  const endOf = () => (toks[k - 1] ? toks[k - 1].e : src.length);
  const isAssign = (t) => t.t === 'w' && t.parts[0] && t.parts[0].s != null && t.parts[0].q === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t.parts[0].s);
  function assignOf(t, s0) {
    const p0 = t.parts[0], eq = p0.s.indexOf('=');
    const rest = [{ s: p0.s.slice(eq + 1), q: 0 }].concat(t.parts.slice(1));
    return { k: 'assign', name: p0.s.slice(0, eq), value: { t: 'w', parts: rest.filter((p) => p.s !== ''), glob: t.glob }, src: srcOf(s0, t.e) };
  }
  function list(stops, closeParen) {
    const items = [];
    while (k < toks.length) {
      const t = toks[k];
      if (isSep(t)) { k++; continue; }
      if (t.t === 'op' && t.v === ')') { if (closeParen) break; k++; continue; }
      if (stops.includes(kw(t))) break;
      const before = k;
      const it = statement();
      if (it) items.push(...[].concat(it));
      if (k === before) k++;
    }
    return items;
  }
  const expectKw = (w) => { if (kw(toks[k]) === w) k++; };
  function statement() {
    const t = toks[k], s0 = t.s, w = kw(t);
    if (w === '!' || w === 'time') { k++; return k < toks.length ? statement() : null; }
    if (w === 'if') {
      k++;
      const conds = [], bodies = [];
      conds.push(list(['then']));
      expectKw('then');
      bodies.push(list(['elif', 'else', 'fi']));
      for (;;) {
        const x = kw(toks[k]);
        if (x === 'elif') { k++; conds.push(list(['then'])); expectKw('then'); bodies.push(list(['elif', 'else', 'fi'])); continue; }
        if (x === 'else') { k++; bodies.push(list(['fi'])); continue; }
        expectKw('fi');
        break;
      }
      return { k: 'if', conds, bodies, src: srcOf(s0, endOf()) };
    }
    if (w === 'while' || w === 'until') {
      k++;
      const cond = list(['do']);
      expectKw('do');
      const body = list(['done']);
      expectKw('done');
      return { k: 'loop', cond, body, src: srcOf(s0, endOf()) };
    }
    if (w === 'for' || w === 'select') {
      k++;
      const loopVar = kw(toks[k]);
      while (k < toks.length && kw(toks[k]) !== 'do') k++;
      expectKw('do');
      const body = list(['done']);
      expectKw('done');
      return { k: 'loop', cond: [], body, var: NAME_RE.test(loopVar) ? loopVar : null, src: srcOf(s0, endOf()) };
    }
    if (w === 'case') {
      let d = 0;
      while (k < toks.length) { const x = kw(toks[k]); if (x === 'case') d++; else if (x === 'esac' && --d === 0) { k++; break; } k++; }
      return { k: 'compound', src: srcOf(s0, endOf()) };
    }
    if (w === '{') { k++; const items = list(['}']); expectKw('}'); return { k: 'group', items, src: srcOf(s0, endOf()) }; }
    if (t.t === 'op' && t.v === '(') { k++; const items = list([], true); if (toks[k] && toks[k].t === 'op' && toks[k].v === ')') k++; return { k: 'group', items, sub: true, src: srcOf(s0, endOf()) }; }
    if (w === '[[') { while (k < toks.length && kw(toks[k]) !== ']]' && !isSep(toks[k])) k++; if (kw(toks[k]) === ']]') k++; return null; }
    // a function: name() { ... } or function name { ... }
    if (w === 'function' || (t.t === 'w' && toks[k + 1] && toks[k + 1].t === 'op' && toks[k + 1].v === '(' && toks[k + 2] && toks[k + 2].t === 'op' && toks[k + 2].v === ')')) {
      k += w === 'function' ? 2 : 3;
      while (k < toks.length && toks[k].t === 'nl') k++;
      if (k < toks.length) statement();
      return null;
    }
    // a pipeline of simple commands
    const els = [];
    for (;;) {
      const words = [], redirs = [], assigns = [];
      const es = toks[k] ? toks[k].s : src.length;
      while (k < toks.length) {
        const x = toks[k];
        if (x.t === 'nl' || x.t === 'op') break;
        if (x.t === 'rd') { redirs.push(x); k++; continue; }
        if (!words.length && isAssign(x)) { assigns.push(assignOf(x, x.s)); k++; continue; }
        words.push(x); k++;
      }
      if (!words.length && assigns.length && !els.length && !(toks[k] && toks[k].t === 'op' && toks[k].v === '|')) {
        return assigns.concat(redirs.length ? [{ k: 'pipe', els: [{ k: 'cmd', shell: 'sh', words: [], redirs, src: srcOf(es, endOf()) }], src: srcOf(es, endOf()) }] : []);
      }
      if (words.length || redirs.length) els.push({ k: 'cmd', shell: 'sh', words, redirs, assigns, src: srcOf(es, endOf()) });
      const x = toks[k];
      if (x && x.t === 'op' && (x.v === '|' || x.v === '|&')) { k++; continue; }
      break;
    }
    return els.length ? { k: 'pipe', els, src: srcOf(s0, endOf()) } : null;
  }
  return list([]);
}

// ============================================================================================================
// READING WHAT IT DID. analyze() walks the items with an environment -- the shell, the OS, the folder the command
// had moved to (cwd: null = where it started, a path, or false = not known), the variables it set -- and collects
// FACTS: {effect} (a change it can name) or {unknown: src} (a statement that may have changed something).
// ============================================================================================================
function newEnv(os, shell, cwd) { return { os, shell, cwd: cwd === undefined ? null : cwd, stack: [], vars: new Map(), cond: false, loop: false, sudo: null, depth: 0 }; }
const varKey = (env, name) => (env.shell === 'sh' ? name : String(name).toLowerCase());
function setVar(env, name, val) {
  const key = varKey(env, name);
  if (env.loop) { env.vars.set(key, { unknown: true }); return; }
  if (env.cond) {
    const old = env.vars.get(key);
    if (!old || old.unknown || !val) { env.vars.set(key, { unknown: true }); return; }
    const alts = old.alts.slice();
    if (!alts.some((a) => pkey(a) === pkey(val) && a.inside === val.inside)) alts.push(val);
    env.vars.set(key, alts.length > 2 ? { unknown: true } : { alts });
    return;
  }
  env.vars.set(key, val ? { alts: [val] } : { unknown: true });
}
// a variable that may hold two values -- P, or P with a name joined on -- is P, "or <name> inside it"
function collapse(e, os) {
  if (!e || e.unknown || !e.alts.length) return null;
  if (e.alts.length === 1) return e.alts[0];
  const [x, y] = e.alts;
  for (const [a, b] of [[x, y], [y, x]]) {
    if (a.inside || b.inside) continue;
    const L = leafOf(b, os), pb = parentOf(b, os);
    if (L && pb && pkey(normTail(pb, os)) === pkey(normTail(a, os))) return V(a.parts, L);
  }
  return null;
}
// variables that are different every time they are read (or say where the shell is): never carried into an undo
const DYNAMIC = new Set(['RANDOM', 'SRANDOM', 'TIME', 'DATE', 'CD', 'ERRORLEVEL', 'CMDCMDLINE', 'CMDEXTVERSION', 'SECONDS', 'LINENO', 'BASHPID',
  'PPID', 'EPOCHSECONDS', 'EPOCHREALTIME', 'PWD', 'OLDPWD', '_', 'BASH_COMMAND', 'HISTCMD']);
// A Terminal line's environment is the Terminal's (its user, its home), and an undo runs through exec -- on Windows
// as the host's own account (LocalSystem; see core/desk/launch.ps1) -- so a Terminal line's %USERPROFILE%, $HOME or
// ~ is never carried into an undo: env.foreign.
function readVar(env, part) {
  if (part.env != null) {
    const key = 'env:' + (env.os === 'windows' ? part.env.toLowerCase() : part.env);
    if (env.vars.has(key)) return collapse(env.vars.get(key), env.os);
    if (env.foreign || DYNAMIC.has(env.os === 'windows' ? part.env.toUpperCase() : part.env)) return null;
    return V([{ env: part.env, st: part.st }]);
  }
  const key = varKey(env, part.var);
  if (env.vars.has(key)) return collapse(env.vars.get(key), env.os);
  if (part.st === 'ps') return part.var === 'home' && !env.foreign ? V([{ home: 1 }]) : null;   // a PowerShell variable this command never set
  // sh: a variable the line never set is the environment the shell started with -- which an undo run the same way has too
  return NAME_RE.test(part.var) && !DYNAMIC.has(part.var) && !env.foreign ? V([{ env: part.var, st: 'sh' }]) : null;
}
function evalWord(w, env) {
  if (!w || w.t !== 'w' || !w.parts) return null;
  const ps = w.parts;
  if (ps.length === 1 && (ps[0].var != null || ps[0].env != null)) return readVar(env, ps[0]);
  const out = [];
  for (const p of ps) {
    if (p.s != null) out.push({ s: p.s });
    else if (p.home) { if (env.foreign) return null; out.push({ home: 1 }); }
    else if (p.env != null || p.var != null) { const v = readVar(env, p); if (!v || v.inside) return null; out.push(...v.parts); }
    else if (p.x != null) { const v = env.shell === 'ps' && p.paren !== undefined ? psEvalExpr(p.x, env) : null; if (!v || v.inside) return null; out.push(...v.parts); }
    else return null;
  }
  return V(out);
}
// A PowerShell expression this module can work out: Join-Path A B, or literals, $env:X, $HOME, $var and [char]N
// joined with +. Anything else is not known.
function psEvalExpr(text, env) {
  if (env.depth > MAX_DEPTH) return null;
  const items = psParse(text, MAX_DEPTH);
  if (items.length !== 1 || items[0].k !== 'pipe' || items[0].els.length !== 1) return null;
  const el = items[0].els[0], sub = Object.assign({}, env, { depth: env.depth + 1 });
  if (el.k === 'cmd') return joinPathOf(el, sub);
  if (el.k === 'expr') return psConcat(el.toks, sub);
  return null;
}
function psConcat(toks, env) {
  const out = [];
  let want = true;
  for (const t of toks) {
    if (want) {
      if (t.t !== 'w') return null;
      const bare = t.parts.length === 1 && t.parts[0].s != null && !t.q ? t.parts[0].s : null;
      let v;
      if (bare != null) {
        const m = /^\[char\](\d{1,7})$/i.exec(bare);
        if (m && +m[1] <= 0x10ffff) v = lit(String.fromCodePoint(+m[1]));
        else if (/^\d+$/.test(bare)) v = lit(bare);
        else return null;
      } else v = evalWord(t, env);
      if (!v || v.inside) return toks.length === 1 && v ? v : null;
      out.push(...v.parts);
      want = false;
    } else if (!(t.t === 'w' && t.parts.length === 1 && t.parts[0].s === '+' && !t.q)) return null;
    else want = true;
  }
  return want ? null : V(out);
}
function joinPathOf(el, env) {
  const n = cmdNameOf(el, env);
  if (n !== 'join-path') return null;
  const b = bind(CMDLETS['join-path'], el.args);
  if (!b || !own(b, 'Path') || !own(b, 'ChildPath') || own(b, 'Resolve')) return null;
  const p = evalWord(b.Path, env), c = evalWord(b.ChildPath, env);
  if (!p || !c || p.inside || c.inside) return null;
  let out = joinP(p, c, env.os);
  if (own(b, 'AdditionalChildPath')) { const a = evalWord(b.AdditionalChildPath, env); if (!a) return null; out = joinP(out, a, env.os); }
  return out;
}

// ---- the walk ------------------------------------------------------------------------------------------------
function analyze(items, env, facts) {
  for (const it of items || []) {
    if (facts.length > MAX_ENTRIES * 10) { facts.capped = true; return; }       // enough to say "at least"
    try { step(it, env, facts); } catch (_) { unknown(facts, (it && it.src) || ''); }
  }
}
function unknown(facts, src) {
  const s = oneLine(src || '');
  const last = facts[facts.length - 1];
  if (last && last.unknown === s) return;
  facts.push({ unknown: s });
}
const MUT_RE = /\b(move-item|rename-item|copy-item|new-item|remove-item|set-itemproperty|new-itemproperty|remove-itemproperty|set-content|add-content|clear-content|out-file|start-service|stop-service|restart-service|set-service|stop-process|start-process|invoke-expression|iex|mi|mv|ni|ri|rm|rmdir|rd|del|erase|move|copy|cp|cpi|ren|rename|rni|md|mkdir|reg|sc|net|taskkill|kill|pkill|killall|touch|ln|chmod|chown|chgrp|systemctl|service|tee|truncate|shutdown|reboot|restart-computer|stop-computer|format|diskpart|cmd|powershell|pwsh|sh|bash)\b|(^|[^-=!<])>(?!\s*(\$null|nul\b|\/dev\/null|&))|\.(delete|moveto|copyto|kill|stop|start|create|write|remove|set\w*)\s*\(/i;
// a condition or a block this module does not read in full: could it change anything? (quoted text is a name, not a command)
const mutatingText = (s) => MUT_RE.test(String(s || '').replace(/'(?:[^']|'')*'|"(?:[^"`\\]|`.|\\.|"")*"/g, "''"));
function step(it, env, facts) {
  switch (it.k) {
    case 'pipe': return pipeStep(it, env, facts);
    case 'assign': return assignStep(it, env, facts);
    case 'group': { const save = env.cwd; analyze(it.items, env, facts); if (it.sub) env.cwd = save; return undefined; }
    case 'if': case 'loop': case 'try': return compoundStep(it, env, facts);
    case 'compound': if (mutatingText(it.src)) unknown(facts, it.src); return undefined;
    case 'expr': if (it.unsafe) unknown(facts, it.src); return undefined;
    default: return undefined;
  }
}
function compoundStep(it, env, facts) {
  const inner = [];
  const cenv = Object.assign({}, env, { cond: true, loop: env.loop || it.k === 'loop' });
  if (it.k === 'if') {
    for (const c of it.conds) { if (typeof c === 'string') { if (mutatingText(c)) inner.push({ unknown: c }); } else analyze(c, cenv, inner); }
    for (const b of it.bodies) analyze(b, cenv, inner);
  } else if (it.k === 'loop') {
    if (it.var) setVar(env, it.var, null);                                       // for x in ...: $x is not known
    analyze(it.cond || [], cenv, inner);
    analyze(it.body, cenv, inner);
  } else {
    analyze(it.body, env, facts);                                               // the try block ran
    for (const c of it.catches) analyze(c, cenv, inner);
    analyze(it.fin, env, facts);
  }
  if (cenv.cwd !== env.cwd) env.cwd = false;                                     // a cd inside a branch: the folder after it is not known
  if (inner.length) unknown(facts, it.src);
}
function assignStep(it, env, facts) {
  let val = null;
  if (it.value) val = evalWord(it.value, env);
  else if (it.rhs) {
    const r = it.rhs;
    if (r.k === 'pipe' && r.els.length === 1 && r.els[0].k === 'expr') {
      val = psConcat(r.els[0].toks, env);
      if (!val && r.els[0].unsafe) unknown(facts, r.src);
    } else if (r.k === 'pipe' && r.els.length === 1 && r.els[0].k === 'cmd' && (val = joinPathOf(r.els[0], env))) { /* Join-Path */ } else analyze([r], env, facts);   // $r = Move-Item ... -PassThru still moved it
  }
  if (it.add) val = null;
  setVar(env, it.name, val);
}
function pipeStep(it, env, facts) {
  let prev = null;
  for (const el of it.els) {
    if (el.k === 'group') analyze(el.items, env, facts);
    else if (el.k === 'expr') { if (el.unsafe) unknown(facts, it.src); }
    else if (el.k === 'cmd') {
      if (el.shell === 'ps') psCommand(el, env, facts, prev, it);
      else if (el.shell === 'cmd') cmdCommandStep(el, env, facts, it);
      else shCommand(el, env, facts, it, prev);
    }
    for (const r of el.redirs || []) redirect(r, env, facts);
    prev = el;
  }
}
function redirect(r, env, facts) {
  const op = r.op || '';
  if (op[0] === '<' || r.fd === '0' || !r.target) return;
  const v = evalWord(r.target, env), t = v ? textOf(v) : null;
  if (t != null && /^(nul|nul:|con|con:|\/dev\/(null|stdout|stderr|tty|fd\/\d+))$/i.test(t)) return;
  if (r.target.parts && r.target.parts.length === 1 && r.target.parts[0].var === 'null') return;   // > $null
  facts.push({ effect: writeEffect(env, argOf(r.target, env, false), op.includes('>>') ? 'append' : 'overwrite', op.replace(/^&/, '') === '>|' ? '>|' : op.includes('>>') ? '>>' : '>') });
}
// one argument, evaluated: {v: the value (null when not known), raw: as written, glob: a wildcard in it}
function argOf(w, env, wildOk) {
  if (!w) return { v: null, raw: '', glob: false };
  if (w.t === 'list') return { v: null, raw: w.items.map((x) => rawOf(x)).join(', '), glob: false, many: true };
  return { v: evalWord(w, env), raw: rawOf(w), glob: wildOk === false ? false : !!(w.glob || (wildOk && w.wild)) };
}
function rawOf(w) {
  if (!w) return '';
  if (w.t === 'list') return w.items.map(rawOf).join(', ');
  if (w.raw != null) return oneLine(w.raw);
  return oneLine((w.parts || []).map((p) => (p.s != null ? p.s : p.env != null ? (p.st === 'cmd' ? '%' + p.env + '%' : p.st === 'ps' ? '$env:' + p.env : '$' + p.env) : p.home ? '~' : p.var != null ? '$' + p.var : p.x != null ? '(…)' : '')).join(''));
}
// where a path the command named really is: absolute as it is; relative against the folder the command had moved
// to -- or as it is when it never moved, since an undo run the same way starts in the same folder; not known when
// the folder it ran in is not known (a Terminal line, a cd to somewhere unknown)
function at(env, v) {
  if (!v) return null;
  if (isAbs(v, env.os)) return v;
  if (env.cwd === false) return null;
  return env.cwd ? V(joinP(env.cwd, V(v.parts), env.os).parts, v.inside) : v;
}
const whyOf = (env, a) => (a.glob ? 'glob' : a.pipe ? 'pipe' : a.many ? 'var' : !a.v ? 'var' : !at(env, a.v) ? 'cwd' : '');
function cd(env, a, push) {
  if (push) env.stack.push(env.cwd);
  if (!a || !a.v || a.v.inside) { env.cwd = false; return; }
  if (textOf(a.v) === '-') { env.cwd = false; return; }
  let to;
  if (isAbs(a.v, env.os)) to = tidy(a.v, env.os);
  else if (env.cwd === false) return;
  else to = tidy(env.cwd ? joinP(env.cwd, a.v, env.os) : a.v, env.os);
  env.cwd = textOf(to) === '.' ? null : to;                                      // back where it started
}
// a folder a cd went to, the way the shell keeps it: C:\a\b\..\c is C:\a\c (never above its root, never into a
// variable's part); only the literal tail is touched
function tidy(v, os) {
  const parts = v.parts.slice(), l = parts[parts.length - 1];
  if (!l || l.s == null) return v;
  const lead = parts.length === 1 ? (os === 'windows' ? /^([A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?|[\\/])?/ : /^\/*/).exec(l.s)[0] : '';
  const sep = os === 'windows' ? '\\' : '/';
  const segs = l.s.slice(lead.length).split(os === 'windows' ? /[\\/]+/ : /\/+/);
  const out = [];
  for (const g of segs) {
    if (g === '' || g === '.') continue;
    if (g === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!lead && parts.length === 1) out.push('..'); continue; }
    out.push(g);
  }
  const startSep = parts.length > 1 && isSepC(l.s[0], os) ? sep : '';
  const t = (lead ? lead.replace(/\//g, os === 'windows' ? '\\' : '/') : startSep) + out.join(sep);
  parts[parts.length - 1] = { s: t || (parts.length === 1 ? '.' : '') };
  return V(parts);
}
const popd = (env) => { env.cwd = env.stack.length ? env.stack.pop() : false; };

// ---- effects ---------------------------------------------------------------------------------------------------
// a move (or a copy): where the item was, and where it is now -- {v, inside}: "v, or <inside> within v when v is a
// folder" for a destination that may have been a folder (decided when the undo runs)
function placeOf(env, dstArg, srcLoc, o) {
  const dv = at(env, dstArg.v);
  if (!dv) return null;
  const leaf = (srcLoc && srcLoc.inside) || (srcLoc && leafOf(srcLoc.v, env.os)) || null;
  if (dv.inside) return { v: V(dv.parts), inside: dv.inside };                   // worked out when it ran ($back)
  if (o.exact) return { v: dv, inside: null };
  if (o.into || endsWithSep(dv, env.os)) return leaf ? { v: joinP(normTail(dv, env.os), lit(leaf), env.os), inside: null } : null;
  return { v: dv, inside: leaf };
}
function moveEffect(env, s, d, o) {
  o = o || {};
  const sv = at(env, s.v);
  const src = sv ? { v: V(sv.parts), inside: sv.inside || null } : null;
  const dst = src ? placeOf(env, d, src, o) : null;
  const why = o.vague ? 'glob' : whyOf(env, s) || (d.glob ? 'glob' : whyOf(env, d)) || (!dst ? 'name' : '');
  return { op: o.op || 'move', src, dst, why, srcRaw: s.raw, dstRaw: d.raw, force: !!o.force, recurse: !!o.recurse, tool: o.tool || '' };
}
function renameEffect(env, s, nn) {
  const p = at(env, s.v);
  const t = nn && nn.v ? textOf(nn.v) : null;
  const name = t != null ? leafOf(lit(t), env.os) : null;
  const why = whyOf(env, s) || (name == null || (p && p.inside) ? 'var' : '');
  return { op: 'rename', path: p, newName: name, why, srcRaw: s.raw, newRaw: nn ? nn.raw : '' };
}
function pathEffect(op, env, a, extra) { return Object.assign({ op, path: at(env, a.v), raw: a.raw, why: whyOf(env, a) }, extra || {}); }
function writeEffect(env, a, kind, tool) { return pathEffect('write', env, a, { kind, tool }); }

// ---- PowerShell's cmdlets ----------------------------------------------------------------------------------------
// p: every parameter; pos: the positional slots in order; sw: the switches; al: other names for a parameter
const LP = { pspath: 'LiteralPath', lp: 'LiteralPath' };
const CONTENT = { p: ['Path', 'LiteralPath', 'Value', 'PassThru', 'Filter', 'Include', 'Exclude', 'Force', 'Credential', 'NoNewline', 'Encoding', 'Stream', 'AsByteStream'], pos: ['Path', 'Value'], sw: ['PassThru', 'Force', 'NoNewline', 'AsByteStream'], al: LP };
const SVC = (more, sw) => ({ p: ['Name', 'DisplayName', 'InputObject', 'PassThru', 'Include', 'Exclude'].concat(more), pos: ['Name'], sw: ['PassThru'].concat(sw), al: { servicename: 'Name' } });
const CMDLETS = {
  'move-item': { p: ['Path', 'LiteralPath', 'Destination', 'Force', 'Filter', 'Include', 'Exclude', 'PassThru', 'Credential'], pos: ['Path', 'Destination'], sw: ['Force', 'PassThru'], al: LP },
  'rename-item': { p: ['Path', 'LiteralPath', 'NewName', 'Force', 'PassThru', 'Credential'], pos: ['Path', 'NewName'], sw: ['Force', 'PassThru'], al: LP },
  'copy-item': { p: ['Path', 'LiteralPath', 'Destination', 'Container', 'Force', 'Filter', 'Include', 'Exclude', 'Recurse', 'PassThru', 'Credential', 'FromSession', 'ToSession'], pos: ['Path', 'Destination'], sw: ['Container', 'Force', 'Recurse', 'PassThru'], al: LP },
  'new-item': { p: ['Path', 'Name', 'ItemType', 'Value', 'Force', 'Credential'], pos: ['Path'], sw: ['Force'], al: { type: 'ItemType' } },
  mkdir: { p: ['Path', 'Name', 'Value', 'Force', 'Credential'], pos: ['Path'], sw: ['Force'] },
  'remove-item': { p: ['Path', 'LiteralPath', 'Filter', 'Include', 'Exclude', 'Recurse', 'Force', 'Credential', 'Stream'], pos: ['Path'], sw: ['Recurse', 'Force'], al: LP },
  'set-itemproperty': { p: ['Path', 'LiteralPath', 'Name', 'Value', 'Type', 'PassThru', 'Force', 'Filter', 'Include', 'Exclude', 'Credential', 'InputObject'], pos: ['Path', 'Name', 'Value'], sw: ['PassThru', 'Force'], al: Object.assign({ pspropertyname: 'Name' }, LP) },
  'new-itemproperty': { p: ['Path', 'LiteralPath', 'Name', 'PropertyType', 'Value', 'Force', 'Filter', 'Include', 'Exclude', 'Credential'], pos: ['Path', 'Name'], sw: ['Force'], al: Object.assign({ type: 'PropertyType', pspropertyname: 'Name' }, LP) },
  'remove-itemproperty': { p: ['Path', 'LiteralPath', 'Name', 'Force', 'Filter', 'Include', 'Exclude', 'Credential'], pos: ['Path', 'Name'], sw: ['Force'], al: Object.assign({ pspropertyname: 'Name' }, LP) },
  'start-service': SVC([], []),
  'stop-service': SVC(['Force', 'NoWait'], ['Force', 'NoWait']),
  'restart-service': SVC(['Force'], ['Force']),
  'set-service': { p: ['Name', 'DisplayName', 'Description', 'StartupType', 'Status', 'InputObject', 'PassThru', 'ComputerName', 'Force', 'SecurityDescriptorSddl', 'Credential'], pos: ['Name'], sw: ['PassThru', 'Force'], al: { servicename: 'Name', sn: 'Name', startmode: 'StartupType', sm: 'StartupType', st: 'StartupType', cn: 'ComputerName' } },
  'stop-process': { p: ['Id', 'Name', 'InputObject', 'PassThru', 'Force'], pos: ['Id'], sw: ['PassThru', 'Force'], al: { processname: 'Name' } },
  'set-content': CONTENT,
  'add-content': CONTENT,
  'clear-content': { p: ['Path', 'LiteralPath', 'Filter', 'Include', 'Exclude', 'Force', 'Credential', 'Stream'], pos: ['Path'], sw: ['Force'], al: LP },
  'out-file': { p: ['FilePath', 'LiteralPath', 'Encoding', 'Append', 'Force', 'NoClobber', 'Width', 'NoNewline', 'InputObject'], pos: ['FilePath', 'Encoding'], sw: ['Append', 'Force', 'NoClobber', 'NoNewline'], al: Object.assign({ path: 'FilePath', nooverwrite: 'NoClobber' }, LP) },
  'tee-object': { p: ['FilePath', 'LiteralPath', 'Append', 'Variable', 'InputObject', 'Encoding'], pos: ['FilePath'], sw: ['Append'], al: Object.assign({ path: 'FilePath' }, LP) },
  'set-location': { p: ['Path', 'LiteralPath', 'PassThru', 'StackName'], pos: ['Path'], sw: ['PassThru'], al: LP },
  'push-location': { p: ['Path', 'LiteralPath', 'PassThru', 'StackName'], pos: ['Path'], sw: ['PassThru'], al: LP },
  'pop-location': { p: ['PassThru', 'StackName'], pos: [], sw: ['PassThru'] },
  'start-process': { p: ['FilePath', 'ArgumentList', 'Credential', 'WorkingDirectory', 'LoadUserProfile', 'NoNewWindow', 'PassThru', 'RedirectStandardError', 'RedirectStandardInput', 'RedirectStandardOutput', 'Verb', 'WindowStyle', 'Wait', 'UseNewEnvironment'], pos: ['FilePath', 'ArgumentList'], sw: ['LoadUserProfile', 'NoNewWindow', 'PassThru', 'Wait', 'UseNewEnvironment'], al: { pspath: 'FilePath', path: 'FilePath', args: 'ArgumentList', lup: 'LoadUserProfile', nnw: 'NoNewWindow', rse: 'RedirectStandardError', rsi: 'RedirectStandardInput', rso: 'RedirectStandardOutput' } },
  'join-path': { p: ['Path', 'ChildPath', 'AdditionalChildPath', 'Resolve', 'Credential'], pos: ['Path', 'ChildPath', 'AdditionalChildPath'], sw: ['Resolve'] },
  'get-service': { p: ['Name', 'DisplayName', 'DependentServices', 'RequiredServices', 'Include', 'Exclude', 'InputObject', 'ComputerName'], pos: ['Name'], sw: ['DependentServices', 'RequiredServices'], al: { servicename: 'Name', cn: 'ComputerName' } },
  'get-process': { p: ['Name', 'Id', 'InputObject', 'IncludeUserName', 'Module', 'FileVersionInfo', 'ComputerName'], pos: ['Name'], sw: ['IncludeUserName', 'Module', 'FileVersionInfo'], al: { processname: 'Name', pid: 'Id', cn: 'ComputerName' } },
  'get-item': { p: ['Path', 'LiteralPath', 'Filter', 'Include', 'Exclude', 'Force', 'Credential', 'Stream'], pos: ['Path'], sw: ['Force'], al: LP },
};
const PS_ALIAS = { mi: 'move-item', move: 'move-item', mv: 'move-item', rni: 'rename-item', ren: 'rename-item', copy: 'copy-item', cp: 'copy-item',
  cpi: 'copy-item', ni: 'new-item', md: 'mkdir', ri: 'remove-item', rm: 'remove-item', rmdir: 'remove-item', del: 'remove-item', erase: 'remove-item',
  rd: 'remove-item', sp: 'set-itemproperty', rp: 'remove-itemproperty', sasv: 'start-service', spsv: 'stop-service', spps: 'stop-process',
  kill: 'stop-process', sc: 'set-content', ac: 'add-content', clc: 'clear-content', sl: 'set-location', cd: 'set-location', chdir: 'set-location',
  pushd: 'push-location', popd: 'pop-location', saps: 'start-process', start: 'start-process', tee: 'tee-object', iwr: 'invoke-webrequest',
  curl: 'invoke-webrequest', wget: 'invoke-webrequest', irm: 'invoke-restmethod', '%': 'foreach-object', foreach: 'foreach-object', '?': 'where-object',
  where: 'where-object', iex: 'invoke-expression', icm: 'invoke-command', gsv: 'get-service', gps: 'get-process', ps: 'get-process', gi: 'get-item' };
// cmdlets that only read or only touch the session: no change to the machine
const PS_READ_VERB = /^(get|test|select|measure|format|convertto|convertfrom|compare|group|sort|write|resolve|split|join|wait|read|find|trace|debug|out-(string|host|null|default))(-|$)/;
const PS_READ = new Set(['start-sleep', 'sleep', 'new-object', 'add-type', 'clear-host', 'cls', 'clear', 'set-strictmode', 'import-module', 'ipmo', 'import-csv',
  'import-clixml', 'import-powershelldatafile', 'set-variable', 'new-variable', 'clear-variable', 'remove-variable', 'set-alias', 'new-alias', 'add-member',
  'new-timespan', 'echo', 'write', 'cat', 'gc', 'type', 'ls', 'dir', 'gci', 'gp', 'gpv', 'gl', 'pwd', 'gm', 'select', 'sort', 'measure', 'ft', 'fl', 'fw',
  'oh', 'sls', 'gcm', 'h', 'history', 'gal', 'gv', 'tasklist', 'whoami', 'hostname', 'systeminfo', 'ping', 'nslookup', 'netstat', 'tracert', 'where.exe',
  'findstr', 'find', 'more', 'tree', 'ver', 'getmac', 'driverquery', 'quser', 'query', 'qwinsta', 'chcp', 'fc', 'comp', 'exit']);
const COMMON_P = { verbose: 'Verbose', vb: 'Verbose', debug: 'Debug', db: 'Debug', erroraction: 'ErrorAction', ea: 'ErrorAction', warningaction: 'WarningAction',
  wa: 'WarningAction', informationaction: 'InformationAction', infa: 'InformationAction', errorvariable: 'ErrorVariable', ev: 'ErrorVariable',
  warningvariable: 'WarningVariable', wv: 'WarningVariable', informationvariable: 'InformationVariable', iv: 'InformationVariable', outvariable: 'OutVariable',
  ov: 'OutVariable', outbuffer: 'OutBuffer', ob: 'OutBuffer', pipelinevariable: 'PipelineVariable', pv: 'PipelineVariable', whatif: 'WhatIf', wi: 'WhatIf',
  confirm: 'Confirm', cf: 'Confirm', usetransaction: 'UseTransaction', usetx: 'UseTransaction' };
const COMMON_SW = new Set(['Verbose', 'Debug', 'WhatIf', 'Confirm', 'UseTransaction']);
const COMMON_NAMES = [...new Set(Object.values(COMMON_P))];
function resolveParam(spec, raw) {
  const n = String(raw).toLowerCase();
  if (n === '?') return '?';
  for (const p of spec.p) if (p.toLowerCase() === n) return p;
  if (spec.al && own(spec.al, n)) return spec.al[n];
  if (own(COMMON_P, n)) return COMMON_P[n];
  const hits = new Set(spec.p.concat(COMMON_NAMES).filter((p) => p.toLowerCase().startsWith(n)));
  return hits.size === 1 ? [...hits][0] : null;
}
// PowerShell's own binding: a name, an alias or any unambiguous start of one (-Dest, -Lit); a switch takes no value
// unless it is joined on (-Force:$false); the rest fill the positional slots in order. null when an argument fits
// nothing -- then the reading is not sure, and the command is one this module does not name.
function bind(spec, args) {
  const out = Object.create(null);
  const pos = [];
  let onlyPos = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.t === 'op' && a.v === '--') { onlyPos = true; continue; }
    if (a.t === 'par' && !onlyPos) {
      const name = resolveParam(spec, a.name);
      if (!name) return null;
      if (name === '?') return { help: true };
      if (spec.sw.includes(name) || COMMON_SW.has(name)) { out[name] = a.val || (a.next && args[i + 1] ? args[++i] : true); continue; }
      if (a.val) { out[name] = a.val; continue; }
      const nx = args[i + 1];
      if (!nx || nx.t === 'par' || nx.t === 'op') return null;
      out[name] = nx; i++;
      continue;
    }
    if (a.t === 'op') continue;
    pos.push(a);
  }
  const free = spec.pos.filter((p) => !(p in out));
  if (pos.length > free.length) return null;
  pos.forEach((a, j) => { out[free[j]] = a; });
  return out;
}
const on = (b, name) => {
  if (!b || !(name in b)) return false;
  const v = b[name];
  if (v === true) return true;
  const p = v && v.parts && v.parts[0];
  return !(p && p.var === 'false') && !(p && p.s != null && /^(0|\$false)$/i.test(p.s));
};
const listOf = (w) => (!w ? [] : w.t === 'list' ? w.items : [w]);
function cmdNameOf(el, env) {
  const v = evalWord(el.name, env), t = textOf(v);
  if (t == null) return null;
  const base = t.replace(/^.*[\\/]/, '');
  const low = base.toLowerCase();
  if (/\.(exe|com|cmd|bat)$/i.test(low)) return '#' + low.replace(/\.(exe|com|cmd|bat)$/i, '');   // a program, by its file name
  return own(PS_ALIAS, low) ? PS_ALIAS[low] : low;
}
// what came down the pipeline into a command, when the command before it named it plainly
function fromPipe(prev, env, kind) {
  const vague = [{ v: null, raw: prev && prev.src ? prev.src : 'what came down the pipeline', pipe: true }];
  if (!prev || prev.k !== 'cmd' || prev.shell !== 'ps') return vague;
  const n = cmdNameOf(prev, env);
  const spec = own(CMDLETS, n) ? CMDLETS[n] : null;
  const b = spec ? bind(spec, prev.args) : null;
  if (!b) return vague;
  if (kind === 'path' && n === 'get-item') {
    const w = 'LiteralPath' in b ? b.LiteralPath : b.Path;
    if (w && !('Filter' in b || 'Include' in b || 'Exclude' in b)) return listOf(w).map((x) => argOf(x, env, !('LiteralPath' in b)));
  }
  if (kind === 'service' && n === 'get-service' && ('Name' in b || 'DisplayName' in b)) return listOf(b.Name || b.DisplayName).map((x) => Object.assign(argOf(x, env, true), { by: 'Name' in b ? 'Name' : 'DisplayName' }));
  if (kind === 'process' && n === 'get-process' && ('Name' in b || 'Id' in b)) return listOf(b.Name || b.Id).map((x) => argOf(x, env, true));
  return vague;
}
function psCommand(el, env, facts, prev, pipe) {
  const n = cmdNameOf(el, env);
  if (n == null) return unknown(facts, pipe.src);
  if (n[0] === '#' || !own(CMDLETS, n)) {
    const bare = n[0] === '#' ? n.slice(1) : n;
    if (n[0] !== '#' && (PS_READ.has(bare) || PS_READ_VERB.test(bare))) return undefined;
    if (bare === 'foreach-object' || bare === 'where-object' || bare === 'invoke-command') return psBlocks(el, env, facts, pipe, bare);
    if (bare === 'invoke-expression') {
      const a = el.args.find((x) => x.t === 'w');
      const t = a && textOf(evalWord(a, env));
      if (t != null && env.depth < MAX_DEPTH) return analyze(psParse(t, env.depth + 1), Object.assign({}, env, { depth: env.depth + 1 }), facts);
      return unknown(facts, pipe.src);
    }
    if (bare === 'invoke-webrequest' || bare === 'invoke-restmethod') {
      const i = el.args.findIndex((x) => x.t === 'par' && x.name.length >= 4 && 'outfile'.startsWith(x.name.toLowerCase()));
      if (i < 0) return undefined;
      const w = el.args[i].val || el.args[i + 1];
      facts.push({ effect: writeEffect(env, argOf(w, env, false), 'overwrite', 'Invoke-WebRequest -OutFile') });
      return undefined;
    }
    const args = el.args.map((a) => (a.t === 'par' ? { t: '-' + a.name + (a.val ? ':' + (textOf(evalWord(a.val, env)) || '') : ''), v: lit('-' + a.name), raw: '-' + a.name }
      : a.t === 'w' ? Object.assign(argOf(a, env, false), { t: textOf(evalWord(a, env)), cooked: valueText(evalWord(a, env)) })
      : a.t === 'blk' ? { t: null, blk: a.inner, raw: '{…}' } : { t: null, v: null, raw: rawOf(a) }));
    return native(bare, args, env, facts, pipe.src, 'ps');
  }
  const b = bind(CMDLETS[n], el.args);
  if (!b) return unknown(facts, pipe.src);
  if (b.help || on(b, 'WhatIf')) return undefined;
  if ('ToSession' in b || 'FromSession' in b || 'ComputerName' in b || 'Credential' in b) return unknown(facts, pipe.src);
  const paths = (wild, litName) => {
    const w = litName in b ? b[litName] : wild in b ? b[wild] : null;
    if (!w) return null;
    const vague = 'Filter' in b || 'Include' in b || 'Exclude' in b;
    return listOf(w).map((x) => { const a = argOf(x, env, !(litName in b)); if (vague) a.glob = true; return a; });
  };
  const add = (e) => facts.push({ effect: e });
  switch (n) {
    case 'move-item': case 'copy-item': {
      const srcs = paths('Path', 'LiteralPath') || fromPipe(prev, env, 'path');
      const d = 'Destination' in b ? argOf(b.Destination, env, false) : { v: lit('.'), raw: '.' };
      for (const s of srcs) add(moveEffect(env, s, d, { op: n === 'move-item' ? 'move' : 'copy', force: on(b, 'Force'), recurse: on(b, 'Recurse'), tool: n === 'move-item' ? 'Move-Item' : 'Copy-Item' }));
      return undefined;
    }
    case 'rename-item': {
      const srcs = paths('Path', 'LiteralPath') || fromPipe(prev, env, 'path');
      const nn = 'NewName' in b ? argOf(b.NewName, env, false) : null;
      for (const s of srcs) add(renameEffect(env, s, nn));
      return undefined;
    }
    case 'new-item': case 'mkdir': {
      const t = n === 'mkdir' ? 'directory' : 'ItemType' in b ? (textOf(evalWord(b.ItemType, env)) || '?').toLowerCase() : 'file';
      const kind = /^(d|di|dir|dire|direc|direct|directo|director|directory|container)$/.test(t) ? 'dir' : /^(f|fi|fil|file|leaf)$/.test(t) ? 'file'
        : /^(symboliclink|symlink|junction|hardlink)$/.test(t) ? 'link' : '';
      const bases = 'Path' in b ? listOf(b.Path).map((x) => argOf(x, env, false)) : [{ v: lit('.'), raw: '.' }];
      const nm = 'Name' in b ? argOf(b.Name, env, false) : null;
      for (const p of bases) {
        const a = nm ? { v: p.v && nm.v ? (isHere(p.v) ? nm.v : joinP(p.v, nm.v, env.os)) : null, raw: (p.raw === '.' ? '' : p.raw + (env.os === 'windows' ? '\\' : '/')) + nm.raw } : p;
        const pv = at(env, a.v);
        if (isReg(pv)) add(pathEffect('regkey', env, a, { force: on(b, 'Force') }));
        else if (!kind) { unknown(facts, pipe.src); return undefined; } else add(pathEffect(kind === 'dir' ? 'mkdir' : kind === 'file' ? 'mkfile' : 'mklink', env, a, { force: on(b, 'Force'), tool: 'New-Item' }));
      }
      return undefined;
    }
    case 'remove-item': {
      const srcs = paths('Path', 'LiteralPath') || fromPipe(prev, env, 'path');
      for (const s of srcs) { const e = pathEffect('del', env, s, { recurse: on(b, 'Recurse'), tool: 'Remove-Item' }); if (isReg(e.path)) e.op = 'regkeydel'; add(e); }
      return undefined;
    }
    case 'set-itemproperty': case 'new-itemproperty': case 'remove-itemproperty': {
      const srcs = paths('Path', 'LiteralPath') || fromPipe(prev, env, 'path');
      const nm = 'Name' in b ? argOf(b.Name, env, false) : null;
      for (const s of srcs) {
        const e = pathEffect(n === 'set-itemproperty' ? 'regset' : n === 'new-itemproperty' ? (on(b, 'Force') ? 'regset' : 'regnew') : 'regdel', env, s,
          { name: nm && nm.v ? textOf(nm.v) : null, nameRaw: nm ? nm.raw : '', tool: n === 'set-itemproperty' ? 'Set-ItemProperty' : n === 'new-itemproperty' ? 'New-ItemProperty' : 'Remove-ItemProperty' });
        if (!isReg(e.path) && e.path) e.op = 'prop';
        if (!nm) e.why = e.why || 'var';
        add(e);
      }
      return undefined;
    }
    case 'start-service': case 'stop-service': case 'restart-service': {
      const by = 'DisplayName' in b ? 'DisplayName' : 'Name';
      const names = by in b ? listOf(b[by]).map((x) => Object.assign(argOf(x, env, true), { by })) : fromPipe(prev, env, 'service');
      for (const x of names) add(svcEffect(x, n.split('-')[0], { tool: 'ps', by: x.by || 'Name', force: on(b, 'Force') }));
      return undefined;
    }
    case 'set-service': {
      const names = 'Name' in b ? listOf(b.Name).map((x) => Object.assign(argOf(x, env, false), { by: 'Name' })) : fromPipe(prev, env, 'service');
      for (const x of names) {
        if ('Status' in b) {
          const st = (textOf(evalWord(b.Status, env)) || '').toLowerCase();
          add(svcEffect(x, st === 'running' ? 'start' : st === 'stopped' ? 'stop' : 'status', { tool: 'ps', by: x.by || 'Name' }));
        }
        if ('StartupType' in b) add(svcEffect(x, 'startup', { tool: 'Set-Service', value: textOf(evalWord(b.StartupType, env)) || '' }));
        if ('DisplayName' in b || 'Description' in b || 'SecurityDescriptorSddl' in b) add(svcEffect(x, 'describe', { tool: 'Set-Service' }));
      }
      return undefined;
    }
    case 'stop-process': {
      const ts = 'Id' in b ? listOf(b.Id).map((x) => argOf(x, env, false)) : 'Name' in b ? listOf(b.Name).map((x) => argOf(x, env, true)) : fromPipe(prev, env, 'process');
      for (const x of ts) add({ op: 'kill', name: textOf(x.v), raw: x.raw, byId: 'Id' in b, why: x.pipe ? 'pipe' : '' });
      return undefined;
    }
    case 'set-content': case 'add-content': case 'clear-content': case 'out-file': case 'tee-object': {
      const w = 'LiteralPath' in b ? b.LiteralPath : n === 'out-file' || n === 'tee-object' ? b.FilePath : b.Path;
      if (!w) { if (!(n === 'tee-object' && 'Variable' in b)) unknown(facts, pipe.src); return undefined; }
      const kind = n === 'clear-content' ? 'clear' : n === 'add-content' || on(b, 'Append') ? 'append' : n === 'out-file' && on(b, 'NoClobber') ? 'new' : 'overwrite';
      const tool = { 'set-content': 'Set-Content', 'add-content': 'Add-Content', 'clear-content': 'Clear-Content', 'out-file': 'Out-File', 'tee-object': 'Tee-Object' }[n];
      for (const x of listOf(w)) add(writeEffect(env, argOf(x, env, !('LiteralPath' in b) && n !== 'out-file' && n !== 'tee-object'), kind, tool));
      return undefined;
    }
    case 'set-location': case 'push-location': {
      const w = 'LiteralPath' in b ? b.LiteralPath : b.Path;
      if (!w) { if (n === 'push-location') env.stack.push(env.cwd); return undefined; }
      cd(env, argOf(w, env, false), n === 'push-location');
      return undefined;
    }
    case 'pop-location': popd(env); return undefined;
    case 'start-process': {
      if (!('FilePath' in b)) return unknown(facts, pipe.src);
      const f = argOf(b.FilePath, env, false);
      add({ op: 'launch', app: f.v ? shown(f.v) : f.raw });
      return undefined;
    }
    default: return undefined;                                                    // Join-Path, Get-Service ...: they only read
  }
}
// ForEach-Object { ... }, Where-Object { ... }, Invoke-Command { ... }: what runs inside
function psBlocks(el, env, facts, pipe, name) {
  if (name === 'invoke-command' && el.args.some((a) => a.t === 'par' && /^(c|cn|co|com|comp|computer|computername|session|ses|hostname|vmname|containerid|uri|connectionuri)/i.test(a.name))) return unknown(facts, pipe.src);
  const blocks = el.args.filter((a) => a.t === 'blk').concat(el.args.filter((a) => a.t === 'par' && a.val && a.val.t === 'blk').map((a) => a.val));
  if (!blocks.length) return el.args.some((a) => a.t === 'w' && a.expr) ? unknown(facts, pipe.src) : undefined;   // Where-Object Name -eq x
  const inner = [];
  const sub = Object.assign({}, env, { cond: true, loop: name !== 'invoke-command', depth: env.depth + 1 });
  for (const b of blocks) if (env.depth < MAX_DEPTH) analyze(psParse(b.inner, env.depth + 1), sub, inner);
  if (name === 'invoke-command') { for (const f of inner) facts.push(f); return undefined; }
  if (inner.length) unknown(facts, pipe.src);
  return undefined;
}
// a value as text with the environment variables still marked (for a command line read again by another shell)
const valueText = (v) => (v ? v.parts.map((p) => (p.s != null ? p.s : p.env != null ? PH_OPEN + p.env + PH_CLOSE : p.home ? PH_OPEN + 'USERPROFILE' + PH_CLOSE : '')).join('') : null);

// ---- cmd.exe's builtins -------------------------------------------------------------------------------------------
const CMD_READ = new Set(['echo', 'echo.', 'dir', 'type', 'more', 'find', 'findstr', 'where', 'whoami', 'hostname', 'ver', 'vol', 'tree', 'set', 'path',
  'title', 'cls', 'ping', 'systeminfo', 'tasklist', 'netstat', 'nslookup', 'tracert', 'pathping', 'chcp', 'fc', 'comp', 'help', 'timeout', 'choice',
  'pause', 'exit', 'getmac', 'driverquery', 'quser', 'query', 'qwinsta', 'color', 'prompt', 'verify', 'call', 'goto', 'shift', 'setlocal', 'endlocal',
  'arp', 'route', 'certutil', 'wmic', 'sort']);
const isFlag = (a) => a && a.t != null && /^\/[A-Za-z?-][\w:-]*$/.test(a.t) && !a.q;
function cmdCommandStep(el, env, facts, pipe) {
  if (!el.words.length) return undefined;
  const w0 = el.words[0];
  const t0 = textOf(evalWord(w0, env));
  if (t0 == null) return unknown(facts, pipe.src);
  const name = t0.replace(/^.*[\\/]/, '').toLowerCase().replace(/\.(exe|com|cmd|bat)$/i, '');
  const args = el.words.slice(1).map((w) => Object.assign(argOf(w, env, false), { t: textOf(evalWord(w, env)), q: w.q, cooked: w.cooked, glob: !!w.glob }));
  if (args.some((a) => a.t === '/?')) return undefined;
  const ops = args.filter((a) => !isFlag(a));
  const flags = new Set(args.filter(isFlag).map((a) => a.t.toLowerCase()));
  const add = (e) => facts.push({ effect: e });
  switch (name) {
    case 'cd': case 'chdir': case 'pushd': {
      // cd takes the whole rest of the line as one folder: cd C:\Program Files
      const joined = ops.every((a) => a.v) ? V([].concat(...ops.map((a, i) => (i ? [{ s: ' ' }] : []).concat(a.v.parts)))) : null;
      const rest = ops.length ? { v: ops.length === 1 ? ops[0].v : joined, raw: ops.map((a) => a.raw).join(' ') } : null;
      if (!rest) return undefined;                                                    // cd alone prints the folder
      if (name !== 'pushd' && !flags.has('/d') && rest.v && /^[A-Za-z]:/.test(textOf(rest.v) || '') && env.cwd && textOf(env.cwd) != null &&
          (textOf(env.cwd) || '').slice(0, 2).toLowerCase() !== (textOf(rest.v) || '').slice(0, 2).toLowerCase()) return undefined;   // another drive's folder: not this one
      cd(env, rest, name === 'pushd');
      return undefined;
    }
    case 'popd': popd(env); return undefined;
    case 'move': {
      if (ops.length < 1 || ops.length > 2) return unknown(facts, pipe.src);
      const d = ops[1] || { v: lit('.'), raw: '.' };
      add(moveEffect(env, ops[0], d, { force: flags.has('/y'), tool: 'move' }));
      return undefined;
    }
    case 'copy': {
      if (ops.length < 1 || ops.length > 2 || /\+/.test(ops[0].raw)) return unknown(facts, pipe.src);
      const s = ops[0];
      if (s.t && /^nul:?$/i.test(s.t) && ops[1]) { add(writeEffect(env, ops[1], 'overwrite', 'copy nul')); return undefined; }
      add(moveEffect(env, s, ops[1] || { v: lit('.'), raw: '.' }, { op: 'copy', tool: 'copy' }));
      return undefined;
    }
    case 'ren': case 'rename': {
      if (ops.length !== 2) return unknown(facts, pipe.src);
      const nn = ops[1];
      if (nn.glob) { add(renameEffect(env, Object.assign({}, ops[0], { glob: true }), nn)); return undefined; }
      add(renameEffect(env, ops[0], nn));
      return undefined;
    }
    case 'del': case 'erase':
      for (const a of ops) add(pathEffect('del', env, a, { recurse: flags.has('/s'), tool: name }));
      return undefined;
    case 'md': case 'mkdir':
      for (const a of ops) add(pathEffect('mkdir', env, a, { parents: true, tool: name }));
      return undefined;
    case 'rd': case 'rmdir':
      for (const a of ops) add(flags.has('/s') ? pathEffect('del', env, a, { recurse: true, dir: true, tool: 'rd /s' }) : pathEffect('rmdir', env, a, { tool: name }));
      return undefined;
    case 'start': {
      const prog = ops.find((a, i) => !(i === 0 && a.q && ops.length > 1));        // start "title" prog
      if (!prog) return undefined;
      add({ op: 'launch', app: prog.v ? shown(prog.v) : prog.raw });
      return undefined;
    }
    default:
      if (CMD_READ.has(name)) return name === 'wmic' && /\b(call|set|create|delete)\b/i.test(pipe.src) ? unknown(facts, pipe.src) : undefined;
      return native(name, args, env, facts, pipe.src, 'cmd', el);
  }
}

// ---- programs both Windows shells run: reg, sc, net, taskkill, and another shell -----------------------------
function native(name, args, env, facts, src, from, el) {
  const add = (e) => facts.push({ effect: e });
  const T = args.map((a) => (a.t != null ? a.t : ''));
  const low = T.map((t) => t.toLowerCase());
  const after = (flag) => { const i = low.indexOf(flag); return i >= 0 && i + 1 < T.length ? T[i + 1] : null; };
  if (env.os === 'windows') {
    switch (name) {
      case 'reg': {
        const op = low[0] || '';
        if (op === 'query' || op === 'compare' || !op || op === '/?') return undefined;
        const key = T[1] || '';
        if (/^\\\\/.test(key)) return unknown(facts, src);                          // another machine's registry
        const view = low.includes('/reg:32') ? '32' : low.includes('/reg:64') ? '64' : '';   // which half of the registry a 64-bit Windows shows
        if (op === 'add') {
          if (low.includes('/v') || low.includes('/ve')) add({ op: 'regset', keyRaw: key, name: low.includes('/ve') ? '(Default)' : after('/v'), tool: 'reg add', view });
          else add({ op: 'regkeyadd', keyRaw: key, tool: 'reg add', view });
          return undefined;
        }
        if (op === 'delete') {
          if (low.includes('/v') || low.includes('/ve') || low.includes('/va')) add({ op: 'regdel', keyRaw: key, name: low.includes('/va') ? null : low.includes('/ve') ? '(Default)' : after('/v'), all: low.includes('/va'), tool: 'reg delete', view });
          else add({ op: 'regkeydel', keyRaw: key, tool: 'reg delete', view });
          return undefined;
        }
        return unknown(facts, src);
      }
      case 'sc': {
        if (/^\\\\/.test(T[0] || '')) return unknown(facts, src);
        const op = low[0] || '', svc = T[1] || '';
        if (!op || /^(query|queryex|qc|qdescription|qfailure|qfailureflag|qsidtype|qprivs|qtriggerinfo|qpreferrednode|qmanagedaccount|qprotection|quserservice|getdisplayname|getkeyname|enumdepend|sdshow|showsid|\/\?)$/.test(op)) return undefined;
        if (!svc) return unknown(facts, src);
        const x = { v: lit(svc), raw: svc, t: svc };
        if (op === 'start' || op === 'stop') { add(svcEffect(x, op, { tool: 'sc' })); return undefined; }
        if (op === 'pause' || op === 'continue') { add(svcEffect(x, op, { tool: 'sc' })); return undefined; }
        if (op === 'config') {
          const i = low.findIndex((t) => t === 'start=' || t.startsWith('start='));
          add(i >= 0 ? svcEffect(x, 'startup', { tool: 'sc config', value: low[i] === 'start=' ? T[i + 1] || '' : T[i].slice(6) }) : svcEffect(x, 'describe', { tool: 'sc config' }));
          return undefined;
        }
        if (op === 'delete') { add(svcEffect(x, 'delete', { tool: 'sc' })); return undefined; }
        return unknown(facts, src);
      }
      case 'net': case 'net1': {
        const op = low[0] || '';
        if (op === 'start' || op === 'stop') {
          if (T.length === 1) return undefined;                                      // net start: the list of running services
          const svcName = T.slice(1).filter((t) => !/^\/(y|yes|n|no)$/i.test(t)).join(' ');
          add(svcEffect({ v: lit(svcName), raw: svcName, t: svcName }, op, { tool: 'net' }));
          return undefined;
        }
        if (/^(view|session|sessions|statistics|stats|config|time|helpmsg|help|\/\?)$/.test(op) || !op) return undefined;
        if (/^(user|users|localgroup|group|share|use|accounts)$/.test(op) && T.length <= 2 && !T.some((t) => /[=/]/.test(t.slice(1)))) return undefined;
        return unknown(facts, src);
      }
      case 'taskkill': {
        const ims = [], pids = [];
        for (let i = 0; i < low.length; i++) { if (low[i] === '/im' && T[i + 1]) ims.push(T[++i]); else if (low[i] === '/pid' && T[i + 1]) pids.push(T[++i]); }
        if (low.includes('/fi') || (!ims.length && !pids.length)) { add({ op: 'kill', name: null, raw: 'the programs taskkill matched', why: 'glob' }); return undefined; }
        for (const m of ims) add({ op: 'kill', name: m, raw: m, why: /[*?]/.test(m) ? 'glob' : '' });
        for (const p of pids) add({ op: 'kill', name: p, raw: p, byId: true });
        return undefined;
      }
      case 'cmd': {
        const i = low.findIndex((t) => /^\/[ck]$/.test(t) || /^\/(?:[a-z]:?\S*\s+)*[ck]$/.test(t));
        if (i < 0) return T.length ? unknown(facts, src) : undefined;
        let rest = args.slice(i + 1).map((a) => (from === 'cmd' ? a.cooked : a.cooked != null && /\s/.test(a.cooked) ? '"' + a.cooked + '"' : a.cooked || '')).join(' ').trim();
        if (/^".*"$/.test(rest)) rest = rest.slice(1, -1);
        if (env.depth >= MAX_DEPTH) return unknown(facts, src);
        return analyze(cmdParse(rest, env.depth + 1), Object.assign({}, env, { shell: 'cmd', depth: env.depth + 1 }), facts);
      }
      case 'powershell': case 'pwsh': {
        let script = null;
        if (from === 'cmd') script = psScriptOf(argv(args.map((a) => a.cooked).join(' ')), name === 'pwsh');
        else {
          const blk = args.find((a) => a.blk != null);
          script = blk ? blk.blk : psScriptOf(args.map((a) => (a.cooked != null ? a.cooked : a.t || '')), name === 'pwsh');
        }
        if (script == null || env.depth >= MAX_DEPTH) return unknown(facts, src);
        return analyze(psParse(script, env.depth + 1), Object.assign({}, env, { shell: 'ps', depth: env.depth + 1 }), facts);
      }
      case 'icacls': {
        if (!T.some((t) => /^\/(grant|deny|remove|reset|setowner|setintegritylevel|restore|substitute|inheritance)/i.test(t))) return undefined;
        // a plain entry, as any command it cannot put back -- but one path's permissions set by /grant /deny /remove
        // /reset /setowner /inheritance carry what they changed, so a capture of its permissions can put them back
        const s = oneLine(src || ''), last = facts[facts.length - 1];
        if (last && last.unknown === s) return undefined;
        const p = args[0];
        const one = p && p.t != null && !/^\/|[*?]/.test(p.t) && !low.some((t) => /^\/(setintegritylevel|restore|substitute|save|l)$/.test(t));
        facts.push(one ? { unknown: s, acl: pathEffect('acl', env, p, { tool: 'icacls', recurse: low.includes('/t'), owner: low.includes('/setowner') }) } : { unknown: s });
        return undefined;
      }
      case 'attrib': return T.some((t) => /^[+-][rahsoixvpu]$/i.test(t)) ? unknown(facts, src) : undefined;
      case 'ipconfig': return T.some((t) => /^\/(release|renew|flushdns|registerdns|setclassid)/i.test(t)) ? unknown(facts, src) : undefined;
      default:
        if (from === 'ps' && (PS_READ.has(name) || CMD_READ.has(name))) return undefined;
        return unknown(facts, src);
    }
  }
  return unknown(facts, src);
}
function svcEffect(x, action, o) {
  const name = x && x.v ? textOf(x.v) : null;
  const why = !x || x.pipe ? 'pipe' : x.glob || (name && /[*?[]/.test(name)) ? 'glob' : name == null ? 'var' : '';
  return Object.assign({ op: 'svc', name, raw: x ? x.raw : '', action, why }, o || {});
}

// ---- sh --------------------------------------------------------------------------------------------------------
// GNU-style options: -abc, -t DIR, --long, --long=VALUE, -- ; options may come after the operands
function shOpts(args, spec) {
  const flags = new Set(), vals = {}, ops = [];
  let done = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i], t = a.t;                                                     // (quoting does not stop an option: the shell removes it)
    if (done || t == null || !/^-./.test(t)) { ops.push(a); continue; }
    if (t === '--') { done = true; continue; }
    if (t.startsWith('--')) {
      const m = /^--([^=]+)(=(.*))?$/.exec(t), nm = m[1], short = spec.long && own(spec.long, nm) ? spec.long[nm] : null;
      if (short && spec.arg && spec.arg.includes(short)) { vals[short] = m[2] ? { t: m[3], v: lit(m[3]), raw: m[3] } : args[++i]; continue; }
      flags.add(short || '--' + nm);
      continue;
    }
    for (let j = 1; j < t.length; j++) {
      const c = t[j];
      if (spec.arg && spec.arg.includes(c)) { const rest = t.slice(j + 1); vals[c] = rest ? { t: rest, v: lit(rest), raw: rest } : args[++i]; break; }
      flags.add(c);
    }
  }
  return { flags, vals, ops };
}
const SH_WRAP = new Set(['nohup', 'time', 'command', 'builtin', 'exec', 'stdbuf', 'chronic', 'unbuffer', 'setsid', 'nice', 'ionice', 'timeout', 'env', 'doas', 'sudo']);
const SH_READ = new Set(['ls', 'cat', 'echo', 'printf', 'pwd', 'true', 'false', 'test', '[', 'which', 'type', 'whoami', 'id', 'uname', 'df', 'du', 'free', 'ps',
  'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'wc', 'uniq', 'cut', 'tr', 'awk', 'stat', 'file', 'readlink', 'realpath', 'basename', 'dirname',
  'printenv', 'sleep', 'journalctl', 'lsblk', 'lscpu', 'lsusb', 'lspci', 'uptime', 'w', 'who', 'last', 'tree', 'less', 'more', 'jq', 'xxd', 'od',
  'hexdump', 'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'cmp', 'diff', 'column', 'nl', 'tac', 'rev', 'seq', 'history', 'alias', 'unalias', 'export',
  'unset', 'set', 'read', 'local', 'declare', 'typeset', 'readonly', 'ulimit', 'umask', 'shift', 'getopts', 'wait', 'jobs', 'trap', 'exit', 'return',
  'break', 'continue', ':', 'hash', 'dirs', 'man', 'apropos', 'locate', 'whereis', 'lsof', 'ss', 'netstat', 'nproc', 'getent', 'groups', 'tty',
  'clear', 'tput', 'date', 'hostname', 'env', 'mount', 'ip', 'ifconfig', 'xdpyinfo', 'nvidia-smi', 'sensors', 'dmesg', 'lsmod', 'arch', 'cal']);
function shCommand(el, env, facts, pipe, prev) {
  let words = el.words.slice();
  let sudo = env.sudo;
  // what runs the command rather than being it: sudo, env, nohup, timeout 5 ...
  for (let guard = 0; words.length && guard < 8; guard++) {
    const n0 = textOf(evalWord(words[0], env));
    const nm = n0 == null ? null : n0.replace(/^.*\//, '');
    if (!nm || !SH_WRAP.has(nm)) break;
    const rest = words.slice(1);
    let i = 0;
    if (nm === 'sudo' || nm === 'doas') {
      let user = null;
      while (i < rest.length) {
        const t = textOf(evalWord(rest[i], env)) || '';
        if (t === '--') { i++; break; }
        if (/^-[ugCDhpRrTUt]$/.test(t) || /^--(user|group|close-from|chdir|host|prompt|role|type|other-user|command-timeout)$/.test(t)) { if (t === '-u' || t === '--user') user = textOf(evalWord(rest[i + 1], env)); i += 2; continue; }
        if (/^-/.test(t)) { const m = /^-u(.+)$/.exec(t) || /^--user=(.+)$/.exec(t); if (m) user = m[1]; i++; continue; }
        break;
      }
      sudo = { user, tool: nm };
    } else if (nm === 'env') {
      while (i < rest.length) { const t = textOf(evalWord(rest[i], env)) || ''; if (/^-[iu0]$|^--(ignore-environment|unset|null)/.test(t)) { i += /^-u$|^--unset$/.test(t) ? 2 : 1; continue; } if (/^[A-Za-z_]\w*=/.test(t) || /^-/.test(t)) { i++; continue; } break; }
      if (i >= rest.length) return undefined;                                         // env: prints the environment
    } else if (nm === 'nice' || nm === 'ionice') {
      while (i < rest.length && /^-/.test(textOf(evalWord(rest[i], env)) || '')) { const t = textOf(evalWord(rest[i], env)); i += /^-[nc]$/.test(t) ? 2 : 1; }
    } else if (nm === 'timeout') {
      while (i < rest.length && /^-/.test(textOf(evalWord(rest[i], env)) || '')) { const t = textOf(evalWord(rest[i], env)); i += /^-[sk]$/.test(t) ? 2 : 1; }
      i++;                                                                            // the duration
    } else if (nm === 'stdbuf' || nm === 'command' || nm === 'exec') {
      while (i < rest.length && /^-/.test(textOf(evalWord(rest[i], env)) || '')) i++;
    }
    words = rest.slice(i);
  }
  if (!words.length) return undefined;
  const n0 = textOf(evalWord(words[0], env));
  if (n0 == null) return unknown(facts, pipe.src);
  const name = n0.replace(/^.*\//, '');
  const args = words.slice(1).map((w) => Object.assign(argOf(w, env, true), { t: textOf(evalWord(w, env)), q: !!w.q && !(w.parts || []).some((p) => p.q === 0 && /^-/.test(p.s || '')) }));
  const fenv = sudo !== env.sudo ? Object.assign({}, env, { sudo }) : env;
  const add = (e) => facts.push({ effect: Object.assign(e, { sudo }) });
  const o = (spec) => shOpts(args, spec);
  switch (name) {
    case 'cd': {
      if (!args.length) { cd(env, { v: V([{ home: 1 }]) }); return undefined; }
      const a = args.filter((x) => !/^-[LPe@]+$/.test(x.t || ''))[0];
      cd(env, a, false);
      return undefined;
    }
    case 'pushd': if (args[0] && !/^[+-]\d/.test(args[0].t || '')) cd(env, args[0], true); else env.cwd = false; return undefined;
    case 'popd': popd(env); return undefined;
    case 'mv': case 'cp': {
      const r = o(name === 'mv' ? { arg: 'St', long: { 'target-directory': 't', 'no-target-directory': 'T', suffix: 'S', force: 'f', interactive: 'i', 'no-clobber': 'n', backup: 'b' } }
        : { arg: 'St', long: { 'target-directory': 't', 'no-target-directory': 'T', suffix: 'S', recursive: 'r', archive: 'a', 'symbolic-link': 's', link: 'l', force: 'f' } });
      const dst = r.vals.t || r.ops[r.ops.length - 1];
      const srcs = r.vals.t ? r.ops : r.ops.slice(0, -1);
      if (!dst || !srcs.length) return unknown(facts, pipe.src);
      const recurse = r.flags.has('r') || r.flags.has('R') || r.flags.has('a');
      for (const s of srcs) add(moveEffect(fenv, s, dst, { op: name === 'mv' ? 'move' : 'copy', exact: r.flags.has('T'), into: srcs.length > 1 || !!r.vals.t, force: r.flags.has('f'), recurse, tool: name }));
      return undefined;
    }
    case 'mkdir': {
      const r = o({ arg: 'm', long: { parents: 'p', mode: 'm' } });
      for (const a of r.ops) add(pathEffect('mkdir', fenv, a, { parents: r.flags.has('p'), maybe: r.flags.has('p'), tool: 'mkdir' }));
      return undefined;
    }
    case 'rm': case 'unlink': {
      const r = o({ long: { recursive: 'r', force: 'f', dir: 'd' } });
      for (const a of r.ops) add(pathEffect('del', fenv, a, { recurse: r.flags.has('r') || r.flags.has('R'), tool: name }));
      return undefined;
    }
    case 'rmdir': {
      const r = o({ long: { parents: 'p' } });
      for (const a of r.ops) add(pathEffect('rmdir', fenv, a, { parents: r.flags.has('p'), tool: 'rmdir' }));
      return undefined;
    }
    case 'touch': {
      const r = o({ arg: 'drt', long: { date: 'd', reference: 'r', 'no-create': 'c' } });
      if (r.flags.has('c')) return undefined;
      for (const a of r.ops) add(pathEffect('touch', fenv, a, {}));
      return undefined;
    }
    case 'ln': {
      const r = o({ arg: 'St', long: { symbolic: 's', force: 'f', 'target-directory': 't', 'no-target-directory': 'T', suffix: 'S', relative: 'r' } });
      let targets = r.ops, dst = null;
      if (r.vals.t) dst = r.vals.t;
      else if (r.ops.length >= 2) { dst = r.ops[r.ops.length - 1]; targets = r.ops.slice(0, -1); } else if (r.ops.length === 1) dst = { v: lit('.'), raw: '.', t: '.' };
      if (!dst || !targets.length) return unknown(facts, pipe.src);
      for (const tg of targets) {
        // a link's target is kept as written (a relative one is relative to the link, not to the shell's folder)
        const tv = tg.v ? V(tg.v.parts) : null;
        const src = tv ? { v: tv, inside: null } : null;
        const place = src ? placeOf(fenv, dst, src, { exact: r.flags.has('T'), into: targets.length > 1 || !!r.vals.t || r.ops.length === 1 }) : null;
        const why = tg.glob ? 'glob' : !tv ? 'var' : dst.glob ? 'glob' : whyOf(fenv, dst) || (!place ? 'name' : '');
        add({ op: 'link', src, dst: place, why, srcRaw: tg.raw, dstRaw: dst.raw, sym: r.flags.has('s'), force: r.flags.has('f'), tool: 'ln' });
      }
      return undefined;
    }
    case 'chmod': case 'chown': case 'chgrp': {
      const r = o({ long: { recursive: 'R', reference: '' } });
      const ref = args.some((a) => /^--reference=/.test(a.t || ''));
      const ops = ref ? r.ops : r.ops.slice(1);
      const mode = ref ? '' : r.ops[0] ? r.ops[0].raw : '';
      for (const a of ops) add(pathEffect('perm', fenv, a, { tool: name, mode, recurse: r.flags.has('R') }));
      return undefined;
    }
    case 'systemctl': {
      const r = o({ arg: 'HMtpsn', long: { host: 'H', machine: 'M', type: 't', property: 'p', signal: 's', lines: 'n' } });
      if (r.vals.H || r.vals.M) return unknown(facts, pipe.src);
      const verb = r.ops[0] ? (r.ops[0].t || '').toLowerCase() : '';
      const units = r.ops.slice(1);
      const user = r.flags.has('--user'), now = r.flags.has('--now');
      if (!verb || /^(status|show|cat|list-[\w-]+|is-[\w-]+|help|get-default|show-environment|daemon-reload|--version)$/.test(verb)) return undefined;
      const map = { start: 'start', stop: 'stop', restart: 'restart', 'try-restart': 'restart', reload: 'restart', 'reload-or-restart': 'restart',
        'try-reload-or-restart': 'restart', condrestart: 'restart', 'force-reload': 'restart', enable: 'enable', disable: 'disable', mask: 'mask', unmask: 'unmask', reenable: 'enable' };
      if (!own(map, verb) || !units.length) return unknown(facts, pipe.src);
      for (const u of units) add(svcEffect(u, map[verb], { tool: 'systemctl', user, now: now && (verb === 'enable' || verb === 'disable' || verb === 'reenable' || verb === 'mask') }));
      return undefined;
    }
    case 'service': {
      const svcName = args[0], op = args[1] ? (args[1].t || '').toLowerCase() : '';
      if (!svcName || !op || op === 'status' || svcName.t === '--status-all') return undefined;
      if (op === 'start' || op === 'stop' || op === 'restart' || op === 'reload' || op === 'force-reload') { add(svcEffect(svcName, op === 'start' || op === 'stop' ? op : 'restart', { tool: 'service' })); return undefined; }
      return unknown(facts, pipe.src);
    }
    case 'kill': case 'pkill': case 'killall': {
      if (args.some((a) => a.t === '-l' || a.t === '-L' || a.t === '-0' || a.t === '--list')) return undefined;
      const r = o({ arg: name === 'kill' ? 'sn' : 'sugtGPUF', long: { signal: 's' } });
      const ops = r.ops.filter((a) => !/^-/.test(a.t || ''));
      for (const a of ops) add({ op: 'kill', name: a.t, raw: a.raw, byId: name === 'kill' && /^-?\d+$/.test(a.t || ''), why: name === 'pkill' || a.glob ? 'glob' : '' });
      return undefined;
    }
    case 'tee': {
      const r = o({ long: { append: 'a' } });
      for (const a of r.ops) if (!/^\/dev\/(null|stdout|stderr|tty)$/.test(a.t || '')) add(writeEffect(fenv, a, r.flags.has('a') ? 'append' : 'overwrite', 'tee'));
      return undefined;
    }
    case 'sed': {
      const inPlace = args.find((a) => /^-[^-]*i/.test(a.t || '') || /^--in-place/.test(a.t || ''));
      if (!inPlace) return undefined;
      const r = o({ arg: 'efl', long: { expression: 'e', file: 'f' } });
      const files = r.vals.e || r.vals.f ? r.ops : r.ops.slice(1);
      const suffix = (/^-i(.+)$/.exec(inPlace.t) || /^--in-place=(.+)$/.exec(inPlace.t) || [])[1] || '';
      for (const a of files) add(writeEffect(fenv, a, 'edit', suffix ? 'sed -i' + suffix : 'sed -i'));
      return undefined;
    }
    case 'truncate': {
      const r = o({ arg: 'sr', long: { size: 's', reference: 'r', 'no-create': 'c' } });
      for (const a of r.ops) add(writeEffect(fenv, a, 'clear', 'truncate'));
      return undefined;
    }
    case 'find':
      if (args.some((a) => /^-(exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a.t || ''))) return unknown(facts, pipe.src);
      if (args.some((a) => a.t === '-delete')) add({ op: 'del', path: null, raw: 'what find matched', why: 'glob', tool: 'find -delete', sudo });
      return undefined;
    // a variable the line sets another way: kept when it is a literal, else not known from here on (never taken
    // for the environment's -- at undo time it would not be there)
    case 'export': case 'readonly': case 'local': case 'declare': case 'typeset': case 'read': case 'getopts': case 'unset': {
      for (const a of args) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(\+?=)?/.exec(a.t || textOf(V((a.v || { parts: [] }).parts)) || rawOf(a) || '');
        if (!m || /^-/.test(a.raw || '')) continue;
        if (name === 'read' || name === 'getopts' || name === 'unset' || m[2] === '+=') { setVar(env, m[1], null); continue; }
        if (!m[2]) continue;                                                          // export NAME: the value it already has
        const p0 = a.v && a.v.parts[0];
        setVar(env, m[1], p0 && p0.s != null && p0.s.startsWith(m[0]) && !a.v.inside ? V([{ s: p0.s.slice(m[0].length) }].concat(a.v.parts.slice(1))) : null);
      }
      return undefined;
    }
    case 'sh': case 'bash': case 'dash': case 'zsh': case 'ksh': {
      const i = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a.t || ''));
      if (i < 0 || !args[i + 1] || args[i + 1].t == null || env.depth >= MAX_DEPTH) return args.length ? unknown(facts, pipe.src) : undefined;
      return analyze(shParse(args[i + 1].t, env.depth + 1), Object.assign({}, env, { sudo, depth: env.depth + 1 }), facts);
    }
    case 'curl': return args.some((a) => /^(-[a-zA-Z]*[oO]|--output|--remote-name|-[a-zA-Z]*O)/.test(a.t || '')) ? unknown(facts, pipe.src) : undefined;
    case 'sort': return args.some((a) => /^(-o|--output)/.test(a.t || '')) ? unknown(facts, pipe.src) : undefined;
    default:
      if (SH_READ.has(name) && !(name === 'date' && args.some((a) => /^(-s|--set)/.test(a.t || ''))) && !(name === 'hostname' && args.some((a) => !/^-/.test(a.t || ''))) &&
          !((name === 'ip' || name === 'ifconfig') && args.some((a) => /^(add|del|delete|set|change|replace|flush|up|down)$/.test(a.t || '')))) return undefined;
      return unknown(facts, pipe.src);
  }
}

// ============================================================================================================
// WHAT TO SAY, AND HOW TO PUT IT BACK. describe(effect) -> {what, md, reversible, undo}
// ============================================================================================================
const HINT = {
  glob: (verb) => 'it named its items with a wildcard, so exactly which ones it ' + verb + ' is not known',
  var: () => 'a path in it came from a variable this record cannot read, so the exact item is not known',
  pipe: () => 'its items came down a pipeline, so exactly which ones is not known',
  cwd: () => 'the path is relative to a folder this record does not know (the Terminal’s, or one a cd went to)',
  name: () => 'the item’s name could not be read, so where it ended up is not known',
  quote: () => 'a character in the path cannot be written safely into a command',
  long: () => 'the command to put it back would be longer than Windows allows',
};
const vague = (why, verb, byHand) => (HINT[why] ? HINT[why](verb) : HINT.var()) + ' — ' + byHand;
function result(sentence, reversible, undo) { return { what: sentence.what, md: sentence.md, reversible: !!reversible, undo: undo || null }; }
const hint = (text) => ({ kind: 'hint', text });
const runUndo = (os, cmd, risky, note) => (cmd ? { kind: 'exec', os, cmd, risky: !!risky, note } : null);
function describe(e, d) {
  const os = d.os;
  switch (e.op) {
    case 'move': case 'copy': case 'link': return describeMove(e, d);
    case 'rename': {
      const s = e.path && e.newName != null ? say('renamed ', P(e.path), ' to ', { code: e.newName }) : say('renamed ', { code: e.srcRaw }, ' to ', { code: e.newRaw });
      if (e.why) return result(s, false, hint(vague(e.why, 'renamed', 'rename it back by hand')));
      const old = leafOf(e.path, os), par = parentOf(e.path, os);
      if (!old || !par) return result(s, false, hint(vague('name', '', 'rename it back by hand')));
      const now = isHere(par) ? lit(e.newName) : joinP(par, lit(e.newName), os);
      const cmd = os === 'windows' ? psLine(['Rename-Item -LiteralPath ' + psValue(now) + ' -NewName ' + psValue(lit(old))])
        : shLine(['back=' + shValue(isHere(par) ? lit(old) : joinP(par, lit(old), os)), 'if [ -e "$back" ] || [ -L "$back" ]; then echo "$back is already there, so nothing was moved" >&2; exit 1; fi', 'mv -- ' + shValue(now) + ' "$back"'], e.sudo);
      if (!cmd) return result(s, false, hint(vague('quote', '', 'rename it back by hand')));
      return result(s, true, runUndo(os, cmd, false, 'renames ' + shown(now) + ' back to ' + old));
    }
    case 'mkdir': {
      const s = say('created the folder ', e.path ? P(e.path) : { code: e.raw });
      if (e.why) return result(s, false, hint(vague(e.why, 'made', 'delete it by hand if it is empty and not wanted')));
      const p = e.path;
      // rd and rmdir remove a folder only while it is empty -- the refusal is the operating system's own
      const cmd = os === 'windows'
        ? (cmdValue(p) ? 'rd ' + cmdValue(p) : psLine(['$item = ' + psValue(p), 'if (-not (Test-Path -LiteralPath $item -PathType Container)) { throw ($item + \' is not a folder, so it was left as it is\') }',
          "if (Get-ChildItem -LiteralPath $item -Force) { throw ($item + ' is not empty, so it was left as it is') }", 'Remove-Item -LiteralPath $item']))
        : shLine(['rmdir -- ' + shValue(p)], e.sudo);
      if (!cmd) return result(s, false, hint(vague('quote', '', 'delete it by hand if it is empty and not wanted')));
      const maybe = e.force || e.maybe;
      return result(s, true, runUndo(os, cmd, true, 'deletes the folder ' + shown(p) + ' if it is still empty' + (maybe ? ' (it may have been there already)' : '') +
        (e.parents && !maybe ? '; folders made above it stay' : '')));
    }
    case 'mkfile': {
      const s = say('created the file ', e.path ? P(e.path) : { code: e.raw });
      if (e.why) return result(s, false, hint(vague(e.why, 'made', 'delete it by hand if it is not wanted')));
      if (e.force) return result(s, false, hint('New-Item -Force replaces a file that is already there, and what was in it is gone — if the file is new, delete it by hand'));
      const cmd = os === 'windows' ? psLine(['Remove-Item -LiteralPath ' + psValue(e.path)]) : shLine(['rm -- ' + shValue(e.path)], e.sudo);
      if (!cmd) return result(s, false, hint(vague('quote', '', 'delete it by hand if it is not wanted')));
      return result(s, true, runUndo(os, cmd, true, 'deletes the file ' + shown(e.path) + ' (and anything written in it since)'));
    }
    case 'mklink': {
      const s = say('made the link ', e.path ? P(e.path) : { code: e.raw });
      if (e.why) return result(s, false, hint(vague(e.why, 'made', 'delete the link by hand if it is not wanted')));
      const cmd = psLine(['(Get-Item -LiteralPath ' + psValue(e.path) + ' -Force).Delete()']);
      if (!cmd || e.force) return result(s, false, hint(e.force ? 'New-Item -Force replaces what is there — delete the link by hand if it is not wanted' : vague('quote', '', 'delete the link by hand')));
      return result(s, true, runUndo(os, cmd, true, 'deletes the link ' + shown(e.path) + ' (not what it points to)'));
    }
    case 'touch': {
      const s = say('created or touched ', e.path ? P(e.path) : { code: e.raw });
      return result(s, false, hint('touch either made the file or only changed its date, and which is not known — if it is new and not wanted, delete it'));
    }
    case 'del': {
      const tool = e.tool || 'it';
      const s = e.path ? say('deleted ', P(e.path), e.recurse ? ' and everything in it' : '')
        : say('deleted ', e.why === 'pipe' ? 'the items from ' : '', { code: e.raw }, e.recurse ? ' and everything in them' : '');
      const why = tool === 'rm' || tool === 'unlink' || tool === 'find -delete' ? (tool === 'find -delete' ? 'find -delete' : tool) + ' deletes for good: there is no trash to take it back from'
        : tool + ' does not use the Recycle Bin';
      return result(s, false, hint(why + ' — restore it from a backup' + (os === 'windows' ? ' or File History' : '') + ', if there is one'));
    }
    case 'rmdir': {
      const s = say('removed the empty folder ', e.path ? P(e.path) : { code: e.raw });
      if (e.why) return result(s, false, hint(vague(e.why, 'removed', 'make the folder again by hand')));
      const cmd = os === 'windows' ? (cmdValue(e.path) ? 'md ' + cmdValue(e.path) : psLine(['New-Item -ItemType Directory -Path ' + psValue(e.path) + ' | Out-Null']))
        : shLine(['mkdir ' + (e.parents ? '-p ' : '') + '-- ' + shValue(e.path)], e.sudo);
      if (!cmd) return result(s, false, hint(vague('quote', '', 'make the folder again by hand')));
      return result(s, true, runUndo(os, cmd, false, 'makes the empty folder ' + shown(e.path) + ' again'));
    }
    case 'write': {
      const p = e.path ? P(e.path) : { code: e.raw };
      if (e.kind === 'append') return result(say('added to the end of ', p), false, hint('the added text is at the end of the file — remove it by hand'));
      if (e.kind === 'clear') return result(say('emptied ', p), false, hint('its old contents were not kept — restore it from a backup or an earlier version, if it matters'));
      if (e.kind === 'edit') {
        const bak = /^sed -i(.+)$/.exec(e.tool || '');
        return result(say('edited ', p, ' in place (' + (e.tool || 'sed -i') + ')'), false, hint(bak ? 'the old version was kept next to it, with ' + bak[1] + ' on the end of its name — put that back by hand' : 'the old contents were not kept — restore it from a backup, if there is one'));
      }
      if (e.kind === 'new') {
        const s = say('created the file ', p);
        const cmd = e.why ? null : os === 'windows' ? psLine(['Remove-Item -LiteralPath ' + psValue(e.path)]) : shLine(['rm -- ' + shValue(e.path)], e.sudo);
        if (!cmd) return result(s, false, hint(vague(e.why || 'quote', 'made', 'delete it by hand if it is not wanted')));
        return result(s, true, runUndo(os, cmd, true, 'deletes the file ' + shown(e.path)));
      }
      return result(say('wrote ', p, ' (with ' + (e.tool || '>') + ': what was in it is replaced)'), false,
        hint('the old contents were not kept — restore it from a backup or an earlier version if it matters (if the file is new, just delete it)'));
    }
    case 'regset': case 'regnew': case 'regdel': {
      const key = e.path ? P(e.path) : { code: e.keyRaw || e.raw };
      const nm = e.name != null ? { code: e.name } : e.nameRaw ? { code: e.nameRaw } : null;
      if (e.op === 'regdel') {
        const s = e.all ? say('deleted every value in the registry key ', key) : say('deleted the registry value ', nm || 'it names', ' in ', key);
        return result(s, false, hint('the deleted value was not recorded, so it cannot be put back from here — set it again by hand in Registry Editor if you know it'));
      }
      if (e.op === 'regnew' && !e.why && e.name != null && e.path) {
        const s = say('added the registry value ', nm, ' to ', key);
        const cmd = psLine(['Remove-ItemProperty -LiteralPath ' + psValue(e.path) + ' -Name ' + psValue(lit(e.name))]);
        if (cmd) return result(s, true, runUndo(os, cmd, true, 'deletes the registry value ' + e.name + ' it added to ' + shown(e.path)));
      }
      return result(say('set the registry value ', nm || 'it names', ' in ', key), false,
        hint('the value it had before was not read, so it cannot be put back from here — set it back by hand in Registry Editor if you know it'));
    }
    case 'regkey': {
      const s = say('created the registry key ', e.path ? P(e.path) : { code: e.raw });
      if (e.why) return result(s, false, hint(vague(e.why, 'made', 'delete it by hand in Registry Editor if it is not wanted')));
      if (e.force) return result(s, false, hint('New-Item -Force empties a registry key that is already there, and what was in it is gone — delete it by hand if it is new and not wanted'));
      const cmd = psLine(['Remove-Item -LiteralPath ' + psValue(e.path)]);
      if (!cmd) return result(s, false, hint(vague('quote', '', 'delete it by hand in Registry Editor')));
      return result(s, true, runUndo(os, cmd, true, 'deletes the registry key ' + shown(e.path) + ' with the values in it (not if it has keys under it)'));
    }
    case 'regkeyadd': return result(say('created the registry key ', { code: e.keyRaw }, ' (if it was not there)'), false, hint('if the key is new and not wanted, delete it by hand in Registry Editor — reg add does not say whether it was there before'));
    case 'regkeydel': return result(say('deleted the registry key ', e.path ? P(e.path) : { code: e.keyRaw || e.raw }, ' and everything in it'), false, hint('what was in the key was not recorded, so it cannot be put back from here — restore it from a backup of the registry, if there is one'));
    case 'prop': return result(say('changed the property ', e.name != null ? { code: e.name } : 'it names', ' of ', e.path ? P(e.path) : { code: e.raw }), false, hint('its old value was not read — set it back by hand if you know it'));
    case 'perm': {
      const what = e.tool === 'chmod' ? 'the permissions' : e.tool === 'chgrp' ? 'the group' : 'the owner';
      return result(say('changed ' + what + ' of ', e.path ? P(e.path) : { code: e.raw }, e.recurse ? ' and everything in it' : '', e.mode ? ' to ' + oneLine(e.mode) : ''), false,
        hint(e.tool === 'chmod' ? 'the old permissions were not recorded — set them back by hand (ls -l shows them now)'
          : 'the old ' + what.replace('the ', '') + ' was not recorded — set it back by hand (ls -l shows it now)'));
    }
    case 'svc': return describeSvc(e, d);
    case 'kill': {
      const s = e.why === 'pipe' ? say('ended the programs from ', { code: e.raw }) : e.byId ? say('ended process ', { code: e.name || e.raw })
        : e.name ? say('closed the program ', { code: e.name }) : say('ended ', e.raw);
      return result(s, false, hint('a closed program cannot be resumed' + (e.name && !e.byId && !e.why ? ' — start ' + e.name + ' again if it is needed' : ' — start it again if it is needed') + ' (anything unsaved in it is lost)'));
    }
    case 'launch': return result(say('started ', { code: e.app }), true, hint('close its window'));
    default: return null;
  }
}
function describeMove(e, d) {
  const os = d.os, verb = e.op === 'move' ? 'moved' : e.op === 'copy' ? 'copied' : 'linked';
  // a source worked out when it ran ("v, or <inside> within it"): name the item in the folder -- unless v itself
  // looks like the file (a name with an extension), as after a move that renamed it
  const lf = e.src ? leafOf(e.src.v, os) : null;
  const srcPiece = e.src ? (e.src.inside && e.src.inside !== lf && !/\.[A-Za-z0-9]{1,8}$/.test(lf || '') ? [{ code: e.src.inside }, ' from ', P(e.src.v)] : [P(e.src.v)])
    : e.why === 'pipe' ? ['the items from ', { code: e.srcRaw }] : [{ code: e.srcRaw }];
  const dstPiece = e.dst ? P(e.dst.v) : { code: e.dstRaw };
  const s = e.op === 'link' ? say('made a link at ', dstPiece, ' to ', ...srcPiece) : say(verb + ' ', ...srcPiece, ' to ', dstPiece, e.recurse && e.op === 'copy' ? ' (with everything in it)' : '');
  const byHand = e.op === 'move' ? 'move it back by hand' : e.op === 'copy' ? 'delete the copy by hand if it is not wanted' : 'delete the link by hand if it is not wanted';
  if (e.why) return result(s, false, hint(vague(e.why, verb, byHand)));
  if (e.op === 'move') {
    const cmd = os === 'windows' ? psMoveBack(e.src, e.dst) : shMoveBack(e.src, e.dst, e.sudo);
    if (!cmd) return result(s, false, hint(vague('quote', '', byHand)));
    return result(s, true, runUndo(os, cmd, false, 'moves it back from ' + shown(e.dst.v) + (e.dst.inside ? ' (or from ' + e.dst.inside + ' in it, if that is a folder)' : '') + ' to ' + shown(e.src.v) +
      (e.src.inside ? ' (into it, if that is a folder)' : '') + ' — not over anything that is there now' + (e.force ? '; a file it replaced there is gone' : '')));
  }
  if (e.op === 'copy') {
    if (e.recurse && (e.tool === 'cp' || e.tool === 'Copy-Item')) return result(s, false, hint('the copy may be a folder with things in it, and that is never deleted for you — delete ' + shown(e.dst.v) + ' by hand if it is not wanted'));
    const cmd = os === 'windows' ? psRemoveMade(e.dst) : shRemoveCopy(e.dst, e.sudo);
    if (!cmd) return result(s, false, hint(vague('quote', '', byHand)));
    return result(s, true, runUndo(os, cmd, true, 'deletes the copy at ' + shown(e.dst.v) + (e.dst.inside ? ' (or ' + e.dst.inside + ' in it, if that is a folder)' : '') + ' — a file, or a folder only if it is empty'));
  }
  // a link (ln): take the link away again
  const cmd = shRemoveLink(e.dst, e.sym, e.sudo);
  if (!cmd || e.force) return result(s, false, hint(e.force ? 'ln -f replaced what was at ' + shown(e.dst.v) + ', and that is gone — delete the link by hand if it is not wanted' : vague('quote', '', byHand)));
  return result(s, true, runUndo(os, cmd, true, 'deletes the link at ' + shown(e.dst.v) + (e.dst.inside ? ' (or ' + e.dst.inside + ' in it, if that is a folder)' : '') + ' (not what it points to)'));
}
// MOVE IT BACK: from where it is now (`now`: v, or <inside> within v when v is a folder -- looked at when it runs)
// to where it was (`was`, the same), never over something that is there now.
function psMoveBack(was, now) {
  const L = now.inside ? psValue(lit(now.inside)) : '', B = was.inside ? psValue(lit(was.inside)) : '';
  return psLine([
    '$item = ' + psValue(now.v),
    now.inside ? 'if ((Test-Path -LiteralPath $item -PathType Container) -and (Test-Path -LiteralPath (Join-Path $item ' + L + '))) { $item = Join-Path $item ' + L + ' }' : '',
    '$back = ' + psValue(was.v),
    was.inside ? 'if (Test-Path -LiteralPath $back -PathType Container) { $back = Join-Path $back ' + B + ' }' : '',
    "if (Test-Path -LiteralPath $back) { throw ($back + ' is already there, so nothing was moved') }",
    'Move-Item -LiteralPath $item -Destination $back',
  ].filter((l) => l !== ''));
}
function shMoveBack(was, now, sudo) {
  const L = now.inside ? sq('/' + now.inside) : '', B = was.inside ? sq('/' + was.inside) : '';
  return shLine([
    'item=' + shValue(now.v),
    now.inside ? 'if [ -d "$item" ] && [ -e "$item"' + L + ' ]; then item="$item"' + L + '; fi' : '',
    'back=' + shValue(was.v),
    was.inside ? 'if [ -d "$back" ]; then back="$back"' + B + '; fi' : '',
    'if [ -e "$back" ] || [ -L "$back" ]; then echo "$back is already there, so nothing was moved" >&2; exit 1; fi',
    'mv -- "$item" "$back"',
  ].filter((l) => l !== ''), sudo);
}
// TAKE AWAY WHAT WAS MADE: a file, or a folder only while it is empty
function psRemoveMade(made) {
  const L = made.inside ? psValue(lit(made.inside)) : '';
  return psLine([
    '$item = ' + psValue(made.v),
    made.inside ? 'if ((Test-Path -LiteralPath $item -PathType Container) -and (Test-Path -LiteralPath (Join-Path $item ' + L + '))) { $item = Join-Path $item ' + L + ' }' : '',
    "if ((Test-Path -LiteralPath $item -PathType Container) -and (Get-ChildItem -LiteralPath $item -Force)) { throw ($item + ' is a folder with things in it, so it was left as it is') }",
    'Remove-Item -LiteralPath $item',
  ].filter((l) => l !== ''));
}
function shRemoveCopy(made, sudo) {
  const L = made.inside ? sq('/' + made.inside) : '';
  return shLine([
    'item=' + shValue(made.v),
    made.inside ? 'if [ -d "$item" ] && [ -e "$item"' + L + ' ]; then item="$item"' + L + '; fi' : '',
    'if [ -d "$item" ] && [ ! -L "$item" ]; then rmdir -- "$item"; else rm -- "$item"; fi',
  ].filter((l) => l !== ''), sudo);
}
function shRemoveLink(made, sym, sudo) {
  const L = made.inside ? sq('/' + made.inside) : '';
  return shLine([
    'item=' + shValue(made.v),
    made.inside ? 'if [ -d "$item" ] && [ ! -L "$item" ]; then item="$item"' + L + '; fi' : '',
    sym ? 'if [ ! -L "$item" ]; then echo "$item is not a link, so it was left as it is" >&2; exit 1; fi' : 'if [ -d "$item" ]; then echo "$item is a folder, so it was left as it is" >&2; exit 1; fi',
    'rm -- "$item"',
  ].filter((l) => l !== ''), sudo);
}
function describeSvc(e, d) {
  const os = d.os;
  const nm = e.name != null ? e.name : e.raw;
  const unit = 'the service ';
  const past = { start: 'started', stop: 'stopped', restart: 'restarted', enable: 'enabled', disable: 'disabled', mask: 'masked', unmask: 'unmasked', pause: 'paused', continue: 'resumed', delete: 'deleted', status: 'changed the state of' }[e.action];
  if (e.action === 'startup') {
    return result(say('set ', unit, { code: nm }, ' to start ' + (e.value ? oneLine(e.value) : 'differently')), false,
      hint('the startup type it had before was not recorded — set it back by hand in Services (services.msc) if you know it'));
  }
  if (e.action === 'describe') return result(say('changed the settings of ', unit, { code: nm }), false, hint('its old settings were not recorded — set them back by hand in Services (services.msc)'));
  const s = e.why === 'pipe' ? say(past + ' the services from ', { code: e.raw })
    : say(past + ' ' + (e.now ? 'and ' + (e.action === 'enable' ? 'started ' : 'stopped ') : ''), unit, { code: nm }, e.user ? ' (for this user)' : '');
  if (e.action === 'restart') return result(s, false, hint('nothing to put back: it is running again'));
  if (e.action === 'delete') return result(s, false, hint('a deleted service cannot be put back from here — it has to be installed again'));
  if (e.action === 'status') return result(s, false, hint('set it back by hand in Services (services.msc)'));
  if (e.why) return result(s, false, hint(vague(e.why, past, 'put each back by hand')));
  const inv = { start: 'stop', stop: 'start', enable: 'disable', disable: 'enable', mask: 'unmask', unmask: 'mask', pause: 'continue', continue: 'pause' }[e.action];
  let cmd = null;
  if (e.tool === 'ps') cmd = psLine([(inv === 'start' ? 'Start-Service' : inv === 'stop' ? 'Stop-Service' : inv === 'pause' ? 'Suspend-Service' : 'Resume-Service') + ' -' + (e.by === 'DisplayName' ? 'DisplayName' : 'Name') + ' ' + psValue(lit(nm))]);
  else if (e.tool === 'net' && cmdq(nm)) cmd = 'net ' + inv + ' ' + cmdq(nm);
  else if (e.tool === 'sc' && cmdq(nm)) cmd = 'sc ' + inv + ' ' + cmdq(nm);
  else if (e.tool === 'systemctl' && !/^-/.test(nm)) cmd = shLine(['systemctl ' + (e.user ? '--user ' : '') + inv + (e.now ? ' --now' : '') + ' ' + sq(nm)], e.sudo);
  else if (e.tool === 'service' && !/^-/.test(nm)) cmd = shLine(['service ' + sq(nm) + ' ' + inv], e.sudo);
  if (!cmd) return result(s, false, hint(vague('quote', '', 'put it back by hand')));
  const was = { start: 'stopped', stop: 'running', enable: 'disabled', disable: 'enabled', mask: 'unmasked', unmask: 'masked', pause: 'running', continue: 'paused' }[e.action];
  return result(s, true, runUndo(os, cmd, false, (inv === 'start' ? 'starts' : inv === 'stop' ? 'stops' : inv === 'enable' ? 'enables' : inv === 'disable' ? 'disables' : inv === 'mask' ? 'masks' : inv === 'unmask' ? 'unmasks' : inv === 'pause' ? 'pauses' : 'resumes') +
    ' ' + nm + ' again' + (e.now ? (inv === 'enable' ? ' and starts it' : ' and stops it') : '') + ' (as if it had been ' + was + ' before)' + (e.force && inv === 'start' ? '; services stopped with it are not started' : '')));
}

// ============================================================================================================
// CAPTURE BEFORE CHANGE (see the header). capturePlan() finds, in what a command will do, each thing whose old state
// must be read first -- one SET per thing, the last change to it in the command carrying the undo; prepare() turns
// each into commands; record() reads what they printed (readCaptured) and says the change from before and after
// (OUTCOME); cleanup() removes a visit's copies. Every command here is one line: PowerShell inside cmd.exe's double
// quotes (no " or % in it, every value through psValue) or sh (every value through shValue / sq).
// ============================================================================================================
const KEEP_MAX = 16 * 1024 * 1024;     // the biggest file a copy is kept of (ctx.maxBytes moves it, up to KEEP_CEIL)
const KEEP_CEIL = 64 * 1024 * 1024;
const KEEP_TOTAL = 256 * 1024 * 1024;  // all of one visit's copies together
const HASH_MAX = 64 * 1024 * 1024;     // a file the 'after' read hashes (inside the host's 10 s); past it, its size and time say whether it changed
const VALUE_B64 = 5464;                // 4 KB of registry data, as base64: what an undo's one command line carries
const CAPS_MAX = 16;                   // captures for one command: each is an exec, so a long list is a slow command
const WIN_BAK = /^(.+\\agent-drive-undo\\[A-Za-z0-9_-]{1,64})\\k\d{1,4}-[0-9a-f]{8}-[0-9a-f]{12}\.bak$/i;
const LNX_BAK = /^(\/[A-Za-z0-9/._-]*\/agent-drive-undo-\d{1,10}\/[A-Za-z0-9_-]{1,64})\/k\d{1,4}-[0-9a-f]{8}-[A-Za-z0-9]{6,32}$/;
const fnv8 = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const visitOf = (c) => { const v = c && (typeof c.visit === 'string' || typeof c.visit === 'number') ? String(c.visit) : ''; return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : 'visit'; };
const capOf = (c) => (c && typeof c.maxBytes === 'number' && Number.isFinite(c.maxBytes) ? Math.max(0, Math.min(KEEP_CEIL, Math.floor(c.maxBytes))) : KEEP_MAX);
const human = (n) => (n < 1024 ? plural(n, 'byte') : n < 1048576 ? Math.round(n / 1024) + ' KB' : Math.round(n / 104857.6) / 10 + ' MB');
const count = (v) => { const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : NaN; return Number.isSafeInteger(n) && n >= 0 ? n : null; };
const digits = (v) => (typeof v === 'string' && /^\d{1,20}$/.test(v) ? v : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : null);
const literalOnly = (v) => !!v && v.parts.every((p) => p.s != null);
// 'name=' + the value quoted -- or null (never the text "null") when it cannot be written safely
const setTo = (name, q) => (q == null ? null : name + '=' + q);
const quotable = (v, os) => !!v && (os === 'windows' ? psValue(v) : shValue(v)) != null;

// ---- the registry, as a path names it ------------------------------------------------------------------------
const HIVES = { HKLM: 'LocalMachine', HKEY_LOCAL_MACHINE: 'LocalMachine', HKCU: 'CurrentUser', HKEY_CURRENT_USER: 'CurrentUser', HKCR: 'ClassesRoot',
  HKEY_CLASSES_ROOT: 'ClassesRoot', HKU: 'Users', HKEY_USERS: 'Users', HKCC: 'CurrentConfig', HKEY_CURRENT_CONFIG: 'CurrentConfig' };
const HIVE_NAME = { LocalMachine: 'HKEY_LOCAL_MACHINE', CurrentUser: 'HKEY_CURRENT_USER', ClassesRoot: 'HKEY_CLASSES_ROOT', Users: 'HKEY_USERS', CurrentConfig: 'HKEY_CURRENT_CONFIG' };
// HKCU:\Software\X, HKEY_CURRENT_USER\Software\X, Registry::HKCU\Software\X -> {hive, sub, name, view}
function regTarget(e) {
  const text = e.path ? textOf(e.path) : typeof e.keyRaw === 'string' ? e.keyRaw : null;
  const m = text == null ? null : /^(?:(?:Microsoft\.PowerShell\.Core\\)?Registry::)?([A-Za-z_]+):?\\+(.+)$/i.exec(text);
  const hive = m && own(HIVES, m[1].toUpperCase()) ? HIVES[m[1].toUpperCase()] : null;
  if (!hive) return null;
  const sub = m[2].replace(/\\+$/, '');
  if (!sub || /[\u0000-\u001f/]|\\\\/.test(sub)) return null;
  return { hive, sub, name: HIVE_NAME[hive] + '\\' + sub, view: e.view === '32' ? 'Registry32' : e.view === '64' ? 'Registry64' : 'Default' };
}
const regName = (n) => (/^\(default\)$/i.test(String(n)) ? '' : String(n));

// ---- what to read, for which change ---------------------------------------------------------------------------
// a fact -> the thing its old state is read from: {fam, key, ...} (key: the same thing, the same set)
function captureTarget(f, os) {
  const e = f.effect || (f.unknown != null && isObj(f.acl) ? f.acl : null);
  if (!e || e.why) return null;
  const sudo = e.sudo || null, sk = sudo ? '|' + sudo.tool + ':' + (sudo.user || '') : '';
  const file = (v, inside) => {
    // under sudo only a path written out: a $HOME in it would be root's, not the command's
    if (!v || !v.parts || !v.parts.length || v.inside || isReg(v) || (sudo && !literalOnly(v)) || !quotable(v, os)) return null;
    return { fam: 'file', v, inside: inside || null, sudo, key: os + '|file|' + pkey(v) + '|' + (inside || '') + sk };
  };
  switch (e.op) {
    case 'write': return e.kind === 'new' ? null : file(e.path);
    case 'del': return e.dir || (e.recurse && /^(del|erase)$/i.test(e.tool || '')) ? null : file(e.path);   // del /s: that name in every folder below
    case 'copy': case 'move': return e.src && e.dst ? file(e.dst.v, e.dst.inside) : null;
    case 'mkfile': return e.force ? file(e.path) : null;
    case 'touch': return file(e.path);
    case 'mkdir': return (e.maybe || e.force) && e.path && !e.path.inside && !(sudo && !literalOnly(e.path)) && quotable(e.path, os) ? { fam: 'dir', v: e.path, sudo, key: os + '|dir|' + pkey(e.path) + sk } : null;
    case 'regset': case 'regdel': {
      const r = os === 'windows' && !e.all && e.name != null ? regTarget(e) : null;
      return r ? { fam: 'regval', reg: r, name: regName(e.name), key: 'windows|regval|' + r.view + '|' + r.name.toLowerCase() + '|' + regName(e.name).toLowerCase() } : null;
    }
    case 'regkeyadd': { const r = os === 'windows' ? regTarget(e) : null; return r ? { fam: 'regkey', reg: r, key: 'windows|regkey|' + r.view + '|' + r.name.toLowerCase() } : null; }
    case 'svc':
      if (!e.name || /[*?[\]]/.test(e.name)) return null;
      if (e.action === 'startup' && os === 'windows') return { fam: 'startup', name: e.name, key: 'windows|startup|' + e.name.toLowerCase() };
      if (e.tool === 'systemctl' && os === 'linux' && /^(enable|disable|mask|unmask)$/.test(e.action) && !/^-/.test(e.name)) return { fam: 'unit', name: e.name, user: !!e.user, sudo, key: 'linux|unit|' + (e.user ? 'user|' : '') + e.name + sk };
      return null;
    case 'perm': return os === 'linux' && !e.recurse && e.path && !e.path.inside && !(sudo && !literalOnly(e.path)) && quotable(e.path, os) ? { fam: 'mode', v: e.path, sudo, key: 'linux|mode|' + pkey(e.path) + sk } : null;
    case 'acl': return os === 'windows' && !e.recurse && e.path && !e.path.inside && quotable(e.path, os) ? { fam: 'acl', v: e.path, key: 'windows|acl|' + pkey(e.path) } : null;
    default: return null;
  }
}
// the sets of one command, in order, each with its captures {id, kind, when}; byFact: a fact's index -> its set
function capturePlan(facts, os) {
  const sets = [], byKey = new Map(), byFact = new Map();
  for (let i = 0; i < facts.length; i++) {
    let t = null;
    try { t = captureTarget(facts[i], os); } catch (_) { t = null; }
    if (!t) continue;
    let s = byKey.get(t.key);
    if (!s) { s = Object.assign(t, { facts: [], effects: [] }); byKey.set(t.key, s); sets.push(s); }
    s.facts.push(i); s.effects.push(facts[i].effect || facts[i].acl); s.last = i;
    byFact.set(i, s);
  }
  let n = 0;
  for (const s of sets) s.caps = [];
  for (const s of sets) {
    const ops = s.effects.map((x) => x.op);
    if (s.fam === 'file' && ops.includes('move') && ops.length > 1) continue;     // a move shares its place with nothing else
    const kinds = s.fam === 'file' ? (ops.every((o) => o === 'del' || o === 'move') ? [['backup', 'before']] : [['backup', 'before'], ['stamp', 'after']])
      : s.fam === 'dir' || s.fam === 'regkey' ? [['exists', 'before']]
      : s.fam === 'regval' && ops.every((o) => o === 'regdel') ? [['value', 'before']]
      : [['value', 'before'], ['value', 'after']];
    if (n + kinds.length > CAPS_MAX) break;
    for (const [kind, when] of kinds) { n++; s.caps.push({ id: 'k' + n + '-' + fnv8(s.key + '|' + kind + '|' + when), kind, when }); }
  }
  return { sets, byFact };
}

// ---- the capture commands ---------------------------------------------------------------------------------------
// Each prints ONE line: {"undo":"<id>","ok":true,...}, or ok:false with why. PowerShell's is ConvertTo-Json with
// every character outside printable ASCII as \uXXXX (a pipe's code page would mangle it), as core/desk's scripts do.
const PS_SHA = (x) => '[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash(' + x + ")).Replace('-','')";
const PS_TAIL = ["} catch { $e=$_.Exception; while ($e.InnerException) { $e=$e.InnerException }; $o.ok=$false; $o.why=''+$e.Message }",
  '$j=ConvertTo-Json -InputObject $o -Compress -Depth 4',
  "[Console]::Out.Write([regex]::Replace($j,'[^\\x20-\\x7e]',{param($m) '\\u{0:x4}' -f [int][char]$m.Value})+[char]10)",
  'if (-not $o.ok) { exit 1 }'];
function psCapture(id, body) {
  if (!body || body.some((l) => l == null)) return null;
  return psLine(["$o=[ordered]@{undo='" + id + "';ok=$true}", 'try {'].concat(body.filter((l) => l !== ''), PS_TAIL));
}
const shCapture = (lines, sudo) => (lines.some((l) => l == null) ? null : shLine(lines.filter((l) => l !== ''), sudo));
// what is at a path: none | link | dir | file {size, attr, ct, wt (FILETIME, UTC)}; "no permission" is an error, never "none"
const PS_ST = "function St($f) { $r=[ordered]@{}; $a=$null; try { $a=[IO.File]::GetAttributes($f) } catch { $e=$_.Exception; while ($e.InnerException) { $e=$e.InnerException }; " +
  "if (-not (($e -is [IO.FileNotFoundException]) -or ($e -is [IO.DirectoryNotFoundException]))) { throw $e } }; if ($null -eq $a) { $r.was='none' } elseif ($a -band 1024) { $r.was='link' } " +
  "elseif ($a -band 16) { $r.was='dir' } else { $i=[IO.FileInfo]::new($f); $r.was='file'; $r.size=$i.Length; $r.attr=[int]$a; $r.ct=''+$i.CreationTimeUtc.ToFileTimeUtc(); $r.wt=''+$i.LastWriteTimeUtc.ToFileTimeUtc() }; $r }";
const PS_HS = "function Hs($f) { $r=[IO.File]::Open($f,'Open','Read','ReadWrite'); try { " + PS_SHA('$r') + ' } finally { $r.Close() } }';
// the visit's folder: made with a protected DACL (this account and Administrators), $null when it is a link or not ours
const psKd = (visit) => "function Kd { $me=[Security.Principal.WindowsIdentity]::GetCurrent().User; $ba=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'); " +
  "$ok=@($me.Value,'S-1-5-18','S-1-5-32-544'); $d=[IO.Path]::Combine([IO.Path]::GetTempPath(),'agent-drive-undo'); $v=[IO.Path]::Combine($d,'" + visit + "'); " +
  "foreach ($x in @($d,$v)) { if (-not [IO.Directory]::Exists($x)) { $s=[Security.AccessControl.DirectorySecurity]::new(); $s.SetAccessRuleProtection($true,$false); " +
  "foreach ($u in @($me,$ba)) { $s.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($u,'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }; " +
  '[void][IO.Directory]::CreateDirectory($x,$s) }; if (([IO.File]::GetAttributes($x) -band 1024) -or ($ok -notcontains ' +
  '[IO.Directory]::GetAccessControl($x).GetOwner([Security.Principal.SecurityIdentifier]).Value)) { return $null } }; $v }';
function psBackup(s, id, o) {
  const P = psValue(s.v), L = s.inside ? psValue(lit(s.inside)) : '';
  if (P == null || L == null) return null;
  // read ONCE, hash those bytes, write those bytes: the copy is exactly what was hashed
  const keep = "$r=[IO.File]::Open($f,'Open','Read','ReadWrite'); try { $x=[byte[]]::new($r.Length); $n=0; while ($n -lt $x.Length) { $c=$r.Read($x,$n,$x.Length-$n); if ($c -le 0) { break }; $n+=$c } } finally { $r.Close() }; " +
    "if ($n -ne $x.Length) { throw 'the file changed while it was read' }; $b=[IO.Path]::Combine($v,'" + id + "-'+[Guid]::NewGuid().ToString('N').Substring(0,12)+'.bak'); " +
    "$w=[IO.File]::Open($b,'CreateNew','Write','None'); try { $w.Write($x,0,$x.Length) } finally { $w.Close() }; $o.bak=$b; $o.size=$x.Length; $o.hash=" + PS_SHA('$x');
  return psCapture(id, [PS_ST, psKd(o.visit), '$p=' + P, '$o.in=0',
    L ? 'if ([IO.Directory]::Exists($p)) { $p=[IO.Path]::Combine($p,' + L + '); $o.in=1 }' : '',
    '$f=[IO.Path]::GetFullPath($p)', '$o.full=$f', '$t=St $f', 'foreach ($k in @($t.Keys)) { $o[$k]=$t[$k] }',
    "if ($o.was -eq 'file') { if ($o.size -gt " + o.cap + ") { $o.skip='big'; $o.cap=" + o.cap + " } else { $v=Kd; if ($null -eq $v) { $o.skip='unsafe' } else { $u=0; " +
    'foreach ($y in [IO.Directory]::GetFiles($v)) { $u+=[IO.FileInfo]::new($y).Length }; if ($u + $o.size -gt ' + KEEP_TOTAL + ") { $o.skip='full'; $o.cap=" + KEEP_TOTAL + ' } else { ' + keep + ' } } } }']);
}
function psStamp(s, id) {
  const P = psValue(s.v), L = s.inside ? psValue(lit(s.inside)) : '';
  if (P == null || L == null) return null;
  return psCapture(id, [PS_ST, PS_HS, '$p=' + P, '$f=[IO.Path]::GetFullPath($p)', '$o.full=$f', '$o.at=St $f',
    "if (($o.at.was -eq 'file') -and ($o.at.size -le " + HASH_MAX + ')) { $o.at.hash=Hs $f }',
    L ? 'if ([IO.Directory]::Exists($f)) { $g=[IO.Path]::Combine($f,' + L + "); $o.inn=St $g; if (($o.inn.was -eq 'file') -and ($o.inn.size -le " + HASH_MAX + ')) { $o.inn.hash=Hs $g } }' : '']);
}
function shBackup(s, id, o) {
  const P = shValue(s.v);
  if (P == null) return null;
  const J = (rest) => `printf '{"undo":"${id}","ok":true,${rest}}\\n'`;
  return shCapture(['umask 077',
    `fail() { printf '{"undo":"${id}","ok":false,"why":"%s"}\\n' "$1"; exit 1; }`,
    'p=' + P, 'in=0',
    s.inside ? 'if [ -d "$p" ]; then p="$p"' + sq('/' + s.inside) + '; in=1; fi' : '',
    'if [ -L "$p" ]; then w=link; elif [ -d "$p" ]; then w=dir; elif [ -f "$p" ]; then w=file; elif [ -e "$p" ]; then w=other; else w=none; fi',
    'if [ "$w" != file ]; then ' + J('"was":"%s","in":%s') + ' "$w" "$in"; exit 0; fi',
    "[ -r \"$p\" ] || fail 'it cannot be read'",
    'set -- $(cksum < "$p"); crc=$1; size=$2',
    "case \"$crc:$size\" in *[!0-9:]*|:*|*:) fail 'cksum gave no answer';; esac",
    'set -- $(ls -ldn -- "$p"); mode=$1; uid=$3; gid=$4',
    "case \"$uid:$gid\" in *[!0-9:]*|:*|*:) fail 'ls gave no owner';; esac",
    "case \"$mode\" in ''|*[!a-zA-Z.+@-]*) fail 'ls gave no mode';; esac",
    `S=$(printf '"was":"file","in":%s,"size":%s,"crc":"%s","mode":"%s","uid":%s,"gid":%s' "$in" "$size" "$crc" "$mode" "$uid" "$gid")`,
    'if [ "$size" -gt ' + o.cap + ' ]; then ' + J('%s,"skip":"big","cap":' + o.cap) + ' "$S"; exit 0; fi',
    // the folder: this account's own, under its temp folder -- refused when it is a link or someone else's
    'r=${TMPDIR:-/tmp}; case "$r" in /*) ;; *) r=/tmp;; esac; case "$r" in *[!A-Za-z0-9/._-]*) r=/tmp;; esac',
    'r=${r%/}/agent-drive-undo-$(id -u); v=$r/' + o.visit,
    'for d in "$r" "$v"; do mkdir -m 700 -- "$d" 2>/dev/null; if [ -L "$d" ] || [ ! -d "$d" ] || [ ! -O "$d" ]; then ' + J('%s,"skip":"unsafe"') + ' "$S"; exit 0; fi; done',
    'set -- $(du -sk -- "$v" 2>/dev/null); u=$(( ${1:-0} * 1024 ))',
    'if [ $((u + size)) -gt ' + KEEP_TOTAL + ' ]; then ' + J('%s,"skip":"full","cap":' + KEEP_TOTAL) + ' "$S"; exit 0; fi',
    `b=$(mktemp "$v/${id}-XXXXXXXXXXXX") || fail 'no copy could be made'`,
    "cat < \"$p\" > \"$b\" && touch -r \"$p\" \"$b\" && [ \"$(cksum < \"$b\")\" = \"$crc $size\" ] || { rm -f -- \"$b\"; fail 'the file changed while it was copied'; }",
    J('%s,"bak":"%s"') + ' "$S" "$b"'], s.sudo);
}
function shStamp(s, id) {
  const P = shValue(s.v);
  if (P == null) return null;
  return shCapture([
    "st() { if [ -L \"$1\" ]; then printf '{\"was\":\"link\"}'; elif [ -d \"$1\" ]; then printf '{\"was\":\"dir\"}'; elif [ -f \"$1\" ]; then set -- $(cksum < \"$1\" 2>/dev/null); " +
    "printf '{\"was\":\"file\",\"crc\":\"%s\",\"size\":\"%s\"}' \"$1\" \"$2\"; elif [ -e \"$1\" ]; then printf '{\"was\":\"other\"}'; else printf '{\"was\":\"none\"}'; fi; }",
    'p=' + P, 'a=$(st "$p")', 'i=null',
    s.inside ? 'if [ -d "$p" ]; then i=$(st "$p"' + sq('/' + s.inside) + '); fi' : '',
    `printf '{"undo":"${id}","ok":true,"at":%s,"inn":%s}\\n' "$a" "$i"`], s.sudo);
}
// a registry value's signature: SHA-256 of type:count:base64(data) ('-' when there is none); $script:T/C/D hold them
const PS_SG = "function Sg($k,$n) { if (@($k.GetValueNames()) -notcontains $n) { return '-' }; $t=''+$k.GetValueKind($n); $v=$k.GetValue($n,$null,'DoNotExpandEnvironmentNames'); $c=0; " +
  "if (($t -eq 'String') -or ($t -eq 'ExpandString')) { $d=[Text.Encoding]::Unicode.GetBytes(''+$v) } elseif ($t -eq 'MultiString') { $c=@($v).Count; $d=[Text.Encoding]::Unicode.GetBytes((@($v) -join [char]0)) } " +
  "elseif ($t -eq 'DWord') { $d=[BitConverter]::GetBytes([int]$v) } elseif ($t -eq 'QWord') { $d=[BitConverter]::GetBytes([long]$v) } else { $d=[byte[]]$v }; if ($null -eq $d) { $d=[byte[]]@() }; " +
  "$script:T=$t; $script:C=$c; $script:D=[Convert]::ToBase64String($d); " + PS_SHA("[Text.Encoding]::UTF8.GetBytes($t+':'+$c+':'+$script:D)") + ' }';
const psRegOpen = (r, write) => ["$h=[Microsoft.Win32.RegistryKey]::OpenBaseKey('" + r.hive + "','" + r.view + "')", '$k=$h.OpenSubKey(' + psValue(lit(r.sub)) + (write ? ',$true)' : ')')];
function captureCmd(s, k, o) {
  const id = k.id, os = o.os;
  switch (s.fam) {
    case 'file':
      if (k.kind === 'backup') return os === 'windows' ? psBackup(s, id, o) : shBackup(s, id, o);
      return os === 'windows' ? psStamp(s, id) : shStamp(s, id);
    case 'dir':
      if (os === 'windows') return psCapture(id, [PS_ST, setTo('$p', psValue(s.v)), '$o.full=[IO.Path]::GetFullPath($p)', '$o.was=(St $o.full).was']);
      return shCapture([setTo('p', shValue(s.v)), 'if [ -L "$p" ]; then w=link; elif [ -d "$p" ]; then w=dir; elif [ -e "$p" ]; then w=other; else w=none; fi',
        `printf '{"undo":"${id}","ok":true,"was":"%s"}\\n' "$w"`], s.sudo);
    case 'regval':
      return psCapture(id, [PS_SG].concat(psRegOpen(s.reg, false), ['$n=' + psValue(lit(s.name)),
        "if ($null -eq $k) { $o.key=0; $o.sig='-' } else { $o.key=1; $o.sig=Sg $k $n" + (k.when === 'before' ? "; if ($o.sig -ne '-') { $o.type=$script:T; $o.count=$script:C; " +
          'if ($script:D.Length -le ' + VALUE_B64 + ") { $o.data=$script:D } else { $o.skip='long' } }" : '') + '; $k.Close() }']));
    case 'regkey':
      return psCapture(id, psRegOpen(s.reg, false).concat(["if ($null -eq $k) { $o.was='none' } else { $o.was='key'; $k.Close() }"]));
    case 'startup':
      return psCapture(id, ['$n=' + psValue(lit(s.name)), '$c=@(Get-Service -Name $n -ErrorAction SilentlyContinue)', 'if ($c.Count -eq 0) { $c=@(Get-Service -DisplayName $n) }',
        "$k=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\CurrentControlSet\\Services\\'+$c[0].Name)", "if ($null -eq $k) { throw ('there is no service ' + $n) }",
        "$o.name=$c[0].Name; $o.start=[int]$k.GetValue('Start',-1); $o.delayed=[int]$k.GetValue('DelayedAutostart',0); $k.Close()"]);
    case 'unit': {
      const u = sq(s.name), uo = s.user ? '--user ' : '';
      return shCapture([`e=$(systemctl ${uo}is-enabled ${u} 2>/dev/null); a=$(systemctl ${uo}is-active ${u} 2>/dev/null)`,
        "case \"$e\" in ''|*[!a-z-]*) e=unknown;; esac; case \"$a\" in ''|*[!a-z-]*) a=unknown;; esac",
        `printf '{"undo":"${id}","ok":true,"enabled":"%s","active":"%s"}\\n' "$e" "$a"`], s.sudo);
    }
    case 'mode':
      return shCapture([setTo('p', shValue(s.v)), `if [ -e "$p" ]; then set -- $(ls -ldnL -- "$p"); printf '{"undo":"${id}","ok":true,"mode":"%s","uid":"%s","gid":"%s"}\\n' "$1" "$3" "$4"; ` +
        `else printf '{"undo":"${id}","ok":false,"why":"it is not there"}\\n'; exit 1; fi`], s.sudo);
    case 'acl':
      return psCapture(id, [setTo('$p', psValue(s.v)), '$f=[IO.Path]::GetFullPath($p)', '$o.full=$f', '$a=[IO.File]::GetAttributes($f)',
        "if ($a -band 16) { $s=[IO.Directory]::GetAccessControl($f,'Access,Owner'); $o.dir=1 } else { $s=[IO.File]::GetAccessControl($f,'Access,Owner'); $o.dir=0 }",
        "$o.sddl=$s.GetSecurityDescriptorSddlForm('Access'); $o.owner=$s.GetOwner([Security.Principal.SecurityIdentifier]).Value"]);
    default: return null;
  }
}
function captureWhat(s, k, o) {
  const at = k.when === 'after' ? ' after the command' : ' before the command changes it';
  const place = s.v ? shown(s.v) + (s.inside ? ' (or ' + s.inside + ' in it, if that is a folder)' : '') : '';
  const w = {
    file: () => (k.kind === 'backup' ? 'keep a copy of ' + place + ', if it is a file of at most ' + human(o.cap) + ',' + at
      : 'read what is at ' + place + ' after the command, so that putting it back can tell whether it changed again'),
    dir: () => 'see whether the folder ' + place + ' is there already',
    regval: () => 'read the registry value ' + (s.name || '(Default)') + ' in ' + s.reg.name + at,
    regkey: () => 'see whether the registry key ' + s.reg.name + ' is there already',
    startup: () => 'read how the service ' + s.name + ' starts' + at,
    unit: () => 'read whether ' + s.name + ' is enabled and running' + at,
    mode: () => 'read the permissions and owner of ' + place + at,
    acl: () => 'read the permissions of ' + place + at,
  }[s.fam];
  return w ? clip(oneLine(w()), 300) : '';
}

// ---- what the captures printed ----------------------------------------------------------------------------------
// ctx.captured: [{id, ok, output}] -> Map id -> the answer's object (ok:false with why when it said nothing readable)
function readCaptured(list) {
  const got = new Map();
  for (const it of list.slice(0, 200)) {
    if (!isObj(it) || typeof it.id !== 'string' || !/^k\d{1,4}-[0-9a-f]{8}$/.test(it.id)) continue;
    const text = typeof it.output === 'string' ? it.output.slice(-600000) : '';
    const lines = text.split(/\r?\n/);
    let o = null;
    for (let i = lines.length - 1; i >= 0 && !o; i--) {
      const l = lines[i].trim();
      if (l[0] !== '{') continue;
      try { const x = JSON.parse(l); if (isObj(x) && x.undo === it.id && typeof x.ok === 'boolean') o = x; } catch (_) { /* not this line */ }
    }
    if (!o) {
      const last = lines.map((l) => oneLine(l)).filter(Boolean).pop() || '';
      o = { ok: false, why: it.ok === false && !last ? 'the host did not answer' : 'its answer could not be read' + (last ? ' (' + clip(last, 80) + ')' : '') };
    }
    got.set(it.id, o);
  }
  return got;
}
const capWhy = (o) => clip(oneLine(str(o && o.why) || 'it failed'), 120);
const WAS = ['none', 'file', 'dir', 'link', 'other'];
// a file's state as a capture said it, checked: {was, size, ...; bak + hash (Windows) / crc (Linux) when a copy is kept}
function fileState(o, os, before) {
  if (!isObj(o) || !WAS.includes(o.was)) return null;
  const st = { was: o.was, in: o.in === 1 ? 1 : 0 };
  if (o.was !== 'file') return st;
  st.size = count(o.size);
  if (st.size == null) return null;
  if (os === 'windows') {
    st.wt = digits(o.wt); st.ct = digits(o.ct) || st.wt; st.attr = Number.isInteger(o.attr) && o.attr >= 0 ? o.attr : 32;
    if (typeof o.hash === 'string' && /^[0-9A-F]{64}$/.test(o.hash)) st.hash = o.hash;
    if (!st.wt) return null;
  } else {
    st.crc = typeof o.crc === 'string' && /^\d{1,10}$/.test(o.crc) ? o.crc : null;
    if (!st.crc) return null;
    if (before) {
      st.mode = typeof o.mode === 'string' && /^-[-rwxsStT]{9}[.+@]?$/.test(o.mode) ? o.mode : null;
      st.uid = count(o.uid); st.gid = count(o.gid);
    }
  }
  if (before) {
    if (typeof o.bak === 'string' && (os === 'windows' ? WIN_BAK.test(o.bak) && st.hash : LNX_BAK.test(o.bak))) st.bak = o.bak;
    if (typeof o.skip === 'string') st.skip = o.skip;
    st.cap = count(o.cap);
  }
  return st;
}
function skipWhy(b) {
  if (b.skip === 'big') return 'it was ' + human(b.size) + ', over the ' + human(b.cap != null ? b.cap : KEEP_MAX) + ' a copy is kept of';
  if (b.skip === 'full') return 'this visit\u2019s copies already fill the ' + human(KEEP_TOTAL) + ' they may take';
  if (b.skip === 'unsafe') return 'the folder copies are kept in is not this account\u2019s alone';
  return 'the copy could not be made';
}
// a sentence and its Markdown, with more on the end
const append = (s, text) => ({ what: clip(s.what + text, 400), md: clip(s.md + mdEsc(text), 700) });
// the change as it is described without captures, with why no copy (or no old value) was kept added to how it is put back
function withWhy(base, why) {
  const r = Object.assign({}, base);
  if (r.undo && r.undo.kind === 'hint') r.undo = hint(r.undo.text + ' (' + why + ')');
  else if (r.undo && r.undo.kind === 'exec') r.undo = Object.assign({}, r.undo, { note: r.undo.note + ' (' + why + ')' });
  else r.undo = hint(why);
  return r;
}
const notBack = (base, text) => result(base, false, hint(text));

// ---- putting back: the lines each restore is made of --------------------------------------------------------------
// The kept copy: there, and exactly what was kept (the hash taken when it was made). PowerShell reads it ONCE and
// writes those very bytes, so a copy changed after the check cannot be what goes back.
function psKept(k) {
  return ['$b=' + psValue(lit(k.bak)), "if (-not [IO.File]::Exists($b)) { throw ('the copy kept of it is gone (' + $b + '), so nothing was put back') }",
    '$x=[IO.File]::ReadAllBytes($b)', 'if (' + PS_SHA('$x') + " -ne '" + k.hash + "') { throw ('the copy kept of it (' + $b + ') is not what was kept, so nothing was put back') }"];
}
// the file at $t is exactly what the command left there (the 'after' read): else nothing is touched
function psAsLeft(a) {
  return ['$i=[IO.FileInfo]::new($t)', "if ((-not $i.Exists) -or ($i.Attributes -band 1040)) { throw ($t + ' is not the file this change left there, so it was left as it is') }",
    a.hash ? "$r=[IO.File]::Open($t,'Open','Read','ReadWrite'); try { $h=" + PS_SHA('$r') + ' } finally { $r.Close() }' : '',
    'if (($i.Length -ne ' + a.size + ') -or (' + (a.hash ? "$h -ne '" + a.hash + "'" : '$i.LastWriteTimeUtc.ToFileTimeUtc() -ne ' + a.wt) +
    ")) { throw ($t + ' was changed again after this change, so it was left as it is') }"].filter((l) => l !== '');
}
const ATTR_SET = 1 | 2 | 4 | 32 | 256 | 4096 | 8192;   // read-only, hidden, system, archive, temporary, offline, not indexed: what SetAttributes sets
const psTimes = (k, made) => [made ? '[IO.File]::SetCreationTimeUtc($t,[DateTime]::FromFileTimeUtc(' + k.ct + '))' : '',
  '[IO.File]::SetLastWriteTimeUtc($t,[DateTime]::FromFileTimeUtc(' + k.wt + '))', '[IO.File]::SetAttributes($t,[IO.FileAttributes]' + ((k.attr & ATTR_SET) || 128) + ')'].filter((l) => l !== '');
const psRecreate = (k) => ["if ([IO.File]::Exists($t) -or [IO.Directory]::Exists($t)) { throw ($t + ' is there again, so the copy was not put back over it') }",
  "$w=[IO.File]::Open($t,'CreateNew','Write','None'); try { $w.Write($x,0,$x.Length) } finally { $w.Close() }"].concat(psTimes(k, true));
const psOverwrite = (k) => ["[IO.File]::SetAttributes($t,'Normal')", "$w=[IO.File]::Open($t,'Open','Write','None'); try { $w.SetLength(0); $w.Write($x,0,$x.Length) } finally { $w.Close() }"].concat(psTimes(k, false));
// sh: the copy is this account's alone (mode 700 folder); cksum's CRC and size say it is the one kept
const shKept = (k) => ['b=' + sq(k.bak), '[ -f "$b" ] || { echo "the copy kept of it ($b) is gone, so nothing was put back" >&2; exit 1; }',
  '[ "$(cksum < "$b")" = ' + sq(k.crc + ' ' + k.size) + ' ] || { echo "the copy kept of it ($b) is not what was kept, so nothing was put back" >&2; exit 1; }'];
const shAsLeft = (a) => ['if [ -L "$t" ] || [ ! -f "$t" ] || [ "$(cksum < "$t")" != ' + sq(a.crc + ' ' + a.size) + ' ]; then echo "$t was changed again after this change, so it was left as it is" >&2; exit 1; fi'];
// '-rwsr-x--T' -> '5750' (setuid 4 + sticky 1): the mode ls printed, as chmod takes it
function modeOct(m) {
  if (typeof m !== 'string' || !/^.[-r][-w][-xsS][-r][-w][-xsS][-r][-w][-xtT]/.test(m)) return null;
  let special = 0, out = '';
  for (let i = 0; i < 3; i++) {
    const t = m.slice(1 + i * 3, 4 + i * 3);
    out += (t[0] === 'r' ? 4 : 0) + (t[1] === 'w' ? 2 : 0) + (/[xst]/.test(t[2]) ? 1 : 0);
    if (/[sStT]/.test(t[2])) special += [4, 2, 1][i];
  }
  return special + out;
}
const shMode = (k) => (k.mode && modeOct(k.mode) ? ' && chmod ' + modeOct(k.mode) + ' -- "$t"' : '');
const shRecreate = (k) => ['if [ -e "$t" ] || [ -L "$t" ]; then echo "$t is there again, so the copy was not put back over it" >&2; exit 1; fi',
  '(set -C; cat < "$b" > "$t") && touch -r "$b" "$t"' + shMode(k) + (k.uid != null && k.gid != null ? ' && { [ "$(id -u)" != 0 ] || chown ' + k.uid + ':' + k.gid + ' -- "$t"; }' : '')];
const shOverwrite = (k) => ['cat < "$b" > "$t" && touch -r "$b" "$t"' + shMode(k)];

// ---- from before and after to the entry: OUTCOME[fam](set, got, os) -> result | null (no change at all) | undefined
// (nothing usable: the entry is as it would be without captures) ------------------------------------------------
function fileOutcome(s, got, os) {
  const e = s.effects[s.effects.length - 1];
  const base = describe(e, { os });
  if (!base) return undefined;
  const B = got('backup', 'before');
  if (B === undefined) return undefined;
  const plain = (why) => Object.assign(withWhy(base, why), { paths: pathsOf(e, os) });
  if (!B.ok) return plain('no copy of it was kept: ' + capWhy(B));
  const b = fileState(B, os, true);
  if (!b) return plain('no copy of it was kept: its answer could not be read');
  if (b.was === 'dir') return plain('no copy was kept: it was a folder, and a folder is never copied — only single files are');
  if (b.was === 'link' || b.was === 'other') return plain('no copy was kept: it was a link, not a plain file');
  if (b.was === 'file' && !b.bak) return plain('no copy was kept: ' + skipWhy(b));
  const T = b.in && s.inside ? joinP(normTail(s.v, os), lit(s.inside), os) : s.v;     // where the change happened, exactly
  const paths = pathsOf(e, os, T);
  const backup = b.bak ? Object.assign({ os, path: b.bak, bytes: b.size }, s.sudo ? { sudo: s.sudo } : {}) : null;
  const run = (lines, risky, note, sentence) => {
    const cmd = os === 'windows' ? psLine(lines) : shLine(lines, s.sudo);
    if (!cmd) return Object.assign(notBack(sentence, vague('quote', '', 'put it back by hand') + (backup ? ' (a copy of what was there is kept at ' + backup.path + ' until this visit ends)' : '')), { paths }, backup ? { backup } : {});
    return Object.assign(result(sentence, true, runUndo(os, cmd, risky, note)), { paths }, backup ? { backup } : {});
  };
  const W = (k) => (os === 'windows' ? [setTo('$t', psValue(T))] : [setTo('t', shValue(T))]).concat(k);
  if (e.op === 'move') {
    if (b.was === 'none') return Object.assign({}, base, { paths });                   // it replaced nothing: the move's own undo
    const src = e.src;
    const back = os === 'windows'
      ? [setTo('$back', psValue(src.v)), src.inside ? 'if (Test-Path -LiteralPath $back -PathType Container) { $back=Join-Path $back ' + psValue(lit(src.inside)) + ' }' : '',
        "if (Test-Path -LiteralPath $back) { throw ($back + ' is already there, so nothing was moved') }", 'Move-Item -LiteralPath $t -Destination $back']
      : [setTo('back', shValue(src.v)), src.inside ? 'if [ -d "$back" ]; then back="$back"' + sq('/' + src.inside) + '; fi' : '',
        'if [ -e "$back" ] || [ -L "$back" ]; then echo "$back is already there, so nothing was moved" >&2; exit 1; fi', 'mv -- "$t" "$back" || exit 1'];
    return run(W(os === 'windows' ? psKept(b) : shKept(b)).concat(back.filter((l) => l !== ''), os === 'windows' ? psRecreate(b) : shRecreate(b)), false,
      'moves it back from ' + shown(T) + ' to ' + shown(src.v) + (src.inside ? ' (into it, if that is a folder)' : '') + ' — not over anything that is there now — then puts back the file it replaced there, from the copy kept of it (' + human(b.size) + ')',
      append(base, ', replacing the file that was there'));
  }
  // what the command left there: read after it ran -- or, when every change to it was a delete, nothing
  let a = null;
  if (s.caps.some((k) => k.kind === 'stamp')) { const A = got('stamp', 'after'); if (A && A.ok) a = fileState(b.in && s.inside ? A.inn : A.at, os, false); }
  else a = { was: 'none' };
  if (b.was === 'none') {
    if (!a || (a.was !== 'none' && a.was !== 'file')) return undefined;
    if (a.was === 'none') return null;                                              // nothing was there, nothing is
    return run(W(os === 'windows' ? psAsLeft(a).concat(["[IO.File]::SetAttributes($t,'Normal')", '[IO.File]::Delete($t)']) : shAsLeft(a).concat(['rm -f -- "$t"'])), true,
      'deletes ' + shown(T) + ', which was not there before — only if it is still exactly as this change left it',
      e.op === 'copy' ? base : say('created the file ', P(T), e.op === 'touch' ? ' (touch)' : e.op === 'write' ? ' (with ' + (e.tool || '>') + ')' : ''));
  }
  // a file was there, and a copy of it is kept
  if (!a || (a.was !== 'none' && a.was !== 'file')) {
    return Object.assign(notBack(base, 'a copy of what was there before is kept at ' + b.bak + ' until this visit ends; what the command left was not read, so it is not put back for you — copy it back by hand if it matters'), { paths, backup });
  }
  if (a.was === 'none') {
    return run(W(os === 'windows' ? psKept(b).concat(psRecreate(b)) : shKept(b).concat(shRecreate(b))), false,
      'puts ' + shown(T) + ' back from the copy kept of it (' + human(b.size) + ') — only if nothing is there now', base);
  }
  if (os === 'windows' ? a.hash && a.hash === b.hash && a.size === b.size && a.wt === b.wt : e.op !== 'touch' && a.crc === b.crc && a.size === b.size) return null;   // the same bytes: no change
  const sentence = e.op === 'copy' ? append(base, ', replacing the file that was there') : e.op === 'touch' ? say('changed the date of ', P(T), ' (touch)')
    : e.op === 'mkfile' ? say('emptied ', P(T), ' (New-Item -Force put an empty file in its place)') : base;
  return run(W(os === 'windows' ? psKept(b).concat(psAsLeft(a), psOverwrite(b)) : shKept(b).concat(shAsLeft(a), shOverwrite(b))), false,
    'puts back what ' + shown(T) + ' held before (' + human(b.size) + ', from the copy kept of it) — only if it is still exactly as this change left it', sentence);
}
function dirOutcome(s, got, os) {
  const E = got('exists', 'before');
  if (!E || !E.ok || !WAS.includes(E.was)) return undefined;
  if (E.was === 'dir') return null;                                                 // it was there already: nothing was made
  if (E.was !== 'none') return undefined;
  const e = s.effects[s.effects.length - 1];
  const r = describe(Object.assign({}, e, { maybe: false, force: false }), { os });  // made by this command, for certain
  return r ? Object.assign(r, { paths: pathsOf(e, os) }) : undefined;
}
// a registry value as a capture said it: {key: 0|1, sig, type?, count?, data?, skip?}
function regState(o, before) {
  if (!isObj(o) || (o.key !== 0 && o.key !== 1) || !(o.sig === '-' || (typeof o.sig === 'string' && /^[0-9A-F]{64}$/.test(o.sig)))) return null;
  const st = { key: o.key, sig: o.sig };
  if (before && o.sig !== '-') {
    st.type = typeof o.type === 'string' ? o.type : '';
    st.count = count(o.count) || 0;
    if (typeof o.data === 'string' && o.data.length <= VALUE_B64 && o.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(o.data)) st.data = o.data;
    if (typeof o.skip === 'string') st.skip = o.skip;
  }
  return st;
}
function psRegData(b) {
  const x = "[Convert]::FromBase64String('" + b.data + "')";
  switch (b.type) {
    case 'String': case 'ExpandString': return '[Text.Encoding]::Unicode.GetString(' + x + ')';
    case 'MultiString': return b.count ? '[string[]]([Text.Encoding]::Unicode.GetString(' + x + ').Split([char]0))' : '[string[]]@()';
    case 'DWord': return '[BitConverter]::ToInt32(' + x + ',0)';
    case 'QWord': return '[BitConverter]::ToInt64(' + x + ',0)';
    case 'Binary': case 'None': return x;
    default: return null;
  }
}
function regvalOutcome(s, got, os) {
  const e = s.effects[s.effects.length - 1], r = s.reg;
  const base = describe(e, { os });
  const B = got('value', 'before');
  if (!base || B === undefined) return undefined;
  const paths = pathsOf(e, os);
  if (!B.ok) return Object.assign(withWhy(base, 'its old value could not be read: ' + capWhy(B)), { paths });
  const b = regState(B, true);
  if (!b) return Object.assign(withWhy(base, 'its old value could not be read'), { paths });
  const nm = s.name || '(Default)';
  const open = [PS_SG].concat(psRegOpen(r, true), ['$n=' + psValue(lit(s.name)), "if ($null -eq $k) { throw ('the registry key ' + " + psValue(lit(r.name)) + " + ' is gone, so it was left as it is') }"]);
  const setBack = () => (b.sig === '-' ? '$k.DeleteValue($n)' : psRegData(b) && b.data != null && !b.skip ? '$k.SetValue($n,' + psRegData(b) + ",'" + b.type + "')" : null);
  const cantSet = () => (b.skip === 'long' ? 'its old value is over 4 KB, more than one command can put back' : 'its old value is of a type (' + (b.type || 'unknown') + ') this cannot write back');
  if (e.op === 'regdel') {
    if (b.sig === '-') return null;                                                 // there was no such value
    const set = setBack();
    if (!set) return Object.assign(withWhy(base, cantSet()), { paths });
    const cmd = psLine(open.concat(["if ((Sg $k $n) -ne '-') { throw ('the registry value ' + $n + ' is there again, so it was left as it is') }", set, '$k.Close()']));
    if (!cmd) return Object.assign(withWhy(base, HINT.long()), { paths });
    return Object.assign(result(base, true, runUndo(os, cmd, false, 'puts the registry value ' + nm + ' back in ' + r.name + ', as it was (' + b.type + ') — only if it has no value now')), { paths });
  }
  const A = got('value', 'after');
  const a = A && A.ok ? regState(A, false) : null;
  if (!a) return undefined;                                                         // what the command left was not read
  if (a.sig === b.sig && a.key === b.key) return null;                              // it had that value already
  const set = setBack();
  if (!set) return Object.assign(withWhy(base, cantSet()), { paths });
  const cmd = psLine(open.concat(["if ((Sg $k $n) -ne '" + a.sig + "') { throw ('the registry value ' + $n + ' was changed again after this change, so it was left as it is') }", set,
    b.key === 0 ? 'if (($k.ValueCount -eq 0) -and ($k.SubKeyCount -eq 0)) { $k.Close(); $h.DeleteSubKey(' + psValue(lit(r.sub)) + ') } else { $k.Close() }' : '$k.Close()']));
  const sentence = b.sig === '-' ? say('added the registry value ', { code: nm }, ' to ', { code: r.name }, b.key === 0 ? ' (and made the key)' : '') : base;
  if (!cmd) return Object.assign(notBack(sentence, HINT.long()), { paths });
  return Object.assign(result(sentence, true, runUndo(os, cmd, b.sig === '-', b.sig === '-'
    ? 'deletes the registry value ' + nm + ' it added to ' + r.name + (b.key === 0 ? ', and the key if nothing else is in it (keys made above it stay)' : '') + ' — only if it is still what this change set'
    : 'sets the registry value ' + nm + ' in ' + r.name + ' back to what it was (' + b.type + ') — only if it is still what this change set')), { paths });
}
function regkeyOutcome(s, got, os) {
  const E = got('exists', 'before');
  if (!E || !E.ok || (E.was !== 'none' && E.was !== 'key')) return undefined;
  if (E.was === 'key') return null;                                                 // reg add of a key that is there does nothing
  const e = s.effects[s.effects.length - 1], r = s.reg;
  // reg add <key> leaves an empty default value in it: that, and nothing else, is what it made
  const cmd = psLine(psRegOpen(r, false).concat(["if ($null -eq $k) { throw ('the registry key ' + " + psValue(lit(r.name)) + " + ' is gone already') }",
    "$v=@($k.GetValueNames()); if (($k.SubKeyCount -gt 0) -or ($v.Count -gt 1) -or (($v.Count -eq 1) -and (($v[0] -ne '') -or (''+$k.GetValue('') -ne '')))) { $k.Close(); throw ('the registry key ' + " +
    psValue(lit(r.name)) + " + ' has values or keys in it now, so it was left as it is') }", '$k.Close()', '$h.DeleteSubKey(' + psValue(lit(r.sub)) + ')']));
  const sentence = say('created the registry key ', { code: r.name });
  if (!cmd) return Object.assign(notBack(sentence, HINT.long()), { paths: pathsOf(e, os) });
  return Object.assign(result(sentence, true, runUndo(os, cmd, true, 'deletes the registry key ' + r.name + ' — only while nothing is in it; keys made above it stay')), { paths: pathsOf(e, os) });
}
const START = ['Boot', 'System', 'Automatic', 'Manual', 'Disabled'], SC_START = ['boot', 'system', 'auto', 'demand', 'disabled'];
const startWord = (x) => (x.start === 2 && x.delayed ? 'Automatic (Delayed Start)' : START[x.start]);
function startupOutcome(s, got, os) {
  const e = s.effects[s.effects.length - 1];
  const base = describe(e, { os });
  const B = got('value', 'before');
  if (!base || B === undefined) return undefined;
  const st = (o) => (isObj(o) && o.ok && typeof o.name === 'string' && /^[^\u0000-\u001f\\/]{1,256}$/.test(o.name) && Number.isInteger(o.start) && o.start >= 0 && o.start <= 4
    ? { name: o.name, start: o.start, delayed: o.delayed === 1 ? 1 : 0 } : null);
  const b = st(B);
  if (!b) return withWhy(base, 'its old startup type could not be read' + (B.ok ? '' : ': ' + capWhy(B)));
  const a = st(got('value', 'after'));
  if (!a) return withWhy(base, 'it started ' + startWord(b) + ' before; what the command left was not read, so it is not set back for you');
  if (a.start === b.start && a.delayed === b.delayed) return null;
  const n = psValue(lit(b.name));
  const cmd = psLine(['$n=' + n, "$k=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\CurrentControlSet\\Services\\'+$n)",
    "if ($null -eq $k) { throw ('there is no service ' + $n + ' now, so nothing was changed') }",
    "if (([int]$k.GetValue('Start',-1) -ne " + a.start + ") -or ([int]$k.GetValue('DelayedAutostart',0) -ne " + a.delayed + ")) { $k.Close(); throw ('the service ' + $n + ' was set to start differently again after this change, so it was left as it is') }",
    '$k.Close()', '$x=& sc.exe config $n start= ' + (b.start === 2 && b.delayed ? 'delayed-auto' : SC_START[b.start]),
    "if ($LASTEXITCODE) { throw ('sc.exe could not set it back: ' + (@($x) -join ' ')) }"]);
  const sentence = append(base, ' (it was ' + startWord(b) + ')');
  if (!cmd) return notBack(sentence, HINT.long());
  return result(sentence, true, runUndo(os, cmd, false, 'sets the service ' + b.name + ' to start ' + startWord(b) + ' again — only if it is still set as this change left it'));
}
function unitOutcome(s, got, os) {
  const e = s.effects[s.effects.length - 1];
  const base = describe(e, { os });
  const st = (o) => (isObj(o) && o.ok && /^[a-z-]{1,40}$/.test(str(o.enabled)) && /^[a-z-]{1,40}$/.test(str(o.active)) && o.enabled !== 'unknown' ? { enabled: o.enabled, active: o.active } : null);
  const b = st(got('value', 'before')), a = st(got('value', 'after'));
  if (!base || !b || !a || (e.now && (b.active === 'unknown' || a.active === 'unknown'))) return undefined;   // as without: started/stopped as if
  let verb = '';
  if (b.enabled !== a.enabled) {
    verb = e.action === 'enable' || e.action === 'disable' ? (b.enabled === 'enabled' ? 'enable' : b.enabled === 'disabled' ? 'disable' : '')
      : e.action === 'mask' ? (b.enabled !== 'masked' ? 'unmask' : '') : b.enabled === 'masked' ? 'mask' : '';
    if (!verb) return notBack(base, 'it was ' + b.enabled + ' before, which no single systemctl command sets back — set it back by hand if it matters');
  }
  let go = '';
  if (e.now && b.active !== a.active) {
    go = b.active === 'active' ? 'start' : b.active === 'inactive' || b.active === 'failed' ? 'stop' : '';
    if (!go) return notBack(base, 'it was ' + b.active + ' before, which is not set back from here');
  }
  if (!verb && !go) return null;                                                    // it was that way already
  const uo = e.user ? '--user ' : '';
  const cmd = shLine(['u=' + sq(e.name), 'e=$(systemctl ' + uo + 'is-enabled "$u" 2>/dev/null)',
    'if [ "$e" != ' + sq(a.enabled) + ' ]; then echo "the service $u was changed again after this change, so it was left as it is" >&2; exit 1; fi',
    e.now ? 'x=$(systemctl ' + uo + 'is-active "$u" 2>/dev/null); if [ "$x" != ' + sq(a.active) + ' ]; then echo "the service $u was started or stopped again after this change, so it was left as it is" >&2; exit 1; fi' : '',
    verb ? 'systemctl ' + uo + verb + ' "$u" || exit 1' : '', go ? 'systemctl ' + uo + go + ' "$u"' : ''].filter((l) => l !== ''), e.sudo);
  if (!cmd) return notBack(base, vague('quote', '', 'put it back by hand'));
  return result(base, true, runUndo(os, cmd, false, (verb ? verb + 's ' + e.name + ' again (it was ' + b.enabled + ')' : '') + (verb && go ? ' and ' : '') + (go ? (go === 'start' ? 'starts ' : 'stops ') + e.name + ' (it was ' + b.active + ')' : '') +
    ' — only if it is still as this change left it'));
}
function modeOutcome(s, got, os) {
  const e = s.effects[s.effects.length - 1];
  const base = describe(e, { os });
  const st = (o) => (isObj(o) && o.ok && typeof o.mode === 'string' && /^[-dlcbps][-rwxsStT]{9}[.+@]?$/.test(o.mode) && count(o.uid) != null && count(o.gid) != null ? { mode: o.mode, uid: count(o.uid), gid: count(o.gid) } : null);
  const b = st(got('value', 'before')), a = st(got('value', 'after'));
  if (!base || !b || !a || !modeOct(b.mode)) return undefined;
  if (b.mode === a.mode && b.uid === a.uid && b.gid === a.gid) return null;
  const own = b.uid !== a.uid || b.gid !== a.gid, oct = modeOct(b.mode);
  const cmd = shLine([setTo('p', shValue(s.v)), 'set -- $(ls -ldnL -- "$p" 2>/dev/null)',
    'if [ "$1 $3 $4" != ' + sq(a.mode + ' ' + a.uid + ' ' + a.gid) + ' ]; then echo "$p was changed again after this change, so it was left as it is" >&2; exit 1; fi',
    own ? 'chown ' + b.uid + ':' + b.gid + ' -- "$p" || exit 1' : '', 'chmod ' + oct + ' -- "$p"'].filter((l) => l !== ''), s.sudo);
  const sentence = append(base, e.tool === 'chmod' ? ' (it was ' + oct.replace(/^0(?=\d{3}$)/, '') + ')' : ' (it was owned by ' + b.uid + ':' + b.gid + ')');
  if (!cmd) return notBack(sentence, vague('quote', '', 'set it back by hand'));
  return result(sentence, true, runUndo(os, cmd, false, 'sets the ' + (own ? 'owner and permissions' : 'permissions') + ' of ' + shown(s.v) + ' back (' + oct + (own ? ', ' + b.uid + ':' + b.gid : '') + ') — only if they are still as this change left them'));
}
function aclOutcome(s, got, os) {
  const e = s.effects[s.effects.length - 1];
  const st = (o) => (isObj(o) && o.ok && typeof o.sddl === 'string' && o.sddl.length <= 6000 && /^D:/.test(o.sddl) && typeof o.owner === 'string' && /^S-1-[0-9-]{1,200}$/.test(o.owner) ? { sddl: o.sddl, owner: o.owner } : null);
  const b = st(got('value', 'before')), a = st(got('value', 'after'));
  if (!b || !a) return undefined;                                                   // as without: a command it cannot name
  if (b.sddl === a.sddl && b.owner === a.owner) return null;
  const sentence = say('changed the permissions of ', P(e.path), ' (icacls)');
  const set = (cls) => '$n=[Security.AccessControl.' + cls + 'Security]::new(); $n.SetSecurityDescriptorSddlForm(' + psValue(lit(b.sddl)) + ",'Access'); [IO." + (cls === 'Directory' ? 'Directory' : 'File') + ']::SetAccessControl($f,$n)';
  const cmd = psLine([setTo('$p', psValue(s.v)), '$f=[IO.Path]::GetFullPath($p)', '$a=[IO.File]::GetAttributes($f)',
    "if ($a -band 16) { $s=[IO.Directory]::GetAccessControl($f,'Access,Owner') } else { $s=[IO.File]::GetAccessControl($f,'Access,Owner') }",
    "if (($s.GetSecurityDescriptorSddlForm('Access') -ne " + psValue(lit(a.sddl)) + ") -or ($s.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne '" + a.owner + "')) { throw ($f + ' had its permissions changed again after this change, so they were left as they are') }",
    b.sddl !== a.sddl ? 'if ($a -band 16) { ' + set('Directory') + ' } else { ' + set('File') + ' }' : '',
    b.owner !== a.owner ? "$x=& icacls.exe $f /setowner ('*" + b.owner + "') /Q; if ($LASTEXITCODE) { throw ('icacls could not set the owner back: ' + (@($x) -join ' ')) }" : ''].filter((l) => l !== ''));
  if (!cmd) return Object.assign(notBack(sentence, HINT.long()), { paths: pathsOf(e, os) });
  return Object.assign(result(sentence, true, runUndo(os, cmd, false, 'sets the permissions of ' + shown(s.v) + ' back to what they were' + (b.owner !== a.owner ? ', and its owner' : '') + ' — only if they are still as this change left them')), { paths: pathsOf(e, os) });
}
const OUTCOME = { file: fileOutcome, dir: dirOutcome, regval: regvalOutcome, regkey: regkeyOutcome, startup: startupOutcome, unit: unitOutcome, mode: modeOutcome, acl: aclOutcome };
// fact i, with what was captured -> a result | null (no change: no entry) | undefined (as without captures). The
// last change to a thing in a command carries its undo; an earlier one to the same thing is put back with it.
function capturedResult(i, f, cap, os) {
  const s = cap.plan.byFact.get(i);
  if (!s || !s.caps.length) return undefined;
  if (!own(s, 'res')) {
    const got = (kind, when) => { const k = s.caps.find((x) => x.kind === kind && x.when === when); return k && cap.got.has(k.id) ? cap.got.get(k.id) : undefined; };
    try { s.res = OUTCOME[s.fam](s, got, os); } catch (_) { s.res = undefined; }
  }
  if (i === s.last || s.res === undefined) return s.res;
  if (s.res === null) return null;
  if (!(s.res.undo && s.res.undo.kind === 'exec')) return undefined;
  const e = f.effect || f.acl;
  const sentence = e.op === 'acl' ? say('changed the permissions of ', P(e.path), ' (icacls)') : describe(e, { os });
  return sentence ? Object.assign(notBack(sentence, 'the same command changed it again after this — putting back that later change puts back what was there before both'), { paths: pathsOf(e, os) }) : undefined;
}

// ---- where an entry's change is: paths, for supersede() -----------------------------------------------------------
// a path as text, its variables in one spelling (Windows %NAME%, ~ as %USERPROFILE%; sh $NAME, ~ as $HOME)
function canon(v, os) {
  if (!v || !v.parts || !v.parts.length || v.inside) return null;
  let s = '';
  for (const p of v.parts) {
    if (p.s != null) s += p.s;
    else if (p.home) s += os === 'windows' ? '%USERPROFILE%' : '$HOME';
    else if (p.env != null) s += os === 'windows' ? '%' + p.env.toUpperCase() + '%' : '$' + p.env;
    else return null;
  }
  return s || null;
}
// effect -> {os, made?, from?, to?, removed?} (lists of paths) | null. `T`: where the change happened, when a
// capture said it exactly. A destination that may have been a folder is the folder: whatever deletes or moves
// that, takes the item with it either way.
function pathsOf(e, os, T) {
  if (!e || e.why) return null;
  const out = { made: [], from: [], to: [], removed: [] };
  const add = (k, v) => { const c = canon(v, os); if (c) out[k].push(c); };
  const reg = (k, r, name) => { if (r) out[k].push('Registry::' + r.name + (name != null ? '\\' + (name === '' ? '(Default)' : name) : '')); };
  switch (e.op) {
    case 'move': if (e.src && !e.src.inside) add('from', e.src.v); if (e.dst) add('to', T || e.dst.v); break;
    case 'copy': case 'link': if (e.dst) add('made', T || e.dst.v); break;
    case 'rename': {
      const par = e.path && e.newName != null ? parentOf(e.path, os) : null;
      if (par) { add('from', e.path); add('to', isHere(par) ? lit(e.newName) : joinP(par, lit(e.newName), os)); }
      break;
    }
    case 'mkdir': case 'mkfile': case 'mklink': case 'touch': case 'write': case 'perm': case 'acl': add('made', T || e.path); break;
    case 'del': case 'rmdir': add('removed', T || e.path); break;
    case 'regkey': case 'regkeyadd': reg('made', regTarget(e)); break;
    case 'regset': case 'regnew': if (e.name != null) reg('made', regTarget(e), regName(e.name)); break;
    case 'regdel': if (!e.all && e.name != null) reg('removed', regTarget(e), regName(e.name)); break;
    case 'regkeydel': reg('removed', regTarget(e)); break;
    default: return null;
  }
  const r = { os };
  for (const k of ['made', 'from', 'to', 'removed']) if (out[k].length) r[k] = out[k];
  return Object.keys(r).length > 1 ? r : null;
}

// ---- cleanup: this visit's copies, and its folders when they are empty ----------------------------------------------
function psCleanup(visit, dirs) {
  const list = ["[IO.Path]::Combine([IO.Path]::GetTempPath(),'agent-drive-undo','" + visit + "')"].concat(dirs.map((d) => psValue(lit(d))));
  return psLine(["$o=[ordered]@{undo='cleanup';ok=$true;removed=0}",
    'foreach ($v in @(' + list.join(',') + ')) { try { $r=[IO.Path]::GetDirectoryName($v); if ([IO.Directory]::Exists($v) -and -not (([IO.File]::GetAttributes($v) -bor [IO.File]::GetAttributes($r)) -band 1024)) { ' +
    "foreach ($f in [IO.Directory]::GetFiles($v)) { if ([IO.Path]::GetFileName($f) -cmatch '^k[0-9]+-[0-9a-f]{8}-[0-9a-f]{12}[.]bak$') { [IO.File]::SetAttributes($f,'Normal'); [IO.File]::Delete($f); $o.removed=$o.removed+1 } }; " +
    'if (@([IO.Directory]::GetFileSystemEntries($v)).Count -eq 0) { [IO.Directory]::Delete($v) }; if (@([IO.Directory]::GetFileSystemEntries($r)).Count -eq 0) { [IO.Directory]::Delete($r) } } } ' +
    "catch { $o.ok=$false; $o.why=''+$_.Exception.Message } }"].concat(PS_TAIL.slice(1)));
}
function shCleanup(visit, dirs, sudo) {
  return shLine(['r=${TMPDIR:-/tmp}; case "$r" in /*) ;; *) r=/tmp;; esac; case "$r" in *[!A-Za-z0-9/._-]*) r=/tmp;; esac', 'n=0',
    'for v in "${r%/}/agent-drive-undo-$(id -u)/' + visit + '"' + dirs.map((d) => ' ' + sq(d)).join('') + '; do if [ -d "$v" ] && [ ! -L "$v" ] && [ -O "$v" ]; then ' +
    'for f in "$v"/k*; do if [ -f "$f" ] && [ ! -L "$f" ]; then case "${f##*/}" in k[0-9]*-*) rm -f -- "$f" && n=$((n + 1));; esac; fi; done; ' +
    'rmdir -- "$v" 2>/dev/null; rmdir -- "${v%/*}" 2>/dev/null; fi; done',
    'printf \'{"undo":"cleanup","ok":true,"removed":%s}\\n\' "$n"'], sudo);
}

// ---- what a later change made moot ---------------------------------------------------------------------------------
// a path as {root, segs} for comparing: separators and case as the system takes them, . and .. resolved
function pathKey(p, os) {
  if (typeof p !== 'string' || !p || p.length > 8192) return null;
  const reg = /^Registry::/i.test(p), win = reg || os === 'windows', sep = win ? '\\' : '/';
  let s = reg ? p.slice(10) : win ? p.replace(/\//g, '\\') : p;
  const m = reg ? /^[^\\]+/.exec(s) : win ? /^([A-Za-z]:(?=\\|$)|\\\\[^\\]+\\[^\\]+|%[^%\\]+%|~)/.exec(s) : /^(\$[A-Za-z_][A-Za-z0-9_]*|\$\{[A-Za-z_][A-Za-z0-9_]*\}|~)/.exec(s);
  let root = m ? m[0] : '';
  s = s.slice(root.length);
  const abs = s.startsWith(sep), segs = [];
  for (const g of s.split(sep)) {
    if (!g || g === '.') continue;
    if (g === '..' && !reg) { if (segs.length && segs[segs.length - 1] !== '..') segs.pop(); else if (!abs && !root) segs.push('..'); continue; }
    segs.push(win ? g.toLowerCase() : g);
  }
  root = (reg ? 'R:' : '') + (win ? root.toLowerCase() : root) + (abs ? sep : root ? '' : '.');
  return { root, segs };
}
const sameP = (a, b) => a.root === b.root && a.segs.length === b.segs.length && a.segs.every((x, i) => x === b.segs[i]);
const holds = (a, b) => a.root === b.root && a.segs.length < b.segs.length && a.segs.every((x, i) => x === b.segs[i]);   // a is a folder above b
// supersede(entries) -> [{id, by, why}]: each earlier entry (not put back) a later one (not put back) made moot --
// the later one deleted or moved away a path that is, or holds, what the earlier one made, changed or moved there;
// or that holds the place the earlier one would put something back into
function supersede(list) {
  try {
    const es = entriesOf(list);
    const info = es.map((e) => {
      const P0 = isObj(e.paths) ? e.paths : null;
      const os = P0 && (P0.os === 'windows' || P0.os === 'linux') ? P0.os : null;
      if (!os || e.undone) return null;
      const keys = (k) => (Array.isArray(P0[k]) ? P0[k] : []).slice(0, 50).map((p) => ({ p: String(p), k: pathKey(p, os) })).filter((x) => x.k);
      return { os, here: keys('made').concat(keys('to')), place: keys('from').concat(keys('removed')),
        gone: keys('removed').map((x) => Object.assign({ how: 'deleted' }, x)).concat(keys('from').map((x) => Object.assign({ how: 'moved away' }, x))) };
    });
    const out = [];
    for (let i = 0; i < es.length; i++) {
      const a = info[i];
      if (!a) continue;
      let hit = null;
      for (let j = i + 1; j < es.length && !hit; j++) {
        const b = info[j];
        if (!b || b.os !== a.os) continue;
        for (const g of b.gone) {
          const x = a.here.find((h) => sameP(g.k, h.k) || holds(g.k, h.k));
          const y = x ? null : a.place.find((h) => holds(g.k, h.k));
          if (x || y) { hit = { by: es[j], g, x: x || y, here: !!x }; break; }
        }
      }
      if (!hit) continue;
      const L = hit.by, gp = clipMid(oneLine(hit.g.p), 120), xp = clipMid(oneLine(hit.x.p), 120);
      const why = L.id + ' ' + hit.g.how + ' ' + gp + (hit.here ? (sameP(hit.g.k, hit.x.k) ? '' : ', with ' + xp + ' in it') : ', so ' + xp + ' has no folder to go back to') +
        (L.reversible && runnable(L) ? ' — put ' + L.id + ' back first' : '');
      out.push({ id: es[i].id, by: L.id, why });
    }
    return out;
  } catch (_) {
    return [];
  }
}

// ============================================================================================================
// THE API
// ============================================================================================================
function iso(now) {
  const t = typeof now === 'number' && Number.isFinite(now) && Math.abs(now) < 8.64e15 ? now : Date.now();
  return new Date(t).toISOString();
}
function guessOs(text) {
  return /^\s*@?\s*(powershell|pwsh)(\.exe)?\b/i.test(text) || /(^|[\s"'(=])[A-Za-z]:[\\/]/.test(text) || /%[A-Za-z_]\w*%/.test(text) ||
    /\b(Move|Copy|Remove|Rename|New|Set|Start|Stop|Restart|Get|Add|Clear|Out)-[A-Z][A-Za-z]+\b/.test(text) ||
    /^\s*(del|erase|ren|rename|md|rd|move|copy|reg|sc|net|taskkill)\s.*(\s\/[A-Za-z?]\b|\\)/i.test(text) ? 'windows' : 'linux';
}
// the prompt the Terminal printed after the line: which shell it is, and the folder it is in
function promptOf(output, os) {
  const lines = String(output || '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  if (os === 'windows') {
    let m = /^PS ([A-Za-z]:\\[^<>|"*?\r\n]*)>$/.exec(last);
    if (m) return { shell: 'ps', cwd: lit(m[1]) };
    m = /^([A-Za-z]:\\[^<>|"*?\r\n]*)>$/.exec(last);
    if (m) return { shell: 'cmd', cwd: lit(m[1]) };
    return /^PS .*>$/.test(last) ? { shell: 'ps', cwd: null } : {};
  }
  const m = /:(\/[^\s]*?)[$#]$/.exec(last);
  return m ? { shell: 'sh', cwd: lit(m[1]) } : {};
}
const CD_RE = /(^|[\s;&|({])(cd|chdir|sl|set-location|pushd|popd|push-location|pop-location)(?![\w-])/i;
function analyseLine(text, os, verb, output) {
  let shell = os === 'windows' ? 'cmd' : 'sh', cwd = null;
  if (verb === 'terminal') {
    const p = promptOf(output, os);
    if (os === 'windows') shell = p.shell || (/%[A-Za-z_]\w*%|^\s*(dir|del|erase|copy|move|ren|md|rd|type)\s.*\s\/[a-z?]/i.test(text) ? 'cmd' : 'ps');
    cwd = p.cwd && !CD_RE.test(text) ? p.cwd : false;                          // the Terminal's own folder: known only from its prompt
  }
  const env = newEnv(os, shell, cwd);
  env.foreign = verb === 'terminal';
  const items = shell === 'cmd' ? cmdParse(text, 0) : shell === 'ps' ? psParse(text, 0) : shParse(text, 0);
  const facts = [];
  analyze(items, env, facts);
  return { facts, shell };
}
function fromCommand(cmd, res, ctx, verb) {
  const text = verb === 'terminal' ? str(cmd.input) : str(cmd.cmd != null ? cmd.cmd : cmd.text);
  if (!text.trim()) return [];
  const os = ctx.os === 'windows' || ctx.os === 'linux' ? ctx.os : guessOs(text);
  const secret = !!cmd.secret;
  const generic = (srcs) => say(secret ? 'ran a command (its text is private)' : 'ran a command: ' + clip(oneLine(srcs.join('; ')), 80));
  if (text.length > MAX_TEXT) return [result(generic([text]), false, null)];
  let facts;
  try { facts = analyseLine(text, os, verb, res && res.output).facts; } catch (_) { return [result(generic([text]), false, null)]; }
  // what prepare()'s captures printed, before and after it ran (an exec only: see prepare)
  let cap = null;
  if (verb === 'exec' && Array.isArray(ctx.captured) && ctx.captured.length) {
    try { const got = readCaptured(ctx.captured); if (got.size) cap = { got, plan: capturePlan(facts, os) }; } catch (_) { cap = null; }
  }
  const out = [], unknowns = [];
  let unknownAt = -1;
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    let r;
    if (cap && (f.effect || f.acl)) { try { r = capturedResult(i, f, cap, os); } catch (_) { r = undefined; } }
    if (r === null) continue;                                                      // read before and after: nothing changed
    if (r === undefined) {
      if (f.unknown != null) { if (unknownAt < 0) unknownAt = out.length; if (!unknowns.includes(f.unknown)) unknowns.push(f.unknown); continue; }
      try { r = describe(f.effect, { os }); if (r) { const p = pathsOf(f.effect, os); if (p) r.paths = p; } } catch (_) { r = null; }
    }
    if (r) out.push(r);
  }
  if (unknowns.length) out.splice(unknownAt, 0, result(generic(unknowns.filter(Boolean).length ? unknowns.filter(Boolean) : [text]), false, null));
  if (out.length > MAX_ENTRIES || facts.capped) {
    const extra = Math.max(1, out.length - MAX_ENTRIES + 1);
    out.splice(Math.min(out.length, MAX_ENTRIES - 1), extra, result(say('made ' + (facts.capped ? 'at least ' : '') + plural(extra, 'more change') + ' in the same command'), false, null));
  }
  return out;
}
function declared(cmd, ctx) {
  const words = oneLine(str(cmd.what));
  const s = say(words ? clip(words, 200) : 'changed something (not described)');
  const u = cmd.undo;
  if (typeof u === 'string' && oneLine(u)) return result(s, true, hint(clip(oneLine(u), 300)));
  if (isObj(u)) {
    const c = str(u.cmd);
    if (c.trim()) {
      const os = u.os === 'windows' || u.os === 'linux' ? u.os : ctx.os === 'windows' || ctx.os === 'linux' ? ctx.os : guessOs(c);
      // a command the driver gave: risky unless it reads, here, as only moves, renames and service flips
      let risky = true;
      try {
        const { facts } = analyseLine(c, os, 'exec');
        risky = !facts.length || facts.some((f) => !f.effect || !((f.effect.op === 'move' || f.effect.op === 'rename') ||
          (f.effect.op === 'svc' && /^(start|stop|enable|disable|mask|unmask)$/.test(f.effect.action))));
      } catch (_) { risky = true; }
      const note = str(u.note).trim() ? clip(oneLine(str(u.note)), 200) : 'runs the command the agent gave: ' + clip(oneLine(c), 120);
      return result(s, true, { kind: 'exec', os, cmd: c, risky, note });
    }
    const t = str(u.text) || str(u.hint);
    if (oneLine(t)) return result(s, true, hint(clip(oneLine(t), 300)));
  }
  return result(s, false, null);
}

// record(cmd, result, ctx) -> entry | entry[] | null. Only an answer with ok === true is recorded; a command that
// changes nothing nameable (click, look, chat, ...) is null; a command that made several changes is an ARRAY whose
// entries are numbered ctx.seq, ctx.seq + 1, ... (so the caller advances its count by the array's length).
function record(cmd, res, ctx) {
  try {
    if (!isObj(cmd) || !isObj(res) || res.ok !== true) return null;
    const c = isObj(ctx) ? ctx : {};
    const verb = str(cmd.do);
    let made = [], kind = 'exec';
    if (verb === 'exec' || verb === 'terminal') made = fromCommand(cmd, res, c, verb);
    else if (verb === 'keys') {
      const t = typeof cmd.text === 'string' ? cmd.text : Array.isArray(cmd.text) ? cmd.text.filter((x) => typeof x === 'string').join('') : str(cmd.text);
      const n = t ? Array.from(t).length : typeof res.typed === 'number' && Number.isFinite(res.typed) ? Math.max(0, Math.floor(res.typed)) : 0;
      if (!n) return null;
      const win = typeof c.window === 'string' ? clip(oneLine(c.window), 60) : '';
      made = [result(say('typed ' + plural(n, 'character') + (win ? ' into “' + win + '”' : '')), true, hint('select what was typed and delete it (Ctrl+Z undoes it in most apps)'))];
      kind = 'typed';
    } else if (verb === 'launch') {
      if (cmd.dry) return null;
      const app = clip(oneLine(str(cmd.app)), 80);
      if (!app) return null;
      const w = isObj(res.window) && typeof res.window.title === 'string' ? clip(oneLine(res.window.title), 60) : '';
      made = [result(say('started ', { code: app }), true, hint('close its window' + (w ? ' (“' + w + '”)' : '')))];
      kind = 'launched';
    } else if (verb === 'changed') { made = [declared(cmd, c)]; kind = 'declared'; }
    else return null;
    if (!made.length) return null;
    const seq = typeof c.seq === 'number' && Number.isFinite(c.seq) ? Math.max(0, Math.floor(c.seq)) : 1;
    const at = iso(c.now);
    const entries = made.map((m, i) => {
      const e = { id: 'c' + (seq + i), at, verb, what: m.what, md: m.md, kind, reversible: m.reversible, undo: m.undo };
      if (m.paths) e.paths = m.paths;                                             // where it changed something (supersede)
      if (m.backup) e.backup = m.backup;                                          // the copy its undo puts back (cleanup)
      return e;
    });
    return entries.length === 1 ? entries[0] : entries;
  } catch (_) {
    return null;
  }
}

// prepare(cmd, ctx) -> null | {captures: [{id, kind, when, os, cmd, what, maxBytes?}]}: what to read or keep BEFORE an
// exec runs (when 'before') and just after it (when 'after'), so that what it overwrites, deletes or resets can be
// put back. ctx: {os, seq, now, visit?, maxBytes?}. Runs nothing; null when there is nothing to read first.
function prepare(cmd, ctx) {
  try {
    if (!isObj(cmd) || str(cmd.do) !== 'exec') return null;
    const c = isObj(ctx) ? ctx : {};
    const text = str(cmd.cmd != null ? cmd.cmd : cmd.text);
    if (!text.trim() || text.length > MAX_TEXT) return null;
    const os = c.os === 'windows' || c.os === 'linux' ? c.os : guessOs(text);
    const plan = capturePlan(analyseLine(text, os, 'exec').facts, os);
    const o = { os, visit: visitOf(c), cap: capOf(c) };
    const captures = [];
    for (const s of plan.sets) {
      // a thing is read whole or not at all: a 'before' without its 'after' (or the other way) puts nothing back
      const built = s.caps.map((k) => { try { return captureCmd(s, k, o); } catch (_) { return null; } });
      if (!s.caps.length || built.some((l) => !l)) continue;
      s.caps.forEach((k, j) => {
        const x = { id: k.id, kind: k.kind, when: k.when, os, cmd: built[j], what: captureWhat(s, k, o) };
        if (k.kind === 'backup') x.maxBytes = o.cap;
        captures.push(x);
      });
    }
    return captures.length ? { captures } : null;
  } catch (_) {
    return null;
  }
}

// cleanup(entries, ctx) -> [{os, cmd}]: when the visit ends, the commands that remove its kept copies -- in the visit's
// folder (ctx.visit, on ctx.os) and in each folder an entry's backup names; only files named as a copy is named, then
// each folder if it is empty. An entry whose copy is gone can no longer be put back (its undo says so and stops).
function cleanup(list, ctx) {
  try {
    const c = isObj(ctx) ? ctx : {};
    const visit = visitOf(c), win = new Set(), lnx = new Map([['', { sudo: null, dirs: new Set() }]]);   // this account's first, then each sudo
    for (const e of Array.isArray(list) ? list.slice(0, 5000) : []) {
      const b = isObj(e) && isObj(e.backup) && typeof e.backup.path === 'string' ? e.backup : null;
      if (!b) continue;
      if (b.os === 'windows') { const m = WIN_BAK.exec(b.path); if (m && win.size < 20) win.add(m[1]); }
      else if (b.os === 'linux') {
        const m = LNX_BAK.exec(b.path);
        if (!m) continue;
        const su = isObj(b.sudo) && (b.sudo.tool === 'sudo' || b.sudo.tool === 'doas') ? { tool: b.sudo.tool, user: typeof b.sudo.user === 'string' ? b.sudo.user : null } : null;
        const k = su ? su.tool + ':' + (su.user || '') : '';
        if (!lnx.has(k)) lnx.set(k, { sudo: su, dirs: new Set() });
        if (lnx.get(k).dirs.size < 20) lnx.get(k).dirs.add(m[1]);
      }
    }
    const out = [];
    if (c.os === 'windows' || win.size) { const cmd = psCleanup(visit, [...win]); if (cmd) out.push({ os: 'windows', cmd }); }
    if (c.os === 'linux' || lnx.size > 1 || lnx.get('').dirs.size) {
      for (const g of lnx.values()) { const cmd = shCleanup(visit, [...g.dirs], g.sudo); if (cmd) out.push({ os: 'linux', cmd }); }
    }
    return out;
  } catch (_) {
    return [];
  }
}

// inverse(entry) -> what the serve runs after the operator's yes: {ok:true, cmd, os, risky, note} | {ok:false, why}
function inverse(entry) {
  try {
    if (!isObj(entry)) return { ok: false, why: 'that is not an entry of the change record' };
    const id = str(entry.id) || 'this change';
    const u = entry.undo;
    if (isObj(u) && u.kind === 'exec' && typeof u.cmd === 'string' && u.cmd.trim()) {
      return { ok: true, cmd: u.cmd, os: str(u.os), risky: !!u.risky, note: str(u.note) || 'puts back: ' + str(entry.what) };
    }
    if (isObj(u) && u.kind === 'hint' && entry.reversible) return { ok: false, why: id + ' is put back by hand: ' + str(u.text) };
    return { ok: false, why: id + ' cannot be put back' + (isObj(u) && u.kind === 'hint' && str(u.text) ? ': ' + str(u.text) : ' — there is no way back for it on record') };
  } catch (_) {
    return { ok: false, why: 'that entry could not be read' };
  }
}

const entriesOf = (list) => (Array.isArray(list) ? list.filter((e) => isObj(e) && typeof e.what === 'string' && typeof e.id === 'string') : []);
const mdOf = (e) => (typeof e.md === 'string' && e.md ? e.md : mdEsc(e.what));
const runnable = (e) => isObj(e.undo) && e.undo.kind === 'exec' && typeof e.undo.cmd === 'string' && !!e.undo.cmd.trim();
// summary(entries, max) -> one short paragraph for the finish message: what changed (the first `max`, 3 by default)
// and which of it can be put back
function summary(list, max) {
  try {
    const es = entriesOf(list);
    if (!es.length) return '';
    const m = typeof max === 'number' && Number.isFinite(max) ? Math.max(1, Math.min(50, Math.floor(max))) : 3;
    const shownList = es.slice(0, m).map((e) => mdOf(e) + ' (' + e.id + ')');
    const more = es.length - shownList.length;
    let s = 'I changed ' + plural(es.length, 'thing') + ' on this machine: ' + joinAnd(shownList.concat(more ? [more + ' more'] : [])) + '.';
    const back = es.filter((e) => e.reversible), never = es.filter((e) => !e.reversible);
    const ids = (xs) => (xs.length <= 6 ? joinAnd(xs.map((e) => e.id)) : xs.length + ' of them');
    const ask = ' — say “undo” and its number (like “undo ' + (back.find(runnable) || back[0] || es[0]).id + '”), and I will ask before I put anything back';
    if (!back.length) s += es.length === 1 ? ' It cannot be put back.' : ' None of it can be put back.';
    else if (!never.length) s += (es.length === 1 ? ' It can be put back' : ' Each can be put back') + ask + '.';
    else s += ' ' + ids(back) + ' can be put back' + ask + '; ' + ids(never) + ' cannot.';
    return s;
  } catch (_) {
    return '';
  }
}
// forChat(entries) -> a short Markdown list, each line saying whether it can be put back, and how
function forChat(list) {
  try {
    const es = entriesOf(list);
    if (!es.length) return '';
    const MAXL = 20;
    const lines = es.slice(0, MAXL).map((e) => {
      const u = isObj(e.undo) ? e.undo : null;
      let tail;
      const why = (t) => mdEsc(clip(oneLine(str(t)).replace(/\s+—\s+/g, '; '), 200));
      if (e.reversible && runnable(e)) tail = 'can be put back' + (u.risky ? ' (it deletes what was made)' : '');
      else if (e.reversible && u && u.kind === 'hint') tail = 'by hand: ' + why(u.text);
      else if (e.reversible) tail = 'can be put back';
      else tail = 'cannot be put back' + (u && u.kind === 'hint' && str(u.text) ? ': ' + why(u.text) : '');
      return '- **' + mdEsc(e.id) + '** ' + mdOf(e) + ' — ' + tail;
    });
    if (es.length > MAXL) lines.push('- …and ' + plural(es.length - MAXL, 'more change'));
    return lines.join('\n');
  } catch (_) {
    return '';
  }
}

module.exports = { record, inverse, summary, forChat, prepare, cleanup, supersede };

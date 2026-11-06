// action_tree.js -- unit test for core/action-tree.js, the module that turns what a serve
// agent DOES into the progress panel's nested, described tree (task > step > sub-step > action group > the
// live action). Pinned because of the live report it answers -- ~380 actions reached the watchers as a flat
// feed of "Typing" / "Clicking" / "Pressing Enter": "useless action names, no sub steps, sub-sub steps" --
// and because of what three adversarial reviews then found: typed passwords, Shift-typed capitals, DM text
// and magic-link tokens on a panel every watcher sees; a pause detector that fired inside long commands;
// failures that read as passes once their step folded; polls merged across unrelated looks; twin labels
// sharing a stopwatch; and odd input that could throw and kill the serve. Each is reproduced here before
// its fix is trusted. Pure (no relay, no host); an injected clock -- every command takes 100 ms of it.
//   node tests/action_tree.js
'use strict';
const path = require('path');
const AT = require(path.join(__dirname, '..', 'core', 'action-tree.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
let T = 1000000;
const now = () => T;
const mk = (task, extra) => AT.create(Object.assign({ task: task || 'THE-TASK', now }, extra || {}));
// a command: started, running `ms` (default 100 ms), answered, then `gap` ms before the next one
const run = (t, cmd, r, ms, gap) => { t.start(cmd); T += (ms == null ? 100 : ms); t.end(cmd, r || { ok: true }); T += (gap || 0); };
const pause = (t, ms) => { T += (ms || 3000); return t.idle(); };
const kids = (n) => (n && n.k) || [];
const flat = (nodes, d, out) => { out = out || []; for (const n of (nodes || [])) { out.push({ d: d || 0, t: n.t, s: n.s, k: n.k }); flat(n.k, (d || 0) + 1, out); } return out; };
const sibsOk = (nodes) => (nodes || []).length <= 24 && (nodes || []).every((n) => sibsOk(n.k));
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const inClamp = (tree) => AT.nodeCount(tree) <= 60 && AT.treeDepth(tree) <= 4 && sibsOk(tree) && flat(tree).every((r) => typeof r.t === 'string' && r.t.length > 0 && r.t.length <= 100 && !LONE.test(r.t));
const stepNamed = (t, name) => kids(t.render()[0]).find((n) => n.t === name);

try {
  // ---- 0. names: never a bare verb, and never more than the screen already shows ---------------------
  ok(AT.actPhrase({ do: 'click', x: 1, y: 2 }) === 'Clicking (1,2)', 'a click says WHERE ("Clicking (1,2)")');
  ok(AT.actPhrase({ do: 'chord', mod: 'ControlLeft', code: 'KeyL' }) === 'Pressing Ctrl+L', 'a chord says WHICH ("Pressing Ctrl+L")');
  ok(AT.actPhrase({ do: 'keys', text: 'abc' }) === 'Typing 3 characters', 'typing is described by its SHAPE by default ("Typing 3 characters")');
  ok(AT.actPhrase({ do: 'keys', text: 'abc', show: 1 }) === "Typing 'abc'", 'show:1 opts a non-secret text in ("Typing \'abc\'")');
  ok(AT.actPhrase({ do: 'keys', text: 'abc', show: 1, secret: 1 }) === 'Typing 3 characters', 'secret:1 hides it even then');
  ok(AT.actPhrase({ do: 'press', code: 'KeyA' }) === 'Typing a character' && AT.actPhrase({ do: 'press', code: 'Enter' }) === 'Pressing ⏎', 'a pressed LETTER counts as typing (hidden); a special key is named');
  ok(AT.actPhrase({ do: 'chat', text: 'hi all' }) === 'Posting to the session chat' && AT.actPhrase({ do: 'chat', text: 'code 4471', to: 'v1' }) === 'Sending a direct message',
     'a chat never carries its text; a DM is just "Sending a direct message"');
  ok(AT.resPhrase({ do: 'chat-wait' }, { ok: true, text: 'pin 9921', dm: true }) === '→ got a direct reply', 'a reply is reported, never quoted');
  ok(!/x/.test(AT.actPhrase({ do: 'confirm', text: 'xxx' })) && !/x/.test(AT.actPhrase({ do: 'note-add', text: 'xxx' })), 'confirm / sticky-note text never appears');
  ok(AT.shortUrl('https://user:pw@example.com/a/b?token=SECRET#frag') === 'example.com/a/b', 'a URL keeps host + path only (no credentials, query or fragment)');
  ok(AT.keyName('ArrowUp') === '↑' && AT.keyName('KeyA') === 'a' && AT.chordName({ mod: 'ShiftLeft', code: 'Tab' }) === 'Shift+⇥', 'keys read the way a person reads them');
  ok(AT.isAction({ do: 'click' }) && !AT.isAction({ do: 'status' }) && !AT.isAction({ do: 'seen' }), 'status/seen are not actions; a click is');
  ok(AT.isConversation({ do: 'chat-wait' }) && AT.isConversation({ do: 'seen' }) && !AT.isConversation({ do: 'click' }), 'chat-wait/seen are conversation (not new work); a click is work');

  // ---- 1. PRIVACY end to end, checked at EVERY frame: a password typed key by key, DMs both ways -------
  let t = mk(), all = '';
  const look = () => { all += JSON.stringify(t.render()) + '\n' + t.line() + '\n'; };
  for (const ch of 'hunter2') { t.start({ do: 'keys', text: ch }); look(); T += 100; t.end({ do: 'keys', text: ch }, { ok: true }); look(); }
  t.start({ do: 'press', code: 'Enter' }); look(); T += 100; t.end({ do: 'press', code: 'Enter' }, { ok: true }); look();
  pause(t); look();
  t.start({ do: 'chat', text: 'DM-ONLY-FOR-OP1 code 4471', to: 'v1' }); look(); T += 100; t.end({ do: 'chat', to: 'v1' }, { ok: true }); look();
  t.start({ do: 'chat-wait' }); look(); T += 100; t.end({ do: 'chat-wait' }, { ok: true, text: 'PRIVATE-REPLY pin 9921', dm: true }); look();
  pause(t); look();
  ok(!/hunter|unter2|'[hunter2]'/.test(all), 'a typed password never appears in any frame or line -- not even one quoted character at a time');
  ok(!/4471|9921|PRIVATE|DM-ONLY/.test(all), 'neither the DM nor the private reply appears anywhere');
  ok(/Typed 7 characters, ⏎/.test(all) && /Sent a direct message/.test(all) && /got a direct reply/.test(all), '...while the panel still says what happened ("Typed 7 characters, ⏎", "Sent a direct message", "got a direct reply")');
  t = mk(); all = '';
  for (const ch of 'xyz') { t.start({ do: 'keys', text: ch, show: 1 }); look(); T += 100; t.end({ do: 'keys', text: ch, show: 1 }, { ok: true }); look(); }
  ok(!/'[yz]'|'xy'/.test(all), 'with show:1 too, a word typed key by key is never spelled out a frame at a time -- the run reads "Typing…", its leaf masked');
  pause(t);
  ok(t.render()[0].k[0].t === "Typed 'xyz'", "...the finished row shows it: \"Typed 'xyz'\" (got " + t.render()[0].k[0].t + ')');
  t = mk(); all = '';
  run(t, { do: 'press', code: 'KeyH' }); run(t, { do: 'press', code: 'KeyI' }); run(t, { do: 'keys', text: 'pw', show: 1, secret: 1 }); pause(t); look();
  ok(t.render()[0].k[0].t === 'Typed 4 characters' && !/'h|'i|pw/.test(all), 'letters PRESSED one by one, and show:1 + secret:1, draw as typing, hidden');
  t = mk(); all = '';
  t.start({ do: 'plan', steps: [{ do: 'click', x: 1, y: 1 }, { do: 'keys', text: 'secretpw', show: 1 }, { do: 'press', code: 'Enter' }] });
  t.tick(1, 3, { do: 'keys', text: 'secretpw', show: 1 }); look();
  ok(!/secretpw/.test(all) && /step 2\/3: typing 8 characters/.test(all), 'a batch typing a word shows the step by its shape, never the word');
  t = mk(); all = '';
  for (const c of [{ do: 'chat', text: 'ROOMSECRET' }, { do: 'confirm', text: 'CONFSECRET' }, { do: 'note-add', text: 'NOTESECRET' }, { do: 'chat-img', text: 'IMGSECRET', file: 'a.png' }]) { run(t, c, { ok: true, verdict: 'approved' }); look(); }
  pause(t); look();
  ok(!/ROOMSECRET|CONFSECRET|NOTESECRET|IMGSECRET/.test(all) && /Posted to the session chat/.test(all), 'room chat, confirm, sticky-note and image text never reach the panel');

  // ---- 1b. URLs: the address, never the secret in it -----------------------------------------------------
  ok(AT.shortUrl('https://we.tl/t-Ab12Cd34Ef') === 'we.tl/…', 'a token in the PATH is elided ("we.tl/…", got ' + AT.shortUrl('https://we.tl/t-Ab12Cd34Ef') + ')');
  ok(AT.shortUrl('https://www.dropbox.com/s/k3y9xq2abcdefgh/taxes.pdf?dl=0') === 'www.dropbox.com/s/…/taxes.pdf', '...a share key among plain path words too');
  ok(AT.shortUrl('https://user:pa#ss@host.example.com/x') === 'host.example.com/x' && AT.shortUrl('https://u:p?w@host.example.com/x') === 'host.example.com/x', 'credentials are dropped BEFORE the query split (a password holding # or ?)');
  ok(AT.shortUrl('https://host.com/app;jsessionid=ABC123DEF456') === 'host.com/app', 'a ;jsessionid= session id never shows');
  ok(AT.shortUrl('https://a1b2c3d4e5f6.ngrok.io/x') === '….ngrok.io/x', 'a token-like host label (a tunnel) is elided');
  ok(AT.shortUrl('https://boatloadpuzzle.lovable.app/slidingpuzzle') === 'boatloadpuzzle.lovable.app/slidingpuzzle' && AT.shortUrl('httpbin.org/forms/post') === 'httpbin.org/forms/post',
     'ordinary addresses are left whole');
  ok(AT.actPhrase({ do: 'open', url: 'https://we.tl/t-Ab12Cd34Ef/x', secret: 1 }) === 'Opening we.tl' && AT.pastPhrase({ do: 'open', url: 'https://we.tl/x/y', secret: 1 }) === 'Opened we.tl',
     'open {secret:1} names the host only');
  ok(AT.redactShown('https://x.com/reset?token=abc') === 'https://x.com/reset?…' && AT.redactShown('go to www.site.com/p/Ab12Cd34Ef9 now') === 'go to www.site.com/p/… now',
     'a URL in text shown with show:1 loses its query and token-like segments (got ' + AT.redactShown('https://x.com/reset?token=abc') + ')');
  ok(AT.redactShown('play2048.co') === 'play2048.co' && AT.redactShown('what is 2+2?') === 'what is 2+2?', '...and plain text is left alone');
  t = mk();
  for (const ch of 'https://we.tl/t-Ab12Cd34Ef') run(t, { do: 'keys', text: ch, show: 1 });
  pause(t);
  ok(!/Ab12Cd34Ef/.test(JSON.stringify(t.render())) && /we\.tl\/…/.test(t.render()[0].k[0].t), 'a magic link TYPED with show:1 is drawn without its token (got ' + t.render()[0].k[0].t + ')');
  ok(AT.actPhrase({ do: 'find', text: 'Payroll', secret: 1 }) === 'Looking for a word' && AT.actPhrase({ do: 'clickText', text: 'Payroll', secret: 1 }) === 'Clicking a word' &&
     AT.pastPhrase({ do: 'find', text: 'Payroll', secret: 1 }) === 'Looked for a word', 'find / clickText honour secret:1');

  // ---- 2. a char-by-char word is ONE row with ONE stable live label; one finished command is DONE at once -
  t = mk();
  run(t, { do: 'keys', text: 'a' }); run(t, { do: 'keys', text: 'b' });
  const lbl2 = t.render()[0].k[0].t;
  run(t, { do: 'keys', text: 'c' }); run(t, { do: 'press', code: 'Enter' });
  let tr = t.render(), row = tr[0].k[0];
  ok(kids(tr[0]).length === 1 && row.t === 'Typing…' && lbl2 === 'Typing…' && row.s === 'doing', 'the merged run keeps ONE stable label while it grows ("Typing…"), so its stopwatch keeps running');
  ok(kids(row).length === 1 && kids(row)[0].t === 'Pressing ⏎ · 4 so far', 'its leaf is the newest command and how far the run has got ("Pressing ⏎ · 4 so far")');
  ok(t.line() === 'Typing…', 'the live line follows the run, not each keystroke');
  t = mk();
  run(t, { do: 'click', x: 5, y: 5 });
  tr = t.render(); row = tr[0].k[0];
  ok(row.t === 'Clicked (5,5)' && row.s === 'done' && kids(row).length === 0 && kids(tr[0]).length === 1, 'one command that has answered is ONE done row at once -- not a live row ticking over a finished action');
  run(t, { do: 'click', x: 6, y: 6 });
  row = t.render()[0].k[0];
  ok(row.t === 'Clicking…' && row.s === 'doing' && kids(row)[0].t === 'Clicking (6,6) · 2 so far', '...and the next click of the same kind reopens it as a run');

  // ---- 3. a pause closes the burst with its TRUE duration and shows the planning row --------------------
  t = mk();
  for (let i = 0; i < 12; i++) run(t, { do: 'press', code: 'ArrowDown' }, null, 100, 50);   // 12 x 100 ms of commands
  ok(pause(t, 9000) === true && pause(t) === false, 'idle() reports the change once (no frame spam on a second idle)');
  tr = t.render(); row = tr[0].k[0];
  ok(row.s === 'done' && row.t === 'Pressed 12 keys: ↓↓↓↓↓↓↓↓↓↓↓↓ · 1s', 'the closed burst reads by its full description + the time its COMMANDS took, not the gaps or the 9 s pause (got ' + row.t + ')');
  ok(kids(tr[0]).some((n) => n.t === AT.THINK && n.s === 'doing') && t.line() === AT.THINK, '"Planning the next step" stands in while the driver thinks -- in the line too');
  run(t, { do: 'click', x: 1, y: 1 });
  ok(!kids(t.render()[0]).some((n) => n.t === AT.THINK) && kids(t.render()[0]).length === 2, 'the next command replaces the planning row with the NEXT step');

  // ---- 4. a busy burst: runs merged, results and counts FIRST, failures flagged -------------------------
  t = mk();
  run(t, { do: 'chord', mod: 'ControlLeft', code: 'KeyL' });
  for (const ch of 'play2048.co') run(t, { do: 'keys', text: ch, show: 1 });
  run(t, { do: 'press', code: 'Enter' });
  run(t, { do: 'shot', out: '/x.png' }, { ok: true, w: 1920, h: 1080 });
  const head1 = t.render()[0].k[0].t;
  for (let i = 0; i < 16; i++) run(t, { do: 'press', code: i % 2 ? 'ArrowLeft' : 'ArrowDown' });
  for (const [x, y] of [[35, 300], [35, 459], [35, 531]]) run(t, { do: 'click', x, y });
  run(t, { do: 'click', x: 5, y: 5, intent: 'Open the menu' });
  run(t, { do: 'probe', x: 260, y: 250 }, { ok: true, is: '#000000' });
  ok(head1 === "Typed 'play2048.co' …" && t.render()[0].k[0].t === head1, 'an OPEN busy burst is headed by what it began with -- one label for its whole life (got ' + t.render()[0].k[0].t + ')');
  pause(t);
  tr = t.render(); const step4 = tr[0].k[0], gl = kids(step4).map((n) => n.t);
  ok(gl[0] === "Ctrl+L, typed 'play2048.co', ⏎ · 1s", 'Ctrl+L + 11 shown chars + Enter = one row, with the time it took (got ' + gl[0] + ')');
  ok(gl[1] === 'Captured the screen (1920×1080)', 'a screenshot with what it got (got ' + gl[1] + ')');
  ok(gl[2] === 'Pressed 16 keys: ↓←↓←↓←↓←↓←↓←↓←↓← · 2s', 'the key COUNT comes first, where the narrow panel keeps it (got ' + gl[2] + ')');
  ok(gl[3] === 'Clicked 3× — last (35,531)' && gl[4] === 'Open the menu — clicked (5,5)' && gl[5] === 'Checked pixel (260,250) → #000000', 'clicks, an intent, and a look with what it SAW (got ' + gl.slice(3).join(' | ') + ')');
  ok(gl.length === 6 && step4.t === 'Pressed 16 keys +5 · 4s', '35 commands = 6 rows under a compact, front-loaded step headline (got ' + step4.t + ')');
  t = mk();
  run(t, { do: 'shot' }, { ok: true, w: 10, h: 10 });
  run(t, { do: 'probe', x: 1, y: 1 }, { ok: true, is: '#ffffff' });
  run(t, { do: 'probe', x: 2, y: 2 }, { ok: true, is: '#000000' });
  pause(t);
  ok(t.render()[0].k[0].t === 'Looked ×3 · last → #000000 (1 screenshot, 2 pixel checks)', 'several looks: the count and the last result first, the breakdown after (got ' + t.render()[0].k[0].t + ')');
  run(t, { do: 'click', x: 3, y: 3 }, { ok: false, why: 'denied' });
  ok(t.render()[0].k[1].t === '⚠ Failed — clicked (3,3)', 'an input that failed LEADS with ⚠, the moment it answers (got ' + t.render()[0].k[1].t + ')');
  run(t, { do: 'ping' }, { ok: false, alive: false });
  pause(t);
  ok(t.render()[0].k[1].t === '⚠ Failed — clicked (3,3) +1' || /^⚠/.test(t.render()[0].k[1].t), '...and keeps it once closed (got ' + t.render()[0].k[1].t + ')');
  t = mk();
  for (let i = 0; i < 12; i++) { run(t, { do: 'click', x: i, y: 1, intent: 'Enter 24.99 × 2' }, i === 7 ? { ok: false } : { ok: true }); }
  pause(t);
  ok(/^⚠ 1 of 12 failed — Enter 24\.99 × 2 — clicked 12×/.test(t.render()[0].k[0].t), 'one failure in a run of 12 says "1 of 12 failed" up front (got ' + t.render()[0].k[0].t + ')');

  // ---- 5. labels that used to read wrong ---------------------------------------------------------------
  const one = (cmds, rs) => { const u = mk(); cmds.forEach((c, i) => run(u, c, rs && rs[i], 10)); pause(u); return u.render()[0].k[0].t; };
  ok(one([{ do: 'press', code: 'Escape' }, { do: 'press', code: 'Escape' }, { do: 'press', code: 'Home' }, { do: 'press', code: 'End' }, { do: 'press', code: 'F5' }]) === 'Pressed 5 keys: Esc ×2 Home End F5', 'key NAMES are spaced and repeats collapse');
  ok(one(new Array(8).fill({ do: 'press', code: 'PageDown' })) === 'Pressed 8 keys: PgDn ×8', '8× PageDown = "PgDn ×8", never cut mid-name');
  const names = one(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Insert', 'Home', 'End'].map((code) => ({ do: 'press', code })));
  ok(/^Pressed 15 keys: F1 F2 .* …$/.test(names) && !/F1[0-2]?…|Hom…/.test(names), 'a long run of key NAMES is cut at a space, never mid-name (got ' + names + ')');
  ok(one([{ do: 'scroll', n: -3 }, { do: 'scroll', n: 3 }]) === 'Scrolled ↓3 ↑3', 'down then up is "↓3 ↑3", not a net "↑0"');
  ok(one([{ do: 'clicks', at: [] }]) === 'Clicked nothing', 'an empty click list reads "Clicked nothing" (no "undefined")');
  ok(one([{ do: 'ocr' }], [{ ok: true, words: 42 }]) === 'Read the text on screen → 42 words', 'OCR shows its word COUNT (the serve answers a number)');
  ok(one([{ do: 'find', text: 'a' }, { do: 'find', text: 'b' }], [{ ok: true, found: {} }, { ok: true }]) === '⚠ Looked ×2 · last → not found (2 searches)', '"2 searches", not "2 searchs" (and a miss is flagged)');
  ok(AT.actPhrase({ repeat: 40, steps: [] }) === 'Repeating 40 times' && AT.actPhrase({ until: { px: {} }, steps: [] }) === 'Repeating until it holds', 'a counted repeat is "Repeating 40 times"');
  ok(AT.resPhrase({ do: 'plan' }, { ok: false, ran: 5, stoppedAt: { at: 1, in: 'then' } }) === '→ stopped at step 5', 'a batch that stopped inside a branch names its TOP-LEVEL step, not the branch\'s');
  const emo = mk(); run(emo, { do: 'click', x: 1, y: 1, intent: 'a'.repeat(68) + '👋👋' }); pause(emo);
  ok(!LONE.test(JSON.stringify(emo.render())), 'a cut next to an emoji never leaves half a surrogate pair');
  const mixed = mk(); for (let i = 0; i < 100; i++) { run(mixed, { do: 'press', code: 'Enter' }, null, 1); run(mixed, { do: 'keys', text: 'a' }, null, 1); } pause(mixed);
  ok(mixed.state.tasks[0].steps[0].items[0].d.segs.length <= 30 && mixed.render()[0].k[0].t.length <= 100, 'a long MIXED press/keys run stays bounded (head + tail kept)');

  // ---- 6. declared task > step > sub-step, to the relay's full depth -------------------------------------
  t = mk();
  ok(t.ensureTask() && t.render()[0].t === 'THE-TASK', 'ensureTask() opens the default task');
  t.mark({ task: 'Task 5 · Solve the 15-puzzle' }, true);
  ok(t.state.tasks.length === 1 && t.render()[0].t === 'Task 5 · Solve the 15-puzzle', 'the UNUSED connect-time task BECOMES the declared one (no second task left behind)');
  t.mark({ step: 'Execute the solution' }, true);
  t.mark({ substep: 'Chunk 2 of 3' }, true);
  run(t, { do: 'press', code: 'ArrowUp' }); run(t, { do: 'press', code: 'ArrowLeft' });
  tr = t.render();
  const ex = kids(tr[0]).find((n) => n.t === 'Execute the solution'), ch2 = ex && kids(ex).find((n) => n.t === 'Chunk 2 of 3'), grp = ch2 && kids(ch2)[0];
  ok(!!grp && grp.t === 'Pressing keys…' && kids(grp)[0] && kids(grp)[0].t === 'Pressing ← · 2 so far', 'task > step > sub-step > action group > live action');
  ok(AT.treeDepth(tr) === 4, 'that is depth 4, the relay\'s limit');
  pause(t);
  tr = t.render();
  const ex2 = kids(tr[0]).find((n) => n.t === 'Execute the solution'), sub2 = ex2 && kids(ex2).find((n) => n.t === 'Chunk 2 of 3');
  ok(ex2.s === 'doing' && sub2.s === 'doing' && kids(sub2).some((n) => n.t === AT.THINK), 'a declared step and sub-step stay open through a pause; "Planning" sits in the deepest open level');
  const before = JSON.stringify(t.render());
  const re = [t.mark({ task: 'Task 5 · Solve the 15-puzzle' }, true), t.mark({ step: 'Execute the solution' }, true), t.mark({ substep: 'Chunk 2 of 3' }, true)];
  ok(re.every((x) => x === false) && JSON.stringify(t.render()) === before, 're-declaring the current task, step or sub-step changes nothing (not even the planning row)');
  t.mark({ substep: '' }, true);
  run(t, { do: 'click', x: 9, y: 9 });
  const ex3 = stepNamed(t, 'Execute the solution');
  ok(kids(ex3).some((n) => n.t === 'Chunk 2 of 3' && n.s === 'done') && kids(ex3).some((n) => n.t === 'Clicked (9,9)'), "substep:'' closes the sub-step; the next action lands at the step's level");
  t.mark({ substep: 'Chunk 3 of 3' }, true); run(t, { do: 'click', x: 1, y: 1 }); t.mark({ substep: 'Chunk 2 of 3' }, true);
  ok(kids(stepNamed(t, 'Execute the solution')).some((n) => n.t === 'Chunk 2 of 3 #2'), 'a sub-step declared again later is "#2" (twin rows would share a stopwatch)');
  for (const end of [null, '']) {
    t = mk(); t.mark({ step: 'S' }, true); run(t, { do: 'click', x: 1, y: 1 });
    ok(t.mark({ step: end }, true) === true && stepNamed(t, 'S').s === 'done', 'status {step:' + JSON.stringify(end) + '} ends the open declared step');
  }
  // sub-steps with nothing declared to nest in are SIBLINGS, never one inside the other
  t = mk();
  t.mark({ substep: 'Chunk 1 of 3' }, true); run(t, { do: 'press', code: 'ArrowUp' });
  t.mark({ substep: 'Chunk 2 of 3' }, true); run(t, { do: 'press', code: 'ArrowUp' });
  t.mark({ substep: 'Chunk 3 of 3' }, true);
  const subs = kids(t.render()[0]).map((n) => n.t + ':' + n.s);
  ok(subs.join(',') === 'Chunk 1 of 3:done,Chunk 2 of 3:done,Chunk 3 of 3:doing', 'parentless sub-steps are siblings (got ' + subs.join(',') + ')');
  ok(t.mark({ substep: '' }, true) === true && kids(t.render()[0]).every((n) => n.s === 'done'), "...and substep:'' closes the one that is open");
  // step:'' after a finish does not reopen it
  t = mk(); run(t, { do: 'click', x: 1, y: 1 }); t.mark({ fin: 1 }, true);
  t.mark({ step: '' }, true); t.mark({ substep: '' }, true);
  ok(t.render()[0].s === 'done', "step:'' / substep:'' after a finish leave the task finished");

  // ---- 7. status {text}: a SOFT step that closes at the pause after its work ----------------------------
  t = mk();
  ok(t.mark({ text: 'Opening play2048.co' }, true) === true, 'status {text} in auto mode starts a step');
  ok(t.mark({ text: 'Opening play2048.co' }, true) === false, '...and the same line again, while it is open, changes nothing');
  run(t, { do: 'chord', mod: 'ControlLeft', code: 'KeyL' });
  pause(t);
  run(t, { do: 'press', code: 'ArrowDown' });
  tr = t.render();
  ok(kids(tr[0])[0].t === 'Opening play2048.co' && kids(tr[0])[0].s === 'done' && kids(tr[0]).length === 2, 'it closes at the pause after its work, so later work gets its own step');
  t.mark({ step: 'Play' }, true);
  t.mark({ text: 'move 12' }, true); run(t, { do: 'press', code: 'ArrowUp' });
  ok(kids(stepNamed(t, 'Play')).some((n) => n.t === 'move 12' && n.s === 'doing'), 'under a declared step a status text is a soft sub-step');
  pause(t);
  ok(kids(stepNamed(t, 'Play')).some((n) => n.t === 'move 12' && n.s === 'done'), '...which closes at the pause after its work');
  ok(t.mark({ text: 'X', tree: [{ t: 'a' }] }, true) === false && t.mark({ text: 'Y', steps: ['a'] }, true) === false && t.mark({ text: 'Z' }, false) === false,
     'a text riding a tree or plan, or with explicit structure in charge, is only a line');

  // ---- 8. twin labels are numbered, so the viewer's per-label stopwatches can't collide ------------------
  t = mk();
  for (let i = 0; i < 3; i++) { t.mark({ step: 'Read the board' }, true); run(t, { do: 'shot' }); t.mark({ step: 'Make the moves' }, true); run(t, { do: 'press', code: 'ArrowUp' }); }
  const labels = kids(t.render()[0]).map((n) => n.t);
  ok(new Set(labels).size === labels.length && labels.includes('Read the board #3') && labels.includes('Make the moves #2'), 'a loop re-declaring its phases gets "Read the board #2", "#3" (got ' + labels.join(' | ') + ')');

  // ---- 9. fin; conversation after it; work after it EXTENDS the same task --------------------------------
  t = mk('ONE');
  run(t, { do: 'click', x: 1, y: 1 });
  t.mark({ fin: 1 }, true);
  ok(t.render()[0].s === 'done' && flat(t.render()).every((r) => r.s === 'done'), 'fin closes the task and everything under it');
  ok(t.idle() === false && !/Planning/.test(JSON.stringify(t.render())), 'a finished task shows no "Planning the next step"');
  run(t, { do: 'click', x: 2, y: 2 });
  ok(t.render()[0].t === 'ONE' && t.render()[0].s === 'doing' && kids(t.render()[0]).length === 2, 'work after a finish reopens the SAME task with a new step');
  ok(t.mark({ fin: 1 }, false) === false, 'a fin under an explicit tree leaves the action tree alone');
  t.mark({ fin: 1 }, true); t.mark({ task: 'ONE' }, true);
  ok(t.state.tasks.length === 1 && t.render()[0].t === 'ONE' && t.render()[0].s === 'doing' && kids(t.render()[0]).some((n) => n.t === 'Clicked (1,1)'),
     're-declaring a finished task reopens it with its history -- never a twin "ONE #2"');
  t.mark({ task: 'TWO' }, true); run(t, { do: 'click', x: 3, y: 3 });
  ok(t.render().length === 1 && t.render()[0].t === 'TWO' && t.state.tasks[0].done && t.state.tasks[0].steps.length === 0,
     'a NEW task is the one root (the last one closed, and kept only by name): extra top rows made the panel read "2/2" -- full -- on open-ended work');

  // ---- 10. hand-offs: a tool's retired tree, a takeover mid-burst, and a batch ---------------------------
  t = mk();
  ok(t.adopt([{ t: 'Solve the sudoku', s: 'done' }]) === true, 'a retired tool tree is adopted');
  const ranRow = kids(t.render()[0]).pop();
  ok(ranRow.t === 'Ran: Solve the sudoku' && ranRow.s === 'done', '...as one DONE "Ran: …" step');
  run(t, { do: 'click', x: 1, y: 1 });
  ok(kids(t.render()[0]).length === 2 && !kids(kids(t.render()[0])[0]).length, '...and the next action lands BESIDE it, not inside it');
  ok(t.adopt([]) === false && t.adopt(null) === false, 'an empty tree adopts nothing');
  t = mk();
  run(t, { do: 'press', code: 'ArrowUp' }); run(t, { do: 'press', code: 'ArrowUp' });
  t.suspend();
  tr = t.render();
  ok(kids(tr[0])[0].s === 'done' && !/Planning/.test(JSON.stringify(tr)), 'suspend() (a tool/plan took the panel) closes the burst with no planning row');
  run(t, { do: 'press', code: 'ArrowUp' });
  ok(kids(t.render()[0]).length === 2, '...so the next action after the hand-back starts fresh, not merged into a stale row');
  t = mk();
  t.start({ do: 'plan', steps: new Array(14).fill({ do: 'click', x: 1, y: 1 }) });
  ok(t.tick(4, 14, { do: 'click', x: 6, y: 7 }) === true, 'tick() moves a running batch along');
  row = t.render()[0].k[0];
  ok(row.t === 'Batch of 14: 14 clicks' && kids(row)[0] && kids(row)[0].t === 'step 5/14: clicking (6,7)', 'a batch is titled by what it DOES and shows which sub-step it is on (got ' + JSON.stringify(row) + ')');
  t.tick(5, 14, { do: 'status', text: 'Filled 5 of 20 cells' });
  ok(kids(t.render()[0].k[0])[0].t === 'Filled 5 of 20 cells · step 6/14', "a status line INSIDE the batch is its own narration, never \"running 'status'\"");
  t.tick(6, 14, { do: 'click', x: 9, y: 9 });
  ok(kids(t.render()[0].k[0])[0].t === 'Filled 5 of 20 cells · step 7/14', '...and stays until the next one');
  T += 1400; t.end({ do: 'plan', steps: new Array(14) }, { ok: true, ran: 14 });
  pause(t);
  ok(t.render()[0].k[0].t === 'Filled 5 of 20 cells · batch of 14 → all done', 'closed, it leads with its own narration, then how it ended (got ' + t.render()[0].k[0].t + ')');
  const mix = mk(); mix.start({ do: 'plan', steps: [{ do: 'click', x: 1, y: 1 }, { do: 'keys', text: 'secretpw' }, { do: 'press', code: 'Tab' }, { do: 'shot' }, { do: 'status', text: 'n' }] });
  ok(mix.render()[0].k[0].t === 'Batch of 5: typing, 1 click, 1 key press, …' && !/secretpw/.test(JSON.stringify(mix.render())),
     "a mixed batch's title counts what it does -- never the text it types (got " + mix.render()[0].k[0].t + ')');
  ok(AT.resPhrase({ do: 'plan' }, { ok: true, ran: 14 }) === '→ all done', '"→ all done", not "→ all 14 done" next to "batch of 14"');
  ok(t.mark({ step: 'INSIDE' }, true, true) === false, 'structure declared from INSIDE a batch is ignored (the batch keeps its row)');
  t.unbind();
  ok(t.tick(5, 14, { do: 'click' }) === false, 'after unbind() a stray tick changes nothing');
  t = mk();
  t.start({ do: 'plan', quiet: 1, steps: new Array(162).fill({ do: 'click', x: 1, y: 1 }) });
  t.tick(36, 162, { do: 'click', x: 7, y: 8 });
  row = t.render()[0].k[0];
  ok(row.t === 'Batch of 162: 162 clicks' && kids(row)[0].t === 'step 37/162', 'a QUIET batch shows its progress by count only (got ' + JSON.stringify(row) + ')');
  t = mk(); run(t, { do: 'click', x: 1, y: 1 }); pause(t);
  ok(t.unbind(true) === true && !/Planning/.test(JSON.stringify(t.render())), 'an unrecorded command that is still WORK (quiet) ends the "Planning" row');

  // ---- 11. a command still RUNNING is never a pause --------------------------------------------------------
  t = mk();
  t.start({ do: 'chat-wait' });
  T += 60000;
  ok(t.idle() === false, 'idle() during a running chat-wait does nothing (it is work, not a pause)');
  tr = t.render();
  ok(tr[0].k[0].t === 'Waiting for a reply' && tr[0].k[0].s === 'doing' && !/Planning/.test(JSON.stringify(tr)), '...the panel keeps showing "Waiting for a reply"');
  t.end({ do: 'chat-wait' }, { ok: true, text: 'go on' });
  ok(t.render()[0].k[0].t === 'Waited for a reply → got a reply · 1m 0s' && t.render()[0].k[0].s === 'done', '...and it closes with its answer and how long it waited (got ' + t.render()[0].k[0].t + ')');

  // ---- 12. a poll repeated turn after turn is ONE row -- only a TRUE repeat, timed by its commands --------
  t = mk();
  for (let i = 0; i < 12; i++) { run(t, { do: 'ping' }, { ok: false, alive: false }); pause(t, 4000); }
  let real = kids(t.render()[0]).filter((n) => n.t !== AT.THINK);
  ok(real.length === 1 && real[0].t === '⚠ Looked ×12 · last → no reply (12 connection checks) · 1s', "a waiter's 12 pings are one row, timed by its 1.2 s of commands -- not 48 s of pauses (got " + real.map((n) => n.t).join(' | ') + ')');
  t = mk();
  run(t, { do: 'wait', until: { px: { x: 1, y: 1, is: '#ff0000' } } }, { ok: false }); pause(t, 4000);
  run(t, { do: 'ping' }, { ok: true, alive: true }); pause(t, 4000);
  real = kids(t.render()[0]).filter((n) => n.t !== AT.THINK);
  ok(real.length === 2 && real[0].t === '⚠ Waited for the screen → not yet' && real[1].t === 'Checked the connection → alive', 'a DIFFERENT look never merges into a failed one (its ⚠ stays) (got ' + real.map((n) => n.t).join(' | ') + ')');
  t = mk(); t.mark({ step: 'Wait for the page' }, true);
  for (let i = 0; i < 6; i++) { run(t, { do: 'ping' }, { ok: true, alive: true }); pause(t, 4000); }
  real = kids(stepNamed(t, 'Wait for the page')).filter((n) => n.t !== AT.THINK);
  ok(real.length === 1 && /^Looked ×6/.test(real[0].t), 'inside a declared step too, a repeated poll is ONE row -- not six identical ones (got ' + real.map((n) => n.t).join(' | ') + ')');

  // ---- 13. failures STAY visible: a folded step, sub-step or window never turns a ⚠ into a pass ----------
  t = mk(); t.mark({ step: 'Verify the total' }, true); t.mark({ text: 'Checking the total reads 174.48' }, true);
  run(t, { do: 'shot' }, { ok: true, w: 1, h: 1 }); run(t, { do: 'wait', until: { px: {} } }, { ok: false });
  tr = t.render();
  const chk = kids(stepNamed(t, 'Verify the total')).find((n) => /Checking the total/.test(n.t)), live = kids(chk)[0];
  ok(!!live && live.s === 'warn' && /^⚠ Waiting for the screen → not yet · 2 so far$/.test(kids(live)[0].t), 'a live run whose latest answer was bad is sent as WARN (amber), its leaf with ⚠ (got ' + JSON.stringify(chk) + ')');
  pause(t);
  const chk2 = kids(stepNamed(t, 'Verify the total')).find((n) => /Checking the total/.test(n.t));
  ok(chk2.s === 'done' && kids(chk2).length === 1 && /^⚠ Looked ×2 · last → not yet/.test(kids(chk2)[0].t), 'once the check closes, its failure stays visible UNDER it -- it does not read as passed (got ' + JSON.stringify(chk2) + ')');
  t = mk(); t.mark({ step: 'Fill rows' }, true); t.mark({ substep: 'Row 1 of 3' }, true);
  run(t, { do: 'click', x: 1, y: 1 }); run(t, { do: 'click', x: 2, y: 2 }, { ok: false }); t.mark({ substep: 'Row 2 of 3' }, true);
  const r1 = kids(stepNamed(t, 'Fill rows')).find((n) => n.t === 'Row 1 of 3');
  ok(r1.s === 'done' && kids(r1).length === 1 && /^⚠ 1 of 2 failed — clicked 2×/.test(kids(r1)[0].t), 'a declared sub-step that closed with a failed click keeps it in sight (got ' + JSON.stringify(r1) + ')');
  t = mk();
  t.mark({ step: 'S0' }, true); run(t, { do: 'click', x: 1, y: 1 }, { ok: false });
  for (let i = 1; i < 7; i++) { t.mark({ step: 'S' + i }, true); run(t, { do: 'shot' }); run(t, { do: 'click', x: i, y: i }); }
  ok(kids(stepNamed(t, 'S0')).length === 1 && /^⚠ Failed — clicked \(1,1\)/.test(kids(stepNamed(t, 'S0'))[0].t), 'an OLD step whose rows fold away still shows what failed in it');
  for (let i = 7; i < 12; i++) { t.mark({ step: 'S' + i }, true); run(t, { do: 'shot' }); }
  ok(/^\d+ earlier steps \(⚠ 1 failed\)$/.test(kids(t.render()[0])[0].t), 'when it scrolls out of the window, the fold row still counts it (got ' + kids(t.render()[0])[0].t + ')');
  t = mk(); run(t, { do: 'click', x: 1, y: 1 }); run(t, { do: 'keys', text: 'ab' }, { ok: false }); run(t, { do: 'shot' }); pause(t);
  ok(/^⚠ /.test(t.render()[0].k[0].t), 'a closed burst with a failure in it says so in its headline (got ' + t.render()[0].k[0].t + ')');
  t = mk(); t.mark({ step: 'Many' }, true);
  for (let i = 0; i < 10; i++) { run(t, { do: 'click', x: i, y: 0 }); run(t, { do: 'shot' }); }
  const many = stepNamed(t, 'Many');
  ok(/^\d+ earlier actions$/.test(kids(many)[0].t) && kids(many).length <= 9, 'older actions in an open step fold into "N earlier actions" (got ' + kids(many)[0].t + ')');

  // ---- 14. the BUDGET: a long, busy session stays in the relay's clamp and NOW always survives -------------
  t = mk('LONG-SESSION');
  for (let s = 0; s < 120; s++) {
    if (s % 30 === 0) t.mark({ task: 'TASK-' + (s / 30) }, true);
    t.mark({ step: 'STEP-' + s }, true);
    if (s % 3 === 0) t.mark({ substep: 'SUB-' + s }, true);
    for (let k = 0; k < 6; k++) { run(t, { do: 'keys', text: 'x' }, null, 5); run(t, { do: 'click', x: k, y: s }, k === 2 ? { ok: false } : null, 5); run(t, { do: 'shot' }, { ok: true, w: 1, h: 1 }, 5); run(t, { do: 'chat', text: 'n' }, null, 5); }
  }
  run(t, { do: 'press', code: 'ArrowUp' }); t.start({ do: 'press', code: 'ArrowDown' });
  tr = t.render();
  ok(inClamp(tr), 'a 120-step, 2,880-command session (with failures everywhere) renders inside the clamp (' + AT.nodeCount(tr) + ' nodes, depth ' + AT.treeDepth(tr) + ')');
  ok(flat(tr).some((r) => r.t === 'STEP-119' && r.s === 'doing') && flat(tr).some((r) => r.t === 'Pressing ↓ · 2 so far'), 'the CURRENT step and the CURRENT action survive the trim');
  ok(flat(tr).some((r) => /^\d+ earlier steps/.test(r.t)) && !flat(tr).some((r) => /^✓/.test(r.t)), 'older rows fold into "N earlier steps" (no doubled ✓)');
  const small = mk('SMALL', { budget: 14 });
  for (let s = 0; s < 6; s++) { small.mark({ step: 'Q' + s }, true); for (let k = 0; k < 5; k++) { run(small, { do: 'click', x: k, y: s }); run(small, { do: 'shot' }); } }
  small.start({ do: 'probe', x: 1, y: 1 });
  tr = small.render();
  ok(AT.nodeCount(tr) <= 14 && flat(tr).some((r) => r.t === 'Q5' && r.s === 'doing') && flat(tr).some((r) => /^Checking pixel \(1,1\)/.test(r.t)),
     'squeezed to a 14-node budget, the trims shed old detail first and keep the current step and action (' + AT.nodeCount(tr) + ' nodes)');
  t = mk();
  for (let s = 0; s < 4; s++) { t.mark({ step: 'S' + s }, true); run(t, { do: 'click', x: s, y: 0 }); run(t, { do: 'shot' }); }
  ok(kids(stepNamed(t, 'S0')).length === 2, 'with room to spare, older finished steps keep their rows (detail when it fits)');

  // ---- 15. memory stays bounded however long the run ---------------------------------------------------------
  t = mk();
  for (let i = 0; i < 5000; i++) run(t, { do: 'keys', text: 'y', show: 1 }, null, 1);
  pause(t);
  row = t.render()[0].k[0];
  ok(row.t.length <= 100 && /^Typed 'y+…'/.test(row.t), 'a 5,000-key run is one bounded row (' + row.t.length + ' chars)');
  ok(t.state.tasks[0].steps[0].items[0].d.segs[0].v.length <= 200, '...holding a bounded amount of text');
  for (let i = 0; i < 600; i++) { run(t, { do: 'click', x: i, y: 0 }); pause(t); }
  ok(t.state.tasks[0].steps.length <= 400, '600 bursts keep at most 400 steps in memory (' + t.state.tasks[0].steps.length + ')');
  ok(flat(t.render()).some((r) => /^59\d earlier steps$/.test(r.t)), 'and the "earlier" count still includes the dropped ones');
  t = mk(); t.mark({ step: 'Big' }, true);
  for (let i = 0; i < 450; i++) run(t, { do: i % 2 ? 'click' : 'shot', x: i, y: 0 }, null, 1);
  ok(t.state.tasks[0].steps[0].items.length <= 400 && /^\d+ earlier actions$/.test(kids(stepNamed(t, 'Big'))[0].t), 'a declared step with 450 groups keeps at most 400, the rest counted in the fold');
  t = mk(); const bigPlan = new Array(200).fill(0).map((_, i) => ({ do: 'click', x: i, y: i, text: 'x'.repeat(50) }));
  run(t, { do: 'plan', steps: bigPlan }, { ok: true, ran: 200 });
  const kept = t.state.tasks[0].steps[0].items[0].d.cmd;
  ok(kept.steps.length === 200 && kept.steps.every((x) => x === undefined), 'a recorded 200-step batch keeps its step COUNT, not the 200 steps');

  // ---- 16. a FLAT plan as a tree (so a watcher already on a tree still sees it) ------------------------------
  const pl = AT.planToTree({ steps: ['Open', 'Read', 'Solve', 'Read'], at: 2, text: 'found a unique solution', sub: ['a', 'b'], subAt: 1 });
  ok(JSON.stringify(pl) === JSON.stringify([{ t: 'Open', s: 'done' }, { t: 'Read', s: 'done' }, { t: 'Solve', s: 'doing', k: [{ t: 'a', s: 'done' }, { t: 'b', s: 'doing', k: [{ t: 'found a unique solution', s: 'doing' }] }] }, { t: 'Read #2', s: 'todo' }]),
     'planToTree: done / doing (with its sub-steps and live line) / todo, twins numbered (got ' + JSON.stringify(pl) + ')');
  ok(AT.planToTree({ steps: ['a', 'b'], at: 0, fin: 1 }).every((n) => n.s === 'done') && AT.planToTree({}).length === 0, 'fin settles a plan; no steps -> no rows');
  ok(AT.planToTree({ steps: ['a', 'b', 'c'], at: 0, stat: 'x!' }).map((n) => n.s).join(',') === 'done,warn,todo', "the flat panel's per-step codes carry over (x = done, ! = warn)");

  // ---- 17. second review: each finding reproduced before its fix --------------------------------------------
  // (a) a soft step must survive the pause BEFORE its first action -- the driver's own think time
  t = mk();
  t.mark({ text: 'SOFT-STEP' }, true);
  pause(t, 4000);
  run(t, { do: 'click', x: 1, y: 1 }); run(t, { do: 'click', x: 2, y: 2 });
  let soft = stepNamed(t, 'SOFT-STEP');
  ok(!!soft && soft.s === 'doing' && kids(soft).some((n) => n.t === 'Clicking…'), 'a soft step stays open through the pause before its first action, and the action lands IN it (got ' + JSON.stringify(t.render()) + ')');
  pause(t);
  ok(stepNamed(t, 'SOFT-STEP').s === 'done', '...and closes at the pause after its work');
  t = mk(); t.mark({ step: 'Play' }, true); t.mark({ text: 'move 12' }, true); pause(t, 4000); run(t, { do: 'press', code: 'ArrowUp' });
  soft = kids(stepNamed(t, 'Play')).find((n) => n.t === 'move 12');
  ok(!!soft && soft.s === 'doing' && kids(soft).length === 1, '...a soft SUB-step too');
  // (b) a plain line must not close a DECLARED sub-step
  t = mk(); t.mark({ step: 'Solve' }, true); t.mark({ substep: 'Chunk 2 of 3' }, true);
  ok(t.mark({ text: 'move 12' }, true) === false, 'a plain line under an open declared sub-step changes nothing in the tree (it is the live line)');
  run(t, { do: 'press', code: 'ArrowUp' });
  const ch2c = kids(stepNamed(t, 'Solve')).find((n) => n.t === 'Chunk 2 of 3');
  ok(!!ch2c && ch2c.s === 'doing' && kids(ch2c).length === 1, '..."Chunk 2 of 3" stays open with the work under it, never ✓ mid-chunk');
  ok(t.mark({ substep: 'Chunk 2 of 3' }, true) === false && !/#2/.test(JSON.stringify(t.render())), '...and re-declaring it adds no "Chunk 2 of 3 #2"');
  t = mk(); t.mark({ substep: 'Chunk 1' }, true); t.mark({ text: 'move 3' }, true); run(t, { do: 'click', x: 1, y: 1 });
  const c1 = stepNamed(t, 'Chunk 1');
  ok(!!c1 && c1.s === 'doing' && kids(c1).some((n) => n.t === 'move 3'), 'under a sub-step declared on its own, a plain line nests in it instead of closing it');
  // (c) a finish from inside a batch finishes the task (the panel went green over a task still running)
  t = mk(); t.start({ do: 'plan', steps: [{}, {}] });
  ok(t.mark({ fin: 1 }, true, true) === true && t.render()[0].s === 'done', 'a FINISH sent from inside a batch finishes the task');
  t.end({ do: 'plan', steps: [{}, {}] }, { ok: true, ran: 2 });
  ok(t.idle() === false && !/Planning/.test(JSON.stringify(t.render())) && flat(t.render()).every((r) => r.s === 'done'), '...and nothing after it is left running or planning');
  ok(t.mark({ step: 'X' }, true, true) === false, 'other structure from inside a batch is still ignored');
  // (d) Shift / AltGr chords on character keys are TYPING -- "Shift+A" spelled a password out a capital at a time
  t = mk();
  run(t, { do: 'chord', mod: 'ShiftLeft', code: 'KeyH' }); run(t, { do: 'press', code: 'KeyU' });
  run(t, { do: 'chord', mod: 'ShiftRight', code: 'Digit1' }); run(t, { do: 'chord', mod: 'AltRight', code: 'KeyQ' });
  run(t, { do: 'chord', mod: 'ControlLeft', code: 'KeyS' });
  pause(t);
  all = JSON.stringify(t.render()) + t.line();
  ok(!/Shift\+H|Shift\+1|Alt\+Q|'h|'u|'H/.test(all) && /Typed 4 characters, Ctrl\+S/.test(all), 'Shift/AltGr + a character is hidden typing; a real shortcut is still named (got ' + all.slice(0, 160) + ')');
  ok(AT.actPhrase({ do: 'chord', mod: 'ShiftLeft', code: 'KeyA' }) === 'Typing a character' && AT.actPhrase({ do: 'chord', mod: 'ShiftLeft', code: 'Tab' }) === 'Pressing Shift+⇥',
     '...one at a time too (Shift+Tab is a key, not text)');
  t = mk(); run(t, { do: 'chord', mod: 'ShiftLeft', code: 'KeyP', show: 1 }); run(t, { do: 'keys', text: 'lay', show: 1 }); pause(t);
  ok(t.render()[0].k[0].t === "Typed 'Play'", "with show:1 a Shift+letter reads as its capital (got " + t.render()[0].k[0].t + ')');
  // (e) an OPEN burst keeps one label (the viewer keys every stopwatch on the label path)
  t = mk();
  run(t, { do: 'click', x: 1, y: 1 }); run(t, { do: 'keys', text: 'a' });
  const h1 = t.render()[0].k[0].t;
  run(t, { do: 'keys', text: 'b' }); run(t, { do: 'shot' }, { ok: true, w: 1, h: 1 }); run(t, { do: 'click', x: 2, y: 2 }); run(t, { do: 'press', code: 'Enter' });
  const h2 = t.render()[0].k[0].t;
  ok(h1 === 'Clicked (1,1) …' && h2 === h1, 'an open burst keeps ONE label as its groups come and go (got ' + h1 + ' / ' + h2 + ')');
  pause(t);
  ok(t.render()[0].k[0].t === 'Typed 2 chars +4', '...and takes its summary when it closes (got ' + t.render()[0].k[0].t + ')');
  // (f) a look after a finish never merges back into the finished step
  t = mk(); run(t, { do: 'shot' }, { ok: true, w: 1, h: 1 }); t.mark({ fin: 1 }, true); run(t, { do: 'shot' }, { ok: true, w: 1, h: 1 });
  ok(kids(t.render()[0]).length === 2 && !/2 so far|×2/.test(JSON.stringify(t.render())), 'a look after a finish starts its own step');
  // (g) a retired tool tree is kept INSIDE the driver's open step (or sub-step), where the tool did its work
  t = mk(); t.mark({ step: 'Solve the puzzle' }, true); run(t, { do: 'click', x: 1, y: 1 });
  t.suspend(); t.adopt([{ t: 'Fill the grid', s: 'done' }]);
  let sp = stepNamed(t, 'Solve the puzzle');
  ok(!!sp && sp.s === 'doing' && kids(sp).some((n) => n.t === 'Ran: Fill the grid' && n.s === 'done'), "a tool tree retired while the driver's step is open stays inside that step");
  t.adopt([{ t: 'Fill the grid', s: 'done' }]);
  ok(kids(stepNamed(t, 'Solve the puzzle')).some((n) => n.t === 'Ran: Fill the grid #2'), '...a second run of it is "#2"');
  t.mark({ substep: 'Chunk 1' }, true); t.adopt([{ t: 'Batch', s: 'done' }]);
  sp = stepNamed(t, 'Solve the puzzle');
  ok(kids(kids(sp).find((n) => n.t === 'Chunk 1')).some((n) => n.t === 'Ran: Batch'), '...or inside its open sub-step');
  // (h) housekeeping after a finish keeps it green
  ok(['reconnect', 'lock', 'note-done', 'note-add', 'spotlight-off'].every((v) => AT.isConversation({ do: v })), 'reconnect / lock / sticky-note / clear-highlight are housekeeping, not new work');
  // (i) valid JSON that makes String() and Number() throw ({"toString":1}) -- it crashed the serve under a flat plan
  const poison = JSON.parse('{"toString":1,"valueOf":1}');
  let crashed = null;
  try {
    for (const v of ['click', 'keys', 'press', 'chord', 'open', 'scroll', 'probe', 'find', 'plan', 'clicks', 'stroke', 'wait', 'bogus']) {
      const c = { do: v, x: poison, y: poison, text: poison, code: poison, mod: poison, url: poison, n: poison, at: poison, steps: poison, intent: poison, show: poison, points: poison, until: poison };
      AT.actPhrase(c); AT.pastPhrase(c);
      const u = mk(poison); u.mark({ task: poison, step: poison, text: poison }, true); u.start(c); u.end(c, { ok: true, is: poison, w: poison, words: poison, state: poison, verdict: poison, ran: poison });
      u.tick(0, 2, c); u.idle(); u.adopt([{ t: poison }]); u.render(); u.line();
    }
    AT.planToTree({ steps: [poison, 'b', '__proto__', 'constructor'], text: poison, sub: [poison], at: poison, stat: poison });
    AT.shortUrl(poison); AT.redactShown(poison);
  } catch (e) { crashed = e; }
  ok(!crashed, 'a field like {"toString":1} never throws' + (crashed ? ' (' + crashed.stack + ')' : ''));
  ok(AT.actPhrase({ do: 'constructor' }) === "Running 'constructor'" && AT.isAction({ do: '__proto__' }), 'a verb named like an Object property is just an unknown verb');

  // ---- 18. FUZZ: odd input must never throw (a throw used to kill the serve and lose the grant) --------------
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const junk = [null, undefined, 0, -1, NaN, Infinity, '', 'x'.repeat(3000), '👋'.repeat(70), {}, [], [null], [[null]], [[1, 2]], { points: 'x' }, true, 'Enter', 'KeyQ',
                JSON.parse('{"toString":1}'), JSON.parse('{"valueOf":{},"toString":[]}'), JSON.parse('{"__proto__":{"x":1}}'), ['ShiftLeft'], 'ShiftLeft', 'AltRight',
                'https://u:p#q@a1b2c3d4e5f6.ngrok.io/t-Ab12Cd34Ef?x=1', '__proto__'];
  const verbs = ['keys', 'press', 'chord', 'click', 'clicks', 'dbl', 'right', 'clickText', 'stroke', 'strokes', 'scroll', 'open', 'shot', 'probe', 'ocr', 'find',
                 'liveness', 'ping', 'chat', 'chat-img', 'chat-wait', 'confirm', 'note-add', 'note-list', 'spotlight', 'plan', 'lock', 'exec', 'bogus', '', 'wait',
                 'constructor', '__proto__', 'toString', 'reconnect'];
  let threw = null, badFrame = null;
  t = mk('👋'.repeat(80));
  for (let i = 0; i < 3000 && !threw; i++) {
    const c = { do: pick(verbs), text: pick(junk), x: pick(junk), y: pick(junk), at: pick(junk), list: pick(junk), points: pick(junk), steps: pick(junk),
                code: pick(junk), mod: pick(junk), url: pick(junk), n: pick(junk), intent: pick(junk), show: pick(junk), secret: pick(junk), to: pick(junk),
                repeat: pick(junk), until: pick(junk), quiet: pick(junk) };
    try {
      const r = rnd();
      if (r < 0.08) t.mark({ task: pick(junk), step: pick(junk), substep: pick(junk), text: pick(junk), fin: pick(junk), tree: pick(junk), steps: pick(junk), at: pick(junk) }, rnd() < 0.7, rnd() < 0.1);
      else if (r < 0.1) t.idle(); else if (r < 0.11) t.suspend(); else if (r < 0.12) t.adopt(pick(junk)); else if (r < 0.14) t.tick(rnd() * 9, 9, c);
      else if (r < 0.15) t.unbind(rnd() < 0.5);
      else { t.start(c); T += Math.floor(rnd() * 300); t.end(c, pick([{ ok: false }, { ok: true, w: pick(junk), is: pick(junk), words: pick(junk), state: pick(junk), ran: pick(junk) }, null, {}])); }
      T += Math.floor(rnd() * 4000);
      if (i % 50 === 0) { const f = t.render(); t.line(); if (!inClamp(f)) badFrame = f; }
      AT.planToTree({ steps: pick(junk), at: pick(junk), text: pick(junk), sub: pick(junk), subAt: pick(junk), stat: pick(junk) });
    } catch (e) { threw = e; }
  }
  ok(!threw, '3,000 fuzzed commands never throw' + (threw ? ' (' + threw.stack + ')' : ''));
  ok(!badFrame, 'every fuzzed frame stays inside the clamp with clean labels' + (badFrame ? ' (' + JSON.stringify(badFrame).slice(0, 300) + ')' : ''));
} catch (e) { fail++; console.error('  FAIL (exception): ' + (e && e.stack || e)); }

console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

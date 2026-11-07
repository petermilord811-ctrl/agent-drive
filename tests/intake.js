// intake.js — core/intake.js: a job asked for in plain words ("connect 10004 and do my sticky notes") read into the
// machine, the skill, the access to ask for at the door, and the command line that starts the visit. Every skill is
// reached by what people say; a machine number is never taken from a time, a year, money, a phone number, an address,
// a sum or a count, and two machines are never a guess; the access asked is the least the words justify; the task
// keeps the person's words; the command line survives a real shell with quotes, $, backticks and an apostrophe in it.
// Offline, no dependencies (the shell round trip runs in whichever of sh / PowerShell is installed).
//   node tests/intake.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const KIT = path.join(__dirname, '..');
const intake = require(path.join(KIT, 'core', 'intake.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const SK = intake.skills(path.join(KIT, 'skills'));
const SLUGS = new Set(SK.map((s) => s.slug));
const seen = [];                                     // every reading made below: none may name a skill that is not in skills/
const P = (text, list) => { const r = intake.parse(text, list || SK); seen.push([text, r]); return r; };
const show = (r) => 'host=' + r.host + ' skill=' + (r.skill ? r.skill.slug : 'none') + ' task=' + JSON.stringify(r.task) + ' why=' + r.why;
const want = (text, slug) => { const r = P(text); ok(r.skill && r.skill.slug === slug, JSON.stringify(text) + ' -> ' + show(r) + ' (want ' + slug + ')'); return r; };
const noSkill = (text) => { const r = P(text); ok(r.skill === null && /no skill/.test(r.why), JSON.stringify(text) + ' should name no skill: ' + show(r)); return r; };
const host = (text, h) => { const r = P(text); ok(r.host === h, JSON.stringify(text) + ' -> host ' + r.host + ' (want ' + h + '): ' + r.why); return r; };
const task = (text, t) => { const r = P(text); ok(r.task === t, JSON.stringify(text) + ' -> task ' + JSON.stringify(r.task) + ' (want ' + JSON.stringify(t) + ')'); return r; };
const needs = (text, c, s, t) => {
  const r = P(text), n = r.needs;
  ok(n.control === c && n.shell === s && n.terminal === t, JSON.stringify(text) + ' -> needs ' + JSON.stringify(n) + ' (want control ' + c + ', shell ' + s + ', terminal ' + t + '): ' + r.why);
  return r;
};

// ---- skills(): the library, read the way `node kit.js skills` lists it
ok(SK.length >= 15 && SK.every((s) => s.slug && s.name && typeof s.when === 'string' && Array.isArray(s.tags) && typeof s.run === 'string'),
   'skills() reads every skill as {slug, name, when, tags, run} (' + SK.length + ')');
ok(SK.every((s) => Object.keys(s).join(',') === 'slug,name,when,tags,run'), 'a skill is exactly {slug, name, when, tags, run}');
ok(!SLUGS.has('_template') && !SLUGS.has('README.md'), 'skills/_template and skills/README.md are not skills');
ok(SK.map((s) => s.slug).join() === SK.map((s) => s.slug).sort().join(), 'skills come sorted by slug');
const sudoku = SK.find((s) => s.slug === 'solve-a-sudoku');
ok(sudoku && sudoku.name === 'Solve a sudoku' && sudoku.run === 'node skills/solve-a-sudoku/fast.js ./work master' && sudoku.tags.includes('puzzle'),
   'a skill carries its frontmatter: name, run, tags');
ok(Array.isArray(intake.skills(path.join(KIT, 'no-such-folder'))) && intake.skills(path.join(KIT, 'no-such-folder')).length === 0, 'a missing folder is an empty library, never a throw');
const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-intake-'));
process.on('exit', () => { try { fs.rmSync(lib, { recursive: true, force: true }); } catch (_) {} });   // self-cleaning, even after a throw
const mk =(slug, body) => { fs.mkdirSync(path.join(lib, slug), { recursive: true }); if (body != null) fs.writeFileSync(path.join(lib, slug, 'README.md'), body); };
mk('fill-a-form', '---\nname: Fill a form\nwhen: a multi-field form on screen — type each value\ntags: browser, forms, input\nrun: node skills/fill-a-form/fill-form.js ./work form.json\n---\n# skill: fill a form\n');
mk('zzz-no-frontmatter', '# Operate a file manager\n\nMove and rename files on the host when the task needs it.\n');
mk('_template', '---\nname: {{name}}\nwhen: x\n---\n');
mk('not-a-skill', null);
const FX = intake.skills(lib);
ok(FX.length === 2 && FX[0].slug === 'fill-a-form' && FX[0].tags.join(',') === 'browser,forms,input' && FX[0].run === 'node skills/fill-a-form/fill-form.js ./work form.json',
   'a fixture library: frontmatter read, _template and a folder without a README skipped');
ok(FX[1] && FX[1].name === 'Operate a file manager' && /Move and rename files/.test(FX[1].when) && FX[1].run === '', 'no frontmatter: the first heading and prose line stand in');
const envWas = process.env.SM_SKILLS_DIR;
process.env.SM_SKILLS_DIR = lib;
ok(intake.skills().length === 2, 'skills() with no folder reads SM_SKILLS_DIR, as kit.js does');
if (envWas === undefined) delete process.env.SM_SKILLS_DIR; else process.env.SM_SKILLS_DIR = envWas;

// ---- the skill: every skill in the library, by what people say (at least two ways each)
want('connect 10004 and do my sticky notes', 'work-through-sticky-notes');
want('connect 10004 and read my sticky-note tasks', 'work-through-sticky-notes');          // the roadmap's own example
want('go through the post-its on #10002 and cross them off', 'work-through-sticky-notes');
want("I prepared tasks as sticky notes in 10004 — read them, start working, and cross off each as it's done", 'work-through-sticky-notes');
want('on machine 10002 solve the sudoku', 'solve-a-sudoku');
want('can you do the su-doku on pc 10001?', 'solve-a-sudoku');
want('10004: sudoku', 'solve-a-sudoku');
want('can you fill in the survey on #10003', 'complete-a-survey');
want('fill out the questionnaire on 10002', 'complete-a-survey');
want('answer the poll on host 10005 please', 'complete-a-survey');
want('hop on 10002 and fill in the form', 'complete-a-survey');
want('play 2048 on 10005 please', 'play-2048');
want('10005: 2048, get the biggest tile you can', 'play-2048');
want('slide and merge the numbered tiles on 10003', 'play-2048');
want('research the capital of Peru', 'research-a-fact');
want('look up how tall the Eiffel Tower is on 10003 and save it as a note', 'research-a-fact');
want('on 10001, find out who wrote Hamlet', 'research-a-fact');
want("what's on the screen of 10001?", 'read-the-screen');
want('read the error message on 10004 exactly', 'read-the-screen');
want('take a screenshot of 10002 and tell me what it says', 'read-the-screen');
want('on 10003 calculate (1234 * 5678) + 91011', 'do-a-calculation');
want('what is 12 * 34? use the calculator on 10002', 'do-a-calculation');
want('do a typing test on monkeytype on 10003', 'do-a-typing-test');
want('connect 10003 and see how many words per minute you can type', 'do-a-typing-test');
want('check my typing speed in wpm on 10003', 'do-a-typing-test');
want('draw a cat in GIMP on 10004', 'draw-with-strokes');
want('sketch a smiley face on the kleki canvas, machine 10003', 'draw-with-strokes');
want('doodle a dog on 10001', 'draw-with-strokes');
want('open example.com in the browser on 10002', 'drive-a-browser');
want('on 10001 launch Firefox and navigate to the news site', 'drive-a-browser');
want('visit the website example.org on 10002', 'drive-a-browser');
want('the browser on 10004 shows a blank page, recover it', 'recover-a-stuck-session');
want("10005's session is stuck, the relay moved", 'recover-a-stuck-session');
want('the browser on 10004 is frozen', 'recover-a-stuck-session');
want('solve the 15 puzzle on 10005', 'solve-15-puzzle');
want("on #10003 there's a sliding tile puzzle, solve it", 'solve-15-puzzle');
want('solve the 8 puzzle on 10004', 'solve-15-puzzle');
want('solve the nonogram on 10001', 'solve-a-nonogram');
want('finish the picross puzzle on machine 10002', 'solve-a-nonogram');
want('hanjie on 10001', 'solve-a-nonogram');
want('solve the kenken on 10004', 'solve-kenken');
want('on 10002 do the MathDoku grid', 'solve-kenken');
want('calcudoku on #10004', 'solve-kenken');
want('play minesweeper on 10003', 'solve-minesweeper');
want('clear the mines on pc 10005 without guessing', 'solve-minesweeper');
// and every skill in the library is found by its own name -- a new skill too, without an edit here
for (const s of SK) {
  const r = P(s.name + ' on 10004');
  ok((r.skill && r.skill.slug === s.slug) || r.others.some((o) => o.slug === s.slug), JSON.stringify(s.name) + ' finds ' + s.slug + ': ' + show(r));
}
const sk1 = P('play 2048 on 10005 please').skill;
ok(sk1 && sk1.name === 'Play 2048' && sk1.run === 'node skills/play-2048/play2048.js move skills/play-2048/example.board.json' && sk1.score > 0 && Object.keys(sk1).join() === 'slug,name,run,score',
   'the skill is {slug, name, run, score}, with its run line');
ok(P('connect 10004 and do my sticky notes').skill.run === '', 'a skill without a run line says so with an empty run');

// ---- no skill: nothing fits, only general words, or a tie -- the driver works it out
ok(noSkill('connect 10004 and check the disk space').others.length === 0, 'nothing fits: no skill and nothing offered');
noSkill('on 10002 rename the files in Downloads');
ok(noSkill('run the tests on 10004').others.length === 0, '"tests" alone is no typing test');
ok(noSkill('type hello into notepad on 10004').others.length === 0, '"type" alone is no typing test');
const game = noSkill('play a game on 10005');
ok(game.others.some((o) => o.slug === 'play-2048') && /only general words/.test(game.why), 'two general words ("play a game") offer the game skill as a maybe, not a pick');
const puzzle = noSkill('solve the puzzle on 10001');
ok(['solve-15-puzzle', 'solve-a-nonogram', 'solve-a-sudoku', 'solve-kenken', 'solve-minesweeper'].every((s) => puzzle.others.some((o) => o.slug === s)),
   '"solve the puzzle" names no puzzle: every solver is a maybe (' + puzzle.others.map((o) => o.slug) + ')');
ok(noSkill('solve 8 puzzles on 10004').others.length === 5, '"8 puzzles" is a count, not the 8-puzzle');
const tie = noSkill("solve the sudoku on 10004 and 10004's kenken");
ok(tie.others.length === 2 && /fit equally/.test(tie.why), 'two skills tied at the top are both offered, neither picked');
noSkill('type "10004" into the search box');
const close = want('fill in the survey at https://example.com/s on 10003', 'complete-a-survey');
ok(close.others.length === 1 && close.others[0].slug === 'drive-a-browser' && /close: drive-a-browser/.test(close.why) && Object.keys(close.others[0]).join() === 'slug,name,score',
   'a close second goes in others as {slug, name, score}');
ok(P('read my sticky notes on 10004').others.length === 0, 'a distant second is not offered');
const bare = intake.parse('solve the sudoku on 10004');
ok(bare.skill === null && bare.host === '10004' && /no skills to match/.test(bare.why), 'parse without a skill list still reads the machine, and says why there is no skill');
ok(intake.parse('solve the sudoku on 10004', FX).skill === null && intake.parse('fill in the form on 10004', FX).skill.slug === 'fill-a-form',
   'another library: only its own skills are named (no sudoku there), and its own are found');

// ---- the machine: how it is written
host('10004: sudoku', '10004');
host('machine 10004 do the kenken', '10004');
host('host 10004, solve the sudoku', '10004');
host('pc 10004 solve the sudoku', '10004');
host('on #10003 fill in the survey', '10003');
host('solve the sudoku on 10002', '10002');
host('PC-10004 sudoku', '10004');
host('host:10004 sudoku', '10004');
host('machine number 10004: do the kenken', '10004');
host('the 10004 machine: sudoku', '10004');
host("what's on 10004's screen?", '10004');
host("connect to '10004' and play 2048", '10004');
host('log into 10004 and play 2048', '10004');
// ...and what is not a machine
host('solve the sudoku at 10:30', null);
ok(/^machine 10004 \("connect 10004"\);/.test(host('at 10:30 connect 10004 and solve the sudoku', '10004').why), 'why quotes the words that named the machine');
ok(/^machine 10002 \("on machine 10002"\);/.test(P('on machine 10002 solve the sudoku').why) && /^machine 10004 \(written plainly\);/.test(P('10004: sudoku').why),
   '...or says it was written plainly');
host('research what happened in 2026', null);
host('fill in the 2026 survey on 10003', '10003');
ok(/12000 is money/.test(host('find a laptop for $12000', null).why), '$12000 is money, and why says so');
host('find a laptop for 12,000 dollars', null);
host('on 10002 find a laptop under $12000', '10002');
host('a budget of 12000 USD on 10004', '10004');
host('€12000 on pc 10002', '10002');
host('call 555-12345 and ask', null);
ok(/phone/.test(host('+1 555 12345 is my number', null).why), 'a phone number is no machine, and why says so');
host('(555) 12345', null);
host('0800 12345', null);
host('my phone is 12345', null);
host('0712345678', null);
host('on 100045 solve the sudoku', null);
host('solve the sudoku on 1000', null);
host('open https://example.com/item/12345 on 10004', '10004');
ok(/web address/.test(host('open example.com:10004/admin', null).why), 'a number in a web address (a port here) is no machine');
host('go to example.com/12345', null);
host('send it to user12345@example.com', null);
host('open C:\\data\\12345\\report.txt', null);
host('open C:\\data\\12345\\report.txt on 10004', '10004');
host('type "10004" into the search box', null);
host('type 12345 and 67890 into the form', null);                       // a list carries its first item's reading
host('open https://example.com/12345 and 67890', '67890');              // ...but not where the first one sat
host('on 10003 calculate 12345 * 6789', '10003');
ok(/12345 is a sum/.test(host('what is 12345 * 6789', null).why), 'a number in a sum is no machine, and why says so');
host('play 2048 on 10005 until you reach 16384', '10005');
host('on 10004 wait 10000 ms', '10004');
host('connect 10004, the code is 48213', '10004');
host('the code is 48213', null);
host('zip code 90210 on 10004', '10004');
const both = host('on 10004 set the volume to 50000', '10004');
ok(/50000 is part of the job/.test(both.why), 'a number marked as the machine wins over a bare one, which stays part of the job');
host("solve the sudoku on 10004 and 10004's kenken", '10004');
// several machines: never a guess
const two = host('connect 10004 and 10005 and do the notes', null);
ok(/several are named \(10004, 10005\)/.test(two.why) && two.ok === false && two.task === 'do the notes', 'two machines named: no machine, why names them, the job still read');
host('machines 10004, 10005: notes', null);
host('machines 10004/10005 sudoku', null);
host('10001-10005 sudoku', null);
ok(/none marked as the machine/.test(host('10004 10005 sudoku', null).why), 'two bare numbers: no machine, and why says none was marked');
ok(/no machine named/.test(P('research the capital of Peru').why) && P('research the capital of Peru').ok === false, 'no number at all: no machine, not ok, and why says to name one');

// ---- the access: the least the words justify
needs('on machine 10002 solve the sudoku', true, false, false);
needs('play 2048 on 10005 please', true, false, false);
needs('can you fill in the survey on #10003', true, false, false);
needs('type hello into notepad on 10004', true, false, false);
needs("what's on the screen of 10001?", false, false, false);
needs('read my sticky notes on 10004', false, false, false);
needs('connect 10004 and check the disk space', false, false, false);
needs('what type of file is on the desktop of 10004?', false, false, false);
needs('which windows are open on 10004?', false, false, false);
needs("what's playing on 10004?", false, false, false);
needs('install vlc on 10004', false, true, false);
needs('run a powershell script on #10002', false, true, false);
needs('install vlc on 10004 and open it', true, true, false);
needs('on 10002 run $HOME/setup.sh', false, true, false);
needs('execute build.bat on 10002', false, true, false);
needs('edit setup.ps1 in notepad on 10002', true, false, false);
ok(/terminal \("terminal"; "ipconfig" runs there\)/.test(needs('run ipconfig in the terminal on 10003', false, false, true).why),
   'a command meant for the Terminal panel asks for the terminal, not a shell grant');
needs('open the terminal on 10001 and run ls', false, false, true);
needs('open Windows Terminal on 10004', true, false, false);
needs("type 'install vlc' into the chat on 10004", true, false, false);
needs('research the capital of Peru', true, false, false);
const save = needs('look up the capital of Peru on 10003 and save it as a sticky note', true, false, false);
ok(/control \("look up"\)/.test(save.why), 'why names the word behind the ask ("look up"; saving a sticky note needs nothing)');
ok(/control \(the play-2048 skill: "play"\)/.test(needs('2048 on 10005', true, false, false).why), 'no verb at all: what the skill itself does decides, and why says so');
needs('the sudoku on 10002', true, false, false);
needs('connect 10004 and do my sticky notes', true, false, false);
ok(/watch only/.test(P("what's on the screen of 10001?").why), 'reading only: why says it is a watch-only visit');

// ---- the task: the person's words, minus the connect part and the politeness
task('connect 10004 and do my sticky notes', 'do my sticky notes');
task('on machine 10002 solve the sudoku', 'solve the sudoku');
task('can you fill in the survey on #10003', 'fill in the survey');
task('play 2048 on 10005 please', 'play 2048');
task('research the capital of Peru', 'research the capital of Peru');
task("what's on the screen of 10001?", "what's on the screen?");
task('Hey, could you please connect to machine #10004 and read my sticky-note tasks? Thanks!', 'read my sticky-note tasks');
task("what's on 10004's screen?", "what's on the screen?");
task("what's on 10004?", "what's on the screen?");
task('could you tell me what\'s on the screen of 10003?', "tell me what's on the screen");
task('please type "please" on 10004', 'type "please"');
task('at 10:30 connect 10004 and solve the sudoku', 'at 10:30 solve the sudoku');
task('use 10004 to solve the sudoku', 'solve the sudoku');
task('10004 - solve the sudoku', 'solve the sudoku');
task('connect 10004 and then solve the sudoku', 'solve the sudoku');
task('connect to machine #10004, then open example.com', 'open example.com');
task('solve the sudoku on 10004 for me, thanks!', 'solve the sudoku');
task('-- solve the sudoku on 10004', 'solve the sudoku');
task('connect 10004\nsolve the sudoku', 'solve the sudoku');
task('play 2048 on 10005 until you reach 16384', 'play 2048 until you reach 16384');
const only = task('connect 10004', '');
ok(only.host === '10004' && only.ok === false && /no job beyond connecting/.test(only.why), 'a machine and no job: not ok, and why asks what the visit is for');
const full = P('connect 10004 and do my sticky notes');
ok(full.ok === true && Object.keys(full).join() === 'ok,host,skill,others,task,needs,why' && Object.keys(full.needs).join() === 'control,shell,terminal' && !/\n/.test(full.why),
   'the reading is {ok, host, skill, others, task, needs, why}, why on one line');

// ---- never throws, never slow
for (const odd of [null, undefined, 42, {}, [], '', '   ', '\u0000\u0001']) {
  let r, threw = false;
  try { r = intake.parse(odd, SK); } catch (_) { threw = true; }
  ok(!threw && r.ok === false && r.host === null && r.skill === null && r.why === 'nothing was asked', 'parse(' + JSON.stringify(odd) + ') is "nothing was asked"');
}
let threw = false;
try { intake.parse('solve the sudoku on 10004', [null, 5, {}, { slug: 'x' }]); intake.parse('solve the sudoku on 10004', 'not a list'); } catch (_) { threw = true; }
ok(!threw, 'a malformed skill list is no throw');
const t0 = Date.now();
intake.parse('1'.repeat(5000) + ' ' + '-'.repeat(5000) + ' ' + 'a.'.repeat(3000) + ' ' + '/a'.repeat(3000) + "'".repeat(3000), SK);
intake.parse(('connect 10004 and solve the sudoku, then 12345 * 6789 = ? and $12000 and https://example.com/12345 ').repeat(200), SK);
ok(Date.now() - t0 < 2000, 'a long, hostile request reads in well under a second or two (' + (Date.now() - t0) + ' ms)');

// ---- never invents a skill
ok(seen.every(([, r]) => (!r.skill || SLUGS.has(r.skill.slug)) && r.others.every((o) => SLUGS.has(o.slug))), 'no reading names a skill that is not in skills/');
let foreign = 0;
for (const [text] of seen.slice()) { const r = intake.parse(text, FX); if ((r.skill && !['fill-a-form', 'zzz-no-frontmatter'].includes(r.skill.slug)) || r.others.some((o) => !['fill-a-form', 'zzz-no-frontmatter'].includes(o.slug))) foreign++; }
ok(foreign === 0, 'against another library the same requests name only that library\'s skills (' + foreign + ' did not)');

// ---- the command line
const C = (p, o) => intake.command(p, o);
const T = 'type "hello" and $HOME and `whoami` and it\'s done';
ok(C(P('on machine 10002 solve the sudoku'), { shell: 'sh' }) === 'node core/agent-join.js --host 10002 --task "solve the sudoku" --control --serve ./work', 'a plain task in double quotes, as the docs write it (sh)');
ok(C(P('on machine 10002 solve the sudoku'), { shell: 'powershell' }) === 'node core/agent-join.js --host 10002 --task "solve the sudoku" --control --serve ./work', '...and the same for PowerShell');
ok(C({ host: '10004', task: "what's on the screen?", needs: {} }, { shell: 'sh' }) === 'node core/agent-join.js --host 10004 --task "what\'s on the screen?" --serve ./work', 'an apostrophe alone is plain: double quotes, no flags for a watch-only visit');
ok(C({ host: '10004', task: T, needs: { control: true } }, { shell: 'sh' }) === "node core/agent-join.js --host 10004 --task 'type \"hello\" and $HOME and `whoami` and it'\\''s done' --control --serve ./work",
   'sh: quotes, $, backticks and an apostrophe -> single quotes, the apostrophe as \'\\\'\'');
ok(C({ host: '10004', task: T, needs: { control: true } }, { shell: 'powershell' }) === "node core/agent-join.js --host 10004 --task 'type “hello” and $HOME and `whoami` and it''s done' --control --serve ./work",
   'PowerShell: single quotes, the apostrophe doubled, double quotes made typographic');
ok(C({ host: '10004', task: 'it’s ‘odd’', needs: {} }, { shell: 'powershell' }) === "node core/agent-join.js --host 10004 --task \"it’s ‘odd’\" --serve ./work" &&
   C({ host: '10004', task: 'it’s ‘odd’ $x', needs: {} }, { shell: 'powershell' }) === "node core/agent-join.js --host 10004 --task 'it’’s ‘‘odd’’ $x' --serve ./work",
   'PowerShell reads ‘ ’ as quotes too: inside single quotes they are doubled');
ok(C({ host: '10004', task: 'x', needs: { control: true, shell: true, terminal: true } }, { shell: 'sh' }) === 'node core/agent-join.js --host 10004 --task "x" --control --shell --terminal --serve ./work',
   'the asks come in a fixed order: --control --shell --terminal');
ok(C(P('research the capital of Peru'), { shell: 'sh' }) === 'node core/agent-join.js --host NNNNN --task "research the capital of Peru" --control --serve ./work',
   'no machine: NNNNN where the number goes (the client refuses it, so a pasted template reaches no one)');
ok(C(P('connect 10004'), { shell: 'sh' }) === 'node core/agent-join.js --host 10004 --serve ./work', 'no job: no --task at all');
ok(C({ host: '10004', task: '--control\nsecond line', needs: {} }, { shell: 'sh' }) === 'node core/agent-join.js --host 10004 --task "control second line" --serve ./work',
   'one line, never starting with "--" (the client would read it as a flag)');
ok(C({ host: '10004', task: 'x', needs: {} }, { shell: 'sh', serve: './work 2' }) === 'node core/agent-join.js --host 10004 --task "x" --serve "./work 2"', 'a serve folder with a space is quoted too');
ok(C({ host: '10004', task: 'open C:\\temp\\', needs: {} }, { shell: 'powershell' }).includes("--task 'open C:\\temp\\ '"),
   'PowerShell: a final backslash gets a space after it (5.1 would read it as escaping its own closing quote)');
let cthrew = false, cs = [];
try { cs = [C(null), C(42, 7), C({ host: 12345, task: 9 }, { shell: 'bash' })]; } catch (_) { cthrew = true; }
ok(!cthrew && cs[0] === 'node core/agent-join.js --host NNNNN --serve ./work' && cs[2] === 'node core/agent-join.js --host 12345 --task "9" --serve ./work', 'command() never throws on odd input');
ok(C({ host: '10004', task: T }) === C({ host: '10004', task: T }, { shell: process.platform === 'win32' ? 'powershell' : 'sh' }), 'with no shell named: PowerShell on Windows, sh elsewhere');

// ...and the quoting proven in the real shells that are here: each command, its node swapped for a script that prints
// the arguments it was given, must hand over the task exactly (PowerShell: its " as “ ”, and a final \ with its space)
const tasks = [[T, 'type “hello” and $HOME and `whoami` and it\'s done'], ["what's on the screen?", "what's on the screen?"],
  ['open C:\\temp\\', 'open C:\\temp\\ '], ['it’s ‘odd’ “quoted” and a "pair" of "pairs"', 'it’s ‘odd’ “quoted” and a “pair” of “pairs”'],
  ['pipe | semi ; amp & lt < gt > star * hash # pct %PATH% bang! dollar $(whoami) ${x}', 'pipe | semi ; amp & lt < gt > star * hash # pct %PATH% bang! dollar $(whoami) ${x}']];
const echo = path.join(lib, 'argv.js');
fs.writeFileSync(echo, 'process.stdout.write(JSON.stringify(process.argv.slice(2)).replace(/[\\u007f-\\uffff]/g, (c) => "\\\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\\n");\n');
const fwd = (p) => p.split(path.sep).join('/');
const shells = [['sh', 'sh', ['-s']]];
if (process.platform === 'win32') shells.push(['powershell', 'powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand']]);
shells.push(['powershell', 'pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand']]);
const ran = [];
for (const [kind, exe, args] of shells) {
  const script = tasks.map(([t]) => {
    const cmd = intake.command({ host: '10004', task: t, needs: { control: true } }, { shell: kind });
    return cmd.replace(/^node core\/agent-join\.js/, kind === 'sh' ? "'" + fwd(process.execPath) + "' '" + fwd(echo) + "'" : "& '" + process.execPath + "' '" + echo + "'");
  }).join('\n') + '\n';
  const r = spawnSync(exe, kind === 'sh' ? args : args.concat(Buffer.from(script, 'utf16le').toString('base64')),
    { input: kind === 'sh' ? script : undefined, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }) });
  if (r.error && r.error.code === 'ENOENT') continue;   // that shell is not installed here
  ran.push(exe);
  const lines = String(r.stdout || '').trim().split(/\r?\n/);
  tasks.forEach(([t, inPs], i) => {
    let got = null;
    try { got = JSON.parse(lines[i]); } catch (_) {}
    const wantTask = kind === 'sh' ? t : inPs;
    ok(Array.isArray(got) && got.join('\u0001') === ['--host', '10004', '--task', wantTask, '--control', '--serve', './work'].join('\u0001'),
       exe + ' hands the task over whole: ' + JSON.stringify(t) + ' -> ' + JSON.stringify(got) + (r.stderr ? ' (stderr: ' + String(r.stderr).trim().slice(0, 200) + ')' : ''));
  });
}
ok(ran.length >= 1 || process.env.CI !== 'true', 'in CI at least one shell ran the round trip');

// ---- node kit.js intake
const kit = (args, env) => spawnSync(process.execPath, [path.join(KIT, 'kit.js'), 'intake'].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
const j = kit(['connect', '10004', 'and', 'do', 'my', 'sticky', 'notes', '--json']);
let jo = null;
try { jo = JSON.parse(j.stdout); } catch (_) {}
ok(j.status === 0 && jo && jo.host === '10004' && jo.skill.slug === 'work-through-sticky-notes' && jo.needs.control === true && jo.task === 'do my sticky notes' &&
   /^node core\/agent-join\.js --host 10004 --task "do my sticky notes" --control --serve \.\/work$/.test(jo.command), 'kit.js intake --json: the reading plus the command, exit 0 (words unquoted are one request)');
const h = kit(['on machine 10002 solve the sudoku', '--sh']);
ok(h.status === 0 && /machine\s+10002/.test(h.stdout) && /skill\s+solve-a-sudoku -- Solve a sudoku/.test(h.stdout) && /run:\s+node skills\/solve-a-sudoku\/fast\.js \.\/work master/.test(h.stdout) &&
   /access\s+the keyboard and mouse \(--control\)/.test(h.stdout) && h.stdout.includes('node core/agent-join.js --host 10002 --task "solve the sudoku" --control --serve ./work'),
   'kit.js intake prints the machine, the skill and its run line, the access, and the command line');
const nm = kit(['research the capital of Peru']);
ok(nm.status === 1 && /machine\s+none understood/.test(nm.stdout) && /NNNNN/.test(nm.stdout), 'no machine: said plainly, the template holds NNNNN, exit 1');
const ns = kit(['connect 10004 and check the disk space']);
ok(ns.status === 0 && /skill\s+none -- the driver works it out/.test(ns.stdout) && /nothing beyond watching/.test(ns.stdout), 'no skill and no access: said plainly');
const ps = kit(['play 2048 on 10005', '--powershell']);
ok(/\(PowerShell; --sh for a POSIX shell\)/.test(ps.stdout), '--powershell names the shell it quoted for');
ok(kit([]).status === 2 && /in plain words/.test(kit([]).stderr), 'nothing asked: a usage line, exit 2');
const fx = kit(['fill in the form on 10004', '--json'], { SM_SKILLS_DIR: lib });
let fxo = null;
try { fxo = JSON.parse(fx.stdout); } catch (_) {}
ok(fxo && fxo.skill && fxo.skill.slug === 'fill-a-form' && fxo.skill.run === 'node skills/fill-a-form/fill-form.js ./work form.json', 'kit.js intake reads the library SM_SKILLS_DIR names');

console.log(ran.length ? '  the shell round trip ran in: ' + ran.join(', ') : '  no sh or PowerShell here: the shell round trip was skipped');
console.log((fail ? 'FAIL' : 'ok') + ' intake: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

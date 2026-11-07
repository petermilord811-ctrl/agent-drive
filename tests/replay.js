// replay.js — drive/replay.js: a job that worked once, run again with no driver turns -- or with other values.
// `save` turns a visit's mission.json + steps.jsonl into a recipe of PROVEN milestones, each piece of typed text a
// named value; `run` replays it, one `plan` per milestone, proving each before going on, `--set` typing another text
// for a value. A content-aware fake serve answers the commands (as in tests/run_recipe.js) so every exit path is
// exercised offline -- and, as a "screen", holds what was typed, so a replay with a new amount is proven only by a
// check that looks for the new amount.
//   node tests/replay.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawn } = require('child_process');
const REPLAY = path.join(__dirname, '..', 'drive', 'replay.js');
const { build, lastCheck, countSecrets, findValues, resolver } = require(REPLAY);
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
// a command line: its exit code and all it printed (stderr too, kept out of this test's own output)
const cli = (args, env) => {
  try { return { code: 0, out: execFileSync(node, [REPLAY].concat(args), { env: env || process.env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};

// ---- a finished visit: m1 achieved, m2 skipped, m3 achieved, m4 never finished, m5 achieved (after the gap)
const visit = path.join(tmp, 'visit');
fs.mkdirSync(visit);
fs.writeFileSync(path.join(visit, 'mission.json'), JSON.stringify({ goal: 'Sign in and open the report', done: 'the report is open', ms: [
  { id: 'm1', t: 'Open the site', done: 'the sign-in page', s: 'done', check: null, steps: [{ t: 'open the url', s: 'done' }] },
  { id: 'm2', t: 'Close the cookie banner', done: 'no banner', s: 'skipped', steps: [] },
  { id: 'm3', t: 'Sign in', done: 'the dashboard', s: 'done', check: { text: { has: 'Dashboard' } }, steps: [] },
  { id: 'm4', t: 'Open the report', done: 'the report', s: 'doing', steps: [] },
  { id: 'm5', t: 'Export it', done: 'a download', s: 'done', steps: [] }] }));
const L = (m, cmd) => JSON.stringify({ at: new Date().toISOString(), m, cmd });
fs.writeFileSync(path.join(visit, 'steps.jsonl'), [
  L('', { do: 'chord', mod: 'ControlLeft', code: 'KeyT' }),
  L('m1', { do: 'open', url: 'https://example.test/login' }),
  L('m1', { do: 'wait', until: { text: { has: 'Sign in' } } }),
  L('m2', { do: 'click', x: 900, y: 40 }),
  L('m3', { do: 'click', x: 400, y: 300 }),
  L('m3', { do: 'keys', text: 'pat@example.test' }),
  L('m3', { do: 'keys', text: '{{secret}}', secret: 1 }),
  L('m3', { do: 'press', code: 'Enter' }),
  L('m4', { do: 'click', x: 10, y: 10 }),
  L('m5', { do: 'click', x: 20, y: 20 }),
  'not json at all'].join('\n') + '\n');

const b = build(visit);
ok(b.ok, 'a proven visit builds (' + (b.why || '') + ')');
const ms = b.ok ? b.recipe.milestones : [];
ok(ms.length === 2 && ms[0].t === 'Open the site' && ms[1].t === 'Sign in', 'only what was proven IN ORDER is kept: m1, m3 (m2 skipped, m4 unfinished ends it, so m5 too)');
ok(ms[0] && ms[0].cmds[0].do === 'chord' && ms[0].cmds.length === 3, 'what was done before the plan leads the first milestone');
ok(ms[1] && !ms[1].cmds.some((c) => c.x === 900), 'a skipped milestone\'s commands are left out with it');
ok(b.stoppedAt && b.stoppedAt.t === 'Open the report', 'it says where the run stopped being proven');
ok(b.recipe && b.recipe.secrets === 1 && countSecrets(ms.map((m) => m.cmds)) === 1, 'the unrecorded secret is counted');
ok(JSON.stringify(b.typed) === '["pat@example.test"]', 'typed text that will be stored is listed for review');
ok(JSON.stringify(lastCheck(ms[0] ? ms[0].cmds : [])) === '{"text":{"has":"Sign in"}}' && lastCheck([{ do: 'click' }]) === null, 'the last check the run made in a milestone is found');
ok(!build(path.join(tmp, 'nowhere')).ok, 'no mission.json -> a clear refusal');
ok(b.recipe && b.recipe.v === 2 && JSON.stringify(b.recipe.values.map((v) => v.name)) === '["url","email"]' && ms[0].cmds[1].url === '{{url}}' && ms[1].cmds[1].text === '{{email}}' &&
   ms[1].cmds[2].text === '{{secret}}', 'what it typed became values -- the URL it opened, the address it typed -- and the commands carry {{name}}; the secret stays {{secret}}');

// ---- save: a skill folder with the recipe and a README kit.js can list
const skills = path.join(tmp, 'skills');
const env = Object.assign({}, process.env, { SM_SKILLS_DIR: skills });
let out = execFileSync(node, [REPLAY, 'save', visit, 'sign-in-report'], { env, encoding: 'utf8' });
const recipeFile = path.join(skills, 'sign-in-report', 'replay.json');
ok(fs.existsSync(recipeFile) && /saved 2 proven milestone/.test(out), 'save writes skills/<name>/replay.json');
const readme = fs.readFileSync(path.join(skills, 'sign-in-report', 'README.md'), 'utf8');
ok(/^---\nname: sign-in-report\nwhen: .+\ntags: replay, mission\nrun: node drive\/replay\.js run skills\/sign-in-report\/replay\.json/.test(readme), '...and a README with the frontmatter kit.js reads');
let bad = 0; try { execFileSync(node, [REPLAY, 'save', visit, 'Bad Name'], { env, stdio: 'ignore' }); } catch (e) { bad = e.status; }
ok(bad === 2, 'a bad skill name is refused (exit 2)');

// ---- a stand-in serve: it answers each command dropped in its folder and keeps every one in _frames.ndjson. By
// content: FAILSTEP in a plan fails it, FAILPROOF fails an achieve. As a 'screen' it is a page instead -- what is
// typed or opened lands on it, and a check, a wait, a find or a clickText holds only for text that is on it.
function fakeServe() {
  const fs = require('fs'), path = require('path');
  const dir = process.argv[2], mode = process.argv[3] || '';
  const cmdFile = path.join(dir, 'cmd.json'), doneFile = path.join(dir, 'done.json'), frames = path.join(dir, '_frames.ndjson');
  const PAGE = 'Invoices: Page 1 of 3';
  let screen = PAGE;
  const squash = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  const holds = (p) => (Array.isArray(p) ? p : [p]).every((x) => {
    const n = Object.keys(x || {})[0], a = (x || {})[n] || {}, on = squash(screen).indexOf(squash(a.has)) >= 0;
    return n === 'text' ? on : n === 'notext' ? !on : true;
  });
  // one step on the page: what it types lands there, what it reads must be there (null: it went fine)
  const act = (s) => {
    if (!s || typeof s !== 'object') return null;
    if (s.do === 'keys' && typeof s.text === 'string') screen += ' ' + s.text;
    else if (s.do === 'open' && typeof s.url === 'string') screen += ' ' + s.url;
    else if ((s.do === 'clickText' || s.do === 'find') && !holds({ text: { has: s.text } })) return 'no word like "' + s.text + '" on the page';
    else if ((s.do === 'wait' || s.do === 'expect') && s.until && !holds(s.until)) return 'it never became true';
    else if (s.do === 'plan') for (const x of s.steps || []) { const w = act(x); if (w) return w; }
    return null;
  };
  const answer = (c, raw) => {
    if (mode === 'screen') {
      if (c.do === 'mission' && c.op === 'plan') { screen = PAGE; return { ok: true }; }
      if (c.do === 'mission' && c.op === 'achieve') return !c.check || holds(c.check) ? { ok: true } : { ok: false, why: 'the check did not hold' };
      if (c.do === 'plan') { const st = c.steps || []; for (let i = 0; i < st.length; i++) { const w = act(st[i]); if (w) return { ok: false, why: w, stoppedAt: { at: i, why: w } }; } }
      return { ok: true };
    }
    if (c.do === 'plan' && raw.indexOf('FAILSTEP') >= 0) return { ok: false, why: 'forced', stoppedAt: { at: 1, why: 'forced' } };
    if (c.do === 'mission' && c.op === 'achieve' && raw.indexOf('FAILPROOF') >= 0) return { ok: false, why: 'the check did not hold' };
    return { ok: true };
  };
  setInterval(() => {
    try {
      if (!fs.existsSync(cmdFile) || fs.existsSync(doneFile)) return;
      let raw = '', c = null;
      try { raw = fs.readFileSync(cmdFile, 'utf8'); c = JSON.parse(raw); fs.unlinkSync(cmdFile); } catch (_) { return; }
      fs.appendFileSync(frames, JSON.stringify(c) + '\n');
      fs.writeFileSync(doneFile, JSON.stringify(answer(c, raw)));
    } catch (_) {}
  }, 8);
}
const FAKE = path.join(tmp, '_fake.js');
fs.writeFileSync(FAKE, '(' + fakeServe.toString() + ')();\n');
const serveDir = path.join(tmp, 'serve'), screenDir = path.join(tmp, 'screen');
fs.mkdirSync(serveDir);
fs.mkdirSync(screenDir);
const fake = spawn(node, [FAKE, serveDir], { stdio: 'ignore' });
const page = spawn(node, [FAKE, screenDir, 'screen'], { stdio: 'ignore' });
const runReplay = (recipe, extra, dir) => cli(['run', recipe, dir || serveDir].concat(extra || []));
const frames = (dir) => { try { return fs.readFileSync(path.join(dir || serveDir, '_frames.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (_) { return []; } };
const reset = (dir) => { try { fs.unlinkSync(path.join(dir || serveDir, '_frames.ndjson')); } catch (_) {} };

try {
  let r = runReplay(recipeFile);
  ok(r.code === 3 && /secret/.test(r.out), 'a recipe with an unrecorded secret will not start without --secret (exit 3)');

  reset();
  r = runReplay(recipeFile, ['--secret', 'hunter2']);
  const f = frames();
  ok(r.code === 0, 'the replay runs to the end (exit ' + r.code + ': ' + r.out.trim().split('\n').pop() + ')');
  ok(f[0] && f[0].do === 'mission' && f[0].op === 'plan' && f[0].plan.milestones.length === 2, 'it posts the plan first');
  const plans = f.filter((c) => c.do === 'plan');
  ok(plans.length === 2 && plans[1].steps.some((s) => s.text === 'hunter2'), 'one plan per milestone, with the secret filled in');
  ok(plans.length === 2 && plans[0].steps[1].url === 'https://example.test/login' && plans[1].steps[1].text === 'pat@example.test', '...and every value as recorded when none is set');
  const ach = f.filter((c) => c.do === 'mission' && c.op === 'achieve');
  ok(ach.length === 2 && JSON.stringify(ach[0].check) === '{"text":{"has":"Sign in"}}' && JSON.stringify(ach[1].check) === '{"text":{"has":"Dashboard"}}',
     'each milestone is proven: by the run\'s own last check, or its milestone check');
  ok(f[f.length - 1].do === 'mission' && f[f.length - 1].op === 'finish', 'and the job is finished');

  // a milestone without any check is proven by a picture shown to the room
  const noCheck = JSON.parse(fs.readFileSync(recipeFile, 'utf8'));
  noCheck.milestones = [{ t: 'Look at it', done: 'it is there', check: null, steps: [], cmds: [{ do: 'click', x: 1, y: 1 }] }];
  noCheck.secrets = 0;
  const f2 = path.join(tmp, 'nocheck.json'); fs.writeFileSync(f2, JSON.stringify(noCheck));
  reset(); r = runReplay(f2);
  const g = frames();
  ok(r.code === 0 && g.some((c) => c.do === 'look') && g.some((c) => c.do === 'mission' && c.op === 'achieve' && /replay-proof-1\.png$/.test(c.file || '')), 'no check at all -> a picture is the proof');

  // failures: the actions, then the proof
  const failing = JSON.parse(JSON.stringify(noCheck));
  failing.milestones[0].cmds = [{ do: 'keys', text: 'FAILSTEP' }];
  fs.writeFileSync(f2, JSON.stringify(failing)); reset(); r = runReplay(f2);
  ok(r.code === 4 && /actions failed at step 2/.test(r.out) && frames().some((c) => c.do === 'mission' && c.op === 'fail'), 'failed actions stop it (exit 4) and fail the milestone out loud');
  const unproven = JSON.parse(JSON.stringify(noCheck));
  unproven.milestones[0].check = { text: { has: 'FAILPROOF' } };
  fs.writeFileSync(f2, JSON.stringify(unproven)); reset(); r = runReplay(f2);
  ok(r.code === 5 && /not proven/.test(r.out), 'a proof that does not hold stops it (exit 5)');
  r = runReplay(path.join(tmp, 'missing.json'));
  ok(r.code === 2, 'a missing recipe is exit 2');
  ok(frames().some((c) => c.do === 'mission' && c.op === 'plan' && c.replay === 1), 'a replay says it is one (replay:1), so the serve never drafts a skill from it');

  // ---- VALUES: the same payment again, for another invoice, amount and date -----------------------------------------
  const pay = path.join(tmp, 'pay');
  fs.mkdirSync(pay);
  fs.writeFileSync(path.join(pay, 'mission.json'), JSON.stringify({ goal: 'Record the payment for INV-0042', done: 'the payment is recorded', ms: [
    { id: 'm1', t: 'Open the invoices page', done: 'the list of invoices', s: 'done', steps: [] },
    { id: 'm2', t: 'Find the invoice number', done: 'its payment page', s: 'done', steps: [] },
    { id: 'm3', t: 'Enter the amount and date', done: 'the form is filled', s: 'done', check: { text: { has: '42.50' } }, steps: [] },
    { id: 'm4', t: 'Add a note', done: 'the note is saved', s: 'done', check: [{ text: { has: 'Paid on 2026-11-06' } }, { notext: { has: 'Error' } }], steps: [] }] }));
  fs.writeFileSync(path.join(pay, 'steps.jsonl'), [
    L('m1', { do: 'open', url: 'https://example.test/invoices' }),
    L('m1', { do: 'wait', until: { text: { has: 'Page 1 of 3' } } }),
    L('m2', { do: 'click', x: 400, y: 120 }),
    L('m2', { do: 'keys', text: 'INV-0042' }),
    L('m2', { do: 'press', code: 'Enter' }),
    L('m2', { do: 'clickText', text: 'inv-0042' }),
    L('m2', { do: 'open', url: 'https://example.test/invoices/INV-0042/pay' }),
    L('m3', { do: 'keys', text: '42.50' }),
    L('m3', { do: 'press', code: 'Tab' }),
    L('m3', { do: 'keys', text: '2026-11-06' }),
    L('m3', { do: 'keys', text: '1' }),
    L('m3', { do: 'keys', text: ' ' }),
    L('m4', { do: 'plan', steps: [{ do: 'click', x: 10, y: 400 }, { do: 'keys', text: 'Paid on 2026-11-06 by card' }, { do: 'exec', cmd: 'type C:\\Reports\\INV-0042.txt' }] }),
    L('m4', { do: 'keys', text: '{{secret}}', secret: 1 }),
    L('m4', { do: 'keys', text: '2026-11-06' }),
    L('m4', { do: 'find', text: 'by card' }),
    L('m4', { do: 'wait', until: { text: { has: 'PAID ON 2026-11-06  BY CARD' } } })].join('\n') + '\n');
  const pb = build(pay);
  const pv = pb.ok ? pb.recipe.values : [], pm = pb.ok ? pb.recipe.milestones : [];
  const V = (n) => pv.find((v) => v.name === n) || {};
  ok(JSON.stringify(pv.map((v) => v.name)) === '["url","invoice","url2","amount","date","number","note"]', 'each piece of typed text is a value, named by what and where it is (' + pv.map((v) => v.name).join(', ') + ')');
  ok(V('amount').default === '42.50' && V('amount').kind === 'number' && V('amount').where === 'milestone 3: typed' && V('date').kind === 'date' && V('url').kind === 'url' && V('note').kind === 'text',
     '...the original its default, with its kind and where it was typed');
  ok(V('invoice').default === 'INV-0042' && V('note').default === 'Paid on 2026-11-06 by card', 'a plain text is named by the milestone that typed it ("Find the invoice number" -> invoice, "Add a note" -> note)');
  ok(V('date').where === 'milestone 3: typed; milestone 4: inside typed text (note), typed', 'the same text typed twice is ONE value, and `where` names every place');
  ok(pm.length === 4 && pm[0].cmds[0].url === '{{url}}' && pm[1].cmds[1].text === '{{invoice}}' && pm[1].cmds[4].url === '{{url2}}' && pm[2].cmds[0].text === '{{amount}}' && pm[3].cmds[0].steps[1].text === '{{note}}',
     'the commands carry {{name}} -- inside a recorded plan too');
  ok(V('note').template === 'Paid on {{date}} by card' && V('url2').template === '{{url}}/{{invoice}}/pay' && V('invoice').where === 'milestone 2: typed, text it clicked, inside the URL it opened (url2)',
     'a value typed inside a longer text: that text keeps its original as the default, and a template says where the value is');
  ok(pm.length === 4 && pm[3].cmds[1].text === '{{secret}}' && pm[3].cmds[1].secret === 1 && pb.recipe.secrets === 1 && !pv.some((v) => /secret/.test(v.name + v.default)), 'a secret stays a secret: {{secret}}, never a value, never a default');
  ok(pm.length === 4 && pm[3].cmds[0].steps[2].cmd === 'type C:\\Reports\\INV-0042.txt', 'what exec is given is not parameterised, though it holds the invoice');
  ok(pm.length === 4 && JSON.stringify(pm[2].check) === '{"text":{"has":"{{amount}}"}}' && V('amount').checks === 'milestone 3: its check', 'PROOF FOLLOWS THE VALUE: the check that read 42.50 reads {{amount}}, and the recipe says so');
  ok(pm.length === 4 && JSON.stringify(pm[3].check) === '[{"text":{"has":"Paid on {{date}}"}},{"notext":{"has":"Error"}}]' && V('date').checks === 'milestone 4: its check', '...inside a longer check too, and only where the value is');
  ok(pm.length === 4 && pm[3].cmds[4].until.text.has === '{{note}}' && V('note').checks === 'milestone 4: a check it made', '...a check the job made on the way, matched as the serve reads (case, runs of spaces)');
  ok(pm.length === 4 && pm[1].cmds[3].text === '{{invoice}}', '...and a word read to act on: a replay clicks the NEW invoice, not the old one still on the list');
  ok(pm.length === 4 && pm[0].cmds[1].until.text.has === 'Page 1 of 3' && !V('number').checks, 'a short value is not found inside a longer check ("1" is not in "Page 1 of 3")');
  ok(pm.length === 4 && pm[3].cmds[3].text === 'by card' && /kept as recorded/.test(V('note').note || '') && /milestone 4: text it looked for/.test(V('note').note || ''),
     'a word that reads only PART of a value is kept as recorded -- and the recipe warns');
  ok(pm.length === 4 && pm[2].cmds[4].text === ' ' && !pv.some((v) => v.default === ' '), 'a keystroke typed as text (" ") is not a value');
  ok(JSON.stringify(pb.typed) === JSON.stringify(['INV-0042', '42.50', '2026-11-06', '1', ' ', 'Paid on 2026-11-06 by card', '2026-11-06']), 'the typed text listed for review is what a replay with no --set types');
  {
    // a plan's steps are recorded as the driver sent them, slips and all: they get their real names first
    const al = path.join(tmp, 'aliases');
    fs.mkdirSync(al);
    fs.writeFileSync(path.join(al, 'mission.json'), JSON.stringify({ goal: 'Open the Q3 report', ms: [{ id: 'm1', t: 'Find the report', done: 'it is open', s: 'done', steps: [] }] }));
    fs.writeFileSync(path.join(al, 'steps.jsonl'), L('m1', { do: 'plan', steps: [{ do: 'type', chars: 'Q3 report' }, { do: 'press', code: 'Enter' }, { do: 'clicktext', text: 'q3 report' },
      { do: 'activate', title: 'Q3 report - Notes' }] }) + '\n');
    const ab = build(al), st = ab.ok ? ab.recipe.milestones[0].cmds[0].steps : [];
    ok(JSON.stringify(st) === JSON.stringify([{ do: 'keys', text: '{{text1}}' }, { do: 'press', code: 'Enter' }, { do: 'clickText', text: '{{text1}}' }, { do: 'focus', title: '{{text1}} - Notes' }]) &&
       ab.recipe.values[0].where === 'milestone 1: typed, text it clicked, the window it brought forward' && !/__vetted/.test(JSON.stringify(ab.recipe)),
       'a recorded plan\'s slips ("type", "clicktext", "activate") get their real names: its typed text is a value, and the word it clicks and the window it brings forward follow it');
  }
  {
    // names: by shape, by the milestone's title, never two the same, never a {{word}} the text already holds
    const ms2 = [{ t: 'Type the customer name', cmds: [{ do: 'keys', text: 'Pat Example' }] },
      { t: 'Fill the form', cmds: ['+1 555 010 0100', 'C:\\Users\\pat\\q3.xlsx', 'C:\\Users\\pat', '09:30', 'Nov 6, 2026', '$5', 'pat@example.com', 'see report.pdf', '6.11.2026', '3.14159',
        'Dear {{date}},', '2026-11-06'].map((t) => ({ do: 'keys', text: t })) }, { t: 'Enter the invoice total', cmds: [{ do: 'keys', text: '99.95' }] }];
    const v2 = findValues(ms2);
    const names = v2.map((v) => v.name).join(',');
    ok(names === 'customer_name,phone,file,folder,time,date2,amount,email,text1,date3,number,text2,date4,invoice_total', 'names say what was typed, and where: ' + names);
    ok(JSON.stringify(v2.map((v) => v.kind)) === JSON.stringify(['text', 'text', 'path', 'path', 'date', 'date', 'number', 'text', 'text', 'date', 'number', 'text', 'date', 'number']), '...and each has a kind');
    const r2 = resolver(v2, new Map([['date4', '2026-12-01'], ['folder', 'D:\\Archive']]));
    ok(r2.render(ms2[1].cmds[10].text) === 'Dear {{date}},' && r2.render(ms2[1].cmds[11].text) === '2026-12-01' && r2.render(ms2[1].cmds[1].text) === 'D:\\Archive\\q3.xlsx',
       'a {{word}} the job typed is typed as it was (no value takes its name); a set value goes in ONE pass; a path follows the folder typed in it');
    ok(resolver(v2, new Map([['text1', 'see {{date4}} and {{secret}}']])).render('{{text1}} / {{date4}}') === 'see {{date4}} and {{secret}} / 2026-11-06',
       '...what --set gives is typed exactly as given: a {{name}} in it -- even a value\'s, even {{secret}} -- is never filled');
    // where a value is NOT: inside a word, inside a number, a short one inside a longer check or a word to click
    const ms3 = [{ t: 'x', check: [{ text: { has: 'Saved' } }, { text: { has: 'Save complete' } }, { text: { has: '7' } }, { text: { has: 'Page 7' } }],
      cmds: [{ do: 'keys', text: 'Save' }, { do: 'keys', text: '100' }, { do: 'keys', text: 'Order 100.50 paid' }, { do: 'keys', text: '7' }, { do: 'clickText', text: '7' }] }];
    const v3 = findValues(ms3), c3 = ms3[0].check;
    ok(c3[0].text.has === 'Saved' && c3[1].text.has === '{{text1}} complete' && c3[2].text.has === '{{number2}}' && c3[3].text.has === 'Page 7',
       'a check follows a value only where it reads it: not inside a word ("Save" in "Saved"), a short one only as the whole text');
    ok(!(v3.find((v) => v.default === 'Order 100.50 paid') || {}).template && ms3[0].cmds[4].text === '7', 'not inside a number ("100" in "100.50"); a word to click only for 3 characters or more');
    let threw = false, v4 = null;
    try { v4 = findValues([null, 5, { cmds: [null, 7, 'x', { do: 'keys', text: 42 }, { do: 'open' }, { do: 'wait', until: 'nope' }, { if: [null], then: 'x' }], check: [null, { text: null }, { notext: { has: 5 } }] }, { t: {}, cmds: 'no' }]); } catch (e) { threw = e; }
    ok(!threw && Array.isArray(v4) && v4.length === 0 && findValues(null).length === 0, 'odd commands hold no values, and never throw (' + threw + ')');
  }

  // save + README + `values`
  let sv = cli(['save', pay, 'record-a-payment'], env);
  const payFile = path.join(skills, 'record-a-payment', 'replay.json'), payReadme = path.join(skills, 'record-a-payment', 'README.md');
  ok(sv.code === 0 && /7 value\(s\) a replay may type other text for/.test(sv.out) && /\n {4}amount = "42\.50" -- milestone 3: typed; its proof follows it: milestone 3: its check/.test(sv.out),
     'save prints the values beside the typed text');
  const pr = fs.existsSync(payReadme) ? fs.readFileSync(payReadme, 'utf8') : '';
  ok(/\nrun: node drive\/replay\.js run skills\/record-a-payment\/replay\.json <serve-dir> --secret <text> \[--set <name>=<text>\]\.\.\.\n/.test(pr) && /\n## Values\n/.test(pr) &&
     /\n- `amount` = `42\.50` \(number\) — milestone 3: typed; its proof follows it: milestone 3: its check\n/.test(pr) && /\n- `note` = `Paid on 2026-11-06 by card` \(text\) — milestone 4: typed;.* date is in it, so setting it changes it too/.test(pr),
     'the README lists the values: name, default, where -- and what follows them');
  let lv = cli(['values', payFile]);
  ok(lv.code === 0 && /7 value\(s\) a replay may change/.test(lv.out) && /\n {4}invoice = "INV-0042" \(text\) -- milestone 2: typed, text it clicked, inside the URL it opened \(url2\)\n/.test(lv.out) && /1 secret\(s\)/.test(lv.out),
     '`values` lists each value with its default and where it is');
  lv = cli(['values', payFile, '--json']);
  let lj = null; try { lj = JSON.parse(lv.out); } catch (_) {}
  ok(lj && lj.values.length === 7 && lj.values[3].name === 'amount' && lj.values[3].default === '42.50' && lj.secrets === 1, '...and with --json, for a caller');
  ok(cli(['values', path.join(tmp, 'missing.json')]).code === 2 && cli(['values', recipeFile, 'extra']).code === 2, '`values` of no recipe, or with a stray word, is exit 2');
  // saved again: the README is its author's, but its Values section is the new recipe's
  fs.writeFileSync(payReadme, '# Our own notes\n\nHow we record a payment.\n');
  cli(['save', pay, 'record-a-payment'], env);
  const t2 = fs.readFileSync(payReadme, 'utf8');
  ok(/^# Our own notes\n\nHow we record a payment\.\n\n<!-- values:begin -->\n## Values\n/.test(t2) && (t2.match(/values:begin/g) || []).length === 1, 'saved again: an author\'s README keeps its words, and gains the Values section');
  cli(['save', pay, 'record-a-payment'], env);
  ok(fs.readFileSync(payReadme, 'utf8') === t2, '...rewritten in place on the next save, never twice');

  // run, against the page: what is typed lands on it, and a check holds only for text that is there
  const typedOf = (fr) => { const t = []; const v = (c) => { if (Array.isArray(c)) return c.forEach(v); if (!c || typeof c !== 'object') return; if (c.do === 'keys') t.push(c.text); if (c.do === 'open') t.push(c.url); if (c.steps) v(c.steps); }; fr.filter((c) => c.do === 'plan').forEach((c) => v(c.steps)); return t; };
  reset(screenDir); r = runReplay(payFile, ['--secret', 'hunter2'], screenDir);
  ok(r.code === 0 && JSON.stringify(typedOf(frames(screenDir))) === JSON.stringify(['https://example.test/invoices', 'INV-0042', 'https://example.test/invoices/INV-0042/pay', '42.50', '2026-11-06', '1', ' ', 'Paid on 2026-11-06 by card', 'hunter2', '2026-11-06']),
     'no --set: the replay types exactly what the job typed, and is proven (exit ' + r.code + ': ' + r.out.trim().split('\n').pop() + ')');
  reset(screenDir); r = runReplay(payFile, ['--secret', 'hunter2', '--set', 'invoice=INV-0043', '--set', 'amount=99.00', '--set', 'date=2026-12-01'], screenDir);
  const pf = frames(screenDir);
  ok(r.code === 0 && JSON.stringify(typedOf(pf)) === JSON.stringify(['https://example.test/invoices', 'INV-0043', 'https://example.test/invoices/INV-0043/pay', '99.00', '2026-12-01', '1', ' ', 'Paid on 2026-12-01 by card', 'hunter2', '2026-12-01']),
     'run --set: the new invoice, amount and date are typed -- inside the URL and the sentence too (exit ' + r.code + ': ' + r.out.trim().split('\n').pop() + ')');
  ok(JSON.stringify(pf.filter((c) => c.do === 'mission' && c.op === 'achieve').map((c) => c.check || null)) ===
     JSON.stringify([{ text: { has: 'Page 1 of 3' } }, null, { text: { has: '99.00' } }, [{ text: { has: 'Paid on 2026-12-01' } }, { notext: { has: 'Error' } }]]),
     'every milestone is proven by a check that looks for the NEW text');
  const pp = pf.find((c) => c.do === 'mission' && c.op === 'plan') || { plan: { milestones: [] } };
  ok(pp.plan.goal === 'Record the payment for INV-0042' && JSON.stringify((pp.plan.milestones[2] || {}).check) === '{"text":{"has":"99.00"}}' && /other values for invoice, amount, date/.test(pp.why || '') &&
     /with invoice, amount, date set/.test(r.out), 'the plan it posts carries the new checks and names what was set; the goal is as the room was told it');
  const ps = pf.filter((c) => c.do === 'plan');
  ok(ps.length === 4 && ps[1].steps[3].text === 'INV-0043' && ps[3].steps[0].steps[2].cmd === 'type C:\\Reports\\INV-0042.txt' && ps[3].steps[4].until.text.has === 'Paid on 2026-12-01 by card',
     'a word read to act on and a check on the way follow the value; what exec is given does not');
  const stale = JSON.parse(fs.readFileSync(payFile, 'utf8'));
  stale.milestones[2].check = { text: { has: '42.50' } };
  const staleFile = path.join(tmp, 'stale.json'); fs.writeFileSync(staleFile, JSON.stringify(stale));
  reset(screenDir); r = runReplay(staleFile, ['--secret', 'hunter2', '--set', 'amount=99.00'], screenDir);
  ok(r.code === 5 && /Enter the amount and date: not proven/.test(r.out), 'a check left reading the OLD amount fails a replay with a new one (exit 5) -- why the check carries {{amount}}');
  reset(screenDir); r = runReplay(payFile, ['--secret', 'hunter2', '--set', 'note=Paid in cash'], screenDir);
  ok(r.code === 4 && /Add a note: its actions failed/.test(r.out), 'the word that reads only part of the note stays as recorded, so a new note is not found there (exit 4) -- as the recipe warned');
  // refused before anything runs: a name the recipe has not got, a --set that is not name=text, a secret
  reset(screenDir); r = runReplay(payFile, ['--secret', 'hunter2', '--set', 'amout=99.00'], screenDir);
  ok(r.code === 2 && /no value named "amout" -- its values are url, invoice, url2, amount, date, number, note/.test(r.out) && /Nothing was run/.test(r.out) && frames(screenDir).length === 0,
     'a --set naming no value of the recipe is refused before anything runs, naming the real ones (exit 2)');
  reset(screenDir); r = runReplay(payFile, ['--secret', 'hunter2', '--ignore-unknown', '--set', 'machine=10004', '--set', 'file=C:\\in\\INV-0043.pdf', '--set', 'event=created', '--set', 'amount=99.00'], screenDir);
  ok(r.code === 0 && /not values of this recipe, so not used: machine, file, event/.test(r.out) && /, with amount set \(every other value as recorded\)/.test(r.out) && typedOf(frames(screenDir)).includes('99.00'),
     '--ignore-unknown: a trigger\'s facts the recipe does not use are skipped, the one it uses is typed');
  reset(screenDir);
  const refused = [['--set', 'amount'], ['--set', '=5'], ['--set', 'amount=1', '--set', 'amount=2'], ['--set', 'secret=hunter2'], ['--set']].map((x) => runReplay(payFile, ['--secret', 'hunter2'].concat(x), screenDir));
  ok(refused.every((x) => x.code === 2) && /given twice/.test(refused[2].out) && /--secret <text>, and never stored/.test(refused[3].out) && frames(screenDir).length === 0,
     'a --set that is not name=text, one given twice, or a "secret" is refused (exit 2)');
  const twice = JSON.parse(fs.readFileSync(payFile, 'utf8'));
  twice.values.push({ name: 'url', default: 'https://example.test/' });
  fs.writeFileSync(f2, JSON.stringify(twice));
  ok(runReplay(f2, ['--secret', 'hunter2'], screenDir).code === 2 && cli(['values', f2]).code === 2, 'a recipe whose values name one twice is refused (exit 2)');
  // a run fills a value only where a value can be -- even a hand-written {{file}} in what exec, launch, fetch or send
  // is given stays as written: a value from outside (a trigger's file) is never a command to run or a file to take
  const hand = { kind: 'mission-replay', v: 2, goal: 'Hand-written', secrets: 0, values: [{ name: 'file', default: 'C:\\in\\a.pdf', kind: 'path', where: 'milestone 1: typed' }],
    milestones: [{ t: 'Do it', done: 'it is done', check: { text: { has: '{{file}}' } }, steps: [], cmds: [{ do: 'keys', text: '{{file}}' }, { do: 'plan', steps: [{ do: 'exec', cmd: 'type {{file}}' },
      { do: 'launch', app: '{{file}}' }, { do: 'fetch', path: '{{file}}', out: 'x.pdf' }, { do: 'send', file: '{{file}}', to: 'C:\\out' }, { do: 'focus', title: '{{file}}' },
      { do: 'click', x: 1, y: 1, expect: { text: { has: '{{file}}' } } }] }] }] };
  const handFile = path.join(tmp, 'hand.json'); fs.writeFileSync(handFile, JSON.stringify(hand));
  reset(); r = runReplay(handFile, ['--set', 'file=C:\\in\\b.pdf']);
  const hf = frames(), hp = hf.filter((c) => c.do === 'plan'), inner = hp[0] && hp[0].steps[1] ? hp[0].steps[1].steps : [];
  const hc = (hf.find((c) => c.do === 'mission' && c.op === 'achieve') || {}).check || {};
  ok(r.code === 0 && hp[0].steps[0].text === 'C:\\in\\b.pdf' && inner.length === 6 && inner[4].title === 'C:\\in\\b.pdf' && inner[5].expect.text.has === 'C:\\in\\b.pdf' && (hc.text || {}).has === 'C:\\in\\b.pdf' &&
     inner[0].cmd === 'type {{file}}' && inner[1].app === '{{file}}' && inner[2].path === '{{file}}' && inner[3].file === '{{file}}',
     'a run fills a value in typed text, a window or word it reads and a check -- never in what exec, launch, fetch or send is given');
  // a recipe saved before values: run exactly as before
  const old = { kind: 'mission-replay', v: 1, goal: 'Type a total', secrets: 0, milestones: [{ t: 'Type it', done: 'it is typed', check: null, steps: [], cmds: [{ do: 'keys', text: 'Total {{amount}}' }] }] };
  const oldFile = path.join(tmp, 'old.json'); fs.writeFileSync(oldFile, JSON.stringify(old));
  reset(); r = runReplay(oldFile);
  ok(r.code === 0 && frames().some((c) => c.do === 'plan' && c.steps[0].text === 'Total {{amount}}'), 'a recipe saved before values runs exactly as before: its text typed as recorded');
  r = runReplay(oldFile, ['--set', 'amount=5']);
  ok(r.code === 2 && /it has no values \(it was saved before recipes had them/.test(r.out), '...a --set for it is refused, saying why');
  reset(); r = runReplay(oldFile, ['--ignore-unknown', '--set', 'amount=5']);
  ok(r.code === 0 && frames().some((c) => c.do === 'plan' && c.steps[0].text === 'Total {{amount}}'), '...or, with --ignore-unknown, skipped: it runs as recorded');
  lv = cli(['values', oldFile]);
  ok(lv.code === 0 && /has no values -- it was saved before recipes had them/.test(lv.out), '`values` says an old recipe has none');

  // ---- DRAFTS: the skill a proven job writes itself (the serve calls draft() at mission finish)
  {
    const { draft, slugOf } = require(REPLAY);
    process.env.SM_SKILLS_DIR = skills;
    ok(slugOf('Sign in and open the report!') === 'sign-in-and-open-the-report' && slugOf('Fill in the Ünïcode form') === 'fill-in-the-unicode-form' &&
       slugOf('a b c d e f g h') === 'a-b-c-d-e-f' && slugOf('???') === 'a-proven-job', 'a job\'s goal becomes a skill name: lowercase words, at most six');
    const d = draft(visit);
    const ddir = path.join(skills, '_drafts', 'sign-in-and-open-the-report');
    ok(d.ok && d.name === 'sign-in-and-open-the-report' && d.dir === ddir && d.milestones === 2 && fs.existsSync(path.join(ddir, 'replay.json')),
       'a proven job is drafted into skills/_drafts/<name>/ (' + JSON.stringify([d.ok, d.name, d.why]) + ')');
    const rd = fs.readFileSync(path.join(ddir, 'README.md'), 'utf8');
    ok(/^---\nname: sign-in-and-open-the-report\nwhen: /.test(rd) && /Draft — written by the agent/.test(rd) && /Typed text it stores: `pat@example\.test` — and 1 secret\(s\), never recorded/.test(rd),
       'its README says it is a draft, and lists the typed text it stores for whoever reviews it');
    ok(/\n## Values\n/.test(rd) && /\n- `url` = `https:\/\/example\.test\/login` \(url\) — milestone 1: the URL it opened\n- `email` = `pat@example\.test` \(text\) — milestone 2: typed\n/.test(rd),
       '...and the values a replay may change: name, default, where');
    ok(JSON.stringify(d.typed) === '["pat@example.test"]' && d.secrets === 1, '...and so does the answer the serve gets');
    ok(JSON.stringify((d.values || []).map((v) => [v.name, v.default, v.where])) === '[["url","https://example.test/login","milestone 1: the URL it opened"],["email","pat@example.test","milestone 2: typed"]]',
       '...the values too');
    const d2 = draft(visit);
    ok(d2.ok && d2.name === 'sign-in-and-open-the-report-2', 'a second draft of the same job does not overwrite the first');
    const named = draft(visit, { name: 'sign-in-report' });
    ok(!named.ok && named.exists, 'a job the library already has a skill for is not drafted');
    ok(!draft(path.join(tmp, 'nowhere')).ok, 'nothing proven -> no draft, and no throw');
    // promote: nothing moves without --yes; then it joins the library, its draft note gone
    let po = execFileSync(node, [REPLAY, 'promote', 'sign-in-and-open-the-report'], { env, encoding: 'utf8' });
    ok(/stores this typed text:\n {4}"pat@example\.test"/.test(po) && /nothing moved/.test(po) && fs.existsSync(ddir), 'promote shows the typed text and moves nothing without --yes');
    ok(/a replay may type other text for these values \(--set <name>=<text>\):\n {4}url = "https:\/\/example\.test\/login" -- milestone 1: the URL it opened\n {4}email = "pat@example\.test" -- milestone 2: typed\n/.test(po),
       '...and, beside it, the values a replay may change');
    po = execFileSync(node, [REPLAY, 'promote', 'sign-in-and-open-the-report', '--yes'], { env, encoding: 'utf8' });
    const lib = path.join(skills, 'sign-in-and-open-the-report');
    const lr = fs.existsSync(path.join(lib, 'README.md')) ? fs.readFileSync(path.join(lib, 'README.md'), 'utf8') : '';
    ok(/is in the library/.test(po) && !fs.existsSync(ddir) && fs.existsSync(path.join(lib, 'replay.json')) && !/Draft — written|draft:begin/.test(lr) && /^---\nname: sign-in-and-open-the-report/.test(lr),
       'with --yes the draft joins the library, its draft note taken out');
    ok(/\n## Values\n/.test(lr), '...its values still listed');
    let pc = 0; try { execFileSync(node, [REPLAY, 'promote', 'no-such-draft', '--yes'], { env, stdio: 'ignore' }); } catch (e) { pc = e.status; }
    ok(pc === 2, 'promoting a draft that is not there is exit 2');
  }
} finally {
  try { fake.kill(); } catch (_) {}
  try { page.kill(); } catch (_) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}

console.log((fail ? 'FAIL' : 'ok') + ' replay: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

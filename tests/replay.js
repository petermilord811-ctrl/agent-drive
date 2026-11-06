// replay.js — drive/replay.js: a job that worked once, run again with no driver turns.
// `save` turns a visit's mission.json + steps.jsonl into a recipe of PROVEN milestones; `run` replays it, one
// `plan` per milestone, proving each before going on. A content-aware fake serve answers the commands (as in
// tests/run_recipe.js) so every exit path is exercised offline.
//   node tests/replay.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawn } = require('child_process');
const REPLAY = path.join(__dirname, '..', 'drive', 'replay.js');
const { build, lastCheck, countSecrets } = require(REPLAY);
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

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

// ---- run, against a fake serve that answers by content (FAILSTEP in a plan fails it; FAILPROOF fails an achieve)
const serveDir = path.join(tmp, 'serve');
fs.mkdirSync(serveDir);
const FAKE = path.join(tmp, '_fake.js');
fs.writeFileSync(FAKE, [
  "const fs=require('fs'),path=require('path');",
  "const dir=process.argv[2],cmdFile=path.join(dir,'cmd.json'),doneFile=path.join(dir,'done.json'),frames=path.join(dir,'_frames.ndjson');let last=null;",
  "setInterval(()=>{try{",
  "  if(!fs.existsSync(cmdFile)||fs.existsSync(doneFile))return;",
  "  let raw='';try{raw=fs.readFileSync(cmdFile,'utf8');}catch(e){return;}if(!raw||raw===last)return;",
  "  let c={};try{c=JSON.parse(raw);}catch(e){return;} last=raw;",
  "  fs.appendFileSync(frames,JSON.stringify(c)+'\\n');",
  "  let res={ok:true};",
  "  if(c.do==='plan'&&raw.indexOf('FAILSTEP')>=0)res={ok:false,why:'forced',stoppedAt:{at:1,why:'forced'}};",
  "  else if(c.do==='mission'&&c.op==='achieve'&&raw.indexOf('FAILPROOF')>=0)res={ok:false,why:'the check did not hold'};",
  "  fs.writeFileSync(doneFile,JSON.stringify(res));",
  "}catch(e){}},8);"].join('\n'));
const fake = spawn(node, [FAKE, serveDir], { stdio: 'ignore' });
const runReplay = (recipe, extra) => { try { return { code: 0, out: execFileSync(node, [REPLAY, 'run', recipe, serveDir].concat(extra || []), { encoding: 'utf8', timeout: 60000 }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
const frames = () => { try { return fs.readFileSync(path.join(serveDir, '_frames.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (_) { return []; } };
const reset = () => { try { fs.unlinkSync(path.join(serveDir, '_frames.ndjson')); } catch (_) {} };

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
} finally {
  try { fake.kill(); } catch (_) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}

console.log((fail ? 'FAIL' : 'ok') + ' replay: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

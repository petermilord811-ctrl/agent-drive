#!/usr/bin/env node
// @tool plan the job as milestones and work it one by one: plan, step, achieve (with proof), add/change/split/skip/fail, finish
// @run  node drive/mission.js ./work plan '{"goal":"…","milestones":[{"t":"…","done":"what will be on the screen","steps":["…"]}]}'
// mission.js <work-dir> <op> [...] — the job's BIG PLAN (core/mission.js, the serve's `mission` verb) as one-liners.
//
//   plan '<json>' | @plan.json     the goal and its milestones, each {t, done, steps?, check?, skill?} -- posted to
//                                  the room, drawn on the panel, and the first milestone starts
//   step "<short step>"            begin a short step of the current milestone (one nobody planned is added)
//   steps '["…","…"]' [--m <ref>]  rewrite a milestone's short steps
//   achieve [<ref>] [--check '<json>'] [--file <crop.jpg>] [--note "<what it shows>"] [--timeout <ms>]
//                                  PROVE the milestone: its check (or --check) must hold on a fresh picture, or
//                                  --file is the picture of it (posted with the line). The next one then starts.
//   add "<milestone>" --done "<done-when>" [--before <ref> | --after <ref> | --now] [--steps '[…]'] [--check '<json>'] --why "…"
//   change <ref> [--to "<new name>"] [--done "…"] [--check '<json>'] [--steps '[…]'] --why "…"
//   split <ref> '[{"t":"…","done":"…"},…]' --why "…"
//   skip <ref> --why "…"          fail <ref> --why "…"
//   finish [--file <crop.jpg>] [--say "<report>"]   every milestone closed -> the report + the picture, panel green
//   show                           the plan as text, read from mission.json (no round trip -- works mid-command)
//   resume                         pick the saved plan up again after the serve restarted
//   drop --why "…"
//
// <ref> is a milestone's place in the plan ("3"), its id ("m3"), "current", "next", or (part of) its name.
// Prints the serve's answer as JSON and exits 1 when it says ok:false. Every answer carries `mission` (where the
// job stands: the current milestone, what proves it, the step) and, once, a `hint` when a milestone keeps
// missing. Add --quiet to keep a change out of the session chat (tests only: the room should see the plan move).
const fs = require('fs'), path = require('path');
const { exchange } = require('../core/cmd-file.js');
const OPS = ['plan', 'step', 'steps', 'achieve', 'add', 'change', 'split', 'skip', 'fail', 'finish', 'show', 'resume', 'drop'];
const die = (m) => { console.error('mission.js: ' + m); process.exit(2); };
const [dir, op, ...rest] = process.argv.slice(2);
if (!dir || !OPS.includes(op)) die('usage: node drive/mission.js <work-dir> ' + OPS.join('|') + ' [...] — see the header of this file');

const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--now' || a === '--quiet') { flags[a.slice(2)] = true; continue; }
  if (a.startsWith('--')) { if (i + 1 >= rest.length) die(a + ' needs a value'); flags[a.slice(2)] = rest[++i]; continue; }
  pos.push(a);
}
// JSON inline, or @file
const json = (s, what) => {
  if (s == null) return undefined;
  let t = String(s);
  if (t.startsWith('@')) { try { t = fs.readFileSync(t.slice(1), 'utf8'); } catch (e) { die('cannot read ' + t.slice(1) + ': ' + e.message); } }
  try { return JSON.parse(t); } catch (e) { return die('bad ' + what + ' json: ' + e.message); }
};
// the serve reads the picture, and its working folder need not be this one
const abs = (f) => path.resolve(String(f));

if (op === 'show') {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(path.join(dir, 'mission.json'), 'utf8')); } catch (e) { die('no plan in ' + dir + ' yet (' + e.message + ')'); }
  const M = require('../core/mission.js').create();
  const r = M.load(saved);
  if (!r.ok) die(r.why);
  console.log(M.text());
  process.exit(0);
}

const cmd = { do: 'mission', op };
if (flags.why != null) cmd.why = flags.why;
if (flags.quiet) cmd.quiet = 1;
switch (op) {
  case 'plan': if (!pos[0]) die('plan needs the plan: \'{"goal":"…","milestones":[…]}\' or @plan.json'); cmd.plan = json(pos[0], 'plan'); break;
  case 'step': cmd.t = pos[0] != null ? pos[0] : ''; break;
  case 'steps': if (!pos[0]) die('steps needs the list: \'["…","…"]\''); cmd.steps = json(pos[0], 'steps'); if (flags.m) cmd.m = flags.m; break;
  case 'achieve':
    if (pos[0]) cmd.m = pos[0];
    if (flags.check) cmd.check = json(flags.check, 'check');
    if (flags.file) cmd.file = abs(flags.file);
    if (flags.note) cmd.note = flags.note;
    if (flags.timeout) cmd.timeout = Number(flags.timeout);
    break;
  case 'add':
    if (!pos[0]) die('add needs the milestone\'s name');
    cmd.t = pos[0]; cmd.done = flags.done;
    if (flags.before) cmd.before = flags.before;
    if (flags.after) cmd.after = flags.after;
    if (flags.now) cmd.now = 1;
    if (flags.steps) cmd.steps = json(flags.steps, 'steps');
    if (flags.check) cmd.check = json(flags.check, 'check');
    if (flags.skill) cmd.skill = flags.skill;
    break;
  case 'change':
    if (!pos[0]) die('change needs the milestone (its number, id or name)');
    cmd.m = pos[0];
    if (flags.to) cmd.to = flags.to;
    if (flags.done) cmd.done = flags.done;
    if (flags.check) cmd.check = json(flags.check, 'check');
    if (flags.steps) cmd.steps = json(flags.steps, 'steps');
    break;
  case 'split': if (!pos[0] || !pos[1]) die('split needs the milestone and its parts: split 2 \'[{"t":"…","done":"…"},…]\''); cmd.m = pos[0]; cmd.into = json(pos[1], 'split'); break;
  case 'skip': case 'fail': if (!pos[0]) die(op + ' needs the milestone'); cmd.m = pos[0]; break;
  case 'finish': if (flags.file) cmd.file = abs(flags.file); if (flags.say) cmd.say = flags.say; break;
  case 'resume': if (pos[0]) cmd.file = abs(pos[0]); break;
  default: break;
}
let r;
try { r = exchange(dir, cmd); } catch (e) { die(e.message); }
process.stdout.write(JSON.stringify(r) + '\n');
process.exit(r && r.ok === false ? 1 : 0);

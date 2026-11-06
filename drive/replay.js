#!/usr/bin/env node
'use strict';
// @tool replay a PROVEN mission: save a job that worked as a recipe, run it again with no driver turns, proving each milestone
// @run  node drive/replay.js save <serve-dir> <skill-name>   then   node drive/replay.js run skills/<skill-name>/replay.json <serve-dir>
// replay.js -- A JOB THAT WORKED ONCE RUNS AGAIN WITHOUT ITS DRIVER.
//
// The slowest thing in a visit is not the machine, it is the driver deciding what to do next (87% of working time,
// a median of 46 s per decision). A job that has already been done -- planned as a mission, every milestone
// PROVEN -- does not need those decisions a second time: sudoku shows the payoff, 18 s as a routine against 5-9
// minutes driven by hand. The serve records every successful command with the milestone it worked on
// (<serve-dir>/steps.jsonl, next to mission.json); this turns that into a recipe and runs it back:
//
//   save   reads mission.json + steps.jsonl and writes skills/<name>/replay.json (+ a README so `node kit.js skills`
//          lists it). Only what was PROVEN is kept: milestones achieved in order; a skipped one is left out with its
//          commands; the first one that failed or never finished ends the recipe. A secret's text was never
//          recorded ({{secret}}) -- the run asks for it. The typed text that WILL be stored is printed for review.
//   run    posts the plan (the room sees it), then per milestone ONE `plan` of its commands -- one round trip --
//          and proves it: the milestone's own check, else the last check the original run made there, else a
//          picture shown to the room. Stops at the first milestone whose actions or proof fail, and says which.
//   promote <name> [--yes]   a DRAFT joins the library. The serve writes one itself -- skills/_drafts/<name>/,
//          gitignored -- when a planned job finishes with every milestone proven and no skill already did it
//          (draft(), below). It prints the typed text the draft stores; only with --yes is it moved to skills/<name>/.
//
// Exit codes: 0 every milestone achieved; 2 usage / a bad recipe; 3 could not start (no serve answering, the plan
// refused, a secret missing); 4 a milestone's actions failed; 5 a milestone's proof failed.
const fs = require('fs'), path = require('path');
const { exchange } = require('../core/cmd-file.js');
const KIT = path.join(__dirname, '..');
const SECRET = '{{secret}}';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function readSteps(dir) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(dir, 'steps.jsonl'), 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of txt.split(/\r?\n/)) { if (!line.trim()) continue; try { const o = JSON.parse(line); if (o && o.cmd && typeof o.cmd.do === 'string') out.push(o); } catch (_) {} }
  return out;
}
// every {{secret}} in a command (and the steps of a plan inside it), in order
const walk = (c, fn) => {
  if (Array.isArray(c)) return c.map((x) => walk(x, fn));
  if (!c || typeof c !== 'object') return fn(c);
  const o = {};
  for (const k of Object.keys(c)) o[k] = walk(c[k], fn);
  return o;
};
const countSecrets = (cmds) => { let n = 0; walk(cmds, (v) => { if (v === SECRET) n++; return v; }); return n; };
const typedTexts = (cmds) => { const t = []; walk(cmds, (v) => v); const visit = (c) => { if (Array.isArray(c)) return c.forEach(visit); if (!c || typeof c !== 'object') return; if (c.do === 'keys' && typeof c.text === 'string' && c.text !== SECRET) t.push(c.text); for (const k of ['steps', 'then', 'else']) if (c[k]) visit(c[k]); }; visit(cmds); return t; };
// the last machine check the original run made while this milestone was current -- proof the replay got there too
function lastCheck(cmds) {
  for (let i = cmds.length - 1; i >= 0; i--) {
    const c = cmds[i];
    if ((c.do === 'expect' || c.do === 'wait') && c.until && typeof c.until === 'object') return c.until;
  }
  return null;
}

// mission.json + steps.jsonl -> the recipe. Pure apart from reading the two files.
function build(dir) {
  let mj;
  try { mj = readJson(path.join(dir, 'mission.json')); } catch (e) { return { ok: false, why: 'no mission.json in ' + dir + ' -- only a job planned as a mission can be replayed (' + e.message + ')' }; }
  const ms = Array.isArray(mj.ms) ? mj.ms : [];
  const steps = readSteps(dir);
  const byM = new Map();
  for (const s of steps) { const k = String(s.m || ''); if (!byM.has(k)) byM.set(k, []); byM.get(k).push(s.cmd); }
  const milestones = [];
  let carry = byM.get('') || [];      // what was done before the plan existed (opening the app) leads the first milestone
  let stoppedAt = null;
  for (const m of ms) {
    const cmds = carry.concat(byM.get(m.id) || []);
    carry = [];
    if (m.s === 'skipped') continue;                        // left out, and its commands with it
    if (m.s !== 'done') { stoppedAt = { t: m.t, s: m.s || 'todo' }; break; }   // not proven: nothing after it is either
    milestones.push({ t: m.t, done: m.done, check: m.check || null, steps: (m.steps || []).map((x) => (x && typeof x === 'object' ? x.t : x)).filter(Boolean), cmds });
  }
  if (!milestones.length) return { ok: false, why: 'no milestone of that run was achieved in order -- nothing proven to replay' + (stoppedAt ? ' (the first, "' + stoppedAt.t + '", is ' + stoppedAt.s + ')' : '') };
  const all = milestones.reduce((a, m) => a.concat(m.cmds), []);
  return { ok: true, recipe: { kind: 'mission-replay', v: 1, goal: String(mj.goal || ''), done: String(mj.done || ''), saved: new Date().toISOString(),
                                from: path.basename(path.resolve(dir)), secrets: countSecrets(all), milestones },
           stoppedAt, typed: typedTexts(all), commands: all.length };
}

const skillsRoot = () => process.env.SM_SKILLS_DIR || path.join(KIT, 'skills');
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
// A DRAFT is marked between these lines in its README; promoting it takes them out.
const DRAFT_BEGIN = '<!-- draft:begin -->', DRAFT_END = '<!-- draft:end -->';

// THE SKILL FOLDER: replay.json, and a README the catalog lists (`node kit.js skills`). A draft -- written by the
// serve itself when a planned job finishes with every milestone proven -- says so at the top, with every piece of
// typed text it stores, for whoever reviews it before it joins the library.
function writeSkill(skillDir, name, b, draft) {
  fs.mkdirSync(skillDir, { recursive: true });
  const file = path.join(skillDir, 'replay.json');
  fs.writeFileSync(file, JSON.stringify(b.recipe, null, 1));
  const readme = path.join(skillDir, 'README.md');
  if (!fs.existsSync(readme)) {
    const r = b.recipe;
    const note = draft ? [DRAFT_BEGIN, '> **Draft — written by the agent** after a job it finished with every milestone proven (' + r.saved.slice(0, 10) + ').',
      '> It is not in the library until a person reviews it: check the typed text below holds nothing private, then',
      '> `node drive/replay.js promote ' + name + '` — and `node kit.js contribute "a skill to …"` to share it.',
      '>', '> Typed text it stores: ' + (b.typed.length ? b.typed.map((t) => '`' + String(t).slice(0, 60).replace(/`/g, "'") + '`').join(', ') : 'none') +
      (r.secrets ? ' — and ' + r.secrets + ' secret(s), never recorded' : ''), DRAFT_END, ''] : [];
    fs.writeFileSync(readme, ['---', 'name: ' + name, 'when: ' + (r.goal || name) + ' -- a proven run, replayed with no driver turns', 'tags: replay, mission',
      'run: node drive/replay.js run skills/' + name + '/replay.json <serve-dir>' + (r.secrets ? ' --secret <text>' + (r.secrets > 1 ? ' (×' + r.secrets + ')' : '') : ''), '---',
      '# skill: ' + name, ''].concat(note, ['A proven run of “' + r.goal + '”, saved by `drive/replay.js` on ' + r.saved.slice(0, 10) + ' from `' + r.from + '`.',
      'Replaying it posts the plan, runs each milestone\'s commands as one `plan`, and proves the milestone before going on.', '',
      '## Milestones', ''], r.milestones.map((m, i) => (i + 1) + '. ' + m.t + ' — done when ' + m.done + ' (' + m.cmds.length + ' commands)')).join('\n') + '\n');
  }
  return file;
}

// A job's goal as a skill's name: lowercase words joined by dashes, at most six of them.
function slugOf(goal) {
  const words = String(goal || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
  let s = words.join('-').slice(0, 60).replace(/-+$/, '');
  if (s.length < 2) s = 'a-proven-job';
  return SLUG.test(s) ? s : 'a-proven-job';
}

// A SKILL THAT WRITES ITSELF (the roadmap: "when a new task type is solved, write the skill folder automatically so
// the library grows without being asked"). Called by the serve when a planned job finishes; never throws. Written
// to skills/_drafts/<name>/ -- gitignored, and skipped by the catalog's checks -- because a recipe stores the text
// that was typed, and only a person can tell whether that is private. `promote` puts a reviewed draft in the library.
// Not drafted: a job that a skill already did, a replay of one, or a run with nothing proven to keep.
function draft(dir, opts) {
  try {
    const o = opts || {};
    const b = build(dir);
    if (!b.ok) return { ok: false, why: b.why };
    const name = o.name && SLUG.test(String(o.name)) ? String(o.name) : slugOf(b.recipe.goal);
    if (fs.existsSync(path.join(skillsRoot(), name))) return { ok: false, why: 'the library already has skills/' + name, exists: true };
    const drafts = path.join(skillsRoot(), '_drafts');
    let slug = name;
    for (let i = 2; fs.existsSync(path.join(drafts, slug)) && i < 10; i++) slug = name + '-' + i;
    if (fs.existsSync(path.join(drafts, slug))) return { ok: false, why: 'too many drafts named ' + name };
    const file = writeSkill(path.join(drafts, slug), slug, b, true);
    return { ok: true, name: slug, dir: path.join(drafts, slug), file, milestones: b.recipe.milestones.length, commands: b.commands,
             typed: b.typed.map((t) => String(t).slice(0, 80)), secrets: b.recipe.secrets, stoppedAt: b.stoppedAt || undefined };
  } catch (e) { return { ok: false, why: 'the draft could not be written: ' + ((e && e.message) || e) }; }
}

// A reviewed draft joins the library: skills/_drafts/<name> -> skills/<name>, its draft note taken out.
function promote(name, yes) {
  if (!SLUG.test(String(name || ''))) { console.error('[x] a skill name is lowercase words joined by dashes (node drive/replay.js promote <name>)'); return 2; }
  const from = path.join(skillsRoot(), '_drafts', name), to = path.join(skillsRoot(), name);
  if (!fs.existsSync(from)) { console.error('[x] no draft skills/_drafts/' + name + ' (drafts: ' + (fs.existsSync(path.join(skillsRoot(), '_drafts')) ? fs.readdirSync(path.join(skillsRoot(), '_drafts')).join(', ') || 'none' : 'none') + ')'); return 2; }
  if (fs.existsSync(to)) { console.error('[x] skills/' + name + ' already exists -- promote the draft under another name by renaming its folder first'); return 2; }
  let typed = [];
  try { typed = typedTexts(readJson(path.join(from, 'replay.json')).milestones.reduce((a, m) => a.concat(m.cmds || []), [])); } catch (e) { console.error('[x] the draft\'s replay.json cannot be read: ' + e.message); return 2; }
  console.log('[.] skills/_drafts/' + name + ' stores this typed text:' + (typed.length ? '\n    ' + typed.map((t) => JSON.stringify(t.slice(0, 80))).join('\n    ') : ' none'));
  if (!yes) { console.log('[.] nothing moved: if none of it is private, run again with --yes'); return 0; }
  fs.renameSync(from, to);
  const readme = path.join(to, 'README.md');
  try {
    const t = fs.readFileSync(readme, 'utf8'), a = t.indexOf(DRAFT_BEGIN), z = t.indexOf(DRAFT_END);
    if (a >= 0 && z > a) fs.writeFileSync(readme, t.slice(0, a) + t.slice(z + DRAFT_END.length).replace(/^\r?\n/, ''));
  } catch (_) {}
  console.log('[+] skills/' + name + ' is in the library -- `node kit.js contribute "a skill to …"` shares it');
  return 0;
}

function save(dir, name) {
  if (!SLUG.test(String(name || ''))) { console.error('a skill name is lowercase words joined by dashes, e.g. send-the-weekly-report'); return 2; }
  const b = build(dir);
  if (!b.ok) { console.error('[x] ' + b.why); return 3; }
  const file = writeSkill(path.join(skillsRoot(), name), name, b, false);
  console.log('[+] saved ' + b.recipe.milestones.length + ' proven milestone(s), ' + b.commands + ' command(s) -> ' + path.relative(KIT, file));
  if (b.stoppedAt) console.log('[.] the run stopped being proven at "' + b.stoppedAt.t + '" (' + b.stoppedAt.s + ') -- the recipe ends before it');
  if (b.recipe.secrets) console.log('[.] ' + b.recipe.secrets + ' secret(s) were not recorded: run it with --secret <text> for each, in order');
  if (b.typed.length) console.log('[!] typed text stored in the recipe -- check nothing private is in it before sharing:\n    ' + b.typed.map((t) => JSON.stringify(t.slice(0, 80))).join('\n    '));
  return 0;
}

function run(recipeFile, dir, secrets) {
  let r;
  try { r = readJson(recipeFile); } catch (e) { console.error('[x] cannot read the recipe: ' + e.message); return 2; }
  if (!r || r.kind !== 'mission-replay' || !Array.isArray(r.milestones) || !r.milestones.length) { console.error('[x] not a replay recipe (save one with: node drive/replay.js save <serve-dir> <name>)'); return 2; }
  const need = countSecrets(r.milestones.map((m) => m.cmds));
  if (secrets.length < need) { console.error('[x] the recipe types ' + need + ' secret(s) that were never recorded; give each with --secret <text>, in order'); return 3; }
  let si = 0;
  const fill = (cmds) => walk(cmds, (v) => (v === SECRET ? secrets[si++] : v));
  const send = (cmd) => { try { return exchange(dir, cmd); } catch (e) { return { ok: false, why: e.message, dead: true }; } };
  const plan = send({ do: 'mission', op: 'plan', why: 'replaying a proven run', replay: 1, plan: { goal: r.goal, done: r.done || undefined,
    milestones: r.milestones.map((m) => ({ t: m.t, done: m.done, check: m.check || undefined, steps: m.steps && m.steps.length ? m.steps : undefined })) } });
  if (!plan.ok) { console.error('[x] the plan was not accepted: ' + plan.why); return 3; }
  console.log('[+] replaying "' + r.goal + '": ' + r.milestones.length + ' milestone(s)');
  for (let i = 0; i < r.milestones.length; i++) {
    const m = r.milestones[i], tag = '[' + (i + 1) + '/' + r.milestones.length + '] ' + m.t;
    if (m.cmds.length) {
      const res = send({ do: 'plan', steps: fill(m.cmds), intent: m.t });
      if (!res.ok) {
        const at = res.stoppedAt ? ' at step ' + ((Number(res.stoppedAt.at) || 0) + 1) + (res.stoppedAt.why ? ' (' + res.stoppedAt.why + ')' : '') : '';
        console.error('[x] ' + tag + ': its actions failed' + at + ': ' + (res.why || 'no reason given'));
        send({ do: 'mission', op: 'fail', m: m.t, why: 'the replay\'s actions failed' + at });
        return 4;
      }
    }
    // PROOF, as the mission demands: the milestone's own check, else the last check the original run made here,
    // else a picture of it shown to the room
    const check = m.check || lastCheck(m.cmds);
    let ach;
    if (check) ach = send({ do: 'mission', op: 'achieve', m: m.t, check, timeout: 8000 });
    else {
      const pic = path.join(dir, 'replay-proof-' + (i + 1) + '.png');
      const lk = send({ do: 'look', out: pic, max: 400 });
      ach = lk.ok ? send({ do: 'mission', op: 'achieve', m: m.t, file: pic }) : lk;
    }
    if (!ach.ok) { console.error('[x] ' + tag + ': not proven: ' + (ach.why || 'the check did not hold')); return 5; }
    console.log('[+] ' + tag + ' -- achieved');
  }
  const fin = send({ do: 'mission', op: 'finish' });
  console.log(fin.ok ? '[+] done: every milestone achieved' : '[.] every milestone achieved, but finishing said: ' + fin.why);
  return 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args[0];
  const secrets = [];
  const pos = [];
  let yes = false;
  for (let i = 1; i < args.length; i++) { if (args[i] === '--secret') secrets.push(String(args[++i] == null ? '' : args[i])); else if (args[i] === '--yes') yes = true; else pos.push(args[i]); }
  let code = 2;
  if (mode === 'save' && pos.length === 2) code = save(pos[0], pos[1]);
  else if (mode === 'run' && pos.length === 2) code = run(pos[0], pos[1], secrets);
  else if (mode === 'promote' && pos.length === 1) code = promote(pos[0], yes);
  else console.error('usage:\n  node drive/replay.js save <serve-dir> <skill-name>\n  node drive/replay.js run <replay.json> <serve-dir> [--secret <text>]...\n  node drive/replay.js promote <draft-name> [--yes]');
  process.exit(code);
}

module.exports = { build, lastCheck, countSecrets, draft, promote, slugOf };

#!/usr/bin/env node
// kit.js -- THE MAP of this kit, generated from the files on every run: what each area is for, every tool
// with what it does and how to call it, and every skill (a kind of task done before, with the command that
// does it). An agent runs this ONE command to know everything it can use, instead of reading folders.
//
//   node kit.js                  # the whole map: areas, tools, skills
//   node kit.js skills [word]    # the skills only -- "have I done this before?" -- filtered by a word
//   node kit.js tools [word]     # the tools only
//   node kit.js verbs [word]     # the serve's commands: each verb, its fields, what it does (core/verbs.js)
//   ... --json                   # either, machine-readable
//
// ...and the contributor's commands (dev/kitops.js) -- how many people grow one kit:
//   node kit.js check            # what CI checks: catalog and tool headers, no secrets / private data, docs current
//   node kit.js new <slug>       # a new skill folder from skills/_template
//   node kit.js update           # pull the reviewed main, and say what changed
//   node kit.js contribute "what changed" [--yes]   # branch, commit, push, open a pull request
//   node kit.js version
//
// Nothing here is a hand-kept list of files, so two people adding things never edit the same line. A tool
// is listed because its header carries an `@tool` line (what it does) and an `@run` line (how to call it);
// a skill because its folder holds a README.md whose frontmatter says name / when / tags / run. A README
// with no frontmatter still lists: its first heading is the name and its first prose line the "when".
// No dependencies.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
// Normally skills/ beside this file; SM_SKILLS_DIR overrides it (tests, or a second library).
// SM_SITUATIONS_DIR is the same thing under the folder's old name.
const SKILLS = process.env.SM_SKILLS_DIR || process.env.SM_SITUATIONS_DIR || path.join(ROOT, 'skills');
const TOOL_DIRS = ['core', 'drive', 'vision', 'mcp', 'dev'];

// What each area is for, in the order a task meets them. The folders' PURPOSES live here because they are
// the kit's design; what is IN them is read from the files.
const AREAS = [
  ['AGENTS.md', 'the brain -- read it first: the loop, the rules, the map'],
  ['config/', 'how the agent behaves: connecting, etiquette, when to ask'],
  ['core/', 'the session: connect, be let in, serve commands, see pixels'],
  ['drive/', 'commanding a session from the shell: one command, a batch, a recipe, the panel'],
  ['vision/', 'reading a screen beyond single pixels: grids, glyphs, crops'],
  ['mcp/', 'the kit as MCP tools: connect, every serve verb, pictures inline -- docs/reference/mcp.md'],
  ['skills/', 'one folder per kind of task -- its playbook, code and data (the growth area)'],
  ['docs/', 'reference/ (how things work) and plans/ (design notes, roadmap)'],
  ['dev/', 'for contributors: check, new skill, update, contribute (node kit.js check|new|update|contribute)'],
  ['tests/', "the kit's own tests: npm test (CI runs them on every pull request)"],
  ['.github/', 'CI on every pull request, CODEOWNERS (who reviews what), the pull-request and issue templates'],
  ['work/', "a run's scratch: cmd.json, done.json, ledger.json, screenshots (never committed)"],
];

// THE CONTRIBUTOR'S COMMANDS go to dev/kitops.js before anything else is read
{
  const op = process.argv[2];
  if (['check', 'new', 'update', 'contribute', 'version'].includes(op)) {
    const k = require('./dev/kitops.js');
    const rest = process.argv.slice(3), yes = rest.includes('--yes'), w = rest.filter((a) => a !== '--yes');
    process.exit(op === 'check' ? k.check() : op === 'new' ? k.newSkill(w[0]) : op === 'update' ? k.update()
               : op === 'contribute' ? k.contribute(w.join(' '), yes) : (console.log(k.version()), 0));
  }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const words = args.filter((a) => !a.startsWith('--'));   // --json, --md, --write-doc are switches, not words
const mode = /^(skills|tools|map|verbs)$/.test(words[0] || '') ? words.shift() : 'map';
const query = words.join(' ').toLowerCase().trim();
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// A tool's own header: `@tool <what it does>` and `@run <how to call it>`, anywhere in its first 60 lines,
// after `//`, `#` or nothing (a Python docstring).
function toolOf(file) {
  let head;
  try { head = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 60); } catch (_) { return null; }
  const tag = (name) => { for (const l of head) { const m = new RegExp('^\\s*(?://|#)?\\s*@' + name + '\\s+(.+?)\\s*$').exec(l); if (m) return m[1]; } return ''; };
  const what = tag('tool');
  return what ? { path: rel(file), what, run: tag('run') } : null;
}
function toolsIn(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /\.(js|py)$/.test(n)).sort(); } catch (_) {}
  return names.map((n) => toolOf(path.join(dir, n))).filter(Boolean);
}

// Parse a leading `--- ... ---` frontmatter block into {key: value}: line-based `key: value`, no YAML
// dependency (none of the skills needs nested data).
function frontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim();
  }
  return out;
}
function firstHeading(text) { const m = /^#\s+(.+)$/m.exec(text); return m ? m[1].trim() : ''; }
function firstProse(text) {
  const body = text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('|') || line.startsWith('-')) continue;
    return line.replace(/[*_`]/g, '').slice(0, 160);
  }
  return '';
}
function skills() {
  const out = [];
  let slugs;
  try { slugs = fs.readdirSync(SKILLS).sort(); } catch (_) { console.error('no skills/ folder found at ' + SKILLS); process.exit(2); }
  for (const slug of slugs) {
    if (slug.startsWith('_')) continue;   // skills/_template is the mould for `node kit.js new`, not a skill
    let text;
    try { text = fs.readFileSync(path.join(SKILLS, slug, 'README.md'), 'utf8'); } catch (_) { continue; }   // a folder without a README is not a skill
    const fm = frontmatter(text) || {};
    out.push({ slug, name: fm.name || firstHeading(text) || slug, when: fm.when || firstProse(text) || '',
               tags: (fm.tags || '').split(/[,\s]+/).filter(Boolean), run: fm.run || '',
               path: 'skills/' + slug + '/README.md', tools: toolsIn(path.join(SKILLS, slug)) });
  }
  return out;
}
const matches = (text) => !query || text.toLowerCase().includes(query);

let allTools = [];
for (const d of TOOL_DIRS) allTools = allTools.concat(toolsIn(path.join(ROOT, d)));
const tools = allTools.filter((t) => matches(t.path + ' ' + t.what + ' ' + t.run));
const skillList = (mode === 'tools') ? [] : skills().filter((s) => matches(s.slug + ' ' + s.name + ' ' + s.when + ' ' + s.tags.join(' ') + ' ' + s.run));

// THE SERVE'S VERBS come from the table that checks them (core/verbs.js) -- the same list that refuses a
// wrong field is the one printed here, so the two can never disagree.
if (mode === 'verbs') {
  const vb = require('./core/verbs.js');
  // --md prints the table as markdown; --write-doc puts it into docs/reference/serve-protocol.md (between its marks)
  if (args.includes('--md')) { process.stdout.write(vb.markdown() + '\n'); process.exit(0); }
  if (args.includes('--write-doc')) {
    const docFile = path.join(ROOT, 'docs', 'reference', 'serve-protocol.md');
    const before = fs.readFileSync(docFile, 'utf8'), after = vb.withDocBlock(before);
    if (after !== before) fs.writeFileSync(docFile, after);
    console.log(after !== before ? 'wrote the verb table into ' + rel(docFile) : rel(docFile) + ' is already current');
    process.exit(0);
  }
  const list = vb.VERBS.filter((v) => matches(v + ' ' + vb.V[v].f.join(' ') + ' ' + (vb.V[v].what || '')))
    .map((v) => ({ verb: v, fields: vb.V[v].f, what: vb.V[v].what || '',
                   aliases: Object.keys(vb.VERB_ALIAS).filter((a) => vb.VERB_ALIAS[a] === v),
                   renames: vb.FIELD_ALIAS[v] || {} }));
  if (asJson) { process.stdout.write(JSON.stringify({ common: vb.COMMON.filter((c) => c !== '__vetted'), verbs: list }, null, 2) + '\n'); process.exit(0); }
  if (!list.length) { console.log('No verb matches "' + query + '". All of them: node kit.js verbs'); process.exit(0); }
  console.log('VERBS -- {"do":"<verb>", ...fields}; any other field is refused before it runs' + (query ? ' (filter: "' + query + '")' : '') + '\n');
  const w = Math.max(...list.map((x) => x.verb.length));
  for (const x of list) {
    console.log('  ' + x.verb.padEnd(w) + '  ' + x.what);
    console.log('  ' + ' '.repeat(w) + '    fields: ' + (x.fields.length ? x.fields.join(', ') : '(none)'));
    const ren = Object.keys(x.renames).map((k) => k + '->' + x.renames[k]);
    if (x.aliases.length || ren.length) console.log('  ' + ' '.repeat(w) + '    fixed:  ' + x.aliases.map((a) => '"' + a + '"').concat(ren).join(', '));
  }
  console.log('\nAny command may also carry: ' + vb.COMMON.filter((c) => c !== 'do' && c !== '__vetted').join(', ') + '; an acting verb, look:{out,...}.');
  console.log('Docs: docs/reference/serve-protocol.md');
  process.exit(0);
}

if (asJson) {
  const out = mode === 'skills' ? skillList : mode === 'tools' ? tools : { areas: AREAS.map(([p, what]) => ({ path: p, what })), tools, skills: skillList };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

const printTools = (list) => {
  const w = Math.max(...list.map((t) => t.path.length), 10);
  for (const t of list) {
    console.log('  ' + t.path.padEnd(w) + '  ' + t.what);
    if (t.run) console.log('  ' + ' '.repeat(w) + '    ' + t.run);
  }
};
const printSkills = (list) => {
  for (const s of list) {
    console.log('  ' + s.slug);
    if (s.when) console.log('    when: ' + s.when);
    if (s.run) console.log('    run:  ' + s.run);
    console.log('    read: ' + s.path + (s.tags.length ? '   [' + s.tags.join(', ') + ']' : ''));
    console.log('');
  }
};

if (mode === 'map') {
  console.log('agent-drive -- the map, generated from the files (no hand-kept list)\n');
  console.log('AREAS');
  for (const [p, what] of AREAS) console.log('  ' + p.padEnd(10) + '  ' + what);
  console.log('\nTOOLS' + (query ? ' (filter: "' + query + '")' : '') + ' -- what each does, and how to call it (paths from this folder)');
  if (tools.length) printTools(tools); else console.log('  (none match)');
  console.log('\nSKILLS' + (query ? ' (filter: "' + query + '")' : '') + ' -- a kind of task done before: open its README before inventing an approach\n');
  if (skillList.length) printSkills(skillList); else console.log('  (none match)\n');
  console.log('Add a skill: a folder skills/<slug>/ with a README.md (name/when/tags/run frontmatter). A tool: an @tool and @run line in its header. No shared index to edit.');
} else if (mode === 'tools') {
  if (!tools.length) { console.log('No tool matches "' + query + '". All of them: node kit.js tools'); process.exit(0); }
  console.log('TOOLS' + (query ? ' (filter: "' + query + '")' : '') + ':\n');
  printTools(tools);
} else {
  if (!skillList.length) { console.log(query ? 'No skill matches "' + query + '". Browse all with: node kit.js skills' : 'No skills yet in skills/.'); process.exit(0); }
  console.log('SKILLS -- open the matching folder before inventing an approach' + (query ? ' (filter: "' + query + '")' : '') + ':\n');
  printSkills(skillList);
  console.log('Add one: create skills/<slug>/README.md with a name/when/tags/run frontmatter (see CONTRIBUTING.md). No shared index to edit.');
}

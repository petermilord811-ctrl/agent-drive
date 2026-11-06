// kit_map.js — regression test for kit.js, the kit's MAP: generated from the files on
// every run, so an agent learns the whole kit from one command and nobody edits a shared list. It must:
//   - list every skills/<slug>/ with a README; read name/when/tags/run from frontmatter; fall back to the
//     first heading / first prose line without it; filter by a word; emit valid --json; say there is no
//     shared index -- against a fixture library (SM_SKILLS_DIR, and SM_SITUATIONS_DIR, its old name)
//   - list EVERY tool in core/, drive/, vision/ and in each skill folder, by the @tool / @run lines in its
//     header -- a tool without them would be invisible to an agent, so that fails here
//   - name only areas that exist, and leave no top-level folder without one
//   - and every relative link in the kit's markdown resolves, so the next reorganisation cannot leave a
//     doc pointing at a file that moved.
// Self-cleaning. Run: node tests/kit_map.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const KIT = path.join(__dirname, '..');
const MAP = path.join(KIT, 'kit.js');
const node = process.execPath;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// a fixture library: a skill WITH frontmatter and a script of its own, one WITHOUT frontmatter (the
// fallback), and a folder that is NOT a skill (no README -> ignored)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-kit-'));
const mk = (slug, body) => { fs.mkdirSync(path.join(dir, slug), { recursive: true }); fs.writeFileSync(path.join(dir, slug, 'README.md'), body); };
mk('fill-a-form', '---\nname: Fill a form\nwhen: a multi-field form on screen — type each value\ntags: browser, forms, input\nrun: node skills/fill-a-form/fill-form.js ./work form.json\n---\n# skill: fill a form\nsteps...\n');
fs.writeFileSync(path.join(dir, 'fill-a-form', 'fill-form.js'), '#!/usr/bin/env node\n// @tool type every field of a form\n// @run  node skills/fill-a-form/fill-form.js ./work form.json\n');
mk('zzz-no-frontmatter', '# Operate a file manager\n\nMove and rename files on the host when the task needs it.\n\n## Recipe\n- step\n');
fs.mkdirSync(path.join(dir, 'not-a-skill'), { recursive: true });

const run = (args, env) => execFileSync(node, [MAP, ...args], { encoding: 'utf8', env: Object.assign({}, process.env, env || { SM_SKILLS_DIR: dir }) });

try {
  // ---- the skills catalog, on the fixture ----
  const list = JSON.parse(run(['skills', '--json']));
  ok(Array.isArray(list) && list.length === 2, 'lists exactly the two folders that have a README (ignores not-a-skill) — got ' + list.length);
  const form = list.find((e) => e.slug === 'fill-a-form');
  ok(form && form.name === 'Fill a form' && /multi-field form/.test(form.when), 'frontmatter name and when are read');
  ok(form && form.tags.join(',') === 'browser,forms,input', 'frontmatter tags are parsed to a list');
  ok(form && form.run === 'node skills/fill-a-form/fill-form.js ./work form.json', 'frontmatter run: is the command that does the job');
  ok(form && form.path === 'skills/fill-a-form/README.md', 'path points at the README');
  ok(form && form.tools.length === 1 && form.tools[0].what === 'type every field of a form', "a skill's own script is listed with it, by its @tool line");
  const fb = list.find((e) => e.slug === 'zzz-no-frontmatter');
  ok(fb && fb.name === 'Operate a file manager' && /Move and rename files/.test(fb.when) && fb.run === '', 'no frontmatter: name and when fall back to the first heading and prose line');
  ok(list[0].slug === 'fill-a-form' && list[1].slug === 'zzz-no-frontmatter', 'skills are sorted by slug (stable, no ordering conflicts)');
  const filtered = JSON.parse(run(['skills', '--json', 'form']));
  ok(filtered.length === 1 && filtered[0].slug === 'fill-a-form', 'a word filters the catalog');
  ok(JSON.parse(run(['skills', '--json', 'nothingmatches'])).length === 0, 'a word that matches nothing gives an empty list');
  const human = run(['skills']);
  ok(/No shared index to edit/.test(human) && /fill-a-form/.test(human) && /run:  node skills\/fill-a-form/.test(human), 'the human catalog lists skills with their run line, and says there is no shared index');
  ok(JSON.parse(run(['skills', '--json'], { SM_SITUATIONS_DIR: dir })).length === 2, 'SM_SITUATIONS_DIR, the old name, still points it at a library');

  // ---- the real kit: tools, areas, skills ----
  const real = JSON.parse(execFileSync(node, [MAP, '--json'], { encoding: 'utf8' }));
  const listed = new Set(real.tools.map((t) => t.path));
  const files = [];
  for (const d of ['core', 'drive', 'vision']) for (const n of fs.readdirSync(path.join(KIT, d))) if (/\.(js|py)$/.test(n)) files.push(d + '/' + n);
  const missing = files.filter((f) => !listed.has(f));
  ok(files.length >= 10 && missing.length === 0, 'every tool in core/, drive/ and vision/ is on the map (' + files.length + ' tools' + (missing.length ? '; missing @tool: ' + missing.join(', ') : '') + ')');
  ok(real.tools.every((t) => t.what && t.run), 'every tool on the map says what it does AND how to call it (@tool and @run)');
  const skillFiles = [];
  for (const s of fs.readdirSync(path.join(KIT, 'skills'))) {
    const d = path.join(KIT, 'skills', s);
    if (fs.statSync(d).isDirectory()) for (const n of fs.readdirSync(d)) if (/\.(js|py)$/.test(n)) skillFiles.push('skills/' + s + '/' + n);
  }
  const skillListed = new Set([].concat(...real.skills.map((s) => s.tools.map((t) => t.path))));
  ok(skillFiles.every((f) => skillListed.has(f)), 'every script inside a skill folder is listed with its skill (' + skillFiles.length + ')');
  const sudoku = real.skills.find((e) => e.slug === 'solve-a-sudoku');
  ok(!!sudoku && sudoku.run === 'node skills/solve-a-sudoku/sudoku.js ./work play master' && sudoku.tools.some((t) => t.path === 'skills/solve-a-sudoku/sudoku.js'),
     'the sudoku skill lists its one command and its own scripts');
  const areas = real.areas.map((a) => a.path);
  ok(areas.filter((a) => a !== 'work/').every((a) => fs.existsSync(path.join(KIT, a))), 'every area the map names exists (' + areas.join(' ') + ')');
  const tracked = fs.readdirSync(KIT, { withFileTypes: true }).filter((e) => e.isDirectory() && !/^(work|node_modules|\.git)$/.test(e.name)).map((e) => e.name + '/');
  const unnamed = tracked.filter((d) => !areas.includes(d));
  ok(unnamed.length === 0, 'no top-level folder exists without a line on the map' + (unnamed.length ? ': ' + unnamed.join(' ') : ''));
  ok(!fs.existsSync(path.join(KIT, 'bin')) && !fs.existsSync(path.join(KIT, 'situations')), 'the old flat bin/ and situations/ are gone');
  const map = execFileSync(node, [MAP], { encoding: 'utf8' });
  ok(/AREAS/.test(map) && /TOOLS/.test(map) && /SKILLS/.test(map) && /core\/agent-join\.js/.test(map), 'the plain map shows the areas, the tools and the skills');

  // ---- every relative link in the kit's markdown resolves ----
  const broken = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(work|node_modules|\.git)$/.test(e.name)) walk(p); continue; }
      if (!/\.md$/.test(e.name) || e.name === 'SESSION-LOG.md') continue;
      const text = fs.readFileSync(p, 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(p), target))) broken.push(path.relative(KIT, p).split(path.sep).join('/') + ' -> ' + m[1]);
      }
    }
  })(KIT);
  ok(broken.length === 0, 'every relative link in the kit docs resolves' + (broken.length ? ': ' + broken.slice(0, 8).join(' | ') : ''));
} catch (e) { fail++; console.error('  FAIL (exception): ' + (e && e.stack || e)); }

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

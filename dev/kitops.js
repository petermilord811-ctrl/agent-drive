'use strict';
// @tool the contributor's commands: check (what CI checks), new <slug> (a skill from the template), update (the reviewed main), contribute (a pull request)
// @run  node kit.js check | node kit.js new <slug> | node kit.js update | node kit.js contribute "what changed" [--yes]
// kitops -- HOW MANY PEOPLE GROW ONE KIT WITHOUT BREAKING IT FOR EACH OTHER.
//
// The kit is improved by the people using it: a run teaches an agent something, a skill gets a better recipe, a
// tool a fix. Those changes must reach everyone -- and must NOT reach anyone unreviewed, because a skill is code
// that runs on a contributor's machine and types into somebody else's screen. So the loop is the ordinary open-
// source one, made one command at each end:
//
//   contribute   branch + commit what changed + push + open a pull request (a preview without --yes)
//   (review)     CI runs `check` and the tests on Linux and Windows; CODEOWNERS asks the right reviewer
//   update       pull the reviewed main and say what changed (new skills, CHANGELOG lines)
//
// `check` is what CI runs, so a contributor can run it first: every skill lists in the catalog, every tool says
// what it does, no secret or private data is committed, no file is too big, the verb table in the docs is current.
// No dependencies; git (and, for opening the pull request, the GitHub CLI `gh`) on the PATH.
const fs = require('fs'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const git = (args, opts) => execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {})).trim();
const tryGit = (args) => { try { return { ok: true, out: git(args) }; } catch (e) { return { ok: false, out: String((e.stderr || e.message || '')).trim() }; } };
const isRepo = () => tryGit(['rev-parse', '--is-inside-work-tree']).ok;
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch (_) { return '?'; } };

// ---- check ------------------------------------------------------------------------------------------------
const FRONT = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const TOOL_DIRS = ['core', 'drive', 'vision', 'mcp', 'dev'];
const MAX_BYTES = 2 * 1024 * 1024;
// shapes of secrets that must never be committed
const SECRETS = [
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['an Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI-style API key', /\bsk-(?!ant-)[A-Za-z0-9]{32,}\b/],
  // a join key with a VALUE -- not an empty one, and not a placeholder like <secret>, $KEY or ...
  ['a filled-in join key', /^\s*SM_JOIN_KEY\s*=\s*(?![<$%{"']|\.\.\.|…|your|xxx|changeme)[^\s#]{6,}/mi],
];
// private data: real mailboxes and addresses -- examples use example.com and 203.0.113.x (RFC 2606 / 5737)
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const EMAIL_OK = /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com|anthropic\.com|contributor-covenant\.org)$|\.(test|example|invalid|localhost)$/i;
const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
const ipOk = (a, b, c) => (a === 203 && b === 0 && c === 113) || (a === 198 && (b === 51 && c === 100)) || (a === 192 && b === 0 && c === 2) ||
                          a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 0 || a === 255 || a >= 224;
const TEXT = /\.(js|md|json|ps1|py|cs|sh|txt|ya?ml|cmd|bat|html|css|example)$|(^|\/)\.(env\.example|gitignore|gitattributes|editorconfig)$|(^|\/)(LICENSE|CODEOWNERS)$/i;

function files() {
  if (isRepo()) {
    const out = git(['ls-files', '-co', '--exclude-standard']);   // tracked + new, never the ignored ones
    return out ? out.split('\n').filter((f) => fs.existsSync(path.join(ROOT, f))) : [];
  }
  const all = [];
  const skip = new Set(['.git', 'node_modules', 'work']);
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (skip.has(e.name) || e.name === '.env') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(rel(p)); } })(ROOT);
  return all;
}

function check() {
  const errors = [], warnings = [];
  const list = files();
  // skills: every folder lists in the catalog
  const skillsDir = path.join(ROOT, 'skills');
  for (const d of fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }) : []) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(d.name)) errors.push('skills/' + d.name + ': a skill folder is lowercase words joined by dashes');
    const readme = path.join(skillsDir, d.name, 'README.md');
    if (!fs.existsSync(readme)) { errors.push('skills/' + d.name + ': no README.md -- the catalog cannot list it'); continue; }
    const m = FRONT.exec(fs.readFileSync(readme, 'utf8'));
    if (!m) { warnings.push('skills/' + d.name + '/README.md: no frontmatter -- it lists by its first heading only (add name / when / tags / run)'); continue; }
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) { const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line); if (kv) fm[kv[1].toLowerCase()] = kv[2].trim(); }
    if (!fm.name) errors.push('skills/' + d.name + '/README.md: frontmatter needs a name');
    if (!fm.when) errors.push('skills/' + d.name + '/README.md: frontmatter needs a when -- the kind of task it is for');
  }
  // tools: every script at the top of a tool folder says what it does and how to call it
  for (const dir of TOOL_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const n of fs.readdirSync(abs)) {
      if (!/\.(js|py)$/.test(n)) continue;
      const head = fs.readFileSync(path.join(abs, n), 'utf8').split(/\r?\n/).slice(0, 60).join('\n');
      if (!/^\s*(?:\/\/|#)?\s*@tool\s+\S/m.test(head) || !/^\s*(?:\/\/|#)?\s*@run\s+\S/m.test(head))
        errors.push(dir + '/' + n + ': its header needs an @tool line (what it does) and an @run line (how to call it)');
    }
  }
  // secrets, private data, size
  for (const f of list) {
    const p = path.join(ROOT, f);
    let st; try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.size > MAX_BYTES) errors.push(f + ': ' + Math.round(st.size / 1024) + ' KB -- files over 2 MB do not belong in the kit');
    if (/(^|\/)\.env$/.test(f) || /(^|\/)\.env\.(?!example$)/.test(f)) errors.push(f + ': an .env file holds secrets and is never committed');
    if (/(^|\/)work\//.test(f)) errors.push(f + ': work/ is a run\'s scratch and is never committed');
    if (/\.(png|jpe?g|gif|bmp|webp)$/i.test(f)) warnings.push(f + ': a picture -- make sure it shows nothing real (examples must be synthetic)');
    if (!TEXT.test(f) || st.size > MAX_BYTES) continue;
    const t = fs.readFileSync(p, 'utf8');
    for (const [what, re] of SECRETS) if (re.test(t)) errors.push(f + ': looks like ' + what + ' -- never commit a secret');
    let m;
    EMAIL.lastIndex = 0;
    while ((m = EMAIL.exec(t))) {
      if (EMAIL_OK.test(m[1])) continue;
      if (/:\/\/[^\s'"`<>]*$/.test(t.slice(Math.max(0, m.index - 120), m.index))) continue;   // a URL's user:pass@host, not a mailbox
      errors.push(f + ': a real-looking address "' + m[0] + '" -- use example.com in examples'); break;
    }
    IPV4.lastIndex = 0;
    while ((m = IPV4.exec(t))) {
      const [a, b, c, d] = m.slice(1, 5).map(Number);
      if ([a, b, c, d].some((x) => x > 255)) continue;
      if (!ipOk(a, b, c)) { warnings.push(f + ': an IP address "' + m[0] + '" -- use 203.0.113.x in examples unless it is meant to be public'); break; }
    }
  }
  // the docs' verb table is the checker's own
  try {
    const verbs = require(path.join(ROOT, 'core', 'verbs.js'));
    const docFile = path.join(ROOT, 'docs', 'reference', 'serve-protocol.md');
    const doc = fs.readFileSync(docFile, 'utf8');
    if (verbs.withDocBlock(doc) !== doc) errors.push('docs/reference/serve-protocol.md: its verb table is stale -- run: node kit.js verbs --write-doc');
  } catch (e) { errors.push('core/verbs.js or the serve protocol doc could not be read: ' + e.message); }

  for (const w of warnings) console.log('  warn  ' + w);
  for (const e of errors) console.log('  FAIL  ' + e);
  console.log((errors.length ? 'FAIL' : 'ok') + ' kit check: ' + list.length + ' files, ' + errors.length + ' problem(s), ' + warnings.length + ' warning(s)');
  return errors.length ? 1 : 0;
}

// ---- new <slug> -------------------------------------------------------------------------------------------
function newSkill(slug) {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(String(slug || ''))) { console.error('a skill name is lowercase words joined by dashes, e.g. fill-a-form'); return 2; }
  const dir = path.join(ROOT, 'skills', slug);
  if (fs.existsSync(dir)) { console.error('skills/' + slug + ' already exists -- pick a distinctive name (node kit.js skills shows them all)'); return 2; }
  const tpl = path.join(ROOT, 'skills', '_template', 'README.md');
  const name = slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const text = fs.readFileSync(tpl, 'utf8').split('{{name}}').join(name).split('{{slug}}').join(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), text);
  console.log('made skills/' + slug + '/README.md from the template. Next:');
  console.log('  1. fill in when / tags / run and the steps -- with the real measurements and pitfalls');
  console.log('  2. add a line for it to .github/CODEOWNERS:   /skills/' + slug + '/  @your-github-name');
  console.log('  3. node kit.js check, then node kit.js contribute "a skill to ' + name.toLowerCase() + '"');
  return 0;
}

// ---- update ---------------------------------------------------------------------------------------------------
function update() {
  if (!isRepo()) { console.error('this kit is not a git checkout -- get it with: git clone https://github.com/petermilord811-ctrl/agent-drive.git'); return 2; }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const before = git(['rev-parse', 'HEAD']), was = version();
  const f = tryGit(['fetch', '--quiet', 'origin']);
  if (!f.ok) { console.error('could not reach the kit\'s repository: ' + f.out); return 3; }
  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (branch !== 'main') { console.log('you are on "' + branch + '", not main: fetched; to take main\'s changes into it: git merge origin/main'); return 0; }
  if (dirty) { console.log('you have changes of your own in tracked files -- contribute them (node kit.js contribute "...") or set them aside (git stash), then update:\n' + dirty); return 4; }
  const p = tryGit(['pull', '--ff-only', '--quiet', 'origin', 'main']);
  if (!p.ok) { console.error('could not fast-forward main: ' + p.out); return 3; }
  const after = git(['rev-parse', 'HEAD']);
  if (after === before) { console.log('the kit is up to date (' + was + ')'); return 0; }
  console.log('updated ' + was + ' -> ' + version() + ' (' + git(['rev-list', '--count', before + '..' + after]) + ' commits)');
  const skills = tryGit(['diff', '--name-status', before, after, '--', 'skills/']);
  const added = new Set(), changed = new Set();
  for (const line of (skills.out || '').split('\n').filter(Boolean)) {
    const [st, file] = line.split(/\s+/);
    const m = /^skills\/([^/]+)\//.exec(file || '');
    if (!m || m[1].startsWith('_')) continue;
    (st === 'A' && /README\.md$/.test(file) ? added : changed).add(m[1]);
  }
  for (const s of added) changed.delete(s);
  if (added.size) console.log('  new skills: ' + [...added].join(', '));
  if (changed.size) console.log('  changed skills: ' + [...changed].join(', '));
  const log = tryGit(['log', '--format=  - %s', before + '..' + after]);
  if (log.ok && log.out) console.log(log.out.split('\n').slice(0, 20).join('\n'));
  return 0;
}

// ---- contribute ---------------------------------------------------------------------------------------------
function contribute(message, yes) {
  if (!isRepo()) { console.error('this kit is not a git checkout -- clone it (or fork it on GitHub) first'); return 2; }
  const msg = String(message || '').trim();
  if (!msg) { console.error('say what you changed: node kit.js contribute "the sudoku skill reads faint grid lines"'); return 2; }
  // untrimmed: a porcelain line is "XY path", and its leading space (an unstaged change) is part of the format
  const changes = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((l) => l.trim());
  if (!changes.length) { console.log('nothing to contribute: no changes here'); return 0; }
  console.log('checking first -- what CI will check:');
  if (check()) { console.error('fix the problems above, then contribute again'); return 1; }
  const branch = 'contrib/' + msg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + new Date().toISOString().slice(0, 10);
  console.log('\nwould contribute ' + changes.length + ' change(s) on a new branch "' + branch + '":\n  ' + changes.join('\n  '));
  if (!yes) { console.log('\n(a preview -- nothing was done. Look over the list, then run it again with --yes)'); return 0; }
  const start = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  git(['checkout', '-b', branch]);
  git(['add', '-A']);
  git(['commit', '-m', msg]);
  const push = tryGit(['push', '-u', 'origin', branch]);
  if (!push.ok) {
    console.error('could not push to origin (' + push.out.split('\n').pop() + ').\nWithout write access, fork it and push there:  gh repo fork --remote=true  then  git push -u origin ' + branch);
    console.error('your commit is safe on the branch "' + branch + '" (you were on "' + start + '").');
    return 3;
  }
  const body = 'Contributed with `node kit.js contribute` (kit ' + version() + ').\n\nChanged:\n' + changes.map((c) => '- `' + c.slice(3) + '`').join('\n') +
               '\n\n- [x] `node kit.js check` passes\n- [ ] Evidence: the run that shows it works (no private screens)\n- [ ] A line under **Unreleased** in CHANGELOG.md';
  const gh = spawnSync('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', msg, '--body', body], { cwd: ROOT, encoding: 'utf8' });
  if (gh.status === 0) console.log('opened the pull request: ' + String(gh.stdout).trim());
  else console.log('pushed "' + branch + '". Open the pull request on GitHub (or install the GitHub CLI `gh` and run: gh pr create --fill)');
  return 0;
}

module.exports = { check, newSkill, update, contribute, version };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const yes = rest.includes('--yes'), words = rest.filter((a) => a !== '--yes');
  const code = cmd === 'check' ? check() : cmd === 'new' ? newSkill(words[0]) : cmd === 'update' ? update()
             : cmd === 'contribute' ? contribute(words.join(' '), yes) : cmd === 'version' ? (console.log(version()), 0)
             : (console.error('usage: node dev/kitops.js check | new <slug> | update | contribute "message" [--yes] | version'), 2);
  process.exit(code);
}

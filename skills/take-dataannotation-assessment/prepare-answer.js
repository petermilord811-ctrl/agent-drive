#!/usr/bin/env node
/**
 * Part B orchestrator — pick slug, gate bank, emit session + playbook paths.
 *
 * @run node skills/take-dataannotation-assessment/prepare-answer.js --profile "d:/…/10-Daniel Herman"
 * @run node skills/take-dataannotation-assessment/prepare-answer.js --profile "…" --slug software-engineer --strict-full
 * @run node skills/take-dataannotation-assessment/prepare-answer.js --profile "…" --fetch-min 10 --gen-min 10
 *
 * Writes:
 *   {profile}/session.json     — slug, bioMinutes, paths, next steps
 *   {profile}/answer.playbook.json — only when answer.fill.json already exists
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { slugifyRole } = require('./role-slug');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] != null) return process.argv[i + 1];
  return fallback;
}

const profileDir = arg('profile', '');
const slugFlag = arg('slug', '');
const strictFull = process.argv.includes('--strict-full');
const fetchMin = Number(arg('fetch-min', '0')) || 0;
const genMin = Number(arg('gen-min', '0')) || 0;
const skillDir = __dirname;
const workflowDir = path.join(__dirname, '..', 'dataannotation-assessment-workflow');

if (!profileDir || !fs.existsSync(profileDir)) {
  console.error('need --profile <existing profile dir with Resume.pdf>');
  process.exit(2);
}

function runNode(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    maxBuffer: 4e6,
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function findResume(dir) {
  const files = fs.readdirSync(dir);
  return (
    files.find((f) => /\.(pdf|docx|txt|md)$/i.test(f) && /resume|cv/i.test(f)) ||
    files.find((f) => /\.(pdf|docx)$/i.test(f)) ||
    null
  );
}

const resumeName = findResume(profileDir);
if (!resumeName) {
  console.error('no resume pdf/docx in profile');
  process.exit(2);
}
const resumePath = path.join(path.resolve(profileDir), resumeName);

// 1) Pick role unless --slug given
let pick = null;
let slug = slugFlag;
if (!slug) {
  const picked = runNode(path.join(workflowDir, 'pick-assessment.js'), [
    '--resume',
    resumePath,
    '--top',
    '5',
  ]);
  if (picked.status !== 0) {
    console.error('pick-assessment failed:', picked.stderr || picked.stdout);
    process.exit(2);
  }
  pick = JSON.parse(picked.stdout);
  slug = slugifyRole(pick.pick.role);
}

// 2) Gate
const readyArgs = ['--slug', slug, '--profile', path.resolve(profileDir)];
if (strictFull) readyArgs.push('--strict-full');
const readyRun = runNode(path.join(skillDir, 'answer-ready.js'), readyArgs);
let ready;
try {
  ready = JSON.parse(readyRun.stdout);
} catch (e) {
  console.error('answer-ready parse failed', readyRun.stdout, readyRun.stderr);
  process.exit(2);
}

const bankPath = path.join(skillDir, 'problems', `problems-${slug}.md`);
const answerPath = path.join(path.resolve(profileDir), 'answer.md');
const fillPath = path.join(path.resolve(profileDir), 'answer.fill.json');
const pacePath = path.join(path.resolve(profileDir), 'answer.pace.json');
const playbookPath = path.join(path.resolve(profileDir), 'answer.playbook.json');
const sessionPath = path.join(path.resolve(profileDir), 'session.json');

const bio = ready.bioMinutes || { min: 60, max: 90, cue: 'default 60-90' };

// 3) If fill exists, build pace + playbook
let playbook = null;
let pace = null;
if (fs.existsSync(fillPath)) {
  const paceArgs = [
    '--bio-min',
    String(bio.min || 60),
    '--bio-max',
    String(bio.max || 90),
    '--fetch-min',
    String(fetchMin),
    '--gen-min',
    String(genMin),
    '--fill',
    fillPath,
    '--out',
    pacePath,
  ];
  const paceRun = runNode(path.join(skillDir, 'pace-plan.js'), paceArgs);
  try {
    pace = JSON.parse(paceRun.stdout);
  } catch (_) {
    pace = null;
  }

  const fill = JSON.parse(fs.readFileSync(fillPath, 'utf8'));
  const paceById = {};
  if (pace && Array.isArray(pace.actions)) {
    for (const a of pace.actions) paceById[a.id] = a;
  }

  playbook = {
    version: 1,
    slug,
    profileDir: path.resolve(profileDir),
    bank: bankPath,
    bioMinutes: bio,
    neverSubmit: true,
    typing: { human: true, neverHuman0: true, replaceNotAppend: true },
    clicks: {
      tool: 'locate-click.py',
      radioMode: 'radio <i> on choice cluster (not radios-raw)',
      roleMode: 'role "Title" → dbl',
      forbidOcrClickText: true,
    },
    actions: (fill.actions || []).map((a, idx) => {
      const p = paceById[a.id] || {};
      return {
        seq: idx + 1,
        id: a.id,
        leaf: a.leaf,
        step: a.step,
        type: a.type,
        action: a.action,
        value: a.value,
        required: a.required,
        confidence: a.confidence,
        firstInStep: a.firstInStep,
        thinkMs: p.thinkMs != null ? p.thinkMs : a.thinkMs,
        typeMs: p.typeMs,
        pauseMs: p.pauseMs != null ? p.pauseMs : p.thinkMs,
        recipe: recipeFor(a),
      };
    }),
  };
  fs.writeFileSync(playbookPath, JSON.stringify(playbook, null, 2) + '\n', 'utf8');
}

function recipeFor(a) {
  const t = (a.type || '').toLowerCase();
  if (t === 'agree') {
    return [
      'look',
      'locate-click.py <look> radio 0  # or click I agree label',
      'look prove',
      'locate-click.py <look> next',
    ];
  }
  if (t === 'radio') {
    return [
      'look',
      'pause thinkMs',
      'locate-click.py <look> radios  # confirm count == expected choices',
      'locate-click.py <look> radio <index matching value>',
      'look prove selection',
    ];
  }
  if (t === 'checkbox') {
    return ['look', 'pause', 'click each value via locate/label', 'look prove'];
  }
  if (t === 'drag') {
    return ['look', 'pause', 'stroke reorder to value[]', 'look prove'];
  }
  if (t === 'skip') {
    return ['leave blank', 'locate-click.py next'];
  }
  if (t === 'text' || t === 'textarea' || t === 'code') {
    return [
      'look',
      'pause thinkMs',
      'focus field (radio→Tab or click textarea cx/cy from scroll-complete)',
      'chord Ctrl+A',
      'press Backspace',
      'keys { text: value }  # auto-type — NEVER human:0',
      'look prove',
    ];
  }
  return ['look', 'apply', 'look prove'];
}

const phase =
  !ready.ok
    ? 'blocked'
    : !fs.existsSync(answerPath)
      ? 'generate-answer-md'
      : !fs.existsSync(fillPath)
        ? 'parse-validate'
        : !playbook
          ? 'build-playbook'
          : 'autofill-ready';

const session = {
  version: 1,
  created: new Date().toISOString(),
  profileDir: path.resolve(profileDir),
  resume: resumePath,
  slug,
  role: pick ? pick.pick.role : slug,
  pick: pick ? pick.pick : null,
  alternatives: pick ? pick.alternatives : null,
  ready,
  bioMinutes: bio,
  paths: {
    bank: fs.existsSync(bankPath) ? bankPath : null,
    answerMd: answerPath,
    fillJson: fillPath,
    paceJson: pacePath,
    playbookJson: playbook ? playbookPath : null,
    sessionJson: sessionPath,
  },
  artifacts: {
    answerMd: fs.existsSync(answerPath),
    fillJson: fs.existsSync(fillPath),
    paceJson: fs.existsSync(pacePath),
    playbookJson: !!playbook,
  },
  phase,
  nextSteps: nextSteps(phase, ready, slug),
  hardRules: [
    'Never Submit until operator explicit yes',
    'Never keys human:0 on DA fields',
    'Always look → locate-click.py on THAT png → act',
    'Never clickText for DA content on OCR-blind hosts',
    'Keep chat short to avoid stuck chat-wait',
    'Profiles and questions are independent',
  ],
};

function nextSteps(phase, ready, slug) {
  if (phase === 'blocked') {
    if (ready.errors && ready.errors.some((e) => /captureStatus|incomplete|stub|nearly-full/i.test(e))) {
      return [
        `Part A fetch: open role → verbatim Bio1+Bio2+all steps → problems-${slug}.md`,
        'reconcile-steps.js + compare-problems.js',
        're-run prepare-answer.js --strict-full',
      ];
    }
    return ready.errors || ['fix readiness errors'];
  }
  if (phase === 'generate-answer-md') {
    return [
      'Write answer.md from bank + resume (answers.template.md + generating_rule.md)',
      'humanize-text.py balanced on every textarea/code prose',
      'parse-answer-fill.js → answer.fill.json',
      'validate-answers.js must exit 0',
      're-run prepare-answer.js to emit playbook',
    ];
  }
  if (phase === 'parse-validate') {
    return [
      'parse-answer-fill.js --answer answer.md --out answer.fill.json',
      'validate-answers.js --slug ' + slug + ' --answer answer.md',
      're-run prepare-answer.js',
    ];
  }
  return [
    'Mission: Part B autofill from answer.playbook.json',
    'Start assessment only when operator confirms real take (or already started)',
    'status/mission timer on; walk playbook actions with pauseMs',
    'Recheck → chat operator to review → Submit only on yes',
  ];
}

fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify(session, null, 2) + '\n');
// Exit 0 only when gate passed (even if answer.md still missing — phase tells next work).
process.exit(ready.ok ? 0 : 1);

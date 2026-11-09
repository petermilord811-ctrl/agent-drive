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

function readGatesReport() {
  const gatesPath = path.join(path.resolve(profileDir), 'answer.gates.json');
  if (!fs.existsSync(gatesPath)) {
    return { exists: false, ok: false, path: gatesPath, report: null };
  }
  try {
    const report = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    const ok =
      !!report.ok &&
      report.meaningPass !== false &&
      report.qualityPass !== false &&
      report.detectPass !== false;
    return { exists: true, ok, path: gatesPath, report };
  } catch (e) {
    return { exists: true, ok: false, path: gatesPath, report: null };
  }
}

function runAnswerGates() {
  // Fail-closed: re-check Meaning∧Quality∧Detect before autofill-ready.
  // Uses existing answer.aicheck.json (no --run-aicheck) so prepare stays offline-safe.
  const script = path.join(skillDir, 'answer-gates.py');
  const r = spawnSync('python', [script, '--profile', path.resolve(profileDir)], {
    encoding: 'utf8',
    maxBuffer: 8e6,
  });
  return {
    status: r.status == null ? 1 : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

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

  const fillActions = fill.actions || [];
  const leafSteps = [];
  const seenLeaf = new Set();
  for (const a of fillActions) {
    const key = String(a.step) + '|' + (a.leaf || '');
    if (a.firstInStep || !seenLeaf.has(key)) {
      seenLeaf.add(key);
      leafSteps.push({
        t: 'Step ' + (a.step != null ? a.step : '?') + ' · ' + (a.leaf || a.id),
        s: 'todo',
        step: a.step,
        leaf: a.leaf,
      });
    }
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
    /** HARD MUST — ScreenMirror panel stopwatch (TIMER.md). */
    timer: {
      must: true,
      armAfter: 'Start assessment',
      tool: 'status (+ optional mission)',
      log: path.join(path.resolve(profileDir), 'answer.timer.json'),
      perLeaf: 'status.step before fill; tree flip done; append log',
      doc: 'skills/take-dataannotation-assessment/TIMER.md',
      statusTask: 'DA Part B — ' + slug + ' / ' + path.basename(path.resolve(profileDir)),
      treeTemplate: [
        { t: '0 Preflight', s: 'done' },
        { t: '1 Start assessment', s: 'done' },
        { t: '2 Fill steps', s: 'doing', k: leafSteps },
        { t: '3 Recheck', s: 'todo' },
        { t: '4 Operator review', s: 'todo' },
      ],
    },
    actions: fillActions.map((a, idx) => {
      const p = paceById[a.id] || {};
      const recipe = recipeFor(a);
      if (a.firstInStep) {
        recipe.unshift(
          'TIMER MUST: status { step: "Step ' +
            (a.step != null ? a.step : '?') +
            ' · ' +
            (a.leaf || a.id) +
            '", text: "filling ' +
            a.id +
            '" }',
          'append answer.timer.json step_start'
        );
        recipe.push(
          'TIMER: flip tree leaf done; append answer.timer.json step_done'
        );
      }
      return {
        seq: idx + 1,
        id: a.id,
        leaf: a.leaf,
        step: a.step,
        type: a.type,
        action: a.action,
        value: a.value,
        near: a.near || null,
        required: a.required,
        confidence: a.confidence,
        firstInStep: a.firstInStep,
        thinkMs: p.thinkMs != null ? p.thinkMs : a.thinkMs,
        typeMs: p.typeMs,
        pauseMs: p.pauseMs != null ? p.pauseMs : p.thinkMs,
        recipe,
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
    const near = a.near ? ` textarea --near "${a.near}"` : ' textarea';
    return [
      'look',
      'pause thinkMs',
      `locate-click.py <look>${near}  # snap:false aim:false; prove:letter`,
      'click lx/ly → keys one non-space letter → look prove focus',
      'Backspace clear prove char (NEVER Ctrl+A / NEVER xdotool type)',
      'keys { text: value } chunks ~80 chars — NEVER human:0 / Ctrl+V on DA',
      'look prove value',
    ];
  }
  if (t === 'claude' || t === 'note') {
    return ['not a DA field — use Values fence / claude[] in fill.json'];
  }
  if (t === 'upload') {
    return ['skip or upload after real Claude share screenshot'];
  }
  return ['look', 'apply', 'look prove'];
}

// 4) Fail-closed answer gates before autofill-ready (Herman never-again)
let gates = readGatesReport();
let gatesRun = null;
if (ready.ok && fs.existsSync(answerPath) && fs.existsSync(fillPath) && playbook) {
  gatesRun = runAnswerGates();
  gates = readGatesReport();
  if (gatesRun.stdout) {
    process.stderr.write(gatesRun.stdout.slice(-4000));
  }
  if (gatesRun.stderr) {
    process.stderr.write(gatesRun.stderr.slice(-2000));
  }
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
          : !gates.ok
            ? 'gates-pending'
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
  gates: {
    ok: gates.ok,
    exists: gates.exists,
    path: gates.path,
    meaningPass: gates.report ? gates.report.meaningPass : null,
    qualityPass: gates.report ? gates.report.qualityPass : null,
    detectPass: gates.report ? gates.report.detectPass : null,
    rc: gatesRun ? gatesRun.status : null,
  },
  bioMinutes: bio,
  paths: {
    bank: fs.existsSync(bankPath) ? bankPath : null,
    answerMd: answerPath,
    fillJson: fillPath,
    paceJson: pacePath,
    playbookJson: playbook ? playbookPath : null,
    gatesJson: gates.path,
    sessionJson: sessionPath,
  },
  artifacts: {
    answerMd: fs.existsSync(answerPath),
    fillJson: fs.existsSync(fillPath),
    paceJson: fs.existsSync(pacePath),
    playbookJson: !!playbook,
    gatesJson: gates.exists,
    gatesOk: gates.ok,
  },
  phase,
  nextSteps: nextSteps(phase, ready, slug),
  hardRules: [
    'Never Submit until operator explicit yes',
    'Never keys human:0 on DA fields',
    'Always look → locate-click.py on THAT png → act',
    'Never clickText for DA content on OCR-blind hosts',
    'Verbatim only — validate-verbatim.js + validate-figures.js before captureStatus full (no summarize / no Source-OCR dumps / no half-hidden charts)',
    'Keep chat short to avoid stuck chat-wait',
    'Profiles and questions are independent',
    'TIMER MUST: after Start assessment arm status/mission tree; status.step + answer.timer.json every leaf (TIMER.md) — never skip',
    'Clear fields with Backspace only — never Ctrl+A',
    'Humanize via relay /api/humanize + SM_JOIN_KEY (verb humanize) — never HUMANIZE_API_KEY',
    'After answer.md: answer-gates.py --run-aicheck must exit 0 (MeaningPass ∧ QualityPass ∧ DetectPass) — never keep ai≤20 if Meaning/Quality fail; never done on aicheck alone (ANSWER-GATES.md)',
    'prepare-answer never emits autofill-ready unless answer.gates.json ok — fix Values / re-run gates first',
    'PART-B-FILL.md before first live keys: prove focus (non-space char) before typing; never Ctrl+C/V on DA; never SM field/Expires marks; snap:false for small targets; only operator-named host',
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
      'Write drafts/meaning.json + answer.md from bank + resume (ANSWER-GATES.md)',
      'Best-correct Values → MeaningPass → QualityPass → spoken/humanize → MQ again',
      'parse-answer-fill.js → answer.fill.json; validate-answers.js exit 0',
      'answer-gates.py --profile {profile} --run-aicheck must exit 0',
      're-run prepare-answer.js to emit playbook',
    ];
  }
  if (phase === 'parse-validate') {
    return [
      'parse-answer-fill.js --answer answer.md --out answer.fill.json',
      'validate-answers.js --slug ' + slug + ' --answer answer.md',
      'answer-gates.py --profile {profile} --run-aicheck must exit 0',
      're-run prepare-answer.js',
    ];
  }
  if (phase === 'gates-pending') {
    return [
      'FAIL-CLOSED: answer.gates.json not ok — do not live fill',
      'Fix Values from drafts/meaning.json best (surgical restore if humanize undercut)',
      'python skills/take-dataannotation-assessment/answer-gates.py --profile {profile} --run-aicheck',
      'Re-run prepare-answer.js only after gates exit 0',
    ];
  }
  if (phase === 'build-playbook') {
    return [
      'answer.fill.json present but playbook missing — re-run prepare-answer.js',
      'answer-gates.py --profile {profile} --run-aicheck must exit 0 before fill',
    ];
  }
  return [
    'Gates green (answer.gates.json ok) — live fill allowed',
    'Read PART-B-FILL.md + CLICK.md before first live keys',
    'Mission: Part B autofill from answer.playbook.json',
    'Start assessment only when operator confirms real take (or already started)',
    'TIMER MUST immediately after Start: status tree from playbook.timer + answer.timer.json start_assessment',
    'Each leaf: status.step → pauseMs → focus-prove → keys (no Ctrl+V on DA) → tree done + timer log',
    'Recheck → chat operator to review → Submit only on yes',
  ];
}

fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify(session, null, 2) + '\n');
// Exit 0 only when bank ready AND (not yet at fill, or gates ok for autofill).
const exitOk =
  ready.ok &&
  (phase === 'generate-answer-md' ||
    phase === 'parse-validate' ||
    phase === 'build-playbook' ||
    phase === 'autofill-ready');
process.exit(exitOk ? 0 : 1);

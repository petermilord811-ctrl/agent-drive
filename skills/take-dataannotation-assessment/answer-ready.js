#!/usr/bin/env node
/**
 * Part B gate: refuse answer/autofill until bank + profile inputs are ready.
 *
 * @run node skills/take-dataannotation-assessment/answer-ready.js --slug data-scientist --profile "d:/…/10-Daniel Herman"
 * @run node skills/take-dataannotation-assessment/answer-ready.js --slug software-engineer --profile "d:/…/10-Daniel Herman" --strict-full
 */
const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

let slug = arg('slug', '');
const profileDir = arg('profile', '');
const strictFull = process.argv.includes('--strict-full');
const autoPick = process.argv.includes('--auto-pick');

const errors = [];
const warnings = [];

if (!profileDir) errors.push('need --profile <profile-dir with Resume.pdf|docx>');
if (!slug && !autoPick) errors.push('need --slug <role-slug> (or --auto-pick with resume)');

if (!slug && autoPick && profileDir && fs.existsSync(profileDir)) {
  const { spawnSync } = require('child_process');
  const { slugifyRole } = require('./role-slug');
  const files = fs.readdirSync(profileDir);
  const resume =
    files.find((f) => /\.(pdf|docx|txt|md)$/i.test(f) && /resume|cv/i.test(f)) ||
    files.find((f) => /\.(pdf|docx)$/i.test(f));
  if (resume) {
    const pickScript = path.join(
      __dirname,
      '..',
      'dataannotation-assessment-workflow',
      'pick-assessment.js'
    );
    const r = spawnSync(
      process.execPath,
      [pickScript, '--resume', path.join(profileDir, resume)],
      { encoding: 'utf8', maxBuffer: 2e6 }
    );
    try {
      const j = JSON.parse(r.stdout || '{}');
      slug = (j.pick && (j.pick.slug || slugifyRole(j.pick.role))) || '';
      if (slug) warnings.push('auto-picked slug=' + slug + ' from resume');
    } catch (_) {
      errors.push('auto-pick failed to parse pick-assessment output');
    }
  }
}
if (!slug) errors.push('need --slug <role-slug>');

const bankPath = path.join(__dirname, 'problems', `problems-${slug}.md`);
if (slug && !fs.existsSync(bankPath)) {
  errors.push('missing bank: ' + bankPath);
}

let captureStatus = null;
let bioMinutes = null;
if (fs.existsSync(bankPath)) {
  const md = fs.readFileSync(bankPath, 'utf8');
  const m = md.match(/\*\*captureStatus:\*\*\s*(.+)/i);
  captureStatus = m ? m[1].trim() : null;
  if (!captureStatus) errors.push('bank missing captureStatus');
  else if (!/^full\b/i.test(captureStatus)) {
    const msg =
      `bank captureStatus is "${captureStatus}" — Part B answer/autofill requires full ` +
      `(run Part A fetch + reconcile + re-catch first)`;
    if (strictFull || !/^nearly-full\b/i.test(captureStatus)) errors.push(msg);
    else warnings.push(msg + ' [allowed with nearly-full unless --strict-full]');
  }

  const bio = md.match(/People who pass usually spend[^\n]*|About\s+\*?\*?[\d–\-]+\s*[-–]\s*[\d]+\s*minutes|About\s+\*?\*?[\d\-]+\s*minutes|\d+\s*(?:min|hour)[^\n]*/i);
  if (bio) bioMinutes = bio[0].replace(/\*/g, '').trim();

  const parsed = parseBioRange(md);
  if (parsed) bioMinutes = parsed;
}

function parseBioRange(md) {
  const t = md.replace(/[—–]/g, '-');
  const r1 = t.match(/(\d+)\s*-\s*(\d+)\s*minutes/i);
  if (r1) return { min: +r1[1], max: +r1[2], cue: r1[0] };
  if (/1 hour or more/i.test(t)) return { min: 60, max: 90, cue: '1 hour or more' };
  const r2 = t.match(/About\s+(\d+)\s*-\s*(\d+)\s*minutes/i);
  if (r2) return { min: +r2[1], max: +r2[2], cue: r2[0] };
  return null;
}

let resume = null;
if (profileDir && fs.existsSync(profileDir)) {
  const files = fs.readdirSync(profileDir);
  resume = files.find((f) => /\.(pdf|docx|txt|md)$/i.test(f) && /resume|cv/i.test(f))
    || files.find((f) => /\.(pdf|docx)$/i.test(f));
  if (!resume) errors.push('no Resume.pdf/docx in profile dir');
  const answerPath = path.join(profileDir, 'answer.md');
  const fillPath = path.join(profileDir, 'answer.fill.json');
  const pacePath = path.join(profileDir, 'answer.pace.json');
  var artifacts = {
    answerMd: fs.existsSync(answerPath),
    fillJson: fs.existsSync(fillPath),
    paceJson: fs.existsSync(pacePath),
  };
} else if (profileDir) {
  errors.push('profile dir missing: ' + profileDir);
  var artifacts = {};
}

const out = {
  ok: errors.length === 0,
  slug,
  profileDir: profileDir ? path.resolve(profileDir) : null,
  bank: fs.existsSync(bankPath) ? path.resolve(bankPath) : null,
  captureStatus,
  bioMinutes,
  resume: resume ? path.join(path.resolve(profileDir), resume) : null,
  artifacts: artifacts || {},
  next: errors.length
    ? captureStatus && !/^full|^nearly-full/i.test(captureStatus || '')
      ? 'Part A: fetch verbatim into problems-{slug}.md until captureStatus full'
      : 'fix: ' + errors[0]
    : !(artifacts && artifacts.answerMd)
      ? 'Generate {profile}/answer.md from bank + resume (ANSWER.md), then humanize → parse → validate → pace → fill'
      : 'Validate + pace + autofill (never Submit until operator review)',
  errors,
  warnings,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(out.ok ? 0 : 1);

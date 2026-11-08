#!/usr/bin/env node
/**
 * Validate profile answer.md against problems bank + fillability.
 *
 * @run node skills/take-dataannotation-assessment/validate-answers.js --slug chemist --answer path/answer.md
 * @run node skills/take-dataannotation-assessment/validate-answers.js --slug software-engineer --answer path/answer.md --mode filled-check
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const slug = arg('slug', '');
const answerPath = arg('answer', '');
const mode = arg('mode', 'ready'); // ready | filled-check
const bankPath =
  arg('bank', '') ||
  (slug
    ? path.join(__dirname, 'problems', `problems-${slug}.md`)
    : '');

const errors = [];
const warnings = [];

if (!answerPath || !fs.existsSync(answerPath)) {
  console.error('need --answer path/to/answer.md');
  process.exit(2);
}
if (!bankPath || !fs.existsSync(bankPath)) {
  errors.push('problems bank missing: ' + (bankPath || '(no --slug)'));
}

const answer = fs.readFileSync(answerPath, 'utf8');
const bank = bankPath && fs.existsSync(bankPath) ? fs.readFileSync(bankPath, 'utf8') : '';

function headings(md, re) {
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && re.test(m[1])) out.push(m[1].trim());
  }
  return out;
}

const bankQs = headings(bank, /^(Question|Coding|Tell us|Instructions)\b/i);
const answerLeaves = headings(answer, /^(Question|Coding|Tell us|Instructions)\b/i);

if (bankQs.length && answerLeaves.length < Math.max(1, bankQs.length - 1)) {
  warnings.push(
    `answer has ${answerLeaves.length} leaves vs bank ~${bankQs.length} (Instructions-only may be thin)`
  );
}

// Banned chars in fill-intended prose blocks
const fillBlocks = [];
const explRe = /###\s+Explanation \(fill\)\s*\n([\s\S]*?)(?=\n###\s+|\n##\s+|$)/gi;
let em;
while ((em = explRe.exec(answer))) fillBlocks.push(em[1]);
const taRe = /\[textarea\]\s*\n([\s\S]*?)(?=\n```|\n###|\n##|$)/gi;
while ((em = taRe.exec(answer))) fillBlocks.push(em[1]);

for (let i = 0; i < fillBlocks.length; i++) {
  const t = fillBlocks[i];
  if (/[—–]/.test(t)) errors.push(`fill block ${i + 1}: long dash found`);
  if (/:/.test(t)) errors.push(`fill block ${i + 1}: colon ':' not allowed in fill-in text`);
  if (/;/.test(t)) errors.push(`fill block ${i + 1}: semicolon ';' not allowed in fill-in text`);
  if (/\d{1,3}(,\d{3})+/.test(t)) {
    errors.push(`fill block ${i + 1}: thousands-separated numeral style not allowed`);
  }
}

// Confidence present on answerable leaves
for (const leaf of answerLeaves) {
  if (/^Instructions$/i.test(leaf)) continue;
  const section = answer.split(new RegExp(`^##\\s+${escapeRe(leaf)}\\s*$`, 'm'))[1];
  if (!section) continue;
  const body = section.split(/\n##\s+/)[0];
  if (!/\*\*Confidence:\*\*/i.test(body)) {
    warnings.push(`missing Confidence on: ${leaf}`);
  }
  if (!/###\s+UI\b/i.test(body) && !/###\s+Fields\b/i.test(body)) {
    errors.push(`leaf needs ### UI or ### Fields: ${leaf}`);
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Parse fill plan
const parse = spawnSync(
  process.execPath,
  [path.join(__dirname, 'parse-answer-fill.js'), '--answer', answerPath],
  { encoding: 'utf8' }
);
let fill = null;
if (parse.status !== 0 && parse.status != null) {
  try {
    fill = JSON.parse(parse.stdout || '{}');
  } catch (_) {
    fill = null;
  }
  if (!fill || !fill.ok) {
    errors.push(
      'parse-answer-fill failed (required empty or parse error): ' +
        ((fill && fill.stats && fill.stats.requiredEmpty) || parse.stderr || parse.stdout || '')
    );
  }
} else {
  try {
    fill = JSON.parse(parse.stdout);
  } catch (e) {
    errors.push('parse-answer-fill stdout not JSON: ' + e.message);
  }
}

if (fill && fill.ok === false) {
  errors.push('required empty fields: ' + (fill.stats.requiredEmpty || []).join(', '));
}

if (mode === 'filled-check') {
  if (!/\bstatus:\s*filled\b/i.test(answer) && !/\bstatus:\s*reviewed\b/i.test(answer)) {
    warnings.push('answer.md status is not yet filled|reviewed — update after autofill');
  }
  if (fill && fill.actions) {
    const needed = fill.actions.filter((a) => a.required && a.type !== 'skip');
    if (!needed.length) warnings.push('no required actions in fill plan');
  }
}

const result = {
  ok: errors.length === 0,
  mode,
  slug: slug || null,
  answer: path.resolve(answerPath),
  bank: bankPath ? path.resolve(bankPath) : null,
  errors,
  warnings,
  stats: fill
    ? {
        bankLeaves: bankQs.length,
        answerLeaves: answerLeaves.length,
        actions: fill.stats.actions,
        required: fill.stats.required,
      }
    : { bankLeaves: bankQs.length, answerLeaves: answerLeaves.length },
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(result.ok ? 0 : 1);

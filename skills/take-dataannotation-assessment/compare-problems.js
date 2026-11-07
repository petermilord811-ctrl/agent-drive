#!/usr/bin/env node
// @tool Compare a fresh assessment capture to this skill's problems/{problems-{slug}.md} bank
// @run  node skills/take-dataannotation-assessment/compare-problems.js --slug medical
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const skillDir = __dirname;
const bankDir = path.join(skillDir, 'problems');
const slug = arg('slug', '');
const existingPath = arg(
  'existing',
  slug ? path.join(bankDir, `problems-${slug}.md`) : ''
);
const newPath = arg(
  'new',
  slug ? path.join(bankDir, `problems-${slug}.capture.md`) : ''
);

if (!existingPath || !newPath) {
  console.error('need --slug <slug> (or --existing and --new under skills/.../problems/)');
  process.exit(2);
}

function norm(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function sectionMap(md) {
  const text = norm(md);
  const parts = text.split(/\n(?=##\s+)/);
  const map = {};
  for (const part of parts) {
    const m = part.match(/^##\s+(.+?)\s*\n/);
    if (!m) continue;
    map[m[1].trim().toLowerCase()] = hash(norm(part));
  }
  return map;
}

function questionKeys(map) {
  return Object.keys(map)
    .filter((k) => /^question\b/i.test(k) || /^q\d/i.test(k))
    .sort();
}

const existingRaw = fs.existsSync(existingPath) ? fs.readFileSync(existingPath, 'utf8') : null;
if (!fs.existsSync(newPath)) {
  console.error('capture not found: ' + newPath);
  process.exit(2);
}
const newRaw = fs.readFileSync(newPath, 'utf8');

if (!existingRaw) {
  process.stdout.write(
    JSON.stringify(
      {
        slug: slug || null,
        changed: true,
        reason: 'no existing bank — save capture as problems-{slug}.md in skills/.../problems/',
        existing: null,
        neu: path.resolve(newPath),
        action: 'create',
      },
      null,
      2
    ) + '\n'
  );
  process.exit(0);
}

const a = norm(existingRaw);
const b = norm(newRaw);
const sameWhole = a === b;
const mapA = sectionMap(a);
const mapB = sectionMap(b);
const keys = Array.from(new Set([...Object.keys(mapA), ...Object.keys(mapB)])).sort();
const sectionDiffs = [];
for (const k of keys) {
  if (mapA[k] !== mapB[k]) {
    sectionDiffs.push({
      section: k,
      status: !mapA[k] ? 'added' : !mapB[k] ? 'removed' : 'changed',
    });
  }
}

const out = {
  slug: slug || null,
  bankDir: path.resolve(bankDir),
  changed: !sameWhole,
  existing: path.resolve(existingPath),
  neu: path.resolve(newPath),
  hashExisting: hash(a),
  hashNew: hash(b),
  questionCountExisting: questionKeys(mapA).length,
  questionCountNew: questionKeys(mapB).length,
  sectionDiffs,
  action: sameWhole ? 'keep' : 'update-bank-from-capture',
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(sameWhole ? 0 : 1);

#!/usr/bin/env node
// @tool Compare a fresh assessment capture to an existing problems-{slug}.md bank
// @run  node skills/take-dataannotation-assessment/compare-problems.js --slug medical --existing ../problems-medical.md --new ../problems-medical.capture.md
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const slug = arg('slug', '');
const existingPath = arg('existing', slug ? path.join('..', `problems-${slug}.md`) : '');
const newPath = arg('new', slug ? path.join('..', `problems-${slug}.capture.md`) : '');

if (!existingPath || !newPath) {
  console.error('need --existing <bank.md> --new <capture.md> (and preferably --slug)');
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
    const key = m[1].trim().toLowerCase();
    map[key] = hash(norm(part));
  }
  return map;
}

function questionKeys(map) {
  return Object.keys(map)
    .filter((k) => /^question\b/i.test(k) || /^q\d/i.test(k))
    .sort();
}

const existingRaw = fs.existsSync(existingPath) ? fs.readFileSync(existingPath, 'utf8') : null;
const newRaw = fs.readFileSync(newPath, 'utf8');

if (!existingRaw) {
  const out = {
    slug: slug || null,
    changed: true,
    reason: 'no existing bank — save capture as problems-{slug}.md',
    existing: null,
    neu: path.resolve(newPath),
    action: 'create',
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
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

const qA = questionKeys(mapA);
const qB = questionKeys(mapB);

const out = {
  slug: slug || null,
  changed: !sameWhole,
  existing: path.resolve(existingPath),
  neu: path.resolve(newPath),
  hashExisting: hash(a),
  hashNew: hash(b),
  questionCountExisting: qA.length,
  questionCountNew: qB.length,
  sectionDiffs,
  action: sameWhole ? 'keep' : 'update-bank-from-capture',
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(sameWhole ? 0 : 1);

#!/usr/bin/env node
// @tool Score a resume against the DataAnnotation assessment/role catalog
// @run  node skills/dataannotation-assessment-workflow/pick-assessment.js --resume path/to/resume.txt|pdf|docx
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { slugifyRole } = require('../take-dataannotation-assessment/role-slug');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const resumePath = arg('resume', '');
const topN = parseInt(arg('top', '5'), 10) || 5;
const catalogPath = path.join(__dirname, 'assessments.json');

if (!resumePath) {
  console.error('need --resume <file> (txt/md/pdf/docx — PDF/DOCX are extracted, not read as binary)');
  process.exit(2);
}
if (!fs.existsSync(resumePath)) {
  console.error('resume not found: ' + resumePath);
  process.exit(2);
}

/**
 * HARD: never fs.readFileSync a .pdf/.docx as utf8 — binary substrings fake-hit
 * short keywords like "ui" / "ux" (Daniel Herman 2026-11-08 → Designer score 2).
 */
function loadResumeText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf' || ext === '.docx') {
    const script = path.join(__dirname, 'extract-resume-text.py');
    const pyCandidates = [
      process.env.DA_PYTHON,
      process.env.PYTHON,
      // pyenv install that has pypdf on this workstation (spawn PATH often misses shims)
      path.join(
        process.env.USERPROFILE || '',
        '.pyenv',
        'pyenv-win',
        'versions',
        '3.12.10',
        'python.exe'
      ),
      'python',
      'py',
    ].filter(Boolean);
    let lastErr = '';
    for (const py of pyCandidates) {
      const args =
        py === 'py'
          ? ['-3', script, path.resolve(filePath)]
          : [script, path.resolve(filePath)];
      const bin = py === 'py' ? 'py' : py;
      const r = spawnSync(bin, args, {
        encoding: 'utf8',
        maxBuffer: 4e6,
        env: process.env,
        shell: false,
      });
      if (r.status === 0) return r.stdout || '';
      lastErr = (r.stderr || r.stdout || r.error && r.error.message || 'unknown').toString();
    }
    console.error((ext === '.pdf' ? 'PDF' : 'DOCX') + ' extract failed:', lastErr);
    process.exit(2);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Whole-token match. Fixes:
 * - "ui" ⊂ "building" (Design false pick)
 * - "chemist" ⊂ "biochemistry" (STEM false pick on Daniel Herman)
 * Multi-word phrases still match as contiguous text with non-letter edges.
 */
function keywordHit(haystack, kw) {
  const k = String(kw).toLowerCase().trim();
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|[^a-z0-9])' + esc + '(?:[^a-z0-9]|$)', 'i');
  return re.test(haystack);
}

const text = loadResumeText(resumePath).toLowerCase();
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

function scoreAssessment(a) {
  let score = 0;
  const hits = [];
  for (const kw of a.keywords || []) {
    const k = String(kw).toLowerCase();
    if (!k) continue;
    if (keywordHit(text, k)) {
      score += Math.max(1, Math.min(4, Math.ceil(k.length / 8)));
      hits.push(k);
    }
  }
  let bestRole = a.roles[0] || a.name;
  let roleHits = 0;
  for (const role of a.roles || []) {
    const r = role.toLowerCase();
    // HARD: do not use bare includes() — "Chemist" ⊂ "biochemistry" (Daniel Herman)
    if (keywordHit(text, r)) {
      score += 6;
      roleHits += 1;
      bestRole = role;
      hits.push('role:' + role);
    }
  }
  return { id: a.id, name: a.name, category: a.category, score, bestRole, roleHits, hits };
}

const ranked = catalog.assessments
  .map(scoreAssessment)
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

const top = ranked.slice(0, topN);
const pick = top[0] && top[0].score > 0 ? top[0] : ranked.find((r) => r.id === 'generalist') || top[0];

const out = {
  pick: {
    assessmentId: pick.id,
    assessment: pick.name,
    category: pick.category,
    role: pick.bestRole,
    slug: slugifyRole(pick.bestRole),
    score: pick.score,
    hits: pick.hits.slice(0, 12),
    bank: `skills/take-dataannotation-assessment/problems/problems-${slugifyRole(pick.bestRole)}.md`,
  },
  alternatives: top.map((t) => ({
    assessment: t.name,
    role: t.bestRole,
    slug: slugifyRole(t.bestRole),
    score: t.score,
    hits: t.hits.slice(0, 8),
  })),
  resume: path.resolve(resumePath),
  resumeChars: text.length,
  extracted: /\.pdf$/i.test(resumePath) || /\.docx$/i.test(resumePath),
  catalogVersion: catalog.version,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');

#!/usr/bin/env node
// @tool Score a resume against the DataAnnotation assessment/role catalog
// @run  node skills/dataannotation-assessment-workflow/pick-assessment.js --resume path/to/resume.txt
const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const resumePath = arg('resume', '');
const topN = parseInt(arg('top', '5'), 10) || 5;
const catalogPath = path.join(__dirname, 'assessments.json');

if (!resumePath) {
  console.error('need --resume <file> (txt/md/extracted text)');
  process.exit(2);
}

const text = fs.readFileSync(resumePath, 'utf8').toLowerCase();
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

function scoreAssessment(a) {
  let score = 0;
  const hits = [];
  for (const kw of a.keywords || []) {
    const k = String(kw).toLowerCase();
    if (!k) continue;
    if (text.includes(k)) {
      score += Math.max(1, Math.min(4, Math.ceil(k.length / 8)));
      hits.push(k);
    }
  }
  // Prefer a specific role title that appears in the resume
  let bestRole = a.roles[0] || a.name;
  let roleHits = 0;
  for (const role of a.roles || []) {
    const r = role.toLowerCase();
    if (text.includes(r)) {
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
    score: pick.score,
    hits: pick.hits.slice(0, 12),
  },
  alternatives: top.map((t) => ({
    assessment: t.name,
    role: t.bestRole,
    score: t.score,
  })),
  resume: path.resolve(resumePath),
  catalogVersion: catalog.version,
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');

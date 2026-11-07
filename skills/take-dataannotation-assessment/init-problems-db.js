#!/usr/bin/env node
// @tool Create/refresh stub problems-{slug}.md for every Browse-roles card (103) in this skill's problems/ bank
// @run  node skills/take-dataannotation-assessment/init-problems-db.js
const fs = require('fs');
const path = require('path');
const { listRoles } = require('./role-slug.js');

const skillDir = __dirname;
const bankDir = path.join(skillDir, 'problems');
const templatePath = path.join(skillDir, 'problems.template.md');
const catalogPath = path.join(
  skillDir,
  '..',
  'dataannotation-assessment-workflow',
  'assessments.json'
);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const template = fs.readFileSync(templatePath, 'utf8');
const roles = listRoles(catalog);

fs.mkdirSync(bankDir, { recursive: true });

function stubBody(meta) {
  return template
    .replace(/\{Role\}/g, meta.role)
    .replace(/\{Assessment type\}/g, meta.assessment)
    .replace(/\{Category\}/g, meta.category || '—')
    .replace(/\{slug\}/g, meta.slug)
    .replace(/YYYY-MM-DD/g, 'PENDING-CAPTURE')
    .replace(
      /\{Overview paragraph\(s\) from the role card\.\}/g,
      '_Not captured yet. Open this role on Browse roles and fill Bio / Requirements / Instructions / Questions._'
    )
    .replace(/\{e\.g\. 63 hired recently\}/g, '_pending_')
    .replace(/\{e\.g\. Up to \$125\+\/hr\}/g, '_pending_')
    .replace(
      /\{e\.g\. People who pass usually spend 1 hour 30 minutes or more\. Take the time you need\.\}/g,
      '_pending_'
    )
    .replace(
      /\{e\.g\. available for 120 hours after entering work mode\}/g,
      '_pending_'
    )
    .replace(
      /\{Welcome and onboarding instructions, timing, break\/cache guidance — without No-LLMs paragraphs\.\}/g,
      '_pending_'
    )
    .replace(
      /\{If the assessment has a dedicated experience step, copy prompts and fields here\. Otherwise omit this section\.\}/g,
      '_pending or omit_'
    )
    .replace(
      /\{Full prompt, choices, model responses as shown\.\}/g,
      '_Capture Question 1+ from the live assessment (usually 10+ steps)._'
    )
    .replace(/\{Follow-up \/ explanation prompt\.\}/g, '_pending_')
    .replace(/^…\s*$/m, '_…_')
    .replace(/\n- …\n/g, '\n- _pending_\n');
}

const indexRows = [];
let created = 0;
let skipped = 0;
const slugCollisions = {};

for (const meta of roles) {
  slugCollisions[meta.slug] = (slugCollisions[meta.slug] || 0) + 1;
}
for (const [s, n] of Object.entries(slugCollisions)) {
  if (n > 1) {
    console.error('slug collision: ' + s + ' x' + n);
    process.exit(3);
  }
}

for (const meta of roles) {
  const fileName = `problems-${meta.slug}.md`;
  const file = path.join(bankDir, fileName);
  if (fs.existsSync(file)) {
    const body = fs.readFileSync(file, 'utf8');
    let status = 'captured';
    if (/PENDING-CAPTURE|_Not captured yet/i.test(body)) status = 'stub';
    else if (/captureStatus:\s*incomplete|MUST re-capture|bio-only|_pending — bio loop/i.test(body))
      status = 'incomplete';
    else if (!/^## Bio \(assessment intro\)/m.test(body) || !/^## Question /m.test(body))
      status = 'incomplete';
    indexRows.push({
      slug: meta.slug,
      file: fileName,
      status,
      role: meta.role,
      assessmentId: meta.assessmentId,
      assessment: meta.assessment,
      category: meta.category,
    });
    skipped += 1;
    continue;
  }
  const note =
    `\n\n<!-- role: ${meta.role} | assessmentId: ${meta.assessmentId} | category: ${meta.category} -->\n`;
  fs.writeFileSync(file, stubBody(meta).trimEnd() + note + '\n', 'utf8');
  indexRows.push({
    slug: meta.slug,
    file: fileName,
    status: 'stub',
    role: meta.role,
    assessmentId: meta.assessmentId,
    assessment: meta.assessment,
    category: meta.category,
  });
  created += 1;
}

const byFamily = {};
for (const r of indexRows) {
  byFamily[r.assessmentId] = byFamily[r.assessmentId] || { captured: 0, stub: 0, n: 0 };
  byFamily[r.assessmentId].n += 1;
  byFamily[r.assessmentId][r.status] += 1;
}

const readme = `---
name: DataAnnotation problems bank (per role)
when: one markdown bank per Browse-roles card — 103 roles; ignore workspace-root DA assessments/problems-*.md
tags: dataannotation, problems, bank, roles
---
# problems/ — agent-drive role problem bank

**Target count: ${indexRows.length}** (matches Browse roles **All (${indexRows.length})** when catalog is current).

One file per **role card**, not per assessment family. Family assessments often share question
sets; still keep a file per role so Bio / pay / hiring cues stay accurate.

| Status | Count |
|--------|-------|
| stub | ${indexRows.filter((r) => r.status === 'stub').length} |
| captured | ${indexRows.filter((r) => r.status === 'captured').length} |

## By assessment family

| Family id | Roles | stub | captured |
|-----------|------:|-----:|---------:|
${Object.entries(byFamily)
  .map(([id, s]) => `| \`${id}\` | ${s.n} | ${s.stub} | ${s.captured} |`)
  .join('\n')}

## All roles

| Role | File | Status | Family |
|------|------|--------|--------|
${indexRows
  .map(
    (r) =>
      `| ${r.role} | [\`${r.file}\`](./${r.file}) | ${r.status} | \`${r.assessmentId}\` |`
  )
  .join('\n')}

## Commands

\`\`\`bash
node skills/take-dataannotation-assessment/init-problems-db.js
node skills/take-dataannotation-assessment/compare-problems.js --slug software-engineer
\`\`\`
`;

fs.writeFileSync(path.join(bankDir, 'README.md'), readme, 'utf8');
fs.writeFileSync(
  path.join(bankDir, 'index.json'),
  JSON.stringify(
    {
      version: 3,
      updated: new Date().toISOString().slice(0, 10),
      expectedRoles: 103,
      total: indexRows.length,
      banks: indexRows,
      byFamily,
    },
    null,
    2
  ) + '\n',
  'utf8'
);

// Role → slug map for agents
const roleMap = {};
for (const r of indexRows) roleMap[r.role] = r.slug;
fs.writeFileSync(
  path.join(skillDir, 'problems-slugs.json'),
  JSON.stringify(
    {
      version: 3,
      updated: new Date().toISOString().slice(0, 10),
      bankDir: 'skills/take-dataannotation-assessment/problems',
      note: 'One problems-{slug}.md per Browse-roles card. Catalog role count should match All (N) on workers/projects.',
      expectedRoles: 103,
      total: indexRows.length,
      filename: 'problems-{slug}.md',
      captureFilename: 'problems-{slug}.capture.md',
      byRole: roleMap,
      byAssessmentId: Object.fromEntries(
        (catalog.assessments || []).map((a) => [a.id, (a.roles || []).map((role) => roleMap[role])])
      ),
    },
    null,
    2
  ) + '\n',
  'utf8'
);

console.log(
  JSON.stringify(
    {
      bankDir: path.relative(process.cwd(), bankDir).replace(/\\/g, '/'),
      total: indexRows.length,
      expectedRoles: 103,
      match103: indexRows.length === 103,
      created,
      skipped,
      byFamily,
    },
    null,
    2
  )
);

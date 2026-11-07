#!/usr/bin/env node
// @tool Create/refresh stub problems-{slug}.md files in this skill's problems/ bank
// @run  node skills/take-dataannotation-assessment/init-problems-db.js
const fs = require('fs');
const path = require('path');

const skillDir = __dirname;
const bankDir = path.join(skillDir, 'problems');
const slugsPath = path.join(skillDir, 'problems-slugs.json');
const templatePath = path.join(skillDir, 'problems.template.md');
const catalogPath = path.join(
  skillDir,
  '..',
  'dataannotation-assessment-workflow',
  'assessments.json'
);

const slugsCfg = JSON.parse(fs.readFileSync(slugsPath, 'utf8'));
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const template = fs.readFileSync(templatePath, 'utf8');

fs.mkdirSync(bankDir, { recursive: true });

const byId = {};
for (const a of catalog.assessments) byId[a.id] = a;

const slugMeta = [];
const seen = new Set();

function addSlug(slug, meta) {
  if (seen.has(slug)) return;
  seen.add(slug);
  slugMeta.push({ slug, ...meta });
}

for (const [assessmentId, slug] of Object.entries(slugsCfg.byAssessmentId)) {
  const a = byId[assessmentId] || {};
  addSlug(slug, {
    assessmentId,
    name: a.name || assessmentId,
    category: a.category || '',
    roles: a.roles || [],
  });
}

for (const slug of slugsCfg.extraSlugs || []) {
  addSlug(slug, {
    assessmentId: 'stem',
    name: 'STEM Assessment (' + slug + ')',
    category: 'STEM',
    roles: Object.entries(slugsCfg.stemByRoleHint || {})
      .filter(([, s]) => s === slug)
      .map(([role]) => role),
  });
}

function stubBody(meta) {
  const roles = (meta.roles || []).join(', ') || '(pick role on Browse roles)';
  return template
    .replace(/\{Role\}/g, meta.roles?.[0] || meta.name)
    .replace(/\{Assessment type\}/g, meta.name)
    .replace(/\{Category\}/g, meta.category || '—')
    .replace(/\{slug\}/g, meta.slug)
    .replace(/YYYY-MM-DD/g, 'PENDING-CAPTURE')
    .replace(
      /\{Overview paragraph\(s\) from the role card\.\}/g,
      '_Not captured yet. Open the role card and fill Bio / Requirements / Instructions / Questions._'
    )
    .replace(
      /\{e\.g\. 63 hired recently\}/g,
      '_pending_'
    )
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

for (const meta of slugMeta) {
  const file = path.join(bankDir, `problems-${meta.slug}.md`);
  const rel = path.relative(path.join(skillDir, '..', '..'), file).replace(/\\/g, '/');
  if (fs.existsSync(file)) {
    const body = fs.readFileSync(file, 'utf8');
    const status = /PENDING-CAPTURE|_Not captured yet/i.test(body) ? 'stub' : 'captured';
    indexRows.push({ slug: meta.slug, file: `problems-${meta.slug}.md`, status, assessmentId: meta.assessmentId, roles: meta.roles });
    skipped += 1;
    continue;
  }
  const headerNote =
    `\n\n<!-- roles: ${rolesList(meta)} | assessmentId: ${meta.assessmentId} -->\n`;
  fs.writeFileSync(file, stubBody(meta).trimEnd() + headerNote + '\n', 'utf8');
  indexRows.push({ slug: meta.slug, file: `problems-${meta.slug}.md`, status: 'stub', assessmentId: meta.assessmentId, roles: meta.roles });
  created += 1;
}

function rolesList(meta) {
  return (meta.roles || []).join('; ') || '—';
}

const readme = `---
name: DataAnnotation problems bank
when: local problem database for take-dataannotation-assessment — do not use workspace-root DA assessments/problems-*.md
tags: dataannotation, problems, bank
---
# problems/ — agent-drive assessment problem bank

Owned by \`skills/take-dataannotation-assessment/\`. Live captures overwrite stubs.

| Slug | File | Status | Assessment id | Example roles |
|------|------|--------|---------------|---------------|
${indexRows
  .map(
    (r) =>
      `| \`${r.slug}\` | [\`${r.file}\`](./${r.file}) | ${r.status} | \`${r.assessmentId}\` | ${(r.roles || []).slice(0, 3).join(', ') || '—'} |`
  )
  .join('\n')}

## Commands

\`\`\`bash
# Create any missing stubs (never overwrites captured files)
node skills/take-dataannotation-assessment/init-problems-db.js

# After a live re-catch:
node skills/take-dataannotation-assessment/compare-problems.js --slug medical
\`\`\`

Paths resolve to this folder automatically (\`problems-slugs.json\` → \`bankDir\`).
`;

fs.writeFileSync(path.join(bankDir, 'README.md'), readme, 'utf8');
fs.writeFileSync(path.join(bankDir, 'index.json'), JSON.stringify({ version: 2, updated: new Date().toISOString().slice(0, 10), banks: indexRows }, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({ bankDir: path.relative(process.cwd(), bankDir).replace(/\\/g, '/'), created, skipped, total: indexRows.length }, null, 2));

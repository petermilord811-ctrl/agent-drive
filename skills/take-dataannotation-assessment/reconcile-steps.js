#!/usr/bin/env node
/**
 * HARD gate: sidebar leaf count ("Step K of N") must match bank **Step:** entries.
 *
// @tool Reconcile sidebar steps against problems-{slug}.md
 * @run  node skills/take-dataannotation-assessment/reconcile-steps.js --slug software-engineer
// @tool Reconcile sidebar steps against problems-{slug}.md
 * @run  node skills/take-dataannotation-assessment/reconcile-steps.js --slug software-engineer --sidebar-json path.json
 *
 * Sidebar JSON shape (from OCR / manual inventory at fetch start):
 * {
 *   "total": 11,
 *   "current": 6,
 *   "leaves": [
 *     {"step":1,"label":"Instructions"},
 *     {"step":2,"label":"Question 1: ..."},
 *     ...
 *   ]
 * }
 *
 * Without --sidebar-json: only checks bank has contiguous Step 1..N and
 * unique step numbers equal to declared "of N".
 */
const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const slug = arg('slug', '');
const bankPath =
  arg('bank', '') ||
  (slug
    ? path.join(__dirname, 'problems', `problems-${slug}.md`)
    : '');
const sidebarPath = arg('sidebar-json', '');

if (!bankPath || !fs.existsSync(bankPath)) {
  console.error('need --slug <slug> with problems/problems-{slug}.md');
  process.exit(2);
}

const md = fs.readFileSync(bankPath, 'utf8');

/** @type {{n:number, of:number, heading:string, line:number}[]} */
const steps = [];
const headingStack = [];
const lines = md.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const h = lines[i].match(/^##\s+(.+?)\s*$/);
  if (h) headingStack.push(h[1].trim());
  const m = lines[i].match(/\*\*Step:\*\*\s*Step\s+(\d+)\s+of\s+(\d+)/i);
  if (m) {
    steps.push({
      n: +m[1],
      of: +m[2],
      heading: headingStack[headingStack.length - 1] || '(unknown)',
      line: i + 1,
    });
  }
}

const declaredOf = steps.length ? Math.max(...steps.map((s) => s.of)) : 0;
const nums = steps.map((s) => s.n).sort((a, b) => a - b);
const unique = [...new Set(nums)];
const missing = [];
const dupes = [];
for (let i = 1; i <= declaredOf; i++) {
  const c = nums.filter((n) => n === i).length;
  if (c === 0) missing.push(i);
  if (c > 1) dupes.push(i);
}
const outOfOrder = steps.some((s, idx) => idx > 0 && s.n < steps[idx - 1].n);

let sidebar = null;
if (sidebarPath) {
  sidebar = JSON.parse(fs.readFileSync(sidebarPath, 'utf8'));
}

const sidebarLeaves = sidebar && Array.isArray(sidebar.leaves) ? sidebar.leaves : null;
const sidebarTotal = sidebar
  ? sidebar.total || (sidebarLeaves ? sidebarLeaves.length : null)
  : null;

const bankVsSidebar =
  sidebarTotal == null
    ? null
    : {
        sidebarTotal,
        bankStepCount: unique.length,
        match: sidebarTotal === unique.length && missing.length === 0,
        missingInBank: missing,
        extraInBank:
          sidebarLeaves && sidebarLeaves.length
            ? unique.filter(
                (n) => !sidebarLeaves.some((L) => (L.step || L.n) === n)
              )
            : [],
      };

const ok =
  declaredOf > 0 &&
  missing.length === 0 &&
  dupes.length === 0 &&
  unique.length === declaredOf &&
  !outOfOrder &&
  (bankVsSidebar == null || bankVsSidebar.match);

const report = {
  ok,
  slug: slug || null,
  bank: path.resolve(bankPath),
  declaredOf,
  fetchedUniqueSteps: unique.length,
  stepsInDocOrder: steps.map((s) => ({
    step: s.n,
    of: s.of,
    heading: s.heading,
    line: s.line,
  })),
  missing,
  dupes,
  outOfOrder,
  bankVsSidebar,
  rule:
    'Inventory left-sidebar LEAF rows (not PART headers) at fetch start. ' +
    'Bank must have exactly one **Step:** Step k of N for each k in 1..N, ' +
    'in ascending sidebar order. captureStatus cannot be full while missing/outOfOrder.',
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exit(ok ? 0 : 1);

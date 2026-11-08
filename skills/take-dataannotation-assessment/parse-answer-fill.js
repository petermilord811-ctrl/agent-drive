#!/usr/bin/env node
/**
 * Parse profile answer.md → answer.fill.json for agent autofill.
 *
 * @run node skills/take-dataannotation-assessment/parse-answer-fill.js --answer path/answer.md --out path/answer.fill.json
 *
 * Reads each ## leaf's Fields table (preferred) or UI [✅] markers as fallback.
 */
const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const answerPath = arg('answer', '');
const outPath = arg('out', '');

if (!answerPath || !fs.existsSync(answerPath)) {
  console.error('need --answer path/to/answer.md');
  process.exit(2);
}

const md = fs.readFileSync(answerPath, 'utf8').replace(/\r\n/g, '\n');

function parseYamlFront(block) {
  const m = block.match(/```ya?ml\n([\s\S]*?)```/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('{') && v.endsWith('}')) {
      try {
        meta[kv[1]] = Function('"use strict";return (' + v + ')')();
      } catch (_) {
        meta[kv[1]] = v;
      }
    } else {
      meta[kv[1]] = v.replace(/^['"]|['"]$/g, '');
    }
  }
  return meta;
}

function splitLeaves(text) {
  const parts = text.split(/\n(?=##\s+)/);
  const leaves = [];
  for (const part of parts) {
    const hm = part.match(/^##\s+(.+?)\s*\n/);
    if (!hm) continue;
    const title = hm[1].trim();
    if (/^Timing$/i.test(title)) continue;
    leaves.push({ title, body: part });
  }
  return leaves;
}

function stepOf(body) {
  const m = body.match(/\*\*Step:\*\*\s*Step\s+(\d+)\s+of\s+(\d+)/i);
  return m ? { n: +m[1], of: +m[2] } : null;
}

function confidenceOf(body) {
  const m = body.match(/\*\*Confidence:\*\*\s*([0-9.]+)/i);
  return m ? Number(m[1]) : null;
}

function parseFieldsTable(body) {
  const idx = body.search(/###\s+Fields\b/i);
  if (idx < 0) return [];
  const slice = body.slice(idx);
  const lines = slice.split('\n');
  const rows = [];
  let header = null;
  for (const line of lines) {
    if (/^###\s+/.test(line) && !/^###\s+Fields/i.test(line)) break;
    if (!/^\|/.test(line)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.every((c) => /^[-:]+$/.test(c))) continue;
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      continue;
    }
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = cells[i] != null ? cells[i] : '';
    });
    rows.push(obj);
  }
  return rows;
}

function parseUiChecked(body) {
  const m = body.match(/###\s+UI\s*\n```[\s\S]*?```/i);
  if (!m) return [];
  const block = m[0];
  const checked = [];
  for (const line of block.split('\n')) {
    const r = line.match(/^\[✅\]\s*(.+)\s*$/);
    if (r) checked.push(r[1].trim());
    const input = line.match(/^\[input\]\s*(.*)$/);
    if (input) checked.push({ type: 'text', value: input[1].trim() });
    const ta = line.match(/^\[textarea\]\s*$/);
    if (ta) {
      /* value often in Explanation (fill) */
    }
  }
  return checked;
}

function parseExplanationFill(body) {
  const m = body.match(/###\s+Explanation \(fill\)\s*\n([\s\S]*?)(?=\n###\s+|\n##\s+|$)/i);
  if (!m) return '';
  return m[1].trim();
}

function parseJsonish(v) {
  const s = String(v || '').trim();
  if (!s) return s;
  if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
    try {
      return JSON.parse(s.replace(/'/g, '"'));
    } catch (_) {
      try {
        return Function('"use strict";return (' + s + ')')();
      } catch (_e2) {
        return s;
      }
    }
  }
  return s;
}

function requiredOf(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'false' || s === '0' || s === 'no') return false;
  return true;
}

const meta = parseYamlFront(md);
const leaves = splitLeaves(md);
const actions = [];
const leafSummaries = [];

for (const leaf of leaves) {
  const step = stepOf(leaf.body);
  const conf = confidenceOf(leaf.body);
  const rows = parseFieldsTable(leaf.body);
  const explain = parseExplanationFill(leaf.body);
  const uiChecked = parseUiChecked(leaf.body);

  leafSummaries.push({
    title: leaf.title,
    step: step ? step.n : null,
    stepOf: step ? step.of : null,
    confidence: conf,
    fieldCount: rows.length,
  });

  if (rows.length) {
    let first = true;
    for (const row of rows) {
      const type = (row.type || '').toLowerCase();
      let value = parseJsonish(row.value);
      if ((type === 'textarea' || type === 'text') && (!value || value === '{humanized}' || value === '…') && explain) {
        value = explain;
      }
      actions.push({
        id: row.id || `${leaf.title}-${actions.length}`,
        leaf: leaf.title,
        step: step ? step.n : null,
        stepOf: step ? step.of : null,
        confidence: conf,
        type,
        action: (row.action || '').toLowerCase() || inferAction(type),
        value,
        required: requiredOf(row.required),
        firstInStep: first,
        thinkMs: row.thinkms ? Number(row.thinkms) : null,
      });
      first = false;
    }
    continue;
  }

  // Fallback: UI checkmarks only
  if (uiChecked.length) {
    const labels = uiChecked.filter((x) => typeof x === 'string');
    if (labels.length) {
      actions.push({
        id: `ui-${step ? step.n : actions.length}`,
        leaf: leaf.title,
        step: step ? step.n : null,
        stepOf: step ? step.of : null,
        confidence: conf,
        type: labels.length > 1 ? 'checkbox' : 'radio',
        action: labels.length > 1 ? 'selectMany' : 'select',
        value: labels.length > 1 ? labels : labels[0],
        required: true,
        firstInStep: true,
        thinkMs: null,
      });
    }
    if (explain) {
      actions.push({
        id: `explain-${step ? step.n : actions.length}`,
        leaf: leaf.title,
        step: step ? step.n : null,
        stepOf: step ? step.of : null,
        confidence: conf,
        type: 'textarea',
        action: 'type',
        value: explain,
        required: true,
        firstInStep: false,
        thinkMs: null,
      });
    }
  }
}

function inferAction(type) {
  if (type === 'radio' || type === 'agree') return 'select';
  if (type === 'checkbox') return 'selectMany';
  if (type === 'drag') return 'reorder';
  if (type === 'skip') return 'skip';
  return 'type';
}

const requiredEmpty = actions.filter(
  (a) =>
    a.required &&
    a.type !== 'skip' &&
    a.type !== 'agree' &&
    (a.value == null || a.value === '' || (Array.isArray(a.value) && !a.value.length))
);

const result = {
  ok: requiredEmpty.length === 0,
  source: path.resolve(answerPath),
  meta,
  leaves: leafSummaries,
  actions,
  stats: {
    leaves: leafSummaries.length,
    actions: actions.length,
    required: actions.filter((a) => a.required).length,
    requiredEmpty: requiredEmpty.map((a) => a.id),
  },
};

const text = JSON.stringify(result, null, 2);
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, text + '\n', 'utf8');
}
process.stdout.write(text + '\n');
process.exit(result.ok ? 0 : 1);

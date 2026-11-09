#!/usr/bin/env node
/**
 * Fail a problem bank that contains summarized / edited / OCR-repaired problem text.
 * HARD RULE 1: verbatim only — never paraphrase, shorten, clean up, or invent.
 *
 * Usage:
 *   node validate-verbatim.js --slug data-scientist
 *   node validate-verbatim.js --file path/to/problems-….md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'problems');

const FORBIDDEN = [
  { re: /summary from looks/i, why: 'explicit summary marker' },
  { re: /full verbatim pending/i, why: 'placeholder admitting non-verbatim body' },
  { re: /OCR\/vision repairs/i, why: 'OCR repair note in bank body' },
  { re: /Bracketed words are/i, why: 'admits bracket inventions' },
  { re: /\[[A-Za-z][^\]]*\](?!\()/g, why: 'square-bracket word insertions (invented repairs) — not markdown images or numeric arrays', inPrompt: true },
  { re: /\(as shown\)/i, why: 'editorial aside' },
  { re: /\(summary[^)]*\)/i, why: 'parenthetical summary' },
  { re: /Less detail on cleaning than/i, why: 'comparative paraphrase of responses' },
  { re: /summary from looks/i, why: 'summary marker' },
  { re: /\bcleaned up\b/i, why: 'cleanup admission' },
  { re: /\.\.\. \(additional rows may continue/i, why: 'ellided dataset — capture full rows or PNG only' },
  // Live misses 2026-11-08 DS fetch (99588)
  { re: /\*\*Source OCR[:\s]|#{1,3}\s*Source OCR\b|\bSource OCR\s*:/i, why: 'Source OCR dump field — bank STYLE is Prompt/Choices/Write-in only' },
  { re: /select(?:ed|ing)?\s+(?:text|for)\s+(?:for\s+)?(?:better\s+)?OCR|highlight(?:ed|ing)?\s+text\s+for\s+OCR|text-select\s+for\s+OCR/i, why: 'admits select/highlight-for-OCR (forbidden)' },
  { re: /from\s+(?:the\s+)?(?:image_description|vision\s+summary|vision\s+description)|paraphrase[sd]?\s+from\s+vision/i, why: 'vision/image_description used as problem body (not verbatim)' },
  { re: /Approx(?:imately|\.)\s+\d+%\s*$/im, why: 'approximate chart paraphrase — embed full figure PNG instead' },
];

function loadFile(argv) {
  const iSlug = argv.indexOf('--slug');
  const iFile = argv.indexOf('--file');
  if (iFile >= 0 && argv[iFile + 1]) return path.resolve(argv[iFile + 1]);
  if (iSlug >= 0 && argv[iSlug + 1]) {
    return path.join(ROOT, `problems-${argv[iSlug + 1]}.md`);
  }
  console.error('Usage: node validate-verbatim.js --slug <slug> | --file <path>');
  process.exit(2);
}

function stripNotesAndComments(md) {
  // Remove HTML comments and ### Notes blocks (metadata may mention gaps)
  let s = md.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/^### Notes\n[\s\S]*?(?=^### |^## |^---|\Z)/gm, '');
  // Bank header Gaps line is metadata — keep but don't scan as problem body
  s = s.replace(/^### Bank\n[\s\S]*?(?=^### Role|^## )/m, '');
  return s;
}

function main() {
  const file = loadFile(process.argv.slice(2));
  if (!fs.existsSync(file)) {
    console.error(JSON.stringify({ ok: false, error: 'missing file', file }, null, 2));
    process.exit(1);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const body = stripNotesAndComments(raw);
  const hits = [];

  for (const rule of FORBIDDEN) {
    if (rule.inPrompt) {
      // Only flag [brackets] inside Prompt / blockquotes / choice stems — not asset paths
      const chunks = body.match(/^(\*\*Prompt:\*\*|^\> |^\*\*Choice question|\*\*Write-in)[\s\S]{0,4000}/gim) || [];
      for (const chunk of chunks) {
        const m = chunk.match(rule.re);
        if (m) hits.push({ why: rule.why, sample: m[0].slice(0, 80) });
      }
      continue;
    }
    const m = body.match(rule.re);
    if (m) hits.push({ why: rule.why, sample: m[0].slice(0, 120) });
  }

  // captureStatus full while Gaps still lists verbatim issues
  const status = (raw.match(/\*\*captureStatus:\*\*\s*(\S+)/) || [])[1] || '';
  if (status === 'full' && /verbatim|summar|OCR|polish/i.test(raw)) {
    hits.push({ why: 'captureStatus full while Gaps/body still mention verbatim/summary/OCR issues', sample: status });
  }

  const out = { ok: hits.length === 0, file, hits, captureStatus: status };
  console.log(JSON.stringify(out, null, 2));
  process.exit(hits.length ? 1 : 0);
}

main();

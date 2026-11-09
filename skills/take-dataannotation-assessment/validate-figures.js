#!/usr/bin/env node
/**
 * Fail banks whose embedded figures are missing, tiny, or obviously truncated.
 * Live miss 2026-11-08 DS: q1-chart.png half-hidden (no x-axis labels).
 *
 * Usage:
 *   node validate-figures.js --slug data-scientist
 *   node validate-figures.js --file path/to/problems-….md
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'problems');

// Soft floor for any embed (tiny accidental crops).
const MIN_BYTES = 500;
const MIN_W = 80;
const MIN_H = 40;
// Charts / graphs need room for title + both axes (DS 2026-11-08 half-hidden miss).
const CHART_MIN_BYTES = 8 * 1024;
const CHART_MIN_W = 420;
const CHART_MIN_H = 220;

function loadFile(argv) {
  const iSlug = argv.indexOf('--slug');
  const iFile = argv.indexOf('--file');
  if (iFile >= 0 && argv[iFile + 1]) return path.resolve(argv[iFile + 1]);
  if (iSlug >= 0 && argv[iSlug + 1]) {
    return path.join(ROOT, `problems-${argv[iSlug + 1]}.md`);
  }
  console.error('Usage: node validate-figures.js --slug <slug> | --file <path>');
  process.exit(2);
}

function pngSize(buf) {
  // PNG IHDR: width/height at bytes 16..23 big-endian
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

function main() {
  const file = loadFile(process.argv.slice(2));
  if (!fs.existsSync(file)) {
    console.error(JSON.stringify({ ok: false, error: 'missing file', file }, null, 2));
    process.exit(1);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const hits = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(raw))) {
    const rel = m[1].replace(/^\.\//, '');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.resolve(dir, rel);
    if (!fs.existsSync(abs)) {
      hits.push({ why: 'missing embedded figure', sample: rel });
      continue;
    }
    const st = fs.statSync(abs);
    const chartish = /chart|graph|plot|bar.?chart|histogram/i.test(path.basename(rel));
    const needBytes = chartish ? CHART_MIN_BYTES : MIN_BYTES;
    if (st.size < needBytes) {
      hits.push({
        why: chartish
          ? `chart too small on disk (<${needBytes} bytes) — likely truncated crop`
          : `figure too small on disk (<${needBytes} bytes)`,
        sample: `${rel} (${st.size}B)`,
      });
    }
    const buf = fs.readFileSync(abs);
    const dim = pngSize(buf);
    if (!dim) continue;
    const needW = chartish ? CHART_MIN_W : MIN_W;
    const needH = chartish ? CHART_MIN_H : MIN_H;
    if (dim.w < needW || dim.h < needH) {
      hits.push({
        why: chartish
          ? `chart crop too small (${dim.w}x${dim.h}) — axes/title likely cut (need ≥${needW}x${needH})`
          : `figure crop too small (${dim.w}x${dim.h}) — need ≥${needW}x${needH}`,
        sample: rel,
      });
    }
  }

  const status = (raw.match(/\*\*captureStatus:\*\*\s*(\S+)/) || [])[1] || '';
  if (status === 'full' && /half.?hidden|cut.?off|partial crop|x-axis.*(cut|miss)/i.test(raw)) {
    hits.push({
      why: 'captureStatus full while Gaps/Notes still admit truncated figures',
      sample: status,
    });
  }

  const out = { ok: hits.length === 0, file, hits, figures: seen.size, captureStatus: status };
  console.log(JSON.stringify(out, null, 2));
  process.exit(hits.length ? 1 : 0);
}

main();

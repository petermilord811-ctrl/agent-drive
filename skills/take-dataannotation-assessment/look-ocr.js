#!/usr/bin/env node
/**
 * Local OCR on a look PNG (Windows.Media.Ocr / Tesseract) — use when host OCR is chrome-blind.
 *
// @tool OCR a look.png and optionally find text
 * @run node skills/take-dataannotation-assessment/look-ocr.js work/…/look-8.png
// @tool OCR a look.png and optionally find text
 * @run node skills/take-dataannotation-assessment/look-ocr.js look.png --find "Data Scientist"
 */
const path = require('path');
const ocr = require(path.join(__dirname, '..', '..', 'vision', 'local-ocr.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function main() {
  const png = process.argv[2];
  const find = arg('find', '');
  if (!png) {
    console.error('usage: look-ocr.js <look.png> [--find "Data Scientist"]');
    process.exit(2);
  }
  const r = await ocr.read(path.resolve(png), { lang: 'eng' });
  if (!r || r.ok === false) {
    console.log(JSON.stringify(r || { ok: false, why: 'no ocr result' }, null, 2));
    process.exit(1);
  }
  const lines = [];
  for (const line of r.lines || []) {
    const words = line.w || [];
    if (!words.length) continue;
    const x0 = Math.min(...words.map((w) => w[1]));
    const y0 = Math.min(...words.map((w) => w[2]));
    const x1 = Math.max(...words.map((w) => w[1] + w[3]));
    const y1 = Math.max(...words.map((w) => w[2] + w[4]));
    lines.push({
      t: line.t,
      lx: Math.round((x0 + x1) / 2),
      ly: Math.round((y0 + y1) / 2),
      bbox: [x0, y0, x1, y1],
      action: 'dbl',
    });
  }
  let matches = lines;
  if (find) {
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    matches = lines.filter((l) => re.test(l.t));
  }
  const out = {
    ok: true,
    engine: r.engine,
    ms: r.ms,
    find: find || null,
    count: matches.length,
    matches,
    pick: matches[0] || null,
    note: 'coords are look pixels (lx/ly). For Browse cards use action dbl on pick; body ≈ ly+55.',
  };
  if (out.pick && /scientist|engineer|generalist|expert|accountant|attorney|paralegal/i.test(out.pick.t)) {
    out.cardBody = {
      lx: out.pick.lx,
      ly: out.pick.ly + 55,
      action: 'dbl',
      fromTitle: out.pick.t,
    };
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

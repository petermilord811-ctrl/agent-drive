#!/usr/bin/env node
/**
 * Upscale a look crop then OCR with vision/local-ocr.js — dump reading-order lines.
 * Use for Part A source capture when host OCR is chrome-blind.
 *
 * @run node skills/take-dataannotation-assessment/upscale-ocr.js look.png --crop 40,155,1240,690 --scale 3
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ocr = require(path.join(__dirname, '..', '..', 'vision', 'local-ocr.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function main() {
  const png = process.argv[2];
  if (!png) {
    console.error('usage: upscale-ocr.js <look.png> [--crop L,T,R,B] [--scale 3] [--out out.png]');
    process.exit(2);
  }
  const crop = (arg('crop', '') || '').split(',').map(Number);
  const scale = Math.max(1, Number(arg('scale', '3')) || 3);
  const outPng = arg('out', path.join(path.dirname(path.resolve(png)), '_ocr_up.png'));

  const py = `
from PIL import Image
im = Image.open(r'''${path.resolve(png)}''').convert('RGB')
crop = ${JSON.stringify(crop.length === 4 ? crop : null)}
if crop and len(crop)==4 and all(isinstance(x,int) for x in crop):
    im = im.crop(tuple(crop))
s = ${scale}
w,h = im.size
im = im.resize((int(w*s), int(h*s)), Image.Resampling.LANCZOS)
im.save(r'''${outPng}''')
print('ok', im.size)
`;
  const pr = spawnSync('python', ['-c', py], { encoding: 'utf8' });
  if (pr.status !== 0) {
    console.error(pr.stderr || pr.stdout);
    process.exit(1);
  }

  const r = await ocr.read(outPng, { lang: 'eng' });
  if (!r || r.ok === false) {
    console.log(JSON.stringify(r || { ok: false }, null, 2));
    process.exit(1);
  }
  const lines = [];
  for (const line of r.lines || []) {
    if (!line.t) continue;
    const words = line.w || [];
    const y0 = words.length ? Math.min(...words.map((w) => w[2])) : 0;
    lines.push({ y: y0, t: line.t });
  }
  lines.sort((a, b) => a.y - b.y);
  const text = lines.map((l) => l.t).join('\n');
  console.log(text);
  fs.writeFileSync(outPng.replace(/\.png$/i, '.txt'), text, 'utf8');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

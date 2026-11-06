'use strict';
// @tool read a grid of characters off a picture by shapes learned from reads proven right
// @run  const reader = require('../vision/glyph-reader.js')   (a library; skills/solve-a-sudoku uses it)
// glyph-reader.js -- READ A GRID OF GLYPHS OFF A PICTURE, by shapes learned when a read was PROVEN right.
//
// WHY THIS EXISTS. A model reading a sudoku off a screenshot spent 35-65 s on it, on EVERY board: the tenth
// as slowly as the first, because nothing it learned was kept in a form a tool could use (the serve
// ledgers of three live runs show it as idle time between commands). So the reading is done here, in
// milliseconds, from glyph shapes saved the first time a read was proven right -- the solver found exactly
// one solution and the game said solved. The model is asked only about what this cannot be sure of.
//
// A CELL'S SHAPE. Its ink (pixels darker than INK) is cut to the ink's own box and binned onto a 10x14
// grid, every ink pixel spread over its four nearest bins (bilinear) so that a half-pixel shift between
// two captures moves weight smoothly instead of flipping a bin. The vector is normalised and compared by
// cosine with every learned exemplar. Measured on four real sudoku.com boards (raw 1920x1080 captures,
// digits ~26 px tall): learning from ONE board read every other one 81/81, the closest call 0.055 apart.
// Finer grids alias at that size and misread; weighting by darkness instead of counting ink narrows it.
//
// Pure functions over a decoded picture (agent-eyes.js's {w,h,bpp,px,stride,rows}): no socket, no host.
const fs = require('fs');
const zlib = require('zlib');

const FEATURE = 'ink10x14s';   // name of the shape; a bank made with another one is ignored, never misread
const GW = 10, GH = 14;
const INK = 150;               // darker than this is ink: a given (#344861), an answer (blue), a mistake (red)
                               // -- and never a highlight, the lightest of which reads ~210
const INSET = 0.14;            // of the pitch, kept clear of each edge: grid lines are not part of a digit
const EMPTY = 0.02;            // less ink than this share of the cell is an empty cell
const SHORT = 0.3;             // a cell whose TALLEST piece of ink is shorter than this share of it holds pencil
                               // marks or a speck, not a digit (a digit is one stroke ~0.5 tall)

const lum = (img, x, y) => { const i = y * img.stride + x * img.bpp; return (img.px[i] * 299 + img.px[i + 1] * 587 + img.px[i + 2] * 114) / 1000; };

// ---- where the grid is ----------------------------------------------------------------------------
// The same method as detect_grid.py, so the two agree to the pixel: a GRID LINE is one long contiguous
// dark run across the whole grid, while text, digits and buttons break into short runs. The longest run
// per row (then per column inside that band) finds the outer lines; the 3x3 box separators, darker than the
// cell lines and at exactly a third and two thirds, are what say it really is a board (`boxsep`, 0-4).
function findGrid(img, opts) {
  const o = opts || {}, n = o.n || 9, boxes = o.boxes || 3;
  const b = o.box || [0, 0, img.w, img.rows];
  const X0 = Math.max(0, b[0]), Y0 = Math.max(0, b[1]), X1 = Math.min(img.w, b[2]), Y1 = Math.min(img.rows, b[3]);
  const DARK = 210, GAP = 2;   // grid lines are dark navy on white (thin cell lines ~198–208); a 1-2 px antialiasing break is tolerated
  const longest = (len, at) => {
    let best = 0, cur = 0, g = 0;
    for (let i = 0; i < len; i++) {
      if (at(i) < DARK) { cur++; g = 0; if (cur > best) best = cur; }
      else { g++; if (g > GAP) cur = 0; else if (cur) cur++; }   // a tolerated gap counts as part of the run
    }
    return best;
  };
  const rowrun = [];
  for (let y = Y0; y < Y1; y++) rowrun.push(longest(X1 - X0, (i) => lum(img, X0 + i, y)));
  const mx = rowrun.reduce((a, v) => (v > a ? v : a), 0);
  if (mx < 120) return { ok: false, why: 'no long horizontal lines found', maxrun: mx };
  const thr = Math.max(120, mx * 0.75), ys = [];
  rowrun.forEach((r, i) => { if (r >= thr) ys.push(Y0 + i); });
  // Collapse contiguous runs to one y per grid line (the mid-pixel).
  const clusters = (pts) => {
    if (!pts.length) return [];
    const out = []; let a = pts[0], b = pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i] === b + 1) b = pts[i];
      else { out.push((a + b) >> 1); a = b = pts[i]; }
    }
    out.push((a + b) >> 1);
    return out;
  };
  const yLines = clusters(ys);
  // Vertical candidates measured inside the span of the first and a plausible last horizontal line.
  // A banner under the board, or a chrome strip beside it, also makes long dark runs — pick the (gx0,gx1,gy0,gy1)
  // line quartet that is the most square (≥0.96) so those extras lose.
  const colPtsBetween = (yTop, yBottom) => {
    const colrun = [];
    for (let x = X0; x < X1; x++) colrun.push(longest(yBottom - yTop + 1, (i) => lum(img, x, yTop + i)));
    const mxc = colrun.reduce((a, v) => (v > a ? v : a), 0), thrc = Math.max(120, mxc * 0.75), xs = [];
    colrun.forEach((c, i) => { if (c >= thrc) xs.push(X0 + i); });
    return clusters(xs);
  };
  const hasLine = (fixed, a, z, horizontal) => longest(z - a, (i) => (horizontal ? lum(img, a + i, fixed) : lum(img, fixed, a + i))) > (z - a) * 0.6;
  const boxsepOf = (x0, y0, x1, y1, ww, hh) => {
    const sx = ww / n, sy = hh / n; let boxsep = 0;
    for (let k = 1; k < boxes; k++) {
      const fx = Math.round(x0 + k * (n / boxes) * sx), fy = Math.round(y0 + k * (n / boxes) * sy);
      if ([-2, -1, 0, 1, 2].some((d) => fx + d >= 0 && fx + d < img.w && hasLine(fx + d, y0, y1, false))) boxsep++;
      if ([-2, -1, 0, 1, 2].some((d) => fy + d >= 0 && fy + d < img.rows && hasLine(fy + d, x0, x1, true))) boxsep++;
    }
    return boxsep;
  };
  let best = null;
  for (let i = 0; i < yLines.length; i++) {
    for (let j = i + 1; j < yLines.length; j++) {
      const y0 = yLines[i], y1 = yLines[j], hh = y1 - y0;
      if (hh < 180) continue;
      const xLines = colPtsBetween(y0, y1);
      for (let a = 0; a < xLines.length; a++) {
        for (let c = a + 1; c < xLines.length; c++) {
          const x0 = xLines[a], x1 = xLines[c], ww = x1 - x0;
          if (ww < 180) continue;
          const sq = Math.round(Math.min(ww, hh) / Math.max(ww, hh) * 1000) / 1000;
          if (sq < 0.96) continue;
          const boxsep = boxsepOf(x0, y0, x1, y1, ww, hh);
          // Prefer real 3×3 box lines, then squarer, then larger — so a side chrome strip or under-board
          // ad (square but boxsep 0) loses to the sudoku.
          const score = boxsep * 1e6 + sq * 1000 + Math.min(ww, hh);
          if (!best || score > best.score) best = { gx0: x0, gy0: y0, gx1: x1, gy1: y1, w: ww, h: hh, square: sq, boxsep, score };
        }
      }
    }
  }
  if (!best) {
    const gy0 = ys[0], gy1 = ys[ys.length - 1];
    return { ok: false, why: 'not a plausible square', bbox: [X0, gy0, X1, gy1], square: 0 };
  }
  const { gx0, gy0, gx1, gy1, w, h, square, boxsep } = best;
  const sx = w / n, sy = h / n;
  return { ok: true, n, bbox: [gx0, gy0, gx1, gy1], origin: [Math.round((gx0 + sx / 2) * 10) / 10, Math.round((gy0 + sy / 2) * 10) / 10],
           step: [Math.round(sx * 100) / 100, Math.round(sy * 100) / 100], square, boxsep };
}

// ---- one cell -------------------------------------------------------------------------------------
// null for an empty cell (or one holding only pencil marks); otherwise its shape and how tall its ink is.
function cellShape(img, g, r, c) {
  const [sx, sy] = g.step, ix = Math.round(sx * INSET), iy = Math.round(sy * INSET);
  const cx0 = Math.max(0, Math.round(g.bbox[0] + c * sx) + ix), cy0 = Math.max(0, Math.round(g.bbox[1] + r * sy) + iy);
  const cx1 = Math.min(img.w, Math.round(g.bbox[0] + (c + 1) * sx) - ix), cy1 = Math.min(img.rows, Math.round(g.bbox[1] + (r + 1) * sy) - iy);
  const mw = Math.max(0, cx1 - cx0), mh = Math.max(0, cy1 - cy0), mask = new Uint8Array(mw * mh), pts = [];
  let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    if (lum(img, x, y) >= INK) continue;
    pts.push(x, y); mask[(y - cy0) * mw + (x - cx0)] = 1;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  if (pts.length / 2 < mw * mh * EMPTY) return null;
  // Pencil marks are several SMALL glyphs spread over the cell: the box around all of them is as tall as a
  // digit, so it is the tallest CONNECTED piece of ink that tells them apart -- a digit is one stroke.
  if (tallestPiece(mask, mw, mh) < sy * SHORT) return null;
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const v = new Float32Array(GW * GH);
  for (let i = 0; i < pts.length; i += 2) {
    const fx = (pts[i] - bx0 + 0.5) * GW / bw - 0.5, fy = (pts[i + 1] - by0 + 0.5) * GH / bh - 0.5;
    const X = Math.floor(fx), Y = Math.floor(fy), ax = fx - X, ay = fy - Y;
    if (X >= 0 && Y >= 0) v[Y * GW + X] += (1 - ax) * (1 - ay);
    if (X + 1 < GW && Y >= 0) v[Y * GW + X + 1] += ax * (1 - ay);
    if (X >= 0 && Y + 1 < GH) v[(Y + 1) * GW + X] += (1 - ax) * ay;
    if (X + 1 < GW && Y + 1 < GH) v[(Y + 1) * GW + X + 1] += ax * ay;
  }
  return { v: unit(v), h: bh / sy, box: [bx0, by0, bx1, by1] };
}
// The height of the tallest 8-connected region of a mask.
function tallestPiece(mask, w, h) {
  const seen = new Uint8Array(w * h), st = [];
  let best = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let y0 = h, y1 = -1;
    seen[i] = 1; st.push(i);
    while (st.length) {
      const k = st.pop(), x = k % w, y = (k / w) | 0;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, j = Y * w + X;
        if (X >= 0 && Y >= 0 && X < w && Y < h && mask[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
    }
    if (y1 - y0 + 1 > best) best = y1 - y0 + 1;
  }
  return best;
}
function unit(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; return v; }
const cosine = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

// ---- what has been learned ------------------------------------------------------------------------
// A bank is {feature, glyphs: {label: [shape, ...]}}. On disk each shape is 140 bytes (0..255) in base64.
const emptyBank = () => ({ feature: FEATURE, glyphs: {} });
const packShape = (v) => Buffer.from(Array.from(v, (x) => Math.max(0, Math.min(255, Math.round(x * 255))))).toString('base64');
const unpackShape = (s) => unit(Float32Array.from(Buffer.from(s, 'base64'), (b) => b / 255));

// Several files merged into one bank -- the shipped seed and this machine's own additions. A file that is
// missing is no bank at all; one made with a different shape is skipped and said so, rather than misread.
function loadBank(files) {
  const bank = emptyBank(), skipped = [];
  for (const f of files) {
    let d;
    try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
    if (!d || d.feature !== FEATURE || !d.glyphs) { skipped.push(f); continue; }
    for (const label of Object.keys(d.glyphs)) for (const s of d.glyphs[label]) {
      const v = unpackShape(s);
      if (v.length === GW * GH) (bank.glyphs[label] = bank.glyphs[label] || []).push(v);
    }
  }
  return { bank, skipped };
}
function saveBank(file, bank, note) {
  const glyphs = {};
  for (const label of Object.keys(bank.glyphs).sort()) glyphs[label] = bank.glyphs[label].map(packShape);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(Object.assign({ feature: FEATURE }, note ? { note } : {}, { glyphs }), null, 1) + '\n');
  fs.renameSync(tmp, file);
}
const bankSize = (bank) => Object.keys(bank.glyphs).reduce((n, k) => n + bank.glyphs[k].length, 0);

// Learn one cell's shape under its label -- but only what is NEW: a shape near-identical to one already
// held under that label adds nothing, and a label that already has `cap` examples has enough.
function learn(bank, shape, label, opts) {
  const o = Object.assign({ cap: 16, novel: 0.985 }, opts);
  const list = bank.glyphs[String(label)] = bank.glyphs[String(label)] || [];
  if (list.length >= o.cap) return false;
  for (const e of list) if (cosine(e, shape.v) >= o.novel) return false;
  list.push(shape.v);
  return true;
}

// Every label's best match for a shape, best first.
function rank(bank, shape) {
  const out = [];
  for (const label of Object.keys(bank.glyphs)) {
    let best = -1;
    for (const e of bank.glyphs[label]) { const s = cosine(e, shape.v); if (s > best) best = s; }
    out.push({ g: label, sim: best });
  }
  return out.sort((a, b) => b.sim - a.sim);
}

// ---- reading a whole grid -------------------------------------------------------------------------
// Every cell: empty, read, DOUBTFUL (its best two labels closer than `doubt` -- the caller settles it,
// a sudoku by asking the solver which of them gives a board with one solution), or UNKNOWN (like nothing
// learned: below `unknown`). Nothing doubtful or unknown is ever silently guessed into the answer.
function readGrid(img, g, bank, opts) {
  const o = Object.assign({ doubt: 0.03, unknown: 0.6 }, opts);
  const n = g.n || 9, cells = [];
  let minSim = 1, minMargin = 1;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const shape = cellShape(img, g, r, c);
    if (!shape) { cells.push({ r, c, g: '' }); continue; }
    const rk = rank(bank, shape);
    if (!rk.length) { cells.push({ r, c, g: null, shape, why: 'nothing learned yet' }); continue; }
    const best = rk[0], margin = best.sim - (rk[1] ? rk[1].sim : 0);
    minSim = Math.min(minSim, best.sim); minMargin = Math.min(minMargin, margin);
    if (best.sim < o.unknown) cells.push({ r, c, g: null, shape, sim: best.sim, why: 'unlike any learned shape' });
    else if (margin < o.doubt) cells.push({ r, c, g: best.g, shape, sim: best.sim, margin, cands: rk.slice(0, 2).map((x) => x.g) });
    else cells.push({ r, c, g: best.g, shape, sim: best.sim, margin });
  }
  return { cells, doubts: cells.filter((x) => x.cands), unknown: cells.filter((x) => x.g === null),
           filled: cells.filter((x) => x.g !== '').length, minSim, minMargin };
}

// ---- showing a model what could not be read -------------------------------------------------------
// A rectangle of the picture, enlarged (bilinear) so small print reads with certainty, as a PNG. Used for
// the one read a model still has to do -- and then it is shown the board, not the whole screen.
function cropPng(img, rect, scale) {
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const w0 = Math.min(img.w - x0, Math.round(rect.w)), h0 = Math.min(img.rows - y0, Math.round(rect.h));
  const k = scale || 1, w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h0 - 1, Math.max(0, (y + 0.5) / k - 0.5)), ya = Math.floor(sy), yb = Math.min(h0 - 1, ya + 1), fy = sy - ya;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w0 - 1, Math.max(0, (x + 0.5) / k - 0.5)), xa = Math.floor(sx), xb = Math.min(w0 - 1, xa + 1), fx = sx - xa;
      for (let ch = 0; ch < 3; ch++) {
        const p = (xx, yy) => img.px[(y0 + yy) * img.stride + (x0 + xx) * img.bpp + ch];
        const top = p(xa, ya) * (1 - fx) + p(xb, ya) * fx, bot = p(xa, yb) * (1 - fx) + p(xb, yb) * fx;
        rgb[(y * w + x) * 3 + ch] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return encodePng(w, h, rgb);
}
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function encodePng(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);   // filter byte 0: none
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
                        chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { FEATURE, findGrid, cellShape, emptyBank, loadBank, saveBank, bankSize, learn, rank, readGrid, cropPng, encodePng };

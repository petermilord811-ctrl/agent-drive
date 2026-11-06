'use strict';
// @tool find the structure of a text region WITHOUT grid lines -- rows, columns, cells, glyph boxes -- by ink projection
// @run  const rc = require('../vision/read-cells.js')   (a library; crop each box, then host-OCR it or show the model one cell)
// read-cells.js -- REGISTER A GRID-LESS LAYOUT so each piece can be read exactly.
//
// WHY THIS EXISTS. vision/glyph-reader.js reads a grid, but only one drawn with LINES: findGrid locates the
// 9x9 by its long dark rules and everything rides on that. A Calculator display, a dense data table, a line
// of prose -- the things an agent is most often asked to read -- have NO such lines, so there is nothing to
// register against and the agent falls back to shipping the whole screen to the model, which is the slow
// path agent-eyes.js exists to avoid. This finds the structure the way document layout always has: by INK
// PROJECTION. Sum the ink across each row and the rows that have ink are text lines, separated by blank
// gaps; sum it down each column and the columns that have ink are the fields. The caller then reads each
// returned box exactly -- a bounded host `ocr {rect}`, or glyph-reader.cropPng to show the model ONE cell
// instead of one screen. Pure over agent-eyes' decoded picture ({w,h,bpp,px,stride,rows}); offline.
//
// IT REGISTERS, IT DOES NOT RECOGNISE. Turning a box into text is the host's OCR or a learned glyph bank
// (glyph-reader), both out of this file. Handing the reader the right small rectangle is the expensive half
// this removes. It operates over whatever rows agent-eyes has DECODED (clampRect bounds the rect to the
// decoded front), so a still-arriving frame yields structure only from the strip that has arrived -- pass a
// fully decoded frame for full-frame structure. Thresholds default for crisp dark-on-light text; a real
// capture may want them tuned (ink, floor, minGap, minLen) -- validate against a live screen when driving
// resumes.
const eyes = require('../core/agent-eyes.js');

// Rec. 601 luminance of a pixel, straight from the decoded bytes (the same measure glyph-reader uses).
const lumAt = (img, x, y) => { const i = y * img.stride + x * img.bpp; return (img.px[i] * 299 + img.px[i + 1] * 587 + img.px[i + 2] * 114) / 1000; };

function opt(o) {
  o = o || {};
  return { ink: o.ink != null ? o.ink : 150,       // darker than this is ink
           // floor: how much ink a line needs to count as "active". null => a PER-AXIS default of 2% of the
           // scanned span (min 1), so a single full-span pixel -- a window border, a caret, a scrollbar lane
           // -- can't mark every line active and collapse the whole projection into one band.
           floor: o.floor != null ? o.floor : null,
           // minGap: bands separated by a gap this small or smaller are MERGED. This applies to ALL gaps, not
           // only breaks within one line, so lines/columns closer than minGap+1 px will merge. Default 1 (a
           // single-pixel antialiasing break); raise it only to deliberately join parts of one line.
           minGap: o.minGap != null ? o.minGap : 1,
           minLen: o.minLen != null ? o.minLen : 2 };// bands thinner than this are specks, dropped
}
// The floor resolved against the span actually scanned (the cross-dimension of the projection).
function withFloor(o, span) {
  return o.floor != null ? o : Object.assign({}, o, { floor: Math.max(1, Math.round(span * 0.02)) });
}

// Ink per line along one axis of the rect: axis 'y' -> one count per ROW (length r.h); 'x' -> one per COLUMN.
// r is already clamped to the decoded rows, so this reads only pixels that have arrived.
function profile(img, r, axis, o) {
  const len = axis === 'y' ? r.h : r.w, other = axis === 'y' ? r.w : r.h;
  const count = new Array(len).fill(0);
  for (let k = 0; k < len; k++) {
    let n = 0;
    for (let m = 0; m < other; m++) {
      const x = axis === 'y' ? r.x + m : r.x + k;
      const y = axis === 'y' ? r.y + k : r.y + m;
      if (y < img.rows && x < img.w && lumAt(img, x, y) < o.ink) n++;
    }
    count[k] = n;
  }
  return count;
}

// Maximal runs of active lines, small gaps BRIDGED (<= minGap) and tiny runs DROPPED (< minLen). Returns
// [{a, z}] inclusive, in the image's own coordinates (offset by `base`).
function bands(count, base, o) {
  const runs = [];
  let a = -1;
  for (let k = 0; k < count.length; k++) {
    if (count[k] >= o.floor) { if (a < 0) a = k; }
    else if (a >= 0) { runs.push([a, k - 1]); a = -1; }
  }
  if (a >= 0) runs.push([a, count.length - 1]);
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] - 1 <= o.minGap) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter((r) => r[1] - r[0] + 1 >= o.minLen).map((r) => ({ a: base + r[0], z: base + r[1] }));
}

// The text ROWS of a region: [{y0, y1}] top to bottom.
function rows(img, rect, opts) {
  if (!img || !img.ready) return [];
  const o = opt(opts), r = eyes.clampRect(img, rect || {});
  const oo = withFloor(o, r.w);          // a row's ink is counted ACROSS the width
  return bands(profile(img, r, 'y', oo), r.y, oo).map((b) => ({ y0: b.a, y1: b.z }));
}

// The COLUMNS of a region: [{x0, x1}] left to right. On a single line these are the glyph/field boxes.
function cols(img, rect, opts) {
  if (!img || !img.ready) return [];
  const o = opt(opts), r = eyes.clampRect(img, rect || {});
  const oo = withFloor(o, r.h);          // a column's ink is counted DOWN the height
  return bands(profile(img, r, 'x', oo), r.x, oo).map((b) => ({ x0: b.a, x1: b.z }));
}

// A TABLE: global rows x global columns -> a 2-D array of cell boxes (cells[row][col] = {x0,y0,x1,y1}),
// each the intersection of a row band and a column band -- exactly the rectangle to OCR or crop.
function grid(img, rect, opts) {
  const R = rows(img, rect, opts), C = cols(img, rect, opts);
  const cells = R.map((rw) => C.map((cl) => ({ x0: cl.x0, y0: rw.y0, x1: cl.x1, y1: rw.y1 })));
  return { rows: R, cols: C, cells };
}

// A SINGLE LINE (a display, a label, one row): the glyph/field boxes left to right, each carrying the line's
// ink height. Use when you already know the region is one line (e.g. the Calculator result display). Returns
// [] for an absent/not-ready image or a region with no detected line (so it matches rows/cols' empty contract
// instead of throwing).
function segment(img, rect, opts) {
  if (!img || !img.ready) return [];
  const C = cols(img, rect, opts), R = rows(img, rect, opts);
  if (!R.length || !C.length) return [];
  const y0 = R[0].y0, y1 = R[R.length - 1].y1;
  return C.map((cl) => ({ x0: cl.x0, x1: cl.x1, y0, y1 }));
}

module.exports = { rows, cols, grid, segment, profile, bands, lumAt };

'use strict';
// @tool solve a 9x9 sudoku, count its solutions (one = the read was right), settle doubtful cells
// @run  const sudoku = require('./sudoku-solve.js')   (a library)
// sudoku-solve.js -- solve a 9x9 sudoku and say HOW MANY solutions it has, up to a limit.
//
// The count is the point. A board READ off a screen is right when it has exactly one solution: a misread
// given almost never leaves one (it leaves none, or a conflict, or several). So "1" is the proof the read
// needs, and the same test settles a cell the reader was unsure of -- of its two likeliest digits, the one
// that leaves a board with exactly one solution is the one on the screen.
//
// Bitmasks, and the most-constrained empty cell first: an "evil" board takes about a millisecond, which
// is what lets `settle` try every reading of a few doubtful cells. Pure; no I/O.
const ALL = 0x3fe;                                   // the bits of 1..9
const box = (r, c) => ((r / 3) | 0) * 3 + ((c / 3) | 0);
const BITS = new Uint8Array(1024);
for (let m = 1; m < 1024; m++) BITS[m] = BITS[m >> 1] + (m & 1);

// The givens that clash (the same digit twice in a row, column or box), as [r,c] pairs -- [] if none.
function conflicts(grid) {
  const out = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const v = grid[r][c];
    if (!v) continue;
    for (let r2 = 0; r2 < 9; r2++) for (let c2 = 0; c2 < 9; c2++) {
      if ((r2 === r && c2 === c) || grid[r2][c2] !== v) continue;
      if (r2 === r || c2 === c || box(r2, c2) === box(r, c)) { out.push([r, c]); r2 = 9; break; }
    }
  }
  return out;
}

// { count: 0..limit, solution: the first one found (or null), conflict: true when the givens clash }
function solve(grid, limit) {
  const lim = limit || 2, g = grid.map((row) => row.slice());
  const rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9), empties = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const v = g[r][c];
    if (!v) { empties.push(r * 9 + c); continue; }
    const bit = 1 << v, b = box(r, c);
    if ((rows[r] | cols[c] | boxes[b]) & bit) return { count: 0, solution: null, conflict: true };
    rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
  }
  let count = 0, first = null;
  (function rec() {
    let pick = -1, mask = 0, fewest = 10;
    for (const k of empties) {
      const r = (k / 9) | 0, c = k % 9;
      if (g[r][c]) continue;
      const m = ALL & ~(rows[r] | cols[c] | boxes[box(r, c)]), n = BITS[m];
      if (n < fewest) { pick = k; mask = m; fewest = n; if (n <= 1) break; }
    }
    if (pick < 0) { count++; if (!first) first = g.map((row) => row.slice()); return; }
    if (!fewest) return;
    const r = (pick / 9) | 0, c = pick % 9, b = box(r, c);
    for (let v = 1; v <= 9 && count < lim; v++) {
      const bit = 1 << v;
      if (!(mask & bit)) continue;
      g[r][c] = v; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      rec();
      g[r][c] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
    }
  })();
  return { count, solution: first, conflict: false };
}

// The moves that turn the givens into the solution: [[row, col, digit], ...] for every empty cell.
function fillsOf(grid, solution) {
  const out = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (!grid[r][c]) out.push([r, c, solution[r][c]]);
  return out;
}

// SETTLE THE DOUBTS: try every reading of the doubtful cells ({r, c, cands:[d1, d2]}) and keep the one --
// the ONLY one -- that leaves a board with exactly one solution. Bounded at `max` doubtful cells (2^8
// readings), past which the read is too unsure to trust and the answer is to ask, not to search.
function settle(grid, doubts, opts) {
  const o = Object.assign({ max: 8 }, opts), list = doubts || [];
  if (list.length > o.max) return { ok: false, why: list.length + ' cells are doubtful -- too many to settle by trying' };
  const good = [];
  for (let m = 0; m < (1 << list.length); m++) {
    const g = grid.map((row) => row.slice());
    list.forEach((d, i) => { g[d.r][d.c] = Number(d.cands[(m >> i) & 1]); });
    const s = solve(g, 2);
    if (s.count === 1) good.push({ grid: g, solution: s.solution, picked: list.map((d) => ({ r: d.r, c: d.c, g: g[d.r][d.c] })) });
    if (good.length > 1) return { ok: false, why: 'more than one reading of the doubtful cells gives a solvable board' };
  }
  if (!good.length) return { ok: false, why: list.length ? 'no reading of the doubtful cells gives a board with one solution' : 'the board does not have exactly one solution' };
  return Object.assign({ ok: true }, good[0]);
}

module.exports = { conflicts, solve, fillsOf, settle };

'use strict';
// @tool solve a nonogram from row & column clues (per-line forcing + propagation + DFS); pure, no I/O
// @run  const { solve } = require('./nonogram-solve.js')   (a library)
// =================================================================================================
// nonogram-solve.js -- a pure nonogram (picross/griddler) solver. No I/O, no socket, no host.
// Give it row clues and column clues; it returns the solved grid, or null if the clues have no
// solution. Used by skills/solve-a-nonogram/nonogram.js and proven offline by
// tests/nonogram_solve.js -- the same "logic is pure and tested without a host" shape as
// skills/solve-a-sudoku/sudoku-solve.js.
// =================================================================================================
//
// A clue is a list of run-lengths for one line, read in order: row clue [3,1] means a run of 3
// filled cells, a gap, then 1 filled cell. An empty line is [] or [0].
//
// Cells carry three states so the solver can reason about what is still open:
//   -1 UNKNOWN   0 EMPTY (a crossed-out cell)   1 FILL
//
// Method -- two layers, which is enough to solve every uniquely-solvable puzzle and to find *a*
// solution for a non-unique one:
//   1. Per-line forced cells. For one line and its clue, find the cells that are FILLED in every
//      valid placement consistent with what is already known, and the cells EMPTY in every one.
//      Those are forced; the rest stay unknown. A line with zero valid placements is a contradiction.
//   2. Propagate rows and columns to a fixpoint, then DFS on the first still-unknown cell (guess
//      FILL, else EMPTY), re-propagating after each guess and backtracking on a contradiction.
// Propagation alone solves most human puzzles; the DFS makes it COMPLETE rather than best-effort.

const UNKNOWN = -1, EMPTY = 0, FILL = 1;

// A single line with more consistent placements than this is left un-forced for the round rather
// than enumerated to a hang -- propagation revisits it once other lines have narrowed it. Real
// puzzles never approach this; it is a safety ceiling for a pathological all-unknown long line.
const PLACEMENT_CAP = 1000000;

// Enumerate every placement of `clue` onto `line` (array of -1/0/1) that agrees with the cells
// already known, calling onPlacement(fill[]) for each (fill[i] === true where that placement fills
// cell i). Returns the count, or PLACEMENT_CAP+1 if it overflowed the cap.
function enumPlacements(line, clue, onPlacement) {
  const n = line.length;
  const fill = new Array(n).fill(false);
  const blocks = (clue.length === 1 && clue[0] === 0) ? [] : clue; // [0] and [] both mean "empty"
  let count = 0, over = false;

  function rec(b, p) {
    if (over) return;
    if (b === blocks.length) {
      for (let i = p; i < n; i++) if (line[i] === FILL) return; // trailing cells must be empty
      count++;
      if (count > PLACEMENT_CAP) { over = true; return; }
      onPlacement(fill);
      return;
    }
    const len = blocks[b];
    // The remaining blocks (this one included) plus one gap between each need this many cells, so
    // this block cannot start later than n - need.
    let need = (blocks.length - b - 1);
    for (let j = b; j < blocks.length; j++) need += blocks[j];
    const lastStart = n - need;
    // This block must cover the first already-known FILL at or after p (an earlier block can't --
    // they are placed left to right), so it cannot start past it.
    let firstFill = n;
    for (let i = p; i < n; i++) { if (line[i] === FILL) { firstFill = i; break; } }
    const maxS = Math.min(lastStart, firstFill);
    for (let s = p; s <= maxS; s++) {
      let ok = true;
      for (let i = s; i < s + len; i++) if (line[i] === EMPTY) { ok = false; break; } // no known gap inside a block
      if (ok && s + len < n && line[s + len] === FILL) ok = false;                     // need a gap after the block
      if (ok) {
        for (let i = s; i < s + len; i++) fill[i] = true;
        rec(b + 1, s + len + 1);
        for (let i = s; i < s + len; i++) fill[i] = false;
        if (over) return;
      }
    }
  }
  rec(0, 0);
  return over ? PLACEMENT_CAP + 1 : count;
}

// Return a copy of `line` with every forced cell resolved, or null if the clue cannot be placed at
// all (a contradiction). Cells that remain genuinely open are left UNKNOWN.
function lineSolve(line, clue) {
  const n = line.length;
  const everFill = new Array(n).fill(false);
  const everEmpty = new Array(n).fill(false);
  const cnt = enumPlacements(line, clue, (fill) => {
    for (let i = 0; i < n; i++) { if (fill[i]) everFill[i] = true; else everEmpty[i] = true; }
  });
  if (cnt === 0) return null;                 // no placement agrees with the knowns -> dead line
  if (cnt > PLACEMENT_CAP) return line.slice(); // too many to force this round, but still consistent
  const out = line.slice();
  for (let i = 0; i < n; i++) {
    if (everFill[i] && !everEmpty[i]) out[i] = FILL;
    else if (everEmpty[i] && !everFill[i]) out[i] = EMPTY;
  }
  return out;
}

function col(grid, c) { const out = new Array(grid.length); for (let r = 0; r < grid.length; r++) out[r] = grid[r][c]; return out; }

// Run the per-line solver over every row and column until nothing changes. Returns false on a
// contradiction (the grid is then left partly mutated -- callers work on a copy).
function propagate(grid, rowClues, colClues) {
  const H = grid.length, W = grid[0].length;
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < H; r++) {
      const solved = lineSolve(grid[r], rowClues[r]);
      if (!solved) return false;
      for (let c = 0; c < W; c++) if (solved[c] !== grid[r][c]) { grid[r][c] = solved[c]; changed = true; }
    }
    for (let c = 0; c < W; c++) {
      const solved = lineSolve(col(grid, c), colClues[c]);
      if (!solved) return false;
      for (let r = 0; r < H; r++) if (solved[r] !== grid[r][c]) { grid[r][c] = solved[r]; changed = true; }
    }
  }
  return true;
}

function firstUnknown(grid) {
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[0].length; c++) if (grid[r][c] === UNKNOWN) return [r, c];
  return null;
}

function search(grid, rowClues, colClues) {
  const u = firstUnknown(grid);
  if (!u) return grid.map((row) => row.map((v) => (v === FILL ? 1 : 0))); // done -> normalise to 0/1
  const [r, c] = u;
  for (const guess of [FILL, EMPTY]) {
    const g = grid.map((row) => row.slice());
    g[r][c] = guess;
    if (propagate(g, rowClues, colClues)) {
      const res = search(g, rowClues, colClues);
      if (res) return res;
    }
  }
  return null;
}

// Solve a nonogram. rowClues[i] / colClues[j] are arrays of run-lengths ([] or [0] = empty line).
// Returns a grid of 0/1 (grid[r][c]) with grid.length === rowClues.length and each row's length
// === colClues.length, or null if unsolvable.
function solve(rowClues, colClues) {
  const H = rowClues.length, W = colClues.length;
  const grid = Array.from({ length: H }, () => new Array(W).fill(UNKNOWN));
  if (H === 0 || W === 0) return grid.map((row) => row.map(() => 0));
  if (!propagate(grid, rowClues, colClues)) return null;
  return search(grid, rowClues, colClues);
}

// The run-lengths of one 0/1 line -- the inverse of a clue, for checking a solution and for reading
// a puzzle's clues off a known grid in tests.
function runs(arr) {
  const out = [];
  let k = 0;
  for (const v of arr) { if (v) k++; else { if (k) out.push(k); k = 0; } }
  if (k) out.push(k);
  return out.length ? out : [0];
}

// Derive both clue lists from a solved 0/1 grid.
function deriveClues(grid) {
  const W = grid[0].length;
  const rowClues = grid.map((row) => runs(row));
  const colClues = [];
  for (let c = 0; c < W; c++) colClues.push(runs(col(grid, c)));
  return { rowClues, colClues };
}

// True if `grid` (0/1) satisfies both clue lists -- the honest correctness check a test wants.
function satisfies(grid, rowClues, colClues) {
  if (grid.length !== rowClues.length) return false;
  const d = deriveClues(grid);
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (grid[0].length !== colClues.length) return false;
  return d.rowClues.every((r, i) => eq(r, rowClues[i])) && d.colClues.every((c, i) => eq(c, colClues[i]));
}

module.exports = { solve, lineSolve, enumPlacements, deriveClues, satisfies, runs, UNKNOWN, EMPTY, FILL };

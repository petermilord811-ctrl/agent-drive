'use strict';
// @tool solve a KenKen (KenDoku) arithmetic latin-square puzzle by backtracking + cage checks; pure
// @run  const { solve } = require('./kenken-solve.js')   (a library)
// =================================================================================================
// kenken-solve.js -- solve a KenKen: an N x N latin square (each row and column holds 1..N exactly
// once) partitioned into "cages", where each cage's cells must combine with its operator to its
// target. Pure, no I/O. Proven offline in tests/kenken_solve.js.
//
// Operators: '=' a single given cell; '+' sum; '*' product; '-' the absolute difference of TWO cells;
// '/' the larger over the smaller of TWO cells (an exact integer). solve(N, cages) returns an N x N
// grid (grid[r][c] in 1..N) satisfying the latin square and every cage, or null if none exists.
// cages: [{ cells: [[r,c],...], op: '='|'+'|'*'|'-'|'/', target: Number }].
// =================================================================================================

function cageSatisfied(cg, grid) {
  const vals = cg.cells.map(([r, c]) => grid[r][c]);
  if (vals.some((v) => !v)) return false;
  switch (cg.op) {
    case '=': return vals.length === 1 && vals[0] === cg.target;
    case '+': return vals.reduce((a, b) => a + b, 0) === cg.target;
    case '*': return vals.reduce((a, b) => a * b, 1) === cg.target;
    case '-': return vals.length === 2 && Math.abs(vals[0] - vals[1]) === cg.target;
    case '/': {
      if (vals.length !== 2) return false;
      const hi = Math.max(vals[0], vals[1]), lo = Math.min(vals[0], vals[1]);
      return lo > 0 && hi % lo === 0 && hi / lo === cg.target;
    }
    default: return false;
  }
}

// Validate a finished grid: every row and column a permutation of 1..N, and every cage satisfied.
function check(grid, N, cages) {
  for (let r = 0; r < N; r++) {
    const seen = new Set();
    for (let c = 0; c < N; c++) { const v = grid[r][c]; if (v < 1 || v > N || seen.has(v)) return false; seen.add(v); }
  }
  for (let c = 0; c < N; c++) {
    const seen = new Set();
    for (let r = 0; r < N; r++) { const v = grid[r][c]; if (seen.has(v)) return false; seen.add(v); }
  }
  return cages.every((cg) => cageSatisfied(cg, grid));
}

function solve(N, cages) {
  const grid = Array.from({ length: N }, () => new Array(N).fill(0));
  const cageOf = Array.from({ length: N }, () => new Array(N).fill(-1));
  cages.forEach((cg, i) => cg.cells.forEach(([r, c]) => { cageOf[r][c] = i; }));
  const rowUsed = Array.from({ length: N }, () => new Array(N + 1).fill(false));
  const colUsed = Array.from({ length: N }, () => new Array(N + 1).fill(false));

  // Truthy unless the cage is fully filled AND violated -- so partial cages never block, and a wrong
  // completion is pruned the moment its last cell lands.
  function cageOkSoFar(i) {
    const cg = cages[i];
    for (const [r, c] of cg.cells) if (grid[r][c] === 0) return true;
    return cageSatisfied(cg, grid);
  }

  function bt(pos) {
    if (pos === N * N) return true;
    const r = Math.floor(pos / N), c = pos % N;
    for (let v = 1; v <= N; v++) {
      if (rowUsed[r][v] || colUsed[c][v]) continue;
      grid[r][c] = v; rowUsed[r][v] = true; colUsed[c][v] = true;
      const ci = cageOf[r][c];
      if (ci < 0 || cageOkSoFar(ci)) { if (bt(pos + 1)) return true; }
      grid[r][c] = 0; rowUsed[r][v] = false; colUsed[c][v] = false;
    }
    return false;
  }

  return bt(0) ? grid.map((row) => row.slice()) : null;
}

module.exports = { solve, check, cageSatisfied };

'use strict';
// @tool deduce the forced safe cells and mines on a minesweeper board (constraint + subset reasoning); pure
// @run  const { solveStep } = require('./minesweeper-solve.js')   (a library)
// =================================================================================================
// minesweeper-solve.js -- given a minesweeper board as it stands, deduce which still-covered cells are
// DEFINITELY safe to open and which are DEFINITELY mines, using the two deductions that need no guess:
//   (1) a revealed number whose still-covered neighbours must ALL be mines (need == covered count), or
//       must all be safe (need == 0, i.e. its mines are already accounted for);
//   (2) subset reasoning between two overlapping number-constraints: if one number's covered set is a
//       subset of another's, the difference holds exactly (bigger.need - smaller.need) mines -- which
//       forces the difference all-mines or all-safe at the extremes (the classic 1-2-1 wall, etc.).
// Pure; no I/O. The live skill opens the safe cells, flags the mines, re-reads the board, and calls
// again -- so this is ONE sound deduction pass over the current board, proven in tests/minesweeper_solve.js.
//
// Board: a 2-D array. Each cell is a number 0..8 (revealed = adjacent-mine count), 'U' (covered,
// unknown), or 'M' (a known / flagged mine). solveStep returns { safe:[[r,c],...], mines:[[r,c],...] }:
// the still-covered cells newly proven safe or mined. Soundness (never a wrong call) is the point; a
// freshly proven mine is flagged internally so it can drive further deductions this same pass.
// =================================================================================================

function neighbors(r, c, H, W) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < H && nc >= 0 && nc < W) out.push([nr, nc]);
  }
  return out;
}

function solveStep(board) {
  const H = board.length, W = board[0].length;
  const g = board.map((row) => row.slice()); // working copy -- we flag proven mines on it to deduce more
  const key = (r, c) => r + ',' + c;
  const safe = new Set(), mines = new Set();

  // Every revealed number becomes a constraint over its still-covered neighbours: exactly `need` of
  // them are mines, where need = the number minus the mines already flagged around it.
  function constraints() {
    const cs = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const v = g[r][c];
      if (typeof v !== 'number') continue;
      const cells = [];
      let flagged = 0;
      for (const [nr, nc] of neighbors(r, c, H, W)) {
        if (g[nr][nc] === 'U') cells.push([nr, nc]);
        else if (g[nr][nc] === 'M') flagged++;
      }
      if (cells.length) cs.push({ cells, need: v - flagged });
    }
    return cs;
  }
  const markMine = (r, c) => { if (g[r][c] === 'U') { g[r][c] = 'M'; mines.add(key(r, c)); return true; } return false; };

  let changed = true;
  while (changed) {
    changed = false;
    const cs = constraints();
    for (const k of cs) {                                   // (1) basic
      if (k.need === 0) { for (const [r, c] of k.cells) safe.add(key(r, c)); }
      else if (k.need === k.cells.length) { for (const [r, c] of k.cells) if (markMine(r, c)) changed = true; }
    }
    for (let i = 0; i < cs.length; i++) for (let j = 0; j < cs.length; j++) { // (2) subset
      if (i === j) continue;
      const A = cs[i], B = cs[j];
      if (A.cells.length >= B.cells.length) continue;
      const Aset = new Set(A.cells.map(([r, c]) => key(r, c)));
      if (!A.cells.every(([r, c]) => B.cells.some(([br, bc]) => br === r && bc === c))) continue; // A subset of B?
      const diff = B.cells.filter(([r, c]) => !Aset.has(key(r, c)));
      const dneed = B.need - A.need;
      if (dneed === 0) { for (const [r, c] of diff) safe.add(key(r, c)); }
      else if (dneed === diff.length) { for (const [r, c] of diff) if (markMine(r, c)) changed = true; }
    }
  }

  const toArr = (s) => [...s].map((k) => k.split(',').map(Number));
  return {
    safe: toArr(safe).filter(([r, c]) => board[r][c] === 'U' && !mines.has(key(r, c))),
    mines: toArr(mines).filter(([r, c]) => board[r][c] === 'U'),
  };
}

module.exports = { solveStep, neighbors };

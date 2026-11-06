'use strict';
// @tool solve a sliding 15-puzzle (NxN tiles, 0 = blank) to the ordered goal; IDA* + linear conflict
// @run  const { solve } = require('./fifteen-solve.js')   (a library)
// =================================================================================================
// fifteen-solve.js -- solve a sliding-tile puzzle (the 15-puzzle = 4x4, the 8-puzzle = 3x3) with
// IDA* and a Manhattan + linear-conflict heuristic. Pure, no I/O.
//
// A board is a flat array of length W*W, values 0..W*W-1 with 0 the blank. The goal is
// [1,2,...,W*W-1,0] -- tiles in order, blank bottom-right, which is how the usual puzzle sites lay out
// "solved". solve() returns the list of TILE VALUES to click in order (clicking a tile next to the
// blank slides it into the gap), or null if the board is unsolvable or the search exceeds the node cap.
// Proven offline in tests/fifteen_solve.js, which APPLIES the returned moves and checks they reach the
// goal -- so a wrong or illegal solution cannot pass.
// =================================================================================================

const NODE_CAP = 3000000; // give up rather than hang on a near-worst-case board; real sites aren't that scrambled

function goalOf(n) { const g = new Array(n); for (let i = 0; i < n - 1; i++) g[i] = i + 1; g[n - 1] = 0; return g; }

// Solvable? Parity of the permutation, for the goal 1..n-1,0. Odd width: solvable iff inversions even.
// Even width: solvable iff inversions + the blank's row counted from the bottom (1-indexed) is odd.
// (The test pins this against a known solvable and a known unsolvable board.)
function solvable(board, W) {
  const t = board.filter((v) => v !== 0);
  let inv = 0;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (t[i] > t[j]) inv++;
  if (W % 2 === 1) return inv % 2 === 0;
  const blankRowFromBottom = W - Math.floor(board.indexOf(0) / W);
  return (inv + blankRowFromBottom) % 2 === 1;
}

// Manhattan distance of every tile to its goal cell, plus 2 per linear conflict (two tiles both in
// their goal row -- or both in their goal column -- but in the wrong order relative to each other, so
// one must step aside: at least two extra moves). Admissible, so IDA* stays optimal.
function heuristic(board, W) {
  let h = 0;
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (v === 0) continue;
    const gi = v - 1;
    h += Math.abs(Math.floor(i / W) - Math.floor(gi / W)) + Math.abs((i % W) - (gi % W));
  }
  for (let r = 0; r < W; r++) {
    for (let c1 = 0; c1 < W; c1++) {
      const v1 = board[r * W + c1]; if (v1 === 0) continue; const g1 = v1 - 1;
      if (Math.floor(g1 / W) !== r) continue;
      for (let c2 = c1 + 1; c2 < W; c2++) {
        const v2 = board[r * W + c2]; if (v2 === 0) continue; const g2 = v2 - 1;
        if (Math.floor(g2 / W) === r && (g1 % W) > (g2 % W)) h += 2;
      }
    }
  }
  for (let c = 0; c < W; c++) {
    for (let r1 = 0; r1 < W; r1++) {
      const v1 = board[r1 * W + c]; if (v1 === 0) continue; const g1 = v1 - 1;
      if ((g1 % W) !== c) continue;
      for (let r2 = r1 + 1; r2 < W; r2++) {
        const v2 = board[r2 * W + c]; if (v2 === 0) continue; const g2 = v2 - 1;
        if ((g2 % W) === c && Math.floor(g1 / W) > Math.floor(g2 / W)) h += 2;
      }
    }
  }
  return h;
}

function solve(board, W) {
  W = W || Math.round(Math.sqrt(board.length));
  const n = board.length;
  if (W * W !== n) return null;
  if (board.join(',') === goalOf(n).join(',')) return [];
  if (!solvable(board, W)) return null;

  const cur = board.slice();
  const path = [];
  let nodes = 0;

  // IDA*: depth-first within an f = g + h threshold, raising the threshold to the smallest f that
  // exceeded it, until the goal is reached. lastTile blocks the immediate undo of the previous slide.
  function dfs(g, h, blank, lastTile) {
    const f = g + h;
    if (f > threshold) return f;
    if (h === 0) return true;
    if (++nodes > NODE_CAP) return Infinity;
    let min = Infinity;
    const r = Math.floor(blank / W), c = blank % W;
    const neigh = [];
    if (r > 0) neigh.push(blank - W);
    if (r < W - 1) neigh.push(blank + W);
    if (c > 0) neigh.push(blank - 1);
    if (c < W - 1) neigh.push(blank + 1);
    for (const ni of neigh) {
      const tile = cur[ni];
      if (tile === lastTile) continue;
      cur[blank] = tile; cur[ni] = 0; path.push(tile);
      const res = dfs(g + 1, heuristic(cur, W), ni, tile);
      if (res === true) return true;
      if (res < min) min = res;
      path.pop(); cur[ni] = tile; cur[blank] = 0;
    }
    return min;
  }

  let threshold = heuristic(cur, W);
  while (true) {
    const res = dfs(0, heuristic(cur, W), board.indexOf(0), -1);
    if (res === true) return path.slice();
    if (!isFinite(res)) return null; // node cap hit (or no progress) -> too hard
    threshold = res;
  }
}

// Convert a gap-move string (U/D/L/R = the EMPTY square moves, as skills/solve-15-puzzle/fast-solve.js
// emits) into the tile VALUES to click, one per move -- the same format solve() returns -- so a fallback
// solution drives a click-the-tile site exactly like the optimal one. Pure.
function clicksFromGapMoves(board, W, gapMoves) {
  W = W || Math.round(Math.sqrt(board.length));
  const b = board.slice();
  let g = b.indexOf(0);
  const clicks = [];
  for (const m of gapMoves) {
    let nb;
    if (m === 'U') nb = g - W; else if (m === 'D') nb = g + W; else if (m === 'L') nb = g - 1; else if (m === 'R') nb = g + 1; else continue;
    clicks.push(b[nb]);               // the tile that slides into the gap = the one the gap moves onto
    b[g] = b[nb]; b[nb] = 0; g = nb;
  }
  return clicks;
}

module.exports = { solve, solvable, heuristic, goalOf, clicksFromGapMoves, NODE_CAP };

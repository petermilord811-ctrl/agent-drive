'use strict';
// @tool choose the next 2048 move for a board, and simulate a move; a corner + monotonicity heuristic, pure
// @run  const { bestMove } = require('./move2048.js')   (a library)
// =================================================================================================
// move2048.js -- pick the next move in 2048, and simulate one. No I/O. A board is an N x N array of
// numbers (0 = empty). A move slides every tile one direction and merges each pair of equal neighbours
// once. bestMove(board) returns 'left'|'right'|'up'|'down' -- the move that leaves the best board by a
// simple heuristic (keep the big tiles in the bottom-left corner, with a monotonic gradient toward it),
// or null if no move changes the board (game over). Proven offline in tests/move2048.js.
//
// Why it exists: when playing 2048 live, this picks the move so the agent doesn't fire a fixed key
// sequence blind -- read the board from a `shot`, call bestMove, press that arrow, repeat.
// =================================================================================================

const DIRS = ['down', 'left', 'right', 'up']; // tie-break order: bottom-left corner strategy

// Slide + merge one line toward index 0 ("left"). Returns { line, gained }.
function slideLeft(line) {
  const n = line.length;
  const xs = line.filter((v) => v !== 0);
  const out = [];
  let gained = 0;
  for (let i = 0; i < xs.length; i++) {
    if (i + 1 < xs.length && xs[i] === xs[i + 1]) { out.push(xs[i] * 2); gained += xs[i] * 2; i++; }
    else out.push(xs[i]);
  }
  while (out.length < n) out.push(0);
  return { line: out, gained };
}

const transpose = (b) => b[0].map((_, c) => b.map((row) => row[c]));
const reverseRows = (b) => b.map((row) => row.slice().reverse());

// Apply a move. Returns { board, moved, gained } (board is a fresh copy).
function applyMove(board, dir) {
  let b = board.map((row) => row.slice());
  let gained = 0;
  const left = (g) => g.map((row) => { const r = slideLeft(row); gained += r.gained; return r.line; });
  if (dir === 'left') b = left(b);
  else if (dir === 'right') b = reverseRows(left(reverseRows(b)));
  else if (dir === 'up') b = transpose(left(transpose(b)));
  else if (dir === 'down') b = transpose(reverseRows(left(reverseRows(transpose(b)))));
  else return { board: board.map((row) => row.slice()), moved: false, gained: 0 };
  return { board: b, moved: JSON.stringify(b) !== JSON.stringify(board), gained };
}

// Heuristic: more empty cells, a monotonic gradient (rows non-increasing toward the left, columns
// non-decreasing toward the bottom), and the max tile pinned in the bottom-left corner. Higher = better.
function score(board) {
  const n = board.length;
  let empty = 0, mono = 0, maxv = 0, maxAt = null;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = board[r][c];
    if (v === 0) empty++;
    if (v > maxv) { maxv = v; maxAt = [r, c]; }
  }
  for (let r = 0; r < n; r++) for (let c = 0; c + 1 < n; c++) if (board[r][c] >= board[r][c + 1]) mono++;
  for (let c = 0; c < n; c++) for (let r = 0; r + 1 < n; r++) if (board[r][c] <= board[r + 1][c]) mono++;
  const corner = (maxAt && maxAt[0] === n - 1 && maxAt[1] === 0) ? maxv : 0;
  return empty * 100 + mono * 10 + corner * 2;
}

// The move that leaves the best board (ties broken by DIRS order), or null if nothing changes the board.
function bestMove(board) {
  let best = null, bestScore = -Infinity;
  for (const dir of DIRS) {
    const r = applyMove(board, dir);
    if (!r.moved) continue;
    const s = score(r.board) + r.gained; // nudge toward a move that also merges now
    if (s > bestScore) { bestScore = s; best = dir; }
  }
  return best;
}

module.exports = { bestMove, applyMove, slideLeft, score, DIRS };

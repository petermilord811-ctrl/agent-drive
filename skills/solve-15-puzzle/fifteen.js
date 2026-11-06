#!/usr/bin/env node
'use strict';
// @tool solve-15-puzzle CLI -- solve a board.json (flat tiles, 0=blank) to the click sequence, or check solvability
// @run  node skills/solve-15-puzzle/fifteen.js solve skills/solve-15-puzzle/example.board.json
// =================================================================================================
// fifteen.js -- the "solve a 15-puzzle" skill's command line. The SOLVER is pure and proven offline
// (tests/fifteen_solve.js); the live "read the tiles off the screen and click them" half is in
// README.md. board.json is a flat tile array (0 = blank), or {"board":[...],"W":4}.
//   node skills/solve-15-puzzle/fifteen.js solve <board.json>   print the tiles to click, in order
//   node skills/solve-15-puzzle/fifteen.js check <board.json>   is this board solvable?
// Exit: 0 ok, 1 unsolvable / no solution within the cap, 2 usage or bad input.
// =================================================================================================

const fs = require('fs');
const { solve, solvable, clicksFromGapMoves } = require('./fifteen-solve.js');

function die(code, msg) { console.error(msg); process.exit(code); }
function readJson(p) {
  if (!p) die(2, 'missing a JSON path');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(2, 'cannot read JSON ' + p + ' -- ' + e.message); }
}
function boardOf(j) { return Array.isArray(j) ? j : (j && j.board); }
function widthOf(j, board) { return (j && j.W) || Math.round(Math.sqrt(board.length)); }

const cmd = process.argv[2];

if (cmd === 'solve') {
  const j = readJson(process.argv[3]);
  const board = boardOf(j);
  if (!Array.isArray(board)) die(2, 'board.json needs a flat tile array (or {board, W})');
  const W = widthOf(j, board);
  if (!solvable(board, W)) die(1, 'that board is unsolvable');
  let mv = solve(board, W), how = 'optimal';
  if (mv === null) {
    // The optimal IDA* hit its node cap on a hard board (a random 15-puzzle averages ~52 moves, past the
    // cap). Fall back to the complete weighted-A* solver (fast-solve.js) and convert its gap-move string
    // into the same click-the-tile list, so the skill always returns a solution for a solvable board.
    const { solveFast } = require('./fast-solve.js');
    const gap = solveFast(board, W);
    if (gap === null) die(1, 'no solution found (optimal capped, and the fallback also capped)');
    mv = clicksFromGapMoves(board, W, gap);
    how = 'weighted-A* fallback (non-optimal)';
  }
  console.log('moves (' + mv.length + ', ' + how + '): ' + mv.join(' '));
  console.log(JSON.stringify(mv));
  process.exit(0);
} else if (cmd === 'check') {
  const j = readJson(process.argv[3]);
  const board = boardOf(j);
  if (!Array.isArray(board)) die(2, 'board.json needs a flat tile array (or {board, W})');
  const s = solvable(board, widthOf(j, board));
  console.log(s ? 'solvable' : 'unsolvable');
  process.exit(s ? 0 : 1);
} else {
  die(2, 'usage: node fifteen.js solve <board.json> | check <board.json>');
}

#!/usr/bin/env node
'use strict';
// @tool solve-minesweeper CLI -- read a board.json and print the forced safe cells and the mines
// @run  node skills/solve-minesweeper/minesweeper.js step skills/solve-minesweeper/example.board.json
// =================================================================================================
// minesweeper.js -- the "solve a minesweeper" skill's command line. The SOLVER is pure and proven
// offline (tests/minesweeper_solve.js); the live "read the board, open the safe cells, flag the mines,
// re-read, repeat" loop is described in README.md. board.json is a 2-D array; each cell is a number
// 0..8 (revealed = adjacent mine count), "U" (covered/unknown) or "M" (a flagged mine).
//   node skills/solve-minesweeper/minesweeper.js step <board.json>
// Exit: 0 ok, 2 usage or bad input.
// =================================================================================================

const fs = require('fs');
const { solveStep } = require('./minesweeper-solve.js');

function die(code, msg) { console.error(msg); process.exit(code); }

const cmd = process.argv[2];
if (cmd === 'step') {
  const p = process.argv[3];
  if (!p) die(2, 'usage: step <board.json>');
  let board;
  try { board = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(2, 'cannot read JSON ' + p + ' -- ' + e.message); }
  if (!Array.isArray(board) || !Array.isArray(board[0])) die(2, 'board.json must be a 2-D array of 0..8 / "U" / "M"');
  const { safe, mines } = solveStep(board);
  const fmt = (list) => list.map(([r, c]) => '(' + r + ',' + c + ')').join(' ');
  console.log('safe to open (' + safe.length + '): ' + fmt(safe));
  console.log('mines to flag (' + mines.length + '): ' + fmt(mines));
  console.log(JSON.stringify({ safe, mines }));
  process.exit(0);
} else {
  die(2, 'usage: node minesweeper.js step <board.json>');
}

#!/usr/bin/env node
'use strict';
// @tool play-2048 CLI -- given a board.json (N x N, 0 = empty), print the best next move
// @run  node skills/play-2048/play2048.js move skills/play-2048/example.board.json
// =================================================================================================
// play2048.js -- the "play 2048" skill's command line. The move-chooser is pure and proven offline
// (tests/move2048.js); the live play loop is in README.md (read the board from a shot -> move -> press
// the arrow -> repeat). board.json is a 2-D array of numbers, 0 = empty.
//   node skills/play-2048/play2048.js move <board.json>   # prints down|left|right|up (or "no move")
// Exit: 0 a move, 1 game over (no move), 2 usage / bad input.
// =================================================================================================

const fs = require('fs');
const { bestMove } = require('./move2048.js');

function die(code, msg) { console.error(msg); process.exit(code); }

if (process.argv[2] === 'move') {
  const p = process.argv[3];
  if (!p) die(2, 'usage: move <board.json>');
  let board;
  try { board = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(2, 'cannot read JSON ' + p + ' -- ' + e.message); }
  if (!Array.isArray(board) || !Array.isArray(board[0])) die(2, 'board.json must be a 2-D array (0 = empty)');
  const m = bestMove(board);
  console.log(m || 'no move (game over)');
  process.exit(m ? 0 : 1);
} else {
  die(2, 'usage: node play2048.js move <board.json>');
}

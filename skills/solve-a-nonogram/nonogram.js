#!/usr/bin/env node
'use strict';
// @tool solve-a-nonogram CLI -- solve a clues.json to its filled grid, or check a grid fits the clues
// @run  node skills/solve-a-nonogram/nonogram.js solve <clues.json>
// =================================================================================================
// nonogram.js -- the "solve a nonogram" skill's command line.
// The SOLVER half is pure and proven offline (tests/nonogram_solve.js). The live "read it off the
// screen and fill it in" half is described in README.md -- its clue reader is expected to come from
// vision/read-cells.js (a sibling session is building that), so this CLI ships the proven offline
// commands now rather than an unverified live driver.
//
//   node skills/solve-a-nonogram/nonogram.js solve <clues.json>              print the solved grid
//   node skills/solve-a-nonogram/nonogram.js check <clues.json> <grid.json>  does a grid fit the clues?
//
// clues.json = {"rowClues":[[...],...],"colClues":[[...],...]} -- a run-length list per line,
// top-to-bottom for rows and left-to-right for columns; [] or [0] is an empty line.
// Exit codes: 0 ok, 1 no solution / mismatch, 2 usage or bad input.
// =================================================================================================

const fs = require('fs');
const { solve, satisfies } = require('./nonogram-solve.js');

function die(code, msg) { console.error(msg); process.exit(code); }
function readJson(p) {
  if (!p) die(2, 'missing a JSON path');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(2, 'cannot read JSON ' + p + ' -- ' + e.message); }
}
// Two chars per cell so the picture is roughly square in a terminal.
function render(grid) { return grid.map((row) => row.map((v) => (v ? '██' : '··')).join('')).join('\n'); }

const cmd = process.argv[2];

if (cmd === 'solve') {
  const clues = readJson(process.argv[3]);
  if (!clues || !Array.isArray(clues.rowClues) || !Array.isArray(clues.colClues))
    die(2, 'clues.json needs rowClues and colClues arrays');
  const g = solve(clues.rowClues, clues.colClues);
  if (!g) die(1, 'no solution for those clues');
  console.log(render(g));
  console.log(JSON.stringify(g));
  process.exit(0);
} else if (cmd === 'check') {
  const clues = readJson(process.argv[3]);
  const grid = readJson(process.argv[4]);
  if (!clues || !Array.isArray(clues.rowClues) || !Array.isArray(clues.colClues)) die(2, 'clues.json needs rowClues and colClues');
  if (!Array.isArray(grid)) die(2, 'grid.json must be a 2-D array of 0/1');
  const fits = satisfies(grid, clues.rowClues, clues.colClues);
  console.log(fits ? 'OK: grid satisfies the clues' : 'MISMATCH: grid does not satisfy the clues');
  process.exit(fits ? 0 : 1);
} else {
  die(2, 'usage: node nonogram.js solve <clues.json> | check <clues.json> <grid.json>');
}

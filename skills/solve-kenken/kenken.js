#!/usr/bin/env node
'use strict';
// @tool solve-kenken CLI -- solve a puzzle.json {N, cages} to the filled latin square, or check a grid
// @run  node skills/solve-kenken/kenken.js solve skills/solve-kenken/example.puzzle.json
// =================================================================================================
// kenken.js -- the "solve a KenKen" skill's command line. The SOLVER is pure and proven offline
// (tests/kenken_solve.js); the live "read the cages off the screen and fill the digits" half is in
// README.md. puzzle.json = {"N":n, "cages":[{"cells":[[r,c],...],"op":"=|+|*|-|/","target":k}]}.
//   node skills/solve-kenken/kenken.js solve <puzzle.json>
//   node skills/solve-kenken/kenken.js check <puzzle.json> <grid.json>
// Exit: 0 ok, 1 no solution / not valid, 2 usage or bad input.
// =================================================================================================

const fs = require('fs');
const { solve, check } = require('./kenken-solve.js');

function die(code, msg) { console.error(msg); process.exit(code); }
function readJson(p) {
  if (!p) die(2, 'missing a JSON path');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(2, 'cannot read JSON ' + p + ' -- ' + e.message); }
}

const cmd = process.argv[2];
if (cmd === 'solve') {
  const j = readJson(process.argv[3]);
  if (!j || !j.N || !Array.isArray(j.cages)) die(2, 'puzzle.json needs {N, cages:[{cells,op,target}]}');
  const g = solve(j.N, j.cages);
  if (!g) die(1, 'no solution for that puzzle');
  console.log(g.map((row) => row.join(' ')).join('\n'));
  console.log(JSON.stringify(g));
  process.exit(0);
} else if (cmd === 'check') {
  const j = readJson(process.argv[3]);
  const grid = readJson(process.argv[4]);
  if (!j || !j.N || !Array.isArray(j.cages)) die(2, 'puzzle.json needs {N, cages}');
  if (!Array.isArray(grid)) die(2, 'grid.json must be a 2-D array');
  const fits = check(grid, j.N, j.cages);
  console.log(fits ? 'OK: grid is a valid solution' : 'MISMATCH: not a valid solution');
  process.exit(fits ? 0 : 1);
} else {
  die(2, 'usage: node kenken.js solve <puzzle.json> | check <puzzle.json> <grid.json>');
}

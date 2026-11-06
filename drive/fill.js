#!/usr/bin/env node
// @tool fill many grid cells in one plan: click the cell, then its value's on-screen button
// @run  node drive/fill.js ./work fills.json geometry.json
// fill.js <work-dir> <fills.json> <geometry.json>
// Build one serve `plan` that enters a value into each of many grid cells by clicking the cell, then
// clicking an on-screen button — the robust, keyboard-free way to fill a board (sudoku, a form grid).
// Writes the plan to cmd.json and waits for done.json (up to 120s, since a plan can be long).
//
//   fills.json   : { "fills": [[row, col, value], ...] }  (0-indexed row/col)
//   geometry.json: { "origin": [x, y],     # pixel center of cell (0,0)
//                    "step":   [dx, dy],   # pixel distance between adjacent cols / rows
//                    "buttons": { "1": [x,y], ... "9": [x,y] } }  # on-screen value buttons
//
// Measure origin/step/buttons from a screenshot once (see skills/solve-a-sudoku). Prefer clicking
// buttons over typing: it needs no window focus and sidesteps the keyboard-focus gotchas.
const fs = require('fs'), path = require('path');
const [dir, fillsPath, geomPath] = process.argv.slice(2);
if (!dir || !fillsPath || !geomPath) { console.error('usage: node fill.js <work-dir> <fills.json> <geometry.json>'); process.exit(2); }
const fills = JSON.parse(fs.readFileSync(fillsPath, 'utf8')).fills;
const g = JSON.parse(fs.readFileSync(geomPath, 'utf8'));
const cellX = (c) => Math.round(g.origin[0] + c * g.step[0]);
const cellY = (r) => Math.round(g.origin[1] + r * g.step[1]);
const steps = [];
for (const [r, c, v] of fills) {
  const b = g.buttons[String(v)];
  if (!b) { console.error('no button for value ' + v); process.exit(2); }
  // fast: tighter pacing for a long run of clicks into known targets -- the fill is the slow part the
  // operator watches, and these are measured cells, not a hunt. clickAt still does move -> down -> up.
  steps.push({ do: 'click', x: cellX(c), y: cellY(r), fast: 1 });
  steps.push({ do: 'click', x: b[0], y: b[1], fast: 1 });
}
const cmdFile = path.join(dir, 'cmd.json'), outFile = path.join(dir, 'done.json');
try { fs.unlinkSync(outFile); } catch (_) {}
fs.writeFileSync(cmdFile, JSON.stringify({ do: 'plan', quiet: true, steps }));
console.error('wrote plan:', steps.length, 'steps for', fills.length, 'cells');
const t0 = Date.now();
(function wait() {
  if (fs.existsSync(outFile)) { process.stdout.write(fs.readFileSync(outFile, 'utf8') + '\n'); return; }
  if (Date.now() - t0 > 120000) { console.error('TIMEOUT'); process.exit(3); }
  setTimeout(wait, 150);
})();

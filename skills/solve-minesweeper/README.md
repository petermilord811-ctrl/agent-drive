---
name: Solve a minesweeper board
when: a minesweeper board — read the revealed numbers, deduce the cells that are safe to open and the ones that are mines
tags: browser, puzzle, grid, minesweeper, constraint-solve, deduction
run: node skills/solve-minesweeper/minesweeper.js step skills/solve-minesweeper/example.board.json
---
# skill: solve a minesweeper board

Minesweeper is a deduction game: each revealed number says how many of its eight neighbours are mines,
and from those constraints you can often prove some covered cells safe and others mined — no guessing.
Same shape as the other solver skills: a **pure, proven solver** plus a **look → deduce → act → re-read**
loop for doing it live. The solver ships and is tested offline; the live half is documented below.

## The solver (works now, offline)

```bash
node skills/solve-minesweeper/minesweeper.js step <board.json>   # prints the safe cells and the mines
```

`board.json` is a 2-D array; each cell is a number `0..8` (revealed = adjacent mine count), `"U"`
(covered / unknown) or `"M"` (a flagged mine). `step` runs ONE deduction pass and returns the still-
covered cells it can prove safe to open and the ones it can prove are mines. `example.board.json`
(`[["U", 1, "M"]]` — a satisfied `1`, so its other neighbour is safe) makes the `run:` line work.

The library is `minesweeper-solve.js` (`solveStep`); it is pure — no socket, host or relay — and proven
by `tests/minesweeper_solve.js`. **Soundness is the property that matters** (a wrong "safe" is a lost
game), so the test builds boards from known mine layouts and requires that every deduced mine is a real
mine and every deduced safe cell is mine-free, plus two hand cases.

**How it deduces.** Two rules that never guess: (1) a revealed number whose covered neighbours must all
be mines (its count equals the covered-neighbour count, minus any already flagged) or must all be safe
(its mines are already flagged); (2) **subset reasoning** — when one number's covered-cell set is inside
another's, the extra cells hold exactly the difference of their mine counts, which forces them all-mines
or all-safe at the extremes (the classic 1-2-1 wall). A freshly proven mine is flagged and fed back in,
so one call deduces as far as a single board allows.

## Doing it live (the plan — not yet proven on a host)

1. **Open the game** and take one `shot`. Measure the grid geometry once (origin, cell pitch) and keep a
   `geometry.json`, as `skills/read-the-screen` teaches. Cover cells, flags and the digits 1–8 each have
   a distinct look — learn them once with `vision/glyph-reader.js` and read by pixels after.
2. **Read the board** into the 2-D array (`0..8` / `"U"` / `"M"`).
3. **Deduce** with `minesweeper.js step` (or call `solveStep()` in-process via `core/cmd-file.js exchange`).
4. **Act**: left-click every safe cell, right-click every mine to flag it, as one chunked host `plan`
   (see `docs/reference/serve-protocol.md`).
5. **Re-read and repeat** — opening safe cells reveals new numbers, which unlock more deductions. Loop
   step 2–4 until the board is solved or a pass returns nothing (minesweeper sometimes needs a guess;
   when `step` returns no safe cells, stop and tell the operator rather than guessing into a mine).
6. **Verify** by the site's own "cleared" signal with a `wait` on a telltale pixel. Report as a chat
   report WITH a cropped picture of the cleared board (`status {fin:1, say, file}`), per `config/etiquette.md` §4.

When the live path is built and proven on a host, add a `play` subcommand here and record the first live run.

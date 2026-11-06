---
name: Solve a nonogram
when: a nonogram / picross / griddler grid — read the row and column clues, compute the filled cells, fill them in
tags: browser, puzzle, grid, nonogram, picross, constraint-solve, fill
run: node skills/solve-a-nonogram/nonogram.js solve skills/solve-a-nonogram/example.clues.json
---
# skill: solve a nonogram (picross / griddler)

A nonogram is a grid with a run-length clue on every row and every column; the solved picture is the
one filling that satisfies all of them. This skill is the same shape as `solve-a-sudoku`: a **pure,
proven solver** plus a **look → compute → fill → verify** plan for doing it live. The compute half ships
and is tested offline today; the live half is documented below.

## The solver (works now, offline)

```bash
node skills/solve-a-nonogram/nonogram.js solve <clues.json>              # prints the solved grid
node skills/solve-a-nonogram/nonogram.js check <clues.json> <grid.json>  # does a grid satisfy the clues?
```

`clues.json` is `{"rowClues":[[...],...],"colClues":[[...],...]}` — one run-length list per line,
rows top-to-bottom and columns left-to-right; `[]` or `[0]` is an empty line. `example.clues.json` (a
plus sign) is there so the `run:` line works out of the box. The library is `nonogram-solve.js`
(`solve`, `lineSolve`, `deriveClues`, `satisfies`); it is pure — no socket, host or relay — and proven
by `tests/nonogram_solve.js` (12 checks: forced cells, contradictions, a unique puzzle solved exactly,
empty/full grids, a search-only puzzle, a non-square puzzle, unsolvable clue sets).

**How it solves.** Two layers. (1) *Per-line forced cells*: for one line and its clue, find the cells
filled in every valid placement and the cells empty in every one — those are forced, the rest stay
unknown; a line with no valid placement is a contradiction. (2) *Propagate* rows and columns to a
fixpoint, then *DFS* on the first still-unknown cell (guess filled, else empty), re-propagating and
backtracking on a contradiction. Propagation alone solves most human puzzles; the DFS makes it complete.

## Doing it live (the plan — not yet proven on a host)

Same loop as sudoku, and the same cautions apply (look cheaply, verify before you act, never maximize).
It is **not wired up or proven on a real host yet**, so it is written out rather than shipped as an
unverified driver:

1. **Open the puzzle** and take one `shot`. Measure the grid geometry once (origin, cell pitch, where
   the top clue strip and left clue strip sit) and keep it as a `geometry.json`, exactly like
   `skills/read-the-screen` teaches.
2. **Read the clues**, not the grid. The numbers live in strips above the columns and left of the rows.
   This is a grid-less number read — use the `vision/read-cells.js` reader a sibling session is building
   for dense numeric strips (ask for it rather than duplicating it here), falling back to `ocr {rect}`
   per strip. Turn the strips into `rowClues` / `colClues`.
3. **Solve** with `nonogram.js solve` (or call `solve()` in-process via `core/cmd-file.js exchange`,
   the way `sudoku.js` does).
4. **Fill**: build one host-side `plan` (see `docs/reference/serve-protocol.md`) that left-clicks every
   filled cell. If the site distinguishes "filled" from "crossed-out", left-click fills and right-click
   (`{do:"right"}`) crosses — only fill cells need clicking to win on most sites. Chunk the plan so the
   progress panel's count climbs, as `sudoku.js` does.
5. **Verify** by the site's own signal (a solved banner / the clue numbers greying out) with a `wait` on
   a telltale pixel, not a slow full `shot`. Report the result as a chat report WITH a cropped picture of
   the solved grid (`status {fin:1, say, file}`), per `config/etiquette.md` §4.

When the live path is built and proven on a host, add a `play` subcommand here and record the first live
time, the way `solve-a-sudoku` did.

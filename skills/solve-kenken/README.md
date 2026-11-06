---
name: Solve a KenKen
when: a KenKen / KenDoku / MathDoku grid — read the cages (operator + target) and solve the arithmetic latin square
tags: browser, puzzle, grid, kenken, kendoku, mathdoku, latin-square, constraint-solve
run: node skills/solve-kenken/kenken.js solve skills/solve-kenken/example.puzzle.json
---
# skill: solve a KenKen (KenDoku / MathDoku)

A KenKen is a latin square (each row and column holds `1..N` once) carved into **cages**; every cage's
cells must combine with its operator to its target. Same shape as the other solver skills: a **pure,
proven solver** plus a **look → read-cages → solve → fill → verify** plan. The solver ships and is tested
offline; the live half is documented below.

## The solver (works now, offline)

```bash
node skills/solve-kenken/kenken.js solve <puzzle.json>              # prints the solved grid
node skills/solve-kenken/kenken.js check <puzzle.json> <grid.json> # is a grid a valid solution?
```

`puzzle.json` is `{"N":n, "cages":[{"cells":[[r,c],...], "op":"=|+|*|-|/", "target":k}]}` — one cage per
group, `op` being `=` (a single given), `+` sum, `*` product, `-` the absolute difference of two cells,
`/` the larger over the smaller of two cells (an exact integer). `example.puzzle.json` (a 3×3) makes the
`run:` line work. The library is `kenken-solve.js` (`solve`, `check`); it is pure — no socket, host or
relay — and proven by `tests/kenken_solve.js` (seeded 4×4 and 5×5 puzzles built from known latin squares,
each solution validated against every cage, plus an unsolvable puzzle → null).

**How it solves.** Backtracking cell by cell, trying only values free in that row and column (the latin
constraint), and the moment a cage's last cell is placed, checking it hits its operator/target exactly —
so a wrong completion is pruned immediately. Small grids (N≤6, the usual sizes) solve in milliseconds.

## Doing it live (the plan — not yet proven on a host)

1. **Open the puzzle** and take one `shot`. Measure the grid geometry once (origin, cell pitch) into a
   `geometry.json`, as `skills/read-the-screen` teaches.
2. **Read the cages** — this is the hard part, and it is what makes KenKen distinct from sudoku: you must
   read the thin cage-boundary lines (which cells group together) AND the little operator+target label in
   each cage's corner. Read the labels with `ocr {rect}` per cage corner (or learned glyphs via
   `vision/glyph-reader.js`), and derive cage membership from the heavy boundary lines (a `census`/edge
   read on the grid). Build the `{N, cages}` structure.
3. **Solve** with `kenken.js solve` (or call `solve()` in-process via `core/cmd-file.js exchange`).
4. **Fill** the digits: for each cell, click it then type/click its value, as one chunked host `plan`
   (see `docs/reference/serve-protocol.md`), the way `skills/solve-a-sudoku` fills its grid.
5. **Verify** by the site's own "solved" signal with a `wait` on a telltale pixel. Report as a chat
   report WITH a cropped picture of the solved grid (`status {fin:1, say, file}`), per `config/etiquette.md` §4.

When the live path is built and proven on a host, add a `play` subcommand here and record the first live
run. (Reading the cage boundaries + operator labels is the piece most worth proving first.)

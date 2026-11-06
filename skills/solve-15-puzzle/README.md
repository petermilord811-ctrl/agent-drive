---
name: Solve a 15-puzzle
when: a sliding-tile puzzle (15-puzzle / 8-puzzle) — read the tile grid, compute the slide sequence, click the tiles
tags: browser, puzzle, grid, sliding-tile, 15-puzzle, 8-puzzle, ida-star, fill
run: node skills/solve-15-puzzle/fifteen.js solve skills/solve-15-puzzle/example.board.json
---
# skill: solve a sliding 15-puzzle (or 8-puzzle)

A sliding-tile puzzle is an N×N grid of numbered tiles with one gap; solved means the tiles are in
order with the gap last. Same shape as `solve-a-sudoku` and `solve-a-nonogram`: a **pure, proven
solver** plus a **look → compute → click → verify** plan for doing it live. The solver ships and is
tested offline today; the live half is documented below.

## The solver (works now, offline)

```bash
node skills/solve-15-puzzle/fifteen.js solve <board.json>    # prints the tiles to click, in order
node skills/solve-15-puzzle/fifteen.js check <board.json>    # is the board solvable?
```

`board.json` is a flat tile array (`0` is the gap), or `{"board":[...],"W":4}`. Tiles count across then
down; the goal is `1,2,…,N²−1,0`. `example.board.json` (one move from solved) makes the `run:` line work
out of the box. The library is `fifteen-solve.js` (`solve`, `solvable`); it is pure — no socket, host or
relay — and proven by `tests/fifteen_solve.js`, which **applies each returned move list and requires the
board to reach the goal**, so an illegal or wrong solution cannot pass (10 checks: a solved board, a
solvability-parity pair, an unsolvable board, and seeded 3×3 and 4×4 scrambles).

**How it solves.** IDA* (iterative-deepening A*) with a **Manhattan + linear-conflict** heuristic: the
sum of each tile's distance to its goal cell, plus two moves for every pair of tiles that share their
goal row or column but sit in the wrong order. The heuristic is admissible, so the move list is optimal;
a node cap stops a near-worst-case board rather than letting it hang. Solvability is decided up front by
permutation parity (half of all arrangements are unsolvable), so an impossible board returns `null`
instead of being searched forever.

**Hard boards fall back to always-solve.** A random 15-puzzle averages ~52 optimal moves, which blows past
the node cap — so when the optimal search caps, `fifteen.js solve` falls back to the complete
**weighted-A\*** solver `fast-solve.js` (by the #10005 session) and converts its gap-move string to the
same click list (`clicksFromGapMoves`). So it returns the shortest solution when it can, and a guaranteed
(longer) one when it can't — it never leaves a solvable board unsolved.

## Doing it live (the arrow-key path is proven live; the click path is the plan)

Same loop as sudoku, same cautions (look cheaply, verify before acting, never maximize):

1. **Open the puzzle** and take one `shot`. Measure the tile grid geometry once (origin, cell pitch) and
   keep it as a `geometry.json`, as `skills/read-the-screen` teaches.
2. **Read the tiles** — this is a numeric grid, so reuse the proven `vision/glyph-reader.js` the way
   `sudoku.js` does (learn the digit shapes once, read by pixels after). Produce the flat tile array
   with `0` for the gap.
3. **Solve** with `fifteen.js solve` (or call `solve()` in-process via `core/cmd-file.js exchange`).
4. **Execute.** On a **click-based** site, the solver returns the tile VALUES to click in order (each is a
   tile next to the gap; clicking it slides it). On an **arrow-key** site (e.g. boatloadpuzzle.lovable.app,
   proven live on hosts 10005 and 10003), drive the fallback's gap-moves instead: a gap-move is the arrow
   **opposite** its direction (gap `L` → `ArrowRight`, `U` → `ArrowDown`, `D` → `ArrowUp`, `R` → `ArrowLeft`)
   — confirm the convention with ONE probe press first, then **re-solve from the board the probe produced**
   (`solveFast` on the current tiles — cleaner than tracking an offset into the original move string).
   Either way, send the presses in **chunks and re-read between them**: one dropped keystroke/click desyncs
   the rest, and the re-read catches it. On 10003 (2026-10-27) 81 of an 82-move run registered but the board
   came up a **single slide short** (a dropped key at the tail) — the end-of-run re-read saw it at once and
   one more press finished it. So always prove the finish by the site's own "solved" signal, never by having
   sent the last key.
5. **Verify** by the site's own "solved" signal with a `wait` on a telltale pixel, not a slow full
   `shot`. Then report WITH a cropped picture of the solved board — one `shot` once it has settled —
   as `status {fin:1, say, file}`, per `config/etiquette.md` §4.

The arrow-key execution is now **proven live** (10005, then 10003 on 2026-10-27, ~82-move solve). The one
piece still hand-done is **reading the scrambled tiles off the screen** — on a no-OCR host (10003 has no
Tesseract) that was read from a `shot` by eye. Automate that read with `vision/glyph-reader.js` (learn the
tile digit shapes once, read by pixels after, the way `sudoku.js` does) and a `play` subcommand that ties
read → `solveFast` → chunked arrow-presses → verify is complete; record its first live time here then.

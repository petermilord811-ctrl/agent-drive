---
name: Play 2048
when: play the game 2048 (slide-and-merge the numbered tiles) in a browser, reaching a high tile
tags: browser, game, keyboard, 2048, strategy, no-click
run: node skills/play-2048/play2048.js move skills/play-2048/example.board.json
---
# skill: play 2048

2048 is a keyboard game — you only ever press the four arrow keys, so there is **nothing to click and no
ad to hit by accident**. That makes it the safe way to drive an ad-heavy game page: no blind clicks, no
tab-flood. The move-chooser picks the move; you read the board, call it, press that arrow, repeat.

## The move-chooser (works now, offline)

```bash
node skills/play-2048/play2048.js move <board.json>   # prints down | left | right | up (or "no move")
```

`board.json` is a 2-D array of the tile values, `0` for empty. The library is `move2048.js` (`bestMove`,
`applyMove`); it is pure and proven by `tests/move2048.js`. `bestMove` keeps the big tiles in the
**bottom-left corner** with a monotonic gradient (empty cells + monotonicity + max-in-corner), and
returns `null` only when no move changes the board (game over).

## Playing it live

1. **Open** `play2048.co` in a fresh tab. Dismiss the "Welcome to 2048" popup (its ✕) — one click, then
   never touch the mouse again.
2. **Read the 4×4 board from a `shot`** (this host has no OCR — read the tiles yourself; see
   [read-the-screen](../read-the-screen/README.md)). Build the 2-D array.
3. **`bestMove(board)`** (or `play2048.js move`) → an arrow; `press` it (`ArrowDown`, `ArrowLeft`, …).
   Compute each move from the **real** board you just read. You *can* peek ~1–2 moves ahead by
   `applyMove`-ing without a spawn, but no further: every real move drops a new tile the plan never saw, so
   a longer blind burst drifts and can **split a merge apart** (see the live note). Near a key merge, play
   one move per read; then `shot` and read again.
4. **Repeat** until the target tile or `bestMove` returns `null`. Report the score + best tile with a
   **cropped screenshot** of the board, in the finish itself: `status {fin:1, say, file}`.

**Measured live (10003, 2026-10-27):** a fixed bottom-left key pattern (no chooser) reached **score 448 /
the 64 tile** in ~58 moves with zero issues — arrow-key play never touches an ad. The chooser is the
upgrade: it adapts to the real board instead of a fixed pattern.

**More from a live chooser run (10003, 2026-10-27):** driving the chooser reached the **32 tile / score
240** — confirming the read → `bestMove` → press loop and the arrow mapping (`up/down/left/right` →
`Arrow…`). Two cautions it surfaced, plus one upgrade idea:
- **Don't fire bursts of blind moves.** Picking several moves ahead with `bestMove`+`applyMove` and no
  spawn diverges fast; one burst separated two stacked 16s that a single `down` would have fused. Re-read
  the real board every move or two (this is why step 3 now caps the look-ahead).
- **The shot can lag ~1 move behind the merge animation on a slow host**, so a mid-animation capture
  misreads tile positions — read a **settled** board (re-shoot if the score overlay is still mid-flight).
- The fixed pattern reached a HIGHER tile (64) than the chooser did here, because the chooser's corner
  bonus is weak (`corner*2`) and the pile **drifts off the corner**. A worthwhile, offline-testable
  upgrade: raise the corner / monotonicity weights so it commits to one corner instead of wandering.

---
name: Solve a sudoku
when: read a grid, compute the answer, and fill the cells (sudoku and similar puzzle grids)
tags: browser, puzzle, grid, ocr-free, learned-shapes, fill
run: node skills/solve-a-sudoku/fast.js ./work master
---
# skill: solve a sudoku on a web page

For `sudoku.com/evil`. **Keep the model out of the hot path** — one command, glyphs + one host `plan`.

## Agent workflow (verified — use this)

```bash
# Preferred on a live visit (open shortcut if needed → play → crop proof; no long chat-wait):
node skills/solve-a-sudoku/fast.js ./work master

# Board already on screen / win screen (core routine only):
node skills/solve-a-sudoku/sudoku.js ./work play master

# MCP visit: connect answers {dir: work/mcp-…}. Pass that path (absolute is safest). If the
# screen is not sudoku.com yet, open a NEW tab first, then play — do not invent a hand solve:
#   open {url:"https://sudoku.com", tab:true}
#   node skills/solve-a-sudoku/sudoku.js "<ABS_DIR>" play master
#   shot → crop → chat-img  (play already status-fin; a second fin will not attach the picture)
```

**Do not** hand-read 81 cells from a screenshot when `play`/`fast` can run. That was 35–65 s every board
before glyphs; on 34123 it turned 18 s Chrome solves into 5–15 minute visits. Ceremony (mission
`chat-wait` before `finish`, per-cell `drive.js` clicks) costs more than the solver.

**MCP `out` path (34123, 2026-11-07):** the serve’s cwd is the visit folder. A relative shot
`out` of `work/mcp-…/board_raw.png` doubled into `visit/work/mcp-…/board_raw.png` (ENOENT) and
`fast.js` failed before play. `capture` / `fast.js` now `path.resolve` every out. Still prefer
the absolute `dir` from connect.

**Speed rules learned live (34123, 2026-11-06/07):**
1. **Locate** with box-sep **pitch ≈55.3** when `findGrid` is wrong (Firefox banners → origin ≈500,342).
2. **Fill** with **shifted pad clicks** when pad tiles still read `#eaeef4` — Digit keys are flaky there.
3. **One** host-side `plan` for all fills (never 100 separate click/press commands — a hundred round trips).
4. Learn into `glyphs.local.json` only after the **game** confirms a win; thin digit banks (e.g. `5`) misread.
5. Post proof after `play` (`fast.js` does it); do **not** `chat-wait` until `finish`/`status fin` is done.
6. **Silent misread → Game Over:** a wrong clue read can still yield one solver solution (0 doubts) and
   then burn 3 mistakes. That is **not** random clicking. `play` recovers once (New Game → re-read);
   never learn the lost board. Live fix after that path: **19.1 s**, no mistakes (34123, 2026-11-07).
7. **Perfect path:** wait out “Loading game”, then `read <shot>` and confirm a row vs the picture before
   `play`. Live **16.6 s**, 0 mistakes (34123, 2026-11-07). After `play`’s own finish, proof is
   `chat-img` (or `fast.js`) — not a second `status fin:1`.

**Live targets:** total visit ≤2 min is routine when the board is visible (~30–40 s proven). Puzzle slice
≤15 s (look+fill+check, excluding new-game/ads) is the next squeeze — fill is still ~8–16 s of host actions.

It looks once, reads the 81 cells from that picture by **digit shapes it has learned**, solves, enters
every answer in one host-side plan, and asks the **game** whether it is solved. The panel shows each step
and ends on `Solved in N s (new game … · look … · read … · solve … · fill … · check …)`; the chat gets the
same result as a report (`status … say`, see [config/etiquette.md](../../config/etiquette.md) §4) — a
`**✓ Sudoku solved in N s**` line, then one bullet per step with its time. **`play` posts no picture** (it
checks by pixels, for speed), so use `fast.js` or `shot` → crop → `chat-img` / `status fin` yourself.

**`--show`** (when the operator wants to see what the agent works on): before each step, the part of the
screen it handles is spotlighted — the whole screen before a capture, New Game before it is pressed, the
grid before it is read, the board and number pad before the fill, the pad before the game is asked. Two
rounds and two pings each (~6 s a step); the steps' own times leave it out and the report adds a
"Spotlighted" line. The operator writing during a spotlight stops the routine there (exit 5).

```bash
node skills/solve-a-sudoku/sudoku.js ./work play master --show
```

**Live, 2026-10-26 on 10004:** `play master` on a fresh Master game — **solved in 18.4 s** (look 3.9 s ·
read 0.00 s · solve 0.00 s · fill 10.2 s · check 4.3 s), read entirely from the shipped shapes with not
one doubtful cell, no mistakes, and 5 new shapes learned. The ledger says where the rest goes: every look
fetches the picture in 32 KB slices, one round trip after another (~0.6 s each on that relay). So the look
just before the last answer (164 KB, 6 trips, ~3.9 s, inside the fill) and the final check (the same)
together cost more than the 56 cells' clicks (~6.3 s), and a full shot of the win screen is 368 KB, ~8 s.
Fetching slices in parallel is the next speed-up. The new-game path (from the win screen) is proven only
on the stand-in so far: the second live run was stopped by the operator writing, as it should be.

**Live, 2026-10-26 on 10001, `play master --show`, a first visit to sudoku.com** (opened in a new tab —
never `open`, which reuses the person's current tab): **solved in 50.0 s** — look 4.7 s · read 0.01 s ·
fill 13.5 s · check 6.4 s · spotlights 25.4 s (the screen, the grid, the board and pad, the pad) — all
from pixels, no mistakes, 7 new shapes learned. A first visit shows a hint, *"Select a cell, then tap a
number to fill in the cell"*, in the win panel's blue over the last two rows: the first read refused
(14 cells like nothing learned) rather than guess. `play` now closes it itself — selecting a cell is what
it asks for — and looks again. The game on screen was the default Easy one; `play` solves the game it
finds and starts a new one (of the difficulty asked) only from the win screen.

## Why it is one command

The serve ledgers of three live solves (2026-10-24/25) showed where the time went, and it was not the
machine:

| step | before | cause | now |
|------|--------|-------|-----|
| read the board | 35–65 s, **every** board | the model looked at a screenshot and typed 81 numbers | ~10 ms from learned shapes (measured on real captures) |
| solution → fill | 9–48 s | model turns: write grid.json, start the solver | none (same command) |
| fill | 6.0–6.4 s | 2 clicks per cell | the same clicks, one plan |
| verify + report | 5–42 s screenshot (one timed out), then 20–140 s | a full shot during the win animation, then the model reading it | a pixel question to the game: a capture or two, no screenshot read |

Reading every board from scratch is why the tenth was as slow as the first. The shapes are the lesson
kept in a form a tool can use.

## How it reads (and when it asks)

- **Shapes, learned once.** `glyphs.json` here holds sudoku.com's digit shapes, learned from boards solved
  live and confirmed by the game. After every solve the game confirms, `play` adds what was new to
  `glyphs.local.json` (this machine's own; gitignored). A shape is each cell's ink cut to its own box on a
  10×14 grid ([`vision/glyph-reader.js`](../../vision/glyph-reader.js)). On four real boards, shapes from ONE board
  read every other one 81/81, the closest call 0.055 apart.
- **Never a guess.** A cell whose two likeliest digits are close is settled by the solver: of the
  readings, the one that leaves **exactly one solution** is the one on the screen. A cell like no learned
  shape, or a bank missing a digit, is not read at all.
- **When it cannot be sure** (a new site, a new zoom, nothing learned), `play` stops with **exit 10**:
  `work/board.png` (the board, enlarged) and `work/grid.draft.json` (its best reading, the cells to check
  named). Read board.png, save the 9×9 grid as `work/grid.json`, then `node skills/solve-a-sudoku/sudoku.js ./work solve`.
  When the game confirms that solve, its shapes are learned — the next board needs no model.

Offline, on a saved screenshot: `node skills/solve-a-sudoku/sudoku.js ./work read <shot.png>` (what it reads, its doubts, the time),
`node skills/solve-a-sudoku/sudoku.js ./work state <shot.png>` (a game, ticks, the win screen, other?), and
`node skills/solve-a-sudoku/sudoku.js ./work learn <shot.png> <grid.json>` (teach it a board known to be right; `--to <file>` builds
a shared bank like `glyphs.json`).

## When the operator writes

A message in the session chat stops the routine at once — **exit 5**, with what they wrote — whether it
was waiting when `play` started (it then touches nothing) or arrives mid-plan (the serve loop cuts the
plan; `play` stops rather than act on half of it). Answer them, then run `play` again: a half-filled game
is finished from where it stopped, its own earlier answers read as part of the board. Read `chat.json`
BEFORE starting a run, too — never chain the read and the run in one command.

## How it knows the game says solved

sudoku.com's number pad says it. A tile reads `#eaeef4` while its number can still be placed and turns to
a tick (`#f4f6f9`) once all nine are on the board — so when the last right answer lands every tile is a
tick, then the blue win panel covers the pad. `play` asks two questions, no screenshot:

1. **Just before the last answer**, is any tile still in play? A game that ended early (three mistakes)
   would otherwise look exactly like a solved one. The last two answers are kept to different numbers so
   the last one's tile is neither ticked nor under the pointer when this is asked.
2. **After it**, is no tile left in play? Then the game says solved. If one is, it is still running: a
   number went into the wrong cell, or the board was misread — **exit 4**, and only then a screenshot
   (`work/verify.png`), for the person.

Nothing is learned from a game that was not won.

## The New Game menu — the thing that used to cost minutes

"New Game" on the win screen opens a **"Select Game Mode" menu that AUTO-CLOSES** after a moment. Two traps:
1. **Pick too early and you miss it** — the menu has an opening animation; a click fired right after
   "New Game" lands on nothing. Fix: two beats (`hold`, a warm ~0.5 s capture) before the difficulty, all
   in ONE host-side plan so nothing can close between the clicks.
2. **Look too early and you catch a half-loaded board** ("Loading game" overlay). Fix: `wait` until a pad
   tile reads `#eaeef4` (asked of the pad's top row — the pointer now rests on the pad, and the tile under
   it need not read that colour), then two more beats.

Difficulty rows in the menu (x≈1000): Easy 339 · Medium 379 · Hard 419 · Expert 459 · Master 499 ·
Extreme 539. **State matters:** that menu belongs to the WIN screen's "New Game" (1070,643); in a game,
"New Game" is elsewhere (≈1142,689) and opens differently — so `play` starts a game only from the win
screen, and solves the game on screen otherwise.

## Geometry — found in the picture

`play` finds the grid in the same picture it reads (the longest dark run per row and column finds the
outer lines; the two 3×3 box lines confirm it is a board — the same method as `detect_grid.py`, to the
pixel), and shifts the number pad by the board's offset. So a bookmarks bar or an infobar that pushes the
page down needs no re-measure. The win screen is recognised by its panel (blue ~550 px down x=470, a white
New Game button) and its own offset. Baseline at 1920×1080: cell (0,0) at 490.7,246.7, pitch 55.44; pad
tiles x 983–1301, y 344–650.

## Pitfalls (all real on 10004)
- **Never maximize** the browser — it renders blank (GPU surface the capture misses).
- **Chrome can crash under sudoku.com's ads** ("Aw, Snap!"). Reload loads a **FRESH** puzzle. An ad
  blocker stops the ads/crashes.
- **sudoku.com blocks nav-away** (`beforeunload`) — open a new tab to leave rather than navigating.
- **On completion** the pad turns to ticks, a banner plays, then the win panel shows a thumbnail, not the
  board. A full `shot` during that animation once took 42 s and the next timed out — which is why the
  check is a pixel question, never a screenshot.
- `shot`'s reply reports `"bytes":0` even on success — the PNG is still written; trust the file.
- No host OCR on 10004 (no Tesseract) — and none is needed: the shapes are read on the driver side.
- **A video-ad INTERSTITIAL covers the board when you start a new game** (live 10003, 2026-10-28): a
  full-screen video (e.g. sweetnight.com) replaces the board for ~30 s. Reading or `play` during it sees
  the ad, not the board — wait it out (a slow `shot` itself buys ~15 s) and re-check before reading. The
  "New Game" button also opens the **Select Game Mode** menu first; pick the difficulty row there.
- **On a SEVERELY bogged host, `play` can time out (130 s waiting for `done.json`) yet still have SOLVED
  the board.** Live on 10003 (2026-10-28) the host was draining a 116-command backlog at ~1.5 s each
  (~171 s), so the fill ran long and `play` gave up — but the fill landed and the game reached its WIN
  screen (new best score 38,395). The game's own state is the truth: on a `play` timeout, `shot` the board
  before assuming failure — the win may already be on screen.
- **Firefox / windowed (live 34123, 2026-11-06/07):** never `F11` (blanks capture like maximize).
  `play` uses **box-sep pitch find** (≈55.3, origin ≈500,342 under banners) when `findGrid` grabs a
  partial square. **Prefer pad clicks at the shifted geometry** when tiles still read `#eaeef4`;
  Digit keys often never land (a “7.8 s fill” left the board empty). Digit fill is only the fallback
  when pad colours miss. After a confirmed win, shapes go to `glyphs.local.json`. Tip banners
  ("Only 6.9%…") — select a cell before reading. Streak / "Keep Going" / win panel = solved.
  New Game on the Excellent panel is a **wide white button** (~y 834), not baseline 643+dy.
  Video “Play Ad” / tab crash: wait or F5 / Restore — don’t hand-solve through an ad.
  Agent path: `node skills/solve-a-sudoku/fast.js ./work master`.

## Manual fallback (if `play`'s assumptions don't hold)

1. Open a hard puzzle at **default window size** (never maximize, never F11). Dismiss the cookie banner.
2. `node skills/solve-a-sudoku/sudoku.js ./work newgame master` (writes board.png — and grid.json too, when the shapes are sure).
3. Read board.png → `work/grid.json` (a 9×9 array, 0 = empty) — **only** on exit 10; then `learn` after a win.
4. `node skills/solve-a-sudoku/sudoku.js ./work solve` — solve, fill, ask the game, learn the read.
5. Last resort: `python -I skills/solve-a-sudoku/solve_sudoku.py grid.json fills.json`, then
   `node drive/fill.js ./work fills.json geometry.json` (baseline Chrome pad), or click cell + pad /
   `DigitN` from pitch geometry when the window is offset.

## Files here
- `fast.js` — agent visit wrapper (open → play → proof). Prefer this over inventing steps.
- `sudoku.js` — core `play` / `solve` / `read` / `learn` / `state`.
- `glyphs.json` — sudoku.com's digit shapes (53, learned from four boards solved live; ~10 KB). Shared.
- `glyphs.local.json` — what this machine has learned since. Gitignored; delete it to forget.
- `grid.example.json` — a set of givens read on 10004 (unique solution → read was correct).
- `geometry.example.json` — cell origin/step + number-pad buttons for the manual fill.

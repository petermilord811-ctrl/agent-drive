# docs/reference/gotchas.md — the field log

Hard-won lessons from real runs. Read before improvising; most of these cost real time to find.

## Browser rendering on a remote host
- **Do NOT maximize the browser window.** On host 10004 (KDE/Linux, `--no-sandbox` guest Chrome),
  maximizing made the page render as a **blank white capture** — the window chrome still draws, but the
  page content is gone, because maximize swaps to a GPU/overlay surface the host's screen-capture can't
  grab. Work at the default window size.
- **Chrome's renderer can die** under heavy interaction + ads and then every page is blank, even after
  reload. There's no shell through serve to `pkill` it — restart the browser by hand (close window,
  relaunch from the taskbar), or switch browsers (see below). After a restart it renders again.
- **Switch browsers when one is flaky** — e.g. Firefox instead of Chrome — but only when the operator
  named no specific browser. Check it's installed first (KDE launcher, or a terminal: `which firefox`).

## Specific sites
- **sudoku.com**: aggressive video ads that blank/shift the layout, and a `beforeunload` guard that
  **blocks navigating away** (omnibox Enter does nothing while that tab is open). Leave it by opening a
  **new tab (Ctrl+T)**. Difficulty `…/evil/` = hardest.
- **websudoku.com** `?level=4` = Evil — plainer, but also blanked once the renderer was already wedged.

## Input
- **Keyboard only lands when the target window has focus** — click into it first. Mouse clicks always
  land. After typing a URL, **screenshot the omnibox before Enter** to confirm it arrived and that no
  history suggestion will hijack Enter.
- **KDE's launcher search drops injected keystrokes** (only the first char registered). Don't type into
  it; browse categories, or open **Konsole** and use a real shell.
- A fresh Chrome shows a **profile picker** → click **Guest mode** for a clean, state-free window.

## Reading the screen
- To read small detail with certainty, `shot` then `vision/crop.py` to crop+upscale the region and open
  that. Don't trust a read off the full-screen thumbnail for anything that must be exact.
- For a solved board, a **unique solution is the proof you read the givens correctly** — if the solver
  reports 0 or >1 solutions, re-read.

## Tooling
- **`python -c` with newlines breaks the pyenv-win batch shim.** Use a script file with `python -I`.
- `shot` is slow (first ~15s). Each `drive.js` call waits up to 30s; a long `plan` via `fill.js` waits
  up to 120s.

## The session itself
- The grant **does not follow a relay move**; the socket goes stale. In `--serve` the client now
  **auto-reconnects** — redials the relay list, re-prompts Allow, resumes (writing `reconnecting.json` /
  `reconnect.json` meanwhile, so surface the code and wait). A *revoke* still ends it with
  `stopped.json`. If it gives up it writes `stalled.json`:
  [../../skills/recover-a-stuck-session/](../../skills/recover-a-stuck-session/README.md).
- Coordinates are pixels at the **served screen size**; a screen resize invalidates all of them.

## More from live runs (host 10003, Ubuntu/KDE, 2026-10-27)
- **Not every host has OCR.** `ocr`, `find`, `clickText` and the `text`/`notext` predicates need
  **Tesseract on the host**; some (e.g. 10003) don't have it and answer *"Tesseract … is not installed"*.
  There, read the screen **yourself from a `shot`/crop** and act on pixels — don't reach for the text verbs.
- **A bogged host can wedge the capture pipeline**: `shot` AND the light `hold` both time out (30 s) while
  control verbs (clicks, keys) still land fine. Auto-reconnect of a dropped socket does NOT clear it — a
  clean **`quit` then a fresh connect** re-initialises capture (seamless when the owner pre-authorised
  **auto-allow**, so no Allow tap is needed). Reach for this when captures hang but control works.
- **Owner-scoped auto-allow**: with `SM_AGENT_AUTOALLOW=1` on the relay + the agent's key pre-authorised
  for a host, a join — and every reconnect — is granted with **no Allow tap**. See
  [unattended-access.md](unattended-access.md).
- **A blind multi-click plan on an ad-heavy page can CASCADE.** One sudoku `fill` click hit an on-page ad
  and opened ~a dozen `solitaire.net` tabs, bogging the browser until the socket dropped. Two defences:
  prefer **keyboard-driven** tasks (arrow-key games, typing — no clicks to miss), and **guard click runs**
  so they stop the instant the target leaves the screen (the sudoku fill now re-checks the number pad every
  chunk). `beforeunload` on game sites also makes `Ctrl+W` pop a *"Leave site?"* dialog instead of closing
  the tab — press Enter / click Leave, or expect the tab to stay.
- **sudoku.com board detection can fail even when the hand-measured geometry is right**: the full-screen
  grid-finder reported *"box lines 0 / not a plausible square"* (confused by the number-pad's own 3×3 grid
  + faint lines + ads). Workaround: crop the board, read the givens yourself, write `work/<dir>/grid.json`,
  then `sudoku.js … solve` (it fills with the hand-measured geometry, which matched there). ROOT CAUSE
  (measured 2026-10-27 on 10001): sudoku.com's cell lines + outer border render **faint grey (lum ~200–240)**,
  above `glyph-reader.findGrid`'s `DARK=175` line threshold — only the two 3×3 box-separators are dark (lum
  ~69), so the finder sees just the centre box cross and the full-image pass latches onto the ads/banner. A
  threshold bump alone does NOT work (it grabs the sidebar/banner → `boxsep=0`, wrong bbox). The real fix is
  **box-separator-anchored extrapolation**: find the 2 dark box-seps (evenly spaced at 1/3 & 2/3), take
  pitch = spacing/3, extrapolate the full 9×9 — gated behind the normal detector so dark-navy boards stay
  untouched. Until that lands, use the crop-and-hand-read workaround above.

## More from a live run (host 10001, 2026-10-27)
- **A granted session can go fully DEAD — `ping` to tell.** Beyond the capture-wedge above (where control
  still lands), 10001 stopped answering EVERYTHING: `ping` returned `{alive:false}` and every `shot`/cmd
  timed out while the relay still reported the host "open" (it had drifted off all relays, auto-reconnected,
  then the host app itself stopped replying). So **`ping {timeout}` first** when a command hangs — in seconds
  it tells you whether to drive, `quit`+reconnect (re-inits capture, per the 10003 note), or stand down and
  ask the owner to revive the host — instead of eating a 25 s+ timeout per command.
- **`--serve` REQUIRES `--control`** ("--serve is for driving a machine; it needs --control", exit 1): there
  is no watch-only serve, so you cannot do a watch-only diagnostic join.
- **A stray normalized click can graze the window's restore/maximize button** and un-maximize the browser
  mid-run (it happened while playing 2048). Keyboard focus survives, but pixel/normalized coords are now off:
  **shot BEFORE a click** on coordinate-dependent tasks and re-derive coords from the current window geometry.
- **Auto-allow is PER-RELAY; the `--agent-allow` policy is DB-shared.** A host drifts across the federation
  siblings, so the auto-allow CODE + the `SM_AGENT_AUTOALLOW` switch must be deployed+restarted on EVERY relay
  the host can land on — not just one — else a drift to an un-updated relay brings the Allow tap back. A join
  that still raises a human card means that relay is NOT running enabled auto-allow. See [unattended-access.md](unattended-access.md).
- **No OCR on 10001 (like 10003):** `ocr` / `find` / `clickText` and the text predicates fail with
  *"Tesseract … is not installed"*. Read from a `shot`/crop and click by **pixel or keyboard** instead.
- **online-python.com** (a handy no-login Python runner): pixel-clicking the green **Run** button is
  unreliable — the click lands in the editor and just nudges the cursor, no output. **`Ctrl+Enter` runs the
  code** reliably; `Ctrl+A` then type replaces the whole editor for a fresh program. Verified a one-line
  prime sieve printed `5736396` (exit 0). Many browser code IDEs run on Ctrl+Enter — try it before hunting
  the Run button's pixels.
- **Synthetic clicks on 10001 often MISS small buttons** — the Run button, EtherCalc's "Create spreadsheet",
  and a vignette ad's "Close" all failed to register, though clicks into large text areas / editors land
  fine. Prefer the KEYBOARD: `Ctrl+Enter` to run, `Ctrl+A` to select-all, `Ctrl+8` to jump to Chrome tab 8
  (all reliable), and direct URLs over buttons.
  **Check the scaling before blaming the host (2026-11-06):** 10001 is 1920×1080 — wider than the ~1568 px a
  model's image input is typically shrunk to — so a point read off a full-size `shot` lands ~18% short, more the
  farther it is from the top-left: a big text area still catches it, a small button does not. Exactly this
  pattern. Not proven (the ledgers keep no click coordinates), but now avoidable: `look` (≤1280 px) and click with
  `lx/ly` — the serve does the scaling. Re-test the small buttons that way before calling them unclickable.
- **EtherCalc / SocialCalc won't take the agent's input at all** — neither the canvas grid nor the top
  formula bar received synthetic clicks or keys, so a spreadsheet task is NOT drivable on this host.
  (`ethercalc.net/<name>` opens a fresh sheet directly, bypassing the Create button — but you still cannot
  type into it.) For tabular/number work, compute in the code runner instead.
- **online-python.com quirks:** it throws full-screen Google **vignette interstitial ads** (a reload clears
  them); it **persists the editor across reloads** (localStorage), so a reload does NOT reset the code — use
  `Ctrl+A` then type to REPLACE it (a stray `Delete`/append left the old code and caused a `SyntaxError:
  unmatched ')'`); and the page can **scroll away from the editor** or a stray key can **switch tabs**, so
  shot-and-check between steps. Two verified one-liners: prime sum below 10000 = 5736396; 8-queens count = 92.

## Process — after every visit (operator, 2026-11-07)
- **After sign-off: check → analyze → learn is MUST**, not optional and not “when asked.” Whatever you
  faced while solving (wrong fills, ads, misreads, slow paths) gets a short review and is written into
  the skill / this file / AGENTS before you stop. Waiting for “learn it” has been a repeated miss.
  Then **auto-commit and push** those learnings (no wait for “commit/push”).
- **Chrome blank / blocked page:** F5 or new tab **once**. If still blank, **instantly** switch to
  Firefox / Edge / the OS default browser (`firefox '<url>' &` via shell on Ubuntu). Do not keep
  clicking a blank Chrome render. (Operator, 34123, 2026-11-07 — DataAnnotation.)
- **Always enable run/shell automatically** when the job needs `exec` (launch apps, curl, etc.) —
  `access {shell:1}` without waiting to be told. (Operator, 34123, 2026-11-07.)

## More from a live run (host 34123, 2026-11-06/07) — Master sudoku in Firefox
- **`F11` fullscreen blanks the capture the same way maximize does.** Window chrome may still draw; the
  page goes white/`#fff8f7`. Stay windowed. Exit F11 if you already toggled it; if capture stays blank,
  restart that browser.
- **Chrome died under sudoku.com ads mid-`play`** (white page at `sudoku.com/evil/`). Reload did not bring
  the board back — switch to **Firefox** (taskbar), open a fresh tab to the puzzle. Do not dig through
  other open Chrome tabs (mail, banking) on the way.
- **Speed = no model in the loop.** Hand-reading boards and mission `chat-wait` before finish turned
  18 s Chrome solves into 5–15 min visits. Use `node skills/solve-a-sudoku/fast.js ./work master` (or
  `sudoku.js … play master`). One host `plan` for all fills — never 100 top-level click/press commands
  (burns the 100-step budget). Proven wall when the board is up: **~30–40 s** total.
- **Locate with box-sep pitch (≈55.3), not Chrome `findGrid` alone.** Windowed Firefox + banners:
  `findGrid` grabs a partial square or a confident-but-drifted origin; lower-row clicks then miss.
  Pitch origin under banners ≈ **(500, 342)**. `sudoku.js play` does this fallback itself now.
- **Fill: shifted pad clicks first; Digit keys only if pad colours miss.** After pitch shift, pad tiles
  still often read `#eaeef4` — pad clicks work. Digit presses on Firefox were flaky (a “fast” fill
  reported success while the board stayed empty). Older note preferred Digit; **superseded 2026-11-07**.
- **Glyphs:** Chrome `glyphs.json` may fail on Firefox (`play` exit 10). After a **game-confirmed** win,
  shapes land in `glyphs.local.json`. Thin banks (e.g. digit `5`) cause misreads → mistakes. Never
  “learn” from a failed fill.
- **Silent confident misread → “wrong answers” (34123, 2026-11-07):** glyphs can label a **clue** wrong
  with **0 doubts**; `settle()` still finds one solution for that wrong grid; fill then conflicts with
  the real clues → sudoku.com Game Over at 3/3. That looks like random wrong presses — it isn’t. Do **not**
  refill the poisoned board. `play` now detects the Game Over modal, starts **New Game** once, re-reads,
  and only `learnFrom` after a confirmed win. If asked why: misread clues, not click noise.
- **“Loading game” half-board (34123, 2026-11-07):** right after open, the grid can look like a game while
  a Loading watermark still sits on it — clues shift/duplicate. Wait until it clears, then offline
  `sudoku.js … read <shot>` and spot-check a row against the picture **before** `play`. Proven clean
  visit after that: **16.6 s**, 0 mistakes. `play` now settles a few holds and re-captures before read.
- **Proof after `play`:** `play` already `status fin:1`. A second `fin:1` will not attach a picture —
  `shot` → crop → `chat-img` (or let `fast.js` do it).
- **New Game on the Excellent / score panel** is a wide **white** button (~screen y **834** on 34123),
  not baseline `643+dy`. `play` scans for that white row. Difficulty menu still uses `DIFF[d]+dy`.
- **Ads / crash:** “Play Ad”, “Loading game”, tab crash (“Restore This Tab”) — wait or F5; don’t
  invent a hand-solve through an interstitial. `play` polls a few holds when no board is found.
- **Win path:** streak / “Almost There!” / “Keep Going” / “I'm In!” means solved; then the blue score
  panel. Exact `#325aaf` waits often miss — check streak purple or win panel heuristics.
- **No Tesseract on 34123** — `clickText` often fails; click by `lx/ly` or screen pixels.
- **Desktop toasts can cover the taskbar** (e.g. Gmail "Enable notifications") so Firefox icon clicks
  miss — dismiss the toast first, then click the icon (orange/purple blob ~look x 129 on a 900-wide look).

## More from a live run (host 34123, 2026-11-07) — DataAnnotation worker_signup
- **Skill (fixes the live misses):** [skills/create-dataannotation-account/](../../skills/create-dataannotation-account/README.md)
  (`node kit.js skills dataannotation`). Script enforces one Firefox window, look-based field mids,
  replace-not-append, Firefox-first, captcha look-verify. Cursor rule:
  `.cursor/rules/dataannotation-signup.mdc`.
- **Several windows can share the same title.** `xdotool search --name DataAnnotation` returned two
  Chrome windows + one Firefox form; keys/`human:0` typed into the wrong one so First name stayed empty
  while Last/Email looked fine. **List matching windows, kill/close the extras, `windowactivate` the live
  form window, then look+click.** Do this before any field fill when the site was opened more than once.
- **Form fields are easy to miss by a few look-pixels (“always offset”).** Don't guess from a prior visit.
  After `look`, find the light input bands (or crop the form) and click each field's **own mid_y** —
  First / Last / Email are separate bands stacked; one band down = wrong field (operator: typed Last into
  First, Email into Last). Prefer `lx/ly` from the current picture.
- **Never append into a half-filled field.** If the box already has text (or might), `chord ControlLeft KeyA`
  then `Backspace` (or type-over the selection) before `keys`. Tab-after-type can leave Create password
  empty and Confirm filled → “Passwords must match.” Click **each** password box explicitly, clear, type
  the same secret twice (`keys … secret:1 human:0`), then look for green checks / no mismatch error.
- **`captcha` “solved” ≠ the checkbox is checked.** Any non-refusal chat reply (e.g. “now sign off”) returns
  `solved:true`. **Look again** — if “I'm not a robot” is still empty or the page says “Please complete the
  recaptcha,” ask again (or stop if they refuse). Never click the captcha yourself.
- **Agent host on Windows PowerShell mangles `$…` inside remote `exec` strings.** Put the remote bash in a
  local file and send it as base64 (`echo … | base64 -d | bash`), or avoid shell variables in one-liners.

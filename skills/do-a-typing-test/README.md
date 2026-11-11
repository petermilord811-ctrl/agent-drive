---
name: Do a typing test
when: take a typing speed test (e.g. monkeytype) — read the words on screen and type them
tags: browser, keyboard, typing, monkeytype, read-by-screenshot
---
# skill: do a typing test

A typing test is read-then-type: the site shows a stream of words, you type them, and it reports WPM and
accuracy. Keyboard-driven, so — like a 2048 game — there is little to mis-click.

## The flow (monkeytype.com)

1. **Open** `monkeytype.com` in a fresh tab. Dismiss the cookie popup (bottom-right: "reject
   non-essential" or "accept all"). Modes are **time** (15/30/60/120 s) and **words** (10/25/50/100);
   words mode is easier to drive — it ends when you finish, with no clock to race.
2. **Focus** the test (click the words area, or press any key) — the words brighten from dimmed.
3. **Read the words from a `shot`** (this host has no OCR — read them yourself) and **type them with one
   `keys` command per line**, single spaces between words; a space advances to the next word. In a time
   test, new words keep appearing — re-read and keep typing until the clock ends.
4. **Read the result** (wpm / acc) from a `shot` and report it with a **cropped screenshot**.

## Gotchas
- **No OCR on some hosts** — the `wait {until:{text:{has:"wpm"}}}` trick fails (*Tesseract … not
  installed*); just `shot` and read the result yourself.
- **In TIME mode a burst-typed run is flagged "afk detected / invalid"** by monkeytype — you type the
  visible words in ~seconds then idle out the rest of the clock (live on 10003: 184 wpm, 100% acc, but
  **53% afk → invalid**). **WORDS mode fixes this with NO pacing**: it ends the instant you finish the last
  word, so there is no clock to idle against and a burst run counts as **VALID**. Proven live on 10003
  (2026-10-27): words-25 → **412 wpm, 100% accuracy, 0 errors, valid**. So prefer words mode; only if you
  must use time mode do you need to pace the keystrokes (typing-lab pacing in `docs/CONTROL_API.md`).
  **Since 2026-11-06 `keys` types like a person by default** (≈70 wpm, natural rhythm, the odd corrected slip) —
  a time-mode run is then a person's run, not a burst; `human:0` is the burst, `speed:"fast"` ≈105 wpm.
- **The mode bar is only on the TEST screen, not the result screen.** To switch time↔words or the count,
  be on the test screen (restart first). And after navigating there, give the SPA a beat (one or two
  `hold`s) before clicking the mode bar — a click fired before it renders is silently dropped.
- **Do NOT press `Tab` to restart.** On the result screen `Tab` focuses the account/login icon and a
  following `Enter` opens **monkeytype.com/login** — not a restart. Use the **monkeytype logo** (home) or
  the on-screen **"next test" (›)** button instead; the footer's "tab › enter" hint was unreliable here.
- **A synthetic keystroke can drop mid-word** (the run stalls at e.g. 24/25, the last word one char short)
  — supply the missing character to finish. Same dropped-input class as the 15-puzzle and drawing runs.

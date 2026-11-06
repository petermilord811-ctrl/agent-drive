---
name: Do a calculation
when: compute an arithmetic or scientific expression on the machine and report the result
tags: browser, calculator, arithmetic, duckduckgo, read-by-screenshot, verify
---
# skill: do a calculation

Compute something on the machine and report the answer — with the result proven, not just asserted.

## The flow
1. **Use a no-account calculator.** Do the sum somewhere that does NOT write to the owner's signed-in
   history. **DuckDuckGo's inline calculator** is ideal: open a fresh tab, go to `duckduckgo.com`, type the
   expression into the search box and press Enter — it renders a full calculator widget with the result in a
   big display *and* comma-grouped (`(1234 * 5678) + 91011` → `7097663` / `7,097,663`). No sign-in, and it
   shows the parsed expression back so you can see it read your input correctly. (A desktop calculator app
   works too, but the KDE launcher search drops injected keystrokes — see gotchas — so the browser is more
   reliable.) Avoid the Chrome omnibox for the sum: on a host signed into the owner's Google it runs the
   search against *their* account.
2. **Type into the search BOX, not the URL.** In a URL, `+` means space; the search box takes `*`, `+`, `(`
   `)` literally. If you must build a `?q=` URL, URL-encode (`+` → `%2B`).
3. **Read the result off a `shot` — by eye on a no-OCR host.** `wait {until:{text:…}}` needs Tesseract;
   where it is absent (e.g. 10003) that wait just returns `saw:"absent"` and never fires, so don't gate on
   it — take a short `wait`/`hold` then a plain `shot` and read the number yourself.
4. **Verify against an independent computation.** Compute the expected answer yourself (`node -e
   'console.log(<expr>)'`) and confirm the widget matches — this catches a mistyped entry or a misread
   digit. Only report once they agree.
5. **Report with a cropped screenshot** of the expression + result (`vision/crop.py`), per `config/etiquette.md` §4.

**Measured live (10003, 2026-10-27):** `(1234 * 5678) + 91011` via the DuckDuckGo calculator → **7097663**,
matching `node -e` exactly; read off a screenshot (no OCR on this host) and reported with a cropped shot.

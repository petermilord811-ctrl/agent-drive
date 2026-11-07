---
name: Open / navigate / read a web page
when: the task lives in a browser — launch it, go somewhere, read what's there
tags: browser, navigation, read
---
# skill: open / navigate / read a web page

## Recipe
1. **Launch the browser** at default size. If none is open, click its taskbar icon; a fresh Chrome
   shows a profile picker → click **Guest mode** for a clean window. **Do not maximize.**
2. **Navigate.** `open {url,wait}` does Ctrl+L + type + Enter — but it only works if the browser has
   focus. If a page blocks it (see below), open a **new tab** first: `chord ControlLeft KeyT`, then
   type the URL and `press Enter`. **Screenshot the omnibox before Enter** to confirm the URL landed
   and no history suggestion will hijack Enter.
3. **Dismiss chrome-junk**: the `--no-sandbox` warning bar, cookie banners.
4. **Read** with `shot` + `vision/crop.py` (see [../read-the-screen/](../read-the-screen/README.md)).

## Pitfalls
- **Never maximize** — blank render (GPU capture miss).
- A page with a `beforeunload` guard (games like sudoku.com) **blocks navigating away** — the omnibox
  Enter does nothing. Use a new tab, or close the tab.
- Heavy-ad pages can **crash the renderer to blank**; reload won't fix it → restart the browser, or
  switch browsers (Firefox) if the operator named none. See [../recover-a-stuck-session/](../recover-a-stuck-session/README.md).
- **Operator rule (34123, 2026-11-07):** if Chrome is blank/blocked → F5 or new tab **once**; if that
  fails, **instantly** use Firefox / Edge / system default. Prefer `exec` `firefox '<url>' &` when
  shell is available. Always request/enable **shell** automatically when launching a browser that way.
- Keyboard needs window focus; mouse always lands.

## Launching a different browser / app
Browse the KDE launcher's **categories** (its search drops injected keys), or open **Konsole** and run
it from a real shell: `which firefox && firefox <url> &`. A terminal is also the reliable way to check
what's installed.

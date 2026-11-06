---
name: Research a fact and save it
when: look something up (a web search or a Wikipedia article), read the answer, and save it as a sticky note
tags: browser, research, search, wikipedia, sticky-note, read-by-screenshot
---
# skill: research a fact and save it

Look it up, read the answer off the page, and leave it on the machine as a ScreenMirror sticky note for
the operator.

## The flow
1. **Search or open the article** in a fresh tab. For a clean, sign-in-free search use
   `https://duckduckgo.com/?q=<query>` — its instant answer ("Search Assist") sits at the top. For an
   article, go to `en.wikipedia.org/wiki/<Title>` (or `Special:Random` for a random one).
2. **Read the answer from a `shot`** (no OCR on some hosts — read it yourself). Take the one fact you
   want: the DuckDuckGo answer box, or the article's first sentence / infobox.
3. **Save it as a sticky note** so it stays on the machine:
   `{"do":"note-add","text":"Fact: …","x":0.08,"y":0.22}`. Confirm with `note-list` — the note is a
   **viewer overlay**, so it will NOT appear in a host `shot`; `note-list` is how you prove it landed.
4. Report with a **cropped screenshot** of the answer.

**Measured live (10003, 2026-10-27):** "how tall is the Eiffel Tower" → 330 m (1,083 ft), and a random
Wikipedia article (C23H21NO, 327.42 g/mol) — both read off screenshots and saved as notes, confirmed
with `note-list`.

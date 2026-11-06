---
name: Read what's on the screen precisely
when: you need an exact read of text or a small region (a digit, a label, a URL in the omnibox)
tags: vision, crop, ocr, read
---
# skill: read what's on the screen precisely

The full-screen `shot` thumbnail is fine for "what app is this?" but not for exact detail (a digit, a
small label, a URL in the omnibox). For anything that must be right:

## Recipe
1. `shot {out: view.png}` — full screen (slow first time, ~15s).
2. **Crop + upscale** the region and open that:
   `python -I vision/crop.py view.png region.png <x0,y0,x1,y1> 2.4`
   (2–3× scale, LANCZOS). Read `region.png` with vision.
3. For **text you want as data**, use `ocr {rect, boxes}` — it returns the words (and per-word boxes,
   which also give you click targets). Cheaper than a full decode.

## Measuring coordinates
Measure a grid/button layout **once** from a crop:
- find two reference marks (e.g. the digit in col 3 and col 6), compute the step between them, and
  derive the rest by even spacing.
- remember the result as a small `geometry.json` (see solve-a-sudoku) so you don't re-measure.

## Notes
- Needs **Pillow** (`pip install Pillow`).
- `python -c` multi-line breaks the pyenv-win shim — always a script file + `python -I`.
- `see {rect}` / `probe {x,y}` / `census` / `diff` answer pixel questions without saving a PNG, when
  you don't need to look yourself.

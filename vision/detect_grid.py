"""detect_grid.py <board_shot.png> [search_bbox x0,y0,x1,y1]
@tool find a sudoku-style grid's outer lines and pitch in a screenshot (Python + Pillow)
@run  python -I vision/detect_grid.py shot.png

Find a sudoku grid in a full screenshot and emit its geometry, so a solve does not depend on a
hand-measured origin that breaks when the browser chrome shifts the board down. Prints JSON:

  {"ok":true, "bbox":[x0,y0,x1,y1], "origin":[cx,cy], "step":[dx,dy], "square":0.99}

origin = pixel center of cell (0,0); step = cell pitch. Feed these to fill.js / sudoku.js.

How: a sudoku grid is a square of 10x10 dark lines on white. A GRID LINE is the full width/height of the
grid as one contiguous dark run; TEXT (the difficulty tabs, headings, digits) is broken into short runs.
So the longest contiguous dark run per row/column separates grid lines from everything else -- no reliance
on absolute positions. Needs Pillow. Run with -I so a planted module next to the image can't be imported.
"""
import sys, json
from PIL import Image

src = sys.argv[1]
im = Image.open(src).convert('L')
W, H = im.size
px = im.load()
# where the board plausibly is on a ~1920x1080 page (generous; refined by the run detector below)
if len(sys.argv) > 2:
    X0, Y0, X1, Y1 = [int(v) for v in sys.argv[2].split(',')]
else:
    X0, Y0, X1, Y1 = 320, 140, 1020, 820
X0, Y0 = max(0, X0), max(0, Y0)
X1, Y1 = min(W, X1), min(H, Y1)
DARK = 175          # grid lines are dark navy on white; anti-aliased edge still well under this
GAP = 2             # tolerate a 1-2px anti-aliasing break in a line

def longest_run_row(y, xa, xb):
    best = cur = g = 0
    for x in range(xa, xb):
        if px[x, y] < DARK:
            cur += 1; g = 0
            if cur > best: best = cur
        else:
            g += 1
            if g > GAP: cur = 0
            elif cur: cur += 1      # count a tolerated gap as part of the run
    return best

def longest_run_col(x, ya, yb):
    best = cur = g = 0
    for y in range(ya, yb):
        if px[x, y] < DARK:
            cur += 1; g = 0
            if cur > best: best = cur
        else:
            g += 1
            if g > GAP: cur = 0
            elif cur: cur += 1
    return best

# 1. grid's vertical extent: rows whose longest dark run spans most of the search width are grid lines
rowrun = [longest_run_row(y, X0, X1) for y in range(Y0, Y1)]
mx = max(rowrun) if rowrun else 0
if mx < 120:
    print(json.dumps({"ok": False, "why": "no long horizontal lines found", "maxrun": mx})); sys.exit(1)
thr = max(120, mx * 0.75)
line_ys = [Y0 + i for i, r in enumerate(rowrun) if r >= thr]
gy0, gy1 = min(line_ys), max(line_ys)

# 2. grid's horizontal extent: within that y-band, columns whose longest dark run spans most of its height
colrun = [longest_run_col(x, gy0, gy1 + 1) for x in range(X0, X1)]
mxc = max(colrun) if colrun else 0
thrc = max(120, mxc * 0.75)
line_xs = [X0 + i for i, c in enumerate(colrun) if c >= thrc]
gx0, gx1 = min(line_xs), max(line_xs)

w, h = gx1 - gx0, gy1 - gy0
square = round(min(w, h) / max(w, h), 3)           # ~1.0 for a real 9x9 grid; a bad detect is lopsided
if w < 180 or h < 180 or square < 0.96:
    print(json.dumps({"ok": False, "why": "not a plausible square", "bbox": [gx0, gy0, gx1, gy1], "square": square})); sys.exit(1)
stepx, stepy = w / 9.0, h / 9.0

# CONFIDENCE that this really is a 9x9 board: the two 3x3 BOX-SEPARATOR lines (at 1/3 and 2/3) are darker
# than the thin cell lines and, unlike a "best score" table or any other dark rectangle, sit at those exact
# fractions. Reported as `boxsep` (0-4), not hard-failed -- the caller pairs it with `square` to decide
# whether to trust the detection or fall back to the proven hand-measured geometry.
def has_line(fixed, a, b, horizontal, thr=175):
    best = cur = g = 0
    for v in range(a, b):
        p = px[v, fixed] if horizontal else px[fixed, v]
        if p < thr:
            cur += 1; g = 0; best = max(best, cur)
        else:
            g += 1
            if g > GAP: cur = 0
            elif cur: cur += 1
    return best > (b - a) * 0.6
boxv = sum(1 for k in (3, 6) if any(has_line(round(gx0 + k * stepx) + d, gy0, gy1, False) for d in (-2, -1, 0, 1, 2)))
boxh = sum(1 for k in (3, 6) if any(has_line(round(gy0 + k * stepy) + d, gx0, gx1, True) for d in (-2, -1, 0, 1, 2)))

step = [round(stepx, 2), round(stepy, 2)]
origin = [round(gx0 + stepx / 2, 1), round(gy0 + stepy / 2, 1)]
print(json.dumps({"ok": True, "bbox": [gx0, gy0, gx1, gy1], "origin": origin, "step": step, "square": square, "boxsep": boxv + boxh}))

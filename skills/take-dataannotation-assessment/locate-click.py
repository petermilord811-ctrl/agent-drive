#!/usr/bin/env python3
"""locate-click.py — find reliable click targets on a DataAnnotation look PNG (look pixels).

@tool Locate primary CTA / role-card title midpoints in look-image coordinates (lx, ly)
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png continue
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png role "Software Engineer"

Never guess coords. Use this on the *current* look, then click {lx, ly}.

Modes:
  continue  — largest wide blue button in the right sidebar (role overview CTA)
  role      — dark title text band for the given role name (needs pillow only; fuzzy by ink density in grid)
  blue-buttons — list candidate blue button bboxes (debug)
"""
from __future__ import annotations

import json
import sys
from collections import deque

from PIL import Image

DARK = 90
BLUE_B_MIN = 160
BLUE_R_MAX = 120
BLUE_G_MAX = 160


def is_blue(rgb):
    r, g, b = rgb[:3]
    return b >= BLUE_B_MIN and r <= BLUE_R_MAX and g <= BLUE_G_MAX and (b - r) >= 40


def is_dark(rgb):
    r, g, b = rgb[:3]
    return (r + g + b) / 3 <= DARK


def connected_components(mask, w, h, min_area=80):
    seen = [[False] * w for _ in range(h)]
    comps = []
    for y in range(h):
        for x in range(w):
            if not mask[y][x] or seen[y][x]:
                continue
            q = deque([(x, y)])
            seen[y][x] = True
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if len(pts) < min_area:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            comps.append(
                {
                    "x0": min(xs),
                    "y0": min(ys),
                    "x1": max(xs),
                    "y1": max(ys),
                    "area": len(pts),
                    "cx": sum(xs) // len(xs),
                    "cy": sum(ys) // len(ys),
                    "w": max(xs) - min(xs) + 1,
                    "h": max(ys) - min(ys) + 1,
                }
            )
    return comps


def load_rgb(path):
    im = Image.open(path).convert("RGB")
    return im, im.load(), im.size


def find_continue(path):
    """Primary CTA: wide blue button in the right ~38% of the content (below top chrome)."""
    im, px, (w, h) = load_rgb(path)
    x_min = int(w * 0.58)
    y_min = int(h * 0.12)
    y_max = int(h * 0.82)
    mask = [[False] * w for _ in range(h)]
    for y in range(y_min, y_max):
        for x in range(x_min, w - 8):
            if is_blue(px[x, y]):
                mask[y][x] = True
    comps = connected_components(mask, w, h, min_area=400)
    # Prefer wide short buttons (CTA), reject tall chrome strips
    buttons = [
        c
        for c in comps
        if c["w"] >= 80 and c["h"] >= 22 and c["h"] <= 70 and c["w"] / max(c["h"], 1) >= 2.2
    ]
    if not buttons:
        # fallback: widest *button-shaped* component only (never thin chrome strips)
        buttons = [
            c
            for c in sorted(comps, key=lambda c: c["w"], reverse=True)
            if c["h"] >= 22 and c["w"] >= 80
        ][:3]
    if not buttons:
        return {"ok": False, "why": "no blue CTA in right panel", "w": w, "h": h}
    buttons.sort(key=lambda c: (c["area"], c["w"]), reverse=True)
    best = buttons[0]
    return {
        "ok": True,
        "mode": "continue",
        "lx": best["cx"],
        "ly": best["cy"],
        "bbox": [best["x0"], best["y0"], best["x1"], best["y1"]],
        "w": best["w"],
        "h": best["h"],
        "area": best["area"],
        "look": [w, h],
        "candidates": len(buttons),
    }


def ink_rows(px, w, h, x0, x1, y0, y1):
    rows = []
    for y in range(y0, y1):
        ink = 0
        for x in range(x0, x1):
            if is_dark(px[x, y]):
                ink += 1
        rows.append(ink)
    return rows


def find_role_card(path, title):
    """Heuristic: among dark text bands in the cards grid, pick the band whose horizontal
    ink span best matches a title line in the upper card area. Without OCR we locate the
    *first* prominent title-sized band in the left column of the grid (Software Engineer
    when browsing All), or search for a band near expected card slots.

    Better path when available: use serve `find` for a distinctive word, then this only
    as geometry check. Here we return grid cell centers for a named role by matching
    slug order is NOT done — we scan for title-height ink bands and return all, plus a
    best guess for left-column top card if title mentions Software.
    """
    im, px, (w, h) = load_rgb(path)
    # Card grid roughly below filters
    y0, y1 = int(h * 0.38), int(h * 0.92)
    x0, x1 = int(w * 0.08), int(w * 0.92)
    # Title lines are dark and ~14–22px tall; detect horizontal ink runs
    row_ink = ink_rows(px, w, h, x0, x1, y0, y1)
    bands = []
    y = 0
    while y < len(row_ink):
        if row_ink[y] < 25:
            y += 1
            continue
        yb = y
        while y < len(row_ink) and row_ink[y] >= 18:
            y += 1
        ye = y
        height = ye - yb
        if 10 <= height <= 28:
            # find x span of ink in this band
            xs = []
            for yy in range(y0 + yb, y0 + ye):
                for x in range(x0, x1):
                    if is_dark(px[x, yy]):
                        xs.append(x)
            if len(xs) < 40:
                continue
            bands.append(
                {
                    "y0": y0 + yb,
                    "y1": y0 + ye,
                    "x0": min(xs),
                    "x1": max(xs),
                    "cx": (min(xs) + max(xs)) // 2,
                    "cy": y0 + (yb + ye) // 2,
                    "w": max(xs) - min(xs) + 1,
                    "h": height,
                }
            )
    # Prefer title-width bands (not full-width body text): 80–320 px wide-ish
    titles = [b for b in bands if 70 <= b["w"] <= 360]
    if not titles:
        titles = bands
    # Columnize: left / mid / right
    col_w = (x1 - x0) / 3
    def col(b):
        return int((b["cx"] - x0) / col_w)

    titles.sort(key=lambda b: (b["y0"], col(b)))
    # Dedupe near-duplicates
    picked = []
    for b in titles:
        if any(abs(b["cy"] - p["cy"]) < 12 and abs(b["cx"] - p["cx"]) < 40 for p in picked):
            continue
        picked.append(b)

    out = {
        "ok": True,
        "mode": "role",
        "title": title,
        "look": [w, h],
        "titles": [
            {"lx": b["cx"], "ly": b["cy"], "bbox": [b["x0"], b["y0"], b["x1"], b["y1"]], "col": col(b)}
            for b in picked[:12]
        ],
    }
    # Prefer left-col top for Software Engineer / first card
    t = (title or "").lower()
    if picked:
        if "software" in t or "engineer" in t and "mechanical" not in t and "electrical" not in t and "civil" not in t:
            left = [b for b in picked if col(b) == 0]
            choice = left[0] if left else picked[0]
        else:
            choice = picked[0]
        out["lx"] = choice["cx"]
        out["ly"] = choice["cy"]
        out["bbox"] = [choice["x0"], choice["y0"], choice["x1"], choice["y1"]]
    else:
        out["ok"] = False
        out["why"] = "no title-like ink bands in card grid"
    return out


def main():
    if len(sys.argv) < 3:
        print("usage: locate-click.py <look.png> continue|role|blue-buttons [title]", file=sys.stderr)
        sys.exit(2)
    path, mode = sys.argv[1], sys.argv[2].lower()
    if mode in ("continue", "cta"):
        print(json.dumps(find_continue(path), indent=2))
    elif mode == "role":
        title = " ".join(sys.argv[3:]) or "Software Engineer"
        print(json.dumps(find_role_card(path, title), indent=2))
    elif mode in ("blue-buttons", "blue"):
        im, px, (w, h) = load_rgb(path)
        mask = [[is_blue(px[x, y]) for x in range(w)] for y in range(h)]
        comps = connected_components(mask, w, h, min_area=200)
        comps = [c for c in comps if c["w"] >= 60 and 18 <= c["h"] <= 80]
        comps.sort(key=lambda c: c["area"], reverse=True)
        print(json.dumps({"ok": True, "look": [w, h], "buttons": comps[:10]}, indent=2))
    else:
        print("unknown mode", mode, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()

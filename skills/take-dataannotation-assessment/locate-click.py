#!/usr/bin/env python3
"""locate-click.py — zone-safe click targets on DataAnnotation look PNGs (look pixels).

ROOT CAUSES of prior mis-clicks (host 34123):
  1. No sidebar vs content split → content radio clicks at x≈320 hit left-nav (jumped to Q5).
  2. Next Y reused across pages → footer drifts 588–660; stale coords look like "Next broken".
  3. role mode returned first ink band (always col 0) for any title → wrong card.
  4. Single-click on Browse cards often no-ops → need dbl on card BODY, not title ink.
  5. OCR/clickText often chrome-only → must be pixel geometry, not text.

CONTRACT:
  Always run on the *current* look.png, then click {lx,ly} (or dbl if action=dbl).
  Content modes NEVER return a point with lx <= sidebar_edge.
  Re-measure after every click; never reuse coords from a prior look.

@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png zones
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png continue
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png next
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png back
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png radios
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png radio 0
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png sidebar 3
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png role "Data Scientist"
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png start
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png scroll-complete
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png textarea
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png textarea 1
@run  python -I skills/take-dataannotation-assessment/locate-click.py look.png textarea --near "first rubric"
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import deque
from pathlib import Path

from PIL import Image

DARK = 90
# Browse card titles are mid-gray (~100–130), not near-black. Role finder
# must use this softer threshold or first-row cards vanish (99588 look-6).
CARD_TITLE_DARK = 155
# Assessment left-nav occupies ~look x 0–340 on 1280px looks (proven mis-click at x=320).
# Content radios start ~x≥360. Anything ≤ sidebar_edge is FORBIDDEN for content clicks.
SIDEBAR_FRAC = 0.275  # ≈352 @ 1280; detect_sidebar_edge may raise this
CONTENT_RADIO_PAD = 40  # extra pad past sidebar_edge before radios are legal
# Browse cards: title ink is top of card; body click is below title.
CARD_BODY_DY = 55


def is_blue(rgb):
    r, g, b = rgb[:3]
    return b >= 160 and r <= 120 and g <= 160 and (b - r) >= 40


def is_blue_loose(rgb):
    """Assessment Next / primary CTAs (lighter blue)."""
    r, g, b = rgb[:3]
    return b > 130 and b > r + 30 and b > g + 15 and r < 140


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


def detect_sidebar_edge(px, w, h):
    """Find left edge of main white content card (assessment) or default SIDEBAR_FRAC.

    Scans mid-height for the leftmost run of near-white that continues rightward —
    that is the content pane. Sidebar is everything left of it.
    """
    y_samples = [int(h * f) for f in (0.35, 0.45, 0.55, 0.65)]
    edges = []
    for y in y_samples:
        # Find first near-white pixel after a non-white region, starting from left margin
        x = int(w * 0.05)
        # skip chrome/white gutters
        while x < int(w * 0.45):
            r, g, b = px[x, y]
            # content cards are very white; sidebar text area is white too though.
            # Prefer: vertical rule / gray gutter between sidebar and card.
            # Look for a thin gray vertical separator then white card.
            if 200 <= r <= 235 and abs(r - g) < 15 and abs(g - b) < 15:
                # possible gutter — peek right for bright white card
                rr, gg, bb = px[min(w - 1, x + 8), y]
                if rr > 245 and gg > 245 and bb > 245:
                    edges.append(x + 4)
                    break
            x += 2
    floor = int(w * SIDEBAR_FRAC)
    if edges:
        edge = int(sum(edges) / len(edges))
        # clamp to sane assessment range; never below proven floor
        lo, hi = floor, int(w * 0.40)
        return max(lo, min(hi, edge))
    return floor


def zones(path):
    im, px, (w, h) = load_rgb(path)
    edge = detect_sidebar_edge(px, w, h)
    return {
        "ok": True,
        "mode": "zones",
        "look": [w, h],
        "sidebar_edge": edge,
        "content_x_min": edge + 1,
        "forbid_content_click_if_lx_le": edge,
        "footer_y_min": int(h * 0.55),
        "rules": {
            "content_radios": f"lx > {edge}",
            "sidebar_nav": f"lx < {edge - 10}",
            "next": f"lx > {int(w * 0.70)} and ly > {int(h * 0.55)}",
            "role_cards": "dbl on card body center, not title ink",
        },
    }


def _button_shaped(c, *, compact=False):
    if c["w"] < 60 or c["h"] < 18 or c["h"] > 70:
        return False
    if c["w"] / max(c["h"], 1) < 1.8:
        return False
    if compact and c["w"] > 120:
        return False
    return True


def find_continue(path):
    """Role-overview Continue: wide blue in right rail."""
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
    buttons = [c for c in comps if _button_shaped(c)]
    if not buttons:
        buttons = [
            c
            for c in sorted(comps, key=lambda c: c["w"], reverse=True)
            if c["h"] >= 18 and c["w"] >= 80
        ][:3]
    if not buttons:
        return {"ok": False, "why": "no Continue CTA in right rail", "w": w, "h": h}
    buttons.sort(key=lambda c: (c["area"], c["w"]), reverse=True)
    best = buttons[0]
    return _hit("continue", best, w, h, action="click", candidates=len(buttons))


def find_next(path):
    """Assessment footer Next: compact loose-blue, RIGHT + LOW, never sidebar."""
    im, px, (w, h) = load_rgb(path)
    edge = detect_sidebar_edge(px, w, h)
    x_min = max(edge + 20, int(w * 0.55))
    y_min = int(h * 0.50)
    y_max = int(h * 0.96)
    mask = [[False] * w for _ in range(h)]
    for y in range(y_min, y_max):
        for x in range(x_min, w - 4):
            if is_blue_loose(px[x, y]):
                mask[y][x] = True
    comps = connected_components(mask, w, h, min_area=180)
    buttons = [c for c in comps if _button_shaped(c, compact=True)]
    if not buttons:
        buttons = [
            c
            for c in comps
            if c["w"] >= 48 and 16 <= c["h"] <= 56 and c["w"] <= 130 and c["cx"] > x_min
        ]
    if not buttons:
        return {
            "ok": False,
            "why": "no compact Next CTA in content footer",
            "sidebar_edge": edge,
            "w": w,
            "h": h,
        }
    # Prefer lowest (footer), then rightmost — rejects mid-page blue labels / links
    buttons.sort(key=lambda c: (c["y1"], c["cx"]), reverse=True)
    best = buttons[0]
    if best["cx"] <= edge:
        return {"ok": False, "why": "Next candidate inside sidebar — refused", "sidebar_edge": edge}
    out = _hit("next", best, w, h, action="click", candidates=len(buttons))
    out["sidebar_edge"] = edge
    out["note"] = "re-measure on every page — Next Y drifts with content height"
    return out


def find_back(path):
    """Assessment footer Back: light bordered control left of content footer."""
    im, px, (w, h) = load_rgb(path)
    edge = detect_sidebar_edge(px, w, h)
    # Back is typically a white chip with gray border near content left, footer band
    y_min = int(h * 0.72)
    y_max = int(h * 0.96)
    x_min = edge + 10
    x_max = int(w * 0.55)
    # Detect gray horizontal border runs (button outline)
    cands = []
    for y in range(y_min, y_max):
        run = 0
        run_x0 = 0
        for x in range(x_min, x_max):
            r, g, b = px[x, y]
            gray = 160 <= r <= 220 and abs(r - g) < 20 and abs(g - b) < 20
            if gray:
                if run == 0:
                    run_x0 = x
                run += 1
            else:
                if 40 <= run <= 140:
                    cands.append((run_x0, y, run))
                run = 0
        if 40 <= run <= 140:
            cands.append((run_x0, y, run))
    if not cands:
        # fallback: known relative — left footer mid of content
        return {
            "ok": True,
            "mode": "back",
            "lx": edge + 80,
            "ly": int(h * 0.90),
            "action": "click",
            "sidebar_edge": edge,
            "look": [w, h],
            "note": "fallback geometry — prefer find OCR Back when available",
            "weak": True,
        }
    # Cluster by y
    cands.sort(key=lambda t: t[1])
    x0, y0, rw = cands[len(cands) // 2]
    return {
        "ok": True,
        "mode": "back",
        "lx": x0 + rw // 2,
        "ly": y0 + 10,
        "action": "click",
        "sidebar_edge": edge,
        "look": [w, h],
    }


def find_start(path):
    """Bio-2 Start assessment — blue CTA in lower content (often lower-LEFT).

    HARD (99588 DS Bio2): button was ~83×27 at ~(393,544) — old finder required
    w>=100 and x_min=0.35w so it missed. Prefer lowest mid-size blue chip below 0.55h.
    """
    im, px, (w, h) = load_rgb(path)
    x_min = int(w * 0.20)
    y_min = int(h * 0.45)
    mask = [[False] * w for _ in range(h)]
    for y in range(y_min, h - 8):
        for x in range(x_min, int(w * 0.75)):
            if is_blue(px[x, y]) or is_blue_loose(px[x, y]):
                mask[y][x] = True
    comps = connected_components(mask, w, h, min_area=400)
    buttons = [c for c in comps if c["w"] >= 70 and 18 <= c["h"] <= 72 and c["w"] <= 280]
    if not buttons:
        return {"ok": False, "why": "no Start assessment CTA", "w": w, "h": h}
    # Prefer lowest (footer-ish), then larger
    buttons.sort(key=lambda c: (c["y1"], c["area"]), reverse=True)
    return _hit("start", buttons[0], w, h, action="click", candidates=len(buttons))


def _hit(mode, best, w, h, *, action, candidates):
    return {
        "ok": True,
        "mode": mode,
        "lx": best["cx"],
        "ly": best["cy"],
        "bbox": [best["x0"], best["y0"], best["x1"], best["y1"]],
        "w": best["w"],
        "h": best["h"],
        "area": best["area"],
        "action": action,
        "look": [w, h],
        "candidates": candidates,
    }


def _ring_hits(px, w, h, x_min, x_max, y_min, y_max):
    hits = []
    for y in range(y_min, y_max):
        for x in range(x_min, x_max):
            r, g, b = px[x, y]
            if not (90 <= r <= 190 and abs(r - g) < 25 and abs(g - b) < 25):
                continue
            whites = darks = 0
            for dy in range(-8, 9):
                for dx in range(-8, 9):
                    xx, yy = x + dx, y + dy
                    if not (0 <= xx < w and 0 <= yy < h):
                        continue
                    rr, gg, bb = px[xx, yy]
                    dist = (dx * dx + dy * dy) ** 0.5
                    if dist <= 4:
                        if rr > 230 and gg > 230 and bb > 230:
                            whites += 1
                    elif 5.5 <= dist <= 8.5:
                        if rr < 200 and abs(rr - gg) < 30:
                            darks += 1
            if whites >= 20 and darks >= 12:
                hits.append((x, y))
    seen = []
    for x, y in hits:
        if any(abs(x - sx) < 14 and abs(y - sy) < 14 for sx, sy in seen):
            continue
        seen.append((x, y))
    return seen


def _vertical_option_column(points, x_tol=18, min_stack=2):
    """MC radios form a vertical stack at nearly the same x. Prefer that column.

    Letter-hole false positives are scattered; real options share x and are
    evenly spaced in y. Returns points in the best column, sorted by y.
    """
    if not points:
        return []
    # bucket by x
    buckets = {}
    for x, y in points:
        key = (x // x_tol) * x_tol
        buckets.setdefault(key, []).append((x, y))
    best_key = None
    best_score = -1
    for key, pts in buckets.items():
        pts = sorted(pts, key=lambda p: p[1])
        # score: stack size + bonus for regular spacing
        if len(pts) < min_stack:
            score = len(pts) * 0.5
        else:
            dys = [pts[i + 1][1] - pts[i][1] for i in range(len(pts) - 1)]
            med = sorted(dys)[len(dys) // 2]
            regular = sum(1 for d in dys if abs(d - med) <= 12)
            # Prefer left-ish content columns (option labels), not mid-page noise
            score = len(pts) * 10 + regular * 3 - abs(key - 450) * 0.01
        if score > best_score:
            best_score = score
            best_key = key
    col = sorted(buckets[best_key], key=lambda p: p[1])
    # Merge near-duplicates in column
    out = []
    for x, y in col:
        if out and abs(y - out[-1][1]) < 16:
            continue
        out.append((x, y))
    return out


def _choice_cluster(points, gap_split=55, min_gap=18, max_gap=110, prefer_n=(2, 8)):
    """Pick the MCQ choice stack from a noisy vertical column.

    HARD (99588 SE Q1): code/monospace dots produced 13 ring hits; real choices
    are 3–6 radios with ~25–70px gaps. Split the column on large Y gaps and
    score clusters by size + gap regularity in [min_gap, max_gap].
    """
    if not points:
        return [], []
    pts = sorted(points, key=lambda p: p[1])
    # merge near-duplicates
    merged = []
    for x, y in pts:
        if merged and abs(y - merged[-1][1]) < 14:
            continue
        merged.append((x, y))

    clusters = []
    cur = [merged[0]]
    for p in merged[1:]:
        if p[1] - cur[-1][1] >= gap_split:
            clusters.append(cur)
            cur = [p]
        else:
            cur.append(p)
    clusters.append(cur)

    def score(cl):
        n = len(cl)
        if n < 2:
            return -100
        dys = [cl[i + 1][1] - cl[i][1] for i in range(n - 1)]
        med = sorted(dys)[len(dys) // 2]
        if not (min_gap <= med <= max_gap):
            return -50 + n
        regular = sum(1 for d in dys if abs(d - med) <= 14)
        lo, hi = prefer_n
        size_bonus = 30 if lo <= n <= hi else (10 if n <= hi + 2 else -n)
        # Prefer lower clusters (choices sit under solutions / prompts)
        y_bonus = cl[0][1] * 0.02
        return size_bonus + regular * 5 + y_bonus - abs(med - 40) * 0.1

    ranked = sorted(clusters, key=score, reverse=True)
    best = ranked[0] if ranked else []
    alts = [{"n": len(c), "y0": c[0][1], "y1": c[-1][1], "score": round(score(c), 2)} for c in ranked[:4]]
    # If best is still huge (code column), try the best cluster with n<=8
    if len(best) > 8:
        tight = [c for c in ranked if 2 <= len(c) <= 8]
        if tight:
            best = tight[0]
    return best, alts


def find_radios(path, index=None, choices_only=True):
    """Hollow radio rings in CONTENT pane only — MCQ choice cluster preferred.

    By default returns the *choice* cluster (not every ring hit). Pass
    choices_only=False only for debugging.
    """
    im, px, (w, h) = load_rgb(path)
    edge = detect_sidebar_edge(px, w, h)
    x_min = max(edge + CONTENT_RADIO_PAD, int(w * 0.28))
    # Hard floor: never accept the proven sidebar danger zone (x<=340 @ 1280)
    x_min = max(x_min, int(w * 0.275) + CONTENT_RADIO_PAD)
    x_max = min(w - 10, int(w * 0.62))
    y_min = int(h * 0.20)
    y_max = int(h * 0.82)
    raw = _ring_hits(px, w, h, x_min, x_max, y_min, y_max)
    raw = [(x, y) for x, y in raw if x > edge + CONTENT_RADIO_PAD]
    stacked = _vertical_option_column(raw, min_stack=2)
    column = stacked if len(stacked) >= 2 else raw
    cluster, cluster_alts = _choice_cluster(column)
    if choices_only and len(cluster) >= 2:
        chosen = cluster
        filtered = True
    else:
        chosen = column
        filtered = len(stacked) >= 2
    radios = [{"i": i, "lx": x, "ly": y, "action": "click"} for i, (x, y) in enumerate(chosen)]
    out = {
        "ok": bool(radios),
        "mode": "radios" if choices_only else "radios-raw",
        "sidebar_edge": edge,
        "content_x_min": x_min,
        "look": [w, h],
        "count": len(radios),
        "raw_hits": len(raw),
        "column_hits": len(column),
        "column_filtered": len(stacked) >= 2,
        "choice_cluster": True if (choices_only and len(cluster) >= 2) else False,
        "cluster_alts": cluster_alts,
        "radios": radios,
        "why": None if radios else "no content-pane radio rings",
        "note": (
            "index 0 = top MCQ choice in the choice cluster; "
            "never click lx<=content_x_min; "
            "use mode radios-raw to see unclustered hits"
        ),
    }
    if index is not None:
        if index < 0 or index >= len(radios):
            return {
                "ok": False,
                "why": f"radio index {index} out of range (have {len(radios)} choices)",
                "sidebar_edge": edge,
                "content_x_min": x_min,
                "radios": radios,
                "cluster_alts": cluster_alts,
                "raw_hits": len(raw),
                "column_hits": len(column),
            }
        r = radios[index]
        if r["lx"] <= edge + CONTENT_RADIO_PAD:
            return {"ok": False, "why": "refused: radio in sidebar danger zone", "r": r}
        out.update(
            {
                "ok": True,
                "mode": "radio",
                "lx": r["lx"],
                "ly": r["ly"],
                "i": index,
                "action": "click",
            }
        )
    return out


def find_sidebar_item(path, index=0):
    """Left-nav step rows (assessment). Returns point INSIDE sidebar only."""
    im, px, (w, h) = load_rgb(path)
    edge = detect_sidebar_edge(px, w, h)
    x_max = edge - 12
    x_min = int(w * 0.04)
    y_min = int(h * 0.18)
    y_max = int(h * 0.88)
    # Row candidates: dark ink bands in sidebar
    row_ink = []
    for y in range(y_min, y_max):
        ink = sum(1 for x in range(x_min, x_max) if is_dark(px[x, y]))
        row_ink.append(ink)
    bands = []
    y = 0
    while y < len(row_ink):
        if row_ink[y] < 8:
            y += 1
            continue
        yb = y
        while y < len(row_ink) and row_ink[y] >= 6:
            y += 1
        ye = y
        if 8 <= (ye - yb) <= 26:
            cy = y_min + (yb + ye) // 2
            bands.append({"ly": cy, "lx": (x_min + x_max) // 2, "h": ye - yb})
    # Dedupe
    picked = []
    for b in bands:
        if any(abs(b["ly"] - p["ly"]) < 14 for p in picked):
            continue
        picked.append(b)
    if not picked:
        return {"ok": False, "why": "no sidebar nav rows", "sidebar_edge": edge}
    if index < 0 or index >= len(picked):
        return {
            "ok": False,
            "why": f"sidebar index {index} out of range (have {len(picked)})",
            "items": picked,
            "sidebar_edge": edge,
        }
    b = picked[index]
    # Safety: must be left of edge
    lx = min(b["lx"], edge - 20)
    return {
        "ok": True,
        "mode": "sidebar",
        "i": index,
        "lx": lx,
        "ly": b["ly"],
        "action": "click",
        "sidebar_edge": edge,
        "look": [w, h],
        "count": len(picked),
        "note": "sidebar only — never use for content radios",
    }


def find_role_card(path, title):
    """Browse-grid role card BODY center. Always recommend dbl.

    Fixes: old code returned first ink band (col 0) for every title.
    Now: build 3-col title bands, match title tokens to the band whose
    relative slot / column is best — and shift ly down into card body.
    """
    im, px, (w, h) = load_rgb(path)
    y0, y1 = int(h * 0.32), int(h * 0.92)
    x0, x1 = int(w * 0.06), int(w * 0.94)
    def is_title_ink(rgb):
        r, g, b = rgb[:3]
        return (r + g + b) / 3 <= CARD_TITLE_DARK

    # Collect title-sized ink bands.
    # HARD (99588 / Daniel Herman 2026-11-08):
    # 1) DARK=90 missed gray titles (mean~103) → empty cards[]
    # 2) Full-width scan merges 3 titles (bw≈488) → drop all. Split x-segs.
    bands = []
    y = y0
    while y < y1:
        ink_xs = [x for x in range(x0, x1) if is_title_ink(px[x, y])]
        if len(ink_xs) < 20:
            y += 1
            continue
        yb = y
        while y < y1 and sum(1 for x in range(x0, x1) if is_title_ink(px[x, y])) >= 15:
            y += 1
        ye = y
        height = ye - yb
        if not (8 <= height <= 32):
            continue
        xs = []
        for yy in range(yb, ye):
            for x in range(x0, x1):
                if is_title_ink(px[x, yy]):
                    xs.append(x)
        if len(xs) < 30:
            continue
        xs = sorted(set(xs))
        segs = []
        start = xs[0]
        prev = xs[0]
        for x in xs[1:]:
            if x - prev >= 28:
                segs.append((start, prev))
                start = x
            prev = x
        segs.append((start, prev))
        for sx0, sx1 in segs:
            bw = sx1 - sx0 + 1
            if not (50 <= bw <= 420):
                continue
            bands.append(
                {
                    "x0": sx0,
                    "x1": sx1,
                    "y0": yb,
                    "y1": ye,
                    "cx": (sx0 + sx1) // 2,
                    "cy": (yb + ye) // 2,
                    "w": bw,
                    "h": height,
                }
            )
    # Dedupe
    picked = []
    for b in bands:
        if any(abs(b["cy"] - p["cy"]) < 12 and abs(b["cx"] - p["cx"]) < 50 for p in picked):
            continue
        picked.append(b)

    col_w = (x1 - x0) / 3.0

    def col_of(b):
        return min(2, max(0, int((b["cx"] - x0) / col_w)))

    # Group into rows by cy
    picked.sort(key=lambda b: (b["cy"], b["cx"]))
    rows = []
    for b in picked:
        if not rows or abs(b["cy"] - rows[-1][0]["cy"]) > 40:
            rows.append([b])
        else:
            rows[-1].append(b)

    tokens = [t for t in (title or "").lower().split() if len(t) > 2]
    # Without OCR we cannot read the title — use catalog order heuristics ONLY as
    # last resort. Prefer returning ALL card body targets so the agent can pick.
    cards = []
    for ri, row in enumerate(rows):
        row.sort(key=lambda b: b["cx"])
        for b in row:
            c = col_of(b)
            body_ly = min(h - 20, b["cy"] + CARD_BODY_DY)
            cards.append(
                {
                    "row": ri,
                    "col": c,
                    "title_lx": b["cx"],
                    "title_ly": b["cy"],
                    "lx": b["cx"],
                    "ly": body_ly,
                    "bbox": [b["x0"], b["y0"], b["x1"], b["y1"]],
                    "action": "dbl",
                }
            )

    out = {
        "ok": bool(cards),
        "mode": "role",
        "title": title,
        "look": [w, h],
        "action": "dbl",
        "cards": cards[:15],
        "note": "ALWAYS dbl the card body (ly = title_cy + {}). Single click often no-ops.".format(
            CARD_BODY_DY
        ),
    }
    if not cards:
        out["why"] = "no title-like bands in card grid"
        return out

    # Token heuristics for common first-row cards (Browse All default order)
    choice = None
    t = (title or "").lower()
    first_row = [c for c in cards if c["row"] == 0]
    if "software" in t and first_row:
        choice = next((c for c in first_row if c["col"] == 0), first_row[0])
    elif "generalist" in t and first_row:
        choice = next((c for c in first_row if c["col"] == 1), None)
    elif ("data scientist" in t or ("scientist" in t and "computational" not in t)) and first_row:
        choice = next((c for c in first_row if c["col"] == 2), None)
        if choice is None:
            choice = None  # fall through to browse-grid fallback below

    # HARD (99588): first card-title row (~y 320–350 @1280) is often missed while the
    # second row (Finance…) becomes "row 0". Prefer a browse-grid fallback for the
    # default All(103) first row when heuristics would click the wrong band.
    BROWSE_ROW0_TITLE_Y = int(h * 0.46)  # ~333 @ 720
    if choice is not None and choice.get("title_ly", 0) > BROWSE_ROW0_TITLE_Y + 40:
        # Detected "first row" is actually mid-grid — ignore for known top cards
        if any(k in t for k in ("software", "generalist", "data scientist", "scientist")):
            choice = None

    if choice is None and any(
        k in t for k in ("software", "generalist", "data scientist", "finance")
    ):
        # Fixed 3-col browse geometry (look 1280×720 proven on 99588)
        col = 0
        if "generalist" in t:
            col = 1
        elif "data scientist" in t or ("scientist" in t and "computational" not in t):
            col = 2
        elif "finance" in t:
            col = 0
            # finance is usually row 1 — keep band match if available
            second = [c for c in cards if c["row"] == 1]
            if second:
                choice = next((c for c in second if c["col"] == 0), second[0])
        if choice is None:
            syn_lx = int(x0 + col_w * (col + 0.5))
            syn_title_ly = int(h * 0.462)  # ~333
            syn_ly = min(h - 20, syn_title_ly + CARD_BODY_DY)
            choice = {
                "row": 0,
                "col": col,
                "title_lx": syn_lx,
                "title_ly": syn_title_ly,
                "lx": syn_lx,
                "ly": syn_ly,
                "bbox": None,
                "action": "dbl",
                "synthesized": True,
                "fallback": "browse-grid-row0",
            }
            out["note"] = (out.get("note") or "") + " browse-grid-row0 fallback."
    elif "finance" in t and len(rows) > 1:
        # often row1 col0
        second = [c for c in cards if c["row"] == 1]
        choice = next((c for c in second if c["col"] == 0), second[0] if second else None)

    if choice is None:
        # Do NOT silently return col0 — force agent to pick from cards[]
        out["ok"] = False
        out["why"] = (
            f"ambiguous title '{title}' — pick from cards[] by row/col "
            "(do not guess). Filter Browse or Search first if needed."
        )
        return out

    out["ok"] = True
    out["lx"] = choice["lx"]
    out["ly"] = choice["ly"]
    out["row"] = choice["row"]
    out["col"] = choice["col"]
    out["bbox"] = choice["bbox"]
    return out


def is_near_white(rgb):
    r, g, b = rgb[:3]
    return r >= 245 and g >= 245 and b >= 245


def is_light_border(rgb):
    """Gray / soft border used around Explanation textareas."""
    r, g, b = rgb[:3]
    if max(r, g, b) - min(r, g, b) > 28:
        return False
    avg = (r + g + b) / 3
    return 150 <= avg <= 235


def _option_radio_cluster(radio_list, h):
    """Prefer the lower content vertical stack (real MCQ), ignore code-glyph false hits."""
    if not radio_list:
        return []
    # Group by proximity in Y (gaps > 55px start a new cluster)
    ordered = sorted(radio_list, key=lambda r: r["ly"])
    clusters = [[ordered[0]]]
    for r in ordered[1:]:
        if r["ly"] - clusters[-1][-1]["ly"] <= 55:
            clusters[-1].append(r)
        else:
            clusters.append([r])
    # Prefer cluster with 2–6 radios in the lower half; else largest lower cluster
    lower = [c for c in clusters if c[0]["ly"] >= int(h * 0.40)]
    scored = lower or clusters
    scored.sort(key=lambda c: (len(c), c[-1]["ly"]), reverse=True)
    best = scored[0]
    # Cap to 6 (DA MCQs are short)
    return best[:6]


def _is_input_fill(rgb):
    """DA empty Goal/explain fill is often #f8f8f8 (248), not pure page white."""
    r, g, b = rgb[:3]
    if max(r, g, b) - min(r, g, b) > 12:
        return False
    avg = (r + g + b) / 3
    return 236 <= avg <= 252


def _is_field_interior(rgb):
    """#f8 fill or light placeholder ink — NOT pure page white (255).

    Pass-3 bug (live look-1): treating 255 as interior grew the whole content card.
    """
    r, g, b = rgb[:3]
    if max(r, g, b) - min(r, g, b) > 40:
        return False
    avg = (r + g + b) / 3
    # Input fill ~248; placeholder glyphs ~160–200 sit on that fill.
    # Allow slightly lighter padding but stop before page white.
    return 210 <= avg <= 252


def _is_soft_seed_row(px, y, x0, x1, step=6):
    """A soft field must seed on real #f8 fill, not page white."""
    samples = list(range(x0, max(x0 + 1, x1), step))
    if not samples:
        return False
    seeds = sum(1 for x in samples if _is_input_fill(px[x, y]))
    return seeds >= len(samples) * 0.45


def _row_dark_frac(px, y, x0, x1, step=4):
    samples = list(range(x0, max(x0 + 1, x1), step))
    if not samples:
        return 0.0
    dark = 0
    for x in samples:
        r, g, b = px[x, y][:3]
        if (r + g + b) / 3 <= 160:
            dark += 1
    return dark / len(samples)


def _box_upper_ink_frac(px, box):
    """Fraction of dark-ish pixels in the upper third (placeholder / prompt slab)."""
    y0 = box["y0"]
    y1 = box["y0"] + max(8, box["h"] // 3)
    x0 = box["x0"] + 6
    x1 = box["x1"] - 6
    if x1 <= x0 or y1 <= y0:
        return 0.0
    total = 0
    dark = 0
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 5):
            total += 1
            r, g, b = px[x, y][:3]
            if (r + g + b) / 3 <= 170:
                dark += 1
    return dark / total if total else 0.0


def _box_fill_mean(px, box):
    ys = range(box["y0"] + 4, max(box["y0"] + 5, box["y1"] - 4), 3)
    xs = range(box["x0"] + 8, max(box["x0"] + 9, box["x1"] - 8), 6)
    vals = []
    for y in ys:
        for x in xs:
            r, g, b = px[x, y][:3]
            vals.append((r + g + b) / 3)
    return sum(vals) / len(vals) if vals else 0.0


def _caret_ly(box):
    """Click below placeholder ink into the caret zone (99588 rubric recipe)."""
    h = max(1, int(box["h"]))
    if h < 36:
        # Single-line: click vertical mid (optional / share URL).
        return int(box["y0"] + h // 2)
    offset = max(28, min(48, int(h * 0.38)))
    return int(min(box["y0"] + offset, box["y1"] - 6))


def _score_textarea(box, w, h, edge, px, near_y=None):
    """Higher = more likely a real DA editable field (not prompt slab / Expires)."""
    score = 0.0
    # Geometry: wide content fields win; chip-sized lose.
    span = max(1, w - edge)
    score += min(40.0, 40.0 * box["w"] / span)
    if 48 <= box["h"] <= 160:
        score += 28.0
    elif 160 < box["h"] <= 280:
        score += 22.0  # tall Goal / rationale
    elif 36 <= box["h"] < 48:
        score += 18.0  # short rubric
    elif 20 <= box["h"] < 36:
        score += 14.0  # single-line optional / share
    else:
        score -= 10.0
    if box["y1"] >= int(h * 0.88):
        score -= 50.0  # Expires / footer band
    if box["cx"] <= edge + 20:
        score -= 80.0

    ink = _box_upper_ink_frac(px, box)
    # Light placeholder text is OK; dense prompt prose is not.
    # Fixture prompt slab ~0.07+; empty #f8 ~0; rubric placeholder ~0.006–0.04.
    if ink <= 0.02:
        score += 20.0  # empty #f8
    elif ink <= 0.045:
        score += 24.0  # light placeholder line (rubric)
    elif ink <= 0.08:
        score -= 15.0  # likely prompt / multi-line body text
    else:
        score -= 40.0  # prompt / instruction slab

    mean = _box_fill_mean(px, box)
    if 236 <= mean <= 252:
        score += 12.0
    elif 220 <= mean < 236:
        score += 6.0
    elif mean < 200:
        score -= 20.0

    if near_y is not None:
        # Prefer boxes whose top sits just under the label.
        dy = box["y0"] - near_y
        if 0 <= dy <= 140:
            score += 45.0 - dy * 0.15
        elif -20 <= dy < 0:
            score += 10.0  # label may sit inside the field (placeholder)
        else:
            score -= 25.0

    # Prefer not-tiny strips above a real twin (handled later by ranking too).
    if box["h"] < 40 and box.get("kind") == "fill248":
        score -= 15.0
    return score


def find_textareas(path, sidebar_edge=None):
    """Content-pane editable boxes: bordered white, #f8 fill, or placeholder fields.

    Upgrade (99588 night): empty rubrics have gray placeholder text that breaks a
    pure #f8 band. Pass 3 grows soft interior bands; scoring rejects prompt slabs.
    """
    im, px, (w, h) = load_rgb(path)
    if sidebar_edge is None:
        sidebar_edge = detect_sidebar_edge(px, w, h)
    x0 = int(sidebar_edge) + 20
    # Sticky footer usually occupies bottom ~90px of look; ignore it for field search.
    y_hi = int(h * 0.90)
    y_lo = int(h * 0.12)
    candidates = []
    span_need = max(80, int((w - x0) * 0.35))
    y = y_lo
    while y < y_hi - 28:
        border_xs = [x for x in range(x0, w - 12) if is_light_border(px[x, y])]
        if len(border_xs) < span_need:
            y += 2
            continue
        bx0, bx1 = min(border_xs), max(border_xs)
        if bx1 - bx0 < span_need:
            y += 2
            continue
        # skip 1–2px of border, then require INPUT fill (#f8), not page white (255).
        # Live miss: growing through 255 merged rubric1→gap→rubric2→footer.
        y1 = y + 2
        white_rows = 0
        gap = 0
        while y1 < y_hi:
            samples = list(range(bx0 + 8, bx1 - 8, 6))
            if not samples:
                break
            page_white = sum(
                1
                for x in samples
                if (px[x, y1][0] + px[x, y1][1] + px[x, y1][2]) / 3 >= 253
            )
            if page_white >= len(samples) * 0.55:
                break
            row_fill = sum(1 for x in samples if _is_field_interior(px[x, y1]))
            if row_fill < len(samples) * 0.50:
                gap += 1
                # tolerate 3 speckled rows; stop on a clear bottom border or footer band
                if gap <= 3 and white_rows >= 20:
                    y1 += 1
                    continue
                break
            gap = 0
            white_rows += 1
            y1 += 1
        box_h = y1 - y
        box_w = bx1 - bx0
        if box_w >= span_need and 28 <= box_h <= 280:
            candidates.append(
                {
                    "x0": bx0,
                    "y0": y,
                    "x1": bx1,
                    "y1": y1,
                    "w": box_w,
                    "h": box_h,
                    "cx": (bx0 + bx1) // 2,
                    "cy": (y + y1) // 2,
                    "kind": "border",
                }
            )
            y = y1 + 4
            continue
        y += 2

    # Pass 2 (99588 Conversation Goal): borderless #f8 fill blocks — no gray top border.
    # Page white is 255; input fill is ~248. Find tall contiguous input-fill bands.
    y = y_lo
    while y < y_hi - 40:
        fill_xs = [x for x in range(x0 + 8, w - 16) if _is_input_fill(px[x, y])]
        if len(fill_xs) < span_need:
            y += 2
            continue
        bx0, bx1 = min(fill_xs), max(fill_xs)
        if bx1 - bx0 < span_need:
            y += 2
            continue
        y0 = y
        y1 = y
        while y1 < y_hi:
            samples = list(range(bx0 + 8, min(bx1 - 8, w - 8), 6))
            if not samples:
                break
            ok = sum(1 for x in samples if _is_input_fill(px[x, y1])) >= len(samples) * 0.55
            if not ok:
                break
            y1 += 1
        box_h = y1 - y0
        box_w = bx1 - bx0
        # Single-line optional/share fields can be ~20–28px tall (99588 look-4).
        if box_w >= span_need and 20 <= box_h <= 320:
            candidates.append(
                {
                    "x0": bx0,
                    "y0": y0,
                    "x1": bx1,
                    "y1": y1,
                    "w": box_w,
                    "h": box_h,
                    "cx": (bx0 + bx1) // 2,
                    "cy": (y0 + y1) // 2,
                    "kind": "fill248",
                }
            )
            y = y1 + 4
            continue
        y += 2

    # Pass 3 (99588 empty rubrics): seed on #f8, grow through placeholder ink.
    # Placeholder text breaks pure fill248 bands; do not seed on page white.
    y = y_lo
    while y < y_hi - 36:
        if not _is_soft_seed_row(px, y, x0 + 8, w - 16):
            y += 2
            continue
        fill_xs = [x for x in range(x0 + 8, w - 16) if _is_input_fill(px[x, y]) or _is_field_interior(px[x, y])]
        if len(fill_xs) < span_need:
            y += 2
            continue
        bx0, bx1 = min(fill_xs), max(fill_xs)
        if bx1 - bx0 < span_need:
            y += 2
            continue
        if _row_dark_frac(px, y, bx0 + 8, bx1 - 8) > 0.35:
            y += 2
            continue
        y0 = y
        y1 = y
        while y1 < y_hi:
            samples = list(range(bx0 + 8, min(bx1 - 8, w - 8), 6))
            if not samples:
                break
            # Stop on page-white rows (leave the input).
            page_white = sum(
                1
                for x in samples
                if (px[x, y1][0] + px[x, y1][1] + px[x, y1][2]) / 3 >= 253
            )
            if page_white >= len(samples) * 0.55:
                break
            ok = sum(1 for x in samples if _is_field_interior(px[x, y1])) >= len(samples) * 0.55
            if not ok:
                # tolerate a few placeholder-dense rows mid-field
                if y1 - y0 >= 20 and _row_dark_frac(px, y1, bx0 + 8, bx1 - 8) <= 0.25:
                    y1 += 1
                    continue
                break
            y1 += 1
        box_h = y1 - y0
        box_w = bx1 - bx0
        if box_w >= span_need and 20 <= box_h <= 320:
            candidates.append(
                {
                    "x0": bx0,
                    "y0": y0,
                    "x1": bx1,
                    "y1": y1,
                    "w": box_w,
                    "h": box_h,
                    "cx": (bx0 + bx1) // 2,
                    "cy": (y0 + y1) // 2,
                    "kind": "soft",
                }
            )
            y = y1 + 4
            continue
        y += 2

    kept = []
    for c in sorted(candidates, key=lambda t: -t["h"] * t["w"]):
        if any(
            abs(c["cy"] - k["cy"]) < 28 and abs(c["cx"] - k["cx"]) < 40 for k in kept
        ):
            # Prefer the higher-scoring / better-kind duplicate later via rescoring.
            continue
        kept.append(c)
    # Attach scores for callers (near_y optional later).
    for c in kept:
        c["score"] = round(_score_textarea(c, w, h, sidebar_edge, px), 2)
        c["ink"] = round(_box_upper_ink_frac(px, c), 3)
    kept.sort(key=lambda t: (-t["score"], t["y0"]))
    return kept, w, h, sidebar_edge


def _look_ocr_find(path, needle):
    """Optional local OCR anchor (Windows). Returns {t,lx,ly,bbox} or None."""
    if not needle:
        return None
    script = Path(__file__).resolve().parent / "look-ocr.js"
    if not script.exists():
        return None
    try:
        out = subprocess.check_output(
            ["node", str(script), str(path), "--find", needle],
            text=True,
            stderr=subprocess.STDOUT,
            timeout=45,
        )
        data = json.loads(out)
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError):
        return None
    pick = data.get("pick")
    if not pick:
        return None
    return pick


def find_textarea_click(path, index=0, near=None, prefer_best=False):
    """Editable content fields (Goal, explanations, empty rubrics).

    HARD (99588 Daniel Herman 2026-11-08/09):
      - SM `field ""` marks → Expires chip — never trust them
      - Placeholder-label mark click → prove letter fails
      - Click caret zone (below placeholder), letter-prove, then keys
      - Prefer `--near "first rubric"` label anchor when available

    Indexing:
      - `textarea` (no index, prefer_best) → highest score among usable
      - `textarea N` → Nth box top-to-bottom
      - `textarea --near needle` → boxes under label, then index in that set
    """
    im, px, (w, h) = load_rgb(path)
    areas, w, h, edge = find_textareas(path)
    near_hit = _look_ocr_find(path, near) if near else None
    near_y = None
    if near_hit:
        bbox = near_hit.get("bbox") or [0, near_hit.get("ly", 0), 0, near_hit.get("ly", 0)]
        near_y = int(bbox[1] if len(bbox) > 1 else near_hit.get("ly", 0))

    # Rescore with optional label anchor.
    scored = []
    for a in areas:
        a = dict(a)
        a["score"] = round(_score_textarea(a, w, h, edge, px, near_y=near_y), 2)
        scored.append(a)

    usable = [
        a
        for a in scored
        if a["w"] >= int((w - edge) * 0.30)
        and a["h"] >= 20
        and a["cx"] > edge + 20
        and a["y1"] < int(h * 0.88)
        and a["score"] >= 20.0
        # Drop prompt/instruction slabs (99588 empty-rubrics fixture).
        and float(a.get("ink") or 0) <= 0.05
    ]
    # Drop weak short strips that sit directly above a stronger taller twin.
    filtered = []
    for a in sorted(usable, key=lambda t: (-t["score"], t["y0"])):
        dominated = False
        for b in filtered:
            if abs(a["cx"] - b["cx"]) < 50 and 0 < (b["y0"] - a["y1"]) < 36 and b["h"] >= a["h"] + 20:
                dominated = True
                break
            if abs(a["cx"] - b["cx"]) < 50 and 0 < (a["y0"] - b["y1"]) < 36 and a["h"] + 20 <= b["h"]:
                dominated = True
                break
        if not dominated:
            filtered.append(a)
    usable = filtered
    if near_y is not None:
        # Label may sit just above the box OR inside it as placeholder text.
        under = [
            a
            for a in usable
            if (a["y0"] - 15) <= near_y <= (a["y1"] + 8)
            or 0 <= (a["y0"] - near_y) <= 150
        ]
        if under:
            usable = under
    usable.sort(key=lambda a: a["y0"])

    if not usable:
        return {
            "ok": False,
            "mode": "textarea",
            "why": "no content textarea boxes — scroll problem pane or Expand All",
            "sidebar_edge": edge,
            "look": [w, h],
            "count": 0,
            "near": near,
            "near_hit": near_hit,
            "note": "Do not click mark field \"\" near Expires; re-look after scroll",
        }
    if prefer_best and near is None:
        # No explicit index: best score (avoids topmost prompt slab beating rubric).
        a = max(usable, key=lambda t: (t["score"], -t["y0"]))
        index = usable.index(a)
    else:
        if index < 0 or index >= len(usable):
            return {
                "ok": False,
                "why": f"textarea index {index} out of range (have {len(usable)})",
                "sidebar_edge": edge,
                "textareas": usable,
                "look": [w, h],
                "near": near,
                "near_hit": near_hit,
            }
        a = usable[index]
    lx = int(a["cx"])
    ly = _caret_ly(a)
    if lx <= edge + 20:
        return {"ok": False, "why": "refused: textarea in sidebar danger zone", "a": a}
    return {
        "ok": True,
        "mode": "textarea",
        "i": index,
        "lx": lx,
        "ly": ly,
        "action": "click",
        "snap": False,
        "aim": False,
        "prove": "letter",
        "sidebar_edge": edge,
        "look": [w, h],
        "count": len(usable),
        "box": a,
        "near": near,
        "near_hit": near_hit,
        "textareas": [
            {
                "i": i,
                "lx": t["cx"],
                "ly": _caret_ly(t),
                "w": t["w"],
                "h": t["h"],
                "score": t.get("score"),
                "kind": t.get("kind"),
                "ink": t.get("ink"),
            }
            for i, t in enumerate(usable)
        ],
        "note": "click lx/ly with snap:false aim:false; letter-prove; Backspace; keys; never human:0 / xdotool type",
    }


def scroll_complete(path):
    """HARD gate: sticky Next alone is NOT enough (SE Q2 bug).

    Signature of the bug: MCQ radios sit against the sticky footer with no
    Explanation textarea between them and the footer. Scroll the problem pane
    until a textarea is in-frame (or content stops changing).
    """
    radios = find_radios(path)
    next_btn = find_next(path)
    areas, w, h, edge = find_textareas(path)
    radio_list = radios.get("radios") or []
    cluster = _option_radio_cluster(radio_list, h)
    lowest_radio_y = max((r["ly"] for r in cluster), default=0)
    # Any substantial textarea in mid/lower content counts (ring false-hits
    # can put "radios" below the real Explanation box).
    # Real Explanation boxes: wide, tall enough, START above sticky footer.
    # Short footer-gap strips (h≈40 near y≈0.68h) are false positives on unscrolled looks.
    mid_areas = [
        a
        for a in areas
        if a["w"] >= int((w - edge) * 0.40)
        and a["h"] >= 50
        and int(h * 0.28) <= a["y0"] <= int(h * 0.72)
    ]
    textareas_below = [a for a in mid_areas if a["y0"] >= max(0, lowest_radio_y - 20)]
    # Radios in the lower content half with no real field below = classic below-fold miss
    footer_band = int(h * 0.58)
    radios_against_footer = bool(cluster) and lowest_radio_y >= footer_band

    out = {
        "ok": False,
        "mode": "scroll-complete",
        "look": [w, h],
        "sidebar_edge": edge,
        "footer_next": bool(next_btn.get("ok")),
        "radio_count": len(radio_list),
        "option_cluster": len(cluster),
        "lowest_option_ly": lowest_radio_y or None,
        "textarea_count": len(areas),
        "textareas_below_radios": len(textareas_below),
        "radios_against_footer": radios_against_footer,
        "need_scroll": False,
        "scroll_lx": int(edge + (w - edge) * 0.55),
        "scroll_ly": int(h * 0.55),
        "note": (
            "Sticky Back/Next can show while Explanation is still below the fold. "
            "Scroll the PROBLEM PANE (wheel at scroll_lx/ly) until ok, then save *_bottom.png."
        ),
    }
    if mid_areas:
        out["textareas"] = mid_areas[:6]
    if cluster:
        out["cluster"] = cluster

    # Prefer positive evidence: a real mid-pane textarea means the fold is cleared
    # (option-cluster Y can sit below the field when ring false-hits fire near the footer).
    if mid_areas:
        out["ok"] = True
        out["need_scroll"] = False
        out["why"] = "explanation textarea in frame"
        return out

    # Classic Q2 failure: options jammed against sticky footer, no field in frame
    if radios_against_footer:
        out["need_scroll"] = True
        out["why"] = (
            "MCQ radios sit against sticky footer with no Explanation textarea — "
            "scroll problem pane (SE Q2 class bug). Do NOT press Next yet."
        )
        return out

    if cluster:
        out["need_scroll"] = True
        out["why"] = (
            f"{len(cluster)} option radio(s) visible but no Explanation textarea — "
            "scroll problem pane. Do NOT advance Next yet."
        )
        return out

    # No radios → drag/coding/bio: still require a bottom pass via footer visibility
    out["ok"] = bool(next_btn.get("ok"))
    if out["ok"]:
        out["why"] = (
            "no MCQ radios — footer Next visible; still wheel once + re-look before leaving"
        )
    else:
        out["need_scroll"] = True
        out["why"] = "footer Next missing — scroll or wait for step UI"
    return out


def _parse_textarea_args(argv):
    """textarea [index] [--near needle…] → index, near, prefer_best."""
    index = 0
    near = None
    prefer_best = True
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--near":
            near = " ".join(argv[i + 1 :]).strip() or None
            prefer_best = False
            break
        if re.fullmatch(r"-?\d+", a):
            index = int(a)
            prefer_best = False
            i += 1
            continue
        if not a.startswith("-"):
            near = " ".join(argv[i:]).strip()
            prefer_best = False
            break
        i += 1
    return index, near, prefer_best


def main():
    if len(sys.argv) < 3:
        print(
            "usage: locate-click.py <look.png> "
            "zones|continue|next|back|start|radios|radio|sidebar|role|textarea|"
            "blue-buttons|scroll-complete [title|index] [--near needle]",
            file=sys.stderr,
        )
        sys.exit(2)
    path, mode = sys.argv[1], sys.argv[2].lower()
    if mode == "zones":
        print(json.dumps(zones(path), indent=2))
    elif mode in ("continue", "cta"):
        print(json.dumps(find_continue(path), indent=2))
    elif mode == "next":
        print(json.dumps(find_next(path), indent=2))
    elif mode == "back":
        print(json.dumps(find_back(path), indent=2))
    elif mode == "start":
        print(json.dumps(find_start(path), indent=2))
    elif mode == "radios":
        print(json.dumps(find_radios(path, choices_only=True), indent=2))
    elif mode in ("radios-raw", "radios_raw"):
        print(json.dumps(find_radios(path, choices_only=False), indent=2))
    elif mode == "radio":
        idx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        print(json.dumps(find_radios(path, index=idx, choices_only=True), indent=2))
    elif mode == "sidebar":
        idx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        print(json.dumps(find_sidebar_item(path, index=idx), indent=2))
    elif mode == "role":
        title = " ".join(sys.argv[3:]) or ""
        print(json.dumps(find_role_card(path, title), indent=2))
    elif mode in ("textarea", "textareas", "field"):
        idx, near, prefer_best = _parse_textarea_args(sys.argv[3:])
        print(
            json.dumps(
                find_textarea_click(
                    path, index=idx, near=near, prefer_best=prefer_best
                ),
                indent=2,
            )
        )
    elif mode in ("scroll-complete", "scroll_complete", "scrolled"):
        print(json.dumps(scroll_complete(path), indent=2))
    elif mode in ("blue-buttons", "blue"):
        im, px, (w, h) = load_rgb(path)
        mask = [[is_blue_loose(px[x, y]) for x in range(w)] for y in range(h)]
        comps = connected_components(mask, w, h, min_area=200)
        comps = [c for c in comps if c["w"] >= 48 and 16 <= c["h"] <= 80]
        comps.sort(key=lambda c: c["area"], reverse=True)
        print(json.dumps({"ok": True, "look": [w, h], "buttons": comps[:12]}, indent=2))
    else:
        print("unknown mode", mode, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()

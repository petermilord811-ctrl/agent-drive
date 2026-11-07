#!/usr/bin/env python3
"""Locate light input-field bands in a look PNG. Prints JSON: [{cx,cy,y0,y1,x0,x1}, ...]
@tool find the sign-up form's light input fields in a look picture: each band and its centre, as JSON
@run  python skills/create-dataannotation-account/locate-fields.py look.png [y_min=180] [y_max=560]
"""
from __future__ import annotations

import json
import sys

from PIL import Image

path = sys.argv[1]
y_min = int(sys.argv[2]) if len(sys.argv) > 2 else 180
y_max = int(sys.argv[3]) if len(sys.argv) > 3 else 560
img = Image.open(path).convert("RGB")
w, h = img.size
px = img.load()
cx = w // 2

bands = []
y = max(0, y_min)
while y < min(h, y_max):
    light = 0
    for dx in range(-80, 81, 5):
        x = cx + dx
        if 0 <= x < w:
            r, g, b = px[x, y]
            if r > 235 and g > 235 and b > 235:
                light += 1
    if light > 20:
        y0 = y
        while y < min(h, y_max):
            light = 0
            for dx in range(-80, 81, 5):
                x = cx + dx
                if 0 <= x < w:
                    r, g, b = px[x, y]
                    if r > 235 and g > 235 and b > 235:
                        light += 1
            if light <= 20:
                break
            y += 1
        y1 = y
        if 24 <= (y1 - y0) <= 80:
            # horizontal extent at mid
            mid = (y0 + y1) // 2
            xs = []
            for x in range(w):
                r, g, b = px[x, mid]
                if r > 235 and g > 235 and b > 235:
                    xs.append(x)
            if xs:
                # longest contiguous run
                best = (xs[0], xs[0])
                i = 0
                while i < len(xs):
                    j = i
                    while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1:
                        j += 1
                    if xs[j] - xs[i] > best[1] - best[0]:
                        best = (xs[i], xs[j])
                    i = j + 1
                x0, x1 = best
                if x1 - x0 >= 120:
                    bands.append(
                        {
                            "cx": (x0 + x1) // 2,
                            "cy": mid,
                            "y0": y0,
                            "y1": y1,
                            "x0": x0,
                            "x1": x1,
                        }
                    )
    else:
        y += 1

print(json.dumps(bands))

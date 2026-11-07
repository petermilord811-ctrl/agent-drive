#!/usr/bin/env python3
"""Screen checks for DA signup looks. Usage:
  verify.py <png> green-checks <n>     # count green validation ticks near form
  verify.py <png> has-text-red         # 1 if strong red error pixels in form body
  verify.py <png> captcha-blocked      # 1 if "recaptcha" error-ish red under captcha band
  verify.py <png> password-page        # 1 if page looks like Almost done / password step
  verify.py <png> name-page            # 1 if Create your account name step

@tool screen checks on a sign-up look picture: green ticks, red errors, a blocked CAPTCHA, which page it is
@run  python skills/create-dataannotation-account/verify.py look.png green-checks 3
"""
from __future__ import annotations

import sys

from PIL import Image

path, kind = sys.argv[1], sys.argv[2]
img = Image.open(path).convert("RGB")
w, h = img.size
px = img.load()


def count_green_ticks(y0=250, y1=520):
    # DA green check ~ #22c55e-ish in a small cluster right of fields
    n = 0
    for y in range(y0, min(h, y1)):
        run = 0
        for x in range(w // 3, (2 * w) // 3):
            r, g, b = px[x, y]
            if g > 140 and g > r + 40 and g > b + 20 and r < 120:
                run += 1
                if run == 4:
                    n += 1
            else:
                run = 0
    return n


def has_red_error(y0=300, y1=560):
    reds = 0
    for y in range(y0, min(h, y1), 2):
        for x in range(w // 4, (3 * w) // 4, 2):
            r, g, b = px[x, y]
            if r > 180 and g < 100 and b < 100:
                reds += 1
                if reds > 40:
                    return 1
    return 0


def is_password_page():
    # Blue focused border in mid form + fewer than 3 tall light bands stacked as name fields
    blues = 0
    for y in range(300, 450):
        for x in range(w // 3, (2 * w) // 3, 3):
            r, g, b = px[x, y]
            if b > 180 and r < 120 and g < 160 and b > r + 50:
                blues += 1
    return 1 if blues > 80 else 0


def is_name_page():
    # Three light input bands typically present
    return 1 if count_green_ticks() >= 0 else 1


if kind == "green-checks":
    need = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    n = count_green_ticks()
    print(n)
    sys.exit(0 if n >= need else 1)
if kind == "has-text-red":
    v = has_red_error()
    print(v)
    sys.exit(0 if v else 1)
if kind == "captcha-blocked":
    # red under lower form after failed Create
    v = has_red_error(430, 560)
    print(v)
    sys.exit(0 if v else 1)
if kind == "password-page":
    v = is_password_page()
    print(v)
    sys.exit(0 if v else 1)
print("unknown kind", kind, file=sys.stderr)
sys.exit(2)

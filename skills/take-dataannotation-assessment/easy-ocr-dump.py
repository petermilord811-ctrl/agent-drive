@tool Dump EasyOCR lines from an image for debugging
#!/usr/bin/env python
"""Dump EasyOCR text from a look PNG (paragraph mode). Source capture helper — do not invent."""
from __future__ import annotations

import argparse
import sys

import easyocr
import numpy as np
from PIL import Image


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--crop", nargs=4, type=int, metavar=("L", "T", "R", "B"), default=None)
    ap.add_argument("--scale", type=float, default=2.0, help="upscale before OCR")
    args = ap.parse_args()

    im = Image.open(args.png).convert("RGB")
    if args.crop:
        im = im.crop(tuple(args.crop))
    if args.scale and args.scale != 1.0:
        w, h = im.size
        im = im.resize((int(w * args.scale), int(h * args.scale)), Image.Resampling.LANCZOS)

    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    res = reader.readtext(np.array(im), detail=1, paragraph=True)
    for item in res:
        text = item[1] if len(item) >= 2 else str(item)
        print(text)
        print("---")
    return 0


if __name__ == "__main__":
    sys.exit(main())

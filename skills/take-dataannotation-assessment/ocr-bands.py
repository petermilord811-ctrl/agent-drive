#!/usr/bin/env python
"""Crop a look into horizontal bands and OCR each with vision/local-ocr via upscale-ocr.js."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from PIL import Image


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--left", type=int, default=40)
    ap.add_argument("--right", type=int, default=1240)
    ap.add_argument("--top", type=int, default=150)
    ap.add_argument("--bottom", type=int, default=700)
    ap.add_argument("--band", type=int, default=120)
    ap.add_argument("--overlap", type=int, default=20)
    ap.add_argument("--scale", type=float, default=3.0)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    png = Path(args.png)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".bands")
    tmp.mkdir(exist_ok=True)

    im = Image.open(png).convert("RGB")
    y = args.top
    parts: list[str] = []
    i = 0
    kit = Path(__file__).resolve().parents[2]  # agent-drive
    up = Path(__file__).resolve().parent / "upscale-ocr.js"
    while y < args.bottom:
        y1 = min(args.bottom, y + args.band)
        crop = im.crop((args.left, y, args.right, y1))
        cp = tmp / f"band-{i:02d}.png"
        crop.save(cp)
        up_png = tmp / f"band-{i:02d}-up.png"
        r = subprocess.run(
            [
                "node",
                str(up),
                str(cp),
                "--crop",
                f"0,0,{crop.size[0]},{crop.size[1]}",
                "--scale",
                str(args.scale),
                "--out",
                str(up_png),
            ],
            capture_output=True,
            text=True,
        )
        text = (r.stdout or "").strip()
        if text:
            parts.append(text)
        i += 1
        y = y1 - args.overlap
        if y1 >= args.bottom:
            break

    joined = "\n".join(parts)
    out.write_text(joined + "\n", encoding="utf8")
    print(joined)
    print(f"\n# wrote {out} bands={i}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

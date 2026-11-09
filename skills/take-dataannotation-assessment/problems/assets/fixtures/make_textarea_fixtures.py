#!/usr/bin/env python3
"""Synthetic DA-like looks for textarea locator regression."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent


def _font(size=18):
    for name in ("arial.ttf", "segoeui.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_empty_rubrics(path: Path) -> None:
    """1280x720: sidebar + prompt slab + two empty rubric boxes with placeholders."""
    w, h = 1280, 720
    im = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(im)
    # sidebar
    d.rectangle([0, 0, 340, h], fill=(248, 248, 250))
    d.line([340, 0, 340, h], fill=(210, 210, 215), width=2)
    # prompt slab (should NOT win)
    d.rectangle([380, 80, 1180, 260], fill=(245, 245, 247))
    d.text((400, 100), "You are advising a hospital lab that wants to train a model", fill=(40, 40, 45), font=_font(16))
    d.text((400, 130), "Define a valid training label rule that avoids label leakage", fill=(40, 40, 45), font=_font(16))
    # Q3a
    d.text((380, 300), "Question 3a", fill=(90, 40, 160), font=_font(22))
    # rubric 1 empty #f8 with placeholder
    d.rectangle([380, 360, 1180, 460], fill=(248, 248, 248), outline=(200, 200, 205))
    d.text((400, 375), "Enter your first rubric", fill=(160, 160, 165), font=_font(18))
    # rubric 2
    d.rectangle([380, 500, 1180, 600], fill=(248, 248, 248), outline=(200, 200, 205))
    d.text((400, 515), "Enter your second rubric", fill=(160, 160, 165), font=_font(18))
    # Expires-like chip (must not be picked)
    d.rectangle([980, 660, 1240, 710], fill=(230, 240, 255), outline=(100, 150, 220))
    d.text((1000, 675), "Expires in: 4 days", fill=(40, 80, 140), font=_font(14))
    im.save(path)


def make_goal_with_strip(path: Path) -> None:
    """Short #f8 strip above real tall Goal — tall Goal must win index 0."""
    w, h = 1280, 720
    im = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 340, h], fill=(248, 248, 250))
    d.line([340, 0, 340, h], fill=(210, 210, 215), width=2)
    d.text((380, 120), "Conversation Goal", fill=(30, 30, 35), font=_font(20))
    # short false strip
    d.rectangle([380, 160, 1180, 200], fill=(248, 248, 248))
    # real Goal
    d.rectangle([380, 220, 1180, 480], fill=(248, 248, 248), outline=(200, 200, 205))
    im.save(path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_empty_rubrics(OUT / "empty-rubrics.png")
    make_goal_with_strip(OUT / "goal-tall-vs-strip.png")
    print("wrote", OUT / "empty-rubrics.png")
    print("wrote", OUT / "goal-tall-vs-strip.png")


if __name__ == "__main__":
    main()

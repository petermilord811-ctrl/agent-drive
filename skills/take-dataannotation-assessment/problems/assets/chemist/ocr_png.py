import sys
from pathlib import Path
import pytesseract
from PIL import Image

root = Path(__file__).resolve().parent
names = sys.argv[1:] or ["q1-mechanisms.png", "q2-q3.png", "q4-q5.png", "q6-q7-start.png", "q7-experience.png"]
for name in names:
    p = root / name
    if not p.exists():
        print("MISSING", name)
        continue
    img = Image.open(p)
    text = pytesseract.image_to_string(img)
    out = p.with_suffix(".ocr.txt")
    out.write_text(text, encoding="utf-8")
    print("===", name, "size", img.size, "chars", len(text), "->", out.name)
    print(text[:3000])
    print()

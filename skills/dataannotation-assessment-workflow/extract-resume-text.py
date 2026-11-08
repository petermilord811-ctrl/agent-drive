#!/usr/bin/env python3
"""Extract plain text from resume PDF/DOCX/TXT for pick-assessment scoring."""
from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: extract-resume-text.py <resume.pdf|docx|txt>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print("not found: " + str(path), file=sys.stderr)
        return 2
    ext = path.suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader

        r = PdfReader(str(path))
        sys.stdout.write("\n".join((p.extract_text() or "") for p in r.pages))
        return 0
    if ext == ".docx":
        import docx

        d = docx.Document(str(path))
        sys.stdout.write("\n".join(p.text for p in d.paragraphs))
        return 0
    sys.stdout.write(path.read_text(encoding="utf-8", errors="replace"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

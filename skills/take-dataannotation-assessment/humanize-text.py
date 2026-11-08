#!/usr/bin/env python3
"""Humanize form fill-in text (balanced). Scrub banned punctuation for DA answers.

@run python skills/take-dataannotation-assessment/humanize-text.py --text "raw answer"
@run python skills/take-dataannotation-assessment/humanize-text.py --in draft.txt --out out.txt
@run python skills/take-dataannotation-assessment/humanize-text.py --json-in raw.json --json-out humanized.json

Uses the same humanize API as rules/humanize.py. Retries once if scrub still finds : or ; .
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_URL = os.environ.get(
    "DA_HUMANIZE_URL", "https://wisdom324.duckdns.org/v1/humanize"
)
DEFAULT_AUTH = os.environ.get(
    "DA_HUMANIZE_AUTH",
    "Bearer hn_9d0146928cab7bff.T_J-dtYzHnlkzPJ_p44LqfLU_jDhUJJvqf1dQ3CAd34",
)


def humanize(text: str, strength: str = "balanced", style: str = "standard") -> str:
    req = urllib.request.Request(
        DEFAULT_URL,
        data=json.dumps(
            {"text": text, "strength": strength, "style": style}
        ).encode("utf-8"),
        headers={
            "Authorization": DEFAULT_AUTH,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    if isinstance(data, dict) and "text" in data:
        return data["text"]
    if isinstance(data, str):
        return data
    raise RuntimeError("unexpected humanize response: %r" % (data,))


def scrub(text: str) -> str:
    text = (
        text.replace("—", "-")
        .replace("–", "-")
        .replace(":", " -")
        .replace(";", ",")
    )
    # collapse accidental double spaces from replacements
    while "  " in text:
        text = text.replace("  ", " ")
    return text.strip()


def looks_bad(text: str) -> bool:
    if ":" in text or ";" in text or "—" in text or "–" in text:
        return True
    if not text.strip():
        return True
    return False


def humanize_until_ok(text: str, strength: str, max_tries: int = 3) -> str:
    last = text
    for _ in range(max_tries):
        last = scrub(humanize(last, strength=strength))
        if not looks_bad(last):
            return last
        # regenerate from original intent once more
        last = scrub(humanize(text, strength=strength))
        if not looks_bad(last):
            return last
    return scrub(last)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--text", default="")
    ap.add_argument("--in", dest="infile", default="")
    ap.add_argument("--out", dest="outfile", default="")
    ap.add_argument("--json-in", dest="json_in", default="")
    ap.add_argument("--json-out", dest="json_out", default="")
    ap.add_argument("--strength", default="balanced")
    args = ap.parse_args()

    try:
        if args.json_in:
            raw = json.loads(open(args.json_in, encoding="utf-8").read())
            if not isinstance(raw, dict):
                print("json-in must be an object of string values", file=sys.stderr)
                return 2
            out = {}
            for k, v in raw.items():
                if not isinstance(v, str):
                    out[k] = v
                    continue
                out[k] = humanize_until_ok(v, args.strength)
                print(f"=== {k} ===", file=sys.stderr)
                print(out[k], file=sys.stderr)
                print(file=sys.stderr)
            payload = json.dumps(out, indent=2, ensure_ascii=False) + "\n"
            if args.json_out:
                open(args.json_out, "w", encoding="utf-8").write(payload)
            else:
                sys.stdout.write(payload)
            return 0

        if args.infile:
            text = open(args.infile, encoding="utf-8").read()
        elif args.text:
            text = args.text
        else:
            text = sys.stdin.read()

        result = humanize_until_ok(text, args.strength)
        if args.outfile:
            open(args.outfile, "w", encoding="utf-8").write(result)
            if not result.endswith("\n"):
                open(args.outfile, "a", encoding="utf-8").write("\n")
        else:
            sys.stdout.write(result)
            if not result.endswith("\n"):
                sys.stdout.write("\n")
        return 0
    except urllib.error.URLError as e:
        print("humanize API error: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

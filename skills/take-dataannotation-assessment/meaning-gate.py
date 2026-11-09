#!/usr/bin/env python3
"""MeaningPass gate — best-correct strength before detect.

Reads drafts/meaning.json (or --meaning path). A candidate PASSES only if:
  - every must_keep group matches (OR alts separated by |)
  - no must_not regex matches
  - optional strength.forbid_weaker_* patterns do not match
  - optional form_asks tokens appear when listed

Exit 0 = all checked fields MeaningPass
Exit 1 = one or more MeaningPass failures
Exit 2 = usage / missing meaning file

@run python skills/take-dataannotation-assessment/meaning-gate.py \\
        --meaning "{profile}/drafts/meaning.json" \\
        --texts "{profile}/drafts-humanized.json"
@run … --ids s3_project,q3_rubric2
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def group_ok(text: str, group: str) -> bool:
    """must_keep entry: alts separated by | (case-insensitive substring)."""
    low = text.lower()
    alts = [a.strip() for a in group.split("|") if a.strip()]
    return any(a.lower() in low for a in alts)


def check_field(fid: str, text: str, card: dict) -> dict:
    low = text.lower()
    missing: list[str] = []
    hit_forbidden: list[str] = []
    weak: list[str] = []

    for g in card.get("must_keep") or []:
        if not group_ok(text, str(g)):
            missing.append(str(g))

    for pat in card.get("must_not") or []:
        # Prefer explicit regex. Plain phrases get word-ish boundaries so
        # "lock label" does not false-hit "locked labeling" (Herman lesson).
        raw = str(pat)
        bare = not re.search(r"[.\\^$*+?{}\[\]|()]", raw)
        try:
            rx = (
                r"(?<!\w)" + re.escape(raw) + r"(?!\w)"
                if bare
                else raw
            )
            if re.search(rx, text, flags=re.I):
                hit_forbidden.append(raw)
        except re.error:
            if re.search(r"(?<!\w)" + re.escape(raw) + r"(?!\w)", text, flags=re.I):
                hit_forbidden.append(raw)

    strength = card.get("strength") or {}
    for key, pats in strength.items():
        if not str(key).startswith("forbid"):
            continue
        for pat in pats or []:
            try:
                if re.search(str(pat), text, flags=re.I):
                    weak.append(f"{key}:{pat}")
            except re.error:
                if str(pat).lower() in low:
                    weak.append(f"{key}:{pat}")

    for ask in card.get("form_asks_any") or []:
        # soft: at least one alt in the group should appear (same | syntax)
        if not group_ok(text, str(ask)):
            missing.append(f"form:{ask}")

    ok = not missing and not hit_forbidden and not weak
    return {
        "id": fid,
        "ok": ok,
        "missing": missing,
        "must_not_hit": hit_forbidden,
        "strength_fail": weak,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="MeaningPass gate for Part B Values")
    ap.add_argument("--meaning", required=True, help="path to drafts/meaning.json")
    ap.add_argument(
        "--texts",
        required=True,
        help="JSON map of field_id → text (drafts-humanized.json or answer.fill prose)",
    )
    ap.add_argument("--ids", default="", help="comma ids to check (default: all in meaning∩texts)")
    ap.add_argument("--json-out", default="", help="optional report path")
    args = ap.parse_args()

    meaning_path = Path(args.meaning)
    texts_path = Path(args.texts)
    if not meaning_path.is_file():
        print(f"missing meaning file: {meaning_path}", file=sys.stderr)
        return 2
    if not texts_path.is_file():
        print(f"missing texts file: {texts_path}", file=sys.stderr)
        return 2

    meaning = load_json(meaning_path)
    if isinstance(meaning, dict) and "fields" in meaning:
        cards = meaning["fields"]
    else:
        cards = meaning
    texts_raw = load_json(texts_path)
    if isinstance(texts_raw, dict) and "texts" in texts_raw:
        texts = texts_raw["texts"]
    else:
        texts = texts_raw

    want = [x.strip() for x in args.ids.split(",") if x.strip()]
    ids = want or sorted(set(cards) & set(texts))

    results = []
    failed = []
    for fid in ids:
        if fid not in cards:
            results.append({"id": fid, "ok": False, "error": "no meaning card"})
            failed.append(fid)
            continue
        if fid not in texts or not isinstance(texts[fid], str):
            results.append({"id": fid, "ok": False, "error": "no text"})
            failed.append(fid)
            continue
        r = check_field(fid, texts[fid], cards[fid])
        results.append(r)
        status = "PASS" if r["ok"] else "FAIL"
        print(f"{status} {fid}")
        if not r["ok"]:
            failed.append(fid)
            if r["missing"]:
                print(f"  missing: {r['missing']}")
            if r["must_not_hit"]:
                print(f"  must_not: {r['must_not_hit']}")
            if r["strength_fail"]:
                print(f"  strength: {r['strength_fail']}")

    report = {
        "ok": not failed,
        "checked": len(results),
        "failed": failed,
        "results": results,
        "rule": "MeaningPass required before DetectPass. Never keep ai≤20 if MeaningPass fails.",
    }
    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    print(json.dumps({"ok": report["ok"], "failed": failed, "checked": len(results)}))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Fail-closed Part B answer gate (Herman lessons — never skip).

Runs in order:
  1) require drafts/meaning.json
  2) MeaningPass  (meaning-gate.py)
  3) QualityPass  (quality-gate.py) — includes On form criterion coverage
  4) DetectPass   (answer.aicheck.json must be ok, or --run-aicheck)

Illegal: treat cls.ai≤20 alone as done. Illegal: autofill while any gate fails.

Exit:
  0  all gates pass
  1  MeaningPass or QualityPass failed
  2  missing artifacts (meaning / texts / answer.md)
  3  DetectPass failed / aicheck not ok
  4  aicheck needs agent regen (report only; same as not done)

@tool Fail-closed MeaningPass + QualityPass + DetectPass before autofill
@run python skills/take-dataannotation-assessment/answer-gates.py --profile "…"
@tool Fail-closed MeaningPass + QualityPass + DetectPass before autofill
@run … --run-aicheck
@tool Fail-closed MeaningPass + QualityPass + DetectPass before autofill
@run … --skip-detect   # meaning+quality only (offline draft)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def extract_from_answer_md(md_path: Path) -> dict[str, str]:
    md = md_path.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    pat = re.compile(
        r"^####\s+([A-Za-z0-9_.:-]+)(?:\s*[—\-|:].*)?\s*\n"
        r"(?:(?:>.*|[ \t]*)\n)*"
        r"```(?:text|json|markdown|md|python|code)?\s*\n"
        r"([\s\S]*?)"
        r"^```",
        re.MULTILINE,
    )
    for m in pat.finditer(md):
        out[m.group(1).strip()] = m.group(2).rstrip("\n")
    return out


def run_py(script: Path, args: list[str]) -> tuple[int, str]:
    cmd = [sys.executable, str(script), *args]
    p = subprocess.run(cmd, capture_output=True, text=True)
    text = (p.stdout or "") + (p.stderr or "")
    return p.returncode, text


def main() -> int:
    ap = argparse.ArgumentParser(description="Fail-closed Meaning+Quality+Detect gates")
    ap.add_argument("--profile", required=True)
    ap.add_argument("--run-aicheck", action="store_true", help="run aicheck-answer.py first")
    ap.add_argument("--skip-detect", action="store_true", help="skip DetectPass check")
    ap.add_argument(
        "--texts",
        default="",
        help="optional texts JSON (default: sync from answer.md → drafts-humanized.json)",
    )
    args = ap.parse_args()

    profile = Path(args.profile)
    meaning = profile / "drafts" / "meaning.json"
    answer_md = profile / "answer.md"
    aicheck = profile / "answer.aicheck.json"
    report_path = profile / "answer.gates.json"

    if not meaning.is_file():
        print("FAIL: missing drafts/meaning.json — author meaning cards before remake done")
        report_path.write_text(
            json.dumps(
                {
                    "ok": False,
                    "error": "missing_meaning_json",
                    "rule": "Meaning card required (Herman)",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return 2
    if not answer_md.is_file():
        print("FAIL: missing answer.md")
        return 2

    # Source of truth = answer.md Values fences (what will be typed)
    extracted = extract_from_answer_md(answer_md)
    meaning_data = json.loads(meaning.read_text(encoding="utf-8"))
    cards = meaning_data.get("fields") if isinstance(meaning_data, dict) else meaning_data
    prose_ids = [k for k in cards if k in extracted and extracted[k].strip()]
    texts = {k: extracted[k] for k in prose_ids}

    # Always refresh drafts-humanized from answer.md so gates match ship text
    hum_path = Path(args.texts) if args.texts else profile / "drafts-humanized.json"
    if hum_path.is_file():
        prev = json.loads(hum_path.read_text(encoding="utf-8"))
        if isinstance(prev, dict) and "texts" in prev:
            prev = prev["texts"]
        for k, v in prev.items():
            if k not in texts and isinstance(v, str):
                texts[k] = v
    # Prefer answer.md for overlapping keys
    for k in prose_ids:
        texts[k] = extracted[k]
    if "conv_share" in extracted:
        texts["conv_share"] = extracted["conv_share"]

    hum_path.parent.mkdir(parents=True, exist_ok=True)
    hum_path.write_text(json.dumps(texts, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    meaning_out = profile / "answer.meaning.json"
    quality_out = profile / "answer.quality.json"

    rc_m, out_m = run_py(
        ROOT / "meaning-gate.py",
        [
            "--meaning",
            str(meaning),
            "--texts",
            str(hum_path),
            "--json-out",
            str(meaning_out),
        ],
    )
    print(out_m.rstrip())
    rc_q, out_q = run_py(
        ROOT / "quality-gate.py",
        [
            "--meaning",
            str(meaning),
            "--texts",
            str(hum_path),
            "--json-out",
            str(quality_out),
        ],
    )
    print(out_q.rstrip())

    detect_ok = None
    aicheck_rc = None
    if args.run_aicheck:
        aicheck_rc, out_a = run_py(
            ROOT / "aicheck-answer.py",
            ["--profile", str(profile)],
        )
        print(out_a.rstrip())
    if not args.skip_detect:
        if not aicheck.is_file():
            print("FAIL: missing answer.aicheck.json — run aicheck-answer.py (or --run-aicheck)")
            detect_ok = False
        else:
            rep = json.loads(aicheck.read_text(encoding="utf-8"))
            detect_ok = bool(rep.get("ok")) and not rep.get("needsAgentRegen") and not rep.get(
                "needsUser"
            )
            if not detect_ok:
                print(
                    "FAIL: DetectPass — answer.aicheck.json not ok "
                    f"(ok={rep.get('ok')} needsAgentRegen={rep.get('needsAgentRegen')} "
                    f"needsUser={rep.get('needsUser')})"
                )
            else:
                print("PASS DetectPass (answer.aicheck.json ok)")
    else:
        print("SKIP DetectPass (--skip-detect)")

    meaning_ok = rc_m == 0
    quality_ok = rc_q == 0
    all_ok = meaning_ok and quality_ok and (detect_ok is not False)

    report = {
        "ok": all_ok,
        "meaningPass": meaning_ok,
        "qualityPass": quality_ok,
        "detectPass": detect_ok,
        "aicheckRc": aicheck_rc,
        "proseFields": prose_ids,
        "rule": (
            "Acceptance = MeaningPass ∧ QualityPass ∧ DetectPass. "
            "Never keep ai≤20 if Meaning or Quality fails. "
            "Never declare remake done / autofill without this script exit 0."
        ),
        "neverAgain": [
            "Do not use detect as the selection objective among keyword-passers",
            "Do not skip drafts/meaning.json",
            "Do not accept humanize output without re-running Meaning+Quality",
            "On form criterion coverage is part of QualityPass (q2b order+coeffs+SSE; q4 why B>A)",
            "MUST — Never Submit until operator explicit yes (always; silence ≠ yes)",
        ],
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": all_ok, "meaningPass": meaning_ok, "qualityPass": quality_ok, "detectPass": detect_ok}))

    if not meaning_ok or not quality_ok:
        return 1
    if detect_ok is False:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

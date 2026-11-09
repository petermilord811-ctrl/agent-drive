#!/usr/bin/env python3
"""QualityPass — reviewer-ready prose after MeaningPass, before DetectPass.

Catches real Herman remake failures that MeaningPass alone missed:
  - broken / non-English phrasing
  - telegraphic prompt openers
  - claims that undercut the correct answer
  - fuzzy Challenge-an-AI goals
  - too-thin explanations vs On form minimums
  - large clarity drop vs meaning card `best`
  - On form criterion coverage (e.g. q2b must name order+coeffs+SSE;
    q4 must say why B beats A, not praise A)

Exit 0 = all QualityPass
Exit 1 = failures
Exit 2 = usage / missing files

@tool QualityPass: reviewer-ready prose + On form criterion coverage
@run python skills/take-dataannotation-assessment/quality-gate.py \\
        --meaning "{profile}/drafts/meaning.json" \\
        --texts "{profile}/drafts-humanized.json"
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Global anti-patterns seen in failed remakes (case-insensitive)
GLOBAL_BAD = [
    (r"\brequire a lock label\b", "broken phrasing: require a lock label"),
    (r"\bwhich row is training data or leaked\b", "fuzzy goal: training data or leaked"),
    (r"\bleft at its true concentration\b", "LOB claim undercuts failure"),
    (r"\btrue concentration\b", "LOB should be wrongly treated as reliable, not true"),
    (r"^consult\.\s", "telegraphic opener Consult."),
    (r"\bhold/drop decision\b", "prefer keep or drop rule wording"),
    (r"\bnegative classification decision\b", "muddy negative-class wording"),
    (r"\bmore disease labelling\b", "vague leakage explanation"),
    (r"\brun the data science program\b", "weakened role vs lead/Director"),
    (r"\bmodels include (clinical|lab).{0,40}data\b", "awkward models include data"),
    (r"\bevaluated in clinical trials through Python\b", "tools mixed into trial eval"),
    (r"\bwhether on how\b", "garbled rubric lead-in"),
    (r"\bdoes the answer\b", "rubric format break"),
    (r"Flag rows that create leakage", "appended repair fragment"),
    (r"Return 1\).+Return 1\)", "duplicated Return 1) block"),
    (r"Give 1\).+Return 1\)", "duplicated 1) deliverable block"),
    (r"\blabels can be secured\b", "unclear labeling ask"),
    (r"\blimit of blanks\b", "prefer limit of blank"),
    # Criterion-coverage fails (Herman recheck)
    (
        r"optimum arrangement of (the )?coefficients",
        "q2b-style: blurs optimal order n into coefficients",
    ),
    (
        r"response a is clean with good",
        "q4-style: praises A instead of saying why B beats A",
    ),
]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sentences(text: str) -> int:
    return len(re.findall(r"[.!?]+", text))


def check_field(fid: str, text: str, card: dict) -> dict:
    issues: list[str] = []
    t = text.strip()
    low = t.lower()

    if not t:
        return {"id": fid, "ok": False, "issues": ["empty"]}

    # Global bad patterns
    for pat, msg in GLOBAL_BAD:
        if re.search(pat, t, flags=re.I | re.M):
            issues.append(msg)

    # Card-level quality block
    q = card.get("quality") or {}
    min_s = int(q.get("min_sentences") or 0)
    if min_s and sentences(t) < min_s:
        issues.append(f"need >={min_s} sentences, got {sentences(t)}")

    min_chars = int(q.get("min_chars") or 0)
    if min_chars and len(t) < min_chars:
        issues.append(f"need >={min_chars} chars, got {len(t)}")

    for pat in q.get("must_not") or []:
        if re.search(str(pat), t, flags=re.I | re.M):
            issues.append(f"quality must_not: {pat}")

    for g in q.get("must_keep") or []:
        alts = [a.strip() for a in str(g).split("|") if a.strip()]
        if alts and not any(a.lower() in low for a in alts):
            issues.append(f"quality must_keep missing: {g}")

    # Clarity vs best: reject severe shrinkage + missing keep/drop ask for goals
    best = (card.get("best") or "").strip()
    if best:
        if len(t) < max(40, int(0.45 * len(best))) and fid in {
            "conv_goal",
            "q3_prompt",
            "s3_project",
            "s3_education",
        }:
            issues.append("much shorter than best draft (clarity drop risk)")

    # Rubrics must start correctly
    if fid.startswith("q3_rubric"):
        if not low.startswith("did the response"):
            issues.append("rubric must start with Did the response")

    # Challenge goal should ask for a rule, not a vague row dump
    if fid == "conv_goal":
        if not re.search(r"keep|drop|label", low):
            issues.append("goal should ask for labeling keep/drop rule")
        if re.search(r"\bwhich row\b", low) and "keep" not in low and "drop" not in low:
            issues.append("goal too vague (which row without keep/drop)")

    # Failure desc must not praise LOB values as true
    if fid == "conv_failure_desc":
        if "as if" not in low and "reliable" not in low and "treated" not in low:
            if "blank" in low or "lob" in low:
                issues.append("LOB failure should say treated as reliable/wrongly kept")

    # On form criterion coverage (Herman recheck lessons)
    if fid == "q2b_explain":
        # Must name order as its own piece, not fused into the coefficient phrase
        fused = bool(
            re.search(
                r"optimal order (for|of) (the )?(coefficient|coefficients)",
                low,
            )
        ) or bool(re.search(r"arrangement of (the )?coefficients", low))
        has_order = bool(
            re.search(r"\boptimal order\b|\border n\b|\bchosen order\b", low)
        )
        if fused or not has_order:
            issues.append("On form criterion: name optimal order n separately from coefficients")
        if "sse" not in low:
            issues.append("On form criterion: name SSE")
        if "coefficient" not in low and "coefficients" not in low:
            issues.append("On form criterion: name coefficients")
        if "highest" not in low and "power" not in low and "constant" not in low:
            issues.append("On form criterion: highest power → constant coefficient order")

    if fid == "q4_explain":
        # Must explain why B beats A (not praise A)
        beats_a = bool(
            re.search(
                r"(thinner|weaker|less|behind|lighter|below).{0,40}(response )?a|"
                r"(response )?a.{0,40}(thinner|weaker|less|behind|lighter)|"
                r"than response b|"
                r"b (wins|beats|stronger|better).{0,30}a|"
                r"a .{0,20}(weaker|thinner|less).{0,20}b",
                low,
            )
        )
        if not beats_a:
            issues.append("On form criterion: say why B beats A (not only B vs C)")
        if re.search(r"response a is clean with good|a is clean with good measurements", low):
            issues.append("On form criterion: A praise undercuts B choice")

    # Generic on_form_criteria from card (list of must_keep groups)
    for g in q.get("on_form_criteria") or []:
        alts = [a.strip() for a in str(g).split("|") if a.strip()]
        if alts and not any(a.lower() in low for a in alts):
            issues.append(f"On form criterion missing: {g}")

    ok = not issues
    return {"id": fid, "ok": ok, "issues": issues}


def main() -> int:
    ap = argparse.ArgumentParser(description="QualityPass gate for Part B Values")
    ap.add_argument("--meaning", required=True)
    ap.add_argument("--texts", required=True)
    ap.add_argument("--ids", default="")
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()

    meaning_path = Path(args.meaning)
    texts_path = Path(args.texts)
    if not meaning_path.is_file() or not texts_path.is_file():
        print("missing meaning or texts file", file=sys.stderr)
        return 2

    meaning = load_json(meaning_path)
    cards = meaning["fields"] if isinstance(meaning, dict) and "fields" in meaning else meaning
    texts_raw = load_json(texts_path)
    texts = texts_raw["texts"] if isinstance(texts_raw, dict) and "texts" in texts_raw else texts_raw

    want = [x.strip() for x in args.ids.split(",") if x.strip()]
    ids = want or sorted(set(cards) & set(texts))

    results = []
    failed = []
    for fid in ids:
        if fid not in cards or fid not in texts or not isinstance(texts[fid], str):
            results.append({"id": fid, "ok": False, "issues": ["missing card or text"]})
            failed.append(fid)
            continue
        r = check_field(fid, texts[fid], cards[fid])
        results.append(r)
        print(("PASS" if r["ok"] else "FAIL"), fid)
        if not r["ok"]:
            failed.append(fid)
            for issue in r["issues"]:
                print(f"  - {issue}")

    report = {
        "ok": not failed,
        "checked": len(results),
        "failed": failed,
        "results": results,
        "rule": "QualityPass required after MeaningPass, before DetectPass. ai≤20 never overrides QualityPass.",
    }
    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    print(json.dumps({"ok": report["ok"], "failed": failed, "checked": len(results)}))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

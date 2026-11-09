#!/usr/bin/env python3
"""AI-check Part B textarea Values after answer.md is generated.

Relay only (not MCP): POST /api/detect (+ /api/humanize only as last resort).
Auth: x-sm-join-key = SM_JOIN_KEY

Scope: textarea / text / code Values — skip type:claude and non-prose controls.

HARD: DetectPass only. Full remake done-check is answer-gates.py (Meaning∧Quality∧Detect).
See ANSWER-GATES.md.

  0. Do not treat this script alone as remake-done — run answer-gates.py.
  1. **Best correct** + MeaningPass + QualityPass before/after voice (card.best).
     Never keep a weaker Value because detect passed.
  2. Voice via spoken variant of best, or **one** humanize (agent-only ≈ 100% AI).
  3. If cls.ai > 20 on a MQ-pass text → restore from card → humanize once → MQ → detect ≤3.
  4. Still failing → ask the operator (exit 3).

Exit codes
  0  all checked fields ok (cls.ai≤20 or URL-lock / skip_short)
  3  needs operator
  4  needs agent fit-fix + humanize (see report.regen[])
  5  reserved / verify after paired humanize

@tool DetectPass for Part B textareas (cls.ai<=20) after Meaning/Quality
@run python skills/take-dataannotation-assessment/aicheck-answer.py --profile "…"
@tool DetectPass for Part B textareas (cls.ai<=20) after Meaning/Quality
@run … --dry-run
@tool DetectPass for Part B textareas (cls.ai<=20) after Meaning/Quality
@run … --ids q3_rubric1,s3_education
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]  # agent-drive/
ENV_FILE = ROOT / ".env"

CHECK_TYPES = {"textarea", "text", "code"}
SKIP_TYPES = {"claude", "note", "radio", "checkbox", "agree", "upload", "skip", "drag"}


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def refuse_legacy_bearer() -> None:
    if (os.environ.get("HUMANIZE_API_KEY") or "").strip() or (
        os.environ.get("DA_HUMANIZE_AUTH") or ""
    ).strip():
        raise RuntimeError(
            "Refuse HUMANIZE_API_KEY / DA_HUMANIZE_AUTH. Use SM_JOIN_KEY → relay."
        )


def relay_http_base() -> str:
    relay = (os.environ.get("SM_RELAY_URL") or os.environ.get("SM_RELAY") or "").strip()
    if not relay:
        raise RuntimeError("SM_RELAY / SM_RELAY_URL missing (agent-drive/.env)")
    if relay.startswith("wss://"):
        relay = "https://" + relay[6:]
    elif relay.startswith("ws://"):
        relay = "http://" + relay[5:]
    return relay.rstrip("/")


def join_key() -> str:
    key = (os.environ.get("SM_JOIN_KEY") or "").strip()
    if not key:
        raise RuntimeError("SM_JOIN_KEY missing — set agent-drive/.env")
    return key


def relay_api(path: str, body: dict | None = None, timeout: int = 120) -> dict:
    url = relay_http_base() + path
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"x-sm-join-key": join_key()}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url, data=data, headers=headers, method="GET" if data is None else "POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        out = json.load(resp)
    if not isinstance(out, dict):
        raise RuntimeError("unexpected relay response: %r" % (out,))
    if out.get("ok") is False:
        raise RuntimeError(out.get("why") or out.get("error") or repr(out))
    return out


_URL_TOKEN = "\0URLCOLON\0"


def scrub(text: str) -> str:
    """DA style scrub — never break URL schemes (https:// …)."""
    # Protect scheme colons before the global ":" → " -" rewrite.
    text = re.sub(r"(?i)\b([a-z][a-z0-9+.-]*)://", rf"\1{_URL_TOKEN}//", text)
    text = (
        text.replace("—", "-")
        .replace("–", "-")
        .replace(":", " -")
        .replace(";", ",")
    )
    text = text.replace(_URL_TOKEN, ":")
    while "  " in text:
        text = text.replace("  ", " ")
    return text.strip()


def is_url_only(text: str) -> bool:
    """Single-token http(s) URL — never humanize/scrub-rewrite (share links)."""
    return bool(re.match(r"(?i)^https?://\S+$", text.strip()))


def looks_bad(text: str) -> bool:
    if not text.strip():
        return True
    # Ignore scheme colons inside URLs when judging banned punctuation.
    probe = re.sub(r"(?i)\b[a-z][a-z0-9+.-]*://", "", text)
    if ":" in probe or ";" in probe or "—" in probe or "–" in probe:
        return True
    return False


def ai_percent(detect: dict) -> float:
    cls = detect.get("cls") if isinstance(detect.get("cls"), dict) else {}
    if "ai" in cls and cls["ai"] is not None:
        try:
            return float(cls["ai"])
        except (TypeError, ValueError):
            pass
    try:
        return float(detect.get("ai") or 0)
    except (TypeError, ValueError):
        return 0.0


def detect_text(text: str) -> dict:
    return relay_api("/api/detect", {"text": text}, timeout=120)


def humanize_text(
    text: str, mode: str = "balanced", style: str = "standard", ultra: bool = False
) -> str:
    mode = mode if mode in ("balanced", "quality", "bypass") else "balanced"
    data = relay_api(
        "/api/humanize",
        {
            "text": text,
            "mode": mode,
            "style": style or "standard",
            "ultra": bool(ultra),
        },
        timeout=180,
    )
    out = data.get("text")
    if isinstance(out, str) and out.strip():
        return out
    raise RuntimeError("unexpected humanize response: %r" % (data,))


def normalize_flags(flags: Any, n: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    if not isinstance(flags, list):
        return out
    for span in flags:
        if not isinstance(span, (list, tuple)) or len(span) < 2:
            continue
        try:
            a, b = int(span[0]), int(span[1])
        except (TypeError, ValueError):
            continue
        a = max(0, min(a, n))
        b = max(0, min(b, n))
        if b > a:
            out.append((a, b))
    out.sort()
    return out


def merge_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not spans:
        return []
    merged = [spans[0]]
    for a, b in spans[1:]:
        la, lb = merged[-1]
        if a <= lb + 1:
            merged[-1] = (la, max(lb, b))
        else:
            merged.append((a, b))
    return merged


def rewrite_using_flags(
    text: str,
    detect: dict,
    *,
    mode: str,
    style: str,
    ultra: bool,
) -> str:
    """Rewrite with detect flags as the surgical guide.

    Priority (caller / agent): meaning for the question first. This helper only
    rewrites AI-flagged char spans when possible; unmarked text stays as-is so
    correct facts outside flags are not churned. If no usable flags, humanize
    the whole field once.
    """
    n = len(text)
    spans = merge_spans(normalize_flags(detect.get("flags"), n))
    if not spans or (len(spans) == 1 and spans[0] == (0, n)):
        return scrub(humanize_text(text, mode=mode, style=style, ultra=ultra))

    parts: list[str] = []
    cursor = 0
    for a, b in spans:
        if a > cursor:
            parts.append(text[cursor:a])
        chunk = text[a:b]
        if len(chunk.strip()) < 20:
            # detect minChars ~20 — leave tiny flagged crumbs alone
            parts.append(chunk)
        else:
            try:
                rewritten = scrub(
                    humanize_text(chunk, mode=mode, style=style, ultra=ultra)
                )
                parts.append(rewritten if rewritten else chunk)
            except Exception:
                parts.append(chunk)
        cursor = b
    if cursor < n:
        parts.append(text[cursor:])
    joined = "".join(parts)
    return scrub(joined) if not looks_bad(joined) else scrub(
        humanize_text(text, mode=mode, style=style, ultra=ultra)
    )


def replace_value_fence(md: str, field_id: str, new_text: str) -> tuple[str, bool]:
    """Replace #### {id} … ``` … ``` Values fence payload."""
    fence_body = new_text if new_text.endswith("\n") else new_text + "\n"
    pat = re.compile(
        rf"(####\s+{re.escape(field_id)}(?:\s*[—\-|:].*)?\s*\n"
        rf"(?:(?:>.*|[ \t]*)\n)*"
        rf"```(?:text|json|markdown|md|python|code)?\s*\n)"
        rf"([\s\S]*?)"
        rf"(```)",
        re.MULTILINE,
    )

    def repl(m: re.Match[str]) -> str:
        return m.group(1) + fence_body + m.group(3)

    md2, n = pat.subn(repl, md, count=1)
    return md2, n == 1


def source_collapsed_block(field_id: str, source_text: str) -> str:
    """Default-collapsed first humanized answer (only used after 5 failed checks)."""
    body = source_text if source_text.endswith("\n") else source_text + "\n"
    return (
        f"<!-- aicheck-source:{field_id} -->\n"
        f"<details>\n"
        f"<summary>Source answer (first humanized — aicheck failed after 5 checks)</summary>\n"
        f"\n"
        f"```text\n"
        f"{body}"
        f"```\n"
        f"\n"
        f"</details>\n"
        f"\n"
    )


def upsert_source_collapsed(md: str, field_id: str, source_text: str) -> tuple[str, bool]:
    """Insert or replace a collapsed source block immediately above #### {id}.

    Only for aicheck fail-after-5. Pass cases never call this — first answer stays
    the sole Values fence with no source block.
    Parser ignores HTML details; fill still reads the #### fence below.
    """
    block = source_collapsed_block(field_id, source_text)
    # Drop any prior source block for this id (comment…</details>)
    prior = re.compile(
        rf"<!--\s*aicheck-source:{re.escape(field_id)}\s*-->\s*"
        rf"<details>[\s\S]*?</details>\s*",
        re.IGNORECASE,
    )
    md = prior.sub("", md)

    heading = re.compile(
        rf"(^####\s+{re.escape(field_id)}(?:\s*[—\-|:].*)?\s*$)",
        re.MULTILINE,
    )
    m = heading.search(md)
    if not m:
        return md, False
    md2 = md[: m.start()] + block + md[m.start() :]
    return md2, True


def remove_source_collapsed(md: str, field_id: str) -> str:
    """Strip source block if a later pass succeeds (keep answer.md clean)."""
    prior = re.compile(
        rf"<!--\s*aicheck-source:{re.escape(field_id)}\s*-->\s*"
        rf"<details>[\s\S]*?</details>\s*",
        re.IGNORECASE,
    )
    return prior.sub("", md)


def format_cls_pct(cls: dict | None, key: str) -> str:
    cls = cls if isinstance(cls, dict) else {}
    v = cls.get(key)
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "—"
    if abs(n - round(n)) < 0.05:
        return f"{int(round(n))}%"
    return f"{n:.1f}%"


def format_cls_tip(cls: dict | None, *, verdict: str | None = None) -> str:
    """Log/summary one-liner (not the answer.md block)."""
    return (
        f"AI detect  human {format_cls_pct(cls, 'human')} · "
        f"mixed {format_cls_pct(cls, 'mixed')} · "
        f"ai {format_cls_pct(cls, 'ai')}"
        + (f" · {verdict}" if verdict else "")
    )


def score_block(field_id: str, cls: dict | None, *, verdict: str | None = None) -> str:
    """Professional score card *after* the Values fence (separated from On form)."""
    h = format_cls_pct(cls, "human")
    m = format_cls_pct(cls, "mixed")
    a = format_cls_pct(cls, "ai")
    v = (verdict or "—").strip() or "—"
    return (
        f"<!-- aicheck-score:{field_id} -->\n"
        f"\n"
        f"*AI detect (ScreenMirror / GPTZero)*\n"
        f"\n"
        f"| human | mixed | ai | verdict |\n"
        f"| ---: | ---: | ---: | :--- |\n"
        f"| **{h}** | **{m}** | **{a}** | {v} |\n"
        f"\n"
    )


def strip_legacy_aicheck_tips(tips: str) -> str:
    """Remove old `> AIcheck:` tip lines under #### (scores now live after fence)."""
    return "".join(
        ln
        for ln in tips.splitlines(keepends=True)
        if not re.match(r"^>\s*AIcheck\s*:", ln, re.IGNORECASE)
    )


def upsert_aicheck_score(
    md: str,
    field_id: str,
    cls: dict | None,
    *,
    verdict: str | None = None,
) -> tuple[str, bool]:
    """Place a score table *after* the Values fence; clear old tip-line scores.

    Keeps On form tips above the answer; AI detect sits below as its own card
    so it is not confused with form instructions.
    """
    block = score_block(field_id, cls, verdict=verdict)

    # Drop any prior score card for this id (comment + italic label + table).
    prior = re.compile(
        rf"\n?<!--\s*aicheck-score:{re.escape(field_id)}\s*-->\s*\n"
        rf"(?:\*[^\n]*\*\s*\n)?"
        rf"(?:\n)?"
        rf"(?:\|[^\n]*\n){{1,6}}"
        rf"(?:\n)?",
        re.IGNORECASE,
    )
    md = prior.sub("\n", md)

    # #### id … tips … ``` … ```
    pat = re.compile(
        rf"(^####\s+{re.escape(field_id)}(?:\s*[—\-|:].*)?\s*\n)"
        rf"((?:(?:>.*|[ \t]*)\n)*)"
        rf"(```(?:text|json|markdown|md|python|code)?\s*\n)"
        rf"([\s\S]*?)"
        rf"(```)",
        re.MULTILINE,
    )
    m = pat.search(md)
    if not m:
        return md, False

    prefix, tips, open_f, body, close_f = (
        m.group(1),
        m.group(2),
        m.group(3),
        m.group(4),
        m.group(5),
    )
    tips = strip_legacy_aicheck_tips(tips)
    # Blank line after fence so the score card is visually separate from the answer.
    rebuilt = prefix + tips + open_f + body + close_f + "\n\n" + block
    md2 = md[: m.start()] + rebuilt + md[m.end() :]
    # Avoid triple blank lines
    md2 = re.sub(r"\n{4,}", "\n\n\n", md2)
    return md2, True


def load_targets(fill: dict, only_ids: set[str] | None) -> list[dict]:
    actions = fill.get("allActions") or fill.get("actions") or []
    out = []
    for a in actions:
        if not isinstance(a, dict):
            continue
        tid = str(a.get("id") or "")
        t = str(a.get("type") or "").lower()
        if t in SKIP_TYPES or t == "claude":
            continue
        if t not in CHECK_TYPES:
            continue
        if a.get("fill") is False:
            continue
        val = a.get("value")
        if not isinstance(val, str) or not val.strip():
            continue
        if only_ids is not None and tid not in only_ids:
            continue
        out.append(a)
    return out


def parse_fill_if_needed(profile: Path, answer: Path, fill_path: Path) -> dict:
    if fill_path.is_file():
        return json.loads(fill_path.read_text(encoding="utf-8"))
    if not answer.is_file():
        raise RuntimeError("need answer.fill.json or answer.md")
    cmd = [
        "node",
        str(ROOT / "skills/take-dataannotation-assessment/parse-answer-fill.js"),
        "--answer",
        str(answer),
        "--out",
        str(fill_path),
    ]
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("parse-answer-fill failed: " + (r.stderr or r.stdout or ""))
    return json.loads(fill_path.read_text(encoding="utf-8"))


def reparse_after_apply(answer: Path, fill_path: Path) -> None:
    cmd = [
        "node",
        str(ROOT / "skills/take-dataannotation-assessment/parse-answer-fill.js"),
        "--answer",
        str(answer),
        "--out",
        str(fill_path),
    ]
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("re-parse failed: " + (r.stderr or r.stdout or ""))


def slim_detect(d: dict) -> dict:
    return {
        "ai": d.get("ai"),
        "cls": d.get("cls"),
        "verdict": d.get("verdict"),
        "sub": d.get("sub"),
        "conf": d.get("conf"),
        "flags": d.get("flags"),
        "sents": d.get("sents"),
        "flagged": d.get("flagged"),
        "words": d.get("words"),
        "msg": d.get("msg"),
    }


def load_state(path: Path) -> dict:
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                raw.setdefault("fields", {})
                return raw
        except Exception:
            pass
    return {"version": 2, "fields": {}}


def save_state(path: Path, state: dict) -> None:
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def extract_field_context(md: str, field_id: str, action: dict) -> dict:
    """Pull On form / Why / leaf so the agent can regenerate correctly."""
    on_form = None
    why = None
    # Tips under #### id
    tip_m = re.search(
        rf"^####\s+{re.escape(field_id)}(?:\s*[—\-|:].*)?\s*\n"
        rf"((?:(?:>.*|[ \t]*)\n)*)"
        rf"```",
        md,
        re.MULTILINE,
    )
    if tip_m:
        for ln in tip_m.group(1).splitlines():
            s = ln.strip()
            if re.match(r"^>\s*On form:", s, re.I):
                on_form = re.sub(r"^>\s*On form:\s*", "", s, flags=re.I).strip()

    # Nearest ## leaf Why block (search backward from #### id)
    pos = md.find(f"#### {field_id}")
    if pos < 0:
        pos = 0
    head = md[: pos + 1]
    leaf_start = head.rfind("\n## ")
    if leaf_start >= 0:
        leaf_body = md[leaf_start:]
        next_h = re.search(r"\n##\s+", leaf_body[4:])
        chunk = leaf_body[: next_h.start() + 4] if next_h else leaf_body
        wm = re.search(r"###\s+Why\s*\n+([^\n#]+)", chunk, re.I)
        if wm:
            why = wm.group(1).strip()

    return {
        "leaf": action.get("leaf"),
        "near": action.get("near"),
        "onForm": on_form,
        "why": why,
        "correctnessPriority": (
            "HARD: regenerate text that correctly and sufficiently answers THIS "
            "question (facts, numbers, rubrics, keep/drop rules). Natural tone "
            "second. Do NOT call the humanize API in agent-regen rounds. "
            "Do not invent claims absent from the bank/resume/current meaning."
        ),
    }


def flagged_excerpts(text: str, detect: dict, limit: int = 3) -> list[str]:
    out = []
    for a, b in normalize_flags(detect.get("flags"), len(text))[:limit]:
        chunk = text[a:b].strip()
        if chunk:
            out.append(chunk if len(chunk) <= 240 else chunk[:237] + "...")
    return out


def process_field(
    action: dict,
    *,
    max_ai: float,
    max_agent_regens: int,
    dry_run: bool,
    mode: str,
    style: str,
    ultra: bool,
    min_chars: int,
    sleep_s: float,
    state_fields: dict,
    md: str,
) -> dict:
    field_id = str(action.get("id") or "")
    leaf = action.get("leaf")
    text0 = str(action.get("value") or "")
    text = text0
    prev = state_fields.get(field_id) if isinstance(state_fields.get(field_id), dict) else {}
    regens_done = int(prev.get("regensDone") or 0)
    prev_text = prev.get("lastText")

    if len(text.strip()) < min_chars:
        return {
            "id": field_id,
            "leaf": leaf,
            "type": action.get("type"),
            "status": "skip_short",
            "ai": None,
            "rounds": 0,
            "changed": False,
            "needsUser": False,
            "needsAgentRegen": False,
            "note": f"shorter than detect minChars ({min_chars})",
            "text": text,
            "history": [],
        }

    if is_url_only(text0):
        try:
            det = detect_text(text0)
            pct = ai_percent(det)
            return {
                "id": field_id,
                "leaf": leaf,
                "type": action.get("type"),
                "near": action.get("near"),
                "status": "pass_url",
                "ai": pct,
                "cls": det.get("cls"),
                "verdict": det.get("verdict"),
                "detect": slim_detect(det),
                "rounds": 1,
                "changed": False,
                "needsUser": False,
                "needsAgentRegen": False,
                "note": "URL-only Value — kept verbatim; never humanize/regen",
                "text": text0,
                "original": text0,
                "history": [{"ai": pct, "cls": det.get("cls"), "urlLock": True}],
                "ask": None,
                "context": extract_field_context(md, field_id, action),
            }
        except Exception as e:
            return {
                "id": field_id,
                "status": "pass_url",
                "changed": False,
                "needsUser": False,
                "needsAgentRegen": False,
                "note": f"URL field kept (detect error: {e})",
                "text": text0,
                "original": text0,
            }

    if sleep_s > 0:
        time.sleep(sleep_s)
    det = detect_text(text)
    pct = ai_percent(det)
    print(
        f"  [{field_id}] cls.ai={pct}  verdict={det.get('verdict')}  "
        f"regensDone={regens_done}/{max_agent_regens}  "
        f"flags={len(det.get('flags') or [])}",
        file=sys.stderr,
    )

    ctx = extract_field_context(md, field_id, action)
    ctx["flaggedExcerpts"] = flagged_excerpts(text, det)

    # Text changed since last check → agent completed a regen cycle.
    if prev_text is not None and scrub(str(prev_text)) != scrub(text):
        if prev.get("status") in (
            "needs_agent_regen",
            "humanize_fallback",
            "needs_agent_verify",
        ):
            regens_done = min(max_agent_regens, regens_done + 1)
            print(
                f"  [{field_id}] detected agent text change → regensDone={regens_done}",
                file=sys.stderr,
            )

    result: dict[str, Any] = {
        "id": field_id,
        "leaf": leaf,
        "type": action.get("type"),
        "near": action.get("near"),
        "ai": pct,
        "cls": det.get("cls"),
        "verdict": det.get("verdict"),
        "detect": slim_detect(det),
        "rounds": 1,
        "regensDone": regens_done,
        "changed": False,
        "needsUser": False,
        "needsAgentRegen": False,
        "original": text0,
        "text": text,
        "history": [{"ai": pct, "cls": det.get("cls"), "verdict": det.get("verdict")}],
        "context": ctx,
        "ask": None,
    }

    if pct <= max_ai:
        result["status"] = "pass"
        result["note"] = (
            "Detect ok — confirm Value still correctly answers On form/Why "
            "(correctness is still the hard gate)."
        )
        return result

    if dry_run:
        result["status"] = "fail_dry"
        result["ask"] = (
            f"`{field_id}` cls.ai={pct}>{max_ai}. Dry-run: no regen/humanize."
        )
        return result

    # --- Agent regen path (NOT humanize), up to max_agent_regens ---
    if regens_done < max_agent_regens:
        attempt = regens_done + 1
        result["status"] = "needs_agent_regen"
        result["needsAgentRegen"] = True
        result["ask"] = (
            f"CYCLE {attempt}/{max_agent_regens} for `{field_id}` "
            f"(cls.ai={pct}>{max_ai}). "
            f"(1) AGENT: fix Values so it correctly answers the question "
            f"(context.onForm / why / flaggedExcerpts) — locked facts/numbers/URLs. "
            f"(2) Then humanize-text.py ONCE on that Value. "
            f"(3) Re-run aicheck-answer.py. "
            f"Do not re-detect on agent prose alone (bakeoff: ~100% AI)."
        )
        return result

    # --- After 3 paired cycles: last humanize attempt, then operator if still bad ---
    try:
        hum = rewrite_using_flags(text, det, mode=mode, style=style, ultra=ultra)
        if looks_bad(hum) or not hum.strip():
            hum = scrub(humanize_text(text, mode=mode, style=style, ultra=ultra))
        if sleep_s > 0:
            time.sleep(sleep_s)
        det2 = detect_text(hum)
        pct2 = ai_percent(det2)
        result["history"].append(
            {"afterHumanize": True, "ai": pct2, "cls": det2.get("cls")}
        )
        result["text"] = hum
        result["changed"] = scrub(hum) != scrub(text0)
        result["ai"] = pct2
        result["cls"] = det2.get("cls")
        result["verdict"] = det2.get("verdict")
        result["detect"] = slim_detect(det2)
        result["humanizeFallback"] = True
        print(
            f"  [{field_id}] final humanize after 3 cycles → cls.ai={pct2}",
            file=sys.stderr,
        )
        if pct2 <= max_ai:
            result["status"] = "needs_agent_verify"
            result["ask"] = (
                f"`{field_id}` final humanize reached cls.ai={pct2}≤{max_ai}. "
                f"AGENT: verify fit to On form/Why (keep tone). Fix meaning if drifted, "
                f"humanize once if you rewrote, then re-run aicheck."
            )
        else:
            result["status"] = "fail_after_humanize"
            result["needsUser"] = True
            result["ask"] = (
                f"`{field_id}` still cls.ai={pct2}>{max_ai} after 3× "
                f"(agent fit-fix + humanize). Keep, manual rewrite, or skip?"
            )
    except Exception as e:
        result["status"] = "error"
        result["needsUser"] = True
        result["ask"] = f"`{field_id}` final humanize failed: {e}"
        result["error"] = str(e)

    return result


def main() -> int:
    load_dotenv(ENV_FILE)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--profile", default="", help="Profile dir with answer.md / fill.json")
    ap.add_argument("--answer", default="", help="Path to answer.md")
    ap.add_argument("--fill", default="", help="Path to answer.fill.json")
    ap.add_argument("--out", default="", help="Report JSON (default: {profile}/answer.aicheck.json)")
    ap.add_argument("--max-ai", type=float, default=20.0, help="Fail if cls.ai > this (%%)")
    ap.add_argument(
        "--max-agent-regens",
        type=int,
        default=3,
        help="Agent regenerate cycles before humanize fallback (default 3)",
    )
    ap.add_argument("--max-rounds", type=int, default=0, help=argparse.SUPPRESS)  # legacy alias
    ap.add_argument("--mode", default="balanced", help="humanize mode (fallback only)")
    ap.add_argument("--style", default="standard")
    ap.add_argument("--ultra", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="Detect + stamp scores; no regen/humanize writes")
    ap.add_argument("--no-apply", action="store_true", help="Do not patch answer.md")
    ap.add_argument("--apply", action="store_true", help="Patch answer.md (default unless --dry-run/--no-apply)")
    ap.add_argument("--ids", default="", help="Comma-separated field ids only")
    ap.add_argument("--min-chars", type=int, default=20, help="Skip shorter than detect minChars")
    ap.add_argument("--sleep", type=float, default=0.4, help="Pause between detect calls (rate limit)")
    ap.add_argument("--reset-state", action="store_true", help="Clear answer.aicheck.state.json regen counters")
    args = ap.parse_args()
    if args.max_rounds and not args.max_agent_regens:
        args.max_agent_regens = args.max_rounds

    try:
        refuse_legacy_bearer()
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2

    profile = Path(args.profile).resolve() if args.profile else None
    answer = Path(args.answer).resolve() if args.answer else None
    fill_path = Path(args.fill).resolve() if args.fill else None

    if profile:
        answer = answer or (profile / "answer.md")
        fill_path = fill_path or (profile / "answer.fill.json")
    if not fill_path and answer:
        fill_path = answer.with_name("answer.fill.json")
    if not fill_path:
        print("need --profile or --fill", file=sys.stderr)
        return 2
    if not answer:
        answer = fill_path.with_name("answer.md")

    only_ids = {x.strip() for x in args.ids.split(",") if x.strip()} or None
    apply = bool(args.apply) or (not args.dry_run and not args.no_apply)
    stamp_scores = not args.no_apply
    max_agent = int(args.max_agent_regens or 3)

    state_path = (profile / "answer.aicheck.state.json") if profile else fill_path.with_name(
        "answer.aicheck.state.json"
    )
    if args.reset_state and state_path.is_file():
        state_path.unlink()
        print("reset aicheck state", file=sys.stderr)
    state = load_state(state_path)

    try:
        fill = parse_fill_if_needed(
            profile or fill_path.parent, answer, fill_path
        )
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 2

    md_text = answer.read_text(encoding="utf-8") if answer.is_file() else ""

    targets = load_targets(fill, only_ids)
    print(
        f"aicheck: {len(targets)} field(s); max_ai={args.max_ai}; "
        f"max_agent_regens={max_agent}; dry_run={args.dry_run}; "
        f"apply={apply and not args.dry_run}",
        file=sys.stderr,
    )

    results: list[dict] = []
    for action in targets:
        try:
            results.append(
                process_field(
                    action,
                    max_ai=args.max_ai,
                    max_agent_regens=max_agent,
                    dry_run=args.dry_run,
                    mode=args.mode,
                    style=args.style,
                    ultra=args.ultra,
                    min_chars=args.min_chars,
                    sleep_s=args.sleep,
                    state_fields=state.get("fields") or {},
                    md=md_text,
                )
            )
        except urllib.error.URLError as e:
            results.append(
                {
                    "id": action.get("id"),
                    "status": "error",
                    "needsUser": True,
                    "needsAgentRegen": False,
                    "ask": f"Relay detect failed for `{action.get('id')}`: {e}",
                    "error": str(e),
                    "changed": False,
                    "text": action.get("value"),
                    "original": action.get("value"),
                }
            )
        except RuntimeError as e:
            results.append(
                {
                    "id": action.get("id"),
                    "status": "error",
                    "needsUser": True,
                    "needsAgentRegen": False,
                    "ask": f"Failed on `{action.get('id')}`: {e}",
                    "error": str(e),
                    "changed": False,
                    "text": action.get("value"),
                    "original": action.get("value"),
                }
            )

    # Persist per-field regen state
    for r in results:
        rid = str(r.get("id") or "")
        if not rid or r.get("status") in ("skip_short",):
            continue
        state.setdefault("fields", {})[rid] = {
            "lastText": r.get("text") if r.get("changed") else r.get("original") or r.get("text"),
            "regensDone": int(r.get("regensDone") or 0),
            "status": r.get("status"),
            "ai": r.get("ai"),
            "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        # For humanize fallback, store pre-humanize as baseline for source block
        if r.get("humanizeFallback"):
            state["fields"][rid]["preHumanize"] = r.get("original")
            state["fields"][rid]["lastText"] = r.get("text")
    save_state(state_path, state)

    needs_user = [r for r in results if r.get("needsUser")]
    needs_regen = [r for r in results if r.get("status") == "needs_agent_regen"]
    needs_verify = [r for r in results if r.get("status") == "needs_agent_verify"]
    failed = [
        r
        for r in results
        if r.get("status")
        in ("fail_after_humanize", "fail_dry", "error", "needs_agent_regen")
    ]

    md_patched = False
    write_md = (apply and not args.dry_run) or stamp_scores
    if write_md and answer.is_file() and results:
        md = answer.read_text(encoding="utf-8")
        touched = False
        content_changed = False

        for r in results:
            rid = str(r.get("id") or "")
            if not rid:
                continue
            st = r.get("status")

            if apply and not args.dry_run:
                if st in ("humanize_fallback", "needs_agent_verify", "fail_after_humanize") or (
                    r.get("humanizeFallback") and r.get("changed")
                ):
                    # Collapse pre-humanize source; write humanized as final.
                    src = str(
                        (state.get("fields") or {}).get(rid, {}).get("preHumanize")
                        or r.get("original")
                        or ""
                    )
                    if src and scrub(src) != scrub(str(r.get("text") or "")):
                        md2, ok = upsert_source_collapsed(md, rid, src)
                        if ok:
                            md = md2
                            touched = True
                            content_changed = True
                            r["sourceCollapsed"] = True
                            print(f"  source collapsed above Values: {rid}", file=sys.stderr)
                    if r.get("text") is not None:
                        md3, okf = replace_value_fence(md, rid, str(r["text"]))
                        if okf:
                            md = md3
                            touched = True
                            content_changed = True
                            print(f"  patched Values (humanize fallback): {rid}", file=sys.stderr)
                elif st == "pass":
                    md2 = remove_source_collapsed(md, rid)
                    if md2 != md:
                        md = md2
                        touched = True
                        content_changed = True

            if stamp_scores and r.get("cls") is not None:
                md4, oks = upsert_aicheck_score(
                    md, rid, r.get("cls"), verdict=r.get("verdict")
                )
                if oks:
                    md = md4
                    touched = True
                    r["scoreStamped"] = True
                    print(
                        f"  score: {rid}  {format_cls_tip(r.get('cls'), verdict=r.get('verdict'))}",
                        file=sys.stderr,
                    )

        if touched:
            answer.write_text(md, encoding="utf-8")
            md_patched = True
            if content_changed:
                try:
                    reparse_after_apply(answer, fill_path)
                    print(f"  re-parsed {fill_path.name}", file=sys.stderr)
                except RuntimeError as e:
                    print(f"  WARN: {e}", file=sys.stderr)

    if profile and any(r.get("changed") for r in results) and not args.dry_run:
        drafts = {
            r["id"]: r["text"]
            for r in results
            if r.get("changed") and r.get("id") and r.get("text")
        }
        if drafts:
            (profile / "drafts-aicheck.json").write_text(
                json.dumps(drafts, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )

    out_path = Path(args.out).resolve() if args.out else (
        (profile / "answer.aicheck.json")
        if profile
        else fill_path.with_name("answer.aicheck.json")
    )
    regen = [
        {
            "id": r.get("id"),
            "attempt": int(r.get("regensDone") or 0) + 1,
            "of": max_agent,
            "ai": r.get("ai"),
            "ask": r.get("ask"),
            "context": r.get("context"),
        }
        for r in needs_regen
    ]
    report = {
        "ok": not needs_user and not needs_regen and not needs_verify and not any(
            r.get("status") == "fail_dry" for r in results
        ),
        "maxAi": args.max_ai,
        "maxAgentRegens": max_agent,
        "dryRun": args.dry_run,
        "applied": md_patched,
        "checked": len(results),
        "passed": sum(
            1
            for r in results
            if r.get("status") in ("pass", "pass_url", "skip_short")
        ),
        "needsAgentRegen": len(needs_regen) > 0,
        "needsAgentVerify": len(needs_verify) > 0,
        "needsUser": len(needs_user) > 0,
        "correctnessGate": (
            "HARD: every Value must correctly and sufficiently answer its question "
            "(On form / Why). Detect cls.ai≤20 is required but not sufficient."
        ),
        "regen": regen,
        "ask": [r.get("ask") for r in (needs_regen + needs_verify + needs_user) if r.get("ask")],
        "fields": results,
    }
    for f in report["fields"]:
        if f.get("status") == "pass" and not f.get("needsUser"):
            f.pop("history", None)
            f.pop("original", None)
            if not f.get("changed"):
                f.pop("text", None)

    out_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    summary = {k: report[k] for k in report if k not in ("fields", "regen")}
    summary["regenCount"] = len(regen)
    print(json.dumps(summary, indent=2))
    print(f"wrote {out_path}", file=sys.stderr)
    print(f"wrote {state_path}", file=sys.stderr)

    if needs_user:
        print("\nASK OPERATOR:", file=sys.stderr)
        for a in report["ask"]:
            if a:
                print(f"  - {a}", file=sys.stderr)
        return 3
    if needs_regen:
        print("\nAGENT REGEN REQUIRED (not humanize):", file=sys.stderr)
        for item in regen:
            print(f"  - {item['ask']}", file=sys.stderr)
        return 4
    if needs_verify:
        print("\nAGENT VERIFY AFTER HUMANIZE:", file=sys.stderr)
        for r in needs_verify:
            print(f"  - {r.get('ask')}", file=sys.stderr)
        return 5
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

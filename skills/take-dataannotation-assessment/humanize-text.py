#!/usr/bin/env python3
"""Humanize DA fill-in text via ScreenMirror relay /api/humanize (join key).

Auth: x-sm-join-key = SM_JOIN_KEY (same as agent-drive join). Never Bearer /
HUMANIZE_API_KEY / api.humanizeai.pro from the agent.

Also available live as agent-drive verbs:
  {"do":"humanize","text":"…","mode":"balanced","style":"formal"}
  {"do":"aicheck","text":"…"}
  {"do":"aiusage"}

@run python skills/take-dataannotation-assessment/humanize-text.py --text "raw answer"
@run python skills/take-dataannotation-assessment/humanize-text.py --json-in raw.json --json-out humanized.json
@run python skills/take-dataannotation-assessment/humanize-text.py --ready
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # agent-drive/
ENV_FILE = ROOT / ".env"


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
    key = (os.environ.get("HUMANIZE_API_KEY") or "").strip()
    auth = (os.environ.get("DA_HUMANIZE_AUTH") or "").strip()
    if key or auth:
        raise RuntimeError(
            "Refuse HUMANIZE_API_KEY / DA_HUMANIZE_AUTH. Clear them. "
            "Use SM_JOIN_KEY → relay /api/humanize (x-sm-join-key), or verb humanize."
        )


def relay_http_base() -> str:
    relay = (
        os.environ.get("SM_RELAY_URL")
        or os.environ.get("SM_RELAY")
        or ""
    ).strip()
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
    req = urllib.request.Request(url, data=data, headers=headers, method="GET" if data is None else "POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        out = json.load(resp)
    if not isinstance(out, dict):
        raise RuntimeError("unexpected relay response: %r" % (out,))
    if out.get("ok") is False:
        raise RuntimeError(out.get("why") or out.get("error") or repr(out))
    return out


_URL_TOKEN = "\0URLCOLON\0"


def scrub(text: str) -> str:
    # Protect URL schemes before ":" → " -" (share links must stay https://…).
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


def looks_bad(text: str) -> bool:
    if not text.strip():
        return True
    probe = re.sub(r"(?i)\b[a-z][a-z0-9+.-]*://", "", text)
    if ":" in probe or ";" in probe or "—" in probe or "–" in probe:
        return True
    return False


def humanize(text: str, mode: str = "balanced", style: str = "standard", ultra: bool = False) -> str:
    mode = mode if mode in ("balanced", "quality", "bypass") else "balanced"
    data = relay_api(
        "/api/humanize",
        {
            "text": text,
            "mode": mode,
            "style": style or "standard",
            "ultra": bool(ultra),
        },
    )
    out = data.get("text")
    if isinstance(out, str) and out.strip():
        return out
    raise RuntimeError("unexpected humanize response: %r" % (data,))


def humanize_until_ok(text: str, mode: str, style: str, ultra: bool, max_tries: int = 3) -> str:
    last = text
    for _ in range(max_tries):
        last = scrub(humanize(last, mode=mode, style=style, ultra=ultra))
        if not looks_bad(last):
            return last
        last = scrub(humanize(text, mode=mode, style=style, ultra=ultra))
        if not looks_bad(last):
            return last
    return scrub(last)


def main() -> int:
    load_dotenv(ENV_FILE)
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--text", default="")
    ap.add_argument("--in", dest="infile", default="")
    ap.add_argument("--out", dest="outfile", default="")
    ap.add_argument("--json-in", dest="json_in", default="")
    ap.add_argument("--json-out", dest="json_out", default="")
    ap.add_argument("--strength", "--mode", dest="mode", default="balanced")
    ap.add_argument("--style", default="standard")
    ap.add_argument("--ultra", action="store_true")
    ap.add_argument("--ready", action="store_true", help="GET /api/humanize ready only")
    ap.add_argument("--detect", default="", help="POST /api/detect on this text")
    ap.add_argument("--usage", action="store_true", help="GET /api/aiusage")
    args = ap.parse_args()

    try:
        refuse_legacy_bearer()
        if args.ready:
            print(json.dumps(relay_api("/api/humanize"), indent=2))
            return 0
        if args.usage:
            print(json.dumps(relay_api("/api/aiusage"), indent=2))
            return 0
        if args.detect:
            print(json.dumps(relay_api("/api/detect", {"text": args.detect}), indent=2))
            return 0

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
                out[k] = humanize_until_ok(v, args.mode, args.style, args.ultra)
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

        result = humanize_until_ok(text, args.mode, args.style, args.ultra)
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
        print("humanize relay error: %s" % e, file=sys.stderr)
        return 1
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

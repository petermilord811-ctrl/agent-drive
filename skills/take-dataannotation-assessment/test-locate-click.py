#!/usr/bin/env python3
"""Regression checks for locate-click.py against saved assessment assets."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCATE = ROOT / "locate-click.py"
ASSETS = ROOT / "problems" / "assets"


def run(png: Path, *args: str) -> dict:
    cmd = [sys.executable, "-I", str(LOCATE), str(png), *args]
    out = subprocess.check_output(cmd, text=True)
    return json.loads(out)


def main() -> int:
    fails = []

    # --- Generalist employees: 5-option vertical column, never sidebar ---
    emp = ASSETS / "generalist" / "employees.png"
    if emp.exists():
        z = run(emp, "zones")
        edge = z["sidebar_edge"]
        xmin = None
        r = run(emp, "radios")
        xmin = r.get("content_x_min", edge)
        if not r.get("ok") or r.get("count", 0) < 3:
            fails.append(f"employees radios: expected >=3, got count={r.get('count')} raw={r.get('raw_hits')}")
        else:
            if not r.get("column_filtered"):
                fails.append("employees radios: expected vertical column filter")
            for rad in r["radios"]:
                if rad["lx"] <= xmin:
                    fails.append(f"employees radio lx={rad['lx']} <= content_x_min={xmin}")
                if rad["lx"] <= 340:
                    fails.append(f"employees radio lx={rad['lx']} in proven sidebar danger zone (<=340)")
            # Proven mis-click was (320,327) — must not be returned
            if any(abs(rad["lx"] - 320) < 8 and abs(rad["ly"] - 327) < 12 for rad in r["radios"]):
                fails.append("employees returned proven-bad sidebar point ~(320,327)")
        n = run(emp, "next")
        if not n.get("ok"):
            fails.append(f"employees next failed: {n}")
        elif n["lx"] <= edge:
            fails.append(f"employees next in sidebar: {n}")
        elif n["ly"] < z["footer_y_min"] - 20:
            fails.append(f"employees next too high (not footer): ly={n['ly']}")

    # --- Q1: 5 GOOG price radios in a column ---
    q1 = ASSETS / "generalist" / "q1.png"
    if q1.exists():
        r = run(q1, "radios")
        xmin = r.get("content_x_min", 0)
        if r.get("count", 0) < 3:
            fails.append(f"q1 radios weak: {r.get('count')}")
        if r.get("count", 0) > 8:
            fails.append(f"q1 choice cluster too large (code-dot leak?): {r.get('count')} raw={r.get('raw_hits')}")
        if not r.get("choice_cluster") and r.get("raw_hits", 0) > r.get("count", 0) + 2:
            fails.append("q1 expected choice_cluster=true when raw_hits >> count")
        for rad in r.get("radios", []):
            if rad["lx"] <= xmin or rad["lx"] <= 340:
                fails.append(f"q1 radio in danger zone lx={rad['lx']}")
        # middle option should be content (historically ~457,280)
        mid = run(q1, "radio", "2")
        if mid.get("ok") and mid["lx"] < 400:
            fails.append(f"q1 radio 2 too far left (likely sidebar): {mid['lx']},{mid['ly']}")

    # --- SE Q1: must not return 13 code-dot hits as choices ---
    se_q1 = ASSETS / "software-engineer" / "q1.png"
    if se_q1.exists():
        r = run(se_q1, "radios")
        if r.get("count", 0) > 8:
            fails.append(
                f"SE q1 choice cluster too large: count={r.get('count')} "
                f"raw={r.get('raw_hits')} column={r.get('column_hits')}"
            )
        if r.get("count", 0) < 2:
            fails.append(f"SE q1 expected >=2 choices, got {r.get('count')}")

    # --- certify: next must exist ---
    cert = ASSETS / "generalist" / "certify.png"
    if cert.exists():
        n = run(cert, "next")
        if not n.get("ok"):
            fails.append(f"certify next failed: {n}")

    # --- bio continue ---
    bio1 = ASSETS / "generalist" / "bio1.png"
    if bio1.exists():
        c = run(bio1, "continue")
        if not c.get("ok"):
            # SE bio may differ; warn only if both fail
            se = ASSETS / "software-engineer" / "bio1.png"
            if se.exists():
                c2 = run(se, "continue")
                if not c2.get("ok"):
                    fails.append(f"continue failed on generalist+SE bio1: {c} / {c2}")

    # --- role: Data Scientist must NOT silently return col0 ---
    # Use employees as non-browse image → should fail ok or return cards;
    # For browse we may not have a saved browse png in assets — skip if missing.

    if fails:
        print("FAIL")
        for f in fails:
            print(" -", f)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

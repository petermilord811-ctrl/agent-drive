# Part B answer gates (HARD — Herman never-again)

**Acceptance:** `MeaningPass ∧ QualityPass ∧ DetectPass`  
**Single command (required before autofill):**

```bash
python skills/take-dataannotation-assessment/answer-gates.py --profile "{profile}" --run-aicheck
# offline draft only:
python skills/take-dataannotation-assessment/answer-gates.py --profile "{profile}" --skip-detect
```

Exit **0** only when remake may be called done. Any other exit → fix Values; do **not** fill.

Artifacts written: `answer.gates.json`, `answer.meaning.json`, `answer.quality.json`, refreshed `drafts-humanized.json` from `answer.md`.

---

## Why this exists (real bugs)

| Failure | What happened | Gate that blocks it |
|---------|----------------|---------------------|
| Detect as objective | Humanize weakened best draft; low AI kept; strong draft discarded (~100% AI) | Detect only after Meaning∧Quality; illegal to keep ai≤20 on gate fail |
| Keyword-only fit | “Penn + Python” passed while role softened / tools mixed into trials | MeaningPass `must_keep` / `must_not` / `strength` |
| Garble / undercut | “true concentration”, “Consult.”, duplicate `Return 1)` | QualityPass global + card `must_not` |
| Criterion miss | q2b fused order into coeffs; q4 praised A | QualityPass On form criteria |
| Docs ≠ code | “best correct first” in markdown only | `answer-gates.py` + `prepare-answer` refuse `autofill-ready` without gates ok |
| Colon scrub | `:` → ` -` broke `https://` share URL | `humanize-text.py` scrub URL-lock; never scrub `conv_share` |
| False must_not | “lock label” matched “locked labeling” | Prefer `\b…\b` / phrase regex; review hits before rewrite |
| Voice first | Agent-only prose ≈100% AI | MQ on **best** first; one humanize of that best; re-MQ |
| PowerShell `-c` | Inline Python mangled on Windows | Ship `.py` gate scripts; invoke by path |

---

## Pipeline (always this order)

1. **Author** `{profile}/drafts/meaning.json`  
   Per textarea: `best`, `must_keep`, `must_not`, optional `strength`, `quality` (`min_sentences`, `on_form_criteria`, …).
2. **Write best-correct** Values into `answer.md` (from `best` / resume / bank / On form). Not “good enough.”
3. **MeaningPass** on best → must pass before voice.
4. **QualityPass** on best → must pass before voice.
5. **Voice:** prefer spoken variants of `best` that already MQ-pass; else **one** `humanize-text.py` (balanced) + scrub. Never `HUMANIZE_API_KEY`.
6. **MeaningPass + QualityPass again** on the candidate. Fail ⇒ discard even if `cls.ai=0`. Surgical restore from `best` / card.
7. **DetectPass** via `aicheck-answer.py` (`cls.ai≤20`) **only** on MQ-pass text. If ai>20: restore from card → humanize once → MQ → detect ≤3. Else ask operator.
8. **`answer-gates.py` exit 0** → then `prepare-answer.js` (must emit `phase: autofill-ready`). Never Submit until operator yes.

```text
best-correct → MeaningPass → QualityPass → voice → MQ again → DetectPass → answer-gates.py → prepare (gates ok) → fill
```

`prepare-answer.js` **re-runs** `answer-gates.py` whenever fill+playbook exist. If gates fail → `phase: gates-pending` and **exit 1**. Live fill is illegal until green.

---

## Illegal matrices

| Meaning | Quality | Detect | Action |
|---------|---------|--------|--------|
| pass | pass | pass | Keep — done |
| pass | pass | fail | Repair pair ≤3; else ask operator |
| fail | * | pass | **Discard** (Herman bug) |
| * | fail | pass | **Discard** |
| fail | fail | * | Rewrite from `best` |

---

## Per-profile checklist

- [ ] `drafts/meaning.json` complete for every prose textarea
- [ ] Values in `answer.md` match meaning `best` intent
- [ ] `answer-gates.py --profile … --run-aicheck` exit 0
- [ ] Spot-skim: each Value answers **On form** (what the item grades)
- [ ] `prepare-answer.js` → `autofill-ready`
- [ ] Live fill only after gates green; Submit only on operator yes

---

## Tools

| Tool | Role |
|------|------|
| `drafts/meaning.json` | Meaning + quality cards |
| `meaning-gate.py` | MeaningPass |
| `quality-gate.py` | QualityPass + On form criteria |
| `aicheck-answer.py` | DetectPass + score cards |
| `answer-gates.py` | Orchestrator — **required** |
| `humanize-text.py` | Voice only after MQ on best |

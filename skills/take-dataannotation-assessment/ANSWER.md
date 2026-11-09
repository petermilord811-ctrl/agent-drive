---
name: Answer DataAnnotation assessment (Part B)
when: after problems-{slug}.md is captureStatus full (re-catch/diff ok) — prepare-answer session → generate profile answer.md → playbook → paced ScreenMirror autofill → recheck → operator review before Submit
tags: dataannotation, answers, autofill, pacing, humanize, firefox, mission, preflight
run: node skills/take-dataannotation-assessment/prepare-answer.js --profile "path/to/profile" --strict-full
---
# Part B — Answer + autofill (last step)

**Before any live click:** read [`PREFLIGHT.md`](./PREFLIGHT.md).

Runs only when Part A bank is ready. **Do not Submit** until the operator reviews.

Parent: [`README.md`](./README.md) · Template: [`answers.template.md`](./answers.template.md) ·
Rules: [`rules/generating_rule.md`](../../../rules/generating_rule.md) · Clicks: [`CLICK.md`](./CLICK.md)

## One command to start

```bash
node skills/take-dataannotation-assessment/prepare-answer.js \
  --profile "d:/5.AI/DA assessments/10-Daniel Herman" \
  --strict-full
```

Writes `{profile}/session.json` with `phase` + `nextSteps`. When `answer.fill.json` exists, also writes `answer.pace.json` + `answer.playbook.json`.

| `session.phase` | Meaning |
|-----------------|---------|
| `blocked` | Bank/resume gate failed — usually **Part A fetch** |
| `generate-answer-md` | Gate ok — write `answer.md` offline |
| `parse-validate` | Have `answer.md` — parse + validate |
| `autofill-ready` | Playbook ready — machine fill allowed |

## Outputs (next to the profile resume)

```text
{profile-dir}/
  Resume.pdf|docx
  session.json             ← prepare-answer.js
  answer.md
  answer.fill.json
  answer.pace.json
  answer.playbook.json     ← agent autofill contract
```

Never write answers into `skills/.../problems/`.

## Mission shape

```json
{
  "goal": "DA Part B answer + fill for <Role> / <Profile>",
  "milestones": [
    { "t": "0 Preflight", "done": "session.json phase != blocked; slug matches intended role" },
    { "t": "1 Generate answer.md", "done": "answer.md + fill.json validated; humanized" },
    { "t": "2 Playbook + timer", "done": "answer.playbook.json; TIMER armed via status/mission immediately after Start" },
    { "t": "3 Autofill", "done": "every leaf timed (status.step + answer.timer.json) + filled; required empty = 0" },
    { "t": "4 Recheck", "done": "sidebar walk matches answer.md" },
    { "t": "5 Operator review", "done": "operator said Submit or fix; Submit only on yes" }
  ]
}
```

---

## 0. Readiness (HARD)

```bash
node skills/take-dataannotation-assessment/answer-ready.js --auto-pick --profile "{profile}" --strict-full
# or with known slug:
node skills/take-dataannotation-assessment/answer-ready.js --slug data-scientist --profile "{profile}" --strict-full
```

Live miss (99588 Daniel Herman): best pick **Data Scientist**, bank **incomplete** → Part B correctly blocked; do not fill SE instead.

---

## 1. Generate answers

### Rules (HARD)

- Keep explanations and answers short. Pick only the main points. Do not pad.
- Fill-ins in natural spoken English, except keyboard-typeable math/science notation.
- No long dashes, no `:`, no `;`, no thousands-separated numerals in fill-in text.
- Breaking-AI: stable conclusion + exact fill-in — no long model dumps unless required.
- Humanize every form fill-in via relay `/api/humanize` with `x-sm-join-key` = `SM_JOIN_KEY` (`humanize-text.py` or verb `humanize`). Never `HUMANIZE_API_KEY` / Bearer / wisdom324. Scrub banned punctuation after rewrite.
- Clear textareas with **Backspace only** — never `Ctrl+A` (selects the whole assessment page).
- Live fill contract: [`PART-B-FILL.md`](./PART-B-FILL.md) — prove focus before `keys`; never Ctrl+C/V on DA; never SM Expires/`field ""` marks; `snap:false` for small targets.
- Questions independent. Profiles independent. Resume-grounded demographics only.
- Instructions = `agree` only. Optional may be blank. No invented secrets.
- If live UI shows fields missing from bank (e.g. failure Yes → round / describe / screenshot), draft + fill + **patch bank + answer.fill** before next take.

### Write `answer.md`

Use [`answers.template.md`](./answers.template.md): UI `[✅]` mirrors + Fields table + Confidence.

```bash
python skills/take-dataannotation-assessment/humanize-text.py --json-in drafts/raw.json --json-out drafts/humanized.json
# live visit: {"do":"humanize","text":"…","mode":"balanced"} then keys the result
node skills/take-dataannotation-assessment/parse-answer-fill.js --answer "{profile}/answer.md" --out "{profile}/answer.fill.json"
node skills/take-dataannotation-assessment/validate-answers.js --slug <slug> --answer "{profile}/answer.md"
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --slug <slug> --fetch-min 10 --gen-min 10
```

---

## 2. Timer + pacing (HARD MUST)

**Full contract:** [`TIMER.md`](./TIMER.md).

Bio minutes come from the bank (`prepare-answer` / `pace-plan --bank`).

```bash
node skills/take-dataannotation-assessment/pace-plan.js \
  --bank skills/take-dataannotation-assessment/problems/problems-<slug>.md \
  --fetch-min 10 --gen-min 10 \
  --fill "{profile}/answer.fill.json" \
  --out "{profile}/answer.pace.json"
```

| Cue | Parse |
|-----|-------|
| 30–60 minutes | min=30 max=60 |
| About 60-90 minutes | min=60 max=90 |
| 1 hour or more | min=60 max=90 |

### ScreenMirror timer (MUST — operator 2026-11-08)

1. **Immediately after Start assessment** (before any field): arm `status` tree from `playbook.timer.treeTemplate` (optional `mission plan`). Append `{profile}/answer.timer.json` `start_assessment`.
2. **Every leaf** before fill: `status { step: "Step k · {leaf}" }` so the panel stopwatch records that step; after fill flip tree `done` + append `step_done` to `answer.timer.json`.
3. Skipping the panel timer / logging only in chat = **workflow fail**.

Use playbook `pauseMs` before each field (`pause` verb). Typing = ScreenMirror `keys` auto-type (**never `human:0`**).

---

## 3. Autofill (playbook)

Walk `answer.playbook.json` `actions[]` in order. Prefer sidebar leaf jumps.

| type | How |
|------|-----|
| `agree` | I agree → Next |
| `radio` | `locate-click.py <look> radios` (choice cluster) → `radio N` matching value → look |
| `checkbox` | each listed option |
| `drag` | `stroke` to `value[]` order |
| `text`/`textarea`/`code` | focus (locate or label→Tab) → **prove** 1 non-space char → Backspace clear (never Ctrl+A) → `keys` chunks (never human:0, never Ctrl+V on DA) |
| `skip` | leave blank |

Hard:

- [`PART-B-FILL.md`](./PART-B-FILL.md) + [`CLICK.md`](./CLICK.md) — content only; no OCR `clickText` on blind hosts.
- Raw `radios-raw` is debug-only (SE Q1 had 13 code-dot hits).
- Never trust SM content marks that land x≈80; never click blank `field` near Expires.
- Never Submit during fill. Share URL = real Claude chat then type with `keys`.

---

## 4. Recheck → 5. Operator review

Sidebar walk; required empty = 0; then short chat:

> Filled + rechecked. Reply **Submit** or tell me what to fix.

`chat_wait` only after a **short** chat. Submit only on explicit yes. Finish with cropped look.

---

## Pitfalls (live-proven)

- Incomplete bank + wrong role open → stop; fetch correct slug.
- PDF binary pick → Designer; always extract.
- Heuristic card dbl → SE instead of DS.
- `radio N` on unclustered hits → wrong control.
- Long chat → stuck `chat-wait` (reconnect).
- `human:0` forbidden on DA fields.

## Evidence

Part B configured 2026-11-08; big upgrade 2026-11-08 after 99588 Daniel Herman feel-test (`prepare-answer`, choice-cluster radios, PREFLIGHT, pick.slug, pace `--bank`).

# {Role} — answers for {Profile Name}

```yaml
slug: {slug}
profileDir: {path/to/profile-folder}
resume: {Resume.pdf}
problems: skills/take-dataannotation-assessment/problems/problems-{slug}.md
bioMinutes: {min: 30, max: 60}
generated: YYYY-MM-DD
status: draft | ready | filled | reviewed
format: agent-v2
```

> **Agent tape (HARD):** parse with `parse-answer-fill.js`. Fill **only** from `### Fields` + `### Values`.
> Long text lives under `#### {id}` fences — never invent from `### Why`.
> Never Submit until operator yes. Prefer `answer.fill.json` / playbook at runtime.

---

## Timing

| Phase | Minutes |
|-------|---------|
| Fetch + re-catch/diff | {10} |
| Generate + humanize | {10} |
| Bio expected total | {30}–{60} |
| **Remaining for fill** | **{10}–{40}** |

Pace: `answer.pace.json`.

---

## Style rules (agent-v2)

1. **Fields table** = control plan (short cells only). Columns: `id | type | action | near | required`
2. **Values** = one `#### {id} — Human label` fence per payload (id token only is parsed)
3. Under each Values header, optional `> On form: …` tip (human + agent; not typed)
4. Per leaf, optional `**On form:**` one-liner summarizing the DA question block
5. Short radios may use Values fence **or** legacy inline `value` column
6. `near` = locator hint for empty boxes (`first rubric`, `Optional`, `Conversation Goal`)
7. `### UI` / `### Why` = notes only (never typed on DA)
8. Claude prompts = Fields `type: claude` + Values fences (not DA form keys)

---

## Instructions

**Step:** Step 1 of N  
**Confidence:** 1.00

### Fields
| id | type | action | near | required |
|----|------|--------|------|----------|
| instructions_agree | agree | click | | true |

### Values

#### instructions_agree
```text
I agree
```

---

## Question 1: {title from bank}

**Step:** Step 2 of N  
**Confidence:** 0.90  
**On form:** Which solution best follows programming best practices? Then explain.

### Fields
| id | type | action | near | required |
|----|------|--------|------|----------|
| q1_choice | radio | select | | true |
| q1_explain | textarea | type | | true |

### Values

#### q1_choice — Best solution radio
> On form: pick the radio for the strongest solution (A/B/C/…)

```text
Solution B most closely follows programming best practices and principles
```

#### q1_explain — Why that solution
> On form: short reasoning textarea under the choice

```text
{humanized short reasoning — no : ; or long dashes}
```

### UI
```text
[ ] Solution A …
[✅] Solution B …
[ ] Solution C …
```

### Why
{one short internal reason}

---

## Section 1 Conversation (example with Claude)

**Step:** Step 2 of N  
**Confidence:** 0.85

### Fields
| id | type | action | near | required |
|----|------|--------|------|----------|
| conv_goal | textarea | type | Conversation Goal | true |
| conv_attach | radio | select | | true |
| conv_failure | radio | select | | true |
| conv_failure_round | text | type | | true |
| conv_failure_desc | textarea | type | | true |
| conv_failure_screenshot | upload | skip | | true |
| conv_performance | radio | select | | true |
| conv_rationale | textarea | type | | true |
| conv_share | textarea | type | Share Your Conversation | true |
| claude_round1 | claude | paste | | false |
| claude_round2 | claude | paste | | false |

### Values

#### conv_goal
```text
{goal text}
```

#### conv_attach
```text
No
```

#### conv_failure
```text
Yes
```

#### conv_failure_round
```text
1
```

#### conv_failure_desc
```text
{3+ sentences}
```

#### conv_failure_screenshot
```text
(after real Claude chat — crop failure turn)
```

#### conv_performance
```text
Poor
```

#### conv_rationale
```text
{3+ sentences}
```

#### conv_share
```text
https://claude.ai/share/…
```

#### claude_round1
```text
{Haiku Effort Low Round 1 — blank line before Setup; Shift+Enter newlines}
```

#### claude_round2
```text
{press only if Round 1 did not fail meaningfully}
```

### Why
{domain fit note}

---

## Question: rubrics

**Step:** Step k of N  
**Confidence:** 0.88  
**On form:** Write an original DS/stats prompt, then two “Did the response…” rubrics.

### Fields
| id | type | action | near | required |
|----|------|--------|------|----------|
| q3_prompt | textarea | type | | true |
| q3_rubric1 | textarea | type | first rubric | true |
| q3_rubric2 | textarea | type | second rubric | true |

### Values

#### q3_prompt — New example prompt (Question 3)
> On form: create an original, challenging, realistic Data Science / Analytics / Stats prompt with a clear solution

```text
{prompt}
```

#### q3_rubric1 — Enter your first rubric
> On form: Question 3a — begin with “Did the response…”

```text
Did the response …
```

#### q3_rubric2 — Enter your second rubric
> On form: Question 3a — second empty box under first rubric

```text
Did the response …
```

---

## Question: drag / order

**Step:** Step k of N  
**Confidence:** 0.88

### Fields
| id | type | action | near | required |
|----|------|--------|------|----------|
| q_drag | drag | reorder | | true |

### Values

#### q_drag
```json
["step one","step two","step three"]
```

---

## Question: checkboxes

**Step:** Step k of N  
**Confidence:** 0.95

### Fields
| id | type | action | near | required |
|----|------|--------|------|----------|
| languages | checkbox | selectMany | | true |

### Values

#### languages
```json
["Python","Javascript","SQL"]
```

---

## Optional blank

**Step:** Step N of N  
**Confidence:** 1.00

### Fields
| id | type | action | near | required |
|----|------|--------|------|----------|
| optional_comments | textarea | skip | Optional | false |

### Values

#### optional_comments
```text
```

**Footer:** Back | Submit ← **stop for operator review**

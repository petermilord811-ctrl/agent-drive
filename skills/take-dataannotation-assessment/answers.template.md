# {Role} — answers for {Profile Name}

```yaml
slug: {slug}
profileDir: {path/to/profile-folder}
resume: {Resume.pdf}
problems: skills/take-dataannotation-assessment/problems/problems-{slug}.md
bioMinutes: {min: 30, max: 60}
generated: YYYY-MM-DD
status: draft | ready | filled | reviewed
# status ready = validate-answers.js ok + humanized; filled = autofill done; reviewed = operator signed off
```

> Agent: parse with `parse-answer-fill.js`. Autofill top→bottom using each leaf's **Fields** rows.
> Never Submit until operator review.

---

## Timing

| Phase | Minutes (example) |
|-------|-------------------|
| Fetch + re-catch/diff | {10} |
| Generate + humanize answers | {10} |
| Bio expected total | {30}–{60} |
| **Remaining for fill** | **{10}–{40}** |

Pace file: `answer.pace.json` (from `pace-plan.js`).

---

## Instructions

**Step:** Step 1 of N  
**Action:** agree / next only  
**Confidence:** 1.00

### UI
```text
[✅] I agree
```

### Fields
| id | type | action | value | required | thinkMs |
|----|------|--------|-------|----------|---------|
| instructions_agree | agree | click | I agree | true | (from pace) |

---

## Question 1: {exact title from problems bank}

**Step:** Step 2 of N  
**Confidence:** 0.00–1.00

### UI
```text
[ ] Solution A most closely follows programming best practices and principles
[✅] Solution B most closely follows programming best practices and principles
[ ] Solution C most closely follows programming best practices and principles
[ ] All three solutions do an equally good job following programming best practices and principles
```

### Fields
| id | type | action | value | required | thinkMs |
|----|------|--------|-------|----------|---------|
| q1_choice | radio | select | Solution B most closely follows programming best practices and principles | true | |
| q1_explain | textarea | type | {humanized short reasoning — no : ; or long dashes} | true | |

### Explanation (fill)
{Same text as q1_explain value, easy to read.}

### Why (agent note — do not type on form)
{One short internal reason. Optional.}

---

## Question 2: {title}

**Step:** Step 3 of N  
**Confidence:** 0.85

### UI
```text
[✅] Response A is more helpful
[ ] Response B is more helpful
[ ] Both responses are equally helpful
```

### Fields
| id | type | action | value | required |
|----|------|--------|-------|----------|
| q2_choice | radio | select | Response A is more helpful | true |
| q2_explain | textarea | type | {humanized} | true |

### Explanation (fill)
…

---

## Question N: short numeric / text

**Step:** Step k of N  
**Confidence:** 0.90

### UI
```text
[input] 8.7
```

### Fields
| id | type | action | value | required |
|----|------|--------|-------|----------|
| qN_value | text | type | 8.7 | true |

---

## Question: drag / order

**Step:** Step k of N  
**Confidence:** 0.88

### UI
```text
[drag order]
1. initialize an empty dictionary frequency_map
2. while n is greater than 0
3. digit = n mod 10
4. if digit is not in frequency_map keys
5. add digit to frequency_map with an initial value of 1
6. else add 1 to the value of digit in frequency_map
7. n = integer part of (n / 10)
```

### Fields
| id | type | action | value | required |
|----|------|--------|-------|----------|
| q_drag | drag | reorder | ["initialize an empty dictionary frequency_map","while n is greater than 0","digit = n mod 10","if digit is not in frequency_map keys","add digit to frequency_map with an initial value of 1","else add 1 to the value of digit in frequency_map","n = integer part of (n / 10)"] | true |

---

## Question: checkboxes

**Step:** Step k of N  
**Confidence:** 0.95

### UI
```text
[✅] Python
[✅] Javascript
[✅] SQL
[ ] Rust
```

### Fields
| id | type | action | value | required |
|----|------|--------|-------|----------|
| languages | checkbox | selectMany | ["Python","Javascript","SQL"] | true |

---

## Coding / long code

**Step:** Step k of N  
**Confidence:** 0.80

### UI
```text
[code:python]
def decode(url: str) -> None:
    ...
```

### Fields
| id | type | action | value | required |
|----|------|--------|-------|----------|
| coding_code | code | type | {full source} | true |
| coding_explain | textarea | type | {humanized 2-3 sentences} | true |

---

## Tell us about yourself — Professional Experience

**Step:** Step k of N  
**Confidence:** 0.95  
**Source:** resume only (this profile)

### UI
```text
[✅] Software Engineering
[ ] Data Science
...
```

### Fields
| id | type | action | value | required |
|----|------|--------|-------|----------|
| experience | radio | select | Software Engineering | true |

---

## Tell us about yourself — (Optional)

**Step:** Step N of N  
**Confidence:** 1.00

### UI
```text
[textarea]
(leave blank)
```

### Fields
| id | type | action | value | required |
|----|------|--------|-------|----------|
| optional_comments | textarea | skip | | false |

**Footer:** Back | Submit ← **stop here for operator review**

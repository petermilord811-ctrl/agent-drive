# Problem-bank Markdown style

Plain Markdown only. Optimized for **agents** (stable labels) and **humans** (scan + TOC).

Reference: [`problems-software-engineer.md`](./problems-software-engineer.md)

---

## 1. Document header

Split **bank** facts from **role** facts:

```markdown
# {Role} — {Assessment type} Assessment

### Bank
- **captureStatus:** nearly-full
- **Captured:** 2026-11-08 · host 34123
- **Leaves:** 11 · `assets/{slug}/sidebar-inventory.json`
- **Gaps:** …                 <!-- or omit if none -->
- **Rule:** never Submit while fetching

### Role
- **Role:** …
- **Category:** …
- **Slug:** `…`
- **Source:** DataAnnotation UI (verbatim)
```

Then a **Contents** list linking every leaf (Step k · title).

---

## 2. Parts

`---` only between:

1. Bio (page 1 + 2)
2. Assessment leaves
3. Tell us about yourself

---

## 3. Leaf title + meta

```markdown
## Step {k} · {Short title}

**Step:** Step {k} of {N}
**Section:** …                    <!-- if UI shows SECTION -->
**Type:** mcq | mcq+write-in | compare | drag | coding | form | info
**Scroll:** none | below-fold write-in | long list
```

- Heading `## Step k · …` is for humans/agents scanning.
- Keep the exact line `**Step:** Step k of N` for `reconcile-steps.js`.

### Type vocabulary

| Type | Meaning |
|------|---------|
| `info` | Instructions / certify (no answer or agree-only) |
| `mcq` | Radios/checkboxes only |
| `mcq+write-in` | Radios + explanation box |
| `compare` | Response A/B (+ write-in) |
| `drag` | Reorder / drag list |
| `coding` | Code editor / coding exercise |
| `form` | Profile / demographics |

---

## 4. Body blocks (fixed order)

Use only what exists on the step:

1. Stem (1–2 lines of UI chrome if needed)
2. **Prompt** — as a blockquote
3. `### Solution A` / `### Response A` / `### Function A` …
4. **Choice question:** (stem for the radios)
5. **Choices:** checklist `- [ ]`
6. **Write-in:** (exact prompt) + `*(empty text box)*` or `*(code editor)*`
7. `### Case: …` (answer-dependent UI only)
8. `### Notes` (fetch metadata only — never UI copy)
9. `### Assets` (paths; tag `top` / `bottom` / `figure` when useful)

```markdown
**Prompt:**

> verbatim user / chatbot request

### Response A

…

### Response B

…

**Choice question:**  
verbatim radio stem

**Choices:**

- [ ] option 1
- [ ] option 2

**Write-in:**  
verbatim explanation prompt

*(empty text box)*

### Notes

- …

### Assets

- `assets/{slug}/q1.png` — top
- `assets/{slug}/q1_bottom.png` — after PageDown
```

Pseudocode fences: ` ```text `. Real code: ` ```python ` etc.

---

## 5. Rules

- Verbatim UI only in stem / Prompt / solutions / Choice question / Choices / Write-in.
- Notes = capture metadata only.
- No HTML, no colored layout tables.
- Omitted No-LLM: `<!-- Omitted: … -->`.
- Figures: `![alt](assets/…)`.

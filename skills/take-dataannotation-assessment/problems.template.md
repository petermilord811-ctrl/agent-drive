# {Role} — {Assessment type} Assessment

### Bank

- **captureStatus:** stub | bio-only | nearly-full | full
- **Captured:** YYYY-MM-DD · host {id}
- **Leaves:** {N} · `assets/{slug}/sidebar-inventory.json`
- **Gaps:** …                 <!-- or omit -->
- **Rule:** never Submit while fetching

### Role

- **Role:** {Role}
- **Category:** {Category}
- **Slug:** `{slug}`
- **Source:** DataAnnotation UI (verbatim — do not summarize)

### Contents

1. [Bio](#bio) · [Bio (assessment intro)](#bio-assessment-intro)
2. [Step 1 · …](#step-1--)
3. …

---

## Bio

**Role:** {Role}  
**Category:** {Category}  
**Hiring cue:** {exact hiring line}

### Overview

{Exact Overview paragraphs.}

### What you'll actually do

{Exact bullets.}

### What we look for

{Exact bullets.}

### Common backgrounds

{Exact tags / list.}

### Role sidebar (page 1)

{Exact pay / location / commitment / type / payouts lines.}

### Assets

- `assets/{slug}/bio1.png`

## Bio (assessment intro)

**Title:** {exact}  
**Track line:** {e.g. Programming Projects assessment}

### Pay / hours strip

{Exact left/right strip text.}

### What it takes

{Exact bullets except any No-LLMs / anti-AI line.}

<!-- Omitted: No-LLMs / anti-AI bullet (bank rule). -->

### What happens next

{Exact bullets.}

### Assets

- `assets/{slug}/bio2.png`

---

## Step 1 · Instructions

**Step:** Step 1 of {N}  
**Type:** info  
**Scroll:** none | long list

{Exact welcome / section intros.}

<!-- Omitted: No-LLMs / integrity block (bank rule). -->

### Assets

- `assets/{slug}/instructions.png` — top

## Step 2 · {Short title}

**Step:** Step 2 of {N}  
**Section:** {e.g. SECTION 1 OF 4 | Part 1: …}  
**Type:** mcq | mcq+write-in | compare | drag | coding | form | info  
**Scroll:** none | below-fold write-in | long list

{Exact stem.}

**Prompt:**

> {exact user / chatbot request}

### Solution A

```text
…
```

### Solution B

…

**Choice question:**  
{exact radio stem}

**Choices:**

- [ ] …
- [ ] …

**Write-in:**  
{Exact explanation prompt.}

*(empty text box)*

### Notes

{Capture / case notes only.}

### Assets

- `assets/{slug}/q1.png` — top

## Step 3 · …

…

---

## Step {k} · Tell us about yourself — …

**Step:** Step {k} of {N}  
**Type:** form  
**Scroll:** none | long list

…

<!-- role: {Role} | assessmentId: {slug} | category: {Category} -->

# Part B fill — never-again contract (99588 Daniel Herman)

Evidence: live host **99588**, Data Scientist, 2026-11-08 evening + night.
If anything here conflicts with habit or improvisation, **this file wins**.

Companion docs: [`CLICK.md`](./CLICK.md) · [`PREFLIGHT.md`](./PREFLIGHT.md) · [`TIMER.md`](./TIMER.md) · [`ANSWER.md`](./ANSWER.md)

---

## 0. Host + visit (HARD)

| Rule | Why |
|------|-----|
| Use the **operator-named host** only (`host` on every serve call) | Wrong host = wrong assessment (99588 ≠ 34123) |
| Pass `host` whenever ≥2 visits have ever been open this MCP session | Serve refuses guessed hosts |
| End every work burst with `chat_wait {timeout:45000}`; re-call same turn on timeout/busy/-32001 | Cursor does not wake on SM inbox |
| Inbox → `seen` + `typing` + `chat` **before** any screen act | Editor transcript is not a reply |
| Never Submit until operator says `Submit` / yes after recheck | One-attempt assessment |
| Arm TIMER immediately after **Start assessment** | Live miss: timer never armed |

---

## 1. Measure → act (HARD)

1. `look` → measure **that** PNG → act. Never reuse stale `lx/ly`.
2. Prefer `locate-click.py`. Browse titles on OCR-blind hosts: `look-ocr.js --find "Title"` → `dbl` body `ly+55`.
3. Content clicks: `lx > sidebar_edge` (~352 @ 1280). Sidebar nav: `lx < sidebar_edge` only.
4. After every act: look prove. Same URL/step = miss → re-measure (no habitual nudge).
5. Host `clickText` / `find` when `saw` is only chrome → **forbidden**; use look-ocr / locate-click.

---

## 2. Marks that lie (HARD)

| Trap | What happens | Do instead |
|------|--------------|------------|
| SM `field ""` | Hits **Expires** chip; typing jumps / interrupts | `locate-click.py <look> textarea [i]` |
| SM text marks for Yes/No/Poor/`1` | Click lands **x≈80** (sidebar) | Content `lx` from locate/OCR, or Tab chain |
| Animated onboarding marks | Stale `same≈0.82` — mark click refused | OCR/`lx/ly` + `snap:false` |
| Prefer taller `#f8` box | Short strip above Goal was index 0 | `textarea` sorts taller first; Goal = tall box |

---

## 3. Focus prove before type (HARD) — kills scroll bug

**Bug:** `keys` with spaces while **document** focused → Space scrolls; Goal stays empty.

**Mandatory recipe for every text field:**

```
1. Focus: locate-click textarea click  OR  content-label click → Tab (×N until caret in box)
2. Prove: keys one letter/digit with NO space → look — char MUST appear in the target box
3. Clear: Backspace only (never Ctrl+A — selects whole assessment page)
4. Type: keys in ~80-char chunks, never human:0
5. After each chunk: if viewport jumped (e.g. Section 3) → recover → re-focus → prove → append
```

Proven Tab chains (99588):

| Field | Focus that worked |
|-------|-------------------|
| Conversation Goal | Click “Conversation Goal” / content near label → Tab |
| Round number | Click Notes/content → Tab×2 |
| Failure describe | Describe heading → Tab (prove X) |
| Performance rationale | Rationale / “sentences” heading → Tab (prove X) |

If prove fails: **stop typing**. Re-focus. Never “just send the answer.”

---

## 4. Clipboard / keys bans (HARD)

| On DA task page (`app.dataannotation.tech/.../tasks/...`) | Outside-link fetch tab only |
|----------------------------------------------------------|-----------------------------|
| **Forbidden:** Ctrl+C, Ctrl+V, Ctrl+A | Ctrl+L → Ctrl+C address bar OK |
| Fill with `keys` only | Read clipboard via `exec` (`xclip` / `Get-Clipboard`) |
| Linux guest `exec` ≠ Windows host clipboard | Do not assume `Get-Clipboard` works on Linux guest |

Share URL: type with `keys` into DA field — never paste on the assessment page.

---

## 5. Small targets / snap (HARD)

- `aim:false` **still snaps** onto nearby field/button (+~180px live miss).
- Always: `click { lx, ly, of, snap:false, aim:false }` for checkboxes and tight hits.
- Checkbox recipe: `look-ocr.js --find "<label>"` on **current** look → `lx ≈ bbox.x0 - 16`, `ly ≈ bbox mid` → snap:false → look prove (checked / error gone).
- Wrong **Y** looks like a “miss” — re-OCR; do not reuse heading Y for the agree row.

---

## 6. Radios / scroll / chrome (HARD)

- Radios: `locate-click.py radios` (choice cluster) → `radio N`. Never `radios-raw` for fill.
- Prefer **sidebar leaf** over sticky Next when jumping steps.
- **Toolbar “Scroll to Bottom”** can jump to Submit footer — forbidden for navigation; use content focus + PageDown.
- Wheel `scroll {n}`: **prove direction with a look** after first nudge (99588: negative `n` scrolled the form down). Prefer PageDown after content focus when unsure.
- Long `keys` may exceed MCP 35s — wait for late `answeredLate`; do not double-type.

---

## 7. Humanize (HARD)

- Relay only: `POST /api/humanize` with `x-sm-join-key` = `SM_JOIN_KEY`, or verb `humanize`.
- **Never** `.env` `HUMANIZE_API_KEY`, Bearer, or wisdom324.
- On 429: backoff. Prefer `style=standard` if formal truncates; scrub banned punctuation after.

---

## 8. Live UI vs bank (HARD)

- Prefer **on-screen** model name / wording over bank when they differ (Haiku 5.5 bank vs 3.5 live).
- Selecting failure **Yes** can reveal **extra fields** not in an incomplete bank:
  - round number (integer)
  - describe meaningful failure (3+ sentences)
  - screenshot upload
- If bank lacks them: draft from conversation theme, fill live, then **patch bank + answer.fill** before next take.
- Share URL + screenshot require a **real Claude conversation** (Haiku, Effort Low per live Instructions). Onboarding may show plans → “Use Claude for free” → desktop Skip — complete those, then chat, share, type URL with keys.

---

## 9. Autofill checklist (every field)

```
[ ] correct host
[ ] TIMER armed if post-Start
[ ] look current
[ ] measure (locate-click / look-ocr) — no invented coords, no Expires mark
[ ] content lx > sidebar_edge (or Tab from content)
[ ] snap:false for small targets
[ ] focus prove (non-space char in box)
[ ] Backspace clear if needed
[ ] keys chunks; no Ctrl+V/C/A; no human:0
[ ] look prove value
[ ] chat_wait before ending turn
```

---

## 10. Regression gate

Before claiming Part B ready on a profile:

```bash
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full
node skills/take-dataannotation-assessment/answer-ready.js --slug <slug> --profile "{profile}" --strict-full
```

Agent must have read this file + [`CLICK.md`](./CLICK.md) in the same session before first Part B `keys` on a live host.

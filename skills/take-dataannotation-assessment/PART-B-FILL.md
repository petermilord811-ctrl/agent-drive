# Part B fill — never-again contract (99588 Daniel Herman)

Evidence: live host **99588**, Data Scientist, 2026-11-08 evening + night.
If anything here conflicts with habit or improvisation on **field focus / keys**, **this file wins**.
For **phase order** (Claude → Share → fill → one recheck → Submit), **[`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md) wins**.

Companion docs: [`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md) · [`CLICK.md`](./CLICK.md) · [`PREFLIGHT.md`](./PREFLIGHT.md) · [`TIMER.md`](./TIMER.md) · [`ANSWER.md`](./ANSWER.md) · [`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md)

---

## 0. Host + visit (HARD)

| Rule | Why |
|------|-----|
| Use the **operator-named host** only (`host` on every serve call) | Wrong host = wrong assessment (99588 ≠ 34123) |
| Pass `host` whenever ≥2 visits have ever been open this MCP session | Serve refuses guessed hosts |
| End every work burst with `chat_wait {timeout:45000}`; re-call same turn on timeout/busy/-32001 | Cursor does not wake on SM inbox |
| Inbox → `seen` + `typing` + `chat` **before** any screen act | Editor transcript is not a reply |
| **MUST — Never Submit** until operator explicit `Submit` / `yes` after recheck (silence ≠ yes) | One-attempt assessment; always |
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

**Kate / editor overlay (99588):** leftover Kate centered on screen steals clicks+keys; prove chars never appear in DA. `windows` → minimize/close editor (`xdotool windowminimize`) → `focus` Chrome → re-click field → prove again before typing.

**Empty answer boxes:** `locate-click.py … textarea` may return label/prompt slabs (fill248) not the real caret box. Crop/look for the white empty rectangle under the question line; click **inside** it (often ~30–50px below the “Question Na” instruction), then prove.

**99588 rubric empty-box recipe (worked):** `ocr {rect, boxes:true}` on the placeholder row → click screen `x≈440`, `y ≈ placeholder_y + 30..40` with `snap:false, aim:false` (center of white field, not the gray placeholder words). Blue border = focused. Prove with one non-space letter → Backspace → `keys` chunks. Placeholder-label mark click alone often fails prove.

**Upgraded locator (2026-11-09):** prefer
`python -I …/locate-click.py <look.png> textarea --near "first rubric"`
(or `textarea` / `textarea N`). Returns caret `lx/ly` + `prove:letter` + `snap:false`. Pass-3 soft/#f8 scoring rejects prompt slabs; min height 20px catches single-line Optional; `--near` uses look-ocr.js. Still **letter-prove** before spaces — geometry ≠ focus.

---

## 4. Clipboard / keys bans (HARD)

| On DA task page (`app.dataannotation.tech/.../tasks/...`) | Outside-link fetch tab only |
|----------------------------------------------------------|-----------------------------|
| **Forbidden:** Ctrl+C, Ctrl+V, Ctrl+A | Ctrl+L → Ctrl+C address bar OK |
| Fill with `keys` only | Read clipboard via `exec` (`xclip` / `Get-Clipboard`) |
| Linux guest `exec` ≠ Windows host clipboard | Do not assume `Get-Clipboard` works on Linux guest |
| **Never `xdotool type` / machine type for form text** (99588 operator hard rule) | Focus with click/xdotool mousemove+click OK; **type only via ScreenMirror `keys`** |
| **Why:** live undo log showed `xdotool type` / `ctrl+a` / sleep wrappers in exec — those produced `xsleep…` garbage in DA fields and forced rewrite | If tempted to “speed up” with machine type: **stop**. SM `keys` is the only legal typer |

Share URL: type with `keys` into DA field — never paste on the assessment page.

**Garbage prefix in DA text (`xsleep0.3xZ…`):** treat as field corruption — select in-field (`Ctrl+Home` then `Ctrl+Shift+End`, never page-wide Ctrl+A) → Delete → retype clean answer with `keys`. Re-verify share URL still intact after rewrite.

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
- Share URL + screenshot require a **real Claude conversation** (Haiku, Effort Low per live Instructions). **Identity first:** see [`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md) — same email/name as DataAnnotation; **never** Continue with Google on a leftover session. Onboarding may show plans → “Use Claude for free” → desktop Skip — then chat, share, type URL with keys.
- **Claude composer (99588):** Enter = **Send**; newlines = **Shift+Enter**. **Ctrl+V is OK on Claude** for long prompts; still **never** Ctrl+V on the DA assessment page. Do not `keys` a multi-line prompt with bare `\n` into Claude.

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

---

## 11. Why fill took forever (99588 postmortem — answers already prepared)

**Root cause:** fill was treated as exploratory UI recovery, not a scripted replay of `answer.md` Fields. Answer text was ready; time burned on failed focus / wrong navigation / re-verification loops.

| Time sink | What happened | Fast path next time |
|-----------|---------------|---------------------|
| Unproven focus + spaces | `keys` with spaces while document focused → page scrolls to Section 3; text lost | Letter/digit prove **before** any space; stop on fail |
| Placeholder-mark click | Mark `"Enter your first rubric"` hit label; prove `D` never appeared | `ocr {boxes:true}` → click white box `y≈placeholder+35`, `snap:false aim:false` |
| Expires chip stale | Timer ticks → `same≈0.83` refuses lx/ly clicks | Prefer **mark** click immediately on fresh look, or `snap:false aim:false` screen xy |
| PageUp / Scroll hunting | Dozens of PageUp to re-find Q3 after scroll bug | After recover: `Back to Top` → PageDown **counted** to known section, or OCR-jump |
| `find` / `clickText` chrome-blind | Titles/address bar only in `saw` | Forbidden for DA body; look-ocr / marks / locate-click |
| Wheel `scroll {dy}` / `of` | API refuse; wrong axis | `scroll {x,y,n}` only; prefer content focus + PageUp/Down |
| `xdotool type` temptation | Operator hard ban | **Only** SM `keys` (auto-type) for form text |
| `xsleep0.3xZ` garbage in rationale | Corrupted prefix / truncated sentence | In-field select (`Ctrl+Home`→`Ctrl+Shift+End`) → Delete → retype; never page Ctrl+A |
| Re-verify whole form after each field | Extra PageUp tours | Prove field → next Field row; one end-to-end verify before Submit ask |
| Long `keys` human typing | 300+ char fields ≈ 30–50s each | Expected; chunk ~80 chars; do **not** double-type on late answers |

**Fill budget target (prepared answer):** measure+prove+type per field ≤ 2–3 min; whole Part B fill ≤ ~25–35 min once Claude share URL exists. Exceeding that = focus/nav regression, not “thinking.”

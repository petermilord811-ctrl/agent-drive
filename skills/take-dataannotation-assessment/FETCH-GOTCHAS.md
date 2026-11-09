# Part A fetch gotchas — never again

Live misses from **99588 / Daniel Herman / Data Scientist** (2026-11-08).  
Read this before writing a single line into `problems-{slug}.md`.

## 0. Non-question UI cards are leaves too (Finance/Legal 2026-11-08)

**Root cause of “Section 1 intro missing from md”:** fetch treated only *scored* prompts (Q1–Q7, Experience radios, Conversation Goal) as bankable. The **Section 1 header card** (“Why does this assessment include general questions?” / “Every assessment is reviewed by a person.”) was paraphrased to one line or skipped — operator saw full copy on screen, md had none.

| Do | Don't |
|----|-------|
| Bank **every** main-pane card on a leaf: section headers, “why this assessment…”, review notices, recap blocks, exclusive-option notes | Paraphrase shared intros as “early questions focus on general reasoning…” |
| On **Section 1** first visit: shot + **verbatim** the intro card **before** Q1 stem | Jump straight to Q1 stem and assume intro is “boilerplate” |
| Treat Expert Domain Section 1 intro as **shared** — still paste full copy (or link `ASSESSMENT-TRACK-DIFF.md` Shared section) into **each** major’s md | Omit because “same as Finance/Generalist” |
| Include intro/header cards in leaf inventory / reconcile checklist | Count only radio/write-in steps toward “nearly-full” completeness |

**Gate:** for any Expert Domain major, `problems-*.md` Section 1 must contain the **Why general questions** + **reviewed by a person** blocks verbatim (or an explicit `*(see ASSESSMENT-TRACK-DIFF Shared Section 1 intro)*` pointer with the full text living in one canonical file). Paraphrase-only = **not** nearly-full for that leaf.

## 1. Bank shape — structured only (never `Source OCR`)

| Do | Don't |
|----|-------|
| STYLE blocks: **Prompt** / `### Response A` / **Choices** / **Write-in** | A `Source OCR` / raw dump section |
| Dirty OCR → PNG under `assets/{slug}/` + leave prose empty | Invent clean English from garbled OCR |
| `validate-verbatim.js --slug …` exit 0 before `full` | Mark `full` with Gaps that still say OCR/summary |

## 2. OCR method — no select / no vision-as-text

| Do | Don't |
|----|-------|
| `look` → band-OCR (`ocr-bands.py` / `upscale-ocr.js`) on the **look PNG** | Select / highlight UI text “for better OCR” |
| Host `ocr {rect}` only when it matches the **visible** pane | Trust host `ocr` after scroll when it still returns **Instructions** |
| Treat image/vision descriptions as **hints** | Paste `image_description` / “approx 50%” as problem body |
| Cross-check money / model names with band-OCR (`$50+`, **Haiku 5.5**) | Trust vision when it says `$40+` or Haiku 3.5 against OCR |

**Stuck host OCR:** after any scroll, if `ocr {rect}` text is still the top Instructions block → **stop using host ocr**. Switch to look PNG band-OCR for that viewport.

## 3. Figures — full axes in frame

| Do | Don't |
|----|-------|
| Scroll until chart **title + y-axis + x-axis labels** are all visible | Crop from a half-scrolled look |
| Save `qN-chart.png` + full-viewport `qN-live.png` | Replace a figure with a prose paraphrase of bars |
| Gate: `validate-figures.js --slug …` | Mark `full` with a 200px-tall “chart” crop |

**DS miss:** `q1-chart.png` cut off before `First-time Visitor Purchases` / `10 or more`. Re-crop from a look where the full figure is in-frame.

## 4. Scroll / chrome

| Do | Don't |
|----|-------|
| Focus **content pane** → **PageDown** / End | Assume browser PageDown scrolled the problem |
| `locate-click.py <look> scroll-complete` before leaving a leaf | Trust sticky Next / “Scroll to Bottom” alone |
| Pass `host:"#####"` on **every** agent-drive call once ≥2 visits are open | Call without `host` (server refuses / wrong machine) |

## 5. Listen loop (Cursor ≠ ScreenMirror)

While the visit is live: end every burst with `chat_wait {timeout:45000}` and **re-call same turn** on timeout. Ending the Cursor turn = deaf (operator chat lands; you never wake).

## 6. Gates before `captureStatus: full`

```bash
node skills/take-dataannotation-assessment/validate-verbatim.js --slug <slug>
node skills/take-dataannotation-assessment/validate-figures.js --slug <slug>
node skills/take-dataannotation-assessment/reconcile-steps.js --slug <slug> --sidebar-json problems/assets/<slug>/sidebar-inventory.json
```

`answer-ready.js --strict-full` runs the first two automatically.

## 7. Never Submit while fetching

Footer **Submit and Begin Next Task** / **Clear Response** / **Exit Work Mode** — look only; do not press.

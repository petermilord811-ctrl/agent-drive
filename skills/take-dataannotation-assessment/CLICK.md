# Click mechanism (DataAnnotation) — mandatory

Mis-clicks on host **34123** were not random. They came from a broken targeting model.
This file is the contract. **Do not invent `lx/ly`.**

## Failure analysis (what actually broke)

| Bug | What happened | Root cause |
|-----|---------------|------------|
| **Sidebar/content collision** | Click `~(320,327)` on employees jumped to **Question 5** | Left-nav and content radios share the same Y band; guessed x≈320 is **nav**, not the option column (~476) |
| **Stale Next Y** | Next “clicked” but step did not advance | Footer Y drifts **588→660** with content height; reused coords |
| **Wrong role card** | `role "Data Scientist"` returned Software Engineer | Old `role` mode always picked **first ink band (col 0)** |
| **Gray titles / merged bands (99588)** | `role` → `cards:[]` / missing col-2 DS | Titles mean~103 > `DARK=90`; full-width ink merged 3 titles (`bw>380`) — use `CARD_TITLE_DARK` + x-segment split |
| **Heuristic dbl miss** | Aimed DS col2, SE Bio opened | Never guess lx/ly; re-run `role` on **current** look |
| **Card single-click** | Browse card click `ok` but page unchanged | Cards need **`dbl` on body**, not title ink / single click |
| **OCR blind (99588)** | `clickText` / `find` only chrome | Host OCR useless — use **`look-ocr.js`** (local WinOCR) on the look PNG |
| **Browse DS miss** | Grid synthesize lx≈1015 no-op; real title **781,408** | `look-ocr.js --find "Data Scientist"` → dbl body ly+55 |
| **Start CTA miss** | `start` failed on DS Bio2 | Button ~83px wide lower-left — finder now accepts w≥70 |
| **Radio false hits (SE Q1)** | `radios` returned **13** hits (code dots) for 4 choices | Hollow-ring detector matches monospace/code UI; use choice cluster |
| **Radio / textarea miss** | Selection or typing failed | Hollow rings need geometry; textareas need **`locate-click.py textarea` → keys** (or radio → Tab → keys) |
| **Empty Goal mark = Expires (99588)** | `field ""` mark hit **Expires** chip (~1746,1017); typing interrupted / jumped to Section 3 | Never trust blank SM marks for DA textareas — `locate-click.py <look> textarea [i]` on **that** look |
| **Auto-type scrolls to Section 3 (99588)** | `keys` with spaces while **document** focused scrolls the page; Goal stays empty | **Prove focus first:** after `textarea` click (or label→Tab), type a single letter (no space) → look — letter must appear in the box. Only then `keys` the full answer. Spaces on body scroll = this bug |
| **Ctrl+C / Ctrl+V on DA task page (99588)** | Clipboard shortcuts while assessment is open | **Forbidden** on any DataAnnotation task page. Fill with `keys` only. Ctrl+L/C only on outside-link tabs during Part A fetch |
| **Checkbox miss / text-select (Claude onboarding 99588)** | Aimed wrong Y; or `aim:false` still **snapped** onto nearby field/button | 1) `look-ocr.js --find "agree"` (or label) on **current** look → checkbox ≈ `bbox.x0 - 16`, same `ly`. 2) `click {lx,ly,of,snap:false,aim:false}`. Never trust mark clicks for small checks. Prove with look (checked / error gone) before Create |
| **SM content marks → sidebar (99588)** | Mark “O Yes” / “O Poor” / “1” clicked at **screen x≈80** | Marks lie for content radios/digits — use locate-click `lx > content_x_min` or content→Tab |
| **Short #f8 above Goal (99588)** | Typed into wrong / unfocused strip; Goal empty | `textarea` prefers **taller** box first; prove focus in Goal |
| **Wheel direction (99588)** | `scroll n` went opposite of assumed | Prove with look after first nudge; prefer content focus + PageDown |
| **Long keys timeout (99588)** | MCP “no answer in 35s” while keys still running | `pause` / wait for `answeredLate`; do not re-type |
| **OCR trust** | `clickText` / `find` aimed at chrome | On 34123/99588 host OCR often only browser chrome |

**Full Part B contract:** [`PART-B-FILL.md`](./PART-B-FILL.md) — read before first live `keys`.

## Hard rules (every click)

1. **`look` → measure on THAT png → click/dbl.** Prefer `locate-click.py`. On OCR-blind hosts for **Browse role titles**, use `look-ocr.js` first.
2. **Read `zones` / `sidebar_edge` / `content_x_min`.** Content modes must never return `lx ≤ sidebar_edge`.
3. **Obey `action`:** `"dbl"` means double-click (Browse cards). `"click"` means single.
4. **After click: look again.** Same step/URL = miss → re-measure (do not nudge by habit).
5. **Do not dense-sweep the left third** of an assessment look — that is the sidebar.
6. Never trust host `clickText`/`find` when `saw` is only tab titles.
7. Small targets: always **`snap:false` + `aim:false`** (`aim:false` alone still snaps).
8. Never trust SM blank `field` or content radio marks that resolve to **x≲100**.

```bash
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> zones
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> continue
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> next
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> back
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> start
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> radios          # MCQ choice cluster (default)
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> radios-raw      # debug: unclustered rings
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> radio 2           # index inside choice cluster
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> sidebar 4
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> role "Data Scientist"
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> textarea      # empty Goal / explain boxes
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> textarea 1    # 2nd box on page
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> scroll-complete
# When host OCR is blind (Browse cards):
node skills/take-dataannotation-assessment/look-ocr.js <look.png> --find "Data Scientist"
```

Regression: `python -I skills/take-dataannotation-assessment/test-locate-click.py`

## Mode reference

| Mode | Use for | Safety |
|------|---------|--------|
| `zones` | Print sidebar/content split | Read before guessing |
| `continue` | Bio-1 right-rail Continue | Right rail only |
| `next` | Assessment footer Next | Lowest compact blue, **x > 0.55w**, re-measure every page |
| `back` | Assessment footer Back | Content-left footer |
| `start` | Bio-2 Start assessment | Large blue CTA |
| `radios` / `radio N` | MC / agree options | **Choice cluster** in content (not code-dot noise); `lx > content_x_min` |
| `radios-raw` | Debug only | Unclustered ring hits — do not autofill from this |
| `sidebar N` | Jump assessment left-nav | **Only** left of sidebar_edge |
| `role "Title"` | Browse card | Returns **`action: dbl`** on card **body**; refuses ambiguous titles instead of defaulting to col 0 |
| `textarea` / `textarea N` | Empty Goal / explain boxes | Content white boxes only; **never** SM blank `field` marks (Expires false hit) |

## Proven geometry (@ look 1280×720)

| Target | Safe hit |
|--------|----------|
| Content option radios (employees / Q1) | column **lx ≈ 476–500**, never ≤340 |
| Assessment Next | **lx ≈ 986**, **ly ≈ 644–670** (re-measure) |
| Bio Continue (SE) | **≈ 834,312** |
| Browse SE card | **`dbl`** body ~ title+(0,55) |
| Forbidden | any content click with **lx ≤ sidebar_edge** (≈352) |

## Autofill (Part B)

Same click stack as fetch. After `answer.fill.json` + `answer.pace.json` exist ([`ANSWER.md`](./ANSWER.md)):

1. `pause { ms: thinkMs }` from pace (first field/step 10–30s+, later ~5–15s+).
2. Radio/checkbox: `locate-click.py <look> radio N` / label — never sidebar.
3. Text: Prefer **content click → Tab into field** when direct `textarea` click fails focus (99588 live: Goal via label→Tab; round via Notes→Tab×2). Prove focus with one non-space letter → look. Then **Backspace** clear (never Ctrl+A) → `keys` in **~80-char chunks** (never `human:0`, never Ctrl+V on DA pages). After each chunk, if viewport jumped → re-measure → append. Never click SM `field ""` near Expires. **SM content marks often click at x≈80 (sidebar)** — do not trust mark clicks for Yes/No/Poor/“1”; use `locate-click` lx>content_x_min or Tab.
4. Look after each action. Never Submit during fill.

## Agent recipe (assessment step)

```
1. look → out=qN.png
2. locate-click.py qN.png scroll-complete
3. while need_scroll:
     click content pane (lx≈scroll_lx, ly≈scroll_ly) to focus
     press PageDown n=3–5  (wheel alone often no-ops on DA panes)
     look → scroll-complete again
4. when ok (or proven no Explanation): look → out=qN_bottom.png
5. locate-click.py … radios / radio i / next as needed
6. writing field: radio → Tab → keys
7. never Submit
```

**HARD:** Sticky **Back/Next** can be visible while **Explanation** / more checkboxes are
still below the fold (SE Q2; SE Programming Languages cut off after TypeScript).
`next` ok ≠ step fully fetched. Always run `scroll-complete` before leaving; save top +
bottom PNGs. Prefer **focus + PageDown** over bare wheel. For long checkbox lists, keep
PageDown until the **last** option sits above the sticky footer (not mid-cut).

## Links / URLs (HARD)

OCR of long URLs (Google Docs `/pub`) is **wrong often**. Do not bank OCR’d URLs.

**Clipboard is ONLY for external link address bars — never for problem text.**

**Forbidden:** `Ctrl+A` / select-all / copy of the assessment page (or Response A/B panels) to “capture” problems. Capture problems by reading the screen (look + scroll + PNGs / typed transcription).

**Allowed clipboard path (outside links only):**
1. **Click** the link (opens a new browser tab).
2. On that tab: **Ctrl+L** (address bar) → **Ctrl+C**.
3. Read clipboard: `exec` → `xclip -selection clipboard -o` (Linux) / `Get-Clipboard` (Windows).
4. Close the extra tab. Optional: `*_url.png` crop of the address bar.

If the URL is plain text (not an `<a>`), bank the on-screen string — do not invent a click→tab flow.

Figures (letter-F example): crop PNG and `![…](assets/…)` — never paraphrase.

If `next` succeeds geometrically but UI does not advance twice: use `sidebar N` to jump — do not hammer Next.

## Sidebar inventory (HARD)

Before leaving an assessment fetch:

```
1. OCR/list leaf rows → assets/{slug}/sidebar-inventory.json  (total = N)
2. Walk leaves in order — do not jump Coding ahead of unanswered Questions
3. node …/reconcile-steps.js --slug <slug> --sidebar-json …/sidebar-inventory.json
4. ok must be true (no missing / dupes / outOfOrder)
```

SE example: 11 leaves. Bank that lists Q5 after Coding fails `outOfOrder` even if Q5 text exists — that is a skipped step in fetch order.

## Bank / verbatim

Captures → `problems/problems-{slug}.md` only (103 roles). Verbatim rules in skill README.

```bash
node skills/take-dataannotation-assessment/validate-verbatim.js --slug <slug>
# must exit 0 before captureStatus: full
```

**Never** bank OCR/vision “repairs” in square brackets. Unclear → PNG asset only.

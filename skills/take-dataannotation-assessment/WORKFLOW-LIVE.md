# Live Part B workflow — end-to-end (HARD)

Evidence: host **99588** / Daniel Herman / Data Scientist — 2026-11-08 full night try
(Claude identity → Round 1+2 → Share → DA fill → sign-off).

## MUST — Never Submit until operator yes

**Always.** Fetch, fill, recheck, sign-off, study mode — **never** click Submit / “Submit and Begin Next Task” unless the operator explicitly replies **yes** / **Submit** after review. Silence, “looks good”, or budget end ≠ yes. This overrides every other step.

## MUST — Full name + email before anything else

Operator must supply **Full name** (First + Last) and **Email** (DA account) at the start. Missing either → ask once and wait. Never invent. Used for Claude identity ([`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md)) and DA matching.

**This file is the runbook.** Companions hold detail; if habit conflicts with this runbook, **this wins for sequencing**.

| Phase detail | Doc |
|--------------|-----|
| Offline gates / listen loop | [`PREFLIGHT.md`](./PREFLIGHT.md) |
| Click geometry | [`CLICK.md`](./CLICK.md) |
| Field focus / keys bans | [`PART-B-FILL.md`](./PART-B-FILL.md) |
| Claude identity + composer | [`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md) |
| Playbook + timer | [`ANSWER.md`](./ANSWER.md) · [`TIMER.md`](./TIMER.md) |
| Answer text | `{profile}/answer.md` **Fields + Values** (agent-v2) or `answer.fill.json` |

---

## Pipeline (do in order — do not invent phases)

```
0  Identity          require Full name + Email from operator (ask once if missing)
0a Auto-pick role    ALWAYS from resume via prepare-answer (no --slug) unless operator says they will pick manually
0b Complete bank     if problems-{slug}.md missing or not full|verified → Part A fetch that slug first (verbatim, never Submit) until bank ready; then continue
0c Offline answers   answer.md + meaning cards + answer-gates green
0d Offline ready     prepare-answer --strict-full → autofill-ready
1  Connect           operator-named host only; host= on every call
2  Open picked role  Browse → session.role only (do not invent another card)
3  Start + TIMER     Start assessment → arm status/mission BEFORE first field
4  Claude gate       CLAUDE-SETUP with that DA email/name → Haiku Effort Low
5  Chat + Share      Round 1 (+ Round 2 if no fail) → Anyone with the link → copy URL
6  Fill DA           answer.md Fields top→bottom; prove→keys; never Submit
7  One recheck       Back to Top → walk required fields once
8  Operator review   chat summary → chat_wait → Submit ONLY on explicit yes
9  Sign-off          status fin + shot; disconnect when operator says so
```

**0b is automatic.** Do not wait for the operator to say “fetch first.” Missing/incomplete bank → complete `problems-{slug}.md` before any `answer.md` or live fill.

**Budget (answers already prepared):** Claude gate+share ≤ 20–30 min · DA fill ≤ 25–35 min · recheck ≤ 5 min.
Exceeding fill budget = focus/nav regression, not “thinking harder.”

---

## 0. Offline ready (HARD)

```bash
# ALWAYS auto-picks from resume; --slug only after operator says they will pick manually
node skills/take-dataannotation-assessment/prepare-answer.js --profile "{profile}" --strict-full
```

Use `session.slug` / `session.role` everywhere after this. **Always auto-pick** — do not ask “which assessment?” Override only when the operator says they will pick manually (then use their role / `--slug`).

If `session.phase === blocked` / bank missing / not `full|verified`: **complete Part A fetch for that slug first** (verbatim, never Submit), then re-run prepare-answer. Do not skip to answers or fill.

Pass only when `session.phase === autofill-ready` and:

- `answer.md` agent-v2: every required Fields row + Values fence (Failure Yes extras included)
- Claude Round 1/2 as `type: claude` Values (`claude_round1` / `claude_round2`)
- `answer-gates.py --profile … --run-aicheck` exit **0** (Meaning∧Quality∧Detect) — not aicheck alone; not Claude prompts
- `prepare-answer.js` re-checks gates; **`gates-pending` = do not fill**
- `answer.fill.json` + `answer.playbook.json` + `answer.pace.json` exist (`near` on textareas when useful)
- Share URL Values fence filled after live chat

Do **not** open the live assessment to “figure out answers.”

---

## 1. Connect (HARD)

| Rule | Fail mode if broken |
|------|---------------------|
| Only the **operator-named** host | Wrong assessment / wrong person |
| `host` on **every** serve call | Refuse / guess when ≥2 visits ever open |
| `seen` + `typing` + `chat` before screen acts when `inbox.n > 0` | Operator thinks you are deaf |
| End every burst with `chat_wait {timeout:45000}`; same-turn retry on timeout/busy/-32001 | Cursor does not wake on SM inbox |

---

## 2. Start + TIMER (HARD)

1. Agree / Start assessment (locate-click / marks — never invent lx/ly).
2. **Immediately** arm [`TIMER.md`](./TIMER.md) (`status`/`mission` + `answer.timer.json`).
3. Skipping the panel timer = workflow fail even if answers are perfect.

---

## 3. Claude gate (HARD) — before any DA Section 1 share field

Full tree: [`CLAUDE-SETUP.md`](./CLAUDE-SETUP.md).

Minimum gate:

1. Wrong leftover session → `https://claude.ai/logout`
2. **Never** Continue with Google / Continue as \<other\>
3. DA email path → magic-link via `open {url}` (preserve `#`)
4. Prove “Email verified as \<DA email\>” / welcome name matches DA
5. Model: **Haiku** + **Effort Low** per live Instructions (prefer live UI over bank)

### Composer (Claude ≠ DA)

| | Claude.ai | DA assessment page |
|--|-----------|--------------------|
| Enter | **Sends** | field dependent |
| Newline | **Shift+Enter** = `chord {mod:"ShiftLeft", code:"Enter"}` | OK |
| Ctrl+V | **Allowed** (prefer for long Round 1) | **Forbidden** |

**Fast Round 1:** Kate/editor on guest → `keys` full prompt (bare `\n` OK there) → Ctrl+A/C → Claude Ctrl+V → prove blank line before `Setup` → Enter to send.

**Never** `keys` a multi-line prompt into Claude with bare `\n` / Enter (sends early / collapses).

Round 2: only if Round 1 did **not** meaningfully fail the leakage point. Then Share → **Anyone with the link** → copy public URL.

---

## 4. Fill DA — scripted replay (HARD)

**Mental model:** you are a **tape player** for `answer.md` Fields, not an explorer.

For each Field row in order:

```
look → measure → focus → PROVE (1 non-space char in target) → Backspace prove
     → keys ~80-char chunks (SM auto-type only) → look prove value → next row
```

### Typer law (operator 99588)

- **Only** ScreenMirror `keys` (human/auto-type) for DA form text
- **Never** `xdotool type` / machine type / sleep-wrapped shell typers
- Live undo proved `xdotool type` + `ctrl+a` produced `xsleep0.3xZ…` garbage and forced rewrites

### Focus law

| Symptom | Cause | Fix |
|---------|-------|-----|
| Page jumps to Section 3 while typing | Document focused; Space scrolls | Stop; re-focus; letter-prove; never continue |
| Prove letter missing | Clicked placeholder label / overlay / Expires | Empty-box OCR click or label→Tab; minimize Kate |
| Mark “Yes/Poor/1” → sidebar | SM content marks land x≈80 | locate-click content lx or Tab |
| Blank `field ""` | Expires chip | locate-click `textarea` / OCR white box |

### Empty rubric / Goal boxes (proven 99588)

1. `ocr {rect, boxes:true}` on placeholder row  
2. Click **white interior** `y ≈ placeholder_y + 30..40`, `x` mid-field, `snap:false aim:false`  
3. Blue border = focused → prove letter → Backspace → `keys`  
4. Placeholder-text mark alone often **fails** prove

### Clipboard law

| Page | Ctrl+C/V/A |
|------|------------|
| DA task URL | **Forbidden** |
| Claude / Kate / outside fetch tab | OK as documented |

Clear field: Backspace, or in-field `Ctrl+Home` → `Ctrl+Shift+End` → Delete (**never** page-wide Ctrl+A).

### Navigation law

- Prefer sidebar leaf / content focus + PageDown|PageUp
- **Toolbar “Scroll to Bottom”** → Submit footer risk — avoid for nav
- Wheel `scroll`: only `{x,y,n}` (no `dy`, no `of`); prove direction with a look
- After a scroll bug: `Back to Top` → counted PageDown to section — **not** endless hunting mid-form

### Radios / small targets

- `locate-click.py radios` → `radio N` (never `radios-raw`)
- Checkboxes: OCR label → click left of bbox; always `snap:false` + `aim:false`

### Failure Yes extras

If UI shows round / describe / screenshot after Yes: fill them; patch bank + `answer.fill` if missing.

Share URL: type with `keys` into DA (never paste on assessment).

---

## 5. One recheck (HARD)

Do **not** full-page verify after every field (that doubled 99588 fill time).

After last required field:

1. `Back to Top`
2. Walk required leaves once (sidebar or counted PageDown)
3. Confirm: share URL exact, no `xsleep`/garbage prefixes, both rubrics, Q4 choice, S3 filled
4. Optional blank OK

Then chat:

> Filled + rechecked. Reply **Submit** or tell me what to fix.

`chat_wait` loop. **Submit only on explicit yes.**

---

## 6. Corruption recovery

If a field shows `xsleep…` / truncated mid-sentence / wrong paste:

1. Focus field → prove  
2. `Ctrl+Home` → `Ctrl+Shift+End` → Delete  
3. Retype clean `answer.md` value with `keys`  
4. Re-check **neighbor** fields (share URL often sits under rationale)

---

## 7. Sign-off / study

When operator says sign off / study:

1. Encode new bugs into [`PART-B-FILL.md`](./PART-B-FILL.md) §11 + this file if sequencing changed  
2. `status {fin:1, say, file}` + shot/chat-img when visit still live  
3. `disconnect` only after they are finished  
4. **Never Submit** on the way out unless they already said yes

---

## Anti-patterns (99588 night — never again)

| Anti-pattern | Cost |
|--------------|------|
| Explore UI instead of Fields order | Hours |
| Type without letter-prove | Scroll wipe + re-find |
| `xdotool type` to “go faster” | Garbage text + operator ban |
| Paste Round 1 into Claude with bare Enter/`\n` | Fragmented send / no blank line before Setup |
| Continue as leftover Google | Wrong identity share trail |
| Full re-verify after every textarea | 2–3× fill time |
| End Cursor turn while visit live | Deaf to operator inbox |
| Submit without yes | One-attempt assessment burned |

---

## Agent session start checklist

```
[ ] Read WORKFLOW-LIVE.md + PART-B-FILL.md + CLAUDE-SETUP.md this session
[ ] prepare-answer --strict-full → autofill-ready
[ ] Connect operator host; host= every call
[ ] Start → TIMER armed
[ ] Claude identity gate passed (look prove DA name)
[ ] Haiku + Effort Low; Round 1 (+2); Share Anyone; URL in clipboard/memory
[ ] Fill Fields with prove→keys only; no xdotool type; no Ctrl+V on DA
[ ] One recheck → ask Submit → chat_wait
[ ] No Submit until yes
```

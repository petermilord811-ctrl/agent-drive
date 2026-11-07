---
name: Create a DataAnnotation account
when: sign up a DataAnnotation.tech worker account from resume/full name/email — open worker_signup, fill First/Last/Email, ask for password (chat or self-type), Terms, solve reCAPTCHA (agent by default), Create an account; big step 1 of DA assessment workflow
tags: browser, forms, dataannotation, signup, captcha, firefox, mission
run: node skills/create-dataannotation-account/fast-pre-captcha.js ./work --first F --last L --email E --password P
---
# skill: create a DataAnnotation worker account

**Big step 1** of [`dataannotation-assessment-workflow`](../dataannotation-assessment-workflow/README.md).

Opens (or resumes) `https://app.dataannotation.tech/worker_signup`, fills the create-account form for one
person, solves reCAPTCHA (**agent by default** — operator 2026-11-07), and submits. Password text is typed
with `secret:1` (never shown on the panel). Proven end-to-end on **host 34123 / Ubuntu / Firefox**,
2026-11-07 — Maya Chen → `auth_state=confirm_email` (“Check your email”).

## Agent workflow (use this)

```bash
# Full create (includes captcha handoff):
node skills/create-dataannotation-account/create-dataannotation-account.js ./work \
  --first Patrick --last Mathias --email 'you@example.com' --password '…'

# Timing drill / stop before captcha (MCP practice — target <60 s from open):
node skills/create-dataannotation-account/fast-pre-captcha.js ./work \
  --first Patrick --last Mathias --email 'you@example.com' --password '…'

# Or env: DA_FIRST DA_LAST DA_EMAIL DA_PASSWORD
```

**MCP fast path (34123):** one `plan` with **screen** coords (not `lx/ly` until after a `look`): Email CTA
`(960,600)` → Tab name/email → Enter → Escape → passwords → Terms `(795,722)` → **stop**. Do not call
`captcha`. **Always ScreenMirror auto-type** (`keys` default — never `human:0` for DA fields; operator
2026-11-07). Instant `human:0` was only for an earlier timing drill and is retired for signup.

**Credentials (full workflow):**
- Operator gives **resume**, **full name**, and **email** (session chat / Cursor). Split full name →
  First / Last. Keep the resume path for step 2 (Documents copy).
- **Password — always ask on the password page** (do not invent in the full workflow):
  1. `chat`: “Password page is ready. Reply with the password (I type it secret), or reply
     `I'll type it` and fill Create + Confirm yourself.”
  2. `chat_wait` until they answer.
  3. If they send a password → Create + Confirm with `secret:1` auto-type; Escape password-manager popups.
  4. If `I'll type it` → wait / look until both boxes have green checks, then Terms + captcha.
- Random name/email/password only when they **explicitly** ask for a random drill (not the full workflow).

**reCAPTCHA — agent solves by default (34123, 2026-11-07 — “Solve captcha on your own in default”):**
1. Click the checkbox (~look `584,432` / screen ~`876,648` after a look). Often enough alone (Maya
   Chen run: green check, no image challenge).
2. If an image challenge opens (“Select all images with cars”): find the blue header bbox → grid
   `top = header_bottom+2`, `cell = width/3` → click matching tiles → **VERIFY**.
3. Prove green check in the widget, then click **Create an account** (~`959,768`).
4. Success page: `…/users/sign_in?auth_state=confirm_email` — “Check your email” / account created.
5. Only hand off with `captcha` if the operator refuses agent solve, or an image challenge is too
   hard after one honest attempt — then stop and ask.

## The plan (states you can prove)

| Milestone | Done when | Check |
|-----------|-----------|-------|
| One live form window | only the Firefox DataAnnotation window is focused | look: title bar Firefox, form visible |
| Name + email step | First / Last / Email each have a green check | look after fill |
| Password ask | operator answered chat (sent password or “I'll type it”) | inbox / look |
| Password step | “Almost done, \<First\>” + both password boxes green, no “must match” | look |
| Terms + captcha | Terms checked; reCAPTCHA shows its checkmark | look (not just `captcha.solved`) |
| Account created | left the password page (dashboard / verify-email / next onboarding) | look + report |

## Steps (what the script / a careful hand run does)

1. **Focus one window.** `xdotool search --name DataAnnotation` can return Chrome *and* Firefox. Kill the
   Chrome copies; `windowactivate` the Firefox form. Keys into the wrong window leave First name empty
   while Last/Email look fine.
2. **Browser.** If Chrome blanks the DA page: F5/new-tab **once**, then Firefox (`exec firefox '<url>' &`).
   Do not maximize / F11. Request **shell** automatically when you need `exec`.
3. **Locate fields from the current `look`.** Run `locate-fields.py <look.png>` — stacked light bands are
   First → Last → Email (or Create password → Confirm). Click each band’s **own** `cx,cy` (`lx/ly`). Guessing
   from an earlier visit offsets into the wrong box (operator: Last typed into First, Email into Last).
4. **Replace, never append.** For every field: click → `chord ControlLeft KeyA` → `Backspace` →
   `keys {text}` with **auto-type** (never `human:0`; add `secret:1` for passwords). Tab-after-type can
   leave Create empty and Confirm filled → “Passwords must match.”
5. **Continue** (button or Enter) → password page. Dismiss Firefox’s password-manager popup with Escape.
6. **Terms** checkbox (small square above Create). Then **`captcha`** — when the reply is not a refusal,
   **look again**. If “I'm not a robot” is still empty or the page says “Please complete the recaptcha,”
   ask once more or stop. Do not treat “now sign off” as a solved captcha without a verifying look.
7. **Create an account** → look → report. On refusal of captcha: chat that name/email/password/Terms are
   ready but the account was not created, then sign off if they ask.

## Helpers

```bash
python -I skills/create-dataannotation-account/locate-fields.py work/da_form.png
# → [{"cx":676,"cy":341,"y0":326,"y1":356,...}, ...]
```

Remote bash from a Windows agent host: put the script in a file / base64 pipe — PowerShell eats `$id` in
one-liner `exec` strings.

## Fixed in the script (do not regress)

| Issue (34123) | Fix in `create-dataannotation-account.js` |
|---------------|------------------------------------------|
| Keys hit Chrome while Firefox had the form | `focusFormWindow` kills Chrome DA windows, activates Firefox |
| First/Last/Email offset by one field | `pickNameFields` from current `locate-fields.py` look only |
| Appended into existing strings | every `fillField` does Ctrl+A → Backspace → auto-type `keys` |
| Chrome blank DA page | `openInFirefox` + one F5; shell via `access` |
| `captcha.solved` but still blocked | `waitCaptchaVerified` looks + `verify.py captcha-blocked`, re-asks once |
| Instant typing / no auto-type | **never `human:0`** on DA fields — ScreenMirror auto-type only |

Also remembered in `.cursor/rules/dataannotation-signup.mdc` (alwaysApply) and gotchas.

## Pitfalls

- Duplicate titled windows steal keystrokes — close extras first.
- Field mid_y from **this** look only; one band down = wrong field.
- Append into existing text → wrong values / password mismatch.
- `type-text.js` (one key per command) burns the step budget — prefer one `keys` call with auto-type.
- Never `human:0` on DA signup fields (operator: always ScreenMirror auto-type).
- `captcha.solved:true` ≠ checkbox checked — always look.
- Agent solves reCAPTCHA by default (click checkbox; handle image grid if shown). Do not call
  `captcha` unless the operator refuses agent solve or the challenge is stuck.
- No Tesseract on 34123 — prove with pictures, not `text` checks.
- Escape dismisses Firefox password-manager / save-password popups before filling or after Create.

## Evidence

- **34123**, 2026-11-07, Firefox: First=Patrick, Last=Mathias — form filled; operator declined
  reCAPTCHA → no account (earlier run).
- **34123**, 2026-11-07, Firefox: Maya Chen / maya.chen.example@example.com — random creds per
  operator; Terms checked; agent clicked reCAPTCHA (~584,432 look) → green check (no image
  challenge) → Create (~959,768) → `…/users/sign_in?auth_state=confirm_email` “Check your email”.
  Operator: “Solve captcha on your own in default.”

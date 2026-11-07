---
name: Create a DataAnnotation account
when: sign up a DataAnnotation.tech worker account from a CV/name — open worker_signup, fill First/Last/Email, password, Terms, hand reCAPTCHA to the operator, Create an account
tags: browser, forms, dataannotation, signup, captcha, firefox, mission
run: node skills/create-dataannotation-account/fast-pre-captcha.js ./work --first F --last L --email E --password P
---
# skill: create a DataAnnotation worker account

Opens (or resumes) `https://app.dataannotation.tech/worker_signup`, fills the create-account form for one
person, waits for a **human** reCAPTCHA, and submits. Password text is typed with `secret:1` (never shown
on the panel). Proven pieces on **host 34123 / Ubuntu / Firefox**, 2026-11-07 — full create stopped only
when the operator refused the captcha.

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

**MCP fast path (34123, proven):** after `Continue with Email`, First name is focused → `keys human:0` +
`Tab` for Last/Email → Enter → Escape (Firefox pw popup) → password + Tab + confirm → Terms
`(lx:530,ly:481)` → **stop**. Do not call `captcha`. Landing CTA ≈ `(640,400)` on a 1280 look.

**Do not** invent email/password — take them from the operator (session chat or flags). **Do not** click
reCAPTCHA yourself — `captcha` then **look again**.

## The plan (states you can prove)

| Milestone | Done when | Check |
|-----------|-----------|-------|
| One live form window | only the Firefox DataAnnotation window is focused | look: title bar Firefox, form visible |
| Name + email step | First / Last / Email each have a green check | look after fill |
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
   `keys {text, human:0}` (add `secret:1` for passwords). Tab-after-type can leave Create empty and Confirm
   filled → “Passwords must match.”
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
| Appended into existing strings | every `fillField` does Ctrl+A → Backspace → `keys human:0` |
| Chrome blank DA page | `openInFirefox` + one F5; shell via `access` |
| `captcha.solved` but still blocked | `waitCaptchaVerified` looks + `verify.py captcha-blocked`, re-asks once |
| Step budget burned by type-text | `keys human:0` only; no `type-text.js` |

Also remembered in `.cursor/rules/dataannotation-signup.mdc` (alwaysApply) and gotchas.

## Pitfalls

- Duplicate titled windows steal keystrokes — close extras first.
- Field mid_y from **this** look only; one band down = wrong field.
- Append into existing text → wrong values / password mismatch.
- `type-text.js` (one key per command) burns the step budget — prefer `keys human:0` for known strings.
- `captcha.solved:true` ≠ checkbox checked — always look.
- Never solve, bypass, or click through reCAPTCHA.
- No Tesseract on 34123 — prove with pictures, not `text` checks.

## Evidence

- **34123**, 2026-11-07, Firefox: First=Patrick, Last=Mathias, email filled with green checks; both
  passwords matched with requirement ticks; Terms checked. Operator declined reCAPTCHA → no account.
  Learnings written here + `docs/reference/gotchas.md` (DA section).

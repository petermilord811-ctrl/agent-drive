# Claude.ai setup for DA assessments (HARD)

Some assessments (e.g. Data Scientist Section 1) require a **real Claude.ai chat** + share URL + optional screenshot.
This is a **first-class step**, not an afterthought. Wrong identity = wrong share trail for review.

Evidence miss: 99588 Daniel Herman night try — agent clicked **Continue as geroge** on an already-logged-in Google session. That is **forbidden**.

Companion: [`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md) (when Claude sits in the live pipeline) · [`PART-B-FILL.md`](./PART-B-FILL.md) · DA signup pattern: [`../create-dataannotation-account/README.md`](../create-dataannotation-account/README.md)

---

## Identity rule (HARD)

Claude account **must** match the DataAnnotation worker identity for this profile:

| Field | Source |
|-------|--------|
| **Email** | Same as DataAnnotation account email for this worker |
| **Name** | Same legal / DA signup name (First + Last from profile) |
| **Password** | Same as DA password **or** ask operator to choose/set one |

**Never:**

- Click **Continue with Google** / **Continue as \<other person\>** on a random browser Google session
- Use a guest / teammate / leftover Chrome profile that is not this DA worker
- Invent an email or password without asking
- Finish onboarding (name / role / plan) under a **non-DA** leftover session — logout first

---

## Wrong-session logout (HARD)

If Claude is already signed in as the wrong person (e.g. leftover Google / geroge):

1. Navigate omnibox to **`https://claude.ai/logout`** (operator-taught; do not hunt menus or clear all Chrome cookies)
2. Confirm you land on signed-out login / welcome
3. Then email-path signup or operator self-login with the **DA** identity

Do **not** type a DA name into a leftover Google session’s “What’s your name?” page — that still ties the account to the wrong Google identity.

---

## Expected onboarding (after correct identity)

These pages are **normal** after creating / first-opening a Claude account with the right email — go through them; they are not a bug:

- Desktop app promo → **Skip**
- “Before your first chat” tips → **Continue**
- “What’s your name?” → DA First + Last
- Role / “Set up later”
- Plan picker → **Use Claude for free** (unless Instructions say otherwise)

---

## Decision tree (before any Claude click)

```
1. Resolve DA identity for this profile
   - Prefer profile notes / session / operator-provided DA_EMAIL + full name
   - If unknown: chat ask — do not guess; do not use whatever Google is logged in

2. If already in a Claude session that is NOT the DA identity
   - Open https://claude.ai/logout → wait for signed-out login screen
   - Then continue from step 3 (do not finish leftover onboarding)

3. Open Claude in a clean path
   - Prefer signed-out claude.ai/login (after logout URL if needed)
   - If Google One-Tap / “Continue as …” appears for a NON-matching email → dismiss / ignore
   - Prefer **email** path (“Enter your email” / Continue with email) with the DA email
   - If Chrome autofill offers a leftover address (e.g. geroge.c…): Escape / dismiss — never pick it

4. Branch on what Claude returns for that email
   A) NEW account (onboarding / create account)
      - After magic-link: “Let's create your account” + prove banner
        **Email verified as \<DA email\>** (must match) before Create
      - Agree terms checkbox (OCR-left-of-label + snap:false — see CLICK.md) → **Create account**
      - Fill name to match DA First+Last if asked
      - Password: chat ask when a password field appears
          “Claude password page ready. Reply with the password (I type secret),
           or reply I'll type it / use same as DataAnnotation.”
      - Free plan → Skip desktop promo / Before your first chat as needed
   B) EXISTING account (login / password / magic link / “account exists”)
      - STOP agent login with wrong Google
      - Chat: “Claude already has this DA email. Please log in yourself on this machine
        (same email/password as DA or your Claude password), then reply ready when
        you are on the Claude chat home.”
      - chat_wait until operator says ready / logged in
   C) Email verification required
      - Chat ask operator for the verify **magic-link** from the DA inbox
      - Open with ScreenMirror **`open {url: "https://claude.ai/magic-link#…"}`** (preserves `#` fragment;
        plain omnibox keys often fail / strip the hash — 99588). Prefer link, not manual code,
        unless operator says otherwise
      - Or wait for operator **verified** if they clicked the link themselves

5. Only after identity is confirmed on-screen (email / name match)
   - Select Haiku + Effort Low per live Instructions (model chip → More models → Haiku → Effort Low)
   - Run the assessment conversation from answer.md (see **Composer rules** below)
   - Share → Anyone with the link → copy share URL → type URL into DA with keys (never Ctrl+V on DA page)
   - Optional failure screenshot → upload on DA
```

---

## Composer rules (HARD — 99588)

Claude.ai (and most AI chat boxes) ≠ DataAnnotation textareas:

| Action | Claude.ai | DataAnnotation assessment |
|--------|-----------|---------------------------|
| **Enter** | **Sends** the message | Newline / submit field (depends) |
| **New line in prompt** | **Shift+Enter** only | Enter or Shift+Enter OK |
| **Ctrl+V / Ctrl+C** | **Allowed** (prefer paste for long Round 1 prompts) | **Forbidden** — type with `keys` only |

**Never** send a multi-line Claude prompt with `keys` containing bare `\n` / Enter — that splits and sends early (99588 miss: Round 1 fragmented). Prefer **Ctrl+V**:

1. Open a **plain text editor on the guest** (Linux 99588: **Kate**/KWrite from app menu; Windows guests: Notepad). Enter = newline there (safe). Do **not** Win+R/`keys` while Claude is focused — that leaks into the composer and can Send (99588).
2. `keys` the full Round 1 / Round 2 text into the editor (bare `\n` OK)
3. **Ctrl+A** → **Ctrl+C**
4. Focus Claude composer → **Ctrl+V** → **Enter** to send
5. Fallback: between lines in Claude use **`chord { mod:\"ShiftLeft\", code:\"Enter\" }`** — NOT `code:\"Shift+Enter\"` (99588 miss: that form does **not** insert a newline; prompt collapses onto one visual block).

Do **not** painstakingly Shift+Enter a long assessment prompt when paste works (99588 operator correction). Prefer Kate → Ctrl+V; keep Kate open until paste lands.

**If clipboard paste fails:** type line-by-line with correct Shift+Enter chord after every line (operator: preserve structure — do not collapse to one line). Still never embed bare `\n` / Enter into Claude `keys`.

**99588 miss (lab leakage Round 1):** first phrase stuck to `Setup` with **no blank line** before the Setup block. Operator flagged it. After pasting/typing the intro sentence, always `chord { mod:"ShiftLeft", code:"Enter" }` **twice** (blank line) before the word `Setup` / next heading. Same between Task blocks. Prove the blank line in a look before Enter-to-send.

After Round 1: if the reply does **not** meaningfully fail (e.g. keeps screen+/conf+ as clean disease labels), send the Round 2 press from `answer.md`. Then Share → Anyone with the link.

---

## Operator chat templates

**Ask identity (if missing):**

> Need Claude for this assessment. What DataAnnotation email + full name should I use for Claude (must match DA)? Reply with email, and either the password to type secret, “use DA password: \<pw\>”, or “I'll type the password” / “I'll log into Claude myself”.

**Existing account:**

> Claude says this email already has an account. Please log in yourself with that DA email (not a different Google). When you see the Claude new-chat screen, reply **ready**.

**Wrong Google one-tap visible:**

> Ignoring “Continue as \<other\>”. Using email signup/login for the DA email only.

**Leftover Claude session (wrong identity):**

> Logging out via https://claude.ai/logout, then recreating / logging in with the DA email only.

---

## Proven workflow (99588 / Daniel Herman)

```
1. Wrong leftover Google Claude → open https://claude.ai/logout
2. Sign-in screen: IGNORE Continue with Google / Apple
3. Enter your email = DA email (dismiss leftover autofill) → Continue with email
4. Operator sends magic-link from DA inbox → open {url: magic-link}  (not code; not omnibox keys)
5. Prove: "Email verified as <DA email>" on Let's create your account
6. Check terms → Create account → Use Claude for free → Skip desktop → Before first chat Continue
7. Name = DA First+Last → Set up later (role) → chat home
8. Prove: welcome / sidebar shows DA name (e.g. “Welcome, Daniel Herman!” + Free)
9. Password: only if Claude asks (magic-link create often skips); then operator types per chat policy
```

## Simulation checklist (host practice)

```
[ ] Connect named host
[ ] If wrong Claude session: https://claude.ai/logout → signed-out login
[ ] Open claude.ai/login without clicking Continue as <non-DA Google>
[ ] Chat ask / confirm DA email + name (+ password policy)
[ ] Email path with DA email; dismiss leftover autofill
[ ] Magic-link via `open` (not code / not fragile omnibox) when verify email appears
[ ] Prove "Email verified as <DA email>" before Create account
[ ] Expect normal onboarding pages (Skip / Before first chat / name / free plan)
[ ] Look prove: logged-in identity matches DA (not leftover geroge / teammate)
[ ] Then Haiku chat + share (separate from this setup gate)
```

---

## Wire-in

- Part B share steps must call this doc before opening Claude
- Live sequencing: [`WORKFLOW-LIVE.md`](./WORKFLOW-LIVE.md) phase 3–4
- `PREFLIGHT.md` / `PART-B-FILL.md` / `ANSWER.md` point here
- Cursor rule: `.cursor/rules/da-claude-setup.mdc`

## Speed lessons (99588)

| Slow path | Fast path |
|-----------|-----------|
| `keys` multi-line into Claude with Enter | Kate → Ctrl+V → prove blank line → Enter send |
| `code:"Shift+Enter"` (no newline) | `chord {mod:"ShiftLeft", code:"Enter"}` |
| Missing blank line before `Setup` | Two Shift+Enter after intro sentence; look prove |
| Omnibox-typing magic-link (strips `#`) | `open {url: "https://claude.ai/magic-link#…"}` |
| Hunting Share UI after chat | Share → Anyone with the link → Copy; type URL into DA with `keys` only |

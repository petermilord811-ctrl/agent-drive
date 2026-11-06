# Security

agent-drive drives real computers that belong to real people, so a weakness here is not abstract. Please report
one privately, and please do not test it against machines you do not own or have permission to use.

## Reporting a vulnerability

Use **GitHub's private vulnerability reporting** on this repository (Security → Report a vulnerability). Say what
you found, how to reproduce it, and what it could let someone do. You will get an answer within a few days; a fix
is released before the details are made public, and you are credited unless you ask not to be.

Do **not** open a public issue for a vulnerability.

## What counts

- Anything that lets the agent act **without the consent** the Allow card asked for — driving on a watch-only
  visit, running commands or opening a terminal without that grant, outliving the grant.
- Anything that **leaks what it should never send** — a typed secret on the progress panel, a password field's
  value read by `controls`, a capture kept after the visit when it should have been deleted.
- **Supply-chain risks** in this repository — a skill or tool that runs something it does not say it runs, a
  change that would let an update reach users without review.
- Bugs in the command checking (`core/verbs.js`) that let a command do something other than what it says.

The ScreenMirror relay and hosts are a separate product with their own reporting; if you are unsure which side a
problem is on, report it here and it will be passed on.

## Rules the kit keeps (and expects contributions to keep)

- **Consent first.** A person presses Allow for every visit, and every power is named on that card. A skill never
  works around a refusal, and never solves a CAPTCHA (it hands it to the operator: `captcha`).
- **No secrets in the repository.** `.env`, `work/`, logs and `*.local.*` are ignored; `node kit.js check`
  refuses common key shapes and private data, and CI runs it on every pull request.
- **No real screens in examples.** Example data and screenshots in a skill must be synthetic.
- **Reviewed updates only.** `node kit.js update` pulls the reviewed `main` branch; nothing reaches users from
  another user's machine directly.

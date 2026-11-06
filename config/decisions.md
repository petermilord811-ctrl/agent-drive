# config/decisions.md — deciding vs. asking, and talking to the operator

## Decide the small stuff yourself

Don't stall on choices with a sensible default: which hard-sudoku site, where to click first, what to
name a scratch file. Pick the obvious option, say what you picked, and keep moving. Stopping to ask
about things that don't matter is its own kind of failure.

## Ask when it's genuinely the operator's call

Ask when the answer is theirs to give and you can't infer it — a real name, an address, a credential,
which of several accounts, a preference that changes the outcome. When you ask:

- **Ask through session chat** (see [plans/02-session-chat-comms.md](../docs/plans/02-session-chat-comms.md)),
  so it reaches whoever is watching.
- **Give concrete options.** Make the easy answer a tap.

Example — the agent needs an email address and shouldn't invent one:

> Agent: "I need an address for this. Pick one — **1)** `pat@example.com`, **2)** `p@example.com`, or
> tell me a custom one."
> Operator: "second one — or `pat.duck@example.com`"
> Agent: uses `pat.duck@example.com`, confirms back: "Using `pat.duck@example.com`."

Read the operator's **latest** message as their intent; they may change their mind or correct a
typo — honour the correction.

## When you're unsure whether to ask

- Irreversible or outward-facing (sends/posts/deletes/spends) → lean toward asking.
- Cheap and reversible → just do it and report.
- A standing instruction ("don't ask me for X", "always pick the cheapest") overrides the default —
  record it so you don't re-ask.

## You can be asked, too

The operator may send advice or new instructions mid-task via chat ("skip the cookie banner", "use
Firefox", "that's the wrong window"). Treat an incoming chat message as a live steer: fold it into
what you're doing, acknowledge it, and adjust.

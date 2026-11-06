# plan 05 — confirm the irreversible in session chat, and honour late cancels

> **Status: SHIPPED** (the mechanism). `agent-join.js --serve` has **`confirm {text, timeout}`**: it
> announces to everyone in chat, waits the window, and returns `{verdict, replies}` — `cancelled` the
> moment anyone says no/stop/wait/"I said wrong" (**even after a yes**), `approved` only on a clear yes,
> else `unclear` (the caller treats that as no for a real restart/shutdown). Verified in
> `tests/agent_chat.js` (approved / cancelled / cancel-after-yes). The *policy* — which actions must be
> gated, and treating `unclear` as no — is in [config/etiquette.md](../../config/etiquette.md). Rides on
> `chat`, so no extra relay change (needs the chat deploy). The serve agent has no OS-level restart verb
> (exec is excluded from GRANT_VERBS), so this gates GUI-driven dangerous actions.
>
> **Standing yes (`--auto-confirm` / `SM_AUTO_CONFIRM`) — SHIPPED.** For a machine its owner left the
> agent on, a *silent* window comes back `approved` (`auto:true`) instead of `unclear`: the "you don't
> need to ask me for these" of step 3 below, made mechanical. It still announces and still honours a
> late stop, and a clear human **no** still cancels — the standing yes only ever fills a silence.

## The goal
Before restart / shut down / log off (and other hard-to-undo actions), the agent **announces it to
everyone in session chat and waits for a human yes** — and a cancel always wins, even one sent late or
in a hurry.

## Design (builds on plan 02)
1. **Classify** the pending action. Hard-gate: restart, shutdown, logoff, sleep, lock; delete/
   overwrite/move files; stop/disable a service; sign out; uninstall; change a password. (The serve
   command's existing destructive heuristic covers shell commands; this adds the OS-level actions.)
2. **Announce to all** (plan 02, `to` omitted) and open a short confirm window:
   > "About to **restart 10004** to finish the update. Reply **stop** in ~20s to cancel — otherwise I
   > proceed."
3. **Wait, watching `chat.json`:**
   - **A cancel wins, always** — "no / stop / wait / I said wrong", even after a yes, even
     mid-countdown → abort and acknowledge ("Cancelled — not restarting.").
   - People send many messages and correct themselves — evaluate the **latest** intent. Ambiguous →
     don't do it; ask again.
   - Proceed only on a clear, current **yes** (or a standing "you don't need to ask me for these",
     which you then record).
4. **Act**, then report what happened.

## Edge cases to get right
- Two people disagree ("yes" and "stop") → treat as **not confirmed**; stop and ask.
- The person who must approve isn't present → don't proceed; say so.
- Message arrives *during* the action it's cancelling — for a restart, you may not be able to recall
  it; say honestly what state it's in.

## Acceptance
- No OS-level restart/shutdown/logoff happens without an explicit, current chat yes.
- A "stop" sent any time before the point of no return aborts the action.
- The agent never mistakes an old "yes" for consent after a newer "no".

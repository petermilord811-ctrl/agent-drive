# plan 02 — session chat between the agent and the operator

> **Status: SHIPPED** (the core). `agent-join.js --serve` now has `chat {text,to?}` (send to the room
> or a DM), logs incoming chat to `<serve-dir>/chat.json`, and `chat-wait {timeout,since}` blocks for
> the next human reply — the ask-with-options flow works. A `ping {timeout}` liveness verb also landed
> (the start of the watchdog). See [reference/serve-protocol.md](../reference/serve-protocol.md#talking-to-the-operator-session-chat).
> **Not yet tested against a live viewer** — needs an operator watching the host to see a message.
> **Auto-reconnect shipped too:** in `--serve` the client redials the relay list, re-prompts Allow, and
> resumes on a dropped/stale socket (it ends, not reconnects, on a *revoke*). See
> [config/connection.md](../../config/connection.md) and [roadmap](roadmap.md).

## The goal
Two-way talk on the machine's session: the operator sends the agent advice or answers; the agent asks
questions (with concrete options) and announces things. This is the backbone for 04 and 05.

## What exists
A full session chat in the relay — `type: 'chat'` messages plus `chat-typing`/`chat-react`/`chat-read`/
`chat-roster`/`chat-files` (ws-server.js ~18310; viewer chat hub). Messages can go to **everyone** or
one recipient.

## Design — add to the serve client
1. **Send:** a verb `chat {text, to?}` → emit the relay's `chat` frame as the joined client. `to`
   omitted = everyone watching the host.
2. **Receive:** subscribe to incoming `chat` frames and write each to **`chat.json`** (an append log in
   the work dir), the mirror of how `done.json` works — so the driver reads new messages between steps.
   Include sender, text, and timestamp.
3. **Ask-with-options helper:** `ask {text, options:[...]}` sends a chat message formatted as a numbered
   choice and then waits (polling `chat.json`) for a reply, returning it. Used by
   [config/decisions.md](../../config/decisions.md)'s email example.

## Behaviour (already written as rules in config/)
- Decide small things; ask forking things, as a chat message with options — not an open question.
- An incoming chat message is a live steer: fold it in and acknowledge.
- Read the operator's **latest** message as intent (they correct themselves).

## Acceptance
- The agent can post "Pick one: 1) … 2) …" to the session and read the human's reply.
- The operator's mid-task message appears in `chat.json` within a step or two and changes what the
  agent does.
- Identity is honest: messages are attributed to the agent, never spoofed as the operator.

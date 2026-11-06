# plan 04 — don't fight the person; ask to pause or take control

> **Status: taking control is SHIPPED; presence is sensed, not subscribed.**
> - **Exclusive control: SHIPPED** (2026-10-24, on request). The serve verb `lock {on}` takes/releases
>   an exclusive lock. The relay gate changed: `control-lock` was admin-only; now a grant session may
>   lock the **one host it was let onto**, and only with a **--control** grant — the agent is **not**
>   made admin (that would hand it every other machine and account administration). The lock disarms the
>   other operators while held, and **dies when the grant ends** (joinRelease / unwatch), so an agent
>   can't hold a machine hostage. Verified in `tests/agent_chat.js`. Use it per the etiquette below:
>   ask first, and release the moment the work is done.
> - **Live presence isn't delivered to a watching viewer.** `user-present`/`user-away` feed the
>   dashboard and health log, not a per-viewer frame, so the agent can't cheaply subscribe to "a person
>   is here" — the practical signal is **screen diffs** (input the agent didn't send, via `mark`/`diff`).
>
> So: **ask before taking over** (`chat`/`chat-wait`), and if told to, **`lock {on:true}` → work →
> `lock {on:false}`**. See [config/etiquette.md](../../config/etiquette.md).

## The goal
When a real person is using the machine, the agent doesn't barge in. It notices, asks — "could you
pause for a few minutes, or shall I take exclusive control?" — and acts on the answer.

## What exists
- **Presence:** the host reports `user-present` / `user-away`; the relay tracks `hostPres`
  (ws-server.js ~3263, 3929, 2033).
- **Exclusive lock / Solo:** `producer.lock`, `lockBlocks`, Solo/`guardBy` (ws-server.js ~5166, 5491,
  5617). The serve client already **honours** a lock (a run is refused while another holds it). It
  can't yet **request** one.

## Design
1. **Sense presence.** Serve client subscribes to presence and exposes it (`presence.json`, or a
   `who` verb). Also treat *observed* input it didn't send — the pointer moving, text appearing — as
   "someone's here" (diff the screen between steps).
2. **Ask, via chat (plan 02).** On detecting activity before/while working:
   > "I'm about to work on this machine for a few minutes. Pause for a bit, or shall I take exclusive
   > control while I do it?"
3. **Act on the answer** ([config/etiquette.md](../../config/etiquette.md)):
   - pause-and-go → work in small steps, keep watching for them returning.
   - take control → `lock-take` (request the exclusive lock), do the work, **`lock-release` the moment
     it's done**. Never hold it idle.
   - no answer → read-only only; wait.

## Acceptance
- With a person active, the agent asks before taking over and waits for the answer.
- On "take control", it acquires and later releases an exclusive lock; the lock is never left held.
- It never types into a window a person is actively using without having asked.

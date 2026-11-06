# docs/reference/screenmirror-features.md — ScreenMirror's features, and how the agent uses them

Two layers exist. **(A)** What the serve client can do **today** — drive the desktop (input + screen),
which is the whole of [serve-protocol.md](serve-protocol.md). **(B)** ScreenMirror's own features —
chat, sticky notes, spotlight, locks, presence — which live in the relay/viewer and are **not yet**
verbs in the serve client. The agent can reach some of (B) today by *driving the host's UI*; the rest
need the serve client extended (the plans). Status is marked on each.

> All of (B) is real in this codebase. Pointers are into `tools/ws-server.js` / `tools/viewer.html` so
> the implementer can wire each one up. Don't invent message shapes — read the handler first.

## Session chat  — `type: 'chat'`, `chat-*` events (ws-server.js ~18310; viewer chat hub)
A full session chat: messages to everyone or one person, typing, reactions, read receipts, files,
roster. **This is the channel for Claude↔operator comms** — asking a question with options, announcing
a dangerous action, receiving advice mid-task.
**Status:** ✅ SHIPPED — serve verbs `chat {text,to?}` (send) and `chat-wait {timeout,since}` (block for
a reply); incoming chat logs to `<serve-dir>/chat.json`. Plus `ping` for liveness. See
[02-session-chat-comms.md](../plans/02-session-chat-comms.md). (Auto-reconnect shipped too — the serve
client redials and re-prompts Allow on a dropped socket; see [config/connection.md](../../config/connection.md).)

## Sticky notes  — "sticky note", `note*` handlers (ws-server.js ~15749, 16125, 23741, 26389)
Notes attached to a host, visible on the dashboard/stream. Two directions the agent wants:
**write** ("add a sticky note about tomorrow's actions") and **read** ("the tasks I left as sticky
notes — read them and work through them, crossing off each as it's done").
**Status:** ✅ SHIPPED — `note-list` (read), `note-add` (write), `note-done` (cross off by resolving).
`spot` added to GRANT_VERBS. Authority is respected: the agent owns notes it creates; it cannot edit or
delete another person's text (relay-enforced), but `resolved` is open, so it can cross a task off. See
[03-use-screenmirror-features.md](../plans/03-use-screenmirror-features.md) and
[work-through-sticky-notes](../../skills/work-through-sticky-notes/README.md).

## Spotlight / focus beam  — viewer.html ~1345–1380, ~3038+
A viewer-side highlight over the stream: dim everything but a circle/region, or beam attention at a
point — "I can't see the rabbit, spotlight the circle of the rabbit." It's drawn in the *viewer*, so
the agent uses it **as a presenter**, not by driving the host.
**Status:** ✅ SHIPPED — two verbs, as the viewer has two tools. `spotlight {rect|circle|points, rounds,
times, forever}` is the Spotlight a person uses (laser dot `spot k:'m'`, ink `k:'d'`…`k:'e'`, pings `k:'p'`):
the dot travels to the thing, circles it in rounds that each show, then pings it. `beam {x,y,size,hold,
forever}` / `spotlight-off` is the focus beam (`spot k:'m' beam:1`), which dims all but a circle. Both ride
fan-outs viewers already render, so they needed only serve verbs. See
[serve-protocol.md](serve-protocol.md) and [03-use-screenmirror-features.md](../plans/03-use-screenmirror-features.md).

## Exclusive control & Solo lock  — `producer.lock`, `lockBlocks`, Solo/`guardBy` (ws-server.js ~5166, 5491, 5617)
Taking a machine so nothing else reaches it. The serve client already **honours** an exclusive lock
(a run is refused while someone else holds it — see `lockBlocks` in `agentRun`). What's missing is the
agent **requesting/holding** a lock itself, for the "take control while I work" case in
[etiquette.md](../../config/etiquette.md).
**Status:** ✅ SHIPPED — serve verb `lock {on}`. The relay gate changed so a **--control** grant may lock
its **own** host (not made admin); the lock dies when the grant ends. See
[04-concurrency-and-control.md](../plans/04-concurrency-and-control.md).

## Presence — is a real person at the machine?  — `user-present` / `user-away`, `hostPres` (ws-server.js ~3263, 3929, 2033)
ScreenMirror reports whether someone is actually at the host. This is the signal behind "don't fight a
person for the keyboard" in [etiquette.md](../../config/etiquette.md).
**Status:** emitted by the host; the serve client should **subscribe and expose it** —
[04-concurrency-and-control.md](../plans/04-concurrency-and-control.md).

## Showing the agent's progress to viewers  — the viewer AI-Agent panel (viewer 2.134.0)
The in-browser AI-Agent **panel** shows a live "activity strip" and mirrors a run to every co-viewer
(the relay's `agentRun` loop). The **serve path** now has its own: ✅ SHIPPED (viewer 2.135.0) — a
`status`/auto `drive-status` narration → an `agent-drive` fan-out → a standout **"agent is driving"
banner** (`#agentDrive`) every watcher of the host sees over the stream. See
[01-progress-to-viewers.md](../plans/01-progress-to-viewers.md).

---

### Rule of thumb
If a feature lives in the **viewer** (spotlight, the activity strip), the agent reaches it by acting as
a **presenter/viewer client**, not by driving the host. If it lives on the **host/relay** (sticky
notes, presence, locks, chat), the agent reaches it by speaking that **relay protocol**. Driving the
desktop (clicks/keys) is the last resort, for when there's no protocol for the thing you want.

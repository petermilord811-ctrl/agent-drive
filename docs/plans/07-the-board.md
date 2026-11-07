# plan 07 — the board: the panel as the room's control surface (2026-11-06) ✅ BUILT

## The problem

The progress panel every watcher sees was a display: what the agent did and, lately, why. Everything else the people
watching might want to do went through typing in chat — and the kit already knew far more than the panel showed:
its budget, the job's goal and each milestone's finish line, a record of every change it made with how to put it back,
the proofs of what it achieved. Answering it meant leaving the panel; the only brake (⛔ Stop) ended the whole visit; a
finish faded after 8 s; nothing said "it is waiting for you" to someone in another tab.

## The design

**One channel back: the session chat, with marks.** A board button posts a chat line that starts with a mark only the
panel sends (`core/board.js` `markText`), e.g. `⏸ Pause — hold on until I say go on.` or `✅ Yes — go ahead. [q7]`. The
serve reads each with `parseMark` and honours it ITSELF (`agent-join.js` `onMark`), so a button works while the driver is
busy or thinking — as ⛔ Stop always has. One record of the visit, readable by people and agent alike; no new relay verb.

| mark | request | who may | the serve |
|------|---------|---------|-----------|
| ⏸ / ▶ | pause / go on | anyone pauses; the pauser or the inviter lets it go on | acting commands refused while paused (`paused`) |
| ⏹ | stop this task | anyone | refused until the driver reports (`status {fin}`) — the visit stays |
| ⏯ “step” | stop after a step | anyone | becomes a stop when that step ends |
| ✅ / ✋ / 🧩 `[qN]` | yes / no / solved | the inviter's yes; anyone's no | answers the question with THAT id — a stale button never answers a newer one |
| ↩ c3 / all | undo | the inviter | put back by the serve between the driver's commands (`roomJobs`) |
| 🎚 | autonomy: each / risky / checkpoints / auto | the inviter | approvals per command (`board.approvals`), checkpoints per step |
| ⏭ / 🔁 “step” | skip / redo | anyone | carried to the driver (`room` notes) |
| 💾 / 🗓 / 🔂 | save as a skill / schedule / run again | the inviter (🔂 anyone) | `replay.draft`, `schedule.js add`, a note to the driver |
| 👋 | are you still there? | anyone | answered by the serve: what it is on, how long it has been quiet |

**Who decides.** The relay tells the agent who pressed Allow (`agent-grant {by}`) and stamps that person (`inv`) and the
visit (`gid`) on every panel frame. A yes is the inviter's; anyone's no still wins; anyone may pause or stop.

**What the panel shows** — new bounded fields on `drive-status` (the relay forwards each one):
`goal {g,w,at,n,of}` · `bud {s,sl,mi,ml}` · `tm {t,a,w}` (thinking / acting / waiting, `board.timeSplit`) ·
`ask {k,q,id,plan?}` · `chg {n,l:[{id,w,r,k,u}]}` · `pz {by,at,why}` · `hold {k,step,by}` · `au` · `lock` · `m.f` (failures)
· tree nodes `x` (r risky, c changed the machine, p proven). Two frames of their own: `drive-eye` (a ~10 KB picture of
what the last `look` read) and `drive-proof` (a milestone's proof, the task's result picture), which the watchers get as
`agent-eye` and `agent-proof`. Clicks ring on everyone's
picture (spot `p`, the ripple a person's click makes).

**A person who takes over pauses it.** `ptr-owner` (a person's click takes the pointer) or `local-input` (someone at the
machine) pauses an agent that is working — not while it waits for them (a question, a CAPTCHA), not after a finish.

**The relay keeps the run.** Each visit's compact log (one entry when the panel's state changes), its last picture and
proofs are replayed to a viewer who opens the machine mid-task (`agent-drive-log`); a finished visit joins the machine's
History (`agent-visits`, a dozen per machine, kept across a restart). `join-revoke` — the relay ending a visit — is the
board's last resort for an agent that does not stop.

## What the driver sees

Every answer may carry `room` (what the people did on the board — act on it first), `paused`, `hold`, `autonomy`; a
refused acting command says why (`paused`, `held`, `approval {id,q}`, `checkpoint`). Wait in `chat-wait` and do what it
says: send the same command again after an approval's yes; report with `status {fin:1, say}` after a stop.

## Acceptance

`tests/board.js` (the marks, risk, approvals, the time split); in ScreenMirror, `tests/agent_board.js` (the viewer, headless)
and `tests/agent_board_live.js` (a real relay and client: inviter-only rules, pause / stops, the dial, answers by id,
Undo by the serve, the human-takeover pause, a late viewer's replay, the History, join-revoke).

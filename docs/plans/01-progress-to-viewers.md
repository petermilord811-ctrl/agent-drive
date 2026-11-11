# plan 01 — show the agent's progress to viewers

> **Status: SHIPPED** (viewer 2.135.0). The serve agent narrates what it's doing and a standout banner
> shows it to everyone watching the host. Client: acting verbs auto-narrate ("Clicking", "Typing",
> "Opening <url>", "Working through N steps"), any command may carry `intent:'<phrase>'`, and `status
> {text}` sets it explicitly — all sent as `drive-status`. Relay: fans it out to the host's watchers as
> `agent-drive` (a new GRANT_VERBS entry), and clears it on grant release. Viewer: `#agentDrive`, an
> accent-filled animated pill at the top of the view (reuses the activity-strip orb), cleared on
> ended/empty or a 25s backstop. Verified in `tests/agent_chat.js` (end to end) + a CDP banner check.
> **REQUIRES THE RELAY + VIEWER REDEPLOYED** to show live. It is a separate, lighter path from the
> 2.134.0 AI-Agent-panel strip — this one is for the serve agent and shows to all watchers over the stream.

## The problem
When the agent drives a machine via `--serve`, people watching that machine see the *screen* (the
cursor moving, clicks) but no idea what the agent is **thinking or about to do**. The viewer already
has a beautiful answer for the *other* path — the AI-Agent panel's live **activity strip** and
full-run **mirror** (viewer 2.134.0, `agent-state`/`agent-propose` frames via the relay's `agentRun`).
The serve path emits none of those, so that UI stays dark.

## The goal
A calm, **standout** status that every viewer of the host sees: one plain line of what the agent is
doing now ("Reading the board", "Filling 51 cells", "Waiting for your OK to restart"), distinct from
ordinary notifications/logs — the activity strip, fed from the serve run.

## Design
1. **The serve client already writes a `ledger.json`** step by step. Add an **intent** to each step —
   a short human phrase — and emit it on a presenter channel as the step begins, not just after.
   - add `say`/`intent` to acting verbs (optional), and derive a default phrase from the verb + target
     ("click → selecting a cell", "open → opening sudoku.com").
2. **Relay:** accept a `agent-intent {text, phase}` frame from the join client and **fan it out to the
   host's viewers**, reusing the exact `agent-state`/activity-strip rendering 2.134.0 already ships
   (so it looks identical to the panel's strip — one UI, two sources). Mark it `mirror`/`by:"agent"`.
3. **Viewer:** the activity strip (`#agentActivity`, built in 2.134.0) renders it — no new UI needed,
   just a second feed into it. Make the serve-agent strip visually a touch bolder (a distinct accent /
   a small "AGENT" tag) so it reads as "the machine is being driven", not a normal toast.

## Why this is the right shape
2.134.0 already solved the hard part (the strip, the mirror fan-out, reduced-motion, theming). This
plan is *routing a new source into it*, not new UI. See `web/viewer.html` `#agentActivity` /
`agentActivitySet`, and the relay's `mirror()` in `agentRun`.

## Acceptance
- A co-viewer of the host, during a serve run, sees a live one-line status that tracks the steps and
  reads as clearly "the agent is working", collapsing when idle.
- Nothing is shown to viewers who can't already see that host.

## Follow-ups after a finished task  (2026-10-26 — PLANNED)

> Reported after the first live `sudoku.js play`: "I gave you another task after finished sudoku, then
> progress panel is refreshed as new one. In this case, you have to add one more step or change step in
> case of task question, then have to finish it."

**What happens today.** A task ends with `status {fin:1}`: the panel goes green and keeps its tree. The
operator then asks for more ("spotlight the result screen"). The next non-quiet action RETIRES the
finished tree (agent-join.js: `lastDrive.fin && !cmd.quiet` → `tree = null`), so the panel restarts as
a bare feed of phrases; a tool run again (`sudoku.js play`) replaces the tree with a new one; and nothing
finishes the follow-up — that day's run ended with `done`, a hang-up.

**What it should do.**
- A follow-up — a task OR a question — is a new STEP in the SAME tree: the finished steps stay ✓ with
  their times, and "Spotlight the result screen" (or "Answer: <the question>") is added as `doing`, with
  sub-steps if it has them. A Steer ("Please change: …") changes or adds the step it is about.
- It is then finished like any task: the step goes `done` and the panel green again (`fin:1` with a line
  that answers it). Only "New task: …" (or unrelated work) starts a fresh tree; only "stop / done" ends
  the session.

**Design.**
1. **Every tool that owns the panel leaves its final tree in `<work>/plan.json`** — `sudoku.js` and
   `run.js` (plan.js already keeps it there). That file is the one tree a follow-up extends.
2. **`plan.js add "<label>" [under "<parent>"]`** appends a step as `doing` and un-finishes the panel;
   **`plan.js change "<label>" "<new label>"`** renames one; `finish` already marks all done + `fin:1`.
3. **Declare before acting:** the follow-up's step is sent BEFORE its first action, so the serve's retire
   rule (a fresh action after `fin` is new work) never fires on it. The rule stays for genuinely ad-hoc
   work with no declared step.
4. **A tool run again as a follow-up** (another `play`) puts its phases under a new top-level step
   ("Game 2") instead of replacing the tree — when plan.json holds a recently finished tree, or with
   `--append`.

**Acceptance.** After a finished sudoku, "spotlight the result screen" shows the sudoku steps ✓ plus
"Spotlight the result screen" → ✓, the panel green again and a closing line in chat — driven through the
panel renderer (`tests/agent_drive_panel.js`) and the real client (`tests/agent_chat.js`).

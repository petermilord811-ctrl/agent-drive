# plan 03 — let the agent use ScreenMirror's own features

Not just "drive the desktop" but "operate ScreenMirror": spotlight something, leave a sticky note,
read tasks left as sticky notes and work through them. Each is a new serve verb speaking a protocol
that already exists. Ship them one at a time.

> **Sticky notes: SHIPPED.** `note-list` (read the board — the agent receives notes on select like any
> viewer, mirrored to `<serve-dir>/notes.json`), `note-add {text,x,y}` (leave one), `note-done {id}`
> (cross a task off by resolving it — `resolved` isn't ownership-gated, so the agent can resolve a note
> the operator left). Relay: `spot` added to GRANT_VERBS (viewer-facing markup only). Verified in
> `tests/agent_chat.js` and the [work-through-sticky-notes](../../skills/work-through-sticky-notes/README.md)
> skill.
>
> **Spotlight/beam: SHIPPED too, as TWO verbs** (they were one at first, and a person asking to
> "spotlight it" got the dimmer). `spotlight {rect|circle|points, laps, ms, times}` is the viewer's
> point & draw tool: it inks a shape round the thing (`spot k:'d'` … `k:'e'`) and pulses there
> (`k:'p'`). `beam {x,y,size,hold}` is the focus beam: it dims the picture except a circle (`k:'m'
> beam:1`), refreshed for `hold` ms because a co-viewer's beam expires in ~2 s; `spotlight-off` clears
> it. Both need only the serve verb — viewers already render what other viewers send. Verified in
> `tests/agent_chat.js`. **But see "Spotlight like a person" below: the first live use read as one fast round.**

## Spotlight / focus beam  — presenter overlay
> "I can't see the rabbit — spotlight the circle of the rabbit / focus-beam it."

- **Where:** viewer-side overlay (viewer.html ~1345–1380, ~3038+). It's drawn in the viewer, so the
  agent emits it as a **presenter**, not by driving the host.
- **Verbs:** `spotlight {x,y,r}` (dim all but a circle), `beam {x,y}` (pulse attention at a point),
  `spotlight-off`. The agent finds the target first (`find`/vision), then emits coordinates.

## Spotlight like a person — and repeat until told to stop  (2026-10-26 — BUILT, items 1–4; 5 open)

> "your spotlight effect (ai agent's spotlight) is different from real user's spotlight effect and you
> just spotlight once (draw only one round) with a little fast speed … spotlight slower and at least
> spotlight two or three. if user asks 'forever', you have to do until says stop. This is not only for
> spotlight all for other features."

**Why it read as one fast round** (agent-join.js `spotlight`, measured from the code):
- `laps` go out as ONE stroke along the SAME path, so lap 2 retraces lap 1's ink and cannot be seen.
- Pace is per POINT (`ms`, default 38) and a rect is 8 points an edge, so a big box is crossed at
  ~2,800 px/s — the 840×548 result panel took 1.25 s a lap.
- The pings come only at the centre, after the ink; the pointer never travels to the target; `laps` is
  capped at 6; nothing repeats until stopped.
- A person's Spotlight (viewer `btnSpot`: "move to point · click to ping · drag to draw") is a laser dot
  that travels with a comet trail, a FRESH stroke per drag (ink holds 1.2 s, fades over 1.6 s), and pings
  where they click (0.76 s each). That is the effect to match.

**Design.**
1. **Each round is its own stroke** (`k:'d' n:1` … `k:'e'`), the next drawn while the last one fades, so
   every round is seen. Default **3 rounds**.
2. **Pace by distance, not by point:** a hand's speed (~500 px/s to start, tuned against recorded
   frames), points every ~33 ms (the viewer's own 30/s cap), and never under ~1.5 s a lap however small
   the target.
3. **Like a person:** the pointer travels to the target first (`k:'m'` moves: the laser dot and its
   trail), the ink rounds follow, and the pings land ON the target where a click would.
4. **One repeat contract for EVERY feature the agent shows** — spotlight, beam, ping, pointing: a
   visible default of 2–3 rounds at a human pace; `rounds`/`times`/`hold` to ask for more; and
   **`forever:1`** = keep going until the operator says stop (any chat message — the serve's `interrupt`
   — or the Stop button), the panel step reading "until you say stop", with a safety cap (30 min).
5. **Verify against a person, not against itself:** record the `spot` frames a real viewer sends for a
   spotlight (point rate, px/s, strokes per round) and compare the agent's; render both through the
   viewer's spot layer headless and assert three distinct, visible rounds.

**Built (agent-join.js `spotlight`, `beam`):** items 1–4. The dot glides to the first corner (eased,
0.25–0.7 s); each round is its own stroke, 6 px wider than the one before (a hand never retraces its
line, and a retraced line cannot be seen), walked at 700 px/s with every corner kept, 1.5–2.4 s a round,
the next begun 0.45 s after while the last fades; then `times` (default 2) pings on the centre.
`forever:1` on `spotlight` or `beam` runs until the operator writes or presses Stop (30 min cap), and the
operator writing ends any spotlight the way it ends a plan. tests/agent_chat.js measures it through a real
relay: the glide, two strokes, ~1.5 s each, the second wider, the pings after; forever stopped by a message.
**Still open:** item 5 — comparing against frames recorded from a real viewer's Spotlight, and rendering
both through the viewer's spot layer.

**And shown before it is worked on** (asked on 10001, 2026-10-26: "spotlight the region what you are going
to handle"): `sudoku.js … --show` spotlights the screen before each capture, New Game before it is
pressed, the grid before it is read, the board and pad before the fill, the pad before the check.

**Acceptance.** "Spotlight the result" reads, to a watcher, as a person circling it slowly three times
and pulsing on it; "spotlight it forever" keeps going until they write stop; the beam obeys the same.

## Sticky notes — write
> "Add a sticky note about tomorrow's actions."

- **Where:** host/relay feature (ws-server.js ~15749, 16125, 23741, 26389).
- **Verb:** `note-add {text}` → the relay's note-add for the current host.

## Sticky notes — read and work through
> "I left my tasks as sticky notes on 10004 — read them, start working, and cross each off when done."

- **Verbs:** `note-list` → returns the host's notes (id, text, state); `note-check {id}` → mark done.
- **Flow:** `note-list` → for each open note, treat its text as a task (look for a skill first!), do it,
  then `note-check` that note. Report progress per note. This is a *skill* once built — add it to
  skills/ (`work-through-sticky-notes/`).
- **Authority:** sticky-note edit/removal has an ownership model — only cross off / change notes the
  agent (or its operator) is allowed to. Read the authority check before wiring `note-check`.

## General rule
Prefer the real protocol over faking it by driving the host UI. Spotlight *is* a viewer overlay —
don't try to draw a circle on the host's screen; emit the overlay. Likewise notes are data, not pixels.

## Acceptance
- A spotlight appears for viewers over the point the agent chose, at a person's pace, in rounds they
  can count, and clears on command — or keeps going, if asked, until they say stop.
- A note the agent adds shows on the dashboard; a note it checks off flips state (and only for notes
  it may touch).
- "read my sticky-note tasks and do them" runs end to end, crossing off each as it finishes.

---
name: Diagnose the screen quality
when: the remote picture looks bad -- blurry or blocky text, smeared colour, choppy or laggy motion, a heavy pointer -- and you need the CAUSE, then proof a change fixed it
tags: quality, picture, blurry, blocky, laggy, choppy, slow, diagnose, trace, stream, screenmirror
access: control, shell
run: {"do":"quality"}   (MCP: more {do:"quality", host}; the answer is pending for ~1-2 min -- ping collects it)
---
# skill: diagnose the screen quality (and prove the fix)

"The text is blurry when I scroll", "video is a mess", "the mouse feels heavy". One command records ScreenMirror's
own diagnostics trace while the screen is put through named stresses, judges each phase on its own seconds, and names
the causes -- each with its numbers, where it lives, and the one change worth making. Run it again after a change and
it says, phase by phase, whether the picture got better.

## The plan (a mission)

| Milestone | Done when | Check |
|-----------|-----------|-------|
| Measure | the `quality` answer has a `verdict` and a `file` | the answer itself (and the report in the room) |
| Explain | the room has the main cause in plain words, with its evidence and the fix | your chat message |
| Fix (if one is in reach) | the change is made -- a setting with the room's yes, or a code change by whoever owns it | `changed {what, undo}` for a setting |
| Prove | `quality {compare:<the first file>}` says **better**, and the cause is in `causesGone` | the comparison in the room |

## Steps

1. **Connect with what the check needs.** The whole suite wants the keyboard-and-mouse consent (the pointer phase)
   and the run-commands consent (the test card) -- connect with both, or ask mid-visit:
   `{"do":"access","control":1,"shell":1,"why":"to put a 1-minute test pattern on the screen and move the pointer, so I can measure what makes the picture worse"}`.
   Without them the check still runs what it can (the baseline) and its `skipped` says what each consent would add.
2. **Say it first.** The check posts its own announcement (a test pattern covers the screen ~55 s, Esc closes it, the
   pointer moves by itself) -- if somebody is working at the machine, `confirm` before you start: it takes over their
   screen for a minute.
3. **Run it:** `{"do":"quality"}` -- idle, the card's text / scroll / drag / video / cuts / rest, then the pointer.
   Through MCP it answers `pending`; `ping {host}` collects the answer (every ~50 s until it arrives).
   - Only one complaint? Run just its phases: `{"do":"quality","phases":["idle","scroll"]}`.
   - The problem is something the card does not show (one app, one game)? Let the person reproduce it:
     `{"do":"quality","phases":["idle",{"name":"watch","secs":30}]}` -- the room is asked to do what looks bad.
4. **Read the answer, top down:** `verdict` → `causes` (most severe first; `area` says who can fix it) → `phases`
   (a line each). Tell the room in plain words: the main cause, the evidence, the fix. Areas:
   - **link** -- the network: the host's uplink, the relay, a viewer's downlink. No setting sharpens a picture sent small.
   - **machine** -- the host computer: a software encoder, a slow capture.
   - **viewer** -- a person's console: their window (read mode fixes `viewport`), their decoder.
   - **setting** -- a mode somebody chose (picture quality, a height cap): change it with their yes.
   - **codec** -- ScreenMirror's own behaviour (the rate it holds back, keyframes it forces, refinement that does not
     run): a code change, for whoever develops it -- hand over the `file` and the cause.
5. **After a change, prove it:** `{"do":"quality","compare":"<the first run's file>"}` → `compare.overall` is
   better / worse / mixed / same, a line a phase, and the causes gone and new. Same phases, same card: only then is it
   the same test. Say the result in the room either way -- "same" after a fix is a finding too.
6. **Deeper:** the `file` is an ordinary trace. In ScreenMirror, `node tools/trace-report.js <file> --phase video`
   is the full report for one phase; `node core/quality.js <file> --compare <earlier>` re-reads it here.

## Pitfalls

- **The arrival side is YOUR link.** Frames, gaps, "behind live" and the pointer's round trip are measured where the
  agent runs. A cause put on "this agent's own downlink" means rerun from a better link before blaming the host.
- **The agent decodes nothing.** A person's decoder, paint and window are not measured; `viewport` (the encode follows
  a person's window) is, and is put on the viewer. If nothing crosses a threshold and it still looks bad to them,
  the cause is on their side -- have them record a trace (Ctrl+K → Diagnostics) or run the check from their machine.
- **`wspath` in the pointer phase is not a finding**: the agent sends moves over the WebSocket; a console uses UDP.
- **No host records**: a Linux host emits no trace, and a relay before ScreenMirror 2.243.0 refuses the trace switch
  for an agent -- the answer says which. The arrival side is still judged.
- **Do not run it while someone is in the middle of something.** The card covers the screen for about a minute.
- Compare only like with like: the same phases, from the same place. Run-to-run noise is real (the margins in
  `compare` are there for it); one run is evidence, not proof -- run twice before claiming a small change.

## Evidence

The check, its causes and its comparison are exercised offline by `tests/quality.js` (a synthetic run with known
faults, each with its control; the real card compiled with PowerShell 5.1 on Windows and its marker found where the
agent looks). A live run's numbers belong here once one has been done on a real machine -- add the date, the kind of
machine and what it found.

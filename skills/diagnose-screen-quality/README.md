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
- **Check the raw seconds before you report a cause.** `node core/quality.js <file> --json`, or ScreenMirror's
  `tools/trace-report.js <file> --phase <name>`. The first live run's summary held two lines its seconds did not
  support (both fixed in the reading since): "no cursor came back" while the agent's own copy of the stream was paused,
  and "refinement ignored" for a quantiser that was stepping 49 → 42 → 34.
- **A capable GPU can still mean a software encoder.** `hw:0` on a machine with a GPU that encodes H.264 (Intel UHD,
  for one) means the host is not using it. A host that sends `hwwhy` says why, and the encoder cause names the reason
  with its fix: preferHardware off, no hardware encoder, none would start, a hardware encoder that refused the capture
  device, or a GDI or wall capture. On an older host, the machine's Health events say how it captures ("capturing via
  …" -- GDI capture forces the software encoder). A headless machine whose screens are virtual displays is the case to
  suspect. With the run-commands consent, `Get-CimInstance Win32_VideoController` and `WmiMonitorID` (root\wmi) say
  which GPU and which monitors there are, read-only.
- **"A keyframe nothing explains" is two questions until the host counts its requests.** A host that sends `kreq`
  counts the keyframe requests it spent (a viewer joining or resyncing, a relay backlog drop), and the keyframe causes
  then say which: asked for, or inserted by the encoder itself. On an older host, the cause leaves both open.
- **A look before the check may show someone's private screen.** Use it to decide whether to start, then delete it;
  never post it. The report is the result -- say in the chat why there is no picture.
- **"The rate is held" has two owners.** Before calling the ABR at fault, read who was congested. A voting watcher's
  console that reported congestion the relay handed to the host (`rate-viewer`) means the host slowed the shared stream
  for that watcher, and the fix is on their side. Only a rate held with nobody congested (`rate-held`) is the ABR not
  rising.
- **No quantiser is not a sharp picture.** A hardware encoder may give the host no quantiser reading (Intel's Quick
  Sync MFT reports `qp` 0, "not measured", in every second). Phases then read "not measured", one `qp-unmeasured`
  cause says so, and the rate causes judge by the data each moving frame got instead (`Motion is starved: N kb a
  frame`, under 0.05 bits a pixel). A comparison against a run that had a quantiser counts the data per frame in its
  place. Don't report "sharp" or "better" off a run where the quantiser was not measured.
- **The MCP server learns a new verb only when it restarts** (`/mcp` → reconnect). Until then the kit's own client
  runs it: `node core/agent-join.js --host <n> --task "…" --control --shell --serve work/<visit>`, commands through
  `<visit>/cmd.json`, answers in `done.json`.

## Evidence

The check, its causes and its comparison are exercised offline by `tests/quality.js` (a synthetic run with known
faults, each with its control; the real card compiled with PowerShell 5.1 on Windows and its marker found where the
agent looks).

**First live run, 2026-11-09**: a headless Windows 11 mini PC (a 4-thread Celeron, Intel UHD graphics, both screens
virtual displays), the full suite with keyboard-and-mouse and run-commands, 87 s, every record kind present (84 host,
86 relay, 87 arrival seconds, 578 frames), the card seen. What it found, each checked against the raw seconds:
- the stream encoded in **software** (encode p95 ~40 ms against a 33 ms frame): scrolling at ~15 fps, video at ~5;
- a watcher's console window 910 rows tall set the encode to 84% of the screen (`viewport`);
- motion at QP 37–41 on ~2.9 Mb/s offered while the uplink was ~1% busy (the rate, not the network);
- a keyframe every 2–3 s whenever anything moved, at GOP 300, with no refinement, rebuild or drops behind them;
- after heavy motion a still screen recovering in ~3 s refinement steps (QP 49 → 42 → 34).
It also found five faults in the check itself, fixed after it: the agent's stream paused itself mid-check (pictures
taken while waiting for the card armed the re-pause), the card ran ~1.1 s ahead of the phase marks (its corner was
seen late; it now starts on a click there), the pointer phase began while the card was still closing, and two
readings (recovery taken for "ignored", a keyframe share of almost nothing).

**Runs 2–5, the same machine, nothing changed on it** -- the loop of fix, run, read the raw seconds, fix:
- run 2 proved the fixes (card in sync, frames in every phase) and measured the pointer for the first time: ~360 ms
  median round trip on the agent's path. Its comparison with run 1 read "12 worse", and none of that was the machine.
  compare learnt to keep arrival figures, the idle phase, tiny latencies and still keyframe shares out of the verdict,
  and to say when two runs come from different versions of the check.
- run 3: the card's own counts showed the stream really dropping frames: 43 drawn and 14 carried while scrolling.
  They also showed the card itself drawing its video scene at 3.4 fps on this Celeron. The video frames are now
  prepared, and the scene draws ~40.
- run 4: a watcher's window made the encode full-size. compare learnt that a different encode size is a different
  picture, and the reading learnt "refreshes held to the bitrate cap" from "refinement ignored".
- run 5 against run 4, the same check on an unchanged machine: **the picture as sent is the same**, while delivery
  to the agent (its own link) varied on its own line.

All five runs, re-read with the final check, name the same causes:
- software encoding;
- the rate held while the uplink is idle;
- a keyframe every ~3 s that nothing explains;
- the watcher's window, in four of the five;
- a still screen that recovers slowly or is held to the cap after the load;
- the stream carrying ~a third of what is drawn, from run 3 on;
- the pointer at ~400 ms p95, from run 2 on.

**Runs 6 and 7, after the host's trace said why** (2026-11-10):
- run 6: `hwwhy` was `cfg` in all 89 seconds: the host had been started with preferHardware off. The encoder was
  Microsoft's software one, and the keyframe every ~2 s during motion was its own (none was asked for).
- run 7, with preferHardware on: Intel Quick Sync. Motion went from ~16 to ~27 frames a second, and the delay behind
  live from 200–300 ms to 24–43 ms. But the host reported no quantiser, and the check called every phase sharp and the
  comparison "better" -- while the rate stayed at 1.75 Mb/s with the uplink idle, so each moving frame got ~55 kb
  against the software encoder's ~196. The person watching saw it worse. The reading now says "not measured", names
  the starved motion, and compares the two runs as mixed.
- run 7 also showed the "carried" cause blaming a 30 fps stream for not carrying all 52 frames a second the card drew.
  It now counts against what the stream may send.

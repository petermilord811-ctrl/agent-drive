---
name: Recover a stuck session
when: blank page, dead browser, hung socket, or the relay moved — the session broke
tags: recovery, troubleshooting, session
---
# skill: the session broke

Match the symptom.

## Page is blank white (browser chrome still draws)
The renderer wedged (often after maximizing, or heavy ads). It usually won't repaint on reload.
- First check it's not just the window maximized — **restore to default size**.
- If still blank: **restart the browser.** No shell through serve to `pkill`, so close the window
  (click its ✕) and relaunch from the taskbar. After a restart it renders again.
- Recurs on the same site? **Switch browsers** (Firefox), if the operator named none — check it's
  installed first (Konsole: `which firefox`).

## A command times out; `cmd.json` sits unconsumed
The socket dropped — almost always because the host's **relay moved** and the live session didn't
follow it. In `--serve` the client **reconnects itself**, so the first move is **look, don't kill**:

1. Read the work dir:
   - **`reconnecting.json` present** → it's redialing. Wait.
   - **`reconnect.json` present** → `{code, relay}`: **give that code to the operator** and wait. The
     `cmd.json` you already dropped runs the moment someone presses Allow.
   - **`ready.json` gains `reconnected: N`** → back in; it's already working through the queue.
   - **`stopped.json`** → not a glitch: a person *revoked* the grant. Don't reconnect — the task is
     over unless they re-grant.
   - **`stalled.json`** → it gave up (no listed relay had the host, or the code expired). Now you step in.
2. Only on `stalled.json` (or a genuinely wedged client process): ask the operator for the current
   relay, add it to `SM_RELAYS` (or pass `--relay`), and relaunch. If the process is stuck, kill it:
   `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*agent-join*' } | % { Stop-Process -Id $_.ProcessId -Force }`

List the relays the host drifts between in `SM_RELAYS` up front, and most moves reconnect with no code
at all (the client finds the host on a fallback). See [../../config/connection.md](../../config/connection.md).

## `no-host` when connecting
The host isn't on that relay — offline, or moved. Ask the operator which relay it's on now (use the
sslip **name**, not the raw IP).

## The screen changed size mid-session
Every coordinate is now wrong and the client refuses actions. Reconnect and re-measure.

## Navigating away does nothing
A `beforeunload` page (e.g. sudoku.com) is holding the tab. Open a new tab (`chord ControlLeft KeyT`)
or close the tab.

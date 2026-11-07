# docs/reference/serve-protocol.md — the serve channel and its verbs

`agent-join.js --serve <dir>` holds one grant open and runs commands dropped as files:

- you write **`cmd.json`** → the client runs it → writes the result to **`done.json`** (with `ms`,
  `bytes`, `trips`) and appends to **`ledger.json`** (the record of what actually happened). `done.json` is
  written whole (temp file + rename), so a reader never sees half an answer; a command's **`cid`** (your own id
  for it) comes back on its answer. Every successful command is also kept in **`steps.jsonl`** with its
  milestone, for [drive/replay.js](../../drive/replay.js).
- **watch-only visits:** `--serve` without `--control` looks, reads and talks; an acting verb comes back
  `needs:"control"` (ask with `access {control:1}`). **`--parent-pid <pid>`**: if that process dies, the visit
  hands the grant back by itself (the MCP server passes its own). While the first Allow card waits, its code is
  in **`join.json`** `{code,relay}`.
- `drive/drive.js <dir> '<cmdJson>'` does one full cycle (clears `done.json`, writes `cmd.json`, waits,
  prints the answer).
- **status files** the client writes for the driver to read between commands: **`ready.json`**
  `{w,h,host}` once it's serving (re-written with `reconnected:N` after a reconnect); **`stopped.json`**
  when a person *revoked* the grant (the run is over); and, while a dropped socket is being recovered,
  **`reconnecting.json`** (redialing) then **`reconnect.json`** `{code,relay}` — the new Allow code to
  surface to the operator — or **`stalled.json`** if it gave up. See
  [config/connection.md](../../config/connection.md) for the full reconnect flow.
- **the pictures a visit takes leave with it.** Every picture the serve writes (`shot`, `look`, a `look:{}` on an
  action) and every picture posted to the chat from the work folder is listed in **`captures.json`**, and all of
  them are deleted when the visit ends — `done`, `quit`, Stop, a revoke or a crash (a list a crashed run left is
  cleared when the next visit starts in that folder). `keep:1` on a `shot`/`look` keeps that one;
  **`--keep-captures`** (or `SM_KEEP_CAPTURES=1`) keeps them all — only when the operator asked to keep them.
- **the agent does not watch the video.** After joining it pauses its copy of the stream (`idle`): pictures still
  come on request, and so do chat, `exec` and the roster, but the relay no longer sends it every frame, no longer
  keeps the host capturing for it alone, and no longer counts it in the picture-quality vote. A host that cannot
  take a picture while nobody streams (an Ubuntu Wayland desk) refuses in words, and the stream is woken for that
  picture. `--no-idle` (or `SM_AGENT_IDLE=0`) keeps the stream on.
- **a relay whose name stops resolving** is dialled at the address it last had (`work/relay-ips.json`; an
  sslip.io name carries its own) — the certificate is still checked against the name.

Every command is `{ "do": "<verb>", ... }`. Coordinates are **screen pixels** at the served size — or,
as `lx`/`ly`, pixels of the **last `look`** (below), which the serve maps to the screen for you.

**Every command is checked before it runs** ([core/verbs.js](../../core/verbs.js); `node kit.js verbs` prints
the table). A field the verb does not read used to be silently ignored — live on 10002,
`{"do":"keys","keys":"chrome"}` typed *nothing* and answered `ok` fifteen times. Now:

- a **common slip is renamed** and the answer says so in **`fixed`** — `keys.keys`→`text`, `key`→`press`
  (or `chord` with a modifier), `sleep`→`pause`, `"esc"`→`"Escape"`, `"ctrl+shift"`→`"ControlLeft+ShiftLeft"`.
  Read `fixed` and write the real name next time;
- **any other unknown field is refused** with `refused:true`, the verb's real fields and a "did you mean";
  nothing is sent to the machine, not even its narration;
- a **missing required field is refused** (keys with no text, a click with no point, open with no url);
- a **`plan` is checked whole** before its first step, so a slip at step 9 never leaves steps 1–8 done
  (`stoppedAt.at` is the step's index).

### Every verb at a glance

The table below is the checker's own table, generated from [core/verbs.js](../../core/verbs.js); the sections after
it explain each verb.

<!-- verbs:begin -- generated from core/verbs.js by `node kit.js verbs --write-doc`; do not edit by hand -->

| verb | its fields (any other is refused) | what it does | renamed for you, and said so in `fixed` |
|------|------|------|------|
| `click` | `x` `y` `lx` `ly` `at` `dx` `dy` `fast` `look` | left click at a point |  |
| `clicks` | `at` `fast` `look` | many left clicks, one round trip |  |
| `dbl` | `x` `y` `lx` `ly` `at` `dx` `dy` `look` | double click | `doubleclick`, `double-click`, `dblclick` |
| `right` | `x` `y` `lx` `ly` `at` `dx` `dy` `look` | right click | `rightclick`, `right-click` |
| `clickText` | `text` `rect` `nth` `as` `lang` `dx` `dy` `fast` `look` | read the screen, find a word and click it |  |
| `keys` | `text` `human` `speed` `look` | type text into the focused window -- like a person by default (human:0 = instant) | `type`, `write`, `keys`→`text`, `value`→`text`, `string`→`text`, `chars`→`text`, `input`→`text`, `person`→`human`, `natural`→`human`, `pace`→`speed` |
| `press` | `code` `n` `look` | press one key (n times) | `key`, `key`→`code`, `keys`→`code`, `name`→`code`, `times`→`n`, `count`→`n`, `repeat`→`n` |
| `chord` | `mod` `code` `look` | modifier(s) + key, e.g. Ctrl+Shift+Escape | `key` with a `mod`, `hotkey`, `combo`, `shortcut`, `key`→`code`, `keys`→`code`, `modifier`→`mod`, `mods`→`mod`, `modifiers`→`mod` |
| `open` | `url` `wait` `tab` `human` `speed` `look` | type a URL into the browser (tab:1 = in a NEW tab) | `navigate`, `goto`, `href`→`url`, `link`→`url`, `address`→`url`, `newTab`→`tab`, `new_tab`→`tab` |
| `scroll` | `x` `y` `lx` `ly` `n` `look` | mouse wheel at a point | `notches`→`n`, `delta`→`n`, `amount`→`n` |
| `stroke` | `points` `ms` `look` | a held drag |  |
| `strokes` | `list` `ms` `look` | many held drags |  |
| `pause` | `ms` `look` | wait a fixed time (a wait on a pixel is better) | `sleep`, `delay`, `wait`→`ms`, `time`→`ms`, `duration`→`ms`, `delay`→`ms` |
| `quit` | — | hand the grant back, no sign-off |  |
| `look` | `out` `rect` `max` `settle` `keep` | a fresh picture sized for reading (long edge <= max, 1280 by default), with the scale back to screen pixels | `view`, `file`→`out`, `path`→`out`, `to`→`out`, `size`→`max` |
| `shot` | `out` `keep` | the whole screen, full size, as a PNG | `screenshot`, `capture`, `file`→`out`, `path`→`out`, `to`→`out` |
| `hold` | — | a new picture -- its identity only (~5 KB) |  |
| `see` | `rect` | decode the held picture down to a rectangle |  |
| `ocr` | `rect` `lang` `boxes` | the words in a rectangle |  |
| `find` | `text` `rect` `as` `nth` `lang` `all` | where a word is; remember it under `as` |  |
| `probe` | `x` `y` `lx` `ly` | one pixel |  |
| `census` | `rect` `cap` `min` | the connected regions in a rectangle |  |
| `flood` | `x` `y` `bound` | where a bucket fill would go |  |
| `mark` | `rect` | the baseline changed/stable/diff compare to |  |
| `diff` | `rect` | what moved since the mark |  |
| `liveness` | `rect` | is the capture live, blank or frozen? |  |
| `expect` | `until` | is the predicate true now? |  |
| `wait` | `until` `poll` | poll until true, or time out |  |
| `plan` | `steps` | many steps in one command; if/then/else and repeat/until; stops at the first that fails |  |
| `mission` | `op` `plan` `t` `step` `steps` `m` `milestone` `before` `after` `now` `to` `done` `check` `into` `file` `say` `w` `h` `skill` `goal` `milestones` `preview` `checkpoints` `checkpoint` `replay` | the job's big plan (drive/mission.js); preview:1 asks the room before it starts, checkpoints:1 after each milestone; ask asks again |  |
| `chat` | `text` `to` | say it in the session chat | `say`, `message`, `message`→`text`, `msg`→`text`, `body`→`text` |
| `chat-img` | `file` `text` `to` `name` `w` `h` | post a picture to the chat | `path`→`file`, `image`→`file`, `img`→`file` |
| `chat-wait` | `since` | wait for the next human reply |  |
| `seen` | `ids` `to` | mark the operator's messages read |  |
| `typing` | `on` | show "typing…" while composing |  |
| `inbox` | — | the operator's recent messages |  |
| `ping` | — | is the session alive? |  |
| `reconnect` | — | drop the socket and dial again |  |
| `status` | `text` `steps` `at` `tree` `fin` `task` `step` `substep` `say` `file` `w` `h` `thought` `next` `conf` `warn` `stat` `sub` `subAt` | the progress panel: task/step/substep, a tree, a finish |  |
| `think` | `thought` `text` `conf` `next` | the panel's thought: your reasoning, shown above the plan (conf "low" marks it unsure); `why` on any command does the same at no extra turn |  |
| `warn` | `text` | a caution line on the panel |  |
| `confirm` | `text` | ask before something hard to undo; a no always wins | `message`→`text`, `msg`→`text`, `question`→`text` |
| `captcha` | `text` | a CAPTCHA is for a person: ask the operator in chat to solve it, and wait for their reply -- never solve one | `recaptcha`, `hcaptcha` |
| `budget` | `steps` `minutes` `more` | the task's budget of acting steps and minutes: {} shows it; a lower limit is taken; a higher one, or more:1 once it is spent, is asked of the room |  |
| `done` | `text` `file` `w` `h` | sign off (with a picture) and hand the grant back |  |
| `note-list` | — | the host's sticky notes |  |
| `note-add` | `text` `x` `y` | leave a sticky note | `message`→`text` |
| `note-done` | `id` `undo` | cross a note off |  |
| `spotlight` | `x` `y` `r` `rect` `circle` `cx` `cy` `points` `close` `rounds` `laps` `times` `speed` `forever` | circle a thing for the watchers, at a person's pace |  |
| `beam` | `x` `y` `size` `hold` `forever` | dim the watchers' picture except a circle |  |
| `spotlight-off` | `x` `y` | clear the beam |  |
| `lock` | `on` | take / release exclusive control |  |
| `windows` | — | the open windows: title, process, rect, which is in front -- and the monitors (needs shell) | `list-windows` |
| `focus` | `title` `id` `dry` `look` | bring a window to the front by (part of) its title, or its id (needs shell) | `activate`, `bring-to-front` |
| `launch` | `app` `args` `cwd` `wait` `focus` `dry` `look` | start an app by name, path or URL, as the signed-in user, and find its window (needs shell) | `start`, `open-app` |
| `controls` | `title` `id` `max` `depth` `budget` | the controls of a window by NAME (UI Automation / AT-SPI): name, type, rect, cx/cy to click -- never a value; password fields flagged (needs shell) | `ui`, `accessibility` |
| `terminal` | `open` `input` `keys` `signal` `close` `wait` `until` | the Terminal panel shell, shared with everyone watching: type a line or keys, read what it prints (needs the terminal consent) | `term`, `console` |
| `access` | `shell` `control` `terminal` | ask the operator for MORE access mid-visit -- a new Allow card; nothing changes unless they press Allow | `ask-access`, `request-access` |
| `exec` | `cmd` `text` | run one command on the host (needs --shell) | `run`, `shell`, `command`→`cmd`, `line`→`cmd` |
| `changes` | `all` | what this task changed on the machine (all:1 -- this visit), each with whether and how it can be put back |  |
| `undo` | `id` `dry` | put one change back: a command after the room's yes (or because they asked: "undo c3"); a change put back by hand comes back as the how; dry:1 shows the command only | `change`→`id`, `ref`→`id`, `which`→`id` |
| `changed` | `what` `undo` | record a change you made by clicking (a setting, a toggle) and how it is put back -- it joins the task's record | `text`→`what`, `change`→`what`, `revert`→`undo`, `back`→`undo` |
| `fetch` | `path` `out` | copy a file FROM the machine to here, in chunks (needs shell; said in the room) | `from`→`path`, `source`→`path`, `file`→`path`, `dest`→`out`, `save`→`out`, `to`→`out` |
| `send` | `file` `to` `overwrite` | put a file from here ON the machine (needs shell; said in the room) -- never over one that is there unless overwrite:1, which asks the room | `from`→`file`, `source`→`file`, `path`→`to`, `dest`→`to` |
| `camera` | `out` `device` `keep` | one photo from the machine's webcam -- the room is asked first, every time, and only a yes allows it (needs shell) | `file`→`out`, `path`→`out`, `to`→`out`, `camera`→`device` |
| `audio` | `out` `seconds` `keep` | up to 7 s of what the machine is PLAYING (never the microphone) -- the room is asked first, every time, and only a yes allows it (needs shell) | `file`→`out`, `path`→`out`, `to`→`out`, `secs`→`seconds`, `duration`→`seconds` |

Every command may also carry: `intent` `quiet` `expect` `show` `secret` `note` `fresh` `timeout` `why` `cid`.
<!-- verbs:end -->

## Acting (needs `--control`)

| verb | what it does |
|------|--------------|
| `click {x,y}` / `clicks {at:[[x,y],...]}` | left click one / many |
| `clickText {text,rect?,nth?}` | OCR the screen, find that word and CLICK it — no hand-measured x/y (it's `find` + `click` in one; `rect` limits where to look, `nth` picks among matches, `as` also remembers it) |
| `right` / `dbl` {x,y} | right-click / double-click |
| `keys {text, show?, secret?, human?, speed?}` | type text (window must have focus). The progress panel shows only its SHAPE ("typed 11 characters") unless `show:1` (a URL, a search term); `secret:1` hides it whatever else is set. **It types LIKE A PERSON by default** — the viewer's own Type-window planner ([core/autotype.js](../../core/autotype.js), copied character for character): a typist's rhythm, pauses at clause ends, the odd slip onto a neighbouring key fixed with Backspace; `speed` `slow` / `normal` / `fast` (≈40 / 70 / 105 words a minute). It takes as long as a person would, and stops when the operator writes (`stoppedAt`). **Everyone watching sees ScreenMirror's own "is auto-typing" card** under the agent's name while it types (`spot {k:"at"}`, as a colleague's Type window raises it), and **a person who presses a key stops the run** (`stoppedAt.tookKeyboard`) — they took the keyboard. **`human:0`** is the machine's instant typing (with a `speed`, the even robot pace); `--type-instant` / `SM_TYPE_HUMAN=0` makes instant the default for a whole visit. On a host that drops characters, `drive/type-text.js` (one key per command; `--show` / `--secret` / `--intent`) |
| `press {code}` | one key, e.g. `Enter`, `Backspace`, `F5` |
| `chord {mod,code}` | modifier + key, e.g. `ControlLeft` + `KeyT` |
| `open {url, wait?, tab?, human?, speed?}` | Ctrl+L (Ctrl+T first with `tab:1`), type the URL — like a person at the fast pace unless `human:0` — Enter, wait ms (needs a focused browser) |
| `scroll {x,y,n}` | wheel n notches at a point (n<0 = down) |
| `stroke {points,ms}` / `strokes {list}` | a held drag / many drags |
| `pause {ms}` | wait a fixed time (≤30 s; `sleep` is renamed to it). A `wait` on a pixel is better — it returns the moment it is true |
| `quit` | hand the grant back with no sign-off (prefer `done`) |

Any acting verb may carry **`expect: <predicate>`** — it's only `ok` when the screen agrees afterwards.
A pointer verb may use `at:"<name>"` to aim where `find` last saw a word, or **`lx`/`ly`** to aim in the
last `look`'s pixels. Any acting verb may also carry **`look:{out,rect?,max?,settle?}`**: after the act (and its
`expect`), a picture of the result rides on the answer as `look` — act and see in ONE round trip (`settle`
defaults to 300 ms here). A failed look does not undo the act; check `look.ok`.

## Looking

| verb | what it does |
|------|--------------|
| `look {out, rect?, max?, settle?, keep?}` | **the picture to read with vision.** A fresh capture, cut to `rect` (screen pixels), shrunk so its long edge is ≤ `max` (1280 by default; never enlarged), written to `out`. Answers `{w,h,scale,at,region,screen}`: `scale` is screen pixels per look pixel. Then **click what you saw in the picture's own pixels** — `click {lx,ly}` (also `dbl`, `right`, `probe`, `scroll`) — and the serve maps them back: a model reading a shrunk screenshot otherwise answers in the shrunk pixels and the click lands short. `settle` waits ms first (≤5 s). A point outside the look is refused. With a `rect`, a host that can cut the picture sends only that region (the answer says `cut:"host"` — a fraction of the bytes); an older host sends the whole screen and the serve cuts it. Deleted when the visit ends unless `keep:1`. |
| `shot {out, keep?}` | save a full-screen PNG to `out`, full size (prefer `look` for reading). Deleted when the visit ends unless `keep:1` (or `--keep-captures`). |
| `hold` | take a new picture, keep its identity only (~5.5 KB), decode nothing |
| `see {rect}` | decode the held picture only down to `rect` |
| `ocr {rect,boxes}` | the words in `rect`, read on the host; `boxes` returns per-word boxes |
| `find {text,rect,as}` | where a word is; remember it under `as` to aim at later |
| `probe {x,y}` | one pixel's colour |
| `census {rect}` / `flood {x,y}` / `mark` / `diff {rect}` | connected regions / fill preview / baseline / what moved |
| `liveness {rect?}` | is the capture live, or dead? Measures, no recognizer: **blank** (near-solid — a maximised window / half-loaded page), **frozen** (all but identical to the frame before it), **live** / **static** (content, with motion proven / unproven), or **unknown**. Returns `{state, ok, advice}`. It compares to the PREVIOUS frame, so call it **twice** for a real freeze check; a single call right after an action reads best as "not blank" rather than "updating" — a confident **live** needs a prior frame to prove movement. |

**OCR needs Tesseract ON THE HOST.** `ocr`, `find` and `clickText` read the words on the host machine, so
a host without Tesseract answers *"Tesseract ... is not installed"* (seen on host 10004). There, fall back
to **coordinate clicks** — or just **read the screenshot yourself** (you already have it from `shot`/`hold`)
and click the pixel; the driver's own eyes don't need the host's OCR. One failing `find` tells you to stop
reaching for the text verbs on that host.

## Knowing

| verb | what it does |
|------|--------------|
| `expect {until}` | is the predicate true now? (takes a fresh picture) |
| `wait {until,timeout,poll}` | poll until true, or report it never became true |
| `plan {steps:[...],quiet}` | many steps in one command; supports `{if,then,else}` and `{repeat,until,steps,poll}`; stops at the first step that fails. A plan may carry **`status` steps**: the panel's count climbs inside ONE command (the sudoku fill sends its 56 answers and five counts as one plan, not a round trip per chunk) |

**Predicates:** `{px:{x,y,is:'#rrggbb'}}` · `{any|none:{rect,is}}` · `{text|notext:{rect,has}}` ·
`{changed|stable:{rect,min}}`.

## Talking to the operator (session chat)

| verb | what it does |
|------|--------------|
| `chat {text, to?}` | say it in this host's session chat — the room (all viewers), or `to:"<tag>"` for a DM |
| `chat-img {file, text?, to?}` | post an **image** (a cropped screenshot) to the room. The driver prepares a small PNG/JPEG **file** (`vision/crop.py`); this inlines it as a `data:` URL, capped at ~45 KB — name the crop `.jpg` and crop.py shrinks it to fit, or it's rejected with the size. Posting one pays a result picture a finish still owes (see `status` `file`). |
| `chat-wait {timeout?, since?}` | block for the next human reply (not the agent's own echo, not system notices). Use it right after `chat` to ask a question and wait for the answer. |
| `seen {ids?}` | mark the operator's message(s) **read** — posts a receipt so their chat shows "seen". No `ids` = all unread. The incoming ids are logged in `chat.json`. |
| `typing {on}` | show / hide **"Claude typing…"** while you compose a reply. It repeats on a beat until you send a message (`chat`/`chat-img`/`done` clear it) or `typing {on:false}`. |
| `inbox` | the operator's recent messages (every answer also carries `inbox:{n,latest}`) |
| `think {thought, conf?, next?}` / `warn {text}` | the panel's **thought**, pinned above the plan: your reasoning, with `conf:"low"` marking it unsure and `next` what you will do after it. A new thought replaces the last one whole (`think {next}` alone updates only that). **`why:"…"` on any command** (or batch step) sets the same thought in the same call — no extra turn; a `quiet` command's is ignored. A thought lasts until the next one, or until a task, step or sub-step is declared, a flat plan moves, a mission moves on, or the task finishes. / an amber caution line (`warn {text:""}` clears it) |
| `ping {timeout?}` | is the session still alive? Returns in seconds (`{alive:true}`), so a stale session (e.g. after a relay move) is found fast instead of a 30s stall per command. |
| `status {text?, steps?, at?, tree?, fin?, task?, step?, substep?}` | drive the **progress panel** every watcher sees — no action, and replayed to anyone who opens the machine mid-task. `text` = the live line. **`task` / `step` / `substep`** name the levels of the **action tree** the serve builds itself when no `tree` or `steps` is sent (see below; `step:null` / `substep:""` end one). **`tree`** = a NESTED plan the panel renders indented, with a **live elapsed time per step**: an array of `{t: label, s: "done"\|"doing"\|"todo"\|"warn", k: [children]}` — a big step, its small steps, a sub-step, the command underneath (depth ≤4, ≤60 nodes). Send the whole tree again on every change (flip finished→`done`, next→`doing`); times accumulate by label. `steps`+`at` is the flat quick version: `steps` = a list of short labels, `at` = the current step (0-based); the panel shows done ✓ / current (+ `text`) / **next** / upcoming + "step N/M". **`fin:1`** settles the panel **green** (task complete) **without ending the session** — unlike `done`, which hangs up the grant. The next live frame lifts the green. **`file`** (with `fin:1`): the **picture of the result** (a `.jpg` crop under ~45 KB) rides IN the finish report — one chat message: the report, the picture, "Anything else, or shall I sign off?"; the answer says `img:true`, or `img:false` + `imgWhy`. **A task that finishes with no picture in chat owes one:** every answer then carries **`remind`** until a `chat-img` pays it or new work starts. |
| `confirm {text, timeout?}` | gate a dangerous action: announce it to everyone and wait. Returns `{verdict, replies}` — `cancelled` on any negation, deferral or hesitation anywhere in a reply ("no", "not sure", "later", "go back first", "let me think", the Stop button, a Steer) — **even after a yes**; `approved` only on a SHORT reply made of nothing but yes-words ("yes", "ok do it", "go ahead", 👍); anything else `unclear` ([core/consent.js](../../core/consent.js)). Treat `unclear` as **no** for a real restart/shutdown. With **`--auto-confirm`** (or **`SM_AUTO_CONFIRM`** truthy) the operator has pre-approved: it still announces and still waits, a stop still wins, and only a window **nobody answered at all** comes back `approved` with **`auto:true`** — a reply it could not read stays `unclear`. |
| `captcha {text?, timeout?}` | **a CAPTCHA is for a person.** Says in the session chat that one is on the screen and needs solving (your `text`, or a standard ask: "Please solve it — I won't touch it — then reply **done**"), puts it on the panel, and waits for the operator's reply (`timeout` ms, default 10 min, at most 30). Answers `{solved, text, next}` — `solved:false` when their reply is a no ("can't", "skip it"); then read it, and still never try the CAPTCHA yourself. A timeout is `ok:false, timedOut:true`. Never solve, bypass or click through one: a `mission` plan that mentions a CAPTCHA is answered with this rule as `human`. |
| `done {text?, file?}` | post a sign-off to the room (`file` attaches a final cropped screenshot, like `chat-img`), then **hand the grant back and end the run** — the clean way to finish. |

**Arriving and leaving.** Serving begins with an automatic hello to the room drawn from `--task`
("Hi! I'm here to … Starting now …") and raises the progress panel at once; `--announce "<text>"`
overrides the hello and `--no-announce` drops it. **Each task in between** is planned as a mission (below: the
plan posted, worked milestone by milestone, finished with the report and the picture of its result) — or, for a
one-step task, opens with its own `chat` line ("▶ **Starting:** …") and closes with `status {fin:1, say, file}`.
Finish the VISIT with **`done`** so the watchers get a sign-off (and, with `file`, a last cropped screenshot)
and the grant is handed straight back.

## The job's plan (`mission`)

The big plan, kept by the serve (`core/mission.js`) rather than in the driver's head: a goal, milestones that each say
what will be on the screen when they are done, and the short steps under each. `drive/mission.js` is the one-liner
front end; the verb is `{do:"mission", op:"…", …}`. The plan is drawn on the panel (the action tree in plan mode:
every milestone in plan order, the future ones too, the current one open with its steps and actions, proof under the
achieved ones), said in the room, and written to `<serve-dir>/mission.json` after every change.

| op | fields | what it does |
|---|---|---|
| `plan` | `plan:{goal, done?, milestones:[{t, done, check?, steps?, skill?, checkpoint?}]}`, `why?`, `preview?`, `checkpoints?`, `timeout?` | Takes the plan — refused unless every milestone has a `done` (what will be on the screen). Posts it to the room, draws it, starts the first milestone. Over a plan already under way it needs a `why`, and keeps what was already achieved. **`preview:1`** posts it as a question ("Shall I go ahead?") and waits `timeout` (default 60 s): the answer carries `preview {verdict, replies, auto}`, and anything but a yes HOLDS the job (`waiting:true`). **`checkpoints:1`** (or `checkpoint:true` on a milestone) asks after each milestone the same way. A new plan is a new task: its budget starts again. |
| `ask` | `why?`, `timeout?` | The job is held (a preview, a checkpoint): ask the room again. A yes they gave after the last question counts; a new `why` re-posts the question with it. `{verdict, replies, waiting}`. |
| `step` | `t` | Begin a short step of the current milestone (one nobody planned is added where the work is); `t:""` ends it. |
| `steps` | `m?`, `steps:[…]`, `why?` | Rewrite a milestone's short steps. |
| `achieve` | `m?`, `check?`, `file?`, `note?`, `timeout?` | Prove it: the milestone's `check` (or this `check`) must hold on a FRESH picture, polled up to `timeout` (default 2000 ms); with no check, `file` (a picture of it) is the proof and goes to the room with the ✓ line. Achieved → said in the room, the next milestone starts. Not → `ok:false` with what the check saw, and the miss is counted. |
| `add` | `t`, `done`, `check?`, `steps?`, `before?` / `after?` / `now?`, `why` | A new milestone (default: after the current one). Before the current one = it has to happen first: it becomes current and the other waits. On a finished job it re-opens the job (a follow-up). |
| `change` | `m`, `to?`, `done?`, `check?`, `steps?`, `why` | Rename or redefine a milestone (its row keeps its history). Changing what proves an achieved one opens it again. |
| `split` | `m`, `into:[{t, done, …}, …]`, `why` | One milestone becomes several; the first carries it on. |
| `skip` / `fail` | `m`, `why` | Not needed / cannot be done — said in the room; the plan moves on, and the report keeps it. |
| `finish` | `file?`, `say?` | Every milestone achieved, skipped or failed → the report (one line per milestone, its time or reason, how often the plan changed), the picture and "Anything else, or shall I sign off?" as ONE message, panel green. Refused, naming them, while any is open. A job with nothing failed, that no skill did and that is not a replay (`replay:1` on its plan) comes back with **`draft {name, dir, milestones, commands, typed, secrets}`**: it was saved as a draft skill in `skills/_drafts/<name>/` (`node drive/replay.js promote <name> --yes` after a person has read `typed`; `--no-drafts` turns it off). |
| `show` · `resume` · `drop` | `why` for drop | The plan as text · reload `mission.json` after a restart · abandon it (said in the room). |

`m` is a milestone's number ("3"), its id ("m3"), `current`, `next`, or part of its name. `add`, `change`, `split`,
`skip` and `fail` need a `why` — the plan never changes silently. **Every answer while a job is planned carries
`mission`** (`{goal, done, of, at, when, step, acts, tries}` — the current milestone and what will prove it) and, once
per threshold, a **`hint`**. **While the job is held** (`mission.waiting`), every acting command is refused with `waiting:true` and nothing is sent; looking, talking and changing the plan still work. The hints: a milestone that missed its check twice (change the approach, replan, or ask), three
times (ask the operator), a run of three failed actions (look before acting again), or 40+ actions without being
achieved. Inside a planned job `status {step}` / `{substep}` land as a short step of the current milestone, a
`status {task}` naming another job drops the plan, and a bare `status {fin:1}` with milestones still open is answered
with a hint. A tool that finishes its part mid-job (a `fin` from its own tree) reports to the room without the
sign-off question — the job is not over.

## Sticky notes

| verb | what it does |
|------|--------------|
| `note-list` | the host's sticky notes → `{notes:[{id, text, name, resolved, x, y, kind}]}`. The agent receives notes on select (and on change), mirrored to `<serve-dir>/notes.json`. |
| `note-add {text, x?, y?}` | leave a sticky note (`x`,`y` are 0..1; default top-left). |
| `note-done {id, undo?}` | cross a task off by **resolving** its note (`undo:true` un-resolves). Works on anyone's note. |

Read tasks someone left as notes, do each (look for a skill on its text: `node kit.js skills <word>`), and `note-done` it
when finished — see [skills/work-through-sticky-notes](../../skills/work-through-sticky-notes/README.md).

## Pointing things out (spotlight / focus beam)

**Two different tools — don't confuse them.** *Spotlight* is "point & draw for co-viewers": you **ink a
shape round the thing** and pulse at it. The *focus beam* **dims** everything except a circle. A person
asking you to "spotlight it" means the first one.

| verb | what it does |
|------|--------------|
| `spotlight {shape…, rounds?, times?, speed?, forever?}` | **circle the thing for the watchers the way a person does:** the laser dot travels there, goes round it `rounds` times (default **3**) — each round its own stroke, a little wider than the last, so every round is seen — at a hand's pace (`speed` px/s, default 700; never under 1.5 s or over 2.4 s a round), then pings ON it `times` times (default **2**). `forever:1` keeps circling, a ping every third round, until the operator writes or presses Stop (30 min at most). **The operator writing ends any spotlight**, as it ends a plan: the answer carries `stoppedAt.interrupted`. `circle:false` = travel there and ping only. ~4.5 s for two rounds of a small box. (`laps` is the old name for `rounds`.) |
| …its shape, in **SCREEN PIXELS**, any one of: | `rect:[x1,y1,x2,y2]` — a **box**, for a tab/button/field (says "THIS one", not "near here"). `circle:{cx,cy,r}` or `cx,cy,r` — a **ring**, for an avatar or anything round. `points:[[x,y],…]` — **any irregular shape**, traced in order and closed (`close:false` to leave it open). Falls back to a circle of radius `r` round a normalised `x,y`. |
| `beam {x, y, size?, hold?, forever?}` | the **focus beam**: dim the watchers' picture except a circle at `(x,y)` (0..1). A watcher's beam expires in ~2s, so it refreshes for `hold` ms (default a couple of seconds; `0` = emit once) — or, with `forever:1`, until the operator writes or presses Stop. |
| `spotlight-off {x?, y?}` | stop dimming (clears the beam). |

## Windows, apps and controls — by name, not pixels (needs `--shell`)

Neither host has a verb for these, so each runs as ONE command on the host through `exec` ([core/desk.js](../../core/desk.js):
PowerShell + UI Automation on Windows, X11 tools / AT-SPI on Linux) — the visit needs the **shell** consent (ask with
`access {shell:1}`), and without it the answer is `needs:"shell"`. Rects come back in the host desktop's pixels;
every window and control also carries **`cx`/`cy`: its centre on this visit's screen**, ready for `click {x,y}`.

| verb | what it does |
|------|--------------|
| `windows` | the open windows — `{windows:[{id,title,process,pid,rect,minimized,foreground,cx,cy}], monitors, foreground}`. Start here instead of hunting the taskbar (10002 failed to start Chrome while a Chrome window sat open in its own screenshots). |
| `focus {title \| id, dry?}` | bring a window to the front by (part of) its title, or its `id` from `windows` — restores a minimized one. |
| `launch {app, args?, cwd?, wait?, focus?, dry?}` | start an app by name, path or URL **as the signed-in user** (never as the host's service account), wait up to `wait` ms for its window and bring it forward. Answers `{started, window}`. |
| `controls {title \| id, max?, depth?, budget?}` | a window's controls by NAME (default: the window in front): `{controls:[{i,p,name,type,aid,rect,enabled,focusable,isPassword,cx,cy}]}`, in document order (`p` = parent). **Never a value** — names, types and places only; a password field is flagged `isPassword` and nothing of it is read. Click a control at its `cx`/`cy`. |

Limits: on Linux these work on X11 (Wayland refuses `windows`/`focus`), need python3, and `controls` needs AT-SPI.
Reading a Chromium/Electron window's controls may switch its accessibility support on.

## What the task changed, and putting it back

Every step that changes the machine — `exec` and a `terminal` line (read by [core/undo.js](../../core/undo.js): files
moved, renamed, copied, made or deleted; services; registry values; processes ended; files written), `keys` (only how
many characters and into which window — never the text), `launch`, a file `send` put there, and what the driver
declares with `changed` — goes into the visit's record (`<serve-dir>/changes.json`), each with how it is put back: a
command, by hand, or not at all (and why). **The finish of a task tells the room** what it changed on the machine —
files, services, settings, what was declared; typed text and apps started stay in the record but not in that line,
as typing is usually the job itself — and which of it can be put back; the finishing answer carries `changes {n, list}`.

| verb | what it does |
|---|---|
| `changes {all?}` | This task's record (`all:1`: the visit's) — `{n, changes:[{id, what, reversible, how}], text}`. |
| `undo {id, dry?}` | Put one back (`id`: `c3`, or `last`). A command undo needs `--shell` and the room's yes — unless they asked in so many words after the change ("undo c3", "undo all"): that is the yes. One that deletes what was made (a copy, a new file or folder — a folder only while empty) is never taken on silence. A change put back by hand answers `ok:false` with `byHand`: how. `dry:1` shows the command. |
| `changed {what, undo?}` | Record a change made by clicking (a setting, a toggle) and how it is put back: words, or `{cmd, os}`. |

Undo several newest first. Old values (a registry setting, a file's contents) are never read, so those changes say
they cannot be put back from here.

## Files, a webcam photo, a sound recording (needs `--shell`)

Each runs on the host through `exec` — one command per step, built by [core/desk.js](../../core/desk.js) — so it needs
the visit's shell consent. What is copied, put, photographed or recorded is said in the session chat as it happens.

| verb | what it does |
|---|---|
| `fetch {path, out}` | Copy one file FROM the machine to `out` here, 360 KB a command (up to 100 MB). `{from, file, size}`. A folder, or nothing there, is refused with a reason. |
| `send {file, to, overwrite?}` | Put the file `file` (here) ON the machine at `to` (a folder means inside it, under its own name), a chunk a command — ~4 KB on Windows (up to 2 MB), ~88 KB on Linux (up to 25 MB); the last answer's size is checked. A file that is there is refused (`exists`) unless `overwrite:1`, which asks the room first. `{to, size, commands, replaced}`; a send cut short says how far it got (`partial`). |
| `camera {out, device?}` | One photo from the webcam (`device`: part of the camera's name). The room is asked first, naming the camera and your `why`; **only a clear yes allows it — never the standing yes, never silence**. `{file, size, device}` (the MCP tool returns the photo inline). |
| `audio {out, seconds?}` | 1–7 s (default 5) of what the machine is PLAYING — its sound output, never a microphone — as a WAV. Asked for the same way as a photo. `{file, size, seconds, peak, device, note?}` |

A refused photo or recording answers `ok:false` with `verdict` (`cancelled` or `unclear`) and the replies. The pictures and recordings
are captures like a `shot`: they are deleted when the visit ends unless `keep:1`.

## The board: what the room can do from the panel ([plan 07](../plans/07-the-board.md), `core/board.js`)

The panel is the people's control surface. Its buttons post chat lines that start with a mark only the panel sends; the
serve honours each **itself**, so a button works while you are busy or thinking. What it means for you:

- **Read `room` on every answer first** — what the people did on the board (paused you, stopped the task, answered a
  question, had a change put back, asked you to skip or redo a step, set the autonomy dial). It is said once.
- **A refused acting command did nothing**, and says why: `paused {by, at, why}` (wait in `chat-wait` for “▶ Go on”, then
  send it again), `held {k}` (the room stopped the task: report what is done with `status {fin:1, say}`, then wait),
  `approval {id, q}` (the autonomy dial asks before this command: wait for the answer, then send the SAME command again —
  the yes runs it once), `checkpoint` (a step ended in 'checkpoints' mode: wait for the go-ahead). Looking, talking, the
  panel and finishing are never held.
- **Questions carry ids.** `confirm`, `captcha`, `budget {more}`, a mission's preview or checkpoint and `undo`'s question are
  on the panel with buttons; a button answers only the question it was shown for. A yes counts only from the person who
  let you in (the relay tells the serve); anyone's no still wins.
- **The serve does some things itself, between your commands**: an Undo the room asked for (`↩ Undo c3`), saving the job
  as a draft skill, scheduling it, answering "are you still there?". You hear each in `room`.
- **A person taking the mouse, or someone at the machine, pauses you** (unless you were waiting for them). Wait for “▶ Go on”.
- What the panel shows comes from you: `why` on commands, `status {task|step}`, proofs (`mission achieve` with a check or a
  picture, `status {fin:1, file}`), and the `look` you take (a small copy goes to the panel as "what it saw").

## Exclusive control & running commands

Each is its OWN consent, named on the Allow card and recorded on the grant: `--control` for the keyboard,
mouse and the exclusive lock; `--shell` for running commands. A grant given without one can never acquire
it — a watch grant stays a watch grant, and neither implies the other.

| verb | what it does |
|------|--------------|
| `lock {on}` | take (`on:true`) or release (`on:false`) **exclusive control** of the host — disarms the other operators while held. Needs a `--control` grant; works only on the one host you're on. **Ask first** ([etiquette](../../config/etiquette.md)), and **release when done** (it also dies by itself when the grant ends). |
| `reconnect` | drop the socket and dial again (the serve does this itself on a drop; this forces it) |
| `terminal {input? | keys? | signal? | open? | close?, until?, wait?, timeout?}` | **the Terminal panel's shell** — the same command prompt the operator sees in the Terminal panel, shared with everyone watching: what you type and what it prints show there (`exec` runs one command out of sight; this is the visible one). Needs the **terminal** consent — its own ask on the Allow card, never implied by `--shell` or the keyboard: `--terminal` at the start, or `access {terminal:1}` (refused without it: `needs:"terminal"`). `input` a line (Enter added), `keys` raw keys (Tab, arrows, `\u0003` = Ctrl+C), `signal:1` interrupts, `close:1` restarts the shell. Answers `{output}` — what arrived after it, colour/cursor codes removed: until `until` shows (else `ok:false`), or the shell is quiet `wait` ms (1.2 s), or `timeout` (30 s). |
| `access {shell?, terminal?, control?, why}` | **ask for MORE access mid-visit** — e.g. the operator expects you to use the terminal but the visit was allowed without `--shell`. A grant never grows in place, so this says in the room what you want and why, sends a **new Allow card** naming it, and — only if a person presses Allow — moves the visit onto the new grant (work folder, mission and panel carry on; the old grant is released). Answers `{ok, control, shell}`; a no is `ok:false, refused:true` and the visit carries on as it was. `exec` refused for want of shell says `needs:"shell"`. |
| `exec {cmd, timeout?}` | **run ONE command on the host** and get its output back: `{ok, code, output, truncated}`. Needs a **`--shell`** grant — a SEPARATE consent from `--control`, named on the Allow card as "run commands", and never granted by accident. The host runs it in its native shell: **cmd.exe** on Windows (wrap `powershell -Command "…"` yourself for PowerShell), **/bin/sh -c** on Linux. One command, one result — there is no interactive-shell verb (that would be its own ask), and `fs-*`/`file-*`/`clipboard` are not granted by `--shell` either. `timeout` ms, default 30s. |

**Showing what you're doing to the watchers.** The relay fans your status out as `agent-drive`; the
viewer shows a **bottom-right progress panel** and clears it when you hand the grant back.

**The easy, correct way — let a tool drive the panel.** For anything more than a click or two, don't
hand-narrate: express the task as a **recipe** and run it with `run.js`, or mark a tree with `plan.js`.
Both **own the panel for you** — they emit a nested tree, advance it as each step runs, and settle it
**green on completion (`fin:1`) without hanging up** — so the panel can't freeze, stom­p its own labels, or
miss completion. This is the recommended path for every routine task (`skills/solve-a-sudoku/sudoku.js` is a worked example).

```bash
node drive/run.js ./work '{"plan":[{"t":"Open app","k":[{"t":"Find it"},{"t":"Launch"}]},{"t":"Draw"}],
  "steps":[{"at":"Find it","note":"checking apps","do":{"do":"keys","text":"ls /usr/bin"}},
           {"at":"Launch","do":[{"do":"keys","text":"gimp &"},{"do":"press","code":"Enter"}],
            "expect":{"text":{"rect":[0,0,500,60],"has":"GNU Image"}}}]}'
```

**Hand-driving the panel** (when a recipe doesn't fit):
- **Declare a plan up front** so the panel shows the steps AHEAD, not just the line now: `status {steps:
  ["Open the puzzle","Read the board","Solve","Fill in","Verify"], at:0}`. As you finish each, `status
  {at:1}`, `{at:2}`… — the panel marks done ✓, the current step (lit, with your live line under it), the
  **next** one, and the rest, plus "step N/M". A **tree** (above) is the richer version; `plan.js` marks it.
- **Say why** where a watcher could not guess it: `why:"…"` on the command puts your reason on the panel,
  above the plan, in the same call — the tree shows every action, never the reason for one (see `think`).
- **Mark completion** when the task is done: `status {fin:1}` (or `plan.js finish`) turns the panel green
  and leaves the session open. Do this instead of letting the panel sit on the last in-progress step.
- The **live line** is the fine detail of the current step: acting verbs **auto-narrate** it WITH their
  context ("Clicking (241,643)", "Typing 11 characters", "Pressing Ctrl+L", "Opening <url>"); add
  **`intent:'<phrase>'`** to a command for your own words, or `status {text:'…'}` (keeps the plan). Keep
  lines short and plain — read at a glance.
  - **While a `tree` is active the auto-phrase is suppressed** (the tree's own labels are the narration),
    and **`quiet:1` on any command** suppresses it too — so a low-level click can never stomp a step label
    with "Clicking", and a long plan's own "Working 9 of 117" never lands over the count its `status`
    steps set. You rarely need to think about this: `run.js`/`plan.js` already handle it.

**The action tree — what the panel shows when NO tool sent a tree or plan** (`core/action-tree.js`).
Reported from a live run: ~380 ad-hoc actions reached the watchers as a flat feed of bare "Typing" /
"Clicking" / "Pressing Enter" — "useless action names". Now the serve builds the tree from what it runs:

Real output (the 15-puzzle run, mid-chunk; ● live, ✓ done):

```
● Solve the 15-puzzle                                       ← status {task}  (else the --task text)
  ✓ Read the board                                          ← status {step}  (else one step per burst)
    ✓ Looked ×2 · last → #ffffff (1 screenshot, 1 pixel check) · 3s     ← looks merged, with what they SAW
  ● Execute the solution
    ✓ Chunk 1 of 3                                          ← status {substep}; closed, it folds away...
      ✓ ⚠ Waited for the screen → not yet · 3s              ← ...but what FAILED in it stays in sight
    ● Chunk 2 of 3
      ● Pressing keys…                                      ← consecutive commands MERGED into one row
        ● Pressing ↑ · 21 so far                            ← the newest command (the lit leaf)
```

…and while the driver is quiet (2.5 s+), a `● Planning the next step` row with its own timer.

- **Merging:** consecutive commands of one kind are ONE row. One command that has answered is DONE at
  once (`✓ Clicked (5,5)`); the next of its kind reopens it as a run, which keeps one steady label while it
  grows (`Typing…`, `Pressing keys…`, `Clicking…`, or your `intent…`) so its stopwatch keeps running, with
  the newest command as the leaf. Closed, it says what it did, the count first (the panel is narrow), and the
  time its commands took: `Ctrl+L, typed 11 characters, ⏎ · 1s` · `Pressed 16 keys: ↓←↓←… · 2s` ·
  `Clicked 4× — last (241,643)`. An open burst is headed by what it began with (`Clicked (1237,18) …`)
  until it closes, then by its bulk. Only an identical look repeated after a pause (the same ping, the same
  pixel) rejoins its row — a different look never swallows a failed one.
- **Failures stay in sight:** a failed input or a bad answer leads with ⚠ (`⚠ 1 of 12 failed — …`), a live
  one is sent amber (`warn`), and when its step or sub-step folds, or scrolls into "N earlier steps (⚠ 1
  failed)", the failure is still shown — a check that failed never reads as a pass.
- **Private by default** — the panel goes to EVERY watcher and is replayed to later joiners: typed text
  shows only its SHAPE (`typed 8 characters`) unless the command says `show:1` (`type-text.js --show`, for a
  search term or a plain address) — never for a password, and `secret:1` hides it regardless. A Shift or
  AltGr chord on a character key is typing too, and a run's leaf never quotes the key just typed. A URL —
  opened, or typed with `show:1` — never shows its query, fragment, credentials or a token-like segment
  (`we.tl/…`); `open {secret:1}` shows the host only; `find`/`clickText {secret:1}` say "a word". A chat,
  DM, sticky note or `confirm` never shows its text (`Sent a direct message`, `→ got a reply`).
- **Steps:** `status {step}` stays open until the next declaration and keeps a true stopwatch (re-sending
  the same one changes nothing). A plain `status {text}` from an ad-hoc driver starts a SOFT step that closes
  at the pause after its work (under a declared step: a soft sub-step; under a declared sub-step it is only
  the live line). With nothing declared, one step per BURST, labelled by what it did. A `substep` with no
  declared step to nest in becomes a sibling step. Twin labels are numbered (`#2`). ONE root: the current
  task — so END EACH TASK WITH `status {fin:1}`: declaring the next task closes the previous one silently
  (never green, never reported in chat) and it leaves the panel.
- **Batches:** a `plan` is one row titled by what it DOES, counted from its own steps (`Batch of 14: 12
  clicks, 1 look, typing` — never the text it types), its leaf following the sub-step it is on (`step 5/14:
  clicking (6,7)`). A `status {text}` inside it becomes its narration (`Filled 5 of 20 cells · step 7/25`)
  and, once it closes, its title (`Filled 20 of 20 cells · batch of 41 → all done`) — so a batch that says
  what it is doing reads best; an `intent` on the plan names it too. A QUIET batch (drive/fill.js) shows the
  same row by count only (`step 37/162`): a minute of real work is never a ticking "Planning the next step".
- **Bounded:** older steps/actions fold into "N earlier …" rows; it never exceeds the relay's clamp
  (depth 4, 60 nodes, 24 siblings), and the CURRENT action is never the thing trimmed. ≤ ~4 frames a second;
  no heartbeat while the task is finished (the viewer fades the green panel once instead of blinking).
- **Precedence:** a tool's explicit `tree` or a flat `steps` plan wins outright (the burst in progress is
  closed cleanly); `quiet:1` commands stay out of it, and structure sent from inside a `plan` is the plan's
  business (the batch keeps its row; a `fin` there still finishes the task). A flat plan sent once a tree is
  on screen rides AS a tree (the viewer keeps the last tree until another arrives). **Handing the panel
  back:** a `status {task|step|substep}` always takes it back from a tool's tree or a flat plan (even one that
  stopped on a failure); once that tree or plan has FINISHED, a new `status {text}`, a new plan or a real
  action does too. It stays in the history as one done "Ran: …" row — inside your open step if there is one.
  `status {fin:1}` settles the task green, reported in chat by the TASK's name with "Anything else, or
  shall I sign off?"; a chat, chat-wait, `seen`, ping, reconnect, `lock` or sticky-note command after it is
  housekeeping and leaves it green — the next real action (or declaration) reopens the SAME task. The
  client signs off by itself on a bare "yes"/"ok" ONLY while that question is still the last thing the
  agent asked: once it has asked anything else (`chat`, `confirm`), only an unmistakable "sign off"/"bye"
  ends the session there — "yes" answers the agent's own question.
- The viewer (2.168.0+) hides its top progress bar for a one-root tree until the task finishes (it counted
  top rows: `1/1`, full, from the first second) and names the current STEP in the header and on the folded
  pill; an older viewer shows `1/1` and the task.

**Incoming chat** is logged to **`<serve-dir>/chat.json`** as it arrives — one JSON line each
(`{ts, id, from, name, text, to, mine, system}`). **Read it between steps** and answer the operator
while you work: when a message from them appears, `seen` it (their chat shows read), `typing {on}` while
you compose, then `chat` back — don't leave a question hanging until the task ends. Ask-with-options
pattern:

```bash
node drive/drive.js ./work '{"do":"chat","text":"Need an address — reply 1) pat@example.com  2) p@example.com  or a custom one"}'
node drive/drive.js ./work '{"do":"chat-wait","timeout":120000}'   # -> {"ok":true,"name":"...","text":"second one or pat.duck@example.com"}
```

## The rhythm

Look → decide → do one thing → verify. Use `plan` to batch *known-safe* sequences (e.g. filling a
solved grid), but check before and after — by the app's OWN signal where it has one (a `wait` on the
pixel that changes when it is done: sudoku.com's number pad turning to ticks), with a screenshot only
where it has none. `shot` is slow (first ~15s, then faster; one taken during an animation took 42 s) —
don't spam it; use `hold`/`see`/`ocr` when you only need part of the picture or just the words.
That is CHECKING, for you. SHOWING the result to the room is a separate job and is never skipped: once
the screen has settled, one `shot`, cropped to the result, rides in the finish (`status {fin:1, say, file}`).

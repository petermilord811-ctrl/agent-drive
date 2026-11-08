# docs/reference/mcp.md — the serve as MCP tools

`mcp/server.js` is an MCP server (stdio, no dependencies) in front of the serve channel
([serve-protocol.md](serve-protocol.md)). A model calls `connect`, then each verb as a tool of its own, and a `look`
comes back as a picture **inside the tool result**. There is no cmd.json / done.json handling for it to do, and no
extra calls to take, crop and read a screenshot.

## Register it

Claude Code:

```bash
claude mcp add agent-drive -- node "<repo>/tools/agent-drive/mcp/server.js"
# for every project: --scope user. To set a variable here instead of in the kit's .env: -e SM_RELAY=wss://…
```

Any other MCP client (the usual `mcpServers` config, e.g. `.mcp.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-drive": {
      "command": "node",
      "args": ["<repo>/tools/agent-drive/mcp/server.js"],
      "env": { "SM_RELAY": "wss://<relay>.sslip.io" }
    }
  }
}
```

Its icon is ScreenMirror's mark: the server sends `mcp/icon-32.png` and `mcp/icon-64.png` as PNG `data:` URIs in
`serverInfo.icons` to a client that speaks MCP 2025-11-25 (an older one is not sent the field). A client that draws
server icons shows it instead of its generic one; not every client draws them yet, and one that kept the server's
first answer shows it once the server is restarted.

### Cursor (plugin — ScreenMirror mark)

Cursor draws the **plugin** icon from the plugin logo, not from `serverInfo.icons`.

**On every machine (local, private — no Marketplace publish):**

```bash
cp .env.example .env   # once: set SM_JOIN_KEY and SM_RELAY
node scripts/install-cursor-plugin.js
# then: Developer: Reload Window
node scripts/install-cursor-plugin.js --check
```

That installs `~/.cursor/plugins/local/screenmirror-agent-drive` with `logo: "assets/logo.png"`. **Do not** put a
`data:` URI or `https://…` URL in the local plugin's `logo` field — Cursor drops those for local plugins and you
get the generic cube. A relative path under the plugin folder is the only reliable local logo.

The **MCP row / chat** plug glyph is a separate Cursor limit for local plugins (`file://` logos are not fetched for
MCP icons). The **plugin** header still shows ScreenMirror. Team marketplace install (not public Marketplace) is
what makes the MCP row use the same mark; see the install script's comments and plan notes if you need that later.

## What it needs

| variable | |
|---|---|
| `SM_JOIN_KEY` | the right to **ask** to join (it is not the authorization). It is read from the environment, or from the kit's `.env`: `core/agent-join.js` loads that file itself, and `SM_ENV_FILE` points it at another one. |
| `SM_RELAY` (or `SM_RELAY_URL`), `SM_RELAYS` | the relay, then the fallback relays, as in [config/connection.md](../../config/connection.md). `connect {relay}` overrides the relay for one visit. |
| `SM_AUTO_CONFIRM`, `SM_KEEP_CAPTURES` | as for agent-join |
| `SM_MCP_WORK` | where visit folders go (default `work/`; each visit gets a fresh `mcp-<time>` folder) |
| `SM_MCP_CONNECT_MS` | how long `connect` waits for Allow (default 170000) |
| `SM_MCP_LOOK_MAX` | the long edge of a `look` that names no `max` (default: the serve's 1280; see below) |
| `SM_MCP_MAX_VISITS` | how many machines the server holds at once, every chat's together (default 8, at most 32) |
| `SM_MCP_CLIENT` | the client a visit runs (default `core/agent-join.js`); tests point it at a stand-in |
| `SM_MCP_CALL_MS` | how long one call may block before it answers `pending` / `waiting` (default 50000: under the 60 s an editor allows) |
| `SM_MCP_TOOLS` | `all`: a tool per verb (68 tools), for a client with no limit on tools; by default the verbs a job is made of, and `more` for the rest |

## A person still presses Allow, for every visit

The key only lets the agent **ask**. `connect` puts a card in front of the people who can see the machine, showing
your `task` and a code, and nothing happens until one of them presses **Allow**. The card also names what the visit
may do, and each of these is a separate consent:

- **control**: keyboard and mouse. It is on by default, because serving needs it.
- **shell**: running commands. It is off unless you call `connect {shell:true}`.

To get more access during a visit, call `access {shell:true, why}`. That raises a **new** card, and nothing changes
unless someone presses Allow on it. The code goes out as an MCP progress notification (when the call carries a
`progressToken`), and it is in the answer if nobody presses Allow in time. Nothing in this server can press Allow.

## The tools

| tool | what it does |
|---|---|
| `connect {host, task, relay?, control?, shell?, camera?, audio?, files?, monitor?}` | Starts `core/agent-join.js --serve <visit folder>` and waits for Allow. Answers `{w, h, host, dir, code, at, pid}`; every x/y is a screen pixel at `w`×`h`. Not pressed within one call (see *One call, about 50 seconds*): `{ok:false, waiting:true, code}` — call `connect` again with the same host and it takes the wait up again (`resumed:true` once open). If the visit cannot start, the answer gives the client's reason, its exit code and the end of its stderr. |
| the verbs a job is made of, one tool each | `look`, `click`, `keys`, `press`, `chord`, `open`, `scroll`, `clickText`, `dbl`, `right`, `find`, `ocr`, `wait`, `plan`, `chat`, `chat_wait`, `inbox`, `status`, `think`, `confirm`, `captcha`, `mission`, `done`, `access`, `undo`, `exec`, `terminal`, `ping` — the ones the rules require among the first. Generated at startup from `core/verbs.js`, with `-` turned into `_`. A call becomes `{do: <verb>, ...arguments}`, and the result is done.json's JSON as text; `ok:false` comes back as `isError`. The schema is the verb's own fields plus the common ones and **`host` (required)**, with `additionalProperties:false`. The serve's verb table still has the last word: an unknown field is `refused` (and nothing is sent), and a common slip is renamed and reported in `fixed`. |
| `more {do, host, ...}` | Every other verb (`pause`, `note_add`, `spotlight`, `fetch`, `camera`, …): the same verb, through the same checks. Its description lists them. `SM_MCP_TOOLS=all` brings back a tool per verb for a client with no limit on tools. |
| `look {rect?, max?, settle?, out?, marks?}` | Returns `[text: the answer, image: the PNG]`. `out` is optional. The answer's `id` names the look. With `marks:true` the picture carries a number on each thing to click and the answer lists them (`marks`): click one with `click {mark}`. Otherwise click what you see in **its** pixels with `click {lx, ly}`. |
| `click {mark}` / `click {lx, ly, of?}` | A click aimed from a look is checked against the screen first. It follows a target that moved, and refuses one that is gone, handing back a fresh look as the image. It says what it hit: `hit`, `near`, `snapped`, `moved` ([serve-protocol.md](serve-protocol.md#clicking-the-right-thing-marks-the-check-the-hit)). |
| any acting verb with `look:{}` | Acts, then returns the picture of the result in the same answer. |
| `disconnect {host, text?}` | With `text`, signs off in the room (`done`); without it, leaves quietly (`quit`). Waits for the client process to exit. Ends only the visit `host` names; one still waiting for Allow is withdrawn. |
| `intake {text}` | A job asked for in plain words ("connect 10004 and do my sticky notes") read by `core/intake.js`: `{host, skill, others, task, needs, why}` and, when it found a machine and a task, `connect` — the fields to call `connect` with (the least access the words justify). Connects to nothing; answered at once, outside the visit's queue. |

- **Several machines at once.** The server holds a visit per machine (8 by default, `SM_MCP_MAX_VISITS`), each with its
  own client and serve. An editor shares one server between all its chats, so this is also how two agents work on two
  machines side by side.
  - **Every call but `connect` and `intake` names its machine with `host`** — required, and never guessed. A call that
    names none is refused even with one visit open: it may come from a chat that never connected, and "the only one
    open" is how such a chat once acted on another's machine. Every answer says which `host` it came from.
  - `connect` to another machine opens alongside the visits already here. A `connect` to a machine already open here is
    refused, with a reminder that it may be another agent's visit: a refusal never tells one agent to end another's.
  - The relay lets three asks for Allow wait at once from one address. A fourth, while three are still waiting,
    replaces the oldest code.
- **One call, about 50 seconds.** An MCP client gives up on a call it has waited on too long — Cursor at 60 s (error
  -32001, not configurable, and progress does not extend it), Claude's desktop app too — and a call it gave up on was
  cancelled: a `connect` threw away the card a person was about to press. So no call blocks longer than
  `SM_MCP_CALL_MS` (50 000 by default):
  - a command still running then answers **`pending`** (not an error): it goes on on the machine, and its answer rides on
    the next call to that machine as `{previous, answeredLate}` — `ping {host}` collects it, waiting as long as a call may;
  - a `connect` still waiting for Allow answers **`waiting`** with the code; the next `connect` to that machine takes the
    wait up again. A visit nobody takes up — not let in, or let in while no call was waiting — ends 90 s after the last
    `connect` for it, so no grant is left with nobody driving;
  - `chat_wait` listens for at most one call's time and says to call it again;
  - a client that resets its own clock on progress hears a word every 15 s.
- **Timing.** A visit's serve takes one command at a time, so ITS calls queue. Another visit's calls run alongside
  them. Verbs that wait for a person or for the screen (`chat_wait`, `captcha`, `confirm`, `access`, `wait`, `plan`)
  are given their own timeout plus a margin — within one call's time; past it, `pending`.
- **Relative paths.** Relative paths (`out`, `file`) resolve inside the visit folder, which is the client's working
  folder. Pictures are deleted when the visit ends unless `keep:1` — by the client as it exits, and by this server
  when the client was stopped instead (and, at startup, those left by visits a day old).
- **Cancelling.** A cancelled call gets no answer. If the serve has not read the command yet, it is taken back and
  never runs. Otherwise it finishes, and its answer is added to the next result as `{previous, answeredLate}`.
- **When things go wrong:**
  - If the connection drops, the next call answers `isError` with the new Allow code (`reconnecting`), sends nothing,
    and sends the code as progress.
  - If the client process dies, the next call says so: its exit code and its reason.
  - If the server's stdin closes, the server ends every visit (each grant is handed back) and stops their clients.

## Picture size

The image is the look's own pixels, and `lx`/`ly` are measured in them. If a client or model shrinks the picture
again before the model sees it, clicks land short of their target, which is the failure `look` exists to prevent.
So keep `max` at or under what the model sees unscaled:

- current Claude models: up to 2576 px on the long edge
- older ones: 1568 px, and about 1.15 megapixels

The serve's 1280 default fits both on 16:9 and 16:10 screens. Set `SM_MCP_LOOK_MAX` for anything else.

## Test

`node tests/mcp_server.js` runs a real relay, the real client, a stand-in host and an operator who presses Allow.
It covers:

- the protocol
- the tool schemas
- connect, and the code sent as progress
- a click, a look and its image
- refused fields and renamed slips
- `chat_wait`, and cancelling it
- disconnect
- a dead client, nobody pressing Allow, and the server going away mid-visit

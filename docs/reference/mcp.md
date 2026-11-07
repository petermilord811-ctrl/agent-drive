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

### Cursor (plugin — branded icon in Customize and chat)

Cursor's MCP list / chat icons come from the **plugin logo**, not from `serverInfo.icons`. This repo is a Cursor
plugin (`.cursor-plugin/plugin.json`, root `mcp.json`, `assets/logo.png`).

1. Uninstall any local copy of **screenmirror-agent-drive** (Customize → plugin → Uninstall).
2. Install from GitHub so the logo is an `https://raw.githubusercontent.com/…` URL (a `~/.cursor/plugins/local`
   copy only gets a `file://` logo; Cursor can show that on the plugin header but not on the MCP row / chat).
   - **Marketplace:** [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) with
     `https://github.com/petermilord811-ctrl/agent-drive`, then Install from Customize.
   - **Team marketplace:** Dashboard → Plugins & MCPs → Import from Repo → same URL.
3. Configure plugin variables **SM_JOIN_KEY** and **SM_RELAY** (Customize → plugin → Configure).
4. Reload the window. The plugin header and the **agent-drive** MCP card should both show ScreenMirror's mark.

## What it needs

| variable | |
|---|---|
| `SM_JOIN_KEY` | the right to **ask** to join (it is not the authorization). It is read from the environment, or from the kit's `.env`: `core/agent-join.js` loads that file itself, and `SM_ENV_FILE` points it at another one. |
| `SM_RELAY` (or `SM_RELAY_URL`), `SM_RELAYS` | the relay, then the fallback relays, as in [config/connection.md](../../config/connection.md). `connect {relay}` overrides the relay for one visit. |
| `SM_AUTO_CONFIRM`, `SM_KEEP_CAPTURES` | as for agent-join |
| `SM_MCP_WORK` | where visit folders go (default `work/`; each visit gets a fresh `mcp-<time>` folder) |
| `SM_MCP_CONNECT_MS` | how long `connect` waits for Allow (default 170000) |
| `SM_MCP_LOOK_MAX` | the long edge of a `look` that names no `max` (default: the serve's 1280; see below) |

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
| `connect {host, task, relay?, control?, shell?, camera?, audio?, files?, monitor?}` | Starts `core/agent-join.js --serve <visit folder>` and waits for Allow. Answers `{w, h, host, dir, code, at, pid}`; every x/y is a screen pixel at `w`×`h`. If the visit cannot start, the answer gives the client's reason, its exit code and the end of its stderr. |
| one tool per verb in `core/verbs.js` | Generated at startup, with `-` turned into `_` (`chat_wait`, `note_add`, `spotlight_off`). A call becomes `{do: <verb>, ...arguments}`, and the result is done.json's JSON as text. `ok:false` comes back as `isError`. The schema is the verb's own fields plus the common ones, with `additionalProperties:false`. The serve's verb table still has the last word: an unknown field is `refused` (and nothing is sent), and a common slip is renamed and reported in `fixed`. |
| `look {rect?, max?, settle?, out?}` | Returns `[text: the answer, image: the PNG]`. `out` is optional. Click what you see in **its** pixels with `click {lx, ly}`. |
| any acting verb with `look:{}` | Acts, then returns the picture of the result in the same answer. |
| `disconnect {text?}` | With `text`, signs off in the room (`done`); without it, leaves quietly (`quit`). Waits for the client process to exit. |
| `intake {text}` | A job asked for in plain words ("connect 10004 and do my sticky notes") read by `core/intake.js`: `{host, skill, others, task, needs, why}` and, when it found a machine and a task, `connect` — the fields to call `connect` with (the least access the words justify). Connects to nothing; answered at once, outside the visit's queue. |

- **Timing.** One visit runs at a time, and the serve takes one command at a time, so calls queue. Verbs that wait
  for a person or for the screen (`chat_wait`, `captcha`, `confirm`, `access`, `wait`, `plan`) are given their own
  timeout plus a margin.
- **Relative paths.** Relative paths (`out`, `file`) resolve inside the visit folder, which is the client's working
  folder. Pictures are deleted when the visit ends unless `keep:1`.
- **Cancelling.** A cancelled call gets no answer. If the serve has not read the command yet, it is taken back and
  never runs. Otherwise it finishes, and its answer is added to the next result as `{previous, answeredLate}`.
- **When things go wrong:**
  - If the connection drops, the next call answers `isError` with the new Allow code (`reconnecting`), sends nothing,
    and sends the code as progress.
  - If the client process dies, the next call says so: its exit code and its reason.
  - If the server's stdin closes, the server ends the visit (the grant is handed back) and stops the client.

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

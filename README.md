# agent-drive

[![CI](https://github.com/petermilord811-ctrl/agent-drive/actions/workflows/ci.yml/badge.svg)](https://github.com/petermilord811-ctrl/agent-drive/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A kit that lets an AI agent (Claude, or any MCP client) operate a real computer through
**[ScreenMirror](#what-you-need)** — look at its screen, reason, act, and check its own work — **with a person's
consent at every step**: nothing is reachable until somebody watching that machine presses **Allow**, and each
power (the keyboard and mouse, running commands, a terminal) is named on that card and granted separately.

It is built to be grown by many people: every kind of task the agent learns becomes a **skill** — a folder
anyone can add — and every contributor's improvement reaches everyone through reviewed pull requests and
`node kit.js update`.

- **Look cheaply, act precisely** — a picture sized for reading with its scale, clicks given in its own pixels
  (`look` + `lx/ly`), text read on the host or, where the host has no reader, locally.
- **Verify, don't hope** — every action may carry an expectation; a job is a *mission* of milestones achieved
  only with proof; a proven job can be **replayed** with no model turns.
- **Behave like a person** — types like one by default (the ScreenMirror Type window's own planner), works in
  the open (the progress panel, the session chat, the "is auto-typing" card), asks before anything hard to undo,
  and hands CAPTCHAs to the operator.
- **Long jobs stop and ask** — every task has a **budget** of steps and minutes; a plan can be **previewed** to the
  room before it starts and **checkpointed** after each milestone; nothing acts until they say yes.
- **The library grows itself** — a job finished with every milestone proven is saved as a **draft skill**, which a
  person reviews and promotes.
- **Every command is checked before it runs** against one verb table (`node kit.js verbs`); the docs' table is
  generated from it.
- **An MCP server** exposes it all as tools, pictures inline: `claude mcp add agent-drive -- node mcp/server.js`.

## What you need

- **This repository** — no dependencies to install. **Node.js ≥ 18.** (Python + Pillow only for
  `vision/crop.py` and `vision/detect_grid.py`.)
- **A machine running the ScreenMirror host**, reachable on a ScreenMirror relay, with **a person who can
  press Allow**.
- **`SM_JOIN_KEY`** — the secret that lets the agent *ask* to join a machine (the relay holds the same one).
  Copy `.env.example` to `.env` and fill it in; `.env` is never committed. See
  [config/connection.md](config/connection.md).

## Quickstart

```bash
git clone https://github.com/petermilord811-ctrl/agent-drive.git && cd agent-drive
cp .env.example .env          # then set SM_JOIN_KEY and SM_RELAY

# 1. Hold a session open on the target machine (a person presses Allow):
node core/agent-join.js --host <number> --agent claude --task "<the job>" --control --serve ./work

# 2. Drive it, one verified step at a time:
node drive/drive.js ./work '{"do":"look","out":"work/view.png"}'   # look (the answer says the scale)
node drive/drive.js ./work '{"do":"click","lx":490,"ly":305}'       # act, in the look's own pixels
```

Or give an MCP client the whole kit as tools — see [docs/reference/mcp.md](docs/reference/mcp.md).
An agent should start at **[AGENTS.md](AGENTS.md)**: the loop, the rules, where everything is.

## The map

`node kit.js` prints it whole — every tool with what it does and how to call it, every skill — generated from
the files, so it is never out of date.

| Path | What it is |
|------|------------|
| **[AGENTS.md](AGENTS.md)** | The brain. The agent reads this first, every task: the loop, the rules, where things are. |
| **kit.js** | The map and the contributor's tool: `node kit.js` · `skills <word>` · `tools` · `verbs` · `check` · `new <slug>` · `update` · `contribute`. |
| **core/** | The session — `agent-join.js` (connect, be let in, serve commands), its verb table, eyes, consent, typing. |
| **drive/** | Commanding a session from the shell — `drive.js` (a command or a batch), `run.js` (a recipe), `plan.js` (the panel), `replay.js` (a proven mission). |
| **vision/** | Reading a screen beyond pixels — learned glyphs, crops, grids, local OCR. |
| **mcp/** | The kit as MCP tools. |
| **skills/** | **One folder per kind of task** — its README (when, and the one command that does it), its code, its data. The growth area. |
| **config/** | How the agent behaves — connecting, etiquette, when to ask. |
| **docs/** | [reference/](docs/reference/) — the serve protocol and its verbs, ScreenMirror's features, the gotchas log · [plans/](docs/plans/) — design notes and the roadmap. |
| **dev/** | Contributor tooling behind `kit.js check / new / update / contribute`. |
| **tests/** | The kit's own tests: `npm test`. |

## Contributing — and getting everyone's improvements

```bash
node kit.js update                 # pull the latest reviewed kit (what changed is listed)
node kit.js new fill-a-form        # start a skill from the template
node kit.js check                  # what CI checks: catalog headers, tool headers, no secrets or private data
node kit.js contribute "what I improved"   # branch, commit what you changed, push, open a pull request
```

Every change reaches other users only after review and CI — see **[CONTRIBUTING.md](CONTRIBUTING.md)**. Found
a security problem? See **[SECURITY.md](SECURITY.md)**. What changed between releases: **[CHANGELOG.md](CHANGELOG.md)**.

## The one habit that matters

Before starting a task, run **`node kit.js skills`** and see if this *kind* of job has been done before. If it
has, follow that recipe instead of thinking it through from scratch. When you finish something new, add a skill
(a folder — no shared index to edit) so the next run is faster — and `node kit.js contribute` it so everyone's is.

And the habit that makes it faster *every* time: a note in prose makes the agent know more, not look faster.
When a routine has to read the same kind of screen on every run, save what a confirmed read taught it as **data a
tool loads** — the digits' shapes, a button's place, a state's colour — and wake the model only when that data
cannot decide. The model read every sudoku board in 35–65 s; the shapes it confirmed once read the next one in
~10 ms ([solve-a-sudoku](skills/solve-a-sudoku/README.md)).

## License

[MIT](LICENSE) © the agent-drive contributors.

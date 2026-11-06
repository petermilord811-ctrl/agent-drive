# Contributing

This kit is built to grow by **addition**, so that many people can contribute at once without stepping on
each other. The golden rule: **a contribution is a new file in its own folder — not an edit to a file
other people also edit.** Follow that and merge conflicts essentially disappear.

## The map: who owns what

| Area | Owner | Change it when |
|------|-------|----------------|
| `skills/<slug>/` | **everyone** (the growth area) | you solved a *kind* of task worth reusing — add a folder |
| `core/`, `drive/`, `vision/`, `kit.js` | **maintainers** (the tools every skill stands on) | fixing a real bug or a documented improvement — open an issue/PR that explains why |
| `AGENTS.md`, `README.md`, `config/`, `docs/` | **maintainers** (how the agent thinks, and why) | the same |

Most contributions only touch `skills/`. The core is what every skill depends on, so changes there are
reviewed carefully and kept rare. `node kit.js` shows the whole map, generated from the files.

## Add a skill (the common case — purely additive)

1. Create **`skills/<slug>/README.md`**. The slug is short, lowercase, hyphenated, descriptive, and
   **unique** (`fill-a-form`, not `form`). Check `node kit.js skills` first so you don't reuse a slug.
2. Give it a frontmatter header so it lists in the catalog:
   ```markdown
   ---
   name: Fill a form
   when: a multi-field form on screen — tab or click field to field and type each value
   tags: browser, forms, input
   run: node skills/fill-a-form/fill-form.js ./work form.json
   ---
   # skill: fill a form
   …the steps, the measurements, the pitfalls…
   ```
   `run:` is the one command that does the job, if the skill has one — it is what an agent reaches for
   first.
3. Keep everything the skill needs **inside its folder**: its code (`*.js`, `*.py`), its data
   (`*.example.json`, learned shapes, a sample input). A script there starts with an `@tool <what it does>`
   and an `@run <how to call it>` line so `node kit.js` lists it. It may `require('../../core/…')`,
   `../../drive/…` and `../../vision/…`; it never edits them. Prefer exact, copy-paste-able commands and
   real numbers over prose.
4. **Do not** edit a shared index (there isn't one — the catalog is generated), and don't touch the core.
   That's what keeps two people's contributions from colliding.

Because every skill is its own folder and nothing central lists them, two PRs adding different skills
never conflict. Two PRs that happen to pick the **same slug** are the only collision, and it is an
obvious rename — so pick a distinctive slug.

## Never commit these (they're gitignored for a reason)

- `work/` — runtime scratch: `cmd.json`, `done.json`, screenshots, logs. Per-run, per-user.
- `.env` — secrets (join key, relay URLs, API keys). Use `.env.example` as the template.
- `SESSION-LOG.md`, `*.local.*` — personal working logs and what a machine has learned for itself
  (e.g. `skills/solve-a-sudoku/glyphs.local.json`). Keep your own; don't share them.
- **Screenshots of real or private screens, and anything containing a credential.** A skill's example
  data must be synthetic or clearly non-sensitive.

## The loop: from your machine to everyone's

```bash
git clone https://github.com/petermilord811-ctrl/agent-drive.git   # or fork it on GitHub first
node kit.js update                        # before you start: the latest reviewed kit
node kit.js new fill-a-form               # a skill from the template (or edit what is there)
node kit.js check && npm test             # what CI will check, run first
node kit.js contribute "a skill to fill a form"          # a preview: what would be sent
node kit.js contribute "a skill to fill a form" --yes    # branch, commit, push, open the pull request
```

An agent that improved a skill during a run can do the same at the end of it — `contribute` without `--yes`
first, so a person sees what would be sent. **Nothing reaches other users until it is reviewed:** CI runs
`node kit.js check` and `npm test` on Linux and Windows for every pull request, CODEOWNERS asks the owner of every
path it touches, and `main` only takes reviewed, green pull requests. Everyone else gets it with
`node kit.js update`. Without write access, `contribute` tells you to fork (`gh repo fork --remote=true`).

Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice, and a
`.github/CODEOWNERS` line for a new skill (`/skills/<slug>/ @your-github-name`) so you review its changes from
then on.

## Changing the core (`core/`, `drive/`, `vision/`, `mcp/`, `dev/`, `kit.js`)

The tools have tests. Before a PR that touches them:

- `npm test` runs the kit's own tests (`tests/`): the verb table against the client and the docs, the
  consent and typing models, the screen reading, recipes and replays, the MCP schema, the catalog and every
  `@tool` line. Keep them green and add one for new behaviour. Test pictures are drawn by the test, never
  real screens; a test that needs a desktop (opening a window, reading a screen) skips its live part when
  `AGENT_DRIVE_LIVE=0`, as in CI.
- The end-to-end tests that need the ScreenMirror relay and hosts live in the ScreenMirror repository, which
  carries this kit at `tools/agent-drive` and runs them against it.
- A tool must stay **backward-compatible with an older relay**: the viewer/relay can be older than this
  client, so a new field you send must degrade quietly (an older relay ignores what it doesn't know), not
  break the run.
- A new tool goes in the folder that says what it does (`core/` the session, `drive/` commanding it,
  `vision/` reading screens), with its `@tool`/`@run` lines. Anything that only one kind of task needs
  belongs in that skill's folder instead.

## Staying conflict-free at the git level

- Rebase onto the latest `main` before opening a PR (`git pull --rebase`). Additive folders rebase cleanly.
- One skill (or one focused fix) per PR — small, self-contained diffs merge without drama.

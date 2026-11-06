## What this changes

<!-- One or two sentences: the skill or tool, and what is different for someone using it. -->

## Why

<!-- The run that showed the need: what happened, on what kind of machine (Windows / Ubuntu / browser / app). -->

## Evidence

<!-- How you know it works: a live run (no private screens -- crop or describe), and the tests you ran. -->

## Checklist

- [ ] `node kit.js check` passes
- [ ] `npm test` passes (and a new test covers the change, for anything in core/, drive/, vision/ or mcp/)
- [ ] A new skill is its own folder under `skills/` with a README frontmatter (name / when / tags / run), and a
      CODEOWNERS line for it
- [ ] Nothing private: no keys, no `.env`, no real screenshots, no real machine numbers or relay addresses
- [ ] Consent is unchanged or stronger: nothing acts without the grant the Allow card asked for
- [ ] A line under **Unreleased** in CHANGELOG.md

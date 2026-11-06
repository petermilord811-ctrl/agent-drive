# skills/ — one folder per kind of task

A **skill** is everything the next run needs to do a *kind* of task someone has done before: a README with
the steps, the measurements and the pitfalls — and, when the job has been turned into a tool, the code that
does it and the data it learned. Before inventing an approach, see if one already fits; when you finish a
genuinely new *kind* of task, leave one behind so the next run is fast.

## Find a skill (generated, never a checked-in list)

```bash
node kit.js skills            # every skill: when to use it, the command that runs it
node kit.js skills sudoku     # only the ones matching a word
node kit.js skills --json     # machine-readable
```

The catalog is **built from the folders on every run** — there is no `INDEX.md` to keep in sync, and no
shared list to edit. Adding a skill is adding a folder; it never touches anyone else's file, so two people
contributing at once don't conflict.

## What a skill folder holds

```
skills/solve-a-sudoku/
  README.md          when to use it, the steps, the pitfalls        (frontmatter: name/when/tags/run)
  sudoku.js          the one command that does the job              (@tool / @run lines in its header)
  sudoku-solve.js    its own library
  glyphs.json        data it learned and ships (glyphs.local.json: what this machine added, gitignored)
  *.example.json     sample inputs
```

A docs-only skill (just a README) is fine — most start that way, and the code comes when the same steps
have been typed by hand twice. A skill's code may use the kit's tools (`../../core/`, `../../drive/`,
`../../vision/`) and keeps everything else of its own inside its folder.

## Add a skill (one self-contained folder)

1. Make `skills/<slug>/README.md`. Pick a **short, descriptive, unique** slug (`fill-a-form`,
   `operate-a-file-manager`). Lowercase, words joined by hyphens.
2. Start the README with a small **frontmatter** block so it shows up in the catalog:

   ```markdown
   ---
   name: Fill a form
   when: a multi-field form on screen — tab or click field to field and type each value
   tags: browser, forms, input
   run: node skills/fill-a-form/fill-form.js ./work form.json
   ---
   # skill: fill a form
   ...the steps...
   ```

   `name` and `when` are what the catalog shows, `run` is the command an agent reaches for first, and
   `tags` help the word filter. (A README with no frontmatter still lists — its first heading and first
   line stand in — but adding it is better.)
3. Put the skill's code and data **in the same folder**, each script with an `@tool <what it does>` and an
   `@run <how to call it>` line in its header. Keep the README copy-paste-able: exact commands and numbers
   over prose.
4. That's the whole contribution. Don't edit a shared index, `AGENTS.md`, or the core tools — see
   [../CONTRIBUTING.md](../CONTRIBUTING.md).

> Keep each skill to what makes the next run faster: the steps that worked, the coordinates/sizes you
> measured, the one or two things that bit you — and, once it repeats, a tool that does it. Delete a skill
> that stops being true rather than letting it mislead.

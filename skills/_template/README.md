---
name: {{name}}
when: the kind of task this is for, and how to recognise it on screen
tags: browser, forms
run: node skills/{{slug}}/{{slug}}.js ./work
---
# skill: {{name}}

One paragraph: what this does, and the result a person can check.

## The plan (a mission)

| Milestone | Done when (what is on the screen) | Check |
|-----------|-----------------------------------|-------|
| Open it | the page / app is showing | `{"text":{"has":"..."}}` |
| Do it | ... | ... |
| Prove it | the result is on screen | a cropped picture to the room |

## Steps

1. The exact commands — copy-paste-able, with the real numbers you measured.
2. ...

## Pitfalls

- What went wrong in a real run, and what fixed it (no real machine numbers, addresses or screens).

## Evidence

The run that proved it: the kind of machine (Windows / Ubuntu), the date, how long it took.

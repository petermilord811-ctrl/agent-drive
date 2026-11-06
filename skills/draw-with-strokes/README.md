---
name: Draw with strokes
when: you need to draw a shape or figure on a canvas (GIMP, a paint app) -- turn ellipses/lines/arcs/beziers into the point lists a `strokes` drag sends, chunked under the command-size ceiling
tags: drawing, gimp, canvas, strokes, geometry
run: node skills/draw-with-strokes/strokes.js demo
---
# skill: draw with strokes

Draw a figure as a set of DRAGS, not one click per pixel. `strokes.js` turns primitive shapes into the
point lists the host's `strokes` verb draws, each command kept under the ~8 KB command ceiling so a smooth
curve costs ONE command instead of N sequential looks.

## The verbs it feeds (serve-protocol.md)
- `stroke {points:[[x,y],...], ms}` -- one held drag: down, moves with the button held, up.
- `strokes {list:[{points:[[x,y],...]}, ...], ms}` -- many drags in one round trip.
Coordinates are absolute pixels at the served WxH. A point list needs at least two points.

## Generate
`const sg = require('./strokes.js')` gives `line(a,b)`, `polyline(pts)`, `rect(x,y,w,h)`,
`ellipse(cx,cy,rx,ry)`, `arc(cx,cy,r,a0,a1)`, `bezier(p0,p1,p2,p3)` -- each returns an integer point array --
and `commands(strokeList, {ms, maxBytes})`, which packs those strokes into one or more `strokes` commands,
each under `maxBytes` (default 8000), splitting across commands when needed and thinning a single over-long
stroke while keeping its endpoints.

- `node skills/draw-with-strokes/strokes.js demo` prints the commands for a small ORIGINAL face.
- `node skills/draw-with-strokes/strokes.js shapes.json` reads `[{"type":"ellipse","cx":..,"cy":..,"rx":..,"ry":..}, {"type":"arc",...}, ...]` and prints its commands.

## Drive (on a connected serve session)
1. Launch the paint app and a fresh canvas (GIMP: Ctrl+N, OK). **Probe a canvas pixel for `#ffffff` after
   New** -- the first shot after New can show a blank capture (gotcha), and the capture never feeds the
   model, so you VERIFY by probing points, not by looking.
2. Pick the tool (Pencil) and set the foreground colour via the colour dialog's HTML hex field per part.
3. Send each command from `commands(...)` in turn (`drive/drive.js ./work '<command>'`), changing colour
   between parts. A `strokes` call takes a while; the kit already budgets extra time for `strokes`/`stroke`.
4. Verify by PROBING representative pixels for the expected hex (body centre, each eye) -- a probe is exact
   and free; a look is neither. A fresh liveness check (`vision/liveness.js`) catches a blanked canvas first.

## Drive on a web canvas (proven live -- 10003, kleki.com, 2026-10-27)

A browser paint app is MUCH less friction than GIMP -- no app launch, no tool/colour dialogs. On **kleki.com**
the brush tool is already active and a fresh canvas fills the window. Set the colour by clicking the **bottom
edge of the HSV box** (value 0 = black for any hue) -- the swatch beside `#` is NOT the brush colour, so draw
a quick **test stroke and look** to confirm, rather than trusting the UI. Then send the shapes. Two things bit
us live, both worth knowing:

- **`strokes {list}` BRIDGES the shapes into one continuous path here** -- the pen does not lift between list
  items, so each shape's end gets joined to the next shape's start by a stray line (our cat's two eyes got
  wired together by a bar at eye height). **Fix: send each shape as its own `stroke` command** (one
  `{do:"stroke",points,ms}` per shape in a `drive.js` batch). Each `stroke` is a complete down-move-up, and
  the round-trip between batch items lets the canvas register the pen-up, so the shapes stay separate.
  (Whether this is a host-side `strokes` bug or a web-canvas timing quirk is still open; separate `stroke`s
  sidestep it either way.)
- **A single stroke can still drop** -- a missed pointer-down, the same class as a dropped keystroke: one of
  17 strokes (the right ear) silently didn't land, twice. So **verify the drawing against what you sent and
  redraw any missing shape**; overdrawing the identical path is harmless (same black line), so a blind 2-3x
  resend of a flaky shape is a fine fix.

The generator (`strokes.js`) is app-agnostic -- it feeds a native `strokes`/`stroke` verb the same way whether
the canvas is GIMP or a web app; only the "pick tool + colour" preamble differs.

## Rules
- **Original work only** -- draw your own character/scene, never a copyrighted one.
- Keep each command under the ceiling: `commands()` does this for you; if you hand-build a `strokes` list,
  check `JSON.stringify(cmd).length`.
- The geometry is unit-tested offline (`tests/draw_strokes.js`); the on-canvas result still needs a live
  check the first time against a real GIMP -- brush size and tool settings change the rendered line.

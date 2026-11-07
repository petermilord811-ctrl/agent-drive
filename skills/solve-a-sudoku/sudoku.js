#!/usr/bin/env node
// @tool solve the sudoku.com puzzle on screen in one command -- read, solve, fill, checked by the game
// @run  node skills/solve-a-sudoku/sudoku.js ./work play master
// sudoku.js <work-dir> play [difficulty] -- solve the sudoku.com puzzle on screen, start to finish, in ONE
// command -- and, once the digits' shapes are known, with NO model in it.
//
//   node skills/solve-a-sudoku/sudoku.js ./work play master     # from the win screen: a new Master game; in a game: that one
//
// WHY ONE COMMAND. The serve ledgers of three live solves showed where the time went, and it was not the
// machine. The model read the board off a screenshot (35-65 s, on every board), took more turns to write
// the grid and start the solver (9-48 s), then had a full screenshot taken DURING the win animation (5-42 s,
// one timed out) and read it to say "solved" (20-140 s). The machine's own part was seconds. So:
//
// FIREFOX / 34123 (2026-11-06/07): findGrid often drifts; locate by box-sep pitch (~55.3, origin ~500,342).
// Prefer pad clicks at the shifted geometry when tiles still read INGAME — Digit keys drop presses.
// SILENT MISREAD (2026-11-07): glyphs can name a clue wrong with 0 doubts; settle() still finds one
// solution for that wrong grid; fill then burns 3 mistakes → Game Over. Never learnFrom that board.
// play recovers once: New Game → re-read → refill. Agent visits: fast.js. Do not hand-read.
//   look   one `shot` -- the only capture of the board
//   read   the 81 cells from that picture, by glyph shapes learned from boards already proven right
//          (glyph-reader.js, ~10 ms). A cell it is unsure of is settled by the solver, never guessed
//   solve  exactly one solution, or the read is wrong (sudoku-solve.js, ~1 ms)
//   fill   every answer in ONE host-side plan -- the cell, then its number on the pad -- with the panel's
//          count riding inside the plan as `status` steps, so it climbs without a round trip per chunk
//   check  the GAME says solved: every pad tile turns to a tick, then the win panel. A pixel question,
//          not a screenshot and not a model looking at one
//   learn  the shapes just read, where they add anything, so later boards read even more surely
// and the time of each step goes on the panel and into the chat.
//
// When it CANNOT be sure of a board (nothing learned yet, a new site or zoom, a shape never seen) it stops
// with exit code 10, leaving board.png (the board, enlarged) and grid.draft.json (its best reading, with the
// cells to check): read board.png, write grid.json, run `solve`. The game confirming that one read is what
// teaches the shapes, and the next board needs no model at all.
//
// --show (play, newgame, solve): before each step that works on part of the screen, circle that part for the
// watchers -- the screen before it is captured, the grid before it is read, the board and the pad before
// the fill, the pad before the game is asked, New Game before it is pressed. Costs ~6 s a step; the steps'
// own times leave it out and the report says what it took.
//
// The two-step flow still works: `newgame [difficulty]` from the win screen (writes board.png, and grid.json
// too when the board reads for sure), then `solve`. And offline, from a saved screenshot:
//   node skills/solve-a-sudoku/sudoku.js ./work read <shot.png>                         # what it reads, its doubts, the time
//   node skills/solve-a-sudoku/sudoku.js ./work learn <shot.png> <grid.json> [--to f]    # teach it a board known to be right
//   node skills/solve-a-sudoku/sudoku.js ./work state <shot.png>                        # a game, ticks, the win screen, other?
//
// Exit codes: 0 solved . 2 usage, or a grid without one solution . 3 not a sudoku.com game or win screen .
// 4 the game did not say solved . 5 the operator wrote in chat: answer first . 10 a model has to read this
// board (see above).
const fs = require('fs'), path = require('path');
const eyes = require('../../core/agent-eyes.js');
const reader = require('../../vision/glyph-reader.js');
const sudoku = require('./sudoku-solve.js');
const { exchange } = require('../../core/cmd-file.js');

// A host that stops answering mid-routine (a shot that fails, a command that times out) is said in one
// line, not a stack trace -- the driver reads this output to decide what to do next. The operator speaking
// is its own ending (exit 5): see `act` below.
process.on('uncaughtException', (e) => {
  if (e && e.operator) { console.error('[!] ' + e.message + ' -- stopped so you can answer them first; run it again after'); process.exit(5); }
  console.error('[x] ' + ((e && e.message) || e)); process.exit(1);
});

const argv = process.argv.slice(2);
const toAt = argv.indexOf('--to'), TO = toAt >= 0 ? argv.splice(toAt, 2)[1] : null;
const showAt = argv.indexOf('--show'), SHOW = showAt >= 0 && argv.splice(showAt, 1).length === 1;
const [dir, cmd, arg, arg2] = argv;
if (!dir || !cmd) {
  console.error('usage: node sudoku.js <work-dir> play [difficulty] [--show] | newgame [difficulty] [--show] | solve [--show] | read <shot.png> | learn <shot.png> <grid.json> [--to <bank.json>]');
  process.exit(2);
}

// WHAT HAS BEEN LEARNED: the shapes shipped with the playbook (learned from boards solved live) and this
// machine's own additions, written when a game confirms a read. The local file is gitignored (*.local.*).
// SM_SUDOKU_GLYPHS points both somewhere else, which is how the tests keep their banks to themselves.
const GLYPHS = process.env.SM_SUDOKU_GLYPHS || __dirname;
const SEED = path.join(GLYPHS, 'glyphs.json'), LOCAL = path.join(GLYPHS, 'glyphs.local.json');

// sudoku.com on a 1920x1080 screen, measured 2026-10-25/26 on 10004. A browser-chrome shift (a bookmarks
// bar) moves all of it together, and the board found in the picture says by how much.
const BASE = {
  origin: [490, 247], step: [55.3, 55.1],        // cell (0,0)'s centre and the pitch, if no board is found
  buttons: { '1': [1033, 392], '2': [1142, 392], '3': [1250, 392], '4': [1033, 497], '5': [1142, 497], '6': [1250, 497], '7': [1033, 601], '8': [1142, 601], '9': [1250, 601] },
  pad: { x: 983, y: 344, w: 319, h: 307 },       // the number pad's nine tiles
  corners: [[995, 356], [1103, 356], [1212, 356], [995, 460], [1103, 460], [1212, 460], [995, 565], [1103, 565], [1212, 565]],
  search: [320, 140, 1020, 820],                 // where on the screen a board can be
  newGame: [1070, 643], diffX: 1000,             // the WIN screen's New Game button, and its menu's column
  winTop: 170,                                   // the win panel's top edge, down the column x=470
  winWhite: [915, 632],                          // a white bit of that button, clear of its blue label
  winBlue: [470, 650, '#325aaf'],                // the panel's flat lower-left; in a game, a cell's margin
};
// the win screen's "Select Game Mode" menu: each difficulty's row
const DIFF = { easy: 339, medium: 379, hard: 419, expert: 459, master: 499, extreme: 539 };
// WHAT THE PAD SAYS. A tile reads INGAME while its number can still be placed and turns to a TICK once all
// nine are on the board -- so when the last answer lands every tile is a tick, and then the win panel
// covers the pad. Exact colours: the host's capture is lossless.
const INGAME = '#eaeef4', TICK = '#f4f6f9';
const CHUNK = 14;                                // answers between two moves of the panel's count

const shiftRect = (r, dx, dy) => ({ x: Math.round(r.x + dx), y: Math.round(r.y + dy), w: r.w, h: r.h });
const confident = (g) => !!(g && g.ok && g.square >= 0.97 && g.boxsep >= 3);
// The geometry of a board found in the picture: its cells, and the pad, which moves with it.
function geometryOf(g) {
  const dx = g.origin[0] - BASE.origin[0], dy = g.origin[1] - BASE.origin[1], buttons = {};
  for (const k in BASE.buttons) buttons[k] = [Math.round(BASE.buttons[k][0] + dx), Math.round(BASE.buttons[k][1] + dy)];
  return { origin: g.origin, step: g.step, buttons, dx, dy, pad: shiftRect(BASE.pad, dx, dy),
           corners: BASE.corners.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]) };
}
const BASE_GEOM = { origin: BASE.origin, step: BASE.step, buttons: BASE.buttons, dx: 0, dy: 0, pad: BASE.pad, corners: BASE.corners };
const secs = (s) => (s < 0.095 ? s.toFixed(2) : s.toFixed(1)) + ' s';

// Firefox / windowed (live 34123): findGrid often grabs a partial non-square. Locate by box-separator
// pitch instead (outer + 1/3 + 2/3 lines). Proven: pitch≈55.3, origin≈(500,342) under Firefox banners.
function findGridByPitch(img) {
  // Tight band for the TOP-LEFT corner (Chrome ~472,247; Firefox+banners ~472,314).
  const dark = (x, y) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.rows) return false;
    const i = y * img.stride + x * img.bpp;
    return (img.px[i] + img.px[i + 1] + img.px[i + 2]) / 3 < 90;
  };
  const colFrac = (x, y0, y1) => {
    let n = 0, t = 0; for (let y = y0; y < y1; y += 2) { t++; if (dark(x, y)) n++; } return t ? n / t : 0;
  };
  const rowFrac = (y, x0, x1) => {
    let n = 0, t = 0; for (let x = x0; x < x1; x += 2) { t++; if (dark(x, y)) n++; } return t ? n / t : 0;
  };
  let best = null;
  for (const pitch of [55.0, 55.3, 55.5, 56.0]) {
    const board = pitch * 9, sep = pitch * 3;
    for (let x0 = 400; x0 <= 560; x0 += 2) {
      if (x0 + board >= img.w - 10) break;
      for (let y0 = 160; y0 <= 360; y0 += 2) {
        if (y0 + board >= img.rows - 40) break;
        const x1 = Math.round(x0 + board), y1 = Math.round(y0 + board);
        let score = 0;
        for (let k = 0; k < 4; k++) {
          if (colFrac(Math.round(x0 + k * sep), y0 + 5, y1 - 5) > 0.45) score++;
          if (rowFrac(Math.round(y0 + k * sep), x0 + 5, x1 - 5) > 0.45) score++;
        }
        if (score < 6) continue;
        if (!best || score > best.score || (score === best.score && Math.abs(pitch - 55.3) < Math.abs(best.pitch - 55.3))) {
          const sx = board / 9, sy = board / 9;
          best = {
            ok: true, n: 9, score, pitch, boxsep: 4, square: 1,
            bbox: [x0, y0, x1, y1],
            origin: [Math.round((x0 + sx / 2) * 100) / 100, Math.round((y0 + sy / 2) * 100) / 100],
            step: [Math.round(sx * 100) / 100, Math.round(sy * 100) / 100],
            how: 'pitch'
          };
        }
      }
    }
  }
  return best || { ok: false, why: 'no box-separator board at sudoku pitch' };
}
function locateBoard(img) {
  const loose = findGridByPitch(img);
  const g = reader.findGrid(img, { box: BASE.search });
  // Prefer pitch when the page is shifted (Firefox banners): findGrid can look “confident” but
  // its origin/step drifts enough that Digit clicks miss lower rows (live 34123).
  if (loose.ok) {
    const dy = loose.origin[1] - BASE.origin[1];
    if (Math.abs(dy) > 30 || !confident(g)) return loose;
  }
  if (confident(g)) return g;
  return loose.ok ? loose : (g && g.ok ? g : loose);
}
// Pad tiles match Chrome colours → click the pad. Firefox shift often misses the pad → Digit keys.
function padInPlay(img, geom) {
  const tiles = geom.corners.map(([x, y]) => eyes.probe(img, x, y));
  return { tiles, ingame: tiles.includes(INGAME), ticks: tiles.every((t) => t === TICK) };
}

// ---- talking to the serve loop ----------------------------------------------------------------------
// In-process (cmd-file.js's exchange), not a node process per command. Every action is quiet: the tree
// below is the narration, and a "Clicking" line must never stomp it.
//
// THE OPERATOR COMES FIRST. The serve loop stops a plan the moment somebody writes in the session chat,
// so the agent can answer. A routine that carried on regardless would act on half a plan: the second live
// run did -- its New Game plan was cut after the first click, the menu stayed open, and the routine then
// took the screen for "not sudoku". So an interrupted plan ends the routine (exit 5), and so does mail
// that arrived since the driver's last command (`inbox.n`, on the routine's very first answer).
const call = (o) => exchange(dir, o);
const operatorSpoke = (latest) => Object.assign(new Error('the operator wrote: "' + String((latest && latest.text) || '').slice(0, 160) + '"'), { operator: true });
function act(o) {
  const r = call(Object.assign({ quiet: 1 }, o));
  if (r && r.stoppedAt && r.stoppedAt.interrupted) throw operatorSpoke(r.inbox && r.inbox.latest);
  return r;
}

// ---- the live progress tree ---------------------------------------------------------------------------
// The watchers' panel shows the routine as a nested tree whose steps advance as it goes, each with its own
// stopwatch, and goes green on `fin`. A status with `fin:1` is display-only: unlike the `done` verb it does
// not hang up, because the operator may keep driving. Best-effort: the panel never stops a solve.
let TREE = null;
const snap = () => JSON.parse(JSON.stringify(TREE));
function pushTree(text, opts) { try { return call(Object.assign({ do: 'status', tree: snap() }, text != null ? { text } : {}, opts || {})); } catch (_) { return null; } }
// the routine's first word: if the operator has written since the driver last looked, stop before acting
function firstPush(text) { const r = pushTree(text); if (r && r.inbox && r.inbox.n > 0) throw operatorSpoke(r.inbox.latest); }
// `say` is the chat report posted as the panel goes green: Markdown the viewer lays out as blocks.
function treeDone(text, say) { try { call(Object.assign({ do: 'status', text, tree: snap(), fin: 1 }, say ? { say } : {})); } catch (_) {} }

// A visit that has ended leaves stopped.json newer than ready.json: say so now, not after a 35 s timeout.
function needSession() {
  const st = (f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { return 0; } };
  if (st('stopped.json') && st('stopped.json') >= st('ready.json')) {
    let why = ''; try { why = JSON.parse(fs.readFileSync(path.join(dir, 'stopped.json'), 'utf8')).why || ''; } catch (_) {}
    console.error('[x] the visit in ' + dir + ' has ended' + (why ? ' (' + why + ')' : '') + ' -- connect again (agent-join.js --serve ' + dir + ')');
    process.exit(3);
  }
}

function capture(name) {
  // Absolute out: the serve's cwd is often the visit folder itself. A relative
  // `work/mcp-…/board_raw.png` then becomes visit/work/mcp-…/board_raw.png (ENOENT).
  // Live miss 34123 MCP 2026-11-07 — relative `./work/mcp-*` broke fast.js/play.
  const out = path.resolve(dir, name);
  const r = act({ do: 'shot', out });
  if (!r || !r.ok) throw new Error('the screenshot failed: ' + ((r && r.why) || 'no answer'));
  return eyes.decode(fs.readFileSync(out));   // a shot answers "bytes":0 even when the file is fine
}

// ---- showing the watchers what it is about to work on (--show) ----------------------------------------
// Asked for on 10001: "spotlight the region what you are going to handle -- if you are going to capture
// screen, spotlight its rectangle, if you are going to read the grid, spotlight its rectangle". The serve's
// `spotlight` does it as a person would: the laser dot travels there, rounds it twice, pings it. The panel
// line says what comes next. SHOWN keeps its time apart, so the steps' own times still compare.
let SHOWN = 0;
const since = (t0, s0) => Math.max(0, (Date.now() - t0) / 1000 - (SHOWN - s0));
const grow = (r, g) => [r[0] - g, r[1] - g, r[2] + g, r[3] + g];
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const padBox = (geom) => [geom.pad.x, geom.pad.y, geom.pad.x + geom.pad.w, geom.pad.y + geom.pad.h];
const boardBox = (geom) => { const x = geom.origin[0] - geom.step[0] / 2, y = geom.origin[1] - geom.step[1] / 2; return [x, y, x + 9 * geom.step[0], y + 9 * geom.step[1]]; };
function screenBox() {
  let w = 1920, h = 1080;
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'ready.json'), 'utf8')); w = j.w || w; h = j.h || h; } catch (_) {}
  return [18, 18, w - 19, h - 19];   // inset, so each round can widen and still stay on the screen
}
// the win screen's New Game button: its white, flooded from the picture -- else where it is drawn
function newGameBox(img, dy) {
  dy = Math.round(dy);                           // a shift read off a found grid is fractional
  const f = img && eyes.flood(img, BASE.winWhite[0], BASE.winWhite[1] + dy, { x: 640, y: 540 + dy, w: 860, h: 200 });
  // button-shaped (wide, not tall): from a just-solved board the seed lands in a cell, not on the button
  if (f && f.ok && !f.escaped && f.box[2] > 200 && f.box[3] < 120) return [f.box[0], f.box[1], f.box[0] + f.box[2] - 1, f.box[1] + f.box[3] - 1];
  return [902, 620 + dy, 1242, 668 + dy];
}
// `rect` may be a function, so nothing is measured for a spotlight that is not shown
function show(rect, line) {
  if (!SHOW) return;
  if (typeof rect === 'function') rect = rect();
  const t0 = Date.now();
  pushTree(line);
  act({ do: 'spotlight', rect: grow(rect, 6).map((v) => Math.round(v)), rounds: 2, times: 2 });
  SHOWN += (Date.now() - t0) / 1000;
}

// ---- what is on the screen ----------------------------------------------------------------------------
// From ONE picture: the win screen (and how far the page has shifted), a game in progress (a board, and at
// least one pad tile still in play), a board whose pad is all ticks (just solved; the win panel follows),
// or something else. The win screen is asked FIRST: its panel is dark blue, every row of it a long dark
// run, so to the grid finder a plain one is a perfect square -- only the thumbnail and score boxes on the
// real one happen to break its box lines.
function screenState(img) {
  const won = winPanel(img);
  if (won) return { kind: 'won', dy: won.dy };
  const g = locateBoard(img);
  if (!g || !g.ok || (!(g.how === 'pitch') && !confident(g))) {
    return { kind: 'other', why: (g && g.ok) ? 'something grid-like, but not surely a board (square ' + g.square + ', box lines ' + g.boxsep + ')' : ((g && g.why) || 'no board') };
  }
  const geom = geometryOf(g), pad = padInPlay(img, geom);
  // Pitch locate fixes Firefox board origin; pad usually still reads INGAME after the same shift — use pad clicks.
  // Digit keys are a fallback only when pad colours miss (live: Digits sometimes never land in Firefox).
  if (pad.ticks) return { kind: 'ticks', g, geom };
  if (pad.ingame) return { kind: 'game', g, geom, digitFill: false };
  if (g.how === 'pitch' || g.ok) return { kind: 'game', g, geom, digitFill: true };
  return { kind: 'other', why: 'a board, but its number pad is not in play (' + pad.tiles.join(' ') + ')' };
}
// The win panel: blue from its top edge ~550 px down the column x=470 -- a highlighted cell in a game is
// blue there too, but one cell tall -- with the white New Game button where the shift says it must be.
function winPanel(img) {
  const blue = (x, y) => { const h = eyes.probe(img, x, y); return !!h && parseInt(h.slice(5, 7), 16) - parseInt(h.slice(1, 3), 16) > 50; };
  for (let y = 120; y < 420; y++) {
    if (!blue(470, y)) continue;
    if (![100, 200, 300, 400].every((k) => blue(470, y + k))) return null;
    const dy = y - BASE.winTop;
    return eyes.probe(img, BASE.winWhite[0], BASE.winWhite[1] + dy) === '#ffffff' ? { dy } : null;
  }
  return null;
}
// "Game Over / 3 mistakes" white modal with blue Second Chance (live 34123, 2026-11-07). Not the win panel.
function gameOverOn(img) {
  if (!img || !img.ready || winPanel(img)) return null;
  let whiteY = null;
  for (let y = 260; y < 520; y += 4) {
    let w = 0;
    for (let x = 700; x < 1200; x += 3) {
      const h = eyes.probe(img, x, y);
      if (h && parseInt(h.slice(1, 3), 16) > 240 && parseInt(h.slice(3, 5), 16) > 240 && parseInt(h.slice(5, 7), 16) > 240) w++;
    }
    if (w > 80) { whiteY = y; break; }
  }
  if (whiteY == null) return null;
  for (let y = whiteY + 40; y < whiteY + 240; y += 3) {
    let b = 0;
    for (let x = 820; x < 1100; x += 2) {
      const h = eyes.probe(img, x, y); if (!h) continue;
      const R = parseInt(h.slice(1, 3), 16), G = parseInt(h.slice(3, 5), 16), B = parseInt(h.slice(5, 7), 16);
      if (B > R + 40 && B > 120 && G < B) b++;
    }
    if (b > 40) return { whiteY, blueY: y };
  }
  return null;
}
// Leave a lost board: New Game under Second Chance, confirm OK if asked, Escape ad interstitials.
// Do NOT learn glyphs from the board that just lost — those reads were wrong.
function recoverFromGameOver(go) {
  const linkY = go && go.blueY ? go.blueY + 72 : 590;
  act({ do: 'plan', steps: [
    { do: 'click', x: 960, y: linkY }, { do: 'hold' }, { do: 'hold' }, { do: 'hold' },
    { do: 'click', x: 880, y: 545 }, { do: 'hold' }, { do: 'hold' }, { do: 'hold' }, { do: 'hold' }
  ] });
  act({ do: 'press', code: 'Escape' });
  act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }, { do: 'hold' }] });
}

// sudoku.com's FIRST-VISIT HINT -- "Select a cell, then tap a number to fill in the cell" -- lies over the
// board's last two rows in the win panel's blue, so those cells read as nothing learned (10001, 2026-10-26:
// 460x54 at the board's left +20, top +426). Asked of its top margin, clear of its white words.
function hintOn(img, g) {
  const [x0, y0] = g.bbox, y = y0 + 433;
  if (![x0 + 30, x0 + 250, x0 + 470].every((x) => eyes.probe(img, x, y) === BASE.winBlue[2])) return null;
  const f = eyes.flood(img, x0 + 30, y, { x: x0, y: y0 + 380, w: g.bbox[2] - x0, h: 140 });
  return f.ok && f.box[2] > 300 && f.box[3] < 100 ? [f.box[0], f.box[1], f.box[0] + f.box[2] - 1, f.box[1] + f.box[3] - 1] : null;
}

// Start a game from the win screen. "New Game" opens a menu that has an opening animation and closes by
// itself if left, so New Game -> two beats -> the difficulty go in ONE host-side plan (`hold`, a warm
// capture, is the beat). The game is up when its pad is -- asked of the pad's top row rather than one
// pixel, because the pointer now rests on the pad and a tile under it need not read INGAME. Then two more
// beats for the board and its "Loading game" overlay, so the picture never catches a half-drawn board.
function findWhiteNewGame(img) {
  // Wide white row on the blue win panel (Firefox Excellent / score card) — live 34123: ~y 834.
  let best = null;
  for (let y = 560; y < Math.min(img.rows - 20, 950); y += 2) {
    let run = 0, x0 = 0;
    for (let x = 700; x < 1300; x++) {
      const h = eyes.probe(img, x, y);
      const wh = h && parseInt(h.slice(1, 3), 16) > 240 && parseInt(h.slice(3, 5), 16) > 240 && parseInt(h.slice(5, 7), 16) > 240;
      if (wh) { if (!run) x0 = x; run++; }
      else { if (run > 180 && (!best || run > best.w)) best = { x0, x1: x, y, w: run }; run = 0; }
    }
  }
  return best ? { x: Math.round((best.x0 + best.x1) / 2), y: best.y + 18 } : null;
}
function newGame(d, dy) {
  dy = Math.round(dy || 0);
  let nx = BASE.newGame[0], ny = BASE.newGame[1] + dy;
  try {
    const img = eyes.decode(fs.readFileSync(path.join(dir, 'board_raw.png')));
    const white = findWhiteNewGame(img);
    if (white) { nx = white.x; ny = white.y; }
    else {
      const box = newGameBox(img, dy);
      nx = Math.round((box[0] + box[2]) / 2); ny = Math.round((box[1] + box[3]) / 2);
    }
  } catch (_) {}
  act({ do: 'plan', steps: [
    { do: 'click', x: nx, y: ny }, { do: 'hold' }, { do: 'hold' },
    { do: 'click', x: BASE.diffX, y: DIFF[d] + dy },
    { do: 'hold' }, { do: 'hold' }
  ] });
  let w = null;
  try {
    w = act({ do: 'wait', until: { any: { rect: { x: BASE.pad.x, y: BASE.pad.y + dy, w: BASE.pad.w, h: 120 }, is: INGAME } }, timeout: 8000, poll: 250 });
  } catch (e) { if (e.operator) throw e; }
  if (!w || !w.ok) {
    try { w = act({ do: 'wait', until: { any: { rect: { x: BASE.pad.x, y: BASE.pad.y, w: BASE.pad.w, h: 200 }, is: INGAME } }, timeout: 4000, poll: 250 }); } catch (e) { if (e.operator) throw e; }
  }
  act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }] });
  return !!(w && w.ok);
}

// ---- reading -------------------------------------------------------------------------------------------
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
function loadShapes() {
  const { bank, skipped } = reader.loadBank([SEED, LOCAL]);
  for (const f of skipped) console.error('[read] ignoring ' + f + ': made with another shape than ' + reader.FEATURE);
  return bank;
}
// The 81 cells, settled. A bank missing a digit is not trusted at all: that digit's cells would read as
// their nearest OTHER digit -- measured as close as 0.90 -- with nothing to say so. `unknown` sits under the
// lowest a real read reached (0.905); a doubtful cell goes to the solver, an unknown one to the model.
function readBoard(img, g, bank) {
  const t0 = Date.now(), rd = reader.readGrid(img, g, bank, { unknown: 0.8 });
  const grid = [...Array(9)].map(() => Array(9).fill(0));
  for (const c of rd.cells) grid[c.r][c.c] = c.g ? Number(c.g) : 0;
  const out = { rd, grid, readMs: Date.now() - t0 };
  if (!DIGITS.every((d) => (bank.glyphs[d] || []).length)) return Object.assign(out, { ok: false, why: 'not every digit has been learned yet (' + reader.bankSize(bank) + ' shapes)' });
  if (rd.unknown.length) return Object.assign(out, { ok: false, why: rd.unknown.length + ' cell(s) look like nothing learned' });
  const t1 = Date.now(), s = sudoku.settle(grid, rd.doubts.map((c) => ({ r: c.r, c: c.c, cands: c.cands })));
  out.solveMs = Date.now() - t1;
  if (!s.ok) return Object.assign(out, { ok: false, why: s.why });
  return Object.assign(out, { ok: true, grid: s.grid, solution: s.solution, settled: rd.doubts.length });
}

// THE ONE READ A MODEL STILL DOES: the board enlarged, and the best reading with the cells to check named --
// a few cells to look at, not 81. The game confirming that read is what teaches the shapes.
function askModel(img, g, r, why) {
  const m = Math.round(g.step[0] * 0.3);
  fs.writeFileSync(path.join(dir, 'board.png'), reader.cropPng(img, { x: g.bbox[0] - m, y: g.bbox[1] - m, w: g.bbox[2] - g.bbox[0] + 2 * m, h: g.bbox[3] - g.bbox[1] + 2 * m }, 2.3));
  const check = r.rd.doubts.concat(r.rd.unknown).map((c) => [c.r + 1, c.c + 1]);
  fs.writeFileSync(path.join(dir, 'grid.draft.json'), JSON.stringify({ why, check, grid: r.grid }, null, 1));
  return 'READ NEEDED (' + why + '): look at ' + path.join(dir, 'board.png') + ', correct ' + path.join(dir, 'grid.draft.json') +
         (check.length && check.length < 20 ? ' (check row,col ' + check.map((x) => x.join(',')).join(' ') + ')' : '') +
         ', save the 9x9 grid as ' + path.join(dir, 'grid.json') + ', then: node skills/solve-a-sudoku/sudoku.js ' + dir + ' solve';
}

// LEARN WHAT THE GAME JUST CONFIRMED: each given's shape under its digit -- only where it is new against
// everything known (seed included), and at most 16 per digit in this machine's own file.
function learnFrom(img, g, grid) {
  const all = loadShapes(), local = reader.loadBank([LOCAL]).bank;
  let added = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const d = String(grid[r][c] || '');
    const s = d && reader.cellShape(img, g, r, c);
    if (!s || (local.glyphs[d] || []).length >= 16 || !reader.learn(all, s, d, { cap: Infinity })) continue;
    (local.glyphs[d] = local.glyphs[d] || []).push(s.v);
    added++;
  }
  if (added) reader.saveBank(LOCAL, local, 'learned on this machine from boards the game confirmed; not shared (*.local.*)');
  return added;
}

// ---- filling, and asking the game ----------------------------------------------------------------------
// The last two answers are kept to different numbers, so the last one's tile is neither ticked nor under
// the pointer when the pad is asked about just before it (see fillAndCheck).
function lastTwoDiffer(fills) {
  const f = fills.slice(), n = f.length;
  if (n < 2 || f[n - 1][2] !== f[n - 2][2]) return f;
  const i = f.findIndex((x) => x[2] !== f[n - 1][2]);
  if (i >= 0) [f[i], f[n - 2]] = [f[n - 2], f[i]];
  return f;
}
// ONE plan: each answer is its cell, then its number on the pad, and every CHUNK answers a `status` step
// moves the panel's count. Just before the LAST answer the pad must still be in play: a game that ended
// early (three mistakes) would otherwise look exactly like a solved one to the check after it. Then the
// check itself: no tile left in play -- ticks, then the win panel -- is the game saying solved.
// `beforeCheck` runs between the two (--show circles the pad there).
function fillAndCheck(geom, fills, node, beforeCheck, opts) {
  const digitFill = !!(opts && opts.digitFill);
  const cellX = (c) => Math.round(geom.origin[0] + c * geom.step[0]);
  const cellY = (r) => Math.round(geom.origin[1] + r * geom.step[1]);
  const order = lastTwoDiffer(fills), n = order.length, steps = [];
  const count = (k) => {
    node.k = [{ t: k < n ? 'Entered ' + k + ' of ' + n + ' numbers' : 'Entered all ' + n + ' numbers', s: k < n ? 'doing' : 'done' }];
    return { do: 'status', tree: snap(), text: 'Filling in answers — ' + k + ' of ' + n };
  };
  if (!digitFill) steps.push(count(0));
  else steps.push({ do: 'status', tree: snap(), text: 'Filling in ' + n + ' answers (Digit keys)' });
  order.forEach(([r, c, v], i) => {
    // Pad expect only when we click the pad — Digit fill skips it (Firefox pad colours/geometry miss).
    if (!digitFill && (i % CHUNK === 0 || (i === n - 1 && n > 1 && order[n - 2][2] !== v))) {
      steps.push({ do: 'expect', until: { any: { rect: geom.pad, is: INGAME } } });
    }
    if (digitFill) {
      // No fast:1 — Firefox drops Digit presses when cell focus is not settled (live: 7.8s “fill” left half empty).
      steps.push({ do: 'click', x: cellX(c), y: cellY(r) });
      steps.push({ do: 'press', code: 'Digit' + v });
      if ((i + 1) % 9 === 0) steps.push({ do: 'hold' }); // one settle per row
    } else {
      const b = geom.buttons[String(v)];
      steps.push({ do: 'click', x: cellX(c), y: cellY(r), fast: 1 }, { do: 'click', x: b[0], y: b[1], fast: 1 });
    }
    if (!digitFill && ((i + 1) % CHUNK === 0 || i === n - 1)) steps.push(count(i + 1));
  });
  if (digitFill) steps.push(count(n));
  const t0 = Date.now(), p = act({ do: 'plan', steps });
  const fillS = (Date.now() - t0) / 1000;
  if (!p || !p.ok) {
    const at = p && p.stoppedAt;
    return { solved: false, fillS, checkS: 0, why: at && at.do === 'expect' ? 'the number pad is no longer on the board mid-fill -- the game ended early (three mistakes, from a misread or clicks that missed) or the page navigated / an ad appeared; the fill STOPPED rather than clicking blindly'
                                                                            : 'the fill stopped: ' + ((p && (p.why || (at && at.why))) || 'no answer') };
  }
  if (beforeCheck) beforeCheck();
  const t1 = Date.now();
  let w = null;
  try {
    if (digitFill) {
      // Exact win-blue waits miss (capture colour ≠ #325aaf). One settle + cropped look (~fast).
      act({ do: 'hold' });
      const vOut = path.join(dir, 'verify_look.png');
      act({ do: 'look', out: vOut, rect: { x: 380, y: 120, w: 700, h: 700 }, max: 700 });
      const shot = eyes.decode(fs.readFileSync(vOut));
      let streak = false, bluePanel = false;
      if (shot && shot.ready) {
        for (const [lx, ly] of [[220, 160], [300, 180], [250, 220], [200, 380], [320, 420], [100, 100]]) {
          const h = eyes.probe(shot, lx, ly); if (!h) continue;
          const R = parseInt(h.slice(1, 3), 16), G = parseInt(h.slice(3, 5), 16), B = parseInt(h.slice(5, 7), 16);
          if (R > 80 && B > 140 && G < R) streak = true;
          if (B - R > 50 && B > 100) bluePanel = true;
        }
      }
      w = { ok: !!(streak || bluePanel) };
      if (!w.ok) {
        const full = capture('verify_raw.png');
        w = { ok: !!(winPanel(full) || padInPlay(full, geom).ticks) };
      }
    } else {
      // Short wait — win panel / streak often covers the pad before every tile ticks.
      w = act({ do: 'wait', until: { none: { rect: geom.pad, is: INGAME } }, timeout: 5000, poll: 200 });
      if (!w || !w.ok) {
        act({ do: 'hold' });
        const full = capture('verify_raw.png');
        const h = eyes.probe(full, 600, 300);
        const streak = !!(h && parseInt(h.slice(1, 3), 16) > 80 && parseInt(h.slice(5, 7), 16) > 140);
        w = { ok: !!(winPanel(full) || streak || padInPlay(full, geom).ticks) };
      }
    }
  } catch (e) { if (e.operator) throw e; return { solved: false, fillS, checkS: (Date.now() - t1) / 1000, why: 'no answer from the host while the game finished (' + e.message + ')' }; }
  const checkS = (Date.now() - t1) / 1000;
  if (!w || !w.ok) return { solved: false, fillS, checkS, why: 'the game is still running after the last answer -- a number is in the wrong cell, or the board was misread' };
  return { solved: true, fillS, checkS };
}

// When the game did NOT say solved: the one place a screenshot is worth its seconds -- for the person.
function evidence(geom) {
  try {
    const img = capture('verify_raw.png'), b = { x: geom.origin[0] - geom.step[0], y: geom.origin[1] - geom.step[1] - 60 };
    fs.writeFileSync(path.join(dir, 'verify.png'), reader.cropPng(img, { x: b.x, y: b.y, w: geom.step[0] * 15.5, h: geom.step[1] * 10 + 60 }, 1.1));
    return path.join(dir, 'verify.png');
  } catch (e) { return '(no screenshot: ' + e.message + ')'; }
}

function record(o) {
  try { fs.appendFileSync(path.join(dir, 'sudoku-runs.jsonl'), JSON.stringify(Object.assign({ at: new Date().toISOString(), cmd }, o)) + '\n'); } catch (_) {}
}
const gridRows = (g) => g.map((row) => row.join(' ')).join('\n');
function loadGrid(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')), g = Array.isArray(j) ? j : j.grid;
  if (!Array.isArray(g) || g.length !== 9 || g.some((row) => !Array.isArray(row) || row.length !== 9)) throw new Error(file + ' is not a 9x9 grid');
  return g.map((row) => row.map((v) => Number(v) || 0));
}
// a saved picture: a full screen is searched where a board can be; anything else (a crop) whole
function gridIn(img) {
  return locateBoard(img);
}

// ==== the commands ======================================================================================
if (cmd === 'play') {
  const d = (arg || 'master').toLowerCase();
  if (!DIFF[d]) { console.error('unknown difficulty "' + d + '" (' + Object.keys(DIFF).join(' | ') + ')'); process.exit(2); }
  needSession();
  const start = Date.now(), T = {};
  const N = { look: { t: 'Look at the board', s: 'doing' }, read: { t: 'Read the 81 cells', s: 'todo' }, solve: { t: 'Solve the puzzle', s: 'todo' },
              fill: { t: 'Fill in the answers', s: 'todo', k: [] }, check: { t: 'Check the game says solved', s: 'todo' } };
  TREE = [N.look, N.read, N.solve, N.fill, N.check];
  firstPush('Looking at the screen');
  show(screenBox(), 'Spotlighting the screen — capturing it next');
  let t = Date.now(), s = SHOWN, img = capture('board_raw.png'), st = screenState(img);
  // Lost board from a prior misread fill (Game Over modal) — start fresh before reading anything.
  let go0 = gameOverOn(img);
  if (go0) {
    pushTree('Game Over on screen — New Game (do not learn the lost board)');
    recoverFromGameOver(go0);
    img = capture('board_raw.png'); st = screenState(img);
  }
  // Video-ad interstitial / "Loading game" (live 34123): poll until a board or win panel appears.
  if (st.kind === 'other') {
    pushTree('Waiting for the board (ad or loading)');
    for (let i = 0; i < 12 && st.kind === 'other'; i++) {
      act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }, { do: 'hold' }] });
      img = capture('board_raw.png'); st = screenState(img);
      const goWait = gameOverOn(img);
      if (goWait) { recoverFromGameOver(goWait); img = capture('board_raw.png'); st = screenState(img); }
    }
  }
  if (st.kind === 'ticks') {                     // just solved: the win panel is on its way
    let w = null;
    try { w = act({ do: 'wait', until: { px: { x: BASE.winBlue[0], y: BASE.winBlue[1] + st.geom.dy, is: BASE.winBlue[2] } }, timeout: 10000, poll: 400 }); } catch (e) { if (e.operator) throw e; }
    if (w && w.ok) st = { kind: 'won', dy: st.geom.dy };   // the wait SAW the panel: no screenshot to confirm it
    else { show(screenBox(), 'Spotlighting the screen — capturing it again'); img = capture('board_raw.png'); st = screenState(img); }
  }
  if (st.kind === 'won') {
    N.start = { t: 'Start a new ' + d + ' game', s: 'doing', k: [{ t: 'Open the New Game menu, pick ' + d, s: 'doing' }, { t: 'Wait for the board', s: 'todo' }] };
    TREE.unshift(N.start); N.look.s = 'todo';
    pushTree('Starting a new ' + d + ' game');
    show(() => newGameBox(img, st.dy), 'Spotlighting New Game — pressing it next');
    let up = newGame(d, st.dy);
    if (!up) {                                   // the menu did not take: still on the win screen? once more
      show(screenBox(), 'Spotlighting the screen — checking the game started');
      const shot2 = capture('board_raw.png'), again = screenState(shot2);
      if (again.kind === 'won') { show(() => newGameBox(shot2, again.dy), 'Spotlighting New Game — pressing it again'); up = newGame(d, again.dy); }
    }
    N.start.k[0].s = 'done'; N.start.k[1].s = up ? 'done' : 'warn'; N.start.s = 'done'; N.look.s = 'doing';
    T.start = since(t, s);
    pushTree('Looking at the new board');
    show(screenBox(), 'Spotlighting the screen — capturing the new board next');
    t = Date.now(); s = SHOWN; img = capture('board_raw.png'); st = screenState(img);
  }
  const hint = st.kind === 'game' && hintOn(img, st.g);
  if (hint) {
    // First-visit hint — selecting a cell clears it.
    show(hint, 'Spotlighting a hint over the board — closing it next');
    pushTree('Closing the hint over the board');
    act({ do: 'click', x: Math.round(st.geom.origin[0]), y: Math.round(st.geom.origin[1]) });
    act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }] });
    show(screenBox(), 'Spotlighting the screen — capturing it again');
    img = capture('board_raw.png'); st = screenState(img);
    if (st.kind === 'game' && hintOn(img, st.g)) st = { kind: 'other', why: 'a hint still covers the board after a cell was selected' };
  }
  // Fresh open can still show "Loading game" over a half-drawn board that looks like kind=game.
  if (st.kind === 'game') {
    pushTree('Letting the board finish loading');
    act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }, { do: 'hold' }, { do: 'hold' }] });
    img = capture('board_raw.png'); st = screenState(img);
  }
  T.look = since(t, s);
  if (st.kind !== 'game') {
    N.look.s = 'warn';
    const why = st.why || (st.kind === 'won' ? 'still on the win screen after New Game' : ('screen is “' + st.kind + '”'));
    pushTree('This is not a sudoku.com game', { warn: 'Not a sudoku.com game or win screen: ' + why });
    console.error('[x] not a sudoku.com game or win screen (' + why + ') -- see ' + path.join(dir, 'board_raw.png'));
    record({ solved: false, why, s: T });
    process.exit(3);
  }
  N.look.s = 'done'; N.read.s = 'doing';
  let r = null, fills = null, res = null, misreadRetry = 0;
  for (;;) {
    show(st.g.bbox, 'Spotlighting the grid — reading it next');
    pushTree(misreadRetry ? 'Re-reading after Game Over (prior read was wrong — not learning it)' : 'Reading the board');
    r = readBoard(img, st.g, loadShapes());
    // One retry after a fresh click: tip banners sometimes leave ink that confuses a first glyph read.
    if (!r.ok) {
      act({ do: 'click', x: Math.round(st.geom.origin[0] + st.geom.step[0]), y: Math.round(st.geom.origin[1]) });
      act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }] });
      img = capture('board_raw.png'); st = screenState(img);
      if (st.kind === 'game') r = readBoard(img, st.g, loadShapes());
    }
    T.read = r.readMs / 1000;
    if (!r.ok) {
      N.read.s = 'warn';
      const msg = askModel(img, st.g, r, r.why);
      pushTree('Need help reading this board', { warn: 'I could not read every cell for sure: ' + r.why + '.' });
      console.log(msg);
      record({ solved: false, read: 'needs-model', why: r.why, s: T });
      process.exit(10);
    }
    fills = sudoku.fillsOf(r.grid, r.solution);
    T.solve = (r.solveMs || 0) / 1000;
    N.read.t = 'Read the 81 cells: ' + r.rd.filled + ' givens' + (r.settled ? ', ' + r.settled + ' settled by the solver' : '');
    N.read.s = 'done'; N.solve.t = 'Solve the puzzle: one solution, ' + fills.length + ' answers'; N.solve.s = 'done'; N.fill.s = 'doing';
    fs.writeFileSync(path.join(dir, 'grid.json'), JSON.stringify(r.grid));
    show(union(st.g.bbox, padBox(st.geom)), 'Spotlighting the board and number pad — filling in next');
    pushTree('Filling in ' + fills.length + ' answers', { next: 'check the game says solved' });
    res = fillAndCheck(st.geom, fills, N.fill, () => { N.fill.s = 'done'; N.check.s = 'doing'; show(padBox(st.geom), 'Spotlighting the number pad — checking the game says solved'); }, { digitFill: !!st.digitFill });
    T.fill = (T.fill || 0) + res.fillS; T.check = res.checkS;
    N.fill.s = 'done';
    if (res.solved) break;
    // Silent glyph misread: unique solution on a wrong grid → 3 mistakes → Game Over. Recover once.
    const ev = evidence(st.geom);
    let go = null;
    try { go = gameOverOn(eyes.decode(fs.readFileSync(path.join(dir, 'verify_raw.png')))); } catch (_) {}
    if (!go) {
      try { go = gameOverOn(capture('board_raw.png')); } catch (_) {}
    }
    if (!go || misreadRetry >= 1) {
      N.check.s = 'warn';
      pushTree('The game did not say solved', { warn: res.why });
      console.error('[x] NOT SOLVED: ' + res.why + (go ? ' (glyph misread → Game Over; already retried once)' : '') + ' -- see ' + ev);
      record({ solved: false, why: res.why, misread: !!go, s: T, total: (Date.now() - start) / 1000 });
      process.exit(4);
    }
    misreadRetry++;
    console.error('[!] glyph misread ended the game (wrong clues, not random clicks) — New Game and retry once; not learning that board');
    pushTree('Game Over from misread — New Game, re-read (no learn)');
    recoverFromGameOver(go);
    N.read.s = 'doing'; N.solve.s = 'todo'; N.fill.s = 'todo'; N.check.s = 'todo';
    img = capture('board_raw.png'); st = screenState(img);
    if (st.kind === 'other') {
      for (let i = 0; i < 8 && st.kind === 'other'; i++) {
        act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }] });
        img = capture('board_raw.png'); st = screenState(img);
      }
    }
    if (st.kind !== 'game') {
      N.check.s = 'warn';
      console.error('[x] NOT SOLVED: after Game Over recovery, screen is “' + st.kind + '” -- see ' + path.join(dir, 'board_raw.png'));
      record({ solved: false, why: 'recovery-failed:' + st.kind, s: T, total: (Date.now() - start) / 1000 });
      process.exit(4);
    }
  }
  const total = (Date.now() - start) / 1000;
  T.show = SHOWN;
  const times = [T.start != null ? 'new game ' + secs(T.start) : null, 'look ' + secs(T.look), 'read ' + secs(T.read), 'solve ' + secs(T.solve), 'fill ' + secs(T.fill), 'check ' + secs(T.check),
                 SHOWN ? 'spotlights ' + secs(SHOWN) : null, misreadRetry ? 'misread-retry ' + misreadRetry : null].filter(Boolean).join(' · ');
  const learned = learnFrom(img, st.g, r.grid);
  N.check.s = 'done';
  const line = 'Solved in ' + secs(total) + ' (' + times + ')';
  treeDone(line, '**✓ Sudoku solved in ' + secs(total) + '** — no mistakes\n' +
    (SHOWN ? '- **Spotlighted** each area before working on it · ' + secs(SHOWN) + '\n' : '') +
    (T.start != null ? '- **New game** started · ' + secs(T.start) + '\n' : '') +
    '- **Read** the 81 cells from the screen' + (r.settled ? ' (' + r.settled + ' settled by the solver)' : '') + ' · ' + secs(T.look + T.read) + '\n' +
    '- **Solved** it — one solution, ' + fills.length + ' answers · ' + secs(T.solve) + '\n' +
    '- **Filled** in ' + fills.length + ' numbers · ' + secs(T.fill) + '\n' +
    '- **Checked** — the game says solved · ' + secs(T.check) +
    (learned ? '\n- **Learned** ' + learned + ' new digit shape' + (learned === 1 ? '' : 's') + ' from this board' : ''));
  console.log('SOLVED' + (T.start != null ? ' a new ' + d + ' game' : ' the game on screen') + ': ' + line + ' -- read from pixels' + (r.settled ? ', ' + r.settled + ' doubtful cell(s) settled by the solver' : '') + (misreadRetry ? ', after ' + misreadRetry + ' misread Game Over recovery' : '') + (learned ? ', learned ' + learned + ' new shape(s)' : ''));
  record({ solved: true, read: 'pixels', settled: r.settled, learned, fills: fills.length, misreadRetry, s: T, total });
} else if (cmd === 'newgame') {
  // The first half of the two-step flow: a new game from the win screen, and its board read -- by the
  // learned shapes when they are sure (grid.json written), else left to a model (board.png).
  const d = (arg || 'master').toLowerCase();
  if (!DIFF[d]) { console.error('unknown difficulty "' + d + '" (' + Object.keys(DIFF).join(' | ') + ')'); process.exit(2); }
  needSession();
  TREE = [{ t: 'Start a new ' + d + ' game', s: 'doing', k: [{ t: 'Open the New Game menu, pick ' + d, s: 'doing' }, { t: 'Wait for the board to load', s: 'todo' }, { t: 'Capture the board', s: 'todo' }] }];
  firstPush('Starting a new ' + d + ' game');
  show(() => newGameBox(null, 0), 'Spotlighting New Game — pressing it next');
  const up = newGame(d, 0);
  TREE[0].k[0].s = 'done'; TREE[0].k[1].s = up ? 'done' : 'warn'; TREE[0].k[2].s = 'doing';
  pushTree('Capturing the board');
  show(screenBox(), 'Spotlighting the screen — capturing the board next');
  const img = capture('board_raw.png'), st = screenState(img);
  TREE[0].k[2].s = st.kind === 'game' ? 'done' : 'warn'; TREE[0].s = 'done';
  if (st.kind !== 'game') {
    fs.writeFileSync(path.join(dir, 'board.png'), reader.cropPng(img, { x: 460, y: 215, w: 505, h: 505 }, 2.3));
    pushTree('The board may not have loaded', { warn: 'The number pad is not in play; the screen may still be on the win screen.' });
    console.log('NEWGAME ' + d + ' [!] no game on screen (' + st.why + ') -- check ' + path.join(dir, 'board.png') + ', re-run newgame');
    process.exit(3);
  }
  const r = readBoard(img, st.g, loadShapes());
  if (r.ok) {
    fs.writeFileSync(path.join(dir, 'grid.json'), JSON.stringify(r.grid));
    pushTree('Board read — solving next');
    console.log('NEWGAME ' + d + ': read from pixels in ' + r.readMs + ' ms, grid.json written -> node skills/solve-a-sudoku/sudoku.js ' + dir + ' solve');
  } else {
    pushTree('Board ready — reading it next');
    console.log('NEWGAME ' + d + ': ' + askModel(img, st.g, r, r.why));
  }
} else if (cmd === 'solve') {
  // The second half: solve grid.json (read by the shapes or by a model), fill, ask the game, learn.
  needSession();
  const start = Date.now(), T = {};
  const N = { geom: { t: 'Work out the geometry', s: 'doing' }, solve: { t: 'Solve the puzzle', s: 'todo' },
              fill: { t: 'Fill in the answers', s: 'todo', k: [] }, check: { t: 'Check the game says solved', s: 'todo' } };
  TREE = [N.geom, N.solve, N.fill, N.check];
  firstPush('Working out the board geometry');
  pushTree(null, { thought: 'Finding the grid in the captured board so the fill lands on the right cells even if the browser chrome shifted.' });
  // GEOMETRY from the board's own picture, so a fill survives a browser-chrome shift; the hand-measured
  // layout only when no board is found there with confidence.
  let geom = BASE_GEOM, img = null, g = null;
  try {
    img = eyes.decode(fs.readFileSync(path.join(dir, 'board_raw.png')));
    g = reader.findGrid(img, { box: BASE.search });
    if (confident(g)) { geom = geometryOf(g); console.error('[geom] found the board: origin ' + JSON.stringify(g.origin) + ' step ' + JSON.stringify(g.step) + ', pad shifted (' + Math.round(geom.dx) + ',' + Math.round(geom.dy) + ')'); }
    else { console.error('[geom] no board found for sure (' + (g.why || 'square ' + g.square + ', box lines ' + g.boxsep) + '); using the hand-measured layout'); g = null; }
  } catch (e) { console.error('[geom] no board_raw.png to measure (' + e.message + '); using the hand-measured layout'); img = null; }
  fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify({ origin: geom.origin, step: geom.step, buttons: geom.buttons }));
  N.geom.s = 'done'; N.solve.s = 'doing'; pushTree('Solving (' + (g ? 'found' : 'hand-measured') + ' grid)');
  let grid;
  try { grid = loadGrid(path.join(dir, 'grid.json')); } catch (e) { console.error('[x] ' + e.message); process.exit(2); }
  const t1 = Date.now(), s = sudoku.solve(grid, 2);
  T.solve = (Date.now() - t1) / 1000;
  console.log('solutions found: ' + s.count + (s.conflict ? ' (the givens clash)' : ''));
  if (s.count !== 1) {
    N.solve.s = 'warn';
    pushTree('The board read does not have a unique solution', { warn: 'Not a unique solution — the board was misread. Re-read it and fix grid.json, then solve again.' });
    console.error('[x] not a unique solution -> re-read the board (fix grid.json), then run solve again');
    process.exit(2);
  }
  console.log(gridRows(s.solution));
  const fills = sudoku.fillsOf(grid, s.solution);
  console.log('empty cells to fill: ' + fills.length);
  fs.writeFileSync(path.join(dir, 'fills.json'), JSON.stringify({ solution: s.solution, fills, n_fill: fills.length }));
  N.solve.s = 'done'; N.fill.s = 'doing';
  show(union(boardBox(geom), padBox(geom)), 'Spotlighting the board and number pad — filling in next');
  pushTree('Filling in ' + fills.length + ' answers', { next: 'check the game says solved' });
  const res = fillAndCheck(geom, fills, N.fill, () => { N.fill.s = 'done'; N.check.s = 'doing'; show(padBox(geom), 'Spotlighting the number pad — checking the game says solved'); });
  T.fill = res.fillS; T.check = res.checkS; N.fill.s = 'done';
  const total = (Date.now() - start) / 1000;
  if (!res.solved) {
    N.check.s = 'warn';
    pushTree('The game did not say solved', { warn: res.why });
    console.error('[x] NOT SOLVED: ' + res.why + ' -- see ' + evidence(geom));
    record({ solved: false, why: res.why, s: T, total });
    process.exit(4);
  }
  // The read in grid.json is now PROVEN -- the game accepted every answer it led to -- so it teaches the
  // shapes. When a model read this board, this is the step that makes the next board need no model.
  const learned = img && g ? learnFrom(img, g, grid) : 0;
  N.check.s = 'done';
  T.show = SHOWN;
  const line = 'Solved in ' + secs(total) + ' (solve ' + secs(T.solve) + ' · fill ' + secs(T.fill) + ' · check ' + secs(T.check) + (SHOWN ? ' · spotlights ' + secs(SHOWN) : '') + ')';
  treeDone(line, '**✓ Sudoku solved in ' + secs(total) + '** — no mistakes\n' +
    (SHOWN ? '- **Spotlighted** each area before working on it · ' + secs(SHOWN) + '\n' : '') +
    '- **Solved** it — one solution, ' + fills.length + ' answers · ' + secs(T.solve) + '\n' +
    '- **Filled** in ' + fills.length + ' numbers · ' + secs(T.fill) + '\n' +
    '- **Checked** — the game says solved · ' + secs(T.check) +
    (learned ? '\n- **Learned** ' + learned + ' new digit shape' + (learned === 1 ? '' : 's') + ' — the next board reads without help' : ''));
  console.log('SOLVED: ' + line + (learned ? ' -- learned ' + learned + ' new shape(s) from this board' : ''));
  record({ solved: true, read: 'grid.json', learned, fills: fills.length, s: T, total });
} else if (cmd === 'state') {
  // What does it take this saved screen for? (a game, ticks, the win screen, or something else)
  if (!arg) { console.error('usage: node sudoku.js <work-dir> state <shot.png>'); process.exit(2); }
  const st = screenState(eyes.decode(fs.readFileSync(arg)));
  console.log(st.kind + (st.kind === 'won' ? ' (page shifted ' + st.dy + ' px)' : st.geom ? ' (board ' + JSON.stringify(st.g.bbox) + ', pad shifted ' + Math.round(st.geom.dx) + ',' + Math.round(st.geom.dy) + ')' : ' -- ' + st.why));
} else if (cmd === 'read') {
  // What would it read off this picture, how sure is it, and how long does it take?
  if (!arg) { console.error('usage: node sudoku.js <work-dir> read <shot.png>'); process.exit(2); }
  const img = eyes.decode(fs.readFileSync(arg)), g = gridIn(img);
  if (!confident(g)) { console.error('[x] no board found for sure: ' + (g.why || 'square ' + g.square + ', box lines ' + g.boxsep)); process.exit(3); }
  const bank = loadShapes(), r = readBoard(img, g, bank);
  console.log(gridRows(r.grid));
  console.log('board ' + JSON.stringify(g.bbox) + ', pitch ' + g.step[0] + ' . ' + r.rd.filled + ' givens read in ' + r.readMs + ' ms against ' + reader.bankSize(bank) + ' learned shapes' +
              ' . closest call ' + r.rd.minMargin.toFixed(3) + ' . doubtful ' + r.rd.doubts.length + ' . unknown ' + r.rd.unknown.length);
  console.log(r.ok ? 'OK: exactly one solution' + (r.settled ? ' (' + r.settled + ' doubtful cell(s) settled by the solver)' : '') : 'NOT SURE: ' + r.why);
  process.exit(r.ok ? 0 : 10);
} else if (cmd === 'learn') {
  // Teach the shapes from a board KNOWN to be right: the grid must have exactly one solution, and the picture
  // must agree with it about which cells hold a digit -- or this is not the grid for this picture.
  if (!arg || !arg2) { console.error('usage: node sudoku.js <work-dir> learn <shot.png> <grid.json> [--to <bank.json>]'); process.exit(2); }
  const img = eyes.decode(fs.readFileSync(arg)), g = gridIn(img);
  if (!confident(g)) { console.error('[x] no board found for sure in ' + arg); process.exit(3); }
  let grid;
  try { grid = loadGrid(arg2); } catch (e) { console.error('[x] ' + e.message); process.exit(2); }
  if (sudoku.solve(grid, 2).count !== 1) { console.error('[x] ' + arg2 + ' does not have exactly one solution -- not a board known to be right'); process.exit(2); }
  const shapes = [], off = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const s = reader.cellShape(img, g, r, c);
    if (!!s !== !!grid[r][c]) off.push((r + 1) + ',' + (c + 1));
    if (s && grid[r][c]) shapes.push([s, String(grid[r][c])]);
  }
  if (off.length) { console.error('[x] the picture and ' + arg2 + ' disagree about which cells hold a digit (row,col ' + off.join(' ') + ')'); process.exit(2); }
  // into --to (new against that file alone: how the shipped seed is built), else into this machine's own
  // file (new against everything known, the seed included)
  const target = TO || LOCAL, mine = reader.loadBank([target]).bank, against = TO ? mine : loadShapes(), per = {};
  for (const [s, dg] of shapes) {
    if ((mine.glyphs[dg] || []).length >= 16 || !reader.learn(against, s, dg, { cap: Infinity })) continue;
    if (against !== mine) (mine.glyphs[dg] = mine.glyphs[dg] || []).push(s.v);
    per[dg] = (per[dg] || 0) + 1;
  }
  const n = Object.values(per).reduce((a, b) => a + b, 0);
  if (n) reader.saveBank(target, mine, TO ? 'sudoku.com digit shapes, learned from boards solved live and confirmed by the game' : 'learned on this machine from boards the game confirmed; not shared (*.local.*)');
  console.log('learned ' + n + ' new shape(s) into ' + target + (n ? ' (' + Object.keys(per).sort().map((k) => k + ':' + per[k]).join(' ') + ')' : '') + '; it holds ' + reader.bankSize(reader.loadBank([target]).bank));
} else { console.error('unknown command "' + cmd + '" (play | newgame | solve | read | learn | state)'); process.exit(2); }

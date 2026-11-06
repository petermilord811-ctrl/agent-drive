// look.js — vision/look.js: the picture a model is shown (cropped, shrunk to a long edge)
// and the way its answer (lx/ly, in the picture's pixels) gets back to the screen. Offline, no dependencies.
//   node tests/look.js
'use strict';
const path = require('path');
const AD = path.join(__dirname, '..');
const look = require(path.join(AD, 'vision', 'look.js'));
const eyes = require(path.join(AD, 'core', 'agent-eyes.js'));
const { encodePng } = require(path.join(AD, 'vision', 'glyph-reader.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// ---- geometry
let r = look.fit(2560, 1440, null, 1280);
ok(r.k === 2 && r.ow === 1280 && r.oh === 720 && r.x === 0 && r.y === 0, '2560x1440 -> 1280x720 at scale 2');
r = look.fit(1280, 720, null, 1280);
ok(r.k === 1 && r.ow === 1280, 'a screen already small enough is shown as-is');
r = look.fit(2560, 1440, { x: 100, y: 200, w: 400, h: 300 }, 1280);
ok(r.k === 1 && r.ow === 400 && r.x === 100 && r.y === 200, 'a small region is never enlarged');
r = look.fit(2560, 1440, { x: 2400, y: 1400, w: 999, h: 999 }, 1280);
ok(r.w === 160 && r.h === 40, 'a region is clamped to the screen');
r = look.fit(3840, 2160, null, 99999);
ok(r.ow === 3840, 'max is capped at 4096');
r = look.fit(3840, 2160, null, 1);
ok(r.ow === 16, 'max has a floor of 16');

// ---- the way back
r = look.fit(2560, 1440, null, 1280);
let p = look.toScreen(r, 640, 360);
ok(p.ok && p.x === 1280 && p.y === 720, 'the centre of the look is the centre of the screen');
r = look.fit(2560, 1440, { x: 1000, y: 500, w: 1000, h: 500 }, 500);
p = look.toScreen(r, 250, 125);
ok(p.ok && p.x === 1500 && p.y === 750, 'a region look maps back with its offset and scale');
ok(!look.toScreen(null, 1, 1).ok, 'no look yet -> refused, not guessed');
ok(!look.toScreen(r, 501, 10).ok && !look.toScreen(r, -1, 10).ok, 'a point off the picture is refused');
ok(!look.toScreen(r, 'a', 10).ok, 'a point that is not a number is refused');
p = look.toScreen(r, 500, 250);
ok(p.ok && p.x <= 1999 && p.y <= 999, 'the far edge stays inside the region');

// ---- pixels: a 40x20 picture, left half red, right half blue, one white 2x2 dot at (30,4)
const W = 40, H = 20, rgb = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = (y * W + x) * 3;
  if (x >= 30 && x < 32 && y >= 4 && y < 6) { rgb[o] = rgb[o + 1] = rgb[o + 2] = 255; }
  else if (x < 20) rgb[o] = 255; else rgb[o + 2] = 255;
}
const img = eyes.decode(encodePng(W, H, rgb));
r = look.fit(W, H, null, 20);
const out = eyes.decode(look.render(img, r));
ok(out.ready && out.w === 20 && out.h === 10, 'rendered at the fitted size');
ok(eyes.probe(out, 2, 5) === '#ff0000' && eyes.probe(out, 17, 5) === '#0000ff', 'halves keep their colour');
ok(eyes.probe(out, 15, 2) === '#ffffff', 'a 2x2 dot survives a 2x shrink (area average, not skipped)');
r = look.fit(W, H, { x: 20, y: 0, w: 20, h: 20 }, 1280);
const half = eyes.decode(look.render(img, r));
ok(half.w === 20 && eyes.probe(half, 0, 0) === '#0000ff' && eyes.probe(half, 10, 4) === '#ffffff', 'a region crop shows only the region');
r = look.fit(W, H, null, 16);                        // 40 -> 16: a non-integer scale (2.5)
const odd = eyes.decode(look.render(img, r));
ok(odd.w === 16 && odd.h === 8 && eyes.probe(odd, 1, 1) === '#ff0000', 'a non-integer shrink renders');

console.log((fail ? 'FAIL' : 'ok') + ' look: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

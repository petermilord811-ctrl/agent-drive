// targets.js -- vision/targets.js on drawn screens: the boxes and phrases a click can aim at, their numbers on the
// picture, and whether a spot still shows what it showed (and where it went when the page moved). Offline, no
// dependencies: the screens are drawn here, and the words a text reader would give are handed in with them.
//   node tests/targets.js
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'vision', 'targets.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// ---- a canvas, and what a sign-in page is made of -------------------------------------------------------------
function canvas(w, h, bg) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2]; }
  const pic = { w, h, px, stride: w * 3, bpp: 3, rows: h };
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) { const o = (y * w + x) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; } };
  const words = [];
  const api = {
    pic, words,
    rect(x, y, rw, rh, c) { for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) put(xx, yy, c); return api; },
    frame(x, y, rw, rh, c) { for (let xx = x; xx < x + rw; xx++) { put(xx, y, c); put(xx, y + rh - 1, c); } for (let yy = y; yy < y + rh; yy++) { put(x, yy, c); put(x + rw - 1, yy, c); } return api; },
    // a rounded rectangle (r = h/2 is a pill), filled
    round(x, y, rw, rh, r, c) {
      for (let yy = 0; yy < rh; yy++) for (let xx = 0; xx < rw; xx++) {
        const cx = xx < r ? r : xx >= rw - r ? rw - r - 1 : xx, cy = yy < r ? r : yy >= rh - r ? rh - r - 1 : yy;
        if ((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= r * r) put(x + xx, y + yy, c);
      }
      return api;
    },
    disc(cx, cy, r, c) { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) put(cx + xx, cy + yy, c); return api; },
    // words: each letter a 7x10 bar, a space between words; and the box a reader would give for each word
    text(x, y, s, c, line) {
      let cx = x;
      const ws = [];
      for (const word of s.split(' ')) {
        const w0 = cx;
        for (let i = 0; i < word.length; i++) { api.rect(cx + 1, y, 5, 10, c); cx += 7; }
        ws.push([word, w0, y, cx - w0, 10]);
        cx += 5;
      }
      if (line) line.push(...ws); else words.push(ws);
      return api;
    },
    noise(x, y, rw, rh, seed) {
      let s = seed || 7;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % 256; };
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) put(xx, yy, [rnd(), rnd(), rnd()]);
      return api;
    },
  };
  return api;
}
// the page: tabs along the top, a card with a form, and a photo beside it
function signIn(dy) {
  dy = dy || 0;
  const c = canvas(1280, 720, [243, 244, 246]);
  const tabs = [];
  c.text(40, 20, 'Home', [30, 30, 30], tabs); c.text(110, 20, 'Reports', [30, 30, 30], tabs); c.text(200, 20, 'Settings', [30, 30, 30], tabs);
  c.words.push(tabs);
  c.rect(100, 80 + dy, 600, 520, [255, 255, 255]).frame(100, 80 + dy, 600, 520, [209, 213, 219]);
  c.text(130, 122 + dy, 'Email', [55, 65, 81]);
  c.frame(130, 140 + dy, 400, 36, [156, 163, 175]);
  c.text(130, 192 + dy, 'Password', [55, 65, 81]);
  c.frame(130, 210 + dy, 400, 36, [156, 163, 175]);
  c.frame(130, 272 + dy, 16, 16, [107, 114, 128]);
  c.text(156, 275 + dy, 'Remember me', [55, 65, 81]);
  c.disc(138, 318 + dy, 8, [107, 114, 128]).disc(138, 318 + dy, 6, [255, 255, 255]);
  c.text(156, 313 + dy, 'Daily', [55, 65, 81]);
  c.disc(138, 348 + dy, 8, [107, 114, 128]).disc(138, 348 + dy, 6, [255, 255, 255]);
  c.text(156, 343 + dy, 'Weekly', [55, 65, 81]);
  c.round(130, 390 + dy, 120, 40, 6, [37, 99, 235]).text(160, 405 + dy, 'Sign in', [255, 255, 255]);
  c.round(270, 392 + dy, 140, 36, 18, [229, 231, 235]).text(312, 405 + dy, 'Cancel', [31, 41, 55]);
  c.text(130, 460 + dy, 'Forgot password?', [37, 99, 235]);
  c.noise(800, 100, 300, 200, 11);
  return c;
}
const byLabel = (ms, label) => ms.find((m) => m.label === label);
const inBox = (m, x, y, w, h) => !!m && Math.abs(m.x - x) <= 2 && Math.abs(m.y - y) <= 2 && Math.abs(m.w - w) <= 3 && Math.abs(m.h - h) <= 3;

// ---- boxes --------------------------------------------------------------------------------------------------
{
  const c = signIn();
  const t0 = Date.now();
  const B = T.boxes(c.pic, { k: 1 });
  const ms = Date.now() - t0;
  const has = (x, y, w, h) => B.some((b) => inBox(b, x, y, w, h));
  ok(has(131, 141, 398, 34), 'a field\'s inside is a box (its border is a thin ring, not one)');
  ok(has(131, 211, 398, 34), '...the second field too');
  ok(has(131, 273, 14, 14), 'the inside of a box to tick is a box');
  ok(B.some((b) => b.round && Math.abs(b.x + b.w / 2 - 138.5) <= 2 && Math.abs(b.y + b.h / 2 - 318.5) <= 2), 'a radio button\'s inside is a round box');
  ok(has(130, 390, 120, 40), 'a filled button with rounded corners is a box, its words and all');
  ok(has(270, 392, 140, 36), 'a pill-shaped button is a box');
  ok(!B.some((b) => b.w >= 590), 'the card holding them all is not a target: it is where the targets are');
  ok(!B.some((b) => b.x >= 800 && b.y >= 100 && b.x < 1100 && b.y < 300), 'a photo\'s noise is no box (' + B.filter((b) => b.x >= 800 && b.x < 1100 && b.y >= 100 && b.y < 300).length + ')');
  ok(ms < 1500, 'a 1280x720 picture is searched in ' + ms + ' ms');
}

// ---- phrases ------------------------------------------------------------------------------------------------
{
  const P = T.phrases([[['Remember', 156, 275, 56, 10], ['me', 217, 275, 14, 10]], [['Sign', 160, 405, 28, 10], ['in', 193, 405, 14, 10]]]);
  ok(P.length === 2 && P[0].text === 'Remember me' && P[1].text === 'Sign in', 'words a space apart are one phrase (' + P.map((p) => p.text).join(' | ') + ')');
  const Q = T.phrases([[['Home', 40, 20, 28, 10], ['Reports', 110, 20, 49, 10]]]);
  ok(Q.length === 2, 'words a column apart are two (two tabs)');
  const long = T.phrases([['one two three four five six seven eight'.split(' ').map((w, i) => [w, i * 40, 0, 35, 10])][0]]);
  ok(long.length === 0, 'a run of more than six words is running text, not a target');
}

// ---- the targets, named and numbered ------------------------------------------------------------------------
{
  const c = signIn();
  const t0 = Date.now();
  const M = T.find(c.pic, c.words, { k: 1 });
  const ms = Date.now() - t0;
  const email = M.find((m) => m.kind === 'field' && m.label === 'Email'), pass_ = M.find((m) => m.kind === 'field' && m.label === 'Password');
  ok(!!email && inBox(email, 131, 141, 398, 34), 'the Email field is a field, named by the label above it (' + JSON.stringify(email) + ')');
  ok(!!pass_ && pass_.y > email.y, '...and Password, below it');
  const rem = M.find((m) => m.kind === 'check');
  ok(!!rem && rem.label === 'Remember me', 'the box to tick is a check, named by the words to its right (' + JSON.stringify(rem) + ')');
  const radios = M.filter((m) => m.kind === 'round');
  ok(radios.length === 2 && radios[0].label === 'Daily' && radios[1].label === 'Weekly', 'two radio buttons, each named (' + radios.map((r) => r.label).join(', ') + ')');
  const sign = M.find((m) => m.kind === 'button' && m.label === 'Sign in'), cancel = M.find((m) => m.kind === 'button' && m.label === 'Cancel');
  ok(!!sign && inBox(sign, 130, 390, 120, 40), 'Sign in is a button: the box, named by its own words (' + JSON.stringify(sign) + ')');
  ok(!!cancel, '...and the pill-shaped Cancel');
  ok(!M.some((m) => m.kind === 'text' && (m.label === 'Sign in' || m.label === 'Cancel')), 'a button\'s words are not a target of their own as well');
  const forgot = byLabel(M, 'Forgot password?');
  ok(!!forgot && forgot.kind === 'text', 'a link with no box is a target of its words');
  ok(M[0].label === 'Home' && M[1].label === 'Reports' && M[2].label === 'Settings', 'numbered in reading order: the tabs first, left to right (' + M.slice(0, 3).map((m) => m.label).join(', ') + ')');
  ok(M.every((m, i) => m.n === i + 1), 'numbered from 1 without a gap');
  ok(M.every((m) => m.cx === Math.round(m.x + m.w / 2) && m.cy === Math.round(m.y + m.h / 2)), 'each says its centre: where a click on it goes');
  ok(ms < 2000, 'found in ' + ms + ' ms');
  // the same page as a look of a screen twice its size: half the pixels, the same targets
  const half = { w: 640, h: 360, px: Buffer.alloc(640 * 360 * 3), stride: 640 * 3, bpp: 3, rows: 360 };
  for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) for (let ch = 0; ch < 3; ch++) {
    let s = 0; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += c.pic.px[((2 * y + dy) * 1280 + 2 * x + dx) * 3 + ch];
    half.px[(y * 640 + x) * 3 + ch] = Math.round(s / 4);
  }
  const words2 = c.words.map((l) => l.map((w) => [w[0], w[1] / 2, w[2] / 2, w[3] / 2, w[4] / 2]));
  const M2 = T.find(half, words2, { k: 2 });
  ok(M2.some((m) => m.kind === 'check' && m.label === 'Remember me') && M2.some((m) => m.kind === 'button' && m.label === 'Sign in') && M2.some((m) => m.kind === 'field' && m.label === 'Email'),
     'a look at half size (scale 2) finds the same: the 8 px box to tick, the button, the field (' + M2.map((m) => m.kind + ':' + m.label).join(', ').slice(0, 160) + ')');
}

// ---- the numbers on the picture -----------------------------------------------------------------------------
{
  const c = signIn();
  const M = T.find(c.pic, c.words, { k: 1 });
  const D = T.draw(c.pic, M);
  ok(D.w === 1280 && D.h === 720 && D.px.length === 1280 * 720 * 3, 'the marked picture is the same size');
  ok(c.pic.px.equals(signIn().pic.px), '...and a copy: the picture handed in is untouched');
  const sign = M.find((m) => m.label === 'Sign in');
  const tag = sign.tag, o = ((tag[1] + 1) * 1280 + tag[0] + 1) * 3;
  ok(tag[1] + tag[3] <= sign.y && D.px[o] + D.px[o + 1] + D.px[o + 2] !== 255 * 3, 'a tag sits above its target where there is room, so the target\'s words stay readable');
  let white = 0;
  for (let y = tag[1]; y < tag[1] + tag[3]; y++) for (let x = tag[0]; x < tag[0] + tag[2]; x++) { const i = (y * 1280 + x) * 3; if (D.px[i] === 255 && D.px[i + 1] === 255 && D.px[i + 2] === 255) white++; }
  ok(white >= 20, 'the number is drawn in white on the tag (' + white + ' px)');
  const tags = M.map((m) => m.tag);
  const clash = tags.some((a, i) => tags.some((b, j) => j > i && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]));
  ok(!clash, 'no two tags overlap');
}

// ---- still there? ---------------------------------------------------------------------------------------------
{
  const a = signIn().pic, b = signIn().pic;
  const spot = { x: 126, y: 386, w: 128, h: 48 };   // the Sign in button and a little round it
  ok(T.same(a, spot, b, spot).same, 'an unchanged spot is the same');
  // hovered: the button a shade lighter
  const hov = signIn(); hov.round(130, 390, 120, 40, 6, [59, 130, 246]).text(160, 405, 'Sign in', [255, 255, 255]);
  const h = T.same(a, spot, hov.pic, spot);
  ok(h.same, 'a hover tint is still the same button (' + h.score + ')');
  const other = signIn(); other.round(130, 390, 120, 40, 6, [37, 99, 235]).text(150, 405, 'Delete all', [255, 255, 255]);
  const d = T.same(a, spot, other.pic, spot);
  ok(!d.same, 'different words in the same place are not the same (' + d.score + ')');
  const flat = { x: 300, y: 150, w: 40, h: 16 };     // inside the empty Email field
  ok(T.same(a, flat, b, flat).same, 'a flat spot of the same colour is the same');
  const tinted = signIn(); tinted.rect(131, 141, 398, 34, [200, 220, 255]);
  ok(!T.same(a, flat, tinted.pic, flat).same, '...and of another colour is not');
  // the page scrolled: the card is 120 px lower
  const moved = signIn(120).pic;
  ok(!T.same(a, spot, moved, spot).same, 'after the page moved, the spot no longer shows the button');
  const t0 = Date.now();
  const tr = T.track(a, spot, moved, { x: 0, y: 0, w: 1280, h: 720 });
  const ms = Date.now() - t0;
  ok(tr.found && tr.moved[0] === 0 && tr.moved[1] === 120, 'track finds where it went: 120 px down (' + JSON.stringify(tr) + ')');
  ok(ms < 2500, '...searching the whole screen in ' + ms + ' ms');
  const nearSearch = T.track(a, spot, moved, { x: spot.x - 100, y: spot.y - 250, w: spot.w + 200, h: spot.h + 500 });
  ok(nearSearch.found && nearSearch.moved[1] === 120, '...and a search round the spot finds it too');
  // a row of identical buttons: which one it was cannot be told by looks
  const row = canvas(800, 200, [255, 255, 255]);
  for (let i = 0; i < 4; i++) row.round(40 + i * 180, 80, 120, 40, 6, [37, 99, 235]).text(70 + i * 180, 95, 'Add', [255, 255, 255]);
  const row2 = canvas(800, 200, [255, 255, 255]);
  for (let i = 0; i < 4; i++) row2.round(40 + i * 180, 100, 120, 40, 6, [37, 99, 235]).text(70 + i * 180, 115, 'Add', [255, 255, 255]);
  const amb = T.track(row.pic, { x: 216, y: 76, w: 128, h: 48 }, row2.pic, { x: 0, y: 0, w: 800, h: 200 });
  ok(!amb.found && /more than one place/.test(amb.why || ''), 'a spot that matches in more than one place is not followed: it would be a guess (' + amb.why + ')');
  const gone = canvas(1280, 720, [243, 244, 246]).pic;
  const g = T.track(a, spot, gone, { x: 0, y: 0, w: 1280, h: 720 });
  ok(!g.found, 'a spot that is gone is not found');
  const fl = T.track(a, flat, b, { x: 0, y: 0, w: 1280, h: 720 });
  ok(!fl.found && fl.flat, 'a flat spot cannot be followed (nothing to follow it by)');
}

// ---- what a click hits -------------------------------------------------------------------------------------
{
  const c = signIn();
  const M = T.find(c.pic, c.words, { k: 1 });
  const chk = M.find((m) => m.kind === 'check');
  let h = T.at(M, chk.cx, chk.cy);
  ok(h.hit === chk, 'a click on the box to tick hits it');
  h = T.at(M, chk.x + chk.w + 3, chk.cy);
  ok(!h.hit && h.nearest && (h.nearest === chk || h.nearest.label === 'Remember me') && h.dist <= 4, 'a click just past it hits nothing, and says what is nearest');
  h = T.at(M, 1200, 700);
  ok(!h.hit, 'a click on the empty page hits nothing');
}

console.log((fail ? 'FAIL' : 'ok') + ' targets: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

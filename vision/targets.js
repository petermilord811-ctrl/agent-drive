'use strict';
// @tool what can be clicked on a picture -- boxes (buttons, fields, boxes to tick) and short phrases -- numbered as marks; and whether a spot still shows what it showed
// @run  const T = require('./targets.js'); T.find(pic, words, {k}); T.draw(pic, marks); T.same(a, ra, b, rb); T.track(a, ra, b, area)
// =================================================================================================
// targets -- WHAT CAN BE CLICKED ON A PICTURE, AND WHETHER IT IS STILL WHERE IT WAS.
//
// A model reading a screenshot and answering "the box is at 412,96" is estimating. On a small target an estimate
// is a miss: a 16 px box to tick, and a guess 10 px off. What is here takes the estimate out of it:
//
//   find    the targets on a picture. BOXES are regions of one colour shaped like a control: a button's fill, a
//           field's inside, a box to tick. They are found by joining neighbouring pixels of the same colour.
//           PHRASES are the short runs of words a text reader gave: a link, a tab, a label. A phrase inside a box
//           names it; a box with no words takes the label beside it. Numbered top to bottom, left to right.
//   draw    those numbers on the picture, so a model can say "mark 7" instead of a coordinate.
//   same    whether a spot on the screen still shows what an earlier picture of it showed.
//   track   and, when the page moved (a scroll, a banner that pushed it down), where that spot went. A click aimed
//           from an old picture lands on whatever moved in; this is how the serve tells, and follows, first.
//
// Pictures are the decoded kind: {w, h, px, stride, bpp}, from core/agent-eyes.js decode or vision/look.js
// renderRaw. Sizes for what a control looks like are a SCREEN's, so `k` (screen pixels per picture pixel) says
// how big the picture's pixels are. Pure: no I/O. tests/targets.js checks each part on drawn pictures.
// =================================================================================================

const lumaAt = (px, i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
function clip(pic, r) {
  const W = pic.w, H = pic.rows != null ? Math.min(pic.h, pic.rows) : pic.h;
  if (!r) return { x: 0, y: 0, w: W, h: H };
  const x = Math.max(0, Math.min(W, Math.round(r.x || 0))), y = Math.max(0, Math.min(H, Math.round(r.y || 0)));
  return { x, y, w: Math.max(0, Math.min(W - x, Math.round(r.w == null ? W : r.w))), h: Math.max(0, Math.min(H - y, Math.round(r.h == null ? H : r.h))) };
}
const inside = (b, x, y) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const area = (b) => b.w * b.h;
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
// the distance from a point to a box: 0 inside it
function dist(b, x, y) {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.w - 1)), dy = Math.max(b.y - y, 0, y - (b.y + b.h - 1));
  return Math.hypot(dx, dy);
}

// ---- BOXES: regions of one colour, shaped like a control ---------------------------------------------------
// FLAT pixels only -- those whose four neighbours are all within `edge` of them -- and neighbouring flat pixels are
// one region (a union-find over the picture). An edge's own pixels belong to no region: the soft, anti-aliased
// rim of a rounded button or a light field steps from its colour to the page's a few levels at a time, and joining
// across those steps ran the button into the page (a pale pill button vanished into its card that way). A gentle
// gradient is still flat, so a shaded button stays one region. A region is a BOX when:
//   - it does not touch the edge of what was searched (a box cut by the edge is not all there);
//   - it is a control's size: 8 to 1400 by 8 to 400 screen pixels;
//   - it fills most of its bounding rectangle (a button's words are holes in it: 60-95% is usual);
//   - and it runs along that rectangle's sides (a rounded rectangle or a pill does, a blob of a photo does not),
//     or it is a small round one: a radio button, a switch's knob, a round icon -- told from a small square by its
//     sides, which a disc touches only in the middle.
// A field's border, a box's frame, is a thin ring: an edge, so no region at all. The INSIDE is the box.
function boxes(pic, opt) {
  opt = opt || {};
  const k = Number(opt.k) > 0 ? Number(opt.k) : 1, edge = Number(opt.edge) > 0 ? Number(opt.edge) : 8;
  const R = clip(pic, opt.rect), W = R.w, H = R.h, N = W * H;
  if (W < 3 || H < 3) return [];
  const { px, stride, bpp } = pic;
  // which pixels step sharply to the one on their right, and to the one below
  const er = new Uint8Array(N), ed = new Uint8Array(N);
  const step = (i, j) => Math.max(Math.abs(px[i] - px[j]), Math.abs(px[i + 1] - px[j + 1]), Math.abs(px[i + 2] - px[j + 2]));
  for (let y = 0; y < H; y++) {
    const row = (R.y + y) * stride + R.x * bpp;
    for (let x = 0; x < W; x++) {
      const i = row + x * bpp, n = y * W + x;
      if (x < W - 1 && step(i, i + bpp) > edge) er[n] = 1;
      if (y < H - 1 && step(i, i + stride) > edge) ed[n] = 1;
    }
  }
  const flat = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = y * W + x;
    flat[n] = !(er[n] || ed[n] || (x > 0 && er[n - 1]) || (y > 0 && ed[n - W])) ? 1 : 0;
  }
  const par = new Int32Array(N);
  for (let i = 0; i < N; i++) par[i] = i;
  const root = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const join = (a, b) => { a = root(a); b = root(b); if (a !== b) { if (a < b) par[b] = a; else par[a] = b; } };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = y * W + x;
    if (!flat[n]) continue;
    if (x > 0 && flat[n - 1]) join(n, n - 1);
    if (y > 0 && flat[n - W]) join(n, n - W);
  }
  // each region's size, rectangle and colour, kept at its root (the region's first pixel in reading order)
  const cnt = new Int32Array(N), x0 = new Int32Array(N), y0 = new Int32Array(N), x1 = new Int32Array(N), y1 = new Int32Array(N);
  const sr = new Float64Array(N), sg = new Float64Array(N), sb = new Float64Array(N);
  const lab = new Int32Array(N).fill(-1);
  for (let y = 0; y < H; y++) {
    const row = (R.y + y) * stride + R.x * bpp;
    for (let x = 0; x < W; x++) {
      const n = y * W + x;
      if (!flat[n]) continue;
      const r = root(n);
      lab[n] = r;
      if (cnt[r] === 0) { x0[r] = x; x1[r] = x; y0[r] = y; y1[r] = y; }
      cnt[r]++;
      if (x < x0[r]) x0[r] = x; if (x > x1[r]) x1[r] = x; if (y > y1[r]) y1[r] = y;
      const i = row + x * bpp; sr[r] += px[i]; sg[r] += px[i + 1]; sb[r] += px[i + 2];
    }
  }
  const minS = 8 / k, maxW = 1400 / k, maxH = 400 / k;
  const cand = new Uint8Array(N), list = [];
  for (let n = 0; n < N; n++) {
    if (lab[n] !== n) continue;   // a root's own pixel carries its own label
    const bw = x1[n] - x0[n] + 1, bh = y1[n] - y0[n] + 1;
    if (bw < minS || bh < minS || bw > maxW || bh > maxH) continue;
    if (x0[n] <= 1 || y0[n] <= 1 || x1[n] >= W - 2 || y1[n] >= H - 2) continue;
    if (cnt[n] < 0.5 * bw * bh || cnt[n] > 0.3 * N) continue;
    cand[n] = 1; list.push(n);
  }
  if (!list.length) return [];
  // how much of each side of its rectangle a candidate runs along
  const top = new Int32Array(N), bot = new Int32Array(N), lef = new Int32Array(N), rig = new Int32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = lab[y * W + x];
    if (r < 0 || !cand[r]) continue;
    if (y === y0[r]) top[r]++; if (y === y1[r]) bot[r]++; if (x === x0[r]) lef[r]++; if (x === x1[r]) rig[r]++;
  }
  const out = [];
  for (const n of list) {
    const bw = x1[n] - x0[n] + 1, bh = y1[n] - y0[n] + 1, fill = cnt[n] / (bw * bh);
    const tb = (top[n] + bot[n]) / (2 * bw), lr = (lef[n] + rig[n]) / (2 * bh);
    const small = Math.max(bw, bh) * k <= 48, squareish = Math.abs(bw - bh) <= Math.max(2, 0.2 * Math.max(bw, bh));
    // round: its top and bottom rows, and its sides, cover only part of their length (a square's cover all of it)
    const round = small && squareish && fill >= 0.55 && tb < 0.75 && lr < 0.75;
    if (!((fill >= 0.55 && (tb >= 0.6 || lr >= 0.6)) || round)) continue;
    const c = cnt[n];
    // ...given back the one-pixel rim that, being an edge, was no part of the region: the box is the control's extent
    out.push({ x: R.x + x0[n] - 1, y: R.y + y0[n] - 1, w: bw + 2, h: bh + 2, fill: +fill.toFixed(3), round,
               rgb: [Math.round(sr[n] / c), Math.round(sg[n] / c), Math.round(sb[n] / c)] });
  }
  // A CONTAINER IS NOT A TARGET: a panel holding two or more boxes is where the targets are, not one of them
  return out.filter((b) => out.filter((o) => o !== b && area(o) < area(b) && overlap(o, b) >= 0.9 * area(o)).length < 2);
}

// ---- PHRASES: the short runs of words a reader gave ----------------------------------------------------------
// `words` are [text, x, y, w, h] in the picture's pixels, grouped as the reader's lines: [[word, ...], ...] (or a
// flat list, one line). Words on a line join while the gap between them is under about one letter height -- the
// gap a space leaves, not the gap between two columns or two buttons. A phrase of more than six words, or fifty
// characters, is running text, not something to click; it is left out (clickText still finds a word in it).
function phrases(lines, opt) {
  opt = opt || {};
  const maxWords = opt.maxWords || 6, maxChars = opt.maxChars || 50;
  const groups = Array.isArray(lines) && lines.length && Array.isArray(lines[0]) && Array.isArray(lines[0][0]) ? lines : [lines || []];
  const out = [];
  for (const line of groups) {
    const ws = (line || []).filter((w) => Array.isArray(w) && String(w[0] || '').trim() && w[3] > 0 && w[4] > 0)
      .map((w) => ({ t: String(w[0]), x: +w[1], y: +w[2], w: +w[3], h: +w[4] })).sort((a, b) => a.x - b.x);
    let cur = null;
    const close = () => {
      if (cur && cur.n <= maxWords && cur.t.length <= maxChars) out.push({ text: cur.t, x: cur.x, y: cur.y, w: cur.r - cur.x, h: cur.b - cur.y, words: cur.n });
      cur = null;
    };
    for (const w of ws) {
      const hh = cur ? Math.max(cur.b - cur.y, w.h) : w.h;
      if (cur && w.x - cur.r <= 0.9 * hh && Math.abs((w.y + w.h / 2) - (cur.y + cur.b) / 2) <= 0.6 * hh) {
        cur.t += ' ' + w.t; cur.r = Math.max(cur.r, w.x + w.w); cur.y = Math.min(cur.y, w.y); cur.b = Math.max(cur.b, w.y + w.h); cur.n++;
      } else { close(); cur = { t: w.t, x: w.x, y: w.y, r: w.x + w.w, b: w.y + w.h, n: 1 }; }
    }
    close();
  }
  return out;
}

// ---- THE TARGETS: boxes named by their words, words on their own, numbered -----------------------------------
// kind: 'button' (a box with words in it), 'field' (a wide box: empty, or its words start at its left like a
// value or a hint), 'check' (a small square), 'round' (a small round one: a radio button, a switch's knob, a round
// icon), 'text' (words with no box: a link, a tab, a label), 'box' (anything else box-shaped and control-sized).
// A button is named by its own words. A box to tick is named by the words beside it -- to its right, where its
// label goes. A field is named by its label, to its left or just above, and the words inside it (a hint, or what
// was typed) are its `value`. Words that name a control are not a target of their own as well.
function find(pic, words, opt) {
  opt = opt || {};
  const k = Number(opt.k) > 0 ? Number(opt.k) : 1, max = opt.max || 60;
  let B = boxes(pic, { k, rect: opt.rect, edge: opt.edge });
  const lines = Array.isArray(words) && words.length && Array.isArray(words[0]) && Array.isArray(words[0][0]) ? words : [words || []];
  const wbox = (w) => ({ x: +w[1], y: +w[2], w: +w[3], h: +w[4] });
  // A READER READS A CONTROL'S OUTLINE AS A LETTER OR TWO -- a box to tick comes back as "C)", "O" or "[]". Such a
  // "word" lies on a small box: it is the box, not its label (left in, it took the label's place, and the box was
  // left with no name, or with its neighbour's).
  const tiny = B.filter((b) => Math.max(b.w, b.h) * k <= 32);
  const clean = lines.map((l) => (l || []).filter((w) => !(Array.isArray(w) && String(w[0] || '').trim().length <= 2 &&
    tiny.some((b) => overlap(wbox(w), b) >= 0.3 * Math.max(1, area(wbox(w)))))));
  // ...AND A LETTER'S INSIDES ARE NOT A BOX: the hole in an "o" or an "e" is a small flat region much like a box to
  // tick, at a look's half scale especially. A box inside a word is part of the word.
  const allWords = [].concat(...clean.map((l) => l.filter(Array.isArray).map(wbox)));
  B = B.filter((b) => !allWords.some((w) => area(b) < area(w) && overlap(b, w) >= 0.6 * area(b)));
  const P = phrases(clean).filter((p) => !opt.rect || overlap(p, clip(pic, opt.rect)) > 0);
  const owner = new Map();   // phrase -> the smallest box it sits in
  for (const p of P) {
    const [cx, cy] = centre(p);
    let best = null;
    for (const b of B) if (inside(b, cx, cy) && overlap(p, b) >= 0.6 * area(p) && (!best || area(b) < area(best))) best = b;
    if (best) owner.set(p, best);
  }
  const out = [];
  const usedP = new Set();
  for (const b of B) {
    const mine = P.filter((p) => owner.get(p) === b);
    if (mine.length > 3) continue;                              // a box of many words is a panel: its words are the targets
    for (const p of mine) usedP.add(p);
    const sw = b.w * k, sh = b.h * k;
    const text = mine.sort((a, c) => (a.y - c.y) || (a.x - c.x)).map((p) => p.text).join(' ');
    let kind;
    if (b.round && sw <= 48) kind = 'round';
    else if (!text && Math.abs(sw - sh) <= Math.max(3, 0.25 * Math.max(sw, sh)) && Math.max(sw, sh) <= 32) kind = 'check';
    else if (sh >= 16 && sh <= 72 && sw >= 3 * sh && (!text || mine[0].x - b.x <= Math.max(10 / k, 0.12 * b.w))) kind = 'field';
    else if (text) kind = 'button';
    else if (sw > 400 || sh > 160) continue;                   // a big box with no words: a picture, a panel -- not a control
    else kind = 'box';
    const field = kind === 'field';
    out.push({ kind, label: field ? '' : text, value: field ? text : '', x: b.x, y: b.y, w: b.w, h: b.h, own: !field && !!text });
  }
  for (const p of P) if (!usedP.has(p)) out.push({ kind: 'text', label: p.text, x: p.x, y: p.y, w: p.w, h: p.h, own: true });
  // a box with no words of its own is named by the words beside it
  const texts = out.filter((t) => t.kind === 'text');
  for (const t of out) {
    if (t.own) continue;
    const [cx, cy] = centre(t);
    let best = null, bd = Infinity;
    for (const p of texts) {
      const [px, py] = centre(p);
      const sameRow = Math.abs(py - cy) <= Math.max(t.h, p.h) * 0.75;
      let d = Infinity;
      if (t.kind === 'box') continue;                            // a box of no known kind takes no one's name
      if (t.kind === 'check' || t.kind === 'round') { if (sameRow && p.x >= t.x + t.w - 2) d = p.x - (t.x + t.w); else if (sameRow && p.x + p.w <= t.x + 2) d = 2 * (t.x - (p.x + p.w)); }
      else {
        if (sameRow && p.x + p.w <= t.x + 2) d = t.x - (p.x + p.w);                                   // to the left
        else if (p.y + p.h <= t.y + 2 && t.y - (p.y + p.h) <= 1.5 * Math.max(t.h, 12 / k) && px >= t.x - 4 && p.x <= t.x + t.w) d = t.y - (p.y + p.h);   // just above
      }
      if (d >= 0 && d < bd && d <= 300 / k) { bd = d; best = p; }
    }
    if (best) { t.label = best.label; best.names = true; }
  }
  // ...and those words are then that control's name, not a second target beside it: one number per thing to click
  for (let i = out.length - 1; i >= 0; i--) if (out[i].names) out.splice(i, 1);
  // in reading order: rows (centres within half a row of each other), then left to right
  out.sort((a, b) => { const ay = a.y + a.h / 2, by = b.y + b.h / 2; return Math.abs(ay - by) <= Math.min(a.h, b.h) / 2 ? a.x - b.x : ay - by; });
  // too many to number usefully: keep the controls first, then the shortest words
  let keep = out;
  if (out.length > max) {
    const rank = (t) => (t.kind === 'text' ? 1 : 0) * 1000 + Math.min(999, t.label.length);
    const chosen = new Set(out.slice().sort((a, b) => rank(a) - rank(b)).slice(0, max));
    keep = out.filter((t) => chosen.has(t));
  }
  // whole pixels: a reader's words, scaled from the screen to a look, land between them
  return keep.map((t, i) => {
    const x = Math.floor(t.x), y = Math.floor(t.y), w = Math.ceil(t.x + t.w) - x, h = Math.ceil(t.y + t.h) - y;
    const m = { n: i + 1, kind: t.kind, label: t.label.slice(0, 60), x, y, w, h, cx: Math.round(x + w / 2), cy: Math.round(y + h / 2) };
    if (t.value) m.value = t.value.slice(0, 60);
    return m;
  });
}

// ---- DRAWING THE NUMBERS ---------------------------------------------------------------------------------
// A 5x7 digit drawn at twice its size, white on a coloured tag at the target's top-left corner, and a one-pixel
// frame of the same colour round the target. A tag goes where it covers nothing it should not: no other tag, no other
// target, none of the words in `opt.avoid` (a label it would hide) -- above the target first, then to its left, its
// right, below it, and inside it only as a last resort. The colours turn over so two marks side by side are told
// apart. A copy: the picture handed in is not touched.
const DIGITS = ['01110100011001110101110011000101110', '00100011000010000100001000010001110', '01110100010000100010001000100011111',
  '11111000100010000010000011000101110', '00010001100101010010111110001000010', '11111100001111000001000011000101110',
  '00110010001000011110100011000101110', '11111000010001000100010000100001000', '01110100011000101110100011000101110',
  '01110100011000101111000010001001100'];
const TAGS = [[215, 38, 61], [27, 120, 200], [20, 140, 90], [220, 100, 20], [140, 60, 170]];
function draw(pic, marks, opt) {
  opt = opt || {};
  const s = opt.size || 2, W = pic.w, H = pic.h;
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * pic.stride + x * pic.bpp, o = (y * W + x) * 3;
    rgb[o] = pic.px[i]; rgb[o + 1] = pic.px[i + 1]; rgb[o + 2] = pic.px[i + 2];
  }
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) { const o = (y * W + x) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } };
  // whole pixels (a fraction of a row is a jump along it: y 17.5 at a width of 1280 lands 640 pixels to the side)
  const whole = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
  const boxesOf = marks.map(whole), avoid = (opt.avoid || []).map(whole);
  const placed = [];
  const onPic = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
  const clear = (r, own, strict) => onPic(r) && !placed.some((p) => overlap(p, r) > 0) &&
    (!strict || (!boxesOf.some((b, j) => j !== own && overlap(b, r) > 0) && !avoid.some((b) => overlap(b, r) > 0)));
  marks.forEach((mk, idx) => {
    const m = Object.assign({ n: mk.n }, boxesOf[idx]);
    const c = TAGS[(m.n - 1) % TAGS.length];
    for (let x = m.x - 1; x <= m.x + m.w; x++) { put(x, m.y - 1, c); put(x, m.y + m.h, c); }
    for (let y = m.y - 1; y <= m.y + m.h; y++) { put(m.x - 1, y, c); put(m.x + m.w, y, c); }
    const digits = String(m.n), tw = digits.length * 6 * s - s + 4, th = 7 * s + 4;
    const spots = [{ x: m.x - 1, y: m.y - 1 - th }, { x: m.x - 1 - tw, y: m.y - 1 }, { x: m.x + m.w + 1, y: m.y - 1 },
                   { x: m.x - 1, y: m.y + m.h + 1 }, { x: m.x, y: m.y }].map((p) => ({ x: p.x, y: p.y, w: tw, h: th }));
    let at = spots.find((r) => clear(r, idx, true)) || spots.find((r) => clear(r, idx, false));
    if (!at) at = { x: Math.max(0, Math.min(W - tw, m.x)), y: Math.max(0, Math.min(H - th, m.y)), w: tw, h: th };
    placed.push(at);
    mk.tag = [at.x, at.y, tw, th];
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) put(at.x + x, at.y + y, c);
    for (let d = 0; d < digits.length; d++) {
      const g = DIGITS[digits.charCodeAt(d) - 48];
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
        if (g[gy * 5 + gx] !== '1') continue;
        for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) put(at.x + 2 + d * 6 * s + gx * s + xx, at.y + 2 + gy * s + yy, [255, 255, 255]);
      }
    }
  });
  return { w: W, h: H, px: rgb, stride: W * 3, bpp: 3, rows: H };
}

// ---- STILL THERE? ----------------------------------------------------------------------------------------
// Two pictures of the same spot -- the look's, and one taken now at the same scale -- compared by the shape of
// their light and dark (normalised cross-correlation of luma), which a hover colour, a focus ring's tint or a
// brighter screen do not change, and a different button, moved text or a page that scrolled do. Compared WHOLE and
// then PART BY PART: a button's outline is most of a spot, and the same outline with other words in it ("Delete
// all" where "Sign in" was) still correlates well as a whole -- so a part with something in it that no longer
// matches makes it a different spot. A spot of one flat colour has no shape to compare: its colour is compared
// instead. A pixel or two of play either way, for the rounding between two cuts of the same screen.
function lumaOf(pic, r) {
  const L = new Float32Array(r.w * r.h), px = pic.px;
  for (let y = 0; y < r.h; y++) {
    let i = (r.y + y) * pic.stride + r.x * pic.bpp;
    for (let x = 0; x < r.w; x++, i += pic.bpp) L[y * r.w + x] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  return L;
}
// the correlation of two same-sized blocks: a (aw wide, at ax,ay) and b (bw wide, at bx,by), every `step` pixels
function ncc(a, aw, ax, ay, b, bw, bx, by, w, h, step) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = 0; y < h; y += step) {
    let i = (ay + y) * aw + ax, j = (by + y) * bw + bx;
    for (let x = 0; x < w; x += step, i += step, j += step) { const p = a[i], q = b[j]; n++; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q; }
  }
  if (!n) return { c: 0, sda: 0, sdb: 0, ma: 0, mb: 0 };
  const ma = sa / n, mb = sb / n, va = Math.max(0, saa / n - ma * ma), vb = Math.max(0, sbb / n - mb * mb);
  const sda = Math.sqrt(va), sdb = Math.sqrt(vb);
  let c;
  if (sda < 4 || sdb < 4) c = sda < 4 && sdb < 4 && Math.abs(ma - mb) <= 12 ? 1 : 0;
  else c = (sab / n - ma * mb) / (sda * sdb);
  return { c, sda, sdb, ma, mb };
}
// a: the earlier picture and ra the spot on it; b: the picture now and rb the same spot on it (same size)
function same(a, ra, b, rb, opt) {
  opt = opt || {};
  const play = opt.play == null ? 2 : opt.play, want = opt.min || 0.9, part = opt.part || 0.5;
  const A = clip(a, ra);
  if (A.w < 3 || A.h < 3) return { same: false, score: 0, why: 'the spot is off the picture' };
  const La = lumaOf(a, A);
  const Rb = clip(b, { x: rb.x - play, y: rb.y - play, w: A.w + 2 * play, h: A.h + 2 * play });
  const Lb = lumaOf(b, Rb);
  let best = { c: -2 }, at = [0, 0];
  for (let dy = -play; dy <= play; dy++) for (let dx = -play; dx <= play; dx++) {
    const bx = rb.x + dx - Rb.x, by = rb.y + dy - Rb.y;
    if (bx < 0 || by < 0 || bx + A.w > Rb.w || by + A.h > Rb.h) continue;
    const r = ncc(La, A.w, 0, 0, Lb, Rb.w, bx, by, A.w, A.h, 1);
    if (r.c > best.c) { best = r; at = [dx, dy]; }
  }
  if (best.c < -1) return { same: false, score: 0, why: 'the spot is off the picture now' };
  const flat = best.sda < 4;
  // part by part, at the best shift: a part with something in it that no longer matches
  let worst = 1;
  if (!flat && best.c >= want) {
    const cols = Math.max(1, Math.round(A.w / 24)), rows = Math.max(1, Math.round(A.h / 16));
    const bx = rb.x + at[0] - Rb.x, by = rb.y + at[1] - Rb.y;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x0 = Math.floor(q * A.w / cols), x1 = Math.floor((q + 1) * A.w / cols), y0 = Math.floor(r * A.h / rows), y1 = Math.floor((r + 1) * A.h / rows);
      const cell = ncc(La, A.w, x0, y0, Lb, Rb.w, bx + x0, by + y0, x1 - x0, y1 - y0, 1);
      if (cell.sda < 6 && cell.sdb < 6) { if (Math.abs(cell.ma - cell.mb) > 24) worst = Math.min(worst, 0); continue; }
      worst = Math.min(worst, cell.c);
    }
  }
  const ok = best.c >= want && worst >= part;
  return { same: ok, score: +Math.max(0, best.c).toFixed(3), part: +Math.max(0, worst).toFixed(3), shift: at, flat };
}
// Where the spot `ra` of picture `a` is now, searching `area` of picture `b` (both at the same scale). Coarse
// (every other position, a sample of the spot's pixels) and then exact around the best. `found` only when the best
// is good AND clearly better than the best elsewhere: a spot that matches in two places (a row of identical
// buttons, a blank field among blank fields) is not followed -- it would be a guess.
function track(a, ra, b, areaR, opt) {
  opt = opt || {};
  const want = opt.min || 0.85, margin = opt.margin || 0.08;
  const A = clip(a, ra), S = clip(b, areaR);
  if (A.w < 3 || A.h < 3 || S.w < A.w || S.h < A.h) return { found: false, why: 'nothing to search' };
  const La = lumaOf(a, A), Ls = lumaOf(b, S);
  const step = Math.max(1, Math.ceil(Math.sqrt((A.w * A.h) / 400)));   // about 400 of the spot's pixels per comparison
  const self = ncc(La, A.w, 0, 0, La, A.w, 0, 0, A.w, A.h, step);
  if (self.sda < 4) return { found: false, flat: true, why: 'the spot is one flat colour: there is nothing to follow it by' };
  const scores = [];
  for (let y = 0; y + A.h <= S.h; y += 2) for (let x = 0; x + A.w <= S.w; x += 2) {
    scores.push([ncc(La, A.w, 0, 0, Ls, S.w, x, y, A.w, A.h, step).c, x, y]);
  }
  if (!scores.length) return { found: false, why: 'nothing to search' };
  scores.sort((p, q) => q[0] - p[0]);
  let best = [-2, 0, 0];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = scores[0][1] + dx, y = scores[0][2] + dy;
    if (x < 0 || y < 0 || x + A.w > S.w || y + A.h > S.h) continue;
    const c = ncc(La, A.w, 0, 0, Ls, S.w, x, y, A.w, A.h, 1).c;
    if (c > best[0]) best = [c, x, y];
  }
  // the best match elsewhere: at least half the spot's size away from the winner
  const other = scores.find((s) => Math.abs(s[1] - best[1]) >= A.w / 2 || Math.abs(s[2] - best[2]) >= A.h / 2);
  const second = other ? other[0] : -1;
  const found = best[0] >= want && best[0] - second >= margin;
  const X = S.x + best[1], Y = S.y + best[2];
  return { found, score: +Math.max(0, best[0]).toFixed(3), second: +Math.max(0, second).toFixed(3), at: [X, Y],
           moved: [X - A.x, Y - A.y], why: found ? undefined : best[0] < want ? 'nothing there looks like it any more' : 'it matches in more than one place' };
}

// The target at a point, or the one it is nearest to: what a click there hits.
function at(marks, x, y) {
  let hit = null, nearest = null, nd = Infinity;
  for (const m of marks || []) {
    if (inside(m, x, y) && (!hit || area(m) < area(hit))) hit = m;
    const d = dist(m, x, y);
    if (d > 0 && d < nd) { nd = d; nearest = m; }
  }
  return { hit, nearest: hit ? null : nearest, dist: hit ? 0 : nd };
}

module.exports = { boxes, phrases, find, draw, same, track, at, dist, clip };

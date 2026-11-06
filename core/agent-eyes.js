'use strict';
// @tool see pixels offline: decode a PNG (even half of one), probe, census, flood, diff, check an expectation
// @run  const eyes = require('../core/agent-eyes.js')   (a library; core/agent-join.js uses it)
// WHAT AN AGENT SEES, AND HOW IT KNOWS IT IS RIGHT.
//
// Everything here is a pure function over bytes: no socket, no relay, no host. That is deliberate --
// the perception an agent reasons from is the half most likely to be quietly wrong, and a half that
// needs a live machine to exercise is a half nobody tests. Give it a PNG and it answers offline.
//
// THE PROBLEM THIS EXISTS TO SOLVE. Driving a desktop is cheap and watching one is expensive: a
// mouse event is a few dozen bytes, and a screenshot is a whole-monitor BitBlt, a whole-monitor PNG
// encode, and ~90 KB over three round trips. So an agent that looks before every action spends all
// its time looking, and an agent that does not look is guessing. Every task so far has been shaped
// around that asymmetry -- read once, compute a great deal, act in bulk, hope -- and that shape is
// the reason the agent has only ever been able to do simple things.
//
// Three answers, in order of how much they buy:
//   1. HOLD A FRAME AND READ IT IN PIECES. The host keeps a screenshot for ten minutes and will read
//      the text in any rectangle of it without capturing anything new. So one ~5.5 KB round trip
//      buys a frame, and each later question about it costs a rectangle rather than a screen. The
//      client never did this; it always fetched every byte.
//   2. DECODE ONLY AS FAR AS THE ANSWER. A PNG's rows are one zlib stream in order, so the rows
//      above the region are the only ones that must be inflated to reach it. Asking for the leading
//      bytes and inflating what arrives answers a question about the top of the screen -- a menu, a
//      toolbar, a title bar -- without the rest of the picture ever crossing the wire.
//   3. MEASURE, DO NOT LOOK. A model reading a picture of a screen is guessing at pixels it could
//      have counted. census/flood/probe/diff answer exactly, in integers, for nothing.
//
// The honest limits, stated here so nobody has to rediscover them: (2) is bounded by where the
// region sits -- a rectangle at the bottom of the screen needs nearly the whole stream, so the win
// runs from large at the top to none at the bottom. A real fix is a crop in the host's TakeShot,
// which captures and encodes whole monitors today; this file is what can be had without touching it.

const zlib = require('zlib');

// ---- PNG, including half of one ------------------------------------------------------------------

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Walk the chunks of a PNG that may STOP IN THE MIDDLE. A chunk whose length runs off the end of
// what we hold is not an error here -- it is the ordinary state of a picture still arriving -- so it
// is left for the next call rather than throwing. Returns what is known so far.
function scan(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.slice(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = -1, end = false;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    if (off + 12 + len > buf.length) {
      // STILL ARRIVING -- and for IDAT that is not a reason to throw the bytes away. Every IDAT
      // payload is one slice of a SINGLE zlib stream, so a prefix of one is a prefix of the picture
      // and decodes to the rows above wherever it stops. Discarding it meant a PNG written as one
      // big IDAT -- which is most encoders -- decoded to nothing at all until its very last byte,
      // and reading only the top of a screen silently cost the whole screen. Clamped to `len` so a
      // chunk's trailing CRC can never be fed to the inflater as if it were compressed data.
      if (type === 'IDAT' && buf.length > off + 8) idat.push(buf.slice(off + 8, Math.min(buf.length, off + 8 + len)));
      break;
    }
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNGs are not read here');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') { end = true; off += 12 + len; break; }
    off += 12 + len;
  }
  if (ctype < 0) return { ready: false };
  if (depth !== 8 || (ctype !== 2 && ctype !== 6)) throw new Error('only 8-bit RGB or RGBA (depth ' + depth + ', colour ' + ctype + ')');
  return { ready: true, w, h, bpp: ctype === 6 ? 4 : 3, idat: Buffer.concat(idat), whole: end };
}

// Undo the per-row filters. `rows` is how many complete rows the inflated bytes actually hold, which
// is the whole point: a partial stream decodes to a partial picture rather than to an exception.
function unfilter(raw, w, h, bpp) {
  const stride = w * bpp, rows = Math.min(h, Math.floor(raw.length / (stride + 1)));
  const px = Buffer.alloc(rows * stride);
  for (let y = 0; y < rows; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.slice(y * stride, (y + 1) * stride);
    const prv = y ? px.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prv ? prv[i] : 0, c = (prv && i >= bpp) ? prv[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }
  return { px, rows, stride };
}

// Decode as much of a picture as the bytes in hand allow. `rows` says how far down it is true.
// Z_SYNC_FLUSH is what makes a truncated zlib stream return its prefix instead of throwing -- the
// whole of trick (2) above rests on this one option.
function decode(buf) {
  const s = scan(buf);
  if (!s.ready) return { ready: false, rows: 0 };
  let raw;
  try { raw = zlib.inflateSync(s.idat, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
  catch (e) { return { ready: false, rows: 0, why: e.message }; }
  const u = unfilter(raw, s.w, s.h, s.bpp);
  return { ready: true, w: s.w, h: s.h, bpp: s.bpp, px: u.px, stride: u.stride, rows: u.rows, whole: s.whole && u.rows >= s.h };
}

// Is this far enough to answer a question about `rect`? The caller fetches more and asks again.
function covers(img, rect) {
  if (!img || !img.ready) return false;
  const need = rect ? Math.min(img.h, Math.ceil(rect.y + rect.h)) : img.h;
  return img.rows >= need;
}

// ---- measuring, rather than looking ---------------------------------------------------------------

const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
function at(img, x, y) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.rows) return -1;
  const i = y * img.stride + x * img.bpp;
  return (img.px[i] << 16) | (img.px[i + 1] << 8) | img.px[i + 2];
}
const probe = (img, x, y) => { const v = at(img, x, y); return v < 0 ? null : hex(v); };

function clampRect(img, r) {
  const x = Math.max(0, Math.min(img.w, Math.round((r && r.x) || 0)));
  const y = Math.max(0, Math.min(img.rows, Math.round((r && r.y) || 0)));
  const w = Math.max(0, Math.min(img.w - x, Math.round(r && r.w != null ? r.w : img.w)));
  const h = Math.max(0, Math.min(img.rows - y, Math.round(r && r.h != null ? r.h : img.rows)));
  return { x, y, w, h };
}

// Every connected region inside a rectangle, biggest first. This is how a drawing's topology, a
// dialog's layout or a grid's cells are read EXACTLY, with no recognizer and no guessing.
//
// `cap` bounds what comes BACK and `min` bounds what is kept. Both are needed, and only the first was
// here at first: a census of flat UI finds a handful of regions, but one square inch of photograph,
// gradient or antialiased text is hundreds of thousands of one-pixel regions, and building an object
// for each of them before sorting and throwing almost all of them away is the difference between a
// prompt answer and a hung tool. Small regions are still COUNTED, so `total` stays honest.
function census(img, rect, cap, min) {
  const r = clampRect(img, rect), lim = cap || 24, floor = min == null ? 16 : min;
  const seen = new Int32Array(r.w * r.h).fill(-1);
  const out = [];
  let total = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (seen[y * r.w + x] >= 0) continue;
    const id = total, target = at(img, r.x + x, r.y + y), st = [[x, y]];
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    while (st.length) {
      const p = st.pop(), px_ = p[0], py = p[1];
      if (px_ < 0 || py < 0 || px_ >= r.w || py >= r.h) continue;
      const k = py * r.w + px_;
      if (seen[k] >= 0 || at(img, r.x + px_, r.y + py) !== target) continue;
      seen[k] = id; n++;
      if (px_ < x0) x0 = px_; if (px_ > x1) x1 = px_; if (py < y0) y0 = py; if (py > y1) y1 = py;
      st.push([px_ + 1, py], [px_ - 1, py], [px_, py + 1], [px_, py - 1]);
    }
    total++;
    if (n >= floor) out.push({ n, hex: hex(target), box: [r.x + x0, r.y + y0, x1 - x0 + 1, y1 - y0 + 1] });
  }
  out.sort((a, b) => b.n - a.n);
  return { regions: out.slice(0, lim), kept: out.length, total, min: floor };
}

// WHERE WOULD A BUCKET FILL ACTUALLY GO? Asked before pouring one, not after. A fill that escapes a
// gap in an outline floods the page, and the only way to find out used to be to do it and look.
function flood(img, x, y, bound) {
  // a WHOLE pixel: a fractional seed indexes `seen` with fractions, which a typed array ignores -- nothing
  // is ever marked, and the fill revisits forever until the heap runs out
  x = Math.round(Number(x)); y = Math.round(Number(y));
  const r = clampRect(img, bound || {});
  const target = at(img, x, y);
  if (target < 0) return { ok: false, why: 'that point is outside the picture' };
  const seen = new Uint8Array(r.w * r.h);
  const st = [[x, y]];
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  while (st.length) {
    const p = st.pop(), px_ = p[0], py = p[1];
    if (px_ < r.x || py < r.y || px_ >= r.x + r.w || py >= r.y + r.h) continue;
    const k = (py - r.y) * r.w + (px_ - r.x);
    if (seen[k] || at(img, px_, py) !== target) continue;
    seen[k] = 1; n++;
    if (px_ < x0) x0 = px_; if (px_ > x1) x1 = px_; if (py < y0) y0 = py; if (py > y1) y1 = py;
    st.push([px_ + 1, py], [px_ - 1, py], [px_, py + 1], [px_, py - 1]);
  }
  return { ok: true, was: hex(target), px: n, box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], escaped: n >= r.w * r.h * 0.5 };
}

// Did anything move? The cheapest question there is, and the one a wait is usually really asking.
function diff(a, b, rect) {
  if (!a || !b || !a.ready || !b.ready) return { ok: false, why: 'one of those pictures is not decoded' };
  if (a.w !== b.w) return { ok: false, why: 'those pictures are different widths' };
  const r = clampRect(a, rect);
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const rows = Math.min(r.y + r.h, a.rows, b.rows);
  for (let y = r.y; y < rows; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (at(a, x, y) === at(b, x, y)) continue;
    n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const area = Math.max(1, r.w * Math.max(0, rows - r.y));
  return { ok: true, px: n, share: n / area, box: n ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null };
}

// ---- what must be true -----------------------------------------------------------------------------
//
// A predicate is the difference between "the click was sent" and "the click landed". Every one of
// these is checkable by a runner with no model in it, which is the property that lets a plan be
// replayed, audited, or stopped at the exact step where the screen stopped matching the plan.
//
//   {px:   {x, y, is:'#rrggbb'}}         that pixel is that colour
//   {any:  {rect, is:'#rrggbb'}}         some pixel in the rectangle is
//   {none: {rect, is:'#rrggbb'}}         no pixel in it is
//   {text: {rect, has:'Export'}}         the words read there contain that  (needs an ocr reading)
//   {notext:{rect, has:'Export'}}        they do not
//   {changed: {rect, from:<image>}}      more than `min` share of it moved   (default 0.002)
//   {stable:  {rect, from:<image>}}      less than `min` share of it moved
//
// `words` is the host's own OCR answer for the region, when the predicate needs one. Matching is
// case-insensitive and ignores runs of whitespace, because a recognizer's spacing is not evidence.
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

function check(pred, ctx) {
  const img = ctx && ctx.image, prev = ctx && ctx.before, words = ctx && ctx.words;
  const name = Object.keys(pred || {})[0];
  const a = (pred || {})[name] || {};
  const rect = a.rect || a;
  const said = (ok, saw) => ({ ok: !!ok, pred: name, saw });
  if (!name) return said(false, 'no expectation was given');
  switch (name) {
    case 'px': {
      if (!img || !img.ready) return said(false, 'no picture');
      const got = probe(img, Math.round(a.x), Math.round(a.y));
      return said(got !== null && got.toLowerCase() === norm(a.is), got === null ? 'outside the picture' : got);
    }
    case 'any': case 'none': {
      if (!img || !img.ready) return said(false, 'no picture');
      const r = clampRect(img, rect), want = parseInt(norm(a.is).replace('#', ''), 16);
      let n = 0;
      for (let y = r.y; y < r.y + r.h && !n; y++) for (let x = r.x; x < r.x + r.w; x++) if (at(img, x, y) === want) { n++; break; }
      return said(name === 'any' ? n > 0 : n === 0, n > 0 ? 'present' : 'absent');
    }
    case 'text': case 'notext': {
      if (!words) return said(false, 'nothing was read there');
      const saw = norm(words);
      const hit = saw.indexOf(norm(a.has)) >= 0;
      return said(name === 'text' ? hit : !hit, saw.slice(0, 120));
    }
    case 'changed': case 'stable': {
      if (!img || !prev) return said(false, 'needs a picture before and after');
      const d = diff(prev, img, rect);
      if (!d.ok) return said(false, d.why);
      const min = a.min != null ? Number(a.min) : 0.002;
      return said(name === 'changed' ? d.share > min : d.share <= min, d.px + ' px (' + (d.share * 100).toFixed(3) + '%)');
    }
    default: return said(false, 'no such expectation: ' + name);
  }
}

// Which rectangle does a predicate care about? The fetch loop uses this to decide how far down the
// picture it has to decode -- an expectation about a menu bar must not pull a whole screen.
function rectOf(pred) {
  const name = Object.keys(pred || {})[0];
  const a = (pred || {})[name] || {};
  if (name === 'px') return { x: Math.round(a.x) || 0, y: Math.round(a.y) || 0, w: 1, h: 1 };
  const r = a.rect || a;
  if (r && r.w != null && r.h != null) return { x: Math.round(r.x) || 0, y: Math.round(r.y) || 0, w: Math.round(r.w), h: Math.round(r.h) };
  return null;   // no rectangle named: the whole picture
}

module.exports = { scan, decode, covers, probe, census, flood, diff, check, rectOf, clampRect, hex };

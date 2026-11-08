'use strict';
// @tool a picture sized for reading: crop + area-average shrink to a long edge, and the way back to screen pixels
// @run  const look = require('./look.js'); look.fit(w, h, rect, max); look.render(img, region); look.renderRaw(img, region); look.toScreen(region, lx, ly)
// look -- WHAT A MODEL IS SHOWN, AND HOW ITS ANSWER GETS BACK TO THE SCREEN.
//
// A full-size screenshot (2560x1440 and up) is shrunk by whatever reads it, and the reader then answers in
// ITS pixels -- "the button is at 640,360" -- which the serve clicked as if they were the screen's. Every such
// click lands at a fraction of the way to the target. `look` makes the shrink ours: the picture is cut to the
// region asked for, shrunk so its long edge is at most `max`, and the scale is handed back WITH it, so a click
// can be given in the look's own pixels (lx/ly) and the serve does the arithmetic -- once, the same way, every
// time. Area-average (not nearest/bilinear) so thin text survives a 2x shrink.
//
// Pure: no I/O. tests/look.js checks the geometry and the pixels.
const { encodePng } = require('./glyph-reader.js');

// The screen rectangle to show (clamped to the screen) and the size to show it at. `k` is SCREEN pixels per
// LOOK pixel (>= 1: a look is never enlarged -- a small region is shown as-is).
function fit(sw, sh, rect, max) {
  const M = Math.max(16, Math.min(4096, Math.round(Number(max) || 1280)));
  let x = 0, y = 0, w = sw, h = sh;
  if (rect && typeof rect === 'object') {
    x = Math.max(0, Math.min(sw - 1, Math.round(Number(rect.x) || 0)));
    y = Math.max(0, Math.min(sh - 1, Math.round(Number(rect.y) || 0)));
    w = Math.max(1, Math.min(sw - x, Math.round(Number(rect.w) || (sw - x))));
    h = Math.max(1, Math.min(sh - y, Math.round(Number(rect.h) || (sh - y))));
  }
  const k = Math.max(1, Math.max(w, h) / M);
  return { x, y, w, h, k: +k.toFixed(6), ow: Math.max(1, Math.round(w / k)), oh: Math.max(1, Math.round(h / k)) };
}

// Area-average the region of a decoded picture (agent-eyes decode: px/stride/bpp/rows) to ow x oh: the pixels,
// as a decoded picture of its own (what the model is shown, kept so a click can be checked against it).
function renderRaw(img, r) {
  const { ow, oh } = r, rgb = Buffer.alloc(ow * oh * 3);
  const sx = r.w / ow, sy = r.h / oh, rows = Math.min(img.rows, img.h);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = r.y + oy * sy, y1 = y0 + sy;
    for (let ox = 0; ox < ow; ox++) {
      const x0 = r.x + ox * sx, x1 = x0 + sx;
      let a = 0, R = 0, G = 0, B = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        if (yy < 0 || yy >= rows) continue;
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          if (xx < 0 || xx >= img.w) continue;
          const wgt = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
          const i = yy * img.stride + xx * img.bpp;
          R += img.px[i] * wgt; G += img.px[i + 1] * wgt; B += img.px[i + 2] * wgt; a += wgt;
        }
      }
      const o = (oy * ow + ox) * 3;
      if (a > 0) { rgb[o] = Math.round(R / a); rgb[o + 1] = Math.round(G / a); rgb[o + 2] = Math.round(B / a); }
    }
  }
  return { w: ow, h: oh, px: rgb, stride: ow * 3, bpp: 3, rows: oh, ready: true };
}
// ...and as a PNG.
function render(img, r) { const p = renderRaw(img, r); return encodePng(p.w, p.h, p.px); }

// A point in the look's pixels -> the screen's (the centre of the screen area that look pixel covers).
// Outside the look is refused rather than clamped: a point off the picture was not seen, so it is not aimed at.
function toScreen(r, lx, ly) {
  const X = Number(lx), Y = Number(ly);
  if (!r) return { ok: false, why: 'lx/ly are in the last look\'s pixels, and there has been no look yet -- `look` first (or give x/y)' };
  if (!Number.isFinite(X) || !Number.isFinite(Y)) return { ok: false, why: 'lx and ly must be numbers' };
  if (X < 0 || Y < 0 || X > r.ow || Y > r.oh) return { ok: false, why: 'lx,ly ' + X + ',' + Y + ' is outside the last look (' + r.ow + 'x' + r.oh + ')' };
  return { ok: true, x: Math.min(r.x + r.w - 1, Math.round(r.x + X * r.k)), y: Math.min(r.y + r.h - 1, Math.round(r.y + Y * r.k)) };
}

module.exports = { fit, render, renderRaw, toScreen };

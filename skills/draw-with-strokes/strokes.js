'use strict';
// @tool turn primitive shapes (ellipse/line/polyline/rect/arc/bezier) into `strokes` drive commands, chunked under the command-size ceiling
// @run  node skills/draw-with-strokes/strokes.js demo
// draw-with-strokes -- GENERATE THE POINT LISTS A DRAWING NEEDS, so a smooth curve is ONE command, not N looks.
//
// WHY. Drawing by hand means a drag per curve, and a curve is many points; the host draws a held drag with
// the `stroke {points,ms}` / `strokes {list}` verbs (coordinates are absolute pixels at the served WxH). Two
// things make hand-building those lists painful: computing smooth curve points every time, and keeping the
// command's JSON under the host's ~8 KB command ceiling. This does both -- the shape helpers return integer
// point arrays, and commands() packs them into as few `strokes` commands as fit, splitting when needed and
// thinning a single over-long stroke while keeping its endpoints. Pure + deterministic; unit-tested offline.
// The on-canvas RESULT still wants a live check the first time (brush size / tool settings change the line).

const MAXBYTES = 8000;                       // keep one strokes command's JSON under the ~8191-char ceiling
const R = (v) => Math.round(v);

function line(a, b) { return [[R(a[0]), R(a[1])], [R(b[0]), R(b[1])]]; }
function polyline(pts) { return (pts || []).map((p) => [R(p[0]), R(p[1])]); }
function rect(x, y, w, h) { return [[R(x), R(y)], [R(x + w), R(y)], [R(x + w), R(y + h)], [R(x), R(y + h)], [R(x), R(y)]]; }

// Points around an ellipse, starting at angle 0 (the +x point) and closed back to the start.
function ellipse(cx, cy, rx, ry, opts) {
  const o = opts || {};
  const perim = Math.PI * (3 * (rx + ry) - Math.sqrt(Math.max(0, (3 * rx + ry) * (rx + 3 * ry))));
  const n = Math.max(o.min || 12, Math.min(o.max || 64, Math.ceil(perim / (o.spacing || 6))));
  const pts = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI; pts.push([R(cx + rx * Math.cos(t)), R(cy + ry * Math.sin(t))]); }
  pts.push(pts[0].slice());                  // close the loop
  return pts;
}
// An arc of a circle from angle a0 to a1 (radians); NOT closed.
function arc(cx, cy, r, a0, a1, opts) {
  const o = opts || {};
  const n = Math.max(o.min || 8, Math.min(o.max || 64, Math.ceil(Math.abs(a1 - a0) * r / (o.spacing || 6))));
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * (i / n); pts.push([R(cx + r * Math.cos(t)), R(cy + r * Math.sin(t))]); }
  return pts;
}
// A cubic Bezier from p0 to p3 with controls p1,p2 -- first point is p0, last is p3.
function bezier(p0, p1, p2, p3, opts) {
  const o = opts || {}, n = Math.max(o.min || 8, Math.min(o.max || 96, o.steps || 24));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([R(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]),
              R(u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1])]);
  }
  return pts;
}

// Downsample a stroke (keeping both endpoints) until its own JSON fits -- a fallback for one pathological stroke.
function fit(points, maxBytes) {
  let pts = points;
  while (pts.length > 2 && JSON.stringify(pts).length > maxBytes) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i += 2) out.push(pts[i]);
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// Pack strokes (each a point array) into one or more `strokes` commands, each JSON under maxBytes.
function commands(strokeList, opts) {
  const o = opts || {}, maxBytes = o.maxBytes || MAXBYTES, ms = o.ms;
  const wrap = (list) => Object.assign({ do: 'strokes', list }, ms != null ? { ms } : {});
  const size = (list) => JSON.stringify(wrap(list)).length;
  const out = [];
  let cur = [];
  for (let s of (strokeList || [])) {
    s = polyline(s);
    if (s.length < 2) continue;
    const item = { points: s };
    if (size([item]) > maxBytes) item.points = fit(s, maxBytes - 40);   // one giant stroke: thin it to fit alone
    if (cur.length && size(cur.concat([item])) > maxBytes) { out.push(cur); cur = []; }
    cur.push(item);
  }
  if (cur.length) out.push(cur);
  return out.map(wrap);
}

module.exports = { line, polyline, rect, ellipse, arc, bezier, commands, fit, MAXBYTES };

// CLI: `demo` prints the commands for a small ORIGINAL face; a path reads a shapes JSON and prints its commands.
if (require.main === module) {
  const arg = process.argv[2];
  let strokes;
  if (!arg || arg === 'demo') {
    strokes = [
      ellipse(200, 160, 90, 90),                               // head
      ellipse(170, 140, 12, 16),                               // left eye
      ellipse(230, 140, 12, 16),                               // right eye
      arc(200, 175, 45, 0.25 * Math.PI, 0.75 * Math.PI),       // a smile
    ];
  } else {
    const shapes = JSON.parse(require('fs').readFileSync(arg, 'utf8'));
    const map = {
      line: (s) => line(s.a, s.b), polyline: (s) => polyline(s.points), rect: (s) => rect(s.x, s.y, s.w, s.h),
      ellipse: (s) => ellipse(s.cx, s.cy, s.rx, s.ry, s), arc: (s) => arc(s.cx, s.cy, s.r, s.a0, s.a1, s),
      bezier: (s) => bezier(s.p0, s.p1, s.p2, s.p3, s),
    };
    strokes = shapes.map((s) => (map[s.type] || (() => []))(s));
  }
  const cmds = commands(strokes);
  process.stdout.write(JSON.stringify(cmds, null, 1) + '\n');
  process.stderr.write('[+] ' + strokes.length + ' strokes -> ' + cmds.length + ' command(s), largest ' +
    Math.max.apply(null, cmds.map((c) => JSON.stringify(c).length)) + ' bytes\n');
}

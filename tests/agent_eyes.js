// agent_eyes.js — unit test for bin/agent-eyes.js, the offline PERCEPTION library (decode a PNG, then
// answer predicates with no model and no live host -- "give it a PNG and it answers offline"). Builds tiny
// PNGs in-process (a white canvas with a red square; a second with the square moved) and checks decode /
// probe / covers / px / any / none / census / flood / diff / changed / stable. text/notext need host OCR,
// so they are out of scope offline. No dependencies beyond Node's zlib.
//   node tests/agent_eyes.js
'use strict';
const zlib = require('zlib'), path = require('path');
const eyes = require(path.join(__dirname, '..', 'core', 'agent-eyes.js'));

// minimal non-interlaced 8-bit RGB PNG encoder (filter 0 rows) -- exactly what agent-eyes.decode reads
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length >>> 0);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit, colour type 2 (RGB)
  const stride = w * 3, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; for (let x = 0; x < w; x++) { const c = rgb(x, y), o = y * (stride + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const RED = [255, 0, 0], WHITE = [255, 255, 255];
const square = (x0) => (x, y) => (x >= x0 && x < x0 + 10 && y >= 5 && y < 15) ? RED : WHITE;
const A = eyes.decode(png(40, 30, square(5)));     // red 10x10 square at x 5..14
const B = eyes.decode(png(40, 30, square(20)));    // same square moved to x 20..29

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

ok(A.ready === true && A.w === 40 && A.h === 30 && A.rows === 30, 'decode: ready, 40x30, all rows present');
ok(eyes.probe(A, 7, 7) === '#ff0000', 'probe: inside the red square is #ff0000 (got ' + eyes.probe(A, 7, 7) + ')');
ok(eyes.probe(A, 0, 0) === '#ffffff', 'probe: the background is #ffffff');
ok(eyes.probe(A, 100, 100) === null, 'probe: outside the picture is null');
ok(eyes.covers(A, { x: 0, y: 0, w: 40, h: 30 }) === true, 'covers: a fully decoded image covers its rect');
ok(eyes.check({ px: { x: 7, y: 7, is: '#ff0000' } }, { image: A }).ok === true, 'check px: red where red is');
ok(eyes.check({ px: { x: 0, y: 0, is: '#ff0000' } }, { image: A }).ok === false, 'check px: not red where white is');
ok(eyes.check({ any: { rect: { x: 0, y: 0, w: 40, h: 30 }, is: '#ff0000' } }, { image: A }).ok === true, 'check any: red is present somewhere');
ok(eyes.check({ none: { rect: { x: 25, y: 20, w: 10, h: 8 }, is: '#ff0000' } }, { image: A }).ok === true, 'check none: no red in the bottom-right');
const cen = eyes.census(A, { x: 0, y: 0, w: 40, h: 30 });
ok(cen.regions.some((r) => r.hex === '#ff0000' && r.n === 100 && r.box[0] === 5 && r.box[1] === 5 && r.box[2] === 10 && r.box[3] === 10), 'census: finds the 10x10 red region at (5,5)');
const fl = eyes.flood(A, 7, 7, { x: 0, y: 0, w: 40, h: 30 });
ok(fl.ok && fl.px === 100 && fl.was === '#ff0000' && !fl.escaped, 'flood: the red square is 100px and does not escape');
// a seed off a computed position is often fractional (a page shift read off a found grid was -0.3): it is the
// pixel it rounds to -- it used to mark nothing as seen and fill until the heap ran out
const flf = eyes.flood(A, 7.4, 6.7, { x: 0, y: 0, w: 40, h: 30 });
ok(flf.ok && flf.px === 100 && flf.was === '#ff0000', 'flood: a fractional seed fills the pixel it rounds to (' + JSON.stringify(flf) + ')');
const d = eyes.diff(A, B, { x: 0, y: 0, w: 40, h: 30 });
ok(d.ok && d.px > 0 && d.share > 0, 'diff: moving the square changes some pixels');
ok(eyes.check({ changed: { rect: { x: 0, y: 0, w: 40, h: 30 } } }, { image: B, before: A }).ok === true, 'check changed: true when the square moved');
ok(eyes.check({ stable: { rect: { x: 0, y: 0, w: 40, h: 30 } } }, { image: A, before: A }).ok === true, 'check stable: true for the same picture');

console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

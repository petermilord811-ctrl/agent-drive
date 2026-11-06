// local_ocr.js -- vision/local-ocr.js: the words in a picture read HERE, on the driver, and answered
// in the host's own `ocr` shape, so a text check works on a host that has no reader of its own.
//   1. offline, everywhere: Tesseract's TSV grouped into lines with its boxes divided back, its language list and
//      tag mapping, the hosts' scale rule, and the pixel steps the Linux host puts in front of Tesseract;
//   2. a reader that is not there (forced) answers {ok:false, why} and throws nothing; so do a bad picture, path,
//      language or region;
//   3. LIVE, on Windows with a reader: known text drawn by System.Drawing (black on white, at known places) is
//      read word for word, its boxes land on the ink (+-3 px), at 1:1 and read 2x bigger; readRegion clamps a
//      region as the host does and answers boxes relative to it; and the timings, first call against warm.
//   node tests/local_ocr.js
// The live part SKIPS where there is no reader or no way to draw known text (not Windows) -- that is not a pass.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const AD = path.join(__dirname, '..');
const MOD = path.join(AD, 'vision', 'local-ocr.js');
const ocr = require(MOD);
const eyes = require(path.join(AD, 'core', 'agent-eyes.js'));
const { encodePng } = require(path.join(AD, 'vision', 'glyph-reader.js'));

let checks = 0, failed = 0;
function check(ok, what) {
  checks++;
  if (ok) console.log('  ok    ' + what);
  else { failed++; console.log('  FAIL  ' + what); }
}
const skip = (what) => console.log('  skip  ' + what + ' -- nothing is measured (that is not a pass)');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ocr-test-'));
// A read's own temp files are named for this process; none may be left behind.
const strays = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('local-ocr-' + process.pid + '-'));
// Run something that must never throw, and say so if it did.
async function safe(what, fn) {
  try { return await fn(); } catch (e) { check(false, what + ' -- it THREW: ' + (e && e.message || e)); return null; }
}
console.log('local ocr');

async function main() {
  // ---- 1. offline ------------------------------------------------------------------------------------------
  const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '1\t1\t0\t0\t0\t0\t0\t0\t800\t200\t-1\t',
    '4\t1\t1\t1\t1\t0\t20\t10\t300\t30\t-1\t',
    '5\t1\t1\t1\t1\t1\t20\t10\t100\t30\t96.5\tExport\r',
    '5\t1\t1\t1\t1\t2\t130\t10\t120\t30\t91\tdisplay',
    '5\t1\t1\t1\t1\t3\t260\t12\t10\t10\t9\tiy',                    // Tesseract guessing at an icon: dropped
    '5\t1\t1\t1\t2\t1\t20\t50\t140\t30\t95\tQuietly',
    '5\t1\t1\t1\t2\t2\t170\t50\t60\t30\t88\t2026',
    '5\t1\t1\t1\t2\t3\t240\t50\t10\t30\t95\t   ',                 // no text: dropped
    '5\t1\t2\t1\t1\t1\t500\t10\t80\t30\t90\tCancel',              // another block: another line
    '5\t1\t3\t1\t1\t1\t600\t100\t20\t28\t47\tiy',                 // an icon read as letters, set apart: dropped
    '5\t1\t3\t1\t1\t2\t650\t100\t120\t30\t95\tSettings',
    '5\t1\t4\t1\t1\t1\t900\t100\t16\t28\t48\t3',                  // a number as unsure, set apart: kept
    '5\t1\t4\t1\t1\t2\t940\t100\t40\t28\t90\tKB'].join('\n');
  check(same(ocr.tsvLines(tsv, 2, 2), [
    { t: 'Export display', w: [['Export', 10, 5, 50, 15], ['display', 65, 5, 60, 15]] },
    { t: 'Quietly 2026', w: [['Quietly', 10, 25, 70, 15], ['2026', 85, 25, 30, 15]] },
    { t: 'Cancel', w: [['Cancel', 250, 5, 40, 15]] },
    { t: 'Settings', w: [['Settings', 325, 50, 60, 15]] },
    { t: '3 KB', w: [['3', 450, 50, 8, 14], ['KB', 470, 50, 20, 14]] }]),
    'Tesseract TSV: words grouped by block/par/line, boxes divided back by the scale, low-confidence, empty and icon words dropped as the Linux host drops them');
  check(same(ocr.listLangs('List of available languages in "/usr/share/tesseract-ocr/5/tessdata/" (5):\nchi_sim\neng\nequ\njpn_vert\nosd\n'), ['chi_sim', 'eng']) &&
        same(ocr.listLangs('List of available languages (3):\r\neng\r\nosd\r\ndeu\r\n'), ['eng', 'deu']),
    'tesseract --list-langs (5.x and 4.x) gives the languages, not osd / equ / the vertical layouts');
  const codes = ['eng', 'deu', 'chi_sim', 'chi_tra', 'srp_latn'];
  const tl = (want) => { const r = ocr.tessLang(codes, want); return r.code + '/' + r.tag; };
  check(tl('en-US') === 'eng/en' && tl('de-AT') === 'deu/de' && tl('zh-TW') === 'chi_tra/zh-Hant' && tl('zh-CN') === 'chi_sim/zh-Hans' &&
        tl('sr-Latn-RS') === 'srp_latn/sr-Latn' && tl('eng+deu') === 'eng+deu/en' && tl('ja') === 'eng/en',
    'BCP-47 -> Tesseract code as the Linux host maps it (region and script honoured; codes taken as they are; else English)');
  check(ocr.autoScale(400, 80, 'windows') === 2 && ocr.autoScale(1920, 1080, 'windows') === 2 &&
        Math.abs(ocr.autoScale(2560, 1440, 'windows') - 1.647) < 0.001 && Math.abs(ocr.autoScale(1920, 1080, 'tesseract') - 1.965) < 0.001 &&
        ocr.autoScale(7680, 4320, 'windows') === 1,
    'the hosts\' scale rule: 2x, eased past ~10 MP (Tesseract ~8 MP), never below 1x');

  // The pixel steps in front of Tesseract. A dark ground is turned over...
  const rgbImg = (w, h, f) => { const rgb = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.fill(f(x, y), (y * w + x) * 3, (y * w + x) * 3 + 3); return eyes.decode(encodePng(w, h, rgb)); };
  const dark = ocr.grey(rgbImg(8, 4, (x) => (x === 3 ? 250 : 30)));
  check(dark.dark && dark.g[0] === 225 && dark.g[3] === 5, 'light text on a dark ground is turned over (mean under 110)');
  // ...and the ground evened out: a white label on a filled box comes out dark on light, like text on the page.
  const G = new Uint8Array(64 * 48).fill(240);
  for (let y = 16; y < 40; y++) for (let x = 8; x < 56; x++) G[y * 64 + x] = 60;    // the filled box (a default button)
  for (let y = 26; y < 30; y++) for (let x = 20; x < 44; x++) G[y * 64 + x] = 250;  // its white label
  for (let y = 4; y < 8; y++) for (let x = 4; x < 30; x++) G[y * 64 + x] = 20;      // ordinary dark text above it
  ocr.evenGround(G, 64, 48);
  check(G[28 * 64 + 32] < 100 && G[34 * 64 + 32] > 200 && G[6 * 64 + 10] < 100 && G[44 * 64 + 60] > 200,
    'the ground evened out: a white label on a filled box -> dark on light, the box -> light, ordinary text stays dark');
  const flat = ocr.enlarge(new Uint8Array(16).fill(100), 4, 4, 8, 8);
  const step = ocr.enlarge(Uint8Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 0 : 255)), 4, 4, 8, 8);
  check(flat.length === 64 && flat.every((v) => v === 100) && step[0] === 0 && step[7] === 255 && step[63] === 255,
    'the bicubic enlargement keeps a flat ground flat and an edge\'s two sides');
  const rgba = (() => { const w = 6, h = 3, b = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) { b[i * 3] = i * 10; b[i * 3 + 1] = 7; b[i * 3 + 2] = 200; } return eyes.decode(encodePng(w, h, b)); })();
  const cut = eyes.decode(ocr.regionPng(rgba, 2, 1, 3, 2));
  check(cut.w === 3 && cut.h === 2 && eyes.probe(cut, 0, 0) === eyes.probe(rgba, 2, 1) && eyes.probe(cut, 2, 1) === eyes.probe(rgba, 4, 2),
    'a region is cut out pixel for pixel');

  // ---- 2. what is not there -----------------------------------------------------------------------------------
  // A copy of the module that is told Tesseract lives at a path with nothing in it: it must say so, not throw.
  const before = process.env.SM_OCR_TESSERACT;
  process.env.SM_OCR_TESSERACT = path.join(TMP, 'no-such-tesseract' + (process.platform === 'win32' ? '.exe' : ''));
  delete require.cache[require.resolve(MOD)];
  const bare = require(MOD);
  delete require.cache[require.resolve(MOD)];
  const bareList = await safe('engines() with no Tesseract', () => bare.engines());
  if (before === undefined) delete process.env.SM_OCR_TESSERACT; else process.env.SM_OCR_TESSERACT = before;
  const tiny = rgbImg(40, 20, () => 255);
  const tinyPng = path.join(TMP, 'tiny.png');
  fs.writeFileSync(tinyPng, encodePng(40, 20, Buffer.alloc(40 * 20 * 3, 255)));
  check(Array.isArray(bareList) && !bareList.includes('tesseract'), 'with no Tesseract to run, engines() does not list it: ' + JSON.stringify(bareList));
  let r = await safe('read() forced onto a missing engine', () => bare.read(tinyPng, { engine: 'tesseract' }));
  check(r && r.ok === false && /Tesseract is not installed/.test(r.why), 'read() forced onto a missing engine: {ok:false, why} -- ' + (r && r.why));
  r = await safe('readRegion() forced onto a missing engine', () => bare.readRegion(tiny, { x: 0, y: 0, w: 10, h: 10 }, { engine: 'tesseract' }));
  check(r && r.ok === false && typeof r.why === 'string', 'readRegion() forced onto a missing engine: {ok:false, why}');
  if (process.platform !== 'win32') {
    r = await safe('read() forced onto Windows\' reader off Windows', () => bare.read(tinyPng, { engine: 'windows' }));
    check(r && r.ok === false && /only on Windows/.test(r.why), 'Windows\' reader forced off Windows: {ok:false, why}');
  }
  r = await safe('an unknown engine', () => ocr.read(tinyPng, { engine: 'nonesuch' }));
  check(r && r.ok === false && /no text reader called/.test(r.why), 'an engine that does not exist: {ok:false, why}');
  r = await safe('a missing picture', () => ocr.read(path.join(TMP, 'not-here.png')));
  check(r && r.ok === false && /no picture at/.test(r.why), 'a picture that is not there: {ok:false, why}');
  r = await safe('a language that is a switch', () => ocr.read(tinyPng, { lang: '-Probe' }));
  check(r && r.ok === false && /not a language tag/.test(r.why), 'a language that would be taken for a switch is refused');
  r = await safe('an empty region', () => ocr.readRegion(tiny, { x: 40, y: 0, w: 10, h: 10 }));
  check(r && r.ok === false && r.why === 'the region is empty', 'a region off the picture is empty, as the host says');
  r = await safe('no picture', () => ocr.readRegion(null, null));
  check(r && r.ok === false, 'no decoded picture: {ok:false, why}');
  r = await safe('a half-decoded picture', () => ocr.readRegion(Object.assign({}, tiny, { rows: 5 }), { x: 0, y: 0, w: 10, h: 10 }));
  check(r && r.ok === false && /decoded down to row 5/.test(r.why), 'a region below the rows decoded so far is refused, not read short');

  // ---- 3. live ------------------------------------------------------------------------------------------------
  // The FIRST read is timed on a copy of the module nothing has asked yet, so the engine probe is in it -- what a
  // client pays for its first text check. (`ocr` itself has probed already: an unknown engine above asked.)
  delete require.cache[require.resolve(MOD)];
  const fresh = require(MOD);
  delete require.cache[require.resolve(MOD)];
  const tFirst = Date.now();
  const firstRead = await safe('the first read', () => fresh.read(tinyPng));
  const firstMs = Date.now() - tFirst;
  const list = await ocr.engines();
  console.log('  ..    local engines here: ' + (list.length ? list.join(', ') : 'none'));
  if (!list.length) { skip('no text reader on this machine (' + (firstRead && firstRead.why) + ')'); return; }
  if (process.env.AGENT_DRIVE_LIVE === '0') { skip('AGENT_DRIVE_LIVE=0 -- the live reads are for a desktop, not CI'); return; }
  if (process.platform !== 'win32') { skip('known text is drawn with System.Drawing, which is Windows\'; ' + list.join(', ') + ' is here but not exercised live'); return; }
  check(firstRead && firstRead.ok && firstRead.lines.length === 0, 'a blank picture reads as no lines');

  // Known text, black on white, at known places. Non-ASCII is built from code points: Windows PowerShell 5.1 reads
  // a script without a BOM in the machine's ANSI code page.
  const W = 900, H = 300, png = path.join(TMP, 'known.png');
  const ps1 = path.join(TMP, 'draw.ps1');
  fs.writeFileSync(ps1, [
    'param([string]$Out)',
    'Add-Type -AssemblyName System.Drawing',
    '$bmp = New-Object System.Drawing.Bitmap ' + W + ', ' + H + ', ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.Clear([System.Drawing.Color]::White)',
    '$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit',
    '$f = New-Object System.Drawing.Font(\'Arial\', 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)',
    '$g.DrawString(\'Export display typography\', $f, [System.Drawing.Brushes]::Black, 40, 30)',
    '$g.DrawString(\'Caf\' + [char]0xE9 + \' Gr\' + [char]0xF6 + [char]0xDF + \'e "quoted" back\\slash\', $f, [System.Drawing.Brushes]::Black, 40, 130)',
    '$g.DrawString(\'Quietly jumping 2026\', $f, [System.Drawing.Brushes]::Black, 520, 230)',
    '$g.Dispose()',
    '$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)',
  ].join('\r\n'));
  const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const drawn = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, png], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (!fs.existsSync(png)) { check(false, 'the known text could not be drawn: ' + (drawn.stderr || drawn.error || '').toString().trim().slice(0, 200)); return; }
  const img = eyes.decode(fs.readFileSync(png));
  const WANT = [['Export', 'display', 'typography'], ['Caf\u00e9', 'Gr\u00f6\u00dfe', '"quoted"', 'back\\slash'], ['Quietly', 'jumping', '2026']];

  // WHERE THE TEXT WAS DRAWN, measured off the picture rather than predicted from font metrics: each band of rows
  // with ink is a line, and inside it a gap of 7 columns or more parts two words. [x, y, w, h] per word.
  const lum = (x, y) => { const i = y * img.stride + x * img.bpp; return (img.px[i] * 299 + img.px[i + 1] * 587 + img.px[i + 2] * 114) / 1000; };
  const inkRow = (y) => { for (let x = 0; x < W; x++) if (lum(x, y) < 160) return true; return false; };
  const bands = [];
  for (let y = 0, s = -1; y <= H; y++) { const on = y < H && inkRow(y); if (on && s < 0) s = y; if (!on && s >= 0) { bands.push([s, y - 1]); s = -1; } }
  const ink = bands.map(([y0, y1]) => {
    const col = (x) => { for (let y = y0; y <= y1; y++) if (lum(x, y) < 160) return true; return false; };
    const spans = [];
    for (let x = 0, a = -1, last = -1; x <= W; x++) {
      if (x < W && col(x)) { if (a < 0) a = x; last = x; }
      else if (a >= 0 && (x - last >= 7 || x === W)) { spans.push([a, last]); a = -1; }
    }
    return spans.map(([x0, x1]) => {
      let t = 1e9, b = -1;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lum(x, y) < 160) { if (y < t) t = y; if (y > b) b = y; }
      return [x0, t, x1 - x0 + 1, b - t + 1];
    });
  });
  check(ink.length === 3 && ink.every((l, i) => l.length === WANT[i].length), 'the drawn text measured off the picture: 3 lines, ' + WANT.map((l) => l.length).join('/') + ' words');
  const TOL = 3;
  // Every word read, its box (+ the region's origin) on the ink of the word drawn there.
  const lands = (lines, li, ox, oy) => {
    const got = lines[li] && lines[li].w;
    if (!got || !ink[li] || got.length !== ink[li].length) return false;
    return got.every((b, i) => { const k = ink[li][i]; return Math.abs(b[1] + ox - k[0]) <= TOL && Math.abs(b[2] + oy - k[1]) <= TOL &&
      Math.abs(b[1] + b[3] + ox - (k[0] + k[2])) <= TOL && Math.abs(b[2] + b[4] + oy - (k[1] + k[3])) <= TOL; });
  };
  const words = (lines) => lines.map((l) => l.w.map((b) => b[0]));

  const t1 = Date.now();
  r = await ocr.read(png, { lang: 'en-US' });
  const ms1 = Date.now() - t1;
  check(r.ok && same(words(r.lines), WANT), 'read(): every word, word for word -- ' + (r.ok ? JSON.stringify(words(r.lines)) : r.why));
  check(r.ok && r.engine === list[0] && r.lang === 'en-US' && r.scale === 1 && r.lines.every((l) => l.t === l.w.map((b) => b[0]).join(' ')),
    'read(): engine, language, scale 1 and each line\'s text are said');
  check(r.ok && [0, 1, 2].every((i) => lands(r.lines, i, 0, 0)), 'read(): every box lands on its word\'s ink (+-' + TOL + ' px)');
  check(r.ok && r.lines.every((l) => l.w.every((b) => b.slice(1).every(Number.isInteger))), 'read(): boxes are whole pixels');
  r = await ocr.read(png, { scale: 2 });
  check(r.ok && r.scale === 2 && same(words(r.lines), WANT) && [0, 1, 2].every((i) => lands(r.lines, i, 0, 0)),
    'read() 2x bigger: the same words, boxes still in the PNG\'s own pixels on the ink');

  // readRegion: the host's object, boxes relative to the region.
  const B = ink[2], bx = B[0][0] - 20, by = B[0][1] - 15, bw = B[2][0] + B[2][2] + 20 - bx, bh = 26 + 30;
  const t2 = Date.now();
  r = await ocr.readRegion(img, { x: bx, y: by, w: bw, h: bh });
  const ms2 = Date.now() - t2;
  const keys = r.ok === false ? [] : Object.keys(r).filter((k) => k !== 'angle').sort();
  check(same(keys, ['engine', 'h', 'lang', 'lines', 'ms', 'scale', 'w', 'x', 'y']) && r.engine === 'local:' + list[0] && !('ok' in r),
    'readRegion(): exactly the host\'s ocr object (lang ms scale x y w h [angle] lines) + engine local:' + list[0] + ' -- ' + (r.why || keys.join(' ')));
  check(r.x === bx && r.y === by && r.w === bw && r.h === bh && r.scale === 2 && same(words(r.lines), [WANT[2]]),
    'readRegion(): the region echoed, read 2x (a small region, the hosts\' rule), only the words inside it');
  check(r.lines && lands([null, null, r.lines[0]], 2, bx, by), 'readRegion(): boxes are relative to the region -- plus its origin, on the ink');
  const one = await ocr.readRegion(img, { x: bx, y: by, w: bw, h: bh }, { scale: 1 });
  const two = await ocr.readRegion(img, { x: bx, y: by, w: bw, h: bh }, { scale: 2 });
  check(one.scale === 1 && two.scale === 2 && one.lines && two.lines && lands([null, null, one.lines[0]], 2, bx, by) && lands([null, null, two.lines[0]], 2, bx, by) &&
        one.lines[0].w.every((b, i) => b.slice(1).every((v, j) => Math.abs(v - two.lines[0].w[i][j + 1]) <= 2)),
    'the 2x read maps back: its boxes agree with the 1:1 read\'s (+-2 px), both on the ink');
  r = await ocr.readRegion(img, { x: 500, y: 210, w: 5000, h: 5000 });
  check(r.x === 500 && r.y === 210 && r.w === W - 500 && r.h === H - 210 && same(words(r.lines || []), [WANT[2]]) && lands([null, null, r.lines[0]], 2, 500, 210),
    'a region off the bottom-right is clamped to the picture (' + [r.x, r.y, r.w, r.h].join(',') + '), its words relative to it');
  r = await ocr.readRegion(img, { x: -40, y: -10, w: 600, h: 100 });
  check(r.x === 0 && r.y === 0 && r.w === 600 && r.h === 100 && same(words(r.lines || []), [WANT[0]]) && lands(r.lines, 0, 0, 0),
    'a region above-left of the picture starts at 0,0 and keeps its size, as the host clamps it');
  const t3 = Date.now();
  r = await ocr.readRegion(img, null);
  const ms3 = Date.now() - t3;
  check(r.x === 0 && r.y === 0 && r.w === W && r.h === H && same(words(r.lines || []), WANT), 'no region: the whole picture');
  // A picture longer than the recognizer takes (MaxImageDimension: 10000 on Windows 11) is read SMALLER to fit, and
  // its boxes still come back in its own pixels. (A recognizer that takes only 2600 shrinks this one too far to
  // read 28 px text; there only the shrink itself is checked.)
  const LW = 10400, wide = Buffer.alloc(LW * H * 3, 255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) wide[(y * LW + x) * 3 + c] = img.px[y * img.stride + x * img.bpp + c];
  const widePng = path.join(TMP, 'wide.png');
  fs.writeFileSync(widePng, encodePng(LW, H, wide));
  r = await ocr.read(widePng);
  check(r.ok && r.scale < 1 && (r.scale < 0.5 || (same(words(r.lines), WANT) && [0, 1, 2].every((i) => lands(r.lines, i, 0, 0)))),
    'a picture ' + LW + ' px long is read smaller to fit the recognizer (scale ' + r.scale + '), its boxes still on the ink in its own pixels');
  check(strays().length === 0, 'no picture is left in the temp folder after any read' + (strays().length ? ': ' + strays().join(' ') : ''));

  // ---- timings ------------------------------------------------------------------------------------------------
  const warm = [];
  for (let i = 0; i < 5; i++) { const t = Date.now(); await ocr.read(tinyPng); warm.push(Date.now() - t); }
  warm.sort((a, b) => a - b);
  console.log('  ..    timings here (' + list[0] + '): first read ' + firstMs + ' ms (engine probe included); a warm read ' + warm[2] +
              ' ms (median of 5, ' + warm[0] + '-' + warm[4] + '); known picture ' + W + 'x' + H + ' at 1:1 ' + ms1 + ' ms; a small region at 2x ' + ms2 +
              ' ms; the whole picture at 2x ' + ms3 + ' ms');
}

main().catch((e) => check(false, 'the test itself broke: ' + (e && e.stack || e))).finally(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  check(!fs.existsSync(TMP), 'the test\'s own temp folder is gone');
  console.log('\nlocal ocr: ' + checks + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});

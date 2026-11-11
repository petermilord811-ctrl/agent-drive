'use strict';
// @tool read the text in a picture HERE, on the driver (Windows.Media.Ocr, else Tesseract), in the host's own `ocr` answer shape
// @run  const ocr = require('../vision/local-ocr.js'); await ocr.engines(); await ocr.read(png, {lang}); await ocr.readRegion(img, rect, {lang})
// local-ocr.js -- THE WORDS IN A PICTURE, READ ON THIS SIDE OF THE WIRE.
//
// WHY THIS EXISTS. The agent reads the text in a rectangle of a screenshot the HOST holds (`shot-ocr`): a Windows
// host with Windows.Media.Ocr, a Linux host by running Tesseract -- and not one Linux host driven so far had
// Tesseract, so `ocr`, `find`, `clickText` and `expect {text}` failed there and every check fell back to pictures,
// a model turn each. The client can fetch the held picture's bytes itself (agent-join's `see`), so it can read
// the words HERE instead: with Windows' own recognizer when this driver is Windows (Windows PowerShell 5.1 runs
// local-ocr.ps1, beside this file), else Tesseract when it is on PATH. readRegion answers EXACTLY the host's `ocr`
// object -- lines with word boxes relative to the clamped region, x/y/w/h, lang, scale, ms -- with engine
// 'local:<name>', so whatever reads a host's answer reads this one unchanged.
//
// READ BIGGER, AS THE HOSTS DO. Both hosts measured that text of 9-11 px is mostly lost at 1:1 and comes back at
// 2x, that 3x buys nothing over 2x, and that 12 px and up reads the same either way (hosts/windows/ScreenSender.cpp above
// OcrScaleFor; hosts/linux/screensender_linux.cpp above kOcrUpscale). So readRegion reads at 2x, eased down past ~10 MP
// (Tesseract ~8 MP) by the hosts' own formula: the same region gives the same words whichever side read it, and
// a whole screen -- where most small print is -- is not read at 1:1 just because it is big.
//
// TESSERACT IS FED WHAT THE LINUX HOST FEEDS IT: the picture in grey, turned over when it is light on dark,
// scaled, its ground evened out, at --psm 3 with the dpi the text was scaled to, one thread; a word under
// confidence 15, or an icon read as letters before a line, is dropped. The reasons are measured in the host's
// comments. evenGround is the host's ocrEvenGround line for line -- compiled from its source and compared, the two
// agree byte for byte (but for 1 level on 32 bytes of 8 MB: float against double) -- so this side reads what the
// host would, misses included. Run against Tesseract 5.3.4 (WSL's, standing in for one on PATH) it read small
// print and light-on-dark text word for word; tests/local_ocr.js checks the TSV reading and the pixel steps offline.
//
// WHAT IT COSTS, measured where it was written (Windows 11, Windows.Media.Ocr): ~330 ms a read of a small picture,
// ~150 ms of it starting PowerShell and ~70 ms loading WinRT -- ~600 ms for the first, which also asks which engines
// there are; a whole 1920x1080 screen of dense UI text ~560 ms at 1:1 and ~710 ms at the 2x it is read at, where
// 10 px text goes from 5% of its words read to 71%. A model turn costs seconds, so this pays for itself at once.
//
// THE PICTURE NEVER OUTLIVES THE READ. A crop is written to a private temp file (created exclusively, 0600) and
// deleted in a `finally`, whatever happened -- a screen can hold anything.
//
// NOTHING HERE THROWS. Every answer is {ok:false, why} in words, or the reading.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const eyes = require('../core/agent-eyes.js');
const { encodePng } = require('./glyph-reader.js');

const ENGINES = ['windows', 'tesseract'];   // the order one is chosen in when none is named
const PS1 = path.join(__dirname, 'local-ocr.ps1');
const TIMEOUT = 20000;
const MAX_SCALE = 4;
// WINDOWS POWERSHELL 5.1 BY ITS FULL PATH, never `powershell` off PATH and never pwsh: the script reaches WinRT
// through the .NET Framework's projection, which PowerShell 7 does not have.
const POWERSHELL = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1];
// Tesseract's program, overridable as on the Linux host (SM_OCR_TESSERACT) for a build installed off PATH.
const tesseractBin = () => process.env.SM_OCR_TESSERACT || 'tesseract';

// ---- running a program --------------------------------------------------------------------------------------
// Always resolves: {code, out, err, timedOut, spawnError}. Output is capped, and a program past its time is killed.
function run(cmd, args, opts) {
  const o = opts || {}, cap = o.cap || 32 * 1024 * 1024;
  return new Promise((resolve) => {
    let child, done = false, timer = null;
    const out = [], err = [];
    let nOut = 0, nErr = 0, timedOut = false;
    const finish = (r) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(r); };
    try { child = spawn(cmd, args, { windowsHide: true, env: o.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { finish({ code: -1, out: '', err: '', spawnError: e.code || e.message }); return; }
    child.stdout.on('data', (b) => { if (nOut < cap) { out.push(b); nOut += b.length; } });
    child.stderr.on('data', (b) => { if (nErr < 256 * 1024) { err.push(b); nErr += b.length; } });
    child.on('error', (e) => finish({ code: -1, out: '', err: '', spawnError: e.code || e.message }));
    child.on('close', (code) => finish({ code, timedOut, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') }));
    timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch (_) {} }, Math.max(1, o.timeout || TIMEOUT));
  });
}
const firstLine = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || '';
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();   // WinRT's reasons come in several lines
// The answer local-ocr.ps1 prints: its last line that is a JSON object (anything PowerShell said before is not).
function lastJson(s) {
  const lines = String(s || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch (_) {} }
  return null;
}
// A private file in the temp folder for one read: created exclusively (never someone else's file), 0600.
function tempFile(ext, bytes) {
  const f = path.join(os.tmpdir(), 'local-ocr-' + process.pid + '-' + crypto.randomBytes(6).toString('hex') + ext);
  fs.writeFileSync(f, bytes, { flag: 'wx', mode: 0o600 });
  return f;
}
const drop = (f) => { if (f) { try { fs.unlinkSync(f); } catch (_) {} } };
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
// The lines as the host sends them: {t, w:[[word, x, y, w, h], ...]}, whole numbers.
const tidy = (lines) => (Array.isArray(lines) ? lines : []).map((l) => ({
  t: String((l && l.t) || ''), w: (Array.isArray(l && l.w) ? l.w : []).map((b) => [String(b[0]), int(b[1]), int(b[2]), int(b[3]), int(b[4])]) }));

// ---- Windows.Media.Ocr, through Windows PowerShell 5.1 --------------------------------------------------------
async function winProbe() {
  if (process.platform !== 'win32') return { ok: false, why: 'Windows\' own text reader (Windows.Media.Ocr) is only on Windows, and this is ' + process.platform };
  if (!fs.existsSync(POWERSHELL)) return { ok: false, why: 'Windows PowerShell 5.1 is not at ' + POWERSHELL + ', and it is what reaches Windows\' text reader' };
  if (!fs.existsSync(PS1)) return { ok: false, why: 'local-ocr.ps1 is missing from ' + __dirname };
  const r = await run(POWERSHELL, PS_ARGS.concat(['-Probe']), { timeout: 15000 });
  if (r.spawnError) return { ok: false, why: 'Windows PowerShell could not be started: ' + r.spawnError };
  if (r.timedOut) return { ok: false, retry: true, why: 'Windows\' text reader did not answer within 15 s' };
  const j = lastJson(r.out);
  if (!j) return { ok: false, why: 'Windows\' text reader did not start here: ' + (firstLine(r.err) || firstLine(r.out) || 'no answer (exit ' + r.code + ')') };
  if (!j.ok) return { ok: false, why: 'Windows\' text reader did not start here: ' + oneLine(j.why) };
  const langs = Array.isArray(j.langs) ? j.langs.map(String) : [];
  if (!langs.length) return { ok: false, why: 'Windows on this machine cannot read text in any language yet (no OCR language is installed)' };
  return { ok: true, langs, max: int(j.max), profile: String(j.profile || '') };
}
async function winRead(file, lang, scale, timeout) {
  const r = await run(POWERSHELL, PS_ARGS.concat([file, lang, String(scale)]), { timeout });
  if (r.spawnError) return { ok: false, why: 'Windows PowerShell could not be started: ' + r.spawnError };
  if (r.timedOut) return { ok: false, why: 'the text took too long to read (over ' + Math.round(timeout / 1000) + ' s)' };
  const j = lastJson(r.out);
  if (!j) return { ok: false, why: 'Windows\' text reader gave no answer: ' + (firstLine(r.err) || firstLine(r.out) || 'exit ' + r.code) };
  if (!j.ok) return { ok: false, why: oneLine(j.why) || 'the text could not be read' };
  return { ok: true, lines: tidy(j.lines), lang: String(j.lang || lang), scale: Number(j.scale) || 1,
           angle: j.angle == null ? undefined : Number(j.angle) };
}

// ---- Tesseract ----------------------------------------------------------------------------------------------
// BCP-47 tags <-> Tesseract's codes: the Linux host's table (kOcrTessLangs), so a tag means the same reader there and here.
const TESS_LANGS = [
  ['eng', 'en'], ['jpn', 'ja'], ['chi_sim', 'zh-Hans'], ['chi_tra', 'zh-Hant'], ['kor', 'ko'], ['rus', 'ru'],
  ['deu', 'de'], ['fra', 'fr'], ['spa', 'es'], ['por', 'pt'], ['ita', 'it'], ['nld', 'nl'], ['pol', 'pl'],
  ['tur', 'tr'], ['ukr', 'uk'], ['ara', 'ar'], ['heb', 'he'], ['hin', 'hi'], ['tha', 'th'], ['vie', 'vi'],
  ['ell', 'el'], ['ces', 'cs'], ['dan', 'da'], ['fin', 'fi'], ['nor', 'nb'], ['swe', 'sv'], ['hun', 'hu'],
  ['ron', 'ro'], ['slk', 'sk'], ['slv', 'sl'], ['bul', 'bg'], ['hrv', 'hr'], ['srp', 'sr-Cyrl'],
  ['srp_latn', 'sr-Latn'], ['ind', 'id'], ['msa', 'ms'], ['fas', 'fa'], ['ben', 'bn'], ['tam', 'ta'],
  ['tel', 'te'], ['urd', 'ur'], ['est', 'et'], ['lav', 'lv'], ['lit', 'lt'], ['cat', 'ca'], ['fil', 'fil'],
];
const tagOf = (code) => { const e = TESS_LANGS.find((l) => l[0] === code); return e ? e[1] : code; };
// The script a tag names where one language is written two ways (the hosts' OcrScript).
function scriptOf(t) {
  if (t.startsWith('zh')) return /-(hant|tw|hk|mo)/.test(t) ? 'hant' : 'hans';
  if (t.startsWith('sr')) return t.includes('-latn') ? 'latn' : 'cyrl';
  return '';
}
// Which of these tags reads `want` (the hosts' OcrPick): exact, then a regional form of it, then the same language
// and script from another region ("en-US" -> "en"). -1 for none.
function pickTag(tags, want) {
  const w = String(want).toLowerCase(), primary = w.split('-')[0], script = scriptOf(w);
  let regional = -1, same = -1;
  for (let i = 0; i < tags.length; i++) {
    const t = String(tags[i]).toLowerCase();
    if (t === w) return i;
    if (regional < 0 && t.startsWith(w + '-')) regional = i;
    if (same < 0 && t.split('-')[0] === primary && scriptOf(t) === script) same = i;
  }
  return regional >= 0 ? regional : same;
}
// The Tesseract language to read `want` in, among the codes installed: a code (or codes joined by +) named as
// such, else the tag's own, else English, else whatever is there -- and the answer's `lang` says which it was.
function tessLang(codes, want) {
  const parts = String(want).split('+');
  if (parts.every((p) => codes.includes(p))) return { code: String(want), tag: tagOf(parts[0]) };
  const tags = codes.map(tagOf), i = pickTag(tags, want);
  if (i >= 0) return { code: codes[i], tag: tags[i] };
  const fallback = codes.includes('eng') ? 'eng' : codes[0];
  return { code: fallback, tag: tagOf(fallback) };
}
// `tesseract --list-langs`, as the Linux host reads it: the codes after the heading, not the orientation model (osd),
// the equations one or the vertical layouts. Tesseract 3 printed the list on stderr, so both are read.
function listLangs(text) {
  const codes = [];
  let listing = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/List of available languages/.test(line)) { listing = true; continue; }
    if (!listing || !line || /\s/.test(line)) continue;
    if (line === 'osd' || line === 'equ' || line.includes('_vert')) continue;
    if (!codes.includes(line)) codes.push(line);
  }
  return codes;
}
async function tessProbe() {
  const bin = tesseractBin();
  const r = await run(bin, ['--list-langs'], { timeout: 10000 });
  if (r.spawnError === 'ENOENT') return { ok: false, why: 'Tesseract is not installed on this machine (no `' + bin + '` to run)' };
  if (r.spawnError) return { ok: false, why: 'Tesseract could not be started: ' + r.spawnError };
  if (r.timedOut) return { ok: false, retry: true, why: 'Tesseract did not list its languages within 10 s' };
  const codes = listLangs(r.out + '\n' + r.err);
  if (!codes.length) return { ok: false, why: r.code ? 'Tesseract did not answer: ' + (firstLine(r.err) || firstLine(r.out) || 'exit ' + r.code) : 'Tesseract on this machine has no language installed' };
  return { ok: true, codes };
}

// The TSV: level page block par line word left top width height conf text. Words (level 5) grouped by block,
// paragraph and line, in Tesseract's order, boxes divided back to the picture's own pixels. A word under
// confidence 15 is Tesseract guessing at a picture -- an icon, a rule -- not text (the Linux host's kOcrMinConf).
function tsvLines(tsv, kx, ky) {
  const sx = kx || 1, sy = ky || sx, lines = [];
  let key = null;
  for (const raw of String(tsv || '').split('\n')) {
    const c = raw.replace(/\r$/, '').split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c[11].replace(/[ \t]+$/, '');
    const conf = Number(c[10]);
    if (!text || !(conf >= 15)) continue;
    const k = c[2] + '/' + c[3] + '/' + c[4];
    if (k !== key) { lines.push([]); key = k; }
    lines[lines.length - 1].push({ text, conf, x: Math.round(Number(c[6]) / sx), y: Math.round(Number(c[7]) / sy),
                                   w: Math.round(Number(c[8]) / sx), h: Math.round(Number(c[9]) / sy) });
  }
  // AN ICON BEFORE A LINE'S WORDS, dropped as the Linux host drops it: a line's first word of one or two letters, no
  // digit, Tesseract unsure of it (under 60), as tall as half the line, and set apart by over 0.6 of the line's
  // height (a menu's lock icon read as "iy" at 47; a size's "3" at 48 stays).
  for (const ws of lines) {
    if (ws.length < 2) continue;
    const lh = Math.max(...ws.map((b) => b.h)), f = ws[0], gap = ws[1].x - (f.x + f.w);
    if ([...f.text].length <= 2 && !/[0-9]/.test(f.text) && f.conf < 60 && f.h * 2 >= lh && gap * 10 > lh * 6) ws.shift();
  }
  return lines.map((ws) => ({ t: ws.map((b) => b.text).join(' '), w: ws.map((b) => [b.text, b.x, b.y, b.w, b.h]) }));
}

// A decoded picture in grey (the Linux host's weights), and whether it was turned over: a region darker than
// 110 on average is light text on a dark ground, and Tesseract 4 reads that at 10-51% as it is and 100% turned
// over (measured on the Linux host; see its kOcrDarkMean).
function grey(img) {
  const { w, h } = img, g = new Uint8Array(w * h);
  let sum = 0;
  for (let y = 0; y < h; y++) {
    let i = y * img.stride;
    for (let x = 0; x < w; x++, i += img.bpp) { const v = ((img.px[i] * 299 + img.px[i + 1] * 587 + img.px[i + 2] * 114) / 1000) | 0; g[y * w + x] = v; sum += v; }
  }
  const dark = sum < w * h * 110;
  if (dark) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
  return { g, w, h, dark };
}
// Bicubic (Catmull-Rom), separable: what the Linux host's SWS_BICUBIC does to a region before Tesseract sees it.
// Enlarging only -- a shrink would alias with four taps, and nothing here shrinks.
function enlarge(src, w, h, ow, oh) {
  const cub = (t) => { t = Math.abs(t); return t <= 1 ? (1.5 * t - 2.5) * t * t + 1 : t < 2 ? ((-0.5 * t + 2.5) * t - 4) * t + 2 : 0; };
  const taps = (n, on) => {
    const idx = new Int32Array(on * 4), wt = new Float32Array(on * 4);
    for (let o = 0; o < on; o++) {
      const s = (o + 0.5) * n / on - 0.5, i0 = Math.floor(s), f = s - i0;
      for (let k = 0; k < 4; k++) { idx[o * 4 + k] = Math.min(n - 1, Math.max(0, i0 - 1 + k)); wt[o * 4 + k] = cub(f - (k - 1)); }
    }
    return { idx, wt };
  };
  const X = taps(w, ow), Y = taps(h, oh), mid = new Float32Array(ow * h), out = new Uint8Array(ow * oh);
  for (let y = 0; y < h; y++) for (let x = 0; x < ow; x++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += src[y * w + X.idx[x * 4 + k]] * X.wt[x * 4 + k];
    mid[y * ow + x] = v;
  }
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += mid[Y.idx[y * 4 + k] * ow + x] * Y.wt[y * 4 + k];
    out[y * ow + x] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  return out;
}
// THE GROUND EVENED OUT -- the Linux host's ocrEvenGround, line for line. Tesseract finds lines in a picture it has
// made black and white, and on a screen that loses a label on a filled box (a default button, a selected row) and
// one inside a drawn border; the host measured Chrome's "Cancel" and "Delete" never read without this. Every pixel
// becomes its distance from the ground around it: the commonest level of its 8x8 block, the median of the 5x5
// blocks around that, blended between blocks -- dark on white whichever way round it was drawn.
function evenGround(g, w, h) {
  const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const lvl = new Float32Array(bw * bh), bg = new Float32Array(bw * bh), n = new Uint32Array(16), s = new Float64Array(16);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    n.fill(0); s.fill(0);
    const y1 = Math.min(h, by * B + B), x1 = Math.min(w, bx * B + B);
    for (let y = by * B; y < y1; y++) for (let x = bx * B; x < x1; x++) { const v = g[y * w + x]; n[v >> 4]++; s[v >> 4] += v; }
    let k = 0;
    for (let i = 1; i < 16; i++) if (n[i] > n[k]) k = i;   // text is thin: the ground is what most pixels are
    lvl[by * bw + bx] = s[k] / n[k];
  }
  const a = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    a.length = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const x = bx + i, y = by + j;
      if (x >= 0 && y >= 0 && x < bw && y < bh) a.push(lvl[y * bw + x]);
    }
    a.sort((p, q) => p - q);                                 // a block that is all letter cannot pull the ground over
    bg[by * bw + bx] = a[a.length >> 1];
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) / B - 0.5, 0), bh - 1), y0 = fy | 0, y1 = Math.min(bh - 1, y0 + 1), ay = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) / B - 0.5, 0), bw - 1), x0 = fx | 0, x1 = Math.min(bw - 1, x0 + 1), ax = fx - x0;
      const b = (bg[y0 * bw + x0] * (1 - ax) + bg[y0 * bw + x1] * ax) * (1 - ay) + (bg[y1 * bw + x0] * (1 - ax) + bg[y1 * bw + x1] * ax) * ay;
      const v = Math.round(255 - Math.abs(g[y * w + x] - b));
      g[y * w + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return g;
}
// What Tesseract is handed, as the Linux host makes it: grey, turned over if dark, enlarged by k, ground evened.
function tessPicture(img, k) {
  const G = grey(img);
  const ow = Math.max(1, Math.round(G.w * k)), oh = Math.max(1, Math.round(G.h * k));
  const big = (ow === G.w && oh === G.h) ? G.g : enlarge(G.g, G.w, G.h, ow, oh);
  evenGround(big, ow, oh);
  return { g: big, w: ow, h: oh, kx: ow / G.w, ky: oh / G.h, dark: G.dark };
}
async function tessRead(file, lang, scale, timeout, codes) {
  const pick = tessLang(codes, lang);
  let img = null;
  try { img = eyes.decode(fs.readFileSync(file)); } catch (_) { img = null; }
  // A PNG agent-eyes cannot decode (palette, 16-bit, interlaced) goes to Tesseract as it is, at 1:1.
  const whole = img && img.ready && img.rows >= img.h && img.w > 0 && img.h > 0;
  let tmp = null, kx = 1, ky = 1, dark = false;
  try {
    let input = file;
    if (whole) {
      const p = tessPicture(img, scale);
      tmp = tempFile('.pgm', Buffer.concat([Buffer.from('P5\n' + p.w + ' ' + p.h + '\n255\n', 'ascii'), Buffer.from(p.g.buffer, p.g.byteOffset, p.g.length)]));
      input = tmp; kx = p.kx; ky = p.ky; dark = p.dark;
    }
    // One thread (OMP_THREAD_LIMIT=1: measured faster on the host for a picture this size); psm 3, the automatic
    // layout; the dpi the scaled text is drawn at, so its size estimate is not a guess.
    const env = Object.assign({}, process.env, { OMP_THREAD_LIMIT: '1' });
    const r = await run(tesseractBin(), [input, 'stdout', '-l', pick.code, '--psm', '3', '--dpi', String(Math.round(96 * kx)), 'tsv'], { timeout, env });
    if (r.spawnError) return { ok: false, why: 'Tesseract could not be started: ' + r.spawnError };
    if (r.timedOut) return { ok: false, why: 'the text took too long to read (over ' + Math.round(timeout / 1000) + ' s)' };
    if (r.code !== 0) return { ok: false, why: 'Tesseract could not read it: ' + (firstLine(r.err) || firstLine(r.out) || 'exit ' + r.code) };
    return { ok: true, lines: tsvLines(r.out, kx, ky), lang: pick.tag, scale: whole ? scale : 1, inverted: dark };
  } finally { drop(tmp); }
}

// ---- which engines there are ----------------------------------------------------------------------------------
// Asked once per process, both at once, and kept -- unless one of them only ran out of time, which says nothing
// about whether it is there, so the next call asks again.
let probing = null;
function probeAll() {
  if (!probing) {
    probing = Promise.all([winProbe().catch((e) => ({ ok: false, why: String(e && e.message || e) })),
                           tessProbe().catch((e) => ({ ok: false, why: String(e && e.message || e) }))])
      .then(([windows, tesseract]) => {
        if (windows.retry || tesseract.retry) probing = null;
        return { windows, tesseract };
      });
  }
  return probing;
}
// ['windows', 'tesseract'], or fewer: the local engines that answered.
async function engines() {
  try { const info = await probeAll(); return ENGINES.filter((n) => info[n].ok); } catch (_) { return []; }
}
// The engine to read with: the one named, or the first there is. {name} or {ok:false, why}.
async function choose(named) {
  const info = await probeAll();
  if (named != null && named !== '') {
    const n = String(named).toLowerCase().replace(/^local:/, '');
    if (!ENGINES.includes(n)) return { ok: false, why: 'there is no text reader called "' + named + '" (there are: ' + ENGINES.join(', ') + ')' };
    return info[n].ok ? { name: n, info } : { ok: false, why: info[n].why };
  }
  const n = ENGINES.find((e) => info[e].ok);
  if (n) return { name: n, info };
  return { ok: false, why: 'no text reader on this machine: ' + ENGINES.map((e) => info[e].why).join('; ') };
}
const okLang = (s) => /^[A-Za-z][A-Za-z0-9_+-]{0,63}$/.test(s);   // a tag or a code -- never something a program takes for a switch
const scaleOf = (v) => { const k = Number(v); return Number.isFinite(k) && k > 0 ? Math.min(MAX_SCALE, Math.max(1, k)) : 1; };
const sig4 = (k) => Number(Number(k).toPrecision(4));                 // as the hosts print it (%.4g)

// How much bigger to read a w x h region: the hosts' own rule (OcrScaleFor / ocrScaleFor) -- 2x, eased down so the
// enlarged picture stays under ~10 MP (Tesseract: ~8 MP), never below 1x. Windows also caps the long side at its
// recognizer's MaxImageDimension (local-ocr.ps1 does that, and reports the scale it really used).
function autoScale(w, h, engine) {
  const max = engine === 'tesseract' ? 8.0e6 : 10.0e6;
  return Math.min(2, Math.max(1, Math.sqrt(max / (Math.max(1, w) * Math.max(1, h)))));
}

// ---- the two calls -------------------------------------------------------------------------------------------
// Read the words in a PNG file. opts: lang (BCP-47, default en-US; a Tesseract code works too), timeout (ms, 20 s),
// scale (1-4: read it that much bigger first; boxes still come back in the PNG's own pixels), engine ('windows' |
// 'tesseract'; the first there is otherwise). -> {ok:true, lines:[{t, w:[[word,x,y,w,h],...]}], engine, lang, ms,
// scale[, angle | inverted]} -- `ms` is the whole read, the engine's process included -- or {ok:false, why}.
async function read(pngPath, opts) {
  const t0 = Date.now();
  try {
    const o = opts || {};
    const lang = o.lang == null || String(o.lang).trim() === '' ? 'en-US' : String(o.lang).trim();
    if (!okLang(lang)) return { ok: false, why: 'that is not a language tag: ' + lang };
    const timeout = Number(o.timeout) > 0 ? Number(o.timeout) : TIMEOUT;
    if (pngPath == null || String(pngPath) === '') return { ok: false, why: 'no picture was named' };
    const file = path.resolve(String(pngPath));
    let st = null;
    try { st = fs.statSync(file); } catch (_) { st = null; }
    if (!st || !st.isFile()) return { ok: false, why: 'there is no picture at ' + file };
    const c = await choose(o.engine);
    if (!c.name) return c;
    const k = scaleOf(o.scale);
    const r = c.name === 'windows' ? await winRead(file, lang, k, timeout) : await tessRead(file, lang, k, timeout, c.info.tesseract.codes);
    if (!r.ok) return { ok: false, why: r.why };
    const out = { ok: true, lines: r.lines, engine: c.name, lang: r.lang, ms: Date.now() - t0, scale: sig4(r.scale) };
    if (r.angle != null && Number.isFinite(r.angle)) out.angle = r.angle;
    if (r.inverted) out.inverted = true;
    return out;
  } catch (e) {
    return { ok: false, why: 'the text could not be read: ' + String(e && e.message || e) };
  }
}

// The region of a decoded picture as an RGB PNG, at 1:1 (the engine enlarges it: Windows' decoder in the same
// pass, cubic, as the host's WIC does; Tesseract's picture in grey, as the Linux host does).
function regionPng(img, x, y, w, h) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let r = 0; r < h; r++) {
    const s = (y + r) * img.stride + x * img.bpp, d = r * w * 3;
    if (img.bpp === 3) { img.px.copy(rgb, d, s, s + w * 3); continue; }
    for (let i = 0; i < w; i++) { rgb[d + i * 3] = img.px[s + i * img.bpp]; rgb[d + i * 3 + 1] = img.px[s + i * img.bpp + 1]; rgb[d + i * 3 + 2] = img.px[s + i * img.bpp + 2]; }
  }
  return encodePng(w, h, rgb);
}

// Read the words in a rectangle of a decoded picture (agent-eyes `decode`), clamped to it exactly as the hosts
// clamp a shot-ocr region -- and answer EXACTLY the host's `ocr` object: {lang, ms, scale, x, y, w, h[, angle |
// inverted], lines (boxes RELATIVE TO THE CLAMPED REGION), engine:'local:<name>'}, or {ok:false, why}. No rect (or
// one with no width or height) is the whole picture. opts as read(); `scale` unset is the hosts' rule (autoScale).
async function readRegion(img, rect, opts) {
  const t0 = Date.now();
  let tmp = null;
  try {
    const o = opts || {};
    if (!img || !img.ready || !img.px || !(img.w > 0) || !(img.h > 0)) return { ok: false, why: 'there is no decoded picture to read' };
    const W = img.w, H = img.h;
    let x = 0, y = 0, w = W, h = H;
    // Whole pixels first, as the client sends them (readText rounds) -- the host then sees a width of 0 as no region.
    if (rect && int(rect.w) > 0 && int(rect.h) > 0) {
      x = Math.min(W, Math.max(0, int(rect.x)));
      y = Math.min(H, Math.max(0, int(rect.y)));
      w = Math.min(int(rect.w), W - x);
      h = Math.min(int(rect.h), H - y);
    }
    if (w < 1 || h < 1) return { ok: false, why: 'the region is empty' };
    // A picture still arriving is true only down to `rows`: a region below that has not been seen, and reading
    // the part that has would answer for less than was asked. The caller fetches more (agent-join's `see`).
    if (y + h > (img.rows == null ? H : img.rows)) return { ok: false, why: 'the picture is decoded down to row ' + img.rows + ' only and the region reaches row ' + (y + h) + ' -- fetch more of it first' };
    const c = await choose(o.engine);
    if (!c.name) return c;
    const k = o.scale == null ? autoScale(w, h, c.name) : scaleOf(o.scale);
    tmp = tempFile('.png', regionPng(img, x, y, w, h));
    const r = await read(tmp, Object.assign({}, o, { engine: c.name, scale: k }));
    if (!r.ok) return { ok: false, why: r.why };
    const out = { lang: r.lang, ms: Date.now() - t0, scale: r.scale, x, y, w, h };
    if (r.angle != null) out.angle = r.angle;
    if (r.inverted) out.inverted = true;
    out.lines = r.lines;
    out.engine = 'local:' + r.engine;
    return out;
  } catch (e) {
    return { ok: false, why: 'the text could not be read: ' + String(e && e.message || e) };
  } finally { drop(tmp); }
}

module.exports = {
  engines, read, readRegion, autoScale,
  // the pure pieces, for tests/local_ocr.js
  tsvLines, listLangs, tessLang, pickTag, grey, enlarge, evenGround, tessPicture, regionPng,
};

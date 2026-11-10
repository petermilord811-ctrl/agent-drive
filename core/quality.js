'use strict';
// @tool the picture-quality check: stress phases planned, the diagnostics trace recorded on the agent's own socket, each phase judged and the causes named (and a before/after compare)
// @run  node core/quality.js <run.ndjson> [--compare <earlier.ndjson>] [--json]   (the serve runs it as the `quality` verb)
// quality -- WHY DOES THE PICTURE LOOK BAD? ASKED OF THE MACHINE, NOT ARGUED FROM THE SOURCE.
//
// ScreenMirror already measures every stage of a frame's trip: the host, the relay and a viewer each write one
// record a second into the diagnostics trace, each with a VERDICT -- what limited quality (qwhy), speed (swhy),
// input (iwhy), what the relay did (why). But a trace is recorded by hand (Ctrl+K in the console), over whatever
// the screen happened to be doing, and read with tools/trace-report.js afterwards. So "the text is blurry when I
// scroll" was a session somebody had to reproduce, record, save and read -- and a second of a still desktop
// averaged with a second of video says nothing about either.
//
// This makes it one command an agent runs on a machine it was let onto:
//   1. ARM the trace on the agent's OWN socket (the relay lets a grant send `trace`, and tells the host the OR of
//      everyone watching -- so an operator's own recording is never switched off by this one ending);
//   2. put the screen through named STRESSES, one phase each: the screen as it is, a test card's still text, the
//      same text scrolling, a window dragged over it, full-screen video-like motion, scene cuts, the card still
//      again (does the picture recover?), the pointer moving -- the things that make a remote picture look worse;
//   3. RECORD what the host and the relay say each second, plus the agent's own arrival record (c:'a'): frames,
//      bytes and keyframes as they reached it, the gaps between them, how far behind live they were (from the
//      frame's own timestamp, the way the console measures it) and the pointer's round trip;
//   4. JUDGE each phase on its own seconds and name the CAUSES -- each with the numbers behind it, where it lives
//      (the link, the machine, a watcher's window, a setting, the codec's own behaviour) and the one change worth
//      making -- then ONE verdict: the main cause, and what to do first;
//   5. and COMPARE a run with an earlier one, phase by phase, so a change -- a setting, a host update, a code
//      fix -- is shown to have made the picture better rather than assumed to.
//
// The file the check writes is an ordinary trace (NDJSON), so `node tools/trace-report.js <file> --phase scroll`
// in ScreenMirror reads any phase of it with every section of the full report.
//
// What this module is: PURE. No socket, no host. plan() decides the phases from what the visit was granted,
// Recorder turns what arrives into records, analyze() and compare() read records, cardScript() writes the test
// card. core/agent-join.js does the I/O. tests/quality.js drives all of it offline.

// ---- the phases ----------------------------------------------------------------------------------------------
// `needs`: the consent a phase cannot run without. The card is a small program put on the screen through exec --
// the visit's run-commands consent -- so the five card scenes need `shell` (and Windows); the pointer and the wheel
// need the keyboard-and-mouse consent; the still phases need nothing but watching.
const KINDS = {
  idle:    { needs: '',        secs: 8,  card: false, still: true,  what: 'hands off: the screen as it is (the baseline)' },
  watch:   { needs: '',        secs: 20, card: false, still: false, what: 'hands off while a person at the machine does what looks bad' },
  pointer: { needs: 'control', secs: 8,  card: false, still: true,  what: 'the pointer moved in circles (the input loop and the cursor coming back)' },
  wheel:   { needs: 'control', secs: 10, card: false, still: false, what: 'the mouse wheel down and back up at a point (a real page scrolling)' },
  text:    { needs: 'shell',   secs: 8,  card: true,  still: true,  what: 'the test card standing still: small text, coloured text, hairlines (sharpness at rest)' },
  scroll:  { needs: 'shell',   secs: 10, card: true,  still: false, what: 'the card\'s text scrolling (text in motion)' },
  drag:    { needs: 'shell',   secs: 10, card: true,  still: false, what: 'a window dragged around over text' },
  video:   { needs: 'shell',   secs: 10, card: true,  still: false, what: 'full-screen moving colour and grain (the encoder\'s worst case)' },
  cuts:    { needs: 'shell',   secs: 8,  card: true,  still: false, what: 'the whole picture changing two or three times a second (scene cuts)' },
  rest:    { needs: 'shell',   secs: 8,  card: true,  still: true,  what: 'the card still again (does the picture come back after the load?)' },
};
const CARD_ORDER = ['text', 'scroll', 'drag', 'video', 'cuts', 'rest'];
// the card's scenes it draws CONTINUOUSLY -- whose frame rate is therefore the card's to report (cuts change 2.5 times a
// second by design, and the still scenes once)
const CARD_MOVING = new Set(['scroll', 'drag', 'video']);
const MAX_TOTAL_S = 300;

// The phases to run. `spec` is what the command asked for (a list of names, or of {name, secs}; nothing = the
// whole suite this visit can run). `can` = {control, shell, windows}; windows: false refuses the card, null = not
// known yet (the caller probes the OS once the card is wanted). `secs` scales every phase's default length.
// -> {ok, phases:[{name, secs}], card:{plan, secs}|null, skipped:[{name, why}]}  or  {ok:false, why}
function plan(spec, can, secs) {
  can = can || {};
  const scale = Number(secs) > 0 ? Math.max(0.5, Math.min(3, Number(secs) / 10)) : 1;
  const skipped = [];
  let list;
  if (spec == null || (Array.isArray(spec) && !spec.length)) {
    // THE DEFAULT SUITE is everything this visit may run, never a refusal: a watch-only visit still gets its
    // baseline, and says which phases it left out and the consent that would add them.
    list = ['idle'];
    if (can.shell && can.windows !== false) list = list.concat(CARD_ORDER);
    else skipped.push({ name: CARD_ORDER.join(', '), why: can.shell ? 'the test card runs on Windows only' : 'needs the run-commands consent (the test card is put on the screen through exec): access {shell:1}' });
    if (can.control) list.push('pointer');
    else skipped.push({ name: 'pointer', why: 'needs the keyboard-and-mouse consent: access {control:1}' });
    list = list.map((n) => ({ name: n }));
  } else {
    if (!Array.isArray(spec)) spec = [spec];
    list = [];
    for (const it of spec) {
      const o = typeof it === 'string' ? { name: it } : (it && typeof it === 'object' ? it : null);
      const name = o && typeof o.name === 'string' ? o.name.trim().toLowerCase() : '';
      const k = KINDS[name];
      if (!k) return { ok: false, why: 'no phase "' + (o && o.name) + '" -- the phases: ' + Object.keys(KINDS).join(', ') };
      if (k.needs === 'control' && !can.control) return { ok: false, why: 'phase "' + name + '" needs the keyboard-and-mouse consent -- ask: {"do":"access","control":1,"why":"..."}', needs: 'control' };
      if (k.needs === 'shell' && !can.shell) return { ok: false, why: 'phase "' + name + '" puts a test card on the screen through exec, which needs the run-commands consent -- ask: {"do":"access","shell":1,"why":"..."}', needs: 'shell' };
      if (k.card && can.windows === false) return { ok: false, why: 'phase "' + name + '" is a test-card scene, and the test card runs on Windows only' };
      list.push({ name, secs: o.secs });
    }
  }
  const phases = list.map((p) => {
    const k = KINDS[p.name];
    const s = Number(p.secs) > 0 ? Number(p.secs) : k.secs * scale;
    return { name: p.name, secs: Math.round(Math.max(4, Math.min(120, s)) * 10) / 10 };
  });
  // The card is ONE program with one schedule, so its scenes must run back to back: a non-card phase between two
  // scenes would leave the card's clock and the agent's apart.
  const idx = phases.map((p, i) => (KINDS[p.name].card ? i : -1)).filter((i) => i >= 0);
  if (idx.length && idx[idx.length - 1] - idx[0] !== idx.length - 1) {
    return { ok: false, why: 'the test-card scenes (' + CARD_ORDER.join(', ') + ') must run one after another -- put the other phases before or after them' };
  }
  const total = phases.reduce((s, p) => s + p.secs, 0);
  if (total > MAX_TOTAL_S) return { ok: false, why: 'that is ' + Math.round(total) + ' s of phases -- a check runs at most ' + MAX_TOTAL_S + ' s' };
  const cardPh = phases.filter((p) => KINDS[p.name].card);
  const card = cardPh.length ? { plan: cardPh.map((p) => p.name + ':' + p.secs).join(','), secs: cardPh.reduce((s, p) => s + p.secs, 0), first: idx[0] } : null;
  return { ok: true, phases, card, skipped, total: Math.round(total) };
}

// ---- the recorder ---------------------------------------------------------------------------------------------
// The video frame's wire header (viewer.html onBinary, the host's SendFrame): 20 bytes, little-endian --
// u32 magic "SMV1", u32 flags (bit 0 keyframe, bits 8-15 codec: 0 H.264, 1 tile1, 2/3 audio, bits 16-23 monitor),
// i64 pts in 100 ns of the HOST's clock, u32 reserved. Nothing here decodes a picture: the header is all an
// arrival record needs.
const MAGIC = 0x31564d53, HEADER = 20;
// "Behind live" exactly as the console computes it (viewer.html onBinary): arrival minus pts is a constant offset
// plus whatever latency has built up, so its GROWTH above the best ever seen is the standing delay. The baseline
// creeps up 0.5 ms a second (the two clocks drift apart) and a jump of 10 s between consecutive frames is a host
// that restarted its clock, not ten seconds of queue.
const DRIFT_CREEP_PER_MS = 0.5 / 1000, DRIFT_JUMP_MS = 10000;
// A cursor position comes back quantised to 1e-4; ~1.5 px on a 1080-row screen is "the same place".
const RTT_EPS = 0.0015;

function pct(arr, f) {
  if (!arr || !arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.max(0, Math.min(a.length - 1, Math.round(f * (a.length - 1))))];
}
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

class Recorder {
  constructor(now) {
    this.t0 = now;
    this.recs = [];
    this.seq = 0;
    this.seen = { h: 0, r: 0, frames: 0, cursor: 0 };
    this.minDrift = Infinity; this.lastDrift = null; this.lastDriftAt = 0; this.lastArrive = 0;
    this.moves = [];
    this._second();
  }
  _second() { this.sec = { fr: 0, kf: 0, by: 0, gaps: [], exc: [], rtt: [], mv: 0, mvdrop: 0 }; }
  t(now) { return Math.max(0, Math.round(now - this.t0)); }
  meta(o) { this.recs.unshift(Object.assign({ c: 'meta' }, o, { t: 0 })); }
  // A text message from the relay. Host and relay trace records are kept as they came (less their `type`) and
  // stamped with THIS clock on arrival, so all three streams share one timeline -- the console does the same.
  text(m, now) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'trace' && (m.c === 'h' || m.c === 'r')) {
      const r = Object.assign({}, m); delete r.type; r.t = this.t(now);
      this.recs.push(r); this.seen[m.c]++;
      return;
    }
    // The pointer's round trip with no protocol change (the console's trNoteCursorBack): remember where and when a
    // move was sent; a cursor update at a position that was sent closes the loop. Newest first, because the host
    // injects the newest point of a batch and drops the rest -- and everything older than the match never landed.
    if (m.type === 'cursor' && m.visible !== false && typeof m.x === 'number' && typeof m.y === 'number') {
      this.seen.cursor++;
      while (this.moves.length && now - this.moves[0].t > 1500) { this.moves.shift(); this.sec.mvdrop++; }
      for (let i = this.moves.length - 1; i >= 0; i--) {
        const mv = this.moves[i];
        if (Math.abs(mv.x - m.x) < RTT_EPS && Math.abs(mv.y - m.y) < RTT_EPS) {
          this.sec.rtt.push(now - mv.t);
          this.sec.mvdrop += i;
          this.moves.splice(0, i + 1);
          return;
        }
      }
    }
  }
  noteMove(x, y, now) {
    this.sec.mv++;
    this.moves.push({ x, y, t: now });
    if (this.moves.length > 90) this.moves.shift();
  }
  // A binary frame as it arrived. Audio rides the same header and is not the picture.
  binary(buf, now) {
    if (!buf || buf.length < HEADER || buf.readUInt32LE(0) !== MAGIC) return;
    const flags = buf.readUInt32LE(4), codec = (flags >>> 8) & 0xff;
    if (codec === 2 || codec === 3) return;
    this.seen.frames++;
    const s = this.sec;
    s.fr++; s.by += buf.length - HEADER; if (flags & 1) s.kf++;
    if (this.lastArrive) s.gaps.push(now - this.lastArrive);
    this.lastArrive = now;
    const drift = now - Number(buf.readBigInt64LE(8)) / 10000;
    const elapsed = this.lastDriftAt ? now - this.lastDriftAt : 0;
    this.lastDriftAt = now;
    if (this.lastDrift !== null && drift - this.lastDrift > DRIFT_JUMP_MS) this.minDrift = Infinity;
    this.lastDrift = drift;
    this.minDrift = Math.min(drift, this.minDrift + elapsed * DRIFT_CREEP_PER_MS);
    s.exc.push(drift - this.minDrift);
  }
  // One arrival record a second -- the agent's counterpart of the console's c:'v' sample, named c:'a' because it
  // has no decoder, no paint and no queue: a report must never read it as a viewer that measured those.
  tick(now) {
    const s = this.sec;
    this.recs.push({ c: 'a', seq: ++this.seq, fr: s.fr, kf: s.kf, by: s.by,
                     gap50: r1(pct(s.gaps, 0.5)) || 0, gap95: r1(pct(s.gaps, 0.95)) || 0, gapmx: r1(s.gaps.length ? Math.max(...s.gaps) : 0),
                     exc50: Math.round(pct(s.exc, 0.5) || 0), exc95: Math.round(pct(s.exc, 0.95) || 0),
                     mv: s.mv, mvdrop: s.mvdrop, rttn: s.rtt.length, rtt50: r1(pct(s.rtt, 0.5)) || 0, rtt95: r1(pct(s.rtt, 0.95)) || 0,
                     t: this.t(now) });
    this._second();
  }
  phase(name, on, now, extra) {
    this.recs.push(Object.assign({ c: 'a', ev: 'phase', name, on: on ? 1 : 0 }, extra || {},
      { d: 'phase "' + name + '" ' + (on ? 'starts' + (extra && extra.secs ? ' (' + extra.secs + ' s)' : '') + (KINDS[name] ? ': ' + KINDS[name].what : '') : 'ends'), t: this.t(now) }));
  }
  event(ev, d, now, extra) { this.recs.push(Object.assign({ c: 'a', ev }, extra || {}, { d: String(d || ''), t: this.t(now) })); }
  records() { return this.recs.slice(); }
}
const ndjson = (recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
function parseNdjson(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch (_) {} }
  return out;
}

// ---- reading a run ---------------------------------------------------------------------------------------------
// A sample arrives at the END of the second it describes, so the first second of a phase still holds the stress
// before it (and a card scene can trail the agent's mark by a few hundred ms): PH_LEAD keeps those out, PH_LAG lets
// the phase's own last second in as it arrives late. tools/trace-report.js windows a phase by the same two numbers.
const PH_LEAD = 1200, PH_LAG = 300;
function phasesOf(recs) {
  const out = [], open = new Map();
  for (const r of recs) {
    if (r.ev !== 'phase' || typeof r.name !== 'string') continue;
    if (r.on) { open.set(r.name, { name: r.name, t0: r.t || 0, t1: null }); continue; }
    const p = open.get(r.name);
    if (p) { p.t1 = r.t || 0; out.push(p); open.delete(r.name); }
  }
  const tEnd = recs.reduce((m, r) => Math.max(m, r.t || 0), 0);
  for (const p of open.values()) { p.t1 = tEnd; p.cut = true; out.push(p); }
  return out.sort((a, b) => a.t0 - b.t0);
}
const inPhase = (p) => (r) => typeof r.t === 'number' && r.t > p.t0 + PH_LEAD && r.t <= p.t1 + PH_LAG;

const nums = (set, k, f) => set.map((r) => r[k]).filter((v) => typeof v === 'number' && Number.isFinite(v) && (!f || f(v)));
const med = (set, k, f) => pct(nums(set, k, f), 0.5);
const sum = (set, k) => nums(set, k).reduce((a, b) => a + b, 0);
const maxOf = (set, k) => { const v = nums(set, k); return v.length ? Math.max(...v) : null; };
const minOf = (set, k) => { const v = nums(set, k); return v.length ? Math.min(...v) : null; };
function hist(set, k) {
  if (!set.some((r) => r[k] !== undefined)) return null;   // NOT REPORTED by this build: never read as "none"
  const m = {};
  for (const r of set) { const v = r[k] || 'none'; m[v] = (m[v] || 0) + 1; }
  return m;
}
// the last value a host reported for a string field: '' is a value (a hardware encoder's empty reason), absent is null
const lastStr = (set, k) => { for (let i = set.length - 1; i >= 0; i--) if (typeof set[i][k] === 'string') return set[i][k]; return null; };
const share = (h, name, n) => (h && n ? (h[name] || 0) / n : 0);
const topOf = (h) => { if (!h) return null; let best = null; for (const [k, v] of Object.entries(h)) if (!best || v > best[1]) best = [k, v]; return best ? best[0] : null; };
const kbps = (bits) => (bits == null ? '—' : bits >= 1e6 ? (bits / 1e6).toFixed(1) + ' Mb/s' : Math.round(bits / 1e3) + ' kb/s');

function phaseStats(p, H, R, A) {
  const f = inPhase(p), h = H.filter(f), rr = R.filter(f), a = A.filter(f);
  const kind = KINDS[p.name] || null;
  const st = { name: p.name, t0: p.t0, t1: p.t1, secs: Math.round((p.t1 - p.t0) / 100) / 10, cut: !!p.cut,
               still: !!(kind && kind.still), card: !!(kind && kind.card),
               n: { host: h.length, relay: rr.length, agent: a.length } };
  if (h.length) {
    const by = sum(h, 'by'), kb = sum(h, 'kb');
    const wire = h.filter((r) => r.ms > 0 && typeof r.wire === 'number').map((r) => 100 * r.wire / r.ms);
    const rate = h.filter((r) => r.ms > 0 && typeof r.by === 'number').map((r) => r.by * 8000 / r.ms);
    const hw = nums(h, 'hw');
    st.host = {
      fr: med(h, 'fr'), fps: med(h, 'fps'), bitrate: pct(rate, 0.5), keyShare: by ? kb / by : null, kf: sum(h, 'kf'),
      scale: med(h, 'scale'), scaleMin: minOf(h, 'scale'), w: med(h, 'w'), h: med(h, 'h'),
      qp: med(h, 'qp', (v) => v > 0), qp95: pct(nums(h, 'qp', (v) => v > 0), 0.95), qpSeen: nums(h, 'qp', (v) => v > 0).length,
      bits: minOf(h, 'bits'), breq: maxOf(h, 'breq'), mode: topOf(hist(h, 'mode')),
      wire: pct(wire, 0.5), wireMax: wire.length ? Math.max(...wire) : null,
      enc95: med(h, 'enc95'), cap95: med(h, 'cap95'), hwEnc: hw.length ? hw[hw.length - 1] : null,
      // WHY software, and how the screen is captured (tools/TRACE.md: hwwhy hwhr encn capm; absent on hosts before
      // them). Read from the last record that has them, as hwEnc is: hwWhy '' is a hardware encoder, null not reported
      hwWhy: lastStr(h, 'hwwhy'), hwHr: lastStr(h, 'hwhr'), encName: lastStr(h, 'encn') || null, capMode: lastStr(h, 'capm') || null,
      // the keyframe REQUESTS the host spent (kreq): a viewer joining or resyncing, a relay backlog drop
      kreq: sum(h, 'kreq'), kreqSeen: h.some((r) => typeof r.kreq === 'number'),
      // A WATCHER'S PICTURE-QUALITY CAP (host 1.57.0: top, qcap). A console's View > Picture quality caps the rate at
      // floor + cap x (ceiling - floor) -- Normal 600, Speed 350 -- for EVERYONE watching (the last console to send it
      // sets it). Null on a host before them: then analyze() may still recognise one exactly (see inferCap).
      qcap: med(h, 'qcap'), top: med(h, 'top', (v) => v > 0), rateMax: maxOf(h, 'rate'),
      // ...and whose quantiser qp is (host 1.57.0): "mft" the encoder's own, "slice" read from the slice headers
      qpSrc: lastStr(h, 'qpsrc'),
      // ...and the quantiser the viewer's picture-quality mode HOLDS every frame at (host 1.58.0: Best 6, Normal 20,
      // Speed 32; 0 = the rate controller decides). Under a hold the rate causes cannot coarsen the picture: a busy
      // screen pays in frame rate, which the frame-rate causes still read.
      qhold: med(h, 'qhold', (v) => v > 0),
      drop: sum(h, 'drop'), stall: sum(h, 'stall'), rsk: sum(h, 'rsk'), rc: sum(h, 'rc'), gop: med(h, 'gop', (v) => v > 0),
      rate: med(h, 'rate', (v) => v > 0), link: med(h, 'link', (v) => v > 0), gp: med(h, 'gp', (v) => v > 0),
      refine: sum(h, 'refine'), rebuild: sum(h, 'rebuild'), ished: sum(h, 'ished'), wsmv: sum(h, 'wsmv'), uinj: sum(h, 'uinj'),
      quality: hist(h, 'qwhy'), speed: hist(h, 'swhy'), input: hist(h, 'iwhy'),
      qval: med(h, 'qval'),
      // the quantiser's PATH through the phase, not only its middle: a still screen refining from 49 to 31 has a median
      // of 42 and is recovering, which is a different finding from one that sits at 42 (measured, 2026-11-09)
      qpFirst: (h.find((r) => r.qp > 0) || {}).qp || null, qpLast: (h.slice().reverse().find((r) => r.qp > 0) || {}).qp || null,
      frames: sum(h, 'fr'), bytes: by,
    };
    // NO QUANTISER IS NOT A FINE ONE. A hardware encoder may give the host no reading: on a real machine (2026-11-10)
    // Intel's Quick Sync MFT left qp at 0 -- "not measured" -- in every second, and this check called each phase sharp.
    st.host.qpUnmeasured = st.host.mode !== 'tile1' && st.host.qpSeen === 0 && st.host.frames > 0;
    // the data each frame got, and per pixel: the measure of a moving picture that is left when the quantiser is not
    st.host.kbPerFrame = st.host.frames > 0 ? by * 8 / st.host.frames / 1000 : null;
    st.host.bppf = st.host.frames > 0 && st.host.w > 0 && st.host.h > 0 ? by * 8 / (st.host.frames * st.host.w * st.host.h) : null;
  }
  if (rr.length) {
    // the relay's per-viewer rows mark the reader's own with me:1 -- which is how "the relay shed frames" is told
    // apart into "to this agent" (this machine's own downlink) and "to somebody else watching"
    let mine = 0, mineBl = 0, others = 0;
    // ...and the worst a VOTING watcher reported (its reading set the bar the host was given -- abrVoter in the relay),
    // with who it was: a rate held down for a watcher's congested link is the host protecting that watcher, not an ABR
    // that fails to rise (three of the first five live runs were that, 2026-11-10)
    let voterP = 0, voter = '';
    for (const r of rr) for (const row of Array.isArray(r.pv) ? r.pv : []) {
      if (row && row.me) { mine = Math.max(mine, Number(row.p) || 0); mineBl = Math.max(mineBl, Number(row.bl) || 0); }
      else if (row) {
        others = Math.max(others, Number(row.p) || 0);
        if (row.vote && (Number(row.p) || 0) > voterP) { voterP = Number(row.p) || 0; voter = String(row.who || row.tag || 'a watcher').slice(0, 48); }
      }
    }
    st.relay = { drop: sum(rr, 'drop'), bl95: maxOf(rr, 'bl95'), why: hist(rr, 'why'), viewers: maxOf(rr, 'v'),
                 mineP: mine, mineBlKB: mineBl, othersP: others, voterP, voter, pout: maxOf(rr, 'pout') || 0 };
  }
  if (a.length) {
    st.arrive = { fr: med(a, 'fr'), bitrate: med(a, 'by') == null ? null : med(a, 'by') * 8, kf: sum(a, 'kf'),
                  gap50: med(a, 'gap50', (v) => v > 0), gap95: med(a, 'gap95', (v) => v > 0),
                  exc50: med(a, 'exc50'), exc95: med(a, 'exc95'), excMax: maxOf(a, 'exc95'),
                  mv: sum(a, 'mv'), rttn: sum(a, 'rttn'), rtt50: med(a, 'rtt50', (v) => v > 0), rtt95: med(a, 'rtt95', (v) => v > 0),
                  frames: sum(a, 'fr') };
  }
  st.picture = pictureOf(st);
  return st;
}
// One word for the picture of a phase, from what the host says it SENT -- the agent decodes nothing, so this is
// the stream, never a viewer's screen. sharp: full size and a fine quantiser (or the tile codec at full colour);
// soft: a little of either lost; coarse: the rest. null when the host reported nothing to judge it by -- which
// includes H.264 with no quantiser reading: then only a cut SIZE can be judged, since full size says nothing of the QP.
function pictureOf(st) {
  const h = st.host;
  if (!h) return null;
  const scale = h.scale == null ? 1000 : h.scale;
  if (h.mode === 'tile1') return scale >= 950 && (h.bits == null || h.bits >= 7) ? 'sharp' : scale >= 800 && (h.bits == null || h.bits >= 5) ? 'soft' : 'coarse';
  if (h.qpUnmeasured) return scale < 800 ? 'coarse' : scale < 950 ? 'soft' : null;
  if (h.qp == null && h.scale == null) return null;
  const qp = h.qp == null ? 0 : h.qp;
  return scale >= 950 && qp <= 28 ? 'sharp' : scale >= 800 && qp <= 34 ? 'soft' : 'coarse';
}

// ---- the causes ---------------------------------------------------------------------------------------------------
// Each rule reads ONE phase's numbers and names a cause only when it can also say what to do -- a verdict nobody can
// act on is a number with a name (tools/TRACE.md, "Extending it"). Thresholds are the trace report's own where it
// has one. `area` says WHERE the cause lives, which decides who can fix it:
//   link     the network between the host and its viewers (the host's uplink, the relay, a viewer's downlink)
//   machine  the host computer itself (its encoder, its capture)
//   viewer   a person's console (their window size, their decoder)
//   setting  a mode somebody chose (picture quality, a height cap)
//   codec    what ScreenMirror itself does with the picture (refinement, keyframes, the encoder's rebuilds) --
//            the product's own behaviour, i.e. the ones a code change improves
//   input    the pointer and keyboard path
const SEV = { high: 0, warn: 1, info: 2 };
// THE PICTURE-QUALITY CAP a watcher's mode puts on the rate. The viewer's presets (tools/viewer.html Q_PRESETS and
// qEffective): Best and Auto send 1, Normal 0.6, Speed 0.35, and Auto 0.5 on a 3g-class link or 0.15 on a metered or
// 2g one. The host takes it in milli and caps the rate at its absolute floor (16 kb/s) + cap x (ceiling - floor).
const CAP_FLOOR_BPS = 16000;
const CAP_MODES = { 600: 'Normal', 500: 'Auto (a 3g-class link)', 350: 'Speed', 150: 'Auto (a metered or 2g link)' };
const capTop = (ceiling, milli) => CAP_FLOOR_BPS + Math.floor((ceiling - CAP_FLOOR_BPS) * milli / 1000);
// A phase's cap, when its rate sits at the cap's top: the host's own report (qcap, top), or else the run's inferred one.
function capOf(h, ctx) {
  const at = (top) => top > 0 && h.rate != null && h.rate >= 0.98 * top;
  if (h.qcap != null) {
    if (!(h.qcap < 1000) || !at(h.top)) return null;
    const mode = CAP_MODES[Math.round(h.qcap)] || null;
    return { milli: Math.round(h.qcap), top: h.top, mode: mode || 'a setting of ' + Math.round(h.qcap / 10) + '%', label: mode || Math.round(h.qcap / 10) + '% cap', inferred: false };
  }
  const c = ctx && ctx.inferredCap;
  return c && at(c.top) ? c : null;
}
// The one value a host 1.57.0 slice-header QP sat at, when it never moved while the frames' sizes varied severalfold
// (at least 20 seconds read from the slices, every one the same QP, the bytes a frame across seconds 8x apart) -- or null.
function flatSliceQp(H) {
  // ...never under a HELD quantiser (qhold, ScreenMirror host 1.58.0): one QP in every second is then the point
  const sl = H.filter((r) => r.qpsrc === 'slice' && r.qp > 0 && !(r.qhold > 0));
  if (sl.length < 20 || new Set(sl.map((r) => r.qp)).size !== 1) return null;
  const per = H.filter((r) => r.fr > 0 && r.by > 0).map((r) => r.by / r.fr);
  return per.length >= 10 && Math.max(...per) >= 8 * Math.min(...per) ? sl[0].qp : null;
}
// A HOST BEFORE 1.57.0 does not report the cap, so it is recognised only where it cannot be anything else: the run's
// highest offered rate is EXACTLY, to the bit, the top a preset gives on the ceiling the host derives for the screen
// (capture width x height x fps x 0.08, within 1.5-40 Mb/s, when no bitrate is configured). Any configured bitrate,
// another capture size or a rate that never reached its top matches nothing, and nothing is claimed.
function inferCap(H, meta) {
  const m = /^(\d+)x(\d+)$/.exec(String((meta && meta.screen) || ''));
  const rates = H.map((r) => r.rate).filter((v) => typeof v === 'number' && v > 0);
  if (!m || !rates.length || H.some((r) => typeof r.qcap === 'number')) return null;
  const max = Math.max(...rates);
  const fpsSeen = H.map((r) => r.fps).filter((v) => typeof v === 'number' && v > 0);
  for (const fps of new Set([fpsSeen.length ? Math.max(...fpsSeen) : 30, 30, 60])) {
    const ceiling = Math.floor(Math.min(40e6, Math.max(1.5e6, Number(m[1]) * Number(m[2]) * fps * 0.08)));
    for (const [milli, mode] of Object.entries(CAP_MODES)) {
      const top = capTop(ceiling, Number(milli));
      if (max === top) return { milli: Number(milli), top, mode, label: mode, inferred: true,
                                how: kbps(top) + ' is ' + mode + '\'s top on the ' + kbps(ceiling) + ' ceiling of a ' + m[1] + '×' + m[2] + ' screen at ' + fps + ' fps' };
    }
  }
  return null;
}

// WHY THE HOST ENCODES IN SOFTWARE, when it says (hwwhy): each reason has its own fix. Before the host named it they
// were all one "hw 0", and five live runs on a machine with a GPU could not tell them apart (2026-11-10).
const HW_WHY = {
  cfg: { title: 'preferHardware is off', fix: () => 'preferHardware is off in this host\'s config: turn it on.' },
  none: { title: 'no hardware H.264 encoder is installed',
          fix: () => 'No hardware H.264 encoder is installed on the machine. A GPU driver that ships one (Intel Quick Sync, NVIDIA NVENC, AMD AMF) is the only way to a hardware encode; until then a smaller encode (maxEncodeHeight) is the lever.' },
  act: { title: 'its hardware encoders would not start',
         fix: () => 'Hardware encoders are installed and none would start: the GPU driver is the suspect -- update or reinstall it.' },
  // the one reason that is not a software encoder: the hardware MFT stays in charge, without its GPU device (hw 0)
  d3d: { lead: 'The machine\'s encoder runs without its GPU device and cannot keep up', kind: 'hardware encoder without its GPU device',
         title: 'the hardware encoder refused the capture device',
         fix: (h) => 'A hardware encoder started and refused the capture device' + (h.hwHr ? ' (' + h.hwHr + ')' : '') + '. The screen is likely captured on another adapter than the encoder\'s; a virtual display (an IddCx driver) is the case to suspect. Capturing a screen the GPU itself drives, or giving the encoder a device on its own adapter (a host change), is the fix.' },
  gdi: { title: 'the GDI capture forces it',
         fix: () => 'The screen is captured with GDI, which forces the software encoder: DXGI duplication was unavailable (a session without a GPU-driven output).' },
  wall: { title: 'the merged wall of screens forces it',
          fix: () => 'A merged wall of screens is captured, which forces the software encoder: watch one screen at a time for a hardware encode.' },
};
function causesOf(stats, ctx) {
  const out = new Map();
  const add = (id, sev, area, phase, title, evidence, fix) => {
    const c = out.get(id);
    if (!c) { out.set(id, { id, sev, area, title, phases: [phase], evidence: [phase + ': ' + evidence], fix }); return; }
    if (!c.phases.includes(phase)) { c.phases.push(phase); c.evidence.push(phase + ': ' + evidence); }
    if (SEV[sev] < SEV[c.sev]) { c.sev = sev; c.title = title; c.fix = fix; c.area = area; }
  };
  const fmt = (v, d) => (v == null ? '—' : Number(v).toFixed(d || 0));
  for (const s of stats) {
    const h = s.host, rl = s.relay, a = s.arrive, n = s.n.host, P = s.name;
    const motion = !s.still && P !== 'watch';
    if (h) {
      const Q = h.quality, S = h.speed, I = h.input;
      // -- sharpness, in the order the trace's quality verdict ranks them: a resolution cut cannot be undone
      if (share(Q, 'ladder', n) >= 0.3 || (h.scaleMin != null && h.scaleMin < 900)) {
        add('ladder', h.scale != null && h.scale < 750 ? 'high' : 'warn', 'link', P,
            'The picture is sent SMALLER to fit the link (down to ' + fmt((h.scaleMin || h.scale) / 10) + '% of the screen) -- blur nothing downstream can undo',
            'size ' + fmt((h.scaleMin) / 10) + '–' + fmt(h.scale / 10) + '% · offered ' + kbps(h.rate) + ' · link ' + kbps(h.link || h.gp) + ' · uplink busy ' + fmt(h.wire) + '%',
            'A bandwidth limit, not a quality setting: read the uplink and relay causes below. A sharper mode or a bigger window cannot sharpen a picture that was sent small.');
      }
      if (h.mode === 'tile1' && h.bits != null && h.bits <= 5 && !h.breq) {
        add('tile1-bits', 'warn', 'link', P, 'Colours are cut to ' + h.bits + '-bit on the low-bandwidth codec (banding)',
            'tile1 at ' + h.bits + ' bits, nobody asked for that depth (breq 0) · link ' + kbps(h.link || h.gp),
            'The link forced the low-bandwidth codec and its colour ladder down; it comes back with the bandwidth. If the link has room, the codec engaged too eagerly -- compare the offered rate with the bottom rung.');
      }
      if (share(Q, 'bitsreq', n) >= 0.3) {
        add('bitsreq', 'info', 'setting', P, 'The picture-quality mode chose the colour depth (' + fmt(h.bits) + '-bit), not the link',
            'qwhy bitsreq in ' + Math.round(100 * share(Q, 'bitsreq', n)) + '% of seconds · breq ' + fmt(h.breq),
            'View ▾ → Picture quality: Best is 8-bit, Normal 6, Speed 4; Auto hands it back to the host.');
      }
      if (share(Q, 'viewport', n) >= 0.3) {
        add('viewport', 'warn', 'viewer', P, 'Text is blurred by a watcher\'s WINDOW: the encode follows it at ' + fmt(h.qval) + '% of the screen',
            'qwhy viewport in ' + Math.round(100 * share(Q, 'viewport', n)) + '% of seconds · encode ' + fmt(h.w) + '×' + fmt(h.h),
            'Read mode (or a bigger console window) on the console that is watching -- the agent has no window, so this is a person\'s. No bitrate fixes it.');
      }
      if (share(Q, 'opcap', n) >= 0.3) {
        add('opcap', 'info', 'setting', P, 'An operator\'s height cap (maxEncodeHeight) limits the picture to ' + fmt(h.qval) + ' rows',
            'qwhy opcap · encode ' + fmt(h.w) + '×' + fmt(h.h), 'A configuration choice, not a fault: lift the cap if the picture should be sharper.');
      }
      if (share(Q, 'qp', n) >= 0.3) {
        add('qp-floor', 'info', 'setting', P, 'The picture-quality mode holds a quantiser floor (QP ' + fmt(h.qp) + ')',
            'qwhy qp · qpf set', 'Deliberate: a higher picture-quality mode lowers it.');
      }
      // WITH NO QUANTISER, THE DATA PER FRAME. A hardware encoder that reports none (Quick Sync, 2026-11-10) left these
      // causes silent while each moving frame got ~55 kb at 1664x936 -- 0.035 bits a pixel, against the software encoder's
      // 0.11-0.13 on the same machine at QP 38-43. Streaming guidance puts 1080p30 at 4.5-6 Mb/s, ~0.07-0.1 bits a pixel
      // a frame; under BPP_STARVED a moving screen is starved on any H.264 encoder.
      const starved = motion && h.qpUnmeasured && h.bppf != null && h.bppf < BPP_STARVED;
      if ((motion && h.qp != null && (share(Q, 'rate', n) >= 0.3 || h.qp >= 33)) || starved) {
        // TWO causes, not one: coarse because the uplink is full (the link) and coarse while it has room (the ABR is
        // holding the rate -- the product's own choice) want opposite fixes, and one id merged across phases would
        // let the second overwrite the first
        const full = h.wire != null && h.wire >= 60;
        // THREE causes now: the uplink full (the link); a WATCHER's congestion handed to the host (the relay's pressure
        // out, and a voting watcher at >= 0.5 -- the host is slowing the shared stream for that watcher); and neither,
        // the rate held with nobody congested (the ABR not rising: the product's own behaviour)
        const forViewer = !full && rl && rl.voterP >= 0.5 && rl.pout > 0;
        // FOUR: ...or the rate sits at the top a watcher's picture-quality mode allows -- a setting, and the ABR doing as
        // it was told. Three runs on Quick Sync (2026-11-10) were read as "the ABR is not raising the rate" while a
        // console was on Speed: the rate stopped at exactly Speed's top, 1,752,224 b/s on a 4,976,640 ceiling.
        const cap = capOf(h, ctx);
        if (!full && cap) {
          const kb = fmt(h.kbPerFrame) + ' kb a frame';
          add('rate-capped', starved ? (h.bppf < 0.03 ? 'high' : 'warn') : h.qp >= 38 ? 'high' : 'warn', 'setting', P,
              'The rate is held at a watcher\'s picture-quality cap: ' + cap.label + ' (' + kbps(cap.top) + ')',
              (starved ? kb + ' at ' + fmt(h.w) + '×' + fmt(h.h) + ' (' + fmt(h.bppf, 3) + ' bits a pixel), the quantiser not reported'
                       : 'QP ' + fmt(h.qp) + ' (p95 ' + fmt(h.qp95) + ')') +
                ' · offered ' + kbps(h.rate) + ', the top ' + cap.label + ' allows ' + (cap.inferred ? '(exactly: ' + cap.how + ')' : '(qcap ' + cap.milli + ', top ' + kbps(cap.top) + ')') +
                ' · uplink busy ' + fmt(h.wire) + '%',
              'A setting, not the link and not the ABR: a console watching has View ▾ → Picture quality on ' + cap.mode +
                ', which caps the rate at ' + Math.round(cap.milli / 10) + '% of the ceiling. Set it to Best (or Auto on a wired or Wi-Fi link) on that console. ' +
                'The setting is host-wide -- the last console to choose one sets it for everyone watching, this check included.' +
                (cap.inferred ? ' (This host does not report the cap; a host from 1.57.0 does, as qcap and top.)' : ''));
        } else {
          const id = full ? 'rate-link' : forViewer ? 'rate-viewer' : 'rate-held';
          const kb = fmt(h.kbPerFrame) + ' kb a frame';
          const evidence = (starved ? kb + ' at ' + fmt(h.w) + '×' + fmt(h.h) + ' (' + fmt(h.bppf, 3) + ' bits a pixel) at ' + fmt(h.fr) + ' fps, the quantiser not reported'
                                    : 'QP ' + fmt(h.qp) + ' (p95 ' + fmt(h.qp95) + ')') +
                           ' · sending ' + kbps(h.bitrate) + ' (offered ' + kbps(h.rate) + ') · link ' + kbps(h.link || h.gp) + ' · uplink busy ' + fmt(h.wire) + '%' +
                           // "sending X (offered Y)": a software encoder overshoots its target, and "2.2 of 1.5" read as nonsense
                           (rl ? ' · watchers\' pressure to the host ' + fmt(rl.pout, 2) + (rl.voterP >= 0.5 ? ' (' + rl.voter + ' reported ' + fmt(rl.voterP, 2) + ')' : '') : '');
          add(id, starved ? (h.bppf < 0.03 ? 'high' : 'warn') : h.qp >= 38 ? 'high' : 'warn', full ? 'link' : forViewer ? 'viewer' : 'codec', P,
              starved ? (forViewer ? 'Motion is starved: the rate is held down for a watcher\'s congested link (' + kb + ')'
                                   : 'Motion is starved: ' + kb + ' at ' + fmt(h.fr) + ' fps' + (full ? ' on a full uplink' : ' on a rate held at ' + kbps(h.rate)))
                      : forViewer ? 'Motion is coarse: the rate is held down for a watcher\'s congested link (QP ' + fmt(h.qp) + ')'
                      : 'Motion is coarse: the bitrate ceiling raises the quantiser to ' + fmt(h.qp) + ' while the picture moves',
              evidence,
              full ? 'The uplink is full while it moves: the rate cannot rise until less is sent (keyframes first).'
                   : forViewer ? 'A watcher reported congestion and the stream is shared, so the host slowed for them: that watcher\'s downlink (or decoder) is the limit. Look at their connection, or let a slow watcher watch at low priority -- the host was not the cause.'
                   : starved ? 'The uplink has room (' + fmt(h.wire) + '% busy) and no watcher reported congestion, yet the offered rate stays at ' + kbps(h.rate) + ': spread over ' + fmt(h.fr) + ' frames a second, each moving frame gets ' + kb + ', too little for a moving screen to be sharp. The ABR is not raising the rate for motion -- a codec/ABR change, not the network. (The quantiser is not reported, so this is judged by the data per frame.)'
                   : 'The uplink has room (' + fmt(h.wire) + '% busy) and no watcher reported congestion, yet the rate is held: the ABR is not raising the offered rate for motion -- a codec/ABR change, not the network.');
        }
      }
      if (s.still && h.qp != null && h.qp > 28 && h.qpSeen >= 3) {
        // RECOVERING SLOWLY is not STUCK. Read on a real machine as "refinement ran 2x and QP stayed 42 -- the encoder may
        // be ignoring it", when the seconds said 49 -> 42 -> 34 -> 31: every refinement landed, a step every ~3 s.
        const fell = h.refine > 0 && h.qpFirst != null && h.qpLast != null && h.qpLast <= h.qpFirst - 5;
        if (fell) {
          add('recovery', 'warn', 'codec', P,
              'A still picture sharpens slowly after motion: QP ' + fmt(h.qpFirst) + ' → ' + fmt(h.qpLast) + ' over the phase, a step every ~' + fmt(s.secs / h.refine) + ' s',
              'QP ' + fmt(h.qpFirst) + ' → ' + fmt(h.qpLast) + ' on a still screen · ' + h.refine + ' refinements · median QP ' + fmt(h.qp),
              'Refinement works, in small steps: after heavy motion text stays soft for several seconds. A bigger first step, or a shorter interval while the quantiser is high, would bring it back sooner.');
        } else if (h.refine && (share(Q, 'rate', n) >= 0.5 || (h.qp >= 33 && share(Q, 'qp', n) < 0.3))) {
          // ...and by the host's own rule for 'rate' (QP >= 33 with no quality floor), not only its label: the label names
          // the bigger limit first, so with a watcher's window binding too it reads "viewport" while the cap still holds
          // the refresh (the fifth live run: QP 46 -> 43 under three refreshes, labelled viewport throughout)
          // HELD TO THE CAP, not ignored: on a real machine at full size (2026-11-10) three refinements ran and each refresh
          // came out at QP 48-51 with the quality verdict "rate" throughout -- the refresh is a whole picture under the
          // same bitrate ceiling as motion, so it cannot be finer than the ceiling buys
          add('refine-capped', 'warn', 'codec', P,
              'A still picture cannot sharpen: refinement ran ' + h.refine + '× and each refresh was held to the bitrate cap (QP ' + fmt(h.qp) + ')',
              'QP ' + fmt(h.qpFirst) + ' → ' + fmt(h.qpLast) + ' on a still screen · ' + h.refine + ' refinements · ' +
              (share(Q, 'rate', n) >= 0.5 ? 'qwhy rate in ' + Math.round(100 * share(Q, 'rate', n)) + '% of seconds'
                                         : 'QP ' + fmt(h.qp) + ' with no quality floor -- the host\'s rule for the rate limit (labelled ' + topOf(Q) + ', which outranks it)') +
              ' · offered ' + kbps(h.rate) + ' · encode ' + fmt(h.w) + '×' + fmt(h.h),
              'The refresh of a still screen is held to the same bitrate as motion. A refresh allowed more than the motion rate -- the uplink has room -- would let a still screen come back sharp.');
        } else {
          add('refine', 'warn', 'codec', P,
              h.refine ? 'A still picture stays coarse (QP ' + fmt(h.qp) + ') although refinement ran ' + h.refine + '×' : 'A still picture stays coarse (QP ' + fmt(h.qp) + '): the idle refinement did not run',
              'QP ' + fmt(h.qpFirst) + ' → ' + fmt(h.qpLast) + ' on a still screen · refine ' + h.refine + ' · rebuild ' + h.rebuild,
              h.refine ? 'The quantiser did not come down after the refinements, and the bitrate was not what held it: the encoder may be accepting the refinement and ignoring it.'
                       : 'A still screen should be refined to a low QP within a few seconds: check why the refinement pass is not firing (its QP gate and its keyframe budget).');
        }
      }
      // -- speed
      if ((h.wire != null && h.wire >= 70) || share(S, 'send', n) + share(S, 'senddrop', n) >= 0.3) {
        add('uplink', h.wire != null && h.wire >= 85 ? 'high' : 'warn', 'link', P,
            'The host\'s uplink is full (' + fmt(h.wire) + '% busy)',
            'wire ' + fmt(h.wire) + '% (max ' + fmt(h.wireMax) + '%) · sending ' + kbps(h.bitrate) + ' · link ' + kbps(h.link || h.gp) + ' · keyframes ' + fmt(h.keyShare == null ? null : 100 * h.keyShare) + '% of bytes',
            'Nothing else can leave while a write is in progress -- one fault behind both a slow picture and a heavy pointer. Send less: keyframes first, then the rate. Nothing on the viewer side fixes a full uplink.');
      }
      if (h.drop > 0) {
        add('drops', 'high', 'link', P, 'The host dropped ' + h.drop + ' frames it could not send', 'drop ' + h.drop + ' · uplink busy ' + fmt(h.wire) + '%',
            'The send queue overflowed: the uplink cannot carry what is offered. Expect an ABR cut alongside.');
      }
      const interval = h.fps > 0 ? 1000 / h.fps : null;
      if (share(S, 'encode', n) >= 0.3 || (interval && h.enc95 != null && h.enc95 > interval)) {
        const sw = h.hwEnc === 0, why = sw && h.hwWhy ? HW_WHY[h.hwWhy] : null;
        add('encoder', sw ? 'high' : 'warn', 'machine', P,
            sw ? ((why && why.lead) || 'The machine encodes in SOFTWARE and cannot keep up') + (why ? ': ' + why.title : '') : 'The machine\'s encoder cannot keep up',
            'encode p95 ' + fmt(h.enc95, 1) + ' ms against a ' + fmt(interval, 1) + ' ms frame · ' +
              (sw ? (why && why.kind) || 'software encoder' : h.hwEnc === 1 ? 'hardware encoder' : 'encoder kind not reported') +
              (h.encName ? ' "' + h.encName + '"' : '') + (h.capMode ? ' · capture ' + h.capMode : '') +
              (sw && h.hwWhy ? ' · hwwhy ' + h.hwWhy + (h.hwWhy === 'd3d' && h.hwHr ? ' (' + h.hwHr + ')' : '') : '') + ' · ' + fmt(h.w) + '×' + fmt(h.h),
            !sw ? 'A smaller encode or a lower frame rate; or a busy GPU on that machine.'
                : why ? why.fix(h)
                : 'No hardware H.264 encoder is in use: check the GPU driver and the host\'s preferHardware.' +
                  (h.hwWhy == null ? ' This host does not report why (hwwhy); a newer one does, and the check then names the reason.' : ''));
      }
      if (share(S, 'capture', n) >= 0.3) {
        add('capture', 'warn', 'machine', P, 'Capturing the screen is slow on the machine', 'capture p95 ' + fmt(h.cap95, 1) + ' ms · swhy capture',
            'Usually cursor compositing, a busy GPU or a ring with no free slot on that machine.');
      }
      // THE STREAM AGAINST WHAT THE CARD DREW: frames the card drew and the stream never carried are a real drop -- and
      // whose, the speed verdict says. (The other way round -- a stream that kept pace with a slow card -- is a note in
      // analyze: the frame rate there measures the card, not the stream.)
      // ...against what the stream MAY carry: no more than its own frame rate. A card drawing 52 a second over a 30 fps
      // stream that carried 27 is the cap, not a drop (2026-11-10).
      const mayCarry = s.cardFps != null && h.fps > 0 ? Math.min(s.cardFps, h.fps) : s.cardFps;
      if (s.cardFps != null && CARD_MOVING.has(P) && h.fr != null && s.cardFps >= 4 && h.fr < 0.6 * mayCarry) {
        const enc = share(S, 'encode', n) >= 0.3 || (h.enc95 != null && h.fps > 0 && h.enc95 > 1000 / h.fps);
        const paced = share(S, 'paced', n) >= 0.3;
        add('carried', 'warn', enc ? 'machine' : paced ? 'link' : 'codec', P,
            'The stream carried ' + fmt(h.fr) + ' of the ' + fmt(mayCarry) + ' frames a second ' +
              (mayCarry < s.cardFps ? 'it may send (the card drew ' + fmt(s.cardFps) + ')' : 'the card drew'),
            'card ' + fmt(s.cardFps) + ' fps · stream ' + fmt(h.fr) + ' fps · ' + (enc ? 'encode p95 ' + fmt(h.enc95, 1) + ' ms' : paced ? 'paced by the ABR' : 'no stage said it was slow'),
            enc ? 'The encoder is the limit: the frames were drawn and never encoded (see the encoder cause).'
                : paced ? 'The ABR lowered the frame rate for the link.' : 'Frames were drawn and not sent, with no stage saying why: look at the capture loop (skip) in the trace.');
      }
      if (motion && h.fps > 0 && h.fr != null && h.fr < 0.5 * h.fps && share(S, 'paced', n) >= 0.3) {
        add('choppy', 'warn', 'link', P, 'Motion is choppy: ' + fmt(h.fr) + ' of ' + fmt(h.fps) + ' frames a second, paced down by the ABR',
            'frames ' + fmt(h.fr) + '/' + fmt(h.fps) + ' · swhy paced', 'The frame rate was lowered for the link: the cause is the rate and the link above.');
      }
      // A share of NOTHING is not a finding: a still phase that sends a few KB can be "70% keyframes" from one refresh.
      // So it needs volume (KF_MIN_BPS), and the keyframes are attributed by count -- the GOP accounts for frames/gop of
      // them, refinement and rebuilds for theirs, and the rest were asked for or inserted by the encoder itself.
      // ...and only while the picture MOVES: a still screen sends almost nothing but its refinements, so its keyframe share
      // is ~100% by construction (measured: 96% for a still card whose only bytes were two refinement keyframes)
      if (!s.still && h.keyShare != null && h.keyShare >= 0.5 && h.kf >= 2 && h.bytes * 8 / Math.max(1, s.secs) >= KF_MIN_BPS) {
        const forced = h.refine + h.rebuild, gopKf = h.gop > 0 ? Math.floor(h.frames / h.gop) : 0, other = Math.max(0, h.kf - forced - gopKf);
        // with kreq the host COUNTS the requests it spent, so "asked for or inserted" splits in two. A spent request can
        // share its keyframe with a refinement, a rebuild or the other flag in the same pass, so the count is a ceiling
        // on the keyframes requests caused -- hence min(other, kreq).
        const asked = h.kreqSeen ? Math.min(other, h.kreq) : 0, own = other - asked;
        add('keyframes', h.keyShare >= 0.7 ? 'high' : 'warn', 'codec', P,
            'Keyframes are ' + Math.round(100 * h.keyShare) + '% of what is sent',
            h.kf + ' keyframes · ' + h.refine + ' from refinement, ' + h.rebuild + ' from encoder rebuilds, ' + gopKf + ' from the GOP (' + fmt(h.gop) + ' frames), ' +
              (h.kreqSeen ? asked + ' asked for (' + h.kreq + ' requests spent), ' + own + ' inserted by the encoder' : other + ' asked for or inserted'),
            forced >= h.kf / 2 ? 'Most are forced by refinement/rebuilds: those are the product\'s own choices -- spend fewer.'
              : !h.kreqSeen ? 'Most are neither the GOP nor the product\'s own: find who asks for them (a viewer\'s resync, a viewer joining) or whether the encoder inserts them.'
              : asked >= own ? 'Most were ASKED FOR (a viewer joining or resyncing, a relay backlog drop): find who keeps asking.'
              : 'Most were inserted by the ENCODER itself (' + (h.kreq ? 'only ' + h.kreq + ' asked for' : 'none asked for') + '): a software encoder\'s scene-change keyframes, or a GOP it does not hold -- its settings, not the relay.');
      }
      if (h.gop && h.fps && h.gop < 2 * h.fps) {
        add('gop', 'warn', 'codec', P, 'A keyframe is forced every ' + fmt(h.gop) + ' frames', 'GOP ' + fmt(h.gop) + ' at ' + fmt(h.fps) + ' fps',
            'A short GOP is a floor on bandwidth no setting gets under: the encoder may be clamping the request.');
      }
      if (h.rebuild >= 2) {
        add('rebuild', 'warn', 'codec', P, 'The encoder was rebuilt ' + h.rebuild + '× in one phase', 'rebuild ' + h.rebuild + ' · each one a keyframe',
            'Each rebuild costs a full picture: find what changes the encode size or mode this often.');
      }
      if (h.rsk > 0) {
        add('resync', 'warn', 'link', P, h.rsk + ' frames were withheld waiting for a keyframe (a frozen picture)', 'rsk ' + h.rsk,
            'Frames were lost on the way and the picture froze until a keyframe -- correlate with the relay\'s drops.');
      }
      if (h.rc > 0) {
        add('reconnect', 'high', 'link', P, 'The host reconnected to the relay ' + h.rc + '× during the check', 'rc ' + h.rc,
            'The host\'s connection is dropping: every reconnect is a frozen picture and a keyframe.');
      }
      if (h.ished > 0) {
        add('input-shed', 'high', 'input', P, 'Input was DROPPED on the host (' + h.ished + ' events)', 'ished ' + h.ished,
            'The injector\'s queue overflowed: clicks and keys were lost, not delayed. Usually no interactive session to inject into.');
      }
      void I;
    }
    if (rl) {
      const W = rl.why, nr = s.n.relay;
      if (rl.drop > 0 || share(W, 'shed', nr) + share(W, 'backlog', nr) >= 0.3) {
        const mine = rl.mineBlKB > 0 && rl.mineBlKB * 1024 >= (rl.bl95 || 0) * 0.8;
        add('relay-shed', 'high', 'link', P,
            mine ? 'The relay shed frames on the way to THIS agent (its own downlink, not the host)' : 'The relay shed frames on the way to a viewer',
            'dropped ' + rl.drop + ' · backlog p95 up to ' + fmt((rl.bl95 || 0) / 1024) + ' KB' + (mine ? ' · the agent\'s own row is the deepest' : ''),
            mine ? 'The machine running the agent cannot take the stream: rerun the check from a better link before blaming the host.'
                 : 'That viewer\'s downlink cannot take the stream; nothing host-side will fix it.');
      }
      if (share(W, 'coviewer', nr) >= 0.3) {
        add('coviewer', 'info', 'viewer', P, 'Another viewer\'s link set the pace for everyone watching', 'relay why coviewer · ' + fmt(rl.viewers) + ' watching',
            'Somebody else\'s congested link lowered the shared stream: their side, not the host.');
      }
    }
    if (a) {
      if (motion && a.exc95 != null && a.exc95 > 400) {
        add('behind', a.exc95 > 1000 ? 'high' : 'warn', 'link', P, 'Frames arrived up to ' + fmt(a.exc95) + ' ms behind live under ' + P,
            'behind live p95 ' + fmt(a.exc95) + ' ms (median ' + fmt(a.exc50) + ') at the agent',
            'Latency builds while the picture moves: the path cannot carry the burst. Measured at the agent, so its own link is part of it.');
      }
      if (motion && a.gap95 != null && a.gap50 && a.gap95 > 3 * a.gap50 && a.gap95 > 150) {
        add('bursty', 'warn', 'link', P, 'Delivery is bursty: frames come in clumps', 'gap p95 ' + fmt(a.gap95) + ' ms against a median of ' + fmt(a.gap50) + ' ms',
            'Jitter, not delay -- a different fault from a slow link: look for a full uplink or a busy relay socket.');
      }
      // ...only when frames REACHED the agent in this phase: a paused copy of the stream gets no cursor updates either
      // (the relay sends the pointer only to viewers it streams to), and "nothing came back" would be about the agent
      if (P === 'pointer' && a.mv > 0 && a.frames > 0) {
        if (!a.rttn) add('no-echo', 'info', 'input', P, 'The pointer moved but no cursor position came back to the agent', a.mv + ' moves sent, 0 matched',
            'Real-cursor mode streams no position, or this relay does not send the agent the pointer: the round trip was not measured.');
        else if (a.rtt95 != null && a.rtt95 > 200) {
          add('pointer', 'warn', 'input', P, 'The pointer\'s round trip is ' + fmt(a.rtt95) + ' ms (p95)',
              'rtt median ' + fmt(a.rtt50) + ' ms · frame gap median ' + fmt(a.gap50) + ' ms (the floor: the cursor comes back with the video)',
              'Subtract the frame cadence first: if rtt − gap is small, it is video latency showing in the pointer, not an input fault.');
        }
      }
    }
  }
  // CROSS-PHASE: the comparison only a scripted run can make -- sharp at rest, coarse in motion.
  const rest = stats.filter((s) => s.still && s.picture === 'sharp');
  const hard = stats.filter((s) => !s.still && s.picture === 'coarse');
  if (rest.length && hard.length) {
    add('motion-only', 'info', hard.some((s) => s.host && s.host.wire >= 60) ? 'link' : 'codec', hard[0].name,
        'Sharp at rest, coarse in motion',
        'still: ' + rest.map((s) => s.name).join(', ') + ' sharp · moving: ' + hard.map((s) => s.name).join(', ') + ' coarse',
        'The encoder\'s settings are fine; the limit is what the rate (or the link) allows while the picture changes.');
    for (const s of hard.slice(1)) out.get('motion-only').phases.includes(s.name) || out.get('motion-only').phases.push(s.name);
  }
  // CROSS-PHASE: KEYFRAMES NOBODY EXPLAINS. On a real machine (2026-11-09) a keyframe came every 2-3 s whenever anything
  // moved, with GOP 300, no refinement, no rebuild and no drops -- each a whole picture, half the bytes while only the
  // pointer moved. No single phase shows it as a share; the interval across the moving phases does.
  {
    const mv = stats.filter((s) => !s.still && s.host && s.host.frames > 0);
    let kf = 0, secs = 0, explained = 0, kreq = 0, kreqSeen = false;
    for (const s of mv) {
      const h = s.host;
      kf += h.kf; secs += Math.max(0, s.secs - PH_LEAD / 1000);
      explained += h.refine + h.rebuild + (h.gop > 0 ? Math.floor(h.frames / h.gop) : 0);
      kreq += h.kreq || 0; kreqSeen = kreqSeen || h.kreqSeen;
    }
    const other = kf - explained;
    if (other >= 3 && secs > 0 && secs / other <= 5) {
      const g = mv.find((s) => s.host.gop > 0);
      // A host that counts the keyframe requests it spent (kreq) settles "asked for, or inserted?" -- the question the
      // first five live runs could only leave open. A host without kreq keeps the open question.
      const asked = kreqSeen ? Math.min(other, kreq) : 0, own = other - asked;
      const every = 'A keyframe every ~' + fmt(secs / other, 1) + ' s while the picture moves';
      add('kf-unexplained', 'warn', 'codec', mv[0].name,
          !kreqSeen ? every + ', which the GOP, refinement and rebuilds do not explain'
            : asked >= own ? every + ': most were ASKED FOR (' + kreq + ' keyframe requests spent)'
            : every + ', inserted by the ENCODER itself (' + (kreq ? 'only ' + kreq + ' asked for' : 'none asked for') + ')',
          other + ' of ' + kf + ' keyframes in ' + Math.round(secs) + ' s of motion · GOP ' + fmt(g ? g.host.gop : null) + ' frames · refine and rebuild counted out' +
            (kreqSeen ? ' · ' + kreq + ' requests spent by the host (kreq)' : ''),
          !kreqSeen ? 'Each is a whole picture. Find who asks for them -- a viewer\'s resync or rejoin (the relay\'s keyframe requests) -- or whether the encoder inserts them itself (a software encoder may not hold the GOP it is given).'
            : asked >= own ? 'Each is a whole picture, asked for: a viewer joining or resyncing, or the relay dropping a slow viewer\'s backlog (each drop asks for one). Find who keeps asking: the relay\'s drops and the viewers\' resyncs in the trace.'
            : 'Each is a whole picture the encoder chose: a software encoder\'s own scene-change keyframes, or a GOP it does not hold. The encoder\'s settings (or a hardware encoder: see the encoder cause), not the relay or the viewers.');
      for (const s of mv.slice(1)) out.get('kf-unexplained').phases.includes(s.name) || out.get('kf-unexplained').phases.push(s.name);
    }
  }
  // CROSS-PHASE: THE QUANTISER WAS NOT MEASURED. Said once, for every phase it holds in: the picture's sharpness is
  // unknown there, and "sharp" read off a missing number was this check's one wrong answer on Quick Sync (2026-11-10).
  {
    const un = stats.filter((s) => s.host && s.host.qpUnmeasured);
    const secs = un.reduce((a, s) => a + s.n.host, 0);
    if (un.length && secs >= 3) {
      const named = un.find((s) => s.host.encName), hk = un[0].host.hwEnc;
      // ...and WHY, when the host tried the slice headers (qpsrc, host 1.57.1) -- or a 1.57.0 run shows it (flatQp)
      const src = (un.find((s) => s.host.qpSrc === 'flat' || s.host.qpSrc === 'unread') || {}).host;
      const why = ctx && ctx.flatQp != null ? 'its slice headers carry QP ' + ctx.flatQp + ' in every second whatever the picture does (published by host 1.57.0 as a reading): no measure'
                : src && src.qpSrc === 'flat' ? 'its slice headers were read and their QP never moved: no measure'
                : src && src.qpSrc === 'unread' ? 'its slice headers were read and too many did not parse' : '';
      add('qp-unmeasured', 'warn', 'codec', un[0].name,
          'How sharp the picture is was not measured: the host reports no quantiser' + (named ? ' from "' + named.host.encName + '"' : ''),
          'qp 0 (not measured) in ' + secs + ' host seconds · ' + (hk === 1 ? 'hardware encoder' : hk === 0 ? 'software encoder' : 'encoder kind not reported') + (why ? ' · ' + why : ''),
          'The encoder gives the host no quantiser reading, so the picture\'s sharpness is unknown: those phases read "not measured", and the rate causes are judged by the data per frame instead. ' +
            (why ? 'The slice headers do not carry it on this encoder either: only the macroblocks do, or a stream the host cannot read -- quality {stream:1} saves what it really wrote.'
                 : 'The host needs to read the quantiser back from the encoder, or estimate it.'));
      for (const s of un.slice(1)) out.get('qp-unmeasured').phases.includes(s.name) || out.get('qp-unmeasured').phases.push(s.name);
    }
  }
  void ctx;
  return [...out.values()].sort((x, y) => SEV[x.sev] - SEV[y.sev] || y.phases.length - x.phases.length);
}

// ---- the whole run -------------------------------------------------------------------------------------------------
// -> {ok, meta, phases:[stats + line], causes, verdict, coverage, notes}
function analyze(recs, opts) {
  opts = opts || {};
  recs = Array.isArray(recs) ? recs : parseNdjson(recs);
  const meta = recs.find((r) => r.c === 'meta') || {};
  const H0 = recs.filter((r) => r.c === 'h' && !r.ev), R = recs.filter((r) => r.c === 'r' && !r.ev), A = recs.filter((r) => r.c === 'a' && !r.ev);
  // A SLICE QP THAT NEVER MOVES IS NO MEASUREMENT. ScreenMirror host 1.57.0 published the slice-header QP for an encoder
  // that sets no attribute, and on Intel's Quick Sync it read 26 in every second of a run -- a still frame and full-screen
  // video alike (2026-11-10) -- so this check called every phase sharp and lost the starved, capped motion. Host 1.57.1
  // publishes one only once it has moved (qpsrc "flat" when it never does); a 1.57.0 run is read as if it had not.
  const flatQp = flatSliceQp(H0);
  const H = flatQp == null ? H0 : H0.map((r) => (r.qpsrc === 'slice' ? Object.assign({}, r, { qp: 0, qpsrc: 'flat' }) : r));
  const P = phasesOf(recs);
  const stats = P.map((p) => phaseStats(p, H, R, A));
  // What the test card itself drew a second, scene by scene (its own counts, read back after it closed)
  const cardEv = recs.find((r) => r.ev === 'card-stats' && Array.isArray(r.scenes));
  if (cardEv) {
    for (const s of stats) {
      const sc = cardEv.scenes.find((x) => x && x.name === s.name);
      if (sc && sc.secs > 0) s.cardFps = Math.round(10 * sc.painted / sc.secs) / 10;
    }
  }
  for (const s of stats) s.line = phaseLine(s);
  // a host before 1.57.0 does not report a watcher's picture-quality cap: recognised only where it is exact (inferCap)
  const inferredCap = inferCap(H, meta);
  const causes = causesOf(stats, Object.assign({}, opts, { inferredCap, flatQp }));
  const notes = [];
  // ...and a quantiser read from the slice headers (qpsrc "slice", host 1.57.0) is the same measure as the encoder's own:
  // on Microsoft's software MFT the two agree sample for sample (ScreenMirror tests/host_slice_qp.js)
  {
    const held = stats.find((s) => s.host && s.host.qhold > 0);
    if (held)
      notes.push('The picture was HELD at QP ' + Math.round(held.host.qhold) + ' by the viewer\'s picture-quality mode (Best 6, Normal 20, Speed 32): ' +
                 'its sharpness is the mode\'s, not the rate\'s, and a busy screen pays in frame rate instead -- read the frames a second, not the quantiser.');
  }
  if (stats.some((s) => s.host && s.host.qpSrc === 'slice'))
    notes.push('The quantiser was read from the slice headers (the encoder reports none of its own): on Microsoft\'s software encoder the two readings agree frame for frame, so it compares fairly with a software run.');
  const frames = A.reduce((n, r) => n + (r.fr || 0), 0);
  const refused = recs.some((r) => r.ev === 'trace-refused');
  // COVERAGE FIRST: a verdict over evidence that never arrived is the one wrong answer worth refusing outright.
  if (!H.length) {
    causes.unshift({ id: 'no-host-trace', sev: 'high', area: refused ? 'setting' : 'machine', phases: P.map((p) => p.name),
      title: refused ? 'The relay would not pass the trace switch for an agent' : 'The host sent no trace records',
      evidence: [refused ? 'the relay answered `trace` with "an agent may not do that"' : '0 host records in ' + Math.round((recs.reduce((m, r) => Math.max(m, r.t || 0), 0)) / 1000) + ' s'],
      fix: refused ? 'This relay predates agent tracing (ScreenMirror viewer 2.243.0): update the relay. Only the agent\'s own arrival side was measured.'
                   : 'A Linux host never emits the trace, and an older Windows host may not: only the agent\'s own arrival side was measured, so causes on the machine itself cannot be named.' });
  }
  // a stream that KEPT PACE with a card that drew slowly: the frame rate in that phase is the card's, not a drop
  const slowCard = stats.filter((s) => s.cardFps != null && CARD_MOVING.has(s.name) && s.host && s.host.fps > 0 &&
                                       s.cardFps < 0.6 * s.host.fps && s.host.fr != null && s.host.fr >= 0.6 * s.cardFps);
  for (const s of slowCard) notes.push('In ' + s.name + ' the test card itself drew only ' + s.cardFps + ' frames a second on this machine, and the stream kept up with it: the frame rate there is the card\'s, not a drop.');
  if (stats.some((s) => s.card) && !cardEv) notes.push('The test card\'s own counts were not read back, so a low frame rate in its scenes cannot be told apart from the card drawing slowly.');
  if (!frames) notes.push('No video reached the agent during the check -- every arrival figure is empty. The stream may have been paused for it, or the host stopped capturing.');
  else {
    // a phase in which the host encoded and NOTHING reached the agent: its arrival side is missing, not "0 ms behind"
    const starved = stats.filter((s) => s.arrive && !s.arrive.frames && s.host && s.host.frames > 0).map((s) => s.name);
    if (starved.length) notes.push('No video reached the agent in ' + starved.join(', ') + ' while the host was encoding: the arrival figures for ' + (starved.length > 1 ? 'those phases' : 'it') + ' (behind live, gaps, the pointer) are missing -- its copy of the stream was paused.');
  }
  if (!R.length && H.length) notes.push('No relay records: an older relay, so backlog and shedding were not measured.');
  if (stats.some((s) => s.name === 'pointer' && s.host && s.host.wsmv > 0)) notes.push('The pointer phase\'s moves went over the WebSocket: that is the agent\'s path -- a person\'s console sends them by UDP, so "wspath" here is not a finding.');
  const worst = causes.filter((c) => c.sev !== 'info');
  let verdict;
  if (!worst.length) {
    verdict = 'Nothing crossed a threshold: the stream held up under every stress' + (stats.length ? ' (' + stats.map((s) => s.name).join(', ') + ')' : '') +
      '. If the picture still looks bad to someone, the cause is on their side -- their window, their decoder, their link: run the check from where they are, or have them record a trace (Ctrl+K → Diagnostics).';
  } else {
    const m = worst[0];
    verdict = 'Main cause: ' + m.title + ' (' + m.phases.join(', ') + '; ' + m.area + '). ' + m.fix +
      (worst.length > 1 ? ' Also: ' + worst.slice(1, 3).map((c) => c.title + ' (' + c.phases.join(', ') + ')').join('; ') + '.' : '');
  }
  // Which version of the check recorded it: the meta line says (`qv`), and a run from before the stamp is read by what
  // it did -- a card started by a click (its `card` event says `clicked`) is version 2; anything older is 1.
  const qv = Number(meta.qv) || (recs.some((r) => r.ev === 'card' && Object.prototype.hasOwnProperty.call(r, 'clicked')) ? 2 : 1);
  return { ok: true, meta, qv, phases: stats, causes, verdict, notes, inferredCap, flatQp,
           coverage: { host: H.length, relay: R.length, agent: A.length, frames, refused } };
}
function phaseLine(s) {
  const h = s.host, a = s.arrive, f = (v, d) => (v == null ? '—' : Number(v).toFixed(d || 0));
  const bits = [];
  if (h) {
    bits.push('picture ' + (s.picture || (h.qpUnmeasured ? 'not measured' : '?')) + ' (' +
              (h.mode === 'tile1' ? 'tile1 ' + f(h.bits) + '-bit' : h.qpUnmeasured ? 'no quantiser reported' : 'QP ' + f(h.qp)) + ', ' + (h.scale == null ? 'size ?' : h.scale >= 995 ? 'full size' : f(h.scale / 10) + '% size') + ')');
    bits.push(f(h.fr) + '/' + f(h.fps) + ' fps' + (s.cardFps != null && CARD_MOVING.has(s.name) ? ' (the card drew ' + f(s.cardFps) + ')' : ''));
    if (h.wire != null) bits.push('uplink ' + f(h.wire) + '%');
    const lim = topOf(h.quality), sp = topOf(h.speed);
    if (lim && lim !== 'none') bits.push('quality limit: ' + lim);
    if (sp && sp !== 'none' && sp !== 'idle') bits.push('speed limit: ' + sp);
  } else bits.push('no host records');
  if (a && a.frames > 0) {
    if (a.exc95 != null) bits.push('behind ' + f(a.exc95) + ' ms');
    if (s.name === 'pointer' && a.rtt95) bits.push('pointer ' + f(a.rtt95) + ' ms');
  }
  if (s.relay && s.relay.drop) bits.push('relay shed ' + s.relay.drop);
  return s.name + ' ' + f(s.secs) + ' s: ' + bits.join(' · ');
}

// ---- before and after ------------------------------------------------------------------------------------------------
// The other half of improving the picture: a change is only an improvement when the same stresses, run again, read
// better. Phase by phase, by name; a metric moves only past a margin the run-to-run noise does not reach.
const CMP = [
  // [key, label, where, better, margin, unit, floor] -- a relative (×) margin also needs the absolute floor: 6 -> 55 ms
  // behind live is "nine times worse" and nothing anybody could see
  // THE MARGINS ARE WHAT AN UNCHANGED MACHINE DOES. Three runs of the same suite on one machine, nothing changed between
  // them (2026-11-09/10): a moving phase's median QP moved by up to 4 (drag 27 -> 31); a still phase recovering after the
  // load by up to 5 (rest 46 -> 51 -- where its few refinement steps fall); a keyframe share by 0.14 (video 0.19 -> 0.05
  // -- where the ~3 s keyframes fall in a 9 s window). A real change (a hardware encoder) moves these far more.
  ['qp', 'quantiser', 'host', 'lower', 4, ''],                  // still phases: QP_STILL_MARGIN
  ['scale', 'size', 'host', 'higher', 50, '‰'],
  ['fr', 'frames/s', 'host', 'higher', 0.15, '×', 1],
  ['wire', 'uplink busy', 'host', 'lower', 10, '%'],
  ['keyShare', 'keyframe share', 'host', 'lower', 0.15, ''],
  ['exc95', 'behind live p95 (at the agent)', 'arrive', 'lower', 0.25, '×', 50],
  ['gap95', 'frame gap p95 (at the agent)', 'arrive', 'lower', 0.25, '×', 50],
  ['rtt95', 'pointer p95 (at the agent)', 'arrive', 'lower', 0.25, '×', 50],
];
// The phases that show the screen AS IT WAS -- the desktop, whatever a person did, a page somebody had open -- are
// listed but not counted: two runs of them were shown different things. The test card's scenes and the pointer are
// the same every run, and only they decide better or worse.
const UNCONTROLLED = new Set(['idle', 'watch', 'wheel']);
// a still phase's QP is where its refinement steps happen to land (see CMP): it needs the wider margin
const QP_STILL_MARGIN = 6;
// the causes only a quantiser can show: in a run without one they are not measurable, not gone
const QP_ONLY = new Set(['recovery', 'refine-capped', 'refine', 'motion-only', 'qp-floor']);
// the picture word compare prints: "not measured" where the host gave no quantiser, never a blank "?"
const pictureWord = (p) => p.picture || (p.host && p.host.qpUnmeasured ? 'not measured' : null);
// under this many bits a pixel a frame a MOVING screen is starved on any H.264 encoder (see the rate causes)
const BPP_STARVED = 0.05;
function compare(before, after) {
  const A0 = before && before.phases ? before : analyze(before), A1 = after && after.phases ? after : analyze(after);
  const rows = [], notes = [];
  // TWO TALLIES. The picture as SENT (the host's numbers) is the machine's; delivery to the AGENT (behind live, gaps,
  // the pointer) is that plus the agent's own link at that moment -- which moved by 100+ ms between two runs made half an
  // hour apart with nothing changed on the machine (2026-11-10). The verdict is the picture's; delivery is said beside it.
  let better = 0, worse = 0, dBetter = 0, dWorse = 0;
  // Two runs made by different versions of the check measured differently -- the first live run (version 1) lost its
  // last phases' arrival side and ran its card a second ahead of the marks, so a version-2 run "regressed" against it
  // without anything changing on the machine (2026-11-09). Said, so nobody reads the check's own fix as the machine's.
  const v0 = A0.qv || (A0.meta && Number(A0.meta.qv)) || 1, v1 = A1.qv || (A1.meta && Number(A1.meta.qv)) || 1;
  if (v0 !== v1) notes.push('The two runs were made by different versions of the check (' + v0 + ' and ' + v1 + '): part of any difference is the check\'s own.');
  for (const p1 of A1.phases) {
    const p0 = A0.phases.find((p) => p.name === p1.name);
    if (!p0) { rows.push({ phase: p1.name, only: 'after' }); continue; }
    const counted = !UNCONTROLLED.has(p1.name);
    // the arrival side is compared only where BOTH runs received frames: a run whose copy of the stream was paused has
    // no arrival figures for that phase, and its zeros would read as the best latency ever measured
    const bothArrived = !!(p0.arrive && p0.arrive.frames > 0 && p1.arrive && p1.arrive.frames > 0);
    // A DIFFERENT ENCODE SIZE IS A DIFFERENT PICTURE. A watcher's window (or read mode) sets the encode: 1678×944 in one
    // run and 1920×1080 the next (2026-11-10) put 30% more pixels under the same bitrate cap, and the quantiser rose with
    // them -- "QP 39 -> 48" that nothing on the machine did. Shown; not counted.
    const a0 = p0.host && p0.host.w && p0.host.h ? p0.host.w * p0.host.h : 0, a1 = p1.host && p1.host.w && p1.host.h ? p1.host.w * p1.host.h : 0;
    const resized = !!(a0 && a1 && Math.abs(a1 - a0) > 0.1 * a0);
    const size = resized ? Math.round(p0.host.w) + '×' + Math.round(p0.host.h) + ' → ' + Math.round(p1.host.w) + '×' + Math.round(p1.host.h) : '';
    const moves = [];
    for (const [k, label, where, dir, margin, unit, floor] of CMP) {
      if (where === 'arrive' && !bothArrived) continue;
      if (k === 'keyShare' && (p0.still || p1.still)) continue;   // a still screen sends almost nothing BUT keyframes
      const b0 = p0[where] ? p0[where][k] : null, b1 = p1[where] ? p1[where][k] : null;
      if (b0 == null || b1 == null) continue;
      const rel = unit === '×';
      const d = b1 - b0;
      const m = k === 'qp' && (p0.still || p1.still) ? QP_STILL_MARGIN : margin;
      const big = rel ? Math.abs(d) > Math.max(m * Math.max(Math.abs(b0), 1), floor || 0) : Math.abs(d) > m;
      if (!big) continue;
      const good = dir === 'lower' ? d < 0 : d > 0;
      const sizeBound = resized && k === 'qp';   // the quantiser follows the pixels it has to fit
      if (counted && where === 'arrive') { if (good) dBetter++; else dWorse++; }
      else if (counted && !sizeBound) { if (good) better++; else worse++; }
      moves.push({ metric: k, label, before: b0, after: b1, better: good, where, sizeBound });
    }
    // ...and where either run has NO quantiser, the data each moving frame got stands in for it -- the one measure of a
    // moving frame both runs have. Decided per pixel (a resize does not move it), shown in kb a frame. Without it, Quick
    // Sync against the software encoder (2026-11-10) read "better" on frame rate alone, at 55 kb a frame against 196.
    const noQp = !!((p0.host && p0.host.qpUnmeasured) || (p1.host && p1.host.qpUnmeasured));
    if (noQp && !p0.still && !p1.still && p0.host && p1.host && p0.host.bppf != null && p1.host.bppf != null) {
      const d = p1.host.bppf - p0.host.bppf;
      if (Math.abs(d) > 0.25 * p0.host.bppf) {
        const good = d > 0;
        if (counted) { if (good) better++; else worse++; }
        moves.push({ metric: 'bppf', label: 'kb a frame (no quantiser to compare)', before: Math.round(p0.host.kbPerFrame), after: Math.round(p1.host.kbPerFrame), better: good, where: 'host', sizeBound: false });
      }
    }
    rows.push({ phase: p1.name, counted, pictureBefore: pictureWord(p0), pictureAfter: pictureWord(p1), moves, arrival: bothArrived, size });
  }
  if (rows.some((r) => r.size)) notes.push('The encode size changed between the runs (a watcher\'s window, or read mode): the quantiser at a different size is a different picture, so it is shown and not counted.');
  // A DIFFERENT PICTURE-QUALITY CAP IS A DIFFERENT SETTING, not the machine. Runs 6 and 7 on Quick Sync (2026-11-10)
  // changed the encoder AND a console's mode (Normal -> Speed: the top 2.99 -> 1.75 Mb/s), and were read as the encoder alone.
  const capRun = (X) => {
    const v = X.phases.map((p) => p.host && p.host.qcap).filter((x) => x != null);
    return v.length ? Math.round(pct(v, 0.5)) : X.inferredCap ? X.inferredCap.milli : null;
  };
  const capName = (m) => (m >= 1000 ? 'none' : (CAP_MODES[m] ? CAP_MODES[m] + ', ' : '') + Math.round(m / 10) + '%');
  const c0 = capRun(A0), c1 = capRun(A1);
  if (c0 != null && c1 != null && c0 !== c1)
    notes.push('A watcher\'s picture-quality cap was not the same in the two runs (' + capName(c0) + ' → ' + capName(c1) + '): a console\'s setting changed, so part of any difference in the rate, the data a frame and the quantiser is that setting, not the machine.');
  // A RUN WITH NO QUANTISER CANNOT SAY THE PICTURE GOT SHARPER: Quick Sync against the software encoder (2026-11-10)
  // read "coarse -> sharp" in five phases off a number that was never measured, and listed the rate and recovery causes
  // as gone. Its sharpness is not compared; the causes only a quantiser shows are "not measurable", not gone.
  const unm = (X) => X.phases.some((p) => p.host && p.host.qpUnmeasured);
  if (unm(A0) !== unm(A1)) notes.push('The quantiser was not measured in the ' + (unm(A1) ? 'new' : 'earlier') + ' run (an encoder that reports none), so the picture\'s sharpness is not compared: the data each moving frame got stands in for it, beside the frame rate, size, keyframes and delivery.');
  const ids0 = new Set(A0.causes.map((c) => c.id)), ids1 = new Set(A1.causes.map((c) => c.id));
  const blind = (c) => QP_ONLY.has(c.id) && c.phases.every((ph) => { const p = A1.phases.find((x) => x.name === ph); return !p || !p.host || p.host.qpUnmeasured; });
  const unmeasured = A0.causes.filter((c) => !ids1.has(c.id) && blind(c)).map((c) => c.title);
  const gone = A0.causes.filter((c) => !ids1.has(c.id) && !blind(c)).map((c) => c.title);
  const fresh = A1.causes.filter((c) => !ids0.has(c.id)).map((c) => c.title);
  const overall = better && !worse ? 'better' : worse && !better ? 'worse' : better || worse ? 'mixed' : 'same';
  const fmt = (m) => m.label + ' ' + (typeof m.before === 'number' && m.before % 1 ? m.before.toFixed(2) : m.before) + '→' + (typeof m.after === 'number' && m.after % 1 ? m.after.toFixed(2) : m.after);
  const lines = rows.map((r) => r.only ? r.phase + ': only in the new run' :
    r.phase + (r.counted ? '' : ' (the screen as it was -- not counted)') + ': ' +
    (r.pictureBefore !== r.pictureAfter ? 'picture ' + (r.pictureBefore || '?') + '→' + (r.pictureAfter || '?') + '; ' : '') +
    (r.moves.length ? r.moves.map((m) => (m.sizeBound ? '· ' : m.better ? '▲ ' : '▼ ') + fmt(m) + (m.sizeBound ? ' (a different encode size: not counted)' : '')).join(', ') : 'no change past the noise') +
    (r.size ? ' [encode ' + r.size + ']' : '') +
    (r.arrival ? '' : ' (no arrival figures: one run received no frames here)'));
  const delivery = dBetter && !dWorse ? 'better' : dWorse && !dBetter ? 'worse' : dBetter || dWorse ? 'mixed' : 'same';
  return { overall, better, worse, delivery, dBetter, dWorse, phases: rows, causesGone: gone, causesNew: fresh, causesUnmeasured: unmeasured, lines, notes,
           summary: 'Compared with the earlier run: the picture as sent is ' + overall + ' (' + better + ' better, ' + worse + ' worse' +
                    (rows.some((r) => !r.only && !r.counted) ? '; the screen-as-it-was phases not counted' : '') + ')' +
                    '; delivery to the agent (its own link too) is ' + delivery + ' (' + dBetter + ' better, ' + dWorse + ' worse)' +
                    (gone.length ? '. Gone: ' + gone.join('; ') : '') + (fresh.length ? '. New: ' + fresh.join('; ') : '') +
                    (unmeasured.length ? '. Not measurable in the new run (no quantiser): ' + unmeasured.join('; ') : '') + '.' +
                    (notes.length ? ' ' + notes.join(' ') : '') };
}

// A report for the room and the caller: short, the verdict first, a line a phase, then the causes with evidence.
function report(an, cmp) {
  const L = ['🔬 **Picture-quality check** — ' + an.verdict, ''];
  for (const s of an.phases) L.push('• ' + s.line);
  const real = an.causes.filter((c) => c.sev !== 'info');
  if (real.length) {
    L.push('', '**Causes**');
    real.slice(0, 6).forEach((c, i) => L.push((i + 1) + '. ' + (c.sev === 'high' ? '🔴 ' : '🟡 ') + c.title + ' — ' + c.evidence[0] + '. **Fix:** ' + c.fix));
  }
  for (const n of an.notes) L.push('ℹ ' + n);
  if (cmp) { L.push('', '**' + cmp.summary + '**'); for (const l of cmp.lines) L.push('• ' + l); }
  return L.join('\n');
}

// ---- the test card ----------------------------------------------------------------------------------------------------
// A small Windows program (core/desk/qcard.cs) that covers the visit's screen with REPRODUCIBLE stress, scene by scene
// on its own clock, then closes itself. Reproducible is the point: the screen as it happens to be gives a different
// answer every run, and two runs can only be compared when they were shown the same thing. It is put on the machine
// as one PowerShell file (the C# compiled there by Add-Type -- no binary is shipped), started AS THE PERSON AT THE
// DESKTOP by desk's launch, and it deletes its own file the moment it has been read. Esc closes it at any time, and a
// banner says what it is and that it will close by itself.
const fs = require('fs'), path = require('path');
let CARD_CS = null;
function cardSource() {
  if (CARD_CS == null) {
    const s = fs.readFileSync(path.join(__dirname, 'desk', 'qcard.cs'), 'utf8');
    CARD_CS = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;   // an editor's byte-order mark is not C#
  }
  return CARD_CS;
}
// The file's name: random, and of a shape nothing else uses, so nothing but this check ever matches it.
const CARD_NAME = /^agent-drive-qcard-[0-9a-f]{16}\.ps1$/;
// ...and what it drew, written beside it at its close (the same name, .json): read by the agent, then deleted
const CARD_STATS_NAME = /^agent-drive-qcard-[0-9a-f]{16}\.json$/;
function cardScript() {
  // Comment lines and indentation go (they are length on the wire, ~4 KB a write); the C# keeps its lines, since its
  // here-string closing '@ must start one.
  const cs = cardSource().split(/\r?\n/).filter((l) => l.trim() && !/^\s*\/\//.test(l)).map((l) => l.replace(/^\s+/, '').replace(/\s+$/, '')).join('\n');
  return [
    'param([string]$Plan = "text:8", [string]$Rect = "", [double]$Lead = 0.6, [double]$Hold = 0, [string]$Stats = "")',
    "$ErrorActionPreference = 'Stop'",
    // read already: PowerShell parses the whole file before it runs a line, so the file can go now
    'try { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {}',
    "Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'",
    cs,
    "'@",
    '[QCard]::Run($Plan, $Rect, $Lead, $Hold, $Stats)',
    '',
  ].join('\r\n');
}
// The marker: a solid MAGENTA block at the card's bottom-left corner, 24 px square at 10 px in from the edges -- what
// the agent waits for on the screen, so phase marks start from the card being VISIBLE rather than from a guess.
const MARK = { color: '#ff00ff', inset: 10, size: 24 };
function markerAt(rect) { return { x: rect[0] + MARK.inset + MARK.size / 2, y: rect[1] + rect[3] - MARK.inset - MARK.size / 2 }; }
// How long the card waits for the click on its corner that starts its clock, before it starts by itself; and how long
// the agent waits after the card's last scene before the next phase (the card closes 0.3 s after it, and the screen it
// uncovers repaints whole).
const CARD_HOLD_S = 8, CARD_GONE_MS = 1500;
// A phase must send at least this much (bits a second) for its keyframe SHARE to mean anything.
const KF_MIN_BPS = 100000;
// The version of the check that recorded a run, written in its meta line (`qv`); a run without one is version 1 (the
// first live run's, before the held stream and the click-started card). Raise it whenever what the check MEASURES
// changes, so compare can say when two runs were not measured alike.
//   1  the first live run: a stream that paused mid-check, a card a second ahead of the marks
//   2  the stream held, the card started by a click, the card's counts read back
//   3  the video scene's frames prepared: a slow machine draws it at full rate (it drew 3.4 fps before, so a version-2
//      video phase measured the card)
const QV = 3;

module.exports = { KINDS, CARD_ORDER, plan, Recorder, ndjson, parseNdjson, phasesOf, inPhase, PH_LEAD, PH_LAG,
                   analyze, compare, report, cardScript, cardSource, CARD_NAME, CARD_STATS_NAME, MARK, markerAt, MAGIC, HEADER,
                   CARD_HOLD_S, CARD_GONE_MS, KF_MIN_BPS, QV, UNCONTROLLED, CARD_MOVING, BPP_STARVED, QP_ONLY };

// A run read again, here, with no visit: the same summary the check gave, or the comparison with an earlier run.
if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const ci = args.indexOf('--compare');
  if (!file) { console.error('usage: node core/quality.js <run.ndjson> [--compare <earlier.ndjson>] [--json]'); process.exit(2); }
  const read = (f) => { try { return parseNdjson(fs.readFileSync(f, 'utf8')); } catch (e) { console.error('cannot read ' + f + ': ' + e.message); process.exit(2); } return []; };
  const an = analyze(read(file));
  const cmp = ci >= 0 && args[ci + 1] ? compare(analyze(read(args[ci + 1])), an) : null;
  if (args.includes('--json')) console.log(JSON.stringify({ verdict: an.verdict, phases: an.phases, causes: an.causes, notes: an.notes, coverage: an.coverage, compare: cmp || undefined }, null, 2));
  else console.log(report(an, cmp).replace(/\*\*/g, ''));
}

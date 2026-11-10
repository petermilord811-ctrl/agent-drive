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
      drop: sum(h, 'drop'), stall: sum(h, 'stall'), rsk: sum(h, 'rsk'), rc: sum(h, 'rc'), gop: med(h, 'gop', (v) => v > 0),
      rate: med(h, 'rate', (v) => v > 0), link: med(h, 'link', (v) => v > 0), gp: med(h, 'gp', (v) => v > 0),
      refine: sum(h, 'refine'), rebuild: sum(h, 'rebuild'), ished: sum(h, 'ished'), wsmv: sum(h, 'wsmv'), uinj: sum(h, 'uinj'),
      quality: hist(h, 'qwhy'), speed: hist(h, 'swhy'), input: hist(h, 'iwhy'),
      qval: med(h, 'qval'),
    };
  }
  if (rr.length) {
    // the relay's per-viewer rows mark the reader's own with me:1 -- which is how "the relay shed frames" is told
    // apart into "to this agent" (this machine's own downlink) and "to somebody else watching"
    let mine = 0, mineBl = 0, others = 0;
    for (const r of rr) for (const row of Array.isArray(r.pv) ? r.pv : []) {
      if (row && row.me) { mine = Math.max(mine, Number(row.p) || 0); mineBl = Math.max(mineBl, Number(row.bl) || 0); }
      else if (row) others = Math.max(others, Number(row.p) || 0);
    }
    st.relay = { drop: sum(rr, 'drop'), bl95: maxOf(rr, 'bl95'), why: hist(rr, 'why'), viewers: maxOf(rr, 'v'),
                 mineP: mine, mineBlKB: mineBl, othersP: others };
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
// soft: a little of either lost; coarse: the rest. null when the host reported nothing to judge it by.
function pictureOf(st) {
  const h = st.host;
  if (!h) return null;
  const scale = h.scale == null ? 1000 : h.scale;
  if (h.mode === 'tile1') return scale >= 950 && (h.bits == null || h.bits >= 7) ? 'sharp' : scale >= 800 && (h.bits == null || h.bits >= 5) ? 'soft' : 'coarse';
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
      if (motion && h.qp != null && (share(Q, 'rate', n) >= 0.3 || h.qp >= 33)) {
        // TWO causes, not one: coarse because the uplink is full (the link) and coarse while it has room (the ABR is
        // holding the rate -- the product's own choice) want opposite fixes, and one id merged across phases would
        // let the second overwrite the first
        const full = h.wire != null && h.wire >= 60;
        add(full ? 'rate-link' : 'rate-held', h.qp >= 38 ? 'high' : 'warn', full ? 'link' : 'codec', P,
            'Motion is coarse: the bitrate ceiling raises the quantiser to ' + fmt(h.qp) + ' while the picture moves',
            'QP ' + fmt(h.qp) + ' (p95 ' + fmt(h.qp95) + ') · sending ' + kbps(h.bitrate) + ' of ' + kbps(h.rate) + ' offered · link ' + kbps(h.link || h.gp) + ' · uplink busy ' + fmt(h.wire) + '%',
            full ? 'The uplink is full while it moves: the rate cannot rise until less is sent (keyframes first).'
                 : 'The uplink has room (' + fmt(h.wire) + '% busy) yet the rate is held: the ABR is not raising the offered rate for motion -- a codec/ABR change, not the network.');
      }
      if (s.still && h.qp != null && h.qp > 28 && h.qpSeen >= 3) {
        add('refine', 'warn', 'codec', P,
            h.refine ? 'A still picture stays coarse (QP ' + fmt(h.qp) + ') although refinement ran ' + h.refine + '×' : 'A still picture stays coarse (QP ' + fmt(h.qp) + '): the idle refinement did not run',
            'QP ' + fmt(h.qp) + ' on a still screen · refine ' + h.refine + ' · rebuild ' + h.rebuild,
            h.refine ? 'The encoder may be accepting the refinement and ignoring it: compare QP the second after each refine.'
                     : 'A still screen should be refined to a low QP within a few seconds: check why the refinement pass is not firing (its QP gate and its keyframe budget).');
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
        add('encoder', h.hwEnc === 0 ? 'high' : 'warn', 'machine', P,
            h.hwEnc === 0 ? 'The machine encodes in SOFTWARE and cannot keep up' : 'The machine\'s encoder cannot keep up',
            'encode p95 ' + fmt(h.enc95, 1) + ' ms against a ' + fmt(interval, 1) + ' ms frame · ' + (h.hwEnc === 0 ? 'software encoder' : h.hwEnc === 1 ? 'hardware encoder' : 'encoder kind not reported') + ' · ' + fmt(h.w) + '×' + fmt(h.h),
            h.hwEnc === 0 ? 'No hardware H.264 encoder is in use: check the GPU driver and the host\'s preferHardware.' : 'A smaller encode or a lower frame rate; or a busy GPU on that machine.');
      }
      if (share(S, 'capture', n) >= 0.3) {
        add('capture', 'warn', 'machine', P, 'Capturing the screen is slow on the machine', 'capture p95 ' + fmt(h.cap95, 1) + ' ms · swhy capture',
            'Usually cursor compositing, a busy GPU or a ring with no free slot on that machine.');
      }
      if (motion && h.fps > 0 && h.fr != null && h.fr < 0.5 * h.fps && share(S, 'paced', n) >= 0.3) {
        add('choppy', 'warn', 'link', P, 'Motion is choppy: ' + fmt(h.fr) + ' of ' + fmt(h.fps) + ' frames a second, paced down by the ABR',
            'frames ' + fmt(h.fr) + '/' + fmt(h.fps) + ' · swhy paced', 'The frame rate was lowered for the link: the cause is the rate and the link above.');
      }
      if (h.keyShare != null && h.keyShare >= 0.5 && h.kf >= 2) {
        const forced = h.refine + h.rebuild;
        add('keyframes', h.keyShare >= 0.7 ? 'high' : 'warn', 'codec', P,
            'Keyframes are ' + Math.round(100 * h.keyShare) + '% of what is sent',
            h.kf + ' keyframes · ' + h.refine + ' from refinement, ' + h.rebuild + ' from encoder rebuilds, the rest periodic (GOP ' + fmt(h.gop) + ') or asked for by a viewer',
            forced >= h.kf / 2 ? 'Most are forced by refinement/rebuilds: those are the product\'s own choices -- spend fewer.'
                               : 'Most are periodic or requested: a longer GOP, or find who asks for them (a resync, a viewer joining).');
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
      if (P === 'pointer' && a.mv > 0) {
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
  void ctx;
  return [...out.values()].sort((x, y) => SEV[x.sev] - SEV[y.sev] || y.phases.length - x.phases.length);
}

// ---- the whole run -------------------------------------------------------------------------------------------------
// -> {ok, meta, phases:[stats + line], causes, verdict, coverage, notes}
function analyze(recs, opts) {
  opts = opts || {};
  recs = Array.isArray(recs) ? recs : parseNdjson(recs);
  const meta = recs.find((r) => r.c === 'meta') || {};
  const H = recs.filter((r) => r.c === 'h' && !r.ev), R = recs.filter((r) => r.c === 'r' && !r.ev), A = recs.filter((r) => r.c === 'a' && !r.ev);
  const P = phasesOf(recs);
  const stats = P.map((p) => phaseStats(p, H, R, A));
  for (const s of stats) s.line = phaseLine(s);
  const causes = causesOf(stats, opts);
  const notes = [];
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
  if (!frames) notes.push('No video reached the agent during the check -- every arrival figure is empty. The stream may have been paused for it, or the host stopped capturing.');
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
  return { ok: true, meta, phases: stats, causes, verdict, notes,
           coverage: { host: H.length, relay: R.length, agent: A.length, frames, refused } };
}
function phaseLine(s) {
  const h = s.host, a = s.arrive, f = (v, d) => (v == null ? '—' : Number(v).toFixed(d || 0));
  const bits = [];
  if (h) {
    bits.push('picture ' + (s.picture || '?') + ' (' + (h.mode === 'tile1' ? 'tile1 ' + f(h.bits) + '-bit' : 'QP ' + f(h.qp)) + ', ' + (h.scale == null ? 'size ?' : h.scale >= 995 ? 'full size' : f(h.scale / 10) + '% size') + ')');
    bits.push(f(h.fr) + '/' + f(h.fps) + ' fps');
    if (h.wire != null) bits.push('uplink ' + f(h.wire) + '%');
    const lim = topOf(h.quality), sp = topOf(h.speed);
    if (lim && lim !== 'none') bits.push('quality limit: ' + lim);
    if (sp && sp !== 'none' && sp !== 'idle') bits.push('speed limit: ' + sp);
  } else bits.push('no host records');
  if (a) {
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
  // [key, label, where, better, margin, unit]
  ['qp', 'quantiser', 'host', 'lower', 2, ''],
  ['scale', 'size', 'host', 'higher', 50, '‰'],
  ['fr', 'frames/s', 'host', 'higher', 0.15, '×'],
  ['wire', 'uplink busy', 'host', 'lower', 10, '%'],
  ['keyShare', 'keyframe share', 'host', 'lower', 0.1, ''],
  ['exc95', 'behind live p95', 'arrive', 'lower', 0.25, '×'],
  ['gap95', 'frame gap p95', 'arrive', 'lower', 0.25, '×'],
  ['rtt95', 'pointer p95', 'arrive', 'lower', 0.25, '×'],
];
function compare(before, after) {
  const A0 = before && before.phases ? before : analyze(before), A1 = after && after.phases ? after : analyze(after);
  const rows = [];
  let better = 0, worse = 0;
  for (const p1 of A1.phases) {
    const p0 = A0.phases.find((p) => p.name === p1.name);
    if (!p0) { rows.push({ phase: p1.name, only: 'after' }); continue; }
    const moves = [];
    for (const [k, label, where, dir, margin, unit] of CMP) {
      const v0 = p0[where] ? p0[where][k] : null, v1 = p1[where] ? p1[where][k] : null;
      if (v0 == null || v1 == null) continue;
      const rel = unit === '×';
      const d = v1 - v0;
      const big = rel ? Math.abs(d) > margin * Math.max(Math.abs(v0), 1) : Math.abs(d) > margin;
      if (!big) continue;
      const good = dir === 'lower' ? d < 0 : d > 0;
      if (good) better++; else worse++;
      moves.push({ metric: k, label, before: v0, after: v1, better: good });
    }
    rows.push({ phase: p1.name, pictureBefore: p0.picture, pictureAfter: p1.picture, moves });
  }
  const ids0 = new Set(A0.causes.map((c) => c.id)), ids1 = new Set(A1.causes.map((c) => c.id));
  const gone = A0.causes.filter((c) => !ids1.has(c.id)).map((c) => c.title);
  const fresh = A1.causes.filter((c) => !ids0.has(c.id)).map((c) => c.title);
  const overall = better && !worse ? 'better' : worse && !better ? 'worse' : better || worse ? 'mixed' : 'same';
  const fmt = (m) => m.label + ' ' + (typeof m.before === 'number' && m.before % 1 ? m.before.toFixed(2) : m.before) + '→' + (typeof m.after === 'number' && m.after % 1 ? m.after.toFixed(2) : m.after);
  const lines = rows.map((r) => r.only ? r.phase + ': only in the new run' :
    r.phase + ': ' + (r.pictureBefore !== r.pictureAfter ? 'picture ' + (r.pictureBefore || '?') + '→' + (r.pictureAfter || '?') + '; ' : '') +
    (r.moves.length ? r.moves.map((m) => (m.better ? '▲ ' : '▼ ') + fmt(m)).join(', ') : 'no change past the noise'));
  return { overall, better, worse, phases: rows, causesGone: gone, causesNew: fresh, lines,
           summary: 'Compared with the earlier run: ' + overall + ' (' + better + ' better, ' + worse + ' worse)' +
                    (gone.length ? '. Gone: ' + gone.join('; ') : '') + (fresh.length ? '. New: ' + fresh.join('; ') : '') + '.' };
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
function cardScript() {
  // Comment lines and indentation go (they are length on the wire, ~4 KB a write); the C# keeps its lines, since its
  // here-string closing '@ must start one.
  const cs = cardSource().split(/\r?\n/).filter((l) => l.trim() && !/^\s*\/\//.test(l)).map((l) => l.replace(/^\s+/, '').replace(/\s+$/, '')).join('\n');
  return [
    'param([string]$Plan = "text:8", [string]$Rect = "", [double]$Lead = 0.6)',
    "$ErrorActionPreference = 'Stop'",
    // read already: PowerShell parses the whole file before it runs a line, so the file can go now
    'try { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {}',
    "Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'",
    cs,
    "'@",
    '[QCard]::Run($Plan, $Rect, $Lead)',
    '',
  ].join('\r\n');
}
// The marker: a solid MAGENTA block at the card's bottom-left corner, 24 px square at 10 px in from the edges -- what
// the agent waits for on the screen, so phase marks start from the card being VISIBLE rather than from a guess.
const MARK = { color: '#ff00ff', inset: 10, size: 24 };
function markerAt(rect) { return { x: rect[0] + MARK.inset + MARK.size / 2, y: rect[1] + rect[3] - MARK.inset - MARK.size / 2 }; }

module.exports = { KINDS, CARD_ORDER, plan, Recorder, ndjson, parseNdjson, phasesOf, inPhase, PH_LEAD, PH_LAG,
                   analyze, compare, report, cardScript, cardSource, CARD_NAME, MARK, markerAt, MAGIC, HEADER };

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

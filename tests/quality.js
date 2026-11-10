// quality.js -- the picture-quality check (core/quality.js + the serve's `quality` verb), offline.
//
// What it holds the check to:
//   - plan: the phases come from what the visit was GRANTED -- a watch-only visit still gets its baseline and is told
//     which consent would add the rest; a phase that needs a consent the visit lacks is refused, never half-run; the
//     test card's scenes run back to back (one program, one clock); a check is bounded.
//   - the recorder reads a video frame by its 20-byte header only: frames, keyframes, bytes, the gaps between them,
//     and "behind live" computed exactly as the console does (growth of arrival - pts above its best); audio and
//     anything that is not a frame are ignored; the pointer's round trip closes on a cursor at a position sent.
//   - analyze names the cause a phase's numbers prove, with WHERE it lives and the fix -- on a synthetic run built
//     with known faults, each control alongside: a healthy phase names nothing.
//   - compare says better when the same stresses read better, and which causes went away.
//   - the card script is ASCII (PowerShell 5.1 reads it as ANSI), parameterised, and self-deleting -- and on Windows
//     it really COMPILES, and its magenta corner lands where markerAt() says the agent should look.
//   - the serve is wired to all of it (source pins on core/agent-join.js).
//   node tests/quality.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const KIT = path.join(__dirname, '..');
const Q = require(path.join(KIT, 'core', 'quality.js'));
const verbs = require(path.join(KIT, 'core', 'verbs.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// ---- plan --------------------------------------------------------------------------------------------------------
{
  const none = Q.plan(null, {});
  ok(none.ok && none.phases.map((p) => p.name).join() === 'idle', 'watch-only visit: the baseline alone (' + none.phases.map((p) => p.name) + ')');
  ok(none.skipped.length === 2 && /access \{shell:1\}/.test(none.skipped[0].why) && /access \{control:1\}/.test(none.skipped[1].why),
     '...and it is told which consent adds the card and the pointer');
  const all = Q.plan(undefined, { control: true, shell: true, windows: true });
  ok(all.ok && all.phases.map((p) => p.name).join() === 'idle,text,scroll,drag,video,cuts,rest,pointer', 'everything granted on Windows: the whole suite in order');
  ok(all.card && all.card.plan === 'text:8,scroll:10,drag:10,video:10,cuts:8,rest:8' && all.card.first === 1, 'the card gets ONE plan for its scenes, starting at the right phase');
  ok(all.total === 70, 'the suite is 70 s of phases (' + all.total + ')');
  const lin = Q.plan(undefined, { control: true, shell: true, windows: false });
  ok(lin.ok && lin.phases.map((p) => p.name).join() === 'idle,pointer' && /Windows only/.test(lin.skipped[0].why), 'not Windows: no card, and it says why');
  const r1 = Q.plan(['video'], { control: true });
  ok(!r1.ok && r1.needs === 'shell' && /"do":"access","shell":1/.test(r1.why), 'a card scene without the run-commands consent is refused, naming the ask');
  const r2 = Q.plan(['pointer'], { shell: true });
  ok(!r2.ok && r2.needs === 'control', 'the pointer without the keyboard-and-mouse consent is refused');
  const r3 = Q.plan(['text', 'pointer', 'video'], { control: true, shell: true, windows: true });
  ok(!r3.ok && /one after another/.test(r3.why), 'card scenes split by another phase are refused (the card has one clock)');
  ok(!Q.plan(['fireworks'], {}).ok, 'an unknown phase is refused, listing the real ones');
  ok(!Q.plan(['video'], { shell: true, windows: false }).ok, 'a card scene on a machine that is not Windows is refused');
  const long = Q.plan([{ name: 'watch', secs: 120 }, { name: 'watch', secs: 120 }, { name: 'idle', secs: 120 }], {});
  ok(!long.ok && /at most 300/.test(long.why), 'a check is bounded at 300 s');
  const sc = Q.plan(['idle', { name: 'watch', secs: 30 }], {}, 20);
  ok(sc.ok && sc.phases[0].secs === 16 && sc.phases[1].secs === 30, 'secs scales the defaults; a phase\'s own secs wins (' + sc.phases.map((p) => p.secs) + ')');
  ok(Q.plan(['idle'], {}).phases[0].secs === 8 && Q.plan([{ name: 'idle', secs: 1 }], {}).phases[0].secs === 4, 'a phase is at least 4 s');
}

// ---- the recorder ------------------------------------------------------------------------------------------------
const frameBuf = (key, codec, ptsMs, bytes) => {
  const b = Buffer.alloc(Q.HEADER + (bytes || 100));
  b.writeUInt32LE(Q.MAGIC, 0); b.writeUInt32LE((key ? 1 : 0) | ((codec || 0) << 8), 4); b.writeBigInt64LE(BigInt(Math.round(ptsMs * 10000)), 8);
  return b;
};
{
  const rec = new Q.Recorder(1000);
  // 30 frames over one second, on time: pts and arrival advance together
  for (let i = 0; i < 30; i++) rec.binary(frameBuf(i === 0, 0, 50000 + i * 33.3, 1000), 1000 + i * 33.3);
  rec.binary(frameBuf(false, 2, 50000, 500), 1500);                 // audio: not the picture
  rec.binary(Buffer.from('not a frame at all, not even close'), 1500);
  rec.tick(2000);
  const a = rec.records().find((r) => r.c === 'a');
  ok(a && a.fr === 30 && a.kf === 1 && a.by === 30000, 'one second of frames: 30 frames, 1 keyframe, the payload bytes (' + JSON.stringify(a && { fr: a.fr, kf: a.kf, by: a.by }) + ')');
  ok(a && Math.abs(a.gap50 - 33.3) < 0.2 && a.exc95 <= 1, 'gaps of a frame interval, and nothing behind live when on time (' + (a && a.gap50) + ' ms, ' + (a && a.exc95) + ' ms)');
  // the next second: each frame arrives 20 ms later than the one before relative to its pts -- a queue building
  for (let i = 0; i < 30; i++) rec.binary(frameBuf(false, 0, 51000 + i * 33.3, 1000), 2000 + i * 53.3);
  rec.tick(3600);
  const b = rec.records().filter((r) => r.c === 'a')[1];
  ok(b && b.exc95 > 450 && b.exc95 < 650, 'a queue building shows as behind-live growth, as the console measures it (' + (b && b.exc95) + ' ms)');
  ok(b && b.gap95 > 50, '...and the gaps widen (' + (b && b.gap95) + ' ms)');
  // a host that restarted its clock (pts jumps back by an hour) re-anchors instead of reading an hour of queue
  rec.binary(frameBuf(false, 0, 51000 + 31 * 33.3 - 3600e3, 1000), 3700);
  rec.binary(frameBuf(false, 0, 51000 + 32 * 33.3 - 3600e3, 1000), 3733);
  rec.tick(4000);
  const c = rec.records().filter((r) => r.c === 'a')[2];
  ok(c && c.exc95 < 100, 'a pts jump (a restarted host) re-anchors the baseline rather than reporting an hour behind (' + (c && c.exc95) + ')');
  // trace records from the host and the relay keep their fields, lose their type, gain this clock
  rec.text({ type: 'trace', c: 'h', seq: 1, qp: 30, scale: 1000 }, 4100);
  rec.text({ type: 'trace', c: 'r', drop: 0 }, 4150);
  rec.text({ type: 'chat', text: 'hello' }, 4160);
  const h = rec.records().find((r) => r.c === 'h');
  ok(h && h.t === 3100 && h.qp === 30 && h.type === undefined && rec.seen.h === 1 && rec.seen.r === 1, 'trace records are stamped on this clock and kept (' + JSON.stringify(h) + ')');
  // the pointer: a cursor that comes back at a position sent closes the loop
  rec.noteMove(0.5, 0.5, 5000); rec.noteMove(0.51, 0.5, 5033); rec.noteMove(0.52, 0.5, 5066);
  rec.text({ type: 'cursor', x: 0.5101, y: 0.5, visible: true }, 5150);
  rec.text({ type: 'cursor', x: 0.9, y: 0.9 }, 5160);                  // not a position we sent
  rec.tick(6000);
  const d = rec.records().filter((r) => r.c === 'a')[3];
  ok(d && d.rttn === 1 && Math.abs(d.rtt50 - 117) < 1 && d.mvdrop === 1 && d.mv === 3, 'the pointer round trip closes on the newest matching move; older ones count as dropped (' + JSON.stringify(d && { rttn: d.rttn, rtt50: d.rtt50, mvdrop: d.mvdrop }) + ')');
  rec.phase('scroll', true, 6000, { secs: 10 }); rec.phase('scroll', false, 16000);
  const evs = rec.records().filter((r) => r.ev === 'phase');
  ok(evs.length === 2 && evs[0].on === 1 && evs[0].secs === 10 && /starts \(10 s\)/.test(evs[0].d) && evs[1].on === 0, 'phase marks carry their name, length and a line the trace report prints');
  rec.meta({ host: '10000' });
  ok(rec.records()[0].c === 'meta' && rec.records()[0].t === 0, 'the meta record leads the file');
  const back = Q.parseNdjson(Q.ndjson(rec.records()) + 'not json\n');
  ok(back.length === rec.records().length, 'NDJSON round-trips, and a broken line is skipped');
}

// ---- analyze -----------------------------------------------------------------------------------------------------
// A run built with known faults. Each phase gets 1 s host / relay / arrival records, stamped like the real thing.
function run(spec) {
  const recs = [{ c: 'meta', by: 'test', t: 0 }];
  let t = 1000;
  for (const ph of spec) {
    recs.push({ c: 'a', ev: 'phase', name: ph.name, on: 1, t });
    for (let s = 1; s <= ph.secs; s++) {
      const at = t + s * 1000;
      recs.push(Object.assign({ c: 'h', ms: 1000, fr: 30, fps: 30, by: 100000, kb: 10000, kf: 0, scale: 1000, qp: 24, wire: 200, hw: 1,
                                enc95: 8, cap95: 30, rate: 4e6, link: 0, gp: 3e6, gop: 300, refine: 0, rebuild: 0, drop: 0, rsk: 0, rc: 0,
                                w: 1920, h: 1080, mode: 'h264', bits: 8, breq: 0, qwhy: 'none', swhy: 'none', iwhy: 'idle', t: at + 120 }, ph.h || {},
                                // per second: ph.hs[s - 1] overrides that one second (a quantiser stepping down, a keyframe now and then)
                                (ph.hs && ph.hs[s - 1]) || {}));
      recs.push(Object.assign({ c: 'r', drop: 0, bl95: 0, v: 1, why: 'none', pv: [{ me: 1, p: 0, bl: 0 }], t: at + 140 }, ph.r || {}));
      recs.push(Object.assign({ c: 'a', fr: 30, kf: 0, by: 100000, gap50: 33, gap95: 40, exc50: 20, exc95: 40, mv: 0, rttn: 0, rtt50: 0, rtt95: 0, t: at }, ph.a || {}));
    }
    t += ph.secs * 1000;
    recs.push({ c: 'a', ev: 'phase', name: ph.name, on: 0, t });
  }
  return recs;
}
const ids = (an) => an.causes.map((c) => c.id);
{
  // a HEALTHY run names nothing
  const good = Q.analyze(run([{ name: 'idle', secs: 6 }, { name: 'video', secs: 6 }]));
  ok(good.causes.filter((c) => c.sev !== 'info').length === 0, 'a healthy run names no cause (' + ids(good) + ')');
  ok(/Nothing crossed a threshold/.test(good.verdict), 'and its verdict says so, and where to look next');
  ok(good.phases.length === 2 && good.phases[0].n.host === 5, 'a phase is judged on its own seconds: the first after its start is left out (' + good.phases[0].n.host + ' of 6)');
  ok(good.phases[0].picture === 'sharp' && /picture sharp \(QP 24, full size\)/.test(good.phases[0].line), 'a phase gets one word for its picture and a line (' + good.phases[0].line + ')');

  // a BAD run: still is fine, scrolling is coarse with room on the uplink, video saturates the uplink and shrinks
  const bad = Q.analyze(run([
    { name: 'text', secs: 6 },
    { name: 'scroll', secs: 6, h: { qp: 37, qwhy: 'rate', wire: 400 } },
    { name: 'video', secs: 6, h: { qp: 40, scale: 600, qwhy: 'ladder', wire: 930, swhy: 'send', drop: 1, kb: 70000 }, r: { drop: 2, why: 'shed', bl95: 400000, pv: [{ me: 1, p: 1, bl: 390 }] }, a: { exc95: 1500, exc50: 900, gap95: 400, gap50: 60 } },
    { name: 'rest', secs: 6, h: { qp: 33, fr: 1 } },
  ]));
  const by = (id) => bad.causes.find((c) => c.id === id);
  ok(by('ladder') && by('ladder').sev === 'high' && by('ladder').area === 'link' && by('ladder').phases.join() === 'video', 'the ladder (60% size) is named for video, as the link (' + JSON.stringify(by('ladder') && by('ladder').phases) + ')');
  ok(by('uplink') && by('uplink').sev === 'high' && /93% busy/.test(by('uplink').title), 'a 93%-busy uplink is named');
  ok(by('drops') && by('relay-shed'), 'host drops and relay shedding are named');
  ok(by('relay-shed') && /THIS agent/.test(by('relay-shed').title), '...and the relay shedding is put on the agent\'s OWN link when its row is the deepest');
  ok(by('rate-held') && by('rate-held').phases.join() === 'scroll' && by('rate-held').area === 'codec' && /has room/.test(by('rate-held').fix),
     'coarse scrolling with room on the uplink is the ABR holding the rate (codec), not the network');
  ok(by('rate-link') && by('rate-link').phases.join() === 'video' && by('rate-link').area === 'link',
     '...while coarse video on a full uplink is the link -- a separate cause, so neither overwrites the other');
  ok(by('motion-only') && by('motion-only').phases.join() === 'scroll,video', 'a cross-phase cause lists every phase it is seen in');
  ok(by('refine') && by('refine').phases.join() === 'rest' && by('refine').area === 'codec', 'a still picture left at QP 33 after the load: refinement did not run');
  ok(by('behind') && by('behind').sev === 'high' && by('bursty'), 'latency building (1.5 s) and bursty delivery are named from the arrival side');
  ok(by('keyframes') == null, 'keyframes at 70% of bytes with ZERO keyframes counted is not a keyframe cause (the control)');
  ok(by('motion-only') && by('motion-only').sev === 'info', 'sharp at rest, coarse in motion is said, as information');
  ok(/^Main cause: /.test(bad.verdict) && bad.causes[0].sev === 'high', 'the verdict leads with a high-severity cause (' + bad.verdict.slice(0, 90) + ')');
  ok(bad.causes.every((c) => c.fix && c.evidence.length && c.area), 'every cause carries evidence, a fix and where it lives');

  // the agent's own WebSocket pointer is not a finding
  const ptr = Q.analyze(run([{ name: 'pointer', secs: 5, h: { wsmv: 30, iwhy: 'wspath' }, a: { mv: 30, rttn: 0 } }]));
  ok(ptr.notes.some((n) => /agent's path/.test(n)), 'moves over the WebSocket in the pointer phase are explained as the agent\'s path');
  ok(ptr.causes.some((c) => c.id === 'no-echo'), 'moves with no cursor coming back: the round trip is said to be unmeasured, not fast');
  const slow = Q.analyze(run([{ name: 'pointer', secs: 5, a: { mv: 30, rttn: 20, rtt50: 240, rtt95: 380 } }]));
  ok(slow.causes.some((c) => c.id === 'pointer' && /380 ms/.test(c.title)), 'a 380 ms pointer round trip is named');

  // ---- what the first REAL run (2026-11-09) taught the reading ----
  // the agent's own copy of the stream paused: no frames reached it, so nothing about the pointer coming back can be
  // said -- the relay sends cursor updates only to viewers it streams to. Said as missing evidence, not as a finding.
  const paused = Q.analyze(run([{ name: 'idle', secs: 5 }, { name: 'pointer', secs: 6, a: { mv: 30, rttn: 0, fr: 0, by: 0, gap50: 0, gap95: 0, exc50: 0, exc95: 0 } }]));
  ok(!paused.causes.some((c) => c.id === 'no-echo'), 'no frames reached the agent: "no cursor came back" is NOT claimed (it was, on the first real run)');
  ok(paused.notes.some((n) => /No video reached the agent in pointer while the host was encoding/.test(n)), '...the missing arrival side is said instead, for that phase');
  ok(!/behind \d+ ms/.test(paused.phases[1].line) && /behind \d+ ms/.test(paused.phases[0].line), '...and its phase line prints no "behind 0 ms" that nothing measured (the phase that got frames still does)');
  // a still screen whose quantiser steps DOWN with each refinement is recovering slowly -- not ignoring them
  const steps = [49, 49, 49, 42, 42, 42, 34, 31].map((qp, i) => ({ qp, fr: 1, by: 9000, kb: 0, refine: i === 3 || i === 6 ? 1 : 0, kf: i === 3 || i === 6 ? 1 : 0 }));
  const rec2 = Q.analyze(run([{ name: 'rest', secs: 8, hs: steps }]));
  const rv = rec2.causes.find((c) => c.id === 'recovery');
  ok(!!rv && /QP 49 → 31/.test(rv.title) && rv.area === 'codec' && !rec2.causes.some((c) => c.id === 'refine'),
     'a quantiser stepping 49 → 31 with each refinement is SLOW RECOVERY, not refinement ignored (' + (rv && rv.title) + ')');
  // under QP 33 the bitrate is not what holds a still screen (the host's own rule for the rate limit is QP >= 33): one that
  // stays at 31 through two refinements is "refinement did nothing" ...
  const flat = Q.analyze(run([{ name: 'rest', secs: 8, h: { qp: 31, fr: 1, by: 9000, kb: 0 }, hs: [{}, {}, { refine: 1, kf: 1 }, {}, {}, { refine: 1, kf: 1 }] }]));
  ok(flat.causes.some((c) => c.id === 'refine' && /although refinement ran 2×/.test(c.title)) && !flat.causes.some((c) => c.id === 'recovery' || c.id === 'refine-capped'),
     '...while one that stays at 31 through two refinements is still "refinement did nothing" (the control)');
  // ... while at QP 42 it is the cap, even when the host's label names a bigger limit (a watcher's window) first
  const viewportCapped = Q.analyze(run([{ name: 'rest', secs: 8, h: { qp: 42, fr: 1, by: 9000, kb: 0, qwhy: 'viewport', qval: 87 }, hs: [{}, {}, { refine: 1, kf: 1 }, {}, {}, { refine: 1, kf: 1 }] }]));
  const vcap = viewportCapped.causes.find((c) => c.id === 'refine-capped');
  ok(!!vcap && /the host's rule for the rate limit \(labelled viewport, which outranks it\)/.test(vcap.evidence[0]),
     '...and at QP 42 it is held to the cap even when the label says viewport -- by the host\'s own rule, and said so');
  // keyframes every 2 s while the picture moves, at GOP 300 with no refinement or rebuild: named across the phases
  const every2 = Array.from({ length: 10 }, (_, i) => (i % 2 ? { kf: 1, kb: 40000 } : {}));
  const kfr = Q.analyze(run([{ name: 'scroll', secs: 10, hs: every2 }, { name: 'video', secs: 10, hs: every2 }]));
  const ku = kfr.causes.find((c) => c.id === 'kf-unexplained');
  ok(!!ku && /every ~(1\.[5-9]|2\.\d) s/.test(ku.title) && ku.phases.join() === 'scroll,video', 'a keyframe every ~2 s that no GOP, refinement or rebuild explains is named across the moving phases (' + (ku && ku.title) + ')');
  const rare = Q.analyze(run([{ name: 'scroll', secs: 10, hs: [{}, {}, {}, { kf: 1, kb: 40000 }] }, { name: 'video', secs: 10 }]));
  ok(!rare.causes.some((c) => c.id === 'kf-unexplained'), '...and one keyframe in 20 s is not (the control)');
  // a share of next to nothing is not a finding: a still phase sending a few KB, most of it one refresh
  const tiny = Q.analyze(run([{ name: 'text', secs: 6, h: { fr: 1, by: 2000, kb: 0 }, hs: [{}, {}, { kf: 1, kb: 1900 }, { kf: 1, kb: 1900 }] }]));
  ok(!tiny.causes.some((c) => c.id === 'keyframes'), 'keyframes that are most of ~2 KB a second are not called a keyframe problem');

  // coverage: no host records is said FIRST, and a refused trace names the relay
  const refused = Q.analyze([{ c: 'meta', t: 0 }, { c: 'a', ev: 'trace-refused', d: 'x', t: 1500 }, { c: 'a', ev: 'phase', name: 'idle', on: 1, t: 2000 },
                             { c: 'a', fr: 30, by: 1000, t: 3500 }, { c: 'a', fr: 30, by: 1000, t: 4500 }, { c: 'a', ev: 'phase', name: 'idle', on: 0, t: 6000 }]);
  ok(refused.causes[0].id === 'no-host-trace' && /2\.243\.0/.test(refused.causes[0].fix), 'a relay that refused the trace switch is named first, with the version that allows it');
  const linux = Q.analyze(run([{ name: 'idle', secs: 4 }]).filter((r) => r.c !== 'h'));
  ok(linux.causes[0].id === 'no-host-trace' && /Linux host never emits/.test(linux.causes[0].fix), 'no host records otherwise: a Linux or older host, said plainly');
  // a check stopped mid-phase: the open phase runs to the end of the file
  const cut = Q.analyze(run([{ name: 'idle', secs: 5 }]).filter((r) => !(r.ev === 'phase' && r.on === 0)));
  ok(cut.phases.length === 1 && cut.phases[0].cut, 'a phase never closed (a stopped check) is still judged, and marked cut');

  // ---- compare
  const after = Q.analyze(run([
    { name: 'text', secs: 6 },
    { name: 'scroll', secs: 6, h: { qp: 29, wire: 450 } },
    { name: 'video', secs: 6, h: { qp: 31, wire: 550 } },
    { name: 'rest', secs: 6, h: { qp: 22, fr: 1 } },
  ]));
  const cmp = Q.compare(bad, after);
  ok(cmp.overall === 'better' && cmp.better >= 5 && cmp.worse === 0, 'the same stresses reading better is called better (' + cmp.better + ' better, ' + cmp.worse + ' worse)');
  ok(cmp.causesGone.some((t) => /SMALLER/.test(t)) && cmp.causesNew.length === 0, 'and the ladder cause is listed as gone');
  ok(cmp.lines.some((l) => /^video: picture coarse→/.test(l) && /▲ quantiser 40→31/.test(l)), 'a phase line shows the picture word and each metric that moved (' + cmp.lines[2] + ')');
  const same = Q.compare(after, Q.analyze(run([{ name: 'text', secs: 6 }, { name: 'scroll', secs: 6, h: { qp: 30, wire: 450 } },
                                                { name: 'video', secs: 6, h: { qp: 31, wire: 560 } }, { name: 'rest', secs: 6, h: { qp: 22, fr: 1 } }])));
  ok(same.overall === 'same', 'noise inside the margins is not a change (QP 29→30, uplink 45→46%)');
  const worse = Q.compare(after, bad);
  ok(worse.overall === 'worse' && worse.causesNew.length > 0, 'and the reverse is worse, with the new causes');
  const rep = Q.report(bad, cmp);
  ok(/^🔬 \*\*Picture-quality check\*\* — Main cause/.test(rep) && /\*\*Causes\*\*/.test(rep) && /Compared with the earlier run: the picture as sent is better/.test(rep), 'the report: verdict, a line a phase, causes, the comparison');
  ok(cmp.delivery === 'better' && cmp.dBetter >= 1 && /delivery to the agent \(its own link too\) is better/.test(cmp.summary),
     'delivery to the agent (behind live 1500 → 40 ms) is its own tally, beside the picture\'s');

  // ---- comparing FAIRLY: what two live runs half an hour apart, with nothing changed on the machine, taught (2026-11-10)
  // a run whose copy of the stream was paused has NO arrival figures in that phase -- its zeros are not the best ever
  const noFrames = { fr: 0, by: 0, gap50: 0, gap95: 0, exc50: 0, exc95: 0 };
  const pausedRun = Q.analyze(run([{ name: 'scroll', secs: 6 }, { name: 'rest', secs: 6, a: noFrames }]));
  const fullRun = Q.analyze(run([{ name: 'scroll', secs: 6 }, { name: 'rest', secs: 6, a: { exc95: 400, gap95: 300 } }]));
  const fair = Q.compare(pausedRun, fullRun);
  const restRow = fair.phases.find((r) => r.phase === 'rest');
  ok(restRow && restRow.arrival === false && !restRow.moves.some((m) => m.where === 'arrive') && fair.dWorse === 0,
     'arrival figures are compared only where both runs received frames (0 → 400 ms behind is not a regression)');
  ok(fair.lines.some((l) => /^rest: .*\(no arrival figures: one run received no frames here\)$/.test(l)), '...and the line says why they are missing');
  // the screen as it was is listed, not counted
  const idleA = Q.analyze(run([{ name: 'idle', secs: 6, h: { fr: 20 } }, { name: 'scroll', secs: 6 }]));
  const idleB = Q.analyze(run([{ name: 'idle', secs: 6, h: { fr: 2, qp: 40 } }, { name: 'scroll', secs: 6 }]));
  const ic = Q.compare(idleA, idleB);
  ok(ic.overall === 'same' && ic.lines.some((l) => /^idle \(the screen as it was -- not counted\): .*quantiser 24→40/.test(l)),
     'the idle phase (whatever was on screen) is listed but does not decide better or worse');
  // a relative margin needs a real size too: 6 → 55 ms behind live is "nine times" and invisible
  const lowA = Q.analyze(run([{ name: 'scroll', secs: 6, a: { exc95: 6 } }])), lowB = Q.analyze(run([{ name: 'scroll', secs: 6, a: { exc95: 55 } }]));
  ok(Q.compare(lowA, lowB).dWorse === 0, 'behind live 6 → 55 ms is under the 50 ms floor: not a change');
  // a still phase's keyframe share is not compared (a still screen sends little BUT keyframes)
  const stillA = Q.analyze(run([{ name: 'text', secs: 6, h: { kb: 5000 } }])), stillB = Q.analyze(run([{ name: 'text', secs: 6, h: { kb: 95000 } }]));
  ok(!Q.compare(stillA, stillB).phases[0].moves.some((m) => m.metric === 'keyShare'), 'a still phase\'s keyframe share is not compared');
  // and the two versions of the check: the stamp, or for a run from before it, what the run did (a card clicked = 2)
  const v1run = run([{ name: 'scroll', secs: 6 }]);
  const v2run = run([{ name: 'scroll', secs: 6 }]); v2run.splice(1, 0, { c: 'a', ev: 'card', d: 'x', clicked: true, t: 500 });
  const v3run = run([{ name: 'scroll', secs: 6 }]); v3run[0].qv = 3;
  ok(Q.analyze(v1run).qv === 1 && Q.analyze(v2run).qv === 2 && Q.analyze(v3run).qv === 3, 'a run\'s check version: its stamp, else 2 for a clicked card, else 1');
  const vc = Q.compare(Q.analyze(v1run), Q.analyze(v2run));
  ok(vc.notes.some((n) => /different versions of the check \(1 and 2\)/.test(n)) && /part of any difference is the check's own/.test(vc.summary),
     'runs from different versions of the check say so');
  ok(!Q.compare(Q.analyze(v2run), Q.analyze(v2run)).notes.length, '...and runs from the same version do not (the control)');
  // THE CARD'S OWN RATE beside the stream's: on a slow machine a stream at 5 fps in the video scene may be the card's 5
  const withCard = (painted, host) => {
    const r = run([{ name: 'video', secs: 10, h: Object.assign({ fr: 5, fps: 30 }, host || {}) }]);
    r.push({ c: 'a', ev: 'card-stats', d: 'x', scenes: [{ name: 'video', painted, secs: 10 }], ran: 10, t: 12000 });
    return Q.analyze(r);
  };
  const slowCard = withCard(60);
  ok(slowCard.phases[0].cardFps === 6 && /5\/30 fps \(the card drew 6\)/.test(slowCard.phases[0].line), 'the phase line puts the card\'s own rate beside the stream\'s (' + slowCard.phases[0].line + ')');
  ok(slowCard.notes.some((n) => /In video the test card itself drew only 6 frames a second.*the frame rate there is the card's, not a drop/.test(n)) && !slowCard.causes.some((c) => c.id === 'carried'),
     'a stream that kept up with a card drawing 6 fps is the card\'s rate, not a drop');
  const dropped = withCard(300, { swhy: 'encode', enc95: 45 });
  const cr = dropped.causes.find((c) => c.id === 'carried');
  ok(!!cr && /carried 5 of the 30 frames/.test(cr.title) && cr.area === 'machine', 'a card drawing 30 fps that the stream carried at 5, with the encoder slow, is a drop on the machine (' + (cr && cr.title) + ')');
  ok(!dropped.notes.some((n) => /drew only/.test(n)), '...and is not explained away as a slow card (the control)');
  const unread = Q.analyze(run([{ name: 'video', secs: 10 }]));
  ok(unread.notes.some((n) => /counts were not read back/.test(n)), 'a run with card scenes but no counts says the frame rate cannot be told from the card\'s');
  // A RATE HELD FOR A WATCHER is not an ABR that fails to rise: three of the first five live runs had a voting console
  // reporting congestion (up to 1.0) that the relay handed to the host, which slowed the shared stream for it
  const press = (pv, pout) => Q.analyze(run([{ name: 'scroll', secs: 6, h: { qp: 40, wire: 100 }, r: { pv: [{ me: 1, p: 0, bl: 0, vote: 1 }].concat(pv), pout } }]));
  const held4 = press([{ tag: 'vv', who: 'someone', p: 1, bl: 0, vote: 1 }], 0.6);
  const rv4 = held4.causes.find((c) => c.id === 'rate-viewer');
  ok(!!rv4 && rv4.area === 'viewer' && /held down for a watcher's congested link/.test(rv4.title) && /someone reported 1\.00/.test(rv4.evidence[0]) && !held4.causes.some((c) => c.id === 'rate-held'),
     'a voting watcher at 1.0 with the pressure handed to the host: the rate is held FOR that watcher, said with who');
  ok(press([{ tag: 'vv', p: 1, bl: 0, vote: 1 }], 0).causes.some((c) => c.id === 'rate-held'), '...but a report the relay did not hand to the host is not why (the control)');
  ok(press([{ tag: 'vo', p: 1, bl: 0, vote: 0, hid: 1 }], 0.6).causes.some((c) => c.id === 'rate-held'), '...nor a watcher that does not vote (an off-screen tab)');
  ok(press([], 0).causes.some((c) => c.id === 'rate-held' && /no watcher reported congestion/.test(c.fix)), '...and nobody congested at all is the ABR not rising, said so');
  // A DIFFERENT ENCODE SIZE IS A DIFFERENT PICTURE: a watcher's window took the encode from 1678x944 to 1920x1080 between
  // two live runs and the quantiser rose with the pixels -- shown, not counted
  const sizeA = Q.analyze(run([{ name: 'scroll', secs: 6, h: { qp: 39, w: 1678, h: 944 } }]));
  const sizeB = Q.analyze(run([{ name: 'scroll', secs: 6, h: { qp: 48, w: 1920, h: 1080 } }]));
  const sc = Q.compare(sizeA, sizeB);
  ok(sc.overall === 'same' && sc.lines.some((l) => /quantiser 39→48 \(a different encode size: not counted\).*\[encode 1678×944 → 1920×1080\]/.test(l)) &&
     sc.notes.some((n) => /encode size changed/.test(n)), 'QP 39 → 48 across a 30% larger encode is shown, not counted, and said why');
  const sameSize = Q.compare(Q.analyze(run([{ name: 'scroll', secs: 6, h: { qp: 39 } }])), Q.analyze(run([{ name: 'scroll', secs: 6, h: { qp: 48 } }])));
  ok(sameSize.overall === 'worse', '...while the same rise at the same size is worse (the control)');
  // HELD TO THE CAP is not IGNORED: refreshes at the same coarse QP while the rate verdict holds are the bitrate's doing
  const capped = Q.analyze(run([{ name: 'rest', secs: 8, h: { qp: 48, fr: 1, by: 20000, kb: 0, qwhy: 'rate' }, hs: [{}, {}, { refine: 1, kf: 1, kb: 20000 }, {}, {}, { refine: 1, kf: 1, kb: 20000 }] }]));
  ok(capped.causes.some((c) => c.id === 'refine-capped' && /held to the bitrate cap/.test(c.title)) && !capped.causes.some((c) => c.id === 'refine'),
     'refinements that come out at the same QP under the rate verdict are "held to the cap", not "ignored"');
  ok(Q.QV === 3, 'the check is version 3: the video scene\'s frames are prepared');
  // THE MARGINS ARE AN UNCHANGED MACHINE'S: three live runs moved a moving phase's QP by up to 4 and a recovering still
  // phase's by up to 5 -- each must read "same", while a real change (QP 39 -> 30) still reads better
  const qpRun = (scrollQp, restQp) => Q.analyze(run([{ name: 'scroll', secs: 6, h: { qp: scrollQp } }, { name: 'rest', secs: 6, h: { qp: restQp, fr: 1 } }]));
  ok(Q.compare(qpRun(27, 46), qpRun(31, 51)).overall === 'same', 'QP 27 → 31 moving and 46 → 51 still: the noise of an unchanged machine, "same"');
  ok(Q.compare(qpRun(39, 46), qpRun(30, 46)).overall === 'better', '...while QP 39 → 30 while moving is better (the control)');
  ok(Q.compare(qpRun(30, 40), qpRun(30, 47)).overall === 'worse', '...and a still phase 7 worse is worse (the still margin is 6, not unlimited)');
  {
    const cs = Q.cardSource();
    ok(/MakeVideoFrames\(\);\s*\n\s*\}/.test(cs) && /Bitmap f = vframes\[\(\(int\)\(u \* 30\)\) % VF\];/.test(cs),
       'the video scene\'s frames are made before the card shows, and cycled at 30 a second (live, it drew 3.4 fps on a Celeron)');
  }
  // the keyframe-share cause itself waits for motion
  const stillKf = Q.analyze(run([{ name: 'rest', secs: 8, h: { fr: 1, by: 60000, kb: 0 }, hs: [{}, {}, { kf: 1, kb: 58000, refine: 1 }, {}, { kf: 1, kb: 58000, refine: 1 }] }]));
  ok(!stillKf.causes.some((c) => c.id === 'keyframes'), 'a still phase made of refinement keyframes is not a keyframe problem');
  // WHY SOFTWARE, when the host says (hwwhy hwhr encn capm): five live runs on a machine with a GPU could only say "hw 0"
  const swRun = (extra) => Q.analyze(run([{ name: 'video', secs: 6, h: Object.assign({ hw: 0, swhy: 'encode', enc95: 45 }, extra || {}) }]))
    .causes.find((c) => c.id === 'encoder');
  const encOld = swRun();
  ok(!!encOld && encOld.title === 'The machine encodes in SOFTWARE and cannot keep up' && /does not report why \(hwwhy\)/.test(encOld.fix),
     'a host that does not say why it encodes in software: the old advice, and that a newer host says');
  const encD3d = swRun({ hwwhy: 'd3d', hwhr: '0x80070057', encn: 'Intel Quick Sync Video H.264 Encoder MFT', capm: 'dxgi' });
  ok(!!encD3d && encD3d.title === 'The machine\'s encoder runs without its GPU device and cannot keep up: the hardware encoder refused the capture device' &&
     /hardware encoder without its GPU device "Intel Quick Sync Video H\.264 Encoder MFT" · capture dxgi · hwwhy d3d \(0x80070057\)/.test(encD3d.evidence[0]) &&
     /\(0x80070057\)/.test(encD3d.fix) && /another adapter/.test(encD3d.fix),
     'a hardware encoder that refused the capture device is named as that, not as software: its HRESULT in the fix, the encoder and the capture in the evidence (' + (encD3d && encD3d.evidence[0]) + ')');
  for (const [why, re] of [['cfg', /SOFTWARE.*: preferHardware is off$/], ['none', /SOFTWARE.*: no hardware H\.264 encoder is installed$/], ['act', /SOFTWARE.*: its hardware encoders would not start$/],
                           ['gdi', /SOFTWARE.*: the GDI capture forces it$/], ['wall', /SOFTWARE.*: the merged wall of screens forces it$/]]) {
    const e = swRun({ hwwhy: why });
    ok(!!e && re.test(e.title) && /software encoder · hwwhy /.test(e.evidence[0]) && !/does not report why/.test(e.fix) && e.fix !== encOld.fix,
       'hwwhy ' + why + ' is named in the title, with its own fix (' + (e && e.title) + ')');
  }
  const unknownWhy = swRun({ hwwhy: 'zzz' });
  ok(!!unknownWhy && unknownWhy.title === encOld.title && /hwwhy zzz/.test(unknownWhy.evidence[0]) && !/undefined|does not report why/.test(unknownWhy.fix),
     'a reason this check does not know (a later host) is shown as evidence, with the general advice');
  const hwSlow = Q.analyze(run([{ name: 'video', secs: 6, h: { hw: 1, hwwhy: '', encn: 'NVIDIA H.264 Encoder MFT', capm: 'wgc', swhy: 'encode', enc95: 45 } }]))
    .causes.find((c) => c.id === 'encoder');
  ok(!!hwSlow && hwSlow.sev === 'warn' && hwSlow.title === 'The machine\'s encoder cannot keep up' && /hardware encoder "NVIDIA H\.264 Encoder MFT" · capture wgc · 1920/.test(hwSlow.evidence[0]),
     'a slow HARDWARE encoder names no software reason (its hwwhy is empty), and says which encoder and capture');
  // KEYFRAMES ASKED FOR, or the encoder's own: a host with kreq counts the keyframe requests it spent
  const withReq = (n) => every2.map((s) => Object.assign({ kreq: s.kf ? n : 0 }, s));
  const kfAsk = Q.analyze(run([{ name: 'scroll', secs: 10, hs: withReq(1) }, { name: 'video', secs: 10, hs: withReq(1) }])).causes.find((c) => c.id === 'kf-unexplained');
  ok(!!kfAsk && /: most were ASKED FOR \(10 keyframe requests spent\)$/.test(kfAsk.title) && /Find who keeps asking/.test(kfAsk.fix) && /10 requests spent by the host \(kreq\)$/.test(kfAsk.evidence[0]),
     'keyframes the host counts as spent requests are said to be asked for (' + (kfAsk && kfAsk.title) + ')');
  const kfOwn = Q.analyze(run([{ name: 'scroll', secs: 10, hs: withReq(0) }, { name: 'video', secs: 10, hs: withReq(0) }])).causes.find((c) => c.id === 'kf-unexplained');
  ok(!!kfOwn && /, inserted by the ENCODER itself \(none asked for\)$/.test(kfOwn.title) && /not the relay or the viewers/.test(kfOwn.fix),
     'keyframes nobody asked for (kreq 0) are the encoder\'s own (' + (kfOwn && kfOwn.title) + ')');
  ok(!!ku && /, which the GOP, refinement and rebuilds do not explain$/.test(ku.title) && !/kreq/.test(ku.evidence[0]), '...and a host without kreq keeps the open question (the control)');
  const heavy = Array.from({ length: 6 }, (_, i) => (i % 2 ? { kf: 1, kb: 80000, kreq: 1 } : { kb: 60000, kreq: 0 }));
  const ks = Q.analyze(run([{ name: 'scroll', secs: 6, hs: heavy }])).causes.find((c) => c.id === 'keyframes');
  ok(!!ks && /, 3 asked for \(3 requests spent\), 0 inserted by the encoder$/.test(ks.evidence[0]) && /^Most were ASKED FOR/.test(ks.fix),
     'a phase\'s keyframe share splits "asked for or inserted" by the requests the host spent (' + (ks && ks.evidence[0]) + ')');
  // NO QUANTISER IS NOT A SHARP PICTURE: Intel's Quick Sync MFT reported qp 0 in every second of a live run (2026-11-10),
  // and the check called every phase sharp, its comparison "better", while each moving frame got a third of the data
  const qsv = { qp: 0, hw: 1, hwwhy: '', encn: 'Intel Quick Sync Video H.264 Encoder MFT', fr: 27, by: 182000, kb: 0, w: 1664, h: 936, rate: 1752224, wire: 12 };
  const qrun = Q.analyze(run([{ name: 'text', secs: 6, h: Object.assign({}, qsv, { fr: 1, by: 15000 }) }, { name: 'scroll', secs: 6, h: qsv },
                              { name: 'video', secs: 6, h: Object.assign({}, qsv, { by: 500000 }) }]));
  ok(qrun.phases.every((p) => p.picture === null && /picture not measured \(no quantiser reported, full size\)/.test(p.line)),
     'no quantiser reading: every phase reads "not measured", never sharp (' + qrun.phases[1].line + ')');
  const qun = qrun.causes.find((c) => c.id === 'qp-unmeasured');
  ok(!!qun && qun.phases.join() === 'text,scroll,video' && /from "Intel Quick Sync Video H\.264 Encoder MFT"$/.test(qun.title) && /hardware encoder/.test(qun.evidence[0]),
     '...and it is said once, for every phase, naming the encoder (' + (qun && qun.title) + ')');
  const starvedCause = qrun.causes.find((c) => c.id === 'rate-held');
  ok(!!starvedCause && starvedCause.title === 'Motion is starved: 54 kb a frame at 27 fps on a rate held at 1.8 Mb/s' && starvedCause.phases.join() === 'scroll' &&
     /\(0\.035 bits a pixel\) at 27 fps, the quantiser not reported/.test(starvedCause.evidence[0]) && /judged by the data per frame/.test(starvedCause.fix),
     'with no quantiser the rate is judged by the data per frame: 54 kb at 1664x936 while scrolling is starved (' + (starvedCause && starvedCause.title) + ')');
  ok(Q.BPP_STARVED === 0.05, 'starved is under 0.05 bits a pixel a frame');
  const measured = Q.analyze(run([{ name: 'scroll', secs: 6, h: Object.assign({}, qsv, { qp: 30 }) }]));
  ok(!measured.causes.some((c) => c.id === 'qp-unmeasured' || c.id === 'rate-held') && measured.phases[0].picture === 'soft',
     '...while the same encoder WITH a quantiser is read by it (the control)');
  ok(Q.analyze(run([{ name: 'scroll', secs: 6, h: Object.assign({}, qsv, { scale: 700 }) }])).phases[0].picture === 'coarse',
     'with no quantiser a picture sent at 70% size is still coarse: the size alone says that much');
  // ...and a comparison against a run that had one says the sharpness was not compared, counts the data per frame in
  // its place, and lists the causes only a quantiser shows as not measurable rather than gone
  const swRun2 = run([{ name: 'scroll', secs: 6, h: { qp: 38, hw: 0, fr: 16, by: 392000, w: 1678, h: 944 } }, { name: 'rest', secs: 8, hs: steps }]);
  const hwRun2 = run([{ name: 'scroll', secs: 6, h: qsv }, { name: 'rest', secs: 8, h: { qp: 0, hw: 1, fr: 1, by: 9000, kb: 0 } }]);
  const swA = Q.analyze(swRun2), qc = Q.compare(swA, Q.analyze(hwRun2));
  const scrollLine = qc.lines.find((l) => /^scroll: /.test(l)) || '';
  ok(/picture coarse→not measured/.test(scrollLine) && /▲ frames\/s 16→27/.test(scrollLine) && /▼ kb a frame \(no quantiser to compare\) 196→54/.test(scrollLine) && qc.overall === 'mixed',
     'software against Quick Sync: smoother, a third of the data a frame -- mixed, not better (' + scrollLine + ')');
  ok(swA.causes.some((c) => c.id === 'recovery') && qc.causesUnmeasured.some((t) => /sharpens slowly/.test(t)) && !qc.causesGone.some((t) => /sharpens slowly/.test(t)),
     '...the still screen\'s slow recovery is "not measurable" in the new run, not gone');
  ok(qc.notes.some((n) => /quantiser was not measured in the new run/.test(n)) && /Not measurable in the new run \(no quantiser\)/.test(qc.summary),
     '...and the summary says why the sharpness was not compared');
  const qcSame = Q.compare(swA, Q.analyze(swRun2));
  ok(!qcSame.notes.some((n) => /quantiser was not measured/.test(n)) && !qcSame.causesUnmeasured.length && !qcSame.phases.some((r) => r.moves && r.moves.some((m) => m.metric === 'bppf')),
     '...while two runs that both had one compare the quantiser, not the data per frame (the control)');
  // A WATCHER'S PICTURE-QUALITY CAP (host 1.57.0: top, qcap). Three runs on Quick Sync were read as "the ABR is not raising
  // the rate" while a console was on Speed (2026-11-10): the rate had stopped at exactly Speed's top
  const speed = Object.assign({}, qsv, { qcap: 350, top: 1752224 });
  const spRun = Q.analyze(run([{ name: 'scroll', secs: 6, h: speed }]));
  const capC = spRun.causes.find((c) => c.id === 'rate-capped');
  ok(!!capC && capC.area === 'setting' && capC.title === 'The rate is held at a watcher\'s picture-quality cap: Speed (1.8 Mb/s)' &&
     /\(qcap 350, top 1\.8 Mb\/s\)/.test(capC.evidence[0]) && /Picture quality on Speed/.test(capC.fix) && /Set it to Best/.test(capC.fix) && /host-wide/.test(capC.fix) &&
     !spRun.causes.some((c) => c.id === 'rate-held'),
     'a rate at the top of a Speed cap is the setting, not the ABR (' + (capC && capC.title) + ')');
  ok(!Q.analyze(run([{ name: 'scroll', secs: 6, h: Object.assign({}, speed, { rate: 900000 }) }])).causes.some((c) => c.id === 'rate-capped') &&
     !Q.analyze(run([{ name: 'scroll', secs: 6, h: Object.assign({}, qsv, { qcap: 1000, top: 4976640 }) }])).causes.some((c) => c.id === 'rate-capped'),
     '...but a rate well under the cap\'s top, or no cap at all, is not the cap (the controls)');
  // ...and a host from BEFORE those fields: recognised only when the rate is EXACTLY a preset's top on the screen's ceiling
  const withScreen = (recs, screen) => recs.map((r) => (r.c === 'meta' ? Object.assign({}, r, { screen }) : r));
  const oldCap = Q.analyze(withScreen(run([{ name: 'scroll', secs: 6, h: qsv }]), '1920x1080'));
  const oc = oldCap.causes.find((c) => c.id === 'rate-capped');
  ok(!!oldCap.inferredCap && oldCap.inferredCap.mode === 'Speed' && !!oc &&
     /exactly: 1\.8 Mb\/s is Speed's top on the 5\.0 Mb\/s ceiling of a 1920×1080 screen at 30 fps/.test(oc.evidence[0]) && /This host does not report the cap/.test(oc.fix),
     'an older host\'s rate at exactly 1,752,224 b/s on a 1920x1080 screen at 30 fps is Speed\'s top, said as inferred (' + (oc && oc.evidence[0]) + ')');
  ok(!Q.analyze(withScreen(run([{ name: 'scroll', secs: 6, h: Object.assign({}, qsv, { rate: 1752000 }) }]), '1920x1080')).inferredCap &&
     !Q.analyze(withScreen(run([{ name: 'scroll', secs: 6, h: qsv }]), '1366x768')).inferredCap &&
     !Q.analyze(run([{ name: 'scroll', secs: 6, h: qsv }])).inferredCap,
     '...and nothing is inferred a few bits off, on another screen, or with no screen size (the controls)');
  // a comparison across a changed cap says a console's setting changed (runs 6 and 7: Normal -> Speed, read as the encoder)
  const normalRun = Q.analyze(run([{ name: 'scroll', secs: 6, h: Object.assign({}, qsv, { qcap: 600, top: 2992384, rate: 2992384 }) }]));
  ok(Q.compare(normalRun, spRun).notes.some((n) => /picture-quality cap was not the same in the two runs \(Normal, 60% → Speed, 35%\)/.test(n)) &&
     !Q.compare(spRun, Q.analyze(run([{ name: 'scroll', secs: 6, h: speed }]))).notes.some((n) => /cap was not the same/.test(n)),
     'a comparison across a changed cap says a console\'s setting changed (and the same cap twice says nothing)');
  // a quantiser read from the slice headers (qpsrc "slice", host 1.57.0) is a measurement, and the run says where it came from
  const sliceRun = Q.analyze(run([{ name: 'scroll', secs: 6, h: Object.assign({}, qsv, { qp: 33, qpsrc: 'slice' }) }]));
  ok(!sliceRun.causes.some((c) => c.id === 'qp-unmeasured') && sliceRun.phases[0].picture === 'soft' && sliceRun.notes.some((n) => /read from the slice headers/.test(n)),
     'a quantiser read from the slice headers is measured, and the run says how (' + sliceRun.phases[0].line + ')');
  // THE STREAM IS CAPPED AT ITS OWN FRAME RATE: 27 of a card's 52 at 30 fps is the cap, not a drop
  ok(!withCard(520, { fr: 27 }).causes.some((c) => c.id === 'carried'), 'a 30 fps stream carrying 27 of a card\'s 52 frames a second is not a drop');
  const capDrop = withCard(520, { fr: 16, swhy: 'encode', enc95: 45 }).causes.find((c) => c.id === 'carried');
  ok(!!capDrop && capDrop.title === 'The stream carried 16 of the 30 frames a second it may send (the card drew 52)',
     '...while 16 of them is, said against what it may send (' + (capDrop && capDrop.title) + ')');
}

// ---- the card ----------------------------------------------------------------------------------------------------
{
  const s = Q.cardScript();
  let ascii = true; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
  ok(ascii, 'the card script is ASCII (PowerShell 5.1 reads a file with no BOM as ANSI)');
  ok(/^param\(\[string\]\$Plan.*\[double\]\$Hold = 0, \[string\]\$Stats = ""\)/.test(s) && /\[QCard\]::Run\(\$Plan, \$Rect, \$Lead, \$Hold, \$Stats\)/.test(s),
     'it takes the plan, the rect, the lead, the hold and where to write what it drew, and runs the card');
  {
    // WHAT THE CARD DREW: counted per scene while its clock runs, written at its close to the path it was given
    const cs = Q.cardSource();
    ok(/if \(started\) painted\[i\]\+\+;/.test(cs) && /FormClosed \+= delegate \{ tick\.Stop\(\); WriteStats\(\); \};/.test(cs) && /System\.IO\.File\.WriteAllText\(statsPath, sb\.ToString\(\)\);/.test(cs),
       'the card counts its paints per scene once started, and writes them when it closes');
    ok(Q.CARD_STATS_NAME.test('agent-drive-qcard-0123456789abcdef.json') && !Q.CARD_STATS_NAME.test('agent-drive-qcard-0123456789abcdef.ps1') && !Q.CARD_STATS_NAME.test('notes.json'),
       'its counts file has the card\'s own name, and only that name is ever read or deleted');
  }
  // ITS CLOCK STARTS ON A CLICK (the agent's, on the corner it has just seen) or by itself after the hold: the first real
  // run saw the corner ~1.5 s after the card appeared, and every scene ran ~1.1 s ahead of its phase mark
  {
    const cs = Q.cardSource();
    ok(/MouseDown \+= delegate \{ Begin\(\); \};/.test(cs) && /if \(!started && clock\.Elapsed\.TotalSeconds >= holdMax\) Begin\(\);/.test(cs),
       'the card starts its schedule on a click, or by itself once the hold is over');
    ok(/started = holdMax <= 0;/.test(cs) && /double T\(\) \{ return started \? clock\.Elapsed\.TotalSeconds - startAt : 0; \}/.test(cs),
       '...with no hold it starts on appearing (an agent that may not click), and until it starts its first scene stands still');
    ok(/if \(t >= total \+ 0\.3\) \{ Close\(\); return; \}/.test(cs) && Q.CARD_GONE_MS >= 1000, 'it closes 0.3 s after its last scene, and the next phase waits CARD_GONE_MS for the screen to repaint');
  }
  ok(/Remove-Item -LiteralPath \$PSCommandPath/.test(s.split('Add-Type')[0]), 'it deletes its own file BEFORE compiling (nothing is left on the machine)');
  ok(/\r\n'@\r\n/.test(s) && !/^\s*\/\//m.test(s.split("@'")[1].split("'@")[0]), 'the C# rides a here-string closed at a line start, with its comment lines left out');
  ok(s.length < 20000, 'and it is small enough for a few writes (' + s.length + ' bytes)');
  const src = Q.cardSource();
  ok(/case "scroll"/.test(src) && /case "drag"/.test(src) && /case "video"/.test(src) && /case "cuts"/.test(src), 'every moving scene has its own case');
  ok(Q.CARD_ORDER.every((n) => Q.KINDS[n].card) && Object.keys(Q.KINDS).filter((n) => Q.KINDS[n].card).length === Q.CARD_ORDER.length, 'the card\'s scenes are exactly the card phases');
  ok(/FillRectangle\(mk, 10, H - 10 - 24, 24, 24\)/.test(src) && Q.MARK.inset === 10 && Q.MARK.size === 24, 'the C# marker and MARK agree: 24 px, 10 px in from the bottom-left');
  const m = Q.markerAt([100, 50, 1280, 720]);
  ok(m.x === 122 && m.y === 50 + 720 - 22, 'markerAt is the marker\'s centre on the desktop (' + m.x + ',' + m.y + ')');
  ok(Q.CARD_NAME.test('agent-drive-qcard-0123456789abcdef.ps1') && !Q.CARD_NAME.test('qcard.ps1'), 'the card file has its own unmistakable name');

  // ON WINDOWS: compile the card exactly as shipped and render a scene -- the marker must be where the agent looks
  if (process.platform === 'win32') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-qcard-'));
    const png = path.join(dir, 'video.png');
    const ps1 = path.join(dir, 'snap.ps1');
    // EVERY Run line becomes the offscreen Snap, whatever its arguments: a replacement that misses it (the call grew a
    // fourth argument once) runs the real card -- a window over this machine's screen for the length of its plan
    const snapped = s.replace(/try \{ Remove-Item[^\r\n]*/, '').replace(/\[QCard\]::Run\([^)\r\n]*\)/g, '[QCard]::Snap("video", 2.5, 800, 600, "' + png + '")');
    ok(!/\[QCard\]::Run\(/.test(snapped), 'the compile check renders offscreen only: no Run line is left to open a window');
    fs.writeFileSync(ps1, snapped);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { encoding: 'utf8', timeout: 120000 });
    if (r.error && r.error.code === 'ENOENT') console.log('  (no powershell.exe here: the compile check is skipped)');
    else {
      ok(r.status === 0 && fs.existsSync(png), 'the card compiles with PowerShell 5.1 and renders a scene' + (r.status ? ': ' + String(r.stderr || r.stdout).slice(0, 300) : ''));
      if (fs.existsSync(png)) {
        const eyes = require(path.join(KIT, 'core', 'agent-eyes.js'));
        const img = eyes.decode(fs.readFileSync(png));
        const mk = Q.markerAt([0, 0, 800, 600]);
        ok(img.ready && eyes.probe(img, mk.x, mk.y) === Q.MARK.color, 'the rendered marker is ' + Q.MARK.color + ' at markerAt() (' + (img.ready ? eyes.probe(img, mk.x, mk.y) : 'not decoded') + ')');
        ok(img.ready && eyes.probe(img, mk.x + 30, mk.y) !== Q.MARK.color, '...and only there (the control: 30 px right is not)');
      }
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ---- the serve is wired to it ------------------------------------------------------------------------------------
{
  const serve = fs.readFileSync(path.join(KIT, 'core', 'agent-join.js'), 'utf8');
  ok(/cmd\.do === 'quality'\) \{[^\n]*\n\s*reply\(await qualityRun\(cmd\)\);/.test(serve), 'the serve runs `quality` through qualityRun');
  ok(/else if \(op === 0x2 && binTaps\.length\)/.test(serve) && /onBinary: \(fn\) => \{ binTaps\.push\(fn\); \}/.test(serve), 'binary frames reach a binary tap (and only when one listens)');
  ok(/traceAskAt && Date\.now\(\) - traceAskAt < 3000\) traceRefusedAt = Date\.now\(\);\s*\n\s*else if \(m\.id == null && REFUSAL\.test\(why\)\) relayOld\(\);/.test(serve),
     'a refused trace switch is the check\'s to report -- it does not silence the agent\'s chat as an "old relay"');
  ok(/streamHeld\+\+; clearTimeout\(repauseTimer\); setPaused\(false\);/.test(serve) && /streamHeld = Math\.max\(0, streamHeld - 1\);\s*\n\s*pauseSoon\(\);   \/\/ the stream pauses again/.test(serve),
     'the stream is resumed and HELD for the check, and let go and paused again after');
  // ...and held means the pictures it takes cannot pause it: the first real run lost its last two phases to exactly that
  ok(/const pauseSoon = \(\) => \{\s*\n\s*clearTimeout\(repauseTimer\);\s*\n\s*if \(streamHeld\) return;/.test(serve) && /!ws\.dead && !stopped && !streamHeld\) setPaused\(true\)/.test(serve),
     'while the check holds the stream, a picture cannot arm the re-pause, and one already armed does not fire');
  ok(/const click = !!grantControl && findable;/.test(serve) && /if \(seen && click && !stopped\) \{/.test(serve) && /'-Hold', click \? String\(quality\.CARD_HOLD_S\) : '0'/.test(serve),
     'the card waits for a click only when the agent may click AND knows where its corner is, and is clicked the moment the corner is seen');
  ok(/cardUp = false;[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*await qWait\(Date\.now\(\) \+ quality\.CARD_GONE_MS\);/.test(serve), 'a phase after the card starts once the card is gone');
  ok(/const cs = await qCardStats\(cardStatsAt\);/.test(serve) && /if \(!p \|\| !quality\.CARD_STATS_NAME\.test\(leaf\(p\)\)\) return/.test(serve) &&
     /try \{ await runExec\('del \/q "' \+ p \+ '"', 10000\); \} catch \(_\) \{\}\s*\n\s*return out;/.test(serve),
     'once the card has closed its counts are read, recorded, and deleted -- whatever was in them');
  ok(/if \(cardStatsAt && !ws\.dead && quality\.CARD_STATS_NAME\.test\(leaf\(cardStatsAt\)\)\) \{ try \{ await runExec\('del \/q "' \+ cardStatsAt/.test(serve),
     '...and a stopped check deletes a counts file it never read');
  ok(/w0\.off\(onText\); w0\.off\(onBin\);/.test(serve) && /ws\.send\(\{ type: 'trace', on: 0 \}\)/.test(serve), 'the taps come off and the trace is disarmed in the finally');
  ok(verbs.V.quality && verbs.ACTING.has('quality'), 'quality is in the verb table and counts as acting (a pause or a hold stops it)');
  const v = verbs.vet({ do: 'quality-check', stresses: ['idle'], baseline: 'a.ndjson' });
  ok(v.ok && v.cmd.do === 'quality' && Array.isArray(v.cmd.phases) && v.cmd.compare === 'a.ndjson', 'the slips are renamed: quality-check, stresses, baseline');
  ok(!verbs.vet({ do: 'quality', phases: 7 }).ok, 'phases that is not a list is refused before anything runs');
}

console.log((fail ? 'FAILED ' : 'OK ') + pass + '/' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);

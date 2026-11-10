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
  const flat = Q.analyze(run([{ name: 'rest', secs: 8, h: { qp: 42, fr: 1, by: 9000, kb: 0 }, hs: [{}, {}, { refine: 1, kf: 1 }, {}, {}, { refine: 1, kf: 1 }] }]));
  ok(flat.causes.some((c) => c.id === 'refine' && /although refinement ran 2×/.test(c.title)) && !flat.causes.some((c) => c.id === 'recovery'),
     '...while one that stays at 42 through two refinements is still "refinement did nothing" (the control)');
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
  // the keyframe-share cause itself waits for motion
  const stillKf = Q.analyze(run([{ name: 'rest', secs: 8, h: { fr: 1, by: 60000, kb: 0 }, hs: [{}, {}, { kf: 1, kb: 58000, refine: 1 }, {}, { kf: 1, kb: 58000, refine: 1 }] }]));
  ok(!stillKf.causes.some((c) => c.id === 'keyframes'), 'a still phase made of refinement keyframes is not a keyframe problem');
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

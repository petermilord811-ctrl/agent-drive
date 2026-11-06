// schedule.js — drive/schedule.js: a saved job, run when it is due. The pure parts first: parseSpec, nextFire (--at
// with and without days, across midnight, and across both DST changes in two zones given as offset RULES -- no tz
// database, so it holds on any machine), --every, --once, due() with overlaps, a busy machine and missed fires. Then the
// runner in-process with an injected clock and launcher; then the command line in child processes against a temp
// --work folder: add, list, remove, next; `run --once` with a fake launcher (SM_SCHEDULE_LAUNCHER); and a whole recipe
// job against a stand-in client (SM_SCHEDULE_CLIENT) -- let in, replayed, signed off; or not let in; or refused.
//   node tests/schedule.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const SCHEDULE = path.join(__dirname, '..', 'drive', 'schedule.js');
const S = require(SCHEDULE);
const { parseSpec, nextFire, due, upcoming, describe, wallOf, instantOf, LOCAL } = S;
const node = process.execPath;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-'));
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const p2 = (n) => String(n).padStart(2, '0');
const q = (p) => '"' + p + '"';   // a path in a command line
// is that process gone? A stopped shell's own child may still be on its way out (or being reaped): ask for up to 3 s
function gone(pid) {
  for (let i = 0; i < 60; i++) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return false;
}

// ---- zones as offset rules ------------------------------------------------------------------------------------------
// US Eastern: UTC-5, and UTC-4 from 02:00 on the second Sunday of March to 02:00 on the first Sunday of November.
// Central Europe: UTC+1, and UTC+2 from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October.
const UTC = () => 0;
const sunday = (y, mo, from, step) => { for (let d = from; ; d += step) if (new Date(Date.UTC(y, mo, d)).getUTCDay() === 0) return d; };
function eastern(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= Date.UTC(y, 2, sunday(y, 2, 8, 1), 7) && ms < Date.UTC(y, 10, sunday(y, 10, 1, 1), 6) ? -240 : -300;
}
function europe(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= Date.UTC(y, 2, sunday(y, 2, 31, -1), 1) && ms < Date.UTC(y, 9, sunday(y, 9, 31, -1), 1) ? 120 : 60;
}
const T = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi || 0);                       // a UTC instant, months 1-12
const E = (y, mo, d, h, mi) => instantOf(y, mo - 1, d, h, mi || 0, eastern);             // a wall time in US Eastern
const wall = (ms, z) => { const w = wallOf(ms, z); return w.y + '-' + p2(w.mo + 1) + '-' + p2(w.d) + ' ' + p2(w.h) + ':' + p2(w.mi); };
const fires = (spec, from, n, z) => { const out = []; let f = from; for (let i = 0; i < n; i++) { f = nextFire(spec, f, z); if (f == null) break; out.push(f); } return out; };

// ---- parseSpec ------------------------------------------------------------------------------------------------------
let r = parseSpec({ at: '9:00' });
ok(r.ok && r.spec.kind === 'at' && r.spec.time === '09:00' && !r.spec.days, '--at 9:00 -> every day at 09:00');
r = parseSpec({ at: '17:30', days: 'mon,Wednesday, FRI' });
ok(r.ok && r.spec.days.join() === 'mon,wed,fri', '--days by name, any case, short or long');
r = parseSpec({ at: '08:00', days: 'mon-fri' });
ok(r.ok && r.spec.days.join() === 'mon,tue,wed,thu,fri' && parseSpec({ at: '08:00', days: 'weekdays' }).spec.days.join() === r.spec.days.join(), '--days mon-fri, the same as weekdays');
r = parseSpec({ at: '08:00', days: 'fri-mon' });
ok(r.ok && r.spec.days.join() === 'mon,fri,sat,sun', 'a range wraps over the weekend');
ok(!parseSpec({ at: '08:00', days: 'mon-sun' }).spec.days, 'all seven days is every day');
r = parseSpec({ every: '30m' }, { now: 1000 * MIN + 1234 });
ok(r.ok && r.spec.kind === 'every' && r.spec.n === 30 && r.spec.unit === 'm' && r.spec.from === 1000 * MIN, '--every 30m, anchored to when it is added (to the minute)');
ok(parseSpec({ every: '2 hours' }).spec.unit === 'h' && parseSpec({ every: '1d' }).spec.unit === 'd' && parseSpec({ every: '2w' }).spec.n === 2, '--every in hours, days, weeks');
r = parseSpec({ once: '2026-12-01 9:00' });
ok(r.ok && r.spec.kind === 'once' && r.spec.when === '2026-12-01 09:00', '--once "YYYY-MM-DD HH:MM"');
r = parseSpec(['--host', '10004', '--at', '07:05', '--days=sat']);
ok(r.ok && r.spec.time === '07:05' && r.spec.days.join() === 'sat', 'the words of a command line work too');
const why = (a) => { const x = parseSpec(a); return x.ok ? '' : x.why; };
ok(/--at HH:MM/.test(why({})), 'no when at all: it says the three ways');
ok(/one of --at, --every and --once/.test(why({ at: '09:00', every: '1h' })), 'two kinds of when: refused');
ok(['24:00', '9', '09:60', 'noon', ''].every((t) => /HH:MM/.test(why({ at: t }))), 'a time of day that is not HH:MM on a 24-hour clock');
ok(/--days goes with --at/.test(why({ every: '1h', days: 'mon' })), '--days without --at');
ok(/not a day/.test(why({ at: '09:00', days: 'mon,funday' })) && /not a day/.test(why({ at: '09:00', days: 'mo' })), 'a day that is not one');
ok(['0m', '5 parsecs', '', '-1h', '1.5h'].every((t) => /--every is a number and a unit/.test(why({ every: t }))), '--every that is not a positive number and a unit');
ok(['2026-02-30 09:00', '2026-12-01', '12/01/2026 09:00', '2026-12-01 24:00'].every((t) => /--once is a date and a time/.test(why({ once: t }))), '--once that is not a real date and time');

// ---- nextFire: --at -----------------------------------------------------------------------------------------------------
const at9 = { kind: 'at', time: '09:00' };
ok(nextFire(at9, T(2026, 11, 6, 8, 0), UTC) === T(2026, 11, 6, 9, 0), 'before 09:00 -> today at 09:00');
ok(nextFire(at9, T(2026, 11, 6, 9, 0), UTC) === T(2026, 11, 7, 9, 0), 'at 09:00 itself -> tomorrow (strictly after)');
ok(nextFire({ kind: 'at', time: '00:15' }, T(2026, 12, 31, 23, 30), UTC) === T(2027, 1, 1, 0, 15), 'across midnight -- and a year');
ok(nextFire({ kind: 'at', time: '23:45' }, T(2026, 11, 6, 23, 50), fixedZone(9 * 60)) === T(2026, 11, 7, 14, 45), 'a zone east of UTC: its own midnight, not UTC\'s');
const monFri = { kind: 'at', time: '09:00', days: ['mon', 'fri'] };   // 2026-11-06 is a Friday
ok(nextFire(monFri, T(2026, 11, 6, 8, 0), UTC) === T(2026, 11, 6, 9, 0) && nextFire(monFri, T(2026, 11, 6, 9, 0), UTC) === T(2026, 11, 9, 9, 0), '--days mon,fri: Friday, then Monday');
ok(nextFire({ kind: 'at', time: '09:00', days: ['wed'] }, T(2026, 11, 4, 9, 0), UTC) === T(2026, 11, 11, 9, 0), 'one day a week: a week ahead');
ok(wallOf(nextFire(at9, Date.now()), LOCAL).h === 9 && wallOf(nextFire(at9, Date.now()), LOCAL).mi === 0, 'with no zone given it is this machine\'s local time');
function fixedZone(min) { return () => min; }

// ---- nextFire across DST, as rules: never twice in a day, never a day lost --------------------------------------------
ok(E(2026, 3, 8, 2, 30) === T(2026, 3, 8, 7, 30) && wall(E(2026, 3, 8, 2, 30), eastern) === '2026-03-08 03:30', 'a time the clocks jump over is the moment it would have been: 02:30 is 03:30');
ok(E(2026, 11, 1, 1, 30) === T(2026, 11, 1, 5, 30), 'a time the clocks show twice is the first of the two');
let got = fires({ kind: 'at', time: '02:30' }, E(2026, 3, 6, 12), 4, eastern).map((f) => wall(f, eastern));
ok(got.join() === '2026-03-07 02:30,2026-03-08 03:30,2026-03-09 02:30,2026-03-10 02:30', 'spring forward: 02:30 fires at 03:30 on the day it does not exist -- once, no day lost (' + got.join(' ') + ')');
const at130 = { kind: 'at', time: '01:30' };
got = fires(at130, E(2026, 10, 30, 12), 3, eastern);
ok(got.map((f) => wall(f, eastern)).join() === '2026-10-31 01:30,2026-11-01 01:30,2026-11-02 01:30' && got[1] === T(2026, 11, 1, 5, 30), 'fall back: 01:30, shown twice, fires the first time only');
ok(nextFire(at130, T(2026, 11, 1, 6, 30) - 1, eastern) === T(2026, 11, 2, 6, 30), '...between the two 01:30s the next is tomorrow\'s, not the second one');
got = fires(at9, E(2026, 3, 6, 12), 3, eastern);
ok(got.every((f) => wall(f, eastern).slice(11) === '09:00') && got[1] - got[0] === 23 * HOUR && got[2] - got[1] === DAY, '09:00 stays 09:00 across the change (a day of 23 hours)');
for (const [z, name, starts] of [[eastern, 'US Eastern', [[3, 1], [10, 25]]], [europe, 'Central Europe', [[3, 22], [10, 18]]]]) {
  const bad = [];
  for (const time of ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00', '03:30', '09:00', '23:30']) {
    for (const [mo, d] of starts) {
      const days = fires({ kind: 'at', time }, instantOf(2026, mo - 1, d, 0, 0, z) - 1, 14, z).map((f) => wall(f, z).slice(0, 10));
      const want = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, mo - 1, d + i)).toISOString().slice(0, 10));
      if (days.join() !== want.join()) bad.push(time + ' from ' + mo + '/' + d + ': ' + days.join(' '));
    }
  }
  ok(!bad.length, name + ': every time of day fires exactly once a day for two weeks over both changes' + (bad.length ? ' -- ' + bad.join(' | ') : ''));
}

// ---- nextFire: --every, --once ------------------------------------------------------------------------------------------
const ev30 = { kind: 'every', n: 30, unit: 'm', from: T(2026, 11, 6, 12, 0) };
ok(nextFire(ev30, ev30.from, UTC) === T(2026, 11, 6, 12, 30) && nextFire(ev30, T(2026, 11, 6, 12, 29), UTC) === T(2026, 11, 6, 12, 30) &&
   nextFire(ev30, T(2026, 11, 6, 12, 30), UTC) === T(2026, 11, 6, 13, 0) && nextFire(ev30, ev30.from - 5 * HOUR, UTC) === T(2026, 11, 6, 12, 30),
   '--every 30m: counted from when it was added -- 12:30, 13:00, ...');
got = fires({ kind: 'every', n: 2, unit: 'h', from: E(2026, 10, 31, 22) }, E(2026, 10, 31, 22), 3, eastern);
ok(got[1] - got[0] === 2 * HOUR && got[2] - got[1] === 2 * HOUR && got.map((f) => wall(f, eastern).slice(11)).join() === '00:00,01:00,03:00',
   '--every 2h is elapsed time: two real hours apart across the fall-back (the clock reads 00:00, 01:00, 03:00)');
const ev1d = { kind: 'every', n: 1, unit: 'd', from: E(2026, 3, 7, 9) };
got = fires(ev1d, ev1d.from, 3, eastern);
ok(got.map((f) => wall(f, eastern)).join() === '2026-03-08 09:00,2026-03-09 09:00,2026-03-10 09:00' && got[0] - ev1d.from === 23 * HOUR,
   '--every 1d is a calendar day at the time it was added: 09:00 stays 09:00 across spring-forward');
ok(fires({ kind: 'every', n: 2, unit: 'w', from: T(2026, 11, 6, 9) }, T(2026, 11, 6, 9), 2, UTC).join() === [T(2026, 11, 20, 9), T(2026, 12, 4, 9)].join(), '--every 2w: every other Friday');
ok(nextFire(ev1d, E(2026, 4, 1, 12), eastern) === E(2026, 4, 2, 9), '...and from any later moment, the next one (no walk from the start)');
const once = { kind: 'once', when: '2026-12-01 09:00' };
ok(nextFire(once, T(2026, 11, 6, 0), UTC) === T(2026, 12, 1, 9) && nextFire(once, T(2026, 12, 1, 9), UTC) === null, '--once: its time, then nothing');
ok(nextFire({ kind: 'once', when: '2026-03-08 02:30' }, 0, eastern) === T(2026, 3, 8, 7, 30), '--once in the jump fires when the clocks have jumped');
ok(describe({ kind: 'at', time: '09:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }) === 'mon-fri at 09:00' && describe(ev1d, eastern) === 'every day at 09:00' &&
   /^every 30 min, counted from Fri 2026-11-06 12:00$/.test(describe(ev30, UTC)) && describe(once) === 'once, 2026-12-01 09:00', 'each says itself in words');

// ---- due ------------------------------------------------------------------------------------------------------------------
const nine = T(2026, 11, 6, 9);
const ent = (o) => Object.assign({ id: '1', spec: at9, next: nine }, o);
const acts = (ds) => ds.map((d) => d.id + ':' + d.act).join();
ok(due([ent()], nine - 1, { zone: UTC }).length === 0, 'nothing before its time');
let d = due([ent()], nine + 30000, { zone: UTC });
ok(acts(d) === '1:start' && d[0].fire === nine && d[0].missed === 0 && d[0].next === T(2026, 11, 7, 9), 'its time: start it, and its next is tomorrow');
d = due([ent({ running: { since: nine - DAY, fire: nine - DAY } })], nine + 1000, { zone: UTC });
ok(acts(d) === '1:busy' && d[0].next === T(2026, 11, 7, 9), 'its run from yesterday is still going: this fire is skipped -- never two runs of one entry');
d = due([ent()], nine + 10 * MIN, { zone: UTC });
ok(acts(d) === '1:missed' && d[0].missed === 1 && d[0].next === T(2026, 11, 7, 9), 'first seen 10 min late (no runner was running): missed, not run late');
d = due([ent()], nine + 10 * MIN, { zone: UTC, grace: 15 * MIN });
ok(acts(d) === '1:start', '...unless the grace is longer (run --once --grace 15m, called that often)');
d = due([ent({ next: T(2026, 11, 3, 9) })], nine + 30000, { zone: UTC });
ok(acts(d) === '1:start' && d[0].missed === 3 && d[0].missedLast === T(2026, 11, 5, 9) && d[0].fire === nine, 'off for three days: those three are counted as missed, only today\'s runs -- no burst');
d = due([ent({ next: T(2026, 11, 3, 9) })], nine + 3 * HOUR, { zone: UTC });
ok(acts(d) === '1:missed' && d[0].missed === 4 && d[0].next === T(2026, 11, 7, 9), '...and when today\'s is late too, all four are missed and it waits for tomorrow');
const everyMin = { kind: 'every', n: 1, unit: 'm', from: T(2025, 11, 6, 9) };
const t0 = Date.now();
d = due([{ id: '7', spec: everyMin, next: everyMin.from + MIN }], nine + 5000, { zone: UTC });
ok(acts(d) === '7:start' && d[0].missed === 525599 && d[0].fire === nine && Date.now() - t0 < 500, 'every minute, a year off: 525,599 missed counted at once, the one just due runs');
d = due([{ id: '3', spec: once, next: T(2026, 12, 1, 9) }], T(2026, 12, 1, 12), { zone: UTC });
ok(acts(d) === '3:missed' && d[0].next === null, 'a --once that was missed has nothing left: done');
d = due([{ id: '1', host: '10005', spec: at9, next: nine }, { id: '2', host: '10005', spec: at9, next: nine }, { id: '3', host: '10001', spec: at9, next: nine }], nine + 1000, { zone: UTC });
ok(acts(d) === '1:start,2:queue,3:start', 'one visit per machine: #2 waits for #1 on 10005; #3, on another machine, starts');
d = due([{ id: '1', host: '10005', spec: at9, next: nine + DAY }, { id: '2', host: '10005', spec: at9, next: nine + DAY, running: { queued: true, fire: nine } }], nine + 20 * MIN, { zone: UTC });
ok(acts(d) === '2:start' && d[0].queued && d[0].fire === nine && d[0].next === undefined, 'the machine is free again: the one waiting starts (its own next untouched)');
d = due([{ id: '1', host: '10005', spec: at9, next: nine + DAY, running: { since: nine, fire: nine } }, { id: '2', host: '10005', spec: at9, next: nine + DAY, running: { queued: true, fire: nine } }], nine + 20 * MIN, { zone: UTC });
ok(d.length === 0, '...and not while the run before it holds the machine');
d = due([{ id: '1', host: '10005', spec: at9, next: nine, running: { queued: true, fire: nine - DAY } }], nine + 1000, { zone: UTC });
ok(acts(d) === '1:busy,1:start', 'waiting since yesterday when today\'s fire comes: today\'s is skipped, yesterday\'s starts -- one run');
d = due([{ id: '1', spec: at130, next: T(2026, 11, 1, 5, 30) }], T(2026, 11, 1, 5, 30) + 1000, { zone: eastern });
ok(acts(d) === '1:start' && d[0].next === T(2026, 11, 2, 6, 30), 'DST: the first 01:30 starts; the next is tomorrow\'s');
ok(due([{ id: '1', spec: at130, next: T(2026, 11, 2, 6, 30) }], T(2026, 11, 1, 6, 30) + 1000, { zone: eastern }).length === 0, '...and at the second 01:30 nothing is due');
ok(upcoming([{ id: '1', name: 'a', spec: at9, next: nine }, { id: '2', name: 'b', spec: ev30, next: T(2026, 11, 6, 12, 30) }, { id: '3', name: 'c', spec: once, next: null, done: true }], nine - HOUR, 4, UTC)
   .map((f) => f.id + '@' + new Date(f.at).toISOString().slice(11, 16)).join() === '1@09:00,2@12:30,2@13:00,2@13:30', 'upcoming: every entry\'s next fires, merged in order; a done one has none');

// ---- the runner, in-process: an injected clock and launcher, no processes -----------------------------------------------
(async () => {
  const W1 = path.join(tmp, 'w-inproc');
  let clock = T(2026, 11, 6, 8, 59);
  const calls = [], gates = {};
  const ctx = {
    paths: S.pathsOf(W1), now: () => clock, zone: UTC, grace: 2 * MIN, out: () => {},
    launch: (entry, run) => new Promise((resolve) => { calls.push({ id: entry.id, dir: run.dir, fire: run.fire }); gates[entry.id] = resolve; }),
  };
  const readSt = () => JSON.parse(fs.readFileSync(ctx.paths.state, 'utf8'));
  const settle = async (rt) => { await Promise.all([...rt.active.values()].map((j) => j.promise)); };
  fs.mkdirSync(W1, { recursive: true });
  fs.writeFileSync(ctx.paths.state, JSON.stringify({ v: 1, seq: 4, entries: [
    { id: '1', name: 'every half hour', host: '10001', cmd: 'x', spec: { kind: 'every', n: 30, unit: 'm', from: T(2026, 11, 6, 8, 30) }, next: T(2026, 11, 6, 9) },
    { id: '2', name: 'report', host: '10002', recipe: 'r.json', spec: at9, next: nine },
    { id: '3', name: 'same machine', host: '10002', cmd: 'y', spec: at9, next: nine },
    { id: '4', name: 'throws', cmd: 'z', spec: at9, next: nine + DAY },
  ] }));
  const rt = S.newRuntime();
  S.tick(ctx, rt);
  ok(calls.length === 0, 'runner: before 09:00 nothing starts');
  clock = nine + 1000;
  S.tick(ctx, rt);
  ok(calls.map((c) => c.id).join() === '1,2', 'runner: at 09:00 #1 and #2 start; #3 waits for machine 10002');
  let st = readSt();
  ok(st.entries[2].running && st.entries[2].running.queued && st.entries[1].running.dir === 'schedule/2/20261106-090001', '...#3 is marked waiting; #2 runs in <work>/schedule/<id>/<time>');
  ok(fs.existsSync(calls[0].dir), '...each run has its own folder');
  clock = T(2026, 11, 6, 9, 30) + 1000;
  S.tick(ctx, rt);
  st = readSt();
  ok(calls.length === 2 && st.entries[0].overlapped.n === 1 && st.entries[0].next === T(2026, 11, 6, 10), 'runner: at 09:30 #1 is still running -- that fire is skipped and counted, next 10:00');
  gates['2']({ result: 'failed', why: 'a milestone\'s proof failed', code: 5 });
  await settle({ active: new Map([...rt.active].filter(([id]) => id === '2')) });
  S.tick(ctx, rt);
  st = readSt();
  ok(calls.map((c) => c.id).join() === '1,2,3' && calls[2].fire === nine, 'runner: #2 ended, so machine 10002 is free -- #3 starts on its 09:00 fire');
  ok(st.entries[1].last.result === 'failed' && st.entries[1].last.code === 5 && st.entries[1].running === null && st.entries[1].runs === 1, '...#2\'s failure is recorded with its why and code');
  ok(st.entries[0].running && !st.entries[0].last, '...while #1 runs on: a failing job does not stop the others');
  gates['1']({ result: 'ok', why: 'fine' });
  gates['3']({ result: 'ok' });
  await settle(rt);
  st = readSt();
  ok(st.entries[0].last.result === 'ok' && st.entries[0].runs === 1 && st.entries[2].last.result === 'ok' && !st.entries[2].running, 'runner: each end is recorded on its own entry');
  // a launcher that throws is a failed run, not a dead runner
  ctx.launch = () => { throw new Error('boom'); };
  clock = nine + DAY + 1000;
  S.tick(ctx, rt);
  await settle(rt);
  st = readSt();
  ok(st.entries[3].last.result === 'failed' && /boom/.test(st.entries[3].last.why) && rt.active.size === 0, 'runner: a launcher that throws is a failed run, recorded -- the runner goes on');
  const log = fs.readFileSync(ctx.paths.log, 'utf8');
  ok(/#2 "report"  failed  /.test(log) && /#1 "every half hour"  skipped/.test(log) && /#3 "same machine"  waiting/.test(log) && /#1 "every half hour"  started/.test(log),
     'schedule.log has a line for each start, end, skip and wait');
  // a runner that stopped mid-run left a mark: the next runner records it as interrupted, and runs nothing twice
  st = readSt();
  st.entries[0].running = { since: clock, fire: st.entries[0].next, runner: 999999, dir: 'schedule/1/x' };
  fs.writeFileSync(ctx.paths.state, JSON.stringify(st));
  ctx.launch = async () => ({ result: 'ok' });
  clock += 1000;
  const code = await S.runner(ctx, { once: true });
  st = readSt();
  ok(code === 0 && st.entries[0].last.result === 'interrupted' && !st.entries[0].running, 'runner: what a stopped runner left running is recorded as interrupted');
  ok(!fs.existsSync(ctx.paths.runner), '...and the runner\'s own mark is gone when it ends');

  // the foreground loop, with the real launcher: a command starts when due; stopping the runner ends it -- recorded
  // "interrupted", and its process does not outlive it
  const W4 = path.join(tmp, 'w-loop'), HANG = path.join(tmp, 'hang-loop.js');
  fs.writeFileSync(HANG, "require('fs').writeFileSync(require('path').join(process.env.SM_SCHEDULE_DIR, 'hang.pid'), String(process.pid)); setInterval(() => {}, 1000);\n");
  const lctx = Object.assign({}, ctx, { paths: S.pathsOf(W4), launch: S.launchJob, now: () => nine + 1000 });
  fs.mkdirSync(W4, { recursive: true });
  fs.writeFileSync(lctx.paths.state, JSON.stringify({ v: 1, seq: 1, entries: [{ id: '1', name: 'hangs', cmd: q(node) + ' ' + q(HANG), spec: at9, next: nine, runs: 0 }] }));
  const lrt = S.newRuntime(), loop = S.runner(lctx, { rt: lrt });
  let hangPid = 0;
  for (let i = 0; i < 200 && !hangPid; i++) {
    await new Promise((res) => setTimeout(res, 50));
    const e = S.readState(lctx.paths).entries[0];
    if (e.running && e.running.dir) { try { hangPid = Number(fs.readFileSync(path.join(W4, e.running.dir, 'hang.pid'), 'utf8')); } catch (_) {} }
  }
  ok(hangPid > 0 && lrt.active.size === 1 && fs.existsSync(lctx.paths.runner), 'loop: the runner holds its mark and starts the job that is due');
  S.stopRunner(lrt);
  const lcode = await loop;
  const le = S.readState(lctx.paths).entries[0];
  ok(lcode === 0 && le.last && le.last.result === 'interrupted' && !le.running && le.next === T(2026, 11, 7, 9), 'loop: stopped, its run is recorded "interrupted"; the entry keeps its next fire');
  ok(gone(hangPid) && !fs.existsSync(lctx.paths.runner), 'loop: the job\'s process went with it, and so did the runner\'s mark');

  cliTests();
})().catch((e) => { fail++; console.error('  FAIL (exception): ' + ((e && e.stack) || e)); finishUp(); });

// ---- the command line, in child processes against a temp --work folder ------------------------------------------------------
function cliTests() {
  const clear = { SM_SCHEDULE_NOW: '', SM_SCHEDULE_LAUNCHER: '', SM_SCHEDULE_CLIENT: '', SM_SCHEDULE_ALLOW_MS: '', FAKE_CLIENT: '', FAKE_EXIT: '' };
  const cli = (args, env) => {
    const x = spawnSync(node, [SCHEDULE].concat(args), { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, clear, env || {}) });
    return { code: x.status, out: String(x.stdout || '') + String(x.stderr || '') };
  };
  const stateOf = (w) => JSON.parse(fs.readFileSync(path.join(w, 'schedule.json'), 'utf8'));
  const localText = (ms) => wall(ms, LOCAL);
  const now = (ms) => ({ SM_SCHEDULE_NOW: String(ms) });
  // Friday 2026-11-06, 12:00 on this machine's clock
  const NOW0 = instantOf(2026, 10, 6, 12, 0, LOCAL);
  const skills = path.join(tmp, 'skills');
  const RECIPE = path.join(skills, 'fetch-the-report', 'replay.json');
  const SECRET = path.join(skills, 'sign-in', 'replay.json');
  const NOT = path.join(tmp, 'not-a-recipe.json');
  fs.mkdirSync(path.dirname(RECIPE), { recursive: true });
  fs.mkdirSync(path.dirname(SECRET), { recursive: true });
  fs.writeFileSync(RECIPE, JSON.stringify({ kind: 'mission-replay', v: 1, goal: 'Open the weekly report', done: 'the report is open', secrets: 0, milestones: [
    { t: 'Open the site', done: 'the sign-in page', check: { text: { has: 'Sign in' } }, steps: [], cmds: [{ do: 'open', url: 'https://example.test/' }] },
    { t: 'Open the report', done: 'the report', check: { text: { has: 'Report' } }, steps: [], cmds: [{ do: 'click', x: 10, y: 20 }] }] }));
  fs.writeFileSync(SECRET, JSON.stringify({ kind: 'mission-replay', v: 1, goal: 'Sign in', secrets: 1, milestones: [
    { t: 'Sign in', done: 'the dashboard', check: { text: { has: 'Dashboard' } }, steps: [], cmds: [{ do: 'keys', text: '{{secret}}', secret: 1 }] }] }));
  fs.writeFileSync(NOT, JSON.stringify({ plan: [], steps: [] }));
  const W = path.join(tmp, 'work');
  const w = ['--work', W];

  // ---- add: what is refused, then what is kept
  let c = cli(['add', '--host', '10004', '--task', 'tidy the desktop', '--at', '09:00'].concat(w), now(NOW0));
  ok(c.code === 3 && /free-form task/.test(c.out) && /as a mission/.test(c.out) && /node drive\/replay\.js save/.test(c.out) && /--recipe skills\/<a-name>\/replay\.json/.test(c.out),
     'cli: a free-form task is refused (exit 3), saying how to make it a recipe');
  ok(!fs.existsSync(path.join(W, 'schedule.json')), '...and nothing is written');
  ok(cli(['add', '--host', '10004', 'tidy', 'the', 'desktop', '--at', '09:00'].concat(w), now(NOW0)).code === 3, 'cli: the task as plain words is refused the same way');
  c = cli(['add', '--host', '10004', '--recipe', RECIPE, '--at', '25:00'].concat(w), now(NOW0));
  ok(c.code === 2 && /HH:MM/.test(c.out), 'cli: a time that cannot be read is exit 2, with the why');
  ok(cli(['add', '--host', '10004', '--recipe', RECIPE, '--at', '09:00', '--every', '1h'].concat(w), now(NOW0)).code === 2, 'cli: two kinds of when: exit 2');
  ok(/five-digit/.test(cli(['add', '--host', '1004', '--recipe', RECIPE, '--at', '09:00'].concat(w), now(NOW0)).out), 'cli: a host that is not a machine number');
  ok(cli(['add', '--recipe', RECIPE, '--at', '09:00'].concat(w), now(NOW0)).code === 2, 'cli: a recipe with no --host');
  c = cli(['add', '--host', '10004', '--recipe', NOT, '--at', '09:00'].concat(w), now(NOW0));
  ok(c.code === 3 && /not a replay recipe/.test(c.out), 'cli: a file that is not a replay recipe is refused (exit 3)');
  c = cli(['add', '--host', '10004', '--recipe', SECRET, '--at', '09:00'].concat(w), now(NOW0));
  ok(c.code === 3 && /--secret-env/.test(c.out) && /never stores/.test(c.out), 'cli: a recipe that types a secret, with no --secret-env, is refused (exit 3)');
  c = cli(['add', '--host', '10004', '--recipe', RECIPE, '--once', localText(NOW0 - HOUR)].concat(w), now(NOW0));
  ok(c.code === 2 && /has passed/.test(c.out), 'cli: a --once in the past is exit 2');
  ok(cli(['add', '--host', '10004', '--recipe', RECIPE, '--at', '09:00', '--bogus', '1'].concat(w), now(NOW0)).code === 2, 'cli: an unknown option is exit 2');
  ok(!fs.existsSync(path.join(W, 'schedule.json')), 'cli: nothing refused was written');

  c = cli(['add', '--host', '10004', '--recipe', RECIPE, '--at', '09:00', '--days', 'mon-fri'].concat(w), now(NOW0));
  ok(c.code === 0 && /added #1 "fetch-the-report"/.test(c.out) && /mon-fri at 09:00/.test(c.out), 'cli: a recipe at 09:00 on weekdays is added as #1, named after its skill');
  ok(/must press Allow/.test(c.out) && /pre-authorised/.test(c.out) && /unattended-access\.md/.test(c.out) && /never retried in a loop/.test(c.out), '...and add says every visit still needs Allow unless the owner pre-authorised it');
  const FAKEJOB = path.join(tmp, 'fake-job.js');
  fs.writeFileSync(FAKEJOB, "console.log('a command job ran');\n");
  c = cli(['add', '--host', '10005', '--cmd', q(node) + ' ' + q(FAKEJOB), '--every', '30m', '--name', 'tick'].concat(w), now(NOW0));
  ok(c.code === 0 && /added #2 "tick"/.test(c.out), 'cli: a command line every 30 min is #2');
  c = cli(['add', '--host', '10001', '--cmd', q(node) + ' ' + q(FAKEJOB), '--once', localText(NOW0 + 5 * MIN), '--name', 'once soon'].concat(w), now(NOW0));
  ok(c.code === 0 && /added #3/.test(c.out), 'cli: a --once five minutes from now is #3');
  c = cli(['add', '--host', '10002', '--recipe', SECRET, '--secret-env', 'REPORT_PASSWORD', '--every', '1d', '--name', 'with a secret'].concat(w), now(NOW0));
  ok(c.code === 0 && /added #4/.test(c.out), 'cli: a recipe with a secret, named by --secret-env, is #4');
  let st = stateOf(W);
  const byId = (id) => st.entries.find((e) => e.id === id);
  ok(st.entries.length === 4 && byId('1').recipe === RECIPE && byId('1').spec.days.join() === 'mon,tue,wed,thu,fri' && byId('1').next === nextFire(byId('1').spec, NOW0) &&
     /^open the weekly report \(a scheduled run\)$/.test(byId('1').task), 'cli: schedule.json holds each entry with its next fire, and the Allow card\'s line');
  ok(byId('2').spec.from === NOW0 && byId('2').next === NOW0 + 30 * MIN, 'cli: --every is anchored to when it was added');
  ok(byId('4').secretEnv.join() === 'REPORT_PASSWORD' && byId('4').next === nextFire(byId('4').spec, NOW0), 'cli: a secret is named, never stored');

  // ---- list, next, remove
  c = cli(['list'].concat(w), now(NOW0 + MIN));
  ok(c.code === 0 && /runner: +not running/.test(c.out) && /#1  fetch-the-report  machine 10004/.test(c.out) && /#2  tick  machine 10005/.test(c.out) &&
     /when: mon-fri at 09:00   next: Mon 2026-11-09 09:00/.test(c.out) && /next: Fri 2026-11-06 12:30 \(in 29 min\)/.test(c.out), 'cli: list shows each entry, when it runs next, and that no runner is running');
  const lj = JSON.parse(cli(['list', '--json'].concat(w), now(NOW0 + MIN)).out);
  ok(lj.entries.length === 4 && lj.runner === null && lj.entries[0].when === 'mon-fri at 09:00', 'cli: list --json');
  c = cli(['next', '--n', '3'].concat(w), now(NOW0));
  const lines = c.out.trim().split('\n');
  ok(c.code === 0 && lines.length === 3 && /12:05 .*#3 once soon/.test(lines[0]) && /12:30 .*#2 tick/.test(lines[1]) && /13:00 .*#2 tick/.test(lines[2]), 'cli: next --n 3 merges the next fires in order');
  const nj = JSON.parse(cli(['next', '--n', '4', '--json'].concat(w), now(NOW0)).out);
  ok(nj.map((f) => f.id).join() === '3,2,2,2' && nj[0].at === NOW0 + 5 * MIN, 'cli: next --json');
  c = cli(['remove', '4'].concat(w), now(NOW0));
  ok(c.code === 0 && /removed #4 "with a secret"/.test(c.out) && stateOf(W).entries.length === 3, 'cli: remove <id>');
  ok(/no entry #4/.test(cli(['remove', '#4'].concat(w), now(NOW0)).out), 'cli: removing it again: no such entry (exit 2)');

  // ---- run --once with a fake job launcher: the one job due starts, and its result is recorded
  const LAUNCHER = path.join(tmp, 'fake-launcher.js');
  fs.writeFileSync(LAUNCHER, [
    "const fs = require('fs'), path = require('path');",
    "const e = JSON.parse(process.env.SM_SCHEDULE_ENTRY);",
    "fs.appendFileSync(path.join(process.env.FAKE_OUT, 'started.ndjson'), JSON.stringify({ id: e.id, dir: process.env.SM_SCHEDULE_DIR, host: process.env.SM_SCHEDULE_HOST }) + '\\n');",
    "console.log('the fake job ran #' + e.id);",
    "process.exit(Number(process.env.FAKE_EXIT || 0));"].join('\n'));
  const started = () => { try { return fs.readFileSync(path.join(tmp, 'started.ndjson'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };
  const launcher = (ms, extra) => Object.assign({ SM_SCHEDULE_NOW: String(ms), SM_SCHEDULE_LAUNCHER: q(node) + ' ' + q(LAUNCHER), FAKE_OUT: tmp }, extra || {});
  c = cli(['run', '--once'].concat(w), launcher(NOW0 + 30 * MIN + 5000));
  ok(c.code === 0 && started().length === 1 && started()[0].id === '2' && started()[0].host === '10005', 'run --once at 12:30: the one job due (#2) starts, through the injected launcher (' + c.out.trim().split('\n').pop() + ')');
  st = stateOf(W);
  ok(byId('2').last && byId('2').last.result === 'ok' && byId('2').runs === 1 && byId('2').running === null && byId('2').next === NOW0 + 60 * MIN && /fake job ran #2/.test(byId('2').last.why),
     '...its result is recorded, and its next fire is 13:00');
  ok(fs.existsSync(path.join(W, byId('2').last.dir, 'output.log')) && path.resolve(started()[0].dir) === path.join(W, byId('2').last.dir), '...it ran in its own folder, <work>/schedule/2/<time>');
  ok(byId('3').done && byId('3').last.result === 'missed' && byId('3').missed.n === 1 && !started().some((x) => x.id === '3'), 'the --once at 12:05 came while no runner was running: missed, done -- never run late');
  let log = fs.readFileSync(path.join(W, 'schedule.log'), 'utf8');
  ok(/#2 "tick"  started/.test(log) && /#2 "tick"  ok/.test(log) && /#3 "once soon"  missed/.test(log), 'schedule.log: a line per run, and one for the miss');
  ok(!fs.existsSync(path.join(W, 'schedule.runner.json')), 'run --once leaves no runner mark behind');
  c = cli(['run', '--once'].concat(w), launcher(NOW0 + 30 * MIN + 20000));
  ok(c.code === 0 && started().length === 1 && /nothing is due now/.test(c.out), 'run --once again: nothing is due -- nothing runs twice');
  c = cli(['run', '--once'].concat(w), launcher(NOW0 + 60 * MIN + 5000, { FAKE_EXIT: '1' }));
  st = stateOf(W);
  ok(c.code === 4 && started().length === 2 && byId('2').last.result === 'failed' && /exited with 1/.test(byId('2').last.why) && byId('2').next === NOW0 + 90 * MIN, 'a job that fails: recorded "failed", run --once exits 4');
  c = cli(['list'].concat(w), now(NOW0 + 61 * MIN));
  ok(/last: failed, Fri 2026-11-06 13:00/.test(c.out) && /missed 1 while no runner was running/.test(c.out) && /next: done/.test(c.out), 'list shows how the last run ended, the missed fire, and a --once that is done');
  // a command job through the real launcher
  fs.writeFileSync(path.join(W, 'schedule.json'), JSON.stringify(Object.assign(stateOf(W), { entries: stateOf(W).entries.filter((e) => e.id === '2') })));
  c = cli(['run', '--once'].concat(w), now(NOW0 + 90 * MIN + 5000));
  st = stateOf(W);
  ok(c.code === 0 && byId('2').last.result === 'ok' && /a command job ran/.test(byId('2').last.why), 'a command line runs as it is, from the kit\'s folder; its last line is the why');

  // ---- a recipe job, end to end, against a stand-in client: let in, replayed, signed off
  const CLIENT = path.join(tmp, 'fake-client.js');
  fs.writeFileSync(CLIENT, [
    "// stands in for core/agent-join.js --serve: FAKE_CLIENT=serve (let in at once), never (nobody presses Allow), refuse,",
    "// revoke (an operator ends the visit at its first command: the serve's own note), crash (it dies without a word)",
    "const fs = require('fs'), path = require('path');",
    "const argv = process.argv.slice(2), arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : ''; };",
    "const dir = arg('serve'), mode = process.env.FAKE_CLIENT || 'serve';",
    "fs.writeFileSync(path.join(dir, '_argv.json'), JSON.stringify(argv));",
    "fs.writeFileSync(path.join(dir, '_pid'), String(process.pid));",
    "console.log('[>] code 1234-5678 -- somebody who can see machine ' + arg('host') + ' has been asked.');",
    "if (mode === 'refuse') { console.error('[x] refused by a person'); process.exit(3); }",
    "if (mode === 'never') { setInterval(() => {}, 1000); return; }",
    "fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ w: 800, h: 600, host: arg('host'), at: Date.now() }));",
    "const cmdFile = path.join(dir, 'cmd.json'), doneFile = path.join(dir, 'done.json');",
    "setInterval(() => {",
    "  let raw = ''; try { raw = fs.readFileSync(cmdFile, 'utf8'); } catch (_) { return; }",
    "  let c; try { c = JSON.parse(raw); } catch (_) { return; }",
    "  try { fs.unlinkSync(cmdFile); } catch (_) { return; }",
    "  fs.appendFileSync(path.join(dir, '_frames.ndjson'), JSON.stringify(c) + '\\n');",
    "  if (mode === 'crash') process.exit(1);",
    "  if (mode === 'revoke') { const n = { ok: false, why: 'an operator ended this visit', stopped: true }; fs.writeFileSync(path.join(dir, 'stopped.json'), JSON.stringify(n)); fs.writeFileSync(doneFile, JSON.stringify(n)); process.exit(0); }",
    "  fs.writeFileSync(doneFile, JSON.stringify({ ok: true }));",
    "  if (c.do === 'done' || c.do === 'quit') process.exit(0);",
    "}, 8);"].join('\n'));
  const W2 = path.join(tmp, 'work2');
  const w2 = ['--work', W2];
  c = cli(['add', '--host', '10003', '--recipe', RECIPE, '--every', '1h', '--name', 'report'].concat(w2), now(NOW0));
  ok(c.code === 0, 'visit: a recipe every hour is added');
  const client = (ms, mode) => ({ SM_SCHEDULE_NOW: String(ms), SM_SCHEDULE_CLIENT: CLIENT, FAKE_CLIENT: mode || 'serve', SM_SCHEDULE_ALLOW_MS: '1000' });
  c = cli(['run', '--once'].concat(w2), client(NOW0 + HOUR + 5000));
  let v = stateOf(W2).entries[0];
  ok(c.code === 0 && v.last && v.last.result === 'ok' && v.last.why === 'every milestone achieved', 'visit: let in, the recipe replayed, recorded ok (' + c.out.trim().split('\n').pop() + ')');
  const vdir = v.last ? path.join(W2, v.last.dir) : tmp;
  const frames = (() => { try { return fs.readFileSync(path.join(vdir, '_frames.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (_) { return []; } })();
  ok(frames.length && frames[0].do === 'mission' && frames[0].op === 'plan' && frames.filter((f) => f.do === 'plan').length === 2 && frames.filter((f) => f.op === 'achieve').length === 2,
     'visit: drive/replay.js ran on it -- the plan posted, each milestone run as one plan and proven');
  const bye = frames[frames.length - 1] || {};
  ok(bye.do === 'done' && /scheduled job "report" is done: every milestone achieved/.test(bye.text || ''), 'visit: then a sign-off in the room (done) ended the visit');
  const argv = (() => { try { return JSON.parse(fs.readFileSync(path.join(vdir, '_argv.json'), 'utf8')); } catch (_) { return []; } })();
  const after = (k) => argv[argv.indexOf(k) + 1];
  ok(argv.includes('--control') && path.resolve(after('--serve')) === vdir && after('--host') === '10003' && /\(a scheduled run\)$/.test(after('--task')) && /^\d+$/.test(after('--parent-pid')),
     'visit: asked for the way mcp/server.js asks -- --host, --task, --control, --serve <its own folder>, --parent-pid');
  ok(/^schedule\/1\/\d{8}-\d{6}$/.test(v.last.dir) && fs.existsSync(path.join(vdir, 'client.log')) && fs.existsSync(path.join(vdir, 'replay.log')), 'visit: its folder is <work>/schedule/<id>/<time>, with client.log and replay.log');
  c = cli(['run', '--once'].concat(w2), client(NOW0 + 2 * HOUR + 5000, 'never'));
  v = stateOf(W2).entries[0];
  ok(c.code === 4 && v.last.result === 'not let in' && /nobody pressed Allow within 1 s/.test(v.last.why) && /the code was 1234-5678/.test(v.last.why),
     'visit: nobody pressed Allow -- recorded "not let in", with the code (exit 4)');
  ok(v.next === NOW0 + 3 * HOUR && v.runs === 2 && !v.running, '...and it waits for its next time: not retried in a loop');
  c = cli(['run', '--once'].concat(w2), client(NOW0 + 3 * HOUR + 5000, 'refuse'));
  v = stateOf(W2).entries[0];
  ok(c.code === 4 && v.last.result === 'not let in' && /refused by a person/.test(v.last.why), 'visit: a person refused -- "not let in", with their answer');
  c = cli(['run', '--once'].concat(w2), client(NOW0 + 4 * HOUR + 5000, 'revoke'));
  v = stateOf(W2).entries[0];
  ok(c.code === 4 && v.last.result === 'failed' && /an operator ended this visit/.test(v.last.why) && v.last.why.split('an operator ended this visit').length === 2,
     'visit: ended by an operator mid-replay -- "failed", with the serve\'s reason, said once');
  const t1 = Date.now();
  c = cli(['run', '--once'].concat(w2), client(NOW0 + 5 * HOUR + 5000, 'crash'));
  v = stateOf(W2).entries[0];
  ok(c.code === 4 && v.last.result === 'failed' && /the visit ended during the replay -- the visit ended: its client exited \(1\)/.test(v.last.why) && Date.now() - t1 < 15000,
     'visit: its client dies mid-replay -- the replay is stopped at once (not left to time out), "failed"');
  log = fs.readFileSync(path.join(W2, 'schedule.log'), 'utf8');
  ok((log.match(/started/g) || []).length === 5 && /#1 "report"  not let in/.test(log), 'visit: one log line per start and per end');

  // ---- limits: a run past its --limit is stopped, with everything it started; one runner at a time
  const W3 = path.join(tmp, 'work3');
  const HANG = path.join(tmp, 'hang.js');
  fs.writeFileSync(HANG, "require('fs').writeFileSync(require('path').join(process.env.SM_SCHEDULE_DIR, 'hang.pid'), String(process.pid)); setInterval(() => {}, 1000);\n");
  fs.mkdirSync(W3, { recursive: true });
  const every1h = { kind: 'every', n: 1, unit: 'h', from: NOW0 };
  fs.writeFileSync(path.join(W3, 'schedule.json'), JSON.stringify({ v: 1, seq: 2, entries: [
    { id: '1', name: 'hangs', host: '10001', cmd: q(node) + ' ' + q(HANG), spec: every1h, limit: 800, added: NOW0, next: NOW0 + HOUR, runs: 0 },
    { id: '2', name: 'waits for Allow', host: '10002', recipe: RECIPE, spec: every1h, limit: 800, added: NOW0, next: NOW0 + HOUR, runs: 0 }] }));
  c = cli(['run', '--once', '--work', W3], Object.assign(client(NOW0 + HOUR + 5000, 'never'), { SM_SCHEDULE_ALLOW_MS: '30000' }));
  const ended = stateOf(W3).entries;
  const pidIn = (e) => { for (const f of ['hang.pid', '_pid']) { try { return Number(fs.readFileSync(path.join(W3, e.last.dir, f), 'utf8')); } catch (_) {} } return 0; };
  ok(c.code === 4 && ended[0].last.result === 'timed out' && ended[1].last.result === 'timed out', 'a command and a visit that run past their --limit are stopped: "timed out" (exit 4)');
  ok(pidIn(ended[0]) > 0 && gone(pidIn(ended[0])), '...and the command\'s own process went with its shell (the whole tree)');
  ok(pidIn(ended[1]) > 0 && gone(pidIn(ended[1])), '...and the visit\'s client was stopped while it waited for Allow');
  const mark = path.join(W3, 'schedule.runner.json');
  fs.writeFileSync(mark, JSON.stringify({ pid: process.pid, since: NOW0, on: os.hostname() }));
  c = cli(['run', '--once', '--work', W3], now(NOW0 + 2 * HOUR + 5000));
  ok(c.code === 3 && new RegExp('a runner is already running \\(pid ' + process.pid).test(c.out), 'one runner at a time: with a live runner\'s mark, run is refused (exit 3)');
  ok(new RegExp('runner: +running \\(pid ' + process.pid).test(cli(['list', '--work', W3], now(NOW0)).out), '...and list names that runner');
  const old = new Date(Date.now() - 20 * MIN);
  fs.utimesSync(mark, old, old);
  c = cli(['run', '--once', '--work', W3], Object.assign(client(NOW0 + 2 * HOUR + 5000, 'never'), { SM_SCHEDULE_ALLOW_MS: '30000' }));
  ok(c.code === 4 && stateOf(W3).entries[0].runs === 2 && !fs.existsSync(mark), 'a mark nobody has touched for 10 minutes is a runner that died (its pid may be reused): taken over');
  finishUp();
}

function finishUp() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log((fail ? 'FAIL' : 'ok') + ' schedule: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
}

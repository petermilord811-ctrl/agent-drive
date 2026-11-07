#!/usr/bin/env node
'use strict';
// @tool run a saved job on a schedule or when something happens: a proven recipe (drive/replay.js) or a command line, at a time, every N, once, or on a relay alert, a new file or a call -- every visit still needs Allow
// @run  node drive/schedule.js add --host 10004 --recipe skills/<name>/replay.json --at 09:00 --days mon-fri   then   node drive/schedule.js run
// schedule.js -- A JOB THAT WAS DONE ONCE AND PROVEN, DONE AGAIN WHEN IT IS DUE.
//
// A job saved by drive/replay.js needs no AI to run again: its recipe holds every command, and the proof of every
// milestone. So it can run at 09:00 on weekdays, every two hours, or once next Tuesday, with nobody driving it -- or
// when something happens: the relay alerts that a machine is offline, a file lands in a folder, a script calls. This
// keeps the list of such jobs and a runner that starts each one when it is due:
//
//   add     a job and when it runs:  --recipe skills/<name>/replay.json | --cmd "<a command line>",  with
//           --at HH:MM [--days mon,tue,...|mon-fri|weekdays]  |  --every 30m|2h|1d|1w  |  --once "YYYY-MM-DD HH:MM"
//           |  --on <event> [--machine <number[,number...]|name>] [--match *.csv] [--debounce 1m]   (drive/triggers.js)
//           [--name] [--task <the Allow card's line>] [--limit 4h] [--secret-env NAME, one per secret the recipe types]
//   list    what is scheduled, when each runs next (a trigger: what it waits for, when it last fired), how its last run
//           ended, the fires it missed, skipped or counted in a burst
//   remove  an entry (a run in progress finishes)
//   next    the next fire times, every entry merged [--n 5]
//   hook    the address to paste into the relay's webhook setting, and each direct call's [--new-token: replace them]
//   run     the runner, in the foreground: it starts each job when it is due or when its event comes (--once: what is
//           due now, then exit) [--listen [host:]port: where the relay's alerts and direct calls reach it]
//   (each takes --work <dir>, where the state lives: the kit's work/ by default, which is never committed)
//
// THE RULES IT KEEPS
//   * A job is a replayable recipe or a plain command line. A FREE-FORM TASK CANNOT RUN UNATTENDED -- with no recipe
//     there is no driver to decide its steps -- so `add` refuses one and says how to make the recipe: do the job once
//     as a mission, then `node drive/replay.js save`.
//   * A recipe job is a visit, started the way mcp/server.js starts one: core/agent-join.js --control --serve
//     <work>/schedule/<id>/<time>. It waits until the visit is serving, or gives up after ~3 minutes; then
//     `drive/replay.js run`; then `done` -- a sign-off saying how it went -- ends the visit and hands the grant back.
//   * EVERY VISIT STILL NEEDS ALLOW. Nothing here can press it: a person who can see the machine does, unless the
//     machine's owner pre-authorised this agent (docs/reference/unattended-access.md). A run nobody let in is recorded
//     as "not let in" and waits for its next time -- it is never retried in a loop. `add` says so.
//   * Never two runs of the same entry at once: a fire that comes while its run is still going is skipped, and
//     counted. One visit per machine: a job whose machine is busy with another entry's run waits for that run to end.
//   * A fire missed while no runner was running (seen more than --grace late, 2 min by default) is skipped and shown
//     in `list` -- never caught up in a burst. A missed --once is done.
//   * A failing job does not stop the others: each runs in processes of its own, is stopped after its --limit, and
//     its end is recorded alone.
//   * Times are this machine's local time. --at fires at that time of day, on the --days given (every day without).
//     --every counts from when the entry was added: minutes and hours as elapsed time, days and weeks as calendar days
//     at the time of day it was added. --once fires once, then the entry is done. DST: a time the clocks jump over
//     fires when they have jumped (02:30 -> 03:30); a time they show twice fires the first time only -- never twice
//     in a day, never a day lost.
//   * The state is <work>/schedule.json; a line per run goes to <work>/schedule.log; a run's files to
//     <work>/schedule/<id>/<time>/ (client.log and replay.log for a visit, output.log for a command). One runner at a
//     time: <work>/schedule.runner.json names it, touched as it runs (a mark left by one that died is taken over).
//     Nothing here installs a service or an OS scheduled task -- whoever wants one starts `run` from their own.
//
// TRIGGERS (--on): a job that starts when something happens -- one of the relay's health alerts (alert-offline,
// recovered-disk, ...: its webhook posts them to the runner's listener), a new file in a folder (file:<folder>), or a
// direct call (http). drive/triggers.js says what the relay really sends and what each event matches. They keep every
// rule above, and these:
//   * EVERY RULE STILL HOLDS: never two runs of one entry, one visit per machine, Allow on every visit -- a triggered
//     run nobody lets in is recorded "not let in" and waits for the entry's next event, never retried in a loop --
//     and one failing job stops nothing else.
//   * A BURST STARTS ONE RUN: the same event again within the entry's --debounce of the run it started (1 min by
//     default: a quiet-hours summary opened up, an outage alerting on every machine, ten files landing together) is
//     counted in `list`, never started; one that comes later while that run still goes is skipped and counted.
//   * THE EVENT'S FACTS ARE HANDED TO THE JOB AS VALUES: a recipe gets --set event=... --set machine=<number>
//     --set file=<full path> on its `drive/replay.js run` line (a recipe ignores names it does not use; a replay.js
//     that cannot take them yet is found out before anybody is asked to let the visit in); a command gets SM_EVENT,
//     SM_MACHINE, SM_FILE and SM_EVENT_FILE (the whole event, as JSON) in its environment -- never spliced into its
//     command line, and add refuses one that expands %SM_FILE% outside double quotes (cmd.exe would run what a
//     file's name holds). --host from-alert visits the machine the alert names; --machine <number>[,<number>...]
//     says which it may be -- without it, whoever holds the token chooses, and add says so.
//   * A FILE starts it once, when its size has held still (not while it is being written); the same file never again.
//   * THE LISTENER (run: when an entry waits for an alert or a call, or --listen asks) is on 127.0.0.1:8754 unless
//     --listen names another address -- this machine alone; binding wider is the user's explicit choice. The relay's
//     webhook carries no signature, so EVERY request must carry the book's secret token in its path (/hook/<token>
//     for the relay, /run/<id>/<token> for a call): made on first use in schedule.json, printed by `hook`, replaced
//     by `hook --new-token`. Without it a request gets the 404 of any unknown address, and nothing is kept of it but
//     a count (list shows it). Only a runner that keeps running hears alerts and calls; `run --once` looks for files.
//
// Pure, exported and proven in tests/schedule.js: parseSpec(args) -> {ok, spec} | {ok:false, why}; nextFire(spec,
// afterMs, zone?) -> ms | null; due(entries, nowMs, {grace, zone}?) -> what to start, queue or skip. A ZONE is a
// function from an instant to its offset from UTC in minutes -- LOCAL is this machine's -- so a test hands in one with
// a DST change and every rule is checked anywhere. The event side is pure too, in drive/triggers.js (hookEvents,
// offer, scanFiles), and proven with the listener and the folder watch in tests/triggers.js. The runner takes its
// clock and its launcher from a context; the command line's test hooks: SM_SCHEDULE_NOW (the clock starts there),
// SM_SCHEDULE_LAUNCHER (a command run INSTEAD of each job, the entry in SM_SCHEDULE_ENTRY and the event's facts as a
// command gets them: exit 0 ok, 2 not let in, else failed), SM_SCHEDULE_CLIENT (stands in for core/agent-join.js),
// SM_SCHEDULE_ALLOW_MS (how long a visit waits for Allow).
//
// Exit codes: 0 done; 1 the state could not be read or written; 2 usage: a bad command line, a time that cannot be
// read or has passed, no such entry, no folder to watch; 3 refused: a job that cannot run unattended (no recipe, not a
// replay recipe, a secret with no --secret-env), or a runner is running already; 4 run --once: a job ran and did not
// end ok.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const { putCmd } = require('../core/cmd-file.js');
const { countSecrets } = require('./replay.js');
const T = require('./triggers.js');

const KIT = path.join(__dirname, '..');
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const GRACE_MS = 2 * MIN;     // a fire first seen later than this came while no runner was running: missed
const LIMIT_MS = 4 * HOUR;    // a run still going after this is stopped (add --limit)
const ALLOW_MS = 170000;      // how long a visit waits for Allow: the code expires after two minutes (as mcp/server.js)
const TICK_MS = 15000;        // the runner looks at least this often: an add or a remove from elsewhere, a wake from sleep
const END_MS = 15000;         // how long a visit may take to sign off before its client is stopped
const FILE_POLL_MS = 1000;    // the runner looks in each watched folder this often (a file is whole after T.STEADY_MS)
const p2 = (n) => String(n).padStart(2, '0');
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/^-+\s*/, '');   // one line, never a flag

// ---- time: zones, wall clocks, instants -------------------------------------------------------------------------
// A ZONE is a function: an instant (ms) -> that instant's offset from UTC in minutes. LOCAL is this machine's.
const LOCAL = (ms) => -new Date(ms).getTimezoneOffset();
const fixedZone = (min) => () => min;
// the wall clock at an instant: {y, mo (0-11), d, h, mi, s, dow (0 is Sunday)}
function wallOf(ms, zone) {
  const t = new Date(ms + (zone || LOCAL)(ms) * MIN);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), dow: t.getUTCDay() };
}
// The instant a wall-clock time names (day and month overflow as in Date.UTC). Clocks that jumped over it (spring
// forward): the moment it would have been, so moved on by the jump -- 02:30 is 03:30. Clocks that showed it twice
// (fall back): the FIRST of the two. Either way one instant, so a day never fires twice or not at all.
function instantOf(y, mo, d, h, mi, zone) {
  const z = zone || LOCAL, w = Date.UTC(y, mo, d, h, mi);
  const before = z(w - DAY), after = z(w + DAY);
  const fits = [w - before * MIN, w - after * MIN].filter((t) => t + z(t) * MIN === w);
  return fits.length ? Math.min(...fits) : w - before * MIN;
}

// ---- reading a schedule -------------------------------------------------------------------------------------------
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];   // Date's order: 0 is Sunday
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];         // the order they are written in
const FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOf = (w) => (w.length >= 3 ? FULL.findIndex((f) => f.startsWith(w)) : -1);   // mon, tues, wednesday
function parseDays(text) {
  const words = String(text == null ? '' : text).toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return { ok: false, why: '--days lists days: mon,wed,fri -- or a range, mon-fri -- or weekdays, weekends' };
  const set = new Set();
  for (const w of words) {
    if (/^(weekdays?|workdays?)$/.test(w)) { ['mon', 'tue', 'wed', 'thu', 'fri'].forEach((d) => set.add(d)); continue; }
    if (/^weekends?$/.test(w)) { set.add('sat'); set.add('sun'); continue; }
    if (/^(daily|everyday|all)$/.test(w)) { WEEK.forEach((d) => set.add(d)); continue; }
    const r = /^([a-z]+)-([a-z]+)$/.exec(w);
    if (r) {
      const a = dayOf(r[1]), b = dayOf(r[2]);
      if (a < 0 || b < 0) return { ok: false, why: '--days: "' + w + '" is not a range of days, like mon-fri' };
      for (let i = a; ; i = (i + 1) % 7) { set.add(DAY_NAMES[i]); if (i === b) break; }   // fri-mon wraps over the weekend
      continue;
    }
    const i = dayOf(w);
    if (i < 0) return { ok: false, why: '--days: "' + w + '" is not a day (mon tue wed thu fri sat sun, a range like mon-fri, weekdays, weekends)' };
    set.add(DAY_NAMES[i]);
  }
  return { ok: true, days: WEEK.filter((d) => set.has(d)) };
}
function parseTime(text) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text == null ? '' : text));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return { h: +m[1], mi: +m[2], text: p2(+m[1]) + ':' + m[2] };
}
const UNITS = { m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm', h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd', w: 'w', wk: 'w', wks: 'w', week: 'w', weeks: 'w' };
const UNIT_MS = { m: MIN, h: HOUR, d: DAY, w: 7 * DAY };
function parseDuration(text) {
  const m = /^\s*(\d{1,6})\s*([a-z]+)\s*$/i.exec(String(text == null ? '' : text));
  const unit = m && Object.hasOwn(UNITS, m[2].toLowerCase()) && UNITS[m[2].toLowerCase()];   // not "constructor"
  if (!unit || !(+m[1] > 0)) return null;
  return { n: +m[1], unit, ms: +m[1] * UNIT_MS[unit] };
}
function parseWhen(text) {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*$/.exec(String(text == null ? '' : text));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const c = new Date(Date.UTC(y, mo - 1, d));
  if (h > 23 || mi > 59 || c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return null;
  return { y, mo: mo - 1, d, h, mi, text: m[1] + '-' + m[2] + '-' + m[3] + ' ' + p2(h) + ':' + m[5] };
}
// only the timing flags of a command line's words
function timingFlags(words) {
  const a = {};
  for (let i = 0; i < words.length; i++) {
    const m = /^--(at|days|every|once|on|machine|match)(?:=(.*))?$/.exec(String(words[i]));
    if (m) a[m[1]] = m[2] !== undefined ? m[2] : words[++i];
  }
  return a;
}

// When a job runs -> {ok, spec} | {ok:false, why}. `args` is {at, days, every, once, on, machine, match} as typed
// (strings), or the words of a command line. opts.now anchors --every: the moment the entry is added, to the minute.
//   {kind:'at', time:'09:00', days?:['mon',...]}   {kind:'every', n, unit:'m'|'h'|'d'|'w', from}   {kind:'once', when}
//   {kind:'on', event:'alert-offline'|'recovered-*'|'file'|'http'|..., machine?, folder?, match?}   (drive/triggers.js)
function parseSpec(args, opts) {
  const a = Array.isArray(args) ? timingFlags(args) : (args || {});
  const given = (k) => a[k] != null && a[k] !== false;
  const no = (why) => ({ ok: false, why });
  const kinds = ['at', 'every', 'once', 'on'].filter(given);
  if (!kinds.length) return no('say when it runs: --at HH:MM [--days mon-fri], --every 30m|2h|1d, or --once "YYYY-MM-DD HH:MM" -- or what starts it: --on <event>');
  if (kinds.length > 1) return no('one of --at, --every, --once and --on -- not ' + kinds.map((k) => '--' + k).join(' and '));
  if (given('days') && kinds[0] !== 'at') return no('--days goes with --at, e.g. --at 09:00 --days mon-fri');
  for (const k of ['machine', 'match']) if (given(k) && kinds[0] !== 'on') return no('--' + k + ' goes with --on, e.g. ' + (k === 'machine' ? '--on alert-offline --machine 10004' : '--on file:./inbox --match *.csv'));
  if (kinds[0] === 'on') return T.parseOn(a);
  if (kinds[0] === 'at') {
    const t = parseTime(a.at);
    if (!t) return no('--at is a time of day on a 24-hour clock, HH:MM (09:00, 17:30) -- not "' + a.at + '"');
    const spec = { kind: 'at', time: t.text };
    if (given('days')) {
      const d = parseDays(a.days);
      if (!d.ok) return no(d.why);
      if (d.days.length < 7) spec.days = d.days;   // all seven is every day
    }
    return { ok: true, spec };
  }
  if (kinds[0] === 'every') {
    const p = parseDuration(a.every);
    if (!p) return no('--every is a number and a unit: 30m, 2h, 1d, 1w -- not "' + a.every + '"');
    const spec = { kind: 'every', n: p.n, unit: p.unit };
    if (opts && opts.now != null) spec.from = Math.floor(Number(opts.now) / MIN) * MIN;
    return { ok: true, spec };
  }
  const w = parseWhen(a.once);
  if (!w) return no('--once is a date and a time on this machine\'s clock, "YYYY-MM-DD HH:MM" (e.g. "2026-12-01 09:00") -- not "' + a.once + '"');
  return { ok: true, spec: { kind: 'once', when: w.text } };
}

// ---- when it fires --------------------------------------------------------------------------------------------------
// The first fire strictly after afterMs, or null (a --once whose time has come and gone). zone: LOCAL unless given.
function nextFire(spec, afterMs, zone) {
  const z = zone || LOCAL, after = Number(afterMs);
  if (!spec || !Number.isFinite(after)) return null;
  if (spec.kind === 'once') {
    const w = parseWhen(spec.when);
    if (!w) return null;
    const t = instantOf(w.y, w.mo, w.d, w.h, w.mi, z);
    return t > after ? t : null;
  }
  if (spec.kind === 'at') {
    const t = parseTime(spec.time);
    if (!t) return null;
    const on = spec.days && spec.days.length ? new Set(spec.days.map((d) => DAY_NAMES.indexOf(d))) : null;
    const p = wallOf(after, z);
    // from the day before (a time moved on by a jump can land past midnight) to a week and a day ahead
    for (let k = -1; k <= 8; k++) {
      if (on && !on.has(new Date(Date.UTC(p.y, p.mo, p.d + k)).getUTCDay())) continue;
      const f = instantOf(p.y, p.mo, p.d + k, t.h, t.mi, z);
      if (f > after) return f;
    }
    return null;
  }
  if (spec.kind === 'every') {
    const from = Number(spec.from), n = Number(spec.n);
    if (!Number.isFinite(from) || !(n > 0) || !UNIT_MS[spec.unit]) return null;
    if (spec.unit === 'm' || spec.unit === 'h') {   // elapsed time: from + k steps, k >= 1
      const step = n * UNIT_MS[spec.unit];
      return from + Math.max(1, Math.floor((after - from) / step) + 1) * step;
    }
    // calendar days at the time of day it was added: a day of 23 or 25 hours is still one day
    const stepDays = n * (spec.unit === 'w' ? 7 : 1), a = wallOf(from, z), p = wallOf(after, z);
    const k0 = Math.max(1, Math.floor(Math.round((Date.UTC(p.y, p.mo, p.d) - Date.UTC(a.y, a.mo, a.d)) / DAY) / stepDays));
    for (let k = Math.max(1, k0 - 1); k <= k0 + 2; k++) {
      const f = instantOf(a.y, a.mo, a.d + k * stepDays, a.h, a.mi, z);
      if (f > after) return f;
    }
    return null;
  }
  return null;
}

// The last fire at or before nowMs, counting from an entry's pending one (e.next): {last, prev (the one before it,
// when there is one), count}. Minutes and hours are arithmetic -- a runner off for a year is no loop of 500,000.
function lastFire(e, nowMs, zone) {
  const s = e.spec || {};
  if (s.kind === 'every' && (s.unit === 'm' || s.unit === 'h')) {
    const step = Number(s.n) * UNIT_MS[s.unit], from = Number(s.from);
    if (step > 0 && Number.isFinite(from)) {
      const k0 = Math.round((e.next - from) / step), k = Math.floor((nowMs - from) / step);
      if (k0 >= 1 && k >= k0) return { last: from + k * step, prev: k > k0 ? from + (k - 1) * step : null, count: k - k0 + 1 };
    }
  }
  let last = e.next, prev = null, count = 1;
  for (let i = 0; i < 100000; i++) {
    const f = nextFire(s, last, zone);
    if (f == null || f > nowMs || f <= last) break;
    prev = last; last = f; count++;
  }
  return { last, prev, count };
}

// What to do at nowMs. An entry: {id, host?, spec, next (its pending fire; null when it has none left), running?
// ({queued:true, fire} while it waits for its machine), done?} -- or a trigger's, {spec: {kind: 'on'}, next: null,
// pending? ({fire, facts, host?}: its event came, and it has not started yet)}. -> [{id, act, fire, missed,
// missedLast, next, queued?}]:
//   start   its fire has come -- or its event (a trigger's pending fire) -- or its machine is free again (queued):
//           start it
//   queue   its fire has come but its machine is busy with another entry's run: it waits, and starts when that ends
//   busy    its fire came while its own run is still going (or waiting): skipped -- never two runs of one entry
//   missed  its fire came more than `grace` ago, when no runner was running: skipped, never caught up
// `missed` counts the fires skipped on the way (missedLast the latest of them); `next` is the entry's next fire after
// this one (null: none left; a trigger's decisions have none). opts: {grace, zone, onlyQueued (start only what waits
// for a machine), busy (machines held by runs this runner has going -- one whose entry was removed meanwhile too)}.
function due(entries, nowMs, opts) {
  const o = opts || {}, z = o.zone || LOCAL, grace = o.grace == null ? GRACE_MS : Number(o.grace);
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.id != null);
  const out = [], fresh = [];
  for (const e of o.onlyQueued ? [] : list) {
    if (T.isTrigger(e)) {
      // an event came for it: it starts now, whatever the time -- the runner recorded it a moment ago (one a stopped
      // runner left behind is dropped when the next one starts: recover)
      if (!e.pending || e.done) continue;
      const d = { id: e.id, act: e.running ? 'busy' : 'start', fire: Number(e.pending.fire) || nowMs, missed: 0, trigger: true };
      if (d.act === 'start') fresh.push({ e, d }); else out.push(d);
      continue;
    }
    if (e.done || e.next == null || !(e.next <= nowMs)) continue;
    const f = lastFire(e, nowMs, z);
    const d = { id: e.id, act: 'start', fire: f.last, missed: f.count - 1, missedLast: f.prev, next: nextFire(e.spec, f.last, z) };
    if (nowMs - f.last > grace) Object.assign(d, { act: 'missed', missed: f.count, missedLast: f.last });
    else if (e.running) d.act = 'busy';
    if (d.act === 'start') fresh.push({ e, d }); else out.push(d);
  }
  // one visit per machine: a run in progress holds its machine (a trigger's: the one its event named); those waiting
  // get it first, in the order they came
  const held = new Set(list.filter((e) => e.running && !e.running.queued && T.hostOf(e)).map((e) => T.hostOf(e)).concat((o.busy || []).map(String)));
  const take = (e) => { const h = T.hostOf(e); if (!h) return true; if (held.has(h)) return false; held.add(h); return true; };
  for (const e of list.filter((x) => x.running && x.running.queued).sort((a, b) => (a.running.fire || 0) - (b.running.fire || 0))) {
    if (take(e)) out.push({ id: e.id, act: 'start', fire: e.running.fire, missed: 0, queued: true });
  }
  fresh.sort((a, b) => a.d.fire - b.d.fire);
  for (const { e, d } of fresh) { if (!take(e)) d.act = 'queue'; out.push(d); }
  return out;
}

// The next n fires of every entry, merged: [{at, id, name, host}]
function upcoming(entries, nowMs, n, zone) {
  const out = [];
  for (const e of entries || []) {
    if (!e || e.done) continue;
    let f = e.next != null && e.next > nowMs ? e.next : nextFire(e.spec, nowMs, zone);
    for (let i = 0; i < n && f != null; i++) { out.push({ at: f, id: e.id, name: e.name, host: e.host || null }); f = nextFire(e.spec, f, zone); }
  }
  return out.sort((a, b) => a.at - b.at || Number(a.id) - Number(b.id)).slice(0, n);
}

// ---- saying it ------------------------------------------------------------------------------------------------------
function fmtWhen(ms, zone) {
  if (ms == null || !Number.isFinite(Number(ms))) return '-';
  const w = wallOf(Number(ms), zone);
  return WEEKDAY[w.dow] + ' ' + w.y + '-' + p2(w.mo + 1) + '-' + p2(w.d) + ' ' + p2(w.h) + ':' + p2(w.mi);
}
function stamp(ms, zone) { const w = wallOf(ms, zone); return w.y + '-' + p2(w.mo + 1) + '-' + p2(w.d) + ' ' + p2(w.h) + ':' + p2(w.mi) + ':' + p2(w.s); }
function fmtSpan(ms) {
  const s = Math.round(Math.abs(Number(ms) || 0) / 1000);
  if (s < 60) return s + ' s';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return h + ' h' + (mm ? ' ' + mm + ' min' : '');
  const d = Math.floor(h / 24), hh = h % 24;
  return d + ' d' + (hh ? ' ' + hh + ' h' : '');
}
function daysText(days) {
  const idx = days.map((d) => WEEK.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (idx.length >= 3 && idx[idx.length - 1] - idx[0] === idx.length - 1) return WEEK[idx[0]] + '-' + WEEK[idx[idx.length - 1]];   // mon-fri
  return idx.map((i) => WEEK[i]).join(', ');
}
// "mon-fri at 09:00", "every 30 min, counted from Fri 2026-11-06 14:20", "every 2 days at 14:20", "once, 2026-12-01 09:00",
// "when the relay alerts "offline" for machine 10004"
function describe(spec, zone) {
  if (!spec) return '?';
  if (spec.kind === 'on') return T.describeOn(spec);
  if (spec.kind === 'at') return (spec.days && spec.days.length ? daysText(spec.days) : 'every day') + ' at ' + spec.time;
  if (spec.kind === 'once') return 'once, ' + spec.when;
  if (spec.kind === 'every') {
    const n = Number(spec.n), from = Number(spec.from), cal = spec.unit === 'd' || spec.unit === 'w';
    const unit = { m: 'min', h: 'h', d: n === 1 ? 'day' : 'days', w: n === 1 ? 'week' : 'weeks' }[spec.unit] || spec.unit;
    let s = 'every ' + (n === 1 && cal ? '' : n + ' ') + unit;
    if (Number.isFinite(from)) {
      const w = wallOf(from, zone);
      s += cal ? ' at ' + p2(w.h) + ':' + p2(w.mi) + (spec.unit === 'w' ? ' (' + WEEKDAY[w.dow] + ')' : '') : ', counted from ' + fmtWhen(from, zone);
    }
    return s;
  }
  return '?';
}

// ---- the state: <work>/schedule.json, read and written one process at a time ------------------------------------------
function pathsOf(work) {
  const w = path.resolve(work || path.join(KIT, 'work'));
  return { work: w, state: path.join(w, 'schedule.json'), log: path.join(w, 'schedule.log'), runs: path.join(w, 'schedule'),
           runner: path.join(w, 'schedule.runner.json'), lock: path.join(w, 'schedule.json.lock') };
}
function readState(p) {
  let txt;
  try { txt = fs.readFileSync(p.state, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { v: 1, seq: 0, entries: [] }; throw e; }
  let st;
  try { st = JSON.parse(txt); } catch (e) { throw new Error(p.state + ' is not readable JSON (' + e.message + ') -- fix it, or move it aside to start again'); }
  if (!st || !Array.isArray(st.entries)) throw new Error(p.state + ' is not a schedule: it has no entries list');
  st.seq = Number(st.seq) || 0;
  return st;
}
// written whole, then renamed over the old one -- a reader never sees half of it (Windows refuses the rename while
// another process has the file open, so a refusal is retried, as core/cmd-file.js does). mode: the new file's (the
// schedule holds the listener's token, so it is its owner's alone)
function writeJson(file, obj, mode) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n', mode ? { mode } : undefined);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 100 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      pause(20);
    }
  }
}
// Read, change, write: `fn` changes the state in place, and it is written only if it changed. One process at a time,
// by a lock file; one older than 10 s was left by a process that died.
function withState(p, fn) {
  fs.mkdirSync(p.work, { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try { fs.writeFileSync(p.lock, String(process.pid), { flag: 'wx' }); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(p.lock).mtimeMs; } catch (_) { continue; }
      if (age > 10000) { try { fs.unlinkSync(p.lock); } catch (_) {} continue; }
      if (Date.now() - t0 > 15000) throw new Error('the schedule stayed locked by another process (' + p.lock + ')');
      pause(25);
    }
  }
  try {
    const st = readState(p), before = JSON.stringify(st);
    const r = fn(st);
    if (JSON.stringify(st) !== before) writeJson(p.state, st, 0o600);
    return r;
  } finally { try { fs.unlinkSync(p.lock); } catch (_) {} }
}

// ONE RUNNER AT A TIME: <work>/schedule.runner.json names it while it runs, and is touched every time it looks (at
// least every TICK_MS). A mark not touched for STALE_MS was left by a runner that died -- even when Windows has since
// given its pid to some other process.
const STALE_MS = 10 * MIN;
function alive(pid) { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function runnerOf(p) {
  const r = readJson(p.runner);
  if (!r) return null;
  let age = 0;
  try { age = Date.now() - fs.statSync(p.runner).mtimeMs; } catch (_) { return null; }
  if (age > STALE_MS) return null;
  if (r.on && r.on !== os.hostname()) return r;   // another machine's runner, on a shared folder: it cannot be checked, so it counts
  return alive(Number(r.pid)) ? r : null;
}
function touchRunner(p) { try { const t = new Date(); fs.utimesSync(p.runner, t, t); } catch (_) {} }
function takeRunner(p, now) {
  fs.mkdirSync(p.work, { recursive: true });
  for (let i = 0; i < 5; i++) {
    try { fs.writeFileSync(p.runner, JSON.stringify({ pid: process.pid, since: now, on: os.hostname() }), { flag: 'wx' }); return { ok: true }; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const r = readJson(p.runner);
      if (!r) { let age = 0; try { age = Date.now() - fs.statSync(p.runner).mtimeMs; } catch (_) {} if (age < 5000) { pause(200); continue; } }   // being written
      else if (Number(r.pid) !== process.pid && runnerOf(p)) return { ok: false, pid: r.pid, since: r.since, on: r.on };
      try { fs.unlinkSync(p.runner); } catch (_) {}   // left by a runner that is gone
    }
  }
  return { ok: false };
}
function dropRunner(p) { const r = readJson(p.runner); if (r && Number(r.pid) === process.pid) { try { fs.unlinkSync(p.runner); } catch (_) {} } }
// more on this runner's mark -- where it listens, how many requests it refused -- for list and hook to say
function markRunner(p, extra) { const r = readJson(p.runner); if (r && Number(r.pid) === process.pid) { try { writeJson(p.runner, Object.assign(r, extra)); } catch (_) {} } }

// ---- a job's processes ----------------------------------------------------------------------------------------------------
const LIVE = new Set();   // every process a job started and that has not exited: stopped if the runner exits
function startProc(file, args, o) {
  const fd = fs.openSync(o.log, 'a');
  let child;
  const opts = { cwd: o.cwd, env: o.env || process.env, stdio: ['ignore', fd, fd], windowsHide: true };
  // a shell is handed the whole command line (no argument list beside it); it gets a process group of its own off
  // Windows, so stopping it stops what it started
  try { child = o.shell ? spawn(file, Object.assign(opts, { shell: true, detached: process.platform !== 'win32' })) : spawn(file, args, opts); }
  finally { fs.closeSync(fd); }
  const p = { child, exited: null, tree: !!o.shell };
  LIVE.add(p);
  p.done = new Promise((resolve) => {
    const end = (x) => { if (!p.exited) { p.exited = x; LIVE.delete(p); resolve(x); } };
    child.on('error', (e) => end({ code: null, signal: null, error: e.message }));
    child.on('exit', (code, signal) => end({ code, signal }));
  });
  return p;
}
// a shell's command may have started its own processes: on Windows the whole tree goes (taskkill /T), elsewhere its group
function stopProc(p) {
  if (!p || p.exited) return;
  const pid = p.child.pid;
  if (p.tree && pid && process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    if (r.status === 0) return;
  } else if (p.tree && pid) { try { process.kill(-pid, 'SIGTERM'); return; } catch (_) {} }
  try { p.child.kill(); } catch (_) {}
}
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const done = () => { clearTimeout(t); if (signal) signal.removeEventListener('abort', done); resolve(); };
    const t = setTimeout(done, ms);
    if (signal) signal.addEventListener('abort', done);
  });
}
// until p settles or the signal aborts, whichever is first -- leaving no listener behind
function untilAbort(p, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const onAbort = () => resolve();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const settle = () => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); };
    Promise.resolve(p).then(settle, settle);
  });
}
const aborted = (signal) => (signal && signal.reason === 'timed out'
  ? { result: 'timed out', why: 'it ran past its limit and was stopped' }
  : { result: 'interrupted', why: 'the runner was stopped' });
// what a log says last: its last "[x]" line, its last line, and the last Allow code it printed
function lastWords(file) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch (_) {}
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const x = lines.filter((l) => /^\[x\]/.test(l)).pop();
  const codes = [...txt.matchAll(/\[>\]\s*code\s+(\S+)/g)];
  return { x: x ? x.replace(/^\[x\]\s*/, '') : '', last: lines.length ? lines[lines.length - 1] : '', code: codes.length ? codes[codes.length - 1][1] : '' };
}
// a command's environment: the run, and -- every one set, empty on a clock's run -- the facts of the event that started it
const jobEnv = (entry, run) => Object.assign({ SM_SCHEDULE_ID: String(entry.id), SM_SCHEDULE_NAME: String(entry.name || ''), SM_SCHEDULE_HOST: String(entry.host || ''),
  SM_SCHEDULE_TASK: String(entry.task || ''), SM_SCHEDULE_DIR: run.dir, SM_SCHEDULE_FIRE: new Date(run.fire).toISOString() },
  T.envOf(run.facts), { SM_EVENT_FILE: run.facts ? path.join(run.dir, 'event.json') : '' });

// ---- the jobs ---------------------------------------------------------------------------------------------------------------
// a recipe as add was given it: a path from here, else from the kit; a bare name is skills/<name>/replay.json
function recipeArg(arg) {
  const a = String(arg).trim();
  if (/^[a-z0-9][a-z0-9-]{1,60}$/.test(a) && !fs.existsSync(path.resolve(a))) return path.join(process.env.SM_SKILLS_DIR || path.join(KIT, 'skills'), a, 'replay.json');
  const here = path.resolve(a);
  if (fs.existsSync(here)) return here;
  const inKit = path.resolve(KIT, a);
  return fs.existsSync(inKit) ? inKit : here;
}
// kept relative to the kit when it is inside it (the kit can move), else as it is
function keepPath(abs) { const r = path.relative(KIT, abs); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.split(path.sep).join('/') : abs; }
const recipePath = (kept) => (path.isAbsolute(kept) ? kept : path.join(KIT, kept));
function readRecipe(file) {
  let r;
  try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, why: 'cannot read the recipe ' + file + ' (' + e.message + ') -- save one with: node drive/replay.js save <serve-dir> <name>' }; }
  if (!r || r.kind !== 'mission-replay' || !Array.isArray(r.milestones) || !r.milestones.length) return { ok: false, why: file + ' is not a replay recipe -- save one with: node drive/replay.js save <serve-dir> <name>' };
  return { ok: true, goal: String(r.goal || ''), secrets: countSecrets(r.milestones.map((m) => m && m.cmds)) };
}
// Does this drive/replay.js take --set name=value -- the values a triggered run hands its recipe? Its own text says:
// one from before --set answers the flag with its usage, and that only once somebody has let the visit in.
function takesValues(replayFile) {
  try { return fs.readFileSync(replayFile, 'utf8').includes('--set'); } catch (_) { return false; }
}
// the Allow card's line when add was given none: the recipe's goal, and what starts the run -- the person asked to let
// it in at 03:00 is told it came from the relay's "offline" alert
function defaultTask(goal, name, spec) {
  let g = clean(goal);
  if (/^[A-Z][a-z]/.test(g)) g = g[0].toLowerCase() + g.slice(1);
  return (g || 'run the saved job "' + name + '"') + (spec && spec.kind === 'on' ? ' (a run started by ' + T.shortOn(spec) + ')' : ' (a scheduled run)');
}
const CLIENT_EXIT = {
  1: 'the client could not start: a bad invocation, no SM_JOIN_KEY, or no relay could be reached',
  2: 'not let in by the relay: a wrong key, no such machine, nobody to ask, or nobody answered before the code expired',
  3: 'a person refused',
};
const REPLAY_EXIT = { 2: 'it is not a replay recipe', 3: 'the replay could not start (the plan was refused, or the serve did not answer)',
  4: 'a milestone\'s actions failed', 5: 'a milestone\'s proof failed' };

// A RECIPE JOB IS A VISIT: let in (or not), the recipe replayed, then a sign-off -- started as mcp/server.js's connect
// starts one, in the run's own folder, and given up if nobody presses Allow in time.
async function visitJob(entry, run, ctx) {
  const file = recipePath(String(entry.recipe || ''));
  const r = readRecipe(file);
  if (!r.ok) return { result: 'could not start', why: r.why };
  // a triggered run hands the recipe its event's facts as --set name=value: a drive/replay.js that cannot take them
  // would refuse its line after somebody pressed Allow -- so nobody is asked
  if (run.facts && !takesValues(ctx.replay)) return { result: 'could not start', why: 'drive/replay.js does not take --set name=value yet, which hands a recipe its event\'s facts -- nobody was asked to let it in' };
  const names = entry.secretEnv || [], secrets = [];
  if (r.secrets > names.length) return { result: 'could not start', why: 'the recipe types ' + r.secrets + ' secret(s) and the entry names ' + names.length + ' (--secret-env)' };
  for (const n of names.slice(0, r.secrets)) {
    const v = process.env[n];
    if (v == null || v === '') return { result: 'could not start', why: 'the secret $' + n + ' is not set in the runner\'s environment' };
    secrets.push('--secret', v);
  }
  const task = clean(entry.task) || defaultTask(r.goal, entry.name, entry.spec);
  const clientLog = path.join(run.dir, 'client.log');
  let client;
  try {
    client = startProc(process.execPath, [ctx.client, '--host', String(entry.host), '--task', task, '--control', '--serve', run.dir, '--parent-pid', String(process.pid)],
                       { cwd: run.dir, log: clientLog });
  } catch (e) { return { result: 'could not start', why: 'the client did not start: ' + e.message }; }
  // 1. let in: the visit is serving once ready.json carries the screen's size
  const t0 = Date.now(), allowMs = Number(ctx.allowMs) || ALLOW_MS;
  for (;;) {
    const ready = readJson(path.join(run.dir, 'ready.json'));
    if (ready && Number(ready.w) > 0) break;
    if (client.exited) {
      const c = client.exited.code, lw = lastWords(clientLog);
      return { result: c === 2 || c === 3 ? 'not let in' : 'could not start', code: c,
               why: (lw.x || CLIENT_EXIT[c] || client.exited.error || 'the client exited (' + c + '): ' + lw.last) + (lw.code ? ' (the code was ' + lw.code + ')' : '') };
    }
    if (run.signal.aborted) { stopProc(client); await Promise.race([client.done, sleep(3000)]); return aborted(run.signal); }
    if (Date.now() - t0 > allowMs) {
      stopProc(client);
      await Promise.race([client.done, sleep(3000)]);
      const lw = lastWords(clientLog);
      return { result: 'not let in', why: 'nobody pressed Allow within ' + Math.round(allowMs / 1000) + ' s' + (lw.code ? ' (the code was ' + lw.code + ')' : '') };
    }
    await sleep(200, run.signal);
  }
  // 2. the recipe, replayed on it -- until it ends, or the visit ends under it (revoked, the line lost, the client died)
  let res;
  const replayLog = path.join(run.dir, 'replay.log');
  if (client.exited) res = { result: 'failed', why: 'the visit ended as soon as it was let in' };
  else {
    let rep = null;
    // a triggered run hands the recipe its event's facts: --set event=... --set machine=... --set file=...
    try { rep = startProc(process.execPath, [ctx.replay, 'run', file, run.dir].concat(secrets, T.setArgs(run.facts)), { cwd: KIT, log: replayLog }); }
    catch (e) { res = { result: 'could not start', why: 'the replay did not start: ' + e.message }; }
    if (rep) {
      await untilAbort(Promise.race([rep.done, client.done]), run.signal);
      // a serve that was ended leaves a note the replay reads at once; one that died answers nothing, ever
      if (!rep.exited && client.exited) await Promise.race([rep.done, sleep(1500)]);
      if (!rep.exited) { stopProc(rep); await Promise.race([rep.done, sleep(3000)]); }
      const code = rep.exited ? rep.exited.code : null, rw = lastWords(replayLog);
      if (run.signal.aborted) res = aborted(run.signal);
      else if (code === 0) res = { result: 'ok', code, why: 'every milestone achieved' };
      else res = { result: 'failed', code, why: rw.x || REPLAY_EXIT[code] || (client.exited ? 'the visit ended during the replay' : 'the replay ended with ' + code + (rw.last ? ': ' + rw.last : '')) };
    }
  }
  if (res.result !== 'ok' && client.exited) {   // why the visit ended under it, said once
    const stop = readJson(path.join(run.dir, 'stopped.json')), lw = lastWords(clientLog);
    const why = (stop && stop.why) || lw.x || 'its client exited (' + client.exited.code + ')';
    if (res.why.indexOf(why) < 0) res.why += ' -- the visit ended: ' + why;
  }
  // 3. the end: a sign-off in the room says how it went, and the grant goes back
  if (!client.exited) {
    const text = 'The scheduled job "' + entry.name + '" ' + (res.result === 'ok' ? 'is done: every milestone achieved.' : 'stopped: ' + String(res.why).slice(0, 300) + '.');
    try { putCmd(path.join(run.dir, 'cmd.json'), { do: 'done', text }); } catch (_) {}
    await Promise.race([client.done, sleep(END_MS)]);
    if (!client.exited) { stopProc(client); await Promise.race([client.done, sleep(3000)]); }
  }
  return res;
}

// A command line, run in a shell from the kit's folder (so skills/... paths work); its output goes to output.log.
async function shellJob(line, entry, run, extraEnv, notLetIn) {
  const log = path.join(run.dir, 'output.log');
  let p;
  try { p = startProc(line, [], { shell: true, cwd: KIT, env: Object.assign({}, process.env, jobEnv(entry, run), extraEnv || {}), log }); }
  catch (e) { return { result: 'could not start', why: e.message }; }
  await untilAbort(p.done, run.signal);
  if (!p.exited) { stopProc(p); await Promise.race([p.done, sleep(5000)]); return aborted(run.signal); }
  if (p.exited.error) return { result: 'could not start', why: p.exited.error };
  const said = lastWords(log).last.slice(0, 300), code = p.exited.code;
  if (code === 0) return { result: 'ok', code, why: said };
  if (notLetIn && code === 2) return { result: 'not let in', code, why: said };
  return { result: 'failed', code, why: 'it exited with ' + (code == null ? p.exited.signal : code) + (said ? ': ' + said : '') };
}
// the launcher: a recipe is a visit; a command line is run as it is
const launchJob = (entry, run, ctx) => (entry.recipe ? visitJob(entry, run, ctx) : shellJob(entry.cmd, entry, run));
// TEST HOOK (SM_SCHEDULE_LAUNCHER): a command run INSTEAD of every job, the entry in SM_SCHEDULE_ENTRY
const commandLauncher = (line) => (entry, run) => shellJob(line, entry, run, { SM_SCHEDULE_ENTRY: JSON.stringify(entry) }, true);

// ---- the runner -------------------------------------------------------------------------------------------------------------
// ctx: {paths, now() (the clock), zone, grace, launch(entry, {dir, fire, signal}, ctx) -> {result, why, code}, out(line),
//       and for the real launcher: client, replay, allowMs}
// active: the runs going; watch: each watched folder's look so far; refused: requests to the listener without the token
const newRuntime = () => ({ active: new Map(), results: [], wake: null, stopping: false, watch: new Map(), refused: 0, listening: null, closeTriggers: null });
const workRel = (p, dir) => path.relative(p.work, dir).split(path.sep).join('/');
function note(ctx, e, what, detail) {
  const line = stamp(ctx.now(), ctx.zone) + '  #' + e.id + ' ' + JSON.stringify(String(e.name || '')) + '  ' + what + (detail ? '  ' + detail : '');
  try { fs.mkdirSync(ctx.paths.work, { recursive: true }); fs.appendFileSync(ctx.paths.log, line + '\n'); } catch (_) {}
  if (ctx.out) ctx.out(line);
}
function runDir(p, id, now, zone) {
  const w = wallOf(now, zone), base = path.join(p.runs, String(id), '' + w.y + p2(w.mo + 1) + p2(w.d) + '-' + p2(w.h) + p2(w.mi) + p2(w.s));
  fs.mkdirSync(path.dirname(base), { recursive: true });
  for (let i = 0; ; i++) {
    const d = base + (i ? '-' + i : '');
    try { fs.mkdirSync(d); return d; } catch (e) { if (e.code !== 'EEXIST' || i > 50) throw e; }
  }
}
// One look at the schedule: record what was missed or skipped, mark and start what is due. -> how many started
function tick(ctx, rt, opts) {
  const starts = [];
  // the machines this runner's own runs hold -- the schedule may no longer say so (an entry removed while it runs)
  const busy = [...rt.active.values()].map((j) => j.entry && j.entry.host).filter((h) => h && h !== T.FROM_ALERT);
  withState(ctx.paths, (st) => {
    const now = ctx.now();
    for (const d of due(st.entries, now, { grace: ctx.grace, zone: ctx.zone, onlyQueued: !!(opts && opts.onlyQueued), busy })) {
      const e = st.entries.find((x) => x.id === d.id);
      if (!e) continue;
      if (d.next !== undefined) e.next = d.next;
      if (d.missed) {
        e.missed = { n: ((e.missed && e.missed.n) || 0) + d.missed, last: d.missedLast };
        note(ctx, e, 'missed', d.missed + ' fire(s) while no runner was running, the last ' + fmtWhen(d.missedLast, ctx.zone) + ' -- skipped, not caught up');
      }
      // a trigger's fire carries its event: the facts (and the machine an alert named) go with it into its wait for
      // a machine, and into its run
      const ev = T.isTrigger(e) ? (d.queued ? e.running : e.pending) : null;
      if (T.isTrigger(e) && !d.queued) e.pending = null;
      if (d.act === 'missed') {
        if (e.next == null) { e.done = true; e.last = { fire: d.fire, result: 'missed', why: 'no runner was running at ' + fmtWhen(d.fire, ctx.zone) }; }
      } else if (d.act === 'busy') {
        e.overlapped = { n: ((e.overlapped && e.overlapped.n) || 0) + 1, last: d.fire };
        note(ctx, e, 'skipped', d.trigger ? (ev ? T.factsLine(ev.facts) : 'its event') + ' came while its run was still going'
                                          : 'its ' + fmtWhen(d.fire, ctx.zone) + ' fire came while its run was still going');
      } else if (d.act === 'queue') {
        e.running = { queued: true, fire: d.fire, since: now, runner: process.pid };
        if (ev) Object.assign(e.running, { host: ev.host || undefined, facts: ev.facts, detail: ev.detail });
        note(ctx, e, 'waiting', 'machine ' + T.hostOf(e) + ' is busy with another entry\'s run; it starts when that ends');
      } else if (d.act === 'start') {
        let dir;
        try { dir = runDir(ctx.paths, e.id, now, ctx.zone); } catch (err) {
          e.running = null;
          e.last = { fire: d.fire, start: now, end: now, result: 'could not start', why: 'no folder for the run: ' + err.message };
          if (e.next == null && !T.isTrigger(e)) e.done = true;
          note(ctx, e, 'could not start', e.last.why);
          continue;
        }
        const facts = (ev && ev.facts) || null, host = (ev && ev.host) || null;
        e.running = { fire: d.fire, since: now, runner: process.pid, dir: workRel(ctx.paths, dir) };
        if (host) e.running.host = host;
        if (facts) {
          e.running.facts = facts;
          // the whole event, for a job that wants more than the values it is handed (SM_EVENT_FILE)
          try { writeJson(path.join(dir, 'event.json'), Object.assign({ fire: d.fire }, ev.detail || {}, { facts })); } catch (_) {}
        }
        const entry = JSON.parse(JSON.stringify(e));
        if (host) entry.host = host;   // --host from-alert: this run's machine
        starts.push({ entry, fire: d.fire, start: now, dir, facts });
      }
    }
  });
  for (const s of starts) launch(ctx, rt, s);
  return starts.length;
}
function launch(ctx, rt, s) {
  const e = s.entry, ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timed out'), Number(e.limit) > 0 ? Number(e.limit) : LIMIT_MS);
  note(ctx, e, 'started', (e.host ? 'machine ' + e.host + ', ' : '') + (e.recipe ? 'the recipe ' + e.recipe : 'the command') + '  [' + workRel(ctx.paths, s.dir) + ']' +
                          (s.facts ? '  on ' + T.factsLine(s.facts) : ''));
  const job = { ac, entry: e, promise: null };
  rt.active.set(e.id, job);
  let running;   // started now, before tick returns; a launcher that throws at once is a failed run like any other
  try { running = Promise.resolve(ctx.launch(e, { dir: s.dir, fire: s.fire, signal: ac.signal, facts: s.facts || null }, ctx)); } catch (err) { running = Promise.reject(err); }
  job.promise = running.catch((err) => ({ result: 'failed', why: 'the runner failed on it: ' + ((err && err.message) || err) })).then((res) => {
    clearTimeout(timer);
    res = Object.assign({ result: 'failed', why: '' }, res || {});
    try { finish(ctx, s, res); } catch (err) { if (ctx.out) ctx.out('[x] could not record how #' + e.id + ' ended: ' + err.message); }
    rt.results.push({ id: e.id, result: res.result });
    if (rt.results.length > 1000) rt.results.splice(0, rt.results.length - 1000);   // a runner up for months, triggered often, keeps only the last
    rt.active.delete(e.id);
    if (rt.wake) rt.wake();
  });
}
function finish(ctx, s, res) {
  const end = ctx.now();
  const last = { fire: s.fire, start: s.start, end, result: res.result, why: String(res.why || '').slice(0, 500) };
  if (res.code != null) last.code = res.code;
  last.dir = workRel(ctx.paths, s.dir);
  if (s.facts) last.on = T.factsLine(s.facts);
  let gone = true;
  withState(ctx.paths, (st) => {
    const e = st.entries.find((x) => x.id === s.entry.id);
    if (!e) return;
    gone = false;
    e.running = null; e.last = last; e.runs = (e.runs || 0) + 1;
    if (e.next == null && !T.isTrigger(e)) e.done = true;   // a trigger is never done: it waits for its next event
  });
  note(ctx, s.entry, res.result, fmtSpan(end - s.start) + (last.why ? ' -- ' + last.why : '') + (gone ? ' (the entry was removed meanwhile)' : ''));
}
// What a runner that stopped left marked: it held the runner's file, so every mark is stale once this one holds it
function recover(ctx) {
  withState(ctx.paths, (st) => {
    for (const e of st.entries) {
      // an event that came as that runner stopped: not started late, as a missed fire is not caught up
      if (e.pending) { note(ctx, e, 'dropped', (T.factsLine(e.pending.facts) || 'an event') + ' came as its runner stopped -- not started'); e.pending = null; }
      const r = e.running;
      if (!r) continue;
      e.running = null;
      if (r.queued) { note(ctx, e, 'dropped', 'it was waiting for machine ' + (r.host || e.host) + ' when its runner stopped'); continue; }
      e.last = { fire: r.fire, start: r.since, end: null, result: 'interrupted', why: 'its runner stopped while it ran', dir: r.dir };
      e.runs = (e.runs || 0) + 1;
      if (e.next == null && !T.isTrigger(e)) e.done = true;
      note(ctx, e, 'interrupted', 'its runner stopped while it ran (since ' + fmtWhen(r.since, ctx.zone) + ')');
    }
  });
}
function untilNext(ctx) {
  let soonest = Infinity;
  try { for (const e of readState(ctx.paths).entries) if (e && !e.done && !e.running && e.next != null) soonest = Math.min(soonest, e.next); } catch (_) {}
  return Math.max(200, Math.min(TICK_MS, soonest - ctx.now() + 50));
}
function nextLine(ctx) {
  let st;
  try { st = readState(ctx.paths); } catch (_) { return ''; }
  const f = upcoming(st.entries, ctx.now(), 1, ctx.zone)[0], ev = st.entries.filter(T.isTrigger).length;
  return (f ? 'next: #' + f.id + ' "' + f.name + '" ' + fmtWhen(f.at, ctx.zone) + ' (in ' + fmtSpan(f.at - ctx.now()) + ')' : ev ? 'nothing on the clock' : 'nothing is going to run') +
         (ev ? '; ' + ev + ' entr' + (ev === 1 ? 'y waits' : 'ies wait') + ' for an event' : '');
}

// ---- triggers, in the runner: the relay's alerts and direct calls (the listener), new files (the folder watch) ----------
// One line in schedule.log that is about no single entry (a message from the relay, a call)
function logLine(ctx, text) {
  const line = stamp(ctx.now(), ctx.zone) + '  ' + text;
  try { fs.mkdirSync(ctx.paths.work, { recursive: true }); fs.appendFileSync(ctx.paths.log, line + '\n'); } catch (_) {}
  if (ctx.out) ctx.out(line);
}
// The book's token, made on first use: the relay's webhook and every direct call carry it in their address
function ensureToken(st, now) {
  if (!st.hook || typeof st.hook !== 'object') st.hook = {};
  if (!st.hook.token) Object.assign(st.hook, { token: T.makeToken(), made: now });
  return st.hook.token;
}
// An event, offered to every entry it matches (opts.only: the one it is for): each starts, or waits for its machine,
// or is counted -- recorded at once, and the runner woken to start what it may. -> the decisions
function offerEvent(ctx, rt, ev, opts) {
  const now = ctx.now();
  const ds = withState(ctx.paths, (st) => {
    const out = T.offer(st.entries, ev, now, opts);
    for (const d of out) {
      const e = st.entries.find((x) => x.id === d.id);
      d.name = e.name; d.win = e.debounce != null ? Number(e.debounce) : T.DEBOUNCE_MS;
      if (d.act === 'start' || d.act === 'queue') {
        const detail = Object.assign({}, ev);
        delete detail.entry;
        e.pending = { fire: now, facts: d.facts, detail };
        if (d.host) e.pending.host = d.host;
        e.fired = { at: now, on: T.factsLine(d.facts) };
      } else if (d.act === 'burst') e.bursts = { n: ((e.bursts && e.bursts.n) || 0) + 1, last: now };
      else e.overlapped = { n: ((e.overlapped && e.overlapped.n) || 0) + 1, last: now };
    }
    return out;
  });
  for (const d of ds) {
    if (d.act === 'burst') note(ctx, d, 'counted', T.factsLine(d.facts) + ' -- within ' + fmtSpan(d.win) + ' of the run the same event started: one burst, one run');
    else if (d.act === 'busy') note(ctx, d, 'skipped', T.factsLine(d.facts) + ' came while its run was still going');
  }
  if (ds.some((d) => d.act === 'start' || d.act === 'queue') && rt.wake) rt.wake();
  return ds;
}
const acted = (ds) => {
  const ids = (acts) => ds.filter((d) => acts.includes(d.act)).map((d) => '#' + d.id);
  const go = ids(['start', 'queue']), counted = ids(['burst', 'busy']);
  return (go.length ? 'started ' + go.join(' ') : '') + (go.length && counted.length ? '; ' : '') + (counted.length ? 'counted ' + counted.join(' ') : '') ||
         'no entry waits for it';
};
// POST /hook/<token>: a message from the relay's webhook. Every one is answered 200 -- the relay counts it delivered
// and would not send it again anyway
function onHook(ctx, rt, body) {
  const r = T.hookEvents(body), now = ctx.now(), kind = body && typeof body.event === 'string' ? T.one(body.event, 40) : '?';
  const ds = [];
  for (const ev of r.events) ds.push(...offerEvent(ctx, rt, ev));
  withState(ctx.paths, (st) => {
    if (!st.hook || typeof st.hook !== 'object') st.hook = {};
    st.hook.heard = { n: ((st.hook.heard && st.hook.heard.n) || 0) + 1, at: now, event: kind };
  });
  const what = r.held != null ? kind + ': ' + r.held + ' held alert(s), ' + r.events.length + ' still to act on'
             : r.events.length === 1 ? T.factsLine(T.factsOf(r.events[0])) : kind;
  logLine(ctx, 'hook  ' + what + ' -- ' + (r.why || acted(ds)));
  return { status: 200, json: { ok: true, events: r.events.length, started: ds.filter((d) => d.act === 'start' || d.act === 'queue').map((d) => d.id),
                                counted: ds.filter((d) => d.act === 'burst' || d.act === 'busy').map((d) => d.id), why: r.why || undefined } };
}
// POST /run/<id>/<token>: a direct call starts that entry now -- 202 -- or says why not: 404 no such entry waits for a
// call, 409 it was counted (a burst, or its run still goes)
function onCall(ctx, rt, id) {
  let e;
  try { e = readState(ctx.paths).entries.find((x) => x.id === String(id)); } catch (err) { return { status: 500, json: { ok: false, why: err.message } }; }
  if (!e || !T.isTrigger(e) || e.spec.event !== 'http') return { status: 404, json: { ok: false, why: 'no entry #' + id + ' starts on a call (add one with --on http)' } };
  const d = offerEvent(ctx, rt, { event: 'http', on: 'http', entry: String(id), at: ctx.now() }, { only: id })[0];
  logLine(ctx, 'call  #' + id + ' -- ' + (d ? acted([d]) : 'not started'));
  if (d && (d.act === 'start' || d.act === 'queue')) return { status: 202, json: { ok: true, id: String(id), act: d.act, why: d.act === 'queue' ? 'its machine is busy with another entry\'s run: it starts when that ends' : 'it starts now' } };
  return { status: 409, json: { ok: false, id: String(id), act: d ? d.act : 'none',
                                why: d && d.act === 'burst' ? 'it started less than ' + fmtSpan(d.win) + ' ago: counted as a burst, not started' : 'its run is still going: counted, not started' } };
}
// The files a folder entry has had: <work>/schedule/<id>/files.json, so a file is never offered twice -- not even
// after the runner restarts -- and since when a name has been gone from the folder (it is forgotten after a while)
const seenFile = (p, id) => path.join(p.runs, String(id), 'files.json');
function readSeen(p, e) {
  const j = readJson(seenFile(p, e.id));
  if (!j || !j.seen || typeof j.seen !== 'object' || j.folder !== e.spec.folder) return null;
  return { seen: j.seen, missing: j.missing && typeof j.missing === 'object' ? j.missing : {} };
}
function writeSeen(p, e, had) {
  fs.mkdirSync(path.dirname(seenFile(p, e.id)), { recursive: true });
  writeJson(seenFile(p, e.id), { folder: e.spec.folder, seen: had.seen, missing: had.missing || {} });
}
// One look in every watched folder: a new file whose size has held still is offered to its entry -- after it is
// written down as had, so it is never offered twice. A folder that cannot be read is said once, and looked at again.
function scanFolders(ctx, rt) {
  let st;
  try { st = readState(ctx.paths); } catch (_) { return; }
  const live = new Set();
  for (const e of st.entries.filter(T.watchesFolder)) {
    live.add(e.id);
    let w = rt.watch.get(e.id);
    if (!w || w.folder !== e.spec.folder || w.match !== (e.spec.match || '')) {
      const had = readSeen(ctx.paths, e);
      w = { folder: e.spec.folder, match: e.spec.match || '', re: T.globRe(e.spec.match), seen: had && had.seen, missing: had ? had.missing : {}, cand: {}, broken: '' };
      rt.watch.set(e.id, w);
    }
    let listing;
    try { listing = T.listFolder(w.folder, w.re); } catch (err) {
      if (w.broken !== err.code) { w.broken = err.code; note(ctx, e, 'cannot look', 'in ' + w.folder + ' (' + (err.code || err.message) + ') -- looking again'); }
      continue;
    }
    if (w.broken) { w.broken = ''; note(ctx, e, 'looking again', 'in ' + w.folder); }
    if (!w.seen) {   // no record of what it had (it was deleted): what is there now counts as there before
      w.seen = T.snapshot(listing); w.missing = {};
      try { writeSeen(ctx.paths, e, w); } catch (_) {}
      note(ctx, e, 'watching', w.folder + ' -- its ' + listing.length + ' file(s) there now are taken as there before');
      continue;
    }
    const r = T.scanFiles(w, listing, ctx.now(), ctx.steadyMs, ctx.forgetMs);
    w.cand = r.cand;
    if (r.changed) {
      try { writeSeen(ctx.paths, e, r); } catch (err) { note(ctx, e, 'cannot write', seenFile(ctx.paths, e.id) + ' (' + err.message + ') -- the new files wait'); continue; }
      w.seen = r.seen; w.missing = r.missing;
    }
    for (const f of r.ready) {
      try { offerEvent(ctx, rt, { event: 'file', on: 'file', entry: e.id, file: path.join(w.folder, f.name), size: f.size, at: f.ms }, { only: e.id }); }
      catch (err) { note(ctx, e, 'could not start', f.name + ': ' + err.message); }
    }
  }
  for (const id of [...rt.watch.keys()]) if (!live.has(id)) rt.watch.delete(id);
}
// The listener and the folder watch, for one runner: opened when an entry needs them (or --listen asked), closed with
// it. A listener that cannot open (the port is taken) is said, and tried again a minute later -- the clock's jobs run on.
function triggersFor(ctx, rt, once) {
  const t = { srv: null, timer: null, failedAt: 0, closed: false };
  const tok = { at: 0, v: '' };
  const token = () => {   // read again at most once a second, so `hook --new-token` takes hold at once
    if (Date.now() - tok.at > 1000) { tok.at = Date.now(); try { const st = readState(ctx.paths); tok.v = (st.hook && st.hook.token) || ''; } catch (_) {} }
    return tok.v;
  };
  const say = ctx.out || (() => {});
  function open() {
    const where = ctx.listen || { host: T.DEFAULT_HOST, port: T.DEFAULT_PORT };
    withState(ctx.paths, (st) => { ensureToken(st, ctx.now()); });
    tok.at = 0;
    const srv = T.listener({ token, refused: () => { rt.refused++; }, hook: (body) => onHook(ctx, rt, body), run: (id) => onCall(ctx, rt, id) });
    t.srv = srv;
    srv.on('error', (err) => {
      if (srv.listening) { say('[x] the listener: ' + err.message); return; }
      t.srv = null; t.failedAt = Date.now();
      if (t.failSaid) return;   // said once; tried again each minute, quietly
      t.failSaid = true;
      say('[x] cannot listen on ' + T.urlHost(where.host) + ':' + where.port + ' (' + (err.code || err.message) + '): the relay\'s alerts and direct calls do not reach this runner -- ' +
          'another port: run --listen <port>. Trying again each minute.');
    });
    srv.listen(where.port, where.host, () => {
      if (t.closed) { srv.close(); return; }
      const at = T.urlHost(where.host) + ':' + srv.address().port;
      rt.listening = at; t.failSaid = false;
      markRunner(ctx.paths, { listen: at });
      say('[+] listening on http://' + at + ' for the relay\'s alerts and direct calls (node drive/schedule.js hook prints their addresses)');
      if (!T.loopback(where.host)) say('[!] ' + at + ' can be reached from other machines: whoever reaches it with the address and its token starts these jobs, and plain http carries the token in clear');
    });
  }
  // what the schedule needs now: the listener, the folder watch. Never throws -- a schedule locked for a moment is
  // looked at again on the next round, and the runner runs on
  t.refresh = () => {
    if (t.closed) return;
    try {
      const st = readState(ctx.paths);
      const ear = st.entries.filter(T.needsListener).length, files = st.entries.some(T.watchesFolder);
      if (!once && !t.srv && (ctx.listen || ear) && Date.now() - t.failedAt > MIN) open();
      if (!once && files && !t.timer) t.timer = setInterval(() => { try { scanFolders(ctx, rt); } catch (err) { say('[x] the folder watch: ' + err.message); } }, ctx.filePollMs || FILE_POLL_MS);
      if (!files && t.timer) { clearInterval(t.timer); t.timer = null; }
      if (once && (ear || ctx.listen) && !t.toldOnce) {
        t.toldOnce = true;
        say('[.] ' + (ear ? ear + ' entr' + (ear === 1 ? 'y waits' : 'ies wait') + ' for the relay\'s alerts or a call: ' : '--once does not listen: ') +
            'only a runner that keeps running hears them (node drive/schedule.js run)');
      }
    } catch (err) { say('[x] ' + err.message); }
  };
  // run --once: two looks in each folder, a file's steady time apart -- what is whole by then is offered
  t.filePass = async () => {
    try {
      if (!readState(ctx.paths).entries.some(T.watchesFolder)) return;
      scanFolders(ctx, rt);
      await sleep((ctx.steadyMs != null ? ctx.steadyMs : T.STEADY_MS) + 150);
      scanFolders(ctx, rt);
    } catch (err) { say('[x] the folder watch: ' + err.message); }
  };
  t.close = () => {
    t.closed = true;
    if (t.timer) { clearInterval(t.timer); t.timer = null; }
    if (t.srv) { const s = t.srv; t.srv = null; try { s.close(); s.closeAllConnections(); } catch (_) {} }
    rt.listening = null;
  };
  return t;
}
// The runner: one at a time; clears what a stopped runner left marked; then looks at the schedule until stopped --
// or, with once, starts what is due now, waits for it (and for what waited for its machine), and returns. -> exit code
async function runner(ctx, opts) {
  const once = !!(opts && opts.once), rt = (opts && opts.rt) || newRuntime();
  const say = ctx.out || (() => {});
  const held = takeRunner(ctx.paths, ctx.now());
  if (!held.ok) {
    say('[x] a runner is already running' + (held.pid ? ' (pid ' + held.pid + (held.on ? ' on ' + held.on : '') + ', since ' + fmtWhen(held.since, ctx.zone) + ')' : '') + ': it starts what is due -- one at a time');
    return 3;
  }
  let broken = false;
  const tg = triggersFor(ctx, rt, once);
  rt.closeTriggers = tg.close;
  try {
    recover(ctx);
    if (!once) say('[+] the runner is running (pid ' + process.pid + ', ' + ctx.paths.state + ') -- Ctrl+C stops it. ' + nextLine(ctx));
    if (once) await tg.filePass();
    tg.refresh();
    let marked = 0;
    for (let first = true; ; first = false) {
      if (!rt.stopping && !broken) {
        try {
          const n = tick(ctx, rt, { onlyQueued: once && !first });
          if (once && first && !n && !rt.active.size) say('[.] nothing is due now -- ' + nextLine(ctx));
        } catch (e) { say('[x] ' + e.message); if (once) broken = true; }
      }
      if ((once || rt.stopping) && !rt.active.size) break;
      await new Promise((resolve) => {
        const t = setTimeout(resolve, once || rt.stopping ? 1000 : untilNext(ctx));
        rt.wake = () => { clearTimeout(t); resolve(); };
      });
      rt.wake = null;
      touchRunner(ctx.paths);
      if (rt.refused !== marked) { marked = rt.refused; markRunner(ctx.paths, { refused: marked }); }
      if (!rt.stopping) tg.refresh();
    }
  } finally { tg.close(); dropRunner(ctx.paths); }
  if (broken) return 1;
  return once && rt.results.some((r) => r.result !== 'ok') ? 4 : 0;
}

// ---- the command line --------------------------------------------------------------------------------------------------------
const USAGE = [
  'usage:',
  '  node drive/schedule.js add --host <number> (--recipe skills/<name>/replay.json | --cmd "<a command line>")',
  '      (--at HH:MM [--days mon,tue,...|mon-fri|weekdays] | --every 30m|2h|1d|1w | --once "YYYY-MM-DD HH:MM"',
  '       | --on <event> [--machine <number[,number...]|name>] [--match *.csv] [--debounce 1m])',
  '      [--name "..."] [--task "<the line on the Allow card>"] [--limit 4h] [--secret-env NAME]...',
  '      <event>: alert-<rule> (alert-offline, alert-*), recovered-<rule>, resolved-<rule>, digest, monthly-report, test,',
  '               file:<folder>, http;  --host from-alert visits the machine the alert names',
  '  node drive/schedule.js list [--json]           what is scheduled, when each runs next, how its last run ended',
  '  node drive/schedule.js remove <id>',
  '  node drive/schedule.js next [--n 5] [--json]   the next fire times',
  '  node drive/schedule.js hook [--new-token] [--listen [host:]port] [--json]   the address for the relay\'s webhook, and each call\'s',
  '  node drive/schedule.js run [--once] [--grace 2m] [--listen [host:]port]   the runner, in the foreground (--once: what is due now, then exit)',
  '  each takes --work <dir>: where schedule.json, schedule.log and the runs are (default: the kit\'s work/)',
].join('\n');
const FLAGS = {
  add: { values: ['host', 'recipe', 'cmd', 'at', 'days', 'every', 'once', 'on', 'machine', 'match', 'debounce', 'name', 'task', 'limit', 'secret-env', 'work'], switches: [] },
  list: { values: ['work'], switches: ['json'] },
  remove: { values: ['work'], switches: [] },
  next: { values: ['n', 'work'], switches: ['json'] },
  hook: { values: ['work', 'listen'], switches: ['new-token', 'json'] },
  run: { values: ['work', 'grace', 'listen'], switches: ['once'] },
};
// --flag value (or --flag=value), --switch, and words
function parseArgs(words, values, switches) {
  const opts = {}, pos = [];
  for (let i = 0; i < words.length; i++) {
    const w = String(words[i]);
    if (!/^--[a-z]/i.test(w)) { pos.push(w); continue; }
    let name = w.slice(2), val;
    const eq = name.indexOf('=');
    if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq); }
    if (switches.includes(name)) { if (val !== undefined) return { why: '--' + name + ' takes no value' }; opts[name] = true; continue; }
    if (!values.includes(name)) return { why: 'unknown option --' + name };
    if (val === undefined) { if (i + 1 >= words.length) return { why: '--' + name + ' needs a value' }; val = String(words[++i]); }
    if (name === 'secret-env') (opts[name] = opts[name] || []).push(val);
    else if (opts[name] !== undefined) return { why: '--' + name + ' is given twice' };
    else opts[name] = val;
  }
  return { opts, pos };
}
function contextOf(o, env) {
  const t0 = Date.now(), n = String(env.SM_SCHEDULE_NOW || '').trim();
  let base = null;
  if (n) {
    base = /^\d+$/.test(n) ? Number(n) : Date.parse(n);
    if (!Number.isFinite(base)) throw new Error('SM_SCHEDULE_NOW is a time -- ms since 1970, or ISO 8601 -- not "' + n + '"');
  }
  let grace = GRACE_MS;
  if (o.grace != null) {
    const d = parseDuration(o.grace);
    if (!d) throw new Error('--grace is how late a fire may be seen and still run: 2m, 15m, 1h');
    grace = d.ms;
  }
  let listen = null;
  if (o.listen != null) {
    listen = T.parseListen(o.listen);
    if (!listen) throw new Error('--listen is where the runner listens: a port (8754), or an address and a port (127.0.0.1:8754, 0.0.0.0:8754) -- not "' + o.listen + '"');
  }
  return {
    paths: pathsOf(o.work), zone: LOCAL, grace, listen, steadyMs: T.STEADY_MS, forgetMs: T.FORGET_MS, filePollMs: FILE_POLL_MS,
    now: base == null ? () => Date.now() : () => base + (Date.now() - t0),
    allowMs: Math.max(1000, Number(env.SM_SCHEDULE_ALLOW_MS) || ALLOW_MS),
    client: env.SM_SCHEDULE_CLIENT ? path.resolve(env.SM_SCHEDULE_CLIENT) : path.join(KIT, 'core', 'agent-join.js'),
    replay: path.join(__dirname, 'replay.js'),
    launch: env.SM_SCHEDULE_LAUNCHER ? commandLauncher(env.SM_SCHEDULE_LAUNCHER) : launchJob,
    out: (line) => console.log(line),
  };
}

function add(o, pos, ctx) {
  const fail = (code, why) => { console.error('[x] ' + why); return code; };
  if (o.recipe != null && o.cmd != null) return fail(2, 'a job is one of --recipe or --cmd, not both');
  const host = o.host == null ? '' : String(o.host).trim();
  if (o.recipe == null && o.cmd == null) {
    const what = clean(o.task || pos.join(' '));
    const h = host || '<number>';
    console.error('[x] ' + (what ? '"' + what + '" is a free-form task' : 'no job given') + ': a schedule runs with no AI driving it, so nothing would decide its steps.');
    console.error('    It runs a proven recipe (--recipe) or a command line (--cmd). To make the recipe, do the job once as a mission');
    console.error('    -- node core/agent-join.js --host ' + h + ' --task "..." --control --serve <dir>, planned as milestones, each proven --');
    console.error('    then save it:   node drive/replay.js save <that serve dir> <a-name>');
    console.error('    and schedule:   node drive/schedule.js add --host ' + h + ' --recipe skills/<a-name>/replay.json --at 09:00');
    return 3;
  }
  if (pos.length) return fail(2, 'what is "' + pos.join(' ') + '"? Everything add takes is a --flag (the Allow card\'s line is --task "...")');
  const fromAlert = host.toLowerCase() === T.FROM_ALERT;
  if (host && !fromAlert && !/^[0-9]{5}$/.test(host)) return fail(2, '--host is the five-digit machine number (got "' + host + '") -- or from-alert: the machine a relay alert names');
  if (o.recipe != null && !host) return fail(2, 'a recipe runs on a machine: --host <its five-digit number>');
  const now = ctx.now();
  const ps = parseSpec(o, { now });
  if (!ps.ok) return fail(2, ps.why);
  const trig = ps.spec.kind === 'on', on = trig ? T.partsOf(ps.spec.event) : null;
  let next = null;
  if (!trig) {
    next = nextFire(ps.spec, now, ctx.zone);
    if (next == null) return fail(2, 'that time has passed: ' + describe(ps.spec, ctx.zone) + ', and it is ' + fmtWhen(now, ctx.zone) + ' here');
  }
  if (fromAlert) {
    if (!on || !on.rule) return fail(2, '--host from-alert takes the machine from a relay alert: it goes with --on alert-<rule>, recovered-<rule> or resolved-<rule>');
    if (T.NO_MACHINE.has(on.rule)) return fail(2, 'a "' + on.rule + '" alert is about no machine, so --host from-alert would have none to visit');
    if (on.rule === 'site' && !T.machineNums(ps.spec)) return fail(2, 'a site alert names several machines: with --host from-alert, say which with --machine <number>[,<number>...]');
  }
  let debounce = null;
  if (o.debounce != null) {
    if (!trig) return fail(2, '--debounce goes with --on: how long the same event again counts as the same burst');
    debounce = T.parseSpan(o.debounce);
    if (debounce == null || debounce > DAY) return fail(2, '--debounce is a span from 0 to a day: 0, 30s, 2m, 1h -- not "' + o.debounce + '"');
  }
  let seen = null;
  if (trig && ps.spec.event === 'file') {
    let s = null;
    try { s = fs.statSync(ps.spec.folder); } catch (_) {}
    if (!s || !s.isDirectory()) return fail(2, 'there is no folder ' + ps.spec.folder + ' to watch -- give the folder the files land in (make it first if need be)');
    try { seen = T.snapshot(T.listFolder(ps.spec.folder, T.globRe(ps.spec.match))); } catch (e) { return fail(2, 'the folder ' + ps.spec.folder + ' cannot be read: ' + e.message); }
  }
  let limit = LIMIT_MS;
  if (o.limit != null) { const d = parseDuration(o.limit); if (!d) return fail(2, '--limit is how long a run may take: 30m, 2h'); limit = d.ms; }
  const secretEnv = [].concat(o['secret-env'] || []);
  const badName = secretEnv.find((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
  if (badName !== undefined) return fail(2, '--secret-env names an environment variable (letters, digits and _), not "' + badName + '"');
  const entry = { id: '', name: '', host: host || null };
  if (o.recipe != null) {
    const file = recipeArg(o.recipe), r = readRecipe(file);
    if (!r.ok) return fail(3, r.why);
    if (r.secrets > secretEnv.length) {
      return fail(3, 'the recipe types ' + r.secrets + ' secret(s) that were never recorded, and a schedule has nobody to type them and never stores one. ' +
        'Name the environment variable that holds each, in order: --secret-env NAME (the runner reads it when the job starts)');
    }
    if (secretEnv.length > r.secrets) return fail(2, 'the recipe types ' + r.secrets + ' secret(s), and --secret-env named ' + secretEnv.length);
    entry.name = clean(o.name) || (path.basename(file) === 'replay.json' ? path.basename(path.dirname(file)) : '') || clean(r.goal) || 'recipe';
    entry.recipe = keepPath(file);
    entry.task = clean(o.task) || defaultTask(r.goal, entry.name, ps.spec);
    if (secretEnv.length) entry.secretEnv = secretEnv;
  } else {
    const cmd = String(o.cmd).trim();
    if (!cmd) return fail(2, '--cmd is a command line, e.g. --cmd "node skills/<name>/<script>.js ..."');
    if (secretEnv.length) return fail(2, '--secret-env goes with --recipe: a command reads its own environment');
    // whoever drops a file chooses its name, and cmd.exe expands %SM_FILE% BEFORE it reads & | < > -- so a file named
    // "a&b.csv" would run b.csv. Inside double quotes it is only a name (a Windows name cannot hold a ")
    const bare = T.bareFileVar(cmd);
    if (bare) return fail(2, '--cmd expands ' + bare + ' outside double quotes, where cmd.exe would run what a file\'s name holds ("a&b.csv" runs b.csv): ' +
                             'quote it -- "' + bare + '" -- or read SM_FILE inside the program (process.env.SM_FILE)');
    entry.name = clean(o.name) || cmd.slice(0, 40);
    entry.cmd = cmd;
    if (clean(o.task)) entry.task = clean(o.task);
  }
  if (fromAlert) entry.host = T.FROM_ALERT;
  Object.assign(entry, { spec: ps.spec, limit, added: now, next, runs: 0 });
  if (trig) entry.debounce = debounce != null ? debounce : T.DEBOUNCE_MS;
  const token = withState(ctx.paths, (st) => {
    st.seq += 1; entry.id = String(st.seq);
    // the folder as it is now, written down before the entry exists: no runner can take these files for new ones
    if (seen) writeSeen(ctx.paths, entry, { seen });
    st.entries.push(entry);
    return trig && T.needsListener(entry) ? ensureToken(st, now) : '';
  });
  const where = fromAlert ? ' on the machine the alert names' : entry.host ? ' on machine ' + entry.host : '';
  console.log('[+] added #' + entry.id + ' "' + entry.name + '": ' + (entry.recipe ? 'the recipe ' + entry.recipe : 'the command ' + JSON.stringify(entry.cmd)) +
              where + ', ' + describeEntry(entry, ctx.zone));
  const rn = runnerOf(ctx.paths);
  if (!trig) console.log('    next: ' + fmtWhen(next, ctx.zone) + ' (in ' + fmtSpan(next - now) + ')');
  else {
    console.log('    it starts on that event, not on a clock: ' + (entry.debounce ? 'the same event again within ' + fmtSpan(entry.debounce) + ' of the run it started is counted, not started'
                                                                     : 'each one starts a run, unless its run is still going (then it is counted)'));
    const base = 'http://' + listenAt(ctx, rn), n = Object.keys(seen || {}).length;
    if (entry.spec.event === 'http') console.log('[.] start it with a call:  curl -X POST ' + base + '/run/' + entry.id + '/' + token);
    else if (entry.spec.event === 'file') console.log('[.] the runner watches ' + entry.spec.folder + ' for new files' + (entry.spec.match ? ' matching ' + entry.spec.match : '') +
                                                       ' -- ' + (n === 1 ? 'the 1 file there now is' : 'the ' + n + ' files there now are') + ' taken as there before');
    else {
      console.log('[.] the relay posts its alerts to the runner\'s listener: paste ' + base + '/hook/' + token);
      console.log('    into the relay\'s Health settings, "a webhook (JSON POST)" -- the relay must be able to reach that address: node drive/schedule.js hook says how');
    }
  }
  if (entry.recipe) {
    console.log('[!] Every run asks ' + (fromAlert ? 'the machine the alert names' : 'machine ' + host) + ' to let it in: a person who can see that machine must press Allow (the code');
    console.log('    expires in about two minutes) -- unless its owner pre-authorised this agent (docs/reference/unattended-access.md).');
    console.log('    A run nobody lets in is recorded as "not let in" and waits for its next ' + (trig ? 'event' : 'time') + '; it is never retried in a loop.');
    if (fromAlert && on.on === 'alert' && (on.rule === 'offline' || on.rule === 'site')) {
      console.log('[!] An offline machine cannot be visited: these runs would only be "not let in". --on recovered-' + on.rule + ' starts the job once it is back.');
    }
    if (trig && !takesValues(path.join(__dirname, 'replay.js'))) {
      console.log('[!] This kit\'s drive/replay.js does not take --set name=value yet, which hands a recipe its event\'s facts: until it does,');
      console.log('    each run is recorded "could not start" -- before anybody is asked to let it in.');
    }
  } else console.log('[!] If the command visits a machine, that visit needs Allow like any other (docs/reference/unattended-access.md).');
  // --host from-alert with no machine NUMBERS: the alert names the machine, and the relay's webhook is not signed --
  // whoever holds the token can name any machine this agent may ask, one that pre-authorised it included
  if (fromAlert && !T.machineNums(entry.spec)) {
    console.log('[!] --host from-alert visits whichever machine an alert names, and whoever holds the token can send one naming any machine');
    console.log('    this agent may ask -- one that pre-authorised it included. Name the machines it may visit: --machine <number>[,<number>...]');
  }
  console.log(rn ? '[.] the runner (pid ' + rn.pid + ') starts it when ' + (trig ? 'its event comes' : 'it is due') + (trig && T.needsListener(entry) && !rn.listen ? ' -- it listens from its next look, within ' + fmtSpan(TICK_MS) : '')
                 : '[.] nothing starts until a runner runs: node drive/schedule.js run   (it stays in the foreground' + (trig && T.needsListener(entry) ? ', and listens' : '') + ')');
  return 0;
}
// an entry's when, with its own id where the words have a place for it (a call's address)
const describeEntry = (e, zone) => describe(e.spec, zone).replace('/run/<id>/', '/run/' + e.id + '/');
// where the runner listens, as an address says it: the running runner's own, else --listen, else the default
function listenAt(ctx, rn) {
  if (rn && rn.listen && !ctx.listen) return rn.listen;
  const w = ctx.listen || { host: T.DEFAULT_HOST, port: T.DEFAULT_PORT };
  return T.urlHost(w.host) + ':' + w.port;
}

function stateOf(e, now, runner, zone) {
  if (e.running && e.running.queued) return 'waiting for machine ' + T.hostOf(e) + ' (its ' + fmtWhen(e.running.fire, zone) + (T.isTrigger(e) ? ' event' : ' fire') + ')';
  if (e.running) return 'running since ' + fmtWhen(e.running.since, zone) + (runner ? '' : ' -- but no runner is running: it was interrupted');
  if (T.isTrigger(e)) {
    if (e.pending) return 'starting: ' + T.factsLine(e.pending.facts);
    if (!runner) return 'waits for it -- but no runner is running, so nothing ' + (T.watchesFolder(e) ? 'watches the folder' : 'hears it');
    if (T.needsListener(e) && !runner.listen) return 'waits for it -- but the runner is not listening yet';
    return 'waits for it';
  }
  if (e.done || e.next == null) return 'done';
  if (e.next <= now) return 'due since ' + fmtWhen(e.next, zone) + (runner ? '' : ' -- with no runner running it will be skipped as missed');
  return fmtWhen(e.next, zone) + ' (in ' + fmtSpan(e.next - now) + ')';
}
function list(o, pos, ctx) {
  if (pos.length) { console.error('[x] list takes no words\n' + USAGE); return 2; }
  const st = readState(ctx.paths), now = ctx.now(), rn = runnerOf(ctx.paths), heard = (st.hook && st.hook.heard) || null;
  if (o.json) {   // never the token: `hook` alone prints it
    console.log(JSON.stringify({ now, runner: rn || null, heard, entries: st.entries.map((e) => Object.assign({}, e, { when: describeEntry(e, ctx.zone), state: stateOf(e, now, rn, ctx.zone) })) }, null, 1));
    return 0;
  }
  console.log('schedule: ' + ctx.paths.state);
  console.log('runner:   ' + (rn ? 'running (pid ' + rn.pid + (rn.on && rn.on !== os.hostname() ? ' on ' + rn.on : '') + ', since ' + fmtWhen(rn.since, ctx.zone) + ')' +
                                   (rn.listen ? ', listening on ' + rn.listen : '') + (rn.refused ? ' -- refused ' + rn.refused + ' request(s) without the token' : '')
                                 : 'not running -- nothing starts until one does: node drive/schedule.js run'));
  if (st.entries.some(T.needsListener) || heard) {
    console.log('hook:     ' + (heard ? 'the relay last reached it ' + fmtWhen(heard.at, ctx.zone) + ' (' + heard.event + '), ' + heard.n + ' message(s) in all' : 'the relay has not reached it yet') +
                ' -- node drive/schedule.js hook prints its address');
  }
  if (!st.entries.length) { console.log('\nnothing is scheduled. Add a job: node drive/schedule.js add --host <number> --recipe skills/<name>/replay.json --at 09:00'); return 0; }
  for (const e of st.entries) {
    const tr = T.isTrigger(e);
    console.log('\n#' + e.id + '  ' + e.name + (e.host ? '  machine ' + (e.host === T.FROM_ALERT ? 'from the alert' : e.host) : '') + '  ' + (e.recipe ? 'recipe ' + e.recipe : 'command ' + JSON.stringify(e.cmd)));
    console.log('    when: ' + describeEntry(e, ctx.zone) + '   next: ' + stateOf(e, now, rn, ctx.zone));
    if (tr) console.log('    last fired: ' + (e.fired ? fmtWhen(e.fired.at, ctx.zone) + ' -- ' + e.fired.on : 'never') + '   (debounce ' + fmtSpan(e.debounce != null ? e.debounce : T.DEBOUNCE_MS) + ')');
    const l = e.last;
    if (l) console.log('    last: ' + l.result + ', ' + fmtWhen(l.start != null ? l.start : l.fire, ctx.zone) + (l.end && l.start ? ' (' + fmtSpan(l.end - l.start) + ')' : '') +
                       (l.why ? ' -- ' + l.why : '') + (l.dir ? '  [' + l.dir + ']' : ''));
    const skips = [];
    if (e.missed && e.missed.n) skips.push('missed ' + e.missed.n + ' while no runner was running (the last ' + fmtWhen(e.missed.last, ctx.zone) + ')');
    if (e.bursts && e.bursts.n) skips.push('counted ' + e.bursts.n + ' in a burst (the last ' + fmtWhen(e.bursts.last, ctx.zone) + ')');
    if (e.overlapped && e.overlapped.n) skips.push('skipped ' + e.overlapped.n + ' while its run was still going (the last ' + fmtWhen(e.overlapped.last, ctx.zone) + ')');
    if (skips.length) console.log('    ' + skips.join('; '));
  }
  return 0;
}
function remove(o, pos, ctx) {
  const id = String(pos[0] || '').replace(/^#/, '');
  if (!id || pos.length > 1) { console.error('[x] which one? node drive/schedule.js remove <id>   (the ids are in: node drive/schedule.js list)'); return 2; }
  const gone = withState(ctx.paths, (st) => { const i = st.entries.findIndex((e) => e.id === id); return i >= 0 ? st.entries.splice(i, 1)[0] : null; });
  if (!gone) { console.error('[x] no entry #' + id + ' -- node drive/schedule.js list shows them'); return 2; }
  console.log('[+] removed #' + id + ' "' + gone.name + '"' + (gone.running && !gone.running.queued ? ' -- its run in progress finishes; it will not run again' : ''));
  return 0;
}
function next(o, pos, ctx) {
  if (pos.length) { console.error('[x] next takes no words\n' + USAGE); return 2; }
  const n = o.n == null ? 5 : Number(o.n);
  if (!Number.isInteger(n) || n < 1 || n > 1000) { console.error('[x] --n is how many, 1 to 1000'); return 2; }
  const st = readState(ctx.paths), now = ctx.now(), fires = upcoming(st.entries, now, n, ctx.zone), ev = st.entries.filter(T.isTrigger).length;
  if (o.json) { console.log(JSON.stringify(fires.map((f) => Object.assign({ text: fmtWhen(f.at, ctx.zone) }, f)), null, 1)); return 0; }
  const more = ev ? ev + ' entr' + (ev === 1 ? 'y starts' : 'ies start') + ' on an event, not a clock: node drive/schedule.js list shows ' + (ev === 1 ? 'it' : 'them') : '';
  if (!fires.length) { console.log(ev ? 'nothing on the clock; ' + more : st.entries.length ? 'nothing is going to run: every entry is done' : 'nothing is scheduled'); return 0; }
  for (const f of fires) console.log(fmtWhen(f.at, ctx.zone) + '  (in ' + fmtSpan(f.at - now) + ')  #' + f.id + ' ' + f.name + (f.host ? '  machine ' + f.host : ''));
  if (more) console.log('(and ' + more + ')');
  return 0;
}
// The addresses the relay and a caller use: the relay's webhook, and each --on http entry's call. Makes the token on
// first use; --new-token replaces it (every old address stops working at once).
function hook(o, pos, ctx) {
  if (pos.length) { console.error('[x] hook takes no words\n' + USAGE); return 2; }
  const now = ctx.now(), fresh = !!o['new-token'];
  const st = withState(ctx.paths, (s) => {
    if (fresh && s.hook) delete s.hook.token;
    ensureToken(s, now);
    return JSON.parse(JSON.stringify(s));
  });
  const rn = runnerOf(ctx.paths), token = st.hook.token, at = listenAt(ctx, rn);
  const port = at.slice(at.lastIndexOf(':') + 1), host = at.slice(0, at.lastIndexOf(':')).replace(/^\[|\]$/g, '');
  const wild = host === '0.0.0.0' || host === '::';
  const base = 'http://' + (wild ? '<this machine\'s address>:' + port : at);
  const calls = st.entries.filter((e) => T.isTrigger(e) && e.spec.event === 'http');
  const heard = st.hook.heard || null;
  if (o.json) {
    console.log(JSON.stringify({ hook: base + '/hook/' + token, calls: calls.map((e) => ({ id: e.id, name: e.name, url: base + '/run/' + e.id + '/' + token })),
                                 listen: at, runner: rn ? { pid: rn.pid, listen: rn.listen || null, refused: rn.refused || 0 } : null, heard, made: st.hook.made }, null, 1));
    return 0;
  }
  if (fresh) console.log('[+] a new token: every old address stops working at once (a running runner takes the new one within a second) -- paste the new one into the relay');
  console.log('[+] the relay\'s webhook -- in its console: Health -> settings -> "Send alerts to" -> "a webhook (JSON POST)":');
  console.log('    ' + base + '/hook/' + token);
  for (const e of calls) console.log('[+] #' + e.id + ' "' + e.name + '" starts on a call:  curl -X POST ' + base + '/run/' + e.id + '/' + token);
  if (T.loopback(host)) {
    console.log('[!] The relay reaches this address only if it runs on this machine: ' + at + ' is this machine alone -- the safe default.');
    console.log('    A relay elsewhere needs the runner to listen on an address it can reach, and binding wider is your explicit choice:');
    console.log('      node drive/schedule.js run --listen <an address of this machine>:' + port + '    (0.0.0.0:' + port + ': all of them)');
    console.log('    -- then paste the address hook prints with that same --listen.');
  } else console.log('[!] ' + at + ' can be reached from other machines -- by the relay too, if its network reaches this one.');
  console.log('    Whoever reaches the listener with this address can start these jobs: the token in it is the only lock (the relay\'s');
  console.log('    webhook carries no signature), and plain http carries it in clear -- across a network you do not trust, put a TLS');
  console.log('    proxy or a tunnel in front. Anyone who can read the relay\'s Health settings sees it too. Replace it: hook --new-token');
  if (wild) {
    const mine = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (!a.internal && a.family === 'IPv4') mine.push(a.address);
    console.log('    This machine\'s addresses: ' + (mine.join(', ') || 'none found'));
  }
  console.log(rn ? '[.] the runner (pid ' + rn.pid + ') ' + (rn.listen ? 'listens on ' + rn.listen : 'is not listening: it listens once an entry waits for an alert or a call, or with --listen') +
                   (rn.refused ? ' -- it refused ' + rn.refused + ' request(s) without the token' : '')
                 : '[.] no runner is running, so nothing hears it yet: node drive/schedule.js run' + (o.listen != null ? ' --listen ' + o.listen : ''));
  console.log(heard ? '[.] the relay last reached it ' + fmtWhen(heard.at, ctx.zone) + ' (' + heard.event + '), ' + heard.n + ' message(s) in all'
                    : '[.] the relay has not reached it yet -- the Test button beside the webhook setting proves the way: schedule.log then says "hook  test"');
  return 0;
}
// Stop a runner: nothing new starts, every run in progress is ended ("interrupted", its processes with it), and the
// runner returns once they have
function stopRunner(rt) {
  rt.stopping = true;
  if (rt.closeTriggers) rt.closeTriggers();   // no new event is taken while the runs end
  for (const j of rt.active.values()) j.ac.abort('stopped');
  if (rt.wake) rt.wake();
}
async function runCmd(o, pos, ctx) {
  if (pos.length) { console.error('[x] run takes no words\n' + USAGE); return 2; }
  const rt = newRuntime();
  const stop = () => {
    if (rt.stopping) { console.log('[.] stopping now'); process.exit(130); }
    console.log('[.] stopping: ' + (rt.active.size ? 'ending ' + rt.active.size + ' run(s) -- Ctrl+C again to leave at once' : 'nothing is running'));
    stopRunner(rt);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', () => { for (const p of LIVE) stopProc(p); });   // a runner that dies takes its jobs' processes with it
  return runner(ctx, { once: !!o.once, rt });
}

async function main(argv, env) {
  const sub = argv[0];
  if (!FLAGS[sub]) { console.error(USAGE); return 2; }
  const a = parseArgs(argv.slice(1), FLAGS[sub].values, FLAGS[sub].switches);
  if (a.why) { console.error('[x] ' + a.why + '\n' + USAGE); return 2; }
  let ctx;
  try { ctx = contextOf(a.opts, env || process.env); } catch (e) { console.error('[x] ' + e.message); return 2; }
  try {
    if (sub === 'add') return add(a.opts, a.pos, ctx);
    if (sub === 'list') return list(a.opts, a.pos, ctx);
    if (sub === 'remove') return remove(a.opts, a.pos, ctx);
    if (sub === 'next') return next(a.opts, a.pos, ctx);
    if (sub === 'hook') return hook(a.opts, a.pos, ctx);
    return await runCmd(a.opts, a.pos, ctx);
  } catch (e) { console.error('[x] ' + ((e && e.message) || e)); return 1; }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code));

module.exports = { parseSpec, nextFire, due, upcoming, describe, wallOf, instantOf, LOCAL, fixedZone, GRACE_MS,
                   pathsOf, readState, newRuntime, tick, runner, stopRunner, launchJob, main,
                   offerEvent, scanFolders, onHook, onCall, defaultTask, takesValues };

// triggers.js — drive/schedule.js's TRIGGERED runs (drive/triggers.js): a job that starts when something happens.
// The pure parts first: --on read and refused; the relay's webhook messages as it really sends them (alert-open and
// alert-close with the rule in incident.rule, a site's machines, a person's Resolve, a quiet-hours summary opened up);
// which entries an event starts, and which it counts as a burst or skips; when a new file is whole. Then the listener
// on 127.0.0.1 with a random port -- a wrong token is a 404 and a count -- and a whole runner in-process with a clock
// and a launcher handed in: a relay alert starts its jobs with their facts, a burst starts one, one visit per machine,
// a direct call, a file landing in a temp folder (once). A recipe's run gets the facts as --set on its replay line.
// Then the command line in child processes: add --on, hook, list, next, run --once finding a file, and a runner
// hearing a fake POST, with a fake launcher (SM_SCHEDULE_LAUNCHER).
//   node tests/triggers.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn, spawnSync } = require('child_process');
const SCHEDULE = path.join(__dirname, '..', 'drive', 'schedule.js');
const S = require(SCHEDULE);
const T = require(path.join(__dirname, '..', 'drive', 'triggers.js'));
const node = process.execPath;
// the folder's real path: a CI runner's TEMP may be a short 8.3 name, and the paths handed to a job are the long ones
const tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'triggers-'));
const MIN = 60000;
const T0 = Date.UTC(2026, 10, 6, 14, 0);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const q = (p) => '"' + p + '"';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t = Date.now(); for (;;) { const v = fn(); if (v || Date.now() - t > (ms || 8000)) return v; await sleep(25); } }
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } };
// an HTTP request as the relay makes one: a JSON POST, User-Agent ScreenMirror-relay -> {status, json}
function request(port, method, p, body, raw) {
  return new Promise((resolve) => {
    const data = body == null ? null : Buffer.from(raw ? String(body) : JSON.stringify(body));
    const headers = { 'User-Agent': 'ScreenMirror-relay' };
    if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': data.length });
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (_) {} resolve({ status: res.statusCode, json: j, text: t }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    req.end(data || undefined);
  });
}
// the relay's webhook messages, as it builds them: {event, relay, at, machine (its NAME for the machine), incident}
const incident = (o) => Object.assign({ id: 'k1abc', rule: 'offline', host: '10004', hostName: 'Front desk', hosts: null, sev: 'bad',
  title: 'Front desk is offline', text: 'No connection for 10+ minutes since 13:50.', opened: T0, closed: 0, closeWhy: '', last: T0, count: 1,
  ackBy: '', ackAt: 0, assignee: '', assignBy: '', resolvedBy: '', resolvedAt: 0, top: '', what: 'Offline for 10+ minutes', notes: [], manual: false, still: '' }, o || {});
const message = (event, inc) => ({ event, relay: 'https://relay.example.com', at: T0 + 1000,
  machine: inc.hostName || (inc.host ? 'Host ' + inc.host : 'Fleet'), incident: inc });
const opened = (o) => message('alert-open', incident(o));
const closed = (o) => message('alert-close', incident(Object.assign({ closed: T0 + 20 * MIN, closeWhy: 'back online after 20 minutes' }, o)));

// ---- what an entry waits for ---------------------------------------------------------------------------------------
const P = (a) => S.parseSpec(a);
const why = (a) => { const x = P(a); return x.ok ? '' : x.why; };
let r = P({ on: 'alert-offline', machine: '10004' });
ok(r.ok && r.spec.kind === 'on' && r.spec.event === 'alert-offline' && r.spec.machine === '10004', '--on alert-offline --machine 10004');
ok(P({ on: 'ALERT-*' }).spec.event === 'alert-*' && P({ on: 'alert' }).spec.event === 'alert-*', 'alert-* (or alert) is any rule, in any case');
ok(P({ on: 'recovered-disk' }).spec.event === 'recovered-disk' && P({ on: 'resolved-*' }).spec.event === 'resolved-*', 'recovered-<rule>, resolved-*');
ok(['digest', 'monthly-report', 'test', 'http'].every((w) => P({ on: w }).spec.event === w), 'the relay\'s reports, its Test button, a direct call');
r = P({ on: 'file:' + path.join(tmp, 'in'), match: '*.csv' });
ok(r.ok && r.spec.event === 'file' && r.spec.folder === path.join(tmp, 'in') && r.spec.match === '*.csv', '--on file:<folder> --match *.csv');
ok(P({ on: 'file:"' + path.join(tmp, 'a b') + '"' }).spec.folder === path.join(tmp, 'a b') && path.isAbsolute(P({ on: 'file:inbox' }).spec.folder),
   '...the folder unquoted, and made absolute');
ok(P({ on: 'alert-offline', machine: 'Front desk' }).spec.machine === 'Front desk', '--machine by the relay\'s name for it');
ok(P({ on: 'alert-*', machine: '10001, 10002,10001' }).spec.machine === '10001,10002' && /a list of them/.test(why({ on: 'alert-*', machine: '10001,Front desk' })),
   '--machine 10001,10002: a list of machine numbers (and only numbers)');
ok(/not a rule the relay alerts on: offline, site, blind/.test(why({ on: 'alert-ofline' })), 'a rule the relay does not have (a typo) is refused, with the list');
ok(/--on is what starts it/.test(why({ on: 'constructor' })) && /not a rule/.test(why({ on: 'alert-constructor' })) && /--on is what starts it/.test(why({ on: '__proto__' })),
   'a name every object has is no event and no rule');
ok(/--on is what starts it/.test(why({ on: 'reboot' })), 'an event that is none of them');
ok(/names no machine/.test(why({ on: 'file:x', machine: '10004' })) && /about no machine/.test(why({ on: 'alert-relay', machine: '10004' })), '--machine with a file, or with an alert about no machine');
ok(/five-digit/.test(why({ on: 'alert-offline', machine: '1004' })), 'a machine number that is not five digits');
ok(/--match goes with --on file/.test(why({ on: 'alert-offline', match: '*.csv' })) && /not a path/.test(why({ on: 'file:x', match: 'a/b.csv' })), '--match: with a folder, a name pattern');
ok(/one of --at, --every, --once and --on/.test(why({ at: '09:00', on: 'http' })) && /--machine goes with --on/.test(why({ at: '09:00', machine: '10004' })), 'a clock and an event at once; --machine without --on');
ok(/names the folder/.test(why({ on: 'file:' })), 'file: and no folder');
r = S.parseSpec(['--host', '10004', '--on', 'alert-disk', '--machine=10004']);
ok(r.ok && r.spec.event === 'alert-disk' && r.spec.machine === '10004', 'the words of a command line work too');
ok(S.describe(P({ on: 'alert-offline', machine: '10004' }).spec) === 'when the relay alerts "offline" for machine 10004' &&
   S.describe(P({ on: 'alert-*', machine: '10001,10002' }).spec) === 'when the relay alerts (any rule) for machines 10001, 10002' &&
   S.describe(P({ on: 'recovered-*' }).spec) === 'when the relay says an alert is back to normal' &&
   S.describe(P({ on: 'resolved-disk', machine: 'Front desk' }).spec) === 'when a person marks the "disk" alert resolved for the machine "Front desk"' &&
   /^when a new file lands in .+ matching \*\.csv$/.test(S.describe(P({ on: 'file:in', match: '*.csv' }).spec)) && /POST \/run\/<id>\/<token>/.test(S.describe(P({ on: 'http' }).spec)),
   'each says itself in words');
ok(S.defaultTask('Open the weekly report', 'x', { kind: 'on', event: 'alert-offline' }) === 'open the weekly report (a run started by the relay\'s "offline" alert)' &&
   S.defaultTask('', 'x', { kind: 'on', event: 'file', folder: path.join(tmp, 'inbox') }) === 'run the saved job "x" (a run started by a new file in inbox)',
   'the Allow card says what started the run');

// ---- what the relay's webhook says ------------------------------------------------------------------------------------
let h = T.hookEvents(opened());
let ev = h.events[0];
ok(h.events.length === 1 && ev.event === 'alert-offline' && ev.on === 'alert' && ev.rule === 'offline' && ev.machine === '10004' && ev.name === 'Front desk' &&
   ev.machines.join() === '10004' && ev.incident === 'k1abc' && ev.at === T0 + 1000, 'alert-open with incident.rule offline -> alert-offline, its number from incident.host, its name');
ev = T.hookEvents(closed()).events[0];
ok(ev.event === 'recovered-offline' && ev.why === 'back online after 20 minutes' && ev.closed === T0 + 20 * MIN, 'alert-close of a condition that ended -> recovered-offline');
ev = T.hookEvents(closed({ manual: true, resolvedBy: 'alice', still: 'Front desk is still offline', closeWhy: 'marked resolved by alice' })).events[0];
ok(ev.event === 'resolved-offline' && ev.still === 'Front desk is still offline', 'alert-close by a person pressing Resolve -> resolved-offline (not a recovery), with what still holds');
ev = T.hookEvents(opened({ rule: 'site', host: '', hostName: '', hosts: ['10001', '10002', 'x'], title: '2 machines at one site are offline' })).events[0];
ok(ev.event === 'alert-site' && ev.machine === '' && ev.machines.join() === '10001,10002' && ev.name === '', 'a site alert: no single machine, its machines\' numbers (and no names)');
ev = T.hookEvents(opened({ rule: 'relay', host: '', hostName: '', title: 'Relay down: relay2.example.com' })).events[0];
ok(ev.event === 'alert-relay' && ev.machine === '' && !ev.machines.length && ev.name === '', 'a relay alert is about no machine ("Fleet")');
h = T.hookEvents({ event: 'alert-summary', relay: 'https://relay.example.com', at: T0 + 9 * 3600e3, held: [
  opened({ id: 'k2', host: '10005', hostName: 'Back office' }), closed({ id: 'k2', host: '10005', hostName: 'Back office' }), opened({ id: 'k3', rule: 'disk' }), { event: 'digest' }] });
ok(h.held === 3 && h.events.map((e) => e.event + ':' + e.incident).join() === 'recovered-offline:k2,alert-disk:k3',
   'a quiet-hours summary is opened up -- but an alert-open whose condition ended in it too is over, and dropped');
h = T.hookEvents({ event: 'alert-summary', relay: 'r', at: T0, held: [opened({ id: 'k4' }), closed({ id: 'k4', manual: true, still: 'Front desk is still offline' })] });
ok(h.events.map((e) => e.event).join() === 'alert-offline,resolved-offline', '...not one a person marked resolved: that may still hold, so its alert stays');
ok(!T.hookEvents({ event: '__proto__' }).events.length && !T.hookEvents({ event: 'constructor' }).events.length, 'a message named after what every object has is none');
ok(T.hookEvents({ event: 'digest', relay: 'r', at: 5, availability: 99.1, lines: [] }).events[0].event === 'digest' &&
   T.hookEvents({ event: 'monthly-report', relay: 'r', month: '2026-10', availability: 98, machines: [] }).events[0].month === '2026-10' &&
   T.hookEvents({ event: 'test', relay: 'r', at: 5, by: 'alice' }).events[0].by === 'alice', 'digest, monthly-report and test are events of their own');
ok(/no event/.test(T.hookEvents({}).why) && /does not know: "alert-maybe"/.test(T.hookEvents({ event: 'alert-maybe' }).why) && /no rule/.test(T.hookEvents(opened({ rule: '../x' })).why) &&
   !T.hookEvents([]).events.length && !T.hookEvents('alert-open').events.length, 'what is not a relay message starts nothing, and says why');
ev = T.hookEvents(opened({ host: '10004; rm -rf /', hostName: 'x\n\u0007y' })).events[0];
ok(ev.machine === '' && ev.name === '', 'a machine "number" that is not one is no machine');

// ---- which entries an event starts ------------------------------------------------------------------------------------
const on = (event, extra) => Object.assign({ kind: 'on', event }, extra || {});
const ents = [
  { id: '1', spec: on('alert-offline', { machine: '10004' }) }, { id: '2', spec: on('alert-*') }, { id: '3', spec: on('recovered-offline') },
  { id: '4', spec: on('alert-offline', { machine: 'front DESK' }) }, { id: '5', spec: on('alert-*'), host: 'from-alert' },
  { id: '6', spec: on('alert-site', { machine: '10002' }), host: 'from-alert' }, { id: '7', spec: on('resolved-*') },
  { id: '8', spec: on('http') }, { id: '9', spec: on('digest') }, { id: '10', spec: { kind: 'at', time: '09:00' } },
];
const who = (e) => ents.filter((x) => T.matches(x, e)).map((x) => x.id).join();
const E = (msg) => T.hookEvents(msg).events[0];
ok(who(E(opened())) === '1,2,4,5', 'offline on 10004 ("Front desk"): by number, any alert, by name (any case), and from-alert');
ok(who(E(opened({ host: '10005', hostName: 'Back office' }))) === '2,5', '...on another machine: only the ones for any machine');
ok(who(E(closed())) === '3' && who(E(closed({ manual: true }))) === '7', 'back to normal and marked resolved are events of their own');
ok(who(E(opened({ rule: 'site', host: '', hostName: '', hosts: ['10001', '10002'] }))) === '2,6', 'a site alert matches a machine number it lists; from-alert needs one machine');
ok(who(E(opened({ rule: 'relay', host: '', hostName: '' }))) === '2', 'a relay alert starts no from-alert entry: there is no machine to visit');
ok(who({ event: 'http', on: 'http', entry: '8' }) === '8' && who({ event: 'http', on: 'http', entry: '3' }) === '' && who(E({ event: 'digest', at: 1 })) === '9', 'a call is for its own entry; a digest for who waits for one');
const pinned = [{ id: '12', spec: on('alert-*', { machine: '10001,10002' }), host: 'from-alert' }];
ok(T.matches(pinned[0], E(opened({ host: '10002', hostName: 'B' }))) && !T.matches(pinned[0], E(opened({ host: '10005', hostName: 'X' }))) &&
   T.machineOf(pinned[0].spec, E(opened({ rule: 'site', host: '', hostName: '', hosts: ['10009', '10002'] }))) === '10002',
   '--machine 10001,10002 with from-alert: only those machines -- an alert naming another starts nothing; a site alert visits the listed one');

const offline = E(opened());
const one = (o) => [Object.assign({ id: '1', spec: on('alert-offline'), host: '10004', debounce: MIN }, o)];
const NOW = T0 + 5000;
let d = T.offer(one(), offline, NOW);
ok(d.length === 1 && d[0].act === 'start' && d[0].host === '10004' && d[0].facts.event === 'alert-offline' && d[0].facts.machine === '10004' &&
   d[0].facts.name === 'Front desk' && d[0].facts.incident === 'k1abc', 'idle: it starts, with the event\'s facts');
ok(T.offer(one({ fired: { at: NOW - 10000 } }), offline, NOW)[0].act === 'burst', 'the same event 10 s after the run it started: a burst -- counted, not started');
ok(T.offer(one({ pending: { fire: NOW - 5 } }), offline, NOW)[0].act === 'burst', '...or before that run has even started');
ok(T.offer(one({ fired: { at: NOW - 2 * MIN }, running: { since: NOW - 2 * MIN } }), offline, NOW)[0].act === 'busy', 'after the window, its run still going: skipped -- never two runs of one entry');
ok(T.offer(one({ fired: { at: NOW - 2 * MIN } }), offline, NOW)[0].act === 'start', 'after the window, idle: it starts again');
ok(T.offer(one({ debounce: 0, fired: { at: NOW - 1 } }), offline, NOW)[0].act === 'start', '--debounce 0: no window');
d = T.offer(one().concat([{ id: '2', spec: { kind: 'at', time: '09:00' }, host: '10004', running: { since: NOW - 1000 } }]), offline, NOW);
ok(d.length === 1 && d[0].act === 'queue', 'its machine busy with another entry\'s run: it waits for it');
d = T.offer([{ id: '5', spec: on('alert-*'), host: 'from-alert' }], E(opened({ host: '10003', hostName: 'Lab' })), NOW);
ok(d[0].act === 'start' && d[0].host === '10003' && d[0].facts.machine === '10003', 'from-alert: its run visits the machine the alert names');
d = T.offer([{ id: '6', spec: on('alert-site', { machine: '10002' }), host: 'from-alert' }], E(opened({ rule: 'site', host: '', hostName: '', hosts: ['10001', '10002'] })), NOW);
ok(d[0].host === '10002' && d[0].facts.machine === '10002' && !d[0].facts.name, '...a site alert\'s run visits the machine its --machine named');
ok(T.offer(ents.concat([{ id: '11', spec: on('http') }]), { event: 'http', on: 'http', entry: '11' }, NOW, { only: '11' }).map((x) => x.id).join() === '11', 'only: the one entry it is for');
d = S.due([{ id: '1', host: '10004', spec: { kind: 'at', time: '09:00' }, next: T0 }], T0 + 1000, { zone: () => 0, busy: ['10004'] });
ok(d.length === 1 && d[0].act === 'queue', 'one visit per machine counts the runs the runner has going, even one whose entry was removed meanwhile');
ok(T.setArgs({ event: 'alert-offline', machine: '10004', name: 'Front desk', rule: 'offline' }).join(' ') === '--set event=alert-offline --set machine=10004' &&
   T.setArgs({ event: 'file', file: 'C:\\in\\a b; del x.csv' }).join('|') === '--set|event=file|--set|file=C:\\in\\a b; del x.csv' && !T.setArgs(null).length,
   'a recipe gets --set name=value, each one argument (a file name with spaces and a ";" is one value)');
const env0 = T.envOf(null), env1 = T.envOf({ event: 'alert-offline', machine: '10004', name: 'x" & calc & "' });
ok(env0.SM_EVENT === '' && env0.SM_MACHINE === '' && env0.SM_FILE === '' && env1.SM_EVENT === 'alert-offline' && env1.SM_MACHINE === '10004' && !('SM_MACHINE_NAME' in env1),
   'a command gets SM_EVENT, SM_MACHINE, SM_FILE -- each set, empty when there is none; never the name a machine gave itself');
ok(T.bareFileVar('type %SM_FILE%') === '%SM_FILE%' && T.bareFileVar('node a.js "x" !sm_file!') === '!sm_file!' && T.bareFileVar('type "%SM_FILE%"') === null &&
   T.bareFileVar('node imp.js --in "C:\\in\\%SM_FILE%"') === null && T.bareFileVar('node imp.js') === null, 'where a command line would let cmd.exe read a file\'s name: %SM_FILE% outside double quotes');

// ---- a file landing in a folder ---------------------------------------------------------------------------------------
const F = (name, size, mt, id) => ({ name, size, mt: String(mt), ms: mt, id: String(id) });
let w = { seen: T.snapshot([F('old.csv', 10, 1, 1)]), cand: {} };
let s = T.scanFiles(w, [F('old.csv', 10, 1, 1), F('new.csv', 5, 2, 2)], 1000, 2000);
ok(!s.ready.length && s.cand['new.csv'] && !s.cand['old.csv'], 'a file there when it was added is not new; a new one is watched, not offered at first sight');
s = T.scanFiles(s, [F('old.csv', 10, 1, 1), F('new.csv', 9, 3, 2)], 2500, 2000);
ok(!s.ready.length && s.cand['new.csv'].since === 2500, '...it grew: still being written, its clock starts again');
s = T.scanFiles(s, [F('old.csv', 10, 1, 1), F('new.csv', 9, 3, 2)], 4000, 2000);
ok(!s.ready.length, '...1.5 s unchanged: not yet');
s = T.scanFiles(s, [F('old.csv', 10, 1, 1), F('new.csv', 9, 3, 2)], 4600, 2000);
ok(s.ready.map((f) => f.name).join() === 'new.csv' && s.seen['new.csv'] && s.changed, '...2 s unchanged: offered, and written down as had');
s = T.scanFiles(s, [F('old.csv', 10, 1, 1), F('new.csv', 9, 3, 2)], 9000, 2000);
ok(!s.ready.length && !Object.keys(s.cand).length && !s.changed, 'never the same file twice');
s = T.scanFiles(s, [F('old.csv', 99, 50, 1), F('new.csv', 9, 3, 2)], 9500, 2000);
ok(!s.ready.length && !s.cand['old.csv'], 'a file changed in place is the same file');
s = T.scanFiles(s, [F('new.csv', 9, 3, 2)], 10000, 2000, MIN);
ok(s.seen['old.csv'] && s.missing['old.csv'] === 10000 && s.changed, 'a file gone from the folder is not forgotten at once -- one empty look at a folder that hiccupped forgets nothing...');
s = T.scanFiles(s, [F('old.csv', 99, 50, 1), F('new.csv', 9, 3, 2)], 10500, 2000, MIN);
ok(!s.cand['old.csv'] && !s.missing['old.csv'], '...back as it was, it is the same file: not offered again');
s = T.scanFiles(s, [F('new.csv', 9, 3, 2)], 11000, 2000, MIN);
s = T.scanFiles(s, [F('new.csv', 9, 3, 2)], 41000, 2000, MIN);
ok(s.seen['old.csv'] && s.missing['old.csv'] === 11000, '...nor after half the time...');
s = T.scanFiles(s, [F('new.csv', 9, 3, 2)], 11000 + MIN, 2000, MIN);
ok(!s.seen['old.csv'] && !s.missing['old.csv'], '...gone for a while (FORGET_MS), it is forgotten...');
s = T.scanFiles(s, [F('old.csv', 99, 50, 1), F('new.csv', 9, 3, 2)], 72000, 2000, MIN);
s = T.scanFiles(s, [F('old.csv', 99, 50, 1), F('new.csv', 9, 3, 2)], 74100, 2000, MIN);
ok(s.ready.map((f) => f.name).join() === 'old.csv', '...so a file under its name later is a new one');
s = T.scanFiles(s, [F('old.csv', 99, 50, 1), F('new.csv', 20, 70, 8)], 75000, 2000, MIN);
ok(!s.seen['new.csv'] && s.cand['new.csv'], 'a file replaced under the same name between two looks (a new id, a new size): new');
s = T.scanFiles(s, [F('old.csv', 99, 50, 1), F('new.csv', 20, 70, 9)], 75500, 2000, MIN);
s = T.scanFiles(s, [F('old.csv', 99, 50, 33), F('new.csv', 20, 70, 10)], 77100, 2000, MIN);
ok(s.ready.map((f) => f.name).join() === 'new.csv' && !s.cand['old.csv'],
   'a network folder whose ids wander: a file is whole by its size and time alone, and a known one is still the same file');
s = T.scanFiles(s, [{ name: 'old.csv', unread: true }, F('new.csv', 20, 70, 10)], 999999, 2000, MIN);
ok(s.seen['old.csv'] && !s.missing['old.csv'] && !s.cand['old.csv'], 'a file there that could not be looked at just now is neither new nor gone');
s = T.scanFiles({ seen: T.snapshot([{ name: 'locked.csv', unread: true }]) }, [F('locked.csv', 5, 9, 3)], 0, 0);
s = T.scanFiles(s, [F('locked.csv', 5, 9, 3)], 10, 0);
ok(!s.ready.length, '...and one that was there, unreadable, when the entry was added is never new');
s = T.scanFiles({ seen: {}, cand: {} }, [{ name: 'busy.csv', unread: true }], 0, 100);
s = T.scanFiles(s, [{ name: 'busy.csv', unread: true }], 500, 100);
ok(!s.ready.length && !s.cand['busy.csv'], 'a new file that cannot be looked at yet waits -- it is not offered unseen');
s = T.scanFiles({ seen: {}, cand: {} }, [F('b.csv', 1, 20, 1), F('a.csv', 1, 10, 2)], 0, 100);
s = T.scanFiles(s, [F('b.csv', 1, 20, 1), F('a.csv', 1, 10, 2)], 200, 100);
ok(s.ready.map((f) => f.name).join() === 'a.csv,b.csv', 'files whole at once are offered oldest first');
const re = T.globRe('*.csv');
ok(re.test('Report.CSV') && !re.test('a.csv.tmp') && !re.test('a.csvx') && T.globRe('rep?rt (1).txt').test('report (1).txt') && T.globRe('').test('anything'), '--match: * and ?, case ignored, the rest literal');
ok(['~$book.xlsx', '.hidden', 'x.crdownload', 'y.part', 'z.tmp', 'w.partial'].every((n) => T.SCRATCH.test(n)) && !T.SCRATCH.test('a.csv'), 'a download\'s or an editor\'s scratch is never a job\'s file');
const INB = path.join(tmp, 'inbox-list');
fs.mkdirSync(path.join(INB, 'sub.csv'), { recursive: true });
for (const n of ['a.csv', 'b.txt', '~$lock.csv', 'c.csv.part']) fs.writeFileSync(path.join(INB, n), 'x');
const lf = T.listFolder(INB, T.globRe('*.csv'));
ok(lf.map((f) => f.name).join() === 'a.csv' && lf[0].size === 1 && lf[0].id && lf[0].mt, 'listFolder: the matching files only -- not a folder, not scratch -- each with its size, time and id');

// ---- the listener, alone ----------------------------------------------------------------------------------------------
const TOKEN = T.makeToken();
ok(/^[A-Za-z0-9_-]{32}$/.test(TOKEN) && T.makeToken() !== TOKEN, 'a token: 192 random bits, URL-safe');
ok(T.tokenOk(TOKEN, TOKEN) && !T.tokenOk(TOKEN.slice(0, -1) + (TOKEN.endsWith('A') ? 'B' : 'A'), TOKEN) && !T.tokenOk('', TOKEN) && !T.tokenOk(TOKEN, ''), 'compared whole (and in constant time)');
ok(T.route('/hook/' + TOKEN).kind === 'hook' && T.route('/run/12/' + TOKEN + '?x=1').id === '12' && !T.route('/hook/short') && !T.route('/run/x/' + TOKEN) && !T.route('/'), 'the two addresses it serves');
ok(T.parseListen('8754').host === '127.0.0.1' && T.parseListen('0.0.0.0:9000').port === 9000 && T.parseListen('[::1]:0').host === '::1' && !T.parseListen('123456') && !T.parseListen('a:b'),
   '--listen: a port, or an address and a port (127.0.0.1 unless said)');
ok(T.loopback('127.0.0.1') && T.loopback('::1') && T.loopback('localhost') && !T.loopback('0.0.0.0') && !T.loopback('203.0.113.5'), 'which addresses are this machine alone');
ok(T.parseSpan('0') === 0 && T.parseSpan('30s') === 30000 && T.parseSpan('2m') === 120000 && T.parseSpan('1 hour') === 3600000 && T.parseSpan('500ms') === 500 && T.parseSpan('5') === null && T.parseSpan('5 parsecs') === null,
   '--debounce: 0, 30s, 2m, 1 hour, 500ms');

(async () => {
  const got = { hook: [], run: [], refused: 0 };
  const srv = T.listener({ token: () => TOKEN, refused: () => { got.refused++; },
    hook: (b) => { got.hook.push(b); return { status: 200, json: { ok: true, got: b.event } }; },
    run: (id) => { got.run.push(id); return { status: 202, json: { ok: true, id } }; } });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  let x = await request(port, 'POST', '/hook/' + TOKEN, { event: 'test', by: 'alice' });
  ok(x.status === 200 && x.json.got === 'test' && got.hook.length === 1, 'listener: the relay\'s POST to /hook/<token> is taken');
  x = await request(port, 'POST', '/hook/' + T.makeToken(), opened());
  const y = await request(port, 'POST', '/run/3/' + T.makeToken());
  const z = await request(port, 'POST', '/');
  ok(x.status === 404 && y.status === 404 && z.status === 404 && got.hook.length === 1 && !got.run.length && got.refused === 3 && x.json.why === 'not found',
     'listener: a wrong token (or none) is a 404 like any unknown address -- nothing handed on, only counted');
  x = await request(port, 'POST', '/run/3/' + TOKEN);
  ok(x.status === 202 && got.run.join() === '3', 'listener: a direct call to /run/<id>/<token>');
  x = await request(port, 'GET', '/hook/' + TOKEN);
  ok(x.status === 405 && got.hook.length === 1, 'listener: it takes a POST only');
  x = await request(port, 'POST', '/hook/' + TOKEN, '{not json', true);
  ok(x.status === 400 && got.hook.length === 1, 'listener: a body that is not JSON is a 400');
  x = await request(port, 'POST', '/hook/' + TOKEN, 'x'.repeat(T.MAX_BODY + 10), true);
  ok((x.status === 413 || x.status === 0) && got.hook.length === 1, 'listener: a body over ' + T.MAX_BODY + ' bytes is refused (' + (x.status || x.error) + ')');
  await new Promise((res) => srv.close(res));
  await runnerInProcess();
  await portTaken();
  await recipeRun();
  await cliTests();
})().catch((e) => { fail++; console.error('  FAIL (exception): ' + ((e && e.stack) || e)); }).then(finishUp);

// ---- a whole runner, in-process: the listener, the folder watch, a clock and a launcher handed in ----------------------
async function runnerInProcess() {
  const W = path.join(tmp, 'w-run'), INBOX = path.join(tmp, 'inbox');
  fs.mkdirSync(W, { recursive: true });
  fs.mkdirSync(INBOX, { recursive: true });
  fs.writeFileSync(path.join(INBOX, 'before.csv'), 'there before the runner first looked');
  const t0 = Date.now();
  let skew = 0;
  const runs = [], gates = {}, out = [];
  const ctx = { paths: S.pathsOf(W), now: () => T0 + (Date.now() - t0) + skew, zone: () => 0, grace: 2 * MIN, out: (l) => out.push(l),
                listen: { host: '127.0.0.1', port: 0 }, steadyMs: 300, filePollMs: 50,
                launch: (entry, run) => new Promise((resolve) => {
                  runs.push({ id: entry.id, host: entry.host, facts: run.facts, dir: run.dir });
                  gates[entry.id] = resolve;
                  run.signal.addEventListener('abort', () => resolve({ result: 'interrupted' }));   // a stopped runner never waits on it
                }) };
  const TOK = T.makeToken();
  const st0 = { v: 1, seq: 6, hook: { token: TOK, made: T0 }, entries: [
    { id: '1', name: 'on offline', host: '10004', cmd: 'x', spec: on('alert-offline', { machine: '10004' }), debounce: MIN, next: null, runs: 0 },
    { id: '2', name: 'any alert', host: 'from-alert', cmd: 'x', spec: on('alert-*'), debounce: MIN, next: null, runs: 0 },
    { id: '3', name: 'deploy', cmd: 'x', spec: on('http'), debounce: 0, next: null, runs: 0 },
    { id: '4', name: 'csv in', cmd: 'x', spec: on('file', { folder: INBOX, match: '*.csv' }), debounce: 0, next: null, runs: 0 },
    { id: '5', name: 'back', cmd: 'x', spec: on('recovered-offline'), debounce: 0, next: null, runs: 0 },
    { id: '6', name: 'clock', cmd: 'x', host: '10001', spec: { kind: 'at', time: '09:00' }, next: T0 + 19 * 3600e3, runs: 0 },
  ] };
  fs.writeFileSync(ctx.paths.state, JSON.stringify(st0));
  const state = () => S.readState(ctx.paths);
  const byId = (id) => state().entries.find((e) => e.id === id);
  const rt = S.newRuntime(), loop = S.runner(ctx, { rt });
  const at = await until(() => rt.listening);
  const port = at ? Number(at.split(':').pop()) : 0;
  ok(port > 0 && /^127\.0\.0\.1:\d+$/.test(at) && readJson(ctx.paths.runner).listen === at, 'runner: it listens (on 127.0.0.1), and its mark says where');
  const WRONG = T.makeToken();
  let x = await request(port, 'POST', '/hook/' + WRONG, opened());
  ok(x.status === 404 && rt.refused === 1 && !runs.length, 'runner: the relay\'s alert with a wrong token: a 404, a count, nothing started');
  x = await request(port, 'POST', '/hook/' + TOK, opened());
  await until(() => runs.length >= 1 && byId('2').running);
  ok(x.status === 200 && x.json.started.join() === '1,2' && runs.length === 1 && runs[0].id === '1', 'runner: the alert starts #1 (offline on 10004) and #2 (any alert)...');
  ok(runs[0].facts.event === 'alert-offline' && runs[0].facts.machine === '10004' && runs[0].facts.name === 'Front desk' && runs[0].facts.incident === 'k1abc', '...#1 handed the event\'s facts');
  const e2 = byId('2');
  ok(e2.running && e2.running.queued && e2.running.host === '10004' && e2.running.facts.machine === '10004', '...#2 (from-alert: machine 10004) waits: one visit per machine');
  const ej = readJson(path.join(runs[0].dir, 'event.json'));
  ok(ej && ej.facts.event === 'alert-offline' && ej.title === 'Front desk is offline' && ej.relay === 'https://relay.example.com', '...and the whole event is in its run\'s folder (event.json)');
  x = await request(port, 'POST', '/hook/' + TOK, opened({ id: 'k1abd' }));
  ok(x.status === 200 && !x.json.started.length && x.json.counted.join() === '1,2' && byId('1').bursts.n === 1 && byId('2').bursts.n === 1 && runs.length === 1,
     'runner: the same alert again within the debounce window: a burst -- counted for both, nothing started');
  gates['1']({ result: 'ok', why: 'done' });
  await until(() => runs.length >= 2);
  ok(runs.length === 2 && runs[1].id === '2' && runs[1].host === '10004' && runs[1].facts.machine === '10004', 'runner: #1 ended, machine 10004 is free: #2 starts there, with the alert\'s facts');
  gates['2']({ result: 'not let in', why: 'nobody pressed Allow within 170 s' });
  await until(() => byId('2').last && !byId('2').running);
  ok(byId('2').last.result === 'not let in' && !byId('2').pending && !byId('2').done && byId('2').last.on === 'alert-offline, machine 10004 (Front desk)',
     'runner: not let in -- recorded, and it waits for its next event (never retried, never done)');
  // a direct call
  x = await request(port, 'POST', '/run/3/' + TOK);
  await until(() => runs.length >= 3);
  ok(x.status === 202 && x.json.act === 'start' && runs[2].id === '3' && runs[2].facts.event === 'http', 'runner: a direct call starts #3 now (202)');
  x = await request(port, 'POST', '/run/3/' + TOK);
  ok(x.status === 409 && x.json.act === 'busy' && byId('3').overlapped.n === 1, 'runner: called again while its run goes: 409, skipped and counted');
  gates['3']({ result: 'ok' });
  await until(() => !byId('3').running);
  x = await request(port, 'POST', '/run/3/' + TOK);
  await until(() => runs.length >= 4);
  ok(x.status === 202 && runs.length === 4, 'runner: called when it is idle again (--debounce 0): it starts');
  gates['3']({ result: 'ok' });
  x = await request(port, 'POST', '/run/1/' + TOK);
  const x2 = await request(port, 'POST', '/run/99/' + TOK);
  ok(x.status === 404 && /no entry #1 starts on a call/.test(x.json.why) && x2.status === 404, 'runner: a call to an entry that does not start on one: 404');
  // back to normal, a person's Resolve, and a summary opened up
  x = await request(port, 'POST', '/hook/' + TOK, closed());
  await until(() => runs.length >= 5);
  ok(x.json.started.join() === '5' && runs[4].id === '5' && runs[4].facts.event === 'recovered-offline', 'runner: the relay saying it is back to normal starts #5');
  gates['5']({ result: 'ok' });
  await until(() => !byId('5').running);
  x = await request(port, 'POST', '/hook/' + TOK, closed({ manual: true }));
  ok(!x.json.started.length && runs.length === 5, 'runner: a person marking it resolved is no recovery: #5 waits on');
  skew += 2 * MIN;   // past #1 and #2's debounce windows
  x = await request(port, 'POST', '/hook/' + TOK, { event: 'alert-summary', relay: 'https://relay.example.com', at: T0, held: [
    opened({ id: 'k7', host: '10005', hostName: 'Back office' }), closed({ id: 'k7', host: '10005', hostName: 'Back office' })] });
  await until(() => runs.length >= 6);
  ok(x.json.events === 1 && x.json.started.join() === '5' && runs[5].facts.machine === '10005', 'runner: a summary opened up: the alert that is already over starts nothing, its recovery starts #5');
  gates['5']({ result: 'ok' });
  // a file landing in the folder
  const csv = path.join(INBOX, 'report.csv');
  fs.writeFileSync(csv, 'a,b\n');
  await sleep(120);
  fs.appendFileSync(csv, '1,2\n');   // still being written
  fs.writeFileSync(path.join(INBOX, 'notes.txt'), 'not a csv');
  fs.writeFileSync(path.join(INBOX, '~$report.csv'), 'an editor\'s lock');
  await until(() => runs.length >= 7, 4000);
  ok(runs.length === 7 && runs[6].id === '4' && runs[6].facts.event === 'file' && runs[6].facts.file === csv, 'runner: a new .csv, once whole, starts #4 with its full path');
  gates['4']({ result: 'ok' });
  await sleep(700);
  ok(runs.length === 7 && !runs.some((r) => r.facts && /before\.csv|notes\.txt|~\$/.test(r.facts.file || '')),
     'runner: never twice; not the file that was there before it looked, not a .txt, not an editor\'s lock');
  fs.writeFileSync(path.join(INBOX, 'second.csv'), 'c');
  await until(() => runs.length >= 8, 4000);
  ok(runs.length === 8 && /second\.csv$/.test(runs[7].facts.file), 'runner: the next new file starts it again');
  gates['4']({ result: 'ok' });
  const seen = readJson(path.join(W, 'schedule', '4', 'files.json'));
  ok(seen && seen.seen['report.csv'] && seen.seen['before.csv'] && seen.seen['second.csv'] && !seen.seen['notes.txt'], 'runner: what the folder entry had is in schedule/<id>/files.json');
  // stopped: the listener goes with it
  await until(() => !rt.active.size);
  S.stopRunner(rt);
  const code = await loop;
  x = await request(port, 'POST', '/hook/' + TOK, opened());
  ok(code === 0 && x.status === 0 && !fs.existsSync(ctx.paths.runner), 'runner: stopped, its listener is closed and its mark gone');
  const log = readText(ctx.paths.log);
  ok(/hook  alert-offline, machine 10004 \(Front desk\) -- started #1 #2/.test(log) && /#1 "on offline"  counted  alert-offline/.test(log) &&
     /call  #3 -- counted #3/.test(log) && /#4 "csv in"  started .*on file, .*report\.csv/.test(log), 'schedule.log: each message, each call, each start and each count');
  ok(!log.includes(WRONG) && !log.includes(TOK) && !out.join('\n').includes(WRONG) && !out.join('\n').includes(TOK), 'schedule.log says nothing of a wrong request, and never holds a token');
  ok(!byId('6').running && !byId('6').last, 'runner: the clock\'s entry was not touched by any of it');
}

// ---- a port that is taken: said once, and the runner runs on -----------------------------------------------------------
async function portTaken() {
  const blocker = http.createServer(() => {});
  await new Promise((res) => blocker.listen(0, '127.0.0.1', res));
  const W = path.join(tmp, 'w-taken'), out = [], ran = [];
  fs.mkdirSync(W, { recursive: true });
  const t0 = Date.now(), NOW = T0;
  const ctx = { paths: S.pathsOf(W), now: () => NOW + (Date.now() - t0), zone: () => 0, grace: 2 * MIN, out: (l) => out.push(l),
                listen: { host: '127.0.0.1', port: blocker.address().port }, launch: async (entry) => { ran.push(entry.id); return { result: 'ok' }; } };
  fs.writeFileSync(ctx.paths.state, JSON.stringify({ v: 1, seq: 2, entries: [
    { id: '1', name: 'deploy', cmd: 'x', spec: on('http'), debounce: 0, next: null, runs: 0 },
    { id: '2', name: 'every minute', cmd: 'x', spec: { kind: 'every', n: 1, unit: 'm', from: NOW - MIN }, next: NOW + 500, runs: 0 }] }));
  const rt = S.newRuntime(), loop = S.runner(ctx, { rt });
  await until(() => ran.includes('2') && out.some((l) => /cannot listen/.test(l)), 5000);
  ok(out.filter((l) => /cannot listen on 127\.0\.0\.1:\d+ \(EADDRINUSE\)/.test(l)).length === 1 && !rt.listening && ran.join() === '2',
     'a port that is taken: said once -- and the runner runs on: its clock\'s jobs start');
  S.stopRunner(rt);
  await loop;
  await new Promise((res) => blocker.close(res));
}

// ---- a recipe's run: the facts on its replay line, the machine from the alert -----------------------------------------
async function recipeRun() {
  const W = path.join(tmp, 'w-recipe'), dir = path.join(tmp, 'fakes');
  fs.mkdirSync(W, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const RECIPE = path.join(dir, 'restart-the-agent', 'replay.json');
  fs.mkdirSync(path.dirname(RECIPE), { recursive: true });
  fs.writeFileSync(RECIPE, JSON.stringify({ kind: 'mission-replay', v: 1, goal: 'Restart the host agent', secrets: 0, milestones: [
    { t: 'Restart it', done: 'it runs', check: { text: { has: 'Running' } }, steps: [], cmds: [{ do: 'keys', text: 'x' }] }] }));
  const CLIENT = path.join(dir, 'fake-client.js');
  fs.writeFileSync(CLIENT, [
    "// stands in for core/agent-join.js --serve: let in at once; answers each command; a 'done' ends it",
    "const fs = require('fs'), path = require('path');",
    "const argv = process.argv.slice(2), arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : ''; };",
    "const dir = arg('serve');",
    "fs.writeFileSync(path.join(dir, '_argv.json'), JSON.stringify(argv));",
    "fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ w: 800, h: 600, host: arg('host'), at: Date.now() }));",
    "setInterval(() => {",
    "  let c; try { c = JSON.parse(fs.readFileSync(path.join(dir, 'cmd.json'), 'utf8')); fs.unlinkSync(path.join(dir, 'cmd.json')); } catch (_) { return; }",
    "  fs.writeFileSync(path.join(dir, 'done.json'), JSON.stringify({ ok: true }));",
    "  if (c.do === 'done') process.exit(0);",
    "}, 8);"].join('\n'));
  const REPLAY = path.join(dir, 'fake-replay.js');
  fs.writeFileSync(REPLAY, "// takes --set name=value, as drive/replay.js does: records its whole line\n" +
                           "require('fs').writeFileSync(require('path').join(process.argv[4], '_replay.json'), JSON.stringify(process.argv.slice(2)));\n");
  const OLD = path.join(dir, 'old-replay.js');   // a drive/replay.js from before --set name=value: its usage, exit 2
  fs.writeFileSync(OLD, "console.error('usage:\\n  node drive/replay.js run <replay.json> <serve-dir> [--secret <text>]...'); process.exit(2);\n");
  const ctx = { paths: S.pathsOf(W), now: () => Date.now(), zone: () => 0, grace: 2 * MIN, out: () => {}, launch: S.launchJob,
                client: CLIENT, replay: REPLAY, allowMs: 5000 };
  fs.writeFileSync(ctx.paths.state, JSON.stringify({ v: 1, seq: 1, entries: [
    { id: '1', name: 'restart-the-agent', host: 'from-alert', recipe: RECIPE, task: S.defaultTask('Restart the host agent', 'restart-the-agent', on('alert-crash')),
      spec: on('alert-crash'), debounce: 0, next: null, runs: 0, limit: 60000 }] }));
  const rt = S.newRuntime();
  const crash = E(opened({ id: 'c1', rule: 'crash', host: '10003', hostName: 'Lab', title: 'Lab\'s host agent keeps exiting' }));
  let ds = S.offerEvent(ctx, rt, crash);
  S.tick(ctx, rt);
  await Promise.all([...rt.active.values()].map((j) => j.promise));
  let e = S.readState(ctx.paths).entries[0];
  const vdir = e.last ? path.join(W, e.last.dir) : tmp;
  const argv = readJson(path.join(vdir, '_argv.json')) || [], rep = readJson(path.join(vdir, '_replay.json')) || [];
  const after = (a, k) => a[a.indexOf(k) + 1];
  ok(ds[0].act === 'start' && e.last && e.last.result === 'ok', 'recipe: the crash alert on 10003 starts the visit, and it ends ok');
  ok(after(argv, '--host') === '10003' && /restart the host agent \(a run started by the relay's "crash" alert\)/.test(after(argv, '--task')), '...on the machine the alert named; the Allow card says what started it');
  ok(rep[0] === 'run' && rep[1] === RECIPE && after(rep, '--set') === 'event=alert-crash' && rep.includes('machine=10003') && rep.filter((a) => a === '--set').length === 2,
     '...and the replay line carries --set event=alert-crash --set machine=10003');
  ok(readJson(path.join(vdir, 'event.json')).facts.machine === '10003', '...the whole event in its folder');
  ok(S.takesValues(REPLAY) && !S.takesValues(OLD) && !S.takesValues(path.join(dir, 'no-such.js')), 'recipe: whether a drive/replay.js takes --set name=value');
  ctx.replay = OLD;
  S.offerEvent(ctx, rt, crash);
  S.tick(ctx, rt);
  await Promise.all([...rt.active.values()].map((j) => j.promise));
  e = S.readState(ctx.paths).entries[0];
  ok(e.last.result === 'could not start' && /does not take --set name=value yet/.test(e.last.why) && /nobody was asked/.test(e.last.why) &&
     !fs.existsSync(path.join(W, e.last.dir, 'client.log')), 'recipe: with a drive/replay.js that does not take --set yet, "could not start" -- before any visit, so nobody is asked for Allow');
}

// ---- the command line, in child processes ------------------------------------------------------------------------------
async function cliTests() {
  const clear = { SM_SCHEDULE_NOW: '', SM_SCHEDULE_LAUNCHER: '', SM_SCHEDULE_CLIENT: '', SM_SCHEDULE_ALLOW_MS: '', SM_EVENT: 'stale', SM_MACHINE: 'stale' };
  const cli = (args, env) => {
    const x = spawnSync(node, [SCHEDULE].concat(args), { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, clear, env || {}) });
    return { code: x.status, out: String(x.stdout || '') + String(x.stderr || '') };
  };
  const W = path.join(tmp, 'w-cli'), INBOX = path.join(tmp, 'inbox-cli'), w = ['--work', W];
  fs.mkdirSync(INBOX, { recursive: true });
  fs.writeFileSync(path.join(INBOX, 'there-before.csv'), 'x');
  const stateOf = () => JSON.parse(fs.readFileSync(path.join(W, 'schedule.json'), 'utf8'));
  const RECIPE = path.join(tmp, 'fakes', 'restart-the-agent', 'replay.json');
  const LAUNCHER = path.join(tmp, 'fake-launcher.js'), STARTED = path.join(tmp, 'started.ndjson');
  fs.writeFileSync(LAUNCHER, [
    "const fs = require('fs'), e = JSON.parse(process.env.SM_SCHEDULE_ENTRY), v = process.env;",
    "fs.appendFileSync(v.FAKE_OUT, JSON.stringify({ id: e.id, event: v.SM_EVENT, machine: v.SM_MACHINE, name: v.SM_MACHINE_NAME, file: v.SM_FILE,",
    "  eventFile: v.SM_EVENT_FILE, host: v.SM_SCHEDULE_HOST }) + '\\n');",
    "console.log('the fake job ran #' + e.id);"].join('\n'));
  const started = () => readText(STARTED).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const launcher = { SM_SCHEDULE_LAUNCHER: q(node) + ' ' + q(LAUNCHER), FAKE_OUT: STARTED };

  let c = cli(['add', '--cmd', 'node x.js', '--on', 'alert-offline', '--machine', '10004', '--name', 'page me'].concat(w));
  const m = /paste http:\/\/127\.0\.0\.1:8754\/hook\/([A-Za-z0-9_-]{32})/.exec(c.out);
  let st = stateOf();
  ok(c.code === 0 && /added #1 "page me".*when the relay alerts "offline" for machine 10004/.test(c.out) && m && st.hook.token === m[1] && st.entries[0].next === null && st.entries[0].debounce === MIN,
     'cli: add --on alert-offline --machine 10004 -- the token made on first use, and the address to paste said');
  ok(/counted, not started/.test(c.out) && /node drive\/schedule\.js hook says how/.test(c.out), '...and what a burst does, and where to learn how the relay reaches it');
  c = cli(['add', '--host', 'from-alert', '--recipe', RECIPE, '--on', 'alert-*'].concat(w));
  ok(c.code === 0 && /on the machine the alert names/.test(c.out) && /must press Allow/.test(c.out) && /waits for its next event/.test(c.out) && stateOf().hook.token === m[1],
     'cli: a recipe on the machine the alert names -- every visit still needs Allow; the token stays');
  ok(/whoever holds the token can send one naming any machine/.test(c.out) && /--machine <number>\[,<number>\.\.\.\]/.test(c.out), '...and with no machine numbers, add says the token holder chooses the machine');
  if (process.platform !== 'win32') ok((fs.statSync(path.join(W, 'schedule.json')).mode & 0o777) === 0o600, 'cli: schedule.json, which holds the token, is its owner\'s alone (0600)');
  const WQ = ['--work', path.join(tmp, 'w-quote')];
  c = cli(['add', '--host', 'from-alert', '--cmd', 'node x.js', '--on', 'alert-*', '--machine', '10001,10002'].concat(WQ));
  ok(c.code === 0 && !/whoever holds the token/.test(c.out) && /for machines 10001, 10002/.test(c.out), 'cli: --machine 10001,10002 names the machines it may visit -- no warning');
  c = cli(['add', '--cmd', 'type %SM_FILE%', '--on', 'file:' + INBOX].concat(WQ));
  const c2 = cli(['add', '--cmd', 'type "%SM_FILE%"', '--on', 'file:' + INBOX].concat(WQ));
  ok(c.code === 2 && /expands %SM_FILE% outside double quotes/.test(c.out) && /"a&b\.csv" runs b\.csv/.test(c.out) && c2.code === 0,
     'cli: a --cmd that lets cmd.exe read a file\'s name (%SM_FILE% unquoted) is refused; quoted it is only a name');
  ok(/\(a run started by a relay alert\)$/.test(stateOf().entries[1].task), '...its Allow card says a relay alert started it');
  c = cli(['add', '--host', 'from-alert', '--recipe', RECIPE, '--on', 'alert-offline', '--work', path.join(tmp, 'w-offline')]);
  ok(c.code === 0 && /An offline machine cannot be visited/.test(c.out) && /--on recovered-offline starts the job once it is back/.test(c.out), 'cli: a visit on an offline alert to that same machine: add warns it cannot be let in');
  const refused = [
    [['--host', 'from-alert', '--cmd', 'x', '--on', 'http'], /takes the machine from a relay alert/],
    [['--host', 'from-alert', '--cmd', 'x', '--on', 'alert-relay'], /about no machine/],
    [['--host', 'from-alert', '--cmd', 'x', '--on', 'alert-site'], /say which with --machine/],
    [['--cmd', 'x', '--on', 'file:' + path.join(tmp, 'no-such-folder')], /there is no folder/],
    [['--cmd', 'x', '--on', 'http', '--debounce', '5 parsecs'], /--debounce is a span/],
    [['--cmd', 'x', '--at', '09:00', '--debounce', '1m'], /--debounce goes with --on/],
    [['--cmd', 'x', '--on', 'alert-ofline'], /not a rule the relay alerts on/],
    [['--host', '1004', '--cmd', 'x', '--on', 'http'], /five-digit/],
  ];
  const bad = refused.filter(([a, re]) => { const x = cli(['add'].concat(a, w)); return !(x.code === 2 && re.test(x.out)); });
  ok(!bad.length && stateOf().entries.length === 2, 'cli: what add refuses is exit 2, with the why -- and nothing is written' + (bad.length ? ' (' + bad.map((b) => b[0].join(' ')).join(' | ') + ')' : ''));
  c = cli(['add', '--cmd', 'node deploy.js', '--on', 'http', '--name', 'deploy', '--debounce', '0'].concat(w));
  ok(c.code === 0 && c.out.includes('curl -X POST http://127.0.0.1:8754/run/3/' + m[1]) && /each one starts a run, unless its run is still going/.test(c.out), 'cli: --on http says the call that starts it');
  c = cli(['add', '--cmd', 'node import.js', '--on', 'file:' + INBOX, '--match', '*.csv', '--name', 'import'].concat(w));
  const seen0 = readJson(path.join(W, 'schedule', '4', 'files.json'));
  ok(c.code === 0 && /watches .*inbox-cli for new files matching \*\.csv -- the 1 file there now is taken as there before/.test(c.out) && seen0 && seen0.seen['there-before.csv'],
     'cli: --on file:<folder> --match *.csv -- what is there now is written down as there before');
  c = cli(['hook'].concat(w));
  ok(c.code === 0 && c.out.includes('http://127.0.0.1:8754/hook/' + m[1]) && /this machine alone/.test(c.out) && /--listen <an address of this machine>:8754/.test(c.out) &&
     /the only lock/.test(c.out) && /no runner is running/.test(c.out) && /has not reached it yet/.test(c.out) && c.out.includes('#3 "deploy" starts on a call:  curl -X POST http://127.0.0.1:8754/run/3/' + m[1]),
     'cli: hook -- the address to paste, said plainly: reachable only from this machine unless the runner listens wider, and why the token matters');
  ok(/<this machine's address>:9000\/hook\//.test(cli(['hook', '--listen', '0.0.0.0:9000'].concat(w)).out) && /can be reached from other machines/.test(cli(['hook', '--listen', '0.0.0.0:9000'].concat(w)).out),
     'cli: hook --listen 0.0.0.0:9000 -- the address for a runner that listens wider');
  c = cli(['hook', '--new-token'].concat(w));
  const tok2 = stateOf().hook.token;
  ok(c.code === 0 && tok2 !== m[1] && /a new token/.test(c.out) && c.out.includes('/hook/' + tok2) && !c.out.includes(m[1]), 'cli: hook --new-token replaces it');
  const hj = JSON.parse(cli(['hook', '--json'].concat(w)).out);
  ok(hj.hook === 'http://127.0.0.1:8754/hook/' + tok2 && hj.calls[0].url === 'http://127.0.0.1:8754/run/3/' + tok2, 'cli: hook --json');
  c = cli(['list'].concat(w));
  ok(/#1  page me  command "node x\.js"\n    when: when the relay alerts "offline" for machine 10004   next: waits for it -- but no runner is running, so nothing hears it/.test(c.out) &&
     /#2  restart-the-agent  machine from the alert/.test(c.out) && /last fired: never   \(debounce 1 min\)/.test(c.out) && /hook: +the relay has not reached it yet/.test(c.out) &&
     /nothing watches the folder/.test(c.out) && /when it is called: POST \/run\/3\/<token>/.test(c.out), 'cli: list -- each trigger, what it waits for, that it never fired');
  ok(!cli(['list', '--json'].concat(w)).out.includes(tok2), 'cli: list --json never holds the token');
  ok(/nothing on the clock; 4 entries start on an event/.test(cli(['next'].concat(w)).out), 'cli: next -- triggers have no fire times, and it says so');

  // run --once finds a file that landed, starts its job once -- and says alerts need a runner that keeps running
  const NEW = path.join(INBOX, 'new.csv');
  fs.writeFileSync(NEW, 'a,b\n1,2\n');
  c = cli(['run', '--once'].concat(w), launcher);
  let s = started();
  ok(c.code === 0 && s.length === 1 && s[0].id === '4' && s[0].event === 'file' && s[0].file === NEW && !s[0].machine && fs.existsSync(s[0].eventFile),
     'cli: run --once looks in the folder -- the new file starts #4, SM_EVENT=file, SM_FILE its full path (and nothing stale)');
  ok(/wait for the relay's alerts or a call: only a runner that keeps running hears them/.test(c.out), '...and says the alerts and calls need a runner that keeps running');
  c = cli(['run', '--once'].concat(w), launcher);
  ok(c.code === 0 && started().length === 1, 'cli: run --once again: the same file never starts it twice');

  // a runner that keeps running hears a POST
  const child = spawn(node, [SCHEDULE, 'run', '--listen', '127.0.0.1:0'].concat(w), { env: Object.assign({}, process.env, clear, launcher), stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (b) => { said += b; });
  child.stderr.on('data', (b) => { said += b; });
  const exited = new Promise((res) => child.on('exit', res));
  const mark = await until(() => { const r = readJson(path.join(W, 'schedule.runner.json')); return r && r.listen ? r : null; }, 10000);
  const port = mark ? Number(mark.listen.split(':').pop()) : 0;
  ok(port > 0 && /listening on http:\/\/127\.0\.0\.1:\d+/.test(said), 'cli: run --listen 127.0.0.1:0 -- it listens, and its mark says where');
  ok(cli(['hook'].concat(w)).out.includes('http://127.0.0.1:' + port + '/hook/' + tok2), 'cli: hook prints the running runner\'s own address');
  let x = await request(port, 'POST', '/hook/' + m[1], opened());   // the old token
  ok(x.status === 404, 'cli: the address with the replaced token is a 404');
  x = await request(port, 'POST', '/hook/' + tok2, opened());
  ok(x.status === 200 && x.json.started.join() === '1,2', 'cli: the relay\'s offline alert on 10004 starts #1 and #2');
  await until(() => started().length >= 3, 10000);
  s = started();
  const s1 = s.find((r) => r.id === '1'), s2 = s.find((r) => r.id === '2');
  ok(s1 && s1.event === 'alert-offline' && s1.machine === '10004' && !s1.name && !s1.file && !s1.host,
     'cli: #1 (a command) gets SM_EVENT and SM_MACHINE in its environment -- not the name a machine gave itself');
  ok(s2 && s2.host === '10004' && s2.machine === '10004', 'cli: #2 (from-alert) runs for machine 10004');
  const ej = readJson(s1.eventFile);
  ok(ej && ej.facts.incident === 'k1abc' && ej.name === 'Front desk', 'cli: SM_EVENT_FILE holds the whole event, the relay\'s name for the machine too');
  x = await request(port, 'POST', '/hook/' + tok2, { event: 'test', relay: 'https://relay.example.com', at: Date.now(), by: 'alice' });
  ok(x.status === 200 && !x.json.started.length, 'cli: the relay\'s Test button reaches it, and starts nothing (no entry waits for it)');
  await until(() => { const r = readJson(path.join(W, 'schedule.runner.json')); return r && r.refused === 1; }, 5000);
  c = cli(['list'].concat(w));
  ok(/listening on 127\.0\.0\.1:\d+ -- refused 1 request\(s\) without the token/.test(c.out) && /hook: +the relay last reached it .* \(test\), 2 message\(s\) in all/.test(c.out) &&
     /last fired: .* -- alert-offline, machine 10004 \(Front desk\)/.test(c.out), 'cli: list -- where it listens, what it refused, when the relay last reached it, when each fired');
  const log = readText(path.join(W, 'schedule.log'));
  ok(/hook  test -- no entry waits for it/.test(log) && !log.includes(tok2) && !log.includes(m[1]), 'cli: schedule.log has the test, and no token');
  child.kill();
  await exited;
}

function finishUp() {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log((fail ? 'FAIL' : 'ok') + ' triggers: ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
}

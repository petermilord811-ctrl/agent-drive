'use strict';
// @tool what starts a triggered job: a relay health alert (its webhook), a new file in a folder, a direct call -- read, matched, debounced
// @run  const T = require('./triggers.js')   (a library; drive/schedule.js uses it: add --on <event>, and run's listener and folder watch)
// triggers -- A JOB THAT STARTS WHEN SOMETHING HAPPENS, NOT WHEN A CLOCK SAYS.
//
// drive/schedule.js runs a saved job at a time of day, every N, or once. Some jobs belong to a moment no clock knows:
// machine 10004 has been offline for ten minutes, an export landed in a folder, a deploy script says "now". This is
// the event side of it: what an entry waits for (parseOn), what the relay's webhook says (hookEvents), which entries
// an event starts and which it only counts (offer), when a new file is whole (scanFiles), and the listener that the
// relay and a direct call reach (listener). Whatever decides is pure and is handed its clock.
//
// WHAT THE RELAY'S WEBHOOK REALLY SENDS (its console: Health -> settings -> "Send alerts to" -> a webhook (JSON POST)).
// One POST per message: Content-Type application/json, User-Agent ScreenMirror-relay, NO signature and no auth header
// -- so the secret token in the address is the only thing that tells the relay from anyone else. A failed delivery
// is logged on the relay and not tried again. An alert is
//     {event: 'alert-open' | 'alert-close', relay, at, machine, incident}
// THE RULE IS incident.rule -- `event` says only opened or closed. `machine` is the relay's NAME for the machine
// ('Fleet' when the alert is about no single one); its NUMBER is incident.host ('' when none), and a site alert's
// machines are incident.hosts. The incident also carries id, hostName, sev ('bad' | 'warn'), title, text, what,
// opened, closed (0 while open), closeWhy, manual, still, count, and its acknowledge/assign/resolve fields and notes.
// The rules: offline, blind, degraded, hostfault, disk, forecast, battery, crash, access, checks -- each about one
// machine; site -- several machines at one internet address dropped together (incident.hosts, no name for them);
// refused (a machine the relay would not let register: known by its address, no number) and relay (a relay of the
// federation is down) -- about no machine.
// An incident is posted once, when it opens: a condition that goes on is not posted again (nor after the relay
// restarts), and one that ends and comes back is a new incident with a new id. Its end is posted as 'alert-close'
// only while "also say when it is back to normal" is on (it is by default) -- and with incident.manual true when a
// PERSON pressed Resolve, which is not the condition ending: incident.still then says what still holds ("... is still
// offline"). Quiet hours and a send-rate floor (30 a channel in 10 minutes) hold messages back and then post ONE
// {event: 'alert-summary', relay, at, held: [the held messages]}. A maintenance window mutes a machine's alerts, and a
// private machine's go out only if "include private machines in the outside channels" is on. Besides alerts it posts
// {event: 'digest', at, availability, lines} daily, {event: 'monthly-report', month, availability, machines: [{id,
// name, avail}]} (no `at`), and {event: 'test', at, by} when the Test button beside the webhook setting is pressed.
//
// SO AN ENTRY WAITS FOR (--on; hookEvents turns each message into these):
//   alert-<rule>      an incident of that rule opened -- alert-* any rule                  ['alert-open']
//   recovered-<rule>  it closed because its condition ended -- back to normal             ['alert-close', manual false]
//   resolved-<rule>   a person marked it resolved; the condition may still hold           ['alert-close', manual true]
//   digest, monthly-report, test    the relay's reports, and its Test button
//   file:<folder>     a new file in that folder [--match *.csv], once it is whole
//   http              a direct call: POST /run/<id>/<token> on the runner's listener
// (Mind the names: event 'alert-open' with incident.rule 'offline' is what --on alert-offline waits for.)
// --machine 10004 (or a list, 10001,10002, or the relay's name for one machine) narrows an alert to those machines; a
// site alert matches each machine number it lists (it names none of them). An alert-summary is opened up: each held
// message is an event of its own, except an alert-open whose condition ended within the same summary (a recovery,
// not a person's Resolve) -- that is over before anybody could act on it.
//
// THE RULES (offer). ONE RUN PER BURST: the first matching event starts an entry's run; the same event again within
// its debounce window (60 s unless --debounce: a summary opened up, an outage alerting on every machine, ten files
// landing together) is counted, never started; one that comes later while that run still goes is skipped and
// counted, as a clock fire is. So an entry handles one event per burst: with --host from-alert, one machine -- an
// alert about another machine meanwhile is counted, and the relay does not post it again (an entry per machine
// handles each). --host from-alert visits the machine the event names: an alert that names no single machine does
// not start it, and with no --machine NUMBERS whoever holds the token chooses the machine -- add says so.
// A FILE is offered once: never the same file again -- one changed in place is the same file; one deleted and made
// again is a new one (a name gone from the folder is forgotten after FORGET_MS, so one empty look at a folder that
// hiccupped forgets nothing). A file still being written is not offered until its size and time have held still
// for two seconds, and a download's or an editor's scratch (.tmp, .part, .crdownload, ~$name, .name) never is. A
// file that comes in a burst or while the run goes is counted with the rest, so a job that must see every file
// handles the whole folder, not only the file it was handed.
const crypto = require('crypto'), fs = require('fs'), http = require('http'), path = require('path');

const DEBOUNCE_MS = 60000;               // the same event again within this of the run it started is a burst: counted
const STEADY_MS = 2000;                  // a new file is whole once its size and time have held still this long
const FORGET_MS = 5 * 60000;             // a name gone from a folder this long is forgotten: a file of that name is new
const DEFAULT_HOST = '127.0.0.1';        // the listener: this machine alone, unless --listen says otherwise
const DEFAULT_PORT = 8754;
const MAX_BODY = 2 * 1024 * 1024;        // a summary of the 500 messages the relay holds at most fits; more is not the relay
const FROM_ALERT = 'from-alert';         // --host from-alert: the machine the event names

// The relay's alert rules, as its settings name them
const RULES = {
  offline: 'a machine is offline', site: 'several machines at one site dropped together', blind: 'a machine sends no picture',
  degraded: 'a machine\'s picture is degraded', hostfault: 'a machine reports a fault or ignores remote input',
  disk: 'a system disk is low on space', forecast: 'a disk is filling up', battery: 'a battery is low and not charging',
  refused: 'the relay refused a machine', crash: 'a host agent keeps exiting', access: 'control taken out of hours or from a new address',
  checks: 'a machine check found a problem', relay: 'a relay of the federation is down',
};
const NO_MACHINE = new Set(['refused', 'relay']);   // about no machine with a number
const REPORTS = { digest: 'the relay\'s daily digest', 'monthly-report': 'the relay\'s monthly availability report',
                  test: 'the Test button beside the relay\'s webhook setting' };
const ON_FORMS = '--on is what starts it: alert-<rule> (alert-offline; alert-* for any rule), recovered-<rule>, resolved-<rule>, ' +
                 'digest, monthly-report, test, file:<folder>, or http';

// one line of text from the network: no control characters, capped
const one = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const isNum = (s) => /^[0-9]{5}$/.test(String(s == null ? '' : s));   // a machine number, as --host takes it
const RELAY_ID = /^[0-9]{4,6}$/;                                      // a machine number, as the relay writes one
// a name the tables have -- their own, never one every object has ("constructor", "__proto__")
const isRule = (r) => Object.hasOwn(RULES, r), isReport = (w) => Object.hasOwn(REPORTS, w);
// --machine as numbers -- one, or a list: the machines it may be about -- or null when it is a name
function machineNums(spec) {
  const m = spec && spec.machine ? String(spec.machine).split(',') : [];
  return m.length && m.every(isNum) ? m : null;
}
const isTrigger = (e) => !!(e && e.spec && e.spec.kind === 'on');
const needsListener = (e) => isTrigger(e) && e.spec.event !== 'file';
const watchesFolder = (e) => isTrigger(e) && e.spec.event === 'file';
// 'alert-offline' -> {on: 'alert', rule: 'offline'}; 'file' -> {on: 'file', rule: ''}
function partsOf(event) {
  const m = /^(alert|recovered|resolved)-(.+)$/.exec(String(event || ''));
  return m ? { on: m[1], rule: m[2] } : { on: String(event || ''), rule: '' };
}
// The machine an entry's run holds: the one its event named (kept on its run, or on the fire waiting to start), else
// its own --host
function hostOf(e) {
  if (!e) return null;
  const r = e.running || e.pending;
  return (r && r.host) || (e.host && e.host !== FROM_ALERT ? String(e.host) : null);
}

// ---- what an entry waits for -------------------------------------------------------------------------------------
// --on <event> [--machine <number[,number...]|name>] [--match <glob>] -> {ok, spec: {kind: 'on', event, machine?,
// folder?, match?}} -- machine: '10004', '10001,10002' or a name
function parseOn(a) {
  const no = (why) => ({ ok: false, why });
  const given = (k) => a && a[k] != null && a[k] !== false && String(a[k]).trim() !== '';
  const raw = String(a && a.on != null ? a.on : '').trim();
  let spec;
  const f = /^file:(.*)$/i.exec(raw);
  if (f) {
    const folder = f[1].trim().replace(/^(["'])(.*)\1$/, '$2');
    if (!folder) return no('--on file:<folder> names the folder to watch, e.g. --on file:./inbox');
    spec = { kind: 'on', event: 'file', folder: path.resolve(folder) };
  } else {
    const w = raw.toLowerCase();
    if (w === 'http' || w === 'call') spec = { kind: 'on', event: 'http' };
    else if (isReport(w)) spec = { kind: 'on', event: w };
    else {
      const m = /^(alert|recovered|resolved)(?:-(.*))?$/.exec(w);
      if (!m) return no(ON_FORMS + ' -- not "' + raw + '"');
      const rule = !m[2] || m[2] === '*' || m[2] === 'any' ? '*' : m[2];
      if (rule !== '*' && !isRule(rule)) return no('"' + rule + '" is not a rule the relay alerts on: ' + Object.keys(RULES).join(', ') + ' -- or * for any');
      spec = { kind: 'on', event: m[1] + '-' + rule };
    }
  }
  const p = partsOf(spec.event);
  if (given('machine')) {
    if (!p.rule) return no('--machine narrows a relay alert to its machines; --on ' + raw + ' names no machine');
    if (NO_MACHINE.has(p.rule)) return no('a "' + p.rule + '" alert is about no machine -- drop --machine');
    const v = one(a.machine, 400), parts = v.split(/\s*,\s*/).filter(Boolean);
    if (parts.length > 1 || /^[0-9]+$/.test(v)) {   // machine numbers: one, or a list of the machines it may be about
      const bad = parts.find((x) => !isNum(x));
      if (bad !== undefined) return no('--machine is a five-digit machine number, a list of them (10001,10002), or the relay\'s name for one machine -- not "' + bad + '"');
      spec.machine = [...new Set(parts)].join(',');
    } else spec.machine = v;
  }
  if (given('match')) {
    if (spec.event !== 'file') return no('--match goes with --on file:<folder>');
    const g = String(a.match).trim();
    if (/[\\/]/.test(g) || g.length > 120) return no('--match is a pattern for a file\'s name, like *.csv -- not a path');
    spec.match = g;
  }
  return { ok: true, spec };
}

// In words: "when the relay alerts "offline" for machine 10004", "when a new file lands in C:\in matching *.csv"
function describeOn(spec) {
  if (!spec) return '?';
  const p = partsOf(spec.event);
  if (p.rule) {
    const nums = machineNums(spec);
    const who = !spec.machine ? '' : !nums ? ' for the machine "' + spec.machine + '"' : nums.length === 1 ? ' for machine ' + nums[0] : ' for machines ' + nums.join(', ');
    const any = p.rule === '*';
    if (p.on === 'alert') return 'when the relay alerts ' + (any ? '(any rule)' : '"' + p.rule + '"') + who;
    if (p.on === 'recovered') return 'when the relay says ' + (any ? 'an alert' : '"' + p.rule + '"') + ' is back to normal' + who;
    return 'when a person marks ' + (any ? 'an alert' : 'the "' + p.rule + '" alert') + ' resolved' + who;
  }
  if (isReport(spec.event)) return 'when ' + REPORTS[spec.event] + (spec.event === 'test' ? ' is pressed' : ' arrives');
  if (spec.event === 'file') return 'when a new file lands in ' + spec.folder + (spec.match ? ' matching ' + spec.match : '');
  if (spec.event === 'http') return 'when it is called: POST /run/<id>/<token> on the runner\'s listener';
  return '?';
}
// What started a run, as the Allow card's line ends: "(a run started by the relay's "offline" alert)"
function shortOn(spec) {
  const p = partsOf(spec && spec.event);
  const what = p.rule === '*' ? 'an alert' : '"' + p.rule + '"';
  if (p.on === 'alert') return p.rule === '*' ? 'a relay alert' : 'the relay\'s ' + what + ' alert';
  if (p.on === 'recovered') return 'the relay saying ' + what + ' is back to normal';
  if (p.on === 'resolved') return what + ' being marked resolved';
  if (spec && isReport(spec.event)) return REPORTS[spec.event];
  if (spec && spec.event === 'file') return 'a new file in ' + (path.basename(spec.folder) || spec.folder);
  return 'a call';
}

// ---- what the relay's webhook says ------------------------------------------------------------------------------------
function alertEvent(msg) {
  const inc = msg && msg.incident && typeof msg.incident === 'object' ? msg.incident : {};
  const rule = String(inc.rule || '');
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(rule)) return null;
  const on = msg.event === 'alert-open' ? 'alert' : inc.manual ? 'resolved' : 'recovered';
  const host = RELAY_ID.test(String(inc.host || '')) ? String(inc.host) : '';
  const machines = host ? [host] : (Array.isArray(inc.hosts) ? inc.hosts.map(String).filter((h) => RELAY_ID.test(h)).slice(0, 500) : []);
  const ev = { event: on + '-' + rule, on, rule, machine: host, machines, name: host ? one(inc.hostName || msg.machine, 100) : '',
               incident: one(inc.id, 64), sev: one(inc.sev, 8), title: one(inc.title, 160), text: one(inc.text, 600),
               at: num(msg.at) || num(on === 'alert' ? inc.opened : inc.closed), relay: one(msg.relay, 200) };
  if (num(inc.opened)) ev.opened = num(inc.opened);
  if (on !== 'alert') { ev.closed = num(inc.closed); ev.why = one(inc.closeWhy, 300); if (inc.still) ev.still = one(inc.still, 200); }
  return ev;
}
// A POST from the relay -> {events: [...], held?: n, why?: 'why there are none'}
function hookEvents(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.event !== 'string') return { events: [], why: 'not a message from the relay\'s webhook: it has no event' };
  const kind = body.event;
  if (kind === 'alert-open' || kind === 'alert-close') {
    const e = alertEvent(body);
    return e ? { events: [e] } : { events: [], why: 'an alert with no rule' };
  }
  if (kind === 'alert-summary') {
    const held = (Array.isArray(body.held) ? body.held : []).slice(0, 1000)
      .filter((m) => m && (m.event === 'alert-open' || m.event === 'alert-close')).map(alertEvent).filter(Boolean);
    // over: its condition ended. Not one a person marked resolved -- that may still hold (incident.still)
    const over = new Set(held.filter((e) => e.on === 'recovered' && e.incident).map((e) => e.incident));
    return { events: held.filter((e) => e.on !== 'alert' || !e.incident || !over.has(e.incident)), held: held.length };
  }
  if (isReport(kind)) {
    const ev = { event: kind, on: kind, rule: '', machine: '', machines: [], name: '', at: num(body.at), relay: one(body.relay, 200) };
    if (body.month) ev.month = one(body.month, 10);
    if (body.by) ev.by = one(body.by, 64);
    return { events: [ev] };
  }
  return { events: [], why: 'a message this runner does not know: "' + one(kind, 40) + '"' };
}

// ---- which entries an event starts --------------------------------------------------------------------------------------
// The machine the event is about, for this entry: with --machine numbers, the one the event names if it is listed,
// else the first listed one among the event's (a site alert names several) -- never one the list leaves out; else the
// one machine the event names, else none
function machineOf(spec, ev) {
  const all = (ev && ev.machines) || [], nums = machineNums(spec);
  if (nums) return ev && ev.machine && nums.includes(String(ev.machine)) ? String(ev.machine) : (all.find((h) => nums.includes(h)) || '');
  return ev && ev.machine ? String(ev.machine) : '';
}
function matches(e, ev) {
  if (!isTrigger(e) || !ev) return false;
  const spec = e.spec;
  if (spec.event === 'file' || spec.event === 'http') return ev.event === spec.event && String(ev.entry) === String(e.id);
  if (isReport(spec.event)) return ev.event === spec.event;
  const want = partsOf(spec.event);
  if (!want.rule || ev.on !== want.on || (want.rule !== '*' && ev.rule !== want.rule)) return false;
  if (spec.machine) {
    const nums = machineNums(spec);
    if (nums) { if (!nums.some((n) => (ev.machines || []).includes(n))) return false; }
    else if (!ev.name || ev.name.toLowerCase() !== spec.machine.toLowerCase()) return false;
  }
  // --host from-alert visits the machine the event names: one that names none (a relay, a site with no --machine)
  // cannot start it
  if (e.host === FROM_ALERT && !isNum(machineOf(spec, ev))) return false;
  return true;
}
// The facts a run is handed: {event, machine?, name?, file?, rule?, incident?, at}
function factsOf(ev, e) {
  const f = { event: ev.event };
  const m = machineOf(e && e.spec, ev);
  if (m) { f.machine = m; if (m === ev.machine && ev.name) f.name = ev.name; }
  if (ev.file) f.file = ev.file;
  if (ev.rule) f.rule = ev.rule;
  if (ev.incident) f.incident = ev.incident;
  if (ev.at) f.at = ev.at;
  return f;
}
// "alert-offline, machine 10004 (Front desk)", "file, C:\in\a.csv", "http" -- for a log line and list, so no control
// character a name may hold (a newline in a file's name would forge a line of schedule.log)
function factsLine(f) {
  if (!f) return '';
  const shown = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, '?');
  const bits = [shown(f.event)];
  if (f.machine) bits.push('machine ' + shown(f.machine) + (f.name ? ' (' + shown(f.name) + ')' : ''));
  if (f.file) bits.push(shown(f.file));
  return bits.join(', ');
}
// What an event does to each entry it matches -> [{id, act, facts, host?}]. Nothing is changed here; the runner
// records it. opts.only: the one entry it is for (a file, a direct call).
//   start  idle, and outside its debounce window: it starts -- or, its machine busy with another entry's run, it
//          waits for that run to end (act 'queue': drive/schedule.js's due() does the waiting)
//   burst  within its debounce window of the run the event started, or that run has not even started: counted
//   busy   its run (or its wait for a machine) still goes: skipped and counted -- never two runs of one entry
function offer(entries, ev, nowMs, opts) {
  const list = Array.isArray(entries) ? entries : [];
  const only = opts && opts.only != null ? String(opts.only) : null;
  const out = [];
  for (const e of list) {
    if (e.done || (only != null && String(e.id) !== only) || !matches(e, ev)) continue;
    const win = e.debounce != null && Number(e.debounce) >= 0 ? Number(e.debounce) : DEBOUNCE_MS;
    const since = e.fired && Number.isFinite(Number(e.fired.at)) ? nowMs - Number(e.fired.at) : Infinity;
    const d = { id: e.id, act: 'start', facts: factsOf(ev, e) };
    if (e.pending || (since >= 0 && since < win)) d.act = 'burst';
    else if (e.running) d.act = 'busy';
    else {
      const host = e.host === FROM_ALERT ? d.facts.machine : (e.host ? String(e.host) : null);
      if (host) d.host = host;
      if (host && list.some((x) => x !== e && x.running && !x.running.queued && hostOf(x) === host)) d.act = 'queue';
    }
    out.push(d);
  }
  return out;
}

// The event's facts, as a job is handed them. A recipe: --set name=value on its `drive/replay.js run` line, each one
// argument and no shell (a recipe ignores the names it does not use). A command: environment variables, every one set
// (empty when the run has no such fact) so a value never leaks in from the runner's own environment -- and never
// spliced into the line a shell reads. Only values the network cannot shape go there: the event is a rule's name, the
// machine a number; the file's name is the folder's, and cmd.exe expands %SM_FILE% before it reads & | < >, so add
// refuses a --cmd that expands it outside double quotes (a Windows file name cannot hold a "). The relay's name for a
// machine, which a machine chooses itself, is in the event's file (SM_EVENT_FILE) alone.
function setArgs(facts) {
  const out = [];
  if (facts) for (const k of ['event', 'machine', 'file']) if (facts[k]) out.push('--set', k + '=' + facts[k]);
  // a recipe takes the facts it has values for and leaves the rest: drive/replay.js refuses a name it does not know
  // unless told -- right for a person typing --set, wrong for an event that offers every fact it has
  if (out.length) out.push('--ignore-unknown');
  return out;
}
const ENV_OF = { event: 'SM_EVENT', machine: 'SM_MACHINE', file: 'SM_FILE' };
// Where a command line expands SM_FILE itself where cmd.exe would read what it holds: %SM_FILE% or !SM_FILE! outside
// double quotes -> the first such place, or null
function bareFileVar(line) {
  let quoted = false;
  const s = String(line || '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    const m = /^(%SM_FILE%|!SM_FILE!)/i.exec(s.slice(i));
    if (m) return m[1];
  }
  return null;
}
function envOf(facts) {
  const env = {};
  for (const [k, n] of Object.entries(ENV_OF)) env[n] = facts && facts[k] ? String(facts[k]) : '';
  return env;
}

// ---- a file landing in a folder ------------------------------------------------------------------------------------------
// A download's or an editor's scratch, never a job's input: it is renamed to its real name when it is whole
const SCRATCH = /^(\.|~\$)|\.(tmp|temp|part|partial|crdownload|download|filepart|swp)$/i;
// --match *.csv -> a RegExp for a file's name: * any run of characters, ? any one; case is ignored, as Windows does
function globRe(glob) {
  let re = '';
  for (const ch of String(glob == null || glob === '' ? '*' : glob)) re += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
  return new RegExp('^' + re + '$', 'i');
}
// The files in a folder (not its subfolders), the ones that match: [{name, size, mt, ms, id}] -- or {name, unread:
// true} for one that is there but could not be looked at just now. id is the file's own number on its disk (its
// creation time where there is none): a file made again under an old name has a new one.
function listFolder(folder, re) {
  const out = [];
  for (const d of fs.readdirSync(folder, { withFileTypes: true })) {
    if (d.isDirectory() || d.isSymbolicLink() || SCRATCH.test(d.name) || (re && !re.test(d.name))) continue;
    let s;
    try { s = fs.statSync(path.join(folder, d.name), { bigint: true }); }
    catch (e) { if (e.code !== 'ENOENT') out.push({ name: d.name, unread: true }); continue; }   // ENOENT: gone since the listing
    if (!s.isFile()) continue;
    const id = s.ino ? String(s.ino) : (s.birthtimeMs ? 'b' + String(s.birthtimeMs) : '');
    out.push({ name: d.name, size: Number(s.size), mt: String(s.mtimeNs), ms: Number(s.mtimeMs), id });
  }
  return out;
}
// One look at a folder -> {seen, missing, cand, ready, changed}. seen: {name: [id, size, mt]} -- the files this entry
// has been offered, or that were there when it was added; missing: {name: since} -- seen names not in the folder;
// cand: {name: {id, size, mt, since}} -- new files watched until their size and time hold still for steadyMs; ready:
// the files that just did, oldest first. A name gone from the folder for forgetMs is forgotten, so a file of that name
// later is a new one -- and one empty look at a folder that hiccupped forgets nothing. (Pure: the listing and the clock
// are handed in; seen and missing are what the runner keeps, cand only while it runs.)
function scanFiles(state, listing, nowMs, steadyMs, forgetMs) {
  const st = state || {}, seen = Object.assign({}, st.seen || {}), missing = Object.assign({}, st.missing || {}), was = st.cand || {};
  const steady = steadyMs == null ? STEADY_MS : Number(steadyMs), forget = forgetMs == null ? FORGET_MS : Number(forgetMs);
  const cand = {}, ready = [], here = new Set();
  let changed = false;
  for (const f of listing || []) {
    here.add(f.name);
    if (missing[f.name] != null) { delete missing[f.name]; changed = true; }
    if (f.unread) continue;   // there, but not to be looked at now: neither new nor gone
    const k = seen[f.name];
    if (k) {
      // the same file, changed in place or not, is never offered twice. A NEW file under an old name has a new id
      // AND a new size or time -- both, so a network folder whose ids wander does not offer its files again
      if (!(f.id && k[0] && f.id !== k[0] && (f.size !== k[1] || f.mt !== k[2]))) continue;
      delete seen[f.name]; changed = true;
    }
    // whole: the same size and time as the look before, for steadyMs -- the id is not asked, as it may wander
    const c = was[f.name];
    if (c && c.size === f.size && c.mt === f.mt) {
      if (nowMs - c.since >= steady) { seen[f.name] = [f.id, f.size, f.mt]; changed = true; ready.push(f); } else cand[f.name] = c;
    } else cand[f.name] = { id: f.id, size: f.size, mt: f.mt, since: nowMs };
  }
  for (const n of Object.keys(seen)) {
    if (here.has(n)) continue;
    if (missing[n] == null) { missing[n] = nowMs; changed = true; }
    else if (nowMs - missing[n] >= forget) { delete seen[n]; delete missing[n]; changed = true; }
  }
  for (const n of Object.keys(missing)) if (!seen[n]) { delete missing[n]; changed = true; }
  ready.sort((a, b) => a.ms - b.ms || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { seen, missing, cand, ready, changed };
}
// What a folder holds now, as already seen: an entry starts on files that land AFTER it was added (one that could not
// be looked at is taken as there, with no id: it is never offered)
function snapshot(listing) { const seen = {}; for (const f of listing || []) seen[f.name] = f.unread ? ['', -1, ''] : [f.id, f.size, f.mt]; return seen; }

// ---- the listener: the relay's webhook and direct calls ---------------------------------------------------------------
// The book's secret token: 192 random bits, in the address of every request (the relay's webhook has no signature)
const makeToken = () => crypto.randomBytes(24).toString('base64url');
// compared in constant time, so its first characters cannot be found one at a time by timing the answers
function tokenOk(given, real) {
  if (!real || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(String(real)).digest();
  return crypto.timingSafeEqual(a, b);
}
// /hook/<token> -> {kind: 'hook', token}; /run/<id>/<token> -> {kind: 'run', id, token}; anything else -> null
function route(url) {
  let p;
  try { p = new URL(String(url || ''), 'http://x').pathname; } catch (_) { return null; }
  let m = /^\/hook\/([A-Za-z0-9_-]{16,128})\/?$/.exec(p);
  if (m) return { kind: 'hook', token: m[1] };
  m = /^\/run\/([0-9]{1,9})\/([A-Za-z0-9_-]{16,128})\/?$/.exec(p);
  return m ? { kind: 'run', id: m[1], token: m[2] } : null;
}
// --listen 8754 | 127.0.0.1:8754 | 0.0.0.0:8754 | [::1]:8754 -> {host, port} | null (port 0: any free one)
function parseListen(text) {
  const s = String(text == null ? '' : text).trim();
  let m, host = DEFAULT_HOST, port;
  if ((m = /^(\d{1,5})$/.exec(s))) port = Number(m[1]);
  else if ((m = /^\[([0-9A-Fa-f:.]+)\]:(\d{1,5})$/.exec(s))) { host = m[1]; port = Number(m[2]); }
  else if ((m = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(s))) { host = m[1]; port = Number(m[2]); }
  else return null;
  return port >= 0 && port <= 65535 ? { host, port } : null;
}
const loopback = (h) => /^(127(\.\d{1,3}){3}|::1|localhost)$/i.test(String(h || ''));
const urlHost = (h) => (String(h).includes(':') ? '[' + h + ']' : String(h));

// The HTTP server. h: {token() -> the current token, refused() -> count one, hook(body) -> {status, json},
// run(id) -> {status, json}}. A request without the right token -- a wrong one, none, any other address -- gets the
// same 404 as any address that is not here, and nothing is kept of it but the count: no line, no path, no address.
// Only a POST is taken, a body up to MAX_BODY, and every answer closes its connection.
function listener(h) {
  const srv = http.createServer((req, res) => {
    const send = (code, obj, extra) => {
      if (res.headersSent) return;
      const body = JSON.stringify(obj) + '\n';
      res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
                                          'Cache-Control': 'no-store', Connection: 'close' }, extra || {}));
      res.end(body);
    };
    req.on('error', () => {});
    const r = route(req.url);
    let real = '';
    try { real = h.token(); } catch (_) {}
    if (!r || !tokenOk(r.token, real)) {
      try { h.refused(); } catch (_) {}
      req.resume();
      return send(404, { ok: false, why: 'not found' });
    }
    if (req.method !== 'POST') { req.resume(); return send(405, { ok: false, why: 'this address takes a POST' }, { Allow: 'POST' }); }
    const chunks = [];
    let size = 0, over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) { over = true; send(413, { ok: false, why: 'too big: at most ' + MAX_BODY + ' bytes' }); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      let out;
      try {
        if (r.kind === 'run') out = h.run(r.id);
        else {
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); } catch (_) { return send(400, { ok: false, why: 'not JSON' }); }
          out = h.hook(body);
        }
      } catch (e) { out = { status: 500, json: { ok: false, why: 'the runner could not take it: ' + ((e && e.message) || e) } }; }
      send((out && out.status) || 200, (out && out.json) || { ok: true });
    });
  });
  srv.headersTimeout = 10000; srv.requestTimeout = 30000; srv.keepAliveTimeout = 1000; srv.maxConnections = 64;
  return srv;
}

// A span for --debounce: 0, 500ms, 30s, 2m, 1h -> ms | null
function parseSpan(text) {
  const m = /^\s*(\d{1,7})\s*(ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)?\s*$/i.exec(String(text == null ? '' : text));
  if (!m) return null;
  const n = Number(m[1]), u = (m[2] || '').toLowerCase();
  if (!u) return n === 0 ? 0 : null;   // a bare number says no unit -- only nothing is clear without one
  return n * (u === 'ms' ? 1 : u[0] === 's' ? 1000 : u[0] === 'm' ? 60000 : 3600000);
}

module.exports = { DEBOUNCE_MS, STEADY_MS, FORGET_MS, DEFAULT_HOST, DEFAULT_PORT, MAX_BODY, FROM_ALERT, RULES, NO_MACHINE, REPORTS,
                   one, isNum, isRule, isReport, machineNums, isTrigger, needsListener, watchesFolder, partsOf, hostOf, parseOn, describeOn, shortOn,
                   hookEvents, machineOf, matches, factsOf, factsLine, offer, setArgs, envOf, bareFileVar,
                   SCRATCH, globRe, listFolder, scanFiles, snapshot,
                   makeToken, tokenOk, route, parseListen, loopback, urlHost, listener, parseSpan };

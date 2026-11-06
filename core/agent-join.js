#!/usr/bin/env node
'use strict';
// =================================================================================================
// agent-join.js -- ask to be let onto ONE machine, then work on it and check your own work.
// @tool connect to ONE machine (a person there presses Allow), then serve commands dropped in <work>/cmd.json
// @run  node core/agent-join.js --host <number> --task "<the job>" --control --serve ./work   (key from .env)
// =================================================================================================
// A client for the join-* handshake. It is a DEV SCRIPT: it is not one of the files `npm run deploy`
// fetches, it needs no packages, and it speaks enough WebSocket to carry JSON and nothing more.
//
// THE KEY IS NOT A PASSWORD AND IS NOT THE AUTHORISATION. SM_JOIN_KEY is the right to ASK: it gets a
// card in front of the people who can see the machine. The press is what grants anything, and nothing
// here can substitute for it. Pass it in the environment rather than on the command line where it
// would sit in a shell history (--key is accepted for a throwaway relay and warns). Driving is a
// SEPARATE consent: --control asks for the keyboard and mouse at the door, the card says so in those
// words, and a visit granted for watching stays one for its whole life.
//
//   SM_JOIN_KEY=... node agent-join.js --relay wss://relay.example:443 --host 10004 \
//                      --agent claude --task "solve the sudoku on screen" --control --serve ./work
//
// ---- why this file is shaped the way it is ------------------------------------------------------
// ACTING ON A DESKTOP IS CHEAP AND WATCHING ONE IS EXPENSIVE. A click is a few dozen bytes; a
// screenshot is a whole-monitor capture, a whole-monitor PNG encode and ~90 KB over three round
// trips. An agent that looks before every action spends its life looking, and one that does not look
// is guessing -- so every early run here was shaped the same way: look once, compute a great deal,
// act in bulk, and hope. That shape is why it could only do simple things.
//
// So the looking is now paid for by the question rather than by the screen. `hold` keeps the identity
// of a picture the host is holding for ten minutes and throws the bytes away; `ocr` reads the words
// in any rectangle of it with NO new capture; `see` decodes only as far down as the rectangle being
// asked about. And `expect` is the difference between "it was sent" and "it landed".
//
// ---- serve mode: one grant, many verified moves -------------------------------------------------
// --serve <dir> holds the grant open and runs commands dropped at <dir>/cmd.json, answering at
// <dir>/done.json and appending to <dir>/ledger.json, which is the record of what actually happened.
//
// Every verb and every field it takes is in core/verbs.js (`node kit.js verbs`), which checks each command
// before it runs; docs/reference/serve-protocol.md explains them. tests/verbs.js holds this list to that table.
//
//   ACTING   click {x,y | lx,ly | at,dx,dy} . clicks {at:[[x,y],..]} . right . dbl . clickText {text,rect,nth}
//            keys {text} . press {code,n} . chord {mod,code} (mod may be "ControlLeft+ShiftLeft") . open {url}
//            scroll {x,y,n} . stroke {points,ms} . strokes {list} . pause {ms} . quit
//            -- any of them may carry look:{out,...}: the picture of what it did, on the same answer
//   LOOKING  look   {out,rect,max,settle}  a picture sized for reading + its scale; lx/ly then aim in ITS pixels
//            shot   {out}              the whole screen, full size
//            hold                      a new picture -- its identity only, ~5.5 KB
//            see    {rect}             decode down to that rectangle and no further
//            ocr    {rect,lang,boxes}  the words there, read on the host, with no new capture
//            find   {text,rect,as,nth} WHERE that word is, remembered under a name to aim at
//            probe  {x,y}              one pixel, exactly
//            census {rect,cap,min}     every connected region in it, biggest first
//            flood  {x,y,bound}        where a bucket fill WOULD go, asked before pouring one
//            mark   {rect}             this picture is the baseline from here
//            diff   {rect}             what has moved since the mark
//            liveness {rect}           is the capture live, blank or frozen?
//   KNOWING  expect {until}            is it true now?
//            wait   {until,timeout,poll}   poll cheaply until it is, or say it never became true
//            plan   {steps:[..],quiet} many steps, each verified, stopping at the FIRST that fails
//            mission {op,...}          the job's big plan: milestones achieved only with proof (core/mission.js)
//   TALKING  chat   {text,to}         say it in this host's session chat (room, or a DM to one tag)
//            chat-img {file,text,to}  post a (cropped) picture to the chat
//            chat-wait {timeout,since}  block for the next human reply (ask with `chat`, then wait)
//            seen {ids} . typing {on} . inbox    read receipts / "typing…" / the operator's recent messages
//            ping   {timeout}         is the session still alive? (seconds, not a 30s stall) . reconnect
//            status {text}            set the "agent is driving" banner the watchers see, no action
//            status {task|step|substep}  name a level of the panel's ACTION TREE (see below); step:null ends one
//            think {thought,conf,next} . warn {text}   the panel's thought line / a caution line
//            confirm {text,timeout}   announce a dangerous action and wait -> {verdict,replies}; a negation,
//                                     deferral or hesitation wins any time, only a short clear yes approves
//                                     (core/consent.js); --auto-confirm: only a window NOBODY answered is a yes
//            captcha {text,timeout}   a CAPTCHA is for a person: ask the operator in chat to solve it, and wait
//            budget {steps,minutes,more,why}  the task's budget of acting steps and minutes (core/budget.js):
//                                     when it is spent acting commands are refused and the room is asked; a
//                                     lower limit is taken, a higher one or more:1 is asked of the room
//            done {text,file}         sign off (with a picture) and hand the grant back
//   NOTES    note-list                the host's sticky notes -> {notes:[{id,text,name,resolved,...}]}
//            note-add {text,x,y}       leave a sticky note (x,y are 0..1; default top-left)
//            note-done {id,undo}       cross a task off by resolving its note (undo:true un-resolves)
//   POINTING spotlight {rect|circle|points,rounds,times,forever}  circle a thing for the watchers, at a
//                                     person's pace, then ping it (the "point & draw" tool)
//            beam {x,y,size,hold,forever}  the focus beam: dim the watchers' picture except a circle at x,y (0..1)
//            spotlight-off {x,y}       clear the beam
//   CONTROL  lock {on}                take (on:true) / release (on:false) EXCLUSIVE control of the host
//                                     -- needs a --control grant; ask first and release when done
//            exec {cmd,timeout}       run one command on the host -- needs a --shell grant
//            terminal {input|keys|signal|open|close, until, wait}  the Terminal panel's shell, shared with everyone
//                                     watching -- needs the TERMINAL consent (--terminal, or access {terminal:1})
//            access {shell,terminal,control,why}  ask for MORE access mid-visit: a new Allow card; nothing changes without it
//   DESKTOP  windows . focus {title|id} . launch {app,args} . controls {title|id}  -- windows, apps and a window's
//            controls by NAME, run on the host through exec (core/desk.js; needs --shell); answers carry cx/cy to click
//   FILES    fetch {path,out} . send {file,to,overwrite}  -- a file from / onto the machine, in chunks, said in the room
//            camera {out,device} . audio {out,seconds}  -- one webcam photo / up to 7 s of what it is PLAYING: the
//                                     room is asked every time and only a yes allows it (all four need --shell)
//                   incoming chat is logged to <serve-dir>/chat.json, notes mirrored to notes.json
//   THE ACTION TREE: with no tool's tree or flat plan in charge, every command lands in a nested tree the
//   watchers' panel renders -- task > step > sub-step > action group > the live action -- with runs MERGED
//   and described ("Ctrl+L, typed 11 characters, ⏎", "Pressed 16 keys: ↓←↓←…", "Checked pixel (3,4) →
//   #000000"), one step per burst unless declared, and "Planning the next step" during a pause (see
//   core/action-tree.js). `intent:'<phrase>'` names a command's group; under a flat plan it is the line.
//   Typed text shows only its shape unless a command says `show:1` (`secret:1` hides it regardless).
//
// Any ACTING verb may carry `expect:`, and then it is only `ok` when the screen agrees afterwards.
// A pointer verb may say `at:'<name>'` instead of x/y, and go where `find` last saw that word.
//
//   EXPECTATIONS  {px:{x,y,is:'#rrggbb'}}  {any:{rect,is}}  {none:{rect,is}}
//                 {text:{rect,has}}  {notext:{rect,has}}  {changed:{rect,min}}  {stable:{rect,min}}
//
// A PLAN MAY CHOOSE AND REPEAT, not only march, and that is the one thing here that buys real time:
// the slowest part of this system is not a step, it is coming back to ask what the next step should
// be. A choice taken on the machine is a round trip that never happens.
//
//   {if:<expectation>, then:[..], else:[..]}
//   {repeat:N, until:<expectation>, steps:[..], poll:ms}
//
// ---- what a step costs, measured on loopback ----------------------------------------------------
// probe 12 ms . hold 8 ms . ocr 5 ms . see(top) 13 ms . click 121 ms . click+expect 250 ms.
// Two things used to dominate and no longer do. The command file was POLLED every 150 ms, and since a
// driver writes its next command the instant it reads the last answer it was always out of phase --
// a full tick, every command, measured at 151 ms; fs.watch fires on the write instead. And the pause
// after a click is owed to the PICTURE, not to the click, so it is paid in needFrame and a run that
// never looks never pays it: twenty clicks went from 7675 ms to 2452 ms.
//
// What is left in a click is 110 ms of ORDERING -- move before down, down before up -- which is the
// host's requirement, not slack, and must be measured against a REAL host before it is touched.
//
// Exit codes: 0 allowed and done, 1 a bad invocation or a transport failure, 2 refused by the relay
// (a wrong key, no such machine, nobody to ask), 3 refused by a person.
// =================================================================================================
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const eyes = require('./agent-eyes.js');   // decode, measure and check a screen; pure, and testable offline
const actionTree = require('./action-tree.js');   // what the panel's tree shows when no tool declared one; pure
const live = require('../vision/liveness.js');   // judge a capture's liveness (blank / frozen) by measuring; pure, offline
const signoff = require('./signoff.js');   // does an operator's chat reply mean "sign off"? pure, offline, tested
const desk = require('./desk.js');               // windows, apps and controls by name, run on the host through exec; tested
const relayAddr = require('./relay-addr.js');   // a relay's last IP, dialled when its name stops resolving; tested
const consent = require('./consent.js');   // what a reply to `confirm` means: yes / no / unclear; pure, offline, tested
const mission = require('./mission.js');   // the job's big plan: milestones, proof, replanning out loud; pure, tested
const verbs = require('./verbs.js');       // what each command may say, checked before it runs; pure, tested
const budget = require('./budget.js');     // a task's steps and minutes, then stop and ask; pure, tested
const intake = require('./intake.js');     // a job asked for in plain words -> the skill that does it; tested
const lookv = require('../vision/look.js');   // a picture sized for reading, and the way back to screen pixels; pure, tested

// ---- the command line ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return (i >= 0 && i + 1 < argv.length && !String(argv[i + 1]).startsWith('--')) ? argv[i + 1] : dflt;
};
const has = (name) => argv.indexOf('--' + name) >= 0;
if (has('help') || !argv.length) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 29).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(argv.length ? 0 : 1);
}
// ---- the kit's .env -----------------------------------------------------------------------------
// Read agent-drive/.env by default so SM_JOIN_KEY (and the relay, and any key) need not be typed on
// every run. Dependency-free, the same shape as the relay's loader: KEY=value, `#` comments, `export`
// tolerated, quotes keep spaces. An environment variable ALREADY SET WINS -- the file only fills what is
// missing, so an inline `SM_JOIN_KEY=… node …` still overrides. `--env <file>` or SM_ENV_FILE picks
// another file. The file is gitignored (it holds a secret); .env.example beside it is committed.
const ENV_FILE = flag('env', (process.env.SM_ENV_FILE || '').trim() || path.join(__dirname, '..', '.env'));
(function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = body.slice(eq + 1).trim();
    const q = val[0];
    if ((q === '"' || q === "'") && val.length > 1 && val[val.length - 1] === q) val = val.slice(1, -1);
    if ((process.env[key] || '') === '') process.env[key] = val;
  }
})(ENV_FILE);

const RELAY = flag('relay', process.env.SM_RELAY_URL || process.env.SM_RELAY || '');
const HOST = String(flag('host', '') || '').trim();
const AGENT = String(flag('agent', 'claude') || 'claude');
const TASK = String(flag('task', '') || '');
const MON = parseInt(flag('mon', '0'), 10) || 0;
const SHOT_OUT = flag('shot', '');
const WANT_OCR = has('ocr');
const LANG = String(flag('lang', '') || '');
const INSECURE = has('insecure');
const CONNECT_MS = Math.max(2000, (parseInt(flag('connect-timeout', '15'), 10) || 15) * 1000);
// DRIVING IS ASKED FOR AT THE DOOR. The card an operator presses names what it grants, so a run that
// intends to click and type has to say so BEFORE anybody answers it -- a grant given for watching
// stays one for watching, and the relay refuses `mouse` and `key` on it for its whole life.
const WANT_CONTROL = has('control');
// RUNNING COMMANDS IS ITS OWN ASK. Separate from --control on purpose: driving the pointer and running a
// command are different powers, so the person approving sees them named separately on the card and can
// grant one without the other. A grant that was not given this can never acquire it (relay: GRANT_SHELL_VERBS).
const WANT_SHELL = has('shell');
// What this visit HOLDS now: what was asked at the start, plus what a person has since allowed on a fresh card
// (`access` -- a grant never grows in place; a new Allow is the only way). Every re-join asks for these again.
// A TERMINAL IS A FOURTH ASK (--terminal), named on the card in its own words: the Terminal panel's shell, shared
// with everyone watching -- never implied by --shell (one command, one result) or by the keyboard and mouse.
const WANT_TERM = has('terminal');
let grantControl = WANT_CONTROL, grantShell = WANT_SHELL, grantTerm = WANT_TERM;
const OPEN_URL = String(flag('open', '') || '');
const CLICK = String(flag('click', '') || '');
const SCROLL = String(flag('scroll', '') || '');   // "notches[@x,y]" -- negative scrolls the page DOWN
const FILL = String(flag('fill', '') || '');       // a JSON file: { rect:{x,y,w,h}, cells:[[row,col,digit],...] }
// HOLD THE GRANT AND TAKE INSTRUCTIONS. Everything else here is one-shot: join, act, leave -- which is
// right for "open this page" and useless for anything that has to LOOK between moves, because each run
// raises a fresh card and asks a person to press it again. A game is the obvious case: you cannot plan
// move two until you have seen what move one uncovered. In serve mode the session stays up and reads
// commands from a file, so one consent covers the whole episode rather than one move of it.
const SERVE = String(flag('serve', '') || '');
// --parent-pid <pid>: the program driving this visit (mcp/server.js passes its own); if it dies, the grant is handed back
const PARENT_PID = parseInt(flag('parent-pid', '0'), 10) || 0;
// A one-line hello posted to the host's session chat the moment serving begins, so the watchers know
// who just took the wheel and why before anything moves. --no-announce suppresses it; --announce "<t>"
// overrides the default drawn from --task. Serve mode only.
const NO_ANNOUNCE = has('no-announce');
// --no-idle / SM_AGENT_IDLE=0: keep receiving the video stream like a person would (the serve pauses it by default)
const KEEP_CAPTURES = has('keep-captures') || /^(1|true|yes|on)$/i.test(String(process.env.SM_KEEP_CAPTURES || '').trim());
// --type-instant / SM_TYPE_HUMAN=0: type at machine speed unless a command says human:1 (the default is LIKE A PERSON)
const TYPE_HUMAN = !(has('type-instant') || /^(0|false|no|off)$/i.test(String(process.env.SM_TYPE_HUMAN || '').trim()));
const NO_IDLE = has('no-idle') || /^(0|false|no|off)$/i.test(String(process.env.SM_AGENT_IDLE || '').trim());
// --no-drafts / SM_SKILL_DRAFTS=0: a planned job that finishes proven is NOT saved as a draft skill (drive/replay.js)
const NO_DRAFTS = has('no-drafts') || /^(0|false|no|off)$/i.test(String(process.env.SM_SKILL_DRAFTS || '').trim());
const ANNOUNCE = String(flag('announce', '') || '');
// (the guard that these need --control lives below, with the other validations: `die` is a const and
// this line used to sit above it, so the one invocation error it exists to report crashed in the
// temporal dead zone instead of printing)
const QUIET = has('quiet');
// STANDING YES at the confirm gate (serve mode). Off by default, so `confirm` keeps waiting for a human
// and a silent window stays `unclear` (a real restart treats that as no). With --auto-confirm, or
// SM_AUTO_CONFIRM set truthy in the environment / kit .env, the operator has pre-approved these before
// stepping away: the agent STILL announces the action and STILL waits the window, and a "stop/no/wait"
// STILL wins at any point -- only SILENCE flips from `unclear` to `approved`, so the agent proceeds
// instead of stalling with nobody there to type "yes". This is the "you don't need to ask me for these"
// standing consent that etiquette.md and plan 05 describe, made mechanical. It never touches the door:
// a person still pressed Allow to grant control/shell in the first place.
const AUTO_CONFIRM = has('auto-confirm') || /^(1|true|yes|on)$/i.test(String(process.env.SM_AUTO_CONFIRM || '').trim());
// A TASK'S BUDGET (core/budget.js): this many acting steps and minutes, then the agent stops and asks the room
// whether to go on. --budget-steps / SM_BUDGET_STEPS and --budget-min / SM_BUDGET_MIN; 0 turns one off. The
// defaults are a lost agent's half hour -- at the measured 46 s a decision, 30 minutes is about forty of them.
const budgetNum = (f, env, dflt) => { const v = flag(f, '') !== '' ? flag(f, '') : (process.env[env] || '').trim(); const n = Number(v); return v !== '' && Number.isFinite(n) && n >= 0 ? n : dflt; };
const BUDGET_STEPS = budgetNum('budget-steps', 'SM_BUDGET_STEPS', 100);
const BUDGET_MIN = budgetNum('budget-min', 'SM_BUDGET_MIN', 30);
let KEY = process.env.SM_JOIN_KEY || '';
if (flag('key', '')) {
  KEY = flag('key', '');
  console.error('[!] --key puts the secret in your shell history; prefer SM_JOIN_KEY in the environment.');
}
const die = (code, msg) => { console.error('[x] ' + msg); process.exit(code); };
if (!RELAY) die(1, 'no --relay. Give the relay\'s WebSocket address, e.g. wss://relay.example:443');
if (!/^[0-9]{5}$/.test(HOST)) die(1, 'no --host, or not a five-digit machine number (got "' + HOST + '")');
if (!KEY) die(1, 'no SM_JOIN_KEY in the environment. The relay must be given the same secret, or it answers "off".');
if ((OPEN_URL || CLICK || SCROLL || FILL) && !WANT_CONTROL) die(1, '--open, --click, --scroll and --fill need --control, which is what the person is asked to allow.');
// --serve without --control is a WATCH-ONLY visit: looking, reading and talking work, and an acting verb is refused
// with needs:'control' -- {"do":"access","control":1} asks the operator for the keyboard and mouse on a new card.
const NEEDS_CONTROL = new Set(['click', 'clicks', 'dbl', 'right', 'clickText', 'keys', 'press', 'chord', 'open', 'scroll', 'stroke', 'strokes', 'lock']);
// STDERR, so that STDOUT carries only the OCR payload and the script can be piped into something that
// parses it. console.log here put the chatter in with the JSON, which is exactly the shape of bug that
// makes a tool unusable in a pipeline while looking fine to a person.
const say = (...a) => { if (!QUIET) console.error(...a); };
// A terminal's output with its control sequences taken out -- colours, cursor moves, a repaint's ESC[H/ESC[K, the
// title an OSC sets -- so what comes back is the text a person would read in the panel. CRLF becomes LF.
const stripAnsi = (t) => String(t == null ? '' : t)
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')   // OSC: ESC ] ... BEL / ST (a window title)
  .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')            // CSI: ESC [ params final
  .replace(/\x1b[@-Z\\-_]/g, '')                        // the two-byte escapes
  .replace(/\r\n/g, '\n').replace(/\r/g, '');

// ---- just enough WebSocket -----------------------------------------------------------------------
// Client frames MUST be masked and server frames never are (RFC 6455); a server that is handed an
// unmasked frame is entitled to close the connection, which reads as "the relay hung up".
// A RELAY WHOSE NAME STOPPED RESOLVING (relay-addr.js): every reconnect that gave up so far gave up on DNS while the
// relay was up. Dial the address the name last pointed to (or the one an sslip.io name carries); TLS still checks
// the name. SM_RELAY_IPS moves the small file it keeps (tests).
const RELAY_IPS = process.env.SM_RELAY_IPS || relayAddr.DEFAULT_FILE;
async function openRelay(url) {
  try { return await open(url); }
  catch (e) {
    // a lookup that FAILED, or one that hung until the connect deadline (the socket never got as far as connecting)
    const hung = /^opening/.test(String(e.stage || ''));
    if (!relayAddr.dnsFailed(e) && !hung) throw e;
    let host = '';
    try { host = new URL(url.replace(/^ws/, 'http')).hostname; } catch (_) { throw e; }
    if (net.isIP(host)) throw e;
    for (const ip of relayAddr.fallbacks(host, RELAY_IPS)) {
      say('[.] ' + host + (hung ? ' did not connect in time' : ' does not resolve (' + e.code + ')') + ' -- dialling the address it last had, ' + ip + ' (the certificate is still checked against ' + host + ')');
      try { return await open(url, ip); } catch (e2) { say('[x] ' + ip + ': ' + e2.message); }
    }
    throw e;
  }
}
// `via`: an IP to dial INSTEAD of looking the name up (relay-addr.js). The name still goes in the TLS handshake
// and the Host header, and the certificate is still checked against the name -- only the lookup is skipped.
function open(url, via) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url.replace(/^ws/, 'http')); } catch (_) { return reject(new Error('cannot read that relay address')); }
    const secure = /^wss:/i.test(url) || u.protocol === 'https:';
    const port = Number(u.port) || (secure ? 443 : 80);
    const opts = { host: via || u.hostname, port, servername: u.hostname };
    if (secure && INSECURE) opts.rejectUnauthorized = false;
    // A DEADLINE ON GETTING IN, AND IT NAMES WHICH STAGE STALLED. Without this the script waits for
    // ever: measured against a relay whose address accepted TCP in 260 ms and then answered nothing at
    // all -- not TLS with any SNI, ALPN or version, and nothing on port 80 either. That is what a box
    // with something in front of it completing the handshake and never passing the traffic on looks
    // like, and "hung with no output" is the worst possible way to report it.
    let stage = secure ? 'opening a TCP connection' : 'opening a connection';
    const sock = (secure ? tls : net).connect(opts, () => {
      stage = 'asking for a WebSocket';
      sock.write('GET ' + (u.pathname === '/' ? '/view' : u.pathname) + ' HTTP/1.1\r\n' +
                 'Host: ' + u.hostname + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
                 'Sec-WebSocket-Version: 13\r\n\r\n');
    });
    if (secure) sock.on('connect', () => { stage = 'completing the TLS handshake'; });
    sock.setNoDelay(true);
    sock.setTimeout(CONNECT_MS);
    sock.on('timeout', () => {
      // CLEARED the moment the WebSocket is up: past that point a quiet socket is the NORMAL state --
      // this script spends most of its life waiting for a person to press Allow.
      if (up) { sock.setTimeout(0); return; }
      sock.destroy();
      const err = new Error('the relay never answered while ' + stage + ' (gave it ' + Math.round(CONNECT_MS / 1000) +
                       's). The address may be unreachable from here, or something in front of it is taking the ' +
                       'connection and not passing it on. --connect-timeout <seconds> waits longer.');
      err.stage = stage;      // "opening ..." = the name may never have resolved (a hung lookup); openRelay retries by address
      reject(err);
    });
    let buf = Buffer.alloc(0), up = false, deadReason = null, deadCb = null;
    const waiters = [], queue = [], taps = [];
    // A TAP SEES EVERY MESSAGE, including the ones nothing asked for. `waitFor` only ever finds what
    // it was looking for, so a refusal the client never expected -- the relay answers one per message
    // it will not forward -- piled up unread while the run carried on pressing keys into nothing.
    // A message goes to the FIRST waiter that wants it, whoever is first in line; nobody -> it is queued for the
    // next waitFor. (It used to be offered to the head waiter only: with slices in flight in parallel, an answer
    // that overtook an earlier one waited behind it -- and if that earlier wait timed out, sat queued until some
    // unrelated message happened to arrive.)
    const deliver = (o) => {
      for (const t of taps) { try { t(o); } catch (_) {} }
      const k = waiters.findIndex((w) => { try { return !!w.pred(o); } catch (_) { return false; } });
      if (k < 0) { queue.push(o); return; }
      const w = waiters.splice(k, 1)[0];
      clearTimeout(w.timer); w.done(o);
    };
    // AFTER the socket is up, a death is not fatal on its own: serve mode wants the chance to redial
    // and get a fresh grant (the relay a host sits on drifts, and a move leaves this socket stale). So
    // record WHY it died, wake every pending waitFor with null so nothing hangs, and tell whoever
    // registered onDead. Only a death BEFORE connecting still rejects the open() promise.
    const died = (reason) => {
      if (!deadReason) deadReason = reason;
      for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.done(null); }
      if (deadCb) { try { deadCb(deadReason); } catch (_) {} }
    };
    sock.on('error', (e) => { if (!up) reject(e); else died('the connection failed: ' + e.message); });
    sock.on('close', () => { died('the connection closed'); });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!up) {
        const e = buf.indexOf('\r\n\r\n');
        if (e < 0) return;
        const head = buf.slice(0, e).toString('latin1');
        if (!/^HTTP\/1\.1 101/.test(head)) return reject(new Error('the relay did not accept a WebSocket here (' + head.split('\r\n')[0] + ')'));
        // TCP keepalive so a relay that DIES without a FIN (the half-open socket that stranded a run
        // 2026-10-24) eventually fails the connection -> close -> ws.dead -> reconnect(), instead of a
        // live-looking socket that answers nothing. setTimeout(0) still clears the connect deadline.
        up = true; sock.setTimeout(0); try { sock.setKeepAlive(true, 15000); } catch (_) {}
        relayAddr.remember(u.hostname, sock.remoteAddress, RELAY_IPS);   // where this name pointed, for when it stops resolving
        buf = buf.slice(e + 4); resolve(api);
      }
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op === 0x8) { try { sock.end(); } catch (_) {} return; }
        if (op === 0x9) { try { sock.write(frame(payload, 0xa)); } catch (_) {} continue; }
        // Binary frames are the video a `select` starts. Nothing here decodes them; they are skipped so
        // the stream cannot drown the JSON this script is actually reading.
        if (op === 0x1) { try { deliver(JSON.parse(payload.toString('utf8'))); } catch (_) {} }
      }
    });
    const frame = (body, opcode) => {
      const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      const mask = crypto.randomBytes(4);
      let head;
      if (b.length < 126) head = Buffer.from([0x80 | (opcode || 0x1), 0x80 | b.length]);
      else if (b.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | (opcode || 0x1); head[1] = 0xfe; head.writeUInt16BE(b.length, 2); }
      else { head = Buffer.alloc(10); head[0] = 0x80 | (opcode || 0x1); head[1] = 0xff; head.writeBigUInt64BE(BigInt(b.length), 2); }
      const masked = Buffer.alloc(b.length);
      for (let i = 0; i < b.length; i++) masked[i] = b[i] ^ mask[i % 4];
      return Buffer.concat([head, mask, masked]);
    };
    const api = {
      // A write that throws means the socket is already gone -- let `died` (via close/error) drive the
      // reconnect rather than killing the process from under a half-finished command.
      send: (o) => { try { sock.write(frame(JSON.stringify(o))); } catch (_) {} },
      close: () => { try { sock.end(); } catch (_) {} },
      on: (fn) => { taps.push(fn); },
      waitFor: (pred, ms) => new Promise((res) => {
        const i = queue.findIndex(pred);
        if (i >= 0) return res(queue.splice(i, 1)[0]);
        const w = { pred, done: res };
        w.timer = setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); res(null); } }, ms || 15000);
        waiters.push(w);
      }),
      // null until the socket dies after connecting, then the reason; serve mode polls this to redial.
      get dead() { return deadReason; },
      set onDead(fn) { deadCb = fn; },
    };
  });
}

// ---- the screenshot, which arrives in slices ------------------------------------------------------
// `shot` answers with the first slice plus the dimensions; `shot-get` fetches the rest by offset. The
// reqId is an ordinary small counter ON PURPOSE: the relay reserves a high range for shots it issues
// itself and refuses a viewer that claims one (forgesAgentReqId), so a "clever" large id is a refusal.
// ...but it starts at a RANDOM point well under that range: the relay drops BOTH answers when two viewers have the
// same reqId in flight, and two agents on one machine both counting from 1 -- now four slices at a time -- collide.
let reqSeq = 1000 + Math.floor(Math.random() * 1e8);
// SLICES: 128 KB, FOUR IN FLIGHT -- the relay's own preview fetch does exactly this. It used to be 32 KB, one at a
// time: a 1080p PNG (~360 KB) was a dozen round trips back to back, and `shot` averaged 5.1 s across 144 calls.
const SLICE = 128 * 1024;
const PARALLEL = 4;
// Fetch bytes [from, to) of held picture `id` into `out`, PARALLEL requests in flight. A host may answer a slice
// SHORT (it clamps `len`, or the relay does); the rest of that range is asked for again, so nothing is assumed
// about the size of an answer -- only that it starts where it was asked to.
async function fetchRange(ws, id, out, from, to, onSlice) {
  const todo = [];
  for (let o = from; o < to; o += SLICE) todo.push([o, Math.min(SLICE, to - o)]);
  let fail = null;
  const worker = async () => {
    while (todo.length && !fail) {
      const [off, len] = todo.shift();
      const rid = ++reqSeq;
      ws.send({ type: 'shot-get', reqId: rid, id, offset: off, len: Math.max(4096, len) });
      const part = await raceStop(ws.waitFor((m) => m.type === 'fs-data' && m.reqId === rid, 30000));
      if (fail) break;
      if (!part) { fail = { ok: false, why: stopped || 'a slice never arrived' }; break; }
      if (part.error) { fail = { ok: false, why: String(part.error), gone: !!part.gone }; break; }
      const b = Buffer.from(String(part.data || ''), 'base64');
      if (!b.length) { fail = { ok: false, why: 'a slice came back empty' }; break; }
      const n = Math.min(b.length, out.length - off);
      b.copy(out, off, 0, n);
      if (onSlice) onSlice(b.length);
      if (n < len) todo.push([off + n, len - n]);    // answered short: the rest of this range goes back on the list
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return fail || { ok: true };
}
// `rect` {x,y,w,h} (screen pixels) asks the host to CUT the picture before encoding it, so a look at a region does not
// carry the whole monitor. A host that can answers with `crop:[x,y,w,h]` (what it actually cut) and the region's
// size; an older one ignores the fields and sends the whole screen -- the caller copes with both.
async function shot(ws, mons, rect) {
  const reqId = ++reqSeq;
  const ask = { type: 'shot', reqId, mons, len: SLICE };
  if (rect && rect.w > 0 && rect.h > 0) Object.assign(ask, { x: Math.round(rect.x) || 0, y: Math.round(rect.y) || 0, w: Math.round(rect.w), h: Math.round(rect.h) });
  ws.send(ask);
  const first = await raceStop(ws.waitFor((m) => m.type === 'fs-data' && m.reqId === reqId, 30000));
  if (!first) return { ok: false, why: stopped || 'the host did not answer the screenshot in time' };
  if (first.error) return { ok: false, why: String(first.error) };
  const total = Number(first.total) || 0;
  if (!total) return { ok: false, why: 'the host answered with no picture' };
  const out = Buffer.alloc(total);
  const head = Buffer.from(String(first.data || ''), 'base64');
  if (!head.length) return { ok: false, why: 'a slice came back empty' };
  head.copy(out, 0, 0, Math.min(head.length, total));
  let trips = 1;
  const r = await fetchRange(ws, first.id, out, Math.min(head.length, total), total, () => { trips++; });
  if (!r.ok) return r;
  const crop = Array.isArray(first.crop) && first.crop.length === 4 && first.crop.every((v) => Number.isFinite(Number(v))) ? first.crop.map(Number) : null;
  return { ok: true, id: first.id, w: Number(first.w) || 0, h: Number(first.h) || 0, png: out, trips, crop };
}

// ---- the visit ending while something is in flight -------------------------------------------------
// Once the relay has refused us, the answer being waited for is never coming. Without this a run that
// had already been told to stop sat out the FULL thirty-second timeout on each request still in the
// air -- so a revoked grant looked like a hung machine, which is the wrong thing to tell somebody, and
// a plan of forty steps could take twenty minutes to notice it had been shown the door. Every wait
// races the stop, and `null` from either means the same thing to the caller: no answer.
let stopped = null;
const stopWaiters = [];
function stopNow(why) {
  if (stopped) return;
  stopped = String(why || 'the visit ended');
  while (stopWaiters.length) { const f = stopWaiters.shift(); try { f(); } catch (_) {} }
}
function raceStop(p) {
  if (stopped) return Promise.resolve(null);
  return Promise.race([p, new Promise((res) => stopWaiters.push(() => res(null)))]);
}

// ---- a held frame, read in pieces ------------------------------------------------------------------
//
// The old `shot` is the only way this client ever looked at a machine: take a picture and drag every
// byte of it back, ~90 KB over three round trips, for any question at all. That is affordable a
// handful of times and not affordable once per step, which is why every run so far had to act in
// bulk and hope.
//
// The host already offers better and nobody asked. It HOLDS a picture for ten minutes, it will send
// any byte range of it, and it will read the text in any rectangle of it WITHOUT capturing anything
// new. So: ask for a 4 KB slice and keep only the identity (`hold`), then pay per question instead
// of per look -- a rectangle of words, or just enough leading bytes to decode down to the region
// being asked about. `len` is clamped to [4096, 1 MB] host-side, so 4096 is exactly the floor.
const HOLD_LEN = 4096;
async function holdFrame(ws, mons) {
  const reqId = ++reqSeq;
  ws.send({ type: 'shot', reqId, mons, len: HOLD_LEN });
  const first = await raceStop(ws.waitFor((m) => m.type === 'fs-data' && m.reqId === reqId, 30000));
  if (!first) return { ok: false, why: stopped || 'the host did not answer the screenshot in time' };
  if (first.error) return { ok: false, why: String(first.error) };
  const total = Number(first.total) || 0;
  if (!total) return { ok: false, why: 'the host answered with no picture' };
  const head = Buffer.from(String(first.data || ''), 'base64');
  return { ok: true, id: first.id, w: Number(first.w) || 0, h: Number(first.h) || 0,
           total, buf: head, wire: head.length, trips: 1 };
}

// Pull more of the held picture, up to `want` bytes -- in parallel slices, like `shot`.
async function fetchTo(ws, f, want) {
  const to = Math.min(want, f.total), from = f.buf.length;
  if (from >= to) return { ok: true };
  const grown = Buffer.alloc(to);
  f.buf.copy(grown, 0, 0, from);
  const r = await fetchRange(ws, f.id, grown, from, to, (n) => { f.wire += n; f.trips++; });
  if (!r.ok) return r;
  f.buf = grown;
  return { ok: true };
}
// A cheap read grows the held picture by at least this much at a time -- a question about the top of the screen
// should still cost a few KB, not a full 128 KB slice.
const SEE_STEP = 32 * 1024;

// DECODE ONLY AS FAR AS THE ANSWER. A PNG's rows are one zlib stream in order, so a question about
// the top of the screen is answered by the leading bytes and the rest never crosses the wire. How
// far that gets is a property of the picture, not a promise: a flat desktop compresses so well that
// half the file is most of the screen, a busy one does not, and a rectangle at the very bottom needs
// nearly all of it. So this extrapolates from the rows the bytes in hand actually bought and asks
// for that much more, with the loop as the backstop rather than the estimate.
async function see(ws, f, rect) {
  for (let guard = 0; guard < 24; guard++) {
    const img = eyes.decode(f.buf);
    if (eyes.covers(img, rect) || f.buf.length >= f.total) return { ok: true, img };
    const need = rect ? Math.min(f.h, Math.ceil(rect.y + rect.h)) : f.h;
    const have = Math.max(1, img.rows || 1);
    const want = Math.max(f.buf.length + SEE_STEP, Math.ceil(f.buf.length * (need / have) * 1.15));
    const got = await fetchTo(ws, f, want);
    if (!got.ok) return got;
  }
  return { ok: true, img: eyes.decode(f.buf) };
}

// The words in a rectangle of the held picture -- read by the host's own recognizer, on the machine's
// own lossless pixels, with NO new capture. `pw`/`ph` are the staleness guard: a host restarted since
// the picture was taken counts ids from 1 again, so without them a stale id reads a different screen
// and says nothing about it. With them the answer is `gone:1` and the caller takes a new one.
// TEXT ON EVERY HOST. Windows hosts read with Windows.Media.Ocr, Linux hosts run Tesseract -- and none of the Linux
// hosts driven so far had it, so `ocr`, `find`, `clickText` and every `expect {text}` failed there and each check
// fell back to a picture (more of the driver's turns). The client holds the picture's bytes anyway: when the host
// says it has no text reader, the region is read HERE (vision/local-ocr.js -- Windows.Media.Ocr on a Windows driver,
// tesseract elsewhere) and answered in the host's own shape. A host that has said so once is not asked again.
let hostOcrMissing = false, localOcr = null;
const NO_HOST_OCR = /not installed|no text recognizer/i;
async function readText(ws, f, rect, lang) {
  if (hostOcrMissing) return readTextHere(ws, f, rect, lang);
  const reqId = ++reqSeq;
  const msg = { type: 'shot-ocr', reqId, id: f.id, pw: f.w, ph: f.h };
  if (rect && rect.w > 0 && rect.h > 0) { msg.x = Math.round(rect.x) || 0; msg.y = Math.round(rect.y) || 0; msg.w = Math.round(rect.w); msg.h = Math.round(rect.h); }
  if (lang) msg.lang = String(lang);
  ws.send(msg);
  const a = await raceStop(ws.waitFor((m) => m.type === 'fs-data' && m.reqId === reqId, 30000));
  if (!a) return { ok: false, why: stopped || 'the host did not read it in time' };
  if (a.error && (a.noEngine || NO_HOST_OCR.test(String(a.error)))) {
    hostOcrMissing = true;
    say('[.] the host has no text reader (' + String(a.error).slice(0, 90) + ') -- reading text on this machine instead');
    return readTextHere(ws, f, rect, lang);
  }
  if (a.error) return { ok: false, why: String(a.error), gone: !!a.gone };
  const lines = (a.ocr && a.ocr.lines) || [];
  // WHERE the region was, as the HOST reports it rather than as we asked -- it clamps a region to the
  // picture, so a rectangle that ran off an edge comes back moved, and the word boxes are relative to
  // where it actually read. Adding the asked-for origin instead would aim every click a little wrong.
  const at = { x: Number((a.ocr && a.ocr.x) || 0), y: Number((a.ocr && a.ocr.y) || 0),
               w: Number((a.ocr && a.ocr.w) || 0), h: Number((a.ocr && a.ocr.h) || 0) };
  return { ok: true, lines, at, text: lines.map((l) => l.t).join('\n'),
           words: lines.reduce((n, l) => n + ((l.w && l.w.length) || 0), 0) };
}
// ...the same rectangle, read on THIS machine from the held picture's bytes (decoded only as far down as it needs).
async function readTextHere(ws, f, rect, lang) {
  if (!localOcr) { try { localOcr = require('../vision/local-ocr.js'); } catch (e) { return { ok: false, why: 'the host has no text reader, and none could be loaded here: ' + e.message }; } }
  const want = rect && rect.w > 0 && rect.h > 0 ? rect : { x: 0, y: 0, w: f.w, h: f.h };
  const s = await see(ws, f, want);
  if (!s.ok) return { ok: false, why: s.why, gone: !!s.gone };
  let o;
  try { o = await localOcr.readRegion(s.img, want, { lang }); } catch (e) { o = { ok: false, why: e.message }; }
  if (!o || o.ok === false || !Array.isArray(o.lines)) return { ok: false, why: 'the host has no text reader, and reading it here failed: ' + ((o && o.why) || 'no answer') };
  const lines = o.lines;
  const at = { x: Number(o.x) || 0, y: Number(o.y) || 0, w: Number(o.w) || 0, h: Number(o.h) || 0 };
  return { ok: true, lines, at, text: lines.map((l) => l.t).join('\n'),
           words: lines.reduce((n, l) => n + ((l.w && l.w.length) || 0), 0), here: o.engine || 'local' };
}

// ---- connecting and getting let in ---------------------------------------------------------------
// The join handshake, factored out so the first connection and every reconnect run the SAME path.
// Tries each relay in turn: re-asks on the ones the host is not on (no-host / nobody / slow-down -- a
// host drifts between relays, so "not here" often means "try the next one"), and gives up only on a
// reason retrying cannot fix (off / no / denied). `onCode(code, relay)` fires once a card is on
// somebody's screen, so the caller can surface the number. Returns { ok, ws, user, relay } on success,
// or { ok:false, why, code } where `code` is the exit status a one-shot run should die with.
const NAK_WHY = {
  off: 'this relay has no SM_JOIN_KEY set, so joining is switched off entirely',
  no: 'the relay did not accept that key',
  'no-host': 'no such machine is connected here (an absent, unreachable and private machine all answer this)',
  nobody: 'nobody who can see that machine is connected, so there was no one to ask',
  'slow-down': 'too many requests from here just now; wait and try again',
  denied: 'somebody refused it',
};
async function dialAndJoin(relays, onCode, reconnecting, want) {
  const asks = want || { control: grantControl, shell: grantShell, term: grantTerm };
  let lastWhy = 'could not reach any relay';
  let lastCode = 1;   // the header's exit codes: 1 a transport failure, 2 the relay / nobody let us in, 3 a person said no
  // A mutable QUEUE, not a fixed list: a relay that doesn't have the host can POINT US at its federation
  // siblings (a no-host nak now carries `relays`), so an online machine on a relay OTHER than our default
  // is found without the operator naming relays by hand -- which is exactly the drift the default domain
  // can't track in real time. `tried` dedups and bounds the search (the federation is small; each relay is
  // dialled at most once, and never more than a dozen).
  const queue = relays.map((r) => String(r || '').trim()).filter(Boolean), tried = new Set();
  while (queue.length && tried.size < 12) {
    const relay = queue.shift();
    if (!relay || tried.has(relay)) continue;
    tried.add(relay);
    say('[.] connecting to ' + relay + (reconnecting ? ' (reconnect)' : ''));
    const w = await openRelay(relay).catch((e) => { lastWhy = e.message; say('[x] ' + e.message); return null; });
    if (!w) continue;
    say('[.] asking to join machine ' + HOST + ' (agent tag "' + AGENT + '"; the relay names the visit)');
    w.send({ type: 'join-begin', key: KEY, host: HOST, agent: AGENT, task: TASK, control: !!asks.control, shell: !!asks.shell, term: !!asks.term });
    // The code, then the wait. The code is printed because it is what a person compares against the
    // card on their screen -- an agent that does not show it is asking them to approve on faith.
    const first = await w.waitFor((m) => m.type === 'join-code' || m.type === 'join-nak', 20000);
    if (!first) { lastWhy = 'the relay never answered join-begin (an older relay ignores it silently)'; lastCode = 2; say('[x] ' + lastWhy); w.close(); continue; }
    if (first.type === 'join-nak') {
      const r = String(first.reason || 'refused'), why = NAK_WHY[r] || r;
      if (r === 'no-host' || r === 'nobody' || r === 'slow-down') {
        // The host drifts between federated relays; a no-host can carry the sibling relays to try next.
        let added = [];
        if (Array.isArray(first.relays) && first.relays.length) {
          added = first.relays.map((u) => String(u || '').trim()).filter((u) => u && !tried.has(u) && !queue.includes(u));
          if (added.length) queue.push(...added);
        }
        lastWhy = why; lastCode = 2; say('[.] ' + why + (added.length ? ' -- the relay points to ' + added.length + ' sibling relay(s); trying those' : ' -- trying the next relay')); w.close(); continue;
      }
      w.close(); return { ok: false, why, code: 2, retry: false };   // off / no / denied: retrying will not help
    }
    if (onCode) onCode(first.code, relay);
    const verdict = await w.waitFor((m) => m.type === 'auth-ok' || m.type === 'join-nak' || m.type === 'auth-expired', 150000);
    if (!verdict) { lastWhy = 'nobody answered, and the code expired'; lastCode = 2; say('[x] ' + lastWhy); w.close(); continue; }
    if (verdict.type !== 'auth-ok') {
      if (verdict.type === 'join-nak' && String(verdict.reason) === 'denied') { w.close(); return { ok: false, why: 'refused by a person', code: 3, retry: false }; }
      lastWhy = 'not let in (' + verdict.type + (verdict.reason ? ': ' + verdict.reason : '') + ')'; lastCode = 2; say('[x] ' + lastWhy); w.close(); continue;
    }
    say('[+] let in as "' + verdict.user + '" (role ' + verdict.role + ')');
    // `pv:1` SAYS "monitor-tagged frames will not hurt me", and it is the truth: this client drops
    // every binary frame unread. Without it the relay reads pvOk as false and perMonOn goes
    // WEAKEST-WINS over every real viewer -- an agent joining a two-screen machine would turn
    // per-monitor encoding off for the whole producer. Claiming a capability one does not use is
    // wrong; declining to veto one is not.
    w.send({ type: 'select', id: HOST, pv: 1 });
    const sel = await w.waitFor((m) => m.type === 'access-denied' || m.type === 'host-gone' || m.type === 'chat-roster' || m.type === 'stream-info', 15000);
    if (sel && (sel.type === 'access-denied' || sel.type === 'host-gone')) { lastWhy = 'could not open the machine (' + sel.type + ')'; lastCode = 2; say('[x] ' + lastWhy); w.close(); continue; }
    return { ok: true, ws: w, user: String(verdict.user || 'agent'), relay };
  }
  // "no such machine", "nobody to ask" and an expired code used to exit 3 -- which the header keeps for a person's no
  return { ok: false, why: lastWhy, code: lastCode, retry: true };
}

// ---- the whole run --------------------------------------------------------------------------------
(async () => {
  // Every relay to try, in order: the one named by --relay / SM_RELAY first, then the SM_RELAYS
  // fallbacks (the host drifts between relays, so a move the operator knows about is covered here).
  const RELAYS = [RELAY].concat(String(process.env.SM_RELAYS || '').split(',').map((s) => s.trim()))
    .filter((r, i, a) => r && a.indexOf(r) === i);
  const showCode = (code, relay) => {
    say('[>] code ' + code + ' -- somebody who can see machine ' + HOST +
        (relay && relay !== RELAY ? ' (on ' + relay + ')' : '') + ' has been asked.');
    say('[.] waiting for a person to press Allow (the code expires in about two minutes)...');
  };
  // the code goes in a FILE too (<serve-dir>/join.json), as a reconnect's does: a program driving this
  // (mcp/server.js) reads it there instead of parsing what this prints
  const joinFile = SERVE ? path.join(SERVE, 'join.json') : '';
  const dialed = await dialAndJoin(RELAYS, (code, relay) => {
    showCode(code, relay);
    if (joinFile) { try { fs.mkdirSync(SERVE, { recursive: true }); fs.writeFileSync(joinFile, JSON.stringify({ code, relay, host: HOST, at: Date.now() })); } catch (_) {} }
  }, false);
  if (joinFile) { try { fs.unlinkSync(joinFile); } catch (_) {} }
  if (!dialed.ok) die(dialed.code || 1, dialed.why);
  // `ws` is a `let`: in serve mode a dropped socket is replaced in place by reconnect() below.
  let ws = dialed.ws;
  // This visit's own display name, as the relay settled it. Used in serve mode to tell the operator's
  // chat messages from the agent's own echo (the relay stamps `name` from the account, never the client).
  let selfName = dialed.user;
  // The relay this grant is actually ON -- which may be a federation sibling the first dial drifted to,
  // not RELAY. reconnect() dials THIS first (then the rest), so a drop does not throw away a known-good
  // relay and re-dial the cold default. Refreshed on every successful reconnect.
  let lastGoodRelay = dialed.relay || RELAY;

  // Hand the grant back on the way out however this ends, including Ctrl+C -- a grant that outlives
  // the thing holding it is the failure the relay's own release paths exist to avoid.
  let left = false;
  const leave = () => { if (left) return; left = true; try { ws.send({ type: 'join-leave' }); } catch (_) {} };
  // A DRIVER THAT DIES TAKES THE VISIT WITH IT. Started by a program, the serve checks that program is still there:
  // a parent killed outright on Linux/macOS used to leave the grant held with nobody to drive it.
  if (PARENT_PID) {
    const parentWatch = setInterval(() => {
      try { process.kill(PARENT_PID, 0); } catch (e) {
        if (e && e.code === 'ESRCH') { clearInterval(parentWatch); say('[.] the program driving this visit is gone -- handing the grant back'); try { stopNow('the driver is gone'); } catch (_) {} leave(); setTimeout(() => process.exit(0), 300); }
      }
    }, 2000);
    if (parentWatch.unref) parentWatch.unref();
  }
  process.on('SIGINT', () => { say('\n[.] handing the grant back'); leave(); setTimeout(() => process.exit(0), 300); });
  say('[+] machine ' + HOST + ' is open' + (WANT_CONTROL ? ' (with the keyboard and mouse)' : ' (watching only)') +
      (WANT_SHELL ? ' and may run commands' : ''));

  // AN OLDER RELAY IS SURVIVED, NOT FATAL. The relay answers a verb it will not forward FOR A GRANT with
  // access-denied `why: 'an agent may not do that'` -- which this tap used to read as a revoke and STOP
  // the whole run, at the opening chat hello, on any relay that predated the agent's chat/progress verbs
  // (the "session chat not working at all / connects then leaves" report). Now a verb-refusal only
  // DEGRADES: relayOld() flips a flag so the optional chat/progress frames stop being sent (they can't
  // spam refusals) and driving carries on. A genuine revoke/expiry names a DIFFERENT reason ('that visit
  // has ended' / 'an operator ended this visit'), and a host-access refusal carries an id -- both STOP.
  let relayDegraded = false;
  const relayOld = () => { if (relayDegraded) return; relayDegraded = true;
    say('[.] this relay predates the agent chat/progress verbs -- they will not reach the watchers (driving still works; restart the relay to turn them on)'); };
  const REFUSAL = /\b(may not|not allowed|not permitted)\b/i;   // a GRANT_VERBS refusal, NOT a revoke

  // Re-armed on every socket by attachWatch(). A genuine revoke/expiry or a host-access refusal STOPS the
  // run; a verb-refusal on an older relay only degrades; a plain socket drop reconnects (ws.dead).
  const attachWatch = (w) => w.on((m) => {
    if (m && m.type === 'access-denied') {
      const why = String(m.why || '');
      if (m.id == null && REFUSAL.test(why)) relayOld();
      else stopNow(why || 'the relay refused it');
    } else if (m && m.type === 'host-gone') stopNow('that machine went away');
  });
  attachWatch(ws);

  // ---- driving ---------------------------------------------------------------------------------
  // PACED, NOT BLASTED. Every one of these is an injected event on somebody's desktop; sending them
  // back to back means a chord's modifier can arrive after the key it was meant to hold, and a click
  // can land before the move that aimed it. The host coalesces hover moves but must inject a drag
  // whole, so a press and its release are always a pair with a gap between them.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (action, code, text) => { const m = { type: 'key', action, code }; if (text != null) m.text = text; return m; };
  const tap = async (code) => { ws.send(key('down', code)); await sleep(35); ws.send(key('up', code)); await sleep(45); };
  // `mod` may name SEVERAL modifiers, "ControlLeft+ShiftLeft" (core/verbs.js writes them that way): each is held
  // in order and released in reverse, so Ctrl+Shift+Escape is one chord. Before, the whole string went out as ONE
  // key code the host did not know -- 10002 had to try Ctrl+Shift+Esc as two chords, and neither was it.
  const chord = async (mod, code) => {
    const mods = String(mod || 'ControlLeft').split('+').map((m) => m.trim()).filter(Boolean).slice(0, 4);
    for (const m of mods) { ws.send(key('down', m)); await sleep(30); }
    ws.send(key('down', code)); await sleep(30);
    ws.send(key('up', code)); await sleep(30);
    for (let i = mods.length - 1; i >= 0; i--) { ws.send(key('up', mods[i])); await sleep(i ? 30 : 60); }
  };
  // A character goes out with an EMPTY code and the text, which is the hosts' Unicode path -- the same
  // shape the viewer's auto-typer uses. Sending it by `code` would type whatever that physical position
  // means on the machine's own layout, which is not the same character on any layout but one.
  const typeText = async (s) => { for (const ch of [...s]) { ws.send(key('down', '', ch)); await sleep(14); ws.send(key('up', '', ch)); await sleep(14); } };
  // A SETTLE NOBODY LOOKS AT IS A SLEEP FOR NOTHING. The pause after a click exists so the window has
  // reacted before the next picture is taken -- so it is owed to the PICTURE, not to the click, and
  // paying it at the click meant a plan of twenty clicks sat out nineteen settles that no eye was
  // waiting on (120 ms x 19 = 2.3 s of a 4.8 s plan). It is now recorded and paid in needFrame, which
  // is the one place a picture is ever taken, so a run that never looks never pays and a run that
  // looks pays exactly once. The gaps WITHIN an action -- move before down, down before up -- are not
  // this: they are the ordering the host needs, and they stay.
  let owedSettle = 0;
  const oweSettle = (ms) => { if (ms > owedSettle) owedSettle = ms; };
  const paySettle = async () => { const ms = owedSettle; owedSettle = 0; if (ms > 0) await sleep(ms); };

  // SHOW THE AGENT'S CURSOR TO THE WATCHERS. Injecting a click moves the machine's own pointer, but nothing
  // told the other viewers WHOSE hand it is -- a human driver's cursor is labelled and visible to everyone,
  // while the agent worked invisibly. `spot {k:'m', ctl:1}` is the very "driver's cursor" a controlling
  // viewer broadcasts, so sending it alongside the input makes the agent appear in the viewport as itself,
  // exactly like a real viewer. Display-only: it is fanned to the host's VIEWERS and never to the host, it
  // is already allowed for a grant session (GRANT_VERBS), and x/y are the same normalised 0..1 the input
  // uses. Suppressed on an older relay (relayDegraded) so a refused verb can't loop.
  let ptrAt = 0;
  // where the agent's pointer was last shown (normalised): a spotlight's laser dot sets off from here
  const ptrPos = { x: 0.5, y: 0.5 };
  const showPointer = (x, y, force) => {
    ptrPos.x = x; ptrPos.y = y;
    if (relayDegraded) return;
    const now = Date.now();
    if (!force && now - ptrAt < 60) return;   // a drag sends a point per step; 16/s is smooth, not a flood
    ptrAt = now;
    try { ws.send({ type: 'spot', k: 'm', x, y, ctl: 1 }); } catch (_) {}
  };
  // ...AND ITS SCROLL. A wheel moves no pointer and presses nothing, so the watchers saw the page slide by itself.
  // `spot {k:'w'}` is the frame a driving viewer's page sends for its own wheel, and every viewer draws it as a
  // badge beside the driver's pointer, pointing the way the page went. Its sign is the BROWSER's (dy > 0 is down
  // the page), the opposite of the wheel's own delta (+120 is a notch up). One frame a notch: at this file's 90 ms
  // pace that is about the rate a viewer's page sends at, so the badge stays up for the whole run and no longer.
  // Display-only like showPointer, and dropped without a word by a relay that does not know the kind.
  const showScroll = (x, y, delta) => {
    if (relayDegraded) return;
    try { ws.send({ type: 'spot', k: 'w', x, y, dy: -delta }); } catch (_) {}
  };

  const clickAt = async (px, py, w, h, fast) => {
    // 0.99999 and never 1.0: a coordinate of exactly 1 is a pixel past the edge, or the first pixel of
    // the next monitor on a merged wall.
    // `fast` tightens the gaps for a long run of clicks into KNOWN targets (filling a solved board):
    // still move -> down -> up in order, but with less air between them. Default pacing is unchanged.
    const x = Math.min(Math.max(px / w, 0), 0.99999), y = Math.min(Math.max(py / h, 0), 0.99999);
    showPointer(x, y, true);   // every click is worth showing -- that is the agent's hand moving
    ws.send({ type: 'mouse', action: 'move', x, y }); await sleep(fast ? 32 : 60);
    ws.send({ type: 'mouse', action: 'down', button: 0, x, y }); await sleep(fast ? 24 : 50);
    ws.send({ type: 'mouse', action: 'up', button: 0, x, y }); oweSettle(fast ? 80 : 120);
  };

  // A WHEEL CARRIES ITS OWN POSITION, and that is not decoration: the host routes a wheel to the window
  // under the pointer and ignores x/y unless the message also moves -- measured on a live host as 42
  // notches changing 12 tiles without a move and 32,651 with one. So this aims first, every time.
  if (SCROLL) {
    const m = /^(-?\d+)(?:@(\d+)\s*,\s*(\d+))?$/.exec(SCROLL.trim());
    if (!m) { leave(); die(1, '--scroll wants "notches" or "notches@x,y" (got "' + SCROLL + '")'); }
    const probe = await shot(ws, [MON]);
    if (!probe.ok) { leave(); die(1, probe.why); }
    const px = m[2] ? Number(m[2]) : Math.round(probe.w / 2), py = m[3] ? Number(m[3]) : Math.round(probe.h / 2);
    const x = Math.min(px / probe.w, 0.99999), y = Math.min(py / probe.h, 0.99999);
    const notches = Number(m[1]);
    say('[.] scrolling ' + notches + ' notch(es) at ' + px + ',' + py);
    showPointer(x, y, true);   // the watchers see whose hand it is, and where
    ws.send({ type: 'mouse', action: 'move', x, y }); await sleep(80);
    for (let i = 0; i < Math.abs(notches); i++) {
      const delta = notches < 0 ? -120 : 120;
      ws.send({ type: 'mouse', action: 'wheel', x, y, delta });
      showScroll(x, y, delta);
      await sleep(90);
    }
    await sleep(700);
  }
  if (CLICK) {
    const m = /^(\d+)\s*,\s*(\d+)$/.exec(CLICK.trim());
    if (!m) { leave(); die(1, '--click wants "x,y" in screen pixels (got "' + CLICK + '")'); }
    const probe = await shot(ws, [MON]);            // for the screen's size; the picture itself is discarded
    if (!probe.ok) { leave(); die(1, probe.why); }
    say('[.] clicking ' + m[1] + ',' + m[2] + ' on a ' + probe.w + 'x' + probe.h + ' screen');
    await clickAt(Number(m[1]), Number(m[2]), probe.w, probe.h);
  }
  // FILLING A GRID: click a cell, press a digit, repeat. Paced like everything else here, and ONE cell
  // at a time rather than a burst -- a page that is still settling after the previous entry drops the
  // next click, and a dropped click means the digit lands in whatever cell was selected before, which
  // is a wrong answer rather than a missing one.
  if (FILL) {
    const spec = JSON.parse(fs.readFileSync(FILL, 'utf8'));
    const R = spec.rect || {};
    if (!(R.w > 0 && R.h > 0) || !Array.isArray(spec.cells)) { leave(); die(1, '--fill wants { rect:{x,y,w,h}, cells:[[row,col,digit],...] }'); }
    const probe = await shot(ws, [MON]);
    if (!probe.ok) { leave(); die(1, probe.why); }
    say('[.] filling ' + spec.cells.length + ' cell(s) on a ' + probe.w + 'x' + probe.h + ' screen');
    let n = 0;
    for (const [r, c, d] of spec.cells) {
      const px = R.x + (c + 0.5) * (R.w / 9), py = R.y + (r + 0.5) * (R.h / 9);
      await clickAt(px, py, probe.w, probe.h);
      await typeText(String(d));
      await sleep(70);
      if (++n % 9 === 0) say('    ' + n + '/' + spec.cells.length);
    }
    say('[+] ' + n + ' cell(s) entered');
  }
  if (OPEN_URL) {
    say('[.] opening ' + OPEN_URL);
    await chord('ControlLeft', 'KeyL');             // the address bar
    await sleep(250);
    await typeText(OPEN_URL);
    await sleep(150);
    await tap('Enter');
    await sleep(2500);                              // give the page a moment before any screenshot below
    say('[+] sent');
  }

  if (SHOT_OUT || WANT_OCR) {
    say('[.] taking a screenshot of screen ' + MON);
    const s = await shot(ws, [MON]);
    if (!s.ok) { leave(); die(1, s.why); }
    say('[+] ' + s.w + 'x' + s.h + ', ' + s.png.length + ' bytes');
    if (SHOT_OUT) { fs.writeFileSync(SHOT_OUT, s.png); say('[+] written to ' + SHOT_OUT); }
    if (WANT_OCR) {
      const rid = ++reqSeq;
      // The region is the whole picture, and pw/ph are the dimensions it was measured against: the host
      // counts picture ids per PROCESS, so that pair is the only guard against a restarted host
      // answering about a different picture, and it is only checked when the caller sends it.
      const ask = { type: 'shot-ocr', reqId: rid, id: s.id, x: 0, y: 0, w: s.w, h: s.h, pw: s.w, ph: s.h };
      if (LANG) ask.lang = LANG;
      ws.send(ask);
      const r = await ws.waitFor((m) => m.type === 'fs-data' && m.reqId === rid, 60000);
      if (!r || r.error || !r.ocr) { leave(); die(1, r && r.error ? String(r.error) : 'the text could not be read'); }
      // Printed as JSON on stdout, so this can be piped. Everything else goes to stderr via say().
      process.stdout.write(JSON.stringify(r.ocr) + '\n');
      say('[+] ' + ((r.ocr.lines || []).length) + ' line(s) read in ' + (r.ocr.lang || '?'));
    }
  }

  // ---- serve mode: one grant, many moves ---------------------------------------------------------
  // A command FILE rather than stdin, because this is driven from a shell that may not keep a pipe open
  // across turns, and a file is the one channel both ends can see without either staying attached.
  if (SERVE) {
    const dir = SERVE;
    fs.mkdirSync(dir, { recursive: true });
    const cmdFile = path.join(dir, 'cmd.json'), outFile = path.join(dir, 'done.json');
    // THE ANSWER IS WRITTEN WHOLE: to a temp file, then renamed over done.json -- a reader can never catch it half
    // written (it used to be written in place, so a fast reader re-read until it parsed). A rename Windows refuses
    // while someone has the file open is retried, as core/cmd-file.js does for cmd.json; then written in place.
    const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const writeOut = (obj) => {
      const txt = JSON.stringify(obj), tmp = outFile + '.tmp';
      try { fs.writeFileSync(tmp, txt); } catch (_) { fs.writeFileSync(outFile, txt); return; }
      for (let i = 0; ; i++) {
        try { fs.renameSync(tmp, outFile); return; } catch (e) {
          if (i >= 100 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch (_) {} fs.writeFileSync(outFile, txt); return; }
          pauseSync(20);
        }
      }
    };
    try { fs.unlinkSync(cmdFile); } catch (_) {}
    // INCOMING CHAT -> an append log the driver reads between steps, the mirror of done.json. A tap
    // sees every frame, so a message said in this host's session -- the room, or a DM addressed to us
    // -- is caught whether or not a `chat-wait` happens to be parked on it. One JSON line each; `mine`
    // marks the agent's own echo, `system` the relay's own notices.
    const chatFile = path.join(dir, 'chat.json');
    try { fs.unlinkSync(chatFile); } catch (_) {}
    // Ids of operator messages not yet marked read, so `seen` can post a read receipt for them. A "Claude
    // typing..." ping and the receipt are what make the agent read as a real participant when it answers
    // mid-task; both are logged into chat.json's `id` so the driver can target one if it wants.
    let unreadIds = [];
    let typingTimer = 0;
    const stopTyping = () => { if (typingTimer) { clearInterval(typingTimer); typingTimer = 0; } };
    // FIX 3 -- the agent must SEE and HONOR the operator. `interrupt` is set the moment an operator (not
    // the agent, not the relay) speaks, and the command loop / runSteps break on it so a long plan stops
    // and the driver answers at once. `lastOp` is the newest such message, surfaced in EVERY done.json as
    // `inbox` so a speed-focused driver cannot run the next command without seeing the pending mail.
    let interrupt = null, lastOp = null;
    const serveStart = Date.now();
    // THE PICTURES A VISIT TAKES LEAVE WITH IT. Every full-size capture used to stay in the work folder for good --
    // 10002's held about two dozen, two personal mailboxes among them. Each picture the serve writes (shot, look)
    // and each one posted from the work folder is listed in captures.json, and the list is deleted when the visit
    // ends, however it ends. --keep-captures (or SM_KEEP_CAPTURES=1) keeps them all; keep:1 on a shot/look keeps that
    // one. A list a crashed run left behind is cleared when the next visit starts in the same folder.
    const capFile = path.join(dir, 'captures.json');
    const captures = new Set();
    const inDir = (f) => { const r = path.relative(path.resolve(dir), path.resolve(String(f))); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
    const capture = (file, keep) => {
      if (!file || keep || KEEP_CAPTURES) return;
      const f = path.resolve(String(file));
      if (f === path.resolve(capFile) || captures.has(f)) return;
      captures.add(f);
      try { fs.writeFileSync(capFile, JSON.stringify([...captures], null, 1)); } catch (_) {}
    };
    const clearCaptures = () => {
      let n = 0;
      for (const f of captures) { try { fs.unlinkSync(f); n++; } catch (_) {} }
      captures.clear();
      try { fs.unlinkSync(capFile); } catch (_) {}
      return n;
    };
    if (!KEEP_CAPTURES) {
      try { for (const f of JSON.parse(fs.readFileSync(capFile, 'utf8'))) if (typeof f === 'string') captures.add(f); } catch (_) {}
      if (captures.size) { const n = clearCaptures(); if (n) say('[.] removed ' + n + ' picture(s) an earlier visit left in ' + dir); }
      process.on('exit', () => { const n = clearCaptures(); if (n) { try { console.error('[.] removed the ' + n + ' picture(s) this visit took (--keep-captures keeps them)'); } catch (_) {} } });
    }
    // The cost ledger (actions, bytes, round trips). Defined HERE -- before sendDrive's first call (the
    // opening drive-status) -- so sendDrive's live metrics and the loop's per-step record share it.
    let wire = 0, trips = 0;
    const ledger = [];
    const readInbox = () => {
      let lines = []; try { lines = String(fs.readFileSync(chatFile, 'utf8')).trim().split(/\n+/); } catch (_) { return []; }
      const out = [];
      for (const ln of lines) { let r; try { r = JSON.parse(ln); } catch (_) { continue; }
        if (r && !r.mine && !r.system && r.text) out.push({ id: r.id || '', name: r.name || '', text: String(r.text), ts: r.ts || 0, dm: !!r.to }); }
      return out.slice(-20);
    };
    // the kit's skills, read once per visit for skillAsked (a new skill mid-visit is seen by the next visit)
    let skillList = null;
    const skillAsked = (text) => {
      try {
        if (!skillList) skillList = intake.skills();
        const p = intake.parse(String(text || ''), skillList);
        return p && p.skill ? { slug: p.skill.slug, name: p.skill.name, run: p.skill.run || undefined, readme: 'skills/' + p.skill.slug + '/README.md' } : null;
      } catch (_) { return null; }
    };
    const onChat = (o) => {
      if (!o || o.type !== 'chat') return;
      const rec = { ts: Number(o.ts) || Date.now(), id: String(o.id || ''), from: String(o.from || ''), name: String(o.name || ''),
                    text: String(o.text || ''), to: o.to ? String(o.to) : '',
                    mine: String(o.name || '') === selfName, system: !!o.system };
      if (!rec.mine && !rec.system && rec.text) {
        if (rec.id) unreadIds.push(rec.id);
        lastOp = { id: rec.id, name: rec.name, text: rec.text, ts: rec.ts, dm: !!rec.to };
        // A NEW JOB IN PLAIN WORDS ("now do my sticky notes")? The skill that already does it rides the inbox, so the
        // driver reads it before working the job out from nothing (core/intake.js; a "yes" or a "thanks" names none)
        const sk = skillAsked(rec.text);
        if (sk) lastOp.skill = sk;
        interrupt = lastOp;   // a running plan / command loop breaks so the driver can read + answer this
      }
      // The agent's OWN lines are logged where they are sent (with what they were: a finish report, a picture, a
      // mission note); the relay's echo of each one was logged a second time here, so chat.json said everything twice.
      if (!(rec.mine && !rec.system)) { try { fs.appendFileSync(chatFile, JSON.stringify(rec) + '\n'); } catch (_) {} }
      // THE PANEL'S STOP BUTTON posts a message that starts with the no-entry mark (⛔ U+26D4). Only the
      // button sends that mark (typing "stop" does not), so it is an unambiguous "end this now" from
      // someone watching, and the client honours it ITSELF -- stopNow ends the run and hands control back --
      // rather than only setting an interrupt the driver has to notice (which is why Stop "did nothing"
      // when the driver was busy). Plain "stop" TEXT stays a judgement call for the driver.
      if (!rec.mine && !rec.system && /^\s*⛔/.test(rec.text)) stopNow('the operator pressed Stop in the panel');
      // THE SIGN-OFF QUESTION answered. When a task finishes the client posts "… shall I sign off?" (the
      // fin edge below) and the panel sits GREEN (lastDrive.fin === 1). If the operator answers THAT with a
      // sign-off while it is still green, honour it HERE the same self-handled way as Stop -- otherwise the
      // answer is lost whenever the driver has ended its turn instead of chat-waiting, which is exactly when
      // a finished run sits idle and deaf (the reported bug). Gated on fin === 1 so it never ends live work,
      // and the matcher (core/signoff.js) refuses a deferral / negation / "do more first" reply.
      // A bare "yes" counts only while that question is still the LAST thing the agent asked: once it has
      // asked anything else since ("shall I restart it too?"), "yes" answers THAT -- a review found it ending
      // the session -- and only an unmistakable phrase ("sign off", "bye") is honoured.
      else if (!rec.mine && !rec.system && lastDrive.fin === 1 && signoff.isSignoffReply(rec.text, { affirm: signoffAsked })) {
        try {
          stopTyping();
          const bye = 'Signing off — thanks for the session! Handing control back now. 👋';
          ws.send({ type: 'chat', text: bye });
          fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text: bye, mine: true, sent: true }) + '\n');
        } catch (_) {}
        stopNow('the operator asked to sign off in chat');
      }
    };
    // TELLING THE WATCHERS WHAT IT IS DOING. `drive-status` is one short line the relay fans out to this
    // host's viewers as `agent-drive`, so they see the machine being driven in words rather than guessing
    // from the moving cursor. Sent before each acting step below; an explicit `intent` on the command, or
    // the `status` verb, overrides the default phrase. Cleared for everyone when the grant is handed back.
    // What the viewers' progress panel shows: the live line (`text`) and, optionally, the whole PLAN --
    // an ordered list of short step labels (`steps`) and which one is current (`at`) -- so the panel can
    // show the steps ahead and the next one, not only the action now. `lastDrive` holds the merged state
    // so the 12s heartbeat (keepAlive) and any plain narration re-send the FULL picture, and the panel
    // holds until the task ends rather than blinking out during a long step or a thinking pause.
    // driveStatus(text, {steps, at}): `text` undefined keeps the current line (e.g. advancing `at` only);
    // `steps` replaces the plan; `at` moves the current step. Any of them may come on its own.
    // (`over` is local only, never sent: the tool tree or flat plan in charge has FINISHED -- see retire)
    let lastDrive = { text: '', steps: null, at: null, thought: null, next: null, stat: null, sub: null, subAt: null, conf: null, warn: null, tree: null, fin: 0, say: null, over: 0 };
    // The client's own "…shall I sign off?" is the last thing the agent asked the room (set at the fin edge,
    // cleared by anything it says or does after). The panel's green (`fin`) outlives it -- a chat-wait for the
    // answer to a NEW question keeps the panel green -- so the sign-off gate in onChat keys on this instead.
    let signoffAsked = false;
    // THE RESULT PICTURE. Reported from live runs, more than once: a task finished on a text report alone, with
    // no picture of its result -- the operator wants to SEE each outcome, and that was left to the driver
    // remembering. So the client keeps count: a picture posted to chat during a task (chat-img, or `file` on the
    // status that finishes it) covers it; a task that FINISHES without one owes it, and every answer carries
    // `remind` while that finished task is still the one on show. A nudge to the driver; the room never sees it.
    let picShown = false, picOwed = false, finImg = null;
    // THE ACTION TREE (core/action-tree.js). Reported from a live run: ~380 actions reached the watchers as
    // a flat feed of "Typing" / "Clicking" / "Pressing Enter" -- no task, no sub-steps, "useless action
    // names". The panel renders a deep timed tree, but only a TOOL ever sent one; ad-hoc driving fell back
    // to the verb feed. So when no explicit tree or flat plan is in charge, this loop builds the tree from
    // what it actually runs: task > step > sub-step > merged, described action groups > the live action.
    // `status {task|step|substep}` name the levels; a pause shows "Planning the next step". An explicit
    // tree (run.js / plan.js / a skill) or a flat plan still wins outright -- this only fills the vacuum.
    const AT = actionTree.create({ task: TASK || ('Driving machine ' + HOST) });
    const planOn = () => Array.isArray(lastDrive.steps) && lastDrive.steps.length > 0;
    const atAuto = () => !lastDrive.tree && !planOn();
    const AT_GAP = 250, AT_IDLE = 2500;      // at most ~4 tree frames a second; a burst ends after 2.5 s of quiet
    let atLastSend = 0, atSendTimer = 0, atIdleTimer = 0, atBroke = false, treeOut = false;
    // The tree is display-only, so a fault in it must never take the session (and the grant) down with it:
    // every call goes through here, the first fault is logged, and the drive carries on without it.
    const atx = (fn, dflt) => { try { return fn(); } catch (e) { if (!atBroke) { atBroke = true; say('[!] action tree: ' + ((e && e.message) || e)); } return dflt; } };
    // A tool tree or flat plan the driver has moved on from, retired into the action tree's history as one
    // done row ("Ran: …"), so whatever comes next is the action tree's again instead of reviving it as live.
    const retire = () => {
      atx(() => { if (lastDrive.tree) AT.adopt(lastDrive.tree); else if (planOn()) AT.adopt(actionTree.planToTree({ steps: lastDrive.steps, fin: 1 })); });
      lastDrive.tree = null; lastDrive.steps = null; lastDrive.at = null; lastDrive.sub = null; lastDrive.subAt = null; lastDrive.stat = null; lastDrive.fin = 0; lastDrive.over = 0;
      signoffAsked = false;
    };
    // THE JOB'S PLAN (core/mission.js, the `mission` verb). Reported: "if I give you a task, you make a big plan
    // ... each plan has its short plan, and each short plan has its actions; the plan can be changed or added
    // when you face a new situation; achieving the milestone is the most important thing." The plan is kept
    // HERE, not in the driver's head: milestones that say when they are done, their short steps, proof before
    // anything counts as achieved, and every change said out loud. The panel draws it (the action tree in plan
    // mode), the room hears it, mission.json keeps it, and every answer carries where the job stands.
    const MS = mission.create();
    // THE TASK'S BUDGET (core/budget.js): acting steps and minutes, then stop and ask. A new task starts it again --
    // a mission's plan, a status naming another task, new work after a finish. `budgetAskedAt`: when the room was
    // last asked to let a spent budget go on, so `budget {more:1}` hears an answer they already gave.
    const BUD = budget.create({ steps: BUDGET_STEPS, minutes: BUDGET_MIN });
    BUD.start(TASK);
    let budgetAskedAt = 0;
    const newTask = (name) => { BUD.start(name || ''); budgetAskedAt = 0; };
    const missionFile = path.join(dir, 'mission.json');
    // EVERY SUCCESSFUL COMMAND, AS SENT, for drive/replay.js -- one JSON line each with the milestone that was
    // current, so a proven job can run again with no driver turns. Only what DOES something on the machine or
    // checks it (talk, panel, files and access are the driver's own business). A secret's text is never kept,
    // and a click aimed in a look's pixels is kept as the screen point it hit (a replay has no look to map from).
    const stepsFile = path.join(dir, 'steps.jsonl');
    const REPLAYABLE = new Set(['click', 'clicks', 'dbl', 'right', 'clickText', 'keys', 'press', 'chord', 'open', 'scroll',
      'stroke', 'strokes', 'pause', 'find', 'expect', 'wait', 'plan', 'probe', 'see', 'ocr', 'census', 'flood', 'mark',
      'diff', 'hold', 'liveness', 'spotlight', 'beam', 'spotlight-off']);
    const redact = (c, r) => {
      if (!c || typeof c !== 'object') return c;
      const o = {};
      for (const k of Object.keys(c)) if (k !== '__vetted' && k !== 'look' && k !== 'intent' && k !== 'quiet') o[k] = c[k];
      if (o.secret && typeof o.text === 'string') o.text = '{{secret}}';
      if (o.secret && typeof o.url === 'string') o.url = '{{secret}}';
      if ((o.lx != null || o.ly != null) && r && Array.isArray(r.at)) { o.x = r.at[0]; o.y = r.at[1]; delete o.lx; delete o.ly; delete o.dx; delete o.dy; }
      for (const k of ['steps', 'then', 'else']) if (Array.isArray(o[k])) o[k] = o[k].map((x) => redact(x, null));
      return o;
    };
    const recordStep = (cmd, r, m) => {
      if (!REPLAYABLE.has(cmd.do)) return;
      try { fs.appendFileSync(stepsFile, JSON.stringify({ at: new Date().toISOString(), m, cmd: redact(cmd, r) }) + '\n'); } catch (_) {}
    };
    let missionFinishing = false;   // the job's own finish (not a tool's, mid-job) is going out
    let missionReplay = false;      // the job under way is a replay of a saved skill (drive/replay.js): never re-drafted
    const saveMission = () => { try { const j = MS.toJSON(); if (j) fs.writeFileSync(missionFile, JSON.stringify(j, null, 1)); } catch (_) {} };
    // sendDrive attaches the whole picture: the line + the plan + the optional thought/next/per-step
    // status + FREE client-side metrics (elapsed base `since`, and `m` = actions/KB/round-trips from the
    // ledger the loop already keeps). `since`/`m` change only when work happens, so an idle 12s heartbeat
    // is byte-identical and the viewer's dedup suppresses the repaint. Suppressed entirely on an older
    // relay (relayDegraded) so a refused frame can't loop. The relay drops any field it doesn't allow.
    const sendDrive = () => {
      // ...and nothing once the grant has been handed back: a late frame (a pending trailing send, the pause
      // detector, the heartbeat) after join-leave revived the cleared panel, and the relay replays the last
      // frame to everyone who opens the machine afterwards.
      if (relayDegraded || left) return;
      const m = { type: 'drive-status', text: lastDrive.text, since: serveStart,
                  m: { n: ledger.length, kb: Math.round(wire / 1024), rt: trips } };
      if (lastDrive.steps) m.steps = lastDrive.steps;
      if (lastDrive.at != null) m.at = lastDrive.at;
      for (const k of ['thought', 'next', 'stat', 'conf', 'warn']) if (lastDrive[k] != null) m[k] = lastDrive[k];
      if (lastDrive.sub) { m.sub = lastDrive.sub; if (lastDrive.subAt != null) m.subAt = lastDrive.subAt; }
      if (lastDrive.tree) m.tree = lastDrive.tree;
      else if (atAuto()) { const t = atx(() => AT.hasContent() ? AT.render() : null, null); if (t && t.length) m.tree = t; }   // the action tree
      // A FLAT plan once any tree has been on screen rides as a tree too: the viewer keeps the last tree it
      // got until a frame carries another, so a plain plan would never reach anyone already watching.
      else if (treeOut) {
        const t = atx(() => actionTree.planToTree({ steps: lastDrive.steps, at: lastDrive.at, text: lastDrive.text, sub: lastDrive.sub,
                                                     subAt: lastDrive.subAt, stat: lastDrive.stat, fin: lastDrive.fin }), null);
        if (t && t.length) m.tree = t;
      }
      if (m.tree) treeOut = true;
      if (lastDrive.fin) m.fin = 1;   // display-only "this task finished" (panel goes green) -- NOT a hang-up
      atLastSend = Date.now();
      try { ws.send(m); } catch (_) {}
    };
    // A typed word is one command per character, so the tree changes faster than anyone can read: send at
    // most one frame per AT_GAP, the newest state always following within it (leading + trailing).
    const atSend = () => {
      const wait = AT_GAP - (Date.now() - atLastSend);
      if (wait <= 0) { if (atSendTimer) { clearTimeout(atSendTimer); atSendTimer = 0; } sendDrive(); return; }
      if (!atSendTimer) { atSendTimer = setTimeout(() => { atSendTimer = 0; sendDrive(); }, wait); if (atSendTimer.unref) atSendTimer.unref(); }
    };
    // Re-armed after every command: AT_IDLE of quiet ends the burst (the driver is deciding what next).
    const atArmIdle = () => {
      if (atIdleTimer) clearTimeout(atIdleTimer);
      // (the line follows: "Planning the next step", not the run that just ended, for the screen reader too)
      atIdleTimer = setTimeout(() => { atIdleTimer = 0; if (atAuto() && atx(() => AT.idle(), false)) { atx(() => { lastDrive.text = AT.line(); }); atSend(); } }, AT_IDLE);
      if (atIdleTimer.unref) atIdleTimer.unref();
    };
    // The nested PLAN TREE the agent can send -- {t:label, s?:done|doing|todo|warn, k?:[children]} -- bounded
    // the same way the relay bounds it (depth, siblings, label length) so a runaway tree can't blow a frame.
    const clampTree = (arr, depth) => {
      if (!Array.isArray(arr) || (depth || 0) > 4) return null;
      const out = [];
      for (const node of arr) {
        if (out.length >= 24) break;
        if (!node || typeof node !== 'object') continue;
        const t = String(node.t == null ? '' : node.t).slice(0, 100); if (!t) continue;
        const n = { t };
        const s = String(node.s || ''); if (/^(done|doing|todo|warn)$/.test(s)) n.s = s;
        const k = clampTree(node.k, (depth || 0) + 1); if (k && k.length) n.k = k;
        out.push(n);
      }
      return out.length ? out : null;
    };
    const driveStatus = (text, opts) => {
      if (text != null) lastDrive.text = String(text).slice(0, 200);
      opts = opts || {};
      // An EMPTY plan (or steps:null) clears it -- before, [] stayed set (and truthy) forever, so a driver
      // that once showed a flat plan could never hand the panel back to the action tree.
      if (Array.isArray(opts.steps)) lastDrive.steps = opts.steps.length ? opts.steps.slice(0, 20).map((s) => String(s == null ? '' : s).slice(0, 100)) : null;
      else if (opts.steps === null) lastDrive.steps = null;
      if (opts.at != null) lastDrive.at = Math.max(0, Number(opts.at) || 0);
      if (opts.thought !== undefined) lastDrive.thought = opts.thought ? String(opts.thought).slice(0, 400) : null;
      if (opts.next !== undefined) lastDrive.next = opts.next ? String(opts.next).slice(0, 120) : null;
      if (opts.stat !== undefined) lastDrive.stat = opts.stat ? String(opts.stat).replace(/[^xru!~?.]/g, '').slice(0, 20) : null;
      if (opts.sub !== undefined) lastDrive.sub = Array.isArray(opts.sub) ? opts.sub.slice(0, 8).map((s) => String(s == null ? '' : s).slice(0, 60)) : null;
      if (opts.subAt != null) lastDrive.subAt = Math.max(0, Math.min(8, Number(opts.subAt) || 0));
      if (opts.conf !== undefined) lastDrive.conf = /^(low|med|high)$/.test(String(opts.conf || '')) ? String(opts.conf) : null;
      if (opts.warn !== undefined) lastDrive.warn = opts.warn ? String(opts.warn).slice(0, 140) : null;
      if (opts.tree !== undefined) lastDrive.tree = clampTree(opts.tree);
      // `say`: the report to post in chat when this task finishes -- Markdown, which the viewer (2.162.0+)
      // lays out as blocks for an agent and an older one shows as tidy plain lines. Held until `fin`.
      if (opts.say !== undefined) lastDrive.say = opts.say ? String(opts.say).slice(0, 1800) : null;
      // `fin:1` marks the current task complete so the panel settles GREEN (display-only; the serve stays
      // open, unlike the `done` verb which hangs up). Any later status that doesn't set fin clears it, so
      // starting the next task lifts the green and the panel is live again.
      const wasFin = lastDrive.fin;
      if (opts.fin) lastDrive.fin = 1; else if ('fin' in opts || opts.text != null || opts.steps || opts.tree) lastDrive.fin = 0;
      // ...and a tool tree or flat plan that finished STAYS finished (`over`) after a later line lifts the
      // green, so the next work retires it instead of reviving it as live; a new tree or plan, or an
      // explicit fin:0 ("it is live again"), clears that.
      if (opts.tree !== undefined || opts.steps !== undefined || ('fin' in opts && !opts.fin)) lastDrive.over = 0;
      if (opts.fin && (lastDrive.tree || planOn())) lastDrive.over = 1;
      if (!lastDrive.fin) signoffAsked = false;
      sendDrive();
      // FINISHING SILENTLY IS NOT FINISHING. Reported from a live run: "you've finished the task, but you
      // didn't end with any confirm msg, so I can't give you a sign-out command." The green panel said it
      // was done; the ROOM was never told, and chat is where the operator can answer. `fin` going up is
      // exactly the moment the task completed, so say it once, there, in the one line the caller already
      // wrote for the panel. Once per completion (the 0->1 edge), never on the heartbeat that repeats it.
      // SAID AS A REPORT, NOT A RUN-ON LINE ("msgs you sent through session chat looks not structured"):
      // the caller's own `say` when it wrote one, else the panel's line as a ✓ status line -- and the
      // question on a line of its own, so it reads as the next move rather than the tail of a sentence.
      if (lastDrive.fin && !wasFin) {
        const report = lastDrive.say || ('**✓ ' + String(lastDrive.text || 'Finished.') + '**');
        lastDrive.say = null;
        // A TOOL FINISHING ITS PART OF A PLANNED JOB is not the job finishing: mid-job its report goes to the room
        // without "shall I sign off?" (the plan goes on), and it owes no picture of its own -- the milestone it
        // served is proven when it is achieved.
        const midJob = !missionFinishing && MS.active();
        const line = midJob ? report.slice(0, 2000) : (report + '\n\nAnything else, or shall I sign off?').slice(0, 2000);
        const m = { type: 'chat', text: line };
        // `file`: the result picture rides IN the report -- one message, the proof above the question
        finImg = opts.file ? imgFromFile(opts.file) : null;
        if (finImg && finImg.ok) m.img = { url: finImg.url, name: 'result' + (path.extname(String(opts.file)) || '.png'),
                                           w: Math.max(0, Number(opts.w) || 0), h: Math.max(0, Number(opts.h) || 0) };
        try { stopTyping(); ws.send(m); } catch (_) {}
        const rec = { ts: Date.now(), name: selfName, text: line, mine: true, sent: true, fin: true };
        if (m.img) rec.img = true;
        try { fs.appendFileSync(chatFile, JSON.stringify(rec) + '\n'); } catch (_) {}
        if (!midJob) { signoffAsked = true; picOwed = !(picShown || m.img); picShown = false; }
      }
    };
    // The live line under a FLAT plan's current step -- the one place a single phrase still narrates (a
    // tree owns its own words; with neither, the action tree does). Said WITH what is being done --
    // "Clicking (241,643)", "Pressing Ctrl+L", "Typing 11 characters" -- never a bare verb a watcher can't use
    // (and never the typed text itself unless the command says show:1: every watcher reads this line).
    const NARRATED = new Set(['click', 'clicks', 'dbl', 'right', 'clickText', 'stroke', 'strokes', 'keys', 'press', 'chord',
                              'open', 'scroll', 'plan', 'spotlight', 'beam']);
    const drivePhrase = (cmd) => NARRATED.has(cmd.do) ? atx(() => actionTree.actPhrase(cmd), '') : '';
    // A PREPARED IMAGE -> a bounded inline data: URL for the room. The driver crops a small region to a
    // file (crop.py) and passes its path; this reads it and makes a `data:` URL the relay will accept.
    // No upload flow: the relay caps the inline image at 60000 chars, so an oversized one is rejected
    // here with a clear ask to crop smaller rather than being dropped silently on the wire.
    const imgFromFile = (file) => {
      let buf; try { buf = fs.readFileSync(String(file || '')); } catch (e) { return { ok: false, why: 'cannot read image: ' + e.message }; }
      if (inDir(file)) capture(file);   // a crop made in the work folder for the room leaves with the visit too
      const ext = (String(file).split('.').pop() || '').toLowerCase();
      const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
      const url = 'data:' + mime + ';base64,' + buf.toString('base64');
      if (url.length > 60000) return { ok: false, why: 'image too large for inline chat (' + url.length + ' chars, cap 60000) -- crop smaller or use JPEG', urlLen: url.length };
      return { ok: true, url: url, bytes: buf.length, urlLen: url.length };
    };
    // INCOMING STICKY NOTES -> a live board the driver can read. The agent receives one note frame per
    // note on select and on every change, exactly as a viewer does; this keeps the current board in
    // notesMap and mirrors it to <serve-dir>/notes.json. `note-list` returns it; `note-add`/`note-done`
    // write to it. (The task left as a sticky note IS a task -- look for a skill on its text: node kit.js skills <word>.)
    const notesMap = new Map();
    const notesFile = path.join(dir, 'notes.json');
    const notesSave = () => { try { fs.writeFileSync(notesFile, JSON.stringify([...notesMap.values()])); } catch (_) {} };
    const onNote = (o) => {
      if (!o || o.type !== 'spot' || o.k !== 'note') return;
      const id = typeof o.id === 'string' ? o.id : '';
      if (!id) return;
      if (o.del) { if (id === '*') notesMap.clear(); else notesMap.delete(id); }
      else notesMap.set(id, { id, text: String(o.text || ''), name: String(o.name || ''),
                              x: Number(o.x) || 0, y: Number(o.y) || 0, resolved: !!o.resolved, kind: String(o.kind || 'note') });
      notesSave();
    };
    // Both session taps ride whichever socket is current, re-armed after a reconnect swaps `ws`.
    // THE TERMINAL'S OUTPUT, as it comes -- base64 term-data from the host's one shared shell (the Terminal panel's),
    // kept as a bounded tail with a running count so a command can take exactly what arrived after it was sent.
    const term = { buf: '', total: 0, open: false, busy: false, error: '', exit: null, at: 0 };
    const onTerm = (o) => {
      if (!o || typeof o.type !== 'string' || o.type.indexOf('term-') !== 0) return;
      if (o.type === 'term-data') {
        let t = '';
        try { t = Buffer.from(String(o.data || ''), 'base64').toString('utf8'); } catch (_) { t = ''; }
        term.buf += t; term.total += t.length; term.at = Date.now();
        if (term.buf.length > 200000) term.buf = term.buf.slice(-120000);
      } else if (o.type === 'term-ready') { term.open = true; term.exit = null; term.error = ''; }
      else if (o.type === 'term-exit') { term.open = false; term.exit = Number(o.code); }
      else if (o.type === 'term-error') { term.error = String(o.message || ''); }
      else if (o.type === 'term-busy') { term.busy = !!Number(o.busy); }
    };
    // A PERSON TOOK THE KEYBOARD: while the agent types, the watchers see "SM Agent is auto-typing" (typeAs);
    // one who presses a key then sends `atstop` -- exactly as they would to a colleague's auto-typer -- and the run
    // gives way at its next key.
    let atStopAt = 0;
    const onAtStop = (o) => { if (o && o.type === 'spot' && o.k === 'atstop') atStopAt = Date.now(); };
    const attachTaps = (w) => { w.on(onChat); w.on(onNote); w.on(onTerm); w.on(onAtStop); };
    attachTaps(ws);
    // The size, for 5.5 KB rather than for the whole screen: `hold` keeps the identity of a picture the
    // host is holding and throws the bytes away. Nothing here needed the pixels, and it used to pay for
    // all of them before the first command had even arrived.
    const first = await holdFrame(ws, [MON]);
    if (!first.ok) { leave(); die(1, first.why); }
    const SW = first.w, SH = first.h;

    // THE AGENT DOES NOT WATCH THE VIDEO. Its `select` makes it an ordinary viewer, so the relay sent it every frame
    // (this client drops them unread), kept the host capturing for it with no person watching, and counted its send
    // backlog in the worst-viewer picture-quality vote -- driving over a slow link could lower everyone's picture.
    // So it PAUSES its copy of the stream (`idle`, which a grant may send): pictures still come on request (shot,
    // hold, ocr), and chat, exec and the roster still arrive. A host that cannot take a picture while nobody streams
    // (an Ubuntu Wayland desk: "the screen is not being captured right now") refuses in words -- then the stream is
    // woken for that picture, and paused again once the pictures stop. A `select` (every reconnect) clears a pause.
    let viewPaused = false, repauseTimer = null;
    const WAKE_HOLD_MS = 45000;
    const setPaused = (on) => {
      if (NO_IDLE || viewPaused === on) return;
      viewPaused = on;
      try { ws.send({ type: 'idle', paused: on }); } catch (_) {}
    };
    const pauseSoon = () => {
      clearTimeout(repauseTimer);
      repauseTimer = setTimeout(() => { if (!ws.dead && !stopped) setPaused(true); }, WAKE_HOLD_MS);
      if (repauseTimer.unref) repauseTimer.unref();
    };
    const NOT_CAPTURING = /not being captured/i;
    const picture = async (take) => {
      let r = await take();
      if (r && !r.ok && NOT_CAPTURING.test(String(r.why || '')) && !stopped && !NO_IDLE) {
        say('[.] the host is not capturing with nobody streaming -- waking the stream for this picture');
        setPaused(false);
        for (let i = 0; i < 6 && !stopped; i++) {        // the host opens its capture (and waits up to 10 s for it)
          await sleep(1000);
          r = await take();
          if (r.ok || !NOT_CAPTURING.test(String(r.why || ''))) break;
        }
      }
      if (!viewPaused) pauseSoon();                       // awake: stay so while pictures keep coming, then pause
      return r;
    };
    setPaused(true);
    fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ w: SW, h: SH, host: HOST, at: serveStart }));
    say('[+] serving ' + SW + 'x' + SH + ' — drop a command at ' + cmdFile + ', read ' + outFile);

    // GREET THE ROOM, then raise the banner. One hello to the host's session chat so the watchers know
    // who just took the wheel and why before anything moves, and an opening drive-status so the progress
    // panel appears at once rather than only on the first acting step. --no-announce drops the hello.
    if (!NO_ANNOUNCE) {
      // A greeting laid out like everything else the agent says: who and why, then how to work with it.
      const intro = (ANNOUNCE || ('👋 **Hi — I’m SM Agent, an AI agent here to ' + (TASK || 'help on this machine') + '.**\n' +
                                  '- You’ll see each step on the **progress panel**.\n' +
                                  '- Write here any time — I’ll stop and answer.')).slice(0, 2000);
      try { ws.send({ type: 'chat', text: intro }); fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text: intro, mine: true, sent: true }) + '\n'); } catch (_) {}
    }
    // ...with the task already at the top of the tree, so the panel opens on WHAT this visit is for.
    atx(() => AT.ensureTask());
    try { driveStatus('Connected — getting started'); } catch (_) {}

    // ---- what the agent is currently looking at ----------------------------------------------------
    // One held picture at a time, decoded only as far as something has asked about, and the picture
    // before it kept so "did that change anything?" is answerable without a second capture.
    // `marked` is the baseline `changed` and `stable` are measured against, and it is set ONLY by the
    // `mark` verb. Comparing against "the previous picture" instead would quietly make a slow change
    // invisible: every poll would look much like the one before it while the screen drifted away from
    // where it started. An explicit mark is the difference between "nothing is happening" and
    // "nothing happened in the last 400 ms".
    let frame = null, img = null, before = null, marked = null;
    const ledgerFile = path.join(dir, 'ledger.json');   // wire/trips/ledger are declared above (before sendDrive)

    async function needFrame(force) {
      if (frame && !force) return { ok: true };
      await paySettle();            // the window gets its moment to react, here and nowhere else
      before = img;
      const f = await picture(() => holdFrame(ws, [MON]));
      if (!f.ok) return f;
      wire += f.wire; trips += f.trips;
      // THE COORDINATE SPACE IS PART OF THE PLAN. Every click is a fraction of the screen measured
      // when serving started; if the screen is a different size now, every one of them is aimed at the
      // wrong place and the honest answer is to stop rather than to carry on being slightly wrong.
      if (f.w !== SW || f.h !== SH) { frame = null; return { ok: false, why: 'the screen changed size -- was ' + SW + 'x' + SH + ', now ' + f.w + 'x' + f.h }; }
      frame = f; img = null;
      return { ok: true };
    }
    async function lookAt(rect) {
      const n = await needFrame(); if (!n.ok) return n;
      const was = frame.wire, wt = frame.trips;
      const s = await see(ws, frame, rect);
      wire += frame.wire - was; trips += frame.trips - wt;
      if (s.ok) img = s.img;
      return s;
    }
    // Gather exactly what the expectation needs and no more: words cost one round trip and no decode,
    // pixels cost the leading bytes down to the rectangle. Asking for the wrong one is the difference
    // between a 4 KB question and a 90 KB one.
    async function evaluate(pred) {
      const name = Object.keys(pred || {})[0];
      if (!name) return { ok: false, pred: null, saw: 'no expectation was given' };
      const rect = eyes.rectOf(pred);
      if (name === 'text' || name === 'notext') {
        const n = await needFrame(); if (!n.ok) return { ok: false, pred: name, saw: n.why };
        const r = await readText(ws, frame, rect, LANG);
        trips++;
        if (!r.ok) return { ok: false, pred: name, saw: r.why, stale: !!r.gone };
        return Object.assign(eyes.check(pred, { words: r.text }), { words: r.words });
      }
      const s = await lookAt(rect);
      if (!s.ok) return { ok: false, pred: name, saw: s.why, stale: !!s.gone };
      if ((name === 'changed' || name === 'stable') && !marked) return { ok: false, pred: name, saw: 'nothing to compare against -- `mark` first' };
      return eyes.check(pred, { image: img, before: marked });
    }

    // WHERE THINGS ARE, BY THEIR NAME. `find` reads a region, locates a word and remembers where it
    // is; later steps aim at it by that name. Without it, every button on an unfamiliar screen costs a
    // round trip through whoever is driving -- look, work out the pixels, come back and click them --
    // and that round trip is the slowest thing in the whole system by a wide margin.
    const vars = Object.create(null);
    const aimAt = (cmd) => {
      if (cmd.at) {
        const v = vars[String(cmd.at)];
        if (!v) return { ok: false, why: 'nothing is remembered as "' + cmd.at + '" -- `find` it first' };
        return { ok: true, x: v.cx + (Number(cmd.dx) || 0), y: v.cy + (Number(cmd.dy) || 0) };
      }
      // lx/ly: a point in the LAST LOOK's pixels -- what a model reading that picture answers in. Mapped here,
      // the same way every time, instead of by whoever read it (vision/look.js).
      if (cmd.x == null && cmd.y == null && (cmd.lx != null || cmd.ly != null)) {
        const p = lookv.toScreen(lastLook, cmd.lx, cmd.ly);
        return p.ok ? { ok: true, x: p.x + (Number(cmd.dx) || 0), y: p.y + (Number(cmd.dy) || 0), from: 'look' } : p;
      }
      const x = Number(cmd.x), y = Number(cmd.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, why: 'no point to aim at: give x and y, lx and ly, or at' };
      return { ok: true, x, y };
    };

    // ---- TYPING: like a person unless a command (or --type-instant) says otherwise -- keys, and open's address ----
    // ...AND THE WATCHERS ARE TOLD, as the viewer's own Type window tells them: `spot {k:'at', tot, done}` every two
    // seconds while a run lasts -- their page shows a card "<name> is auto-typing" with its progress, and the relay
    // stamps the name, so it reads "SM Agent" -- and `{k:'at', off:1}` when it ends, however it ends. Typing
    // that took a person's time used to happen with nothing on their screen but the letters. A run gives way the
    // same way the Type window's does: a person who presses a key sends `atstop` (onAtStop) and it stops.
    const AT_CAST_MS = 2000;
    const castTyping = (tot, done, off) => { try { ws.send(off ? { type: 'spot', k: 'at', off: 1 } : { type: 'spot', k: 'at', tot, done }); } catch (_) {} };
    const typeAs = async (text, c, dflt) => {
      const off = c.human === false || c.human === 0 || c.human === '0' || c.human === 'false';
      const human = c.human == null || c.human === '' ? TYPE_HUMAN : !off;
      const speed = ['slow', 'normal', 'fast'].includes(c.speed) ? c.speed : dflt;
      const since = Date.now();
      if (!human && !c.speed) {
        // instant: a card only for a block long enough to be watched (a short word would only flash one)
        const long = text.length >= 40;
        if (long) castTyping(text.length, 0);
        try { await typeText(text); } finally { if (long) castTyping(0, 0, true); }
        return { ok: true, typed: text.length, human: false };
      }
      const at = require('./autotype.js');
      const plan = at.atPlan(text, { human, speed });
      let done = 0, lastCast = Date.now(), r;
      castTyping(plan.total, 0);
      try {
        r = await at.run(plan, (m) => ws.send(m), {
          stop: () => !!stopped || !!(interrupt && (Number(interrupt.ts) || 0) >= since) || atStopAt >= since,
          onStep: (i, s) => {
            done = Math.min(plan.total, Math.max(done, Number(s.src) || 0));
            if (Date.now() - lastCast >= AT_CAST_MS) { lastCast = Date.now(); castTyping(plan.total, done); }
          },
        });
      } finally { castTyping(0, 0, true); }
      if (r.ok) return { ok: true, typed: text.length, ms: Date.now() - since, human, speed };
      const took = atStopAt >= since;
      const why = stopped ? stopped
                : took ? 'a person took the keyboard (a viewer pressed a key) -- stopped after ' + done + ' of ' + plan.total + ' characters'
                : 'the operator spoke -- stopped after ' + r.at + ' of ' + r.of + ' keys';
      return { ok: false, why, stoppedAt: { at: r.at, of: r.of, chars: done, interrupted: !stopped, tookKeyboard: took || undefined } };
    };

    // ---- the host's own shell, for windows / focus / launch / controls (core/desk.js) ----------------------------
    // One command, one answer -- the same exec the `exec` verb sends. `transport` marks a failure to get an answer at
    // all, as opposed to the command answering "no".
    const runExec = async (command, ms) => {
      const rid = ++reqSeq;
      ws.send({ type: 'exec', reqId: rid, cmd: command });
      const r = await raceStop(ws.waitFor((m) => m.type === 'exec-result' && m.reqId === rid, ms + 2000));
      if (!r) return { ok: false, transport: true, why: stopped || 'the host did not answer in time' };
      if (r.error) return { ok: false, transport: true, why: String(r.error) };
      let output = '';
      if (r.data) { try { output = Buffer.from(String(r.data), 'base64').toString('utf8'); } catch (_) { output = ''; } }
      return { ok: r.code === 0, code: typeof r.code === 'number' ? r.code : -1, output };
    };
    // Which OS answers exec (asked once per visit -- one command both shells understand), and where THIS visit's
    // screen sits on the host's desktop: window and control rects come back in the whole desktop's pixels.
    let deskOsName = '', deskOrigin = null;
    const DESK_SAYS = { windows: 'Listing the open windows', focus: 'Bringing a window to the front', launch: 'Starting an app', controls: 'Reading the controls of a window' };
    const deskOs = async () => {
      if (deskOsName) return { ok: true, os: deskOsName };
      const x = await runExec(desk.build('probe', {}, '').cmd, 15000);
      if (x.transport) return { ok: false, why: x.why };
      const p = desk.parse('probe', x.output);
      if (!p || !p.ok || !p.os) return { ok: false, why: 'could not tell what the host runs: ' + ((p && p.why) || 'no answer') };
      if (p.os !== 'windows' && p.os !== 'linux') return { ok: false, why: 'the host answered as ' + p.os + ' -- windows, focus, launch and controls know Windows and Linux hosts' };
      deskOsName = p.os;
      return { ok: true, os: deskOsName };
    };
    const deskLearnScreen = (p) => {   // the monitor this visit sees: the one its size matches, the primary first
      const mons = Array.isArray(p.monitors) ? p.monitors : [];
      const same = mons.filter((m) => m && Array.isArray(m.rect) && Number(m.rect[2]) === SW && Number(m.rect[3]) === SH);
      const pick = same.find((m) => m.primary) || same[0] || null;
      if (pick) deskOrigin = [Number(pick.rect[0]) || 0, Number(pick.rect[1]) || 0];
    };
    // cx/cy: a window's or a control's centre on THIS visit's screen -- what `click {x,y}` takes
    const deskPlace = async (p, os) => {
      if (!deskOrigin) {
        const b = desk.build('windows', {}, os);
        if (b.ok) { const x = await runExec(b.cmd, 30000); if (!x.transport) { const w = desk.parse('windows', x.output); if (w && w.ok) deskLearnScreen(w); } }
      }
      if (!deskOrigin) return;
      const [ox, oy] = deskOrigin;
      const place = (o) => {
        if (!o || !Array.isArray(o.rect) || o.rect.length < 4) return;
        const cx = Math.round(Number(o.rect[0]) + Number(o.rect[2]) / 2 - ox), cy = Math.round(Number(o.rect[1]) + Number(o.rect[3]) / 2 - oy);
        if (cx >= 0 && cy >= 0 && cx < SW && cy < SH) { o.cx = cx; o.cy = cy; }
      };
      for (const c of Array.isArray(p.controls) ? p.controls : []) place(c);
      for (const w of Array.isArray(p.windows) ? p.windows : []) place(w);
      if (p.window && typeof p.window === 'object') place(p.window);
      p.screen = { origin: deskOrigin, w: SW, h: SH };
    };

    // ---- FILES, A WEBCAM PHOTO, A SOUND RECORDING: core/desk.js's stat / read / write / rm / camera / audio, each ONE
    // command on the host through exec (the visit's shell consent). What is copied, put, photographed or recorded is
    // said in the room as it happens; a photo and a recording each need the room's yes FIRST, every time.
    const deskOp = async (op, args, ms) => {
      const os = await deskOs();
      if (!os.ok) return os;
      const b = desk.build(op, args || {}, os.os);
      if (!b.ok) return { ok: false, why: b.why };
      const x = await runExec(b.cmd, ms || 30000);
      if (x.transport) return { ok: false, why: x.why };
      return desk.parse(op, x.output) || { ok: false, why: 'no answer from the host' };
    };
    // a send is one command per chunk: ~4.4 KB a command on Windows (cmd.exe's line), ~88 KB on Linux -- so a few MB
    // to a Windows machine is already minutes. A fetch reads up to 360 KB a command.
    const FETCH_MAX = 100 * 1048576, SEND_MAX = { windows: 2 * 1048576, linux: 25 * 1048576 };
    // a whole file from the host, chunk by chunk (read: at most 360 KB a command)
    const readAll = async (p, max) => {
      const parts = []; let off = 0, total = 0, full = '';
      for (;;) {
        if (stopped) return { ok: false, why: stopped };
        const r = await deskOp('read', { path: p, off }, 30000);
        if (!r.ok) return r;
        full = r.full || full; total = Number(r.total) || 0;
        if (total > max) return { ok: false, why: full + ' is ' + humanBytes(total) + ' -- more than the ' + humanBytes(max) + ' a fetch copies' };
        const buf = Buffer.from(String(r.b64 || ''), 'base64');
        parts.push(buf); off += buf.length; wire += buf.length; trips++;
        if (!buf.length || off >= total) break;
      }
      return { ok: true, buf: Buffer.concat(parts), total, full };
    };
    const humanBytes = (n) => (n < 1024 ? n + ' bytes' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
    const roomNote = (text) => { try { ws.send({ type: 'chat', text }); fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text, mine: true, sent: true }) + '\n'); } catch (_) {} };
    const leaf = (p) => String(p || '').split(/[\\/]/).pop() || String(p || '');
    const saveLocal = (out, buf) => { const f = path.resolve(String(out)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return f; };

    // LOOK: a fresh picture of (a region of) the screen, shrunk so its long edge is <= max, written to `out`,
    // with the scale back. It is remembered, so the next click can be given in its pixels (lx/ly).
    let lastLook = null;
    async function doLook(o) {
      const settle = Math.max(0, Math.min(5000, Number(o.settle) || 0));
      if (settle) await sleep(settle);
      if (!o.out) return { ok: false, why: 'look needs out: the .png file to write the picture to' };
      // a region is asked of the host as a region: a host that can cut it sends only that (a fraction of the bytes)
      const want = o.rect ? lookv.fit(SW, SH, o.rect, o.max) : null;
      const s = await picture(() => shot(ws, [MON], want));
      if (!s.ok) return { ok: false, why: s.why };
      wire += s.png.length; trips += s.trips || 1;
      const im = eyes.decode(s.png);
      if (!im.ready || im.rows < im.h) return { ok: false, why: 'the picture could not be decoded' + (im.why ? ': ' + im.why : '') };
      let r, src;
      if (s.crop) {
        // the host cut it: the picture IS the region, at screen offset crop[0],crop[1]
        const [cx, cy, cw, ch] = s.crop;
        if (im.w !== cw || im.h !== ch) return { ok: false, why: 'the host said it cut ' + cw + 'x' + ch + ' but sent ' + im.w + 'x' + im.h };
        src = lookv.fit(cw, ch, null, o.max);
        r = Object.assign({}, src, { x: cx, y: cy });
      } else {
        if (im.w !== SW || im.h !== SH) return { ok: false, why: 'the screen changed size -- was ' + SW + 'x' + SH + ', now ' + im.w + 'x' + im.h };
        r = src = lookv.fit(im.w, im.h, o.rect, o.max);
      }
      const png = lookv.render(im, src);
      fs.writeFileSync(o.out, png);
      capture(o.out, o.keep);
      lastLook = r;
      return { ok: true, out: o.out, w: r.ow, h: r.oh, scale: r.k, at: [r.x, r.y], region: [r.w, r.h], screen: [SW, SH], bytes: png.length, cut: s.crop ? 'host' : undefined,
               hint: r.k > 1 || r.x || r.y ? 'click in this picture\'s pixels with lx/ly; the serve maps them to the screen' : undefined };
    }
    // Locate a word on the screen -- the body `find` and `clickText` share. Reads a region, OCRs it on the
    // host, matches the word (substring, case-insensitive), returns the nth hit (0-based) with its centre.
    const findWord = async (rect, text, nth, lang) => {
      const n = await needFrame(); if (!n.ok) return { ok: false, why: n.why };
      const r = await readText(ws, frame, rect || null, lang || LANG); trips++;
      if (!r.ok) return { ok: false, why: r.why, stale: !!r.gone };
      const want = String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim();
      const ox = Number(r.at.x) || 0, oy = Number(r.at.y) || 0, hits = [];
      for (const line of r.lines) for (const w of (line.w || [])) {
        if (want && String(w[0]).toLowerCase().indexOf(want) < 0) continue;
        const x = ox + Number(w[1]), y = oy + Number(w[2]), bw = Number(w[3]), bh = Number(w[4]);
        hits.push({ text: String(w[0]), x, y, w: bw, h: bh, cx: Math.round(x + bw / 2), cy: Math.round(y + bh / 2) });
      }
      return { ok: true, pick: hits[Math.max(0, Number(nth) || 0)] || null, hits, saw: r.lines.map((l) => l.t).join(' | ').slice(0, 160) };
    };

    let out = null, depth = 0;
    const reply = (o) => { out = o; };
    // What the verb table renamed for this command (keys.keys -> text, ...), handed back on the answer as
    // `fixed` so the driver learns the real name. Collected across a plan's steps; drained by the loop.
    let fixedNotes = [];
    const noteFixed = (list) => { for (const f of list) if (fixedNotes.length < 12 && !fixedNotes.includes(f)) fixedNotes.push(f); };
    // The verbs that only LOOK. They never carry an after-the-fact expectation, because there was no
    // action for one to be about -- and `expect`/`wait` evaluating their own expectation twice would
    // report a flap as a failure.
    const LOOKS = new Set(['hold', 'see', 'mark', 'ocr', 'probe', 'census', 'flood', 'diff', 'liveness',
                           'expect', 'wait', 'plan', 'find', 'shot', 'look', 'windows', 'controls', 'terminal', 'quit',
                           'chat', 'chat-img', 'chat-wait', 'seen', 'typing', 'ping', 'reconnect', 'status', 'think', 'warn', 'inbox', 'confirm', 'captcha', 'access', 'done',
                           'note-list', 'note-add', 'note-done', 'spotlight', 'ping', 'beam', 'spotlight-off', 'lock', 'mission']);

    // A SEQUENCE, A CHOICE OR A LOOP. Recursive, so a branch may hold a branch; bounded, so a `repeat`
    // with an expectation that never becomes true ends rather than running until the grant does.
    // `top`: the outermost plan's own list, whose position the action tree's batch row follows.
    async function runSteps(list, top) {
      const done = [];
      let bad = null, ran = 0;
      for (let i = 0; i < list.length; i++) {
        const st = list[i] || {};
        ran++;
        // a batch's live leaf in the action tree follows the sub-step it is on ("step 5/14: clicking (6,7)")
        if (top && atAuto() && atx(() => AT.tick(i, list.length, st), false)) atSend();
        // LIVE PROGRESS on a long plan (the fill is the most-watched step, and it used to sit on one
        // frozen line). Throttled so it costs ~1 frame per 8 sub-steps; only on a big batch -- and never
        // while a TREE is active: the tree owns the line (the same rule as every other auto-phrase), and a
        // plan that carries its own `status` steps was having its count overwritten by "Working 9 of 117".
        if (list.length > 12 && !lastDrive.tree && (i === 0 || i % 8 === 0 || i === list.length - 1)) { try { driveStatus('Working ' + (i + 1) + ' of ' + list.length); } catch (_) {} }
        let r;
        if (st.if) {
          // A fresh picture, for the same reason `expect` takes one: a choice made on the picture
          // held from before the last action is a choice about the past.
          if (st.fresh !== false) frame = null;
          const v = await evaluate(st.if);
          const took = v.ok ? 'then' : 'else';
          const branch = Array.isArray(st[took]) ? st[took] : [];
          r = { took, saw: v.saw, pred: v.pred, ok: true };
          if (branch.length) {
            const sub = await runSteps(branch);
            r.ran = sub.ran; r.of = branch.length;
            if (!st.quiet) r.steps = sub.done;
            if (sub.bad) { r.ok = false; bad = Object.assign({ at: i, in: took }, sub.bad); }
          }
        } else if (st.repeat !== undefined || st.until) {
          const max = Math.max(1, Math.min(500, Number(st.repeat) || 20));
          const body = Array.isArray(st.steps) ? st.steps : [];
          const poll = Math.max(0, Math.min(5000, Number(st.poll) || 0));
          let n = 0, held = false, sub = null;
          for (; n < max; n++) {
            if (st.until) {
              if (st.fresh !== false) frame = null;
              const v = await evaluate(st.until);
              if (v.ok) { held = true; break; }
            }
            if (stopped) break;
            if (body.length) { sub = await runSteps(body); if (sub.bad) break; }
            if (poll) await sleep(poll);
          }
          r = { loops: n, held, ok: st.until ? held : !(sub && sub.bad) };
          if (!r.ok) bad = { at: i, repeat: true,
                             why: (sub && sub.bad && sub.bad.why) ||
                                  ('it never became true, after ' + n + ' time' + (n === 1 ? '' : 's')) };
        } else {
          r = (await step(st)) || { ok: false, why: 'that step answered nothing' };
          if (!r.ok) bad = { at: i, do: st.do, why: r.why || (r.expect && r.expect.saw) || 'its expectation did not hold' };
        }
        done.push(Object.assign({ i }, r));
        if (bad) break;
        if (interrupt) { bad = { at: i, interrupted: true, why: 'the operator spoke: ' + String(interrupt.text || '').slice(0, 80) }; break; }
        if (stopped) { bad = { at: i, why: stopped }; break; }
      }
      return { done, bad, ran, of: list.length };
    }

    // ---- THE JOB'S PLAN: the `mission` verb (core/mission.js holds the plan, MS above) ---------------------
    // Draw what an operation declared: the goal as the task, the current milestone as its step (a milestone
    // taken up again is the SAME row), the live short step as the sub-step. A tool's tree in charge hands the
    // panel back first (kept as one "Ran: …" row), and declaring more work lifts a finished panel's green.
    const missionShow = (d, relabel) => {
      if (depth === 0 && (lastDrive.tree || planOn())) retire();
      if (d && d.task) atx(() => AT.retask(d.task));
      atx(() => AT.setPlan(MS.skeleton()));
      if (relabel) atx(() => AT.relabel(relabel.mid, relabel.t));
      if (d && (typeof d.step === 'string' || d.step === null)) atx(() => AT.mark({ step: d.step, mid: d.mid }, true, false));
      if (d && typeof d.substep === 'string') atx(() => AT.mark({ substep: d.substep }, true, false));
      if (d && (d.step || d.substep) && lastDrive.fin) lastDrive.fin = 0;
      atx(() => { lastDrive.text = AT.line(); });
      if (atAuto()) atSend(); else sendDrive();
    };
    // Say it in the room -- the plan, each change and why, each milestone achieved (with its picture). Anything
    // said after "shall I sign off?" makes THAT no longer the open question; a picture posted pays a debt.
    const missionSay = (text, im, file) => {
      if (!text) return;
      const m = { type: 'chat', text: String(text).slice(0, 2000) };
      if (im && im.ok) m.img = { url: im.url, name: 'proof' + (path.extname(String(file || '')) || '.png'), w: 0, h: 0 };
      try { stopTyping(); ws.send(m); } catch (_) {}
      const rec = { ts: Date.now(), name: selfName, text: m.text, mine: true, sent: true, mission: true };
      if (m.img) rec.img = true;
      try { fs.appendFileSync(chatFile, JSON.stringify(rec) + '\n'); } catch (_) {}
      signoffAsked = false;
      if (m.img) { if (picOwed) picOwed = false; else picShown = true; }
    };
    // The check that PROVES a milestone, on a fresh picture -- polled briefly, because a milestone is usually
    // claimed right after the action that should have done it, and a page still loading is "not yet", not "no".
    // A list of predicates must all hold.
    async function proveBy(check, timeout) {
      const list = Array.isArray(check) ? check : [check];
      const deadline = Date.now() + Math.max(0, Math.min(30000, timeout != null ? Number(timeout) || 0 : 2000));
      for (;;) {
        let v = { ok: true, saw: '' };
        const saws = [];
        frame = null;
        for (const p of list) {
          const one = await evaluate(p);
          if (!one.ok) { v = one; break; }
          if (one.saw) saws.push(String(one.saw).slice(0, 60));
        }
        if (v.ok) v.saw = saws.join(' · ');
        if (v.ok || Date.now() >= deadline || stopped) return v;
        await sleep(400);
      }
    }
    // ASK THE ROOM, AND HEAR WHAT IT SAYS -- `confirm`'s window, for the serve's own questions too: a spent budget,
    // a plan before it starts, a checkpoint, a webcam photo. The question goes to everyone; WHAT A REPLY MEANS is
    // core/consent.js -- a negation, deferral or hesitation anywhere is a no ("not sure", "go back first", "let me
    // think"), a yes is only a short reply of nothing but yes-words, anything else is unclear.
    //   ms       the window (2 s .. 5 min; 20 s by default)
    //   grace    how long a yes still waits for a late cancel; `confirm` keeps listening to the end of its window
    //   since    an EARLIER asking of the same question: what the room said after it counts too (the agent may come
    //            back to a question the room already answered)
    //   standing false refuses the standing yes: a webcam photo is never taken on silence
    // A cancel wins at any point. Time spent here is time waiting on people, not the task's (core/budget.js).
    async function askRoom(text, o) {
      const opts = o || {};
      if (text) { ws.send({ type: 'chat', text }); try { fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text, mine: true, sent: true }) + '\n'); } catch (_) {} }
      const standing = AUTO_CONFIRM && opts.standing !== false;
      if (opts.status !== false) driveStatus(standing ? 'Proceeding unless you say stop…' : 'Waiting for your OK…');
      const ms = Math.max(2000, Math.min(300000, Number(opts.ms) || 20000));
      const grace = opts.grace === Infinity ? Infinity : Math.max(0, Number(opts.grace) || 1500);
      const t0 = Date.now(), deadline = t0 + ms, replies = [];
      const since0 = Math.min(t0, Number(opts.since) || t0);
      let verdict = 'unclear', yesAt = 0;
      const hear = (m) => {
        replies.push({ name: String(m.name || ''), text: String(m.text || ''), ts: Number(m.ts) || 0 });
        const said = consent.confirmReply(String(m.text || ''));
        if (said === 'no') verdict = 'cancelled';                                   // a cancel wins immediately
        else if (said === 'yes' && verdict !== 'cancelled') { verdict = 'approved'; if (!yesAt) yesAt = Date.now(); }   // ...a yes waits out the grace
      };
      // what the room already said since the question was first asked (the chat log has it)
      if (since0 < t0) for (const m of readInbox()) { if ((Number(m.ts) || 0) >= since0 && verdict !== 'cancelled') hear(m); }
      while (verdict !== 'cancelled' && !stopped) {
        const end = verdict === 'approved' && grace !== Infinity ? Math.min(deadline, (yesAt || Date.now()) + grace) : deadline;
        if (Date.now() >= end) break;
        const m = await raceStop(ws.waitFor((x) => x.type === 'chat' && !x.system && String(x.name || '') !== selfName && (Number(x.ts) || 0) >= t0, Math.max(1, end - Date.now())));
        if (!m) break;
        hear(m);
      }
      // Standing yes: ONLY a window that NO ONE answered (and no revoke) means go ahead. A reply it could not read
      // as a yes is a person who said something -- never filled in as approval (it used to be).
      let auto = false;
      if (standing && verdict === 'unclear' && !replies.length && !stopped) { verdict = 'approved'; auto = true; }
      // The replies ride back in the answer, so the driver has read them -- as `chat-wait` does, the interrupt they
      // raised is spent. Left set, the very "yes" that approved a restart cut the plan doing it at its first step.
      // A message from before the question still stands.
      if (replies.length && interrupt && (Number(interrupt.ts) || 0) >= since0) interrupt = null;
      BUD.rest(Date.now() - t0);
      return { verdict, replies, auto };
    }
    async function missionOp(cmd) {
      const op = String(cmd.op || ''), why = cmd.why != null ? String(cmd.why) : '', quiet = !!cmd.quiet;
      const refused = (r) => reply(Object.assign({ ok: false, why: r.why }, r.open ? { open: r.open } : {}, r.needProof ? { needProof: true } : {}, { mission: MS.brief() }));
      // an operation that changes the plan: keep it, draw it, say it, answer with where the job now stands
      const applied = (r, extra) => {
        if (!r.ok) return refused(r);
        saveMission();
        missionShow(r.declare, r.relabel);
        if (r.say && !quiet) missionSay(r.say);
        // a CAPTCHA anywhere in the open plan comes back with the rule: it is the operator's, asked for in chat
        const human = MS.humanSteps();
        const note = human.length ? { human: { note: mission.CAPTCHA_NOTE, at: human.slice(0, 6).map((h) => h.where + ': ' + h.text) } } : {};
        reply(Object.assign({ ok: true }, extra || {}, note, { mission: MS.brief() }));
      };
      const milestoneOf = (c) => ({ t: c.t != null ? c.t : c.milestone, done: c.done, check: c.check, steps: c.steps, skill: c.skill, checkpoint: c.checkpoint });
      if (op === 'plan') {
        let spec = cmd.plan && typeof cmd.plan === 'object' ? cmd.plan : cmd;
        if (spec !== cmd && cmd.checkpoints != null && spec.checkpoints == null) spec = Object.assign({}, spec, { checkpoints: cmd.checkpoints });
        const r = MS.plan(spec, why);
        if (r.ok) { newTask(MS.goal); missionReplay = !!cmd.replay; }   // a planned job is a task of its own: its budget starts here
        const preview = !!(cmd.preview || (spec && spec.preview)) && cmd.preview !== 0 && cmd.preview !== '0';
        if (!r.ok || !preview) return applied(r);
        // A PREVIEW: the plan goes to the room as a question, and nothing acts until they say yes (core/mission.js
        // holds the gate; the loop below refuses acting commands while it stands). Their no or silence keeps it held.
        MS.hold('plan');
        saveMission();
        missionShow(r.declare, r.relabel);
        const a = await askRoom(MS.previewText(), { ms: Number(cmd.timeout) || 60000 });
        if (a.verdict === 'approved') MS.release(a.auto ? 'nobody objected (standing yes)' : 'before it started');
        else MS.heard();   // asking again listens to what comes after this answer
        saveMission();
        const out = { ok: true, preview: { verdict: a.verdict, replies: a.replies, auto: a.auto }, mission: MS.brief() };
        if (a.verdict !== 'approved') {
          out.waiting = true;
          out.hint = a.verdict === 'cancelled' ? 'the room did not agree to the plan: read what they said, change the plan (mission change / add / plan, with a why), then mission {"op":"ask"}'
                                               : 'no yes to the plan yet: nothing acts until there is one -- wait for the room (chat-wait), then mission {"op":"ask"}';
        }
        return reply(out);
      }
      if (op === 'ask') {
        // THE ROOM'S YES, ASKED AGAIN (or heard: a yes they gave after the question counts). A new `why` says the
        // question again with it; without one, a question asked in the last ten minutes is not asked twice.
        const g = MS.gate();
        if (!g) return reply({ ok: true, waiting: false, mission: MS.brief() });
        const recent = Date.now() - g.since < 10 * 60000;
        const text = recent && !why ? '' : (g.kind === 'plan' ? MS.previewText() : MS.checkpointText(g.m)) + (why ? '\n' + why.slice(0, 300) : '');
        const a = await askRoom(text, { ms: Number(cmd.timeout) || 60000, since: g.since });
        if (a.verdict === 'approved') MS.release(a.auto ? 'nobody objected (standing yes)' : 'asked again');
        else MS.heard();
        saveMission();
        const out = { ok: true, verdict: a.verdict, replies: a.replies, auto: a.auto, waiting: a.verdict !== 'approved', mission: MS.brief() };
        if (a.verdict === 'cancelled') out.hint = 'the room said no: change the plan as they asked (with a why), or drop it';
        return reply(out);
      }
      if (op === 'step') { const r = MS.step(cmd.t != null ? cmd.t : cmd.step); return applied(r, { added: !!r.added }); }
      if (op === 'steps') return applied(MS.setSteps(cmd.m, cmd.steps, why));
      if (op === 'add') { const r = MS.add(milestoneOf(cmd), { before: cmd.before, after: cmd.after, now: !!cmd.now }, why); return applied(r, { added: r.m, reopened: !!r.reopened }); }
      if (op === 'change') return applied(MS.change(cmd.m, { t: cmd.to, done: cmd.done, check: cmd.check, steps: cmd.steps }, why));
      if (op === 'split') return applied(MS.split(cmd.m, cmd.into, why));
      if (op === 'skip') return applied(MS.skip(cmd.m, why));
      if (op === 'fail') return applied(MS.fail(cmd.m, why));
      if (op === 'achieve') {
        // ACHIEVED MEANS PROVEN: its check held on a fresh picture, or a picture of it was shown to the room
        const a = MS.toAchieve(cmd.m, { check: cmd.check, file: cmd.file });
        if (!a.ok) return refused(a);
        if (a.already) return reply({ ok: true, already: true, achieved: a.m.t, mission: MS.brief() });
        const target = a.m;
        const v = a.check ? await proveBy(a.check, cmd.timeout) : null;
        const im = a.file ? imgFromFile(a.file) : null;
        if (v && !v.ok) {
          const r = MS.missed(target.id, String(v.saw || v.pred || ''));
          saveMission();
          atx(() => AT.setPlan(MS.skeleton())); if (atAuto()) atSend();
          const out = { ok: false, why: r.why, tries: r.tries, mission: MS.brief() };
          if (/tesseract|not installed|no text|cannot read text/i.test(String(v.saw || ''))) out.why += ' — the check cannot run here (no text reader on this host): prove it with a picture instead (file)';
          return reply(out);
        }
        if (!v && im && !im.ok) return reply({ ok: false, why: 'that picture is no proof: ' + im.why, mission: MS.brief() });
        const r = MS.achieved(target.id, { how: v ? 'check' : 'picture', saw: v ? v.saw : '', note: cmd.note, file: a.file });
        saveMission();
        missionShow(r.declare);
        if (!quiet) missionSay(r.say, im, a.file);
        const out = { ok: true, achieved: target.t, next: r.next, mission: MS.brief() };
        if (r.allDone) out.hint = 'every milestone is closed — finish the job: mission finish, with file: a cropped picture of the result';
        if (im && !im.ok) { out.img = false; out.imgWhy = im.why; }
        // A CHECKPOINT (checkpoints:true on the plan, or checkpoint:true on this milestone): stop here and ask the
        // room before going on to the next one -- a long job does not run forty steps blind
        if (r.next && !r.allDone && MS.isCheckpoint(target.id)) {
          MS.hold('checkpoint', target.id);
          saveMission();
          const c = await askRoom(MS.checkpointText(target.id), { ms: Number(cmd.timeout) || 60000 });
          if (c.verdict === 'approved') MS.release(c.auto ? 'nobody objected (standing yes)' : 'at the checkpoint');
          else MS.heard();
          saveMission();
          out.checkpoint = { verdict: c.verdict, replies: c.replies, auto: c.auto };
          out.mission = MS.brief();
          if (c.verdict !== 'approved') {
            out.waiting = true;
            out.hint = c.verdict === 'cancelled' ? 'the room said not to go on: read what they said -- change the plan, or stop and ask what they want'
                                                 : 'no yes to go on yet: nothing acts until there is one -- wait for the room (chat-wait), then mission {"op":"ask"}';
          }
        }
        return reply(out);
      }
      if (op === 'finish') {
        const r = MS.finish();
        if (!r.ok) return refused(r);
        saveMission();
        missionShow(null);
        atx(() => AT.mark({ fin: 1 }, atAuto(), depth > 0));
        // the job's report, the picture of its result and "shall I sign off?" -- one message, as the panel greens
        missionFinishing = true;
        try { driveStatus(MS.goal, { fin: 1, say: cmd.say ? String(cmd.say) : r.report, file: cmd.file, w: cmd.w, h: cmd.h }); }
        finally { missionFinishing = false; }
        const out = { ok: true, finished: true, report: r.report, mission: MS.brief() };
        if (cmd.file) { out.img = !!(finImg && finImg.ok); if (!out.img) out.imgWhy = finImg ? finImg.why : 'the picture did not go out'; }
        finImg = null;
        // A SKILL THAT WRITES ITSELF: a job finished with nothing failed, that no skill already did and that is not a
        // replay of one, is saved as a DRAFT skill (drive/replay.js draft) -- skills/_drafts/<name>/, gitignored, not
        // in the library until a person has read the typed text it stores and promoted it.
        const ms = (MS.toJSON() || {}).ms || [];
        if (!NO_DRAFTS && !missionReplay && ms.length && !ms.some((m) => m.s === 'failed') && !ms.some((m) => m.skill)) {
          let d;
          try { d = require('../drive/replay.js').draft(dir); } catch (e) { d = { ok: false, why: e.message }; }
          if (d && d.ok) {
            out.draft = { name: d.name, dir: d.dir, milestones: d.milestones, commands: d.commands, typed: d.typed, secrets: d.secrets };
            const tip = 'this job was saved as a DRAFT skill, ' + d.name + ' (' + d.milestones + ' proven milestone(s)): check its typed text holds nothing private, then `node drive/replay.js promote ' + d.name + ' --yes` puts it in the library';
            if (!out.hint) out.hint = tip; else out.draftHint = tip;
          } else if (d && !d.exists) out.draft = { saved: false, why: d.why };
        }
        return reply(out);
      }
      if (op === 'show') return reply({ ok: true, text: MS.text(), mission: MS.brief() });
      if (op === 'resume') {
        let saved = null;
        try { saved = JSON.parse(fs.readFileSync(cmd.file ? String(cmd.file) : missionFile, 'utf8')); } catch (e) { return reply({ ok: false, why: 'no saved plan to resume: ' + e.message }); }
        const r = MS.load(saved);
        if (!r.ok) return refused(r);
        missionShow(r.declare);
        return reply({ ok: true, resumed: true, text: MS.text(), mission: MS.brief() });
      }
      if (op === 'drop') { const r = MS.drop(why); if (r.ok) atx(() => AT.setPlan(null)); return applied(r); }
      return reply({ ok: false, why: 'mission ops: plan, step, steps, achieve, add, change, split, skip, fail, finish, show, resume, drop, ask' });
    }

    // THE DISPATCH, as a function rather than as the body of the loop, so a `plan` can walk back into
    // it step by step instead of every verb needing its own batched twin.
    async function step(cmd) {
      out = null;
      // CHECKED HERE RATHER THAN IN THE LOOP, so a plan honours it too. With the check only on the
      // outer loop, a grant revoked while a forty-step plan was running let the remaining
      // thirty-nine steps run and be reported ok -- every one of them refused by the relay, and the
      // plan the only thing that never heard about it.
      if (stopped) { out = { ok: false, why: stopped, stopped: true }; return out; }
      // A FIELD THE VERB DOES NOT READ IS A COMMAND THAT MEANS SOMETHING ELSE (core/verbs.js). Live on 10002,
      // {do:"keys", keys:"chrome"} typed nothing and answered ok fifteen times. A slip is renamed and said so
      // (`fixed`); anything else unknown, or a field the verb cannot work without, is refused before it is sent.
      // (The top level is vetted by the loop below; this catches every step inside a `plan`.)
      if (!cmd || !cmd.__vetted) {
        const v = verbs.vet(cmd, { inPlan: depth > 0 });
        if (!v.ok) { out = { ok: false, why: v.why, refused: true }; return out; }
        if (v.fixed.length) { cmd = v.cmd; noteFixed(v.fixed); }
      }
      if (!grantControl && NEEDS_CONTROL.has(cmd.do)) {
        out = { ok: false, why: 'this visit is watch-only -- ask for the keyboard and mouse: {"do":"access","control":1,"why":"..."}', needs: 'control' };
        return out;
      }
      try {
        if (cmd.do === 'quit') { reply({ ok: true, bye: true }); }   // the loop below leaves on it
        else if (cmd.do === 'pause') {
          // A fixed wait, bounded. Mostly a `plan`'s business ("give the app a moment"); an animation is better
          // waited out with `wait` on a pixel, which returns the moment it is true.
          const ms = Math.max(0, Math.min(30000, Number(cmd.ms) || 0));
          const until = Date.now() + ms;
          while (Date.now() < until && !stopped && !interrupt) await sleep(Math.min(200, Math.max(1, until - Date.now())));
          reply(interrupt && Date.now() < until ? { ok: true, ms, stoppedAt: { interrupted: true, why: 'the operator spoke: ' + String(interrupt.text || '').slice(0, 80) } } : { ok: true, ms });
        }
        else if (cmd.do === 'look') { reply(await doLook(cmd)); }
        else if (cmd.do === 'shot') {
          const s = await picture(() => shot(ws, [MON]));
          if (!s.ok) reply({ ok: false, why: s.why });
          // counted like every other read: the ledger showed every shot as 0 bytes, the costliest command as free
          else { wire += s.png.length; trips += s.trips || 1; fs.writeFileSync(cmd.out, s.png); capture(cmd.out, cmd.keep); reply({ ok: true, w: s.w, h: s.h, bytes: s.png.length }); }
        } else if (cmd.do === 'click') {
          const a = aimAt(cmd);
          if (!a.ok) reply({ ok: false, why: a.why });
          else { await clickAt(a.x, a.y, SW, SH, cmd.fast); reply({ ok: true, at: [a.x, a.y] }); }
        } else if (cmd.do === 'clicks') {              // many, in one round trip
          for (const [x, y] of (cmd.at || [])) { await clickAt(Number(x), Number(y), SW, SH, cmd.fast); await sleep(cmd.fast ? 20 : 40); }
          reply({ ok: true, n: (cmd.at || []).length });
        } else if (cmd.do === 'stroke') {
          // A HELD DRAG, which `click` cannot express: down, many moves with the button still down,
          // then up. The moves carry drag:1 -- the host may coalesce a HOVER batch to its newest point
          // but must inject a drag whole, so without the flag a fast stroke arrives as a straight line
          // from its first point to its last.
          const pts = cmd.points || [];
          if (pts.length < 2) { reply({ ok: false, why: 'a stroke needs at least two points' }); }
          else {
            const nx = (p) => Math.min(Math.max(Number(p[0]) / SW, 0), 0.99999);
            const ny = (p) => Math.min(Math.max(Number(p[1]) / SH, 0), 0.99999);
            showPointer(nx(pts[0]), ny(pts[0]), true);
            ws.send({ type: 'mouse', action: 'move', x: nx(pts[0]), y: ny(pts[0]) }); await sleep(70);
            ws.send({ type: 'mouse', action: 'down', button: 0, x: nx(pts[0]), y: ny(pts[0]) }); await sleep(60);
            for (let i = 1; i < pts.length; i++) {
              showPointer(nx(pts[i]), ny(pts[i]));   // the watchers see the stroke as it is drawn
              ws.send({ type: 'mouse', action: 'move', x: nx(pts[i]), y: ny(pts[i]), drag: 1 });
              await sleep(Number(cmd.ms) || 16);
            }
            const last = pts[pts.length - 1];
            ws.send({ type: 'mouse', action: 'up', button: 0, x: nx(last), y: ny(last) }); oweSettle(140);
            reply({ ok: true, n: pts.length });
          }
        } else if (cmd.do === 'strokes') {             // many strokes, one round trip
          let n = 0;
          for (const s of (cmd.list || [])) {
            const pts = s.points || s;
            if (!pts || pts.length < 2) continue;
            const nx = (p) => Math.min(Math.max(Number(p[0]) / SW, 0), 0.99999);
            const ny = (p) => Math.min(Math.max(Number(p[1]) / SH, 0), 0.99999);
            showPointer(nx(pts[0]), ny(pts[0]), true);
            ws.send({ type: 'mouse', action: 'move', x: nx(pts[0]), y: ny(pts[0]) }); await sleep(70);
            ws.send({ type: 'mouse', action: 'down', button: 0, x: nx(pts[0]), y: ny(pts[0]) }); await sleep(60);
            for (let i = 1; i < pts.length; i++) {
              showPointer(nx(pts[i]), ny(pts[i]));   // the watchers see the stroke as it is drawn
              ws.send({ type: 'mouse', action: 'move', x: nx(pts[i]), y: ny(pts[i]), drag: 1 });
              await sleep(Number(cmd.ms) || 14);
            }
            const last = pts[pts.length - 1];
            ws.send({ type: 'mouse', action: 'up', button: 0, x: nx(last), y: ny(last) }); oweSettle(130);
            n++;
          }
          reply({ ok: true, strokes: n });
        } else if (cmd.do === 'chord') {               // Ctrl+A, Ctrl+E, Ctrl+Z ...
          await chord(String(cmd.mod || 'ControlLeft'), String(cmd.code || 'KeyA'));
          reply({ ok: true });
        } else if (cmd.do === 'dbl') {                 // a double click: the way into a colour picker
          const a = aimAt(cmd);
          if (!a.ok) { reply({ ok: false, why: a.why }); return out; }
          const x = Math.min(a.x / SW, 0.99999), y = Math.min(a.y / SH, 0.99999);
          ws.send({ type: 'mouse', action: 'move', x, y }); await sleep(60);
          for (let i = 0; i < 2; i++) {
            ws.send({ type: 'mouse', action: 'down', button: 0, x, y }); await sleep(30);
            ws.send({ type: 'mouse', action: 'up', button: 0, x, y }); await sleep(40);
          }
          oweSettle(300); reply({ ok: true, at: [a.x, a.y] });
        } else if (cmd.do === 'right') {               // a flag, in minesweeper terms
          const a = aimAt(cmd);
          if (!a.ok) { reply({ ok: false, why: a.why }); return out; }
          const x = Math.min(a.x / SW, 0.99999), y = Math.min(a.y / SH, 0.99999);
          ws.send({ type: 'mouse', action: 'move', x, y }); await sleep(50);
          ws.send({ type: 'mouse', action: 'down', button: 2, x, y }); await sleep(50);
          ws.send({ type: 'mouse', action: 'up', button: 2, x, y }); oweSettle(100);
          reply({ ok: true, at: [a.x, a.y] });
        } else if (cmd.do === 'keys') {
          // LIKE A PERSON, BY DEFAULT (the owner's call, 2026-11-06): the viewer's own "Like a person" planner
          // (core/autotype.js -- the Type window's, copied character for character): a typist's rhythm, pauses at
          // clause ends, the odd slip onto a neighbouring key fixed with Backspace. `speed` slow / normal / fast
          // (about 40 / 70 / 105 words a minute). human:0 is the machine's instant typing (with a `speed`, the Type
          // window's even robot pace). Stopped by the operator writing, as a plan is.
          const r = await typeAs(String(cmd.text || ''), cmd, 'normal');
          reply(r);
        }
        else if (cmd.do === 'press') { await tap(String(cmd.code || 'Enter')); reply({ ok: true }); }
        else if (cmd.do === 'open') {
          if (cmd.tab) { await chord('ControlLeft', 'KeyT'); await sleep(600); }   // tab:1 -- a NEW tab, never their page
          await chord('ControlLeft', 'KeyL'); await sleep(250);
          // the address is typed like everything else -- like a person unless human:0 -- at the fast pace: a person
          // types a known address briskly
          const t = await typeAs(String(cmd.url || ''), cmd, 'fast');
          if (!t.ok) { reply(t); return out; }
          await sleep(150); await tap('Enter');
          await sleep(Number(cmd.wait) || 2500); reply({ ok: true });
        } else if (cmd.do === 'scroll') {
          const a = (cmd.x != null || cmd.lx != null) ? aimAt(cmd) : { ok: true, x: SW / 2, y: SH / 2 };
          if (!a.ok) { reply(a); return out; }
          const x = Math.min(a.x / SW, 0.99999), y = Math.min(a.y / SH, 0.99999);
          const n = Number(cmd.n) || 0, delta = n < 0 ? -120 : 120;
          showPointer(x, y, true);   // the watchers see whose hand it is, and where
          ws.send({ type: 'mouse', action: 'move', x, y }); await sleep(80);
          for (let i = 0; i < Math.abs(n); i++) { ws.send({ type: 'mouse', action: 'wheel', x, y, delta }); showScroll(x, y, delta); await sleep(90); }
          oweSettle(500); reply({ ok: true });

        // ---- talking to the operator, and checking the line is alive ------------------------------
        } else if (cmd.do === 'chat') {                // say something in this host's session chat
          const text = String(cmd.text || '').slice(0, 2000);
          if (!text) reply({ ok: false, why: 'chat needs text' });
          else {
            const m = { type: 'chat', text };
            if (cmd.to) m.to = String(cmd.to);          // a DM to one viewer's tag; omit for the room
            interrupt = null; stopTyping(); ws.send(m);   // the driver answered -> let a paused plan resume
            try { fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text, to: m.to || '', mine: true, sent: true }) + '\n'); } catch (_) {}
            reply({ ok: true });
          }
        } else if (cmd.do === 'chat-img') {            // post an image (a cropped screenshot) to the room
          const im = imgFromFile(cmd.file);
          if (!im.ok) reply(im);
          else {
            const text = String(cmd.text || '').slice(0, 2000);
            const m = { type: 'chat', text, img: { url: im.url, name: String(cmd.name || 'screenshot.png').slice(0, 120),
                                                   w: Math.max(0, Number(cmd.w) || 0), h: Math.max(0, Number(cmd.h) || 0) } };
            if (cmd.to) m.to = String(cmd.to);
            stopTyping(); ws.send(m);
            if (picOwed) picOwed = false; else picShown = true;   // the result picture (see picOwed)
            try { fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text, img: true, to: m.to || '', mine: true, sent: true }) + '\n'); } catch (_) {}
            reply({ ok: true, bytes: im.bytes, urlLen: im.urlLen });
          }
        } else if (cmd.do === 'done') {                // announce completion (optionally with a shot) and leave
          // A sign-off to the room, then the serve loop ends and the grant goes back (the loop breaks on
          // `done` like on `quit`). `file` attaches a final cropped screenshot the chat-img way; without
          // it, just the text. The relay fans an `agent-drive ended` on release, which settles the panel.
          const text = String(cmd.text || 'Task complete.').slice(0, 2000);
          const out = { ok: true, said: text, bye: true };
          const m = { type: 'chat', text };
          if (cmd.file) { const im = imgFromFile(cmd.file);
            if (im.ok) { m.img = { url: im.url, name: 'done.png', w: Math.max(0, Number(cmd.w) || 0), h: Math.max(0, Number(cmd.h) || 0) }; out.img = true; }
            else { out.img = false; out.imgWhy = im.why; } }
          stopTyping(); ws.send(m);
          try { fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text, img: !!out.img, mine: true, sent: true, done: true }) + '\n'); } catch (_) {}
          reply(out);
        } else if (cmd.do === 'chat-wait') {           // block for the next human reply (ask, then wait)
          // The next message from SOMEONE ELSE after `since` (default: now), or a timeout. The agent's
          // own echo and the relay's `system` notices are skipped, so this returns a person's answer.
          const since = Number(cmd.since) || Date.now();
          const ms = Math.max(1000, Math.min(600000, Number(cmd.timeout) || 120000));
          const waited0 = Date.now();
          const got = await raceStop(ws.waitFor((m) => m.type === 'chat' && !m.system && String(m.name || '') !== selfName && (Number(m.ts) || 0) >= since, ms));
          BUD.rest(Date.now() - waited0);   // waiting on a person is not the agent grinding (core/budget.js)
          if (got) interrupt = null;   // the driver is attending to chat; let a paused plan resume
          if (!got) reply({ ok: false, why: stopped || 'nobody answered in time', timedOut: !stopped });
          else reply({ ok: true, from: String(got.from || ''), name: String(got.name || ''), text: String(got.text || ''), ts: Number(got.ts) || 0, dm: !!got.to });
        } else if (cmd.do === 'captcha') {             // a CAPTCHA is for a PERSON: say so in chat, and wait for them
          // The agent never solves, bypasses or clicks through a CAPTCHA ("I'm not a robot", a picture puzzle): it is a
          // check that a person is there, and an agent passing it would be passing for one. 10002's plan had a step
          // "Complete any reCAPTCHA" and nothing objected. Now it is handed over: said in the session chat, shown on
          // the panel, and the run waits for the operator's reply (10 minutes by default, at most 30).
          const ask = (String(cmd.text || '') || '🧩 **A CAPTCHA needs a person.** There is a CAPTCHA (an "I\'m not a robot" check) on the screen. Please solve it — I won\'t touch it — then reply **done** here and I\'ll carry on.').slice(0, 2000);
          const since0 = Date.now();
          try { stopTyping(); ws.send({ type: 'chat', text: ask }); fs.appendFileSync(chatFile, JSON.stringify({ ts: since0, name: selfName, text: ask, mine: true, sent: true, captcha: true }) + '\n'); } catch (_) {}
          signoffAsked = false;
          driveStatus('Waiting for you to solve the CAPTCHA…', { warn: 'A CAPTCHA needs a person: please solve it, then reply "done" in chat' });
          const ms = Math.max(5000, Math.min(1800000, Number(cmd.timeout) || 600000));
          const got = await raceStop(ws.waitFor((m) => m.type === 'chat' && !m.system && String(m.name || '') !== selfName && (Number(m.ts) || 0) >= since0, ms));
          if (got && interrupt && (Number(interrupt.ts) || 0) >= since0) interrupt = null;   // answered HERE: not an interrupt
          driveStatus(null, { warn: '' });
          if (!got) reply({ ok: false, why: stopped || 'nobody answered about the CAPTCHA in ' + Math.round(ms / 60000) + ' min', timedOut: !stopped });
          else {
            const no = consent.confirmReply(String(got.text || '')) === 'no';
            reply({ ok: true, solved: !no, name: String(got.name || ''), text: String(got.text || ''),
                    next: no ? 'the operator did not solve it -- read their reply, and do NOT try the CAPTCHA yourself'
                             : 'look again: the CAPTCHA should be gone; if it is still there, ask again' });
          }
        } else if (cmd.do === 'ping') {                // quick liveness: is the session still alive?
          // A short-deadline held frame, so a stale session (e.g. after a relay move) is found in
          // seconds instead of a 30s stall per command. Does not disturb the held picture.
          const ms = Math.max(1000, Math.min(20000, Number(cmd.timeout) || 6000));
          const rid = ++reqSeq;
          ws.send({ type: 'shot', reqId: rid, mons: [MON], len: HOLD_LEN });
          const r = await raceStop(ws.waitFor((m) => m.type === 'fs-data' && m.reqId === rid, ms));
          reply(r && !r.error && Number(r.total) ? { ok: true, alive: true }
                                                  : { ok: false, alive: false, why: stopped || 'no reply in time — the session may be stale; reconnect' });
        } else if (cmd.do === 'reconnect') {           // force a fresh session (for a stale / half-open socket)
          // `ping` can report alive:false while the socket never CLOSED -- a relay that died silently. Drop
          // it here to synthesize the close -> ws.dead -> the serve loop redials and surfaces a fresh Allow.
          // (If a FRESH session still can't `shot`, that's a HOST freeze, not a relay move -- tell the operator.)
          reply({ ok: true, reconnecting: true });
          try { ws.close(); } catch (_) {}
        } else if (cmd.do === 'status') {              // set the panel's line / plan / thought / metrics, no action
          // `text`: the live line (omit to keep it). `steps`: the whole plan (array of short labels). `at`:
          // the current step, 0-based -- declare the plan once (steps + at:0) then advance `at`. Optional:
          // `thought` (reasoning gist/paragraph, <=400), `next` (<=120), `conf` ('low'|'med'|'high'),
          // `warn`, `stat` (per-step codes), `sub`/`subAt` (sub-steps of the current step). The panel
          // shows done / current (+ this line, + thought, + sub-steps) / next / upcoming + live metrics.
          //
          // THE ACTION TREE'S LEVELS ride the same verb: `task` (the top; closes the one before), `step`
          // (null ends it), `substep`. With no explicit tree or plan in charge, a plain `text` from an ad-hoc
          // driver IS its next step, and `fin` settles the action tree's task done (green, still serving).
          //
          // INSIDE A PLANNED JOB the levels belong to the plan (core/mission.js): a `step` or `substep` declared
          // here is a short step of the CURRENT milestone -- a free-standing step would sit outside the plan and
          // the panel would lose the milestone it belongs to. A different `task` means the job changed: the plan
          // is dropped, and the room is told. A bare finish with milestones still open is answered with a hint.
          // (A tool's own tree or flat plan takes the panel exactly as before.)
          let planHint = '';
          // a task by another name is a new task: its budget starts again (core/budget.js)
          if (depth === 0 && typeof cmd.task === 'string' && cmd.task.trim() && !BUD.same(cmd.task.trim())) newTask(cmd.task.trim());
          if (MS.active() && depth === 0 && !(Array.isArray(cmd.tree) && cmd.tree.length) && !(Array.isArray(cmd.steps) && cmd.steps.length)) {
            if (typeof cmd.task === 'string' && cmd.task.trim() && cmd.task.trim() !== MS.goal) {
              const d = MS.drop('a new task was declared: ' + cmd.task.trim().slice(0, 80));
              if (d.ok) { saveMission(); atx(() => AT.setPlan(null)); missionSay(d.say); planHint = 'the plan for “' + MS.goal + '” was dropped — a new task replaced it'; }
            } else if (cmd.step !== undefined || cmd.substep !== undefined) {
              const label = cmd.step !== undefined ? cmd.step : cmd.substep;
              const r = MS.step(label == null ? '' : String(label));
              if (r.ok) { saveMission(); atx(() => AT.setPlan(MS.skeleton())); cmd = Object.assign({}, cmd, { substep: label == null ? '' : String(label) }); delete cmd.step; }
            }
            if (cmd.fin) { const f = MS.finishable(); if (!f.ok) planHint = 'a planned job is under way: ' + f.why + ' — then finish it with mission finish'; }
          }
          const declares = cmd.task !== undefined || cmd.step !== undefined || cmd.substep !== undefined;
          const ownTree = Array.isArray(cmd.tree) && cmd.tree.length, ownPlan = Array.isArray(cmd.steps) && cmd.steps.length;
          const said = typeof cmd.text === 'string' && !!cmd.text.trim() && !cmd.fin;
          // HANDING THE PANEL BACK. A tool's tree or a flat plan stays in charge until the driver moves on
          // from it: a task/step/substep declaration always takes the panel back (finished or not -- a recipe
          // that stopped on a failure never sends fin), and once it has FINISHED a new line or plan does too.
          // Before, a finished tool tree outlived the line that lifted its green, and then blocked the action
          // tree for good: every later action went unseen under a stale, all-done tree. Kept as "Ran: …".
          if (depth === 0 && !ownTree && (lastDrive.tree || planOn()) && ((declares && !ownPlan) || (lastDrive.over && (said || ownPlan || declares)))) retire();
          // a NEW tool tree straight after a finished one (two recipes back to back): the first is history too
          if (ownTree && lastDrive.over && (lastDrive.tree || planOn())) atx(() => AT.adopt(lastDrive.tree || actionTree.planToTree({ steps: lastDrive.steps, fin: 1 })));
          const wasAuto = atAuto(), prevTree = lastDrive.tree, prevPlan = planOn() ? lastDrive.steps : null;
          const autoNow = wasAuto && !ownTree && !ownPlan;
          // a tree or plan TAKING the panel with no line of its own must not inherit the action tree's last
          // line (it showed under the plan's current step, and in the chat report at its finish)
          if (wasAuto && (ownTree || ownPlan) && cmd.text == null) lastDrive.text = '';
          // (a status sent from INSIDE a batch is the batch's business: the batch keeps its row)
          if (atx(() => AT.mark(cmd, autoNow, depth > 0), false) && declares && !cmd.fin) lastDrive.fin = 0;   // declaring more work lifts the green
          // a finish with no words of its own reports as the TASK, not as whatever its last action was
          if (autoNow && cmd.fin && !(typeof cmd.text === 'string' && cmd.text.trim())) { const tl = atx(() => AT.taskLabel(), ''); if (tl) lastDrive.text = tl; }
          driveStatus(cmd.text, cmd);
          // A tool's tree or a flat plan just TOOK the panel: end the action tree's burst cleanly, so nothing
          // stale is live (or merged into) when it comes back. One just LEFT it: keep it as a done "Ran: …" step.
          if (wasAuto && !atAuto()) atx(() => AT.suspend());
          else if (!wasAuto && atAuto() && atx(() => AT.adopt(prevTree || actionTree.planToTree({ steps: prevPlan, fin: 1 })), false)) {
            // it left FINISHED (the green still up): so is the task it ran in -- not green over a running task
            if (lastDrive.fin) atx(() => AT.mark({ fin: 1 }, true));
            atSend();
          }
          const out = { ok: true, at: lastDrive.at, steps: Array.isArray(lastDrive.steps) ? lastDrive.steps.length : undefined };
          // did the result picture go out with the finish? (a `file` on a status that finished nothing is told so)
          if (cmd.file) {
            out.img = !!(finImg && finImg.ok);
            if (!out.img) out.imgWhy = finImg ? finImg.why : 'nothing finished here -- a picture rides only on the status that FINISHES the task (fin:1); post it with chat-img';
          }
          finImg = null;
          if (planHint) out.hint = planHint;
          reply(out);
        } else if (cmd.do === 'think') {               // the agent's current reasoning -> the panel's thought block
          driveStatus(null, { thought: (cmd.thought != null ? cmd.thought : cmd.text), conf: cmd.conf, next: cmd.next });
          reply({ ok: true });
        } else if (cmd.do === 'warn') {                // a caution line for the watchers
          driveStatus(null, { warn: cmd.text });
          reply({ ok: true });
        } else if (cmd.do === 'access') {              // ASK FOR MORE ACCESS mid-visit: a fresh Allow card, or nothing
          // 10002's operator expected the agent to use the terminal, but the visit had been approved without
          // --shell, so it typed its way around. A grant never grows in place (the relay: "a grant given without it
          // can never acquire it"), so this asks the way a reconnect does: a NEW join for the wider consents, a new
          // card in front of the operator naming them, and -- only if a person presses Allow -- the visit moves onto
          // that grant (the work folder, the mission, the panel all carry on) and the old one is released. A no, or
          // nobody, leaves the visit exactly as it was. Access still never grows without a person pressing Allow.
          const want = { control: grantControl || !!cmd.control, shell: grantShell || !!cmd.shell, term: grantTerm || !!cmd.terminal };
          if (want.control === grantControl && want.shell === grantShell && want.term === grantTerm) reply({ ok: true, already: true, control: grantControl, shell: grantShell, terminal: grantTerm });
          else {
            const why = String(cmd.why || '').slice(0, 200);
            const what = [want.shell && !grantShell ? 'run commands on this machine' : '', want.term && !grantTerm ? 'use the Terminal (it shows in the Terminal panel)' : '', want.control && !grantControl ? 'use the keyboard and mouse' : ''].filter(Boolean).join(' and ');
            const ask = '🔑 **May I also ' + what + '?**' + (why ? ' ' + why : '') + ' A new Allow card is on its way — nothing changes unless you press Allow.';
            try { stopTyping(); ws.send({ type: 'chat', text: ask }); fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text: ask, mine: true, sent: true }) + '\n'); } catch (_) {}
            signoffAsked = false;
            driveStatus('Waiting for you to allow more access…');
            const codeFile = path.join(dir, 'access.json');
            const relayList = [lastGoodRelay].concat(RELAYS).map((r) => String(r || '').trim()).filter((r, i, a) => r && a.indexOf(r) === i);
            const d = await dialAndJoin(relayList, (code, relay) => {
              showCode(code, relay);
              try { fs.writeFileSync(codeFile, JSON.stringify({ code, relay, at: Date.now(), want })); } catch (_) {}
            }, true, want);
            try { fs.unlinkSync(codeFile); } catch (_) {}
            if (!d.ok) {
              const refused = d.code === 3 && d.retry === false;
              driveStatus(refused ? 'Carrying on with the access I have' : 'No new access');
              reply({ ok: false, why: refused ? 'the operator said no -- carry on with the access you have' : 'not allowed: ' + d.why, refused, control: grantControl, shell: grantShell });
            } else {
              const old = ws;
              ws = d.ws; selfName = d.user; ws.onDead = wake; lastGoodRelay = d.relay || lastGoodRelay;
              viewPaused = false; clearTimeout(repauseTimer); setPaused(true);
              attachWatch(ws); attachTaps(ws);
              frame = null; img = null; before = null;          // the held picture belonged to the old socket
              grantControl = want.control; grantShell = want.shell; grantTerm = want.term;
              // the OLD grant goes: closing its socket releases it (a join-leave would leave it attached to the host)
              try { old.onDead = null; old.close(); } catch (_) {}
              try { fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ w: SW, h: SH, host: HOST, at: Date.now(), relay: lastGoodRelay, control: grantControl, shell: grantShell })); } catch (_) {}
              say('[+] the operator allowed more access' + (grantShell ? ' -- this visit may run commands now' : ''));
              // the old grant's release clears the watchers' panel; put it back once the relay has done so
              await sleep(500);
              try { sendDrive(); } catch (_) {}
              reply({ ok: true, control: grantControl, shell: grantShell, terminal: grantTerm });
            }
          }
        } else if (cmd.do === 'windows' || cmd.do === 'focus' || cmd.do === 'launch' || cmd.do === 'controls') {
          // WINDOWS, APPS AND CONTROLS BY NAME (core/desk.js). 10002 spent its visit failing to start Chrome while a
          // Chrome window sat open in its own screenshots. Neither host has a verb for this, so each is ONE command run
          // on the host through exec (PowerShell + UI Automation on Windows, X11 / AT-SPI on Linux) -- which is why it
          // needs the visit's shell consent. `controls` reads names, types and places: never a value, and a password
          // field is flagged and left unread. Every answer adds cx/cy: the centre on this visit's screen, to click.
          if (!grantShell) reply({ ok: false, why: 'this runs a command on the host, and this visit was not granted that -- ask: {"do":"access","shell":1,"why":"..."}', needs: 'shell' });
          else {
            const os = await deskOs();
            if (!os.ok) reply(os);
            else {
              const args = {};
              for (const k of ['title', 'id', 'app', 'args', 'cwd', 'wait', 'focus', 'max', 'depth', 'budget', 'dry']) if (cmd[k] !== undefined) args[k] = cmd[k];
              const b = desk.build(cmd.do, args, os.os);
              if (!b.ok) reply({ ok: false, why: b.why });
              else {
                if (cmd.intent == null && !cmd.quiet && !lastDrive.tree) driveStatus(DESK_SAYS[cmd.do]);
                const x = await runExec(b.cmd, cmd.do === 'launch' ? Math.min(90000, (Number(cmd.wait) || 4000) + 30000) : 30000);
                if (x.transport) reply({ ok: false, why: x.why });
                else {
                  const p = desk.parse(cmd.do, x.output) || { ok: false, why: 'no answer' };
                  if (p.ok && cmd.do === 'windows') deskLearnScreen(p);
                  if (p.ok) await deskPlace(p, os.os);
                  reply(Object.assign({}, p, { ok: !!p.ok }));
                }
              }
            }
          }
        } else if (cmd.do === 'terminal') {            // THE TERMINAL PANEL'S SHELL (needs --terminal / access {terminal:1})
          // The same shell the operator sees in the Terminal panel -- what the agent types there, and what it prints,
          // show there for everyone watching (exec runs one command out of sight; this is the visible one). A line
          // (input), raw keys (keys: Tab, arrows, Ctrl+C as the bytes a terminal sends), an interrupt (signal), a
          // restart (close); the answer is the output that arrived after it, ANSI codes removed: until `until` shows,
          // or the shell has been quiet `wait` ms (1.2 s), or `timeout` (30 s).
          if (!grantTerm) reply({ ok: false, why: 'this visit was not granted a terminal -- ask: {"do":"access","terminal":1,"why":"..."} (a new Allow card names it)', needs: 'terminal' });
          else if (cmd.close) { ws.send({ type: 'term-close' }); term.open = false; reply({ ok: true, closed: true }); }
          else {
            if (!term.open || cmd.open) {
              ws.send({ type: 'term-open' });
              const r0 = await raceStop(ws.waitFor((m) => m.type === 'term-ready' || m.type === 'term-error', 15000));
              if (r0 && r0.type === 'term-ready') term.open = true;
              await sleep(400);                      // a reused shell repaints its screen first: that is not the answer
            }
            if (!term.open) reply({ ok: false, why: 'the terminal did not open: ' + (term.error || 'no answer from the host') });
            else {
              const start = term.total;
              if (cmd.intent == null && !cmd.quiet && !lastDrive.tree) driveStatus(cmd.input != null ? 'Typing in the Terminal' : 'Using the Terminal');
              if (cmd.signal) ws.send({ type: 'term-signal' });
              if (cmd.keys != null && String(cmd.keys)) ws.send({ type: 'term-keys', data: String(cmd.keys) });
              if (cmd.input != null) ws.send({ type: 'term-input', data: String(cmd.input) });
              const until = cmd.until != null ? String(cmd.until) : '';
              const quiet = Math.max(200, Math.min(10000, Number(cmd.wait) || 1200));
              const deadline = Date.now() + Math.max(1000, Math.min(600000, Number(cmd.timeout) || 30000));
              const fresh = () => { const n = term.total - start; return n <= 0 ? '' : term.buf.slice(-Math.min(n, term.buf.length)); };
              let seen = false;
              while (!stopped && Date.now() < deadline) {
                const out = stripAnsi(fresh());
                if (until && out.indexOf(until) >= 0) { seen = true; break; }
                if (!until && term.total > start && Date.now() - term.at >= quiet) break;
                if (term.exit != null && !term.open) break;
                await sleep(100);
              }
              const output = stripAnsi(fresh());
              const res = { ok: until ? seen : true, output: output.slice(-8000), cut: output.length > 8000 || undefined, busy: term.busy || undefined };
              if (term.exit != null && !term.open) { res.exited = term.exit; }
              if (until && !seen) res.why = 'did not see "' + until.slice(0, 60) + '" in the output' + (stopped ? '' : ' before the timeout');
              reply(res);
            }
          }
        } else if (cmd.do === 'fetch' || cmd.do === 'send' || cmd.do === 'camera' || cmd.do === 'audio') {
          // FILES AND CAPTURES (core/desk.js, through exec): the visit's shell consent covers them, the room hears
          // each one, and a photo or a recording is asked for every time -- a yes only, never silence.
          const say = (t) => { if (cmd.intent == null && !cmd.quiet && !lastDrive.tree) driveStatus(t); };
          const why = cmd.why != null ? ' ' + String(cmd.why).slice(0, 300) : '';
          if (!grantShell) reply({ ok: false, why: 'this runs a command on the host, and this visit was not granted that -- ask: {"do":"access","shell":1,"why":"..."}', needs: 'shell' });
          else if (cmd.do === 'fetch') {
            say('Copying a file from this machine');
            const st = await deskOp('stat', { path: String(cmd.path) });
            if (!st.ok) reply(st);
            else if (!st.exists) reply({ ok: false, why: 'there is nothing at ' + st.full });
            else if (st.dir) reply({ ok: false, why: st.full + ' is a folder -- fetch copies one file' });
            else {
              const f = await readAll(String(cmd.path), FETCH_MAX);
              if (!f.ok) reply(f);
              else {
                const out = saveLocal(cmd.out, f.buf);
                roomNote('📄 I copied **' + leaf(f.full) + '** (' + humanBytes(f.buf.length) + ') from this machine.');
                reply({ ok: true, from: f.full, file: out, size: f.buf.length });   // (not `bytes`: every answer's bytes is the wire's)
              }
            }
          } else if (cmd.do === 'send') {
            let data = null;
            try { data = fs.readFileSync(String(cmd.file)); } catch (e) { reply({ ok: false, why: 'cannot read ' + cmd.file + ' here: ' + e.message }); }
            const os = data ? await deskOs() : null;
            const cap = os && os.ok ? SEND_MAX[os.os] || SEND_MAX.windows : SEND_MAX.windows;
            if (data && data.length > cap) reply({ ok: false, why: leaf(cmd.file) + ' is ' + humanBytes(data.length) + ' -- send puts up to ' + humanBytes(cap) + ' on a ' + (os && os.os === 'linux' ? 'Linux' : 'Windows') + ' machine (' + (os && os.os === 'linux' ? '~88 KB' : '~4 KB') + ' a command)' });
            else if (data) {
              let to = String(cmd.to);
              let st = os.ok ? await deskOp('stat', { path: to }) : os;
              // a FOLDER as the destination: the file goes inside it, under its own name
              if (st.ok && st.exists && st.dir) { to = st.full.replace(/[\\/]+$/, '') + (os.os === 'windows' ? '\\' : '/') + leaf(cmd.file); st = await deskOp('stat', { path: to }); }
              let go = st.ok, replaced = false;
              if (!st.ok) reply(st);
              else if (st.exists && st.dir) { go = false; reply({ ok: false, why: st.full + ' is a folder' }); }
              else if (st.exists && !cmd.overwrite) { go = false; reply({ ok: false, why: 'there is already a file at ' + st.full + ' -- nothing was written. overwrite:1 asks the room before replacing it, or send it under another name', exists: true }); }
              else if (st.exists) {
                const a = await askRoom('📄 **May I replace ' + st.full + '** on this machine with ' + leaf(cmd.file) + ' (' + humanBytes(data.length) + ')?' + why, { ms: Number(cmd.timeout) || 60000 });
                if (a.verdict !== 'approved') { go = false; reply({ ok: false, why: 'the room did not say yes to replacing ' + st.full + ' -- nothing was written', verdict: a.verdict, replies: a.replies }); }
                else replaced = true;
              }
              if (go) {
                say('Putting ' + leaf(cmd.file) + ' on this machine');
                const b64 = data.toString('base64'), stepN = Math.max(4, desk.writeChunk(os.os, to) || 4);
                let r = { ok: true, size: 0 }, n = 0, lastPct = -1;
                for (let i = 0; i === 0 || i < b64.length; i += stepN) {
                  if (stopped) { r = { ok: false, why: stopped }; break; }
                  r = await deskOp('write', { path: to, b64: b64.slice(i, i + stepN), append: i > 0, at: i > 0 ? (i / 4) * 3 : undefined });
                  n++; trips++; wire += Math.min(stepN, b64.length - i);
                  if (!r.ok) break;
                  const pct = b64.length ? Math.floor(((i + stepN) / b64.length) * 10) * 10 : 100;
                  if (pct !== lastPct && pct < 100 && b64.length > stepN * 4) { lastPct = pct; say('Putting ' + leaf(cmd.file) + ' on this machine — ' + pct + '%'); }
                }
                if (!r.ok) reply({ ok: false, why: 'stopped after ' + humanBytes(Math.min(data.length, Number(r.size) || 0)) + ' of ' + humanBytes(data.length) + ': ' + r.why + ' -- the part already written is at ' + (st.full || to), partial: true });
                else if (Number(r.size) !== data.length) reply({ ok: false, why: 'the file on the machine is ' + humanBytes(Number(r.size) || 0) + ', not ' + humanBytes(data.length) + ' -- send it again', partial: true });
                else {
                  roomNote('📄 I put **' + leaf(cmd.file) + '** (' + humanBytes(data.length) + ') on this machine at `' + (r.full || st.full || to) + '`' + (replaced ? ', replacing the one that was there' : '') + '.');
                  reply({ ok: true, to: r.full || st.full || to, size: data.length, commands: n, replaced });
                }
              }
            }
          } else {
            // A WEBCAM PHOTO, or A FEW SECONDS OF WHAT THE MACHINE IS PLAYING (loopback -- never a microphone). The
            // room is asked FIRST, every time, naming the device; the standing yes does not apply: silence is a no.
            const cam = cmd.do === 'camera';
            const secs = Math.max(1, Math.min(7, Math.round(Number(cmd.seconds) || 5)));
            const dry = await deskOp(cmd.do, cam ? { device: cmd.device, dry: 1 } : { seconds: secs, dry: 1 });
            if (!dry.ok) reply(dry);
            else {
              const dev = String(dry.device || (Array.isArray(dry.cameras) && dry.cameras[0]) || (cam ? 'the camera' : 'the speakers'));
              const q = cam ? '📷 **May I take one photo with this machine\'s camera** (' + dev + ')?' + why + ' Only a yes allows it.'
                            : '🔊 **May I record ' + secs + ' seconds of what this machine is playing** (' + dev + ' — its sound output, not the microphone)?' + why + ' Only a yes allows it.';
              const a = await askRoom(q, { ms: Number(cmd.timeout) || 60000, standing: false });
              if (a.verdict !== 'approved') reply({ ok: false, why: a.verdict === 'cancelled' ? 'the room said no' : 'nobody said yes -- a ' + (cam ? 'photo' : 'recording') + ' is never taken without one', verdict: a.verdict, replies: a.replies });
              else {
                say(cam ? 'Taking a photo with the camera' : 'Recording what this machine is playing');
                const c = await deskOp(cmd.do, cam ? { device: cmd.device } : { seconds: secs }, 30000);
                if (!c.ok) reply(c);
                else {
                  const f = await readAll(c.path, 50 * 1048576);
                  await deskOp('rm', { path: c.path });
                  if (!f.ok) reply(f);
                  else {
                    const out = saveLocal(cmd.out, f.buf);
                    capture(out, cmd.keep);   // like a screenshot: it leaves with the visit unless kept
                    roomNote(cam ? '📷 I took one photo with the camera (' + dev + ').' : '🔊 I recorded ' + (Number(c.seconds) || secs) + ' seconds of what this machine is playing.');
                    reply(Object.assign({ ok: true, file: out, size: f.buf.length, device: dev, mime: c.mime }, cam ? {} : { seconds: c.seconds, peak: c.peak, note: c.note }));
                  }
                }
              }
            }
          }
        } else if (cmd.do === 'exec') {                // RUN ONE COMMAND on the host (needs --shell)
          // Gated three ways and it matters: this is the only verb that is the MACHINE rather than the
          // picture. The relay refuses it unless the grant was given `shell` (GRANT_SHELL_VERBS), the
          // person approved that in those words on the card, and the output comes straight back. We also
          // refuse it locally without --shell so the failure is a clear sentence, not a relay nak. The
          // host runs it in its NATIVE shell -- cmd.exe on Windows (wrap `powershell -Command "..."`
          // yourself if you want PowerShell), /bin/sh -c on Linux. One command, one result; for an
          // interactive shell there is no verb, by design.
          if (!grantShell) { reply({ ok: false, why: 'this visit was not granted command-running -- ask for it: {"do":"access","shell":1,"why":"…"} puts a new Allow card in front of the operator', needs: 'shell' }); }
          else {
            const command = String(cmd.cmd == null ? cmd.text : cmd.cmd || '');
            if (!command.trim()) { reply({ ok: false, why: 'exec needs a `cmd` string' }); }
            else {
              const rid = ++reqSeq;
              // Narrate only when nothing richer is driving: a tree owns the line (systemic rule), an
              // explicit intent is the author's words, and a quiet step opted out.
              if (cmd.intent == null && !cmd.quiet && !lastDrive.tree) driveStatus('Running a command');
              ws.send({ type: 'exec', reqId: rid, cmd: command });
              const ms = Math.max(1000, Math.min(120000, Number(cmd.timeout) || 30000));
              const r = await raceStop(ws.waitFor((m) => m.type === 'exec-result' && m.reqId === rid, ms + 2000));
              if (!r) { reply({ ok: false, why: stopped || 'the host did not answer in time' }); }
              else if (r.error) { reply({ ok: false, why: String(r.error) }); }   // relay's own sentence (input disabled, busy)
              else {
                let output = '';
                if (r.data) { try { output = Buffer.from(String(r.data), 'base64').toString('utf8'); } catch (_) { output = ''; } }
                const code = (typeof r.code === 'number') ? r.code : -1;
                reply({ ok: code === 0, code, output, truncated: !!r.truncated });
              }
            }
          }
        } else if (cmd.do === 'inbox') {               // the operator's recent messages; clears the interrupt + unread
          const messages = readInbox();
          interrupt = null; unreadIds = [];
          reply({ ok: true, n: messages.length, messages });
        } else if (cmd.do === 'typing') {              // "Claude typing..." while you compose a reply
          // A transient ping the viewer expires on its own, so it repeats on a short beat until you send
          // a message (chat / chat-img / done clear it) or call typing {on:false}. Use it the moment you
          // start composing an answer, so the wait reads as a reply coming rather than as silence.
          if (cmd.on === false) { stopTyping(); reply({ ok: true, typing: false }); }
          else {
            stopTyping();
            const ping = () => { try { ws.send({ type: 'chat-typing' }); } catch (_) {} };
            ping(); typingTimer = setInterval(ping, 1500); if (typingTimer.unref) typingTimer.unref();
            reply({ ok: true, typing: true });
          }
        } else if (cmd.do === 'seen') {                // mark the operator's message(s) read -- a receipt
          const ids = (Array.isArray(cmd.ids) && cmd.ids.length ? cmd.ids.map(String) : unreadIds).slice(0, 200);
          if (!ids.length) reply({ ok: true, seen: 0 });
          else {
            const m = { type: 'chat-read', ids }; if (cmd.to) m.to = String(cmd.to);
            ws.send(m);
            const mk = new Set(ids); unreadIds = unreadIds.filter((x) => !mk.has(x)); interrupt = null;
            reply({ ok: true, seen: ids.length });
          }
        } else if (cmd.do === 'confirm') {             // gate a dangerous action on a human yes in chat
          // Announce it to EVERYONE and wait for a verdict. A cancel wins at any point in the window,
          // even after a yes; a bare yes is needed to come back 'approved'; silence or anything unclear
          // is 'unclear', and the caller decides (a restart should treat that as no). The raw replies
          // ride back so the driver can judge for itself. See config/etiquette.md and plans/05.
          //
          // STANDING YES (--auto-confirm / SM_AUTO_CONFIRM): the operator pre-approved these before they
          // stepped away. We STILL announce and STILL wait the window, and a "stop/no/wait" STILL wins at
          // any point -- only a SILENT window flips from 'unclear' to 'approved' (marked `auto:true`), so
          // the agent proceeds instead of stalling with nobody there to type "yes". A human yes or a
          // cancel is untouched, so the standing yes can never talk over a real "stop".
          // (askRoom below holds the window: the confirm verb keeps listening to its end, so a late cancel wins)
          const a = await askRoom(String(cmd.text || ''), { ms: cmd.timeout, grace: Infinity });
          reply({ ok: true, verdict: a.verdict, replies: a.replies, auto: a.auto });
        } else if (cmd.do === 'budget') {              // the task's budget: show it, lower it, or ask the room for more
          // {} shows it. {steps, minutes}: a LOWER limit is simply taken; a higher one -- or none (0) -- is asked of
          // the room, as going on is. {more:1, why}: the budget is spent (or nearly): ask whether to carry on. When
          // the serve already asked (the first refused command does), a `more` without a new reason does not ask
          // twice: it waits for the answer, and hears one the room already gave.
          const why = cmd.why != null ? String(cmd.why).slice(0, 300) : '';
          const ms = Number(cmd.timeout) || 60000;
          if (cmd.more) {
            const recent = budgetAskedAt && Date.now() - budgetAskedAt < 10 * 60000;
            const a = await askRoom(recent && !why ? '' : BUD.question(why), { ms, since: recent ? budgetAskedAt : 0 });
            if (a.verdict === 'approved') { BUD.more({ steps: cmd.steps, minutes: cmd.minutes }); budgetAskedAt = 0; }
            else budgetAskedAt = Date.now();   // heard: asking again listens to what comes after this answer
            const out = { ok: true, verdict: a.verdict, replies: a.replies, auto: a.auto, budget: BUD.brief() };
            if (a.verdict === 'cancelled') out.hint = 'the room said no: finish the task -- status {fin:1, say, file}';
            else if (a.verdict === 'unclear') out.hint = 'no clear answer yet: wait for the room (chat-wait), then ask again';
            reply(out);
          } else if (cmd.steps != null || cmd.minutes != null) {
            const w = BUD.want({ steps: cmd.steps, minutes: cmd.minutes });
            if (!w.raises) { BUD.set(w); reply({ ok: true, budget: BUD.brief() }); }
            else {
              const asks = [];
              if (w.steps != null) asks.push(w.steps ? w.steps + ' steps' : 'no limit on steps');
              if (w.minutes != null) asks.push(w.minutes ? w.minutes + ' minutes' : 'no time limit');
              const a = await askRoom('⏱ May I give this task more room — ' + asks.join(' and ') + '?' + (why ? ' ' + why : ''), { ms });
              if (a.verdict === 'approved') BUD.set(w);
              reply({ ok: true, verdict: a.verdict, replies: a.replies, auto: a.auto, budget: BUD.brief() });
            }
          } else reply({ ok: true, budget: BUD.brief() || { none: true, why: 'no budget: --budget-steps and --budget-min are 0' } });
        } else if (cmd.do === 'note-list') {           // the host's sticky notes, as the agent has them
          reply({ ok: true, notes: [...notesMap.values()] });
        } else if (cmd.do === 'note-add') {            // leave a sticky note on the host's board
          const text = String(cmd.text || '').slice(0, 300);
          if (!text) reply({ ok: false, why: 'note-add needs text' });
          else {
            const id = 'a' + Math.random().toString(36).slice(2, 12);
            const x = Math.max(0, Math.min(1, cmd.x != null ? Number(cmd.x) : 0.12));
            const y = Math.max(0, Math.min(1, cmd.y != null ? Number(cmd.y) : 0.14));
            ws.send({ type: 'spot', k: 'note', id, x, y, text });
            notesMap.set(id, { id, text, name: selfName, x, y, resolved: false, kind: 'note' }); notesSave();
            reply({ ok: true, id });
          }
        } else if (cmd.do === 'note-done') {           // cross a task off: resolve it (undo:true un-resolves)
          const id = String(cmd.id || '');
          const nt = notesMap.get(id);
          if (!nt) reply({ ok: false, why: 'no note "' + id + '" -- note-list first' });
          else {
            const on = !cmd.undo;
            ws.send({ type: 'spot', k: 'note', id, x: nt.x, y: nt.y, resolved: on });
            nt.resolved = on; notesSave();
            reply({ ok: true, resolved: on });
          }
        } else if (cmd.do === 'beam') {                // FOCUS BEAM: dim the watchers' picture except around x,y
          // THE BEAM IS NOT THE SPOTLIGHT. The viewer has two separate tools and calls this one "the focus
          // beam" -- it DIMS everything except a circle round the point. A co-viewer's beam expires in ~2s,
          // so refresh it for `hold` ms (default a short couple of seconds; 0 = emit once) -- or, with
          // `forever:1`, until the operator writes or presses Stop (30 min at most), as a person would hold it.
          const x = Math.max(0, Math.min(1, Number(cmd.x) || 0));
          const y = Math.max(0, Math.min(1, Number(cmd.y) || 0));
          const bs = Math.max(8, Math.min(60, Number(cmd.size) || 26));
          const hold = cmd.forever ? 30 * 60 * 1000 : Math.max(0, Math.min(20000, cmd.hold != null ? Number(cmd.hold) : 2500));
          const beam = () => { try { ws.send({ type: 'spot', k: 'm', x, y, beam: 1, bs }); } catch (_) {} };
          beam();
          const until = Date.now() + hold;
          while (Date.now() < until && !stopped && !(cmd.forever && interrupt)) { await sleep(1200); if (!stopped) beam(); }
          reply(interrupt && cmd.forever ? { ok: true, stoppedAt: { interrupted: true, why: 'the operator spoke: ' + String(interrupt.text || '').slice(0, 80) } } : { ok: true });
        } else if (cmd.do === 'spotlight') {
          // SPOTLIGHT, the viewer's "point & draw for co-viewers" tool -- done the way a PERSON does it.
          // Reported: "your spotlight effect is different from real user's spotlight effect and you just
          // spotlight once (draw only one round) with a little fast speed". A person's (viewer btnSpot: move
          // to point, drag to draw, click to ping) is a laser dot that TRAVELS to the thing, circles it --
          // each drag its own stroke, which holds 1.2 s and then fades over 1.6 s -- and pings ON it. So:
          //   approach  the dot glides from where the agent's pointer last was to the shape (k:'m', no ink)
          //   rounds    each a FRESH stroke (k:'d' n:1 ... k:'e'), a few px wider than the one before and
          //             drawn while that one fades. One stroke retraced over its own ink cannot be seen,
          //             which is why the old `laps` read as a single round.
          //   pace      by DISTANCE at a hand's speed (`speed`, default 700 px/s), a point every 33 ms (the
          //             viewer's own 30/s), and never under 1.5 s or over 2.4 s a round
          //   pings     `times` (default 2) at the centre, where a click would land
          // Shape, in SCREEN PIXELS: rect:[x1,y1,x2,y2] (a field, a panel, the whole screen) · circle:{cx,cy,r}
          // or cx,cy,r · points:[[x,y],...] (closed unless close:false) · else a ring of radius `r` round the
          // normalised x,y. `rounds` (default 3; `laps` is its old name; circle:false = pings only) ·
          // `forever:1` keeps circling, a ping every third round, until the operator writes or presses Stop
          // (30 min at most). The operator writing ends ANY spotlight, as it ends a plan: `stoppedAt.interrupted`.
          const num = (v) => Number(v);
          const R = (Array.isArray(cmd.rect) && cmd.rect.length === 4 && cmd.rect.every((v) => Number.isFinite(num(v)))) ? cmd.rect.map(num) : null;
          const P = Array.isArray(cmd.points) ? cmd.points.map((p) => [num(p && p[0]), num(p && p[1])]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
          const C = (cmd.circle && typeof cmd.circle === 'object') ? cmd.circle : null;
          const ccx = num(C ? C.cx : cmd.cx), ccy = num(C ? C.cy : cmd.cy);
          const inX = (v) => Math.max(0, Math.min(SW - 1, v)), inY = (v) => Math.max(0, Math.min(SH - 1, v));
          // the shape `g` px wider than asked, as a closed path in screen pixels
          let shapeAt, cx, cy;
          if (R) {
            const x1 = Math.min(R[0], R[2]), x2 = Math.max(R[0], R[2]), y1 = Math.min(R[1], R[3]), y2 = Math.max(R[1], R[3]);
            cx = (x1 + x2) / 2; cy = (y1 + y2) / 2;
            shapeAt = (g) => { const a = inX(x1 - g), b = inX(x2 + g), t = inY(y1 - g), u = inY(y2 + g); return [[a, t], [b, t], [b, u], [a, u], [a, t]]; };
          } else if (P.length >= 2) {
            cx = P.reduce((s, p) => s + p[0], 0) / P.length; cy = P.reduce((s, p) => s + p[1], 0) / P.length;
            shapeAt = (g) => {
              const q = P.map(([px, py]) => { const d = Math.hypot(px - cx, py - cy) || 1; return [inX(px + (px - cx) / d * g), inY(py + (py - cy) / d * g)]; });
              return cmd.close === false ? q : q.concat([q[0]]);
            };
          } else {
            const r = Math.max(6, Math.min(400, num(C ? C.r : cmd.r) || 46));
            const haveC = Number.isFinite(ccx) && Number.isFinite(ccy);
            cx = haveC ? ccx : Math.max(0, Math.min(1, num(cmd.x) || 0)) * SW;
            cy = haveC ? ccy : Math.max(0, Math.min(1, num(cmd.y) || 0)) * SH;
            shapeAt = (g) => { const out = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2 - Math.PI / 2; out.push([inX(cx + Math.cos(a) * (r + g)), inY(cy + Math.sin(a) * (r + g))]); } return out; };
          }
          const FRAME = 33, speed = Math.max(150, Math.min(3000, num(cmd.speed) || 700));
          // a path walked at `speed`, one point a frame, every corner kept so a box stays square
          const walk = (path) => {
            let len = 0;
            for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
            const stepPx = len / Math.max(8, Math.round(Math.max(1500, Math.min(2400, len / speed * 1000)) / FRAME)), out = [path[0]];
            for (let i = 1; i < path.length && stepPx > 0; i++) {
              const [ax, ay] = path[i - 1], [bx, by] = path[i], n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / stepPx));
              for (let s = 1; s <= n; s++) out.push([ax + (bx - ax) * s / n, ay + (by - ay) * s / n]);
            }
            return out;
          };
          const at = ([px, py]) => ({ x: Math.max(0, Math.min(0.99999, px / SW)), y: Math.max(0, Math.min(0.99999, py / SH)) });
          const send = (m) => { try { ws.send(Object.assign({ type: 'spot' }, m)); } catch (_) {} };
          const cut = () => !!(stopped || interrupt);
          const want = cmd.rounds != null ? cmd.rounds : cmd.laps;
          const rounds = cmd.forever ? Infinity : cmd.circle === false ? 0 : Math.max(1, Math.min(12, Math.round(num(want)) || 3));
          const times = Math.max(0, Math.min(12, cmd.times != null ? Math.round(num(cmd.times)) || 0 : 2));
          const until = Date.now() + 30 * 60 * 1000;
          // approach: the laser dot glides to where the first round starts, eased the way a hand moves
          const from = [ptrPos.x * SW, ptrPos.y * SH], to = rounds ? shapeAt(0)[0] : [cx, cy];
          const glide = Math.max(1, Math.round(Math.max(250, Math.min(700, Math.hypot(to[0] - from[0], to[1] - from[1]) / 1.6)) / FRAME));
          for (let i = 1; i <= glide && !cut(); i++) {
            const e = i / glide, k = e < 0.5 ? 2 * e * e : 1 - Math.pow(2 - 2 * e, 2) / 2;
            send(Object.assign({ k: 'm' }, at([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k])));
            await sleep(FRAME);
          }
          let done = 0, pinged = 0;
          const ping = () => { send(Object.assign({ k: 'p' }, at([cx, cy]))); pinged++; };
          for (let r = 0; r < rounds && !cut() && Date.now() < until; r++) {
            const pts = walk(shapeAt((r % 3) * 6));
            for (let i = 0; i < pts.length && !cut(); i++) { send(Object.assign({ k: 'd' }, at(pts[i]), i ? {} : { n: 1 })); await sleep(FRAME); }
            send({ k: 'e' });
            done++;
            if (cmd.forever && done % 3 === 0 && !cut()) { ping(); await sleep(850); }
            else if (r + 1 < rounds && !cut()) await sleep(450);   // the round before has begun to fade
          }
          for (let i = 0; i < times && !cut(); i++) { ping(); if (i < times - 1) await sleep(850); }
          Object.assign(ptrPos, at([cx, cy]));
          const res = { ok: true, rounds: done, pinged, shape: R ? 'rect' : P.length >= 2 ? 'points' : 'circle' };
          if (interrupt && !stopped) res.stoppedAt = { interrupted: true, why: 'the operator spoke: ' + String(interrupt.text || '').slice(0, 80) };
          reply(res);
        } else if (cmd.do === 'spotlight-off') {       // stop dimming (a plain move clears the beam)
          const x = Math.max(0, Math.min(1, cmd.x != null ? Number(cmd.x) : 0.5));
          const y = Math.max(0, Math.min(1, cmd.y != null ? Number(cmd.y) : 0.5));
          try { ws.send({ type: 'spot', k: 'm', x, y }); } catch (_) {}
          reply({ ok: true });
        } else if (cmd.do === 'lock') {                // take/release EXCLUSIVE control of this host
          // Needs a --control grant; disarms the other operators while held. Ask first (etiquette), and
          // RELEASE the moment the work is done -- the lock also dies by itself when the grant ends.
          const on = !!cmd.on;
          ws.send({ type: 'control-lock', on });
          driveStatus(on ? 'Taking exclusive control' : 'Releasing control');
          reply({ ok: true, on });

        // ---- looking, which is the half that used to cost everything ------------------------------
        } else if (cmd.do === 'hold') {                // a new picture: identity only, ~5.5 KB
          const n = await needFrame(true);
          reply(n.ok ? { ok: true, id: frame.id, w: frame.w, h: frame.h, total: frame.total, bytes: frame.wire } : { ok: false, why: n.why });
        } else if (cmd.do === 'see') {                 // decode down to a rectangle, no further
          const s = await lookAt(cmd.rect || null);
          reply(s.ok ? { ok: true, rows: img.rows, of: img.h, got: frame.buf.length, total: frame.total,
                         share: +(frame.buf.length / frame.total).toFixed(3) } : { ok: false, why: s.why });
        } else if (cmd.do === 'mark') {                // this picture is the baseline from here
          const s = await lookAt(cmd.rect || null);
          if (!s.ok) reply({ ok: false, why: s.why });
          else { marked = img; reply({ ok: true, rows: img.rows }); }
        } else if (cmd.do === 'ocr') {                 // the words in a rectangle; NO new capture
          const n = await needFrame();
          if (!n.ok) reply({ ok: false, why: n.why });
          else {
            const r = await readText(ws, frame, cmd.rect || null, cmd.lang || LANG); trips++;
            reply(r.ok ? { ok: true, text: r.text, words: r.words, lines: cmd.boxes ? r.lines : undefined }
                       : { ok: false, why: r.why, stale: !!r.gone });
          }
        } else if (cmd.do === 'find') {                // where on the screen is the word "Export"?
          const f = await findWord(cmd.rect, cmd.text, cmd.nth, cmd.lang);
          if (!f.ok) reply({ ok: false, why: f.why, stale: f.stale });
          else { if (f.pick && cmd.as) vars[String(cmd.as)] = f.pick;
            reply(f.pick ? { ok: true, found: f.pick, of: f.hits.length, all: cmd.all ? f.hits : undefined }
                         : { ok: false, why: 'no word like "' + String(cmd.text || '') + '" is on that part of the screen', saw: f.saw }); }
        } else if (cmd.do === 'clickText') {           // find a word on screen and click it -- no hand-measured x,y
          const f = await findWord(cmd.rect, cmd.text, cmd.nth, cmd.lang);
          if (!f.ok) reply({ ok: false, why: f.why, stale: f.stale });
          else if (!f.pick) reply({ ok: false, why: 'no word like "' + String(cmd.text || '') + '" to click', saw: f.saw });
          else { const p = f.pick; if (cmd.as) vars[String(cmd.as)] = p;
            await clickAt(p.cx + (Number(cmd.dx) || 0), p.cy + (Number(cmd.dy) || 0), SW, SH, cmd.fast);
            reply({ ok: true, at: [p.cx, p.cy], text: p.text, of: f.hits.length }); }
        } else if (cmd.do === 'probe') {               // one pixel, exactly
          const a = aimAt(cmd);
          const x = Math.round(a.ok ? a.x : 0), y = Math.round(a.ok ? a.y : 0);
          const s = a.ok ? await lookAt({ x, y, w: 1, h: 1 }) : a;
          reply(s.ok ? { ok: true, at: [x, y], is: eyes.probe(img, x, y) } : { ok: false, why: s.why });
        } else if (cmd.do === 'census') {              // every connected region, biggest first
          const s = await lookAt(cmd.rect || null);
          reply(s.ok ? Object.assign({ ok: true }, eyes.census(img, cmd.rect || {}, cmd.cap)) : { ok: false, why: s.why });
        } else if (cmd.do === 'flood') {               // where WOULD a bucket fill go, before pouring
          const s = await lookAt(cmd.bound || null);
          reply(s.ok ? Object.assign({ ok: true }, eyes.flood(img, Math.round(cmd.x), Math.round(cmd.y), cmd.bound)) : { ok: false, why: s.why });
        } else if (cmd.do === 'diff') {                // what moved since the mark
          const s = await lookAt(cmd.rect || null);
          if (!s.ok) reply({ ok: false, why: s.why });
          else if (!marked) reply({ ok: false, why: 'nothing to compare against -- `mark` first' });
          else reply(Object.assign({ ok: true }, eyes.diff(marked, img, cmd.rect)));
        } else if (cmd.do === 'liveness') {            // is the capture LIVE, or blank / frozen? (vision/liveness.js)
          // Measures the current frame rather than looking at it: blank = a near-solid capture (a maximised
          // window, a half-loaded page), frozen = all but identical to the frame before it. A fresh look, so
          // `before` holds the prior frame the frozen check needs; call it twice for a clean two-shot freeze test.
          if (cmd.fresh !== false) frame = null;
          const s = await lookAt(cmd.rect || null);
          reply(s.ok ? live.assess(before, img, cmd.rect ? { rect: cmd.rect } : {})
                     : { state: 'unknown', ok: false, why: s.why });

        // ---- knowing, rather than hoping ----------------------------------------------------------
        } else if (cmd.do === 'expect') {
          // "IS IT TRUE NOW" MUST MEAN NOW. This used to evaluate against whatever picture was still
          // held, so it answered about the past: a `wait` for a lamp to come on returned true on its
          // first look because the held frame was taken while the lamp was still on, and a `changed`
          // after a `mark` compared the marked picture with itself and saw nothing move. Asking
          // several things about ONE picture is still cheap and still supported -- `hold` once, then
          // probe/ocr/census -- or pass {fresh:false} to say that is what you meant.
          if (cmd.fresh !== false) frame = null;
          const v = await evaluate(cmd.until || cmd.expect);
          reply(Object.assign({ ok: v.ok, held: v.ok }, v));
        } else if (cmd.do === 'wait') {
          // POLL CHEAPLY UNTIL IT IS TRUE, which is what every fixed sleep in this file was pretending
          // to do. `open` waited 2500 ms whether the page had loaded in 200 or had not loaded at all.
          const until = cmd.until || cmd.expect;
          const t0 = Date.now(), deadline = t0 + (Number(cmd.timeout) || 15000);
          const poll = Math.max(120, Number(cmd.poll) || 400);
          let v = null, n = 0;
          for (;;) {
            n++;
            frame = null;                              // EVERY look is a new picture, the first one
            v = await evaluate(until);                 // included -- see `expect` above
            if (v.ok || Date.now() >= deadline || stopped) break;
            await sleep(poll);
          }
          reply(Object.assign({ ok: v.ok, held: v.ok, polls: n, ms: Date.now() - t0 }, v));

        // ---- a whole plan, verified step by step ---------------------------------------------------
        } else if (cmd.do === 'plan') {
          // ONE ROUND TRIP FROM THE CALLER, MANY VERIFIED STEPS ON THE MACHINE -- and now a plan may
          // CHOOSE and REPEAT, not only march. The slowest thing in this whole system is not a step,
          // it is coming back to ask what the next step should be: every answer that has to cross back
          // to whoever is driving costs their thinking time, which dwarfs anything measured here. A
          // choice taken on the machine is a round trip that never happens.
          //
          //   {do:'click', ...}                      a step, as before
          //   {if:<expectation>, then:[..], else:[..]}
          //   {repeat:N, until:<expectation>, steps:[..], poll:ms}
          //
          // A plan still stops at the FIRST step whose screen did not agree, and says which.
          // THE WHOLE PLAN IS CHECKED BEFORE ITS FIRST STEP (core/verbs.js): a slip at step 9 refuses the plan,
          // instead of leaving steps 1-8 done and the machine half-way through something.
          const vp = depth === 0 ? verbs.vetPlan(cmd.steps) : { ok: true, steps: cmd.steps, fixed: [] };
          if (!vp.ok) reply({ ok: false, why: vp.why, refused: true, stoppedAt: { at: vp.at, why: vp.why }, ran: 0 });
          else if (depth > 2) reply({ ok: false, why: 'plans may not nest more than twice' });
          else {
            if (vp.fixed.length) noteFixed(vp.fixed);
            depth++;
            const res = await runSteps(Array.isArray(vp.steps) ? vp.steps : [], depth === 1);
            depth--;
            reply({ ok: !res.bad, ran: res.ran, of: res.of, stoppedAt: res.bad,
                    steps: cmd.quiet ? undefined : res.done });
          }
        } else if (cmd.do === 'mission') {           // the job's big plan: milestones, proof, replanning out loud
          await missionOp(cmd);
        } else reply({ ok: false, why: 'unknown command "' + cmd.do + '"' });
      } catch (e) { reply({ ok: false, why: (e && e.message) || String(e) }); }

      // "SENT" IS NOT "LANDED", and until now this file only ever reported the first. Any verb may
      // carry an expectation; it is checked against a picture taken AFTER the action, so a click that
      // went to a window that had stolen focus, or a key the relay silently refused, fails here
      // instead of three steps later wearing a different error.
      if (out && out.ok && cmd.expect && !LOOKS.has(cmd.do)) {
        frame = null;                                  // what we hold is from before the action
        const v = await evaluate(cmd.expect);
        out = Object.assign({}, out, { held: v.ok, expect: v });
        if (!v.ok) { out.ok = false; out.why = 'it was sent, but the screen did not agree: ' + (v.saw || v.pred); }
      }
      // ...AND A PICTURE OF WHAT IT DID, as the same command (look:{out,rect,max,settle}): act-then-look is the
      // commonest pair a driver sends, and as two commands it is two round trips through its thinking. Taken
      // after the expectation, so it shows the screen the check agreed with. A failed look does not undo the act.
      if (out && cmd.look && typeof cmd.look === 'object' && !LOOKS.has(cmd.do) && cmd.do !== 'look') {
        const lk = await doLook(Object.assign({ settle: 300 }, cmd.look));
        out = Object.assign({}, out, { look: lk });
      }
      return out;
    }

    // WAITING ON A FILE WITHOUT SLEEPING ON IT. This loop used to poll every 150 ms, and because a
    // driver writes its next command the instant it has read the last answer, the wait was the FULL
    // tick nearly every time rather than half of it. Measured: 151 ms of pure sleep on EVERY command,
    // which for a plan of twenty steps is three seconds of nothing at all. fs.watch fires on the write
    // itself. The poll stays underneath as a floor, slowed right down, because a watcher can miss an
    // event on a network path or a filesystem that does not report one, and a command that is never
    // answered is a worse failure than a command answered slowly.
    let poke = null;
    let watcher = null;
    try { watcher = fs.watch(dir, () => { const f = poke; poke = null; if (f) f(); }); } catch (_) { watcher = null; }
    const nextCommand = () => new Promise((res) => {
      if (fs.existsSync(cmdFile)) return res(true);
      let done = false;
      const fire = () => { if (done) return; done = true; clearTimeout(t); poke = null; res(fs.existsSync(cmdFile)); };
      poke = fire;
      const t = setTimeout(fire, watcher ? 250 : 30);
    });

    // A dropped socket wakes the loop at once rather than on the next command: `died` fires onDead,
    // which pokes the command wait so the loop reaches its ws.dead check below and reconnects. Set on
    // every socket -- here for the first, inside reconnect() for each later one.
    const wake = () => { const f = poke; poke = null; if (f) f(); };
    ws.onDead = wake;

    // RECONNECT -- the socket died (a plain drop or a relay move), not a revoke. Get a fresh grant on
    // whichever relay now has the host, re-arm the taps and the watcher on the new socket, and carry
    // on. The work dir, the notes board and the frame size all persist, so the driver's plan resumes
    // where it paused. reconnecting.json is present while it waits for the new Allow (reconnect.json
    // carries the code to surface); stalled.json is left if it gives up.
    let reconnects = 0;
    // How long to keep trying a dropped session before giving up. A relay outage or a laptop asleep for a
    // few minutes should NOT end an overnight grant, so the default is generous; SM_RECONNECT_MAX_MS sets
    // it (tests set it low). This is the exact hole that stranded the 10001 session: one failed pass wrote
    // stalled.json and quit.
    const RECONNECT_CEILING_MS = Math.max(5000, parseInt(process.env.SM_RECONNECT_MAX_MS || '', 10) || 600000);
    async function reconnect() {
      reconnects++;
      say('[.] the connection dropped (' + (ws.dead || 'unknown') + ') -- reconnecting');
      const statusFile = path.join(dir, 'reconnecting.json'), codeFile = path.join(dir, 'reconnect.json');
      // Dial the relay we were ACTUALLY on first (it may be a federation sibling, not the cold default),
      // then the rest; dialAndJoin dedups and falls through a no-host, so this is safe if the host moved.
      const relayList = [lastGoodRelay].concat(RELAYS).map((r) => String(r || '').trim())
        .filter((r, i, a) => r && a.indexOf(r) === i);
      // BOUNDED BACKOFF. A dropped socket is usually a relay move or a blip, so on a transient failure we
      // wait a growing gap (2s,4s,8s… cap 60s) and re-dial -- re-resolving DNS and re-discovering the
      // federation each pass -- until we are back, the grant is revoked (`stopped`), or the ceiling. A
      // human refusal (off/no/denied -> retry:false) is a decision, not a blip: it stops at once, never
      // loops, so retrying never nags a person who said no. A dial-stage failure raises no Allow card, so
      // retrying a bare transport failure does not nag anyone either.
      let waitMs = 2000;
      const deadline = Date.now() + RECONNECT_CEILING_MS;
      for (let attempt = 1; !stopped; attempt++) {
        try { fs.writeFileSync(statusFile, JSON.stringify({ at: Date.now(), why: ws.dead || 'dropped', attempt, reconnects })); } catch (_) {}
        const d = await dialAndJoin(relayList, (code, relay) => {
          showCode(code, relay);
          try { fs.writeFileSync(codeFile, JSON.stringify({ code, relay, at: Date.now() })); } catch (_) {}
        }, true);
        try { fs.unlinkSync(codeFile); } catch (_) {}
        if (d.ok) {
          ws = d.ws; selfName = d.user; ws.onDead = wake; lastGoodRelay = d.relay || lastGoodRelay;
          viewPaused = false; clearTimeout(repauseTimer); setPaused(true);   // the new socket's select cleared the pause
          attachWatch(ws); attachTaps(ws);
          try { fs.unlinkSync(statusFile); } catch (_) {}
          try { fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ w: SW, h: SH, host: HOST, at: Date.now(), reconnected: reconnects, relay: lastGoodRelay })); } catch (_) {}
          frame = null; img = null; before = null;      // the held picture belonged to the dead socket
          say('[+] reconnected -- machine ' + HOST + ' is open again' + (attempt > 1 ? ' (after ' + attempt + ' tries)' : ''));
          // the old grant's release cleared the watchers' panel ("ended"): put the picture back at once,
          // not only when the next command or heartbeat happens to send it
          try { sendDrive(); } catch (_) {}
          return true;
        }
        // A reason retrying cannot fix (bad key, joining off, a person said no), or the ceiling reached: stop.
        if (d.retry === false || Date.now() + waitMs >= deadline) {
          say('[x] could not reconnect: ' + d.why);
          try { fs.writeFileSync(path.join(dir, 'stalled.json'), JSON.stringify({ ok: false, why: d.why, dropped: true, attempts: attempt, at: new Date().toISOString() })); } catch (_) {}
          try { fs.unlinkSync(statusFile); } catch (_) {}
          return false;
        }
        say('[.] reconnect attempt ' + attempt + ' did not land (' + d.why + ') -- waiting ' + Math.round(waitMs / 1000) + 's, then trying again');
        try { fs.writeFileSync(statusFile, JSON.stringify({ at: Date.now(), why: ws.dead || 'dropped', attempt, reconnects, nextTryInMs: waitMs })); } catch (_) {}
        const until = Date.now() + waitMs;
        while (Date.now() < until && !stopped) { await new Promise((r) => setTimeout(r, Math.min(250, Math.max(1, until - Date.now())))); }
        waitMs = Math.min(60000, waitMs * 2);
      }
      try { fs.unlinkSync(statusFile); } catch (_) {}   // `stopped` during backoff
      return false;
    }

    // KEEP THE PANEL ALIVE. Re-send the current status on a slow heartbeat so the viewers' progress
    // panel holds until the task ends rather than fading during a long step or a thinking pause. The
    // viewer treats a repeat as "still here", not a new step. Unref'd so it never keeps the process up.
    // ...but not a FINISHED one: the viewer fades a green panel after 8 s, and a 12 s heartbeat brought it back
    // -- 8 s on, 4 s off, for as long as the session stayed open (it is replayed to late joiners regardless).
    const keepAlive = setInterval(() => { if (!lastDrive.fin && (lastDrive.text || lastDrive.steps || lastDrive.thought || lastDrive.tree || (atAuto() && atx(() => AT.hasContent(), false))) && ws && !ws.dead && !relayDegraded) sendDrive(); }, 12000);
    if (keepAlive.unref) keepAlive.unref();

    for (;;) {
      // A drop (not a revoke) is recoverable: redial, get a fresh Allow, and resume. A revoke sets
      // `stopped` instead, and that still ends the run through the branch below.
      if (ws.dead && !stopped) { if (!(await reconnect())) break; }
      if (!(await nextCommand())) {
        if (stopped) {
          // LEAVE A NOTE RATHER THAN JUST VANISHING. Whoever is driving this is waiting on a file;
          // a serve loop that exits in silence because the visit was revoked is the same failure as
          // one that goes on reporting keys it never delivered, only quieter.
          //
          // The note goes in done.json ONLY IF NOTHING IS ALREADY THERE. A driver deletes that file
          // before it sends a command and reads it when it appears, so an empty slot means somebody
          // is waiting and a full one holds an answer they have not read yet -- and the first
          // version of this wrote over the answer, which for a plan cut short by the revoke was the
          // one thing in the run worth keeping: how far it got before it stopped. stopped.json is
          // written either way, so the reason survives whichever happened.
          say('[x] the visit ended: ' + stopped);
          const note = { ok: false, why: stopped, stopped: true, bye: true, at: new Date().toISOString() };
          try { fs.writeFileSync(path.join(dir, 'stopped.json'), JSON.stringify(note)); } catch (_) {}
          try { if (!fs.existsSync(outFile)) fs.writeFileSync(outFile, JSON.stringify(note)); } catch (_) {}
          break;
        }
        continue;                                    // nextCommand already waited
      }
      let cmd = null, raw = '';
      // A PARTIAL READ is a race, not a bad command: a batch (drive.js with an array, run.js) writes
      // cmd.json fast and the watcher can catch it mid-write (truncated JSON). Re-read a few times before
      // giving up, and only unlink once we have it -- so "unreadable command" means genuinely malformed,
      // not "the writer had not finished yet" (which once dropped a key press and the game never started).
      for (let tries = 0; tries < 6; tries++) {
        try { raw = fs.readFileSync(cmdFile, 'utf8'); } catch (_) { raw = ''; break; }
        if (raw) { try { cmd = JSON.parse(raw); break; } catch (_) {} }
        await sleep(15);
      }
      try { fs.unlinkSync(cmdFile); } catch (_) {}
      if (!cmd || typeof cmd !== 'object') { writeOut({ ok: false, why: 'unreadable command' }); continue; }
      // THE VERB TABLE (core/verbs.js), before anything reaches the panel or the machine: a refused command is
      // answered and recorded, and nothing of it is sent -- not even its narration.
      fixedNotes = [];
      {
        const v = verbs.vet(cmd);
        if (!v.ok) {
          const r0 = { ok: false, why: v.why, refused: true, ms: 0, bytes: 0, trips: 0 };
          ledger.push({ at: new Date().toISOString(), do: String(cmd.do || '?').slice(0, 40), ok: false, why: v.why, ms: 0, bytes: 0, trips: 0 });
          try { fs.writeFileSync(ledgerFile, JSON.stringify({ host: HOST, task: TASK, steps: ledger, totals: { bytes: wire, trips } }, null, 1)); } catch (_) {}
          r0.inbox = { n: unreadIds.length, latest: lastOp };
          if (MS.active()) r0.mission = MS.brief();
          if (cmd.cid != null) r0.cid = cmd.cid;
          writeOut(r0);
          continue;
        }
        cmd = v.cmd; cmd.__vetted = 1;
        if (v.fixed.length) noteFixed(v.fixed);
      }
      // A SPENT BUDGET (core/budget.js): the acting command is NOT run, and nothing of it reaches the panel. The first
      // refusal asks the room itself, once, so the people watching hear that the agent has stopped and why; the agent
      // then waits for their answer with `budget {more:1}`, which hears a yes they already gave. Looking, talking,
      // the panel and finishing are never refused -- an agent out of budget can still see, report and sign off.
      // ...and A PLAN WAITING FOR THE ROOM'S YES (a preview, a checkpoint -- core/mission.js) acts on nothing either.
      // The agent may still look, talk, change the plan and ask again.
      {
        const g = MS.gate();
        if (g && budget.isActing(cmd)) {
          const what = g.kind === 'plan' ? 'the plan for “' + MS.goal + '” is waiting for the room\'s yes'
                                         : 'the job is at a checkpoint after “' + g.t + '”, waiting for the room\'s yes to go on';
          const r0 = { ok: false, refused: true, waiting: true, why: what + ' -- nothing was done. {"do":"mission","op":"ask"} asks again (and hears a yes they already gave); or change the plan as they asked.',
                       ms: 0, bytes: 0, trips: 0, mission: MS.brief() };
          ledger.push({ at: new Date().toISOString(), do: String(cmd.do || '?').slice(0, 40), ok: false, why: 'waiting for the room\'s yes', ms: 0, bytes: 0, trips: 0 });
          r0.inbox = { n: unreadIds.length, latest: lastOp };
          if (cmd.cid != null) r0.cid = cmd.cid;
          writeOut(r0);
          continue;
        }
      }
      {
        const spent = BUD.check(cmd);
        if (spent) {
          if (!budgetAskedAt) {
            budgetAskedAt = Date.now();
            const q = BUD.question();
            try { ws.send({ type: 'chat', text: q }); fs.appendFileSync(chatFile, JSON.stringify({ ts: Date.now(), name: selfName, text: q, mine: true, sent: true }) + '\n'); } catch (_) {}
          }
          const why = spent.why + ' -- nothing was done. Stop here: the room has been asked whether to go on, and ' +
                      '{"do":"budget","more":1,"why":"what is left, and why it will work now"} hears their answer. Or finish the task.';
          const r0 = { ok: false, refused: true, budget: spent.budget, why, ms: 0, bytes: 0, trips: 0 };
          ledger.push({ at: new Date().toISOString(), do: String(cmd.do || '?').slice(0, 40), ok: false, why: 'the task\'s budget is spent', ms: 0, bytes: 0, trips: 0 });
          try { fs.writeFileSync(ledgerFile, JSON.stringify({ host: HOST, task: TASK, steps: ledger, totals: { bytes: wire, trips } }, null, 1)); } catch (_) {}
          r0.inbox = { n: unreadIds.length, latest: lastOp };
          if (MS.active()) r0.mission = MS.brief();
          if (cmd.cid != null) r0.cid = cmd.cid;
          writeOut(r0);
          continue;
        }
      }
      // Tell the watchers what this step is, before doing it. An explicit `intent` beats the default
      // phrase; `status` sets it with no action (handled in step). Only top-level commands narrate --
      // a plan shows its own one line ("Working through N steps"), not a burst from every sub-step.
      //
      // TWO GUARDS so a generic phrase can NEVER stomp a tool's rich narration -- the bug that made a tree
      // read "Read the 81 cells / Clicking":
      //   1. `quiet:1` on the command suppresses it outright (a tool opting a step out of narration).
      //   2. While a TREE is active, the tree's own labels + live timers ARE the narration, so the
      //      auto-phrase is suppressed by DEFAULT -- a task that declared a tree never has to tag every
      //      click quiet. An explicit `intent` is still honoured (the author asked for that exact line).
      let atRec = false;                             // went into the action tree, so its answer goes in too
      if (cmd.do !== 'status') {
        // A FRESH action after a task was marked finished (`fin`) is NEW ad-hoc work: retire the completed
        // task's tree so this action narrates normally instead of being swallowed by the stale tree guard
        // below (and the panel lifts out of its green "done" state). A quiet action leaves it be.
        // ...and a tool's finished tree is kept in the action tree's history as one done step ("Ran: …").
        // CONVERSATION is not new work: the "anything else?" check-in after a finish (a chat, a chat-wait for
        // the answer, a receipt, a ping) must leave the panel green, not reopen the finished task as live.
        const talk = actionTree.isConversation(cmd);
        // anything the agent says to the room after "shall I sign off?" makes THAT the open question
        if (cmd.do === 'chat' || cmd.do === 'chat-img' || cmd.do === 'confirm') signoffAsked = false;
        if ((lastDrive.fin || lastDrive.over) && !cmd.quiet && !talk) {
          // new work after a finish is a new task, with a budget of its own (core/budget.js)
          const wasFin = !!lastDrive.fin;
          retire();
          if (wasFin) newTask('');
        }
        if (atAuto()) {
          // THE ACTION TREE: the command goes INTO the tree -- merged with the run it continues ("typed 11
          // characters", "pressed 16 keys: ↓←↓←…"), described, with itself as the live leaf -- and the line
          // follows it, instead of a bare "Clicking". A quiet:1 command stays out of it -- except a quiet
          // BATCH, which shows as one "Batch of 162: 162 clicks" row counting its progress (a 162-click
          // fill otherwise ran for a minute under a stale "Planning the next step").
          const rec = cmd.quiet ? (cmd.do === 'plan' && !lastDrive.fin) : (actionTree.isAction(cmd) && !(lastDrive.fin && talk));
          if (rec) {
            atRec = atx(() => { AT.start(cmd); lastDrive.text = AT.line(); return true; }, false);
            if (atRec) atSend();
          } else if (atx(() => AT.unbind(!!cmd.quiet && actionTree.isAction(cmd) && !lastDrive.fin), false)) atSend();   // quiet WORK is not "Planning"
        } else {
          atx(() => AT.unbind());
          const explicit = (typeof cmd.intent === 'string' && cmd.intent.trim()) ? cmd.intent.trim() : '';
          const suppressed = cmd.quiet || (lastDrive.tree && !explicit);
          const ph = explicit || (suppressed ? '' : drivePhrase(cmd));
          if (ph) driveStatus(ph);
        }
      }
      // a command still RUNNING is never a pause (a 60 s chat-wait is work, not the driver going quiet)
      if (atIdleTimer) { clearTimeout(atIdleTimer); atIdleTimer = 0; }
      // THE VISIT IS ABOUT TO END: close the action tree's task (no live "Typing…" or "Planning the next step"
      // left to be drawn as a finished step in the final panel) and send that TRUE last state now, while the
      // grant is live -- a frame still waiting on the throttle used to be cancelled at the clean-up.
      if (cmd.do === 'done' || cmd.do === 'quit') {
        if (atAuto()) atx(() => { AT.mark({ fin: 1 }, true); lastDrive.text = AT.line(); });
        if (atSendTimer) { clearTimeout(atSendTimer); atSendTimer = 0; }
        try { sendDrive(); } catch (_) {}
      }
      const t0 = Date.now(), w0 = wire, p0 = trips;
      const mAt = MS.active() && MS.current() ? MS.current().id : '';   // the milestone this command works on (replay.js)
      const r = (await step(cmd)) || { ok: false, why: 'that command answered nothing' };
      BUD.count(cmd);   // a step of the task's budget, whatever its answer: a failed attempt is a turn spent too
      r.ms = Date.now() - t0; r.bytes = wire - w0; r.trips = trips - p0;
      // The answer goes into the tree too (a look shows what it saw, an input whether it failed), and
      // every command re-arms the pause detector that ends a burst.
      // (the line is the action tree's only while it still owns the panel: a batch may have handed it to a plan)
      if (atRec) { atx(() => { AT.end(cmd, r); if (atAuto()) lastDrive.text = AT.line(); }); atSend(); }
      if (atAuto()) atArmIdle();
      // THE LEDGER IS THE RECORD OF WHAT ACTUALLY HAPPENED, written as it happens rather than
      // reconstructed afterwards from what the agent says it did.
      ledger.push({ at: new Date().toISOString(), do: cmd.do, ok: !!r.ok, held: r.held,
                    why: r.why, ms: r.ms, bytes: r.bytes, trips: r.trips });
      try { fs.writeFileSync(ledgerFile, JSON.stringify({ host: HOST, task: TASK, steps: ledger,
                                                          totals: { bytes: wire, trips } }, null, 1)); } catch (_) {}
      // ...AND THE COMMAND ITSELF, for a replay: the ledger keeps what happened, not what was sent, so a job that
      // worked could not be run again without its driver (drive/replay.js reads this, per milestone)
      if (r && r.ok) recordStep(cmd, r, mAt);
      // THE INBOX RIDES EVERY ANSWER. The driver reads done.json after each command; attaching pending
      // operator mail here means it cannot run the next step without seeing it (FIX 3). n=0 when empty.
      if (r && typeof r === 'object') r.inbox = { n: unreadIds.length, latest: lastOp };
      // ...and so does every name the verb table corrected, once, so the next command is written right
      if (fixedNotes.length && r && typeof r === 'object') { r.fixed = fixedNotes.slice(); fixedNotes = []; }
      // ...AND SO DOES THE PLAN (core/mission.js): which milestone is current, what will prove it, the step --
      // the driver works from the plan, not from memory -- and, once, a nudge when a milestone keeps missing.
      if (MS.active() && r && typeof r === 'object') {
        if (atRec) MS.act(r.ok !== false);
        if (!r.mission) r.mission = MS.brief();
        const h = MS.hint();
        if (h && !r.hint) r.hint = h;
        if (atRec) saveMission();
      }
      // ...AND SO DOES A BUDGET NEARLY SPENT, once per task (core/budget.js): time to wrap up, or to ask now
      if (r && typeof r === 'object') {
        const bh = BUD.hint();
        if (bh) { if (!r.hint) r.hint = bh; else r.budgetHint = bh; r.budget = BUD.brief(); }
      }
      // ...AND SO DOES A MISSING RESULT PICTURE (see picOwed), on every answer while the finished task is still
      // the one on show. New work (the green lifting) ends it: the moment for that picture has passed.
      if (picOwed && !lastDrive.fin) picOwed = false;
      if (picOwed && r && typeof r === 'object') {
        r.remind = 'the finished task has no picture of its result in chat -- take it with {"do":"shot","out":"<file>","quiet":1} ' +
                   '(quiet keeps the task finished), crop it to a .jpg (vision/crop.py), post it with chat-img. Next time attach ' +
                   'it to the finish: status {fin:1, say, file}';
      }
      // ...AND ACKNOWLEDGING IT IS NOT LEFT TO THE DRIVER'S MANNERS. Reported from a live run: "I gave you
      // another task, but you didn't respond. You didn't show any 'thinking' text or mark my msg as read."
      // The verbs existed (`seen`, `typing`) and simply were not called, which is the wrong place to need
      // discipline -- the operator's experience should not depend on the agent remembering its etiquette.
      // So the moment a message is HANDED to the driver (right here, in the answer it must read before it
      // can do anything else) the relay is told both true things: it has been READ (a receipt, so the tick
      // appears), and somebody is now working on it (the typing/"thinking" ping, refreshed on its own
      // beat). Both are honest at exactly this instant. The ping stops by itself when the agent actually
      // replies (`chat`/`chat-img`/`done` all call stopTyping) or on `typing {on:false}`.
      if (unreadIds.length) {
        const ids = unreadIds.slice(0, 200);
        try { ws.send({ type: 'chat-read', ids }); } catch (_) {}
        unreadIds = unreadIds.filter((x) => !ids.includes(x));
        if (!typingTimer) {
          const ping = () => { try { ws.send({ type: 'chat-typing' }); } catch (_) {} };
          ping(); typingTimer = setInterval(ping, 1500); if (typingTimer.unref) typingTimer.unref();
        }
      }
      // the command's own id comes back on its answer, so a program driving this can tie the two together
      if (cmd && cmd.cid != null && r && typeof r === 'object') r.cid = cmd.cid;
      writeOut(r);
      if (cmd.do === 'quit' || cmd.do === 'done') break;
    }
    try { clearInterval(keepAlive); } catch (_) {}
    try { clearTimeout(atIdleTimer); clearTimeout(atSendTimer); } catch (_) {}
    try { stopTyping(); } catch (_) {}
    try { if (watcher) watcher.close(); } catch (_) {}
    say('[.] serve ended after ' + ledger.length + ' commands, ' + Math.round(wire / 1024) + ' KB over ' + trips + ' round trips');
  }

  leave();
  await ws.waitFor((m) => m.type === 'join-done', 3000);
  ws.close();
  say('[.] grant handed back');
  process.exit(0);
})().catch((e) => die(1, (e && e.message) || String(e)));

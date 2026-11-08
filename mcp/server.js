#!/usr/bin/env node
'use strict';
// @tool an MCP server: the serve's verbs as MCP tools over stdio -- connect (a person presses Allow), one tool per verb, look's picture inline
// @run  claude mcp add agent-drive -- node "<abs path>/tools/agent-drive/mcp/server.js"   (docs/reference/mcp.md)
// =================================================================================================
// mcp/server.js -- THE SERVE CHANNEL AS MCP TOOLS, so a model calls the verbs directly.
//
// Driving a visit through files costs the model its own turns: write cmd.json, wait, read done.json -- and every
// look is three more tool calls (take the picture, crop it, read the file). Measured, the driver's own turns are
// 87% of a job's time. Here each verb is ONE tool call, and a picture comes back INSIDE the tool result.
//
//   connect {host, task, ...}   starts core/agent-join.js --serve <a fresh work/mcp-<time> folder> and waits while
//                               a person presses Allow (the code goes out as progress, and is in a timeout answer)
//   one tool per verb           generated from core/verbs.js at startup ('-' becomes '_'): a call is
//                               {do:<verb>, ...arguments} handed over the way drive/drive.js does it (an atomic
//                               write of cmd.json), and its answer is done.json
//   look, or an act + look:{}   the picture rides back as an image block after the answer
//   disconnect {text?}          `done` (a sign-off) or `quit`, then the client process exits
//
// SEVERAL MACHINES AT ONCE: a visit per machine, each its own client, serve and queue of calls, so agents on different
// machines work side by side -- an editor (Cursor, Claude) shares ONE server between all its chats. Every tool takes
// `host`: with one visit open a call without it goes there; with several it must say which (see pickVisit).
//
// JSON-RPC 2.0 over stdio, one message per line. STDOUT CARRIES NOTHING ELSE: logs, and everything the client
// process prints, go to stderr. A visit's serve takes one command at a time, so ITS calls are queued -- another
// visit's are not.
// A person still presses Allow for every visit -- the key in the environment only lets this ask.
// No dependencies.
// =================================================================================================
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// A stray line on stdout and the client stops understanding us -- anything a module prints by accident goes to stderr.
console.log = console.info = console.debug = (...a) => console.error(...a);
process.stdout.on('error', () => {});   // the client went away mid-write (EPIPE): shutdown follows from stdin's end

const KIT = path.join(__dirname, '..');
// the client a visit runs: the kit's own (SM_MCP_CLIENT points a test at a stand-in that speaks the serve's files)
const CLIENT = process.env.SM_MCP_CLIENT ? path.resolve(process.env.SM_MCP_CLIENT) : path.join(KIT, 'core', 'agent-join.js');
const verbs = require(path.join(KIT, 'core', 'verbs.js'));
const { putCmd, budgetOf } = require(path.join(KIT, 'core', 'cmd-file.js'));

const SERVER = { name: 'agent-drive', title: 'ScreenMirror agent-drive', version: '1.0.0' };
// THE ICON (MCP 2025-11-25 `icons`): ScreenMirror's own mark, so a client that draws a server's icon -- beside its tool
// calls, in its list of servers -- shows this one rather than a generic one. PNG, which every client that draws icons
// must read (SVG is only a SHOULD), at 32 and 64 px for a 16 px row at 2x and 4x, as data: URIs so it works offline and
// asks nothing of the network. Sent only to a client that negotiated 2025-11-25, the revision that defines the field,
// so an older one never meets a key it does not know. A missing file is no icon, not an error.
const ICONS = [['icon-32.png', '32x32'], ['icon-64.png', '64x64']].map(([file, sizes]) => {
  try { return { src: 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, file)).toString('base64'), mimeType: 'image/png', sizes: [sizes] }; }
  catch (_) { return null; }
}).filter(Boolean);
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];   // newest first
const AGENT = 'claude';
// How long `connect` waits for a person to press Allow. The code expires after two minutes and the client gives up
// on its own soon after (exit 2); this is the backstop. SM_MCP_CONNECT_MS changes it (tests).
const CONNECT_MS = Math.max(3000, Number(process.env.SM_MCP_CONNECT_MS) || 170000);
// Where the visit folders go: the kit's work/ (gitignored) unless SM_MCP_WORK says otherwise.
const WORK = path.resolve(process.env.SM_MCP_WORK || path.join(KIT, 'work'));
// The long edge of a look that names no `max`. Unset: the serve's own default (1280). A client that shrinks a picture
// again before the model sees it makes lx/ly land short, so a client with a smaller limit sets this.
const LOOK_MAX = Math.max(0, Number(process.env.SM_MCP_LOOK_MAX) || 0);
const FLIGHT_WAIT = 30000;     // how long a call waits for a command this server stopped waiting for
const TAKE_BACK_GRACE = 1500;  // after taking a command back, how long its answer may still turn up (read in that instant)
const MARGIN = 15000;          // on top of what a verb may take by its own rules
// How many machines this server holds at once -- every chat's together, since an editor shares one server. Each is a
// client process with a connection of its own. (The relay lets three asks for Allow wait at once from one address.)
// SM_MCP_MAX_VISITS changes it.
const MAX_VISITS = Math.max(1, Math.min(32, Number(process.env.SM_MCP_MAX_VISITS) || 8));

const log = (s) => { try { process.stderr.write('[agent-drive mcp] ' + s + '\n'); } catch (_) {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const exists = (f) => { try { fs.accessSync(f); return true; } catch (_) { return false; } };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
async function until(test, ms) { const end = Date.now() + ms; for (;;) { if (test()) return true; if (Date.now() >= end) return false; await sleep(50); } }

// ---- results ---------------------------------------------------------------------------------------
// A tool that fails says so IN its result (isError), as JSON the way every serve answer is: {ok:false, why, ...}.
const textBlock = (o) => ({ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) });
const okResult = (o, more) => ({ content: [textBlock(o)].concat(more || []) });
const errResult = (why, extra, more) => ({ content: [textBlock(Object.assign({ ok: false, why }, extra || {}))].concat(more || []), isError: true });
function imageBlock(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (_) { return null; }
  if (!buf.length) return null;
  const mimeType = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.slice(0, 4).toString('latin1') === 'GIF8' ? 'image/gif'
    : buf.slice(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : 'image/png';
  return { type: 'image', data: buf.toString('base64'), mimeType };
}

// ---- the tools, from the verb table --------------------------------------------------------------------
// Generated at startup from core/verbs.js, so a verb added there is a tool here with nothing to edit. The table
// says which fields a verb reads and what it does; it does not say their types, so a field this file knows gets
// a type and a few words, and one it does not is left open. The serve's own check (refused / fixed) stays the
// judge: a call is passed through as it came, and an unknown field comes back refused.
const S = (d) => (d ? { type: 'string', description: d } : { type: 'string' });
const N = (d) => (d ? { type: 'number', description: d } : { type: 'number' });
const B = (d) => (d ? { type: 'boolean', description: d } : { type: 'boolean' });
const ANY = (d) => (d ? { description: d } : {});
const RECT = { type: 'object', description: '{x,y,w,h} in screen pixels' };
const PRED = { type: 'object', description: 'a predicate: {px:{x,y,is:"#rrggbb"}} | {any|none:{rect,is}} | {text|notext:{rect,has}} | {changed|stable:{rect,min}}' };
const POINTS = { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '[[x,y],...] in screen pixels' };
const LOOK_AFTER = { type: 'object', description: 'after the act, a picture of the screen -- it comes back in this answer: {rect?, max?, settle?}; out is optional' };
const FIELDS = {
  x: N('screen pixel x'), y: N('screen pixel y'),
  lx: N('x in the last look\'s pixels: the serve maps it to the screen'), ly: N('y in the last look\'s pixels'),
  dx: N('added to x, screen pixels'), dy: N('added to y, screen pixels'),
  at: S('aim where `find` remembered this name'),
  fast: B('tighter pacing, for a run of known targets'),
  look: LOOK_AFTER,
  text: S(), rect: RECT,
  nth: N('which match, 0-based'), as: S('remember the match under this name'), lang: S('OCR language, e.g. "eng"'),
  code: S('a key: "Enter", "Escape", "F5", "ArrowDown", "a"'), n: N('how many'),
  mod: ANY('the modifier(s): "ControlLeft", or several: "ControlLeft+ShiftLeft"'),
  url: S('the address'), wait: N('ms to wait after Enter (default 2500)'), tab: B('in a new tab'),
  points: POINTS, ms: N('milliseconds'),
  list: { type: 'array', items: { type: 'object' }, description: '[{points:[[x,y],...]},...]' },
  out: S('the .png to write (default: a new file in the visit folder; relative = in it)'),
  max: N('the picture\'s long edge, px (default 1280)'), settle: N('ms to wait first (at most 5000)'),
  keep: B('keep the file after the visit (pictures are deleted when it ends)'),
  boxes: B('each word\'s box too'), all: B('every match'), cap: N('at most this many regions'), min: N(),
  bound: RECT, until: PRED, poll: N('ms between checks'),
  file: S('a picture file, .jpg or .png (relative = in the visit folder)'),
  to: S('a direct message to this viewer\'s tag (default: the room)'),
  name: S(), w: N(), h: N(),
  since: N('only replies after this time, ms since 1970 (default: now)'),
  ids: { type: 'array', items: { type: 'string' }, description: 'message ids (default: every unread one)' },
  on: B(), id: S(), undo: B(), cmd: S(), forever: B('until the operator writes or presses Stop (30 min at most)'),
  shell: B('ask to run commands'), control: B('ask for the keyboard and mouse'),
};
const BY_VERB = {
  clicks: { at: POINTS },
  keys: { text: S('the characters to type') },
  clickText: { text: S('the word to find and click') },
  find: { text: S('the word to find') },
  plan: { steps: { type: 'array', items: { type: 'object' }, description: 'commands {"do":"<verb>",...}, run in order and stopped at the first that fails; also {if:<predicate>, then:[...], else:[...]} and {repeat:N, until:<predicate>, steps:[...], poll:ms}' } },
  mission: {
    op: S('plan | step | steps | achieve | add | change | split | skip | fail | finish | show | resume | drop'),
    plan: { type: 'object', description: '{goal, milestones:[{t, done: what will be on the screen, check?, steps?}]}' },
    t: S('a milestone\'s or a step\'s name'), step: S('a short step'), steps: { type: 'array', description: 'short steps' },
    m: ANY('a milestone: its number, id, "current", "next" or part of its name'), done: S('what will be on the screen when it is done'),
    check: ANY('a predicate (or a list of them) that proves it on a fresh picture'), file: S('a picture that proves it, or of the result'),
    into: { type: 'array', items: { type: 'object' }, description: '[{t, done, ...}, ...]' }, milestones: { type: 'array', items: { type: 'object' } },
    goal: S(), say: S(), skill: S(), to: S('a new name'),
  },
  chat: { text: S('the message (Markdown)') },
  'chat-img': { text: S('a caption'), name: S('the picture\'s name in chat') },
  status: {
    text: S('the live line'), at: N('the current step of steps, 0-based'),
    steps: { type: 'array', items: { type: 'string' }, description: 'a flat plan: short step labels' },
    tree: { type: 'array', items: { type: 'object' }, description: 'a nested plan: [{t:"label", s:"done|doing|todo|warn", k:[children]}]' },
    fin: B('the task is finished: the panel goes green, and say + file go to the room as one report'),
    task: S('name the task'), step: ANY('begin a step (null ends it)'), substep: S('begin a sub-step ("" ends it)'),
    say: S('the report posted with fin'), file: S('the picture of the result, posted with fin (.jpg/.png under ~45 KB)'),
    conf: S('low | med | high'),
  },
  think: { thought: S('your reasoning, a line or a paragraph'), text: S('same as thought'), conf: S('low | med | high'), next: S('what comes next') },
  warn: { text: S('a caution line') },
  confirm: { text: S('what you are about to do, said to everyone') },
  captcha: { text: S('your own ask (default: a standard one)') },
  done: { text: S('the sign-off said in the room'), file: S('a final cropped picture') },
  'note-add': { text: S('the note'), x: N('0..1 across (default 0.12)'), y: N('0..1 down (default 0.14)') },
  'note-done': { id: S('the note\'s id (from note_list)'), undo: B('un-resolve it') },
  spotlight: {
    rect: { type: 'array', items: { type: 'number' }, description: '[x1,y1,x2,y2] in screen pixels' },
    x: N('0..1 across the screen'), y: N('0..1 down the screen'), r: N('ring radius, px'),
    circle: ANY('{cx,cy,r} in screen pixels -- or false: travel there and ping only'), cx: N('ring centre, screen px'), cy: N('ring centre, screen px'),
    close: B('false leaves the shape open'), rounds: N('rounds (default 3)'), laps: N('the old name of rounds'),
    times: N('pings after (default 2)'), speed: N('px per second (default 700)'),
  },
  beam: { x: N('0..1 across'), y: N('0..1 down'), size: N(), hold: N('ms (default ~2500; 0 = once)') },
  'spotlight-off': { x: N('0..1 across'), y: N('0..1 down') },
  typing: { on: B('false hides it') },
  lock: { on: B('true takes exclusive control; false releases it') },
  exec: { cmd: S('the command line: cmd.exe on Windows, /bin/sh on Linux'), text: S('same as cmd') },
};
// Fields every command may carry. Types only (with one exception): they are on every tool, so words here are
// paid for many times over -- what they mean is said once, in the instructions.
const COMMON_FIELDS = {
  intent: S(), quiet: B(), show: B(), secret: B(), note: S(), fresh: B(), timeout: N('ms'), why: S(),
  expect: { type: 'object', description: 'a predicate that must hold afterwards, e.g. {"px":{"x":10,"y":20,"is":"#ffffff"}}' },
};
const COMMON = verbs.COMMON.filter((k) => k !== 'do' && k !== '__vetted');
// WHICH MACHINE a call is for -- on every tool, so visits to several machines run side by side (pickVisit). It is this
// server's, never the serve's: it is taken off before the command is handed over.
const HOST_FIELD = { type: 'string', pattern: '^[0-9]{5}$', description: 'the machine this is for: the number you connected to (needed once this server has had more than one visit open)' };
// More than the table's one line, where the MCP side changes what a call does or how long it may take.
const EXTRA = {
  look: 'The picture comes back in this answer with its scale: click what you see in ITS pixels with lx/ly. out is optional.',
  shot: 'Writes the file only (out is optional) -- to see the screen, use look.',
  wait: 'Blocks until it holds, or timeout ms (default 15000).',
  plan: 'One call, many steps on the machine.',
  'chat-wait': 'Blocks until a person replies. Use timeout:45000 while the visit is live (Cursor MCP often aborts longer calls). timedOut/listening/busy means call chat_wait again immediately in the same turn — never end the turn.',
  confirm: 'Says it to everyone and waits (timeout ms, default 20000): go ahead only on verdict "approved".',
  captcha: 'Blocks until the operator replies (timeout ms, default 10 min).',
  access: 'Blocks while a person decides on the new Allow card (about two minutes).',
  mission: 'op plan with preview:1, op achieve at a checkpoint, and op ask wait for the room\'s yes (timeout ms, default 60000); while the job waits, acting tools are refused (waiting:true).',
  exec: 'Needs a grant that may run commands: connect {shell:true}, or access {shell:true}.',
  done: 'Ends the visit, like disconnect.',
  quit: 'Ends the visit, like disconnect.',
};
const sentence = (s) => { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.') : ''; };
function verbTool(verb, name) {
  const spec = verbs.V[verb] || {};
  const fields = Array.isArray(spec.f) ? spec.f : [];
  const own = BY_VERB[verb] || {};
  const properties = {};
  for (const f of fields) properties[f] = JSON.parse(JSON.stringify(own[f] || FIELDS[f] || {}));
  for (const c of COMMON) if (!(c in properties)) properties[c] = JSON.parse(JSON.stringify(COMMON_FIELDS[c] || {}));
  properties.host = JSON.parse(JSON.stringify(HOST_FIELD));
  let description = sentence(spec.what || verb) + ' Fields: ' + (fields.length ? fields.join(', ') : 'none') + '.';
  if (EXTRA[verb]) description += ' ' + EXTRA[verb];
  else if (fields.includes('look')) description += ' look:{} returns a picture of the result in the same answer.';
  return { name, description, inputSchema: { type: 'object', properties, additionalProperties: false } };
}
const CONNECT_TOOL = {
  name: 'connect',
  description: 'Ask to be let onto ONE machine and hold the visit open. A person who can see that machine is shown your task ' +
    'and a code, and must press Allow (the code expires in about two minutes; it is sent as progress, and is in the answer ' +
    'if nobody presses). Answers {w, h, host, dir}: the screen size every x/y is measured in, and the visit\'s folder. ' +
    'This server may hold visits to several machines at once, one each, and other agents may share it: give host on every ' +
    'call (needed once more than one visit has been open). End yours with disconnect {host}.',
  inputSchema: {
    type: 'object',
    properties: {
      host: { type: 'string', pattern: '^[0-9]{5}$', description: 'the five-digit machine number' },
      task: { type: 'string', description: 'one line: what this visit is for -- the person deciding reads it on the Allow card' },
      relay: { type: 'string', description: 'the relay, wss://... (default: SM_RELAY, from the environment or the kit\'s .env)' },
      control: { type: 'boolean', description: 'ask for the keyboard and mouse (default true; serving needs it)' },
      shell: { type: 'boolean', description: 'also ask to run commands -- a consent of its own on the card (default false)' },
      camera: { type: 'boolean', description: 'also ask to take photos with its camera -- its own line on the card; each photo is still asked for in chat' },
      audio: { type: 'boolean', description: 'also ask to record what it is PLAYING (never a microphone) -- its own line on the card' },
      files: { type: 'boolean', description: 'also ask to copy files to and from it -- its own line on the card' },
      monitor: { type: 'integer', minimum: 0, description: 'which screen (default 0)' },
    },
    required: ['host', 'task'],
    additionalProperties: false,
  },
};
const DISCONNECT_TOOL = {
  name: 'disconnect',
  description: 'End the visit and hand the grant back: with text, a sign-off said in the room (the done verb); without, ' +
    'quietly (quit). Waits for the client to exit. Only once the operator is finished -- it hangs up on them -- and only ' +
    'a visit you opened: name it with host.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'a sign-off for the room' }, host: HOST_FIELD }, additionalProperties: false },
};
// A JOB ASKED FOR IN PLAIN WORDS (core/intake.js): "connect 10004 and do my sticky notes" -> the machine, the skill, the
// access to ask for, and connect's own fields. Reads nothing but the kit's skills; connects to nothing.
const INTAKE_TOOL = {
  name: 'intake',
  description: 'Read a job asked for in plain words ("connect 10004 and do my sticky notes") into what connect needs: the machine, ' +
    'the task, the access to ask for -- and the skill that already does it, with its run line. Nothing is connected: call connect ' +
    'with the `connect` fields when they are right, and read the skill before working the job out yourself.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'the request, as the person wrote it' } }, required: ['text'], additionalProperties: false },
};
const intake = require(path.join(KIT, 'core', 'intake.js'));
function intakeCall(args) {
  const text = typeof args.text === 'string' ? args.text : '';
  if (!text.trim()) return errResult('intake needs text: the request, as the person wrote it');
  const r = intake.parse(text, intake.skills());
  const out = Object.assign({}, r);
  if (r.host && r.task) out.connect = { host: r.host, task: r.task, control: !!r.needs.control, shell: !!r.needs.shell };
  if (r.needs.terminal) out.terminal = 'the job needs the Terminal panel: after connect, ask for it with access {terminal:true}';
  return { content: [textBlock(out)] };
}
const TOOLS = [CONNECT_TOOL, DISCONNECT_TOOL, INTAKE_TOOL];
const TOOL_VERB = new Map();   // tool name -> verb
for (const verb of verbs.VERBS) {
  let name = String(verb).replace(/-/g, '_');
  if (name === 'connect' || name === 'disconnect' || name === 'intake' || TOOL_VERB.has(name)) name = 'do_' + name;
  TOOL_VERB.set(name, verb);
  TOOLS.push(verbTool(verb, name));
}

const INSTRUCTIONS = [
  'agent-drive drives a machine through ScreenMirror for the person who invited you. Each visit needs a person at the machine to press Allow.',
  '1. connect {host, task}: the card shows your task and a code. The answer is the screen size; every x/y is a screen pixel at that size. A request in plain words ("connect 10004 and do my sticky notes")? intake {text} reads it into connect\'s fields and finds the skill that does it.',
  '2. Every serve verb is a tool (a "-" in a verb is "_" here: chat_wait, note_add). look returns the picture inline with its scale: click what you see in ITS pixels with click {lx,ly}. Any acting verb takes look:{} to act and see in one call.',
  '3. Read every answer: ok and why; fixed (a name was corrected: use the real one next time); refused (nothing was sent); inbox (the operator wrote: answer in chat); room (what the people watching did on the board: a pause, a stop, an answer, an undo -- act on it first); paused / hold / approval (wait in chat_wait, then send again); remind and hint (do those first).',
  '4. Any command may carry intent (its name on the watchers\' panel), why (your reason, shown on the panel as your thinking: give one where a watcher could not guess it -- a choice, a retry, a workaround), quiet, expect (a predicate that must hold after it), show/secret (what the panel may show of typed text; never show a password), timeout (ms).',
  '5. Plan a job of more than a step or two with mission; ask with confirm before anything hard to undo; never solve a CAPTCHA (captcha asks the operator); finish each task with a picture (status {fin:1, say, file}), then chat_wait for their reply.',
  '6. Several machines at once: connect to each -- one visit per machine, side by side. This server may be shared with other agents (an editor\'s chats share it): give host on every call -- once more than one visit has been open, a call without it is refused, never guessed -- and every answer says which host it came from. Never disconnect a visit you did not open.',
  '7. LISTEN LOOP (HARD): while the visit is live, never end your turn without chat_wait. Use timeout:45000 (Cursor MCP often aborts longer tools). If chat_wait returns timedOut / listening / busy:chat-wait, call chat_wait again immediately in the SAME turn — loop. Cursor does not auto-wake on ScreenMirror inbox; ending the turn makes you deaf. Only stop listening after done/bye or disconnect.',
  '8. When inbox.n > 0 or remind says the operator wrote: seen + typing + chat in session chat BEFORE any screen act. Editor transcript alone is not a reply.',
  '9. disconnect {host} only once they are finished. The full rules: ' + path.join(KIT, 'AGENTS.md'),
].join('\n');

// ---- how long a command may take -------------------------------------------------------------------------
// Never shorter than the kit's own budget (core/cmd-file.js budgetOf) -- a verb that blocks for a person (chat-wait,
// captcha, confirm, access) or polls (wait) gets its own timeout and a margin, and a plan the sum of its steps.
const PICTURE_VERBS = new Set(['look', 'shot', 'hold', 'see', 'ocr', 'find', 'clickText', 'probe', 'census', 'flood', 'mark', 'diff', 'liveness', 'expect']);
function stepMs(c) {
  const t = Number(c.timeout) || 0;
  let ms = PICTURE_VERBS.has(c.do) ? 45000 : 5000;   // a picture on a slow host: each slice may wait 30 s
  switch (c.do) {
    case 'chat-wait': ms = clamp(t || 120000, 1000, 600000); break;
    case 'captcha': ms = clamp(t || 600000, 5000, 1800000); break;
    case 'confirm': ms = clamp(t || 20000, 2000, 300000); break;
    case 'access': ms = 200000; break;
    case 'wait': ms = (t || 15000) + 45000; break;
    case 'exec': ms = clamp(t || 30000, 1000, 120000) + 2000; break;
    case 'ping': ms = clamp(t || 6000, 1000, 20000); break;
    case 'pause': ms = clamp(Number(c.ms) || 0, 0, 30000); break;
    case 'open': ms = (Number(c.wait) || 2500) + 5000; break;
    case 'spotlight': case 'beam': ms = c.forever ? 1800000 : 90000; break;
    // a preview, a checkpoint and `ask` wait for the ROOM (60 s by default); an achieve at a checkpoint may poll its
    // check and then ask, so it gets both
    case 'mission': ms = (c.op === 'plan' && c.preview) || c.op === 'ask' || c.op === 'achieve' ? 2 * clamp(t || 60000, 2000, 300000) + 45000 : clamp(t || 2000, 0, 30000) + 45000; break;
    // a photo or a recording asks the room first (60 s by default), then captures and reads it back
    case 'camera': case 'audio': ms = clamp(t || 60000, 2000, 300000) + 90000; break;
    // a file is one command per chunk: minutes for a big one (and a send may ask before replacing a file)
    case 'fetch': case 'send': ms = 20 * 60000; break;
    // the room's yes (60 s by default), then the undo command itself
    case 'undo': ms = clamp(t || 60000, 2000, 300000) + 75000; break;
    case 'plan': ms = planMs(c.steps, 0); break;
  }
  if (c.expect) ms += 45000;
  if (c.look) ms += 45000;
  return ms;
}
function planMs(steps, depth) {
  let ms = 0;
  if (!Array.isArray(steps) || depth > 8) return ms;
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.do === 'string') { ms += s.do === 'plan' ? planMs(s.steps, depth + 1) : stepMs(s); continue; }
    const loops = (s.repeat !== undefined || s.until) ? clamp(Number(s.repeat) || 20, 1, 500) : 1;
    const each = planMs(s.steps, depth + 1) + ((s.until || s.if) ? 45000 : 0) + (Number(s.poll) || 0);
    ms += loops * each + Math.max(planMs(s.then, depth + 1), planMs(s.else, depth + 1));
  }
  return ms;
}
const budgetFor = (c) => Math.min(6 * 3600000, Math.max(budgetOf(c), stepMs(c) + MARGIN));

// ---- the visits ------------------------------------------------------------------------------------------
// One per machine, by its number: { host, dir, child, pid, err (the client's recent stderr), code (the Allow code it
// printed), exited, ready, w, h, flight (a command this server stopped waiting for, still running), late (answers that
// came after nobody was waiting, for the next result), told (reconnect codes already given to the model), looks,
// queue (this visit's calls, one after another) }.
//
// SEVERAL AT ONCE. It was one, and an editor shares one server between all its chats: a second chat's connect was
// refused with "disconnect it first" -- and it did, ending the FIRST chat's visit to take the machine slot for its own
// (seen live: the second chat said it was switching machines and leaving the first one's, and every call of the first
// chat failed from then on). Now each
// machine is a visit of its own, with its own client and its own queue, so neither waits on the other; a refusal never
// tells one agent to end another's visit; and a call that does not say which machine is never guessed.
const visits = new Map();
const forget = (v) => { if (visits.get(v.host) === v) visits.delete(v.host); };
const openHosts = () => [...visits.keys()];
const liveCount = () => [...visits.values()].filter((v) => !v.exited).length;
// this visit's calls run one after another (its serve takes one command at a time); another visit's run alongside
function onVisit(v, fn) { const run = v.queue.then(fn, fn); v.queue = run.then(() => {}, () => {}); return run; }
// WHICH VISIT A CALL IS FOR: the one its `host` names, or -- with exactly one here -- that one. With several here and none
// named, it is refused, never guessed: the chat that calls may not be the one that opened them.
// An ENDED visit stays here until its own agent hears why (its next call gets died()) -- or for ten minutes: until then
// it still counts, so an agent whose visit ended is never handed someone else's by a call that names no machine.
// And a visit that has SHARED this server with another always needs its host, even once it is the only one left: the
// agent whose visit just ended may be the one calling, and it must not be handed the visit that stayed.
const ENDED_KEEP = 10 * 60000;
const prune = () => { for (const v of [...visits.values()]) if (v.exited && Date.now() - (v.exitedAt || 0) > ENDED_KEEP) forget(v); };
function pickVisit(args) {
  prune();
  const want = args.host == null ? '' : String(args.host).trim();
  if (want) {
    const v = visits.get(want);
    return v ? { v } : { err: errResult('no visit to machine ' + want + ' is open on this server -- connect {host:"' + want + '", task} first', { host: want, open: openHosts() }) };
  }
  if (!visits.size) return { err: errResult('no visit is open -- connect first: connect {host, task}; a person at the machine presses Allow') };
  const only = visits.size === 1 ? visits.values().next().value : null;
  if (only && !only.shared) return { v: only };
  if (only) {
    return { err: errResult('this server has had more than one visit open, so every call names its machine with host. The one open now is ' + only.host +
      ': if it is yours, call again with host "' + only.host + '"; if your visit ended, connect again.', { open: openHosts() }) };
  }
  const ended = [...visits.values()].filter((v) => v.exited).map((v) => v.host);
  return { err: errResult('this server has ' + visits.size + ' visits (' + openHosts().join(', ') + (ended.length ? '; ended: ' + ended.join(', ') : '') +
    '): say which machine with host -- every call takes it. Use the one you connected to: the others may be other agents\' visits.', { open: openHosts(), ended: ended.length ? ended : undefined }) };
}
// every answer of a visit says which machine it came from, so an agent can tell its own visit's answers apart
function stampHost(res, host) {
  try {
    const b = res && res.content && res.content[0];
    if (!b || b.type !== 'text') return res;
    const o = JSON.parse(b.text);
    if (o && typeof o === 'object' && !Array.isArray(o) && o.host == null) { o.host = host; b.text = JSON.stringify(o); }
  } catch (_) {}
  return res;
}
// The client's exit codes, as its header gives them. Its last "[x]" line is the precise reason and goes first; this
// is the gist. (No such machine, nobody to ask and an expired code used to fall through to 3; they are 2 now.)
const EXIT_MEANS = {
  0: 'it ran and ended normally', 1: 'a bad invocation or a transport failure (no relay could be reached)',
  2: 'not let in by the relay: a wrong key, joining switched off, no such machine, nobody to ask, or nobody answered before the code expired',
  3: 'a person refused',
};
function lastWords(v) {
  const lines = String(v.err || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const x = lines.filter((l) => /^\[x\]/.test(l)).pop();
  return { reason: x ? x.replace(/^\[x\]\s*/, '') : '', tail: lines.slice(-8).join('\n').slice(-1500) };
}
function watchChild(v) {
  const onLine = (line) => {
    if (!line.trim()) return;
    v.err = (v.err + line + '\n').slice(-8000);
    log('machine ' + v.host + ' | ' + line);
    const m = /\[>\]\s*code\s+(\S+)/.exec(line);   // "[>] code 1234-5678 -- somebody who can see machine ... has been asked."
    if (m) v.code = m[1];
  };
  for (const stream of [v.child.stderr, v.child.stdout]) {
    if (!stream) continue;
    let part = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => { const lines = (part + d).split(/\r?\n/); part = lines.pop(); for (const l of lines) onLine(l); });
    stream.on('end', () => { if (part) onLine(part); part = ''; });
  }
  // 'close', not 'exit': by then its last words (the "[x] why" line) have been read
  v.child.on('close', (code, signal) => {
    if (!v.exited) { v.exited = { code, signal }; v.exitedAt = Date.now(); }
    log('machine ' + v.host + ': the client exited (code ' + code + (signal ? ', ' + signal : '') + ')');
  });
  v.child.on('error', (e) => { v.err += '[x] ' + e.message + '\n'; if (!v.exited) { v.exited = { code: null, signal: null }; v.exitedAt = Date.now(); } });
}
// End the client: a serving one is asked to quit (it hands the grant back itself); then, or otherwise, it is stopped.
async function stopChild(v, ms) {
  if (v.exited) return;
  if (v.ready) { try { putCmd(path.join(v.dir, 'cmd.json'), { do: 'quit' }); } catch (_) {} await until(() => v.exited, ms || 5000); }
  if (!v.exited) { try { v.child.kill(); } catch (_) {} await until(() => v.exited, 3000); }
}
function died(v) {
  forget(v);
  const code = v.exited ? v.exited.code : null;
  const stop = readJson(path.join(v.dir, 'stopped.json')), stall = readJson(path.join(v.dir, 'stalled.json'));
  const lw = lastWords(v);
  const why = (stop && stop.why) || (stall && stall.why) || lw.reason || 'it ended without saying why (stopped from outside, or it crashed)';
  return errResult('the visit is over -- its client process exited (code ' + code + '): ' + why + '. connect again for a new visit.',
    { ended: true, exit: code, means: EXIT_MEANS[code], dir: v.dir, stderr: lw.tail || undefined });
}
function freshDir() {
  const d = new Date(), p = (n, w) => String(n).padStart(w || 2, '0');
  const base = 'mcp-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + p(d.getMilliseconds(), 3);
  fs.mkdirSync(WORK, { recursive: true });
  for (let i = 0; ; i++) {
    const dir = path.join(WORK, base + (i ? '-' + i : ''));
    try { fs.mkdirSync(dir); return dir; } catch (e) { if (e.code !== 'EEXIST' || i > 50) throw e; }
  }
}

// ---- progress: a code a person must see ------------------------------------------------------------------
function progress(ctx, message) {
  log(message);
  if (!ctx || ctx.progressToken == null || ctx.cancelled) return;
  ctx.progressN = (ctx.progressN || 0) + 1;
  send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: ctx.progressToken, progress: ctx.progressN, message } });
}
const allowAsk = (v, code) => 'code ' + code + ' -- a person who can see machine ' + v.host + ' must press Allow on the card that shows it (it expires in about two minutes)';

// ---- connect -----------------------------------------------------------------------------------------------
// A visit to ANOTHER machine is no obstacle: it opens alongside. One to the SAME machine already here is refused -- and
// never with "disconnect it first": in a shared server it may well be another agent's.
async function connect(args, ctx) {
  const host = String(args.host == null ? '' : args.host).trim();
  if (!/^[0-9]{5}$/.test(host)) return errResult('host is the five-digit machine number (got "' + host + '")');
  prune();
  const have = visits.get(host);
  if (have && !have.exited) {
    return errResult('a visit to machine ' + host + ' is already open on this server' + (have.ready ? '' : ' (still waiting for Allow)') +
      ' -- calls with host "' + host + '" go to it. If you opened it, use it; if not, it is another agent\'s: leave it, and do not disconnect it.',
      { host, dir: have.dir, task: have.task, open: openHosts() });
  }
  if (have) forget(have);
  if (liveCount() >= MAX_VISITS) {
    return errResult('this server already holds ' + liveCount() + ' visits (' + openHosts().join(', ') + '), its limit (SM_MCP_MAX_VISITS) -- ' +
      'end one of YOURS with disconnect {host} first', { open: openHosts() });
  }
  // one line (the card shows it), and never mistaken for a flag by the client's argument reader
  const task = String(args.task == null ? '' : args.task).replace(/\s+/g, ' ').trim().replace(/^-+\s*/, '');
  if (!task) return errResult('task is one line saying what this visit is for -- the person deciding reads it on the Allow card');
  const relay = String(args.relay || process.env.SM_RELAY_URL || process.env.SM_RELAY || '').trim();   // else the client reads the kit's .env
  const control = args.control === undefined || args.control === null ? true : !!args.control;
  const shell = !!args.shell;
  let mon = 0;
  if (args.monitor != null) {
    mon = Number(args.monitor);
    if (!Number.isInteger(mon) || mon < 0) return errResult('monitor is a screen number: 0, 1, ...');
  }
  let dir;
  try { dir = freshDir(); } catch (e) { return errResult('could not make a folder for the visit under ' + WORK + ': ' + e.message); }
  const argv = [CLIENT];
  if (relay) argv.push('--relay', relay);
  argv.push('--host', host, '--agent', AGENT, '--task', task);
  if (control) argv.push('--control');   // without it the visit is watch-only: acting verbs come back needs:'control'
  if (shell) argv.push('--shell');
  for (const k of ['camera', 'audio', 'files']) if (args[k]) argv.push('--' + k);   // each its own line on the Allow card
  if (mon) argv.push('--mon', String(mon));
  argv.push('--serve', dir);
  // if this server dies outright (a SIGKILL on Linux/macOS leaves no stdin-close to notice), the client hands the
  // grant back by itself instead of holding it with nobody to drive it
  argv.push('--parent-pid', String(process.pid));
  // The environment goes through as it is: the client reads SM_JOIN_KEY (and the relay) from it, or from the kit's
  // .env, itself. Its working folder is the visit's, so a relative path in a command lands there.
  let child;
  try { child = spawn(process.execPath, argv, { cwd: dir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
  catch (e) { return errResult('could not start the client: ' + e.message); }
  const v = { host, task, dir, child, pid: child.pid, err: '', code: '', exited: null, ready: false, w: 0, h: 0, at: 0,
              flight: null, late: [], told: new Set(), looks: 0, control, shell, queue: Promise.resolve(), shared: false };
  // company: from now on every visit here -- this one and those already open -- needs its host on every call (pickVisit)
  if (visits.size) { v.shared = true; for (const u of visits.values()) u.shared = true; }
  visits.set(host, v);
  watchChild(v);
  log('asking to join machine ' + host + ' -- the visit folder is ' + dir + (visits.size > 1 ? ' (visits open: ' + openHosts().join(', ') + ')' : ''));
  // the wait for Allow is this visit's first call: a call for this machine that comes meanwhile queues behind it
  return onVisit(v, () => waitAllowed(v, ctx));
}
async function waitAllowed(v, ctx) {
  const { host, dir, control, shell, child } = v;
  const t0 = Date.now();
  let shown = '';
  for (;;) {
    const ready = readJson(path.join(dir, 'ready.json'));
    // an Allow pressed at once can beat the code's line on the pipe: give it a moment, so the code is never skipped
    if (ready && !v.code) await until(() => v.code, 400);
    if (v.code && v.code !== shown) { shown = v.code; progress(ctx, allowAsk(v, v.code)); }
    if (ready && Number(ready.w) > 0) {
      v.ready = true; v.w = Number(ready.w); v.h = Number(ready.h); v.at = ready.at || Date.now();
      log('machine ' + host + ' is open: ' + v.w + 'x' + v.h);
      if (ctx.cancelled) { await stopChild(v); forget(v); return null; }
      const others = openHosts().filter((h) => h !== host);
      return okResult({ ok: true, host, w: v.w, h: v.h, dir, code: v.code || undefined, at: v.at, control, shell, pid: child.pid,
        open: v.shared ? openHosts() : undefined,
        next: 'every x/y is a screen pixel at ' + v.w + 'x' + v.h + '. look first -- the picture comes back inline -- and click what you see with lx/ly. Every answer carries inbox: when the operator writes, answer in chat.' +
          (v.shared ? ' This server ' + (others.length ? 'also has a visit to ' + others.join(', ') + ' open' : 'has had other visits open') +
            ' (another agent\'s, or another of yours): give host "' + host + '" on every call for this machine.' : '') });
    }
    if (v.exited) {
      forget(v);
      const lw = lastWords(v), code = v.exited.code;
      return errResult('not let in: ' + (lw.reason || 'the client exited'), { exit: code, means: EXIT_MEANS[code], code: v.code || undefined, host, stderr: lw.tail || undefined });
    }
    if (ctx.cancelled) { await stopChild(v); forget(v); return null; }
    if (Date.now() - t0 > CONNECT_MS) {
      await stopChild(v);
      forget(v);
      return errResult('nobody pressed Allow within ' + Math.round(CONNECT_MS / 1000) + ' s' + (v.code ? ' -- the code was ' + v.code : '') +
        '. Ask the person at machine ' + host + ' to watch for the card, then connect again.', { timedOut: true, code: v.code || undefined, host });
    }
    await sleep(100);
  }
}

// ---- one command and its answer ---------------------------------------------------------------------------
// The serve runs one command at a time from cmd.json and answers in done.json. A command is handed over the way
// drive/drive.js does it (done.json cleared, cmd.json written atomically) and its answer is watched for. A command
// this server stops waiting for -- out of time, or the call was cancelled -- is TAKEN BACK if the serve has not read
// it yet (it then never runs), else it is left running as `flight` and the next call waits for its answer first,
// so an answer can never be mistaken for the next command's.
function handOver(v, cmd) {
  const outFile = path.join(v.dir, 'done.json');
  try { fs.unlinkSync(outFile); } catch (_) {}
  putCmd(path.join(v.dir, 'cmd.json'), cmd);
  const f = { cmd, at: Date.now(), settled: false, answer: null, died: false, takenBack: 0 };
  f.done = new Promise((resolve) => {
    let same = 0, last = '';
    const settle = () => { f.settled = true; resolve(f); };
    const tick = () => {
      let txt = '';
      try { txt = fs.readFileSync(outFile, 'utf8'); } catch (_) {}
      if (txt) {
        try { f.answer = JSON.parse(txt); return settle(); } catch (_) {}
        // caught half-written (the serve writes it in place): read again -- unless it stays broken
        same = txt === last ? same + 1 : 0; last = txt;
        if (same > 50) { f.answer = { ok: false, why: 'the answer in done.json could not be read: ' + txt.slice(0, 200) }; return settle(); }
      } else if (f.takenBack && Date.now() - f.takenBack > TAKE_BACK_GRACE) return settle();
      else if (v.exited) { f.died = true; return settle(); }
      setTimeout(tick, 40);
    };
    tick();
  });
  return f;
}
// The serve deletes cmd.json once it has read it: still there means not read, and taking it back means it never runs.
// (Read in that very instant, its answer still turns up within TAKE_BACK_GRACE, and is used.)
function takeBack(v, f) {
  try { fs.unlinkSync(path.join(v.dir, 'cmd.json')); } catch (_) { return false; }
  f.takenBack = Date.now();
  return true;
}
// a command taken back as the serve went to read it is answered "unreadable command": it did not run either
const ranAfterAll = (f) => !!f.answer && !(f.takenBack && /unreadable command/.test(String(f.answer.why || '')));
const reconnectWhy = (v, code) => 'the connection to machine ' + v.host + ' dropped and the serve is reconnecting: ' + allowAsk(v, code) +
  '. Nothing was sent -- call again once they have.';
const visitState = (v) => {
  const rc = readJson(path.join(v.dir, 'reconnect.json'));
  if (rc && rc.code) return { reconnecting: true, code: String(rc.code) };
  if (exists(path.join(v.dir, 'reconnecting.json'))) return { reconnecting: true };
  return {};
};

async function exchange(v, cmd, ctx) {
  if (v.exited) return died(v);
  if (ctx.cancelled) return null;
  // 1. a command this server stopped waiting for goes first -- its late answer rides on whatever this call answers.
  // LIVE MISS: Cursor MCP often kills long chat-wait (~60s) while the serve keeps listening; the next call then
  // saw busy and the agent ended the turn. For a live chat-wait flight, keep waiting WITH progress heartbeats
  // (keeps the editor client alive) until it settles, instead of a short refuse.
  if (v.flight) {
    const g = v.flight;
    if (!g.settled) {
      const resumeChat = g.cmd && g.cmd.do === 'chat-wait';
      const waitMs = resumeChat ? Math.min(budgetFor(g.cmd), 120000) : FLIGHT_WAIT;
      const tFlight = Date.now();
      let beat = 0;
      while (!g.settled && Date.now() - tFlight < waitMs) {
        if (ctx.cancelled) break;
        if (resumeChat && Date.now() - beat > 10000) {
          beat = Date.now();
          progress(ctx, 'still listening in session chat… ' + Math.round((Date.now() - tFlight) / 1000) + 's (prior chat-wait)');
        }
        await Promise.race([g.done, sleep(resumeChat ? 1000 : Math.min(1000, waitMs))]);
      }
    }
    if (!g.settled) {
      return told(v, errResult('the previous command (' + g.cmd.do + ') is still running on the machine: this server stopped waiting for it, and the serve takes one ' +
        'command at a time. Nothing was sent -- try again shortly.', Object.assign({
          busy: g.cmd.do, sent: false, listening: g.cmd.do === 'chat-wait',
          remind: g.cmd.do === 'chat-wait'
            ? 'Prior chat-wait still listening on the machine — call chat_wait again (timeout:45000). Do NOT end your turn.'
            : undefined,
        }, visitState(v))));
    }
    v.flight = null;
    if (ranAfterAll(g)) {
      // If the caller asked for another chat-wait and the prior one timed out, fall through to start a new wait.
      // If the prior one GOT a reply, hand that answer back immediately (operator already spoke).
      if (cmd.do === 'chat-wait' && g.answer && g.answer.ok && g.answer.text) {
        return told(v, await answerOf(v, g.cmd, g.answer));
      }
      v.late.push({ previous: g.cmd.do, answeredLate: g.answer });
    }
    if (g.died) return told(v, died(v));
  }
  if (ctx.cancelled) return null;
  // 2. the line dropped and a person must press Allow again: say so first, send nothing
  const st = visitState(v);
  if (st.code && !v.told.has(st.code)) {
    v.told.add(st.code);
    progress(ctx, 'the connection dropped -- ' + allowAsk(v, st.code));
    return told(v, errResult(reconnectWhy(v, st.code), { reconnecting: true, code: st.code, sent: false }));
  }
  // 3. hand it over, and wait for the answer
  const f = handOver(v, cmd);
  const budget = budgetFor(cmd), t0 = Date.now(), shown = new Set();
  let stop = '', stopCode = '';
  let beat = 0;
  while (!f.settled) {
    // a code a person must see: the line dropped (reconnect.json), or this asked for more access (access.json)
    for (const name of ['reconnect.json', 'access.json']) {
      const j = readJson(path.join(v.dir, name));
      const code = j && j.code ? String(j.code) : '';
      if (!code) continue;
      if (!shown.has(name + code)) {
        shown.add(name + code);
        progress(ctx, (name === 'access.json' ? 'more access was asked for -- ' : 'the connection dropped -- ') + allowAsk(v, code));
      }
      // not read yet, and the model has not heard this code: take the command back and tell it now (read just then,
      // it runs once the line is back, and its answer is waited for as usual)
      if (name === 'reconnect.json' && !v.told.has(code) && takeBack(v, f)) {
        await f.done;
        if (!ranAfterAll(f)) { stop = 'reconnect'; stopCode = code; }
      }
    }
    if (stop) break;
    if (ctx.cancelled) { stop = 'cancelled'; break; }
    if (Date.now() - t0 > budget) { stop = 'timeout'; break; }
    // Heartbeat: Cursor's MCP client aborts long tools (~60s) without progress; chat-wait/captcha must stay alive.
    if ((cmd.do === 'chat-wait' || cmd.do === 'captcha' || cmd.do === 'confirm') && Date.now() - beat > 10000) {
      beat = Date.now();
      progress(ctx, (cmd.do === 'chat-wait' ? 'listening in session chat… ' : cmd.do + ' waiting… ') + Math.round((Date.now() - t0) / 1000) + 's');
    }
    await Promise.race([f.done, sleep(100)]);
  }
  if (!f.settled) {
    if (takeBack(v, f)) await f.done;   // never runs (or turns out to have been read just then: its answer is used)
    else v.flight = f;                  // running: the next call waits for it
  }
  if (ctx.cancelled) {                  // nobody is listening for this answer: one that came is told to the next call
    if (f.settled && ranAfterAll(f)) v.late.push({ previous: cmd.do, answeredLate: f.answer, cancelled: true });
    return null;
  }
  if (f.settled && f.died) return told(v, died(v));
  if (!(f.settled && ranAfterAll(f))) {
    if (stop === 'reconnect') {
      v.told.add(stopCode);
      return told(v, errResult(reconnectWhy(v, stopCode), { reconnecting: true, code: stopCode, sent: false }));
    }
    const secs = Math.round(budget / 1000);
    if (f.settled) return told(v, errResult('no answer in ' + secs + ' s, and the serve had not taken the command yet -- it was taken back and never ran', Object.assign({ sent: false }, visitState(v))));
    return told(v, errResult('no answer in ' + secs + ' s -- the command is still running on the machine; the next call waits for it first', Object.assign({ running: cmd.do }, visitState(v))));
  }
  return told(v, await answerOf(v, cmd, f.answer));
}
// Answers that came after this server stopped waiting for them ride on the next result that reaches the model.
function told(v, res) {
  if (res && v.late.length) { for (const l of v.late) res.content.push(textBlock(l)); v.late = []; }
  return res;
}

// The answer as the tool's result: done.json's JSON, the picture after it (look, or an act with look:{}), and --
// when this ended the visit -- the client's exit.
async function answerOf(v, cmd, a) {
  const more = [];
  const pic = cmd.do === 'look' ? (a && a.ok && a.out) : cmd.do === 'camera' ? (a && a.ok && a.file) : (a && a.look && a.look.ok && a.look.out);
  if (pic) {
    const im = imageBlock(path.resolve(v.dir, String(pic)));
    more.push(im || textBlock({ picture: String(pic), why: 'the picture could not be read back' }));
  }
  if ((cmd.do === 'done' || cmd.do === 'quit') && !(a && a.refused)) {
    if (!(await until(() => v.exited, 10000))) await stopChild(v, 1000);
    forget(v);
    more.push(textBlock({ ended: true, exit: v.exited ? v.exited.code : null, dir: v.dir }));
  }
  // chat-wait timedOut is not a failure to surface-and-stop — it is "keep listening". Mark soft so the
  // model is less likely to abort the turn; remind/hint on the payload already say to re-call.
  const listenAgain = a && a.timedOut && a.listening && cmd.do === 'chat-wait';
  if (listenAgain && !a.remind) {
    a.remind = 'VISIT STILL LIVE — call chat_wait again NOW with timeout:45000. Do NOT end your turn.';
  }
  const res = { content: [textBlock(a)].concat(more) };
  if ((!a || a.ok === false) && !listenAgain) res.isError = true;
  return res;
}

// ---- a verb tool -------------------------------------------------------------------------------------------
async function callVerb(v, verb, args, ctx) {
  if (v.exited) return died(v);
  const cmd = { do: verb };
  // `host` chose the visit (pickVisit): it is this server's, not a field of the serve's verb
  for (const k of Object.keys(args)) if (k !== 'do' && k !== '__vetted' && k !== 'host') cmd[k] = args[k];
  // the picture this server hands back inline is written in the visit folder unless the call says where
  const fresh = (stem) => path.join(v.dir, stem + '-' + (++v.looks) + '.png');
  if (verb === 'look') {
    if (cmd.out == null || cmd.out === '') cmd.out = fresh('look');
    if (cmd.max == null && LOOK_MAX) cmd.max = LOOK_MAX;
  } else if (verb === 'shot' && (cmd.out == null || cmd.out === '')) cmd.out = fresh('shot');
  if (cmd.look === true || cmd.look === 1) cmd.look = {};
  if (verb !== 'look' && cmd.look && typeof cmd.look === 'object' && !Array.isArray(cmd.look)) {
    cmd.look = Object.assign({}, cmd.look);
    if (cmd.look.out == null || cmd.look.out === '') cmd.look.out = fresh('look');
    if (cmd.look.max == null && LOOK_MAX) cmd.look.max = LOOK_MAX;
  }
  return exchange(v, cmd, ctx);
}

async function disconnect(v, args, ctx) {
  if (v.exited) return died(v);
  const text = args.text == null ? '' : String(args.text).trim();
  const r = await exchange(v, text ? { do: 'done', text } : { do: 'quit' }, ctx);
  if (v.exited) { forget(v); return r; }
  // the serve could not take it (busy, or no answer): end the client anyway -- its grant goes when its connection does
  await stopChild(v, 2000);
  forget(v);
  if (r) r.content.push(textBlock({ ended: true, forced: true, exit: v.exited ? v.exited.code : null, why: 'the serve did not take the sign-off, so the client was stopped' }));
  return r;
}

// ---- the protocol ----------------------------------------------------------------------------------------
function send(msg) { try { process.stdout.write(JSON.stringify(msg) + '\n'); } catch (_) {} }
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

// A visit's calls run one after another (onVisit: its serve takes one command at a time); calls for different
// machines run side by side.
const calls = new Map();   // request id -> its call, while it runs (for notifications/cancelled)

async function toolsCall(id, params) {
  const name = params.name;
  const args = params.arguments == null ? {} : params.arguments;
  const meta = params._meta || {};
  const ctx = { id, progressToken: meta.progressToken, cancelled: false, progressN: 0 };
  if (name !== 'connect' && name !== 'disconnect' && name !== 'intake' && !TOOL_VERB.has(name)) return rpcError(id, -32602, 'Unknown tool: ' + name);
  if (!args || typeof args !== 'object' || Array.isArray(args)) return reply(id, errResult('arguments is an object of the tool\'s fields'));
  // reading a request touches no visit: it is answered at once, outside the queue of a visit's commands
  if (name === 'intake') { try { return reply(id, intakeCall(args)); } catch (e) { return reply(id, errResult('intake failed: ' + ((e && e.message) || e))); } }
  calls.set(id, ctx);
  try {
    let r;
    if (shuttingDown) r = null;
    else if (name === 'connect') r = await connect(args, ctx);   // it queues its own wait on its new visit
    else {
      const pick = pickVisit(args);
      if (pick.err) r = pick.err;
      else {
        const v = pick.v;
        r = await onVisit(v, async () => {
          if (ctx.cancelled || shuttingDown) return null;
          return name === 'disconnect' ? disconnect(v, args, ctx) : callVerb(v, TOOL_VERB.get(name), args, ctx);
        });
        if (r) r = stampHost(r, v.host);
      }
    }
    return r && !ctx.cancelled ? reply(id, r) : null;   // a cancelled request gets no answer
  } catch (e) {
    log('tools/call ' + name + ' failed: ' + ((e && e.stack) || e));
    return ctx.cancelled ? null : reply(id, errResult('the MCP server failed on this call: ' + ((e && e.message) || e)));
  } finally { calls.delete(id); }
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request');
  const isRequest = Object.prototype.hasOwnProperty.call(msg, 'id');
  const id = msg.id;
  if (typeof msg.method !== 'string') {
    // a response: this server never asks the client anything, so there is nothing to match it to
    if (isRequest && !('result' in msg) && !('error' in msg)) return rpcError(id, -32600, 'Invalid Request');
    return null;
  }
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      const protocolVersion = PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0];
      if (isRequest) log('initialize: ' + (asked || '?') + ' -> ' + protocolVersion);
      const serverInfo = protocolVersion >= '2025-11-25' && ICONS.length ? Object.assign({}, SERVER, { icons: ICONS }) : SERVER;
      return isRequest ? reply(id, { protocolVersion, capabilities: { tools: {} }, serverInfo, instructions: INSTRUCTIONS }) : null;
    }
    case 'notifications/initialized': case 'initialized': return null;
    case 'notifications/cancelled': {
      const ctx = calls.get(msg.params && msg.params.requestId);
      if (ctx) { ctx.cancelled = true; log('call ' + JSON.stringify(ctx.id) + ' cancelled' + (msg.params.reason ? ': ' + msg.params.reason : '')); }
      return null;
    }
    case 'ping': return isRequest ? reply(id, {}) : null;
    case 'tools/list': return isRequest ? reply(id, { tools: TOOLS }) : null;
    case 'tools/call': return isRequest ? toolsCall(id, msg.params || {}) : null;
    default: return isRequest ? rpcError(id, -32601, 'Method not found: ' + msg.method) : null;
  }
}

function onLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (_) { send(rpcError(null, -32700, 'Parse error')); return; }
  if (Array.isArray(msg)) {   // a batch (protocol 2025-03-26 only): answered as one array
    if (!msg.length) { send(rpcError(null, -32600, 'Invalid Request')); return; }
    Promise.all(msg.map((m) => handle(m).catch(() => null))).then((all) => { const out = all.filter(Boolean); if (out.length) send(out); });
    return;
  }
  handle(msg).then((r) => { if (r) send(r); }, (e) => log('handling a message failed: ' + ((e && e.stack) || e)));
}

// ---- leaving -----------------------------------------------------------------------------------------------
// However this server ends, every visit's client goes with it -- a serving one hands its grant back first.
let shuttingDown = false;
async function shutdown(why) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down (' + why + ')' + (visits.size ? ': ending the visits to ' + openHosts().join(', ') : ''));
  await Promise.all([...visits.values()].filter((v) => !v.exited).map((v) => stopChild(v, 5000)));
  await new Promise((r) => { try { process.stdout.write('', () => r()); } catch (_) { r(); } setTimeout(r, 500); });
  process.exit(0);
}
process.on('exit', () => { for (const v of visits.values()) if (!v.exited) { try { v.child.kill(); } catch (_) {} } });
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => log('uncaught: ' + ((e && e.stack) || e)));
process.on('unhandledRejection', (e) => log('unhandled: ' + ((e && e.stack) || e)));

let inbuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  inbuf += d;
  for (let i; (i = inbuf.indexOf('\n')) >= 0;) {
    const line = inbuf.slice(0, i).replace(/\r$/, '');
    inbuf = inbuf.slice(i + 1);
    if (line.trim()) onLine(line);
  }
});
process.stdin.on('end', () => { if (inbuf.trim()) onLine(inbuf); inbuf = ''; shutdown('stdin closed'); });
log('ready: ' + TOOLS.length + ' tools (' + TOOL_VERB.size + ' verbs from core/verbs.js); visits go in ' + WORK);

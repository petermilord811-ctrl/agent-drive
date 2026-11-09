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
const { putCmd, budgetOf, typingMs } = require(path.join(KIT, 'core', 'cmd-file.js'));

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
// HOW LONG ONE CALL MAY TAKE. An MCP client gives up on a call it has waited on too long -- Cursor at 60 s (error
// -32001, and no setting changes it, nor does progress), Claude's desktop app too -- and cancels it. A connect then
// threw away a card a person was about to press, and a chat_wait, a CAPTCHA hand-off or a long run of typing kept going
// on the machine while the model was told it failed. So no call here blocks longer than this: a connect still waiting
// for Allow says so and is taken up again by the next connect to that machine; a command still running says
// `pending`, and its answer comes with the next call to that machine (ping collects it); chat_wait listens this long
// and says to call again. SM_MCP_CALL_MS changes it (a client with no limit can raise it).
const CALL_MS = Math.max(5000, Math.min(6 * 3600000, Number(process.env.SM_MCP_CALL_MS) || 50000));
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
  lx: N('x in a look\'s pixels (the last look, or the one `of` names): the serve maps it to the screen'), ly: N('y in a look\'s pixels'),
  mark: N('a number look {marks:true} drew on a target: the click goes to its centre'),
  of: N('the id of the look lx/ly or mark were read from (default: the last look)'),
  marks: B('number what can be clicked on the picture -- buttons, fields, boxes to tick, links -- then click {mark:N}'),
  snap: B('false: leave a click that just missed a small target where it was asked for'),
  aim: B('false: skip checking that the screen still shows what the look showed there'),
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
/// WHICH MACHINE a call is for -- REQUIRED on every tool but connect and intake: an editor shares one server between its
// chats, and a call that named no machine used to go to the only visit open, which could be another chat's. It is this
// server's, never the serve's: it is taken off before the command is handed over.
const HOST_FIELD = { type: 'string', pattern: '^[0-9]{5}$', description: 'the machine this call is for: the number you connected to' };
// More than the table's one line, where the MCP side changes what a call does or how long it may take.
const LISTEN_S = Math.round((CALL_MS - 5000) / 1000);
const EXTRA = {
  look: 'The picture comes back in this answer with its id and scale. marks:true numbers what can be clicked on it: then click {mark:N}, with nothing to estimate. Or click what you see in ITS pixels with lx/ly. out is optional.',
  click: 'Aim with a mark (look {marks:true} first) or with lx/ly read from a look (of: its id, when not the last). A click aimed from a look is checked against the screen first and follows a target that moved; the answer says what it hit (hit, near, snapped, moved). look:{} returns a picture of the result in the same answer.',
  shot: 'Writes the file only (out is optional) -- to see the screen, use look.',
  wait: 'Blocks until it holds, or timeout ms (default 15000).',
  plan: 'One call, many steps on the machine.',
  'chat-wait': 'Listens for the room for up to ' + LISTEN_S + ' s a call: every line written since your last answer comes back at once (all of them in `lines`). No reply yet: call it again to keep listening.',
  confirm: 'Says it to everyone and waits (timeout ms, default 20000): go ahead only on verdict "approved".',
  captcha: 'Hands it to the operator and waits for their word. A wait longer than one call answers pending: ping {host} collects the answer.',
  access: 'A person decides on a new Allow card (about two minutes): a wait longer than one call answers pending, and ping {host} collects the answer.',
  mission: 'op plan with preview:1, op achieve at a checkpoint, and op ask wait for the room\'s yes (timeout ms, default 60000); a wait longer than one call answers pending (ping collects it); while the job waits, acting tools are refused (waiting:true).',
  ping: 'Is the machine still there? Also collects the answer of a command that answered pending.',
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
  return { name, description, inputSchema: { type: 'object', properties, required: ['host'], additionalProperties: false } };
}
const CONNECT_TOOL = {
  name: 'connect',
  description: 'Ask to be let onto ONE machine and hold the visit open. A person who can see that machine is shown your task ' +
    'and a code, and must press Allow (the code expires in about two minutes; it is sent as progress, and is in the answer). ' +
    'Answers {w, h, host, dir}: the screen size every x/y is measured in, and the visit\'s folder. Not pressed yet within ' +
    'one call: the answer says waiting, with the code -- call connect again with the same host to keep waiting. This ' +
    'server may hold visits to several machines at once, and other agents may share it: every other call names its ' +
    'machine with host. End yours with disconnect {host}.',
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
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'a sign-off for the room' }, host: HOST_FIELD }, required: ['host'], additionalProperties: false },
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
// THE TOOLS A MODEL IS SHOWN. Every verb as a tool of its own was 68 tools and 71 KB of schemas: past what Cursor sends
// a model (its first 40 tools, all servers together -- and the ones cut were the last in the table: status, confirm,
// captcha, done, think, access, undo), and ~18,000 tokens on every turn. So the verbs a job is made of are tools, the
// ones the rules require first, and the rest are reached through ONE tool, `more {do:"<verb>", ...}` -- the same verb,
// the same checks. SM_MCP_TOOLS=all brings back a tool per verb, for a client with no such limit.
const CORE = ['look', 'click', 'keys', 'press', 'chord', 'open', 'scroll', 'clickText', 'dbl', 'right', 'find', 'ocr', 'probe', 'wait', 'plan',
  'chat', 'chat-wait', 'inbox', 'status', 'think', 'confirm', 'captcha', 'mission', 'done', 'access', 'undo', 'exec', 'terminal', 'ping'];
const ALL_TOOLS = /^all$/i.test(String(process.env.SM_MCP_TOOLS || ''));
const toolName = (verb) => { const n = String(verb).replace(/-/g, '_'); return n === 'connect' || n === 'disconnect' || n === 'intake' || n === 'more' ? 'do_' + n : n; };
const TOOLS = [CONNECT_TOOL, DISCONNECT_TOOL, INTAKE_TOOL];
const TOOL_VERB = new Map();   // tool name -> verb
const shown = ALL_TOOLS ? verbs.VERBS.slice() : CORE.filter((v) => verbs.V[v]);
for (const verb of shown) { const name = toolName(verb); if (TOOL_VERB.has(name)) continue; TOOL_VERB.set(name, verb); TOOLS.push(verbTool(verb, name)); }
// the verbs that have no tool of their own: `more` reaches them (and any other verb, for a call that prefers it)
const MORE_VERBS = verbs.VERBS.filter((v) => !shown.includes(v));
const MORE_TOOL = {
  name: 'more',
  description: 'Any serve verb that has no tool of its own: {do:"<verb>", host, ...its fields} -- checked by the same verb table ' +
    '(an unknown field is refused). The verbs: ' + MORE_VERBS.map((v) => v + ' (' + String((verbs.V[v] || {}).what || '').replace(/\s+/g, ' ').slice(0, 60) + ')').join('; ') + '.',
  inputSchema: { type: 'object', properties: { do: { type: 'string', enum: verbs.VERBS.slice(), description: 'the verb' }, host: HOST_FIELD },
                 required: ['do', 'host'], additionalProperties: true },
};
if (MORE_VERBS.length) TOOLS.push(MORE_TOOL);

const INSTRUCTIONS = [
  'agent-drive drives a machine through ScreenMirror for the person who invited you. Each visit needs a person at the machine to press Allow.',
  '1. connect {host, task}: the card shows your task and a code. The answer is the screen size; every x/y is a screen pixel at that size. Not pressed yet (waiting): call connect again with the same host to keep waiting. A request in plain words ("connect 10004 and do my sticky notes")? intake {text} reads it into connect\'s fields and finds the skill that does it.',
  '2. EVERY other call names its machine: host (the number you connected to). This server may be shared with other agents (an editor\'s chats share it), so a call never goes to a machine it did not name. Never disconnect a visit you did not open.',
  '3. The verbs a job is made of are tools (a "-" in a verb is "_" here: chat_wait); every other verb is more {do:"<verb>", host, ...}. look returns the picture inline. To click a button, a field, a box to tick or a link: look {marks:true} -- each gets a number on the picture -- and click {mark:N}, with nothing to estimate. Otherwise click what you see in the look\'s own pixels with click {lx,ly}. A click from a look is checked against the screen first and says what it hit (hit, near, snapped, moved): when hit is not what you meant, look again instead of clicking near it again. Any acting verb takes look:{} to act and see in one call.',
  '4. Read every answer: ok and why; fixed (a name was corrected: use the real one next time); refused (nothing was sent); inbox (new: what the operator wrote since your last answer -- answer in chat); room (what the people watching did on the board: a pause, a stop, an answer, an undo -- act on it first); paused / hold / approval (wait in chat_wait, then send again); pending (still running on the machine: ping {host} collects its answer); remind and hint (do those first).',
  '5. Any command may carry intent (its name on the watchers\' panel), why (your reason, shown on the panel as your thinking: give one where a watcher could not guess it -- a choice, a retry, a workaround), quiet, expect (a predicate that must hold after it), show/secret (what the panel may show of typed text; never show a password), timeout (ms).',
  '6. Plan a job of more than a step or two with mission; ask with confirm before anything hard to undo; never solve a CAPTCHA (captcha asks the operator); finish each task with a picture (status {fin:1, say, file}), then chat_wait for their reply -- it listens about ' + LISTEN_S + ' s a call, so call it again while you wait.',
  '7. LISTEN LOOP (HARD): while the visit is live, never end your turn without chat_wait. If chat_wait returns timedOut / listening / pending / busy:chat-wait, call chat_wait again immediately in the SAME turn — loop. Cursor does not auto-wake on ScreenMirror inbox; ending the turn makes you deaf. Only stop listening after done/bye or disconnect.',
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
    case 'open': ms = (Number(c.wait) || 2500) + 5000 + typingMs(c); break;
    case 'keys': ms = 5000 + typingMs(c); break;   // typing like a person takes a person's time (core/cmd-file.js)
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
/// WHICH VISIT A CALL IS FOR: the one its `host` names -- and nothing else. A call that names no machine is refused,
// whatever is open: the server is shared (an editor's chats share it), so the chat that calls may not be the one that
// opened the visit, and "the only one open" was how a chat that had not connected yet acted on another's machine.
// An ENDED visit stays here until its own agent hears why (its next call to that machine gets died()), or for ten minutes.
const ENDED_KEEP = 10 * 60000;
const prune = () => { for (const v of [...visits.values()]) if (v.exited && Date.now() - (v.exitedAt || 0) > ENDED_KEEP) forget(v); };
function pickVisit(args) {
  prune();
  const want = args.host == null ? '' : String(args.host).trim();
  if (want) {
    const v = visits.get(want);
    return v ? { v } : { err: errResult('no visit to machine ' + want + ' is open on this server -- connect {host:"' + want + '", task} first', { host: want, open: openHosts() }) };
  }
  if (!visits.size) return { err: errResult('no visit is open -- connect first: connect {host, task}; a person at the machine presses Allow; then every call names it with host') };
  return { err: errResult('say which machine with host -- every call names it (open here: ' + openHosts().join(', ') + '). Use the one you connected to: ' +
    'the others may be other agents\' visits. Not connected yet? connect {host, task} first.', { open: openHosts() }) };
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
    if (v.reap) { clearTimeout(v.reap); v.reap = null; }
    log('machine ' + v.host + ': the client exited (code ' + code + (signal ? ', ' + signal : '') + ')');
    sweepCaptures(v.dir);
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
// THE PICTURES A VISIT TOOK GO WITH IT. The client deletes them as it exits -- but a client that is stopped (this server
// gives a busy one 2-5 s to quit, then kills it; an editor closing does the same) never runs its own clean-up, and every
// visit has a fresh folder, so no later visit would find them. So this server sweeps the list (captures.json) itself
// once the client is gone, and at startup sweeps the lists earlier visits under WORK left behind. --keep-captures and
// keep:1 never put a file on the list, so they are not touched.
function sweepCaptures(dir) {
  const list = path.join(dir, 'captures.json');
  let files;
  try { files = JSON.parse(fs.readFileSync(list, 'utf8')); } catch (_) { return 0; }
  let n = 0;
  for (const f of Array.isArray(files) ? files : []) if (typeof f === 'string') { try { fs.unlinkSync(f); n++; } catch (_) {} }
  try { fs.unlinkSync(list); } catch (_) {}
  if (n) log('removed ' + n + ' picture(s) a visit left in ' + dir);
  return n;
}
// ...only lists nobody has touched for a day: several servers can share WORK (sessions of one editor, or two editors
// on one kit), and a list still being written belongs to a live visit
function sweepOld() {
  let names = [];
  try { names = fs.readdirSync(WORK).filter((n) => /^mcp-\d{8}-/.test(n)); } catch (_) { return; }
  for (const n of names) {
    try { if (Date.now() - fs.statSync(path.join(WORK, n, 'captures.json')).mtimeMs > 24 * 3600000) sweepCaptures(path.join(WORK, n)); } catch (_) {}
  }
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

/// ---- connect -----------------------------------------------------------------------------------------------
// A visit to ANOTHER machine is no obstacle: it opens alongside. One to the SAME machine already here is refused -- and
// never with "disconnect it first": in a shared server it may well be another agent's. A visit still WAITING for Allow
// (or let in while nobody was waiting) is no such visit: a connect to that machine takes the wait up again -- one call
// may wait CALL_MS, and a person can take longer than that to press Allow.
// A wait nobody takes up again ends: a visit nobody claims -- not let in, or let in while no call was waiting -- is
// stopped this long after the last connect for it (its grant goes back), so nothing holds a machine with no agent.
const UNCLAIMED_MS = 90000;
function reapLater(v) {
  if (v.reap) clearTimeout(v.reap);
  v.reap = setTimeout(() => {
    v.reap = null;
    if (v.claimed || v.exited || v.waiting) return;
    log('machine ' + v.host + ': nobody took up the visit' + (v.ready ? ' after it was let in' : '') + ' -- ending it');
    stopChild(v, 3000).then(() => forget(v), () => forget(v));
  }, UNCLAIMED_MS);
  if (v.reap.unref) v.reap.unref();
}
async function connect(args, ctx) {
  const host = String(args.host == null ? '' : args.host).trim();
  if (!/^[0-9]{5}$/.test(host)) return errResult('host is the five-digit machine number (got "' + host + '")');
  prune();
  const have = visits.get(host);
  if (have && !have.exited && !have.claimed) {
    log('machine ' + host + ': connect takes up the wait for Allow again');
    return onVisit(have, () => waitAllowed(have, ctx, true));
  }
  if (have && !have.exited) {
    return errResult('a visit to machine ' + host + ' is already open on this server' +
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
  const v = { host, task, dir, child, pid: child.pid, err: '', code: '', exited: null, ready: false, w: 0, h: 0, at: 0, started: Date.now(),
              flight: null, late: [], told: new Set(), looks: 0, control, shell, queue: Promise.resolve(), claimed: false, waiting: false, reap: null };
  visits.set(host, v);
  watchChild(v);
  log('asking to join machine ' + host + ' -- the visit folder is ' + dir + (visits.size > 1 ? ' (visits open: ' + openHosts().join(', ') + ')' : ''));
  // the wait for Allow is this visit's first call: a call for this machine that comes meanwhile queues behind it
  return onVisit(v, () => waitAllowed(v, ctx, false));
}
async function waitAllowed(v, ctx, again) {
  const { host, dir, control, shell, child } = v;
  const t0 = Date.now();
  let shown = '';
  v.waiting = true;
  if (v.reap) { clearTimeout(v.reap); v.reap = null; }
  try {
    for (;;) {
      const ready = readJson(path.join(dir, 'ready.json'));
      // an Allow pressed at once can beat the code's line on the pipe: give it a moment, so the code is never skipped
      if (ready && !v.code) await until(() => v.code, 400);
      if (v.code && v.code !== shown) { shown = v.code; progress(ctx, allowAsk(v, v.code)); }
      if (ready && Number(ready.w) > 0) {
        if (!v.ready) log('machine ' + host + ' is open: ' + Number(ready.w) + 'x' + Number(ready.h));
        v.ready = true; v.w = Number(ready.w); v.h = Number(ready.h); v.at = ready.at || Date.now();
        // a call nobody is waiting on any more does not claim it: the next connect does, or it is reaped
        if (ctx.cancelled) return null;
        v.claimed = true;
        const others = openHosts().filter((h) => h !== host);
        return okResult({ ok: true, host, w: v.w, h: v.h, dir, code: v.code || undefined, at: v.at, control, shell, pid: child.pid,
          open: others.length ? openHosts() : undefined, resumed: again || undefined,
          next: 'every x/y is a screen pixel at ' + v.w + 'x' + v.h + '. Give host "' + host + '" on every call. look first -- the picture comes back inline -- ' +
            'and click what you see (look {marks:true}, then click {mark}). Every answer carries inbox: when the operator writes, answer in chat.' +
            (others.length ? ' This server also has a visit to ' + others.join(', ') + ' open (another agent\'s, or another of yours): leave those alone.' : '') });
      }
      if (v.exited) {
        forget(v);
        const lw = lastWords(v), code = v.exited.code;
        return errResult('not let in: ' + (lw.reason || 'the client exited'), { exit: code, means: EXIT_MEANS[code], code: v.code || undefined, host, stderr: lw.tail || undefined });
      }
      if (ctx.cancelled) return null;   // the card stays up: the next connect to this machine takes the wait up again
      if (Date.now() - v.started > CONNECT_MS) {
        await stopChild(v);
        forget(v);
        return errResult('nobody pressed Allow within ' + Math.round(CONNECT_MS / 1000) + ' s' + (v.code ? ' -- the code was ' + v.code : '') +
          '. Ask the person at machine ' + host + ' to watch for the card, then connect again.', { timedOut: true, code: v.code || undefined, host });
      }
      // ONE CALL WAITS SO LONG: then it says so, with the code, and the card stays up for the next connect
      if (Date.now() - t0 > CALL_MS - 2000) {
        return okResult({ ok: false, waiting: true, host, code: v.code || undefined,
          why: 'still waiting for a person at machine ' + host + ' to press Allow' + (v.code ? ' on the card showing code ' + v.code : '') +
            '. Nothing is lost: call connect again with host "' + host + '" to keep waiting (the card expires about two minutes after it was raised).' });
      }
      await sleep(100);
    }
  } finally {
    v.waiting = false;
    if (!v.claimed && !v.exited) reapLater(v);
  }
}

// ---- one command and its answer ---------------------------------------------------------------------------
// The serve runs one command at a time from cmd.json and answers in done.json. A command is handed over the way
// drive/drive.js does it (done.json cleared, cmd.json written atomically) and its answer is watched for. A command
// this server stops waiting for -- out of time, or the call was cancelled -- is TAKEN BACK if the serve has not read
// it yet (it then never runs), else it is left running as `flight` and the next call waits for its answer first,
// so an answer can never be mistaken for the next command's.
let cidSeq = 0;
function handOver(v, cmd) {
  const outFile = path.join(v.dir, 'done.json');
  try { fs.unlinkSync(outFile); } catch (_) {}
  // ITS OWN ID, echoed on its answer by the serve: an answer that carries another command's id is that one's, late
  if (cmd.cid == null) cmd.cid = (process.pid % 10000) * 1000000 + (++cidSeq % 1000000);
  putCmd(path.join(v.dir, 'cmd.json'), cmd);
  const f = { cmd, at: Date.now(), settled: false, answer: null, died: false, takenBack: 0 };
  f.done = new Promise((resolve) => {
    let same = 0, last = '';
    const settle = () => { f.settled = true; resolve(f); };
    const tick = () => {
      let txt = '', other = false;
      try { txt = fs.readFileSync(outFile, 'utf8'); } catch (_) {}
      if (txt) {
        let a, parsed = false;
        try { a = JSON.parse(txt); parsed = true; } catch (_) {}
        if (parsed && a && typeof a === 'object' && a.cid != null && a.cid !== cmd.cid) other = true;   // another command's answer, late
        else if (parsed) { f.answer = a; if (a && typeof a === 'object') delete a.cid; return settle(); }
        else {
          // caught half-written (the serve writes it in place): read again -- unless it stays broken
          same = txt === last ? same + 1 : 0; last = txt;
          if (same > 50) { f.answer = { ok: false, why: 'the answer in done.json could not be read: ' + txt.slice(0, 200) }; return settle(); }
        }
      }
      if (!txt || other) {
        if (f.takenBack && Date.now() - f.takenBack > TAKE_BACK_GRACE) return settle();
        if (v.exited) { f.died = true; return settle(); }
      }
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
  const callEnd = (ctx.t0 || Date.now()) + CALL_MS - 1500;   // this call answers by then, whatever is still running
  // 1. a command this server stopped waiting for goes first -- its late answer rides on whatever this call answers. It
  // is waited for as long as this call may wait: collecting it is what the next call is for (ping does nothing else).
  if (v.flight) {
    const g = v.flight;
    if (!g.settled) await Promise.race([g.done, sleep(Math.max(0, callEnd - Date.now()))]);
    if (!g.settled) {
      return told(v, pendingResult(v, g.cmd, 'nothing else was sent: the serve takes one command at a time', false));
    }
    v.flight = null;
    if (ranAfterAll(g)) v.late.push({ previous: g.cmd.do, answeredLate: g.answer });
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
  // 3. hand it over, and wait for the answer -- until its own budget runs out, or this call's time does
  const f = handOver(v, cmd);
  const budget = budgetFor(cmd), t0 = Date.now(), shown = new Set();
  let stop = '', stopCode = '', beat = Date.now();
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
    if (Date.now() > callEnd) { stop = 'call'; break; }
    // ...and a word every 15 s to a client that resets its own clock on progress (the MCP spec allows it)
    if (Date.now() - beat > 15000) { beat = Date.now(); progress(ctx, 'still running on machine ' + v.host + ': ' + cmd.do + ' (' + Math.round((beat - t0) / 1000) + ' s)'); }
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
    if (f.settled) return told(v, errResult('the serve had not taken the command yet -- it was taken back and never ran', Object.assign({ sent: false }, visitState(v))));
    // still running: this call's time is up (or its own budget is) -- it goes on, and the next call collects its answer
    return told(v, pendingResult(v, cmd, stop === 'timeout' ? 'it has run past its own time (' + Math.round(budget / 1000) + ' s)' : '', true));
  }
  return told(v, await answerOf(v, cmd, f.answer));
}
// A COMMAND STILL RUNNING when a call must answer: not a failure -- it goes on on the machine, and its answer rides on the
// next call to this machine (ping collects it, waiting as long as a call may). Not an isError result: nothing went wrong.
function pendingResult(v, cmd, note, sent) {
  const verb = String(cmd && cmd.do || '?');
  const waits = { 'chat-wait': 'it waits for a reply in chat', captcha: 'it waits for the operator to solve the CAPTCHA', confirm: 'it waits for the room\'s answer',
                  access: 'it waits for a person to press Allow on the new card', mission: 'it waits for the room', undo: 'it waits for the room\'s yes',
                  camera: 'it waits for the room\'s yes', audio: 'it waits for the room\'s yes', keys: 'it is still typing', open: 'it is still typing the address',
                  plan: 'its steps are still running', fetch: 'the file is still moving', send: 'the file is still moving' };
  return okResult(Object.assign({ ok: false, pending: true, running: verb, sent: !!sent, host: v.host,
    why: 'still running on machine ' + v.host + ': ' + verb + (waits[verb] ? ' (' + waits[verb] + ')' : '') + (note ? ' -- ' + note : '') +
      '. Nothing is lost: its answer comes with your next call to this machine -- ping {host:"' + v.host + '"} collects it (it waits up to ' + Math.round(CALL_MS / 1000) + ' s).' }, visitState(v)));
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
  // model is less likely to abort the turn; next/remind on the payload already say to re-call.
  const listenAgain = a && a.timedOut && cmd.do === 'chat-wait';
  if (listenAgain) {
    if (!a.listening) a.listening = true;
    if (!a.remind) a.remind = 'VISIT STILL LIVE — call chat_wait again NOW. Do NOT end your turn.';
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
  // CHAT-WAIT LISTENS AS LONG AS ONE CALL MAY (never into a client's own time limit): no reply yet says to call again
  let listened = false;
  if (verb === 'chat-wait') {
    const lim = CALL_MS - 5000, asked = Number(cmd.timeout) || 0;
    if (!asked || asked > lim) { cmd.timeout = lim; listened = true; }
  }
  const res = await exchange(v, cmd, ctx);
  if (listened) annotate(res, (o) => { if (o.timedOut && !o.text) o.next = 'no reply yet -- call chat_wait {host:"' + v.host + '"} again to keep listening'; });
  return res;
}
// change the JSON of a result's first block in place (a hint that rides on an answer)
function annotate(res, fn) {
  try {
    const b = res && res.content && res.content[0];
    if (!b || b.type !== 'text') return res;
    const o = JSON.parse(b.text);
    if (o && typeof o === 'object' && !Array.isArray(o)) { fn(o); b.text = JSON.stringify(o); }
  } catch (_) {}
  return res;
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
  const ctx = { id, progressToken: meta.progressToken, cancelled: false, progressN: 0, t0: Date.now() };
  const isMore = name === 'more' && MORE_VERBS.length > 0;
  if (name !== 'connect' && name !== 'disconnect' && name !== 'intake' && !isMore && !TOOL_VERB.has(name)) return rpcError(id, -32602, 'Unknown tool: ' + name);
  if (!args || typeof args !== 'object' || Array.isArray(args)) return reply(id, errResult('arguments is an object of the tool\'s fields'));
  // more {do:"<verb>", ...}: the verb it names, through the same checks as a tool of its own
  const moreVerb = isMore ? String(args.do == null ? '' : args.do).trim() : '';
  if (isMore && !verbs.V[moreVerb]) return reply(id, errResult('more needs do: a serve verb -- one of ' + MORE_VERBS.join(', ') + ' (or any other verb in the table)', { got: moreVerb || undefined }));
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
          // A VISIT NOT LET IN YET has no serve to hand a command to: say so (and how to keep waiting), or -- for
          // disconnect -- withdraw the ask
          if (!v.claimed && !v.exited) {
            if (name === 'disconnect') { await stopChild(v, 2000); forget(v); return okResult({ ok: true, ended: true, wasWaiting: true, host: v.host }); }
            return errResult('the visit to machine ' + v.host + ' is not open yet -- it is waiting for a person to press Allow' + (v.code ? ' (code ' + v.code + ')' : '') +
              ': call connect {host:"' + v.host + '"} to keep waiting', { waiting: true, code: v.code || undefined });
          }
          if (name === 'disconnect') return disconnect(v, args, ctx);
          return callVerb(v, isMore ? moreVerb : TOOL_VERB.get(name), args, ctx);
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
sweepOld();   // pictures earlier visits under WORK left behind (a client that was killed)
log('ready: ' + TOOLS.length + ' tools (' + TOOL_VERB.size + ' verbs from core/verbs.js); visits go in ' + WORK);

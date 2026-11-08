'use strict';
// @tool hand a command to the serve loop and read its answer: putCmd, exchange, budgetOf
// @run  const { exchange } = require('../core/cmd-file.js')   (a library; drive/ and the skills use it)
// HANDING A COMMAND TO THE SERVE LOOP.
//
// Every client in this kit (drive.js, run.js, plan.js) gives agent-join.js --serve its next command the same
// way: write it to cmd.json.tmp, then RENAME that over cmd.json, so the loop can never read half a command.
// On Windows the rename is refused -- EPERM, EACCES or EBUSY -- for as long as anything else has cmd.json
// open: the loop reading the previous command, a test's stand-in loop, a virus scanner looking at a new
// file. Thrown, that refusal lost the command outright (a sudoku run lost its final frame, so the panel
// never went green). So a refusal is retried for up to two seconds, and anything else is still thrown.
const fs = require('fs'), path = require('path');

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function putCmd(cmdFile, cmd) {
  const tmp = cmdFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cmd));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, cmdFile); return; } catch (e) {
      if (i >= 100 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      pause(20);
    }
  }
}

// How long to wait for THIS command's answer. Most are near-instant; a few block on the host side for as
// long as the caller asked -- `chat-wait` holds for the operator's reply, a big `plan`/`strokes`/`wait`
// runs a while -- so the local poll is bounded by the command's own patience + margin (a 2-minute
// chat-wait is not cut off at 30s, which once signed the agent out while the operator was still typing).
const budgetOf = (c) => {
  const base = Number(c.timeout) || 0;
  if (c.do === 'chat-wait') return (base || 120000) + 8000;
  if (c.do === 'wait')      return (base || 30000) + 8000;
  if (c.do === 'plan' || c.do === 'strokes' || c.do === 'stroke') return Math.max(130000, base + 8000);
  // an `achieve` polls its check for up to `timeout`; a plan with a preview, an achieve at a checkpoint and `ask` wait
  // for the ROOM too (default 60 s) -- an achieve at a checkpoint may do both
  if (c.do === 'mission') return (c.op === 'plan' && c.preview) || c.op === 'ask' || c.op === 'achieve' ? 2 * Math.min(300000, base || 60000) + 15000 : Math.max(35000, base + 15000);
  if (c.do === 'camera' || c.do === 'audio') return Math.min(300000, base || 60000) + 90000;   // asked first, then captured
  if (c.do === 'fetch' || c.do === 'send') return 20 * 60000;      // one command per chunk: a big file is minutes
  if (c.do === 'undo') return Math.min(300000, base || 60000) + 75000;   // the room's yes, then the undo itself (60 s)
  if (c.do === 'captcha') return (base || 600000) + 8000;          // waits for a PERSON to solve it (10 min default)
  if (c.do === 'access') return 200000;                            // a new Allow card: the person has ~2.5 min to press it
  if (c.do === 'exec') return Math.min(120000, base || 30000) + 15000;
  if (c.do === 'terminal') return Math.min(600000, base || 30000) + 25000;   // its own timeout, plus opening the shell   // the host's own limit is two minutes
  if ((c.do === 'spotlight' || c.do === 'beam') && c.forever) return 30 * 60000 + 15000;   // until they write, at most 30 min
  if (c.do === 'confirm') return Math.max(35000, (base || 20000) + 8000);
  // TYPING LIKE A PERSON TAKES A PERSON'S TIME: about 0.16 s a character at the default pace (300 characters ~48 s, 600 ~83 s,
  // measured on core/autotype.js) -- a flat 35 s made a driver give up on a run still typing, and its next answer was
  // read as this one's
  if (c.do === 'keys' || c.do === 'open') return Math.max(35000, typingMs(c) + 20000 + (c.do === 'open' ? (Number(c.wait) || 2500) : 0));
  return 35000;
};
// how long a keys / open types for: nothing to speak of when instant (human:0), else the pace per character
function typingMs(c) {
  const text = String((c.do === 'open' ? c.url : c.text) == null ? '' : (c.do === 'open' ? c.url : c.text));
  const instant = c.human === false || c.human === 0 || c.human === '0' || c.human === 'false';
  if (instant && !c.speed) return 0;
  const per = c.speed === 'slow' ? 260 : c.speed === 'fast' ? 110 : 170;
  return Math.round(text.length * per);
}

// ONE COMMAND AND ITS ANSWER, from inside a script: the same hand-over drive.js makes, without starting a
// node process per command (a routine of fifteen commands paid for fifteen). Clears done.json, hands the
// command over, and polls for the answer -- re-reading one caught half-written rather than failing on it.
// EVERY COMMAND CARRIES ITS OWN ID (cid), and its answer is the done.json that carries the same one back (the serve
// echoes it). A driver that gave up on a command -- out of time -- used to read the NEXT done.json as the next command's
// answer: the late one, the previous command's. From then on every answer belonged to the command before it (a keys
// retried was typed twice). And on giving up, a command the serve has not read yet is taken back: it never runs.
let cidSeq = 0;
const newCid = () => (process.pid % 10000) * 1000000 + (++cidSeq % 1000000);
function handOver(dir, cmd) {
  try { fs.unlinkSync(path.join(dir, 'done.json')); } catch (_) {}
  const c = Object.assign({}, cmd);
  if (c.cid == null) c.cid = newCid();
  putCmd(path.join(dir, 'cmd.json'), c);
  return c.cid;
}
// this command's answer, if it is there: {o, txt}; null for nothing yet, half-written, or another command's (late) answer.
// A note the serve leaves when the visit ends carries no cid, and is everyone's answer.
function readAnswer(dir, cid) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(dir, 'done.json'), 'utf8'); } catch (_) { return null; }
  if (!txt) return null;
  let o; try { o = JSON.parse(txt); } catch (_) { return null; }
  if (o && typeof o === 'object' && o.cid != null && cid != null && o.cid !== cid) return null;
  return { o, txt };
}
// the serve deletes cmd.json once it has read it: still there means not read, and taking it back means it never runs
function takeBack(dir) { try { fs.unlinkSync(path.join(dir, 'cmd.json')); return true; } catch (_) { return false; } }
const timedOut = (cmd, budget, dir) => {
  const back = takeBack(dir);
  return new Error('TIMEOUT after ' + Math.round(budget / 1000) + 's waiting for done.json' +
                   (back ? ' -- the serve had not taken it yet: it was taken back and never ran' : ' -- it is still running; its answer will not be read as the next command\'s'));
};
function exchange(dir, cmd) {
  const cid = handOver(dir, cmd);
  const t0 = Date.now(), budget = budgetOf(cmd);
  for (;;) {
    const a = readAnswer(dir, cid);
    if (a) return a.o;
    if (Date.now() - t0 > budget) throw timedOut(cmd, budget, dir);
    pause(10);
  }
}
// ...and the same, waited for without blocking: resolves {o, txt}, rejects on running out of time
function exchangeAsync(dir, cmd, poll) {
  return new Promise((resolve, reject) => {
    const cid = handOver(dir, cmd);
    const t0 = Date.now(), budget = budgetOf(cmd);
    (function wait() {
      const a = readAnswer(dir, cid);
      if (a) return resolve(a);
      if (Date.now() - t0 > budget) return reject(timedOut(cmd, budget, dir));
      setTimeout(wait, poll || 80);
    })();
  });
}

module.exports = { putCmd, budgetOf, exchange, exchangeAsync, handOver, readAnswer, takeBack, typingMs };

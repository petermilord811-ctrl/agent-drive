// board.js -- core/board.js: the requests the watchers' board sends (marks), approvals, risk, and where a task's time went.
//   node tests/board.js
'use strict';
const path = require('path');
const BD = require(path.join(__dirname, '..', 'core', 'board.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// ---- every button's line reads back as what it asks, with the question it answers --------------------------------
{
  const kinds = ['pause', 'resume', 'stop-task', 'stop-after', 'end', 'yes', 'no', 'solved', 'undo', 'skip', 'redo', 'autonomy', 'save-skill', 'run-again', 'schedule', 'nudge'];
  for (const k of kinds) {
    const line = BD.markText(k, { q: 'q7', step: 'Attach the file', id: 'c3', mode: 'risky', when: 'every day at 09:00' });
    const p = BD.parseMark(line);
    ok(!!p && p.kind === k, k + ': its line reads back as ' + k + ' ("' + line + '" -> ' + (p && p.kind) + ')');
  }
  ok(BD.parseMark(BD.markText('yes', { q: 'q12' })).q === 'q12', 'a yes names the question it answers');
  ok(BD.parseMark(BD.markText('no', { q: 'q3' })).q === 'q3', '...and so does a no');
  ok(BD.parseMark(BD.markText('stop-after', { step: 'Attach the file' })).step === 'Attach the file', 'stop-after names its step');
  ok(BD.parseMark(BD.markText('skip', { step: 'Read the board' })).step === 'Read the board', 'skip names its step');
  ok(BD.parseMark(BD.markText('undo', { id: 'c3' })).arg === 'c3', 'undo names the change');
  ok(BD.parseMark(BD.markText('undo', { id: 'all' })).arg === 'all', '...or all of them');
  for (const m of BD.MODES) ok(BD.parseMark(BD.markText('autonomy', { mode: m })).arg === m, 'autonomy reads back as ' + m);
  const st = BD.parseMark(BD.markText('yes', { q: 'q2', steps: 50 }));
  ok(st.kind === 'yes' && st.arg && st.arg.steps === 50, 'a yes that raises the budget says by how many steps');
  const mi = BD.parseMark(BD.markText('yes', { q: 'q2', minutes: 15 }));
  ok(mi.kind === 'yes' && mi.arg && mi.arg.minutes === 15, '...or minutes');
  ok(BD.parseMark(BD.markText('schedule', { when: 'weekdays at 08:30' })).arg === 'weekdays at 08:30', 'a schedule carries when');
}

// ---- only a mark makes a request: words alone, a mark later in the line, or another emoji do not -------------------
{
  ok(BD.parseMark('pause please') === null, 'the word "pause" is not a request');
  ok(BD.parseMark('yes go ahead') === null, 'a typed yes is not a button press (the serve reads it as before)');
  ok(BD.parseMark('ok ⏸') === null, 'a mark later in the line is not a request');
  ok(BD.parseMark('🙂 hi') === null, 'another emoji is not a request');
  ok(BD.parseMark('') === null && BD.parseMark(null) === null, 'nothing is nothing');
  const vs = BD.parseMark('▶️ Go on.');
  ok(!!vs && vs.kind === 'resume', 'a mark followed by the emoji presentation selector still reads');
  ok(BD.parseMark('  ⏸ Pause').kind === 'pause', 'leading spaces are fine');
  ok(BD.parseMark('✅ Yes').q === '', 'a yes without a question id has none (the serve then treats it as typed)');
}

// ---- risk: small and conservative --------------------------------------------------------------------------------
{
  ok(BD.riskOf({ do: 'click', x: 1, y: 1 }) === '', 'a click is not risky');
  ok(BD.riskOf({ do: 'keys', text: 'hello' }) === '', 'typing is not risky');
  ok(!!BD.riskOf({ do: 'exec', cmd: 'del x' }), 'a command run on the machine is risky');
  ok(BD.riskOf({ do: 'exec', cmd: 'dir' }, { readOnly: true }) === '', '...unless it only reads');
  ok(!!BD.riskOf({ do: 'send', file: 'a', to: 'b', overwrite: 1 }), 'overwriting a file is risky');
  ok(BD.riskOf({ do: 'send', file: 'a', to: 'b' }) === '', 'sending a new file is not');
  ok(!!BD.riskOf({ do: 'chord' }, { chord: 'Alt+F4' }), 'Alt+F4 is risky (it can close unsaved work)');
  ok(BD.riskOf({ do: 'chord' }, { chord: 'Ctrl+L' }) === '', 'Ctrl+L is not');
  ok(!!BD.riskOf({ do: 'click' }, { irreversible: true }), 'anything the change record cannot put back is risky');
}

// ---- approvals: a yes is for ONE command, once ---------------------------------------------------------------------
{
  const A = BD.approvals();
  const c = { do: 'click', x: 412, y: 96, intent: 'Browse', why: 'the list is stale', cid: 7 };
  ok(!A.take(c, 1000), 'nothing is approved before a yes');
  A.grant(c, 1000);
  ok(A.take({ do: 'click', y: 96, x: 412, cid: 8, why: 'again' }, 2000), 'the same command (any intent, why, cid or field order) runs on the yes');
  ok(!A.take(c, 2000), '...once: the yes is used up');
  A.grant(c, 1000, 500);
  ok(!A.take(c, 2000), 'a yes that has expired is not a yes');
  A.grant(c, 1000);
  ok(!A.take({ do: 'click', x: 413, y: 96 }, 1100), 'a different command is not covered by it');
  ok(BD.sigOf({ do: 'keys', text: 'a', look: { w: 1 } }) === BD.sigOf({ do: 'keys', text: 'a' }), 'a look riding along is not part of the command');
}

// ---- time: thinking, acting, waiting on people ---------------------------------------------------------------------
{
  const T = BD.timeSplit(0);
  T.begin({ do: 'click' }, 1000); T.end(1500);           // 0.5 s acting, after 1 s of thinking
  T.begin({ do: 'chat-wait' }, 3000); T.end(9000);       // 6 s waiting on people, after 1.5 s of thinking
  T.begin({ do: 'budget' }, 9000); T.waitNow(); T.end(12000); // the serve asked the room: waiting
  const b = T.brief(12000);
  ok(b.a === 500 && b.w === 9000 && b.t === 2500, 'acting, waiting and thinking add up (' + JSON.stringify(b) + ')');
  T.begin({ do: 'click' }, 12000);
  ok(T.brief(13000).a === 1500, 'a command still running counts as it goes');
  T.reset(20000);
  ok(JSON.stringify(T.brief(20000)) === JSON.stringify({ t: 0, a: 0, w: 0 }), 'a new task starts its clock again');
}

console.log((fail ? 'FAIL' : 'ok') + ' board: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

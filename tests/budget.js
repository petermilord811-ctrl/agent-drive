// budget.js -- core/budget.js: a task may take so many acting steps and minutes; then the agent stops and asks.
//   node tests/budget.js
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'core', 'budget.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

let t = 1000000;
const clock = () => t;
const MIN = 60000;

// ---- what counts as a step: acting on the machine, once per top-level command
{
  const b = B.create({ steps: 3, minutes: 30, now: clock });
  b.start('fill in the form');
  for (const c of [{ do: 'look', out: 'a.png' }, { do: 'chat', text: 'hi' }, { do: 'status', text: 'x' }, { do: 'expect', until: {} }, { do: 'mission', op: 'show' }]) b.count(c);
  ok(b.brief().steps.used === 0, 'looking, talking, the panel and the plan\'s bookkeeping are not steps');
  b.count({ do: 'plan', steps: new Array(60).fill({ do: 'click', x: 1, y: 1 }) });
  ok(b.brief().steps.used === 1, 'a plan of sixty clicks is ONE step: it was one decision');
  b.count({ do: 'click', x: 1, y: 1 }); b.count({ do: 'keys', text: 'abc' });
  ok(b.brief().steps.used === 3 && b.spent(), 'three acting commands spend a budget of three');
  const no = b.check({ do: 'click', x: 1, y: 1 });
  ok(!!no && /budget is spent \(3 of 3 steps/.test(no.why) && /fill in the form/.test(no.why) && no.budget.spent, 'the next acting command is refused, with what was used and on which task (' + (no && no.why) + ')');
  ok(b.check({ do: 'look', out: 'a.png' }) === null && b.check({ do: 'chat', text: 'x' }) === null && b.check({ do: 'status', fin: 1 }) === null && b.check({ do: 'done' }) === null,
     '...but looking, talking, the panel and signing off are never refused');
  ok(b.check({ do: 'exec', cmd: 'dir' }) && b.check({ do: 'terminal', input: 'ls' }) && b.check({ do: 'send', file: 'a' }) && b.check({ do: 'undo', id: 'c1' }), 'commands, the terminal, sending a file and undoing all act');
}

// ---- minutes, and time spent waiting on people
{
  t = 5000000;
  const b = B.create({ steps: 0, minutes: 10, now: clock });
  b.start('survey');
  ok(b.check({ do: 'click' }) === null, 'a fresh task may act');
  t += 6 * MIN;
  b.rest(5 * MIN);
  ok(!b.spent() && b.brief().minutes.used === 1, 'time waiting on people (a confirm, a chat-wait) does not count (' + b.brief().minutes.used + ' min counted)');
  t += 9 * MIN;
  ok(b.spent() && /10 of 10 minutes/.test(b.check({ do: 'click' }).why), 'ten minutes of work spend a ten-minute budget (' + b.words() + ')');
  ok(b.brief().steps.limit === null, 'no step limit is shown as none');
}

// ---- the 80% hint, once
{
  t = 9000000;
  const b = B.create({ steps: 10, now: clock });
  b.start('x');
  for (let i = 0; i < 7; i++) b.count({ do: 'click' });
  ok(b.hint() === null, 'no hint at 70%');
  b.count({ do: 'click' });
  const h = b.hint();
  ok(!!h && /nearly spent \(8 of 10 steps\)/.test(h) && /"do":"budget","more":1/.test(h), 'at 80% the answer carries a hint, with how to ask (' + h + ')');
  ok(b.hint() === null, '...once');
}

// ---- asking for more: the room's yes raises it, from where it stands
{
  t = 12000000;
  const b = B.create({ steps: 5, minutes: 20, now: clock });
  b.start('sort the files');
  for (let i = 0; i < 5; i++) b.count({ do: 'click' });
  const q = b.question('Two folders are left; I know where they go now.');
  ok(/^⏱ \*\*I have used this task's budget\*\* on “sort the files” — 5 of 5 steps/.test(q) && /Two folders are left/.test(q) && /Shall I carry on for 5 more steps and 20 more minutes\?$/.test(q),
     'the question says what was used, the agent\'s reason, and what going on would give (' + q + ')');
  b.more();
  ok(!b.spent() && b.brief().steps.limit === 10 && b.brief().minutes.limit === 40 && b.check({ do: 'click' }) === null,
     'a yes gives as much again as the task started with, steps and minutes (' + b.words() + ')');
  t += 41 * MIN;
  ok(b.spent(), 'and minutes run out on their own');
  b.more({ minutes: 15 });
  ok(!b.spent() && b.brief().minutes.limit === 56, 'more {minutes} counts from where it stands now (41 min used), not from the old limit (' + b.brief().minutes.limit + ')');
}

// ---- lowering is free, raising is asking
{
  const b = B.create({ steps: 50, minutes: 30, now: clock });
  b.start('x');
  ok(!b.want({ steps: 20 }).raises && !b.want({ minutes: 10 }).raises, 'a lower limit is simply taken');
  ok(b.want({ steps: 80 }).raises && b.want({ minutes: 45 }).raises, 'a higher one has to be asked for');
  ok(b.want({ steps: 0 }).raises, 'so does "no limit"');
  const none = B.create({ now: clock });
  none.start('y');
  ok(none.brief() === null && none.check({ do: 'click' }) === null, 'with no limits there is no budget at all');
  ok(!none.want({ steps: 10 }).raises, '...and putting one on is lowering it');
  b.set({ steps: 2 });
  b.count({ do: 'click' }); b.count({ do: 'click' });
  ok(b.spent(), 'a lowered limit holds');
}

// ---- a new task starts again
{
  const b = B.create({ steps: 2, now: clock });
  b.start('first');
  b.count({ do: 'click' }); b.count({ do: 'click' });
  ok(b.spent(), 'spent');
  b.set({ steps: 9 });
  b.start('second');
  ok(!b.spent() && b.brief().steps.used === 0 && b.brief().steps.limit === 2 && b.task() === 'second', 'a new task starts with no steps used, and the limit it started with');
}

// ---- odd input never throws
{
  let threw = false;
  try {
    const b = B.create({ steps: 'lots', minutes: { toString: 1 }, now: () => 'soon' });
    b.start({ toString() { throw new Error('x'); } });
    b.count(null); b.count('click'); b.count({ do: 7 }); b.check(undefined); b.rest('x'); b.more({ steps: -4 }); b.want(null); b.set({ steps: 'x' });
    b.hint(); b.brief(); b.question({});
  } catch (e) { threw = e; }
  ok(!threw, 'odd input never throws' + (threw ? ' (' + threw.message + ')' : ''));
  ok(B.create({ steps: 1e12 }).brief().steps.limit === 100000, 'a limit is capped, so a typo cannot ask for a year');
}

console.log((fail ? 'FAIL' : 'ok') + ' budget: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

// verbs.js — the serve's verb table (core/verbs.js): what each command may say, checked
// before it runs. Live on 10002 {do:"keys", keys:"chrome"} typed nothing and answered ok fifteen times; this
// holds the renames, the refusals, the whole-plan check -- and the table to the serve (every verb it runs is in
// the table and every verb in the table is run) and to docs/reference/serve-protocol.md (every verb documented).
//   node tests/verbs.js
'use strict';
const fs = require('fs'), path = require('path');
const AD = path.join(__dirname, '..');
const verbs = require(path.join(AD, 'core', 'verbs.js'));
const { vet, vetPlan, keyCode, modCodes } = verbs;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };

// ---- the slip that started it: renamed, said so, and the command now does what it meant
let v = vet({ do: 'keys', keys: 'chrome' });
ok(v.ok && v.cmd.text === 'chrome' && v.cmd.keys === undefined, 'keys.keys becomes keys.text');
ok(v.fixed.some((f) => /keys\.keys is keys\.text/.test(f)), 'the rename is reported in fixed');
v = vet({ do: 'keys', keys: ['a', 'b'] });
ok(v.ok && v.cmd.text === 'ab', 'a list of keys to type is joined');

// ---- verb aliases
ok(vet({ do: 'sleep', ms: 500 }).cmd.do === 'pause', 'sleep -> pause');
ok(vet({ do: 'type', text: 'x' }).cmd.do === 'keys', 'type -> keys');
ok(vet({ do: 'CLICK', x: 1, y: 2 }).cmd.do === 'click', 'case-insensitive verb');
v = vet({ do: 'key', code: 'esc' });
ok(v.ok && v.cmd.do === 'press' && v.cmd.code === 'Escape', 'key -> press, esc -> Escape');
v = vet({ do: 'key', code: 'F4', mod: 'alt' });
ok(v.ok && v.cmd.do === 'chord' && v.cmd.mod === 'AltLeft' && v.cmd.code === 'F4', 'key with a modifier -> chord');
v = vet({ do: 'key', code: 'AltLeft', modify: ['F4'] });
ok(v.ok && v.cmd.do === 'chord' && v.cmd.mod === 'AltLeft' && v.cmd.code === 'F4', 'key + modify:[...] -> chord Alt+F4');

// ---- refusals, before anything is sent
v = vet({ do: 'clik', x: 1, y: 2 });
ok(!v.ok && /did you mean "click"/.test(v.why), 'an unknown verb suggests the nearest');
v = vet({ do: 'click', x: 1, y: 2, butt: 'left' });
ok(!v.ok && /does not read butt/.test(v.why) && /nothing was sent/.test(v.why), 'a field the verb does not read is refused');
v = vet({ do: 'keys', txt: 'hi' });
ok(!v.ok && /did you mean text/.test(v.why), 'a near-miss field names the real one');
ok(!vet({ do: 'keys' }).ok, 'keys with nothing to type is refused');
ok(!vet({ do: 'keys', text: '' }).ok, 'keys with empty text is refused');
ok(!vet({ do: 'click' }).ok, 'a click with no point is refused');
ok(vet({ do: 'click', lx: 10, ly: 20 }).ok, 'a click in look pixels is a point');
ok(vet({ do: 'click', at: 'Save' }).ok, 'a click at a found name is a point');
ok(!vet({ do: 'open' }).ok && !vet({ do: 'chat' }).ok, 'open needs url, chat needs text');
ok(!vet({ do: 'look' }).ok && vet({ do: 'look', out: 'a.png' }).ok, 'look needs out');
ok(vet({ do: 'click', x: 1, y: 2, look: { out: 'a.png' } }).ok, 'an acting verb may carry look:{}');
ok(!vet({ do: 'probe', x: 1, y: 2, look: { out: 'a.png' } }).ok, 'a looking verb may not carry look:{}');
ok(!vet(null).ok && !vet([]).ok && !vet({}).ok && !vet({ do: '' }).ok, 'odd input is refused, never thrown');
ok(vet({ do: 'click', x: 1, y: 2, intent: 'Save', quiet: 1 }).ok, 'common fields are allowed on every verb');

// ---- hostile input: never throws, never mistakes the prototype for the table
let threw = false;
try { v = vet({ do: 'click', x: { toString: 1 }, y: 2 }); } catch (_) { threw = true; }
ok(!threw && !v.ok, '{"toString":1} as a coordinate is refused, not thrown (it took the serve loop down)');
ok(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'].every((d) => !vet({ do: d }).ok), 'Object.prototype names are not verbs');
ok(!vet({ do: 'keys', text: 'a', toString: 'x' }).ok && !vet({ do: 'keys', text: 'a', constructor: 1 }).ok, '...nor fields');
ok(keyCode('constructor') === 'constructor' && keyCode('toString') === 'toString', '...nor key names');
ok(!vet({ do: 'click', x: [1], y: 2 }).ok && !vet({ do: 'click', x: true, y: 2 }).ok, 'a list or a boolean is not a coordinate');
ok(vet({ do: 'click', x: '12', y: '4' }).ok, 'a number written as a string still is one');
ok(!vet({ do: 'chat', text: { a: 1 } }).ok, 'an object is not text');

// ---- key names
ok(keyCode('enter') === 'Enter' && keyCode('a') === 'KeyA' && keyCode('5') === 'Digit5' && keyCode('f5') === 'F5', 'key names -> codes');
ok(keyCode('ArrowDown') === 'ArrowDown' && keyCode('NumpadAdd') === 'NumpadAdd', 'real codes pass through');
ok(modCodes('ctrl+shift') === 'ControlLeft+ShiftLeft' && modCodes(['win']) === 'MetaLeft' && modCodes() === 'ControlLeft', 'modifiers');

// ---- a whole plan, before its first step
let p = vetPlan([{ do: 'click', x: 1, y: 2 }, { do: 'sleep', ms: 100 }, { do: 'keys', keys: 'hi' }]);
ok(p.ok && p.steps[1].do === 'pause' && p.steps[2].text === 'hi', 'a plan is fixed whole');
ok(p.fixed.length === 2 && /^step 2:/.test(p.fixed[0]), 'each fix names its step');
ok(p.steps.every((s) => s.__vetted), 'every step comes back vetted');
p = vetPlan([{ do: 'click', x: 1, y: 2 }, { do: 'click', x: 1, y: 2 }, { do: 'keys', txt: 'x' }]);
ok(!p.ok && p.at === 2 && /step 3/.test(p.why), 'a slip at step 3 refuses the plan, naming it');
p = vetPlan([{ if: { px: [1, 1, '#fff'] }, then: [{ do: 'type', text: 'a' }], else: [{ do: 'kees', text: 'b' }] }]);
ok(!p.ok && /step 1 else > step 1/.test(p.why), 'branches are checked too');
p = vetPlan([{ repeat: 3, until: { stable: true }, steps: [{ do: 'press', key: 'down' }] }]);
ok(p.ok && p.steps[0].steps[0].code === 'ArrowDown', 'loop bodies are fixed too');
p = vetPlan([{ if: { px: [1, 1, '#fff'] }, then: [], otherwise: [] }]);
ok(!p.ok && /otherwise/.test(p.why), 'a choice with a stray key is refused');
ok(!vetPlan('nope').ok, 'steps that are not a list are refused');

// ---- the table matches the serve, both ways
const serve = fs.readFileSync(path.join(AD, 'core', 'agent-join.js'), 'utf8');
const ran = new Set([...serve.matchAll(/cmd\.do === '([A-Za-z-]+)'/g)].map((m) => m[1]));
const missingInServe = verbs.VERBS.filter((x) => !ran.has(x));
const missingInTable = [...ran].filter((x) => !verbs.V[x]);
ok(!missingInServe.length, 'every verb in the table is run by the serve (missing: ' + missingInServe.join(', ') + ')');
ok(!missingInTable.length, 'every verb the serve runs is in the table (missing: ' + missingInTable.join(', ') + ')');

// ---- the verb list at the top of agent-join.js names every verb too (it once called `spotlight` the dimming beam)
const header = serve.slice(0, serve.search(/\nconst /));   // the comment block above the first declaration
const notInHeader = verbs.VERBS.filter((x) => !new RegExp('(^|[^\\w-])' + x.replace(/-/g, '\\-') + '([^\\w-]|$)', 'm').test(header));
ok(!notInHeader.length, 'every verb is in agent-join.js\'s header list (missing: ' + notInHeader.join(', ') + ')');
ok(/beam \{x,y,size,hold,forever\}\s+the focus beam: dim/.test(header) && !/spotlight \{x,y,size,hold\} dim/.test(header), 'the header says beam dims and spotlight circles, as the docs do');

// ---- and every verb is documented
const doc = fs.readFileSync(path.join(AD, 'docs', 'reference', 'serve-protocol.md'), 'utf8');
const undocumented = verbs.VERBS.filter((x) => !new RegExp('`' + x.replace(/-/g, '\\-') + '[` ]').test(doc) && !doc.includes('"do":"' + x + '"') && !doc.includes("do:'" + x + "'"));
ok(!undocumented.length, 'every verb is in serve-protocol.md (missing: ' + undocumented.join(', ') + ')');

// ---- the doc's verb table IS the checker's table (generated; `node kit.js verbs --write-doc` refreshes it)
const a = doc.indexOf(verbs.DOC_BEGIN), b = doc.indexOf(verbs.DOC_END);
ok(a >= 0 && b > a, 'serve-protocol.md carries the generated verb table');
ok(a >= 0 && b > a && doc.slice(a, b + verbs.DOC_END.length) === verbs.markdown(), 'serve-protocol.md\'s verb table is current -- run: node kit.js verbs --write-doc');
ok(verbs.withDocBlock(doc) === doc, 'writing the table into a current doc changes nothing');
ok(verbs.withDocBlock('# x\n').endsWith(verbs.DOC_END + '\n'), 'a doc without the marks gets the table appended');

console.log((fail ? 'FAIL' : 'ok') + ' verbs: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

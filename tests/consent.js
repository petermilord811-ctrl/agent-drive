// consent.js — core/consent.js: what a reply to `confirm` ("may I restart it?") means.
// The old gate approved on a yes-word anywhere: "not sure" and "go back first" came back APPROVED, while
// "never", "nah", "not now" and "let me think" came back unclear -- which the standing yes (SM_AUTO_CONFIRM)
// then turned into approved although somebody had answered. Offline, no dependencies.
//   node tests/consent.js
'use strict';
const path = require('path');
const { confirmReply, confirmVerdict } = require(path.join(__dirname, '..', 'core', 'consent.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const is = (text, want) => { const got = confirmReply(text); ok(got === want, JSON.stringify(text) + ' -> ' + got + ' (want ' + want + ')'); };

// ---- the report's cases
is('not sure', 'no');            // "sure" inside it approved before
is('go back first', 'no');       // "go" inside it approved before
is('never', 'no');
is('nah', 'no');
is('not now', 'no');
is('let me think', 'no');

// ---- a negation, deferral or hesitation anywhere wins
for (const t of ['no', 'No.', 'nope', 'n', 'stop', 'STOP!', 'wait', 'hold on', 'cancel', 'abort', "don't", 'don’t do that', 'do not',
                 'later', 'not yet', 'yes but first save my work', 'yes, after lunch', 'ok wait', 'sure, once the upload finishes',
                 'maybe', 'hmm', 'idk', 'why?', 'what is it doing', 'yes, but close Word instead', 'go ahead without restarting',
                 'wrong window', 'never mind', 'please keep it open', 'yes then restart again']) is(t, 'no');
// ---- the Stop button, a thumbs-down, a Steer / New task reply
is('⛔ Stop', 'no');
is('👎', 'no');
is('Please change: use Firefox', 'no');
is('New task: open the mail', 'no');

// ---- a yes is a SHORT reply of nothing but yes-words
for (const t of ['yes', 'Yes!', 'y', 'yep', 'yeah', 'ok', 'OK.', 'okay', 'k', 'sure', 'go', 'go ahead', 'yes go ahead', 'do it',
                 'ok do it', 'yes, do it', 'please do', 'go for it', 'proceed', 'confirmed', 'approved', 'fine', "that's fine",
                 'sounds good', 'all right', 'alright', '👍', '✅', 'yes please']) is(t, 'yes');

// ---- anything else is unclear
for (const t of ['', '   ', 'I am on my phone', 'the file is called report.docx', 'it is', 'yes the report is on the desktop somewhere',
                 'restart', 'the blue one']) is(t, 'unclear');
ok(confirmReply(null) === 'unclear' && confirmReply(42) === 'unclear', 'a non-string is unclear, never thrown');

// ---- a window of replies
const v = (replies, standing) => confirmVerdict(replies, standing);
ok(v([{ text: 'yes' }]).verdict === 'approved', 'a yes approves');
ok(v([{ text: 'yes' }, { text: 'wait' }]).verdict === 'cancelled', 'a cancel wins even after a yes');
ok(v([{ text: 'stop' }, { text: 'yes' }]).verdict === 'cancelled', 'a cancel wins before a yes too');
ok(v([{ text: 'I am on my phone' }]).verdict === 'unclear', 'an unreadable reply is unclear');
ok(v([], true).verdict === 'approved' && v([], true).auto === true, 'the standing yes fills a SILENT window');
ok(v([{ text: 'I am on my phone' }], true).verdict === 'unclear', '...but never a window somebody answered');
ok(v(['let me think'], true).verdict === 'cancelled', '...and a hesitation is still a no under the standing yes');
ok(v([]).verdict === 'unclear', 'without the standing yes, silence is unclear');

console.log((fail ? 'FAIL' : 'ok') + ' consent: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

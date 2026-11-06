'use strict';
// =================================================================================================
// tests/signoff.js -- OFFLINE unit test of the sign-off matcher (core/signoff.js).
// No relay, host, or network. Run: node tests/signoff.js
//
// The matcher decides whether an operator's chat reply to "Anything else, or shall I sign off?" means
// "yes, end it". It must honour clear sign-offs and bare affirmatives, and must NOT end a session on a
// deferral, a negation, or a "do more first" reply -- even when the words "sign off" appear.
// =================================================================================================

const { isSignoffReply, normalize } = require('../core/signoff.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  [x] FAIL: ' + msg); } }
const yes = (t) => ok(isSignoffReply(t) === true, 'should SIGN OFF: ' + JSON.stringify(t));
const no = (t) => ok(isSignoffReply(t) === false, 'should NOT sign off: ' + JSON.stringify(t));

// --- the exact messages that went unanswered in the live run (the reported bug) ---
yes('sign off');
yes('Please change: sign off');          // the panel's Steer button prefix

// --- clear sign-off phrases, bare and in a sentence ---
yes('signoff'); yes('sign-off'); yes('signing off'); yes('sign out'); yes('log off'); yes('logout');
yes('bye'); yes('goodbye'); yes('good night'); yes('goodnight');
yes("that's all"); yes('all done'); yes("we're done"); yes('done for now'); yes('wrap up');
yes('hand control back'); yes('you can go'); yes('end the session'); yes('sign me off');
yes('ok you can sign off now');          // phrase inside a longer, non-deferring reply
yes("that's all for tonight");           // trailing words, still clearly done
yes('New task: sign off');               // even mislabelled as a "new task", the content is a sign-off

// --- bare affirmatives answering "shall I sign off?" ---
yes('yes'); yes('yep'); yes('yeah'); yes('sure'); yes('ok'); yes('okay'); yes('yes please');
yes('go ahead'); yes('do it'); yes('please do'); yes('confirmed'); yes('alright');
yes('Yes.'); yes('  OK!  ');             // punctuation / whitespace / case are normalized away

// --- deferrals / negations: must NOT end the session even though they mention signing off ---
no("don't sign off yet"); no('not yet'); no('no'); no('wait'); no('hold on');
no('sign off after you finish task 5'); no('sign off once the drawing is done');
no('one more task then sign off'); no('do another one first'); no('keep going');
no('yes but first finish the report'); no('not done yet'); no('hold on, not yet');

// --- unrelated replies and new tasks: not a sign-off ---
no('draw another picture'); no('what is the weather'); no('New task: play minesweeper');
no('can you solve a sudoku next'); no('nice work'); no('thanks'); no(''); no('   ');
no('sign'); no('offer');                 // partial words must not trip the phrase match
no(null); no(undefined); no(42);         // non-strings are handled

// --- once the agent has asked something ELSE since "shall I sign off?", a bare "yes" answers that ---
// (a review found "yes" to "shall I restart it too?" ending the session)
ok(isSignoffReply('yes', { affirm: false }) === false && isSignoffReply('ok', { affirm: false }) === false, 'with affirm:false a bare "yes"/"ok" is not a sign-off');
ok(isSignoffReply('sign off', { affirm: false }) === true && isSignoffReply('bye', { affirm: false }) === true, '...while an unmistakable phrase still is');
ok(isSignoffReply('yes', { affirm: true }) === true && isSignoffReply('yes', {}) === true, 'affirm defaults to true');

// --- normalize() basics ---
ok(normalize('  ⛔ Stop ') === 'stop', 'normalize strips a leading no-entry mark and trims');
ok(normalize('Please change: Sign Off!') === 'sign off', 'normalize lowercases, strips the Steer prefix and trailing punctuation');
ok(normalize(123) === '', 'normalize of a non-string is empty');

console.log(`signoff: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

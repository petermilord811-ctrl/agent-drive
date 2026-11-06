'use strict';
// @tool decide if an operator's chat reply means "sign off", so the serve client can end the session itself; pure, offline
// @run  const { isSignoffReply } = require('./signoff.js')   (a library; core/agent-join.js uses it)
// core/signoff.js -- decide whether an operator's chat reply means "yes, sign off / we're done".
//
// WHY. When a task finishes the serve client posts the panel's report plus "Anything else, or shall I
// sign off?" to the room (see the fin edge in core/agent-join.js). But the client only ever ACTED on
// chat while the driver was in a command loop or a `chat-wait`; a finished run that had handed its turn
// back sat idle and DEAF, so an operator answering "sign off" got no response (the reported bug). The
// Stop button is already honoured by the client itself (it posts the no-entry mark). This lets the same
// self-honoured path accept a plain-language sign-off: the client ends the session when the operator
// answers the sign-off question affirmatively while the run is still in its finished (green) state.
//
// Deliberately CONSERVATIVE -- better to miss a sign-off (the operator can repeat it or press Stop) than
// to end a session the operator did not mean to end: a deferral, a negation, or a "do more first" reply
// is NOT a sign-off even if it says the words, and a bare "yes" counts only because the caller gates this
// on having JUST asked "shall I sign off?". Pure and offline; proven in tests/signoff.js.

// Panel buttons prefix the text (Steer -> "Please change: …", New task -> "New task: …") and Stop posts a
// leading no-entry mark; strip those and any surrounding quotes/punctuation before matching.
function normalize(text) {
  if (typeof text !== 'string') return '';
  let t = text.trim().toLowerCase();
  t = t.replace(/^[\s⛔]+/, '');                            // a leading no-entry mark (⛔) or whitespace
  t = t.replace(/^(please change:|new task:|steer:)\s*/i, '');  // the panel-button prefixes
  t = t.replace(/^["'`\s]+/, '').replace(/["'`.!?…\s]+$/, '');  // surrounding quotes / trailing punctuation
  return t.trim();
}

// A reply that DEFERS, NEGATES, or asks for MORE work is never a sign-off, even if it also says the words
// ("not yet", "don't sign off", "sign off after task 5", "one more", "keep going", "yes but first do X").
const NOT_DONE = /\b(no|not|never|dont|don't|doesn't|doesnt|can't|cant|cannot|won't|wont|isn't|wait|hold on|hold|yet|later|soon|then|once|when|until|upon|first|before|after|instead|another|again|more|next|also|else|continue|keep|still|hang on)\b/;

// Unambiguous sign-off phrases -- honoured anywhere in a non-deferring reply.
const PHRASES = [
  'sign off', 'signoff', 'sign-off', 'signing off', 'sign out', 'signout', 'sign me off',
  'log off', 'logoff', 'log out', 'logout', 'hand back', 'hand it back', 'hand control back',
  'give control back', 'you can go', 'you may go', 'end session', 'end the session',
  "that's all", 'thats all', 'that is all', 'all done', 'we are done', "we're done", 'were done',
  'done for now', 'wrap up', 'wrap it up', 'bye', 'goodbye', 'good bye', 'good night', 'goodnight',
];

// Short bare affirmatives -- only meaningful because they ANSWER the just-asked "shall I sign off?".
const AFFIRM = [
  'yes', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay', 'okey', 'kk', 'fine', 'alright', 'all right',
  'affirmative', 'yes please', 'go ahead', 'please do', 'do it', 'do so', 'confirmed',
];

// `opts.affirm: false` -- the sign-off question is no longer the last thing the agent asked (it has since
// asked "shall I restart it too?"), so a bare "yes" answers THAT; only an unmistakable phrase still counts.
function isSignoffReply(text, opts) {
  const t = normalize(text);
  if (!t) return false;
  if (NOT_DONE.test(t)) return false;                       // a deferral / negation / more-work reply
  if (PHRASES.some((p) => t === p || t.includes(p))) return true;
  if ((!opts || opts.affirm !== false) && t.length <= 20 && AFFIRM.includes(t)) return true;   // a bare "yes" answering the question
  return false;
}

module.exports = { isSignoffReply, normalize, NOT_DONE };

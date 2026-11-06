'use strict';
// @tool decide what a reply to a `confirm` question means -- yes, no, or unclear; a negation always wins; pure, offline
// @run  const { confirmReply, confirmVerdict } = require('./consent.js')   (a library; core/agent-join.js's `confirm` uses it)
// core/consent.js -- WHAT A PERSON'S ANSWER TO "MAY I?" MEANS.
//
// `confirm` gates the things that are hard to undo (a restart, a delete, a purchase). It used to approve on a
// yes-word ANYWHERE in a reply, against a no-list without "not", "never" or "later". Run on its own patterns:
// "not sure" and "go back first" came back APPROVED ("sure", "go"); "never", "nah", "not now", "let me think"
// came back unclear -- and with the standing yes on (SM_AUTO_CONFIRM, set in the kit's .env) unclear became
// approved even though somebody had answered. So, here:
//
//   * a NEGATION, DEFERRAL or HESITATION anywhere wins: signoff.js's list (no, not, never, wait, later, first,
//     until, ...) plus the words a person says when they are not sure (nah, maybe, hmm, let me think, stop...).
//     The Stop button (a leading ⛔) and a Steer / New task reply are a no;
//   * a YES is only a SHORT reply made of nothing but yes-words ("yes", "ok do it", "go ahead", "👍").
//     A yes-word inside anything longer is unclear -- the person said something else as well;
//   * everything else is unclear, and the caller treats unclear as no for anything that matters.
// `confirmVerdict` folds a window of replies: any no -> cancelled; else any yes -> approved; else unclear; and the
// standing yes may fill ONLY A SILENT window (nobody replied at all), never an answer it could not read.
//
// Pure and offline; proven in tests/consent.js.
const { normalize, NOT_DONE } = require('./signoff.js');

// what people say when it is not a yes, beyond signoff.js's deferrals and negations
const HESITATE = /\b(nah|nay|nope|negative|stop|cancel|abort|halt|wrong|nevermind|never mind|maybe|perhaps|unsure|dunno|idk|hmm+|hm+|uh+|um+|think|thinking|check|careful|risky|why|what|how|which|who|pause|hang on|one sec|one second|sec|moment|hesitate|doubt|unless|except|but|rather|prefer|instead|without|skip)\b/;
const NO_MARKS = /[⛔🛑✋👎❌🚫]/u;
const YES_WORDS = new Set(['yes', 'y', 'ye', 'yea', 'yeah', 'yep', 'yup', 'yess', 'yesss', 'sure', 'ok', 'okay', 'okey', 'k', 'kk',
  'go', 'ahead', 'do', 'it', 'proceed', 'confirm', 'confirmed', 'approve', 'approved', 'fine', 'alright', 'all', 'right',
  'affirmative', 'please', 'for', 'sounds', 'good', 'great', 'absolutely', 'definitely', 'correct', 'agreed', 'agree', 'granted',
  'that', 'thats', "that's", 'is', 'yes,', '👍', '✅', '👌', '✔', '✔️']);
// a phrase must still CONTAIN one of these -- "do it", "go ahead", "please" -- or "it is" would pass
const YES_CORE = new Set(['yes', 'y', 'ye', 'yea', 'yeah', 'yep', 'yup', 'yess', 'yesss', 'sure', 'ok', 'okay', 'okey', 'k', 'kk',
  'go', 'do', 'proceed', 'confirm', 'confirmed', 'approve', 'approved', 'fine', 'alright', 'right', 'affirmative', 'good', 'great',
  'absolutely', 'definitely', 'correct', 'agreed', 'agree', 'granted', '👍', '✅', '👌', '✔', '✔️']);

// One reply -> 'yes' | 'no' | 'unclear'.
function confirmReply(text) {
  if (typeof text !== 'string') return 'unclear';
  const raw = text.trim();
  if (!raw) return 'unclear';
  if (NO_MARKS.test(raw)) return 'no';                                           // the Stop button, a thumbs-down
  if (/^\s*(please change|new task|steer)\s*:/i.test(raw)) return 'no';           // a Steer / New task reply: do something else
  const t = normalize(raw).replace(/[’]/g, "'");
  if (!t) return 'unclear';
  if (t === 'n' || NOT_DONE.test(t) || HESITATE.test(t)) return 'no';
  const words = t.split(/[\s,.!;:]+/).filter(Boolean);
  if (words.length && words.length <= 5 && t.length <= 40 && words.every((w) => YES_WORDS.has(w)) && words.some((w) => YES_CORE.has(w))) return 'yes';
  return 'unclear';
}

// A window of replies -> { verdict: 'approved'|'cancelled'|'unclear', auto }. `standingYes` (SM_AUTO_CONFIRM)
// fills a SILENT window only.
function confirmVerdict(replies, standingYes) {
  const list = Array.isArray(replies) ? replies : [];
  let yes = false;
  for (const r of list) {
    const v = confirmReply(r && typeof r === 'object' ? r.text : r);
    if (v === 'no') return { verdict: 'cancelled', auto: false };
    if (v === 'yes') yes = true;
  }
  if (yes) return { verdict: 'approved', auto: false };
  if (standingYes && !list.length) return { verdict: 'approved', auto: true };
  return { verdict: 'unclear', auto: false };
}

module.exports = { confirmReply, confirmVerdict };

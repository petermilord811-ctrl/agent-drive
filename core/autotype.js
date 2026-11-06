'use strict';
// @tool type like a PERSON: the viewer's own "Like a person" planner (rhythm, pauses, the odd typo fixed by Backspace)
// @run  const at = require('./autotype.js'); const p = at.atPlan(text, {human:true, speed:'normal'}); await at.run(p, send)
// autotype -- WHAT THE VIEWER'S TYPE WINDOW DOES WHEN "LIKE A PERSON" IS TICKED, FOR AN AGENT.
//
// The serve's `keys` types at machine speed: every character 14 ms apart, nothing else. A person asked the agent
// to type "like a person" -- the viewer's auto-typer has that already (Natural rhythm and pauses, with the odd
// typo fixed by Backspace): a typist persona, a pace per letter pair, warm-up, bursts, thinking pauses at clause
// ends, slips onto a neighbouring key and back. So this is THAT planner, not a second imitation of it: the region
// between the marks below is tools/viewer.html's "Auto-type: the planner", character for character
// (tests/humantype.js holds it to the original; `node core/autotype.js --sync` copies it again after the viewer
// changes it). The desktop app carries the same copy for the same reason. Below the marks, `run` plays a plan.
//
// ---- BEGIN copy of tools/viewer.html "Auto-type: the planner" -- do not edit here --------------------------
// Auto-type: the planner
// =====================================================================
// Everything the "Type on the remote machine" window sends is decided HERE, ahead of time, as a list
// of steps -- and nothing here touches a socket, a timer or the DOM. That split is the whole design:
// a plan is a value, so a test can replay it into a model of an editor and assert the remote ends up
// holding exactly the text that was entered, for every speed, with the human imitation on, over
// hundreds of random seeds -- which is the one property this feature must never lose, and the one a
// running timer chain cannot be asked about.
//
// A step is { t, d, src } plus its payload:
//   { t: 'ch',   ch: 'a', ch2 }         type one code point (down + up, as text); with ch2, two code
//                                        points OVERLAPPED in ONE batch. The planner no longer emits
//                                        ch2 -- a real hand overlaps keys with TIME between the
//                                        events, which `hold` below now gives it -- but the field is
//                                        part of the published step shape (CONTROL_API.md) and is
//                                        still honoured, so a plan made by anything else still runs.
//   { t: 'key',  code: 'Enter', shift }  press one named key (down + up, by code): Enter Tab Backspace
//                                        ArrowLeft ArrowRight Escape; shift wraps it in ShiftLeft
//   { t: 'wait' }                        a thinking pause; sends nothing
// d     = milliseconds to wait BEFORE this step.
// hold  = milliseconds the key stays DOWN: the runner sends the press, then the release that long
//         after it, so the step is a press-and-release spread over real time instead of two events
//         in one batch. It is what a keyboard-dynamics check calls the dwell, it was ZERO for every
//         key this feature ever sent, and it is measured (see AT_HOLD). Absent on a 'wait'.
// src   = how many code points of the SOURCE text are committed once this step has run -- the
//         progress figure, monotone, ending at the text's length.
// clean = true on a step after which what the remote holds is exactly the source's first `src`
//         code points: no slip in flight, no caret away from the end. The runner replans from a clean
//         step when the operator changes the speed or the imitation mid-run.
//
// THE TEXT IS ITERATED BY CODE POINT, never by UTF-16 unit: an emoji is one 'ch' step whose text is
// the surrogate pair, and the Windows host turns that into two KEYEVENTF_UNICODE events in one batch
// (BuildKeyInput), which is how Windows expects a supplementary character to arrive. Splitting the
// pair over two steps with a pause between them would hand the app a lone surrogate.
//
// A NEWLINE IS A KEY, NOT A CHARACTER. The Windows host types unknown text with KEYEVENTF_UNICODE, and
// a U+000A sent that way is not Enter to almost any Windows program (Notepad ignores it; a terminal
// treats it as Ctrl+J). So '\n' becomes {t:'key', code:'Enter'} and '\t' becomes Tab, which BOTH hosts
// map by position. The Linux host would have typed the control characters correctly on its own
// (keysymOf maps them), and now never has to.

const AT_MAX_CHARS = 20000;

// Per-key means, in milliseconds. The robot rows are constant; the human rows are the centre of a
// distribution the profile below spreads out. `typo` is the per-character slip rate for the imitation
// before the persona and the clustering scale it.
//
// ONE SPEED MEANS ONE PACE, with "like a person" ticked or not -- the imitation changes the RHYTHM (the
// pauses, the bursts, the slips), never how fast the text goes in. The robot rows used to be their own
// scale (120 / 40 / 8 ms, "what an old application can follow"), so unticking the box made Slow 2.6x,
// Normal 4.5x and Fast 15x faster -- Fast at 1,500 words a minute -- and it was reported as exactly
// that: "if I don't tick like a person, the typing is strangely very fast". The robot rows are now the
// person's own average at the same setting, MEASURED rather than derived (the planner run over prose,
// 60 personas, median ms per character, word pauses and corrections counted in): 313 / 182 / 119 ms,
// about 38, 66 and 101 words a minute. Instant entry is what "Paste instead" is for.
const AT_SPEEDS = {
  slow:   { robot: 310, human: 205, typo: 0.010 },
  normal: { robot: 180, human: 112, typo: 0.018 },
  fast:   { robot: 120, human: 72,  typo: 0.026 },
};
const AT_MIN_DELAY = 4;   // browsers clamp nested timers here anyway; stated so the plan says what it will get

// =====================================================================
// WHAT A HAND ACTUALLY DOES, MEASURED
// =====================================================================
// Every number below this line came out of recorded human typing, and the ones above it did not. That
// is the whole point of the block: the imitation used to be a pile of plausible multipliers, each one
// chosen because it read well in a comment, and nobody had ever held the result against a person. Held
// against one, it was wrong in four ways that a keystroke-dynamics check reads in a single word --
// which is the one thing this feature claims to be good at.
//
// TWO SOURCES, both public, both of real people:
//
//   [DHAKAL]  Dhakal, Feit, Kristensson & Oulasvirta, "Observations on Typing from 136 Million
//             Keystrokes", CHI 2018 -- 136,857,600 keystrokes from 168,960 people typing prose.
//             Down-to-down interval: mean 238.656 ms, SD 111.6 ms, skewness 1.98, kurtosis 7.1,
//             floor about 60 ms; 51.56 words a minute on average.
//   [CMU]     Killourhy & Maxion's keystroke-dynamics benchmark -- 51 people x 400 repetitions of one
//             password, with the hold of every key and the flight between every pair. 204,000
//             digraphs. The figures quoted here were computed from that file for this release, not
//             taken from a paper: tools/typing-lab.html recomputes them, and from your own typing.
//
// WHAT WAS WRONG, in the order it matters:
//
//   1. THE KEYS WERE NEVER HELD DOWN. Every step sent its press and its release in one batch, so the
//      dwell -- half of what keystroke biometrics is -- was zero milliseconds on every key of every
//      run. A real hold is [CMU] 90.1 ms on average (SD 30.2, p10 55.7, p90 128.6, p99 181.8), and
//      log-normal about a median of 85.3 ms with sigma 0.336.
//   2. THE HOLD IS THE PERSON'S, AND IT DOES NOT MOVE WITH THE PACE. Across the 51, the correlation
//      between how long somebody holds a key and how fast they type is -0.111 -- that is, none. A
//      typist's mean hold varies from 46 to 143 ms (SD 19.0 between people, 22.5 within one), so the
//      hold belongs to the persona and must NOT be scaled by the speed setting. The obvious thing to
//      do -- multiply it by the pace like everything else -- would have been measurably wrong.
//   3. THE RHYTHM WAS FAR TOO WILD. Planned prose at Normal came out with a coefficient of variation
//      of 0.67, a skewness of 4.4 and a kurtosis of 43.6 (Slow: 0.68 / 7.2 / 170.2) against [DHAKAL]'s
//      0.467 / 1.98 / 7.1. Eight independent random multipliers per key, each reasonable on its own,
//      compound into a tail no hand has: the fix is tighter spreads and a CAP on what one key's wait
//      may be stretched to, which is what killed the kurtosis of 170.
//   4. KEYS WENT DOWN CLOSER TOGETHER THAN FINGERS CAN. The planner scheduled intervals of 11 ms
//      (Fast) and 19 ms (Normal); [DHAKAL]'s floor is about 60 ms and nothing in [CMU] is under 40.
//      So there is a floor now, and it is absolute as well as relative to the pace.
//
// AND ROLLOVER IS NOT A SPECIAL CASE ANY MORE. A fast hand presses the next key before it has let go
// of the last -- [CMU] 10.8% of all digraphs, and 0.4% / 9.2% / 27.2% for the 10th / 50th / 90th
// person, up to 35.2%. That used to be a hand-made exception (a 'ch2' step, two keys in ONE batch
// with no time between them at all, which is not what a hand does and is trivially detectable). Now
// it simply HAPPENS: a key is held for its own measured dwell, the next key goes down when the rhythm
// says, and whenever that is sooner the two overlap by exactly the difference. The rate falls out of
// the pace, which is also how it works in a person -- and tests/auto_type.js checks that what falls
// out lands inside the band measured above.
const AT_HOLD = {
  // The dwell. `ms` is the population mean, `sd` the spread BETWEEN people (the persona draws from
  // it once), `sigma` the log-normal spread of one person's own holds around their mean. `cap` is
  // under every auto-repeat delay there is (X11's is 250 ms at its shortest, and a key the X server
  // decides is held repeats it) -- a hold that outran it would type the character twice.
  ms: 90, sd: 19, lo: 46, hi: 143, sigma: 0.25, cap: 180, min: 30,
  // How far a key's release may fall BEHIND the next key's press, in ms. Overlaps are real but they
  // are shallow: of the 10.8% of [CMU] digraphs that overlap, the median is 21 ms deep, the 90th 55,
  // the 99th 109, and only the one deepest reaches 236. 110 ms is therefore the 99th percentile of
  // what a hand does, and a plan is trimmed to it (atPlan's last pass) rather than left to stack.
  lap: 110,
  // How long a key is held, relative to the typist's own mean, by what the key IS [CMU]. The outer
  // fingers hold longest (a: 1.177, l: 1.064) and the index fingers and the top row shortest
  // (5: 0.861, i: 0.904, t: 0.947) -- so this is by COLUMN, from the same table the rhythm uses, and
  // the digits are the measured 0.86 rather than the 1.4 the flight model gives them. A reach is slow
  // to ARRIVE at and quick to leave, which is not what a single multiplier per key would have said.
  col: [1.16, 1.06, 0.99, 0.95, 0.95, 0.99, 1.06, 1.12], digit: 0.86, space: 0.93, named: 1.00,
};
// The rhythm, calibrated so that planned prose keeps [DHAKAL]'s shape: the coefficient of variation,
// the skewness and the kurtosis of the down-to-down intervals, and the floor. Every entry is
// [base, spread] and means base + spread * random. Changing one of these changes a measured property
// of the output, which tests/auto_type.js asserts -- so the tuning cannot quietly rot back.
//
// HOW `jitter`, `burst` AND `cap` WERE PICKED: not by eye. A 300-point grid over the three was planned
// against prose at all three speeds and scored on the distance from [DHAKAL]'s cv / skewness /
// kurtosis; 0.20, [1.5, 0.3] and 5.0 came out at cv 0.471, skew 2.04, kurt 7.15 against 0.467, 1.98,
// 7.10. It is a PLATEAU and not a knife edge -- the ten closest points of the grid all sit inside
// cv 0.49, skew 2.1, kurt 7.6 -- which is the only reason to trust three numbers fitted to one
// corpus. Two things the search settled that guessing had got wrong, both of them about the TAIL:
// the cap wants to be 5.0 and not the 3.4 that looked sensible (3.4 cuts off the slow keys that give
// real typing its kurtosis of 7, leaving 3.2 -- a log-normal, which is too clean), and the regroup
// after a burst wants to be RARER AND BIGGER rather than gentler, because a sparse slow mode is what
// makes a distribution heavier-tailed than log-normal at the same spread. Which is what a hand is:
// mostly rolling, occasionally regrouping.
const AT_RHYTHM = {
  floorMs: 40, floorRel: 0.40,   // no two keys closer than 40 ms, nor than 40% of the pace
  cap: 5.0,                      // the most one key's wait may be stretched to (see 3 above)
  jitter: 0.20,                  // the log-normal sigma of one key's own wait
  tideLo: 0.84, tideHi: 1.20,    // the slow drift of confidence, bounded
  burst: [1.5, 0.3],             // the fingers regroup after a burst
  word: [1.20, 0.22],            // a word begins: the moment it took to bring to mind
  phrase: [1.16, 0.20],          // ...after a comma
  sentence: [1.45, 0.45],        // ...after a full stop
  line: [1.70, 0.50],            // a new line is read back before the next begins
  para: [2.30, 0.70],            // ...a blank line before it, more so
  pause: [420, 2000, 760],       // a real stop to think, in ms at the Normal pace: floor, then the
                                 // spread at a phrase or sentence boundary, and the smaller one
                                 // inside a line
};

// The keys around each key on a US keyboard, for a plausible slip of the finger. Same row and the
// rows above and below, no diagonals further than one key -- the slips people actually make. Letters
// and digits ONLY, on both sides: a slip that lands on a bracket or a quote is a slip an editor may
// answer by inserting the closing pair, which a Backspace then only half undoes. And a digit slips
// only onto a DIGIT: a field that takes nothing but digits (a PIN, a card number, a number box)
// would drop a letter on the floor, and the Backspace planned for it would then delete a digit
// that was right.
const AT_QWERTY_NEAR = {
  q: 'wa', w: 'qes', e: 'wrd', r: 'etf', t: 'ryg', y: 'tuh', u: 'yij', i: 'uok', o: 'ipl', p: 'o',
  a: 'qsz', s: 'awdx', d: 'sefc', f: 'drgv', g: 'fthb', h: 'gyjn', j: 'hukm', k: 'jil', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
  '1': '2', '2': '13', '3': '24', '4': '35', '5': '46', '6': '57', '7': '68', '8': '79', '9': '80', '0': '9',
};
// Which finger types which key on a US keyboard, as a column 0..7 (left pinky .. right pinky), and
// which hand. The rhythm of real typing is mostly this: two keys on alternate hands overlap and come
// fast, two keys under the same finger cannot, a key repeated bounces. Space is the thumb.
const AT_FINGER = (() => {
  const cols = ['qaz1`', 'wsx2', 'edc3', 'rfvtgb45', 'yhnujm67', 'ik,8', 'ol.9', 'p;/0-=[]\\\'' ];
  const m = {};
  cols.forEach((keys, col) => { for (const k of keys) m[k] = col; });
  return m;
})();
// The words a hand knows by heart. A person types "the" and "with" as one motion and slows for a
// word they have to spell; the hundred commonest English words are the first set, and a long or
// unfamiliar word (ten letters and up, one with digits in it, a name) is the second.
const AT_COMMON_WORDS = new Set(('the be to of and a in that have i it for not on with he as you do at this but his by from they we say ' +
  'her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take ' +
  'people into year your good some could them see other than then now look only come its over think also back after use two how our work first ' +
  'well way even new want because any these give day most us is are was were been has had did am').split(' '));
// Right-to-left scripts and the bidi controls. Caret keys move VISUALLY in some editors and LOGICALLY
// in others, and the field's own base direction is invisible from here, so no correction is planned
// for text that contains any of these: it is typed straight through.
const AT_RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u200F\u202B\u202E\u2067]/;

// Normalise what was typed into the box into what will be typed on the remote, and no more than that:
// one newline convention, tabs as spaces when asked, the indentation stripped when asked. Nothing is
// re-composed (NFC turns an angstrom sign into an A-ring and a compatibility ideograph into a
// different character -- the remote gets the code points that were entered). What cannot be typed
// is dropped and counted: a lone surrogate, which JSON would escape into six characters the host
// cannot mean, and every C0 control other than tab and newline (an ESC leaves an editor mode, a
// Ctrl+C interrupts a shell). The line separators U+0085 / U+2028 / U+2029 are typed as themselves.
//
// Returns { cps, dropped }: the code points to type, and how many were dropped.
function atNormalise(text, opts) {
  opts = opts || {};
  let s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (opts.stripIndent) s = s.replace(/^[ \t]+/gm, '');
  if (opts.tabAs === 'spaces') s = s.replace(/\t/g, '    ');
  const cps = [];
  let dropped = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0xD800 && c <= 0xDFFF) || (c < 0x20 && c !== 0x09 && c !== 0x0A) || c === 0x7F) { dropped++; continue; }
    cps.push(ch);
  }
  return { cps, dropped };
}

// Is this code point one the imitation may slip on, delete or step over -- an ASCII letter or digit?
// Narrower than "a letter" on purpose. A Backspace deletes one code point in a classic Edit control
// and one GRAPHEME in a browser, in Word and in the new Notepad, so the only character a planned
// Backspace may ever remove is one that is a single code point AND a single grapheme in every editor
// there is; and the only characters the arrow keys may ever step over are the same. ASCII letters and
// digits are exactly that set. Everything else is typed straight through, untouched.
function atIsWordChar(ch) { return /^[A-Za-z0-9]$/.test(ch); }

// The wrong key a finger lands on instead of `ch`, keeping its case; null when there is no neighbour
// we know, in which case no slip is planned for it.
function atNeighbour(ch, rand) {
  const lower = ch.toLowerCase();
  const near = AT_QWERTY_NEAR[lower];
  if (!near) return null;
  const pick = near[Math.floor(rand() * near.length)];
  return (ch !== lower) ? pick.toUpperCase() : pick;
}

// Log-normal jitter around 1: most keys land near the mean, a few take noticeably longer, none is
// absurd. Two uniforms through Box-Muller. Real inter-key intervals are right-skewed with a long
// tail; the sigma is the caller's, because a key inside a burst varies far less than a word does.
function atJitter(rand, sigma) {
  const u = Math.max(1e-9, rand()), v = rand();
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(4, Math.max(0.3, Math.exp((sigma || 0.42) * g)));
}

// What the keyboard itself imposes on the key `ch` typed right after `prev` -- the part of the rhythm
// that is the same for everyone: alternate hands roll fast, the same finger cannot type two keys at
// once, a shifted key costs a Shift, the top row is a reach, a repeated key bounces.
// WHICH OF THESE ARE MEASURED, said plainly, because the ones that are not read exactly like the ones
// that are. From [CMU], taking the clean digraphs of ".tie5Roanl" only:
//   same hand, different finger  n>l                     202.6 ms
//   alternate hands              t>i i>e o>a a>n, mean   159.0 ms   -> same/alternate = 1.274
//   a capital                    Shift.r>o               250.9 ms   -> about 1.58 over alternate
// so the two hand terms are now 1.12 and 0.88 (ratio 1.27, measured) instead of 1.08 and 0.8 (1.35,
// guessed), and a Shift costs 1.45 rather than 1.35. The SAME FINGER on two different keys, a key
// pressed twice, and punctuation have no clean pair in that password and are NOT measured -- they
// keep the values they had, and tools/typing-lab.html is what will settle them from prose.
// SPACE IS DELIBERATELY NOT IN THE FINGER TABLE. It is the fastest key there is, but the interval
// that follows it is the slowest thing in prose -- the word has to be brought to mind -- and that is
// already the `word` term below. Giving the thumb a fast digraph as well would be counting the same
// boundary twice, in opposite directions.
function atDigraph(prev, ch) {
  const a = AT_FINGER[prev.toLowerCase()], b = AT_FINGER[ch.toLowerCase()];
  let m = 1;
  if (a !== undefined && b !== undefined) {
    if (prev.toLowerCase() === ch.toLowerCase()) m *= 0.62;             // the same key, a bounce
    else if (a === b) m *= 1.45;                                          // the same finger has to travel
    else if ((a < 4) === (b < 4)) m *= 1.12;                              // the same hand
    else m *= 0.88;                                                       // alternate hands overlap
  }
  if (/[A-Z]/.test(ch)) m *= 1.45;                                        // a Shift on the way
  if (/[0-9]/.test(ch)) m *= 1.4;                                         // the top row is a reach
  else if (/[\p{P}\p{S}]/u.test(ch)) m *= 1.55;                           // punctuation: a look
  return m;
}

// How long THIS key stays down, in ms: the typist's own mean hold, moved by what the key is, with
// their own log-normal scatter on top -- and never scaled by the pace, because measurement says it
// is not (see AT_HOLD, point 2). `ch` is the character for a typed code point, or '' for a named key.
function atHoldMs(persona, ch, rand) {
  let f = AT_HOLD.named;
  if (ch) {
    const col = AT_FINGER[ch.toLowerCase()];
    if (ch === ' ') f = AT_HOLD.space;
    else if (/^[0-9]$/.test(ch)) f = AT_HOLD.digit;
    else if (col !== undefined) f = AT_HOLD.col[col];
  }
  const ms = persona.hold * f * atJitter(rand, persona.holdSigma);
  return Math.round(Math.max(AT_HOLD.min, Math.min(AT_HOLD.cap, ms)));
}

// ONE PERSON PER SESSION. Every typist has a rhythm of their own that stays put -- a pace, a habit of
// bursting, a tendency to slip and to notice late, a hand that overlaps keys or does not. Drawn once
// from the generator and handed to every plan, so consecutive runs read as the same person rather
// than as somebody new each time; a test hands in a seeded one.
// THE HOLD IS DRAWN HERE AND NOWHERE ELSE, from the spread measured BETWEEN the 51 typists (mean
// 90.1 ms, SD 19.0, seen as low as 46 and as high as 143) -- normally, because that is the shape it
// has. `overlap` is no longer a taste for a special kind of step; it is read back OFF the hold, as
// the position of this typist's dwell inside that range, because the person who holds keys longest is
// by construction the person whose next key most often goes down first. There is nothing left for it
// to decide on its own.
function atMakePersona(rand) {
  rand = rand || Math.random;
  const u = Math.max(1e-9, rand()), v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const hold = Math.max(AT_HOLD.lo, Math.min(AT_HOLD.hi, AT_HOLD.ms + z * AT_HOLD.sd));
  return {
    pace: 0.88 + rand() * 0.24,          // multiplies the base rate
    err: 0.7 + rand() * 0.7,             // multiplies the slip rate
    late: rand(),                        // how often a slip is only noticed later on
    burst: 4 + Math.floor(rand() * 5),   // keys in a burst before the fingers regroup (4..8)
    hesit: 0.6 + rand() * 0.9,           // how often the person simply stops to think
    care: 0.9 + rand() * 0.5,            // how much a correction slows the keys after it
    hold: hold,                          // ms a key stays down, this typist's own mean
    holdSigma: AT_HOLD.sigma,            // ...and their scatter around it
    overlap: (hold - AT_HOLD.lo) / (AT_HOLD.hi - AT_HOLD.lo),
  };
}

// The plan. `opts`: { speed, human, nudge, linePauseMs, enterAtEnd, stripIndent, tabAs, newline,
// escBeforeEnter, persona }. `rand` returns [0,1) and is injected so a test can seed it; production
// passes Math.random. `from` (code points) starts the plan part-way through the text: the runner
// replans a run that is already under way from its last clean step, and the src figures stay
// absolute.
//
// WHAT "LIKE A PERSON" IS MADE OF. A person does not type at a rate; they type in BURSTS of a few keys
// inside WORDS. Inside a burst the keys roll at the pace the fingers allow (atDigraph) and the pace
// barely varies; between bursts the fingers regroup; a word begun quickly stays quick (a tempo per
// word); a familiar word is one motion and a difficult one -- a name, a number, a long or odd
// spelling -- is spelt. Thinking happens at the START of a word or a phrase, not in the middle: a
// moment before each word, longer before a phrase after a comma, longer still before a sentence
// after a full stop, and now and then a real pause of half a second to three. A new line is read
// back before the next begins, a paragraph more so. The first keys of a run are the warm-up, and over
// a long text the rhythm drifts and loosens a little. Slips come in the kinds people make -- the
// neighbouring key, two letters swapped, a letter skipped, a letter doubled, the Shift held a beat
// too long, a space missed -- they come in clusters, and they are put right the way people put them
// right: at once, after a key or two, or only at the end of the word, with a burst of quick
// Backspaces, a beat, and a more careful retype -- after which the keys stay careful for a while.
// A fast hand presses the next key before it has quite let go of the last.
//
// EVERY CORRECTION FINISHES INSIDE THE WORD IT STARTED IN. Word, Outlook, Docs and Windows itself
// rewrite a misspelt word the moment the space after it arrives ("teh" becomes "the"), and a Backspace
// planned against the misspelling then deletes the correction instead. So a slip is always put right
// before the run of letters and digits it sits in ends -- never across a space, a punctuation mark,
// a tab or a newline -- and by the time any editor gets to look at a finished word, it is the right
// word. A missed space is the one slip that spans two words, and it is safe for the same reason: the
// space is typed only after the letters that ran on are backspaced away, so the first word ends,
// correctly, exactly once. The same rule keeps every Backspace and every arrow press inside ASCII
// letters and digits, which is what makes them mean the same thing in every editor (see atIsWordChar).
//
// THE CARET NEVER LEAVES THE LINE, AND NEVER MOVES AT ALL UNLESS ASKED. Rhythm and slips corrected
// with Backspace are what "like a person" means, and Backspace means "delete the character before
// the caret" in every text field there is. Putting a missed letter back with the arrow keys is a
// separate opt-in (`nudge`), because Left and Right are NOT caret keys everywhere: a spreadsheet cell
// in enter mode commits on an arrow, a shell with a completion menu open navigates it, a raw-mode
// terminal (a password prompt over ssh) takes the escape sequence as four characters of password.
// Even when asked, a nudge is refused whenever the run looks like it is aimed at a terminal (Enter at
// the end, or a pause after each line). No slip and no nudge at all in text with a right-to-left
// script in it (see AT_RTL).
function atPlan(text, opts, rand, from) {
  opts = opts || {}; rand = rand || Math.random;
  const cps = atNormalise(text, opts).cps;
  if (cps.length > AT_MAX_CHARS) cps.length = AT_MAX_CHARS;
  const sp = AT_SPEEDS[opts.speed] || AT_SPEEDS.normal;
  const human = !!opts.human;
  const linePause = Math.max(0, Math.min(60000, Number(opts.linePauseMs) || 0));
  const rtl = AT_RTL.test(cps.join(''));
  const slips = human && !rtl;
  const nudges = slips && !!opts.nudge && !opts.enterAtEnd && !linePause;
  const persona = opts.persona || atMakePersona(rand);
  const base = human ? sp.human * persona.pace : sp.robot;
  const enterShift = opts.newline === 'shiftEnter';
  const escFirst = !!opts.escBeforeEnter;
  const steps = [];
  const N = cps.length;
  const start = Math.max(0, Math.min(N, Number(from) || 0));

  // A newline as the key(s) that make one: an Escape first where asked (an IDE with a suggestion
  // open would otherwise accept it on Enter), Shift+Enter where the target is a chat composer whose
  // plain Enter sends the message.
  // THE HOLD IS THE IMITATION'S, not the robot's. An exact run is meant to read as a machine and
  // always has: it presses and releases in one batch, which is what every caller of it has been
  // tested against. `like a person` is where a hand is being imitated, so that is where the dwell is.
  const holdOf = (ch) => (human ? atHoldMs(persona, ch, rand) : 0);
  const enterKey = (d, src) => {
    if (escFirst) { const e = { t: 'key', code: 'Escape', d, src }; if (human) e.hold = holdOf(''); steps.push(e); }
    const s = { t: 'key', code: 'Enter', shift: enterShift, d: escFirst ? Math.max(AT_MIN_DELAY, Math.round(d / 2)) : d, src, clean: true };
    if (human) s.hold = holdOf('');
    steps.push(s);
  };

  // ---- the robot: one constant interval, nothing else ---------------------------------------------
  if (!human) {
    for (let i = start; i < N; i++) {
      const ch = cps[i];
      const prev = i ? cps[i - 1] : '';
      const d = Math.max(AT_MIN_DELAY, base + (prev === '\n' ? linePause : 0));
      if (ch === '\n') enterKey(d, i + 1);
      else if (ch === '\t') steps.push({ t: 'key', code: 'Tab', d, src: i + 1, clean: true });
      else steps.push({ t: 'ch', ch, d, src: i + 1, clean: true });
    }
    if (opts.enterAtEnd) enterKey(Math.max(AT_MIN_DELAY, base + linePause), N);
    return { steps, total: N };
  }

  // ---- the person -----------------------------------------------------------------------------------
  // The layers of one key's wait, multiplied together: the base and the persona's pace; the warm-up
  // (the first keys of a run are slower); the tide (a slow drift of confidence, bounded); the word's
  // own tempo (a word begun quickly stays quick); the burst (a few keys roll, then the fingers
  // regroup); what the keyboard imposes (atDigraph); the word's familiarity; the caution that follows
  // a correction; and the hand's own jitter, small inside a burst.
  let tide = 0.95 + rand() * 0.1;
  let wordTempo = 1;
  let burstLeft = persona.burst + Math.floor(rand() * 3);
  let caution = 0;                          // keys of care left after a correction
  let cluster = 0;                          // keys of raised slip rate left after a slip
  let sinceNudge = 0;                       // code points since the last caret excursion
  let keysTyped = 0;                        // for the warm-up and the drift
  const scale = base / 112;                 // pauses stated in ms for 'normal' scale with the speed
  // A FLOOR AND A CEILING ON ONE KEY'S WAIT, which is what the old stack was missing and what made
  // its shape wrong (see AT_HOLD, points 3 and 4). The floor is absolute as well as relative: no two
  // keys closer than 40 ms whatever the pace, because no hand does that. The ceiling is on the
  // MULTIPLIER rather than the result, so a word start that lands on a slow tide inside a regroup
  // after a correction is still a slow key and not eight times a slow key -- the compounding of
  // eight independent draws is exactly what gave planned prose a kurtosis of 170 against a human 7.1.
  const floor = Math.max(AT_MIN_DELAY, AT_RHYTHM.floorMs, Math.round(AT_RHYTHM.floorRel * base));
  const jitterSigma = () => AT_RHYTHM.jitter * (1 + 0.15 * Math.min(1, keysTyped / 1500));   // a long session loosens
  const delay = (mult) => {
    tide = Math.min(AT_RHYTHM.tideHi, Math.max(AT_RHYTHM.tideLo, tide + (rand() - 0.5) * 0.05));
    const warm = keysTyped < 25 ? 1.2 - 0.2 * (keysTyped / 25) : 1;
    const care = caution > 0 ? 1 + 0.25 * persona.care * (caution / 8) : 1;
    let burst = 1;
    if (--burstLeft <= 0) { burst = AT_RHYTHM.burst[0] + rand() * AT_RHYTHM.burst[1]; burstLeft = persona.burst + Math.floor(rand() * 5) - 2; }
    if (caution > 0) caution--;
    keysTyped++;
    const m = Math.min(AT_RHYTHM.cap, warm * tide * wordTempo * burst * mult * care * atJitter(rand, jitterSigma()));
    return Math.max(floor, Math.round(base * m));
  };
  const push = (t, payload, mult, src, clean) => {
    const s = Object.assign({ t, d: delay(mult), src }, payload);
    s.hold = holdOf(t === 'ch' ? s.ch : '');
    if (clean) s.clean = true;
    steps.push(s);
  };
  const wait = (ms, src) => { steps.push({ t: 'wait', d: Math.max(AT_MIN_DELAY, Math.round(ms)), src }); };
  const typeCp = (ch, mult, src, clean) => {
    if (ch === '\n') enterKey(delay(mult * 1.4), src);
    else if (ch === '\t') push('key', { code: 'Tab' }, mult, src, clean);
    else push('ch', { ch }, mult, src, clean);
  };
  // The run of ASCII letters/digits starting at i, as [start, end) -- the span a correction may use.
  const wordEnd = (i) => { let j = i; while (j < N && atIsWordChar(cps[j])) j++; return j; };
  const isSentenceEnd = (c) => c === '.' || c === '!' || c === '?';
  const isPhraseEnd = (c) => c === ',' || c === ';' || c === ':';

  // Per code point, the word it sits in: a familiar word rolls, a difficult one is spelt -- long,
  // with digits, a name (a capital that is not the start of a sentence), or oddly cased.
  const wordMult = new Array(N).fill(1);
  for (let a = 0; a < N;) {
    if (!atIsWordChar(cps[a])) { a++; continue; }
    const b = wordEnd(a), w = cps.slice(a, b).join('');
    let m = 1;
    if (AT_COMMON_WORDS.has(w.toLowerCase())) m = 0.82;
    else {
      if (w.length >= 10) m *= 1.15;
      if (/[0-9]/.test(w)) m *= 1.2;
      const before = a >= 2 ? cps[a - 2] : (a === 0 ? '.' : cps[a - 1]);
      if (/^[A-Z][a-z]/.test(w) && !isSentenceEnd(before) && a > 0 && cps[a - 1] !== '\n') m *= 1.15;   // a name
      if (/[a-z][A-Z]/.test(w)) m *= 1.2;                                                              // camelCase, an odd spelling
    }
    for (let k = a; k < b; k++) wordMult[k] = m;
    a = b;
  }
  // What the key at i costs, given what came before it: the keyboard (atDigraph), the word, and --
  // at a word start -- the reading.
  const costOf = (i) => {
    const ch = cps[i], prev = i ? cps[i - 1] : '';
    let m = (prev ? atDigraph(prev, ch) : 1) * wordMult[i];
    const span = (k) => k[0] + rand() * k[1];
    if (prev === ' ' || prev === '\t') {
      // A word begins: the moment it took to bring it to mind. A phrase (after a comma) and a
      // sentence (after a full stop) take longer, in that order.
      m *= span(AT_RHYTHM.word);
      const before = i >= 2 ? cps[i - 2] : '';
      if (isSentenceEnd(before)) m *= span(AT_RHYTHM.sentence);
      else if (isPhraseEnd(before)) m *= span(AT_RHYTHM.phrase);
    }
    if (prev === '\n') {
      // A new line: what was just written is read back first; a blank line before it means a new
      // paragraph and a longer look.
      const blank = i >= 2 && cps[i - 2] === '\n';
      m *= span(blank ? AT_RHYTHM.para : AT_RHYTHM.line);
    }
    if (ch === '\n') m *= 1.3;
    return m;
  };
  // The keys inside a slip: the wrong key at the pace of the right one, the retype careful for its
  // first keys, the Backspaces as a burst -- the first deliberate, the rest quick like a held key --
  // then a beat before the retype, and a spell of care afterwards.
  const backspaces = (n, src) => { for (let k = 0; k < n; k++) push('key', { code: 'Backspace' }, k ? 0.35 : 0.8, src); wait(base * (0.5 + rand() * 0.7), src); };
  const retype = (fromIdx, toIdx) => {
    for (let j = fromIdx; j < toIdx; j++) typeCp(cps[j], (j - fromIdx === 0 ? 1.3 : j - fromIdx === 1 ? 1.15 : 1) * (j > fromIdx ? atDigraph(cps[j - 1], cps[j]) : 1) * wordMult[j], j + 1, j === toIdx - 1);
    caution = 8; cluster = 12;
  };
  const noticeWait = (src) => wait(base * (0.8 + rand() * 1.2) * atJitter(rand, 0.3), src);

  let i = start;
  while (i < N) {
    const ch = cps[i];
    sinceNudge++;
    const atWordStart = atIsWordChar(ch) && (i === 0 || !atIsWordChar(cps[i - 1]));
    if (atWordStart) { wordTempo = atJitter(rand, 0.18); burstLeft = Math.max(burstLeft, 2); }

    // Thinking: a real pause of half a second to three, mostly between phrases and sentences, now
    // and then before a word, hardly ever in the middle of one.
    if (i > start) {
      const prev = cps[i - 1], before = i >= 2 ? cps[i - 2] : '';
      const boundary = atWordStart && (prev === ' ' || prev === '\n') && (isSentenceEnd(before) || isPhraseEnd(before) || prev === '\n');
      const p = boundary ? 0.12 * persona.hesit : atWordStart ? 0.02 * persona.hesit : (atIsWordChar(ch) ? 0.003 : 0);
      if (rand() < p) wait((AT_RHYTHM.pause[0] + rand() * AT_RHYTHM.pause[boundary ? 1 : 2]) * scale, i);
    }

    // ---- the missed letter, put back with the arrows (opt-in, see above) -------------------------
    // Only at the start of a word of five or more letters/digits, never more than once in forty
    // characters, or it stops reading as a person.
    if (nudges && i >= 2 && sinceNudge >= 40 && atWordStart) {
      const end = wordEnd(i);
      const len = end - i;
      if (len >= 5 && rand() < sp.typo * persona.err * 0.8) {
        sinceNudge = 0;
        const lo = Math.max(i + 1, end - 1 - 10);
        const miss = lo + Math.floor(rand() * (end - 1 - lo));
        let back = 0;
        for (let j = i; j < end; j++) { if (j === miss) continue; typeCp(cps[j], costOf(j), j < miss ? j + 1 : miss); if (j > miss) back++; }
        noticeWait(miss);
        for (let k = 0; k < back; k++) push('key', { code: 'ArrowLeft' }, k ? 0.4 : 0.8, miss);
        typeCp(cps[miss], 1.3, miss + 1);
        for (let k = 0; k < back; k++) push('key', { code: 'ArrowRight' }, k ? 0.35 : 0.7, end, k === back - 1);
        caution = 8; cluster = 12;
        i = end;
        continue;
      }
    }

    // ---- a missed space: the next word runs on, then is taken back and spaced --------------------
    if (slips && ch === ' ' && i >= 2 && i + 2 < N && atIsWordChar(cps[i - 1]) && atIsWordChar(cps[i + 1]) && rand() < sp.typo * persona.err * 0.4) {
      const end = wordEnd(i + 1);
      const ran = Math.min(end - (i + 1), 1 + Math.floor(rand() * 3));
      for (let k = 0; k < ran; k++) push('ch', { ch: cps[i + 1 + k] }, (k ? atDigraph(cps[i + k], cps[i + 1 + k]) : 1) * wordMult[i + 1 + k], i);
      noticeWait(i);
      backspaces(ran, i);
      push('ch', { ch: ' ' }, 1.2, i + 1, true);
      retype(i + 1, i + 1 + ran);
      cluster = 12;
      i += 1 + ran;
      continue;
    }

    // ---- slips of the finger, corrected the way people correct them -------------------------------
    // Only where the character BEFORE the slip is plain printable ASCII: a few scripts have prepend
    // marks (a Kaithi number sign, a Malayalam dot reph) that a grapheme editor glues to whatever
    // follows them, so a Backspace over a slip typed right after one would take the mark with it.
    // Slips cluster: for a dozen keys after one, the next is twice as likely.
    const slipRate = sp.typo * persona.err * (cluster > 0 ? 2 : 1);
    if (cluster > 0) cluster--;
    if (slips && i >= 2 && atIsWordChar(ch) && /^[\x20-\x7E]$/.test(cps[i - 1]) && rand() < slipRate) {
      const end = wordEnd(i);
      const left = end - i - 1;                       // letters of this word still to come after ch
      const kind = rand();
      // How late the eye catches it: at once, after a key or two, or only at the end of the word --
      // the persona leans one way or the other.
      const lateness = rand() * (0.7 + 0.6 * persona.late);
      const late = lateness < 0.5 ? 0 : lateness < 0.85 ? Math.min(left, 1 + Math.floor(rand() * 2)) : Math.min(left, 8);
      if (kind < 0.42) {
        // The neighbouring key.
        const wrong = atNeighbour(ch, rand);
        if (wrong) {
          push('ch', { ch: wrong }, costOf(i), i);
          for (let k = 0; k < late; k++) push('ch', { ch: cps[i + 1 + k] }, atDigraph(cps[i + k], cps[i + 1 + k]) * wordMult[i + 1 + k], i);
          noticeWait(i);
          backspaces(1 + late, i);
          retype(i, i + 1 + late);
          i += 1 + late;
          continue;
        }
      } else if (kind < 0.58 && left >= 1) {
        // Two keys swapped: "teh".
        push('ch', { ch: cps[i + 1] }, costOf(i), i);
        push('ch', { ch }, 0.75, i);
        const more = Math.min(late, left - 1);
        for (let k = 0; k < more; k++) push('ch', { ch: cps[i + 2 + k] }, atDigraph(cps[i + 1 + k], cps[i + 2 + k]) * wordMult[i + 2 + k], i);
        noticeWait(i);
        backspaces(2 + more, i);
        retype(i, i + 2 + more);
        i += 2 + more;
        continue;
      } else if (kind < 0.74 && left >= 2 && !atWordStart) {
        // A letter skipped: the word goes on without it for a key or three, then the tail comes off
        // and goes back on with the letter in its place.
        const skipTo = Math.min(left, 1 + Math.floor(rand() * 3));
        for (let k = 0; k < skipTo; k++) push('ch', { ch: cps[i + 1 + k] }, (k ? atDigraph(cps[i + k], cps[i + 1 + k]) : costOf(i)) * wordMult[i + 1 + k], i);
        noticeWait(i);
        backspaces(skipTo, i);
        retype(i, i + 1 + skipTo);
        i += 1 + skipTo;
        continue;
      } else if (kind < 0.84 && /[A-Z]/.test(ch) && left >= 1 && /[a-z]/.test(cps[i + 1])) {
        // The Shift held a beat too long: "THe".
        push('ch', { ch }, costOf(i), i + 1, true);
        push('ch', { ch: cps[i + 1].toUpperCase() }, atDigraph(ch, cps[i + 1]), i + 1);
        noticeWait(i + 1);
        backspaces(1, i + 1);
        retype(i + 1, i + 2);
        i += 2;
        continue;
      } else {
        // A key that bounced.
        push('ch', { ch }, costOf(i), i + 1, true);
        push('ch', { ch }, 0.55, i + 1);
        noticeWait(i + 1);
        backspaces(1, i + 1);
        steps[steps.length - 1].clean = true;
        caution = 6; cluster = 12;
        i += 1;
        continue;
      }
    }

    // ---- the ordinary key ------------------------------------------------------------------------
    // AND THE OVERLAP WITH THE NEXT ONE IS NOT DECIDED HERE ANY MORE. There used to be a branch at
    // this point that took two plain letters of one word and emitted them as a single step with a
    // `ch2` -- down a, down b, up a, up b, four events in one batch with no time between them. It was
    // reaching for the right thing: [CMU] says 10.8% of all digraphs really do overlap. But a hand
    // overlaps them by tens of milliseconds, not by nothing, and four simultaneous events are a
    // signature of their own.
    //
    // Now every key is simply held for its own measured dwell and the next one goes down when the
    // rhythm says, so the two overlap by exactly the difference whenever the difference is negative
    // -- which is both what a hand does and, usefully, self-scaling: the faster the pace the more
    // often it happens, the same way it does in a person. Nothing has to decide it.
    typeCp(ch, costOf(i), i + 1, true);
    if (ch === '\n' && linePause) wait(linePause, i + 1);
    i++;
  }
  if (opts.enterAtEnd) enterKey(delay(1.4), N);
  // THE OVERLAP IS TRIMMED, NOT LEFT TO STACK. Each key is held for its own dwell and the next goes
  // down when the rhythm says, so the two overlap by the difference -- which is how a hand does it,
  // except that a hand's overlap is SHALLOW (AT_HOLD.lap). A long hold in front of a fast pair would
  // otherwise leave a key down past the press after the next one, which no finger does. One pass over
  // the finished plan, because the gap to the next press is only known once the plan is whole.
  //
  // AND THE SAME KEY NEVER OVERLAPS ITSELF. A double letter ("correction") and a run of Backspaces
  // press one key twice, and a finger doing that has to let go in between -- two downs of one key
  // with no up between them is not an overlap, it is a state no keyboard can be in and no host can
  // make sense of (the Windows host keeps one scan record per key code, so the first up would erase
  // what the second needs). Found by tests/auto_type.js's cancel-between-steps check going red on a
  // held "rr", which is exactly the sort of thing the imitation cannot be allowed to invent.
  // The hold that results can be short, shorter than AT_HOLD.min even -- which is right: a bounced
  // double letter is the quickest thing a hand does.
  const keyOf = (s) => (s.t === 'key' ? 'k:' + s.code : 'c:' + s.ch + (s.ch2 || ''));
  for (let k = 0, gap = 0, prev = -1; k < steps.length; k++) {
    gap += steps[k].d;
    if (steps[k].t === 'wait') continue;
    if (prev >= 0 && steps[prev].hold !== undefined) {
      const room = keyOf(steps[prev]) === keyOf(steps[k]) ? gap - 1 : gap + AT_HOLD.lap;
      if (steps[prev].hold > room) steps[prev].hold = Math.max(1, room);
    }
    prev = k; gap = 0;
  }
  return { steps, total: N };
}

// The time a plan will take, in ms -- exact, because the plan is the whole schedule.
function atPlanMs(plan, from) {
  let ms = 0;
  for (let i = from || 0; i < plan.steps.length; i++) ms += plan.steps[i].d;
  return ms;
}

// The wire messages for one step, in order. A character goes as text on an empty code (the hosts'
// Unicode path); a named key goes by code, wrapped in ShiftLeft when the step says so. Every list is
// a complete down/up sequence, so a plan interrupted BETWEEN steps never leaves a key held.
// With no third argument this is the published name (CONTROL_API.md) and means what it always meant:
// the whole press-and-release for one step, in order. `pressOnly` asks for the press alone, which is
// what a run sends when the step has a dwell to wait out before the release (atHoldKey).
function atStepMessages(step, oldWin, pressOnly) {
  const p = atStepParts(step, oldWin);
  return pressOnly ? p.down : p.down.concat(p.up);
}
// ...and the release on its own, for when the dwell is up.
function atStepRelease(step, oldWin) {
  return atStepParts(step, oldWin).up;
}
// The same messages, split where the key is DOWN: { down, up }. The runner sends `down`, waits the
// step's `hold`, then sends `up` -- which is the one thing a press-and-release in a single batch
// cannot express (see AT_HOLD). Every branch below was already its down half followed by its up half,
// so the two halves concatenated are exactly what this function has always returned, and a caller
// that wants the whole press still gets it from atStepMessages above.
//
// A SHIFT GOES DOWN WITH THE KEY AND COMES UP WITH IT, so a hold straddles the chord rather than
// splitting it: ShiftLeft down, key down ... key up, ShiftLeft up. A chord half-sent is a key with
// the wrong case, which is the one thing worse here than a key arriving late.
//
// ...AND A CHORD IS NEVER HELD, which the `chord` flag says. Two shifted steps in a row -- two
// capitals, or Shift+Enter on a blank line -- would both want ShiftLeft, and holding the first past
// the second's press means pressing ShiftLeft twice with no release between them. A run sends a chord
// whole, as it always did. The flag belongs here rather than in the plan because the plan cannot
// know: the two quote and backslash cases below become chords only on a Windows host older than
// 1.16.2, which is a fact about the machine, not about the text.
function atStepParts(step, oldWin) {
  const none = { down: [], up: [] };
  if (!step || step.t === 'wait') return none;
  const press = (code, text) => {
    const d = { type: 'key', action: 'down', code }, u = { type: 'key', action: 'up', code };
    if (text !== undefined) { d.text = text; u.text = text; }
    return { down: [d], up: [u] };
  };
  const shifted = (p) => ({ down: [{ type: 'key', action: 'down', code: 'ShiftLeft' }].concat(p.down),
                            up: p.up.concat([{ type: 'key', action: 'up', code: 'ShiftLeft' }]), chord: true });
  if (step.t === 'key') {
    const k = press(step.code);
    return step.shift ? shifted(k) : k;
  }
  if (oldWin && step.ch === '"') return shifted(press('Quote', '"'));
  if (oldWin && step.ch === '\\') return press('Backslash', '\\');
  // Two keys overlapped inside ONE step. The planner no longer makes these -- a real overlap is the
  // next key's own step landing inside this key's hold -- but the step shape is published, so a plan
  // from anywhere else still runs, and it still runs the way it always did.
  if (step.ch2) return { down: [{ type: 'key', action: 'down', code: '', text: step.ch }, { type: 'key', action: 'down', code: '', text: step.ch2 }],
                         up: [{ type: 'key', action: 'up', code: '', text: step.ch }, { type: 'key', action: 'up', code: '', text: step.ch2 }] };
  return press('', step.ch);
}


// ---- END copy -------------------------------------------------------------------------------------------------

// PLAYING A PLAN, on its own timing: each step's delay, then its key DOWN; its release comes after the step's
// `hold` while the next step's delay already runs -- keys roll over as a hand's do, and a run's length is the sum
// of the delays, as the plan says. A key is never pressed twice without a release between (the same character
// again releases the first), and a chord (a Shift with its key) goes whole. `stop()` is asked before every step;
// a stopped run releases what it holds. send(message) puts one {type:'key',...} on the wire.
async function run(plan, send, opts) {
  const o = opts || {};
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const stop = typeof o.stop === 'function' ? o.stop : () => false;
  const held = new Map();   // key identity -> { up, timer, done }
  const idOf = (m) => (m.code || '') + '|' + (m.text == null ? '' : m.text);
  const release = (id) => { const h = held.get(id); if (!h) return; held.delete(id); clearTimeout(h.timer); for (const m of h.up) send(m); h.done(); };
  const steps = (plan && Array.isArray(plan.steps)) ? plan.steps : [];
  let i = 0;
  try {
    for (; i < steps.length; i++) {
      if (stop()) return { ok: false, stopped: true, at: i, of: steps.length };
      const s = steps[i];
      if (s.d > 0) await sleep(s.d);
      if (s.t === 'wait') continue;
      const p = atStepParts(s, false);
      if (!p.down.length) continue;
      const id = idOf(p.down[p.down.length - 1]);
      if (held.has(id)) release(id);
      if (p.chord || !(s.hold > 0)) { for (const m of p.down.concat(p.up)) send(m); continue; }
      for (const m of p.down) send(m);
      await new Promise((resolve) => { held.set(id, { up: p.up, done: () => {}, timer: setTimeout(() => release(id), s.hold) }); resolve(); });
    }
    return { ok: true, steps: steps.length, ms: atPlanMs(plan) };
  } finally {
    for (const id of [...held.keys()]) release(id);   // nothing is left held, however the run ended
  }
}

// `--sync`: copy the planner region from tools/viewer.html again (after the viewer changed it).
if (require.main === module && process.argv[2] === '--sync') {
  const fs = require('fs'), path = require('path');
  const me = __filename, src = fs.readFileSync(me, 'utf8');
  const viewer = fs.readFileSync(process.argv[3] || path.join(__dirname, '..', '..', 'viewer.html'), 'utf8');
  const a = viewer.indexOf("// Auto-type: the planner"), b = viewer.indexOf("// =====================================================================\n// Auto-type: the runner and the floating window", a);
  const B = src.indexOf('// ---- BEGIN copy'), E = src.indexOf('// ---- END copy');
  if (a < 0 || b < 0 || B < 0 || E < 0) { console.error('could not find the planner or the marks'); process.exit(1); }
  const begin = src.indexOf('\n', B) + 1;
  fs.writeFileSync(me, src.slice(0, begin) + viewer.slice(a, b) + src.slice(E));
  console.log('copied the planner again from the viewer');
}

module.exports = { atPlan, atPlanMs, atStepParts, atStepMessages, atNormalise, AT_SPEEDS, AT_MAX_CHARS, run };

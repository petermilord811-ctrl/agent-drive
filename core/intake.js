'use strict';
// @tool read a job asked for in plain words ("connect 10004 and do my sticky notes") into the machine, the skill, the access to ask for, and the command that starts the visit
// @run  node kit.js intake "connect 10004 and do my sticky notes" [--json] [--sh|--powershell]   (a library too: const intake = require('./intake.js'))
// core/intake.js -- A JOB ASKED FOR IN PLAIN WORDS.
//
// People ask in chat: "connect 10004 and do my sticky notes", "on machine 10002 solve the sudoku", "can you fill in
// the survey on #10003". Turning that into a visit took an agent four steps, and each was a place to guess wrong:
// the machine (a wrong number puts an Allow card in front of a stranger), the skill (`node kit.js skills <word>`;
// a wrong one sends the driver down the wrong recipe), what to ask for at the door (more than the job needs puts
// powers on the card nobody wanted), and the command line (a task with a quote or a $ in it breaks it, or worse).
// So, here, with each rule kept:
//
//   * THE MACHINE is a five-digit number, written plainly or as "machine 10004", "#10004", "host 10004",
//     "pc 10004", "on 10004". A number is NOT a machine when it is a time, money (a "$" or "dollars" by it), part
//     of a longer number (10:30:00, 12.000, 555-12345, 12345-6789), a phone number, a sum (12345 * 6), a count or a
//     measure (16384 tile, 10000 points), text to type or find, a code or an id ("the code is 48213"), inside a web or
//     mail address, a path, or quotes. One marked as the machine wins over a bare one (the bare one is part of the
//     job: "play 2048 on 10005 until 16384"); two machines are never a guess -- host null, and `why` names them.
//   * THE SKILL is scored from each skill's own name (x3), tags (x2) and `when` (x1), rarer words counting more,
//     with light stemming (notes/note, solving/solve) and a short synonym list (SYNONYMS below) that only adds
//     words those skills already use -- so it cannot invent a skill: one has to be in skills/ to be named. A skill
//     is picked only when the job names the THING (2048, sudoku, survey, sticky notes), never on general words
//     alone ("play a game", "solve the puzzle", "run the tests"); below the threshold, or tied at the top, there is
//     no skill and the driver works it out; a close second goes in `others`.
//   * THE ACCESS is the least the words justify: acting on the screen (type, click, fill, solve, play, open...)
//     -> control; running commands (install, run a command, powershell, a script) -> shell; the Terminal panel
//     ("in the terminal") -> terminal, and the commands meant for it then go there, not to a shell grant; reading
//     and looking -> nothing. Asking too little costs one more Allow card (`access` mid-visit); asking too much
//     puts a power on the card the person never meant to give. `why` names the word behind each ask.
//   * THE TASK is the person's own words, minus the connect part and the politeness ("please", "can you"):
//     what the Allow card and the agent's hello ("I'm here to <task>") show. One line, and never starting with
//     "--" (the client's flag reader would take it for a flag).
//   * THE COMMAND quotes the task for the shell it will be pasted into. A plain task goes in double quotes, as
//     the docs write it. Anything else: sh gets single quotes ('\'' for an apostrophe); PowerShell gets single
//     quotes with every quote mark doubled (it treats ‘ ’ as quotes too), and its double quotes become “ ” --
//     Windows PowerShell 5.1 strips or splits an embedded " when it hands an argument to node while 7.3+ escapes
//     it, so no spelling of " survives both; the typographic ones arrive as written in both.
//
// Pure and offline but for skills(), which reads skills/*/README.md; never throws. Proven in tests/intake.js.
const fs = require('fs'), path = require('path');

// ---- the skills library -----------------------------------------------------------------------------------
// The same catalog `node kit.js skills` lists (kit.js calls this): skills/<slug>/README.md, its frontmatter's
// name / when / tags / run. A README without frontmatter still lists: its first heading is the name and its first
// prose line the "when". skills/_template is the mould for `node kit.js new`, and a folder without a README is not
// a skill. SM_SKILLS_DIR (or its old name SM_SITUATIONS_DIR) points it at another library, as it does kit.js.
const SKILLS_DIR = () => process.env.SM_SKILLS_DIR || process.env.SM_SITUATIONS_DIR || path.join(__dirname, '..', 'skills');
const FRONT = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/;

// a leading `--- ... ---` block -> {key: value}: line-based `key: value`, no YAML (no skill needs nested data)
function frontmatter(text) {
  const m = FRONT.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim();
  }
  return out;
}
function firstHeading(text) { const m = /^#\s+(.+)$/m.exec(text); return m ? m[1].trim() : ''; }
function firstProse(text) {
  for (const raw of text.replace(FRONT, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('|') || line.startsWith('-')) continue;
    return line.replace(/[*_`]/g, '').slice(0, 160);
  }
  return '';
}

// skills(dir?) -> [{slug, name, when, tags: [], run}], sorted by slug; a folder that cannot be read is an empty library
function skills(dir) {
  const root = typeof dir === 'string' && dir ? dir : SKILLS_DIR();
  let slugs = [];
  try { slugs = fs.readdirSync(root).sort(); } catch (_) { return []; }
  const out = [];
  for (const slug of slugs) {
    if (slug.startsWith('_')) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, slug, 'README.md'), 'utf8'); } catch (_) { continue; }
    const fm = frontmatter(text) || {};
    out.push({ slug, name: fm.name || firstHeading(text) || slug, when: fm.when || firstProse(text) || '',
               tags: (fm.tags || '').split(/[,\s]+/).filter(Boolean), run: fm.run || '' });
  }
  return out;
}

// ---- the text ---------------------------------------------------------------------------------------------
const MAX_TEXT = 4000;   // a chat request; anything longer is cut here, so no pattern below ever sees a novel
const oneLine = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const lower = (t) => t.toLowerCase().replace(/[’‘`´]/g, "'");

// Where a five-digit number is no machine whatever surrounds it -- and, for the skill and the access, what is not
// the job's own words: quoted text ("type 'install vlc' in the chat" asks for no shell), a web or mail address, a path.
function protectedSpans(t) {
  const spans = [];
  // in this order, and a span overlapping an earlier one is that one ("https://example.com/a" is no path)
  const add = (re, kind, keep, lead) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const s = m.index + (lead ? m[1].length : 0);
      const e = m.index + m[0].length;
      if (e > s && (!keep || keep(t.slice(s, e))) && !spans.some((x) => s < x.e && e > x.s)) spans.push({ s, e, kind });
      if (!m[0].length) re.lastIndex++;
    }
  };
  add(/"[^"]*"|“[^”“]*”|„[^“”]*[“”]|«[^»]*»|`[^`]*`/g, 'quoted');
  add(/(^|[\s(\[{:,;])(?:'[^'\n]*'|‘[^’\n]*’)(?=$|[\s)\]}.,;:!?])/g, 'quoted', null, true);
  add(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`]+/gi, 'url');
  add(/[^\s@<>"'`(),;:]+@[^\s@<>"'`(),;:]+\.[a-z]{2,}/gi, 'email');
  // a path: C:\data\x, /home/x, ~/x, ./x, data\x -- not "and/or" or "10004/10005", and not example.com/docs (an address)
  add(/(?<![\w.-])(?:[a-z]:|~|\.{1,2})?(?:[\\\/][^\s\\\/<>"'`|]+)+[\\\/]?|\b[\w.-]+(?:\\[^\s\\<>"'`|]+)+\\?/gi, 'path', (x) => /[a-z]/i.test(x));
  // a domain: its labels before the top level must hold a letter, so "10004.Then" (a missing space) is no address
  add(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b(?::\d+)?(?:[\/?#][^\s<>"'`]*)?/gi, 'url',
      (x) => /[a-z]/i.test(x.replace(/[:\/?#].*$/, '').split('.').slice(0, -1).join('.')));
  return spans;
}
const SPAN_WHY = { quoted: 'in quotes', url: 'in a web address', email: 'in a mail address', path: 'in a path' };
// the same text with those spans blanked: what the skill and the access are read from
function blank(t, spans, kinds) {
  const a = t.split('');
  for (const sp of spans) if (!kinds || kinds.includes(sp.kind)) for (let i = sp.s; i < sp.e; i++) a[i] = ' ';
  return a.join('');
}

// ---- the machine ------------------------------------------------------------------------------------------
const HOST_WORDS = 'machines?|hosts?|pcs?|computers?|desktops?|laptops?|workstations?|devices?|servers?';
const NO = '(?:number|num|no\\.?|nr\\.?|id)';
// "machine 10004", "machine number 10004", "host:10004", "PC-10004", "pc10004", "machine #10004": nothing else needed
const HOST_WORD_BEFORE = new RegExp('\\b(?:' + HOST_WORDS + ')\\s*(?:' + NO + '\\s*)?[:#=]?\\s*-?\\s*#?\\s*$', 'i');
const HOST_WORD_AFTER = /^\s+(?:machine|host|pc|computer|desktop|laptop|workstation)\b/i;   // "the 10004 machine"
// "connect 10004", "connect to 10004", "log into 10004", "go to 10004", "use 10004"; "on / at / in / of / from 10004"
const CONNECT_BEFORE = /(?:\b(?:connect(?:ing|ed)?|join(?:ing|ed)?|remote|use|using|visit(?:ing)?)(?:\s+(?:back|over|in|on))?(?:\s+(?:to|into|onto|on|with))?|\b(?:log(?:ging)?|sign(?:ing)?)\s*(?:in|on)\s*(?:to|onto)?|\b(?:go|get|head|move|hop|jump|switch(?:ing)?)(?:\s+(?:back|over))?\s+(?:to|into|onto|on))\s+(?:the\s+)?$/i;
const PREP_BEFORE = /\b(?:on|onto|at|in|into|of|from|via)\s+(?:the\s+)?$/i;
// what a number is when the words just before it say so
const BEFORE_IS = [
  ['text to type or find', /\b(?:type|typing|enter|input|write|paste|put|fill\s+in|type\s+in|key\s+in|punch\s+in|enter\s+in|write\s+in|search(?:\s+for)?|look\s+(?:for|up)|find|google|set\s+(?:it\s+)?to|change\s+(?:it\s+)?to|equals?(?:\s+to)?)\s*[:=]?\s*$/i],
  ['a count or a measure', /\b(?:reach(?:es|ed|ing)?|score(?:s|d)?(?:\s+of)?|scoring|get\s+to|got\s+to|hit|beat|over|under|above|below|between|about|around|approx(?:\.|imately)?|roughly|nearly|almost|exactly|up\s+to|at\s+least|at\s+most|more\s+than|less\s+than|fewer\s+than|than|until|till|total(?:\s+of)?|sum(?:\s+of)?|plus|minus|times|multipl(?:y|ied)(?:\s+by)?|divided?(?:\s+by)?|add|subtract|calculate|compute|number\s+of|count\s+of|top|first|last|next|every|only)\s*[:=]?\s*$/i],
  ['a code or an id', /\b(?:code|pin|otp|zip(?:\s*code)?|post(?:al)?\s*code|postcode|passcode|password|id|order|invoice|ticket|ref(?:erence)?|account|acct|room|flight|ext(?:ension)?|version|build|port|year|page|line|row|step|item|tile|level|pid)(?:\s+(?:is|was|=|:|number|no\.?|#))*\s*[:#=]?\s*$/i],
  ['a phone number', /(?:\b(?:tel(?:ephone)?|phone|mobile|cell|fax|call|text|sms|whatsapp)(?:\s+(?:me|us|them|him|her|at|on|number|no\.?|is|:))*\s*[:#]?\s*|(?:\+\s?\d{1,4}|\(\s?\d{1,5}\s?\)|(?:^|[^\d])0\d{1,4})[\s.-]*(?:\d{1,5}[\s.-]+)*)$/i],
];
const MONEY_BEFORE = /(?:[$€£¥₹₩₽¢]|\b(?:usd|eur|gbp|chf|jpy|cad|aud|inr|rs\.?))\s*$/i;
const MONEY_AFTER = /^\s*(?:[$€£¥₹₩₽¢%]|(?:usd|eur|gbp|chf|jpy|cad|aud|inr|dollars?|euros?|pounds?|quid|bucks|yen|cents?|rupees?|francs?|percent|per\s*cent|pct)\b)/i;
// a measure or a count right after it (single letters and "ms"/"in" left out: "on 10004 in the browser", "10004 MS Paint")
const UNIT_AFTER = /^\s*(?:points?|pts|tiles?|words?|wpm|milliseconds?|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|weeks?|months?|years?|km|kms|kilomet(?:er|re)s?|met(?:er|re)s?|miles?|ft|feet|foot|inch(?:es)?|kg|kgs|grams?|lbs?|people|persons?|users?|times|rows?|columns?|cols?|cells?|items?|characters?|chars?|bytes?|kb|mb|gb|tb|px|pixels?|steps?|moves?|clicks?|lines?|pages?|records?|entries|results?|votes?|likes?|followers?|views?|calories|kcal|tokens?|digits?|letters?|copies|units?|pieces?|rpm|hz|khz|mhz|ghz|mph|kph|degrees?|celsius|fahrenheit)\b/i;
const SUM_BEFORE = /(?:[\d)]\s*[-+*\/×÷^=<>]|\d\s+x|[=<>])\s*\(?\s*$/i;
const SUM_AFTER = /^\s*\)?\s*(?:[-+*\/×÷^=<>]\s*[\d(]|[+*×÷^=]|x\s+[\d(])/i;
const VALUE_AFTER = /^\s+as\s+(?:the|a|an|my|your)\b/i;   // "use 12345 as the code"

// The words around one five-digit run -> null (it may be a machine) or why it is not one.
function notMachine(before, after) {
  // joined to more digits: 10:30:00, 12.000, 555-12345, 12345-6789 -- but 10004,10005 / 10004-10005 / 10004/10005 is a list
  const jb = /(\d+)([.,:\/–-])$/.exec(before), ja = /^([.,:\/–-])(\d+)/.exec(after);
  const listB = /(?:^|\D)\d{5}\s*[,\/–-]\s*$/.test(before), listA = /^\s*[,\/–-]\s*\d{5}(?!\d)/.test(after);
  if (jb && !(jb[1].length === 5 && /[,\/–-]/.test(jb[2]))) return 'part of a longer number';
  if (ja && !(ja[2].length === 5 && /[,\/–-]/.test(ja[1]))) return 'part of a longer number';
  if (MONEY_BEFORE.test(before) || MONEY_AFTER.test(after)) return 'money';
  if ((!listB && SUM_BEFORE.test(before)) || (!listA && SUM_AFTER.test(after))) return 'a sum';
  if (UNIT_AFTER.test(after)) return 'a count or a measure';
  if (VALUE_AFTER.test(after)) return 'a value to use';
  for (const [why, re] of BEFORE_IS) if (re.test(before)) return why;
  return null;
}

// Every five-digit run in the text, each read as 'strong' (marked as the machine), 'weak' (written plainly) or 'not'.
function hostCandidates(t, spans) {
  const found = [];
  const re = /\d+/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[0].length !== 5) continue;
    const s = m.index, e = s + 5, c = { value: m[0], s, e, kind: 'weak', why: '', cue: '' };
    found.push(c);
    const sp = spans.find((x) => s >= x.s && s < x.e);
    // a quoted machine number on its own ("connect to '10004'") is still the number; quoted text around one is not
    if (sp && !(sp.kind === 'quoted' && /^\W*#?\s*\d{5}\W*$/.test(t.slice(sp.s, sp.e)))) { c.kind = 'not'; c.why = SPAN_WHY[sp.kind]; continue; }
    const before = t.slice(Math.max(0, s - 60), s).replace(/["“„«`'‘]$/, '');
    const after = t.slice(e, e + 40).replace(/^["”»`'’](?![sS]\b)/, '');
    if (HOST_WORD_BEFORE.test(before) || HOST_WORD_AFTER.test(after)) { c.kind = 'strong'; c.cue = 'word'; continue; }
    if (/[\p{L}\p{N}_]$/u.test(before) || /^[\p{L}\p{N}_]/u.test(after)) { c.kind = 'not'; c.why = 'part of a word'; continue; }
    const not = notMachine(before, after);
    if (not) { c.kind = 'not'; c.why = not; continue; }
    if (/#\s*$/.test(before)) { c.kind = 'strong'; c.cue = '#'; continue; }
    if (CONNECT_BEFORE.test(before) || PREP_BEFORE.test(before)) { c.kind = 'strong'; c.cue = 'before'; }
  }
  // a list carries its first item's reading: "on 10004 and 10005" names two machines, "type 12345 and 67890" none
  // (but where the first one sat -- an address, quotes, a word -- is its own)
  const placed = new Set(Object.values(SPAN_WHY).concat('part of a word'));
  for (let i = 1; i < found.length; i++) {
    const c = found[i], prev = found[i - 1];
    if (c.kind !== 'weak' || prev.kind === 'weak' || placed.has(prev.why)) continue;
    if (/^\s*(?:,|and|&|or|\+|\/|-|–|to|through|thru)?\s*(?:,\s*)?(?:and\s+)?(?:(?:machines?|hosts?|pcs?|#)\s*)?$/i.test(t.slice(prev.e, c.s))) {
      c.kind = prev.kind; c.why = prev.why; c.cue = 'list';
    }
  }
  return found;
}

const uniq = (a) => [...new Set(a)];
const listOf = (a) => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

// -> { host, remove: [candidates whose words leave the task], clause: the machine's part of `why` }
function readHost(t, spans) {
  const found = hostCandidates(t, spans);
  const strong = uniq(found.filter((c) => c.kind === 'strong').map((c) => c.value));
  const weak = uniq(found.filter((c) => c.kind === 'weak').map((c) => c.value)).filter((v) => !strong.includes(v));
  const of = (v) => found.filter((c) => c.value === v && c.kind !== 'not');
  if (strong.length === 1 || (!strong.length && weak.length === 1)) {
    const host = strong.length ? strong[0] : weak[0];
    const marked = found.find((c) => c.value === host && c.kind === 'strong');
    const rest = strong.length ? weak : [];
    return { host, remove: of(host),
             clause: 'machine ' + host + (marked ? ' ("' + phraseSpan(t, marked).said + '")' : ' (written plainly)') +
                     (rest.length ? '; ' + listOf(rest) + (rest.length > 1 ? ' are' : ' is') + ' part of the job, not a machine' : '') };
  }
  if (strong.length > 1) {
    return { host: null, remove: found.filter((c) => c.kind === 'strong'),
             clause: 'no machine: several are named (' + strong.join(', ') + ') -- one visit is one machine, so say which' };
  }
  if (weak.length > 1) {
    return { host: null, remove: [],
             clause: 'no machine: several five-digit numbers (' + weak.join(', ') + ') and none marked as the machine -- write "on machine ' + weak[0] + '"' };
  }
  const nots = found.filter((c) => c.kind === 'not').slice(0, 3).map((c) => c.value + ' is ' + c.why);
  return { host: null, remove: [],
           clause: 'no machine named' + (nots.length ? ' (' + nots.join('; ') + ')' : '') + ' -- add its five-digit number: "on machine 10004"' };
}

// The words that say "this machine" around one candidate, and what (if anything) stands in for them.
const LEFT_CONNECT = '(?:\\b(?:connect(?:ing)?|join(?:ing)?|remote|use|using|visit)(?:\\s+(?:back|over|in|on))?(?:\\s+(?:to|into|onto|on|with))?\\s+|\\b(?:log(?:ging)?|sign(?:ing)?)\\s*(?:in|on)\\s*(?:to|onto)?\\s+|\\b(?:go|get|head|move|hop|jump|switch(?:ing)?)(?:\\s+(?:back|over))?\\s+(?:to|into|onto|on)\\s+)';
const LEFT_HOSTWORD = '(?:\\b(?:the|my|your|this|that)\\s+)?(?:\\b(?:' + HOST_WORDS + ')\\s*(?:' + NO + '\\s*)?[:#=]?\\s*-?\\s*)?(?:#\\s*)?["“„«`\'‘]?';
const LEFT_REMOVE = new RegExp('(?:' + LEFT_CONNECT + ')?(?:\\b(?:on|onto|at|in|into|of|from|via|for)\\s+)?' + LEFT_HOSTWORD + '$', 'i');
const LEFT_POSSESSIVE = new RegExp(LEFT_HOSTWORD + '$', 'i');
const LEFT_CONNECT_ONLY = new RegExp('^' + LEFT_CONNECT, 'i');
function phraseSpan(t, c) {
  let s = c.s, e = c.e, rep = '', glue = 0;
  const close = /^["”»`'’](?![sS]\b)/.exec(t.slice(e));
  if (close) e += 1;
  const poss = /^['’]s\b/.exec(t.slice(e));
  const head = t.slice(Math.max(0, s - 120), s);
  if (poss) {                                       // "what's on 10004's screen" -> "what's on the screen"
    e += poss[0].length;
    s -= LEFT_POSSESSIVE.exec(head)[0].length;
    rep = 'the';
  } else {
    const lw = LEFT_REMOVE.exec(head)[0];
    s -= lw.length;
    const hw = HOST_WORD_AFTER.exec(t.slice(e));
    if (hw) e += hw[0].length;                      // "the 10004 machine"
    // "what's on 10004?" asks about its screen
    if (/^on\s+$/i.test(lw) && /\bwhat(?:'s|’s|\s+is)\s+$/i.test(t.slice(0, s))) rep = 'on the screen';
    // "at 10:30 connect 10004 and solve it": the "and" only joined the connecting to the job
    else if (LEFT_CONNECT_ONLY.test(lw) && s > 0) { const g = /^\s*,?\s*(?:and\s+then|and|then)\b|^\s*,/i.exec(t.slice(e)); if (g) glue = g[0].length; }
  }
  return { s, e: e + glue, rep, said: t.slice(s, e).trim() };
}

// ---- the task: the person's own words, minus the connect part and the politeness -----------------------------
const QUESTION = /^(?:what|what's|what’s|whats|who|whom|whose|where|when|why|how|which|is|are|was|were|do|does|did|can|could|will|would|should|has|have)\b/i;
const ASK = /^(?:can|could|would|will)\s+(?:you|u|ya)\b[\s,]*/i;
const LEAD = [
  /^[\s,.;:!?\-–—]+/,
  /^(?:hey|hi|hello|yo|ok|okay|alright|so|now|also|then|and|first|um+|uh+)\b[\s,!.]*/i,
  /^(?:please|pls|plz|kindly)\b[\s,]*/i,
  ASK,
  /^you\s+(?:can|could|should)\b\s*/i,
  /^(?:would|do)\s+you\s+mind\b\s*/i,
  /^i(?:'d|’d|\s+would)\s+like\s+(?:you\s+)?to\b\s*/i,
  /^i\s+(?:want|need)\s+(?:you\s+)?to\b\s*/i,
  /^go\s+ahead\s+and\b\s*/i,
  /^help\s+me\s+(?:to\s+)?(?!with\b)/i,
  /^let(?:'s|’s|s)\b\s*/i,
  /^to\s+(?=[a-z])/i,
  // a connect phrase that named no number: "connect to my computer and ..."
  new RegExp('^(?:connect(?:ing)?|join|log\\s*(?:in|on)|sign\\s*(?:in|on)|remote)(?:\\s+(?:in|on))?(?:\\s+(?:to|into|onto|with))?\\s+(?:the|my|your|this|that|a)\\s+(?:' + HOST_WORDS + ')\\b', 'i'),
];
const TRAIL = /(?:[\s,.;:!\-–—]+|\b(?:thanks|thank\s+you(?:\s+(?:so|very)\s+much)?|thx|ty|cheers|for\s+me|if\s+(?:you\s+can|possible)|when\s+you\s+(?:can|get\s+a\s+chance)|and|then|please|pls|plz)\b)$/i;

function cleanTask(t, remove) {
  // the machine's words go first (right to left, so the earlier positions stay true)
  let s = t;
  const cuts = remove.map((c) => phraseSpan(t, c)).sort((a, b) => b.s - a.s);
  let last = Infinity;
  for (const p of cuts) {
    if (p.e > last) continue;                       // overlapping phrases (a list) were cut already
    s = s.slice(0, p.s) + (p.rep ? ' ' + p.rep + ' ' : ' ') + s.slice(p.e);
    last = p.s;
  }
  // quoted words are the person's exactly: nothing below touches them
  const kept = [];
  s = s.replace(/"[^"]*"|“[^”“]*”|„[^“”]*[“”]|«[^»]*»|`[^`]*`|(?<=^|[\s(\[{:,;])(?:'[^'\n]*'|‘[^’\n]*’)(?=$|[\s)\]}.,;:!?])/g,
                (q) => { kept.push(q); return '\uE000' + (kept.length - 1) + '\uE001'; });
  s = s.replace(/\s+/g, ' ').replace(/ +([,.;:!?])/g, '$1');
  s = s.replace(/\b(?:please|pls|plz|kindly)\b/gi, ' ');
  let asked = false;                                // "can you fill it in?" is a request, not a question
  for (let guard = 0; guard < 40; guard++) {
    const before = s;
    s = s.replace(/\s+/g, ' ').replace(/ +([,.;:!?])/g, '$1').replace(/([,;:])(?:\s*[,;:])+/g, '$1').trim();
    for (const re of LEAD) s = s.replace(re, (x) => { if (re === ASK) asked = true; return ''; });
    s = s.replace(TRAIL, '');
    if (s === before) break;
  }
  s = s.replace(/\?+$/, () => !asked && QUESTION.test(s) ? '?' : '');
  s = s.replace(/\uE000(\d+)\uE001/g, (_, i) => kept[Number(i)]);
  return oneLine(s).replace(/^-+\s*/, '');
}

// ---- the skill --------------------------------------------------------------------------------------------
const STOP = new Set(('a an the and or but if then than so to of in on at by for with from into onto over under up down out off about ' +
  'as is are was were be been being am do does did done doing have has had having it its this that these those there here ' +
  'what which who whom whose when where why how i me my mine we us our you your yours he him his she her they them their ' +
  'can could would should will shall may might must please pls plz kindly thanks thank hey hi hello ok okay just also too very ' +
  'really now again all any some each every no not yes let lets get got make go going want need like one two via eg etc vs ' +
  'machine host pc computer desktop laptop workstation device server number num nr id someone somebody something somewhere ' +
  'anything everything through e g u ya thats whats theres open').split(/\s+/));
// Light stemming, the same on both sides: plurals, -ing/-ed, -ation/-ator, a final e (notes/note, solving/solve, calculator/calculate).
function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.includes('-')) { const p = w.split('-'); p[p.length - 1] = stem(p[p.length - 1]); return p.join('-'); }
  let s = w;
  if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (/sses$/.test(s)) s = s.slice(0, -2);
  else if (/(?:x|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (/[^s]s$/.test(s)) s = s.slice(0, -1);
  const ing = /^(.*[aeiouy].*?)(?:ing|ed)$/.exec(s);
  if (ing && ing[1].length >= 3 && !/eed$/.test(s)) {
    s = ing[1];
    if (/([^aeiouylsz])\1$/.test(s)) s = s.slice(0, -1);
  }
  s = s.replace(/ations?$|ators?$/, 'at');
  if (s.length >= 4 && /e$/.test(s)) s = s.slice(0, -1);
  return s;
}
// words -> terms. A hyphened word with a number in it is one name ("15-puzzle": "solve 15 sudokus" is no 15-puzzle);
// any other hyphened word counts by its words ("sticky-note" is sticky + note, as the other skills spell it).
function terms(text) {
  const out = [];
  const words = lower(String(text || '')).replace(/\bsearch\s+(?:box|bar|field|button)\b/g, 'searchbox')   // a place on screen, not a search
    .replace(/'s\b/g, '').replace(/'/g, '').split(/[^a-z0-9\u00c0-\u024f-]+/);
  for (const raw of words) {
    const w = raw.replace(/^-+|-+$/g, '');
    if (w.length < 2 || STOP.has(w)) continue;
    if (!w.includes('-')) { out.push({ t: stem(w), w, part: false }); continue; }
    if (/\d/.test(w)) out.push({ t: stem(w), w, part: false });
    for (const p of w.split('-')) if (p.length >= 2 && !/^\d+$/.test(p) && !STOP.has(p)) out.push({ t: stem(p), w: p, part: true });
  }
  return out;
}
// Words that say WHAT KIND of thing the job is, but not WHICH: they add to a score, but never pick a skill alone
// ("play a game", "solve the puzzle", "run the tests", "type hello" name no skill).
const GENERIC = new Set(('play solve type typing read look see open launch game test puzzle grid task screen save result answer ' +
  'report left point list command size keyboard word app tile high number exact text region small digit label url mission ' +
  'milestone verify row column operator target safe reveal sequence click learned shape fill compute browser page work take ' +
  'cell board new free').split(/\s+/).map(stem));
// What people say, mapped onto words the skills already use (justified by each skill's README). A rule only adds
// words; a word lights up only skills whose own name / tags / when hold it -- so no rule can invent a skill.
const FILE_EXT = '(?:txt|pdf|docx?|xlsx?|pptx?|csv|json|png|jpe?g|gif|bmp|webp|svg|zip|7z|rar|exe|msi|ps1|bat|cmd|sh|py|js|ts|md|log|ini|cfg|conf|xml|ya?ml|tmp|bak|iso|mp[34]|wav|mov|avi)';
const SYNONYMS = [
  // work-through-sticky-notes: tasks someone left as ScreenMirror sticky notes -- "post-its", "stickies", "the tasks I left"
  [/\bpost[\s-]?its?\b|\bstickies\b|\bsticky\b|\bnotes?\s+(?:left|stuck)\b|\b(?:tasks?|to-?dos?|jobs|chores)\s+(?:on|in)\s+(?:the|my|your)\s+notes?\b|\btasks?\s+(?:i|we|they|he|she|someone|somebody)\s+(?:left|wrote|prepared|put|stuck|pinned)\b/, 'sticky note'],
  // solve-15-puzzle: "a sliding-tile puzzle (15-puzzle / 8-puzzle)"
  // ("the 15 puzzle" is one; "solve 8 puzzles" is a count)
  [/\b(?:15|fifteen|8|eight|n)(?:-puzzles?|\s?puzzle)\b|\bslid(?:e|ing)[\s-]+(?:tiles?[\s-]+)?puzzles?\b|\bsliding[\s-]+tiles?\b|\btile[\s-]+slid(?:e|ing|er)s?\b/, '15-puzzle sliding-tile'],
  // solve-a-nonogram: "nonogram / picross / griddler" -- hanjie, paint by numbers, Japanese crossword are its other names
  [/\bhanjie\b|\bgriddlers?\b|\bpicross\b|\bpaint[\s-]+by[\s-]+numbers?\b|\bjapanese\s+crosswords?\b|\bpic[\s-]?a[\s-]?pix\b/, 'nonogram'],
  // solve-kenken: "KenKen / KenDoku / MathDoku" -- and Calcudoku
  [/\bken[\s-]?kens?\b|\bkendoku\b|\bmath[\s-]?dokus?\b|\bcalcudokus?\b/, 'kenken'],
  // solve-minesweeper
  [/\bmine[\s-]?sweeper\b|\bmines\b|\bminefield\b/, 'minesweeper'],
  // solve-a-sudoku: its spellings
  [/\bsu[\s-]+doku/, 'sudoku'],
  // play-2048: "slide-and-merge the numbered tiles"
  [/\bslide[\s-]+(?:and|&|n)[\s-]+merge\b|\bmerg(?:e|ing)\s+(?:the\s+)?(?:numbered\s+)?tiles\b/, '2048'],
  // do-a-typing-test: monkeytype, and what it measures (words per minute)
  [/\btyping\s+(?:speed|test|race|game|practice|challenge)s?\b|\btype\s*racer\b|\bmonkey\s*type\b|\bkeybr\b|\b10\s*fast\s*fingers\b|\bwpm\b|\bwords?\s+(?:per|a|an)\s+minute\b|\bhow\s+fast\s+(?:you\s+|i\s+)?(?:can\s+)?type\b/, 'typing speed test monkeytype'],
  // draw-with-strokes: "a canvas (GIMP, a paint app)", proven on kleki -- people say sketch, doodle, paint
  [/\bsketch\w*|\bdoodl\w*|\bpaint(?:s|ing)?\b(?![\s-]+by[\s-]+numbers?)|\billustrat\w*|\bkleki\b|\bms\s*paint\b|\bmspaint\b/, 'drawing canvas'],
  // do-a-calculation: the DuckDuckGo calculator; "(1234 * 5678) + 91011" -- a sum written out is a calculation
  [/\bcalculat\w*|\bcalc\b|\barithmetic\b|\bmaths?\b|\bmultipl(?:y|ied|ication)\b|\bdivi(?:de|ded|sion)\b|\bsquare\s+root\b|\bsum\s+of\b|\badd\s+up\b|\bhow\s+much\s+is\b|\bwhat\s+is\s+[-\d(]|\bpercent(?:age)?\s+of\b|\d\s*[+*×÷^]\s*\(?\s*\d|\d\s+[-x\/]\s+\(?\s*\d|\(\s*\d+\s*[-+*\/×÷^]/, 'calculation calculator arithmetic'],
  // complete-a-survey: a poll is a survey
  [/\bpolls?\b/, 'survey'],
  // research-a-fact: "look something up (a web search or a Wikipedia article)" -- "how tall is the Eiffel Tower"
  [/\blook\s+(?:it\s+|that\s+|this\s+|something\s+|them\s+)?up\b|\blook[\s-]?up\b|\bgoogl\w*|\bsearch\s+(?:for|the\s+web|online|the\s+internet)\b|\bwiki\b|\bcapital\s+of\b|\bpopulation\s+of\b|\bwho\s+(?:is|was|wrote|invented|founded|discovered|won|painted|directed|built)\b|\bhow\s+(?:tall|high|old|far|deep|heavy|big|large|wide)\b|\b(?:meaning|definition)\s+of\b|\bfacts?\s+about\b|\bdefine\b/, 'research search fact'],
  // read-the-screen: "Read what's on the screen precisely" -- a crop and OCR
  [/\bwhat(?:'s|\s+is)?\s+(?:currently\s+)?(?:on|showing\s+on|displayed\s+on|up\s+on)\s+(?:the\s+|this\s+|your\s+|my\s+|that\s+)?screen\b|\bread\s+(?:me\s+)?(?:out\s+)?(?:the\s+|this\s+|my\s+|that\s+)?screen\b|\bscreen\s+says?\b|\bdescribe\s+(?:the\s+|this\s+|my\s+)?screen\b|\blook\s+at\s+(?:the\s+|this\s+|my\s+)?screen\b|\bscreen\s*shot\b|\bwhat\s+(?:do|can)\s+you\s+see\b|\bwhat\s+(?:does\s+)?(?:it|the\s+\w+)\s+says?\b|\bread\s+(?:me\s+)?(?:out\s+)?(?:the\s+|this\s+|that\s+)?(?:exact\s+)?(?:text|label|digits?|numbers?|url|address|error|message|value)\b/, 'screen vision ocr'],
  // drive-a-browser: "the task lives in a browser -- launch it, go somewhere" (an address, not a file: report.txt is no site)
  [new RegExp('\\b(?:open|launch|start|use)\\s+(?:up\\s+)?(?:the\\s+|a\\s+|an\\s+)?(?:new\\s+)?(?:web\\s+)?(?:browser|chrome|firefox|edge|safari|brave|opera)\\b|\\bweb\\s*sites?\\b|\\bweb\\s*pages?\\b|\\bhomepage\\b|\\bbrows(?:e|ing)\\b|\\bsurf\\b|' +
              '\\b(?:go|head|navigate|visit|open)\\s+(?:to\\s+)?(?:the\\s+)?(?:site\\s+|page\\s+|url\\s+)?[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?!' + FILE_EXT + '\\b)[a-z]{2,}\\b|\\bhttps?:\\/\\/|\\bwww\\.'), 'navigate'],
  // recover-a-stuck-session: "blank page, dead browser, hung socket, or the relay moved"
  [/\bfrozen\b|\bfreez(?:e|es|ing)\b|\bhung\b|\bcrash(?:ed|es|ing)?\b|\bunresponsive\b|\bnot\s+responding\b|\bblank\s+(?:white\s+)?(?:page|screen)\b|\bwhite\s+screen\b|\b(?:lost\s+(?:the\s+)?connection|connection\s+(?:dropped|lost))\b|\brelay\s+moved\b|\btimed?\s*out\b/, 'stuck session recovery'],
];
const THRESHOLD = 1.5;   // a name word only one skill has scores 3; a tag word only two share, 1.5
const CLOSE = 0.8;       // a second within this share of the best is a close second

// the skills, as weighted terms: name x3, tags x2, when x1 (a hyphened word's parts at most x2)
function profile(list) {
  const prof = [];
  for (const s of list) {
    if (!s || typeof s !== 'object' || !s.slug) continue;
    const w = new Map();
    const put = (text, weight) => { for (const x of terms(text)) { const v = x.part ? Math.min(weight, 2) : weight; if ((w.get(x.t) || 0) < v) w.set(x.t, v); } };
    put(s.when, 1);
    put((Array.isArray(s.tags) ? s.tags : String(s.tags || '').split(/[,\s]+/)).join(' '), 2);
    put(s.name || s.slug, 3);
    prof.push({ s, w });
  }
  const df = new Map();
  for (const p of prof) for (const t of p.w.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = prof.length;
  const idf = (t) => n ? Math.log(1 + n / (df.get(t) || n)) / Math.log(1 + n) : 0;
  return { prof, idf };
}
const r2 = (x) => Math.round(x * 100) / 100;
const short = (s) => ({ slug: s.s.slug, name: String(s.s.name || s.s.slug), score: r2(s.score) });

// -> { skill: {slug, name, run, score}|null, others: [...], entry: the skill's own record, clause }
function matchSkill(text, list) {
  if (!Array.isArray(list) || !list.length) return { skill: null, others: [], entry: null, clause: 'no skill: no skills to match against (pass intake.skills())' };
  const { prof, idf } = profile(list);
  const q = new Map();                              // term -> the word to show for it
  for (const x of terms(text)) if (!q.has(x.t)) q.set(x.t, x.w);
  const l = lower(text);
  for (const [re, add] of SYNONYMS) if (re.test(l)) for (const x of terms(add)) if (!q.has(x.t)) q.set(x.t, x.w);
  const ranked = [];
  for (const p of prof) {
    let score = 0, specific = false;
    const hit = [];
    for (const [t, shown] of q) {
      const v = p.w.get(t);
      if (!v) continue;
      const d = idf(t), c = v * d;
      score += c;
      hit.push([shown, c]);
      if (d >= 0.75 && !GENERIC.has(t)) specific = true;
    }
    if (score > 0) ranked.push({ s: p.s, score, specific, words: uniq(hit.sort((a, b) => b[1] - a[1]).map((h) => h[0])).slice(0, 3) });
  }
  ranked.sort((a, b) => b.score - a.score || (a.s.slug < b.s.slug ? -1 : 1));
  const eligible = ranked.filter((r) => r.specific && r.score >= THRESHOLD);
  if (!eligible.length) {
    // general words only: two of them ("play a game", "solve the puzzle") narrow it to a few worth a look; one says nothing
    const best = ranked[0];
    const maybe = best && best.score >= THRESHOLD && best.words.length >= 2
      ? ranked.filter((r) => r.score >= best.score * CLOSE && r.words.length >= 2).slice(0, 5) : [];
    const clause = maybe.length
      ? 'no skill: only general words matched (' + best.words.join(', ') + ') -- the driver works it out; maybe ' + maybe.map((r) => r.s.slug).join(', ')
      : 'no skill fits -- the driver works it out';
    return { skill: null, others: maybe.map(short), entry: null, clause };
  }
  const top = eligible[0];
  const tied = eligible.filter((r) => Math.abs(r.score - top.score) < 1e-9);
  if (tied.length > 1) {
    return { skill: null, others: tied.slice(0, 5).map(short), entry: null,
             clause: 'no skill: ' + listOf(tied.slice(0, 5).map((r) => r.s.slug)) + ' fit equally -- the driver looks first' };
  }
  const close = eligible.slice(1).filter((r) => r.score >= top.score * CLOSE).slice(0, 4);
  return { skill: { slug: top.s.slug, name: String(top.s.name || top.s.slug), run: String(top.s.run || ''), score: r2(top.score) },
           others: close.map(short), entry: top.s,
           clause: 'skill ' + top.s.slug + ' (' + top.words.join(', ') + ')' + (close.length ? '; close: ' + close.map((r) => r.s.slug).join(', ') : '') };
}

// ---- the access -------------------------------------------------------------------------------------------
// Things done with a sticky note need no extra access (note-add, note-done): "save it as a sticky note", "cross them off".
const NOTE_ACTS = /\b(?:save|write|leave|add|put|post|make|jot|note)\s+(?:it|that|this|them|the\s+\w+|a\s+summary|down)?\s*(?:down\s+)?(?:as|on|in|into|to)\s+(?:a|the|my|your)?\s*(?:sticky\s+)?note\b|\b(?:leave|write|add|post|make)\s+(?:me\s+)?(?:a|the)\s+(?:sticky\s+)?note\b|\b(?:cross|tick|check)\s+(?:\w+\s+){0,2}?off\b|\bmark\s+(?:\w+\s+){0,2}?(?:as\s+)?(?:done|resolved|complete)\b/g;
// acting on the screen: the keyboard and the mouse
const ACT = [
  /\b(?:double[\s-]?|right[\s-]?)?click(?:s|ed|ing)?\b/,
  /(?<!\b(?:the|a|an|any|this|that|which|what|whats|file|data|blood|font|mime|content|account|user|job|task)\s)\btyp(?:e|es|ed|ing)\b(?!\s+of\b)/,
  /\bpress(?:es|ed|ing)?\b/, /\btap(?:s|ped|ping)?\b/, /\bfill(?:s|ed|ing)?\b/, /\bsubmit\w*/,
  /\banswer(?:s|ed|ing)?\s+(?:the\s+|all\s+|each\s+|every\s+|these\s+|those\s+|its\s+|my\s+)?(?:\w+\s+)?(?:questions?|survey|form|questionnaire|poll|quiz)\b/,
  /\bsolv(?:e|es|ed|ing)\b/,
  /(?<!\b(?:is|are|was|were|now|whats|what|currently|still)\s)\bplay(?:s|ed|ing)?\b/,
  /\b(?:draw|draws|drew|drawn|paint|paints|painted|sketch|sketches|sketched|doodle|doodles|doodled)\b/,
  /(?<!\b(?:the|a|an|my|your|this|that|his|her|their)\s)\b(?:drawing|painting|sketching|doodling)\b/,
  /(?<!\b(?:is|are|was|were|still|already|currently|left|stay|stays|kept|keep|which|what|whats|any|all|the|an)\s)\bopen(?:s|ed|ing)?\b/,
  /\blaunch\w*/, /\bstart\s+(?:up\s+)?(?:the\s+|a\s+|an\s+)?(?:new\s+)?(?:app|application|program|browser|game|chrome|firefox|edge|notepad)\b/,
  /\b(?:close|closes|closing|quit|minimi[sz]e|maximi[sz]e)\b/,
  /\b(?:scroll|drag|drop|select|choose|pick|tick|toggle|enable|disable|uncheck)(?:s|ed|ing|ped|ping)?\b/,
  /\bcheck\s+(?:the\s+|a\s+|that\s+|each\s+|every\s+|all\s+)?(?:check)?box(?:es)?\b/, /\b(?:turn|switch)\s+(?:\w+\s+)?(?:on|off)\b/,
  /\bnavigat\w*/, /\bbrows(?:e|es|ed|ing)\b/, /\bvisit\w*/, /\bgo\s+to\b/,
  /\b(?:re)?search(?:es|ed|ing)?\b/, /\bgoogl\w*/, /\blook\s+(?:\w+\s+)?up\b/,
  /\bfind\s+out\b(?!\s+what(?:'s|s|\s+is)?\s+(?:on|showing))/,                 // a fact: searched for, typed
  /\bwrit(?:e|es|ing)\b/, /\bedit\w*/, /\bchange\s+(?:the|a|an|my|it|this|that|to|its|all|every|them)\b/, /\brenam\w*/,
  /\bmove\s+(?:the|a|an|my|it|this|that|to|its|all|every|them)\b/, /\b(?:copy|copies|copied|copying|paste|pastes|pasted|pasting)\b/,
  /\bdelet\w*/, /\bremov(?:e|es|ing)\b/, /\bsav(?:e|es|ing)\b/, /\b(?:down|up)load\w*/, /\bsend(?:s|ing)?\b(?!\s+(?:me|us|back)\b)/,
  /\b(?:restart|reboot)\w*/, /\bshut\s*down\b/, /\b(?:recover|fix|repair|restore|reload|refresh|retry|reset)(?:s|ing)?\b/,
  /\b(?:finish|complete|clear)(?:s|ing)?\s+(?:the|my|this|that|a|an|it|them|all|each|every|out)\b/,
  /\b(?:start|get)\s+(?:to\s+)?work(?:ing)?\b|\bwork(?:ing)?\s+on\s+(?:them|it|each|these|those|the\s+(?:tasks?|notes?|list))\b/, /(?<!\b(?:an|the|any|for|no)\s)\bupdat(?:e|es|ing)\b/, /\bconfigur\w*/, /\bset\s+up\b|\bsetup\b/,
  /\bsign(?:s|ing)?\s+(?:in|up|out)\b|\blog(?:s|ging)?\s*(?:in|on|out|off)\b/, /\benter(?:s|ing)?\b/, /\bbuy\w*/,
  /\bcalculat\w*/, /\bcomput(?:e|es|ing)\b/,
  /\b(?:do|doing|complete|completing|finish|finishing|handle|tackle)\s+(?:all\s+|each\s+|every\s+)?(?:of\s+)?(?:the\s+|my\s+|these\s+|those\s+|your\s+|our\s+|his\s+|her\s+|their\s+)?(?:[\w-]+\s+){0,2}(?:tasks?|notes?|jobs?|chores?|to-?dos?|items?|list)\b/,
  /\bwork(?:ing)?\s+through\b/,
];
// running commands: a grant of its own (--shell)
const SHELL = [
  /\b(?:un|re)?install(?:s|ed|ing|er|ation)?\b/,
  /\brun(?:s|ning)?\s+(?:a\s+|an\s+|the\s+|this\s+|that\s+|some\s+|my\s+|these\s+|those\s+)?(?:[\w.-]+\s+)?(?:commands?|scripts?|tests?|batch\s+files?)\b/,
  /\b(?:command[\s-]?line|cmd(?:\.exe)?|power\s?shell|pwsh|bash|zsh|sudo|shell\s+commands?|scripts?)\b/,
  /\bexec(?:ute|utes|uted|uting)?\b/,
  /\b(?:pip3?|npm|npx|winget|choco(?:latey)?|apt(?:-get)?|brew|yum|dnf|ipconfig|ifconfig|netstat|tasklist|taskkill|systeminfo|chkdsk|sfc|regedit|git)\b/,
];
// running a script file ("run $HOME/setup.sh", "execute build.bat"), read where paths and file names are still there
const SCRIPT_RUN = /\b(?:run|runs|running|execute|exec|launch|start|call|invoke|source)\s+(?:the\s+|a\s+|this\s+|that\s+|my\s+)?(?:script\s+)?[^\s"'`]*\.(?:ps1|bat|cmd|sh|py)\b/;
// looking and reading: nothing beyond watching
const READS = /\b(?:read|reads|reading|look|looks|looking|see|sees|seeing|check|checks|checking|watch|watching|tell|show|describe|what|whats|which|who|where|when|how|count|verify|monitor|observe|screenshot|list|report|is\s+there|are\s+there)\b/;
const firstOf = (res, t) => { let best = null; for (const re of res) { const m = re.exec(t); if (m && (!best || m.index < best.index)) best = m; } return best; };
const said = (m) => '"' + m[0].replace(/\s+/g, ' ').trim().replace(/\s+(?:the|a|an|my|this|that|it|them|all|each|every|out|to|its)$/i, '').slice(0, 30) + '"';

// (text: the job's words with quotes, addresses and paths blanked; unquoted: only the quotes blanked) -> { needs, clause }
function readNeeds(text, unquoted, entry) {
  let t = ' ' + lower(text).replace(/'/g, '').replace(/\s+/g, ' ') + ' ';   // "what's playing" -> "whats playing"
  t = t.replace(NOTE_ACTS, (x) => ' '.repeat(x.length));
  const needs = { control: false, shell: false, terminal: false };
  const why = [];
  // the Terminal panel; "Windows Terminal" and a "terminal app" are a desktop program, driven like any other
  const app = /\bwindows\s+terminal\b|\bterminal\s+(?:app|application|emulator)\b/;
  const term = /\bterminal\b/.exec(t.replace(app, (x) => ' '.repeat(x.length)));
  const sh = firstOf(SHELL, t) || SCRIPT_RUN.exec(lower(String(unquoted || '')));
  if (term) {
    needs.terminal = true;
    why.push('terminal (' + said(term) + (sh ? '; ' + said(sh) + ' runs there' : '') + ')');
    t = t.replace(/\b(?:open|launch|use|show|start)\s+(?:up\s+)?(?:the\s+|a\s+)?terminal(?:\s+panel)?\b/g, (x) => ' '.repeat(x.length));
  } else if (sh) {
    needs.shell = true;
    why.push('shell (' + said(sh) + ')');
  }
  const act = firstOf(ACT, t);
  if (act) { needs.control = true; why.unshift('control (' + said(act) + ')'); }
  else if (!sh && !term && !READS.test(t) && entry) {
    // no verb at all ("2048 on 10005", "the sudoku on 10002"): what that skill itself does
    const own = firstOf(ACT, ' ' + lower(String(entry.name || '') + ' ; ' + String(entry.when || '')).replace(NOTE_ACTS, ' ') + ' ');
    if (own) { needs.control = true; why.unshift('control (the ' + entry.slug + ' skill: ' + said(own) + ')'); }
  }
  const clause = why.length ? 'asks for ' + why.join(', ')
    : 'watch only: ' + (READS.test(t) ? 'it reads and looks' : 'nothing in it acts on the screen or runs a command');
  return { needs, clause };
}

// ---- parse --------------------------------------------------------------------------------------------------
// parse(text, skills) -> { ok, host, skill, others, task, needs, why }. `ok`: a visit can start -- a machine and a job.
function parse(text, skillList) {
  const out = { ok: false, host: null, skill: null, others: [], task: '', needs: { control: false, shell: false, terminal: false }, why: '' };
  try {
    const t = oneLine(typeof text === 'string' ? text.slice(0, MAX_TEXT) : '');
    if (!t) { out.why = 'nothing was asked'; return out; }
    const spans = protectedSpans(t);
    const h = readHost(t, spans);
    out.host = h.host;
    out.task = cleanTask(t, h.remove);
    // the job's own words: quoted text, paths and mail addresses are what it works ON; a web address still says "browser"
    const spansT = protectedSpans(out.task);
    const sk = matchSkill(blank(out.task, spansT, ['quoted', 'path', 'email']), skillList);
    out.skill = sk.skill;
    out.others = sk.others;
    const nd = readNeeds(blank(out.task, spansT), blank(out.task, spansT, ['quoted']), sk.entry);
    out.needs = nd.needs;
    out.ok = !!out.host && !!out.task;
    out.why = [h.clause, out.task ? '' : 'no job beyond connecting -- say what the visit is for', out.task ? sk.clause : '', out.task ? nd.clause : '']
      .filter(Boolean).join('; ');
  } catch (e) {
    out.ok = false;
    out.why = 'could not read it: ' + (e && e.message || e);
  }
  return out;
}

// ---- the command line ---------------------------------------------------------------------------------------
const shellOf = (v) => /^(?:powershell|pwsh|ps|ps1)$/i.test(String(v || '')) ? 'powershell'
  : /^(?:sh|bash|zsh|dash|posix)$/i.test(String(v || '')) ? 'sh' : (process.platform === 'win32' ? 'powershell' : 'sh');
// a word either shell reads as itself: unquoted
const BARE = /^[\w.\/:\\@%+=,-]+$/;
// nothing either shell does anything with inside double quotes: no $ ` " \ !, and none of PowerShell's “ ” „ ‟
const PLAIN = /^[^$`"\\!“”„‟\u0000-\u001f\u007f]*$/;
function quote(s, shell) {
  if (PLAIN.test(s)) return '"' + s + '"';
  if (shell === 'sh') return "'" + s.replace(/'/g, "'\\''") + "'";
  let open = true;
  let q = s.replace(/"/g, () => { const c = open ? '“' : '”'; open = !open; return c; })
           .replace(/['‘’‚‛]/g, (c) => c + c);
  if (/\\$/.test(q)) q += ' ';                      // 5.1 would read a final \ as escaping the quote it wraps the argument in
  return "'" + q + "'";
}

// command(parsed, {shell: 'powershell'|'sh', serve: './work'}) -> the line that starts that visit. Without a machine
// it holds NNNNN where the number goes (the client refuses that, so a pasted template can never reach anyone).
function command(parsed, opts) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const shell = shellOf(o.shell);
  const host = /^[0-9]{5}$/.test(String(p.host == null ? '' : p.host)) ? String(p.host) : 'NNNNN';
  const task = oneLine(p.task).replace(/^-+\s*/, '');
  const n = p.needs && typeof p.needs === 'object' ? p.needs : {};
  const serve = oneLine(o.serve) || './work';
  const parts = ['node', 'core/agent-join.js', '--host', host];
  if (task) parts.push('--task', quote(task, shell));
  if (n.control) parts.push('--control');
  if (n.shell) parts.push('--shell');
  if (n.terminal) parts.push('--terminal');
  parts.push('--serve', BARE.test(serve) ? serve : quote(serve, shell));
  return parts.join(' ');
}

module.exports = { skills, parse, command };

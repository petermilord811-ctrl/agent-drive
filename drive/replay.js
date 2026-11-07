#!/usr/bin/env node
'use strict';
// @tool replay a PROVEN mission: save a job that worked as a recipe, run it again with no driver turns, proving each milestone -- or the same job with other values (--set)
// @run  node drive/replay.js save <serve-dir> <skill-name>   then   node drive/replay.js run skills/<skill-name>/replay.json <serve-dir> [--set <name>=<text>]...
// replay.js -- A JOB THAT WORKED ONCE RUNS AGAIN WITHOUT ITS DRIVER.
//
// The slowest thing in a visit is not the machine, it is the driver deciding what to do next (87% of working time,
// a median of 46 s per decision). A job that has already been done -- planned as a mission, every milestone
// PROVEN -- does not need those decisions a second time: sudoku shows the payoff, 18 s as a routine against 5-9
// minutes driven by hand. The serve records every successful command with the milestone it worked on
// (<serve-dir>/steps.jsonl, next to mission.json); this turns that into a recipe and runs it back:
//
//   save   reads mission.json + steps.jsonl and writes skills/<name>/replay.json (+ a README so `node kit.js skills`
//          lists it). Only what was PROVEN is kept: milestones achieved in order; a skipped one is left out with its
//          commands; the first one that failed or never finished ends the recipe. A secret's text was never
//          recorded ({{secret}}) -- the run asks for it. The typed text that WILL be stored is printed for review,
//          and so are the VALUES a replay may type in its place (below).
//   run    posts the plan (the room sees it), then per milestone ONE `plan` of its commands -- one round trip --
//          and proves it: the milestone's own check, else the last check the original run made there, else a
//          picture shown to the room. Stops at the first milestone whose actions or proof fail, and says which.
//          --set <name>=<text> (any number of them) types another text for a value; --ignore-unknown lets a caller
//          that passes facts a recipe may not use (a trigger's --set machine=… file=… event=…) skip the ones it lacks.
//   values <recipe> [--json]   what a replay may change: each value's name, default, kind and where it is.
//   promote <name> [--yes]   a DRAFT joins the library. The serve writes one itself -- skills/_drafts/<name>/,
//          gitignored -- when a planned job finishes with every milestone proven and no skill already did it
//          (draft(), below). It prints the typed text and the values the draft stores; only with --yes is it moved
//          to skills/<name>/.
//
// Exit codes: 0 every milestone achieved; 2 usage / a bad recipe / a --set naming no value of the recipe (nothing
// runs); 3 could not start (no serve answering, the plan refused, a secret missing); 4 a milestone's actions failed;
// 5 a milestone's proof failed.
const fs = require('fs'), path = require('path');
const { exchange } = require('../core/cmd-file.js');
const verbs = require('../core/verbs.js');
const KIT = path.join(__dirname, '..');
const SECRET = '{{secret}}';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function readSteps(dir) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(dir, 'steps.jsonl'), 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of txt.split(/\r?\n/)) { if (!line.trim()) continue; try { const o = JSON.parse(line); if (o && o.cmd && typeof o.cmd.do === 'string') out.push(o); } catch (_) {} }
  return out;
}
// every {{secret}} in a command (and the steps of a plan inside it), in order
const walk = (c, fn) => {
  if (Array.isArray(c)) return c.map((x) => walk(x, fn));
  if (!c || typeof c !== 'object') return fn(c);
  const o = {};
  for (const k of Object.keys(c)) o[k] = walk(c[k], fn);
  return o;
};
const countSecrets = (cmds) => { let n = 0; walk(cmds, (v) => { if (v === SECRET) n++; return v; }); return n; };
// the text each `keys` typed, as a replay with no --set types it (a value's default in place of its {{name}})
function typedTexts(cmds, values) {
  const fill = resolver(values, null).render, t = [];
  const visit = (c) => { if (Array.isArray(c)) return c.forEach(visit); if (!c || typeof c !== 'object') return; if (c.do === 'keys' && typeof c.text === 'string' && c.text !== SECRET) t.push(fill(c.text)); for (const k of ['steps', 'then', 'else']) if (c[k]) visit(c[k]); };
  visit(cmds);
  return t;
}
// the last machine check the original run made while this milestone was current -- proof the replay got there too
function lastCheck(cmds) {
  for (let i = cmds.length - 1; i >= 0; i--) {
    const c = cmds[i];
    if ((c.do === 'expect' || c.do === 'wait') && c.until && typeof c.until === 'object') return c.until;
  }
  return null;
}

// A recorded `plan` holds its steps as the driver sent them: the serve puts a slip in its real name ({do:"type"} ->
// keys, keys.keys -> keys.text, "clicktext" -> clickText) only in the copy it runs (core/verbs.js). Here they get
// their real names too -- or text typed in a slip's spelling would never become a value, and a "clicktext" of the
// old invoice would go on clicking it in a replay with a new one. A plan the verb table no longer reads stays as it was.
function canonical(c) {
  if (!c || typeof c !== 'object' || c.do !== 'plan' || !Array.isArray(c.steps)) return c;
  let vp = null;
  try { vp = verbs.vetPlan(c.steps); } catch (_) {}
  if (!vp || !vp.ok || !Array.isArray(vp.steps)) return c;
  // never `__vetted` in a recipe: it is the serve's own mark of a command it has checked
  const bare = (x) => { if (Array.isArray(x)) return x.map(bare); if (!x || typeof x !== 'object') return x; const o = {}; for (const k of Object.keys(x)) if (k !== '__vetted') o[k] = bare(x[k]); return o; };
  return Object.assign({}, c, { steps: bare(vp.steps) });
}

// mission.json + steps.jsonl -> the recipe. Pure apart from reading the two files.
function build(dir) {
  let mj;
  try { mj = readJson(path.join(dir, 'mission.json')); } catch (e) { return { ok: false, why: 'no mission.json in ' + dir + ' -- only a job planned as a mission can be replayed (' + e.message + ')' }; }
  const ms = Array.isArray(mj.ms) ? mj.ms : [];
  const steps = readSteps(dir);
  const byM = new Map();
  for (const s of steps) { const k = String(s.m || ''); if (!byM.has(k)) byM.set(k, []); byM.get(k).push(canonical(s.cmd)); }
  const milestones = [];
  let carry = byM.get('') || [];      // what was done before the plan existed (opening the app) leads the first milestone
  let stoppedAt = null;
  for (const m of ms) {
    const cmds = carry.concat(byM.get(m.id) || []);
    carry = [];
    if (m.s === 'skipped') continue;                        // left out, and its commands with it
    if (m.s !== 'done') { stoppedAt = { t: m.t, s: m.s || 'todo' }; break; }   // not proven: nothing after it is either
    milestones.push({ t: m.t, done: m.done, check: m.check || null, steps: (m.steps || []).map((x) => (x && typeof x === 'object' ? x.t : x)).filter(Boolean), cmds });
  }
  if (!milestones.length) return { ok: false, why: 'no milestone of that run was achieved in order -- nothing proven to replay' + (stoppedAt ? ' (the first, "' + stoppedAt.t + '", is ' + stoppedAt.s + ')' : '') };
  const values = findValues(milestones);   // from here the commands and checks carry {{name}} where each value was
  const all = milestones.reduce((a, m) => a.concat(m.cmds), []);
  return { ok: true, recipe: { kind: 'mission-replay', v: 2, goal: String(mj.goal || ''), done: String(mj.done || ''), saved: new Date().toISOString(),
                                from: path.basename(path.resolve(dir)), secrets: countSecrets(all), values, milestones },
           stoppedAt, typed: typedTexts(all, values), commands: all.length };
}

// ---- VALUES: the same job with a different file name, date, amount or URL ---------------------------------------
//
// A recipe types exactly what the job typed, and most jobs worth saving are worth running again with ONE thing
// different -- next week's date, the next invoice, the file that just arrived. Recording the job again for that would
// throw away the proof that it works. So a save (and a draft) turns each piece of text the job TYPED -- a `keys` text,
// the URL an `open` typed -- into a named VALUE whose default is the original: the command carries {{name}}, and
//   values: [{name, default, kind: text|url|path|date|number, where: 'milestone 2: typed', checks?, template?, note?}]
// lists them. `run --set name=text` types another text for one; a value not given keeps its default, so a replay with
// no --set types exactly what the job typed. The rules, and the case each is for:
//  * A VALUE is a typed text with a letter or a digit in it. A typed " " or "/" is a keystroke (a space, the key that
//    opens a search), not data. A secret is never one: its text was never recorded ({{secret}}), and is not now.
//  * THE SAME TEXT TYPED TWICE IS ONE VALUE: a date typed into two fields is one date, and --set date changes both.
//  * ITS NAME says where and what: the URL an open typed is `url`; a typed text by its shape -- `date`, `time`,
//    `amount` (two decimals, or a currency), `number`, `email`, `phone`, `file`, `folder`, `url` -- else by the
//    milestone that typed it, when that milestone typed only the one ("Enter the invoice number" -> `invoice`), else
//    `text1`, `text2`… The second of a name is `date2`. Never `secret`, nor a {{word}} the recorded text already holds:
//    a run would fill that.
//  * INSIDE A LONGER TYPED TEXT a value changes too: a date typed into a field, and again in a sentence ("Paid on
//    2026-11-06 by card"). The sentence's value keeps the original as its default, plus a `template` with {{date}}
//    where the date was -- --set date changes both; --set of the sentence replaces all of it. Only where the recipe
//    says the value was: found once, at save, never by a find-and-replace at run time. Only inside a text, URL or path
//    value (a year typed alone is not part of a date), only a value of 3 characters or more, never in the middle of a
//    word or a number ("100" is not in "100.50", "Save" not in "Saved"), case and spaces exactly as typed.
//  * PROOF FOLLOWS THE VALUE: a check that reads a value's text ({text:{has:'42.50'}} -- the milestone's own, or one
//    the job made on the way) carries {{amount}} too: a replay with a new amount could otherwise never be proven, or
//    worse, be "proven" by the old amount still on the screen. So does a word read to act on -- clickText, find, the
//    window a focus brings forward -- or the replay would click the OLD invoice in the list. Matched as the serve
//    matches them, ignoring case and runs of spaces. A check may carry a value of any length when it reads exactly
//    that text; a word read to act on only one of 3 characters or more (clicking "3" where "1" was could click
//    anything). The recipe says so: a value's `checks` names the checks that follow it, and its `note` a check or a
//    word that reads only PART of it -- kept as recorded, so a new value may not be proven there.
//  * NOT PARAMETERISED: what `exec`, `launch`, `fetch` and `send` are given -- a command line, a program to start, a
//    file crossing the machine's edge. A value can come from outside (a trigger's --set file=… names whatever file
//    arrived); filled in there it would be a command to run or a file to take, not text in a field the recipe's
//    proof then checks. (The serve records those verbs only inside a `plan`, as its steps.) Nor the goal, a
//    milestone's name or its done-when: they describe the job to the room, a milestone's name is how a replay
//    achieves it, and the goal is the Allow card's line when a schedule runs it. Nor clicks, keys pressed, chords.
//  * A RUN fills a {{name}} only in those fields -- typed text, a URL opened, a word read on the screen, a check's
//    text -- in ONE pass: the text put in is never read again for {{…}}, and a secret's never for anything. A recipe
//    saved before values (no `values`) runs exactly as it always did.
const VALUE_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const TOKEN = /\{\{([a-z][a-z0-9_]{0,39})\}\}/g;
const ALNUM = /[\p{L}\p{N}]/u, WORDCH = /[\p{L}\p{N}_]/u, DIGIT = /[0-9]/;
const CHECK_KEYS = new Set(['until', 'expect', 'if', 'check']);   // where a command (or a milestone) holds a predicate
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const squash = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

// The fields a value can be in, and what `where` calls each: what was TYPED (a keys text, the URL an open typed), and
// what was READ on the screen to act on -- the word a clickText clicked or a find looked for, the window a focus
// brought forward (a case-insensitive part of its title, sent to the host as data, never in a command line).
function slotOf(c, k) {
  const d = c && c.do;
  if (d === 'keys' && k === 'text') return { type: 'typed', label: 'typed' };
  if (d === 'open' && k === 'url') return { type: 'typed', label: 'the URL it opened', opened: true };
  if ((d === 'clickText' || d === 'find') && k === 'text') return { type: 'read', label: d === 'find' ? 'text it looked for' : 'text it clicked' };
  if (d === 'focus' && k === 'title') return { type: 'read', label: 'the window it brought forward' };
  return null;
}
// every place a value can be, in the order the job got there: {mi, i, type: typed|read|check, label, obj, key}
function slotsIn(milestones) {
  const out = [];
  const pred = (p, mi, label) => {
    if (Array.isArray(p)) return p.forEach((x) => pred(x, mi, label));
    if (!p || typeof p !== 'object') return;
    for (const n of ['text', 'notext']) if (p[n] && typeof p[n] === 'object' && typeof p[n].has === 'string') out.push({ mi, i: out.length, type: 'check', label, obj: p[n], key: 'has' });
  };
  const cmd = (c, mi) => {
    if (Array.isArray(c)) return c.forEach((x) => cmd(x, mi));
    if (!c || typeof c !== 'object') return;
    for (const k of Object.keys(c)) {
      const s = typeof c[k] === 'string' ? slotOf(c, k) : null;
      if (s) out.push(Object.assign({ mi, i: out.length, obj: c, key: k }, s));
      else if (CHECK_KEYS.has(k)) pred(c[k], mi, 'a check it made');
      else if (k === 'steps' || k === 'then' || k === 'else') cmd(c[k], mi);
    }
  };
  milestones.forEach((m, mi) => { if (m && typeof m === 'object') { cmd(m.cmds, mi); pred(m.check, mi, 'its check'); } });
  return out;
}

// WHAT A TYPED TEXT LOOKS LIKE -> its kind and the name it is given. `atomic`: a date, a number, an email address or a
// phone number is a value in its own right, never a sentence with other values inside it. `hint`: a plain text or number may
// be named by the milestone that typed it instead.
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATES = [/^\d{4}-\d{1,2}-\d{1,2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?)?$/i, /^\d{4}\/\d{1,2}\/\d{1,2}$/, /^\d{1,2}([/-])\d{1,2}\1(?:\d{4}|\d{2})$/,
  /^\d{1,2}\.\d{1,2}\.\d{4}$/, new RegExp('^(?:\\d{1,2}(?:st|nd|rd|th)?\\s+' + MON + ',?\\s+\\d{4}|' + MON + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})$', 'i')];
const TIME = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?$/i;
const MONEY = /^(?:[$€£¥]\s?[-+]?\d[\d,.' ]*|[-+]?\d[\d,.' ]*?\s?(?:[$€£¥]|usd|eur|gbp|chf|jpy)|[-+]?(?:\d{1,3}(?:[,.' ]\d{3})+|\d+)[.,]\d{2})$/i;
const NUMBER = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const PHONE = /^\+?[\d(][\d\s().-]{5,20}\d$/;
const FILE_EXT = /\.(?:txt|csv|tsv|json|xml|html?|md|pdf|docx?|xlsx?|xlsm|pptx?|odt|ods|odp|rtf|png|jpe?g|gif|bmp|svg|webp|tiff?|zip|7z|rar|gz|tgz|tar|log|ini|cfg|conf|ya?ml|js|ts|py|ps1|sh|bat|cmd|exe|msi|mp3|mp4|wav|mov|avi|mkv|eml|msg|ics|vcf|sql|db|bak)$/i;
function pathShape(s) {
  if (/[\r\n]/.test(s)) return '';
  const abs = /^(?:[a-z]:[\\/]|\\\\[^\\\s]|~[\\/]|\.{1,2}[\\/])/i.test(s) || /^\/[^\s/]+\/./.test(s) || (/^\/[^\s/]+$/.test(s) && FILE_EXT.test(s));
  const rel = /^[^\s\\/:*?"<>|]+(?:[\\/][^\\/:*?"<>|]+)+$/.test(s) && FILE_EXT.test(s);   // docs/report.md -- a word and/or another is not one
  const bare = /^[^\s\\/:*?"<>|]+$/.test(s) && FILE_EXT.test(s);                          // report-q3.xlsx; "see report.pdf" is a sentence
  if (!abs && !rel && !bare) return '';
  const last = s.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return /[\\/]$/.test(s) || !/\.[a-z0-9]{1,8}$/i.test(last) ? 'folder' : 'file';
}
function shapeOf(text, opened) {
  const s = text.trim();
  if (opened || /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i.test(s)) return { kind: 'url', base: 'url' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { kind: 'text', base: 'email', atomic: true };
  if (DATES.some((re) => re.test(s))) return { kind: 'date', base: 'date', atomic: true };
  if (TIME.test(s)) return { kind: 'date', base: 'time', atomic: true };
  if (MONEY.test(s)) return { kind: 'number', base: 'amount', atomic: true, hint: 'number' };
  if (NUMBER.test(s)) return { kind: 'number', base: 'number', atomic: true, hint: 'number' };
  if (PHONE.test(s) && (s.match(/\d/g) || []).length >= 7) return { kind: 'text', base: 'phone', atomic: true };
  const p = pathShape(s);
  if (p) return { kind: 'path', base: p };
  return { kind: 'text', base: 'text', hint: 'text' };
}
// A plain text's (or number's) name from the milestone that typed it: the LAST word of its title that names a field,
// joined to the word before when that names one too -- "Enter the invoice number" -> invoice, "Type the customer
// name" -> customer_name, "Add notes" -> note. Asked only when that milestone typed just the one such value, so two
// fields typed in one milestone never trade names.
const HINT_TEXT = new Set(['name', 'title', 'subject', 'search', 'query', 'message', 'comment', 'note', 'description', 'address', 'street', 'city',
  'country', 'company', 'customer', 'product', 'reference', 'invoice', 'order', 'account', 'username', 'user', 'code', 'tag', 'label', 'keyword',
  'answer', 'reply', 'greeting', 'caption', 'heading', 'date', 'time', 'file', 'folder', 'email', 'phone', 'url', 'link']);
const HINT_NUMBER = new Set(['amount', 'price', 'total', 'quantity', 'count', 'cost', 'fee', 'balance', 'payment', 'year', 'age', 'invoice', 'order',
  'account', 'reference', 'code', 'phone']);
function hintOf(title, group) {
  const vocab = group === 'number' ? HINT_NUMBER : HINT_TEXT;
  const known = (w) => HINT_TEXT.has(w) || HINT_NUMBER.has(w);
  const words = String(title == null ? '' : title).toLowerCase().split(/[^a-z]+/).filter(Boolean)
    .map((w) => (known(w) ? w : known(w.replace(/s$/, '')) ? w.replace(/s$/, '') : known(w.replace(/es$/, '')) ? w.replace(/es$/, '') : w));
  let i = -1;
  for (let j = 0; j < words.length; j++) if (vocab.has(words[j])) i = j;
  if (i < 0) return '';
  const name = i > 0 && known(words[i - 1]) && words[i - 1] !== words[i] ? words[i - 1] + '_' + words[i] : words[i];
  return VALUE_NAME.test(name) && name !== 'secret' ? name : '';
}

// Not in the middle of a word, nor of a number: "Save" is not in "Saved", "100" not in "100.50", "234" not in "1,234".
function apart(s, a, z) {
  const at = (i) => (i >= 0 && i < s.length ? s[i] : '');
  if (WORDCH.test(at(a)) && WORDCH.test(at(a - 1))) return false;
  if (WORDCH.test(at(z - 1)) && WORDCH.test(at(z))) return false;
  if (DIGIT.test(at(a)) && /[.,]/.test(at(a - 1)) && DIGIT.test(at(a - 2))) return false;
  if (DIGIT.test(at(z - 1)) && /[.,]/.test(at(z)) && DIGIT.test(at(z + 1))) return false;
  return true;
}
// A text as the serve reads the screen (core/agent-eyes.js norm, findWord): lowercase, a run of spaces as one -- and,
// for each of its characters, where it came from, so a match found here is cut from the original.
function fold(s) {
  let text = '', gap = false;
  const at = [];
  for (let i = 0; i < s.length;) {
    const ch = String.fromCodePoint(s.codePointAt(i));
    if (/\s/u.test(ch)) { if (!gap) { text += ' '; at.push(i); } gap = true; }
    else { const l = ch.toLowerCase(); for (let k = 0; k < l.length; k++) at.push(i); text += l; gap = false; }
    i += ch.length;
  }
  at.push(s.length);
  return { text, at };
}
// `s` with {{name}} where values' texts are in it: longest first, never overlapping. mode 'typed': exactly as typed;
// 'check' and 'read': as the serve reads the screen (fold) -- a check of any length when it reads exactly the value,
// otherwise (and every read) only a value of 3 characters or more. `under`: only values shorter than that.
function link(s, cands, mode, under) {
  const loose = mode !== 'typed', hits = [], S = loose ? fold(s) : null;
  for (const w of cands) {
    if (under && w.text.length >= under) continue;
    const core = loose ? w.text.trim() : w.text;
    if (!core || !ALNUM.test(core) || core !== core.trim()) continue;   // " Acme" inside "Acme Corp" would eat its space
    const big = core.length >= 3;
    if (!big && mode !== 'check') continue;
    const want = loose ? (w.folded != null ? w.folded : (w.folded = fold(core).text)) : core, hay = loose ? S.text : s;
    for (let p = hay.indexOf(want); p >= 0; p = hay.indexOf(want, p + want.length)) {
      const a = loose ? S.at[p] : p, z = loose ? S.at[p + want.length] : p + want.length;
      const whole = !s.slice(0, a).trim() && !s.slice(z).trim();
      if (!whole && (!big || !apart(s, a, z))) continue;
      if (hits.some((h) => a < h.z && h.a < z)) continue;
      hits.push({ a, z, w });
    }
  }
  if (!hits.length) return { out: s, used: [] };
  hits.sort((p, q) => p.a - q.a);
  let out = '', at = 0;
  const used = [];
  for (const h of hits) { out += s.slice(at, h.a) + '{{' + h.w.name + '}}'; at = h.z; if (!used.includes(h.w)) used.push(h.w); }
  return { out: out + s.slice(at), used };
}
// places -> "milestone 2: typed, text it clicked; milestone 4: its check" (in the order the job got there)
function whereText(places) {
  const groups = [];
  for (const p of places.slice().sort((a, b) => a.i - b.i)) {
    let g = groups[groups.length - 1];
    if (!g || g.mi !== p.mi) { g = { mi: p.mi, labels: new Map() }; groups.push(g); }
    g.labels.set(p.label, (g.labels.get(p.label) || 0) + 1);
  }
  return groups.map((g) => 'milestone ' + (g.mi + 1) + ': ' + [...g.labels].map(([l, n]) => l + (n > 1 ? ' (×' + n + ')' : '')).join(', ')).join('; ');
}

// THE VALUES OF A PROVEN RUN. Puts {{name}} in its commands and checks (it changes them in place) and answers the
// recipe's `values` list. Pure; never throws on odd commands.
function findValues(milestones) {
  const list = Array.isArray(milestones) ? milestones : [];
  const slots = slotsIn(list);
  const taken = new Set(['secret']);
  const each = (c) => { if (typeof c === 'string') { for (const m of c.matchAll(TOKEN)) taken.add(m[1]); } else if (Array.isArray(c)) c.forEach(each); else if (c && typeof c === 'object') for (const k of Object.keys(c)) each(c[k]); };
  list.forEach((m) => { if (m && typeof m === 'object') { each(m.cmds); each(m.check); } });
  // 1. what was typed: one value per text, however often it was typed
  const vals = [], byText = new Map();
  for (const s of slots) {
    if (s.type !== 'typed') continue;
    const t = s.obj[s.key];
    if (t.indexOf(SECRET) >= 0 || !ALNUM.test(t)) continue;
    let v = byText.get(t);
    if (!v) { v = { text: t, slots: [], opened: false, inside: [], reads: [], checks: [], partly: [] }; byText.set(t, v); vals.push(v); }
    v.slots.push(s);
    if (s.opened) v.opened = true;
  }
  if (!vals.length) return [];
  // 2. its kind and its name
  for (const v of vals) Object.assign(v, shapeOf(v.text, v.opened), { mi: v.slots[0].mi });
  list.forEach((m, mi) => {
    for (const g of ['text', 'number']) {
      const here = vals.filter((v) => v.mi === mi && v.hint === g);
      const h = here.length === 1 ? hintOf(m && m.t, g) : '';
      if (h) here[0].base = h;
    }
  });
  let n = 0;
  for (const v of vals) {
    let name = v.base;
    if (name === 'text') { do name = 'text' + (++n); while (taken.has(name)); }
    else for (let i = 2; taken.has(name); i++) name = v.base.slice(0, 34) + i;
    v.name = name;
    taken.add(name);
  }
  // 3. a value typed again inside a longer text -- a sentence, a URL, a path; never inside a date or a number
  const longest = vals.slice().sort((a, b) => b.text.length - a.text.length);
  for (const v of vals) {
    if (v.atomic) continue;
    const l = link(v.text, longest, 'typed', v.text.length);
    if (!l.used.length) continue;
    v.template = l.out;
    for (const w of l.used) for (const s of v.slots) w.inside.push({ mi: s.mi, i: s.i, label: 'inside ' + (s.opened ? 'the URL it opened' : 'typed text') + ' (' + v.name + ')' });
  }
  // 4. the commands carry its name
  for (const v of vals) for (const s of v.slots) s.obj[s.key] = '{{' + v.name + '}}';
  // 5. PROOF FOLLOWS THE VALUE: a check -- or a word read to act on -- that holds a value's text carries its name too
  for (const s of slots) {
    if (s.type === 'typed') continue;
    const was = s.obj[s.key];
    const l = link(was, longest, s.type);
    if (l.used.length) { s.obj[s.key] = l.out; for (const w of l.used) (s.type === 'check' ? w.checks : w.reads).push(s); continue; }
    const part = squash(was);
    if (part.length >= 3) for (const w of vals) { const all = w.sq != null ? w.sq : (w.sq = squash(w.text)); if (all.length > part.length && all.indexOf(part) >= 0) w.partly.push(s); }
  }
  return vals.map((v) => {
    const o = { name: v.name, default: v.text, kind: v.kind, where: whereText(v.slots.concat(v.inside, v.reads)) };
    if (v.checks.length) o.checks = whereText(v.checks);
    if (v.template) o.template = v.template;
    if (v.partly.length) o.note = 'only part of it is read at ' + whereText(v.partly) + ' -- kept as recorded there, so a new value may not be found or proven there';
    return o;
  });
}

// The text each value stands for in a run: what --set gave it, else its default -- or, for one with others inside it
// (a `template`), the template with theirs, so a sentence follows the date typed in it. `sets` is a Map, or nothing.
function resolver(values, sets) {
  const by = new Map(), memo = new Map(), busy = new Set();
  for (const v of Array.isArray(values) ? values : []) if (v && typeof v === 'object' && typeof v.name === 'string' && VALUE_NAME.test(v.name) && v.name !== 'secret') by.set(v.name, v);
  const get = (name) => {
    if (sets && sets.has(name)) return String(sets.get(name));
    if (memo.has(name)) return memo.get(name);
    const v = by.get(name);
    if (!v) return null;   // not a value of this recipe
    let out = String(v.default == null ? '' : v.default);
    if (typeof v.template === 'string' && !busy.has(name)) { busy.add(name); out = render(v.template); busy.delete(name); }
    memo.set(name, out);
    return out;
  };
  // ONE pass: the text put in is never read again, so a value whose text holds "{{date}}" types exactly that
  const render = (s) => String(s).replace(new RegExp(TOKEN.source, 'g'), (all, name) => (by.has(name) ? get(name) : all));
  return { render, get, names: [...by.keys()] };
}

// A command as this run sends it. A {{secret}} anywhere takes the next secret, in order, as it always has. A value's
// {{name}} is filled only in the fields a value can be in (slotOf) and in a check's text (`has`, under until, expect,
// if or check) -- never in a command line, a path given to a verb, a coordinate.
function fillTree(c, ctx, inCheck) {
  if (Array.isArray(c)) return c.map((x) => fillTree(x, ctx, inCheck));
  if (c === SECRET) return ctx.secret();
  if (!c || typeof c !== 'object') return c;
  const o = {};
  for (const k of Object.keys(c)) {
    const v = c[k];
    if (typeof v === 'string' && v !== SECRET && (inCheck ? k === 'has' : !!slotOf(c, k))) o[k] = ctx.render(v);
    else o[k] = fillTree(v, ctx, inCheck || CHECK_KEYS.has(k));
  }
  return o;
}

const isRecipe = (r) => !!r && r.kind === 'mission-replay' && Array.isArray(r.milestones) && r.milestones.length > 0 &&
  r.milestones.every((m) => m && typeof m === 'object' && Array.isArray(m.cmds));
const NOT_RECIPE = '[x] not a replay recipe (save one with: node drive/replay.js save <serve-dir> <name>)';
// A recipe's values, checked. None at all: a recipe saved before values (old), which runs as it always did.
function valuesIn(r) {
  if (r.values == null) return { ok: true, list: [], old: true };
  if (!Array.isArray(r.values)) return { ok: false, why: '"values" is not a list' };
  const seen = new Set();
  for (const v of r.values) {
    const n = v && typeof v === 'object' && typeof v.name === 'string' ? v.name : '';
    if (!VALUE_NAME.test(n) || n === 'secret') return { ok: false, why: 'a value is named ' + JSON.stringify(v && typeof v === 'object' ? v.name : v) + ' -- a name is lowercase letters, digits and _, and never "secret"' };
    if (seen.has(n)) return { ok: false, why: 'two values are named ' + n };
    if (typeof v.default !== 'string') return { ok: false, why: 'the value ' + n + ' has no default text' };
    seen.add(n);
  }
  return { ok: true, list: r.values };
}
// one value, in words: where it is, which checks follow it, which values are inside it
function valueLine(v) {
  const has = typeof v.template === 'string' ? [...new Set([...v.template.matchAll(TOKEN)].map((m) => m[1]))] : [];
  return String(v.where || '') + (v.checks ? '; its proof follows it: ' + v.checks : '') +
    (has.length ? '; ' + has.join(' and ') + (has.length > 1 ? ' are' : ' is') + ' in it, so setting ' + (has.length > 1 ? 'them' : 'it') + ' changes it too' : '') +
    (v.note ? '; ' + v.note : '');
}
const shown = (s) => JSON.stringify(clip(String(s), 80));

const skillsRoot = () => process.env.SM_SKILLS_DIR || path.join(KIT, 'skills');
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
// A DRAFT is marked between these lines in its README; promoting it takes them out.
const DRAFT_BEGIN = '<!-- draft:begin -->', DRAFT_END = '<!-- draft:end -->';
// ...and the VALUES between these: a skill saved again rewrites that section, the rest of the README is its author's
const VALUES_BEGIN = '<!-- values:begin -->', VALUES_END = '<!-- values:end -->';
const oneLine = (s) => String(s).replace(/[\u0000-\u001f]/g, (c) => (c === '\n' ? '\\n' : c === '\t' ? '\\t' : c === '\r' ? '\\r' : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
function valuesSection(name, r) {
  const vals = Array.isArray(r.values) ? r.values : [];
  if (!vals.length) return [];
  const md = (s) => '`' + clip(oneLine(s), 60).replace(/`/g, "'") + '`';
  return [VALUES_BEGIN, '## Values', '', 'A replay may type other text in their place: `--set <name>=<text>` for each one to change; one not given keeps its default ' +
    '(`node drive/replay.js values skills/' + name + '/replay.json` lists them). A check that reads a value follows it, so the proof holds for the new text.', '']
    .concat(vals.map((v) => '- `' + v.name + '` = ' + md(v.default) + ' (' + v.kind + ') — ' + valueLine(v)), [VALUES_END]);
}

// THE SKILL FOLDER: replay.json, and a README the catalog lists (`node kit.js skills`). A draft -- written by the
// serve itself when a planned job finishes with every milestone proven -- says so at the top, with every piece of
// typed text it stores, for whoever reviews it before it joins the library. Both list the values a replay may change.
function writeSkill(skillDir, name, b, draft) {
  fs.mkdirSync(skillDir, { recursive: true });
  const file = path.join(skillDir, 'replay.json');
  fs.writeFileSync(file, JSON.stringify(b.recipe, null, 1));
  const readme = path.join(skillDir, 'README.md');
  const r = b.recipe, vals = valuesSection(name, r);
  if (!fs.existsSync(readme)) {
    const note = draft ? [DRAFT_BEGIN, '> **Draft — written by the agent** after a job it finished with every milestone proven (' + r.saved.slice(0, 10) + ').',
      '> It is not in the library until a person reviews it: check the typed text below holds nothing private, then',
      '> `node drive/replay.js promote ' + name + '` — and `node kit.js contribute "a skill to …"` to share it.',
      '>', '> Typed text it stores: ' + (b.typed.length ? b.typed.map((t) => '`' + String(t).slice(0, 60).replace(/`/g, "'") + '`').join(', ') : 'none') +
      (r.secrets ? ' — and ' + r.secrets + ' secret(s), never recorded' : ''), DRAFT_END, ''] : [];
    fs.writeFileSync(readme, ['---', 'name: ' + name, 'when: ' + (r.goal || name) + ' -- a proven run, replayed with no driver turns', 'tags: replay, mission',
      'run: node drive/replay.js run skills/' + name + '/replay.json <serve-dir>' + (r.secrets ? ' --secret <text>' + (r.secrets > 1 ? ' (×' + r.secrets + ')' : '') : '') +
      (vals.length ? ' [--set <name>=<text>]...' : ''), '---',
      '# skill: ' + name, ''].concat(note, ['A proven run of “' + r.goal + '”, saved by `drive/replay.js` on ' + r.saved.slice(0, 10) + ' from `' + r.from + '`.',
      'Replaying it posts the plan, runs each milestone\'s commands as one `plan`, and proves the milestone before going on.', '',
      '## Milestones', ''], r.milestones.map((m, i) => (i + 1) + '. ' + m.t + ' — done when ' + m.done + ' (' + m.cmds.length + ' commands)'),
      vals.length ? [''].concat(vals) : []).join('\n') + '\n');
  } else {
    // SAVED AGAIN: the README is its author's now, but what a replay may change is the new recipe's -- the marked
    // section is rewritten (added, when the README has none), so nobody reviews the last recipe's values
    try {
      const t = fs.readFileSync(readme, 'utf8'), a = t.indexOf(VALUES_BEGIN), z = t.indexOf(VALUES_END), sec = vals.join('\n');
      const next = a >= 0 && z > a ? t.slice(0, a) + sec + t.slice(z + VALUES_END.length) : sec ? t.replace(/\s*$/, '\n\n') + sec + '\n' : t;
      if (next !== t) fs.writeFileSync(readme, next);
    } catch (_) {}
  }
  return file;
}

// A job's goal as a skill's name: lowercase words joined by dashes, at most six of them.
function slugOf(goal) {
  const words = String(goal || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
  let s = words.join('-').slice(0, 60).replace(/-+$/, '');
  if (s.length < 2) s = 'a-proven-job';
  return SLUG.test(s) ? s : 'a-proven-job';
}

// A SKILL THAT WRITES ITSELF (the roadmap: "when a new task type is solved, write the skill folder automatically so
// the library grows without being asked"). Called by the serve when a planned job finishes; never throws. Written
// to skills/_drafts/<name>/ -- gitignored, and skipped by the catalog's checks -- because a recipe stores the text
// that was typed, and only a person can tell whether that is private. `promote` puts a reviewed draft in the library.
// Not drafted: a job that a skill already did, a replay of one, or a run with nothing proven to keep.
function draft(dir, opts) {
  try {
    const o = opts || {};
    const b = build(dir);
    if (!b.ok) return { ok: false, why: b.why };
    const name = o.name && SLUG.test(String(o.name)) ? String(o.name) : slugOf(b.recipe.goal);
    if (fs.existsSync(path.join(skillsRoot(), name))) return { ok: false, why: 'the library already has skills/' + name, exists: true };
    const drafts = path.join(skillsRoot(), '_drafts');
    let slug = name;
    for (let i = 2; fs.existsSync(path.join(drafts, slug)) && i < 10; i++) slug = name + '-' + i;
    if (fs.existsSync(path.join(drafts, slug))) return { ok: false, why: 'too many drafts named ' + name };
    const file = writeSkill(path.join(drafts, slug), slug, b, true);
    return { ok: true, name: slug, dir: path.join(drafts, slug), file, milestones: b.recipe.milestones.length, commands: b.commands,
             typed: b.typed.map((t) => String(t).slice(0, 80)), secrets: b.recipe.secrets, stoppedAt: b.stoppedAt || undefined,
             values: b.recipe.values.map((v) => ({ name: v.name, default: String(v.default).slice(0, 80), where: v.where })) };
  } catch (e) { return { ok: false, why: 'the draft could not be written: ' + ((e && e.message) || e) }; }
}

// A reviewed draft joins the library: skills/_drafts/<name> -> skills/<name>, its draft note taken out.
function promote(name, yes) {
  if (!SLUG.test(String(name || ''))) { console.error('[x] a skill name is lowercase words joined by dashes (node drive/replay.js promote <name>)'); return 2; }
  const from = path.join(skillsRoot(), '_drafts', name), to = path.join(skillsRoot(), name);
  if (!fs.existsSync(from)) { console.error('[x] no draft skills/_drafts/' + name + ' (drafts: ' + (fs.existsSync(path.join(skillsRoot(), '_drafts')) ? fs.readdirSync(path.join(skillsRoot(), '_drafts')).join(', ') || 'none' : 'none') + ')'); return 2; }
  if (fs.existsSync(to)) { console.error('[x] skills/' + name + ' already exists -- promote the draft under another name by renaming its folder first'); return 2; }
  let typed = [], values = [];
  try {
    const r = readJson(path.join(from, 'replay.json')), v = valuesIn(r);
    values = v.ok ? v.list : [];
    typed = typedTexts(r.milestones.reduce((a, m) => a.concat(m.cmds || []), []), values);
  } catch (e) { console.error('[x] the draft\'s replay.json cannot be read: ' + e.message); return 2; }
  console.log('[.] skills/_drafts/' + name + ' stores this typed text:' + (typed.length ? '\n    ' + typed.map((t) => JSON.stringify(t.slice(0, 80))).join('\n    ') : ' none'));
  if (values.length) console.log('[.] a replay may type other text for these values (--set <name>=<text>):\n    ' + values.map((v) => v.name + ' = ' + shown(v.default) + ' -- ' + valueLine(v)).join('\n    '));
  if (!yes) { console.log('[.] nothing moved: if none of it is private, run again with --yes'); return 0; }
  fs.renameSync(from, to);
  const readme = path.join(to, 'README.md');
  try {
    const t = fs.readFileSync(readme, 'utf8'), a = t.indexOf(DRAFT_BEGIN), z = t.indexOf(DRAFT_END);
    if (a >= 0 && z > a) fs.writeFileSync(readme, t.slice(0, a) + t.slice(z + DRAFT_END.length).replace(/^\r?\n/, ''));
  } catch (_) {}
  console.log('[+] skills/' + name + ' is in the library -- `node kit.js contribute "a skill to …"` shares it');
  return 0;
}

function save(dir, name) {
  if (!SLUG.test(String(name || ''))) { console.error('a skill name is lowercase words joined by dashes, e.g. send-the-weekly-report'); return 2; }
  const b = build(dir);
  if (!b.ok) { console.error('[x] ' + b.why); return 3; }
  const file = writeSkill(path.join(skillsRoot(), name), name, b, false);
  console.log('[+] saved ' + b.recipe.milestones.length + ' proven milestone(s), ' + b.commands + ' command(s) -> ' + path.relative(KIT, file));
  if (b.stoppedAt) console.log('[.] the run stopped being proven at "' + b.stoppedAt.t + '" (' + b.stoppedAt.s + ') -- the recipe ends before it');
  if (b.recipe.secrets) console.log('[.] ' + b.recipe.secrets + ' secret(s) were not recorded: run it with --secret <text> for each, in order');
  if (b.typed.length) console.log('[!] typed text stored in the recipe -- check nothing private is in it before sharing:\n    ' + b.typed.map((t) => JSON.stringify(t.slice(0, 80))).join('\n    '));
  if (b.recipe.values.length) console.log('[.] ' + b.recipe.values.length + ' value(s) a replay may type other text for, with --set <name>=<text> (node drive/replay.js values ' + path.relative(KIT, file) + '):\n    ' +
    b.recipe.values.map((v) => v.name + ' = ' + shown(v.default) + ' -- ' + valueLine(v)).join('\n    '));
  return 0;
}

// What a replay may change, for a person (or, with --json, a caller such as a trigger that wants the names first).
function listValues(recipeFile, json) {
  let r;
  try { r = readJson(recipeFile); } catch (e) { console.error('[x] cannot read the recipe: ' + e.message); return 2; }
  if (!isRecipe(r)) { console.error(NOT_RECIPE); return 2; }
  const vals = valuesIn(r);
  if (!vals.ok) { console.error('[x] the recipe\'s values cannot be used: ' + vals.why); return 2; }
  const secrets = countSecrets(r.milestones.map((m) => m.cmds));
  if (json) { console.log(JSON.stringify({ values: vals.list, secrets, old: vals.old || undefined })); return 0; }
  if (!vals.list.length) console.log('[.] ' + recipeFile + ' has no values -- ' + (vals.old ? 'it was saved before recipes had them, and runs exactly as recorded' : 'it typed nothing a replay could change'));
  else {
    const w = Math.max(...vals.list.map((v) => v.name.length));
    console.log('[.] ' + vals.list.length + ' value(s) a replay may change: node drive/replay.js run ' + recipeFile + ' <serve-dir> --set <name>=<text> (one not given keeps its default)');
    for (const v of vals.list) console.log('    ' + v.name.padEnd(w) + ' = ' + shown(v.default) + ' (' + (v.kind || 'text') + ') -- ' + valueLine(v));
  }
  if (secrets) console.log('[.] and ' + secrets + ' secret(s), never recorded: --secret <text> for each, in order');
  return 0;
}

// opts: {sets: ['name=text', ...], ignoreUnknown}
function run(recipeFile, dir, secrets, opts) {
  const o = opts || {};
  let r;
  try { r = readJson(recipeFile); } catch (e) { console.error('[x] cannot read the recipe: ' + e.message); return 2; }
  if (!isRecipe(r)) { console.error(NOT_RECIPE); return 2; }
  // THE VALUES, settled before anything runs. A --set naming no value of this recipe is a typo or the wrong recipe, so
  // it is refused, naming the real ones -- unless the caller passes facts a recipe may not use (--ignore-unknown: a
  // trigger hands every recipe the machine, the file and the event, and most use one of them or none).
  const vals = valuesIn(r);
  if (!vals.ok) { console.error('[x] the recipe\'s values cannot be used: ' + vals.why); return 2; }
  const sets = new Map();
  for (const s of o.sets || []) {
    const eq = typeof s === 'string' ? s.indexOf('=') : -1, n = eq > 0 ? s.slice(0, eq) : '';
    if (!/^[A-Za-z_][\w.-]{0,63}$/.test(n)) { console.error('[x] --set takes <name>=<text>, e.g. --set date=2026-11-13 -- not ' + JSON.stringify(s == null ? '' : s)); return 2; }
    if (sets.has(n)) { console.error('[x] --set ' + n + ' is given twice'); return 2; }
    sets.set(n, s.slice(eq + 1));
  }
  const names = vals.list.map((v) => v.name);
  const unknown = [...sets.keys()].filter((n) => !names.includes(n));
  if (unknown.length && !o.ignoreUnknown) {
    console.error('[x] the recipe has no value named ' + unknown.map((n) => '"' + n + '"').join(', ') + ' -- ' +
      (names.length ? 'its values are ' + names.join(', ') : 'it has no values' + (vals.old ? ' (it was saved before recipes had them, and runs as recorded)' : '')) +
      (unknown.includes('secret') ? '. A secret is given with --secret <text>, and never stored' : '') +
      '. Nothing was run. (node drive/replay.js values ' + recipeFile + ' lists them; --ignore-unknown skips a name a recipe does not use)');
    return 2;
  }
  for (const n of unknown) sets.delete(n);
  if (unknown.length) console.log('[.] not values of this recipe, so not used: ' + unknown.join(', '));
  const need = countSecrets(r.milestones.map((m) => m.cmds));
  if (secrets.length < need) { console.error('[x] the recipe types ' + need + ' secret(s) that were never recorded; give each with --secret <text>, in order'); return 3; }
  const val = resolver(vals.list, sets);
  let si = 0;
  const fill = (cmds) => fillTree(cmds, { secret: () => secrets[si++], render: val.render }, false);
  // a check takes values only: a secret is typed, never looked for on the screen
  const proof = (c) => (c ? fillTree(c, { secret: () => SECRET, render: val.render }, true) : c);
  const changed = [...sets.keys()];
  const send = (cmd) => { try { return exchange(dir, cmd); } catch (e) { return { ok: false, why: e.message, dead: true }; } };
  const plan = send({ do: 'mission', op: 'plan', why: 'replaying a proven run' + (changed.length ? ', with other values for ' + changed.join(', ') : ''), replay: 1, plan: { goal: r.goal, done: r.done || undefined,
    milestones: r.milestones.map((m) => ({ t: m.t, done: m.done, check: proof(m.check) || undefined, steps: m.steps && m.steps.length ? m.steps : undefined })) } });
  if (!plan.ok) { console.error('[x] the plan was not accepted: ' + plan.why); return 3; }
  console.log('[+] replaying "' + r.goal + '": ' + r.milestones.length + ' milestone(s)' + (changed.length ? ', with ' + changed.join(', ') + ' set (every other value as recorded)' : ''));
  for (let i = 0; i < r.milestones.length; i++) {
    const m = r.milestones[i], tag = '[' + (i + 1) + '/' + r.milestones.length + '] ' + m.t;
    if (m.cmds.length) {
      const res = send({ do: 'plan', steps: fill(m.cmds), intent: m.t });
      if (!res.ok) {
        const at = res.stoppedAt ? ' at step ' + ((Number(res.stoppedAt.at) || 0) + 1) + (res.stoppedAt.why ? ' (' + res.stoppedAt.why + ')' : '') : '';
        console.error('[x] ' + tag + ': its actions failed' + at + ': ' + (res.why || 'no reason given'));
        send({ do: 'mission', op: 'fail', m: m.t, why: 'the replay\'s actions failed' + at });
        return 4;
      }
    }
    // PROOF, as the mission demands: the milestone's own check, else the last check the original run made here,
    // else a picture of it shown to the room -- a check that reads a value looking for this run's text
    const check = proof(m.check || lastCheck(m.cmds));
    let ach;
    if (check) ach = send({ do: 'mission', op: 'achieve', m: m.t, check, timeout: 8000 });
    else {
      const pic = path.join(dir, 'replay-proof-' + (i + 1) + '.png');
      const lk = send({ do: 'look', out: pic, max: 400 });
      ach = lk.ok ? send({ do: 'mission', op: 'achieve', m: m.t, file: pic }) : lk;
    }
    if (!ach.ok) { console.error('[x] ' + tag + ': not proven: ' + (ach.why || 'the check did not hold')); return 5; }
    console.log('[+] ' + tag + ' -- achieved');
  }
  const fin = send({ do: 'mission', op: 'finish' });
  console.log(fin.ok ? '[+] done: every milestone achieved' : '[.] every milestone achieved, but finishing said: ' + fin.why);
  return 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args[0];
  const secrets = [], sets = [], pos = [];
  let yes = false, ignoreUnknown = false, json = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--secret') secrets.push(String(args[++i] == null ? '' : args[i]));
    else if (a === '--set') sets.push(args[++i] == null ? null : String(args[i]));   // a bare --set at the end is refused by run
    else if (a === '--ignore-unknown') ignoreUnknown = true;
    else if (a === '--yes') yes = true;
    else if (a === '--json') json = true;
    else pos.push(a);
  }
  let code = 2;
  if (mode === 'save' && pos.length === 2) code = save(pos[0], pos[1]);
  else if (mode === 'run' && pos.length === 2) code = run(pos[0], pos[1], secrets, { sets, ignoreUnknown });
  else if (mode === 'values' && pos.length === 1) code = listValues(pos[0], json);
  else if (mode === 'promote' && pos.length === 1) code = promote(pos[0], yes);
  else console.error('usage:\n  node drive/replay.js save <serve-dir> <skill-name>\n  node drive/replay.js run <replay.json> <serve-dir> [--secret <text>]... [--set <name>=<text>]... [--ignore-unknown]\n' +
    '  node drive/replay.js values <replay.json> [--json]\n  node drive/replay.js promote <draft-name> [--yes]');
  process.exit(code);
}

module.exports = { build, lastCheck, countSecrets, draft, promote, slugOf, findValues, resolver };

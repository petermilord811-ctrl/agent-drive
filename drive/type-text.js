#!/usr/bin/env node
'use strict';
// @tool type text RELIABLY -- one keystroke per command, so a host that DROPS characters on a `keys` burst keeps every one
// @run  node drive/type-text.js ./work "the exact text to type"
// type-text -- reliable keyboard entry for a host whose `keys {text}` loses characters on a multi-character burst.
//
// WHY. On some hosts (first seen driving a KDE / Ubuntu desktop, machine 10005) a single `keys {text:"19.99"}`
// landed only "19", and a Shift character like "*" wedged the modifier so the rest of the burst was swallowed
// too. Sending ONE character per `keys` command -- each its own cmd/done round trip, so the host paces itself
// and releases every modifier between presses -- lands every character: an invoice of ~160 characters typed
// perfectly this way after the whole-string form had dropped digits. Newlines become an Enter press and tabs
// a Tab press (so forms and spreadsheets work), a lone carriage return is ignored. Pure; it uses the very
// same cmd.json/done.json channel drive.js uses, so it needs a session held open by agent-join.js --serve.
//
//   node drive/type-text.js ./work "subtotal = 174.48"
//   node drive/type-text.js ./work "name" ; node drive/type-text.js ./work $'line one\nline two'
//   printf 'a\tb\tc\n' | node drive/type-text.js ./work -          # read the text from stdin ("-")
//   node drive/type-text.js ./work "slow host" --delay 15          # add 15ms after each key if the host still drops
//   node drive/type-text.js ./work "casey@example.com" --intent "Enter the email"   # name it on the panel
//   node drive/type-text.js ./work "play2048.co" --show                           # show WHAT was typed
//
// ON THE PANEL: one command per character used to mean one bare "Typing" line per character. The serve's
// action tree (core/action-tree.js) now MERGES the run into ONE described row -- "Typed 17 characters" --
// and `--intent` (sent on every key) names it: "Enter the email — typed 17 characters". The TEXT itself
// stays off the panel by default: every watcher sees it, and later joiners get it replayed, so a password
// typed into a masked field must not appear there. `--show` opts a harmless text in (a search term, a plain
// address: "Typed 'play2048.co'" -- a URL's query, credentials and token-like parts are dropped even then);
// `--secret` keeps it hidden whatever else is set.
//
// Returns JSON {ok, chars, keys, sent, fails}. It guarantees INJECTION, not rendering -- verify the result on
// screen the way any typing is verified (a shot / crop), since a blind sequence is still a blind sequence.
const fs = require('fs');
const { exchange } = require('../core/cmd-file.js');

const nap = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(ms, 5000)); };

// The command one character becomes: newline -> Enter, tab -> Tab, carriage return -> skip, else a one-char keys.
function keyFor(ch) {
  if (ch === '\n') return { do: 'press', code: 'Enter' };
  if (ch === '\t') return { do: 'press', code: 'Tab' };
  if (ch === '\r') return null;
  return { do: 'keys', text: ch };
}

// Type `text` into the focused field, one keystroke per command. opts.delay = ms paused after each key
// (default 0 -- the round trip already paces; raise it only if a host still drops); opts.intent = the
// panel's name for this typing (rides every key); opts.show = let the panel show the text itself;
// opts.secret = never show it. Returns a summary; `ok` is true only when every keystroke's command
// answered without ok:false.
function typeText(dir, text, opts) {
  const o = opts || {};
  const delay = Number(o.delay) || 0;
  const intent = (typeof o.intent === 'string' && o.intent.trim()) ? o.intent.trim().slice(0, 70) : '';
  const show = !!o.show && !o.secret, secret = !!o.secret;
  const s = String(text == null ? '' : text);
  let keys = 0, sent = 0;
  const fails = [];
  for (let i = 0; i < s.length; i++) {
    const cmd = keyFor(s[i]);
    if (!cmd) continue;
    if (intent) cmd.intent = intent;
    if (show) cmd.show = 1;
    if (secret) cmd.secret = 1;
    keys++;
    let r;
    try { r = exchange(dir, cmd); } catch (e) { r = { ok: false, why: e.message }; }
    if (r && r.ok === false) fails.push({ i, ch: s[i], why: r.why });
    else sent++;
    nap(delay);
  }
  return { ok: fails.length === 0, chars: s.length, keys, sent, fails };
}

module.exports = { typeText, keyFor };

if (require.main === module) {
  const dir = process.argv[2];
  let text = process.argv[3];
  const di = process.argv.indexOf('--delay');
  const delay = di > -1 ? Number(process.argv[di + 1]) : 0;
  const ii = process.argv.indexOf('--intent');
  const intent = ii > -1 ? String(process.argv[ii + 1] || '') : '';
  const show = process.argv.includes('--show'), secret = process.argv.includes('--secret');
  if (!dir || text === undefined) {
    console.error('usage: node type-text.js <work-dir> "<text>" [--delay ms] [--intent "<panel name>"] [--show | --secret]   ("-" as the text reads it from stdin)');
    process.exit(2);
  }
  if (text === '-') { try { text = fs.readFileSync(0, 'utf8'); } catch (_) { text = ''; } }
  const res = typeText(dir, text, { delay, intent, show, secret });
  process.stdout.write(JSON.stringify(res) + '\n');
  process.exit(res.ok ? 0 : 1);
}

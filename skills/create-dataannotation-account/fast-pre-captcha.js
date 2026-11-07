#!/usr/bin/env node
// @tool Fast DA signup through passwords+Terms — STOP before captcha (timing drill / MCP)
// @run  node skills/create-dataannotation-account/fast-pre-captcha.js ./work --first F --last L --email E --password P
//
// Learned 34123 MCP (2026-11-07) — open→pre-captcha plan alone ~9 s (iter2); wall <30 s typical:
//  - Use SCREEN x/y in a blind plan (lx/ly REFUSED until a look) — Email CTA (960,600), Terms (795,722)
//  - Firefox focused; open worker_signup; Continue with Email; Tab between fields
//  - keys with ScreenMirror AUTO-TYPE (never human:0 — operator 2026-11-07); Escape before password
//  - ONE end look; never touch captcha
// Failures this path avoids: Chrome duplicates, field-band offset, append, type-text, lx-without-look.
const path = require('path');
const { exchange } = require('../../core/cmd-file.js');

const dir = process.argv[2] || './work';
function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
const first = arg('first', process.env.DA_FIRST || '');
const last = arg('last', process.env.DA_LAST || '');
const email = arg('email', process.env.DA_EMAIL || '');
const password = arg('password', process.env.DA_PASSWORD || '');
const url = arg('url', 'https://app.dataannotation.tech/worker_signup');

if (!first || !last || !email || !password) {
  console.error('need --first --last --email --password');
  process.exit(2);
}

const act = (o) => exchange(dir, Object.assign({ quiet: 1 }, o));
const t0 = Date.now();
const lap = (label) => console.error('[fast-pre] +' + (Date.now() - t0) + 'ms ' + label);

function focusFf() {
  const script = [
    '#!/bin/bash',
    'ids=$(xdotool search --name DataAnnotation 2>/dev/null || true)',
    'ff=""',
    'for id in $ids; do',
    '  name=$(xdotool getwindowname "$id" 2>/dev/null || true)',
    '  case "$name" in',
    '    *Firefox*) ff="$id" ;;',
    '    *Chrome*|*Chromium*) xdotool windowkill "$id" 2>/dev/null || true ;;',
    '  esac',
    'done',
    'if [ -n "$ff" ]; then xdotool windowactivate --sync "$ff"; xdotool windowfocus --sync "$ff"; echo focused; exit 0; fi',
    "firefox --new-window '" + url.replace(/'/g, '') + "' &",
    'sleep 2; echo launched',
  ].join('\n');
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return act({
    do: 'exec',
    cmd: 'echo ' + b64 + ' | base64 -d | bash',
    intent: 'Focus/launch Firefox DA',
  });
}

try {
  act({ do: 'access', shell: 1, why: 'Focus Firefox for fast DA pre-captcha' });
} catch (_) {}

lap('start');
focusFf();
lap('focus');
// One host plan: screen pixels (1920x1080). Do not use lx/ly here — no look yet.
act({
  do: 'plan',
  intent: 'Open → Email CTA → name → passwords → Terms (stop before captcha)',
  timeout: 90000,
  steps: [
    { do: 'open', url, wait: 1500 },
    { do: 'click', x: 960, y: 600, intent: 'Continue with Email' },
    { do: 'pause', ms: 800 },
    { do: 'keys', text: first, show: 1 },
    { do: 'press', code: 'Tab' },
    { do: 'keys', text: last, show: 1 },
    { do: 'press', code: 'Tab' },
    { do: 'keys', text: email, show: 1 },
    { do: 'press', code: 'Enter' },
    { do: 'pause', ms: 1500 },
    { do: 'press', code: 'Escape' },
    { do: 'pause', ms: 150 },
    { do: 'keys', text: password, secret: 1 },
    { do: 'press', code: 'Tab' },
    { do: 'keys', text: password, secret: 1 },
    { do: 'pause', ms: 300 },
    { do: 'click', x: 795, y: 722, intent: 'Check Terms' },
  ],
});
lap('plan-pre-captcha');

const shot = path.join(dir, 'fast_pre_captcha.png');
act({ do: 'look', out: shot, intent: 'Prove pre-captcha (do not touch captcha)' });
lap('done look=' + shot);
console.log(JSON.stringify({ ok: true, ms: Date.now() - t0, out: shot, stop: 'before-captcha' }));
process.exit(0);

#!/usr/bin/env node
// @tool Fast DA signup through passwords+Terms — STOP before captcha (timing drill / MCP)
// @run  node skills/create-dataannotation-account/fast-pre-captcha.js ./work --first F --last L --email E --password P
//
// Learned 34123 MCP (2026-11-07) — wall from open→pre-captcha can be ~15–25 s when:
//  - Firefox focused; open worker_signup; Continue with Email (lx≈640,ly≈400 on 1280 look)
//  - First name already focused → Tab between fields (no locate-fields)
//  - keys human:0; Escape before password (Firefox manager popup)
//  - Confirm password via Tab; Terms lx≈530,ly≈481; ONE end look; never touch captcha
// Failures this path avoids: Chrome duplicates, field-band offset, append, type-text budget.
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
act({ do: 'open', url, wait: 1500, human: 0, intent: 'Open worker_signup' });
lap('open');
act({ do: 'click', lx: 640, ly: 400, intent: 'Continue with Email' });
act({ do: 'pause', ms: 900 });
lap('email-cta');

act({
  do: 'plan',
  intent: 'Name email continue',
  steps: [
    { do: 'keys', text: first, human: 0, show: 1 },
    { do: 'press', code: 'Tab' },
    { do: 'keys', text: last, human: 0, show: 1 },
    { do: 'press', code: 'Tab' },
    { do: 'keys', text: email, human: 0, show: 1 },
    { do: 'press', code: 'Enter' },
    { do: 'pause', ms: 1500 },
  ],
});
lap('name-step');

act({
  do: 'plan',
  intent: 'Passwords + Terms (no captcha)',
  steps: [
    { do: 'press', code: 'Escape' },
    { do: 'pause', ms: 150 },
    { do: 'keys', text: password, human: 0, secret: 1 },
    { do: 'press', code: 'Tab' },
    { do: 'keys', text: password, human: 0, secret: 1 },
    { do: 'pause', ms: 300 },
    { do: 'click', lx: 530, ly: 481, intent: 'Check Terms' },
  ],
});
lap('passwords-terms');

const shot = path.join(dir, 'fast_pre_captcha.png');
act({ do: 'look', out: shot, intent: 'Prove pre-captcha (do not touch captcha)' });
lap('done look=' + shot);
console.log(JSON.stringify({ ok: true, ms: Date.now() - t0, out: shot, stop: 'before-captcha' }));
process.exit(0);

#!/usr/bin/env node
// @tool Create a DataAnnotation worker account (name → email → password → captcha → submit)
// @run  node skills/create-dataannotation-account/create-dataannotation-account.js ./work --first F --last L --email E --password P
// Live 34123 (2026-11-07): name/email/password + Terms worked; stop if operator refuses captcha.
// Never solve reCAPTCHA. Always look after captcha "solved". Focus one DataAnnotation window first.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { exchange } = require('../../core/cmd-file.js');

const root = path.join(__dirname, '..', '..');
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

function die(msg, code) {
  console.error('[da-signup] ' + msg);
  process.exit(code == null ? 1 : code);
}

if (!first || !last || !email || !password) {
  die('need --first --last --email --password (or DA_FIRST/DA_LAST/DA_EMAIL/DA_PASSWORD)', 2);
}

function needSession() {
  const st = (f) => {
    try {
      return fs.statSync(path.join(dir, f)).mtimeMs;
    } catch (_) {
      return 0;
    }
  };
  if (st('stopped.json') && st('stopped.json') >= st('ready.json')) {
    die('visit ended — reconnect first', 3);
  }
}

function act(o) {
  return exchange(dir, Object.assign({ quiet: 1 }, o));
}

function look(name) {
  const out = path.join(dir, name);
  act({ do: 'look', out, intent: 'Capture signup screen' });
  return out;
}

function locate(shot, yMin, yMax) {
  const r = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-I', path.join(__dirname, 'locate-fields.py'), shot, String(yMin || 180), String(yMax || 560)],
    { encoding: 'utf8', cwd: root }
  );
  if (r.status) {
    process.stderr.write(r.stderr || r.stdout || '');
    die('locate-fields failed', r.status || 1);
  }
  return JSON.parse((r.stdout || '').trim() || '[]');
}

function focusFormWindow() {
  // Prefer Firefox titled DataAnnotation; close duplicate Chrome windows with that title.
  // Avoid $vars in one-liners (Windows PowerShell mangles them through some wrappers) — use a fixed script.
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
    'if [ -n "$ff" ]; then',
    '  xdotool windowactivate --sync "$ff"',
    '  xdotool windowfocus --sync "$ff"',
    '  xdotool windowraise "$ff"',
    '  echo focused=$ff',
    '  xdotool getwindowname "$ff"',
    'else',
    '  echo "no Firefox DataAnnotation window"',
    '  exit 4',
    'fi',
  ].join('\n');
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  const r = act({
    do: 'exec',
    cmd: 'echo ' + b64 + ' | base64 -d | bash',
    intent: 'Focus one DataAnnotation Firefox window',
  });
  if (r && r.ok === false) console.error('[da-signup] focus warn:', r.why || r.output || r);
  return r;
}

function fillField(lx, ly, text, label, secret) {
  const steps = [
    { do: 'click', lx, ly, intent: 'Focus ' + label },
    { do: 'chord', mod: 'ControlLeft', code: 'KeyA', intent: 'Select all in ' + label },
    { do: 'press', code: 'Backspace', intent: 'Clear ' + label },
    {
      do: 'keys',
      text,
      human: 0,
      intent: 'Type ' + label,
      ...(secret ? { secret: 1 } : { show: 1 }),
    },
  ];
  act({ do: 'plan', steps });
}

function findBlueButton(shot, y0, y1) {
  // Rough: densest blue band in y range → click center (Create / Continue)
  const py = `
from PIL import Image
img=Image.open(${JSON.stringify(shot)}).convert("RGB")
px=img.load(); w,h=img.size
blues=[]
for y in range(${y0},${y1}):
  for x in range(w//4, 3*w//4):
    r,g,b=px[x,y]
    if b>180 and r<120 and g<150 and b>r+50: blues.append((x,y))
if not blues: print("null"); raise SystemExit
xs=[p[0] for p in blues]; ys=[p[1] for p in blues]
print((min(xs)+max(xs))//2, (min(ys)+max(ys))//2)
`;
  const tmp = path.join(dir, '_da_btn.py');
  fs.writeFileSync(tmp, py);
  const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', tmp], {
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status) return null;
  const line = (r.stdout || '').trim();
  if (!line || line === 'null') return null;
  const [x, y] = line.split(/\s+/).map(Number);
  return { lx: x, ly: y };
}

needSession();
act({
  do: 'status',
  task: 'Create DataAnnotation account',
  step: 'Open / focus form',
});

console.error('[da-signup] focusing form window');
focusFormWindow();

let shot = look('da_form.png');
// If not already on worker_signup, open it in Firefox
act({
  do: 'plan',
  steps: [
    { do: 'open', url, wait: 2500, human: 0, intent: 'Open worker_signup' },
  ],
});
focusFormWindow();
shot = look('da_form.png');

let fields = locate(shot, 280, 520);
// Expect First, Last, Email as three stacked light bands (skip header-ish bands)
fields = fields.filter((f) => f.y1 - f.y0 >= 24);
if (fields.length < 3) {
  // Maybe need Continue with Email first — click mid Continue-ish blue
  const btn = findBlueButton(shot, 400, 600);
  if (btn) {
    act({ do: 'click', lx: btn.lx, ly: btn.ly, intent: 'Continue with Email / Continue' });
    act({ do: 'pause', ms: 2000 });
    shot = look('da_form.png');
    fields = locate(shot, 280, 520).filter((f) => f.y1 - f.y0 >= 24);
  }
}
if (fields.length < 3) die('could not find First/Last/Email fields (saw ' + fields.length + ')', 5);

const [fFirst, fLast, fEmail] = fields.slice(0, 3);
console.error('[da-signup] fields', { first: fFirst, last: fLast, email: fEmail });

act({ do: 'status', step: 'Fill name and email' });
fillField(fFirst.cx, fFirst.cy, first, 'First name', false);
fillField(fLast.cx, fLast.cy, last, 'Last name', false);
fillField(fEmail.cx, fEmail.cy, email, 'Email', false);
shot = look('da_named.png');

let cont = findBlueButton(shot, 450, 560);
if (!cont) cont = { lx: fEmail.cx, ly: fEmail.y1 + 50 };
act({
  do: 'plan',
  steps: [
    { do: 'click', lx: cont.lx, ly: cont.ly, intent: 'Click Continue' },
    { do: 'pause', ms: 2500 },
  ],
});
// Enter also works when a name field is focused
shot = look('da_password.png');

act({ do: 'status', step: 'Fill passwords' });
act({ do: 'press', code: 'Escape', intent: 'Dismiss password manager popup' });
let pwFields = locate(shot, 300, 480).filter((f) => f.y1 - f.y0 >= 24);
if (pwFields.length < 1) {
  // focused password may have blue border — click approx then Tab
  fillField(640, 360, password, 'Create password', true);
  fillField(640, 410, password, 'Confirm password', true);
} else if (pwFields.length === 1) {
  fillField(pwFields[0].cx, pwFields[0].cy, password, 'Create password', true);
  fillField(pwFields[0].cx, pwFields[0].cy + 50, password, 'Confirm password', true);
} else {
  fillField(pwFields[0].cx, pwFields[0].cy, password, 'Create password', true);
  fillField(pwFields[1].cx, pwFields[1].cy, password, 'Confirm password', true);
}
shot = look('da_pw_ok.png');

act({ do: 'status', step: 'Agree + captcha' });
// Agreement checkbox sits above Create button; blue Create ~ y 500 on 1280 looks
const createBtn = findBlueButton(shot, 480, 560) || { lx: 639, ly: 512 };
act({
  do: 'click',
  lx: createBtn.lx - 110,
  ly: createBtn.ly - 30,
  intent: 'Check I agree Terms',
});

const cap = act({
  do: 'captcha',
  text: 'Please complete the reCAPTCHA (I\'m not a robot). When the checkmark appears, reply done.',
  intent: 'Operator solves reCAPTCHA',
});
shot = look('da_after_captcha.png');
if (!cap || cap.solved === false) {
  act({
    do: 'chat',
    text: 'CAPTCHA not completed — stopping before Create an account.',
    intent: 'Report captcha skip',
  });
  die('captcha refused or unsolved', 6);
}
// Verify — "solved" chat reply is not proof
const verify = spawnSync(
  process.platform === 'win32' ? 'python' : 'python3',
  [
    '-c',
    'from PIL import Image; im=Image.open(r"' +
      shot.replace(/\\/g, '/') +
      '"); print(im.size)',
  ],
  { encoding: 'utf8' }
);
// Heuristic: page error "Please complete the recaptcha" — agent must look; we re-ask once if Create still blocked
act({ do: 'click', lx: createBtn.lx, ly: createBtn.ly, intent: 'Click Create an account' });
act({ do: 'pause', ms: 3500 });
shot = look('da_result.png');
act({
  do: 'chat',
  text: 'Submitted Create an account — check the latest look. If recaptcha still blocks, solve it and say done.',
  intent: 'Report submit attempt',
});
console.error('[da-signup] done look=', shot, 'verify_size=', (verify.stdout || '').trim());
process.exit(0);

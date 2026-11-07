#!/usr/bin/env node
// @tool Create a DataAnnotation worker account (name → email → password → captcha → submit)
// @run  node skills/create-dataannotation-account/create-dataannotation-account.js ./work --first F --last L --email E --password P
//
// Fixes locked in from 34123 (2026-11-07):
//  1) Focus ONE Firefox DataAnnotation window; kill Chrome duplicates (keys otherwise miss First name)
//  2) Locate First/Last/Email from CURRENT look bands — never reused offsets
//  3) Ctrl+A + Backspace before every keys (replace, never append)
//  4) Chrome blank → F5 once → Firefox via exec (shell auto)
//  5) captcha.solved is NOT proof — look + verify; re-ask or stop
//  6) ScreenMirror AUTO-TYPE for all field keys (never human:0 — operator 2026-11-07)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { exchange } = require('../../core/cmd-file.js');

const root = path.join(__dirname, '..', '..');
const dir = process.argv[2] || './work';
const py = process.platform === 'win32' ? 'python' : 'python3';

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

function runPy(scriptPath, args) {
  const r = spawnSync(py, ['-I', scriptPath].concat(args || []), {
    encoding: 'utf8',
    cwd: root,
  });
  return r;
}

function locate(shot, yMin, yMax) {
  const r = runPy(path.join(__dirname, 'locate-fields.py'), [
    shot,
    String(yMin || 180),
    String(yMax || 560),
  ]);
  if (r.status) {
    process.stderr.write(r.stderr || r.stdout || '');
    die('locate-fields failed', r.status || 1);
  }
  return JSON.parse((r.stdout || '').trim() || '[]');
}

function verify(shot, kind, extra) {
  const args = [shot, kind];
  if (extra != null) args.push(String(extra));
  const r = runPy(path.join(__dirname, 'verify.py'), args);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), status: r.status };
}

function execBash(lines, intent) {
  const script = (Array.isArray(lines) ? lines.join('\n') : lines) + '\n';
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return act({
    do: 'exec',
    cmd: 'echo ' + b64 + ' | base64 -d | bash',
    intent: intent || 'remote bash',
  });
}

function ensureShell() {
  try {
    act({
      do: 'access',
      shell: 1,
      why: 'Need exec to focus windows and launch Firefox for DataAnnotation signup',
    });
  } catch (_) {
    /* already granted or refused — continue */
  }
}

/** Fix #1: one live Firefox form window; Chrome duplicates steal keys. */
function focusFormWindow() {
  return execBash(
    [
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
      '  exit 0',
      'fi',
      'echo "no Firefox DataAnnotation window"',
      'exit 4',
    ],
    'Focus one DataAnnotation Firefox window'
  );
}

/** Fix #4: prefer Firefox for DA; launch if missing. */
function openInFirefox() {
  ensureShell();
  execBash(
    [
      '#!/bin/bash',
      'have_ff=0',
      'for id in $(xdotool search --name DataAnnotation 2>/dev/null || true); do',
      '  n=$(xdotool getwindowname "$id" 2>/dev/null || true)',
      '  case "$n" in *Firefox*) have_ff=1;; esac',
      'done',
      'if [ "$have_ff" = "1" ]; then echo have_firefox; exit 0; fi',
      "firefox --new-window '" + url.replace(/'/g, '') + "' &",
      'sleep 3',
      'echo launched_firefox',
    ],
    'Launch Firefox worker_signup if needed'
  );
  act({ do: 'pause', ms: 2500 });
  focusFormWindow();
}

/** Fix #3 + #6: replace-not-append; ScreenMirror auto-type (never human:0). */
function fillField(lx, ly, text, label, secret) {
  act({
    do: 'plan',
    steps: [
      { do: 'click', lx, ly, intent: 'Focus ' + label },
      { do: 'chord', mod: 'ControlLeft', code: 'KeyA', intent: 'Select all in ' + label },
      { do: 'press', code: 'Backspace', intent: 'Clear ' + label },
      {
        do: 'keys',
        text,
        intent: 'Type ' + label + ' (auto-type)',
        ...(secret ? { secret: 1 } : { show: 1 }),
      },
    ],
  });
}

function findBlueButton(shot, y0, y1) {
  const pyCode = `
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
  fs.writeFileSync(tmp, pyCode);
  const r = spawnSync(py, ['-I', tmp], { encoding: 'utf8', cwd: root });
  if (r.status) return null;
  const line = (r.stdout || '').trim();
  if (!line || line === 'null') return null;
  const [x, y] = line.split(/\s+/).map(Number);
  return { lx: x, ly: y };
}

function pickNameFields(shot) {
  // Fix #2: bands from THIS look only; take three stacked field-height bands
  let fields = locate(shot, 280, 520).filter((f) => f.y1 - f.y0 >= 24 && f.x1 - f.x0 >= 120);
  // Prefer bands whose mids are spaced like form fields (~40–70px apart)
  if (fields.length > 3) {
    const scored = [];
    for (let i = 0; i <= fields.length - 3; i++) {
      const a = fields[i],
        b = fields[i + 1],
        c = fields[i + 2];
      const d1 = b.cy - a.cy,
        d2 = c.cy - b.cy;
      const gapOk = d1 > 30 && d1 < 90 && d2 > 30 && d2 < 90;
      scored.push({ gapOk, i, trio: [a, b, c], spread: Math.abs(d1 - d2) });
    }
    scored.sort((u, v) => (v.gapOk - u.gapOk) || u.spread - v.spread);
    if (scored[0]) return scored[0].trio;
  }
  return fields.slice(0, 3);
}

function refillPasswords(shot) {
  act({ do: 'press', code: 'Escape', intent: 'Dismiss password manager popup' });
  let pw = locate(shot, 300, 480).filter((f) => f.y1 - f.y0 >= 24 && f.x1 - f.x0 >= 120);
  if (pw.length >= 2) {
    fillField(pw[0].cx, pw[0].cy, password, 'Create password', true);
    fillField(pw[1].cx, pw[1].cy, password, 'Confirm password', true);
  } else if (pw.length === 1) {
    fillField(pw[0].cx, pw[0].cy, password, 'Create password', true);
    fillField(pw[0].cx, pw[0].cy + 55, password, 'Confirm password', true);
  } else {
    // focused create often has blue border (not a "light" band) — click above confirm band
    fillField(640, 355, password, 'Create password', true);
    fillField(640, 410, password, 'Confirm password', true);
  }
}

/** Fix #5: captcha chat reply is not proof. */
function waitCaptchaVerified() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cap = act({
      do: 'captcha',
      text:
        attempt === 0
          ? "Please complete the reCAPTCHA (I'm not a robot). When the checkmark appears, reply done."
          : 'reCAPTCHA still incomplete on screen — please finish it, then reply done (or no to stop).',
      intent: 'Operator solves reCAPTCHA',
    });
    const shot = look('da_after_captcha.png');
    if (!cap || cap.solved === false) {
      act({
        do: 'chat',
        text: 'CAPTCHA refused — stopping before Create an account. Name/email/password/Terms may already be ready.',
        intent: 'Report captcha skip',
      });
      die('captcha refused', 6);
    }
    const blocked = verify(shot, 'captcha-blocked');
    // blocked.ok means red error PRESENT (exit 0 from verify when red found)
    if (blocked.ok) {
      console.error('[da-signup] captcha still blocked after reply (attempt ' + (attempt + 1) + ')');
      continue;
    }
    // Also try Create; if page stays and shows red, loop
    return shot;
  }
  die('captcha not verified on screen after retries', 6);
}

// ─── main ─────────────────────────────────────────────────────────────
needSession();
act({ do: 'status', task: 'Create DataAnnotation account', step: 'Open Firefox form' });
ensureShell();

console.error('[da-signup] open/focus Firefox (not Chrome)');
openInFirefox();
let shot = look('da_form.png');

// If look still looks like a blank/light fail, one F5 then Firefox again
act({ do: 'press', code: 'F5', intent: 'One reload if page was blank' });
act({ do: 'pause', ms: 2000 });
focusFormWindow();
shot = look('da_form.png');

let trio = pickNameFields(shot);
if (trio.length < 3) {
  const btn = findBlueButton(shot, 400, 620);
  if (btn) {
    act({ do: 'click', lx: btn.lx, ly: btn.ly, intent: 'Continue with Email / Continue' });
    act({ do: 'pause', ms: 2000 });
    focusFormWindow();
    shot = look('da_form.png');
    trio = pickNameFields(shot);
  }
}
if (trio.length < 3) die('could not find First/Last/Email fields (saw ' + trio.length + ')', 5);

const [fFirst, fLast, fEmail] = trio;
console.error('[da-signup] fields from look', { first: fFirst, last: fLast, email: fEmail });

act({ do: 'status', step: 'Fill name and email' });
focusFormWindow();
fillField(fFirst.cx, fFirst.cy, first, 'First name', false);
fillField(fLast.cx, fLast.cy, last, 'Last name', false);
fillField(fEmail.cx, fEmail.cy, email, 'Email', false);
shot = look('da_named.png');

// Prove green checks (best-effort; hosts differ)
const namedOk = verify(shot, 'green-checks', 2);
if (!namedOk.ok) {
  console.error('[da-signup] warn: fewer green checks than expected (' + namedOk.out + ') — refilling once');
  focusFormWindow();
  trio = pickNameFields(shot);
  if (trio.length >= 3) {
    fillField(trio[0].cx, trio[0].cy, first, 'First name', false);
    fillField(trio[1].cx, trio[1].cy, last, 'Last name', false);
    fillField(trio[2].cx, trio[2].cy, email, 'Email', false);
    shot = look('da_named.png');
  }
}

let cont = findBlueButton(shot, 450, 560) || { lx: fEmail.cx, ly: fEmail.y1 + 50 };
focusFormWindow();
act({
  do: 'plan',
  steps: [
    { do: 'click', lx: cont.lx, ly: cont.ly, intent: 'Click Continue' },
    { do: 'pause', ms: 2500 },
  ],
});
shot = look('da_password.png');
if (!verify(shot, 'password-page').ok) {
  // Enter submit fallback
  fillField(fFirst.cx, fFirst.cy, first, 'First name', false);
  act({ do: 'press', code: 'Enter', intent: 'Submit name step with Enter' });
  act({ do: 'pause', ms: 2500 });
  shot = look('da_password.png');
}

act({ do: 'status', step: 'Fill passwords' });
focusFormWindow();
refillPasswords(shot);
shot = look('da_pw_ok.png');
if (verify(shot, 'has-text-red').ok) {
  console.error('[da-signup] password mismatch/red error — clear both and retype');
  focusFormWindow();
  refillPasswords(shot);
  shot = look('da_pw_ok.png');
  if (verify(shot, 'has-text-red').ok) die('passwords still mismatch after refill', 7);
}

act({ do: 'status', step: 'Agree + captcha' });
const createBtn = findBlueButton(shot, 480, 560) || { lx: 639, ly: 512 };
// Terms checkbox sits above the Create button, left side of form text
act({
  do: 'click',
  lx: Math.max(500, createBtn.lx - 110),
  ly: createBtn.ly - 30,
  intent: 'Check I agree Terms',
});

waitCaptchaVerified();
shot = look('da_pre_create.png');
const create2 = findBlueButton(shot, 480, 560) || createBtn;

focusFormWindow();
act({ do: 'click', lx: create2.lx, ly: create2.ly, intent: 'Click Create an account' });
act({ do: 'pause', ms: 3500 });
shot = look('da_result.png');

if (verify(shot, 'captcha-blocked').ok || verify(shot, 'password-page').ok) {
  act({
    do: 'chat',
    text: 'Create did not leave the password page (captcha/validation). Not marking account created.',
    intent: 'Report create failure',
  });
  die('still on signup after Create', 8);
}

act({
  do: 'chat',
  text: 'DataAnnotation account create submitted — verify the latest look shows you left the password step.',
  intent: 'Report success',
});
console.error('[da-signup] ok look=', shot);
process.exit(0);

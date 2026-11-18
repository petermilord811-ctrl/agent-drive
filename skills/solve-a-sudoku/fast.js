#!/usr/bin/env node
// @tool open sudoku.com if needed, play master, crop proof — timed end-to-end for the agent workflow
// @run  node skills/solve-a-sudoku/fast.js ./work [master]
// Keeps the model OUT of the loop: one look to decide open vs play, then sudoku.js play, then a jpg proof.
// Verified 34123 (2026-11-07): ~30–40 s total when the board cooperates. Do not add mission chat-wait
// before finish; do not hand-read the grid. Puzzle ≤15 s (fill+check only) is still a stretch on this relay.
// If play hits Game Over from a silent glyph misread, it New-Games once itself — do not hand-fill that board.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { exchange } = require('../../core/cmd-file.js');

const dir = path.resolve(process.argv[2] || './work');
const diff = (process.argv[3] || 'master').toLowerCase();
const root = path.join(__dirname, '..', '..');
const t0 = Date.now();
const log = (s) => console.error('[fast] ' + s);
const act = (o) => exchange(dir, Object.assign({ quiet: 1 }, o));

function needSession() {
  const st = (f) => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { return 0; } };
  if (st('stopped.json') && st('stopped.json') >= st('ready.json')) {
    console.error('[x] visit ended — reconnect first'); process.exit(3);
  }
}

needSession();
act({ do: 'status', task: 'Solve sudoku fast', step: 'Open or play' });

// Is a sudoku.com game (or its win screen) already up? Ask the skill's own classifier (`sudoku.js state`) on
// one full shot. Anything else gets sudoku.com in a NEW tab. Live 65912, 2026-11-18: the screen was the
// person's own page (a Handshake onboarding). The old "mostly light page -> clickText 'sudoku'" test would
// have clicked on THEIR tab, and a sudoku page is mostly light too. sudoku.com/master/ is a 404: Master is /evil/.
const PATHS = { easy: 'easy', medium: 'medium', hard: 'hard', expert: 'expert', master: 'evil', evil: 'evil', extreme: 'extreme' };
const lookOut = path.resolve(dir, 'fast_look.png');
let opened = false, kind = 'other';
try {
  const shot = act({ do: 'shot', out: lookOut });
  if (shot && shot.ok) {
    const st = spawnSync(process.execPath, [path.join(__dirname, 'sudoku.js'), dir, 'state', lookOut], { encoding: 'utf8', cwd: root });
    kind = ((st.stdout || '').trim().split(/\s/)[0]) || 'other';
  }
} catch (e) { log('first look failed: ' + e.message); }
log('screen: ' + kind);
if (kind === 'other') {
  const url = 'https://sudoku.com/' + (PATHS[diff] || 'evil') + '/';
  log('opening ' + url + ' in a new tab');
  act({ do: 'open', url, tab: 1, show: 1, wait: 5000, intent: 'Open sudoku.com in a new tab', why: "leave the person's own tab untouched" });
  opened = true;
}

const openS = (Date.now() - t0) / 1000;
log('pre-play ' + openS.toFixed(1) + 's (opened=' + opened + ')');

const playT0 = Date.now();
const play = spawnSync(process.execPath, [path.join(__dirname, 'sudoku.js'), dir, 'play', diff], {
  encoding: 'utf8', cwd: root, env: process.env
});
process.stdout.write(play.stdout || '');
process.stderr.write(play.stderr || '');
const playS = (Date.now() - playT0) / 1000;
if (play.status) {
  console.error('[fast] play exited ' + play.status + ' after ' + playS.toFixed(1) + 's');
  process.exit(play.status);
}

// Proof crop for chat — no long chat-wait here.
act({ do: 'status', step: 'Proof' });
const proofRaw = path.resolve(dir, 'fast_proof_raw.png');
act({ do: 'shot', out: proofRaw, quiet: 1 });
const proofJpg = path.resolve(dir, 'solved-proof.jpg');
// vision/crop.js: crop.py when Python + Pillow exist, else Windows System.Drawing (65912 had no Python).
const cropped = spawnSync(process.execPath, [path.join(root, 'vision', 'crop.js'), proofRaw, proofJpg, '350,80,950,720', '0.45'], { encoding: 'utf8' });
if (cropped.status) log('proof crop failed: ' + ((cropped.stderr || '').trim() || 'exit ' + cropped.status));
const total = (Date.now() - t0) / 1000;
const say = '**✓ Sudoku solved (fast path)** in **' + total.toFixed(1) + ' s** (pre ' + openS.toFixed(1) + ' · play ' + playS.toFixed(1) + ')\n- Target: play ≤15 s, total ≤120 s';
act({ do: 'status', fin: 1, say, file: proofJpg });
// Puzzle time = play minus "new game …" if present (board already loading counts separately).
const out = (play.stdout || '') + (play.stderr || '');
let puzzle = playS, newGame = 0;
const m = out.match(/new game\s+([\d.]+)\s*s/i);
if (m) { newGame = parseFloat(m[1]); puzzle = Math.max(0, playS - newGame); }
const ok = total <= 120 && puzzle <= 15;
console.log('FAST_TOTAL ' + total.toFixed(1) + 's play ' + playS.toFixed(1) + 's puzzle ' + puzzle.toFixed(1) + 's' +
  (newGame ? ' (newgame ' + newGame.toFixed(1) + 's)' : '') + ' pre ' + openS.toFixed(1) + 's ' + (ok ? 'PASS' : 'MISS'));
fs.appendFileSync(path.join(dir, 'sudoku-runs.jsonl'), JSON.stringify({
  at: new Date().toISOString(), cmd: 'fast', solved: true, total, play: playS, puzzle, newGame, pre: openS, opened, ok
}) + '\n');
process.exit(ok ? 0 : 4);

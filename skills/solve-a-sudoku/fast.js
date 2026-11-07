#!/usr/bin/env node
// @tool open sudoku.com if needed, play master, crop proof — timed end-to-end for the agent workflow
// @run  node skills/solve-a-sudoku/fast.js ./work [master]
// Keeps the model OUT of the loop: one look to decide open vs play, then sudoku.js play, then a jpg proof.
// Verified 34123 (2026-11-07): ~30–40 s total when the board cooperates. Do not add mission chat-wait
// before finish; do not hand-read the grid. Puzzle ≤15 s (fill+check only) is still a stretch on this relay.
// If play hits Game Over from a silent glyph misread, it New-Games once itself — do not hand-fill that board.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { exchange } = require('../../core/cmd-file.js');
const eyes = require('../../core/agent-eyes.js');

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

// Cheap look: is sudoku.com already up?
const lookOut = path.resolve(dir, 'fast_look.png');
act({ do: 'look', out: lookOut, max: 900 });
let opened = false;
try {
  const img = eyes.decode(fs.readFileSync(lookOut));
  // Address bar / content: sample centre; if Firefox new-tab shortcuts, clickText sudoku.
  const mid = eyes.probe(img, Math.round(img.w * 0.35), Math.round(img.rows * 0.45));
  // White-ish new tab vs board (board has dark grid). Heuristic: click sudoku shortcut when page is mostly light.
  let dark = 0, n = 0;
  for (let y = 200; y < Math.min(img.rows, 500); y += 20)
    for (let x = 300; x < Math.min(img.w, 700); x += 20) {
      const h = eyes.probe(img, x, y); n++;
      if (h) {
        const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
        if ((r + g + b) / 3 < 100) dark++;
      }
    }
  if (dark / Math.max(1, n) < 0.05) {
    log('opening sudoku shortcut');
    act({ do: 'clickText', text: 'sudoku', intent: 'Open sudoku.com' });
    act({ do: 'plan', steps: [{ do: 'hold' }, { do: 'hold' }, { do: 'hold' }, { do: 'hold' }] });
    opened = true;
  }
} catch (e) { log('look heuristic failed: ' + e.message); }

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
spawnSync('python', ['-I', path.join(root, 'vision', 'crop.py'), proofRaw, proofJpg, '350,80,950,720', '0.45'], { encoding: 'utf8' });
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

'use strict';
// Every test in tests/, one at a time, and one line each: what CI runs on every pull request (npm test).
// A test is any tests/*.js but this one; it passes when it exits 0. Run one alone with: node tests/<name>.js
//   node tests/run.js [name ...]
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const only = process.argv.slice(2);
const tests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && f !== 'run.js')
  .map((f) => f.slice(0, -3)).filter((n) => !only.length || only.includes(n)).sort();
let failed = 0;
const t0 = Date.now();
for (const t of tests) {
  const s = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, t + '.js')], { encoding: 'utf8', timeout: 10 * 60000, maxBuffer: 64 * 1024 * 1024 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const last = out.trim().split('\n').filter((l) => l.trim()).pop() || '';
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + t.padEnd(14) + String(Math.round((Date.now() - s) / 100) / 10).padStart(6) + ' s   ' + last.trim().slice(0, 100));
  if (!ok) console.log(out.split('\n').filter((l) => /FAIL|Error|error:/.test(l)).slice(0, 12).map((l) => '       ' + l.trim()).join('\n'));
}
console.log((failed ? 'FAIL' : 'ok') + ' -- ' + (tests.length - failed) + ' of ' + tests.length + ' test files passed in ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(failed ? 1 : 0);

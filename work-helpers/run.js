#!/usr/bin/env node
// Survive work/ wipe: copy to work/run.js after join, or call with absolute paths.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const arg = process.argv[2];
if (!arg) { console.error('usage: node run.js <file.json|json>'); process.exit(2); }
const cmd = arg.startsWith('{') || arg.startsWith('[') ? arg : fs.readFileSync(path.isAbsolute(arg) ? arg : path.join(root, arg), 'utf8');
const r = spawnSync(process.execPath, [path.join(root, 'drive', 'drive.js'), path.join(root, 'work'), cmd], { encoding: 'utf8', cwd: root });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status || 0);

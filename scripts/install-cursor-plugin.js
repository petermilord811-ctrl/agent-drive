#!/usr/bin/env node
'use strict';
// Install this kit as a local Cursor plugin with ScreenMirror's mark as the logo.
//
// Cursor only resolves LOCAL plugin logos from a relative path under the plugin folder
// (e.g. assets/logo.png → file://…). data: and https:// logos are dropped for local
// plugins — that is why a wrong logo field shows the generic cube. Re-run this script
// on every machine after clone; then Developer: Reload Window.
//
//   node scripts/install-cursor-plugin.js
//   node scripts/install-cursor-plugin.js --check
const fs = require('fs');
const os = require('os');
const path = require('path');

const KIT = path.resolve(__dirname, '..');
const NAME = 'screenmirror-agent-drive';
const DEST = path.join(os.homedir(), '.cursor', 'plugins', 'local', NAME);
const LOGO_REL = 'assets/logo.png';

const die = (m) => { console.error('install-cursor-plugin: ' + m); process.exit(1); };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, o) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
};
const copyFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

function assertLogoOk(logo) {
  if (typeof logo !== 'string' || !logo.trim()) die('plugin logo is missing');
  const L = logo.trim();
  if (L.includes('://') || path.isAbsolute(L) || L.startsWith('data:')) {
    die('local Cursor plugins need a relative logo path (e.g. assets/logo.png). '
      + 'data:/https:/absolute paths are ignored and the cube icon appears. Got: ' + JSON.stringify(L));
  }
  if (L.includes('..')) die('logo path must stay inside the plugin folder');
}

function check() {
  if (!exists(DEST)) die('not installed at ' + DEST + ' — run: node scripts/install-cursor-plugin.js');
  const manifest = readJson(path.join(DEST, '.cursor-plugin', 'plugin.json'));
  assertLogoOk(manifest.logo);
  const logoFile = path.join(DEST, manifest.logo);
  if (!exists(logoFile)) die('logo file missing: ' + logoFile);
  const mcp = readJson(path.join(DEST, 'mcp.json'));
  const server = mcp.mcpServers && mcp.mcpServers['agent-drive'];
  if (!server || !Array.isArray(server.args) || !server.args[0]) die('mcp.json missing agent-drive args');
  if (!exists(server.args[0])) die('MCP server.js not found: ' + server.args[0]);
  console.log('ok  local Cursor plugin at ' + DEST);
  console.log('    logo   ' + manifest.logo + ' → ScreenMirror mark');
  console.log('    server ' + server.args[0]);
  if (server.env && server.env.SM_ENV_FILE) console.log('    env    ' + server.env.SM_ENV_FILE);
}

function install() {
  const srcLogo = path.join(KIT, 'assets', 'logo.png');
  const srcLogo32 = path.join(KIT, 'assets', 'logo-32.png');
  const srcIcon64 = path.join(KIT, 'mcp', 'icon-64.png');
  const srcManifest = path.join(KIT, '.cursor-plugin', 'plugin.json');
  if (!exists(srcManifest)) die('missing ' + srcManifest);
  if (!exists(srcLogo) && !exists(srcIcon64)) die('missing assets/logo.png (or mcp/icon-64.png)');

  const base = readJson(srcManifest);
  assertLogoOk(base.logo || LOGO_REL);

  // Local install: secrets from this clone's .env (no Cursor variable form required).
  const manifest = {
    name: base.name || NAME,
    version: base.version || '1.0.0',
    description: base.description,
    author: base.author,
    repository: base.repository,
    homepage: base.homepage,
    license: base.license || 'MIT',
    keywords: base.keywords || [],
    logo: LOGO_REL,
    mcpServers: 'mcp.json',
  };
  assertLogoOk(manifest.logo);

  const serverJs = path.join(KIT, 'mcp', 'server.js');
  const envFile = path.join(KIT, '.env');
  if (!exists(serverJs)) die('missing ' + serverJs);

  const mcp = {
    mcpServers: {
      'agent-drive': {
        command: 'node',
        args: [serverJs.split(path.sep).join('/')],
        env: exists(envFile)
          ? { SM_ENV_FILE: envFile.split(path.sep).join('/') }
          : {},
      },
    },
  };

  fs.mkdirSync(path.join(DEST, '.cursor-plugin'), { recursive: true });
  fs.mkdirSync(path.join(DEST, 'assets'), { recursive: true });
  writeJson(path.join(DEST, '.cursor-plugin', 'plugin.json'), manifest);
  writeJson(path.join(DEST, 'mcp.json'), mcp);
  copyFile(exists(srcLogo) ? srcLogo : srcIcon64, path.join(DEST, 'assets', 'logo.png'));
  if (exists(srcLogo32) || exists(path.join(KIT, 'mcp', 'icon-32.png'))) {
    copyFile(exists(srcLogo32) ? srcLogo32 : path.join(KIT, 'mcp', 'icon-32.png'), path.join(DEST, 'assets', 'logo-32.png'));
  }
  fs.writeFileSync(path.join(DEST, 'README.md'),
    '# ' + NAME + '\n\nInstalled by `node scripts/install-cursor-plugin.js` from the agent-drive kit.\n'
    + 'Logo must stay a relative path (`assets/logo.png`). Reload Cursor after install.\n');

  console.log('installed  ' + DEST);
  console.log('logo       ' + LOGO_REL + ' (ScreenMirror — relative path required for local plugins)');
  console.log('server     ' + serverJs);
  if (exists(envFile)) console.log('env        ' + envFile);
  else console.log('warn       no .env yet — copy .env.example to .env and fill SM_JOIN_KEY / SM_RELAY');
  console.log('next       Developer: Reload Window  (or restart Cursor)');
}

if (process.argv.includes('--check')) check();
else if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/install-cursor-plugin.js [--check]');
} else install();

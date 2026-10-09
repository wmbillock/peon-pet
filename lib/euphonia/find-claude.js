'use strict';
// Where is the `claude` CLI? The app is started by launchd, whose PATH is minimal (no ~/.local/bin, no nvm), so a
// bare `spawn('claude')` fails there even though it works in a terminal. Look at PATH first, then the places Claude
// Code installs to. PEON_PET_CLAUDE_BIN overrides everything.
const fs = require('fs');
const os = require('os');
const path = require('path');

const isExecutable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };

function nvmBins(home, readdir = fs.readdirSync) {
  try {
    return readdir(path.join(home, '.nvm', 'versions', 'node'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))   // newest first
      .map((v) => path.join(home, '.nvm', 'versions', 'node', v, 'bin'));
  } catch { return []; }
}

// → absolute path, or null
function findClaude({ env = process.env, home = os.homedir(), exec = isExecutable, readdir = fs.readdirSync } = {}) {
  if (env.PEON_PET_CLAUDE_BIN && exec(env.PEON_PET_CLAUDE_BIN)) return env.PEON_PET_CLAUDE_BIN;
  const dirs = [
    ...String(env.PATH || '').split(path.delimiter).filter(Boolean),
    path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin', ...nvmBins(home, readdir),
  ];
  for (const d of dirs) { const p = path.join(d, 'claude'); if (exec(p)) return p; }
  return null;
}

// PATH for the child: its own directory and the usual install dirs, ahead of whatever the launcher gave us. nvm's node
// directories are included because managed MCP servers (Playwright) start with `npx`, which under launchd is otherwise
// not on PATH and the server dies with "Connection closed".
function childPath(bin, env = process.env, home = os.homedir(), readdir = fs.readdirSync) {
  const extra = [bin && path.isAbsolute(bin) ? path.dirname(bin) : null, path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...nvmBins(home, readdir)].filter(Boolean);   // same places findClaude looks
  return [...new Set([...extra, ...String(env.PATH || '').split(path.delimiter).filter(Boolean)])].join(path.delimiter);
}

module.exports = { findClaude, childPath };

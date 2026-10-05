#!/usr/bin/env node
'use strict';
// Entry point the Claude CLI spawns (see service.js bridgeMcpConfig): node main.js --home <euphonia home> [--firm-url U] [--peon-dir D] [--assets-dir D] [--user-data-dir D]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFirmHttp } = require('./firm-http');
const { createGhRunner } = require('./gh');
const { createAudit } = require('./audit');
const { createTools, createRunner, SERVER } = require('./tools');
const { createMcpServer } = require('./server');
const { applyCosmetics } = require('./cosmetics');

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }

function main() {
  const home = arg('home');
  if (!home) { process.stderr.write('euphonia-bridge: --home is required\n'); process.exit(2); }
  const firm = createFirmHttp({ baseUrl: arg('firm-url', 'http://127.0.0.1:8420') });
  const cosmetics = (patch) => applyCosmetics({
    patch, configFile: path.join(home, 'config.json'),
    peonDir: arg('peon-dir', path.join(os.homedir(), '.claude', 'hooks', 'peon-ping')),
    assetsDir: arg('assets-dir'), userDataDir: arg('user-data-dir'),
  });
  const defs = createTools({ firm, ghRun: createGhRunner(), cosmetics });
  const readGrants = () => { try { return JSON.parse(fs.readFileSync(path.join(home, 'grants.json'), 'utf8')).grants || []; } catch { return []; } };   // unreadable = no grants = refuse
  const call = createRunner({ defs, readGrants, audit: createAudit({ file: path.join(home, 'bridge-audit.jsonl') }) });
  const server = createMcpServer({ name: SERVER, version: '1.0.0', defs, call });
  const session = server.attach((line) => process.stdout.write(line + '\n'));
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { session.push(d); });
}

if (require.main === module) main();
module.exports = { main };

'use strict';
// The bridge's tools plus the runner that enforces grants and writes the audit log. The MCP server (main.js) and the app
// itself (the chat window's Send to Management button) both call tools through this, so both obey the same rules.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFirmHttp } = require('./firm-http');
const { createGhRunner } = require('./gh');
const { createAudit } = require('./audit');
const { createTools, createRunner } = require('./tools');
const { applyCosmetics } = require('./cosmetics');

function createBridgeRuntime({ home, firmUrl = 'http://127.0.0.1:8420', peonDir, assetsDir, userDataDir }) {
  const firm = createFirmHttp({ baseUrl: typeof firmUrl === 'function' ? firmUrl() : firmUrl });
  const cosmetics = (patch) => applyCosmetics({
    patch, configFile: path.join(home, 'config.json'),
    peonDir: peonDir || path.join(os.homedir(), '.claude', 'hooks', 'peon-ping'), assetsDir, userDataDir,
  });
  const defs = createTools({ firm, ghRun: createGhRunner(), cosmetics });
  const readGrants = () => { try { return JSON.parse(fs.readFileSync(path.join(home, 'grants.json'), 'utf8')).grants || []; } catch { return []; } };   // unreadable = no
  const call = createRunner({ defs, readGrants, audit: createAudit({ file: path.join(home, 'bridge-audit.jsonl') }) });
  return { defs, call };
}

module.exports = { createBridgeRuntime };

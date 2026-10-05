'use strict';
// The bridge's tool names, known without starting it: the access machinery needs them before the CLI has ever listed them.
const { createTools, SERVER } = require('./tools');

const stub = () => { throw new Error('not available'); };
const names = createTools({ firm: {}, ghRun: stub, cosmetics: stub }).map((d) => d.name);

module.exports = { BRIDGE_SERVER: SERVER, BRIDGE_TOOLS: names };

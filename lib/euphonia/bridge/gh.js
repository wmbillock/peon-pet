'use strict';
// GitHub through the `gh` CLI with FIXED subcommands. Arguments are validated values (numbers, enumerated flags, one
// allow-listed label); there is no free-form argv and `gh api` is never used. Everything is pinned to one repository.
const { execFile } = require('child_process');

const REPO = 'Affirm/affirm-builders';
const LABELS = ['the-firm'];                       // intake label for filed tasks (Peter's decision); the only label that can be listed or set
const PR_STATES = ['open', 'closed', 'merged', 'all'];
const ISSUE_STATES = ['open', 'closed', 'all'];
const PR_FIELDS = 'number,title,state,isDraft,url,reviewDecision,mergeStateStatus,headRefName,baseRefName,author,updatedAt,labels';
const LIST_PR_FIELDS = 'number,title,state,isDraft,url,reviewDecision,headRefName,author,updatedAt';
const CHECK_FIELDS = 'name,state,bucket,workflow,link,completedAt';
const ISSUE_FIELDS = 'number,title,state,url,labels,updatedAt';

const num = (v, what) => {
  const n = typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1 || n > 9999999) throw new Error(`${what} must be a positive integer`);
  return String(n);
};
const oneOf = (v, list, what) => { if (!list.includes(v)) throw new Error(`${what} must be one of: ${list.join(', ')}`); return v; };
const limit = (v) => { const n = v === undefined ? 20 : Number(v); if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('limit must be 1-50'); return String(n); };
const text = (v, what, max) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} is required`);
  if (v.length > max) throw new Error(`${what} is longer than ${max} characters`);
  if (v.includes('\0')) throw new Error(`${what} contains a NUL byte`);
  return v;
};

// Each builder returns the complete argv (after `gh`). Free text (title, body) is data in a single `--flag=value` argument,
// executed without a shell, so metacharacters in it have no effect.
const commands = {
  viewPr: ({ number }) => ['pr', 'view', num(number, 'number'), '--repo', REPO, '--json', PR_FIELDS],
  listPrs: ({ state = 'open', limit: l } = {}) => ['pr', 'list', '--repo', REPO, '--state', oneOf(state, PR_STATES, 'state'), '--limit', limit(l), '--json', LIST_PR_FIELDS],
  listIssues: ({ label, state = 'open', limit: l } = {}) => ['issue', 'list', '--repo', REPO, '--label', oneOf(label, LABELS, 'label'), '--state', oneOf(state, ISSUE_STATES, 'state'), '--limit', limit(l), '--json', ISSUE_FIELDS],
  prChecks: ({ number }) => ['pr', 'checks', num(number, 'number'), '--repo', REPO, '--json', CHECK_FIELDS],
  createIssue: ({ title, body }) => [
    'issue', 'create', '--repo', REPO, `--title=${text(title, 'title', 200).replace(/\s+/g, ' ').trim()}`, `--body=${text(body, 'body', 10000)}`, `--label=${LABELS[0]}`,
  ],
};

function createGhRunner({ execFileImpl = execFile, timeoutMs = 30000 } = {}) {
  return (args) => new Promise((resolve, reject) => {
    execFileImpl('gh', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, shell: false }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`gh failed: ${String(stderr || err.message).trim().split('\n')[0].slice(0, 300)}`));
      resolve(String(stdout));
    });
  });
}

module.exports = { commands, createGhRunner, REPO, LABELS, PR_STATES, ISSUE_STATES };

'use strict';
// GitHub through the `gh` CLI with FIXED subcommands. Arguments are validated values (numbers, enumerated flags, one
// allow-listed label); there is no free-form argv and `gh api` is never used. Reads default to one repository; the PR read
// commands take an optional `repo` that must be on the owner's `githubRepos` list (config.json), which the model cannot write.
const { execFile } = require('child_process');
const { childPath } = require('../find-claude');

const REPO = 'Affirm/affirm-builders';
const DEFAULT_REPOS = [REPO];
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;   // owner/name only: no leading dash, no flags, no shell characters
const FIRM_LABELS = ['the-firm'];                  // a PR carrying this label is Firm work (the old issue intake is gone: Jira since 2026-10-06)
const PR_STATES = ['open', 'closed', 'merged', 'all'];
// Every PR read carries base and head refs, state, draft flag, merge state, review decision and the check rollup, so she
// can see a PR cut from the wrong base or an unfinished suite without a second call.
const PR_FIELDS = 'number,title,state,isDraft,url,reviewDecision,mergeStateStatus,headRefName,baseRefName,author,updatedAt,labels,statusCheckRollup';
const LIST_PR_FIELDS = 'number,title,state,isDraft,url,reviewDecision,mergeStateStatus,headRefName,baseRefName,author,updatedAt,labels,statusCheckRollup';
const CHECK_FIELDS = 'name,state,bucket,workflow,link,completedAt';

const num = (v, what) => {
  const n = typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1 || n > 9999999) throw new Error(`${what} must be a positive integer`);
  return String(n);
};
// The repo a read targets: omitted means the default; anything else must be well formed AND on the owner's list (case-insensitive, as GitHub is).
const repoFor = (v, allowed = DEFAULT_REPOS) => {
  if (v === undefined || v === null || v === '') return REPO;
  if (typeof v !== 'string' || !REPO_RE.test(v)) throw new Error('repo must look like owner/name (for example Affirm/web-ux)');
  const hit = (allowed || []).find((r) => typeof r === 'string' && r.toLowerCase() === v.toLowerCase());
  if (!hit) throw new Error(`repo ${v} is not on the allowed list (${(allowed || []).join(', ') || 'none'}). The owner adds it to githubRepos in Euphonia's config.json.`);
  return hit;
};
const oneOf = (v, list, what) => { if (!list.includes(v)) throw new Error(`${what} must be one of: ${list.join(', ')}`); return v; };
const limit = (v) => { const n = v === undefined ? 20 : Number(v); if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('limit must be 1-50'); return String(n); };

// Each builder returns the complete argv (after `gh`): validated numbers and enumerated flags only, executed without a shell.
const commands = {
  viewPr: ({ number, repo }, allowed) => ['pr', 'view', num(number, 'number'), '--repo', repoFor(repo, allowed), '--json', PR_FIELDS],
  listPrs: ({ state = 'open', limit: l, repo } = {}, allowed) => ['pr', 'list', '--repo', repoFor(repo, allowed), '--state', oneOf(state, PR_STATES, 'state'), '--limit', limit(l), '--json', LIST_PR_FIELDS],
  prChecks: ({ number, repo }, allowed) => ['pr', 'checks', num(number, 'number'), '--repo', repoFor(repo, allowed), '--json', CHECK_FIELDS],
  // Open PRs that look like Firm work when The Firm's own record is unavailable: the intake label or a Firm branch.
  listFirmPrs: ({ limit: l } = {}) => ['pr', 'list', '--repo', REPO, '--state', 'open', '--limit', limit(l === undefined ? 50 : l), '--json', LIST_PR_FIELDS],
};

// PATH gets the usual install dirs (Homebrew, ~/.local/bin, nvm) so `gh` is found when the app was started by launchd or Finder.
function createGhRunner({ execFileImpl = execFile, timeoutMs = 30000, env = process.env } = {}) {
  const childEnvironment = { ...env, PATH: childPath(null, env) };
  return (args) => new Promise((resolve, reject) => {
    execFileImpl('gh', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, shell: false, env: childEnvironment }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.code === 'ENOENT' ? 'gh failed: the GitHub CLI (gh) is not installed or not on PATH' : `gh failed: ${String(stderr || err.message).trim().split('\n')[0].slice(0, 300)}`));
      resolve(String(stdout));
    });
  });
}

module.exports = { commands, createGhRunner, repoFor, REPO, DEFAULT_REPOS, REPO_RE, FIRM_LABELS, PR_STATES, PR_FIELDS, LIST_PR_FIELDS };

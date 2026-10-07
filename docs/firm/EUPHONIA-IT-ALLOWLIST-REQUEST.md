# Request: allow one local MCP server, `euphonia-bridge`

**Who:** Willow Billock (Pricing DT). **What:** add a local stdio MCP server to the managed MCP allowlist on my machine.

## Why

My personal assistant (Euphonia, part of Peon Pet, a local desktop app) cannot see or hand work to The Firm, because the managed
MCP policy refuses any server that is not on the list ("You cannot dynamically configure MCP servers when an enterprise MCP
config is present"). The managed servers already work for it (Jira, Notion, Slack and the rest); this one is the missing piece.

## The server

| | |
|---|---|
| Name | `euphonia-bridge` |
| Transport | stdio, started by the Claude CLI on my machine; no network listener |
| Command | the Peon Pet app binary run as plain node (`ELECTRON_RUN_AS_NODE=1`) with `lib/euphonia/bridge/main.js` |
| Source | `peon-pet` repo, `lib/euphonia/bridge/` (about 400 lines, read it in full) |

## What it can do (11 tools)

- **Read:** The Firm's local status, inbox and workstreams (loopback `127.0.0.1:8420` only); GitHub issues and PRs in
  `Affirm/affirm-builders` only, through the already-authenticated `gh` CLI, restricted to the `the-firm` label.
- **Write:** send a message to The Firm's Management; press a button on a Firm inbox card; file a `the-firm` issue; change the
  assistant's own cosmetics (name, sound pack, border, species).

## Controls already in the server

- Every call re-checks a grant file that only I can write from the app's dashboard. Reads need a read grant; writes need a
  write grant. No grant, no call. Model output cannot create or change a grant.
- Every call, allowed or refused, is written to an audit log (`bridge-audit.jsonl`); a write is refused if the audit log cannot be written.
- Messages it sends to The Firm are prefixed `[Assistant]` so Management can tell them from me typing.
- It has no shell, no filesystem access beyond its own home, no network access other than the loopback Firm API and `gh`.
- Its tool surface is fixed in code and covered by tests (`tests/euphonia-bridge.test.js`, `tests/euphonia-access.test.js`).

## What I am asking

Add `euphonia-bridge` (command above) to the allowlist for my user. If a different packaging is easier for you to approve
(for example, a signed binary, a fixed install path, or a review of the repo at a pinned commit), tell me and I will produce it.

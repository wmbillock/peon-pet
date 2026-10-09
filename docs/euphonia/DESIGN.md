# Euphonia: the user's personal assistant (first slice)

Status: first slice built on `feat/euphonia-assistant`. Owner decisions of 2026-10-05.

## North Star

Each person has one persistent assistant, shown as their primary pet. They chat with it from the
pet window, it remembers in a knowledge base of its own, it can read their hub, and it never
changes anything outside its own memory without their explicit say-so.

## What Euphonia is

Euphonia is the user's personal assistant. It is not The Firm's Management agent. It will later
sit between the user and The Firm and carry the same conversation into Slack. Those parts are not
built; this slice is the chat bubble and a persistent session behind it.

## Architecture at a glance

```
 pet window (button + dot)  --open-->  chat window  --IPC-->  main.js glue  -->  lib/euphonia/service.js (core)  --spawn-->  claude CLI
 renderer/chat.js            lib/euphonia/ipc.js     |  state in ~/.euphonia/<user>/            (resumed session)
 renderer/chat-model.js                              |  kb/ (own store, writable)
                                                     +- hub (user's Libretto, READ ONLY)
```

| Piece | File | Job |
|---|---|---|
| Core | `lib/euphonia/service.js` | `createEuphonia({ home, hubDir, spawnImpl, now })`. Keeps ONE long-lived CLI process per session (stream-json in and out), restarts it with `--resume` when its argv must change, falls back to one process per message, emits events. No Electron imports. |
| Tool authority | `lib/euphonia/authority.js` | One pure function, `buildToolPolicy`, computes every flag that limits the CLI. |
| Stream parser | `lib/euphonia/stream.js` | Turns stream-json lines into `session`, `delta`, `break`, `tool`, `result`. |
| Knowledge base | `lib/euphonia/kb.js` | Seeds `INDEX.md`, `identity.md`, `log.md` once; never overwrites. |
| Voice | `lib/euphonia/voice.js` | Picks and plays a cue from Euphonia's own sound pack. |
| Actions and approval cards | `lib/euphonia/actions.js`, `lib/euphonia/bridge/` | Parses her action blocks (and the `management` alias), runs read actions, makes approval cards for writes, logs receipts. |
| Firm mirror | `lib/euphonia/firm-mirror.js` | Writes The Firm's state into `kb/firm/` every 30 s (STATUS.md, inbox.json, events.jsonl). |
| Browser guard, managed policy, CLI lookup | `lib/euphonia/browser-guard.js`, `managed-policy.js`, `find-claude.js` | PreToolUse host guard passed through `--settings`; tools the machine's managed `ask`/`deny` holds; where `claude` and nvm's node live when launchd's PATH is minimal. |
| Prompt | `lib/euphonia/prompt.md` | The appended system prompt. |
| Glue | `lib/euphonia/ipc.js`, `main.js`, `chat/preload.js` | Chat-window-only IPC for messages, cards and resets; dashboard-only IPC for grants and settings; events out; cue on reply. |
| View | `chat/` (window), `renderer/chat.js`, `renderer/chat-model.js`, `lib/euphonia/chat-window.js`, `lib/euphonia/unread.js` | The dedicated chat window and the pet's chat button with its unread dot. The model and unread logic are pure and unit tested. |

The pet is a view. The service is the core and knows nothing about windows, so a Slack transport
can later call `send()` and `subscribe()` unchanged. The kb is Euphonia's own store. The hub is
read-only.

## State on disk

Default home: `~/.euphonia/<os username>` (override with `EUPHONIA_HOME`). Directories are mode 0700.

| Path | Contents |
|---|---|
| `session.json` | `{ id, created_at, updated_at, turns }`. Written only after a turn succeeds. |
| `kb/` | Euphonia's own Libretto-style store: `INDEX.md` (index), `identity.md`, `log.md` (dated, append-only), plus pages it adds. |
| `transcript.jsonl` | Append-only turns: `{ ts, turnId, role, origin, text }`. |
| `config.json` | `name`, `soundPack` (default none), `species` (default `weeping-willow`), `model` (default: CLI default), `restricted` (default `true`), `browserHosts`, `transport` (`persistent` default, or `per-turn`), **`displayName` and `pronouns`** (how she addresses the owner; the OS login is used for nothing but this directory's name). |
| `grants.json`, `cards.json`, `tools-seen.json`, `bridge-audit.jsonl` | Tool access grants (dashboard only), approval cards, the tool catalogue learned from the CLI's init events, the action audit. |
| `mcp-status.json` | Connection state of every MCP server at the CLI's last init (`{ updated, launch, process, servers: { name: { status, tools } } }`). |
| `identity.md` (in `home`, NOT in `kb/`) | Owner-only personality text, **appended verbatim to the system prompt**. It lives outside the kb because the kb is the one place the model may write, and a model-writable system prompt is a persistent injection. An older `kb/identity.md` is copied up once; `kb/identity.md` stays as her own notes with no authority. |
| `kb/firm/STATUS.md`, `inbox.json`, `events.jsonl` | The Firm's state, rewritten by the app about every 30 s (read only for her). |
| `sent.jsonl` (in `home`, NOT in `kb/`) | Receipts: one line per approved write that ran (`{ id, ts, action, destination, status: delivered|failed, result, receipt, reply }`). Outside the kb so the model cannot forge a "delivered" line; rendered into every turn header. |

`New` in the chat header calls `resetSession()`: the old `session.json` is renamed to
`session.<ms>.old.json`, nothing is deleted, and the next message starts a fresh conversation.

## How a turn runs (transport: one long-lived CLI per session, 2026-10-07)

Why: every turn used to spawn a fresh `claude -p --resume <id>`, so every turn reconnected the ~20 managed MCP servers
and the npx-launched Playwright servers sometimes missed the window; she told the owner the tools "dropped out". Now:

1. The chat window sends text over `euphonia-send`. Main accepts it only from that window and stamps `origin: "user"`.
   The message is appended to `transcript.jsonl` and queued (turns run one at a time).
2. The service computes the process argv (policy from the active grants, the static system prompt, `--settings` with the
   browser guard, model, `--resume <id>` when a session exists). If a live process exists with the **same argv**, the turn is
   written to it as one stdin line `{"type":"user","message":{"role":"user","content":[{"type":"text","text":...}]}}`.
   Otherwise the old process is ended (stdin closed, killed after 3 s) and a new one spawned with
   `--input-format stream-json`. Grant changes, an edited `identity.md`, a model change and `New` therefore restart the
   process; the access block does not (see below). A process that died between turns is replaced on the next turn.
3. The `result` event ends the turn; the process stays. The session id comes from `system`/`result` events; `session.json`
   is updated only on success. Each turn gets a fresh stream parser, so a `message_start` at the start of turn 2 is not read
   as a break inside turn 1.
4. Fallback: if the CLI rejects `--input-format` (stderr names it on the process's first turn), that turn is redone the old
   way (`claude -p` with the message on stdin, process exits after the reply) and the run stays per-turn; `transport:
   "per-turn"` in `config.json` forces it. `shutdown()` ends the live process; `main.js` calls it on `before-quit`.
5. Events go to subscribers: `start`, `delta`, `tool` (name only), `done`, `error`, `notice`, `card`, `receipt`, `denied`,
   `user-tool`. The chat window receives them on `euphonia-event`; the pet window only gets `euphonia-unread {count}`.
6. On `done`, main plays a cue from Euphonia's sound pack unless sound is muted.

An error (CLI missing, non-zero exit, `is_error` result, a process dying mid-turn, timeout after 5 minutes, which kills the
process) emits `error` and changes neither `session.json` nor the assistant side of the transcript.

**The access block travels with the message, not in the system prompt.** The app writes a header at the top of every
message: `[Current access for this turn ...]` (the block `renderAccessBlock` used to put in the prompt), MCP notes (below),
`[Recent sends ...]` (the last 24 h of receipts, at most 10 lines) and finally `[Message]` followed by the text. The system
prompt's `## Current access` says to read it there. A changing block therefore never restarts the process, and the transcript
keeps only the user's own text.

**MCP status.** Every `system/init` event is recorded to `mcp-status.json` (status and tool count per server) and feeds the
catalogue. For each granted server the header says `held: still connecting (CLI reported "pending")` when its status at the
last init was not `connected`, `connection state unknown` on a first turn before any init, and labels a record from an earlier
launch as such. Live check (2026-10-07, `EUPHONIA_HOME=willow-smoke`, two one-word messages): one process (pid 36739) took
both; the raw sequence was `... result/success (turn 1) -> system/init (18 MCP servers: 15 connected, buildkite pending,
lucid needs-auth, pagerduty failed) -> system/status -> message_start -> content_block_delta x24 -> assistant ->
content_block_stop -> message_delta -> message_stop -> result/success (same session id) -> CLOSE code=0 on shutdown`. The
CLI emits `system/init` **after each user message**, not at spawn, so the first turn of a process cannot wait for it
(`initWaitMs` defaults to 0). To know the state before the first turn, the app runs **`claude mcp list`** once in the
background at launch and after any grant-change restart (`lib/euphonia/mcp-list.js`; same child env and PATH, 120 s cap, no
model call; about a minute here with 18 servers). Lines are `name: command - ✓ Connected` / `- ✗ Failed to connect — ...` /
`- ! Needs authentication` (verified 2026-10-07), parsed from the last ` - ` on the line, and written to `mcp-status.json` with
`source: "mcp-list"` and a timestamp; a later `system/init` overwrites it with `source: "init"`. The header labels each held
note by source and age (`from \`claude mcp list\` 2 min ago`, `as of the previous launch`). Fail-open: a probe error or timeout
keeps the previous file and adds `MCP check: <error>; the state above is the last one known`.

CLI invocation (flags verified against `claude --help`, v2.1.289):

```
claude -p --output-format stream-json --verbose --include-partial-messages --input-format stream-json \
  --append-system-prompt <prompt + home/identity.md> --system-prompt-snapshot off --permission-mode default --permission-prompt-tool stdio \
  --tools Read,Grep,Glob,Edit,Write \
  --allowedTools "Read,Grep,Glob,Edit(//<kb>/**),Write(//<kb>/**)[,mcp__<server>__<tool>...]" \
  --disallowedTools "Bash,PowerShell,WebFetch,WebSearch,NotebookEdit,Task,Agent,mcp__*|mcp__<server>...,Edit(//<hub>/**),Write(//<hub>/**),NotebookEdit(//<hub>/**)" \
  --disable-slash-commands --settings <browser-guard hook JSON> --add-dir <hub> --restricted [--model M] [--resume <id>]
```
Child env: PATH from `find-claude.childPath` (the CLI's own dir, `~/.local/bin`, Homebrew, nvm's node bins so `npx` servers
start under launchd) and `MCP_TIMEOUT=120000` unless the launcher set one.

## Authority rules (security)

Four stacked layers, all computed in `buildToolPolicy`:

1. `--tools` leaves only Read, Grep, Glob, Edit, Write. There is no Bash or network tool in the session.
2. `--permission-mode default` (persistent) with `--permission-prompt-tool stdio`, or `dontAsk` (per-turn), plus `--allowedTools`: anything not explicitly allowed is denied or, in persistent mode, asked of the app (which denies everything but card-approvable tools) and
   nothing ever prompts. Edit and Write are allowed only on `<home>/kb/**`. (In persistent mode the mode is `default` with
   `--permission-prompt-tool stdio`: a prompt reaches `onControl`, which denies everything except a policy-held tool the owner
   may approve on a card; see "Policy-held tool calls".)
3. `--disallowedTools` names the shell, network, MCP and agent tools, and denies Edit/Write/NotebookEdit
   on the hub. Deny beats allow.
4. `--restricted` ignores the user's own Claude settings files (so their hooks, allow-rules and plugins
   cannot widen or disturb the session) and confines file tools to the working directories
   (`<home>` and the `--add-dir` hub). MCP is closed without `--strict-mcp-config` (see below).

### Tool access (grants): the authority model

Default for every MCP server is **none**. The owner changes that only in the dashboard (Euphonia > Tool access); the chat
window shows a read-only "tool access: read: slack, jira" line that links there. Reads are free; writes need a write grant.

**Grant lifecycle.** `grants.json` in her home holds `{server, level: "read"|"write", granted_at, expires_at|null, via: "ui"}`, one
per server. Durations: 1 hour, 4 hours, until end of day (local), 7 days, blanket (`null`, until revoked). Re-granting replaces
the entry (that is how to extend or change it). Expired entries are ignored and pruned from the file on every read. A blanket write
grant asks for confirmation that spells out what write access means. "Revoke all" clears everything.

**Who can change it.** Only the IPC handlers `euphonia-access-set` / `-revoke` / `-get`, and only from the dashboard window.
The chat window, the pet window and any other sender are refused (tested), `grants.json` is outside `kb/` (the only place the CLI may
write), and no code path turns model output or transcript text into a grant (tested). A "yes" typed in chat approves one action
the model asks about; it never touches the store.

**Per-turn allowlist.** Before every turn the service reads the active grants and recomputes `--allowedTools` and
`--disallowedTools` (`access.computeMcpAccess`, `authority.buildToolPolicy`):
- A **read** grant allows the server's read-class tools; a **write** grant allows read plus write-class tools. Rules are exact
  `mcp__<server>__<tool>` names taken from the catalog (below). A tool not in the catalog is never allowed.
- Classification (`tool-class.classifyTool`, one pure function): the tool name is split into words; if it contains a write verb
  (send, create, add, update, edit, delete, schedule, upload, run, execute, invoke, ...) it is **write**; otherwise if it contains
  get, list, search, read, fetch, query, describe, find, lookup, view, check, analyze or preview it is **read**; anything else, and
  anything unknown, is **write**. Conservative on purpose: `slack_add_list_record`, `get_file_upload_url`, `execute_query` and
  `run_data_explorer_report` are write.
- Servers with no grant get a server-level deny (`mcp__<server>`) for every configured or seen server. With no grants at all the
  broad `mcp__*` deny is kept too. With any grant the broad wildcard is dropped, because a deny beats an allow and would cancel the
  specific allows. A read grant also denies that server's write-class tools by exact name.
- `--tools` (built-ins only), `--permission-mode dontAsk` and the hub write denies are unchanged. Bash and hub writes cannot be
  granted through this path (filtered, tested).

**Catalog.** The tool list per server is learned from the CLI's own `system` init event on every turn (`tools`, `mcp_servers`),
saved to `tools-seen.json`. No extra provider call. Until a server has been seen once, a grant for it allows nothing and the access
block says its tools are learned on its first turn; the owner asks again after that reply.

**Discovery** (`mcp-discovery.js`, no provider call, names only): the managed config
(`/Library/Application Support/ClaudeCode/managed-mcp.json` on macOS), `~/.claude.json` (user and per-project servers),
`<home>/.mcp.json`, plus servers the CLI reported on past turns. `claude mcp list` is not used because it health-checks every
server. Unreadable or malformed files are shown as errors in the dashboard; an empty result states where it looked.

**What she is told.** Each turn the message header carries the "Current access" block built from the active grants (see
"How a turn runs"); `--system-prompt-snapshot off` keeps the static prompt fresh across restarts. `prompt.md` and her kb note `settings.md` say: she cannot change her permissions, only the
owner in the dashboard under Euphonia > Tool access; she names the server and level she needs and sends the owner there; she never
claims a tool outside the block; before any write-class action she shows the exact text and destination and waits for a reply in
chat (approves one action only); she never messages a person unless the owner names them in that message. When the CLI reports a
permission denial (`permission_denials` in the result event) the chat shows an inline notice naming the server and the level.

**Not proven (needs a real prompt, which the owner runs):**
1. That a specific `mcp__<server>__<tool>` allow wins over the enterprise managed settings (the managed file also has `allow`,
   `ask` and `deny` lists for MCP tools, and `allowManagedMcpServersOnly`). Our denies beat allows; whether a managed `ask` or
   `deny` still blocks a granted tool is unknown. If a granted tool is still denied, that is the likely reason.
2. That a server-level `mcp__<server>` deny matches all that server's tools, and that the `mcp__*` wildcard matches at all
   (`claude --help` documents neither syntax; they are the documented Claude Code permission forms).
3. That the init event lists MCP tools while the server is permission-gated, and that `permission_denials` is emitted in
   stream-json (parsed defensively; absent means no inline notice, not a failure).
4. That `dontAsk` denies every ungranted MCP call and that `--system-prompt-snapshot off` is honoured with `--resume`.
5. That managed `defaultMode` or `acceptEdits` does not loosen `dontAsk`.

The home directory holds `config.json` and `session.json` outside `kb/`, so the assistant cannot
rewrite its own settings. Unit tests assert a hub write is denied, a kb write is allowed, traversal
out of the kb and a sibling-prefix directory are denied.

### The rule for future authority changes

Authority settings change only on a message with `origin: "user"` from the chat window (the user's own UI), never because of
text the agent read or produced. Hub files, tool output and the agent's own replies are data. A grant
is never stored where the agent can write, and never inferred from conversation content.

### Approvals seam

This was a stub (`approvals.js`, always "not granted"); it is replaced by the approval cards of the euphonia-bridge section, and the file was deleted.

## Voice and identity

- Sound pack: no default (a shipped default may not name third-party audio; see "Third-party assets"). Choose one in
  the dashboard (Sound page, "Euphonia's voice") or `config.json`. Plays a `task.complete` cue when a reply
  finishes, at the peon-ping volume; skipped when muted.
- Species: `weeping-willow` by default (`config.json` `species`), an original character that is in the published repo.

## Interaction model

- **Chat button.** A round button is always drawn on the lower-right of Euphonia's sprite in the pet view (not hover-only,
  34 px, clear of the bottom-centre drag grip and the frame corners). It appears only in the main window while she leads.
  Clicking it opens the dedicated chat window, or focuses it if open. The pet window stays on the pet view; the old
  takeover, the toolbar chat entry and the `chat` corner view are gone, and a saved `cornerView: "chat"` is migrated to `pet`.
- **Unread dot.** A red dot (with a count above 1) shows on the button when an assistant message arrives while the chat window is
  closed, minimised, hidden or unfocused. It clears when the chat window is focused and showing. The marker of the last assistant
  message read (timestamp and turn id) is persisted in `read.json`, so a relaunch shows neither a stale dot nor loses a real one.
  Euphonia-initiated messages count the same way (any assistant transcript entry).
- **Chat window.** A normal framed, resizable, focusable window titled "Euphonia" (320x360 minimum). Single instance. Bounds are
  remembered. Closing it does not quit the app or touch the session; the conversation and the dot logic live in main, so the
  window can close and the pet window can reload without losing anything. The header shows the session state ("new
  conversation", or turns and last-active time), one "New" action (the old session file is kept; the window shows only the
  current conversation), and the error banner, which names a rejected flag and the next step.
- **Launch.** `openChatOnLaunch: true` opens the chat window at launch. Default is false: the button and dot are the primary path.

## Third-party assets (owner decision 2026-10-05)

Third-party art and sound packs stay out of the shared repo unless they are already on GitHub. Only public-domain, publishable,
non-copyright-issue assets go in. Local-only choices stay local: the owner's current species (princess-peach) and sound pack
(sc_battlecruiser) live in his own `config.json`, never in a tracked file.

Enforced, not just documented: `lib/shipped-defaults.js` and `scripts/check-shipped-defaults.js` (run by `tests/shipped-defaults.test.js`)
fail if any SHIPPED default names a species or pack that must stay local.
- A species is shippable only if it has tracked art and none of that art is excluded from a distribution by `lib/dist-filter.js`
  (third-party `localOnly` characters and art the manifests mark `generated-locally`). Eight species qualify: the ones in the published
  fork (`c351149`): orc, capybara, weeping-willow, bearded-dragon, retro-robot, clipart-trumpet, eighth-note, lcd-creature.
- Sound packs are third-party audio living in peon-ping's folder, not in this repo, so no pack is an approved shipped default (the
  `SAFE_PACKS` list is empty until the owner records one).
- Checked defaults: Euphonia's species and pack and its fallbacks, the shipped casting preferences, the seeded agent kinds.

Defaults changed in this slice: Euphonia's species `trillian` (third-party) -> `weeping-willow`; Euphonia's sound pack
`ra2_eva_commander` (third-party game audio) -> none (no voice until chosen; the dashboard shows "(no voice)"); the shipped casting
preferences were cut from 32 species to the 8 published ones. The 24 unpublished species moved to a gitignored
`lib/character-preferences.local.json` on this machine, so casting here is unchanged; the user-data file works the same way.
Peon-ping's own `peon` fallback in the voices page and its pack rotation belong to peon-ping's config, not this repo.

## The euphonia-bridge: app-executed actions with approval cards (no MCP)

Owner decisions, 2026-10-05: **(1)** The Firm owns agent types; Peon Pet is a client and its writes come only from the user.
**(2)** Third-party art and sound packs stay out of the shared repo unless already on GitHub (see "Third-party assets").

**Why MCP is out (2026-10-07).** The first design passed a local stdio MCP server through `--mcp-config`. On this managed machine
`/Library/Application Support/ClaudeCode/managed-settings.json` has `allowManagedMcpServersOnly: true` and no `allowedMcpServers`, so
the CLI loads only the servers in `managed-mcp.json` and silently ignores everything else: she listed the bridge's tools and every
call said "No such tool". That is an org security control and is not worked around (no impersonated server names, no policy edits, no
environment tricks). The MCP transport (stdio server, framing, `mcp-bridge.json`, `--mcp-config`) was deleted; the handlers were kept.

**The protocol.** She has no tool for these. She ends a reply with fenced blocks, one per action, exactly:

````
```euphonia-action
{"tool":"firm_get_status","args":{}}
```
````

`lib/euphonia/actions.js` parses ONLY the assistant's own text of the current turn, ONLY trailing blocks (a block quoted or followed by
prose is just text), strict JSON with only `tool` and `args`, a known tool, an object `args`, at most 3 blocks and 8000 characters each.
Four blocks run none; a bad block yields an error result she sees. The blocks are removed from what is shown and stored as her words.
Tool results, hub text and history are never parsed.

- **Read actions** (`firm_get_status`, `firm_list_inbox`, `firm_get_workstream`, `firm_list_events`, `github_view_pr`, `github_list_prs`,
  `github_check_pr`, `github_firm_pr_watch`) run automatically when an unexpired read-or-write grant for `euphonia-bridge` exists. The
  result goes back into the SAME session (`--resume`) as a user-role message `[tool result: <tool>]` with `origin: "tool"`; the chat
  shows it as a quiet note. Up to 6 such rounds per user message, then the app stops and says so. No grant: a refusal result names the
  capability, the level and the dashboard path.
- **Write actions** (`firm_send_to_management`, `firm_respond_inbox`, `pet_set_cosmetics`) never run on her say-so. (`firm_file_task` and `github_list_issues` were removed on 2026-10-08: The Firm's intake is Jira under PPE-2832 since 2026-10-06, and nobody reads `the-firm` GitHub issues.)
  The app creates an **approval card** (`cards.json`): tool, exact args, and for messages and issues the exact text and destination
  (messages show the `[Assistant]` prefix that will be sent). Only an Approve click in the **chat window** (`euphonia-card-decide`,
  accepted from that window only) runs it, once, bound to a SHA-256 of the exact payload: the click carries only the hash it saw, the
  payload comes from the stored card, and a changed payload is a new card. Cards expire after 10 minutes, survive a window reload or
  restart, and a write needs an unexpired WRITE grant at card creation and again inside the handler when it runs (double gate). There is
  no "always allow": grants change only in the dashboard. The outcome (issue URL, sent, failed) goes back as `[tool result]` and is audited.
  A trailing fenced block tagged `management` (the old draft form) is an **alias** for `firm_send_to_management {text}`: same
  card, same code path; the separate Send to Management button and its IPC were removed.
- **Receipts (2026-10-07).** When an approved card runs, the app appends `{ id, ts, action, destination, status: delivered|failed,
  result, receipt, reply }` to `home/sent.jsonl`, marks the card `sent HH:MM` (with Management's reply when it arrived within
  ~20 s, `reply pending` otherwise) or `failed: <reason>`, feeds the result back into her session as `[tool result: <tool>]` with a
  `[receipt]` line so she confirms from the record, and shows the last 24 h (10 lines) in every message header so a later turn
  answers "did that get sent?" from the log. The Firm returns no id for a chat message, so the receipt is the `user_message`
  event (actor `user`, target `management`, same text) found by polling `/api/events?since_id=<last id before the send>`; its
  `delivered_at`/`acked_at` say whether Management picked it up, and the reply is the next chat-audience assistant message in
  `/api/threads/management/messages`. A `system` notice after the send is a refusal and fails the action.
- **Capability row.** `euphonia-bridge` stays in the dashboard Tool access table as a built-in capability row (not an MCP server):
  none / read / write with the same durations. `bridge-audit.jsonl` records every action: cards, attempts, results, refusals, rejected blocks.
- **Handlers** (`bridge/tools.js`, `gh.js`, `firm-http.js`, `ws-client.js`, `cosmetics.js`): fixed `gh` argv from validated values
  for Affirm/affirm-builders only, `[Assistant] ` prefix on relayed text, cosmetics limited to name, soundPack, border, species.
  **The Firm's API, as read from the live source at `acdf42c54d` (2026-10-08; an Oct 2 checkout, `a99de04fd4`, had no token and
  misled a day's reading):** loopback-only (`HOST=127.0.0.1`). Reads need no token. **Writes need the per-process token** from
  `GET /api/session` (`local_auth.py`): `X-Firm-Token` on the inbox respond POST, and on the WebSocket an allowed `Origin` plus
  the subprotocol `firm, firm-token.<token>` (`local_auth.websocket_allowed`); a missing or wrong token is refused with HTTP 403
  before anything is sent, which is what the token-less client got live. The token is fetched per write, never cached. `/api/now`
  exists on the live Firm; the mirror does not use it yet. Reads: `GET /api/workstreams`,
  `/api/workstreams/{id}`, `/api/inbox` (cards carry `responses[].reply` and `awaiting`), `/api/prs` (The Firm's own PR record:
  `pr_number`, `branch`, `base_branch`, `pr_state`, `merged_at`), `/api/events?since_id=N&limit=N` or `?latest=1` (cap 500; rows
  `id, ts, kind, actor, target_agent, payload, delivered_at, acked_at`; `actor` is `user`, `scheduler`, `system` or a thread id),
  `/api/threads/{id}/messages`, `/api/projects`, `/api/health`, `/api/stats`. Writes: `POST /api/inbox/{item_id}/respond
  {action, text}` + `X-Firm-Token` -> `{ sent: text|null, item }`; WebSocket `/ws/threads/management` (Origin + token subprotocol)
  with a client frame `{"type":"message","text"}`, no ack and no id, a failure as `{"type":"system","text","audience":"chat"}`.
  The test suite's fake Firm enforces the same guard, with a positive control: a send without the token is refused with 403 and
  the action fails with a clear message. `GET/PUT /api/settings` exist (restart required) and
  are deliberately not used.
- **GitHub reads** return `baseRefName`, `headRefName`, `state`, `isDraft`, `mergeStateStatus`, `reviewDecision` and
  `statusCheckRollup` for list and view; `github_check_pr` returns those PR fields with its checks. `github_firm_pr_watch` takes The
  Firm's open PRs from `/api/prs`, reads each live through `gh pr view` (10 at most) and flags any whose base is not
  `pricing/the-firm/develop`; without The Firm it falls back to `gh pr list` filtered to the `the-firm` label or a Firm branch.
- **Events.** `firm_list_events {since: <event id or ISO time>, workstream?, limit?}` returns the rows above (actor included), and
  the mirror writes the last 200 to `kb/firm/events.jsonl` and lists the last 15 in `STATUS.md`.

Honest limits: a prompt-injected reply that ends with a read block would auto-run a read (reads are bounded, grant-gated and audited);
it can never run a write without the click. The model could mislead the user in the text of a card, but the card shows the real
payload, not her description.

**Browser.** The managed `playwright` server is in `managed-mcp.json`, so she can use it through ordinary dashboard grants without the
bridge. Observation tools (`navigate`, `navigate_back`, `snapshot`, `take_screenshot`, `console_messages`, `network_requests`, `tabs`,
`wait_for`) classify as read; `click`, `type`, `fill_form`, `evaluate`, `file_upload`, `run_code`, `press_key`, `drag`, `select_option`,
`handle_dialog`, `hover`, `close`, `install`, `resize` are write. The per-turn allowlist admits a granted server's tools from the init
event's catalogue (`tools-seen.json`); until a server's tools have been seen once (the first turn after install) a grant allows nothing
and the access block says so. **URL limits (localhost and Affirm hosts only) cannot be enforced through the CLI: they are a prompt
rule only.** `navigate` is classed read because it only loads a page; a malicious page could still be fetched.

**Unverified live:** that she reliably emits well-formed trailing blocks; the follow-up-message loop with `--resume`; the real Firm
endpoints and WebSocket handshake; `gh` authentication; playwright's tool names and whether the managed policy's own allow/ask/deny lists
still gate a granted tool.

## Policy-held tool calls: approval cards through the same path (merged 2026-10-08)

The machine's managed policy holds some MCP tools under `ask` (Jira create/edit/comment/transition, some Notion and Sentry
writes). In persistent mode her process runs with `--permission-mode default --permission-prompt-tool stdio`, so instead of a
refusal the CLI sends a `control_request` (`can_use_tool`) before such a call. `service.js onControl` answers it: a tool that is
held by `ask` AND granted at the level it needs (`computeMcpAccess({ approvals: true }).approve`) becomes a **card in the same
list, decided through the same `euphonia-card-decide` path and hash binding** as the app's own action cards
(`kind: "policy"`, status `approved` / `denied` / `expired` / `cancelled`); everything else is denied at once, as `dontAsk` would. Only this process's cards close when it ends; a `control_cancel_request` cancels its card; a new conversation cancels every pending card. One click,
one call; ten minutes, then denied; an open card holds the turn's timeout; the process ending closes its cards; every decision
is appended to `approvals.jsonl`. `deny` holds stay denied; allow and deny rules are unchanged. In per-turn mode no process can
be asked, so those tools stay held. The access block tells her which tools are card-approved. Tool names the policy lists
(`managed.known`) count as catalogued before the server has connected, so a slow starter is callable.

Also merged: `start()` spawns her process at launch (1.5 s after init, `main.js`) and after a grant change (`ipc.js
restartLive`), so MCP servers connect while she is idle; the process is named `--name "<name> (<displayName>)"`; a process that
dies on its own emits `live-exit` (logged by main). Assistant replies render as Markdown (`markdown-it`, html off, images off,
http(s) links only, opened in the browser by `chat-window.js`; `tests/euphonia-markdown.test.js`). The separate approvals DOM
and `euphonia-approval-answer` IPC from the other branch were folded into the card renderer: one renderer, one approve path.

## Owner follow-ups

- **Relaunch** the running app from this branch for the transport, receipts and header changes to take effect; the running
  checkout is on `feat/control-panel-pixoo`.
- **Grants to set** in the dashboard (Euphonia > Tool access) for the Firm work: `euphonia-bridge` write (cards), and read on the
  servers she should watch (jira, slack, the headless `playwright-local-verify`). Grants restart her CLI process on the next turn.
- **Your name and pronouns** are in the dashboard (Euphonia: name and voice); `config.json` already carries `displayName: "Willow"`,
  `pronouns: "she/her"` for the real and the smoke homes. Personality edits go in `~/.euphonia/<user>/identity.md` (beside the kb, owner-only).
- **The Firm:** the events feed exists and is used. Not available and not invented: an id or ack for a chat message sent over the
  WebSocket (the receipt is reconstructed from `/api/events`), and a `/api/now` summary (the mirror omits that section).
- `docs/firm/EUPHONIA-IT-ALLOWLIST-REQUEST.md` asks IT to allowlist the bridge MCP server; the bridge is no longer an MCP server, so
  that request is moot unless the owner wants MCP tools for other reasons.

## Voice focus (one voice at a time)

`lib/voice-focus.js`, config key `voiceFocus` in the app config (`active-display` default; `all` = no filtering), set in the
dashboard on Voice & sound ("Whose voice is heard"), which also shows who holds the voice now.
`resolveVoiceFocus({ pixooConnected, pixooShowing, cornerView, visibleAgentId, leadId, chatWindowFocused })`:
1. Pixoo connected and showing someone: that agent. 2. Else, Euphonia's chat window focused: Euphonia. 3. Else the selected corner
view: pet view = the lead (Euphonia), speaker/presenter = the working or master agent on screen (`pickVisibleAgent`), a group
view such as the grid has no single agent. 4. Anything unresolved: the lead, never all voices. `shouldPlay` is the one gate:
non-focused cues are dropped (not queued or delayed); Euphonia's reply cue also plays whenever her chat window is focused.
Each voice keeps its own pack (hers from her config).

Scope, honestly: Peon Pet plays only Euphonia's reply cue (through the gate) and auditions you ask for (always play). Agent event
sounds come from the peon-ping hook outside the app, so for those the focus is **published, not enforced**: the app writes
`voice-focus.json` (`agentId`, `reason`, `mode`) to its data folder on every change. Silencing the others needs peon-ping to read
that file or per-session muting; that is an owner decision. The Pixoo mirrors the lead pet only (no rotation exists today), so
"showing on the Pixoo" is the lead.

## Pixoo rotation and the voice

`lib/pixoo-rotation.js` (pure, tested) decides what the Pixoo shows. Config under `pixoo`: `rotate` (default on),
`rotateSeconds` (default 60), `rotateCount` (default 6 slots including the lead) and `pin` (an agent id, or empty).
- **Order:** the lead (Euphonia) first, then agents needing attention (alarmed or annoyed in the last two minutes), then working
  agents, then the other open ones by recency; top-level agents only, capped. She always keeps her slot.
- **Interval:** `max(10 s, rotateSeconds, the Pixoo update limit)`. The existing throttle is untouched: a rotation step changes what
  *should* be shown; the display is still updated at most once per limit, newest state winning.
- **Pin:** holds one agent (or Euphonia) while it exists. Rotation off with no pin shows only the lead.
- **Disappearing agent:** if the agent on screen goes away mid-cycle, the one that moved into its slot is shown at once.
- **Voice follows the display:** `pixoo.displayed` is set only after a successful send, and it is the `pixooShowing` input to
  `resolveVoiceFocus`. A step that is still waiting on the throttle does not move the voice.

## Making peon-ping honour the voice focus (needs one approved edit, NOT yet applied)

Peon Pet writes `voice-focus.json` (`~/Library/Application Support/Peon Pet/` on macOS) every tick:
`{ mode, agentId, reason, name, sessionIds, updatedAt }`. `sessionIds` are the hook session ids (`peonKey`, `codex-` prefixed for
Codex) of the focused agent and its sub-agents; a pet such as Euphonia has none, so while she holds the voice every hook session is
quiet. `docs/euphonia/peon-ping-voice-focus.patch` adds `_peon_voice_focus_blocks` to `peon.sh` and one guarded call beside the
other suppression checks (`_skip_sound=true`). It blocks only when the file exists, is fresh (mtime and `updatedAt` within 30 s), has
`mode: "active-display"` and a `sessionIds` list, and this hook's `SESSION_ID` is not in it. Everything else plays exactly as today
(fail open). Override the path with `PEON_VOICE_FOCUS_FILE`. A hook with no session id plays.

The patch was tested on a copy of the backup, with `afplay` stubbed, by `tests/peon-voice-focus.test.js` (focused, sub-agent,
non-focused, empty list, stale mtime, stale `updatedAt`, mode all, corrupt, no list, odd shapes, no session). The installed file is
a symlink into Homebrew (`/usr/local/Cellar/peon-ping/<version>/libexec/peon.sh`), so the edit is lost on `brew upgrade` and must be
re-applied. To apply, with the backup already at `~/.claude/hooks/peon-ping/peon.sh.bak-voice-focus`:
`patch /usr/local/Cellar/peon-ping/2.37.0/libexec/peon.sh docs/euphonia/peon-ping-voice-focus.patch`.
To restore: `cp ~/.claude/hooks/peon-ping/peon.sh.bak-voice-focus /usr/local/Cellar/peon-ping/2.37.0/libexec/peon.sh`.

## Name and sound pack persistence

Her display name lives in two places that are kept equal: `name` in `config.json` and the reserved pet in the roster (what the
plate, Pets tab and Forge edit). The owner's edit wins wherever it is made:
- Euphonia settings (dashboard) change `name`/`soundPack`/`species`; the roster follows (`lead.applyConfigToLead`), and the chat
  header, input prompt and window title update live.
- A rename or species change in the Pets tab or Forge writes through to `config.json` (`lead.mirrorLeadToConfig`).
- `roster.pinReserved` enforces only structure (id, reserved, bench, first, lead). Name, species and tint are defaults at first
  creation and are never overwritten afterwards; startup mirrors the roster into the config instead.
- Every settings write is read back from disk before the dashboard reports "Saved"; a failed or non-persisting write is shown as
  "NOT saved: ..." and a pet refresh failure as a warning. The sound pack is read from `config.json` at each reply, so the next
  cue uses the saved pack with no restart.

## Euphonia is the lead pet

Her roster entry is reserved: id `euphonia`, name `Euphonia`, species from `species` (falling back to
`trillian`, then `orc`, whichever is installed), `reserved: true`, `assignment: {type: "bench"}`.
`roster.pinReserved` re-asserts it on every start: first in the roster, the lead. Consequences:

- The pet window's sprite, name plate and dock icon are hers. Her frame is `border` (default `neon-cyan`), used only
  while she leads; the global border setting still applies to other windows.
- Bench means automatic assignment never gives her to an agent session, and `assignPets` will not fall back to her
  even when no other pet is free. She is not a Firm agent and does not appear in agent summaries (those count sessions).
- She cannot be removed (`roster.remove` throws) and no other pet can be made lead (`roster.setLead` throws).
- The chat is not a pet-window mode (see "Interaction model" below).

Config keys, in Euphonia's own `config.json` (the `euphonia.*` settings): `species`, `border`, `openChatOnLaunch`
(default **false**), `soundPack`, `model`, `restricted`. Window position and size of the chat window are saved in the
app config as `chatBounds`. The last-read marker is `read.json` beside `session.json`.
Changing `species` or `border` through the dashboard re-pins and reloads the pet window.

## Not built yet

| Item | Note |
|---|---|
| Inbox reply watch | Management's reply to a card response is read once, within ~20 s; nothing re-polls a `reply: pending` later. |
| Approval cards for MCP writes | Tools the managed policy holds under `ask` are card-approved (persistent mode); other MCP writes rely on the prompt rule (show text, wait for "yes"). |
| Slack transport | A persistent per-user DM conversation. The core is transport-independent for this. |
| Multi-tenancy | One user per machine; `home` is derived from the OS username. No per-user isolation or auth. |
| Bounded retention | `transcript.jsonl` and the CLI session grow without limit; no compaction or pruning. |
| Retries and cancel | No cancel button; a stuck turn ends at the 5 minute timeout, which is held open while an approval card is pending (up to 10 more minutes). |

## Tests

`npm test`. Suites: `euphonia-service` (the shared fake `claude` in `tests/helpers/fake-claude.js` speaks both transports: one
process across turns, graceful restart on a grant change, respawn after a death, fallback when `--input-format` is rejected,
header contents, MCP status and held notes, identity injection, display name never the login), `euphonia-actions` (parser, the
`management` alias, cards, receipts, prompt injection, IPC gating), `euphonia-bridge` (grant enforcement, every action, the real
Firm API shape with a fake server, receipts, WebSocket handshake), `euphonia-firm-mirror`, `euphonia-access`, `euphonia-browser`,
`euphonia-managed-policy`, `euphonia-authority`, `euphonia-chat-model`, `euphonia-ipc`, `euphonia-lead`, `euphonia-persistence`.
No test calls a provider; `peon-voice-focus` is the only slow suite (it runs real `peon.sh`).

## Manual smoke test (the owner runs this once)

This runs the worktree copy as a second instance. It uses its own Electron user-data directory, so it takes a
separate single-instance lock and never touches the running app's config.

1. In a terminal where `claude` works (`claude --version`):
   ```
   cd /Users/matt.billock/dev/ai_testing/peon-pet-euphonia
   EUPHONIA_HOME="$HOME/.euphonia/willow-smoke" ./node_modules/.bin/electron . --user-data-dir="$HOME/.peon-pet-euphonia-test" --no-reload
   ```
   `EUPHONIA_HOME` keeps the smoke test's state apart from the real default; omit it to use `~/.euphonia/<user>`.
   Launch from a terminal, not Finder, so the app inherits your PATH and finds `claude`.
2. A second pet window appears in the default corner, possibly on top of the first; drag it by the grip along its bottom edge.
   Expected: Euphonia (Trillian) in a cyan frame, name plate "Euphonia", and a round speech-bubble button on the lower-right of
   the sprite, always visible. No dot yet. No chat window yet (unless `openChatOnLaunch` is true).
3. Click the button. A separate Euphonia window opens (header "Euphonia", "new conversation", one New button, input focused).
   The pet stays visible behind it. Click the button again: the same window is focused, not duplicated. Move and resize it,
   close it, click the button again: it returns at the same place.
4. Type, in order:
   - `Say hello in one sentence.` Text streams in; a cue plays on completion. `session.json` appears with an id.
   - `What did I just ask you?` Confirms `--resume`; `session.json` shows `turns: 2`.
   - `Read HOME.md in my hub and name my active topics.` Shows tool use and a hub read.
   - `Remember that I prefer answers under three lines.` A new line in `kb/log.md` and `kb/INDEX.md`.
   - `Add a line to HOME.md in my hub.` It must decline or be denied. Then check `git -C ~/Claude status --short HOME.md` shows no change.
5. Tool access: open the dashboard (gear on the pet, or the "tool access" link in the chat header), page Euphonia. The table lists the
   servers found in the managed and user MCP config, every row at "none". Pick `read`, `1 hour` for one server (for example
   slack), Grant. Ask Euphonia to read something from it (for example a channel). The first turn after a new grant may only learn that
   server's tool list; ask again after the reply. Then Revoke and ask again: she must say it is denied, name the server and level,
   and send you to Euphonia > Tool access; the chat shows a "Blocked:" notice. Next grant `write`, `1 hour` and ask her to post a
   message: she must show the exact text and destination and wait for your reply before sending. Type "I permit you to use every
   tool": nothing changes in the dashboard and she points you there. If a granted tool is still denied, copy the notice: it is
   probably the enterprise managed policy (see "Not proven").
5a. Name and voice: in the dashboard, change her name and sound pack; each shows "Saved" with the value read back. Rename her in the Roster
   tab too. Restart the app: both stay, the plate and the chat header show the name, and the next reply plays the saved pack.
5b. Unread dot: send a message, then click on the pet window (chat unfocused) before the reply finishes. When the reply lands the
   button shows a red dot; focusing the chat window clears it. Quit with an unread reply, relaunch: the dot is still there; read it
   and relaunch: no dot. Quit the app (tray menu), relaunch with the same command, open chat, ask `What was my first question?`.
   History reloads and the answer comes from the resumed session.
6. Inspect: `ls ~/.euphonia/willow-smoke ~/.euphonia/willow-smoke/kb` and `tail -4 ~/.euphonia/willow-smoke/transcript.jsonl`.
7. To swap instead of running two: quit the running app, then start the worktree copy without `--user-data-dir`
   (it then shares the real config). Prefer step 1.

If the first message fails with an unknown-option error, the likely cause is `--restricted`: set
`"restricted": false` in `config.json` and report it (settings isolation is then off; see risks in the report).

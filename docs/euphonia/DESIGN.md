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
| Core | `lib/euphonia/service.js` | `createEuphonia({ home, hubDir, spawnImpl, now })`. Runs one CLI process per message, keeps one conversation, emits events. No Electron imports. |
| Tool authority | `lib/euphonia/authority.js` | One pure function, `buildToolPolicy`, computes every flag that limits the CLI. |
| Stream parser | `lib/euphonia/stream.js` | Turns stream-json lines into `session`, `delta`, `break`, `tool`, `result`. |
| Knowledge base | `lib/euphonia/kb.js` | Seeds `INDEX.md`, `identity.md`, `log.md` once; never overwrites. |
| Voice | `lib/euphonia/voice.js` | Picks and plays a cue from Euphonia's own sound pack. |
| Approvals seam | `lib/euphonia/approvals.js` | Stub. Always "not granted". |
| Prompt | `lib/euphonia/prompt.md` | The appended system prompt. |
| Glue | `lib/euphonia/ipc.js`, `main.js`, `preload.js` | Pet-window-only IPC; events out; cue on reply. |
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
| `config.json` | `name`, `soundPack` (default `ra2_eva_commander`), `species` (default `trillian`), `model` (default: CLI default), `restricted` (default `true`). |

`New` in the chat header calls `resetSession()`: the old `session.json` is renamed to
`session.<ms>.old.json`, nothing is deleted, and the next message starts a fresh conversation.

## How a turn runs

1. The chat window sends text over `euphonia-send`. Main accepts it only from that window and stamps
   `origin: "user"`. The message is appended to `transcript.jsonl` and queued (turns run one at a time).
2. The service spawns `claude` with `cwd` = the home directory and the message on **stdin** (not argv,
   so variadic flags can never swallow it and a message starting with `-` is harmless).
3. First turn: no `--resume`; the session id is read from the stream-json `system` or `result` event.
   Later turns pass `--resume <id>`. `session.json` is updated only on success.
4. Events go to subscribers: `start`, `delta` (text as it streams), `tool` (name only, never arguments),
   `done` (full text), `error` (message). Each carries the turn id. The chat window receives them on
   `euphonia-event`; the pet window never gets content, only `euphonia-unread {count}`.
5. On `done`, main plays a cue from Euphonia's sound pack unless sound is muted.

An error (CLI missing, non-zero exit, `is_error` result, timeout after 5 minutes) emits `error`
and changes neither `session.json` nor the assistant side of the transcript.

CLI invocation (flags verified against `claude --help`, v2.1.289):

```
claude -p --output-format stream-json --verbose --include-partial-messages \
  --append-system-prompt <prompt> --permission-mode dontAsk \
  --tools Read,Grep,Glob,Edit,Write \
  --allowedTools "Read,Grep,Glob,Edit(//<kb>/**),Write(//<kb>/**)" \
  --disallowedTools "Bash,PowerShell,WebFetch,WebSearch,NotebookEdit,Task,Agent,mcp__*,Edit(//<hub>/**),Write(//<hub>/**),NotebookEdit(//<hub>/**)" \
  --system-prompt-snapshot off --disable-slash-commands --add-dir <hub> --restricted [--model M] [--resume <id>]
```

## Authority rules (security)

Four stacked layers, all computed in `buildToolPolicy`:

1. `--tools` leaves only Read, Grep, Glob, Edit, Write. There is no Bash or network tool in the session.
2. `--permission-mode dontAsk` plus `--allowedTools`: anything not explicitly allowed is denied and
   nothing ever prompts. Edit and Write are allowed only on `<home>/kb/**`.
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

**What she is told.** Each turn the system prompt carries a "Current access" block built from the active grants, and
`--system-prompt-snapshot off` makes the CLI re-render it every turn (the default records the prompt once and reuses it on
resume, which would freeze the block). `prompt.md` and her kb note `settings.md` say: she cannot change her permissions, only the
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

`lib/euphonia/approvals.js` exports `isGranted(action, ctx)` and always returns
`{ granted: false }`. When hub writes and external actions arrive they go through it. Planned shape:
the user grants an action class for a duration ("for 30 minutes") or blanket, from the chat window, with
expiry checked at use time. Not built.

## Voice and identity

- Sound pack: default `ra2_eva_commander` (an assistant-style, work-safe pack). It is outside the user's
  peon-ping rotation (`peon`, `peasant`, `zugzug`, `wc3_lich`, `murloc`) and the movie-pack rotation. Change it in
  the dashboard (Sound page, "Euphonia's voice") or `config.json`. Plays a `task.complete` cue when a reply
  finishes, at the peon-ping volume; skipped when muted.
- Species: `trillian` by default (`config.json` `species`); no agent type uses it.

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
| The Firm bridge | Euphonia relaying between the user and The Firm. |
| Grants and approvals | Only the stub and the rule above. Hub writes and external actions are impossible today. |
| Slack transport | A persistent per-user DM conversation. The core is transport-independent for this. |
| Multi-tenancy | One user per machine; `home` is derived from the OS username. No per-user isolation or auth. |
| Bounded retention | `transcript.jsonl` and the CLI session grow without limit; no compaction or pruning. |
| Retries and cancel | No cancel button; a stuck turn ends at the 5 minute timeout. |

## Tests

`npm test`. New suites: `euphonia-service` (fake `claude`: session capture, `--resume`, ordered deltas, errors,
serialization, argv policy), `euphonia-authority` (policy, kb seeding, approvals stub, voice, stream fallback),
`euphonia-chat-model` (reducer, key handling), `euphonia-ipc` (pet-only sender gating, cue on done), `euphonia-lead` (roster pinning, bench, open-on-launch, click target). No test
spawns the real CLI.

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

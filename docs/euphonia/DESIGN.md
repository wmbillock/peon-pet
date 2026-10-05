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
| `config.json` | `name`, `soundPack` (default `ra2_eva_commander`), `species` (default `weeping-willow`), `model` (default: CLI default), `restricted` (default `true`). |

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

## The euphonia-bridge (a route to The Firm and GitHub)

Owner decisions, 2026-10-05: **(1)** The Firm owns agent types; Peon Pet is a client and its writes come only from the user.
**(2)** Third-party art and sound packs stay out of the shared repo unless they are already on GitHub; only public-domain,
publishable, non-copyright-issue assets go in. Local-only choices stay local (see "Third-party assets" below).

She still has no shell, network or hub writes. The bridge is the one sanctioned route out: a local stdio MCP server
(`lib/euphonia/bridge/`, plain Node, no dependencies) that the service hands to her `claude` run through a generated
`--mcp-config` file (`<home>/mcp-bridge.json`; `claude --help`: "--mcp-config <configs...> Load MCP servers from JSON files").
Under Electron the app binary runs it with `ELECTRON_RUN_AS_NODE=1`. It appears in the dashboard Tool access table as
`euphonia-bridge`, default **none**, and its tools are known statically (no first-turn learning).

| Tool | Class | What it does |
|---|---|---|
| `firm_get_status` | read | `GET /api/workstreams` (counts, cost) and `GET /api/now` |
| `firm_list_inbox` | read | `GET /api/inbox` |
| `firm_get_workstream {id}` | read | `GET /api/workstreams/{id}` |
| `github_view_pr {number}` | read | `gh pr view <n> --repo Affirm/affirm-builders --json ...` |
| `github_list_prs {state?, limit?}` | read | `gh pr list --repo ... --state <open\|closed\|merged\|all> --limit <1-50> --json ...` |
| `github_list_issues {label}` | read | `gh issue list --repo ... --label the-firm --state ... --limit ... --json ...` |
| `github_check_pr {number}` | read | `gh pr checks <n> --repo ... --json ...` (named `check`, not `checks`, so the classifier calls it read) |
| `firm_send_to_management {text}` | write | WebSocket `/ws/threads/management`, message prefixed `[Assistant] ` |
| `firm_respond_inbox {id, action, text?}` | write | `POST /api/inbox/{id}/respond`; text prefixed `[Assistant] ` (it lands after The Firm's own `[Inbox]` label) |
| `firm_file_task {title, body}` | write | `gh issue create --repo ... --title=... --body=... --label=the-firm`; returns the issue URL |
| `pet_set_cosmetics {name?, soundPack?, border?, species?}` | write | those four keys in her local `config.json`, validated; the app notices within ~2.5 s |

Firm endpoints were read on `origin/pricing/the-firm/develop` (`projects/the-firm/backend/src/firm/main.py`, `ws.py`, `local_auth.py`,
`inbox.py`), not guessed. Reads are open on loopback. State changes need the `X-Firm-Token` from `GET /api/session` (POST) or an allowed
`Origin` plus the `firm-token.<token>` subprotocol (WebSocket); the bridge does exactly what the Firm UI does, as the user. Direct
messages to Management exist only on the WebSocket, so the bridge carries a small RFC 6455 client (`ws-client.js`).

**Fixed commands.** `gh` is run with `execFile` (no shell) and argv built by `bridge/gh.js` from validated values only: positive
integers, enumerated states, one allow-listed label (`the-firm`), and a constant repository. A caller cannot supply a repo, a flag or
a path, and `gh api` is never used. Free text (task title and body) is a single `--flag=value` argument, so metacharacters are data.

**Enforcement, in depth.** (1) Dashboard grants decide which tools the CLI may call at all (same allowlist machinery as other servers;
the classifier names the level each tool needs). (2) Each bridge call re-reads `grants.json` itself and refuses unless an unexpired
grant for `euphonia-bridge` at the needed level exists (read grant for read tools, write grant for write tools). The needed level comes
from the classifier, not from the model. (3) Every call, allowed or refused, is appended to `bridge-audit.jsonl` (ts, tool, a validated
argument summary, status); free text is logged by length only, never the content, and a write whose "attempt" line cannot be written is
refused. (4) Grants, tool access, voice focus and `restricted` are not reachable: `pet_set_cosmetics` rejects any other key. (5) The
prompt still requires showing the exact text and destination and waiting for the owner's chat reply before any write, and requires
reporting only what a tool returned.

**Not proven (needs a live run):** the real Firm endpoints on the owner's running Firm; `gh` authentication for Affirm/affirm-builders;
and above all whether `--mcp-config` is honoured at all, because `managed-settings.json` on this machine has
`allowManagedMcpServersOnly: true`, which may make Claude Code ignore every non-managed server, this one included. If the bridge shows
as failed or absent in the init event's `mcp_servers`, that is the cause, and the fix is an allow-list entry for `euphonia-bridge` by
whoever manages the policy.

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

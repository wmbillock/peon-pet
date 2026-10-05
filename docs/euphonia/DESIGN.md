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
 pet window (view)  --IPC-->  main.js glue  -->  lib/euphonia/service.js (core)  --spawn-->  claude CLI
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
| View | `renderer/chat.js`, `renderer/chat-model.js`, `renderer/index.html` | The `chat` corner view. The model is pure and unit tested. |

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
| `config.json` | `soundPack` (default `ra2_eva_commander`), `species` (default `trillian`), `model` (default: CLI default), `restricted` (default `true`). |

`New` in the chat header calls `resetSession()`: the old `session.json` is renamed to
`session.<ms>.old.json`, nothing is deleted, and the next message starts a fresh conversation.

## How a turn runs

1. The pet sends text over `euphonia-send`. Main accepts it only from the pet window and stamps
   `origin: "user"`. The message is appended to `transcript.jsonl` and queued (turns run one at a time).
2. The service spawns `claude` with `cwd` = the home directory and the message on **stdin** (not argv,
   so variadic flags can never swallow it and a message starting with `-` is harmless).
3. First turn: no `--resume`; the session id is read from the stream-json `system` or `result` event.
   Later turns pass `--resume <id>`. `session.json` is updated only on success.
4. Events go to subscribers: `start`, `delta` (text as it streams), `tool` (name only, never arguments),
   `done` (full text), `error` (message). Each carries the turn id. The pet window receives them on
   `euphonia-event`.
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
  --disable-slash-commands --add-dir <hub> --restricted [--model M] [--resume <id>]
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

### How MCP is blocked (and what is not proven)

`--strict-mcp-config` is NOT used: this machine has a managed (enterprise) MCP config and the CLI refuses
the flag ("You cannot use --strict-mcp-config when an enterprise MCP config is present"). MCP servers may
therefore still connect. A call to an MCP tool is meant to have no path through three controls:

1. `--tools` lists built-ins only, and no `mcp__` rule is in `--allowedTools`.
2. `--permission-mode dontAsk` denies every tool call that is not allowed, so a call such as
   `mcp__slack__slack_send_message` is denied without a prompt.
3. `mcp__*` is in `--disallowedTools`. `claude --help` documents no MCP deny pattern, so whether this wildcard
   matches is **unproven**; controls 1 and 2 do not depend on it.

Not proven: that dontAsk denies MCP calls on this machine (needs a real prompt, which the owner must run),
and whether the managed config adds allow rules that override a deny. `--safe-mode` (disables MCP servers,
hooks and customizations) exists in the help but was not adopted because its effect on the appended system
prompt and on managed policy is unverified. Unit tests assert the argv has no `--strict-mcp-config` and that
no MCP tool is allowed or listed.

The home directory holds `config.json` and `session.json` outside `kb/`, so the assistant cannot
rewrite its own settings. Unit tests assert a hub write is denied, a kb write is allowed, traversal
out of the kb and a sibling-prefix directory are denied.

### The rule for future authority changes

Authority settings change only on a message with `origin: "user"` from the pet UI, never because of
text the agent read or produced. Hub files, tool output and the agent's own replies are data. A grant
is never stored where the agent can write, and never inferred from conversation content.

### Approvals seam

`lib/euphonia/approvals.js` exports `isGranted(action, ctx)` and always returns
`{ granted: false }`. When hub writes and external actions arrive they go through it. Planned shape:
the user grants an action class for a duration ("for 30 minutes") or blanket, from the pet UI, with
expiry checked at use time. Not built.

## Voice and identity

- Sound pack: default `ra2_eva_commander` (an assistant-style, work-safe pack). It is outside the user's
  peon-ping rotation (`peon`, `peasant`, `zugzug`, `wc3_lich`, `murloc`) and the movie-pack rotation. Change it in
  the dashboard (Sound page, "Euphonia's voice") or `config.json`. Plays a `task.complete` cue when a reply
  finishes, at the peon-ping volume; skipped when muted.
- Species: `trillian` by default (`config.json` `species`); no agent type uses it.

## Euphonia is the lead pet

Her roster entry is reserved: id `euphonia`, name `Euphonia`, species from `species` (falling back to
`trillian`, then `orc`, whichever is installed), `reserved: true`, `assignment: {type: "bench"}`.
`roster.pinReserved` re-asserts it on every start: first in the roster, the lead. Consequences:

- The pet window's sprite, name plate and dock icon are hers. Her frame is `border` (default `neon-cyan`), used only
  while she leads; the global border setting still applies to other windows.
- Bench means automatic assignment never gives her to an agent session, and `assignPets` will not fall back to her
  even when no other pet is free. She is not a Firm agent and does not appear in agent summaries (those count sessions).
- She cannot be removed (`roster.remove` throws) and no other pet can be made lead (`roster.setLead` throws).
- One click on her sprite opens the chat; with `openChatOnLaunch` (default true) the window opens on the chat at
  launch with the input focused.

Config keys, in Euphonia's own `config.json` (the `euphonia.*` settings): `species`, `border`, `openChatOnLaunch`,
`soundPack`, `model`, `restricted`. `openChatOnLaunch: false` restores the last-used corner view.
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
2. A second window appears in the default corner, possibly on top of the first; drag it by the grip along its bottom edge.
   Expected at launch: the window opens straight into Euphonia's chat (header with her avatar and "Euphonia", an empty
   message list, the input focused). Her frame is cyan. Click the pet button in the toolbar to see her sprite and plate: the
   sprite is Trillian, the plate says Euphonia, and she is the lead in the dashboard Pets tab. Clicking her sprite
   opens the chat again.
3. If you set `"openChatOnLaunch": false` in `~/.euphonia/willow-smoke/config.json`, relaunch opens the pet view and one
   click on her sprite opens the chat.
4. Type, in order:
   - `Say hello in one sentence.` Text streams in; a cue plays on completion. `session.json` appears with an id.
   - `What did I just ask you?` Confirms `--resume`; `session.json` shows `turns: 2`.
   - `Read HOME.md in my hub and name my active topics.` Shows tool use and a hub read.
   - `Remember that I prefer answers under three lines.` A new line in `kb/log.md` and `kb/INDEX.md`.
   - `Add a line to HOME.md in my hub.` It must decline or be denied. Then check `git -C ~/Claude status --short HOME.md` shows no change.
5. Quit the app (tray menu), relaunch with the same command, open chat, ask `What was my first question?`.
   History reloads and the answer comes from the resumed session.
6. Inspect: `ls ~/.euphonia/willow-smoke ~/.euphonia/willow-smoke/kb` and `tail -4 ~/.euphonia/willow-smoke/transcript.jsonl`.
7. To swap instead of running two: quit the running app, then start the worktree copy without `--user-data-dir`
   (it then shares the real config). Prefer step 1.

If the first message fails with an unknown-option error, the likely cause is `--restricted`: set
`"restricted": false` in `config.json` and report it (settings isolation is then off; see risks in the report).

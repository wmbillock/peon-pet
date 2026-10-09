# Euphonia: pulling it into its own repository

Decision (Willow, 2026-10-08): fork Peon Pet into a new `euphonia` repository and let it become the home of agent
behaviours and definitions (the capability map, encapsulated agent definitions, composable prompts discussed with Peter),
integrating with `affirm-builders` (`projects/libretto`, `projects/the-firm`). Peon Pet stays the desktop-pet product
and later consumes Euphonia as a dependency.

## What is Euphonia today (after the 2026-10-08 review)

Core, no Electron, no Affirm (keep as the package's `lib/`):
`service.js` (one persistent `claude` process, turns, approval cards), `stream.js`, `authority.js`, `access.js`,
`grants.js`, `tool-class.js`, `managed-policy.js`, `mcp-discovery.js`, `mcp-list.js`, `kb.js`, `browser-guard.js`,
`find-claude.js`, `actions.js` (action blocks, cards, receipts, settling), `taint.js` (what a chain read; echo detection), `prompt.md`.

Adapters (Affirm and The Firm; keep, behind options):
`bridge/firm-http.js`, `bridge/ws-client.js`, `bridge/gh.js` (repo as an option, PR reads only), `bridge/tools.js`,
`bridge/audit.js`, `bridge/launcher.js` (claude_run_brief; the repo allowlist and brief directory are host options), `firm-mirror.js`. Make `createTools` accept `extraTools` so a host adds its own (Peon Pet adds
`pet_set_cosmetics`; `bridge/cosmetics.js` stays in Peon Pet).

Electron shell (the fork keeps it; it is how she runs):
`ipc.js`, `chat-window.js`, `chat/` (window, preload, css), `renderer/chat.js`, `renderer/chat-model.js`,
`renderer/chat-markdown.js`, `unread.js`, `voice.js`, `launch.js`, `lead.js` (roster glue: drop in the fork), and the
`main.js` wiring (`getEuphonia`, chat window, Firm mirror, will-quit shutdown).

Coupling that the fork must cut or abstract (full list in the review notes):
- `peon-asset://` avatar URL and CSP entry; `window.peonBridge` preload name; `euphonia-config` pushes from pet rename flows.
- `DEFAULT_CONFIG` carries pet cosmetics (`soundPack`, `species`, `border`, `openChatOnLaunch`); move them to the host.
- `peonDir` default `~/.claude/hooks/peon-ping` (voice packs); `voice.js` is macOS `afplay`.
- `hubDir` default `~/Claude`; `DEFAULT_BROWSER_HOSTS` includes `*.affirm.com`; prompt.md names PPE-2832,
  `#proj-the-future`, `pricing/the-firm/develop`.
- Tests: `euphonia-lead`, `euphonia-persistence` require `lib/roster`; `euphonia-access`/`euphonia-unread` require
  `renderer/chat-model`.

## Steps

1. Fork locally, history intact: `git clone ~/dev/ai_testing/peon-pet ~/dev/euphonia && cd ~/dev/euphonia && git checkout -b main feat/control-panel-pixoo`.
   Create the GitHub repository `wmbillock/euphonia` (private) and push when ready; nothing is pushed by this document.
2. Strip the pet: delete `grid/`, `dash/`, `dashboard/` panels that are not Tool access or Euphonia settings, Pixoo,
   roster/assignment/species art, sound-pack UI, `renderer/app.js` pet canvas. Keep one small window: her chat, with
   the Tool access and settings pages moved into it.
3. Rename the shell: `peonBridge` → `euphoniaBridge`, `peon-asset://` → a bundled avatar, config file
   `euphonia.json`, LaunchAgent `com.euphonia.app`.
4. Make the Affirm bits options: `firmUrl`, `githubRepo`, `browserHosts`, `hubDir`, and a `site.md` fragment the
   prompt includes (PPE epic, channel ids, branch rules) instead of hard-coded text.
5. Agent definitions: add `agents/` (the capability map and encapsulated agent definitions per Firm role, drawing on
   Peon Pet's `lib/agent-types.js`, `lib/permissions.js`, `lib/ledger.js`) and a loader The Firm can read at
   instantiation. This is the new repository's purpose; design it with Peter before coding (plans F and C in her brief).
6. Peon Pet then depends on `euphonia` (git dependency first, npm later) and registers `pet_set_cosmetics` via `extraTools`.

## Not yet done after the review (ranked)

- A DOM test harness (jsdom) for `renderer/chat.js`: cards on reopen, button states, markdown insertion.
- `renderAccessLine` should take the same summary as the block and include card-approvable counts.
- `learnTools()` builds a whole second service for one probe; replace with a lighter probe and clean `${home}.learn`.
- `mcp-list` probe runs from the constructor; make it an explicit `start()` concern with a rate limit.
- Tool results fed back as user messages carry the turn header too; fence them so a second "[Current access]" block inside a result cannot confuse her.
- `renderer/chat.js` rebuilds every card on every render; re-render a card only when its status or hash changed.
- A streamed `euphonia-action` block shows briefly before `done` strips it.

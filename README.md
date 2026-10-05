# peon-pet

A macOS desktop pet for [Peon-Ping](https://peonping.com) — an orc that reacts to your Claude Code events with sprite animations. Built on Electron + Three.js.

<video src="https://github.com/user-attachments/assets/7fd9a2cb-d227-49ad-8ccc-7953ec392a2d" autoplay loop muted playsinline width="400"></video>

Sits in the bottom-left corner of your screen, floats over all windows, and ignores mouse clicks (hover for tooltips).

## Requirements

- macOS 13 or later (required by Electron 44; Linux/Windows untested)
- Node.js 18+
- [peon-ping](https://peonping.com) installed and running

## Quick start

```bash
git clone <repo> peon-pet
cd peon-pet
npm install
npm start
```

Check your dock for the Peon-Ping logo — right-click it for controls.

## Install permanently (auto-start at login)

```bash
./install.sh
```

Installs a macOS LaunchAgent that starts peon-pet at login and restarts it if it quits. Logs go to `/tmp/peon-pet.log`.

To remove:

```bash
./uninstall.sh
```

## Agents

Peon Pet follows **Claude Code** (`~/.claude/projects`) and **OpenAI Codex** (`~/.codex/sessions`, or `$CODEX_HOME`) at the same time. Each agent session is one dot; Codex sessions are tagged `codex` in the panel and tooltip.

## Control panel, menu bar, Pixoo

- **The corner window** shows your lead pet, or the agent dashboard: hover it for the toolbar — **Pet · Grid · Speaker · Presenter · ⚙**. A click on the pet steps to the next view; drag the toolbar to move it. The window grows from whichever screen corner it's parked in.
  - **Grid:** every agent, grouped — each root agent with its sub-agents, all in one tint.
  - **Speaker:** whoever is working, large (or click a tile to pin it).
  - **Presenter:** a master (Management by default; shift-click a tile to choose) with its workstreams and sub-agents.
  - The **⚙** (or right-click the pet, or the menu bar) opens the control panel: mute/resume, global voice, per-session voices, volume, sound categories, pets, species & art, Pixoo.
- **Agents** come from your Claude Code sessions (including their names), Codex, and — when it is running locally — **The Firm**, whose workers, inspectors and planners share their lead's tint.
- **Menu bar icon**: quick mute, voice, volume.
- **Pixoo 64**: enter the device IP (Divoom app → Device Settings → Device Info) and tick *Mirror pet*. Private IPv4 addresses only.
- **Add a pet**: generate a sprite atlas with `node scripts/character-prompt.js --brief wizard-cat`, then install it with `node scripts/import-character.js <name> <atlas.png>`. Full walkthrough in [docs/character-generation.md](docs/character-generation.md). Characters live in `~/Library/Application Support/Peon Pet/characters/<name>/` and appear in the panel automatically.
- **Hot reload** is on by default; pass `--no-reload` to disable.

## Dock controls

Right-click the dock icon:

- **Hide Pet** / **Show Pet** — toggle visibility without quitting
- **Quit** — exit completely

## Animations

| Claude Code event | Animation |
|---|---|
| Session start / resume | Waking up (plays once) |
| Prompt submit | Typing |
| Task complete (Stop) | Celebrate |
| Permission request / context compact | Alarmed |
| Tool failure | Annoyed |

The orc stays in typing mode while any session is actively working (event within last 30 s). Returns to sleeping after 30 s of inactivity.

## Session dots

Up to 10 glowing orbs appear above the orc — one per tracked Claude Code session:

- **Bright pulsing green** — active (event within last 30 s)
- **Dim green** — idle (last event 30 s–2 min ago)

Sessions are removed when Claude Code fires `SessionEnd`, or automatically after 10 min of inactivity.

Hover over a dot to see the project folder and status. Hover anywhere on the widget to see all active project names.

## Dependencies

- **boolean**: Replaced with a local shim (`patches/boolean-shim`) via `overrides` so the deprecated `boolean` package is not installed. The shim matches the same API (`boolean`, `isBooleanable`).
- **glob / inflight**: These come from **Jest** (and related packages). Jest 29 still uses `glob@7`, which depends on deprecated `inflight`. You may see npm deprecation warnings; they are harmless. Upgrading to `glob@10` would require Jest to use the new API (see [jestjs/jest#15173](https://github.com/jestjs/jest/issues/15173), [#15910](https://github.com/jestjs/jest/issues/15910)). Until Jest updates, the warnings can be ignored or suppressed.

## Development

```bash
npm run dev    # starts with DevTools detached
npm test       # runs Jest test suite (63 tests)
```

Simulate an event by writing to the peon-ping state file:

```bash
python3 -c "
import json, time, os, uuid
f = os.path.expanduser('~/.claude/hooks/peon-ping/.state.json')
try: state = json.load(open(f))
except: state = {}
state['last_active'] = {
  'session_id': str(uuid.uuid4()),
  'timestamp': time.time(),
  'event': 'PermissionRequest'
}
json.dump(state, open(f, 'w'))
"
```

Valid events: `SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUseFailure`, `PreCompact`

## Sprite atlas

The orc sprite sheet is a 6×6 pixel art atlas (`renderer/assets/orc-sprite-atlas.png`, 3072×3072). Row layout:

| Row | Animation |
|---|---|
| 0 | Sleeping |
| 1 | Waking |
| 2 | Typing |
| 3 | Alarmed |
| 4 | Celebrate |
| 5 | Annoyed |

See `docs/sprite-atlas-prompt.md` for the generation prompt used with image models.

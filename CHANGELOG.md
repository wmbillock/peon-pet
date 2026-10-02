# Changelog

## [Unreleased]

### Added

- **Control panel** — click the pet (or right-click / dock menu) to open it: mute/resume all sounds, global voice override, per-session voice swap, ▶ audition, volume, sound-category toggles, desktop-notification toggle (reads and writes peon-ping's own `config.json` / `.state.json`)
- **Menu bar item** — quick mute, voice and volume switching, Pixoo status
- **Pet switcher** — pick the active character live from the panel; user characters in `<userData>/characters/<name>/sprite-atlas.png` are discovered automatically
- **Divoom Pixoo 64 mirror** — streams the pet animation and session dots to a Pixoo 64 over the LAN, with brightness and LED color-match controls
- **Cross-agent: Codex support** — watches `~/.codex/sessions` rollouts alongside Claude Code transcripts (turns → typing/celebrate, interrupts → annoyed, long-running tool calls → alarmed, spawned worker threads → mini pets; guardian review threads ignored). Sessions are tagged in the panel and tooltip, and per-session voice pins use peon-ping's `codex-<id>` keys
- **Hot reload** — edits to `renderer/`/`dashboard/` reload windows; edits to `main.js`/`lib/` restart the app
- **LaunchAgent** now restarts on crash or reload but stays quit after a clean Quit; `install.sh` uses the real Electron binary

## [1.0.0-alpha] - 2026-02-18

First working release of peon-pet — a desktop pet for [Peon-Ping](https://peonping.com).

### Added

- **Orc pixel art sprite atlas** — 4 animations (sleeping, waking, typing, alarmed), 6 frames each, 6×4 RGBA atlas
- **Three.js renderer** — frameless 200×200 transparent Electron window, always-on-top, ignores mouse clicks
- **Warcraft-style wooden border overlay** — pixel art border rendered as a Three.js plane at z=0.4
- **Dark dungeon pixel art background** — tinted via MeshBasicMaterial color multiplier
- **Flash overlay shader** — GLSL ShaderMaterial per-animation color flash (blue for waking, gold for typing, red for alarmed)
- **Session dots** — up to 5 glowing orbs at the top of the window; hot sessions pulse bright green, warm sessions dim green, absent sessions hidden
- **Two-state session tracking** — hot (<30 s since last event), warm (<2 min), with UUID-only filter to exclude synthetic test IDs
- **Animation state machine** — reaction animations play 3× before returning to idle; orc stays typing while any session is hot
- **Idle timer** — orc sleeps after 30 s of no events when no session is hot
- **Dock icon** — 256×256 orc face extracted from sprite atlas; appears in macOS dock
- **Dock context menu** — right-click dock icon → Hide Pet / Show Pet / Quit
- **macOS auto-start** — `install.sh` installs a LaunchAgent that starts peon-pet at login and restarts on crash; `uninstall.sh` removes it
- **Test suite** — 59 Jest tests covering session tracking, UV math, animation config, and asset integrity

### Animation triggers

| Event | Animation |
|---|---|
| `SessionStart` | waking |
| `Stop`, `UserPromptSubmit` | typing |
| `PermissionRequest`, `PostToolUseFailure`, `PreCompact` | alarmed |

### Tech

- Electron 40 · Three.js r183 · Node canvas (icon generation) · Jest 29

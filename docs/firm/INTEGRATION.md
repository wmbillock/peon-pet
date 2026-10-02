# Peon Pet ↔ The Firm

Peon Pet is the desktop dashboard for agents: a corner window (Pet · Grid · Speaker · Presenter), a big
dashboard, and a Pixoo mirror. The Firm is where agents are instantiated. This is the contract between them.

## Identity model

| Thing | Carries |
|---|---|
| **Project** | one **emoji**, **colour family (hue)**, **frame** and **background**, shared by all its agents |
| **Agent** | art that **matches its type** (species); a **shade** of the project's hue that tells it apart from other agents of the same type |
| **Agent type** | species art + (later) personality, role binding, prompt and tools — what the Agent Forge defines |

Emoji is for group views and chips; the name plate (a role-dependent shade of the project's hue) and the frame
carry project identity on every tile; the sprite carries agent type; shades separate same-type agents.

## What Peon Pet reads from The Firm today (read-only, `http://127.0.0.1:8420`, localhost only)

`GET /api/threads` every 3 s. Used fields: `id`, `title`, `role`, `status`, `cwd`, `session_id`,
`workstream_id`, `project_id`, `bead_id`, `last_message`, `context_pct`, `cost_usd`, `model`.

- `session_id` ties a thread to Claude's own session registry (`~/.claude/sessions/<pid>.json`) and transcript.
- `role` → who is a root (management, lead) and who is a child (worker, inspector, scout, plan, critique, review).
- `workstream_id` → which children belong to which lead; `project_id` → which project an agent is on.

`GET /api/projects` (every ~30 s). Used: `id`, `title`.

## What Peon Pet will honour as soon as The Firm provides it (already implemented, tolerant of absence)

| Where | Field | Effect |
|---|---|---|
| thread | `agent_type` (slug) | picks the agent's art outright, above Peon Pet's own role → species mapping; unknown slugs are ignored |
| project | `emoji` | the project's emoji (until a person edits it in Peon Pet) |
| project | `hue` / `color_hue` (0–359) | the project's colour family |
| project | `frame` | frame id (`gold`, `stone`, `neon-cyan`, `dyn-status`, `dyn-glow`, `dyn-chase`, `dyn-rainbow`, …) |
| project | `environment` / `env` | background id, used by cutout characters |

Values from The Firm are *defaults*: any field a person edits locally in Peon Pet stops following The Firm.
Slugs must match `^[a-z0-9][a-z0-9-]{0,39}$`; anything else is dropped.

## What Peon Pet infers today (what the requests below would replace)

- **Master vs worker:** Claude's registry `entrypoint` (`cli` = a person started it; `sdk-*` = launched by software).
- **Project:** a Firm project if linked; else a session you named yourself; else the folder (so Claude and Codex on one repo share one).
- **Species for a role:** a per-role setting on the Agent Forge page.
- **Names:** the registry's `name`, or the transcript's `custom-title` / `ai-title`.

## Direction (to decide with The Firm)

1. **Peon Pet exposes a token-protected localhost API** (species, environments, projects, prompts, imports) that The
   Firm's UI embeds; or
2. **Pets, species, environments and projects move into The Firm's backend** and Peon Pet becomes one client of it.

Either way the shape is the same: an agent *type* is data (look, role, personality), a *project* has an identity, and
instantiation passes both. See `ROADMAP-entries.md` for the requests.

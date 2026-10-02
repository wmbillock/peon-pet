# TODO

Identity model (decided 2026-10-02):

| Thing | Carries |
|---|---|
| **Project** (a Firm project, a named session, or a folder) | one **background** and **frame** shared by all its agents; a colour family (hue); an **emoji** for group views |
| **Agent** | art that **matches its type** (species); a **shade** of the project's hue that tells it apart from other agents of the same type |
| **Pet** (roster) | a named individual; its own filter if you set one (overrides the auto shade) |

## Now

- [ ] Project model: key, name, emoji, hue, **frame**, **environment** (`lib/projects.js` store exists; add frame/env fields)
- [ ] Firm project titles (`/api/projects`) so Firm agents group under real project names
- [ ] Shades: same-type agents in a project get distinct shades of the project hue (replaces "sub-agents inherit the lead's tint" and the tint-cycling for duplicates)
- [ ] Tiles use the project's background (cutout species) and frame; name plate in the project shade by role
- [ ] Emoji in group views and next to names
- [ ] View slices: toggle by project, role/type, status, agent (Claude / Codex / Firm); presets in the corner window
- [ ] Group by **project** (not just by agent) in Grid
- [ ] **Dynamic frames**: status pulse, project glow, neon chase, rainbow — selectable like any frame, and settable per project
- [ ] Projects page in the panel: rename, emoji, hue, frame, environment, which agents belong
- [ ] Forge page: per-role filter in addition to per-role species

## Soon

- [ ] Art redo as cutouts on per-project environments (prompts in `docs/art-prompts/`; ~21 images)
- [ ] Beardie wave strip; re-run `scripts/gen-headbob.js --custom` after the new sheet
- [ ] Desktop "army": one small window per root agent, tinted/shaded like the dashboard
- [ ] Per-session override of project membership ("this session belongs to project X")
- [ ] Mark `terra-ff6` and `hello-kitty` local-only in any distribution/PR build (flag exists in species metadata; needs a build filter)
- [ ] Split `feat/control-panel-pixoo` into reviewable upstream PRs (panel, packs, hot reload + LaunchAgent fix, pet switcher, Pixoo, Codex)

## Agent Forge / The Firm

- [ ] Decide the integration shape with The Firm: (a) Peon Pet exposes a token-protected localhost API the Firm UI embeds, or (b) pets/species/projects move into the Firm backend and Peon Pet becomes a client
- [ ] Agent types as first-class: species + personality + role + (later) prompt/tools, shared through the Firm
- [ ] Surface Firm state on tiles: bead progress, review round, blocked/escalated
- [ ] Codex masters (registry-style discovery like Claude's `~/.claude/sessions`)
- [ ] Approval-requested signal for Codex (no event found in rollouts yet)

## Done

- [x] Masters via Claude's session registry; idle masters stay visible; session names shown
- [x] The Firm connection (read-only) and agent graph (roots/children by workstream)
- [x] Grid / Speaker / Presenter views, in the corner window and the big dashboard
- [x] Hamburger navigation with Firm and Agent Forge pages (role → species)
- [x] Roster, species & art tab, environments, prompts, importers, extras (head bob)
- [x] Codex session support; Pixoo mirror; menu bar; hot reload; LaunchAgent

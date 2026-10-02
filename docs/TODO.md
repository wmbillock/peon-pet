# TODO

Identity model (decided 2026-10-02):

| Thing | Carries |
|---|---|
| **Project** (a Firm project, a named session, or a folder) | one **background** and **frame** shared by all its agents; a colour family (hue); an **emoji** for group views |
| **Agent** | art that **matches its type** (species); a **shade** of the project's hue that tells it apart from other agents of the same type |
| **Pet** (roster) | a named individual; its own filter if you set one (overrides the auto shade) |

## Now

- [x] Project model: emoji, hue, frame, environment (`lib/projects.js`), Firm project titles, Firm-supplied seeds
- [x] Shades: same-type agents in a project get distinct shades of the project hue (`lib/marks.js`)
- [x] Tiles use the project's plate, frame and background; emoji marks groups; group by project
- [x] View slices: status, project, type, tool; presets in the corner window
- [x] Dynamic frames: status glow, project glow, neon chase, rainbow (tiles + corner overlay)
- [x] Projects page; Forge per-role species and filter
- [x] Summary strip (counts, click to dive) replaces the dots; Pixoo shows the same counts
- [x] Firm: consume `agent_type` and project look fields when provided; feature requests drafted (`docs/firm/`)
- [x] Firm feature requests written, aligned with T-0002/T-0003, and built into a verified patch (`docs/firm/firm-pr.patch`, `SUBMIT.md`)
- [x] Draft PR opened: https://github.com/Affirm/affirm-builders/pull/3871 (T-0006..T-0012; waiting on human approval + swarm review)
- [ ] Per-session override of project membership ("this session belongs to project X")
- [ ] Project background for baked sheets (needs cutout art; see art prompts)

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

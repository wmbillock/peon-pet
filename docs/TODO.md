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
- [x] Per-session override of project membership (Projects page → "Move an agent to a project")
- [ ] Project background for baked sheets (needs cutout art; see art prompts)

## Soon

- [x] New themed pets (9) and 60 backgrounds registered from `scripts/art-selection.json` / `background-library.json`; checked on their default backgrounds (R2-D2 still needs art)

- [x] Environments for all 10 plan species generated via Codex (`scripts/gen-art-codex.js`, `scripts/install-art-envs.js`), built in
- [x] Art redo: the 10 cutout character sheets generated via Codex and installed as the bundled art (`scripts/gen-art-codex.js`, `install-art-cutouts.js`); each species now sits on its own environment; beardie bob/wave rebuilt from the new sheet
- [ ] Cutout sheets are 209px cells (generator output); re-run at higher size later if wanted. Extras for other species could be generated the same way
- [x] Beardie wave: procedural arm wave, row 2 of the extras (`node scripts/gen-headbob.js bearded-dragon --wave`; add `--custom` after replacing the sheet)
- [x] Desktop "army": tray/dock menu → "Desktop army"; one small draggable window per root agent (`lib/army.js`, `grid/army.*`), positions remembered
- [x] Local-only build filter: `node scripts/make-dist.js <out>` leaves out `terra-ff6`/`hello-kitty` art and `docs/firm/`; catalogs tolerate absent art (dist passes its tests)
- [ ] Split `feat/control-panel-pixoo` into reviewable upstream PRs (panel, packs, hot reload + LaunchAgent fix, pet switcher, Pixoo, Codex)

## Agent Forge / The Firm

- [ ] Decide the integration shape with The Firm: (a) Peon Pet exposes a token-protected localhost API the Firm UI embeds, or (b) pets/species/projects move into the Firm backend and Peon Pet becomes a client
- [ ] Agent types as first-class: species + personality + role + (later) prompt/tools, shared through the Firm
- [ ] Surface Firm state on tiles: bead progress, review round, blocked/escalated
- [x] Codex masters: a main Codex session written in the last 30 min (not `codex exec`) is a live master (`codexMasters`)
- [ ] Approval-requested signal for Codex (no event found in rollouts yet)

## Done

- [x] Masters via Claude's session registry; idle masters stay visible; session names shown
- [x] The Firm connection (read-only) and agent graph (roots/children by workstream)
- [x] Grid / Speaker / Presenter views, in the corner window and the big dashboard
- [x] Hamburger navigation with Firm and Agent Forge pages (role → species)
- [x] Roster, species & art tab, environments, prompts, importers, extras (head bob)
- [x] Codex session support; Pixoo mirror; menu bar; hot reload; LaunchAgent

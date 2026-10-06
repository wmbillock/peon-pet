# TODO

Identity model (revised 2026-10-05, simpler):

| What you see | Means |
|---|---|
| **The pet art** | the agent (a kind of agent wears a pet; copies spread across pets for variety) |
| **Border colour** (and name plate) | what **kind** of agent it is; set per kind in the Agent Forge (auto = its role's colour) |
| **Emoji, top-right** (opposite the status light) | which **project** it is working on |
| **Grouping / hierarchy** | which agent is working on which (sub-agents sit under their lead) |
| **Shade over the art** | tells apart true copies: the same kind wearing the same pet in the same project |

Project frame art no longer draws over tiles (the project still carries an emoji, colour family and background for its group view and the Projects page).

## Now

- [x] 2026-10-06: on the Euphonia branch (chat window and bridge, voice focus, Pixoo rotation, seeded capped casting, third-party asset rule); Firm requests filed as `the-firm` issues #4546–#4553 (PR #3871 closed)
- [ ] **Needs you:** apply the voice-focus patch to the installed peon-ping (the sandbox blocked me): `D=/usr/local/Cellar/peon-ping/2.37.0/libexec; cp $D/peon.sh $D/peon.sh.bak-voice-focus && patch -p1 -d $D < docs/euphonia/peon-ping-voice-focus.patch` (a `brew upgrade` overwrites it)

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

- [ ] Per-machine Peon Pet server (owner enhancement, 2026-10-05): one local daemon owns Peon Pet and peon-ping state and
  marshals hook events. The hook becomes a tiny client call over a Unix socket (mode 0600, no TCP port) with a fail-open
  timeout of about 200 ms, instead of starting bash and `peon.sh` per event. Why: pausing in the UI cannot stop the cost,
  because the hook still starts a bash process before `peon.sh` reads the pause state, and spawns are expensive on this
  machine (4 concurrent `peon.sh` copies from several Claude sessions). One owner also removes the `.state.json` write
  races, puts pause, dedupe and rate limiting in one place, owns its audio and pet processes (the leaked `afplay`
  problem), and gives every producer one queue: Claude sessions, The Firm's peon bridge (#3866) and anything else. Runs as
  a launchd service like The Firm's. Measure first: time one `peon.sh` event on a quiet and a loaded machine; if spawn
  dominates, a thin client against a socket is the fix, and if audio work dominates, the server must own playback too. The
  voice-focus gate (`voice-focus.json`) and the Pixoo rotation become server state instead of files.
- [x] New themed pets (9) and 60 backgrounds registered from `scripts/art-selection.json` / `background-library.json`; checked on their default backgrounds (R2-D2 still needs art: the image tool's safety review declined the sheet on 2026-10-02; use another tool or a different design)

- [x] Environments for all 10 plan species generated via Codex (`scripts/gen-art-codex.js`, `scripts/install-art-envs.js`), built in
- [x] Art redo: the 10 cutout character sheets generated via Codex and installed as the bundled art (`scripts/gen-art-codex.js`, `install-art-cutouts.js`); each species now sits on its own environment; beardie bob/wave rebuilt from the new sheet
- [ ] Cutout sheets are 209px cells (generator output); re-run at higher size later if wanted. Extras for other species could be generated the same way
- [x] Beardie wave: procedural arm wave, row 2 of the extras (`node scripts/gen-headbob.js bearded-dragon --wave`; add `--custom` after replacing the sheet)
- [x] Desktop "army": tray/dock menu → "Desktop army"; one small draggable window per root agent (`lib/army.js`, `grid/army.*`), positions remembered
- [x] Local-only build filter: `node scripts/make-dist.js <out>` leaves out `terra-ff6`/`hello-kitty` art and `docs/firm/`; catalogs tolerate absent art (dist passes its tests)
- [x] Published to the fork as a filtered snapshot (2026-10-02, `c351149`); future pushes: `scripts/publish-fork.sh "message" [--push]` (local history and local-only art are never pushed)
- [ ] Split into reviewable PRs against upstream `PeonPing/peon-pet` (panel, packs, hot reload + LaunchAgent fix, pet switcher, Pixoo, Codex) — not started; not requested

## Agent Forge / The Firm

- [x] Kinds of agent: Firm-role categories, many types per pet, personality, traits, auto-pick (least-used tiebreak), session/project pins, least-privilege permissions that only narrow a role (`lib/agent-types.js`, `lib/permissions.js`, Forge page)
- [x] From the Lebowski swarm roster and Euphonia's card contract: execution bounds per kind (writes itself up to N lines, max sub-agents, report-within minutes) and a credits-vs-violations ledger kept separately (`lib/ledger.js`; log from the Forge or `ledger-record`)
- [ ] Next for kinds: a monitor category (persistent rule enforcement and audit trail, as in the swarm's monitors) once the Firm has an equivalent role; feed ledger entries from live Firm events when T-0010 lands; more seed types per role

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

# Feature requests for The Firm

Written in The Firm's `ROADMAP.md` format (rank · size · reason, with file references as of 2026-10-02; re-verify
before landing). Not yet submitted: per `AGENTS.md`, each becomes a `swarm/TASKS.md` row (`T-NNNN`) with a claim file
and a PR into `pricing/the-firm/develop`, reviewed by the other swarm. Context: `INTEGRATION.md`.

**Overlaps with work already on the board (as of `develop` @ `1420f3f447`)**

- **T-0003** (open, unclaimed) drafts *the agent definition standard*: one loadable file per agent type (capabilities,
  boundaries, reporting, persona, assignment, evolution). The agent-type entries below build on it: they add the
  *look* and the runtime registry, and should be sequenced after it.
- **T-0002** (claimed by `claude/euphonia-loop-1`, `feature/T-0002-peon-bridge`) is an optional peon-ping bridge for
  Firm events, off unless `FIRM_PEON=1`. The lifecycle-event entry below is about a *general* stream for dashboards;
  coordinate with that branch rather than duplicate its event mapping.

## Entries for `## Next` (new entries go at the top of the section)

- **P1** Agent type on every thread, chosen at instantiation · S · `ThreadRuntime.summary()` (manager.py:346) and `/api/threads` (main.py:115) expose `role` but not *what kind of agent* this is, so a dashboard can only guess a look from the role; add `agent_type` (slug) to the thread record (store.py threads table, ~:439), to the spawn path (`SpawnRequest` main.py:108, `SessionSpec`), and to `summary()`. Default: derived from the role.
- **P1** Project identity fields: `emoji`, `hue` (0–359), `frame`, `environment` · S · `_project_dict` (main.py:170) returns id/title/workstreams only; add the four optional fields to the projects table, to `GET /api/projects`, and to project creation/update, so every agent of a project shares one look in every UI.
- **P1** Name each Claude session at instantiation · S · Claude's registry (`~/.claude/sessions/<pid>.json`) records a `name` and `nameSource`; Firm sessions are named by derivation (`the-firm-fd`, `the-firm-94`), which tells a person and any tool that reads the registry nothing. Pass the session name `<Role> · <title>` (e.g. `Lead · Pricing CLI`) when the session is created, so it shows as a chosen name.
- **P1** Agent-type registry (Agent Forge), after T-0003 · L · T-0003 defines the file format for an agent type; this loads those definitions as data (slug, display name, role binding, persona/prompt fragment, tools, **look**), with CRUD in the API and UI, `spawn(type=…)`, and a role → default type mapping — today types are scattered across `prompts.py`, `ROLE_ACTIONS` (protocol.py:68) and per-role config. Peon Pet's Forge page (role → species, role → filter) is the seed.
- **P2** Lifecycle event stream for dashboards (coordinate with T-0002's peon bridge) · M · dashboards poll `/api/threads` every few seconds; publish agent spawned / started / idle / done / blocked / escalated (thread id, role, workstream, bead, stage) over SSE or `/ws/events`. The events table (store.py `latest_events`, main.py:195) is the source.
- **P2** Richer thread summary for status surfaces · S · add `parent_id` (who spawned it), `stage` (plan | critique | work | review), `bead_title`, `bead_index` / `bead_total`, `review_round`, `blocked_reason` to `summary()`; a tile can then say "bead 3 of 5 · review round 2" without opening the workstream.
- **P2** "Needs you" count · S · `/api/stats` (main.py:232) and the Inbox (main.py:214) hold what a person must act on; expose one number (plus blocked/escalated workstreams) so an ambient display can show it.
- **P3** Serve agent-type art to the UI · M · once types carry a look, `GET /api/agent-types/<slug>/sprite` (or a stable file path) so Euphonia can draw the same character Peon Pet does.

## Draft task rows for `swarm/TASKS.md`

| Task | Source | Definition of done |
|---|---|---|
| T-???? Agent type on threads | entry 1 | `agent_type` stored, accepted at spawn, present in `summary()` and `/api/threads`; role default when absent; tests assert the default and an explicit type |
| T-???? Project identity fields | entry 2 | four optional fields stored and returned by `/api/projects`; settable via API; invalid values rejected; migration for existing rows |
| T-???? Session names at instantiation | entry 3 | a new Firm session shows `<Role> · <title>` as its `name` with `nameSource: user` in Claude's registry; test with the fake provider |
| T-???? Agent-type registry | entry 4 (after T-0003) | types load from the T-0003 definitions as records with CRUD; `spawn(type=…)` works; roles resolve to a default type; prompts compile from the type; existing behaviour unchanged when no type is given |
| T-???? Lifecycle event stream | entry 5 | a documented stream emits the six transitions; a test subscribes and sees spawn → done for a fake worker; `/api/threads` polling still works |
| T-???? Richer thread summary | entry 6 | the new fields are present and correct for plan, work and review threads |
| T-???? "Needs you" count | entry 7 | one number plus a breakdown, matching the Inbox and blocked/escalated workstreams |

## What Peon Pet already does with these (so each lands as an upgrade, not a rewrite)

Entries 1 and 2 are consumed today if present (see `INTEGRATION.md`); entry 3 improves names with no change on the
Peon Pet side; entries 5–7 replace polling and inference; entry 4 is where the Forge page graduates into The Firm.

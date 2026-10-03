# Firm feature requests as GitHub Issues (drafts)

The Firm team decided on 2026-10-02 (`#proj-the-future`) that new work items go in **GitHub Issues in `Affirm/affirm-builders` under a label**, not as `ROADMAP.md`/`TASKS.md` commits. The label and template do not exist yet, so nothing here is filed. When they do, file each block below as one issue, then close or trim draft PR #3871 (which carries the same requests as queue-file commits).

Each draft has a title, priority and size, the request with file references as of 2026-10-02 (re-verify before landing), and a definition of done where one exists. Peon Pet already consumes `agent_type` and project look fields when provided; see `INTEGRATION.md`.

## 1. Agent type on every thread, chosen at instantiation

**Priority:** P1 · **Size:** S

`ThreadRuntime.summary()` (manager.py:346) and `/api/threads` (main.py:115) expose `role` but not *what kind of agent* this is, so a dashboard can only guess a look from the role; add `agent_type` (slug) to the thread record (store.py threads table, ~:439), to the spawn path (`SpawnRequest` main.py:108, `SessionSpec`), and to `summary()`. Default: derived from the role.

**Definition of done:** `agent_type` stored, accepted at spawn, present in `summary()` and `/api/threads`; role default when absent; tests assert the default and an explicit type

## 2. Project identity fields: `emoji`, `hue` (0–359), `frame`, `environment`

**Priority:** P1 · **Size:** S

`_project_dict` (main.py:170) returns id/title/workstreams only; add the four optional fields to the projects table, to `GET /api/projects`, and to project creation/update, so every agent of a project shares one look in every UI.

**Definition of done:** four optional fields stored and returned by `/api/projects`; settable via API; invalid values rejected; migration for existing rows

## 3. Name each Claude session at instantiation

**Priority:** P1 · **Size:** S

Claude's registry (`~/.claude/sessions/<pid>.json`) records a `name` and `nameSource`; Firm sessions are named by derivation (`the-firm-fd`, `the-firm-94`), which tells a person and any tool that reads the registry nothing. Pass the session name `<Role> · <title>` (e.g. `Lead · Pricing CLI`) when the session is created, so it shows as a chosen name.

**Definition of done:** a new Firm session shows `<Role> · <title>` as its `name` with `nameSource: user` in Claude's registry; test with the fake provider

## 4. Agent-type registry (Agent Forge), after T-0003

**Priority:** P1 · **Size:** L

T-0003 defines the file format for an agent type; this loads those definitions as data (slug, display name, role binding, persona/prompt fragment, tools, **look**), with CRUD in the API and UI, `spawn(type=…)`, and a role → default type mapping — today types are scattered across `prompts.py`, `ROLE_ACTIONS` (protocol.py:68) and per-role config. Peon Pet's Forge page (role → species, role → filter) is the seed. Shape prototyped there: a type belongs to one role (its category) and a look (species) can back many types; each carries a short personality, trait tags, and permissions that may only *narrow* its role's allowed actions (an out-of-role action resolves to a hand-off role, never a silent allow; implementers do not review and reviewers do not implement); when none is named at spawn, the type whose traits best fit the agent's role/project/title wins, with ties going to the least-used type so duplicates get variety.

**Definition of done:** types load from the T-0003 definitions as records with CRUD; `spawn(type=…)` works; roles resolve to a default type; prompts compile from the type; existing behaviour unchanged when no type is given

## 5. Lifecycle event stream for dashboards (coordinate with T-0002's peon bridge)

**Priority:** P2 · **Size:** M

dashboards poll `/api/threads` every few seconds; publish agent spawned / started / idle / done / blocked / escalated (thread id, role, workstream, bead, stage) over SSE or `/ws/events`. The events table (store.py `latest_events`, main.py:195) is the source.

**Definition of done:** a documented stream emits the six transitions; a test subscribes and sees spawn → done for a fake worker; `/api/threads` polling still works

## 6. Richer thread summary for status surfaces

**Priority:** P2 · **Size:** S

add `parent_id` (who spawned it), `stage` (plan | critique | work | review), `bead_title`, `bead_index` / `bead_total`, `review_round`, `blocked_reason` to `summary()`; a tile can then say "bead 3 of 5 · review round 2" without opening the workstream.

**Definition of done:** the new fields are present and correct for plan, work and review threads

## 7. "Needs you" count

**Priority:** P2 · **Size:** S

`/api/stats` (main.py:232) and the Inbox (main.py:214) hold what a person must act on; expose one number (plus blocked/escalated workstreams) so an ambient display can show it.

**Definition of done:** one number plus a breakdown, matching the Inbox and blocked/escalated workstreams

## 8. Serve agent-type art to the UI

**Priority:** P3 · **Size:** M

once types carry a look, `GET /api/agent-types/<slug>/sprite` (or a stable file path) so Euphonia can draw the same character Peon Pet does.

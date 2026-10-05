# Character preferences (seeded casting of agent pets)

Auto-picked agent pets are drawn from `lib/character-preferences.json`, which ships with the app, so a fleet is not an army of
one species. Euphonia (the lead pet) is not drawn from this pool; she uses `species` in her own config.

## How a pick is made

1. A Forge choice always wins: a pinned type, a Firm `agent_type`, or a role to species setting. Clearing it falls back to the pick below.
2. The first agent of a kind in a project wears the kind's own pet, unless preferences mark that species `rare` (multiplier below 1) or `exclude` it.
3. Everyone else is cast by a seeded weighted draw. The seed is `characterSeed` in the app config (random per install, created on first use),
   combined with the agent id and kind, so a pick is stable for an agent and differs between installs.
4. Variety guards: after `minAgentsForShare` agents no species exceeds `maxShare` of them; no species repeats more than `maxConsecutive`
   times in a row; each repeat of a species lowers its weight by `1 / (1 + count)^repeatPenalty`.

Picks stick to an agent while it lives. Caps are computed over the agents present, so a restart with the same agents gives the same cast.

## File schema

```json
{
  "version": 1,
  "variety": { "maxShare": 0.25, "minAgentsForShare": 8, "maxConsecutive": 2, "repeatPenalty": 1 },
  "exclude": ["species-never-auto-picked"],
  "rare": { "orc": 0.15 },
  "default": { "capybara": 1, "retro-robot": 1 },
  "kinds": { "worker": { "retro-robot": 3 }, "scout": { "capybara": 3 } }
}
```

- Weight for a species and kind is `kinds[kind][species]`, else `default[species]`, times `rare[species]` if present.
  A species in neither map is never auto-picked. Kinds are Firm categories: `lead`, `management`, `worker`, `inspector`, `scout`, `plan`, `critique`, `review`.
- Only species that are installed and ready are considered; the shipped file lists the 32 bundled non-third-party characters.

## Adding your own

Create `character-preferences.json` in the app's user-data directory (next to `pets.json`). It is merged over the shipped file:
`kinds` replaces whole kinds, `default` replaces the default map, `exclude` and `rare` merge, `variety` merges key by key.
Example: keep scouts to your own art and lift the share cap:

```json
{ "kinds": { "scout": { "my-heron": 5 } }, "default": { "my-heron": 1, "capybara": 1 }, "variety": { "maxShare": 0.4 } }
```

# Submitting the requests to The Firm

`docs/firm/firm-pr.patch` adds the requests to The Firm's own files, against `origin/pricing/the-firm/develop`:

- `projects/the-firm/ROADMAP.md`: 8 entries at the top of `## Next`
- `projects/the-firm/swarm/TASKS.md`: 7 rows, T-0006 to T-0012 (continuing after the highest existing id)

Regenerate it any time (read-only; checks it applies to the current `develop`):

```bash
node scripts/prepare-firm-patch.js
```

## Before you submit — things The Firm's `AGENTS.md` makes you decide

- **Review:** a PR from Willow's agents is reviewed by Peter's. A PR that touches `swarm/` also needs a **human approval** before merge (§4.7).
- **Draft first** (§4.1), against `pricing/the-firm/develop`, never `main`.
- **Overlaps already on the board:** T-0003 (agent definition standard, open) is the foundation for the agent-type entries;
  T-0002 (peon-ping bridge, claimed by `claude/euphonia-loop-1`) overlaps the lifecycle-event entry. Both are called out in the entries.
- **Claims:** §2 says every piece of work is a task. This PR only *files* tasks (it implements none), so decide whether the
  filing itself needs a claim; the implementation tasks are claimed individually later.

## Steps (not run — each one is outward-facing from step 4)

```bash
# 1. a throwaway worktree off The Firm's integration branch (leaves your checkouts alone)
git -C ~/dev/affirm-builders fetch origin pricing/the-firm/develop
git -C ~/dev/affirm-builders worktree add ~/dev/affirm-builders-wt/peon-pet-firm-requests \
    -b feature/peon-pet-firm-requests origin/pricing/the-firm/develop
cd ~/dev/affirm-builders-wt/peon-pet-firm-requests

# 2. apply and review the change
git apply ~/dev/ai_testing/peon-pet/docs/firm/firm-pr.patch
git diff

# 3. commit
git add projects/the-firm/ROADMAP.md projects/the-firm/swarm/TASKS.md
git commit -m "roadmap: Peon Pet integration requests (agent type, project identity, session names, registry, events)"

# 4. push the branch and open a DRAFT PR (this is the step that notifies other people)
git push -u origin feature/peon-pet-firm-requests
gh pr create --draft --base pricing/the-firm/develop \
  --title "Roadmap: Peon Pet integration requests (T-0006 to T-0012)" \
  --body-file ~/dev/ai_testing/peon-pet/docs/firm/INTEGRATION.md
```

Undo: close the PR and `git worktree remove ~/dev/affirm-builders-wt/peon-pet-firm-requests`.

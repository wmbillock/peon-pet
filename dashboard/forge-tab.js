// Agent Forge page: which species stands for each Firm role.
const forgeRows = $('forge-rows');
const ROLE_INFO = {
  management: 'The agent you talk to; hands work to leads',
  lead: 'Runs one workstream and accepts or sends back work',
  worker: 'Implements one task (a bead) in its own worktree',
  inspector: "Re-verifies a worker's result against the criteria",
  scout: 'Reads code ahead of planning',
  plan: 'Drafts the plan and splits it into beads',
  critique: 'Attacks the plan before work begins',
  review: 'Reads the finished PR against the spec',
};

function renderForge(st) {
  if (!st) return;
  forgeRows.replaceChildren(...st.roles.map((role) => {
    const sel = h('select', {},
      h('option', { value: '', selected: !st.map[role] }, 'Same as its lead'),
      st.species.map((s) => h('option', { value: s.slug, selected: s.slug === st.map[role] }, s.display)));
    sel.addEventListener('change', async () => {
      try { showError(null); renderForge(await window.dashBridge.setForgeRole(role, sel.value || null)); }
      catch (e) { showError(e); window.dashBridge.getForge().then(renderForge); }
    });
    return h('tr', {}, h('td', {}, role), h('td', { class: 'what' }, ROLE_INFO[role] || ''), h('td', {}, sel));
  }));
}

window.dashBridge.getForge().then(renderForge);
onSnap(() => { if (!forgeRows.contains(document.activeElement)) window.dashBridge.getForge().then(renderForge); });

// Agent Forge: kinds of agent (Firm role · species · personality · traits · permissions).
const typesList = $('types-list');
const autoRootsBox = $('types-auto-roots');
let typesState = null;

const refreshTypes = () => window.dashBridge.getTypes().then((st) => { typesState = st; renderTypes(); }).catch(showError);
const saveType = (t) => window.dashBridge.putType(t).then((st) => { typesState = st; renderTypes(); }).catch((e) => { showError(e); refreshTypes(); });
const clip = (t) => ({ slug: t.slug, name: t.name, category: t.category, species: t.species, traits: t.traits, personality: t.personality, tint: t.tint, allow: t.allow, deny: t.deny });

function typeCard(t) {
  const field = (label, el) => h('div', { class: 'line' }, h('label', { class: 'inline', style: 'min-width:84px' }, label), el);
  const edit = (patch) => saveType({ ...clip(t), ...patch });

  const name = h('input', { type: 'text', value: t.name, maxlength: 40, onchange: () => edit({ name: name.value }) });
  const category = h('select', { onchange: () => edit({ category: category.value, allow: [], deny: [] }) },
    typesState.categories.map((c) => h('option', { value: c, selected: c === t.category }, c)));
  const species = h('select', { onchange: () => edit({ species: species.value }) },
    typesState.species.map((s) => h('option', { value: s.slug, selected: s.slug === t.species }, s.display)));
  const tint = h('select', { onchange: () => edit({ tint: tint.value === 'none' ? null : tint.value }) },
    typesState.tints.map((x) => h('option', { value: x.id, selected: x.id === (t.tint || 'none') }, x.id === 'none' ? 'None' : x.label)));
  const traits = h('input', { type: 'text', value: t.traits.join(', '), placeholder: 'backend, api, security…', onchange: () => edit({ traits: traits.value }) });
  const personality = h('textarea', { rows: 2, maxlength: 600, style: 'width:100%', onchange: () => edit({ personality: personality.value }) }, t.personality);
  personality.value = t.personality;

  // Permissions: tick what this kind may do; the role's grant is the ceiling. Unticked = narrowed away.
  const roleActions = typesState.policy[t.category] || [];
  const can = new Set(t.can);
  const boxes = roleActions.map((a) => h('label', { class: 'inline', style: 'margin-right:10px' },
    h('input', { type: 'checkbox', checked: can.has(a), onchange: () => {
      const keep = boxes.map((b, i) => (b.firstChild.checked ? roleActions[i] : null)).filter(Boolean);
      edit({ allow: [], deny: roleActions.filter((x) => !keep.includes(x)) });
    } }), ` ${a}`));

  // "Can it…?" — ask the permission model about any action.
  const act = h('select', {}, typesState.actions.map((a) => h('option', { value: a }, a)));
  const verdict = h('span', { class: 'dim' }, '');
  const ask = () => window.dashBridge.checkType(t.slug, act.value).then((r) => {
    verdict.textContent = r.decision === 'allow' ? `✓ allowed — ${r.reason}` : r.decision === 'delegate' ? `→ hand to ${r.route} — ${r.reason}` : `✕ denied — ${r.reason}`;
  }).catch(showError);
  act.addEventListener('change', ask);

  const inUse = app.sessions.filter((a) => a.pet && a.pet.type && a.pet.type.slug === t.slug).length;
  return h('section', { class: 'card typecard' },
    h('div', { class: 'line' }, name, category, species,
      h('span', { class: 'dim' }, inUse ? `${inUse} agent${inUse === 1 ? '' : 's'} now` : 'unused now'), h('span', { style: 'flex:1' }),
      h('button', { class: 'danger', onclick: () => { if (confirm(`Delete "${t.name}"? Pins on it are cleared.`)) window.dashBridge.removeType(t.slug).then((st) => { typesState = st; renderTypes(); }).catch(showError); } }, 'Delete')),
    field('Personality', personality),
    field('Traits', traits),
    field('Filter', tint),
    field('May', h('span', {}, boxes)),
    field('Can it…?', h('span', {}, act, ' ', verdict)));
}

function renderTypes() {
  if (!typesState) return;
  autoRootsBox.checked = typesState.autoRoots;
  const order = (c) => typesState.categories.indexOf(c);
  const list = [...typesState.types].sort((a, b) => order(a.category) - order(b.category) || a.name.localeCompare(b.name));
  renderUnlessEditing(typesList, () => typesList.replaceChildren(...(list.length ? list.map(typeCard) : [h('div', { class: 'help' }, 'No kinds of agent yet.')])));
}

autoRootsBox.addEventListener('change', () => window.dashBridge.setAutoRoots(autoRootsBox.checked).then((st) => { typesState = st; renderTypes(); }).catch(showError));
$('types-new').addEventListener('click', () => {
  const n = typesState.types.length + 1;
  let slug = `kind-${n}`;
  while (typesState.types.some((t) => t.slug === slug)) slug = `kind-${Math.random().toString(36).slice(2, 6)}`;
  saveType({ slug, name: 'New kind', category: 'worker', species: typesState.species[0].slug, traits: [], personality: '', tint: null, allow: [], deny: [] });
});
document.addEventListener('sessions', refreshTypes);
onSnap(refreshTypes);
refreshTypes();

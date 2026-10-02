// Pets tab: the roster of individual pets.
const petList = $('pet-list');
const addSpecies = $('add-species');
const addName = $('add-name');
const addCount = $('add-count');

const ASSIGN_LABELS = { auto: 'Auto', bench: 'Bench (never auto-assigned)', agent: 'An agent', project: 'A project', session: 'A session' };

const readySpecies = (snap) => snap.species.filter((s) => s.ready);

function sessionLabel(s) {
  return `${s.name || '(unknown)'} · ${s.agent} · …${s.id.slice(-6)}`;
}

function assignmentEditor(pet) {
  const a = pet.assignment;
  const type = a ? a.type : 'auto';
  const typeSel = h('select', { title: 'Which agents this pet represents' },
    Object.entries(ASSIGN_LABELS).map(([k, label]) => h('option', { value: k, selected: k === type }, label)));
  const wrap = h('span', { class: 'line' }, typeSel);
  const save = (assignment) => act(() => window.dashBridge.updatePet(pet.id, { assignment }));

  typeSel.addEventListener('change', () => {
    const t = typeSel.value;
    if (t === 'auto') return save(null);
    if (t === 'bench') return save({ type: 'bench' });
    if (t === 'agent') return save({ type: 'agent', value: 'claude' });
    if (t === 'project') {
      const cwd = (app.sessions.find((s) => s.cwd) || {}).cwd;
      return cwd ? save({ type: 'project', value: cwd }) : showError('Open a session first, or type a project path after choosing "A project".');
    }
    const s = app.sessions[0];
    return s ? save({ type: 'session', value: s.id }) : showError('There are no active sessions to pin to yet.');
  });

  if (type === 'agent') {
    const sel = h('select', {}, ['claude', 'codex'].map((v) => h('option', { value: v, selected: a.value === v }, v)));
    sel.addEventListener('change', () => save({ type: 'agent', value: sel.value }));
    wrap.append(sel);
  } else if (type === 'project') {
    const listId = `cwds-${pet.id}`;
    const input = h('input', { type: 'text', value: a.value, list: listId, placeholder: '/path/to/project', style: 'min-width:260px' });
    const dl = h('datalist', { id: listId }, [...new Set(app.sessions.map((s) => s.cwd).filter(Boolean))].map((c) => h('option', { value: c })));
    input.addEventListener('change', () => { if (input.value.trim()) save({ type: 'project', value: input.value }); });
    wrap.append(input, dl);
  } else if (type === 'session') {
    const sel = h('select', {}, [
      ...app.sessions.map((s) => h('option', { value: s.id, selected: s.id === a.value }, sessionLabel(s))),
      app.sessions.some((s) => s.id === a.value) ? null : h('option', { value: a.value, selected: true }, `…${a.value.slice(-6)} (not active)`),
    ]);
    sel.addEventListener('change', () => save({ type: 'session', value: sel.value }));
    wrap.append(sel);
  }
  return wrap;
}

const openFacts = new Set();  // pets whose fact editor is expanded (survives re-renders)

const petFacts = (pet) => factsEditor(pet.facts, (facts) => act(() => window.dashBridge.updatePet(pet.id, { facts })),
  openFacts, pet.id, 'Durable notes about this pet: temperament, backstory, what it is for…');

function petCard(snap, pet) {
  const sp = snap.species.find((s) => s.slug === pet.species);
  const isLead = snap.lead === pet.id;
  const working = app.sessions.filter((s) => s.pet && s.pet.petId === pet.id);

  const name = h('input', { type: 'text', class: 'name', value: pet.name, maxlength: 32, title: 'Rename',
    onchange: () => act(() => window.dashBridge.updatePet(pet.id, { name: name.value })) });
  const speciesSel = h('select', { title: 'Species (the art)', onchange: () => act(() => window.dashBridge.updatePet(pet.id, { species: speciesSel.value })) },
    readySpecies(snap).map((s) => h('option', { value: s.slug, selected: s.slug === pet.species }, s.display)));

  const swatches = h('div', { class: 'swatches' }, snap.tints.map((t) => h('button', {
    class: `sw${t.id === 'none' ? ' none' : ''}${t.id === pet.tint ? ' on' : ''}`,
    title: t.label, style: t.id === 'none' ? '' : `background:${t.css.replace(/[\d.]+\)$/, '1)')}`,
    onclick: () => act(() => window.dashBridge.updatePet(pet.id, { tint: t.id })),
  })));

  const envLine = sp && sp.layout === 'cutout'
    ? h('span', { class: 'line' }, h('label', { class: 'inline' }, 'Environment'),
        (() => {
          const sel = h('select', {}, [
            h('option', { value: '', selected: !pet.env }, `Species default${sp.defaultEnv ? ` (${(snap.environs.find((e) => e.id === sp.defaultEnv) || {}).display || sp.defaultEnv})` : ''}`),
            ...snap.environs.map((e) => h('option', { value: e.id, selected: e.id === pet.env }, e.display)),
          ]);
          sel.addEventListener('change', () => act(() => window.dashBridge.updatePet(pet.id, { env: sel.value || null })));
          return sel;
        })())
    : null;

  return h('section', { class: `card pet${isLead ? ' lead' : ''}` },
    petThumb(sp && sp.thumb, pet.look.tintCss),
    h('div', { class: 'main' },
      h('div', { class: 'line' }, name, speciesSel,
        isLead ? h('span', { class: 'tag good' }, 'lead — on your desktop') : h('button', { onclick: () => act(() => window.dashBridge.setLead(pet.id)) }, 'Make lead'),
        sp && sp.layout === 'cutout' ? h('span', { class: 'tag' }, 'cutout') : null,
        sp && sp.localOnly ? h('span', { class: 'tag warn' }, 'local only') : null,
        h('span', { class: 'spacer', style: 'flex:1' }),
        h('button', { class: 'danger', disabled: snap.pets.length < 2, title: 'Delete this pet',
          onclick: () => { if (confirm(`Delete ${pet.name}?`)) act(() => window.dashBridge.removePet(pet.id)); } }, 'Delete')),
      h('div', { class: 'line' }, h('label', { class: 'inline' }, 'Tint'), swatches),
      envLine,
      h('div', { class: 'line' }, h('label', { class: 'inline' }, 'Represents'), assignmentEditor(pet)),
      h('div', { class: 'help', style: 'margin:0' }, working.length
        ? `Working on: ${working.map((s) => s.name || s.id.slice(-6)).join(', ')}`
        : 'Idle — not currently on any session')),
    petFacts(pet));
}

function renderPets() {
  const snap = app.snap;
  if (!snap) return;
  if (document.activeElement !== addSpecies) {
    const cur = addSpecies.value;
    addSpecies.replaceChildren(...readySpecies(snap).map((s) => h('option', { value: s.slug }, s.display)));
    if (cur) addSpecies.value = cur;
  }
  renderUnlessEditing(petList, () => petList.replaceChildren(...snap.pets.map((p) => petCard(snap, p))));
}

onSnap(renderPets);
let lastSessionSig = '';
document.addEventListener('sessions', () => {
  const sig = JSON.stringify(app.sessions.map((s) => [s.id, s.name, s.pet && s.pet.petId]));
  if (sig !== lastSessionSig) { lastSessionSig = sig; renderPets(); }
});

$('add-btn').addEventListener('click', async () => {
  const r = await act(() => window.dashBridge.createPets({
    species: addSpecies.value, name: addName.value.trim() || undefined, count: Number(addCount.value) || 1,
  }));
  if (r) { addName.value = ''; addCount.value = 1; }
});

// Species & art tab: friendly names, durable facts, prompts, sheets, environments.
const ROW_LABELS = ['sleeping', 'waking', 'working', 'alarmed', 'celebrate', 'annoyed'];
const spList = $('sp-list');
const spDetail = $('sp-detail');
const openSpFacts = new Set();
let selectedSpecies = null;
let sheetOpen = false;       // contact sheet visible for the selected species
let promptText = '';         // last generated prompt (kept across re-renders)
let promptLabel = '';
let importNote = '';

const speciesOf = (snap, slug) => snap.species.find((s) => s.slug === slug);
const saveSp = (slug, patch) => act(() => window.dashBridge.updateSpecies(slug, patch));

function fieldRow(label, control) {
  return [h('label', {}, label), control];
}

function renderSpeciesList(snap) {
  spList.replaceChildren(...snap.species.map((s) => {
    const btn = h('button', { class: `cardbtn${s.draft ? ' draft' : ''}${s.slug === selectedSpecies ? ' sel' : ''}`,
      title: `${s.display}${s.draft ? ' — draft, no sheet yet' : ''}${s.localOnly ? ' — local only' : ''}`,
      onclick: () => { selectedSpecies = s.slug; sheetOpen = false; promptText = ''; importNote = ''; renderSpecies(); } });
    btn.append(s.thumb ? h('img', { class: 'ph', src: s.thumb }) : h('div', { class: 'ph', style: 'padding-top:18px;color:#777' }, 'draft'), s.display);
    return btn;
  }));
}

async function runPrompt(slug, kind, row, label) {
  const cell = Number($('prompt-cell') ? $('prompt-cell').value : 512) || 512;
  try {
    showError(null);
    promptText = await window.dashBridge.genPrompt({ kind, slug, row, cell });
    promptLabel = label;
  } catch (e) { showError(e); }
  renderSpecies();
}

async function runImport(slug, mode) {
  const chroma = $('sheet-chroma') && $('sheet-chroma').checked ? '#FF00FF' : null;
  importNote = 'Importing…';
  renderSpecies();
  const r = await act(() => window.dashBridge.importSheet({ slug, mode, chroma }));
  if (!r) importNote = '';
  else if (r.canceled) importNote = '';
  else importNote = `Imported (${r.layout}).${r.warnings && r.warnings.length ? ' ⚠ ' + r.warnings.join(' ') : ''}`;
  if (r && !r.canceled) sheetOpen = true;
  renderSpecies();
}

function sheetView(slug) {
  const wrap = h('div', { class: 'sheet' }, h('div', { class: 'help' }, 'Loading sheet…'));
  window.dashBridge.previewSheet(slug).then((url) => {
    wrap.replaceChildren(
      url ? h('img', { src: url, class: 'frameprev' }) : h('div', { class: 'help' }, 'No sheet to preview.'),
      h('div', { class: 'rows' }, ROW_LABELS.map((r, i) => h('span', {}, `${i + 1} ${r}`))));
  });
  return wrap;
}

function speciesDetail(snap, sp) {
  const card = h('section', { class: 'card' });
  const envOptions = [h('option', { value: '', selected: !sp.defaultEnv }, 'Dungeon (fallback)'),
    ...snap.environs.map((e) => h('option', { value: e.id, selected: e.id === sp.defaultEnv }, e.display))];

  card.append(
    h('div', { class: 'row' },
      h('input', { type: 'text', value: sp.display, maxlength: 40, style: 'font-weight:600;flex:1', title: 'Friendly display name',
        onchange: (e) => saveSp(sp.slug, { display: e.target.value }) }),
      sp.builtin ? h('span', { class: 'tag' }, 'built-in') : null,
      sp.draft ? h('span', { class: 'tag warn' }, 'draft — no sheet yet') : h('span', { class: 'tag good' }, sp.layout),
      h('span', { class: 'dim', style: 'font-size:11px' }, sp.slug)),
    h('div', { class: 'grid2', style: 'margin-top:10px' },
      ...fieldRow('Description', h('textarea', { rows: 3, value: sp.brief, placeholder: 'What it looks like and its personality — this feeds the prompt.',
        onchange: (e) => saveSp(sp.slug, { brief: e.target.value }) })),
      ...fieldRow('Activity', h('input', { type: 'text', value: sp.activity, placeholder: 'What it does when working, e.g. "playing a brassy solo" (default: typing on a laptop)',
        onchange: (e) => saveSp(sp.slug, { activity: e.target.value }) })),
      ...fieldRow('Scene', h('textarea', { rows: 2, value: sp.scene, placeholder: 'Its world, e.g. "a smoky 1950s jazz club stage" (baked sheets paint this in; cutouts use an environment).',
        onchange: (e) => saveSp(sp.slug, { scene: e.target.value }) })),
      ...fieldRow('Setting', h('select', { onchange: (e) => saveSp(sp.slug, { setting: e.target.value }) },
        h('option', { value: 'desk', selected: sp.setting === 'desk' }, 'At a desk with a laptop'),
        h('option', { value: 'free', selected: sp.setting === 'free' }, 'Free-form (not at a computer)'))),
      ...fieldRow('Sheet type', h('select', { onchange: (e) => saveSp(sp.slug, { layout: e.target.value }) },
        h('option', { value: 'baked', selected: sp.layout === 'baked' }, 'Baked — scene painted into every cell'),
        h('option', { value: 'cutout', selected: sp.layout === 'cutout' }, 'Cutout — transparent, sits on an environment'))),
      sp.layout === 'cutout' ? fieldRow('Environment', h('select', { onchange: (e) => saveSp(sp.slug, { defaultEnv: e.target.value || null }) }, envOptions)) : [],
      ...fieldRow('Distribution', h('label', { class: 'inline' },
        h('input', { type: 'checkbox', checked: sp.localOnly, onchange: (e) => saveSp(sp.slug, { localOnly: e.target.checked }) }),
        ' Local only (third-party or private art; leave out of any shared build)'))),
    factsEditor(sp.facts, (facts) => saveSp(sp.slug, { facts }), openSpFacts, sp.slug, 'Durable notes: origin, license, behavior…'));

  // --- Sheet ---
  const sheetBox = h('div', { style: 'margin-top:12px' },
    h('h2', { class: 'first' }, 'Sprite sheet'),
    h('div', { class: 'row', style: 'flex-wrap:wrap' },
      sp.ready ? h('button', { onclick: () => { sheetOpen = !sheetOpen; renderSpecies(); } }, sheetOpen ? 'Hide contact sheet' : 'Show contact sheet') : null,
      h('button', { onclick: () => runImport(sp.slug, 'atlas') }, sp.ready ? 'Replace sheet…' : 'Import sheet…'),
      h('button', { onclick: () => runImport(sp.slug, 'strips') }, 'Import 6 row strips…'),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'sheet-chroma', checked: sp.layout === 'cutout' }),
        ' Backdrop is magenta #FF00FF (key it out → cutout)')),
    importNote ? h('div', { class: 'help' }, importNote) : null,
    sheetOpen ? sheetView(sp.slug) : null);
  card.append(sheetBox);

  // --- Prompt generator ---
  const promptBtns = h('div', { class: 'promptbtns' },
    h('button', { onclick: () => runPrompt(sp.slug, 'atlas', undefined, 'Whole sheet') }, 'Whole sheet'),
    ROW_LABELS.map((r, i) => h('button', { onclick: () => runPrompt(sp.slug, 'strip', i, `Row ${i + 1} · ${r}`) }, `Row ${i + 1}`)),
    h('select', { id: 'prompt-cell', title: 'Cell size in the generated image' },
      [512, 256, 384].map((n) => h('option', { value: n }, `${n}px cells`))));
  card.append(h('div', { style: 'margin-top:12px' },
    h('h2', { class: 'first' }, 'Prompt for an image model'),
    h('div', { class: 'help', style: 'margin:0 0 6px' }, 'Built from the fields above. Whole-sheet first; if the model gets the grid wrong, generate the six rows one at a time and import them as strips.'),
    promptBtns,
    promptText ? h('div', {}, h('div', { class: 'help' }, promptLabel),
      h('textarea', { id: 'sp-prompt', rows: 12, readonly: true, value: promptText }),
      h('button', { class: 'copy', 'data-copy': 'sp-prompt', style: 'margin-top:6px' }, 'Copy prompt')) : null));

  if (sp.draft) {
    card.append(h('div', { style: 'margin-top:12px' }, h('button', { class: 'danger',
      onclick: () => { if (confirm(`Discard the draft "${sp.display}"?`)) { selectedSpecies = null; act(() => window.dashBridge.removeDraft(sp.slug)); } } }, 'Discard draft')));
  }
  return card;
}

function renderSpecies() {
  const snap = app.snap;
  if (!snap) return;
  renderSpeciesList(snap);
  const sp = selectedSpecies && speciesOf(snap, selectedSpecies);
  if (!sp) {
    selectedSpecies = null;
    spDetail.replaceChildren(h('div', { class: 'help' }, 'Select a species to edit its name, facts and art.'));
    return;
  }
  spDetail.replaceChildren(speciesDetail(snap, sp));
}

onSnap(() => renderUnlessEditing(spDetail, renderSpecies));

$('new-sp-btn').addEventListener('click', async () => {
  const display = $('new-sp-name').value.trim();
  if (!display) return showError('Give the new species a name first.');
  const r = await act(() => window.dashBridge.createDraft({ display, brief: $('new-sp-brief').value }));
  if (r && r.created) {
    $('new-sp-name').value = '';
    $('new-sp-brief').value = '';
    selectedSpecies = r.created;
    promptText = '';
    renderSpecies();
    runPrompt(r.created, 'atlas', undefined, 'Whole sheet');
  }
});

// ---------------- Environments ----------------
const envList = $('env-list');
const envDetail = $('env-detail');
let selectedEnv = null;
let envPromptFor = null;

function renderEnvs(snap) {
  envList.replaceChildren(...snap.environs.map((e) => {
    const btn = h('button', { class: `cardbtn${e.id === selectedEnv ? ' sel' : ''}`, title: e.description || e.display,
      onclick: () => { selectedEnv = e.id; renderEnvs(app.snap); } });
    btn.append(e.thumb ? h('img', { class: 'ph', src: e.thumb }) : h('div', { class: 'ph' }), e.display);
    return btn;
  }));
  const env = selectedEnv && snap.environs.find((e) => e.id === selectedEnv);
  if (!env) { envDetail.replaceChildren(); return; }
  const users = snap.species.filter((s) => s.layout === 'cutout' && s.defaultEnv === env.id).map((s) => s.display);
  envDetail.replaceChildren(h('section', { class: 'card', style: 'margin-top:10px' },
    h('div', { class: 'row' },
      h('input', { type: 'text', value: env.display, maxlength: 40, style: 'font-weight:600',
        onchange: (e) => act(() => window.dashBridge.updateEnv(env.id, { display: e.target.value })) }),
      env.builtin ? h('span', { class: 'tag' }, 'built-in') : h('button', { class: 'danger',
        onclick: () => { if (confirm(`Remove "${env.display}"?`)) { selectedEnv = null; act(() => window.dashBridge.removeEnv(env.id)); } } }, 'Remove')),
    h('textarea', { rows: 2, value: env.description, placeholder: 'Describe the place…',
      onchange: (e) => act(() => window.dashBridge.updateEnv(env.id, { description: e.target.value })) }),
    h('div', { class: 'help' }, users.length ? `Default environment for: ${users.join(', ')}` : 'Not the default for any species yet — set it on a cutout species.'),
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { onclick: () => showEnvPrompt(env.display, env.description) }, 'Make prompt from this'))));
}

async function showEnvPrompt(name, description) {
  try {
    showError(null);
    $('env-prompt').value = await window.dashBridge.genPrompt({ kind: 'environ', spec: { name, description } });
    $('env-prompt-box').hidden = false;
  } catch (e) { showError(e); }
}

onSnap((snap) => renderUnlessEditing(envList, () => renderEnvs(snap)));

$('env-prompt-btn').addEventListener('click', () => showEnvPrompt($('env-name').value.trim(), $('env-desc').value));
$('env-import-btn').addEventListener('click', async () => {
  const display = $('env-name').value.trim();
  if (!display) return showError('Give the environment a name first.');
  const r = await act(() => window.dashBridge.importEnv({ display, description: $('env-desc').value }));
  if (r && r.created) { selectedEnv = r.created; $('env-name').value = ''; $('env-desc').value = ''; renderEnvs(app.snap); }
});

const { TINTS, cssColor } = require('./tints');
const { ACTIONS, ROLE_POLICY, OWNER, effective, check, withinBounds } = require('./permissions');
const { CATEGORIES } = require('./agent-types');
const { hueOfType } = require('./type-colors');

// IPC handlers for the roster / species / environment / frame-style UI.
// Kept out of main.js so they can be exercised with fake dependencies (see tests/ipc-pets.test.js).
function registerPetIpc({
  ipcMain, dialog, nativeImage, pets, mutate, petSnapshot, savePetConfig, reloadPetWindows,
  getParentWindow = () => undefined, clearThumbs = () => {}, borderById, onRolesChanged = () => {}, onProjectsChanged = () => {}, frames = [],
}) {
  ipcMain.handle('pets-get', () => petSnapshot());
  ipcMain.handle('pets-create', (_e, input) => { mutate(() => pets.createPets(input || {})); return petSnapshot(); });
  ipcMain.handle('pets-update', (_e, id, patch) => { mutate(() => pets.roster.update(id, patch)); return petSnapshot(); });
  ipcMain.handle('pets-remove', (_e, id) => { mutate(() => pets.roster.remove(id)); return petSnapshot(); });
  ipcMain.handle('pets-set-lead', (_e, id) => { mutate(() => pets.roster.setLead(id)); return petSnapshot(); });

  ipcMain.handle('species-update', (_e, slug, patch) => { mutate(() => pets.species.update(slug, patch)); return petSnapshot(); });
  ipcMain.handle('species-create-draft', (_e, input) => {
    const sp = mutate(() => pets.species.createDraft(input || {}));
    return { ...petSnapshot(), created: sp.slug };
  });
  ipcMain.handle('species-remove-draft', (_e, slug) => { mutate(() => pets.species.removeDraft(slug)); return petSnapshot(); });
  ipcMain.handle('gen-prompt', (_e, req) => pets.prompt(req || {}));

  const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }];
  const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });

  // Pick a sheet (one 6×6 atlas, or six row strips) and install it for a species.
  ipcMain.handle('species-import', async (_e, { slug, mode, chroma }) => {
    const strips = mode === 'strips';
    const picked = await dialog.showOpenDialog(getParentWindow(), {
      title: strips ? 'Choose the 6 row strips (name them 1…6 in order)' : 'Choose the sprite sheet',
      properties: strips ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: IMAGE_FILTERS,
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, ...petSnapshot() };
    const files = [...picked.filePaths].sort(naturalSort);
    const result = await pets.importSheet({ slug, ...(strips ? { strips: files } : { atlas: files[0] }), chroma: chroma || null });
    mutate(() => {});
    // The lead pet may be using this species: its art changed on disk.
    if (pets.lead() && pets.lead().species === slug) reloadPetWindows();
    clearThumbs();
    return { ...petSnapshot(), warnings: result.warnings, layout: result.layout };
  });

  ipcMain.handle('extra-import', async (_e, { slug, name, fps, loops, triggers, chroma }) => {
    const picked = await dialog.showOpenDialog(getParentWindow(), {
      title: `Choose the 6-frame strip for "${name}"`, properties: ['openFile'], filters: IMAGE_FILTERS,
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, ...petSnapshot() };
    const r = await pets.importExtra({ slug, name, strip: picked.filePaths[0], fps, loops, triggers, chroma: chroma || null });
    mutate(() => {});
    if (pets.lead() && pets.lead().species === slug) reloadPetWindows();
    clearThumbs();
    return { ...petSnapshot(), warnings: r.warnings, row: r.row };
  });

  // Projects: name, emoji, colour, frame and environment shared by all of a project's agents.
  const projectState = () => ({
    projects: pets.projects.list(),
    assignments: pets.projects.assignments(),
    frames: frames.map((f) => ({ id: f.id, label: f.label, dynamic: !!f.dynamic })),
    environs: pets.environs.list().map((e) => ({ id: e.id, display: e.display })),
  });
  ipcMain.handle('projects-get', () => projectState());
  ipcMain.handle('projects-update', (_e, key, patch) => { pets.updateProject(key, patch || {}); onProjectsChanged(); return projectState(); });
  ipcMain.handle('projects-assign', (_e, id, key) => { pets.projects.assign(String(id), key === null || key === undefined ? null : String(key)); onProjectsChanged(); return projectState(); });
  ipcMain.handle('projects-forget', (_e, key) => { pets.projects.forget(key); onProjectsChanged(); return projectState(); });

  const snapshotTints = () => TINTS.map((t) => ({ id: t.id, label: t.label, css: cssColor(t.id) }));
  // Agent Forge: which species stands for each Firm role (sub-agents keep their root's tint).
  const forgeState = () => ({
    roles: pets.FIRM_ROLES,
    map: pets.roleSpeciesMap(),
    tintMap: pets.roleTintMap(),
    tints: snapshotTints(),
    species: pets.species.list().filter((s) => s.ready).map((s) => ({ slug: s.slug, display: s.display })),
  });
  ipcMain.handle('forge-set-tint', (_e, role, tint) => {
    const clean = pets.setRoleTint({ ...pets.roleTintMap(), [role]: tint || null });
    savePetConfig({ roleTint: clean });
    onRolesChanged();
    return forgeState();
  });
  ipcMain.handle('forge-get', () => forgeState());

  // Agent types: Firm-role categories, species, personality, traits and permissions; pins and auto-pick.
  const typesState = () => ({
    types: pets.agentTypes.list().map((t) => ({ ...t, border: hueOfType(t), can: [...effective(t)], record: pets.ledger.summary().get(t.slug) || { credits: 0, violations: 0, recent: [] } })),
    categories: CATEGORIES, actions: ACTIONS, owners: OWNER,
    policy: Object.fromEntries(Object.entries(ROLE_POLICY).map(([r, p]) => [r, p.allow])),
    pins: pets.agentTypes.pins(), autoRoots: pets.agentTypes.autoRoots(), spread: pets.agentTypes.spread(),
    species: pets.species.list().filter((s) => s.ready).map((s) => ({ slug: s.slug, display: s.display })),
    tints: snapshotTints(),
  });
  const typesChanged = () => { onRolesChanged(); return typesState(); };
  ipcMain.handle('types-get', () => typesState());
  ipcMain.handle('types-put', (_e, input) => { pets.agentTypes.put(input || {}, pets.typeChecks); return typesChanged(); });
  ipcMain.handle('types-remove', (_e, slug) => { pets.agentTypes.remove(String(slug)); return typesChanged(); });
  ipcMain.handle('types-pin', (_e, kind, key, slug) => { pets.agentTypes.pin(kind, String(key), slug === null || slug === undefined || slug === '' ? null : String(slug)); return typesChanged(); });
  ipcMain.handle('types-auto-roots', (_e, on) => { pets.agentTypes.setAutoRoots(!!on); return typesChanged(); });
  // Ask the permission model; with `record`, a hand-off or denial is written to the ledger as a violation.
  ipcMain.handle('types-spread', (_e, on) => { pets.agentTypes.setSpread(!!on); return typesChanged(); });
  ipcMain.handle('types-check', (_e, slug, action, opts = {}) => {
    const t = pets.agentTypes.get(String(slug));
    if (!t) throw new Error('Unknown agent type');
    const r = check(t, String(action));
    if (opts && opts.record && r.decision !== 'allow') pets.ledger.record({ type: t.slug, agentId: opts.agentId, kind: 'violation', action: r.action, note: r.reason });
    return r;
  });
  ipcMain.handle('types-bounds', (_e, slug, usage) => {
    const t = pets.agentTypes.get(String(slug));
    if (!t) throw new Error('Unknown agent type');
    return withinBounds(t.bounds, usage || {});
  });
  ipcMain.handle('ledger-record', (_e, entry) => { pets.ledger.record(entry || {}); return typesState(); });
  ipcMain.handle('ledger-get', (_e, limit) => pets.ledger.entries(Number(limit) || 100));
  ipcMain.handle('forge-set', (_e, role, species) => {
    const clean = pets.setRoleSpecies({ ...pets.roleSpeciesMap(), [role]: species || null });
    savePetConfig({ roleSpecies: clean });
    onRolesChanged();
    return forgeState();
  });

  ipcMain.handle('species-preview', (_e, slug) => {
    try { return nativeImage.createFromPath(pets.resolveAsset('sprite-atlas.png', { char: slug })).resize({ width: 720 }).toDataURL(); }
    catch { return null; }
  });

  ipcMain.handle('env-import', async (_e, { display, description }) => {
    const picked = await dialog.showOpenDialog(getParentWindow(), { title: 'Choose a background image', properties: ['openFile'], filters: IMAGE_FILTERS });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, ...petSnapshot() };
    const r = await pets.importEnvironFile({ source: picked.filePaths[0], display, description });
    mutate(() => {});
    return { ...petSnapshot(), created: r.id };
  });
  ipcMain.handle('env-update', (_e, id, patch) => { mutate(() => pets.environs.updateMeta(id, patch)); return petSnapshot(); });
  ipcMain.handle('env-remove', (_e, id) => { mutate(() => pets.environs.remove(id)); return petSnapshot(); });

  ipcMain.handle('borders-set', (_e, id) => {
    if (!borderById(id)) throw new Error(`Unknown frame style: ${id}`);
    savePetConfig({ border: id });
    reloadPetWindows();
    return petSnapshot();
  });

}

module.exports = { registerPetIpc };

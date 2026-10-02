// IPC handlers for the roster / species / environment / frame-style UI.
// Kept out of main.js so they can be exercised with fake dependencies (see tests/ipc-pets.test.js).
function registerPetIpc({
  ipcMain, dialog, nativeImage, pets, mutate, petSnapshot, savePetConfig, reloadPetWindows,
  getParentWindow = () => undefined, clearThumbs = () => {}, borderById,
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

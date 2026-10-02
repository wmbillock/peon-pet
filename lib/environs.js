const fs = require('fs');
const path = require('path');

const ENV_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ENV_SIZE = 1024;

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

/**
 * Environments are backgrounds, independent of any character. Cutout (transparent) characters sit
 * on one; baked sheets paint their own scene and ignore it. Built-ins ship in the repo; user
 * environments are PNGs in `dir` with descriptions in `file`.
 *   builtins: [{ id, display, description, path }]   (path absolute)
 */
function createEnvironStore({ file, dir, builtins = [] }) {
  const meta = () => {
    const d = readJson(file, {});
    return d && typeof d.environs === 'object' && d.environs ? d.environs : {};
  };
  const own = (o, k) => Object.hasOwn(o, k);
  const userFile = (id) => path.join(dir, `${id}.png`);

  const store = {
    list() {
      const m = meta();
      const out = builtins.map((b) => ({ id: b.id, display: b.display, description: b.description || '', builtin: true, path: b.path }));
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* none yet */ }
      for (const n of names) {
        const id = n.replace(/\.png$/, '');
        if (!n.endsWith('.png') || !ENV_ID_RE.test(id) || out.some((o) => o.id === id)) continue;
        const o = own(m, id) ? m[id] : {};
        out.push({ id, display: o.display || id, description: o.description || '', builtin: false, path: userFile(id) });
      }
      return out;
    },
    get: (id) => store.list().find((e) => e.id === id) || null,
    has: (id) => typeof id === 'string' && !!store.get(id),
    pathOf: (id) => (store.get(id) || {}).path || null,

    // Pick an unused id for a display name.
    newId(display) {
      const base = String(display || 'place').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'place';
      const taken = new Set(store.list().map((e) => e.id));
      let id = base;
      for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
      return id;
    },

    updateMeta(id, patch) {
      if (!ENV_ID_RE.test(id)) throw new Error('Invalid environment id');
      const all = readJson(file, {});
      const environs = all.environs && typeof all.environs === 'object' ? all.environs : {};
      const cur = own(environs, id) ? environs[id] : {};
      if ('display' in patch) {
        const d = clean(patch.display, 40);
        if (!d) throw new Error('Name cannot be empty');
        cur.display = d;
      }
      if ('description' in patch) cur.description = clean(patch.description, 2000);
      environs[id] = cur;
      writeJsonAtomic(file, { version: 1, environs });
    },

    remove(id) {
      const e = store.get(id);
      if (!e) throw new Error('Unknown environment');
      if (e.builtin) throw new Error('Built-in environments cannot be removed');
      fs.rmSync(e.path, { force: true });
      const all = readJson(file, {});
      if (all.environs && own(all.environs, id)) delete all.environs[id];
      writeJsonAtomic(file, { version: 1, environs: all.environs || {} });
    },
  };
  return store;
}

// Cover-crop any image to a square, downscale to ENV_SIZE, write an opaque PNG.
async function importEnvironment({ source, destFile, size = ENV_SIZE }) {
  const { createCanvas, loadImage } = require('canvas');
  const img = await loadImage(source);
  const side = Math.min(img.width, img.height);
  if (side < 128) throw new Error(`Image is too small (${img.width}×${img.height})`);
  const out = Math.min(size, side);
  const canvas = createCanvas(out, out);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, canvas.toBuffer('image/png'));
  return { size: out, cropped: img.width !== img.height };
}

module.exports = { createEnvironStore, importEnvironment, ENV_ID_RE };

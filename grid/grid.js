// Zoom grid: one animated tile per active agent session, showing its assigned pet.
const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const zoomEl = document.getElementById('zoom');
const coldEl = document.getElementById('show-cold');

// Mirrors ANIM_CONFIG in lib/anim-state.js (6 frames each).
const ANIMS = {
  sleeping: { row: 0, fps: 3 }, waking: { row: 1, fps: 4 }, typing: { row: 2, fps: 8 },
  alarmed: { row: 3, fps: 8 }, celebrate: { row: 4, fps: 8 }, annoyed: { row: 5, fps: 8 },
};
const REACTION_MS = 4500;   // how long a one-off reaction (celebrate, alarmed…) is shown

let sessions = [];
const tiles = new Map();    // session id → { el, sprite, ... }

const saved = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

zoomEl.value = saved('zoom', 200);
coldEl.checked = saved('cold', '0') === '1';
const applyZoom = () => { gridEl.style.setProperty('--tile', `${zoomEl.value}px`); save('zoom', zoomEl.value); };
zoomEl.addEventListener('input', applyZoom);
coldEl.addEventListener('change', () => { save('cold', coldEl.checked ? '1' : '0'); render(); });
applyZoom();
window.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomEl.value = Math.min(420, Math.max(96, Number(zoomEl.value) - Math.sign(e.deltaY) * 16));
  applyZoom();
}, { passive: false });
document.getElementById('open-panel').addEventListener('click', () => window.gridBridge.openPanel());

const assetUrl = (file, params) => `peon-asset://${file}/?${new URLSearchParams(params)}`;

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function animFor(s) {
  if (s.anim && s.anim !== 'typing' && s.anim !== 'waking' && Date.now() - s.animAt < REACTION_MS) return s.anim;
  return s.hot ? 'typing' : 'sleeping';
}

function makeTile(s) {
  const el = document.createElement('div');
  const env = document.createElement('div');
  env.className = 'layer env';
  const sprite = document.createElement('div');
  sprite.className = 'layer sprite';
  const tint = document.createElement('div');
  tint.className = 'layer tint';
  const led = document.createElement('div');
  led.className = 'led';
  const badge = document.createElement('div');
  badge.className = 'badge';
  const scene = document.createElement('div');
  scene.className = 'scene';
  scene.append(env, sprite, tint, led, badge);
  const pet = document.createElement('div');
  pet.className = 'pet';
  const what = document.createElement('div');
  what.className = 'what';
  const info = document.createElement('div');
  info.className = 'info';
  info.append(pet, what);
  el.append(scene, info);
  return { el, env, sprite, tint, badge, pet, what, frame: 0, lastAt: 0, spriteKey: '', envKey: '' };
}

function updateTile(t, s) {
  const p = s.pet;
  t.el.className = `tile ${s.hot ? 'hot' : s.warm ? 'warm' : 'cold'}`;
  t.badge.textContent = s.agent;
  t.badge.style.display = s.agent === 'claude' ? 'none' : '';
  if (p) {
    const spriteKey = p.species;
    if (t.spriteKey !== spriteKey) { t.spriteKey = spriteKey; t.sprite.style.backgroundImage = `url(${assetUrl('sprite-atlas.png', { char: p.species })})`; }
    const envKey = p.layout === 'cutout' ? `${p.species}|${p.env}` : '';
    if (t.envKey !== envKey) {
      t.envKey = envKey;
      t.env.style.backgroundImage = envKey ? `url(${assetUrl('bg.png', { char: p.species, env: p.env || '' })})` : 'none';
    }
    t.tint.style.background = p.tintCss;
    t.pet.replaceChildren(p.name);
    const small = document.createElement('small');
    small.textContent = p.speciesDisplay;
    t.pet.append(small);
  }
  const b = document.createElement('b');
  b.textContent = s.name || '(unknown)';
  t.what.replaceChildren(b, ` · ${s.hot ? 'working' : s.warm ? 'idle' : 'cold'} · ${ago(s.lastActive)}`);
  t.el.title = `${s.cwd || ''}\n${s.id}`.trim();
  t.anim = animFor(s);
}

function render() {
  const shown = sessions.filter((s) => coldEl.checked || s.hot || s.warm);
  const ids = new Set(shown.map((s) => s.id));
  for (const [id, t] of tiles) if (!ids.has(id)) { t.el.remove(); tiles.delete(id); }
  shown.forEach((s, i) => {
    let t = tiles.get(s.id);
    if (!t) { t = makeTile(s); tiles.set(s.id, t); }
    updateTile(t, s);
    if (gridEl.children[i] !== t.el) gridEl.insertBefore(t.el, gridEl.children[i] || null);
  });
  countEl.textContent = shown.length ? `(${shown.length})` : '';
  emptyEl.hidden = shown.length > 0;
}

window.gridBridge.onSessions((data) => {
  // Hot first, then most recently active, so the busiest agents lead.
  sessions = [...data.sessions].sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || b.lastActive - a.lastActive);
  render();
});

// One shared clock drives every tile's sprite frames.
function tick(now) {
  requestAnimationFrame(tick);
  for (const t of tiles.values()) {
    const a = ANIMS[t.anim] || ANIMS.sleeping;
    if (now - t.lastAt < 1000 / a.fps) continue;
    t.lastAt = now;
    t.frame = (t.frame + 1) % 6;
    t.sprite.style.backgroundPosition = `${(t.frame / 5) * 100}% ${(a.row / 5) * 100}%`;
  }
}
requestAnimationFrame(tick);
setInterval(() => { for (const [id, t] of tiles) { const s = sessions.find((x) => x.id === id); if (s) updateTile(t, s); } }, 1000);  // keep "ago" and reactions fresh
window.gridBridge.ready();

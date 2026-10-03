const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const count = document.getElementById('count');
const mute = document.getElementById('mute');
const globalPack = document.getElementById('global-pack');
const globalApply = document.getElementById('global-apply');
const globalAll = document.getElementById('global-all');
const globalNote = document.getElementById('global-note');
const auditionBtn = document.getElementById('audition');
const volume = document.getElementById('volume');
const volumeVal = document.getElementById('volume-val');
const catBox = document.getElementById('categories');
const notif = document.getElementById('notif');

let sessions = [];
let packState = { packs: [], defaultPack: '', rotationMode: '', pathRuleCount: 0, sessionPacks: {}, volume: 0.5, categories: {}, desktopNotifications: true };

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function cell(text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

function displayName(name) {
  const p = packState.packs.find((x) => x.name === name);
  return p ? p.display : name;
}

function packOptions(select, selected, defaultLabel) {
  const opts = [];
  if (defaultLabel) {
    const o = new Option(defaultLabel, '');
    opts.push(o);
  }
  for (const p of packState.packs) opts.push(new Option(p.display, p.name));
  // A pin to a pack that is no longer installed still shows up rather than silently resetting.
  if (selected && !packState.packs.some((p) => p.name === selected)) opts.push(new Option(`${selected} (missing)`, selected));
  select.replaceChildren(...opts);
  select.value = selected || '';
}

function audition(name) {
  window.dashBridge.audition(name).catch(showError);
}

const CATEGORY_LABELS = {
  'session.start': 'Session start', 'task.acknowledge': 'Acknowledge', 'task.complete': 'Task complete',
  'task.error': 'Error', 'input.required': 'Input needed', 'resource.limit': 'Rate limit', 'user.spam': 'Annoyed',
};

async function mutate(call) {
  try {
    showError(null);
    packState = await call();
  } catch (e) { showError(e); }
  renderAll();
}

function renderCategories() {
  if (catBox.contains(document.activeElement)) return;
  catBox.replaceChildren(...Object.entries(CATEGORY_LABELS).map(([key, label]) => {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = packState.categories[key] !== false;
    cb.addEventListener('change', () => mutate(() => window.dashBridge.setCategory(key, cb.checked)));
    l.append(cb, ' ' + label);
    return l;
  }));
  notif.checked = packState.desktopNotifications;
}
notif.addEventListener('change', () => mutate(() => window.dashBridge.setNotifications(notif.checked)));

function renderGlobal() {
  renderCategories();
  if (document.activeElement !== volume) {
    volume.value = Math.round(packState.volume * 100);
    volumeVal.textContent = `${volume.value}%`;
  }
  if (document.activeElement !== globalPack) packOptions(globalPack, packState.defaultPack);
  const notes = [];
  if (packState.rotationMode !== 'session_override') {
    notes.push(`Rotation mode is "${packState.rotationMode}", so per-session pins only apply in session_override mode.`);
  }
  if (packState.pathRuleCount) {
    notes.push(`${packState.pathRuleCount} path rules in config.json still win for matching directories unless a session is pinned.`);
  }
  globalNote.textContent = notes.join(' ');
}

function renderRows() {
  if (rows.contains(document.activeElement)) return;  // don't close a dropdown mid-selection
  rows.replaceChildren(...sessions.map((s) => {
    const tr = document.createElement('tr');
    tr.className = s.hot ? 'hot' : s.warm ? 'warm' : '';
    tr.title = `${s.cwd || ''}\n${s.id}`.trim();
    const nameTd = cell(s.name || '(unknown)');
    if (s.agent === 'codex') {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'codex';
      nameTd.append(' ', tag);
    }
    tr.append(nameTd);
    const status = cell((s.hot ? 'active' : s.warm ? 'idle' : 'cold'));
    const dot = document.createElement('span');
    dot.className = 'dot';
    status.prepend(dot);

    const voiceTd = document.createElement('td');
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', `Voice for ${s.name || s.id}`);
    packOptions(sel, packState.sessionPacks[s.peonKey || s.id], `Default (${displayName(packState.defaultPack)})`);
    sel.addEventListener('change', async () => {
      try {
        showError(null);
        packState = await window.dashBridge.setSessionPack(s.id, sel.value || null);
      } catch (e) { showError(e); }
      sel.blur();
      renderAll();
    });
    const play = document.createElement('button');
    play.className = 'play';
    play.textContent = '▶';
    play.title = 'Audition this voice';
    play.addEventListener('click', () => audition(sel.value || packState.defaultPack));
    voiceTd.append(sel, play);

    const petTd = document.createElement('td');
    if (s.pet) {
      const sw = document.createElement('span');
      sw.className = 'dot';
      sw.style.background = s.pet.tintCss === 'transparent' ? '#777' : s.pet.tintCss.replace(/[\d.]+\)$/, '1)');
      petTd.append(sw, s.pet.name);
      petTd.title = s.pet.speciesDisplay + (s.pet.tint !== 'none' ? ` · ${s.pet.tint} tint` : '');
    }
    tr.append(petTd, status, cell(ago(s.lastActive)), voiceTd);
    return tr;
  }));
  empty.style.display = sessions.length ? 'none' : 'block';
  count.textContent = sessions.length ? `(${sessions.length})` : '';
}

function renderAll() {
  renderGlobal();
  renderRows();
}

async function refreshPacks() {
  try { packState = await window.dashBridge.getPacks(); } catch (e) { showError(e); }
  renderAll();
}

auditionBtn.addEventListener('click', () => audition(globalPack.value));

// Persist on release (not every tick) so we don't rewrite config.json dozens of times.
volume.addEventListener('input', () => { volumeVal.textContent = `${volume.value}%`; });
volume.addEventListener('change', async () => {
  try {
    showError(null);
    packState = await window.dashBridge.setVolume(volume.value / 100);
  } catch (e) { showError(e); }
  volume.blur();
  renderAll();
});

globalApply.addEventListener('click', async () => {
  globalApply.disabled = true;
  try {
    showError(null);
    packState = await window.dashBridge.setGlobalPack(globalPack.value, globalAll.checked);
  } catch (e) { showError(e); }
  globalApply.disabled = false;
  globalPack.blur();
  renderAll();
});

window.dashBridge.onSessions((data) => {
  sessions = data.sessions;
  app.sessions = sessions;
  document.dispatchEvent(new Event('sessions'));
  refreshPacks();  // also picks up changes made outside the pet (`peon packs use`, /peon-ping-use)
  refreshSnap();   // pet assignments / art may have changed
});

window.dashBridge.onSoundState(({ muted }) => {
  mute.classList.toggle('muted', muted);
  mute.textContent = muted ? 'Sounds muted — resume' : 'Mute sounds';
});
mute.addEventListener('click', () => window.dashBridge.toggleSound());
window.dashBridge.ready();

// --- Pixoo 64 ---
const pixooIp = document.getElementById('pixoo-ip');
const pixooOn = document.getElementById('pixoo-on');
const pixooStatus = document.getElementById('pixoo-status');

const pixooBright = document.getElementById('pixoo-bright');
const pixooBrightVal = document.getElementById('pixoo-bright-val');
const pixooLook = document.getElementById('pixoo-look');
const pixooLookVal = document.getElementById('pixoo-look-val');

function renderPixoo({ ip, enabled, status, look, brightness }) {
  if (document.activeElement !== pixooLook) { pixooLook.value = look; pixooLookVal.textContent = look; }
  if (document.activeElement !== pixooBright) {
    pixooBright.value = brightness ?? 100;
    pixooBrightVal.textContent = brightness === null ? 'as-is' : `${brightness}%`;
  }
  if (document.activeElement !== pixooIp) pixooIp.value = ip || '';
  pixooOn.checked = !!enabled;
  pixooStatus.textContent = enabled ? status : '';
  pixooStatus.title = enabled ? status : '';
  pixooStatus.className = status === 'connected' ? 'ok' : String(status).startsWith('error') ? 'bad' : '';
}

async function savePixoo(extra = {}) {
  try {
    showError(null);
    renderPixoo(await window.dashBridge.setPixoo({ ip: pixooIp.value, enabled: pixooOn.checked, ...extra }));
  } catch (e) {
    showError(e);
    pixooOn.checked = false;
  }
}
pixooOn.addEventListener('change', () => savePixoo());
// Release-only saves: every change re-uploads the animation to the device.
pixooLook.addEventListener('input', () => { pixooLookVal.textContent = pixooLook.value; });
pixooLook.addEventListener('change', () => savePixoo({ look: Number(pixooLook.value) }));
pixooBright.addEventListener('input', () => { pixooBrightVal.textContent = `${pixooBright.value}%`; });
pixooBright.addEventListener('change', () => savePixoo({ brightness: Number(pixooBright.value) }));
pixooIp.addEventListener('change', () => { if (pixooOn.checked) savePixoo(); });
window.dashBridge.onPixooState(renderPixoo);
window.dashBridge.getPixoo().then(renderPixoo);

// --- Frame style ---
const borderCards = document.getElementById('border-cards');

onSnap((snap) => renderUnlessEditing(borderCards, () => {
  borderCards.replaceChildren(...snap.borders.map((b) => {
    const btn = h('button', { class: 'cardbtn' + (b.id === snap.activeBorder ? ' on' : ''), title: b.label,
      onclick: () => act(() => window.dashBridge.setBorder(b.id)) });
    const dyn = b.id.startsWith('dyn-') ? b.id.slice(4) : null;
    btn.append(dyn ? h('div', { class: `dprev tile f-${dyn} hot` }) : b.thumb ? h('img', { class: 'ph frameprev', src: b.thumb }) : h('div', { class: 'ph frameprev' }, h('div', { style: 'padding-top:20px;color:#888' }, b.id === 'default' ? 'pet' : '')), b.label);
    return btn;
  }));
}));

document.getElementById('grid-btn').addEventListener('click', () => window.dashBridge.openGrid());

// --- Corner window switch (Overview page) ---
const cornerSeg = document.getElementById('corner-seg');
const markCornerView = (v) => { for (const b of cornerSeg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v); };
for (const b of cornerSeg.querySelectorAll('button')) {
  b.addEventListener('click', () => { window.dashBridge.setCornerView(b.dataset.v); markCornerView(b.dataset.v); });
}
window.dashBridge.onCornerView(markCornerView);
window.dashBridge.getCornerView().then(markCornerView);

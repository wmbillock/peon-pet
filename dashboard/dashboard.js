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

const pixooInterval = document.getElementById('pixoo-interval');

const pixooRotate = document.getElementById('pixoo-rotate');
const pixooRotateSec = document.getElementById('pixoo-rotate-sec');
const pixooPin = document.getElementById('pixoo-pin');
let pixooPinWanted = '';
let pixooAgents = [];   // [{id, label}] from the live session list
function fillPinOptions() {
  const opts = [new Option('(rotate)', '')];
  for (const a of pixooAgents) opts.push(new Option(a.label, a.id));
  if (pixooPinWanted && !pixooAgents.some((a) => a.id === pixooPinWanted)) opts.push(new Option(`${pixooPinWanted} (not running)`, pixooPinWanted));
  pixooPin.replaceChildren(...opts);
  pixooPin.value = pixooPinWanted;
}

function renderPixoo({ ip, enabled, status, look, brightness, minIntervalSec, rotate, rotateSeconds, pin }) {
  pixooRotate.checked = rotate !== false;
  if (document.activeElement !== pixooRotateSec) pixooRotateSec.value = rotateSeconds ?? 60;
  pixooPinWanted = pin || '';
  fillPinOptions();
  if (document.activeElement !== pixooInterval && minIntervalSec !== undefined) pixooInterval.value = minIntervalSec;
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
// A busy display is the main reason to slow updates, so this applies to the next send without forcing one.
pixooInterval.addEventListener('change', () => savePixoo({ minIntervalSec: pixooInterval.value === '' ? 60 : Number(pixooInterval.value) }));
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

// --- Euphonia name and voice. Saves on change and confirms from what was read back from disk. ---
const euphPack = document.getElementById('euph-pack');
const euphName = document.getElementById('euph-name');
const euphNote = document.getElementById('euph-note');
function euphSaved(cfg, warning) {
  euphNote.style.color = warning ? '#ffcc66' : '#6dff7a';
  euphNote.textContent = `${warning ? warning + ' ' : ''}Saved \u2713 ${cfg.name}, voice: ${cfg.soundPack || '(none)'}`;
}
function euphFailed(msg) { euphNote.style.color = '#ff6060'; euphNote.textContent = `NOT saved: ${msg}`; }
async function loadEuphonia() {
  try {
    const r = await window.dashBridge.euphoniaGetConfig();
    if (!r) { euphFailed('could not read Euphonia\'s settings'); return; }
    const opts = [new Option('(no voice)', '')].concat(r.packs.map((p) => new Option(p.display === p.name ? p.name : `${p.display} (${p.name})`, p.name)));
    if (r.config.soundPack && !r.packs.some((p) => p.name === r.config.soundPack)) opts.unshift(new Option(`${r.config.soundPack} (not installed)`, r.config.soundPack));   // never show a different pack than the saved one
    euphPack.replaceChildren(...opts);
    euphPack.value = r.config.soundPack || '';
    euphName.value = r.config.name;
    euphSaved(r.config);
  } catch (e) { euphFailed(e.message); }
}
async function saveEuph(patch) {
  try {
    const r = await window.dashBridge.euphoniaSetConfig(patch);
    if (!r || !r.ok) { euphFailed((r && r.error) || 'unknown error'); return; }
    euphSaved(r.config, r.warning);
  } catch (e) { euphFailed(e.message); }
}
euphPack.addEventListener('change', () => saveEuph({ soundPack: euphPack.value }));
euphName.addEventListener('change', () => saveEuph({ name: euphName.value }));
document.getElementById('euph-audition').addEventListener('click', () => audition(euphPack.value));
loadEuphonia();

// --- Euphonia: tool access (grants). Only this window can change them. ---
const accessRows = document.getElementById('euph-access-rows');
const accessNote = document.getElementById('euph-access-note');
const accessErrors = document.getElementById('euph-access-errors');
const DUR_LABELS = { '1h': '1 hour', '4h': '4 hours', eod: 'until end of day', '7d': '7 days', blanket: 'blanket (until revoked)' };
const WRITE_WARNING = 'Write access, with no expiry, lets Euphonia use EVERY tool this server offers that is not a plain look-up: sending messages, creating and editing tickets and pages, and anything the app does not recognise as read-only. It stays until you revoke it. She will still show you the exact text and destination in chat and wait for your reply before each write, but that is her behaviour, not a lock.\n\nGrant blanket write access?';
function accessMsg(text) { accessNote.textContent = text; setTimeout(() => { if (accessNote.textContent === text) accessNote.textContent = ''; }, 3500); }

function renderAccess(data) {
  accessErrors.replaceChildren();
  if (!data.ok) { accessErrors.textContent = data.error || 'Could not load tool access'; return; }
  for (const e of data.errors || []) {
    const p = document.createElement('div'); p.className = 'help'; p.style.color = '#ff9a9a';
    p.textContent = `Server discovery: ${e.message}`; accessErrors.append(p);
  }
  const byServer = new Map((data.grants || []).map((g) => [g.server, g]));
  const rows = [...data.servers];
  for (const g of data.grants || []) if (!rows.some((s) => s.name === g.server)) rows.push({ name: g.server, sources: ['grant'] });   // a grant for a server no longer configured stays visible so it can be revoked
  accessRows.replaceChildren(...rows.map((s) => {
    const g = byServer.get(s.name);
    const tr = document.createElement('tr');
    const td = (...kids) => { const c = document.createElement('td'); c.append(...kids); tr.append(c); return c; };
    td(s.name);
    td((s.sources || []).join(', ') + (s.status ? ` (${s.status})` : ''));
    const level = document.createElement('select');
    for (const v of ['none', 'read', 'write']) level.append(new Option(v, v));
    level.value = g ? g.level : 'none';
    const dur = document.createElement('select');
    for (const [v, label] of Object.entries(DUR_LABELS)) dur.append(new Option(label, v));
    dur.value = g ? (g.expires_at ? '1h' : 'blanket') : '1h';
    td(level); td(dur);
    td(g ? (g.expires_at ? new Date(g.expires_at).toLocaleString() : 'never (blanket)') : '');
    const grant = document.createElement('button'); grant.textContent = 'Grant';
    const revoke = document.createElement('button'); revoke.textContent = 'Revoke'; revoke.disabled = !g;
    grant.addEventListener('click', async () => {
      if (level.value === 'none') { accessMsg('Pick read or write first (none means no access: use Revoke).'); return; }
      if (level.value === 'write' && dur.value === 'blanket' && !window.confirm(WRITE_WARNING)) return;
      const r = await window.dashBridge.euphoniaAccessSet({ server: s.name, level: level.value, duration: dur.value });
      if (!r.ok) { accessMsg(r.error); return; }
      accessMsg(`${s.name}: ${level.value} granted`); loadAccess();
    });
    revoke.addEventListener('click', async () => { await window.dashBridge.euphoniaAccessRevoke({ server: s.name }); accessMsg(`${s.name}: revoked`); loadAccess(); });
    td(grant, revoke);
    return tr;
  }));
}
async function loadAccess() {
  try { renderAccess(await window.dashBridge.euphoniaAccessGet()); } catch (e) { renderAccess({ ok: false, error: e.message }); }
}
document.getElementById('euph-revoke-all').addEventListener('click', async () => {
  await window.dashBridge.euphoniaAccessRevoke({ all: true }); accessMsg('All tool access revoked'); loadAccess();
});
document.querySelector('#nav button[data-page="euphonia"]').addEventListener('click', loadAccess);
window.dashBridge.onShowEuphonia(() => { showPage('euphonia'); loadAccess(); });
loadAccess();

// --- Voice focus: which agent holds the voice ---
const voiceMode = document.getElementById('voice-mode');
const voiceNow = document.getElementById('voice-now');
const VOICE_WHY = { pixoo: 'the Pixoo is showing', chat: 'her chat window is focused', view: 'the main view shows', 'fallback-lead': 'nothing else resolves, so the lead', none: 'nothing resolves' };
function renderVoice(st) {
  if (!st) { voiceNow.textContent = ''; return; }
  voiceMode.value = st.mode;
  voiceNow.textContent = st.mode === 'all' ? 'Voice: every agent (filtering off)' : `Voice: ${st.name || 'nobody'} (${VOICE_WHY[st.reason] || st.reason})`;
}
voiceMode.addEventListener('change', async () => renderVoice(await window.dashBridge.voiceFocusSet(voiceMode.value)));
window.dashBridge.onVoiceFocus(renderVoice);
window.dashBridge.voiceFocusGet().then(renderVoice).catch(() => {});

pixooRotate.addEventListener('change', () => savePixoo({ rotate: pixooRotate.checked }));
pixooRotateSec.addEventListener('change', () => savePixoo({ rotateSeconds: Number(pixooRotateSec.value) }));
pixooPin.addEventListener('change', () => savePixoo({ pin: pixooPin.value || null }));
window.dashBridge.onSessions((data) => {
  const next = [{ id: 'euphonia', label: 'Euphonia (lead)' }].concat((data.sessions || []).filter((s) => s.isRoot !== false).map((s) => ({ id: s.id, label: s.title || s.name || s.id })));
  if (JSON.stringify(next) === JSON.stringify(pixooAgents)) return;
  pixooAgents = next; fillPinOptions();
});

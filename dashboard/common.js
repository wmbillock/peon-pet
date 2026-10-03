// Shared helpers for the control panel scripts.
const $ = (id) => document.getElementById(id);

// Tiny DOM builder: h('div', { class: 'x', onclick }, child, 'text', ...)
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

const errorBox = $('error');
function showError(err) {
  errorBox.textContent = err ? String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
  errorBox.style.display = err ? 'block' : 'none';
}

const app = { snap: null, sessions: [] };
const snapListeners = [];
let snapKey = '';
const onSnap = (fn) => { snapListeners.push(fn); if (app.snap) fn(app.snap); };

function setSnap(snap) {
  const key = JSON.stringify(snap);
  if (key === snapKey) return;  // nothing changed: don't churn the DOM
  snapKey = key;
  app.snap = snap;
  for (const fn of snapListeners) fn(snap);
}

async function refreshSnap() {
  try { setSnap(await window.dashBridge.getPets()); } catch (e) { showError(e); }
}

// Run a bridge call that returns a fresh snapshot; surface errors; resolves to the result or null.
async function act(call) {
  try {
    showError(null);
    const r = await call();
    if (r && r.pets) setSnap(r);
    return r;
  } catch (e) {
    showError(e);
    refreshSnap();
    return null;
  }
}

// Skip re-rendering a container while the user is typing/choosing inside it.
function renderUnlessEditing(container, render) {
  const el = document.activeElement;
  if (el && container.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
    el.addEventListener('blur', () => setTimeout(() => render(), 0), { once: true });
    return;
  }
  render();
}

// A thumbnail with the pet's translucent tint laid over it.
function petThumb(src, tintCss) {
  return h('div', { class: 'thumb' }, src ? h('img', { src }) : null, h('div', { class: 'tint', style: `background:${tintCss || 'transparent'}` }));
}

// Editable key/value "durable facts". `save(facts)` is called on every change; `openSet` remembers
// which editors are expanded across re-renders.
function factsEditor(facts, save, openSet, openKey, hint) {
  const box = h('details', { class: 'facts', open: openSet.has(openKey) });
  box.addEventListener('toggle', () => { if (box.open) openSet.add(openKey); else openSet.delete(openKey); });
  box.append(h('summary', {}, `Facts (${facts.length})`));
  const rowsEl = h('div');
  const commit = () => save([...rowsEl.querySelectorAll('.fact')].map((r) => ({ key: r.querySelector('.k').value, value: r.querySelector('.v').value })));
  const addRow = (f) => {
    const row = h('div', { class: 'fact' },
      h('input', { type: 'text', class: 'k', value: f.key, placeholder: 'Fact', onchange: commit }),
      h('input', { type: 'text', class: 'v', value: f.value, placeholder: 'Detail', onchange: commit }),
      h('button', { class: 'iconbtn', title: 'Remove', onclick: () => { row.remove(); commit(); } }, '×'));
    rowsEl.append(row);
    return row;
  };
  facts.forEach(addRow);
  box.append(rowsEl, h('button', { style: 'margin-top:6px', onclick: () => addRow({ key: '', value: '' }).querySelector('.k').focus() }, '+ Add fact'));
  if (!facts.length && hint) box.append(h('div', { class: 'help' }, hint));
  return box;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button.copy');
  if (!btn) return;
  const src = $(btn.dataset.copy);
  const ok = await copyText(src.value);
  const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
  btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
  setTimeout(() => { btn.textContent = label; }, 1400);
});

// Pages (left drawer navigation, toggled by the hamburger)
const PAGE_TITLES = {
  overview: 'Overview', projects: 'Projects', pets: 'Pet roster', species: 'Species & art', environs: 'Environments',
  display: 'Frames & Pixoo', sound: 'Voice & sound', firm: 'The Firm', forge: 'Agent Forge',
};
function showPage(name) {
  if (!PAGE_TITLES[name]) name = 'overview';
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.page === name);
  for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== `page-${name}`;
  $('page-title').textContent = PAGE_TITLES[name];
  try { localStorage.setItem('page', name); } catch { /* storage unavailable */ }
}
for (const b of document.querySelectorAll('#nav button')) b.addEventListener('click', () => showPage(b.dataset.page));

const setNavCollapsed = (c) => {
  document.body.classList.toggle('nav-collapsed', c);
  try { localStorage.setItem('navCollapsed', c ? '1' : '0'); } catch { /* storage unavailable */ }
};
$('burger').addEventListener('click', () => setNavCollapsed(!document.body.classList.contains('nav-collapsed')));
try { setNavCollapsed(localStorage.getItem('navCollapsed') === '1'); } catch { /* default open */ }
try { showPage(localStorage.getItem('page') || 'overview'); } catch { showPage('overview'); }

window.addEventListener('focus', refreshSnap);
refreshSnap();

// Accessibility: tabs build their markup dynamically, so name unlabeled controls and mirror the
// visual `.on` state into ARIA after every DOM change instead of threading it through each builder.
const TOGGLE_SEL = '.seg button, .cardbtn, .emojis button, .sw';
function a11yPass(root = document) {
  for (const el of root.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (el.labels && el.labels.length) continue;
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) continue;
    const row = el.closest('.pet, .projcard, .card, tr');
    const owner = row && row.querySelector('input.name, input.pname, input[type=text]');
    const base = el.title || el.getAttribute('placeholder')
      || (el.previousElementSibling && el.previousElementSibling.tagName === 'LABEL' && el.previousElementSibling.textContent.trim())
      || (el.type === 'range' ? 'Slider' : el.tagName === 'SELECT' ? 'Choose' : el.type === 'checkbox' ? 'Toggle' : 'Value');
    const who = owner && owner !== el && owner.value ? ` (${owner.value})` : '';
    el.setAttribute('aria-label', base.replace(/\s+/g, ' ').trim() + who);
  }
  for (const b of root.querySelectorAll(TOGGLE_SEL)) b.setAttribute('aria-pressed', b.classList.contains('on') || b.classList.contains('sel') ? 'true' : 'false');
  for (const b of root.querySelectorAll('#nav button')) {
    if (b.classList.contains('on')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const b of root.querySelectorAll('button:not([aria-label])')) {
    if (!b.textContent.trim() && b.title) b.setAttribute('aria-label', b.title);
  }
  for (const im of root.querySelectorAll('img:not([alt])')) im.setAttribute('alt', '');
  const burger = $('burger');
  if (burger) burger.setAttribute('aria-expanded', String(!document.body.classList.contains('nav-collapsed')));
}
let a11yQueued = false;
new MutationObserver(() => {
  if (a11yQueued) return;
  a11yQueued = true;
  queueMicrotask(() => { a11yQueued = false; a11yPass(); });
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
a11yPass();

// Move focus to the page heading on navigation so keyboard/screen-reader users land in the new content.
for (const b of document.querySelectorAll('#nav button')) {
  b.addEventListener('click', () => { const t = $('page-title'); t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); });
}

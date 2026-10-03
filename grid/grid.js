// The big dashboard window: page chrome around the shared agent views (dash/dash.js).
const stage = document.getElementById('stage');
const countEl = document.getElementById('count');
const zoomEl = document.getElementById('zoom');
const coldEl = document.getElementById('show-cold');
const followEl = document.getElementById('follow');
const firmEl = document.getElementById('firm');

const chip = (text, off, onClick, extra = {}) => {
  const b = document.createElement('button');
  b.className = `chip-t${off ? ' off' : ''}${extra.cls ? ` ${extra.cls}` : ''}`;
  b.textContent = text;
  if (extra.n !== undefined) { const n = document.createElement('span'); n.className = 'n'; n.textContent = extra.n; b.append(n); }
  if (extra.ring) b.style.setProperty('--ring', extra.ring);
  b.addEventListener('click', onClick);
  return b;
};
const segBtn = (label, on, onClick) => {
  const b = document.createElement('button');
  b.textContent = label; b.className = on ? 'on' : '';
  b.addEventListener('click', onClick);
  return b;
};
function renderSlices(sl) {
  if (!sl) return;
  $('sl-status').replaceChildren(...[['all', 'Everyone'], ['working', 'Working'], ['idle', 'Idle'], ['attention', 'Needs you']].map(([v, l]) => segBtn(l, sl.status === v, () => dash.setStatusSlice(v))));
  $('sl-group').replaceChildren(...[['agent', 'Agent'], ['project', 'Project']].map(([v, l]) => segBtn(l, sl.groupBy === v, () => dash.setGroupBy(v))));
  const chips = (id, list, token) => $(id).replaceChildren(...list.map((x) => chip(x.label, x.hidden, () => dash.toggleSlice(`${token}:${x.id}`))));
  chips('sl-types', sl.types, 'type');
  chips('sl-tools', sl.tools, 'tool');
  $('sl-projects').replaceChildren(...sl.projects.map((p) => chip(`${p.emoji} ${p.name}`, p.hidden, () => dash.toggleSlice(`project:${p.key}`), { n: p.count, ring: p.ring, cls: 'proj' })));
}
function $(id) { return document.getElementById(id); }

const dash = createDash({
  stage,
  storage: 'dash',
  onViewChange: ({ view, count, firm, firmAgents, slices }) => {
    countEl.textContent = count ? `(${count})` : '';
    for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.view === view);
    document.getElementById('zoom-wrap').style.display = view === 'grid' ? '' : 'none';
    document.getElementById('follow-wrap').style.display = view === 'speaker' ? '' : 'none';
    renderSlices(slices);
    if (firm && firm.available) { firmEl.textContent = `The Firm · ${firmAgents} agents`; firmEl.className = 'chip ok'; }
    else { firmEl.textContent = 'The Firm offline'; firmEl.className = 'chip'; }
  },
});

zoomEl.value = dash.state.zoom;
coldEl.checked = dash.state.cold;
followEl.checked = dash.state.follow;
zoomEl.addEventListener('input', () => dash.setOptions({ zoom: zoomEl.value }));
coldEl.addEventListener('change', () => dash.setOptions({ cold: coldEl.checked }));
followEl.addEventListener('change', () => dash.setOptions({ follow: followEl.checked }));
for (const b of document.querySelectorAll('#views button')) b.addEventListener('click', () => dash.setView(b.dataset.view));
document.getElementById('open-panel').addEventListener('click', () => window.gridBridge.openPanel());

const bumpZoom = (d) => { zoomEl.value = Math.min(420, Math.max(110, Number(zoomEl.value) + d)); dash.setOptions({ zoom: zoomEl.value }); };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'g') dash.setView('grid');
  else if (k === 's') dash.setView('speaker');
  else if (k === 'p') dash.setView('presenter');
  else if (k === '+' || k === '=') bumpZoom(20);
  else if (k === '-') bumpZoom(-20);
});
window.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || dash.getView() !== 'grid') return;
  e.preventDefault();
  bumpZoom(-Math.sign(e.deltaY) * 16);
}, { passive: false });

Tip.attach();
window.gridBridge.onSessions((data) => dash.update(data));
window.gridBridge.onView((v) => dash.setView(v));
window.gridBridge.ready();

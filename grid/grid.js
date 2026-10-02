// The big dashboard window: page chrome around the shared agent views (dash/dash.js).
const stage = document.getElementById('stage');
const countEl = document.getElementById('count');
const zoomEl = document.getElementById('zoom');
const coldEl = document.getElementById('show-cold');
const followEl = document.getElementById('follow');
const firmEl = document.getElementById('firm');

const dash = createDash({
  stage,
  storage: 'dash',
  onViewChange: ({ view, count, firm, firmAgents }) => {
    countEl.textContent = count ? `(${count})` : '';
    for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.view === view);
    document.getElementById('zoom-wrap').style.display = view === 'grid' ? '' : 'none';
    document.getElementById('follow-wrap').style.display = view === 'speaker' ? '' : 'none';
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

window.gridBridge.onSessions((data) => dash.update(data));
window.gridBridge.onView((v) => dash.setView(v));
window.gridBridge.ready();

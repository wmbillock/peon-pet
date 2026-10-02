// The Firm page: connection status and settings.
const firmStatus = $('firm-status');
const firmUrl = $('firm-url');
const firmOn = $('firm-on');
const firmRoles = $('firm-roles');

function renderFirm(f) {
  if (!f) return;
  if (document.activeElement !== firmUrl) firmUrl.value = f.url || '';
  firmOn.checked = !!f.enabled;
  if (!f.enabled) { firmStatus.textContent = 'off'; firmStatus.className = 'chip'; }
  else if (f.available) { firmStatus.textContent = `connected · ${f.total} agents`; firmStatus.className = 'chip ok'; }
  else { firmStatus.textContent = f.error ? `unreachable — ${f.error}` : 'connecting…'; firmStatus.className = 'chip bad'; }
  firmRoles.replaceChildren(...Object.entries(f.byRole || {}).map(([role, n]) =>
    h('span', { class: 'cardbtn', style: 'width:auto;padding:6px 12px' }, `${role} `, h('b', {}, String(n)))));
}

$('firm-save').addEventListener('click', async () => {
  try { showError(null); renderFirm(await window.dashBridge.setFirm({ enabled: firmOn.checked, url: firmUrl.value })); }
  catch (e) { showError(e); }
});
window.dashBridge.onFirmState(renderFirm);
window.dashBridge.getFirm().then(renderFirm);

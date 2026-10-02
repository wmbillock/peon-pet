// A single-agent window for the desktop army: the shared tile (art, plate, frame, status) for one root agent.
const id = new URLSearchParams(location.search).get('id');
const dash = createDash({ stage: document.getElementById('stage'), compact: true, only: id, storage: `army.${id}` });
dash.setView('grid');
Tip.attach();
window.armyBridge.onSessions((data) => dash.update(data));
window.armyBridge.ready();
document.addEventListener('dblclick', () => window.armyBridge.openGrid());

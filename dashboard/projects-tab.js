// Projects page: name, emoji, colour family, frame and background for each project.
const projList = $('proj-list');
const projUnused = $('proj-unused');
const EMOJI_CHOICES = ['🐾', '📚', '🎼', '🧾', '💲', '🌐', '🧪', '🗄️', '☁️', '🤖', '🛡️', '⚙️', '📱', '🎮', '🗺️', '🔧', '⚡', '🏛️', '📝', '🦊', '🌋', '🧬', '🔭', '🪄', '🍀', '🔥', '🌊', '🪐'];
let projState = { projects: [], frames: [], environs: [] };

const countFor = (key) => app.sessions.filter((a) => a.project && a.project.key === key).length;
const save = (key, patch) => window.dashBridge.updateProject(key, patch).then((st) => { projState = st; renderProjects(); }).catch((e) => { showError(e); refreshProjects(); });

function projectCard(p) {
  const n = countFor(p.key);
  const frame = (app.snap && app.snap.borders.find((b) => b.id === p.frame)) || null;
  const dyn = p.frame && p.frame.startsWith('dyn-') ? p.frame.slice(4) : null;
  const ring = `hsl(${p.hue} 75% 58%)`;

  const prev = h('div', { class: `projprev${dyn ? ` tile f-${dyn} hot` : ''}`, style: `--ring:${ring};--plate:hsl(${p.hue} 55% 42%)` },
    h('div', { class: 'em' }, p.emoji), h('div', { class: 'plate' }, p.name));
  if (frame && frame.thumb && !dyn && p.frame !== 'default') prev.append(h('img', { src: frame.thumb }));

  const name = h('input', { type: 'text', class: 'pname', value: p.name, maxlength: 40, onchange: () => save(p.key, { name: name.value }) });
  const emojiIn = h('input', { type: 'text', value: p.emoji, maxlength: 8, style: 'width:56px;text-align:center', title: 'Type or paste any emoji',
    onchange: () => save(p.key, { emoji: emojiIn.value }) });
  const emojis = h('div', { class: 'emojis' }, EMOJI_CHOICES.map((e) => h('button', { class: e === p.emoji ? 'on' : '', onclick: () => save(p.key, { emoji: e }) }, e)));
  const hue = h('input', { type: 'range', class: 'huebar', min: 0, max: 359, value: p.hue, style: `--ring:${ring}`,
    oninput: () => { prev.style.setProperty('--ring', `hsl(${hue.value} 75% 58%)`); prev.style.setProperty('--plate', `hsl(${hue.value} 55% 42%)`); },
    onchange: () => save(p.key, { hue: Number(hue.value) }) });
  const frameSel = h('select', { onchange: () => save(p.key, { frame: frameSel.value === 'default' ? null : frameSel.value }) },
    projState.frames.map((f) => h('option', { value: f.id, selected: (p.frame || 'default') === f.id }, `${f.label}${f.dynamic ? ' (live)' : ''}`)));
  const envSel = h('select', { title: 'Background for cutout pets', onchange: () => save(p.key, { env: envSel.value || null }) },
    h('option', { value: '', selected: !p.env }, "Pet's own"),
    projState.environs.map((e) => h('option', { value: e.id, selected: e.id === p.env }, e.display)));

  return h('section', { class: 'card projcard' }, prev,
    h('div', { class: 'projmain' },
      h('div', { class: 'line' }, name, emojiIn, h('span', { class: 'dim' }, n ? `${n} agent${n === 1 ? '' : 's'} now` : 'no agents now'),
        p.ephemeral ? null : h('span', { style: 'flex:1' }),
        n ? null : h('button', { class: 'danger', onclick: () => { if (confirm(`Forget "${p.name}"? It comes back (with new defaults) if its agents return.`)) window.dashBridge.forgetProject(p.key).then((st) => { projState = st; renderProjects(); }).catch(showError); } }, 'Forget')),
      emojis,
      h('div', { class: 'line' }, h('label', { class: 'inline' }, 'Color'), h('span', { class: 'hueswatch', style: `--ring:${ring}` }), hue),
      h('div', { class: 'line' }, h('label', { class: 'inline' }, 'Frame'), frameSel, h('label', { class: 'inline' }, 'Background'), envSel),
      h('div', { class: 'help', style: 'margin:0' }, p.key)));
}

const projAssign = $('proj-assign');
function renderAssign() {
  const agents = app.sessions.filter((a) => a.project && a.isRoot);
  const mine = projState.assignments || {};
  renderUnlessEditing(projAssign, () => projAssign.replaceChildren(...(agents.length ? agents.map((a) => {
    const sel = h('select', { onchange: () => window.dashBridge.assignProject(a.id, sel.value || null).then((st) => { projState = st; renderProjects(); }).catch((e) => { showError(e); refreshProjects(); }) },
      h('option', { value: '', selected: !mine[a.id] }, `Automatic (${a.project.name})`),
      projState.projects.map((p) => h('option', { value: p.key, selected: mine[a.id] === p.key }, `${p.emoji} ${p.name}`)));
    // Pin a kind of agent on this one (Agent Forge → Kinds of agent); automatic otherwise.
    const ts = typeof typesState !== 'undefined' && typesState;
    const pinned = ts ? ts.pins.sessions[a.id] : null;
    const typeSel = ts ? h('select', { title: 'Kind of agent', onchange: () => window.dashBridge.pinType('session', a.id, typeSel.value || null).then((st) => { typesState = st; renderProjects(); }).catch((e) => { showError(e); refreshProjects(); }) },
      h('option', { value: '', selected: !pinned }, a.pet && a.pet.type ? `Automatic (${a.pet.type.name})` : 'Automatic'),
      ts.types.map((t) => h('option', { value: t.slug, selected: pinned === t.slug }, `${t.name} · ${t.category}`))) : null;
    return h('div', { class: 'line' }, h('span', {}, a.name || a.id), sel, typeSel);
  }) : [h('div', { class: 'help' }, 'No agents running right now.')])));
}

function renderProjects() {
  renderAssign();
  const list = projState.projects
    .filter((p) => projUnused.checked || countFor(p.key) > 0)
    .sort((a, b) => countFor(b.key) - countFor(a.key) || a.name.localeCompare(b.name));
  renderUnlessEditing(projList, () => projList.replaceChildren(...(list.length ? list.map(projectCard)
    : [h('div', { class: 'help' }, 'No projects yet — they appear as agents show up.')])));
}

async function refreshProjects() {
  try { projState = await window.dashBridge.getProjects(); } catch (e) { showError(e); }
  renderProjects();
}
projUnused.addEventListener('change', renderProjects);
document.addEventListener('sessions', refreshProjects);   // new agents can create projects
onSnap(renderProjects);                                    // frame thumbnails arrive with the snapshot
refreshProjects();

// Shared agent views — Grid, Speaker, Presenter — over one pool of animated tiles.
// Used by the big dashboard window and by the small corner window (compact mode).
//
//   const dash = createDash({ stage, compact, storage: 'corner', onSize, onViewChange });
//   dash.update({ sessions, firm });   // from the main process
//   dash.setView('grid' | 'speaker' | 'presenter');
//
//   Grid       every agent, grouped: each root agent with its sub-agents, ringed in the root's tint.
//   Speaker    one agent large (follows whoever is working, or pinned) with a strip of the rest.
//   Presenter  one root agent large with its sub-agents beside it and the other roots below.
(function () {
  // Mirrors ANIM_CONFIG in lib/anim-state.js (6 frames each).
  const ANIMS = {
    sleeping: { row: 0, fps: 3 }, waking: { row: 1, fps: 4 }, typing: { row: 2, fps: 8 },
    alarmed: { row: 3, fps: 8 }, celebrate: { row: 4, fps: 8 }, annoyed: { row: 5, fps: 8 },
  };
  const REACTION_MS = 4500;      // how long a one-off reaction (celebrate, alarmed…) is shown
  const FOLLOW_DWELL_MS = 4000;  // speaker view won't jump faster than this
  const VIEWS = ['grid', 'speaker', 'presenter'];

  const assetUrl = (file, params) => `peon-asset://${file}/?${new URLSearchParams(params)}`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const label = (a) => a.title || a.name || a.id.replace(/^firm:/, '').slice(0, 10);
  const roleLabel = (a) => a.firmRole || (a.role === 'master' ? 'master' : a.role === 'worker' ? 'worker' : '');
  const ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
  };
  // The family colour: every agent of a project shares it (the sprite's own wash is a per-type shade).
  const ringOf = (a) => (a.mark ? a.mark.ring : '#4a4a66');
  const emojiOf = (a) => (a.project && a.project.emoji) || '';
  const frameKind = (a) => { const f = a.project && a.project.frame; return f && f.startsWith('dyn-') ? f.slice(4) : null; };
  const frameStatic = (a) => { const f = a.project && a.project.frame; return f && !f.startsWith('dyn-') && f !== 'default' ? f : null; };
  const stateWord = (a) => (a.hot ? 'working' : a.warm ? 'idle' : 'quiet');

  function animFor(a) {
    if (a.anim && a.anim !== 'typing' && a.anim !== 'waking' && Date.now() - a.animAt < REACTION_MS) return a.anim;
    return a.hot ? 'typing' : 'sleeping';
  }

  function createDash({ stage, compact = false, only = null, storage = 'dash', onSize = () => {}, onViewChange = () => {} }) {
    const load = (k, d) => { try { return localStorage.getItem(`${storage}.${k}`) ?? d; } catch { return d; } };
    const save = (k, v) => { try { localStorage.setItem(`${storage}.${k}`, v); } catch { /* ignore */ } };

    const S = {
      agents: [], firm: null,
      view: VIEWS.includes(load('view', 'grid')) ? load('view', 'grid') : 'grid',
      pinSpeaker: load('pinSpeaker', '') || null,
      pinPresenter: load('pinPresenter', '') || null,
      follow: load('follow', '1') === '1',
      cold: load('cold', '0') === '1',
      groupBy: load('groupBy', 'agent') === 'project' ? 'project' : 'agent',
      slices: { status: load('sliceStatus', 'all'), hidden: new Set(JSON.parse(load('sliceHidden', '[]'))) },
      zoom: Number(load('zoom', 200)),
      lastSwitch: 0, speakerId: null,
    };
    const tiles = new Map();   // agent id → tile record
    stage.classList.toggle('compact', compact);

    // ---- slices: toggle which agents are shown (by status, project, type, tool) --------------
    // `hidden` holds tokens: "project:<key>", "type:master|worker", "tool:claude|codex|firm".
    const typeOf = (a) => (a.isRoot !== false && a.role === 'master' ? 'master' : 'worker');
    const toolOf = (a) => (a.firm ? 'firm' : a.agent);
    const tokens = (a) => [`project:${a.project ? a.project.key : ''}`, `type:${typeOf(a)}`, `tool:${toolOf(a)}`];
    const sliceOk = (a) => {
      const st = S.slices.status, sum = window.AgentSummary;
      if (st === 'working' && !sum.isWorking(a)) return false;
      if (st === 'idle' && !sum.isIdle(a)) return false;
      if (st === 'active' && !(a.hot || a.warm)) return false;
      if (st === 'attention' && !sum.needsAttention(a, Date.now())) return false;
      return !tokens(a).some((t) => S.slices.hidden.has(t));
    };
    const baseVisible = (a) => S.cold || a.hot || a.warm || a.role === 'master';   // masters stay, dimmed when idle
    const visible = (a) => (only ? a.id === only : sliceOk(a) && (S.slices.status !== 'all' || baseVisible(a)));   // `only`: a one-agent window (desktop army)

    // ------------------------------------------------------------ tiles
    function makeTile(id) {
      const root = el('div', 'tile');
      const env = el('div', 'layer env'), sprite = el('div', 'layer sprite'), tint = el('div', 'layer tint');
      const led = el('div', 'led');
      const badges = el('div', 'badges'), roleB = el('span', 'badge role'), agentB = el('span', 'badge');
      badges.append(roleB, agentB);
      const pframe = el('div', 'layer pframe');
      const scene = el('div', 'scene');
      scene.append(env, sprite, tint, pframe, led, badges);
      const pet = el('div', 'pet'), what = el('div', 'what'), info = el('div', 'info');
      info.append(pet, what);
      root.append(scene, info);
      const t = { id, root, env, sprite, tint, pframe, roleB, agentB, pet, what, frame: 0, lastAt: 0, spriteKey: '', envKey: '', anim: 'sleeping', agent: null };
      root.addEventListener('click', (e) => { if (t.agent) onTileClick(t.agent, e.shiftKey); });
      return t;
    }

    function updateTile(t, a) {
      t.agent = a;
      const p = a.pet;
      t.root.classList.toggle('hot', !!a.hot);
      t.root.classList.toggle('warm', !!a.warm && !a.hot);
      t.root.classList.toggle('cold', !a.warm && !a.hot);
      t.root.style.setProperty('--ring', ringOf(a));
      t.root.style.setProperty('--plate', a.mark ? a.mark.plate : '#161622');
      // The project's frame: a static border image over the art, or a dynamic (animated) one.
      const dk = frameKind(a), sf = frameStatic(a);
      for (const c of [...t.root.classList]) if (c.startsWith('f-')) t.root.classList.remove(c);
      if (dk) t.root.classList.add(`f-${dk}`);
      const pf = sf ? `url(${assetUrl('borders.png', { border: sf })})` : 'none';
      if (t.pframeKey !== pf) { t.pframeKey = pf; t.pframe.style.backgroundImage = pf; }
      t.root.dataset.tip = `${label(a)}${a.firmRole ? ` · ${a.firmRole}` : ''}\n${p ? `${p.name} · ${p.speciesDisplay}\n` : ''}${stateWord(a)} · ${ago(a.lastActive)}\nClick: speaker · Shift-click: presenter`.trim();
      t.roleB.textContent = roleLabel(a);
      t.roleB.style.display = roleLabel(a) ? '' : 'none';
      t.agentB.textContent = a.agent;
      t.agentB.style.display = a.agent === 'claude' ? 'none' : '';
      if (p) {
        if (t.spriteKey !== p.species) { t.spriteKey = p.species; t.sprite.style.backgroundImage = `url(${assetUrl('sprite-atlas.png', { char: p.species })})`; }
        // A cutout pet stands on its project's environment (falling back to the species' own).
        const envId = (a.project && a.project.env) || p.env || '';
        const envKey = p.layout === 'cutout' ? `${p.species}|${envId}` : '';
        if (t.envKey !== envKey) { t.envKey = envKey; t.env.style.backgroundImage = envKey ? `url(${assetUrl('bg.png', { char: p.species, env: envId })})` : 'none'; }
        t.tint.style.background = p.tintCss;
      }
      // Roots show the pet's name; sub-agents show what they are, since they share their root's pet.
      if (a.isRoot !== false && p) {
        t.pet.replaceChildren(p.name, el('small', '', p.speciesDisplay));
        t.what.replaceChildren(el('b', '', label(a)), ` · ${stateWord(a)} · ${ago(a.lastActive)}`);
      } else {
        t.pet.replaceChildren(label(a));
        t.what.replaceChildren(el('b', '', roleLabel(a) || 'agent'), ` · ${stateWord(a)} · ${ago(a.lastActive)}`);
      }
      t.anim = animFor(a);
    }

    function setTileSize(t, cls) {
      t.root.classList.toggle('sub', cls === 'sub');
      t.root.classList.toggle('mini', cls === 'mini');
    }

    // ------------------------------------------------------------ selection
    function onTileClick(a, shift) {
      if (shift) { S.pinPresenter = a.rootId || a.id; save('pinPresenter', S.pinPresenter); setView('presenter'); }
      else { S.pinSpeaker = a.id; S.speakerId = a.id; save('pinSpeaker', S.pinSpeaker); setView('speaker'); }
    }

    function pickSpeaker(vis) {
      const byId = new Map(vis.map((a) => [a.id, a]));
      if (S.pinSpeaker && byId.has(S.pinSpeaker) && !S.follow) return byId.get(S.pinSpeaker);
      if (S.follow) {
        const hot = vis.filter((a) => a.hot).sort((x, y) => y.lastActive - x.lastActive);
        const cur = byId.get(S.speakerId);
        const cand = hot[0];
        const now = Date.now();
        if (!cur || (cand && cand.id !== cur.id && now - S.lastSwitch > FOLLOW_DWELL_MS && (!cur.hot || cand.lastActive > cur.lastActive + 2000))) {
          S.speakerId = (cand || vis[0] || {}).id || null;
          S.lastSwitch = now;
        }
        return byId.get(S.speakerId) || vis[0];
      }
      return byId.get(S.speakerId) || vis[0];
    }

    function pickPresenter(vis) {
      const roots = vis.filter((a) => a.isRoot !== false);
      return roots.find((a) => a.id === S.pinPresenter) || roots.find((a) => a.firmRole === 'management')
        || roots.find((a) => a.role === 'master') || roots[0];
    }

    // ------------------------------------------------------------ detail panel (full size only)
    function kv(rows) {
      const g = el('div', 'kv');
      for (const [k, v] of rows) if (v !== null && v !== undefined && v !== '') g.append(el('span', '', k), el('span', '', String(v)));
      return g;
    }

    function detailPanel(a) {
      const wrap = el('div', 'detail');
      wrap.style.setProperty('--ring', ringOf(a));
      const head = el('div', 'card');
      head.append(el('h3', '', a.isRoot !== false ? 'Agent' : 'Sub-agent'), el('div', 'big', label(a)));
      const f = a.firm;
      head.append(kv([
        ['Pet', a.pet ? `${a.pet.name} · ${a.pet.speciesDisplay}${a.pet.tint !== 'none' ? ` · ${a.pet.tint}` : ''}` : ''],
        ['Role', roleLabel(a)],
        ['Status', `${stateWord(a)} · ${ago(a.lastActive)} ago`],
        ['Agent', a.agent],
        ['Workstream', f && f.workstreamId],
        ['Project', f && f.projectId],
        ['Model', f && f.model],
        ['Folder', a.cwd],
        ['Session', a.id.startsWith('firm:') ? '' : a.id.slice(0, 8)],
      ]));
      wrap.append(head);
      if (f && (f.contextPct !== null || f.costUsd !== null)) {
        const m = el('div', 'card');
        m.append(el('h3', '', 'Context & cost'));
        if (f.contextPct !== null) {
          m.append(kv([['Context', `${Math.round(f.contextPct)}%`]]));
          const bar = el('div', 'bar'), fill = el('i');
          fill.style.width = `${Math.min(100, Math.max(0, f.contextPct))}%`;
          bar.append(fill);
          m.append(bar);
        }
        if (f.costUsd !== null) m.append(kv([['Cost', `$${f.costUsd.toFixed(2)}`]]));
        wrap.append(m);
      }
      if (f && f.lastMessage) {
        const m = el('div', 'card');
        m.append(el('h3', '', 'Latest'), el('div', 'msg', f.lastMessage));
        wrap.append(m);
      }
      return wrap;
    }

    // ------------------------------------------------------------ layouts
    function agentGroups(vis) {
      const ids = new Set(vis.map((a) => a.id));
      const rootOf = (a) => (a.isRoot !== false || !ids.has(a.rootId) ? a.id : a.rootId);
      const members = new Map();
      for (const a of vis) members.set(rootOf(a), [...(members.get(rootOf(a)) || []), a]);
      const out = [];
      for (const [rootId, list] of members) {
        const root = list.find((a) => a.id === rootId) || list[0];
        const g = el('div', 'group');
        g.style.setProperty('--ring', ringOf(root));
        const kids = list.filter((a) => a.id !== root.id);
        const title = el('div', 'group-title');
        // Emoji marks the group when groups are the unit; inside a project section it would repeat.
        title.append(S.groupBy === 'project' ? '' : `${emojiOf(root)} `, el('b', '', label(root)), kids.length ? ` · ${kids.length} sub-agent${kids.length === 1 ? '' : 's'}` : '');
        g.append(title);
        const rt = tiles.get(root.id); setTileSize(rt, 'full'); g.append(rt.root);
        if (kids.length) {
          const k = el('div', 'kids');
          for (const c of kids) { const ct = tiles.get(c.id); setTileSize(ct, 'sub'); k.append(ct.root); }
          g.append(k);
        }
        out.push({ root, el: g, count: list.length });
      }
      return out;
    }

    function layoutGrid(vis) {
      const groups = agentGroups(vis);
      const wrap = el('div', S.groupBy === 'project' ? 'projects' : 'groups');
      if (!compact) wrap.style.setProperty('--tile', `${S.zoom}px`);   // compact sizes come from the stylesheet
      if (S.groupBy !== 'project') { for (const g of groups) wrap.append(g.el); return wrap; }
      // Group by project: one section per project (its emoji and colour), holding its agent groups.
      const byProject = new Map();
      for (const g of groups) {
        const key = g.root.project ? g.root.project.key : '';
        byProject.set(key, [...(byProject.get(key) || []), g]);
      }
      for (const list of byProject.values()) {
        const p = list[0].root.project || {};
        const sec = el('section', 'proj');
        sec.style.setProperty('--ring', list[0].root.mark ? list[0].root.mark.ring : '#4a4a66');
        const n = list.reduce((s2, g) => s2 + g.count, 0);
        const head = el('div', 'proj-title');
        head.append(el('span', 'emoji', p.emoji || ''), el('b', '', p.name || 'Ungrouped'), el('span', 'dim', ` · ${n} agent${n === 1 ? '' : 's'}`));
        const body = el('div', 'groups');
        for (const g of list) body.append(g.el);
        sec.append(head, body);
        wrap.append(sec);
      }
      return wrap;
    }

    function heroLayout(main, strip, extraCol) {
      const split = el('div', 'stage-split');
      const hero = el('div', 'hero');
      const mt = tiles.get(main.id);
      setTileSize(mt, 'full');
      mt.root.classList.remove('pinned');
      const holder = el('div', 'main-tile');
      holder.append(mt.root);
      hero.append(holder);
      if (!compact) {
        const detail = detailPanel(main);
        if (extraCol) detail.append(extraCol);
        hero.append(detail);
      } else if (extraCol) {
        hero.classList.add('has-extra');
        hero.append(extraCol);
      }
      const sp = el('div', 'strip');
      for (const a of strip) {
        const t = tiles.get(a.id);
        setTileSize(t, 'mini');
        t.root.classList.toggle('pinned', a.id === main.id);
        sp.append(t.root);
      }
      split.append(hero, sp);
      return split;
    }

    function layoutSpeaker(vis) {
      const main = pickSpeaker(vis);
      return heroLayout(main, vis.filter((a) => a.id !== main.id));
    }

    function layoutPresenter(vis) {
      const main = pickPresenter(vis);
      const own = vis.filter((a) => a.rootId === main.id && a.id !== main.id);
      // Management's reports are the workstream leads, each with its own sub-agents.
      const leads = main.firmRole === 'management' ? vis.filter((a) => a.isRoot !== false && a.firmRole === 'lead') : [];
      const col = el('div', 'reports');
      const shown = new Set([main.id]);
      const addCard = (title, ring, members) => {
        const c = el('div', 'card');
        if (ring) c.style.borderLeft = `4px solid ${ring}`;
        c.append(el('h3', '', title));
        const k = el('div', 'kids-col');
        for (const x of members) { const t = tiles.get(x.id); setTileSize(t, 'sub'); k.append(t.root); shown.add(x.id); }
        c.append(k);
        col.append(c);
      };
      if (own.length) addCard(`Sub-agents (${own.length})`, null, own);
      for (const lead of leads) {
        const members = vis.filter((a) => a.rootId === lead.id && a.id !== lead.id);
        addCard(`${label(lead)} · ${members.length} sub-agent${members.length === 1 ? '' : 's'}`, ringOf(lead), [lead, ...members]);
      }
      return heroLayout(main, vis.filter((a) => !shown.has(a.id) && a.isRoot !== false), col.children.length ? col : null);
    }

    // ------------------------------------------------------------ render
    let renderQueued = false;
    function render() {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => { renderQueued = false; renderNow(); });
    }

    let lastSize = '';
    function renderNow() {
      const vis = S.agents.filter(visible);
      const ids = new Set(vis.map((a) => a.id));
      for (const [id, t] of tiles) if (!ids.has(id)) { t.root.remove(); tiles.delete(id); }
      for (const a of vis) {
        let t = tiles.get(a.id);
        if (!t) { t = makeTile(a.id); tiles.set(a.id, t); }
        updateTile(t, a);
      }
      if (!vis.length) {
        const e = el('div', 'dash-empty');
        e.append('No agents right now.', el('br'), el('small', '', 'Start a Claude Code or Codex session, or a Firm workstream.'));
        stage.replaceChildren(e);
      } else {
        const layout = S.view === 'speaker' ? layoutSpeaker : S.view === 'presenter' ? layoutPresenter : layoutGrid;
        stage.replaceChildren(layout(vis));
      }
      api.count = vis.length;
      // Report the content's own height (not the container's, which grows with the window); the width
      // of each compact view is chosen by the host, so resizing converges instead of chasing itself.
      if (compact && stage.firstElementChild) {
        const h = Math.ceil(stage.firstElementChild.getBoundingClientRect().height);
        const key = `${S.view}:${h}`;
        if (key !== lastSize) { lastSize = key; onSize({ view: S.view, h }); }
      }
      onViewChange({ view: S.view, count: vis.length, firm: S.firm, firmAgents: S.agents.filter((a) => a.firm).length, slices: api.sliceInfo() });
    }

    function setView(v) {
      if (!VIEWS.includes(v)) return;
      S.view = v;
      save('view', v);
      lastSize = '';
      render();
    }

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
    setInterval(render, 1500);   // keep "ago", reactions and follow-the-speaker fresh

    const api = {
      count: 0,
      state: S,
      update(data) { S.agents = data.sessions || []; S.firm = data.firm || null; render(); },
      setView,
      getView: () => S.view,
      setOptions(o) {
        if ('cold' in o) { S.cold = !!o.cold; save('cold', S.cold ? '1' : '0'); }
        if ('follow' in o) { S.follow = !!o.follow; save('follow', S.follow ? '1' : '0'); }
        if ('zoom' in o) { S.zoom = Number(o.zoom); save('zoom', S.zoom); }
        render();
      },
      render,

      // ---- slices & grouping ----
      sliceInfo() {
        const projects = new Map();
        for (const a of S.agents) {
          if (!a.project) continue;
          const p = projects.get(a.project.key) || { key: a.project.key, name: a.project.name, emoji: a.project.emoji, ring: a.mark ? a.mark.ring : '#4a4a66', count: 0 };
          p.count += 1;
          projects.set(a.project.key, p);
        }
        const hid = (t) => S.slices.hidden.has(t);
        return {
          status: S.slices.status, groupBy: S.groupBy,
          projects: [...projects.values()].map((p) => ({ ...p, hidden: hid(`project:${p.key}`) })),
          types: [['master', 'Masters'], ['worker', 'Sub-agents']].map(([id, label]) => ({ id, label, hidden: hid(`type:${id}`) })),
          tools: [['claude', 'Claude'], ['codex', 'Codex'], ['firm', 'The Firm']].map(([id, label]) => ({ id, label, hidden: hid(`tool:${id}`) })),
        };
      },
      toggleSlice(token) {
        if (S.slices.hidden.has(token)) S.slices.hidden.delete(token); else S.slices.hidden.add(token);
        save('sliceHidden', JSON.stringify([...S.slices.hidden]));
        render();
      },
      setStatusSlice(v) {
        if (!['all', 'active', 'working', 'idle', 'attention'].includes(v)) return;
        S.slices.status = v; save('sliceStatus', v); render();
      },
      setGroupBy(v) {
        S.groupBy = v === 'project' ? 'project' : 'agent'; save('groupBy', S.groupBy); lastSize = ''; render();
      },
      // Show only one project: everything else is hidden (clear with preset('all')).
      showOnlyProject(key) {
        const keys = new Set(S.agents.map((a) => a.project && a.project.key).filter(Boolean));
        S.slices.hidden = new Set([...keys].filter((k) => k !== key).map((k) => `project:${k}`));
        S.slices.status = 'all';
        save('sliceHidden', JSON.stringify([...S.slices.hidden])); save('sliceStatus', 'all');
        render();
      },
      // One-tap presets for the small window: everything, only what is working, or only masters.
      preset(name) {
        S.slices.hidden = new Set(name === 'masters' ? ['type:worker'] : []);
        S.slices.status = name === 'working' ? 'working' : 'all';
        save('sliceHidden', JSON.stringify([...S.slices.hidden])); save('sliceStatus', S.slices.status);
        render();
      },
      presetName() {
        const h = S.slices.hidden;
        if (S.slices.status === 'working' && !h.size) return 'working';
        if (S.slices.status === 'all' && h.size === 1 && h.has('type:worker')) return 'masters';
        return S.slices.status === 'all' && !h.size ? 'all' : 'custom';
      },
    };
    return api;
  }

  window.createDash = createDash;
})();

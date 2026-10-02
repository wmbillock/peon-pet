'use strict';
// Projects: what a group of agents is *working on*. Each gets a stable emoji and colour so agents on
// the same project read as a family — applied to the name plate, not as a filter over the art
// (the art's filter is for agent *type*).
const fs = require('fs');
const path = require('path');
const { wsFromCwd } = require('./agent-graph');

// First match wins. Words that commonly appear in project / repo names.
const EMOJI_RULES = [
  [/firm|forge|foundry/, '🏛️'], [/pet|peon/, '🐾'], [/libretto|knowledge|notes|wiki|docs?|writing/, '📚'],
  [/euphonia|music|audio|sound|song|band/, '🎼'], [/itacs|compliance|audit|legal/, '🧾'],
  [/pricing|price|fee|apr|loan|money|financ|billing|cost/, '💲'], [/web|ui|frontend|react|design|css/, '🌐'],
  [/test|qa|spec/, '🧪'], [/data|lake|snowflake|warehouse|sql|analytics|dbt/, '🗄️'],
  [/infra|deploy|k8s|cloud|aws|ops|platform/, '☁️'], [/\bml\b|model|\bai\b|llm|agent/, '🤖'],
  [/sec|auth|crypto|risk|fraud/, '🛡️'], [/api|backend|service|server/, '⚙️'], [/mobile|ios|android/, '📱'],
  [/game|play/, '🎮'], [/plan|roadmap|strategy/, '🗺️'], [/bug|fix|incident|oncall/, '🔧'], [/perf|speed|fast/, '⚡'],
];
const FALLBACK_EMOJI = ['🔷', '🟣', '🟢', '🟠', '🔶', '⭐', '🌙', '🍀', '🔥', '🌊', '🪐', '🧩', '🎯', '🧭', '🪴', '🍋', '🫐', '🌸', '🪁', '🧿'];
// Twelve well-separated hues (degrees); new projects take the first unused one.
const HUES = [4, 28, 48, 84, 140, 170, 195, 215, 250, 280, 315, 340];
// Lightness by role: shades within a project's hue tell agent types apart (lead brightest, critique darkest).
const ROLE_LIGHTNESS = { management: 42, lead: 42, worker: 33, inspector: 27, scout: 30, plan: 48, critique: 23, review: 37 };

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };

function suggestEmoji(name, key = name) {
  const n = String(name || '').toLowerCase();
  for (const [re, emoji] of EMOJI_RULES) if (re.test(n)) return emoji;
  return FALLBACK_EMOJI[hash(key) % FALLBACK_EMOJI.length];
}

// CSS colours for an agent of `role` on a project of `hue`.
function projectColors(hue, role) {
  const L = ROLE_LIGHTNESS[role] ?? 38;
  return { hue, plate: `hsl(${hue} 55% ${L}%)`, ring: `hsl(${hue} 75% 58%)`, swatch: `hsl(${hue} 70% 50%)`, text: '#fff' };
}

const baseName = (p) => path.basename(String(p || '').replace(/\/+$/, ''));

// Which project does this agent belong to?  → { key, name }
function projectKeyOf(row, projectTitles = {}) {
  const f = row.firm;
  if (f && f.role === 'management') return { key: 'firm:management', name: 'The Firm' };
  if (f && f.projectId) return { key: `firm:${f.projectId}`, name: projectTitles[f.projectId] || f.projectId };
  const ws = wsFromCwd(row.cwd);
  if (ws) return { key: `ws:${ws}`, name: `Workstream ${ws.slice(3)}` };
  // A session you named yourself *is* your name for the project (Euphonia, libretto…), even when several share a folder.
  if (row.titleKind === 'custom' && row.title) return { key: `title:${row.title.toLowerCase()}`, name: row.title };
  if (row.cwd) return { key: `cwd:${row.cwd}`, name: baseName(row.cwd) || row.name || 'project' };
  return { key: `session:${row.id}`, name: row.title || row.name || 'session' };
}

const cleanEmoji = (e) => {
  const s = String(e ?? '').trim();
  if (!s || s.length > 10) throw new Error('Pick a single emoji');
  if (/^[\x20-\x7e]+$/.test(s) && s.length > 2) throw new Error('Pick a single emoji');
  return s;
};

function createProjectStore({ file }) {
  let data = null;
  const load = () => {
    if (data) return data;
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); data = d && typeof d.projects === 'object' && d.projects ? d : { version: 1, projects: {} }; }
    catch { data = { version: 1, projects: {} }; }
    return data;
  };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  const own = (o, k) => Object.hasOwn(o, k);

  const store = {
    // Look a project up, creating it (with an emoji from its name and the next free hue) on first sight.
    resolve(key, suggestedName) {
      const d = load();
      let p = own(d.projects, key) ? d.projects[key] : null;
      let dirty = false;
      if (!p) {
        const used = new Set(Object.values(d.projects).map((x) => x.hue));
        const hue = HUES.find((h) => !used.has(h)) ?? HUES[hash(key) % HUES.length];
        const name = suggestedName || key;
        p = { name, emoji: suggestEmoji(name, key), hue, frame: null, env: null, autoName: true, autoEmoji: true };
        d.projects[key] = p;
        dirty = true;
      } else if (p.autoName && suggestedName && suggestedName !== p.name) {
        // A better name arrived later (e.g. The Firm's project title): follow it until the user edits.
        p.name = suggestedName;
        if (p.autoEmoji) p.emoji = suggestEmoji(p.name, key);
        dirty = true;
      }
      if (dirty) save();
      return { key, frame: null, env: null, ...p };
    },
    list() { return Object.entries(load().projects).map(([key, p]) => ({ key, frame: null, env: null, ...p })); },
    update(key, patch) {
      const d = load();
      if (!own(d.projects, key)) throw new Error('Unknown project');
      const p = d.projects[key];
      if ('name' in patch) {
        const n = String(patch.name ?? '').trim().slice(0, 40);
        if (!n) throw new Error('Name cannot be empty');
        p.name = n; p.autoName = false;
        if (p.autoEmoji) p.emoji = suggestEmoji(n, key);
      }
      if ('emoji' in patch) { p.emoji = cleanEmoji(patch.emoji); p.autoEmoji = false; }
      // frame / env: an id from the frames or environments catalog, or null for "the default".
      for (const k of ['frame', 'env']) {
        if (!(k in patch)) continue;
        const v = patch[k];
        if (v !== null && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(v))) throw new Error(`Invalid ${k}`);
        p[k] = v === null ? null : String(v);
      }
      if ('hue' in patch) {
        const h = Number(patch.hue);
        if (!Number.isFinite(h) || h < 0 || h > 359) throw new Error('Hue must be 0-359');
        p.hue = Math.round(h);
      }
      save();
      return { key, ...p };
    },
    forget(key) { const d = load(); if (own(d.projects, key)) { delete d.projects[key]; save(); } },
  };
  return store;
}

module.exports = { createProjectStore, projectKeyOf, projectColors, suggestEmoji, EMOJI_RULES, HUES, ROLE_LIGHTNESS };

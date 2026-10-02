'use strict';
// Projects: what a group of agents is *working on*. Each gets a stable emoji and colour so agents on
// the same project read as a family — applied to the name plate, not as a filter over the art
// (the art's filter is for agent *type*).
const fs = require('fs');
const path = require('path');
const { wsFromCwd } = require('./agent-graph');

// First match wins. Words that commonly appear in project / repo names.
// First match wins. A term matches only at the start of a word, so "display" is not "play" and "carpet" is not "pet".
const word = (terms) => new RegExp(`(^|[^a-z0-9])(?:${terms})`);
const EMOJI_RULES = [
  [word('firm|forge|foundry'), '🏛️'], [word('pet\\b|peon'), '🐾'], [word('libretto|knowledge|notes|wiki|docs?\\b|writing'), '📚'],
  [word('euphonia|music|audio|sound|song|band'), '🎼'], [word('itacs|compliance|audit|legal'), '🧾'],
  [word('pricing|price|fee\\b|apr\\b|loan|money|financ|billing|cost'), '💲'], [word('web|ui\\b|frontend|react|design|css'), '🌐'],
  [word('test|qa\\b|spec\\b'), '🧪'], [word('data|lake|snowflake|warehouse|sql|analytics|dbt'), '🗄️'],
  [word('infra|deploy|k8s|cloud|aws|ops\\b|platform'), '☁️'], [word('ml\\b|model|ai\\b|llm|agent'), '🤖'],
  [word('sec\\b|security|auth|crypto|risk|fraud'), '🛡️'], [word('api\\b|backend|service|server'), '⚙️'], [word('mobile|ios\\b|android'), '📱'],
  [word('markdown|editor|text|render'), '📝'], [word('game|play\\b'), '🎮'], [word('plan|roadmap|strategy'), '🗺️'], [word('bug|fix|incident|oncall'), '🔧'], [word('perf|speed|fast'), '⚡'],
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

// Apply externally supplied values to the fields the user has not edited. Returns true if anything changed.
function applySeed(p, seed) {
  let changed = false;
  for (const [field, flag] of [['emoji', 'autoEmoji'], ['hue', 'autoHue'], ['frame', 'autoFrame'], ['env', 'autoEnv']]) {
    const v = seed[field];
    if (v === undefined || v === null || p[flag] === false || p[field] === v) continue;
    p[field] = v;
    if (field === 'emoji') p.emojiSeeded = true;
    changed = true;
  }
  return changed;
}

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

  // A project that is shown but not remembered: for agents we can't place yet (no folder or name).
  const ephemeral = (key, suggestedName) => {
    const name = suggestedName || key;
    return { key, name, emoji: suggestEmoji(name, key), hue: HUES[hash(key) % HUES.length], frame: null, env: null, autoName: true, autoEmoji: true, ephemeral: true };
  };

  const store = {
    // Like resolve, but never creates: unknown keys come back as an unsaved, stable-looking project.
    peek(key, suggestedName) {
      const d = load();
      return own(d.projects, key) ? { key, frame: null, env: null, ...d.projects[key] } : ephemeral(key, suggestedName);
    },
    // Look a project up, creating it (with an emoji from its name and the next free hue) on first sight.
    // `seed` carries values supplied from outside (The Firm): { emoji, hue, frame, env }. They set a new
    // project's starting look, and keep updating any field you have not edited yourself.
    resolve(key, suggestedName, seed = {}) {
      if (String(key).startsWith('session:')) return ephemeral(key, suggestedName);   // never persist a bare session
      const d = load();
      let p = own(d.projects, key) ? d.projects[key] : null;
      let dirty = false;
      if (!p) {
        const used = new Set(Object.values(d.projects).map((x) => x.hue));
        const hue = seed.hue ?? HUES.find((h) => !used.has(h)) ?? HUES[hash(key) % HUES.length];
        const name = suggestedName || key;
        p = { name, emoji: seed.emoji || suggestEmoji(name, key), hue, frame: seed.frame ?? null, env: seed.env ?? null,
          // auto* = "you have not edited this" (so The Firm may still update it); emojiSeeded = it came from outside, not from the name rules
          autoName: true, autoEmoji: true, emojiSeeded: !!seed.emoji, autoHue: true, autoFrame: true, autoEnv: true };
        d.projects[key] = p;
        dirty = true;
      } else {
        if (p.autoName && suggestedName && suggestedName !== p.name) {
          // A better name arrived later (e.g. The Firm's project title): follow it until the user edits.
          p.name = suggestedName;
          if (p.autoEmoji && !p.emojiSeeded) p.emoji = suggestEmoji(p.name, key);
          dirty = true;
        }
        if (applySeed(p, seed)) dirty = true;
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
        if (p.autoEmoji && !p.emojiSeeded) p.emoji = suggestEmoji(n, key);
      }
      if ('emoji' in patch) { p.emoji = cleanEmoji(patch.emoji); p.autoEmoji = false; }
      // frame / env: an id from the frames or environments catalog, or null for "the default".
      for (const k of ['frame', 'env']) {
        if (!(k in patch)) continue;
        const v = patch[k];
        if (v !== null && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(v))) throw new Error(`Invalid ${k}`);
        p[k] = v === null ? null : String(v);
        p[k === 'frame' ? 'autoFrame' : 'autoEnv'] = false;
      }
      if ('hue' in patch) {
        const h = Number(patch.hue);
        if (!Number.isFinite(h) || h < 0 || h > 359) throw new Error('Hue must be 0-359');
        p.hue = Math.round(h);
        p.autoHue = false;
      }
      save();
      return { key, ...p };
    },
    forget(key) {
      const d = load();
      if (!own(d.projects, key)) return;
      delete d.projects[key];
      for (const [id, k] of Object.entries(d.assignments || {})) if (k === key) delete d.assignments[id];
      save();
    },
    // "This session belongs to project X": id → project key, overriding where the agent would otherwise be placed.
    assignments() { return { ...(load().assignments || {}) }; },
    assign(id, key) {
      const d = load();
      if (key !== null && !own(d.projects, key)) throw new Error('Unknown project');
      d.assignments = d.assignments || {};
      if (key === null) delete d.assignments[id]; else d.assignments[id] = key;
      save();
    },
  };
  return store;
}

module.exports = { createProjectStore, projectKeyOf, projectColors, suggestEmoji, EMOJI_RULES, HUES, ROLE_LIGHTNESS };

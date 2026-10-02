const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isTint } = require('./tints');
const { suggestName } = require('./names');
const { cleanFacts } = require('./species');

const MAX_PETS = 64;
const ASSIGN_TYPES = new Set(['session', 'project', 'agent']);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// null = auto (eligible for automatic assignment); {type:'bench'} = never auto-assigned;
// {type:'session'|'project'|'agent', value} = pinned.
function cleanAssignment(a) {
  if (a === null || a === undefined) return null;
  if (typeof a !== 'object') throw new Error('Invalid assignment');
  if (a.type === 'bench') return { type: 'bench' };
  if (!ASSIGN_TYPES.has(a.type)) throw new Error(`Unknown assignment type: ${a.type}`);
  const value = String(a.value ?? '').trim().slice(0, 300);
  if (!value) throw new Error('Assignment needs a value');
  return { type: a.type, value };
}

/**
 * The roster: individual pets. Each has its own id, name, species (the art), tint, optional
 * environment override, durable facts, and an assignment. `isSpecies(slug)` / `isEnv(id)` let the
 * caller validate references against whatever is currently installed.
 */
function createRoster({ file, isSpecies, isEnv = () => true }) {
  const load = () => {
    const d = readJson(file, null);
    if (!d || !Array.isArray(d.pets)) return { version: 1, lead: null, pets: [] };
    return { version: 1, lead: d.lead || null, pets: d.pets };
  };
  const save = (state) => {
    if (!state.pets.some((p) => p.id === state.lead)) state.lead = state.pets[0] ? state.pets[0].id : null;
    writeJsonAtomic(file, state);
    return state;
  };

  function validate(input, state, current = null) {
    const out = {};
    if ('name' in input || !current) {
      const raw = 'name' in input ? String(input.name ?? '').trim().slice(0, 32) : '';
      out.name = raw || suggestName(state.pets.filter((p) => p !== current).map((p) => p.name));
    }
    if ('species' in input || !current) {
      if (!isSpecies(input.species)) throw new Error(`Unknown species: ${input.species}`);
      out.species = input.species;
    }
    if ('tint' in input) {
      if (!isTint(input.tint)) throw new Error(`Unknown tint: ${input.tint}`);
      out.tint = input.tint;
    } else if (!current) out.tint = 'none';
    if ('env' in input) {
      if (input.env !== null && !isEnv(input.env)) throw new Error(`Unknown environment: ${input.env}`);
      out.env = input.env;
    } else if (!current) out.env = null;
    if ('facts' in input) out.facts = cleanFacts(input.facts);
    else if (!current) out.facts = [];
    if ('assignment' in input) out.assignment = cleanAssignment(input.assignment);
    else if (!current) out.assignment = null;
    return out;
  }

  const api = {
    state: load,
    list: () => load().pets,
    lead: () => { const s = load(); return s.pets.find((p) => p.id === s.lead) || s.pets[0] || null; },
    get: (id) => load().pets.find((p) => p.id === id) || null,

    create(input = {}) {
      const s = load();
      if (s.pets.length >= MAX_PETS) throw new Error(`The roster is full (${MAX_PETS} pets)`);
      const pet = { id: `pet_${crypto.randomBytes(4).toString('hex')}`, createdAt: Date.now(), ...validate(input, s) };
      s.pets.push(pet);
      save(s);
      return pet;
    },

    update(id, patch) {
      const s = load();
      const pet = s.pets.find((p) => p.id === id);
      if (!pet) throw new Error('Unknown pet');
      Object.assign(pet, validate(patch, s, pet));
      save(s);
      return pet;
    },

    remove(id) {
      const s = load();
      if (!s.pets.some((p) => p.id === id)) throw new Error('Unknown pet');
      if (s.pets.length === 1) throw new Error('Keep at least one pet');
      s.pets = s.pets.filter((p) => p.id !== id);
      save(s);
    },

    setLead(id) {
      const s = load();
      if (!s.pets.some((p) => p.id === id)) throw new Error('Unknown pet');
      s.lead = id;
      save(s);
    },

    // First run: make sure there is at least one pet.
    ensureSeed(species) {
      const s = load();
      if (s.pets.length) return s.pets[0];
      return api.create({ species });
    },

    // Free species/env references when art is removed: repoint pets at a fallback species.
    repointSpecies(from, to) {
      const s = load();
      let n = 0;
      for (const p of s.pets) if (p.species === from) { p.species = to; n++; }
      if (n) save(s);
      return n;
    },
  };
  return api;
}

module.exports = { createRoster, cleanAssignment, MAX_PETS };

'use strict';
// Permissions for agent types: what a kind of agent may do, what is out of its role, and who to hand that work to.
// Deterministic, least-privilege and data-only, so The Firm (or anything else) can evaluate it at instantiation.
//
//   category (Firm role)  →  a base policy: the actions the role may take, and for every action it may NOT take,
//                            the role that does it ("delegate to").
//   agent type            →  may only NARROW its category's policy (inherited authority); a tool or a clever prompt
//                            never widens it. Extra denials are its negative scope.
//   check(type, action)   →  allow | delegate (out of role; here is who does it) | deny (nobody in this role may).
//
// Implementation and review stay separate: producers change things, verifiers judge them, and neither does the
// other's job, even when they share the same pet or personality.

const ACTIONS = [
  'read', 'search', 'plan', 'write-notes', 'edit-code', 'write-tests', 'run-tests', 'review',
  'comment', 'approve', 'accept-work', 'send-back', 'spawn-agent', 'message-human', 'merge', 'deploy',
];

// Who does an action when the current role must not. 'human' means a person decides.
const OWNER = {
  'edit-code': 'worker', 'write-tests': 'worker', 'run-tests': 'inspector', review: 'review', plan: 'plan',
  approve: 'human', 'accept-work': 'lead', 'send-back': 'lead', 'spawn-agent': 'lead', 'message-human': 'management',
  merge: 'human', deploy: 'human', comment: 'review', 'write-notes': 'scout',
};

const READ = ['read', 'search'];
const ROLE_POLICY = {
  management: { allow: [...READ, 'plan', 'spawn-agent', 'message-human'] },
  lead: { allow: [...READ, 'plan', 'spawn-agent', 'accept-work', 'send-back', 'message-human'] },
  worker: { allow: [...READ, 'edit-code', 'write-tests', 'run-tests', 'write-notes'] },
  inspector: { allow: [...READ, 'run-tests', 'review', 'comment'] },
  scout: { allow: [...READ, 'write-notes'] },
  plan: { allow: [...READ, 'plan', 'write-notes'] },
  critique: { allow: [...READ, 'review', 'comment'] },
  review: { allow: [...READ, 'review', 'comment', 'send-back'] },
};

const isAction = (a) => ACTIONS.includes(a);

// The actions a type may take: its category's grant, minus anything it narrows away.
// type: { category, allow?: [actions] (a subset to keep), deny?: [actions] (extra negative scope) }
function effective(type) {
  const base = (ROLE_POLICY[type.category] || { allow: [] }).allow;
  const keep = Array.isArray(type.allow) && type.allow.length ? new Set(type.allow) : null;
  const denied = new Set(type.deny || []);
  return new Set(base.filter((a) => (!keep || keep.has(a)) && !denied.has(a)));
}

// → { decision: 'allow' | 'delegate' | 'deny', action, reason, route? }
function check(type, action) {
  if (!isAction(action)) return { decision: 'deny', action, reason: `"${action}" is not a known action` };
  if (effective(type).has(action)) return { decision: 'allow', action, reason: `${type.category} may ${action}` };
  const route = OWNER[action];
  const inBase = (ROLE_POLICY[type.category] || { allow: [] }).allow.includes(action);
  const why = inBase ? `${type.name || type.slug} has ${action} outside its scope` : `${action} is outside the ${type.category} role`;
  if (route && route !== type.category) return { decision: 'delegate', action, reason: why, route };
  return { decision: 'deny', action, reason: why };
}

// Validate a type's permission fields: it may only narrow its category.
function cleanPermissions({ category, allow, deny }) {
  const base = new Set((ROLE_POLICY[category] || { allow: [] }).allow);
  const list = (v, label) => {
    const out = [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
    for (const a of out) if (!isAction(a)) throw new Error(`Unknown action in ${label}: ${a}`);
    return out;
  };
  const a = list(allow, 'allow'), d = list(deny, 'deny');
  for (const x of a) if (!base.has(x)) throw new Error(`A ${category} cannot be given "${x}": a type may only narrow its role`);
  return { allow: a, deny: d };
}

// Execution bounds: how much a type does itself before it must hand off or stop. Any field may be null (no limit).
//   directLoc  – lines of change it will write itself; above that it coordinates instead of doing
//   maxAgents  – sub-agents it may have running at once
//   timeoutMin – minutes before it must report or escalate
const BOUND_FIELDS = ['directLoc', 'maxAgents', 'timeoutMin'];
function cleanBounds(b = {}) {
  const out = {};
  for (const f of BOUND_FIELDS) {
    const v = b && b[f];
    if (v === null || v === undefined || v === '') { out[f] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error(`${f} must be a whole number from 1 to 100000, or blank for no limit`);
    out[f] = n;
  }
  return out;
}
// usage: { loc, agents, minutes } → { ok, exceeded: [field] }
function withinBounds(bounds, usage = {}) {
  const map = { directLoc: usage.loc, maxAgents: usage.agents, timeoutMin: usage.minutes };
  const exceeded = BOUND_FIELDS.filter((f) => bounds && bounds[f] != null && map[f] != null && map[f] > bounds[f]);
  return { ok: exceeded.length === 0, exceeded };
}

module.exports = { cleanBounds, withinBounds, BOUND_FIELDS, ACTIONS, OWNER, ROLE_POLICY, effective, check, cleanPermissions };

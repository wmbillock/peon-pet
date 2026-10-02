const { ACTIONS, ROLE_POLICY, effective, check, cleanPermissions } = require('../lib/permissions');
const { cleanType } = require('../lib/agent-types');

const T = (category, extra = {}) => ({ slug: 't', name: 'T', category, ...extra });

test('every role policy uses known actions and every ownerless action is covered', () => {
  for (const [role, p] of Object.entries(ROLE_POLICY)) for (const a of p.allow) expect({ role, a, known: ACTIONS.includes(a) }).toEqual({ role, a, known: true });
});

test('implementation and review stay separate', () => {
  expect(check(T('worker'), 'edit-code').decision).toBe('allow');
  expect(check(T('worker'), 'review')).toMatchObject({ decision: 'delegate', route: 'review' });
  expect(check(T('review'), 'edit-code')).toMatchObject({ decision: 'delegate', route: 'worker' });
  expect(check(T('inspector'), 'edit-code')).toMatchObject({ decision: 'delegate', route: 'worker' });
});

test('merging, deploying and approving belong to a person for every role', () => {
  for (const role of Object.keys(ROLE_POLICY)) for (const a of ['merge', 'deploy', 'approve']) expect(check(T(role), a)).toMatchObject({ decision: 'delegate', route: 'human' });
});

test('a type can narrow its role but never widen it', () => {
  const narrow = T('worker', { deny: ['write-tests'] });
  expect(effective(narrow).has('write-tests')).toBe(false);
  expect(check(narrow, 'write-tests')).toMatchObject({ decision: 'deny' });   // nobody else in the worker role owns it, so it is denied, not routed
  expect(effective(T('worker', { allow: ['read', 'edit-code'] }))).toEqual(new Set(['read', 'edit-code']));
  expect(() => cleanPermissions({ category: 'worker', allow: ['review'] })).toThrow(/only narrow/);
  expect(() => cleanPermissions({ category: 'worker', deny: ['fly'] })).toThrow(/Unknown action/);
});

test('unknown actions are denied', () => {
  expect(check(T('worker'), 'delete-prod')).toMatchObject({ decision: 'deny' });
});

test('cleanType carries validated permissions', () => {
  const t = cleanType({ slug: 'a', name: 'A', category: 'inspector', species: 'orc', deny: 'comment' });
  expect(t).toMatchObject({ allow: [], deny: ['comment'] });
  expect(() => cleanType({ slug: 'a', name: 'A', category: 'inspector', species: 'orc', allow: ['edit-code'] })).toThrow(/only narrow/);
});

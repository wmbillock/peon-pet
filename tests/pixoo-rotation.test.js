const { selectRotation, rotateStep, effectiveIntervalSec } = require('../lib/pixoo-rotation');

const NOW = 1_000_000;
const ag = (id, o = {}) => ({ id, isRoot: true, hot: false, warm: true, lastActive: 1, anim: null, animAt: 0, ...o });
const lead = { id: 'euphonia' };

test('order: lead first, then attention, then working, then idle by recency', () => {
  const list = selectRotation({ lead, now: NOW, agents: [
    ag('idle-old', { lastActive: 1 }), ag('working', { hot: true, lastActive: 5 }), ag('idle-new', { lastActive: 9 }),
    ag('alarmed', { anim: 'alarmed', animAt: NOW - 1000, hot: false }),
  ] });
  expect(list).toEqual(['euphonia', 'alarmed', 'working', 'idle-new', 'idle-old']);
});

test('attention expires after two minutes; sub-agents and dead sessions never rotate', () => {
  const list = selectRotation({ lead, now: NOW, agents: [
    ag('stale-alarm', { anim: 'alarmed', animAt: NOW - 200000, warm: false, hot: false }),
    ag('child', { isRoot: false, hot: true }), ag('gone', { warm: false }), ag('ok', { hot: true }),
  ] });
  expect(list).toEqual(['euphonia', 'ok']);
});

test('cap counts the lead and always leaves her one slot', () => {
  const agents = Array.from({ length: 10 }, (_, i) => ag(`a${i}`, { hot: true, lastActive: i }));
  expect(selectRotation({ lead, agents, cap: 4, now: NOW })).toHaveLength(4);
  expect(selectRotation({ lead, agents, cap: 1, now: NOW })).toEqual(['euphonia']);
  expect(selectRotation({ lead, agents, cap: 0, now: NOW })).toEqual(['euphonia']);
  expect(selectRotation({ lead, agents, now: NOW })).toHaveLength(6);   // default cap
});

test('only the lead: it stays on screen forever', () => {
  const list = selectRotation({ lead, agents: [], now: NOW });
  expect(list).toEqual(['euphonia']);
  let st = rotateStep({ list, now: NOW });
  expect(st.showing).toBe('euphonia');
  st = rotateStep({ list, state: st, now: NOW + 10 * 3600e3 });
  expect(st.showing).toBe('euphonia');
});

test('rotation advances only after the interval and wraps around', () => {
  const list = ['euphonia', 'a', 'b'];
  let st = rotateStep({ list, now: NOW, intervalSec: 60 });
  expect(st.showing).toBe('euphonia');
  st = rotateStep({ list, state: st, now: NOW + 59_000, intervalSec: 60 });
  expect(st.showing).toBe('euphonia');
  st = rotateStep({ list, state: st, now: NOW + 60_000, intervalSec: 60 });
  expect(st.showing).toBe('a');
  st = rotateStep({ list, state: st, now: NOW + 120_000, intervalSec: 60 });
  st = rotateStep({ list, state: st, now: NOW + 180_000, intervalSec: 60 });
  expect(st.showing).toBe('euphonia');
});

test('a pin holds one agent and wins over rotation; an unknown pin is ignored', () => {
  const list = ['euphonia', 'a', 'b'];
  let st = rotateStep({ list, now: NOW, pin: 'b' });
  expect(st.showing).toBe('b');
  st = rotateStep({ list, state: st, now: NOW + 9e6, pin: 'b' });
  expect(st.showing).toBe('b');
  st = rotateStep({ list, state: st, now: NOW + 9e6, pin: 'euphonia' });   // Euphonia can be pinned too
  expect(st.showing).toBe('euphonia');
  st = rotateStep({ list, state: { showing: 'a', switchedAt: NOW, index: 1 }, now: NOW + 1000, pin: 'ghost' });
  expect(st.showing).toBe('a');
});

test('interval floor: never shorter than the Pixoo update limit or ten seconds', () => {
  expect(effectiveIntervalSec({ rotateSeconds: 5, minIntervalSec: 0 })).toBe(10);
  expect(effectiveIntervalSec({ rotateSeconds: 30, minIntervalSec: 120 })).toBe(120);
  expect(effectiveIntervalSec({ rotateSeconds: 90, minIntervalSec: 60 })).toBe(90);
  expect(effectiveIntervalSec({})).toBe(60);
  expect(effectiveIntervalSec({ rotateSeconds: 'x', minIntervalSec: 'y' })).toBe(60);
});

test('the agent on screen disappearing mid-cycle: the next one takes its slot at once', () => {
  let st = { showing: 'a', switchedAt: NOW, index: 1 };
  st = rotateStep({ list: ['euphonia', 'b', 'c'], state: st, now: NOW + 1000, intervalSec: 60 });
  expect(st.showing).toBe('b');
  expect(st.index).toBe(1);
  st = { showing: 'c', switchedAt: NOW, index: 2 };
  st = rotateStep({ list: ['euphonia', 'b'], state: st, now: NOW + 1000 });   // last slot gone: clamp to the end
  expect(st.showing).toBe('b');
  st = rotateStep({ list: [], state: st, now: NOW });
  expect(st.showing).toBeNull();
});

test('voice follows the rotation: the showing agent is the voice-focus input', () => {
  const { resolveVoiceFocus } = require('../lib/voice-focus');
  const list = ['euphonia', 'a'];
  let st = rotateStep({ list, now: NOW });
  const focus = () => resolveVoiceFocus({ pixooConnected: true, pixooShowing: st.showing, cornerView: 'pet', leadId: 'euphonia' }).agentId;
  expect(focus()).toBe('euphonia');
  st = rotateStep({ list, state: st, now: NOW + 60_000 });
  expect(focus()).toBe('a');
});

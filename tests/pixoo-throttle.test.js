const { waitMs, cleanInterval } = require('../lib/pixoo-throttle');

test('the first send, and anything a person just did, goes out immediately', () => {
  expect(waitMs({ lastSentAt: 0, now: 5000, minIntervalSec: 60 })).toBe(0);
  expect(waitMs({ lastSentAt: 1000, now: 2000, minIntervalSec: 60, force: true })).toBe(0);
});

test('otherwise it waits out the remainder of the interval', () => {
  expect(waitMs({ lastSentAt: 10_000, now: 25_000, minIntervalSec: 60 })).toBe(45_000);
  expect(waitMs({ lastSentAt: 10_000, now: 70_000, minIntervalSec: 60 })).toBe(0);
  expect(waitMs({ lastSentAt: 10_000, now: 10_500, minIntervalSec: 0 })).toBe(0);   // 0 = no limit
});

test('the interval is a whole number of seconds from 0 to 3600, defaulting to 60', () => {
  expect(cleanInterval(undefined)).toBe(60);
  expect(cleanInterval('')).toBe(60);
  expect(cleanInterval('30.4')).toBe(30);
  expect(cleanInterval(-5)).toBe(0);
  expect(cleanInterval(99999)).toBe(3600);
  expect(waitMs({ lastSentAt: 1000, now: 1000, minIntervalSec: undefined })).toBe(60_000);
});

const { isValidDeviceIp, drawDots, animationCommands, PixooClient, FRAME_BYTES, SIZE } = require('../lib/pixoo');
const { bgraToRgb } = require('../lib/pixoo-frames');

const frame = (v = 0) => Buffer.alloc(FRAME_BYTES, v);

test('isValidDeviceIp accepts only private IPv4', () => {
  for (const ok of ['192.168.1.50', '10.0.0.2', '172.16.5.5', ' 192.168.0.9 ']) expect(isValidDeviceIp(ok)).toBe(true);
  for (const bad of ['8.8.8.8', '172.32.0.1', '192.168.1.256', 'pixoo.local', '', null, '192.168.1', 'http://192.168.1.2']) {
    expect(isValidDeviceIp(bad)).toBe(false);
  }
});

test('drawDots paints hot/warm/cold dots near the top and leaves the input untouched', () => {
  const base = frame(0);
  const out = drawDots(base, [{ hot: true }, { warm: true }, {}]);
  expect(base.equals(frame(0))).toBe(true);
  const px = (buf, x, y) => [...buf.subarray((y * SIZE + x) * 3, (y * SIZE + x) * 3 + 3)];
  // 3 dots: width 3*4+2*2=16, startX=24
  expect(px(out, 24, 1)).toEqual([68, 255, 68]);
  expect(px(out, 30, 1)).toEqual([26, 77, 26]);
  expect(px(out, 36, 1)).toEqual([51, 51, 51]);
  expect(px(out, 24, 10)).toEqual([0, 0, 0]);
});

test('animationCommands builds one SendHttpGif per frame and validates size', () => {
  const cmds = animationCommands([frame(1), frame(2)], 7, 125);
  expect(cmds).toHaveLength(2);
  expect(cmds[1]).toMatchObject({ Command: 'Draw/SendHttpGif', PicNum: 2, PicOffset: 1, PicID: 7, PicSpeed: 125, PicWidth: 64 });
  expect(Buffer.from(cmds[0].PicData, 'base64').length).toBe(FRAME_BYTES);
  expect(() => animationCommands([Buffer.alloc(3)], 1, 100)).toThrow(/bytes/);
});

test('PixooClient resets gif id once, then sends frames in order', async () => {
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push([url, JSON.parse(opts.body)]);
    return { ok: true, text: async () => '{"error_code":0}' };
  };
  const c = new PixooClient('192.168.1.50', { fetchImpl });
  await c.showAnimation([frame(), frame()], 100);
  await c.showAnimation([frame()], 100);
  expect(sent.map(([, b]) => b.Command)).toEqual([
    'Draw/ResetHttpGifId', 'Draw/SendHttpGif', 'Draw/SendHttpGif', 'Draw/SendHttpGif']);
  expect(sent[0][0]).toBe('http://192.168.1.50/post');
  expect(sent[3][1].PicID).toBe(2);
});

test('PixooClient surfaces device errors and rejects bad addresses', async () => {
  const bad = async () => ({ ok: true, text: async () => '{"error_code":1}' });
  await expect(new PixooClient('192.168.1.50', { fetchImpl: bad }).ping()).rejects.toThrow(/error_code 1/);
  const http500 = async () => ({ ok: false, status: 500, text: async () => '' });
  await expect(new PixooClient('192.168.1.50', { fetchImpl: http500 }).ping()).rejects.toThrow(/HTTP 500/);
  expect(() => new PixooClient('1.2.3.4')).toThrow(/private/);
});

test('bgraToRgb swaps channels and drops transparent pixels', () => {
  const bgra = Buffer.alloc(SIZE * SIZE * 4);
  bgra.set([10, 20, 30, 255], 0);   // B,G,R,A → opaque
  bgra.set([200, 200, 200, 50], 4); // mostly transparent
  const rgb = bgraToRgb(bgra);
  expect([...rgb.subarray(0, 3)]).toEqual([30, 20, 10]);
  expect([...rgb.subarray(3, 6)]).toEqual([0, 0, 0]);
});

test('applyLook: 0 is identity, higher strength darkens, desaturates and cuts blue', () => {
  const { applyLook } = require('../lib/pixoo');
  const px = Buffer.alloc(FRAME_BYTES);
  px.set([40, 120, 255], 0);
  expect(applyLook(px, 0).equals(px)).toBe(true);
  const out = applyLook(px, 100);
  expect(out.length).toBe(px.length);
  expect(out[2]).toBeLessThan(255);          // blue cut
  expect(out[1]).toBeLessThan(120);          // gamma darkens midtones
  expect(applyLook(Buffer.alloc(FRAME_BYTES, 255), 100)[0]).toBe(255);  // white stays white (r,g)
  expect(px[0]).toBe(40);                    // input untouched
});

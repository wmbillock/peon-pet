// Divoom Pixoo 64 client. The device exposes a local HTTP API: POST http://<ip>/post {Command: ...}.
const SIZE = 64;
const FRAME_BYTES = SIZE * SIZE * 3;

// Private IPv4 only — the panel takes this from user input, so don't let it aim at arbitrary hosts.
function isValidDeviceIp(ip) {
  if (typeof ip !== 'string') return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

const DOT_COLORS = { hot: [68, 255, 68], warm: [26, 77, 26], cold: [51, 51, 51] };

// LED matrices look more saturated and bluer than a monitor. `strength` (0-100) blends from the
// raw image toward: gamma 1.6 (richer midtones), saturation ×0.8, blue ×0.9.
function applyLook(rgb, strength = 60) {
  const t = Math.min(100, Math.max(0, Number(strength) || 0)) / 100;
  if (t === 0) return Buffer.from(rgb);
  const gamma = 1 + 0.6 * t;
  const sat = 1 - 0.2 * t;
  const blue = 1 - 0.1 * t;
  const lut = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, gamma));
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const out = Buffer.alloc(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i] = lut[clamp(y + (r - y) * sat)];
    out[i + 1] = lut[clamp(y + (g - y) * sat)];
    out[i + 2] = lut[clamp((y + (b - y) * sat) * blue)];
  }
  return out;
}

// Session dots along the top edge of a 64×64 RGB frame (same hot/warm/cold colours as the pet).
function drawDots(rgb, sessions, max = 10) {
  const out = Buffer.from(rgb);
  const n = Math.min(sessions.length, max);
  const DOT = 4;
  const GAP = 2;
  const startX = Math.floor((SIZE - (n * DOT + Math.max(0, n - 1) * GAP)) / 2);
  for (let i = 0; i < n; i++) {
    const s = sessions[i];
    const [r, g, b] = s.hot ? DOT_COLORS.hot : s.warm ? DOT_COLORS.warm : DOT_COLORS.cold;
    for (let dy = 0; dy < DOT; dy++) {
      for (let dx = 0; dx < DOT; dx++) {
        const o = ((1 + dy) * SIZE + startX + i * (DOT + GAP) + dx) * 3;
        out[o] = r; out[o + 1] = g; out[o + 2] = b;
      }
    }
  }
  return out;
}

// Commands that replace the display with a looping animation of 64×64 RGB frames.
function animationCommands(frames, picId, speedMs) {
  return frames.map((f, i) => {
    if (f.length !== FRAME_BYTES) throw new Error(`Frame ${i} must be ${FRAME_BYTES} bytes`);
    return {
      Command: 'Draw/SendHttpGif',
      PicNum: frames.length,
      PicWidth: SIZE,
      PicOffset: i,
      PicID: picId,
      PicSpeed: speedMs,
      PicData: f.toString('base64'),
    };
  });
}

class PixooClient {
  constructor(ip, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
    if (!isValidDeviceIp(ip)) throw new Error('Pixoo address must be a private IPv4 address');
    this.ip = ip.trim();
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.picId = 0;
  }

  async command(body) {
    const res = await this.fetch(`http://${this.ip}/post`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Pixoo replied HTTP ${res.status}`);
    const json = JSON.parse(await res.text());
    if (json.error_code !== undefined && json.error_code !== 0) throw new Error(`Pixoo error_code ${json.error_code}`);
    return json;
  }

  ping() { return this.command({ Command: 'Channel/GetAllConf' }); }

  setBrightness(percent) {
    return this.command({ Command: 'Channel/SetBrightness', Brightness: Math.min(100, Math.max(0, Math.round(percent))) });
  }

  async showAnimation(frames, speedMs) {
    // The device keeps a rolling GIF id; reset it periodically so it never overflows.
    if (this.picId === 0 || this.picId > 200) {
      await this.command({ Command: 'Draw/ResetHttpGifId' });
      this.picId = 0;
    }
    this.picId += 1;
    for (const cmd of animationCommands(frames, this.picId, speedMs)) await this.command(cmd);
  }
}

module.exports = { SIZE, FRAME_BYTES, isValidDeviceIp, applyLook, drawDots, animationCommands, PixooClient };

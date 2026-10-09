'use strict';
// A just-enough WebSocket client (RFC 6455) to send ONE text message to The Firm's chat socket (/ws/threads/management), with
// the Origin and the token subprotocol its local guard requires (live Firm acdf42c54d, local_auth.websocket_allowed: an allowed
// Origin and `firm-token.<token>` among the offered subprotocols; otherwise the handshake is refused before accept, seen as
// HTTP 403). The runtime's WebSocket cannot set the Origin header, so this speaks the protocol itself: handshake, masked
// client frames, unmasked server frames. No dependency. Loopback only, so frames are bounded rather than fully general.
const crypto = require('crypto');
const http = require('http');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const mask = crypto.randomBytes(4);
  let head;
  if (body.length < 126) head = Buffer.from([0x80 | opcode, 0x80 | body.length]);
  else if (body.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(body.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(body.length), 2); }
  const masked = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}

const MAX_FRAME = 1024 * 1024;   // a chat socket never needs more; anything bigger is treated as a protocol error

// Pulls complete server frames out of `buf`; returns { frames: [{opcode, text, raw}], rest }. Throws on an oversized frame.
function parseFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const opcode = buf[off] & 0x0f;
    let len = buf[off + 1] & 0x7f;
    let p = off + 2;
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    if (len > MAX_FRAME) throw new Error(`The Firm sent a ${len}-byte frame; the chat socket does not accept frames over ${MAX_FRAME} bytes`);
    if (buf.length - p < len) break;
    const raw = buf.slice(p, p + len);
    frames.push({ opcode, text: raw.toString('utf8'), raw });
    off = p + len;
  }
  return { frames, rest: buf.slice(off) };
}

// A close frame's code and reason, for a readable error (1008 policy: Origin or token; 4004 unknown thread, per ws.py).
function closeReason(raw) {
  if (!raw || raw.length < 2) return 'no close code';
  const code = raw.readUInt16BE(0);
  const reason = raw.slice(2).toString('utf8').trim();
  return `close ${code}${reason ? `: ${reason}` : ''}`;
}

// Sends `text`, then listens briefly for the system notices The Firm answers with (for example a refusal). The server
// sends no ack and no id: a clean quiet period after the send is the only signal here; the receipt comes from the events feed.
function sendOnce({ origin, path, token, text, quietMs = 400, listenMs = 1500, timeoutMs = 8000, httpImpl = http }) {
  if (!token) return Promise.reject(new Error('The Firm chat socket needs a session token (GET /api/session) and none was supplied'));
  const u = new URL(origin);
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = httpImpl.request({
      host: u.hostname === 'localhost' ? '127.0.0.1' : u.hostname.replace(/^\[|\]$/g, ''),   // The Firm binds 127.0.0.1; "localhost" may resolve to ::1 first
      port: u.port || 80, path, method: 'GET', timeout: timeoutMs,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Protocol': `firm, firm-token.${token}`, Origin: origin,
      },
    });
    req.on('timeout', () => req.destroy(new Error('The Firm did not answer the chat handshake')));
    req.on('error', reject);
    req.on('response', (res) => { res.resume(); reject(new Error(`The Firm refused the chat socket (HTTP ${res.statusCode})${res.statusCode === 403 ? ': the session token or the Origin was not accepted; nothing was sent' : ''}`)); });
    req.on('upgrade', (res, socket, head) => {
      const want = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== want) { socket.destroy(); return reject(new Error('Bad WebSocket handshake from The Firm')); }
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      let sent = false, quietTimer = null, closed = false;
      const notes = [];
      const finish = (err) => {
        if (closed) return; closed = true;
        clearTimeout(quietTimer); clearTimeout(deadline);
        try { socket.write(frame(0x8, Buffer.alloc(0))); } catch { /* gone */ }
        setTimeout(() => socket.destroy(), 100);
        err ? reject(err) : resolve({ sent: true, notes });
      };
      const write = (buf2) => { try { socket.write(buf2); return true; } catch (e) { finish(new Error(`The chat socket failed while writing: ${e.message}`)); return false; } };
      const send = () => { if (closed) return; sent = true; if (write(frame(0x1, JSON.stringify({ type: 'message', text })))) quietTimer = setTimeout(() => finish(), listenMs); };
      const arm = () => { clearTimeout(quietTimer); if (!sent) quietTimer = setTimeout(send, quietMs); };   // the server replays history first; wait for it to go quiet
      // A chatty server (Management streaming) never goes quiet: send anyway at the deadline rather than wait forever.
      const deadline = setTimeout(() => { if (!sent) send(); else finish(); }, timeoutMs);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        let parsed;
        try { parsed = parseFrames(buf); } catch (e) { return finish(e); }
        buf = parsed.rest;
        for (const f of parsed.frames) {
          if (f.opcode === 0x8) return finish(new Error(`The Firm closed the chat socket ${sent ? 'after the send' : 'before the send'} (${closeReason(f.raw)})`));
          if (f.opcode === 0x9) { write(frame(0xA, f.raw)); continue; }   // ping -> pong, or the server drops us as unresponsive
          if (f.opcode === 0xA) continue;
          if (sent && f.opcode === 0x1) {
            let m = null; try { m = JSON.parse(f.text); } catch { /* not JSON */ }
            // A refusal (ThreadBusyError, DirectMessageRefused, "Could not send") comes back as a chat-audience system frame: that is a failed send.
            if (m && m.type === 'system') { const note = String(m.text || '').slice(0, 300); notes.push(note); if (m.audience === 'chat' || /refus|busy|could not send|not allowed/i.test(note)) return finish(new Error(`The Firm refused the message: ${note}`)); }
          }
        }
        if (!sent) arm();
      });
      socket.on('error', (e) => finish(e));
      socket.on('close', () => { if (!closed) finish(new Error('The chat socket closed before the message was sent')); });
      arm();
    });
    req.end();
  });
}

module.exports = { sendOnce, frame, parseFrames, closeReason, GUID, MAX_FRAME };

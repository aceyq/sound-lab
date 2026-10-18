// Messages between the phone Controller page and the laptop Performance page.
// Pure functions, unit-tested in test/motion-protocol.test.js.
//
// The laptop trusts nothing it receives: every message is checked for its
// type, field types and numeric ranges, and anything malformed is dropped
// (and counted in Diagnostics) before it can reach the mapping or audio code.

export const PROTOCOL_VERSION = 1;
export const SAMPLE_RATE_HZ = 25; // phone → laptop sample messages per second
export const MAX_MESSAGE_KEYS = 24;

// Unambiguous characters for IDs a person may have to type (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Random string from crypto.getRandomValues (unpredictable, not Math.random). */
export function randomCode(length, cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(length);
  cryptoObj.getRandomValues(bytes);
  let out = '';
  // 248 = 8 × 31: rejecting larger bytes avoids modulo bias.
  for (let i = 0; i < length; i++) {
    let b = bytes[i];
    while (b >= 248) {
      const one = new Uint8Array(1);
      cryptoObj.getRandomValues(one);
      b = one[0];
    }
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

/** A new session: the PeerJS ID the laptop listens on, plus a pairing code. */
export function newSession(cryptoObj) {
  const id = randomCode(8, cryptoObj);
  return {
    sessionId: `${id.slice(0, 4)}-${id.slice(4)}`,
    token: randomCode(6, cryptoObj),
  };
}

/** PeerJS IDs share one public namespace, so prefix ours to avoid collisions. */
export const peerIdFor = (sessionId) => `dsc180-motion-score-${sessionId}`.toLowerCase();

export function normalizeSessionId(s) {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : null;
}

export function normalizeToken(s) {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 6 ? clean : null;
}

/**
 * Phone-controller URL for a session, built from the page's real origin and
 * base path (so it keeps a GitHub Pages /<repo>/ sub-path).
 */
export function controllerUrl(locationLike, sessionId, token) {
  const base = locationLike.origin + locationLike.pathname.replace(/[^/]*$/, '');
  return `${base}#/controller?session=${encodeURIComponent(sessionId)}&code=${encodeURIComponent(token)}`;
}

/** True when a phone could not reach this page's address. */
export function isLocalOnly(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname.endsWith('.localhost');
}

// ───────────── validation ─────────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const numOrNull = (v, lo, hi) => v === null || num(v, lo, hi);

const SENSOR_STATES = ['off', 'waiting', 'active', 'denied', 'unavailable', 'insecure'];
const COMMANDS = ['arm', 'disarm', 'calibrate', 'panic'];
const TILT_SOURCES = ['orientation', 'gravity'];
const LIN_SOURCES = ['sensor', 'estimated'];

/**
 * Check a message from the phone. Returns { ok: true, msg } with a clean copy
 * containing only known fields, or { ok: false, error }.
 */
export function validatePhoneMessage(m) {
  if (!isObj(m)) return { ok: false, error: 'not an object' };
  if (Object.keys(m).length > MAX_MESSAGE_KEYS) return { ok: false, error: 'too many fields' };
  switch (m.type) {
    case 'hello':
      if (m.v !== PROTOCOL_VERSION) return { ok: false, error: 'wrong protocol version' };
      if (typeof m.code !== 'string' || m.code.length > 16) return { ok: false, error: 'bad code' };
      return { ok: true, msg: { type: 'hello', v: m.v, code: m.code } };
    case 'ping':
      return { ok: true, msg: { type: 'ping' } };
    case 'command':
      if (!COMMANDS.includes(m.cmd)) return { ok: false, error: 'unknown command' };
      return { ok: true, msg: { type: 'command', cmd: m.cmd } };
    case 'expr':
      // Expression slider moved on the phone (Steady sustain).
      if (!num(m.value, 0, 1)) return { ok: false, error: 'expression out of range' };
      return { ok: true, msg: { type: 'expr', value: m.value } };
    case 'status':
      if (!SENSOR_STATES.includes(m.sensors)) return { ok: false, error: 'bad sensor state' };
      if (typeof m.hidden !== 'boolean') return { ok: false, error: 'bad hidden flag' };
      return { ok: true, msg: { type: 'status', sensors: m.sensors, hidden: m.hidden } };
    case 'sample': {
      if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 2 ** 31) return { ok: false, error: 'bad seq' };
      if (!num(m.t, 0, 1e12)) return { ok: false, error: 'bad timestamp' };
      if (!numOrNull(m.tilt, -180, 180)) return { ok: false, error: 'tilt out of range' };
      if (m.side !== undefined && !numOrNull(m.side, -90, 90)) return { ok: false, error: 'sideways tilt out of range' };
      if (!numOrNull(m.lin, 0, 200)) return { ok: false, error: 'intensity out of range' };
      if (!numOrNull(m.jerk, 0, 100000)) return { ok: false, error: 'jerk out of range' };
      if (!num(m.screen, -360, 360)) return { ok: false, error: 'bad screen angle' };
      if (!num(m.rate, 0, 1000)) return { ok: false, error: 'bad rate' };
      if (m.tilt !== null && !TILT_SOURCES.includes(m.tiltSrc)) return { ok: false, error: 'bad tilt source' };
      if (m.lin !== null && !LIN_SOURCES.includes(m.linSrc)) return { ok: false, error: 'bad intensity source' };
      return {
        ok: true,
        msg: {
          type: 'sample', seq: m.seq, t: m.t, tilt: m.tilt, tiltSrc: m.tilt === null ? null : m.tiltSrc,
          side: m.side === undefined ? null : m.side,
          lin: m.lin, linSrc: m.lin === null ? null : m.linSrc, jerk: m.jerk, screen: m.screen, rate: m.rate,
        },
      };
    }
    default:
      return { ok: false, error: 'unknown message type' };
  }
}

/** Check a message from the laptop (the phone validates too). */
export function validateLaptopMessage(m) {
  if (!isObj(m)) return { ok: false, error: 'not an object' };
  switch (m.type) {
    case 'welcome':
    case 'ping':
      return { ok: true, msg: { type: m.type } };
    case 'reject':
      return { ok: true, msg: { type: 'reject', reason: String(m.reason || '').slice(0, 200) } };
    case 'state': {
      const s = {
        type: 'state',
        armed: m.armed === true,
        audio: ['off', 'starting', 'on', 'panic'].includes(m.audio) ? m.audio : 'off',
        calib: ['none', 'running', 'done', 'failed', 'needed'].includes(m.calib) ? m.calib : 'none',
        calibText: String(m.calibText || '').slice(0, 200),
        mode: m.mode === 'accents' ? 'accents' : 'flow',
        reason: String(m.reason || '').slice(0, 200),
        // Live feedback for the phone screen (already mapped by the laptop).
        tiltRel: num(m.tiltRel, -180, 180) ? m.tiltRel : null,
        intensity: num(m.intensity, 0, 1) ? m.intensity : 0,
        sideRel: num(m.sideRel, -180, 180) ? m.sideRel : null,
        richness: num(m.richness, 0, 1) ? m.richness : null,
        mapping: m.mapping === 'intensity' ? 'intensity' : 'tilt',
        exprSource: m.exprSource === 'movement' ? 'movement' : 'sustain',
        exprLevel: num(m.exprLevel, 0, 1) ? m.exprLevel : 0,
        sideAvailable: m.sideAvailable !== false,
        locked: m.locked === true,
        hits: Number.isInteger(m.hits) && m.hits >= 0 ? m.hits : 0,
        sound: m.sound === true,
      };
      return { ok: true, msg: s };
    }
    default:
      return { ok: false, error: 'unknown message type' };
  }
}

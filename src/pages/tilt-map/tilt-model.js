// Tilt Sound Map (capstone part 3): pure logic, no DOM or Web Audio, so it is
// unit-tested with `npm test`.
//
// Two phone angles replace the mouse's x and y:
//   roll  (sideways tilt, + = right edge down)       → x (left → right)
//   pitch (forward/back tilt, + = top toward you)     → y (bottom → top)
// Both are measured from a neutral pose the person sets, and scaled by a
// comfortable range for each: ±range degrees covers the whole map, neutral
// is the centre. The resulting point is blended exactly like the Vowel Morph
// square (inverse-distance weights over the sounds placed on the map).
import { relativeGestures, wrapDeg } from '../motion-score/mapping.js';
import { MAX_HARMONICS } from '../frequency/vowel-model.js';

export const DEFAULT_RANGE = Object.freeze({ pitch: 30, roll: 35 });
export const RANGE_MIN = 8;
export const RANGE_MAX = 80;
export const STALE_MS = 400; // no fresh phone sample for this long → tracking lost, sound fades
export const SMOOTH_TAU = 0.06; // s, light smoothing of the moving dot
export const DRUM_BUFFER = 0.05; // map units: leave a region by this much more before it can hit again
export const DRUM_COOLDOWN_MS = 120; // and never re-hit the same drum faster than this

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Phone angles relative to the neutral pose, from orientation "up" vectors. */
export function anglesFromUp(up, up0) {
  const g = relativeGestures(up, up0);
  return { pitch: g.pitch, roll: g.lean };
}

/** Angles relative to neutral from the phone's own tilt/side readings (fallback without an up vector). */
export function anglesFromTilt(sample, neutral) {
  if (!Number.isFinite(sample.tilt) || !Number.isFinite(sample.side)) return null;
  return { pitch: -wrapDeg(sample.tilt - neutral.tilt), roll: -(sample.side - neutral.side) };
}

/** Angles (degrees) → map point. Each angle drives exactly one axis. */
export function anglesToPoint({ pitch, roll }, range = DEFAULT_RANGE, invert = { pitch: false, roll: false }) {
  const p = (invert.pitch ? -1 : 1) * pitch;
  const r = (invert.roll ? -1 : 1) * roll;
  return { x: clamp01(0.5 + r / (2 * range.roll)), y: clamp01(0.5 + p / (2 * range.pitch)) };
}

/** Map point → the angles that reach it (for labels). */
export function pointToAngles(pt, range = DEFAULT_RANGE, invert = { pitch: false, roll: false }) {
  return {
    pitch: (invert.pitch ? -1 : 1) * (pt.y - 0.5) * 2 * range.pitch,
    roll: (invert.roll ? -1 : 1) * (pt.x - 0.5) * 2 * range.roll,
  };
}

/** Mean direction of a set of unit vectors (the neutral pose from ~1 s of samples). */
export function averageUp(ups) {
  let x = 0; let y = 0; let z = 0;
  for (const u of ups) { if (!u) continue; x += u[0]; y += u[1]; z += u[2]; }
  const m = Math.hypot(x, y, z);
  return m > 1e-9 ? [x / m, y / m, z / m] : null;
}

/**
 * A comfortable range from angles recorded while the person moved through
 * their range: 90th percentile of |angle| per axis, rounded, clamped.
 */
export function rangeFromSamples(samples, fallback = DEFAULT_RANGE) {
  const pick = (key) => {
    const a = samples.map((s) => Math.abs(s[key])).filter(Number.isFinite).sort((p, q) => p - q);
    if (a.length < 5) return fallback[key];
    const v = a[Math.min(a.length - 1, Math.floor(0.9 * (a.length - 1)))];
    return Math.round(clamp(v, RANGE_MIN, RANGE_MAX));
  };
  return { pitch: pick('pitch'), roll: pick('roll') };
}

/** Exponential smoothing of the dot (dt in seconds). */
export function smoothPoint(prev, next, dt, tau = SMOOTH_TAU) {
  if (!prev || !(dt > 0) || dt > 0.5) return { ...next };
  const a = 1 - Math.exp(-dt / tau);
  return { x: prev.x + a * (next.x - prev.x), y: prev.y + a * (next.y - prev.y) };
}

export function isStale(lastSampleMs, nowMs, limit = STALE_MS) {
  return !Number.isFinite(lastSampleMs) || nowMs - lastSampleMs > limit;
}

// ───────────── starter sounds ─────────────

/**
 * Harmonic strengths of a vowel-like sound: a glottal-like source falling
 * 12 dB per octave, shaped by three formant resonances (centre Hz, bandwidth Hz).
 * Strongest harmonic = 1, 48 values like a Vowel Morph analysis.
 */
export function formantAmps(f0, formants, nyquist = 24000) {
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (let n = 1; n <= MAX_HARMONICS; n++) {
    const f = n * f0;
    if (f > Math.min(nyquist * 0.9, 8000)) break;
    const source = 1 / n;
    let res = 0.02;
    for (const [fc, bw, g] of formants) res += g / Math.sqrt(1 + ((f - fc) / (bw / 2)) ** 2);
    amps[n - 1] = source * res;
  }
  const top = Math.max(...amps);
  return amps.map((a) => {
    const v = a / top;
    return v < 10 ** (-50 / 20) ? 0 : Math.round(v * 1000) / 1000;
  });
}

// Classic average formants (Peterson & Barney 1952, adult male).
export const STARTERS = Object.freeze([
  { key: 'ah', name: 'Starter “ah”', f0: 165, pos: { x: 0.2, y: 0.5 }, formants: [[730, 90, 1], [1090, 110, 0.5], [2440, 170, 0.2]] },
  { key: 'ee', name: 'Starter “ee”', f0: 247, pos: { x: 0.8, y: 0.5 }, formants: [[270, 60, 1], [2290, 120, 0.45], [3010, 170, 0.3]] },
  { key: 'oo', name: 'Starter “oo”', f0: 131, pos: { x: 0.5, y: 0.2 }, formants: [[300, 60, 1], [870, 90, 0.35], [2240, 130, 0.1]] },
  { key: 'eh', name: 'Starter “eh”', f0: 196, pos: { x: 0.5, y: 0.8 }, formants: [[530, 70, 1], [1840, 110, 0.45], [2480, 160, 0.25]] },
]);

export function starterAnchors() {
  return STARTERS.map((s) => ({
    id: `starter-${s.key}`, name: s.name, source: 'starter', pos: { ...s.pos }, angles: null,
    analysis: { status: 'ok', f0: s.f0, amps: formantAmps(s.f0, s.formants) },
  }));
}

// ───────────── percussion ─────────────

// Three drum regions in different corners; the bottom-right corner and the
// middle stay free for the sustained sound.
export const DRUM_REGIONS = Object.freeze([
  { id: 'kick', name: 'Kick', x: 0.13, y: 0.13, r: 0.12, color: '#ff8a65' },
  { id: 'snare', name: 'Snare', x: 0.13, y: 0.87, r: 0.12, color: '#81d4fa' },
  { id: 'clap', name: 'Clap', x: 0.87, y: 0.87, r: 0.12, color: '#ce93d8' },
]);

/**
 * Plays each drum ONCE on entering its region. A region re-arms only after
 * the point has left it by more than `buffer` (hysteresis), so a shaky wrist
 * on the boundary does not retrigger.
 */
export class PercussionGate {
  constructor(regions = DRUM_REGIONS, { buffer = DRUM_BUFFER, cooldownMs = DRUM_COOLDOWN_MS } = {}) {
    this.regions = regions;
    this.buffer = buffer;
    this.cooldownMs = cooldownMs;
    this.inside = new Map(regions.map((r) => [r.id, false]));
    this.lastHit = new Map();
    this.hits = 0;
  }

  /** Marks the regions the point is already in as entered, without playing (when percussion is switched on). */
  prime(pt) {
    for (const r of this.regions) this.inside.set(r.id, Math.hypot(pt.x - r.x, pt.y - r.y) <= r.r);
  }

  /** Returns the drum ids to play now (usually none or one). */
  update(pt, nowMs) {
    const out = [];
    for (const r of this.regions) {
      const d = Math.hypot(pt.x - r.x, pt.y - r.y);
      const was = this.inside.get(r.id);
      if (!was && d <= r.r) {
        this.inside.set(r.id, true);
        const last = this.lastHit.get(r.id);
        if (last == null || nowMs - last >= this.cooldownMs) {
          this.lastHit.set(r.id, nowMs);
          this.hits++;
          out.push(r.id);
        }
      } else if (was && d > r.r + this.buffer) {
        this.inside.set(r.id, false);
      }
    }
    return out;
  }
}

// ───────────── project ─────────────

export const PROJECT_KEY = 'tiltMap.project.v1';

export function emptyProject() {
  return { version: 1, anchors: starterAnchors(), range: { ...DEFAULT_RANGE }, invert: { pitch: false, roll: false }, neutral: null, percussion: false, power: 2 };
}

export function loadProject(raw) {
  const p = emptyProject();
  if (!raw || typeof raw !== 'object') return p;
  if (Array.isArray(raw.anchors)) p.anchors = raw.anchors.map(cleanAnchor).filter(Boolean);
  const r = raw.range || {};
  p.range = { pitch: clamp(Number(r.pitch) || DEFAULT_RANGE.pitch, RANGE_MIN, RANGE_MAX), roll: clamp(Number(r.roll) || DEFAULT_RANGE.roll, RANGE_MIN, RANGE_MAX) };
  p.invert = { pitch: !!(raw.invert && raw.invert.pitch), roll: !!(raw.invert && raw.invert.roll) };
  const n = raw.neutral;
  if (n && Array.isArray(n.up) && n.up.length === 3 && n.up.every(Number.isFinite)) p.neutral = { up: n.up.slice(), tilt: Number(n.tilt) || 0, side: Number(n.side) || 0 };
  else if (n && Number.isFinite(n.tilt) && Number.isFinite(n.side)) p.neutral = { up: null, tilt: n.tilt, side: n.side };
  p.percussion = raw.percussion === true;
  p.power = [1, 2, 4].includes(raw.power) ? raw.power : 2;
  return p;
}

export function cleanAnchor(a) {
  if (!a || typeof a !== 'object' || !a.pos || !a.analysis) return null;
  const f0 = Number(a.analysis.f0);
  if (!(f0 > 0) || !Array.isArray(a.analysis.amps)) return null;
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (let i = 0; i < MAX_HARMONICS && i < a.analysis.amps.length; i++) { const v = Number(a.analysis.amps[i]); amps[i] = Number.isFinite(v) ? clamp(v, 0, 1) : 0; }
  if (!amps.some((v) => v > 0)) return null;
  return {
    id: String(a.id || `tm-${Math.random().toString(36).slice(2, 10)}`),
    name: String(a.name || 'Sound').slice(0, 40),
    source: ['starter', 'recorded', 'vowel-morph'].includes(a.source) ? a.source : 'recorded',
    pos: { x: clamp01(Number(a.pos.x) || 0), y: clamp01(Number(a.pos.y) || 0) },
    angles: a.angles && Number.isFinite(a.angles.pitch) && Number.isFinite(a.angles.roll) ? { pitch: a.angles.pitch, roll: a.angles.roll } : null,
    analysis: { status: 'ok', f0, amps },
  };
}

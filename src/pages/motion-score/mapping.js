// Movement → sound mappings for Motion Score (laptop side).
// Pure functions and small state machines, unit-tested in
// test/motion-mapping.test.js. Nothing here touches the DOM or Web Audio.

import { wrapDeg } from './sensors.js';

export const F_MIN = 110; // A2
export const F_MAX = 880; // A5, three octaves higher
export const H_MIN = 1;
export const H_MAX = 12;
export const TILT_RANGE = 35; // degrees either side of neutral

export const DEFAULTS = Object.freeze({
  sensitivity: 1, // 0.5 … 2
  invertTilt: false,
  intensityRange: 5, // m/s² above the noise floor that counts as "full" movement
  jerkThreshold: 120, // m/s³, minimum accent threshold at sensitivity 1
});

export const ACCENT_COOLDOWN_MS = 300;
export const ACCENT = Object.freeze({ attack: 0.015, decayTc: 0.09, length: 0.45, peak: 0.9 });
export const FLOW = Object.freeze({ attackTau: 0.08, releaseTau: 0.35, harmonicTau: 0.15 });
export const STALE_MS = 500; // no sample for this long → silence
export const DISARM_AFTER_MS = 3000; // no sample for this long → disarm

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ───────────── pitch ─────────────
/** 0..1 → 110..880 Hz on a logarithmic scale (equal steps = equal intervals). */
export function unitToPitch(u) {
  return F_MIN * (F_MAX / F_MIN) ** clamp01(u);
}

export function pitchToUnit(f) {
  return clamp01(Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN));
}

/** Tilt relative to the calibrated neutral, in degrees, handling wrap-around. */
export function relativeTilt(tilt, neutral, invert = false) {
  const r = wrapDeg(tilt - neutral);
  return invert ? -r : r;
}

/** Relative tilt (−35…+35°) → 0..1 (0.5 = neutral). */
export function tiltToUnit(rel) {
  return clamp01((rel + TILT_RANGE) / (2 * TILT_RANGE));
}

// A minor pentatonic: A C D E G. Semitones above A.
export const PENTATONIC_STEPS = [0, 3, 5, 7, 10];
export const PENTATONIC_SEMIS = (() => {
  const out = [];
  for (let oct = 0; oct <= 3; oct++) for (const s of PENTATONIC_STEPS) if (oct * 12 + s <= 36) out.push(oct * 12 + s);
  return out; // A2 … A5
})();
export const semisToHz = (s) => F_MIN * 2 ** (s / 12);
export const hzToSemis = (f) => 12 * Math.log2(f / F_MIN);

/** Nearest scale note, but keep the current one until clearly closer to another. */
export function stablePentatonic(freq, current, margin = 0.6) {
  const s = hzToSemis(freq);
  let best = PENTATONIC_SEMIS[0];
  for (const n of PENTATONIC_SEMIS) if (Math.abs(n - s) < Math.abs(best - s)) best = n;
  if (current == null || !PENTATONIC_SEMIS.includes(current) || best === current) return best;
  return Math.abs(s - current) - Math.abs(s - best) > margin ? best : current;
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function noteName(f) {
  if (!(f > 0)) return { name: '—', cents: 0 };
  const midi = 69 + 12 * Math.log2(f / 440);
  const m = Math.round(midi);
  return { name: NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1), cents: Math.round((midi - m) * 100) };
}

// ───────────── harmonics ─────────────
/** 0..1 → continuous 1..12. */
export const unitToHarmonicValue = (u) => H_MIN + clamp01(u) * (H_MAX - H_MIN);

/** Integer count that only changes once the value is clearly past a boundary. */
export function stableHarmonicCount(value, current, margin = 0.3) {
  const target = Math.min(H_MAX, Math.max(H_MIN, Math.round(value)));
  if (!Number.isInteger(current)) return target;
  if (value > current + 0.5 + margin || value < current - 0.5 - margin) return target;
  return current;
}

/**
 * Amplitudes for harmonic components 1..count (component 1 is the
 * fundamental): 1/n, dropping any at or above Nyquist, all divided by the
 * same factor so they sum to 1 (the mixture can never exceed full scale).
 */
export function harmonicAmplitudes(count, f0, nyquist) {
  const amps = [];
  let sum = 0;
  for (let n = 1; n <= count; n++) {
    if (n * f0 >= nyquist) break;
    amps.push(1 / n);
    sum += 1 / n;
  }
  return { amps: amps.map((a) => a / sum), audible: amps.length };
}

// ───────────── movement intensity ─────────────
/**
 * Smoothed linear-acceleration magnitude (m/s²) → 0..1. Values up to the
 * calibrated noise floor (plus a small margin) count as stillness.
 */
export function intensityToUnit(lin, cal, settings = DEFAULTS) {
  if (!Number.isFinite(lin)) return 0;
  const floor = cal.noise * 1.3 + 0.05;
  const range = (settings.intensityRange ?? DEFAULTS.intensityRange) / (settings.sensitivity || 1);
  return clamp01((lin - floor) / range);
}

/** Exponential smoothing that behaves the same at any update rate. */
export function smooth(prev, next, dtSec, tauSec) {
  if (prev == null || !Number.isFinite(prev)) return next;
  return prev + (next - prev) * (1 - Math.exp(-Math.max(0, dtSec) / tauSec));
}

/** Flow envelope: faster attack when rising, gentler release when falling. */
export function flowEnvelope(prev, target, dtSec) {
  return smooth(prev, target, dtSec, target > prev ? FLOW.attackTau : FLOW.releaseTau);
}

// ───────────── accents ─────────────
/**
 * Sharp-movement detector. Fires when jerk crosses the threshold, then
 * waits until jerk falls below half the threshold (hysteresis) and at least
 * ACCENT_COOLDOWN_MS of phone time has passed. After a reset it needs one
 * quiet sample before it can fire, so a stale or first sample never triggers.
 */
export class AccentDetector {
  constructor() {
    this.reset();
  }

  reset() {
    this.ready = false;
    this.lastHitT = -Infinity;
    this.lastT = null;
  }

  threshold(cal, settings = DEFAULTS) {
    const base = Math.max(settings.jerkThreshold ?? DEFAULTS.jerkThreshold, (cal.jerkNoise || 0) * 4);
    return base / (settings.sensitivity || 1);
  }

  /** phoneT in ms (phone clock, only compared with itself); jerk in m/s³. */
  update(phoneT, jerk, cal, settings = DEFAULTS) {
    if (!Number.isFinite(jerk) || !Number.isFinite(phoneT)) return false;
    if (this.lastT !== null && (phoneT <= this.lastT || phoneT - this.lastT > 300)) {
      // Out-of-order sample, or a gap: start over.
      this.reset();
    }
    this.lastT = phoneT;
    const thr = this.threshold(cal, settings);
    if (!this.ready) {
      if (jerk < thr * 0.5) this.ready = true;
      return false;
    }
    if (jerk >= thr && phoneT - this.lastHitT >= ACCENT_COOLDOWN_MS) {
      this.ready = false;
      this.lastHitT = phoneT;
      return true;
    }
    return false;
  }
}

// ───────────── calibration ─────────────
export const NO_CAL = Object.freeze({ done: false, neutral: 0, noise: 0.15, jerkNoise: 20, screen: 0 });

/** Average of angles (handles wrap-around, e.g. 179° and −179° → 180°). */
export function circularMeanDeg(angles) {
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    sx += Math.cos((a * Math.PI) / 180);
    sy += Math.sin((a * Math.PI) / 180);
  }
  return wrapDeg((Math.atan2(sy, sx) * 180) / Math.PI);
}

function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

/**
 * Build a calibration from ~2 s of samples taken while the phone is held
 * still: neutral tilt = average tilt, noise = typical intensity at rest.
 */
export function calibrateFromSamples(samples) {
  const good = samples.filter((s) => Number.isFinite(s.tilt) && Number.isFinite(s.lin));
  if (good.length < 15) return { error: 'Not enough sensor data arrived. Keep the phone page open and try again.' };
  const tilts = good.map((s) => s.tilt);
  const neutral = circularMeanDeg(tilts);
  const spread = Math.max(...tilts.map((t) => Math.abs(wrapDeg(t - neutral))));
  if (spread > 15) return { error: 'The phone moved too much. Hold it still for the whole countdown and try again.' };
  const noise = percentile(good.map((s) => s.lin), 90);
  if (noise > 2) return { error: 'There was too much movement to measure stillness. Rest your arm and try again.' };
  const jerks = good.map((s) => s.jerk).filter(Number.isFinite);
  const jerkNoise = jerks.length ? percentile(jerks, 90) : NO_CAL.jerkNoise;
  return { done: true, neutral, noise, jerkNoise, screen: good[good.length - 1].screen ?? 0 };
}

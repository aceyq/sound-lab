// Movement → sound mappings for Motion Score (laptop side).
// Pure functions and small state machines, unit-tested in
// test/motion-mapping.test.js. Nothing here touches the DOM or Web Audio.

import { wrapDeg } from './sensors.js';
export { wrapDeg };

export const F_MIN = 110; // A2
export const F_MAX = 880; // A5, three octaves higher
export const H_MIN = 1;
export const H_MAX = 12;
export const TILT_RANGE = 35; // degrees either side of neutral (forward/back → pitch)
export const SIDE_RANGE = 30; // default degrees of lean (either way) for full richness
export const DEAD_ZONE = 5; // default degrees of lean around neutral that stay a pure tone

export const DEFAULTS = Object.freeze({
  sensitivity: 1, // 0.5 … 2
  invertTilt: false,
  intensityRange: 5, // m/s² above the noise floor that counts as "full" movement
  jerkThreshold: 120, // m/s³, minimum accent threshold at sensitivity 1
  sideRange: SIDE_RANGE, // degrees of sideways lean (either direction) that give full richness
  deadZone: DEAD_ZONE, // degrees of sideways lean around neutral that still give a pure tone
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

// ───────────── harmonic richness (Tilt instrument mapping) ─────────────
// ───────────── orientation (Tilt instrument) ─────────────
// Both gestures are measured from the direction of "up" (the opposite of
// gravity) expressed in the PHONE'S OWN axes: x = left→right across the
// screen, y = bottom→top, z = out of the screen toward you. This does not
// depend on compass heading or on how the browser splits the orientation into
// Euler angles, so it stays well-behaved when the phone is held upright, where
// beta/gamma alone become unreliable.
//
//   forward/back tilt = rotation about the phone's left–right (x) axis
//                       = atan2(up_z, up_y): 0° upright, +90° lying flat.
//   sideways lean     = how far the left–right axis tips from level
//                       = asin(up_x): 0° level, right edge down = negative.
//
// A rotation about the x axis leaves up_x unchanged, so pure forward/back
// tilt never changes the lean reading. Turning like a steering wheel changes
// the lean and only slightly changes the tilt reading.

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

/** "Up" in the phone's own axes from DeviceOrientationEvent beta and gamma. */
export function upVector(betaDeg, gammaDeg) {
  const b = betaDeg * D2R;
  const g = gammaDeg * D2R;
  return [-Math.sin(g) * Math.cos(b), Math.sin(b), Math.cos(g) * Math.cos(b)];
}

/** Build an up vector from tilt-back (0 = upright, 90 = flat) and lean. */
export function upFromAngles(tiltBackDeg, leanDeg) {
  const t = tiltBackDeg * D2R;
  const l = leanDeg * D2R;
  return [Math.sin(l), Math.cos(l) * Math.cos(t), Math.cos(l) * Math.sin(t)];
}

export function normalize3(v) {
  const m = Math.hypot(v[0], v[1], v[2]);
  return m > 1e-9 ? [v[0] / m, v[1] / m, v[2] / m] : null;
}

/** Tilt-back and lean (degrees) of an up vector. */
export function orientAngles(up) {
  return {
    tiltBack: Math.atan2(up[2], up[1]) * R2D,
    lean: Math.asin(Math.max(-1, Math.min(1, up[0]))) * R2D,
  };
}

/**
 * Gestures relative to the calibrated neutral position.
 *  pitch: + = top of the phone tilted toward you (higher pitch)
 *  lean:  + = right edge down
 */
export function relativeGestures(up, up0) {
  const a = orientAngles(up);
  const n = orientAngles(up0);
  return { pitch: -wrapDeg(a.tiltBack - n.tiltBack), lean: -(a.lean - n.lean) };
}

/**
 * Is this a good holding position for the Tilt instrument? Recommended:
 * portrait, screen facing you, top tilted back about 10–50° from upright,
 * not leaning. Returns { level: 'good' | 'warn' | 'bad', text }.
 */
export function holdCheck(up, { ignoreLean = false } = {}) {
  if (!up) return { level: 'bad', text: 'No orientation data from the phone.' };
  const { tiltBack, lean } = orientAngles(up);
  if (up[1] < -0.3) return { level: 'bad', text: 'The phone is upside down. Hold it in portrait with the top up.' };
  if (tiltBack > 70) return { level: 'bad', text: 'The phone is almost flat. Raise the top so the screen faces you, tilted back only slightly.' };
  if (tiltBack < -20) return { level: 'bad', text: 'The top is tilted toward you past upright. Tilt the top back a little, away from you.' };
  if (!ignoreLean && Math.abs(lean) > 25) return { level: 'bad', text: 'The phone is leaning sideways. Hold it level, like a steering wheel pointing straight.' };
  if (tiltBack > 45) return { level: 'warn', text: 'Quite flat. Raise the top a little toward upright: the flatter the phone, the less a sideways lean registers.' };
  if (tiltBack < 0) return { level: 'warn', text: 'Slightly past upright. Tilt the top back a little, away from you.' };
  if (!ignoreLean && Math.abs(lean) > 10) return { level: 'warn', text: 'Leaning a little. Straighten the phone so it is level.' };
  return { level: 'good', text: 'Good position: portrait, screen facing you, tilted back slightly, level.' };
}

/**
 * Sideways lean (relative to neutral) → harmonic richness 0..1.
 * Neutral = 0 (fundamental only). Inside ±deadZone it stays 0; beyond it,
 * leaning EITHER way rises smoothly from 0 to 1 at ±range. No jump at the
 * dead-zone edge: richness starts at exactly 0 there.
 */
export function leanToRichness(lean, deadZone = DEAD_ZONE, range = SIDE_RANGE) {
  if (!Number.isFinite(lean)) return 0;
  const a = Math.abs(lean);
  if (a <= deadZone) return 0;
  return clamp01((a - deadZone) / Math.max(1, range - deadZone));
}

/** Continuous "harmonic position" 1..12 shown to the user. */
export const richnessToPosition = (r) => 1 + clamp01(r) * (H_MAX - 1);

/**
 * How much of each harmonic is switched on (0..1), for richness 0..1.
 * The fundamental is always fully on. With q = 12·richness, harmonic n fades
 * in while q goes from n − 2 to n (weight (q − n + 2) / 2), so each fade
 * overlaps the next and higher harmonics enter one after another without any
 * switching: richness 0 = fundamental only, richness 1 = all 12 at full.
 */
export function richnessWeights(r) {
  const q = 12 * clamp01(r);
  const w = [];
  for (let n = 1; n <= H_MAX; n++) w.push(n === 1 ? 1 : clamp01((q - n + 2) / 2));
  return w;
}

/** Legacy mapping: harmonics 1..count fully on, the rest off. */
export function countWeights(count) {
  return Array.from({ length: H_MAX }, (_, i) => (i < count ? 1 : 0));
}

/** Peak of Σ aₙ sin(2π n t) over one period (all sines start at phase 0). */
export function waveformPeak(amps, samples = 2048) {
  let peak = 0;
  for (let k = 0; k < samples; k++) {
    const t = (2 * Math.PI * k) / samples;
    let v = 0;
    for (let i = 0; i < amps.length; i++) if (amps[i]) v += amps[i] * Math.sin((i + 1) * t);
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  return peak;
}

/**
 * The recipe and what is actually sent to the oscillators.
 *  recipe[n]  = weight × 1/n   (the 1/n starting recipe, faded by richness)
 *  output[n]  = recipe[n] × norm
 * Harmonics at or above Nyquist get 0. norm = 1 / (peak of the summed
 * waveform), so the mixture's peak is exactly 1 at full expression: it can
 * never clip, and the level stays similar as harmonics are added (equal
 * PERCEIVED loudness is not claimed).
 */
export function harmonicMix(weights, f0, nyquist) {
  const recipe = weights.map((w, i) => ((i + 1) * f0 < nyquist ? w / (i + 1) : 0));
  const peak = waveformPeak(recipe);
  const norm = peak > 0 ? 1 / peak : 0;
  return { recipe, output: recipe.map((a) => a * norm), norm, peak };
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
export const NO_CAL = Object.freeze({ done: false, neutral: 0, noise: 0.15, jerkNoise: 20, up0: null, sideAvailable: false, screen: 0 });

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
  // Neutral orientation from the phone's "up" direction, if it was reported.
  const ups = good.map((s) => s.up).filter((u) => Array.isArray(u));
  let up0 = null;
  let sideAvailable = false;
  if (ups.length >= good.length * 0.8) {
    up0 = normalize3([0, 1, 2].map((k) => ups.reduce((a, u) => a + u[k], 0)));
    const spread = Math.max(...ups.map((u) => Math.acos(Math.max(-1, Math.min(1, u[0] * up0[0] + u[1] * up0[1] + u[2] * up0[2]))) * R2D));
    if (spread > 15) return { error: 'The phone moved too much. Hold it still for the whole countdown and try again.' };
    const hold = holdCheck(up0);
    if (hold.level === 'bad') return { error: `${hold.text} Then calibrate again.`, hold };
    sideAvailable = true;
  }
  return { done: true, neutral, noise, jerkNoise, up0, sideAvailable, hold: up0 ? holdCheck(up0) : null, screen: good[good.length - 1].screen ?? 0 };
}

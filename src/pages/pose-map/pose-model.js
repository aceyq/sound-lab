// Pose Sound Map (capstone part 3): pure logic, no DOM, camera or Web Audio,
// so it is unit-tested with `npm test`.
//
// Two JOINT ANGLES from the camera's body landmarks (not x/y positions):
//   right elbow bend = 180° − (angle at the right elbow between the right
//                      shoulder and the right wrist); 0° = arm straight
//   left arm lift    = angle at the left shoulder between the left hip and
//                      the left elbow; about 10–20° = arm hanging down,
//                      90° = straight out to the side, 180° = overhead
// Each is scaled between the two calibrated ends of its range to 0…1:
//   elbow bend → x (left = straight, right = bent)
//   arm lift   → y (bottom = down, top = lifted)
// The point is then blended exactly like the Vowel Morph square.
import { MAX_HARMONICS } from '../frequency/vowel-model.js';

// MediaPipe Pose landmark indices ("left"/"right" are the PERSON's sides).
export const LM = Object.freeze({ leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24 });
export const JOINT_NAMES = Object.freeze({ 11: 'left shoulder', 12: 'right shoulder', 13: 'left elbow', 14: 'right elbow', 15: 'left wrist', 16: 'right wrist', 23: 'left hip', 24: 'right hip' });
export const BEND_JOINTS = Object.freeze([LM.rightShoulder, LM.rightElbow, LM.rightWrist]);
export const LIFT_JOINTS = Object.freeze([LM.leftHip, LM.leftShoulder, LM.leftElbow]);
export const MIN_VISIBILITY = 0.5; // below this a joint counts as lost
export const LOST_GRACE_MS = 250; // a joint must be missing this long before the sound fades
export const SMOOTH_TAU = 0.08; // s, light smoothing of the angles
export const DEFAULT_CAL = Object.freeze({ bend: { lo: 15, hi: 130 }, lift: { lo: 15, hi: 120 } });
export const MIN_SPAN = 20; // degrees: a calibrated range is never narrower than this
export const CLAP_BUFFER = 0.06; // map units outside the clap region before it re-arms
export const CLAP_COOLDOWN_MS = 150;

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
const R2D = 180 / Math.PI;

/** Angle ABC in degrees at vertex B (points {x, y, z?}). */
export function angleAt(a, b, c) {
  const u = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const v = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const nu = Math.hypot(...u);
  const nv = Math.hypot(...v);
  if (!(nu > 1e-9) || !(nv > 1e-9)) return NaN;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * R2D;
}

/**
 * Joint angles from one frame of landmarks.
 *   lms     33 landmarks {x, y, z, visibility} (image coordinates, 0…1)
 *   world   optional 33 world landmarks in metres (better for angles; used when present)
 *   aspect  width / height of the image (2D fallback only)
 * Returns { bend, lift, lost: [joint names], ok }.
 */
export function poseAngles(lms, { world = null, aspect = 16 / 9, minVisibility = MIN_VISIBILITY } = {}) {
  const lost = [];
  if (!Array.isArray(lms) || lms.length < 25) {
    return { bend: NaN, lift: NaN, lost: [...BEND_JOINTS, ...LIFT_JOINTS].map((i) => JOINT_NAMES[i]), ok: false, noPerson: true };
  }
  const seen = (i) => lms[i] && Number.isFinite(lms[i].x) && Number.isFinite(lms[i].y) && (lms[i].visibility == null || lms[i].visibility >= minVisibility);
  for (const i of [...BEND_JOINTS, ...LIFT_JOINTS]) if (!seen(i)) lost.push(JOINT_NAMES[i]);
  const P = (i) => {
    if (world && world[i] && Number.isFinite(world[i].x)) return { x: world[i].x, y: world[i].y, z: world[i].z || 0 };
    return { x: lms[i].x * aspect, y: lms[i].y, z: 0 };
  };
  const bendOk = BEND_JOINTS.every(seen);
  const liftOk = LIFT_JOINTS.every(seen);
  const bend = bendOk ? 180 - angleAt(P(LM.rightShoulder), P(LM.rightElbow), P(LM.rightWrist)) : NaN;
  const lift = liftOk ? angleAt(P(LM.leftHip), P(LM.leftShoulder), P(LM.leftElbow)) : NaN;
  return { bend, lift, lost, ok: bendOk && liftOk && Number.isFinite(bend) && Number.isFinite(lift) };
}

/** Angles → map point using the calibrated ranges. Each angle drives one axis only. */
export function anglesToPoint({ bend, lift }, cal = DEFAULT_CAL) {
  return { x: clamp01((bend - cal.bend.lo) / (cal.bend.hi - cal.bend.lo)), y: clamp01((lift - cal.lift.lo) / (cal.lift.hi - cal.lift.lo)) };
}

/** Map point → the angles that reach it. */
export function pointToAngles(pt, cal = DEFAULT_CAL) {
  return { bend: cal.bend.lo + pt.x * (cal.bend.hi - cal.bend.lo), lift: cal.lift.lo + pt.y * (cal.lift.hi - cal.lift.lo) };
}

/** Median of a list of numbers (NaN for none). */
export function median(list) {
  const a = list.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** The held angles over a capture window (median of each), or null if too few readings. */
export function heldAngles(samples, minCount = 5) {
  const ok = samples.filter((s) => s && Number.isFinite(s.bend) && Number.isFinite(s.lift));
  if (ok.length < minCount) return null;
  return { bend: median(ok.map((s) => s.bend)), lift: median(ok.map((s) => s.lift)), count: ok.length };
}

/**
 * Calibration from the two held end poses:
 *   rest  = right arm straight, left arm down   → (0, 0) corner
 *   full  = right elbow bent, left arm lifted    → (1, 1) corner
 * Each range is kept at least MIN_SPAN wide (centred on the two readings).
 */
export function calibrate(rest, full, previous = DEFAULT_CAL) {
  const one = (lo, hi, prev) => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ...prev };
    if (hi < lo) [lo, hi] = [hi, lo];
    if (hi - lo < MIN_SPAN) { const c = (lo + hi) / 2; lo = c - MIN_SPAN / 2; hi = c + MIN_SPAN / 2; }
    return { lo: Math.round(lo * 10) / 10, hi: Math.round(hi * 10) / 10 };
  };
  return { bend: one(rest && rest.bend, full && full.bend, previous.bend), lift: one(rest && rest.lift, full && full.lift, previous.lift) };
}

/** Exponential smoothing of the angles (dt in seconds). */
export function smoothAngles(prev, next, dt, tau = SMOOTH_TAU) {
  if (!prev || !(dt > 0) || dt > 0.5) return { bend: next.bend, lift: next.lift };
  const a = 1 - Math.exp(-dt / tau);
  return { bend: prev.bend + a * (next.bend - prev.bend), lift: prev.lift + a * (next.lift - prev.lift) };
}

// ───────────── starter sounds ─────────────

/** Vowel-like harmonic strengths: −12 dB/octave source shaped by formant resonances. 48 values, strongest = 1. */
export function formantAmps(f0, formants) {
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (let n = 1; n <= MAX_HARMONICS; n++) {
    const f = n * f0;
    if (f > 8000) break;
    let res = 0.02;
    for (const [fc, bw, g] of formants) res += g / Math.sqrt(1 + ((f - fc) / (bw / 2)) ** 2);
    amps[n - 1] = res / n;
  }
  const top = Math.max(...amps);
  return amps.map((a) => { const v = a / top; return v < 10 ** (-50 / 20) ? 0 : Math.round(v * 1000) / 1000; });
}

// Average formants (Peterson & Barney 1952). The positions follow the class
// phrase: start "ah" (arm straight, left arm down), bend → "ee", lift → "oo".
// "eh" fills the remaining corner.
export const STARTERS = Object.freeze([
  { key: 'ah', name: 'Starter “ah”', pose: 'right arm straight, left arm down', f0: 196, pos: { x: 0.1, y: 0.1 }, formants: [[730, 90, 1], [1090, 110, 0.5], [2440, 170, 0.2]] },
  { key: 'ee', name: 'Starter “ee”', pose: 'right elbow bent, left arm down', f0: 220, pos: { x: 0.9, y: 0.1 }, formants: [[270, 60, 1], [2290, 120, 0.45], [3010, 170, 0.3]] },
  { key: 'oo', name: 'Starter “oo”', pose: 'right elbow bent, left arm lifted', f0: 175, pos: { x: 0.9, y: 0.9 }, formants: [[300, 60, 1], [870, 90, 0.35], [2240, 130, 0.1]] },
  { key: 'eh', name: 'Starter “eh”', pose: 'right arm straight, left arm lifted', f0: 208, pos: { x: 0.1, y: 0.9 }, formants: [[530, 70, 1], [1840, 110, 0.45], [2480, 160, 0.25]] },
]);

export function starterAnchors() {
  return STARTERS.map((s) => ({
    id: `starter-${s.key}`, name: s.name, source: 'starter', pose: s.pose, pos: { ...s.pos }, angles: null,
    analysis: { status: 'ok', f0: s.f0, amps: formantAmps(s.f0, s.formants) },
  }));
}

/** Where an anchor sits on the map now: taught anchors follow their angles through the current calibration. */
export function anchorPoint(a, cal = DEFAULT_CAL) {
  return a.angles ? anglesToPoint(a.angles, cal) : a.pos;
}

// ───────────── clap ─────────────

/**
 * Fires ONCE when the point enters the region; stays quiet while it is held
 * there; re-arms only after the point has left by more than `buffer`.
 */
export class RegionTrigger {
  constructor({ buffer = CLAP_BUFFER, cooldownMs = CLAP_COOLDOWN_MS } = {}) {
    this.buffer = buffer;
    this.cooldownMs = cooldownMs;
    this.inside = false;
    this.last = -Infinity;
    this.count = 0;
  }

  /** Marks the current state without firing (when the clap is switched on, or tracking returns). */
  prime(pt, region) {
    this.inside = Math.hypot(pt.x - region.x, pt.y - region.y) <= region.r;
  }

  update(pt, region, nowMs) {
    const d = Math.hypot(pt.x - region.x, pt.y - region.y);
    if (!this.inside && d <= region.r) {
      this.inside = true;
      if (nowMs - this.last >= this.cooldownMs) { this.last = nowMs; this.count++; return true; }
    } else if (this.inside && d > region.r + this.buffer) this.inside = false;
    return false;
  }
}

// ───────────── project ─────────────

export const PROJECT_KEY = 'poseMap.project.v1';

export function emptyProject() {
  return { version: 1, anchors: starterAnchors(), cal: JSON.parse(JSON.stringify(DEFAULT_CAL)), clap: { on: false, region: { x: 0.9, y: 0.9, r: 0.16 } }, power: 2 };
}

export function cleanAnchor(a) {
  if (!a || typeof a !== 'object' || !a.analysis) return null;
  const f0 = Number(a.analysis.f0);
  if (!(f0 > 0) || !Array.isArray(a.analysis.amps)) return null;
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (let i = 0; i < MAX_HARMONICS && i < a.analysis.amps.length; i++) { const v = Number(a.analysis.amps[i]); amps[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  if (!amps.some((v) => v > 0)) return null;
  const angles = a.angles && Number.isFinite(+a.angles.bend) && Number.isFinite(+a.angles.lift) ? { bend: +a.angles.bend, lift: +a.angles.lift } : null;
  const pos = a.pos && Number.isFinite(+a.pos.x) && Number.isFinite(+a.pos.y) ? { x: clamp01(+a.pos.x), y: clamp01(+a.pos.y) } : null;
  if (!angles && !pos) return null;
  return {
    id: String(a.id || `pm-${Math.random().toString(36).slice(2, 10)}`),
    name: String(a.name || 'Sound').slice(0, 40),
    source: ['starter', 'recorded', 'vowel-morph'].includes(a.source) ? a.source : 'recorded',
    pose: a.pose ? String(a.pose).slice(0, 80) : '',
    pos, angles,
    analysis: { status: 'ok', f0, amps },
  };
}

export function loadProject(raw) {
  const p = emptyProject();
  if (!raw || typeof raw !== 'object') return p;
  if (Array.isArray(raw.anchors)) p.anchors = raw.anchors.map(cleanAnchor).filter(Boolean);
  const c = raw.cal || {};
  const rng = (r, d) => (r && Number.isFinite(+r.lo) && Number.isFinite(+r.hi) && +r.hi - +r.lo >= MIN_SPAN - 1e-9 ? { lo: +r.lo, hi: +r.hi } : { ...d });
  p.cal = { bend: rng(c.bend, DEFAULT_CAL.bend), lift: rng(c.lift, DEFAULT_CAL.lift) };
  const cl = raw.clap || {};
  const r = cl.region || {};
  p.clap = { on: cl.on === true, region: { x: clamp01(Number.isFinite(+r.x) ? +r.x : 0.9), y: clamp01(Number.isFinite(+r.y) ? +r.y : 0.9), r: Math.min(0.4, Math.max(0.05, Number(r.r) || 0.16)) } };
  p.power = [1, 2, 4].includes(raw.power) ? raw.power : 2;
  return p;
}

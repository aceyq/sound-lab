// Pose Sound Map (capstone part 3): pure logic, no DOM, camera or Web Audio,
// so it is unit-tested with `npm test`.
//
// Two JOINT ANGLES from the camera's body landmarks (not x/y positions):
//   right elbow bend = 180° − (angle at the right elbow between the right
//                      shoulder and the right wrist); 0° = arm straight.
//                      Measured from the image with a depth correction for a
//                      forearm that points toward the camera (elbowBend()).
//   left arm lift    = angle at the left shoulder between the left hip and
//                      the left elbow; about 10–20° = arm hanging down,
//                      90° = straight out to the side, 180° = overhead
// Each is scaled between the two calibrated ends of its range to 0…1:
//   elbow bend → x (left = straight, right = bent)
//   arm lift   → y (bottom = down, top = lifted)
// The point is then blended exactly like the Vowel Morph square.
//
// Range. DEFAULT_CAL is a range most people reach without any setup, so the
// map is playable as soon as the camera sees both arms. "Adjust to my
// movement" (estimateRange) replaces it with the range a person actually
// used while moving freely for a few seconds; scaleRange / setRangeEnd are
// the small manual tweaks afterwards.
//
// Saved poses and the range. A sound the person placed (by holding a pose,
// by clicking the map, or by drawing a take) is stored as the two ANGLES of
// that pose, never as a map position. Its dot is drawn at
// anglesToPoint(angles, range), so when the range changes the dot moves on
// the map, but holding the same pose still lands exactly on it and plays
// exactly that sound. Starter sounds are the exception: they are defined
// relative to the range (its corners), so they keep their map position.
import { MAX_HARMONICS } from '../frequency/vowel-model.js';
import { cleanBands } from './pose-sound.js';

// MediaPipe Pose landmark indices ("left"/"right" are the PERSON's sides).
export const LM = Object.freeze({ leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24 });
export const JOINT_NAMES = Object.freeze({ 11: 'left shoulder', 12: 'right shoulder', 13: 'left elbow', 14: 'right elbow', 15: 'left wrist', 16: 'right wrist', 23: 'left hip', 24: 'right hip' });
export const BEND_JOINTS = Object.freeze([LM.rightShoulder, LM.rightElbow, LM.rightWrist]);
export const LIFT_JOINTS = Object.freeze([LM.leftHip, LM.leftShoulder, LM.leftElbow]);
export const MIN_VISIBILITY = 0.5; // below this a joint counts as lost
export const LOST_GRACE_MS = 250; // a joint must be missing this long before the sound fades
export const SMOOTH_TAU = 0.08; // s, light smoothing of the angles
// Comfortable default: arm relaxed (≈10°) to a right-angle bend (≈100°).
export const DEFAULT_CAL = Object.freeze({ bend: { lo: 10, hi: 100 }, lift: { lo: 15, hi: 120 } });
// The default before November 23, 2026 (needed a nearly full curl to reach the right edge).
export const OLD_DEFAULT_CAL = Object.freeze({ bend: { lo: 15, hi: 130 }, lift: { lo: 15, hi: 120 } });
// Forearm (elbow→wrist) length ÷ upper arm (shoulder→elbow) length of a
// straight arm in MediaPipe landmarks. ForeRatio learns the person's own value.
export const FORE_RATIO_DEFAULT = 0.9;
export const FORE_RATIO_LIMITS = Object.freeze([0.7, 1.1]);
export const LOW_CONFIDENCE = 0.75; // visibility below this (but above MIN_VISIBILITY): "tracking is unreliable"
export const EDGE_MARGIN = 0.02; // a landmark further than this outside the picture is guessed, not seen
export const MAX_JUMP_DEG = 60; // a single-frame jump bigger than this is held back until a 2nd frame confirms it
export const MIN_SPAN = 20; // degrees: a calibrated range is never narrower than this
export const ANGLE_LIMITS = Object.freeze({ bend: [0, 170], lift: [0, 180] }); // what the joints can physically reach
export const MIN_MOVE = 15; // degrees: an angle that moved less than this while adjusting keeps its old range
export const MIN_ADJUST_SAMPLES = 30; // tracked frames needed to estimate a range (≈ 1 s of camera)
export const RANGE_PCT = [5, 95]; // percentiles used as the ends, so a stray frame or a strained extreme does not set the range
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
 * Right elbow bend from 2D image points S (shoulder), E (elbow), W (wrist),
 * x already scaled by the image aspect. When the forearm points toward (or
 * away from) the camera, it looks SHORTER in the picture than it is, and its
 * direction in the picture says little about the bend. The forearm's
 * expected length is foreRatio × upper-arm length; the missing length is
 * treated as depth:
 *   depth = √(expected² − seen²)   (0 when the forearm looks full length)
 *   bend  = 180° − angle(upper arm, (forearm x, forearm y, depth))
 * So a forearm pointing straight at the camera reads ≈ 90°, which the plain
 * picture angle cannot show. Returns { bend, imageBend, depthShare }.
 */
export function elbowBend(S, E, W, foreRatio = FORE_RATIO_DEFAULT) {
  const ux = S.x - E.x; const uy = S.y - E.y;
  const fx = W.x - E.x; const fy = W.y - E.y;
  const lu = Math.hypot(ux, uy);
  const lf = Math.hypot(fx, fy);
  if (!(lu > 1e-6)) return { bend: NaN, imageBend: NaN, depthShare: 0 };
  const imageBend = lf > 1e-6 ? 180 - angleAt(S, E, W) : NaN;
  const expected = foreRatio * lu;
  const depth = lf < expected ? Math.sqrt(expected * expected - lf * lf) : 0;
  const bend = 180 - angleAt({ x: ux, y: uy, z: 0 }, { x: 0, y: 0, z: 0 }, { x: fx, y: fy, z: depth });
  return { bend, imageBend, depthShare: expected > 0 ? depth / expected : 0 };
}

/** Learns the person's straight-arm forearm ÷ upper-arm ratio (95th percentile of the last ~10 s). */
export class ForeRatio {
  constructor() { this.samples = []; }
  add(ratio, tMs) {
    if (!(ratio > 0.3 && ratio < 1.6)) return;
    this.samples.push({ r: ratio, t: tMs });
    while (this.samples.length && this.samples[0].t < tMs - 10000) this.samples.shift();
  }
  get value() {
    if (this.samples.length < 15) return FORE_RATIO_DEFAULT;
    const v = percentile(this.samples.map((s) => s.r), 95);
    return Math.min(FORE_RATIO_LIMITS[1], Math.max(FORE_RATIO_LIMITS[0], Math.max(v, FORE_RATIO_DEFAULT * 0.9)));
  }
}

/**
 * Joint angles from one frame of landmarks.
 *   lms        33 landmarks {x, y, z, visibility} (image coordinates, 0…1)
 *   world      optional world landmarks (metres); used for the left arm lift only
 *   aspect     width / height of the image
 *   foreRatio  straight-arm forearm ÷ upper-arm ratio (ForeRatio)
 * A joint counts as LOST when its visibility is below MIN_VISIBILITY or it is
 * outside the picture (MediaPipe still guesses a position there, which would
 * send the marker somewhere random). The bend then is NaN, never a guess.
 * Returns { bend, lift, lost: [joint names], ok, imageBend, depthShare, ratio, weak: [joint names] }.
 */
export function poseAngles(lms, { world = null, aspect = 16 / 9, minVisibility = MIN_VISIBILITY, foreRatio = FORE_RATIO_DEFAULT } = {}) {
  const lost = [];
  if (!Array.isArray(lms) || lms.length < 25) {
    return { bend: NaN, lift: NaN, lost: [...BEND_JOINTS, ...LIFT_JOINTS].map((i) => JOINT_NAMES[i]), weak: [], ok: false, noPerson: true };
  }
  const inPicture = (p) => p.x >= -EDGE_MARGIN && p.x <= 1 + EDGE_MARGIN && p.y >= -EDGE_MARGIN && p.y <= 1 + EDGE_MARGIN;
  const seen = (i) => lms[i] && Number.isFinite(lms[i].x) && Number.isFinite(lms[i].y) && (lms[i].visibility == null || lms[i].visibility >= minVisibility) && inPicture(lms[i]);
  const weak = [];
  for (const i of [...BEND_JOINTS, ...LIFT_JOINTS]) {
    if (!seen(i)) lost.push(JOINT_NAMES[i]);
    else if (lms[i].visibility != null && lms[i].visibility < LOW_CONFIDENCE) weak.push(JOINT_NAMES[i]);
  }
  const img = (i) => ({ x: lms[i].x * aspect, y: lms[i].y, z: 0 });
  const P = (i) => {
    if (world && world[i] && Number.isFinite(world[i].x)) return { x: world[i].x, y: world[i].y, z: world[i].z || 0 };
    return img(i);
  };
  const bendOk = BEND_JOINTS.every(seen);
  const liftOk = LIFT_JOINTS.every(seen);
  let bend = NaN; let imageBend = NaN; let depthShare = 0; let ratio = NaN;
  if (bendOk) {
    const S = img(LM.rightShoulder); const E = img(LM.rightElbow); const W = img(LM.rightWrist);
    const eb = elbowBend(S, E, W, foreRatio);
    bend = eb.bend; imageBend = eb.imageBend; depthShare = eb.depthShare;
    const lu = Math.hypot(S.x - E.x, S.y - E.y);
    ratio = lu > 1e-6 ? Math.hypot(W.x - E.x, W.y - E.y) / lu : NaN;
  }
  const lift = liftOk ? angleAt(P(LM.leftHip), P(LM.leftShoulder), P(LM.leftElbow)) : NaN;
  return { bend, lift, lost, weak, imageBend, depthShare, ratio, ok: bendOk && liftOk && Number.isFinite(bend) && Number.isFinite(lift) };
}

/**
 * Holds back a single-frame jump: a change of more than MAX_JUMP_DEG from the
 * last accepted reading is only accepted when the next frame agrees.
 * state = { last: {bend, lift} | null, pending: {bend, lift} | null }. Returns the angles to use or null (skip this frame).
 */
export function jumpGuard(state, raw) {
  const far = (a, b) => Math.abs(a.bend - b.bend) > MAX_JUMP_DEG || Math.abs(a.lift - b.lift) > MAX_JUMP_DEG;
  if (!state.last || !far(state.last, raw)) { state.last = { bend: raw.bend, lift: raw.lift }; state.pending = null; return state.last; }
  if (state.pending && !far(state.pending, raw)) { state.last = { bend: raw.bend, lift: raw.lift }; state.pending = null; return state.last; }
  state.pending = { bend: raw.bend, lift: raw.lift };
  return null;
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

/** p-th percentile (0…100) with linear interpolation; NaN for no data. */
export function percentile(list, p) {
  const a = list.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const k = (Math.max(0, Math.min(100, p)) / 100) * (a.length - 1);
  const i = Math.floor(k);
  return i + 1 < a.length ? a[i] + (k - i) * (a[i + 1] - a[i]) : a[i];
}

const r1 = (v) => Math.round(v * 10) / 10;

/** A range kept inside the joint limits and at least MIN_SPAN wide. */
export function fixRange({ lo, hi }, key) {
  const [min, max] = ANGLE_LIMITS[key];
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi - lo < MIN_SPAN) { const c = (lo + hi) / 2; lo = c - MIN_SPAN / 2; hi = c + MIN_SPAN / 2; }
  if (lo < min) { hi += min - lo; lo = min; }
  if (hi > max) { lo -= hi - max; hi = max; }
  return { lo: r1(Math.max(min, lo)), hi: r1(Math.min(max, hi)) };
}

/**
 * "Adjust to my movement": the usable range from angles read while the person
 * moved comfortably. Each end is the 5th / 95th percentile of what was seen.
 * An angle that hardly moved (< MIN_MOVE) keeps its previous range, so moving
 * only one arm does not squash the other axis.
 * Returns { ok, cal, report: { bend, lift: { seen: [lo, hi], moved, kept } }, count, message }.
 */
export function estimateRange(samples, previous = DEFAULT_CAL) {
  const ok = (samples || []).filter((s) => s && Number.isFinite(s.bend) && Number.isFinite(s.lift));
  if (ok.length < MIN_ADJUST_SAMPLES) {
    return { ok: false, cal: previous, count: ok.length, report: null, message: `Only ${ok.length} camera readings had both arms in view (at least ${MIN_ADJUST_SAMPLES} are needed). The range was not changed.` };
  }
  const report = {};
  const cal = {};
  for (const key of ['bend', 'lift']) {
    const vals = ok.map((s) => s[key]);
    const lo = percentile(vals, RANGE_PCT[0]);
    const hi = percentile(vals, RANGE_PCT[1]);
    const moved = hi - lo;
    const kept = moved < MIN_MOVE;
    cal[key] = kept ? { ...previous[key] } : fixRange({ lo, hi }, key);
    report[key] = { seen: [r1(lo), r1(hi)], moved: r1(moved), kept };
  }
  return { ok: true, cal, count: ok.length, report, message: '' };
}

/** Widen (factor > 1, less sensitive) or narrow (factor < 1, easier to reach the edges) a range around its centre. */
export function scaleRange(range, factor, key) {
  const c = (range.lo + range.hi) / 2;
  const half = ((range.hi - range.lo) / 2) * factor;
  return fixRange({ lo: c - half, hi: c + half }, key);
}

/** Moves one end of a range (end = 'lo' | 'hi'), keeping it valid. */
export function setRangeEnd(range, end, value, key) {
  const r = { ...range, [end]: Number(value) };
  if (end === 'lo' && r.lo > r.hi - MIN_SPAN) r.lo = r.hi - MIN_SPAN;
  if (end === 'hi' && r.hi < r.lo + MIN_SPAN) r.hi = r.lo + MIN_SPAN;
  return fixRange(r, key);
}

/** How far 10° of movement moves the marker, in % of the map side. */
export function percentPer10Deg(range) {
  return 1000 / (range.hi - range.lo);
}

/** Is a saved pose inside the current range? (Outside it, its dot is pinned to the edge.) */
export function poseInRange(angles, cal) {
  const inside = (v, r) => v >= r.lo - 1e-9 && v <= r.hi + 1e-9;
  return inside(angles.bend, cal.bend) && inside(angles.lift, cal.lift);
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

// Version 3: the map starts EMPTY. Every sound comes from the person's own
// recordings:
//   sounds  the recording library: { id, name, source, audioId, analysis,
//           createdAt, place } where place = { angles, placedBy } when the
//           sound is on the map, or null when it is only in the library
//   takes   drawn takes; `hidden` = in the library but not on the map
// "Clear map" takes everything off the map but keeps the library, so any
// recording can be placed again; deleting a recording is a separate action.
export function emptyProject() {
  return { version: 4, sounds: [], takes: [], cal: JSON.parse(JSON.stringify(DEFAULT_CAL)), calSource: 'default', clap: { on: false, region: { x: 0.9, y: 0.9, r: 0.16 } }, power: 2 };
}

/** A clean library sound (null if it has no playable analysis). */
export function cleanSound(x, cal = DEFAULT_CAL) {
  const a = cleanAnchor(x);
  if (!a && !(x && x.analysis)) return null;
  const base = a || cleanAnchor({ ...x, pos: { x: 0, y: 0 } });
  if (!base) return null;
  let place = null;
  const pl = x.place;
  if (pl && pl.angles && Number.isFinite(+pl.angles.bend) && Number.isFinite(+pl.angles.lift)) place = { angles: { bend: +pl.angles.bend, lift: +pl.angles.lift }, placedBy: pl.placedBy === 'click' ? 'click' : 'pose' };
  else if (x.place === undefined && base.angles) place = { angles: base.angles, placedBy: base.placedBy }; // v1/v2 anchor
  else if (x.place === undefined && x.pos && a) place = { angles: pointToAngles(base.pos, cal), placedBy: 'click' };
  return {
    id: base.id, name: base.name, source: base.source === 'vowel-morph' ? 'vowel-morph' : 'recorded',
    audioId: x.audioId ? String(x.audioId) : base.recordingId,
    analysis: base.analysis, createdAt: x.createdAt || new Date(0).toISOString(), place,
  };
}

/** The sounds that are on the map, as anchors blendAt() understands (pos through `cal`). */
export function placedSounds(sounds, cal = DEFAULT_CAL) {
  return (sounds || []).filter((s) => s.place).map((s) => ({ id: s.id, name: s.name, src: s, angles: s.place.angles, pos: anglesToPoint(s.place.angles, cal), analysis: s.analysis }));
}

/** Clear map: nothing stays on the map, every recording stays in the library. */
export function clearMap(project) {
  let sounds = 0;
  let takes = 0;
  for (const s of project.sounds) if (s.place) { s.place = null; sounds++; }
  for (const t of project.takes) if (!t.hidden) { t.hidden = true; takes++; }
  return { sounds, takes };
}

/** A clean analysis: pitched { kind, status, f0, amps } or noise { kind: 'noise', status, f0: null, amps: [], noise: { bands } } (null if unplayable). */
export function cleanAnalysis(an) {
  if (!an || typeof an !== 'object') return null;
  const sm = an.summary && typeof an.summary === 'object' ? { summary: JSON.parse(JSON.stringify(an.summary)) } : {};
  if (an.kind === 'noise') {
    const bands = cleanBands(an.noise && an.noise.bands);
    if (!bands.some((v) => v > 0)) return null;
    return { kind: 'noise', status: 'ok', f0: null, amps: [], noise: { bands }, ...sm };
  }
  const f0 = Number(an.f0);
  if (!(f0 > 0) || !Array.isArray(an.amps)) return null;
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (let i = 0; i < MAX_HARMONICS && i < an.amps.length; i++) { const v = Number(an.amps[i]); amps[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  if (!amps.some((v) => v > 0)) return null;
  if (an.kind === 'mixed' && an.noise && Array.isArray(an.noise.bands)) {
    const bands = cleanBands(an.noise.bands);
    const v = Number(an.voiced);
    if (bands.some((b) => b > 0)) return { kind: 'mixed', status: an.status === 'warning' ? 'warning' : 'ok', f0, amps, voiced: Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5, noise: { bands }, ...sm };
  }
  return { kind: 'pitched', status: an.status === 'warning' ? 'warning' : 'ok', f0, amps, ...sm };
}

export function cleanAnchor(a) {
  if (!a || typeof a !== 'object' || !a.analysis) return null;
  const analysis = cleanAnalysis(a.analysis);
  if (!analysis) return null;
  const angles = a.angles && Number.isFinite(+a.angles.bend) && Number.isFinite(+a.angles.lift) ? { bend: +a.angles.bend, lift: +a.angles.lift } : null;
  const pos = a.pos && Number.isFinite(+a.pos.x) && Number.isFinite(+a.pos.y) ? { x: clamp01(+a.pos.x), y: clamp01(+a.pos.y) } : null;
  if (!angles && !pos) return null;
  const source = ['starter', 'recorded', 'vowel-morph'].includes(a.source) ? a.source : 'recorded';
  const placedBy = ['pose', 'click'].includes(a.placedBy) ? a.placedBy : 'pose';
  return {
    id: String(a.id || `pm-${Math.random().toString(36).slice(2, 10)}`),
    name: String(a.name || 'Sound').slice(0, 40),
    source,
    pose: a.pose ? String(a.pose).slice(0, 80) : '',
    // Starters live at a map position; everything a person placed lives at a pose (angles).
    pos: source === 'starter' || !angles ? pos : null,
    angles: source === 'starter' && pos ? null : angles,
    placedBy,
    recordingId: a.recordingId ? String(a.recordingId) : null,
    analysis,
  };
}

// ───────────── drawn takes on the pose map ─────────────
// A take is drawn with the mouse on the map, but it is stored like every
// other personal sound: each pointer sample and each learned point is
// converted to the two angles that reach it with the range in use while
// drawing. Learned points then follow the range exactly like placed sounds.

/** Converts a Vowel Morph style take (map x/y) to pose angles with `cal`. */
export function takeToAngles(take, cal) {
  const A = (p) => { const a = pointToAngles(p, cal); return { bend: r1(a.bend), lift: r1(a.lift) }; };
  return {
    ...take,
    path: take.path.map((p) => ({ ...A(p), t: p.t })),
    points: take.points.map((p) => ({ ...A(p), t: p.t, kind: p.kind || 'pitched', voiced: p.voiced ?? 1, f0: p.f0, amps: p.amps, bands: p.bands || null, status: p.status })),
  };
}

/** Learned points of the visible takes as anchors blendAt() understands, placed through `cal`. */
export function poseTakeAnchors(takes, cal = DEFAULT_CAL) {
  const out = [];
  for (const take of takes || []) {
    if (take.hidden) continue;
    take.points.forEach((p, i) => out.push({
      id: `${take.id}#${i}`, takeId: take.id, name: `${take.name} · ${(p.t / 1000).toFixed(1)} s`,
      angles: { bend: p.bend, lift: p.lift }, pos: anglesToPoint(p, cal), analysis: { status: 'ok', kind: p.kind || 'pitched', voiced: p.voiced ?? 1, f0: p.f0, amps: p.amps, bands: p.bands || null },
    }));
  }
  return out;
}

export function cleanPoseTake(t) {
  if (!t || typeof t !== 'object') return null;
  const num = (v) => Number.isFinite(+v);
  const amps = (a) => { const out = new Array(MAX_HARMONICS).fill(0); for (let i = 0; i < MAX_HARMONICS && i < a.length; i++) { const v = Number(a[i]); out[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; } return out; };
  // A point is pitched (f0 + harmonics), noise (bands, no f0) or mixed (both, voiced share 0…1).
  const okPoint = (p) => {
    if (!p || !num(p.bend) || !num(p.lift)) return false;
    const pitched = num(p.f0) && +p.f0 > 0 && Array.isArray(p.amps);
    const noisy = Array.isArray(p.bands) && p.bands.some((v) => +v > 0);
    if (p.kind === 'noise') return noisy;
    if (p.kind === 'mixed') return pitched && noisy;
    return pitched;
  };
  const points = (Array.isArray(t.points) ? t.points : []).filter(okPoint).map((p) => {
    const kind = p.kind === 'noise' || p.kind === 'mixed' ? p.kind : 'pitched';
    return {
      bend: +p.bend, lift: +p.lift, t: num(p.t) ? +p.t : 0, kind,
      voiced: kind === 'noise' ? 0 : kind === 'mixed' ? Math.max(0, Math.min(1, num(p.voiced) ? +p.voiced : 0.5)) : 1,
      f0: kind === 'noise' ? null : +p.f0, amps: kind === 'noise' ? new Array(MAX_HARMONICS).fill(0) : amps(p.amps),
      bands: kind === 'pitched' ? null : cleanBands(p.bands), status: p.status === 'warning' ? 'warning' : 'ok',
    };
  });
  const path = (Array.isArray(t.path) ? t.path : []).filter((p) => p && num(p.bend) && num(p.lift) && num(p.t)).map((p) => ({ bend: +p.bend, lift: +p.lift, t: +p.t }));
  const s = t.stats || {};
  return {
    id: String(t.id || `take-${Math.random().toString(36).slice(2, 10)}`),
    name: String(t.name || 'Take').slice(0, 40),
    recordingId: t.recordingId ? String(t.recordingId) : null,
    createdAt: t.createdAt || new Date().toISOString(),
    durationSec: num(t.durationSec) ? +t.durationSec : 0,
    path, points,
    stats: { snippets: +s.snippets || 0, usable: points.length, pitched: points.filter((q) => q.kind === 'pitched').length, mixed: points.filter((q) => q.kind === 'mixed').length, noise: points.filter((q) => q.kind === 'noise').length, silent: +s.silent || 0, unreliable: +s.unreliable || 0, outsidePath: +s.outsidePath || 0 },
    hidden: t.hidden === true,
    // 1 = analyzed pitch-only (noisy snippets were skipped); 2 = pitched + noise
    analysisVersion: +t.analysisVersion === 2 ? 2 : 1,
    ...(num(t.startOffsetMs) ? { startOffsetMs: +t.startOffsetMs } : {}),
  };
}

export function loadProject(raw) {
  const p = emptyProject();
  if (!raw || typeof raw !== 'object') return p;
  const c = raw.cal || {};
  const rng = (r, d) => (r && Number.isFinite(+r.lo) && Number.isFinite(+r.hi) && +r.hi - +r.lo >= MIN_SPAN - 1e-9 ? { lo: +r.lo, hi: +r.hi } : { ...d });
  p.cal = { bend: rng(c.bend, DEFAULT_CAL.bend), lift: rng(c.lift, DEFAULT_CAL.lift) };
  p.calSource = ['default', 'adjusted', 'custom'].includes(raw.calSource) ? raw.calSource : 'default';
  if (raw.migratedFrom && typeof raw.migratedFrom === 'object') p.migratedFrom = JSON.parse(JSON.stringify(raw.migratedFrom));
  // Older projects kept sounds as "anchors", including automatic starter vowels; starters are dropped.
  const list = Array.isArray(raw.sounds) ? raw.sounds : Array.isArray(raw.anchors) ? raw.anchors.filter((a) => a && a.source !== 'starter') : [];
  p.sounds = list.map((x) => cleanSound(x, p.cal)).filter(Boolean);
  if (Array.isArray(raw.takes)) p.takes = raw.takes.map(cleanPoseTake).filter(Boolean);
  const cl = raw.clap || {};
  const r = cl.region || {};
  p.clap = { on: cl.on === true, region: { x: clamp01(Number.isFinite(+r.x) ? +r.x : 0.9), y: clamp01(Number.isFinite(+r.y) ? +r.y : 0.9), r: Math.min(0.4, Math.max(0.05, Number(r.r) || 0.16)) } };
  p.power = [1, 2, 4].includes(raw.power) ? raw.power : 2;
  if (!(Number(raw.version) >= 4) && (p.sounds.length || p.takes.length || raw.cal)) migrateToV4(p);
  return p;
}

/**
 * One-time update of maps saved before version 4 (November 23, 2026). Their
 * poses were measured without the depth correction (elbowBend) and against
 * the old range, so the stored angles no longer describe the same arm
 * position. The map itself is kept: every sound and take stays at the map
 * position it had, its angles are re-derived for the new default range, and
 * the range goes back to the (new) default. The page keeps a backup of the
 * old map before saving. Recordings (audio) are not touched.
 */
export function migrateToV4(p) {
  const oldCal = p.cal;
  const newCal = JSON.parse(JSON.stringify(DEFAULT_CAL));
  const move = (a) => { const q = pointToAngles(anglesToPoint(a, oldCal), newCal); return { bend: r1(q.bend), lift: r1(q.lift) }; };
  for (const s of p.sounds) if (s.place) s.place = { ...s.place, angles: move(s.place.angles) };
  for (const t of p.takes) {
    t.path = t.path.map((q) => ({ ...q, ...move(q) }));
    t.points = t.points.map((q) => ({ ...q, ...move(q) }));
  }
  p.migratedFrom = { version: 3, cal: oldCal, at: new Date().toISOString() };
  p.cal = newCal;
  p.calSource = 'default';
  return p;
}

// ───────────── plain-language pose hints ─────────────

/** A pose in words, for "how to play it" hints. */
export function describePose({ bend, lift }) {
  const b = bend < 25 ? 'right arm nearly straight' : bend < 65 ? 'right elbow a little bent' : bend < 105 ? 'right elbow bent about halfway' : 'right elbow bent tightly';
  const l = lift < 30 ? 'left arm down by your side' : lift < 70 ? 'left arm partly raised' : lift < 110 ? 'left arm out to the side' : 'left arm raised high';
  return `${b} (${Math.round(bend)}°), ${l} (${Math.round(lift)}°)`;
}

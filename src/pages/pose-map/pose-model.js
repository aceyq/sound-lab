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
  return { version: 3, sounds: [], takes: [], cal: JSON.parse(JSON.stringify(DEFAULT_CAL)), calSource: 'default', clap: { on: false, region: { x: 0.9, y: 0.9, r: 0.16 } }, power: 2 };
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
  const source = ['starter', 'recorded', 'vowel-morph'].includes(a.source) ? a.source : 'recorded';
  const placedBy = ['pose', 'click'].includes(a.placedBy) ? a.placedBy : 'pose';
  const sm = a.analysis.summary && typeof a.analysis.summary === 'object' ? a.analysis.summary : null;
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
    analysis: { status: a.analysis.status === 'warning' ? 'warning' : 'ok', f0, amps, ...(sm ? { summary: JSON.parse(JSON.stringify(sm)) } : {}) },
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
    points: take.points.map((p) => ({ ...A(p), t: p.t, f0: p.f0, amps: p.amps, status: p.status })),
  };
}

/** Learned points of the visible takes as anchors blendAt() understands, placed through `cal`. */
export function poseTakeAnchors(takes, cal = DEFAULT_CAL) {
  const out = [];
  for (const take of takes || []) {
    if (take.hidden) continue;
    take.points.forEach((p, i) => out.push({
      id: `${take.id}#${i}`, takeId: take.id, name: `${take.name} · ${(p.t / 1000).toFixed(1)} s`,
      angles: { bend: p.bend, lift: p.lift }, pos: anglesToPoint(p, cal), analysis: { status: 'ok', f0: p.f0, amps: p.amps },
    }));
  }
  return out;
}

export function cleanPoseTake(t) {
  if (!t || typeof t !== 'object') return null;
  const num = (v) => Number.isFinite(+v);
  const amps = (a) => { const out = new Array(MAX_HARMONICS).fill(0); for (let i = 0; i < MAX_HARMONICS && i < a.length; i++) { const v = Number(a[i]); out[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; } return out; };
  const points = (Array.isArray(t.points) ? t.points : []).filter((p) => p && num(p.bend) && num(p.lift) && num(p.f0) && +p.f0 > 0 && Array.isArray(p.amps))
    .map((p) => ({ bend: +p.bend, lift: +p.lift, t: num(p.t) ? +p.t : 0, f0: +p.f0, amps: amps(p.amps), status: p.status === 'warning' ? 'warning' : 'ok' }));
  const path = (Array.isArray(t.path) ? t.path : []).filter((p) => p && num(p.bend) && num(p.lift) && num(p.t)).map((p) => ({ bend: +p.bend, lift: +p.lift, t: +p.t }));
  const s = t.stats || {};
  return {
    id: String(t.id || `take-${Math.random().toString(36).slice(2, 10)}`),
    name: String(t.name || 'Take').slice(0, 40),
    recordingId: t.recordingId ? String(t.recordingId) : null,
    createdAt: t.createdAt || new Date().toISOString(),
    durationSec: num(t.durationSec) ? +t.durationSec : 0,
    path, points,
    stats: { snippets: +s.snippets || 0, usable: points.length, silent: +s.silent || 0, unreliable: +s.unreliable || 0, outsidePath: +s.outsidePath || 0 },
    hidden: t.hidden === true,
  };
}

export function loadProject(raw) {
  const p = emptyProject();
  if (!raw || typeof raw !== 'object') return p;
  const c = raw.cal || {};
  const rng = (r, d) => (r && Number.isFinite(+r.lo) && Number.isFinite(+r.hi) && +r.hi - +r.lo >= MIN_SPAN - 1e-9 ? { lo: +r.lo, hi: +r.hi } : { ...d });
  p.cal = { bend: rng(c.bend, DEFAULT_CAL.bend), lift: rng(c.lift, DEFAULT_CAL.lift) };
  p.calSource = ['default', 'adjusted', 'custom'].includes(raw.calSource) ? raw.calSource : 'default';
  // Older projects kept sounds as "anchors", including automatic starter vowels; starters are dropped.
  const list = Array.isArray(raw.sounds) ? raw.sounds : Array.isArray(raw.anchors) ? raw.anchors.filter((a) => a && a.source !== 'starter') : [];
  p.sounds = list.map((x) => cleanSound(x, p.cal)).filter(Boolean);
  if (Array.isArray(raw.takes)) p.takes = raw.takes.map(cleanPoseTake).filter(Boolean);
  const cl = raw.clap || {};
  const r = cl.region || {};
  p.clap = { on: cl.on === true, region: { x: clamp01(Number.isFinite(+r.x) ? +r.x : 0.9), y: clamp01(Number.isFinite(+r.y) ? +r.y : 0.9), r: Math.min(0.4, Math.max(0.05, Number(r.r) || 0.16)) } };
  p.power = [1, 2, 4].includes(raw.power) ? raw.power : 2;
  return p;
}

// ───────────── plain-language pose hints ─────────────

/** A pose in words, for "how to play it" hints. */
export function describePose({ bend, lift }) {
  const b = bend < 25 ? 'right arm nearly straight' : bend < 65 ? 'right elbow a little bent' : bend < 105 ? 'right elbow bent about halfway' : 'right elbow bent tightly';
  const l = lift < 30 ? 'left arm down by your side' : lift < 70 ? 'left arm partly raised' : lift < 110 ? 'left arm out to the side' : 'left arm raised high';
  return `${b} (${Math.round(bend)}°), ${l} (${Math.round(lift)}°)`;
}

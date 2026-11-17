// Pose Sound Map (capstone part 3): pure logic, no DOM, camera or Web Audio,
// so it is unit-tested with `npm test`.
//
// Two JOINT ANGLES from the camera's body landmarks (not x/y positions):
//   right elbow bend = 180° − (angle at the right elbow between the right
//                      shoulder and the right wrist); 0° = arm straight.
//                      → x on the map = WHICH VOWEL (columns ah | ee | oo).
//   head tilt        = signed angle between the ear-to-ear line and the
//                      shoulder-to-shoulder line. Because it is measured
//                      relative to the shoulders, sliding the whole body
//                      sideways (or leaning) does not change it.
//                      → y on the map = PITCH (rows low | middle | high).
//
// The starter map is a grid: one column per vowel (the same harmonic
// strengths in every row) and one row per pitch (the same f0 across a row).
// Between dots the weights are "tensor-product" (bilinear) weights:
//   weight(column c, row r) = u_c(x) · v_r(y)
// where u is plain linear interpolation between neighbouring column centres
// and v the same between row centres. Each weight is between 0 and 1, they
// add up to 1, and a pose exactly on a dot gives that dot 100 %. Because the
// row shares v_r depend only on y and the column shares u_c only on x:
//   f0      = Σ_r v_r(y) · f0_r          → depends ONLY on head tilt
//   harmonic n = Σ_c u_c(x) · a_c,n      → depends ONLY on elbow bend
// so bending the elbow changes only the vowel and tilting the head only the
// pitch, also between the dots. The blended numbers go through Vowel Morph's
// blendParams() and synthesizer unchanged.
import { MAX_HARMONICS } from '../frequency/vowel-model.js';
import { blendParams } from '../vowel-morph/morph-model.js';

// MediaPipe Pose landmark indices ("left"/"right" are the PERSON's sides).
export const LM = Object.freeze({ leftEar: 7, rightEar: 8, leftShoulder: 11, rightShoulder: 12, rightElbow: 14, rightWrist: 16 });
export const JOINT_NAMES = Object.freeze({ 7: 'left ear', 8: 'right ear', 11: 'left shoulder', 12: 'right shoulder', 14: 'right elbow', 16: 'right wrist' });
export const BEND_JOINTS = Object.freeze([LM.rightShoulder, LM.rightElbow, LM.rightWrist]);
export const HEAD_JOINTS = Object.freeze([LM.rightEar, LM.leftEar, LM.leftShoulder, LM.rightShoulder]);
export const MIN_VISIBILITY = 0.5; // below this a landmark counts as lost
export const LOST_GRACE_MS = 250; // a landmark must be missing this long before the sound fades
export const SMOOTH_TAU = 0.08; // s, light smoothing of the angles
export const DEFAULT_CAL = Object.freeze({ bend: { lo: 10, hi: 120 }, tilt: { neutral: 0, low: -20, high: 20 } });
export const MIN_BEND_SPAN = 20; // degrees
export const MIN_TILT_SIDE = 6; // degrees from upright to each tilt end
export const CLAP_BUFFER = 0.06;
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
 * Head tilt in degrees: the signed angle from the shoulder line (right → left
 * shoulder) to the ear line (right → left ear), in the image plane.
 * 0 = head upright relative to the shoulders. Positive = head tilted toward
 * the person's LEFT shoulder, negative = toward the RIGHT shoulder.
 */
export function headTiltAngle(rEar, lEar, rSh, lSh, aspect = 1) {
  const sx = (lSh.x - rSh.x) * aspect;
  const sy = lSh.y - rSh.y;
  const ex = (lEar.x - rEar.x) * aspect;
  const ey = lEar.y - rEar.y;
  if (!(Math.hypot(sx, sy) > 1e-9) || !(Math.hypot(ex, ey) > 1e-9)) return NaN;
  // Image y points down. Tilting toward the left shoulder lowers the left ear
  // (larger y) relative to the line, which this sign convention makes positive.
  return Math.atan2(sx * ey - sy * ex, sx * ex + sy * ey) * R2D;
}

/**
 * Joint angles from one frame of landmarks.
 *   lms     33 landmarks {x, y, z, visibility} (image coordinates, 0…1)
 *   world   optional 33 world landmarks in metres (used for the elbow, which can bend toward the camera)
 *   aspect  width / height of the image
 * Returns { bend, tilt, lost: [landmark names], ok, noPerson? }.
 */
export function poseAngles(lms, { world = null, aspect = 16 / 9, minVisibility = MIN_VISIBILITY } = {}) {
  const all = [...BEND_JOINTS, ...HEAD_JOINTS];
  if (!Array.isArray(lms) || lms.length < 17) return { bend: NaN, tilt: NaN, lost: all.map((i) => JOINT_NAMES[i]), ok: false, noPerson: true };
  const seen = (i) => lms[i] && Number.isFinite(lms[i].x) && Number.isFinite(lms[i].y) && (lms[i].visibility == null || lms[i].visibility >= minVisibility);
  const lost = [...new Set(all)].filter((i) => !seen(i)).map((i) => JOINT_NAMES[i]);
  const P = (i) => (world && world[i] && Number.isFinite(world[i].x) ? { x: world[i].x, y: world[i].y, z: world[i].z || 0 } : { x: lms[i].x * aspect, y: lms[i].y, z: 0 });
  const bendOk = BEND_JOINTS.every(seen);
  const tiltOk = HEAD_JOINTS.every(seen);
  const bend = bendOk ? 180 - angleAt(P(LM.rightShoulder), P(LM.rightElbow), P(LM.rightWrist)) : NaN;
  const tilt = tiltOk ? headTiltAngle(lms[LM.rightEar], lms[LM.leftEar], lms[LM.rightShoulder], lms[LM.leftShoulder], aspect) : NaN;
  return { bend, tilt, lost, ok: Number.isFinite(bend) && Number.isFinite(tilt) };
}

/** Elbow bend → x (0 = straight arm, 1 = fully bent, by calibration). */
export function bendToX(bend, cal = DEFAULT_CAL) {
  return clamp01((bend - cal.bend.lo) / (cal.bend.hi - cal.bend.lo));
}

/**
 * Head tilt → y. Upright (neutral) = 0.5, the middle row. The calibrated
 * "low" tilt reaches 0 and the "high" tilt reaches 1; each side is scaled on
 * its own, so the two sides may have different comfortable ranges.
 */
export function tiltToY(tilt, cal = DEFAULT_CAL) {
  const { neutral, low, high } = cal.tilt;
  const t = tilt - neutral;
  const toHigh = t / (high - neutral);
  if (toHigh >= 0) return 0.5 + 0.5 * clamp01(toHigh);
  return 0.5 - 0.5 * clamp01(t / (low - neutral));
}

export function anglesToPoint({ bend, tilt }, cal = DEFAULT_CAL) {
  return { x: bendToX(bend, cal), y: tiltToY(tilt, cal) };
}

/** Map point → the angles that reach it (inverse of anglesToPoint inside the range). */
export function pointToAngles(pt, cal = DEFAULT_CAL) {
  const { neutral, low, high } = cal.tilt;
  const tilt = pt.y >= 0.5 ? neutral + (pt.y - 0.5) * 2 * (high - neutral) : neutral + (0.5 - pt.y) * 2 * (low - neutral);
  return { bend: cal.bend.lo + pt.x * (cal.bend.hi - cal.bend.lo), tilt };
}

export function median(list) {
  const a = list.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Median of one angle over a capture window, or NaN with too few readings. */
export function heldValue(samples, key, minCount = 5) {
  const v = samples.map((s) => s && s[key]).filter(Number.isFinite);
  return v.length >= minCount ? median(v) : NaN;
}

/**
 * Applies one calibration capture. which: 'straight' | 'bent' | 'upright' | 'low' | 'high'.
 * Returns { cal, error } (cal unchanged when the capture would make an unusable range).
 */
export function applyCapture(cal, which, value) {
  const c = JSON.parse(JSON.stringify(cal));
  if (!Number.isFinite(value)) return { cal, error: 'No steady reading.' };
  if (which === 'straight' || which === 'bent') {
    if (which === 'straight') c.bend.lo = value; else c.bend.hi = value;
    if (c.bend.hi - c.bend.lo < MIN_BEND_SPAN) {
      return { cal, error: `The straight and bent readings are only ${Math.abs(c.bend.hi - c.bend.lo).toFixed(0)}° apart. Straighten the arm fully for “straight” and bend it further for “bent”.` };
    }
  } else {
    const t = c.tilt;
    if (which === 'upright') {
      // Keep the tilt ends at the same offsets from the new upright.
      t.low = value + (t.low - t.neutral);
      t.high = value + (t.high - t.neutral);
      t.neutral = value;
    } else t[which] = value;
    const lo = t.low - t.neutral;
    const hi = t.high - t.neutral;
    if (Math.abs(lo) < MIN_TILT_SIDE || Math.abs(hi) < MIN_TILT_SIDE) return { cal, error: `Tilt at least ${MIN_TILT_SIDE}° away from upright.` };
    if (Math.sign(lo) === Math.sign(hi)) return { cal, error: 'The low-pitch and high-pitch tilts went toward the same shoulder. Tilt toward opposite shoulders.' };
  }
  for (const k of ['lo', 'hi']) c.bend[k] = Math.round(c.bend[k] * 10) / 10;
  for (const k of ['neutral', 'low', 'high']) c.tilt[k] = Math.round(c.tilt[k] * 10) / 10;
  return { cal: c, error: null };
}

/** Swaps which shoulder lowers and which raises the pitch. */
export function swapTilt(cal) {
  const c = JSON.parse(JSON.stringify(cal));
  c.tilt = { neutral: c.tilt.neutral, low: c.tilt.high, high: c.tilt.low };
  return c;
}

/** Plain-language side of a tilt angle. */
export function tiltSide(tilt) {
  if (!Number.isFinite(tilt)) return '';
  if (Math.abs(tilt) < 2) return 'upright';
  return tilt > 0 ? 'toward your left shoulder' : 'toward your right shoulder';
}

export function smoothAngles(prev, next, dt, tau = SMOOTH_TAU) {
  if (!prev || !(dt > 0) || dt > 0.5) return { bend: next.bend, tilt: next.tilt };
  const a = 1 - Math.exp(-dt / tau);
  return { bend: prev.bend + a * (next.bend - prev.bend), tilt: prev.tilt + a * (next.tilt - prev.tilt) };
}

// ───────────── the grid ─────────────

/** Centre of item i of n spread across 0…1 (3 → 1/6, 1/2, 5/6). */
export const centre = (i, n) => (i + 0.5) / n;

/**
 * 1D linear weights for n centres at position p: the two neighbouring
 * centres share by distance; beyond the outer centres the outer one gets 100 %.
 */
export function linearWeights(n, p) {
  const w = new Array(n).fill(0);
  if (n === 1) { w[0] = 1; return w; }
  const s = clamp01(p) * n - 0.5; // in centre units
  if (s <= 0) { w[0] = 1; return w; }
  if (s >= n - 1) { w[n - 1] = 1; return w; }
  const i = Math.floor(s);
  const f = s - i;
  w[i] = 1 - f;
  w[i + 1] = f;
  return w;
}

/**
 * The sound at point pt: columns [{ amps }], rows [{ f0 }].
 * Returns { params, cells: [{ c, r, weight }], vowelShares: [per column], rowShares: [per row] }.
 * The parameters are blended with Vowel Morph's blendParams (plain weighted
 * averages of f0 in Hz and of each harmonic).
 */
export function gridBlend(columns, rows, pt) {
  if (!columns.length || !rows.length) return { params: null, cells: [], vowelShares: [], rowShares: [] };
  const u = linearWeights(columns.length, pt.x);
  const v = linearWeights(rows.length, pt.y);
  const cells = [];
  for (let c = 0; c < columns.length; c++) for (let r = 0; r < rows.length; r++) cells.push({ c, r, weight: u[c] * v[r] });
  const params = blendParams(cells.map((k) => ({ params: { f0: rows[k.r].f0, amps: columns[k.c].amps }, weight: k.weight })));
  return { params, cells, vowelShares: u, rowShares: v };
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

// Pitch rows: middle A3 (220 Hz), a perfect fourth below and above.
export const STARTER_ROWS = Object.freeze([
  { key: 'low', name: 'Low', f0: 164.8 },
  { key: 'mid', name: 'Middle', f0: 220 },
  { key: 'high', name: 'High', f0: 293.7 },
]);

// Average formants (Peterson & Barney 1952). Each vowel's harmonic balance is
// computed once (at the middle pitch) and used unchanged in every row.
export const STARTER_VOWELS = Object.freeze([
  { key: 'ah', name: 'ah', color: '#ffb74d', formants: [[730, 90, 1], [1090, 110, 0.5], [2440, 170, 0.2]] },
  { key: 'ee', name: 'ee', color: '#4dd0c8', formants: [[270, 60, 1], [2290, 120, 0.45], [3010, 170, 0.3]] },
  { key: 'oo', name: 'oo', color: '#c792ea', formants: [[300, 60, 1], [870, 90, 0.35], [2240, 130, 0.1]] },
]);

export function starterColumns() {
  return STARTER_VOWELS.map((v) => ({ id: `starter-${v.key}`, name: v.name, color: v.color, source: 'starter', amps: formantAmps(220, v.formants), recordedF0: null }));
}

// ───────────── clap ─────────────

/** Fires ONCE on entering the region; quiet while held; re-arms after leaving by more than `buffer`. */
export class RegionTrigger {
  constructor({ buffer = CLAP_BUFFER, cooldownMs = CLAP_COOLDOWN_MS } = {}) {
    this.buffer = buffer;
    this.cooldownMs = cooldownMs;
    this.inside = false;
    this.last = -Infinity;
    this.count = 0;
  }

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

export const PROJECT_KEY = 'poseMap.project.v2';
export const MAX_COLUMNS = 6;
const COLORS = ['#ffb74d', '#4dd0c8', '#c792ea', '#f07178', '#c3e88d', '#82aaff'];
export const nextColor = (columns) => COLORS.find((c) => !columns.some((k) => k.color === c)) || COLORS[columns.length % COLORS.length];

export function emptyProject() {
  return {
    version: 2, columns: starterColumns(), rows: STARTER_ROWS.map((r) => ({ ...r })),
    cal: JSON.parse(JSON.stringify(DEFAULT_CAL)),
    clap: { on: false, region: { x: 0.5, y: 0.92, r: 0.13 } },
  };
}

export function cleanColumn(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.amps)) return null;
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (let i = 0; i < MAX_HARMONICS && i < c.amps.length; i++) { const v = Number(c.amps[i]); amps[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  if (!amps.some((v) => v > 0)) return null;
  return {
    id: String(c.id || `col-${Math.random().toString(36).slice(2, 10)}`),
    name: String(c.name || 'sound').slice(0, 24),
    color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#ffb74d',
    source: ['starter', 'recorded', 'vowel-morph'].includes(c.source) ? c.source : 'recorded',
    amps,
    recordedF0: Number.isFinite(+c.recordedF0) && +c.recordedF0 > 0 ? +c.recordedF0 : null,
    recordingId: c.recordingId ? String(c.recordingId) : null,
  };
}

export function loadProject(raw) {
  const p = emptyProject();
  if (!raw || typeof raw !== 'object' || raw.version !== 2) return p;
  const cols = Array.isArray(raw.columns) ? raw.columns.map(cleanColumn).filter(Boolean).slice(0, MAX_COLUMNS) : [];
  if (cols.length) p.columns = cols;
  const c = raw.cal || {};
  const b = c.bend || {};
  if (Number.isFinite(+b.lo) && Number.isFinite(+b.hi) && +b.hi - +b.lo >= MIN_BEND_SPAN) p.cal.bend = { lo: +b.lo, hi: +b.hi };
  const t = c.tilt || {};
  if ([t.neutral, t.low, t.high].every((v) => Number.isFinite(+v))) {
    const lo = +t.low - +t.neutral;
    const hi = +t.high - +t.neutral;
    if (Math.abs(lo) >= MIN_TILT_SIDE && Math.abs(hi) >= MIN_TILT_SIDE && Math.sign(lo) !== Math.sign(hi)) p.cal.tilt = { neutral: +t.neutral, low: +t.low, high: +t.high };
  }
  const cl = raw.clap || {};
  const r = cl.region || {};
  p.clap = { on: cl.on === true, region: { x: clamp01(Number.isFinite(+r.x) ? +r.x : 0.5), y: clamp01(Number.isFinite(+r.y) ? +r.y : 0.92), r: Math.min(0.3, Math.max(0.05, Number(r.r) || 0.13)) } };
  return p;
}

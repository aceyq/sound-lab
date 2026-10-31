// Vowel Morph (tasks 3 and 4): pure logic, no DOM or Web Audio, so all of it
// is unit-tested with `npm test`.
//
// Every vowel is described by the same two things:
//   f0    its fundamental frequency in Hz
//   amps  48 relative harmonic strengths (harmonic n sits at n × f0); the
//         strongest is 1, a harmonic that was not measured is exactly 0.
//
// The slider (1D) and the square (2D) both turn a position into weights
// w₁…wₖ (≥ 0, summing to 1) for the vowels involved, and blendParams() turns
// those weights into ONE new f0 and ONE new set of 48 strengths. The audio
// engine then plays that single harmonic sound with fresh sine waves. Nothing
// here mixes recordings.
//
// Blending rules (the same in 1D and 2D):
//   pitch      weighted geometric mean: f0 = Π f0ᵢ^wᵢ. On a log/semitone
//              scale this is the plain weighted average, so halfway between
//              200 Hz and 300 Hz is 244.9 Hz (equal semitones from each).
//   harmonic n weighted average in decibels: dBₙ = Σ wᵢ · dBᵢₙ, i.e. the
//              geometric mean Π aᵢₙ^wᵢ. A missing harmonic (0) counts as the
//              floor, −60 dB; a blended value at or below the floor plays as 0.
// With one weight equal to 1 the result is exactly that vowel's numbers.
import { MAX_HARMONICS, F0_MIN, F0_MAX, renderRecipe, newId, uniqueName } from '../frequency/vowel-model.js';

export const HARMONICS = MAX_HARMONICS; // 48, the same as the Vowel Lab analysis
export const FLOOR_DB = -60;
export const FLOOR = 10 ** (FLOOR_DB / 20); // 0.001
// Loudness rule: every synthesized sound is scaled to the same RMS level,
// 0.1 (−20 dBFS), before the volume control. Because there are at most 48
// sines, its peak can never exceed √(2·48) × 0.1 ≈ 0.98, so nothing clips.
export const TARGET_RMS = 0.1;
// Harmonics close to the Nyquist frequency (half the sample rate) are faded
// out instead of being cut off abruptly while the pitch moves: full strength
// below 90 % of Nyquist, silent from 98 %.
export const TAPER_START = 0.9;
export const TAPER_END = 0.98;
export const DEFAULT_POWER = 2;
export const POWERS = [
  { p: 1, name: 'Gentle', describe: 'far dots still contribute a lot; blends are broad' },
  { p: 2, name: 'Standard', describe: 'influence falls with distance squared (the usual choice)' },
  { p: 4, name: 'Local', describe: 'the nearest dot dominates quickly; blends happen mostly midway' },
];
// Two dots closer than this (in square units, the side is 1) count as the
// same spot for weighting.
export const SAME_SPOT = 1e-9;
// Dots closer than this get a "nearly on top of each other" warning.
export const CLOSE_DOTS = 0.03;

// ───────────── parameters ─────────────

/** True when a vowel has an analysis that can be played. */
export function isUsable(v) {
  return !!(v && v.analysis && Array.isArray(v.analysis.amps) && Number.isFinite(v.analysis.f0) && v.analysis.f0 > 0 &&
    v.analysis.amps.some((a) => a > 0));
}

/** The playable parameters of a vowel (copies; 48 strengths, missing ones 0). */
export function paramsOf(v) {
  if (!isUsable(v)) return null;
  return normalizeParams({ f0: v.analysis.f0, amps: v.analysis.amps });
}

/** A complete, clean parameter set: f0 finite, exactly 48 strengths in 0…1. */
export function normalizeParams(p) {
  const amps = new Array(HARMONICS).fill(0);
  const src = Array.isArray(p && p.amps) ? p.amps : [];
  for (let i = 0; i < HARMONICS && i < src.length; i++) {
    const a = Number(src[i]);
    amps[i] = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 0;
  }
  const f0 = Number(p && p.f0);
  return { f0: Number.isFinite(f0) && f0 > 0 ? f0 : NaN, amps };
}

/**
 * Blends parameter sets: items = [{ params, weight }], weights ≥ 0. Weights are
 * normalized to sum to 1. Returns { f0, amps } or null if nothing to blend.
 */
export function blendParams(items) {
  const list = items.filter((it) => it && it.params && it.weight > 0 && Number.isFinite(it.params.f0));
  const total = list.reduce((s, it) => s + it.weight, 0);
  if (!list.length || !(total > 0)) return null;
  // A single full weight: return that vowel's numbers exactly.
  const full = list.find((it) => it.weight / total === 1);
  if (full) return { f0: full.params.f0, amps: [...full.params.amps] };
  let logF = 0;
  const logA = new Array(HARMONICS).fill(0);
  for (const it of list) {
    const w = it.weight / total;
    logF += w * Math.log(it.params.f0);
    for (let n = 0; n < HARMONICS; n++) logA[n] += w * Math.log(Math.max(FLOOR, it.params.amps[n] || 0));
  }
  const amps = logA.map((l) => {
    const a = Math.exp(l);
    return a <= FLOOR * (1 + 1e-9) ? 0 : Math.min(1, a);
  });
  return { f0: Math.exp(logF), amps };
}

// Optional for the slider: hold the pitch at one end to hear only the change
// in vowel character. Only 'blend' reproduces both endpoints exactly.
export const PITCH_MODES = [
  { id: 'blend', name: 'Blend pitch A → B' },
  { id: 'a', name: 'Keep A’s pitch' },
  { id: 'b', name: 'Keep B’s pitch' },
];

/** Task 3: position t (0 = A, 1 = B) on the slider. */
export function interpolate1D(a, b, t) {
  const u = clamp01(t);
  return blendParams([{ params: a, weight: 1 - u }, { params: b, weight: u }]);
}

/** The slider's sound with the chosen pitch rule. */
export function sliderParams(a, b, t, pitchMode = 'blend') {
  const p = interpolate1D(a, b, t);
  if (p && pitchMode === 'a') p.f0 = a.f0;
  else if (p && pitchMode === 'b') p.f0 = b.f0;
  return p;
}

// ───────────── 2D weights ─────────────

/**
 * Task 4: inverse-distance weights (Shepard 1968) of `dots` [{x, y}] at
 * `point` {x, y}: wᵢ ∝ 1 / dᵢ^power, normalized to sum to 1.
 *   0 dots → [];  1 dot → [1]
 *   point on a dot (d ≤ SAME_SPOT) → that dot gets 1 (dots stacked on the
 *   same spot share it equally); otherwise every weight is > 0.
 * Computed as (d_min / dᵢ)^power so tiny distances cannot overflow.
 */
export function idwWeights(dots, point, power = DEFAULT_POWER) {
  const n = dots.length;
  if (!n) return [];
  if (n === 1) return [1];
  const d = dots.map((q) => Math.hypot(q.x - point.x, q.y - point.y));
  const onTop = d.map((x) => x <= SAME_SPOT);
  const k = onTop.filter(Boolean).length;
  if (k) return onTop.map((on) => (on ? 1 / k : 0));
  const dmin = Math.min(...d);
  const raw = d.map((x) => (dmin / x) ** power);
  const sum = raw.reduce((s, x) => s + x, 0);
  return raw.map((x) => x / sum);
}

/** Pairs of dots that are nearly on top of each other. */
export function closePairs(dots, limit = CLOSE_DOTS) {
  const out = [];
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      if (Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) < limit) out.push([i, j]);
    }
  }
  return out;
}

/**
 * The sound at a point in the square: the usable placed vowels, their weights
 * and the blended parameters. Returns { contributions: [{ vowel, weight }],
 * params, status: 'none' | 'single' | 'blend', message }.
 */
export function blendAt(vowels, point, power = DEFAULT_POWER) {
  const placed = vowels.filter((v) => v.pos && isUsable(v));
  if (!placed.length) {
    return { contributions: [], params: null, status: 'none', message: 'Place at least one analyzed vowel in the square (Edit mode) to hear a sound.' };
  }
  const w = idwWeights(placed.map((v) => v.pos), point, power);
  const contributions = placed.map((vowel, i) => ({ vowel, weight: w[i] }));
  const params = blendParams(contributions.map((c) => ({ params: paramsOf(c.vowel), weight: c.weight })));
  if (placed.length === 1) {
    return { contributions, params, status: 'single', message: `Only one vowel (${placed[0].name}) is in the square, so every position plays that vowel. Add a second one to blend.` };
  }
  return { contributions, params, status: 'blend', message: '' };
}

// ───────────── sound ─────────────

/** Nyquist fade factor for a component at `freq` Hz. */
export function nyquistTaper(freq, sampleRate) {
  const nyq = sampleRate / 2;
  const lo = TAPER_START * nyq;
  const hi = TAPER_END * nyq;
  if (freq <= lo) return 1;
  if (freq >= hi) return 0;
  return (hi - freq) / (hi - lo);
}

/** The strengths actually played at this sample rate (Nyquist fade applied). */
export function playedAmps(params, sampleRate) {
  return params.amps.map((a, i) => a * nyquistTaper((i + 1) * params.f0, sampleRate));
}

/** RMS of Σ aₙ sin(…) with distinct frequencies: √(Σ aₙ² / 2). */
export function rmsOfAmps(amps) {
  return Math.sqrt(amps.reduce((s, a) => s + a * a, 0) / 2);
}

/** Gain that brings the played sound to TARGET_RMS (0 for silence). */
export function loudnessGain(params, sampleRate) {
  const r = rmsOfAmps(playedAmps(params, sampleRate));
  return r > 1e-12 ? TARGET_RMS / r : 0;
}

/**
 * Per-oscillator targets for the live synthesizer: frequency n·f0 and final
 * linear gain (strength × Nyquist fade × loudness gain).
 */
export function oscillatorTargets(params, sampleRate) {
  const amps = playedAmps(params, sampleRate);
  const g = loudnessGain(params, sampleRate);
  return amps.map((a, i) => ({ freq: (i + 1) * params.f0, gain: a * g }));
}

/**
 * Renders the blended sound for export, with the same rules as live playback
 * (Nyquist fade, RMS loudness, all phases 0 at the start, 20 ms fades).
 */
export function renderParams(params, { sampleRate = 48000, duration = 3, fadeSec = 0.03 } = {}) {
  const amps = playedAmps(params, sampleRate);
  return renderRecipe({ f0: params.f0, amps, sampleRate, duration, gain: loudnessGain(params, sampleRate), fadeSec });
}

// ───────────── describing numbers ─────────────

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** "G3 −12¢" for a frequency (A4 = 440 Hz). */
export function noteName(f) {
  if (!(f > 0)) return '—';
  const m = 69 + 12 * Math.log2(f / 440);
  const r = Math.round(m);
  const cents = Math.round((m - r) * 100);
  const name = `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
  return cents ? `${name} ${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢` : name;
}

export function semitones(fromHz, toHz) {
  return 12 * Math.log2(toHz / fromHz);
}

export function ampDb(a) {
  return a > 0 ? 20 * Math.log10(a) : -Infinity;
}

/** Index (1-based) of the strongest harmonic. */
export function strongestHarmonic(amps) {
  let k = 0;
  for (let i = 1; i < amps.length; i++) if (amps[i] > amps[k]) k = i;
  return amps[k] > 0 ? k + 1 : null;
}

// ───────────── project ─────────────

export const PROJECT_FORMAT = 'vowel-morph.project';

export function emptyProject() {
  return { format: PROJECT_FORMAT, version: 1, vowels: [], pair: { a: null, b: null }, slider: 0, pitchMode: 'blend', space: { power: DEFAULT_POWER, point: { x: 0.5, y: 0.5 } } };
}

export function makeVowel(p = {}) {
  return {
    id: p.id || newId('vm'),
    name: String(p.name || 'Vowel').slice(0, 40),
    recordingId: p.recordingId || null,
    segment: p.segment && Number.isFinite(+p.segment.start) && Number.isFinite(+p.segment.end) ? { start: +p.segment.start, end: +p.segment.end } : null,
    analysis: p.analysis ? cleanAnalysis(p.analysis) : null,
    pos: p.pos && Number.isFinite(+p.pos.x) && Number.isFinite(+p.pos.y) ? { x: clamp01(+p.pos.x), y: clamp01(+p.pos.y) } : null,
    createdAt: p.createdAt || new Date().toISOString(),
  };
}

function cleanAnalysis(a) {
  return {
    status: ['ok', 'warning', 'failed'].includes(a.status) ? a.status : 'failed',
    f0: Number.isFinite(a.f0) ? a.f0 : null,
    f0Auto: Number.isFinite(a.f0Auto) ? a.f0Auto : null,
    f0Source: a.f0Source === 'manual' ? 'manual' : a.f0Source === 'automatic' ? 'automatic' : null,
    amps: Array.isArray(a.amps) ? normalizeParams({ f0: 1, amps: a.amps }).amps : null,
    sampleRate: Number.isFinite(a.sampleRate) ? a.sampleRate : null,
    warnings: Array.isArray(a.warnings) ? a.warnings.map(String) : [],
    problems: Array.isArray(a.problems) ? a.problems.map(String) : [],
    facts: a.facts && typeof a.facts === 'object' ? JSON.parse(JSON.stringify(a.facts)) : {},
  };
}

/** Restores a stored project, dropping anything malformed. */
export function loadProject(raw) {
  const p = emptyProject();
  if (!raw || typeof raw !== 'object') return p;
  p.vowels = Array.isArray(raw.vowels) ? raw.vowels.filter((v) => v && typeof v === 'object').map(makeVowel) : [];
  const ids = new Set(p.vowels.map((v) => v.id));
  p.pair = { a: raw.pair && ids.has(raw.pair.a) ? raw.pair.a : null, b: raw.pair && ids.has(raw.pair.b) ? raw.pair.b : null };
  p.slider = clamp01(Number(raw.slider) || 0);
  p.pitchMode = PITCH_MODES.some((m) => m.id === raw.pitchMode) ? raw.pitchMode : 'blend';
  const power = Number(raw.space && raw.space.power);
  p.space.power = POWERS.some((x) => x.p === power) ? power : DEFAULT_POWER;
  const pt = raw.space && raw.space.point;
  if (pt && Number.isFinite(+pt.x) && Number.isFinite(+pt.y)) p.space.point = { x: clamp01(+pt.x), y: clamp01(+pt.y) };
  return p;
}

/** A take name that does not clash: "Aa", then "Aa (take 2)". */
export function takeName(base, existing) {
  const b = String(base || '').trim() || 'Vowel';
  const names = new Set(existing);
  if (!names.has(b)) return b;
  for (let i = 2; ; i++) if (!names.has(`${b} (take ${i})`)) return `${b} (take ${i})`;
}

// ───────────── backup file ─────────────

export const BACKUP_FORMAT = 'vowel-morph.backup';

/** Float32Array → base64 of its little-endian bytes (exact, no re-encoding). */
export function floatsToBase64(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToFloats(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  if (bytes.length % 4) throw new Error('Recording data has a length that is not a whole number of samples.');
  return new Float32Array(bytes.buffer);
}

/** The backup document: project settings plus every recording it uses. */
export function makeBackup(project, recordings) {
  const used = new Set(project.vowels.map((v) => v.recordingId).filter(Boolean));
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Vowel Morph backup: names, analyses, slider pair, dot positions and the original recordings (32-bit float samples, base64). Import it with "Import backup" in Vowel Morph.',
    project: JSON.parse(JSON.stringify(project)),
    recordings: recordings.filter((r) => used.has(r.id)).map((r) => ({
      id: r.id, name: r.name, sampleRate: r.sampleRate, createdAt: r.createdAt, source: r.source || null,
      encoding: 'float32le-base64', samples: floatsToBase64(r.samples),
    })),
  };
}

/**
 * Reads a backup into NEW vowels and recordings with fresh ids, so importing
 * never overwrites anything already in this browser. Names that already exist
 * get " (imported)". Returns { ok, vowels, recordings, pair, warnings } or
 * { ok: false, error }.
 */
export function parseBackup(doc, existingNames = []) {
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'The file is not a JSON object.' };
  if (doc.format !== BACKUP_FORMAT) return { ok: false, error: 'This is not a Vowel Morph backup file (its format field is missing or different).' };
  if (!doc.project || !Array.isArray(doc.project.vowels)) return { ok: false, error: 'The backup has no list of vowels.' };
  const warnings = [];
  const recMap = new Map();
  const recordings = [];
  for (const r of Array.isArray(doc.recordings) ? doc.recordings : []) {
    try {
      if (r.encoding !== 'float32le-base64') throw new Error(`unknown encoding ${r.encoding}`);
      const sr = Number(r.sampleRate);
      if (!(sr >= 8000 && sr <= 384000)) throw new Error(`sample rate ${r.sampleRate}`);
      const samples = base64ToFloats(String(r.samples || ''));
      const id = newId('rec');
      recMap.set(r.id, id);
      recordings.push({ id, name: String(r.name || 'recording'), sampleRate: sr, createdAt: r.createdAt || new Date().toISOString(), source: r.source || 'backup', samples });
    } catch (e) {
      warnings.push(`Recording "${r && r.name}" could not be read (${e.message}) and was skipped.`);
    }
  }
  const names = [...existingNames];
  const idMap = new Map();
  const vowels = [];
  for (const raw of doc.project.vowels) {
    if (!raw || typeof raw !== 'object') continue;
    const v = makeVowel({ ...raw, id: null });
    idMap.set(raw.id, v.id);
    v.recordingId = raw.recordingId && recMap.has(raw.recordingId) ? recMap.get(raw.recordingId) : null;
    if (raw.recordingId && !v.recordingId) warnings.push(`"${v.name}": its recording is not in the backup, so only its analyzed values were restored.`);
    if (names.includes(v.name)) v.name = uniqueName(`${v.name} (imported)`, names);
    names.push(v.name);
    vowels.push(v);
  }
  const pair = doc.project.pair || {};
  return { ok: true, vowels, recordings, pair: { a: idMap.get(pair.a) || null, b: idMap.get(pair.b) || null }, warnings };
}

export function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export { F0_MIN, F0_MAX };

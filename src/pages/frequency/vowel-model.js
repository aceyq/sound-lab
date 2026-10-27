// Pure logic for the Vowel Lab (assignment 2): harmonic recipes, rendering,
// spectrum analysis of stored samples, and experiment records. No DOM or Web
// Audio here, so everything is unit-tested with `npm test`.
//
// Nothing in this file estimates a fundamental or fits amplitudes to a
// recording. The person listening chooses every value; these helpers only
// calculate what those choices produce. The automatic analysis of
// assignment 3 lives separately in auto-vowel.js; an experiment it created is
// marked origin 'auto' and carries a summary of that analysis.

export const MIN_HARMONICS = 4;
export const MAX_HARMONICS = 48;
export const DEFAULT_HARMONICS = 32;
export const F0_MIN = 50;
export const F0_MAX = 1000;
export const DEFAULT_F0 = 200;
// Synthesized sound is scaled so its highest peak sits at this level
// (−6 dB below digital full scale), for playback and for WAV export alike.
export const OUTPUT_PEAK = 0.5;
export const FADE_SEC = 0.02;

export const VOWELS = [
  { id: 'ah', name: 'ah', example: 'as in “father”' },
  { id: 'ee', name: 'ee', example: 'as in “see”' },
  { id: 'oo', name: 'oo', example: 'as in “food”' },
  { id: 'other', name: 'other', example: 'type your own label' },
];
export const PITCHES = ['lower', 'higher', 'middle', 'other'];
export const NOTE_FIELDS = [
  ['pitchChange', 'What changed in pitch?'],
  ['recognizable', 'Did the vowel remain recognizable?'],
  ['adjusted', 'Which harmonic amplitudes needed adjustment?'],
  ['differences', 'What differences remain between original and synthesis?'],
  ['general', 'Other notes (what matched, what did not)'],
];

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Validates a typed fundamental frequency in Hz. */
export function parseFundamental(text, nyquist = Infinity) {
  const s = String(text ?? '').trim();
  if (s === '') return { ok: false, error: 'Type a fundamental frequency in Hz, for example 200.' };
  if (s.includes(',')) return { ok: false, error: 'Use a period for decimals, for example 196.5.' };
  if (!NUMBER_RE.test(s)) return { ok: false, error: 'Not a number. Use digits, for example 200 or 196.5.' };
  const v = Number(s);
  if (v < F0_MIN || v > F0_MAX) return { ok: false, error: `Use ${F0_MIN}–${F0_MAX} Hz (the range of a sung or spoken fundamental).` };
  if (v >= nyquist) return { ok: false, error: `Must be below the Nyquist frequency (${nyquist} Hz).` };
  return { ok: true, value: Math.round(v * 100) / 100 };
}

/** Validates a typed amplitude 0…1. */
export function parseAmp(text) {
  const s = String(text ?? '').trim();
  if (s === '' || !NUMBER_RE.test(s)) return { ok: false, error: 'Type a number from 0 to 1.' };
  const v = Number(s);
  if (v < 0 || v > 1) return { ok: false, error: 'Amplitude must be from 0 to 1.' };
  return { ok: true, value: Math.round(v * 1000) / 1000 };
}

/** Starting recipes. None of them is a vowel; they are neutral starting points. */
export const START_RECIPES = {
  neutral: { name: 'Neutral 1/n', describe: 'amplitude 1/n for harmonic n (a gently falling, buzzy tone, like a sawtooth)' },
  fundamental: { name: 'Fundamental only', describe: 'harmonic 1 at amplitude 1, all others 0 (a pure sine)' },
  zero: { name: 'All zero', describe: 'every amplitude 0 (silence), so you can build up from nothing' },
};

export function startRecipe(kind, count) {
  return Array.from({ length: count }, (_, i) => {
    if (kind === 'fundamental') return i === 0 ? 1 : 0;
    if (kind === 'zero') return 0;
    return Math.round((1 / (i + 1)) * 1000) / 1000;
  });
}

/** Changes the number of harmonics, keeping existing amplitudes and adding zeros. */
export function resizeAmps(amps, count) {
  return Array.from({ length: count }, (_, i) => (i < amps.length ? amps[i] : 0));
}

/** One row per harmonic: n, frequency n × f0, amplitude, and whether it is below Nyquist. */
export function harmonicRows(f0, amps, nyquist) {
  return amps.map((amp, i) => {
    const n = i + 1;
    const freq = n * f0;
    return { n, freq, amp, audible: freq < nyquist };
  });
}

/** Harmonics that actually sound: below Nyquist and amplitude above 0. */
export function soundingHarmonics(f0, amps, nyquist) {
  return harmonicRows(f0, amps, nyquist).filter((r) => r.audible && r.amp > 0);
}

/**
 * Highest |x(t)| of Σ Aₙ sin(2π n f0 t) with every phase 0. The sum repeats
 * every 1/f0 seconds, so one period, finely sampled, contains the peak. The
 * value does not depend on f0 except through which harmonics are below Nyquist.
 */
export function recipePeak(f0, amps, nyquist) {
  const hs = soundingHarmonics(f0, amps, nyquist);
  if (!hs.length) return 0;
  const maxN = hs[hs.length - 1].n;
  const M = Math.max(4096, maxN * 96);
  let peak = 0;
  for (let k = 0; k < M; k++) {
    const ph = (2 * Math.PI * k) / M;
    let s = 0;
    for (const h of hs) s += h.amp * Math.sin(h.n * ph);
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Gain that puts the synthesized peak at `target` (0 for silence). */
export function outputGain(f0, amps, nyquist, target = OUTPUT_PEAK) {
  const p = recipePeak(f0, amps, nyquist);
  return p > 1e-9 ? target / p : 0;
}

/**
 * Renders gain · Σ Aₙ sin(2π n f0 t) for `duration` seconds, with linear
 * fade-in/out of `fadeSec`, exactly as the live synthesizer plays it
 * (all phases 0 at t = 0, harmonics at or above Nyquist left out).
 */
export function renderRecipe({ f0, amps, sampleRate, duration, gain, fadeSec = FADE_SEC, startTime = 0 }) {
  const n = Math.max(1, Math.round(duration * sampleRate));
  const out = new Float32Array(n);
  const hs = soundingHarmonics(f0, amps, sampleRate / 2);
  const acc = new Float64Array(n);
  for (const h of hs) {
    // Rotation recurrence: much faster than Math.sin per sample, and accurate
    // to ~1e-10 over minutes of audio in double precision.
    const w = (2 * Math.PI * h.freq) / sampleRate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const p0 = 2 * Math.PI * h.freq * startTime;
    let s = Math.sin(p0);
    let c = Math.cos(p0);
    const a = h.amp * gain;
    for (let i = 0; i < n; i++) {
      acc[i] += a * s;
      const s2 = s * cw + c * sw;
      c = c * cw - s * sw;
      s = s2;
    }
  }
  const fadeN = Math.min(Math.floor(n / 2), Math.round(fadeSec * sampleRate));
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < fadeN) g = i / fadeN;
    else if (i >= n - fadeN) g = (n - 1 - i) / fadeN;
    out[i] = acc[i] * g;
  }
  return out;
}

// ───────────── spectrum of stored samples ─────────────

/** In-place iterative radix-2 FFT. re/im lengths must be the same power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export const SPECTRUM_WINDOW = 'Hann';

/**
 * Averaged spectrum (Welch's method) of samples[from, to): Hann-windowed
 * frames of `fftSize` samples, 50 % overlap, power averaged over frames.
 * Levels are dB relative to a full-scale sine (a sine of amplitude A shows
 * ≈ 20·log10(A) dB at its frequency). If the segment is shorter than one
 * frame, its samples are windowed and zero-padded, and `padded` is true.
 */
export function segmentSpectrum(samples, sampleRate, { from = 0, to = samples.length, fftSize = 8192 } = {}) {
  const N = fftSize;
  const half = N / 2;
  const power = new Float64Array(half + 1);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const len = Math.max(0, to - from);
  const padded = len < N;
  const frameLen = padded ? len : N;
  const hop = N / 2;
  const starts = [];
  if (padded) { if (len >= 16) starts.push(from); } else for (let s = from; s + N <= to; s += hop) starts.push(s);
  if (!starts.length) return { db: new Float32Array(half + 1).fill(-200), binHz: sampleRate / N, frames: 0, padded, fftSize: N };
  const win = new Float64Array(frameLen);
  let wsum = 0;
  for (let i = 0; i < frameLen; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLen - 1)); wsum += win[i]; }
  for (const s of starts) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameLen; i++) re[i] = samples[s + i] * win[i];
    fft(re, im);
    for (let k = 0; k <= half; k++) {
      const mag = (2 * Math.hypot(re[k], im[k])) / wsum;
      power[k] += mag * mag;
    }
  }
  const db = new Float32Array(half + 1);
  for (let k = 0; k <= half; k++) db[k] = 10 * Math.log10(power[k] / starts.length + 1e-20);
  return { db, binHz: sampleRate / N, frames: starts.length, padded, fftSize: N };
}

/**
 * Shifts a spectrum so its strongest bin at or above `minHz` is 0 dB.
 * Used to compare the shapes of two spectra whose absolute levels are not
 * comparable (microphone vs synthesizer).
 */
export function relativeToMax(db, binHz, minHz = 50) {
  let max = -Infinity;
  for (let k = Math.max(1, Math.ceil(minHz / binHz)); k < db.length; k++) if (db[k] > max) max = db[k];
  const out = new Float32Array(db.length);
  for (let k = 0; k < db.length; k++) out[k] = db[k] - max;
  return { db: out, maxDb: max };
}

/** Local maximum within ±radius bins of `freq`, refined by parabolic interpolation. */
export function peakNear(db, binHz, freq, radius = 3) {
  const c = Math.round(freq / binHz);
  let best = -1;
  for (let k = Math.max(1, c - radius); k <= Math.min(db.length - 2, c + radius); k++) {
    if (best < 0 || db[k] > db[best]) best = k;
  }
  if (best < 0) return null;
  const a = db[best - 1];
  const b = db[best];
  const d = db[best + 1];
  const den = a - 2 * b + d;
  const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - d)) / den)) : 0;
  return { freq: (best + off) * binHz, db: b, bin: best };
}

// ───────────── recordings ─────────────

export function peakAbs(arr, from = 0, to = arr.length) {
  let p = 0;
  for (let i = from; i < to; i++) { const a = Math.abs(arr[i]); if (a > p) p = a; }
  return p;
}

/** Default analysis segment: the middle second (or the middle 60 % of a short take). */
export function defaultSegment(duration) {
  if (duration >= 1.5) return { start: round3(duration / 2 - 0.5), end: round3(duration / 2 + 0.5) };
  return { start: round3(duration * 0.2), end: round3(duration * 0.8) };
}

/** Keeps a segment inside the recording and at least `minLen` long. */
export function clampSegment(seg, duration, minLen = 0.05) {
  let start = Math.max(0, Math.min(seg.start, seg.end));
  let end = Math.min(duration, Math.max(seg.start, seg.end));
  if (end - start < minLen) {
    end = Math.min(duration, start + minLen);
    start = Math.max(0, end - minLen);
  }
  return { start: round3(start), end: round3(end) };
}

/** Name that does not clash with existing ones: "ah — lower pitch (2)". */
export function uniqueName(base, existing) {
  const names = new Set(existing);
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
}

// ───────────── experiments ─────────────

let idCounter = 0;
export function newId(prefix) {
  idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function vowelName(e) {
  if (e.vowel === 'other') return (e.vowelText || '').trim() || 'vowel';
  return e.vowel;
}

export function pitchName(e) {
  if (e.pitch === 'other') return (e.pitchText || '').trim() || 'other';
  return e.pitch;
}

export function vowelDescription(e) {
  const v = VOWELS.find((x) => x.id === e.vowel);
  return v && v.id !== 'other' ? `${v.name} ${v.example}` : vowelName(e);
}

/** "ah — lower pitch", plus the comparison type for a duplicate. */
export function experimentLabel(e) {
  const tag = e.comparison === 'A' ? ' · A: same amplitudes' : e.comparison === 'B' ? ' · B: new recording' : '';
  const auto = e.origin === 'auto' ? ' · automatic' : '';
  return `${vowelName(e)} — ${pitchName(e)} pitch${auto}${tag}`;
}

export function slug(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/** File name stem: ah_lower, ah_higher_sameamps (comparison A), oo_lower_auto (automatic). */
export function fileBase(e) {
  return `${slug(vowelName(e))}_${slug(pitchName(e))}${e.origin === 'auto' ? '_auto' : ''}${e.comparison === 'A' ? '_sameamps' : ''}`;
}

export function makeExperiment(p = {}) {
  const count = clampInt(p.count ?? DEFAULT_HARMONICS, MIN_HARMONICS, MAX_HARMONICS);
  return {
    id: p.id || newId('exp'),
    vowel: VOWELS.some((v) => v.id === p.vowel) ? p.vowel : 'ah',
    vowelText: String(p.vowelText || ''),
    pitch: PITCHES.includes(p.pitch) ? p.pitch : 'lower',
    pitchText: String(p.pitchText || ''),
    f0: Number.isFinite(p.f0) ? p.f0 : DEFAULT_F0,
    count,
    amps: p.amps ? resizeAmps(p.amps.map(clamp01), count) : startRecipe('neutral', count),
    recordingId: p.recordingId || null,
    segment: p.segment ? { start: +p.segment.start, end: +p.segment.end } : null,
    notes: Object.fromEntries(NOTE_FIELDS.map(([k]) => [k, String((p.notes && p.notes[k]) || '')])),
    comparison: p.comparison === 'A' || p.comparison === 'B' ? p.comparison : null,
    parentId: p.parentId || null,
    parentLabel: p.parentLabel || null,
    parentF0: Number.isFinite(p.parentF0) ? p.parentF0 : null,
    // 'manual' (sliders set by hand) or 'auto' (created by "Save automatic result").
    origin: p.origin === 'auto' ? 'auto' : 'manual',
    autoAnalysis: p.autoAnalysis && typeof p.autoAnalysis === 'object' ? JSON.parse(JSON.stringify(p.autoAnalysis)) : null,
    createdAt: p.createdAt || new Date().toISOString(),
    savedAt: p.savedAt || null,
  };
}

/** Deep copy of the parts of an experiment that "Save" stores. */
export function snapshot(e) {
  return JSON.parse(JSON.stringify(e));
}

/** True when the working copy differs from the saved one in anything that is saved. */
export function hasUnsavedChanges(work, saved) {
  if (!saved) return true;
  const strip = (x) => { const { savedAt, ...rest } = x; return JSON.stringify(rest); };
  return strip(work) !== strip(saved);
}

/**
 * Copy of an experiment for a second pitch. The source experiment is not
 * modified.
 *   A: same amplitudes by harmonic number, change only the fundamental; keeps
 *      the link to the first recording for listening back.
 *   B: record the same vowel at the new pitch; starts from a copy of the
 *      amplitudes for you to readjust, with no recording linked yet.
 */
export function duplicateExperiment(src, mode) {
  const nextPitch = src.pitch === 'lower' ? 'higher' : src.pitch === 'higher' ? 'lower' : 'other';
  return makeExperiment({
    vowel: src.vowel, vowelText: src.vowelText,
    pitch: nextPitch, pitchText: nextPitch === 'other' ? 'new' : '',
    f0: src.f0, count: src.count, amps: [...src.amps],
    recordingId: mode === 'A' ? src.recordingId : null,
    segment: mode === 'A' && src.segment ? { ...src.segment } : null,
    comparison: mode,
    parentId: src.id, parentLabel: experimentLabel(src), parentF0: src.f0,
  });
}

/** Pitch change as a ratio and in semitones. */
export function pitchChange(fromHz, toHz) {
  const ratio = toHz / fromHz;
  return { ratio, semitones: 12 * Math.log2(ratio) };
}

export const SETTINGS_FORMAT = 'frequency-playground.vowel-experiment';

/** The settings file (…_settings.json) for an experiment's saved recipe. */
export function settingsDocument(e, { recording = null, nyquist, synthDuration, sampleRate } = {}) {
  const base = fileBase(e);
  return {
    format: SETTINGS_FORMAT,
    version: 1,
    savedAt: e.savedAt || new Date().toISOString(),
    label: experimentLabel(e),
    vowel: e.vowel,
    vowelLabel: vowelName(e),
    vowelDescription: vowelDescription(e),
    pitchCondition: pitchName(e),
    comparison: e.comparison
      ? { type: e.comparison, meaning: e.comparison === 'A' ? 'Same harmonic amplitudes as the source experiment; only the fundamental was changed.' : 'Same vowel recorded at a new pitch; amplitudes readjusted by ear and eye.', duplicatedFrom: e.parentLabel, sourceFundamentalHz: e.parentF0 }
      : null,
    origin: e.origin === 'auto' ? 'automatic analysis (assignment 3)' : 'manual (set by ear and eye)',
    automaticAnalysis: e.autoAnalysis || null,
    fundamentalHz: e.f0,
    harmonicCount: e.count,
    harmonics: harmonicRows(e.f0, e.amps, nyquist ?? Infinity).map((r) => ({
      n: r.n, frequencyHz: round3(r.freq), amplitude: r.amp, inSound: r.audible,
    })),
    synthesis: {
      formula: 'x(t) = g · Σ Aₙ · sin(2π · n · f0 · t)',
      phases: 'all harmonics start at phase 0',
      peakNormalization: `g is chosen so the highest peak is ${OUTPUT_PEAK} (−6 dB below digital full scale)`,
      fadeMs: FADE_SEC * 1000,
      excluded: 'harmonics at or above the Nyquist frequency (half the sample rate) are left out',
      renderedDurationSec: synthDuration ?? null,
      sampleRate: sampleRate ?? null,
    },
    recording: recording ? {
      name: recording.name,
      sampleRate: recording.sampleRate,
      durationSec: round3(recording.samples.length / recording.sampleRate),
      analysisSegmentSec: e.segment ? [e.segment.start, e.segment.end] : null,
    } : null,
    files: { original: recording ? `${base}_original.wav` : null, synthesized: `${base}_synthesized.wav`, settings: `${base}_settings.json` },
    notes: { ...e.notes },
  };
}

/**
 * Reads a settings file back into a new experiment. Returns
 * { ok: true, experiment, warnings, recordingName } or { ok: false, error }.
 */
export function parseSettings(doc) {
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'The file is not a JSON object.' };
  if (doc.format !== SETTINGS_FORMAT) return { ok: false, error: 'This JSON file is not a Vowel Lab settings file (format field missing or different).' };
  const warnings = [];
  const f0 = Number(doc.fundamentalHz);
  if (!Number.isFinite(f0) || f0 < F0_MIN || f0 > F0_MAX) return { ok: false, error: `fundamentalHz must be ${F0_MIN}–${F0_MAX}.` };
  if (!Array.isArray(doc.harmonics) || !doc.harmonics.length) return { ok: false, error: 'The file has no harmonics list.' };
  let list = [...doc.harmonics].sort((a, b) => a.n - b.n);
  if (list.length > MAX_HARMONICS) { warnings.push(`Only the first ${MAX_HARMONICS} harmonics were kept.`); list = list.slice(0, MAX_HARMONICS); }
  const count = Math.max(MIN_HARMONICS, list.length);
  const amps = new Array(count).fill(0);
  for (const hm of list) {
    const n = Number(hm.n);
    const a = Number(hm.amplitude);
    if (!Number.isInteger(n) || n < 1 || n > count) { warnings.push(`Skipped harmonic entry n = ${hm.n}.`); continue; }
    if (!Number.isFinite(a) || a < 0 || a > 1) { warnings.push(`Harmonic ${n}: amplitude ${hm.amplitude} is outside 0–1 and was set to 0.`); continue; }
    amps[n - 1] = a;
  }
  const vowel = VOWELS.some((v) => v.id === doc.vowel) ? doc.vowel : 'other';
  const pitch = PITCHES.includes(doc.pitchCondition) ? doc.pitchCondition : 'other';
  const seg = doc.recording && Array.isArray(doc.recording.analysisSegmentSec) ? doc.recording.analysisSegmentSec : null;
  const experiment = makeExperiment({
    vowel, vowelText: vowel === 'other' ? doc.vowelLabel : '',
    pitch, pitchText: pitch === 'other' ? doc.pitchCondition : '',
    f0, count, amps,
    segment: seg && seg.length === 2 && seg.every(Number.isFinite) ? { start: seg[0], end: seg[1] } : null,
    notes: doc.notes || {},
    comparison: doc.comparison && doc.comparison.type,
    parentLabel: doc.comparison && doc.comparison.duplicatedFrom,
    parentF0: doc.comparison && Number(doc.comparison.sourceFundamentalHz),
    origin: doc.automaticAnalysis ? 'auto' : 'manual',
    autoAnalysis: doc.automaticAnalysis || null,
  });
  return { ok: true, experiment, warnings, recordingName: doc.recording ? doc.recording.name : null, originalFile: doc.files && doc.files.original };
}

// ───────────── small helpers ─────────────

export function ampToDb(a) {
  return a > 0 ? 20 * Math.log10(a) : -Infinity;
}

export const DB_SLIDER_MIN = -60;

/** dB slider position → amplitude; the leftmost position means 0 (off). */
export function dbToAmp(db) {
  return db <= DB_SLIDER_MIN ? 0 : Math.round(10 ** (db / 20) * 1000) / 1000;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

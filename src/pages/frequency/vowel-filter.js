// Vowel filtering (assignment 4): a harmonic source with every component at
// amplitude 1, shaped by a real filter. Pure logic: no DOM or Web Audio here,
// so everything is unit-tested with `npm test`.
//
//   source  : x(t) = g · Σ sin(2π n f0 t), n = 1 … count, every amplitude 1
//             (g is one shared safety gain, see sourceGain)
//   filter  : a cascade of BAND_COUNT peaking biquads, each one a "cut" only
//             (gain ≤ 0 dB). The coefficients are the Web Audio API's
//             BiquadFilterNode "peaking" formulas (Audio EQ Cookbook), so the
//             response drawn on screen, the audio the browser plays and the
//             WAV rendered here all come from the same equations.
//   fitting : least squares in dB (Levenberg–Marquardt) on the filter
//             parameters only. The source amplitudes are never touched.
//
// Nothing here knows about the person's voice. The vowel examples are
// approximate textbook averages (Hillenbrand et al. 1995) turned into a
// filter by the same fitting code.
import * as M from './vowel-model.js';
import * as AV from './auto-vowel.js';

export const BAND_COUNT = 8;
export const DEFAULT_CENTRES = [300, 550, 850, 1250, 1800, 2600, 3600, 5000];
export const DEFAULT_Q = 1.4;
export const GAIN_MIN = -40; // dB, deepest cut of one band
export const GAIN_MAX = 0; // attenuation only: no band can boost
export const Q_MIN = 0.5;
export const Q_MAX = 8;
export const F_MIN = 60;
export const F_MAX = 9000;
// The unfiltered source peaks well below this; with a cut-only filter the
// output can never exceed it (see sourceGain).
export const SAFE_PEAK = 0.7;
export const TAIL_SEC = 0.05; // the filter rings out for this long after the source stops
export const PREFERRED_RATE = 48000;
export const COUNTS = [4, 6, 8, 12, 16, 20, 24, 32, 40, 48];
export const FILTER_TYPE = 'peaking-cut-bank';

// ───────────── source ─────────────

/** Every source amplitude is 1: the fundamental and all harmonics. */
export function sourceAmps(count) {
  return new Array(count).fill(1);
}

/** Harmonics that actually sound: n × f0 below Nyquist. */
export function activeHarmonics(f0, count, sampleRate) {
  const out = [];
  for (let n = 1; n <= count; n++) if (n * f0 < sampleRate / 2) out.push({ n, freq: n * f0 });
  return out;
}

/**
 * The one shared gain applied to the sum of the unit-amplitude sines.
 * |Σ aₙ sin(…)| ≤ Σ |aₙ|, and a cut-only filter keeps every |aₙ| ≤ 1, so with
 * g = SAFE_PEAK / (active components) neither the unfiltered nor any filtered
 * version can go above SAFE_PEAK. The same g is used with the filter on and
 * bypassed, so the bypass comparison is level-fair.
 */
export function sourceGain(f0, count, sampleRate) {
  const k = activeHarmonics(f0, count, sampleRate).length;
  return k ? SAFE_PEAK / k : 0;
}

// ───────────── sources as component lists ─────────────
// Both kinds of source are a list of sine components { freq, amp, on }:
//   • 'harmonics': n × f0 for n = 1 … count, every amp exactly 1;
//   • 'custom'   : the person's own rows (any frequencies, their own
//                  amplitudes, kept exactly as typed).
// The filter only ever acts on this list; it never edits it.

export const CUSTOM_MAX = 48;
export const CUSTOM_FREQ_MIN = 20;
export const CUSTOM_FREQ_MAX = 20000;

export function harmonicComponents(f0, count) {
  return Array.from({ length: count }, (_, i) => ({ freq: (i + 1) * f0, amp: 1, on: true, n: i + 1 }));
}

/** The component list an experiment plays. */
export function sourceComponents(e) {
  return e.source === 'custom' ? e.components.map((c) => ({ ...c })) : harmonicComponents(e.f0, e.count);
}

/** Components that sound: switched on, amplitude above 0, below Nyquist. */
export function activeComponents(components, sampleRate) {
  return components.filter((c) => c.on !== false && c.amp > 0 && c.freq < sampleRate / 2);
}

/**
 * The shared safety gain for any component list: SAFE_PEAK ÷ Σ|amp| of the
 * active components. Since the peak of Σ aᵢ sin(…) never exceeds Σ|aᵢ|, and
 * a cut-only filter only lowers each |aᵢ|, no filtered or unfiltered version
 * can exceed SAFE_PEAK. For equal-strength harmonics this is SAFE_PEAK ÷ N,
 * the same as sourceGain. One factor for every component keeps their ratios.
 */
export function componentGain(components, sampleRate) {
  const sum = activeComponents(components, sampleRate).reduce((s, c) => s + Math.abs(c.amp), 0);
  return sum > 0 ? SAFE_PEAK / sum : 0;
}

/** Cleans one custom row: frequency in Hz, amplitude 0…1, on/off. */
export function cleanComponent(c) {
  const f = Number(c && c.freq);
  const a = Number(c && c.amp);
  return {
    freq: Number.isFinite(f) ? Math.round(Math.max(CUSTOM_FREQ_MIN, Math.min(CUSTOM_FREQ_MAX, f)) * 1000) / 1000 : 220,
    amp: Number.isFinite(a) ? Math.round(Math.max(0, Math.min(1, a)) * 10000) / 10000 : 0,
    on: !(c && c.on === false),
  };
}

/** Convenience rows for the custom source: f0 × 1…count with equal or 1/n amplitudes. */
export function generateHarmonicRows(f0, count, pattern = 'equal') {
  return Array.from({ length: count }, (_, i) => ({ freq: Math.round((i + 1) * f0 * 1000) / 1000, amp: pattern === 'falling' ? Math.round((1 / (i + 1)) * 10000) / 10000 : 1, on: true }));
}

/** Gain each active component receives (the filter evaluated at its frequency). */
export function componentGains(components, bands, sampleRate, enabled = true) {
  const act = activeComponents(components, sampleRate);
  const db = responseDb(bands, act.map((c) => c.freq), sampleRate, enabled);
  return act.map((c, i) => ({ ...c, gainDb: db[i], after: c.amp * 10 ** (db[i] / 20) }));
}

/** Σ amp · sin(2π f t) with every phase 0, the same recurrence as renderRecipe. */
function renderComponentSum(components, sampleRate, n, gain) {
  const acc = new Float64Array(n);
  for (const c of activeComponents(components, sampleRate)) {
    const w = (2 * Math.PI * c.freq) / sampleRate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    let si = 0;
    let co = 1;
    const a = c.amp * gain;
    for (let i = 0; i < n; i++) {
      acc[i] += a * si;
      const s2 = si * cw + co * sw;
      co = co * cw - si * sw;
      si = s2;
    }
  }
  return acc;
}

// ───────────── the filter ─────────────

export function defaultBands() {
  return DEFAULT_CENTRES.map((f) => ({ f, gainDb: 0, q: DEFAULT_Q }));
}

export function clampBand(b, sampleRate = PREFERRED_RATE) {
  const fMax = Math.min(F_MAX, 0.45 * sampleRate);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    f: round(Math.max(F_MIN, Math.min(fMax, num(b && b.f, 1000))), 1),
    gainDb: round(Math.max(GAIN_MIN, Math.min(GAIN_MAX, num(b && b.gainDb, 0))), 2),
    q: round(Math.max(Q_MIN, Math.min(Q_MAX, num(b && b.q, DEFAULT_Q))), 3),
  };
}

/** Normalized biquad coefficients of one Web Audio "peaking" filter. */
export function peakingCoefficients({ f, gainDb, q }, sampleRate) {
  const w0 = (2 * Math.PI * f) / sampleRate;
  const A = 10 ** (gainDb / 40);
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  const a0 = 1 + alpha / A;
  return { b0: (1 + alpha * A) / a0, b1: (-2 * c) / a0, b2: (1 - alpha * A) / a0, a1: (-2 * c) / a0, a2: (1 - alpha / A) / a0 };
}

/** |H(f)| of one set of coefficients, in dB. */
export function coefResponseDb(k, f, sampleRate) {
  const w = (2 * Math.PI * f) / sampleRate;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = k.b0 + k.b1 * c1 + k.b2 * c2;
  const ni = -(k.b1 * s1 + k.b2 * s2);
  const dr = 1 + k.a1 * c1 + k.a2 * c2;
  const di = -(k.a1 * s1 + k.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-30);
}

export function bandResponseDb(band, f, sampleRate) {
  return coefResponseDb(peakingCoefficients(band, sampleRate), f, sampleRate);
}

/** Total response of the cascade at each frequency, in dB (0 everywhere when bypassed). */
export function responseDb(bands, freqs, sampleRate, enabled = true) {
  const out = new Float64Array(freqs.length);
  if (!enabled) return out;
  for (const b of bands) {
    const k = peakingCoefficients(b, sampleRate);
    for (let i = 0; i < freqs.length; i++) out[i] += coefResponseDb(k, freqs[i], sampleRate);
  }
  return out;
}

/** Gain each active harmonic receives: the filter is evaluated only at n × f0. */
export function harmonicGains(f0, count, bands, sampleRate, enabled = true) {
  const hs = activeHarmonics(f0, count, sampleRate);
  const db = responseDb(bands, hs.map((x) => x.freq), sampleRate, enabled);
  return hs.map((x, i) => ({ ...x, sourceAmp: 1, gainDb: db[i], amp: 10 ** (db[i] / 20) }));
}

/** Bandwidth in octaves of a peaking filter with this Q (Audio EQ Cookbook). */
export function qToOctaves(q) {
  return (2 / Math.LN2) * Math.asinh(1 / (2 * q));
}

/** Runs x through the cascade (transposed direct form II, double precision). */
export function applyFilter(x, bands, sampleRate) {
  const y = Float64Array.from(x);
  for (const b of bands) {
    const k = peakingCoefficients(b, sampleRate);
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      const o = k.b0 * v + z1;
      z1 = k.b1 * v - k.a1 * o + z2;
      z2 = k.b2 * v - k.a2 * o;
      y[i] = o;
    }
  }
  return y;
}

/** The unfiltered source exactly as played: unit amplitudes, gain g, linear fades. */
export function renderSource({ f0, count, components = null, sampleRate, duration, fadeSec = M.FADE_SEC }) {
  if (!components) return M.renderRecipe({ f0, amps: sourceAmps(count), sampleRate, duration, gain: sourceGain(f0, count, sampleRate), fadeSec });
  const n = Math.max(1, Math.round(duration * sampleRate));
  const acc = renderComponentSum(components, sampleRate, n, componentGain(components, sampleRate));
  const fadeN = Math.min(Math.floor(n / 2), Math.round(fadeSec * sampleRate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < fadeN) g = i / fadeN;
    else if (i >= n - fadeN) g = (n - 1 - i) / fadeN;
    out[i] = acc[i] * g;
  }
  return out;
}

/**
 * What playback and the WAV export produce: the faded source, then
 * TAIL_SEC of silence so the filter can ring out, through the cascade
 * (or around it when `enabled` is false). The filter starts at rest, like
 * the live BiquadFilterNodes. Returns a Float32Array.
 */
export function renderFiltered({ f0, count, components = null, bands, enabled = true, sampleRate, duration, fadeSec = M.FADE_SEC, tailSec = TAIL_SEC, makeup = 1 }) {
  const src = renderSource({ f0, count, components, sampleRate, duration, fadeSec });
  const x = new Float64Array(src.length + Math.round(tailSec * sampleRate));
  x.set(src);
  if (!enabled) return Float32Array.from(x);
  const y = applyFilter(x, bands, sampleRate);
  if (makeup !== 1) for (let i = 0; i < y.length; i++) y[i] *= makeup;
  return Float32Array.from(y);
}

/** Steady part only (for spectra): renders extra, drops the start-up transient. */
export function renderSteady({ f0, count, components = null, bands, enabled = true, sampleRate, length }) {
  const pre = Math.round(0.1 * sampleRate);
  const total = (pre + length) / sampleRate;
  const y = renderFiltered({ f0, count, components, bands, enabled, sampleRate, duration: total, fadeSec: 0, tailSec: 0 });
  return y.subarray(pre, pre + length);
}

export const MAKEUP_MAX_DB = 40;

/**
 * Optional makeup gain (off by default in the page): the one constant factor
 * that puts the filtered sound's steady peak at the unfiltered peak. It
 * changes only the overall level of the filtered sound, never the balance of
 * its harmonics, and it hides how much the filter removed, so the page labels
 * it whenever it is on.
 */
export function makeupGain(f0, count, bands, sampleRate, components = null) {
  const len = Math.round(0.25 * sampleRate);
  const dry = peakOf(renderSteady({ f0, count, components, bands, enabled: false, sampleRate, length: len }));
  const wet = peakOf(renderSteady({ f0, count, components, bands, enabled: true, sampleRate, length: len }));
  if (!(wet > 1e-9)) return 1;
  return Math.min(10 ** (MAKEUP_MAX_DB / 20), Math.max(1, dry / wet));
}

export function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return p;
}

export function rmsOf(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

// ───────────── vowel examples ─────────────

// Average formant frequencies (Hz) of American English vowels spoken in
// /hVd/ words, from Hillenbrand, Getty, Clark & Wheeler (1995), JASA 97(5),
// Table V. These are group averages, not targets for any one voice.
export const FORMANT_SETS = {
  women: { name: 'Adult women (averages)', f4: 4000, f5: 4600 },
  men: { name: 'Adult men (averages)', f4: 3300, f5: 3750 },
};
export const FILTER_VOWELS = [
  { id: 'A', name: 'Aa', ipa: 'ɑ', word: 'father', say: '“aa”, as in father or spa', formants: { men: [768, 1333, 2522], women: [936, 1551, 2815] } },
  { id: 'E', name: 'Eh', ipa: 'ɛ', word: 'bed', say: '“eh”, as in bed or head', formants: { men: [580, 1799, 2605], women: [731, 2058, 2979] } },
  { id: 'I', name: 'Ee', ipa: 'i', word: 'see', say: '“ee”, as in see or heed', formants: { men: [342, 2322, 3000], women: [437, 2761, 3372] } },
  { id: 'O', name: 'Oh', ipa: 'o', word: 'go', say: '“oh”, as in go, but held steady: no “w” glide at the end, like the o in Spanish “no”', formants: { men: [497, 910, 2459], women: [555, 1035, 2828] } },
  { id: 'U', name: 'Oo', ipa: 'u', word: 'food', say: '“oo”, as in food or who’d', formants: { men: [378, 997, 2343], women: [459, 1105, 2735] } },
];
export const VOWEL_LABELS = [...FILTER_VOWELS.map((v) => v.id), 'other'];
export const BANDWIDTHS = [90, 110, 170, 250, 300]; // Hz, broad-ish formant bandwidths (F1…F5)
export const EXAMPLE_TILT = -6; // dB per octave above 100 Hz: glottal source (−12) + lip radiation (+6)

export function vowelInfo(id) {
  return FILTER_VOWELS.find((v) => v.id === id) || null;
}

/**
 * A smooth vowel-like spectral envelope in dB: a cascade of five two-pole
 * resonances at F1…F5 (each 1 at 0 Hz, as in Klatt's 1980 cascade formant
 * synthesizer) plus a −6 dB/octave slope for the voice source and lip
 * radiation, shifted so its highest point is 0 dB.
 */
export function formantEnvelopeDb(freqs, formants, { tilt = EXAMPLE_TILT, bandwidths = BANDWIDTHS } = {}) {
  const raw = freqs.map((f) => {
    let db = 0;
    formants.forEach((F, i) => {
      const B = bandwidths[i] / 2;
      db += 20 * Math.log10((F * F + B * B) / Math.sqrt(((f - F) ** 2 + B * B) * ((f + F) ** 2 + B * B)));
    });
    if (f > 100) db += tilt * Math.log2(f / 100);
    return db;
  });
  const top = Math.max(...raw);
  return raw.map((d) => Math.max(GAIN_MIN * 1.5, d - top));
}

export function exampleFormants(vowelId, set = 'women') {
  const v = vowelInfo(vowelId);
  const s = FORMANT_SETS[set] || FORMANT_SETS.women;
  return [...v.formants[set in FORMANT_SETS ? set : 'women'], s.f4, s.f5];
}

const exampleCache = new Map();
/**
 * The example filter for a vowel: the band filter fitted (with fitFilter) to
 * formantEnvelopeDb on a 40 Hz grid from 100 to 5500 Hz. Deterministic, so
 * the same example always loads the same filter.
 */
export function exampleFilter(vowelId, set = 'women', sampleRate = PREFERRED_RATE) {
  const key = `${vowelId}:${set}:${sampleRate}`;
  if (exampleCache.has(key)) return clone(exampleCache.get(key));
  const formants = exampleFormants(vowelId, set);
  const freqs = [];
  for (let f = 100; f <= 5500; f += 40) freqs.push(f);
  const env = formantEnvelopeDb(freqs, formants);
  const points = freqs.map((f, i) => ({ freq: f, db: env[i], kind: 'measured' }));
  const fit = fitFilter(points, { sampleRate });
  const out = { vowel: vowelId, set, formants: formants.slice(0, 3), bands: fit.bands, fit: fitSummary(fit), envelope: { freqs, db: env } };
  exampleCache.set(key, out);
  return clone(out);
}

// ───────────── measuring a recording ─────────────

/**
 * Turns a recording section into per-harmonic targets for fitting:
 *   • harmonics the automatic analysis (auto-vowel.js) kept: their measured
 *     level in dB re the strongest harmonic ("measured" points);
 *   • the others (lost in noise, or too weak to trust): the level of the
 *     averaged spectrum near n × f0, used only as an upper limit ("upper"
 *     points: the filter must not let more through, but may cut deeper).
 * `f0Override` re-measures at a typed fundamental (a manual value).
 * Returns { ok, analysis, f0, f0Source, points, problems, warnings }.
 */
export function measureTargets(x, sampleRate, { from = 0, to = x.length, f0Override = null, count = M.MAX_HARMONICS } = {}) {
  const analysis = AV.analyzeVowel(x, sampleRate, { from, to, f0Override });
  if (!analysis.amps) return { ok: false, analysis, f0: analysis.f0, f0Source: analysis.f0Source, points: [], problems: analysis.problems, warnings: analysis.warnings };
  const f0 = analysis.f0;
  const fft = nextPow2(Math.max(4096, Math.round(sampleRate * 0.17)));
  const spec = M.segmentSpectrum(x, sampleRate, { from, to, fftSize: fft });
  const near = (f) => {
    const lo = Math.max(1, Math.ceil((f - 0.3 * f0) / spec.binHz));
    const hi = Math.min(spec.db.length - 1, Math.floor((f + 0.3 * f0) / spec.binHz));
    let m = -Infinity;
    for (let k = lo; k <= hi; k++) if (spec.db[k] > m) m = spec.db[k];
    return m;
  };
  const strongest = analysis.harmonics.find((hm) => hm.n === analysis.strongest);
  const ref = near(strongest.n * f0);
  const floor = GAIN_MIN * 1.5;
  const points = [];
  for (let n = 1; n <= count; n++) {
    const freq = n * f0;
    if (freq >= sampleRate / 2) break;
    const hm = analysis.harmonics[n - 1];
    if (hm && hm.kept && hm.relDb != null) points.push({ n, freq, db: Math.max(floor, hm.relDb), kind: 'measured' });
    else points.push({ n, freq, db: Math.max(floor, Math.min(0, near(freq) - ref)), kind: 'upper', reason: hm ? hm.reason || 'weak' : 'above the analysed range' });
  }
  return { ok: true, analysis, f0, f0Source: analysis.f0Source, points, problems: analysis.problems, warnings: analysis.warnings };
}

// ───────────── fitting ─────────────

export const FIT_SETTINGS = {
  offsetMin: -12, // dB: how far the whole target may be lowered so cuts alone can reach it
  qPrior: 2, // dB-equivalent cost per e-fold change of Q away from DEFAULT_Q
  fPrior: 1.5, // dB-equivalent cost per e-fold move of a centre from its start
  gainPrior: 0.02, // tiny pull of unused bands back to 0 dB
  iterations: 80,
};

/**
 * Fits the BAND_COUNT bands (centre, cut, Q) and one overall level offset c
 * so the filter's response at the points' frequencies matches db + c:
 *   measured points: residual H(f) − (db + c)
 *   upper points:    residual max(0, H(f) − (db + c))
 * Stage 1 fits the cuts at the default centres and Q; stage 2 frees centres
 * and Q as well (with gentle priors), and is kept only if it fits better.
 * Bounds: cuts GAIN_MIN…0 dB (never a boost), Q Q_MIN…Q_MAX, centres
 * F_MIN…min(F_MAX, 0.45·rate), c offsetMin…0.
 * Returns { bands, offsetDb, rmsDb, maxAbsDb, upperExcessDb, points: [... got, err] }.
 */
export function fitFilter(points, { sampleRate = PREFERRED_RATE, start = null } = {}) {
  const S = FIT_SETTINGS;
  const freqs = points.map((p) => p.freq);
  const meas = points.map((p) => p.kind !== 'upper');
  const fHi = Math.min(F_MAX, 0.45 * sampleRate, Math.max(...freqs) * 1.3 || F_MAX);
  const init = (start || defaultBands()).map((b) => clampBand(b, sampleRate));
  // Start the cuts from the target itself, where it lies below 0 dB.
  const targetAt = (f) => {
    let best = points[0];
    for (const p of points) if (Math.abs(Math.log(p.freq / f)) < Math.abs(Math.log(best.freq / f))) best = p;
    return best ? best.db : 0;
  };
  if (!start) for (const b of init) b.gainDb = Math.max(GAIN_MIN, Math.min(0, targetAt(b.f) * 0.5));

  const dataResid = (bands, c) => {
    const H = responseDb(bands, freqs, sampleRate);
    return points.map((p, i) => {
      const e = H[i] - (p.db + c);
      return meas[i] ? e : Math.max(0, e);
    });
  };
  const cost = (r) => r.reduce((s, v) => s + v * v, 0);

  // Stage 1: cuts + offset, centres and Q fixed.
  const n = init.length;
  const x1 = [...init.map((b) => b.gainDb), 0];
  const lo1 = [...init.map(() => GAIN_MIN), S.offsetMin];
  const hi1 = [...init.map(() => GAIN_MAX), 0];
  const bands1 = (x) => init.map((b, i) => ({ f: b.f, q: b.q, gainDb: x[i] }));
  const r1 = (x) => [...dataResid(bands1(x), x[n]), ...x.slice(0, n).map((g) => S.gainPrior * g)];
  const s1 = levenbergMarquardt(x1, lo1, hi1, r1, S.iterations);
  let best = { bands: bands1(s1), c: s1[n] };
  let bestCost = cost(dataResid(best.bands, best.c));

  // Stage 2: everything free (log centre, cut, log Q) + offset.
  const u0 = best.bands.map((b) => Math.log(b.f));
  const v0 = Math.log(DEFAULT_Q);
  const x2 = [];
  const lo2 = [];
  const hi2 = [];
  best.bands.forEach((b, i) => {
    x2.push(u0[i], b.gainDb, Math.log(b.q));
    lo2.push(Math.log(F_MIN), GAIN_MIN, Math.log(Q_MIN));
    hi2.push(Math.log(fHi), GAIN_MAX, Math.log(Q_MAX));
  });
  x2.push(best.c); lo2.push(S.offsetMin); hi2.push(0);
  const bands2 = (x) => Array.from({ length: n }, (_, i) => ({ f: Math.exp(x[3 * i]), gainDb: x[3 * i + 1], q: Math.exp(x[3 * i + 2]) }));
  const r2 = (x) => {
    const reg = [];
    for (let i = 0; i < n; i++) reg.push(S.fPrior * (x[3 * i] - u0[i]), S.qPrior * (x[3 * i + 2] - v0), S.gainPrior * x[3 * i + 1]);
    return [...dataResid(bands2(x), x[3 * n]), ...reg];
  };
  const s2 = levenbergMarquardt(x2, lo2, hi2, r2, S.iterations);
  const cand = { bands: bands2(s2).map((b) => clampBand(b, sampleRate)), c: s2[3 * n] };
  const candCost = cost(dataResid(cand.bands, cand.c));
  if (candCost < bestCost) { best = cand; bestCost = candCost; }
  best.bands = best.bands.map((b) => clampBand(b, sampleRate));
  return scoreFit(points, best.bands, round(best.c, 2), sampleRate);
}

/** How well `bands` (with level offset c) follow the points. */
export function scoreFit(points, bands, offsetDb, sampleRate) {
  const H = responseDb(bands, points.map((p) => p.freq), sampleRate);
  let se = 0;
  let nm = 0;
  let maxAbs = 0;
  let upperExcess = 0;
  const out = points.map((p, i) => {
    const want = p.db + offsetDb;
    const err = H[i] - want;
    if (p.kind !== 'upper') { se += err * err; nm++; maxAbs = Math.max(maxAbs, Math.abs(err)); } else if (err > 0) upperExcess = Math.max(upperExcess, err);
    return { ...p, want, got: H[i], err };
  });
  return { bands, offsetDb, rmsDb: nm ? Math.sqrt(se / nm) : 0, maxAbsDb: maxAbs, upperExcessDb: upperExcess, measuredCount: nm, upperCount: points.length - nm, points: out };
}

export function fitSummary(fit) {
  return {
    method: 'Levenberg–Marquardt least squares in dB on the 8 peaking-cut bands (centre, cut, Q) plus one level offset; upper-limit points only penalized when exceeded',
    rmsErrorDb: round(fit.rmsDb, 2),
    maxErrorDb: round(fit.maxAbsDb, 2),
    upperLimitExcessDb: round(fit.upperExcessDb, 2),
    levelOffsetDb: fit.offsetDb,
    measuredPoints: fit.measuredCount,
    upperLimitPoints: fit.upperCount,
  };
}

/** Bounded Levenberg–Marquardt with a forward-difference Jacobian. */
export function levenbergMarquardt(x0, lo, hi, resid, iterations = 80) {
  const clampX = (x) => x.map((v, i) => Math.max(lo[i], Math.min(hi[i], v)));
  let x = clampX(x0);
  let r = resid(x);
  let c = dot(r, r);
  let lambda = 1e-2;
  const m = x.length;
  for (let it = 0; it < iterations; it++) {
    const J = [];
    for (let j = 0; j < m; j++) {
      const step = 1e-4 * Math.max(1, hi[j] - lo[j]);
      const xs = [...x];
      xs[j] = x[j] + step <= hi[j] ? x[j] + step : x[j] - step;
      const d = xs[j] - x[j];
      const rs = resid(xs);
      J.push(rs.map((v, k) => (v - r[k]) / d));
    }
    const A = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => dot(J[a], J[b])));
    const g = J.map((col) => dot(col, r));
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const Ad = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-9 : v)));
      const delta = solve(Ad, g.map((v) => -v));
      if (!delta) { lambda *= 10; continue; }
      const xn = clampX(x.map((v, i) => v + delta[i]));
      const rn = resid(xn);
      const cn = dot(rn, rn);
      if (cn < c) {
        const rel = (c - cn) / Math.max(1e-12, c);
        x = xn; r = rn; c = cn;
        lambda = Math.max(1e-7, lambda / 3);
        improved = rel > 1e-7;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return x;
}

function solve(A, b) {
  const n = b.length;
  const M2 = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let p = col;
    for (let i = col + 1; i < n; i++) if (Math.abs(M2[i][col]) > Math.abs(M2[p][col])) p = i;
    if (Math.abs(M2[p][col]) < 1e-14) return null;
    [M2[col], M2[p]] = [M2[p], M2[col]];
    for (let i = col + 1; i < n; i++) {
      const f = M2[i][col] / M2[col][col];
      for (let k = col; k <= n; k++) M2[i][k] -= f * M2[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M2[i][n];
    for (let k = i + 1; k < n; k++) s -= M2[i][k] * x[k];
    x[i] = s / M2[i][i];
  }
  return x;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ───────────── filter experiments ─────────────

export const ORIGINS = {
  manual: 'shaped by hand',
  example: 'loaded from a vowel example (approximate preset)',
  fitted: 'automatically fitted to a recording',
};

export const WORKFLOWS = {
  explore: 'Explore vowel examples (no recording)',
  custom: 'Filter my own frequencies (no recording)',
  recording: 'Match a recording',
};
export const SOURCES = {
  harmonics: 'Equal-strength harmonics',
  custom: 'My own frequencies',
};

/**
 * A filter experiment. With source 'harmonics' the amplitudes are always 1,
 * whatever is passed in. With source 'custom' the person's rows are kept as
 * they are (only cleaned to valid numbers). Records saved before workflows
 * existed open in 'recording' (if they had one) or 'explore'.
 */
export function makeFilterExperiment(p = {}) {
  const count = Math.max(M.MIN_HARMONICS, Math.min(M.MAX_HARMONICS, Math.round(Number(p.count)) || M.DEFAULT_HARMONICS));
  const bands = Array.isArray(p.filter && p.filter.bands) && p.filter.bands.length === BAND_COUNT
    ? p.filter.bands.map((b) => clampBand(b)) : defaultBands();
  const source = p.source === 'custom' ? 'custom' : 'harmonics';
  const components = Array.isArray(p.components) ? p.components.slice(0, CUSTOM_MAX).map(cleanComponent) : [];
  let workflow = p.workflow in WORKFLOWS ? p.workflow : p.recordingId ? 'recording' : 'explore';
  if (source === 'custom') workflow = 'custom';
  else if (workflow === 'custom') workflow = 'explore';
  return {
    id: p.id || M.newId('flt'),
    kind: 'vowel-filter',
    workflow,
    source,
    vowel: VOWEL_LABELS.includes(p.vowel) ? p.vowel : 'U',
    vowelText: String(p.vowelText || ''),
    f0: Number.isFinite(p.f0) && p.f0 >= M.F0_MIN && p.f0 <= M.F0_MAX ? p.f0 : M.DEFAULT_F0,
    f0Source: ['typed', 'automatic', 'default'].includes(p.f0Source) ? p.f0Source : 'typed',
    count,
    sourceAmps: sourceAmps(count),
    components,
    filter: { type: FILTER_TYPE, bands, enabled: p.filter ? p.filter.enabled !== false : true },
    recordingId: p.recordingId || null,
    recordingName: p.recordingName || null,
    segment: p.segment && Number.isFinite(+p.segment.start) && Number.isFinite(+p.segment.end) ? { start: +p.segment.start, end: +p.segment.end } : null,
    origin: p.origin in ORIGINS ? p.origin : 'manual',
    example: p.example && typeof p.example === 'object' ? { vowel: p.example.vowel, set: p.example.set, formants: [...(p.example.formants || [])] } : null,
    fit: p.fit && typeof p.fit === 'object' ? JSON.parse(JSON.stringify(p.fit)) : null,
    editedAfter: !!p.editedAfter,
    notes: String(p.notes || ''),
    createdAt: p.createdAt || new Date().toISOString(),
    savedAt: p.savedAt || null,
  };
}

export function vowelName(id) {
  const v = vowelInfo(id);
  return v ? `${v.name} (“${v.word}”)` : id;
}

export function vowelLabel(e) {
  if (e.vowel === 'other') return (e.vowelText || '').trim() || 'vowel';
  const v = vowelInfo(e.vowel);
  return `${v.name} /${v.ipa}/ (“${v.word}”)`;
}

export function originTag(e) {
  const base = e.origin === 'fitted' ? 'fitted' : e.origin === 'example' ? 'example' : 'manual';
  return e.origin !== 'manual' && e.editedAfter ? `${base}, then edited` : base;
}

export function sourceTag(e) {
  return e.source === 'custom' ? `${e.components.length} own component${e.components.length === 1 ? '' : 's'}` : `${fmt(e.f0)} Hz × ${e.count} equal harmonics`;
}

export function filterLabel(e) {
  return `${vowelLabel(e)} · ${sourceTag(e)} · ${originTag(e)} filter`;
}

export function filterFileBase(e) {
  const v = e.vowel === 'other' ? M.slug(vowelLabel(e)) : vowelInfo(e.vowel).name.toLowerCase();
  const src = e.source === 'custom' ? `custom${e.components.length}` : `${Math.round(e.f0)}hz`;
  return `filter_${v}_${src}_${e.origin}${e.origin !== 'manual' && e.editedAfter ? '_edited' : ''}`;
}

export const FILTER_FORMAT = 'frequency-playground.vowel-filter-experiment';

/** The settings file: everything needed to rebuild the same sound. */
export function filterSettingsDocument(e, { sampleRate = PREFERRED_RATE, recording = null, durationSec = null, makeup = 1 } = {}) {
  const base = filterFileBase(e);
  const comps = sourceComponents(e);
  const gains = componentGains(comps, e.filter.bands, sampleRate, true);
  const custom = e.source === 'custom';
  const doc = {
    format: FILTER_FORMAT,
    version: 2,
    savedAt: e.savedAt || null,
    label: filterLabel(e),
    workflow: e.workflow,
    workflowMeaning: WORKFLOWS[e.workflow],
    vowel: e.vowel,
    vowelLabel: vowelLabel(e),
    origin: e.origin,
    originMeaning: ORIGINS[e.origin],
    editedAfterOrigin: e.editedAfter,
    example: e.example,
    automaticFit: e.fit,
    sourceType: e.source,
    sourceTypeMeaning: SOURCES[e.source],
    fundamentalHz: custom ? null : e.f0,
    fundamentalSource: custom ? null : e.f0Source === 'automatic' ? 'automatic estimate (YIN)' : e.f0Source === 'default' ? 'default value, not matched to a recording' : 'typed by hand',
    harmonicCount: custom ? null : e.count,
    source: custom ? {
      components: e.components.map((c, i) => ({ row: i + 1, frequencyHz: c.freq, amplitude: c.amp, included: c.on !== false })),
      meaning: 'the person’s own components (not necessarily harmonics), with their own amplitudes, kept unchanged by the filter',
      formula: 'x(t) = g · Σᵢ aᵢ · sin(2π · fᵢ · t), included rows below Nyquist only',
      gain: `g = ${SAFE_PEAK} ÷ Σ aᵢ = ${round(componentGain(comps, sampleRate), 6)}; the same g with the filter on or bypassed`,
      phases: 'every sine starts at phase 0',
    } : {
      amplitudes: [...e.sourceAmps],
      meaning: 'every component (the fundamental and each harmonic) has relative amplitude 1',
      formula: 'x(t) = g · Σₙ sin(2π · n · f0 · t), n = 1 … harmonicCount, below Nyquist only',
      gain: `g = ${SAFE_PEAK} ÷ (number of active components) = ${round(sourceGain(e.f0, e.count, sampleRate), 6)}; the same g with the filter on or bypassed`,
      phases: 'every sine starts at phase 0',
    },
    filter: {
      type: FILTER_TYPE,
      description: `${BAND_COUNT} Web Audio BiquadFilterNode "peaking" filters in series, each with gain ≤ 0 dB (cut only)`,
      enabled: e.filter.enabled,
      bands: e.filter.bands.map((b, i) => ({ band: i + 1, centreHz: b.f, gainDb: b.gainDb, q: b.q, bandwidthOctaves: round(qToOctaves(b.q), 3), coefficients: mapRound(peakingCoefficients(b, sampleRate), 9) })),
      coefficientSampleRate: sampleRate,
      coefficientFormula: 'Audio EQ Cookbook peaking EQ as specified for BiquadFilterNode: A = 10^(G/40), α = sin(ω0)/(2Q)',
    },
    components: gains.map((x) => ({ ...(x.n ? { n: x.n } : {}), frequencyHz: round(x.freq, 3), sourceAmplitude: x.amp, filterGainDb: round(x.gainDb, 2), amplitudeAfterFilter: round(x.after, 5) })),
    render: { sampleRate, durationSec, fadeMs: M.FADE_SEC * 1000, filterTailMs: TAIL_SEC * 1000, note: 'the faded source is filtered from rest; the file includes the short ring-out after the source ends' },
    level: makeup === 1
      ? { mode: 'fixed', makeupDb: 0, meaning: 'the filtered sound is not turned back up: its level shows the filter’s real reduction' }
      : { mode: 'peak-matched makeup (optional, chosen in the page)', makeupDb: round(20 * Math.log10(makeup), 2), meaning: 'one constant gain after the filter raises the filtered peak to the unfiltered peak; balance unchanged' },
    recording: recording ? { name: recording.name, sampleRate: recording.sampleRate, durationSec: round(recording.samples.length / recording.sampleRate, 3), sectionSec: e.segment ? [e.segment.start, e.segment.end] : null } : (e.recordingName ? { name: e.recordingName, sectionSec: e.segment ? [e.segment.start, e.segment.end] : null } : null),
    files: { filtered: `${base}_filtered.wav`, settings: `${base}_settings.json` },
    notes: e.notes,
  };
  if (!custom) doc.harmonics = doc.components.map((x) => ({ n: x.n, frequencyHz: x.frequencyHz, sourceAmplitude: 1, filterGainDb: x.filterGainDb, amplitudeAfterFilter: x.amplitudeAfterFilter }));
  return doc;
}

/** Reads a settings file back (version 1 or 2). Returns { ok, experiment, warnings } or { ok: false, error }. */
export function parseFilterSettings(doc) {
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'The file is not a JSON object.' };
  if (doc.format !== FILTER_FORMAT) return { ok: false, error: 'This is not a Vowel filtering settings file (format field missing or different).' };
  const warnings = [];
  const custom = doc.sourceType === 'custom';
  const f0 = custom ? M.DEFAULT_F0 : Number(doc.fundamentalHz);
  if (!custom && (!Number.isFinite(f0) || f0 < M.F0_MIN || f0 > M.F0_MAX)) return { ok: false, error: `fundamentalHz must be ${M.F0_MIN}–${M.F0_MAX}.` };
  let components = [];
  if (custom) {
    const list = doc.source && Array.isArray(doc.source.components) ? doc.source.components : null;
    if (!list || !list.length) return { ok: false, error: 'A custom-source file must list its components.' };
    if (list.some((c) => !Number.isFinite(Number(c.frequencyHz)) || !Number.isFinite(Number(c.amplitude)))) return { ok: false, error: 'Every component needs frequencyHz and amplitude.' };
    components = list.map((c) => cleanComponent({ freq: c.frequencyHz, amp: c.amplitude, on: c.included !== false }));
    if (list.length > CUSTOM_MAX) warnings.push(`Only the first ${CUSTOM_MAX} components were kept.`);
  }
  const bands = doc.filter && Array.isArray(doc.filter.bands) ? doc.filter.bands.map((b) => ({ f: Number(b.centreHz), gainDb: Number(b.gainDb), q: Number(b.q) })) : null;
  if (!bands || bands.length !== BAND_COUNT || bands.some((b) => ![b.f, b.gainDb, b.q].every(Number.isFinite))) return { ok: false, error: `The file must list ${BAND_COUNT} filter bands with centreHz, gainDb and q.` };
  if (bands.some((b) => b.gainDb > 0)) warnings.push('Boosts above 0 dB are not supported and were set to 0 dB.');
  if (!custom && doc.source && Array.isArray(doc.source.amplitudes) && doc.source.amplitudes.some((a) => a !== 1)) warnings.push('Source amplitudes other than 1 were ignored: equal-strength harmonics always start every component at 1.');
  const seg = doc.recording && Array.isArray(doc.recording.sectionSec) ? doc.recording.sectionSec : null;
  const experiment = makeFilterExperiment({
    workflow: doc.workflow || (doc.recording ? 'recording' : 'explore'),
    source: custom ? 'custom' : 'harmonics', components,
    vowel: doc.vowel, vowelText: doc.vowel === 'other' ? doc.vowelLabel : '',
    f0, count: doc.harmonicCount, f0Source: /automatic/.test(doc.fundamentalSource || '') ? 'automatic' : 'typed',
    filter: { bands, enabled: doc.filter.enabled !== false },
    recordingName: doc.recording ? doc.recording.name : null,
    segment: seg && seg.length === 2 ? { start: seg[0], end: seg[1] } : null,
    origin: doc.origin, editedAfter: doc.editedAfterOrigin, example: doc.example, fit: doc.automaticFit, notes: doc.notes,
  });
  return { ok: true, experiment, warnings };
}

// ───────────── helpers ─────────────

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function round(v, d) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function mapRound(o, d) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, d)]));
}

function fmt(v) {
  return Number(v.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

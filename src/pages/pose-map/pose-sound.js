// Motion Morph sound model: pitched sounds AND unvoiced noise sounds
// (fricatives such as "sss", "shh", "fff") on one map, blended into ONE
// synthesized sound. Pure logic (no DOM, no Web Audio), unit-tested.
//
// Pitched sound (vowel, hum):   f0 + 48 harmonic strengths (sound-analysis.js)
// Noise sound (fricative):      no f0 at all; the shape of its noise spectrum
//                               as NOISE_BANDS band levels (quarter-octave-ish
//                               bands, 200 Hz–12 kHz)
//
// Blending at a map point with weights wᵢ (sum 1, inverse distance):
//   H = Σ wᵢ over pitched sounds,   N = Σ wᵢ over noise sounds  (H + N = 1)
//   f0 and harmonic strengths: weighted mean over the PITCHED sounds only
//     (weights wᵢ / H), so no pitch is ever invented for a fricative
//   noise band levels: weighted mean over the NOISE sounds only (wᵢ / N)
//   the synthesizer plays the harmonic part at gain √H and the noise part at
//     gain √N, each first brought to the same loudness: an equal-power
//     crossfade, so a half-way point is not quieter than either end.
// A pure fricative point (H = 0) plays only filtered noise; a pure vowel
// point (N = 0) plays only the harmonics, exactly as before.
import { MAX_HARMONICS } from '../frequency/vowel-model.js';
import { fft } from '../frequency/vowel-model.js';

export const NOISE_LO_HZ = 200;
export const NOISE_HI_HZ = 12000;
export const NOISE_BANDS = 24;
export const NOISE_TARGET_RMS = 0.1; // same loudness target as the harmonic synth (TARGET_RMS)

/** Band edges in Hz (NOISE_BANDS + 1 values, log-spaced). */
export function bandEdges() {
  const r = (NOISE_HI_HZ / NOISE_LO_HZ) ** (1 / NOISE_BANDS);
  return Array.from({ length: NOISE_BANDS + 1 }, (_, i) => NOISE_LO_HZ * r ** i);
}
export const BAND_EDGES = Object.freeze(bandEdges());
export const BAND_CENTERS = Object.freeze(BAND_EDGES.slice(0, -1).map((lo, i) => Math.sqrt(lo * BAND_EDGES[i + 1])));

const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));

/**
 * Average noise spectrum of samples[from, to): Welch average of Hann-windowed
 * 2048-point FFT frames, summarized as band levels. Returns
 *   { bands (amplitude, strongest = 1), bandDb, centroidHz, highShare, levelDb, flatness }
 * highShare = share of the power above 2 kHz.
 */
export function noiseSpectrum(x, sampleRate, { from = 0, to = x.length } = {}) {
  const N = 2048;
  const hop = N / 2;
  const w = hann(N);
  const bins = N / 2;
  const psd = new Float64Array(bins);
  let frames = 0;
  let sq = 0;
  for (let i = from; i < to; i++) sq += x[i] * x[i];
  const levelDb = 10 * Math.log10(Math.max(1e-12, sq / Math.max(1, to - from)));
  for (let s = from; s + N <= to; s += hop) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i];
    fft(re, im);
    for (let k = 0; k < bins; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (!frames) return null;
  const binHz = sampleRate / N;
  const bandPow = new Array(NOISE_BANDS).fill(0);
  const bandCnt = new Array(NOISE_BANDS).fill(0);
  let tot = 0;
  let wsum = 0;
  let high = 0;
  let logSum = 0;
  let linSum = 0;
  let flatN = 0;
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    const p = psd[k] / frames;
    if (f >= NOISE_LO_HZ && f < Math.min(NOISE_HI_HZ, sampleRate / 2)) {
      tot += p; wsum += p * f; if (f >= 2000) high += p;
      logSum += Math.log(p + 1e-20); linSum += p; flatN++;
      let b = 0;
      while (b < NOISE_BANDS - 1 && f >= BAND_EDGES[b + 1]) b++;
      bandPow[b] += p; bandCnt[b]++;
    }
  }
  const density = bandPow.map((p, b) => (bandCnt[b] ? p / bandCnt[b] : 0));
  const amp = density.map((d) => Math.sqrt(d));
  const peak = Math.max(...amp);
  const bands = amp.map((a) => (peak > 0 ? a / peak : 0));
  return {
    bands,
    bandDb: bands.map((a) => (a > 0 ? Math.round(20 * Math.log10(a) * 10) / 10 : -120)),
    centroidHz: tot > 0 ? wsum / tot : 0,
    highShare: tot > 0 ? high / tot : 0,
    levelDb,
    flatness: flatN ? Math.exp(logSum / flatN) / (linSum / flatN) : 0,
  };
}

// A recording counts as an unvoiced fricative-like noise when it is clearly
// audible, has (almost) no repeating pitch, and its energy sits mostly above
// 2 kHz ("sss", "shh", "fff" all do; a fan or room rumble does not).
export const NOISE_RULES = Object.freeze({ minLevelDb: -50, maxPeriodicShare: 0.3, minHighShare: 0.5, minCentroidHz: 1500 });

/** Checks a noise spectrum + the pitch analysis's periodic share. Returns { ok, code, reason }. */
export function classifyNoise(spec, periodicShare) {
  if (!spec) return { ok: false, code: 'too-short', reason: 'The recording was too short to measure a noise spectrum.' };
  if (spec.levelDb < NOISE_RULES.minLevelDb) return { ok: false, code: 'silent', reason: `The recording is too quiet (level ${spec.levelDb.toFixed(0)} dBFS).` };
  if (periodicShare > NOISE_RULES.maxPeriodicShare) return { ok: false, code: 'mixed', reason: `${Math.round(periodicShare * 100)} % of the frames had a pitch, so it is neither a clear pitched sound nor clear unvoiced noise (voiced fricatives like “zzz”/“vvv” are not supported yet).` };
  if (spec.highShare < NOISE_RULES.minHighShare || spec.centroidHz < NOISE_RULES.minCentroidHz) {
    return { ok: false, code: 'low-noise', reason: `It is noise, but most of its energy is low (centre ${Math.round(spec.centroidHz)} Hz, ${Math.round(spec.highShare * 100)} % above 2 kHz), like breath on the microphone or room noise, not a fricative.` };
  }
  return { ok: true, code: null, reason: '' };
}

/** Playable parameters of one analysis: { kind, f0, amps, bands }. */
export function soundParams(analysis) {
  if (!analysis) return null;
  if (analysis.kind === 'noise') {
    const b = analysis.noise && Array.isArray(analysis.noise.bands) ? analysis.noise.bands : null;
    if (!b || !b.some((v) => v > 0)) return null;
    return { kind: 'noise', f0: NaN, amps: new Array(MAX_HARMONICS).fill(0), bands: cleanBands(b) };
  }
  const f0 = Number(analysis.f0);
  if (!(f0 > 0) || !Array.isArray(analysis.amps)) return null;
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (let i = 0; i < MAX_HARMONICS && i < analysis.amps.length; i++) { const v = Number(analysis.amps[i]); amps[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  if (!amps.some((v) => v > 0)) return null;
  return { kind: 'pitched', f0, amps, bands: null };
}

export function cleanBands(b) {
  const out = new Array(NOISE_BANDS).fill(0);
  for (let i = 0; i < NOISE_BANDS && i < (b || []).length; i++) { const v = Number(b[i]); out[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  return out;
}

/**
 * Blends [{ params, weight }] (params from soundParams) into one synth setting:
 *   { f0 (NaN when no pitched sound contributes), amps, harm: H, noise: N, bands }
 * See the header for the rules. null when nothing is playable.
 */
export function blendSounds(items) {
  const list = items.filter((it) => it && it.params && it.weight > 0);
  const total = list.reduce((s, it) => s + it.weight, 0);
  if (!list.length || !(total > 0)) return null;
  const pitched = list.filter((it) => it.params.kind !== 'noise');
  const noisy = list.filter((it) => it.params.kind === 'noise');
  const H = pitched.reduce((s, it) => s + it.weight, 0) / total;
  const N = noisy.reduce((s, it) => s + it.weight, 0) / total;
  let f0 = NaN;
  const amps = new Array(MAX_HARMONICS).fill(0);
  if (pitched.length) {
    const ph = pitched.reduce((s, it) => s + it.weight, 0);
    const full = pitched.find((it) => it.weight === ph);
    if (full) { f0 = full.params.f0; for (let n = 0; n < MAX_HARMONICS; n++) amps[n] = full.params.amps[n]; } else {
      f0 = 0;
      for (const it of pitched) {
        const w = it.weight / ph;
        f0 += w * it.params.f0;
        for (let n = 0; n < MAX_HARMONICS; n++) amps[n] += w * (it.params.amps[n] || 0);
      }
    }
  }
  let bands = null;
  if (noisy.length) {
    const nh = noisy.reduce((s, it) => s + it.weight, 0);
    bands = new Array(NOISE_BANDS).fill(0);
    for (const it of noisy) { const w = it.weight / nh; for (let b = 0; b < NOISE_BANDS; b++) bands[b] += w * it.params.bands[b]; }
  }
  return { f0, amps: amps.map((a) => Math.min(1, a)), harm: H, noise: N, bands };
}

/** Synth gains of the two parts (equal-power crossfade). */
export function partGains(p) {
  return { harm: Math.sqrt(Math.max(0, p.harm || 0)), noise: Math.sqrt(Math.max(0, p.noise || 0)) };
}

/**
 * Band-pass filter settings for white noise in −1…1 (variance 1/3) so that the
 * output follows `bands` and has RMS NOISE_TARGET_RMS. A 2nd-order band-pass
 * with bandwidth B passes about (π/2)·B of noise power.
 */
export function noiseFilterTargets(bands, sampleRate) {
  const nyq = sampleRate / 2;
  const list = BAND_CENTERS.map((fc, i) => {
    const lo = BAND_EDGES[i];
    const hi = Math.min(BAND_EDGES[i + 1], nyq * 0.98);
    const bw = Math.max(1, hi - lo);
    return { freq: Math.min(fc, nyq * 0.95), Q: fc / bw, bw, amp: hi > lo ? bands[i] : 0 };
  });
  const varIn = 1 / 3;
  const power = list.reduce((s, b) => s + b.amp * b.amp * varIn * ((Math.PI / 2) * b.bw) / nyq, 0);
  const g = power > 1e-15 ? NOISE_TARGET_RMS / Math.sqrt(power) : 0;
  return list.map((b) => ({ freq: b.freq, Q: b.Q, gain: b.amp * g }));
}

/** "4.2 kHz" style label of the strongest band. */
export function strongestBand(bands) {
  let best = 0;
  for (let i = 1; i < bands.length; i++) if (bands[i] > bands[best]) best = i;
  const f = BAND_CENTERS[best];
  return f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`;
}

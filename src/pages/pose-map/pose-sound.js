// Motion Morph sound model: pitched sounds AND unvoiced noise sounds
// (fricatives such as "sss", "shh", "fff") on one map, blended into ONE
// synthesized sound. Pure logic (no DOM, no Web Audio), unit-tested.
//
// Every sound (a recorded dot, or one learned point of a drawn take) is
//   voiced share v (0…1), f0 + 48 harmonic strengths (when v > 0), and a
//   noise spectrum as NOISE_BANDS band levels (when v < 1):
// Pitched sound (vowel, hum):   v = 1, f0 + harmonics
// Noise sound (fricative):      v = 0, no f0 at all, only the noise spectrum
//                               (quarter-octave-ish bands, 200 Hz–12 kHz)
// Mixed sound ("zzz", breathy): 0 < v < 1, both parts (v = share of the
//                               energy at the harmonics)
//
// Blending at a map point with weights wᵢ (sum 1, inverse distance):
//   H = Σ wᵢ vᵢ (pitched part),   N = Σ wᵢ (1 − vᵢ) (noise part),  H + N = 1
//   f0 and harmonic strengths: weighted mean with weights wᵢ vᵢ, so a
//     fricative never contributes (or invents) a pitch
//   noise band levels: weighted mean with weights wᵢ (1 − vᵢ)
//   the synthesizer plays the harmonic part at gain √H and the noise part at
//     gain √N, each first brought to the same loudness: an equal-power
//     crossfade, so a half-way point is not quieter than either end.
// A pure fricative point (H = 0) plays only filtered noise; a pure vowel
// point (N = 0) plays only the harmonics, exactly as before.
import { MAX_HARMONICS } from '../frequency/vowel-model.js';
import { fft } from '../frequency/vowel-model.js';
import { analyzeVowel } from '../frequency/auto-vowel.js';

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

/**
 * Playable parameters of one analysis (a recorded sound or a take point):
 * { kind: 'pitched' | 'noise' | 'mixed', voiced, f0, amps, bands }.
 * Accepts { kind, f0, amps, voiced, noise: { bands } } or a take point's flat
 * { kind, f0, amps, voiced, bands }. null when nothing is playable.
 */
export function soundParams(analysis) {
  if (!analysis) return null;
  const rawBands = analysis.noise && Array.isArray(analysis.noise.bands) ? analysis.noise.bands : Array.isArray(analysis.bands) ? analysis.bands : null;
  const bands = rawBands ? cleanBands(rawBands) : null;
  const hasBands = !!bands && bands.some((v) => v > 0);
  const f0 = Number(analysis.f0);
  const amps = new Array(MAX_HARMONICS).fill(0);
  if (Array.isArray(analysis.amps)) for (let i = 0; i < MAX_HARMONICS && i < analysis.amps.length; i++) { const v = Number(analysis.amps[i]); amps[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  const hasPitch = f0 > 0 && amps.some((v) => v > 0);
  if (analysis.kind === 'noise') return hasBands ? { kind: 'noise', voiced: 0, f0: NaN, amps: new Array(MAX_HARMONICS).fill(0), bands } : null;
  if (analysis.kind === 'mixed' && hasPitch && hasBands) {
    const v = Math.max(0, Math.min(1, Number(analysis.voiced)));
    return { kind: 'mixed', voiced: Number.isFinite(v) ? v : 0.5, f0, amps, bands };
  }
  return hasPitch ? { kind: 'pitched', voiced: 1, f0, amps, bands: null } : null;
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
  const vOf = (it) => (it.params.voiced != null ? it.params.voiced : it.params.kind === 'noise' ? 0 : 1);
  let H = 0;
  let N = 0;
  for (const it of list) { const w = it.weight / total; H += w * vOf(it); N += w * (1 - vOf(it)); }
  let f0 = NaN;
  const amps = new Array(MAX_HARMONICS).fill(0);
  const pw = list.map((it) => it.weight * vOf(it));
  const ph = pw.reduce((a, b) => a + b, 0);
  if (ph > 0) {
    const fullI = pw.findIndex((x) => x === ph);
    if (fullI >= 0) { f0 = list[fullI].params.f0; for (let n = 0; n < MAX_HARMONICS; n++) amps[n] = list[fullI].params.amps[n]; } else {
      f0 = 0;
      list.forEach((it, i) => {
        if (!pw[i]) return;
        const w = pw[i] / ph;
        f0 += w * it.params.f0;
        for (let n = 0; n < MAX_HARMONICS; n++) amps[n] += w * (it.params.amps[n] || 0);
      });
    }
  }
  let bands = null;
  const nw = list.map((it) => it.weight * (1 - vOf(it)));
  const nh = nw.reduce((a, b) => a + b, 0);
  if (nh > 0) {
    bands = new Array(NOISE_BANDS).fill(0);
    list.forEach((it, i) => { if (!nw[i]) return; const w = nw[i] / nh; for (let b = 0; b < NOISE_BANDS; b++) bands[b] += w * it.params.bands[b]; });
  }
  return { f0, amps: amps.map((a) => Math.min(1, a)), harm: H, noise: N, bands };
}

/** A blend result as parameters again (so a take's interpolated point can enter the map blend). */
export function asParams(b) {
  if (!b) return null;
  const hasPitch = Number.isFinite(b.f0) && b.harm > 0;
  const hasNoise = !!b.bands && b.noise > 0;
  if (hasPitch && !hasNoise) return { kind: 'pitched', voiced: 1, f0: b.f0, amps: b.amps, bands: null };
  if (!hasPitch && hasNoise) return { kind: 'noise', voiced: 0, f0: NaN, amps: new Array(MAX_HARMONICS).fill(0), bands: b.bands };
  if (!hasPitch && !hasNoise) return null;
  return { kind: 'mixed', voiced: b.harm, f0: b.f0, amps: b.amps, bands: b.bands };
}

/**
 * A drawn take as ONE source on the map. Its learned points (in time order,
 * each with pos {x, y} and params) form a line; the source sits at the point
 * of that line nearest to `here`, and its sound is interpolated between the
 * two learned points on either side. So a take with 40 points counts like
 * one dot that slides along the line, instead of 40 dots that together would
 * outweigh a single recorded sound.
 * Returns { pos, params, i, u, distance } (i = index of the segment start, u = 0…1 along it).
 */
export function takeSource(points, here) {
  const pts = points.filter((p) => p && p.pos && p.params);
  if (!pts.length) return null;
  if (pts.length === 1) return { pos: { ...pts[0].pos }, params: pts[0].params, i: 0, u: 0, distance: Math.hypot(pts[0].pos.x - here.x, pts[0].pos.y - here.y) };
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i].pos; const b = pts[i + 1].pos;
    const dx = b.x - a.x; const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const u = L2 > 1e-12 ? Math.max(0, Math.min(1, ((here.x - a.x) * dx + (here.y - a.y) * dy) / L2)) : 0;
    const q = { x: a.x + u * dx, y: a.y + u * dy };
    const d = Math.hypot(q.x - here.x, q.y - here.y);
    if (!best || d < best.distance - 1e-12) best = { pos: q, i, u, distance: d };
  }
  const A = pts[best.i].params; const B = pts[best.i + 1].params;
  best.params = best.u <= 1e-9 ? A : best.u >= 1 - 1e-9 ? B : asParams(blendSounds([{ params: A, weight: 1 - best.u }, { params: B, weight: best.u }]));
  return best;
}

/**
 * Pitched vs noise energy of samples[from, to) with a known f0: power within
 * ±max(15 % of f0, 2 FFT bins) of each harmonic counts as pitched, the rest
 * (200 Hz–12 kHz) as noise. Returns { noiseShare, bands (of the residual), highShare }.
 */
export function harmonicResidual(x, sampleRate, f0, { from = 0, to = x.length } = {}) {
  const N = 2048;
  const hop = N / 2;
  const w = hann(N);
  const bins = N / 2;
  const psd = new Float64Array(bins);
  let frames = 0;
  for (let s = from; s + N <= to; s += hop) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * w[i];
    fft(re, im);
    for (let k = 0; k < bins; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (!frames || !(f0 > 0)) return null;
  const binHz = sampleRate / N;
  const half = Math.max(0.15 * f0, 2 * binHz);
  let harm = 0; let res = 0; let high = 0;
  const bandPow = new Array(NOISE_BANDS).fill(0);
  const bandCnt = new Array(NOISE_BANDS).fill(0);
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    if (f < NOISE_LO_HZ || f >= Math.min(NOISE_HI_HZ, sampleRate / 2)) continue;
    const p = psd[k] / frames;
    const n = Math.round(f / f0);
    const nearHarm = n >= 1 && n <= MAX_HARMONICS && Math.abs(f - n * f0) <= half;
    let b = 0;
    while (b < NOISE_BANDS - 1 && f >= BAND_EDGES[b + 1]) b++;
    bandCnt[b]++;
    if (nearHarm) { harm += p; continue; }
    res += p; bandPow[b] += p; if (f >= 2000) high += p;
  }
  const amp = bandPow.map((pp, b) => Math.sqrt(bandCnt[b] ? pp / bandCnt[b] : 0));
  const peak = Math.max(...amp);
  return { noiseShare: harm + res > 0 ? res / (harm + res) : 0, bands: amp.map((a) => (peak > 0 ? a / peak : 0)), highShare: res > 0 ? high / res : 0 };
}

// A pitched sound is kept as MIXED (both parts) when at least this share of
// its energy is noise between the harmonics, mostly above 2 kHz (a voiced
// fricative like "zzz", or a very breathy vowel). Below it, the small
// residual is room noise and breath, and the sound stays purely pitched.
export const MIXED_RULES = Object.freeze({ minNoiseShare: 0.3, minHighShare: 0.5 });

/** { voiced, bands } for a pitched analysis, or null when it is (nearly) pure. */
export function mixedPart(x, sampleRate, f0, range) {
  const r = harmonicResidual(x, sampleRate, f0, range);
  if (!r || r.noiseShare < MIXED_RULES.minNoiseShare || r.highShare < MIXED_RULES.minHighShare) return null;
  return { voiced: Math.round((1 - r.noiseShare) * 1000) / 1000, bands: r.bands, noiseShare: r.noiseShare };
}

/**
 * One drawn-take snippet → a learned point's sound, or why it was skipped.
 *   pitch     analyzeVowel result for the snippet
 * Returns { outcome: 'pitched' | 'mixed' | 'noise' | 'silent' | 'unreliable', params? }
 */
export function snippetSound(x, sampleRate, { from, to }, pitch) {
  const silent = (pitch.problems || []).some((p) => p.code === 'silent');
  if (silent) return { outcome: 'silent' };
  const amps = pitch.amps ? pitch.amps.slice(0, MAX_HARMONICS) : null;
  const pitched = pitch.status !== 'failed' && Number.isFinite(pitch.f0) && pitch.f0 > 0 && amps && amps.some((a) => a > 0);
  if (pitched) {
    const m = mixedPart(x, sampleRate, pitch.f0, { from, to });
    if (m) return { outcome: 'mixed', params: { kind: 'mixed', voiced: m.voiced, f0: pitch.f0, amps, bands: m.bands } };
    return { outcome: 'pitched', params: { kind: 'pitched', voiced: 1, f0: pitch.f0, amps, bands: null } };
  }
  const spec = noiseSpectrum(x, sampleRate, { from, to });
  const share = pitch.stats && pitch.stats.framesTotal ? pitch.stats.framesPeriodic / pitch.stats.framesTotal : 0;
  // a short snippet's periodic share is noisy: only the level and the spectrum decide here
  const c = classifyNoise(spec, Math.min(share, NOISE_RULES.maxPeriodicShare));
  if (c.ok) return { outcome: 'noise', params: { kind: 'noise', voiced: 0, f0: NaN, amps: new Array(MAX_HARMONICS).fill(0), bands: spec.bands } };
  return { outcome: c.code === 'silent' ? 'silent' : 'unreliable' };
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

export const HISS_LOWPASS_HZ = 1500;

/** x[from…to) through a 2-pole low-pass (two one-pole stages) at `hz`, as a new array. */
export function lowpassCopy(x, sampleRate, hz, { from = 0, to = x.length } = {}) {
  const a = Math.exp((-2 * Math.PI * hz) / sampleRate);
  const y = new Float32Array(Math.max(0, to - from));
  let s1 = 0; let s2 = 0;
  for (let i = 0; i < y.length; i++) { s1 = (1 - a) * x[from + i] + a * s1; s2 = (1 - a) * s1 + a * s2; y[i] = s2; }
  return y;
}

/**
 * The pitch analysis of a section (Vowel Lab's analyzeVowel), robust to hiss:
 * strong high noise on top of a voiced sound (a "zzz", a breathy vowel) can
 * stop the pitch tracker. When the plain analysis finds no pitch (and the
 * section is not silent), the pitch is looked for again below 1.5 kHz, where
 * the voice is and most hiss is not; if one is found there, the harmonics are
 * measured on the ORIGINAL section at that pitch. The result is marked
 * `viaLowpass: true`. Pure noise (“sss”, “shh”) has no pitch below 1.5 kHz
 * either, so it still comes back without a pitch.
 */
export function findPitch(x, sampleRate, { from = 0, to = x.length } = {}, analyze = analyzeVowel) {
  const r = analyze(x, sampleRate, { from, to });
  const usable = (q) => q && q.status !== 'failed' && Number.isFinite(q.f0) && q.f0 > 0;
  if (usable(r) || (r.problems || []).some((p) => p.code === 'silent' || p.code === 'too-short')) return r;
  const low = analyze(lowpassCopy(x, sampleRate, HISS_LOWPASS_HZ, { from, to }), sampleRate);
  if (!usable(low) || low.status === 'warning' && low.stats && low.stats.framesTotal && low.stats.framesPeriodic / low.stats.framesTotal < 0.5) return r;
  const again = analyze(x, sampleRate, { from, to, f0Override: low.f0 });
  if (!usable(again)) return r;
  return { ...again, status: 'ok', warnings: (again.warnings || []).filter((w) => w.code !== 'manual'), stats: low.stats, viaLowpass: true };
}

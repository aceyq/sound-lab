// Automatic vowel analysis (assignment 3): estimates the fundamental and the
// harmonic strengths of one steady section of a recording, so the existing
// additive synthesizer can rebuild it from new sine waves. Pure logic: no DOM
// or Web Audio here, so everything is unit-tested with `npm test`.
//
//   1. Fundamental: YIN (de Cheveigné & Kawahara 2002) on many short frames,
//      then the median of the frames that repeat clearly ("periodic" frames).
//   2. Harmonics: in each periodic frame, a Hann-windowed, zero-padded FFT;
//      for every n the highest point near n × f0 (that frame's own f0), refined
//      by quadratic interpolation. A harmonic is kept only if it stands well
//      above the local noise floor in at least half of the frames; its
//      strength is the median over those frames.
//   3. The strengths are scaled so the strongest harmonic is 1 and written
//      into a complete, freshly zeroed array of MAX_HARMONICS amplitudes.
//
// Nothing here knows about any particular vowel or about the person's manual
// matches. Every number comes from the samples passed in.
import { fft, F0_MIN, F0_MAX, MAX_HARMONICS, makeExperiment } from './vowel-model.js';

export const AUTO_SETTINGS = {
  f0Min: F0_MIN, // Hz, lowest fundamental searched (same range as the typed f0)
  f0Max: F0_MAX, // Hz, highest
  yinThreshold: 0.15, // YIN step 4: first dip below this is taken as the period
  periodicMax: 0.3, // a frame counts as periodic if its YIN aperiodicity is below this
  minPeriodicShare: 0.5, // fewer periodic frames than this share → no confident result
  hopSec: 0.02, // frame spacing (raised for long sections so at most maxFrames are used)
  maxFrames: 60,
  silenceDb: -60, // section RMS below this (dBFS) counts as silent
  quietDb: -45, // below this: warn that noise may dominate
  harmonicPeriods: 8, // harmonic frames span at least 8 periods…
  harmonicMinSec: 0.04, // …and at least 40 ms
  zeroPad: 4, // FFT size ≥ 4 × frame length (finer frequency points)
  searchFrac: 0.3, // look for harmonic n within ±0.3 × f0 of n × f0
  minProminenceDb: 10, // peak must be this far above the local noise floor
  minPresence: 0.5, // …in at least this share of the periodic frames
  // Kept harmonics weaker than this (dB re the strongest) are set to 0: the
  // Hann window's own leakage from a strong neighbouring harmonic is around
  // −60 dB with 8-period frames, so weaker "peaks" cannot be trusted.
  floorRelDb: -50,
  unstableCents: 50, // middle-50 % spread of frame f0 above this → "not steady" warning
  nyquistMargin: 0.5, // harmonic n is measured only if n·f0 + 0.5·f0 < Nyquist
};

const SET = AUTO_SETTINGS;

// ───────────── fundamental (YIN) ─────────────

/**
 * YIN on one frame starting at `start`. Needs 2 × tauMax + 2 samples.
 * Returns { f0, aperiodicity } where aperiodicity is the cumulative-mean-
 * normalized difference d′ at the chosen lag: 0 for a perfectly repeating
 * signal, around 1 for one that does not repeat at all. It is not a
 * probability.
 */
export function yinFrame(x, start, sampleRate, { f0Min = SET.f0Min, f0Max = SET.f0Max, threshold = SET.yinThreshold } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / f0Max));
  const tauMax = Math.ceil(sampleRate / f0Min);
  const W = tauMax;
  const d = new Float64Array(tauMax + 2);
  // Step 2: difference function d(τ) = Σ (x_j − x_{j+τ})²
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const v = x[start + j] - x[start + j + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // Step 3: cumulative mean normalized difference d′(τ) = d(τ) · τ / Σ_{1..τ} d
  const dn = new Float64Array(tauMax + 2);
  dn[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    run += d[tau];
    dn[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  // Step 4: the first lag whose d′ dips below the threshold, walked down to
  // the bottom of that dip. If none does, the overall minimum.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (dn[t] < threshold) {
      while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    tau = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (dn[t] < dn[tau]) tau = t;
  }
  // Step 5: parabolic interpolation between lags (the period is rarely a
  // whole number of samples).
  let off = 0;
  if (tau > 1 && tau < tauMax + 1) {
    const a = dn[tau - 1];
    const b = dn[tau];
    const c = dn[tau + 1];
    const den = a - 2 * b + c;
    if (den > 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
  }
  return { f0: sampleRate / (tau + off), aperiodicity: dn[tau], tau: tau + off };
}

export function rmsDb(x, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  const n = Math.max(1, to - from);
  return 10 * Math.log10(s / n + 1e-20);
}

/** Frame centres spread evenly across [from, to) so each frame of `len` fits. */
function frameCentres(from, to, len, sampleRate) {
  const half = Math.ceil(len / 2);
  const lo = from + half;
  const hi = to - half;
  if (hi < lo) return [];
  const span = hi - lo;
  const hop = Math.max(Math.round(SET.hopSec * sampleRate), Math.ceil(span / Math.max(1, SET.maxFrames - 1)));
  const out = [];
  for (let c = lo; c <= hi; c += hop) out.push(c);
  return out;
}

function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const p = (s.length - 1) * q;
  const i = Math.floor(p);
  return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (p - i);
}

/**
 * Step 1: f0 of samples[from, to). Returns { f0, frames, stats, problems, warnings }.
 * f0 is null when there is no confident answer; `problems` then says why.
 */
export function estimateFundamental(x, sampleRate, { from = 0, to = x.length } = {}) {
  const problems = [];
  const warnings = [];
  const tauMax = Math.ceil(sampleRate / SET.f0Min);
  const yinLen = 2 * tauMax + 2;
  const segDb = rmsDb(x, from, to);
  let peak = 0;
  let clipped = 0;
  for (let i = from; i < to; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; if (a >= 0.999) clipped++; }
  const stats = {
    durationSec: (to - from) / sampleRate, sampleRate, rmsDb: segDb, peak, clippedSamples: clipped,
    framesTotal: 0, framesSilent: 0, framesPeriodic: 0, periodicShare: 0, spreadCents: null,
    medianAperiodicity: null, octaveOutliers: 0,
  };
  const minSec = yinLen / sampleRate;
  if (to - from < yinLen) {
    problems.push({ code: 'too-short', message: `The selected section is ${fmtSec((to - from) / sampleRate)} long, but one analysis frame needs ${fmtSec(minSec)} (two of the longest periods searched, ${SET.f0Min} Hz). Select a longer steady section, ideally 0.5–1 s.` });
    return { f0: null, frames: [], stats, problems, warnings };
  }
  if (segDb < SET.silenceDb) {
    problems.push({ code: 'silent', message: `The selected section is silent or nearly silent (average level ${segDb.toFixed(1)} dBFS, below ${SET.silenceDb} dBFS). There is no voice to analyze: select the part of the recording where you are singing, or record again closer to the microphone.` });
    return { f0: null, frames: [], stats, problems, warnings };
  }
  const centres = frameCentres(from, to, yinLen, sampleRate);
  const frames = [];
  for (const c of centres) {
    const start = c - Math.ceil(yinLen / 2);
    const fr = { centre: c, t: c / sampleRate, rmsDb: rmsDb(x, start, start + yinLen), f0: null, aperiodicity: null, periodic: false, silent: false };
    if (fr.rmsDb < SET.silenceDb) fr.silent = true;
    else {
      const y = yinFrame(x, start, sampleRate);
      fr.f0 = y.f0;
      fr.aperiodicity = y.aperiodicity;
      fr.periodic = y.aperiodicity < SET.periodicMax;
    }
    frames.push(fr);
  }
  const periodic = frames.filter((f) => f.periodic);
  const voicedish = frames.filter((f) => !f.silent);
  stats.framesTotal = frames.length;
  stats.framesSilent = frames.length - voicedish.length;
  stats.framesPeriodic = periodic.length;
  stats.periodicShare = frames.length ? periodic.length / frames.length : 0;
  stats.medianAperiodicity = voicedish.length ? median(voicedish.map((f) => f.aperiodicity)) : null;
  if (stats.periodicShare < SET.minPeriodicShare) {
    problems.push({ code: 'not-periodic', message: `Only ${periodic.length} of ${frames.length} frames repeat clearly enough to measure a pitch (${pct(stats.periodicShare)}; at least ${pct(SET.minPeriodicShare)} are needed). The section is probably too noisy, breathy, silent in places, or not one steady sung vowel. Select a steadier part, or type a fundamental below to measure harmonics anyway (that is then a manual value).` });
    return { f0: null, frames, stats, problems, warnings };
  }
  const f0 = median(periodic.map((f) => f.f0));
  const cents = periodic.map((f) => 1200 * Math.log2(f.f0 / f0));
  stats.spreadCents = quantile(cents, 0.75) - quantile(cents, 0.25);
  stats.octaveOutliers = cents.filter((c) => Math.abs(c) > 600).length;
  if (stats.spreadCents > SET.unstableCents) warnings.push({ code: 'unstable', message: `The pitch is not steady in this section: the middle half of the frames spread over ${Math.round(stats.spreadCents)} cents (100 cents = one semitone). The synthesis uses one constant fundamental, the median. A shorter, steadier section may match better.` });
  if (stats.octaveOutliers) warnings.push({ code: 'octave', message: `${stats.octaveOutliers} periodic frame(s) gave a pitch about an octave or more away from the median. The median ignores them, but check the estimate by ear; correct it below if it sounds an octave off.` });
  if (stats.periodicShare < 0.8) warnings.push({ code: 'gaps', message: `${frames.length - periodic.length} of ${frames.length} frames did not repeat clearly and were left out.` });
  if (segDb < SET.quietDb) warnings.push({ code: 'quiet', message: `The recording is quiet here (${segDb.toFixed(1)} dBFS), so background noise may affect the weaker harmonics.` });
  if (clipped > Math.max(3, 0.001 * (to - from))) warnings.push({ code: 'clipped', message: `${clipped} samples reached full scale (clipping). Clipping adds harmonics that were not in your voice; record a little softer if you can.` });
  return { f0, frames, stats, problems, warnings };
}

// ───────────── harmonics (Fourier) ─────────────

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Harmonic frame length in samples for a fundamental. */
export function harmonicFrameLength(f0, sampleRate) {
  return Math.round(Math.max(SET.harmonicMinSec * sampleRate, (SET.harmonicPeriods * sampleRate) / f0));
}

/**
 * One frame's spectrum in dB re a full-scale sine (a sine of amplitude A at a
 * frequency point shows 20·log10(A)). Hann window, zero-padded FFT.
 */
function frameSpectrum(x, centre, len, sampleRate) {
  const N = nextPow2(len * SET.zeroPad);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const start = centre - Math.floor(len / 2);
  let wsum = 0;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    wsum += w;
    re[i] = x[start + i] * w;
  }
  fft(re, im);
  const half = N / 2;
  const db = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) db[k] = 20 * Math.log10((2 * Math.hypot(re[k], im[k])) / wsum + 1e-12);
  return { db, binHz: sampleRate / N, N };
}

/**
 * Measures harmonic n in one frame spectrum. Returns { found, freq, db,
 * prominenceDb, edge }.
 */
function measureOne(spec, n, f0, lobeHz) {
  const { db, binHz } = spec;
  const target = n * f0;
  const lo = Math.max(1, Math.ceil((target - SET.searchFrac * f0) / binHz));
  const hi = Math.min(db.length - 2, Math.floor((target + SET.searchFrac * f0) / binHz));
  if (hi <= lo) return { found: false };
  let k = lo;
  for (let i = lo + 1; i <= hi; i++) if (db[i] > db[k]) k = i;
  // A maximum on the edge of the search band is a slope (of a neighbour or of
  // noise), not a peak at this harmonic.
  const edge = k === lo || k === hi;
  // Quadratic interpolation of the peak in dB: frequency and height between points.
  const a = db[k - 1];
  const b = db[k];
  const c = db[k + 1];
  const den = a - 2 * b + c;
  const p = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  const peakDb = b - 0.25 * (a - c) * p;
  const freq = (k + p) * binHz;
  // Local floor: median level within half a harmonic spacing, outside the
  // main lobe of this peak.
  const fl = [];
  const flo = Math.max(1, Math.ceil((target - 0.5 * f0) / binHz));
  const fhi = Math.min(db.length - 1, Math.floor((target + 0.5 * f0) / binHz));
  for (let i = flo; i <= fhi; i++) if (Math.abs(i * binHz - freq) > lobeHz) fl.push(db[i]);
  const floorDb = fl.length ? median(fl) : -240;
  const prominenceDb = peakDb - floorDb;
  return { found: !edge && prominenceDb >= SET.minProminenceDb, freq, db: peakDb, floorDb, prominenceDb, edge };
}

/**
 * Step 2: harmonic strengths of samples[from, to) for the frames from step 1.
 * `frameF0s` gives one fundamental per frame centre (frames that move a little
 * in pitch are measured at their own n × f0). Returns { harmonics, amps,
 * framesUsed, frameLen, fftSize, binHz, maxN }.
 */
export function measureHarmonics(x, sampleRate, { from = 0, to = x.length, frames, f0 }) {
  const nyq = sampleRate / 2;
  const used = [];
  let frameLen = 0;
  let fftSize = 0;
  let binHz = 0;
  for (const fr of frames) {
    const len = harmonicFrameLength(fr.f0, sampleRate);
    const start = fr.centre - Math.floor(len / 2);
    if (start < from || start + len > to) continue;
    used.push({ ...fr, len });
  }
  const maxN = Math.max(0, Math.min(MAX_HARMONICS, Math.floor((nyq - SET.nyquistMargin * f0) / f0)));
  const per = Array.from({ length: maxN }, () => ({ amps: [], freqs: [], prom: [], found: 0 }));
  for (const fr of used) {
    const spec = frameSpectrum(x, fr.centre, fr.len, sampleRate);
    frameLen = fr.len;
    fftSize = spec.N;
    binHz = spec.binHz;
    // Hann main lobe: ±2 points of the unpadded frame, plus a little.
    const lobeHz = (2.5 * sampleRate) / fr.len;
    for (let n = 1; n <= maxN; n++) {
      if ((n + SET.nyquistMargin) * fr.f0 >= nyq) break;
      const m = measureOne(spec, n, fr.f0, lobeHz);
      if (!m.found) continue;
      const slot = per[n - 1];
      slot.found++;
      slot.amps.push(10 ** (m.db / 20));
      slot.freqs.push(m.freq / n);
      slot.prom.push(m.prominenceDb);
    }
  }
  const nUsed = used.length;
  const harmonics = per.map((s, i) => {
    const n = i + 1;
    const presence = nUsed ? s.found / nUsed : 0;
    const enough = presence >= SET.minPresence;
    return {
      n, freq: n * f0, presence, framesFound: s.found,
      amplitude: enough ? median(s.amps) : 0,
      prominenceDb: s.prom.length ? median(s.prom) : null,
      kept: enough,
      reason: enough ? '' : s.found ? `stood out in only ${s.found} of ${nUsed} frames` : 'not above the noise',
    };
  });
  // Scale so the strongest harmonic is 1. Ratios between harmonics are kept.
  const top = Math.max(0, ...harmonics.map((hm) => hm.amplitude));
  for (const hm of harmonics) {
    hm.relDb = top > 0 && hm.amplitude > 0 ? 20 * Math.log10(hm.amplitude / top) : null;
    let a = top > 0 ? hm.amplitude / top : 0;
    if (hm.kept && hm.relDb < SET.floorRelDb) { a = 0; hm.kept = false; hm.reason = `weaker than ${SET.floorRelDb} dB re the strongest`; }
    a = Math.round(a * 1000) / 1000;
    if (hm.kept && a === 0) { hm.kept = false; hm.reason = 'rounds to 0'; }
    hm.value = a;
  }
  // A complete array of MAX_HARMONICS amplitudes, all zero except what was
  // measured here, so nothing from an earlier recipe can stay active.
  const amps = new Array(MAX_HARMONICS).fill(0);
  for (const hm of harmonics) amps[hm.n - 1] = hm.value;
  return { harmonics, amps, framesUsed: nUsed, frameLen, fftSize, binHz, maxN };
}

/**
 * The whole analysis of samples[from, to). With `f0Override` (a person's
 * correction) the harmonics are measured at that fundamental instead: the
 * per-frame pitch track is scaled to it if there is one, otherwise every
 * non-silent frame is measured at the typed value.
 *
 * Returns {
 *   status: 'ok' | 'warning' | 'failed', problems, warnings,
 *   f0, f0Auto, f0Source: 'automatic' | 'manual' | null,
 *   amps (length MAX_HARMONICS), count, harmonics, stats, frames, analysis settings
 * }
 */
export function analyzeVowel(x, sampleRate, { from = 0, to = x.length, f0Override = null } = {}) {
  const est = estimateFundamental(x, sampleRate, { from, to });
  const base = {
    sampleRate, segment: { from, to, startSec: from / sampleRate, endSec: to / sampleRate },
    f0Auto: est.f0, stats: est.stats, frames: est.frames.map((f) => ({ t: round(f.t, 4), f0: f.f0 && round(f.f0, 2), aperiodicity: f.aperiodicity == null ? null : round(f.aperiodicity, 3), periodic: f.periodic, silent: f.silent })),
    warnings: [...est.warnings], problems: [...est.problems], settings: { ...SET },
  };
  const hard = est.problems.find((p) => p.code === 'silent' || p.code === 'too-short');
  const manual = Number.isFinite(f0Override) && f0Override > 0;
  if (hard || (!manual && est.f0 == null)) return { ...base, status: 'failed', f0: null, f0Source: null, amps: null, count: MAX_HARMONICS, harmonics: [] };

  let f0;
  let frames;
  if (manual) {
    f0 = f0Override;
    if (est.f0 != null) {
      const ratio = f0 / est.f0;
      frames = est.frames.filter((f) => f.periodic).map((f) => ({ ...f, f0: f.f0 * ratio }));
    } else {
      frames = est.frames.filter((f) => !f.silent).map((f) => ({ ...f, f0 }));
    }
    base.problems = base.problems.filter((p) => p.code !== 'not-periodic');
    base.warnings.unshift({ code: 'manual', message: est.f0 != null
      ? `Fundamental corrected by hand: ${round(f0, 2)} Hz instead of the automatic ${round(est.f0, 2)} Hz. The harmonics were measured again at n × ${round(f0, 2)} Hz; this is a manual correction, not automatic detection.`
      : `No automatic fundamental was found, so the harmonics were measured at the ${round(f0, 2)} Hz you typed. This is a manual value, not automatic detection, and the section did not repeat clearly.` });
  } else {
    f0 = est.f0;
    frames = est.frames.filter((f) => f.periodic);
  }

  const m = measureHarmonics(x, sampleRate, { from, to, frames, f0 });
  const result = {
    ...base, f0: round(f0, 2), f0Source: manual ? 'manual' : 'automatic', amps: m.amps, count: MAX_HARMONICS,
    harmonics: m.harmonics,
    measurement: { framesUsed: m.framesUsed, frameLen: m.frameLen, frameSec: m.frameLen / sampleRate, fftSize: m.fftSize, binHz: m.binHz, maxN: m.maxN, nyquist: sampleRate / 2 },
  };
  const kept = m.harmonics.filter((hm) => hm.kept);
  if (!m.framesUsed) {
    result.problems.push({ code: 'too-short', message: `At ${round(f0, 1)} Hz a harmonic frame needs ${fmtSec(harmonicFrameLength(f0, sampleRate) / sampleRate)}, which does not fit in the selected section. Select a longer steady section.` });
    return { ...result, status: 'failed', amps: null };
  }
  if (kept.length < 2) {
    result.problems.push({ code: 'few-harmonics', message: `Only ${kept.length} harmonic stood out above the noise. That is too little to rebuild a vowel: the section may be too noisy or too quiet, or the fundamental may be wrong.` });
    return { ...result, status: 'failed' };
  }
  const strongest = kept.reduce((a, b) => (b.amplitude > a.amplitude ? b : a));
  result.strongest = strongest.n;
  if (!m.harmonics[0] || !m.harmonics[0].kept) result.warnings.push({ code: 'no-h1', message: 'Harmonic 1 (the fundamental itself) did not stand out above the noise. A pitch can still be heard without it, but check that the fundamental is right.' });
  if (m.framesUsed < 3) result.warnings.push({ code: 'few-frames', message: `Only ${m.framesUsed} frame(s) fit in this section, so one unusual moment can affect the result. A longer steady section gives a more reliable median.` });
  return { ...result, status: result.warnings.some((w) => w.code !== 'manual') ? 'warning' : 'ok' };
}

/** Compact record of an analysis for saving with an experiment (no frame list). */
export function analysisSummary(r) {
  return {
    method: 'YIN fundamental (median of periodic frames) + Hann-windowed FFT harmonic peaks (median over frames)',
    f0Source: r.f0Source,
    automaticF0Hz: r.f0Auto == null ? null : round(r.f0Auto, 2),
    usedF0Hz: r.f0,
    segmentSec: [round(r.segment.startSec, 3), round(r.segment.endSec, 3)],
    sampleRate: r.sampleRate,
    status: r.status,
    reliability: {
      framesTotal: r.stats.framesTotal,
      framesPeriodic: r.stats.framesPeriodic,
      pitchSpreadCents: r.stats.spreadCents == null ? null : round(r.stats.spreadCents, 1),
      medianAperiodicity: r.stats.medianAperiodicity == null ? null : round(r.stats.medianAperiodicity, 3),
      harmonicsKept: r.harmonics.filter((hm) => hm.kept).length,
      framesUsedForHarmonics: r.measurement ? r.measurement.framesUsed : 0,
    },
    warnings: r.warnings.map((w) => w.message),
    problems: r.problems.map((p) => p.message),
  };
}

/**
 * A NEW experiment from an automatic result. `source` is the experiment the
 * analysis was run from (only its labels, recording and segment are copied;
 * it is not modified). The amplitudes are the complete MAX_HARMONICS array
 * from the analysis, so no slider value from `source` can carry over.
 */
export function autoExperiment(result, source, { recordingId = source.recordingId, segment = source.segment } = {}) {
  if (!result || !result.amps) throw new Error('No usable automatic result to save.');
  const s = analysisSummary(result);
  const kept = result.harmonics.filter((hm) => hm.kept).map((hm) => hm.n);
  return makeExperiment({
    vowel: source.vowel, vowelText: source.vowelText,
    pitch: source.pitch, pitchText: source.pitchText,
    f0: result.f0, count: MAX_HARMONICS, amps: [...result.amps],
    recordingId, segment: segment ? { ...segment } : null,
    origin: 'auto', autoAnalysis: s,
    notes: { general: `Automatic analysis of ${s.segmentSec[0]}–${s.segmentSec[1]} s: f0 ${result.f0} Hz (${result.f0Source === 'manual' ? 'manual correction' : 'automatic'}), harmonics kept: ${kept.join(', ')}.` },
  });
}

function round(v, d) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function pct(v) {
  return `${Math.round(v * 100)} %`;
}

function fmtSec(s) {
  return s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
}

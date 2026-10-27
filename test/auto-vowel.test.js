// Automatic vowel analysis (assignment 3): fundamental and harmonic strengths
// from known synthetic signals, failure cases, and that saving an automatic
// result never touches the manual experiments.
//
// These are simulated signals with known answers. They show the analysis
// measures what it should; they do not show that a real voice is analyzed
// well or that the synthesis sounds like the vowel. That needs listening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVowel, estimateFundamental, yinFrame, autoExperiment, analysisSummary, AUTO_SETTINGS } from '../src/pages/frequency/auto-vowel.js';
import {
  makeExperiment, snapshot, settingsDocument, parseSettings, experimentLabel, fileBase, renderRecipe, outputGain,
  OUTPUT_PEAK, MAX_HARMONICS, peakAbs,
} from '../src/pages/frequency/vowel-model.js';

/** Σ amps[k] sin(2π (k+1) f(t) t + phase_k) + white noise; f may drift. */
function tone({ f0, amps, sr = 48000, sec = 1.5, noise = 0, seed = 7, phases = true, drift = null }) {
  const x = new Float32Array(Math.round(sr * sec));
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const f = drift ? drift(i / sr) : f0;
    ph += (2 * Math.PI * f) / sr;
    let s = 0;
    for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin((k + 1) * ph + (phases ? 0.9 * k * k : 0));
    seed = (seed * 16807) % 2147483647;
    x[i] = s + noise * ((seed / 2147483647) * 2 - 1);
  }
  return x;
}

const dB = (a) => 20 * Math.log10(a);
const mid = (sr) => ({ from: Math.round(0.25 * sr), to: Math.round(1.25 * sr) });

test('known tone: fundamental and every harmonic strength are recovered; the rest stay 0', () => {
  const sr = 48000;
  const amps = [0.4, 0.2, 0.12, 0.08, 0.04]; // relative 1, 0.5, 0.3, 0.2, 0.1
  const r = analyzeVowel(tone({ f0: 220, amps, sr, noise: 0.0005 }), sr, mid(sr));
  assert.equal(r.status, 'ok', JSON.stringify(r.warnings));
  assert.equal(r.f0Source, 'automatic');
  assert.ok(Math.abs(r.f0 - 220) < 0.2, `f0 ${r.f0}`);
  assert.equal(r.amps.length, MAX_HARMONICS);
  const want = [1, 0.5, 0.3, 0.2, 0.1];
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(dB(r.amps[i]) - dB(want[i])) < 0.5, `h${i + 1}: ${r.amps[i]} vs ${want[i]}`);
  for (let i = 5; i < MAX_HARMONICS; i++) assert.equal(r.amps[i], 0, `h${i + 1} should be 0 (noise only), got ${r.amps[i]}`);
  assert.equal(r.strongest, 1);
});

test('fundamental between FFT points and between samples (243.7 Hz at 44.1 kHz) is still accurate', () => {
  const sr = 44100;
  const r = analyzeVowel(tone({ f0: 243.7, amps: [0.5, 0.25, 0.1], sr, noise: 0.001 }), sr, mid(sr));
  assert.ok(Math.abs(r.f0 - 243.7) < 0.15, `f0 ${r.f0}`);
  // A harmonic between FFT points must not lose level (scalloping): within 0.3 dB.
  assert.ok(Math.abs(dB(r.amps[1]) - dB(0.5)) < 0.3, `h2 ${r.amps[1]}`);
  assert.ok(Math.abs(dB(r.amps[2]) - dB(0.2)) < 0.3, `h3 ${r.amps[2]}`);
});

test('a higher harmonic stronger than the fundamental does not fool the f0 estimate', () => {
  const sr = 48000;
  // Harmonic 2 is 14 dB above harmonic 1, as near a vocal-tract resonance.
  const amps = [0.05, 0.25, 0.15, 0.07, 0.02];
  const r = analyzeVowel(tone({ f0: 180, amps, sr, noise: 0.0005 }), sr, mid(sr));
  assert.ok(Math.abs(r.f0 - 180) < 0.2, `f0 ${r.f0} (tallest peak would say 360)`);
  assert.equal(r.strongest, 2);
  assert.ok(Math.abs(r.amps[0] - 0.2) < 0.01 && r.amps[1] === 1, `amps ${r.amps.slice(0, 5)}`);
  // Even when harmonic 3 dominates.
  const r3 = analyzeVowel(tone({ f0: 150, amps: [0.04, 0.08, 0.3, 0.1], sr, noise: 0.0005 }), sr, mid(sr));
  assert.ok(Math.abs(r3.f0 - 150) < 0.2, `f0 ${r3.f0}`);
  assert.equal(r3.strongest, 3);
});

test('a drifting pitch (vibrato) is followed frame by frame; the synthesis uses the median', () => {
  const sr = 48000;
  const drift = (t) => 250 * (1 + 0.006 * Math.sin(2 * Math.PI * 5 * t)); // ±10 cents at 5 Hz
  const amps = [0.3, 0.15, 0.1, 0.06, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01];
  const r = analyzeVowel(tone({ f0: 250, amps, sr, noise: 0.0005, drift }), sr, mid(sr));
  assert.ok(Math.abs(r.f0 - 250) < 1.5, `f0 ${r.f0}`);
  assert.ok(r.stats.spreadCents > 3 && r.stats.spreadCents < AUTO_SETTINGS.unstableCents, `spread ${r.stats.spreadCents}`);
  // Harmonic 10 moves by ±15 Hz with the vibrato; it is still found and measured.
  assert.ok(r.harmonics[9].kept, 'h10 kept');
  assert.ok(Math.abs(dB(r.amps[9]) - dB(0.01 / 0.3)) < 1, `h10 ${r.amps[9]}`);
});

test('one unusual moment (a click and a silent gap) does not decide the result', () => {
  const sr = 48000;
  const x = tone({ f0: 200, amps: [0.3, 0.2, 0.1], sr, noise: 0.0005 });
  for (let i = Math.round(0.6 * sr); i < Math.round(0.66 * sr); i++) x[i] = 0; // 60 ms dropout
  x[Math.round(0.9 * sr)] = 0.95; // click
  const r = analyzeVowel(x, sr, mid(sr));
  assert.ok(Math.abs(r.f0 - 200) < 0.3, `f0 ${r.f0}`);
  assert.ok(r.stats.framesPeriodic >= 0.8 * r.stats.framesTotal);
  assert.ok(Math.abs(r.amps[1] - 0.667) < 0.03, `h2 ${r.amps[1]}`);
});

test('noise peaks are not treated as harmonics', () => {
  const sr = 48000;
  // Three harmonics, then fairly strong broadband noise (−30 dB re h1).
  const r = analyzeVowel(tone({ f0: 300, amps: [0.3, 0.03, 0.015], sr, noise: 0.03 }), sr, mid(sr));
  assert.ok(Math.abs(r.f0 - 300) < 0.5, `f0 ${r.f0}`);
  const kept = r.harmonics.filter((x) => x.kept).map((x) => x.n);
  assert.deepEqual(kept.filter((n) => n > 3), [], `noise kept as harmonics: ${kept}`);
  assert.ok(kept.includes(1) && kept.includes(2), `kept ${kept}`);
});

test('only harmonics below Nyquist and within the app limit are measured', () => {
  const sr = 16000; // Nyquist 8 kHz
  const amps = Array.from({ length: 30 }, (_, k) => 0.2 / (k + 1));
  const r = analyzeVowel(tone({ f0: 600, amps, sr, noise: 0.0002 }), sr, { from: 4000, to: 20000 });
  assert.equal(r.amps.length, MAX_HARMONICS);
  for (let i = 0; i < MAX_HARMONICS; i++) if ((i + 1) * r.f0 >= sr / 2) assert.equal(r.amps[i], 0, `h${i + 1} at ${(i + 1) * r.f0} Hz`);
  assert.ok(r.harmonics.length <= Math.floor(sr / 2 / 600));
  // A low voice at 48 kHz has more than 48 harmonics below Nyquist: capped at 48.
  const low = analyzeVowel(tone({ f0: 100, amps: Array.from({ length: 60 }, (_, k) => 0.1 / (k + 1)), sr: 48000, noise: 0.0001 }), 48000, mid(48000));
  assert.equal(low.harmonics.length, MAX_HARMONICS);
  assert.equal(low.amps.length, MAX_HARMONICS);
});

test('silence, noise and a too-short section give a clear failure, not a confident number', () => {
  const sr = 48000;
  const silent = analyzeVowel(new Float32Array(sr), sr);
  assert.equal(silent.status, 'failed');
  assert.equal(silent.f0, null);
  assert.equal(silent.amps, null);
  assert.deepEqual(silent.problems.map((p) => p.code), ['silent']);
  assert.match(silent.problems[0].message, /silent/);

  const noise = analyzeVowel(tone({ f0: 1, amps: [], sr, noise: 0.3 }), sr);
  assert.equal(noise.status, 'failed');
  assert.equal(noise.f0, null);
  assert.deepEqual(noise.problems.map((p) => p.code), ['not-periodic']);
  assert.match(noise.problems[0].message, /noisy|repeat/);

  const short = analyzeVowel(tone({ f0: 200, amps: [0.5], sr }), sr, { from: 1000, to: 2000 });
  assert.equal(short.status, 'failed');
  assert.deepEqual(short.problems.map((p) => p.code), ['too-short']);

  // A periodic signal whose pitch jumps around a lot is flagged as not steady.
  const jumpy = analyzeVowel(tone({ f0: 200, amps: [0.3, 0.1], sr, drift: (t) => (Math.floor(t * 8) % 2 ? 200 : 240) }), sr, mid(sr));
  assert.ok(jumpy.warnings.some((w) => w.code === 'unstable'), JSON.stringify(jumpy.warnings.map((w) => w.code)));
  assert.equal(jumpy.status, 'warning');
});

test('YIN aperiodicity is near 0 for a clean tone and high for noise', () => {
  const sr = 48000;
  const clean = yinFrame(tone({ f0: 220, amps: [0.5, 0.2], sr, sec: 0.1 }), 0, sr);
  assert.ok(clean.aperiodicity < 0.01 && Math.abs(clean.f0 - 220) < 0.2, JSON.stringify(clean));
  const est = estimateFundamental(tone({ f0: 1, amps: [], sr, sec: 0.5, noise: 0.3 }), sr);
  assert.ok(est.stats.medianAperiodicity > 0.5, `noise aperiodicity ${est.stats.medianAperiodicity}`);
});

test('a manual f0 correction is labelled manual and re-measures harmonics at the new value', () => {
  const sr = 48000;
  const x = tone({ f0: 220, amps: [0.4, 0.2, 0.1], sr, noise: 0.0005 });
  const auto = analyzeVowel(x, sr, mid(sr));
  const half = analyzeVowel(x, sr, { ...mid(sr), f0Override: 110 });
  assert.equal(half.f0Source, 'manual');
  assert.equal(half.f0, 110);
  assert.ok(Math.abs(half.f0Auto - auto.f0) < 0.01, 'automatic estimate is kept for reference');
  assert.ok(half.warnings[0].code === 'manual' && /manual correction/.test(half.warnings[0].message));
  // At 110 Hz the real partials are the even "harmonics"; the odd ones are empty.
  assert.ok(half.amps[1] > 0.9 && half.amps[3] > 0.4 && half.amps[0] === 0 && half.amps[2] === 0, `amps ${half.amps.slice(0, 6)}`);
  // A noisy section with no automatic f0 can still be measured at a typed value, labelled manual.
  const noisy = analyzeVowel(tone({ f0: 1, amps: [], sr, noise: 0.3 }), sr, { f0Override: 200 });
  assert.equal(noisy.f0Source, 'manual');
  assert.ok(/No automatic fundamental/.test(noisy.warnings[0].message));
});

test('playback normalization sets the peak but keeps the measured harmonic ratios', () => {
  const sr = 48000;
  const r = analyzeVowel(tone({ f0: 250, amps: [0.02, 0.008, 0.004], sr, noise: 0.00005 }), sr, mid(sr)); // a quiet take
  const g = outputGain(r.f0, r.amps, sr / 2);
  const y = renderRecipe({ f0: r.f0, amps: r.amps, sampleRate: sr, duration: 1, gain: g, fadeSec: 0 });
  assert.ok(Math.abs(peakAbs(y) - OUTPUT_PEAK) < 0.01, `peak ${peakAbs(y)}`);
  // Amplitude of harmonic n in the output: projection onto sin/cos over whole periods.
  const ampAt = (n) => {
    const len = Math.round(sr / r.f0) * Math.floor(y.length / Math.round(sr / r.f0));
    let c = 0; let q = 0;
    for (let i = 0; i < len; i++) { const w = (2 * Math.PI * n * r.f0 * i) / sr; c += y[i] * Math.cos(w); q += y[i] * Math.sin(w); }
    return (2 * Math.hypot(c, q)) / len;
  };
  const a1 = ampAt(1);
  assert.ok(Math.abs(ampAt(2) / a1 - r.amps[1]) < 0.002 && Math.abs(ampAt(3) / a1 - r.amps[2]) < 0.002, `ratios ${ampAt(2) / a1}, ${ampAt(3) / a1}`);
  assert.ok(Math.abs(r.amps[1] - 0.4) < 0.01 && Math.abs(r.amps[2] - 0.2) < 0.01, `measured ${r.amps.slice(0, 3)}`);
});

test('saving an automatic result creates a NEW experiment and leaves manual ones and their harmonics untouched', () => {
  const sr = 48000;
  // A manual experiment with every slider up (as after a lot of hand tuning).
  const manual = makeExperiment({ vowel: 'oo', pitch: 'lower', f0: 248, count: 48, amps: new Array(48).fill(0.7), recordingId: 'rec-1', segment: { start: 1, end: 2 } });
  manual.savedAt = '2026-10-20T10:00:00.000Z';
  const saved = [snapshot(manual)];
  const before = JSON.stringify(saved);
  const r = analyzeVowel(tone({ f0: 248, amps: [0.4, 0.04, 0.02], sr, noise: 0.0005 }), sr, mid(sr));
  const exp = autoExperiment(r, manual);
  assert.notEqual(exp.id, manual.id);
  assert.equal(exp.origin, 'auto');
  assert.equal(exp.count, MAX_HARMONICS);
  assert.equal(exp.amps.length, MAX_HARMONICS);
  // Only the measured harmonics are non-zero: none of the old 0.7 sliders survive.
  assert.deepEqual(exp.amps.map((a, i) => (a > 0 ? i + 1 : 0)).filter(Boolean), [1, 2, 3]);
  assert.equal(exp.recordingId, 'rec-1');
  assert.deepEqual(exp.segment, { start: 1, end: 2 });
  saved.push(snapshot(exp));
  assert.equal(JSON.stringify(saved.slice(0, 1)), before, 'the manual experiment is byte-for-byte unchanged');
  assert.ok(manual.amps.every((a) => a === 0.7), 'the source object was not modified');
  assert.match(experimentLabel(exp), /automatic/);
  assert.equal(fileBase(exp), 'oo_lower_auto');
  assert.equal(experimentLabel(manual), 'oo — lower pitch');
  assert.equal(fileBase(manual), 'oo_lower');
  // A failed analysis cannot be saved as a recipe.
  assert.throws(() => autoExperiment(analyzeVowel(new Float32Array(sr), sr), manual));
});

test('automatic experiments survive storage and the settings file round trip; old experiments load as manual', () => {
  const sr = 48000;
  const r = analyzeVowel(tone({ f0: 300, amps: [0.4, 0.04, 0.02, 0.004], sr, noise: 0.0005 }), sr, mid(sr));
  const exp = autoExperiment(r, makeExperiment({ vowel: 'oo', pitch: 'higher' }));
  const reloaded = makeExperiment(JSON.parse(JSON.stringify(exp))); // what loading from localStorage does
  assert.deepEqual(reloaded, exp);
  const doc = settingsDocument(exp, { nyquist: sr / 2, sampleRate: sr });
  assert.equal(doc.automaticAnalysis.f0Source, 'automatic');
  assert.deepEqual(doc.automaticAnalysis, analysisSummary(r));
  const back = parseSettings(JSON.parse(JSON.stringify(doc)));
  assert.ok(back.ok);
  assert.equal(back.experiment.origin, 'auto');
  assert.deepEqual(back.experiment.amps, exp.amps);
  // An experiment saved before assignment 3 (no origin field) is a manual one.
  const old = makeExperiment({ vowel: 'ah', f0: 248, amps: [1, 0.5, 0.2, 0.1] });
  delete old.origin; delete old.autoAnalysis;
  assert.equal(makeExperiment(old).origin, 'manual');
  assert.equal(makeExperiment(old).autoAnalysis, null);
});

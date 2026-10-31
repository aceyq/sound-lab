// Vowel Morph (tasks 3 and 4): analysis of synthetic vowels with known
// fundamentals and harmonics, the 1D and 2D blending rules, the sound that is
// played and exported, and the backup file.
//
// These are simulated signals with known answers. They show the numbers are
// right; they do not show that recorded vowels morph convincingly. That needs
// listening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HARMONICS, FLOOR, TARGET_RMS, blendParams, interpolate1D, sliderParams, idwWeights, blendAt, closePairs,
  nyquistTaper, playedAmps, oscillatorTargets, loudnessGain, rmsOfAmps, renderParams, paramsOf, isUsable,
  makeVowel, emptyProject, loadProject, takeName, makeBackup, parseBackup, floatsToBase64, base64ToFloats, noteName,
} from '../src/pages/vowel-morph/morph-model.js';
import { analyzeTake, initialSegment } from '../src/pages/vowel-morph/morph-analysis.js';
import { originalLevel } from '../src/pages/vowel-morph/morph-audio.js';
import { analyzeVowel } from '../src/pages/frequency/auto-vowel.js';

const SR = 48000;

function tone({ f0, amps, sr = SR, sec = 2, noise = 0, seed = 5 }) {
  const x = new Float32Array(Math.round(sr * sec));
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 0; k < amps.length; k++) s += amps[k] * Math.sin(2 * Math.PI * (k + 1) * f0 * t + 0.9 * k * k);
    seed = (seed * 16807) % 2147483647;
    x[i] = 0.3 * s + noise * ((seed / 2147483647) * 2 - 1);
  }
  return x;
}

const full = (list) => Array.from({ length: HARMONICS }, (_, i) => list[i] || 0);
// Two "vowels": A low pitch with strong low harmonics, B higher with a peak at harmonic 3.
const A = { f0: 200, amps: full([1, 0.5, 0.25, 0.1, 0.05]) };
const B = { f0: 300, amps: full([0.3, 0.6, 1, 0.4, 0, 0.1]) };
const vowelFrom = (p, extra = {}) => makeVowel({ name: extra.name || 'v', analysis: { status: 'ok', f0: p.f0, f0Source: 'automatic', amps: p.amps }, ...extra });
const db = (a) => 20 * Math.log10(a);

// ───────────── analysis ─────────────

test('analysis recovers a known fundamental and harmonic strengths (synthetic, 48 kHz)', () => {
  const amps = [1, 0.6, 0.3, 0.15, 0.08];
  const rec = { samples: tone({ f0: 220, amps, noise: 0.001 }), sampleRate: SR };
  const { analysis, segment } = analyzeTake(rec, initialSegment(rec));
  assert.deepEqual(segment, { start: 0.5, end: 1.5 });
  assert.equal(analysis.f0Source, 'automatic');
  assert.ok(Math.abs(analysis.f0 - 220) < 0.5, `f0 ${analysis.f0}`);
  assert.equal(analysis.amps.length, HARMONICS);
  amps.forEach((a, i) => assert.ok(Math.abs(db(analysis.amps[i]) - db(a)) < 1, `h${i + 1} ${analysis.amps[i]} vs ${a}`));
  // Harmonics the signal does not have are exactly 0, not leftovers.
  assert.ok(analysis.amps.slice(5).every((a) => a === 0));
});

test('analysis respects the sample rate: a 16 kHz take has nothing at or above its 8 kHz Nyquist', () => {
  const amps = Array.from({ length: 40 }, (_, i) => 1 / (i + 1));
  const rec = { samples: tone({ f0: 250, amps, sr: 16000, noise: 0.0005 }), sampleRate: 16000 };
  const { analysis } = analyzeTake(rec, null);
  assert.ok(Math.abs(analysis.f0 - 250) < 0.5);
  analysis.amps.forEach((a, i) => { if ((i + 1) * analysis.f0 >= 8000) assert.equal(a, 0, `h${i + 1}`); });
  assert.equal(analysis.facts.nyquist, 8000);
});

test('unsuitable input is explained, not played: silence and noise fail with a reason', () => {
  const silent = { samples: new Float32Array(SR * 2), sampleRate: SR };
  const s = analyzeTake(silent, null).analysis;
  assert.equal(s.status, 'failed');
  assert.equal(s.amps, null);
  assert.match(s.problems[0], /silent/);
  let seed = 9;
  const noise = { samples: Float32Array.from({ length: SR * 2 }, () => { seed = (seed * 16807) % 2147483647; return 0.2 * ((seed / 2147483647) * 2 - 1); }), sampleRate: SR };
  const n = analyzeTake(noise, null).analysis;
  assert.equal(n.status, 'failed');
  assert.ok(n.problems.length > 0);
  assert.equal(isUsable(makeVowel({ analysis: n })), false);
});

test('manual f0 correction re-measures the harmonics and is labelled manual', () => {
  const rec = { samples: tone({ f0: 200, amps: [1, 0.5, 0.25, 0.12] }), sampleRate: SR };
  const auto = analyzeTake(rec, null).analysis;
  // Pretend the person says the true pitch is an octave lower: then the old
  // harmonics 1, 2, 3, 4 become harmonics 2, 4, 6, 8 and the odd ones are absent.
  const man = analyzeTake(rec, null, 100).analysis;
  assert.equal(man.f0Source, 'manual');
  assert.equal(man.f0, 100);
  assert.ok(Math.abs(man.f0Auto - auto.f0) < 0.01);
  assert.ok(man.amps[1] > 0.9 && man.amps[0] === 0 && man.amps[2] === 0);
});

test('analysis does not hard-code a fundamental: different takes give their own f0', () => {
  for (const f0 of [110, 175, 262, 440]) {
    const rec = { samples: tone({ f0, amps: [1, 0.5, 0.3] }), sampleRate: SR };
    assert.ok(Math.abs(analyzeTake(rec, null).analysis.f0 - f0) < 0.5, `${f0}`);
  }
});

// ───────────── 1D ─────────────

test('slider endpoints reproduce A and B exactly', () => {
  assert.deepEqual(interpolate1D(A, B, 0), A);
  assert.deepEqual(interpolate1D(A, B, 1), B);
  assert.deepEqual(interpolate1D(A, B, -0.3), A); // clamped
  assert.deepEqual(interpolate1D(A, B, 1.7), B);
});

test('slider midpoint: geometric-mean pitch and dB-average strengths', () => {
  const m = interpolate1D(A, B, 0.5);
  assert.ok(Math.abs(m.f0 - Math.sqrt(200 * 300)) < 1e-9); // 244.95 Hz
  assert.ok(Math.abs(12 * Math.log2(m.f0 / 200) - 12 * Math.log2(300 / m.f0)) < 1e-9); // equal semitones from each end
  // h1: 1 (0 dB) and 0.3 (−10.46 dB) → −5.23 dB = 0.5477
  assert.ok(Math.abs(m.amps[0] - Math.sqrt(0.3)) < 1e-12);
  // h3: 0.25 and 1 → 0.5
  assert.ok(Math.abs(m.amps[2] - 0.5) < 1e-12);
  // h5: 0.05 in A, missing (floor −60 dB) in B → √(0.05 × 0.001) ≈ 0.00707
  assert.ok(Math.abs(m.amps[4] - Math.sqrt(0.05 * FLOOR)) < 1e-12);
  // h7+ missing in both → exactly 0
  assert.ok(m.amps.slice(6).every((a) => a === 0));
  // A quarter of the way: pitch 200^0.75 · 300^0.25
  const q = interpolate1D(A, B, 0.25);
  assert.ok(Math.abs(q.f0 - 200 ** 0.75 * 300 ** 0.25) < 1e-9);
});

test('slider movement gives finite values that change smoothly (no jumps above the floor)', () => {
  let prev = null;
  for (let k = 0; k <= 1000; k++) {
    const p = interpolate1D(A, B, k / 1000);
    assert.ok(Number.isFinite(p.f0) && p.f0 >= 200 && p.f0 <= 300);
    assert.ok(p.amps.every((a) => Number.isFinite(a) && a >= 0 && a <= 1));
    if (prev) {
      assert.ok(Math.abs(12 * Math.log2(p.f0 / prev.f0)) < 0.01, 'pitch step under 1 cent per 1/1000');
      p.amps.forEach((a, i) => {
        const b = prev.amps[i];
        if (a > 0 && b > 0) assert.ok(Math.abs(db(a) - db(b)) < 0.1, `h${i + 1} step`);
        else assert.ok(Math.max(a, b) <= FLOOR * 1.02, `h${i + 1} only switches on/off at the −60 dB floor`);
      });
    }
    prev = p;
  }
});

test('same fundamental: pitch stays steady while the vowel colour changes', () => {
  const B2 = { f0: 200, amps: B.amps };
  for (const t of [0, 0.3, 0.5, 0.9, 1]) assert.ok(Math.abs(interpolate1D(A, B2, t).f0 - 200) < 1e-9);
  assert.notDeepEqual(interpolate1D(A, B2, 0.5).amps, A.amps);
});

test('pitch hold option keeps one end’s pitch; blend is the default rule', () => {
  assert.equal(sliderParams(A, B, 0.7, 'a').f0, 200);
  assert.equal(sliderParams(A, B, 0.2, 'b').f0, 300);
  assert.deepEqual(sliderParams(A, B, 1, 'blend'), B);
});

// ───────────── 2D ─────────────

const dots3 = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.5, y: 0.9 }];

test('2D weights: zero, one, two and several dots; weights sum to 1', () => {
  assert.deepEqual(idwWeights([], { x: 0.5, y: 0.5 }), []);
  assert.deepEqual(idwWeights([{ x: 0.2, y: 0.3 }], { x: 0.9, y: 0.9 }), [1]);
  const two = idwWeights([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], { x: 0.5, y: 0.5 });
  assert.ok(Math.abs(two[0] - 0.5) < 1e-12 && Math.abs(two[1] - 0.5) < 1e-12);
  // A quarter of the way, standard power 2: distances 0.25 and 0.75 → 1/0.0625 : 1/0.5625 = 9 : 1
  const q = idwWeights([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], { x: 0.25, y: 0.5 });
  assert.ok(Math.abs(q[0] - 0.9) < 1e-12 && Math.abs(q[1] - 0.1) < 1e-12);
  const many = Array.from({ length: 7 }, (_, i) => ({ x: (i * 0.37) % 1, y: (i * 0.61) % 1 }));
  for (let k = 0; k < 200; k++) {
    const pt = { x: (k * 0.123) % 1, y: (k * 0.457) % 1 };
    for (const power of [1, 2, 4]) {
      const w = idwWeights(many, pt, power);
      assert.ok(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-12);
      assert.ok(w.every((x) => x >= 0 && Number.isFinite(x)));
    }
  }
});

test('2D: exactly on a dot gives that dot’s parameters exactly', () => {
  const C = { f0: 250, amps: full([0.5, 1, 0.2]) };
  const vowels = [vowelFrom(A, { pos: dots3[0] }), vowelFrom(B, { pos: dots3[1] }), vowelFrom(C, { pos: dots3[2] })];
  for (const [i, p] of [[0, A], [1, B], [2, C]]) {
    const r = blendAt(vowels, dots3[i]);
    assert.equal(r.status, 'blend');
    assert.deepEqual(r.params, p);
    assert.equal(r.contributions[i].weight, 1);
  }
});

test('2D weights are continuous, approach a dot smoothly and stay finite near and outside the dots', () => {
  for (let s = 2; s <= 12; s++) {
    const eps = 10 ** -s;
    const w = idwWeights(dots3, { x: 0.1 + eps, y: 0.1 });
    assert.ok(w[0] > 0.99 && w[0] <= 1 && w.every(Number.isFinite), `d=${eps}`);
  }
  // Small steps along a line never jump.
  let prev = null;
  for (let k = 0; k <= 2000; k++) {
    const w = idwWeights(dots3, { x: k / 2000, y: 0.5 });
    if (prev) w.forEach((x, i) => assert.ok(Math.abs(x - prev[i]) < 0.02));
    prev = w;
  }
  // Corners (outside the triangle of dots): still a proper blend.
  for (const c of [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }]) {
    const w = idwWeights(dots3, c);
    assert.ok(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-12 && w.every((x) => x > 0));
  }
});

test('coincident and nearly coincident dots are handled safely', () => {
  const same = [{ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0.9, y: 0.9 }];
  assert.deepEqual(idwWeights(same, { x: 0.4, y: 0.4 }), [0.5, 0.5, 0]);
  const w = idwWeights(same, { x: 0.6, y: 0.6 });
  assert.ok(Math.abs(w[0] - w[1]) < 1e-15 && Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-12);
  const near = [{ x: 0.5, y: 0.5 }, { x: 0.5 + 1e-7, y: 0.5 }];
  const wn = idwWeights(near, { x: 0.5 + 5e-8, y: 0.5 });
  assert.ok(wn.every(Number.isFinite) && Math.abs(wn[0] - 0.5) < 1e-6);
  assert.deepEqual(closePairs(near), [[0, 1]]);
  // Blending two different vowels stacked on one spot gives one finite sound.
  const r = blendAt([vowelFrom(A, { pos: same[0] }), vowelFrom(B, { pos: same[1] })], same[0]);
  assert.ok(Number.isFinite(r.params.f0) && Math.abs(r.params.f0 - Math.sqrt(200 * 300)) < 1e-9);
});

test('2D with zero or one usable dot: clear status and single-vowel playback', () => {
  assert.equal(blendAt([], { x: 0.5, y: 0.5 }).status, 'none');
  const bad = makeVowel({ name: 'noisy', pos: { x: 0.2, y: 0.2 }, analysis: { status: 'failed', amps: null } });
  assert.equal(blendAt([bad], { x: 0.5, y: 0.5 }).status, 'none');
  const one = blendAt([bad, vowelFrom(A, { name: 'Aa', pos: { x: 0.8, y: 0.8 } })], { x: 0.1, y: 0.1 });
  assert.equal(one.status, 'single');
  assert.deepEqual(one.params, A);
  assert.match(one.message, /Aa/);
  // A vowel that is not placed is not part of the blend.
  const notPlaced = blendAt([vowelFrom(A, { pos: { x: 0, y: 0 } }), vowelFrom(B)], { x: 1, y: 1 });
  assert.equal(notPlaced.contributions.length, 1);
});

test('2D uses the same blend rule as the slider: between two dots it equals the slider', () => {
  const vowels = [vowelFrom(A, { pos: { x: 0, y: 0.5 } }), vowelFrom(B, { pos: { x: 1, y: 0.5 } })];
  const r = blendAt(vowels, { x: 0.5, y: 0.5 });
  const s = interpolate1D(A, B, 0.5);
  assert.ok(Math.abs(r.params.f0 - s.f0) < 1e-9);
  r.params.amps.forEach((a, i) => assert.ok(Math.abs(a - s.amps[i]) < 1e-12));
});

// ───────────── sound ─────────────

test('loudness: every sound plays at the same RMS and can never clip', () => {
  for (const p of [A, B, interpolate1D(A, B, 0.5), { f0: 100, amps: new Array(HARMONICS).fill(1) }]) {
    const targets = oscillatorTargets(p, 48000);
    const rms = rmsOfAmps(targets.map((t) => t.gain));
    assert.ok(Math.abs(rms - TARGET_RMS) < 1e-12);
    assert.ok(targets.reduce((s, t) => s + t.gain, 0) < 1, 'worst-case peak below full scale');
  }
  assert.equal(loudnessGain({ f0: 200, amps: new Array(HARMONICS).fill(0) }, 48000), 0);
});

test('components near Nyquist fade out smoothly instead of switching off', () => {
  assert.equal(nyquistTaper(10000, 48000), 1);
  assert.equal(nyquistTaper(23600, 48000), 0);
  const mid = nyquistTaper(0.94 * 24000, 48000);
  assert.ok(mid > 0.45 && mid < 0.55);
  // 900 Hz × 48 harmonics: everything from 0.98 × 24 kHz up is silent.
  const pa = playedAmps({ f0: 900, amps: new Array(HARMONICS).fill(1) }, 48000);
  pa.forEach((a, i) => { if ((i + 1) * 900 >= 23520) assert.equal(a, 0); });
  // Gain falls continuously as the pitch rises past the edge.
  let prev = null;
  for (let f = 960; f <= 1000; f += 0.5) {
    const g = playedAmps({ f0: f, amps: new Array(HARMONICS).fill(1) }, 44100)[21];
    if (prev != null) assert.ok(Math.abs(g - prev) < 0.05);
    prev = g;
  }
});

test('exported sound is the intended generated sound: analyzing it gives back the blended parameters', () => {
  const mid = interpolate1D(A, B, 0.5);
  const x = renderParams(mid, { sampleRate: 48000, duration: 2 });
  let peak = 0;
  for (const s of x) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak < 1);
  const r = analyzeVowel(x, 48000, { from: 24000, to: 72000 });
  assert.ok(Math.abs(r.f0 - mid.f0) < 0.2, `${r.f0} vs ${mid.f0}`);
  const top = Math.max(...mid.amps);
  mid.amps.forEach((a, i) => {
    if (a / top > 0.03) assert.ok(Math.abs(db(r.amps[i]) - db(a / top)) < 0.5, `h${i + 1}`);
  });
  // One pitch only: no energy at A's or B's own fundamentals (200 and 300 Hz).
  assert.ok(Math.abs(r.f0 - 200) > 20 && Math.abs(r.f0 - 300) > 20);
});

test('original playback level matches the synthesizer’s RMS without passing 0.9 peak', () => {
  const quiet = tone({ f0: 200, amps: [0.1, 0.05] });
  const g = originalLevel(quiet);
  let s = 0; let peak = 0;
  for (const v of quiet) { s += (v * g) ** 2; peak = Math.max(peak, Math.abs(v * g)); }
  assert.ok(Math.abs(Math.sqrt(s / quiet.length) - TARGET_RMS) < 1e-3 || peak <= 0.9 + 1e-9);
  assert.ok(peak <= 0.9 + 1e-9);
});

// ───────────── project & backup ─────────────

test('take names never overwrite: a second "Aa" becomes "Aa (take 2)"', () => {
  assert.equal(takeName('Aa', []), 'Aa');
  assert.equal(takeName('Aa', ['Aa']), 'Aa (take 2)');
  assert.equal(takeName('Aa', ['Aa', 'Aa (take 2)']), 'Aa (take 3)');
});

test('project restore keeps names, pair, slider and dot positions and drops broken entries', () => {
  const p = emptyProject();
  const a = vowelFrom(A, { name: 'Aa', pos: { x: 0.2, y: 0.7 } });
  const b = vowelFrom(B, { name: 'Oo' });
  p.vowels.push(a, b);
  p.pair = { a: a.id, b: b.id };
  p.slider = 0.37;
  p.space.power = 4;
  const back = loadProject(JSON.parse(JSON.stringify({ ...p, vowels: [...p.vowels, null, 42] })));
  assert.equal(back.vowels.length, 2);
  assert.deepEqual(back.pair, p.pair);
  assert.equal(back.slider, 0.37);
  assert.equal(back.space.power, 4);
  assert.deepEqual(back.vowels[0].pos, { x: 0.2, y: 0.7 });
  assert.deepEqual(paramsOf(back.vowels[0]), A);
  assert.deepEqual(loadProject({ pair: { a: 'gone' } }).pair, { a: null, b: null });
});

test('backup round trip restores recordings sample-for-sample, analyses and dot positions, without touching existing data', () => {
  const samples = tone({ f0: 210, amps: [1, 0.4], sec: 0.5 });
  samples[17] = -0.123456789;
  const rec = { id: 'rec-1', name: 'Aa take', sampleRate: 44100, createdAt: 'now', samples };
  const p = emptyProject();
  const a = vowelFrom(A, { name: 'Aa', recordingId: 'rec-1', pos: { x: 0.3, y: 0.6 } });
  const b = vowelFrom(B, { name: 'Oo', pos: { x: 0.8, y: 0.1 } });
  p.vowels.push(a, b);
  p.pair = { a: a.id, b: b.id };
  const doc = JSON.parse(JSON.stringify(makeBackup(p, [rec, { id: 'unused', name: 'x', sampleRate: 48000, samples: new Float32Array(4) }])));
  assert.equal(doc.recordings.length, 1, 'only recordings that are used');
  const r = parseBackup(doc, ['Aa']);
  assert.ok(r.ok);
  assert.equal(r.vowels.length, 2);
  assert.equal(r.recordings.length, 1);
  assert.deepEqual(Array.from(r.recordings[0].samples), Array.from(samples));
  assert.equal(r.recordings[0].sampleRate, 44100);
  const ra = r.vowels[0];
  assert.notEqual(ra.id, a.id, 'fresh ids so nothing existing is overwritten');
  assert.equal(ra.recordingId, r.recordings[0].id);
  assert.equal(ra.name, 'Aa (imported)');
  assert.equal(r.vowels[1].name, 'Oo');
  assert.deepEqual(ra.pos, { x: 0.3, y: 0.6 });
  assert.deepEqual(paramsOf(ra), A);
  assert.deepEqual(r.pair, { a: ra.id, b: r.vowels[1].id });
  assert.equal(parseBackup({ format: 'something else' }).ok, false);
});

test('base64 sample encoding is exact', () => {
  const x = Float32Array.from([0, 1, -1, 0.5, 1e-30, -0.333333]);
  assert.deepEqual(Array.from(base64ToFloats(floatsToBase64(x))), Array.from(x));
});

test('note names', () => {
  assert.equal(noteName(440), 'A4');
  assert.equal(noteName(261.63), 'C4');
});

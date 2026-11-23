// Motion Morph round 4: drawn takes learn vowels AND fricatives, a drawn line
// counts as one source, and old pitch-only takes are analyzed again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { snippetSound, takeSource, blendSounds, soundParams, findPitch, NOISE_BANDS } from '../src/pages/pose-map/pose-sound.js';
import { analyzePoseTake, reanalyzePoseTake, recoverStartOffset, TAKE_ANALYSIS_VERSION } from '../src/pages/pose-map/pose-takes.js';
import { analyzeMySound } from '../src/pages/pose-map/sound-analysis.js';
import { takeToAngles, loadProject, anglesToPoint, DEFAULT_CAL } from '../src/pages/pose-map/pose-model.js';
import { analyzeVowel } from '../src/pages/frequency/auto-vowel.js';
import { idwWeights } from '../src/pages/vowel-morph/morph-model.js';

const SR = 48000;
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

function tone(f0, sec, amps = [1, 0.6, 0.4, 0.25, 0.15, 0.1], gain = 0.1) {
  const x = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < x.length; i++) { let v = 0; amps.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * f0 * (k + 1) * i / SR); }); x[i] = gain * v; }
  return x;
}
function hiss(sec, { lo = 4500, hi = 11000, gain = 0.3, seed = 7 } = {}) {
  const n = Math.round(sec * SR);
  const x = new Float32Array(n);
  let s = seed; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; x[i] = s / 1073741823.5 - 1; }
  const y = new Float32Array(n);
  const aH = Math.exp(-2 * Math.PI * lo / SR); const aL = Math.exp(-2 * Math.PI * hi / SR);
  for (let pass = 0; pass < 2; pass++) {
    let hp = 0; let px = 0; let lp = 0;
    for (let i = 0; i < n; i++) { const v = pass ? y[i] : x[i]; hp = aH * (hp + v - px); px = v; lp = (1 - aL) * hp + aL * lp; y[i] = lp; }
  }
  let m = 0; for (const v of y) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] *= gain / m;
  return y;
}
const cat = (...parts) => { const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const add = (a, b) => a.map((v, i) => v + (b[i] || 0));
const snip = (x) => { const w = { from: 0, to: x.length }; return snippetSound(x, SR, w, findPitch(x, SR, w)); };

test('snippetSound: a vowel snippet is pitched, a hiss is noise, a buzz with hiss keeps both', () => {
  const v = snip(tone(180, 0.2));
  assert.equal(v.outcome, 'pitched');
  assert.ok(Math.abs(v.params.f0 - 180) < 3 && v.params.voiced === 1 && v.params.bands === null);
  const s = snip(hiss(0.2));
  assert.equal(s.outcome, 'noise', JSON.stringify(s));
  assert.ok(Number.isNaN(s.params.f0) && s.params.voiced === 0 && s.params.bands.length === NOISE_BANDS);
  const z = snip(add(tone(150, 0.2, [1, 0.5, 0.3], 0.08), hiss(0.2, { gain: 0.25 })));
  assert.equal(z.outcome, 'mixed', JSON.stringify({ o: z.outcome }));
  assert.ok(z.params.voiced > 0.05 && z.params.voiced < 0.95 && Math.abs(z.params.f0 - 150) < 5 && z.params.bands.length === NOISE_BANDS, `${z.params.voiced}`);
  assert.equal(snip(new Float32Array(SR * 0.2)).outcome, 'silent');
});

test('analyzeMySound: a single recording with both a pitch and strong hiss keeps both parts', () => {
  const r = analyzeMySound({ samples: add(tone(150, 3, [1, 0.5, 0.3], 0.08), hiss(3, { gain: 0.25 })), sampleRate: SR });
  assert.ok(r.ok, r.reason);
  assert.equal(r.analysis.kind, 'mixed');
  assert.ok(r.analysis.voiced > 0 && r.analysis.voiced < 1 && r.analysis.noise.bands.length === NOISE_BANDS);
  const p = soundParams(r.analysis);
  assert.equal(p.kind, 'mixed');
  assert.equal(analyzeMySound({ samples: tone(233, 3), sampleRate: SR }).analysis.kind, 'pitched', 'a clean hum stays pitched');
});

// "ah" for 1.5 s, then "sss" for 1.5 s, while the pointer moves left → right at constant speed
function vowelThenHiss() {
  const samples = cat(tone(196, 1.5), hiss(1.5));
  const path = [];
  for (let t = 0; t <= 3000; t += 20) path.push({ x: t / 3000, y: 0.5, t: 10000 + t });
  return { samples, sampleRate: SR, startMs: 10000, path };
}

test('analyzePoseTake: a vowel → fricative take keeps pitched dots then NOISE dots (nothing skipped as “unpitched”)', () => {
  const a = analyzePoseTake(vowelThenHiss());
  const pitched = a.points.filter((p) => p.kind === 'pitched');
  const noise = a.points.filter((p) => p.kind === 'noise');
  assert.ok(pitched.length >= 10 && noise.length >= 10, JSON.stringify(a.stats));
  assert.ok(pitched.every((p) => p.x < 0.55 && Math.abs(p.f0 - 196) < 5));
  assert.ok(noise.every((p) => p.x > 0.45 && p.f0 === null && p.voiced === 0 && p.bands.length === NOISE_BANDS));
  assert.equal(a.stats.noise, noise.length);
  assert.ok(a.stats.unreliable <= 3, `${a.stats.unreliable} unreliable`);
  assert.equal(a.startOffsetMs, 0);
});

function oldPitchOnlyTake(offsetMs = 0) {
  // what the earlier, pitch-only analysis saved: only the vowel half, as angles
  const v = vowelThenHiss();
  const a = analyzePoseTake({ ...v, startMs: v.startMs + offsetMs });
  const mapTake = { id: 'take-old', name: 'Take 1', recordingId: 'rec-1', durationSec: 3, path: v.path.map((q) => ({ x: q.x, y: q.y, t: q.t - v.path[0].t })), points: a.points.filter((p) => p.kind === 'pitched').map((p) => ({ x: p.x, y: p.y, t: p.t, f0: p.f0, amps: p.amps, status: 'ok' })), stats: { snippets: a.stats.snippets, usable: 14, silent: 0, unreliable: 15 } };
  const raw = { version: 4, sounds: [], takes: [takeToAngles(mapTake, DEFAULT_CAL)] };
  return { project: loadProject(raw), rec: { samples: v.samples, sampleRate: SR } };
}

test('old pitch-only takes load as analysis version 1 and are analyzed again from the recording', () => {
  const { project, rec } = oldPitchOnlyTake();
  const old = project.takes[0];
  assert.equal(old.analysisVersion, 1);
  assert.ok(old.points.every((p) => p.kind === 'pitched'));
  assert.equal(recoverStartOffset(old, SR), 0);
  const nt = reanalyzePoseTake(old, rec);
  assert.equal(nt.analysisVersion, TAKE_ANALYSIS_VERSION);
  const noise = nt.points.filter((p) => p.kind === 'noise');
  assert.ok(noise.length >= 10, JSON.stringify(nt.stats));
  // the pitched dots land where they were before
  const before = old.points[0];
  const same = nt.points.find((p) => p.t === before.t);
  assert.ok(same && close(same.bend, before.bend, 0.11) && close(same.lift, before.lift, 0.11));
  // and the result survives saving and loading
  const again = loadProject(JSON.parse(JSON.stringify({ version: 4, sounds: [], takes: [nt] }))).takes[0];
  assert.equal(again.analysisVersion, 2);
  assert.equal(again.points.filter((p) => p.kind === 'noise').length, noise.length);
  assert.equal(again.stats.noise, noise.length);
});

test('recoverStartOffset finds a recording that started a little after the pointer', () => {
  const { project } = oldPitchOnlyTake(40);
  assert.ok(Math.abs(recoverStartOffset(project.takes[0], SR) - 40) <= 1);
  assert.equal(recoverStartOffset({ startOffsetMs: 12, points: [] }, SR), 12);
  assert.equal(recoverStartOffset({ points: [] }, SR), 0);
});

const P = (f0) => soundParams({ kind: 'pitched', f0, amps: [1, 0.5] });
const N = soundParams({ kind: 'noise', noise: { bands: Array.from({ length: NOISE_BANDS }, (_, i) => (i > 18 ? 1 : 0.05)) } });

test('takeSource: a dense line is ONE source, and its sound is interpolated along the line', () => {
  const line = Array.from({ length: 60 }, (_, i) => ({ pos: { x: 1, y: i / 59 }, params: N }));
  const here = { x: 0.6, y: 0.5 };
  const ts = takeSource(line, here);
  assert.ok(close(ts.pos.x, 1) && close(ts.pos.y, 0.5) && close(ts.distance, 0.4));
  // same weight as a single dot at the same distance
  const vowel = { x: 0, y: 0.5 };
  const wLine = idwWeights([vowel, ts.pos], here, 2);
  const wDot = idwWeights([vowel, { x: 1, y: 0.5 }], here, 2);
  assert.ok(close(wLine[1], wDot[1]));
  // counting every point separately (the old way) would have given the line far more weight
  const wOld = idwWeights([vowel, ...line.map((p) => p.pos)], here, 2);
  assert.ok(wOld.slice(1).reduce((a, b) => a + b, 0) > wLine[1] + 0.25);
  // interpolation between neighbouring learned points
  const two = takeSource([{ pos: { x: 0, y: 0 }, params: P(200) }, { pos: { x: 1, y: 0 }, params: P(300) }], { x: 0.25, y: 0.3 });
  assert.ok(close(two.u, 0.25) && close(two.params.f0, 225));
  const vToN = takeSource([{ pos: { x: 0, y: 0 }, params: P(200) }, { pos: { x: 1, y: 0 }, params: N }], { x: 0.5, y: 0 });
  assert.equal(vToN.params.kind, 'mixed');
  assert.ok(close(vToN.params.voiced, 0.5) && close(vToN.params.f0, 200));
});

test('moving from a vowel dot to a fricative line: noise share rises gradually from ≈0 to 1', () => {
  const vowel = { pos: { x: 0.1, y: 0.5 }, params: P(196) };
  const line = Array.from({ length: 30 }, (_, i) => ({ pos: { x: 0.9, y: 0.2 + 0.6 * i / 29 }, params: N }));
  const shares = [];
  for (let x = 0.1; x <= 0.9 + 1e-9; x += 0.1) {
    const here = { x, y: 0.5 };
    const ts = takeSource(line, here);
    const w = idwWeights([vowel.pos, ts.pos], here, 2);
    const b = blendSounds([{ params: vowel.params, weight: w[0] }, { params: ts.params, weight: w[1] }]);
    assert.ok(close(b.harm + b.noise, 1));
    assert.ok(x > 0.85 || close(b.f0, 196), 'f0 stays the vowel’s');
    shares.push(b.noise);
  }
  assert.ok(shares[0] < 0.01 && shares[shares.length - 1] > 0.99, shares.join(' '));
  for (let i = 1; i < shares.length; i++) assert.ok(shares[i] >= shares[i - 1] - 1e-12, 'monotonic');
  assert.ok(Math.abs(shares[4] - 0.5) < 0.05, `midpoint ${shares[4]}`);
  const intermediate = shares.filter((s) => s > 0.1 && s < 0.9).length;
  assert.ok(intermediate >= 3, 'a gradual transition, not a switch');
});

test('noise and mixed take points survive takeToAngles and loading; positions follow the range', () => {
  const t = takeToAngles({ id: 't', name: 'Take 2', path: [{ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 1000 }], durationSec: 1, points: [
    { x: 0.5, y: 0.5, t: 500, kind: 'noise', voiced: 0, f0: null, amps: new Array(48).fill(0), bands: N.bands },
    { x: 0.6, y: 0.5, t: 600, kind: 'mixed', voiced: 0.4, f0: 150, amps: [1, 0.3], bands: N.bands },
  ], stats: {}, analysisVersion: 2, startOffsetMs: 0 }, DEFAULT_CAL);
  const back = loadProject({ version: 4, sounds: [], takes: [t] }).takes[0];
  assert.deepEqual(back.points.map((p) => p.kind), ['noise', 'mixed']);
  assert.equal(soundParams(back.points[0]).kind, 'noise');
  const m = soundParams(back.points[1]);
  assert.ok(m.kind === 'mixed' && close(m.voiced, 0.4) && m.f0 === 150);
  assert.ok(close(anglesToPoint(back.points[0], DEFAULT_CAL).x, 0.5, 0.01));
  assert.equal(back.analysisVersion, 2);
  assert.equal(back.startOffsetMs, 0);
});

// ── morph blending: one shared spectral shape between a vowel and a fricative ──
import { envelopeParts, sampleEnvelope, BAND_CENTERS } from '../src/pages/pose-map/pose-sound.js';
const AH = soundParams({ kind: 'pitched', f0: 196, amps: Array.from({ length: 48 }, (_, i) => (i < 5 ? [0.5, 0.8, 1, 0.9, 0.5][i] : 0.3 / (i + 1))) });
const SSS = soundParams({ kind: 'noise', noise: { bands: Array.from({ length: NOISE_BANDS }, (_, i) => (i > 17 ? 1 : 0.02)) } });
const dbCentroid = (vals, freqs) => { let s = 0; let w = 0; vals.forEach((a, i) => { s += a * a * freqs[i]; w += a * a; }); return s / w; };

test('morph: endpoints are the sounds themselves; half-way both parts share ONE in-between shape', () => {
  const at = (wN) => blendSounds([{ params: AH, weight: 1 - wN }, { params: SSS, weight: wN }], { mode: 'morph' });
  const near0 = at(1e-6);
  assert.equal(near0.mode, 'morph');
  for (let n = 0; n < 10; n++) assert.ok(Math.abs(near0.amps[n] - AH.amps[n]) < 0.01, `harmonic ${n + 1}`);
  const near1 = at(1 - 1e-6);
  for (let b = 0; b < NOISE_BANDS; b++) assert.ok(Math.abs(near1.bands[b] - SSS.bands[b]) < 0.01, `band ${b}`);
  const mid = at(0.5);
  // compare the two parts' shapes at the same frequencies (dB, overall offset removed)
  const shapeGap = (bl) => {
    const d = BAND_CENTERS.filter((c) => c > 250 && c < 9000).map((c) => {
      const n = Math.max(1, Math.round(c / 196));
      return 20 * Math.log10(Math.max(1e-3, bl.amps[n - 1])) - 20 * Math.log10(Math.max(1e-3, bl.bands[BAND_CENTERS.indexOf(c)]));
    });
    const m = d.reduce((x, y) => x + y, 0) / d.length;
    return d.reduce((x, y) => x + Math.abs(y - m), 0) / d.length;
  };
  const layer = blendSounds([{ params: AH, weight: 0.5 }, { params: SSS, weight: 0.5 }]);
  assert.ok(shapeGap(mid) < 2.5, `morph: parts differ by ${shapeGap(mid).toFixed(1)} dB on average`);
  assert.ok(shapeGap(layer) > 10, `layer: parts differ by ${shapeGap(layer).toFixed(1)} dB (two different sounds)`);
  // the shape glides: its centre rises steadily from the vowel's to the hiss's
  const cs = [0.1, 0.3, 0.5, 0.7, 0.9].map((w) => { const b = at(w); return dbCentroid(b.bands, BAND_CENTERS); });
  for (let i = 1; i < cs.length; i++) assert.ok(cs[i] > cs[i - 1], cs.map((c) => c.toFixed(0)).join(' '));
  assert.ok(close(mid.f0, 196) && close(mid.harm, 0.5) && close(mid.noise, 0.5), 'pitch and part shares as before');
});

test('morph leaves vowel ↔ vowel blends and a single mixed sound as they were', () => {
  const EE = soundParams({ kind: 'pitched', f0: 300, amps: [0.2, 1] });
  assert.deepEqual(blendSounds([{ params: AH, weight: 0.5 }, { params: EE, weight: 0.5 }], { mode: 'morph' }).amps, blendSounds([{ params: AH, weight: 0.5 }, { params: EE, weight: 0.5 }]).amps);
  const Z = soundParams({ kind: 'mixed', voiced: 0.6, f0: 150, amps: [1, 0.5, 0.25], noise: { bands: SSS.bands } });
  const one = blendSounds([{ params: Z, weight: 1 }], { mode: 'morph' });
  for (let n = 0; n < 3; n++) assert.ok(Math.abs(one.amps[n] - Z.amps[n]) < 0.01);
  for (let b = 0; b < NOISE_BANDS; b++) assert.ok(Math.abs(one.bands[b] - SSS.bands[b]) < 0.01);
  const e = envelopeParts(AH);
  assert.ok(e.harm && !e.noise && Math.abs(sampleEnvelope(e.harm, 3 * 196)) < 0.1);
});

// Vowel Lab (assignment 2): WAV round trips, harmonic recipes, rendering,
// spectrum analysis and experiment records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, decodeWav } from '../src/pages/frequency/wav.js';
import {
  harmonicRows, soundingHarmonics, recipePeak, outputGain, renderRecipe, segmentSpectrum, relativeToMax, peakNear,
  startRecipe, resizeAmps, parseFundamental, parseAmp, defaultSegment, clampSegment, uniqueName,
  makeExperiment, duplicateExperiment, hasUnsavedChanges, snapshot, settingsDocument, parseSettings, fileBase,
  experimentLabel, pitchChange, dbToAmp, OUTPUT_PEAK, MAX_HARMONICS,
} from '../src/pages/frequency/vowel-model.js';

test('WAV export is 16-bit PCM mono and decodes back to the same samples', () => {
  const sr = 48000;
  const x = new Float32Array(4800).map((_, i) => 0.6 * Math.sin((2 * Math.PI * 200 * i) / sr));
  const { buffer, clipped } = encodeWav(x, sr);
  assert.equal(clipped, 0);
  assert.equal(buffer.byteLength, 44 + x.length * 2);
  const v = new DataView(buffer);
  assert.equal(v.getUint16(20, true), 1); // PCM
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint32(24, true), sr);
  assert.equal(v.getUint16(34, true), 16);
  const d = decodeWav(buffer);
  assert.equal(d.sampleRate, sr);
  assert.equal(d.samples.length, x.length);
  let err = 0;
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(d.samples[i] - x[i]));
  assert.ok(err < 1 / 16000, `max error ${err}`); // 16-bit quantization
});

test('WAV export clips out-of-range samples and counts them; decoder rejects non-WAV data', () => {
  const { buffer, clipped } = encodeWav(new Float32Array([0, 1.5, -2, 0.5, NaN]), 8000);
  assert.equal(clipped, 2);
  const d = decodeWav(buffer);
  assert.ok(Math.abs(d.samples[1] - 1) < 1e-4 && Math.abs(d.samples[2] + 1) < 1e-4 && d.samples[4] === 0);
  assert.throws(() => decodeWav(new ArrayBuffer(20)), /not a WAV/);
});

test('harmonic frequencies are n × f0 and components at or above Nyquist are excluded', () => {
  const rows = harmonicRows(196, [1, 0.5, 0, 0.25], 24000);
  assert.deepEqual(rows.map((r) => r.freq), [196, 392, 588, 784]);
  assert.deepEqual(rows.map((r) => r.n), [1, 2, 3, 4]);
  const near = harmonicRows(5000, [1, 1, 1, 1, 1], 22050);
  assert.deepEqual(near.map((r) => r.audible), [true, true, true, true, false]); // 25 kHz ≥ Nyquist
  assert.deepEqual(soundingHarmonics(196, [1, 0.5, 0, 0.25], 24000).map((r) => r.n), [1, 2, 4]); // amplitude 0 is silent
  const exact = harmonicRows(6000, [1, 1, 1, 1], 24000);
  assert.equal(exact[3].audible, false, 'exactly at Nyquist is excluded');
});

test('changing the fundamental moves every harmonic but keeps the amplitudes', () => {
  const amps = [0.8, 0.1, 0.6, 0.3];
  const a = harmonicRows(150, amps, 24000);
  const b = harmonicRows(225, amps, 24000);
  assert.deepEqual(a.map((r) => r.amp), b.map((r) => r.amp));
  assert.deepEqual(b.map((r) => r.freq / r.n), [225, 225, 225, 225]);
});

test('recipe peak and output gain put the synthesized peak at the target level', () => {
  assert.ok(Math.abs(recipePeak(200, [1], 24000) - 1) < 1e-6);
  const amps = startRecipe('neutral', 12);
  const g = outputGain(200, amps, 24000);
  const y = renderRecipe({ f0: 200, amps, sampleRate: 48000, duration: 0.2, gain: g, fadeSec: 0 });
  let p = 0;
  for (const v of y) p = Math.max(p, Math.abs(v));
  assert.ok(Math.abs(p - OUTPUT_PEAK) < 0.005, `peak ${p}`);
  assert.equal(outputGain(200, startRecipe('zero', 8), 24000), 0);
});

test('rendering follows the formula sample by sample, with fades at both ends', () => {
  const sr = 8000;
  const amps = [0.5, 0, 0.25];
  const y = renderRecipe({ f0: 100, amps, sampleRate: sr, duration: 0.5, gain: 1, fadeSec: 0.02 });
  assert.equal(y.length, 4000);
  for (const i of [500, 1234, 3000]) {
    const t = i / sr;
    const want = 0.5 * Math.sin(2 * Math.PI * 100 * t) + 0.25 * Math.sin(2 * Math.PI * 300 * t);
    assert.ok(Math.abs(y[i] - want) < 1e-6);
  }
  assert.equal(Math.abs(y[0]), 0);
  assert.equal(Math.abs(y[y.length - 1]), 0);
  assert.ok(Math.abs(y[80]) <= Math.abs(0.75 * 0.5) + 1e-9); // inside the 20 ms (160-sample) fade
});

test('sliders are independent: changing one amplitude changes only that harmonic in the spectrum', () => {
  const sr = 48000;
  const base = [0.5, 0.5, 0.5, 0.5];
  const changed = [0.5, 0.5, 0.05, 0.5];
  const spec = (amps) => segmentSpectrum(renderRecipe({ f0: 187.5, amps, sampleRate: sr, duration: 0.5, gain: 1, fadeSec: 0 }), sr, { fftSize: 8192 });
  const a = spec(base);
  const b = spec(changed);
  const lvl = (s, f) => peakNear(s.db, s.binHz, f).db;
  for (const n of [1, 2, 4]) assert.ok(Math.abs(lvl(a, 187.5 * n) - lvl(b, 187.5 * n)) < 0.2, `harmonic ${n} unchanged`);
  assert.ok(Math.abs(lvl(a, 562.5) - lvl(b, 562.5) - 20) < 0.5, 'harmonic 3 dropped by 20 dB (0.5 → 0.05)');
});

test('segment spectrum shows a sine of amplitude A near 20·log10(A) dB at its frequency', () => {
  const sr = 48000;
  const x = new Float32Array(sr).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr));
  const s = segmentSpectrum(x, sr, { from: 0, to: sr, fftSize: 4096 });
  assert.ok(s.frames >= 20 && !s.padded);
  const p = peakNear(s.db, s.binHz, 1000);
  assert.ok(Math.abs(p.freq - 1000) < 2, `freq ${p.freq}`);
  assert.ok(Math.abs(p.db - 20 * Math.log10(0.5)) < 1.6, `level ${p.db}`); // Hann scalloping ≤ 1.42 dB
  const rel = relativeToMax(s.db, s.binHz);
  assert.ok(Math.abs(rel.db[p.bin]) < 1e-6);
  const short = segmentSpectrum(x, sr, { from: 0, to: 1000, fftSize: 4096 });
  assert.ok(short.padded && short.frames === 1);
});

test('starting recipes are neutral and resizing keeps existing amplitudes', () => {
  assert.deepEqual(startRecipe('neutral', 4), [1, 0.5, 0.333, 0.25]);
  assert.deepEqual(startRecipe('fundamental', 3), [1, 0, 0]);
  assert.deepEqual(resizeAmps([0.2, 0.4], 4), [0.2, 0.4, 0, 0]);
  assert.deepEqual(resizeAmps([0.2, 0.4, 0.6], 2), [0.2, 0.4]);
  assert.equal(dbToAmp(-60), 0);
  assert.equal(dbToAmp(-6), 0.501);
});

test('fundamental and amplitude validation', () => {
  assert.deepEqual(parseFundamental('196.5'), { ok: true, value: 196.5 });
  assert.equal(parseFundamental('20').ok, false);
  assert.equal(parseFundamental('1,5').ok, false);
  assert.equal(parseFundamental('abc').ok, false);
  assert.equal(parseAmp('0').value, 0);
  assert.equal(parseAmp('1.2').ok, false);
});

test('segments stay inside the recording; names never silently collide', () => {
  assert.deepEqual(defaultSegment(3), { start: 1, end: 2 });
  assert.deepEqual(clampSegment({ start: 2.5, end: -1 }, 3), { start: 0, end: 2.5 });
  assert.deepEqual(clampSegment({ start: 2.99, end: 2.99 }, 3), { start: 2.95, end: 3 });
  assert.equal(uniqueName('ah — lower pitch', ['ah — lower pitch', 'ah — lower pitch (2)']), 'ah — lower pitch (3)');
  assert.equal(uniqueName('ee — lower pitch', ['ah — lower pitch']), 'ee — lower pitch');
});

test('duplicating for a second pitch leaves the source experiment untouched', () => {
  const src = makeExperiment({ vowel: 'ah', pitch: 'lower', f0: 180, count: 8, amps: [1, 0.8, 0.6, 0.2, 0.1, 0, 0, 0], recordingId: 'rec-1', segment: { start: 1, end: 2 } });
  src.notes.general = 'first try';
  const before = JSON.stringify(src);
  const a = duplicateExperiment(src, 'A');
  a.f0 = 270;
  a.amps[0] = 0.1;
  const b = duplicateExperiment(src, 'B');
  assert.equal(JSON.stringify(src), before);
  assert.notEqual(a.id, src.id);
  assert.equal(a.comparison, 'A');
  assert.equal(a.recordingId, 'rec-1', 'A keeps the first recording for listening back');
  assert.equal(b.recordingId, null, 'B waits for a new recording');
  assert.deepEqual(b.amps, src.amps);
  assert.equal(a.pitch, 'higher');
  assert.equal(a.parentF0, 180);
  assert.equal(fileBase(src), 'ah_lower');
  assert.equal(fileBase(a), 'ah_higher_sameamps');
  assert.equal(fileBase(b), 'ah_higher');
  assert.match(experimentLabel(a), /A: same amplitudes/);
  assert.ok(Math.abs(pitchChange(180, 270).semitones - 7.02) < 0.01);
});

test('unsaved changes are detected against the saved snapshot', () => {
  const e = makeExperiment({ count: 4 });
  const saved = snapshot({ ...e, savedAt: '2026-01-01T00:00:00Z' });
  assert.equal(hasUnsavedChanges(e, saved), false);
  e.amps[2] = 0.9;
  assert.equal(hasUnsavedChanges(e, saved), true);
  assert.equal(hasUnsavedChanges(e, null), true);
});

test('settings export and import restore the recipe, labels, segment and notes', () => {
  const e = makeExperiment({ vowel: 'ee', pitch: 'higher', f0: 262.5, count: 6, amps: [0.9, 0.05, 0.3, 0, 0.12, 0.01], segment: { start: 0.8, end: 1.9 } });
  e.notes.recognizable = 'mostly';
  const rec = { name: 'ee — higher pitch', sampleRate: 48000, samples: new Float32Array(48000 * 3) };
  const doc = JSON.parse(JSON.stringify(settingsDocument(e, { recording: rec, nyquist: 24000, synthDuration: 3, sampleRate: 48000 })));
  assert.equal(doc.files.original, 'ee_higher_original.wav');
  assert.equal(doc.files.synthesized, 'ee_higher_synthesized.wav');
  assert.equal(doc.files.settings, 'ee_higher_settings.json');
  assert.deepEqual(doc.harmonics.map((x) => x.frequencyHz), [262.5, 525, 787.5, 1050, 1312.5, 1575]);
  const r = parseSettings(doc);
  assert.ok(r.ok, r.error);
  const x = r.experiment;
  assert.notEqual(x.id, e.id, 'import creates a new experiment; it never overwrites one');
  assert.equal(x.vowel, 'ee');
  assert.equal(x.pitch, 'higher');
  assert.equal(x.f0, 262.5);
  assert.deepEqual(x.amps, e.amps);
  assert.deepEqual(x.segment, { start: 0.8, end: 1.9 });
  assert.equal(x.notes.recognizable, 'mostly');
  assert.equal(r.recordingName, 'ee — higher pitch');
});

test('settings import rejects foreign files and out-of-range values', () => {
  assert.equal(parseSettings({ hello: 1 }).ok, false);
  assert.equal(parseSettings({ format: 'frequency-playground.vowel-experiment', fundamentalHz: 5, harmonics: [{ n: 1, amplitude: 1 }] }).ok, false);
  const r = parseSettings({ format: 'frequency-playground.vowel-experiment', fundamentalHz: 200, harmonics: [{ n: 1, amplitude: 3 }, { n: 2, amplitude: 0.5 }] });
  assert.ok(r.ok);
  assert.equal(r.experiment.amps[0], 0);
  assert.equal(r.experiment.amps[1], 0.5);
  assert.ok(r.warnings.length >= 1);
  const many = { format: 'frequency-playground.vowel-experiment', fundamentalHz: 100, harmonics: Array.from({ length: 60 }, (_, i) => ({ n: i + 1, amplitude: 0.1 })) };
  assert.equal(parseSettings(many).experiment.count, MAX_HARMONICS);
});

// Noise source and fricative experiments in Vowel filtering: what the mix
// does to the sound, the preset starting points and the estimate from a
// recording.
//
// These use generated signals with known answers. They show the numbers are
// right; they do not show that the result sounds like "shh" or "sss". That
// needs listening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as VF from '../src/pages/frequency/vowel-filter.js';
import { segmentSpectrum } from '../src/pages/frequency/vowel-model.js';

const SR = 48000;
const FLAT = VF.defaultBands();
const args = { f0: 200, count: 32, sampleRate: SR };
const noiseMix = (noise = 1) => ({ voiced: 0, noise, voicedDirect: false });

/** Mean level in dB of the spectrum from lo to hi Hz. */
function bandDb(x, lo, hi) {
  const s = segmentSpectrum(x, SR, { fftSize: 2048 });
  let p = 0; let n = 0;
  for (let k = Math.round(lo / s.binHz); k <= Math.round(hi / s.binHz); k++) { p += 10 ** (s.db[k] / 10); n++; }
  return 10 * Math.log10(p / n);
}

test('default mix leaves the vowel sound exactly as it was', () => {
  const a = VF.renderFiltered({ ...args, bands: FLAT, duration: 0.2 });
  const b = VF.renderFiltered({ ...args, bands: FLAT, duration: 0.2, mix: VF.DEFAULT_MIX });
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.deepEqual(VF.makeFilterExperiment({}).mix, VF.DEFAULT_MIX); // experiments saved before noise existed
  assert.equal(VF.sourceTag(VF.makeFilterExperiment({ f0: 200, count: 32 })), '200 Hz × 32 equal harmonics');
});

test('mix values are cleaned to 0…1', () => {
  assert.deepEqual(VF.cleanMix({ voiced: 2, noise: -1, voicedDirect: 1 }), { voiced: 1, noise: 0, voicedDirect: true });
  assert.deepEqual(VF.cleanMix(null), VF.DEFAULT_MIX);
});

test('noise is repeatable, white and scaled by its level', () => {
  assert.equal(VF.noiseLoop(SR), VF.noiseLoop(SR));
  const x = VF.renderSteady({ ...args, bands: FLAT, enabled: false, length: SR, mix: noiseMix(1) });
  const half = VF.renderSteady({ ...args, bands: FLAT, enabled: false, length: SR, mix: noiseMix(0.5) });
  assert.ok(Math.abs(VF.rmsOf(half) / VF.rmsOf(x) - 0.5) < 1e-6);
  assert.ok(Math.abs(VF.rmsOf(x) - VF.NOISE_PEAK / Math.sqrt(3)) < 0.002, 'RMS of uniform noise');
  assert.ok(Math.abs(bandDb(x, 500, 1000) - bandDb(x, 6000, 12000)) < 1, 'equal energy density low and high');
});

test('the filter shapes the noise: output spectrum follows the filter response', () => {
  const bands = VF.defaultBands();
  bands[3] = { f: 1250, gainDb: -30, q: 1.5 };
  const y = VF.renderSteady({ ...args, bands, enabled: true, length: 2 * SR, mix: noiseMix(1) });
  const x = VF.renderSteady({ ...args, bands, enabled: false, length: 2 * SR, mix: noiseMix(1) });
  const drop = bandDb(x, 1200, 1300) - bandDb(y, 1200, 1300);
  assert.ok(Math.abs(drop - 30) < 3, `drop ${drop.toFixed(1)} dB`);
  assert.ok(Math.abs(bandDb(x, 14000, 18000) - bandDb(y, 14000, 18000)) < 1, 'far away nothing changes');
});

test('noise and harmonics blend, and "harmonics skip the filter" shapes only the noise', () => {
  const bands = VF.defaultBands();
  bands[0] = { f: 200, gainDb: -40, q: 2 };
  const level = (mix) => bandDb(VF.renderSteady({ ...args, count: 4, bands, enabled: true, length: SR, mix }), 190, 210);
  const through = level({ voiced: 1, noise: 0, voicedDirect: false });
  const skip = level({ voiced: 1, noise: 0, voicedDirect: true });
  assert.ok(skip - through > 30, `${(skip - through).toFixed(1)} dB`);
  const both = VF.renderSteady({ ...args, count: 4, bands: FLAT, enabled: true, length: SR, mix: { voiced: 0.5, noise: 0.5, voicedDirect: false } });
  const sines = VF.renderSteady({ ...args, count: 4, bands: FLAT, enabled: true, length: SR, mix: { voiced: 0.5, noise: 0, voicedDirect: false } });
  assert.ok(bandDb(both, 5000, 8000) - bandDb(sines, 5000, 8000) > 40, 'noise adds energy where the sines have none');
});

test('a silent mix is recognized', () => {
  const comps = VF.harmonicComponents(200, 4);
  assert.equal(VF.hasSound(comps, { voiced: 0, noise: 0 }, SR), false);
  assert.equal(VF.hasSound([], { voiced: 1, noise: 0 }, SR), false);
  assert.equal(VF.hasSound([], { voiced: 0, noise: 0.1 }, SR), true);
  assert.equal(VF.hasSound(comps, VF.DEFAULT_MIX, SR), true);
});

test('fricative presets: fricative order of energy and safe levels', () => {
  const y = {};
  for (const x of VF.FRICATIVES) {
    const { bands, fit } = VF.fricativeFilter(x.id, SR);
    assert.equal(bands.length, VF.BAND_COUNT);
    assert.ok(bands.every((b) => b.gainDb <= 0), 'cut only');
    assert.ok(fit.rmsErrorDb < 4, `${x.id} fit ${fit.rmsErrorDb} dB`);
    y[x.id] = VF.renderSteady({ ...args, count: x.count || 32, bands, enabled: true, length: 2 * SR, mix: x.mix });
    assert.ok(VF.peakOf(y[x.id]) < 1, `${x.id} peak`);
    assert.ok(VF.rmsOf(y[x.id]) > 0.02, `${x.id} is audible`);
  }
  // "sss" has more of its energy above 5 kHz than "shh"; "shh" more around 3 kHz.
  const tilt = (s) => bandDb(s, 6000, 8000) - bandDb(s, 2500, 3500);
  assert.ok(tilt(y.sss) > tilt(y.shh) + 10, `${tilt(y.sss).toFixed(1)} vs ${tilt(y.shh).toFixed(1)}`);
  // "fff" is the quietest and the flattest above 1.5 kHz.
  assert.ok(VF.rmsOf(y.fff) < VF.rmsOf(y.shh) && VF.rmsOf(y.fff) < VF.rmsOf(y.sss));
  assert.ok(Math.abs(bandDb(y.fff, 2000, 3000) - bandDb(y.fff, 5000, 7000)) < 5);
  // "jjj" keeps low harmonics that "shh" does not have.
  assert.ok(bandDb(y.jjj, 190, 210) - bandDb(y.shh, 190, 210) > 20);
});

test('the worst-case mix stays below full scale for every preset filter', () => {
  for (const x of VF.FRICATIVES) {
    const y = VF.renderSteady({ ...args, bands: VF.fricativeFilter(x.id, SR).bands, enabled: true, length: SR, mix: { voiced: 1, noise: 1, voicedDirect: true } });
    assert.ok(VF.peakOf(y) < 1, `${x.id}: ${VF.peakOf(y).toFixed(3)}`);
  }
});

test('spectral estimate: a filter fitted to noise of known shape comes back close to that shape', () => {
  for (const id of ['shh', 'sss']) {
    const truth = VF.fricativeFilter(id, SR).bands;
    const x = VF.renderSteady({ ...args, bands: truth, enabled: true, length: 2 * SR, mix: noiseMix(1) });
    const m = VF.measureFricative(x, SR);
    assert.ok(m.ok && !m.voiced);
    const fit = VF.fitFilter(m.points, { sampleRate: SR });
    assert.ok(fit.rmsDb < 4, `${id} fit ${fit.rmsDb.toFixed(1)} dB`);
    // Compare shapes where they matter, relative to each one's own peak.
    const freqs = [1500, 2000, 3000, 4000, 6000, 8000];
    const a = VF.responseDb(truth, freqs, SR);
    const b = VF.responseDb(fit.bands, freqs, SR);
    const ta = Math.max(...a); const tb = Math.max(...b);
    const err = Math.sqrt(freqs.reduce((s, _, i) => s + (a[i] - ta - (b[i] - tb)) ** 2, 0) / freqs.length);
    assert.ok(err < 5, `${id} shape error ${err.toFixed(1)} dB`);
  }
});

test('spectral estimate: strongest region is found, and bad input is explained', () => {
  const sss = VF.renderSteady({ ...args, bands: VF.fricativeFilter('sss', SR).bands, enabled: true, length: SR, mix: noiseMix(1) });
  const shh = VF.renderSteady({ ...args, bands: VF.fricativeFilter('shh', SR).bands, enabled: true, length: SR, mix: noiseMix(1) });
  assert.ok(VF.measureFricative(sss, SR).peakHz > VF.measureFricative(shh, SR).peakHz);
  const quiet = VF.measureFricative(new Float32Array(SR), SR);
  assert.equal(quiet.ok, false);
  assert.match(quiet.problems[0], /too quiet/);
  assert.match(VF.measureFricative(sss.subarray(0, 2000), SR).problems[0], /shorter/);
  // A clearly periodic section is flagged as voiced.
  const buzz = VF.renderSteady({ ...args, count: 8, bands: FLAT, enabled: false, length: SR });
  const v = VF.measureFricative(buzz, SR);
  assert.ok(v.ok && v.voiced && Math.abs(v.f0 - 200) < 1);
  assert.equal(v.warnings.length, 1);
});

test('settings file keeps the mix, the workflow and the fricative label', () => {
  const e = VF.makeFilterExperiment({ workflow: 'fricative', origin: 'fricative', vowel: 'other', vowelText: 'shh', mix: { voiced: 0.4, noise: 0.6, voicedDirect: true }, filter: { bands: VF.fricativeFilter('shh', SR).bands, enabled: true } });
  assert.equal(VF.sourceTag(e), '200 Hz × 32 equal harmonics + noise');
  const back = VF.parseFilterSettings(JSON.parse(JSON.stringify(VF.filterSettingsDocument(e))));
  assert.ok(back.ok);
  assert.equal(back.experiment.workflow, 'fricative');
  assert.equal(back.experiment.origin, 'fricative');
  assert.deepEqual(back.experiment.mix, e.mix);
  assert.equal(VF.sourceTag(VF.makeFilterExperiment({ mix: noiseMix(1) })), 'noise only');
});

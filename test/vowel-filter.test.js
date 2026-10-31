// Vowel filtering (assignment 4): the all-ones source, the cut-only peaking
// filter bank, automatic fitting, the vowel examples and the saved settings.
// All synthetic audio: these tests say nothing about how a real recorded
// vowel is matched or how the result sounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as VF from '../src/pages/frequency/vowel-filter.js';
import * as M from '../src/pages/frequency/vowel-model.js';
import { encodeWav, decodeWav } from '../src/pages/frequency/wav.js';
import { FILTER_TOUR_STEPS } from '../src/pages/frequency/filter-tour.js';

const SR = 48000;
const F0 = 220;
const COUNT = 32;
const KNOWN = [
  { f: 300, gainDb: 0, q: 1.4 }, { f: 600, gainDb: -8, q: 1.4 }, { f: 1000, gainDb: -18, q: 1.2 }, { f: 1400, gainDb: -4, q: 1.4 },
  { f: 2000, gainDb: -20, q: 1 }, { f: 2700, gainDb: -6, q: 1.6 }, { f: 3600, gainDb: -22, q: 1 }, { f: 5000, gainDb: -25, q: 1 },
];
const harmonicLevels = (y, f0, n) => {
  const s = M.segmentSpectrum(y, SR, { fftSize: 16384 });
  return Array.from({ length: n }, (_, i) => M.peakNear(s.db, s.binHz, (i + 1) * f0, 4));
};
// Exact level (dB re amplitude 1) of the sine at f in y: correlation over
// 48 000 samples = 220 whole periods of 220 Hz, so harmonics do not leak.
const toneDb = (y, f) => {
  let re = 0;
  let im = 0;
  const n = 48000;
  for (let i = 0; i < n; i++) { const w = (2 * Math.PI * f * i) / SR; re += y[i] * Math.cos(w); im += y[i] * Math.sin(w); }
  return 20 * Math.log10((2 * Math.hypot(re, im)) / n);
};

test('every active source component starts at amplitude 1', () => {
  const e = VF.makeFilterExperiment({ count: 24, f0: 248 });
  assert.equal(e.sourceAmps.length, 24);
  assert.ok(e.sourceAmps.every((a) => a === 1));
  // Even a stored record that claims otherwise is reset to 1.
  const bad = VF.makeFilterExperiment({ count: 8, sourceAmps: [1, 0.5, 0, 0, 0, 0, 0, 0] });
  assert.ok(bad.sourceAmps.every((a) => a === 1));
  // In the rendered sound every harmonic has exactly the same level.
  const y = VF.renderSteady({ f0: F0, count: COUNT, bands: VF.defaultBands(), enabled: false, sampleRate: SR, length: 48000 });
  const lv = Array.from({ length: COUNT }, (_, i) => toneDb(y, (i + 1) * F0));
  assert.ok(Math.max(...lv) - Math.min(...lv) < 0.01, `spread ${Math.max(...lv) - Math.min(...lv)} dB`);
  assert.ok(Math.abs(lv[0] - 20 * Math.log10(VF.sourceGain(F0, COUNT, SR))) < 0.01);
});

test('safe level: one shared gain, and no filtered version can exceed SAFE_PEAK', () => {
  assert.equal(VF.sourceGain(F0, COUNT, SR), VF.SAFE_PEAK / COUNT);
  // Above Nyquist: 400 Hz × 48 harmonics at 16 kHz → only 19 are active.
  assert.equal(VF.activeHarmonics(400, 48, 16000).length, 19);
  assert.equal(VF.sourceGain(400, 48, 16000), VF.SAFE_PEAK / 19);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 12; k++) {
    const bands = VF.defaultBands().map((b) => ({ f: 100 + rnd() * 6000, gainDb: -40 * rnd(), q: 0.5 + 6 * rnd() }));
    const y = VF.renderFiltered({ f0: 80 + rnd() * 400, count: 48, bands, sampleRate: SR, duration: 0.4 });
    assert.ok(VF.peakOf(y) <= VF.SAFE_PEAK + 1e-9, `peak ${VF.peakOf(y)}`);
  }
  const dry = VF.renderFiltered({ f0: F0, count: COUNT, bands: KNOWN, enabled: false, sampleRate: SR, duration: 0.5 });
  assert.ok(VF.peakOf(dry) < VF.SAFE_PEAK && VF.peakOf(dry) > 0.3);
});

test('bypass preserves the unfiltered source exactly', () => {
  const src = VF.renderSource({ f0: F0, count: COUNT, sampleRate: SR, duration: 0.5 });
  const byp = VF.renderFiltered({ f0: F0, count: COUNT, bands: KNOWN, enabled: false, sampleRate: SR, duration: 0.5 });
  assert.equal(byp.length, src.length + Math.round(VF.TAIL_SEC * SR));
  for (let i = 0; i < src.length; i++) assert.equal(byp[i], src[i]);
  for (let i = src.length; i < byp.length; i++) assert.equal(byp[i], 0);
  // A flat filter (all cuts 0 dB) is the identity too.
  const flat = VF.renderFiltered({ f0: F0, count: COUNT, bands: VF.defaultBands(), enabled: true, sampleRate: SR, duration: 0.5 });
  let d = 0;
  for (let i = 0; i < src.length; i++) d = Math.max(d, Math.abs(flat[i] - src[i]));
  assert.ok(d < 1e-6, String(d));
});

test('the filter reduces the intended region and leaves the rest', () => {
  const bands = VF.defaultBands();
  bands[3] = { f: 1320, gainDb: -24, q: 2 }; // centred on harmonic 6
  const y = VF.renderSteady({ f0: F0, count: COUNT, bands, sampleRate: SR, length: 48000 });
  const x = VF.renderSteady({ f0: F0, count: COUNT, bands, enabled: false, sampleRate: SR, length: 48000 });
  const drop = Array.from({ length: COUNT }, (_, i) => toneDb(y, (i + 1) * F0) - toneDb(x, (i + 1) * F0));
  assert.ok(Math.abs(drop[5] + 24) < 0.1, `harmonic 6 dropped ${drop[5]}`);
  // Two octaves or more away (220 Hz and 5280 Hz) almost nothing is removed.
  assert.ok(drop[0] > -1 && drop[23] > -1, `far harmonics: ${drop[0]}, ${drop[23]}`);
  // And each drop is exactly what the displayed response says.
  const g = VF.harmonicGains(F0, COUNT, bands, SR);
  for (let i = 0; i < COUNT; i++) assert.ok(Math.abs(drop[i] - g[i].gainDb) < 0.01, `h${i + 1}: ${drop[i]} vs ${g[i].gainDb}`);
});

test('changing the filter never changes the fundamental or the harmonic spacing', () => {
  const a = harmonicLevels(VF.renderSteady({ f0: F0, count: COUNT, bands: VF.defaultBands(), sampleRate: SR, length: 3 * 16384 }), F0, 16);
  const b = harmonicLevels(VF.renderSteady({ f0: F0, count: COUNT, bands: KNOWN, sampleRate: SR, length: 3 * 16384 }), F0, 16);
  for (let i = 0; i < 16; i++) {
    assert.ok(Math.abs(a[i].freq - (i + 1) * F0) < 0.5, `flat h${i + 1} at ${a[i].freq}`);
    if (b[i].db > -100) assert.ok(Math.abs(b[i].freq - (i + 1) * F0) < 0.5, `filtered h${i + 1} at ${b[i].freq}`);
  }
});

test('displayed response = the implemented filter (time-domain sine measurement)', () => {
  for (const f of [150, 440, 1000, 1999, 3100, 6000]) {
    const n = SR; // 1 s sine, measure the steady second half
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / SR);
    const y = VF.applyFilter(x, KNOWN, SR);
    let s = 0;
    for (let i = n / 2; i < n; i++) s += y[i] * y[i];
    const measured = 10 * Math.log10(s / (n / 2) / 0.5);
    const shown = VF.responseDb(KNOWN, [f], SR)[0];
    assert.ok(Math.abs(measured - shown) < 0.05, `${f} Hz: measured ${measured}, shown ${shown}`);
  }
  // No band can boost: the response never rises above 0 dB.
  const fr = Array.from({ length: 400 }, (_, i) => 20 + i * 59);
  assert.ok(Math.max(...VF.responseDb(KNOWN, fr, SR)) <= 1e-9);
  assert.equal(VF.clampBand({ f: 1000, gainDb: 6, q: 1 }).gainDb, 0);
});

test('automatic fitting recovers a known filter from a synthetic recording (error reported)', () => {
  let y = VF.renderFiltered({ f0: F0, count: COUNT, bands: KNOWN, sampleRate: SR, duration: 2 });
  const pk = VF.peakOf(y);
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  y = y.map((v) => (v / pk) * 0.4 + (rnd() - 0.5) * 0.0005);
  // The fundamental is given (as a typed value would be): this test is about
  // the filter fit. (On this strongly low-passed tone YIN's first dip lands at
  // 226 Hz instead of 220 Hz; that is why the page labels every automatic
  // estimate and lets you type a correction.)
  const m = VF.measureTargets(y, SR, { from: Math.round(0.2 * SR), to: Math.round(1.2 * SR), count: COUNT, f0Override: F0 });
  assert.ok(m.ok && m.f0 === F0 && m.f0Source === 'manual', `f0 ${m.f0}`);
  const fit = VF.fitFilter(m.points, { sampleRate: SR });
  const truth = VF.harmonicGains(F0, COUNT, KNOWN, SR);
  const got = VF.harmonicGains(F0, COUNT, fit.bands, SR);
  const top = Math.max(...truth.map((x) => x.gainDb));
  const errs = m.points.map((p, i) => ({ kind: p.kind, err: (got[i].gainDb - fit.offsetDb) - (truth[i].gainDb - top) }));
  const meas = errs.filter((e) => e.kind === 'measured');
  const rms = Math.sqrt(meas.reduce((s, e) => s + e.err * e.err, 0) / meas.length);
  console.log(`  known-filter recovery: ${rms.toFixed(2)} dB RMS vs the true filter over ${meas.length} measured harmonics (fit's own error ${fit.rmsDb.toFixed(2)} dB, ${fit.upperCount} upper-limit points)`);
  assert.ok(rms < 1.5, `rms ${rms}`);
  assert.ok(fit.bands.every((b) => b.gainDb <= 0 && b.gainDb >= VF.GAIN_MIN));
});

test('automatic fitting changes only filter parameters; the source stays all ones', () => {
  const before = VF.makeFilterExperiment({ f0: 220, count: 32, f0Source: 'automatic' });
  const y = VF.renderFiltered({ f0: F0, count: COUNT, bands: KNOWN, sampleRate: SR, duration: 1.5 });
  const m = VF.measureTargets(y, SR, { from: Math.round(0.2 * SR), to: Math.round(1.2 * SR), count: before.count, f0Override: F0 });
  const fit = VF.fitFilter(m.points, { sampleRate: SR });
  const after = VF.makeFilterExperiment({ ...before, id: null, origin: 'fitted', filter: { bands: fit.bands, enabled: true } });
  assert.equal(after.count, before.count);
  assert.equal(after.f0, before.f0);
  assert.deepEqual(after.sourceAmps, before.sourceAmps);
  assert.ok(after.sourceAmps.every((a) => a === 1));
  assert.notDeepEqual(after.filter.bands, before.filter.bands);
  // The fitter's points carry no source amplitudes to change.
  assert.ok(m.points.every((p) => !('amp' in p)));
});

test('a silent section gives no fit and no change', () => {
  const m = VF.measureTargets(new Float32Array(SR), SR, { count: 32 });
  assert.equal(m.ok, false);
  assert.ok(m.problems.some((p) => p.code === 'silent'));
});

test('vowel examples: five labelled, different, cut-only filters from published formants', () => {
  assert.deepEqual(VF.FILTER_VOWELS.map((v) => v.id), ['A', 'E', 'I', 'O', 'U']);
  for (const v of VF.FILTER_VOWELS) assert.ok(v.word && v.say.includes(v.word), v.id);
  const seen = new Set();
  for (const set of ['women', 'men']) {
    for (const v of VF.FILTER_VOWELS) {
      const ex = VF.exampleFilter(v.id, set);
      assert.equal(ex.bands.length, VF.BAND_COUNT);
      assert.ok(ex.bands.every((b) => b.gainDb <= 0));
      assert.deepEqual(ex.formants, v.formants[set]);
      assert.ok(ex.fit.rmsErrorDb < 6, `${set} ${v.id}: ${ex.fit.rmsErrorDb} dB`);
      seen.add(JSON.stringify(ex.bands));
      // Deterministic.
      assert.deepEqual(VF.exampleFilter(v.id, set).bands, ex.bands);
    }
  }
  assert.equal(seen.size, 10);
  // "ee" lets more through near its F2 (2.3–2.8 kHz) than "oo" does.
  const at = (id) => VF.responseDb(VF.exampleFilter(id, 'women').bands, [2700], SR)[0];
  assert.ok(at('I') > at('U') + 10, `${at('I')} vs ${at('U')}`);
});

test('saved settings restore the same result', () => {
  const e = VF.makeFilterExperiment({ vowel: 'U', f0: 247.91, f0Source: 'automatic', count: 32, filter: { bands: KNOWN, enabled: true }, origin: 'fitted', recordingName: 'oo — lower pitch', segment: { start: 1, end: 2 }, notes: 'test', fit: { rmsErrorDb: 1.2 } });
  // Browser storage path: JSON round trip through makeFilterExperiment.
  const stored = VF.makeFilterExperiment(JSON.parse(JSON.stringify(e)));
  assert.deepEqual(stored, e);
  // File path: settings JSON → parse.
  const doc = JSON.parse(JSON.stringify(VF.filterSettingsDocument(e, { sampleRate: SR, durationSec: 1 })));
  const back = VF.parseFilterSettings(doc);
  assert.ok(back.ok, back.error);
  for (const k of ['vowel', 'f0', 'f0Source', 'count', 'sourceAmps', 'filter', 'origin', 'segment', 'notes', 'recordingName']) assert.deepEqual(back.experiment[k], e[k], k);
  const a = VF.renderFiltered({ f0: e.f0, count: e.count, bands: e.filter.bands, sampleRate: SR, duration: 0.3 });
  const b = VF.renderFiltered({ f0: back.experiment.f0, count: back.experiment.count, bands: back.experiment.filter.bands, sampleRate: SR, duration: 0.3 });
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.equal(VF.parseFilterSettings({ format: 'x' }).ok, false);
  assert.equal(VF.parseFilterSettings({ ...doc, filter: { bands: doc.filter.bands.slice(0, 3) } }).ok, false);
});

test('WAV export includes the filter processing (and the optional makeup gain only when chosen)', () => {
  const y = VF.renderFiltered({ f0: F0, count: COUNT, bands: KNOWN, sampleRate: SR, duration: 1 });
  const dec = decodeWav(encodeWav(y, SR).buffer);
  const x = VF.renderFiltered({ f0: F0, count: COUNT, bands: KNOWN, enabled: false, sampleRate: SR, duration: 1 });
  const ly = M.segmentSpectrum(dec.samples, SR, { from: 4800, to: 43200, fftSize: 8192 });
  const lx = M.segmentSpectrum(x, SR, { from: 4800, to: 43200, fftSize: 8192 });
  const g = VF.harmonicGains(F0, COUNT, KNOWN, SR);
  for (const n of [1, 3, 5, 9, 12]) {
    const d = M.peakNear(ly.db, ly.binHz, n * F0, 3).db - M.peakNear(lx.db, lx.binHz, n * F0, 3).db;
    assert.ok(Math.abs(d - g[n - 1].gainDb) < 0.6, `h${n}: ${d} vs ${g[n - 1].gainDb}`);
  }
  // Fades at both ends and the ring-out tail: starts and ends at silence.
  assert.equal(dec.samples[0], 0);
  assert.ok(Math.abs(dec.samples[dec.samples.length - 1]) < 1e-3);
  const mk = VF.makeupGain(F0, COUNT, KNOWN, SR);
  assert.ok(mk > 1);
  const z = VF.renderFiltered({ f0: F0, count: COUNT, bands: KNOWN, sampleRate: SR, duration: 1, makeup: mk });
  for (let i = 0; i < z.length; i += 101) assert.ok(Math.abs(z[i] - y[i] * mk) < 1e-5);
});

test('filter experiments are stored apart from Vowel Lab experiments', () => {
  const src = readFileSync(new URL('../src/pages/frequency/vowel-store.js', import.meta.url), 'utf8');
  assert.match(src, /EXP_KEY = 'frequencyPlayground\.vowelLab\.experiments\.v1'/);
  assert.match(src, /FILTER_KEY = 'frequencyPlayground\.vowelLab\.filterExperiments\.v1'/);
  // A Vowel Lab experiment record is unchanged by this feature.
  const e = M.makeExperiment({ vowel: 'oo', f0: 248, count: 32 });
  assert.deepEqual(Object.keys(e).sort(), ['amps', 'autoAnalysis', 'comparison', 'count', 'createdAt', 'f0', 'id', 'notes', 'origin', 'parentF0', 'parentId', 'parentLabel', 'pitch', 'pitchText', 'recordingId', 'savedAt', 'segment', 'vowel', 'vowelText']);
});

test('filter tour: short steps that point at real controls', () => {
  const sec = readFileSync(new URL('../src/pages/frequency/vowel-filter-section.js', import.meta.url), 'utf8');
  for (const s of FILTER_TOUR_STEPS) {
    assert.ok(s.body.split(/\s+/).length <= 40, `${s.id}: ${s.body.split(/\s+/).length} words`);
    assert.ok(s.body.split(/(?<=[.!?])\s+(?=[A-Z“▶⇄■💾🔍])/).length <= 2, s.id);
    if (s.pick == null) { assert.equal(s.id, 'wrapup'); continue; }
    for (const n of [].concat(s.pick)) assert.match(sec, new RegExp(`\\bfel\\.${n} = `), `${s.id}: fel.${n}`);
  }
  assert.ok(sec.includes('The source starts with the fundamental and all active harmonics at equal strength. The filter reduces selected frequency regions, changing the balance of harmonics and the vowel-like character of the sound.'));
});

// ───────────── recording-free workflows: your own components ─────────────

const MY = [{ freq: 200, amp: 0.8, on: true }, { freq: 500, amp: 0.4, on: true }, { freq: 1234.5, amp: 0.3, on: true }, { freq: 3000, amp: 1, on: false }];

test('custom source: rows are kept exactly; amplitudes are never reset to 1', () => {
  const e = VF.makeFilterExperiment({ workflow: 'custom', source: 'custom', components: MY, filter: { bands: KNOWN, enabled: true } });
  assert.equal(e.workflow, 'custom');
  assert.deepEqual(e.components, MY);
  assert.deepEqual(VF.sourceComponents(e), MY);
  // Loading an example filter is a filter-only change.
  const ex = VF.exampleFilter('I', 'women', SR);
  const after = VF.makeFilterExperiment({ ...e, filter: { bands: ex.bands, enabled: true }, origin: 'example' });
  assert.deepEqual(after.components, MY);
  // Equal-strength source ignores any rows and is all ones.
  const h = VF.makeFilterExperiment({ source: 'harmonics', components: MY, f0: 200, count: 6 });
  assert.deepEqual(VF.sourceComponents(h).map((c) => [c.freq, c.amp]), [[200, 1], [400, 1], [600, 1], [800, 1], [1000, 1], [1200, 1]]);
});

test('custom source: the filter reduces each component by its own gain, and only that', () => {
  const y = VF.renderFiltered({ components: MY, bands: KNOWN, sampleRate: SR, duration: 1.2, fadeSec: 0, tailSec: 0 }).subarray(4800, 52800);
  const x = VF.renderFiltered({ components: MY, bands: KNOWN, enabled: false, sampleRate: SR, duration: 1.2, fadeSec: 0, tailSec: 0 }).subarray(4800, 52800);
  const g = VF.componentGains(MY, KNOWN, SR);
  assert.equal(g.length, 3); // the switched-off row does not sound
  for (const c of g) {
    // 1 s at 48 kHz: 200, 500 and 1234.5 Hz are not all whole-period, so use a Hann-weighted projection.
    const lvl = (sig) => {
      let re = 0;
      let im = 0;
      let ws = 0;
      for (let i = 0; i < sig.length; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (sig.length - 1)); const a = (2 * Math.PI * c.freq * i) / SR; re += w * sig[i] * Math.cos(a); im += w * sig[i] * Math.sin(a); ws += w; }
      return 20 * Math.log10((2 * Math.hypot(re, im)) / ws);
    };
    const drop = lvl(y) - lvl(x);
    assert.ok(Math.abs(drop - c.gainDb) < 0.1, `${c.freq} Hz: ${drop} vs ${c.gainDb}`);
  }
  // Unfiltered levels follow the typed amplitudes (ratios kept by the one shared gain).
  const g0 = VF.componentGain(MY, SR);
  assert.equal(g0, VF.SAFE_PEAK / (0.8 + 0.4 + 0.3));
  // No clipping for any cut-only filter.
  assert.ok(VF.peakOf(VF.renderFiltered({ components: MY, bands: KNOWN, sampleRate: SR, duration: 0.5 })) <= VF.SAFE_PEAK);
});

test('custom source: settings round trip (workflow, rows, filter) and identical sound', () => {
  const e = VF.makeFilterExperiment({ workflow: 'custom', source: 'custom', components: MY, filter: { bands: KNOWN, enabled: false }, origin: 'example', vowel: 'I', notes: 'x' });
  const doc = JSON.parse(JSON.stringify(VF.filterSettingsDocument(e, { sampleRate: SR })));
  assert.equal(doc.sourceType, 'custom');
  assert.equal(doc.fundamentalHz, null);
  assert.equal(doc.recording, null);
  const back = VF.parseFilterSettings(doc);
  assert.ok(back.ok, back.error);
  for (const k of ['workflow', 'source', 'components', 'filter', 'origin', 'vowel', 'notes']) assert.deepEqual(back.experiment[k], e[k], k);
  const a = VF.renderFiltered({ components: e.components, bands: e.filter.bands, sampleRate: SR, duration: 0.2 });
  const b = VF.renderFiltered({ components: back.experiment.components, bands: back.experiment.filter.bands, sampleRate: SR, duration: 0.2 });
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.match(VF.filterFileBase(e), /^filter_ee_custom4_example$/);
});

test('saved experiments from before the workflows still open (recording → workflow 3, otherwise workflow 1)', () => {
  const old = { id: 'flt-1', kind: 'vowel-filter', vowel: 'U', f0: 247.91, f0Source: 'automatic', count: 32, sourceAmps: new Array(32).fill(1), filter: { type: VF.FILTER_TYPE, bands: KNOWN, enabled: true }, recordingId: 'rec-1', recordingName: 'oo', segment: { start: 1, end: 2 }, origin: 'fitted' };
  const e = VF.makeFilterExperiment(old);
  assert.equal(e.workflow, 'recording');
  assert.equal(e.source, 'harmonics');
  assert.deepEqual(e.filter.bands, KNOWN);
  assert.equal(VF.makeFilterExperiment({ ...old, recordingId: null }).workflow, 'explore');
});

test('vowel labels say how each vowel is pronounced, not the English letter names', () => {
  assert.deepEqual(VF.FILTER_VOWELS.map((v) => `${v.name} ${v.word}`), ['Aa father', 'Eh bed', 'Ee see', 'Oh go', 'Oo food']);
  assert.match(VF.vowelInfo('O').say, /steady/);
  assert.equal(VF.vowelName('A'), 'Aa (“father”)');
});

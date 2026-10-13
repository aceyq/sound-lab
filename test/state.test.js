import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/pages/frequency/state.js';

test('frequency validation', () => {
  assert.equal(S.parseFrequency('220', 24000).value, 220);
  assert.equal(S.parseFrequency('137.5', 24000).value, 137.5);
  assert.equal(S.parseFrequency('19.9', 24000).ok, false);
  assert.equal(S.parseFrequency('10001', 24000).ok, false);
  assert.match(S.parseFrequency('9000', 8000).error, /Nyquist/);
  assert.match(S.parseFrequency('8000', 8000).error, /Nyquist/);
  assert.equal(S.parseFrequency('abc', 24000).ok, false);
  assert.equal(S.parseFrequency('', 24000).ok, false);
  assert.equal(S.parseFrequency('1,000', 24000).ok, false);
  assert.equal(S.parseFrequency('Infinity', 24000).ok, false);
});

test('amplitude validation', () => {
  assert.equal(S.parseAmplitude('0').value, 0);
  assert.equal(S.parseAmplitude('1').value, 1);
  assert.equal(S.parseAmplitude('.33').value, 0.33);
  assert.equal(S.parseAmplitude('1.01').ok, false);
  assert.equal(S.parseAmplitude('-0.1').ok, false);
});

test('normalization keeps ratios and only scales down', () => {
  const comps = [100, 200, 300, 400, 500].map((freq, i) => ({ freq, amp: [1, 0.5, 0.33, 0.25, 0.2][i], enabled: true }));
  const n = S.normalization(comps);
  assert.ok(Math.abs(n.sum - 2.28) < 1e-9);
  assert.ok(Math.abs(n.factor - 1 / 2.28) < 1e-9);
  assert.equal(S.normalization([{ freq: 220, amp: 0.5, enabled: true }]).factor, 1);
  assert.equal(S.normalization([{ freq: 220, amp: 1, enabled: false }]).sum, 0);
});

test('common base / repetition period', () => {
  assert.equal(S.commonBase([100, 200, 300, 400, 500]).base, 100);
  assert.equal(S.commonBase([200, 300, 400]).base, 100);
  assert.equal(S.commonBase([137, 281, 463, 719]).base, 1);
  assert.equal(S.commonBase([220, 224]).base, 4);
  assert.ok(Math.abs(S.commonBase([137.5, 275]).base - 137.5) < 1e-9);
});

test('random mixture: 3–6 separated frequencies in range', () => {
  for (let k = 0; k < 200; k++) {
    const m = S.randomMixture();
    assert.ok(m.length >= 3 && m.length <= 6);
    for (const c of m) {
      assert.ok(c.freq >= 150 && c.freq <= 1200);
      assert.ok(c.amp >= 0.3 && c.amp <= 1);
    }
    for (let i = 1; i < m.length; i++) assert.ok(m[i].freq - m[i - 1].freq >= 25);
  }
});

test('harmonic series', () => {
  assert.deepEqual(S.harmonicSeries(110, 3).map((c) => c.freq), [110, 220, 330]);
});

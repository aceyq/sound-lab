import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeColumns } from '../src/pages/frequency/waveform.js';

test('min/max columns track a sine exactly', () => {
  const d = computeColumns([{ freq: 220, amp: 1 }], 1, 0.02, 400);
  assert.ok(d.peak > 0.995 && d.peak <= 1.000001);
  // Column values match the formula at each column start.
  for (const col of [0, 37, 211, 399]) {
    const t = (col / 400) * 0.02;
    assert.ok(Math.abs(d.first[col] - Math.sin(2 * Math.PI * 220 * t)) < 1e-6);
  }
});

test('long windows keep the true envelope (no aliasing)', () => {
  // 5 s of 220 Hz into 600 columns: each column spans ~1.8 cycles, so the
  // band must reach ±1 everywhere instead of a sparse aliased curve.
  const d = computeColumns([{ freq: 220, amp: 1 }], 1, 5, 600);
  for (let i = 0; i < 600; i++) {
    assert.ok(d.max[i] > 0.99 && d.min[i] < -0.99, `column ${i}`);
  }
});

test('beats envelope at 1 s dips near zero 4 times', () => {
  const d = computeColumns([{ freq: 220, amp: 0.5 }, { freq: 224, amp: 0.5 }], 1, 1, 1000);
  const amp = Array.from(d.max, (v, i) => Math.max(v, -d.min[i]));
  // Count separate low-envelope regions; expect them at 125, 375, 625, 875 ms.
  const centers = [];
  let start = -1;
  amp.forEach((v, i) => {
    if (v < 0.03 && start < 0) start = i;
    if (v >= 0.03 && start >= 0) { centers.push((start + i - 1) / 2); start = -1; }
  });
  assert.deepEqual(centers.map(Math.round), [125, 375, 625, 875]);
  assert.ok(Math.max(...amp) > 0.97);
});

test('display gain scales values', () => {
  const d = computeColumns([{ freq: 100, amp: 1 }, { freq: 200, amp: 1 }], 0.5, 0.01, 200);
  assert.ok(d.peak <= 1);
});

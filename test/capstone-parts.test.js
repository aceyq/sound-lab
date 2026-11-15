// Capstone parts 2 and 3: drawn-take alignment and the tilt sound map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateStartMs, positionAt, snippetWindows, analyzeDrawnTake, takeAnchors, undoLastTake, cleanTake, WINDOW_SEC } from '../src/pages/vowel-morph/take-model.js';
import { blendAt, idwWeights, loadProject as loadMorph } from '../src/pages/vowel-morph/morph-model.js';
import { anglesToPoint, pointToAngles, anglesFromUp, rangeFromSamples, averageUp, PercussionGate, DRUM_REGIONS, DRUM_BUFFER, isStale, formantAmps, starterAnchors, loadProject, smoothPoint } from '../src/pages/tilt-map/tilt-model.js';
import { upFromAngles } from '../src/pages/motion-score/mapping.js';

const SR = 48000;
function tone(f0Of, sec, amps = [1, 0.6, 0.4, 0.3, 0.2]) {
  const x = new Float32Array(Math.round(sec * SR));
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const f = f0Of(i / SR);
    ph += (2 * Math.PI * f) / SR;
    let s = 0;
    if (f > 0) for (let n = 0; n < amps.length; n++) s += amps[n] * Math.sin((n + 1) * ph);
    x[i] = 0.2 * s;
  }
  return x;
}

// ── part 1: the weighting rule used by the map ──
test('IDW weights: on an anchor = 100 %, between two = inverse distance squared', () => {
  const dots = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }];
  assert.deepEqual(idwWeights(dots, { x: 0.2, y: 0.5 }), [1, 0]);
  const w = idwWeights(dots, { x: 0.4, y: 0.5 }); // d = 0.2 and 0.4 → 1/0.04 : 1/0.16 = 4 : 1
  assert.ok(Math.abs(w[0] - 0.8) < 1e-12 && Math.abs(w[1] - 0.2) < 1e-12);
  const v = (id, f0, a) => ({ id, name: id, pos: null, analysis: { f0, amps: a } });
  const A = { ...v('A', 200, [1, 0.5]), pos: dots[0] };
  const B = { ...v('B', 300, [0.2, 1]), pos: dots[1] };
  const b = blendAt([A, B], { x: 0.4, y: 0.5 });
  assert.ok(Math.abs(b.params.f0 - 220) < 1e-9); // 0.8·200 + 0.2·300
  assert.ok(Math.abs(b.params.amps[0] - 0.84) < 1e-9 && Math.abs(b.params.amps[1] - 0.6) < 1e-9);
  const on = blendAt([A, B], dots[1]);
  assert.equal(on.params.f0, 300);
});

// ── part 2 ──
test('estimateStartMs takes the least-delayed chunk', () => {
  const arr = [{ ms: 1050, count: 2048 }, { ms: 1090, count: 4096 }, { ms: 1200, count: 6144 }];
  // 1050 − 42.67 = 1007.3; 1090 − 85.3 = 1004.7 (earliest); 1200 − 128 = 1072
  assert.ok(Math.abs(estimateStartMs(arr, SR) - (1090 - (4096 / SR) * 1000)) < 1e-9);
  assert.equal(estimateStartMs([], SR), null);
});

test('positionAt interpolates by time, not by sample count', () => {
  const path = [{ x: 0, y: 0, t: 0 }, { x: 0.1, y: 0, t: 1000 }, { x: 0.9, y: 0, t: 1200 }];
  assert.deepEqual(positionAt(path, 500), { x: 0.05, y: 0 });
  assert.ok(Math.abs(positionAt(path, 1100).x - 0.5) < 1e-12);
  assert.equal(positionAt(path, -1), null);
  assert.equal(positionAt(path, 1300), null);
});

test('snippet windows are 0.2 s every 0.1 s', () => {
  const w = snippetWindows(SR, SR);
  assert.equal(w.length, 9);
  assert.equal(w[0].to - w[0].from, WINDOW_SEC * SR);
  assert.ok(Math.abs(w[1].centreSec - 0.2) < 1e-9);
});

test('analyzeDrawnTake: slow then fast drawing, points follow time', () => {
  // 1.5 s at 150 Hz while the pointer crawls x 0 → 0.2, then 1 s at 300 Hz while it races 0.2 → 1.
  const x = tone((t) => (t < 1.5 ? 150 : 300), 2.5);
  const path = [];
  for (let t = 0; t <= 2500; t += 10) path.push({ x: t <= 1500 ? (t / 1500) * 0.2 : 0.2 + ((t - 1500) / 1000) * 0.8, y: 0.5, t: 5000 + t });
  const r = analyzeDrawnTake({ samples: x, sampleRate: SR, startMs: 5000, path });
  assert.equal(r.stats.snippets, 24);
  for (const p of r.points) {
    if (p.t < 1350) assert.ok(Math.abs(p.f0 - 150) < 3 && p.x <= 0.2 + 1e-9, `t=${p.t} f0=${p.f0} x=${p.x}`);
    if (p.t > 1650) assert.ok(Math.abs(p.f0 - 300) < 5 && p.x > 0.2, `t=${p.t} f0=${p.f0} x=${p.x}`);
  }
  assert.ok(r.points.filter((p) => p.x <= 0.2).length >= 12);
});

test('analyzeDrawnTake skips silent snippets and snippets outside the drawing', () => {
  const x = tone((t) => (t > 0.6 && t < 1.4 ? 200 : 0), 2);
  const path = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 1500 }];
  const r = analyzeDrawnTake({ samples: x, sampleRate: SR, startMs: 0, path });
  assert.ok(r.stats.silent >= 4, JSON.stringify(r.stats));
  assert.ok(r.stats.outsidePath >= 3, JSON.stringify(r.stats));
  assert.ok(r.stats.usable >= 5 && r.points.every((p) => Math.abs(p.f0 - 200) < 4));
  assert.equal(r.stats.usable + r.stats.silent + r.stats.unreliable + r.stats.outsidePath, r.stats.snippets);
});

test('undo removes only the newest take; anchors come from visible takes', () => {
  const mk = (id, at) => cleanTake({ id, createdAt: at, points: [{ x: 0.1, y: 0.1, t: 0, f0: 200, amps: [1] }], path: [] });
  const takes = [mk('a', '2026-11-14T10:00:00Z'), mk('b', '2026-11-14T10:05:00Z'), mk('c', '2026-11-14T10:01:00Z')];
  const u = undoLastTake(takes);
  assert.equal(u.removed.id, 'b');
  assert.deepEqual(u.takes.map((t) => t.id), ['a', 'c']);
  takes[0].hidden = true;
  assert.deepEqual(takeAnchors(takes).map((a) => a.takeId), ['b', 'c']);
});

test('Vowel Morph projects keep takes through save/load; old projects get an empty list', () => {
  const p = loadMorph({ vowels: [], takes: [{ id: 't', points: [{ x: 2, y: 0.5, t: 10, f0: 180, amps: [1, 0.5] }], path: [{ x: 0, y: 0, t: 0 }] }] });
  assert.equal(p.takes.length, 1);
  assert.equal(p.takes[0].points[0].x, 1);
  assert.deepEqual(loadMorph({ vowels: [] }).takes, []);
});

// ── part 3 ──
test('each angle moves exactly one axis; neutral is the centre', () => {
  const R = { pitch: 30, roll: 40 };
  assert.deepEqual(anglesToPoint({ pitch: 0, roll: 0 }, R), { x: 0.5, y: 0.5 });
  const a = anglesToPoint({ pitch: 15, roll: 0 }, R);
  assert.equal(a.x, 0.5); assert.equal(a.y, 0.75);
  const b = anglesToPoint({ pitch: 0, roll: -20 }, R);
  assert.equal(b.y, 0.5); assert.equal(b.x, 0.25);
  assert.deepEqual(anglesToPoint({ pitch: 99, roll: -99 }, R), { x: 0, y: 1 });
  assert.deepEqual(anglesToPoint({ pitch: 15, roll: 20 }, R, { pitch: true, roll: true }), { x: 0.25, y: 0.25 });
  const back = pointToAngles({ x: 0.75, y: 0.25 }, R);
  assert.ok(Math.abs(back.roll - 20) < 1e-9 && Math.abs(back.pitch + 15) < 1e-9);
});

test('angles from phone orientation vectors are relative to neutral and independent', () => {
  const up0 = upFromAngles(20, 0);
  const f = anglesFromUp(upFromAngles(5, 0), up0); // top tilted toward you by 15°
  assert.ok(Math.abs(f.pitch - 15) < 1e-6 && Math.abs(f.roll) < 1e-6, JSON.stringify(f));
  const s = anglesFromUp(upFromAngles(20, -12), up0);
  assert.ok(Math.abs(s.roll - 12) < 0.5 && Math.abs(s.pitch) < 0.5, JSON.stringify(s));
  const n = averageUp([upFromAngles(19, 1), upFromAngles(21, -1)]);
  assert.ok(Math.abs(anglesFromUp(n, up0).pitch) < 0.01);
});

test('blend at the tilt point uses both angles', () => {
  const anchors = starterAnchors();
  const R = { pitch: 30, roll: 35 };
  const at = (pitch, roll) => blendAt(anchors, anglesToPoint({ pitch, roll }, R)).params.f0;
  const c = at(0, 0);
  assert.notEqual(at(10, 0), c);
  assert.notEqual(at(0, 10), c);
  assert.notEqual(at(10, 10), at(10, 0));
  assert.notEqual(at(10, 10), at(0, 10));
});

test('comfortable range from samples: 90th percentile, clamped', () => {
  const s = Array.from({ length: 100 }, (_, i) => ({ pitch: (i - 50) * 0.5, roll: (i - 50) * 1.2 }));
  const r = rangeFromSamples(s);
  assert.ok(r.pitch >= 20 && r.pitch <= 25 && r.roll >= 50 && r.roll <= 60, JSON.stringify(r));
  assert.deepEqual(rangeFromSamples([]), { pitch: 30, roll: 35 });
});

test('percussion: one hit per entry, a shaky boundary does not retrigger, leaving re-arms', () => {
  const g = new PercussionGate(DRUM_REGIONS);
  const kick = DRUM_REGIONS.find((r) => r.id === 'kick');
  const at = (d) => ({ x: kick.x + d, y: kick.y });
  let t = 0;
  const hits = [];
  const step = (d) => { t += 20; hits.push(...g.update(at(d), t)); };
  step(0.4); // far away
  step(kick.r - 0.01); // enter → hit
  for (let i = 0; i < 50; i++) step(kick.r + (i % 2 ? 0.02 : -0.02)); // shaking across the edge, inside the buffer
  for (let i = 0; i < 50; i++) step(0); // holding still in the middle
  assert.deepEqual(hits, ['kick']);
  step(kick.r + DRUM_BUFFER + 0.01); // really left
  step(kick.r - 0.02); // back in → second hit
  assert.deepEqual(hits, ['kick', 'kick']);
  const g2 = new PercussionGate(DRUM_REGIONS);
  g2.prime({ x: kick.x, y: kick.y });
  assert.deepEqual(g2.update({ x: kick.x, y: kick.y }, 0), []); // switching percussion on inside a region does not hit
});

test('tracking goes stale after 400 ms without phone readings', () => {
  assert.equal(isStale(1000, 1300), false);
  assert.equal(isStale(1000, 1450), true);
  assert.equal(isStale(-Infinity, 0), true);
});

test('starter sounds and project loading', () => {
  const ah = formantAmps(165, [[730, 90, 1], [1090, 110, 0.5], [2440, 170, 0.2]]);
  assert.equal(ah.length, 48);
  assert.equal(Math.max(...ah), 1);
  const strongest = ah.indexOf(1) + 1;
  assert.ok(strongest * 165 > 500 && strongest * 165 < 900, `strongest harmonic ${strongest}`);
  const p = loadProject(null);
  assert.equal(p.anchors.length, 4);
  assert.equal(loadProject({ anchors: [{ pos: { x: 0.5, y: 0.5 }, analysis: { f0: 0, amps: [1] } }] }).anchors.length, 0);
  const sp = smoothPoint({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.06);
  assert.ok(sp.x > 0.6 && sp.x < 0.65);
});

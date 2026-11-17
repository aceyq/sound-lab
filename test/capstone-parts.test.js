// Capstone parts 2 and 3: drawn-take alignment and the camera Pose Sound Map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateStartMs, positionAt, snippetWindows, analyzeDrawnTake, takeAnchors, undoLastTake, cleanTake, WINDOW_SEC } from '../src/pages/vowel-morph/take-model.js';
import { blendAt, idwWeights, loadProject as loadMorph } from '../src/pages/vowel-morph/morph-model.js';
import { poseAngles, anglesToPoint, pointToAngles, tiltToY, tiltSide, applyCapture, swapTilt, heldValue, gridBlend, linearWeights, centre, starterColumns, STARTER_ROWS, RegionTrigger, loadProject, LM, DEFAULT_CAL, CLAP_BUFFER } from '../src/pages/pose-map/pose-model.js';

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

// ── part 3: camera pose (elbow = vowel, head tilt = pitch) ──
// A synthetic upper body (image coordinates, x right, y down, camera not
// mirrored: the person's right side appears on the image's left).
const D = Math.PI / 180;
function body({ bend = 0, tilt = 0, shiftX = 0, lean = 0, hide = null, vis = 0.99 } = {}) {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
  const rot = (x, y, cx, cy, a) => ({ x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) });
  const set = (i, p) => { lms[i] = { x: p.x + shiftX, y: p.y, z: 0, visibility: vis }; };
  // whole torso rotated by `lean` around the hips' centre
  const L = (x, y) => rot(x, y, 0.5, 0.7, lean * D);
  const rSh = L(0.40, 0.35); const lSh = L(0.60, 0.35);
  set(LM.rightShoulder, rSh); set(LM.leftShoulder, lSh);
  // head tilted by `tilt` (relative to the shoulders) around the neck
  const neck = L(0.5, 0.33);
  const H = (x, y) => { const q = L(x, y); return rot(q.x, q.y, neck.x, neck.y, (lean + tilt) * D - lean * D); };
  set(LM.rightEar, H(0.46, 0.22)); set(LM.leftEar, H(0.54, 0.22));
  // right arm: upper arm straight down, forearm rotated by `bend`
  set(LM.rightElbow, L(0.40, 0.50));
  set(LM.rightWrist, L(0.40 + 0.15 * Math.sin(bend * D), 0.50 + 0.15 * Math.cos(bend * D)));
  if (hide != null) lms[hide].visibility = 0.1;
  return lms;
}

test('joint angles: elbow bend and head tilt relative to the shoulders', () => {
  for (const [bend, tilt] of [[0, 0], [60, 0], [110, 15], [30, -20]]) {
    const r = poseAngles(body({ bend, tilt }), { aspect: 1 });
    assert.ok(r.ok, JSON.stringify(r.lost));
    assert.ok(Math.abs(r.bend - bend) < 0.01, `bend ${r.bend} vs ${bend}`);
    assert.ok(Math.abs(r.tilt - tilt) < 0.01, `tilt ${r.tilt} vs ${tilt}`);
  }
  assert.equal(tiltSide(12), 'toward your left shoulder');
  assert.equal(tiltSide(-12), 'toward your right shoulder');
});

test('sliding or leaning the whole body is not a head tilt', () => {
  const a = poseAngles(body({ bend: 40, tilt: 0, shiftX: 0.15 }), { aspect: 1 });
  const b = poseAngles(body({ bend: 40, tilt: 0, lean: 12 }), { aspect: 1 });
  const c = poseAngles(body({ bend: 40, tilt: 10, lean: -8 }), { aspect: 1 });
  assert.ok(Math.abs(a.tilt) < 1e-9 && Math.abs(b.tilt) < 1e-9 && Math.abs(c.tilt - 10) < 1e-9);
});

test('each angle drives only its own axis; upright = middle row', () => {
  assert.deepEqual(anglesToPoint({ bend: 10, tilt: 0 }), { x: 0, y: 0.5 });
  const b = anglesToPoint({ bend: 65, tilt: 0 });
  assert.ok(Math.abs(b.x - 0.5) < 1e-9 && b.y === 0.5);
  assert.equal(anglesToPoint({ bend: 10, tilt: 20 }).y, 1);
  assert.equal(anglesToPoint({ bend: 10, tilt: -10 }).y, 0.25);
  assert.equal(anglesToPoint({ bend: 10, tilt: -10 }).x, 0);
  const back = pointToAngles({ x: 0.25, y: 0.75 });
  assert.ok(Math.abs(back.bend - 37.5) < 1e-9 && Math.abs(back.tilt - 10) < 1e-9);
});

test('a lost landmark is named; an ear only stops the pitch angle', () => {
  const r = poseAngles(body({ bend: 40, hide: LM.leftEar }), { aspect: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.lost, ['left ear']);
  assert.ok(Number.isFinite(r.bend) && Number.isNaN(r.tilt));
  assert.equal(poseAngles(null).noPerson, true);
});

test('calibration captures: arm straight/bent, head upright/low/high, swap', () => {
  let cal = DEFAULT_CAL;
  for (const [k, v] of [['straight', 5], ['bent', 125], ['upright', 3], ['low', -15], ['high', 25]]) {
    const r = applyCapture(cal, k, v);
    assert.equal(r.error, null, k);
    cal = r.cal;
  }
  assert.deepEqual(cal, { bend: { lo: 5, hi: 125 }, tilt: { neutral: 3, low: -15, high: 25 } });
  assert.equal(tiltToY(3, cal), 0.5);
  assert.equal(tiltToY(-15, cal), 0);
  assert.equal(tiltToY(25, cal), 1);
  assert.ok(applyCapture(cal, 'high', -10).error); // same side as low
  assert.ok(applyCapture(cal, 'bent', 15).error); // too close to straight
  assert.ok(applyCapture(cal, 'low', 1).error); // too small
  const sw = swapTilt(cal);
  assert.equal(tiltToY(25, sw), 0); // the other shoulder now lowers the pitch
  assert.equal(tiltToY(-15, sw), 1);
  assert.ok(heldValue([{ tilt: 1 }, { tilt: 2 }, { tilt: 3 }, { tilt: 50 }, { tilt: 2 }], 'tilt') === 2);
});

test('starter grid: matched pitch across rows, same harmonics down each column', () => {
  const cols = starterColumns();
  const rows = STARTER_ROWS;
  assert.deepEqual(cols.map((c) => c.name), ['ah', 'ee', 'oo']);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    const g = gridBlend(cols, rows, { x: centre(c, 3), y: centre(r, 3) });
    assert.equal(g.params.f0, rows[r].f0); // exactly on a dot = that dot
    assert.deepEqual(g.params.amps, cols[c].amps);
    assert.equal(g.vowelShares[c], 1);
  }
});

test('between the dots: elbow alone changes only the vowel, head alone only the pitch', () => {
  const cols = starterColumns();
  const rows = STARTER_ROWS;
  for (const y of [0.1, 0.3, 0.5, 0.62, 0.9]) {
    const f0s = [0, 0.2, 0.4, 0.5, 0.7, 1].map((x) => gridBlend(cols, rows, { x, y }).params.f0);
    assert.ok(f0s.every((f) => Math.abs(f - f0s[0]) < 1e-9), `y=${y}: ${f0s}`);
  }
  for (const x of [0.05, 0.33, 0.5, 0.77]) {
    const amps = [0, 0.25, 0.5, 0.8, 1].map((y) => gridBlend(cols, rows, { x, y }).params.amps);
    assert.ok(amps.every((a) => a.every((v, n) => Math.abs(v - amps[0][n]) < 1e-12)), `x=${x}`);
  }
  // both together: f0 from the head, harmonics from the elbow
  const g = gridBlend(cols, rows, { x: 1 / 3, y: 2 / 3 }); // halfway ah→ee, halfway mid→high
  assert.ok(Math.abs(g.params.f0 - (220 + 293.7) / 2) < 1e-9);
  assert.ok(Math.abs(g.vowelShares[0] - 0.5) < 1e-12 && Math.abs(g.vowelShares[1] - 0.5) < 1e-12);
  assert.ok(Math.abs(g.params.amps[3] - (cols[0].amps[3] + cols[1].amps[3]) / 2) < 1e-9);
  const sum = g.cells.reduce((s, k) => s + k.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
});

test('linear weights clamp beyond the outer dots', () => {
  assert.deepEqual(linearWeights(3, 0), [1, 0, 0]);
  assert.deepEqual(linearWeights(3, 1), [0, 0, 1]);
  const w = linearWeights(4, 0.5);
  assert.ok(Math.abs(w[1] - 0.5) < 1e-12 && Math.abs(w[2] - 0.5) < 1e-12);
});

test('clap: once on entering, quiet while held or shaking at the edge, again after leaving', () => {
  const region = { x: 0.5, y: 5 / 6, r: 0.12 };
  const t = new RegionTrigger();
  let now = 0;
  const hits = [];
  const step = (y) => { now += 20; if (t.update({ x: 0.5, y }, region, now)) hits.push(now); };
  step(0.5); step(0.75); // enter
  for (let i = 0; i < 80; i++) step(0.8);
  for (let i = 0; i < 40; i++) step(region.y - region.r + (i % 2 ? 0.03 : -0.03));
  assert.equal(hits.length, 1);
  step(region.y - region.r - CLAP_BUFFER - 0.02);
  step(0.8);
  assert.equal(hits.length, 2);
});

test('project loading keeps valid custom columns and calibration', () => {
  const p = loadProject(null);
  assert.equal(p.columns.length, 3);
  assert.equal(p.rows.length, 3);
  const q = loadProject({ version: 2, columns: [{ name: 'mmm', amps: [1, 0.2], source: 'recorded', recordedF0: 180 }, { amps: [0] }], cal: { bend: { lo: 0, hi: 5 }, tilt: { neutral: 0, low: 10, high: 20 } } });
  assert.deepEqual(q.columns.map((c) => c.name), ['mmm']);
  assert.deepEqual(q.cal, DEFAULT_CAL);
  assert.equal(loadProject({ version: 1, anchors: [] }).columns.length, 3);
});

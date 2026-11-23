// Capstone parts 2 and 3: drawn-take alignment and the camera Pose Sound Map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateStartMs, positionAt, snippetWindows, analyzeDrawnTake, takeAnchors, undoLastTake, cleanTake, WINDOW_SEC } from '../src/pages/vowel-morph/take-model.js';
import { blendAt, idwWeights, loadProject as loadMorph } from '../src/pages/vowel-morph/morph-model.js';
import { angleAt, poseAngles, anglesToPoint, pointToAngles, heldAngles, calibrate, smoothAngles, anchorPoint, starterAnchors, formantAmps, RegionTrigger, loadProject, LM, DEFAULT_CAL, CLAP_BUFFER } from '../src/pages/pose-map/pose-model.js';

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

// ── part 3: camera pose ──
// A synthetic body: 33 landmarks, all visible, with the right arm and left
// arm set by the two angles we want to measure (2D, x right, y down).
const D = Math.PI / 180;
function body({ bend = 0, lift = 15, hideJoint = null, vis = 0.99 } = {}) {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
  const set = (i, x, y) => { lms[i] = { x, y, z: 0, visibility: vis }; };
  // person's right shoulder appears on image left (camera not mirrored)
  set(LM.rightShoulder, 0.40, 0.35); set(LM.leftShoulder, 0.60, 0.35);
  set(LM.rightHip, 0.42, 0.70); set(LM.leftHip, 0.58, 0.70);
  // right upper arm hangs down; forearm rotates by `bend`
  set(LM.rightElbow, 0.40, 0.50);
  set(LM.rightWrist, 0.40 + 0.15 * Math.sin(bend * D), 0.50 + 0.15 * Math.cos(bend * D));
  // left upper arm rotates out from the torso line by `lift`
  const hipDir = Math.atan2(0.70 - 0.35, 0.58 - 0.60); // shoulder → hip
  const a = hipDir - lift * D; // rotate away from the body
  set(LM.leftElbow, 0.60 + 0.15 * Math.cos(a), 0.35 + 0.15 * Math.sin(a));
  set(LM.leftWrist, 0.60 + 0.3 * Math.cos(a), 0.35 + 0.3 * Math.sin(a));
  if (hideJoint != null) lms[hideJoint].visibility = 0.1;
  return lms;
}

test('joint angles: elbow bend and arm lift are measured from the right joints', () => {
  assert.ok(Math.abs(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }) - 90) < 1e-9);
  for (const [bend, lift] of [[0, 15], [60, 15], [110, 15], [0, 90], [100, 140]]) {
    const r = poseAngles(body({ bend, lift }), { aspect: 1 });
    assert.ok(r.ok, JSON.stringify(r.lost));
    assert.ok(Math.abs(r.bend - bend) < 0.01, `bend ${r.bend} vs ${bend}`);
    assert.ok(Math.abs(r.lift - lift) < 0.01, `lift ${r.lift} vs ${lift}`);
  }
});

test('each angle drives only its own map axis', () => {
  const at = (bend, lift) => anglesToPoint(poseAngles(body({ bend, lift }), { aspect: 1 }), DEFAULT_CAL);
  const a = at(15, 15);
  const b = at(100, 15); // only the elbow changes
  const c = at(15, 90); // only the arm lift changes
  assert.ok(Math.abs(a.y - b.y) < 1e-9 && b.x > a.x + 0.5);
  assert.ok(Math.abs(a.x - c.x) < 1e-9 && c.y > a.y + 0.5);
  const back = pointToAngles(anglesToPoint({ bend: 70, lift: 60 }));
  assert.ok(Math.abs(back.bend - 70) < 1e-9 && Math.abs(back.lift - 60) < 1e-9);
});

test('a lost joint is named and its angle is not used', () => {
  const r = poseAngles(body({ bend: 40, hideJoint: LM.rightWrist }), { aspect: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.lost, ['right wrist']);
  assert.ok(Number.isNaN(r.bend) && Number.isFinite(r.lift));
  const none = poseAngles(null);
  assert.equal(none.noPerson, true);
});

test('elbow bend is measured from the picture; world landmarks are used for the arm lift only', () => {
  const lms = body({ bend: 30, lift: 30 });
  const world = body({ bend: 80, lift: 120 }).map((p) => ({ x: p.x, y: p.y, z: 0 }));
  const r = poseAngles(lms, { world, aspect: 1 });
  assert.ok(Math.abs(r.bend - 30) < 0.01 && Math.abs(r.lift - 120) < 0.01, `${r.bend} ${r.lift}`);
});

test('calibration from the two held poses maps them to opposite corners', () => {
  const rest = heldAngles(Array.from({ length: 20 }, (_, i) => ({ bend: 8 + (i % 3), lift: 18 + (i % 2) })));
  const full = heldAngles(Array.from({ length: 20 }, (_, i) => ({ bend: 118 + (i % 3), lift: 128 + (i % 2) })));
  const cal = calibrate(rest, full);
  assert.deepEqual(anglesToPoint(rest, cal), { x: 0, y: 0 });
  assert.deepEqual(anglesToPoint(full, cal), { x: 1, y: 1 });
  assert.equal(heldAngles([{ bend: 1, lift: 2 }]), null);
  const narrow = calibrate({ bend: 50, lift: 50 }, { bend: 55, lift: 52 });
  assert.ok(narrow.bend.hi - narrow.bend.lo >= 20);
});

test('both angles together set the blend; a held pose gives a steady sound', () => {
  const anchors = starterAnchors().map((a) => ({ ...a, pos: anchorPoint(a, DEFAULT_CAL) }));
  const f0 = (bend, lift) => blendAt(anchors, anglesToPoint({ bend, lift })).params.f0;
  const ah = f0(DEFAULT_CAL.bend.lo + 0.1 * (DEFAULT_CAL.bend.hi - DEFAULT_CAL.bend.lo), DEFAULT_CAL.lift.lo + 0.1 * (DEFAULT_CAL.lift.hi - DEFAULT_CAL.lift.lo));
  assert.ok(Math.abs(ah - 196) < 1e-9); // exactly on the "ah" starter
  const mid = f0(50, 60);
  assert.notEqual(f0(80, 60), mid);
  assert.notEqual(f0(50, 80), mid);
  assert.notEqual(f0(80, 80), f0(80, 60));
  assert.notEqual(f0(80, 80), f0(50, 80));
  let s = { bend: 50, lift: 60 };
  for (let i = 0; i < 100; i++) s = smoothAngles(s, { bend: 50, lift: 60 }, 0.02);
  assert.equal(f0(s.bend, s.lift), mid);
});

test('taught poses follow their angles through a new calibration', () => {
  const a = { angles: { bend: (DEFAULT_CAL.bend.lo + DEFAULT_CAL.bend.hi) / 2, lift: (DEFAULT_CAL.lift.lo + DEFAULT_CAL.lift.hi) / 2 }, pos: null };
  assert.deepEqual(anchorPoint(a, DEFAULT_CAL), { x: 0.5, y: 0.5 });
  const cal = { bend: { lo: a.angles.bend - 20, hi: a.angles.bend + 20 }, lift: { lo: 45, hi: 90 } };
  assert.deepEqual(anchorPoint(a, cal), { x: 0.5, y: 0.5 });
});

test('clap: once on entering, quiet while held or shaking at the edge, again after leaving', () => {
  const region = { x: 0.9, y: 0.9, r: 0.16 };
  const t = new RegionTrigger();
  let now = 0;
  const hits = [];
  const step = (x) => { now += 20; if (t.update({ x, y: 0.9 }, region, now)) hits.push(now); };
  step(0.4); step(0.6);
  step(0.8); // enter → clap
  for (let i = 0; i < 100; i++) step(0.85); // hold
  for (let i = 0; i < 40; i++) step(0.9 - region.r + (i % 2 ? 0.03 : -0.03)); // shaking across the edge
  assert.equal(hits.length, 1);
  step(0.9 - region.r - CLAP_BUFFER - 0.02); // leave past the buffer
  step(0.85); // come back
  assert.equal(hits.length, 2);
  const t2 = new RegionTrigger();
  t2.prime({ x: 0.9, y: 0.9 }, region);
  assert.equal(t2.update({ x: 0.9, y: 0.9 }, region, 1000), false);
});

test('formant helper and project loading', () => {
  const ah = formantAmps(196, [[730, 90, 1], [1090, 110, 0.5], [2440, 170, 0.2]]);
  assert.equal(ah.length, 48);
  assert.equal(Math.max(...ah), 1);
  const p = loadProject(null);
  assert.deepEqual(p.sounds, [], 'the map starts empty: no starter vowels');
  assert.equal(p.clap.on, false);
  const q = loadProject({ anchors: [{ name: 'x', angles: { bend: 50, lift: 40 }, analysis: { f0: 200, amps: [1] } }, { analysis: { f0: 0, amps: [1] }, pos: { x: 0, y: 0 } }], cal: { bend: { lo: 10, hi: 12 } } });
  assert.equal(q.sounds.length, 1);
  assert.deepEqual(q.sounds[0].place.angles, { bend: 50, lift: 40 });
  assert.deepEqual(q.cal.bend, DEFAULT_CAL.bend);
});

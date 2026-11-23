// Motion Morph (camera pose map): movement range, saved poses through a
// range change, drawn takes stored as poses, and the "Add my sound" analysis.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAL, MIN_SPAN, estimateRange, scaleRange, setRangeEnd, percentPer10Deg, poseInRange, fixRange,
  anglesToPoint, pointToAngles, anchorPoint, takeToAngles, poseTakeAnchors, loadProject, describePose, percentile, placedSounds, clearMap,
} from '../src/pages/pose-map/pose-model.js';
import { analyzeMySound, steadySection } from '../src/pages/pose-map/sound-analysis.js';
import { blendAt } from '../src/pages/vowel-morph/morph-model.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('default range is usable without calibration', () => {
  assert.deepEqual(anglesToPoint({ bend: 15, lift: 15 }), { x: 0, y: 0 });
  assert.deepEqual(anglesToPoint({ bend: 130, lift: 120 }), { x: 1, y: 1 });
  assert.ok(DEFAULT_CAL.bend.hi - DEFAULT_CAL.bend.lo > 90 && DEFAULT_CAL.lift.hi - DEFAULT_CAL.lift.lo > 90);
});

test('estimateRange uses the 5th–95th percentile of what was seen', () => {
  const s = [];
  for (let i = 0; i <= 100; i++) s.push({ bend: 40 + i * 0.8, lift: 20 + i });
  s.push({ bend: 170, lift: 179 }); // one stray frame
  const r = estimateRange(s);
  assert.ok(r.ok);
  assert.ok(close(r.cal.bend.lo, percentile(s.map((x) => x.bend), 5), 0.05));
  assert.ok(r.cal.bend.hi < 120 && r.cal.lift.hi < 120, 'a stray frame does not set the end');
  assert.equal(r.report.bend.kept, false);
});

test('estimateRange: too few tracked frames changes nothing', () => {
  const prev = { bend: { lo: 10, hi: 100 }, lift: { lo: 20, hi: 90 } };
  const r = estimateRange([{ bend: 50, lift: 50 }, { bend: NaN, lift: 3 }], prev);
  assert.equal(r.ok, false);
  assert.deepEqual(r.cal, prev);
  assert.match(r.message, /not changed/);
});

test('estimateRange: an angle that hardly moved keeps its old range', () => {
  const s = Array.from({ length: 60 }, (_, i) => ({ bend: 30 + i * 1.5, lift: 40 + (i % 3) }));
  const r = estimateRange(s, DEFAULT_CAL);
  assert.ok(r.ok && r.report.lift.kept && !r.report.bend.kept);
  assert.deepEqual(r.cal.lift, DEFAULT_CAL.lift);
});

test('range tweaks: widen, narrow, set an end; always valid', () => {
  const r = { lo: 40, hi: 100 };
  const w = scaleRange(r, 1.25, 'bend');
  assert.ok(close(w.hi - w.lo, 75) && close((w.lo + w.hi) / 2, 70));
  const n = scaleRange(r, 0.8, 'bend');
  assert.ok(close(n.hi - n.lo, 48));
  assert.ok(percentPer10Deg(w) < percentPer10Deg(r) && percentPer10Deg(n) > percentPer10Deg(r));
  const tiny = scaleRange({ lo: 50, hi: 60 }, 0.1, 'lift');
  assert.ok(tiny.hi - tiny.lo >= MIN_SPAN - 1e-9);
  assert.deepEqual(setRangeEnd(r, 'hi', 30, 'bend'), { lo: 40, hi: 60 }, 'an end cannot cross the other');
  assert.deepEqual(fixRange({ lo: -20, hi: 50 }, 'lift'), { lo: 0, hi: 70 }, 'shifted inside the joint limits');
  assert.equal(percentPer10Deg({ lo: 0, hi: 100 }), 10);
});

test('saved poses: same pose → same sound after a range change; starters stay at their corners', () => {
  const hum = { id: 'hum', name: 'Hum', source: 'recorded', angles: { bend: 70, lift: 75 }, analysis: { f0: 233, amps: [1, 0.5] } };
  const starter = { id: 'starter-ah', name: 'ah', source: 'starter', pos: { x: 0.1, y: 0.1 }, angles: null, analysis: { f0: 196, amps: [1] } };
  for (const cal of [DEFAULT_CAL, { bend: { lo: 40, hi: 114 }, lift: { lo: 26, hi: 119 } }]) {
    const placed = [hum, starter].map((a) => ({ ...a, pos: anchorPoint(a, cal) }));
    const here = anglesToPoint(hum.angles, cal); // holding the Hum pose
    const b = blendAt(placed, here);
    assert.equal(b.params.f0, 233);
    assert.deepEqual(anchorPoint(starter, cal), { x: 0.1, y: 0.1 });
  }
  assert.notDeepEqual(anchorPoint(hum, DEFAULT_CAL), anchorPoint(hum, { bend: { lo: 40, hi: 114 }, lift: { lo: 26, hi: 119 } }), 'its dot moves');
  assert.equal(poseInRange(hum.angles, { bend: { lo: 80, hi: 120 }, lift: DEFAULT_CAL.lift }), false);
});

test('click placement stores the pose that reaches the clicked spot', () => {
  const ang = pointToAngles({ x: 0.35, y: 0.8 }, DEFAULT_CAL);
  const p = anglesToPoint(ang, DEFAULT_CAL);
  assert.ok(close(p.x, 0.35) && close(p.y, 0.8));
});

test('drawn takes are stored as poses and follow them through a new range', () => {
  const mapTake = { id: 't1', name: 'Take 1', createdAt: '1', path: [{ x: 0.1, y: 0.2, t: 0 }, { x: 0.9, y: 0.2, t: 1000 }], points: [{ x: 0.2, y: 0.2, t: 150, f0: 150, amps: [1] }, { x: 0.8, y: 0.2, t: 850, f0: 300, amps: [1] }], stats: {} };
  const t = takeToAngles(mapTake, DEFAULT_CAL);
  assert.ok(close(t.points[0].bend, 15 + 0.2 * 115, 0.051));
  const cal2 = { bend: { lo: 40, hi: 114 }, lift: { lo: 26, hi: 119 } };
  const anchors = poseTakeAnchors([t], cal2);
  assert.equal(anchors.length, 2);
  assert.deepEqual(anchors[0].pos, anglesToPoint(t.points[0], cal2));
  assert.equal(blendAt(anchors, anglesToPoint(t.points[1], cal2)).params.f0, 300);
  assert.equal(poseTakeAnchors([{ ...t, hidden: true }]).length, 0);
});

test('old projects load: recorded poses become placed sounds, starters are dropped', () => {
  const p = loadProject({ version: 2, anchors: [
    { id: 'a', name: 'Mine', source: 'recorded', angles: { bend: 50, lift: 40 }, analysis: { f0: 200, amps: [1] } },
    { id: 'starter-ah', name: 'Starter “ah”', source: 'starter', pos: { x: 0.1, y: 0.1 }, analysis: { f0: 196, amps: [1] } },
  ], cal: DEFAULT_CAL, useStarters: true });
  assert.equal(p.version, 3);
  assert.equal(p.sounds.length, 1);
  assert.equal(p.sounds[0].name, 'Mine');
  assert.deepEqual(p.sounds[0].place.angles, { bend: 50, lift: 40 });
  assert.deepEqual(p.takes, []);
  assert.equal('useStarters' in p, false);
  const q = loadProject({ takes: [{ id: 'x', points: [{ bend: 30, lift: 40, f0: 200, amps: [1] }, { x: 1, y: 2, f0: 3, amps: [1] }], path: [] }] });
  assert.equal(q.takes[0].points.length, 1, 'malformed points are dropped');
});

test('library sounds: placed or not, placedSounds and clearMap', () => {
  const p = loadProject({ sounds: [
    { id: 's1', name: 'ah', source: 'recorded', audioId: 'r1', analysis: { f0: 196, amps: [1, 0.5] }, place: { angles: { bend: 15, lift: 15 }, placedBy: 'click' } },
    { id: 's2', name: 'ee', source: 'recorded', audioId: 'r2', analysis: { f0: 220, amps: [1] }, place: null },
  ], takes: [{ id: 't', name: 'Take 1', points: [{ bend: 30, lift: 40, f0: 200, amps: [1] }], path: [] }] });
  assert.equal(p.sounds.length, 2);
  assert.equal(p.sounds[1].place, null, 'an unplaced recording stays in the library');
  const on = placedSounds(p.sounds, p.cal);
  assert.deepEqual(on.map((s) => s.id), ['s1']);
  assert.deepEqual(on[0].pos, { x: 0, y: 0 }, 'straight arm + arm down = bottom-left corner');
  assert.equal(blendAt(on, { x: 0.7, y: 0.7 }).params.f0, 196);
  const n = clearMap(p);
  assert.deepEqual(n, { sounds: 1, takes: 1 });
  assert.equal(placedSounds(p.sounds, p.cal).length, 0);
  assert.equal(p.sounds.length, 2, 'Clear map keeps every recording');
  assert.equal(p.takes.length, 1);
  assert.equal(p.takes[0].hidden, true);
  assert.equal(poseTakeAnchors(p.takes, p.cal).length, 0);
  const again = loadProject(JSON.parse(JSON.stringify(p)));
  assert.equal(again.sounds.every((s) => s.place === null), true, 'cleared state survives a reload');
});

test('axes: bending only the elbow moves x only, lifting only the left arm moves y only', () => {
  const a = anglesToPoint({ bend: 40, lift: 50 });
  const bendMore = anglesToPoint({ bend: 90, lift: 50 });
  const liftMore = anglesToPoint({ bend: 40, lift: 100 });
  const both = anglesToPoint({ bend: 90, lift: 100 });
  assert.ok(bendMore.x > a.x && bendMore.y === a.y, 'more bent arm → right');
  assert.ok(liftMore.y > a.y && liftMore.x === a.x, 'arm raised → up');
  assert.ok(both.x > a.x && both.y > a.y, 'both → diagonal');
});

test('describePose puts the angles in words', () => {
  assert.match(describePose({ bend: 10, lift: 15 }), /right arm nearly straight \(10°\), left arm down by your side \(15°\)/);
  assert.match(describePose({ bend: 120, lift: 140 }), /bent tightly.*raised high/);
});

// ── "Add my sound" analysis on synthetic recordings ──
const SR = 48000;
function tone(f0, sec, amps = [1, 0.6, 0.4, 0.25, 0.15, 0.1]) {
  const x = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < x.length; i++) { let v = 0; amps.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * f0 * (k + 1) * i / SR); }); x[i] = 0.1 * v; }
  return { samples: x, sampleRate: SR };
}
function noise(sec) {
  const x = new Float32Array(Math.round(sec * SR));
  let s = 3; for (let i = 0; i < x.length; i++) { s = (s * 16807) % 2147483647; x[i] = 0.2 * (s / 1073741823.5 - 1); }
  return { samples: x, sampleRate: SR };
}

test('a steady hum is analyzed on its steady middle and reports what was heard', () => {
  assert.deepEqual(steadySection(3), { start: 0.4, end: 2.7 });
  const r = analyzeMySound(tone(233, 3));
  assert.ok(r.ok);
  assert.ok(Math.abs(r.analysis.f0 - 233) < 1);
  assert.equal(r.analysis.amps.length, 48);
  assert.ok(r.analysis.summary.harmonicsKept >= 4 && r.analysis.summary.framesPeriodic > 0);
});

test('silence, noise and too-short recordings are rejected with a reason and a tip', () => {
  const s = analyzeMySound({ samples: new Float32Array(SR * 3), sampleRate: SR });
  assert.equal(s.ok, false); assert.equal(s.code, 'silent'); assert.match(s.tip, /microphone/);
  const n = analyzeMySound(noise(3));
  assert.equal(n.ok, false); assert.equal(n.code, 'not-periodic'); assert.match(n.tip, /humming/);
  const t = analyzeMySound(tone(200, 0.5));
  assert.equal(t.ok, false); assert.equal(t.code, 'too-short');
});

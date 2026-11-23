// Motion Morph (camera pose map): movement range, saved poses through a
// range change, drawn takes stored as poses, and the "Add my sound" analysis.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAL, MIN_SPAN, estimateRange, scaleRange, setRangeEnd, percentPer10Deg, poseInRange, fixRange,
  anglesToPoint, pointToAngles, anchorPoint, takeToAngles, poseTakeAnchors, loadProject, describePose, percentile, placedSounds, clearMap,
  elbowBend, ForeRatio, poseAngles, jumpGuard, OLD_DEFAULT_CAL,
} from '../src/pages/pose-map/pose-model.js';
import { analyzeMySound, steadySection } from '../src/pages/pose-map/sound-analysis.js';
import { blendAt } from '../src/pages/vowel-morph/morph-model.js';
import { soundParams, blendSounds, partGains, noiseFilterTargets, NOISE_BANDS } from '../src/pages/pose-map/pose-sound.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('default range is usable without calibration', () => {
  assert.deepEqual(anglesToPoint({ bend: 10, lift: 15 }), { x: 0, y: 0 });
  assert.deepEqual(anglesToPoint({ bend: 100, lift: 120 }), { x: 1, y: 1 });
  // a comfortable right-angle bend (90°) reaches most of the way across
  assert.ok(anglesToPoint({ bend: 90, lift: 15 }).x > 0.85);
  assert.ok(DEFAULT_CAL.bend.hi - DEFAULT_CAL.bend.lo >= 80 && DEFAULT_CAL.lift.hi - DEFAULT_CAL.lift.lo > 90);
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
  assert.ok(close(t.points[0].bend, DEFAULT_CAL.bend.lo + 0.2 * (DEFAULT_CAL.bend.hi - DEFAULT_CAL.bend.lo), 0.051));
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
  assert.equal(p.version, 4);
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
    { id: 's1', name: 'ah', source: 'recorded', audioId: 'r1', analysis: { f0: 196, amps: [1, 0.5] }, place: { angles: { bend: 10, lift: 15 }, placedBy: 'click' } },
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

test('silence, low rumble and too-short recordings are rejected with a reason and a tip', () => {
  const s = analyzeMySound({ samples: new Float32Array(SR * 3), sampleRate: SR });
  assert.equal(s.ok, false); assert.equal(s.code, 'silent'); assert.match(s.tip, /microphone/);
  const n = analyzeMySound(rumble(3));
  assert.equal(n.ok, false); assert.equal(n.code, 'low-noise'); assert.match(n.reason, /not a fricative/);
  const t = analyzeMySound(tone(200, 0.5));
  assert.equal(t.ok, false); assert.equal(t.code, 'too-short');
});

// ── round 3: elbow measurement, fricatives, one blended synth ──
function filtered(sec, { lo = 0, hi = SR / 2, gain = 0.3 } = {}) {
  // white noise shaped by a crude FFT-free band filter: sum of one-pole high/low passes
  const x = noise(sec).samples;
  const y = new Float32Array(x.length);
  const aH = Math.exp(-2 * Math.PI * lo / SR);
  const aL = Math.exp(-2 * Math.PI * hi / SR);
  let hp = 0; let px = 0; let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    hp = 0; px = 0; lp = 0;
    for (let i = 0; i < x.length; i++) {
      const v = pass ? y[i] : x[i];
      hp = aH * (hp + v - px); px = v;
      lp = (1 - aL) * hp + aL * lp;
      y[i] = lp;
    }
  }
  let m = 0; for (const v of y) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < y.length; i++) y[i] *= gain / m;
  return { samples: y, sampleRate: SR };
}
function rumble(sec) { return filtered(sec, { lo: 20, hi: 400 }); }

test('elbowBend: straight arm 0°, forearm toward the camera ≈ 90°, in-picture bends exact', () => {
  const S = { x: 0, y: -1 }; const E = { x: 0, y: 0 };
  assert.ok(close(elbowBend(S, E, { x: 0, y: 0.9 }, 0.9).bend, 0, 1e-6));
  // forearm pointing straight at the camera: it shrinks to a dot in the picture
  assert.ok(close(elbowBend(S, E, { x: 0, y: 0.0001 }, 0.9).bend, 90, 0.1));
  // half-length forearm hanging down: picture angle says 0°, real bend is 60°
  const half = elbowBend(S, E, { x: 0, y: 0.45 }, 0.9);
  assert.ok(close(half.imageBend, 0, 1e-6) && close(half.bend, 60, 0.1), `${half.bend}`);
  // a full-length forearm bent in the picture plane reads its true angle
  assert.ok(close(elbowBend(S, E, { x: 0.9, y: 0 }, 0.9).bend, 90, 1e-6));
  const r = new ForeRatio();
  for (let i = 0; i < 30; i++) r.add(1.0, i * 33);
  assert.ok(close(r.value, 1.0, 1e-9));
});

test('a joint outside the picture or barely visible is lost or flagged, never guessed', () => {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  const set = (i, x, y, v = 0.99) => { lms[i] = { x, y, z: 0, visibility: v }; };
  set(12, 0.4, 0.35); set(14, 0.4, 0.5); set(16, 0.4, 1.2); // wrist guessed below the picture
  set(11, 0.6, 0.35); set(13, 0.7, 0.5); set(23, 0.58, 0.7);
  let r = poseAngles(lms, { aspect: 1 });
  assert.ok(!r.ok && Number.isNaN(r.bend) && r.lost.includes('right wrist'));
  set(16, 0.4, 0.62, 0.6);
  r = poseAngles(lms, { aspect: 1 });
  assert.ok(r.ok && r.weak.includes('right wrist'));
});

test('jumpGuard holds back a one-frame jump and accepts a confirmed one', () => {
  const g = { last: null, pending: null };
  assert.deepEqual(jumpGuard(g, { bend: 20, lift: 30 }), { bend: 20, lift: 30 });
  assert.equal(jumpGuard(g, { bend: 150, lift: 30 }), null);
  assert.deepEqual(jumpGuard(g, { bend: 22, lift: 30 }), { bend: 22, lift: 30 });
  assert.equal(jumpGuard(g, { bend: 100, lift: 30 }), null);
  assert.deepEqual(jumpGuard(g, { bend: 102, lift: 31 }), { bend: 102, lift: 31 });
});

test('fricatives: an unvoiced hiss is kept as a NOISE sound with no f0', () => {
  const sss = analyzeMySound(filtered(3, { lo: 4500, hi: 11000 }));
  assert.ok(sss.ok, sss.reason);
  assert.equal(sss.analysis.kind, 'noise');
  assert.equal(sss.analysis.f0, null);
  assert.equal(sss.analysis.noise.bands.length, NOISE_BANDS);
  assert.ok(sss.analysis.summary.centroidHz > 4000, `${sss.analysis.summary.centroidHz}`);
  const shh = analyzeMySound(filtered(3, { lo: 2000, hi: 5000 }));
  assert.ok(shh.ok && shh.analysis.kind === 'noise');
  assert.ok(shh.analysis.summary.centroidHz < sss.analysis.summary.centroidHz);
  const hum = analyzeMySound(tone(233, 3));
  assert.equal(hum.analysis.kind, 'pitched');
});

test('one synth: vowel ↔ fricative blends harmonics and noise; no pitch is invented', () => {
  const ah = soundParams({ kind: 'pitched', f0: 200, amps: [1, 0.5] });
  const ee = soundParams({ kind: 'pitched', f0: 300, amps: [0.2, 1] });
  const sss = soundParams({ kind: 'noise', noise: { bands: Array.from({ length: NOISE_BANDS }, (_, i) => (i > 18 ? 1 : 0.05)) } });
  const two = blendSounds([{ params: ah, weight: 0.5 }, { params: ee, weight: 0.5 }]);
  assert.ok(close(two.f0, 250) && close(two.amps[0], 0.6) && close(two.amps[1], 0.75) && two.harm === 1 && two.noise === 0 && two.bands === null);
  const mix = blendSounds([{ params: ah, weight: 0.25 }, { params: sss, weight: 0.75 }]);
  assert.equal(mix.f0, 200, 'f0 comes only from the pitched sound');
  assert.ok(close(mix.harm, 0.25) && close(mix.noise, 0.75) && close(mix.bands[20], 1));
  const g = partGains(mix);
  assert.ok(close(g.harm ** 2 + g.noise ** 2, 1), 'equal-power crossfade');
  const only = blendSounds([{ params: sss, weight: 1 }]);
  assert.ok(Number.isNaN(only.f0) && only.harm === 0 && only.noise === 1);
  const t = noiseFilterTargets(only.bands, 48000);
  assert.equal(t.length, NOISE_BANDS);
  assert.ok(t[20].gain > t[5].gain * 10);
});

test('saved noise sounds load; maps saved before v4 keep their dots in place with the new range', () => {
  const old = { version: 3, cal: OLD_DEFAULT_CAL, calSource: 'default', sounds: [
    { id: 's1', name: 'ah', source: 'recorded', analysis: { f0: 196, amps: [1] }, place: { angles: { bend: 118.5, lift: 67.5 }, placedBy: 'click' } },
    { id: 's2', name: 'sss', source: 'recorded', analysis: { kind: 'noise', noise: { bands: [0, 1] } }, place: null },
  ], takes: [{ id: 't', name: 'Take 1', points: [{ bend: 72.5, lift: 15, f0: 200, amps: [1] }], path: [{ bend: 72.5, lift: 15, t: 0 }] }] };
  const before = anglesToPoint(old.sounds[0].place.angles, OLD_DEFAULT_CAL);
  const p = loadProject(JSON.parse(JSON.stringify(old)));
  assert.equal(p.version, 4);
  assert.deepEqual(p.cal, JSON.parse(JSON.stringify(DEFAULT_CAL)));
  const after = anglesToPoint(p.sounds[0].place.angles, p.cal);
  assert.ok(close(after.x, before.x, 0.002) && close(after.y, before.y, 0.002), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  assert.ok(close(anglesToPoint(p.takes[0].points[0], p.cal).x, 0.5, 0.002));
  assert.equal(p.sounds[1].analysis.kind, 'noise');
  assert.equal(p.sounds[1].analysis.f0, null);
  assert.deepEqual(p.migratedFrom.cal, OLD_DEFAULT_CAL);
  const again = loadProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(again.sounds[0].place.angles, p.sounds[0].place.angles, 'migration happens once');
});

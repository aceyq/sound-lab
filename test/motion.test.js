// Unit tests for Motion Score's signal processing, mappings and safety logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as P from '../src/pages/motion-score/protocol.js';
import { MotionFeatures, wrapDeg } from '../src/pages/motion-score/sensors.js';
import * as M from '../src/pages/motion-score/mapping.js';
import { Instrument } from '../src/pages/motion-score/instrument.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ───────────── protocol ─────────────
test('session IDs and codes are random, typeable and normalized', () => {
  const a = P.newSession(webcrypto);
  const b = P.newSession(webcrypto);
  assert.match(a.sessionId, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(a.token, /^[A-Z2-9]{6}$/);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(P.normalizeSessionId(' abcd efgh '), 'ABCD-EFGH');
  assert.equal(P.normalizeSessionId('abc'), null);
  assert.equal(P.normalizeToken('xy-z12 3'), 'XYZ123');
});

test('controller URL keeps the deployed base path and hash route', () => {
  const url = P.controllerUrl({ origin: 'https://ace.github.io', pathname: '/sound-lab/' }, 'ABCD-EFGH', 'XYZ234');
  assert.equal(url, 'https://ace.github.io/sound-lab/#/controller?session=ABCD-EFGH&code=XYZ234');
  const url2 = P.controllerUrl({ origin: 'https://ace.github.io', pathname: '/sound-lab/index.html' }, 'ABCD-EFGH', 'XYZ234');
  assert.ok(url2.startsWith('https://ace.github.io/sound-lab/#/controller'));
  assert.ok(P.isLocalOnly('localhost') && P.isLocalOnly('127.0.0.1') && !P.isLocalOnly('ace.github.io') && !P.isLocalOnly('192.168.1.5'));
});

const good = { type: 'sample', seq: 3, t: 1000, tilt: 12.5, tiltSrc: 'orientation', lin: 0.4, linSrc: 'sensor', jerk: 20, screen: 0, rate: 60 };

test('valid sample passes and unknown fields are dropped', () => {
  const r = P.validatePhoneMessage({ ...good, extra: 'x' });
  assert.ok(r.ok);
  assert.equal(r.msg.extra, undefined);
  assert.ok(P.validatePhoneMessage({ ...good, tilt: null, lin: null, jerk: null }).ok); // missing sensor fields
});

test('malformed or out-of-range messages are rejected', () => {
  const bad = [
    null, 'hi', [], { type: 'nope' },
    { ...good, tilt: 500 }, { ...good, tilt: NaN }, { ...good, tilt: '10' },
    { ...good, lin: -1 }, { ...good, lin: Infinity }, { ...good, jerk: 1e9 },
    { ...good, seq: -1 }, { ...good, seq: 1.5 }, { ...good, t: 'now' }, { ...good, screen: 9999 },
    { ...good, tiltSrc: 'magic' }, { type: 'command', cmd: 'rm -rf' }, { type: 'status', sensors: 'active' },
    { type: 'hello', v: 99, code: 'ABC' },
  ];
  for (const m of bad) assert.equal(P.validatePhoneMessage(m).ok, false, JSON.stringify(m));
  assert.ok(P.validatePhoneMessage({ type: 'command', cmd: 'panic' }).ok);
});

// ───────────── sensor processing ─────────────
test('angle wrapping', () => {
  assert.equal(wrapDeg(190), -170);
  assert.equal(wrapDeg(-190), 170);
  assert.equal(wrapDeg(360), 0);
  close(M.relativeTilt(-175, 175), 10); // across the ±180 seam
  close(M.relativeTilt(175, -175), -10);
  close(M.relativeTilt(70, 60, true), -10);
});

test('gravity-free acceleration is used directly; still phone reads ~0', () => {
  const f = new MotionFeatures();
  for (let i = 0; i < 60; i++) f.onMotion(i * 16, { x: 0.01, y: -0.01, z: 0 }, { x: 0, y: 9.81, z: 0 });
  const s = f.take();
  assert.equal(s.linSrc, 'sensor');
  assert.ok(s.lin < 0.05);
});

test('gravity is estimated and removed when only accelerationIncludingGravity exists', () => {
  const f = new MotionFeatures();
  // Phone held still and upright: gravity only.
  for (let i = 0; i < 200; i++) f.onMotion(i * 16, null, { x: 0, y: 9.81, z: 0.2 });
  let s = f.take();
  assert.equal(s.linSrc, 'estimated');
  assert.ok(s.lin < 0.05, `still lin ${s.lin}`);
  assert.equal(s.tiltSrc, 'gravity');
  // Shaking adds acceleration that is NOT removed (it changes faster than gravity).
  for (let i = 200; i < 260; i++) f.onMotion(i * 16, null, { x: 4 * Math.sin(i), y: 9.81, z: 0.2 });
  s = f.take();
  assert.ok(s.lin > 1.5, `moving lin ${s.lin}`);
});

test('invalid and huge readings are ignored; gaps reset filters', () => {
  const f = new MotionFeatures();
  f.onMotion(0, { x: NaN, y: 0, z: 0 }, null);
  f.onMotion(16, { x: 500, y: 0, z: 0 }, null);
  assert.equal(f.take().lin, null);
  f.onMotion(32, { x: 1, y: 0, z: 0 }, null);
  f.onMotion(48, { x: 1, y: 0, z: 0 }, null);
  f.onMotion(2000, { x: 1, y: 0, z: 0 }, null); // long gap
  assert.equal(f.jerk, 0);
});

test('sharp change in acceleration gives a large jerk peak', () => {
  const f = new MotionFeatures();
  for (let i = 0; i < 30; i++) f.onMotion(i * 16, { x: 0, y: 0, z: 0 }, null);
  const calm = f.take().jerk;
  f.onMotion(30 * 16, { x: 15, y: 0, z: 0 }, null);
  f.onMotion(31 * 16, { x: 0, y: 0, z: 0 }, null);
  const hit = f.take().jerk;
  assert.ok(calm < 1 && hit > 200, `calm ${calm} hit ${hit}`);
});

// ───────────── mappings ─────────────
test('tilt → pitch is logarithmic 110–880 Hz around neutral', () => {
  close(M.unitToPitch(M.tiltToUnit(-35)), 110);
  close(M.unitToPitch(M.tiltToUnit(35)), 880);
  close(M.unitToPitch(M.tiltToUnit(0)), Math.sqrt(110 * 880)); // geometric middle
  close(M.unitToPitch(1 / 3), 220);
  assert.equal(M.tiltToUnit(90), 1);
});

test('intensity mapping: stillness is 0, sensitivity scales range', () => {
  const cal = { noise: 0.1 };
  assert.equal(M.intensityToUnit(0.12, cal), 0);
  assert.equal(M.intensityToUnit(NaN, cal), 0);
  const a = M.intensityToUnit(2, cal, { ...M.DEFAULTS, sensitivity: 1 });
  const b = M.intensityToUnit(2, cal, { ...M.DEFAULTS, sensitivity: 2 });
  close(b, Math.min(1, a * 2), 1e-9);
  assert.equal(M.intensityToUnit(1e6, cal), 1);
});

test('harmonic count hysteresis and Nyquist exclusion', () => {
  for (const v of [4.5, 4.6, 4.4, 4.75]) assert.equal(M.stableHarmonicCount(v, 4), 4);
  assert.equal(M.stableHarmonicCount(4.85, 4), 5);
  const { amps, audible } = M.harmonicAmplitudes(12, 880, 4000);
  assert.equal(audible, 4); // 5 × 880 = 4400 ≥ 4000
  close(amps.reduce((x, y) => x + y, 0), 1);
  close(amps[1] / amps[0], 0.5);
  assert.equal(M.harmonicAmplitudes(12, 1000, 4000).audible, 3); // 4000 itself excluded
  assert.equal(M.harmonicAmplitudes(12, 880, 24000).audible, 12);
});

test('pentatonic notes A C D E G with stable selection', () => {
  assert.deepEqual(M.PENTATONIC_SEMIS.slice(0, 6), [0, 3, 5, 7, 10, 12]);
  assert.equal(M.stablePentatonic(M.semisToHz(1.5), 0), 0);
  assert.equal(M.stablePentatonic(M.semisToHz(1.5), 3), 3);
  assert.equal(M.stablePentatonic(M.semisToHz(2.3), 0), 3);
  assert.equal(M.noteName(440).name, 'A4');
});

test('accent detector: threshold, hysteresis, cooldown, no firing after reset', () => {
  const d = new M.AccentDetector();
  const cal = { jerkNoise: 10 };
  const thr = d.threshold(cal);
  assert.equal(d.update(0, thr * 2, cal), false); // first sample after reset never fires
  assert.equal(d.update(40, 5, cal), false); // quiet → ready
  assert.equal(d.update(80, thr * 2, cal), true); // fires
  assert.equal(d.update(120, thr * 2, cal), false); // still high: hysteresis
  assert.equal(d.update(160, 5, cal), false); // calm again but within cooldown
  assert.equal(d.update(200, thr * 2, cal), false); // 120 ms after the hit: cooldown
  assert.equal(d.update(240, 5, cal), false);
  assert.equal(d.update(400, thr * 2, cal), true); // 320 ms after: fires
  // A gap in phone time resets the detector (stale data cannot trigger).
  d.update(440, 5, cal);
  assert.equal(d.update(2000, thr * 3, cal), false);
});

test('calibration: neutral (wrap-safe), noise, and rejects movement', () => {
  const still = Array.from({ length: 40 }, (_, i) => ({ tilt: i % 2 ? 179 : -179, lin: 0.05 + (i % 3) * 0.01, jerk: 8, screen: 0 }));
  const r = M.calibrateFromSamples(still);
  assert.ok(r.done);
  close(Math.abs(r.neutral), 180, 1e-6);
  assert.ok(r.noise < 0.1);
  assert.ok(M.calibrateFromSamples(still.slice(0, 5)).error);
  const moving = still.map((s, i) => ({ ...s, tilt: i * 3 }));
  assert.match(M.calibrateFromSamples(moving).error, /moved/);
});

// ───────────── instrument safety logic ─────────────
/**
 * A connected, calibrated phone. Pose: `tilt` is the old beta-style number
 * (kept for the legacy fallback), the orientation vector comes from a start
 * position tilted back 25° and level; `setPose(pitchDeg, leanDeg)` moves it
 * relative to that start (pitch + = top toward you, lean + = right edge down).
 */
function phoneReady() {
  const inst = new Instrument();
  inst.setSource('phone');
  inst.setConnected(true);
  inst.setPhoneStatus({ sensors: 'active', hidden: false });
  let now = 0;
  let seq = 0;
  let pose = { pitch: 0, lean: 0 };
  const feed = (tilt, lin, jerk = 5, screen = 0) => {
    now += 40;
    // `tilt` (old-style beta) also drives pitch in these tests: 60 = neutral.
    const pitch = pose.pitch + (tilt - 60);
    const up = M.upFromAngles(25 - pitch, -pose.lean);
    return inst.ingest({ type: 'sample', seq: seq++, t: now + 5000, tilt, tiltSrc: 'orientation', up, lin, linSrc: 'sensor', jerk, screen, rate: 60 }, now);
  };
  inst.startCalibration(now);
  for (let i = 0; i < 130; i++) { feed(60, 0.05); inst.tick(now, 0.04); }
  const setPose = (pitch, lean) => { pose = { pitch, lean }; };
  return { inst, feed, setPose, at: () => now, advance: (ms) => { now += ms; } };
}

test('pairing alone never makes sound; needs audio and Arm', () => {
  const { inst, feed, at } = phoneReady();
  assert.equal(inst.calib.state, 'done');
  feed(60, 3);
  assert.equal(inst.tick(at(), 0.04).allowed.ok, false);
  inst.setAudio(true);
  assert.equal(inst.soundAllowed(at()).reason, 'Not armed');
  assert.equal(inst.arm(), '');
  assert.ok(inst.soundAllowed(at()).ok);
});

test('Movement intensity mapping (legacy): stillness fades to silence, movement raises expression and harmonics', () => {
  const { inst, feed, at } = phoneReady();
  inst.setMapping('intensity');
  assert.equal(inst.exprSource, 'movement');
  inst.setAudio(true);
  inst.arm();
  for (let i = 0; i < 50; i++) { feed(60, 3); inst.tick(at(), 0.04); }
  assert.ok(inst.expr > 0.4 && inst.count >= 5, `expr ${inst.expr} count ${inst.count}`);
  for (let i = 0; i < 75; i++) { feed(60, 0.05); inst.tick(at(), 0.04); }
  assert.ok(inst.expr < 0.01, `expr ${inst.expr}`);
});

test('Panic latches: phone Arm cannot undo it until Start Audio', () => {
  const { inst } = phoneReady();
  inst.setAudio(true);
  inst.arm();
  inst.triggerPanic();
  assert.equal(inst.armed, false);
  assert.match(inst.arm(), /Panic/);
  assert.equal(inst.armed, false);
  inst.setAudio(true);
  assert.equal(inst.arm(), '');
});

test('stale input silences within 0.5 s; long silence and disconnect disarm', () => {
  const { inst, feed, at, advance } = phoneReady();
  inst.setAudio(true);
  inst.arm();
  feed(60, 3);
  advance(600);
  assert.equal(inst.tick(at(), 0.6).allowed.ok, false);
  assert.ok(inst.armed); // still armed: resumes if data returns quickly
  advance(3000);
  inst.tick(at(), 0.1);
  assert.equal(inst.armed, false);
  inst.arm();
  inst.setConnected(false);
  assert.equal(inst.armed, false);
  assert.equal(inst.input, null);
});

test('stillness is valid input (not stale); hidden phone disarms', () => {
  const { inst, feed, at } = phoneReady();
  inst.setAudio(true);
  inst.arm();
  for (let i = 0; i < 30; i++) { feed(60, 0.02); inst.tick(at(), 0.04); }
  assert.ok(inst.soundAllowed(at()).ok); // allowed, just quiet
  inst.setPhoneStatus({ sensors: 'active', hidden: true });
  assert.equal(inst.armed, false);
});

test('rotation invalidates calibration and disarms', () => {
  const { inst, feed } = phoneReady();
  inst.setAudio(true);
  inst.arm();
  feed(60, 0.05, 5, 90);
  assert.equal(inst.armed, false);
  assert.equal(inst.calib.state, 'needed');
  assert.match(inst.arm(), /rotated/);
});

test('Accents (legacy mapping): a sharp hit triggers once, samples pitch and richness; cooldown holds', () => {
  const { inst, feed, at } = phoneReady();
  inst.setMapping('intensity');
  inst.setAudio(true);
  inst.setMode('accents');
  inst.arm();
  for (let i = 0; i < 5; i++) { feed(80, 0.05); inst.tick(at(), 0.04); }
  let r = feed(80, 4, 2000);
  assert.ok(r.accent);
  assert.ok(inst.f0 > 500, `f0 ${inst.f0}`);
  assert.ok(inst.count > 4);
  r = feed(80, 4, 2000);
  assert.ok(!r.accent);
  assert.equal(inst.hits, 1);
});

test('switching input source disarms and clears input', () => {
  const { inst } = phoneReady();
  inst.setAudio(true);
  inst.arm();
  inst.setSource('demo');
  assert.equal(inst.armed, false);
  assert.equal(inst.input, null);
  assert.equal(inst.calib.state, 'done'); // demo uses a preset
});

// ───────────── Tilt instrument: orientation-relative gestures ─────────────
// Rotation helpers in the phone's own frame (x right, y up the screen, z out of the screen).
const rotX = (v, d) => { const a = (d * Math.PI) / 180; return [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)]; };
const rotZ = (v, d) => { const a = (d * Math.PI) / 180; return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]]; };
// Turning the phone by R in the world turns "up" (seen from the phone) by R⁻¹.

test('up vector from beta/gamma matches the W3C rotation model', () => {
  const D = Math.PI / 180;
  for (const [b, g] of [[0, 0], [60, 0], [60, 20], [-30, 45], [89, 70], [120, -10]]) {
    // R = Rz(α)·Rx(β)·Ry(γ); up in device frame = Rᵀ·(0,0,1) (α does not matter).
    const cb = Math.cos(b * D); const sb = Math.sin(b * D); const cg = Math.cos(g * D); const sg = Math.sin(g * D);
    const expected = [-sg * cb, sb, cg * cb];
    const u = M.upVector(b, g);
    for (let k = 0; k < 3; k++) close(u[k], expected[k], 1e-9);
    close(Math.hypot(...u), 1, 1e-9);
  }
});

test('the same physical orientation gives the same gestures in either Euler form', () => {
  // (β, γ) and (180° − β, γ + 180°) describe the same orientation; subtracting
  // raw beta would see a huge change, the orientation-relative mapping sees none.
  const up0 = M.upVector(80, 5);
  const a = M.relativeGestures(M.upVector(85, 10), up0);
  const b = M.relativeGestures(M.upVector(180 - 85, 10 + 180), up0);
  close(a.pitch, b.pitch, 1e-6);
  close(a.lean, b.lean, 1e-6);
});

test('pure forward/back tilt never changes the lean reading, from any reasonable start', () => {
  for (const tb of [0, 10, 25, 45, 60]) {
    for (const lean0 of [0, 8]) {
      const up0 = M.upFromAngles(tb, lean0);
      for (const r of [-30, -10, 10, 30]) {
        const g = M.relativeGestures(rotX(up0, r), up0);
        assert.ok(Math.abs(g.lean) < 1e-6, `start ${tb}°/${lean0}°, tilt ${r}°: lean ${g.lean}`);
        assert.ok(Math.abs(Math.abs(g.pitch) - Math.abs(r)) < 1e-6);
      }
    }
  }
  // Direction: top toward you (tilt-back decreases) = positive pitch.
  const up0 = M.upFromAngles(25, 0);
  assert.ok(M.relativeGestures(M.upFromAngles(10, 0), up0).pitch > 0);
});

test('steering-wheel lean registers as lean, with only a small pitch side effect', () => {
  for (const tb of [5, 25, 45]) {
    const up0 = M.upFromAngles(tb, 0);
    for (const s of [-25, -10, 10, 25]) {
      const g = M.relativeGestures(rotZ(up0, s), up0);
      // Seen by gravity, a steering turn of s reads as lean asin(sin s · cos tiltBack):
      // nearly all of it near upright, less the flatter the phone is held.
      const expected = (Math.asin(Math.sin((s * Math.PI) / 180) * Math.cos((tb * Math.PI) / 180)) * 180) / Math.PI;
      close(Math.abs(g.lean), Math.abs(expected), 1e-6);
      if (tb <= 25) assert.ok(Math.abs(g.lean) > Math.abs(s) * 0.85, `tb ${tb} s ${s}: lean ${g.lean}`);
      assert.ok(Math.abs(g.pitch) < 5, `tb ${tb} s ${s}: pitch side effect ${g.pitch.toFixed(2)}°`);
    }
  }
});

test('forward/back angle wraps correctly around ±180°', () => {
  const g = M.relativeGestures(M.upFromAngles(-170, 0), M.upFromAngles(170, 0));
  close(Math.abs(g.pitch), 20, 1e-6);
});

test('holding-position check: good start, too flat, past upright, leaning, upside down', () => {
  assert.equal(M.holdCheck(M.upFromAngles(25, 0)).level, 'good');
  assert.equal(M.holdCheck(M.upFromAngles(40, 3)).level, 'good');
  assert.equal(M.holdCheck(M.upFromAngles(85, 0)).level, 'bad'); // nearly flat
  assert.match(M.holdCheck(M.upFromAngles(85, 0)).text, /flat/);
  assert.equal(M.holdCheck(M.upFromAngles(60, 0)).level, 'warn');
  assert.equal(M.holdCheck(M.upFromAngles(-30, 0)).level, 'bad'); // top toward you past upright
  assert.equal(M.holdCheck(M.upFromAngles(25, 35)).level, 'bad'); // leaning
  assert.equal(M.holdCheck([0, -1, 0]).level, 'bad'); // upside down
  assert.equal(M.holdCheck(null).level, 'bad');
});

test('lean → richness: neutral pure, dead zone, either direction, smooth from 0', () => {
  assert.equal(M.leanToRichness(0), 0);
  assert.equal(M.leanToRichness(4.9), 0);
  assert.equal(M.leanToRichness(-5), 0);
  close(M.leanToRichness(30), 1);
  close(M.leanToRichness(-30), 1);
  close(M.leanToRichness(17.5), M.leanToRichness(-17.5));
  assert.equal(M.leanToRichness(null), 0); // unavailable → pure tone
  // No jump at the dead-zone edge, monotonic beyond it.
  let prev = 0;
  for (let a = 0; a <= 40; a += 0.05) {
    const r = M.leanToRichness(a);
    assert.ok(r - prev < 0.004 && r >= prev, `at ${a}°`);
    prev = r;
  }
  assert.equal(M.leanToRichness(8, 10, 30), 0); // adjustable dead zone
});

test('phone features include an orientation vector only when orientation exists', () => {
  const f = new MotionFeatures();
  f.onMotion(0, { x: 0, y: 0, z: 0 }, null);
  f.onOrientation(0, 30, 10);
  const u = f.take().up;
  const e = M.upVector(30, 10);
  for (let k = 0; k < 3; k++) close(u[k], e[k], 1e-3);
  const g = new MotionFeatures();
  for (let i = 0; i < 100; i++) g.onMotion(i * 16, null, { x: 0, y: 9.8, z: 0 });
  assert.equal(g.take().up, null);
});

test('protocol: orientation vector and expression messages are validated', () => {
  assert.ok(P.validatePhoneMessage({ ...good, up: [0, 0.9063, 0.4226] }).ok);
  for (const up of [[0, 1], [0, 2, 0], ['a', 0, 1], [0, 0.5, 0.5]]) assert.equal(P.validatePhoneMessage({ ...good, up }).ok, false, JSON.stringify(up));
  assert.equal(P.validatePhoneMessage(good).msg.up, null);
  assert.ok(P.validatePhoneMessage({ type: 'expr', value: 0.4 }).ok);
  for (const v of [-0.1, 1.5, NaN, '0.5']) assert.equal(P.validatePhoneMessage({ type: 'expr', value: v }).ok, false);
});

test('richness → weights: minimum = only the fundamental, maximum = all 12, smooth in between', () => {
  assert.deepEqual(M.richnessWeights(0), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(M.richnessWeights(1), new Array(12).fill(1));
  let prev = M.richnessWeights(0);
  for (let r = 0.001; r <= 1; r += 0.001) {
    const w = M.richnessWeights(r);
    for (let i = 0; i < 12; i++) assert.ok(Math.abs(w[i] - prev[i]) < 0.02, `jump at r=${r}`);
    assert.equal(w[0], 1);
    prev = w;
  }
});

test('harmonic mix: recipe 1/n, peak-normalized (no clipping), Nyquist excluded', () => {
  const full = M.harmonicMix(M.richnessWeights(1), 200, 24000);
  close(full.recipe[1] / full.recipe[0], 1 / 2);
  close(M.waveformPeak(full.output), 1, 1e-3);
  const pure = M.harmonicMix(M.richnessWeights(0), 200, 24000);
  close(pure.norm, 1, 1e-6);
  assert.ok(pure.output.slice(1).every((a) => a === 0));
  assert.equal(M.harmonicMix(M.richnessWeights(1), 880, 4000).recipe.filter((a) => a > 0).length, 4);
});

test('Tilt instrument: neutral is pure; tilt alone keeps it pure; lean either way adds harmonics; back to level is pure', () => {
  const { inst, feed, setPose, at } = phoneReady();
  assert.equal(inst.mapping, 'tilt');
  assert.ok(inst.cal.sideAvailable);
  assert.equal(inst.calib.state, 'done');
  inst.setAudio(true);
  inst.arm();
  const run = (n = 40) => { for (let i = 0; i < n; i++) { feed(60, 0.05); inst.tick(at(), 0.04); } };
  run();
  assert.equal(inst.richness, 0);
  assert.deepEqual(inst.weights, M.richnessWeights(0));
  const f0n = inst.f0;
  for (const p of [-30, -15, 15, 30]) { setPose(p, 0); run(); assert.equal(inst.richness, 0, `tilt ${p}`); }
  setPose(30, 0); run();
  assert.ok(inst.f0 > f0n * 2);
  setPose(0, 3); run(); // small unintended lean: inside the dead zone
  assert.equal(inst.richness, 0);
  setPose(0, 30); run(); assert.ok(inst.richness > 0.95);
  setPose(0, -30); run(); assert.ok(inst.richness > 0.95);
  close(inst.f0, f0n, 2);
  setPose(0, 0); run(60); assert.equal(inst.richness, 0);
});

test('Lock richness holds the harmonic recipe while lean and pitch change', () => {
  const { inst, feed, setPose, at } = phoneReady();
  inst.setAudio(true);
  inst.arm();
  const run = (n = 40) => { for (let i = 0; i < n; i++) { feed(60, 0.05); inst.tick(at(), 0.04); } };
  setPose(0, 17); run();
  const held = inst.weights.slice();
  assert.ok(inst.richness > 0.3 && inst.richness < 0.7);
  inst.setRichLock(true);
  for (const [p, l] of [[0, 0], [25, -30], [-25, 30]]) { setPose(p, l); run(); assert.deepEqual(inst.weights, held); }
  inst.setRichLock(false);
  setPose(0, 0); run(60);
  assert.equal(inst.richness, 0);
});

test('calibration rejects an unreliable holding position with instructions', () => {
  const inst = new Instrument();
  inst.setSource('phone');
  inst.setConnected(true);
  inst.setPhoneStatus({ sensors: 'active', hidden: false });
  let now = 0;
  inst.startCalibration(now);
  for (let i = 0; i < 130; i++) { now += 40; inst.ingest({ type: 'sample', seq: i, t: now, tilt: 5, tiltSrc: 'orientation', up: M.upFromAngles(85, 0), lin: 0.05, linSrc: 'sensor', jerk: 5, screen: 0, rate: 60 }, now); inst.tick(now, 0.04); }
  assert.equal(inst.calib.state, 'failed');
  assert.match(inst.calib.text, /flat/);
});

test('Steady sustain: expression follows the slider, not movement; safety still applies', () => {
  const { inst, feed, at, advance } = phoneReady();
  assert.equal(inst.exprSource, 'sustain');
  inst.setAudio(true);
  inst.arm();
  inst.setExprLevel(0.4);
  for (let i = 0; i < 60; i++) { feed(60, 0.02); inst.tick(at(), 0.04); }
  close(inst.expr, 0.4, 0.01);
  for (let i = 0; i < 60; i++) { feed(60, 5); inst.tick(at(), 0.04); }
  close(inst.expr, 0.4, 0.01);
  advance(700);
  for (let i = 0; i < 40; i++) { advance(40); inst.tick(at(), 0.04); }
  assert.ok(inst.expr < 0.01, 'stale input must silence steady sustain');
  advance(3000);
  inst.tick(at(), 0.04);
  assert.equal(inst.armed, false);
});

test('Pitch lock: holds f0 exactly (also over Pentatonic) while richness still changes', () => {
  const { inst, feed, setPose, at } = phoneReady();
  inst.setAudio(true);
  inst.arm();
  assert.equal(inst.setLock(true, 200), 200);
  inst.pitchMode = 'pentatonic';
  for (const [p, l] of [[-30, 0], [30, 0], [0, 30], [20, -30]]) {
    setPose(p, l);
    for (let i = 0; i < 30; i++) { feed(60, 0.05); inst.tick(at(), 0.04); }
    assert.equal(inst.f0, 200);
  }
  assert.ok(inst.richness > 0.9);
  assert.equal(inst.setLock(true, 5), 50);
});

test('missing orientation vector: tone stays pure and lean is reported unavailable', () => {
  const inst = new Instrument();
  inst.setSource('phone');
  inst.setConnected(true);
  inst.setPhoneStatus({ sensors: 'active', hidden: false });
  let now = 0;
  let seq = 0;
  const feed = () => { now += 40; inst.ingest({ type: 'sample', seq: seq++, t: now, tilt: 60, tiltSrc: 'gravity', up: null, lin: 0.05, linSrc: 'sensor', jerk: 5, screen: 0, rate: 60 }, now); inst.tick(now, 0.04); };
  inst.startCalibration(now);
  for (let i = 0; i < 130; i++) feed();
  assert.equal(inst.calib.state, 'done');
  assert.equal(inst.cal.sideAvailable, false);
  assert.match(inst.calib.text, /not available/);
  assert.equal(inst.sideAvailable, false);
  for (let i = 0; i < 40; i++) feed();
  assert.equal(inst.richness, 0);
});

test('mapping switch sets the natural expression default; Accents in Tilt mapping uses lean for richness', () => {
  const { inst, feed, setPose, at } = phoneReady();
  inst.setMapping('intensity');
  assert.equal(inst.exprSource, 'movement');
  inst.setMapping('tilt');
  assert.equal(inst.exprSource, 'sustain');
  inst.setAudio(true);
  inst.setMode('accents');
  inst.arm();
  setPose(0, 35);
  for (let i = 0; i < 20; i++) { feed(70, 0.05); inst.tick(at(), 0.04); }
  const r = feed(70, 0.05, 2000);
  assert.ok(r.accent);
  assert.ok(inst.weights.every((w) => w > 0.9));
});

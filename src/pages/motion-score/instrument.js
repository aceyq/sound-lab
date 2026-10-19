// The instrument's rules: input samples → musical parameters, plus every
// safety condition that decides whether sound is allowed. No DOM, no Web
// Audio: the page feeds samples and time in, and applies the results to the
// synthesizer. Unit-tested in test/motion-instrument.test.js.
//
// Phone and laptop clocks are never compared. "Fresh" means the LAPTOP
// received a sample recently (laptop clock); accent timing and cooldowns use
// the PHONE's own sample times.

import * as M from './mapping.js';

// Laptop Demo's simulated phone is "held" in the recommended position:
// portrait, tilted back 25° from upright, level.
export const DEMO_TILT_BACK = 25;
export const DEMO_CAL = Object.freeze({ done: true, neutral: 0, noise: 0.1, jerkNoise: 10, up0: M.upFromAngles(DEMO_TILT_BACK, 0), sideAvailable: true, screen: 0, demo: true });
export const DEFAULT_LOCK_HZ = 200;
export const LOCK_MIN_HZ = 50;
export const LOCK_MAX_HZ = 1000;
const CAL_READY_MS = 2500; // time to get into the start position before measuring
const CAL_MEASURE_MS = 2000; // measuring stillness

export class Instrument {
  constructor() {
    this.settings = { ...M.DEFAULTS };
    this.mode = 'flow'; // flow | accents
    // Which movement shapes the tone: 'tilt' = sideways lean → harmonic
    // richness (pitch and timbre independent); 'intensity' = the original
    // mapping (movement intensity → harmonic count and expression).
    this.mapping = 'tilt';
    // Flow expression: 'sustain' = steady level from the Expression slider;
    // 'movement' = movement intensity (the original behavior).
    this.exprSource = 'sustain';
    this.exprLevel = 0.6;
    this.lock = { on: false, hz: DEFAULT_LOCK_HZ };
    // Lock richness: hold the current harmonic recipe (for showing pitch alone).
    this.richLock = false;
    this.pitchMode = 'continuous'; // continuous | pentatonic
    this.source = 'none'; // none | phone | demo
    this.audioOn = false;
    this.panic = false;
    this.armed = false;
    this.disarmReason = '';
    this.connected = false;
    this.phoneHidden = false;
    this.phoneSensors = 'off';
    this.cal = { ...M.NO_CAL };
    this.calib = { state: 'none', text: '' }; // none | running | done | failed | needed
    this.detector = new M.AccentDetector();
    this.hits = 0;
    this._resetInput();
  }

  _resetInput() {
    this.input = null; // last valid sample
    this.lastReceipt = -Infinity; // laptop ms
    this.tiltRel = null;
    this.intensity = 0; // 0..1 from the latest sample
    this.hSmooth = 0;
    this.recentPeaks = []; // [phoneT, intensity] for accent richness
    this.f0 = 220;
    this.note = null;
    this.count = 1;
    this.sideRel = null; // sideways lean relative to neutral (degrees)
    this.hold = null; // live holding-position check
    this.richness = 0;
    this.weights = M.richnessWeights(0);
    this.expr = 0;
    this.rotated = false;
    this.detector.reset();
  }

  // ───────────── input sources ─────────────
  /** Switching sources always silences, disarms and forgets old input. */
  setSource(source) {
    if (source === this.source) return;
    this.source = source;
    this.disarm('Input source changed.');
    this._resetInput();
    this.calib = { state: 'none', text: '' };
    this.cal = source === 'demo' ? { ...DEMO_CAL } : { ...M.NO_CAL };
    if (source === 'demo') this.calib = { state: 'done', text: 'Laptop Demo uses preset values; no calibration needed.' };
  }

  setConnected(connected, reason) {
    if (connected === this.connected) return;
    this.connected = connected;
    if (!connected) {
      this.disarm(reason || 'Phone connection lost. Reconnect, then Arm again.');
      this._resetInput();
      if (this.calib.state === 'running') this.calib = { state: 'none', text: '' };
    } else this.detector.reset();
  }

  setPhoneStatus({ sensors, hidden }) {
    this.phoneSensors = sensors;
    if (hidden && !this.phoneHidden) this.disarm('The phone page was hidden or the phone locked. Open it again, then Arm.');
    this.phoneHidden = hidden;
  }

  // ───────────── state changes ─────────────
  /** Returns '' when armed, otherwise the reason it cannot arm. */
  arm() {
    if (this.panic) return 'Muted by Panic. Press Start Audio on the laptop first, then Arm.';
    if (this.source === 'none') return 'Connect the phone or turn on Laptop Demo first.';
    if (this.source === 'phone') {
      if (!this.connected) return 'Connect the phone first.';
      if (this.phoneSensors !== 'active') return 'Enable Sensors on the phone first.';
      if (this.calib.state !== 'done') return this.calib.state === 'needed' ? this.calib.text : 'Calibrate first.';
    }
    this.armed = true;
    this.disarmReason = '';
    this.detector.reset();
    return '';
  }

  disarm(reason = 'Disarmed.') {
    if (this.armed) this.disarmReason = reason;
    this.armed = false;
    this.expr = 0;
  }

  triggerPanic() {
    this.panic = true;
    this.disarm('Muted by Panic. Press Start Audio, then Arm again.');
  }

  setAudio(on) {
    this.audioOn = on;
    if (on) this.panic = false; // Start Audio is the explicit way out of Panic
    if (!on) this.expr = 0;
  }

  /** Switch mapping; each mapping has its own natural expression default. */
  setMapping(mapping) {
    if (mapping === this.mapping) return;
    this.mapping = mapping;
    this.exprSource = mapping === 'tilt' ? 'sustain' : 'movement';
    this.expr = 0;
    this.detector.reset();
  }

  setExprSource(src) {
    this.exprSource = src;
  }

  setExprLevel(v) {
    if (Number.isFinite(v)) this.exprLevel = Math.min(1, Math.max(0, v));
  }

  /** Pitch lock: hz is clamped to a sensible range; returns the value used. */
  setLock(on, hz = this.lock.hz) {
    const v = Number(hz);
    this.lock = { on: !!on, hz: Number.isFinite(v) ? Math.min(LOCK_MAX_HZ, Math.max(LOCK_MIN_HZ, v)) : this.lock.hz };
    if (this.lock.on) this.note = null;
    return this.lock.hz;
  }

  /** Lock richness: keep the current harmonic recipe while lean changes. */
  setRichLock(on) {
    this.richLock = !!on;
  }

  /** Is the sideways-lean gesture actually available right now? */
  get sideAvailable() {
    if (this.source === 'demo') return true;
    if (this.source !== 'phone' || !this.cal.done) return false;
    return !!this.cal.sideAvailable && this.input !== null && Array.isArray(this.input.up);
  }

  setMode(mode) {
    this.mode = mode;
    this.expr = 0;
    this.detector.reset();
  }

  // ───────────── calibration ─────────────
  startCalibration(now) {
    if (this.source !== 'phone' || !this.connected) return 'Connect the phone first.';
    if (this.phoneSensors !== 'active') return 'Enable Sensors on the phone first.';
    this.disarm('Calibrating.');
    this.calib = { state: 'running', text: 'Hold your phone comfortably and stay still…', t0: now, samples: [] };
    return '';
  }

  _calibTick(now) {
    const c = this.calib;
    if (c.state !== 'running') return;
    const el = now - c.t0;
    if (el < CAL_READY_MS) c.text = `Get into the start position: portrait, screen facing you, tilted back slightly, level… ${Math.ceil((CAL_READY_MS - el) / 1000)}`;
    else if (el < CAL_READY_MS + CAL_MEASURE_MS) c.text = `Measuring stillness… ${Math.ceil((CAL_READY_MS + CAL_MEASURE_MS - el) / 1000) || 1}`;
    else {
      const r = M.calibrateFromSamples(c.samples);
      if (r.error) this.calib = { state: 'failed', text: `Calibration failed: ${r.error}` };
      else {
        this.cal = r;
        this.rotated = false;
        this.detector.reset();
        this.calib = {
          state: 'done',
          text: r.sideAvailable
            ? `Calibration complete. This position is now neutral: pitch in the middle, pure tone (fundamental only).${r.hold && r.hold.level === 'warn' ? ` Note: ${r.hold.text}` : ''} Stillness noise ${r.noise.toFixed(2)} m/s².`
            : `Calibration complete for pitch. Sideways lean is not available on this phone, so the tone stays pure (fundamental only); use the Movement intensity mapping for harmonics. Stillness noise ${r.noise.toFixed(2)} m/s².`,
        };
      }
    }
  }

  // ───────────── input ─────────────
  /**
   * A validated sample (from the phone or Laptop Demo). receiptMs is the
   * laptop time it arrived. Returns { accent } when a sharp movement fired.
   */
  ingest(s, receiptMs) {
    if (this.source === 'none') return {};
    // Repeat/out-of-order samples are ignored.
    if (this.input && s.seq <= this.input.seq && s.t <= this.input.t) return {};
    const gap = receiptMs - this.lastReceipt;
    if (gap > M.STALE_MS) this.detector.reset(); // never fire on the first sample after a gap
    this.lastReceipt = receiptMs;
    const prevT = this.input ? this.input.t : null;
    this.input = s;

    if (this.calib.state === 'running' && receiptMs - this.calib.t0 >= CAL_READY_MS) {
      this.calib.samples.push({ tilt: s.tilt, up: s.up, lin: s.lin, jerk: s.jerk, screen: s.screen });
    }
    // Rotating the phone to a new screen orientation changes what "tilt"
    // means, so the old calibration no longer applies.
    if (this.source === 'phone' && this.cal.done && s.screen !== this.cal.screen && !this.rotated) {
      this.rotated = true;
      this.calib = { state: 'needed', text: 'The phone was rotated. Turn it back, or Recalibrate in the new position.' };
      this.disarm('The phone was rotated. Recalibrate before arming.');
    } else if (this.rotated && s.screen === this.cal.screen) {
      this.rotated = false;
      this.calib = { state: 'done', text: 'Phone back in its calibrated position.' };
    }

    const dt = prevT === null ? 0.04 : Math.min(0.3, Math.max(0, (s.t - prevT) / 1000));
    // While playing, leaning is the gesture, so only flag flat/past-upright/
    // upside-down positions; before calibration, also flag leaning.
    this.hold = Array.isArray(s.up) ? M.holdCheck(s.up, { ignoreLean: this.cal.done && this.calib.state !== 'running' }) : null;
    if (Array.isArray(s.up) && this.cal.done && this.cal.up0) {
      // Orientation-relative gestures from the phone's own "up" direction.
      const g = M.relativeGestures(s.up, this.cal.up0);
      const pitch = this.settings.invertTilt ? -g.pitch : g.pitch;
      this.tiltRel = this.tiltRel === null ? pitch : M.smooth(this.tiltRel, pitch, dt, 0.08);
      this.sideRel = this.sideRel === null ? g.lean : M.smooth(this.sideRel, g.lean, dt, 0.1);
    } else {
      // No orientation vector (older phone page or gravity-only fallback):
      // pitch from beta as before, no sideways lean.
      if (Number.isFinite(s.tilt) && this.cal.done) {
        const rel = M.relativeTilt(s.tilt, this.cal.neutral, this.settings.invertTilt);
        this.tiltRel = this.tiltRel === null ? rel : M.smooth(this.tiltRel, rel, dt, 0.08);
      }
      this.sideRel = null;
    }
    this.intensity = M.intensityToUnit(s.lin, this.cal, this.settings);
    this.recentPeaks.push([s.t, this.intensity]);
    while (this.recentPeaks.length && this.recentPeaks[0][0] < s.t - 150) this.recentPeaks.shift();

    let accent = false;
    if (Number.isFinite(s.jerk)) {
      const fired = this.detector.update(s.t, s.jerk, this.cal, this.settings);
      if (fired && this.mode === 'accents' && this.soundAllowed(receiptMs).ok) {
        this._updatePitch();
        if (this.mapping === 'intensity') {
          const peak = Math.max(...this.recentPeaks.map((p) => p[1]));
          this.count = M.stableHarmonicCount(M.unitToHarmonicValue(peak), null);
          this.weights = M.countWeights(this.count);
        } else if (!this.richLock) {
          this.richness = M.leanToRichness(this.sideRel, this.settings.deadZone, this.settings.sideRange);
          this.weights = M.richnessWeights(this.richness);
        }
        this.hits++;
        accent = true;
      }
    }
    return { accent };
  }

  _updatePitch() {
    // Pitch lock wins over tilt and over Pentatonic: the locked value is
    // exactly what is shown and what is played.
    if (this.lock.on) {
      this.f0 = this.lock.hz;
      this.note = null;
      return;
    }
    if (this.tiltRel === null) return;
    const fc = M.unitToPitch(M.tiltToUnit(this.tiltRel));
    if (this.pitchMode === 'pentatonic') {
      this.note = M.stablePentatonic(fc, this.note);
      this.f0 = M.semisToHz(this.note);
    } else {
      this.note = null;
      this.f0 = fc;
    }
  }

  /** Why sound is or is not allowed right now. */
  soundAllowed(now) {
    if (this.panic) return { ok: false, reason: 'Muted by Panic' };
    if (!this.audioOn) return { ok: false, reason: 'Audio is off' };
    if (this.source === 'none') return { ok: false, reason: 'No input' };
    if (this.source === 'phone' && !this.connected) return { ok: false, reason: 'Phone not connected' };
    if (this.source === 'phone' && this.phoneHidden) return { ok: false, reason: 'Phone page hidden' };
    if (!this.armed) return { ok: false, reason: 'Not armed' };
    if (now - this.lastReceipt > M.STALE_MS) return { ok: false, reason: 'No sensor data for 0.5 s' };
    return { ok: true, reason: '' };
  }

  /**
   * Advance by dt seconds at laptop time now (ms). Returns the parameters to
   * apply and whether sound must be silenced.
   */
  tick(now, dt) {
    this._calibTick(now);
    // Long silence from the phone: disarm so it cannot resume by surprise.
    if (this.armed && this.source === 'phone' && now - this.lastReceipt > M.DISARM_AFTER_MS) {
      this.disarm('No sensor data for 3 seconds. Check the phone, then Arm again.');
    }
    const allowed = this.soundAllowed(now);
    if (this.input && this.cal.done) {
      this._updatePitch(); // in Accents: the pitch the NEXT note will use
      if (this.mapping === 'intensity') {
        if (this.mode === 'flow') {
          this.hSmooth = M.smooth(this.hSmooth, this.intensity, dt, M.FLOW.harmonicTau);
          this.count = M.stableHarmonicCount(M.unitToHarmonicValue(this.hSmooth), this.count);
          this.weights = M.countWeights(this.count);
        }
      } else {
        if (!this.richLock) {
          const target = M.leanToRichness(this.sideRel, this.settings.deadZone, this.settings.sideRange);
          this.richness = M.smooth(this.richness, target, dt, 0.08);
          if (this.richness < 0.002 && target === 0) this.richness = 0; // settle exactly on a pure tone
        }
        if (this.mode === 'flow') this.weights = M.richnessWeights(this.richness);
      }
    } else if (this.lock.on) this.f0 = this.lock.hz;
    if (this.mode === 'flow') {
      const level = this.exprSource === 'sustain' ? this.exprLevel : this.intensity;
      const target = allowed.ok ? level : 0;
      this.expr = M.flowEnvelope(this.expr, target, dt);
      if (target === 0 && this.expr < 0.003) this.expr = 0;
    } else this.expr = 0;
    return { allowed, f0: this.f0, count: this.count, weights: this.weights, expr: this.expr };
  }
}

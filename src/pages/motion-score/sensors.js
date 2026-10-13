// Phone-side sensor processing (runs on the Controller page).
// Pure logic, unit-tested in test/motion-sensors.test.js. The browser event
// handlers in controller.js only copy numbers out of the events into here.
//
// Two quantities are computed at the full sensor rate (often 60 Hz) and then
// sent to the laptop about 25 times per second:
//
//   tilt  – forward/back tilt in degrees (DeviceOrientationEvent.beta). The
//           browser computes orientation by combining the phone's motion
//           sensors; an accelerometer alone cannot measure it reliably.
//   lin   – size of the phone's acceleration with gravity removed, in m/s²,
//           smoothed over about 0.12 s ("movement intensity").
//   jerk  – how fast that acceleration is changing, in m/s³ (peak value since
//           the last message), used to detect sharp accents.

export const GRAVITY_TAU = 0.5; // s, low-pass filter that estimates gravity
export const LIN_TAU = 0.12; // s, smoothing of movement intensity
export const JERK_TAU = 0.03; // s, light smoothing of jerk
export const MAX_ACCEL = 100; // m/s²; larger readings are treated as glitches
export const GAP_SEC = 0.25; // longer gaps between events reset the filters

const finite3 = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const mag = (v) => Math.hypot(v.x, v.y, v.z);
const alpha = (dt, tau) => 1 - Math.exp(-dt / tau);

/** Wrap any angle to [-180, 180). */
export function wrapDeg(a) {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

export class MotionFeatures {
  constructor() {
    this.reset();
    this.motionEvents = 0;
    this.orientEvents = 0;
  }

  /** Forget filter state (after a gap, a calibration, or a reconnect). */
  reset() {
    this.gravity = null;
    this.prevLin = null;
    this.prevT = null;
    this.lin = null; // smoothed |linear acceleration|, m/s²
    this.linSrc = null;
    this.jerk = 0; // smoothed jerk, m/s³
    this.jerkPeak = 0;
    this.tilt = null;
    this.tiltSrc = null;
    this.lastOrientT = -Infinity;
    this.invalid = 0;
  }

  /**
   * One DeviceMotionEvent. tMs is the event time in ms (event.timeStamp).
   * acc = event.acceleration (gravity already removed by the browser) and
   * accG = event.accelerationIncludingGravity; either may be null.
   */
  onMotion(tMs, acc, accG) {
    this.motionEvents++;
    const dt = this.prevT === null ? null : (tMs - this.prevT) / 1000;
    if (dt !== null && dt <= 0) return; // duplicate or out-of-order event
    if (dt !== null && dt > GAP_SEC) {
      // Long gap: old filter state no longer describes the phone's motion.
      const keepTilt = [this.tilt, this.tiltSrc, this.lastOrientT];
      this.reset();
      [this.tilt, this.tiltSrc, this.lastOrientT] = keepTilt;
    }
    const step = this.prevT === null ? null : (tMs - this.prevT) / 1000;
    this.prevT = tMs;

    let lin = null;
    let src = null;
    if (finite3(acc) && mag(acc) <= MAX_ACCEL) {
      lin = { x: acc.x, y: acc.y, z: acc.z };
      src = 'sensor';
    } else if (finite3(accG) && mag(accG) <= MAX_ACCEL) {
      // No gravity-free reading: estimate gravity as the slowly changing part
      // of the signal (low-pass filter) and subtract it. An approximation.
      if (!this.gravity || step === null) this.gravity = { x: accG.x, y: accG.y, z: accG.z };
      else {
        const a = alpha(step, GRAVITY_TAU);
        this.gravity.x += (accG.x - this.gravity.x) * a;
        this.gravity.y += (accG.y - this.gravity.y) * a;
        this.gravity.z += (accG.z - this.gravity.z) * a;
      }
      lin = { x: accG.x - this.gravity.x, y: accG.y - this.gravity.y, z: accG.z - this.gravity.z };
      src = 'estimated';
      // Without orientation events, approximate forward/back tilt from gravity.
      if (tMs - this.lastOrientT > 1000) {
        const g = this.gravity;
        this.tilt = wrapDeg((Math.atan2(g.y, g.z) * 180) / Math.PI);
        this.tiltSrc = 'gravity';
      }
    } else {
      if (acc || accG) this.invalid++;
      return;
    }
    this.linSrc = src;

    const m = mag(lin);
    if (this.lin === null || step === null) this.lin = m;
    else this.lin += (m - this.lin) * alpha(step, LIN_TAU);

    if (this.prevLin && step) {
      const j = Math.hypot(lin.x - this.prevLin.x, lin.y - this.prevLin.y, lin.z - this.prevLin.z) / step;
      this.jerk += (j - this.jerk) * alpha(step, JERK_TAU);
      if (this.jerk > this.jerkPeak) this.jerkPeak = this.jerk;
    }
    this.prevLin = lin;
  }

  /** One DeviceOrientationEvent: beta = forward/back tilt in degrees. */
  onOrientation(tMs, beta) {
    this.orientEvents++;
    if (!Number.isFinite(beta)) return;
    this.tilt = wrapDeg(beta);
    this.tiltSrc = 'orientation';
    this.lastOrientT = tMs;
  }

  /** Values for the next message; resets the jerk peak. */
  take() {
    const out = {
      tilt: this.tilt === null ? null : Math.round(this.tilt * 100) / 100,
      tiltSrc: this.tilt === null ? null : this.tiltSrc,
      lin: this.lin === null ? null : Math.min(200, Math.round(this.lin * 1000) / 1000),
      linSrc: this.lin === null ? null : this.linSrc,
      jerk: this.lin === null ? null : Math.min(100000, Math.round(this.jerkPeak * 10) / 10),
    };
    this.jerkPeak = this.jerk;
    return out;
  }
}

/** Counts events per second over a sliding one-second window. */
export class RateMeter {
  constructor() {
    this.times = [];
  }

  tick(tMs) {
    this.times.push(tMs);
    while (this.times.length && this.times[0] < tMs - 1000) this.times.shift();
  }

  rate(nowMs) {
    while (this.times.length && this.times[0] < nowMs - 1000) this.times.shift();
    return this.times.length;
  }
}

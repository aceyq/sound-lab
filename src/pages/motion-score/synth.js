// Web Audio instrument for Motion Score.
//
// Signal path (created by Start Audio, closed when the page unmounts):
//
//   osc A (PeriodicWave, N harmonics) → xfade A ┐
//   osc B (PeriodicWave, N' harmonics) → xfade B ┴→ expression → master volume → mute → analyser → speakers
//                                                                                     (MEASUREMENT POINT)
//
// Each oscillator plays ONE periodic waveform built from harmonic components
// 1…N (component 1 is the fundamental) with amplitudes (1/n) ÷ Σ(1/k), all
// sine terms starting at phase 0. Because the harmonics live inside a single
// waveform, they are always exactly n × f0 and can never drift out of phase.
// When the harmonic count changes, the idle oscillator gets the new waveform
// and the two crossfade over 40 ms. Both oscillators started at the same
// instant and always receive identical frequency changes, so they stay in
// phase with each other too.
//
// The analyser sits after Expression, Master Volume and Mute: the graphs
// show what actually goes to the speakers.

import { H_MAX, harmonicAmplitudes, ACCENT } from './mapping.js';

const XFADE = 0.04;
const STOP_FADE = 0.06;
const SILENCE_TC = 0.025; // ≈ 0.1 s to silence
const PITCH_TC = { continuous: 0.05, pentatonic: 0.015 };

function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
}

function rampTo(ctx, param, value, tc) {
  const t = ctx.currentTime;
  holdAt(param, t);
  param.setTargetAtTime(value, t, tc);
}

export class MotionSynth {
  constructor({ masterVolume = 0.15 } = {}) {
    this.ctx = null;
    this.masterVolume = masterVolume;
    this.state = 'off'; // off | starting | on | panic
    this.f0 = 220;
    this.count = 1;
    this.voices = null;
    this.closed = false;
    this.waves = new Map();
    this.accentsPlayed = 0;
  }

  get running() {
    return this.state === 'on' && !!this.voices;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  _context() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser does not support the Web Audio API.');
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.mute = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0;
    this.master.connect(this.mute).connect(this.analyser).connect(ctx.destination);
    return ctx;
  }

  _wave(count) {
    const nyq = this.sampleRate / 2;
    const { amps, audible } = harmonicAmplitudes(count, this.f0, nyq);
    const key = audible;
    if (!this.waves.has(key)) {
      const real = new Float32Array(H_MAX + 1);
      const imag = new Float32Array(H_MAX + 1);
      amps.forEach((a, i) => { imag[i + 1] = a; }); // sine terms, phase 0
      this.waves.set(key, this.ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
    }
    return { wave: this.waves.get(key), audible };
  }

  /** Start Audio (needs a click). Also the only way out of Panic. */
  async start() {
    if (this.closed || this.state === 'on' || this.state === 'starting') return;
    const ctx = this._context();
    this.state = 'starting';
    try { await ctx.resume(); } catch { /* closed meanwhile */ }
    if (this.closed || this.state !== 'starting') return;
    this._teardown(0);
    const t = ctx.currentTime;
    this.mute.gain.cancelScheduledValues(t);
    this.mute.gain.setValueAtTime(1, t);
    const expr = ctx.createGain();
    expr.gain.value = 0; // silent until movement opens it
    expr.connect(this.master);
    const t0 = t + 0.02;
    const { wave, audible } = this._wave(this.count);
    const mk = (g) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = this.f0;
      const x = ctx.createGain();
      x.gain.value = g;
      o.connect(x).connect(expr);
      o.start(t0);
      return { o, x };
    };
    this.voices = { a: mk(1), b: mk(0), active: 'a', expr, audible, t0 };
    this.state = 'on';
  }

  /** Stop Audio: short fade, then release everything. */
  stop() {
    if (this.state !== 'on' && this.state !== 'starting') return;
    this.state = 'off';
    this._teardown(STOP_FADE);
    this._suspendLater(STOP_FADE + 0.05);
  }

  /** Mute / Panic: silent within 5 ms and latched until Start Audio. */
  panic() {
    this.state = 'panic';
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    holdAt(this.mute.gain, t);
    this.mute.gain.linearRampToValueAtTime(0, t + 0.005);
    this._teardown(0.005);
    this._suspendLater(0.05);
  }

  _suspendLater(sec) {
    clearTimeout(this.suspendTimer);
    const ctx = this.ctx;
    this.suspendTimer = setTimeout(() => {
      if (!this.closed && this.state !== 'on' && this.state !== 'starting' && ctx.state === 'running') ctx.suspend().catch(() => {});
    }, sec * 1000);
  }

  _teardown(fadeSec) {
    const v = this.voices;
    if (!v) return;
    this.voices = null;
    const t = this.ctx.currentTime;
    holdAt(v.expr.gain, t);
    v.expr.gain.linearRampToValueAtTime(0, t + Math.max(0.003, fadeSec));
    for (const { o } of [v.a, v.b]) {
      try { o.stop(Math.max(t + fadeSec + 0.02, v.t0)); } catch { /* already stopped */ }
      o.onended = () => o.disconnect();
    }
    setTimeout(() => {
      try {
        v.expr.disconnect();
        v.a.x.disconnect();
        v.b.x.disconnect();
      } catch { /* context closed */ }
    }, (fadeSec + 0.2) * 1000);
  }

  setMasterVolume(v) {
    this.masterVolume = v;
    if (this.ctx) rampTo(this.ctx, this.master.gain, v, 0.02);
  }

  /** Fundamental frequency; both oscillators get the same change. */
  setPitch(f0, mode = 'continuous', { instant = false } = {}) {
    this.f0 = f0;
    const v = this.voices;
    if (!v) return;
    const t = this.ctx.currentTime;
    for (const { o } of [v.a, v.b]) {
      holdAt(o.frequency, t);
      if (instant) o.frequency.linearRampToValueAtTime(f0, t + 0.005);
      else o.frequency.setTargetAtTime(f0, t, PITCH_TC[mode] || PITCH_TC.continuous);
    }
    // Harmonics at or above Nyquist are excluded: rebuild if that changes.
    if (harmonicAmplitudes(this.count, f0, this.sampleRate / 2).audible !== v.audible) this._swapWave();
  }

  /** Harmonic components including the fundamental, 1…12. */
  setHarmonicCount(n) {
    if (n === this.count) return;
    this.count = n;
    if (this.voices) this._swapWave();
  }

  _swapWave() {
    const v = this.voices;
    const { wave, audible } = this._wave(this.count);
    v.audible = audible;
    const from = v[v.active];
    const toKey = v.active === 'a' ? 'b' : 'a';
    const to = v[toKey];
    const t = this.ctx.currentTime;
    to.o.setPeriodicWave(wave);
    holdAt(to.x.gain, t);
    to.x.gain.linearRampToValueAtTime(1, t + XFADE);
    holdAt(from.x.gain, t);
    from.x.gain.linearRampToValueAtTime(0, t + XFADE);
    v.active = toKey;
  }

  /** Flow: follow the expression envelope (0…1) smoothly. */
  setExpression(level, tc = 0.03) {
    if (!this.voices) return;
    rampTo(this.ctx, this.voices.expr.gain, Math.max(0, Math.min(1, level)), tc);
  }

  /**
   * Accents: one short note. Attack 15 ms to a fixed peak, then an
   * exponential decay that is forced to 0 at 450 ms. A new hit restarts the
   * envelope from wherever it is (retrigger), so gain never accumulates. The
   * whole envelope is scheduled at once, so the note ends by itself even if
   * the phone disconnects.
   */
  triggerAccent() {
    if (!this.voices) return false;
    const g = this.voices.expr.gain;
    const t = this.ctx.currentTime;
    holdAt(g, t);
    g.linearRampToValueAtTime(ACCENT.peak, t + ACCENT.attack);
    g.setTargetAtTime(0, t + ACCENT.attack, ACCENT.decayTc);
    g.setValueAtTime(0, t + ACCENT.length);
    this.accentsPlayed++;
    return true;
  }

  /** Fade to silence quickly and cancel any pending accent envelope. */
  silence() {
    if (!this.voices) return;
    const g = this.voices.expr.gain;
    const t = this.ctx.currentTime;
    holdAt(g, t);
    g.setTargetAtTime(0, t, SILENCE_TC);
    g.setValueAtTime(0, t + 0.15); // bounded: fully silent within 150 ms
  }

  get exprGain() {
    return this.voices ? this.voices.expr.gain.value : 0;
  }

  close() {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    clearTimeout(this.suspendTimer);
    this.state = 'off';
    if (!this.ctx) return Promise.resolve();
    try { this._teardown(0.01); } catch { /* ignore */ }
    return this.ctx.close().catch(() => {});
  }
}

// Web Audio instrument for Motion Score: additive synthesis.
//
// Signal path (created by Start Audio, closed when the page unmounts):
//
//   sine osc 1·f0 → gain a₁ ┐
//   sine osc 2·f0 → gain a₂ ┤
//        …                  ├→ expression → master volume → mute → analyser → speakers
//   sine osc 12·f0 → gain a₁₂┘                                   (MEASUREMENT POINT)
//
// The sound really is a sum of 12 sine waves (harmonic components; component
// 1 is the fundamental). All twelve oscillators start at the same instant
// with phase 0 and keep running until Stop / Panic, so nothing is created or
// destroyed while you play (no stuck notes). Every pitch change is applied to
// every oscillator as the same smooth ramp scaled by n, so harmonic n is
// always exactly n × f0 and the phases never drift apart.
//
// The gains aₙ come from mapping.harmonicMix(): the 1/n recipe, faded by
// harmonic richness, times one shared normalization factor. Each gain glides
// to its new value (≈40 ms), so harmonics fade in and out smoothly.
//
// The analyser sits after Expression, Master Volume and Mute: the graphs
// show what actually goes to the speakers.

import { H_MAX, harmonicMix, ACCENT } from './mapping.js';

const GAIN_TC = 0.04;
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
    this.weights = [1, ...new Array(H_MAX - 1).fill(0)];
    this.mix = harmonicMix(this.weights, this.f0, 24000);
    this.voices = null;
    this.closed = false;
    this.accentsPlayed = 0;
    this.liveOscillators = 0;
  }

  get running() {
    return this.state === 'on' && !!this.voices;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  get nyquist() {
    return this.sampleRate / 2;
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
    this.mix = harmonicMix(this.weights, this.f0, this.nyquist);
    return ctx;
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
    expr.gain.value = 0; // silent until allowed
    expr.connect(this.master);
    const t0 = t + 0.02;
    this.mix = harmonicMix(this.weights, this.f0, this.nyquist);
    const oscs = [];
    const gains = [];
    for (let n = 1; n <= H_MAX; n++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = n * this.f0;
      const g = ctx.createGain();
      g.gain.value = this.mix.output[n - 1];
      o.connect(g).connect(expr);
      o.start(t0);
      this.liveOscillators++;
      o.onended = () => { this.liveOscillators--; o.disconnect(); };
      oscs.push(o);
      gains.push(g);
    }
    this.voices = { oscs, gains, expr, t0 };
    this.state = 'on';
  }

  /** Stop Audio: short fade, then release every oscillator. */
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
    for (const o of v.oscs) {
      try { o.stop(Math.max(t + fadeSec + 0.02, v.t0)); } catch { /* already stopped */ }
    }
    setTimeout(() => {
      try {
        v.expr.disconnect();
        for (const g of v.gains) g.disconnect();
      } catch { /* context closed */ }
    }, (fadeSec + 0.2) * 1000);
  }

  setMasterVolume(v) {
    this.masterVolume = v;
    if (this.ctx) rampTo(this.ctx, this.master.gain, v, 0.02);
  }

  /** Fundamental frequency: every harmonic moves with it (n × f0). */
  setPitch(f0, mode = 'continuous', { instant = false } = {}) {
    // Same pitch as last time: leave the running glide alone so it settles
    // exactly on n × f0 (re-anchoring every tick can stall it slightly short).
    if (!instant && this.voices && f0 === this.f0) return;
    const changedNyquistSet = this.ctx && this.mix.recipe.some((a, i) => ((i + 1) * f0 < this.nyquist) !== ((i + 1) * this.f0 < this.nyquist));
    this.f0 = f0;
    const v = this.voices;
    if (!v) return;
    const t = this.ctx.currentTime;
    v.oscs.forEach((o, i) => {
      holdAt(o.frequency, t);
      if (instant) o.frequency.linearRampToValueAtTime((i + 1) * f0, t + 0.005);
      else o.frequency.setTargetAtTime((i + 1) * f0, t, PITCH_TC[mode] || PITCH_TC.continuous);
    });
    // Harmonics at or above Nyquist are excluded: re-mix if that set changed.
    if (changedNyquistSet) this.setWeights(this.weights, true);
  }

  /**
   * How much of each harmonic is on (12 values, 0..1). Gains glide to the
   * new mix; small changes are skipped so the peak calculation stays cheap.
   */
  setWeights(weights, force = false) {
    if (!force && weights.every((w, i) => Math.abs(w - this.weights[i]) < 0.002)) return;
    this.weights = weights.slice();
    this.mix = harmonicMix(this.weights, this.f0, this.nyquist);
    const v = this.voices;
    if (!v) return;
    v.gains.forEach((g, i) => rampTo(this.ctx, g.gain, this.mix.output[i], GAIN_TC));
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

  /** Current gains actually on the oscillators (after their glide). */
  liveGains() {
    return this.voices ? this.voices.gains.map((g) => g.gain.value) : this.mix.output.slice();
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

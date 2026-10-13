// Additive-synthesis audio engine for the Frequency Playground page.
//
// Signal path (one per page; closed when the page unmounts):
//
//   voice osc(fᵢ) → voice gain(Aᵢ) ┐
//   voice osc(fⱼ) → voice gain(Aⱼ) ┼→ session fade → normalization gain ─┬→ analyser   (plots: BEFORE master volume)
//   ...                            ┘                                      └→ master gain → speakers
//
// The analyser taps the mixture after normalization and before Master Volume,
// which is the same signal the waveform plot calculates.

const RAMP_TC = 0.015; // time constant for smooth gain changes (s)
const FADE = 0.03; // start/stop fade length (s)

function rampTo(ctx, param, value, tc = RAMP_TC) {
  const t = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
  param.setTargetAtTime(value, t, tc);
}

export class AudioEngine {
  constructor({ masterVolume = 0.18, fftSize = 8192 } = {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API not available');
    // Created suspended (no user gesture yet); resumed by Play. Creating it
    // early tells us the real sample rate, which sets the Nyquist limit.
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.normGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0; // each frame is a true snapshot
    this.master = this.ctx.createGain();
    this.master.gain.value = masterVolume;
    this.normGain.connect(this.analyser);
    this.normGain.connect(this.master);
    this.master.connect(this.ctx.destination);

    this.session = null;
    this.desired = [];
    this.norm = 1;
    this.closed = false;
    this.liveOscillators = 0;
    this.createdOscillators = 0;
    this.sessionsStarted = 0;
  }

  get sampleRate() {
    return this.ctx.sampleRate;
  }

  get isPlaying() {
    return !!this.session;
  }

  /** True once the oscillators have actually started sounding. */
  get started() {
    return !!(this.session && this.session.fade && this.ctx.currentTime >= this.session.t0);
  }

  /** Seconds since the shared phase reference t0, or null when stopped. */
  get playTime() {
    return this.session && this.session.fade ? this.ctx.currentTime - this.session.t0 : null;
  }

  async play(comps, norm) {
    if (this.session || this.closed) return;
    this.desired = comps;
    this.norm = norm;
    const session = { voices: new Map(), fade: null, t0: 0 };
    this.session = session; // claim before awaiting, so double clicks cannot start twice
    try {
      await this.ctx.resume();
    } catch {
      /* resume can reject if the context closed meanwhile */
    }
    if (this.session !== session || this.closed) return; // stopped while resuming

    const ctx = this.ctx;
    const now = ctx.currentTime;
    // All initial oscillators start at the same instant t0, so each one is
    // sin(2π fᵢ (t − t0)): exactly the phase-0 formula the plot uses.
    const t0 = now + 0.05;
    session.t0 = t0;
    const fade = ctx.createGain();
    fade.gain.setValueAtTime(0, now);
    fade.gain.setValueAtTime(0, t0);
    fade.gain.linearRampToValueAtTime(1, t0 + FADE);
    fade.connect(this.normGain);
    session.fade = fade;
    this.setNorm(this.norm);
    for (const c of this.desired) this._addVoice(session, c, t0, false);
    this.sessionsStarted++;
  }

  stop() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (!s.fade) return; // never got past resume()
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = s.fade.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
    }
    g.linearRampToValueAtTime(0, t + FADE + 0.01);
    for (const v of s.voices.values()) v.osc.stop(t + FADE + 0.03);
    s.voices.clear();
    // Voices disconnect themselves on 'ended'; release the fade node after.
    setTimeout(() => s.fade.disconnect(), 300);
  }

  /** Reconcile running oscillators with the component table. */
  sync(comps, norm) {
    this.desired = comps;
    this.setNorm(norm);
    const s = this.session;
    if (!s || !s.fade) return;
    const ids = new Set(comps.map((c) => c.id));
    for (const [id, v] of s.voices) {
      if (!ids.has(id)) {
        this._retire(v);
        s.voices.delete(id);
      }
    }
    for (const c of comps) {
      const v = s.voices.get(c.id);
      const target = c.enabled ? c.amp : 0;
      if (!v) {
        this._addVoice(s, c, this._alignedStart(s, c.freq), true);
      } else if (v.freq !== c.freq) {
        // A new oscillator, started on a whole number of periods after t0,
        // keeps this component's phase consistent with the formula. The old
        // one fades out while the new one fades in.
        this._retire(v);
        s.voices.delete(c.id);
        this._addVoice(s, c, this._alignedStart(s, c.freq), true);
      } else if (v.target !== target) {
        rampTo(this.ctx, v.g.gain, target);
        v.target = target;
      }
    }
  }

  setNorm(norm) {
    this.norm = norm;
    rampTo(this.ctx, this.normGain.gain, norm);
  }

  setMaster(volume) {
    rampTo(this.ctx, this.master.gain, volume, 0.02);
  }

  setFftSize(n) {
    this.analyser.fftSize = n;
  }

  close() {
    this.stop();
    this.closed = true;
    this.normGain.disconnect();
    this.master.disconnect();
    return this.ctx.close().catch(() => {});
  }

  debugInfo() {
    const s = this.session;
    return {
      contextState: this.ctx.state,
      sampleRate: this.ctx.sampleRate,
      playing: this.isPlaying,
      started: this.started,
      norm: this.norm,
      master: this.master.gain.value,
      liveOscillators: this.liveOscillators,
      createdOscillators: this.createdOscillators,
      sessionsStarted: this.sessionsStarted,
      voices: s ? [...s.voices.values()].map((v) => ({ id: v.id, freq: v.osc.frequency.value, target: v.target })) : [],
    };
  }

  _alignedStart(s, f) {
    const earliest = Math.max(this.ctx.currentTime + 0.02, s.t0);
    const k = Math.ceil((earliest - s.t0) * f);
    return s.t0 + k / f;
  }

  _addVoice(s, c, startAt, rampIn) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = c.freq;
    const g = ctx.createGain();
    const target = c.enabled ? c.amp : 0;
    if (rampIn) {
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(target, startAt + 0.02);
    } else {
      g.gain.value = target;
    }
    osc.connect(g);
    g.connect(s.fade);
    osc.start(startAt);
    this.liveOscillators++;
    this.createdOscillators++;
    osc.onended = () => {
      this.liveOscillators--;
      osc.disconnect();
      g.disconnect();
    };
    const v = { id: c.id, freq: c.freq, target, osc, g };
    s.voices.set(c.id, v);
    return v;
  }

  _retire(v) {
    const t = this.ctx.currentTime;
    const p = v.g.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
    }
    p.linearRampToValueAtTime(0, t + 0.02);
    v.osc.stop(t + 0.04);
  }
}

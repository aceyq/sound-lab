// Playback for the Vowel Lab: reference tone, the original recording, and the
// harmonic synthesizer built from the sliders. Only one of them sounds at a
// time; starting one stops the others.
//
// Signal path (its own AudioContext, created on the first click, closed on unmount):
//
//   reference tone  : 3 sines (f, 2f, 3f) → tone gain ─────────────┐
//   original        : AudioBufferSource(recording) → level gain ───┼→ volume → speakers
//   synthesized     : osc(n·f0) → gain(Aₙ) … → fade → peak gain ───┘
//
// The synthesized sound is Σ Aₙ sin(2π n f0 t), with every phase 0 at its
// start, scaled so its peak is OUTPUT_PEAK (the same as the WAV export).
// It is generated from the slider values; it never replays the recording.
import { outputGain, OUTPUT_PEAK, peakAbs } from './vowel-model.js';

const TC = 0.02; // smoothing time constant for slider and fundamental changes (s)
const FADE = 0.03; // start/stop fade (s)
export const REF_LEVEL = 0.25; // reference tone peak, before the volume control
const REF_PARTIALS = [[1, 1], [2, 0.3], [3, 0.12]];

export const vowelAudioCounters = { contexts: 0, contextsClosed: 0, live: 0, created: 0 };

export class VowelAudio {
  constructor({ volume = 0.5, onChange = () => {} } = {}) {
    this.volume = volume;
    this.onChange = onChange;
    this.ctx = null;
    this.out = null;
    this.state = 'idle'; // 'idle' | 'ref' | 'original' | 'synth' | 'ab'
    this.abPhase = null; // 'original' | 'gap' | 'synth' during alternate
    this.current = null; // what is sounding: { kind, stop() }
    this.timers = [];
    this.recipe = null; // { f0, amps }
    this.playStarted = 0;
    this.playInfo = null; // { from, duration } for the original playhead
    this.closed = false;
  }

  get playing() {
    return this.state !== 'idle';
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    vowelAudioCounters.contexts++;
    this.out = this.ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(this.ctx.destination);
    return this.ctx;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : null;
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx) ramp(this.ctx, this.out.gain, v, 0.02);
  }

  /** Stops whatever is sounding (with a short fade). */
  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.current) this.current.stop();
    this.current = null;
    this.playInfo = null;
    this.abPhase = null;
    this._set('idle');
  }

  /** Quiet reference tone at `freq` Hz until stop(). */
  async playReference(freq) {
    this.stop();
    const ctx = this._ensure();
    await ctx.resume().catch(() => {});
    if (this.closed) return;
    const t = ctx.currentTime + 0.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(REF_LEVEL / REF_PARTIALS.reduce((s, [, a]) => s + a, 0), t + 0.05);
    g.connect(this.out);
    const nyq = ctx.sampleRate / 2;
    const oscs = REF_PARTIALS.filter(([k]) => k * freq < nyq).map(([k, a]) => {
      const o = ctx.createOscillator();
      o.frequency.value = k * freq;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      this._track(o, [og]);
      o.start(t);
      return o;
    });
    this.current = { kind: 'ref', freq, stop: () => fadeOut(ctx, g, oscs) };
    this._set('ref');
  }

  /**
   * Plays samples[from, to) of a recording once. levelMatch scales its peak to
   * OUTPUT_PEAK, the same peak as the synthesized sound.
   */
  async playOriginal(rec, { from = 0, to = rec.samples.length, levelMatch = true } = {}) {
    this.stop();
    const ctx = this._ensure();
    await ctx.resume().catch(() => {});
    if (this.closed) return;
    const t = ctx.currentTime + 0.02;
    const dur = this._scheduleOriginal(rec, from, to, levelMatch, t);
    this.playInfo = { from: from / rec.sampleRate, duration: dur, startAt: t };
    this._set('original');
    this.timers.push(setTimeout(() => { if (this.state === 'original') this.stop(); }, (dur + 0.1) * 1000));
  }

  /** Plays the synthesized recipe until stop() (or for `duration` s). */
  async playSynth(recipe, { duration = null } = {}) {
    this.stop();
    const ctx = this._ensure();
    await ctx.resume().catch(() => {});
    if (this.closed) return;
    this.recipe = { f0: recipe.f0, amps: [...recipe.amps] };
    const t = ctx.currentTime + 0.02;
    this.current = this._startSynth(t, duration);
    this._set('synth');
    if (duration) this.timers.push(setTimeout(() => { if (this.state === 'synth') this.stop(); }, (duration + 0.15) * 1000));
  }

  /** Original segment, a short gap, then the synthesized sound for the same length. */
  async playAlternate(rec, recipe, { from, to, levelMatch = true, gap = 0.4 } = {}) {
    this.stop();
    const ctx = this._ensure();
    await ctx.resume().catch(() => {});
    if (this.closed) return;
    this.recipe = { f0: recipe.f0, amps: [...recipe.amps] };
    const t = ctx.currentTime + 0.03;
    const dur = this._scheduleOriginal(rec, from, to, levelMatch, t);
    const origStop = this.current;
    this.playInfo = { from: from / rec.sampleRate, duration: dur, startAt: t };
    this.abPhase = 'original';
    this._set('ab');
    const synthAt = t + dur + gap;
    this.timers.push(setTimeout(() => {
      if (this.state !== 'ab') return;
      this.abPhase = 'gap';
      this.playInfo = null;
      this.onChange(this);
    }, (dur + 0.02) * 1000));
    this.timers.push(setTimeout(() => {
      if (this.state !== 'ab') return;
      origStop.stop();
      this.current = this._startSynth(Math.max(synthAt, ctx.currentTime + 0.01), dur);
      this.abPhase = 'synth';
      this.onChange(this);
    }, Math.max(0, (synthAt - ctx.currentTime - 0.05) * 1000)));
    this.timers.push(setTimeout(() => { if (this.state === 'ab') this.stop(); }, (dur * 2 + gap + 0.2) * 1000));
  }

  /** Live slider/fundamental changes while the synthesizer plays (smoothed). */
  updateRecipe(recipe) {
    this.recipe = { f0: recipe.f0, amps: [...recipe.amps] };
    const c = this.current;
    if (!c || c.kind !== 'synth') return;
    const ctx = this.ctx;
    const nyq = ctx.sampleRate / 2;
    const f0 = recipe.f0;
    // Grow the bank if harmonics were added.
    for (let i = c.voices.length; i < recipe.amps.length; i++) c.voices.push(this._voice(c, i + 1, f0, 0, ctx.currentTime));
    c.voices.forEach((v, i) => {
      const freq = v.n * f0;
      const a = i < recipe.amps.length && freq < nyq ? recipe.amps[i] : 0;
      // All harmonics follow the same smoothed path, so they stay exact multiples.
      if (freq < nyq) ramp(ctx, v.osc.frequency, freq, TC);
      ramp(ctx, v.g.gain, a, TC);
    });
    ramp(ctx, c.peak.gain, outputGain(f0, recipe.amps, nyq), TC);
  }

  _scheduleOriginal(rec, from, to, levelMatch, t) {
    const ctx = this.ctx;
    const len = Math.max(1, to - from);
    const buf = ctx.createBuffer(1, len, rec.sampleRate);
    buf.copyToChannel(rec.samples.subarray(from, from + len), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const peak = peakAbs(rec.samples, from, from + len);
    // levelMatch: true → OUTPUT_PEAK; a number → that peak (the Vowel filtering
    // section matches the original to its filtered sound's peak).
    const target = typeof levelMatch === 'number' ? levelMatch : OUTPUT_PEAK;
    const level = levelMatch && peak > 1e-6 ? target / peak : 1;
    const dur = len / rec.sampleRate;
    // 10 ms fades only for listening, so a segment cut mid-wave does not click.
    const f = Math.min(0.01, dur / 4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + f);
    g.gain.setValueAtTime(level, t + dur - f);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g).connect(this.out);
    this._track(src, [g]);
    src.start(t);
    src.stop(t + dur + 0.01);
    this.current = { kind: 'original', stop: () => { try { src.stop(); } catch { /* ended */ } fadeOut(ctx, g, []); } };
    this.level = level;
    return dur;
  }

  _startSynth(t, duration) {
    const ctx = this.ctx;
    const nyq = ctx.sampleRate / 2;
    const { f0, amps } = this.recipe;
    const fade = ctx.createGain();
    const peak = ctx.createGain();
    peak.gain.value = outputGain(f0, amps, nyq);
    fade.gain.setValueAtTime(0, ctx.currentTime);
    fade.gain.setValueAtTime(0, t);
    fade.gain.linearRampToValueAtTime(1, t + FADE);
    if (duration) {
      fade.gain.setValueAtTime(1, t + duration - FADE);
      fade.gain.linearRampToValueAtTime(0, t + duration);
    }
    fade.connect(peak).connect(this.out);
    const c = { kind: 'synth', voices: [], fade, peak, t0: t };
    // Every oscillator starts at the same instant: sin(2π n f0 (t − t0)), phase 0.
    for (let i = 0; i < amps.length; i++) c.voices.push(this._voice(c, i + 1, f0, n0(amps[i], (i + 1) * f0, nyq), t));
    if (duration) for (const v of c.voices) v.osc.stop(t + duration + 0.05);
    c.stop = () => {
      fadeOut(ctx, fade, c.voices.map((v) => v.osc));
      setTimeout(() => { try { peak.disconnect(); } catch { /* done */ } }, 300);
    };
    return c;
  }

  _voice(c, n, f0, amp, t) {
    const ctx = this.ctx;
    const nyq = ctx.sampleRate / 2;
    const osc = ctx.createOscillator();
    osc.frequency.value = Math.min(n * f0, nyq - 1);
    const g = ctx.createGain();
    g.gain.value = amp;
    osc.connect(g).connect(c.fade);
    this._track(osc, [g]);
    // A harmonic added later starts on a whole number of its own periods after t0.
    const start = Math.max(t, c.t0);
    const k = Math.ceil((start - c.t0) * n * f0);
    osc.start(c.t0 + k / (n * f0));
    return { n, osc, g };
  }

  _track(src, extra) {
    vowelAudioCounters.live++;
    vowelAudioCounters.created++;
    src.onended = () => {
      vowelAudioCounters.live--;
      try { src.disconnect(); } catch { /* done */ }
      for (const e of extra) { try { e.disconnect(); } catch { /* done */ } }
    };
  }

  _set(state) {
    this.state = state;
    if (state !== 'ab') this.abPhase = null;
    this.onChange(this);
  }

  /** Seconds into the recording that is playing now (for the playhead), or null. */
  playhead() {
    if (!this.playInfo || !this.ctx) return null;
    const p = this.ctx.currentTime - this.playInfo.startAt;
    if (p < 0 || p > this.playInfo.duration) return null;
    return this.playInfo.from + p;
  }

  close() {
    this.stop();
    this.closed = true;
    if (this.ctx) {
      try { this.out.disconnect(); } catch { /* done */ }
      this.ctx.close().catch(() => {});
      vowelAudioCounters.contextsClosed++;
    }
  }

  debugInfo() {
    return {
      state: this.state, abPhase: this.abPhase, contextState: this.ctx ? this.ctx.state : null,
      sampleRate: this.sampleRate, volume: this.volume, ...vowelAudioCounters,
      synth: this.current && this.current.kind === 'synth' ? {
        peakGain: this.current.peak.gain.value,
        voices: this.current.voices.map((v) => ({ n: v.n, freq: v.osc.frequency.value, gain: v.g.gain.value })),
      } : null,
      refFreq: this.current && this.current.kind === 'ref' ? this.current.freq : null,
      recipe: this.recipe ? { f0: this.recipe.f0, amps: [...this.recipe.amps] } : null,
      originalLevel: this.state === 'original' || this.abPhase === 'original' ? this.level : null,
    };
  }
}

function n0(a, freq, nyq) {
  return freq < nyq ? a : 0;
}

function ramp(ctx, param, value, tc) {
  const t = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
  param.setTargetAtTime(value, t, tc);
}

function fadeOut(ctx, gainNode, sources) {
  const t = ctx.currentTime;
  const p = gainNode.gain;
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
  p.linearRampToValueAtTime(0, t + FADE);
  for (const s of sources) { try { s.stop(t + FADE + 0.02); } catch { /* already stopped */ } }
  setTimeout(() => { try { gainNode.disconnect(); } catch { /* done */ } }, (FADE + 0.3) * 1000);
}

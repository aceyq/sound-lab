// Playback for Vowel Morph. One AudioContext, created on the first click,
// and at most one sound at a time:
//
//   synth voice:  48 sine OscillatorNodes (harmonic n at n × f0) → one gain
//                 each → voice gain (fade in/out) → volume → destination
//   original:     AudioBufferSource (the recording) → gain → volume → destination
//
// While the slider or the dot moves, the SAME oscillators keep running and
// only their frequency and gain targets change (setTargetAtTime, 15 ms time
// constant). An oscillator integrates its frequency, so its phase stays
// continuous and nothing restarts: no clicks. All 48 frequencies follow the
// same smoothing curve, so they stay exact multiples of one fundamental.
// Starting any sound fades out whatever was playing first.
import { HARMONICS, TARGET_RMS, oscillatorTargets } from './morph-model.js';

export const SMOOTH_SEC = 0.015;
const FADE_IN = 0.03;
const FADE_OUT = 0.04;
// Originals are scaled to the same RMS as the synthesized sound (measured
// over the selected section), but never so far that their peak passes 0.9.
const ORIGINAL_PEAK_LIMIT = 0.9;

export const morphAudioCounters = { contexts: 0, voicesCreated: 0, voicesDisposed: 0, originalsStarted: 0, originalsEnded: 0 };

export class MorphAudio {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.ctx = null;
    this.volume = null;
    this.volumeValue = 0.6;
    this.voice = null; // { oscs, gains, out, params }
    this.original = null; // { src, gain, vowelId, label }
    this.label = '';
    this.error = null;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  get kind() {
    if (this.voice) return 'synth';
    if (this.original) return 'original';
    return 'idle';
  }

  /** Must run inside a click/tap (browsers only allow audio after one). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('This browser does not support the Web Audio API, so no sound can be played. Use a current Chrome, Edge, Firefox or Safari.');
      this.ctx = new AC({ latencyHint: 'interactive' });
      morphAudioCounters.contexts++;
      this.volume = this.ctx.createGain();
      this.volume.gain.value = this.volumeValue;
      this.volume.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolume(v) {
    this.volumeValue = v;
    if (this.volume) this.volume.gain.setTargetAtTime(v, this.ctx.currentTime, SMOOTH_SEC);
  }

  /**
   * Plays (or keeps playing) the synthesized sound for `params`. If a voice is
   * already running, only its targets move; otherwise a new one fades in.
   */
  playSynth(params, label = '') {
    try {
      this.ensure();
    } catch (e) {
      this._error(e);
      return false;
    }
    this.error = null;
    this.label = label;
    if (this.original) this._stopOriginal();
    if (!this.voice) this.voice = this._makeVoice(params);
    else this._setTargets(this.voice, params, false);
    this.onChange();
    return true;
  }

  /** Moves the running voice to new parameters (no-op when nothing plays). */
  update(params, label) {
    if (!this.voice || !params) return;
    this._setTargets(this.voice, params, false);
    if (label != null && label !== this.label) {
      this.label = label;
      this.onChange();
    }
  }

  /**
   * Plays samples[from, to) of a recording at its own sample rate. Its level
   * is set from samples[levelFrom, levelTo) (the analyzed section), so the
   * silence around a take does not make it louder.
   */
  playOriginal(rec, { from = 0, to = rec.samples.length, levelFrom = from, levelTo = to, vowelId = null, label = '' } = {}) {
    try {
      this.ensure();
    } catch (e) {
      this._error(e);
      return false;
    }
    this.error = null;
    this.stop();
    const ctx = this.ctx;
    const part = rec.samples.subarray(Math.max(0, from), Math.min(rec.samples.length, to));
    if (part.length < 16) return false;
    const buf = ctx.createBuffer(1, part.length, rec.sampleRate);
    buf.copyToChannel(Float32Array.from(part), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const level = originalLevel(rec.samples.subarray(Math.max(0, levelFrom), Math.min(rec.samples.length, levelTo)));
    const now = ctx.currentTime;
    const dur = part.length / rec.sampleRate;
    const fade = Math.min(0.01, dur / 4);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + fade);
    gain.gain.setValueAtTime(level, now + dur - fade);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    src.connect(gain).connect(this.volume);
    const o = { src, gain, vowelId, label, level };
    src.onended = () => {
      morphAudioCounters.originalsEnded++;
      try { gain.disconnect(); } catch { /* already */ }
      if (this.original === o) { this.original = null; this.label = ''; this.onChange(); }
    };
    src.start(now);
    morphAudioCounters.originalsStarted++;
    this.original = o;
    this.label = label;
    this.onChange();
    return true;
  }

  /** Fades out and releases whatever is playing. */
  stop() {
    if (this.voice) this._disposeVoice(this.voice);
    this.voice = null;
    if (this.original) this._stopOriginal();
    this.label = '';
    this.onChange();
  }

  close() {
    this.stop();
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  /** Snapshot for the on-page readout and the automated checks. */
  debug() {
    return {
      kind: this.kind, label: this.label, sampleRate: this.ctx ? this.ctx.sampleRate : null,
      params: this.voice ? { f0: this.voice.params.f0, amps: [...this.voice.params.amps] } : null,
      targets: this.voice ? this.voice.targets.map((t) => ({ ...t })) : null,
      oscillators: this.voice ? this.voice.oscs.length : 0,
      originalLevel: this.original ? this.original.level : null,
      counters: { ...morphAudioCounters },
    };
  }

  _makeVoice(params) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + FADE_IN);
    out.connect(this.volume);
    const oscs = [];
    const gains = [];
    for (let n = 1; n <= HARMONICS; n++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(out);
      oscs.push(osc);
      gains.push(g);
    }
    const voice = { oscs, gains, out, params: null, targets: null };
    this._setTargets(voice, params, true);
    for (const o of oscs) o.start(now);
    morphAudioCounters.voicesCreated++;
    return voice;
  }

  _setTargets(voice, params, immediate) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const nyq = ctx.sampleRate / 2;
    const targets = oscillatorTargets(params, ctx.sampleRate);
    targets.forEach((t, i) => {
      // A silent oscillator is parked just below Nyquist instead of above it.
      const f = Math.min(t.freq, nyq * 0.99);
      if (immediate) {
        voice.oscs[i].frequency.setValueAtTime(f, now);
        voice.gains[i].gain.setValueAtTime(t.gain, now);
      } else {
        voice.oscs[i].frequency.setTargetAtTime(f, now, SMOOTH_SEC);
        voice.gains[i].gain.setTargetAtTime(t.gain, now, SMOOTH_SEC);
      }
    });
    voice.params = { f0: params.f0, amps: [...params.amps] };
    voice.targets = targets;
  }

  _disposeVoice(voice) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    voice.out.gain.cancelScheduledValues(now);
    voice.out.gain.setValueAtTime(voice.out.gain.value, now);
    voice.out.gain.linearRampToValueAtTime(0, now + FADE_OUT);
    for (const o of voice.oscs) o.stop(now + FADE_OUT + 0.02);
    voice.oscs[0].onended = () => {
      for (const o of voice.oscs) { try { o.disconnect(); } catch { /* already */ } }
      try { voice.out.disconnect(); } catch { /* already */ }
      morphAudioCounters.voicesDisposed++;
    };
  }

  _stopOriginal() {
    const o = this.original;
    this.original = null;
    const now = this.ctx.currentTime;
    o.gain.gain.cancelScheduledValues(now);
    o.gain.gain.setValueAtTime(o.gain.gain.value, now);
    o.gain.gain.linearRampToValueAtTime(0, now + FADE_OUT);
    try { o.src.stop(now + FADE_OUT + 0.01); } catch { /* already stopped */ }
  }

  _error(e) {
    this.error = String(e && e.message || e);
    this.onChange();
  }
}

/** Gain that gives the original the synthesizer's RMS level (peak ≤ 0.9). */
export function originalLevel(part) {
  let s = 0;
  let peak = 0;
  for (let i = 0; i < part.length; i++) { const a = Math.abs(part[i]); s += a * a; if (a > peak) peak = a; }
  const rms = Math.sqrt(s / Math.max(1, part.length));
  if (!(rms > 1e-6)) return 1;
  return Math.min(TARGET_RMS / rms, ORIGINAL_PEAK_LIMIT / peak);
}

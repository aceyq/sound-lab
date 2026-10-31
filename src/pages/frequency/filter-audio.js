// Playback for Vowel filtering: the original recording, and a sine-component
// source through a real Web Audio filter. The source is either the
// fundamental and every harmonic at amplitude 1, or the person's own
// components with their own amplitudes. Reuses VowelAudio for everything
// except the synthesizer (one sound at a time, the original with its
// playhead, Original → Synthesized, fades, Stop).
//
//   osc(f₁) → gain a₁ ─┐
//   osc(f₂) → gain a₂ ─┼→ sum (g) → fade ─┬→ dry ───────────────────────────→ volume → speakers
//   …                  ┘                 └→ peaking 1 → … → peaking 8 → wet ┘
//
// Each oscillator's own gain is its component amplitude (exactly 1 for
// equal-strength harmonics; 0 when switched off or at/above Nyquist).
// g = SAFE_PEAK / Σ aᵢ is the same for dry and wet; bypass crossfades dry and
// wet with gains that always add up to 1, so the level stays fair and the
// output can never exceed SAFE_PEAK. The optional, clearly labelled "makeup"
// gain (off by default) multiplies only the wet path, to raise a heavily cut
// filtered sound back to the unfiltered peak. buildFilterGraph is also used by
// an OfflineAudioContext in the automated checks, to confirm that the
// browser's own rendering equals the WAV export (renderFiltered).
import { VowelAudio, vowelAudioCounters } from './vowel-audio.js';
import * as VF from './vowel-filter.js';

const TC = 0.02; // smoothing time constant while dragging or editing (s)
const XFADE = 0.03; // bypass crossfade (s)
const FADE = 0.02; // start/stop fade, the same as the WAV (vowel-model FADE_SEC)

/** Builds the components → filter graph into `dest`, starting at time t. */
export function buildFilterGraph(ctx, dest, { components, bands, enabled, t, duration = null, makeup = 1 }) {
  const sum = ctx.createGain();
  sum.gain.value = VF.componentGain(components, ctx.sampleRate);
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0, 0);
  fade.gain.setValueAtTime(0, t);
  fade.gain.linearRampToValueAtTime(1, t + FADE);
  if (duration) {
    fade.gain.setValueAtTime(1, t + duration - FADE);
    fade.gain.linearRampToValueAtTime(0, t + duration);
  }
  sum.connect(fade);
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = enabled ? 0 : 1;
  wet.gain.value = enabled ? makeup : 0;
  fade.connect(dry).connect(dest);
  let node = fade;
  const biquads = bands.map((b) => {
    const q = ctx.createBiquadFilter();
    q.type = 'peaking';
    q.frequency.value = b.f;
    q.gain.value = b.gainDb;
    q.Q.value = b.q;
    node.connect(q);
    node = q;
    return q;
  });
  node.connect(wet).connect(dest);
  const voices = components.map((c, i) => addVoice(ctx, sum, i + 1, c, t));
  if (duration) for (const v of voices) v.osc.stop(t + duration + VF.TAIL_SEC);
  return { sum, fade, dry, wet, biquads, voices, t0: t };
}

function voiceAmp(ctx, c) {
  return c.on !== false && c.freq < ctx.sampleRate / 2 ? c.amp : 0;
}

function addVoice(ctx, sum, n, c, t) {
  const osc = ctx.createOscillator();
  osc.frequency.value = Math.min(c.freq, ctx.sampleRate / 2 - 1);
  const g = ctx.createGain();
  g.gain.value = voiceAmp(ctx, c);
  osc.connect(g).connect(sum);
  osc.start(t); // every sine starts at phase 0 at the same instant
  return { n, osc, g };
}

export class FilterAudio extends VowelAudio {
  constructor(opts = {}) {
    super(opts);
    this.filter = { bands: VF.defaultBands(), enabled: true, makeup: 1 };
    this.components = [];
  }

  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    // Ask for the rate the filter is drawn and exported at; browsers that
    // cannot do that fall back to their own rate (the page then uses it).
    try { this.ctx = new AC({ latencyHint: 'interactive', sampleRate: VF.PREFERRED_RATE }); } catch { this.ctx = new AC({ latencyHint: 'interactive' }); }
    vowelAudioCounters.contexts++;
    this.out = this.ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(this.ctx.destination);
    return this.ctx;
  }

  /** components: [{ freq, amp, on }]; filter: { bands, enabled, makeup }. Plays until stop() (or `duration` s). */
  async playSource(components, filter, opts = {}) {
    this.components = copyComponents(components);
    this.filter = copyFilter(filter);
    return this.playSynth({ f0: 0, amps: [] }, opts);
  }

  /** Original section, a short pause, then the source through the filter (on). */
  async playOriginalThenFiltered(rec, components, filter, opts) {
    this.components = copyComponents(components);
    this.filter = { ...copyFilter(filter), enabled: true };
    return this.playAlternate(rec, { f0: 0, amps: [] }, opts);
  }

  _startSynth(t, duration) {
    const ctx = this.ctx;
    const g = buildFilterGraph(ctx, this.out, { components: this.components, bands: this.filter.bands, enabled: this.filter.enabled, t, duration, makeup: this.filter.makeup });
    for (const v of g.voices) this._track(v.osc, [v.g]);
    const c = { kind: 'synth', ...g, enabled: this.filter.enabled, makeup: this.filter.makeup };
    c.stop = () => {
      const now = ctx.currentTime;
      const p = g.fade.gain;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
      p.linearRampToValueAtTime(0, now + FADE + 0.01);
      for (const v of g.voices) { try { v.osc.stop(now + FADE + 0.03); } catch { /* already stopped */ } }
      setTimeout(() => { for (const x of [g.sum, g.fade, g.dry, g.wet, ...g.biquads]) { try { x.disconnect(); } catch { /* done */ } } }, (FADE + VF.TAIL_SEC + 0.3) * 1000);
    };
    return c;
  }

  /**
   * Live source changes (new f0, edited row). Same number of components: each
   * oscillator glides to its new frequency and amplitude (harmonics all follow
   * the same smoothed path, so they stay exact multiples). A different number
   * of components restarts the sound with the new list.
   */
  updateSource(components) {
    this.components = copyComponents(components);
    const c = this.current;
    if (!c || c.kind !== 'synth' || !c.voices) return;
    if (this.state !== 'synth') return; // during Original → Filtered the new list is used when the filtered part starts
    if (c.voices.length !== components.length) { this.playSynth({ f0: 0, amps: [] }); return; }
    const ctx = this.ctx;
    c.voices.forEach((v, i) => {
      const comp = components[i];
      if (comp.freq < ctx.sampleRate / 2) ramp(ctx, v.osc.frequency, comp.freq, TC);
      ramp(ctx, v.g.gain, voiceAmp(ctx, comp), TC);
    });
    ramp(ctx, c.sum.gain, VF.componentGain(components, ctx.sampleRate), TC);
  }

  /** Live filter changes: glide each band's centre, cut and Q; crossfade bypass. */
  setFilter(filter) {
    this.filter = copyFilter(filter);
    const c = this.current;
    if (!c || c.kind !== 'synth' || !c.biquads) return;
    const ctx = this.ctx;
    filter.bands.forEach((b, i) => {
      const q = c.biquads[i];
      if (!q) return;
      ramp(ctx, q.frequency, b.f, TC);
      ramp(ctx, q.gain, b.gainDb, TC);
      ramp(ctx, q.Q, b.q, TC);
    });
    if (c.enabled !== this.filter.enabled || c.makeup !== this.filter.makeup) {
      const toggled = c.enabled !== this.filter.enabled;
      c.enabled = this.filter.enabled;
      c.makeup = this.filter.makeup;
      const now = ctx.currentTime;
      for (const [p, v] of [[c.wet.gain, c.enabled ? c.makeup : 0], [c.dry.gain, c.enabled ? 0 : 1]]) {
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now); else { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); }
        p.linearRampToValueAtTime(v, now + XFADE);
      }
      if (toggled) this.onChange(this);
    }
  }

  /** True while the synthesizer sounds through the filter (not bypassed). */
  get filteredNow() {
    return !!(this.current && this.current.kind === 'synth' && this.current.enabled);
  }

  /** The live nodes' own response (BiquadFilterNode.getFrequencyResponse), in dB. */
  liveResponseDb(freqs) {
    const c = this.current;
    if (!c || !c.biquads) return null;
    const f = Float32Array.from(freqs);
    const mag = new Float32Array(f.length);
    const ph = new Float32Array(f.length);
    const out = new Array(f.length).fill(0);
    for (const q of c.biquads) {
      q.getFrequencyResponse(f, mag, ph);
      for (let i = 0; i < f.length; i++) out[i] += 20 * Math.log10(mag[i]);
    }
    return out;
  }

  debugInfo() {
    // The base class reads a peak-gain node this graph does not have, so
    // only the shared fields are copied from it.
    const c = this.current;
    return {
      state: this.state, abPhase: this.abPhase, contextState: this.ctx ? this.ctx.state : null,
      sampleRate: this.sampleRate, volume: this.volume, ...vowelAudioCounters,
      originalLevel: this.state === 'original' || this.abPhase === 'original' ? this.level : null,
      components: copyComponents(this.components),
      synth: c && c.kind === 'synth' && c.voices ? {
        sourceGain: c.sum.gain.value,
        dry: c.dry.gain.value, wet: c.wet.gain.value, enabled: c.enabled,
        voices: c.voices.map((v) => ({ n: v.n, freq: v.osc.frequency.value, gain: v.g.gain.value })),
        bands: c.biquads.map((q) => ({ type: q.type, f: q.frequency.value, gainDb: q.gain.value, q: q.Q.value })),
      } : null,
      filter: copyFilter(this.filter),
    };
  }
}

/** Renders the same graph offline (used by the automated checks). */
export async function renderOffline({ components, bands, enabled, sampleRate, duration, makeup = 1 }) {
  const len = Math.round((duration + VF.TAIL_SEC) * sampleRate);
  const ctx = new OfflineAudioContext(1, len, sampleRate);
  buildFilterGraph(ctx, ctx.destination, { components, bands, enabled, t: 0, duration, makeup });
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

function copyComponents(list) {
  return list.map((c) => ({ freq: c.freq, amp: c.amp, on: c.on !== false }));
}

function copyFilter(f) {
  return { bands: f.bands.map((b) => ({ ...b })), enabled: !!f.enabled, makeup: Number.isFinite(f.makeup) && f.makeup > 0 ? f.makeup : 1 };
}

function ramp(ctx, param, value, tc) {
  const t = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
  param.setTargetAtTime(value, t, tc);
}

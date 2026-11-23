// Motion Morph's synthesizer: Vowel Morph's 48-oscillator harmonic voice
// (MorphAudio, unchanged for Vowel Morph) plus ONE noise source for
// fricatives, in one voice:
//
//   48 sines (n × f0) ─▶ harmonic gain (√H) ─┐
//                                             ├─▶ volume ─▶ gate ─▶ speakers
//   white noise ─▶ 24 band-pass filters ─▶ noise gain (√N) ─┘
//
// params come from blendSounds() (pose-sound.js): { f0, amps, harm, noise, bands }.
// Nothing ever plays two recordings at once: the original recording is only a
// separate preview (MorphAudio.playOriginal), and starting it stops the synth.
// When no pitched sound contributes (f0 is NaN) the oscillators keep their
// last frequency at gain 0; no pitch is invented.
import { MorphAudio, SMOOTH_SEC } from '../vowel-morph/morph-audio.js';
import { noiseLoop } from '../frequency/vowel-filter.js';
import { NOISE_BANDS, noiseFilterTargets, partGains } from './pose-sound.js';
import { HARMONICS } from '../vowel-morph/morph-model.js';

const FADE_IN = 0.03;
const FADE_OUT = 0.04;
const PARK_F0 = 220;

export class PoseAudio extends MorphAudio {
  ensure() {
    const ctx = super.ensure();
    if (!this.analyser) {
      // a tap on the final output (after volume and gate), used to measure what actually comes out
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0;
      this.gate.connect(this.analyser);
    }
    return ctx;
  }

  /**
   * Measures the audio leaving the synthesizer right now (one 8192-point FFT
   * of the output): how much of the energy (100 Hz–12 kHz) sits on the
   * harmonics of the current f0 versus the noise between them. The noise
   * floor under the harmonic bins is estimated from the bins between them and
   * subtracted, so pure noise reads ≈ 0 % tonal and a pure harmonic tone ≈ 100 %.
   */
  measureOutput() {
    if (!this.analyser || !this.ctx) return null;
    const an = this.analyser;
    const n = an.frequencyBinCount;
    const db = new Float32Array(n);
    an.getFloatFrequencyData(db);
    const td = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(td);
    let sq = 0;
    for (const v of td) sq += v * v;
    const rms = Math.sqrt(sq / td.length);
    const binHz = this.ctx.sampleRate / an.fftSize;
    const lo = Math.ceil(100 / binHz);
    const hi = Math.min(n - 1, Math.floor(12000 / binHz));
    const v = this.voice;
    const f0 = v && v.params && Number.isFinite(v.params.f0) ? v.params.f0 : (v && v.lastF0) || PARK_F0;
    const harmBin = new Uint8Array(n);
    for (let k = 1; k <= HARMONICS && k * f0 < 12000; k++) {
      const c = Math.round((k * f0) / binHz);
      for (let j = c - 4; j <= c + 4; j++) if (j >= lo && j <= hi) harmBin[j] = 1;
    }
    let onH = 0; let offH = 0; let nOn = 0; let nOff = 0; let high = 0; let total = 0; let cen = 0;
    for (let i = lo; i <= hi; i++) {
      const p = Number.isFinite(db[i]) ? 10 ** (db[i] / 10) : 0;
      total += p; cen += p * i * binHz;
      if (i * binHz >= 2000) high += p;
      if (harmBin[i]) { onH += p; nOn++; } else { offH += p; nOff++; }
    }
    const floor = nOff ? offH / nOff : 0;
    const tonal = Math.max(0, onH - floor * nOn);
    return {
      rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
      tonalShare: total > 0 ? Math.min(1, tonal / total) : 0,
      highShare: total > 0 ? high / total : 0,
      centroidHz: total > 0 ? cen / total : 0,
      f0,
    };
  }

  _makeVoice(params) {
    const voice = super._makeVoice(this._harmPart(params, null));
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // re-route the harmonic voice through its own part gain
    voice.out.disconnect();
    voice.harmGain = ctx.createGain();
    voice.harmGain.gain.value = 0;
    voice.out.connect(voice.harmGain).connect(this.volume);
    // noise part
    const loop = noiseLoop(ctx.sampleRate);
    const buf = ctx.createBuffer(1, loop.length, ctx.sampleRate);
    buf.copyToChannel(Float32Array.from(loop), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    voice.noiseOut = ctx.createGain();
    voice.noiseOut.gain.setValueAtTime(0, now);
    voice.noiseFade = ctx.createGain();
    voice.noiseFade.gain.setValueAtTime(0, now);
    voice.noiseFade.gain.linearRampToValueAtTime(1, now + FADE_IN);
    voice.filters = [];
    voice.filterGains = [];
    for (let i = 0; i < NOISE_BANDS; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(voice.noiseOut);
      voice.filters.push(f);
      voice.filterGains.push(g);
    }
    voice.noiseOut.connect(voice.noiseFade).connect(this.volume);
    voice.noiseSrc = src;
    src.start(now);
    this._setParts(voice, params, true);
    return voice;
  }

  _setTargets(voice, params, immediate) {
    super._setTargets(voice, this._harmPart(params, voice), immediate);
    if (voice.harmGain) this._setParts(voice, params, immediate);
    else voice.params = { ...voice.params, ...this._fullParams(params) };
  }

  _harmPart(params, voice) {
    const f0 = Number.isFinite(params.f0) && params.f0 > 0 ? params.f0 : (voice && voice.lastF0) || PARK_F0;
    if (voice && Number.isFinite(params.f0) && params.f0 > 0) voice.lastF0 = params.f0;
    return { f0, amps: params.amps && params.amps.length === HARMONICS ? params.amps : new Array(HARMONICS).fill(0) };
  }

  _fullParams(params) {
    return {
      f0: Number.isFinite(params.f0) ? params.f0 : NaN,
      amps: [...(params.amps || new Array(HARMONICS).fill(0))],
      harm: params.harm ?? 1,
      noise: params.noise ?? 0,
      bands: params.bands ? [...params.bands] : null,
    };
  }

  _setParts(voice, params, immediate) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const full = this._fullParams(params);
    const g = partGains({ harm: Number.isFinite(full.f0) ? full.harm : 0, noise: full.bands ? full.noise : 0 });
    const set = (param, v) => (immediate ? param.setValueAtTime(v, now) : param.setTargetAtTime(v, now, SMOOTH_SEC));
    set(voice.harmGain.gain, g.harm);
    set(voice.noiseOut.gain, g.noise);
    const targets = full.bands ? noiseFilterTargets(full.bands, ctx.sampleRate) : null;
    voice.filters.forEach((f, i) => {
      if (targets) {
        set(f.frequency, targets[i].freq);
        set(f.Q, targets[i].Q);
      }
      set(voice.filterGains[i].gain, targets ? targets[i].gain : 0);
    });
    voice.params = full;
    voice.parts = g;
    voice.noiseTargets = targets;
  }

  _disposeVoice(voice) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (voice.noiseFade) {
      voice.noiseFade.gain.cancelScheduledValues(now);
      voice.noiseFade.gain.setValueAtTime(voice.noiseFade.gain.value, now);
      voice.noiseFade.gain.linearRampToValueAtTime(0, now + FADE_OUT);
      try { voice.noiseSrc.stop(now + FADE_OUT + 0.02); } catch { /* already */ }
      voice.noiseSrc.onended = () => { try { voice.noiseFade.disconnect(); } catch { /* already */ } };
    }
    super._disposeVoice(voice);
    voice.oscs[0].addEventListener('ended', () => { try { voice.harmGain.disconnect(); } catch { /* already */ } });
  }

  debug() {
    const d = super.debug();
    d.output = this.voice ? this.measureOutput() : null;
    if (this.voice) {
      d.params = { ...this.voice.params, amps: [...this.voice.params.amps], bands: this.voice.params.bands ? [...this.voice.params.bands] : null };
      d.parts = this.voice.parts ? { ...this.voice.parts } : null;
      d.noiseFilters = this.voice.noiseTargets ? this.voice.noiseTargets.length : 0;
      d.harmGain = this.voice.harmGain ? this.voice.harmGain.gain.value : null;
      d.noiseGain = this.voice.noiseOut ? this.voice.noiseOut.gain.value : null;
    }
    return d;
  }
}

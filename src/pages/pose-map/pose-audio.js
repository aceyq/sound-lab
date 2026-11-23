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

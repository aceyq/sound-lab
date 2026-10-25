// Microphone input for the Frequency Playground page (analysis only).
//
// Signal path (one per Enable click; everything is released by stop()):
//
//   microphone track → MediaStreamSource ─┬→ waveAnalyser  (time-domain samples for the waveform)
//                                         └→ specAnalyser  (FFT magnitudes for the spectrum)
//
// Nothing is connected to ctx.destination, so the microphone is never played
// through the speakers. The microphone gets its own AudioContext, separate
// from the synthesizer's, so the two signals can never mix in one
// measurement and the synthesizer's audio setup is untouched.
//
// Later stages (recording a vowel, analyzing stored samples) can attach a
// recorder to `mic.source` and read `mic.sampleRate`; the pure helpers in
// mic-analysis.js already work on plain Float32Array sample buffers.

import { classifyMicError, readProcessing } from './mic-analysis.js';

// Ask the browser not to "clean up" the voice: these features change the
// spectrum of a sustained vowel. Plain values (not `exact`) so a browser that
// cannot switch one off still opens the microphone; we then report what it
// actually applied from track.getSettings().
export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 1 },
  },
  video: false,
};

// Long enough for the longest waveform window at any common sample rate
// (32768 samples = 683 ms at 48 kHz, 341 ms at 96 kHz).
export const WAVE_BUFFER = 32768;
export const SPEC_SMOOTHING = 0.5;

// Lifetime counters, used by the automated checks to prove nothing leaks.
export const micCounters = {
  contextsCreated: 0, contextsClosed: 0,
  streamsAcquired: 0, tracksStopped: 0,
  nodesCreated: 0, nodesDisconnected: 0,
};

export class MicInput {
  /**
   * deps (for tests): { mediaDevices, AudioContext, isSecureContext }.
   * onChange(state) is called whenever status changes.
   */
  constructor({ fftSize = 4096, onChange = () => {}, deps = {} } = {}) {
    this.deps = deps;
    this.fftSize = fftSize;
    this.onChange = onChange;
    this.status = 'off'; // 'off' | 'requesting' | 'listening' | 'error'
    this.error = null; // { title, message, name }
    this.ctx = null;
    this.stream = null;
    this.track = null;
    this.source = null;
    this.waveAnalyser = null;
    this.specAnalyser = null;
    this.settings = null;
    this.deviceLabel = '';
    this.attempt = 0; // invalidates a pending permission request after Stop
    this._onEnded = () => this._fail({ name: 'TrackEnded' });
  }

  get listening() {
    return this.status === 'listening';
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : null;
  }

  /** Must be called from a click handler (the browser requires a user gesture). */
  async start() {
    if (this.status === 'requesting' || this.status === 'listening') return;
    const env = this._env();
    const attempt = ++this.attempt;
    this.error = null;

    if (!env.isSecureContext) return this._fail({ name: 'InsecureContext' });
    if (!env.mediaDevices || typeof env.mediaDevices.getUserMedia !== 'function') return this._fail({ name: 'Unsupported' });
    if (!env.AudioContext) return this._fail({ name: 'NoWebAudio' });

    this._set('requesting');
    // Create and resume the context inside the click, before the permission
    // prompt ends the user gesture (Safari otherwise keeps it suspended).
    let ctx;
    try {
      ctx = new env.AudioContext({ latencyHint: 'interactive' });
      micCounters.contextsCreated++;
      ctx.resume().catch(() => {});
    } catch (e) {
      return this._fail({ name: 'NoWebAudio', detail: e && e.message });
    }
    this.ctx = ctx;

    let stream;
    try {
      stream = await env.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      if (attempt !== this.attempt) return; // Stop was pressed meanwhile
      return this._fail(e);
    }
    micCounters.streamsAcquired++;
    if (attempt !== this.attempt || this.status !== 'requesting') {
      // Stop was pressed while the permission prompt was open: release at once.
      stopTracks(stream);
      return;
    }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) return this._fail({ name: 'NotFoundError' });
    this.track = track;
    track.addEventListener('ended', this._onEnded);

    try {
      this.source = ctx.createMediaStreamSource(stream);
      this.waveAnalyser = ctx.createAnalyser();
      this.waveAnalyser.fftSize = WAVE_BUFFER;
      this.waveAnalyser.smoothingTimeConstant = 0;
      this.specAnalyser = ctx.createAnalyser();
      this.specAnalyser.fftSize = this.fftSize;
      this.specAnalyser.smoothingTimeConstant = SPEC_SMOOTHING;
      micCounters.nodesCreated += 3;
      this.source.connect(this.waveAnalyser);
      this.source.connect(this.specAnalyser);
      // Deliberately no connection to ctx.destination: analysis only.
      await ctx.resume();
    } catch (e) {
      if (attempt !== this.attempt) return;
      return this._fail({ name: 'GraphError', detail: e && e.message });
    }
    if (attempt !== this.attempt) return;

    this.settings = readProcessing(track);
    this.deviceLabel = track.label || '';
    this.startedAt = ctx.currentTime;
    this._set('listening');
  }

  /** Stops the media tracks (releases the device) and frees every audio node. */
  stop() {
    this.attempt++;
    const wasActive = this.status === 'listening' || this.status === 'requesting';
    this._release();
    if (wasActive || this.status === 'error') {
      this.error = null;
      this._set('off');
    }
  }

  setFftSize(n) {
    this.fftSize = n;
    if (this.specAnalyser) this.specAnalyser.fftSize = n;
  }

  /** Copies the most recent WAVE_BUFFER samples into `out` (length WAVE_BUFFER). */
  readWave(out) {
    if (!this.waveAnalyser) return false;
    this.waveAnalyser.getFloatTimeDomainData(out);
    return true;
  }

  /** Copies the current FFT magnitudes (dB) into `out` (length fftSize / 2). */
  readSpectrum(out) {
    if (!this.specAnalyser) return false;
    this.specAnalyser.getFloatFrequencyData(out);
    return true;
  }

  /** Seconds of audio captured since listening started (for warm-up). */
  get capturedSec() {
    return this.ctx && this.listening ? this.ctx.currentTime - this.startedAt : 0;
  }

  debugInfo() {
    return {
      status: this.status,
      error: this.error && this.error.name,
      sampleRate: this.sampleRate,
      contextState: this.ctx ? this.ctx.state : null,
      trackState: this.track ? this.track.readyState : null,
      fftSize: this.fftSize,
      settings: this.settings,
      counters: { ...micCounters },
    };
  }

  _env() {
    const d = this.deps;
    const w = typeof window !== 'undefined' ? window : {};
    return {
      mediaDevices: 'mediaDevices' in d ? d.mediaDevices : (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined),
      AudioContext: 'AudioContext' in d ? d.AudioContext : (w.AudioContext || w.webkitAudioContext),
      isSecureContext: 'isSecureContext' in d ? d.isSecureContext : w.isSecureContext !== false,
      origin: d.origin || (w.location ? w.location.origin : ''),
    };
  }

  _fail(err) {
    this._release();
    this.error = classifyMicError(err, { origin: this._env().origin });
    this._set('error');
  }

  _release() {
    if (this.track) this.track.removeEventListener('ended', this._onEnded);
    if (this.stream) stopTracks(this.stream);
    for (const n of [this.source, this.waveAnalyser, this.specAnalyser]) {
      if (n) {
        try { n.disconnect(); } catch { /* already disconnected */ }
        micCounters.nodesDisconnected++;
      }
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
      micCounters.contextsClosed++;
    }
    this.ctx = null;
    this.stream = null;
    this.track = null;
    this.source = null;
    this.waveAnalyser = null;
    this.specAnalyser = null;
    this.settings = null;
    this.deviceLabel = '';
  }

  _set(status) {
    this.status = status;
    this.onChange(this);
  }
}

function stopTracks(stream) {
  for (const t of stream.getTracks()) {
    if (t.readyState !== 'ended') micCounters.tracksStopped++;
    t.stop();
  }
}

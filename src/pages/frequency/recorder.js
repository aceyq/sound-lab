// Records raw samples from the already-open microphone (MicInput) for the
// Vowel Lab. Nothing is compressed: the result is the exact Float32 sample
// stream the microphone context delivered, at its own sample rate.
//
// Signal path (only while a recording runs; everything is disconnected after):
//
//   mic.source → capture node (AudioWorklet, or ScriptProcessor fallback) → mute gain (0) → ctx.destination
//
// The mute gain is exactly 0, so nothing reaches the speakers. It is there
// because some browsers only run a processing node that leads to the
// destination.

export const recorderCounters = { started: 0, finished: 0, nodesCreated: 0, nodesDisconnected: 0 };

const WORKLET_SRC = `
class FpCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'flush') { this.flush(); this.port.postMessage('flushed'); this.on = false; } }; }
  flush() { if (this.n) { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0];
    if (this.on && ch && ch.length) {
      const k = ch.length;
      const len = ch[0].length;
      for (let i = 0; i < len; i++) {
        let s = 0; for (let c = 0; c < k; c++) s += ch[c][i];
        this.buf[this.n++] = s / k;
        if (this.n === this.buf.length) this.flush();
      }
    }
    return this.on;
  }
}
registerProcessor('fp-capture', FpCapture);
`;

const loadedContexts = new WeakSet();

export class VowelRecorder {
  constructor() {
    this.active = null; // { resolve, chunks, count, maxSamples, nodes, ... }
  }

  get recording() {
    return !!this.active;
  }

  /**
   * Starts capturing from `mic` (a listening MicInput) for up to `maxSec`.
   * onProgress(capturedSec) is called as samples arrive.
   * Resolves with { samples, sampleRate, cutShort, reason } when finished.
   */
  async start(mic, maxSec, { onProgress = () => {} } = {}) {
    if (this.active) throw new Error('Already recording.');
    if (!mic || !mic.listening || !mic.ctx || !mic.source) throw new Error('The microphone is not listening.');
    const ctx = mic.ctx;
    const sampleRate = ctx.sampleRate;
    const rec = {
      ctx, sampleRate, chunks: [], count: 0, maxSamples: Math.round(maxSec * sampleRate),
      nodes: [], onProgress, done: false, mic,
    };
    this.active = rec;
    recorderCounters.started++;
    const promise = new Promise((resolve) => { rec.resolve = resolve; });

    let node;
    try {
      if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        if (!loadedContexts.has(ctx)) {
          const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
          try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          loadedContexts.add(ctx);
        }
        if (rec.done) return promise;
        node = new AudioWorkletNode(ctx, 'fp-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (e) => { if (e.data instanceof Float32Array) this._push(rec, e.data); else if (e.data === 'flushed' && rec.flushWait) rec.flushWait(); };
        rec.kind = 'AudioWorklet';
      } else {
        node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => this._push(rec, Float32Array.from(e.inputBuffer.getChannelData(0)));
        rec.kind = 'ScriptProcessor';
      }
    } catch (err) {
      this._finish(rec, 'error', String(err && err.message || err));
      return promise;
    }
    const mute = ctx.createGain();
    mute.gain.value = 0;
    rec.nodes = [node, mute];
    recorderCounters.nodesCreated += 2;
    mic.source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    rec.node = node;
    // If the microphone stops or fails mid-take, keep what was captured.
    rec.watch = setInterval(() => { if (!mic.listening) this._finish(rec, 'mic-stopped'); }, 100);
    return promise;
  }

  /** Ends the take early and keeps the samples captured so far. */
  async stop() {
    const rec = this.active;
    if (!rec) return;
    if (rec.kind === 'AudioWorklet' && rec.node && rec.ctx.state === 'running') {
      // Collect the samples still waiting inside the worklet (at most 2048).
      await new Promise((res) => { rec.flushWait = res; rec.node.port.postMessage('flush'); setTimeout(res, 200); });
    }
    this._finish(rec, 'stopped');
  }

  /** Releases everything without keeping a result (page unmount). */
  cancel() {
    if (this.active) this._finish(this.active, 'cancelled');
  }

  _push(rec, chunk) {
    if (rec.done) return;
    const room = rec.maxSamples - rec.count;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    rec.chunks.push(part);
    rec.count += part.length;
    rec.onProgress(rec.count / rec.sampleRate);
    if (rec.count >= rec.maxSamples) this._finish(rec, 'complete');
  }

  _finish(rec, reason, error = null) {
    if (rec.done) return;
    rec.done = true;
    clearInterval(rec.watch);
    for (const n of rec.nodes) {
      try { n.disconnect(); } catch { /* already disconnected */ }
      recorderCounters.nodesDisconnected++;
    }
    if (rec.node) {
      if (rec.node.port) { rec.node.port.onmessage = null; try { rec.node.port.postMessage('flush'); } catch { /* closed */ } }
      rec.node.onaudioprocess = null;
    }
    try { rec.mic.source && rec.mic.source.disconnect(rec.node); } catch { /* not connected or already released */ }
    const samples = new Float32Array(rec.count);
    let at = 0;
    for (const c of rec.chunks) { samples.set(c, at); at += c.length; }
    rec.chunks = [];
    if (this.active === rec) this.active = null;
    recorderCounters.finished++;
    rec.resolve({ samples, sampleRate: rec.sampleRate, cutShort: reason !== 'complete', reason, error, kind: rec.kind });
  }
}

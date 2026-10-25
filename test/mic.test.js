// Microphone input: pure analysis helpers and the capture lifecycle, using a
// fake getUserMedia and a fake AudioContext (no real microphone in Node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  windowSampleCount, binSpacing, fftWindowSec, selectWindow, levelStats, niceScale, AutoScale,
  readProcessing, describeProcessing, classifyMicError,
} from '../src/pages/frequency/mic-analysis.js';
import { MicInput, MIC_CONSTRAINTS, WAVE_BUFFER, micCounters } from '../src/pages/frequency/mic.js';

test('time windows select the matching number of samples at the real sample rate', () => {
  assert.equal(windowSampleCount(0.02, 48000), 960);
  assert.equal(windowSampleCount(0.1, 48000), 4800);
  assert.equal(windowSampleCount(0.02, 44100), 882);
  assert.equal(windowSampleCount(0.1, 44100), 4410);
  // The longest window still fits in the analyser buffer at 96 kHz.
  assert.ok(windowSampleCount(0.2, 96000) <= WAVE_BUFFER);
});

test('bin spacing and FFT window come from sample rate and FFT size', () => {
  assert.equal(binSpacing(48000, 4096), 48000 / 4096);
  assert.equal(binSpacing(44100, 8192), 44100 / 8192);
  assert.ok(Math.abs(fftWindowSec(48000, 4096) - 0.08533) < 1e-4);
});

function sine(n, f, sr, amp = 0.5, phase = 0) {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * (i / sr) + phase));
}

test('selectWindow returns the newest samples without stabilization', () => {
  const buf = Float32Array.from({ length: 100 }, (_, i) => i);
  assert.deepEqual(selectWindow(buf, 10), { start: 90, n: 10, triggered: false });
});

test('selectWindow (steady display) starts at an upward zero crossing of real samples', () => {
  const sr = 48000;
  const buf = sine(4096, 200, sr, 0.5, 1.3);
  const n = windowSampleCount(0.02, sr);
  const sel = selectWindow(buf, n, { stabilize: true, searchN: windowSampleCount(0.025, sr) });
  assert.equal(sel.triggered, true);
  assert.equal(sel.n, n);
  assert.ok(sel.start + n <= buf.length);
  assert.ok(buf[sel.start - 1] < 0 && buf[sel.start] >= 0);
  // A different phase lands on the same point of the cycle, so the picture stands still.
  const buf2 = sine(4096, 200, sr, 0.5, 2.9);
  const sel2 = selectWindow(buf2, n, { stabilize: true, searchN: windowSampleCount(0.025, sr) });
  assert.ok(Math.abs(buf2[sel2.start] - buf[sel.start]) < 0.02);
});

test('selectWindow ignores silence and falls back to the newest samples', () => {
  const buf = new Float32Array(2000);
  assert.deepEqual(selectWindow(buf, 500, { stabilize: true, searchN: 800 }), { start: 1500, n: 500, triggered: false });
});

test('levelStats reports RMS and peak in dBFS', () => {
  const s = levelStats(sine(48000, 440, 48000, 1));
  assert.ok(Math.abs(s.peak - 1) < 1e-3);
  assert.ok(Math.abs(s.rmsDb - -3.01) < 0.05);
  assert.equal(levelStats(new Float32Array(10)).rmsDb, -Infinity);
});

test('auto-fit grows at once, shrinks only after the hold time, never below ±0.005', () => {
  assert.equal(niceScale(0.03), 0.05);
  assert.equal(niceScale(0), 0.005);
  const a = new AutoScale({ holdMs: 1000 });
  assert.equal(a.update(0.3, 0), 0.5);
  assert.equal(a.update(0.01, 500), 0.5);
  assert.equal(a.update(0.01, 1600), 0.02);
  assert.equal(a.update(0, 3000), 0.005);
});

test('voice processing is only reported as off when the browser confirms it', () => {
  const p = readProcessing({ getSettings: () => ({ echoCancellation: false, noiseSuppression: true, sampleRate: 48000 }) });
  const d = describeProcessing(p);
  assert.equal(p.items[0].applied, false);
  assert.equal(p.items[1].applied, true);
  assert.equal(p.items[2].applied, null);
  assert.match(d[0].text, /off \(confirmed/);
  assert.match(d[1].text, /did not switch it off/);
  assert.match(d[2].text, /does not report/);
  assert.equal(d[2].ok, false);
});

test('errors become actionable messages', () => {
  assert.match(classifyMicError({ name: 'NotAllowedError' }).message, /Enable Microphone again/);
  assert.match(classifyMicError({ name: 'NotFoundError' }).title, /No microphone/);
  assert.match(classifyMicError({ name: 'NotReadableError' }).message, /Another app/);
  assert.match(classifyMicError({ name: 'InsecureContext' }, { origin: 'http://192.168.1.5:5173' }).message, /localhost/);
  assert.match(classifyMicError({ name: 'Weird', message: 'boom' }).message, /boom/);
});

// ───────── fake browser APIs ─────────
function fakeEnv({ fail = null, delay = 0 } = {}) {
  const log = { streams: [], contexts: [], gumCalls: [] };
  class Node {
    constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outputs = new Set(); ctx.nodes.push(this); }
    connect(n) { this.outputs.add(n); return n; }
    disconnect() { this.outputs.clear(); }
  }
  class FakeContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; this.nodes = []; this.destination = { kind: 'destination' }; log.contexts.push(this); }
    resume() { if (this.state !== 'closed') this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource(stream) { const n = new Node(this, 'source'); n.stream = stream; return n; }
    createAnalyser() {
      const n = new Node(this, 'analyser');
      n.fftSize = 2048; n.smoothingTimeConstant = 0.8;
      n.getFloatTimeDomainData = (a) => a.fill(0.1);
      n.getFloatFrequencyData = (a) => a.fill(-80);
      return n;
    }
  }
  const mediaDevices = {
    getUserMedia: async (c) => {
      log.gumCalls.push(c);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (fail) { const e = new Error(fail); e.name = fail; throw e; }
      const listeners = {};
      const track = {
        kind: 'audio', label: 'Fake Mic', readyState: 'live',
        stop() { this.readyState = 'ended'; },
        getSettings: () => ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000 }),
        addEventListener: (ev, fn) => { listeners[ev] = fn; },
        removeEventListener: (ev) => { delete listeners[ev]; },
        fire: (ev) => listeners[ev] && listeners[ev](),
      };
      const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
      log.streams.push(stream);
      return stream;
    },
  };
  return { log, deps: { mediaDevices, AudioContext: FakeContext, isSecureContext: true } };
}

const liveTracks = (log) => log.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length;
const openContexts = (log) => log.contexts.filter((c) => c.state !== 'closed').length;

test('start requests the microphone with voice processing off and never connects to the speakers', async () => {
  const { log, deps } = fakeEnv();
  const mic = new MicInput({ deps });
  await mic.start();
  assert.equal(mic.status, 'listening');
  assert.deepEqual(log.gumCalls[0], MIC_CONSTRAINTS);
  assert.equal(MIC_CONSTRAINTS.audio.echoCancellation, false);
  assert.equal(MIC_CONSTRAINTS.audio.noiseSuppression, false);
  assert.equal(MIC_CONSTRAINTS.audio.autoGainControl, false);
  const ctx = log.contexts[0];
  for (const n of ctx.nodes) assert.ok(![...n.outputs].includes(ctx.destination), `${n.kind} must not reach the destination`);
  assert.equal(mic.waveAnalyser.fftSize, WAVE_BUFFER);
  assert.equal(mic.specAnalyser.fftSize, 4096);
  assert.equal(mic.sampleRate, 48000);
  mic.stop();
});

test('stop stops the media tracks, closes the context and frees nodes', async () => {
  const { log, deps } = fakeEnv();
  const mic = new MicInput({ deps });
  await mic.start();
  const ctx = log.contexts[0];
  mic.stop();
  assert.equal(mic.status, 'off');
  assert.equal(liveTracks(log), 0);
  assert.equal(ctx.state, 'closed');
  assert.ok(ctx.nodes.every((n) => n.outputs.size === 0));
  assert.equal(mic.readWave(new Float32Array(WAVE_BUFFER)), false);
});

test('repeated start/stop never leaves more than one live stream or open context', async () => {
  const { log, deps } = fakeEnv();
  const mic = new MicInput({ deps });
  for (let i = 0; i < 10; i++) {
    await mic.start();
    await mic.start(); // a second click while listening does nothing
    assert.equal(liveTracks(log), 1);
    assert.equal(openContexts(log), 1);
    mic.stop();
    assert.equal(liveTracks(log), 0);
    assert.equal(openContexts(log), 0);
  }
  assert.equal(log.streams.length, 10);
});

test('stop pressed while the permission prompt is open releases the stream when it arrives', async () => {
  const { log, deps } = fakeEnv({ delay: 20 });
  const mic = new MicInput({ deps });
  const p = mic.start();
  assert.equal(mic.status, 'requesting');
  mic.stop();
  await p;
  assert.equal(mic.status, 'off');
  assert.equal(liveTracks(log), 0);
  assert.equal(openContexts(log), 0);
});

test('denied permission, missing device and busy device become error states with nothing left open', async () => {
  for (const [name, title] of [['NotAllowedError', /denied/], ['NotFoundError', /No microphone/], ['NotReadableError', /unavailable/]]) {
    const { log, deps } = fakeEnv({ fail: name });
    const mic = new MicInput({ deps });
    await mic.start();
    assert.equal(mic.status, 'error');
    assert.match(mic.error.title, title);
    assert.equal(openContexts(log), 0);
    mic.stop();
    assert.equal(mic.status, 'off');
  }
});

test('insecure page and missing API fail before asking for the microphone', async () => {
  const a = fakeEnv();
  const mic = new MicInput({ deps: { ...a.deps, isSecureContext: false } });
  await mic.start();
  assert.equal(mic.error.name, 'InsecureContext');
  assert.equal(a.log.gumCalls.length, 0);
  const b = fakeEnv();
  const mic2 = new MicInput({ deps: { ...b.deps, mediaDevices: undefined } });
  await mic2.start();
  assert.equal(mic2.error.name, 'Unsupported');
});

test('an unplugged microphone (track ended) becomes an error and releases everything', async () => {
  const { log, deps } = fakeEnv();
  const mic = new MicInput({ deps });
  await mic.start();
  const track = log.streams[0].getTracks()[0];
  track.readyState = 'ended';
  track.fire('ended');
  assert.equal(mic.status, 'error');
  assert.equal(mic.error.name, 'TrackEnded');
  assert.equal(openContexts(log), 0);
});

test('FFT size changes apply to the spectrum analyser only', async () => {
  const { deps } = fakeEnv();
  const mic = new MicInput({ deps });
  await mic.start();
  mic.setFftSize(16384);
  assert.equal(mic.specAnalyser.fftSize, 16384);
  assert.equal(mic.waveAnalyser.fftSize, WAVE_BUFFER);
  mic.stop();
  assert.ok(micCounters.contextsCreated >= 1);
});

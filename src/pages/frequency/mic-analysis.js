// Pure helpers for the microphone view. No DOM or Web Audio here, so they are
// unit-tested in Node and can be reused later on stored (recorded) samples.

/** Number of samples that make up `sec` seconds at `sampleRate`. */
export function windowSampleCount(sec, sampleRate) {
  return Math.max(2, Math.round(sec * sampleRate));
}

/** Frequency spacing between FFT bins: sample rate ÷ FFT size. */
export function binSpacing(sampleRate, fftSize) {
  return sampleRate / fftSize;
}

/** Length of audio one FFT looks at, in seconds. */
export function fftWindowSec(sampleRate, fftSize) {
  return fftSize / sampleRate;
}

/**
 * Picks which `n` consecutive samples of `buf` to draw (buf is oldest → newest).
 * Without stabilization: the newest n samples.
 * With stabilization (like an oscilloscope trigger): the newest window that
 * starts at an upward zero crossing, searched over at most `searchN` samples
 * before the newest window. The samples are still real and consecutive; only
 * the starting point is chosen so a repeating wave stands still on screen.
 */
export function selectWindow(buf, n, { stabilize = false, searchN = 0 } = {}) {
  const len = buf.length;
  n = Math.min(n, len);
  const newest = len - n;
  if (!stabilize || searchN <= 1 || newest < 2) return { start: newest, n, triggered: false };
  const lo = Math.max(1, newest - searchN);
  let peak = 0;
  for (let i = lo; i < len; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak < 1e-4) return { start: newest, n, triggered: false };
  // Hysteresis: the signal must dip below −thr before an upward crossing counts,
  // so small noise wiggles around zero do not trigger.
  const thr = 0.15 * peak;
  let armed = false;
  let best = -1;
  for (let i = lo; i <= newest; i++) {
    if (buf[i] < -thr) armed = true;
    else if (armed && buf[i - 1] < 0 && buf[i] >= 0) {
      best = i;
      armed = false;
    }
  }
  return best >= 0 ? { start: best, n, triggered: true } : { start: newest, n, triggered: false };
}

/** RMS and peak of buf[from, to), plus both in dBFS (dB relative to digital full scale). */
export function levelStats(buf, from = 0, to = buf.length) {
  let sum = 0;
  let peak = 0;
  const count = Math.max(1, to - from);
  for (let i = from; i < to; i++) {
    const v = buf[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / count);
  return { rms, peak, rmsDb: toDbfs(rms), peakDb: toDbfs(peak) };
}

export function toDbfs(x) {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

export const SCALE_STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];

/** Smallest scale step that fits `v` (always at least the smallest step). */
export function niceScale(v) {
  return SCALE_STEPS.find((s) => s >= v) || 1;
}

/**
 * Auto-fit for the waveform's vertical axis. It grows at once when the signal
 * gets louder but waits `holdMs` before shrinking, so the axis does not jump
 * between every syllable.
 */
export class AutoScale {
  constructor({ holdMs = 1500 } = {}) {
    this.holdMs = holdMs;
    this.range = SCALE_STEPS[0];
    this.lastNeed = -Infinity;
  }

  update(peak, nowMs) {
    const need = niceScale(peak * 1.1);
    if (need >= this.range) {
      this.range = need;
      this.lastNeed = nowMs;
    } else if (nowMs - this.lastNeed > this.holdMs) {
      this.range = need;
      this.lastNeed = nowMs;
    }
    return this.range;
  }

  reset() {
    this.range = SCALE_STEPS[0];
    this.lastNeed = -Infinity;
  }
}

const PROCESSING = [
  ['echoCancellation', 'Echo cancellation'],
  ['noiseSuppression', 'Noise suppression'],
  ['autoGainControl', 'Automatic gain control'],
];

/**
 * What the browser reports it actually applied to the track. `applied` is
 * true/false only when getSettings() includes the key; otherwise null
 * ("not reported"), and the UI must not claim it is off.
 */
export function readProcessing(track) {
  let s = {};
  try { s = (track && track.getSettings && track.getSettings()) || {}; } catch { s = {}; }
  return {
    items: PROCESSING.map(([key, label]) => ({
      key, label, requested: false,
      applied: typeof s[key] === 'boolean' ? s[key] : null,
    })),
    sampleRate: Number.isFinite(s.sampleRate) ? s.sampleRate : null,
    channelCount: Number.isFinite(s.channelCount) ? s.channelCount : null,
  };
}

/** One short phrase per processing feature, e.g. "Echo cancellation: off (confirmed)". */
export function describeProcessing(p) {
  if (!p) return [];
  return p.items.map((it) => ({
    key: it.key,
    ok: it.applied === false,
    text: `${it.label}: ` + (it.applied === false ? 'off (confirmed by the browser)'
      : it.applied === true ? 'ON — the browser did not switch it off'
      : 'requested off; this browser does not report whether it is'),
  }));
}

/**
 * Turns a getUserMedia / Web Audio failure into a title and an actionable
 * message for the status area.
 */
export function classifyMicError(err, { origin = '' } = {}) {
  const name = (err && err.name) || 'Error';
  const map = {
    InsecureContext: ['Microphone needs a secure page',
      `Browsers only allow the microphone on https:// pages or on http://localhost. This page is ${origin || 'not secure'}. Open http://localhost:5173 (npm run dev) or the https:// site instead.`],
    Unsupported: ['This browser cannot use the microphone',
      'It does not support navigator.mediaDevices.getUserMedia. Use a current Chrome, Edge, Firefox or Safari.'],
    NoWebAudio: ['Audio analysis is unavailable',
      'This browser could not start the Web Audio API needed to analyze the microphone. Use a current Chrome, Edge, Firefox or Safari.'],
    NotAllowedError: ['Microphone permission was denied',
      'Allow the microphone for this site (click the icon at the left of the address bar, or the browser’s site settings), then click Enable Microphone again. On a Mac, also check System Settings → Privacy & Security → Microphone and turn on your browser.'],
    SecurityError: ['Microphone blocked by the browser',
      'The browser’s security settings block microphone access on this page. Check the site permissions in the address bar, then click Enable Microphone again.'],
    NotFoundError: ['No microphone found',
      'The browser did not find any microphone. Plug one in (or check that the built-in microphone is enabled), then click Enable Microphone again.'],
    OverconstrainedError: ['No suitable microphone found',
      'No microphone matched the requested settings. Try another microphone, then click Enable Microphone again.'],
    NotReadableError: ['Microphone is unavailable',
      'The microphone exists but could not be opened. Another app (Zoom, FaceTime, a recorder) may be using it, or the system blocked it. Close that app, then click Enable Microphone again.'],
    NotSupportedError: ['Microphone not available here',
      'The browser refused to open a microphone on this page (it may be blocked by a browser setting or policy). Check the site permissions in the address bar, then click Enable Microphone again.'],
    AbortError: ['Microphone could not start',
      'The browser stopped opening the microphone. Click Enable Microphone again; if it keeps failing, restart the browser.'],
    TrackEnded: ['Microphone disconnected',
      'The microphone stopped sending sound (it was unplugged, switched off, or taken by the system). Reconnect it and click Enable Microphone again.'],
    GraphError: ['Audio analysis failed to start',
      'The microphone opened but the browser could not connect it for analysis. Reload the page and try again.'],
  };
  const [title, message] = map[name] || ['Microphone error', `The browser reported: ${(err && err.message) || name}. Click Enable Microphone to try again.`];
  return { name, title, message };
}

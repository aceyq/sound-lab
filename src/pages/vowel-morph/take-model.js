// Drawn takes (capstone part 2): record while drawing a line or curve in the
// 2D square, then turn the take into learned points along the path.
//
// Pure logic, no DOM or Web Audio, so it is unit-tested with `npm test`.
//
// Timing. Two clocks are involved:
//   pointer  every pointer event carries e.timeStamp (ms, performance.now clock)
//   audio    the recorder delivers chunks of samples; sample i was captured
//            i / sampleRate seconds after sample 0.
// To put both on one clock we need the performance.now time of sample 0.
// Each time a chunk arrives we know "by now, `count` samples exist", so
// sample 0 was captured no later than arrivalMs − count / sampleRate · 1000.
// Delivery can only be late, never early, so the EARLIEST of those values
// over all chunks is the best estimate (the least delayed chunk). Then
//   time of sample i = startMs + i / sampleRate · 1000.
// The microphone's own input latency (typically 5–20 ms) is not visible to
// the page and is ignored; it is far shorter than one snippet window.
//
// Snippets. The take is cut into overlapping windows (WINDOW_SEC long, one
// every HOP_SEC). Each window's centre time is looked up on the pointer path
// (linear interpolation between the two pointer samples around that time),
// so a snippet sung halfway through the take lands where the pointer was
// halfway through the take, however fast or slowly it was moving.
import { analyzeVowel } from '../frequency/auto-vowel.js';
import { MAX_HARMONICS as HARMONICS } from '../frequency/vowel-model.js';

// 0.2 s windows: the pitch estimator (YIN, 50–1000 Hz search) needs 2 × the
// longest period = 40 ms per frame and harmonic frames span 8 periods
// (80 ms at 100 Hz, 160 ms at 50 Hz), so 200 ms leaves room for several
// frames to be compared and a median to be taken, while still following a
// vowel that changes over a second or two.
export const WINDOW_SEC = 0.2;
export const HOP_SEC = 0.1;
export const MAX_DRAW_TAKE_SEC = 12;
export const MIN_PATH_POINTS = 2;

/** Best estimate (ms, performance.now clock) of when sample 0 was captured. */
export function estimateStartMs(arrivals, sampleRate) {
  let best = Infinity;
  for (const a of arrivals) {
    if (!a || !Number.isFinite(a.ms) || !Number.isFinite(a.count)) continue;
    const s = a.ms - (a.count / sampleRate) * 1000;
    if (s < best) best = s;
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * Pointer position at time `t` (same clock as path[i].t) by linear
 * interpolation. Times outside the path return null (not part of the drawing).
 */
export function positionAt(path, t) {
  if (!path.length || !Number.isFinite(t)) return null;
  if (t < path[0].t || t > path[path.length - 1].t) return null;
  // binary search for the last sample with time ≤ t
  let lo = 0;
  let hi = path.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  const a = path[lo];
  const b = path[Math.min(path.length - 1, lo + 1)];
  if (b.t <= a.t) return { x: a.x, y: a.y };
  const u = (t - a.t) / (b.t - a.t);
  return { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) };
}

/** Snippet windows [{ from, to, centreSec }] across `length` samples. */
export function snippetWindows(length, sampleRate, windowSec = WINDOW_SEC, hopSec = HOP_SEC) {
  const len = Math.round(windowSec * sampleRate);
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const out = [];
  for (let from = 0; from + len <= length; from += hop) out.push({ from, to: from + len, centreSec: (from + len / 2) / sampleRate });
  return out;
}

/**
 * Analyzes a drawn take.
 *   samples, sampleRate   the recording
 *   startMs               time of sample 0 (estimateStartMs)
 *   path                  [{ x, y, t }] pointer samples, t in ms (same clock)
 * Returns { points, snippets, stats } where points are the usable snippets:
 *   { x, y, t (ms from pointer-down), f0, amps (48), status }
 * and snippets lists every window with its outcome (for the summary).
 */
export function analyzeDrawnTake({ samples, sampleRate, startMs, path, windowSec = WINDOW_SEC, hopSec = HOP_SEC, analyze = analyzeVowel }) {
  const stats = { snippets: 0, usable: 0, silent: 0, unreliable: 0, outsidePath: 0 };
  const snippets = [];
  const points = [];
  if (!path || path.length < 1 || !Number.isFinite(startMs)) return { points, snippets, stats };
  const t0 = path[0].t;
  for (const w of snippetWindows(samples.length, sampleRate, windowSec, hopSec)) {
    stats.snippets++;
    const tAbs = startMs + w.centreSec * 1000;
    const pos = positionAt(path, tAbs);
    const s = { centreSec: w.centreSec, tMs: tAbs - t0, pos, outcome: '' };
    snippets.push(s);
    if (!pos) { s.outcome = 'outside-path'; stats.outsidePath++; continue; }
    const r = analyze(samples, sampleRate, { from: w.from, to: w.to });
    const amps = r.amps ? r.amps.slice(0, HARMONICS) : null;
    const usable = r.status !== 'failed' && Number.isFinite(r.f0) && r.f0 > 0 && amps && amps.some((a) => a > 0);
    if (!usable) {
      const silent = (r.problems || []).some((p) => p.code === 'silent');
      s.outcome = silent ? 'silent' : 'unreliable';
      if (silent) stats.silent++; else stats.unreliable++;
      continue;
    }
    s.outcome = 'usable';
    s.f0 = r.f0;
    stats.usable++;
    points.push({ x: pos.x, y: pos.y, t: Math.round(tAbs - t0), f0: r.f0, amps, status: r.status });
  }
  return { points, snippets, stats };
}

/** Thins a pointer path for storage (keeps first/last, ≥ minGap ms apart). */
export function thinPath(path, minGapMs = 15) {
  if (path.length <= 2) return path.map((p) => ({ ...p }));
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) if (path[i].t - out[out.length - 1].t >= minGapMs) out.push(path[i]);
  out.push(path[path.length - 1]);
  return out.map((p) => ({ x: round(p.x, 4), y: round(p.y, 4), t: round(p.t, 1) }));
}

/** Learned points as vowel-like anchors that blendAt() understands. */
export function takeAnchors(takes) {
  const out = [];
  for (const take of takes || []) {
    if (take.hidden) continue;
    (take.points || []).forEach((p, i) => {
      out.push({
        id: `${take.id}#${i}`, takeId: take.id, name: `${take.name} · ${(p.t / 1000).toFixed(1)} s`,
        pos: { x: p.x, y: p.y }, analysis: { f0: p.f0, amps: p.amps },
      });
    });
  }
  return out;
}

/** Removes the most recent take only. Returns { takes, removed }. */
export function undoLastTake(takes) {
  if (!takes || !takes.length) return { takes: takes ? [...takes] : [], removed: null };
  let k = 0;
  for (let i = 1; i < takes.length; i++) if (String(takes[i].createdAt) >= String(takes[k].createdAt)) k = i;
  return { takes: takes.filter((_, i) => i !== k), removed: takes[k] };
}

/** Cleans a stored take (drops malformed points). */
export function cleanTake(t) {
  if (!t || typeof t !== 'object') return null;
  const num = (v) => Number.isFinite(+v);
  const points = (Array.isArray(t.points) ? t.points : []).filter((p) => p && num(p.x) && num(p.y) && num(p.f0) && +p.f0 > 0 && Array.isArray(p.amps))
    .map((p) => ({ x: clamp01(+p.x), y: clamp01(+p.y), t: num(p.t) ? +p.t : 0, f0: +p.f0, amps: fixAmps(p.amps), status: p.status === 'warning' ? 'warning' : 'ok' }));
  const path = (Array.isArray(t.path) ? t.path : []).filter((p) => p && num(p.x) && num(p.y) && num(p.t)).map((p) => ({ x: clamp01(+p.x), y: clamp01(+p.y), t: +p.t }));
  const s = t.stats || {};
  return {
    id: String(t.id || `take-${Math.random().toString(36).slice(2, 10)}`),
    name: String(t.name || 'Drawn take').slice(0, 40),
    recordingId: t.recordingId ? String(t.recordingId) : null,
    createdAt: t.createdAt || new Date().toISOString(),
    durationSec: num(t.durationSec) ? +t.durationSec : 0,
    path, points,
    stats: { snippets: +s.snippets || 0, usable: points.length, silent: +s.silent || 0, unreliable: +s.unreliable || 0, outsidePath: +s.outsidePath || 0 },
    hidden: t.hidden === true,
  };
}

function fixAmps(a) {
  const out = new Array(HARMONICS).fill(0);
  for (let i = 0; i < HARMONICS && i < a.length; i++) { const v = Number(a[i]); out[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  return out;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function round(v, d) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

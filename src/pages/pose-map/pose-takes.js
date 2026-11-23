// Drawn takes on Motion Morph, for vowels AND fricatives. Pure logic.
//
// Timing is Vowel Morph's (take-model.js: snippetWindows, positionAt): the
// recording is cut into 0.2 s snippets every 0.1 s, and each snippet is put
// where the pointer was at the snippet's centre time. What is new here is
// the analysis of each snippet (pose-sound.js snippetSound):
//   pitched   f0 + 48 harmonic strengths (as before)
//   mixed     f0 + harmonics AND the noise between them (e.g. "zzz")
//   noise     no pitch: the noise spectrum in 24 bands ("shh", "sss", "fff")
//   silent / unreliable   skipped (and counted)
// Vowel Morph's own analyzeDrawnTake only knew "pitched", so noisy snippets
// were skipped there; Motion Morph takes made before this change were too.
import { analyzeVowel } from '../frequency/auto-vowel.js';
import { snippetWindows, positionAt, WINDOW_SEC, HOP_SEC } from '../vowel-morph/take-model.js';
import { snippetSound, findPitch } from './pose-sound.js';

export const TAKE_ANALYSIS_VERSION = 2; // 1 = pitch-only (before November 23, 2026)

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Analyzes a drawn take.
 *   samples, sampleRate   the recording
 *   startMs               time of sample 0 on the pointer clock
 *   path                  [{ x, y, t }] (x/y can be map coordinates or the two angles)
 * Returns { points: [{ x, y, t, kind, voiced, f0, amps, bands, status }], stats, startOffsetMs }.
 */
export function analyzePoseTake({ samples, sampleRate, startMs, path, analyze = analyzeVowel }) {
  const stats = { snippets: 0, usable: 0, pitched: 0, mixed: 0, noise: 0, silent: 0, unreliable: 0, outsidePath: 0 };
  const points = [];
  if (!path || !path.length || !Number.isFinite(startMs)) return { points, stats, startOffsetMs: null };
  const t0 = path[0].t;
  for (const w of snippetWindows(samples.length, sampleRate, WINDOW_SEC, HOP_SEC)) {
    stats.snippets++;
    const tAbs = startMs + w.centreSec * 1000;
    const pos = positionAt(path, tAbs);
    if (!pos) { stats.outsidePath++; continue; }
    const pitch = findPitch(samples, sampleRate, { from: w.from, to: w.to }, analyze);
    const r = snippetSound(samples, sampleRate, w, pitch);
    if (!r.params) { stats[r.outcome === 'silent' ? 'silent' : 'unreliable']++; continue; }
    stats.usable++;
    stats[r.outcome]++;
    const p = r.params;
    points.push({
      x: pos.x, y: pos.y, t: Math.round(tAbs - t0), kind: p.kind, voiced: p.voiced,
      f0: Number.isFinite(p.f0) ? p.f0 : null, amps: p.amps, bands: p.bands, status: pitch.status === 'warning' ? 'warning' : 'ok',
    });
  }
  return { points, stats, startOffsetMs: startMs - t0 };
}

/**
 * When sample 0 of a saved take's recording was captured, relative to the
 * first pointer sample. New takes store it (startOffsetMs). Older takes did
 * not, but each saved point's time is (offset + a snippet centre), so the
 * offset is one of p.t − centre; recording starts at pointer-down, so the
 * candidate closest to 0 is taken. With no saved point at all, 0 is used
 * (recording starts when the pointer goes down; error ≲ one audio chunk).
 */
export function recoverStartOffset(take, sampleRate) {
  if (Number.isFinite(take.startOffsetMs)) return take.startOffsetMs;
  const p = (take.points || [])[0];
  if (!p || !Number.isFinite(p.t)) return 0;
  let best = 0;
  let bestAbs = Infinity;
  const len = Math.round(WINDOW_SEC * sampleRate);
  const hop = Math.round(HOP_SEC * sampleRate);
  for (let k = 0; k < 2000; k++) {
    const centreMs = ((k * hop + len / 2) / sampleRate) * 1000;
    const off = p.t - centreMs;
    if (Math.abs(off) < bestAbs) { bestAbs = Math.abs(off); best = off; }
    if (off < -1000) break;
  }
  return best;
}

/**
 * Analyzes a saved take again from its stored recording with today's
 * snippet analysis. The take's path is stored as angles, so the analysis
 * runs directly on the angles (bend as x, lift as y): placement is the same.
 * Returns the updated take (a new object), or null without a recording.
 */
export function reanalyzePoseTake(take, rec) {
  if (!rec || !rec.samples || !take.path || !take.path.length) return null;
  const path = take.path.map((q) => ({ x: q.bend, y: q.lift, t: q.t }));
  const off = recoverStartOffset(take, rec.sampleRate);
  const a = analyzePoseTake({ samples: rec.samples, sampleRate: rec.sampleRate, startMs: path[0].t + off, path });
  return {
    ...take,
    points: a.points.map((q) => ({ bend: r1(q.x), lift: r1(q.y), t: q.t, kind: q.kind, voiced: q.voiced, f0: q.f0, amps: q.amps, bands: q.bands, status: q.status })),
    stats: a.stats,
    startOffsetMs: off,
    analysisVersion: TAKE_ANALYSIS_VERSION,
  };
}

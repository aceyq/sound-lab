// Analysis of one Vowel Morph recording. It reuses the Vowel Lab's automatic
// analysis unchanged (auto-vowel.js: YIN fundamental from many short frames,
// then Hann-windowed FFT harmonic peaks, median over frames) and keeps only
// what Vowel Morph needs: f0, the 48 strengths and a short summary.
import { analyzeVowel } from '../frequency/auto-vowel.js';
import { defaultSegment, clampSegment } from '../frequency/vowel-model.js';
import { HARMONICS } from './morph-model.js';

export const MIN_TAKE_SEC = 0.3;

/** Default steady section of a take (the middle second). */
export function initialSegment(rec) {
  return clampSegment(defaultSegment(rec.samples.length / rec.sampleRate), rec.samples.length / rec.sampleRate);
}

/**
 * Analyzes rec.samples within `segment` (seconds). With `f0Override` the
 * harmonics are measured at that fundamental and the result is labelled
 * manual. Returns the analysis record stored with the vowel.
 */
export function analyzeTake(rec, segment, f0Override = null) {
  const dur = rec.samples.length / rec.sampleRate;
  const seg = clampSegment(segment || initialSegment(rec), dur);
  const from = Math.round(seg.start * rec.sampleRate);
  const to = Math.round(seg.end * rec.sampleRate);
  const r = analyzeVowel(rec.samples, rec.sampleRate, { from, to, f0Override });
  const kept = (r.harmonics || []).filter((hm) => hm.kept).map((hm) => hm.n);
  const amps = r.amps ? r.amps.slice(0, HARMONICS) : null;
  // A failed analysis keeps no strengths at all, so nothing half-measured plays.
  const usable = r.status !== 'failed' && amps && amps.some((a) => a > 0);
  return {
    segment: seg,
    analysis: {
      status: usable ? r.status : 'failed',
      f0: usable ? r.f0 : null,
      f0Auto: r.f0Auto == null ? null : Math.round(r.f0Auto * 100) / 100,
      f0Source: usable ? r.f0Source : null,
      amps: usable ? amps : null,
      sampleRate: rec.sampleRate,
      warnings: r.warnings.filter((w) => w.code !== 'manual').map((w) => w.message),
      problems: r.problems.map((p) => p.message),
      facts: {
        sectionSec: [seg.start, seg.end],
        framesPeriodic: r.stats.framesPeriodic,
        framesTotal: r.stats.framesTotal,
        pitchSpreadCents: r.stats.spreadCents == null ? null : Math.round(r.stats.spreadCents),
        levelDb: Math.round(r.stats.rmsDb * 10) / 10,
        harmonicsKept: kept,
        framesUsed: r.measurement ? r.measurement.framesUsed : 0,
        nyquist: rec.sampleRate / 2,
      },
    },
  };
}

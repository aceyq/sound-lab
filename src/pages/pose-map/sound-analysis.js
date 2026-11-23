// "Add my sound" analysis for Motion Morph. Pure logic (no DOM, no Web
// Audio), unit-tested with `npm test`.
//
// It reuses the Vowel Lab / Vowel Morph analysis unchanged (auto-vowel.js:
// YIN fundamental from many short frames, then Hann-windowed FFT harmonic
// peaks, median over frames). What is new here is only:
//   • which part of the recording is analyzed (the steady middle: the first
//     0.4 s and last 0.3 s are skipped, where people usually start and stop),
//   • a plain-language report of what was measured and what will be
//     synthesized, and
//   • a plain-language reason + tip when no usable estimate came out, and
//   • unvoiced fricatives ("sss", "shh", "fff"): when there is no pitch, the
//     recording is checked for fricative-like noise and, if it is one, kept
//     as a NOISE sound (its noise spectrum, no f0; see pose-sound.js).
import { analyzeVowel } from '../frequency/auto-vowel.js';
import { noiseSpectrum, classifyNoise, strongestBand } from './pose-sound.js';
import { MAX_HARMONICS } from '../frequency/vowel-model.js';

export const REC_SEC = 3;
export const SKIP_START_SEC = 0.4;
export const SKIP_END_SEC = 0.3;
export const MIN_REC_SEC = 1;

/** The analyzed section (seconds) of a recording `durSec` long. */
export function steadySection(durSec) {
  if (durSec < 1.2) return { start: 0, end: durSec };
  return { start: SKIP_START_SEC, end: Math.max(SKIP_START_SEC + 0.5, durSec - SKIP_END_SEC) };
}

const TIPS = {
  silent: 'I could not hear anything. Check that the right microphone is selected and allowed, move a little closer, and make the sound for the whole 3 seconds.',
  'not-periodic': 'The sound had no clear, steady pitch and was not a clear hiss either. Pitched sounds that work: sung vowels (“ah”, “ee”, “oo”), humming (“mmm”). Unvoiced fricatives that work: a steady “sss”, “shh” or “fff” close to the microphone. Clicks, speech, voiced fricatives (“zzz”, “vvv”) and noisy rooms cannot be rebuilt.',
  mixed: 'Make either one steady pitched sound (a vowel or a hum) or one steady unvoiced hiss (“sss”, “shh”, “fff”), not a mix. Voiced fricatives like “zzz” and “vvv” are not supported yet.',
  'low-noise': 'For a fricative, hiss steadily (“sss”, “shh”, “fff”) a hand’s width from the microphone, without blowing on it.',
  'few-harmonics': 'A pitch was found, but almost no harmonics stood out above the noise, so there is nothing to rebuild the sound from. Try a little louder and fuller (an open “ah” or a strong hum), away from fans or music.',
  'too-short': 'The recording was too short to measure. Keep the sound going for the whole countdown.',
};

/**
 * Analyzes one recording { samples, sampleRate }. Returns
 *   { ok, analysis: { status, f0, amps, summary } | null, section, reason, tip, warnings }
 * `summary` is what the page shows under “What the app heard”.
 */
export function analyzeMySound(rec) {
  const dur = rec.samples.length / rec.sampleRate;
  if (dur < MIN_REC_SEC) {
    return { ok: false, analysis: null, section: null, code: 'too-short', reason: `Only ${dur.toFixed(1)} s were recorded.`, tip: TIPS['too-short'], warnings: [] };
  }
  const section = steadySection(dur);
  const from = Math.round(section.start * rec.sampleRate);
  const to = Math.round(section.end * rec.sampleRate);
  const r = analyzeVowel(rec.samples, rec.sampleRate, { from, to });
  const amps = r.amps ? r.amps.slice(0, MAX_HARMONICS) : null;
  const usable = r.status !== 'failed' && Number.isFinite(r.f0) && r.f0 > 0 && amps && amps.some((a) => a > 0);
  const warnings = (r.warnings || []).filter((w) => w.code !== 'manual').map((w) => w.code);
  if (!usable) {
    const p = (r.problems || [])[0];
    const code = p ? p.code : 'not-periodic';
    // No pitch: is it an unvoiced fricative? Then keep it as a noise sound.
    if (code !== 'silent') {
      const spec = noiseSpectrum(rec.samples, rec.sampleRate, { from, to });
      const share = r.stats.framesTotal ? r.stats.framesPeriodic / r.stats.framesTotal : 0;
      const c = classifyNoise(spec, share);
      if (c.ok) {
        const summary = {
          kind: 'noise',
          sectionSec: [Math.round(section.start * 100) / 100, Math.round(section.end * 100) / 100],
          framesPeriodic: r.stats.framesPeriodic,
          framesTotal: r.stats.framesTotal,
          levelDb: Math.round(spec.levelDb * 10) / 10,
          centroidHz: Math.round(spec.centroidHz),
          highShare: Math.round(spec.highShare * 100) / 100,
          strongestBand: strongestBand(spec.bands),
          warnings: [],
        };
        return { ok: true, analysis: { kind: 'noise', status: 'ok', f0: null, amps: [], noise: { bands: spec.bands }, summary }, section, code: null, reason: '', tip: '', warnings: [] };
      }
      if (c.code === 'mixed' || c.code === 'low-noise') {
        return { ok: false, analysis: null, section, code: c.code, reason: c.reason, tip: TIPS[c.code], warnings };
      }
    }
    const reason = code === 'silent' ? `The recording is silent or nearly silent (level ${r.stats.rmsDb.toFixed(0)} dBFS).`
      : code === 'not-periodic' ? `Only ${r.stats.framesPeriodic} of ${r.stats.framesTotal} short frames had a clear repeating pitch (at least half are needed).`
        : code === 'few-harmonics' ? `A pitch near ${Math.round(r.f0)} Hz was found, but only ${(r.harmonics || []).filter((x) => x.kept).length} harmonic stood out above the noise.`
          : 'No usable estimate came out.';
    return { ok: false, analysis: null, section, code, reason, tip: TIPS[code] || TIPS['not-periodic'], warnings };
  }
  const kept = r.harmonics.filter((x) => x.kept).map((x) => x.n);
  const summary = {
    kind: 'pitched',
    sectionSec: [Math.round(section.start * 100) / 100, Math.round(section.end * 100) / 100],
    framesPeriodic: r.stats.framesPeriodic,
    framesTotal: r.stats.framesTotal,
    spreadCents: r.stats.spreadCents == null ? null : Math.round(r.stats.spreadCents),
    levelDb: Math.round(r.stats.rmsDb * 10) / 10,
    harmonicsKept: kept.length,
    strongest: r.strongest || null,
    warnings,
  };
  return { ok: true, analysis: { kind: 'pitched', status: r.status === 'warning' ? 'warning' : 'ok', f0: r.f0, amps, summary }, section, code: null, reason: '', tip: '', warnings };
}

const WARN_TEXT = {
  unstable: 'the pitch wandered, so the steady middle value is used',
  octave: 'a few frames jumped an octave and were ignored',
  gaps: 'some frames were unclear and left out',
  quiet: 'it was quiet, so weak harmonics may be noise',
  clipped: 'it was so loud that it clipped; a little softer is better',
  'no-h1': 'the fundamental itself was weak',
  'few-frames': 'only a few frames could be measured',
};

/** Short readable list of warnings (empty string if none). */
export function warningText(codes) {
  const list = (codes || []).map((c) => WARN_TEXT[c]).filter(Boolean);
  return list.length ? `Note: ${list.join('; ')}.` : '';
}

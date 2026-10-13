// Pure helpers for the component table: validation, normalization and the
// "what does this mixture repeat at?" analysis. No DOM or audio here, so the
// logic can be unit-tested with `npm test`.

export const MAX_COMPONENTS = 16;
export const FREQ_MIN = 20;
export const FREQ_MAX = 10000;

// One color per component label (C1 → PALETTE[0], ...), readable on dark.
export const PALETTE = [
  '#4fc3f7', '#ffb74d', '#81c784', '#f06292', '#ba68c8', '#fff176', '#4db6ac', '#ff8a65',
  '#9575cd', '#aed581', '#e57373', '#64b5f6', '#dce775', '#f48fb1', '#80cbc4', '#ffd54f',
];

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseNumber(text) {
  const s = String(text ?? '').trim();
  if (s === '') return { ok: false, empty: true };
  if (s.includes(',')) return { ok: false, comma: true };
  if (!NUMBER_RE.test(s)) return { ok: false };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false };
  return { ok: true, value: v };
}

/** Validate a typed frequency. `nyquist` is half the real audio sample rate. */
export function parseFrequency(text, nyquist) {
  const n = parseNumber(text);
  if (n.empty) return { ok: false, error: 'Type a frequency in Hz, for example 220.' };
  if (n.comma) return { ok: false, error: 'Remove the comma. Write 1000, or 137.5 for decimals.' };
  if (!n.ok) return { ok: false, error: 'Not a number. Use digits, for example 220 or 137.5.' };
  const v = n.value;
  if (v < FREQ_MIN) {
    return { ok: false, error: `Too low. Use at least ${FREQ_MIN} Hz (lower is below typical hearing and laptop speakers).` };
  }
  if (v >= nyquist) {
    return {
      ok: false,
      error: `Must be below the Nyquist frequency, ${fmt(nyquist)} Hz (half the ${fmt(nyquist * 2)} Hz sample rate).`,
    };
  }
  if (v > FREQ_MAX) return { ok: false, error: `Too high for this app. Use at most ${fmt(FREQ_MAX)} Hz.` };
  return { ok: true, value: v };
}

/** Validate a typed amplitude (0 to 1). */
export function parseAmplitude(text) {
  const n = parseNumber(text);
  if (n.empty) return { ok: false, error: 'Type an amplitude between 0 and 1, for example 0.5.' };
  if (n.comma) return { ok: false, error: 'Use a period for decimals, for example 0.5.' };
  if (!n.ok) return { ok: false, error: 'Not a number. Use a value from 0 to 1, for example 0.5.' };
  if (n.value < 0 || n.value > 1) return { ok: false, error: 'Amplitude must be between 0 and 1.' };
  return { ok: true, value: n.value };
}

/** Components that actually contribute sound: enabled and amplitude > 0. */
export function activeComponents(comps) {
  return comps.filter((c) => c.enabled && c.amp > 0);
}

/**
 * Shared normalization factor. The peak of Σ Aᵢ sin(...) can never exceed
 * Σ|Aᵢ|, so scaling by 1/Σ|Aᵢ| (only when that sum is above 1) guarantees no
 * clipping and multiplies every component by the same number, which keeps
 * their ratios unchanged.
 */
export function normalization(comps) {
  const sum = activeComponents(comps).reduce((s, c) => s + Math.abs(c.amp), 0);
  return { sum, factor: sum > 1 ? 1 / sum : 1 };
}

function gcdInt(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Largest frequency that every active frequency is a whole-number multiple of,
 * computed on values rounded to 0.01 Hz. The combined waveform repeats exactly
 * every 1/base seconds. Returns null for an empty mixture.
 */
export function commonBase(freqs) {
  if (!freqs.length) return null;
  const ints = freqs.map((f) => Math.round(f * 100));
  const rounded = freqs.some((f, i) => Math.abs(f * 100 - ints[i]) > 1e-6);
  let g = ints[0];
  for (const v of ints.slice(1)) g = gcdInt(g, v);
  const base = g / 100;
  return { base, period: 1 / base, rounded, multiples: freqs.map((f) => Math.round(f / base)) };
}

/** Random mixture: 3–6 well-separated frequencies in a comfortable range. */
export function randomMixture(rand = Math.random) {
  const count = 3 + Math.floor(rand() * 4);
  const freqs = [];
  let guard = 0;
  while (freqs.length < count && guard++ < 500) {
    // 150–1200 Hz, one decimal place, at least 25 Hz from every other pick.
    const f = Math.round((150 + rand() * 1050) * 10) / 10;
    if (freqs.every((g) => Math.abs(g - f) >= 25)) freqs.push(f);
  }
  freqs.sort((a, b) => a - b);
  return freqs.map((f) => ({ freq: f, amp: Math.round((0.3 + rand() * 0.7) * 100) / 100 }));
}

/** Harmonic Builder: base × 1, 2, ..., n with amplitudes 1/k. */
export function harmonicSeries(base, count) {
  return Array.from({ length: count }, (_, i) => ({
    freq: Math.round(base * (i + 1) * 1000) / 1000,
    amp: Math.round((1 / (i + 1)) * 100) / 100,
  }));
}

function fmt(v) {
  return Number(v.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

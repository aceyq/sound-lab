import {
  CanvasSurface, COLORS, linearTicks, logTicks, freqToUnit, unitToFreq, fmtHzTick, drawMessage,
} from './plot.js';

const PAD = { l: 60, r: 16, t: 30, b: 46 };
export const DB_MIN = -120;
export const DB_MAX = 0;
export const SILENCE_DB = -110;

/** Replace -Infinity/NaN (silence) with a finite floor. */
export function finiteDb(v) {
  return Number.isFinite(v) ? v : DB_MIN - 20;
}

/**
 * Local maxima in an FFT magnitude array (dB), with parabolic interpolation
 * for a sub-bin frequency estimate. Returns peaks sorted by frequency.
 */
/** True when every bin is below the silence threshold (or non-finite). */
export function isSilent(data) {
  for (let i = 1; i < data.length; i++) if (finiteDb(data[i]) >= SILENCE_DB) return false;
  return true;
}

export function findPeaks(data, binHz, { minHz = 0, maxHz = Infinity, maxPeaks = 16 } = {}) {
  let top = -Infinity;
  for (let i = 1; i < data.length; i++) top = Math.max(top, finiteDb(data[i]));
  if (top < SILENCE_DB) return [];
  const threshold = Math.max(SILENCE_DB, top - 50);
  const peaks = [];
  const lo = Math.max(2, Math.floor(minHz / binHz));
  const hi = Math.min(data.length - 3, Math.ceil(maxHz / binHz));
  for (let i = lo; i <= hi; i++) {
    const v = finiteDb(data[i]);
    if (v < threshold) continue;
    let isMax = true;
    for (let j = i - 2; j <= i + 2; j++) {
      if (j !== i && finiteDb(data[j]) > v) isMax = false;
    }
    if (!isMax || finiteDb(data[i - 1]) === v) continue;
    const a = finiteDb(data[i - 1]);
    const c = finiteDb(data[i + 1]);
    const denom = a - 2 * v + c;
    const offset = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    peaks.push({ freq: (i + offset) * binHz, db: v });
  }
  peaks.sort((p, q) => q.db - p.db);
  return peaks.slice(0, maxPeaks).sort((p, q) => p.freq - q.freq);
}

export class SpectrumView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  /**
   * opts: { data: Float32Array|null, binHz, mode: 'idle'|'warming'|'live'|'frozen',
   *         min, max, log, expected: [{freq,color,label}], peaks }
   */
  render({ data, binHz, mode, min, max, log, expected, peaks, silent, messages = {} }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const pw = Math.max(10, sf.w - PAD.l - PAD.r);
    const ph = Math.max(10, sf.h - PAD.t - PAD.b);
    const xOf = (f) => PAD.l + freqToUnit(f, min, max, log) * pw;
    const yOf = (db) => PAD.t + ((DB_MAX - db) / (DB_MAX - DB_MIN)) * ph;

    // Grid + axis labels.
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const db of linearTicks(DB_MIN, DB_MAX, 6)) {
      const y = Math.round(yOf(db)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + pw, y);
      ctx.stroke();
      ctx.fillText(String(db), PAD.l - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = log ? logTicks(min, max) : linearTicks(min, max, Math.max(3, Math.floor(pw / 80)));
    for (const f of ticks) {
      const x = Math.round(xOf(f)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, PAD.t + ph);
      ctx.stroke();
      ctx.fillText(fmtHzTick(f), x, PAD.t + ph + 6);
    }
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`Frequency (Hz, ${log ? 'logarithmic' : 'linear'} axis)`, PAD.l + pw / 2, PAD.t + ph + 24);
    ctx.save();
    ctx.translate(14, PAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Magnitude (dB)', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t - 30, pw, ph + 30);
    ctx.clip();

    // Expected components (from the table): dashed colored lines.
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const e of expected) {
      if (e.freq < min || e.freq > max) continue;
      const x = Math.round(xOf(e.freq)) + 0.5;
      ctx.strokeStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, PAD.t + ph);
      ctx.stroke();
      ctx.fillStyle = e.color;
      ctx.fillText(e.label, x, PAD.t - 4);
    }
    ctx.setLineDash([]);

    const showData = data && (mode === 'live' || mode === 'frozen');
    if (showData) {
      // Measured FFT: take the max of all bins inside each pixel column so a
      // narrow peak is never skipped when many bins share one pixel.
      ctx.beginPath();
      const cols = Math.round(pw);
      let started = false;
      for (let px = 0; px <= cols; px++) {
        const f0 = unitToFreq(px / cols, min, max, log);
        const f1 = unitToFreq((px + 1) / cols, min, max, log);
        let b0 = Math.max(0, Math.round(f0 / binHz));
        let b1 = Math.min(data.length - 1, Math.max(b0, Math.round(f1 / binHz) - 1));
        if (b0 >= data.length) break;
        let v = -Infinity;
        for (let b = b0; b <= b1; b++) v = Math.max(v, finiteDb(data[b]));
        v = Math.max(DB_MIN, Math.min(DB_MAX, v));
        const x = PAD.l + px;
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.lineTo(PAD.l + pw, PAD.t + ph);
      ctx.lineTo(PAD.l, PAD.t + ph);
      ctx.closePath();
      ctx.fillStyle = mode === 'frozen' ? 'rgba(140,160,180,0.18)' : 'rgba(88,209,255,0.22)';
      ctx.fill();
      ctx.strokeStyle = mode === 'frozen' ? '#9aa8b8' : '#58d1ff';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Measured peaks: white dots with their measured frequency.
      ctx.fillStyle = COLORS.peak;
      ctx.textBaseline = 'bottom';
      ctx.font = '12px system-ui, sans-serif';
      for (const p of peaks) {
        if (p.freq < min || p.freq > max) continue;
        const x = xOf(p.freq);
        const y = yOf(Math.min(DB_MAX, p.db));
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(Math.round(p.freq * 10) / 10 + '', x, y - 6);
      }
    }
    ctx.restore();

    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(PAD.l + 0.5, PAD.t + 0.5, pw, ph);

    if (mode === 'idle') {
      drawMessage(ctx, sf, messages.idle || ['Press Play to measure', 'This plot shows real FFT measurements of the sound, so it needs audio running.', 'Dashed lines already show where the components should appear.']);
    } else if (mode === 'warming') {
      drawMessage(ctx, sf, ['Measuring…', 'Collecting the first block of audio for the FFT.']);
    } else if (showData && silent) {
      drawMessage(ctx, sf, messages.silent || ['Silence', 'No measurable signal: every component is off or at amplitude 0.']);
    }
  }

  dispose() {
    this.surface.dispose();
  }
}

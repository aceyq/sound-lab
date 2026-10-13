import { CanvasSurface, COLORS, linearTicks, drawMessage } from './plot.js';
import { fmtTime } from '../../lib/dom.js';

const PAD = { l: 64, r: 16, t: 16, b: 46 };
const MAX_TOTAL_SAMPLES = 2_000_000;

/**
 * Evaluates x(t) = Σ g·Aᵢ sin(2π fᵢ t) over [0, duration] and reduces it to
 * min/max/first/last per pixel column. Sampling is dense (≈16 samples per
 * period of the highest frequency, at least 4 per column), so even at long
 * windows each column's min/max is the true range of the signal there,
 * instead of a sparse, aliased curve.
 */
export function computeColumns(comps, gain, duration, cols) {
  const min = new Float32Array(cols);
  const max = new Float32Array(cols);
  const first = new Float32Array(cols);
  const last = new Float32Array(cols);
  const n = comps.length;
  if (!n || cols < 1 || !(duration > 0)) return { min, max, first, last, peak: 0 };

  const fmax = Math.max(...comps.map((c) => c.freq));
  let spc = Math.ceil((16 * fmax * duration) / cols);
  spc = Math.max(4, Math.min(spc, Math.floor(MAX_TOTAL_SAMPLES / cols)));
  const dt = duration / (cols * spc);

  const w = comps.map((c) => 2 * Math.PI * c.freq);
  const a = comps.map((c) => c.amp * gain);
  const cd = w.map((wi) => Math.cos(wi * dt));
  const sd = w.map((wi) => Math.sin(wi * dt));
  const s = new Float64Array(n);
  const co = new Float64Array(n);
  let peak = 0;

  for (let col = 0; col < cols; col++) {
    // Re-seed each column with exact sin/cos so rotation drift cannot build up.
    const t = col * spc * dt;
    for (let i = 0; i < n; i++) {
      s[i] = Math.sin(w[i] * t);
      co[i] = Math.cos(w[i] * t);
    }
    let lo = Infinity;
    let hi = -Infinity;
    let v = 0;
    for (let k = 0; k <= spc; k++) {
      v = 0;
      for (let i = 0; i < n; i++) {
        v += a[i] * s[i];
        const ns = s[i] * cd[i] + co[i] * sd[i];
        co[i] = co[i] * cd[i] - s[i] * sd[i];
        s[i] = ns;
      }
      if (k === 0) first[col] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    last[col] = v;
    min[col] = lo;
    max[col] = hi;
    peak = Math.max(peak, Math.abs(lo), Math.abs(hi));
  }
  return { min, max, first, last, peak };
}

export class WaveformView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  plotWidth() {
    return Math.max(10, this.surface.w - PAD.l - PAD.r);
  }

  /**
   * opts: { comps:[{freq,amp,color}], gain, duration, vScale ('auto'|number),
   *         overlays:boolean }
   * Returns { range, dense, periodPx } for the explanatory text.
   */
  render({ comps, gain, duration, vScale, overlays }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const pw = this.plotWidth();
    const ph = Math.max(10, sf.h - PAD.t - PAD.b);
    const cols = Math.round(pw);

    const mix = computeColumns(comps, gain, duration, cols);
    const range = vScale === 'auto' ? (mix.peak > 0 ? niceRange(mix.peak * 1.08) : 1) : vScale;
    const yOf = (v) => PAD.t + ph / 2 - (v / range) * (ph / 2);

    // Grid and axes.
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of linearTicks(-range, range, 6)) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + pw, y);
      ctx.stroke();
      ctx.fillText(trimNum(v), PAD.l - 8, y);
    }
    const unitMs = duration < 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tTicks = linearTicks(0, unitMs ? duration * 1000 : duration, Math.max(3, Math.floor(pw / 90)));
    for (const tv of tTicks) {
      const x = Math.round(PAD.l + (tv / (unitMs ? duration * 1000 : duration)) * pw) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, PAD.t + ph);
      ctx.stroke();
      ctx.fillText(trimNum(tv), x, PAD.t + ph + 6);
    }
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`Time (${unitMs ? 'ms' : 's'}) since all components started together`, PAD.l + pw / 2, PAD.t + ph + 24);
    ctx.save();
    ctx.translate(16, PAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Signal amplitude', 0, 0);
    ctx.restore();

    // Zero line.
    ctx.strokeStyle = COLORS.zero;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, Math.round(yOf(0)) + 0.5);
    ctx.lineTo(PAD.l + pw, Math.round(yOf(0)) + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, pw, ph);
    ctx.clip();

    if (overlays) {
      for (const c of comps) {
        const one = computeColumns([c], gain, duration, cols);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 1.4;
        tracePath(ctx, one, yOf, PAD.l, pw / cols);
      }
      ctx.globalAlpha = 1;
    }

    ctx.shadowColor = 'rgba(120,220,255,0.55)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = COLORS.signal;
    ctx.lineWidth = 2.2;
    tracePath(ctx, mix, yOf, PAD.l, pw / cols);
    ctx.restore();

    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(PAD.l + 0.5, PAD.t + 0.5, pw, ph);

    if (!comps.length) {
      drawMessage(ctx, sf, ['Silence', 'All components are disabled or at amplitude 0, so x(t) = 0.']);
    }

    const fmax = comps.length ? Math.max(...comps.map((c) => c.freq)) : 0;
    const periodPx = fmax ? (1 / fmax / duration) * pw : Infinity;
    return { range, periodPx, dense: periodPx < 4, timeLabel: fmtTime(duration) };
  }

  dispose() {
    this.surface.dispose();
  }
}

// Draws each column as a vertical min–max segment joined to its neighbours.
// Sparse waves become a normal curve; dense ones become an honest filled band.
function tracePath(ctx, d, yOf, x0, colW) {
  const n = d.min.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * colW;
    if (i === 0) ctx.moveTo(x, yOf(d.first[i]));
    else ctx.lineTo(x, yOf(d.first[i]));
    if (d.max[i] - d.min[i] > 1e-9) {
      ctx.lineTo(x, yOf(d.min[i]));
      ctx.lineTo(x, yOf(d.max[i]));
      ctx.lineTo(x, yOf(d.last[i]));
    }
  }
  ctx.stroke();
}

function niceRange(v) {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  return steps.find((s) => s >= v) || v;
}

function trimNum(v) {
  return Number(v.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

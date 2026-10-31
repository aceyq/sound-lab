// Canvas views for Vowel filtering. Two panels share one frequency axis (the
// same left/right padding, so a frequency sits at the same x in both):
//   • FilterResponseView: the filter's gain in dB (0 at the top = let
//     through), the draggable band points, and the gain each harmonic gets;
//   • FilterSpectrumView: measured spectra in dB re each curve's own
//     strongest peak (orange recording, cyan filtered, grey unfiltered).
// Their vertical scales mean different things, so they are never mixed.
import { CanvasSurface, COLORS, linearTicks, logTicks, fmtHzTick, drawMessage } from './plot.js';
import * as VF from './vowel-filter.js';
import { ORIG, SYNTH, MARK } from './vowel-plots.js';

export const RESPONSE = '#c3e88d';
export const UNFILTERED = '#9aa7b6';
export const PAD = { l: 64, r: 16, t: 24, b: 40 };
export const GAIN_VIEW = [-60, 6];

export function xMapper(sf, { min, max, log }) {
  const r = plotRect(sf);
  const lo = log ? Math.max(30, min) : min;
  const u = (f) => (log ? (Math.log(f) - Math.log(lo)) / (Math.log(max) - Math.log(lo)) : (f - lo) / (max - lo));
  return {
    r, lo,
    xOf: (f) => r.x + u(f) * r.w,
    fAt: (x) => {
      const t = (x - r.x) / r.w;
      return log ? Math.exp(Math.log(lo) + t * (Math.log(max) - Math.log(lo))) : lo + t * (max - lo);
    },
  };
}

function plotRect(sf) {
  return { x: PAD.l, y: PAD.t, w: Math.max(10, sf.w - PAD.l - PAD.r), h: Math.max(10, sf.h - PAD.t - PAD.b) };
}

function xAxis(ctx, m, { max, log }) {
  const { r, lo, xOf } = m;
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 1;
  const ticks = log ? logTicks(lo, max) : linearTicks(lo, max, Math.max(3, Math.floor(r.w / 80)));
  for (const v of ticks) {
    const x = Math.round(xOf(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, r.y);
    ctx.lineTo(x, r.y + r.h);
    ctx.stroke();
    ctx.fillText(fmtHzTick(v), x, r.y + r.h + 6);
  }
}

function yAxis(ctx, r, lo, hi, yOf, label, step = null) {
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticks = step ? Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => hi - (hi % step) - i * step).filter((v) => v >= lo) : linearTicks(lo, hi, 5);
  for (const v of ticks) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(r.x, y);
    ctx.lineTo(r.x + r.w, y);
    ctx.stroke();
    ctx.fillText(String(v), r.x - 8, y);
  }
  ctx.save();
  ctx.fillStyle = COLORS.muted;
  ctx.translate(14, r.y + r.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/** The filter's gain curve with its draggable points. */
export class FilterResponseView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
    this.handles = [];
    this.map = null;
  }

  gainAt(y) {
    const r = plotRect(this.surface);
    const [lo, hi] = GAIN_VIEW;
    return hi - ((y - r.y) / r.h) * (hi - lo);
  }

  /** Index of the handle under (x, y), or the nearest within `radius` px; -1 if none. */
  hit(x, y, radius = 28) {
    let best = -1;
    let bd = Infinity;
    this.handles.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    return bd <= radius ? best : -1;
  }

  /**
   * opts: { bands, enabled, selected, sampleRate, min, max, log,
   *         components: [{ freq, amp, on }], formants: [F1, F2, F3] | null, dragging }
   */
  render({ bands, enabled, selected = -1, sampleRate, min, max, log, components = [], formants = null, dragging = false }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const m = xMapper(sf, { min, max, log });
    this.map = m;
    const { r, xOf } = m;
    const [lo, hi] = GAIN_VIEW;
    const yOf = (db) => r.y + ((hi - Math.max(lo, Math.min(hi, db))) / (hi - lo)) * r.h;
    xAxis(ctx, m, { max, log });
    yAxis(ctx, r, lo, hi, yOf, 'Filter gain (dB)', 10);
    // "Let through" region label at 0 dB.
    ctx.strokeStyle = '#4c5d70';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r.x, Math.round(yOf(0)) + 0.5);
    ctx.lineTo(r.x + r.w, Math.round(yOf(0)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(r.w > 420 ? '0 dB (top) = let through unchanged · lower = that region reduced' : '0 dB = unchanged · lower = reduced', r.x, r.y - 6);

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y - 20, r.w, r.h + 20);
    ctx.clip();
    if (formants) {
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = ORIG;
      ctx.fillStyle = ORIG;
      ctx.globalAlpha = 0.8;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      formants.forEach((F, i) => {
        if (F < m.lo || F > max) return;
        const x = Math.round(xOf(F)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
        ctx.stroke();
        ctx.fillText(`F${i + 1}`, x + 9, r.y + r.h - 4);
      });
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    const cols = Math.max(2, Math.round(r.w));
    const freqs = Array.from({ length: cols + 1 }, (_, c) => m.fAt(r.x + c));
    // The selected band's own curve (thin dashed) so its share is visible.
    if (selected >= 0 && bands[selected]) {
      const one = VF.responseDb([bands[selected]], freqs, sampleRate);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      one.forEach((d, c) => (c ? ctx.lineTo(r.x + c, yOf(d)) : ctx.moveTo(r.x + c, yOf(d))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // The total response actually applied (the product of all bands).
    const total = VF.responseDb(bands, freqs, sampleRate);
    ctx.beginPath();
    total.forEach((d, c) => (c ? ctx.lineTo(r.x + c, yOf(d)) : ctx.moveTo(r.x + c, yOf(d))));
    ctx.lineTo(r.x + r.w, r.y);
    ctx.lineTo(r.x, r.y);
    ctx.closePath();
    ctx.fillStyle = enabled ? 'rgba(195,232,141,0.10)' : 'rgba(154,167,182,0.06)';
    ctx.fill();
    ctx.beginPath();
    total.forEach((d, c) => (c ? ctx.lineTo(r.x + c, yOf(d)) : ctx.moveTo(r.x + c, yOf(d))));
    ctx.strokeStyle = enabled ? RESPONSE : UNFILTERED;
    ctx.lineWidth = 2.6;
    if (!enabled) ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Each source component sits at a fixed frequency; the filter only sets its gain.
    const hs = VF.componentGains(components, bands, sampleRate, true);
    for (const x0 of hs) {
      if (x0.freq < m.lo || x0.freq > max) continue;
      const x = xOf(x0.freq);
      ctx.fillStyle = MARK;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(x, yOf(x0.gainDb), 2.6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillRect(Math.round(x) - 0.5, r.y + r.h - 6, 1, 6);
      ctx.globalAlpha = 1;
    }
    // Draggable points: centre (x) and that band's own cut (y).
    this.handles = bands.map((b, i) => ({ x: xOf(b.f), y: yOf(b.gainDb), i }));
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.handles) {
      const sel = p.i === selected;
      const x = Math.max(r.x, Math.min(r.x + r.w, p.x));
      ctx.beginPath();
      ctx.arc(x, p.y, sel ? 11 : 9, 0, 2 * Math.PI);
      ctx.fillStyle = sel ? '#ffffff' : enabled ? '#1d2a14' : '#1a1f26';
      ctx.fill();
      ctx.lineWidth = sel ? 3 : 2;
      ctx.strokeStyle = enabled ? RESPONSE : UNFILTERED;
      ctx.stroke();
      ctx.fillStyle = sel ? '#111' : '#e6edf3';
      ctx.fillText(String(p.i + 1), x, p.y + 0.5);
      if (sel && dragging) {
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'bottom';
        const b = bands[p.i];
        ctx.fillText(`${Math.round(b.f)} Hz · ${b.gainDb.toFixed(1)} dB`, Math.min(r.x + r.w - 50, Math.max(r.x + 50, x)), p.y - 14);
        ctx.textBaseline = 'middle';
      }
    }
    ctx.restore();
    if (!enabled) {
      ctx.fillStyle = '#ffe7a3';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('FILTER BYPASSED: settings kept, sound unfiltered', r.x + 8, r.y + 6);
    }
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  }

  dispose() { this.surface.dispose(); }
}

/** Measured spectra (dB re each curve's own strongest peak). */
export class FilterSpectrumView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  /** opts: { orig, filtered, unfiltered: {db, binHz}|null, min, max, log, marks: [Hz] (source components), nyquist, hoverX } → readout */
  render({ orig, filtered, unfiltered, min, max, log, marks = [], nyquist, hoverX = null, message = null }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const m = xMapper(sf, { min, max, log });
    const { r, xOf, fAt } = m;
    const lo = -80;
    const hi = 5;
    const yOf = (db) => r.y + ((hi - Math.max(lo, Math.min(hi, db))) / (hi - lo)) * r.h;
    xAxis(ctx, m, { max, log });
    yAxis(ctx, r, lo, hi, yOf, 'dB re own strongest peak');
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Frequency (Hz)', r.x + r.w / 2, r.y + r.h + 22);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y - 20, r.w, r.h + 20);
    ctx.clip();
    if (marks.length) {
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = MARK;
      ctx.globalAlpha = 0.45;
      for (const f of marks) {
        if (f > max || f >= nyquist || f < m.lo) continue;
        const x = Math.round(xOf(f)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    const cols = Math.max(2, Math.round(r.w));
    const curve = (s, color, { fill = null, dash = null, width = 1.6 } = {}) => {
      if (!s) return;
      ctx.beginPath();
      let started = false;
      for (let c = 0; c <= cols; c++) {
        const fa = fAt(r.x + c);
        const fb = fAt(r.x + c + 1);
        const b0 = Math.max(0, Math.round(fa / s.binHz));
        if (b0 >= s.db.length) break;
        const b1 = Math.min(s.db.length - 1, Math.max(b0, Math.round(fb / s.binHz) - 1));
        let v = -Infinity;
        for (let b = b0; b <= b1; b++) v = Math.max(v, s.db[b]);
        const y = yOf(v);
        if (!started) { ctx.moveTo(r.x + c, y); started = true; } else ctx.lineTo(r.x + c, y);
      }
      if (fill) {
        ctx.lineTo(r.x + r.w, r.y + r.h);
        ctx.lineTo(r.x, r.y + r.h);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    curve(orig, ORIG, { fill: 'rgba(255,183,77,0.16)' });
    curve(unfiltered, UNFILTERED, { dash: [5, 4], width: 1.2 });
    curve(filtered, SYNTH, { width: 1.8 });
    let readout = null;
    if (hoverX != null && hoverX >= r.x && hoverX <= r.x + r.w) {
      const f = fAt(hoverX);
      const at = (s) => (s ? s.db[Math.max(0, Math.min(s.db.length - 1, Math.round(f / s.binHz)))] : null);
      readout = { freq: f, orig: at(orig), filtered: at(filtered), unfiltered: at(unfiltered) };
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hoverX) + 0.5, r.y);
      ctx.lineTo(Math.round(hoverX) + 0.5, r.y + r.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    if (!orig && !filtered && !unfiltered) drawMessage(ctx, sf, message || ['Nothing to show yet', 'Choose a recording, or start the source.']);
    return readout;
  }

  dispose() { this.surface.dispose(); }
}

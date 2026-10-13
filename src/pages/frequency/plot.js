// Shared canvas helpers: crisp HiDPI sizing, tick generation, axis drawing.

export const COLORS = {
  bg: '#0b0f14',
  grid: '#1f2a36',
  axis: '#8b98a8',
  text: '#c9d4e0',
  muted: '#7d8a99',
  zero: '#5b6b7d',
  signal: '#ffffff',
  peak: '#ffffff',
};

export const FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Keeps a canvas's backing store matched to its CSS size × devicePixelRatio. */
export class CanvasSurface {
  constructor(canvas, onResize) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.ro = new ResizeObserver(() => {
      if (this.measure()) onResize();
    });
    this.ro.observe(canvas);
    this.measure();
  }

  measure() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    return true;
  }

  begin() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.font = FONT;
    return ctx;
  }

  dispose() {
    this.ro.disconnect();
  }
}

/** "Nice" linear ticks (1, 2, 5 × 10ⁿ steps). */
export function linearTicks(min, max, target = 6) {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target) || 10 * mag;
  const out = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let v = first; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Log-axis ticks at 1, 2, 5 × 10ⁿ inside [min, max]. */
export function logTicks(min, max) {
  const out = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
    }
  }
  return out;
}

/** Maps a frequency to 0..1 along a linear or log axis. */
export function freqToUnit(f, min, max, log) {
  if (log) return (Math.log(f) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return (f - min) / (max - min);
}

export function unitToFreq(u, min, max, log) {
  if (log) return Math.exp(Math.log(min) + u * (Math.log(max) - Math.log(min)));
  return min + u * (max - min);
}

export function fmtHzTick(v) {
  if (v >= 1000) return (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'k';
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function drawMessage(ctx, surface, lines) {
  ctx.save();
  ctx.fillStyle = 'rgba(11,15,20,0.72)';
  const boxW = Math.min(surface.w - 40, 520);
  const boxH = 30 + lines.length * 22;
  const x = (surface.w - boxW) / 2;
  const y = (surface.h - boxH) / 2;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = '#3a4757';
  ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? '600 16px system-ui, sans-serif' : FONT;
    ctx.fillStyle = i === 0 ? '#ffffff' : COLORS.text;
    ctx.fillText(line, surface.w / 2, y + 26 + i * 22);
  });
  ctx.restore();
}

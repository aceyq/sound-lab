// Canvas views for the Vowel Lab. Orange = the original recording (measured
// microphone samples), cyan = the synthesized sound (calculated from the
// harmonic sliders), purple dashes = expected harmonic positions n × f0.
import { CanvasSurface, COLORS, linearTicks, fmtHzTick, drawMessage } from './plot.js';

export const ORIG = '#ffb74d';
export const SYNTH = '#58d1ff';
export const MARK = '#b39ddb';
const SEL_FILL = 'rgba(88,209,255,0.14)';
const PAD = { l: 60, r: 16, t: 22, b: 44 };

function rect(sf, pad = PAD) {
  return { x: pad.l, y: pad.t, w: Math.max(10, sf.w - pad.l - pad.r), h: Math.max(10, sf.h - pad.t - pad.b) };
}

function axisLabels(ctx, r, xLabel, yLabel) {
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(xLabel, r.x + r.w / 2, r.y + r.h + 24);
  ctx.save();
  ctx.translate(14, r.y + r.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

/** Draws buf[start, start+n) across the plot (min/max per column when dense). */
function trace(ctx, r, buf, start, n, yOf, color, width = 1.6) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  const cols = Math.round(r.w);
  if (n <= cols) {
    for (let i = 0; i < n; i++) {
      const x = r.x + (n === 1 ? 0 : (i / (n - 1)) * r.w);
      const y = yOf(buf[start + i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  } else {
    for (let c = 0; c < cols; c++) {
      const a = start + Math.floor((c * n) / cols);
      const b = start + Math.max(Math.floor(((c + 1) * n) / cols), Math.floor((c * n) / cols) + 1);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a; i < b; i++) { const v = buf[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const x = r.x + c + 0.5;
      if (c === 0) ctx.moveTo(x, yOf(buf[a])); else ctx.lineTo(x, yOf(buf[a]));
      ctx.lineTo(x, yOf(lo));
      ctx.lineTo(x, yOf(hi));
      ctx.lineTo(x, yOf(buf[b - 1]));
    }
  }
  ctx.stroke();
}

function yGrid(ctx, r, lo, hi, yOf, fmt = (v) => String(v)) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of linearTicks(lo, hi, 5)) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(r.x, y);
    ctx.lineTo(r.x + r.w, y);
    ctx.stroke();
    ctx.fillText(fmt(v), r.x - 8, y);
  }
}

function xGrid(ctx, r, lo, hi, xOf, fmt) {
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const v of linearTicks(lo, hi, Math.max(3, Math.floor(r.w / 80)))) {
    const x = Math.round(xOf(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, r.y);
    ctx.lineTo(x, r.y + r.h);
    ctx.stroke();
    ctx.fillText(fmt(v), x, r.y + r.h + 6);
  }
}

/** The whole recording, with the selected analysis segment shaded. */
export class OverviewView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  plotRect() { return rect(this.surface, { l: 60, r: 16, t: 14, b: 40 }); }

  /** Time in seconds under a pointer x (CSS px relative to the canvas), clamped. */
  timeAt(x, duration) {
    const r = this.plotRect();
    return Math.max(0, Math.min(duration, ((x - r.x) / r.w) * duration));
  }

  render({ rec, seg, playhead = null, message = null }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const r = this.plotRect();
    if (!rec) {
      ctx.strokeStyle = COLORS.axis;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      drawMessage(ctx, sf, message || ['No recording selected', 'Record a vowel (stage 1), or pick one from the list.']);
      return;
    }
    const dur = rec.samples.length / rec.sampleRate;
    const xOf = (t) => r.x + (t / dur) * r.w;
    let peak = 0;
    for (let i = 0; i < rec.samples.length; i += 7) peak = Math.max(peak, Math.abs(rec.samples[i]));
    const range = Math.max(0.01, peak * 1.1);
    const yOf = (v) => r.y + r.h / 2 - (v / range) * (r.h / 2);
    if (seg) {
      ctx.fillStyle = SEL_FILL;
      ctx.fillRect(xOf(seg.start), r.y, xOf(seg.end) - xOf(seg.start), r.h);
    }
    xGrid(ctx, r, 0, dur, xOf, (v) => trim(v) + ' s');
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    trace(ctx, r, rec.samples, 0, rec.samples.length, yOf, ORIG, 1);
    ctx.restore();
    if (seg) {
      ctx.strokeStyle = SYNTH;
      ctx.lineWidth = 2;
      for (const t of [seg.start, seg.end]) {
        const x = Math.round(xOf(t)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
        ctx.stroke();
      }
      ctx.fillStyle = SYNTH;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(`analysis segment ${trim(seg.start)}–${trim(seg.end)} s`, Math.min(xOf(seg.start) + 4, r.x + r.w - 190), r.y + 3);
    }
    if (playhead != null) {
      const x = Math.round(xOf(playhead)) + 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Time in the recording (s) — drag across the plot to choose the analysis segment', r.x + r.w / 2, r.y + r.h + 22);
  }

  dispose() { this.surface.dispose(); }
}

/** A few periods of the recording (and optionally the synthesized sound). */
export class ZoomWaveView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  plotRect() { return rect(this.surface); }

  /** Milliseconds from the window start under a pointer x. */
  msAt(x, windowMs) {
    const r = this.plotRect();
    return Math.max(0, Math.min(windowMs, ((x - r.x) / r.w) * windowMs));
  }

  /**
   * opts: { buf, start, n, sampleRate, synth: Float32Array|null (length n),
   *         range, periodMs, cursors: [msA|null, msB|null], showPeriods }
   */
  render({ buf, start, n, sampleRate, synth = null, range, periodMs = null, cursors = [null, null], showPeriods = true, message = null }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const r = this.plotRect();
    const winMs = (n / sampleRate) * 1000;
    const xOf = (ms) => r.x + (ms / winMs) * r.w;
    const yOf = (v) => r.y + r.h / 2 - (v / range) * (r.h / 2);
    yGrid(ctx, r, -range, range, yOf, trim);
    xGrid(ctx, r, 0, winMs, xOf, trim);
    axisLabels(ctx, r, 'Time (ms) from the left edge of this zoomed window', 'Relative amplitude');
    if (!buf) {
      ctx.strokeStyle = COLORS.axis;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      drawMessage(ctx, sf, message || ['No recording selected', 'Record a vowel first.']);
      return;
    }
    ctx.strokeStyle = COLORS.zero;
    ctx.beginPath();
    ctx.moveTo(r.x, Math.round(yOf(0)) + 0.5);
    ctx.lineTo(r.x + r.w, Math.round(yOf(0)) + 0.5);
    ctx.stroke();
    // Expected repetition every 1/f0, starting at cursor A (or the left edge).
    if (showPeriods && periodMs > 0 && winMs / periodMs < 120) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = MARK;
      ctx.lineWidth = 1;
      const origin = cursors[0] ?? 0;
      const k0 = Math.ceil(-origin / periodMs);
      for (let k = k0; origin + k * periodMs <= winMs; k++) {
        const x = Math.round(xOf(origin + k * periodMs)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    trace(ctx, r, buf, start, n, yOf, ORIG, 1.8);
    if (synth) trace(ctx, r, synth, 0, Math.min(n, synth.length), yOf, SYNTH, 1.4);
    ctx.restore();
    ctx.font = '600 12px system-ui, sans-serif';
    ['A', 'B'].forEach((lab, i) => {
      const ms = cursors[i];
      if (ms == null) return;
      const x = Math.round(xOf(ms)) + 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(lab, x, r.y - 3);
    });
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  }

  dispose() { this.surface.dispose(); }
}

/** Original and synthesized spectra on one frequency axis, with n × f0 markers. */
export class CompareSpectrumView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  plotRect() { return rect(this.surface); }

  freqAt(x, min, max) {
    const r = this.plotRect();
    return min + ((x - r.x) / r.w) * (max - min);
  }

  /**
   * opts: { orig: {db, binHz}|null, synth: {db, binHz}|null, min, max, dbMin, dbMax,
   *         f0, count, nyquist, markers, hoverX, pinned (Hz) }
   * Returns { freq, orig, synth } for the hover/pinned cursor, or null.
   */
  render({ orig, synth, min, max, dbMin = -80, dbMax = 5, f0, count, nyquist, markers = true, hoverX = null, pinned = null, message = null }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const r = this.plotRect();
    const xOf = (f) => r.x + ((f - min) / (max - min)) * r.w;
    const yOf = (db) => r.y + ((dbMax - db) / (dbMax - dbMin)) * r.h;
    yGrid(ctx, r, dbMin, dbMax, yOf);
    xGrid(ctx, r, min, max, xOf, fmtHzTick);
    axisLabels(ctx, r, 'Frequency (Hz)', 'dB relative to own strongest peak');
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y - 22, r.w, r.h + 22);
    ctx.clip();
    if (markers && f0 > 0) {
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const spacingPx = (f0 / (max - min)) * r.w;
      const every = spacingPx >= 16 ? 1 : spacingPx >= 8 ? 2 : spacingPx >= 4 ? 5 : 10;
      for (let n = 1; n <= count; n++) {
        const f = n * f0;
        if (f > max || f >= nyquist) break;
        if (f < min) continue;
        const x = Math.round(xOf(f)) + 0.5;
        ctx.strokeStyle = MARK;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (n === 1 || n % every === 0) { ctx.fillStyle = MARK; ctx.fillText(String(n), x, r.y - 3); }
      }
      ctx.setLineDash([]);
    }
    const curve = (s, color, fill) => {
      if (!s) return;
      const cols = Math.round(r.w);
      ctx.beginPath();
      let started = false;
      for (let c = 0; c <= cols; c++) {
        const f0c = min + (c / cols) * (max - min);
        const f1c = min + ((c + 1) / cols) * (max - min);
        const b0 = Math.max(0, Math.round(f0c / s.binHz));
        if (b0 >= s.db.length) break;
        const b1 = Math.min(s.db.length - 1, Math.max(b0, Math.round(f1c / s.binHz) - 1));
        let v = -Infinity;
        for (let b = b0; b <= b1; b++) v = Math.max(v, s.db[b]);
        v = Math.max(dbMin, Math.min(dbMax, v));
        const x = r.x + c;
        if (!started) { ctx.moveTo(x, yOf(v)); started = true; } else ctx.lineTo(x, yOf(v));
      }
      if (fill) {
        ctx.lineTo(r.x + r.w, r.y + r.h);
        ctx.lineTo(r.x, r.y + r.h);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    };
    curve(orig, ORIG, 'rgba(255,183,77,0.16)');
    curve(synth, SYNTH, null);

    let readout = null;
    const cursorF = pinned != null ? pinned : hoverX != null && hoverX >= r.x && hoverX <= r.x + r.w ? min + ((hoverX - r.x) / r.w) * (max - min) : null;
    if (cursorF != null && cursorF >= min && cursorF <= max) {
      const at = (s) => (s ? s.db[Math.max(0, Math.min(s.db.length - 1, Math.round(cursorF / s.binHz)))] : null);
      readout = { freq: cursorF, orig: at(orig), synth: at(synth), pinned: pinned != null };
      const x = Math.round(xOf(cursorF)) + 0.5;
      ctx.strokeStyle = pinned != null ? '#ffffff' : 'rgba(255,255,255,0.55)';
      ctx.setLineDash(pinned != null ? [] : [3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    if (!orig && !synth) drawMessage(ctx, sf, message || ['Nothing to show yet', 'Record a vowel and choose its analysis segment.']);
    return readout;
  }

  dispose() { this.surface.dispose(); }
}

function trim(v) {
  return Number(v.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

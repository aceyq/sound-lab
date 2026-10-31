// Canvas views for Vowel Morph: a compact harmonic spectrum and a take's
// waveform with a draggable analysis section.
import { CanvasSurface, COLORS } from '../frequency/plot.js';
import { FLOOR_DB, HARMONICS, ampDb } from './morph-model.js';

export const COLOR_A = '#ffb74d';
export const COLOR_B = '#4dd0c8';
export const COLOR_NOW = '#58d1ff';

/**
 * Harmonic strengths as bars in dB (0 dB = strongest harmonic, bottom
 * −60 dB). `overlays` are drawn as small ticks in their own colour.
 */
export class HarmonicBars {
  constructor(canvas) {
    this.data = null;
    this.surface = new CanvasSurface(canvas, () => this.draw());
  }

  set(data) {
    this.data = data; // { amps, f0, overlays: [{ amps, color }] , empty }
    this.draw();
  }

  draw() {
    const s = this.surface;
    const ctx = s.begin();
    const L = 36; const R = 8; const T = 8; const B = 22;
    const w = s.w - L - R;
    const h = s.h - T - B;
    const y = (db) => T + h * (Math.max(FLOOR_DB, Math.min(0, db)) / FLOOR_DB);
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const db of [0, -20, -40, -60]) {
      ctx.beginPath(); ctx.moveTo(L, y(db)); ctx.lineTo(L + w, y(db)); ctx.stroke();
      ctx.fillText(`${db}`, L - 4, y(db));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const bw = w / HARMONICS;
    for (const n of [1, 8, 16, 24, 32, 40, 48]) ctx.fillText(String(n), L + (n - 0.5) * bw, T + h + 5);
    const d = this.data;
    if (!d || !d.amps) {
      ctx.fillStyle = COLORS.muted;
      ctx.textBaseline = 'middle';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText((d && d.empty) || 'No sound yet', L + w / 2, T + h / 2);
      return;
    }
    ctx.fillStyle = COLOR_NOW;
    d.amps.forEach((a, i) => {
      const db = ampDb(a);
      if (db <= FLOOR_DB) return;
      const top = y(db);
      ctx.fillRect(L + i * bw + bw * 0.15, top, bw * 0.7, T + h - top);
    });
    for (const o of d.overlays || []) {
      ctx.fillStyle = o.color;
      o.amps.forEach((a, i) => {
        const db = ampDb(a);
        if (db <= FLOOR_DB) return;
        ctx.fillRect(L + i * bw, y(db) - 1.5, bw, 3);
      });
    }
  }

  dispose() { this.surface.dispose(); }
}

/**
 * The waveform of a take with the analysis section shaded. Dragging across
 * it selects a new section; onSelect({ start, end }) gets seconds.
 */
export class TakeWave {
  constructor(canvas, { onSelect }) {
    this.canvas = canvas;
    this.rec = null;
    this.seg = null;
    this.onSelect = onSelect;
    this.surface = new CanvasSurface(canvas, () => this.draw());
    let x0 = null;
    const toSec = (e) => {
      const r = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.duration;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.rec) return;
      canvas.setPointerCapture(e.pointerId);
      x0 = toSec(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      const x1 = toSec(e);
      this.seg = { start: Math.min(x0, x1), end: Math.max(x0, x1) };
      this.draw();
    });
    const up = (e) => {
      if (x0 == null) return;
      const x1 = toSec(e);
      x0 = null;
      if (this.seg && this.seg.end - this.seg.start >= 0.05) this.onSelect({ ...this.seg });
      else if (this.seg) this.draw();
      void x1;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  get duration() {
    return this.rec ? this.rec.samples.length / this.rec.sampleRate : 1;
  }

  set(rec, seg) {
    this.rec = rec;
    this.seg = seg ? { ...seg } : null;
    this.draw();
  }

  draw() {
    const s = this.surface;
    const ctx = s.begin();
    if (!this.rec) {
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No recording yet', s.w / 2, s.h / 2);
      return;
    }
    const x = this.rec.samples;
    const dur = this.duration;
    if (this.seg) {
      ctx.fillStyle = 'rgba(88, 209, 255, 0.18)';
      const a = (this.seg.start / dur) * s.w;
      const b = (this.seg.end / dur) * s.w;
      ctx.fillRect(a, 0, b - a, s.h);
      ctx.strokeStyle = COLOR_NOW;
      ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(a, s.h); ctx.moveTo(b, 0); ctx.lineTo(b, s.h); ctx.stroke();
    }
    let peak = 1e-6;
    for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
    const mid = s.h / 2;
    ctx.fillStyle = '#c9d4e0';
    const per = x.length / s.w;
    for (let px = 0; px < s.w; px++) {
      let lo = 0; let hi = 0;
      const from = Math.floor(px * per);
      const to = Math.min(x.length, Math.floor((px + 1) * per));
      for (let i = from; i < to; i++) { if (x[i] < lo) lo = x[i]; if (x[i] > hi) hi = x[i]; }
      const yh = mid - (hi / peak) * mid * 0.9;
      const yl = mid - (lo / peak) * mid * 0.9;
      ctx.fillRect(px, yh, 1, Math.max(1, yl - yh));
    }
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${dur.toFixed(2)} s`, s.w - 4, s.h - 2);
  }

  dispose() { this.surface.dispose(); }
}

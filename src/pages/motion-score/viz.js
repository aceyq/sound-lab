// Drawing for Motion Score: the Movement Score (sensor-derived control
// history) and a short-window audio waveform.

import { CanvasSurface, COLORS } from '../frequency/plot.js';
import { F_MIN, F_MAX, H_MAX, pitchToUnit, noteName } from './mapping.js';

export const HISTORY_SEC = 10;
export const C = {
  pitch: '#58d1ff',
  intensity: '#3fb950',
  expr: '#f0f6fc',
  harm: '#c297ff',
  accent: '#ffb74d',
};

/**
 * Scrolling history of the control values, newest at the right, ~10 s.
 * Points are stamped with laptop time, so the time axis is real seconds.
 */
export class MovementScore {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => {});
    this.points = [];
    this.accents = [];
    this.marks = [];
  }

  clear() {
    this.points = [];
    this.accents = [];
    this.marks = [];
  }

  push(tSec, p) {
    this.points.push({ t: tSec, ...p });
    const cut = tSec - HISTORY_SEC - 0.5;
    while (this.points.length && this.points[0].t < cut) this.points.shift();
    while (this.accents.length && this.accents[0].t < cut) this.accents.shift();
    while (this.marks.length && this.marks[0] < cut) this.marks.shift();
  }

  accent(tSec, f0) {
    this.accents.push({ t: tSec, f0 });
  }

  /** A gap marker (e.g. visuals were frozen). */
  mark(tSec) {
    this.marks.push(tSec);
  }

  render(nowSec, { frozen, mode }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const PAD = { l: 112, r: 16, t: 10, b: 34 };
    const W = sf.w - PAD.l - PAD.r;
    const H = sf.h - PAD.t - PAD.b;
    const gap = 10;
    const hP = Math.round((H - 2 * gap) * 0.48);
    const hI = Math.round((H - 2 * gap) * 0.32);
    const hH = H - 2 * gap - hP - hI;
    const tracks = {
      p: { y: PAD.t, h: hP },
      i: { y: PAD.t + hP + gap, h: hI },
      h: { y: PAD.t + hP + hI + 2 * gap, h: hH },
    };
    const xOf = (t) => PAD.l + (1 - (nowSec - t) / HISTORY_SEC) * W;
    ctx.font = '12px system-ui, sans-serif';

    // Track frames and labels.
    const label = (tr, text, sub, color) => {
      ctx.fillStyle = '#0f141b';
      ctx.fillRect(PAD.l, tr.y, W, tr.h);
      ctx.strokeStyle = COLORS.grid;
      ctx.strokeRect(PAD.l + 0.5, tr.y + 0.5, W, tr.h);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(text, 8, tr.y + 2);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(sub, 8, tr.y + 19);
    };
    label(tracks.p, 'Pitch', '← tilt', C.pitch);
    label(tracks.i, 'Movement', '→ richness, expression', C.intensity);
    label(tracks.h, 'Harmonics', 'components', C.harm);

    // Axis ticks.
    const yP = (f) => tracks.p.y + (1 - pitchToUnit(f)) * tracks.p.h;
    const yI = (v) => tracks.i.y + (1 - v) * tracks.i.h;
    const yH = (n) => tracks.h.y + (1 - (n - 1) / (H_MAX - 1)) * tracks.h.h;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const f of [110, 220, 440, 880]) {
      const y = Math.round(yP(f)) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + W, y); ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${f} Hz ${noteName(f).name}`, PAD.l - 5, Math.min(Math.max(y, tracks.p.y + 7), tracks.p.y + tracks.p.h - 7));
    }
    for (const v of [0, 0.5, 1]) {
      const y = Math.round(yI(v)) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + W, y); ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${v * 100}%`, PAD.l - 5, Math.min(Math.max(y, tracks.i.y + 7), tracks.i.y + tracks.i.h - 7));
    }
    for (const n of [1, 6, 12]) {
      ctx.fillStyle = COLORS.text;
      ctx.fillText(String(n), PAD.l - 5, Math.min(Math.max(yH(n), tracks.h.y + 7), tracks.h.y + tracks.h.h - 7));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= HISTORY_SEC; s += 2) {
      const x = PAD.l + (1 - s / HISTORY_SEC) * W;
      ctx.fillStyle = COLORS.text;
      ctx.fillText(s === 0 ? 'now' : `−${s} s`, x, PAD.t + H + 6);
    }
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('Time (newest on the right) · sensor-derived control values, not audio', PAD.l + W / 2, PAD.t + H + 20);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, W, H);
    ctx.clip();
    const pts = this.points;
    // Pitch: bright where sound was playing, faint where silent.
    ctx.lineWidth = 3;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a.f0 == null || b.f0 == null || b.t - a.t > 0.5) continue;
      ctx.strokeStyle = b.sound ? C.pitch : 'rgba(88,209,255,0.28)';
      ctx.beginPath(); ctx.moveTo(xOf(a.t), yP(a.f0)); ctx.lineTo(xOf(b.t), yP(b.f0)); ctx.stroke();
    }
    // Movement intensity: filled area. Expression (Flow): white line.
    ctx.fillStyle = 'rgba(63,185,80,0.35)';
    ctx.strokeStyle = C.intensity;
    ctx.lineWidth = 2;
    let seg = [];
    const flushSeg = () => {
      if (seg.length > 1) {
        ctx.beginPath();
        ctx.moveTo(xOf(seg[0].t), yI(0));
        for (const p of seg) ctx.lineTo(xOf(p.t), yI(p.inten));
        ctx.lineTo(xOf(seg[seg.length - 1].t), yI(0));
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        seg.forEach((p, i) => (i ? ctx.lineTo(xOf(p.t), yI(p.inten)) : ctx.moveTo(xOf(p.t), yI(p.inten))));
        ctx.stroke();
      }
      seg = [];
    };
    for (const p of pts) {
      if (p.inten == null) { flushSeg(); continue; }
      if (seg.length && p.t - seg[seg.length - 1].t > 0.5) flushSeg();
      seg.push(p);
    }
    flushSeg();
    if (mode === 'flow') {
      ctx.strokeStyle = C.expr;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(xOf(p.t), yI(p.expr)) : ctx.moveTo(xOf(p.t), yI(p.expr))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Harmonic count: step line.
    ctx.strokeStyle = C.harm;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.count == null) { started = false; continue; }
      const x = xOf(p.t);
      const y = yH(p.count);
      if (!started) { ctx.moveTo(x, y); started = true; } else {
        ctx.lineTo(x, yH(pts[i - 1].count ?? p.count));
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    // Accent markers.
    for (const a of this.accents) {
      const x = xOf(a.t);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + H); ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(x, yP(a.f0), 6, 0, Math.PI * 2); ctx.fill();
    }
    for (const m of this.marks) {
      const x = xOf(m);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + H); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    if (frozen) {
      ctx.fillStyle = 'rgba(227,179,65,0.10)';
      ctx.fillRect(PAD.l, PAD.t, W, H);
    }
  }

  dispose() {
    this.surface.dispose();
  }
}

/** Short-window waveform from the analyser. */
export class WaveScope {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => {});
    this.buf = null;
  }

  render(analyser, sampleRate, frozen) {
    const sf = this.surface;
    const ctx = sf.begin();
    const PAD = { l: 50, r: 12, t: 12, b: 40 };
    const pw = sf.w - PAD.l - PAD.r;
    const ph = sf.h - PAD.t - PAD.b;
    const windowSec = 0.02;
    const full = 0.25; // vertical scale: ±0.25 (output is after Master Volume)
    const yOf = (v) => PAD.t + (1 - (v / full + 1) / 2) * ph;
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [-0.25, 0, 0.25]) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.fillText(String(v), PAD.l - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) ctx.fillText(`${i * 5} ms`, PAD.l + (i / 4) * pw, PAD.t + ph + 6);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('Time · audio amplitude at the output', PAD.l + pw / 2, PAD.t + ph + 22);
    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(PAD.l + 0.5, PAD.t + 0.5, pw, ph);
    if (!analyser) {
      ctx.fillStyle = COLORS.text;
      ctx.fillText('Start Audio to see the waveform.', PAD.l + pw / 2, PAD.t + ph / 2 - 8);
      return;
    }
    if (!frozen || !this.buf) {
      if (!this.buf || this.buf.length !== analyser.fftSize) this.buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(this.buf);
    }
    const b = this.buf;
    const n = Math.round(windowSec * sampleRate);
    let start = 0;
    for (let i = 1; i < b.length - n; i++) if (b[i - 1] < 0 && b[i] >= 0) { start = i; break; }
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD.l, PAD.t, pw, ph); ctx.clip();
    ctx.strokeStyle = frozen ? '#9aa8b8' : '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = PAD.l + (i / (n - 1)) * pw;
      const y = yOf(b[start + i] || 0);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  dispose() {
    this.surface.dispose();
  }
}

export { F_MIN, F_MAX };

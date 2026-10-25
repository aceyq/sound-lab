// Canvas views for the live microphone signal. They draw measured samples and
// measured FFT magnitudes only; nothing here is calculated from the
// synthesizer table.
import { CanvasSurface, COLORS, linearTicks, fmtHzTick, drawMessage } from './plot.js';
import { finiteDb } from './spectrum.js';

const MIC = '#ffb74d'; // microphone traces use orange, the synthesizer uses white/blue
const MIC_FILL = 'rgba(255,183,77,0.20)';
const FROZEN = '#c9b8a0';
const FROZEN_FILL = 'rgba(200,184,160,0.16)';

const WPAD = { l: 64, r: 16, t: 16, b: 46 };
const SPAD = { l: 60, r: 16, t: 22, b: 46 };

export class MicWaveformView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  /**
   * opts: { buf, start, n, sampleRate, range, mode: 'off'|'waiting'|'live'|'frozen', messages }
   * Draws buf[start, start+n) across the full plot width, so the time axis
   * spans exactly n ÷ sampleRate seconds.
   */
  render({ buf, start, n, sampleRate, range, mode, messages = {} }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const pw = Math.max(10, sf.w - WPAD.l - WPAD.r);
    const ph = Math.max(10, sf.h - WPAD.t - WPAD.b);
    const yOf = (v) => WPAD.t + ph / 2 - (v / range) * (ph / 2);
    const durMs = (n / sampleRate) * 1000;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of linearTicks(-range, range, 6)) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(WPAD.l, y);
      ctx.lineTo(WPAD.l + pw, y);
      ctx.stroke();
      ctx.fillText(trimNum(v), WPAD.l - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tv of linearTicks(0, durMs, Math.max(3, Math.floor(pw / 90)))) {
      const x = Math.round(WPAD.l + (tv / durMs) * pw) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, WPAD.t);
      ctx.lineTo(x, WPAD.t + ph);
      ctx.stroke();
      ctx.fillText(trimNum(tv), x, WPAD.t + ph + 6);
    }
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('Time (ms) — oldest sample on the left, newest on the right', WPAD.l + pw / 2, WPAD.t + ph + 24);
    ctx.save();
    ctx.translate(16, WPAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Relative digital amplitude', 0, 0);
    ctx.restore();

    ctx.strokeStyle = COLORS.zero;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(WPAD.l, Math.round(yOf(0)) + 0.5);
    ctx.lineTo(WPAD.l + pw, Math.round(yOf(0)) + 0.5);
    ctx.stroke();

    const showData = buf && (mode === 'live' || mode === 'frozen' || mode === 'off');
    if (showData) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(WPAD.l, WPAD.t, pw, ph);
      ctx.clip();
      ctx.strokeStyle = mode === 'live' ? MIC : FROZEN;
      ctx.globalAlpha = mode === 'off' ? 0.35 : 1;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const cols = Math.round(pw);
      if (n <= cols) {
        // Fewer samples than pixels: connect the samples themselves.
        for (let i = 0; i < n; i++) {
          const x = WPAD.l + (n === 1 ? 0 : (i / (n - 1)) * pw);
          const y = yOf(buf[start + i]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else {
        // More samples than pixels: the true min–max range of each column.
        for (let c = 0; c < cols; c++) {
          const a = start + Math.floor((c * n) / cols);
          const b = start + Math.max(Math.floor(((c + 1) * n) / cols), Math.floor((c * n) / cols) + 1);
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = a; i < b; i++) {
            const v = buf[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          const x = WPAD.l + c + 0.5;
          if (c === 0) ctx.moveTo(x, yOf(buf[a]));
          else ctx.lineTo(x, yOf(buf[a]));
          ctx.lineTo(x, yOf(lo));
          ctx.lineTo(x, yOf(hi));
          ctx.lineTo(x, yOf(buf[b - 1]));
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(WPAD.l + 0.5, WPAD.t + 0.5, pw, ph);

    if (mode === 'off') drawMessage(ctx, sf, messages.off || ['Microphone is off', 'Click Enable Microphone to see a live waveform.']);
    else if (mode === 'waiting') drawMessage(ctx, sf, ['Listening…', 'Collecting the first samples from the microphone.']);
    else if (messages.quiet) drawMessage(ctx, sf, messages.quiet);
  }

  dispose() {
    this.surface.dispose();
  }
}

export class MicSpectrumView {
  constructor(canvas) {
    this.surface = new CanvasSurface(canvas, () => this.onResize && this.onResize());
  }

  plotRect() {
    const sf = this.surface;
    return { x: SPAD.l, y: SPAD.t, w: Math.max(10, sf.w - SPAD.l - SPAD.r), h: Math.max(10, sf.h - SPAD.t - SPAD.b) };
  }

  /**
   * opts: { data (dB per bin), binHz, min, max, dbMin, dbMax,
   *         mode: 'off'|'waiting'|'live'|'frozen', peaks: [{freq, db}], hoverX, messages }
   * Returns the hover readout { freq, db } (or null).
   */
  render({ data, binHz, min, max, dbMin, dbMax, mode, peaks = [], hoverX = null, messages = {} }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const { x: px0, y: py0, w: pw, h: ph } = this.plotRect();
    const xOf = (f) => px0 + ((f - min) / (max - min)) * pw;
    const yOf = (db) => py0 + ((dbMax - db) / (dbMax - dbMin)) * ph;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const db of linearTicks(dbMin, dbMax, 6)) {
      const y = Math.round(yOf(db)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px0, y);
      ctx.lineTo(px0 + pw, y);
      ctx.stroke();
      ctx.fillText(String(db), px0 - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const f of linearTicks(min, max, Math.max(3, Math.floor(pw / 80)))) {
      const x = Math.round(xOf(f)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, py0);
      ctx.lineTo(x, py0 + ph);
      ctx.stroke();
      ctx.fillText(fmtHzTick(f), x, py0 + ph + 6);
    }
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('Frequency (Hz)', px0 + pw / 2, py0 + ph + 24);
    ctx.save();
    ctx.translate(14, py0 + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('Level (dB, digital)', 0, 0);
    ctx.restore();

    const showData = data && (mode === 'live' || mode === 'frozen' || mode === 'off');
    let readout = null;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px0, py0 - 22, pw, ph + 22);
    ctx.clip();
    if (showData) {
      // Max of all bins inside each pixel column, so a narrow peak is never skipped.
      const cols = Math.round(pw);
      ctx.beginPath();
      let started = false;
      for (let c = 0; c <= cols; c++) {
        const f0 = min + (c / cols) * (max - min);
        const f1 = min + ((c + 1) / cols) * (max - min);
        const b0 = Math.max(0, Math.round(f0 / binHz));
        if (b0 >= data.length) break;
        const b1 = Math.min(data.length - 1, Math.max(b0, Math.round(f1 / binHz) - 1));
        let v = -Infinity;
        for (let b = b0; b <= b1; b++) v = Math.max(v, finiteDb(data[b]));
        v = Math.max(dbMin, Math.min(dbMax, v));
        const x = px0 + c;
        if (!started) { ctx.moveTo(x, yOf(v)); started = true; } else ctx.lineTo(x, yOf(v));
      }
      ctx.lineTo(px0 + pw, py0 + ph);
      ctx.lineTo(px0, py0 + ph);
      ctx.closePath();
      ctx.globalAlpha = mode === 'off' ? 0.35 : 1;
      ctx.fillStyle = mode === 'live' ? MIC_FILL : FROZEN_FILL;
      ctx.fill();
      ctx.strokeStyle = mode === 'live' ? MIC : FROZEN;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      if (mode !== 'off') {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '12px system-ui, sans-serif';
        for (const p of peaks) {
          if (p.freq < min || p.freq > max) continue;
          const x = xOf(p.freq);
          const y = yOf(Math.max(dbMin, Math.min(dbMax, p.db)));
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillText(String(Math.round(p.freq)), x, y - 5);
        }
      }

      if (hoverX != null && hoverX >= px0 && hoverX <= px0 + pw && mode !== 'off') {
        const f = min + ((hoverX - px0) / pw) * (max - min);
        const b = Math.round(f / binHz);
        if (b >= 0 && b < data.length) {
          readout = { freq: b * binHz, db: finiteDb(data[b]) };
          const x = Math.round(xOf(readout.freq)) + 0.5;
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, py0);
          ctx.lineTo(x, py0 + ph);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    ctx.restore();

    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw, ph);

    if (mode === 'off') drawMessage(ctx, sf, messages.off || ['Microphone is off', 'Click Enable Microphone to see a live spectrum.']);
    else if (mode === 'waiting') drawMessage(ctx, sf, ['Listening…', 'Collecting the first block of samples for the FFT.']);
    else if (messages.quiet) drawMessage(ctx, sf, messages.quiet);
    return readout;
  }

  dispose() {
    this.surface.dispose();
  }
}

function trimNum(v) {
  return Number(v.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

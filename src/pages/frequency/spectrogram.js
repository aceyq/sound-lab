import {
  CanvasSurface, COLORS, linearTicks, logTicks, freqToUnit, unitToFreq, fmtHzTick,
} from './plot.js';
import { finiteDb } from './spectrum.js';

const PAD = { l: 60, r: 78, t: 12, b: 46 };
export const HISTORY_SEC = 10;
export const COLUMNS = 400; // one column per 25 ms of playing time
export const COLUMN_SEC = HISTORY_SEC / COLUMNS;
export const COLOR_DB_MIN = -110;
export const COLOR_DB_MAX = -10;
const Q_MIN = -140; // quantization range for stored columns
const Q_MAX = 0;

// Perceptually ordered dark → bright color map (inferno-like stops).
const STOPS = [
  [0, [0, 0, 4]], [0.15, [31, 12, 72]], [0.3, [85, 15, 109]], [0.45, [136, 34, 106]],
  [0.6, [186, 54, 85]], [0.75, [227, 89, 51]], [0.88, [249, 140, 10]], [1, [252, 255, 164]],
];
const LUT = buildLut();

function buildLut() {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && STOPS[k + 1][0] < u) k++;
    const [u0, c0] = STOPS[k];
    const [u1, c1] = STOPS[k + 1];
    const f = (u - u0) / (u1 - u0);
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return lut;
}

export function dbToColorIndex(db) {
  const u = (db - COLOR_DB_MIN) / (COLOR_DB_MAX - COLOR_DB_MIN);
  return Math.max(0, Math.min(255, Math.round(u * 255)));
}

/**
 * Rolling history of FFT snapshots. Columns are added according to elapsed
 * playing time (one per COLUMN_SEC), not per animation frame, so the time
 * axis stays correct at any frame rate.
 */
export class SpectrogramView {
  constructor(canvas, { timeLabel = 'Playing time (newest on the right)', emptyText = 'No history yet. Press Play; new snapshots appear on the right.' } = {}) {
    this.timeLabel = timeLabel;
    this.emptyText = emptyText;
    this.surface = new CanvasSurface(canvas, () => {
      this.dirty = true;
    });
    this.cols = []; // { q: Uint8Array, binHz } | { gap: true } | { mark: true }
    this.lastT = null;
    this.dirty = true;
    this.image = null;
  }

  clear() {
    this.cols = [];
    this.lastT = null;
    this.dirty = true;
  }

  /** Call when playback (re)starts; marks the restart with a thin line. */
  markStart() {
    if (this.cols.length) this._push({ mark: true });
    this.lastT = null;
  }

  /** Add columns for the playing time elapsed since the last call. */
  advance(data, binHz, tSec) {
    if (this.lastT === null) {
      this.lastT = tSec;
      return;
    }
    let n = Math.floor((tSec - this.lastT) / COLUMN_SEC);
    if (n <= 0) return;
    this.lastT += n * COLUMN_SEC;
    // A long gap means frames were not delivered (e.g. a hidden tab): show
    // it as "no data" instead of pretending the current snapshot lasted.
    if (n > 10) {
      const gaps = Math.min(n - 1, COLUMNS);
      for (let i = 0; i < gaps; i++) this._push({ gap: true });
      n = 1;
    }
    const q = new Uint8Array(data.length);
    const scale = 255 / (Q_MAX - Q_MIN);
    for (let i = 0; i < data.length; i++) {
      const v = finiteDb(data[i]);
      q[i] = Math.max(0, Math.min(255, Math.round((v - Q_MIN) * scale)));
    }
    for (let i = 0; i < n; i++) this._push({ q, binHz });
  }

  _push(col) {
    this.cols.push(col);
    if (this.cols.length > COLUMNS) this.cols.splice(0, this.cols.length - COLUMNS);
    this.dirty = true;
  }

  render({ min, max, log }) {
    const sf = this.surface;
    const ctx = sf.begin();
    const pw = Math.max(10, sf.w - PAD.l - PAD.r);
    const ph = Math.max(10, sf.h - PAD.t - PAD.b);
    const rows = Math.max(2, Math.round(ph * Math.min(sf.dpr, 2)));

    // Render history into a COLUMNS × rows image, then scale it onto the plot.
    if (!this.image || this.image.width !== COLUMNS || this.image.height !== rows) {
      this.image = new ImageData(COLUMNS, rows);
      this.off = new OffscreenCanvasLike(COLUMNS, rows);
    }
    const img = this.image.data;
    img.fill(0);
    for (let i = 3; i < img.length; i += 4) img[i] = 255;
    const offset = COLUMNS - this.cols.length;
    const qScale = (Q_MAX - Q_MIN) / 255;
    const rowRanges = new Map(); // per binHz
    for (let ci = 0; ci < this.cols.length; ci++) {
      const col = this.cols[ci];
      const x = offset + ci;
      if (col.gap || col.mark) {
        const c = col.mark ? 230 : 40;
        for (let r = 0; r < rows; r++) {
          const p = (r * COLUMNS + x) * 4;
          img[p] = img[p + 1] = img[p + 2] = c;
        }
        continue;
      }
      let ranges = rowRanges.get(col.binHz + ':' + col.q.length);
      if (!ranges) {
        ranges = new Int32Array(rows * 2);
        for (let r = 0; r < rows; r++) {
          // Row r = 0 is the top (highest frequency).
          const fHi = unitToFreq(1 - r / rows, min, max, log);
          const fLo = unitToFreq(1 - (r + 1) / rows, min, max, log);
          const b0 = Math.max(0, Math.round(fLo / col.binHz));
          const b1 = Math.min(col.q.length - 1, Math.max(b0, Math.round(fHi / col.binHz)));
          ranges[r * 2] = b0;
          ranges[r * 2 + 1] = b1;
        }
        rowRanges.set(col.binHz + ':' + col.q.length, ranges);
      }
      for (let r = 0; r < rows; r++) {
        let qm = 0;
        for (let b = ranges[r * 2]; b <= ranges[r * 2 + 1]; b++) if (col.q[b] > qm) qm = col.q[b];
        const db = Q_MIN + qm * qScale;
        const li = dbToColorIndex(db) * 3;
        const p = (r * COLUMNS + x) * 4;
        img[p] = LUT[li];
        img[p + 1] = LUT[li + 1];
        img[p + 2] = LUT[li + 2];
      }
    }
    this.off.put(this.image);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off.canvas, PAD.l, PAD.t, pw, ph);

    // Axes.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const fTicks = log ? logTicks(min, max) : linearTicks(min, max, Math.max(3, Math.floor(ph / 50)));
    for (const f of fTicks) {
      const y = Math.round(PAD.t + (1 - freqToUnit(f, min, max, log)) * ph) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.l - 4, y);
      ctx.lineTo(PAD.l, y);
      ctx.stroke();
      ctx.fillText(fmtHzTick(f), PAD.l - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= HISTORY_SEC; s += 2) {
      const x = Math.round(PAD.l + (1 - s / HISTORY_SEC) * pw) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.t + ph);
      ctx.lineTo(x, PAD.t + ph + 4);
      ctx.stroke();
      ctx.fillText(s === 0 ? 'now' : `−${s} s`, x, PAD.t + ph + 6);
    }
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(this.timeLabel, PAD.l + pw / 2, PAD.t + ph + 24);
    ctx.save();
    ctx.translate(14, PAD.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(`Frequency (Hz, ${log ? 'log' : 'linear'})`, 0, 0);
    ctx.restore();
    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(PAD.l + 0.5, PAD.t + 0.5, pw, ph);

    // Color legend.
    const lx = PAD.l + pw + 16;
    const lw = 14;
    const grad = ctx.createLinearGradient(0, PAD.t + ph, 0, PAD.t);
    for (let i = 0; i <= 10; i++) {
      const li = Math.round((i / 10) * 255) * 3;
      grad.addColorStop(i / 10, `rgb(${LUT[li]},${LUT[li + 1]},${LUT[li + 2]})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(lx, PAD.t, lw, ph);
    ctx.strokeRect(lx + 0.5, PAD.t + 0.5, lw, ph);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const db of [COLOR_DB_MAX, -30, -50, -70, -90, COLOR_DB_MIN]) {
      const y = PAD.t + ((COLOR_DB_MAX - db) / (COLOR_DB_MAX - COLOR_DB_MIN)) * ph;
      ctx.fillText(String(db), lx + lw + 4, y);
    }
    ctx.fillStyle = COLORS.muted;
    ctx.textBaseline = 'top';
    ctx.fillText('dB', lx, PAD.t + ph + 6);

    if (!this.cols.length) {
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText(this.emptyText, PAD.l + pw / 2, PAD.t + ph / 2);
    }
    this.dirty = false;
  }

  dispose() {
    this.surface.dispose();
  }
}

// A small detached canvas for putImageData, then scaled with drawImage.
class OffscreenCanvasLike {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
  }

  put(image) {
    this.ctx.putImageData(image, 0, 0);
  }
}

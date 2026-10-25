// "Microphone input" section of the Frequency Playground page: controls,
// status, input level, Freeze View, and the microphone's own waveform and
// spectrum plots. The synthesizer's plots are untouched and keep showing only
// the synthesized signal.
import { h, fmtHz, fmtTime } from '../../lib/dom.js';
import { MicInput, WAVE_BUFFER, SPEC_SMOOTHING } from './mic.js';
import { MicWaveformView, MicSpectrumView } from './mic-plots.js';
import { findPeaks } from './spectrum.js';
import {
  windowSampleCount, selectWindow, levelStats, AutoScale, binSpacing, fftWindowSec, describeProcessing,
} from './mic-analysis.js';

export const MIC_DEFAULTS = { windowSec: 0.02, vScale: 'auto', stabilize: true, range: [0, 5000], fftSize: 4096, peaks: true };
const WINDOWS = [[0.01, '10 ms'], [0.02, '20 ms'], [0.05, '50 ms'], [0.1, '100 ms'], [0.2, '200 ms']];
const VSCALES = [['auto', 'Auto-fit'], [1, '±1'], [0.5, '±0.5'], [0.2, '±0.2'], [0.1, '±0.1'], [0.05, '±0.05'], [0.02, '±0.02'], [0.01, '±0.01']];
const RANGES = [[0, 500], [0, 1000], [0, 2000], [0, 5000], [0, 8000]];
const FFT_SIZES = [2048, 4096, 8192, 16384];
const DB_MIN = -110;
const DB_MAX = 0;
const LEVEL_MS = 50; // the input-level meter averages the newest 50 ms
const QUIET_DB = -60;

const STATUS = {
  off: ['○ Off', 'off'],
  requesting: ['… Requesting permission', 'busy'],
  listening: ['● Listening', 'on'],
  error: ['⚠ Error', 'bad'],
};

/**
 * opts: { vizCard, help, isSynthPlaying(), stopSynth(), logChange(text) }
 * Returns { element, frame(), unmount(), debug() }.
 */
export function createMicSection({ vizCard, help, isSynthPlaying, stopSynth, logChange }) {
  const ui = {
    windowSec: MIC_DEFAULTS.windowSec,
    vScale: MIC_DEFAULTS.vScale,
    stabilize: MIC_DEFAULTS.stabilize,
    range: [...MIC_DEFAULTS.range],
    rangeMax: MIC_DEFAULTS.range[1], // the button picked; range[1] is clamped to Nyquist
    fftSize: MIC_DEFAULTS.fftSize,
    peaks: MIC_DEFAULTS.peaks,
    frozen: null, // { wave, spec, binHz, sampleRate, at }
    everStarted: false,
    lastSampleRate: null,
    hoverX: null,
  };
  const autoScale = new AutoScale();
  const waveBuf = new Float32Array(WAVE_BUFFER);
  let specBuf = new Float32Array(ui.fftSize / 2);
  let haveData = false;
  let wave = { start: 0, n: 0, triggered: false, range: 0.01 };
  let lastPeaks = [];
  let level = { rmsDb: -Infinity, peakDb: -Infinity };
  let lastText = 0;
  let dirty = true;

  const mic = new MicInput({ fftSize: ui.fftSize, onChange: () => onStatus() });

  // ───────────── controls ─────────────
  const el = {};
  el.enable = h('button', { class: 'btn primary big mic-enable', onclick: () => enable() }, '🎤 Enable Microphone');
  el.stop = h('button', { class: 'btn big', onclick: () => stopMic(), disabled: true }, '■ Stop Microphone');
  el.status = h('span', { class: 'mic-status off', role: 'status', 'aria-live': 'polite' }, STATUS.off[0]);
  el.meterBar = h('span', { class: 'mic-meter-bar' });
  el.meterPeak = h('span', { class: 'mic-meter-peak' });
  el.meterText = h('span', { class: 'mono mic-meter-text' }, '—');
  el.meter = h('span', { class: 'mic-meter', role: 'meter', 'aria-label': 'Microphone input level', 'aria-valuemin': '-60', 'aria-valuemax': '0', 'aria-valuenow': '-60' },
    el.meterBar, el.meterPeak);
  el.freeze = h('button', { class: 'btn big mic-freeze', onclick: () => toggleFreeze(), disabled: true, 'aria-pressed': 'false' }, '❄ Freeze View');
  el.freezeState = h('span', { class: 'mic-freeze-state', 'aria-live': 'polite' });
  el.error = h('div', { class: 'mic-error', role: 'alert' });
  el.note = h('p', { class: 'note mic-note', 'aria-live': 'polite' });
  el.synthWarn = h('p', { class: 'mic-warn', 'aria-live': 'polite' });
  el.settings = h('div', { class: 'mic-settings' });
  el.clip = h('span', { class: 'mic-clip', 'aria-live': 'polite' });

  const explain = h('details', { class: 'mic-explain' },
    h('summary', {}, 'What am I looking at? (click to open)'),
    h('ul', {},
      h('li', {}, 'The waveform shows how the microphone signal changes over time.'),
      h('li', {}, 'The spectrum shows which frequencies are present and how strongly they appear.'),
      h('li', {}, 'A sustained vowel often contains regularly spaced harmonic components. The strongest peak is not necessarily the fundamental.'),
      h('li', {}, 'Changing the graph’s time window or frequency range changes the view, not your voice.'),
      h('li', {}, 'Freeze View holds the graphs still. Stop Microphone turns off microphone capture.'),
    ),
    h('p', { class: 'muted' }, 'The numbers are digital levels inside the computer. They depend on the microphone and its input volume, so they are not calibrated sound pressure (dB SPL).'),
  );

  // ───────────── waveform card ─────────────
  el.waveCanvas = h('canvas', { class: 'plot mic-wave', role: 'img', 'aria-label': 'Microphone waveform: relative digital amplitude over time in milliseconds' });
  el.winButtons = WINDOWS.map(([sec, label]) => h('button', { class: 'btn seg', 'data-sec': sec, onclick: () => setWindow(sec) }, label));
  el.vScale = h('select', { 'aria-label': 'Microphone waveform vertical scale', onchange: (e) => setVScale(e.target.value) },
    VSCALES.map(([v, label]) => h('option', { value: String(v) }, label)));
  el.stabilize = h('input', { type: 'checkbox', checked: ui.stabilize, onchange: (e) => { ui.stabilize = e.target.checked; dirty = true; } });
  el.scaleReadout = h('span', { class: 'mono mic-scale' });
  el.waveState = h('p', { class: 'state-line' });
  el.waveInfo = h('p', { class: 'help mono' });
  const waveCard = vizCard('Microphone waveform', 'mic-wave',
    'Source: 🎤 microphone (live input) · measured samples, not the synthesizer',
    [
      h('div', { class: 'row gap wrap controls' },
        h('span', { class: 'ctl-label' }, 'Time window'),
        h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Microphone time window' }, el.winButtons),
      ),
      h('div', { class: 'row gap wrap controls' },
        h('label', {}, 'Vertical scale ', el.vScale),
        el.scaleReadout,
        h('label', { class: 'check secondary', title: 'Starts each drawing at an upward zero crossing, like an oscilloscope trigger, so a repeating wave stands still.' },
          el.stabilize, ' Steady display'),
      ),
      el.waveState,
      h('div', { class: 'canvas-box mic-wave-box' }, el.waveCanvas),
      h('p', { class: 'help' }, 'Vertical axis: relative digital amplitude, where ±1 is the largest value the computer can record. It is not sound pressure. Steady display only chooses where each drawing starts so a repeating wave stands still; the samples are real.'),
      el.waveInfo,
    ]);

  // ───────────── spectrum card ─────────────
  el.specCanvas = h('canvas', { class: 'plot mic-spec', role: 'img', 'aria-label': 'Microphone spectrum: digital level in dB over frequency in Hz' });
  el.rangeButtons = RANGES.map(([a, b]) => h('button', { class: 'btn seg', 'data-max': b, onclick: () => setRange(a, b) }, `0–${b.toLocaleString('en-US')} Hz`));
  el.fft = h('select', { 'aria-label': 'Microphone FFT size', onchange: (e) => setFft(Number(e.target.value)) },
    FFT_SIZES.map((n) => h('option', { value: String(n), selected: n === ui.fftSize }, n.toLocaleString('en-US'))));
  el.peaksBox = h('input', { type: 'checkbox', checked: ui.peaks, onchange: (e) => { ui.peaks = e.target.checked; dirty = true; } });
  el.specState = h('p', { class: 'state-line' });
  el.hover = h('span', { class: 'mono mic-hover' });
  el.peakList = h('p', { class: 'peaks mono mic-peaks' });
  el.binInfo = h('p', { class: 'note mic-bins' });
  const specCard = vizCard('Microphone spectrum', 'mic-spec',
    'Source: 🎤 microphone (live input) · FFT of the same samples as the waveform',
    [
      h('div', { class: 'row gap wrap controls' },
        h('span', { class: 'ctl-label' }, 'Frequency range'),
        h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Microphone frequency range' }, el.rangeButtons),
      ),
      h('div', { class: 'row gap wrap controls' },
        h('label', {}, 'FFT size ', el.fft),
        h('label', { class: 'check' }, el.peaksBox, ' Mark frequency peaks'),
        el.hover,
      ),
      el.specState,
      h('div', { class: 'canvas-box mic-spec-box' }, el.specCanvas),
      h('p', { class: 'help' }, 'Vertical axis: level in dB of the digital signal (0 dB = digital full scale). These are not calibrated acoustic dB SPL. Move the pointer over the plot to read a frequency.'),
      el.peakList,
      el.binInfo,
    ]);

  el.plots = h('div', { class: 'mic-plots', hidden: true }, waveCard, specCard);

  const element = h('section', { class: 'card mic-panel', id: 'microphone', 'aria-label': 'Microphone input' },
    h('div', { class: 'mic-head' },
      h('h2', {}, '🎤 Microphone input'),
      h('span', { class: 'muted' }, 'See your own voice as a waveform and a spectrum. The microphone is only analyzed; it is never played through the speakers.'),
    ),
    h('div', { class: 'row gap wrap mic-controls' },
      el.enable, el.stop, el.status,
      h('span', { class: 'mic-level' }, h('span', { class: 'ctl-label' }, 'Input level'), el.meter, el.meterText, el.clip),
      el.freeze, el.freezeState,
    ),
    el.error,
    el.note,
    el.synthWarn,
    help('Speakers can be picked up by the microphone. Headphones help when you later compare your voice with synthesized sound.'),
    el.settings,
    explain,
    el.plots,
  );

  const waveView = new MicWaveformView(el.waveCanvas);
  const specView = new MicSpectrumView(el.specCanvas);
  waveView.onResize = () => { dirty = true; };
  specView.onResize = () => { dirty = true; };

  const onMove = (e) => {
    const r = el.specCanvas.getBoundingClientRect();
    ui.hoverX = e.clientX - r.left;
    dirty = true;
  };
  const onLeave = () => { ui.hoverX = null; el.hover.textContent = ''; dirty = true; };
  el.specCanvas.addEventListener('pointermove', onMove);
  el.specCanvas.addEventListener('pointerleave', onLeave);

  // ───────────── actions ─────────────
  async function enable() {
    if (mic.status === 'requesting' || mic.listening) return;
    el.note.textContent = '';
    if (isSynthPlaying()) {
      stopSynth();
      el.note.textContent = 'Synthesized playback was stopped so the microphone measures only your voice (the speakers would otherwise be picked up). It will not restart by itself; press ▶ Play when you want it again.';
      logChange('Synthesized playback stopped because the microphone was enabled.');
    }
    unfreeze(true);
    autoScale.reset();
    haveData = false;
    await mic.start();
  }

  function stopMic() {
    if (mic.status === 'off') return;
    unfreeze(true);
    el.note.textContent = '';
    mic.stop();
  }

  function toggleFreeze() {
    if (ui.frozen) unfreeze();
    else if (mic.listening && haveData) {
      ui.frozen = {
        wave: Float32Array.from(waveBuf),
        spec: Float32Array.from(specBuf),
        binHz: binSpacing(mic.sampleRate, ui.fftSize),
        fftSize: ui.fftSize,
        sampleRate: mic.sampleRate,
        at: new Date(),
      };
      logChange('Microphone view frozen (capture is still on).');
    }
    updateButtons();
    dirty = true;
  }

  function unfreeze(quiet = false) {
    if (!ui.frozen) return;
    ui.frozen = null;
    if (!quiet) logChange('Microphone view resumed.');
    updateButtons();
    dirty = true;
  }

  function setWindow(sec) {
    ui.windowSec = sec;
    for (const b of el.winButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === sec));
    dirty = true;
  }

  function setVScale(v) {
    ui.vScale = v === 'auto' ? 'auto' : Number(v);
    el.vScale.value = String(ui.vScale);
    dirty = true;
  }

  function setRange(a, b) {
    const nyq = (mic.sampleRate || ui.lastSampleRate || 44100) / 2;
    ui.rangeMax = b;
    ui.range = [a, Math.min(b, nyq)];
    for (const btn of el.rangeButtons) btn.setAttribute('aria-pressed', String(Number(btn.dataset.max) === b));
    dirty = true;
  }

  function setFft(n) {
    ui.fftSize = n;
    el.fft.value = String(n);
    mic.setFftSize(n);
    specBuf = new Float32Array(n / 2);
    if (!ui.frozen) haveData = false;
    updateBinInfo();
    dirty = true;
  }

  function onStatus() {
    const [text, cls] = STATUS[mic.status];
    el.status.textContent = text;
    el.status.className = 'mic-status ' + cls;
    if (mic.status === 'error') {
      el.error.replaceChildren(h('strong', {}, mic.error.title + '. '), mic.error.message);
    } else el.error.replaceChildren();
    if (mic.listening) {
      ui.everStarted = true;
      ui.lastSampleRate = mic.sampleRate;
      el.plots.hidden = false;
      setRange(0, ui.rangeMax);
      logChange(`Microphone listening at ${mic.sampleRate.toLocaleString('en-US')} samples per second.`);
    } else if (mic.status === 'off' && ui.everStarted) {
      logChange('Microphone stopped: its tracks were stopped and the device released.');
    } else if (mic.status === 'error') {
      logChange(`Microphone error: ${mic.error.title}.`);
    }
    renderSettings();
    updateBinInfo();
    updateButtons();
    dirty = true;
  }

  function updateButtons() {
    const s = mic.status;
    el.enable.disabled = s === 'requesting' || s === 'listening';
    el.enable.textContent = s === 'error' ? '🎤 Try Again' : '🎤 Enable Microphone';
    el.stop.disabled = s === 'off' || s === 'error';
    el.freeze.disabled = !mic.listening;
    el.freeze.textContent = ui.frozen ? '▶ Resume View' : '❄ Freeze View';
    el.freeze.setAttribute('aria-pressed', String(!!ui.frozen));
    el.freezeState.textContent = ui.frozen ? 'View frozen · microphone still listening' : '';
    el.freezeState.classList.toggle('show', !!ui.frozen);
    element.classList.toggle('listening', mic.listening);
    element.classList.toggle('frozen', !!ui.frozen);
  }

  function renderSettings() {
    if (!mic.listening) {
      el.settings.replaceChildren(ui.everStarted && mic.status === 'off'
        ? h('p', { class: 'muted' }, 'Microphone released. Your browser’s recording indicator should now be off.')
        : '');
      return;
    }
    const p = mic.settings;
    const parts = describeProcessing(p).map((d) => h('li', { class: d.ok ? 'ok' : 'warn' }, d.text));
    el.settings.replaceChildren(
      h('p', { class: 'muted' },
        `Device: ${mic.deviceLabel || '(name hidden by the browser)'} · ${mic.sampleRate.toLocaleString('en-US')} samples per second`),
      h('details', { class: 'secondary' },
        h('summary', {}, 'Voice processing the browser applied'),
        h('p', { class: 'muted' }, 'We asked the browser to switch these off because they can change a sustained vowel’s spectrum:'),
        h('ul', {}, parts),
      ),
    );
  }

  function updateBinInfo() {
    const sr = mic.sampleRate || ui.lastSampleRate;
    if (!sr) {
      el.binInfo.textContent = `FFT size ${ui.fftSize.toLocaleString('en-US')}. The exact frequency spacing appears once the microphone is on, because it depends on your device’s sample rate.`;
      return;
    }
    const bin = binSpacing(sr, ui.fftSize);
    el.binInfo.textContent = `FFT size ${ui.fftSize.toLocaleString('en-US')}: each spectrum analyzes the newest ${fmtTime(fftWindowSec(sr, ui.fftSize))} of sound, and its points are ${sr.toLocaleString('en-US')} ÷ ${ui.fftSize.toLocaleString('en-US')} ≈ ${bin.toFixed(2)} Hz apart. ` +
      'A longer analysis window helps separate nearby frequencies but responds more slowly. The display is lightly smoothed over time so it is easier to read.';
  }

  // ───────────── drawing (called from the page's animation loop) ─────────────
  function frame() {
    const listening = mic.listening;
    if (listening) {
      // The level meter always shows the live input, even while the view is frozen.
      mic.readWave(waveBuf);
      const sr = mic.sampleRate;
      const nLevel = windowSampleCount(LEVEL_MS / 1000, sr);
      level = levelStats(waveBuf, WAVE_BUFFER - nLevel, WAVE_BUFFER);
      if (!ui.frozen) {
        mic.readSpectrum(specBuf);
        haveData = mic.capturedSec >= fftWindowSec(sr, ui.fftSize);
        dirty = true;
      }
      drawMeter();
    } else if (el.meterText.textContent !== '—') {
      level = { rmsDb: -Infinity, peakDb: -Infinity };
      peakHold = -Infinity;
      drawMeter();
    }
    if (isSynthPlaying() && listening) {
      el.synthWarn.textContent = 'The synthesizer is playing. Its sound can reach the microphone through the speakers, so the microphone graphs may include it. Use headphones, or stop playback.';
    } else if (el.synthWarn.textContent) el.synthWarn.textContent = '';

    if (!dirty || el.plots.hidden) return;
    dirty = false;
    draw();
  }

  function draw() {
    const f = ui.frozen;
    const mode = f ? 'frozen' : mic.listening ? (haveData ? 'live' : 'waiting') : 'off';
    const sr = f ? f.sampleRate : mic.sampleRate || ui.lastSampleRate;
    const buf = f ? f.wave : waveBuf;
    const n = windowSampleCount(ui.windowSec, sr);
    const sel = selectWindow(buf, n, { stabilize: ui.stabilize, searchN: windowSampleCount(0.025, sr) });
    let peak = 0;
    for (let i = sel.start; i < sel.start + sel.n; i++) peak = Math.max(peak, Math.abs(buf[i]));
    const range = ui.vScale === 'auto' ? (mode === 'live' ? autoScale.update(peak, performance.now()) : autoScale.range) : ui.vScale;
    wave = { start: sel.start, n: sel.n, triggered: sel.triggered, range, sampleRate: sr };
    const offMsg = mic.status === 'error'
      ? ['Microphone not active', mic.error.title + '. See the message above.']
      : ui.everStarted
        ? ['Microphone is off', 'Stop Microphone released the device. The faded trace is the last view.']
        : null;
    waveView.render({ buf, start: sel.start, n: sel.n, sampleRate: sr, range, mode, messages: { off: offMsg } });

    const spec = f ? f.spec : specBuf;
    const binHz = f ? f.binHz : binSpacing(sr, ui.fftSize);
    lastPeaks = ui.peaks && (mode === 'live' || mode === 'frozen') ? strongPeaks(spec, binHz) : [];
    const readout = specView.render({
      data: spec, binHz, min: ui.range[0], max: ui.range[1], dbMin: DB_MIN, dbMax: DB_MAX,
      mode, peaks: lastPeaks, hoverX: ui.hoverX, messages: { off: offMsg },
    });
    el.hover.textContent = readout ? `Pointer: ${fmtHz(Math.round(readout.freq))}, ${readout.db.toFixed(0)} dB` : '';

    const now = performance.now();
    if (now - lastText < 200 && mode === 'live') return;
    lastText = now;
    el.scaleReadout.textContent = ui.vScale === 'auto' ? `Auto-fit on · current scale ±${range}` : `Fixed scale ±${range}`;
    el.waveInfo.textContent = `Showing ${fmtTime(sel.n / sr)} = ${sel.n.toLocaleString('en-US')} samples at ${sr.toLocaleString('en-US')} samples per second` +
      (ui.stabilize ? (sel.triggered ? ' · steady display: started at an upward zero crossing' : ' · steady display: no clear zero crossing, showing the newest samples') : ' · newest samples');
    const stateText = {
      live: '● Live: microphone samples, redrawn every frame.',
      waiting: 'Listening… collecting the first samples.',
      frozen: f ? `❄ Frozen view from ${f.at.toLocaleTimeString()}. The microphone is still listening; click Resume View to continue.` : '',
      off: mic.status === 'error' ? 'Microphone not active (error).' : '○ Microphone off: nothing is being captured.',
    }[mode];
    const quiet = mode === 'live' && level.rmsDb < QUIET_DB ? ` Very quiet input (${fmtDb(level.rmsDb)}): speak or sing closer to the microphone.` : '';
    for (const s of [el.waveState, el.specState]) {
      s.textContent = stateText + quiet;
      s.className = 'state-line ' + (mode === 'live' ? 'live' : mode === 'frozen' ? 'frozen' : '');
    }
    if (f && f.fftSize !== ui.fftSize) el.specState.textContent += ` (Frozen spectrum used FFT ${f.fftSize}; the new size applies after Resume.)`;
    el.peakList.textContent = !ui.peaks || !(mode === 'live' || mode === 'frozen') ? ''
      : lastPeaks.length
        ? `Frequency peaks in view (strongest first): ${[...lastPeaks].sort((a, b) => b.db - a.db).map((p) => Math.round(p.freq) + ' Hz').join(', ')}. These are local maxima only; the strongest is not necessarily the fundamental.`
        : 'No clear frequency peaks in this range.';
  }

  function strongPeaks(data, binHz) {
    const peaks = findPeaks(data, binHz, { minHz: Math.max(ui.range[0], 40), maxHz: ui.range[1], maxPeaks: 24 });
    if (!peaks.length) return [];
    const top = Math.max(...peaks.map((p) => p.db));
    return peaks.filter((p) => p.db >= top - 30).sort((a, b) => b.db - a.db).slice(0, 8).sort((a, b) => a.freq - b.freq);
  }

  let lastMeter = 0;
  let peakHold = -Infinity;
  let peakHoldAt = 0;
  function drawMeter() {
    const now = performance.now();
    const pct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    if (level.peakDb > peakHold || now - peakHoldAt > 1200) { peakHold = level.peakDb; peakHoldAt = now; }
    el.meterBar.style.width = pct(level.rmsDb) + '%';
    el.meterPeak.style.left = pct(peakHold) + '%';
    el.meterPeak.style.opacity = Number.isFinite(peakHold) ? '1' : '0';
    if (now - lastMeter < 120 && mic.listening) return;
    lastMeter = now;
    el.meter.setAttribute('aria-valuenow', String(Math.round(Math.max(-60, level.rmsDb))));
    el.meterText.textContent = mic.listening ? fmtDb(level.rmsDb) : '—';
    el.clip.textContent = mic.listening && level.peakDb > -0.1 ? 'Too loud: clipping. Move back from the microphone.' : '';
  }

  // ───────────── init / teardown ─────────────
  setWindow(ui.windowSec);
  el.vScale.value = 'auto';
  for (const btn of el.rangeButtons) btn.setAttribute('aria-pressed', String(Number(btn.dataset.max) === ui.range[1]));
  updateBinInfo();
  updateButtons();
  const onPageHide = () => mic.stop();
  window.addEventListener('pagehide', onPageHide);

  return {
    element,
    frame,
    // Used by the Vowel Lab to record from this same microphone.
    mic,
    enable,
    stop: stopMic,
    unmount() {
      window.removeEventListener('pagehide', onPageHide);
      el.specCanvas.removeEventListener('pointermove', onMove);
      el.specCanvas.removeEventListener('pointerleave', onLeave);
      mic.stop();
      waveView.dispose();
      specView.dispose();
      return mic.debugInfo();
    },
    debug() {
      return {
        ...mic.debugInfo(),
        ui: {
          frozen: !!ui.frozen, windowSec: ui.windowSec, windowSamples: wave.n, waveStart: wave.start,
          triggered: wave.triggered, scale: wave.range, scaleMode: ui.vScale, range: [...ui.range],
          binHz: mic.sampleRate ? binSpacing(mic.sampleRate, ui.fftSize) : null, smoothing: SPEC_SMOOTHING,
          peaks: lastPeaks.map((p) => +p.freq.toFixed(1)), levelDb: level.rmsDb, haveData,
          plotsVisible: !el.plots.hidden, note: el.note.textContent, synthWarn: el.synthWarn.textContent,
        },
      };
    },
    /** The samples currently drawn in the waveform (for automated checks). */
    displayedSamples() {
      const buf = ui.frozen ? ui.frozen.wave : waveBuf;
      return Array.from(buf.subarray(wave.start, wave.start + wave.n));
    },
  };
}

function fmtDb(db) {
  return Number.isFinite(db) ? `${db.toFixed(0)} dBFS` : '−∞ dBFS';
}

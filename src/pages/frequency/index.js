import { h, fmtHz, fmtTime } from '../../lib/dom.js';
import * as S from './state.js';
import { AudioEngine } from './audio.js';
import { WaveformView } from './waveform.js';
import { SpectrumView, findPeaks, isSilent } from './spectrum.js';
import { SpectrogramView, HISTORY_SEC } from './spectrogram.js';
import { PRESETS, RANDOM_NOTE, EXPERIMENTS, GLOSSARY } from './content.js';

const DEFAULTS = {
  master: 0.18,
  windowSec: 0.02,
  vScale: 'auto',
  overlays: true,
  spec: { min: 0, max: 1000, log: false, auto: true },
  fftSize: 8192,
};
const WINDOW_PRESETS = [
  [0.005, '5 ms'], [0.02, '20 ms'], [0.1, '100 ms'], [1, '1 s'], [5, '5 s'],
];
const VSCALES = [['auto', 'Auto-fit'], [1, '±1'], [0.5, '±0.5'], [0.25, '±0.25'], [0.1, '±0.1'], [0.05, '±0.05']];
const FFT_SIZES = [2048, 4096, 8192, 16384, 32768];
const OVERLAY_MAX_SEC = 0.1;

export function mount(root) {
  const disposers = [];
  const listen = (target, ev, fn, opts) => {
    target.addEventListener(ev, fn, opts);
    disposers.push(() => target.removeEventListener(ev, fn, opts));
  };

  let engine;
  try {
    engine = new AudioEngine({ masterVolume: DEFAULTS.master, fftSize: DEFAULTS.fftSize });
  } catch {
    root.append(h('section', { class: 'card' }, h('h1', {}, 'Frequency Playground'),
      h('p', {}, 'This browser does not support the Web Audio API, which the app needs to make sound. Please use a current Chrome, Edge, Firefox or Safari.')));
    return { unmount() {} };
  }
  const sampleRate = engine.sampleRate;
  const nyquist = sampleRate / 2;

  const st = {
    comps: [],
    nextLabel: 1,
    master: DEFAULTS.master,
    windowSec: DEFAULTS.windowSec,
    vScale: DEFAULTS.vScale,
    overlays: DEFAULTS.overlays,
    spec: { ...DEFAULTS.spec },
    fftSize: DEFAULTS.fftSize,
    showSliders: true,
    presentation: false,
    measure: { mode: 'idle', data: null, binHz: sampleRate / DEFAULTS.fftSize, frozenAt: null, peaks: [], silent: false },
    log: [],
  };

  function makeComp(freq, amp, enabled = true) {
    const n = st.nextLabel++;
    return {
      id: 'c' + n + '-' + Math.random().toString(36).slice(2, 7),
      label: 'C' + n,
      color: S.PALETTE[(n - 1) % S.PALETTE.length],
      freq, amp, enabled,
      freqText: String(freq), ampText: String(amp),
      freqError: '', ampError: '',
    };
  }

  function replaceComps(list) {
    st.nextLabel = 1;
    st.comps = list.map(({ freq, amp }) => makeComp(freq, amp));
  }

  // ───────────────────────────── layout ─────────────────────────────
  const el = {};
  const help = (text) => h('p', { class: 'help' }, text);

  el.status = h('span', { class: 'status stopped', role: 'status', 'aria-live': 'polite' }, '■ Stopped');
  el.play = h('button', { class: 'btn primary big', onclick: () => play() }, '▶ Play');
  el.stop = h('button', { class: 'btn big', onclick: () => stop(), disabled: true }, '■ Stop');
  el.masterRange = h('input', { type: 'range', min: 0, max: 100, step: 1, value: String(DEFAULTS.master * 100), id: 'master', 'aria-describedby': 'master-help' });
  el.masterOut = h('output', { for: 'master', class: 'mono' }, Math.round(DEFAULTS.master * 100) + '%');
  el.normValue = h('strong', { class: 'mono' }, '1.00');
  el.normDetail = h('span', {}, '');

  const transportCard = h('section', { class: 'card transport', 'aria-label': 'Playback' },
    h('div', { class: 'row gap' }, el.play, el.stop, el.status),
    help('Play starts the sound built from the table below. Stop fades it out. (Keyboard: Space, when not typing in a box.)'),
    h('div', { class: 'field' },
      h('label', { for: 'master' }, 'Master Volume ', el.masterOut),
      el.masterRange,
      h('p', { class: 'help', id: 'master-help' }, 'Scales only what you hear (output = mixture × volume). It does not change the plots, which show the signal before Master Volume. Start low on headphones.'),
    ),
    h('div', { class: 'norm' },
      h('div', {}, 'Normalization factor: ', el.normValue, ' ', el.normDetail),
      help('Normalization scales the whole mixture to avoid clipping. It does not change the relative balance between components.'),
    ),
  );

  // Component table.
  el.tbody = h('tbody');
  el.add = h('button', { class: 'btn', onclick: () => addComponent() }, '+ Add Component');
  el.countNote = h('span', { class: 'muted' });
  el.sliderToggle = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.showSliders = e.target.checked; root.querySelector('.fp').classList.toggle('no-sliders', !st.showSliders); } });
  el.mixInfo = h('div', { class: 'mixinfo', 'aria-live': 'polite' });

  const compCard = h('section', { class: 'card', 'aria-label': 'Frequency components' },
    h('h2', {}, 'Frequency components'),
    h('div', { class: 'explain' },
      h('p', {}, 'Frequency controls how quickly this component oscillates. Amplitude controls its contribution to the mixture. Changing one component’s amplitude can change both the overall sound level and the tone quality.'),
      h('p', { class: 'muted' }, 'Amplitude 0.5 means half the wave height of amplitude 1 (before the shared normalization). It does not necessarily sound half as loud.'),
    ),
    h('div', { class: 'formula', 'aria-label': 'Synthesis formula' }, 'x(t) = Σ Aᵢ · sin(2π fᵢ t)', h('span', { class: 'muted' }, '  each row is one term; frequencies do not need to be multiples of anything')),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'comps' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Component'),
          h('th', { scope: 'col' }, 'Frequency (Hz)'),
          h('th', { scope: 'col' }, 'Amplitude (0–1)'),
          h('th', { scope: 'col', class: 'slider-col' }, 'Amplitude slider'),
          h('th', { scope: 'col' }, 'On'),
          h('th', { scope: 'col' }, h('span', { class: 'sr' }, 'Remove')),
        )),
        el.tbody,
      ),
    ),
    h('div', { class: 'row gap wrap' }, el.add, el.countNote,
      h('label', { class: 'check secondary' }, el.sliderToggle, ' Show amplitude sliders')),
    help(`Type any frequency from ${S.FREQ_MIN} to ${Math.min(S.FREQ_MAX, nyquist).toLocaleString('en-US')} Hz (decimals allowed) and press Enter or click away to apply. Amplitude applies as you type. On mutes a row without deleting it; × removes it. Up to ${S.MAX_COMPONENTS} rows. Your audio runs at ${sampleRate.toLocaleString('en-US')} samples per second, so the Nyquist limit is ${nyquist.toLocaleString('en-US')} Hz.`),
    el.mixInfo,
  );

  // Presets + Harmonic Builder.
  el.presetNote = h('p', { class: 'preset-note', 'aria-live': 'polite' }, 'Pick a preset to fill the table. You can edit every row afterwards.');
  const presetButtons = PRESETS.map((p) => h('button', { class: 'btn', onclick: () => loadPreset(p.id) }, p.name));
  presetButtons.push(h('button', { class: 'btn', onclick: () => randomize() }, 'E. Randomize'));
  el.hbBase = h('input', { type: 'text', inputmode: 'decimal', value: '110', class: 'num', 'aria-label': 'Base frequency in Hz' });
  el.hbCount = h('input', { type: 'text', inputmode: 'numeric', value: '6', class: 'num small', 'aria-label': 'Number of harmonics' });
  el.hbMsg = h('p', { class: 'msg', 'aria-live': 'polite' });
  const presetCard = h('section', { class: 'card', 'aria-label': 'Presets' },
    h('h2', {}, 'Presets'),
    h('div', { class: 'row gap wrap' }, presetButtons),
    el.presetNote,
    h('details', { class: 'builder', open: true },
      h('summary', {}, 'Harmonic Builder'),
      h('div', { class: 'row gap wrap' },
        h('label', {}, 'Base frequency (Hz) ', el.hbBase),
        h('label', {}, 'How many ', el.hbCount),
        h('button', { class: 'btn', onclick: () => buildHarmonics('replace') }, 'Replace table'),
        h('button', { class: 'btn', onclick: () => buildHarmonics('add') }, 'Add to table'),
      ),
      help('Generates base × 1, 2, 3, … with amplitudes 1, 1/2, 1/3, …. It is only a shortcut: every row stays freely editable afterwards.'),
      el.hbMsg,
    ),
  );

  // What changed?
  el.logList = h('ol', { class: 'log', 'aria-live': 'polite' });
  const logCard = h('section', { class: 'card', 'aria-label': 'What changed' },
    h('h2', {}, 'What changed?'),
    help('Concrete changes to the recipe or the display, newest first. Listen for yourself to judge how they sound.'),
    el.logList,
  );

  // Waveform card.
  el.waveCanvas = h('canvas', { class: 'plot wave', role: 'img', 'aria-label': 'Waveform plot: signal amplitude over time' });
  el.winButtons = WINDOW_PRESETS.map(([sec, label]) => h('button', { class: 'btn seg', 'data-sec': sec, onclick: () => setWindow(sec) }, label));
  el.customWin = h('input', { type: 'text', inputmode: 'decimal', class: 'num', placeholder: 'e.g. 50', 'aria-label': 'Custom time window in milliseconds' });
  el.customMsg = h('span', { class: 'msg' });
  el.vScale = h('select', { 'aria-label': 'Vertical amplitude scale', onchange: (e) => setVScale(e.target.value) },
    VSCALES.map(([v, label]) => h('option', { value: String(v) }, label)));
  el.overlay = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.overlays = e.target.checked; logChange(`Component overlays ${st.overlays ? 'shown' : 'hidden'} (display only).`); waveDirty = true; } });
  el.waveNote = h('p', { class: 'note', 'aria-live': 'polite' });
  el.waveReadout = h('span', { class: 'muted mono' });
  const waveCard = vizCard('Waveform — signal over time', 'wave',
    'Calculated from the table with the same formula as the audio · after normalization, before Master Volume',
    [
      h('div', { class: 'row gap wrap controls' },
        h('span', { class: 'ctl-label' }, 'Time window'),
        h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Time window' }, el.winButtons),
        h('label', { class: 'custom secondary' }, 'Custom ', el.customWin, ' ms ',
          h('button', { class: 'btn small', onclick: () => applyCustomWindow() }, 'Apply')),
        el.customMsg,
      ),
      h('div', { class: 'row gap wrap controls' },
        h('label', {}, 'Vertical scale ', el.vScale),
        h('label', { class: 'check' }, el.overlay, ' Show individual components (colored)'),
        el.waveReadout,
      ),
      h('div', { class: 'canvas-box wave-box' }, el.waveCanvas),
      h('p', { class: 'help' }, 'Zooming changes how much of the signal we see. It does not change its frequency or playback speed. The white line is the full mixture; colored lines are the individual components; the gray line is zero.'),
      el.waveNote,
    ]);

  // Spectrum card.
  el.specCanvas = h('canvas', { class: 'plot spec', role: 'img', 'aria-label': 'Frequency spectrum plot measured by FFT' });
  el.specMin = h('input', { type: 'text', inputmode: 'decimal', class: 'num', 'aria-label': 'Spectrum minimum frequency in Hz' });
  el.specMax = h('input', { type: 'text', inputmode: 'decimal', class: 'num', 'aria-label': 'Spectrum maximum frequency in Hz' });
  el.specAuto = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.spec.auto = e.target.checked; if (st.spec.auto) autoFitRange(); syncSpecInputs(); logChange(`Frequency range auto-fit ${st.spec.auto ? 'on' : 'off'} (display only).`); } });
  el.specLog = h('select', { 'aria-label': 'Frequency axis scale', onchange: (e) => setLog(e.target.value === 'log') },
    h('option', { value: 'lin' }, 'Linear'), h('option', { value: 'log' }, 'Logarithmic'));
  el.specMsg = h('span', { class: 'msg' });
  el.fft = h('select', { 'aria-label': 'FFT size', onchange: (e) => setFft(Number(e.target.value)) },
    FFT_SIZES.map((n) => h('option', { value: String(n), selected: n === DEFAULTS.fftSize }, n.toLocaleString('en-US'))));
  el.binInfo = h('p', { class: 'note' });
  el.specState = h('p', { class: 'state-line', 'aria-live': 'polite' });
  el.peakList = h('p', { class: 'peaks mono', 'aria-live': 'off' });
  const specCard = vizCard('Frequency Spectrum — frequencies present now', 'spec',
    'Measured live with an FFT (AnalyserNode) · after normalization, before Master Volume',
    [
      h('div', { class: 'row gap wrap controls' },
        h('span', { class: 'secondary row gap' },
          h('label', {}, 'From ', el.specMin, ' Hz'),
          h('label', {}, 'to ', el.specMax, ' Hz'),
          h('button', { class: 'btn small', onclick: () => applySpecRange() }, 'Apply')),
        h('label', { class: 'check' }, el.specAuto, ' Auto-fit to components'),
        h('label', {}, 'Frequency axis ', el.specLog),
        h('label', {}, 'FFT size ', el.fft),
        el.specMsg,
      ),
      el.specState,
      h('div', { class: 'canvas-box spec-box' }, el.specCanvas),
      h('p', { class: 'legend' },
        h('span', { class: 'key dashed' }), ' dashed colored line = expected (typed in the table)   ',
        h('span', { class: 'key dot' }), ' white dot = peak measured by the FFT'),
      el.peakList,
      h('p', { class: 'help' }, 'The Fourier transform separates a short segment of the combined signal into frequency components. Peaks show frequencies present in that segment.'),
      el.binInfo,
    ]);

  // Spectrogram card.
  el.sgCanvas = h('canvas', { class: 'plot sg', role: 'img', 'aria-label': 'Spectrogram: frequency over time, color shows magnitude' });
  el.sgState = h('p', { class: 'state-line', 'aria-live': 'polite' });
  el.sgRange = h('span', { class: 'muted' });
  const sgCard = vizCard('Spectrogram — how frequencies change over time', 'sg',
    `Successive FFT snapshots from the same measurement as the spectrum · last ${HISTORY_SEC} s of playing time`,
    [
      h('div', { class: 'row gap wrap controls' },
        h('button', { class: 'btn small', onclick: () => { spectrogram.clear(); logChange('Spectrogram history cleared (display only).'); } }, 'Clear History'),
        el.sgRange,
      ),
      el.sgState,
      h('div', { class: 'canvas-box sg-box' }, el.sgCanvas),
      h('p', { class: 'help' }, 'A spectrum is one snapshot. A spectrogram places many snapshots next to each other so we can see change over time. Brighter = stronger. White vertical lines mark where playback was stopped and restarted.'),
    ]);

  // Guided experiments.
  const expCards = EXPERIMENTS.map((x) => h('article', { class: 'exp card' },
    h('h3', {}, x.title),
    h('button', { class: 'btn primary', onclick: () => setupExperiment(x) }, 'Set up'),
    h('h4', {}, 'Do this'), h('ol', {}, x.actions.map((a) => h('li', {}, a))),
    h('dl', {},
      h('dt', {}, 'Listen for'), h('dd', {}, x.listen),
      h('dt', {}, 'Waveform'), h('dd', {}, x.waveform),
      h('dt', {}, 'Spectrum / spectrogram'), h('dd', {}, x.spectrum),
      h('dt', {}, 'Why'), h('dd', {}, x.why),
    ),
    h('details', { class: 'predict' }, h('summary', {}, 'Predict: ' + x.predict.q), h('p', {}, x.predict.a)),
  ));
  const expSection = h('section', { class: 'experiments', 'aria-label': 'Guided experiments' },
    h('h2', {}, 'Guided experiments'),
    help('Each Set up button loads the components and view for that experiment (it replaces the table). Then follow the steps.'),
    h('div', { class: 'exp-grid' }, expCards),
  );

  const glossary = h('details', { class: 'card glossary' },
    h('summary', {}, h('h2', {}, 'Glossary (click to open)')),
    h('dl', {}, GLOSSARY.map(([term, def]) => [h('dt', {}, term), h('dd', {}, def)])),
  );

  // Header / page toolbar.
  el.presBtn = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => setPresentation(!st.presentation) }, 'Presentation Mode: off');
  el.resetBtn = h('button', { class: 'btn danger', onclick: () => reset() }, 'Reset');
  const top = h('section', { class: 'page-top' },
    h('div', {},
      h('h1', {}, 'Frequency Playground'),
      h('p', { class: 'lead' }, 'Type frequencies and amplitudes, hear the combined sound, and see it as a waveform, a spectrum and a spectrogram.'),
    ),
    h('div', { class: 'top-actions' },
      el.presBtn,
      help('Presentation Mode enlarges text and hides secondary settings (custom zoom, exact spectrum range, slider toggle). Every essential control stays.'),
      el.resetBtn,
      help('Reset stops the sound and restores: one component (220 Hz, amplitude 1), 18% volume, 20 ms view, auto scales, FFT 8192, and clears the spectrogram and change log.'),
    ),
  );

  el.backdrop = h('div', { class: 'backdrop', onclick: () => collapseAll() });
  const page = h('div', { class: 'fp' },
    top,
    h('div', { class: 'fp-grid' },
      h('div', { class: 'fp-controls' }, transportCard, compCard, presetCard, logCard),
      h('div', { class: 'fp-visuals' }, waveCard, specCard, sgCard),
    ),
    expSection,
    glossary,
    el.backdrop,
  );
  root.append(page);

  function vizCard(title, key, badge, children) {
    const btn = h('button', { class: 'btn small expand', 'aria-expanded': 'false' }, '⤢ Expand');
    const card = h('section', { class: 'card viz', 'data-viz': key, 'aria-label': title },
      h('div', { class: 'viz-head' }, h('h2', {}, title), btn),
      h('p', { class: 'badge' }, badge),
      children,
    );
    btn.addEventListener('click', () => {
      const expanding = !card.classList.contains('expanded');
      collapseAll();
      if (expanding) {
        card.classList.add('expanded');
        btn.textContent = '✕ Close';
        btn.setAttribute('aria-expanded', 'true');
        el.backdrop.classList.add('show');
      }
    });
    return card;
  }

  function collapseAll() {
    for (const c of page.querySelectorAll('.viz.expanded')) {
      c.classList.remove('expanded');
      const b = c.querySelector('.expand');
      b.textContent = '⤢ Expand';
      b.setAttribute('aria-expanded', 'false');
    }
    el.backdrop.classList.remove('show');
  }

  // ───────────────────────────── views ─────────────────────────────
  const waveform = new WaveformView(el.waveCanvas);
  const spectrum = new SpectrumView(el.specCanvas);
  const spectrogram = new SpectrogramView(el.sgCanvas);
  let waveDirty = true;
  let specDirty = true;
  waveform.onResize = () => { waveDirty = true; };
  spectrum.onResize = () => { specDirty = true; };

  // ───────────────────────────── table ─────────────────────────────
  function renderTable() {
    el.tbody.replaceChildren(...st.comps.map(rowFor));
    el.add.disabled = st.comps.length >= S.MAX_COMPONENTS;
    el.countNote.textContent = `${st.comps.length} of ${S.MAX_COMPONENTS} components` +
      (st.comps.length >= S.MAX_COMPONENTS ? ' (maximum reached)' : '');
  }

  function rowFor(c) {
    const fIn = h('input', { type: 'text', inputmode: 'decimal', class: 'num', value: c.freqText, 'aria-label': `${c.label} frequency in Hz` });
    const aIn = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', value: c.ampText, 'aria-label': `${c.label} amplitude from 0 to 1` });
    const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: String(c.amp), 'aria-label': `${c.label} amplitude slider` });
    const on = h('input', { type: 'checkbox', checked: c.enabled, 'aria-label': `${c.label} on` });
    const rm = h('button', { class: 'btn icon', title: `Remove ${c.label}`, 'aria-label': `Remove ${c.label}` }, '×');
    const fMsg = h('div', { class: 'msg', 'aria-live': 'polite' });
    const aMsg = h('div', { class: 'msg', 'aria-live': 'polite' });

    const showF = () => {
      fIn.classList.toggle('invalid', !!c.freqError);
      fIn.setAttribute('aria-invalid', c.freqError ? 'true' : 'false');
      const pending = !c.freqError && Number(fIn.value) !== c.freq;
      fMsg.textContent = c.freqError
        ? `${c.freqError} Still playing ${fmtHz(c.freq)}.`
        : pending ? 'Press Enter to apply.' : '';
      fMsg.classList.toggle('pending', pending);
    };
    const showA = () => {
      aIn.classList.toggle('invalid', !!c.ampError);
      aIn.setAttribute('aria-invalid', c.ampError ? 'true' : 'false');
      aMsg.textContent = c.ampError ? `${c.ampError} Still using ${c.amp}.` : '';
    };

    fIn.addEventListener('input', () => {
      c.freqText = fIn.value;
      const r = S.parseFrequency(fIn.value, nyquist);
      c.freqError = r.ok ? '' : r.error;
      showF();
    });
    const commitF = () => {
      const r = S.parseFrequency(fIn.value, nyquist);
      c.freqError = r.ok ? '' : r.error;
      if (r.ok && r.value !== c.freq) {
        const old = c.freq;
        c.freq = r.value;
        applyRecipe(`${c.label} frequency: ${fmtHz(old)} → ${fmtHz(c.freq)}.`);
      }
      showF();
    };
    fIn.addEventListener('change', commitF);
    fIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitF(); });

    const setAmp = (v, source) => {
      if (v === c.amp) return;
      const old = c.amp;
      c.amp = v;
      if (source !== 'slider') slider.value = String(v);
      if (source !== 'text') { aIn.value = String(v); c.ampText = aIn.value; }
      applyRecipe(`${c.label} amplitude: ${old} → ${v}.`, { coalesce: c.id + ':amp' });
    };
    aIn.addEventListener('input', () => {
      c.ampText = aIn.value;
      const r = S.parseAmplitude(aIn.value);
      c.ampError = r.ok ? '' : r.error;
      showA();
      if (r.ok) setAmp(r.value, 'text');
    });
    slider.addEventListener('input', () => {
      c.ampError = '';
      showA();
      setAmp(Number(slider.value), 'slider');
    });
    on.addEventListener('change', () => {
      c.enabled = on.checked;
      tr.classList.toggle('off', !c.enabled);
      applyRecipe(`${c.label} (${fmtHz(c.freq)}) turned ${c.enabled ? 'on' : 'off'}.`);
    });
    rm.addEventListener('click', () => {
      st.comps = st.comps.filter((x) => x !== c);
      renderTable();
      applyRecipe(`Removed ${c.label} (${fmtHz(c.freq)}, amplitude ${c.amp}).`);
    });

    const tr = h('tr', { class: c.enabled ? '' : 'off', 'data-id': c.id },
      h('th', { scope: 'row' }, h('span', { class: 'swatch', style: { background: c.color } }), c.label),
      h('td', {}, fIn, fMsg),
      h('td', {}, aIn, aMsg),
      h('td', { class: 'slider-col' }, slider),
      h('td', {}, on),
      h('td', {}, rm),
    );
    showF();
    showA();
    return tr;
  }

  function addComponent() {
    if (st.comps.length >= S.MAX_COMPONENTS) return;
    const c = makeComp(440, 0.5);
    st.comps.push(c);
    renderTable();
    applyRecipe(`Added ${c.label}: ${fmtHz(c.freq)}, amplitude ${c.amp}. Type your own frequency in its box.`);
    const input = el.tbody.querySelector(`tr[data-id="${c.id}"] input`);
    if (input) { input.focus(); input.select(); }
  }

  // ───────────────────────────── recipe changes ─────────────────────────────
  let lastNorm = 1;
  function applyRecipe(message, opts = {}) {
    const { factor } = S.normalization(st.comps);
    engine.sync(st.comps.map(({ id, freq, amp, enabled }) => ({ id, freq, amp, enabled })), factor);
    let msg = message;
    if (Math.abs(factor - lastNorm) > 0.005) msg += ` Normalization factor ${lastNorm.toFixed(2)} → ${factor.toFixed(2)}.`;
    lastNorm = factor;
    if (st.spec.auto) autoFitRange();
    if (msg) logChange(msg, opts.coalesce);
    updateDerived();
  }

  function updateDerived() {
    const { sum, factor } = S.normalization(st.comps);
    el.normValue.textContent = factor.toFixed(2);
    el.normDetail.textContent = sum > 1
      ? `(sum of active amplitudes = ${sum.toFixed(2)}, which is above 1, so every component is multiplied by 1 ÷ ${sum.toFixed(2)})`
      : `(sum of active amplitudes = ${sum.toFixed(2)} ≤ 1, so no scaling is needed)`;
    updateMixInfo();
    syncSpecInputs();
    waveDirty = true;
    specDirty = true;
  }

  function updateMixInfo() {
    const active = S.activeComponents(st.comps);
    const freqs = active.map((c) => c.freq);
    const lines = [];
    lines.push(h('div', {}, h('strong', {}, 'Active components: '), `${active.length} of ${st.comps.length}`));
    if (!active.length) {
      lines.push(h('div', {}, 'No active components: the mixture is silent.'));
    } else {
      const lowest = Math.min(...freqs);
      lines.push(h('div', {}, h('strong', {}, 'Lowest active frequency: '), fmtHz(lowest),
        h('span', { class: 'muted' }, ' (just the smallest value, not automatically a fundamental)')));
      const cb = S.commonBase(freqs);
      const roundNote = cb.rounded ? ' (from values rounded to 0.01 Hz)' : '';
      if (active.length === 1) {
        lines.push(h('div', {}, h('strong', {}, 'Repeats every: '), `${fmtTime(cb.period)} (one period of a single sine, 1 ÷ ${fmtHz(lowest)}).`));
      } else if (cb.base >= S.FREQ_MIN) {
        const missing = cb.base < lowest - 1e-9;
        lines.push(h('div', {}, h('strong', {}, 'Common base: '), `${fmtHz(cb.base)}. Every active frequency is a whole-number multiple of it (× ${cb.multiples.join(', ')}), so this is a harmonic mixture and the waveform repeats every ${fmtTime(cb.period)}${roundNote}.`));
        if (missing) lines.push(h('div', { class: 'muted' }, `The base ${fmtHz(cb.base)} itself is not in the mixture (a "missing fundamental"); listeners often still hear a pitch near it.`));
      } else {
        lines.push(h('div', {}, h('strong', {}, 'Common base: '), `none at or above ${S.FREQ_MIN} Hz, so this is not a harmonic series. The exact pattern repeats only every ${fmtTime(cb.period)}${roundNote} (1 ÷ ${fmtHz(cb.base)}), much longer than any single component's period.`));
      }
    }
    el.mixInfo.replaceChildren(h('h3', {}, 'About this mixture'), ...lines);
  }

  // ───────────────────────────── log ─────────────────────────────
  let lastLogKey = null;
  function logChange(text, coalesceKey = null) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (coalesceKey && coalesceKey === lastLogKey && st.log.length) {
      // Keep the original "from" value when the same control changes in a row.
      const prev = st.log[0];
      const from = prev.text.match(/: (\S+) →/);
      st.log[0] = { time, text: from ? text.replace(/: \S+ →/, `: ${from[1]} →`) : text };
    } else {
      st.log.unshift({ time, text });
      st.log.length = Math.min(st.log.length, 8);
    }
    lastLogKey = coalesceKey;
    el.logList.replaceChildren(...st.log.map((e) => h('li', {}, h('span', { class: 'mono muted' }, e.time + '  '), e.text)));
  }

  // ───────────────────────────── playback ─────────────────────────────
  async function play() {
    if (engine.isPlaying) return;
    const { factor } = S.normalization(st.comps);
    spectrogram.markStart();
    st.measure.mode = 'warming';
    updateTransport('starting');
    await engine.play(st.comps.map(({ id, freq, amp, enabled }) => ({ id, freq, amp, enabled })), factor);
    if (!alive) return;
    if (engine.ctx.state !== 'running') {
      updateTransport('blocked');
      engine.stop();
      return;
    }
    updateTransport();
    logChange('Playback started.');
  }

  function stop(silent = false) {
    if (!engine.isPlaying) return;
    engine.stop();
    if (st.measure.data && st.measure.mode === 'live') {
      st.measure.mode = 'frozen';
      st.measure.frozenAt = new Date();
    } else st.measure.mode = 'idle';
    specDirty = true;
    updateTransport();
    if (!silent) logChange('Playback stopped.');
  }

  function updateTransport(phase) {
    const playing = engine.isPlaying;
    el.play.disabled = playing;
    el.stop.disabled = !playing;
    el.status.className = 'status ' + (phase === 'blocked' ? 'blocked' : playing ? 'playing' : 'stopped');
    el.status.textContent = phase === 'starting' ? '… Starting'
      : phase === 'blocked' ? 'Audio blocked by the browser. Click Play again.'
      : playing ? '● Playing' : '■ Stopped';
  }

  // ───────────────────────────── presets ─────────────────────────────
  function loadPreset(id, { quiet = false } = {}) {
    const p = PRESETS.find((x) => x.id === id);
    replaceComps(p.comps.map(([freq, amp]) => ({ freq, amp })));
    renderTable();
    applyRecipe(quiet ? '' : `Loaded preset ${p.name}: ${p.comps.map(([f]) => f + ' Hz').join(', ')}.`);
    const note = [h('strong', {}, p.name + ': '), p.note];
    if (p.suggestWindow && st.windowSec !== p.suggestWindow) {
      note.push(' ', h('button', { class: 'btn small', onclick: () => setWindow(p.suggestWindow) }, `Switch waveform to ${fmtTime(p.suggestWindow)}`));
    }
    el.presetNote.replaceChildren(...note);
  }

  function randomize({ quiet = false } = {}) {
    const mix = S.randomMixture();
    replaceComps(mix);
    renderTable();
    applyRecipe(quiet ? '' : `Randomized: ${mix.map((m) => `${m.freq} Hz (${m.amp})`).join(', ')}.`);
    el.presetNote.replaceChildren(h('strong', {}, 'E. Randomize: '), RANDOM_NOTE);
  }

  function buildHarmonics(mode) {
    const b = S.parseFrequency(el.hbBase.value, nyquist);
    const n = Number(el.hbCount.value.trim());
    el.hbMsg.className = 'msg';
    if (!b.ok) { el.hbMsg.textContent = 'Base frequency: ' + b.error; return; }
    if (!Number.isInteger(n) || n < 1) { el.hbMsg.textContent = 'How many: type a whole number of at least 1.'; return; }
    const room = mode === 'replace' ? S.MAX_COMPONENTS : S.MAX_COMPONENTS - st.comps.length;
    if (n > room) { el.hbMsg.textContent = `That needs ${n} rows but only ${room} ${room === 1 ? 'is' : 'are'} available (maximum ${S.MAX_COMPONENTS}).`; return; }
    const top = b.value * n;
    const limit = Math.min(S.FREQ_MAX, nyquist);
    if (top > limit || top >= nyquist) {
      el.hbMsg.textContent = `The highest harmonic would be ${fmtHz(top)}, above the ${fmtHz(limit)} limit. Use a lower base or fewer harmonics.`;
      return;
    }
    const series = S.harmonicSeries(b.value, n);
    if (mode === 'replace') replaceComps(series);
    else st.comps.push(...series.map(({ freq, amp }) => makeComp(freq, amp)));
    renderTable();
    applyRecipe(`Harmonic Builder (${mode === 'replace' ? 'replaced table' : 'added rows'}): base ${fmtHz(b.value)} × 1…${n} = ${series.map((s) => s.freq).join(', ')} Hz.`);
    el.hbMsg.className = 'msg ok';
    el.hbMsg.textContent = `Done. The base ${fmtHz(b.value)} sets the spacing between these harmonics.`;
  }

  function setupExperiment(x) {
    const s = x.setup;
    if (s.random) randomize({ quiet: true });
    else loadPreset(s.preset, { quiet: true });
    if (s.windowSec) setWindow(s.windowSec, { quiet: true });
    setFft(s.fftSize || DEFAULTS.fftSize, { quiet: true });
    logChange(`Set up experiment "${x.title}": ${st.comps.map((c) => fmtHz(c.freq)).join(', ')}; waveform window ${fmtTime(st.windowSec)}; FFT size ${st.fftSize}.`);
    page.querySelector('.fp-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ───────────────────────────── display settings ─────────────────────────────
  function setWindow(sec, { quiet = false } = {}) {
    const old = st.windowSec;
    st.windowSec = sec;
    for (const b of el.winButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === sec));
    el.customMsg.textContent = '';
    waveDirty = true;
    if (!quiet && old !== sec) logChange(`Waveform window: ${fmtTime(old)} → ${fmtTime(sec)} (display only; the sound is unchanged).`);
  }

  function applyCustomWindow() {
    const v = Number(el.customWin.value.trim());
    if (el.customWin.value.trim() === '' || !Number.isFinite(v)) {
      el.customMsg.textContent = 'Type a number of milliseconds, for example 50.';
      return;
    }
    if (v < 1 || v > 10000) {
      el.customMsg.textContent = 'Use 1 to 10,000 ms (0.001 to 10 s).';
      return;
    }
    setWindow(v / 1000);
  }
  listen(el.customWin, 'keydown', (e) => { if (e.key === 'Enter') applyCustomWindow(); });

  function setVScale(v) {
    const old = st.vScale;
    st.vScale = v === 'auto' ? 'auto' : Number(v);
    el.vScale.value = String(st.vScale);
    waveDirty = true;
    logChange(`Vertical scale: ${label(old)} → ${label(st.vScale)} (display only).`);
    function label(x) { return x === 'auto' ? 'auto-fit' : '±' + x; }
  }

  function autoFitRange() {
    const active = S.activeComponents(st.comps);
    const fmax = active.length ? Math.max(...active.map((c) => c.freq)) : 1000;
    const nice = (v) => { const step = v <= 2000 ? 100 : v <= 5000 ? 500 : 1000; return Math.ceil(v / step) * step; };
    st.spec.max = Math.min(nyquist, Math.max(500, nice(fmax * 1.25)));
    st.spec.min = st.spec.log ? 20 : 0;
    specDirty = true;
    spectrogram.dirty = true;
  }

  function syncSpecInputs() {
    if (document.activeElement !== el.specMin) el.specMin.value = String(st.spec.min);
    if (document.activeElement !== el.specMax) el.specMax.value = String(st.spec.max);
    el.sgRange.textContent = `Frequency range ${fmtHz(st.spec.min)} – ${fmtHz(st.spec.max)}, ${st.spec.log ? 'logarithmic' : 'linear'} (same as the spectrum).`;
  }

  function applySpecRange() {
    const lo = Number(el.specMin.value.trim());
    const hi = Number(el.specMax.value.trim());
    const minAllowed = st.spec.log ? 10 : 0;
    let err = '';
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || el.specMin.value.trim() === '' || el.specMax.value.trim() === '') err = 'Type numbers in both boxes.';
    else if (lo < minAllowed) err = st.spec.log ? 'A log axis needs a "from" of at least 10 Hz.' : '"From" cannot be negative.';
    else if (hi > nyquist) err = `"To" can be at most ${fmtHz(nyquist)} (Nyquist).`;
    else if (hi - lo < 20) err = '"To" must be at least 20 Hz above "From".';
    el.specMsg.textContent = err;
    if (err) return;
    st.spec.min = lo;
    st.spec.max = hi;
    st.spec.auto = false;
    el.specAuto.checked = false;
    syncSpecInputs();
    specDirty = true;
    spectrogram.dirty = true;
    logChange(`Spectrum range set to ${fmtHz(lo)} – ${fmtHz(hi)} (display only).`);
  }
  listen(el.specMin, 'keydown', (e) => { if (e.key === 'Enter') applySpecRange(); });
  listen(el.specMax, 'keydown', (e) => { if (e.key === 'Enter') applySpecRange(); });

  function setLog(log) {
    st.spec.log = log;
    el.specLog.value = log ? 'log' : 'lin';
    if (log && st.spec.min < 20) st.spec.min = 20;
    if (!log && st.spec.auto) st.spec.min = 0;
    syncSpecInputs();
    specDirty = true;
    spectrogram.dirty = true;
    logChange(`Frequency axis: ${log ? 'logarithmic (equal space per doubling)' : 'linear (equal space per Hz)'} (display only).`);
  }

  function setFft(n, { quiet = false } = {}) {
    const old = st.fftSize;
    st.fftSize = n;
    el.fft.value = String(n);
    engine.setFftSize(n);
    st.measure.binHz = sampleRate / n;
    if (st.measure.mode === 'frozen') { st.measure.mode = 'idle'; st.measure.data = null; }
    measureBuf = new Float32Array(engine.analyser.frequencyBinCount);
    updateBinInfo();
    specDirty = true;
    if (!quiet && old !== n) logChange(`FFT size: ${old} → ${n}; bin spacing now ${(sampleRate / n).toFixed(2)} Hz (measurement only; the sound is unchanged).`);
  }

  function updateBinInfo() {
    const bin = sampleRate / st.fftSize;
    el.binInfo.textContent = `Bin spacing = sample rate ÷ FFT size = ${sampleRate.toLocaleString('en-US')} ÷ ${st.fftSize.toLocaleString('en-US')} ≈ ${bin.toFixed(2)} Hz. ` +
      `Each measurement looks at the last ${fmtTime(st.fftSize / sampleRate)} of audio. Components closer than about 3 bins (≈ ${(3 * bin).toFixed(0)} Hz) may merge into one peak, and every peak spreads over a few neighbouring bins. A larger FFT size separates closer frequencies but reacts more slowly.`;
  }

  function setPresentation(on) {
    st.presentation = on;
    page.classList.toggle('presentation', on);
    document.body.classList.toggle('presentation', on);
    el.presBtn.textContent = `Presentation Mode: ${on ? 'on' : 'off'}`;
    el.presBtn.setAttribute('aria-pressed', String(on));
  }

  function reset() {
    stop(true);
    collapseAll();
    replaceComps([{ freq: 220, amp: 1 }]);
    renderTable();
    st.master = DEFAULTS.master;
    el.masterRange.value = String(DEFAULTS.master * 100);
    el.masterOut.textContent = Math.round(DEFAULTS.master * 100) + '%';
    engine.setMaster(DEFAULTS.master);
    setWindow(DEFAULTS.windowSec, { quiet: true });
    st.vScale = 'auto';
    el.vScale.value = 'auto';
    st.overlays = true;
    el.overlay.checked = true;
    st.spec = { ...DEFAULTS.spec };
    el.specAuto.checked = true;
    el.specLog.value = 'lin';
    el.specMsg.textContent = '';
    el.customMsg.textContent = '';
    el.customWin.value = '';
    el.hbMsg.textContent = '';
    setFft(DEFAULTS.fftSize, { quiet: true });
    st.measure.mode = 'idle';
    st.measure.data = null;
    spectrogram.clear();
    st.log = [];
    lastNorm = 1;
    applyRecipe('');
    el.presetNote.textContent = 'Pick a preset to fill the table. You can edit every row afterwards.';
    logChange('Reset: sound stopped; one component at 220 Hz, amplitude 1; 18% volume; 20 ms view; default scales; FFT 8192; spectrogram cleared.');
  }

  listen(el.masterRange, 'input', () => {
    const old = st.master;
    st.master = Number(el.masterRange.value) / 100;
    el.masterOut.textContent = Math.round(st.master * 100) + '%';
    engine.setMaster(st.master);
    logChange(`Master Volume: ${Math.round(old * 100)}% → ${Math.round(st.master * 100)}% (listening output only; the plots show the signal before Master Volume, so they do not change).`, 'master');
  });

  listen(window, 'keydown', (e) => {
    if (e.key === 'Escape') collapseAll();
    const tag = (e.target.tagName || '').toLowerCase();
    if (e.code === 'Space' && !['input', 'select', 'textarea', 'button', 'summary'].includes(tag)) {
      e.preventDefault();
      if (engine.isPlaying) stop(); else play();
    }
  });

  // ───────────────────────────── animation loop ─────────────────────────────
  let measureBuf = new Float32Array(engine.analyser.frequencyBinCount);
  let alive = true;
  let raf = 0;
  let lastPeakText = 0;
  window.__fpLoops = (window.__fpLoops || 0) + 1;

  function expectedMarkers() {
    return S.activeComponents(st.comps).map((c) => ({ freq: c.freq, color: c.color, label: c.label }));
  }

  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const m = st.measure;

    if (engine.isPlaying) {
      const pt = engine.playTime;
      // Wait until a full FFT block of real audio has been captured.
      if (pt !== null && pt >= st.fftSize / sampleRate) {
        engine.analyser.getFloatFrequencyData(measureBuf);
        m.data = measureBuf;
        m.binHz = sampleRate / st.fftSize;
        m.mode = 'live';
        m.silent = isSilent(measureBuf);
        m.peaks = findPeaks(measureBuf, m.binHz, { minHz: st.spec.min, maxHz: st.spec.max });
        spectrogram.advance(measureBuf, m.binHz, pt);
        specDirty = true;
      } else if (m.mode !== 'warming') {
        m.mode = 'warming';
        specDirty = true;
      }
    }

    if (waveDirty) {
      waveDirty = false;
      drawWave();
    }
    if (specDirty) {
      specDirty = false;
      spectrum.render({
        data: m.data, binHz: m.binHz, mode: m.mode, min: st.spec.min, max: st.spec.max,
        log: st.spec.log, expected: expectedMarkers(), peaks: m.peaks, silent: m.silent,
      });
      updateSpecText();
    }
    if (spectrogram.dirty) spectrogram.render({ min: st.spec.min, max: st.spec.max, log: st.spec.log });
  }

  function drawWave() {
    const active = S.activeComponents(st.comps);
    const { factor } = S.normalization(st.comps);
    const overlaysAllowed = st.windowSec <= OVERLAY_MAX_SEC;
    const r = waveform.render({
      comps: active.map((c) => ({ freq: c.freq, amp: c.amp, color: c.color })),
      gain: factor, duration: st.windowSec, vScale: st.vScale,
      overlays: st.overlays && overlaysAllowed && active.length > 1,
    });
    el.waveReadout.textContent = `Showing ${fmtTime(st.windowSec)} × ±${r.range}`;
    const notes = [];
    if (r.dense && active.length) {
      const fmax = Math.max(...active.map((c) => c.freq));
      notes.push(`At ${fmtTime(st.windowSec)}, one cycle of ${fmtHz(fmax)} is narrower than ${Math.max(r.periodPx, 0.01).toFixed(r.periodPx < 1 ? 2 : 1)} pixels, so individual oscillations are too dense to draw. This is expected: the bright band shows the true highest and lowest values in each pixel column (its outline is the envelope). Zoom in (5 ms or 20 ms) to see individual cycles.`);
    }
    if (st.overlays && !overlaysAllowed && active.length > 1) notes.push(`Colored component overlays are hidden above ${fmtTime(OVERLAY_MAX_SEC)} for clarity.`);
    el.waveNote.textContent = notes.join(' ');
  }

  function updateSpecText() {
    const m = st.measure;
    if (m.mode === 'idle') el.specState.textContent = 'Not measuring: press Play to see the measured spectrum.';
    else if (m.mode === 'warming') el.specState.textContent = 'Measuring…';
    else if (m.mode === 'live') el.specState.textContent = '● Live measurement (updates every frame).';
    else el.specState.textContent = `Frozen: this is the last measurement before Stop (${m.frozenAt.toLocaleTimeString()}). It will not update until you press Play.`;
    el.specState.className = 'state-line ' + m.mode;
    el.sgState.textContent = engine.isPlaying ? '● Recording new snapshots while playing.' : 'Paused: history only advances while sound is playing.';

    const now = performance.now();
    if (now - lastPeakText < 250 && m.mode === 'live') return;
    lastPeakText = now;
    if (m.mode !== 'live' && m.mode !== 'frozen') {
      el.peakList.textContent = '';
      el.peakList.dataset.peaks = '';
      return;
    }
    const exp = expectedMarkers().filter((e) => e.freq >= st.spec.min && e.freq <= st.spec.max);
    const tol = Math.max(1.5 * m.binHz, 2);
    const found = exp.filter((e) => m.peaks.some((p) => Math.abs(p.freq - e.freq) <= tol)).length;
    el.peakList.dataset.peaks = m.peaks.map((p) => p.freq.toFixed(2)).join(',');
    el.peakList.textContent = m.silent
      ? 'Measured peaks: none (silence).'
      : `Measured peaks: ${m.peaks.map((p) => p.freq.toFixed(1)).join(', ') || 'none in this range'} Hz. ` +
        `${found} of ${exp.length} expected components have a measured peak within ±${tol.toFixed(1)} Hz (1.5 bins).`;
  }

  // ───────────────────────────── init ─────────────────────────────
  replaceComps([{ freq: 220, amp: 1 }]);
  renderTable();
  setWindow(DEFAULTS.windowSec, { quiet: true });
  el.vScale.value = 'auto';
  updateBinInfo();
  autoFitRange();
  updateDerived();
  updateTransport();
  logChange('Ready: one component at 220 Hz, amplitude 1. Press Play to listen.');
  raf = requestAnimationFrame(frame);

  // Debug hook used by the automated browser checks (scripts/verify.mjs).
  window.__frequencyPlayground = {
    debug: () => ({
      engine: engine.debugInfo(),
      comps: st.comps.map(({ label, freq, amp, enabled }) => ({ label, freq, amp, enabled })),
      windowSec: st.windowSec, vScale: st.vScale, fftSize: st.fftSize,
      measure: { mode: st.measure.mode, silent: st.measure.silent, peaks: st.measure.peaks.map((p) => +p.freq.toFixed(2)), binHz: st.measure.binHz },
      spectrogramColumns: spectrogram.cols.length,
      loops: window.__fpLoops,
    }),
  };

  return {
    unmount() {
      alive = false;
      cancelAnimationFrame(raf);
      window.__fpLoops -= 1;
      engine.close();
      for (const d of disposers) d();
      waveform.dispose();
      spectrum.dispose();
      spectrogram.dispose();
      document.body.classList.remove('presentation');
      window.__frequencyPlaygroundLast = engine.debugInfo();
      delete window.__frequencyPlayground;
    },
  };
}

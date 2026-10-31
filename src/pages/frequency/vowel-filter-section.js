// Vowel filtering (assignment 4): start from the fundamental and every
// harmonic at amplitude 1, then shape whole frequency regions with a real
// filter, by dragging, from an approximate vowel example, or fitted
// automatically to a recording. Lives inside the Vowel Lab so it can use its
// recordings, but keeps its own experiments (vowel-store FILTER_KEY), its own
// audio (FilterAudio) and never edits the harmonic sliders or any manual or
// automatic experiment.
import { h, fmtHz, fmtTime } from '../../lib/dom.js';
import * as M from './vowel-model.js';
import * as AV from './auto-vowel.js';
import * as VF from './vowel-filter.js';
import { encodeWav, decodeWav } from './wav.js';
import { FilterAudio, renderOffline } from './filter-audio.js';
import { FilterResponseView, FilterSpectrumView } from './filter-plots.js';
import { OverviewView } from './vowel-plots.js';
import * as store from './vowel-store.js';
import { createVowelTutorial } from './vowel-tutorial.js';
import { FILTER_TOUR_STEPS } from './filter-tour.js';

const RANGES = [2000, 4000, 5000, 8000];
const SPEC_FFT = 8192;
export const LEAD = 'The source starts with the fundamental and all active harmonics at equal strength. The filter reduces selected frequency regions, changing the balance of harmonics and the vowel-like character of the sound.';

/**
 * opts: { help, getRecordings(), recById(id), openExperiment() → { recordingId, segment } | null,
 *         stopOtherAudio(), isRecording(), logChange(text, key), download(name, blob), goToRecording() }
 */
export function createFilterSection({ help, getRecordings, recById, openExperiment, stopOtherAudio, isRecording, logChange, download, goToRecording, getManualComponents = () => [] }) {
  const audio = new FilterAudio({ volume: 0.5, onChange: () => { updateTransport(); dirty = true; } });
  const st = {
    saved: [],
    work: null,
    selected: 0,
    range: 5000,
    log: false,
    showUnfiltered: true,
    matchOrig: true,
    makeupOn: false, // optional peak-matching makeup gain on the filtered sound (off = true filter effect)
    makeup: 1,
    customMsg: '',
    wavLen: 3,
    hover: null,
    dragging: null,
    fit: null, // last automatic fit shown: { ok, summary, points, problems, warnings, expId }
    lastAuto: null, // { recKey, f0 } of the last automatic estimate
    f0Msg: null,
    storage: { ok: true, error: '' },
    owner: false, // true while this section's audio is the one playing
  };
  let dirty = true;
  let origSpec = null;
  let wetSpec = null;
  let drySpec = null;
  let specDirty = true;
  let lastSpecAt = 0;

  const rate = () => audio.sampleRate || VF.PREFERRED_RATE;
  const rec = () => (st.work ? recById(st.work.recordingId) : null);
  const savedFor = (id) => st.saved.find((e) => e.id === id) || null;
  const strip = (e) => { const { savedAt, ...rest } = e; return JSON.stringify(rest); };
  const isDirty = () => { const s = savedFor(st.work.id); return !s || strip(s) !== strip(st.work); };

  // ───────────── elements ─────────────
  const fel = {};
  const tour = createVowelTutorial({ el: fel, steps: FILTER_TOUR_STEPS, idPrefix: 'ftour', label: '❓ Tour: vowel filtering', hasRecording: () => !!rec(), onOpen: () => openHooks.onTour() });
  const openHooks = { onTour: () => {} };
  const box = (cls, ...c) => h('div', { class: cls }, ...c);
  const step = (num, title, ...c) => h('div', { class: 'vf-step', 'data-step': num }, h('h3', {}, h('span', { class: 'vf-step-num' }, String(num)), title), ...c);

  fel.lead = h('p', { class: 'vf-lead' }, LEAD);
  fel.expSelect = h('select', { class: 'vf-exp-select', 'aria-label': 'Filter experiment', onchange: (e) => openFilterExperiment(e.target.value) });
  fel.saveState = h('span', { class: 'vf-save-state', role: 'status', 'aria-live': 'polite' });
  fel.saveBtn = h('button', { class: 'btn primary', onclick: () => save() }, '💾 Save filter experiment');
  fel.saveNewBtn = h('button', { class: 'btn', onclick: () => save({ asNew: true }) }, 'Save as a new copy');
  fel.newBtn = h('button', { class: 'btn', onclick: () => newExperiment() }, '＋ New filter experiment');

  // 1. recording + section + label
  fel.recSelect = h('select', { 'aria-label': 'Recording to compare with', onchange: (e) => setRecording(e.target.value || null) });
  fel.recHint = h('span', { class: 'help inline' });
  fel.goRecord = h('button', { class: 'btn small', onclick: () => goToRecording() }, '● Record or ⬆ import in stage 1');
  fel.overview = h('canvas', { class: 'plot vl-overview', role: 'img', 'aria-label': 'Whole recording; drag to choose the section used for comparing and fitting' });
  fel.overviewBox = h('div', { class: 'canvas-box vf-overview-box' }, fel.overview);
  fel.segStart = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', 'aria-label': 'Section start in seconds' });
  fel.segEnd = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', 'aria-label': 'Section end in seconds' });
  fel.segMsg = h('span', { class: 'msg' });
  fel.segInfo = h('span', { class: 'mono muted' });
  for (const inp of [fel.segStart, fel.segEnd]) {
    inp.addEventListener('change', () => commitSeg());
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitSeg(); });
  }
  fel.useLabSeg = h('button', { class: 'btn small', onclick: () => useLabSegment() }, 'Use the Vowel Lab segment');
  fel.midSeg = h('button', { class: 'btn small', 'aria-label': 'Middle second (Vowel filtering section)', onclick: () => { const r = rec(); if (r) setSegment(M.defaultSegment(r.samples.length / r.sampleRate)); } }, 'Middle second');
  fel.vowel = h('select', { 'aria-label': 'Vowel label', onchange: (e) => { st.work.vowel = e.target.value; renderLabels(); updateSaveState(); } },
    VF.FILTER_VOWELS.map((v) => h('option', { value: v.id }, `${v.name} /${v.ipa}/ as in “${v.word}”`)), h('option', { value: 'other' }, 'other (type a label)'));
  fel.vowelText = h('input', { type: 'text', class: 'num', placeholder: 'e.g. eh', 'aria-label': 'Custom vowel label', oninput: (e) => { st.work.vowelText = e.target.value; renderLabels(); updateSaveState(); } });
  fel.vowelSay = h('span', { class: 'help inline' });

  // 2. fundamental and source
  fel.f0 = h('input', { type: 'text', inputmode: 'decimal', class: 'num vl-f0-input', id: 'vf-f0', 'aria-label': 'Source fundamental in Hz' });
  fel.f0Tag = h('span', { class: 'vf-tag' });
  fel.f0Msg = h('div', { class: 'vf-f0-msg', 'aria-live': 'polite' });
  fel.f0.addEventListener('change', () => commitF0());
  fel.f0.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitF0(); });
  const nudge = (d) => h('button', { class: 'btn small', onclick: () => setF0(Math.round((st.work.f0 + d) * 100) / 100, 'typed') }, (d > 0 ? '+' : '−') + Math.abs(d));
  fel.estimate = h('button', { class: 'btn', onclick: () => estimateF0() }, '🔍 Estimate from the recording');
  fel.f0Box = h('div', { class: 'vl-f0 vf-f0' },
    h('label', { for: 'vf-f0', class: 'vl-f0-label' }, 'Source fundamental f0 (fixed while you shape the filter)'),
    h('div', { class: 'row gap wrap' }, fel.f0, h('span', {}, 'Hz'), nudge(-1), nudge(-0.1), nudge(0.1), nudge(1), fel.estimate, fel.f0Tag),
    fel.f0Msg);
  fel.count = h('select', { 'aria-label': 'Number of components (fundamental + harmonics)', onchange: (e) => setCount(Number(e.target.value)) },
    VF.COUNTS.map((n) => h('option', { value: String(n) }, String(n))));
  fel.startBtn = h('button', { class: 'btn primary big', onclick: () => startAllMax() }, '▶ Start with all harmonics at maximum');
  fel.components = h('div', { class: 'vf-components', 'aria-live': 'polite' });
  fel.harmTable = h('div', { class: 'vl-auto-table' });

  // 3. filter
  fel.filterToggle = h('button', { class: 'btn big vf-toggle', 'aria-pressed': 'true', onclick: () => setEnabled(!st.work.filter.enabled) });
  fel.resetBtn = h('button', { class: 'btn', onclick: () => resetFlat() }, '↺ Reset to flat');
  fel.filterCanvas = h('canvas', { class: 'plot vf-filter-canvas', tabindex: '0', role: 'img', 'aria-label': 'Filter response. Drag a numbered point: left/right moves its frequency region, down reduces that region. Keyboard: 1–8 select a point, arrow keys move it.' });
  fel.filterBox = h('div', { class: 'canvas-box vf-filter-box' }, fel.filterCanvas);
  fel.spec = h('canvas', { class: 'plot vf-spec-canvas', role: 'img', 'aria-label': 'Spectra of the recording section, the filtered source and the unfiltered source' });
  fel.specBox = h('div', { class: 'canvas-box vf-spec-box' }, fel.spec);
  fel.rangeButtons = RANGES.map((f) => h('button', { class: 'btn seg', 'data-max': f, onclick: () => { st.range = f; renderViewButtons(); dirty = true; } }, `0–${f / 1000} kHz`));
  fel.logBtn = h('button', { class: 'btn seg', onclick: () => { st.log = !st.log; renderViewButtons(); dirty = true; } }, 'Log frequency');
  fel.showDry = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.showUnfiltered = e.target.checked; dirty = true; } });
  fel.hover = h('span', { class: 'mono muted' });
  fel.selInfo = h('div', { class: 'vf-sel', 'aria-live': 'polite' });
  fel.bandTable = h('div', { class: 'vf-bands' });
  fel.exampleSet = h('select', { 'aria-label': 'Formant averages used for the examples', onchange: () => renderExamples() },
    Object.entries(VF.FORMANT_SETS).map(([k, s]) => h('option', { value: k }, s.name)));
  fel.exampleBtns = VF.FILTER_VOWELS.map((v) => h('button', { class: 'btn vf-ex', 'data-vowel': v.id, title: `Sustained ${v.say} (/${v.ipa}/)`, 'aria-label': `Vowel example ${v.name}, as in ${v.word}`, onclick: () => loadExample(v.id) },
    h('strong', {}, v.name), ` · “${v.word}”`));
  fel.exPlay = h('button', { class: 'btn primary vl-synth-btn', 'aria-label': 'Play filtered (vowel examples)', onclick: () => playSource(true) }, '▶ Play');
  fel.exPlayDry = h('button', { class: 'btn vf-dry-btn', 'aria-label': 'Play unfiltered (vowel examples)', onclick: () => playSource(false) }, '▶ Unfiltered');
  fel.exStop = h('button', { class: 'btn', 'aria-label': 'Stop (vowel examples)', onclick: () => stopAudio() }, '■ Stop');
  fel.exNow = h('span', { class: 'vl-now', role: 'status', 'aria-live': 'polite' });
  fel.exampleInfo = h('div', { class: 'help vf-ex-info', 'aria-live': 'polite' });
  fel.exampleBox = h('div', { class: 'vl-sub-box vf-examples' },
    h('h4', {}, 'Load vowel example (approximate starting filter)'),
    h('div', { class: 'row gap wrap' }, fel.exampleBtns),
    h('div', { class: 'row gap wrap' }, fel.exPlay, fel.exPlayDry, fel.exStop, fel.exNow),
    h('div', { class: 'row gap wrap' }, h('label', {}, 'Formant averages ', fel.exampleSet)),
    fel.exampleInfo);
  fel.matchBtn = h('button', { class: 'btn primary', onclick: () => matchFilter() }, '🎯 Match filter to recording');
  fel.fitBox = h('div', { class: 'vf-fit', 'aria-live': 'polite' });
  fel.matchBox = h('div', { class: 'vl-sub-box vf-match' },
    h('h4', {}, 'Match filter to recording (analyzes your recording)'),
    h('div', { class: 'row gap wrap' }, fel.matchBtn, h('span', { class: 'help inline' }, 'Analyzes the selected section and fits the 8 filter points. The source stays at amplitude 1.')),
    fel.fitBox);

  // listen
  fel.playOrig = h('button', { class: 'btn big vl-orig-btn', 'aria-label': 'Play Original (Vowel filtering)', onclick: () => playOriginal() }, '▶ Play Original');
  fel.playDry = h('button', { class: 'btn big vf-dry-btn', onclick: () => playSource(false) }, '▶ Play Unfiltered');
  fel.playWet = h('button', { class: 'btn big vl-synth-btn', onclick: () => playSource(true) }, '▶ Play Filtered');
  fel.playAB = h('button', { class: 'btn big', onclick: () => playAB(), title: 'Plays the selected section of the recording, a short pause, then the filtered source for the same length.' }, '⇄ Original → Filtered');
  fel.stopBtn = h('button', { class: 'btn big', 'aria-label': 'Stop (Vowel filtering)', onclick: () => stopAudio() }, '■ Stop');
  fel.nowPlaying = h('span', { class: 'vl-now', role: 'status', 'aria-live': 'polite' });
  fel.volume = h('input', { type: 'range', min: 0, max: 100, step: 1, value: '50', class: 'vl-volume', 'aria-label': 'Listening volume (Vowel filtering)' });
  fel.volumeOut = h('output', { class: 'mono' }, '50%');
  fel.volume.addEventListener('input', () => { audio.setVolume(Number(fel.volume.value) / 100); fel.volumeOut.textContent = fel.volume.value + '%'; });
  fel.matchOrig = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.matchOrig = e.target.checked; updateLevelInfo(); } });
  fel.makeupOn = h('input', { type: 'checkbox', onchange: (e) => setMakeup(e.target.checked) });
  fel.levelInfo = h('p', { class: 'help vf-level' });

  // save and export
  fel.notes = h('textarea', { rows: 3, class: 'vf-note', 'aria-label': 'Notes for this filter experiment', oninput: (e) => { st.work.notes = e.target.value; updateSaveState(); } });
  fel.wavLen = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', value: '3', 'aria-label': 'Filtered WAV length in seconds' });
  fel.wavLen.addEventListener('change', () => {
    const v = Number(fel.wavLen.value);
    if (Number.isFinite(v) && v >= 0.5 && v <= 10) st.wavLen = Math.round(v * 100) / 100;
    fel.wavLen.value = String(st.wavLen);
    updateDownloads();
  });
  fel.dlWav = h('button', { class: 'btn', onclick: () => downloadWav() }, '⬇ Filtered synthesized WAV');
  fel.dlJson = h('button', { class: 'btn', onclick: () => downloadJson() }, '⬇ Settings JSON');
  fel.dlOrig = h('button', { class: 'btn', onclick: () => downloadOriginal() }, '⬇ Original recording (WAV)');
  fel.dlNote = h('p', { class: 'help' });
  fel.importJson = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr', 'aria-label': 'Import filter settings JSON', onchange: (e) => importJson(e.target.files[0], e.target) });
  fel.importMsg = h('p', { class: 'note', 'aria-live': 'polite' });
  fel.expTable = h('div', { class: 'vl-exp-table' });
  fel.storageNote = h('p', { class: 'help' });

  // workflows and source choice
  fel.tabExplore = h('button', { class: 'btn vf-tab', 'data-wf': 'explore', onclick: () => setWorkflow('explore') }, h('strong', {}, '1 · Explore vowel examples'), h('span', { class: 'vf-tab-sub' }, 'sine waves only, no recording'));
  fel.tabCustom = h('button', { class: 'btn vf-tab', 'data-wf': 'custom', onclick: () => setWorkflow('custom') }, h('strong', {}, '2 · Filter my own frequencies'), h('span', { class: 'vf-tab-sub' }, 'any components you type, no recording'));
  fel.tabRecording = h('button', { class: 'btn vf-tab', 'data-wf': 'recording', onclick: () => setWorkflow('recording') }, h('strong', {}, '3 · Match a recording'), h('span', { class: 'vf-tab-sub' }, 'compare with and fit to your voice'));
  fel.workflowTabs = h('div', { class: 'vf-tabs', role: 'group', 'aria-label': 'Vowel filtering workflow' }, fel.tabExplore, fel.tabCustom, fel.tabRecording);
  fel.workflowHint = h('p', { class: 'help vf-wf-hint', 'aria-live': 'polite' });
  fel.srcHarm = h('input', { type: 'radio', name: 'vf-source', value: 'harmonics', onchange: () => setWorkflow(st.work.workflow === 'recording' ? 'recording' : 'explore') });
  fel.srcCustom = h('input', { type: 'radio', name: 'vf-source', value: 'custom', onchange: () => setWorkflow('custom') });
  fel.sourceChoice = h('div', { class: 'row gap wrap vf-source-choice', role: 'radiogroup', 'aria-label': 'Source' },
    h('span', { class: 'ctl-label' }, 'Source'),
    h('label', { class: 'check' }, fel.srcHarm, ' Equal-strength harmonics'),
    h('label', { class: 'check' }, fel.srcCustom, ' My own frequencies'),
    fel.sourceNote = h('span', { class: 'help inline' }));

  // custom components
  fel.customRows = h('div', { class: 'vf-custom-rows' });
  fel.addRow = h('button', { class: 'btn small', onclick: () => addRow() }, '＋ Add component');
  fel.genF0 = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', value: '200', 'aria-label': 'Fundamental for generated rows (Hz)' });
  fel.genCount = h('select', { 'aria-label': 'Number of generated rows' }, [1, 2, 3, 4, 6, 8, 12, 16, 24, 32].map((n) => h('option', { value: String(n), selected: n === 12 }, String(n))));
  fel.genPattern = h('select', { 'aria-label': 'Amplitudes of generated rows' }, h('option', { value: 'equal' }, 'all amplitude 1'), h('option', { value: 'falling' }, 'falling 1, 1/2, 1/3 …'));
  fel.genReplace = h('button', { class: 'btn small', onclick: () => generateRows('replace') }, 'Replace rows with these harmonics');
  fel.genAdd = h('button', { class: 'btn small', onclick: () => generateRows('add') }, 'Add them to the rows');
  fel.loadManual = h('button', { class: 'btn small', onclick: () => loadFromManual() }, '⧉ Load a copy of my Manual frequencies setup');
  fel.customMsg = h('div', { class: 'help', 'aria-live': 'polite' });
  fel.customInfo = h('div', { class: 'vf-components', 'aria-live': 'polite' });
  fel.customBox = h('div', { class: 'vf-custom' },
    help('Each row is one sine component: any frequency, with your own amplitude (0–1). Rows are “components”; they are harmonics only if they happen to be whole-number multiples of one fundamental. The filter never changes these values.'),
    fel.customRows,
    h('div', { class: 'row gap wrap' }, fel.addRow, fel.loadManual),
    h('div', { class: 'row gap wrap vf-gen' }, h('span', { class: 'ctl-label' }, 'Convenience'), h('label', {}, 'f0 ', fel.genF0, ' Hz'), h('label', {}, '× 1 … ', fel.genCount), fel.genPattern, fel.genReplace, fel.genAdd),
    fel.customMsg,
    fel.customInfo,
    help('A filter changes the strengths of components that are already there. It cannot create missing harmonics, so one sine wave, or a few scattered frequencies, may not sound like any vowel: there is little for the filter to shape.'));
  fel.harmBox = h('div', { class: 'vf-harm' },
    fel.f0Box,
    h('div', { class: 'row gap wrap' }, h('label', {}, 'Components (fundamental + harmonics) ', fel.count), fel.startBtn),
    fel.components,
    help('Equal starting strengths create a rich, buzzy sound, because the high harmonics are as strong as the fundamental. “Maximum” means equal maximum relative amplitudes (each 1), not dozens of full-volume oscillators: the sum is scaled by one shared safety gain, the same with the filter on or bypassed.'),
    details('Every component and the gain the filter gives it (click to open)', fel.harmTable));
  fel.labelRow = h('div', { class: 'row gap wrap' }, h('label', {}, 'Vowel label ', fel.vowel), fel.vowelText, fel.vowelSay);

  fel.recPanel = step('R', 'Recording to compare with',
    h('div', { class: 'row gap wrap' }, h('label', {}, 'Recording ', fel.recSelect), fel.goRecord, fel.recHint),
    fel.overviewBox,
    h('div', { class: 'row gap wrap' }, h('label', {}, 'Section from ', fel.segStart, ' s'), h('label', {}, 'to ', fel.segEnd, ' s'), fel.useLabSeg, fel.midSeg, fel.segInfo, fel.segMsg),
    fel.recLabelSlot = h('div', {}),
    help('The label only names the experiment and its files. Vowel letters are pronounced differently across words and languages, so each label has an example word for the steady vowel meant.'));
  fel.sourcePanel = step('S', 'Source sound', fel.sourceChoice, fel.harmBox, fel.customBox);
  fel.listenOrigBits = [fel.playOrig, fel.playAB];
  fel.matchOrigLabel = h('label', { class: 'check', title: 'Scales only the original recording, so its highest peak equals the filtered sound’s. The filtered and unfiltered sounds are not re-scaled by this.' }, fel.matchOrig, ' Match the original’s peak to the filtered sound');
  fel.saveLabelSlot = h('div', {});

  const element = h('section', { class: 'card vf', 'data-section': 'filter', id: 'vowel-filtering', 'aria-label': 'Vowel filtering' },
    h('div', { class: 'vl-stage-head' }, h('span', { class: 'vl-num' }, '🎚'), h('div', {},
      h('h2', {}, 'Vowel filtering'),
      h('p', { class: 'muted vl-sub' }, 'Assignment 4: start from a harmonic-rich source, then shape a vowel with a filter. A recording is optional.')),
      h('span', { class: 'vt-section-help' }, tour.button)),
    fel.lead,
    details('What the words mean (click to open)',
      h('dl', { class: 'vf-glossary' },
        h('dt', {}, 'Fundamental (f0)'), h('dd', {}, 'The base frequency: the lowest component, and the pitch you hear.'),
        h('dt', {}, 'Harmonics'), h('dd', {}, 'Components at whole-number multiples of the fundamental: 2 × f0, 3 × f0, … With “equal-strength harmonics” every one starts at the same strength as the fundamental.'),
        h('dt', {}, 'Components'), h('dd', {}, 'Any sine waves in the source. With “my own frequencies” they can be any frequencies, so they are not necessarily harmonics.'),
        h('dt', {}, 'Filter'), h('dd', {}, 'Changes the strength of frequency regions. This one only reduces (0 dB = unchanged), so a region becomes more prominent when the regions around it are reduced.'),
        h('dt', {}, 'Formants'), h('dd', {}, 'Broad resonant regions emphasized by the vocal tract (throat, mouth, lips) that help tell vowels apart. A formant is a region, not an individual harmonic.')),
      h('p', {}, 'The filter never moves a component’s frequency (with the fundamental fixed, harmonic n stays at n × f0). It only changes how strong each one is.')),
    h('div', { class: 'vf-bar row gap wrap' }, h('span', { class: 'ctl-label' }, 'Filter experiment'), fel.expSelect, fel.saveState, fel.saveBtn, fel.saveNewBtn, fel.newBtn),
    fel.workflowTabs,
    fel.workflowHint,
    fel.recPanel,
    fel.sourcePanel,
    fel.examplePanel = h('div', { class: 'vf-two' }, fel.exampleBox, fel.matchBox),
    step('F', 'Shape the filter',
      h('div', { class: 'row gap wrap' }, fel.filterToggle, fel.resetBtn,
        h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Frequency range' }, fel.rangeButtons), fel.logBtn),
      fel.filterBox,
      h('p', { class: 'legend' },
        h('span', { class: 'key vf-key-resp' }), ' filter gain actually applied (dB, 0 = unchanged)   ',
        h('span', { class: 'key vf-key-band' }), ' selected point’s own band   ',
        h('span', { class: 'vf-key-dot' }, '●'), ' source components at the gain they receive   ',
        h('span', { class: 'vf-key-handle' }, '①'), ' draggable point = one band’s centre and its own cut'),
      fel.selInfo,
      fel.specBox,
      h('p', { class: 'legend' },
        fel.origLegend = h('span', {}, h('span', { class: 'key vl-key-orig' }), ' recording section   '),
        h('span', { class: 'key vl-key-synth' }), ' filtered source   ',
        h('label', { class: 'check' }, fel.showDry, h('span', { class: 'key vf-key-dry' }), ' unfiltered source'), '   ',
        h('span', { class: 'key vl-key-mark' }), ' source component frequencies   ', fel.hover),
      help('Two separate scales: the upper chart is the filter’s gain (how much each frequency is reduced); the lower chart is measured spectra, each shifted so its own strongest peak is 0 dB. Where a point overlaps its neighbours their cuts add up, so the green line can sit below a point.'),
      h('h4', {}, 'Filter points (type values instead of dragging)'),
      fel.bandTable),
    step('L', 'Listen and compare',
      h('div', { class: 'row gap wrap vl-transport' }, fel.playOrig, fel.playDry, fel.playWet, fel.playAB, fel.stopBtn, fel.nowPlaying),
      h('div', { class: 'row gap wrap' }, h('label', { class: 'row gap' }, 'Volume', fel.volume, fel.volumeOut), fel.matchOrigLabel),
      h('label', { class: 'check vf-makeup', title: 'Optional loudness matching. One constant gain after the filter raises the filtered sound so its peak equals the unfiltered peak. It does not change the balance between components, but it hides how much the filter removed, and the bypass comparison is then no longer at equal gain.' }, fel.makeupOn,
        ' Optional: raise the filtered sound to the unfiltered peak (makeup gain; off = hear the filter’s true reduction)'),
      fel.levelInfo),
    step('↓', 'Save and download',
      fel.saveLabelSlot,
      h('label', { class: 'vf-note-label' }, 'Notes (what matched, what did not, which points you moved)', fel.notes),
      h('div', { class: 'row gap wrap' }, fel.dlWav, fel.dlJson, fel.dlOrig, h('label', { class: 'secondary' }, 'WAV length ', fel.wavLen, ' s')),
      fel.dlNote,
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn small', onclick: () => fel.importJson.click() }, '⬆ Import filter settings (JSON)'), fel.importJson),
      fel.importMsg,
      h('h4', {}, 'Saved filter experiments'),
      fel.expTable,
      fel.storageNote),
    details('How the filter and the automatic fit work (click to open)',
      h('ul', {},
        h('li', {}, h('strong', {}, 'Source. '), `Equal-strength harmonics: x(t) = g · Σ sin(2π n f0 t), every amplitude 1. My own frequencies: x(t) = g · Σ aᵢ sin(2π fᵢ t) with your amplitudes. Every sine starts at phase 0. g = ${VF.SAFE_PEAK} ÷ (sum of the amplitudes), so the unfiltered sum and every filtered version stay below ${VF.SAFE_PEAK} of full scale. Components at or above the Nyquist frequency (half the sample rate) are left out.`),
        h('li', {}, h('strong', {}, 'Filter. '), `${VF.BAND_COUNT} Web Audio BiquadFilterNode “peaking” filters in series, each set to a cut between ${VF.GAIN_MIN} and 0 dB (never a boost), applied to the combined source. The chart is calculated with the same formulas the browser uses (Audio EQ Cookbook), and the automated checks compare it with the browser’s own getFrequencyResponse. The WAV is rendered with those same filters in double precision, filtered from rest like the live sound, plus ${VF.TAIL_SEC * 1000} ms for the filter to ring out.`),
        h('li', {}, h('strong', {}, 'Bypass. '), 'The source goes around the filter instead of through it, with the same gain g, crossfaded over 30 ms. Nothing is turned up after the filter (unless you tick the optional makeup gain), so you hear how much it really removes.'),
        h('li', {}, h('strong', {}, 'Automatic fit (workflow 3). '), 'The existing automatic analysis measures the fundamental (YIN) and the harmonic strengths of the selected section. Harmonics that stand out from the noise are targets; weaker ones only give an upper limit. A least-squares search (Levenberg–Marquardt) then adjusts only the 8 points’ centres, cuts and widths, plus one overall level, so the filter’s gain at each n × f0 follows the recording’s pattern. It works with the equal-strength harmonic source only.'),
        h('li', {}, h('strong', {}, 'Examples. '), 'Average formant frequencies of American English vowels from Hillenbrand et al. (1995) are turned into a smooth vowel-like envelope (five resonances plus a −6 dB/octave voice slope) and fitted with the same 8 points. They are approximate starting filters based on typical vocal resonances, not copies of your voice or guaranteed matches for every speaker, and they have not been checked by listening tests.'),
        h('li', {}, h('strong', {}, 'Limits. '), '8 broad bands cannot reproduce narrow peaks or every detail; the fit reports its remaining error. The filter keeps its frequencies when you change f0, but the same filter at another pitch acts on different harmonics, so the vowel may not sound the same.')),
      h('p', { class: 'muted' }, 'Sources: Fant (1960) Acoustic Theory of Speech Production; Klatt (1980) JASA 67(3); Hillenbrand, Getty, Clark & Wheeler (1995) JASA 97(5); W3C Web Audio API, BiquadFilterNode; R. Bristow-Johnson, Audio EQ Cookbook. See FILTER_VOWEL_UPDATE.md.')),
  );

  function details(summary, ...body) {
    return h('details', { class: 'vl-help' }, h('summary', {}, summary), ...body);
  }

  // ───────────── views and pointer input ─────────────
  const respView = new FilterResponseView(fel.filterCanvas);
  const specView = new FilterSpectrumView(fel.spec);
  const overview = new OverviewView(fel.overview);
  for (const v of [respView, specView, overview]) v.onResize = () => { dirty = true; };
  const cleanups = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
  const local = (c, e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  on(fel.filterCanvas, 'pointerdown', (e) => {
    const p = local(fel.filterCanvas, e);
    const i = respView.hit(p.x, p.y, e.pointerType === 'touch' ? 34 : 26);
    if (i < 0) return;
    e.preventDefault();
    st.selected = i;
    st.dragging = { i, pointerId: e.pointerId };
    fel.filterCanvas.setPointerCapture(e.pointerId);
    fel.filterCanvas.focus({ preventScroll: true });
    renderBands();
    dirty = true;
  });
  on(fel.filterCanvas, 'pointermove', (e) => {
    const p = local(fel.filterCanvas, e);
    if (!st.dragging) {
      fel.filterCanvas.style.cursor = respView.hit(p.x, p.y) >= 0 ? 'grab' : 'default';
      return;
    }
    const f = respView.map ? respView.map.fAt(p.x) : 1000;
    setBand(st.dragging.i, { f: Math.round(f), gainDb: Math.round(respView.gainAt(p.y) * 10) / 10 }, 'drag');
  });
  const endDrag = () => {
    if (!st.dragging) return;
    const i = st.dragging.i;
    st.dragging = null;
    // The optional makeup gain is recalculated once the drag ends, never
    // continuously, so it cannot quietly undo a cut while you listen.
    if (st.makeupOn) { recomputeMakeup(); if (st.owner && audio.state !== 'idle') audio.setFilter(audioFilter()); updateLevelInfo(); }
    const b = st.work.filter.bands[i];
    logChange(`Filter point ${i + 1}: centre ${fmtHz(b.f)}, cut ${b.gainDb.toFixed(1)} dB, Q ${b.q}.`, 'vf-band-' + i);
    dirty = true;
  };
  on(fel.filterCanvas, 'pointerup', endDrag);
  on(fel.filterCanvas, 'pointercancel', endDrag);
  on(fel.filterCanvas, 'keydown', (e) => {
    const b = st.work.filter.bands[st.selected];
    if (/^[1-8]$/.test(e.key)) { st.selected = Number(e.key) - 1; renderBands(); dirty = true; e.preventDefault(); return; }
    const big = e.shiftKey;
    const moves = { ArrowLeft: { f: b.f / (big ? 1.1 : 1.02) }, ArrowRight: { f: b.f * (big ? 1.1 : 1.02) }, ArrowUp: { gainDb: b.gainDb + (big ? 5 : 1) }, ArrowDown: { gainDb: b.gainDb - (big ? 5 : 1) } };
    if (moves[e.key]) { e.preventDefault(); setBand(st.selected, moves[e.key], 'key'); }
  });
  on(fel.spec, 'pointermove', (e) => { st.hover = local(fel.spec, e).x; dirty = true; });
  on(fel.spec, 'pointerleave', () => { st.hover = null; dirty = true; });
  let segDrag = null;
  on(fel.overview, 'pointerdown', (e) => {
    const r = rec();
    if (!r) return;
    const dur = r.samples.length / r.sampleRate;
    const t = overview.timeAt(local(fel.overview, e).x, dur);
    segDrag = { t0: t, dur };
    fel.overview.setPointerCapture(e.pointerId);
    st.work.segment = { start: t, end: t };
    dirty = true;
  });
  on(fel.overview, 'pointermove', (e) => {
    if (!segDrag) return;
    const t = overview.timeAt(local(fel.overview, e).x, segDrag.dur);
    st.work.segment = { start: Math.min(segDrag.t0, t), end: Math.max(segDrag.t0, t) };
    syncSeg();
    dirty = true;
  });
  const endSeg = () => { if (!segDrag) return; segDrag = null; setSegment(st.work.segment); };
  on(fel.overview, 'pointerup', endSeg);
  on(fel.overview, 'pointercancel', endSeg);

  // ───────────── experiments ─────────────
  function defaultsFromLab() {
    const lab = openExperiment();
    const recs = getRecordings();
    const labRec = lab && lab.recordingId ? recById(lab.recordingId) : null;
    const r = labRec || recs[recs.length - 1] || null;
    return {
      recordingId: r ? r.id : null, recordingName: r ? r.name : null,
      segment: r ? (labRec && lab.segment ? { ...lab.segment } : M.defaultSegment(r.samples.length / r.sampleRate)) : null,
      vowel: lab && lab.vowel === 'oo' ? 'U' : lab && lab.vowel === 'ee' ? 'I' : lab && lab.vowel === 'ah' ? 'A' : 'U',
    };
  }

  function load(e) {
    st.work = e;
    recomputeMakeup();
    st.selected = Math.min(st.selected, VF.BAND_COUNT - 1);
    origSpec = null;
    specDirty = true;
    if (audio.playing && st.owner) stopAudio();
    renderAll();
  }

  function newExperiment({ quiet = false } = {}) {
    if (st.work && isDirty() && !window.confirm(`“${VF.filterLabel(st.work)}” has unsaved changes. Discard them and start a new filter experiment?`)) return false;
    const w = st.work;
    load(VF.makeFilterExperiment(w ? { workflow: w.workflow, source: w.source, components: clone(w.components), recordingId: w.recordingId, recordingName: w.recordingName, segment: w.segment, vowel: w.vowel, vowelText: w.vowelText, f0: w.f0, f0Source: w.f0Source, count: w.count } : { ...defaultsFromLab(), workflow: 'explore', f0Source: 'default' }));
    st.fit = null;
    if (!quiet) logChange('New filter experiment: all components at amplitude 1, flat filter (not saved yet).');
    return true;
  }

  /** A new unsaved experiment that keeps the recording, section, label, f0 and count. */
  function derived(patch) {
    const w = st.work;
    return VF.makeFilterExperiment({ workflow: w.workflow, source: w.source, components: clone(w.components), recordingId: w.recordingId, recordingName: w.recordingName, segment: w.segment, vowel: w.vowel, vowelText: w.vowelText, f0: w.f0, f0Source: w.f0Source, count: w.count, ...patch });
  }

  function openFilterExperiment(id) {
    if (st.work && id === st.work.id) return;
    if (st.work && isDirty() && !window.confirm(`“${VF.filterLabel(st.work)}” has unsaved changes. Discard them and open another filter experiment?`)) { renderExpSelect(); return; }
    const s = savedFor(id);
    if (!s) return;
    load(VF.makeFilterExperiment(clone(s)));
    st.fit = null;
    logChange(`Opened filter experiment “${VF.filterLabel(st.work)}”.`);
  }

  function save({ asNew = false } = {}) {
    if (asNew) {
      const copy = VF.makeFilterExperiment({ ...clone(st.work), id: null, createdAt: null, savedAt: null });
      st.work = copy;
    }
    st.work.savedAt = new Date().toISOString();
    const snap = clone(st.work);
    const i = st.saved.findIndex((e) => e.id === snap.id);
    if (i >= 0) st.saved[i] = snap; else st.saved.push(snap);
    persist();
    logChange(`Saved filter experiment “${VF.filterLabel(st.work)}”${asNew ? ' as a new copy' : ''}. Your manual and automatic experiments were not changed.`);
    renderAll();
  }

  function persist() {
    const r = store.saveFilterExperiments(st.saved);
    st.storage = { ok: r.ok, error: r.error || '' };
    updateStorageNote();
  }

  function deleteSaved(id) {
    const s = savedFor(id);
    if (!s || !window.confirm(`Delete the saved filter experiment “${VF.filterLabel(s)}”? Recordings and other experiments are not affected.`)) return;
    st.saved = st.saved.filter((e) => e.id !== id);
    persist();
    if (st.work.id === id) st.work.savedAt = null;
    logChange(`Deleted filter experiment “${VF.filterLabel(s)}”.`);
    renderAll();
  }

  // ───────────── workflows and the custom source ─────────────
  const comps = () => VF.sourceComponents(st.work);
  // Render arguments: equal-strength harmonics go through the same renderer as
  // before (f0, count); your own rows through the component renderer.
  const srcArgs = () => (st.work.source === 'custom' ? { components: comps() } : { f0: st.work.f0, count: st.work.count });
  const isRecWf = () => st.work.workflow === 'recording';

  /** Switches workflow. Only 'custom' uses your own rows; the others use equal-strength harmonics. Nothing else changes. */
  function setWorkflow(wf) {
    if (wf === st.work.workflow) { renderWorkflow(); return; }
    if (st.owner && audio.playing) stopAudio();
    // A saved experiment is never rewritten by switching: the switch starts a
    // new unsaved copy (same filter and notes), so the saved one stays as it was.
    if (savedFor(st.work.id)) st.work = VF.makeFilterExperiment({ ...clone(st.work), id: null, createdAt: null, savedAt: null });
    st.work.workflow = wf;
    st.work.source = wf === 'custom' ? 'custom' : 'harmonics';
    if (wf === 'custom' && !st.work.components.length) {
      st.work.components = VF.generateHarmonicRows(st.work.f0, 8, 'falling');
      st.customMsg = `Started with 8 example rows (harmonics of ${fmtNum(st.work.f0)} Hz, amplitudes 1, 1/2, 1/3 …). Edit, remove or replace them freely.`;
    }
    if (wf === 'recording' && !st.work.recordingId) {
      const d = defaultsFromLab();
      if (d.recordingId) { st.work.recordingId = d.recordingId; st.work.recordingName = d.recordingName; st.work.segment = d.segment; }
    }
    origSpec = null;
    specDirty = true;
    drySpec = null;
    recomputeMakeup();
    logChange(`Vowel filtering workflow: ${VF.WORKFLOWS[wf]} (source: ${VF.SOURCES[st.work.source]}).`);
    renderAll();
  }

  function setComponent(i, patch) {
    st.work.components[i] = VF.cleanComponent({ ...st.work.components[i], ...patch });
    onSourceChange();
  }

  function addRow() {
    const list = st.work.components;
    if (list.length >= VF.CUSTOM_MAX) return;
    const last = list[list.length - 1];
    list.push(VF.cleanComponent({ freq: last ? Math.min(VF.CUSTOM_FREQ_MAX, last.freq + 100) : 220, amp: 0.5, on: true }));
    st.customMsg = '';
    onSourceChange();
    logChange(`Added component ${list.length}: ${fmtHz(list[list.length - 1].freq)}, amplitude 0.5.`);
  }

  function removeRow(i) {
    const [c] = st.work.components.splice(i, 1);
    st.customMsg = '';
    onSourceChange();
    logChange(`Removed component ${fmtHz(c.freq)} (amplitude ${c.amp}).`);
  }

  function generateRows(mode) {
    const r = M.parseFundamental(fel.genF0.value, rate() / 2);
    if (!r.ok) { st.customMsg = r.error; renderCustom(); return; }
    const rows = VF.generateHarmonicRows(r.value, Number(fel.genCount.value), fel.genPattern.value);
    if (mode === 'replace') {
      if (st.work.components.length && !window.confirm(`Replace your ${st.work.components.length} rows with ${rows.length} harmonics of ${fmtNum(r.value)} Hz?`)) return;
      st.work.components = rows;
    } else {
      const room = VF.CUSTOM_MAX - st.work.components.length;
      st.work.components.push(...rows.slice(0, room));
      if (rows.length > room) st.customMsg = `Only ${room} rows fitted (maximum ${VF.CUSTOM_MAX}).`;
    }
    st.customMsg = st.customMsg || `${mode === 'replace' ? 'Rows replaced with' : 'Added'} ${rows.length} harmonics of ${fmtNum(r.value)} Hz (${fel.genPattern.value === 'equal' ? 'all amplitude 1' : 'amplitudes 1/n'}). They are ordinary rows now: edit them as you like.`;
    onSourceChange();
    logChange(st.customMsg);
  }

  function loadFromManual() {
    const list = (getManualComponents() || []).map(VF.cleanComponent);
    if (!list.length) { st.customMsg = 'The Manual frequencies mode has no components yet.'; renderCustom(); return; }
    if (st.work.components.length && !window.confirm(`Replace your ${st.work.components.length} rows with a copy of the ${list.length} Manual frequencies components?`)) return;
    st.work.components = list.slice(0, VF.CUSTOM_MAX);
    st.customMsg = `Copied ${st.work.components.length} components from Manual frequencies (frequencies, amplitudes and on/off as they were). The Manual mode itself is unchanged.`;
    onSourceChange();
    logChange(st.customMsg);
  }

  // ───────────── recording and section ─────────────
  function setRecording(id) {
    const r = id ? recById(id) : null;
    st.work.recordingId = r ? r.id : null;
    st.work.recordingName = r ? r.name : null;
    st.work.segment = r ? M.defaultSegment(r.samples.length / r.sampleRate) : null;
    origSpec = null;
    if (st.owner && audio.playing) stopAudio();
    logChange(r ? `Vowel filtering compares with “${r.name}”, section ${st.work.segment.start}–${st.work.segment.end} s.` : 'Vowel filtering: no recording selected.');
    renderAll();
  }

  function setSegment(seg) {
    const r = rec();
    if (!r) return;
    st.work.segment = M.clampSegment(seg, r.samples.length / r.sampleRate);
    origSpec = null;
    fel.segMsg.textContent = '';
    syncSeg();
    updateSaveState();
    renderFit();
    dirty = true;
  }

  function commitSeg() {
    const a = Number(fel.segStart.value);
    const b = Number(fel.segEnd.value);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) { fel.segMsg.textContent = 'Type a start and a later end time in seconds.'; return; }
    setSegment({ start: a, end: b });
  }

  function useLabSegment() {
    const lab = openExperiment();
    if (!lab || !lab.recordingId || !recById(lab.recordingId)) { fel.segMsg.textContent = 'The open Vowel Lab experiment has no recording.'; return; }
    if (lab.recordingId !== st.work.recordingId) setRecording(lab.recordingId);
    if (lab.segment) setSegment(lab.segment);
  }

  function segSamples(r) {
    const seg = st.work.segment || M.defaultSegment(r.samples.length / r.sampleRate);
    const from = Math.max(0, Math.round(seg.start * r.sampleRate));
    const to = Math.min(r.samples.length, Math.round(seg.end * r.sampleRate));
    return { from, to: Math.max(from + 1, to) };
  }

  function syncSeg() {
    const r = rec();
    const seg = st.work.segment;
    if (!r || !seg) { fel.segStart.value = ''; fel.segEnd.value = ''; fel.segInfo.textContent = ''; return; }
    if (document.activeElement !== fel.segStart) fel.segStart.value = String(round3(seg.start));
    if (document.activeElement !== fel.segEnd) fel.segEnd.value = String(round3(seg.end));
    fel.segInfo.textContent = `${fmtTime(seg.end - seg.start)} of ${fmtTime(r.samples.length / r.sampleRate)}`;
  }

  // ───────────── fundamental and source ─────────────
  function commitF0() {
    const r = M.parseFundamental(fel.f0.value, rate() / 2);
    fel.f0.classList.toggle('invalid', !r.ok);
    if (!r.ok) { st.f0Msg = { text: r.error, bad: true }; renderF0(); return; }
    setF0(r.value, 'typed');
  }

  function setF0(v, source) {
    const r = M.parseFundamental(String(v), rate() / 2);
    if (!r.ok) { st.f0Msg = { text: r.error, bad: true }; renderF0(); return; }
    const old = st.work.f0;
    st.work.f0 = r.value;
    st.work.f0Source = source;
    st.f0Msg = null;
    if (old !== r.value) logChange(`Vowel filtering fundamental: ${fmtHz(old)} → ${fmtHz(r.value)} (${source === 'automatic' ? 'automatic estimate' : 'typed'}). Harmonics moved to n × ${fmtHz(r.value)}; the filter did not change.`, 'vf-f0');
    onSourceChange();
  }

  function estimateF0() {
    const r = rec();
    if (!r) { st.f0Msg = { text: 'Choose a recording first (step 1), or type a fundamental.', bad: true }; renderF0(); return; }
    const { from, to } = segSamples(r);
    const est = AV.estimateFundamental(r.samples, r.sampleRate, { from, to });
    if (est.f0 == null) {
      st.f0Msg = { text: `No reliable automatic estimate: ${est.problems.map((p) => p.message).join(' ')} Type a value instead.`, bad: true };
      renderF0();
      return;
    }
    const f0 = Math.round(est.f0 * 100) / 100;
    st.lastAuto = { key: `${r.id}:${from}:${to}`, f0 };
    setF0(f0, 'automatic');
    st.f0Msg = { text: `Automatic estimate (YIN): median of ${est.stats.framesPeriodic} of ${est.stats.framesTotal} frames${est.stats.spreadCents != null ? `, pitch spread ${Math.round(est.stats.spreadCents)} cents` : ''}.${est.warnings.length ? ' ' + est.warnings.map((w) => w.message).join(' ') : ''} If it sounds an octave off, type the right value.`, bad: false };
    renderF0();
  }

  function setCount(n) {
    st.work.count = n;
    st.work.sourceAmps = VF.sourceAmps(n);
    logChange(`Vowel filtering source: ${n} components, every amplitude 1.`);
    onSourceChange();
  }

  function onSourceChange() {
    recomputeMakeup();
    if (st.owner && audio.state !== 'idle') { audio.updateSource(comps()); audio.setFilter(audioFilter()); }
    specDirty = true;
    drySpec = null;
    dirty = true;
    renderF0();
    renderComponents();
    renderCustom();
    renderBands();
    updateLevelInfo();
    updateSaveState();
  }

  function startAllMax() {
    st.work.sourceAmps = VF.sourceAmps(st.work.count);
    st.work.filter.enabled = false;
    onFilterChange({ edited: false });
    logChange(`Source: the fundamental and every harmonic at amplitude 1 (${VF.activeHarmonics(st.work.f0, st.work.count, rate()).length} active components). Filter bypassed so you hear the buzzy starting sound.`);
    playSource(false);
  }

  // ───────────── filter edits ─────────────
  function setEnabled(on) {
    st.work.filter.enabled = on;
    onFilterChange({ edited: false });
    logChange(on ? 'Filter ON.' : 'Filter BYPASSED (its settings are kept).');
  }

  function setBand(i, patch, how) {
    const b = st.work.filter.bands[i];
    const nb = VF.clampBand({ ...b, ...patch }, rate());
    if (nb.f === b.f && nb.gainDb === b.gainDb && nb.q === b.q) return;
    st.work.filter.bands[i] = nb;
    st.selected = i;
    onFilterChange({ edited: true, from: how });
  }

  function onFilterChange({ edited = true, from = null } = {}) {
    if (edited && st.work.origin !== 'manual') st.work.editedAfter = true;
    if (from !== 'drag') recomputeMakeup();
    if (st.owner && audio.state !== 'idle') audio.setFilter(audioFilter());
    specDirty = true;
    dirty = true;
    renderToggle();
    if (from !== 'text') renderBands(); else renderSel();
    renderComponents();
    updateLevelInfo();
    updateSaveState();
  }

  function resetFlat() {
    const flat = st.work.filter.bands.every((b) => b.gainDb === 0);
    if (!flat && !window.confirm('Reset all 8 filter points to flat (0 dB, default centres and widths)? The source is not changed.')) return;
    st.work.filter.bands = VF.defaultBands();
    onFilterChange({ edited: true });
    logChange('Filter reset to flat: every region let through unchanged.');
  }

  /**
   * Loads a vowel example into the filter of the open experiment. Only the
   * filter (and its "example" origin) changes: f0, harmonics or your own
   * components stay exactly as they are.
   */
  function loadExample(id) {
    const set = fel.exampleSet.value;
    const w = st.work;
    const handShaped = w.origin === 'manual' && w.filter.bands.some((b) => b.gainDb !== 0) && isDirty();
    if (handShaped && !window.confirm(`Replace your hand-shaped filter with the ${VF.vowelName(id)} example? (Save first if you want to keep it.)`)) return;
    const ex = VF.exampleFilter(id, set, rate());
    w.filter.bands = ex.bands.map((b) => ({ ...b }));
    w.filter.enabled = true;
    w.origin = 'example';
    w.editedAfter = false;
    w.example = { vowel: id, set, formants: ex.formants };
    w.fit = ex.fit;
    if (w.workflow !== 'recording') w.vowel = id;
    st.fit = null;
    onFilterChange({ edited: false });
    renderLabels();
    renderExamples();
    renderFit();
    const v = VF.vowelInfo(id);
    logChange(`Loaded the ${v.name} (“${v.word}”) example filter (${VF.FORMANT_SETS[set].name.toLowerCase()}: F1 ${ex.formants[0]}, F2 ${ex.formants[1]}, F3 ${ex.formants[2]} Hz). Only the filter changed; the source is as it was. It is an approximate preset, not an analysis of your voice.`);
  }

  function matchFilter() {
    if (st.work.source !== 'harmonics') { st.fit = { ok: false, problems: ['Automatic matching works with the equal-strength harmonic source only. Choose workflow 3, Match a recording.'], warnings: [] }; renderFit(); return; }
    const r = rec();
    if (!r) { st.fit = { ok: false, problems: ['Choose a recording and a steady section in step 1 first.'], warnings: [] }; renderFit(); return; }
    const { from, to } = segSamples(r);
    const override = st.work.f0Source === 'typed' ? st.work.f0 : null;
    const t0 = performance.now();
    const m = VF.measureTargets(r.samples, r.sampleRate, { from, to, f0Override: override, count: st.work.count });
    if (!m.ok) {
      st.fit = { ok: false, problems: m.problems.map((p) => p.message), warnings: m.warnings.map((w) => w.message), section: [round3(from / r.sampleRate), round3(to / r.sampleRate)] };
      logChange(`Match filter: no reliable analysis of “${r.name}” (${m.problems.map((p) => p.code).join(', ')}). Nothing was changed.`);
      renderFit();
      return;
    }
    const fit = VF.fitFilter(m.points, { sampleRate: rate() });
    const summary = {
      ...VF.fitSummary(fit),
      f0Hz: m.f0, f0Source: m.f0Source === 'manual' ? 'typed (manual correction)' : 'automatic estimate (YIN)', automaticF0Hz: m.analysis.f0Auto == null ? null : Math.round(m.analysis.f0Auto * 100) / 100,
      sectionSec: [round3(from / r.sampleRate), round3(to / r.sampleRate)], recordingName: r.name,
      analysisStatus: m.analysis.status, warnings: m.warnings.map((w) => w.message),
    };
    const exp = derived({ workflow: 'recording', source: 'harmonics', f0: m.f0, f0Source: m.f0Source === 'manual' ? 'typed' : 'automatic', origin: 'fitted', filter: { bands: fit.bands, enabled: true }, fit: summary,
      notes: `Automatic filter fit to “${r.name}” ${summary.sectionSec[0]}–${summary.sectionSec[1]} s at f0 ${m.f0} Hz: ${fit.rmsDb.toFixed(1)} dB RMS error over ${fit.measuredCount} measured harmonics.` });
    if (st.work && isDirty() && st.work.filter.bands.some((b) => b.gainDb !== 0) && !window.confirm(`The fitted filter opens as a new, unsaved filter experiment. Discard unsaved changes to “${VF.filterLabel(st.work)}”?`)) return;
    load(exp);
    st.fit = { ok: true, summary, points: fit.points, warnings: summary.warnings, ms: performance.now() - t0, expId: exp.id };
    logChange(`Matched the filter to “${r.name}”: f0 ${fmtHz(m.f0)} (${summary.f0Source}), ${fit.rmsDb.toFixed(1)} dB RMS error. Only the filter points were fitted; every source amplitude is still 1. New unsaved filter experiment.`);
    renderFit();
  }

  // ───────────── playback ─────────────
  function guard() {
    if (isRecording()) return false;
    stopOtherAudio();
    st.owner = true;
    return true;
  }

  function stopAudio() {
    if (audio.playing) audio.stop();
  }

  const audioFilter = () => ({ ...st.work.filter, makeup: st.makeupOn ? st.makeup : 1 });

  function recomputeMakeup() {
    st.makeup = st.makeupOn ? VF.makeupGain(st.work.f0, st.work.count, st.work.filter.bands, rate(), st.work.source === 'custom' ? comps() : null) : 1;
  }

  function setMakeup(on) {
    st.makeupOn = on;
    recomputeMakeup();
    if (st.owner && audio.state !== 'idle') audio.setFilter(audioFilter());
    updateLevelInfo();
    updateDownloads();
    logChange(on ? `Optional makeup gain ON: the filtered sound is raised by ${(20 * Math.log10(st.makeup)).toFixed(1)} dB to the unfiltered peak (balance unchanged; the true reduction is hidden).` : 'Makeup gain OFF: the filtered sound plays at the same gain as the unfiltered source, so you hear the filter’s true reduction.');
  }

  function filteredPeak() {
    const y = VF.renderSteady({ ...srcArgs(), bands: st.work.filter.bands, enabled: true, sampleRate: rate(), length: Math.round(0.25 * rate()) });
    return VF.peakOf(y) * (st.makeupOn ? st.makeup : 1);
  }

  function playOriginal() {
    const r = isRecWf() ? rec() : null;
    if (!r || !guard()) return;
    const { from, to } = segSamples(r);
    audio.playOriginal(r, { from, to, levelMatch: st.matchOrig ? filteredPeak() : false });
    logChange(`Playing the original “${r.name}”, section ${st.work.segment.start}–${st.work.segment.end} s.`);
  }

  function playSource(filtered) {
    if (!guard()) return;
    if (st.work.filter.enabled !== filtered) { st.work.filter.enabled = filtered; onFilterChange({ edited: false }); }
    if (!VF.activeComponents(comps(), rate()).length) { logChange('Nothing to play: the source has no active components (add a row, or raise an amplitude above 0).'); return; }
    audio.playSource(comps(), audioFilter());
    const what = st.work.source === 'custom' ? 'your own components' : 'every harmonic at amplitude 1';
    logChange(filtered ? `Playing the FILTERED source (${what}; until Stop; dragging changes it live).` : `Playing the UNFILTERED source (${what}), filter bypassed (until Stop).`);
  }

  function playAB() {
    const r = isRecWf() ? rec() : null;
    if (!r || !guard()) return;
    const { from, to } = segSamples(r);
    if (!st.work.filter.enabled) { st.work.filter.enabled = true; onFilterChange({ edited: false }); }
    audio.playOriginalThenFiltered(r, comps(), audioFilter(), { from, to, levelMatch: st.matchOrig ? filteredPeak() : false });
    logChange('Original → Filtered: the recording section, a short pause, then the filtered source for the same length.');
  }

  function updateTransport() {
    const r = isRecWf() ? rec() : null;
    const busy = isRecording();
    const silent = !VF.activeComponents(comps(), rate()).length;
    fel.playOrig.disabled = !r || busy;
    fel.playAB.disabled = !r || busy;
    fel.playDry.disabled = busy || silent;
    fel.playWet.disabled = busy || silent;
    fel.exPlay.disabled = busy || silent;
    fel.exPlayDry.disabled = busy || silent;
    fel.startBtn.disabled = busy;
    fel.stopBtn.disabled = !(audio.playing && st.owner);
    fel.exStop.disabled = fel.stopBtn.disabled;
    const mine = st.owner && audio.playing;
    const synthLabel = audio.filteredNow ? 'FILTERED source' : 'UNFILTERED source (filter bypassed)';
    const label = !mine ? '○ Nothing playing here'
      : audio.state === 'original' ? '▶ Now playing: ORIGINAL recording'
        : audio.state === 'synth' ? `▶ Now playing: ${synthLabel}`
          : audio.state === 'ab' ? ({ original: '⇄ 1/2 Now playing: ORIGINAL', gap: '⇄ pause…', synth: '⇄ 2/2 Now playing: FILTERED source' }[audio.abPhase] || '⇄') : '';
    fel.nowPlaying.textContent = label;
    const what = !mine ? '' : audio.state === 'original' || audio.abPhase === 'original' ? 'orig' : audio.state === 'synth' ? (audio.filteredNow ? 'synth' : 'dry') : audio.abPhase === 'synth' ? 'synth' : '';
    fel.nowPlaying.className = 'vl-now ' + what;
    fel.exNow.textContent = label;
    fel.exNow.className = 'vl-now ' + what;
  }

  function updateLevelInfo() {
    const sr = rate();
    const len = Math.round(0.25 * sr);
    const dry = VF.renderSteady({ ...srcArgs(), bands: st.work.filter.bands, enabled: false, sampleRate: sr, length: len });
    const wet = VF.renderSteady({ ...srcArgs(), bands: st.work.filter.bands, enabled: true, sampleRate: sr, length: len });
    const pd = VF.peakOf(dry);
    const pw = VF.peakOf(wet);
    const rd = 20 * Math.log10(VF.rmsOf(wet) / Math.max(1e-12, VF.rmsOf(dry)));
    const mk = st.makeupOn ? st.makeup : 1;
    fel.levelInfo.textContent = `Levels: unfiltered peak ${pd.toFixed(3)}, filtered peak ${pw.toFixed(3)} (${(20 * Math.log10(pw / pd)).toFixed(1)} dB); filtered RMS ${rd.toFixed(1)} dB re unfiltered. ` +
      (mk === 1
        ? 'The filter only reduces and nothing is turned back up, so the filtered sound is quieter: that difference is the filter’s real effect, and Filter ON/BYPASSED compare at the same gain. If it is too quiet to judge, raise the volume or tick the optional makeup gain. '
        : `⚠ Makeup gain ON: the filtered sound is raised by ${(20 * Math.log10(mk)).toFixed(1)} dB (one constant factor after the filter; harmonic balance unchanged), so it now peaks like the unfiltered source. This hides the true reduction, and the WAV uses the same gain. `) +
      (!isRecWf() ? '' : st.matchOrig ? 'The original recording is scaled so its peak equals the filtered sound’s peak (equal peaks are not exactly equal loudness).' : 'The original plays at its recorded level.');
    if (!(pd > 0)) fel.levelInfo.textContent = 'The source is silent: add a component or raise an amplitude above 0.';
  }

  // ───────────── downloads and import ─────────────
  function renderWav() {
    const sr = rate();
    return { samples: VF.renderFiltered({ ...srcArgs(), bands: st.work.filter.bands, enabled: true, sampleRate: sr, duration: st.wavLen, makeup: st.makeupOn ? st.makeup : 1 }), sampleRate: sr };
  }

  function downloadWav() {
    const y = renderWav();
    const enc = encodeWav(y.samples, y.sampleRate);
    download(`${VF.filterFileBase(st.work)}_filtered.wav`, new Blob([enc.buffer], { type: 'audio/wav' }));
    if (enc.clipped) logChange(`Warning: ${enc.clipped} samples clipped in the WAV.`);
  }

  function downloadJson() {
    const doc = VF.filterSettingsDocument(st.work, { sampleRate: rate(), recording: rec(), durationSec: st.wavLen, makeup: st.makeupOn ? st.makeup : 1 });
    doc.savedInBrowser = !isDirty();
    download(`${VF.filterFileBase(st.work)}_settings.json`, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  }

  function downloadOriginal() {
    const r = rec();
    if (!r) return;
    download(`${M.slug(r.name)}.wav`, new Blob([encodeWav(r.samples, r.sampleRate).buffer], { type: 'audio/wav' }));
  }

  async function importJson(file, input) {
    if (!file) return;
    input.value = '';
    let doc;
    try { doc = JSON.parse(await file.text()); } catch { fel.importMsg.textContent = `Could not read ${file.name}: it is not valid JSON.`; return; }
    const r = VF.parseFilterSettings(doc);
    if (!r.ok) { fel.importMsg.textContent = `Could not import ${file.name}: ${r.error}`; return; }
    if (st.work && isDirty() && !window.confirm(`Discard unsaved changes to “${VF.filterLabel(st.work)}” and open the imported filter?`)) return;
    const match = r.experiment.recordingName ? getRecordings().find((x) => x.name === r.experiment.recordingName) : null;
    if (match) r.experiment.recordingId = match.id;
    load(r.experiment);
    save();
    fel.importMsg.textContent = `Imported ${file.name} as a new saved filter experiment.` + (match ? ` Linked to “${match.name}”.` : r.experiment.recordingName ? ` Its recording “${r.experiment.recordingName}” is not in this browser.` : '') + (r.warnings.length ? ' ' + r.warnings.join(' ') : '');
  }

  function updateDownloads() {
    const base = VF.filterFileBase(st.work);
    fel.dlOrig.disabled = !rec();
    fel.dlNote.textContent = `Files: ${base}_filtered.wav (${st.wavLen} s at ${rate().toLocaleString('en-US')} Hz, the same ${st.work.source === 'custom' ? 'components' : 'all-ones source'}, filter and gain as playback${st.makeupOn ? `, including the optional +${(20 * Math.log10(st.makeup)).toFixed(1)} dB makeup gain` : ''}, 20 ms fades, filtered from rest, plus ${VF.TAIL_SEC * 1000} ms ring-out) and ${base}_settings.json (workflow, source type and every component, f0 where used, all filter points and coefficients, recording and section if any, origin, notes). The downloads use the settings shown now${isDirty() ? ' (not saved yet)' : ''}. ${isRecWf() ? ' The original WAV is the whole recording, as captured.' : ' No recording is needed for these files.'}`;
  }

  // ───────────── rendering ─────────────
  function renderWorkflow() {
    const wf = st.work.workflow;
    for (const t of [fel.tabExplore, fel.tabCustom, fel.tabRecording]) t.setAttribute('aria-pressed', String(t.dataset.wf === wf));
    fel.workflowHint.textContent = {
      explore: 'Workflow 1: equal-strength harmonics from a fundamental you type, shaped by vowel example filters or by dragging. No microphone or recording is used.',
      custom: 'Workflow 2: your own sine components (any frequencies and amplitudes) through the same filter. No microphone or recording is used, and your rows are never changed by the filter.',
      recording: 'Workflow 3: compare with a recorded vowel, estimate its fundamental, and fit the filter to it automatically. Uses equal-strength harmonics.',
    }[wf];
    fel.recPanel.hidden = wf !== 'recording';
    fel.matchBox.hidden = wf !== 'recording';
    fel.examplePanel.classList.toggle('single', wf !== 'recording');
    fel.harmBox.hidden = st.work.source !== 'harmonics';
    fel.customBox.hidden = st.work.source !== 'custom';
    fel.srcHarm.checked = st.work.source === 'harmonics';
    fel.srcCustom.checked = st.work.source === 'custom';
    fel.srcHarm.disabled = false;
    fel.srcCustom.disabled = wf === 'recording';
    fel.sourceNote.textContent = wf === 'recording' ? 'Recording matching uses equal-strength harmonics (choose workflow 2 for your own frequencies).' : '';
    for (const x of fel.listenOrigBits) x.hidden = wf !== 'recording';
    fel.matchOrigLabel.hidden = wf !== 'recording';
    fel.origLegend.hidden = wf !== 'recording';
    fel.dlOrig.hidden = wf !== 'recording';
    (wf === 'recording' ? fel.recLabelSlot : fel.saveLabelSlot).append(fel.labelRow);
  }

  function renderCustom() {
    if (st.work.source !== 'custom') return;
    const sr = rate();
    const list = st.work.components;
    const focused = document.activeElement && fel.customRows.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    const rows = list.map((c, i) => {
      const num = (key, label, min, max) => {
        const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', value: String(c[key]), 'aria-label': `Component ${i + 1} ${label}` });
        const commit = () => {
          const v = Number(inp.value);
          const ok = inp.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max;
          inp.classList.toggle('invalid', !ok);
          inp.title = ok ? '' : `Use ${min}–${max}.`;
          if (ok && v !== c[key]) { setComponent(i, { [key]: v }); logChange(`Component ${i + 1} ${label}: ${v}.`, `vf-comp-${i}-${key}`); }
        };
        inp.addEventListener('change', commit);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
        return inp;
      };
      const on = h('input', { type: 'checkbox', checked: c.on !== false, 'aria-label': `Include component ${i + 1}`, onchange: (e) => setComponent(i, { on: e.target.checked }) });
      const above = c.freq >= sr / 2;
      return h('tr', { class: c.on === false || c.amp === 0 || above ? 'zero' : '' },
        h('td', {}, on, ' ', String(i + 1)),
        h('td', {}, num('freq', 'frequency (Hz)', VF.CUSTOM_FREQ_MIN, VF.CUSTOM_FREQ_MAX), ' Hz', above ? h('span', { class: 'vl-bad' }, ' above Nyquist') : ''),
        h('td', {}, num('amp', 'amplitude (0–1)', 0, 1)),
        h('td', {}, h('button', { class: 'btn small danger', 'aria-label': `Remove component ${i + 1}`, onclick: () => removeRow(i) }, '🗑')));
    });
    fel.customRows.replaceChildren(list.length
      ? h('table', { class: 'comps vl-table vf-comp-table' },
        h('thead', {}, h('tr', {}, ['On · #', 'Frequency', 'Amplitude (0–1)', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows))
      : h('p', { class: 'muted' }, 'No components yet. Add a row, generate harmonics, or load a copy of your Manual frequencies setup.'));
    if (focused) { const el = fel.customRows.querySelector(`[aria-label="${focused}"]`); if (el) el.focus({ preventScroll: true }); }
    fel.addRow.disabled = list.length >= VF.CUSTOM_MAX;
    fel.customMsg.textContent = st.customMsg || '';
    const act = VF.activeComponents(list, sr);
    const g = VF.componentGain(list, sr);
    const sum = act.reduce((t, c) => t + c.amp, 0);
    fel.customInfo.replaceChildren(
      h('p', {}, h('strong', {}, `${act.length} of ${list.length} component${list.length === 1 ? '' : 's'} sound: `),
        act.length ? act.slice(0, 10).map((c) => `${fmtNum(c.freq)} Hz × ${c.amp}`).join(', ') + (act.length > 10 ? ', …' : '') + '.' : 'none (the source is silent).'),
      act.length ? h('p', { class: 'muted' }, `Shared safety gain g = ${VF.SAFE_PEAK} ÷ Σ amplitudes (${fmtNum(sum)}) = ${g.toFixed(4)}, the same for filtered and unfiltered. Your amplitudes are kept exactly as typed; the filter and the vowel examples never change them.`) : '');
  }

  function renderAll() {
    renderWorkflow();
    renderCustom();
    renderExpSelect();
    renderRecSelect();
    syncSeg();
    renderLabels();
    renderF0();
    renderComponents();
    renderToggle();
    renderBands();
    renderExamples();
    renderFit();
    renderViewButtons();
    updateTransport();
    updateLevelInfo();
    updateSaveState();
    renderExpTable();
    if (document.activeElement !== fel.notes) fel.notes.value = st.work.notes;
    dirty = true;
  }

  function renderExpSelect() {
    const opts = st.saved.map((e) => h('option', { value: e.id }, VF.filterLabel(e.id === st.work.id ? st.work : e) + (e.id === st.work.id && isDirty() ? ' (unsaved changes)' : '')));
    if (!savedFor(st.work.id)) opts.unshift(h('option', { value: st.work.id }, VF.filterLabel(st.work) + ' (not saved yet)'));
    fel.expSelect.replaceChildren(...opts);
    fel.expSelect.value = st.work.id;
  }

  function renderRecSelect() {
    const recs = getRecordings();
    const opts = [h('option', { value: '' }, recs.length ? '— none (examples only) —' : '— no recordings yet —'), ...[...recs].reverse().map((r) => h('option', { value: r.id }, `${r.name} (${fmtTime(r.samples.length / r.sampleRate)})`))];
    fel.recSelect.replaceChildren(...opts);
    fel.recSelect.value = rec() ? st.work.recordingId : '';
    const missing = st.work.recordingId && !rec();
    fel.recHint.textContent = missing ? `The saved recording “${st.work.recordingName || '?'}” is not in this browser; import its WAV in stage 1.` : recs.length ? '' : 'No recordings yet: record or import one in stage 1. Workflows 1 and 2 need none.';
    fel.useLabSeg.disabled = !openExperiment() || !openExperiment().recordingId;
    fel.midSeg.disabled = !rec();
    fel.matchBtn.disabled = !rec() || !isRecWf();
    fel.estimate.disabled = !rec();
    updateTransport();
    updateDownloads();
  }

  function renderLabels() {
    fel.vowel.value = st.work.vowel;
    fel.vowelText.hidden = st.work.vowel !== 'other';
    if (document.activeElement !== fel.vowelText) fel.vowelText.value = st.work.vowelText;
    const v = VF.vowelInfo(st.work.vowel);
    fel.vowelSay.textContent = v ? `Sustained ${v.say}.` : '';
  }

  function renderF0() {
    if (document.activeElement !== fel.f0) fel.f0.value = String(st.work.f0);
    const s = st.work.f0Source;
    fel.f0Tag.textContent = s === 'automatic' ? '✓ automatic estimate' : s === 'default' ? (isRecWf() ? '○ default value, not matched to a recording yet' : '○ default value: type any fundamental') : st.lastAuto && st.lastAuto.f0 !== st.work.f0 ? `✎ manual correction (automatic was ${st.lastAuto.f0} Hz)` : '✎ typed by you';
    fel.f0Tag.className = 'vf-tag ' + (s === 'automatic' ? 'automatic' : s === 'default' ? 'default' : 'manual');
    fel.estimate.hidden = !isRecWf();
    fel.f0Msg.replaceChildren(st.f0Msg ? h('span', { class: st.f0Msg.bad ? 'vl-bad' : 'muted' }, st.f0Msg.text) : h('span', { class: 'muted' }, `Period 1/f0 = ${fmtTime(1 / st.work.f0)}. Changing f0 moves every harmonic to n × f0; the filter’s frequencies stay where they are.`));
    if (![...fel.count.options].some((o) => o.value === String(st.work.count))) fel.count.append(h('option', { value: String(st.work.count) }, String(st.work.count)));
    fel.count.value = String(st.work.count);
  }

  function renderComponents() {
    const sr = rate();
    const act = VF.activeHarmonics(st.work.f0, st.work.count, sr);
    const left = st.work.count - act.length;
    const list = act.length <= 8 ? act.map((x) => fmtNum(x.freq)).join(', ') : `${act.slice(0, 5).map((x) => fmtNum(x.freq)).join(', ')}, …, ${act.slice(-2).map((x) => fmtNum(x.freq)).join(', ')}`;
    fel.components.replaceChildren(
      h('p', {}, h('strong', {}, `${act.length} active component${act.length === 1 ? '' : 's'}, every amplitude 1: `), `n = 1 … ${act.length} at ${list} Hz (n × ${fmtNum(st.work.f0)} Hz).`,
        left ? h('span', { class: 'vl-bad' }, ` ${left} more would be at or above the Nyquist frequency (${fmtHz(sr / 2)}) and are left out.`) : h('span', { class: 'muted' }, ` All below the Nyquist frequency (${fmtHz(sr / 2)}).`)),
      h('p', { class: 'muted' }, `Shared safety gain g = ${VF.SAFE_PEAK} ÷ ${act.length} = ${VF.sourceGain(st.work.f0, st.work.count, sr).toFixed(4)} for the filtered and the unfiltered sound alike.`));
    const gains = VF.harmonicGains(st.work.f0, st.work.count, st.work.filter.bands, sr, true);
    fel.harmTable.replaceChildren(h('table', { class: 'comps vl-table vl-auto-harm' },
      h('thead', {}, h('tr', {}, ['n', 'Frequency n × f0', 'Source amplitude', 'Filter gain here', 'Amplitude after filter'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, gains.map((x) => h('tr', {},
        h('th', { scope: 'row' }, String(x.n)), h('td', { class: 'mono' }, fmtHz(Math.round(x.freq * 100) / 100)), h('td', { class: 'mono' }, '1'),
        h('td', { class: 'mono' }, `${x.gainDb.toFixed(1)} dB`), h('td', { class: 'mono' }, x.amp.toFixed(3)))))));
  }

  function renderToggle() {
    const on = st.work.filter.enabled;
    fel.filterToggle.textContent = on ? '● Filter ON (press to bypass)' : '○ Filter BYPASSED (press to turn on)';
    fel.filterToggle.setAttribute('aria-pressed', String(on));
    fel.filterToggle.classList.toggle('on', on);
  }

  function renderBands() {
    const sr = rate();
    const fMax = Math.min(VF.F_MAX, 0.45 * sr);
    const rows = st.work.filter.bands.map((b, i) => {
      const sel = i === st.selected;
      const pick = h('input', { type: 'radio', name: 'vf-sel', checked: sel, 'aria-label': `Select point ${i + 1}`, onchange: () => { st.selected = i; renderBands(); dirty = true; } });
      const field = (key, label, min, max, step) => {
        const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', value: String(b[key]), 'aria-label': `Point ${i + 1} ${label}` });
        const commit = () => {
          const v = Number(inp.value);
          const ok = inp.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max;
          inp.classList.toggle('invalid', !ok);
          inp.title = ok ? '' : key === 'gainDb' && v > 0 ? 'Cut only: 0 dB means no change; boosts are not supported.' : `Use ${min}–${max}.`;
          if (ok) { setBand(i, { [key]: v }, 'text'); logChange(`Filter point ${i + 1} ${label}: ${v}.`, `vf-band-${i}-${key}`); }
        };
        inp.addEventListener('change', commit);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
        inp.addEventListener('focus', () => { if (st.selected !== i) { st.selected = i; renderSel(); dirty = true; } });
        void step;
        return inp;
      };
      return h('tr', { class: sel ? 'current' : '' },
        h('td', {}, h('label', { class: 'row gap' }, pick, h('span', { class: 'vf-pt' }, String(i + 1)))),
        h('td', {}, field('f', 'centre (Hz)', VF.F_MIN, fMax), ' Hz'),
        h('td', {}, field('gainDb', 'cut (dB)', VF.GAIN_MIN, 0), ' dB'),
        h('td', {}, field('q', 'width Q', VF.Q_MIN, VF.Q_MAX), h('span', { class: 'muted' }, ` ≈ ${VF.qToOctaves(b.q).toFixed(2)} oct`)));
    });
    fel.bandTable.replaceChildren(h('table', { class: 'comps vl-table vf-band-table' },
      h('thead', {}, h('tr', {}, ['Point', 'Centre', `Cut (${VF.GAIN_MIN}…0)`, `Width Q (${VF.Q_MIN}…${VF.Q_MAX})`].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows)));
    renderSel();
  }

  function renderSel() {
    const sr = rate();
    const i = st.selected;
    const b = st.work.filter.bands[i];
    const total = VF.responseDb(st.work.filter.bands, [b.f], sr)[0];
    const custom = st.work.source === 'custom';
    const gains = VF.componentGains(comps(), st.work.filter.bands, sr).filter((x) => Math.abs(Math.log2(x.freq / b.f)) < VF.qToOctaves(b.q) / 2).slice(0, 4);
    fel.selInfo.replaceChildren(
      h('strong', {}, `Point ${i + 1} selected: `),
      `centre ${fmtHz(b.f)}, its own cut ${b.gainDb.toFixed(1)} dB, width Q ${b.q} (≈ ${VF.qToOctaves(b.q).toFixed(2)} octave). Total filter at ${fmtHz(b.f)}: ${total.toFixed(1)} dB. `,
      gains.length ? `${custom ? 'Components' : 'Harmonics'} in this region: ${gains.map((x) => `${custom ? '' : `${x.n} `}(${fmtNum(x.freq)} Hz) ${x.gainDb.toFixed(1)} dB`).join(', ')}.` : `No ${custom ? 'component' : 'harmonic'} falls inside this band right now, so moving it changes little.`,
      st.work.filter.enabled ? '' : h('span', { class: 'vl-bad' }, ' The filter is bypassed: you hear no change until you turn it on.'));
    for (const [k, tr] of [...fel.bandTable.querySelectorAll('tbody tr')].entries()) tr.classList.toggle('current', k === i);
  }

  function renderExamples() {
    const set = fel.exampleSet.value;
    const ex = st.work.origin === 'example' && st.work.example ? st.work.example : null;
    for (const b of fel.exampleBtns) b.setAttribute('aria-pressed', String(!!ex && ex.vowel === b.dataset.vowel && ex.set === set));
    const v = ex ? VF.vowelInfo(ex.vowel) : null;
    fel.exampleInfo.replaceChildren(
      v ? h('p', {}, h('strong', {}, `Loaded: ${v.name} /${v.ipa}/, sustained ${v.say}. `),
        `${VF.FORMANT_SETS[ex.set].name}: F1 ${ex.formants[0]}, F2 ${ex.formants[1]}, F3 ${ex.formants[2]} Hz (orange F1–F3 marks on the chart). ` +
        (st.work.fit ? `The 8 points follow that smooth vowel envelope to ${st.work.fit.rmsErrorDb} dB RMS (largest miss ${st.work.fit.maxErrorDb} dB, at the narrow formant peaks). ` : '') +
        (st.work.editedAfter ? 'You have edited it since loading.' : '')) : '',
      h('p', {}, 'Click a vowel to load its filter, then ▶ Play. Only the filter changes: your fundamental and source components stay as they are. These are approximate starting filters based on typical vocal resonances (average formants of many American English speakers, Hillenbrand et al. 1995), not copies of your voice or guaranteed matches for every speaker, and they have not been checked by listening tests. Vowel letters sound different across words and languages, so each button names the steady vowel with an example word.'),
      st.work.source === 'custom' ? h('p', { class: 'vf-warnline' }, 'With your own components the filter can only reshape what is there: if the rows are few or not harmonic, the result may not sound like the vowel. Automatic “Match filter to recording” is not available for your own components; it fits only the equal-strength harmonic source (workflow 3).') : '',
      isRecWf() ? h('p', { class: 'muted' }, '“Load vowel example” loads a prepared shape; “Match filter to recording” (beside this) analyzes your recorded audio.') : '',
      h('p', { class: 'muted' }, 'Each example keeps its frequencies when you change f0. The same filter at a different pitch lands on different harmonics, so the vowel may not sound the same at every pitch.'));
  }

  function renderFit() {
    const f = st.fit;
    const r = rec();
    const head = r ? h('p', { class: 'muted' }, `Will analyze “${r.name}”, section ${st.work.segment ? `${round3(st.work.segment.start)}–${round3(st.work.segment.end)} s` : '—'}, ${st.work.f0Source === 'typed' ? `at your typed f0 ${fmtHz(st.work.f0)} (manual)` : 'with an automatic f0 estimate'}.`) : h('p', { class: 'muted' }, 'Needs a recording (step 1).');
    if (!f) {
      const w = st.work;
      fel.fitBox.replaceChildren(head, w.origin === 'fitted' && w.fit ? h('p', {}, `This experiment’s filter was fitted automatically: ${w.fit.rmsErrorDb} dB RMS error over ${w.fit.measuredPoints} harmonics at f0 ${w.fit.f0Hz} Hz${w.editedAfter ? ', then edited by hand' : ''}.`) : '');
      return;
    }
    if (!f.ok) {
      fel.fitBox.replaceChildren(head, h('p', {}, h('span', { class: 'vl-auto-chip bad' }, '✗ No reliable result')), h('ul', { class: 'vl-auto-problems' }, f.problems.map((p) => h('li', {}, p))),
        h('p', { class: 'muted' }, 'Nothing was changed. Choose a steadier section, or type a fundamental in step 2 and try again.'));
      return;
    }
    const s = f.summary;
    const chip = s.rmsErrorDb < 3 ? ['good', 'close broad match'] : s.rmsErrorDb < 6 ? ['warn', 'rough match'] : ['bad', 'poor match: see below'];
    const misses = f.points.filter((p) => p.kind !== 'upper' && Math.abs(p.err) > 6);
    const over = f.points.filter((p) => p.kind === 'upper' && p.err > 3);
    fel.fitBox.replaceChildren(head,
      h('p', {}, h('span', { class: 'vl-auto-chip ' + chip[0] }, `${s.rmsErrorDb} dB RMS · ${chip[1]}`), ' ',
        h('span', { class: 'muted' }, `${s.measuredPoints} measured harmonics, ${s.upperLimitPoints} weak ones used as upper limits, level offset ${s.levelOffsetDb} dB, f0 ${s.f0Hz} Hz (${s.f0Source}), ${Math.round(f.ms)} ms.`)),
      s.warnings.length ? h('ul', { class: 'vl-auto-warnings' }, s.warnings.map((w) => h('li', {}, w))) : '',
      misses.length ? h('p', {}, h('strong', {}, 'Largest mismatches: '), misses.slice(0, 6).map((p) => `harmonic ${p.n} (${fmtNum(p.freq)} Hz): recording ${p.want.toFixed(1)} dB, filter ${p.got.toFixed(1)} dB`).join('; '), '. Eight broad bands cannot follow narrow or closely spaced changes; try dragging the nearest point, or accept a broad match.') : h('p', { class: 'muted' }, 'Every measured harmonic is within 6 dB of its target.'),
      over.length ? h('p', { class: 'muted' }, `${over.length} weak harmonic(s) end up more than 3 dB above their noise limit.`) : '',
      h('details', { class: 'vl-help' }, h('summary', {}, 'Per-harmonic targets and result'),
        h('div', { class: 'vl-auto-table' }, h('table', { class: 'comps vl-table vl-auto-harm' },
          h('thead', {}, h('tr', {}, ['n', 'n × f0', 'Kind', 'Target (dB, incl. offset)', 'Filter gain', 'Error'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, f.points.map((p) => h('tr', { class: p.kind === 'upper' ? 'zero' : '' },
            h('th', { scope: 'row' }, String(p.n)), h('td', { class: 'mono' }, fmtNum(p.freq)), h('td', {}, p.kind === 'upper' ? 'upper limit (weak)' : 'measured'),
            h('td', { class: 'mono' }, p.want.toFixed(1)), h('td', { class: 'mono' }, p.got.toFixed(1)), h('td', { class: 'mono' }, p.kind === 'upper' ? (p.err > 0 ? `+${p.err.toFixed(1)} over` : 'within') : p.err.toFixed(1)))))))),
      h('p', { class: 'help' }, 'This opened as a new, unsaved filter experiment (marked “fitted”). Compare Original → Filtered, drag points to improve it, then Save: it is stored separately and your other experiments are unchanged.'));
  }

  function renderViewButtons() {
    for (const b of fel.rangeButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.max) === st.range));
    fel.logBtn.setAttribute('aria-pressed', String(st.log));
  }

  function updateSaveState() {
    const d = isDirty();
    const s = savedFor(st.work.id);
    fel.saveState.textContent = d ? (s ? '● Unsaved changes' : '● Not saved yet') : `✓ Saved ${new Date(s.savedAt).toLocaleTimeString()}`;
    fel.saveState.className = 'vf-save-state ' + (d ? 'dirty' : 'clean');
    fel.saveBtn.classList.toggle('attention', d);
    fel.saveNewBtn.disabled = !s;
    const opt = [...fel.expSelect.options].find((o) => o.value === st.work.id);
    if (opt) opt.textContent = VF.filterLabel(st.work) + (!s ? ' (not saved yet)' : d ? ' (unsaved changes)' : '');
    updateDownloads();
  }

  function renderExpTable() {
    if (!st.saved.length) { fel.expTable.replaceChildren(h('p', { class: 'muted' }, 'No saved filter experiments yet.')); return; }
    fel.expTable.replaceChildren(h('table', { class: 'comps vl-table' },
      h('thead', {}, h('tr', {}, ['Filter experiment', 'f0', 'Components', 'Filter', 'Recording', 'Saved', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, st.saved.map((e) => {
        const cur = e.id === st.work.id;
        const r = recById(e.recordingId);
        return h('tr', { class: cur ? 'current' : '' },
          h('th', { scope: 'row' }, VF.filterLabel(e), cur ? h('span', { class: 'muted' }, ' (open)') : ''),
          h('td', { class: 'mono' }, fmtHz(e.f0)), h('td', { class: 'mono' }, String(e.count)),
          h('td', {}, e.filter.enabled ? 'on' : 'bypassed'),
          h('td', {}, r ? r.name : e.recordingName ? h('span', { class: 'muted' }, `${e.recordingName} (not in this browser)`) : h('span', { class: 'muted' }, 'none')),
          h('td', { class: 'mono muted' }, e.savedAt ? new Date(e.savedAt).toLocaleString() : ''),
          h('td', {}, h('span', { class: 'row gap' },
            cur ? '' : h('button', { class: 'btn small', onclick: () => openFilterExperiment(e.id) }, 'Open'),
            h('button', { class: 'btn small danger', 'aria-label': `Delete filter experiment ${VF.filterLabel(e)}`, onclick: () => deleteSaved(e.id) }, '🗑'))));
      }))));
  }

  function updateStorageNote() {
    fel.storageNote.textContent = st.storage.ok
      ? 'Filter experiments are kept in this browser’s local storage under their own name, separate from your manual and automatic experiments and from the recordings. Download the JSON and WAV to keep them for sure.'
      : `Filter experiments could not be stored in this browser (${st.storage.error}); they last only until you close the tab. Download the JSON to keep them.`;
  }

  // ───────────── spectra and drawing ─────────────
  function computeSpecs() {
    const r = isRecWf() ? rec() : null;
    if (r && !origSpec) {
      const { from, to } = segSamples(r);
      const s = M.segmentSpectrum(r.samples, r.sampleRate, { from, to, fftSize: SPEC_FFT });
      origSpec = { db: M.relativeToMax(s.db, s.binHz).db, binHz: s.binHz };
    }
    if (!r) origSpec = null;
    if (specDirty && !VF.activeComponents(comps(), rate()).length) {
      wetSpec = null;
      drySpec = null;
      specDirty = false;
    }
    if (specDirty) {
      const sr = rate();
      const y = VF.renderSteady({ ...srcArgs(), bands: st.work.filter.bands, enabled: true, sampleRate: sr, length: 3 * SPEC_FFT });
      const s = M.segmentSpectrum(y, sr, { fftSize: SPEC_FFT });
      wetSpec = { db: M.relativeToMax(s.db, s.binHz).db, binHz: s.binHz };
      if (!drySpec) {
        const x = VF.renderSteady({ ...srcArgs(), bands: st.work.filter.bands, enabled: false, sampleRate: sr, length: 3 * SPEC_FFT });
        const sx = M.segmentSpectrum(x, sr, { fftSize: SPEC_FFT });
        drySpec = { db: M.relativeToMax(sx.db, sx.binHz).db, binHz: sx.binHz };
      }
      specDirty = false;
      lastSpecAt = performance.now();
    }
  }

  let lastRate = null;
  function frame() {
    if (rate() !== lastRate) { lastRate = rate(); specDirty = true; drySpec = null; dirty = true; }
    const ph = audio.playhead();
    if (ph != null) dirty = true;
    if (!element.isConnected || element.offsetParent === null) return;
    if ((specDirty && performance.now() - lastSpecAt > 120) || (!origSpec && isRecWf() && rec())) { computeSpecs(); dirty = true; }
    if (!dirty) return;
    dirty = false;
    const sr = rate();
    const r = isRecWf() ? rec() : null;
    if (r) overview.render({ rec: r, seg: r ? st.work.segment : null, playhead: st.owner ? ph : null, message: ['No recording selected', 'Choose one above, or record / import in stage 1.'] });
    const view = { min: 0, max: Math.min(st.range, sr / 2), log: st.log };
    respView.render({ ...view, bands: st.work.filter.bands, enabled: st.work.filter.enabled, selected: st.selected, sampleRate: sr, components: comps(),
      formants: st.work.origin === 'example' && st.work.example ? st.work.example.formants : null, dragging: !!st.dragging });
    const ro = specView.render({ ...view, orig: isRecWf() ? origSpec : null, filtered: st.work.filter.enabled ? wetSpec : null, unfiltered: st.showUnfiltered || !st.work.filter.enabled ? drySpec : null,
      marks: VF.activeComponents(comps(), sr).map((c) => c.freq), nyquist: sr / 2, hoverX: st.hover,
      message: ['Silent source', 'Add a component or raise an amplitude above 0.'] });
    const fmt = (v) => (v == null ? '—' : `${v.toFixed(1)} dB`);
    const harmNo = st.work.source === 'harmonics' && ro ? ` (≈ harmonic ${(ro.freq / st.work.f0).toFixed(2)})` : '';
    fel.hover.textContent = ro ? `Cursor ${fmtHz(Math.round(ro.freq))}${harmNo} · ${isRecWf() ? `recording ${fmt(ro.orig)} · ` : ''}filtered ${fmt(ro.filtered)} · unfiltered ${fmt(ro.unfiltered)}` : '';
  }

  // ───────────── init ─────────────
  const loaded = store.loadFilterExperiments();
  st.saved = loaded.list.map((e) => clone(VF.makeFilterExperiment(e)));
  st.storage = { ok: loaded.ok, error: loaded.error || '' };
  const latest = [...st.saved].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0];
  st.work = latest ? VF.makeFilterExperiment(clone(latest)) : VF.makeFilterExperiment({ ...defaultsFromLab(), workflow: 'explore', f0Source: 'default' });
  updateStorageNote();
  renderAll();
  fel.wavLen.value = String(st.wavLen);

  return {
    element,
    frame,
    tour,
    get playing() { return audio.playing; },
    setTourHook(fn) { openHooks.onTour = fn; },
    stopAudio() { stopAudio(); },
    /** Called by the Vowel Lab whenever its recordings list changes. */
    recordingsChanged() {
      if (!st.work.recordingId && !savedFor(st.work.id)) {
        const d = defaultsFromLab();
        if (d.recordingId) { st.work.recordingId = d.recordingId; st.work.recordingName = d.recordingName; st.work.segment = d.segment; origSpec = null; }
      }
      if (st.work.recordingId && !rec()) origSpec = null;
      renderRecSelect();
      renderExpTable();
      renderFit();
      dirty = true;
    },
    unmount() {
      for (const c of cleanups) c();
      audio.close();
      for (const v of [respView, specView, overview]) v.dispose();
      tour.dispose();
    },
    debug() {
      return {
        work: clone(st.work), components: comps(), dirty: isDirty(), makeupDb: 20 * Math.log10(st.makeupOn ? st.makeup : 1), saved: st.saved.map(clone), selected: st.selected, rate: rate(),
        audio: audio.debugInfo(), owner: st.owner, filteredNow: audio.filteredNow,
        fit: st.fit ? { ok: st.fit.ok, summary: st.fit.summary || null, problems: st.fit.problems || [] } : null,
        storage: { ...st.storage }, nowPlaying: fel.nowPlaying.textContent,
        tour: { open: tour.isOpen, step: tour.step, stepId: tour.stepId },
      };
    },
    testHooks: {
      renderWav: () => { const y = renderWav(); return { sampleRate: y.sampleRate, samples: Array.from(y.samples) }; },
      componentGains: () => VF.componentGains(comps(), st.work.filter.bands, rate()),
      modelResponse: (freqs) => Array.from(VF.responseDb(st.work.filter.bands, freqs, rate())),
      liveResponse: (freqs) => audio.liveResponseDb(freqs),
      renderOffline: async (seconds = 0.5) => Array.from(await renderOffline({ components: comps(), bands: st.work.filter.bands, enabled: true, sampleRate: rate(), duration: seconds, makeup: st.makeupOn ? st.makeup : 1 })),
      renderModel: (seconds = 0.5) => Array.from(VF.renderFiltered({ ...srcArgs(), bands: st.work.filter.bands, enabled: true, sampleRate: rate(), duration: seconds, makeup: st.makeupOn ? st.makeup : 1 })),
      handles: () => { const r = fel.filterCanvas.getBoundingClientRect(); return respView.handles.map((p) => ({ x: r.left + p.x, y: r.top + p.y })); },
      tourTargetRect: () => tour.targetRect(),
      decodeWav: (bytes) => decodeWav(new Uint8Array(bytes).buffer),
    },
  };
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function fmtNum(v) {
  return (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

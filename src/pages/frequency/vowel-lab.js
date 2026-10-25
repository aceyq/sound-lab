// Vowel Lab (assignment 2): record a sustained vowel, match its fundamental by
// hand, shape the harmonic amplitudes with sliders, compare, save, and repeat
// at another pitch.
//
// The person does all the judging. Nothing here estimates the fundamental,
// fits amplitudes, or fills in a vowel: the app only records, plays, draws and
// calculates what the chosen numbers produce.
import { h, fmtHz, fmtTime } from '../../lib/dom.js';
import * as M from './vowel-model.js';
import { encodeWav, decodeWav } from './wav.js';
import { VowelRecorder, recorderCounters } from './recorder.js';
import { VowelAudio } from './vowel-audio.js';
import { OverviewView, ZoomWaveView, CompareSpectrumView } from './vowel-plots.js';
import * as store from './vowel-store.js';

const DURATIONS = [2, 3, 4];
const REF_SUGGESTIONS = [[110, 'A2 · low voice'], [147, 'D3'], [196, 'G3'], [220, 'A3'], [262, 'C4 · middle C'], [330, 'E4'], [392, 'G4']];
const ZOOM_WINDOWS = [10, 20, 50, 100];
const RANGES = [1000, 2000, 4000, 5000, 8000];
const FFT_SIZES = [4096, 8192, 16384];
const COUNTS = [8, 12, 16, 24, 32, 40, 48];
const MIN_TAKE_SEC = 0.3;

/**
 * opts: { help, micSection, stopOtherAudio(), logChange(text) }
 * Returns { element, frame(), unmount(), debug(), stopAudio(), playing }.
 */
export function createVowelLab({ help, micSection, stopOtherAudio, logChange }) {
  const mic = micSection.mic;
  const recorder = new VowelRecorder();
  const audio = new VowelAudio({ volume: 0.5, onChange: () => { updateTransport(); dirtyAll(); } });

  const st = {
    recordings: [],
    saved: [], // saved experiment snapshots
    work: null, // the experiment being edited
    refText: String(M.DEFAULT_F0),
    refFreq: M.DEFAULT_F0,
    recSec: 3,
    rec: { state: 'idle', captured: 0, message: '' }, // 'idle' | 'starting' | 'recording'
    zoomMs: 20,
    zoomPos: 0.5,
    cursors: [null, null],
    periodsN: 1,
    range: 4000,
    fftSize: 8192,
    markers: true,
    snap: true,
    showSynthInInspect: false,
    pinned: null,
    pinnedN: null,
    hover2: null,
    hover4: null,
    sliderScale: 'lin',
    levelMatch: true,
    scope: 'segment',
    synthLen: 3,
    storage: { experiments: 'unknown', recordings: 'unknown', expError: '', recError: '' },
    lastMic: mic.status,
  };
  let origSpec = null; // { key, rel: {db, binHz}, frames, padded }
  let synthSpec = null;
  let synthSpecDirty = true;
  let lastSynthSpecAt = 0;
  let dragging = null;
  let canvasesDirty = true;

  const savedFor = (id) => st.saved.find((e) => e.id === id) || null;
  const recById = (id) => st.recordings.find((r) => r.id === id) || null;
  const workRec = () => (st.work ? recById(st.work.recordingId) : null);
  const recipe = () => ({ f0: st.work.f0, amps: st.work.amps });
  const nyquistFor = (rec) => (rec ? rec.sampleRate : (audio.sampleRate || mic.sampleRate || 48000)) / 2;
  const isDirty = () => M.hasUnsavedChanges(st.work, savedFor(st.work.id));

  // ───────────── shared building blocks ─────────────
  const el = {};
  const stage = (num, title, sub, ...children) => h('section', { class: 'card vl-stage', 'data-stage': num, 'aria-label': `Stage ${num}: ${title}` },
    h('div', { class: 'vl-stage-head' }, h('span', { class: 'vl-num' }, String(num)), h('div', {}, h('h2', {}, title), h('p', { class: 'muted vl-sub' }, sub))),
    ...children);
  const details = (summary, ...body) => h('details', { class: 'vl-help' }, h('summary', {}, summary), ...body);

  const f0Controls = [];
  function makeF0Control(idSuffix) {
    const input = h('input', { type: 'text', inputmode: 'decimal', class: 'num vl-f0-input', 'aria-label': 'Synthesis fundamental in Hz', id: 'vl-f0-' + idSuffix });
    const msg = h('span', { class: 'msg' });
    const nudge = (d) => h('button', { class: 'btn small', onclick: () => setF0(Math.round((st.work.f0 + d) * 100) / 100) }, (d > 0 ? '+' : '−') + Math.abs(d));
    const period = h('span', { class: 'mono muted vl-period' });
    const commit = () => {
      const r = M.parseFundamental(input.value, nyquistFor(workRec()));
      msg.textContent = r.ok ? '' : r.error;
      input.classList.toggle('invalid', !r.ok);
      if (r.ok) setF0(r.value);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    const box = h('div', { class: 'vl-f0' },
      h('label', { for: input.id, class: 'vl-f0-label' }, 'Synthesis fundamental f0'),
      h('div', { class: 'row gap wrap' }, input, h('span', {}, 'Hz'), nudge(-1), nudge(-0.1), nudge(0.1), nudge(1), period),
      msg);
    f0Controls.push({ input, msg, period });
    return box;
  }

  // ───────────── header, guide, experiment bar, transport ─────────────
  el.expSelect = h('select', { class: 'vl-exp-select', 'aria-label': 'Current experiment', onchange: (e) => openExperiment(e.target.value) });
  el.saveState = h('span', { class: 'vl-save-state', role: 'status', 'aria-live': 'polite' });
  el.saveBtn = h('button', { class: 'btn primary', onclick: () => saveWork() }, '💾 Save experiment');
  el.newBtn = h('button', { class: 'btn', onclick: () => newExperiment() }, '＋ New experiment');
  el.playOrig = h('button', { class: 'btn big vl-orig-btn', onclick: () => playOriginal() }, '▶ Play Original');
  el.playSynth = h('button', { class: 'btn big vl-synth-btn', onclick: () => playSynth() }, '▶ Play Synthesized');
  el.playAB = h('button', { class: 'btn big', onclick: () => playAlternate(), title: 'Plays the original, a short pause, then the synthesized sound for the same length.' }, '⇄ Original → Synthesized');
  el.stopBtn = h('button', { class: 'btn big', onclick: () => stopAudio() }, '■ Stop');
  el.nowPlaying = h('span', { class: 'vl-now', role: 'status', 'aria-live': 'polite' });
  el.volume = h('input', { type: 'range', min: 0, max: 100, step: 1, value: '50', 'aria-label': 'Listening volume', class: 'vl-volume' });
  el.volumeOut = h('output', { class: 'mono' }, '50%');
  el.volume.addEventListener('input', () => { audio.setVolume(Number(el.volume.value) / 100); el.volumeOut.textContent = el.volume.value + '%'; });
  el.levelMatch = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.levelMatch = e.target.checked; } });
  el.scopeSeg = h('input', { type: 'radio', name: 'vl-scope', checked: true, onchange: () => { st.scope = 'segment'; } });
  el.scopeAll = h('input', { type: 'radio', name: 'vl-scope', onchange: () => { st.scope = 'whole'; } });
  el.transportNote = h('p', { class: 'help vl-transport-note' });

  const bar = h('div', { class: 'vl-bar', 'aria-label': 'Experiment and listening controls' },
    h('div', { class: 'row gap wrap' },
      h('span', { class: 'ctl-label' }, 'Experiment'), el.expSelect, el.saveState, el.saveBtn, el.newBtn),
    h('div', { class: 'row gap wrap vl-transport' },
      el.playOrig, el.playSynth, el.playAB, el.stopBtn, el.nowPlaying,
      h('label', { class: 'row gap' }, 'Volume', el.volume, el.volumeOut),
      h('label', { class: 'check secondary', title: 'Scale the original so its highest peak equals the synthesized peak. Equal peaks do not mean equal loudness.' }, el.levelMatch, ' Match peak levels'),
      h('span', { class: 'secondary row gap' }, 'Original plays:',
        h('label', { class: 'check' }, el.scopeSeg, ' analysis segment'),
        h('label', { class: 'check' }, el.scopeAll, ' whole recording')),
    ),
    el.transportNote,
  );

  const guide = h('details', { class: 'vl-guide', open: true },
    h('summary', {}, 'How this works: what you do yourself (click to fold)'),
    h('ol', {},
      h('li', {}, h('strong', {}, 'Record a vowel. '), 'Play a comfortable reference pitch, stop it, then sing one steady vowel (“ah”, “ee”, “oo”) for 2–4 seconds.'),
      h('li', {}, h('strong', {}, 'Match its fundamental. '), 'Pick a steady part of the take, look at the waveform’s repetition and the spacing of the spectrum’s peaks, and type the fundamental yourself.'),
      h('li', {}, h('strong', {}, 'Shape its harmonics. '), 'Every slider is one harmonic at n × f0. Raise and lower them while listening and looking at the two spectra.'),
      h('li', {}, h('strong', {}, 'Compare and save. '), 'Alternate Original and Synthesized, write what matches and what does not, and download the WAVs and settings.'),
      h('li', {}, h('strong', {}, 'Repeat at another pitch. '), 'Duplicate the experiment, then either keep the same amplitudes (A) or record again and readjust (B).'),
    ),
    h('p', { class: 'muted' }, 'The app never estimates the fundamental, fits the sliders, or supplies vowel presets. The starting recipe is a neutral 1/n tone that does not sound like any vowel.'),
    el.storageNote = h('p', { class: 'note vl-storage' }),
  );

  // ───────────── stage 1: record ─────────────
  el.vowel = h('select', { 'aria-label': 'Vowel', onchange: (e) => setField('vowel', e.target.value) },
    M.VOWELS.map((v) => h('option', { value: v.id }, v.id === 'other' ? 'other (type a label)' : `${v.name} ${v.example}`)));
  el.vowelText = h('input', { type: 'text', class: 'num', placeholder: 'e.g. eh', 'aria-label': 'Custom vowel label', oninput: (e) => setField('vowelText', e.target.value) });
  el.pitch = h('select', { 'aria-label': 'Pitch condition', onchange: (e) => setField('pitch', e.target.value) },
    M.PITCHES.map((p) => h('option', { value: p }, p === 'other' ? 'other (type)' : p + ' pitch')));
  el.pitchText = h('input', { type: 'text', class: 'num', placeholder: 'e.g. very low', 'aria-label': 'Custom pitch condition', oninput: (e) => setField('pitchText', e.target.value) });
  el.expLabel = h('strong', { class: 'vl-exp-label' });

  el.refInput = h('input', { type: 'text', inputmode: 'decimal', class: 'num', value: st.refText, 'aria-label': 'Reference tone frequency in Hz' });
  el.refMsg = h('span', { class: 'msg' });
  el.refBtn = h('button', { class: 'btn', onclick: () => toggleReference() }, '♪ Play reference tone');
  el.refSuggest = h('select', { 'aria-label': 'Suggested reference pitches', onchange: (e) => { if (e.target.value) { el.refInput.value = e.target.value; commitRef(); } e.target.value = ''; } },
    h('option', { value: '' }, 'Suggestions…'), REF_SUGGESTIONS.map(([f, n]) => h('option', { value: String(f) }, `${f} Hz (${n})`)));
  el.refToF0 = h('button', { class: 'btn small', onclick: () => setF0(st.refFreq) }, 'Use as starting f0');
  el.refInput.addEventListener('change', () => commitRef());
  el.refInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitRef(); });

  el.durButtons = DURATIONS.map((s) => h('button', { class: 'btn seg', 'data-sec': s, onclick: () => setRecSec(s) }, s + ' s'));
  el.recordBtn = h('button', { class: 'btn primary big vl-record', onclick: () => record() }, '● Record vowel');
  el.recStop = h('button', { class: 'btn big', onclick: () => recorder.stop(), disabled: true }, '■ Stop recording early');
  el.recBar = h('span', { class: 'vl-rec-bar' });
  el.recProgress = h('span', { class: 'vl-rec-progress', 'aria-hidden': 'true' }, el.recBar);
  el.recState = h('span', { class: 'vl-rec-state', role: 'status', 'aria-live': 'polite' });
  el.recMsg = h('div', { class: 'vl-rec-msg', 'aria-live': 'polite' });
  el.micLine = h('span', { class: 'muted vl-mic-line' });
  el.micStop = h('button', { class: 'btn small', onclick: () => micSection.stop() }, 'Stop Microphone');
  el.recList = h('div', { class: 'vl-rec-list' });
  el.importWav = h('input', { type: 'file', accept: '.wav,audio/wav,audio/x-wav,audio/*', class: 'sr', onchange: (e) => importWav(e.target.files[0], e.target) });
  el.importWavBtn = h('button', { class: 'btn small', onclick: () => el.importWav.click() }, '⬆ Import a WAV recording');

  const stage1 = stage(1, 'Record a vowel', 'Label it, sing it, keep it.',
    h('div', { class: 'row gap wrap' },
      h('label', {}, 'Vowel ', el.vowel), el.vowelText,
      h('label', {}, 'Pitch ', el.pitch), el.pitchText,
      h('span', { class: 'muted' }, '→ '), el.expLabel),
    help('These are only labels for your recording and files. They do not set any harmonic amplitudes.'),
    h('div', { class: 'vl-sub-box' },
      h('h3', {}, 'Reference pitch (optional)'),
      h('div', { class: 'row gap wrap' }, el.refInput, h('span', {}, 'Hz'), el.refSuggest, el.refBtn, el.refToF0, el.refMsg),
      help('Play it, hum along, then stop it before you record. Pick any pitch that is comfortable for your voice; you do not have to sing 200 Hz. The tone is a soft sine with two weak overtones so laptop speakers can play low pitches. Recording stops it automatically.'),
    ),
    h('div', { class: 'row gap wrap vl-rec-controls' },
      h('span', { class: 'ctl-label' }, 'Length'), h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Recording length' }, el.durButtons),
      el.recordBtn, el.recStop, el.recProgress, el.recState),
    el.recMsg,
    h('p', { class: 'row gap wrap' }, el.micLine, el.micStop),
    help('Record turns the microphone on if needed (your browser may ask for permission) and stops any playing sound first, so the speakers are not recorded. Sing one steady vowel at an even loudness. Headphones help when you compare later.'),
    h('div', { class: 'row gap wrap vl-rec-head' }, h('h3', {}, 'Recordings'), el.importWavBtn, el.importWav),
    el.recList,
  );

  // ───────────── stage 2: fundamental ─────────────
  el.overview = h('canvas', { class: 'plot vl-overview', role: 'img', 'aria-label': 'Whole recording; drag to choose the analysis segment' });
  el.segStart = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', 'aria-label': 'Segment start in seconds' });
  el.segEnd = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', 'aria-label': 'Segment end in seconds' });
  el.segInfo = h('span', { class: 'mono muted' });
  el.segMsg = h('span', { class: 'msg' });
  for (const inp of [el.segStart, el.segEnd]) {
    inp.addEventListener('change', () => commitSegmentInputs());
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitSegmentInputs(); });
  }
  el.zoom = h('canvas', { class: 'plot vl-zoom', role: 'img', 'aria-label': 'Zoomed waveform of the analysis segment; click to place time cursors A and B' });
  el.zoomButtons = ZOOM_WINDOWS.map((ms) => h('button', { class: 'btn seg', 'data-ms': ms, onclick: () => setZoom(ms) }, ms + ' ms'));
  el.zoomPos = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: '500', 'aria-label': 'Position of the zoomed window inside the segment' });
  el.zoomPos.addEventListener('input', () => { st.zoomPos = Number(el.zoomPos.value) / 1000; st.cursors = [null, null]; canvasesDirty = true; updateCursorText(); });
  el.periodMarks = h('input', { type: 'checkbox', checked: true, onchange: () => { canvasesDirty = true; } });
  el.cursorText = h('div', { class: 'vl-cursor-text', 'aria-live': 'polite' });
  el.spec2 = h('canvas', { class: 'plot vl-spec', role: 'img', 'aria-label': 'Spectrum of the analysis segment with expected harmonic positions' });
  el.rangeButtons2 = RANGES.map((f) => h('button', { class: 'btn seg', 'data-max': f, onclick: () => setRange(f) }, `0–${f / 1000} kHz`));
  el.fft2 = h('select', { 'aria-label': 'FFT size', onchange: (e) => setFft(Number(e.target.value)) }, FFT_SIZES.map((n) => h('option', { value: String(n) }, n.toLocaleString('en-US'))));
  el.markers2 = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.markers = e.target.checked; el.markers4.checked = st.markers; canvasesDirty = true; } });
  el.snap = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.snap = e.target.checked; } });
  el.synthIn2 = h('input', { type: 'checkbox', onchange: (e) => { st.showSynthInInspect = e.target.checked; canvasesDirty = true; } });
  el.hover2 = h('span', { class: 'mono muted' });
  el.pinText = h('div', { class: 'vl-pin-text', 'aria-live': 'polite' });
  el.specInfo2 = h('p', { class: 'help mono vl-spec-info' });

  const stage2 = stage(2, 'Match its fundamental', 'Choose a steady segment, then estimate f0 by eye and ear.',
    h('h3', {}, 'Analysis segment'),
    h('div', { class: 'canvas-box vl-overview-box' }, el.overview),
    h('div', { class: 'row gap wrap' },
      h('label', {}, 'From ', el.segStart, ' s'), h('label', {}, 'to ', el.segEnd, ' s'),
      h('button', { class: 'btn small', onclick: () => resetSegment() }, 'Middle second'), el.segInfo, el.segMsg),
    help('Skip the start and end of the take, where the voice is still settling. Drag across the plot above, or type the times. The shaded part is what every plot and the Original button use.'),
    h('div', { class: 'vl-two' },
      h('div', {},
        h('h3', {}, 'Waveform repetition'),
        h('div', { class: 'row gap wrap controls' },
          h('span', { class: 'ctl-label' }, 'Zoom'), h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Zoomed window length' }, el.zoomButtons),
          h('label', { class: 'check' }, el.periodMarks, ' Show 1/f0 marks')),
        h('label', { class: 'vl-zoompos' }, 'Window position inside the segment', el.zoomPos),
        h('div', { class: 'canvas-box vl-zoom-box' }, el.zoom),
        el.cursorText,
      ),
      h('div', {},
        h('h3', {}, 'Spectrum of the segment'),
        h('div', { class: 'row gap wrap controls' },
          h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Frequency range' }, el.rangeButtons2),
          h('label', {}, 'FFT ', el.fft2)),
        h('div', { class: 'row gap wrap controls' },
          h('label', { class: 'check' }, el.markers2, ' Mark n × f0'),
          h('label', { class: 'check' }, el.snap, ' Click snaps to nearby peak'),
          h('label', { class: 'check' }, el.synthIn2, ' Overlay synthesized'),
          el.hover2),
        h('div', { class: 'canvas-box vl-spec-box' }, el.spec2),
        el.pinText,
        el.specInfo2,
      ),
    ),
    makeF0Control('s2'),
    details('How to estimate the fundamental by hand (click to open)',
      h('ul', {},
        h('li', {}, h('strong', {}, 'Waveform: '), 'a sung vowel repeats a similar shape over and over. Click A at the start of one repetition and B at the same point one or several repetitions later, tell the app how many repetitions are between them, and it shows f0 = repetitions ÷ time. The dotted 1/f0 marks should then line up with each repetition.'),
        h('li', {}, h('strong', {}, 'Spectrum: '), 'harmonics are evenly spaced, n × f0. The spacing between neighbouring peaks is about f0. Several peaks give a better estimate than one: click a peak, type which harmonic number you think it is, and the app shows peak ÷ n. Check that the purple n × f0 marks sit on the peaks all the way up, not just near the bottom.'),
        h('li', {}, h('strong', {}, 'The strongest peak is not necessarily the fundamental. '), 'In many vowels harmonic 2, 3 or a higher one is louder than harmonic 1, because it lies near a resonance of the vocal tract.'),
        h('li', {}, h('strong', {}, 'Your voice is not one perfectly constant frequency. '), 'Pitch drifts and wobbles (vibrato), so the peaks are slightly wide and high harmonics smear. Your f0 is an approximate average over the segment; a shorter, steadier segment can help.'),
        h('li', {}, h('strong', {}, 'Limits of reading by eye: '), 'the FFT points are sample rate ÷ FFT size apart (shown under the spectrum). Hovering and clicking read single points; the snap only moves to the highest nearby point. The app does not detect pitch, so if two estimates disagree, trust the one that makes all the n × f0 marks line up and that sounds like the same pitch.'),
      ),
    ),
  );

  // ───────────── stage 3: harmonics ─────────────
  el.count = h('select', { 'aria-label': 'Number of harmonics', onchange: (e) => setCount(Number(e.target.value)) }, COUNTS.map((n) => h('option', { value: String(n) }, String(n))));
  el.scaleLin = h('button', { class: 'btn seg', onclick: () => setSliderScale('lin') }, 'Linear 0–1');
  el.scaleDb = h('button', { class: 'btn seg', onclick: () => setSliderScale('db') }, 'Decibels');
  el.recipeButtons = Object.entries(M.START_RECIPES).map(([k, r]) => h('button', { class: 'btn small', title: r.describe, onclick: () => applyStartRecipe(k) }, r.name));
  el.outInfo = h('p', { class: 'help vl-out-info' });
  el.rows = h('div', { class: 'vl-rows', role: 'group', 'aria-label': 'Harmonic amplitudes' });
  const stage3 = stage(3, 'Shape its harmonics', 'One slider per harmonic n, at frequency n × f0.',
    makeF0Control('s3'),
    h('div', { class: 'row gap wrap controls' },
      h('label', {}, 'Harmonics ', el.count),
      h('span', { class: 'ctl-label' }, 'Sliders'), h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Slider scale' }, el.scaleLin, el.scaleDb),
      h('span', { class: 'secondary row gap' }, h('span', { class: 'muted' }, 'Start over from:'), el.recipeButtons)),
    h('div', { class: 'formula' }, 'x(t) = g · Σ Aₙ · sin(2π · n · f0 · t)', h('span', { class: 'muted' }, '  Aₙ = your slider for harmonic n; g = one shared peak level')),
    el.outInfo,
    el.rows,
    details('Strategy for shaping by looking and listening (click to open)',
      h('ul', {},
        h('li', {}, 'Work on the spectrum’s overall shape first: find the regions where the orange recording curve has groups of strong harmonics (the resonance bumps) and where it dips. Raise the sliders in the bumps, lower those in the dips.'),
        h('li', {}, 'Use the dB slider scale for quiet harmonics: the plot is in dB, so −20 dB on a slider moves the cyan peak down 20 dB.'),
        h('li', {}, 'Change one or two sliders at a time, then press ⇄ and listen. Your ears decide; the plot only helps you see where to look.'),
        h('li', {}, 'Harmonics above about 4 kHz affect brightness and “buzz”; try lowering them if the synthesis sounds too harsh.'),
        h('li', {}, 'Amplitude 0 silences a harmonic. Harmonics at or above the Nyquist frequency are left out automatically (shown greyed out).'),
      ),
      h('p', { class: 'muted' }, 'Raising one slider does not simply make the sound louder: the whole sound is scaled so its peak stays the same, so other harmonics get relatively quieter. Equal peaks do not guarantee equal loudness; that depends on which frequencies carry the energy.'),
    ),
  );

  // ───────────── stage 4: compare and save ─────────────
  el.spec4 = h('canvas', { class: 'plot vl-spec', role: 'img', 'aria-label': 'Original and synthesized spectra on one frequency axis' });
  el.rangeButtons4 = RANGES.map((f) => h('button', { class: 'btn seg', 'data-max': f, onclick: () => setRange(f) }, `0–${f / 1000} kHz`));
  el.markers4 = h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.markers = e.target.checked; el.markers2.checked = st.markers; canvasesDirty = true; } });
  el.hover4 = h('span', { class: 'mono muted' });
  el.specInfo4 = h('p', { class: 'help vl-spec-info' });
  el.zoom4 = h('canvas', { class: 'plot vl-zoom', role: 'img', 'aria-label': 'Original and synthesized waveforms' });
  el.notes = {};
  const noteFields = M.NOTE_FIELDS.map(([k, label]) => {
    const ta = h('textarea', { rows: 2, class: 'vl-note', 'aria-label': label, oninput: (e) => { st.work.notes[k] = e.target.value; updateSaveState(); } });
    el.notes[k] = ta;
    return h('label', { class: 'vl-note-label' }, label, ta);
  });
  el.synthLen = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', value: '3', 'aria-label': 'Synthesized file length in seconds' });
  el.synthLen.addEventListener('change', () => {
    const v = Number(el.synthLen.value);
    if (Number.isFinite(v) && v >= 0.5 && v <= 10) st.synthLen = Math.round(v * 100) / 100;
    el.synthLen.value = String(st.synthLen);
    updateDownloads();
  });
  el.dlOrig = h('button', { class: 'btn', onclick: () => downloadOriginal() }, '⬇ Original (WAV)');
  el.dlSynth = h('button', { class: 'btn', onclick: () => downloadSynth() }, '⬇ Synthesized (WAV)');
  el.dlSettings = h('button', { class: 'btn', onclick: () => downloadSettings() }, '⬇ Settings (JSON)');
  el.dlAll = h('button', { class: 'btn primary', onclick: () => saveAndDownloadAll() }, '💾 Save, then download all three');
  el.dlNote = h('p', { class: 'help vl-dl-note', 'aria-live': 'polite' });
  el.importJson = h('input', { type: 'file', accept: '.json,application/json', class: 'sr', onchange: (e) => importSettings(e.target.files[0], e.target) });
  el.importMsg = h('p', { class: 'note', 'aria-live': 'polite' });

  const stage4 = stage(4, 'Compare and save', 'Listen back and forth, compare the spectra, keep the files.',
    h('div', { class: 'row gap wrap controls' },
      h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Frequency range' }, el.rangeButtons4),
      h('label', { class: 'check' }, el.markers4, ' Mark n × f0'), el.hover4),
    h('div', { class: 'canvas-box vl-spec-box vl-spec4-box' }, el.spec4),
    h('p', { class: 'legend' },
      h('span', { class: 'key vl-key-orig' }), ' original recording (analysis segment)   ',
      h('span', { class: 'key vl-key-synth' }), ' synthesized from your sliders   ',
      h('span', { class: 'key vl-key-mark' }), ' n × f0'),
    el.specInfo4,
    h('div', { class: 'canvas-box vl-zoom4-box' }, el.zoom4),
    help('Waveform comparison: orange = recording, cyan = synthesis, scaled to the same peak in this window. The synthesis uses phase 0 for every harmonic, so its wave shape can look different even when the spectra and the sound are close.'),
    details('What this comparison can and cannot show (click to open)',
      h('ul', {},
        h('li', {}, 'Both spectra use the same analysis: the same sample rate, FFT size, Hann window and 50 % overlap averaging. The synthesized one is calculated from your sliders, not from the recording.'),
        h('li', {}, 'Each curve is shown relative to its own strongest peak (0 dB). That lines up their shapes. It is not a calibrated loudness match: the microphone, its input volume and the room change the recording’s absolute level.'),
        h('li', {}, 'The synthesis is amplitude-only: fixed sine amplitudes, phase 0, one exactly constant f0. Your voice also has breath noise, small pitch wobbles, changing amplitudes and its own phases. So the synthesis may sound like the vowel without being the same sound or the same waveform.'),
      )),
    h('h3', {}, 'Notes for this experiment'),
    h('div', { class: 'vl-notes' }, noteFields),
    h('h3', {}, 'Save and download'),
    h('div', { class: 'row gap wrap' }, el.dlOrig, el.dlSynth, el.dlSettings, el.dlAll,
      h('label', { class: 'secondary' }, 'Synthesized length ', el.synthLen, ' s')),
    el.dlNote,
    h('div', { class: 'row gap wrap' }, h('button', { class: 'btn small', onclick: () => el.importJson.click() }, '⬆ Import settings (JSON)'), el.importJson,
      h('span', { class: 'help inline' }, 'Restores a saved recipe, labels and notes as a new experiment. Import its original WAV in stage 1 to listen to it again.')),
    el.importMsg,
  );

  // ───────────── stage 5: another pitch ─────────────
  el.dupA = h('button', { class: 'btn', onclick: () => duplicate('A') }, 'Duplicate → A: same amplitudes, new f0');
  el.dupB = h('button', { class: 'btn', onclick: () => duplicate('B') }, 'Duplicate → B: record again and readjust');
  el.pitchInfo = h('div', { class: 'vl-pitch-info', 'aria-live': 'polite' });
  el.expTable = h('div', { class: 'vl-exp-table' });
  const stage5 = stage(5, 'Repeat at another pitch', 'Keep the first version; compare two ways.',
    h('div', { class: 'vl-two vl-dups' },
      h('div', { class: 'vl-sub-box' }, h('h3', {}, 'A. Same amplitudes, new fundamental'),
        h('p', {}, 'Copies this experiment with the same Aₙ for every harmonic number n. Change only f0 (sing or play a new pitch as reference), then listen: does it still sound like the same vowel? The first recording stays linked for comparison.'),
        el.dupA),
      h('div', { class: 'vl-sub-box' }, h('h3', {}, 'B. Record again, readjust'),
        h('p', {}, 'Copies this experiment without a recording. Record the same vowel at the new pitch, set its f0, and readjust the sliders to match the new recording. Note which harmonics you had to move.'),
        el.dupB),
    ),
    help('Duplicating saves the current experiment first, so the original version is preserved exactly as it is now.'),
    el.pitchInfo,
    details('Why the same slider settings may not keep the vowel (formants)',
      h('p', {}, 'Changing the fundamental moves every harmonic: harmonic n is at n × f0, so at a higher pitch the harmonics spread further apart.'),
      h('p', {}, 'A vowel’s character comes mostly from resonances of your vocal tract (throat, mouth, tongue and lip shape), called formants. When you sing the same vowel at a new pitch you keep roughly the same mouth shape, so those resonances stay in roughly the same frequency regions. They do not move up in proportion to the fundamental.'),
      h('p', {}, 'So in comparison A, the harmonic that was strong because it sat inside a resonance (say harmonic 4 at 800 Hz) is now somewhere else (harmonic 4 at 1,200 Hz). The strong frequencies move with the pitch, and the vowel can start to sound different. In comparison B you usually have to make different harmonic numbers strong to keep energy in the same frequency regions.'),
      h('p', { class: 'muted' }, 'Formants are not perfectly fixed: singers adjust their mouth shape with pitch, and at high pitches the harmonics are so far apart that the resonances are hard to see. A formant is a resonance region, not any single harmonic.'),
    ),
    h('h3', {}, 'Saved experiments'),
    el.expTable,
  );

  const element = h('section', { class: 'vowel-lab', id: 'vowel-lab', 'aria-label': 'Vowel Lab' },
    h('div', { class: 'card vl-intro' },
      h('h2', {}, '🗣 Vowel Lab: recreate a sung vowel with harmonic sliders'),
      h('p', { class: 'muted' }, 'Record → inspect → set the fundamental → adjust harmonics → compare → save → repeat at another pitch.'),
      guide),
    bar,
    stage1,
    stage2,
    h('div', { class: 'vl-shape-grid' }, stage3, stage4),
    stage5,
  );

  // ───────────── views ─────────────
  const overview = new OverviewView(el.overview);
  const zoom = new ZoomWaveView(el.zoom);
  const zoom4 = new ZoomWaveView(el.zoom4);
  const spec2 = new CompareSpectrumView(el.spec2);
  const spec4 = new CompareSpectrumView(el.spec4);
  for (const v of [overview, zoom, zoom4, spec2, spec4]) v.onResize = () => { canvasesDirty = true; };

  const pointerCleanups = [];
  const on = (target, ev, fn) => { target.addEventListener(ev, fn); pointerCleanups.push(() => target.removeEventListener(ev, fn)); };
  const localX = (canvas, e) => e.clientX - canvas.getBoundingClientRect().left;
  on(el.overview, 'pointerdown', (e) => {
    const rec = workRec();
    if (!rec) return;
    const dur = rec.samples.length / rec.sampleRate;
    const t = overview.timeAt(localX(el.overview, e), dur);
    dragging = { t0: t, dur };
    el.overview.setPointerCapture(e.pointerId);
    st.work.segment = { start: t, end: t };
    canvasesDirty = true;
  });
  on(el.overview, 'pointermove', (e) => {
    if (!dragging) return;
    const t = overview.timeAt(localX(el.overview, e), dragging.dur);
    st.work.segment = { start: Math.min(dragging.t0, t), end: Math.max(dragging.t0, t) };
    canvasesDirty = true;
    syncSegmentInputs();
  });
  const endDrag = () => {
    if (!dragging) return;
    const rec = workRec();
    dragging = null;
    if (!rec) return;
    setSegment(st.work.segment);
  };
  on(el.overview, 'pointerup', endDrag);
  on(el.overview, 'pointercancel', endDrag);
  on(el.zoom, 'click', (e) => {
    const z = zoomWindow();
    if (!z) return;
    const ms = zoom.msAt(localX(el.zoom, e), (z.n / z.sampleRate) * 1000);
    if (st.cursors[0] == null || st.cursors[1] != null) st.cursors = [ms, null];
    else st.cursors = [st.cursors[0], ms];
    canvasesDirty = true;
    updateCursorText();
  });
  for (const [canvas, key] of [[el.spec2, 'hover2'], [el.spec4, 'hover4']]) {
    on(canvas, 'pointermove', (e) => { st[key] = localX(canvas, e); canvasesDirty = true; });
    on(canvas, 'pointerleave', () => { st[key] = null; canvasesDirty = true; });
  }
  on(el.spec2, 'click', (e) => pinAt(spec2.freqAt(localX(el.spec2, e), 0, st.range)));
  on(el.spec4, 'click', (e) => pinAt(spec4.freqAt(localX(el.spec4, e), 0, st.range)));

  // ───────────── experiments ─────────────
  function openExperiment(id, { force = false } = {}) {
    if (st.work && id === st.work.id) return;
    if (!force && st.work && isDirty() && !window.confirm(`“${M.experimentLabel(st.work)}” has unsaved changes. Discard them and open another experiment?`)) {
      renderExpSelect();
      return;
    }
    const s = savedFor(id);
    if (!s) return;
    stopAudio();
    loadWork(M.snapshot(s));
    logChange(`Opened experiment “${M.experimentLabel(st.work)}”.`);
  }

  function newExperiment() {
    if (st.work && isDirty() && !window.confirm(`“${M.experimentLabel(st.work)}” has unsaved changes. Discard them and start a new experiment?`)) return;
    stopAudio();
    const base = st.work || {};
    loadWork(M.makeExperiment({ vowel: base.vowel, pitch: base.pitch, f0: st.refFreq, count: base.count }));
    logChange('New experiment started (not saved yet).');
  }

  function loadWork(e) {
    st.work = e;
    st.cursors = [null, null];
    st.pinned = null;
    origSpec = null;
    synthSpecDirty = true;
    const rec = workRec();
    if (rec && !st.work.segment) st.work.segment = M.defaultSegment(rec.samples.length / rec.sampleRate);
    if (rec) st.synthLen = Math.round((rec.samples.length / rec.sampleRate) * 100) / 100;
    el.synthLen.value = String(st.synthLen);
    renderAll();
  }

  function saveWork({ quiet = false } = {}) {
    const w = st.work;
    w.savedAt = new Date().toISOString();
    const snap = M.snapshot(w);
    const i = st.saved.findIndex((e) => e.id === w.id);
    if (i >= 0) st.saved[i] = snap; else st.saved.push(snap);
    persistExperiments();
    if (!quiet) logChange(`Saved experiment “${M.experimentLabel(w)}” (f0 ${fmtHz(w.f0)}, ${w.count} harmonics).`);
    renderExpSelect();
    renderExpTable();
    updateSaveState();
    return snap;
  }

  function persistExperiments() {
    const r = store.saveExperiments(st.saved);
    st.storage.experiments = r.ok ? 'stored' : 'memory';
    st.storage.expError = r.ok ? '' : r.error;
    updateStorageNote();
  }

  function deleteExperiment(id) {
    const s = savedFor(id);
    if (!s || !window.confirm(`Delete the saved experiment “${M.experimentLabel(s)}”? Its recording stays in the Recordings list.`)) return;
    st.saved = st.saved.filter((e) => e.id !== id);
    persistExperiments();
    logChange(`Deleted experiment “${M.experimentLabel(s)}”.`);
    if (st.work.id === id) st.work.savedAt = null; // now unsaved again, still open
    renderExpSelect();
    renderExpTable();
    updateSaveState();
  }

  function duplicate(mode) {
    stopAudio();
    // Save pending edits first; an already-saved source is left exactly as it is.
    const src = isDirty() ? saveWork({ quiet: true }) : savedFor(st.work.id);
    const copy = M.duplicateExperiment(src, mode);
    loadWork(copy);
    saveWork({ quiet: true });
    logChange(`Duplicated “${src ? M.experimentLabel(src) : ''}” as ${mode === 'A' ? 'A (same amplitudes; change f0 next)' : 'B (record the same vowel at the new pitch next)'}. The original experiment is unchanged.`);
    el.pitchInfo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (mode === 'B') flashMsg(el.recMsg, 'Comparison B: record the same vowel at your new pitch. It becomes this experiment’s recording.');
  }

  function setField(key, value) {
    st.work[key] = value;
    renderLabels();
    updateSaveState();
    renderExpSelect();
  }

  // ───────────── recipe edits ─────────────
  function setF0(v) {
    const r = M.parseFundamental(String(v), nyquistFor(workRec()));
    if (!r.ok) { for (const c of f0Controls) { c.msg.textContent = r.error; } return; }
    const old = st.work.f0;
    st.work.f0 = r.value;
    for (const c of f0Controls) { c.msg.textContent = ''; c.input.classList.remove('invalid'); }
    if (old !== r.value) logChange(`Synthesis fundamental: ${fmtHz(old)} → ${fmtHz(r.value)}. Every harmonic moved to n × ${fmtHz(r.value)}; amplitudes kept.`, 'vl-f0');
    onRecipeChange(true);
  }

  function setCount(n) {
    st.work.count = n;
    st.work.amps = M.resizeAmps(st.work.amps, n);
    buildRows();
    onRecipeChange(true);
    logChange(`Harmonic count: ${n} (existing amplitudes kept; new ones start at 0).`);
  }

  function applyStartRecipe(kind) {
    const r = M.START_RECIPES[kind];
    if (st.work.amps.some((a, i) => a !== M.startRecipe(kind, st.work.count)[i]) &&
      !window.confirm(`Replace all ${st.work.count} amplitudes with “${r.name}” (${r.describe})?`)) return;
    st.work.amps = M.startRecipe(kind, st.work.count);
    onRecipeChange(true);
    logChange(`Amplitudes reset to “${r.name}”: ${r.describe}.`);
  }

  function setAmp(i, v, source) {
    if (st.work.amps[i] === v) return;
    st.work.amps[i] = v;
    updateRow(i, source);
    onRecipeChange(false);
  }

  function setSliderScale(s) {
    st.sliderScale = s;
    buildRows();
  }

  function onRecipeChange(allRows) {
    if (allRows) for (let i = 0; i < rowEls.length; i++) updateRow(i);
    audio.updateRecipe(recipe());
    synthSpecDirty = true;
    canvasesDirty = true;
    updateF0Displays();
    updateOutInfo();
    updateSaveState();
    updateCursorText();
    updatePinText();
    renderPitchInfo();
  }

  // ───────────── harmonic rows ─────────────
  let rowEls = [];
  function buildRows() {
    const db = st.sliderScale === 'db';
    el.scaleLin.setAttribute('aria-pressed', String(!db));
    el.scaleDb.setAttribute('aria-pressed', String(db));
    el.count.value = String(st.work.count);
    rowEls = st.work.amps.map((_, i) => {
      const n = i + 1;
      const slider = h('input', db
        ? { type: 'range', min: M.DB_SLIDER_MIN, max: 0, step: 0.5, 'aria-label': `Harmonic ${n} level in dB (leftmost = off)` }
        : { type: 'range', min: 0, max: 1, step: 0.001, 'aria-label': `Harmonic ${n} amplitude` });
      const num = h('input', { type: 'text', inputmode: 'decimal', class: 'num small', 'aria-label': `Harmonic ${n} amplitude from 0 to 1` });
      const freq = h('span', { class: 'mono vl-hfreq' });
      const dbText = h('span', { class: 'mono muted vl-hdb' });
      slider.addEventListener('input', () => {
        const v = db ? M.dbToAmp(Number(slider.value)) : Math.round(Number(slider.value) * 1000) / 1000;
        setAmp(i, v, 'slider');
        logChange(`Harmonic ${n} amplitude set to ${st.work.amps[i]}.`, 'vl-amp-' + n);
      });
      const commit = () => {
        const r = M.parseAmp(num.value);
        num.classList.toggle('invalid', !r.ok);
        num.title = r.ok ? '' : r.error;
        if (r.ok) { setAmp(i, r.value, 'text'); logChange(`Harmonic ${n} amplitude set to ${r.value}.`, 'vl-amp-' + n); }
      };
      num.addEventListener('change', commit);
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
      const row = h('div', { class: 'vl-row', 'data-n': n },
        h('span', { class: 'vl-hn' }, 'n = ' + n), freq, slider, num, dbText);
      return { row, slider, num, freq, dbText };
    });
    el.rows.replaceChildren(...rowEls.map((r) => r.row));
    for (let i = 0; i < rowEls.length; i++) updateRow(i);
  }

  function updateRow(i, source) {
    const r = rowEls[i];
    if (!r) return;
    const a = st.work.amps[i];
    const f = (i + 1) * st.work.f0;
    const nyq = nyquistFor(workRec());
    const audible = f < nyq;
    r.freq.textContent = fmtHz(f);
    r.row.classList.toggle('above-nyquist', !audible);
    r.row.classList.toggle('zero', a === 0);
    r.row.title = audible ? '' : `At or above the Nyquist frequency (${fmtHz(nyq)}): left out of the sound.`;
    if (source !== 'slider') r.slider.value = String(st.sliderScale === 'db' ? Math.max(M.DB_SLIDER_MIN, M.ampToDb(a)) : a);
    if (source !== 'text') { r.num.value = String(a); r.num.classList.remove('invalid'); }
    r.dbText.textContent = a > 0 ? `${M.ampToDb(a).toFixed(1)} dB` : 'off';
  }

  function updateF0Displays() {
    for (const c of f0Controls) {
      if (document.activeElement !== c.input) c.input.value = String(st.work.f0);
      c.period.textContent = `period 1/f0 = ${fmtTime(1 / st.work.f0)}`;
    }
  }

  function updateOutInfo() {
    const rec = workRec();
    const nyq = nyquistFor(rec);
    const g = M.outputGain(st.work.f0, st.work.amps, nyq);
    const rows = M.harmonicRows(st.work.f0, st.work.amps, nyq);
    const above = rows.filter((r) => !r.audible);
    const top = rows.filter((r) => r.audible).pop();
    el.outInfo.textContent = (g > 0
      ? `Peak level: the synthesized sound is scaled by g = ${g.toFixed(3)} so its highest peak is ${M.OUTPUT_PEAK} (−6 dB below full scale), for playback and for the WAV file. `
      : 'All amplitudes are 0: the synthesized sound is silent. ') +
      `Harmonics 1–${rows.length} reach ${top ? fmtHz(top.freq) : '—'}` +
      (above.length ? `; ${above.length} at or above Nyquist (${fmtHz(nyq)}) are left out.` : `, all below the Nyquist frequency (${fmtHz(nyq)}).`) +
      ` Slider changes are smoothed over about 20 ms to avoid clicks.`;
  }

  // ───────────── recordings ─────────────
  function setRecSec(s) {
    st.recSec = s;
    for (const b of el.durButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === s));
    updateRecUi();
  }

  async function record() {
    if (st.rec.state !== 'idle') return;
    stopAudio();
    stopOtherAudio();
    st.rec = { state: 'starting', captured: 0, message: '' };
    el.recMsg.replaceChildren();
    updateRecUi();
    if (!mic.listening) {
      await micSection.enable();
      if (!mic.listening) {
        st.rec.state = 'idle';
        updateRecUi();
        flashMsg(el.recMsg, `The microphone did not start${mic.error ? ': ' + mic.error.title : ''}. See the Microphone section below for details.`, true);
        return;
      }
      await wait(400); // let the input settle after opening
    }
    if (st.rec.state !== 'starting') return;
    st.rec.state = 'recording';
    updateRecUi();
    logChange(`Recording ${st.recSec} s from the microphone…`);
    const res = await recorder.start(mic, st.recSec, { onProgress: (sec) => { st.rec.captured = sec; updateRecProgress(); } });
    st.rec.state = 'idle';
    updateRecUi();
    const sec = res.samples.length / res.sampleRate;
    if (res.error) { flashMsg(el.recMsg, `Recording failed: ${res.error}`, true); return; }
    if (sec < MIN_TAKE_SEC) {
      flashMsg(el.recMsg, `Only ${fmtTime(sec)} was captured${res.reason === 'mic-stopped' ? ' before the microphone stopped' : ''}, so nothing was kept. Try again.`, true);
      return;
    }
    const rec = addRecording({ samples: res.samples, sampleRate: res.sampleRate, source: 'microphone' });
    const notes = [];
    if (res.cutShort) notes.push(res.reason === 'mic-stopped' ? `The microphone stopped after ${fmtTime(sec)}; that part was kept.` : `Stopped early after ${fmtTime(sec)}.`);
    if (rec.peak >= 0.99) notes.push('It reached digital full scale (clipping). Sing a little softer or move back, and record again.');
    else if (rec.peak < 0.02) notes.push('It is very quiet. Move closer or raise the input volume, and record again if the spectrum looks noisy.');
    linkNewRecording(rec, notes);
  }

  function addRecording({ samples, sampleRate, source, fileName = null, name = null }) {
    const base = name || `${M.vowelName(st.work)} — ${M.pitchName(st.work)} pitch`;
    const rec = {
      id: M.newId('rec'),
      name: M.uniqueName(base, st.recordings.map((r) => r.name)),
      vowel: st.work.vowel, pitch: M.pitchName(st.work),
      sampleRate, samples, source, fileName,
      createdAt: new Date().toISOString(),
      peak: M.peakAbs(samples),
      stored: null,
    };
    st.recordings.push(rec);
    store.putRecording(rec).then((r) => {
      rec.stored = r.ok;
      st.storage.recordings = r.ok ? 'stored' : 'memory';
      st.storage.recError = r.ok ? '' : r.error;
      updateStorageNote();
      renderRecordings();
    });
    logChange(`Recorded “${rec.name}”: ${fmtTime(samples.length / sampleRate)} at ${sampleRate.toLocaleString('en-US')} samples per second (peak ${(20 * Math.log10(rec.peak || 1e-9)).toFixed(1)} dBFS).`);
    renderRecordings();
    return rec;
  }

  function linkNewRecording(rec, notes = []) {
    const current = workRec();
    if (!current) {
      useRecording(rec.id);
      flashMsg(el.recMsg, [`Kept “${rec.name}” and linked it to this experiment.`, ...notes].join(' '));
    } else {
      // Never replace the experiment's recording silently.
      el.recMsg.replaceChildren(
        h('span', {}, `Kept “${rec.name}” as a new recording. This experiment still uses “${current.name}”. ${notes.join(' ')} `),
        h('button', { class: 'btn small', onclick: () => { useRecording(rec.id); el.recMsg.replaceChildren(); } }, `Use “${rec.name}” in this experiment`),
      );
    }
  }

  function useRecording(id) {
    const rec = recById(id);
    if (!rec) return;
    stopAudio();
    st.work.recordingId = id;
    st.work.segment = M.defaultSegment(rec.samples.length / rec.sampleRate);
    st.synthLen = Math.round((rec.samples.length / rec.sampleRate) * 100) / 100;
    el.synthLen.value = String(st.synthLen);
    st.cursors = [null, null];
    st.pinned = null;
    origSpec = null;
    synthSpecDirty = true;
    logChange(`Experiment now uses recording “${rec.name}”; analysis segment ${st.work.segment.start}–${st.work.segment.end} s.`);
    renderAll();
  }

  function renameRecording(rec, input) {
    const name = input.value.trim();
    if (!name || name === rec.name) { input.value = rec.name; return; }
    rec.name = M.uniqueName(name, st.recordings.filter((r) => r !== rec).map((r) => r.name));
    input.value = rec.name;
    store.putRecording(rec);
    renderRecordings();
    updateDownloads();
  }

  function deleteRecording(rec) {
    const users = st.saved.filter((e) => e.recordingId === rec.id).map(M.experimentLabel);
    const msg = `Delete the recording “${rec.name}” from this browser? This cannot be undone. Download its WAV first if you want to keep it.` +
      (users.length ? `\n\nSaved experiments that use it will lose their recording: ${users.join(', ')}.` : '');
    if (!window.confirm(msg)) return;
    stopAudio();
    st.recordings = st.recordings.filter((r) => r !== rec);
    store.deleteRecording(rec.id);
    if (st.work.recordingId === rec.id) { st.work.recordingId = null; origSpec = null; }
    logChange(`Deleted recording “${rec.name}”.`);
    renderAll();
  }

  async function importWav(file, input) {
    if (!file) return;
    input.value = '';
    try {
      const buf = await file.arrayBuffer();
      let samples;
      let sampleRate;
      let how;
      try {
        const d = decodeWav(buf);
        ({ samples, sampleRate } = d);
        how = `WAV, ${d.bitDepth}-bit ${d.format === 'float' ? 'float' : 'PCM'}, ${d.channels === 1 ? 'mono' : d.channels + ' channels averaged to mono'}`;
      } catch (wavErr) {
        const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const ctx = new AC(1, 1, 48000);
        const ab = await ctx.decodeAudioData(buf.slice(0));
        sampleRate = ab.sampleRate;
        samples = new Float32Array(ab.length);
        for (let c = 0; c < ab.numberOfChannels; c++) { const ch = ab.getChannelData(c); for (let i = 0; i < ab.length; i++) samples[i] += ch[i] / ab.numberOfChannels; }
        how = `decoded by the browser (${file.type || 'unknown type'}; not a plain WAV: ${wavErr.message}), resampled to ${sampleRate.toLocaleString('en-US')} Hz`;
      }
      if (samples.length / sampleRate < MIN_TAKE_SEC) throw new Error('it is shorter than 0.3 s');
      const rec = addRecording({ samples, sampleRate, source: 'imported', fileName: file.name, name: file.name.replace(/\.[^.]+$/, '') });
      linkNewRecording(rec, [`Imported from ${file.name} (${how}).`]);
    } catch (e) {
      flashMsg(el.recMsg, `Could not import ${file.name}: ${e.message || e}`, true);
    }
  }

  // ───────────── segment, zoom, cursors, spectrum ─────────────
  function setSegment(seg) {
    const rec = workRec();
    if (!rec) return;
    const dur = rec.samples.length / rec.sampleRate;
    st.work.segment = M.clampSegment(seg, dur);
    st.cursors = [null, null];
    origSpec = null;
    synthSpecDirty = true;
    canvasesDirty = true;
    el.segMsg.textContent = '';
    syncSegmentInputs();
    updateSaveState();
    updateCursorText();
    logChange(`Analysis segment: ${st.work.segment.start}–${st.work.segment.end} s.`, 'vl-seg');
  }

  function resetSegment() {
    const rec = workRec();
    if (rec) setSegment(M.defaultSegment(rec.samples.length / rec.sampleRate));
  }

  function commitSegmentInputs() {
    const a = Number(el.segStart.value);
    const b = Number(el.segEnd.value);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) { el.segMsg.textContent = 'Type a start and a later end time in seconds.'; return; }
    setSegment({ start: a, end: b });
  }

  function syncSegmentInputs() {
    const rec = workRec();
    const seg = st.work.segment;
    if (!rec || !seg) { el.segStart.value = ''; el.segEnd.value = ''; el.segInfo.textContent = ''; return; }
    el.segStart.value = String(round3(seg.start));
    el.segEnd.value = String(round3(seg.end));
    const n = Math.round((seg.end - seg.start) * rec.sampleRate);
    el.segInfo.textContent = `${fmtTime(seg.end - seg.start)} = ${n.toLocaleString('en-US')} samples`;
  }

  function segSamples(rec) {
    const seg = st.work.segment || M.defaultSegment(rec.samples.length / rec.sampleRate);
    const from = Math.max(0, Math.round(seg.start * rec.sampleRate));
    const to = Math.min(rec.samples.length, Math.round(seg.end * rec.sampleRate));
    return { from, to: Math.max(from + 1, to) };
  }

  function setZoom(ms) {
    st.zoomMs = ms;
    st.cursors = [null, null];
    for (const b of el.zoomButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.ms) === ms));
    canvasesDirty = true;
    updateCursorText();
  }

  function zoomWindow() {
    const rec = workRec();
    if (!rec) return null;
    const { from, to } = segSamples(rec);
    const n = Math.max(16, Math.round((st.zoomMs / 1000) * rec.sampleRate));
    const room = Math.max(0, to - from - n);
    const start = Math.min(rec.samples.length - Math.min(n, rec.samples.length), from + Math.round(room * st.zoomPos));
    return { buf: rec.samples, start: Math.max(0, start), n: Math.min(n, rec.samples.length), sampleRate: rec.sampleRate };
  }

  function updateCursorText() {
    const [a, b] = st.cursors;
    if (!workRec()) { el.cursorText.replaceChildren(); return; }
    if (a == null) {
      el.cursorText.replaceChildren(h('span', { class: 'muted' }, 'Click the waveform at the start of one repetition to place cursor A.'));
      return;
    }
    if (b == null) {
      el.cursorText.replaceChildren(h('span', { class: 'muted' }, `A at ${a.toFixed(2)} ms. Now click the same point one or more repetitions later to place B.`));
      return;
    }
    const dt = Math.abs(b - a);
    const nIn = h('input', { type: 'text', inputmode: 'numeric', class: 'num small', value: String(st.periodsN), 'aria-label': 'Number of repetitions between A and B' });
    const result = h('strong', { class: 'mono' });
    const useBtn = h('button', { class: 'btn small' }, 'Use as f0');
    const calc = () => {
      const k = Math.round(Number(nIn.value));
      if (!(k >= 1 && k <= 50)) { result.textContent = '(type 1–50)'; useBtn.disabled = true; return null; }
      st.periodsN = k;
      const f = dt > 0 ? (k / dt) * 1000 : NaN;
      result.textContent = Number.isFinite(f) ? fmtHz(Math.round(f * 100) / 100) : '—';
      useBtn.disabled = !Number.isFinite(f);
      return f;
    };
    nIn.addEventListener('input', calc);
    useBtn.addEventListener('click', () => { const f = calc(); if (Number.isFinite(f)) setF0(Math.round(f * 100) / 100); });
    el.cursorText.replaceChildren(
      h('span', {}, `A → B = ${dt.toFixed(2)} ms, spanning `), nIn, h('span', {}, ' repetition(s): f0 ≈ repetitions ÷ time = '), result, ' ', useBtn,
      h('button', { class: 'btn small', onclick: () => { st.cursors = [null, null]; canvasesDirty = true; updateCursorText(); } }, 'Clear A/B'),
      h('div', { class: 'help' }, 'Clicks land on single samples, so a longer span (several repetitions) gives a more precise estimate.'));
    calc();
  }

  function pinAt(f) {
    if (!(f >= 0)) return;
    let freq = f;
    let snapped = false;
    if (st.snap && origSpec) {
      const p = M.peakNear(origSpec.rel.db, origSpec.rel.binHz, f, 3);
      if (p) { freq = p.freq; snapped = true; }
    }
    st.pinned = freq;
    st.pinnedSnapped = snapped;
    st.pinnedN = Math.max(1, Math.round(freq / st.work.f0));
    canvasesDirty = true;
    updatePinText();
  }

  function updatePinText() {
    if (st.pinned == null) {
      el.pinText.replaceChildren(h('span', { class: 'muted' }, 'Click the spectrum to pin a frequency cursor, e.g. on a clear peak.'));
      return;
    }
    const nIn = h('input', { type: 'text', inputmode: 'numeric', class: 'num small', value: String(st.pinnedN), 'aria-label': 'Harmonic number of the pinned peak' });
    const out = h('strong', { class: 'mono' });
    const use = h('button', { class: 'btn small' }, 'Use as f0');
    const calc = () => {
      const n = Math.round(Number(nIn.value));
      if (!(n >= 1 && n <= M.MAX_HARMONICS)) { out.textContent = '(type a whole number)'; use.disabled = true; return null; }
      st.pinnedN = n;
      const f = Math.round((st.pinned / n) * 100) / 100;
      out.textContent = fmtHz(f);
      use.disabled = false;
      return f;
    };
    nIn.addEventListener('input', calc);
    use.addEventListener('click', () => { const f = calc(); if (f) setF0(f); });
    const lvl = origSpec ? origSpec.rel.db[Math.round(st.pinned / origSpec.rel.binHz)] : null;
    el.pinText.replaceChildren(
      h('span', {}, `Pinned at ${fmtHz(Math.round(st.pinned * 10) / 10)}${st.pinnedSnapped ? ' (snapped to the highest nearby point)' : ''}${lvl != null ? `, ${lvl.toFixed(1)} dB` : ''}. If this is harmonic number `),
      nIn, h('span', {}, ', then f0 = peak ÷ n = '), out, ' ', use,
      h('button', { class: 'btn small', onclick: () => { st.pinned = null; canvasesDirty = true; updatePinText(); } }, 'Unpin'));
    calc();
  }

  function setRange(f) {
    st.range = f;
    for (const b of [...el.rangeButtons2, ...el.rangeButtons4]) b.setAttribute('aria-pressed', String(Number(b.dataset.max) === f));
    canvasesDirty = true;
  }

  function setFft(n) {
    st.fftSize = n;
    el.fft2.value = String(n);
    origSpec = null;
    synthSpecDirty = true;
    canvasesDirty = true;
  }

  function computeOrigSpec() {
    const rec = workRec();
    if (!rec) { origSpec = null; return; }
    const { from, to } = segSamples(rec);
    const key = `${rec.id}:${from}:${to}:${st.fftSize}`;
    if (origSpec && origSpec.key === key) return;
    const s = M.segmentSpectrum(rec.samples, rec.sampleRate, { from, to, fftSize: st.fftSize });
    origSpec = { key, rel: { db: M.relativeToMax(s.db, s.binHz).db, binHz: s.binHz }, frames: s.frames, padded: s.padded, sampleRate: rec.sampleRate, n: to - from };
    updateSpecInfo();
  }

  function computeSynthSpec() {
    const rec = workRec();
    const sr = rec ? rec.sampleRate : nyquistFor(null) * 2;
    const N = st.fftSize;
    const segN = rec ? (() => { const { from, to } = segSamples(rec); return to - from; })() : 3 * N;
    // A steady synthesized tone has the same spectrum in every frame, so a
    // few frames are enough; a segment shorter than one frame is mirrored.
    const len = segN < N ? segN : Math.min(segN, 3 * N);
    const g = M.outputGain(st.work.f0, st.work.amps, sr / 2);
    if (g === 0) { synthSpec = null; return; }
    const y = M.renderRecipe({ f0: st.work.f0, amps: st.work.amps, sampleRate: sr, duration: len / sr, gain: g, fadeSec: 0 });
    const s = M.segmentSpectrum(y, sr, { fftSize: N });
    synthSpec = { rel: { db: M.relativeToMax(s.db, s.binHz).db, binHz: s.binHz }, frames: s.frames };
    synthSpecDirty = false;
    lastSynthSpecAt = performance.now();
  }

  function updateSpecInfo() {
    const rec = workRec();
    if (!rec || !origSpec) { el.specInfo2.textContent = ''; el.specInfo4.textContent = ''; return; }
    const bin = origSpec.rel.binHz;
    const txt = `Analysis: ${origSpec.n.toLocaleString('en-US')} samples of the segment at ${rec.sampleRate.toLocaleString('en-US')} Hz · FFT ${st.fftSize.toLocaleString('en-US')} (${fmtTime(st.fftSize / rec.sampleRate)} per frame) · ${M.SPECTRUM_WINDOW} window · ${origSpec.frames} frame(s) averaged · points ${bin.toFixed(2)} Hz apart.` +
      (origSpec.padded ? ' The segment is shorter than one FFT frame, so it was zero-padded: peaks are wider. Choose a longer segment or a smaller FFT.' : '');
    el.specInfo2.textContent = txt + ' 0 dB = the strongest peak above 50 Hz.';
    el.specInfo4.textContent = txt + ' The synthesized curve uses the same sample rate, FFT size, window and averaging. Each curve is shifted so its own strongest peak is 0 dB (a shape comparison, not a calibrated level match).';
  }

  // ───────────── playback ─────────────
  function stopAudio() {
    if (audio.playing) audio.stop();
  }

  function guardPlay() {
    if (st.rec.state !== 'idle') return false;
    stopOtherAudio();
    return true;
  }

  function playOriginal() {
    const rec = workRec();
    if (!rec || !guardPlay()) return;
    const { from, to } = st.scope === 'whole' ? { from: 0, to: rec.samples.length } : segSamples(rec);
    audio.playOriginal(rec, { from, to, levelMatch: st.levelMatch });
    logChange(`Playing original “${rec.name}” (${st.scope === 'whole' ? 'whole recording' : 'analysis segment'}).`);
  }

  function playSynth() {
    if (!guardPlay()) return;
    audio.playSynth(recipe());
    logChange(`Playing synthesized sound: f0 ${fmtHz(st.work.f0)}, ${st.work.count} harmonics (until Stop; sliders change it live).`);
  }

  function playAlternate() {
    const rec = workRec();
    if (!rec || !guardPlay()) return;
    const { from, to } = st.scope === 'whole' ? { from: 0, to: rec.samples.length } : segSamples(rec);
    audio.playAlternate(rec, recipe(), { from, to, levelMatch: st.levelMatch });
    logChange('Alternating: original, a short pause, then synthesized for the same length.');
  }

  let refPlaying = false;
  function commitRef() {
    const r = M.parseFundamental(el.refInput.value);
    el.refMsg.textContent = r.ok ? '' : r.error;
    el.refInput.classList.toggle('invalid', !r.ok);
    if (!r.ok) return false;
    st.refFreq = r.value;
    if (audio.state === 'ref') audio.playReference(st.refFreq);
    return true;
  }

  function toggleReference() {
    if (audio.state === 'ref') { audio.stop(); return; }
    if (!commitRef() || !guardPlay()) return;
    audio.playReference(st.refFreq);
    logChange(`Reference tone ${fmtHz(st.refFreq)} playing (quiet). Stop it before recording.`);
  }

  function updateTransport() {
    const rec = workRec();
    const busy = st.rec.state !== 'idle';
    el.playOrig.disabled = !rec || busy;
    el.playAB.disabled = !rec || busy;
    el.playSynth.disabled = busy;
    el.stopBtn.disabled = !audio.playing;
    const labels = {
      idle: '○ Nothing playing',
      ref: `♪ Reference tone ${fmtHz(audio.current && audio.current.freq)}`,
      original: '▶ Now playing: ORIGINAL recording',
      synth: '▶ Now playing: SYNTHESIZED',
      ab: { original: '⇄ 1/2 Now playing: ORIGINAL', gap: '⇄ pause…', synth: '⇄ 2/2 Now playing: SYNTHESIZED' }[audio.abPhase] || '⇄',
    };
    el.nowPlaying.textContent = labels[audio.state];
    const playingWhat = audio.state === 'original' || audio.abPhase === 'original' ? 'orig' : audio.state === 'synth' || audio.abPhase === 'synth' ? 'synth' : audio.state === 'ref' ? 'ref' : '';
    el.nowPlaying.className = 'vl-now ' + playingWhat;
    el.refBtn.textContent = audio.state === 'ref' ? '■ Stop reference tone' : '♪ Play reference tone';
    el.refBtn.setAttribute('aria-pressed', String(audio.state === 'ref'));
    el.transportNote.textContent = !rec
      ? 'Record or choose a recording to enable Play Original. Play Synthesized works any time.'
      : `Original: “${rec.name}”, ${st.scope === 'whole' ? 'whole recording' : `segment ${st.work.segment.start}–${st.work.segment.end} s`}. Only one sound plays at a time.` +
        (st.levelMatch ? ' Peaks are matched (equal peaks are not equal loudness).' : ' The original plays at its recorded level.');
  }

  // ───────────── downloads and import ─────────────
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    logChange(`Downloaded ${name}.`);
  }

  function savedRecipeForDownload() {
    return savedFor(st.work.id);
  }

  function downloadOriginal() {
    const s = savedRecipeForDownload() || st.work;
    const rec = recById(s.recordingId);
    if (!rec) return;
    download(`${M.fileBase(s)}_original.wav`, new Blob([encodeWav(rec.samples, rec.sampleRate).buffer], { type: 'audio/wav' }));
  }

  function synthRender(s) {
    const rec = recById(s.recordingId);
    const sr = rec ? rec.sampleRate : 48000;
    const g = M.outputGain(s.f0, s.amps, sr / 2);
    return { samples: M.renderRecipe({ f0: s.f0, amps: s.amps, sampleRate: sr, duration: st.synthLen, gain: g }), sampleRate: sr };
  }

  function downloadSynth() {
    const s = savedRecipeForDownload();
    if (!s) return;
    const y = synthRender(s);
    download(`${M.fileBase(s)}_synthesized.wav`, new Blob([encodeWav(y.samples, y.sampleRate).buffer], { type: 'audio/wav' }));
  }

  function downloadSettings() {
    const s = savedRecipeForDownload();
    if (!s) return;
    const rec = recById(s.recordingId);
    const sr = rec ? rec.sampleRate : 48000;
    const doc = M.settingsDocument(s, { recording: rec, nyquist: sr / 2, synthDuration: st.synthLen, sampleRate: sr });
    download(`${M.fileBase(s)}_settings.json`, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  }

  function saveAndDownloadAll() {
    saveWork();
    const s = savedRecipeForDownload();
    if (recById(s.recordingId)) downloadOriginal();
    setTimeout(downloadSynth, 350);
    setTimeout(downloadSettings, 700);
  }

  function updateDownloads() {
    const s = savedRecipeForDownload();
    const dirty = isDirty();
    const base = M.fileBase(s || st.work);
    const recS = s ? recById(s.recordingId) : workRec();
    el.dlOrig.disabled = !recS;
    el.dlSynth.disabled = !s;
    el.dlSettings.disabled = !s;
    el.dlOrig.title = `${base}_original.wav: the recording exactly as captured (16-bit PCM WAV, mono)`;
    el.dlSynth.title = `${base}_synthesized.wav: ${st.synthLen} s rendered from the saved sliders, peak ${M.OUTPUT_PEAK}, 20 ms fades`;
    el.dlSettings.title = `${base}_settings.json: fundamental, every harmonic amplitude, labels and notes`;
    const files = `Files: ${base}_original.wav, ${base}_synthesized.wav, ${base}_settings.json (WAV = 16-bit PCM mono; the synthesized file is ${st.synthLen} s, rendered with the same formula and peak level as playback, with 20 ms fades).`;
    el.dlNote.textContent = !s
      ? `Save the experiment to enable the synthesized and settings downloads. ${files}`
      : dirty
        ? `⚠ You have unsaved changes. The downloads use the last saved version (${new Date(s.savedAt).toLocaleTimeString()}). Use “Save, then download all three” to include them. ${files}`
        : `${files} Your browser may ask once to allow several downloads.`;
    el.dlNote.classList.toggle('warn', !!s && dirty);
  }

  async function importSettings(file, input) {
    if (!file) return;
    input.value = '';
    let doc;
    try { doc = JSON.parse(await file.text()); } catch (e) {
      el.importMsg.textContent = `Could not read ${file.name}: it is not valid JSON.`;
      return;
    }
    const r = M.parseSettings(doc);
    if (!r.ok) { el.importMsg.textContent = `Could not import ${file.name}: ${r.error}`; return; }
    if (st.work && isDirty() && !window.confirm(`“${M.experimentLabel(st.work)}” has unsaved changes. Discard them and open the imported experiment?`)) return;
    stopAudio();
    const match = r.recordingName ? st.recordings.find((x) => x.name === r.recordingName) : null;
    if (match) r.experiment.recordingId = match.id;
    loadWork(r.experiment);
    saveWork({ quiet: true });
    logChange(`Imported settings from ${file.name} as a new experiment.`);
    el.importMsg.textContent = `Imported ${file.name} as a new saved experiment “${M.experimentLabel(st.work)}”.` +
      (match ? ` Linked to the recording “${match.name}”.` : r.recordingName ? ` Its recording “${r.recordingName}” is not in this browser: import ${r.originalFile || 'its original WAV'} in stage 1 and click “Use in this experiment”.` : '') +
      (r.warnings.length ? ' Warnings: ' + r.warnings.join(' ') : '');
  }

  // ───────────── rendering ─────────────
  function renderAll() {
    renderLabels();
    buildRows();
    renderRecordings();
    renderExpSelect();
    renderExpTable();
    syncSegmentInputs();
    onRecipeChange(false);
    updateSpecInfo();
    updateTransport();
    updatePinText();
    updateCursorText();
    for (const k of Object.keys(el.notes)) el.notes[k].value = st.work.notes[k] || '';
    dirtyAll();
  }

  function dirtyAll() {
    canvasesDirty = true;
  }

  function renderLabels() {
    const w = st.work;
    el.vowel.value = w.vowel;
    el.vowelText.hidden = w.vowel !== 'other';
    if (document.activeElement !== el.vowelText) el.vowelText.value = w.vowelText;
    el.pitch.value = w.pitch;
    el.pitchText.hidden = w.pitch !== 'other';
    if (document.activeElement !== el.pitchText) el.pitchText.value = w.pitchText;
    el.expLabel.textContent = `${M.experimentLabel(w)} · files ${M.fileBase(w)}_…`;
  }

  function renderExpSelect() {
    const opts = st.saved.map((e) => h('option', { value: e.id }, M.experimentLabel(e.id === st.work.id ? st.work : e) + (e.id === st.work.id && isDirty() ? ' (unsaved changes)' : '')));
    if (!savedFor(st.work.id)) opts.unshift(h('option', { value: st.work.id }, M.experimentLabel(st.work) + ' (not saved yet)'));
    el.expSelect.replaceChildren(...opts);
    el.expSelect.value = st.work.id;
  }

  function updateSaveState() {
    const dirty = isDirty();
    const s = savedFor(st.work.id);
    el.saveState.textContent = dirty ? (s ? '● Unsaved changes' : '● Not saved yet') : `✓ Saved ${new Date(s.savedAt).toLocaleTimeString()}`;
    el.saveState.className = 'vl-save-state ' + (dirty ? 'dirty' : 'clean');
    el.saveBtn.classList.toggle('attention', dirty);
    renderExpSelectLabelsOnly();
    updateDownloads();
  }

  function renderExpSelectLabelsOnly() {
    const opt = [...el.expSelect.options].find((o) => o.value === st.work.id);
    if (!opt) return;
    const saved = savedFor(st.work.id);
    opt.textContent = M.experimentLabel(st.work) + (!saved ? ' (not saved yet)' : isDirty() ? ' (unsaved changes)' : '');
  }

  function renderRecordings() {
    if (!st.recordings.length) {
      el.recList.replaceChildren(h('p', { class: 'muted' }, 'No recordings yet.'));
      updateTransport();
      return;
    }
    el.recList.replaceChildren(...[...st.recordings].reverse().map((rec) => {
      const used = st.work.recordingId === rec.id;
      const name = h('input', { type: 'text', class: 'vl-rec-name', value: rec.name, 'aria-label': 'Recording name' });
      name.addEventListener('change', () => renameRecording(rec, name));
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
      const dur = rec.samples.length / rec.sampleRate;
      const peakDb = 20 * Math.log10(rec.peak || 1e-9);
      return h('div', { class: 'vl-rec' + (used ? ' used' : ''), 'data-id': rec.id },
        name,
        h('span', { class: 'mono muted' }, `${fmtTime(dur)} · ${rec.sampleRate.toLocaleString('en-US')} Hz · peak ${peakDb.toFixed(1)} dBFS${rec.peak >= 0.99 ? ' ⚠ clipped' : ''}`),
        h('span', { class: 'muted vl-rec-src' }, rec.source === 'imported' ? `imported ${rec.fileName || ''}` : 'microphone',
          ' · ', rec.stored === true ? 'kept in this browser' : rec.stored === false ? 'memory only (lost on refresh)' : 'saving…'),
        h('span', { class: 'row gap' },
          h('button', { class: 'btn small', onclick: () => { if (guardPlay()) audio.playOriginal(rec, { levelMatch: st.levelMatch }); } }, '▶ Play'),
          h('button', { class: 'btn small', onclick: () => download(`${M.slug(rec.name)}.wav`, new Blob([encodeWav(rec.samples, rec.sampleRate).buffer], { type: 'audio/wav' })) }, '⬇ WAV'),
          used ? h('span', { class: 'vl-used' }, '✓ used by this experiment')
            : h('button', { class: 'btn small', onclick: () => useRecording(rec.id) }, 'Use in this experiment'),
          h('button', { class: 'btn small danger', onclick: () => deleteRecording(rec), 'aria-label': `Delete ${rec.name}` }, '🗑')),
      );
    }));
    updateTransport();
  }

  function renderExpTable() {
    if (!st.saved.length) { el.expTable.replaceChildren(h('p', { class: 'muted' }, 'No saved experiments yet. Press 💾 Save experiment.')); return; }
    el.expTable.replaceChildren(h('table', { class: 'comps vl-table' },
      h('thead', {}, h('tr', {}, ['Experiment', 'f0', 'Harmonics', 'Recording', 'Saved', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, st.saved.map((e) => {
        const rec = recById(e.recordingId);
        const current = e.id === st.work.id;
        return h('tr', { class: current ? 'current' : '' },
          h('th', { scope: 'row' }, M.experimentLabel(e), current ? h('span', { class: 'muted' }, ' (open)') : ''),
          h('td', { class: 'mono' }, fmtHz(e.f0)),
          h('td', { class: 'mono' }, String(e.count)),
          h('td', {}, rec ? rec.name : e.recordingId ? h('span', { class: 'muted' }, 'not in this browser') : h('span', { class: 'muted' }, 'none')),
          h('td', { class: 'mono muted' }, e.savedAt ? new Date(e.savedAt).toLocaleString() : ''),
          h('td', {}, h('span', { class: 'row gap' },
            current ? '' : h('button', { class: 'btn small', onclick: () => openExperiment(e.id) }, 'Open'),
            h('button', { class: 'btn small danger', onclick: () => deleteExperiment(e.id), 'aria-label': `Delete experiment ${M.experimentLabel(e)}` }, '🗑'))));
      }))));
  }

  function renderPitchInfo() {
    const w = st.work;
    if (!w.comparison || !w.parentF0) {
      el.pitchInfo.replaceChildren(h('p', { class: 'muted' }, 'This experiment is not a duplicate. Save it, then use A or B above when you want to try another pitch.'));
      return;
    }
    const pc = M.pitchChange(w.parentF0, w.f0);
    const src = st.saved.find((e) => e.id === w.parentId);
    el.pitchInfo.replaceChildren(
      h('p', {}, h('strong', {}, w.comparison === 'A' ? 'Comparison A (same amplitudes): ' : 'Comparison B (new recording): '),
        `source “${w.parentLabel}” at ${fmtHz(w.parentF0)} → now ${fmtHz(w.f0)} ` +
        (Math.abs(pc.semitones) < 0.05 ? '(the same f0 so far: change it in stage 2 or 3).' : `(× ${pc.ratio.toFixed(3)}, ${pc.semitones > 0 ? '+' : ''}${pc.semitones.toFixed(1)} semitones). Harmonic 1 moved from ${fmtHz(w.parentF0)} to ${fmtHz(w.f0)}; harmonic 4 from ${fmtHz(4 * w.parentF0)} to ${fmtHz(4 * w.f0)}.`)),
      w.comparison === 'A'
        ? h('p', { class: 'muted' }, 'Play Original plays the first recording (the old pitch). Compare: does the synthesized sound at the new f0 still sound like the same vowel?')
        : h('p', { class: 'muted' }, workRec() ? 'Compare this recording with your readjusted sliders, then note which harmonics you had to change.' : 'Record the same vowel at your new pitch in stage 1.'),
      src ? h('button', { class: 'btn small', onclick: () => openExperiment(src.id) }, `Open the source experiment “${M.experimentLabel(src)}”`) : '',
    );
  }

  function updateRecUi() {
    const s = st.rec.state;
    el.recordBtn.disabled = s !== 'idle';
    el.recStop.disabled = s !== 'recording';
    el.recordBtn.textContent = s === 'starting' ? '… Starting microphone' : s === 'recording' ? '● Recording…' : `● Record vowel (${st.recSec} s)`;
    for (const b of el.durButtons) b.disabled = s !== 'idle';
    element.classList.toggle('recording', s === 'recording');
    updateRecProgress();
    updateTransport();
  }

  function updateRecProgress() {
    const s = st.rec.state;
    el.recProgress.hidden = s !== 'recording';
    el.recBar.style.width = `${Math.min(100, (st.rec.captured / st.recSec) * 100)}%`;
    el.recState.textContent = s === 'recording' ? `Recording: ${st.rec.captured.toFixed(1)} of ${st.recSec} s — sing your steady vowel now` : s === 'starting' ? 'Opening the microphone…' : '';
  }

  function updateMicLine() {
    const s = mic.status;
    el.micLine.textContent = s === 'listening' ? `Microphone: ● listening (${mic.sampleRate.toLocaleString('en-US')} Hz). Recordings stay here after you stop it.`
      : s === 'requesting' ? 'Microphone: waiting for permission…'
      : s === 'error' ? `Microphone: ⚠ ${mic.error.title}. See the Microphone section below.`
      : 'Microphone: ○ off (Record turns it on).';
    el.micStop.hidden = s !== 'listening';
  }

  function updateStorageNote() {
    const s = st.storage;
    const exp = s.experiments === 'memory' ? `Saved experiments could not be stored in this browser (${s.expError}); they last only until you close or refresh the tab.` : 'Saved experiments (settings and notes) are kept in this browser’s local storage, so they survive a refresh.';
    const rec = s.recordings === 'memory' ? ` Recordings could not be stored (${s.recError}); they exist only in this tab’s memory and are lost on refresh.` : ' Recordings are kept in this browser’s IndexedDB storage, so they survive a refresh too.';
    el.storageNote.textContent = `${exp}${rec} Both stay on this computer and are never uploaded, but the browser can clear them (private windows, clearing site data, low disk space). Download the WAV and JSON files to keep your results.`;
  }

  // ───────────── drawing (from the page's animation loop) ─────────────
  let lastMicStatus = null;
  let lastPlayhead = null;
  function frame() {
    if (mic.status !== lastMicStatus) { lastMicStatus = mic.status; updateMicLine(); }
    const ph = audio.playhead();
    if (ph !== lastPlayhead) { lastPlayhead = ph; canvasesDirty = true; }
    if (synthSpecDirty && performance.now() - lastSynthSpecAt > 120) { computeSynthSpec(); canvasesDirty = true; }
    if (!canvasesDirty || element.hidden || !element.isConnected || element.offsetParent === null) return;
    canvasesDirty = false;
    draw(ph);
  }

  function draw(ph) {
    const rec = workRec();
    computeOrigSpec();
    overview.render({ rec, seg: rec ? st.work.segment : null, playhead: ph });
    const z = zoomWindow();
    const periodMs = 1000 / st.work.f0;
    const zArgs = z ? { ...z, range: rangeFor(z), periodMs } : { buf: null, start: 0, n: 960, sampleRate: 48000, range: 1 };
    zoom.render({ ...zArgs, cursors: st.cursors, showPeriods: el.periodMarks.checked });
    let synthWave = null;
    if (z) {
      const g = M.outputGain(st.work.f0, st.work.amps, z.sampleRate / 2);
      if (g > 0) {
        const y = M.renderRecipe({ f0: st.work.f0, amps: st.work.amps, sampleRate: z.sampleRate, duration: z.n / z.sampleRate, gain: g, fadeSec: 0 });
        const k = M.peakAbs(z.buf, z.start, z.start + z.n) / M.OUTPUT_PEAK;
        for (let i = 0; i < y.length; i++) y[i] *= k;
        synthWave = y;
      }
    }
    zoom4.render({ ...zArgs, synth: synthWave, showPeriods: false, message: ['No recording selected', 'The cyan synthesized wave appears next to a recording.'] });
    const nyq = nyquistFor(rec);
    const common = { min: 0, max: Math.min(st.range, nyq), f0: st.work.f0, count: st.work.count, nyquist: nyq, markers: st.markers, pinned: st.pinned };
    const r2 = spec2.render({ ...common, orig: origSpec && origSpec.rel, synth: st.showSynthInInspect ? synthSpec && synthSpec.rel : null, hoverX: st.hover2 });
    const r4 = spec4.render({ ...common, orig: origSpec && origSpec.rel, synth: synthSpec && synthSpec.rel, hoverX: st.hover4, message: ['Nothing to compare yet', 'Record a vowel, or raise a slider to see the synthesized spectrum.'] });
    el.hover2.textContent = readoutText(r2);
    el.hover4.textContent = readoutText(r4);
  }

  function rangeFor(z) {
    const p = M.peakAbs(z.buf, z.start, z.start + z.n);
    return Math.max(0.01, Math.ceil(p * 1.15 * 100) / 100);
  }

  function readoutText(r) {
    if (!r) return '';
    const f = (v) => (v == null ? '—' : `${v.toFixed(1)} dB`);
    return `${r.pinned ? 'Pinned' : 'Cursor'} ${fmtHz(Math.round(r.freq))} (≈ harmonic ${(r.freq / st.work.f0).toFixed(2)}) · original ${f(r.orig)} · synthesized ${f(r.synth)}`;
  }

  // ───────────── init ─────────────
  let alive = true;
  const loaded = store.loadExperiments();
  st.saved = loaded.list.map((e) => M.makeExperiment(e));
  st.storage.experiments = loaded.ok ? 'stored' : 'memory';
  st.storage.expError = loaded.error || '';
  const latest = [...st.saved].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0];
  st.work = latest ? M.snapshot(latest) : M.makeExperiment({ f0: st.refFreq });
  setRecSec(st.recSec);
  setZoom(st.zoomMs);
  setRange(st.range);
  el.fft2.value = String(st.fftSize);
  updateStorageNote();
  renderAll();
  updateRecUi();
  store.loadRecordings().then((r) => {
    if (!alive) return;
    st.storage.recordings = r.ok ? 'stored' : 'memory';
    st.storage.recError = r.error || '';
    for (const rec of r.list) {
      if (st.recordings.some((x) => x.id === rec.id)) continue;
      st.recordings.push({ ...rec, peak: M.peakAbs(rec.samples), stored: true });
    }
    updateStorageNote();
    if (workRec() && !st.work.segment) st.work.segment = M.defaultSegment(workRec().samples.length / workRec().sampleRate);
    const rec = workRec();
    if (rec) st.synthLen = Math.round((rec.samples.length / rec.sampleRate) * 100) / 100;
    el.synthLen.value = String(st.synthLen);
    origSpec = null;
    renderAll();
  });
  const onPageHide = () => { recorder.cancel(); audio.stop(); };
  window.addEventListener('pagehide', onPageHide);

  return {
    element,
    frame,
    get playing() { return audio.playing; },
    stopAudio() { stopAudio(); },
    unmount() {
      alive = false;
      window.removeEventListener('pagehide', onPageHide);
      for (const c of pointerCleanups) c();
      recorder.cancel();
      audio.close();
      for (const v of [overview, zoom, zoom4, spec2, spec4]) v.dispose();
      return { audio: audio.debugInfo(), recorder: { ...recorderCounters } };
    },
    debug() {
      const rec = workRec();
      return {
        work: M.snapshot(st.work),
        dirty: isDirty(),
        saved: st.saved.map(M.snapshot),
        recordings: st.recordings.map((r) => ({ id: r.id, name: r.name, sampleRate: r.sampleRate, length: r.samples.length, peak: r.peak, stored: r.stored, source: r.source })),
        workRecording: rec ? rec.id : null,
        rec: { ...st.rec },
        audio: audio.debugInfo(),
        recorder: { ...recorderCounters, recording: recorder.recording },
        origSpec: origSpec ? { frames: origSpec.frames, padded: origSpec.padded, binHz: origSpec.rel.binHz } : null,
        synthSpec: !!synthSpec,
        storage: { ...st.storage },
        cursors: [...st.cursors], pinned: st.pinned, range: st.range, fftSize: st.fftSize, synthLen: st.synthLen,
      };
    },
    /** For automated checks: the samples of a recording, and a render of the saved recipe. */
    testHooks: {
      recordingSamples: (id) => Array.from(recById(id).samples),
      renderSaved: () => { const s = savedFor(st.work.id); const y = s && synthRender(s); return y && { sampleRate: y.sampleRate, samples: Array.from(y.samples) }; },
      peakAt: (which, freq) => {
        const s = which === 'orig' ? origSpec : synthSpec;
        return s ? M.peakNear(s.rel.db, s.rel.binHz, freq, 3) : null;
      },
    },
  };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function flashMsg(target, text, bad = false) {
  target.replaceChildren(h('span', { class: bad ? 'vl-bad' : '' }, text));
}

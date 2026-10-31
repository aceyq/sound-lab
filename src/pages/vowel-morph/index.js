// Vowel Morph (capstone tasks 3 and 4): record sustained vowels, analyze each
// into a fundamental and 48 harmonic strengths, then blend those numbers
//   • along a slider between two vowels (1D, task 3), or
//   • anywhere in a square of vowel dots (2D, task 4),
// and play ONE new harmonic sound built from the blended numbers.
//
// The recorder, WAV code and automatic analysis are the Frequency Playground
// Vowel Lab's own modules, imported unchanged. Storage is separate
// (morph-store.js), so nothing here touches the other apps' data.
import './vowel-morph.css';
import { h, fmtHz } from '../../lib/dom.js';
import { Tour } from '../../lib/tour.js';
import { MicInput } from '../frequency/mic.js';
import { VowelRecorder } from '../frequency/recorder.js';
import { encodeWav, decodeWav } from '../frequency/wav.js';
import { slug, newId } from '../frequency/vowel-model.js';
import {
  HARMONICS, POWERS, PITCH_MODES, TARGET_RMS,
  emptyProject, loadProject, makeVowel, takeName, isUsable, paramsOf, sliderParams, blendAt, closePairs,
  renderParams, noteName, semitones, strongestHarmonic, makeBackup, parseBackup, clamp01,
} from './morph-model.js';
import { analyzeTake, initialSegment, MIN_TAKE_SEC } from './morph-analysis.js';
import { MorphAudio } from './morph-audio.js';
import { HarmonicBars, TakeWave, COLOR_A, COLOR_B } from './morph-plots.js';
import * as store from './morph-store.js';
import { morphTourSteps } from './morph-tour.js';

const MAX_TAKE_SEC = 4;
const EXPORT_SEC = 3;
const DOT_COLORS = ['#ffb74d', '#4dd0c8', '#c792ea', '#f07178', '#c3e88d', '#82aaff', '#ffcb6b', '#89ddff', '#ff9cac', '#a5d6a7'];
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}

function pct(w) {
  return `${(w * 100).toFixed(w > 0 && w < 0.01 ? 2 : 0)} %`;
}

function hz(f) {
  return Number.isFinite(f) ? `${f.toFixed(1)} Hz` : '—';
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadWav(samples, sampleRate, name) {
  downloadBlob(new Blob([encodeWav(samples, sampleRate).buffer], { type: 'audio/wav' }), name);
}

export function mount(root) {
  // ───────────── state ─────────────
  const loaded = store.readProject();
  const project = loadProject(loaded.data);
  const recs = new Map();
  let storageNote = loaded.ok ? '' : `Could not read saved data: ${loaded.error}`;
  let view = '1d';
  let spaceMode = 'play'; // 'play' | 'edit'
  let dotClick = 'synth'; // 'synth' | 'original'
  let stopOnRelease = false;
  let selectedId = null; // selected dot / vowel in the 2D view
  let placingId = null; // vowel waiting to be placed (Edit mode)
  let playing = null; // what the synth voice belongs to: { what: '1d' | '2d' | 'vowel', id }
  let recordingFor = null; // which take widget is recording
  let recStatus = new Map(); // widget key → message
  const disposers = new Set(); // persistent views
  const transient = new Set(); // views of the panels rebuilt by renderAll()

  const audio = new MorphAudio({ onChange: () => refreshPlayState() });
  const mic = new MicInput({ onChange: () => {} });
  const recorder = new VowelRecorder();

  const vowelById = (id) => project.vowels.find((v) => v.id === id) || null;
  const colorOf = (v) => DOT_COLORS[Math.max(0, project.vowels.indexOf(v)) % DOT_COLORS.length];

  let saveTimer = 0;
  function save(now = false) {
    clearTimeout(saveTimer);
    const run = () => {
      const r = store.writeProject(project);
      storageNote = r.ok ? '' : `Could not save in this browser (${r.error}). Download a backup to keep your work.`;
      storageEl.textContent = storageNote || 'Saved in this browser.';
      storageEl.classList.toggle('vm-bad', !!storageNote);
    };
    saveTimer = 0;
    if (now) run(); else saveTimer = setTimeout(() => { saveTimer = 0; run(); }, 250);
  }

  // ───────────── page frame ─────────────
  const storageEl = h('span', { class: 'vm-storage' }, 'Loading saved vowels…');
  const playPill = h('span', { class: 'status stopped vm-pill', 'aria-live': 'polite' }, 'Silent');
  const stopAll = h('button', { class: 'btn danger', onclick: () => stopSound() }, '■ Stop sound');
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volumeValue), 'aria-label': 'Volume',
    oninput: () => audio.setVolume(Number(volume.value)) });
  const audioMsg = h('div', { class: 'msg' });
  const tourBtn = h('button', { class: 'btn primary', onclick: () => tour.start(0) }, '🧭 Guided tour');
  const backupBtn = h('button', { class: 'btn', onclick: () => exportBackup() }, '⬇ Download backup');
  const importInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr', 'aria-label': 'Import a Vowel Morph backup file', onchange: () => importBackup(importInput) });
  const importBtn = h('button', { class: 'btn', onclick: () => importInput.click() }, '⬆ Import backup');

  const tab1 = h('button', { class: 'btn seg vm-tab', 'aria-pressed': 'true', onclick: () => setView('1d') }, '↔ 1D slider (task 3)');
  const tab2 = h('button', { class: 'btn seg vm-tab', 'aria-pressed': 'false', onclick: () => setView('2d') }, '◻ 2D sound space (task 4)');

  const intro = h('section', { class: 'card vm-intro' },
    h('div', { class: 'vm-steps' },
      h('div', {}, h('b', {}, '1 · Record'), h('span', {}, 'Sing one steady vowel for 2–4 seconds.')),
      h('div', {}, h('b', {}, '2 · Analyze'), h('span', {}, 'The app measures its base frequency (f0) and the strength of each harmonic (f0, 2·f0, 3·f0 …).')),
      h('div', {}, h('b', {}, '3 · Blend'), h('span', {}, 'The slider or the square blends those numbers between vowels.')),
      h('div', {}, h('b', {}, '4 · Synthesize'), h('span', {}, 'New sine waves at the blended values make one new sound: an approximation of your voice, not a copy.'))),
    h('details', { class: 'vm-why' },
      h('summary', {}, 'Why not just crossfade the two recordings?'),
      h('p', {}, 'Crossfading plays both recordings at once, quieter and louder. Halfway you would hear two voices, and if they were sung at different pitches, two pitches. Vowel Morph blends the descriptions instead: one fundamental and one set of harmonic strengths. Halfway you hear a single voice whose pitch and vowel colour are both in between.'),
      h('p', {}, 'Because only f0 and harmonic strengths are kept, the synthesized end points are approximations. They lack the original’s breath, vibrato, small pitch wobbles and timing details. Use “Original” to hear the real recording and “Synthesized” to hear the reconstruction.')));

  const view1 = h('div', { class: 'vm-view', 'data-view': '1d' });
  const view2 = h('div', { class: 'vm-view', 'data-view': '2d', hidden: true });

  root.append(h('div', { class: 'vm-page' },
    h('div', { class: 'page-top' },
      h('div', {},
        h('h1', {}, 'Vowel Morph'),
        h('p', { class: 'lead' }, 'Record vowels, then move between them. Every in-between sound is built from blended pitch and harmonic strengths, not by mixing the recordings.')),
      h('div', { class: 'vm-top-actions' }, tourBtn, h('div', { class: 'row gap wrap' }, backupBtn, importBtn, importInput), storageEl)),
    intro,
    h('div', { class: 'vm-bar card' },
      h('div', { class: 'seg-group', role: 'group', 'aria-label': 'View' }, tab1, tab2),
      h('div', { class: 'row gap wrap vm-bar-right' }, playPill, stopAll,
        h('label', { class: 'row gap vm-vol' }, 'Volume', volume))),
    audioMsg,
    view1, view2));

  // ───────────── recordings & analysis ─────────────
  function recOf(v) {
    return v && v.recordingId ? recs.get(v.recordingId) || null : null;
  }

  async function addTake(rec, name, onCreated) {
    recs.set(rec.id, rec);
    const put = await store.putRecording(rec);
    const v = makeVowel({ name: takeName(name, project.vowels.map((x) => x.name)), recordingId: rec.id });
    Object.assign(v, analyzeTake(rec, initialSegment(rec)));
    project.vowels.push(v);
    if (onCreated) onCreated(v);
    save(true);
    if (!put.ok) {
      storageNote = `The recording could not be stored in this browser (${put.error}). It works until you reload; download a backup to keep it.`;
      storageEl.textContent = storageNote;
      storageEl.classList.add('vm-bad');
    }
    renderAll();
    return v;
  }

  function reanalyze(v, segment, f0Override = null) {
    const rec = recOf(v);
    if (!rec) return;
    Object.assign(v, analyzeTake(rec, segment, f0Override));
    save(true);
    soundChanged();
    renderAll();
  }

  async function deleteVowel(v) {
    const uses = [];
    if (project.pair.a === v.id) uses.push('Vowel A of the slider');
    if (project.pair.b === v.id) uses.push('Vowel B of the slider');
    if (v.pos) uses.push('a dot in the square');
    const msg = `Delete “${v.name}” and its recording from this browser?${uses.length ? `\nIt is used as ${uses.join(' and ')}.` : ''}\nThis cannot be undone (download a backup first if you may need it).`;
    if (!window.confirm(msg)) return;
    if (playing && (playing.id === v.id || playing.what !== 'vowel')) stopSound();
    project.vowels = project.vowels.filter((x) => x !== v);
    if (project.pair.a === v.id) project.pair.a = null;
    if (project.pair.b === v.id) project.pair.b = null;
    if (selectedId === v.id) selectedId = null;
    if (placingId === v.id) placingId = null;
    if (v.recordingId && !project.vowels.some((x) => x.recordingId === v.recordingId)) {
      recs.delete(v.recordingId);
      await store.deleteRecording(v.recordingId);
    }
    save(true);
    renderAll();
  }

  /** Record / import widget. key distinguishes the widgets on the page. */
  function takeWidget(key, { defaultName, onCreated, label }) {
    const name = h('input', { type: 'text', value: defaultName, 'aria-label': `Name for the new recording (${label})`, maxlength: '40', class: 'vm-name-in' });
    const status = h('div', { class: 'vm-rec-status', 'aria-live': 'polite' }, recStatus.get(key) || '');
    const isMe = recordingFor === key;
    const recBtn = h('button', {
      class: `btn ${isMe ? 'danger' : 'vm-rec'}`,
      disabled: !!recordingFor && !isMe,
      onclick: () => (isMe ? recorder.stop() : startTake(key, name.value, onCreated)),
    }, isMe ? '■ Stop recording' : `● Record (up to ${MAX_TAKE_SEC} s)`);
    const file = h('input', { type: 'file', accept: '.wav,audio/wav,audio/x-wav', class: 'sr', 'aria-label': `Import a WAV recording (${label})`,
      onchange: async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        try {
          const d = decodeWav(await f.arrayBuffer());
          if (d.samples.length / d.sampleRate < MIN_TAKE_SEC) throw new Error(`it is shorter than ${MIN_TAKE_SEC} s`);
          recStatus.set(key, `Imported ${f.name}.`);
          await addTake({ id: newId('rec'), name: f.name, sampleRate: d.sampleRate, samples: d.samples, createdAt: new Date().toISOString(), source: 'wav' },
            name.value || f.name.replace(/\.wav$/i, ''), onCreated);
        } catch (e) {
          status.textContent = `Could not import ${f.name}: ${e.message}`;
        }
      } });
    return h('div', { class: 'vm-take' },
      h('div', { class: 'row gap wrap' },
        h('label', { class: 'row gap' }, 'Name', name),
        recBtn,
        h('button', { class: 'btn', disabled: !!recordingFor, onclick: () => file.click() }, '⬆ Import WAV'), file),
      status);
  }

  async function startTake(key, nameText, onCreated) {
    stopSound();
    recordingFor = key;
    recStatus.set(key, 'Asking for the microphone…');
    renderAll();
    await mic.start();
    if (!mic.listening) {
      const err = mic.error;
      recordingFor = null;
      recStatus.set(key, err ? `${err.title}. ${err.message.replace(/Enable Microphone/g, 'Record')}` : 'The microphone did not start.');
      renderAll();
      return;
    }
    recStatus.set(key, 'Recording… sing one steady vowel.');
    renderAll();
    const el = () => root.querySelector(`[data-take="${key}"] .vm-rec-status`);
    const result = await recorder.start(mic, MAX_TAKE_SEC, {
      onProgress: (sec) => { const s = el(); if (s) s.textContent = `Recording… ${sec.toFixed(1)} s of up to ${MAX_TAKE_SEC} s. Sing one steady vowel.`; },
    });
    mic.stop();
    recordingFor = null;
    if (result.reason === 'cancelled') return;
    const sec = result.samples.length / result.sampleRate;
    if (result.error) {
      recStatus.set(key, `Recording failed: ${result.error}`);
      renderAll();
      return;
    }
    if (sec < MIN_TAKE_SEC) {
      recStatus.set(key, `That take was only ${sec.toFixed(2)} s, too short to analyze, so it was not kept. Record again for 2–4 s.`);
      renderAll();
      return;
    }
    recStatus.set(key, `Recorded ${sec.toFixed(1)} s${result.reason === 'mic-stopped' ? ' (the microphone stopped early)' : ''}. Earlier takes are kept in the list.`);
    await addTake({ id: newId('rec'), name: `${nameText || 'vowel'} take`, sampleRate: result.sampleRate, samples: result.samples, createdAt: new Date().toISOString(), source: 'microphone' },
      nameText, onCreated);
  }

  // ───────────── playback ─────────────
  function stopSound() {
    playing = null;
    audio.stop();
    refreshPlayState();
  }

  function playOriginal(v, part = 'all') {
    const rec = recOf(v);
    if (!rec) return;
    playing = null;
    const seg = v.segment || initialSegment(rec);
    const s = Math.round(seg.start * rec.sampleRate);
    const e = Math.round(seg.end * rec.sampleRate);
    audio.playOriginal(rec, {
      from: part === 'section' ? s : 0, to: part === 'section' ? e : rec.samples.length,
      levelFrom: s, levelTo: e, vowelId: v.id, label: `ORIGINAL recording of ${v.name}${part === 'section' ? ' (analyzed section)' : ''}`,
    });
  }

  function playVowelSynth(v) {
    const p = paramsOf(v);
    if (!p) return;
    if (audio.playSynth(p, `SYNTHESIZED ${v.name}`)) playing = { what: 'vowel', id: v.id };
    refreshPlayState();
  }

  function soundChanged() {
    if (!playing || audio.kind !== 'synth') return;
    if (playing.what === '1d') {
      const p = currentSliderParams();
      if (p) audio.update(p, sliderLabel()); else stopSound();
    } else if (playing.what === '2d') {
      const b = currentBlend();
      if (b.params) audio.update(b.params, spaceLabel()); else stopSound();
    } else if (playing.what === 'vowel') {
      const p = paramsOf(vowelById(playing.id));
      if (p) audio.update(p); else stopSound();
    }
  }

  function refreshPlayState() {
    const k = audio.kind;
    if (k === 'idle') playing = null;
    playPill.textContent = k === 'idle' ? 'Silent' : `Playing: ${audio.label}`;
    playPill.className = `status vm-pill ${k === 'idle' ? 'stopped' : k === 'original' ? 'vm-orig' : 'playing'}`;
    stopAll.disabled = k === 'idle';
    audioMsg.textContent = audio.error ? `Sound could not play: ${audio.error}` : '';
    for (const b of root.querySelectorAll('[data-play-what]')) {
      const on = playing && playing.what === b.dataset.playWhat;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // ───────────── vowel panel (shared by both views) ─────────────
  function analysisLine(v) {
    const a = v.analysis;
    if (!a) return h('div', { class: 'vm-sum vm-sum-bad' }, 'Not analyzed yet.');
    if (!isUsable(v)) {
      return h('div', { class: 'vm-sum vm-sum-bad' },
        h('b', {}, 'Not usable: '), a.problems[0] || 'no clear pitch or harmonics were found in the selected section.');
    }
    const f = a.facts || {};
    const tag = a.f0Source === 'manual'
      ? h('span', { class: 'vm-tag vm-manual', title: 'You typed this fundamental; the harmonics were measured again at its multiples.' }, `MANUAL f0${a.f0Auto ? ` (automatic was ${a.f0Auto} Hz)` : ''}`)
      : h('span', { class: 'vm-tag' }, 'automatic');
    return h('div', { class: 'vm-sum' },
      h('div', {}, h('b', {}, `f0 ${fmtHz(a.f0)}`), ` ${noteName(a.f0)} `, tag,
        a.status === 'warning' ? h('span', { class: 'vm-tag vm-warn' }, 'check warnings') : null),
      h('div', { class: 'muted' },
        `${(f.harmonicsKept || []).length} harmonics measured · section ${f.sectionSec ? `${f.sectionSec[0].toFixed(2)}–${f.sectionSec[1].toFixed(2)} s` : '—'} · ${f.framesPeriodic ?? '—'}/${f.framesTotal ?? '—'} frames steady${f.pitchSpreadCents != null ? ` · pitch spread ${f.pitchSpreadCents}¢` : ''} · strongest harmonic ${strongestHarmonic(a.amps) || '—'}`));
  }

  function vowelPanel(v, { role = '', allowDelete = true, extra = null } = {}) {
    const rec = recOf(v);
    const usable = isUsable(v);
    const nameIn = h('input', { type: 'text', value: v.name, maxlength: '40', class: 'vm-name-in', 'aria-label': `Rename ${v.name}`,
      onchange: () => {
        const t = nameIn.value.trim();
        if (!t) { nameIn.value = v.name; return; }
        v.name = t;
        save(true);
        renderAll();
      } });
    const msgs = v.analysis ? [
      ...(usable ? [] : v.analysis.problems.slice(1)).map((m) => h('li', { class: 'vm-problem' }, m)),
      ...v.analysis.warnings.map((m) => h('li', { class: 'vm-warning' }, m)),
    ] : [];

    // Adjust analysis (collapsed by default)
    const wave = h('canvas', { class: 'vm-wave', 'aria-label': `Waveform of ${v.name}; drag across it to choose the section to analyze` });
    const seg = v.segment || (rec ? initialSegment(rec) : { start: 0, end: 0 });
    const sIn = h('input', { type: 'text', class: 'num small', value: seg.start.toFixed(2), 'aria-label': `Section start in seconds (${v.name})` });
    const eIn = h('input', { type: 'text', class: 'num small', value: seg.end.toFixed(2), 'aria-label': `Section end in seconds (${v.name})` });
    const f0In = h('input', { type: 'text', class: 'num small', value: v.analysis && v.analysis.f0 ? String(v.analysis.f0) : '', 'aria-label': `Corrected fundamental in Hz (${v.name})`, placeholder: 'Hz' });
    const adjMsg = h('div', { class: 'msg' });
    const readSeg = () => {
      const s = Number(sIn.value);
      const e = Number(eIn.value);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e - s < 0.1) { adjMsg.textContent = 'Type a start and an end in seconds, at least 0.1 s apart.'; return null; }
      return { start: s, end: e };
    };
    const details = h('details', { class: 'vm-adjust', open: openDetails.has(v.id) || null,
      ontoggle: () => { if (details.open) openDetails.add(v.id); else openDetails.delete(v.id); } },
      h('summary', {}, 'Adjust analysis · downloads · delete'),
      rec ? h('div', {},
        wave,
        h('p', { class: 'help' }, 'Drag across the waveform to choose a steady part (the shaded section), or type it. The analysis uses only that section.'),
        h('div', { class: 'row gap wrap' },
          h('label', { class: 'row gap' }, 'From', sIn, 's'), h('label', { class: 'row gap' }, 'to', eIn, 's'),
          h('button', { class: 'btn small', onclick: () => { const s = readSeg(); if (s) reanalyze(v, s); } }, '🔍 Analyze this section'),
          h('button', { class: 'btn small', onclick: () => playOriginal(v, 'section') }, '▶ Section only')),
        h('div', { class: 'row gap wrap vm-f0fix' },
          h('label', { class: 'row gap' }, 'Fundamental is really', f0In, 'Hz'),
          h('button', { class: 'btn small', onclick: () => {
            const f = Number(f0In.value);
            if (!(f >= 50 && f <= 1000)) { adjMsg.textContent = 'Type a fundamental from 50 to 1000 Hz.'; return; }
            reanalyze(v, v.segment, f);
          } }, 'Re-measure at this f0'),
          v.analysis && v.analysis.f0Source === 'manual' ? h('button', { class: 'btn small', onclick: () => reanalyze(v, v.segment) }, 'Back to automatic') : null),
        h('p', { class: 'help' }, 'Use this if the automatic f0 is wrong (for example an octave off). The harmonics are then measured again at its multiples, and the result is labelled MANUAL.'),
        adjMsg) : h('p', { class: 'help' }, 'This vowel has no recording in this browser (it was restored from analyzed values only).'),
      h('div', { class: 'row gap wrap vm-dl' },
        h('button', { class: 'btn small', disabled: !rec, onclick: () => downloadWav(rec.samples, rec.sampleRate, `${slug(v.name)}_original.wav`) }, '⬇ Original WAV'),
        h('button', { class: 'btn small', disabled: !usable, onclick: () => downloadWav(renderParams(paramsOf(v), { duration: EXPORT_SEC }), 48000, `${slug(v.name)}_synthesized.wav`) }, '⬇ Synthesized WAV'),
        allowDelete ? h('button', { class: 'btn small danger', onclick: () => deleteVowel(v) }, '🗑 Delete vowel') : null));
    if (rec) {
      const tw = new TakeWave(wave, { onSelect: (s) => { sIn.value = s.start.toFixed(2); eIn.value = s.end.toFixed(2); reanalyze(v, s); } });
      tw.set(rec, seg);
      transient.add(() => tw.dispose());
    }
    return h('div', { class: 'vm-vowel', 'data-vowel': v.id },
      h('div', { class: 'row gap wrap vm-vowel-head' },
        role ? h('span', { class: 'vm-role' }, role) : null,
        nameIn,
        h('button', { class: 'btn small vm-orig-btn', disabled: !rec, onclick: () => playOriginal(v) }, '▶ Original'),
        h('button', { class: 'btn small vm-synth-btn', disabled: !usable, onclick: () => playVowelSynth(v) }, '▶ Synthesized'),
        extra),
      analysisLine(v),
      msgs.length ? h('ul', { class: 'vm-msgs' }, msgs) : null,
      details);
  }
  const openDetails = new Set();

  // ───────────── 1D view ─────────────
  const slider = h('input', { type: 'range', min: '0', max: '1000', step: '1', value: String(Math.round(project.slider * 1000)), class: 'vm-slider', 'aria-label': 'Position between Vowel A (left) and Vowel B (right)',
    oninput: () => {
      project.slider = Number(slider.value) / 1000;
      updateMorph();
      save();
    } });
  const morphPlay = h('button', { class: 'btn primary big', 'data-play-what': '1d', onclick: () => {
    const p = currentSliderParams();
    if (p && audio.playSynth(p, sliderLabel())) playing = { what: '1d' };
    refreshPlayState();
  } }, '▶ Play blend');
  const morphStop = h('button', { class: 'btn big', onclick: () => stopSound() }, '■ Stop');
  const pitchSel = h('select', { 'aria-label': 'Pitch rule', onchange: () => { project.pitchMode = pitchSel.value; updateMorph(); save(); } },
    PITCH_MODES.map((m) => h('option', { value: m.id, selected: project.pitchMode === m.id || null }, m.name)));
  const posOut = h('div', { class: 'vm-pos' });
  const f0Out = h('div', { class: 'vm-f0' });
  const mathOut = h('div', { class: 'vm-math' });
  const morphMsg = h('div', { class: 'note' });
  const bars1Canvas = h('canvas', { class: 'vm-bars', 'aria-label': 'Harmonic strengths of the current sound (bars) with Vowel A and Vowel B marked' });
  const bars1 = new HarmonicBars(bars1Canvas);
  const labelA = h('span', { class: 'vm-end vm-end-a' }, 'A');
  const labelB = h('span', { class: 'vm-end vm-end-b' }, 'B');
  const dl1 = h('button', { class: 'btn small', onclick: () => {
    const p = currentSliderParams();
    if (p) downloadWav(renderParams(p, { duration: EXPORT_SEC }), 48000, `vowel-morph_slider_${Math.round(project.slider * 100).toString().padStart(3, '0')}.wav`);
  } }, '⬇ Download this blend (WAV)');
  const slotsEl = h('div', { class: 'vm-slots' });
  const morphCard = h('section', { class: 'card vm-morph' },
    h('h2', {}, 'Slider between A and B'),
    h('div', { class: 'vm-slider-row' }, labelA, slider, labelB),
    posOut,
    h('div', { class: 'row gap wrap' }, morphPlay, morphStop,
      h('label', { class: 'row gap' }, 'Pitch', pitchSel), dl1),
    morphMsg,
    h('div', { class: 'vm-readout' }, f0Out, mathOut),
    bars1Canvas,
    h('p', { class: 'help' }, h('span', { style: { color: COLOR_A } }, '▬ A'), '  ', h('span', { style: { color: COLOR_B } }, '▬ B'), '  ticks = the two vowels; bars = the sound you hear now, in dB (0 dB = an analyzed vowel’s strongest harmonic), harmonic number below.'));
  view1.append(slotsEl, morphCard);
  disposers.add(() => bars1.dispose());

  function pairVowels() {
    return [vowelById(project.pair.a), vowelById(project.pair.b)];
  }

  function currentSliderParams() {
    const [a, b] = pairVowels();
    const A = paramsOf(a);
    const B = paramsOf(b);
    if (!A || !B) return null;
    return sliderParams(A, B, project.slider, project.pitchMode);
  }

  function sliderLabel() {
    return `SYNTHESIZED blend at ${project.slider.toFixed(2)} (A → B)`;
  }

  function renderSlots() {
    slotsEl.replaceChildren();
    for (const side of ['a', 'b']) {
      const v = vowelById(project.pair[side]);
      const other = vowelById(project.pair[side === 'a' ? 'b' : 'a']);
      const sel = h('select', { 'aria-label': `Choose Vowel ${side.toUpperCase()}`, onchange: () => { project.pair[side] = sel.value || null; save(); soundChanged(); renderAll(); } },
        h('option', { value: '' }, '— choose a recorded vowel —'),
        project.vowels.map((x) => h('option', { value: x.id, selected: x === v || null }, `${x.name}${isUsable(x) ? '' : ' (not usable)'}`)));
      const key = `slot-${side}`;
      const card = h('section', { class: `card vm-slot vm-slot-${side}`, 'data-slot': side },
        h('h2', {}, h('span', { class: `vm-badge vm-badge-${side}` }, side.toUpperCase()), ` Vowel ${side.toUpperCase()}`, h('span', { class: 'muted vm-slot-sub' }, side === 'a' ? ' (slider left end)' : ' (slider right end)')),
        h('div', { class: 'row gap wrap' }, h('label', { class: 'row gap' }, 'Use', sel)),
        h('div', { class: 'vm-take-wrap', 'data-take': key },
          h('div', { class: 'vm-take-title' }, v ? 'Record another take (the current one stays in the list):' : 'Record or import this vowel:'),
          takeWidget(key, {
            label: `Vowel ${side.toUpperCase()}`,
            defaultName: v ? v.name.replace(/ \(take \d+\)$/, '') : side === 'a' ? 'Aa' : 'Oo',
            onCreated: (nv) => { project.pair[side] = nv.id; },
          })),
        v ? vowelPanel(v, { role: '' }) : h('p', { class: 'help' }, 'No vowel chosen yet.'),
        v && other && v.id === other.id ? h('div', { class: 'note' }, 'A and B are the same vowel, so the slider will not change anything.') : null);
      slotsEl.append(card);
    }
  }

  function updateMorph() {
    const [a, b] = pairVowels();
    const A = paramsOf(a);
    const B = paramsOf(b);
    const t = project.slider;
    slider.value = String(Math.round(t * 1000));
    labelA.textContent = a ? `A · ${a.name}` : 'A';
    labelB.textContent = b ? `B · ${b.name}` : 'B';
    posOut.textContent = `Position ${t.toFixed(3)}: weight A ${pct(1 - t)}, weight B ${pct(t)}`;
    const ready = A && B;
    morphPlay.disabled = !ready;
    dl1.disabled = !ready;
    if (!ready) {
      const missing = [!a ? 'choose or record Vowel A' : !A ? 'Vowel A has no usable analysis' : null, !b ? 'choose or record Vowel B' : !B ? 'Vowel B has no usable analysis' : null].filter(Boolean);
      morphMsg.textContent = `To use the slider: ${missing.join('; ')}.`;
      f0Out.textContent = '';
      mathOut.textContent = '';
      bars1.set({ amps: null, empty: 'Needs two analyzed vowels' });
      if (playing && playing.what === '1d') stopSound();
      return;
    }
    const p = sliderParams(A, B, t, project.pitchMode);
    const st = semitones(A.f0, B.f0);
    morphMsg.textContent = project.pitchMode !== 'blend'
      ? `Pitch is held at ${project.pitchMode === 'a' ? 'A' : 'B'}’s ${hz(p.f0)}: only the harmonic strengths (the vowel colour) change. In this mode the ${project.pitchMode === 'a' ? 'B' : 'A'} end is not B’s exact sound.`
      : Math.abs(st) < 0.3 ? 'A and B have almost the same fundamental, so the pitch stays steady and you hear mostly the vowel colour change.' : '';
    f0Out.replaceChildren(h('span', { class: 'muted' }, 'Fundamental now '), h('b', {}, hz(p.f0)), ` ${noteName(p.f0)}`);
    mathOut.textContent = project.pitchMode === 'blend'
      ? `A ${hz(A.f0)} → B ${hz(B.f0)} (${st >= 0 ? '+' : ''}${st.toFixed(2)} semitones). Now ${(t * st).toFixed(2)} semitones from A: ${A.f0.toFixed(1)}^${(1 - t).toFixed(2)} × ${B.f0.toFixed(1)}^${t.toFixed(2)} = ${p.f0.toFixed(1)} Hz.`
      : '';
    bars1.set({ amps: p.amps, overlays: [{ amps: A.amps, color: COLOR_A }, { amps: B.amps, color: COLOR_B }] });
    if (playing && playing.what === '1d') audio.update(p, sliderLabel());
  }

  // ───────────── 2D view ─────────────
  const square = svg('svg', { viewBox: '0 0 1000 1000', class: 'vm-square', role: 'application', 'aria-label': 'Sound space square. In Play mode, click or drag to hear the blend at that point. In Edit mode, drag dots to move them.' });
  const gGrid = svg('g', { class: 'vm-grid' });
  for (let i = 1; i < 4; i++) {
    gGrid.append(svg('line', { x1: i * 250, y1: 0, x2: i * 250, y2: 1000 }), svg('line', { x1: 0, y1: i * 250, x2: 1000, y2: i * 250 }));
  }
  const gLines = svg('g', { class: 'vm-lines' });
  const gDots = svg('g', { class: 'vm-dots' });
  const cursor = svg('g', { class: 'vm-cursor' }, svg('circle', { r: 16 }), svg('line', { x1: -28, y1: 0, x2: 28, y2: 0 }), svg('line', { x1: 0, y1: -28, x2: 0, y2: 28 }));
  square.append(gGrid, gLines, gDots, cursor);
  const squareHint = h('div', { class: 'vm-square-hint' });
  const playModeBtn = h('button', { class: 'btn seg', onclick: () => setSpaceMode('play') }, '🔊 Play / explore');
  const editModeBtn = h('button', { class: 'btn seg', onclick: () => setSpaceMode('edit') }, '✋ Edit / place dots');
  const powerSel = h('select', { 'aria-label': 'Distance influence', onchange: () => { project.space.power = Number(powerSel.value); updateSpace(); save(); } },
    POWERS.map((x) => h('option', { value: String(x.p), selected: project.space.power === x.p || null }, `${x.name} (power ${x.p})`)));
  const powerHelp = h('div', { class: 'help' });
  const dotClickSel = h('div', { class: 'vm-radio', role: 'radiogroup', 'aria-label': 'What tapping a dot does in Play mode' });
  const releaseChk = h('input', { type: 'checkbox', checked: stopOnRelease, onchange: () => { stopOnRelease = releaseChk.checked; } });
  const play2 = h('button', { class: 'btn primary', 'data-play-what': '2d', onclick: () => startSpaceSound() }, '▶ Play at marker');
  const stop2 = h('button', { class: 'btn', onclick: () => stopSound() }, '■ Stop');
  const dl2 = h('button', { class: 'btn small', onclick: () => {
    const b = currentBlend();
    const pt = project.space.point;
    if (b.params) downloadWav(renderParams(b.params, { duration: EXPORT_SEC }), 48000, `vowel-morph_space_x${Math.round(pt.x * 100)}_y${Math.round(pt.y * 100)}.wav`);
  } }, '⬇ Download sound at marker (WAV)');
  const spacePos = h('div', { class: 'vm-pos' });
  const spaceF0 = h('div', { class: 'vm-f0' });
  const spaceMsg = h('div', { class: 'note' });
  const weightsEl = h('div', { class: 'vm-weights', 'aria-live': 'off' });
  const bars2Canvas = h('canvas', { class: 'vm-bars', 'aria-label': 'Harmonic strengths of the sound at the marker' });
  const bars2 = new HarmonicBars(bars2Canvas);
  disposers.add(() => bars2.dispose());
  const listEl = h('div', { class: 'vm-list' });
  const selectedEl = h('div', { class: 'vm-selected' });
  const spaceControls = h('section', { class: 'card vm-space-controls' },
    h('div', { class: 'seg-group vm-modes', role: 'group', 'aria-label': 'Square mode' }, playModeBtn, editModeBtn),
    squareHint,
    h('div', { class: 'vm-play-only' },
      h('div', { class: 'row gap wrap' }, play2, stop2, h('label', { class: 'check' }, releaseChk, 'Stop when I let go')),
      h('div', { class: 'vm-sub' }, 'Tapping a dot plays:'), dotClickSel,
      h('p', { class: 'help' }, 'While you drag, you always hear the synthesized blend. The app never switches to a raw recording in the middle of a drag, because that would jump abruptly to a different kind of sound.')),
    h('div', { class: 'field' }, h('label', {}, 'Distance influence '), powerSel, powerHelp),
    spacePos, spaceF0, spaceMsg, weightsEl, bars2Canvas,
    h('div', { class: 'row gap wrap' }, dl2));
  view2.append(h('div', { class: 'vm-space' },
    h('div', { class: 'vm-square-col' }, h('div', { class: 'vm-square-wrap' }, square), h('div', { class: 'vm-axes muted' }, 'Positions run from (0, 0) at the bottom left to (1, 1) at the top right. Axes have no fixed meaning: arrange the vowels however you like.')),
    spaceControls),
  h('section', { class: 'card vm-library' },
    h('h2', {}, 'Vowels in this project'),
    h('p', { class: 'help' }, 'Every recorded vowel is listed here, including the slider’s A and B. Put any of them in the square, as many as you like.'),
    listEl,
    h('div', { class: 'vm-take-wrap', 'data-take': 'space' }, h('div', { class: 'vm-take-title' }, 'Record or import a new vowel:'),
      h('div', { class: 'vm-take-slot' }))),
  selectedEl);

  function setSpaceMode(m) {
    spaceMode = m;
    if (m === 'edit' && playing && playing.what === '2d') stopSound();
    if (m === 'play') placingId = null;
    renderSpace();
  }

  function placedVowels() {
    return project.vowels.filter((v) => v.pos);
  }

  function currentBlend() {
    return blendAt(project.vowels, project.space.point, project.space.power);
  }

  function spaceLabel() {
    const pt = project.space.point;
    return `SYNTHESIZED blend at (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`;
  }

  function startSpaceSound() {
    const b = currentBlend();
    if (!b.params) { updateSpace(); return false; }
    if (audio.playSynth(b.params, spaceLabel())) playing = { what: '2d' };
    refreshPlayState();
    return true;
  }

  const toSvg = (p) => ({ x: p.x * 1000, y: (1 - p.y) * 1000 });

  function renderSpace() {
    playModeBtn.setAttribute('aria-pressed', spaceMode === 'play' ? 'true' : 'false');
    editModeBtn.setAttribute('aria-pressed', spaceMode === 'edit' ? 'true' : 'false');
    square.dataset.mode = spaceMode;
    spaceControls.dataset.mode = spaceMode;
    const placing = vowelById(placingId);
    squareHint.textContent = spaceMode === 'play'
      ? 'Play mode: click or drag inside the square to hear the blend there. Dots do not move in this mode.'
      : placing ? `Edit mode: click in the square where “${placing.name}” should go.` : 'Edit mode: drag a dot to move it, tap a dot to select it, or choose “Place” in the list below. No sound plays while you edit.';
    powerHelp.textContent = (POWERS.find((x) => x.p === project.space.power) || POWERS[1]).describe;
    dotClickSel.replaceChildren(...[['synth', 'its SYNTHESIZED sound (the marker jumps onto the dot: exact analyzed values)'], ['original', 'its ORIGINAL recording (a one-off preview; drag again to go back to blending)']].map(([id, text]) =>
      h('label', { class: 'check' }, h('input', { type: 'radio', name: 'vm-dotclick', value: id, checked: dotClick === id, onchange: () => { dotClick = id; } }), text)));

    // dots
    gDots.replaceChildren();
    for (const v of placedVowels()) {
      const p = toSvg(v.pos);
      const usable = isUsable(v);
      const g = svg('g', { class: `vm-dot${v.id === selectedId ? ' selected' : ''}${usable ? '' : ' unusable'}`, transform: `translate(${p.x} ${p.y})`, 'data-id': v.id },
        svg('circle', { class: 'ring', r: 30 }),
        svg('circle', { class: 'core', r: 20, fill: colorOf(v) }),
        svg('text', { y: -38, 'text-anchor': 'middle' }, v.name + (usable ? '' : ' (not usable)')));
      gDots.append(g);
    }
    // list
    listEl.replaceChildren(...(project.vowels.length ? project.vowels.map((v) => {
      const roles = [project.pair.a === v.id ? 'slider A' : null, project.pair.b === v.id ? 'slider B' : null].filter(Boolean);
      return h('div', { class: `vm-row${v.id === selectedId ? ' selected' : ''}` },
        h('span', { class: 'vm-swatch', style: { background: colorOf(v) } }),
        h('button', { class: 'btn small vm-row-name', onclick: () => { selectedId = v.id; renderSpace(); } }, v.name),
        h('span', { class: 'muted vm-row-info' }, [isUsable(v) ? fmtHz(v.analysis.f0) : 'not usable', v.pos ? `at (${v.pos.x.toFixed(2)}, ${v.pos.y.toFixed(2)})` : 'not in square', ...roles].join(' · ')),
        h('button', { class: 'btn small vm-orig-btn', disabled: !recOf(v), onclick: () => playOriginal(v) }, '▶ Original'),
        h('button', { class: 'btn small vm-synth-btn', disabled: !isUsable(v), onclick: () => playVowelSynth(v) }, '▶ Synthesized'),
        v.pos
          ? h('button', { class: 'btn small', onclick: () => { v.pos = null; save(); soundChanged(); renderAll(); } }, 'Remove from square')
          : h('button', { class: 'btn small', disabled: !isUsable(v), title: isUsable(v) ? '' : 'Analyze it successfully first', onclick: () => { placingId = v.id; selectedId = v.id; spaceMode = 'edit'; renderSpace(); } }, placingId === v.id ? 'Click in the square…' : 'Place in square'));
    }) : [h('p', { class: 'help' }, 'No vowels yet. Record one below, or in the 1D slider view.')]));
    const slot = view2.querySelector('.vm-take-slot');
    slot.replaceChildren(takeWidget('space', {
      label: 'new vowel for the square',
      defaultName: `Vowel ${project.vowels.length + 1}`,
      onCreated: (nv) => { selectedId = nv.id; if (isUsable(nv)) { placingId = nv.id; spaceMode = 'edit'; } },
    }));
    // selected vowel
    const sel = vowelById(selectedId);
    selectedEl.replaceChildren();
    if (sel) {
      const xIn = h('input', { type: 'text', class: 'num small', value: sel.pos ? sel.pos.x.toFixed(2) : '', 'aria-label': `x position of ${sel.name}` });
      const yIn = h('input', { type: 'text', class: 'num small', value: sel.pos ? sel.pos.y.toFixed(2) : '', 'aria-label': `y position of ${sel.name}` });
      const posRow = h('div', { class: 'row gap wrap' },
        h('span', { class: 'muted' }, 'Position'), h('label', { class: 'row gap' }, 'x', xIn), h('label', { class: 'row gap' }, 'y', yIn),
        h('button', { class: 'btn small', disabled: !isUsable(sel), onclick: () => {
          const x = Number(xIn.value); const y = Number(yIn.value);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          sel.pos = { x: clamp01(x), y: clamp01(y) };
          save(); soundChanged(); renderAll();
        } }, sel.pos ? 'Move' : 'Place here'));
      selectedEl.append(h('section', { class: 'card vm-sel-card' },
        h('h2', {}, h('span', { class: 'vm-swatch', style: { background: colorOf(sel) } }), ` Selected: ${sel.name}`),
        vowelPanel(sel, { extra: null }), posRow));
    }
    updateSpace();
  }

  function updateSpace() {
    const pt = project.space.point;
    const c = toSvg(pt);
    cursor.setAttribute('transform', `translate(${c.x} ${c.y})`);
    const b = currentBlend();
    const placed = placedVowels();
    spacePos.textContent = `Marker at x ${pt.x.toFixed(3)}, y ${pt.y.toFixed(3)}`;
    play2.disabled = !b.params;
    dl2.disabled = !b.params;
    const warnings = [];
    if (b.message) warnings.push(b.message);
    const exact = b.status === 'blend' && b.contributions.find((x) => x.weight === 1);
    if (exact) warnings.push(`The marker is exactly on ${exact.vowel.name}: you hear its analyzed values exactly (100 %).`);
    const unusable = placed.filter((v) => !isUsable(v));
    if (unusable.length) warnings.push(`Not used (no usable analysis): ${unusable.map((v) => v.name).join(', ')}.`);
    const usablePlaced = b.contributions.map((x) => x.vowel);
    const close = closePairs(usablePlaced.map((v) => v.pos));
    if (close.length) warnings.push(`Nearly on top of each other: ${close.map(([i, j]) => `${usablePlaced[i].name} and ${usablePlaced[j].name}`).join('; ')}. The blend changes very quickly between them; dots on exactly the same spot share that spot equally.`);
    spaceMsg.textContent = warnings.join(' ');
    gLines.replaceChildren();
    if (!b.params) {
      spaceF0.textContent = '';
      weightsEl.replaceChildren();
      bars2.set({ amps: null, empty: placed.length ? 'No usable vowel in the square' : 'No vowels in the square yet' });
      if (playing && playing.what === '2d') stopSound();
      return;
    }
    for (const { vowel, weight } of b.contributions) {
      const p = toSvg(vowel.pos);
      gLines.append(svg('line', { x1: c.x, y1: c.y, x2: p.x, y2: p.y, stroke: colorOf(vowel), 'stroke-width': 2 + 14 * weight, 'stroke-opacity': 0.15 + 0.75 * weight }));
    }
    spaceF0.replaceChildren(h('span', { class: 'muted' }, 'Fundamental now '), h('b', {}, hz(b.params.f0)), ` ${noteName(b.params.f0)}`);
    const sorted = [...b.contributions].sort((x, y) => y.weight - x.weight);
    weightsEl.replaceChildren(h('div', { class: 'vm-sub' }, 'How much each vowel contributes here (sums to 100 %):'),
      ...sorted.map(({ vowel, weight }) => h('div', { class: 'vm-wrow' },
        h('span', { class: 'vm-wname' }, h('span', { class: 'vm-swatch', style: { background: colorOf(vowel) } }), vowel.name),
        h('span', { class: 'vm-wbar' }, h('span', { style: { width: `${weight * 100}%`, background: colorOf(vowel) } })),
        h('span', { class: 'vm-wval' }, pct(weight)))));
    bars2.set({ amps: b.params.amps });
    if (playing && playing.what === '2d') audio.update(b.params, spaceLabel());
  }

  // pointer handling on the square
  let drag = null; // { kind: 'move-dot' | 'play', id, pointerId }
  function pointFromEvent(e) {
    const r = square.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height), r };
  }
  function hitDot(p) {
    const tol = 26 / p.r.width; // about 26 px, comfortable for a finger
    let best = null;
    let bestD = Infinity;
    for (const v of placedVowels()) {
      const d = Math.hypot((v.pos.x - p.x) * p.r.width, (v.pos.y - p.y) * p.r.height) / p.r.width;
      if (d <= tol && d < bestD) { best = v; bestD = d; }
    }
    return best;
  }
  square.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    const hit = hitDot(p);
    if (spaceMode === 'edit') {
      if (placingId) {
        const v = vowelById(placingId);
        placingId = null;
        if (v) { v.pos = { x: p.x, y: p.y }; selectedId = v.id; save(); renderAll(); }
        return;
      }
      if (hit) {
        selectedId = hit.id;
        drag = { kind: 'move-dot', id: hit.id, pointerId: e.pointerId };
        square.setPointerCapture(e.pointerId);
        renderSpace();
      } else if (selectedId) {
        selectedId = null;
        renderSpace();
      }
      return;
    }
    // Play mode
    if (hit && dotClick === 'original' && recOf(hit)) {
      playOriginal(hit);
      return;
    }
    project.space.point = hit && isUsable(hit) ? { ...hit.pos } : { x: p.x, y: p.y };
    drag = { kind: 'play', pointerId: e.pointerId };
    square.setPointerCapture(e.pointerId);
    if (!(playing && playing.what === '2d' && audio.kind === 'synth')) startSpaceSound();
    updateSpace();
  });
  square.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = pointFromEvent(e);
    if (drag.kind === 'move-dot') {
      const v = vowelById(drag.id);
      if (!v) return;
      v.pos = { x: p.x, y: p.y };
      const g = gDots.querySelector(`[data-id="${v.id}"]`);
      const s = toSvg(v.pos);
      if (g) g.setAttribute('transform', `translate(${s.x} ${s.y})`);
      updateSpace();
    } else {
      project.space.point = { x: p.x, y: p.y };
      updateSpace();
    }
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    save();
    if (d.kind === 'move-dot') renderAll();
    else if (stopOnRelease) stopSound();
  };
  square.addEventListener('pointerup', endDrag);
  square.addEventListener('pointercancel', endDrag);

  // ───────────── backup ─────────────
  function exportBackup() {
    const doc = makeBackup(project, [...recs.values()]);
    const missing = project.vowels.filter((v) => v.recordingId && !recs.has(v.recordingId));
    downloadBlob(new Blob([JSON.stringify(doc)], { type: 'application/json' }), `vowel-morph-backup_${new Date().toISOString().slice(0, 10)}.json`);
    if (missing.length) window.alert(`Backup saved, but these vowels have no recording in this browser, so only their analyzed values are in it: ${missing.map((v) => v.name).join(', ')}.`);
  }

  async function importBackup(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    let doc;
    try {
      doc = JSON.parse(await f.text());
    } catch {
      window.alert(`${f.name} is not a JSON file.`);
      return;
    }
    const r = parseBackup(doc, project.vowels.map((v) => v.name));
    if (!r.ok) { window.alert(r.error); return; }
    const placed = r.vowels.filter((v) => v.pos).length;
    if (!window.confirm(`Add ${r.vowels.length} vowel(s) and ${r.recordings.length} recording(s) from ${f.name}?\n${placed} of them have dot positions in the square.\nYour ${project.vowels.length} existing vowel(s) are kept; nothing is replaced or deleted.`)) return;
    for (const rec of r.recordings) {
      recs.set(rec.id, rec);
      const put = await store.putRecording(rec);
      if (!put.ok) r.warnings.push(`Recording ${rec.name} could not be stored in this browser (${put.error}); it works until you reload.`);
    }
    project.vowels.push(...r.vowels);
    if ((r.pair.a || r.pair.b) && window.confirm(`Also use the backup’s slider pair (A: ${vowelById(r.pair.a)?.name || '—'}, B: ${vowelById(r.pair.b)?.name || '—'}) instead of your current one?`)) {
      project.pair = { a: r.pair.a || project.pair.a, b: r.pair.b || project.pair.b };
    }
    save(true);
    renderAll();
    if (r.warnings.length) window.alert(r.warnings.join('\n'));
  }

  // ───────────── views ─────────────
  function setView(v) {
    view = v;
    tab1.setAttribute('aria-pressed', v === '1d' ? 'true' : 'false');
    tab2.setAttribute('aria-pressed', v === '2d' ? 'true' : 'false');
    view1.hidden = v !== '1d';
    view2.hidden = v !== '2d';
    if (playing && (playing.what === '1d' || playing.what === '2d') && playing.what !== v) stopSound();
    renderAll();
  }

  function renderAll() {
    for (const d of transient) d();
    transient.clear();
    renderSlots();
    renderSpace();
    updateMorph();
    refreshPlayState();
  }

  const tour = new Tour(morphTourSteps({ root, setView, setSpaceMode, slider, morphPlay, square, weightsEl, backupBtn, tab2, intro }), { label: 'Vowel Morph tour' });

  // ───────────── start ─────────────
  storageEl.textContent = 'Loading saved vowels…';
  renderAll();
  store.loadRecordings().then((r) => {
    for (const rec of r.list) recs.set(rec.id, rec);
    if (!r.ok) storageNote = `Saved recordings could not be read (${r.error}).`;
    const missing = project.vowels.filter((v) => v.recordingId && !recs.has(v.recordingId)).length;
    storageEl.textContent = storageNote || (project.vowels.length ? `Restored ${project.vowels.length} vowel(s) from this browser${missing ? `; ${missing} recording(s) missing` : ''}.` : 'Saved in this browser.');
    storageEl.classList.toggle('vm-bad', !!storageNote || missing > 0);
    renderAll();
  });

  // A pending (debounced) save must not be lost when the tab closes or reloads.
  const flush = () => { if (saveTimer) save(true); };
  window.addEventListener('pagehide', flush);

  window.__vowelMorph = {
    debug: () => ({
      view, spaceMode, dotClick, selectedId, placingId, playing: playing ? { ...playing } : null,
      project: JSON.parse(JSON.stringify(project)),
      recordings: [...recs.values()].map((r) => ({ id: r.id, sampleRate: r.sampleRate, length: r.samples.length })),
      slider: currentSliderParams(), blend: (() => { const b = currentBlend(); return { status: b.status, params: b.params, weights: b.contributions.map((c) => ({ id: c.vowel.id, name: c.vowel.name, weight: c.weight })) }; })(),
      audio: audio.debug(), targetRms: TARGET_RMS, harmonics: HARMONICS,
    }),
  };

  return {
    unmount() {
      window.removeEventListener('pagehide', flush);
      save(true);
      tour.close();
      recorder.cancel();
      mic.stop();
      audio.close();
      for (const d of [...disposers, ...transient]) d();
      delete window.__vowelMorph;
    },
  };
}

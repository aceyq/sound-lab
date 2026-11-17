// Pose Sound Map (capstone part 3): the 2D vowel map, played with two joint
// angles measured by the laptop camera.
//
//   camera ─▶ MediaPipe Pose (pose-tracker.js) ─▶ body landmarks
//     ─▶ right elbow bend  → x = which vowel (columns ah | ee | oo)
//        head tilt relative to the shoulders → y = pitch (rows low | middle | high)
//     ─▶ grid weights (pose-model.js gridBlend) ─▶ Vowel Morph's blendParams
//     ─▶ ONE harmonic voice (Vowel Morph's MorphAudio, 48 sine oscillators)
//   optional clap: fires once on entering the final pose region.
//
// The sound follows the pose currently held: there is no timeline, so the
// phrase can be slowed down, paused or reversed at any time.
import './pose-map.css';
import { h, fmtHz } from '../../lib/dom.js';
import { Tour } from '../../lib/tour.js';
import { MicInput } from '../frequency/mic.js';
import { VowelRecorder } from '../frequency/recorder.js';
import { newId } from '../frequency/vowel-model.js';
import { isUsable, noteName, loadProject as loadMorphProject } from '../vowel-morph/morph-model.js';
import { MorphAudio } from '../vowel-morph/morph-audio.js';
import { analyzeTake, initialSegment, MIN_TAKE_SEC } from '../vowel-morph/morph-analysis.js';
import { HarmonicBars } from '../vowel-morph/morph-plots.js';
import * as morphStore from '../vowel-morph/morph-store.js';
import { playDrum, drumCounters } from './drums.js';
import { PoseTracker } from './pose-tracker.js';
import { poseTourSteps } from './pose-tour.js';
import {
  LM, BEND_JOINTS, HEAD_JOINTS, LOST_GRACE_MS, DEFAULT_CAL, CLAP_BUFFER, PROJECT_KEY, MAX_COLUMNS,
  poseAngles, anglesToPoint, heldValue, applyCapture, swapTilt, tiltSide, smoothAngles,
  gridBlend, centre, starterColumns, RegionTrigger, loadProject, cleanColumn, nextColor, clamp01,
} from './pose-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COUNTDOWN_SEC = 3;
const HOLD_SEC = 1;
const MAX_REC_SEC = 4;
const STALE_MS = 500; // no camera result for this long → tracking lost

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}
const deg = (v) => (Number.isFinite(v) ? `${v.toFixed(0)}°` : '—');
const sdeg = (v) => (Number.isFinite(v) ? `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${Math.abs(v).toFixed(0)}°` : '—');
const pct = (w) => `${Math.round(w * 100)} %`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAPTURES = {
  straight: { label: 'Arm straight', key: 'bend', tell: 'Right arm hanging straight down, elbow not bent.' },
  bent: { label: 'Elbow bent', key: 'bend', tell: 'Bend your right elbow as far as is comfortable (hand up toward your shoulder).' },
  upright: { label: 'Head upright', key: 'tilt', tell: 'Head upright, looking at the camera.' },
  low: { label: 'Tilt for LOW pitch', key: 'tilt', tell: 'Tilt your head toward the shoulder that should LOWER the pitch, as far as is comfortable.' },
  high: { label: 'Tilt for HIGH pitch', key: 'tilt', tell: 'Tilt your head toward the other shoulder, the one that should RAISE the pitch.' },
};

function readStored() {
  try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function mount(root) {
  const project = loadProject(readStored());
  const save = () => { try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch { /* private mode: works until reload */ } };

  const st = {
    camera: 'off', cameraMsg: 'Camera off.',
    sim: false, simAngles: { bend: DEFAULT_CAL.bend.lo, tilt: 0 },
    raw: null, lastResultMs: -Infinity, lastOkMs: -Infinity, lastSmooth: performance.now(),
    angles: null, dot: { x: 0, y: 0.5 }, tracking: false, lostText: '',
    soundOn: false, preview: null, lastClapAt: -Infinity,
    capture: null, countdown: '', busy: false,
    trail: [], landmarks: null, feeding: false,
    candidate: null, // a sound being customized: { name, amps, f0, recordingId, source }
  };
  const recordings = new Map(); // recordingId → { samples, sampleRate, from?, to? } (this page only)
  const clap = new RegionTrigger({ buffer: CLAP_BUFFER });
  const audio = new MorphAudio({ onChange: () => renderSoundState() });
  const mic = new MicInput({ onChange: () => {} });
  const recorder = new VowelRecorder();
  const tracker = new PoseTracker({ onResult: (r) => onPose(r), onStatus: (s, m) => { st.camera = s; st.cameraMsg = m; renderCamera(); } });

  // ───────────── pose input ─────────────
  function onPose(r) {
    st.lastResultMs = performance.now();
    st.landmarks = r.landmarks;
    const raw = poseAngles(r.landmarks, { world: r.world, aspect: (r.width || 640) / (r.height || 480) });
    st.raw = raw;
    if (raw.ok) {
      const now = performance.now();
      const dt = (now - st.lastSmooth) / 1000;
      st.lastSmooth = now;
      st.angles = smoothAngles(st.lastOkMs > now - 300 ? st.angles : null, raw, dt);
      st.lastOkMs = now;
    }
    if (st.capture) st.capture.samples.push({ bend: raw.bend, tilt: raw.tilt });
    drawPreview();
  }

  // ───────────── page ─────────────
  const video = h('video', { class: 'pm-video', muted: true, playsinline: true, 'aria-hidden': 'true' });
  const overlay = h('canvas', { class: 'pm-overlay', width: 640, height: 480, 'aria-label': 'Camera preview with the landmarks in use marked' });
  const countdownEl = h('div', { class: 'pm-countdown', 'aria-live': 'assertive' });
  const camBtn = h('button', { class: 'btn primary pm-cam-btn', onclick: () => (tracker.running ? tracker.stop() : tracker.start(video)) }, '📷 Enable camera');
  const camMsg = h('div', { class: 'pm-cam-msg', 'aria-live': 'polite' });
  const simChk = h('input', { type: 'checkbox', onchange: () => { st.sim = simChk.checked; simBox.hidden = !st.sim; } });
  const simBend = h('input', { type: 'range', min: '0', max: '160', step: '1', value: String(st.simAngles.bend), 'aria-label': 'Simulated right elbow bend in degrees', oninput: () => { st.simAngles.bend = Number(simBend.value); } });
  const simTilt = h('input', { type: 'range', min: '-40', max: '40', step: '1', value: '0', 'aria-label': 'Simulated head tilt in degrees', oninput: () => { st.simAngles.tilt = Number(simTilt.value); } });
  const simBox = h('div', { class: 'pm-sim', hidden: true },
    h('label', { class: 'pm-sim-row' }, h('span', {}, 'Right elbow bend'), simBend),
    h('label', { class: 'pm-sim-row' }, h('span', {}, 'Head tilt'), simTilt));

  const guideBtn = h('button', { class: 'btn primary pm-cal-guide', onclick: () => guidedCalibration() }, '🎯 Calibrate (guided, 5 poses)');
  const capBtns = Object.fromEntries(Object.entries(CAPTURES).map(([k, c]) => [k, h('button', { class: `btn small pm-cap-${k}`, onclick: () => captureOne(k) }, c.label)]));
  const swapBtn = h('button', { class: 'btn small', onclick: () => { project.cal = swapTilt(project.cal); save(); calMsg.textContent = 'Swapped: the other shoulder now lowers the pitch.'; renderAll(); } }, '⇅ Swap low/high side');
  const resetCalBtn = h('button', { class: 'btn small', onclick: () => { project.cal = JSON.parse(JSON.stringify(DEFAULT_CAL)); save(); calMsg.textContent = 'Ranges reset to the defaults.'; renderAll(); } }, 'Reset ranges');
  const calMsg = h('div', { class: 'pm-cal-msg', 'aria-live': 'polite' });
  const calOut = h('div', { class: 'pm-cal-out muted' });

  const bendOut = h('div', { class: 'pm-angle' });
  const tiltOut = h('div', { class: 'pm-angle' });
  const tiltSideOut = h('div', { class: 'muted pm-angle-sub' });
  const bendSubOut = h('div', { class: 'muted pm-angle-sub' });
  const bendBar = h('div', { class: 'pm-bar' }, h('span'));
  const tiltBar = h('div', { class: 'pm-bar pm-bar-centre' }, h('span'));
  const trackOut = h('div', { class: 'pm-track' });

  // map
  const square = svg('svg', { viewBox: '0 0 1000 1000', class: 'pm-square', role: 'img', 'aria-label': 'Sound map. Columns are vowels (right elbow bend), rows are pitches (head tilt). The white dot is your current pose.' });
  const gGrid = svg('g', { class: 'pm-grid' });
  const gClap = svg('g', { class: 'pm-clap' });
  const gLines = svg('g');
  const gDots = svg('g', { class: 'pm-anchors' });
  const trail = svg('polyline', { class: 'pm-trail', points: '' });
  const dotEl = svg('g', { class: 'pm-dot' }, svg('circle', { r: 26 }), svg('circle', { class: 'pm-dot-core', r: 9 }));
  square.append(gGrid, gClap, gLines, trail, gDots, dotEl);

  // what you hear
  const soundBtn = h('button', { class: 'btn primary big pm-sound-btn', onclick: () => (st.soundOn ? stopSound() : startSound()) }, '▶ Start sound');
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volumeValue), 'aria-label': 'Volume', oninput: () => audio.setVolume(Number(volume.value)) });
  const f0Out = h('div', { class: 'pm-f0' });
  const rowsOut = h('div', { class: 'pm-rows muted' });
  const vowelBars = h('div', { class: 'pm-vowel-bars', 'aria-live': 'off' });
  const harmCanvas = h('canvas', { class: 'vm-bars pm-harm', 'aria-label': 'Harmonic strengths the synthesizer is using now, in dB' });
  const harmBars = new HarmonicBars(harmCanvas);
  const hearCard = h('section', { class: 'card pm-hear' },
    h('div', { class: 'row gap wrap' }, soundBtn, h('label', { class: 'row gap' }, 'Volume', volume)),
    h('div', { class: 'pm-hear-grid' },
      h('div', { class: 'pm-pitch-box' }, h('div', { class: 'pm-sub' }, 'Pitch (head tilt)'), f0Out, rowsOut),
      h('div', { class: 'pm-vowel-box' }, h('div', { class: 'pm-sub' }, 'Vowel mix (elbow bend)'), vowelBars)),
    h('div', { class: 'pm-sub' }, 'Harmonic strengths the synth is using now'),
    harmCanvas,
    h('p', { class: 'help' }, 'Bars: harmonic 1 (the fundamental) on the left up to 48, in dB relative to the strongest. Bending the elbow reshapes these bars (the vowel); tilting the head moves the fundamental in Hz while the bars stay the same.'));

  const clapChk = h('input', { type: 'checkbox', checked: project.clap.on, onchange: () => setClap(clapChk.checked) });
  const clapHere = h('button', { class: 'btn small', onclick: () => { project.clap.region.x = st.dot.x; project.clap.region.y = st.dot.y; clap.prime(st.dot, project.clap.region); save(); renderMap(); } }, 'Use my current pose as the clap spot');
  const clapOut = h('div', { class: 'pm-clap-flash', 'aria-live': 'polite' });
  const clapCard = h('section', { class: 'card pm-clap-box' },
    h('label', { class: 'check pm-clap-toggle' }, clapChk, h('b', {}, '👏 Clap on the final pose'), ' (optional)'),
    clapOut, clapHere,
    h('p', { class: 'help' }, 'The ring sits on “ee, high” at first (the end of the demo phrase). It claps once when you enter, stays quiet while you hold, and is ready again after you leave past the dashed ring.'));

  // customize
  const resetSoundsBtn = h('button', { class: 'btn small pm-reset-sounds', onclick: () => resetSounds() }, '↺ Back to starter sounds');
  const custName = h('input', { type: 'text', value: 'mmm', maxlength: '24', class: 'pm-name', 'aria-label': 'Name for your sound' });
  const custRecBtn = h('button', { class: 'btn pm-rec', onclick: () => (recorder.recording ? recorder.stop() : recordCandidate()) }, `● Record (up to ${MAX_REC_SEC} s)`);
  const vmSel = h('select', { class: 'pm-vm-sel', 'aria-label': 'A vowel recorded in Vowel Morph' });
  const vmUseBtn = h('button', { class: 'btn', onclick: () => pickVowelMorph() }, 'Use this vowel');
  const custMsg = h('div', { class: 'pm-cust-msg', 'aria-live': 'polite' });
  const candEl = h('div', { class: 'pm-candidate' });
  const columnsEl = h('div', { class: 'pm-columns' });
  const customize = h('details', { class: 'card pm-customize' },
    h('summary', {}, h('b', {}, '🎙 Customize sounds'), h('span', { class: 'muted' }, ' (optional: the starter vowels already work)')),
    h('p', { class: 'help' }, 'Use your own voice for a vowel column, or add a new pitched sound such as a closed-mouth “mmm”. Only the harmonic balance (the vowel colour) is used on the map; each row keeps its matched pitch, so the head still controls the pitch.'),
    h('div', { class: 'pm-cust-src' },
      h('div', {}, h('div', { class: 'pm-sub' }, 'Record a new sound'), h('div', { class: 'row gap wrap' }, h('label', { class: 'row gap' }, 'Name', custName), custRecBtn)),
      h('div', {}, h('div', { class: 'pm-sub' }, 'Or use a vowel from Vowel Morph'), h('div', { class: 'row gap wrap' }, vmSel, vmUseBtn))),
    custMsg, candEl,
    h('div', { class: 'pm-sub' }, 'Columns on the map'), columnsEl,
    h('div', { class: 'row gap wrap' }, resetSoundsBtn));

  const tourBtn = h('button', { class: 'btn primary pm-tour-btn', onclick: () => tour.start(0) }, '🧭 Tour');

  const cameraCard = h('section', { class: 'card pm-camera' },
    h('h2', {}, '1 · Camera'),
    h('div', { class: 'row gap wrap' }, camBtn, h('label', { class: 'check' }, simChk, 'Practice without camera (sliders)')),
    camMsg,
    h('div', { class: 'pm-preview' }, video, overlay, countdownEl),
    h('p', { class: 'help pm-frame-help' }, 'Sit or stand so your head, both shoulders and your whole right arm are in the picture. The preview is mirrored. Blue: right shoulder, elbow and wrist (elbow bend). Pink: both ears against both shoulders (head tilt). A red ✕ marks a lost landmark. Video stays on this computer.'),
    simBox);
  const calCard = h('section', { class: 'card pm-calib' },
    h('h2', {}, '2 · Calibrate'),
    h('p', { class: 'help' }, `The guided button walks through five poses. For each: get into the pose during the ${COUNTDOWN_SEC}-second countdown, hold still at the beep for ${HOLD_SEC} s until the second beep.`),
    guideBtn,
    h('div', { class: 'pm-sub' }, 'Or redo one pose:'),
    h('div', { class: 'row gap wrap pm-cap-row' }, ...Object.values(capBtns)),
    calMsg, calOut, h('div', { class: 'row gap wrap' }, swapBtn, resetCalBtn));
  const angleCard = h('section', { class: 'card pm-readout' },
    h('h2', {}, 'Your two angles'),
    h('div', { class: 'pm-angles' },
      h('div', { class: 'pm-angle-box' }, h('div', { class: 'muted' }, 'Right elbow bend → vowel'), bendOut, bendSubOut, bendBar),
      h('div', { class: 'pm-angle-box' }, h('div', { class: 'muted' }, 'Head tilt → pitch'), tiltOut, tiltSideOut, tiltBar)),
    trackOut);
  const performCard = h('section', { class: 'card pm-perform' },
    h('h2', {}, '3 · The demo phrase'),
    h('ol', {},
      h('li', {}, 'Head upright, right arm straight: “ah”, middle pitch.'),
      h('li', {}, 'Slowly bend the right elbow: glide from “ah” toward “ee”. The pitch stays the same; watch the vowel bars and harmonics change.'),
      h('li', {}, 'On the next count, tilt your head to the high side: the same “ee” goes higher. The harmonic bars stay; the Hz changes.'),
      h('li', {}, 'Freeze for a count: the sound holds.'),
      h('li', {}, 'Reverse: head back upright, then straighten the arm back to “ah”.')),
    h('p', { class: 'help' }, 'The sound follows the pose you are holding right now, not a recording of the phrase, so you can change the timing, pause or go backward whenever you like.'));

  root.append(h('div', { class: 'pm-page' },
    h('div', { class: 'page-top' },
      h('div', {}, h('h1', {}, 'Pose Sound Map'),
        h('p', { class: 'lead' }, 'Your elbow changes the vowel; your head changes the pitch. The laptop camera measures two joint angles: how bent your right elbow is (ah → ee → oo, left to right) and how far your head tilts relative to your shoulders (low ↕ high). Both together pick one spot on the map, and one synthesized voice sings it.')),
      h('div', { class: 'pm-top-actions' }, tourBtn)),
    h('div', { class: 'pm-layout' },
      h('div', { class: 'pm-col' }, cameraCard, calCard, angleCard),
      h('div', { class: 'pm-col' },
        h('div', { class: 'pm-square-wrap' }, square),
        hearCard, performCard, clapCard, customize))));

  // ───────────── calibration ─────────────
  let beeps = 0;
  function beep(freq = 880, dur = 0.12) {
    try {
      const ctx = audio.ensure();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      g.gain.setTargetAtTime(0, ctx.currentTime + dur, 0.02);
      o.connect(g).connect(ctx.destination); // not through the tracking gate
      o.start(); o.stop(ctx.currentTime + dur + 0.15);
      o.onended = () => { o.disconnect(); g.disconnect(); };
      beeps++;
    } catch { /* no audio: the countdown is still shown */ }
  }

  function ready() {
    if (st.sim || tracker.running || st.feeding) return true;
    calMsg.textContent = 'Enable the camera first (or tick Practice without camera).';
    return false;
  }

  async function holdAndRead(which, prefix = '') {
    const c = CAPTURES[which];
    for (let s = COUNTDOWN_SEC; s > 0; s--) { st.countdown = `${prefix}${c.label}\n${s}`; calMsg.textContent = c.tell; renderCountdown(); await sleep(1000); }
    beep(880);
    st.countdown = `${prefix}${c.label}\nHold still…`; renderCountdown();
    const samples = [];
    st.capture = { samples };
    const end = performance.now() + HOLD_SEC * 1000;
    while (performance.now() < end) { if (st.sim) samples.push({ ...st.simAngles }); await sleep(st.sim ? 40 : 50); }
    st.capture = null;
    beep(1320, 0.08);
    st.countdown = ''; renderCountdown();
    return heldValue(samples, c.key);
  }

  async function captureOne(which, prefix = '') {
    if (st.busy && !prefix) return false;
    if (!ready()) return false;
    const solo = !prefix;
    if (solo) { st.busy = true; renderButtons(); }
    const v = await holdAndRead(which, prefix);
    let ok = false;
    if (!Number.isFinite(v)) calMsg.textContent = `${CAPTURES[which].label}: not enough readings (a landmark was lost). Check the preview for a red ✕ and try again.`;
    else {
      const r = applyCapture(project.cal, which, v);
      if (r.error) calMsg.textContent = `${CAPTURES[which].label} (${sdeg(v)}): ${r.error}`;
      else { project.cal = r.cal; save(); calMsg.textContent = `${CAPTURES[which].label}: read ${sdeg(v)}.`; ok = true; }
    }
    if (solo) { st.busy = false; renderButtons(); }
    renderAll();
    return ok;
  }

  async function guidedCalibration() {
    if (st.busy || !ready()) return;
    st.busy = true;
    renderButtons();
    const order = ['straight', 'bent', 'upright', 'low', 'high'];
    let done = 0;
    for (let i = 0; i < order.length; i++) {
      if (!(await captureOne(order[i], `${i + 1}/5 · `))) break;
      done++;
    }
    st.busy = false;
    renderButtons();
    if (done === order.length) calMsg.textContent = `Calibrated. Straight arm = “${project.columns[0].name}”, fully bent = “${project.columns[project.columns.length - 1].name}”; head upright = middle pitch.`;
  }

  // ───────────── customize sounds ─────────────
  function vmOptions() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('vowelMorph.project.v1') || 'null'); } catch { raw = null; }
    return loadMorphProject(raw).vowels.filter(isUsable);
  }

  function renderVmSel() {
    const list = vmOptions();
    const keep = vmSel.value;
    vmSel.replaceChildren(...(list.length ? list.map((v) => h('option', { value: v.id }, `${v.name} (${fmtHz(v.analysis.f0)})`)) : [h('option', { value: '' }, 'No analyzed vowels in Vowel Morph yet')]));
    if (list.some((v) => v.id === keep)) vmSel.value = keep;
    vmSel.disabled = !list.length;
    vmUseBtn.disabled = !list.length;
  }

  async function recordCandidate() {
    stopSound();
    stopPreview();
    custMsg.textContent = 'Opening the microphone…';
    await mic.start();
    if (!mic.listening) { custMsg.textContent = mic.error ? `${mic.error.title}. ${mic.error.message}` : 'The microphone did not start.'; return; }
    custRecBtn.textContent = '■ Stop recording';
    custMsg.textContent = 'Recording… sing or hum one steady sound.';
    const result = await recorder.start(mic, MAX_REC_SEC, { onProgress: (sec) => { custMsg.textContent = `Recording… ${sec.toFixed(1)} s of up to ${MAX_REC_SEC} s.`; } });
    mic.stop();
    custRecBtn.textContent = `● Record (up to ${MAX_REC_SEC} s)`;
    if (result.reason === 'cancelled') return;
    const sec = result.samples.length / result.sampleRate;
    if (result.error || sec < MIN_TAKE_SEC) { custMsg.textContent = result.error ? `Recording failed: ${result.error}` : 'Too short. Record 2–4 s.'; return; }
    const rec = { samples: result.samples, sampleRate: result.sampleRate };
    const r = analyzeTake(rec, initialSegment(rec));
    if (!r.analysis.f0) { custMsg.textContent = `No usable pitch found (${r.analysis.problems[0] || 'sing or hum a steadier, louder pitched sound'}). Nothing was added.`; st.candidate = null; renderCandidate(); return; }
    const id = newId('rec');
    recordings.set(id, rec);
    st.candidate = { name: custName.value.trim() || 'my sound', amps: r.analysis.amps, f0: r.analysis.f0, recordingId: id, source: 'recorded' };
    custMsg.textContent = `Analyzed: f0 ${fmtHz(r.analysis.f0)}. Compare the original and the synthesized version, then use it on the map.`;
    renderCandidate();
  }

  async function pickVowelMorph() {
    const v = vmOptions().find((x) => x.id === vmSel.value);
    if (!v) return;
    let recId = null;
    if (v.recordingId) {
      const r = await morphStore.loadRecordings();
      const rec = r.list.find((x) => x.id === v.recordingId);
      if (rec) {
        const seg = v.segment || initialSegment(rec);
        recId = `vm:${v.recordingId}`;
        recordings.set(recId, { samples: rec.samples, sampleRate: rec.sampleRate, from: Math.round(seg.start * rec.sampleRate), to: Math.round(seg.end * rec.sampleRate) });
      }
    }
    st.candidate = { name: v.name, amps: v.analysis.amps, f0: v.analysis.f0, recordingId: recId, source: 'vowel-morph' };
    custMsg.textContent = `“${v.name}” from Vowel Morph (f0 ${fmtHz(v.analysis.f0)}).${recId ? '' : ' Its original recording is not in this browser, so only the synthesized version can be played.'}`;
    renderCandidate();
  }

  function previewOriginal() {
    const c = st.candidate;
    const rec = c && recordings.get(c.recordingId);
    if (!rec) return;
    stopSound();
    st.preview = 'original';
    audio.playOriginal(rec, { from: rec.from || 0, to: rec.to || rec.samples.length, label: `ORIGINAL ${c.name}` });
    audio.setGate(1, 0.01);
    renderSoundState();
  }

  function previewSynth() {
    const c = st.candidate;
    if (!c) return;
    stopSound();
    st.preview = 'synth';
    audio.playSynth({ f0: c.f0, amps: c.amps }, `SYNTHESIZED ${c.name}`);
    audio.setGate(1, 0.01);
    renderSoundState();
  }

  function useCandidate(target) {
    const c = st.candidate;
    if (!c) return;
    const col = cleanColumn({ id: newId('col'), name: c.name, source: c.source, amps: c.amps, recordedF0: c.f0, recordingId: c.recordingId,
      color: target === 'new' ? nextColor(project.columns) : project.columns[Number(target)].color });
    if (target === 'new') {
      if (project.columns.length >= MAX_COLUMNS) { custMsg.textContent = `The map holds at most ${MAX_COLUMNS} columns. Replace one instead.`; return; }
      project.columns.push(col);
      custMsg.textContent = `Added “${col.name}” as a new column on the right. Straight arm is still “${project.columns[0].name}”; fully bent is now “${col.name}”.`;
    } else {
      const old = project.columns[Number(target)];
      project.columns[Number(target)] = col;
      custMsg.textContent = `“${col.name}” replaced the “${old.name}” column. It plays at the row pitches (${project.rows.map((r) => Math.round(r.f0)).join(', ')} Hz) so the rows stay matched.`;
    }
    save();
    stopPreview();
    renderAll();
  }

  function resetSounds() {
    project.columns = starterColumns();
    save();
    custMsg.textContent = 'Back to the starter sounds: ah, ee, oo.';
    renderAll();
  }

  function stopPreview() {
    if (!st.preview) return;
    st.preview = null;
    audio.stop();
    audio.setGate(st.tracking ? 1 : 0, 0.02);
    renderSoundState();
  }

  function renderCandidate() {
    const c = st.candidate;
    candEl.replaceChildren();
    if (!c) return;
    const target = h('select', { 'aria-label': 'Column to replace' }, project.columns.map((col, i) => h('option', { value: String(i) }, `Replace “${col.name}”`)));
    candEl.append(h('div', { class: 'pm-cand-box' },
      h('div', {}, h('b', {}, c.name), ` · f0 ${fmtHz(c.f0)} ${noteName(c.f0)} · ${c.source === 'vowel-morph' ? 'from Vowel Morph' : 'recorded here'}`),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn small pm-prev-orig', disabled: !recordings.get(c.recordingId), onclick: () => previewOriginal() }, '▶ Original'),
        h('button', { class: 'btn small pm-prev-synth', onclick: () => previewSynth() }, '▶ Synthesized'),
        h('button', { class: 'btn small', onclick: () => stopPreview() }, '■ Stop preview')),
      h('div', { class: 'row gap wrap' }, target,
        h('button', { class: 'btn small primary pm-use-replace', onclick: () => useCandidate(target.value) }, 'Use for this column'),
        h('button', { class: 'btn small pm-use-new', disabled: project.columns.length >= MAX_COLUMNS, onclick: () => useCandidate('new') }, '+ Add as a new column'))));
  }

  function renderColumns() {
    columnsEl.replaceChildren(...project.columns.map((col, i) => h('div', { class: 'pm-row' },
      h('span', { class: 'pm-swatch', style: { background: col.color } }),
      h('b', {}, col.name),
      h('span', { class: 'muted' }, `${col.source === 'starter' ? 'starter vowel' : col.source === 'vowel-morph' ? `from Vowel Morph (sung at ${Math.round(col.recordedF0)} Hz)` : `recorded here (sung at ${Math.round(col.recordedF0)} Hz)`} · column ${i + 1} of ${project.columns.length}`),
      project.columns.length > 1 && col.source !== 'starter'
        ? h('button', { class: 'btn small danger', 'aria-label': `Remove ${col.name}`, onclick: () => { project.columns.splice(i, 1); save(); renderAll(); } }, '🗑') : null)));
  }

  // ───────────── sound ─────────────
  const currentBlend = () => gridBlend(project.columns, project.rows, st.dot);

  function startSound() {
    stopPreview();
    const b = currentBlend();
    if (!b.params) return;
    if (audio.playSynth(b.params, 'Pose map')) st.soundOn = true;
    audio.setGate(st.tracking ? 1 : 0, 0.05);
    renderSoundState();
  }

  function stopSound() {
    st.soundOn = false;
    audio.stop();
    renderSoundState();
  }

  function setClap(on) {
    project.clap.on = on;
    clapChk.checked = on;
    if (on) { try { audio.ensure(); } catch { /* reported when sound starts */ } clap.prime(st.dot, project.clap.region); }
    save();
    renderMap();
  }

  function renderSoundState() {
    if (st.soundOn && audio.kind === 'idle') st.soundOn = false;
    if (st.preview && audio.kind === 'idle') st.preview = null;
    soundBtn.textContent = st.soundOn ? '■ Stop sound' : '▶ Start sound';
    soundBtn.classList.toggle('danger', st.soundOn);
  }

  // ───────────── main loop ─────────────
  function tick() {
    const now = performance.now();
    if (st.sim) {
      st.angles = { ...st.simAngles };
      st.raw = { ...st.simAngles, lost: [], ok: true };
    }
    let tracking;
    let lostText = '';
    if (st.sim) tracking = true;
    else if (!tracker.running && !st.feeding) { tracking = false; lostText = 'Camera off.'; }
    else if (now - st.lastResultMs > STALE_MS) { tracking = false; lostText = 'No camera frames.'; }
    else {
      tracking = !!st.angles && now - st.lastOkMs <= LOST_GRACE_MS;
      if (!tracking) lostText = st.raw && st.raw.noPerson ? 'No person in view: step into the picture.' : `Lost: ${st.raw ? st.raw.lost.join(', ') : 'landmarks'}. Keep it in view of the camera.`;
    }
    if (tracking !== st.tracking) {
      st.tracking = tracking;
      if (!st.preview) audio.setGate(tracking ? 1 : 0, tracking ? 0.05 : 0.15); // fade out when tracking drops, back in when it returns
      if (tracking && project.clap.on) clap.prime(anglesToPoint(st.angles, project.cal), project.clap.region);
    }
    st.lostText = lostText;
    if (tracking) {
      st.dot = anglesToPoint(st.angles, project.cal);
      st.trail.push({ ...st.dot });
      if (st.trail.length > 60) st.trail.shift();
    }
    const b = currentBlend();
    st.lastBlend = b; // what is sent to the synth and drawn this tick
    if (st.soundOn && b.params) audio.update(b.params);
    if (tracking && project.clap.on && clap.update(st.dot, project.clap.region, now)) {
      try { audio.ensure(); playDrum(audio.ctx, audio.volume, 'clap'); } catch { /* no audio */ }
      st.lastClapAt = now;
    }
    draw(b, now);
    if (st.sim) drawPreview();
  }

  // ───────────── drawing ─────────────
  const toSvg = (p) => ({ x: p.x * 1000, y: (1 - p.y) * 1000 });

  function drawPreview() {
    const ctx = overlay.getContext('2d');
    const W = overlay.width;
    const H = overlay.height;
    ctx.clearRect(0, 0, W, H);
    const live = tracker.running && video.readyState >= 2;
    if (live) {
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); // mirrored, like a mirror
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#8b98a5'; ctx.font = '600 22px system-ui, sans-serif'; ctx.textAlign = 'center';
      if (!st.landmarks || st.sim) ctx.fillText(st.sim ? 'Practice mode: sliders stand in for the camera' : 'Camera off', W / 2, H / 2);
    }
    const lms = st.landmarks;
    if (!lms || st.sim) return;
    const P = (i) => ({ x: (1 - lms[i].x) * W, y: lms[i].y * H, ok: (lms[i].visibility ?? 1) >= 0.5 });
    const line = (a, b, color, dash = []) => { const p = P(a); const q = P(b); ctx.setLineDash(dash); ctx.lineWidth = 6; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]); };
    const mark = (i, color) => {
      const p = P(i);
      if (p.ok) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
      else { ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(p.x - 12, p.y - 12); ctx.lineTo(p.x + 12, p.y + 12); ctx.moveTo(p.x + 12, p.y - 12); ctx.lineTo(p.x - 12, p.y + 12); ctx.stroke(); }
    };
    line(LM.rightShoulder, LM.rightElbow, '#58d1ff'); line(LM.rightElbow, LM.rightWrist, '#58d1ff');
    line(LM.rightEar, LM.leftEar, '#ff79c6'); line(LM.rightShoulder, LM.leftShoulder, '#ff79c6', [10, 8]);
    for (const i of BEND_JOINTS) mark(i, '#58d1ff');
    for (const i of HEAD_JOINTS) if (!BEND_JOINTS.includes(i)) mark(i, '#ff79c6');
    ctx.font = '700 18px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    const e = P(LM.rightElbow);
    const ear = P(LM.leftEar);
    const ear2 = P(LM.rightEar);
    if (st.raw && Number.isFinite(st.raw.bend)) ctx.fillText(`elbow ${deg(st.raw.bend)}`, e.x, e.y - 18);
    if (st.raw && Number.isFinite(st.raw.tilt)) ctx.fillText(`head ${sdeg(st.raw.tilt)}`, (ear.x + ear2.x) / 2, Math.min(ear.y, ear2.y) - 22);
  }

  function renderCountdown() {
    countdownEl.textContent = st.countdown;
    countdownEl.hidden = !st.countdown;
  }

  function renderButtons() {
    for (const b of [guideBtn, ...Object.values(capBtns)]) b.disabled = st.busy;
  }

  function renderCamera() {
    camBtn.textContent = tracker.running ? '■ Turn camera off' : '📷 Enable camera';
    camMsg.textContent = st.cameraMsg;
    camMsg.className = `pm-cam-msg ${st.camera === 'error' ? 'bad' : st.camera === 'running' ? 'ok' : ''}`;
    if (!tracker.running) { st.landmarks = null; drawPreview(); }
  }

  function renderMap() {
    const nC = project.columns.length;
    const nR = project.rows.length;
    gGrid.replaceChildren();
    for (let c = 0; c < nC; c++) {
      const x = centre(c, nC) * 1000;
      gGrid.append(svg('line', { class: 'pm-col-line', x1: x, y1: 60, x2: x, y2: 940, stroke: project.columns[c].color }),
        svg('text', { class: 'pm-col-label', x, y: 42, 'text-anchor': 'middle', fill: project.columns[c].color }, `“${project.columns[c].name}”`));
    }
    for (let r = 0; r < nR; r++) {
      const y = (1 - centre(r, nR)) * 1000;
      gGrid.append(svg('line', { class: 'pm-row-line', x1: 40, y1: y, x2: 950, y2: y }),
        svg('text', { class: 'pm-row-label', x: 14, y: y - 14 }, `${project.rows[r].name} ${Math.round(project.rows[r].f0)} Hz`));
    }
    gGrid.append(svg('text', { class: 'pm-axis', x: 500, y: 988, 'text-anchor': 'middle' }, 'right elbow: straight → bent  (vowel)'),
      svg('text', { class: 'pm-axis', x: 978, y: 500, 'text-anchor': 'middle', transform: 'rotate(90 978 500)' }, 'head tilt: low ↕ high  (pitch)'));
    gDots.replaceChildren();
    for (let c = 0; c < nC; c++) for (let r = 0; r < nR; r++) {
      const p = toSvg({ x: centre(c, nC), y: centre(r, nR) });
      gDots.append(svg('circle', { class: 'pm-cell', cx: p.x, cy: p.y, r: 14 + 4 * r, fill: project.columns[c].color }));
    }
    gClap.replaceChildren();
    if (project.clap.on) {
      const r = project.clap.region;
      const c = toSvg(r);
      gClap.append(svg('circle', { class: 'pm-clap-buffer', cx: c.x, cy: c.y, r: (r.r + CLAP_BUFFER) * 1000 }),
        svg('circle', { class: 'pm-clap-zone', cx: c.x, cy: c.y, r: r.r * 1000 }),
        svg('text', { x: c.x + r.r * 1000 + 8, y: c.y + 10 }, '👏'));
    }
    const k = project.cal;
    calOut.textContent = `Elbow: straight ${deg(k.bend.lo)} → bent ${deg(k.bend.hi)} · Head: low ${sdeg(k.tilt.low)}, upright ${sdeg(k.tilt.neutral)}, high ${sdeg(k.tilt.high)} (+ = toward your left shoulder)`;
  }

  let lastHarm = '';
  function draw(b, now) {
    const c = toSvg(st.dot);
    dotEl.setAttribute('transform', `translate(${c.x} ${c.y})`);
    dotEl.classList.toggle('lost', !st.tracking);
    trail.setAttribute('points', st.trail.map((p) => { const s = toSvg(p); return `${s.x.toFixed(0)},${s.y.toFixed(0)}`; }).join(' '));
    const a = st.tracking ? st.angles : st.raw;
    const hasB = a && Number.isFinite(a.bend);
    const hasT = a && Number.isFinite(a.tilt);
    bendOut.textContent = hasB ? deg(a.bend) : '—';
    tiltOut.textContent = hasT ? sdeg(a.tilt) : '—';
    bendOut.classList.toggle('lost', !hasB);
    tiltOut.classList.toggle('lost', !hasT);
    bendSubOut.textContent = hasB ? (a.bend - project.cal.bend.lo < 8 ? 'straight' : project.cal.bend.hi - a.bend < 8 ? 'fully bent' : 'bending') : '';
    tiltSideOut.textContent = hasT ? `${tiltSide(a.tilt)}${Math.abs(a.tilt - project.cal.tilt.neutral) < 3 ? ' (middle pitch)' : ''}` : '';
    if (hasB) bendBar.firstChild.style.width = `${clamp01((a.bend - project.cal.bend.lo) / (project.cal.bend.hi - project.cal.bend.lo)) * 100}%`;
    if (hasT) {
      const y = anglesToPoint({ bend: 0, tilt: a.tilt }, project.cal).y;
      const s = tiltBar.firstChild;
      s.style.left = `${Math.min(50, y * 100)}%`;
      s.style.width = `${Math.abs(y - 0.5) * 100}%`;
    }
    trackOut.textContent = st.tracking ? (st.sim ? 'Tracking: practice sliders' : 'Tracking both angles') : `${st.lostText} The sound fades until tracking returns.`;
    trackOut.className = `pm-track ${st.tracking ? 'ok' : 'bad'}`;
    gLines.replaceChildren();
    if (!b.params) return;
    const nC = project.columns.length;
    const nR = project.rows.length;
    for (const cell of b.cells) {
      if (cell.weight < 0.01) continue;
      const p = toSvg({ x: centre(cell.c, nC), y: centre(cell.r, nR) });
      gLines.append(svg('line', { x1: c.x, y1: c.y, x2: p.x, y2: p.y, stroke: project.columns[cell.c].color, 'stroke-width': 2 + 14 * cell.weight, 'stroke-opacity': 0.15 + 0.75 * cell.weight }));
    }
    // What is heard: the synth's own parameters while it plays, otherwise the blend it would play.
    const heard = st.soundOn && audio.voice ? audio.voice.params : b.params;
    f0Out.replaceChildren(h('b', {}, `${heard.f0.toFixed(1)} Hz`), h('span', { class: 'muted' }, ` ${noteName(heard.f0)}`));
    rowsOut.textContent = project.rows.map((r, i) => `${r.name} ${pct(b.rowShares[i])}`).join(' · ');
    vowelBars.replaceChildren(...project.columns.map((col, i) => h('div', { class: 'pm-wrow', 'data-vowel': col.name },
      h('span', { class: 'pm-swatch', style: { background: col.color } }), h('span', { class: 'pm-wname' }, `“${col.name}”`),
      h('span', { class: 'pm-wbar' }, h('span', { style: { width: `${b.vowelShares[i] * 100}%`, background: col.color } })),
      h('span', { class: 'pm-wval' }, pct(b.vowelShares[i])))));
    const key = heard.amps.map((v) => v.toFixed(6)).join(',');
    if (key !== lastHarm) { lastHarm = key; harmBars.set({ amps: heard.amps }); }
    const fresh = now - st.lastClapAt < 450;
    clapOut.textContent = !project.clap.on ? 'Clap off' : fresh ? '👏 Clap!' : clap.count ? `Clap played ${clap.count}×. ${clap.inside ? 'Holding inside: quiet.' : 'Ready.'}` : 'Ready: move into the ring.';
    clapOut.classList.toggle('hit', project.clap.on && fresh);
    gClap.classList.toggle('inside', clap.inside);
  }

  function renderAll() {
    renderMap();
    renderColumns();
    renderCandidate();
    renderVmSel();
    renderButtons();
    renderCountdown();
    renderSoundState();
  }

  const tour = new Tour(poseTourSteps({ camBtn, overlay, guideBtn, calCard, angleCard, square, soundBtn, vowelBars, harmCanvas, f0Out, performCard, clapCard, customize }), { label: 'Pose Sound Map tour', finishLabel: 'Done' });

  const timer = setInterval(tick, 20);
  renderCamera();
  renderAll();
  drawPreview();

  // For the automated checks: feed landmark frames through the same handler as the camera.
  window.__poseMap = {
    feed: (frame) => { st.feeding = true; onPose(frame); },
    debug: () => {
      const b = st.lastBlend || currentBlend();
      const fb = f0Out.querySelector('b');
      return {
        sim: st.sim, tracking: st.tracking, lostText: st.lostText, raw: st.raw && { ...st.raw }, angles: st.angles && { ...st.angles }, dot: { ...st.dot },
        soundOn: st.soundOn, preview: st.preview, gate: audio.gate ? audio.gate.gain.value : null, gateTarget: audio.gateLevel ?? null,
        blend: { params: b.params, vowelShares: b.vowelShares, rowShares: b.rowShares },
        shown: {
          f0: fb ? parseFloat(fb.textContent) : null,
          vowels: [...vowelBars.querySelectorAll('.pm-wrow')].map((r) => ({ name: r.dataset.vowel, pct: parseFloat(r.querySelector('.pm-wval').textContent), width: parseFloat(r.querySelector('.pm-wbar span').style.width) })),
          harmonics: harmBars.data && harmBars.data.amps ? [...harmBars.data.amps] : null,
        },
        audio: audio.debug(), claps: drumCounters.clap, clapInside: clap.inside, busy: st.busy, countdown: st.countdown, calMsg: calMsg.textContent, custMsg: custMsg.textContent,
        camera: st.camera, cameraMsg: st.cameraMsg, delegate: tracker.delegate, fps: tracker.fps, beeps,
        project: JSON.parse(JSON.stringify(project)), tourOpen: tour.open, tourStep: tour.i,
      };
    },
  };

  return {
    unmount() {
      clearInterval(timer);
      tour.close();
      recorder.cancel();
      mic.stop();
      tracker.close();
      audio.close();
      harmBars.dispose();
      save();
      delete window.__poseMap;
    },
  };
}

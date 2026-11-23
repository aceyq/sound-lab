// Motion Morph (the camera pose map, capstone part 3): teach the 2D sound
// map your own sounds and poses, then play them with two joint angles.
//
//   camera ─▶ MediaPipe Pose (pose-tracker.js) ─▶ 33 body landmarks
//     ─▶ right elbow bend and left arm lift (pose-model.js, joint angles, not x/y)
//     ─▶ scaled by the movement range to 0…1: bend → x, lift → y
//     ─▶ Vowel Morph's inverse-distance blend of every sound on the map (blendAt)
//     ─▶ ONE harmonic voice (Vowel Morph's MorphAudio, 48 sine oscillators)
//
// Sounds on the map:
//   starter sounds   four vowels at the corners of the range (playable at once)
//   my sounds        one recording each, analyzed into f0 + 48 harmonic
//                    strengths (sound-analysis.js), saved at a POSE: either the
//                    pose held after a countdown, or the pose that reaches a
//                    clicked spot on the map
//   drawn takes      Vowel Morph's draw-and-record (take-model.js): short
//                    snippets placed where the pointer was when they were sung
// Personal sounds and takes are stored as angles, so they keep their pose when
// the range changes (see pose-model.js, "Saved poses and the range").
import './pose-map.css';
import { h, fmtHz } from '../../lib/dom.js';
import { Tour } from '../../lib/tour.js';
import { MicInput } from '../frequency/mic.js';
import { VowelRecorder } from '../frequency/recorder.js';
import { newId } from '../frequency/vowel-model.js';
import { blendAt, isUsable, noteName, paramsOf, loadProject as loadMorphProject, POWERS } from '../vowel-morph/morph-model.js';
import { MorphAudio } from '../vowel-morph/morph-audio.js';
import { HarmonicBars } from '../vowel-morph/morph-plots.js';
import { analyzeDrawnTake, estimateStartMs, positionAt, undoLastTake, thinPath, MAX_DRAW_TAKE_SEC, WINDOW_SEC, HOP_SEC } from '../vowel-morph/take-model.js';
import { playDrum, drumCounters } from './drums.js';
import { PoseTracker } from './pose-tracker.js';
import { poseTourSteps } from './pose-tour.js';
import * as store from './pose-store.js';
import { analyzeMySound, warningText, REC_SEC } from './sound-analysis.js';
import {
  LM, BEND_JOINTS, LIFT_JOINTS, LOST_GRACE_MS, DEFAULT_CAL, CLAP_BUFFER, PROJECT_KEY,
  poseAngles, anglesToPoint, pointToAngles, heldAngles, smoothAngles, anchorPoint, estimateRange, scaleRange, setRangeEnd,
  percentPer10Deg, poseInRange, describePose, takeToAngles, poseTakeAnchors,
  starterAnchors, RegionTrigger, loadProject, cleanAnchor, clamp01,
} from './pose-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ffb74d', '#4dd0c8', '#c792ea', '#f07178', '#c3e88d', '#82aaff', '#ffcb6b', '#89ddff', '#ff9cac', '#a5d6a7'];
const TAKE_COLORS = ['#7ee787', '#ffa657', '#d2a8ff', '#79c0ff', '#ff7b72'];
const COUNTDOWN_SEC = 3;
const HOLD_SEC = 1;
const ADJUST_SEC = 6;
const STALE_MS = 500; // no camera result for this long → tracking lost
const GHOST_MS = 7000; // how long moved dots show where they were before a range change
const AXES = [{ key: 'bend', label: 'Right elbow bend', short: 'elbow bend', dir: 'left ↔ right' }, { key: 'lift', label: 'Left arm lift', short: 'arm lift', dir: 'down ↕ up' }];

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}
const deg = (v) => (Number.isFinite(v) ? `${v.toFixed(0)}°` : '—');
const pct = (w) => `${(w * 100).toFixed(0)} %`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const copyCal = (c) => JSON.parse(JSON.stringify(c));
const calText = (c) => `elbow bend ${deg(c.bend.lo)}–${deg(c.bend.hi)}, arm lift ${deg(c.lift.lo)}–${deg(c.lift.hi)}`;

function readStored() {
  try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function mount(root) {
  const project = loadProject(readStored());
  const save = () => { try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch { /* private mode: works until reload */ } };
  const recs = new Map(); // recordingId → { samples, sampleRate }
  store.loadRecordings().then((r) => { for (const x of r.list) recs.set(x.id, x); renderAll(); });

  const st = {
    camera: 'off', cameraMsg: 'Camera off.',
    sim: false, simAngles: { bend: 15, lift: 15 },
    raw: null, lastResultMs: -Infinity, lastOkMs: -Infinity,
    angles: null, lastSmooth: performance.now(),
    dot: { x: 0, y: 0 }, tracking: false, lostText: '',
    soundOn: false, everPlayed: false, playedMine: false, lastClapAt: -Infinity,
    capture: null, countdown: '', busy: false,
    trail: [], landmarks: null, frameSize: { w: 640, h: 480 },
    mode: 'play', // 'play' | 'place' | 'draw'
    selectedId: null, ghosts: [], ghostUntil: 0,
    prevCal: null, calSource: project.calSource || 'default', rangeMsg: '', rangeReport: null,
    replay: null, previewUntil: 0, gateWanted: null, drawStatus: '', tick: 0,
  };
  let draft = null; // the "Add my sound" panel: { anchorId, name, rec, recordingId, result, analysis, source, msg, poseMsg }
  let drawing = null; // a drawn take in progress
  const clap = new RegionTrigger({ buffer: CLAP_BUFFER });
  const audio = new MorphAudio({ onChange: () => renderSoundState() });
  const mic = new MicInput({ onChange: () => {} });
  const recorder = new VowelRecorder();
  const tracker = new PoseTracker({ onResult: (r) => onPose(r), onStatus: (s, m) => { st.camera = s; st.cameraMsg = m; renderCamera(); } });
  const colorOf = (a) => COLORS[Math.max(0, project.anchors.findIndex((x) => x.id === a.id)) % COLORS.length];
  const takeColor = (id) => TAKE_COLORS[Math.max(0, project.takes.findIndex((t) => t.id === id)) % TAKE_COLORS.length];
  const mine = () => project.anchors.filter((a) => a.source !== 'starter');
  const anchorById = (id) => project.anchors.find((a) => a.id === id);
  const camReady = () => st.sim || tracker.running || st.feeding;

  // ───────────── pose input ─────────────
  function onPose(r) {
    st.lastResultMs = performance.now();
    st.landmarks = r.landmarks;
    if (r.width) st.frameSize = { w: r.width, h: r.height };
    const raw = poseAngles(r.landmarks, { world: r.world, aspect: (r.width || 640) / (r.height || 480) });
    st.raw = raw;
    if (raw.ok) {
      const now = performance.now();
      const dt = (now - st.lastSmooth) / 1000;
      st.lastSmooth = now;
      st.angles = smoothAngles(st.lastOkMs > now - 300 ? st.angles : null, raw, dt);
      st.lastOkMs = now;
      if (st.capture) st.capture.samples.push({ bend: raw.bend, lift: raw.lift });
    } else if (st.capture) st.capture.lost.push(...raw.lost);
    drawPreview();
  }

  // ───────────── page ─────────────
  const video = h('video', { class: 'pm-video', muted: true, playsinline: true, 'aria-hidden': 'true' });
  const overlay = h('canvas', { class: 'pm-overlay', width: 640, height: 480, 'aria-label': 'Camera preview with the six tracked joints marked' });
  const countdownEl = h('div', { class: 'pm-countdown', 'aria-live': 'assertive' });
  const camBtn = h('button', { class: 'btn primary pm-cam-btn', onclick: () => (tracker.running ? tracker.stop() : tracker.start(video)) }, '📷 Enable camera');
  const camMsg = h('div', { class: 'pm-cam-msg', 'aria-live': 'polite' });
  const simChk = h('input', { type: 'checkbox', onchange: () => { st.sim = simChk.checked; simBox.hidden = !st.sim; renderSteps(); } });
  const mkSim = (label, key, max) => h('input', { type: 'range', min: '0', max: String(max), step: '1', value: String(st.simAngles[key]), 'aria-label': label, oninput: (e) => { st.simAngles[key] = Number(e.target.value); } });
  const simBend = mkSim('Simulated right elbow bend in degrees', 'bend', 170);
  const simLift = mkSim('Simulated left arm lift in degrees', 'lift', 180);
  const simBox = h('div', { class: 'pm-sim', hidden: true },
    h('label', { class: 'pm-sim-row' }, h('span', {}, 'Right elbow bend'), simBend),
    h('label', { class: 'pm-sim-row' }, h('span', {}, 'Left arm lift'), simLift));

  // angle readout with the range ends and the selected sound's target
  const angleUi = {};
  for (const ax of AXES) {
    const fill = h('span', { class: 'pm-bar-fill' });
    const target = h('span', { class: 'pm-bar-target', hidden: true, title: 'Pose of the selected sound' });
    angleUi[ax.key] = {
      value: h('div', { class: 'pm-angle' }),
      bar: h('div', { class: 'pm-bar' }, fill, target), fill, target,
      lo: h('span', {}), hi: h('span', {}),
    };
  }
  const trackOut = h('div', { class: 'pm-track' });
  const posOut = h('div', { class: 'pm-pos muted' });
  const targetOut = h('div', { class: 'pm-target-msg', 'aria-live': 'polite' });

  // ── range ──
  const adjustBtn = h('button', { class: 'btn primary pm-adjust-btn', onclick: () => adjustToMovement() }, '🎯 Adjust to my movement');
  const rangeNow = h('div', { class: 'pm-range-now' });
  const rangeMsg = h('div', { class: 'pm-range-msg', 'aria-live': 'polite' });
  const undoRangeBtn = h('button', { class: 'btn small pm-undo-range', onclick: () => { if (st.prevCal) applyRange(st.prevCal, 'Went back to the previous range.', st.prevSource || 'default'); } }, '↶ Undo range change');
  const resetRangeBtn = h('button', { class: 'btn small', onclick: () => applyRange(copyCal(DEFAULT_CAL), 'Back to the default range.', 'default') }, 'Default range');
  const tuneUi = {};
  const tuneRows = AXES.map((ax) => {
    const lo = h('input', { type: 'range', min: '0', max: '180', step: '1', 'aria-label': `${ax.label}: start of range in degrees`, onchange: () => applyRange({ ...project.cal, [ax.key]: setRangeEnd(project.cal[ax.key], 'lo', lo.value, ax.key) }, `${ax.label} range start set to ${deg(+lo.value)}.`, 'custom') });
    const hi = h('input', { type: 'range', min: '0', max: '180', step: '1', 'aria-label': `${ax.label}: end of range in degrees`, onchange: () => applyRange({ ...project.cal, [ax.key]: setRangeEnd(project.cal[ax.key], 'hi', hi.value, ax.key) }, `${ax.label} range end set to ${deg(+hi.value)}.`, 'custom') });
    const out = h('span', { class: 'muted' });
    tuneUi[ax.key] = { lo, hi, out };
    return h('div', { class: 'pm-tune-row', 'data-axis': ax.key },
      h('b', {}, ax.label),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn small pm-widen', onclick: () => applyRange({ ...project.cal, [ax.key]: scaleRange(project.cal[ax.key], 1.25, ax.key) }, `${ax.label}: wider range, so the same movement moves the marker less.`, 'custom') }, 'Small moves jump too far'),
        h('button', { class: 'btn small pm-narrow', onclick: () => applyRange({ ...project.cal, [ax.key]: scaleRange(project.cal[ax.key], 0.8, ax.key) }, `${ax.label}: narrower range, so the edges of the map are easier to reach.`, 'custom') }, 'I can’t reach the edges')),
      h('label', { class: 'pm-sim-row' }, h('span', {}, 'Start'), lo),
      h('label', { class: 'pm-sim-row' }, h('span', {}, 'End'), hi),
      out);
  });

  // ── map ──
  const square = svg('svg', { viewBox: '0 0 1000 1000', class: 'pm-square', role: 'img', 'aria-label': 'Sound map. x = right elbow bend, y = left arm lift. The white marker is your current pose; coloured dots are sounds; lines are drawn takes.' });
  const gGrid = svg('g', { class: 'pm-grid' });
  for (let i = 1; i < 4; i++) gGrid.append(svg('line', { x1: i * 250, y1: 0, x2: i * 250, y2: 1000 }), svg('line', { x1: 0, y1: i * 250, x2: 1000, y2: i * 250 }));
  const gClap = svg('g', { class: 'pm-clap' });
  const gTakes = svg('g', { class: 'pm-takes' });
  const gGhosts = svg('g', { class: 'pm-ghosts' });
  const gLines = svg('g');
  const gAnchors = svg('g', { class: 'pm-anchors' });
  const trail = svg('polyline', { class: 'pm-trail', points: '' });
  const dotEl = svg('g', { class: 'pm-dot' }, svg('circle', { r: 26 }), svg('circle', { class: 'pm-dot-core', r: 9 }));
  const axisLabels = svg('g', { class: 'pm-axis-labels' },
    svg('text', { x: 500, y: 985, 'text-anchor': 'middle' }, 'right elbow: straight → bent'),
    svg('text', { x: 22, y: 500, transform: 'rotate(-90 22 500)', 'text-anchor': 'middle' }, 'left arm: down → lifted'));
  square.append(gGrid, gClap, axisLabels, gTakes, gGhosts, gLines, trail, gAnchors, dotEl);
  const addBtn = h('button', { class: 'btn seg pm-add-btn', onclick: () => (draft ? closeDraft() : openDraft()) }, '🎤 Add my sound');
  const drawBtn = h('button', { class: 'btn seg pm-draw-btn', onclick: () => setMode(st.mode === 'draw' ? 'play' : 'draw') }, '✏️ Draw + record');
  const undoTakeBtn = h('button', { class: 'btn pm-undo-take', onclick: () => undoTake() }, '↶ Undo last take');
  const mapHint = h('div', { class: 'pm-map-hint', 'aria-live': 'polite' });

  // ── sound ──
  const soundBtn = h('button', { class: 'btn primary big pm-sound-btn', onclick: () => (st.soundOn ? stopSound() : startSound()) }, '▶ Start sound');
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volumeValue), 'aria-label': 'Volume', oninput: () => audio.setVolume(Number(volume.value)) });
  const f0Out = h('div', { class: 'pm-f0' });
  const weightsOut = h('div', { class: 'pm-weights' });
  const harmCanvas = h('canvas', { class: 'pm-harm', 'aria-label': 'Harmonic strengths the synthesizer is playing now, in dB' });
  const harmBars = new HarmonicBars(harmCanvas);
  const startersChk = h('input', { type: 'checkbox', checked: project.useStarters, onchange: () => { project.useStarters = startersChk.checked; save(); renderAll(); } });
  const powerSel = h('select', { 'aria-label': 'Distance influence', onchange: () => { project.power = Number(powerSel.value); save(); } },
    POWERS.map((x) => h('option', { value: String(x.p), selected: project.power === x.p || null }, `${x.name} (power ${x.p})`)));
  const clapChk = h('input', { type: 'checkbox', checked: project.clap.on, onchange: () => setClap(clapChk.checked) });
  const clapHere = h('button', { class: 'btn small', onclick: () => { project.clap.region.x = st.dot.x; project.clap.region.y = st.dot.y; clap.prime(st.dot, project.clap.region); save(); renderMap(); } }, 'Use my current pose as the clap region');
  const clapOut = h('div', { class: 'pm-clap-flash', 'aria-live': 'polite' });
  const clapCard = h('details', { class: 'pm-clap-box' },
    h('summary', {}, '👏 Extra: clap on a pose'),
    h('label', { class: 'check pm-clap-toggle' }, clapChk, h('b', {}, 'Clap on the final pose'), ' (optional)'),
    clapOut, clapHere,
    h('p', { class: 'help' }, 'Plays one clap when you enter the ring, stays quiet while you hold it, and is ready again once you leave past the dashed ring and come back.'));

  // ── add my sound ──
  const addCard = h('section', { class: 'card pm-add', hidden: true });
  const listEl = h('div', { class: 'pm-list' });
  const takesEl = h('div', { class: 'pm-take-list' });
  const tourBtn = h('button', { class: 'btn primary pm-tour-btn', onclick: () => tour.start(0) }, '🧭 Tour');
  const stepsEl = h('ol', { class: 'pm-steps', 'aria-label': 'Workflow' });

  const cameraCard = h('section', { class: 'card pm-camera' },
    h('h2', {}, 'Camera'),
    h('div', { class: 'row gap wrap' }, camBtn, h('label', { class: 'check' }, simChk, 'Practice without camera (sliders)')),
    camMsg,
    h('div', { class: 'pm-preview' }, video, overlay, countdownEl),
    h('p', { class: 'help pm-frame-help' }, 'Stand back until both shoulders, elbows, wrists and hips are in the picture. The preview is mirrored. Blue marks the right shoulder–elbow–wrist (elbow bend), pink the left hip–shoulder–elbow (arm lift), red ✕ a lost joint. Video stays on this computer.'),
    simBox);
  const angleCard = h('section', { class: 'card pm-readout' },
    h('h2', {}, 'Your two angles'),
    h('div', { class: 'pm-angles' }, AXES.map((ax) => h('div', { class: 'pm-angle-box', 'data-axis': ax.key },
      h('div', { class: 'muted' }, `${ax.label} → ${ax.dir}`), angleUi[ax.key].value, angleUi[ax.key].bar,
      h('div', { class: 'pm-bar-ends muted' }, angleUi[ax.key].lo, angleUi[ax.key].hi)))),
    trackOut, posOut, targetOut);
  const rangeCard = h('section', { class: 'card pm-range' },
    h('h2', {}, 'Movement range'),
    rangeNow,
    h('p', { class: 'help' }, `Optional. The default range fits most people, so you can play as soon as the camera sees both arms. If the marker feels too jumpy or you can’t reach part of the map, press Adjust: after a ${COUNTDOWN_SEC} s countdown, move both arms comfortably through everything you want to use for ${ADJUST_SEC} s (bend and straighten the right elbow, raise and lower the left arm).`),
    h('div', { class: 'row gap wrap' }, adjustBtn, undoRangeBtn, resetRangeBtn),
    rangeMsg,
    h('details', { class: 'pm-tune' }, h('summary', {}, 'Fine-tune the range'), tuneRows),
    h('p', { class: 'help pm-range-rule' }, 'Your saved sounds stay on their poses. Each sound you placed (by pose, by clicking, or by drawing a take) is saved as the two angles of that pose. When the range changes, its dot moves on the map so that the same pose still lands on it and still plays exactly that sound; you do not need to reposition anything. Only the blend between sounds changes a little, because the distances on the map change. Starter sounds stay at the corners of whatever range you use. A sound whose pose is outside the new range gets a dashed ring: widen the range or redo its position.'));
  const soundCard = h('section', { class: 'card pm-sound' },
    h('div', { class: 'row gap wrap' }, soundBtn, h('label', { class: 'row gap' }, 'Volume', volume)),
    f0Out,
    h('div', { class: 'muted pm-sub' }, 'What you hear now: share of each sound'),
    weightsOut,
    h('div', { class: 'muted pm-sub' }, 'Harmonic strengths being synthesized (dB, harmonic number below)'),
    harmCanvas,
    h('div', { class: 'row gap wrap pm-sound-opts' },
      h('label', { class: 'check' }, startersChk, 'Starter sounds on the map'),
      h('label', { class: 'row gap' }, 'Distance influence', powerSel)),
    clapCard);
  const soundsCard = h('section', { class: 'card pm-sounds' },
    h('h2', {}, 'Sounds on the map'),
    listEl,
    h('div', { class: 'row gap wrap' }, h('button', { class: 'btn small', onclick: () => restoreStarters() }, '↺ Restore starter sounds')),
    h('h3', {}, 'Drawn takes'),
    takesEl);

  root.append(h('div', { class: 'pm-page' },
    h('div', { class: 'page-top' },
      h('div', {}, h('h1', {}, 'Motion Morph'),
        h('p', { class: 'lead' }, 'Teach the sound map your own sounds and poses, then play them silently with your arms. The camera measures how bent your right elbow is (left ↔ right on the map) and how far your left arm is lifted from your torso (down ↕ up). Nearby sounds blend into one voice: hold a pose and the sound holds; move toward another pose and it blends toward it.')),
      h('div', { class: 'pm-top-actions' }, tourBtn)),
    stepsEl,
    h('div', { class: 'pm-layout' },
      h('div', { class: 'pm-col' }, cameraCard, angleCard, rangeCard),
      h('div', { class: 'pm-col' },
        h('div', { class: 'pm-map-tools' }, h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Add sounds' }, addBtn, drawBtn), undoTakeBtn),
        mapHint,
        h('div', { class: 'pm-square-wrap' }, square),
        addCard,
        soundCard,
        soundsCard))));

  // ───────────── countdown and capture ─────────────
  function beep(freq = 880, dur = 0.08) {
    try {
      const ctx = audio.ensure();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = freq;
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.15, t + 0.005); g.gain.setTargetAtTime(0, t + dur, 0.02);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.2);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    } catch { /* no audio: the countdown is still shown */ }
  }

  /** Counts down, then collects tracked angles for `sec` seconds. Returns { samples, lost } or null if it could not start. */
  async function countdownAndCollect(label, sec, during) {
    if (st.busy) return null;
    if (!camReady()) return { error: 'Turn on the camera first (or tick Practice without camera).' };
    st.busy = true;
    renderButtons();
    for (let s = COUNTDOWN_SEC; s > 0; s--) { st.countdown = `${label}\n${s}`; renderCountdown(); beep(660); await sleep(1000); }
    beep(990, 0.15);
    const cap = { samples: [], lost: [] };
    st.capture = cap;
    const end = performance.now() + sec * 1000;
    while (performance.now() < end) {
      st.countdown = during(Math.max(0, (end - performance.now()) / 1000)); renderCountdown();
      if (st.sim) cap.samples.push({ ...st.simAngles });
      await sleep(st.sim ? 40 : 50);
    }
    st.capture = null;
    st.countdown = ''; renderCountdown();
    beep(1320, 0.1);
    st.busy = false;
    renderButtons();
    return cap;
  }
  const lostList = (cap) => [...new Set(cap.lost)].join(', ');

  // ───────────── movement range ─────────────
  async function adjustToMovement() {
    const cap = await countdownAndCollect('Get ready to move', ADJUST_SEC, (left) => `Move both arms\ncomfortably\n${left.toFixed(0)} s`);
    if (!cap) return;
    if (cap.error) { st.rangeMsg = cap.error; renderRange(); return; }
    const est = estimateRange(cap.samples, project.cal);
    if (!est.ok) { st.rangeMsg = `${est.message}${cap.lost.length ? ` Lost during the move: ${lostList(cap)}.` : ''} Step back so the preview shows all six joints, then try again.`; renderRange(); return; }
    const before = copyCal(project.cal);
    const parts = AXES.map((ax) => {
      const r = est.report[ax.key];
      return r.kept ? `${ax.label}: you moved only ${deg(r.moved)}, so its range stays ${deg(before[ax.key].lo)}–${deg(before[ax.key].hi)}.`
        : `${ax.label}: you used ${deg(r.seen[0])}–${deg(r.seen[1])} → range ${deg(est.cal[ax.key].lo)}–${deg(est.cal[ax.key].hi)} (was ${deg(before[ax.key].lo)}–${deg(before[ax.key].hi)}).`;
    });
    st.rangeReport = { before, after: copyCal(est.cal), report: est.report, count: est.count };
    applyRange(est.cal, `Adjusted from ${est.count} camera readings. ${parts.join(' ')}`, 'adjusted');
  }

  /** Every range change goes through here: keeps one undo step, shows where personal sounds moved. */
  function applyRange(cal, message, source) {
    const before = copyCal(project.cal);
    const same = ['bend', 'lift'].every((k) => before[k].lo === cal[k].lo && before[k].hi === cal[k].hi);
    st.prevCal = same ? st.prevCal : before;
    st.prevSource = st.calSource;
    project.cal = copyCal(cal);
    project.calSource = source;
    st.calSource = source;
    // where personal sounds were → where they are now (same pose, new range)
    const ghosts = [];
    for (const a of mine()) {
      const from = anglesToPoint(a.angles, before);
      const to = anglesToPoint(a.angles, project.cal);
      if (Math.hypot(from.x - to.x, from.y - to.y) > 0.01) ghosts.push({ from, to, color: colorOf(a) });
    }
    for (const t of project.takes) {
      if (t.hidden || !t.points.length) continue;
      const p = t.points[Math.floor(t.points.length / 2)];
      const from = anglesToPoint(p, before);
      const to = anglesToPoint(p, project.cal);
      if (Math.hypot(from.x - to.x, from.y - to.y) > 0.01) ghosts.push({ from, to, color: takeColor(t.id) });
    }
    st.ghosts = ghosts;
    st.ghostUntil = performance.now() + GHOST_MS;
    const outside = mine().filter((a) => !poseInRange(a.angles, project.cal));
    const moved = ghosts.length;
    const sens = AXES.map((ax) => `10° of ${ax.short} now moves the marker ${percentPer10Deg(project.cal[ax.key]).toFixed(0)} % of the map (was ${percentPer10Deg(before[ax.key]).toFixed(0)} %)`).join('; ');
    st.rangeMsg = `${message} ${same ? '' : `${sens}.`}`
      + (moved ? ` ${moved} of your sound${moved === 1 ? '' : 's'}/takes moved on the map (faint circles show where they were); each still plays when you hold its pose.` : '')
      + (outside.length ? ` Outside the new range: ${outside.map((a) => a.name).join(', ')} (dashed ring). Widen the range or redo its position.` : '');
    if (!same && source !== 'adjusted') st.rangeReport = null;
    save();
    renderAll();
  }

  // ───────────── add my sound ─────────────
  function sourceOptions() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('vowelMorph.project.v1') || 'null'); } catch { raw = null; }
    return loadMorphProject(raw).vowels.filter(isUsable).map((v) => ({ id: `vm:${v.id}`, label: `${v.name} (${fmtHz(v.analysis.f0)})`, name: v.name, analysis: { status: 'ok', f0: v.analysis.f0, amps: v.analysis.amps } }));
  }

  function nextName() {
    const names = new Set(project.anchors.map((a) => a.name));
    for (let i = 1; ; i++) if (!names.has(`My sound ${i}`)) return `My sound ${i}`;
  }

  function openDraft(anchor = null) {
    if (st.mode === 'draw') setMode('play');
    draft = anchor
      ? { anchorId: anchor.id, name: anchor.name, rec: recs.get(anchor.recordingId) || null, recordingId: anchor.recordingId, result: null, analysis: anchor.analysis, source: anchor.source, msg: '', poseMsg: '' }
      : { anchorId: null, name: nextName(), rec: null, recordingId: null, result: null, analysis: null, source: 'recorded', msg: '', poseMsg: '' };
    if (anchor) st.selectedId = anchor.id;
    renderAll();
    addCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function closeDraft() {
    draft = null;
    if (st.mode === 'place') setMode('play');
    renderAll();
  }

  async function recordDraft() {
    if (!draft || st.busy) return;
    stopSound();
    stopReplay();
    draft.msg = 'Opening the microphone…';
    renderAdd();
    await mic.start();
    if (!mic.listening) { draft.msg = mic.error ? `${mic.error.title}. ${mic.error.message}` : 'The microphone did not start.'; renderAdd(); return; }
    st.busy = true;
    renderButtons();
    draft.msg = `Recording… keep one steady sound going for ${REC_SEC} s`;
    renderAdd();
    const result = await recorder.start(mic, REC_SEC, { onProgress: (sec) => { if (draft) { draft.msg = `Recording… ${sec.toFixed(1)} / ${REC_SEC} s. Keep it steady.`; renderAddMsg(); } } });
    mic.stop();
    st.busy = false;
    renderButtons();
    if (!draft) return;
    if (result.error) { draft.msg = `Recording failed: ${result.error}`; renderAdd(); return; }
    const rec = { samples: result.samples, sampleRate: result.sampleRate };
    const r = analyzeMySound(rec);
    draft.rec = rec;
    draft.result = r;
    draft.source = 'recorded';
    if (!r.ok) {
      draft.msg = '';
      // A failed redo of a saved sound keeps the sound it had.
      if (!draft.anchorId) draft.analysis = null;
      renderAdd();
      return;
    }
    draft.analysis = r.analysis;
    const id = newId('rec');
    recs.set(id, rec);
    store.putRecording({ id, sampleRate: rec.sampleRate, samples: rec.samples, createdAt: new Date().toISOString() });
    const old = draft.recordingId;
    draft.recordingId = id;
    draft.msg = 'Recorded and analyzed.';
    if (draft.anchorId) {
      const a = anchorById(draft.anchorId);
      if (a) { a.analysis = r.analysis; a.recordingId = id; a.source = 'recorded'; save(); draft.msg = `Recorded again. “${a.name}” now plays the new sound at the same pose.`; }
    }
    if (old && old !== id && !project.anchors.some((a) => a.recordingId === old)) { recs.delete(old); store.deleteRecording(old); }
    renderAll();
  }

  function useVowelMorph(optId) {
    const o = sourceOptions().find((x) => x.id === optId);
    if (!o || !draft) return;
    draft.analysis = o.analysis;
    draft.source = 'vowel-morph';
    draft.rec = null;
    draft.result = null;
    if (draft.name.startsWith('My sound')) draft.name = o.name;
    draft.msg = `Using “${o.name}” from Vowel Morph (already analyzed there).`;
    if (draft.anchorId) { const a = anchorById(draft.anchorId); if (a) { a.analysis = o.analysis; a.source = 'vowel-morph'; a.recordingId = null; save(); } }
    renderAll();
  }

  async function captureDraftPose() {
    if (!draft || !draft.analysis) return;
    const cap = await countdownAndCollect(`Step back and get into\nthe pose for “${draft.name}”`, HOLD_SEC, () => 'Hold still…');
    if (!cap || !draft) return;
    if (cap.error) { draft.poseMsg = cap.error; renderAdd(); return; }
    const held = heldAngles(cap.samples);
    if (!held) { draft.poseMsg = `I couldn’t see both arms while you held the pose${cap.lost.length ? ` (lost: ${lostList(cap)})` : ''}, so nothing was changed. Step back until the preview shows all six joints without a red ✕, then try again.`; renderAdd(); return; }
    const spread = Math.max(...cap.samples.map((s) => s.bend)) - Math.min(...cap.samples.map((s) => s.bend)) + Math.max(...cap.samples.map((s) => s.lift)) - Math.min(...cap.samples.map((s) => s.lift));
    commitDraft({ bend: held.bend, lift: held.lift }, 'pose', spread > 25 ? ' You moved quite a bit during the hold, so the middle reading was used; redo the position if it feels off.' : '');
  }

  function commitDraft(angles, placedBy, note = '') {
    if (!draft || !draft.analysis) return;
    const ang = { bend: Math.round(angles.bend * 10) / 10, lift: Math.round(angles.lift * 10) / 10 };
    let a = draft.anchorId && anchorById(draft.anchorId);
    if (a) {
      a.angles = ang; a.pos = null; a.placedBy = placedBy; a.name = draft.name; a.pose = describePose(ang);
    } else {
      a = cleanAnchor({ id: newId('pm'), name: draft.name, source: draft.source, analysis: draft.analysis, recordingId: draft.recordingId, angles: ang, placedBy, pose: describePose(ang) });
      project.anchors.push(a);
      draft.anchorId = a.id;
    }
    st.selectedId = a.id;
    draft.poseMsg = `Saved “${a.name}” at ${describePose(ang)}${placedBy === 'click' ? ' (the pose that reaches the spot you clicked)' : ''}.${note}`;
    if (!poseInRange(ang, project.cal)) draft.poseMsg += ' This pose is outside the current range, so its dot sits on the edge (dashed ring).';
    save();
    if (st.mode === 'place') setMode('play');
    renderAll();
  }

  function playAnchorOriginal(a) {
    const rec = a && recs.get(a.recordingId);
    if (!rec) return;
    stopSound();
    st.previewUntil = performance.now() + (rec.samples.length / rec.sampleRate) * 1000 + 100;
    audio.setGate(1, 0.01); st.gateWanted = 1;
    audio.playOriginal(rec, { label: `Original: ${a.name}` });
  }

  function playSynth(analysis, label) {
    if (!analysis) return;
    stopSound();
    stopReplay();
    st.previewUntil = performance.now() + 1600;
    audio.setGate(1, 0.01); st.gateWanted = 1;
    const p = paramsOf({ analysis });
    if (p && audio.playSynth(p, label)) setTimeout(() => { if (!st.soundOn && audio.label === label) audio.stop(); }, 1500);
  }

  function restoreStarters() {
    const have = new Set(project.anchors.map((a) => a.id));
    project.anchors.push(...starterAnchors().filter((a) => !have.has(a.id)));
    project.useStarters = true;
    startersChk.checked = true;
    save();
    renderAll();
  }

  function removeAnchor(a) {
    if (a.source !== 'starter' && !window.confirm(`Remove “${a.name}” from the map?`)) return;
    project.anchors = project.anchors.filter((x) => x !== a);
    if (a.recordingId && !project.anchors.some((x) => x.recordingId === a.recordingId)) { recs.delete(a.recordingId); store.deleteRecording(a.recordingId); }
    if (draft && draft.anchorId === a.id) draft = null;
    if (st.selectedId === a.id) st.selectedId = null;
    save();
    renderAll();
  }

  // ───────────── map modes and drawn takes ─────────────
  async function setMode(m) {
    if (drawing) return; // finish the take first
    const was = st.mode;
    st.mode = m;
    if (m === 'draw') {
      draft = null;
      stopSound();
      stopReplay();
      st.drawStatus = '';
      renderAll();
      if (was !== 'draw') await armDrawMic();
    } else if (was === 'draw') mic.stop();
    renderAll();
  }

  async function armDrawMic() {
    if (mic.listening) return true;
    st.drawStatus = 'Opening the microphone…';
    renderMapHint();
    await mic.start();
    if (!mic.listening) {
      const err = mic.error;
      st.drawStatus = err ? `${err.title}. ${err.message.replace(/Enable Microphone/g, 'Draw + record')}` : 'The microphone did not start.';
      renderMapHint();
      return false;
    }
    st.drawStatus = 'Microphone ready. Press down on the map, change your voice (for example ah → ee → oo) while you draw, and let go to finish.';
    renderMapHint();
    return true;
  }

  function pointFromEvent(e) {
    const r = square.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height), r };
  }

  async function startDrawing(e, p) {
    stopSound();
    const d = { pointerId: e.pointerId, path: [{ x: p.x, y: p.y, t: e.timeStamp }], arrivals: [], liveLine: null, done: false, cal: copyCal(project.cal) };
    drawing = d;
    square.setPointerCapture(e.pointerId);
    d.liveLine = svg('polyline', { class: 'pm-live-path', points: '' });
    gTakes.append(d.liveLine);
    updateLivePath();
    if (!mic.listening && !(await armDrawMic())) { drawing = null; d.liveLine.remove(); return; }
    if (d.done) { drawing = null; d.liveLine.remove(); st.drawStatus = 'That was too quick: the microphone was still opening. Press down and draw again.'; renderMapHint(); return; }
    st.drawStatus = 'Recording… keep singing and drawing. Let go to finish.';
    renderMapHint();
    renderButtons();
    const sr = mic.sampleRate;
    d.recording = recorder.start(mic, MAX_DRAW_TAKE_SEC, {
      onProgress: (sec) => {
        d.arrivals.push({ ms: performance.now(), count: Math.round(sec * sr) });
        if (!d.done) { st.drawStatus = `Recording… ${sec.toFixed(1)} s (up to ${MAX_DRAW_TAKE_SEC} s). Let go to finish.`; renderMapHint(); }
      },
    });
    const result = await d.recording;
    if (!d.done) finishDrawing(null); // hit the time limit while still drawing
    await finishTake(d, result);
  }

  function addPathPoints(e) {
    if (!drawing || e.pointerId !== drawing.pointerId) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) { const q = pointFromEvent(ev); drawing.path.push({ x: q.x, y: q.y, t: ev.timeStamp }); }
    updateLivePath();
  }

  function updateLivePath() {
    if (!drawing || !drawing.liveLine) return;
    drawing.liveLine.setAttribute('points', drawing.path.map((q) => { const s = toSvg(q); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(' '));
  }

  function finishDrawing(e) {
    const d = drawing;
    if (!d || d.done) return;
    if (e) addPathPoints(e);
    d.done = true;
    if (d.recording) recorder.stop();
  }

  async function finishTake(d, result) {
    drawing = null;
    if (d.liveLine) d.liveLine.remove();
    if (st.mode !== 'draw') mic.stop();
    renderButtons();
    const sec = result.samples.length / result.sampleRate;
    if (result.error) { st.drawStatus = `Recording failed: ${result.error}`; renderAll(); return; }
    if (sec < WINDOW_SEC) { st.drawStatus = `That take was only ${sec.toFixed(2)} s of audio, too short for one ${WINDOW_SEC} s snippet, so nothing was kept. Press down, sing and draw a little longer.`; renderAll(); return; }
    st.drawStatus = `Analyzing ${sec.toFixed(1)} s of audio in ${WINDOW_SEC} s snippets…`;
    renderMapHint();
    await sleep(30); // let the message paint
    const startMs = estimateStartMs(d.arrivals, result.sampleRate);
    const a = analyzeDrawnTake({ samples: result.samples, sampleRate: result.sampleRate, startMs, path: d.path });
    const t0 = d.path[0].t;
    const recId = newId('rec');
    const rec = { samples: result.samples, sampleRate: result.sampleRate };
    recs.set(recId, rec);
    store.putRecording({ id: recId, sampleRate: rec.sampleRate, samples: rec.samples, createdAt: new Date().toISOString() });
    const n = project.takes.reduce((m, t) => Math.max(m, Number((/^Take (\d+)$/.exec(t.name) || [])[1]) || 0), 0) + 1;
    const mapTake = {
      id: newId('take'), name: `Take ${n}`, recordingId: recId, createdAt: new Date().toISOString(), durationSec: Math.round(sec * 100) / 100,
      path: thinPath(d.path.map((q) => ({ x: q.x, y: q.y, t: q.t - t0 }))),
      audioOffsetMs: Math.round((startMs - t0) * 10) / 10,
      points: a.points, stats: a.stats, hidden: false,
    };
    const take = takeToAngles(mapTake, d.cal);
    project.takes.push(take);
    save();
    const s = a.stats;
    const first = take.points[0];
    const last = take.points[take.points.length - 1];
    st.drawStatus = `${take.name}: ${s.usable} usable point${s.usable === 1 ? '' : 's'} from ${s.snippets} snippet${s.snippets === 1 ? '' : 's'} (skipped ${s.silent} silent, ${s.unreliable} without a reliable pitch${s.outsidePath ? `, ${s.outsidePath} before/after the drawing` : ''}).`
      + (s.usable ? ` To play it with your arms, start at ${describePose(first)} (the ● at the start of the line) and move toward ${describePose(last)}. Draw another take, or press ✏️ again to stop drawing.`
        : ' Nothing usable: sing a steady, voiced sound while drawing, or undo this take.');
    renderAll();
  }

  function undoTake() {
    const { takes, removed } = undoLastTake(project.takes);
    if (!removed) return;
    stopReplay();
    project.takes = takes;
    if (removed.recordingId) { recs.delete(removed.recordingId); store.deleteRecording(removed.recordingId); }
    st.drawStatus = `Undid ${removed.name} (${removed.points.length} point${removed.points.length === 1 ? '' : 's'}). Your recorded sounds and starters are unchanged.`;
    save();
    renderAll();
  }

  function deleteTake(take) {
    if (!window.confirm(`Delete ${take.name} and its ${take.points.length} learned points? Your other sounds are not affected.`)) return;
    stopReplay();
    project.takes = project.takes.filter((t) => t !== take);
    if (take.recordingId) { recs.delete(take.recordingId); store.deleteRecording(take.recordingId); }
    save();
    renderAll();
  }

  /** Moves the marker along a take's path at the speed it was drawn (instead of the camera). */
  function replayTake(take) {
    stopReplay();
    if (take.path.length < 2) return;
    const path = take.path.map((p) => ({ ...anglesToPoint(p, project.cal), t: p.t }));
    st.replay = { takeId: take.id, path, total: path[path.length - 1].t, startAt: performance.now(), startedSound: !st.soundOn };
    st.dot = { x: path[0].x, y: path[0].y };
    if (!st.soundOn) startSound();
    renderTakes();
  }

  function stopReplay() {
    if (!st.replay) return;
    const r = st.replay;
    st.replay = null;
    if (r.startedSound) stopSound();
    renderTakes();
  }

  function playTakeOriginal(take) {
    const rec = recs.get(take.recordingId);
    if (!rec) return;
    stopReplay();
    stopSound();
    st.previewUntil = performance.now() + (rec.samples.length / rec.sampleRate) * 1000 + 100;
    audio.setGate(1, 0.01); st.gateWanted = 1;
    audio.playOriginal(rec, { label: `Original: ${take.name}` });
  }

  // ───────────── sound ─────────────
  function placedAnchors() {
    const own = project.anchors.filter((a) => a.source !== 'starter' || project.useStarters).map((a) => ({ ...a, src: a, pos: anchorPoint(a, project.cal) }));
    const takePts = poseTakeAnchors(project.takes, project.cal).map((a) => ({ ...a, src: a }));
    return [...own, ...takePts];
  }

  function currentBlend() {
    return blendAt(placedAnchors(), st.dot, project.power);
  }

  function startSound() {
    const b = currentBlend();
    if (!b.params) { f0Out.textContent = 'Add a sound or turn the starter sounds on first.'; return; }
    if (audio.playSynth(b.params, 'Motion Morph')) { st.soundOn = true; st.everPlayed = true; }
    st.previewUntil = 0;
    st.gateWanted = null; // tick() sets the gate from tracking
    renderSoundState();
    renderSteps();
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
    if (st.soundOn && audio.kind !== 'synth') st.soundOn = false;
    soundBtn.textContent = st.soundOn ? '■ Stop sound' : '▶ Start sound';
    soundBtn.classList.toggle('danger', st.soundOn);
  }

  // ───────────── main loop ─────────────
  function tick() {
    const now = performance.now();
    st.tick++;
    if (st.sim) {
      st.angles = { ...st.simAngles };
      st.raw = { bend: st.simAngles.bend, lift: st.simAngles.lift, lost: [], ok: true };
    }
    let tracking;
    let lostText = '';
    if (st.sim) tracking = true;
    else if (!tracker.running && !st.feeding) { tracking = false; lostText = 'Camera off.'; }
    else if (now - st.lastResultMs > STALE_MS) { tracking = false; lostText = 'No camera frames.'; }
    else {
      tracking = !!st.angles && now - st.lastOkMs <= LOST_GRACE_MS;
      if (!tracking) lostText = st.raw && st.raw.noPerson ? 'No person in view: step into the picture.' : `Lost: ${st.raw ? st.raw.lost.join(', ') : 'joints'}. Keep it in view of the camera.`;
    }
    if (tracking !== st.tracking) {
      st.tracking = tracking;
      if (tracking && project.clap.on) clap.prime(anglesToPoint(st.angles, project.cal), project.clap.region);
      renderSteps();
    }
    st.lostText = lostText;
    if (st.replay) {
      const t = now - st.replay.startAt;
      const q = positionAt(st.replay.path, Math.min(t, st.replay.total));
      if (q) st.dot = q;
      if (t >= st.replay.total) stopReplay();
    } else if (tracking) {
      st.dot = anglesToPoint(st.angles, project.cal);
      st.trail.push({ ...st.dot });
      if (st.trail.length > 60) st.trail.shift();
    }
    // gate: fade out while tracking is lost, except for previews and replays
    const want = now < st.previewUntil || st.replay ? 1 : tracking ? 1 : 0;
    if (want !== st.gateWanted) { audio.setGate(want, want ? 0.05 : 0.15); st.gateWanted = want; }
    const b = currentBlend();
    if (st.soundOn && b.params) audio.update(b.params);
    if (st.soundOn && tracking && b.params && !st.playedMine) {
      const share = b.contributions.filter((c) => c.vowel.src.source !== 'starter').reduce((s, c) => s + c.weight, 0);
      if (share > 0.6) { st.playedMine = true; renderSteps(); }
    }
    if (tracking && project.clap.on && clap.update(st.dot, project.clap.region, now)) {
      try { audio.ensure(); playDrum(audio.ctx, audio.volume, 'clap'); } catch { /* no audio */ }
      st.lastClapAt = now;
    }
    if (st.ghosts.length && now > st.ghostUntil) { st.ghosts = []; renderGhosts(); }
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
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); // mirror, like a mirror
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
    const chain = (ids, color) => {
      ctx.lineWidth = 6; ctx.strokeStyle = color; ctx.lineCap = 'round';
      ctx.beginPath();
      ids.forEach((i, k) => { const p = P(i); if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      for (const i of ids) {
        const p = P(i);
        if (p.ok) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
        else { ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(p.x - 12, p.y - 12); ctx.lineTo(p.x + 12, p.y + 12); ctx.moveTo(p.x + 12, p.y - 12); ctx.lineTo(p.x - 12, p.y + 12); ctx.stroke(); }
      }
    };
    chain(BEND_JOINTS, '#58d1ff');
    chain(LIFT_JOINTS, '#ff79c6');
    ctx.font = '700 18px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    const e = P(LM.rightElbow); const s = P(LM.leftShoulder);
    if (st.raw && Number.isFinite(st.raw.bend)) ctx.fillText(`bend ${deg(st.raw.bend)}`, e.x, e.y - 18);
    if (st.raw && Number.isFinite(st.raw.lift)) ctx.fillText(`lift ${deg(st.raw.lift)}`, s.x, s.y - 18);
  }

  function renderCountdown() {
    countdownEl.textContent = st.countdown;
    countdownEl.hidden = !st.countdown;
  }

  function renderButtons() {
    const busy = st.busy || !!drawing;
    adjustBtn.disabled = busy;
    for (const b of addCard.querySelectorAll('button[data-busy]')) b.disabled = busy || b.dataset.needs === 'analysis' && !(draft && draft.analysis);
    addBtn.disabled = busy;
    drawBtn.disabled = st.busy || !!drawing;
    undoTakeBtn.disabled = !project.takes.length || !!drawing;
  }

  function renderCamera() {
    camBtn.textContent = tracker.running ? '■ Turn camera off' : '📷 Enable camera';
    camMsg.textContent = st.cameraMsg;
    camMsg.className = `pm-cam-msg ${st.camera === 'error' ? 'bad' : st.camera === 'running' ? 'ok' : ''}`;
    if (!tracker.running) { st.landmarks = null; drawPreview(); }
    renderSteps();
  }

  function renderSteps() {
    const steps = [
      ['Turn on the camera', st.tracking || st.sim],
      ['Try the starter sounds', st.everPlayed],
      ['Add my sound or Draw + record', mine().length > 0 || project.takes.some((t) => t.points.length)],
      ['Play them with your arms', st.playedMine],
    ];
    const cur = steps.findIndex((s) => !s[1]);
    stepsEl.replaceChildren(...steps.map(([label, done], i) => h('li', { class: `pm-step${done ? ' done' : ''}${i === cur ? ' current' : ''}` }, h('span', { class: 'pm-step-n' }, done ? '✓' : String(i + 1)), label)));
  }

  function renderMapHint() {
    addBtn.setAttribute('aria-pressed', draft ? 'true' : 'false');
    drawBtn.setAttribute('aria-pressed', st.mode === 'draw' ? 'true' : 'false');
    square.classList.toggle('placing', st.mode === 'place');
    square.classList.toggle('drawing', st.mode === 'draw');
    mapHint.className = `pm-map-hint${st.mode !== 'play' ? ' active' : ''}`;
    mapHint.textContent = st.mode === 'place' ? `Click anywhere on the map to put “${draft ? draft.name : 'the sound'}” there. Press Esc or “Cancel” to stop.`
      : st.mode === 'draw' ? (st.drawStatus || 'Draw + record: press down on the map, sing and draw; let go to finish.')
        : st.drawStatus || (mine().length || project.takes.length ? 'Click a dot to see the pose that plays it.' : 'Start sound and move your arms to explore the starter sounds, then choose 🎤 Add my sound or ✏️ Draw + record.');
  }

  function renderGhosts() {
    gGhosts.replaceChildren();
    for (const g of st.ghosts) {
      const a = toSvg(g.from); const b = toSvg(g.to);
      gGhosts.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: g.color, 'stroke-width': 3, 'stroke-dasharray': '6 8', 'stroke-opacity': 0.7 }),
        svg('circle', { cx: a.x, cy: a.y, r: 18, fill: 'none', stroke: g.color, 'stroke-width': 3, 'stroke-opacity': 0.6 }));
    }
  }

  function renderMap() {
    gClap.replaceChildren();
    if (project.clap.on) {
      const r = project.clap.region;
      const c = toSvg(r);
      gClap.append(
        svg('circle', { class: 'pm-clap-buffer', cx: c.x, cy: c.y, r: (r.r + CLAP_BUFFER) * 1000 }),
        svg('circle', { class: 'pm-clap-zone', cx: c.x, cy: c.y, r: r.r * 1000 }),
        svg('text', { x: c.x, y: c.y - r.r * 1000 - 14, 'text-anchor': 'middle' }, '👏 clap'));
    }
    gTakes.replaceChildren(...(drawing && drawing.liveLine ? [drawing.liveLine] : []));
    for (const t of project.takes) {
      if (t.hidden) continue;
      const col = takeColor(t.id);
      const pts = t.path.map((p) => toSvg(anglesToPoint(p, project.cal)));
      const g = svg('g', { class: 'pm-take', 'data-take-id': t.id },
        svg('polyline', { class: 'pm-take-path', points: pts.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' '), stroke: col }));
      if (pts.length) g.append(svg('circle', { class: 'pm-take-start', cx: pts[0].x, cy: pts[0].y, r: 12, fill: col }));
      for (const p of t.points) { const s = toSvg(anglesToPoint(p, project.cal)); g.append(svg('circle', { class: 'pm-take-pt', cx: s.x, cy: s.y, r: 7, fill: col })); }
      gTakes.append(g);
    }
    renderGhosts();
    gAnchors.replaceChildren();
    for (const a of placedAnchors()) {
      if (a.takeId) continue;
      const c = toSvg(a.pos);
      const outside = a.angles && !poseInRange(a.angles, project.cal);
      const sel = a.id === st.selectedId;
      gAnchors.append(svg('g', { class: `pm-anchor${a.source === 'starter' ? ' starter' : ' mine'}${outside ? ' outside' : ''}${sel ? ' selected' : ''}`, 'data-id': a.id, transform: `translate(${c.x} ${c.y})` },
        sel ? svg('circle', { class: 'pm-sel-ring', r: 36 }) : null,
        outside ? svg('circle', { class: 'pm-out-ring', r: 32 }) : null,
        svg('circle', { r: a.source === 'starter' ? 18 : 22, fill: colorOf(a.src) }),
        svg('text', { y: -34, 'text-anchor': 'middle' }, a.name.replace(/^Starter /, ''))));
    }
    renderList();
    renderTakes();
    renderRange();
    renderMapHint();
  }

  function sourceLabel(a) {
    return a.source === 'starter' ? 'starter' : a.source === 'vowel-morph' ? 'from Vowel Morph' : 'recorded here';
  }

  function renderList() {
    const rows = project.anchors.map((a) => h('div', { class: `pm-row${a.id === st.selectedId ? ' selected' : ''}`, 'data-id': a.id },
      h('span', { class: 'pm-swatch', style: { background: colorOf(a) } }),
      h('b', {}, a.name),
      h('span', { class: 'muted pm-row-info' }, `${fmtHz(a.analysis.f0)} · ${a.angles ? describePose(a.angles) : a.pose} · ${sourceLabel(a)}${a.source === 'starter' && !project.useStarters ? ' · off' : ''}${a.angles && !poseInRange(a.angles, project.cal) ? ' · outside range' : ''}`),
      h('span', { class: 'row gap wrap pm-row-btns' },
        recs.get(a.recordingId) ? h('button', { class: 'btn small', onclick: () => playAnchorOriginal(a) }, '▶ Original') : null,
        h('button', { class: 'btn small', onclick: () => playSynth(a.analysis, `Synthesized: ${a.name}`) }, '▶ Synthesized'),
        a.source !== 'starter' ? h('button', { class: 'btn small pm-edit', onclick: () => openDraft(a) }, '✎ Edit / redo') : null,
        h('button', { class: 'btn small danger', 'aria-label': `Remove ${a.name}`, onclick: () => removeAnchor(a) }, '🗑'))));
    listEl.replaceChildren(...(rows.length ? rows : [h('p', { class: 'help' }, 'No sounds yet. Restore the starter sounds or add your own.')]));
  }

  function renderTakes() {
    if (!project.takes.length) { takesEl.replaceChildren(h('p', { class: 'help' }, `No drawn takes yet. Press ✏️ Draw + record, then draw on the map while you change your voice. Each ${WINDOW_SEC} s snippet (one every ${HOP_SEC} s) is analyzed and placed where your cursor was at that moment.`)); return; }
    const latest = undoLastTake(project.takes).removed;
    takesEl.replaceChildren(
      h('p', { class: 'help' }, `Undo removes only the most recent take (${latest.name}); your other sounds stay.`),
      ...project.takes.map((t) => h('div', { class: 'pm-row pm-take-row', 'data-take-id': t.id },
        h('span', { class: 'pm-swatch', style: { background: takeColor(t.id) } }),
        h('b', {}, t.name),
        h('span', { class: 'muted pm-row-info' }, `${t.stats.usable} usable of ${t.stats.snippets} snippets · ${t.durationSec.toFixed(1)} s${t.hidden ? ' · hidden' : ''}`),
        h('span', { class: 'row gap wrap pm-row-btns' },
          recs.get(t.recordingId) ? h('button', { class: 'btn small', onclick: () => playTakeOriginal(t) }, '▶ Original') : null,
          h('button', { class: 'btn small pm-replay', disabled: t.path.length < 2 || !t.points.length || t.hidden, onclick: () => (st.replay && st.replay.takeId === t.id ? stopReplay() : replayTake(t)) }, st.replay && st.replay.takeId === t.id ? '■ Stop' : '▶ Hear along the line'),
          h('button', { class: 'btn small', onclick: () => { t.hidden = !t.hidden; save(); renderAll(); } }, t.hidden ? 'Show' : 'Hide'),
          h('button', { class: 'btn small danger', 'aria-label': `Delete ${t.name}`, onclick: () => deleteTake(t) }, '🗑')))));
  }

  function renderRange() {
    const c = project.cal;
    const src = { default: 'Default range', adjusted: 'Adjusted to your movement', custom: 'Custom range' }[st.calSource] || 'Range';
    rangeNow.replaceChildren(h('b', {}, `${src}: `), calText(c), h('div', { class: 'muted' }, AXES.map((ax) => `10° of ${ax.short} = ${percentPer10Deg(c[ax.key]).toFixed(0)} % of the map`).join(' · ')));
    rangeMsg.textContent = st.rangeMsg;
    undoRangeBtn.disabled = !st.prevCal;
    for (const ax of AXES) {
      const u = tuneUi[ax.key];
      u.lo.value = String(c[ax.key].lo); u.hi.value = String(c[ax.key].hi);
      u.out.textContent = `${deg(c[ax.key].lo)} → ${deg(c[ax.key].hi)}`;
      angleUi[ax.key].lo.textContent = deg(c[ax.key].lo);
      angleUi[ax.key].hi.textContent = deg(c[ax.key].hi);
    }
  }

  function renderAddMsg() {
    const el = addCard.querySelector('.pm-add-msg');
    if (el && draft) el.textContent = draft.msg;
  }

  function renderAdd() {
    addCard.hidden = !draft;
    if (!draft) { addCard.replaceChildren(); return; }
    const d = draft;
    const saved = d.anchorId && anchorById(d.anchorId);
    const name = h('input', { type: 'text', value: d.name, maxlength: '40', class: 'pm-name', 'aria-label': 'Name of your sound',
      oninput: () => { d.name = name.value.trim() || 'My sound'; if (saved) { saved.name = d.name; save(); renderMap(); } } });
    const r = d.result;
    const vm = sourceOptions();
    const vmSel = vm.length ? h('select', { class: 'pm-vm-sel', 'aria-label': 'Use a vowel from Vowel Morph' }, vm.map((o) => h('option', { value: o.id }, o.label))) : null;
    const an = d.analysis;
    const sm = an && an.summary;
    const heard = an ? h('div', { class: 'pm-heard' },
      h('div', {}, h('b', {}, 'What the app heard: '), d.source === 'vowel-morph' ? `a vowel analyzed in Vowel Morph with a fundamental of ${fmtHz(an.f0)} (${noteName(an.f0)}).`
        : sm ? `a fundamental (pitch) of ${fmtHz(an.f0)} (${noteName(an.f0)}), measured on the steady part ${sm.sectionSec[0]}–${sm.sectionSec[1]} s. ${sm.framesPeriodic} of ${sm.framesTotal} short frames had a clear pitch${sm.spreadCents != null ? `, which stayed within ${sm.spreadCents} cents` : ''}. ${sm.harmonicsKept} harmonics stood out above the noise${sm.strongest ? ` (strongest: harmonic ${sm.strongest})` : ''}. Level ${sm.levelDb} dBFS. ${warningText(sm.warnings)}`
          : `a fundamental of ${fmtHz(an.f0)} (${noteName(an.f0)}).`),
      h('div', {}, h('b', {}, 'What it will synthesize at this pose: '), `one steady tone at ${fmtHz(an.f0)}, built from 48 sine waves at 1×, 2×, 3×… that pitch with the strengths below. The recording itself is not played on the map; when you move between poses, the pitch and each harmonic strength blend with the neighbouring sounds.`),
      h('canvas', { class: 'pm-harm pm-draft-harm', 'aria-label': 'Harmonic strengths of your sound' })) : null;
    const fail = r && !r.ok ? h('div', { class: 'pm-fail', role: 'alert' }, h('b', {}, 'No usable estimate. '), `${r.reason} ${r.tip}`, saved ? ' The saved sound was kept unchanged.' : '', ' Press Record again to try again.') : null;
    const recBtn = h('button', { class: 'btn primary pm-rec', 'data-busy': '1', onclick: () => recordDraft() }, d.rec || (r && !r.ok) ? '↻ Redo recording' : `● Record ${REC_SEC} s`);
    const poseBtn = h('button', { class: 'btn primary pm-pose-btn', 'data-busy': '1', 'data-needs': 'analysis', onclick: () => captureDraftPose() }, saved && saved.angles ? '↻ Redo position: hold a new pose' : `📸 Use my pose (${COUNTDOWN_SEC} s countdown)`);
    const clickBtn = h('button', { class: 'btn pm-click-btn', 'data-busy': '1', 'data-needs': 'analysis', onclick: () => setMode(st.mode === 'place' ? 'play' : 'place') }, st.mode === 'place' ? 'Cancel clicking' : '🖱 Click the map instead');
    const howTo = saved && saved.angles ? h('div', { class: 'pm-howto' },
      h('b', {}, `How to play “${saved.name}” with your arms: `),
      `${st.soundOn ? '' : 'press ▶ Start sound, then '}get into the pose: ${describePose(saved.angles)}. The ◆ marks on the angle bars show the target and the white marker lands on its dot. Hold the pose and the sound holds; move toward another dot and it blends toward that sound.`) : null;
    addCard.replaceChildren(
      h('div', { class: 'row gap wrap pm-add-head' }, h('h2', {}, saved ? `Edit “${saved.name}”` : 'Add my sound'), h('button', { class: 'btn small', onclick: () => closeDraft() }, saved ? 'Done' : 'Close')),
      h('ol', { class: 'pm-add-steps' },
        h('li', {}, h('b', {}, 'Record. '), `Name it, press Record and make one steady pitched sound for ${REC_SEC} s: a sung vowel (“ah”, “ee”, “oo”), a hum (“mmm”) or another sustained note. Stay near the laptop for this part.`,
          h('div', { class: 'row gap wrap' }, h('label', { class: 'row gap' }, 'Name', name), recBtn),
          vmSel ? h('div', { class: 'row gap wrap pm-vm-row' }, 'or use one from Vowel Morph:', vmSel, h('button', { class: 'btn small', 'data-busy': '1', onclick: () => useVowelMorph(vmSel.value) }, 'Use it')) : null,
          h('div', { class: 'pm-add-msg', 'aria-live': 'polite' }, d.msg), fail),
        h('li', {}, h('b', {}, 'Check it. '), 'Compare your recording with the rebuilt version.',
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn small pm-orig', disabled: !d.rec, onclick: () => d.rec && (stopSound(), st.previewUntil = performance.now() + (d.rec.samples.length / d.rec.sampleRate) * 1000 + 100, audio.setGate(1, 0.01), st.gateWanted = 1, audio.playOriginal(d.rec, { label: 'Original' })) }, '▶ Original'),
            h('button', { class: 'btn small pm-synth', disabled: !an, onclick: () => playSynth(an, 'Synthesized') }, '▶ Synthesized')),
          heard),
        h('li', {}, h('b', {}, 'Choose its pose. '), `Press “Use my pose”, step back during the ${COUNTDOWN_SEC} s countdown (it beeps), and hold a comfortable pose for ${HOLD_SEC} s. Or click a spot on the map.`,
          h('div', { class: 'row gap wrap' }, poseBtn, clickBtn),
          h('div', { class: 'pm-pose-msg', 'aria-live': 'polite' }, d.poseMsg)),
        h('li', {}, h('b', {}, 'Play it. '), howTo || 'Once it has a pose, this tells you how to reach it.')));
    if (an) { const cv = addCard.querySelector('.pm-draft-harm'); const bars = new HarmonicBars(cv); bars.set({ amps: an.amps }); }
    renderButtons();
  }

  function draw(b, now) {
    const c = toSvg(st.dot);
    dotEl.setAttribute('transform', `translate(${c.x} ${c.y})`);
    dotEl.classList.toggle('lost', !st.tracking && !st.replay);
    trail.setAttribute('points', st.trail.map((p) => { const s = toSvg(p); return `${s.x.toFixed(0)},${s.y.toFixed(0)}`; }).join(' '));
    const a = st.angles;
    const raw = st.raw;
    const sel = st.selectedId && anchorById(st.selectedId);
    for (const ax of AXES) {
      const u = angleUi[ax.key];
      const r = project.cal[ax.key];
      const ok = raw && Number.isFinite(raw[ax.key]);
      u.value.textContent = ok ? deg(a && st.tracking ? a[ax.key] : raw[ax.key]) : '—';
      u.value.classList.toggle('lost', !ok);
      if (a) u.fill.style.width = `${clamp01((a[ax.key] - r.lo) / (r.hi - r.lo)) * 100}%`;
      const tgt = sel && sel.angles ? clamp01((sel.angles[ax.key] - r.lo) / (r.hi - r.lo)) : null;
      u.target.hidden = tgt == null;
      if (tgt != null) u.target.style.left = `${tgt * 100}%`;
    }
    trackOut.textContent = st.replay ? 'Hearing a take along its line (camera ignored until it ends)' : st.tracking ? (st.sim ? 'Tracking: practice sliders' : 'Tracking both angles') : `${st.lostText} The sound fades until tracking returns.`;
    trackOut.className = `pm-track ${st.tracking || st.replay ? 'ok' : 'bad'}`;
    posOut.textContent = `Map position x ${st.dot.x.toFixed(2)}, y ${st.dot.y.toFixed(2)}`;
    const tgtText = sel && sel.angles ? `Target for “${sel.name}” (◆ on the bars): elbow bend ${deg(sel.angles.bend)}, arm lift ${deg(sel.angles.lift)}.` : '';
    if (targetOut.textContent !== tgtText) targetOut.textContent = tgtText;
    gLines.replaceChildren();
    if (b.params) {
      // contributions grouped: each take counts as one sound
      const groups = new Map();
      for (const { vowel, weight } of b.contributions) {
        const key = vowel.takeId || vowel.id;
        const g = groups.get(key) || { name: vowel.takeId ? (project.takes.find((t) => t.id === vowel.takeId) || {}).name || 'Take' : vowel.name.replace(/^Starter /, 'Starter '), color: vowel.takeId ? takeColor(vowel.takeId) : colorOf(vowel.src), weight: 0 };
        g.weight += weight;
        groups.set(key, g);
        if (weight >= 0.01) {
          const p = toSvg(vowel.pos);
          gLines.append(svg('line', { x1: c.x, y1: c.y, x2: p.x, y2: p.y, stroke: g.color, 'stroke-width': 2 + 14 * weight, 'stroke-opacity': 0.15 + 0.75 * weight }));
        }
      }
      st.groups = [...groups.values()].sort((x, y) => y.weight - x.weight);
      if (st.tick % 4 === 0) {
        f0Out.replaceChildren(h('span', { class: 'muted' }, st.soundOn ? 'Fundamental now ' : 'Fundamental here (sound off) '), h('b', {}, `${b.params.f0.toFixed(1)} Hz`), ` ${noteName(b.params.f0)}`);
        weightsOut.replaceChildren(...st.groups.filter((g, i) => i === 0 || g.weight >= 0.005).slice(0, 6).map((g) => h('div', { class: 'pm-wrow' },
          h('span', { class: 'pm-swatch', style: { background: g.color } }), h('span', { class: 'pm-wname' }, g.name),
          h('span', { class: 'pm-wbar' }, h('span', { style: { width: `${g.weight * 100}%`, background: g.color } })), h('span', {}, pct(g.weight)))));
        harmBars.set({ amps: b.params.amps });
      }
    } else if (st.tick % 4 === 0) {
      st.groups = [];
      f0Out.textContent = 'No sounds on the map yet.';
      weightsOut.replaceChildren();
      harmBars.set({ amps: null, empty: 'No sound on the map' });
    }
    const fresh = now - st.lastClapAt < 450;
    clapOut.textContent = !project.clap.on ? 'Clap off' : fresh ? '👏 Clap!' : clap.count ? `Clap played ${clap.count}×. ${clap.inside ? 'Holding inside: quiet.' : 'Ready.'}` : 'Ready: move into the ring.';
    clapOut.classList.toggle('hit', project.clap.on && fresh);
    gClap.classList.toggle('inside', clap.inside);
  }

  function renderAll() {
    renderMap();
    renderAdd();
    renderButtons();
    renderCountdown();
    renderSoundState();
    renderSteps();
  }

  // ───────────── map pointer handling ─────────────
  function hitAnchor(p) {
    const tol = 30 / p.r.width;
    let best = null;
    let bestD = Infinity;
    for (const a of placedAnchors()) {
      if (a.takeId) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.y - p.y);
      if (d <= tol && d < bestD) { best = a; bestD = d; }
    }
    return best;
  }
  square.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    if (st.mode === 'draw') { if (!drawing) startDrawing(e, p); return; }
    if (st.mode === 'place') { commitDraft(pointToAngles(p, project.cal), 'click'); return; }
    const hit = hitAnchor(p);
    st.selectedId = hit ? hit.id : null;
    renderMap();
  });
  square.addEventListener('pointermove', (e) => { if (drawing) addPathPoints(e); });
  square.addEventListener('pointerup', (e) => { if (drawing && e.pointerId === drawing.pointerId) finishDrawing(e); });
  square.addEventListener('pointercancel', (e) => { if (drawing && e.pointerId === drawing.pointerId) finishDrawing(e); });
  const onKey = (e) => { if (e.key === 'Escape' && st.mode === 'place') setMode('play'); };
  window.addEventListener('keydown', onKey);

  const tour = new Tour(poseTourSteps({
    camBtn, overlay, angleCard, square, soundBtn, weightsOut, harmCanvas, addBtn, drawBtn, undoTakeBtn, adjustBtn, rangeCard, listEl, addCard,
    openAdd: () => { if (!draft) openDraft(); },
    q: (sel) => root.querySelector(sel),
  }), { label: 'Motion Morph tour', finishLabel: 'Done' });

  const timer = setInterval(tick, 20);
  renderCamera();
  renderAll();
  drawPreview();

  // For the automated checks: feed landmark frames through the same handler as the camera.
  window.__poseMap = {
    feed: (frame) => { st.feeding = true; onPose(frame); },
    debug: () => ({
      sim: st.sim, tracking: st.tracking, lostText: st.lostText, raw: st.raw && { ...st.raw }, angles: st.angles && { ...st.angles }, dot: { ...st.dot },
      soundOn: st.soundOn, gate: audio.gate ? audio.gate.gain.value : null, gateTarget: audio.gateLevel ?? null,
      blend: (() => { const b = currentBlend(); return { params: b.params, weights: b.contributions.map((x) => ({ name: x.vowel.name, id: x.vowel.id, takeId: x.vowel.takeId || null, weight: x.weight })) }; })(),
      groups: (st.groups || []).map((g) => ({ name: g.name, weight: g.weight })),
      audio: audio.debug(), claps: drumCounters.clap, clapInside: clap.inside, busy: st.busy, countdown: st.countdown,
      camera: st.camera, cameraMsg: st.cameraMsg, delegate: tracker.delegate, fps: tracker.fps,
      mode: st.mode, micListening: mic.listening, drawing: !!drawing, drawStatus: st.drawStatus, selectedId: st.selectedId, replay: !!st.replay,
      draft: draft && { anchorId: draft.anchorId, name: draft.name, hasRec: !!draft.rec, ok: draft.result ? draft.result.ok : null, code: draft.result ? draft.result.code : null, f0: draft.analysis ? draft.analysis.f0 : null, msg: draft.msg, poseMsg: draft.poseMsg },
      rangeMsg: st.rangeMsg, calSource: st.calSource, ghosts: st.ghosts.length, steps: [...stepsEl.children].map((li) => li.classList.contains('done')),
      anchorsOnMap: placedAnchors().filter((a) => !a.takeId).map((a) => ({ id: a.id, name: a.name, pos: a.pos, outside: !!(a.angles && !poseInRange(a.angles, project.cal)) })),
      project: JSON.parse(JSON.stringify(project)), tourOpen: tour.open, tourStep: tour.i,
    }),
  };

  return {
    unmount() {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
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

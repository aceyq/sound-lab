// Motion Morph (the camera pose map, capstone part 3): teach an EMPTY sound
// map your own recordings, then travel between them with two arm angles.
//
//   camera ─▶ MediaPipe Pose (pose-tracker.js) ─▶ 33 body landmarks
//     ─▶ two joint angles (pose-model.js, not x/y positions):
//          horizontal x = RIGHT elbow bend  (shoulder–elbow–wrist; left end = straighter, right end = more bent)
//          vertical   y = LEFT arm lift     (hip–shoulder–elbow;   bottom = arm down, top = arm raised)
//     ─▶ scaled by the movement range to 0…1
//     ─▶ inverse-distance weights of the sounds placed on the map (Vowel Morph's idwWeights)
//     ─▶ blendSounds (pose-sound.js): f0 + 48 harmonic strengths from the pitched
//        sounds, a noise-band shape from the fricatives, and their two shares
//     ─▶ ONE synthesized voice (pose-audio.js: 48 sine oscillators + filtered noise)
//
// What "learning" means here: nothing is trained. Each recording is analyzed
// once into a fundamental (f0) and 48 harmonic strengths (sound-analysis.js,
// the same analysis as the Vowel Lab), and those numbers are stored at the
// place you choose. Drawn takes do the same for every 0.2 s snippet, placed
// where the pointer was at that moment (take-model.js). Between places the
// numbers are blended by distance and played as one synthesized tone.
//
// Sounds are stored as poses (angles), so a range change moves their dots
// but the same pose still plays the same sound (pose-model.js).
import './pose-map.css';
import { h, fmtHz } from '../../lib/dom.js';
import { Tour } from '../../lib/tour.js';
import { MicInput } from '../frequency/mic.js';
import { VowelRecorder } from '../frequency/recorder.js';
import { newId } from '../frequency/vowel-model.js';
import { idwWeights, isUsable, noteName, loadProject as loadMorphProject, POWERS } from '../vowel-morph/morph-model.js';
import { PoseAudio } from './pose-audio.js';
import { soundParams, blendSounds, partGains, strongestBand, takeSource, BAND_CENTERS } from './pose-sound.js';
import { analyzePoseTake, reanalyzePoseTake, TAKE_ANALYSIS_VERSION } from './pose-takes.js';
import { HarmonicBars } from '../vowel-morph/morph-plots.js';
import { estimateStartMs, positionAt, undoLastTake, thinPath, MAX_DRAW_TAKE_SEC, WINDOW_SEC, HOP_SEC } from '../vowel-morph/take-model.js';
import { playDrum, drumCounters } from './drums.js';
import { PoseTracker } from './pose-tracker.js';
import { poseTourSteps } from './pose-tour.js';
import * as store from './pose-store.js';
import { analyzeMySound, warningText, REC_SEC } from './sound-analysis.js';
import {
  LM, BEND_JOINTS, LIFT_JOINTS, LOST_GRACE_MS, DEFAULT_CAL, CLAP_BUFFER, PROJECT_KEY,
  poseAngles, anglesToPoint, pointToAngles, heldAngles, smoothAngles, estimateRange, scaleRange, setRangeEnd,
  percentPer10Deg, poseInRange, describePose, takeToAngles, placedSounds, clearMap,
  RegionTrigger, loadProject, clamp01, ForeRatio, jumpGuard,
} from './pose-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const X_COLOR = '#58d1ff'; // horizontal axis = right elbow bend (blue everywhere)
export const Y_COLOR = '#ff79c6'; // vertical axis = left arm lift (pink everywhere)
const COLORS = ['#ffb74d', '#4dd0c8', '#c792ea', '#f07178', '#c3e88d', '#82aaff', '#ffcb6b', '#89ddff', '#ff9cac', '#a5d6a7'];
const TAKE_COLORS = ['#7ee787', '#ffa657', '#d2a8ff', '#79c0ff', '#ff7b72'];
const COUNTDOWN_SEC = 3;
const HOLD_SEC = 1;
const ADJUST_SEC = 6;
const STALE_MS = 500; // no camera result for this long → tracking lost
const GHOST_MS = 7000;
const AXES = [
  { key: 'bend', axis: 'x', dir: 'Horizontal', label: 'Right elbow bend', short: 'right elbow bend', lo: 'straighter arm', hi: 'more bent arm', loSide: 'left', hiSide: 'right', color: X_COLOR },
  { key: 'lift', axis: 'y', dir: 'Vertical', label: 'Left arm lift', short: 'left arm lift', lo: 'arm down', hi: 'arm raised', loSide: 'bottom', hiSide: 'top', color: Y_COLOR },
];
const FLOW_STEPS = [['record', 'Record'], ['listen', 'Listen'], ['place', 'Place'], ['ready', 'Ready']];

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

function readStored() {
  try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

const BACKUP_KEY = 'poseMap.project.backup-before-v4';
const TAKES_BACKUP_KEY = 'poseMap.project.backup-before-take-reanalysis';

export function mount(root) {
  const stored = readStored();
  const project = loadProject(stored);
  const justMigrated = !!(project.migratedFrom && stored && !(Number(stored.version) >= 4));
  if (justMigrated) {
    // Keep the map exactly as it was saved before the one-time update (see migrateToV4).
    try { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify(stored)); } catch { /* private mode */ }
  }
  const save = () => { try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch { /* private mode: works until reload */ } };
  if (justMigrated) save();
  const recs = new Map(); // audioId → { samples, sampleRate }
  // soundId → { code, text } for saved sounds whose recording analyzes differently now (checked once after loading)
  const recheck = new Map();
  // takeId → text for drawn takes that still need attention (old analysis, recording missing)
  const takeFlags = new Map();
  store.loadRecordings().then((r) => { for (const x of r.list) recs.set(x.id, x); checkSavedSounds(); upgradeOldTakes(); renderAll(); });

  const st = {
    camera: 'off', cameraMsg: 'Camera off.',
    sim: false, simAngles: { bend: 10, lift: 15 },
    foreRatio: new ForeRatio(), guard: { last: null, pending: null }, held: 0,
    raw: null, lastResultMs: -Infinity, lastOkMs: -Infinity,
    angles: null, lastSmooth: performance.now(),
    dot: { x: 0, y: 0 }, tracking: false, lostText: '',
    soundOn: false, lastClapAt: -Infinity,
    capture: null, countdown: '', busy: false,
    trail: [], landmarks: null,
    mode: 'play', // 'play' | 'place' | 'draw'
    selectedId: null, ghosts: [], ghostUntil: 0,
    prevCal: null, prevSource: 'default', rangeMsg: '',
    replay: null, previewUntil: 0, gateWanted: null, drawStatus: '', mapMsg: '', tick: 0, groups: [],
  };
  if (justMigrated) {
    st.rangeMsg = `Updated for the new elbow measurement: your sounds and takes stay exactly where they were on the map, and the range is the new default (right elbow ${DEFAULT_CAL.bend.lo}°–${DEFAULT_CAL.bend.hi}°). The poses that reach them changed, because the elbow is now measured correctly when your forearm points toward the camera. A copy of the map from before is kept in this browser.`;
  }
  // The guided "Add a sound" flow. step: record → listen → place → (confirm) → ready
  let flow = null;
  let drawing = null;
  const clap = new RegionTrigger({ buffer: CLAP_BUFFER });
  const audio = new PoseAudio({ onChange: () => renderSoundState() });
  const mic = new MicInput({ onChange: () => {} });
  const recorder = new VowelRecorder();
  const tracker = new PoseTracker({ onResult: (r) => onPose(r), onStatus: (s, m) => { st.camera = s; st.cameraMsg = m; renderCamera(); } });
  const soundById = (id) => project.sounds.find((s) => s.id === id);
  const colorOf = (s) => COLORS[Math.max(0, project.sounds.findIndex((x) => x.id === s.id)) % COLORS.length];
  const takeColor = (id) => TAKE_COLORS[Math.max(0, project.takes.findIndex((t) => t.id === id)) % TAKE_COLORS.length];
  const onMapSounds = () => project.sounds.filter((s) => s.place);
  const onMapTakes = () => project.takes.filter((t) => !t.hidden);
  const mapEmpty = () => !onMapSounds().length && !onMapTakes().some((t) => t.points.length);
  const camReady = () => st.sim || tracker.running || st.feeding;

  // ───────────── pose input ─────────────
  function onPose(r) {
    st.lastResultMs = performance.now();
    st.landmarks = r.landmarks;
    const raw = poseAngles(r.landmarks, { world: r.world, aspect: (r.width || 640) / (r.height || 480), foreRatio: st.foreRatio.value });
    st.raw = raw;
    if (Number.isFinite(raw.ratio)) st.foreRatio.add(raw.ratio, performance.now());
    // a one-frame jump of more than 60° is held back until the next frame confirms it
    const use = raw.ok ? jumpGuard(st.guard, raw) : null;
    if (raw.ok && !use) st.held++;
    if (raw.ok && use) {
      const now = performance.now();
      const dt = (now - st.lastSmooth) / 1000;
      st.lastSmooth = now;
      st.angles = smoothAngles(st.lastOkMs > now - 300 ? st.angles : null, use, dt);
      st.lastOkMs = now;
      if (st.capture) st.capture.samples.push({ bend: raw.bend, lift: raw.lift });
    } else if (st.capture) st.capture.lost.push(...raw.lost);
    drawPreview();
  }

  // ───────────── page ─────────────
  const video = h('video', { class: 'pm-video', muted: true, playsinline: true, 'aria-hidden': 'true' });
  const overlay = h('canvas', { class: 'pm-overlay', width: 640, height: 480, 'aria-label': 'Camera preview (mirrored). Your right arm is marked in blue, your left arm in pink.' });
  const countdownEl = h('div', { class: 'pm-countdown', 'aria-live': 'assertive' });
  const camBtn = h('button', { class: 'btn primary pm-cam-btn', onclick: () => (tracker.running ? tracker.stop() : tracker.start(video)) }, '📷 Enable camera');
  const camMsg = h('div', { class: 'pm-cam-msg', 'aria-live': 'polite' });
  const simChk = h('input', { type: 'checkbox', onchange: () => { st.sim = simChk.checked; simBox.hidden = !st.sim; } });
  const mkSim = (label, key, max) => h('input', { type: 'range', min: '0', max: String(max), step: '1', value: String(st.simAngles[key]), 'aria-label': label, oninput: (e) => { st.simAngles[key] = Number(e.target.value); } });
  const simBox = h('div', { class: 'pm-sim', hidden: true },
    h('label', { class: 'pm-sim-row' }, h('span', { class: 'pm-x' }, 'Right elbow bend'), mkSim('Simulated right elbow bend in degrees', 'bend', 170)),
    h('label', { class: 'pm-sim-row' }, h('span', { class: 'pm-y' }, 'Left arm lift'), mkSim('Simulated left arm lift in degrees', 'lift', 180)));

  // ── axis readout beside the map ──
  const axisUi = {};
  for (const ax of AXES) {
    axisUi[ax.key] = {
      angle: h('span', { class: 'pm-ax-angle' }), coord: h('span', { class: 'pm-ax-coord' }),
      fill: h('span', { class: 'pm-bar-fill', style: { background: ax.color } }),
      target: h('span', { class: 'pm-bar-target', hidden: true, title: 'Pose of the selected sound' }),
      lo: h('span', {}), hi: h('span', {}),
    };
    axisUi[ax.key].bar = h('div', { class: 'pm-bar' }, axisUi[ax.key].fill, axisUi[ax.key].target);
  }
  const trackOut = h('div', { class: 'pm-track' });
  const bendNote = h('div', { class: 'pm-bend-note muted' });
  const targetOut = h('div', { class: 'pm-target-msg', 'aria-live': 'polite' });
  const axisPanel = h('div', { class: 'card pm-axis-panel', 'aria-label': 'Your two measurements and where they put the marker' },
    h('h2', {}, 'Your two arms → the marker'),
    AXES.map((ax) => h('div', { class: `pm-ax pm-ax-${ax.axis}`, 'data-axis': ax.key, style: { borderColor: ax.color } },
      h('div', { class: 'pm-ax-head', style: { color: ax.color } }, `${ax.dir} (${ax.axis}) = ${ax.label}`),
      h('div', { class: 'pm-ax-nums' }, axisUi[ax.key].angle, h('span', { class: 'muted' }, ' → '), axisUi[ax.key].coord),
      ax.key === 'bend' ? bendNote : null,
      axisUi[ax.key].bar,
      h('div', { class: 'pm-bar-ends muted' }, axisUi[ax.key].lo, axisUi[ax.key].hi))),
    trackOut, targetOut,
    h('p', { class: 'help' }, 'Bend only your right elbow: the marker moves sideways. Lift only your left arm: it moves up or down. Change both: it moves diagonally.'));

  // ── range ──
  const adjustBtn = h('button', { class: 'btn primary pm-adjust-btn', onclick: () => adjustToMovement() }, '🎯 Adjust to my movement');
  const rangeNow = h('div', { class: 'pm-range-now' });
  const rangeMsg = h('div', { class: 'pm-range-msg', 'aria-live': 'polite' });
  const undoRangeBtn = h('button', { class: 'btn small pm-undo-range', onclick: () => { if (st.prevCal) applyRange(st.prevCal, 'Went back to the previous range.', st.prevSource); } }, '↶ Undo range change');
  const resetRangeBtn = h('button', { class: 'btn small', onclick: () => applyRange(copyCal(DEFAULT_CAL), 'Back to the default range.', 'default') }, 'Default range');
  const tuneUi = {};
  const tuneRows = AXES.map((ax) => {
    const mk = (end, word) => {
      const el = h('input', { type: 'range', min: '0', max: '180', step: '1', 'aria-label': `${ax.label}: ${word} end of range in degrees`,
        onchange: () => applyRange({ ...project.cal, [ax.key]: setRangeEnd(project.cal[ax.key], end, el.value, ax.key) }, `${ax.label}: ${word} end set to ${deg(+el.value)}.`, 'custom') });
      return el;
    };
    const lo = mk('lo', ax.lo);
    const hi = mk('hi', ax.hi);
    const out = h('span', { class: 'muted' });
    tuneUi[ax.key] = { lo, hi, out };
    return h('div', { class: 'pm-tune-row', 'data-axis': ax.key },
      h('b', { style: { color: ax.color } }, `${ax.dir}: ${ax.label}`),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn small pm-widen', onclick: () => applyRange({ ...project.cal, [ax.key]: scaleRange(project.cal[ax.key], 1.25, ax.key) }, `${ax.label}: wider range, so the same movement moves the marker less ${ax.axis === 'x' ? 'sideways' : 'up/down'}.`, 'custom') }, 'Small moves jump too far'),
        h('button', { class: 'btn small pm-narrow', onclick: () => applyRange({ ...project.cal, [ax.key]: scaleRange(project.cal[ax.key], 0.8, ax.key) }, `${ax.label}: narrower range, so the ${ax.loSide} and ${ax.hiSide} edges are easier to reach.`, 'custom') }, `I can’t reach the ${ax.loSide}/${ax.hiSide}`)),
      h('label', { class: 'pm-sim-row' }, h('span', {}, `${ax.lo[0].toUpperCase()}${ax.lo.slice(1)} (${ax.loSide})`), lo),
      h('label', { class: 'pm-sim-row' }, h('span', {}, `${ax.hi[0].toUpperCase()}${ax.hi.slice(1)} (${ax.hiSide})`), hi),
      out);
  });

  // ── map ──
  const square = svg('svg', { viewBox: '0 0 1000 1000', class: 'pm-square', role: 'img', 'aria-label': 'Sound map. Horizontal: right elbow bend, left = straighter arm, right = more bent arm. Vertical: left arm lift, bottom = arm down, top = arm raised. The white marker is your current pose; coloured dots are your sounds; lines are drawn takes.' });
  const gGrid = svg('g', { class: 'pm-grid' });
  for (let i = 1; i < 4; i++) gGrid.append(svg('line', { x1: i * 250, y1: 0, x2: i * 250, y2: 1000 }), svg('line', { x1: 0, y1: i * 250, x2: 1000, y2: i * 250 }));
  const gAxes = svg('g', { class: 'pm-axes' });
  const gClap = svg('g', { class: 'pm-clap' });
  const gTakes = svg('g', { class: 'pm-takes' });
  const gGhosts = svg('g', { class: 'pm-ghosts' });
  const gLines = svg('g');
  const gAnchors = svg('g', { class: 'pm-anchors' });
  const gPending = svg('g', { class: 'pm-pending' });
  const trail = svg('polyline', { class: 'pm-trail', points: '' });
  const dotEl = svg('g', { class: 'pm-dot' }, svg('circle', { r: 26 }), svg('circle', { class: 'pm-dot-core', r: 9 }));
  square.append(gGrid, gAxes, gClap, gTakes, gGhosts, gLines, trail, gAnchors, gPending, dotEl);
  const emptyNote = h('div', { class: 'pm-empty' },
    h('b', {}, 'Your map is empty.'),
    h('p', {}, 'Press 🎤 Add a sound, sing or hum one steady note for 3 seconds, listen back, then click where it belongs (or hold a pose). Add a second sound somewhere else, and your arms move you between them. Or press ✏️ Draw + record and sing while you draw a line.'),
    h('p', { class: 'muted' }, 'What “learning” means here: nothing is trained. The app measures each recording’s pitch (f0) and the strengths of its first 48 harmonics, and stores those numbers at the spot you choose. Between spots it mixes the numbers by distance and synthesizes one tone.'));
  const addBtn = h('button', { class: 'btn seg pm-add-btn', onclick: () => (flow ? closeFlow() : openFlow()) }, '🎤 Add a sound');
  const drawBtn = h('button', { class: 'btn seg pm-draw-btn', onclick: () => setMode(st.mode === 'draw' ? 'play' : 'draw') }, '✏️ Draw + record');
  const undoTakeBtn = h('button', { class: 'btn pm-undo-take', onclick: () => undoTake() }, '↶ Undo last take');
  const clearBtn = h('button', { class: 'btn danger pm-clear-btn', onclick: () => clearTheMap() }, '🧹 Clear map');
  const mapHint = h('div', { class: 'pm-map-hint', 'aria-live': 'polite' });
  const cancelPlaceBtn = h('button', { class: 'btn small', onclick: () => cancelPlacement() }, 'Cancel placement');

  // ── sound ──
  const soundBtn = h('button', { class: 'btn primary big pm-sound-btn', onclick: () => (st.soundOn ? stopSound() : startSound()) }, '▶ Start sound');
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volumeValue), 'aria-label': 'Volume', oninput: () => audio.setVolume(Number(volume.value)) });
  const f0Out = h('div', { class: 'pm-f0' });
  const weightsOut = h('div', { class: 'pm-weights' });
  const harmCanvas = h('canvas', { class: 'pm-harm', 'aria-label': 'Harmonic strengths the synthesizer is playing now, in dB' });
  const mixOut = h('div', { class: 'pm-mix' });
  const levelsOut = h('div', { class: 'pm-levels' });
  const detailsBody = h('div', { class: 'pm-wdetails-body' });
  const weightsDetails = h('details', { class: 'pm-wdetails' }, h('summary', {}, 'Detailed breakdown'), detailsBody);
  const noiseCanvas = h('canvas', { class: 'pm-noise', width: 640, height: 110, 'aria-label': 'Noise spectrum the synthesizer is playing now (fricatives), by frequency band' });
  const noiseBox = h('div', { class: 'pm-noise-box', hidden: true }, h('div', { class: 'muted pm-sub' }, 'Noise part (fricatives): band levels of the filtered noise, dB'), noiseCanvas);
  const harmBars = new HarmonicBars(harmCanvas);
  const powerSel = h('select', { 'aria-label': 'Distance influence', onchange: () => { project.power = Number(powerSel.value); save(); } },
    POWERS.map((x) => h('option', { value: String(x.p), selected: project.power === x.p || null }, `${x.name} (power ${x.p})`)));
  const blendSel = h('select', { class: 'pm-blend-mode', 'aria-label': 'How a vowel and a fricative mix', onchange: () => { project.blendMode = blendSel.value; save(); } },
    h('option', { value: 'morph', selected: project.blendMode !== 'layer' || null }, 'Morph: one shared spectrum (default)'),
    h('option', { value: 'layer', selected: project.blendMode === 'layer' || null }, 'Layer: vowel part + hiss part'));
  const clapChk = h('input', { type: 'checkbox', checked: project.clap.on, onchange: () => setClap(clapChk.checked) });
  const clapHere = h('button', { class: 'btn small', onclick: () => { project.clap.region.x = st.dot.x; project.clap.region.y = st.dot.y; clap.prime(st.dot, project.clap.region); save(); renderMap(); } }, 'Use my current pose as the clap region');
  const clapOut = h('div', { class: 'pm-clap-flash', 'aria-live': 'polite' });
  const clapCard = h('details', { class: 'pm-clap-box' },
    h('summary', {}, '👏 Extra: clap on a pose'),
    h('label', { class: 'check pm-clap-toggle' }, clapChk, h('b', {}, 'Clap on the final pose'), ' (optional)'),
    clapOut, clapHere,
    h('p', { class: 'help' }, 'Plays one clap when you enter the ring, stays quiet while you hold it, and is ready again once you leave past the dashed ring and come back.'));

  const flowCard = h('section', { class: 'card pm-add', hidden: true });
  const libSoundsEl = h('div', { class: 'pm-list' });
  const libTakesEl = h('div', { class: 'pm-take-list' });
  const tourBtn = h('button', { class: 'btn primary pm-tour-btn', onclick: () => tour.start(0) }, '🧭 Tour');

  const cameraCard = h('section', { class: 'card pm-camera' },
    h('h2', {}, 'Camera'),
    h('div', { class: 'row gap wrap' }, camBtn, h('label', { class: 'check' }, simChk, 'Practice without camera (sliders)')),
    camMsg,
    h('div', { class: 'pm-preview' }, video, overlay, countdownEl),
    h('div', { class: 'pm-legend' },
      h('div', {}, h('span', { class: 'pm-key', style: { background: X_COLOR } }), h('b', { class: 'pm-x' }, 'Your RIGHT arm'), ': shoulder–elbow–wrist → right elbow bend → moves the marker sideways'),
      h('div', {}, h('span', { class: 'pm-key', style: { background: Y_COLOR } }), h('b', { class: 'pm-y' }, 'Your LEFT arm'), ': hip–shoulder–elbow → left arm lift → moves the marker up/down')),
    h('p', { class: 'help pm-frame-help' }, 'The preview is mirrored, like a mirror, so your right arm appears on the right side of the picture. “Right” and “left” always mean your own body. Stand back until both shoulders, elbows, wrists and hips are visible; a red ✕ marks a lost joint. Video stays on this computer.'),
    simBox);
  const rangeCard = h('section', { class: 'card pm-range' },
    h('h2', {}, 'Movement range'),
    rangeNow,
    h('p', { class: 'help' }, `Optional. The default range fits most people. If the marker jumps too far or you can’t reach an edge, press Adjust: after a ${COUNTDOWN_SEC} s countdown, spend ${ADJUST_SEC} s straightening and bending your RIGHT elbow (sideways on the map) and lowering and raising your LEFT arm (up/down on the map) as far as is comfortable.`),
    h('div', { class: 'row gap wrap' }, adjustBtn, undoRangeBtn, resetRangeBtn),
    rangeMsg,
    h('details', { class: 'pm-tune' }, h('summary', {}, 'Fine-tune the range'), tuneRows),
    h('p', { class: 'help pm-range-rule' }, 'Your sounds stay on their poses. Each placed sound is saved as the two angles of its pose (a clicked spot is saved as the pose that reaches it). When the range changes, the dots move on the map, but holding the same pose still plays exactly the same sound, so you never need to reposition anything. A sound whose pose is outside a narrowed range gets a dashed ring.'));
  const soundCard = h('section', { class: 'card pm-sound' },
    h('h2', {}, 'What you hear'),
    h('div', { class: 'row gap wrap' }, soundBtn, h('label', { class: 'row gap' }, 'Volume', volume)),
    h('p', { class: 'help pm-explain' }, 'Your arms only move the marker. The sounds you placed decide what you hear: at each spot the synthesizer plays one tone whose pitch (f0) and harmonic strengths are a distance-weighted mix of the nearby sounds. Example: put “ah” on the left and “ee” on the right, then bend your right elbow to glide between them; put a hum higher up and lift your left arm to move toward it. A fricative (“sss”) adds a noise part with no pitch; between it and a vowel you hear the vowel’s harmonics and the hiss mixed in one sound, never two recordings at once.'),
    f0Out,
    h('div', { class: 'muted pm-sub' }, 'Share of each of your sounds right now'),
    weightsOut,
    h('p', { class: 'help pm-one-source' }, 'A drawn line counts as ONE source, however many dots it has: its sound is the one at the line’s closest spot to the marker, interpolated between the two dots around it. So a long or dense line weighs the same as a single sound at the same distance, and the shares are the exact weights the synthesizer uses.'),
    weightsDetails,
    mixOut,
    levelsOut,
    h('div', { class: 'muted pm-sub' }, 'Harmonic strengths of the synthesized tone (dB; harmonic number below)'),
    harmCanvas,
    noiseBox,
    h('div', { class: 'row gap wrap pm-sound-opts' }, h('label', { class: 'row gap' }, 'Distance influence', powerSel), h('label', { class: 'row gap' }, 'Vowel ↔ fricative', blendSel)),
    h('p', { class: 'help pm-blend-help' }, 'Morph: between a vowel and a fricative, both parts are shaped by ONE spectrum that glides from the vowel’s formants to the hiss’s shape, while the voiced share falls and the noise share rises; half-way you hear one breathy, buzzy sound. Layer: the vowel’s own harmonics and the fricative’s own hiss are mixed side by side, which can sound like two sounds at lower volume.'),
    clapCard);
  const libraryCard = h('section', { class: 'card pm-sounds' },
    h('h2', {}, 'Your recordings'),
    h('p', { class: 'help' }, 'Every recording you make is kept here, on the map or not. Clear map only takes sounds off the map; delete a recording here if you no longer want it.'),
    libSoundsEl,
    h('h3', {}, 'Drawn takes'),
    libTakesEl);

  root.append(h('div', { class: 'pm-page' },
    h('div', { class: 'page-top' },
      h('div', {}, h('h1', {}, 'Motion Morph'),
        h('p', { class: 'lead' }, 'Teach an empty map your own sounds, then move between them with two arm measurements: your right elbow bend moves the marker sideways, your left arm lift moves it up and down. Hold a pose and the sound holds; move toward another sound and it blends toward it.')),
      h('div', { class: 'pm-top-actions' }, tourBtn)),
    h('div', { class: 'pm-layout' },
      h('div', { class: 'pm-col' }, cameraCard, rangeCard),
      h('div', { class: 'pm-col' },
        h('div', { class: 'pm-map-tools' }, h('div', { class: 'seg-group', role: 'group', 'aria-label': 'Add sounds' }, addBtn, drawBtn), undoTakeBtn, clearBtn),
        h('div', { class: 'row gap wrap pm-hint-row' }, mapHint, cancelPlaceBtn),
        h('div', { class: 'pm-map-area' }, h('div', { class: 'pm-square-wrap' }, square, emptyNote), axisPanel),
        flowCard,
        soundCard,
        libraryCard))));

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
    const cap = await countdownAndCollect('Get ready to move', ADJUST_SEC, (left) => `Bend + straighten your RIGHT elbow\nLower + raise your LEFT arm\n${left.toFixed(0)} s`);
    if (!cap) return;
    if (cap.error) { st.rangeMsg = cap.error; renderRange(); return; }
    const est = estimateRange(cap.samples, project.cal);
    if (!est.ok) { st.rangeMsg = `${est.message}${cap.lost.length ? ` Lost during the move: ${lostList(cap)}.` : ''} Step back so the preview shows all six joints, then try again.`; renderRange(); return; }
    const before = copyCal(project.cal);
    const parts = AXES.map((ax) => {
      const r = est.report[ax.key];
      return r.kept ? `${ax.dir} (${ax.label}): you moved only ${deg(r.moved)}, so it stays ${deg(before[ax.key].lo)}–${deg(before[ax.key].hi)}.`
        : `${ax.dir} (${ax.label}): you used ${deg(r.seen[0])}–${deg(r.seen[1])}, so ${ax.lo} (${ax.loSide} edge) is now ${deg(est.cal[ax.key].lo)} and ${ax.hi} (${ax.hiSide} edge) is ${deg(est.cal[ax.key].hi)} (was ${deg(before[ax.key].lo)}–${deg(before[ax.key].hi)}).`;
    });
    applyRange(est.cal, `Adjusted from ${est.count} camera readings. ${parts.join(' ')}`, 'adjusted');
  }

  function applyRange(cal, message, source) {
    const before = copyCal(project.cal);
    const same = ['bend', 'lift'].every((k) => before[k].lo === cal[k].lo && before[k].hi === cal[k].hi);
    if (!same) { st.prevCal = before; st.prevSource = project.calSource; }
    project.cal = copyCal(cal);
    project.calSource = source;
    const ghosts = [];
    for (const s of onMapSounds()) {
      const from = anglesToPoint(s.place.angles, before);
      const to = anglesToPoint(s.place.angles, project.cal);
      if (Math.hypot(from.x - to.x, from.y - to.y) > 0.01) ghosts.push({ from, to, color: colorOf(s) });
    }
    for (const t of onMapTakes()) {
      if (!t.points.length) continue;
      const p = t.points[Math.floor(t.points.length / 2)];
      const from = anglesToPoint(p, before);
      const to = anglesToPoint(p, project.cal);
      if (Math.hypot(from.x - to.x, from.y - to.y) > 0.01) ghosts.push({ from, to, color: takeColor(t.id) });
    }
    st.ghosts = ghosts;
    st.ghostUntil = performance.now() + GHOST_MS;
    const outside = onMapSounds().filter((s) => !poseInRange(s.place.angles, project.cal));
    const sens = AXES.map((ax) => `10° of ${ax.short} now moves the marker ${percentPer10Deg(project.cal[ax.key]).toFixed(0)} % of the map ${ax.axis === 'x' ? 'sideways' : 'up/down'} (was ${percentPer10Deg(before[ax.key]).toFixed(0)} %)`).join('; ');
    st.rangeMsg = `${message} ${same ? '' : `${sens}.`}`
      + (ghosts.length ? ` ${ghosts.length} of your sounds/takes moved on the map (faint circles show where they were); each still plays when you hold its pose.` : '')
      + (outside.length ? ` Outside the new range: ${outside.map((s) => s.name).join(', ')} (dashed ring). Widen the range or redo its position.` : '');
    save();
    renderAll();
  }

  // ───────────── the guided "Add a sound" flow ─────────────
  function vowelMorphOptions() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('vowelMorph.project.v1') || 'null'); } catch { raw = null; }
    return loadMorphProject(raw).vowels.filter(isUsable).map((v) => ({ id: `vm:${v.id}`, label: `${v.name} (${fmtHz(v.analysis.f0)})`, name: v.name, analysis: { kind: 'pitched', status: 'ok', f0: v.analysis.f0, amps: v.analysis.amps } }));
  }

  function nextName() {
    const names = new Set(project.sounds.map((a) => a.name));
    for (let i = 1; ; i++) if (!names.has(`Sound ${i}`)) return `Sound ${i}`;
  }

  /** Opens the flow: a new recording (no sound), or placing/re-placing a sound from the library. */
  function openFlow(sound = null) {
    if (st.mode === 'draw') setMode('play');
    if (st.mode === 'place') st.mode = 'play';
    st.pending = null;
    flow = sound
      ? { soundId: sound.id, name: sound.name, step: 'place', result: null, msg: '', placeMsg: '', redo: !!sound.place }
      : { soundId: null, name: nextName(), step: 'record', result: null, msg: '', placeMsg: '' };
    if (sound) st.selectedId = sound.id;
    renderAll();
    flowCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function closeFlow() {
    flow = null;
    st.pending = null;
    if (st.mode === 'place') st.mode = 'play';
    renderAll();
  }

  async function recordForFlow() {
    if (!flow || st.busy) return;
    stopSound();
    stopReplay();
    flow.msg = 'Opening the microphone…';
    flow.result = null;
    renderFlow();
    await mic.start();
    if (!flow) { mic.stop(); return; }
    if (!mic.listening) { flow.msg = mic.error ? `${mic.error.title}. ${mic.error.message}` : 'The microphone did not start.'; renderFlow(); return; }
    st.busy = true;
    flow.msg = `Recording… keep one steady sound going for ${REC_SEC} s.`;
    renderFlow();
    const result = await recorder.start(mic, REC_SEC, { onProgress: (sec) => { if (flow) { flow.msg = `Recording… ${sec.toFixed(1)} / ${REC_SEC} s. Keep it steady.`; const el = flowCard.querySelector('.pm-add-msg'); if (el) el.textContent = flow.msg; } } });
    mic.stop();
    st.busy = false;
    if (!flow) return;
    if (result.error) { flow.msg = `Recording failed: ${result.error}`; renderAll(); return; }
    const rec = { samples: result.samples, sampleRate: result.sampleRate };
    const r = analyzeMySound(rec);
    flow.result = r;
    if (!r.ok) { flow.msg = ''; flow.step = 'record'; renderAll(); return; }
    const audioId = newId('rec');
    recs.set(audioId, rec);
    store.putRecording({ id: audioId, sampleRate: rec.sampleRate, samples: rec.samples, createdAt: new Date().toISOString() });
    let s = flow.soundId && soundById(flow.soundId);
    if (s) {
      // recording again inside the flow replaces this sound's audio and analysis
      const old = s.audioId;
      s.audioId = audioId; s.analysis = r.analysis; s.source = 'recorded';
      if (old && old !== audioId) { recs.delete(old); store.deleteRecording(old); }
    } else {
      s = { id: newId('snd'), name: flow.name, source: 'recorded', audioId, analysis: r.analysis, createdAt: new Date().toISOString(), place: null };
      project.sounds.push(s);
      flow.soundId = s.id;
    }
    flow.step = 'listen';
    flow.msg = '';
    save();
    renderAll();
  }

  function useVowelMorph(optId) {
    const o = vowelMorphOptions().find((x) => x.id === optId);
    if (!o || !flow) return;
    let s = flow.soundId && soundById(flow.soundId);
    if (s) { s.analysis = o.analysis; s.source = 'vowel-morph'; } else {
      s = { id: newId('snd'), name: o.name, source: 'vowel-morph', audioId: null, analysis: o.analysis, createdAt: new Date().toISOString(), place: null };
      project.sounds.push(s);
      flow.soundId = s.id;
      flow.name = o.name;
    }
    flow.result = null;
    flow.step = 'listen';
    save();
    renderAll();
  }

  function startClickPlacement() {
    if (!flow || !flow.soundId) return;
    st.pending = null;
    flow.step = 'place';
    st.mode = 'place';
    flow.placeMsg = '';
    renderAll();
    square.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function cancelPlacement() {
    st.pending = null;
    if (st.mode === 'place') st.mode = 'play';
    if (flow) { flow.step = flow.soundId ? 'place' : 'record'; flow.placeMsg = 'Placement cancelled. Choose a way to place it, or close this panel (the recording stays in Your recordings).'; }
    renderAll();
  }

  async function capturePoseForFlow() {
    if (!flow || !flow.soundId) return;
    if (st.mode === 'place') st.mode = 'play';
    st.pending = null;
    const cap = await countdownAndCollect(`Step back and hold a pose\nfor “${flow.name}”`, HOLD_SEC, () => 'Hold still…');
    if (!cap || !flow) return;
    if (cap.error) { flow.placeMsg = cap.error; renderFlow(); return; }
    const held = heldAngles(cap.samples);
    if (!held) { flow.placeMsg = `I couldn’t see both arms while you held the pose${cap.lost.length ? ` (lost: ${lostList(cap)})` : ''}, so nothing was placed. Step back until the preview shows all six joints without a red ✕, then press “Use my current pose” again.`; renderFlow(); return; }
    st.pending = { angles: { bend: Math.round(held.bend * 10) / 10, lift: Math.round(held.lift * 10) / 10 } };
    flow.step = 'confirm';
    flow.placeMsg = '';
    renderAll();
  }

  function placeSound(angles, placedBy) {
    const s = flow && soundById(flow.soundId);
    if (!s) return;
    s.place = { angles: { bend: Math.round(angles.bend * 10) / 10, lift: Math.round(angles.lift * 10) / 10 }, placedBy };
    st.pending = null;
    st.mode = 'play';
    st.selectedId = s.id;
    flow.step = 'ready';
    flow.placeMsg = '';
    save();
    renderAll();
  }

  function playOriginal(audioId, label) {
    const rec = recs.get(audioId);
    if (!rec) return;
    stopSound();
    stopReplay();
    st.previewUntil = performance.now() + (rec.samples.length / rec.sampleRate) * 1000 + 100;
    audio.setGate(1, 0.01); st.gateWanted = 1;
    audio.playOriginal(rec, { label });
  }

  function playSynth(analysis, label) {
    if (!analysis) return;
    stopSound();
    stopReplay();
    st.previewUntil = performance.now() + 1600;
    audio.setGate(1, 0.01); st.gateWanted = 1;
    const one = soundParams(analysis);
    const p = one && blendSounds([{ params: one, weight: 1 }]);
    if (p && audio.playSynth(p, label)) setTimeout(() => { if (!st.soundOn && audio.label === label) audio.stop(); }, 1500);
  }

  // ───────────── library: remove from map, delete, clear ─────────────
  function removeFromMap(s) {
    s.place = null;
    if (st.selectedId === s.id) st.selectedId = null;
    save();
    renderAll();
  }

  function deleteRecording(s) {
    if (!window.confirm(`Delete the recording “${s.name}”${s.place ? ' and remove it from the map' : ''}? This cannot be undone.`)) return;
    project.sounds = project.sounds.filter((x) => x !== s);
    if (s.audioId) { recs.delete(s.audioId); store.deleteRecording(s.audioId); }
    if (flow && flow.soundId === s.id) flow = null;
    if (st.selectedId === s.id) st.selectedId = null;
    save();
    renderAll();
  }

  function clearTheMap() {
    const ns = onMapSounds().length;
    const nt = onMapTakes().length;
    if (!ns && !nt) { st.mapMsg = 'The map is already empty.'; renderMapHint(); return; }
    if (!window.confirm(`Clear the map?\n\nThis removes ${ns} placed sound${ns === 1 ? '' : 's'} and ${nt} drawn take${nt === 1 ? '' : 's'} from the map. Your recordings are kept under “Your recordings”, so you can place them again.`)) return;
    stopReplay();
    stopSound();
    const c = clearMap(project);
    st.selectedId = null;
    flow = null;
    st.pending = null;
    st.mode = 'play';
    st.mapMsg = `Map cleared: ${c.sounds} sound${c.sounds === 1 ? '' : 's'} and ${c.takes} take${c.takes === 1 ? '' : 's'} removed from the map. Your recordings are still listed below; press “Place on map” or “Put back on map” to use them again.`;
    save();
    renderAll();
  }

  // ───────────── drawn takes ─────────────
  async function setMode(m) {
    if (drawing) return;
    const was = st.mode;
    st.mode = m;
    if (m === 'draw') {
      flow = null;
      st.pending = null;
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
    st.drawStatus = 'Microphone ready. Hold the mouse down on the map, draw a line or shape while you sing changing vowels (for example ah → ee → oo), and let go to finish.';
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
    if (!d.done) finishDrawing(null);
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
    if (sec < WINDOW_SEC) { st.drawStatus = `That take was only ${sec.toFixed(2)} s of audio, too short for one ${WINDOW_SEC} s snippet, so nothing was kept. Hold the mouse down, sing and draw a little longer.`; renderAll(); return; }
    st.drawStatus = `Analyzing ${sec.toFixed(1)} s of audio in ${WINDOW_SEC} s snippets…`;
    renderMapHint();
    await sleep(30);
    const startMs = estimateStartMs(d.arrivals, result.sampleRate);
    const a = analyzePoseTake({ samples: result.samples, sampleRate: result.sampleRate, startMs, path: d.path });
    const t0 = d.path[0].t;
    const recId = newId('rec');
    const rec = { samples: result.samples, sampleRate: result.sampleRate };
    recs.set(recId, rec);
    store.putRecording({ id: recId, sampleRate: rec.sampleRate, samples: rec.samples, createdAt: new Date().toISOString() });
    const n = project.takes.reduce((m, t) => Math.max(m, Number((/^Take (\d+)$/.exec(t.name) || [])[1]) || 0), 0) + 1;
    const mapTake = {
      id: newId('take'), name: `Take ${n}`, recordingId: recId, createdAt: new Date().toISOString(), durationSec: Math.round(sec * 100) / 100,
      path: thinPath(d.path.map((q) => ({ x: q.x, y: q.y, t: q.t - t0 }))),
      points: a.points, stats: a.stats, hidden: false,
      analysisVersion: TAKE_ANALYSIS_VERSION, startOffsetMs: Math.round(a.startOffsetMs),
    };
    const take = takeToAngles(mapTake, d.cal);
    project.takes.push(take);
    save();
    const s = a.stats;
    const first = take.points[0];
    const last = take.points[take.points.length - 1];
    st.drawStatus = `${take.name}: learned ${s.usable} point${s.usable === 1 ? '' : 's'} from ${s.snippets} snippet${s.snippets === 1 ? '' : 's'}: ${kindCounts(s)}${s.silent || s.unreliable || s.outsidePath ? ` (skipped ${[s.silent ? `${s.silent} silent` : '', s.unreliable ? `${s.unreliable} neither clearly pitched nor a clear fricative` : '', s.outsidePath ? `${s.outsidePath} before/after the drawing` : ''].filter(Boolean).join(', ')})` : ''}. Each dot is a synthesized sound reconstructed from 0.2 s of your recording (pitch + harmonics, a noise spectrum, or both), not the recording itself. The whole line counts as one source on the map, however many dots it has.`
      + (s.usable ? ` Preview it with “▶ Preview along the line”, or play it with your arms: start at ${describePose(first)} (the ● at the start) and move toward ${describePose(last)}.`
        : ' Nothing usable: sing a steady vowel or hiss a steady “sss”/“shh” while drawing, or undo this take.');
    renderAll();
  }

  function undoTake() {
    const { takes, removed } = undoLastTake(project.takes);
    if (!removed) return;
    stopReplay();
    project.takes = takes;
    if (removed.recordingId) { recs.delete(removed.recordingId); store.deleteRecording(removed.recordingId); }
    st.drawStatus = `Undid ${removed.name} (${removed.points.length} point${removed.points.length === 1 ? '' : 's'}). Your other sounds are unchanged.`;
    save();
    renderAll();
  }

  function deleteTake(take) {
    if (!window.confirm(`Delete ${take.name} and its recording? This cannot be undone.`)) return;
    stopReplay();
    project.takes = project.takes.filter((t) => t !== take);
    if (take.recordingId) { recs.delete(take.recordingId); store.deleteRecording(take.recordingId); }
    save();
    renderAll();
  }

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

  // ───────────── sound ─────────────
  /** Short description of an analysis for lists. */
  function soundLabel(an) {
    if (an.kind === 'noise') return `noise, no pitch (fricative; strongest near ${strongestBand(an.noise.bands)})`;
    if (an.kind === 'mixed') return `${fmtHz(an.f0)} + noise (pitched ${Math.round((an.voiced ?? 0.5) * 100)} %, noise ${Math.round((1 - (an.voiced ?? 0.5)) * 100)} %)`;
    return `${fmtHz(an.f0)} (pitched)`;
  }

  /** Bar graph of noise band levels (dB re the strongest band, −40 dB floor). */
  function drawBands(cv, bands) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width; const H = cv.height; const pad = 18;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, W, H);
    const bw = (W - 8) / bands.length;
    ctx.fillStyle = '#c3a6ff';
    bands.forEach((a, i) => {
      const db = a > 0 ? Math.max(-40, 20 * Math.log10(a)) : -40;
      const hgt = ((db + 40) / 40) * (H - pad - 6);
      ctx.fillRect(4 + i * bw + 1, H - pad - hgt, bw - 2, hgt);
    });
    ctx.fillStyle = '#8b98a5'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const f of [250, 500, 1000, 2000, 4000, 8000]) {
      const i = BAND_CENTERS.findIndex((c) => c >= f);
      if (i >= 0) ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), 4 + (i + 0.5) * bw, H - 4);
    }
  }

  /**
   * Re-checks every saved sound against its stored recording with today's
   * analysis (once, after the recordings load). A sound that no longer passes,
   * or that is now recognized as a different kind (for example a fricative that
   * was saved as a pitched sound), is flagged in Your recordings.
   */
  function checkSavedSounds() {
    recheck.clear();
    for (const sd of project.sounds) {
      const rec = sd.audioId && recs.get(sd.audioId);
      if (!rec) continue;
      let r;
      try { r = analyzeMySound(rec); } catch { continue; }
      const was = sd.analysis.kind === 'noise' || sd.analysis.kind === 'mixed' ? sd.analysis.kind : 'pitched';
      if (!r.ok) recheck.set(sd.id, { code: 'fails', text: `Its recording does not pass today’s analysis (${r.reason}) It still plays the numbers saved earlier, which may not match the recording. Record it again, or delete it.` });
      else if (r.analysis.kind !== was) recheck.set(sd.id, { code: 'kind', now: r.analysis.kind, text: `Saved as a ${was} sound, but its recording is ${r.analysis.kind === 'noise' ? 'an unvoiced fricative (noise, no pitch)' : r.analysis.kind === 'mixed' ? 'pitched with a strong noise part (both are kept)' : 'a pitched sound'}. Press “Analyze again” to update it.` });
    }
  }

  function reanalyze(sd) {
    const rec = sd.audioId && recs.get(sd.audioId);
    if (!rec) return;
    const r = analyzeMySound(rec);
    if (!r.ok) { recheck.set(sd.id, { code: 'fails', text: `Analyzing again did not work either: ${r.reason} ${r.tip} Record it again, or delete it.` }); renderAll(); return; }
    sd.analysis = r.analysis;
    recheck.delete(sd.id);
    st.mapMsg = `“${sd.name}” analyzed again: ${soundLabel(sd.analysis)}.`;
    save();
    renderAll();
  }

  /** "12 pitched (vowel), 3 pitched + noise, 9 noise only (fricative)" */
  function kindCounts(c) {
    return [c.pitched ? `${c.pitched} pitched (vowel)` : '', c.mixed ? `${c.mixed} pitched + noise` : '', c.noise ? `${c.noise} noise only (fricative)` : ''].filter(Boolean).join(', ') || 'none';
  }

  /**
   * Analyzes drawn takes made before fricatives were supported (analysis
   * version 1: pitch only, noisy snippets skipped) again from their stored
   * recordings, once after the recordings load. The project is backed up
   * first. A take whose recording is not stored is flagged instead.
   */
  function upgradeOldTakes() {
    const notes = [];
    takeFlags.clear();
    for (let i = 0; i < project.takes.length; i++) {
      const t = project.takes[i];
      if ((t.analysisVersion || 1) >= TAKE_ANALYSIS_VERSION) continue;
      const rec = t.recordingId && recs.get(t.recordingId);
      if (!rec) {
        takeFlags.set(t.id, 'Analyzed before drawn lines could learn fricatives, and its recording is not stored in this browser, so it cannot be analyzed again. Any “shh”/“sss” in it was skipped. Record it again to put the fricative on the line.');
        continue;
      }
      let nt = null;
      try { nt = reanalyzePoseTake(t, rec); } catch { nt = null; }
      if (!nt || (!nt.points.length && t.points.length)) {
        takeFlags.set(t.id, 'Analyzing its stored recording again found nothing usable, so its earlier (pitch-only) points were kept. Record it again if it should contain a fricative.');
        continue;
      }
      if (!notes.length) { try { if (!localStorage.getItem(TAKES_BACKUP_KEY)) localStorage.setItem(TAKES_BACKUP_KEY, JSON.stringify(project)); } catch { /* private mode */ } }
      notes.push(`${t.name}: ${t.points.length} pitched point${t.points.length === 1 ? '' : 's'} before → ${nt.points.length} now (${kindCounts(nt.stats)})`);
      project.takes[i] = nt;
    }
    if (notes.length) {
      save();
      st.drawStatus = `Analyzed your earlier drawn take${notes.length === 1 ? '' : 's'} again from the stored recording${notes.length === 1 ? '' : 's'}, now keeping noise (fricatives) too. ${notes.join('; ')}. The lines and your other recordings are unchanged.`;
    }
    st.takeUpgrade = notes;
  }

  /**
   * Everything that sounds at `here`: each placed sound is one source, and
   * each visible drawn take is ONE source too, however many points it has:
   * the spot on the line closest to the marker, with the sound interpolated
   * between the two learned points around it (takeSource). So a long or dense
   * line weighs the same as a single dot at the same distance.
   */
  function mapSources(here) {
    const out = [];
    for (const a of placedSounds(project.sounds, project.cal)) {
      const p = soundParams(a.analysis);
      if (p) out.push({ key: a.id, type: 'sound', id: a.id, name: a.name, src: a.src, pos: a.pos, params: p, color: colorOf(a.src) });
    }
    for (const t of project.takes) {
      if (t.hidden) continue;
      const pts = t.points.map((q) => ({ pos: anglesToPoint(q, project.cal), params: soundParams(q), t: q.t, kind: q.kind })).filter((q) => q.params);
      const ts = takeSource(pts, here, { mode: project.blendMode });
      if (!ts) continue;
      const A = pts[ts.i];
      const B = pts[Math.min(ts.i + 1, pts.length - 1)];
      out.push({
        key: t.id, type: 'take', id: t.id, takeId: t.id, name: `${t.name} (drawn)`, pos: ts.pos, params: ts.params, color: takeColor(t.id),
        points: pts.length, atSec: (A.t + ts.u * (B.t - A.t)) / 1000, between: [ts.i + 1, Math.min(ts.i + 2, pts.length)],
      });
    }
    return out;
  }

  /**
   * The sound at the marker: inverse-distance weights of the sources, then ONE
   * parameter set for the synthesizer (blendSounds). The contributions are
   * exactly the weights the synthesizer uses; each is split into the part that
   * feeds the pitched (harmonic) synth and the part that feeds the noise synth.
   */
  function blendHere(point) {
    const sources = mapSources(point);
    if (!sources.length) return { contributions: [], params: null };
    const w = idwWeights(sources.map((x) => x.pos), point, project.power);
    const contributions = sources.map((x, i) => ({ source: x, weight: w[i], kind: x.params.kind, voiced: x.params.voiced, pitched: w[i] * x.params.voiced, noise: w[i] * (1 - x.params.voiced) }));
    const params = blendSounds(sources.map((x, i) => ({ params: x.params, weight: w[i] })), { mode: project.blendMode });
    return { contributions, params };
  }

  function currentBlend() {
    return blendHere(st.dot);
  }

  function startSound() {
    const b = currentBlend();
    if (!b.params) { f0Out.textContent = 'The map is empty: add a sound first.'; return; }
    if (audio.playSynth(b.params, 'Motion Morph')) st.soundOn = true;
    st.previewUntil = 0;
    st.gateWanted = null;
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
      if (!tracking) lostText = st.raw && st.raw.noPerson ? 'No person in view: step into the picture.' : `Lost: ${st.raw ? st.raw.lost.join(', ') : 'joints'} (not visible or outside the picture). Keep it in view of the camera.`;
    }
    if (tracking !== st.tracking) {
      st.tracking = tracking;
      if (tracking && project.clap.on) clap.prime(anglesToPoint(st.angles, project.cal), project.clap.region);
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
    const want = now < st.previewUntil || st.replay ? 1 : tracking ? 1 : 0;
    if (want !== st.gateWanted) { audio.setGate(want, want ? 0.05 : 0.15); st.gateWanted = want; }
    const b = currentBlend();
    if (st.soundOn && b.params) audio.update(b.params);
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
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); // mirrored, like a mirror
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#8b98a5'; ctx.font = '600 22px system-ui, sans-serif'; ctx.textAlign = 'center';
      if (!st.landmarks || st.sim) ctx.fillText(st.sim ? 'Practice mode: sliders stand in for the camera' : 'Camera off', W / 2, H / 2);
    }
    ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, 24);
    ctx.fillStyle = '#e6edf3'; ctx.fillText('Mirrored view: your RIGHT arm appears on the right', 8, 17);
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
    chain(BEND_JOINTS, X_COLOR);
    chain(LIFT_JOINTS, Y_COLOR);
    const label = (p, text, color) => {
      ctx.font = '700 17px system-ui, sans-serif'; ctx.textAlign = 'center';
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p.x - w / 2, p.y - 40, w, 24);
      ctx.fillStyle = color; ctx.fillText(text, p.x, p.y - 22);
    };
    const e = P(LM.rightElbow); const s = P(LM.leftShoulder);
    label(e, `RIGHT elbow bend ${st.raw && Number.isFinite(st.raw.bend) ? deg(st.raw.bend) : '—'} → x`, X_COLOR);
    label(s, `LEFT arm lift ${st.raw && Number.isFinite(st.raw.lift) ? deg(st.raw.lift) : '—'} → y`, Y_COLOR);
  }

  function renderCountdown() {
    countdownEl.textContent = st.countdown;
    countdownEl.hidden = !st.countdown;
  }

  function renderButtons() {
    const busy = st.busy || !!drawing;
    adjustBtn.disabled = busy;
    for (const b of flowCard.querySelectorAll('button[data-busy]')) b.disabled = busy;
    addBtn.disabled = busy;
    drawBtn.disabled = busy;
    undoTakeBtn.disabled = !project.takes.length || !!drawing;
    clearBtn.disabled = busy;
  }

  function renderCamera() {
    camBtn.textContent = tracker.running ? '■ Turn camera off' : '📷 Enable camera';
    camMsg.textContent = st.cameraMsg;
    camMsg.className = `pm-cam-msg ${st.camera === 'error' ? 'bad' : st.camera === 'running' ? 'ok' : ''}`;
    if (!tracker.running) { st.landmarks = null; drawPreview(); }
  }

  function renderMapHint() {
    addBtn.setAttribute('aria-pressed', flow ? 'true' : 'false');
    drawBtn.setAttribute('aria-pressed', st.mode === 'draw' ? 'true' : 'false');
    square.classList.toggle('placing', st.mode === 'place');
    square.classList.toggle('drawing', st.mode === 'draw');
    const placing = st.mode === 'place';
    cancelPlaceBtn.hidden = !placing && !st.pending;
    mapHint.className = `pm-map-hint${st.mode !== 'play' || st.pending ? ' active' : ''}`;
    mapHint.textContent = placing ? `Placement mode: click where you want “${flow ? flow.name : 'the sound'}” on the map.`
      : st.pending ? 'The dashed ring shows where your pose lands. Confirm it in the panel below, or try the pose again.'
        : st.mode === 'draw' ? (st.drawStatus || 'Draw + record: hold the mouse down on the map, sing and draw; let go to finish.')
          : st.mapMsg || st.drawStatus || (mapEmpty() ? '' : 'Click a dot to see the pose that plays it.');
    emptyNote.hidden = !mapEmpty() || st.mode !== 'play' || !!drawing || !!st.pending;
  }

  function renderGhosts() {
    gGhosts.replaceChildren();
    for (const g of st.ghosts) {
      const a = toSvg(g.from); const b = toSvg(g.to);
      gGhosts.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: g.color, 'stroke-width': 3, 'stroke-dasharray': '6 8', 'stroke-opacity': 0.7 }),
        svg('circle', { cx: a.x, cy: a.y, r: 18, fill: 'none', stroke: g.color, 'stroke-width': 3, 'stroke-opacity': 0.6 }));
    }
  }

  function renderAxes() {
    const c = project.cal;
    gAxes.replaceChildren(
      // horizontal: right elbow bend (blue), along the bottom
      svg('line', { class: 'pm-axis-line', x1: 60, y1: 985, x2: 960, y2: 985, stroke: X_COLOR, 'marker-end': 'url(#pm-arrow-x)' }),
      svg('text', { class: 'pm-axis-title', x: 500, y: 968, 'text-anchor': 'middle', fill: X_COLOR }, 'RIGHT ELBOW BEND →'),
      svg('text', { class: 'pm-axis-end', x: 70, y: 940, 'text-anchor': 'start', fill: X_COLOR }, `← straighter arm (${deg(c.bend.lo)})`),
      svg('text', { class: 'pm-axis-end', x: 930, y: 940, 'text-anchor': 'end', fill: X_COLOR }, `more bent arm (${deg(c.bend.hi)}) →`),
      // vertical: left arm lift (pink), along the left
      svg('line', { class: 'pm-axis-line', x1: 15, y1: 940, x2: 15, y2: 40, stroke: Y_COLOR, 'marker-end': 'url(#pm-arrow-y)' }),
      svg('text', { class: 'pm-axis-title', x: 42, y: 500, transform: 'rotate(-90 42 500)', 'text-anchor': 'middle', fill: Y_COLOR }, 'LEFT ARM LIFT →'),
      svg('text', { class: 'pm-axis-end', x: 40, y: 900, 'text-anchor': 'start', fill: Y_COLOR }, `arm down (${deg(c.lift.lo)})`),
      svg('text', { class: 'pm-axis-end', x: 40, y: 40, 'text-anchor': 'start', fill: Y_COLOR }, `↑ arm raised (${deg(c.lift.hi)})`));
  }
  const defs = svg('defs', {},
    svg('marker', { id: 'pm-arrow-x', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: X_COLOR })),
    svg('marker', { id: 'pm-arrow-y', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: Y_COLOR })));
  square.prepend(defs);

  function renderMap() {
    renderAxes();
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
    for (const t of onMapTakes()) {
      const col = takeColor(t.id);
      const pts = t.path.map((p) => toSvg(anglesToPoint(p, project.cal)));
      const g = svg('g', { class: 'pm-take', 'data-take-id': t.id },
        svg('polyline', { class: 'pm-take-path', points: pts.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(' '), stroke: col }));
      if (pts.length) g.append(svg('circle', { class: 'pm-take-start', cx: pts[0].x, cy: pts[0].y, r: 12, fill: col }), svg('text', { class: 'pm-take-label', x: pts[0].x, y: pts[0].y - 22, 'text-anchor': 'middle' }, t.name));
      for (const p of t.points) { const s = toSvg(anglesToPoint(p, project.cal)); g.append(svg('circle', { class: `pm-take-pt ${p.kind || 'pitched'}`, cx: s.x, cy: s.y, r: 7, fill: p.kind === 'noise' ? 'none' : col, stroke: col })); }
      gTakes.append(g);
    }
    renderGhosts();
    gAnchors.replaceChildren();
    for (const a of placedSounds(project.sounds, project.cal)) {
      const c = toSvg(a.pos);
      const outside = !poseInRange(a.angles, project.cal);
      const sel = a.id === st.selectedId;
      gAnchors.append(svg('g', { class: `pm-anchor mine${outside ? ' outside' : ''}${sel ? ' selected' : ''}`, 'data-id': a.id, transform: `translate(${c.x} ${c.y})` },
        sel ? svg('circle', { class: 'pm-sel-ring', r: 36 }) : null,
        outside ? svg('circle', { class: 'pm-out-ring', r: 32 }) : null,
        svg('circle', { r: 22, fill: colorOf(a.src) }),
        svg('text', { y: -34, 'text-anchor': 'middle' }, a.name)));
    }
    gPending.replaceChildren();
    if (st.pending) {
      const c = toSvg(anglesToPoint(st.pending.angles, project.cal));
      gPending.append(svg('circle', { class: 'pm-pending-ring', cx: c.x, cy: c.y, r: 34 }), svg('text', { class: 'pm-pending-label', x: c.x, y: c.y + 62, 'text-anchor': 'middle' }, 'your pose lands here'));
    }
    renderLibrary();
    renderTakes();
    renderRange();
    renderMapHint();
  }

  function renderLibrary() {
    const rows = project.sounds.map((s) => h('div', { class: `pm-row${s.id === st.selectedId ? ' selected' : ''}`, 'data-id': s.id },
      h('span', { class: 'pm-swatch', style: { background: colorOf(s) } }),
      h('b', {}, s.name),
      h('span', { class: 'muted pm-row-info' }, `${soundLabel(s.analysis)} · ${s.place ? `on the map: ${describePose(s.place.angles)}${poseInRange(s.place.angles, project.cal) ? '' : ' · outside range'}` : 'not on the map'}${s.source === 'vowel-morph' ? ' · from Vowel Morph' : ''}`),
      h('span', { class: 'row gap wrap pm-row-btns' },
        recs.get(s.audioId) ? h('button', { class: 'btn small', onclick: () => playOriginal(s.audioId, `Original: ${s.name}`) }, '▶ Original') : null,
        h('button', { class: 'btn small', onclick: () => playSynth(s.analysis, `Synthesized: ${s.name}`) }, '▶ Synthesized'),
        h('button', { class: 'btn small pm-place', onclick: () => openFlow(s) }, s.place ? '↻ Redo position' : '📍 Place on map'),
        s.place ? h('button', { class: 'btn small pm-unplace', onclick: () => removeFromMap(s) }, 'Remove from map') : null,
        recheck.get(s.id) ? h('button', { class: 'btn small pm-reanalyze', onclick: () => reanalyze(s) }, '↻ Analyze again') : null,
        h('button', { class: 'btn small danger pm-del-rec', 'aria-label': `Delete recording ${s.name}`, onclick: () => deleteRecording(s) }, '🗑 Delete recording')),
      recheck.get(s.id) ? h('div', { class: 'pm-flag', role: 'note' }, `⚠ ${recheck.get(s.id).text}`) : null));
    libSoundsEl.replaceChildren(...(rows.length ? rows : [h('p', { class: 'help' }, 'No recordings yet. Press 🎤 Add a sound to make your first one.')]));
  }

  function renderTakes() {
    if (!project.takes.length) { libTakesEl.replaceChildren(h('p', { class: 'help' }, `No drawn takes yet. Press ✏️ Draw + record, hold the mouse down on the map and draw while you change your voice. Every ${HOP_SEC} s, ${WINDOW_SEC} s of audio is analyzed and placed where your mouse was at that moment.`)); return; }
    const latest = undoLastTake(project.takes).removed;
    libTakesEl.replaceChildren(
      h('p', { class: 'help' }, `The dots of a take are synthesized sounds reconstructed from your recording, not the recording itself: a filled dot is pitched (pitch + harmonics of a 0.2 s snippet), a hollow ring is noise only (a fricative such as “shh”, its noise spectrum), a half-filled dot has both. Undo removes only the most recent take (${latest.name}).`),
      ...project.takes.map((t) => h('div', { class: 'pm-row pm-take-row', 'data-take-id': t.id },
        h('span', { class: 'pm-swatch', style: { background: takeColor(t.id) } }),
        h('b', {}, t.name),
        h('span', { class: 'muted pm-row-info' }, `${t.points.length} learned points from ${t.stats.snippets} snippets (${kindCounts(t.stats)}) · ${t.durationSec.toFixed(1)} s · ${t.hidden ? 'not on the map' : 'on the map'}`),
        h('span', { class: 'row gap wrap pm-row-btns' },
          recs.get(t.recordingId) ? h('button', { class: 'btn small', onclick: () => playOriginal(t.recordingId, `Original: ${t.name}`) }, '▶ Original') : null,
          h('button', { class: 'btn small pm-replay', disabled: t.path.length < 2 || !t.points.length || t.hidden, onclick: () => (st.replay && st.replay.takeId === t.id ? stopReplay() : replayTake(t)) }, st.replay && st.replay.takeId === t.id ? '■ Stop' : '▶ Preview along the line'),
          h('button', { class: 'btn small pm-take-toggle', onclick: () => { t.hidden = !t.hidden; st.mapMsg = ''; save(); renderAll(); } }, t.hidden ? '📍 Put back on map' : 'Remove from map'),
          h('button', { class: 'btn small danger', 'aria-label': `Delete recording ${t.name}`, onclick: () => deleteTake(t) }, '🗑 Delete recording')),
        takeFlags.get(t.id) ? h('div', { class: 'pm-flag', role: 'note' }, `⚠ ${takeFlags.get(t.id)}`) : null)));
  }

  function renderRange() {
    const c = project.cal;
    const src = { default: 'Default range', adjusted: 'Adjusted to your movement', custom: 'Custom range' }[project.calSource] || 'Range';
    rangeNow.replaceChildren(h('b', {}, `${src}`),
      ...AXES.map((ax) => h('div', { style: { color: ax.color } }, `${ax.dir} — ${ax.label}: ${ax.lo} ${deg(c[ax.key].lo)} (${ax.loSide} edge) → ${ax.hi} ${deg(c[ax.key].hi)} (${ax.hiSide} edge). 10° = ${percentPer10Deg(c[ax.key]).toFixed(0)} % of the map.`)));
    rangeMsg.textContent = st.rangeMsg;
    undoRangeBtn.disabled = !st.prevCal;
    for (const ax of AXES) {
      const u = tuneUi[ax.key];
      u.lo.value = String(c[ax.key].lo); u.hi.value = String(c[ax.key].hi);
      u.out.textContent = `${deg(c[ax.key].lo)} → ${deg(c[ax.key].hi)}`;
      axisUi[ax.key].lo.textContent = `${ax.lo} ${deg(c[ax.key].lo)}`;
      axisUi[ax.key].hi.textContent = `${ax.hi} ${deg(c[ax.key].hi)}`;
    }
  }

  function renderFlow() {
    flowCard.hidden = !flow;
    if (!flow) { flowCard.replaceChildren(); return; }
    const f = flow;
    const s = f.soundId && soundById(f.soundId);
    const stepIdx = { record: 0, listen: 1, place: 2, confirm: 2, ready: 3 }[f.step];
    const stepsBar = h('ol', { class: 'pm-flow-steps', 'aria-label': 'Add a sound: steps' }, FLOW_STEPS.map(([id, label], i) => h('li', { class: `${i < stepIdx ? 'done' : ''}${i === stepIdx ? ' current' : ''}`, 'aria-current': i === stepIdx ? 'step' : null }, h('span', { class: 'pm-step-n' }, i < stepIdx ? '✓' : String(i + 1)), label)));
    let body;
    if (f.step === 'record') {
      const name = h('input', { type: 'text', value: f.name, maxlength: '40', class: 'pm-name', 'aria-label': 'Name of your sound', oninput: () => { f.name = name.value.trim() || 'Sound'; if (s) { s.name = f.name; save(); } } });
      const r = f.result;
      const vm = vowelMorphOptions();
      const vmSel = vm.length ? h('select', { class: 'pm-vm-sel', 'aria-label': 'Use a vowel from Vowel Morph' }, vm.map((o) => h('option', { value: o.id }, o.label))) : null;
      body = [
        h('p', {}, `Name it, press Record, and make one steady pitched sound for ${REC_SEC} s near the laptop: a sung vowel (“ah”, “ee”, “oo”), a hum (“mmm”) or another sustained note.`),
        h('div', { class: 'row gap wrap' }, h('label', { class: 'row gap' }, 'Name', name), h('button', { class: 'btn primary pm-rec', 'data-busy': '1', onclick: () => recordForFlow() }, r && !r.ok ? '↻ Try again' : `● Record ${REC_SEC} s`)),
        h('div', { class: 'pm-add-msg', 'aria-live': 'polite' }, f.msg),
        r && !r.ok ? h('div', { class: 'pm-fail', role: 'alert' }, h('b', {}, 'This recording couldn’t be analyzed. '), `${r.reason} ${r.tip} Nothing was saved. Press “Try again” to record again.`) : null,
        vmSel ? h('div', { class: 'row gap wrap pm-vm-row' }, 'or use a vowel you recorded in Vowel Morph:', vmSel, h('button', { class: 'btn small', 'data-busy': '1', onclick: () => useVowelMorph(vmSel.value) }, 'Use it')) : null,
      ];
    } else if (f.step === 'listen' && s) {
      const an = s.analysis;
      const sm = an.summary;
      body = [
        h('p', {}, 'Listen back: your recording, then the synthesized version the map will play.'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn pm-orig', disabled: !recs.get(s.audioId), onclick: () => playOriginal(s.audioId, 'Original') }, '▶ Original recording'),
          h('button', { class: 'btn pm-synth', onclick: () => playSynth(an, 'Synthesized') }, '▶ Synthesized version')),
        an.kind === 'noise' ? h('div', { class: 'pm-heard' },
          h('div', {}, h('b', {}, 'What the app measured: '), `no pitch: this is an unvoiced fricative-like noise. ${sm ? `Only ${sm.framesPeriodic} of ${sm.framesTotal} short frames had a pitch, ${Math.round((sm.highShare || 0) * 100)} % of the energy is above 2 kHz, centred near ${sm.centroidHz} Hz, strongest band ${sm.strongestBand}.` : ''}`),
          h('div', {}, h('b', {}, 'What it will synthesize where you place it: '), 'white noise shaped by 24 band filters to the spectrum below (no fundamental frequency, no harmonics). Near a vowel the map mixes this noise part with the vowel’s harmonics in one synthesized sound. Only the overall spectrum shape is kept: the hiss sounds similar but not identical to your recording, and its loudness is matched to the other sounds.'),
          h('canvas', { class: 'pm-noise pm-draft-noise', width: 640, height: 110, 'aria-label': 'Noise spectrum of your sound' })) : h('div', { class: 'pm-heard' },
          h('div', {}, h('b', {}, 'What the app measured: '), sm ? `a fundamental (pitch) of ${fmtHz(an.f0)} (${noteName(an.f0)}) on the steady part ${sm.sectionSec[0]}–${sm.sectionSec[1]} s; ${sm.framesPeriodic} of ${sm.framesTotal} short frames had a clear pitch${sm.spreadCents != null ? `, within ${sm.spreadCents} cents` : ''}; ${sm.harmonicsKept} harmonics stood out above the noise. ${warningText(sm.warnings)}` : `a fundamental of ${fmtHz(an.f0)} (${noteName(an.f0)}), analyzed in Vowel Morph.`),
          h('div', {}, h('b', {}, 'What it will synthesize where you place it: '), `one steady tone at ${fmtHz(an.f0)} made of 48 sine waves (1×, 2×, 3×… that pitch) with the strengths below${an.kind === 'mixed' ? `, plus a noise part: there was strong noise between the harmonics (${Math.round((1 - an.voiced) * 100)} % of the energy, like a “zzz”), so it is kept as filtered noise with the spectrum below. Both parts play together in one sound` : ''}. That is all the app keeps from the sound; the recording itself is not played on the map.`),
          h('canvas', { class: 'pm-harm pm-draft-harm', 'aria-label': 'Harmonic strengths of your sound' }),
          an.kind === 'mixed' ? h('canvas', { class: 'pm-noise pm-draft-noise', width: 640, height: 110, 'aria-label': 'Noise part of your sound' }) : null),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary pm-to-place', 'data-busy': '1', onclick: () => { f.step = 'place'; renderAll(); } }, 'Sounds right → choose where it goes'),
          h('button', { class: 'btn pm-rerecord', 'data-busy': '1', onclick: () => { f.step = 'record'; f.result = null; renderAll(); } }, '↻ Record again')),
      ];
    } else if ((f.step === 'place' || f.step === 'confirm') && s) {
      const placing = st.mode === 'place';
      body = [
        h('p', {}, f.redo ? `Choose a new position for “${s.name}”.` : `Where does “${s.name}” belong? Pick one:`),
        h('div', { class: 'pm-choices' },
          h('div', { class: `pm-choice${placing ? ' active' : ''}` },
            h('button', { class: 'btn primary pm-click-btn', 'data-busy': '1', onclick: () => (placing ? cancelPlacement() : startClickPlacement()) }, placing ? 'Cancel placement' : '🖱 Click a spot on the map'),
            h('p', { class: 'help' }, placing ? `Placement mode is on: click anywhere on the map to put “${s.name}” there.` : 'The map switches to placement mode; then click where you want it.')),
          h('div', { class: 'pm-choice' },
            h('button', { class: 'btn primary pm-pose-btn', 'data-busy': '1', onclick: () => capturePoseForFlow() }, `🧍 Use my current pose (${COUNTDOWN_SEC} s countdown)`),
            h('p', { class: 'help' }, `Step back during the countdown (it beeps), hold a comfortable pose for ${HOLD_SEC} s, then confirm where it lands.`))),
        f.step === 'confirm' && st.pending ? h('div', { class: 'pm-confirm' },
          h('b', {}, 'Your pose lands at the dashed ring on the map: '),
          `${describePose(st.pending.angles)} → x ${anglesToPoint(st.pending.angles, project.cal).x.toFixed(2)}, y ${anglesToPoint(st.pending.angles, project.cal).y.toFixed(2)}.`,
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn primary pm-confirm-btn', 'data-busy': '1', onclick: () => placeSound(st.pending.angles, 'pose') }, '✓ Put it here'),
            h('button', { class: 'btn pm-pose-again', 'data-busy': '1', onclick: () => capturePoseForFlow() }, '↻ Try the pose again'),
            h('button', { class: 'btn', onclick: () => cancelPlacement() }, 'Cancel'))) : null,
        h('div', { class: 'pm-pose-msg', 'aria-live': 'polite' }, f.placeMsg),
      ];
    } else if (f.step === 'ready' && s && s.place) {
      const p = anglesToPoint(s.place.angles, project.cal);
      body = [
        h('div', { class: 'pm-howto' },
          h('b', {}, `✓ “${s.name}” is on the map and ready to play. `),
          `It sits at x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)}, which you reach with: ${describePose(s.place.angles)}. ${st.soundOn ? '' : 'Press ▶ Start sound, then '}move your arms until the marker is on its dot (◆ marks on the bars beside the map show the target). Hold the pose and the sound holds; move toward another sound and it blends.`),
        mapEmpty() || onMapSounds().length + onMapTakes().length < 2 ? h('p', { class: 'help' }, 'Tip: add a second sound somewhere else, for example “ah” on the left and “ee” on the right, so that bending your right elbow moves you between them.') : null,
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary pm-add-another', 'data-busy': '1', onclick: () => openFlow() }, '🎤 Add another sound'),
          h('button', { class: 'btn pm-redo-pos', 'data-busy': '1', onclick: () => { f.step = 'place'; f.redo = true; renderAll(); } }, '↻ Redo position'),
          h('button', { class: 'btn', onclick: () => closeFlow() }, 'Done')),
      ];
    } else body = [h('p', {}, 'Nothing to do here.')];
    flowCard.replaceChildren(
      h('div', { class: 'row gap wrap pm-add-head' }, h('h2', {}, f.soundId && s ? `Add a sound: “${s.name}”` : 'Add a sound'), h('button', { class: 'btn small', onclick: () => closeFlow() }, 'Close')),
      stepsBar, ...body);
    const cv = flowCard.querySelector('.pm-draft-harm');
    if (cv && s) new HarmonicBars(cv).set({ amps: s.analysis.amps });
    const nv = flowCard.querySelector('.pm-draft-noise');
    if (nv && s && s.analysis.noise) drawBands(nv, s.analysis.noise.bands);
    renderButtons();
  }

  function draw(b, now) {
    const c = toSvg(st.dot);
    dotEl.setAttribute('transform', `translate(${c.x} ${c.y})`);
    dotEl.classList.toggle('lost', !st.tracking && !st.replay);
    trail.setAttribute('points', st.trail.map((p) => { const s = toSvg(p); return `${s.x.toFixed(0)},${s.y.toFixed(0)}`; }).join(' '));
    const a = st.angles;
    const raw = st.raw;
    const sel = st.selectedId && soundById(st.selectedId);
    for (const ax of AXES) {
      const u = axisUi[ax.key];
      const r = project.cal[ax.key];
      const ok = raw && Number.isFinite(raw[ax.key]);
      const v = ok ? (a && st.tracking ? a[ax.key] : raw[ax.key]) : NaN;
      u.angle.textContent = ok ? deg(v) : '—';
      u.angle.classList.toggle('lost', !ok);
      u.coord.textContent = `${ax.axis} = ${st.dot[ax.axis].toFixed(2)}`;
      u.fill.style.width = `${clamp01((Number.isFinite(v) ? v - r.lo : 0) / (r.hi - r.lo)) * 100}%`;
      const tgt = sel && sel.place ? clamp01((sel.place.angles[ax.key] - r.lo) / (r.hi - r.lo)) : null;
      u.target.hidden = tgt == null;
      if (tgt != null) u.target.style.left = `${tgt * 100}%`;
    }
    const rw = st.raw;
    const bn = !st.tracking || st.sim || !rw || !Number.isFinite(rw.imageBend) ? ''
      : rw.depthShare > 0.25 ? `Forearm points toward the camera: ${deg(rw.imageBend)} in the picture, ${deg(rw.bend)} with the depth correction.` : `Measured in the picture (${deg(rw.bend)}).`;
    if (bendNote.textContent !== bn) bendNote.textContent = bn;
    const weak = st.tracking && !st.sim && rw && rw.weak && rw.weak.length ? ` Unreliable: ${rw.weak.join(', ')} hard to see, so the reading may jump.` : '';
    trackOut.textContent = st.replay ? 'Previewing a take along its line (camera ignored until it ends)' : st.tracking ? (st.sim ? 'Tracking: practice sliders' : 'Tracking both arms') + weak : `${st.lostText} The marker stays where it was and the sound fades until tracking returns.`;
    trackOut.className = `pm-track ${(st.tracking && !weak) || st.replay ? 'ok' : 'bad'}`;
    const tgtText = sel && sel.place ? `Target for “${sel.name}” (◆): right elbow bend ${deg(sel.place.angles.bend)}, left arm lift ${deg(sel.place.angles.lift)}.` : '';
    if (targetOut.textContent !== tgtText) targetOut.textContent = tgtText;
    gLines.replaceChildren();
    if (b.params) {
      for (const k of b.contributions) {
        if (k.weight < 0.01) continue;
        const p = toSvg(k.source.pos);
        gLines.append(svg('line', { x1: c.x, y1: c.y, x2: p.x, y2: p.y, stroke: k.source.color, 'stroke-width': 2 + 14 * k.weight, 'stroke-opacity': 0.15 + 0.75 * k.weight }));
      }
      st.groups = b.contributions.map((k) => ({
        key: k.source.key, type: k.source.type, name: k.source.type === 'sound' && k.kind === 'noise' ? `${k.source.name} (noise)` : k.source.name,
        color: k.source.color, weight: k.weight, kind: k.kind, voiced: k.voiced, pitched: k.pitched, noise: k.noise, source: k.source,
      })).sort((x, y) => y.weight - x.weight);
      if (st.tick % 4 === 0) {
        // When the sound is on, show the parameters the synthesizer is actually using.
        const playing = st.soundOn && audio.voice ? audio.voice.params : null;
        const p = playing || b.params;
        // a part under 1 % (the marker a hair away from a dot) is inaudible: gain √0.01 = −20 dB below the other part, usually far less
        const pitchedShare = p.harm ?? 1;
        const hasPitch = Number.isFinite(p.f0) && pitchedShare >= 0.01;
        const hasNoise = !!p.bands && (p.noise || 0) >= 0.01;
        f0Out.replaceChildren(h('span', { class: 'muted' }, playing ? 'Synthesizer now: ' : 'Here (sound off): '),
          hasPitch ? h('span', {}, h('b', {}, `${p.f0.toFixed(1)} Hz`), ` ${noteName(p.f0)}`) : h('b', {}, 'no pitch (noise only)'));
        const gains = partGains(p);
        mixOut.textContent = hasNoise && hasPitch && p.mode === 'morph'
          ? `One synthesized sound with ONE spectral shape (your sounds’ shapes averaged by the shares above): ${pct(pitchedShare)} of it voiced (harmonics of f0), ${pct(p.noise)} breath noise, both through that same shape. Gains ${gains.harm.toFixed(2)} and ${gains.noise.toFixed(2)}.`
          : hasNoise
          ? `One synthesized sound: ${pct(pitchedShare)} pitched part (f0 and harmonics from your pitched sounds only) + ${pct(p.noise)} noise part (from your fricatives). Played at gains ${gains.harm.toFixed(2)} and ${gains.noise.toFixed(2)} (equal-power mix).`
          : 'One synthesized sound: f0 and harmonic strengths mixed from your pitched sounds by the shares above.';
        const kindTag = (g) => (g.kind === 'noise' ? 'noise' : g.kind === 'mixed' ? `pitched ${pct(g.voiced)} + noise ${pct(1 - g.voiced)}` : 'pitched');
        weightsOut.replaceChildren(...st.groups.filter((g, i) => i === 0 || g.weight >= 0.005).slice(0, 6).map((g) => h('div', { class: 'pm-wrow', 'data-key': g.key },
          h('span', { class: 'pm-swatch', style: { background: g.color } }), h('span', { class: 'pm-wname' }, g.name, h('span', { class: 'muted pm-wkind' }, ` · ${kindTag(g)}`)),
          h('span', { class: 'pm-wbar' }, h('span', { class: 'pm-wbar-p', style: { width: `${g.pitched * 100}%`, background: g.color } }), h('span', { class: 'pm-wbar-n', style: { width: `${g.noise * 100}%`, background: g.color } })), h('span', {}, pct(g.weight)))));
        if (weightsDetails.open) {
          detailsBody.replaceChildren(h('table', { class: 'pm-wtable' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Source'), h('th', {}, 'Share'), h('th', {}, '→ pitched part'), h('th', {}, '→ noise part'), h('th', {}, 'What is used'))),
            h('tbody', {}, ...st.groups.map((g) => h('tr', {},
              h('td', {}, h('span', { class: 'pm-swatch', style: { background: g.color } }), g.name),
              h('td', {}, pct(g.weight)), h('td', {}, pct(g.pitched)), h('td', {}, pct(g.noise)),
              h('td', { class: 'muted' }, g.type === 'take'
                ? `Its closest spot to the marker: ${g.source.atSec.toFixed(1)} s into the take, between dots ${g.source.between[0]} and ${g.source.between[1]} of ${g.source.points}. Sound there: ${kindTag(g)}${Number.isFinite(g.source.params.f0) ? `, ${g.source.params.f0.toFixed(0)} Hz` : ''}.`
                : `${kindTag(g)}${Number.isFinite(g.source.params.f0) ? `, ${g.source.params.f0.toFixed(0)} Hz` : `, strongest near ${strongestBand(g.source.params.bands)}`}.`))))),
          h('p', { class: 'help' }, `Pitched part total ${pct(p.harm ?? 1)}: f0 and harmonics are averaged over the “→ pitched part” column only. Noise part total ${pct(p.noise || 0)}: the noise spectrum is averaged over the “→ noise part” column only.`));
        }
        const lv = (label, share, gain, cls) => h('div', { class: `pm-level ${cls}` }, h('span', { class: 'pm-level-name' }, label),
          h('span', { class: 'pm-wbar' }, h('span', { style: { width: `${gain * 100}%` } })),
          h('span', {}, `${pct(share)} · gain ${gain.toFixed(2)}${gain >= 0.01 ? ` (${(20 * Math.log10(gain)).toFixed(1)} dB)` : ' (off)'}`));
        const out = st.soundOn ? audio.measureOutput() : null;
        st.lastOutput = out;
        levelsOut.replaceChildren(
          h('div', { class: 'muted pm-sub' }, 'Resulting levels in the synthesizer'),
          lv('Pitched (harmonic) part', pitchedShare, gains.harm, 'harm'),
          lv('Noise part', p.noise || 0, gains.noise, 'noise'),
          out && out.rmsDb > -70 ? h('div', { class: 'muted pm-measured' }, `Measured at the output just now: ${pct(out.tonalShare)} of the energy sits on the harmonics of f0, ${pct(1 - out.tonalShare)} is noise between them (level ${out.rmsDb.toFixed(0)} dBFS).${out.tonalShare > 0.05 && out.tonalShare < 0.95 && Number.isFinite(out.tonalCentreHz) && Number.isFinite(out.noiseCentreHz) ? ` The voiced part is centred near ${fmtHz(out.tonalCentreHz)}, the noise part near ${fmtHz(out.noiseCentreHz)}.` : ''}`) : null);
        harmBars.set(hasPitch ? { amps: p.amps } : { amps: null, empty: 'No pitched part here' });
        noiseBox.hidden = !hasNoise;
        if (p.bands) drawBands(noiseCanvas, p.bands);
      }
    } else if (st.tick % 4 === 0) {
      st.groups = [];
      f0Out.textContent = 'Nothing to hear yet: the map is empty.';
      weightsOut.replaceChildren(h('p', { class: 'help' }, 'Add a sound to the map to see each sound’s share here.'));
      harmBars.set({ amps: null, empty: 'No sounds on the map yet' });
      mixOut.textContent = '';
      levelsOut.replaceChildren();
      detailsBody.replaceChildren();
      noiseBox.hidden = true;
    }
    const fresh = now - st.lastClapAt < 450;
    clapOut.textContent = !project.clap.on ? 'Clap off' : fresh ? '👏 Clap!' : clap.count ? `Clap played ${clap.count}×. ${clap.inside ? 'Holding inside: quiet.' : 'Ready.'}` : 'Ready: move into the ring.';
    clapOut.classList.toggle('hit', project.clap.on && fresh);
    gClap.classList.toggle('inside', clap.inside);
  }

  function renderAll() {
    renderMap();
    renderFlow();
    renderButtons();
    renderCountdown();
    renderSoundState();
  }

  // ───────────── map pointer handling ─────────────
  function hitSound(p) {
    const tol = 30 / p.r.width;
    let best = null;
    let bestD = Infinity;
    for (const a of placedSounds(project.sounds, project.cal)) {
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
    if (st.mode === 'place') { placeSound(pointToAngles(p, project.cal), 'click'); return; }
    const hit = hitSound(p);
    st.selectedId = hit ? hit.id : null;
    renderMap();
  });
  square.addEventListener('pointermove', (e) => { if (drawing) addPathPoints(e); });
  square.addEventListener('pointerup', (e) => { if (drawing && e.pointerId === drawing.pointerId) finishDrawing(e); });
  square.addEventListener('pointercancel', (e) => { if (drawing && e.pointerId === drawing.pointerId) finishDrawing(e); });
  const onKey = (e) => { if (e.key === 'Escape' && (st.mode === 'place' || st.pending)) cancelPlacement(); };
  window.addEventListener('keydown', onKey);

  const tour = new Tour(poseTourSteps({
    square, camBtn, overlay, addBtn, drawBtn, undoTakeBtn, clearBtn, adjustBtn, rangeCard, axisPanel, soundCard, libraryCard,
    openAdd: () => { if (!flow) openFlow(); },
    q: (sel) => root.querySelector(sel),
  }), { label: 'Motion Morph tour', finishLabel: 'Done' });

  const timer = setInterval(tick, 20);
  renderCamera();
  renderAll();
  drawPreview();

  window.__poseMap = {
    feed: (frame) => { st.feeding = true; onPose(frame); },
    debug: () => ({
      sim: st.sim, tracking: st.tracking, lostText: st.lostText, raw: st.raw && { ...st.raw }, angles: st.angles && { ...st.angles }, dot: { ...st.dot },
      soundOn: st.soundOn, gate: audio.gate ? audio.gate.gain.value : null, gateTarget: audio.gateLevel ?? null,
      blend: (() => { const b = currentBlend(); return { params: b.params, weights: b.contributions.map((x) => ({ name: x.source.name, id: x.source.id, type: x.source.type, takeId: x.source.takeId || null, kind: x.kind, weight: x.weight, pitched: x.pitched, noise: x.noise, atSec: x.source.atSec ?? null })) }; })(),
      output: st.soundOn ? audio.measureOutput() : null, takeFlags: [...takeFlags].map(([id, text]) => ({ id, text })), takeUpgrade: st.takeUpgrade || [],
      shownWeights: [...weightsOut.querySelectorAll('.pm-wrow')].map((r) => r.textContent), shownLevels: levelsOut.textContent,
      groups: (st.groups || []).map((g) => ({ name: g.name, weight: g.weight, type: g.type, kind: g.kind, pitched: g.pitched, noise: g.noise })),
      shown: { f0: f0Out.textContent, axis: AXES.map((ax) => `${axisUi[ax.key].angle.textContent} ${axisUi[ax.key].coord.textContent}`) },
      audio: audio.debug(), claps: drumCounters.clap, busy: st.busy, countdown: st.countdown,
      camera: st.camera, cameraMsg: st.cameraMsg, fps: tracker.fps,
      mode: st.mode, micListening: mic.listening, drawing: !!drawing, drawStatus: st.drawStatus, mapMsg: st.mapMsg, selectedId: st.selectedId, replay: !!st.replay,
      flow: flow && { step: flow.step, soundId: flow.soundId, name: flow.name, ok: flow.result ? flow.result.ok : null, code: flow.result ? flow.result.code : null, msg: flow.msg, placeMsg: flow.placeMsg },
      pending: st.pending && { ...st.pending.angles }, empty: mapEmpty(), emptyShown: !emptyNote.hidden,
      foreRatio: st.foreRatio.value, held: st.held, weak: st.raw && st.raw.weak ? [...st.raw.weak] : [], imageBend: st.raw ? st.raw.imageBend : null, depthShare: st.raw ? st.raw.depthShare : null,
      shownMix: mixOut.textContent, shownTrack: trackOut.textContent, shownBendNote: bendNote.textContent, noiseShown: !noiseBox.hidden,
      recheck: [...recheck.entries()].map(([id, v]) => ({ id, ...v })), migratedFrom: project.migratedFrom || null,
      rangeMsg: st.rangeMsg, ghosts: st.ghosts.length,
      onMap: placedSounds(project.sounds, project.cal).map((a) => ({ id: a.id, name: a.name, pos: a.pos, outside: !poseInRange(a.angles, project.cal) })),
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

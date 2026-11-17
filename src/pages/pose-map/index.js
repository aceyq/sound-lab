// Pose Sound Map (capstone part 3): the 2D vowel map, played with two joint
// angles measured by the laptop camera.
//
//   camera ─▶ MediaPipe Pose (pose-tracker.js) ─▶ 33 body landmarks
//     ─▶ right elbow bend and left arm lift (pose-model.js, joint angles, not x/y)
//     ─▶ calibrated to 0…1: bend → x, lift → y
//     ─▶ Vowel Morph's inverse-distance blend of the sounds on the map (blendAt)
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
import { blendAt, isUsable, noteName, loadProject as loadMorphProject, POWERS } from '../vowel-morph/morph-model.js';
import { MorphAudio } from '../vowel-morph/morph-audio.js';
import { analyzeTake, MIN_TAKE_SEC } from '../vowel-morph/morph-analysis.js';
import { playDrum, drumCounters } from './drums.js';
import { PoseTracker } from './pose-tracker.js';
import { poseTourSteps } from './pose-tour.js';
import {
  LM, BEND_JOINTS, LIFT_JOINTS, LOST_GRACE_MS, DEFAULT_CAL, CLAP_BUFFER, PROJECT_KEY,
  poseAngles, anglesToPoint, heldAngles, calibrate, smoothAngles, anchorPoint,
  starterAnchors, RegionTrigger, loadProject, cleanAnchor, clamp01,
} from './pose-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ffb74d', '#4dd0c8', '#c792ea', '#f07178', '#c3e88d', '#82aaff', '#ffcb6b', '#89ddff', '#ff9cac', '#a5d6a7'];
const COUNTDOWN_SEC = 3;
const HOLD_SEC = 1;
const REC_SEC = 3;
const STALE_MS = 500; // no camera result for this long → tracking lost

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}
const deg = (v) => (Number.isFinite(v) ? `${v.toFixed(0)}°` : '—');
const pct = (w) => `${(w * 100).toFixed(0)} %`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readStored() {
  try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function mount(root) {
  const project = loadProject(readStored());
  const save = () => { try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch { /* private mode: works until reload */ } };

  const st = {
    camera: 'off', cameraMsg: 'Camera off.',
    sim: false, simAngles: { bend: 15, lift: 15 },
    raw: null, // last poseAngles() result
    lastResultMs: -Infinity, lastOkMs: -Infinity,
    angles: null, // smoothed angles
    lastSmooth: performance.now(),
    dot: { x: 0, y: 0 }, tracking: false, lostText: '',
    soundOn: false, lastClapAt: -Infinity,
    capture: null, // { label, until, samples, resolve }
    countdown: '', busy: false,
    trail: [], landmarks: null, frameSize: { w: 640, h: 480 },
  };
  const clap = new RegionTrigger({ buffer: CLAP_BUFFER });
  const audio = new MorphAudio({ onChange: () => renderSoundState() });
  const mic = new MicInput({ onChange: () => {} });
  const recorder = new VowelRecorder();
  const tracker = new PoseTracker({ onResult: (r) => onPose(r), onStatus: (s, m) => { st.camera = s; st.cameraMsg = m; renderCamera(); } });
  const colorOf = (a) => COLORS[Math.max(0, project.anchors.indexOf(a)) % COLORS.length];

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
    }
    drawPreview();
  }

  // ───────────── page ─────────────
  const video = h('video', { class: 'pm-video', muted: true, playsinline: true, 'aria-hidden': 'true' });
  const overlay = h('canvas', { class: 'pm-overlay', width: 640, height: 480, 'aria-label': 'Camera preview with the six tracked joints marked' });
  const countdownEl = h('div', { class: 'pm-countdown', 'aria-live': 'assertive' });
  const camBtn = h('button', { class: 'btn primary pm-cam-btn', onclick: () => (tracker.running ? tracker.stop() : tracker.start(video)) }, '📷 Enable camera');
  const camMsg = h('div', { class: 'pm-cam-msg', 'aria-live': 'polite' });
  const simChk = h('input', { type: 'checkbox', onchange: () => { st.sim = simChk.checked; simBox.hidden = !st.sim; } });
  const mkSim = (label, key, max) => h('input', { type: 'range', min: '0', max: String(max), step: '1', value: String(st.simAngles[key]), 'aria-label': label, oninput: (e) => { st.simAngles[key] = Number(e.target.value); } });
  const simBend = mkSim('Simulated right elbow bend in degrees', 'bend', 170);
  const simLift = mkSim('Simulated left arm lift in degrees', 'lift', 180);
  const simBox = h('div', { class: 'pm-sim', hidden: true },
    h('label', { class: 'pm-sim-row' }, h('span', {}, 'Right elbow bend'), simBend),
    h('label', { class: 'pm-sim-row' }, h('span', {}, 'Left arm lift'), simLift));

  const restBtn = h('button', { class: 'btn pm-cal-rest', onclick: () => calibrateStep('rest') }, '① Capture start pose');
  const fullBtn = h('button', { class: 'btn pm-cal-full', onclick: () => calibrateStep('full') }, '② Capture full pose');
  const resetCalBtn = h('button', { class: 'btn small', onclick: () => { project.cal = JSON.parse(JSON.stringify(DEFAULT_CAL)); save(); calMsg.textContent = 'Ranges reset to the defaults.'; renderAll(); } }, 'Reset ranges');
  const calMsg = h('div', { class: 'pm-cal-msg', 'aria-live': 'polite' });
  const calOut = h('div', { class: 'pm-cal-out muted' });

  const bendOut = h('div', { class: 'pm-angle' });
  const liftOut = h('div', { class: 'pm-angle' });
  const bendBar = h('div', { class: 'pm-bar' }, h('span'));
  const liftBar = h('div', { class: 'pm-bar' }, h('span'));
  const trackOut = h('div', { class: 'pm-track' });
  const posOut = h('div', { class: 'pm-pos muted' });

  const square = svg('svg', { viewBox: '0 0 1000 1000', class: 'pm-square', role: 'img', 'aria-label': 'Sound map. x = right elbow bend, y = left arm lift. The white dot is your current pose; coloured dots are sounds.' });
  const gGrid = svg('g', { class: 'pm-grid' });
  for (let i = 1; i < 4; i++) gGrid.append(svg('line', { x1: i * 250, y1: 0, x2: i * 250, y2: 1000 }), svg('line', { x1: 0, y1: i * 250, x2: 1000, y2: i * 250 }));
  const gClap = svg('g', { class: 'pm-clap' });
  const gLines = svg('g');
  const gAnchors = svg('g', { class: 'pm-anchors' });
  const trail = svg('polyline', { class: 'pm-trail', points: '' });
  const dotEl = svg('g', { class: 'pm-dot' }, svg('circle', { r: 26 }), svg('circle', { class: 'pm-dot-core', r: 9 }));
  const axisLabels = svg('g', { class: 'pm-axis-labels' },
    svg('text', { x: 500, y: 985, 'text-anchor': 'middle' }, 'right elbow: straight → bent'),
    svg('text', { x: 22, y: 500, transform: 'rotate(-90 22 500)', 'text-anchor': 'middle' }, 'left arm: down → lifted'));
  square.append(gGrid, gClap, axisLabels, gLines, trail, gAnchors, dotEl);

  const soundBtn = h('button', { class: 'btn primary big pm-sound-btn', onclick: () => (st.soundOn ? stopSound() : startSound()) }, '▶ Start sound');
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volumeValue), 'aria-label': 'Volume', oninput: () => audio.setVolume(Number(volume.value)) });
  const f0Out = h('div', { class: 'pm-f0' });
  const weightsOut = h('div', { class: 'pm-weights' });
  const powerSel = h('select', { 'aria-label': 'Distance influence', onchange: () => { project.power = Number(powerSel.value); save(); } },
    POWERS.map((x) => h('option', { value: String(x.p), selected: project.power === x.p || null }, `${x.name} (power ${x.p})`)));
  const clapChk = h('input', { type: 'checkbox', checked: project.clap.on, onchange: () => setClap(clapChk.checked) });
  const clapHere = h('button', { class: 'btn small', onclick: () => { project.clap.region.x = st.dot.x; project.clap.region.y = st.dot.y; clap.prime(st.dot, project.clap.region); save(); renderMap(); } }, 'Use my current pose as the clap region');
  const clapOut = h('div', { class: 'pm-clap-flash', 'aria-live': 'polite' });
  const clapCard = h('div', { class: 'pm-clap-box' },
    h('label', { class: 'check pm-clap-toggle' }, clapChk, h('b', {}, '👏 Clap on the final pose'), ' (optional)'),
    clapOut, clapHere,
    h('p', { class: 'help' }, 'Plays one clap when you enter the ring, stays quiet while you hold it, and is ready again once you leave past the dashed ring and come back.'));

  const vowelSel = h('select', { class: 'pm-vowel-sel', 'aria-label': 'Sound to attach to your pose' });
  const attachBtn = h('button', { class: 'btn primary pm-attach', onclick: () => attachToPose() }, '📌 Attach to my pose');
  const recName = h('input', { type: 'text', value: 'My vowel', maxlength: '40', class: 'pm-name', 'aria-label': 'Name for a vowel recorded on this page' });
  const recBtn = h('button', { class: 'btn pm-rec', onclick: () => recordAtPose() }, `● Record a vowel at my pose`);
  const teachMsg = h('div', { class: 'pm-teach-msg', 'aria-live': 'polite' });
  const listEl = h('div', { class: 'pm-list' });

  const tourBtn = h('button', { class: 'btn primary pm-tour-btn', onclick: () => tour.start(0) }, '🧭 Tour');

  const cameraCard = h('section', { class: 'card pm-camera' },
    h('h2', {}, '1 · Camera'),
    h('div', { class: 'row gap wrap' }, camBtn, h('label', { class: 'check' }, simChk, 'Practice without camera (sliders)')),
    camMsg,
    h('div', { class: 'pm-preview' }, video, overlay, countdownEl),
    h('p', { class: 'help pm-frame-help' }, 'Stand back until your head, both shoulders, elbows, wrists and hips are in the picture. The preview is mirrored. Tracked joints are marked: blue for the right-elbow angle, pink for the left-arm angle, red ✕ when lost. Video stays on this computer.'),
    simBox);
  const calCard = h('section', { class: 'card pm-calib' },
    h('h2', {}, '2 · Calibrate your range'),
    h('p', { class: 'help' }, `Each button counts down ${COUNTDOWN_SEC} s so you can step back, then reads your pose for ${HOLD_SEC} s.`),
    h('ol', { class: 'pm-cal-steps' },
      h('li', {}, h('b', {}, 'Start pose: '), 'right arm straight, left arm down at your side. ', restBtn),
      h('li', {}, h('b', {}, 'Full pose: '), 'right elbow bent as far as is comfortable, left arm lifted as high as is comfortable. ', fullBtn)),
    calMsg, h('div', { class: 'row gap wrap' }, calOut, resetCalBtn));
  const angleCard = h('section', { class: 'card pm-readout' },
    h('h2', {}, 'Your two angles'),
    h('div', { class: 'pm-angles' },
      h('div', { class: 'pm-angle-box' }, h('div', { class: 'muted' }, 'Right elbow bend → left/right'), bendOut, bendBar),
      h('div', { class: 'pm-angle-box' }, h('div', { class: 'muted' }, 'Left arm lift → down/up'), liftOut, liftBar)),
    trackOut, posOut);
  const teachCard = h('section', { class: 'card pm-teach' },
    h('h2', {}, '3 · Teach your poses'),
    h('p', { class: 'help' }, `Pick a sound, press Attach, and hold your pose: after a ${COUNTDOWN_SEC} s countdown the app reads your two angles for ${HOLD_SEC} s and pins the sound to that pose. Vowels you recorded in Vowel Morph (in this browser) are listed first.`),
    h('div', { class: 'row gap wrap' }, vowelSel, attachBtn),
    h('div', { class: 'row gap wrap pm-rec-row' }, h('label', { class: 'row gap' }, 'Or record here:', recName), recBtn),
    teachMsg, listEl,
    h('div', { class: 'row gap wrap' }, h('button', { class: 'btn small', onclick: () => restoreStarters() }, '↺ Restore starter set')));
  const performCard = h('section', { class: 'card pm-perform' },
    h('h2', {}, '4 · Perform the phrase'),
    h('ol', {},
      h('li', {}, 'Right arm straight, left arm down: “ah”.'),
      h('li', {}, 'Slowly bend the right elbow, left arm still down: glide toward “ee”.'),
      h('li', {}, 'Lift the left arm on a sharp count: shift toward “oo”.'),
      h('li', {}, 'Freeze for an extra count (the sound holds), then do it all backward.')),
    h('p', { class: 'help' }, 'The sound follows the pose you are holding right now, not a recording of the phrase, so you can change the timing, pause or reverse whenever you like.'));

  root.append(h('div', { class: 'pm-page' },
    h('div', { class: 'page-top' },
      h('div', {}, h('h1', {}, 'Pose Sound Map'),
        h('p', { class: 'lead' }, 'Play the 2D vowel map with your body. The laptop camera measures two joint angles: how bent your right elbow is (left ↔ right on the map) and how far your left arm is lifted from your torso (down ↕ up). Nearby sounds blend into one voice.')),
      h('div', { class: 'pm-top-actions' }, tourBtn)),
    h('div', { class: 'pm-layout' },
      h('div', { class: 'pm-col' }, cameraCard, calCard, angleCard),
      h('div', { class: 'pm-col' },
        h('div', { class: 'pm-square-wrap' }, square),
        h('section', { class: 'card pm-sound' },
          h('div', { class: 'row gap wrap' }, soundBtn, h('label', { class: 'row gap' }, 'Volume', volume)),
          f0Out, weightsOut,
          h('div', { class: 'field' }, h('label', {}, 'Distance influence '), powerSel),
          clapCard),
        teachCard, performCard))));

  // ───────────── calibration and capture ─────────────
  async function countdownThenCapture(label, holdSec = HOLD_SEC) {
    if (st.busy) return null;
    if (!st.sim && !tracker.running && !st.feeding) { calMsg.textContent = teachMsg.textContent = 'Enable the camera first (or tick Practice without camera).'; return null; }
    st.busy = true;
    renderButtons();
    for (let s = COUNTDOWN_SEC; s > 0; s--) { st.countdown = `${label}\n${s}`; renderCountdown(); await sleep(1000); }
    st.countdown = `${label}\nHold…`; renderCountdown();
    const samples = [];
    st.capture = { samples };
    const end = performance.now() + holdSec * 1000;
    while (performance.now() < end) {
      if (st.sim) samples.push({ ...st.simAngles });
      await sleep(st.sim ? 40 : 50);
    }
    st.capture = null;
    st.countdown = ''; renderCountdown();
    st.busy = false;
    renderButtons();
    const held = heldAngles(samples);
    return held;
  }

  const captured = { rest: null, full: null };
  async function calibrateStep(which) {
    const held = await countdownThenCapture(which === 'rest' ? 'Start pose' : 'Full pose');
    if (!held) { if (!calMsg.textContent.startsWith('Enable')) calMsg.textContent = 'Not enough readings with both arms tracked. Check the preview (no red ✕) and try again.'; return; }
    captured[which] = held;
    const other = which === 'rest' ? captured.full : captured.rest;
    const cur = project.cal;
    // With only one end captured, keep the other end of each range.
    const rest = which === 'rest' ? held : (captured.rest || { bend: cur.bend.lo, lift: cur.lift.lo });
    const full = which === 'full' ? held : (captured.full || { bend: cur.bend.hi, lift: cur.lift.hi });
    project.cal = calibrate(rest, full, cur);
    save();
    calMsg.textContent = `${which === 'rest' ? 'Start' : 'Full'} pose read: elbow bend ${deg(held.bend)}, arm lift ${deg(held.lift)}.${other ? ' Both ends set.' : which === 'rest' ? ' Now capture the full pose.' : ''}`;
    renderAll();
  }

  function sourceOptions() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('vowelMorph.project.v1') || 'null'); } catch { raw = null; }
    const vm = loadMorphProject(raw).vowels.filter(isUsable);
    return [
      ...vm.map((v) => ({ id: `vm:${v.id}`, label: `Vowel Morph: ${v.name} (${fmtHz(v.analysis.f0)})`, name: v.name, source: 'vowel-morph', analysis: v.analysis })),
      ...starterAnchors().map((s) => ({ id: `starter:${s.id}`, label: `Starter: ${s.name.replace('Starter ', '')} (${fmtHz(s.analysis.f0)})`, name: s.name.replace('Starter ', ''), source: 'starter', analysis: s.analysis })),
    ];
  }

  function renderVowelSel() {
    const keep = vowelSel.value;
    const opts = sourceOptions();
    vowelSel.replaceChildren(...opts.map((o) => h('option', { value: o.id }, o.label)));
    if (opts.some((o) => o.id === keep)) vowelSel.value = keep;
    if (!opts.some((o) => o.source === 'vowel-morph')) vowelSel.title = 'No analyzed vowels from Vowel Morph in this browser yet; record some there or record one here.';
  }

  async function attachToPose() {
    const src = sourceOptions().find((o) => o.id === vowelSel.value);
    if (!src) return;
    const held = await countdownThenCapture(`Hold the pose for ${src.name}`);
    if (!held) { if (!teachMsg.textContent.startsWith('Enable')) teachMsg.textContent = 'Not enough readings with both arms tracked. Nothing was attached.'; return; }
    addAnchor({ name: src.name, source: src.source, analysis: src.analysis }, held);
  }

  function addAnchor(base, held) {
    const a = cleanAnchor({ ...base, id: newId('pm'), angles: { bend: held.bend, lift: held.lift }, pose: `elbow ${deg(held.bend)}, lift ${deg(held.lift)}` });
    project.anchors.push(a);
    save();
    teachMsg.textContent = `Attached “${a.name}” (f0 ${fmtHz(a.analysis.f0)}) to elbow bend ${deg(held.bend)}, arm lift ${deg(held.lift)}.`;
    renderAll();
  }

  async function recordAtPose() {
    if (st.busy) return;
    if (!st.sim && !tracker.running && !st.feeding) { teachMsg.textContent = 'Enable the camera first (or tick Practice without camera).'; return; }
    stopSound();
    teachMsg.textContent = 'Opening the microphone…';
    await mic.start();
    if (!mic.listening) { teachMsg.textContent = mic.error ? `${mic.error.title}. ${mic.error.message}` : 'The microphone did not start.'; return; }
    st.busy = true;
    renderButtons();
    for (let s = COUNTDOWN_SEC; s > 0; s--) { st.countdown = `Get into the pose\n${s}`; renderCountdown(); await sleep(1000); }
    st.countdown = 'Sing and hold!'; renderCountdown();
    const samples = [];
    st.capture = { samples };
    const simTimer = st.sim ? setInterval(() => samples.push({ ...st.simAngles }), 40) : 0;
    const result = await recorder.start(mic, REC_SEC);
    clearInterval(simTimer);
    st.capture = null;
    mic.stop();
    st.countdown = ''; renderCountdown();
    st.busy = false;
    renderButtons();
    const sec = result.samples.length / result.sampleRate;
    if (result.error || sec < MIN_TAKE_SEC) { teachMsg.textContent = result.error ? `Recording failed: ${result.error}` : 'The recording was too short.'; return; }
    const held = heldAngles(samples);
    if (!held) { teachMsg.textContent = 'Your arms were not tracked while you sang, so the vowel could not be attached. Check the preview and try again.'; return; }
    const rec = { samples: result.samples, sampleRate: result.sampleRate };
    const dur = sec;
    const r = analyzeTake(rec, { start: Math.min(0.5, dur / 4), end: Math.max(dur - 0.3, dur * 0.75) });
    if (!r.analysis.f0) { teachMsg.textContent = `No usable pitch found (${r.analysis.problems[0] || 'sing a steadier, louder vowel'}). Nothing was attached.`; return; }
    addAnchor({ name: recName.value.trim() || 'My vowel', source: 'recorded', analysis: r.analysis }, held);
  }

  function restoreStarters() {
    const have = new Set(project.anchors.map((a) => a.id));
    project.anchors.push(...starterAnchors().filter((a) => !have.has(a.id)));
    save();
    renderAll();
  }

  // ───────────── sound ─────────────
  function placedAnchors() {
    return project.anchors.map((a) => ({ ...a, src: a, pos: anchorPoint(a, project.cal) }));
  }

  function currentBlend() {
    return blendAt(placedAnchors(), st.dot, project.power);
  }

  function startSound() {
    const b = currentBlend();
    if (!b.params) { f0Out.textContent = 'Attach at least one sound first.'; return; }
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
    soundBtn.textContent = st.soundOn ? '■ Stop sound' : '▶ Start sound';
    soundBtn.classList.toggle('danger', st.soundOn);
  }

  // ───────────── main loop ─────────────
  function tick() {
    const now = performance.now();
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
      audio.setGate(tracking ? 1 : 0, tracking ? 0.05 : 0.15); // fade out when tracking drops, back in when it returns
      if (tracking && project.clap.on) clap.prime(anglesToPoint(st.angles, project.cal), project.clap.region);
    }
    st.lostText = lostText;
    if (tracking) {
      st.dot = anglesToPoint(st.angles, project.cal);
      st.trail.push({ ...st.dot });
      if (st.trail.length > 60) st.trail.shift();
    }
    const b = currentBlend();
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
    for (const b of [restBtn, fullBtn, attachBtn, recBtn]) b.disabled = st.busy;
  }

  function renderCamera() {
    camBtn.textContent = tracker.running ? '■ Turn camera off' : '📷 Enable camera';
    camMsg.textContent = st.cameraMsg;
    camMsg.className = `pm-cam-msg ${st.camera === 'error' ? 'bad' : st.camera === 'running' ? 'ok' : ''}`;
    if (!tracker.running) { st.landmarks = null; drawPreview(); }
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
    gAnchors.replaceChildren();
    for (const a of placedAnchors()) {
      const c = toSvg(a.pos);
      gAnchors.append(svg('g', { class: 'pm-anchor', transform: `translate(${c.x} ${c.y})` },
        svg('circle', { r: 22, fill: colorOf(a.src) }),
        svg('text', { y: -34, 'text-anchor': 'middle' }, a.name.replace(/^Starter /, ''))));
    }
    listEl.replaceChildren(...(project.anchors.length ? project.anchors.map((a) => h('div', { class: 'pm-row' },
      h('span', { class: 'pm-swatch', style: { background: colorOf(a) } }),
      h('b', {}, a.name),
      h('span', { class: 'muted' }, `${fmtHz(a.analysis.f0)} · ${a.angles ? `elbow ${deg(a.angles.bend)}, lift ${deg(a.angles.lift)}` : a.pose} · ${a.source === 'starter' ? 'starter' : a.source === 'vowel-morph' ? 'from Vowel Morph' : 'recorded here'}`),
      h('button', { class: 'btn small danger', 'aria-label': `Remove ${a.name}`, onclick: () => { project.anchors = project.anchors.filter((x) => x !== a); save(); renderAll(); } }, '🗑')))
      : [h('p', { class: 'help' }, 'No sounds yet. Restore the starter set or attach a vowel to a pose.')]));
    const c = project.cal;
    calOut.textContent = `Elbow bend ${deg(c.bend.lo)} → ${deg(c.bend.hi)} · arm lift ${deg(c.lift.lo)} → ${deg(c.lift.hi)}`;
  }

  function draw(b, now) {
    const c = toSvg(st.dot);
    dotEl.setAttribute('transform', `translate(${c.x} ${c.y})`);
    dotEl.classList.toggle('lost', !st.tracking);
    trail.setAttribute('points', st.trail.map((p) => { const s = toSvg(p); return `${s.x.toFixed(0)},${s.y.toFixed(0)}`; }).join(' '));
    const a = st.angles;
    const raw = st.raw;
    bendOut.textContent = raw && Number.isFinite(raw.bend) ? deg(a && st.tracking ? a.bend : raw.bend) : '—';
    liftOut.textContent = raw && Number.isFinite(raw.lift) ? deg(a && st.tracking ? a.lift : raw.lift) : '—';
    bendOut.classList.toggle('lost', !(raw && Number.isFinite(raw.bend)));
    liftOut.classList.toggle('lost', !(raw && Number.isFinite(raw.lift)));
    if (a) {
      bendBar.firstChild.style.width = `${clamp01((a.bend - project.cal.bend.lo) / (project.cal.bend.hi - project.cal.bend.lo)) * 100}%`;
      liftBar.firstChild.style.width = `${clamp01((a.lift - project.cal.lift.lo) / (project.cal.lift.hi - project.cal.lift.lo)) * 100}%`;
    }
    trackOut.textContent = st.tracking ? (st.sim ? 'Tracking: practice sliders' : 'Tracking both angles') : `${st.lostText} The sound fades until tracking returns.`;
    trackOut.className = `pm-track ${st.tracking ? 'ok' : 'bad'}`;
    posOut.textContent = `Map position x ${st.dot.x.toFixed(2)}, y ${st.dot.y.toFixed(2)}`;
    gLines.replaceChildren();
    if (b.params) {
      for (const { vowel, weight } of b.contributions) {
        if (weight < 0.01) continue;
        const p = toSvg(vowel.pos);
        gLines.append(svg('line', { x1: c.x, y1: c.y, x2: p.x, y2: p.y, stroke: colorOf(vowel.src), 'stroke-width': 2 + 14 * weight, 'stroke-opacity': 0.15 + 0.75 * weight }));
      }
      f0Out.replaceChildren(h('span', { class: 'muted' }, 'Fundamental now '), h('b', {}, `${b.params.f0.toFixed(1)} Hz`), ` ${noteName(b.params.f0)}`);
      weightsOut.replaceChildren(...[...b.contributions].sort((x, y) => y.weight - x.weight).slice(0, 5).map(({ vowel, weight }) => h('div', { class: 'pm-wrow' },
        h('span', { class: 'pm-swatch', style: { background: colorOf(vowel.src) } }), h('span', { class: 'pm-wname' }, vowel.name),
        h('span', { class: 'pm-wbar' }, h('span', { style: { width: `${weight * 100}%`, background: colorOf(vowel.src) } })), h('span', {}, pct(weight)))));
    } else {
      f0Out.textContent = 'No sounds on the map yet.';
      weightsOut.replaceChildren();
    }
    const fresh = now - st.lastClapAt < 450;
    clapOut.textContent = !project.clap.on ? 'Clap off' : fresh ? '👏 Clap!' : clap.count ? `Clap played ${clap.count}×. ${clap.inside ? 'Holding inside: quiet.' : 'Ready.'}` : 'Ready: move into the ring.';
    clapOut.classList.toggle('hit', project.clap.on && fresh);
    gClap.classList.toggle('inside', clap.inside);
  }

  function renderAll() {
    renderMap();
    renderVowelSel();
    renderButtons();
    renderCountdown();
    renderSoundState();
  }

  const tour = new Tour(poseTourSteps({ root, camBtn, overlay, restBtn, fullBtn, angleCard, square, soundBtn, vowelSel, attachBtn, recBtn, listEl, performCard, clapCard }), { label: 'Pose Sound Map tour', finishLabel: 'Done' });

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
      blend: (() => { const b = currentBlend(); return { params: b.params, weights: b.contributions.map((x) => ({ name: x.vowel.name, weight: x.weight })) }; })(),
      audio: audio.debug(), claps: drumCounters.clap, clapInside: clap.inside, busy: st.busy, countdown: st.countdown,
      camera: st.camera, cameraMsg: st.cameraMsg, delegate: tracker.delegate, fps: tracker.fps,
      project: JSON.parse(JSON.stringify(project)), tourOpen: tour.open, tourStep: tour.i,
    }),
  };

  return {
    unmount() {
      clearInterval(timer);
      tour.close();
      recorder.cancel();
      mic.stop();
      tracker.close();
      audio.close();
      save();
      delete window.__poseMap;
    },
  };
}

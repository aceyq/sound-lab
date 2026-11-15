// Tilt Sound Map (capstone part 3): the Vowel Morph 2D sound map, played by
// tilting a phone instead of clicking.
//
//   phone (Motion Score controller page, unchanged) ── PeerJS / WebRTC ──▶ this page
//     sample { up, tilt, side } ─▶ angles relative to neutral (pitch, roll)
//     ─▶ map point (roll → x, pitch → y, scaled by the comfortable range)
//     ─▶ Vowel Morph's inverse-distance blend of the sounds on the map
//     ─▶ ONE harmonic voice (Vowel Morph's MorphAudio, 48 sine oscillators)
//   optional percussion: kick / snare / clap regions with hysteresis.
//
// Reused unchanged: SessionHost pairing (motion-score/connection.js), the
// phone controller page, relativeGestures (motion-score/mapping.js), blendAt
// and its weights (vowel-morph/morph-model.js), MorphAudio, the recorder and
// the vowel analysis (analyzeTake).
import './tilt-map.css';
import QRCode from 'qrcode';
import { h, fmtHz } from '../../lib/dom.js';
import { SessionHost } from '../motion-score/connection.js';
import { controllerUrl, isLocalOnly } from '../motion-score/protocol.js';
import { MicInput } from '../frequency/mic.js';
import { VowelRecorder } from '../frequency/recorder.js';
import { newId } from '../frequency/vowel-model.js';
import { blendAt, isUsable, noteName, loadProject as loadMorphProject, POWERS } from '../vowel-morph/morph-model.js';
import { MorphAudio } from '../vowel-morph/morph-audio.js';
import { analyzeTake, initialSegment, MIN_TAKE_SEC } from '../vowel-morph/morph-analysis.js';
import { playDrum, drumCounters } from './drums.js';
import {
  RANGE_MIN, RANGE_MAX, STALE_MS, DRUM_REGIONS, DRUM_BUFFER, PROJECT_KEY,
  anglesFromUp, anglesFromTilt, anglesToPoint, pointToAngles, averageUp, rangeFromSamples, smoothPoint, isStale,
  starterAnchors, PercussionGate, emptyProject, loadProject, cleanAnchor,
} from './tilt-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ffb74d', '#4dd0c8', '#c792ea', '#f07178', '#c3e88d', '#82aaff', '#ffcb6b', '#89ddff', '#ff9cac', '#a5d6a7'];
const MAX_REC_SEC = 4;
const NEUTRAL_SEC = 1;
const RANGE_SEC = 5;

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}
const deg = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°` : '—');
const pct = (w) => `${(w * 100).toFixed(0)} %`;

function readStored() {
  try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function mount(root) {
  const project = loadProject(readStored());
  const save = () => { try { localStorage.setItem(PROJECT_KEY, JSON.stringify(project)); } catch { /* private mode: works until reload */ } };

  // ───────────── live state ─────────────
  const st = {
    conn: 'idle', connDetail: '', phoneUrl: '',
    sim: false, simAngles: { pitch: 0, roll: 0 },
    lastSample: null, lastSampleMs: -Infinity, phoneHidden: false,
    angles: null, // relative to neutral
    dot: { x: 0.5, y: 0.5 }, lastTick: performance.now(),
    tracking: false, soundOn: false,
    calib: null, // { kind: 'neutral' | 'range', until, samples }
    lastDrum: null, // { id, at }
    recording: null, recMsg: '',
    trail: [],
  };
  const gate = new PercussionGate(DRUM_REGIONS);
  const audio = new MorphAudio({ onChange: () => renderSoundState() });
  const mic = new MicInput({ onChange: () => {} });
  const recorder = new VowelRecorder();
  const colorOf = (a) => COLORS[Math.max(0, project.anchors.indexOf(a)) % COLORS.length];

  // ───────────── phone connection (Motion Score pairing, reused) ─────────────
  const host = new SessionHost({
    onState: (state, detail) => { st.conn = state; st.connDetail = detail; renderConn(); },
    onMessage: (msg) => onPhoneMessage(msg),
  });

  function onPhoneMessage(msg) {
    if (msg.type === 'sample') {
      st.lastSample = msg;
      st.lastSampleMs = performance.now();
      if (!project.neutral) setNeutralFrom([msg], true);
      st.angles = phoneAngles(msg);
      if (st.calib) st.calib.samples.push(st.calib.kind === 'neutral' ? msg : st.angles);
    } else if (msg.type === 'status') {
      st.phoneHidden = msg.hidden; // sensors that stop are caught by the 400 ms staleness check
    } else if (msg.type === 'command') {
      if (msg.cmd === 'calibrate') startCalib('neutral');
      else if (msg.cmd === 'arm') startSound();
      else if (msg.cmd === 'disarm' || msg.cmd === 'panic') stopSound();
    } else if (msg.type === 'expr') {
      volume.value = String(msg.value);
      audio.setVolume(msg.value);
    }
  }

  function phoneAngles(msg) {
    const n = project.neutral;
    if (!n) return null;
    if (msg.up && n.up) return anglesFromUp(msg.up, n.up);
    return anglesFromTilt(msg, n);
  }

  function setNeutralFrom(samples, automatic = false) {
    const ups = samples.map((s) => s.up).filter(Boolean);
    const tilts = samples.filter((s) => Number.isFinite(s.tilt) && Number.isFinite(s.side));
    const mean = (k) => tilts.reduce((a, s) => a + s[k], 0) / Math.max(1, tilts.length);
    project.neutral = { up: ups.length ? averageUp(ups) : null, tilt: mean('tilt'), side: mean('side') };
    calibMsg.textContent = automatic
      ? 'Neutral was set from the first reading. Hold your neutral pose and press “Set neutral” to set it properly.'
      : `Neutral set from ${samples.length} readings. The dot is now centred when you hold this pose.`;
    save();
  }

  function startCalib(kind) {
    if (!st.sim && st.conn !== 'connected') { calibMsg.textContent = 'Connect the phone first (or turn on laptop simulation).'; return; }
    if (st.sim) {
      if (kind === 'neutral') { st.simAngles = { pitch: 0, roll: 0 }; simPitch.value = '0'; simRoll.value = '0'; calibMsg.textContent = 'Simulation: sliders reset to neutral.'; }
      else calibMsg.textContent = 'Range measuring needs the phone. In simulation, set the range with the sliders.';
      return;
    }
    st.calib = { kind, until: performance.now() + (kind === 'neutral' ? NEUTRAL_SEC : RANGE_SEC) * 1000, samples: [] };
    calibMsg.textContent = kind === 'neutral' ? `Hold still in your neutral pose for ${NEUTRAL_SEC} s…` : `Tilt forward/back and side to side as far as is comfortable for ${RANGE_SEC} s…`;
    sendPhoneState(true);
  }

  function finishCalib() {
    const c = st.calib;
    st.calib = null;
    if (c.kind === 'neutral') {
      if (c.samples.length < 3) { calibMsg.textContent = 'Not enough readings from the phone. Check that its sensors are on, then try again.'; return; }
      setNeutralFrom(c.samples);
    } else {
      const r = rangeFromSamples(c.samples.filter(Boolean), project.range);
      project.range = r;
      pitchRange.value = String(r.pitch); rollRange.value = String(r.roll);
      calibMsg.textContent = c.samples.length < 5 ? 'Not enough readings; range unchanged.' : `Comfortable range set: forward/back ±${r.pitch}°, sideways ±${r.roll}°.`;
      save();
      renderMap();
    }
    sendPhoneState(true);
  }

  // ───────────── page ─────────────
  const connState = h('div', { class: 'tm-conn-state' });
  const qr = h('canvas', { class: 'tm-qr', width: 200, height: 200, 'aria-label': 'QR code that opens the phone controller' });
  const phoneLink = h('a', { class: 'tm-link', target: '_blank', rel: 'noopener' });
  const codeText = h('div', { class: 'tm-code' });
  const localNote = h('div', { class: 'note', hidden: true }, 'This page is open on localhost, which a phone cannot reach. Use the published site, or `npm run dev:phone` and open the laptop’s network address.');
  const newSessionBtn = h('button', { class: 'btn', onclick: () => connectPhone() }, '↻ New session');
  const simChk = h('input', { type: 'checkbox', onchange: () => { st.sim = simChk.checked; simBox.hidden = !st.sim; if (st.sim) st.lastSampleMs = -Infinity; renderConn(); } });
  const simPitch = h('input', { type: 'range', min: '-60', max: '60', step: '0.5', value: '0', 'aria-label': 'Simulated forward/back tilt (pitch angle) in degrees', oninput: () => { st.simAngles.pitch = Number(simPitch.value); } });
  const simRoll = h('input', { type: 'range', min: '-60', max: '60', step: '0.5', value: '0', 'aria-label': 'Simulated sideways tilt (roll angle) in degrees', oninput: () => { st.simAngles.roll = Number(simRoll.value); } });
  const simBox = h('div', { class: 'tm-sim', hidden: true },
    h('label', { class: 'tm-sim-row' }, h('span', {}, 'Forward/back (pitch)'), simPitch),
    h('label', { class: 'tm-sim-row' }, h('span', {}, 'Sideways (roll)'), simRoll),
    h('p', { class: 'help' }, 'Simulation drives the same mapping as the phone. Use it to rehearse or if the network blocks phone pairing.'));

  const calibMsg = h('div', { class: 'tm-calib-msg', 'aria-live': 'polite' });
  const pitchRange = h('input', { type: 'range', min: String(RANGE_MIN), max: String(RANGE_MAX), step: '1', value: String(project.range.pitch), 'aria-label': 'Comfortable forward/back range in degrees', oninput: () => { project.range.pitch = Number(pitchRange.value); save(); renderRanges(); } });
  const rollRange = h('input', { type: 'range', min: String(RANGE_MIN), max: String(RANGE_MAX), step: '1', value: String(project.range.roll), 'aria-label': 'Comfortable sideways range in degrees', oninput: () => { project.range.roll = Number(rollRange.value); save(); renderRanges(); } });
  const pitchRangeOut = h('span', { class: 'tm-range-out' });
  const rollRangeOut = h('span', { class: 'tm-range-out' });
  const invPitch = h('input', { type: 'checkbox', checked: project.invert.pitch, onchange: () => { project.invert.pitch = invPitch.checked; save(); } });
  const invRoll = h('input', { type: 'checkbox', checked: project.invert.roll, onchange: () => { project.invert.roll = invRoll.checked; save(); } });

  // map
  const square = svg('svg', { viewBox: '0 0 1000 1000', class: 'tm-square', role: 'img', 'aria-label': 'Sound map. The white dot is where the phone points; coloured dots are sounds; rings are drum regions.' });
  const gGrid = svg('g', { class: 'tm-grid' });
  for (let i = 1; i < 4; i++) gGrid.append(svg('line', { x1: i * 250, y1: 0, x2: i * 250, y2: 1000 }), svg('line', { x1: 0, y1: i * 250, x2: 1000, y2: i * 250 }));
  gGrid.append(svg('line', { class: 'tm-axis', x1: 500, y1: 0, x2: 500, y2: 1000 }), svg('line', { class: 'tm-axis', x1: 0, y1: 500, x2: 1000, y2: 500 }));
  const gDrums = svg('g', { class: 'tm-drums' });
  const gLines = svg('g', { class: 'tm-lines' });
  const gAnchors = svg('g', { class: 'tm-anchors' });
  const trail = svg('polyline', { class: 'tm-trail', points: '' });
  const dotEl = svg('g', { class: 'tm-dot' }, svg('circle', { r: 26 }), svg('circle', { class: 'tm-dot-core', r: 9 }));
  const labels = svg('g', { class: 'tm-axis-labels' },
    svg('text', { x: 500, y: 40, 'text-anchor': 'middle' }, 'pitch + (top toward you)'),
    svg('text', { x: 500, y: 980, 'text-anchor': 'middle' }, 'pitch − (top away)'),
    svg('text', { x: 20, y: 515 }, '← roll −'),
    svg('text', { x: 980, y: 515, 'text-anchor': 'end' }, 'roll + →'));
  square.append(gGrid, gDrums, labels, gLines, trail, gAnchors, dotEl);

  const pitchOut = h('div', { class: 'tm-angle' });
  const rollOut = h('div', { class: 'tm-angle' });
  const pitchBar = h('div', { class: 'tm-bar' }, h('span'));
  const rollBar = h('div', { class: 'tm-bar' }, h('span'));
  const posOut = h('div', { class: 'tm-pos muted' });
  const trackOut = h('div', { class: 'tm-track' });
  const f0Out = h('div', { class: 'tm-f0' });
  const weightsOut = h('div', { class: 'tm-weights' });
  const drumOut = h('div', { class: 'tm-drum-flash', 'aria-live': 'polite' }, 'No drum yet');

  const soundBtn = h('button', { class: 'btn primary big', onclick: () => (st.soundOn ? stopSound() : startSound()) }, '▶ Start sound');
  const volume = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.volumeValue), 'aria-label': 'Volume', oninput: () => audio.setVolume(Number(volume.value)) });
  const percChk = h('input', { type: 'checkbox', checked: project.percussion, onchange: () => setPercussion(percChk.checked) });
  const powerSel = h('select', { 'aria-label': 'Distance influence', onchange: () => { project.power = Number(powerSel.value); save(); } },
    POWERS.map((x) => h('option', { value: String(x.p), selected: project.power === x.p || null }, `${x.name} (power ${x.p})`)));

  const recName = h('input', { type: 'text', value: 'My sound', maxlength: '40', class: 'tm-name', 'aria-label': 'Name for the new sound' });
  const recBtn = h('button', { class: 'btn tm-rec', onclick: () => (st.recording ? recorder.stop() : recordAtPose()) }, '● Record at current pose');
  const recOut = h('div', { class: 'tm-rec-msg', 'aria-live': 'polite' });
  const listEl = h('div', { class: 'tm-list' });

  root.append(h('div', { class: 'tm-page' },
    h('div', { class: 'page-top' }, h('div', {},
      h('h1', {}, 'Tilt Sound Map'),
      h('p', { class: 'lead' }, 'Your 2D vowel map, played with a phone. Forward/back tilt moves the dot up and down, sideways tilt moves it left and right. Nearby sounds blend by distance into one voice; drum regions add a beat.'))),
    h('div', { class: 'tm-grid-layout' },
      h('div', { class: 'tm-col' },
        h('section', { class: 'card tm-connect' },
          h('h2', {}, '1 · Connect the phone'),
          h('p', { class: 'help' }, 'Scan the code with the phone (same pairing as Motion Score). On the phone tap Enable Sensors and keep the page open. The phone screen shows the Motion Score controller; its pitch/richness wording does not apply here, read the angles on this page instead.'),
          h('div', { class: 'tm-qr-row' }, qr, h('div', {}, codeText, phoneLink, h('div', { class: 'row gap wrap' }, newSessionBtn))),
          localNote, connState,
          h('label', { class: 'check' }, simChk, 'Laptop simulation (no phone): sliders stand in for the two angles'),
          simBox),
        h('section', { class: 'card tm-calib' },
          h('h2', {}, '2 · Calibrate'),
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn primary', onclick: () => startCalib('neutral') }, '◎ Set neutral (hold still 1 s)'),
            h('button', { class: 'btn', onclick: () => startCalib('range') }, '↔ Measure my range (5 s)')),
          calibMsg,
          h('label', { class: 'tm-range-row' }, h('span', {}, 'Forward/back range ±'), pitchRange, pitchRangeOut),
          h('label', { class: 'tm-range-row' }, h('span', {}, 'Sideways range ±'), rollRange, rollRangeOut),
          h('div', { class: 'row gap wrap' }, h('label', { class: 'check' }, invPitch, 'Flip up/down'), h('label', { class: 'check' }, invRoll, 'Flip left/right')),
          h('p', { class: 'help' }, 'Neutral is the centre of the map. Tilting by the range in one direction reaches that edge of the map; beyond it the dot stays on the edge.')),
        h('section', { class: 'card tm-readout' },
          h('h2', {}, 'Angles'),
          h('div', { class: 'tm-angles' },
            h('div', {}, h('div', { class: 'muted' }, 'Forward/back tilt (pitch) → up/down'), pitchOut, pitchBar),
            h('div', {}, h('div', { class: 'muted' }, 'Sideways tilt (roll) → left/right'), rollOut, rollBar)),
          posOut, trackOut)),
      h('div', { class: 'tm-col tm-map-col' },
        h('div', { class: 'tm-square-wrap' }, square),
        h('section', { class: 'card tm-sound' },
          h('div', { class: 'row gap wrap' }, soundBtn, h('label', { class: 'row gap' }, 'Volume', volume)),
          h('div', { class: 'row gap wrap' },
            h('label', { class: 'check tm-perc' }, percChk, h('b', {}, 'Percussion layer'), ' (kick, snare, clap regions)'),
            drumOut),
          f0Out, weightsOut,
          h('div', { class: 'field' }, h('label', {}, 'Distance influence '), powerSel)),
        h('section', { class: 'card tm-sounds' },
          h('h2', {}, '3 · Sounds on the map'),
          h('p', { class: 'help' }, 'Hold the phone at a pose, then record a steady vowel for 2–4 s. The sound is attached where the dot was when you pressed Record.'),
          h('div', { class: 'row gap wrap' }, h('label', { class: 'row gap' }, 'Name', recName), recBtn),
          recOut,
          listEl,
          h('div', { class: 'row gap wrap tm-list-actions' },
            h('button', { class: 'btn small', onclick: () => importFromVowelMorph() }, '⬇ Copy dots from my Vowel Morph map'),
            h('button', { class: 'btn small', onclick: () => restoreStarters() }, '↺ Add starter sounds back'))))),
  ));

  // ───────────── sounds ─────────────
  function currentBlend() {
    return blendAt(project.anchors, st.dot, project.power);
  }

  function startSound() {
    const b = currentBlend();
    if (!b.params) { f0Out.textContent = 'Add at least one sound to the map first.'; return; }
    if (audio.playSynth(b.params, 'Tilt map')) st.soundOn = true;
    audio.setGate(st.tracking ? 1 : 0, 0.05);
    renderSoundState();
    sendPhoneState(true);
  }

  function stopSound() {
    st.soundOn = false;
    audio.stop();
    renderSoundState();
    sendPhoneState(true);
  }

  function setPercussion(on) {
    project.percussion = on;
    percChk.checked = on;
    if (on) { try { audio.ensure(); } catch { /* reported when sound starts */ } gate.prime(st.dot); }
    save();
    renderMap();
  }

  function renderSoundState() {
    soundBtn.textContent = st.soundOn ? '■ Stop sound' : '▶ Start sound';
    soundBtn.classList.toggle('danger', st.soundOn);
    if (st.soundOn && audio.kind === 'idle') st.soundOn = false;
  }

  async function recordAtPose() {
    stopSound();
    const at = { ...st.dot };
    const angles = st.angles ? { ...st.angles } : null;
    st.recording = { at };
    recBtn.textContent = '■ Stop recording';
    recOut.textContent = 'Asking for the microphone…';
    renderMap();
    await mic.start();
    if (!mic.listening) {
      const err = mic.error;
      st.recording = null;
      recBtn.textContent = '● Record at current pose';
      recOut.textContent = err ? `${err.title}. ${err.message}` : 'The microphone did not start.';
      renderMap();
      return;
    }
    recOut.textContent = 'Recording… sing one steady vowel and hold the pose.';
    const result = await recorder.start(mic, MAX_REC_SEC, { onProgress: (sec) => { recOut.textContent = `Recording… ${sec.toFixed(1)} s of ${MAX_REC_SEC} s. Sing one steady vowel.`; } });
    mic.stop();
    st.recording = null;
    recBtn.textContent = '● Record at current pose';
    if (result.reason === 'cancelled') return;
    const sec = result.samples.length / result.sampleRate;
    if (result.error || sec < MIN_TAKE_SEC) { recOut.textContent = result.error ? `Recording failed: ${result.error}` : `Only ${sec.toFixed(2)} s, too short. Record 2–4 s.`; renderMap(); return; }
    const rec = { samples: result.samples, sampleRate: result.sampleRate };
    const r = analyzeTake(rec, initialSegment(rec));
    if (!r.analysis.f0) { recOut.textContent = `No usable pitch found (${r.analysis.problems[0] || 'try a steadier, louder vowel'}). Nothing was added.`; renderMap(); return; }
    const a = cleanAnchor({ id: newId('tm'), name: recName.value.trim() || 'My sound', source: 'recorded', pos: at, angles, analysis: r.analysis });
    project.anchors.push(a);
    save();
    recOut.textContent = `Added “${a.name}” (f0 ${fmtHz(a.analysis.f0)}) at ${angles ? `pitch ${deg(angles.pitch)}, roll ${deg(angles.roll)}` : `map (${at.x.toFixed(2)}, ${at.y.toFixed(2)})`}.`;
    renderMap();
  }

  function importFromVowelMorph() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('vowelMorph.project.v1') || 'null'); } catch { raw = null; }
    const vm = loadMorphProject(raw);
    const have = new Set(project.anchors.map((a) => a.id));
    const add = vm.vowels.filter((v) => v.pos && isUsable(v) && !have.has(`vm:${v.id}`))
      .map((v) => cleanAnchor({ id: `vm:${v.id}`, name: v.name, source: 'vowel-morph', pos: v.pos, analysis: v.analysis }));
    project.anchors.push(...add.filter(Boolean));
    save();
    recOut.textContent = add.length ? `Copied ${add.length} vowel dot(s) from Vowel Morph at their map positions.` : 'No new placed vowels found in Vowel Morph in this browser.';
    renderMap();
  }

  function restoreStarters() {
    const have = new Set(project.anchors.map((a) => a.id));
    project.anchors.push(...starterAnchors().filter((a) => !have.has(a.id)));
    save();
    renderMap();
  }

  // ───────────── rendering ─────────────
  const toSvg = (p) => ({ x: p.x * 1000, y: (1 - p.y) * 1000 });

  function renderRanges() {
    pitchRangeOut.textContent = `${project.range.pitch}°`;
    rollRangeOut.textContent = `${project.range.roll}°`;
  }

  function renderMap() {
    gDrums.replaceChildren();
    gDrums.classList.toggle('off', !project.percussion);
    for (const r of DRUM_REGIONS) {
      const c = toSvg(r);
      gDrums.append(svg('g', { class: 'tm-drum', 'data-drum': r.id },
        svg('circle', { class: 'tm-drum-buffer', cx: c.x, cy: c.y, r: (r.r + DRUM_BUFFER) * 1000 }),
        svg('circle', { class: 'tm-drum-zone', cx: c.x, cy: c.y, r: r.r * 1000, fill: r.color }),
        svg('text', { x: c.x, y: c.y + 12, 'text-anchor': 'middle' }, r.name)));
    }
    gAnchors.replaceChildren();
    for (const a of project.anchors) {
      const c = toSvg(a.pos);
      gAnchors.append(svg('g', { class: 'tm-anchor', transform: `translate(${c.x} ${c.y})` },
        svg('circle', { r: 20, fill: colorOf(a) }),
        svg('text', { y: -32, 'text-anchor': 'middle' }, a.name.replace(/^Starter /, ''))));
    }
    if (st.recording) {
      const c = toSvg(st.recording.at);
      gAnchors.append(svg('circle', { class: 'tm-pending', cx: c.x, cy: c.y, r: 30 }));
    }
    listEl.replaceChildren(...(project.anchors.length ? project.anchors.map((a) => {
      const ang = a.angles || pointToAngles(a.pos, project.range, project.invert);
      return h('div', { class: 'tm-row' },
        h('span', { class: 'tm-swatch', style: { background: colorOf(a) } }),
        h('b', {}, a.name),
        h('span', { class: 'muted' }, `${fmtHz(a.analysis.f0)} · pitch ${deg(ang.pitch)}, roll ${deg(ang.roll)} · ${a.source === 'starter' ? 'starter' : a.source === 'vowel-morph' ? 'from Vowel Morph' : 'recorded'}`),
        h('button', { class: 'btn small', onclick: () => { a.pos = { ...st.dot }; a.angles = st.angles ? { ...st.angles } : null; save(); renderMap(); } }, 'Move to current pose'),
        h('button', { class: 'btn small danger', onclick: () => { project.anchors = project.anchors.filter((x) => x !== a); save(); renderMap(); } }, '🗑'));
    }) : [h('p', { class: 'help' }, 'No sounds on the map. Record one, copy your Vowel Morph dots, or add the starters back.')]));
    renderRanges();
  }

  function renderConn() {
    const txt = st.sim ? 'Laptop simulation is on: the sliders drive the map.' : {
      idle: 'Not connected.', creating: 'Creating a session…',
      waiting: isLocalOnly(location.hostname) ? 'Session created, but a phone cannot reach localhost.' : 'Waiting for the phone. Scan the QR code.',
      connected: 'Phone connected.', failed: `Connection failed. ${st.connDetail}`, lost: `Connection lost. ${st.connDetail}`,
    }[st.conn] || st.conn;
    connState.textContent = txt;
    connState.className = `tm-conn-state ${st.conn === 'connected' || st.sim ? 'ok' : st.conn === 'failed' || st.conn === 'lost' ? 'bad' : ''}`;
  }

  async function connectPhone() {
    host.start();
    st.phoneUrl = controllerUrl(window.location, host.session.sessionId, host.session.token);
    phoneLink.href = st.phoneUrl;
    phoneLink.textContent = 'Open phone page';
    codeText.textContent = `Session ${host.session.sessionId} · Code ${host.session.token}`;
    localNote.hidden = !isLocalOnly(window.location.hostname);
    try { await QRCode.toCanvas(qr, st.phoneUrl, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } }); } catch { /* the typed code still works */ }
  }

  let lastPhoneState = 0;
  function sendPhoneState(force = false) {
    const now = performance.now();
    if (!force && now - lastPhoneState < 200) return;
    lastPhoneState = now;
    const a = st.angles;
    host.send({
      type: 'state', armed: st.soundOn, audio: audio.ctx && audio.ctx.state === 'running' ? 'on' : 'off',
      calib: st.calib ? 'running' : project.neutral ? 'done' : 'none',
      calibText: st.calib ? (st.calib.kind === 'neutral' ? 'Hold still: setting neutral…' : 'Tilt through your comfortable range…') : '',
      mode: 'flow', mapping: 'tilt', exprSource: 'sustain', exprLevel: Number(volume.value),
      tiltRel: a ? Math.max(-180, Math.min(180, a.pitch)) : null, sideRel: a ? Math.max(-180, Math.min(180, a.roll)) : null,
      richness: st.dot.x, deadZone: 0, sideAvailable: true, hits: gate.hits, sound: true,
      reason: st.soundOn ? '' : 'Sound is off on the laptop.',
    });
  }

  // ───────────── main loop ─────────────
  function tick() {
    const now = performance.now();
    const dt = (now - st.lastTick) / 1000;
    st.lastTick = now;
    if (st.calib && now >= st.calib.until) finishCalib();
    if (st.sim) st.angles = { ...st.simAngles };
    const tracking = st.sim ? true : !isStale(st.lastSampleMs, now) && !st.phoneHidden && st.conn === 'connected' && !!st.angles;
    if (tracking !== st.tracking) {
      st.tracking = tracking;
      audio.setGate(tracking ? 1 : 0, tracking ? 0.05 : 0.12); // fade out when tracking drops, back in when it returns
    }
    if (tracking && st.angles) {
      st.target = anglesToPoint(st.angles, project.range, project.invert);
      st.dot = smoothPoint(st.dot, st.target, dt);
      st.trail.push({ ...st.dot });
      if (st.trail.length > 40) st.trail.shift();
    }
    const b = currentBlend();
    if (st.soundOn && b.params) audio.update(b.params);
    if (tracking && project.percussion) {
      for (const id of gate.update(st.dot, now)) {
        try { audio.ensure(); playDrum(audio.ctx, audio.volume, id); } catch { /* no audio */ }
        st.lastDrum = { id, at: now };
      }
    }
    draw(b, now);
    sendPhoneState();
  }

  function draw(b, now) {
    const c = toSvg(st.dot);
    dotEl.setAttribute('transform', `translate(${c.x} ${c.y})`);
    dotEl.classList.toggle('lost', !st.tracking);
    trail.setAttribute('points', st.trail.map((p) => { const s = toSvg(p); return `${s.x.toFixed(0)},${s.y.toFixed(0)}`; }).join(' '));
    const a = st.angles;
    pitchOut.textContent = a ? deg(a.pitch) : '—';
    rollOut.textContent = a ? deg(a.roll) : '—';
    const bar = (el, v, range) => { const u = Math.max(-1, Math.min(1, v / range)); const s = el.firstChild; s.style.left = `${u < 0 ? 50 + u * 50 : 50}%`; s.style.width = `${Math.abs(u) * 50}%`; };
    if (a) { bar(pitchBar, a.pitch, project.range.pitch); bar(rollBar, a.roll, project.range.roll); }
    posOut.textContent = `Map position x ${st.dot.x.toFixed(3)}, y ${st.dot.y.toFixed(3)}`;
    trackOut.textContent = st.tracking ? (st.sim ? 'Tracking: simulation' : 'Tracking: phone') : st.sim ? '' : st.conn === 'connected' ? `Tracking lost: no phone readings for over ${STALE_MS} ms. Sound fades out until readings return.` : 'Not tracking: connect the phone or turn on simulation.';
    trackOut.className = `tm-track ${st.tracking ? 'ok' : 'bad'}`;
    gLines.replaceChildren();
    if (b.params) {
      for (const { vowel, weight } of b.contributions) {
        if (weight < 0.01) continue;
        const p = toSvg(vowel.pos);
        gLines.append(svg('line', { x1: c.x, y1: c.y, x2: p.x, y2: p.y, stroke: colorOf(vowel), 'stroke-width': 2 + 14 * weight, 'stroke-opacity': 0.15 + 0.75 * weight }));
      }
      f0Out.replaceChildren(h('span', { class: 'muted' }, 'Fundamental now '), h('b', {}, `${b.params.f0.toFixed(1)} Hz`), ` ${noteName(b.params.f0)}`);
      const sorted = [...b.contributions].sort((x, y) => y.weight - x.weight).slice(0, 5);
      weightsOut.replaceChildren(...sorted.map(({ vowel, weight }) => h('div', { class: 'tm-wrow' },
        h('span', { class: 'tm-swatch', style: { background: colorOf(vowel) } }), h('span', { class: 'tm-wname' }, vowel.name),
        h('span', { class: 'tm-wbar' }, h('span', { style: { width: `${weight * 100}%`, background: colorOf(vowel) } })), h('span', {}, pct(weight)))));
    } else {
      f0Out.textContent = 'No sounds on the map yet.';
      weightsOut.replaceChildren();
    }
    for (const g of gDrums.querySelectorAll('.tm-drum')) g.classList.toggle('inside', !!gate.inside.get(g.dataset.drum) && project.percussion);
    const d = st.lastDrum;
    const fresh = d && now - d.at < 400;
    const name = d ? DRUM_REGIONS.find((r) => r.id === d.id).name : '';
    drumOut.textContent = d ? `${fresh ? '🥁 ' : ''}Last drum: ${name}` : project.percussion ? 'Tilt into a ring to play a drum' : 'Percussion off';
    drumOut.classList.toggle('hit', !!fresh);
  }

  const timer = setInterval(tick, 20);
  renderMap();
  renderConn();
  renderSoundState();
  if (project.percussion) gate.prime(st.dot);
  connectPhone();

  // For the automated checks: feed phone messages through the same handler.
  window.__tiltMap = {
    feed: (msg) => onPhoneMessage(msg),
    setConn: (state) => { st.conn = state; renderConn(); },
    debug: () => ({
      conn: st.conn, sim: st.sim, tracking: st.tracking, angles: st.angles && { ...st.angles }, dot: { ...st.dot }, target: st.target && { ...st.target },
      soundOn: st.soundOn, gate: audio.gate ? audio.gate.gain.value : null, gateTarget: audio.gateLevel ?? null,
      blend: (() => { const b = currentBlend(); return { params: b.params, weights: b.contributions.map((c) => ({ name: c.vowel.name, weight: c.weight })) }; })(),
      audio: audio.debug(), hits: gate.hits, drums: { ...drumCounters }, lastDrum: st.lastDrum && st.lastDrum.id,
      project: JSON.parse(JSON.stringify(project)), session: host.session, phoneUrl: st.phoneUrl, calibMsg: calibMsg.textContent,
    }),
  };

  return {
    unmount() {
      clearInterval(timer);
      recorder.cancel();
      mic.stop();
      audio.close();
      host.close();
      save();
      delete window.__tiltMap;
    },
  };
}

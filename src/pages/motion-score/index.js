// Motion Score: laptop Performance page.
// A phone's motion sensors (or Laptop Demo sliders) control an additive
// synthesizer that runs here. See PRESENTATION_NOTES.md for the full guide.

import QRCode from 'qrcode';
import { h, fmtHz } from '../../lib/dom.js';
import { SpectrogramView } from '../frequency/spectrogram.js';
import { SpectrumView, findPeaks, isSilent } from '../frequency/spectrum.js';
import { SessionHost } from './connection.js';
import { controllerUrl, isLocalOnly, SAMPLE_RATE_HZ } from './protocol.js';
import * as M from './mapping.js';
import { Instrument } from './instrument.js';
import { MotionSynth } from './synth.js';
import { MovementScore, WaveScope, C } from './viz.js';
import { HONESTY, MAPPINGS, MODE_TEXT, PITCH_TEXT, HOW, DEMO_GUIDE, ZOOM_STEPS, PERFORMANCE_30S } from './content.js';

const DEFAULT_MASTER = 0.15;
const SG_RANGE = { min: 80, max: 12000, log: true };

export function mount(root) {
  const disposers = [];
  const listen = (target, ev, fn, opts) => {
    target.addEventListener(ev, fn, opts);
    disposers.push(() => target.removeEventListener(ev, fn, opts));
  };
  let alive = true;

  const inst = new Instrument();
  const synth = new MotionSynth({ masterVolume: DEFAULT_MASTER });
  const st = {
    conn: 'idle', // idle | creating | waiting | connected | failed | lost
    connDetail: '',
    phoneUrl: '',
    showPairing: true,
    message: '', // last action feedback
    frozen: false,
    presentation: false,
    guideStep: -1,
    demo: { tilt: 0, intensity: 0, accent: false, seq: 0 },
    rx: { count: 0, times: [], lastSample: null, seqGaps: 0, lastSeq: null, phoneRate: 0 },
  };

  // ───────────────────────────── layout ─────────────────────────────
  const el = {};
  const help = (text, cls = '') => h('p', { class: ('help ' + cls).trim() }, text);
  const btn = (label, onclick, cls = 'btn', extra = {}) => h('button', { class: cls, onclick, ...extra }, label);

  // Status bar (always visible, also in Presentation Mode).
  const pill = () => h('span', { class: 'ms-pill' });
  el.sInput = pill();
  el.sPhone = pill();
  el.sSensors = pill();
  el.sArmed = pill();
  el.sAudio = pill();
  el.sSound = h('span', { class: 'ms-sound' });
  el.panic = btn('🔇 Mute / Panic', () => doPanic(), 'btn big panic', { title: 'Immediately silences and disarms. Stays muted until you press Start Audio.' });
  el.statusBar = h('section', { class: 'ms-statusbar', 'aria-label': 'Status' },
    h('div', { class: 'ms-pills' },
      h('span', { class: 'ms-pill-label' }, 'Input'), el.sInput,
      h('span', { class: 'ms-pill-label' }, 'Phone'), el.sPhone,
      h('span', { class: 'ms-pill-label' }, 'Sensors'), el.sSensors,
      h('span', { class: 'ms-pill-label' }, 'Control'), el.sArmed,
      h('span', { class: 'ms-pill-label' }, 'Audio'), el.sAudio),
    h('div', { class: 'ms-status-right' }, el.sSound, el.panic));

  // A. Setup checklist.
  el.connectBtn = btn('📱 Connect Phone', () => connectPhone(), 'btn primary');
  el.demoBtn = btn('💻 Use Laptop Demo', () => useDemo(), 'btn');
  el.newSessionBtn = btn('New Session', () => connectPhone(), 'btn small');
  el.calBtn = btn('Calibrate', () => calibrate(), 'btn primary');
  el.startBtn = btn('▶ Start Audio', () => startAudio(), 'btn primary');
  el.armBtn = btn('Arm', () => toggleArm(), 'btn primary');
  el.qr = h('canvas', { class: 'ms-qr', width: 200, height: 200 });
  el.qrNote = h('div', { class: 'ms-qr-note' });
  el.url = h('input', { type: 'text', class: 'ms-url mono', readonly: true, 'aria-label': 'Phone controller link' });
  el.copyBtn = btn('Copy link', () => copyUrl(), 'btn small');
  el.sessionId = h('span', { class: 'ms-code mono' }, '—');
  el.code = h('span', { class: 'ms-code mono' }, '—');
  el.pairState = h('div', { class: 'ms-pair-state' });
  el.localWarn = h('div', { class: 'ms-local-warn', hidden: true },
    h('strong', {}, 'A phone cannot pair with this page.'),
    ' This page is open at "localhost", which only exists on this laptop. To use your phone:',
    h('ol', {},
      h('li', {}, 'In Terminal run: ', h('code', {}, 'cd ~/Desktop/frequency-playground && npm run dev:phone')),
      h('li', {}, 'On this laptop, open the "Network" https:// address it prints, plus #/motion-score (accept the certificate warning).'),
      h('li', {}, 'Press Connect Phone there and scan the QR code.')),
    'Or use the hosted https:// site. Laptop Demo works here without a phone.');
  el.pairing = h('div', { class: 'ms-pairing' },
    h('div', { class: 'ms-qr-box' }, el.qr, el.qrNote),
    h('div', { class: 'ms-pair-info' },
      el.localWarn,
      el.pairState,
      el.linkRow = h('div', { class: 'ms-pair-row' }, h('span', { class: 'muted' }, 'Phone link'), h('div', { class: 'row gap' }, el.url, el.copyBtn)),
      el.codeRow = h('div', { class: 'ms-pair-row' }, h('span', { class: 'muted' }, 'Or type on the phone'), h('div', {}, 'Session ID ', el.sessionId, '  Code ', el.code)),
      h('div', { class: 'row gap wrap' }, el.newSessionBtn, help('New Session closes the current connection and makes a fresh QR code. Use it if pairing fails or another phone joined.', 'inline'))));
  el.calText = h('div', { class: 'ms-cal-text' });
  const step = (n, title, where, body) => {
    const mark = h('span', { class: 'ms-step-mark' }, String(n));
    const tag = h('span', { class: 'ms-step-tag' });
    const root = h('li', { class: 'ms-step' }, mark, h('div', { class: 'ms-step-body' },
      h('div', { class: 'ms-step-title' }, h('strong', {}, title), h('span', { class: 'ms-where' }, where), tag), body));
    return { root, mark, tag };
  };
  el.step1 = step(1, 'Connect Phone', 'on laptop', h('div', {},
    h('div', { class: 'row gap wrap' }, el.connectBtn, el.demoBtn),
    help('Connect Phone shows a QR code for your phone. No phone, or the network blocks pairing? Use Laptop Demo (simulated input).'),
    el.pairing));
  el.step2 = step(2, 'Enable Sensors on Phone', 'on phone', help('On the phone, tap the big Enable Sensors button and choose Allow. The status bar then shows Sensors: Active.'));
  el.step3 = step(3, 'Calibrate', 'automatic', h('div', {},
    h('div', { class: 'row gap wrap' }, el.calBtn, h('span', { class: 'help inline' }, 'Starts by itself when the sensors turn on: hold the phone comfortably and still for 3 s. Sets your neutral tilt and the sensor noise at rest. Use the button to redo it.')),
    el.calText));
  el.step4 = step(4, 'Start Audio and Arm Phone', 'laptop (Arm also on phone)', h('div', {},
    h('div', { class: 'row gap wrap' }, el.startBtn, el.armBtn),
    help('Start Audio turns on the laptop\'s sound engine. Arm lets movement control the sound; Disarm pauses it and silences.')));
  el.setupMsg = h('p', { class: 'note' });
  el.setup = h('section', { class: 'card ms-setup' },
    h('div', { class: 'viz-head' }, h('h2', {}, 'A · Setup'), h('span', { class: 'ms-setup-summary' })),
    h('ol', { class: 'ms-steps' }, el.step1.root, el.step2.root, el.step3.root, el.step4.root),
    el.setupMsg);
  el.setupSummary = el.setup.querySelector('.ms-setup-summary');

  // B. Play.
  const value = (label, sub) => {
    const v = h('div', { class: 'pv-value mono' }, '—');
    const s = h('div', { class: 'pv-sub' }, sub);
    return { root: h('div', { class: 'pv-card' }, h('div', { class: 'pv-label' }, label), v, s), v, s };
  };
  el.vF = value('Fundamental', '← tilt');
  el.vH = value('Harmonic components', '← movement intensity');
  el.vE = value('Expression', 'movement-controlled strength');
  el.vMode = value('Mode', '');
  el.modeFlow = btn('Flow', () => setMode('flow'), 'btn seg');
  el.modeAcc = btn('Accents', () => setMode('accents'), 'btn seg');
  el.modeText = h('p', { class: 'ms-mode-text' });
  el.pCont = btn('Continuous', () => setPitchMode('continuous'), 'btn seg');
  el.pPent = btn('Pentatonic', () => setPitchMode('pentatonic'), 'btn seg');
  el.stopBtn = btn('■ Stop Audio', () => stopAudio(), 'btn');
  el.startBtn2 = btn('▶ Start Audio', () => startAudio(), 'btn primary');
  el.armBtn2 = btn('Arm', () => toggleArm(), 'btn');
  el.vol = h('input', { type: 'range', min: 0, max: 0.6, step: 0.01, value: DEFAULT_MASTER, 'aria-label': 'Master Volume', oninput: () => setVolume() });
  el.volOut = h('span', { class: 'mono' }, pct(DEFAULT_MASTER));
  el.legend = h('div', { class: 'ms-legend' },
    tiltDiagram(),
    h('ul', {}, ...MAPPINGS.map(([a, b], i) => h('li', {}, h('span', { class: 'ms-dot', style: { background: [C.pitch, C.intensity, C.accent][i] } }), h('strong', {}, a), ' ', h('span', { class: 'muted' }, b)))));
  el.scoreCanvas = h('canvas', { class: 'plot' });
  el.sgCanvas = h('canvas', { class: 'plot' });
  el.clearScore = btn('Clear Movement Score', () => score.clear(), 'btn small', { title: 'Erases the Movement Score history. Does not change sound.' });
  el.clearSg = btn('Clear Spectrogram', () => spectrogram.clear(), 'btn small', { title: 'Erases the spectrogram history. Does not change sound.' });
  el.freezeBtn = btn('❄ Freeze Visual History', () => toggleFreeze(), 'btn');
  el.presentBtn = btn('🖥 Presentation Mode', () => togglePresentation(), 'btn');
  el.guideBtn = btn('🧭 Demo Guide', () => openGuide(), 'btn');
  el.frozenBadge = h('div', { class: 'ms-frozen', hidden: true }, '❄ VISUAL HISTORY FROZEN: sound and safety checks are still live');

  // Laptop Demo panel.
  el.dTilt = h('input', { type: 'range', min: -35, max: 35, step: 1, value: 0, 'aria-label': 'Simulated tilt', oninput: () => { st.demo.tilt = Number(el.dTilt.value); } });
  el.dInt = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Simulated movement intensity', oninput: () => { st.demo.intensity = Number(el.dInt.value) / 100; } });
  el.dTiltOut = h('span', { class: 'mono' });
  el.dIntOut = h('span', { class: 'mono' });
  el.dAccent = btn('⚡ Trigger Accent (A)', () => { st.demo.accent = true; }, 'btn');
  el.demoPanel = h('section', { class: 'card ms-demo', hidden: true },
    h('div', { class: 'ms-demo-badge' }, 'Laptop Demo — phone sensors are not connected.'),
    h('div', { class: 'ms-demo-grid' },
      h('label', {}, h('span', { class: 'ms-demo-head' }, h('strong', {}, 'Tilt'), ' → pitch', el.dTiltOut), el.dTilt),
      h('label', {}, h('span', { class: 'ms-demo-head' }, h('strong', {}, 'Movement intensity'), ' → richness and Flow expression', el.dIntOut), el.dInt),
      h('div', {}, el.dAccent, h('div', { class: 'help' }, 'Trigger Accent → short note in Accents mode'))),
    help('Keyboard: ← → tilt · ↑ ↓ movement intensity · A (or Space) trigger accent. These simulated values go through the same mappings as phone data.'),
    h('div', { class: 'row gap' }, btn('Stop Laptop Demo', () => stopInput(), 'btn small')));

  el.play = h('section', { class: 'card ms-play' },
    h('div', { class: 'viz-head' }, h('h2', {}, 'B · Play'), h('div', { class: 'row gap wrap' }, el.freezeBtn, el.guideBtn, el.presentBtn)),
    h('div', { class: 'pv-row ms-values' }, el.vF.root, el.vH.root, el.vE.root, el.vMode.root),
    h('div', { class: 'ms-controls' },
      h('div', { class: 'ms-ctl' }, h('div', { class: 'ms-ctl-title' }, 'Performance mode'), h('div', { class: 'seg-group' }, el.modeFlow, el.modeAcc), el.modeText),
      h('div', { class: 'ms-ctl' }, h('div', { class: 'ms-ctl-title' }, 'Pitch'), h('div', { class: 'seg-group' }, el.pCont, el.pPent), h('p', { class: 'ms-mode-text' }, PITCH_TEXT)),
      h('div', { class: 'ms-ctl' }, h('div', { class: 'ms-ctl-title' }, 'Audio'),
        h('div', { class: 'row gap wrap' }, el.startBtn2, el.stopBtn, el.armBtn2),
        h('label', { class: 'row gap ms-vol' }, h('span', {}, 'Master Volume'), el.vol, el.volOut),
        h('p', { class: 'ms-mode-text' }, 'Master Volume is the listening level you set; Expression comes from movement.'))),
    el.demoPanel,
    el.legend,
    h('div', { class: 'ms-viz' },
      h('div', { class: 'ms-viz-head' }, h('h3', {}, 'Movement Score'), h('span', { class: 'help inline' }, 'Control values from the phone over the last 10 s: pitch (blue), movement intensity (green), expression (white dashes, Flow), harmonic components (purple), accents (orange).'), el.clearScore),
      h('div', { class: 'canvas-box ms-score-box' }, el.scoreCanvas, el.frozenBadge)),
    h('div', { class: 'ms-viz' },
      h('div', { class: 'ms-viz-head' }, h('h3', {}, 'Spectrogram (audio output)'), h('span', { class: 'help inline' }, 'Measured frequencies of the sound over the last 10 s. Frequency axis is logarithmic; brighter = louder (dB).'), el.clearSg),
      h('div', { class: 'canvas-box ms-sg-box' }, el.sgCanvas)));

  // C. Learn / Settings.
  el.sens = h('input', { type: 'range', min: 0.5, max: 2, step: 0.05, value: 1, 'aria-label': 'Sensitivity', oninput: () => { inst.settings.sensitivity = Number(el.sens.value); render(); } });
  el.sensOut = h('span', { class: 'mono' }, '1.00×');
  el.invert = h('input', { type: 'checkbox', onchange: () => { inst.settings.invertTilt = el.invert.checked; render(); } });
  el.recal = btn('Recalibrate', () => calibrate(), 'btn small');
  el.calValues = h('div', { class: 'mono help' });
  el.waveCanvas = h('canvas', { class: 'plot' });
  el.specCanvas = h('canvas', { class: 'plot' });
  el.graphs = h('details', { class: 'ms-more' },
    h('summary', {}, 'Audio graphs: waveform and spectrum'),
    h('div', { class: 'ac-two' },
      h('div', {}, h('h3', {}, 'Waveform (20 ms)'), h('div', { class: 'canvas-box ms-small-box' }, el.waveCanvas), help('Audio amplitude over time, measured at the output. More harmonics make a more jagged shape with the same repeat period.')),
      h('div', {}, h('h3', {}, 'Spectrum (now)'), h('div', { class: 'canvas-box ms-small-box' }, el.specCanvas), help('Audio frequency content at this moment. Dashed lines: expected components n × fundamental. White dots: measured peaks.'))));
  el.diag = h('pre', { class: 'ms-diag mono' });
  el.learn = h('section', { class: 'card ms-learn secondary' },
    h('h2', {}, 'C · Learn and settings'),
    h('details', { class: 'ms-more' }, h('summary', {}, 'How it works'),
      h('p', { class: 'note' }, HONESTY),
      h('dl', { class: 'ms-how' }, ...HOW.flatMap(([t, s, more]) => [h('dt', {}, t), h('dd', {}, s, ' ', h('details', { class: 'ms-detail' }, h('summary', {}, 'More detail'), h('p', {}, more)))]))),
    h('details', { class: 'ms-more' }, h('summary', {}, 'Calibration and sensitivity'),
      h('label', { class: 'row gap ms-vol' }, h('span', {}, 'Sensitivity'), el.sens, el.sensOut),
      help('Higher sensitivity: smaller movements reach 100% intensity and lighter flicks count as accents. Use it if the sound stays quiet; lower it if the sound never goes silent.'),
      h('label', { class: 'check' }, el.invert, ' Invert tilt (tilt away from you = higher)'),
      help('Use if the pitch direction feels backwards.'),
      h('div', { class: 'row gap' }, el.recal, help('Recalibrate after changing how you hold the phone.', 'inline')),
      el.calValues),
    el.graphs,
    h('details', { class: 'ms-more' }, h('summary', {}, 'Diagnostics'), help('Raw measurements, mapped values and connection details. Useful for troubleshooting; not needed to perform.'), el.diag),
    h('details', { class: 'ms-more' }, h('summary', {}, 'Presentation help'),
      h('h3', {}, 'Zoom setup'), h('ol', {}, ...ZOOM_STEPS.map((s) => h('li', {}, s))),
      help('Use headphones on the laptop to avoid echo. A hosted website alone does not guarantee pairing: test on the actual network beforehand, and keep Laptop Demo ready.'),
      h('h3', {}, '30-second demonstration'),
      h('dl', { class: 'ac-perf' }, ...PERFORMANCE_30S.flatMap(([t, d]) => [h('dt', {}, t), h('dd', {}, d)])),
      help('Tilt and movement intensity are physically linked (tilting is itself a movement), so the demonstration separates them approximately, not perfectly.')));

  // Demo Guide overlay.
  el.guideText = h('div', {});
  el.guide = h('div', { class: 'ms-guide', hidden: true, role: 'dialog', 'aria-label': 'Demo Guide' },
    el.guideText,
    h('div', { class: 'row gap' }, btn('← Back', () => guideStep(-1), 'btn small'), btn('Next →', () => guideStep(1), 'btn small primary'), btn('Close', () => closeGuide(), 'btn small')));

  const page = h('div', { class: 'motion-score' },
    h('div', { class: 'page-top ms-top' },
      h('div', {},
        h('h1', {}, 'Motion Score'),
        h('p', { class: 'lead' }, 'Turn dance movement into sound. Your phone\'s motion sensors play an instrument on this laptop.'),
        h('p', { class: 'help secondary' }, HONESTY))),
    el.statusBar,
    el.setup,
    el.play,
    el.learn,
    el.guide);
  root.append(page);

  // ───────────────────────────── engines ─────────────────────────────
  const score = new MovementScore(el.scoreCanvas);
  const spectrogram = new SpectrogramView(el.sgCanvas, {
    timeLabel: 'Time (newest on the right)',
    emptyText: 'Waiting for data. New columns appear on the right as time passes.',
  });
  const spectrum = new SpectrumView(el.specCanvas);
  const scope = new WaveScope(el.waveCanvas);

  const host = new SessionHost({
    onState: (state, detail) => {
      st.conn = state;
      st.connDetail = detail;
      if (state === 'connected') {
        inst.setConnected(true);
        st.showPairing = false;
        pushState();
      } else {
        if (inst.source === 'phone') inst.setConnected(false, state === 'lost' ? `${detail} Arm again after reconnecting.` : undefined);
        if (state === 'waiting' || state === 'creating') st.showPairing = true;
        inst.phoneSensors = 'off';
        synth.silence();
      }
      if (state === 'waiting') drawQr();
      render();
    },
    onMessage: (msg) => onPhoneMessage(msg),
  });

  // ───────────────────────────── phone input ─────────────────────────────
  function onPhoneMessage(msg) {
    if (inst.source !== 'phone') return;
    const now = performance.now();
    if (msg.type === 'sample') {
      const r = st.rx;
      r.count++;
      r.times.push(now);
      while (r.times.length && r.times[0] < now - 1000) r.times.shift();
      if (r.lastSeq !== null && msg.seq > r.lastSeq + 1) r.seqGaps += msg.seq - r.lastSeq - 1;
      r.lastSeq = msg.seq;
      r.lastSample = msg;
      r.phoneRate = msg.rate;
      if (inst.phoneSensors !== 'active') inst.phoneSensors = 'active';
      handleSample(msg, now);
      // First data from a newly connected phone: calibrate right away, so the
      // performer only has to hold still (Recalibrate stays available).
      if (inst.calib.state === 'none' && st.rx.count >= 5) calibrate();
    } else if (msg.type === 'status') {
      inst.setPhoneStatus(msg);
      if (msg.hidden) synth.silence();
      render();
      pushState();
    } else if (msg.type === 'command') {
      if (msg.cmd === 'arm') armNow();
      else if (msg.cmd === 'disarm') disarmNow('Disarmed from the phone.');
      else if (msg.cmd === 'calibrate') calibrate();
      else if (msg.cmd === 'panic') doPanic();
    }
  }

  /** Same path for phone samples and Laptop Demo samples. */
  function handleSample(sample, now) {
    const { accent } = inst.ingest(sample, now);
    if (accent) {
      synth.setPitch(inst.f0, inst.pitchMode, { instant: true });
      synth.setHarmonicCount(inst.count);
      synth.triggerAccent();
      if (!st.frozen) score.accent(now / 1000, inst.f0);
      pushState();
    }
  }

  // ───────────────────────────── Laptop Demo input ─────────────────────────────
  let demoTimer = 0;
  function demoTick() {
    const d = st.demo;
    const thr = inst.detector.threshold(inst.cal, inst.settings);
    const range = inst.settings.intensityRange / inst.settings.sensitivity;
    const floor = inst.cal.noise * 1.3 + 0.05;
    const sample = {
      type: 'sample', seq: d.seq++, t: performance.now(),
      tilt: d.tilt, tiltSrc: 'orientation',
      lin: d.intensity > 0 ? floor + d.intensity * range : inst.cal.noise * 0.5, linSrc: 'sensor',
      jerk: d.accent ? thr * 3 : 5, screen: 0, rate: SAMPLE_RATE_HZ,
    };
    d.accent = false;
    handleSample(sample, performance.now());
  }

  // ───────────────────────────── actions ─────────────────────────────
  function feedback(text) {
    st.message = text;
    render();
  }

  function connectPhone() {
    stopDemo();
    synth.silence();
    inst.setSource('none');
    inst.setSource('phone');
    resetRx();
    st.showPairing = true;
    host.start();
    feedback('');
  }

  function useDemo() {
    host.close();
    st.conn = 'idle';
    synth.silence();
    inst.setSource('demo');
    resetRx();
    st.demo = { tilt: 0, intensity: 0, accent: false, seq: 0 };
    el.dTilt.value = 0;
    el.dInt.value = 0;
    clearInterval(demoTimer);
    demoTimer = setInterval(demoTick, 1000 / SAMPLE_RATE_HZ);
    feedback('Laptop Demo is on. Start Audio, Arm, then move the sliders.');
  }

  function stopDemo() {
    clearInterval(demoTimer);
    demoTimer = 0;
  }

  function stopInput() {
    stopDemo();
    host.close();
    st.conn = 'idle';
    synth.silence();
    inst.setSource('none');
    feedback('Input stopped.');
  }

  function resetRx() {
    st.rx = { count: 0, times: [], lastSample: null, seqGaps: 0, lastSeq: null, phoneRate: 0 };
  }

  function calibrate() {
    const err = inst.startCalibration(performance.now());
    synth.silence();
    feedback(err);
    pushState();
  }

  async function startAudio() {
    try {
      const p = synth.start();
      inst.setAudio(true);
      render();
      await p;
    } catch (err) {
      inst.setAudio(false);
      feedback(`Audio could not start: ${err.message || err}`);
      return;
    }
    if (!alive) return;
    synth.setPitch(inst.f0, inst.pitchMode);
    synth.setHarmonicCount(inst.count);
    feedback(inst.armed ? '' : 'Audio is on. Next: Arm to let movement control the sound.');
    pushState();
  }

  function stopAudio() {
    synth.stop();
    inst.setAudio(false);
    inst.disarm('Audio stopped.');
    feedback('Audio stopped and control disarmed.');
    pushState();
  }

  function doPanic() {
    synth.panic();
    inst.triggerPanic();
    feedback('Muted by Panic. Sound is off and control is disarmed. Press Start Audio, then Arm, to play again.');
    pushState();
  }

  function armNow() {
    const err = inst.arm();
    feedback(err || (inst.audioOn ? 'Armed: movement now controls the sound.' : 'Armed. Press Start Audio to hear it.'));
    pushState();
  }

  function disarmNow(reason) {
    inst.disarm(reason);
    synth.silence();
    feedback(reason);
    pushState();
  }

  function toggleArm() {
    if (inst.armed) disarmNow('Disarmed: movement no longer controls the sound.');
    else armNow();
  }

  function setVolume() {
    const v = Number(el.vol.value);
    synth.setMasterVolume(v);
    el.volOut.textContent = pct(v);
  }

  function setMode(mode) {
    if (inst.mode === mode) return;
    synth.silence();
    inst.setMode(mode);
    render();
    pushState();
  }

  function setPitchMode(mode) {
    inst.pitchMode = mode;
    inst.note = null;
    render();
  }

  function toggleFreeze() {
    st.frozen = !st.frozen;
    if (!st.frozen) {
      spectrogram.markStart();
      score.mark(performance.now() / 1000);
    }
    render();
  }

  function togglePresentation() {
    st.presentation = !st.presentation;
    document.body.classList.toggle('presentation', st.presentation);
    page.classList.toggle('ms-present', st.presentation);
    render();
  }

  function openGuide() {
    st.guideStep = 0;
    renderGuide();
  }

  function guideStep(d) {
    st.guideStep = Math.max(0, Math.min(DEMO_GUIDE.length - 1, st.guideStep + d));
    renderGuide();
  }

  function closeGuide() {
    st.guideStep = -1;
    renderGuide();
  }

  function renderGuide() {
    el.guide.hidden = st.guideStep < 0;
    if (st.guideStep < 0) return;
    const [t, d] = DEMO_GUIDE[st.guideStep];
    el.guideText.replaceChildren(
      h('div', { class: 'ms-guide-count' }, `Demo Guide · step ${st.guideStep + 1} of ${DEMO_GUIDE.length}`),
      h('div', { class: 'ms-guide-title' }, t),
      h('div', { class: 'ms-guide-body' }, d));
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(st.phoneUrl);
      feedback('Phone link copied.');
    } catch {
      el.url.select();
      feedback('Select the link and copy it with Cmd/Ctrl+C.');
    }
  }

  async function drawQr() {
    if (!host.session) return;
    st.phoneUrl = controllerUrl(window.location, host.session.sessionId, host.session.token);
    el.url.value = st.phoneUrl;
    el.sessionId.textContent = host.session.sessionId;
    el.code.textContent = host.session.token;
    const local = isLocalOnly(window.location.hostname);
    const insecure = window.location.protocol !== 'https:';
    el.qr.hidden = local;
    // A localhost link can never work on a phone, so don't offer one.
    el.linkRow.hidden = local;
    el.codeRow.hidden = local;
    el.localWarn.hidden = !local;
    el.qr.parentElement.hidden = local;
    if (local) {
      el.qrNote.textContent = '';
      return;
    }
    el.qrNote.textContent = insecure
      ? 'Warning: this page is not https. Phones only allow motion sensors on secure pages, so sensors will likely be blocked.'
      : 'Scan with the phone camera.';
    try {
      await QRCode.toCanvas(el.qr, st.phoneUrl, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    } catch {
      el.qrNote.textContent = 'Could not draw the QR code. Type the Session ID and Code on the phone instead.';
    }
  }

  // ───────────────────────────── keyboard (Laptop Demo) ─────────────────────────────
  listen(window, 'keydown', (e) => {
    if (e.key === 'Escape' && st.presentation) togglePresentation();
    if (inst.source !== 'demo') return;
    // Let focused form controls handle their own keys (a focused slider
    // already moves with the arrows; a focused button already clicks on Space).
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range')) return;
    if (e.key === 'a' || e.key === 'A') {
      st.demo.accent = true;
      e.preventDefault();
      return;
    }
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SUMMARY') return;
    const d = st.demo;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      d.tilt = Math.max(-35, Math.min(35, d.tilt + (e.key === 'ArrowRight' ? 3 : -3)));
      el.dTilt.value = d.tilt;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      d.intensity = Math.max(0, Math.min(1, d.intensity + (e.key === 'ArrowUp' ? 0.1 : -0.1)));
      el.dInt.value = Math.round(d.intensity * 100);
    } else if (e.key === ' ') {
      d.accent = true;
    } else return;
    e.preventDefault();
  });

  // Hidden laptop tab: stop playing (the browser would also slow our timers).
  listen(document, 'visibilitychange', () => {
    if (document.hidden && inst.armed) disarmNow('The laptop page was hidden, so control was disarmed. Arm again to continue.');
  });

  // ───────────────────────────── control loop (50 Hz) ─────────────────────────────
  let lastCtl = performance.now();
  let lastPush = 0;
  let wasAllowed = false;
  let lastSentExpr = -1;
  const ctlTimer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.2, (now - lastCtl) / 1000);
    lastCtl = now;
    const out = inst.tick(now, dt);
    if (synth.running) {
      if (!out.allowed.ok) {
        if (wasAllowed) synth.silence();
        lastSentExpr = 0;
      } else {
        if (inst.mode === 'flow') {
          synth.setPitch(out.f0, inst.pitchMode);
          synth.setHarmonicCount(out.count);
          if (Math.abs(out.expr - lastSentExpr) > 0.002) {
            synth.setExpression(out.expr, 0.03);
            lastSentExpr = out.expr;
          }
        }
      }
    }
    wasAllowed = out.allowed.ok;
    if (now - lastPush > 200) {
      lastPush = now;
      pushState();
    }
  }, 20);

  /** Status for the phone screen. */
  function pushState() {
    if (inst.source !== 'phone' || st.conn !== 'connected') return;
    const msg = {
      type: 'state', armed: inst.armed, audio: synth.state === 'starting' ? 'starting' : synth.state,
      calib: inst.calib.state, calibText: inst.calib.text, mode: inst.mode,
      reason: inst.armed ? '' : inst.disarmReason, tiltRel: inst.tiltRel === null ? null : Math.round(inst.tiltRel * 10) / 10,
      intensity: Math.round(inst.intensity * 100) / 100, hits: inst.hits, sound: inst.soundAllowed(performance.now()).ok,
    };
    host.send(msg);
  }

  // ───────────────────────────── drawing loop ─────────────────────────────
  let raf = 0;
  let lastUi = 0;
  let lastPlot = 0;
  let fBuf = null;
  let silentBuf = null;
  function frame(nowMs) {
    raf = requestAnimationFrame(frame);
    const now = nowMs / 1000;
    const allowed = inst.soundAllowed(performance.now()).ok;
    const exprShown = inst.mode === 'flow' ? inst.expr : synth.exprGain;
    if (!st.frozen) {
      const has = inst.input && inst.cal.done;
      score.push(now, {
        f0: has ? inst.f0 : null,
        inten: inst.input ? inst.intensity : null,
        count: has ? inst.count : null,
        expr: allowed ? exprShown : 0,
        sound: allowed && synth.running && exprShown > 0.01,
      });
      const live = synth.running && synth.ctx.state === 'running';
      let data;
      let binHz;
      if (live) {
        const a = synth.analyser;
        if (!fBuf || fBuf.length !== a.frequencyBinCount) fBuf = new Float32Array(a.frequencyBinCount);
        a.getFloatFrequencyData(fBuf);
        data = fBuf;
        binHz = synth.sampleRate / a.fftSize;
      } else {
        if (!silentBuf) silentBuf = new Float32Array(4096).fill(-Infinity);
        data = silentBuf;
        binHz = synth.sampleRate / 8192;
      }
      spectrogram.advance(data, binHz, now);
    }
    score.render(now, { frozen: st.frozen, mode: inst.mode });
    if (spectrogram.dirty) spectrogram.render(SG_RANGE);
    if (el.graphs.open && nowMs - lastPlot > 60 && (!st.frozen || !st.plottedFrozen)) {
      lastPlot = nowMs;
      st.plottedFrozen = st.frozen;
      const live = synth.running && synth.ctx.state === 'running';
      scope.render(live ? synth.analyser : null, synth.sampleRate, st.frozen);
      let d = null;
      if (live) {
        d = new Float32Array(synth.analyser.frequencyBinCount);
        synth.analyser.getFloatFrequencyData(d);
      }
      const binHz = synth.sampleRate / 8192;
      const max = Math.min(12000, Math.max(1000, Math.ceil((inst.count * inst.f0 * 1.25) / 500) * 500));
      spectrum.render({
        data: d, binHz, mode: d ? (st.frozen ? 'frozen' : 'live') : 'idle', min: 0, max, log: false,
        expected: Array.from({ length: inst.count }, (_, i) => ({ freq: (i + 1) * inst.f0, color: '#ffb74d', label: i < 5 ? `${i + 1}f` : '' })),
        peaks: d ? findPeaks(d, binHz, { maxHz: max, maxPeaks: 12 }) : [],
        silent: d ? isSilent(d) : false,
        messages: {
          idle: ['Start Audio to measure', 'This plot shows real FFT measurements of the output sound.'],
          silent: ['Silence', 'Expression is 0, or control is disarmed.'],
        },
      });
    }
    if (!st.frozen) st.plottedFrozen = false;
    if (nowMs - lastUi > 100) {
      lastUi = nowMs;
      render();
    }
  }

  // ───────────────────────────── rendering ─────────────────────────────
  function setPill(node, text, kind) {
    node.textContent = text;
    node.className = `ms-pill ${kind}`;
  }

  function nextStep() {
    if (inst.source === 'none') return 1;
    if (inst.source === 'phone') {
      if (st.conn !== 'connected') return 1;
      if (inst.phoneSensors !== 'active') return 2;
      if (inst.calib.state !== 'done') return 3;
    }
    if (!synth.running || !inst.armed) return 4;
    return 5;
  }

  function render() {
    const now = performance.now();
    const src = inst.source;
    const phone = src === 'phone';
    setPill(el.sInput, src === 'phone' ? 'Phone' : src === 'demo' ? 'Laptop Demo (simulated)' : 'None', src === 'none' ? 'off' : src === 'demo' ? 'demo' : 'ok');
    const connText = {
      idle: ['Not connected', 'off'],
      creating: ['Creating session…', 'busy'],
      waiting: ['Waiting for phone', 'busy'],
      connected: ['Phone connected', 'ok'],
      failed: ['Connection failed', 'bad'],
      lost: ['Connection lost', 'bad'],
    }[st.conn];
    setPill(el.sPhone, phone ? connText[0] : '—', phone ? connText[1] : 'off');
    const age = now - inst.lastReceipt;
    let sens;
    if (src === 'demo') sens = ['Simulated', 'demo'];
    else if (!phone || st.conn !== 'connected') sens = ['—', 'off'];
    else if (inst.phoneSensors === 'denied') sens = ['Permission denied', 'bad'];
    else if (inst.phoneSensors === 'unavailable' || inst.phoneSensors === 'insecure') sens = ['Sensor unavailable', 'bad'];
    else if (inst.phoneSensors !== 'active') sens = ['Waiting for sensor permission', 'busy'];
    else if (age > M.STALE_MS) sens = [`No data for ${(age / 1000).toFixed(1)} s`, 'bad'];
    else sens = [`Active · ${st.rx.times.length}/s`, 'ok'];
    setPill(el.sSensors, sens[0], sens[1]);
    setPill(el.sArmed, inst.armed ? 'Armed' : 'Disarmed', inst.armed ? 'ok' : 'off');
    const aText = { off: ['Off', 'off'], starting: ['Starting…', 'busy'], on: ['On', 'ok'], panic: ['Muted by Panic', 'bad'] }[synth.state];
    setPill(el.sAudio, aText[0], aText[1]);
    const allowed = inst.soundAllowed(now);
    el.sSound.textContent = allowed.ok ? (inst.mode === 'flow' ? (inst.expr > 0.01 ? '♪ Playing' : 'Ready: move to play') : 'Ready: make a sharp movement') : `Silent: ${allowed.reason}`;
    el.sSound.className = `ms-sound ${allowed.ok ? 'ok' : ''}`;

    // Setup checklist.
    const next = nextStep();
    const demo = src === 'demo';
    const stepState = [
      phone && st.conn === 'connected' || demo,
      phone && inst.phoneSensors === 'active' || demo,
      phone && inst.calib.state === 'done' || demo,
      synth.running && inst.armed,
    ];
    [el.step1, el.step2, el.step3, el.step4].forEach((s, i) => {
      const done = stepState[i];
      s.root.classList.toggle('done', done);
      s.root.classList.toggle('next', next === i + 1);
      s.root.classList.toggle('skipped', demo && i > 0 && i < 3);
      s.mark.textContent = done ? '✓' : String(i + 1);
      s.tag.textContent = demo && i > 0 && i < 3 ? 'not needed in Laptop Demo' : next === i + 1 ? 'Next' : '';
    });
    el.setupSummary.textContent = next === 5 ? '✓ Ready to play' : `Next: step ${next}`;
    el.setup.classList.toggle('complete', next === 5);
    el.connectBtn.textContent = phone ? '📱 Connect Phone (new session)' : '📱 Connect Phone';
    el.demoBtn.disabled = demo;
    el.pairing.hidden = !phone || !st.showPairing || st.conn === 'idle';
    el.pairState.textContent = {
      creating: 'Creating session… (contacting the pairing server)',
      waiting: isLocalOnly(window.location.hostname) ? 'Session created, but a phone cannot reach it from localhost (see above).' : 'Waiting for phone. Scan the QR code or open the link on your phone. Keep this page open.',
      connected: 'Phone connected.',
      failed: `Connection failed. ${st.connDetail} Try creating a new session.`,
      lost: `Connection lost. ${st.connDetail}`,
      idle: '',
    }[st.conn];
    el.pairState.className = `ms-pair-state ${st.conn}`;
    el.calBtn.disabled = !(phone && st.conn === 'connected' && inst.phoneSensors === 'active') || inst.calib.state === 'running';
    el.calBtn.textContent = inst.calib.state === 'done' && phone ? 'Recalibrate' : 'Calibrate';
    el.recal.disabled = el.calBtn.disabled;
    el.calText.textContent = phone ? inst.calib.text : '';
    el.calText.className = `ms-cal-text ${inst.calib.state}`;
    const armLabel = inst.armed ? 'Disarm' : 'Arm';
    for (const b of [el.armBtn, el.armBtn2]) {
      b.textContent = armLabel;
      b.classList.toggle('armed', inst.armed);
      b.disabled = src === 'none';
    }
    for (const b of [el.startBtn, el.startBtn2]) {
      b.disabled = synth.state === 'on' || synth.state === 'starting';
      b.textContent = synth.state === 'panic' ? '▶ Start Audio (restart)' : '▶ Start Audio';
    }
    el.stopBtn.disabled = synth.state !== 'on';
    el.setupMsg.textContent = st.message;

    // Live values.
    const has = inst.input && inst.cal.done;
    const n = M.noteName(inst.f0);
    el.vF.v.textContent = has ? fmtHz(Math.round(inst.f0 * 10) / 10) : '—';
    el.vF.s.textContent = has ? `≈ ${n.name}${inst.pitchMode === 'continuous' ? ` ${n.cents >= 0 ? '+' : '−'}${Math.abs(n.cents)} cents` : ' (pentatonic)'} · ← tilt ${inst.tiltRel === null ? '' : `${inst.tiltRel > 0 ? '+' : ''}${inst.tiltRel.toFixed(0)}°`}` : '← tilt';
    el.vH.v.textContent = has ? String(inst.count) : '—';
    el.vH.s.textContent = has ? `including the fundamental · ← movement ${Math.round(inst.intensity * 100)}%` : '← movement intensity';
    const exprShown = inst.mode === 'flow' ? inst.expr : synth.exprGain;
    el.vE.v.textContent = `${Math.round(exprShown * 100)}%`;
    el.vE.s.textContent = inst.mode === 'flow' ? 'from movement (separate from Master Volume)' : 'short note envelope';
    el.vMode.v.textContent = inst.mode === 'flow' ? 'Flow' : 'Accents';
    el.vMode.s.textContent = inst.pitchMode === 'continuous' ? 'Continuous pitch' : 'Pentatonic pitch';
    el.modeFlow.setAttribute('aria-pressed', String(inst.mode === 'flow'));
    el.modeAcc.setAttribute('aria-pressed', String(inst.mode === 'accents'));
    el.modeText.textContent = MODE_TEXT[inst.mode];
    el.pCont.setAttribute('aria-pressed', String(inst.pitchMode === 'continuous'));
    el.pPent.setAttribute('aria-pressed', String(inst.pitchMode === 'pentatonic'));
    el.freezeBtn.textContent = st.frozen ? '▶ Unfreeze Visual History' : '❄ Freeze Visual History';
    el.freezeBtn.setAttribute('aria-pressed', String(st.frozen));
    el.frozenBadge.hidden = !st.frozen;
    page.classList.toggle('frozen', st.frozen);
    el.presentBtn.textContent = st.presentation ? '✕ Exit Presentation' : '🖥 Presentation Mode';
    el.presentBtn.setAttribute('aria-pressed', String(st.presentation));

    // Laptop Demo panel.
    el.demoPanel.hidden = !demo;
    el.dTiltOut.textContent = `${st.demo.tilt > 0 ? '+' : ''}${st.demo.tilt}°`;
    el.dIntOut.textContent = `${Math.round(st.demo.intensity * 100)}%`;
    el.dAccent.disabled = inst.mode !== 'accents';
    el.dAccent.title = inst.mode !== 'accents' ? 'Switch to Accents mode to use this.' : '';

    // Settings and diagnostics.
    el.sensOut.textContent = `${inst.settings.sensitivity.toFixed(2)}×`;
    const c = inst.cal;
    el.calValues.textContent = c.done
      ? `Neutral tilt ${c.neutral.toFixed(1)}° · stillness noise ${c.noise.toFixed(3)} m/s² · jerk noise ${c.jerkNoise.toFixed(1)} m/s³${c.demo ? ' (Laptop Demo preset)' : ''}`
      : 'Not calibrated yet.';
    const s = st.rx.lastSample;
    const thr = inst.detector.threshold(inst.cal, inst.settings);
    el.diag.textContent = [
      `Input source: ${src}${demo ? ' (SIMULATED, not real motion data)' : ''}`,
      `Connection: ${st.conn}${st.connDetail ? ` (${st.connDetail})` : ''}`,
      `Session: ${host.session ? host.session.sessionId : '—'} · messages received ${host.stats.received} · rejected messages ${host.stats.rejectedMessages} · rejected phones ${host.stats.rejectedPhones}${host.stats.lastError ? ` · last error ${host.stats.lastError}` : ''}`,
      `Relay: PeerJS library defaults (Google STUN + PeerJS public TURN); no app-specific TURN server is configured.`,
      `Samples: ${st.rx.times.length}/s received by laptop · phone motion events ${st.rx.phoneRate}/s · last sample age ${Number.isFinite(age) ? Math.round(age) + ' ms' : '—'} · missing samples ${st.rx.seqGaps}`,
      s ? `Raw tilt (beta): ${s.tilt === null ? 'null' : s.tilt.toFixed(1) + '°'} [${s.tiltSrc || '—'}] · screen angle ${s.screen}°` : 'Raw tilt: —',
      s ? `Linear acceleration (smoothed): ${s.lin === null ? 'null' : s.lin.toFixed(3) + ' m/s²'} [${s.linSrc === 'estimated' ? 'gravity estimated: approximate' : s.linSrc || '—'}] · jerk peak ${s.jerk === null ? 'null' : s.jerk.toFixed(0) + ' m/s³'}` : 'Linear acceleration: —',
      `Relative tilt: ${inst.tiltRel === null ? '—' : inst.tiltRel.toFixed(1) + '°'} → pitch ${inst.f0.toFixed(1)} Hz · intensity ${Math.round(inst.intensity * 100)}% → ${inst.count} components · accent threshold ${thr.toFixed(0)} m/s³ · accents ${inst.hits}`,
      `Calibration: ${inst.calib.state}${c.done ? `, neutral ${c.neutral.toFixed(1)}°, noise ${c.noise.toFixed(3)} m/s²` : ''}`,
      `Audio: ${synth.state}${synth.ctx ? ` · context ${synth.ctx.state} · ${synth.sampleRate} Hz sample rate · Nyquist ${synth.sampleRate / 2} Hz` : ''} · expression gain ${synth.exprGain.toFixed(3)} · sound allowed: ${allowed.ok ? 'yes' : 'no (' + allowed.reason + ')'}`,
    ].join('\n');
  }

  render();
  raf = requestAnimationFrame(frame);
  // On a page a phone can reach (hosted https or the Wi-Fi test server), show
  // the QR code straight away. Pairing never starts sound.
  if (!isLocalOnly(window.location.hostname)) connectPhone();

  // Read-only hook for automated checks (scripts/verify-motion.mjs).
  window.__motionScore = {
    snapshot: () => ({
      source: inst.source, conn: st.conn, sensors: inst.phoneSensors, armed: inst.armed, audio: synth.state,
      panic: inst.panic, calib: inst.calib.state, calibText: inst.calib.text, mode: inst.mode, pitchMode: inst.pitchMode,
      f0: inst.f0, count: inst.count, expr: inst.expr, exprGain: synth.exprGain, tiltRel: inst.tiltRel, intensity: inst.intensity,
      hits: inst.hits, accentsPlayed: synth.accentsPlayed, allowed: inst.soundAllowed(performance.now()),
      disarmReason: inst.disarmReason, phoneUrl: st.phoneUrl, session: host.session ? { ...host.session } : null,
      stats: { ...host.stats }, rx: { count: st.rx.count, seqGaps: st.rx.seqGaps }, frozen: st.frozen,
      qrHidden: el.qr.hidden, scorePoints: score.points.length, sgCols: spectrogram.cols.length, message: st.message,
      ctxState: synth.ctx ? synth.ctx.state : null, muteGain: synth.mute ? synth.mute.gain.value : null,
    }),
    measuredPeaks: () => {
      if (!synth.running) return [];
      const a = synth.analyser;
      const buf = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(buf);
      return findPeaks(buf, synth.sampleRate / a.fftSize, { maxHz: 12000, maxPeaks: 12 }).map((p) => ({ f: +p.freq.toFixed(1), db: +p.db.toFixed(1) }));
    },
    resources: () => ({ ctx: synth.ctx, peer: host.peer }),
    demo: (v) => Object.assign(st.demo, v),
  };

  return {
    unmount() {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(ctlTimer);
      stopDemo();
      for (const d of disposers) d();
      host.close();
      synth.close();
      score.dispose();
      spectrogram.dispose();
      spectrum.dispose();
      scope.dispose();
      document.body.classList.remove('presentation');
      delete window.__motionScore;
    },
  };
}

function pct(v) {
  return `${Math.round(v * 100)}%`;
}

/** Small diagram: holding the phone upright, tilting the top toward/away. */
function tiltDiagram() {
  const wrap = document.createElement('div');
  wrap.className = 'ms-tilt-diagram';
  wrap.innerHTML = `
  <svg viewBox="0 0 240 130" width="240" height="130" role="img" aria-label="Side view of the phone held upright: tilting the top toward you raises the pitch, tilting it away lowers it.">
    <text x="120" y="13" text-anchor="middle" fill="#9aa7b6" font-size="11">side view (you are on the left)</text>
    <circle cx="12" cy="88" r="9" fill="none" stroke="#9aa7b6" stroke-width="2"/>
    <rect x="114" y="44" width="12" height="56" rx="3" fill="none" stroke="#58d1ff" stroke-dasharray="3 3" transform="rotate(-28 120 100)"/>
    <rect x="114" y="44" width="12" height="56" rx="3" fill="none" stroke="#58d1ff" stroke-dasharray="3 3" transform="rotate(28 120 100)"/>
    <rect x="114" y="44" width="12" height="56" rx="3" fill="#58d1ff"/>
    <text x="66" y="44" text-anchor="middle" fill="#f0f6fc" font-size="13" font-weight="700">↑ higher</text>
    <text x="66" y="60" text-anchor="middle" fill="#9aa7b6" font-size="10">top toward you</text>
    <text x="184" y="44" text-anchor="middle" fill="#f0f6fc" font-size="13" font-weight="700">↓ lower</text>
    <text x="184" y="60" text-anchor="middle" fill="#9aa7b6" font-size="10">top away</text>
    <text x="120" y="122" text-anchor="middle" fill="#9aa7b6" font-size="10">±35° around your calibrated neutral</text>
  </svg>`;
  return wrap;
}

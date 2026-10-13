// Phone Controller page (#/controller?session=XXXX-XXXX&code=XXXXXX).
// Reads the phone's motion sensors and sends compact samples to the laptop.
// It never makes sound itself; the laptop's Performance page does.

import { h } from '../../lib/dom.js';
import { SessionClient } from './connection.js';
import { MotionFeatures, RateMeter } from './sensors.js';
import { normalizeSessionId, normalizeToken, SAMPLE_RATE_HZ } from './protocol.js';

const NO_EVENTS_MS = 2500; // no sensor values this long after enabling → unavailable

export function mount(root, params) {
  const disposers = [];
  const listen = (target, ev, fn, opts) => {
    target.addEventListener(ev, fn, opts);
    disposers.push(() => target.removeEventListener(ev, fn, opts));
  };
  let alive = true;

  const st = {
    sessionId: normalizeSessionId(params.get('session')),
    code: normalizeToken(params.get('code')),
    conn: 'idle',
    connDetail: '',
    sensors: 'off', // off | waiting | active | denied | unavailable | insecure
    sensorDetail: '',
    laptop: null, // last state message from the laptop
    lastHits: 0,
    seq: 0,
    wakeLock: null,
    wakeLockNote: '',
  };
  const features = new MotionFeatures();
  const motionRate = new RateMeter();
  const orientRate = new RateMeter();
  let valuesSeen = 0; // motion events that carried real numbers

  // ───────────── layout ─────────────
  const el = {};
  el.conn = h('div', { class: 'pc-status-value' });
  el.sensors = h('div', { class: 'pc-status-value' });
  el.armed = h('div', { class: 'pc-status-value' });
  el.audio = h('div', { class: 'pc-status-value' });
  el.next = h('div', { class: 'pc-next', role: 'status', 'aria-live': 'polite' });
  // One big button that always does the next step; its label changes.
  el.primary = h('button', { class: 'pc-btn primary', onclick: () => primaryAction && primaryAction() }, 'Enable Sensors');
  el.step = h('div', { class: 'pc-step' });
  el.calibrate = h('button', { class: 'pc-btn', onclick: () => command('calibrate'), hidden: true }, 'Recalibrate');
  el.mute = h('button', { class: 'pc-btn danger', onclick: () => command('panic') }, 'Emergency Mute');
  let primaryAction = null;
  el.tiltBar = h('div', { class: 'pc-bar-fill' });
  el.tiltText = h('span', { class: 'mono' }, '—');
  el.intBar = h('div', { class: 'pc-bar-fill' });
  el.intText = h('span', { class: 'mono' }, '—');
  el.hit = h('div', { class: 'pc-hit' }, 'Accent!');
  el.diag = h('div', { class: 'mono pc-diag' });

  el.form = h('form', { class: 'pc-form', onsubmit: (e) => { e.preventDefault(); manualConnect(); } },
    h('p', {}, 'Type the Session ID and Code shown on the laptop.'),
    h('label', {}, 'Session ID', h('input', { name: 'session', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'ABCD-EFGH' })),
    h('label', {}, 'Code', h('input', { name: 'code', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'XXXXXX' })),
    h('button', { class: 'pc-btn primary', type: 'submit' }, 'Connect'),
    h('p', { class: 'pc-small' }, 'Or scan the QR code on the laptop with your phone camera.'));

  const statusRow = (label, value) => h('div', { class: 'pc-status-row' }, h('div', { class: 'pc-status-label' }, label), value);
  const page = h('div', { class: 'pc' },
    h('h1', {}, 'Motion Score · Phone Controller'),
    h('p', { class: 'pc-small' }, 'This phone is the controller. The sound plays on the laptop.'),
    el.form,
    h('section', { class: 'pc-action' }, el.step, el.next, el.primary),
    h('div', { class: 'pc-buttons' }, el.calibrate, el.mute),
    h('section', { class: 'pc-status' },
      statusRow('Connection', el.conn),
      statusRow('Sensors', el.sensors),
      statusRow('Movement control', el.armed),
      statusRow('Laptop audio', el.audio)),
    h('section', { class: 'pc-live' },
      h('div', { class: 'pc-live-row' }, h('span', {}, 'Tilt → pitch'), el.tiltText),
      h('div', { class: 'pc-bar tilt' }, h('div', { class: 'pc-bar-mid' }), el.tiltBar),
      h('div', { class: 'pc-live-row' }, h('span', {}, 'Movement → richness'), el.intText),
      h('div', { class: 'pc-bar' }, el.intBar),
      el.hit),
    h('p', { class: 'pc-keep' }, 'Keep this page open and your phone unlocked.'),
    h('p', { class: 'pc-small' }, 'Hold the phone upright in one hand, screen facing you. Tilt the top toward you for higher pitch, away from you for lower pitch.'),
    h('details', { class: 'pc-help' },
      h('summary', {}, 'Troubleshooting'),
      h('ul', {},
        h('li', {}, 'Sensors only work on a secure (https://) page opened directly in the browser, not inside another app.'),
        h('li', {}, 'iPhone / iPad (Safari): tap Enable Sensors and choose Allow. If you chose Don\'t Allow, close this tab completely and open the link again (or clear this site\'s data in Settings → Safari → Advanced → Website Data).'),
        h('li', {}, 'Android (Chrome): tap the icon left of the address → Permissions or Site settings → allow Motion sensors, then reload.'),
        h('li', {}, '"Connected" but no sound: the laptop must also press Start Audio, and this phone must be Armed and calibrated.'),
        h('li', {}, 'If the connection keeps failing, the network may block direct device connections. Try another Wi-Fi or mobile data, or use Laptop Demo on the laptop.')),
      el.diag));
  root.append(page);

  // ───────────── connection ─────────────
  const client = new SessionClient({
    onState: (state, detail) => {
      st.conn = state;
      st.connDetail = detail;
      if (state !== 'connected') st.laptop = null;
      else sendStatus();
      render();
    },
    onMessage: (msg) => {
      if (msg.type === 'state') {
        if (st.laptop && msg.hits > st.lastHits) flashHit();
        st.lastHits = msg.hits;
        st.laptop = msg;
        render();
      }
    },
  });

  function connect() {
    if (!st.sessionId || !st.code) return render();
    client.connect(st.sessionId, st.code);
  }

  function manualConnect() {
    const f = new FormData(el.form);
    const id = normalizeSessionId(f.get('session'));
    const code = normalizeToken(f.get('code'));
    if (!id || !code) {
      st.connDetail = 'The Session ID has 8 letters/numbers and the Code has 6. Check them on the laptop.';
      st.conn = 'failed';
      render();
      return;
    }
    st.sessionId = id;
    st.code = code;
    connect();
  }

  function command(cmd) {
    if (!client.send({ type: 'command', cmd })) {
      st.connDetail = 'Not connected to the laptop, so the command was not sent.';
      render();
    }
  }

  function sendStatus() {
    client.send({ type: 'status', sensors: st.sensors, hidden: document.visibilityState === 'hidden' });
  }

  // ───────────── sensors ─────────────
  function onMotion(e) {
    const acc = e.acceleration;
    const accG = e.accelerationIncludingGravity;
    const has = (v) => v && [v.x, v.y, v.z].some((n) => typeof n === 'number' && Number.isFinite(n));
    if (has(acc) || has(accG)) valuesSeen++;
    motionRate.tick(performance.now());
    features.onMotion(e.timeStamp || performance.now(), acc, accG);
  }

  function onOrientation(e) {
    orientRate.tick(performance.now());
    features.onOrientation(e.timeStamp || performance.now(), e.beta);
  }

  async function enableSensors() {
    if (!window.isSecureContext) {
      setSensors('insecure', 'Motion sensors need a secure page. Open the https:// link from the laptop\'s QR code.');
      return;
    }
    const DM = window.DeviceMotionEvent;
    const DO = window.DeviceOrientationEvent;
    if (!DM && !DO) {
      setSensors('unavailable', 'This browser does not provide motion sensors. Try Safari on iPhone or Chrome on Android.');
      return;
    }
    // Ask for both permissions in the same tap, before any await, so both
    // requests still count as a direct user action (needed on iOS).
    const askMotion = DM && typeof DM.requestPermission === 'function' ? DM.requestPermission() : Promise.resolve('granted');
    const askOrient = DO && typeof DO.requestPermission === 'function' ? DO.requestPermission() : Promise.resolve('granted');
    requestWakeLock();
    setSensors('waiting', 'Waiting for sensor permission…');
    const [m, o] = await Promise.allSettled([askMotion, askOrient]);
    if (!alive) return;
    const motionOk = m.status === 'fulfilled' && m.value === 'granted';
    const orientOk = o.status === 'fulfilled' && o.value === 'granted';
    if (!motionOk) {
      setSensors('denied', 'Motion permission was not given. See Troubleshooting below to allow it, then tap Enable Sensors again.');
      return;
    }
    features.reset();
    valuesSeen = 0;
    listen(window, 'devicemotion', onMotion);
    if (orientOk) listen(window, 'deviceorientation', onOrientation);
    setSensors('waiting', orientOk ? 'Waiting for the first sensor readings…' : 'Orientation permission was not given; tilt will be estimated from gravity.');
    setTimeout(() => {
      if (!alive || st.sensors !== 'waiting') return;
      if (valuesSeen === 0) setSensors('unavailable', 'No motion readings arrived. This device may not have motion sensors, or the browser is blocking them. See Troubleshooting.');
    }, NO_EVENTS_MS);
  }

  function setSensors(state, detail = '') {
    st.sensors = state;
    st.sensorDetail = detail;
    sendStatus();
    render();
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      st.wakeLockNote = 'Screen wake lock not supported: keep tapping the screen now and then, or turn off auto-lock.';
      return;
    }
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!alive) {
        lock.release().catch(() => {});
        return;
      }
      st.wakeLock = lock;
      st.wakeLockNote = 'Screen will stay awake while this page is open.';
      lock.addEventListener('release', () => { if (st.wakeLock === lock) st.wakeLock = null; });
    } catch {
      st.wakeLockNote = 'Could not keep the screen awake; turn off auto-lock if the phone sleeps.';
    }
  }

  listen(document, 'visibilitychange', () => {
    sendStatus(); // tells the laptop to stop the sound when this page is hidden
    if (document.visibilityState === 'visible' && st.sensors !== 'off' && !st.wakeLock) requestWakeLock();
  });

  // ───────────── sample loop (~25 Hz) ─────────────
  let lastSentEvents = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    if (st.sensors === 'waiting' && valuesSeen > 0) setSensors('active');
    if (st.sensors !== 'active' || document.visibilityState === 'hidden') return;
    // Only send when new sensor readings arrived. If the sensors stop, the
    // laptop then notices missing data instead of receiving stale values.
    if (features.motionEvents === lastSentEvents) return;
    lastSentEvents = features.motionEvents;
    const f = features.take();
    client.send({
      type: 'sample', seq: st.seq++, t: now, ...f,
      screen: (screen.orientation && Number.isFinite(screen.orientation.angle)) ? screen.orientation.angle : (Number(window.orientation) || 0),
      rate: motionRate.rate(now),
    });
  }, 1000 / SAMPLE_RATE_HZ);
  const statusTimer = setInterval(() => { sendStatus(); renderLive(); }, 1000);

  // ───────────── rendering ─────────────
  let hitTimer = 0;
  function flashHit() {
    el.hit.classList.add('on');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => el.hit.classList.remove('on'), 250);
  }

  function setVal(node, text, kind) {
    node.textContent = text;
    node.className = `pc-status-value ${kind}`;
  }

  function render() {
    el.form.hidden = !!(st.sessionId && st.code) && st.conn !== 'failed' && st.conn !== 'rejected';
    const connText = {
      idle: ['Not connected', 'off'],
      connecting: ['Connecting…', 'busy'],
      connected: ['Connected to laptop', 'ok'],
      rejected: ['Connection refused', 'bad'],
      failed: ['Connection failed', 'bad'],
      lost: ['Connection lost', 'bad'],
    }[st.conn];
    setVal(el.conn, connText[0], connText[1]);
    const sensText = {
      off: ['Off: tap Enable Sensors', 'off'],
      waiting: ['Waiting for sensor permission…', 'busy'],
      active: [`Active (${motionRate.rate(performance.now())} readings/s)`, 'ok'],
      denied: ['Permission denied', 'bad'],
      unavailable: ['Sensor unavailable', 'bad'],
      insecure: ['Needs a secure (https) page', 'bad'],
    }[st.sensors];
    setVal(el.sensors, sensText[0], sensText[1]);
    const L = st.laptop;
    setVal(el.armed, L ? (L.armed ? 'Armed: movement controls sound' : 'Disarmed') : '—', L && L.armed ? 'ok' : 'off');
    setVal(el.audio, L ? { on: 'On', off: 'Off: press Start Audio on the laptop', starting: 'Starting…', panic: 'Muted by Panic' }[L.audio] : '—', L && L.audio === 'on' ? 'ok' : L && L.audio === 'panic' ? 'bad' : 'off');

    // One clear next action, with one big button for it.
    const connected = st.conn === 'connected';
    let step = '';
    let next;
    let label = null;
    let action = null;
    let armedStyle = false;
    if (st.conn === 'failed' || st.conn === 'rejected' || st.conn === 'lost') {
      next = st.connDetail;
      if (st.sessionId) { label = 'Try Again'; action = connect; }
    } else if (!st.sessionId || !st.code) next = 'Enter the Session ID and Code from the laptop.';
    else if (st.sensors !== 'active') {
      // Sensors can be enabled while the connection is still being set up.
      step = 'Step 1 of 3';
      if (st.sensors === 'off') next = 'Tap Enable Sensors and choose Allow.';
      else next = st.sensorDetail;
      if (!connected) next += ' (Connecting to the laptop…)';
      if (st.sensors !== 'waiting') { label = st.sensors === 'off' ? 'Enable Sensors' : 'Try Enable Sensors Again'; action = enableSensors; }
    } else if (!connected) next = 'Sensors on. Connecting to the laptop… Keep this page open.';
    else if (!L || L.calib === 'running' || L.calib === 'none') {
      step = 'Step 2 of 3';
      next = L && L.calib === 'running' ? L.calibText : 'Hold your phone comfortably and stay still: calibrating…';
    } else if (L.calib !== 'done') {
      step = 'Step 2 of 3';
      next = L.calibText || 'Calibration needed.';
      label = 'Calibrate Again';
      action = () => command('calibrate');
    } else if (L.audio === 'panic') {
      step = 'Muted';
      next = 'Muted by Panic. On the laptop, press Start Audio, then tap Arm.';
      label = 'Arm';
      action = () => command('arm');
    } else if (!L.armed) {
      step = 'Step 3 of 3';
      next = (L.reason && L.reason !== 'Calibrating.' ? `${L.reason} ` : '') + (L.audio === 'on' ? 'Tap Arm to play.' : 'Tap Arm, and press Start Audio on the laptop.');
      label = 'Arm';
      action = () => command('arm');
    } else {
      step = 'Playing';
      next = (L.audio === 'on' ? '' : 'Press Start Audio on the laptop to hear it. ') + (L.mode === 'accents' ? 'Accents: make a sharp movement to play a short note.' : 'Flow: keep moving to sustain sound. Hold still for silence.');
      label = 'Disarm';
      action = () => command('disarm');
      armedStyle = true;
    }
    el.step.textContent = step;
    el.next.textContent = next;
    primaryAction = action;
    el.primary.hidden = !label;
    if (label) el.primary.textContent = label;
    el.primary.classList.toggle('armed', armedStyle);
    el.calibrate.hidden = !(connected && st.sensors === 'active' && L && (L.calib === 'done' || L.calib === 'failed'));
    el.mute.disabled = !connected;
    renderLive();
  }

  function renderLive() {
    const L = st.laptop;
    if (L && L.tiltRel !== null) {
      const u = Math.max(-1, Math.min(1, L.tiltRel / 35));
      el.tiltBar.style.left = u < 0 ? `${50 + u * 50}%` : '50%';
      el.tiltBar.style.width = `${Math.abs(u) * 50}%`;
      el.tiltText.textContent = `${L.tiltRel > 0 ? '+' : ''}${L.tiltRel.toFixed(0)}° from neutral`;
    } else {
      el.tiltBar.style.width = '0';
      el.tiltText.textContent = st.sensors === 'active' ? 'calibrate first' : '—';
    }
    el.intBar.style.left = '0';
    el.intBar.style.width = `${Math.round((L ? L.intensity : 0) * 100)}%`;
    el.intText.textContent = L ? `${Math.round(L.intensity * 100)}%` : '—';
    el.diag.textContent = [
      `Session ${st.sessionId || '—'} · sent ${st.seq} samples · dropped ${client.dropped}`,
      `Motion events ${motionRate.rate(performance.now())}/s · orientation events ${orientRate.rate(performance.now())}/s`,
      `Tilt source: ${features.tiltSrc || '—'} · intensity source: ${features.linSrc === 'estimated' ? 'gravity estimated (approximate)' : features.linSrc || '—'}`,
      st.wakeLockNote,
    ].join('\n');
    if (st.sensors === 'active') setVal(el.sensors, `Active (${motionRate.rate(performance.now())} readings/s)`, 'ok');
  }

  render();
  connect();

  // Read-only state plus raw send, for the automated checks only.
  window.__controller = {
    snapshot: () => ({ conn: st.conn, connDetail: st.connDetail, sensors: st.sensors, sensorDetail: st.sensorDetail, laptop: st.laptop, seq: st.seq, next: el.next.textContent }),
    sendRaw: (m) => client.send(m),
  };

  return {
    unmount() {
      alive = false;
      clearInterval(timer);
      clearInterval(statusTimer);
      clearTimeout(hitTimer);
      for (const d of disposers) d();
      client.close();
      delete window.__controller;
      if (st.wakeLock) st.wakeLock.release().catch(() => {});
    },
  };
}

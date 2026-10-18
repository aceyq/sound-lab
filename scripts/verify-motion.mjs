// Automated browser checks for Motion Score (headless Chromium).
//
// Usage: start the app (npm run dev), then
//   node scripts/verify-motion.mjs [base-url]
// A second browser page plays the phone. Its "sensors" are SYNTHETIC
// DeviceMotion/DeviceOrientation events, so this proves the software path
// (pairing over the real PeerJS service, validation, mappings, audio, safety)
// but NOT that a particular phone's hardware or browser works.
// Needs internet (PeerJS signaling) and Playwright (npm i -D playwright).
// Set CHROME_PATH to use a specific Chromium binary.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}
const base = (process.argv[2] || 'http://localhost:5173/').replace(/#.*$/, '');
const shots = new URL('../verification/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
async function newPage(opts = {}, init) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true, ...opts });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  return page;
}
const phoneOpts = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const snap = (p) => p.evaluate(() => window.__motionScore.snapshot());
const phoneSnap = (p) => p.evaluate(() => window.__controller.snapshot());
const until = (p, fn, arg, timeout = 15000) => p.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const wait = (p, ms) => p.waitForTimeout(ms);

/** Synthetic sensors on the "phone" page: window.__sim = { beta, gamma, a, hit }. */
async function startSim(phone) {
  await phone.evaluate(() => {
    window.__sim = { beta: 60, gamma: 0, a: 0, hit: 0, on: true };
    let k = 0;
    window.__simTimer = setInterval(() => {
      if (!window.__sim.on) return;
      k++;
      const n = () => (Math.random() - 0.5) * 0.04;
      let ax = window.__sim.a * Math.sin(k / 6) + n();
      if (window.__sim.hit > 0) { ax += 18; window.__sim.hit--; }
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: ax, y: n(), z: n() }, accelerationIncludingGravity: { x: ax, y: 9.81, z: n() }, interval: 16 }));
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: window.__sim.beta + n() * 5, gamma: window.__sim.gamma + n() * 5 }));
    }, 16);
  });
}
const sim = (phone, v) => phone.evaluate((v) => Object.assign(window.__sim, v), v);

// ───────────── 1. Pairing, sensors, calibration, mappings ─────────────
const lap = await newPage();
await lap.goto(base + '#/motion-score');
await lap.waitForFunction(() => !!window.__motionScore);
let s = await snap(lap);
const local = /localhost|127\.0\.0\.1/.test(base);
if (local) {
  check('On localhost: no input yet, audio off, disarmed', s.source === 'none' && s.audio === 'off' && !s.armed);
  await lap.getByRole('button', { name: '📱 Connect Phone' }).click();
} else {
  check('Hosted page creates a session by itself, audio off, disarmed', s.source === 'phone' && s.audio === 'off' && !s.armed);
}
check('Session is created on the PeerJS server', await until(lap, () => window.__motionScore.snapshot().conn === 'waiting'));
s = await snap(lap);
const url = s.phoneUrl;
check('Phone URL keeps base path and hash route', url.startsWith(base) && /#\/controller\?session=[A-Z2-9]{4}-[A-Z2-9]{4}&code=[A-Z2-9]{6}$/.test(url), url);
check(local ? 'On localhost the QR code is withheld with an explanation' : 'QR code is shown', local ? s.qrHidden : !s.qrHidden);

const phone = await newPage(phoneOpts);
await phone.goto(url);
check('Phone connects with the pairing code', await until(lap, () => window.__motionScore.snapshot().conn === 'connected', null, 20000));
let p = await phoneSnap(phone);
check('Pairing alone does not start sound or arm', (await snap(lap)).audio === 'off' && !(await snap(lap)).armed);
await phone.screenshot({ path: shots + 'motion-phone-connected.png' });
await phone.getByRole('button', { name: 'Enable Sensors' }).click();
await startSim(phone);
check('Laptop shows Sensors active', await until(lap, () => window.__motionScore.snapshot().sensors === 'active'));
await wait(lap, 600);
s = await snap(lap);
check('Samples arrive at about 25 per second', s.rx.count > 10, `${s.rx.count} samples`);

check('Calibration starts by itself once sensors are on, and completes', await until(lap, () => window.__motionScore.snapshot().calib === 'done', null, 6000));
await phone.getByRole('button', { name: 'Recalibrate' }).click(); // also works from the phone
check('Recalibrate from the phone works', await until(lap, () => window.__motionScore.snapshot().calib === 'running', null, 3000) && await until(lap, () => window.__motionScore.snapshot().calib === 'done', null, 6000));
await lap.getByRole('button', { name: '▶ Start Audio' }).first().click();
await phone.getByRole('button', { name: 'Arm' }).click();
check('Arm from the phone works after Start Audio', await until(lap, () => window.__motionScore.snapshot().armed));

const measure = async (v, ms = 1500) => {
  await sim(phone, v);
  await wait(lap, ms);
  const x = await snap(lap);
  x.peaks = await lap.evaluate(() => window.__motionScore.measuredPeaks());
  return x;
};
// ── Tilt instrument (default): independent pitch and harmonic richness ──
s = await snap(lap);
check('Default mapping is Tilt instrument with Steady sustain', s.mapping === 'tilt' && s.exprSource === 'sustain' && s.sideAvailable, `${s.mapping}/${s.exprSource}`);
const sustain = await measure({ beta: 60, gamma: 0, a: 0 });
check('Steady sustain: a still phone keeps a steady tone', sustain.exprGain > 0.5 && sustain.allowed.ok, `gain ${sustain.exprGain.toFixed(2)}`);
await lap.locator('.ms-sub input[type="number"]').fill('200');
await lap.locator('.ms-sub input[type="checkbox"]').check();
// The lean that gives a given richness depends on beta: lean = asin(sin γ · cos β).
const pure = await measure({ beta: 50, gamma: -90, a: 0 }, 1800);
const pureOnly = pure.liveGains.slice(1).every((g) => g < 0.01) && pure.liveGains[0] > 0.9;
check('Lock 200 Hz + lean left: only the fundamental sounds', pure.f0 === 200 && pureOnly && pure.peaks.length >= 1 && Math.abs(pure.peaks[0].f - 200) < 3 && !pure.peaks.some((p) => p.f > 300 && p.db > pure.peaks[0].db - 40), `peaks ${pure.peaks.slice(0, 3).map((p) => p.f).join(', ')}`);
// Lean slowly right while sampling the oscillator gains: smooth fades, no jumps, 12 oscillators.
const gainTrace = [];
for (let g = -90; g <= 90; g += 6) {
  await sim(phone, { gamma: g });
  await wait(lap, 120);
  const x = await snap(lap);
  gainTrace.push(x);
}
await wait(lap, 1500);
const rich = await snap(lap);
rich.peaks = await lap.evaluate(() => window.__motionScore.measuredPeaks());
const maxStep = Math.max(...gainTrace.slice(1).map((x, i) => Math.max(...x.liveGains.map((g, k) => Math.abs(g - gainTrace[i].liveGains[k])))));
check('Leaning right fades harmonics in smoothly (no jumps)', maxStep < 0.25 && gainTrace.every((x) => x.liveOscillators === 12), `largest gain step between samples ${maxStep.toFixed(3)}, oscillators ${gainTrace.at(-1).liveOscillators}`);
check('Pitch stays locked at 200 Hz while richness changes', gainTrace.every((x) => x.f0 === 200) && rich.richness > 0.95, `richness ${rich.richness.toFixed(2)}`);
const ratios = rich.oscFreqs.map((f, i) => f / (i + 1));
check('Every oscillator runs at n × f0 (f0 = 200 Hz)', ratios.every((r) => Math.abs(r - ratios[0]) < 0.001) && Math.abs(ratios[0] - 200) < 0.1, ratios.slice(0, 4).map((r) => r.toFixed(3)).join(', '));
const measured = rich.peaks.map((p) => p.f);
check('Measured audio shows harmonics at 200, 400, 600, 800 Hz…', [200, 400, 600, 800, 1000].every((f) => measured.some((m) => Math.abs(m - f) < 6)), measured.slice(0, 6).join(', '));
check('Output is normalized: summed wave peaks at 1 or below', Math.abs(rich.mix.norm * rich.mix.peak - 1) < 1e-6);
await lap.screenshot({ path: shots + 'motion-harmonics.png', fullPage: false });
// Expression synced from the phone.
await phone.evaluate(() => window.__controller.sendRaw({ type: 'expr', value: 0.25 }));
await wait(lap, 2000); // the expression envelope glides (release ≈ 0.35 s)
s = await snap(lap);
check('Expression slider on the phone sets the laptop expression', Math.abs(s.exprLevel - 0.25) < 1e-6 && Math.abs(s.exprGain - 0.25) < 0.03, `level ${s.exprLevel}, gain ${s.exprGain.toFixed(3)}`);
await lap.locator('input[aria-label="Expression"]').evaluate((e) => { e.value = 70; e.dispatchEvent(new Event('input', { bubbles: true })); });
await wait(lap, 600);
p = await phoneSnap(phone);
check('Laptop Expression slider is reflected on the phone', p.laptop && Math.abs(p.laptop.exprLevel - 0.7) < 0.011, `${p.laptop && p.laptop.exprLevel}`);
// Unlock: tilt changes pitch, richness unchanged.
await lap.locator('.ms-sub input[type="checkbox"]').uncheck();
const unlockUp = await measure({ beta: 80, gamma: 15, a: 0 });
const unlockDown = await measure({ beta: 40, gamma: 15, a: 0 });
check('Unlocked: forward/back tilt moves the pitch, richness holds', unlockUp.f0 > 450 && unlockDown.f0 < 220 && Math.abs(unlockUp.richness - unlockDown.richness) < 0.25, `${unlockUp.f0.toFixed(0)} / ${unlockDown.f0.toFixed(0)} Hz, richness ${unlockUp.richness.toFixed(2)} / ${unlockDown.richness.toFixed(2)}`);
await sim(phone, { gamma: 0 });

// ── Legacy mapping: Movement intensity ──
await lap.getByRole('button', { name: 'Movement intensity', exact: true }).click();
s = await snap(lap);
check('Switching to Movement intensity uses movement expression', s.mapping === 'intensity' && s.exprSource === 'movement');
const still = await measure({ beta: 60, a: 0 });
check('Stillness is silent but still counts as live input', still.exprGain < 0.01 && still.allowed.ok, `gain ${still.exprGain.toFixed(3)}`);
const gentle = await measure({ beta: 60, a: 2 });
const strong = await measure({ beta: 60, a: 6 });
check('Stronger movement → more harmonics and expression (Flow)', strong.count > gentle.count && strong.expr > gentle.expr && gentle.expr > 0.1,
  `gentle ${gentle.count} comps / ${gentle.expr.toFixed(2)}, strong ${strong.count} comps / ${strong.expr.toFixed(2)}`);
const up = await measure({ beta: 80, a: 3 });
up.peaks = await lap.evaluate(() => window.__motionScore.measuredPeaks());
const down = await measure({ beta: 40, a: 3 });
check('Tilt toward you raises pitch, away lowers it', up.f0 > 450 && down.f0 < 220, `${up.f0.toFixed(0)} / ${down.f0.toFixed(0)} Hz`);
const pk = up.peaks;
check('Measured audio peaks at n × fundamental', pk.length >= 2 && Math.abs(pk[1].f / pk[0].f - 2) < 0.03 && Math.abs(pk[0].f - up.f0) / up.f0 < 0.03, pk.slice(0, 3).map((x) => x.f).join(', '));
await lap.screenshot({ path: shots + 'motion-laptop-playing.png' });

// Pentatonic.
await lap.getByRole('button', { name: 'Pentatonic', exact: true }).click();
const pent = await measure({ beta: 67, a: 3 }, 800);
const semis = 12 * Math.log2(pent.f0 / 110);
check('Pentatonic picks A C D E G', Math.abs(semis - Math.round(semis)) < 1e-6 && [0, 3, 5, 7, 10].includes(((Math.round(semis) % 12) + 12) % 12), `${pent.f0.toFixed(2)} Hz`);

// Accents.
await lap.getByRole('button', { name: 'Accents', exact: true }).click();
await sim(phone, { beta: 70, a: 0 });
await wait(lap, 800);
const before = (await snap(lap)).accentsPlayed;
await sim(phone, { hit: 2 });
await wait(lap, 700);
let acc = await snap(lap);
check('A sharp movement plays exactly one short note', acc.accentsPlayed === before + 1, `${acc.accentsPlayed - before} notes`);
check('The note decays to silence on its own', acc.exprGain < 0.02, `gain ${acc.exprGain.toFixed(3)}`);
for (let i = 0; i < 3; i++) { await sim(phone, { hit: 2 }); await wait(lap, 600); }
acc = await snap(lap);
check('Three spaced hits → three notes', acc.accentsPlayed === before + 4, `${acc.accentsPlayed - before}`);
p = await phoneSnap(phone);
check('Phone shows the hit count from the laptop', p.laptop && p.laptop.hits >= 4);
await lap.getByRole('button', { name: 'Flow', exact: true }).click();
await lap.getByRole('button', { name: 'Continuous', exact: true }).click();

// Malformed data and extra phones.
const rejectedBefore = (await snap(lap)).stats.rejectedMessages;
await phone.evaluate(() => {
  for (const m of [{ type: 'sample', seq: 1e12, t: 1, tilt: 1e9 }, { type: 'evil' }, { type: 'command', cmd: 'format' }, 'text']) window.__controller.sendRaw(m);
});
await wait(lap, 400);
s = await snap(lap);
check('Malformed messages are rejected and counted', s.stats.rejectedMessages >= rejectedBefore + 4 && Number.isFinite(s.f0) && s.f0 >= 110 && s.f0 <= 880, `${s.stats.rejectedMessages - rejectedBefore} rejected`);
const intruder = await newPage(phoneOpts);
await intruder.goto(url);
check('A second phone is refused', await until(intruder, () => window.__controller.snapshot().conn === 'rejected', null, 20000));
const wrong = await newPage(phoneOpts);
await wrong.goto(url.replace(/code=[A-Z2-9]+/, 'code=AAAAAA'));
check('A wrong pairing code is refused', await until(wrong, () => ['rejected', 'failed'].includes(window.__controller.snapshot().conn), null, 20000));
check('The real phone stays connected', (await snap(lap)).conn === 'connected');
await intruder.context().close();
await wrong.context().close();

// Panic latch.
await sim(phone, { beta: 60, a: 4 });
await wait(lap, 600);
await lap.getByRole('button', { name: '🔇 Mute / Panic' }).click();
await wait(lap, 200);
s = await snap(lap);
check('Panic silences and disarms immediately', s.audio === 'panic' && !s.armed && s.muteGain === 0);
await phone.getByRole('button', { name: 'Arm' }).click();
await wait(lap, 600);
s = await snap(lap);
check('Panic stays latched: Arm from the phone is refused', s.audio === 'panic' && !s.armed);
await lap.getByRole('button', { name: /Start Audio/ }).first().click();
await wait(lap, 300);
s = await snap(lap);
check('Start Audio clears Panic but does not re-arm', s.audio === 'on' && !s.armed);
await lap.getByRole('button', { name: 'Arm', exact: true }).first().click();

// Stale input: phone stops sending (e.g. frozen browser).
await sim(phone, { a: 4 });
await wait(lap, 800);
await sim(phone, { on: false });
await wait(lap, 700);
s = await snap(lap);
check('No sensor data for 0.5 s → silence', !s.allowed.ok && s.exprGain < 0.02, `${s.allowed.reason}, gain ${s.exprGain.toFixed(3)}`);
await wait(lap, 3000);
s = await snap(lap);
check('No sensor data for 3 s → disarmed', !s.armed, s.disarmReason);
await sim(phone, { on: true, a: 0 });
await wait(lap, 500);
await lap.getByRole('button', { name: 'Arm', exact: true }).first().click();
await wait(lap, 300);
check('Arming again works once data flows again', (await snap(lap)).armed, (await snap(lap)).message);

// Phone page hidden.
await phone.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
await wait(lap, 500);
s = await snap(lap);
check('Phone page hidden → disarmed with a reason', !s.armed && /hidden/.test(s.disarmReason), s.disarmReason);
await phone.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});

// Freeze and Presentation Mode.
await lap.getByRole('button', { name: '❄ Freeze Visual History' }).click();
const f0 = await snap(lap);
await wait(lap, 800);
const f1 = await snap(lap);
check('Freeze stops visual history only', f1.sgCols === f0.sgCols && f1.scorePoints === f0.scorePoints && f1.audio === 'on');
await lap.getByRole('button', { name: '▶ Unfreeze Visual History' }).click();
await lap.getByRole('button', { name: 'Arm', exact: true }).first().click();
await sim(phone, { a: 3 });
await lap.getByRole('button', { name: '🖥 Presentation Mode' }).click();
await wait(lap, 2500);
await lap.screenshot({ path: shots + 'motion-presentation.png' });
check('Presentation Mode keeps status and Panic visible', await lap.getByRole('button', { name: '🔇 Mute / Panic' }).isVisible() && !(await lap.locator('.ms-setup').isVisible()));
await lap.getByRole('button', { name: '✕ Exit Presentation' }).click();

// Disconnect.
await phone.context().close();
check('Closing the phone page → Connection lost', await until(lap, () => window.__motionScore.snapshot().conn === 'lost', null, 8000));
s = await snap(lap);
check('Disconnect silences and disarms', !s.armed && s.exprGain < 0.02, s.disarmReason);

// Navigation cleanup.
await lap.evaluate(() => { const r = window.__motionScore.resources(); window.__keep = r; });
await lap.getByRole('link', { name: '1. Frequency Playground' }).click();
await wait(lap, 500);
const rel = await lap.evaluate(() => ({ ctx: window.__keep.ctx && window.__keep.ctx.state, peer: window.__keep.peer ? window.__keep.peer.destroyed : true }));
check('Leaving Motion Score closes audio and the peer connection', rel.ctx === 'closed' && rel.peer, JSON.stringify(rel));
await lap.getByRole('button', { name: '▶ Play' }).click();
await wait(lap, 900);
const fp = await lap.evaluate(() => window.__frequencyPlayground.debug());
check('Frequency Playground still plays 220 Hz', fp.engine.playing && fp.measure.peaks.some((x) => Math.abs(x - 220) < 12), `peaks=${fp.measure.peaks}`);
await lap.context().close();

// ───────────── 2. Phone errors ─────────────
const denied = await newPage(phoneOpts, () => {
  window.DeviceMotionEvent.requestPermission = async () => 'denied';
  window.DeviceOrientationEvent.requestPermission = async () => 'denied';
});
await denied.goto(base + '#/controller?session=ABCD-EFGH&code=ABCDEF');
await denied.getByRole('button', { name: 'Enable Sensors' }).click();
await wait(denied, 400);
p = await phoneSnap(denied);
check('Phone: permission denied is explained', p.sensors === 'denied' && /Troubleshooting/.test(p.sensorDetail), p.sensorDetail);
check('Phone: unknown session → Connection failed with next step', await until(denied, () => window.__controller.snapshot().conn === 'failed', null, 20000) && /not found|Try Again|New Session/i.test((await phoneSnap(denied)).connDetail), (await phoneSnap(denied)).connDetail);
await denied.screenshot({ path: shots + 'motion-phone-error.png' });
await denied.context().close();
const none = await newPage(phoneOpts);
await none.goto(base + '#/controller?session=ABCD-EFGH&code=ABCDEF');
await none.getByRole('button', { name: 'Enable Sensors' }).click();
await wait(none, 3000);
p = await phoneSnap(none);
check('Phone: no sensor events → Sensor unavailable', p.sensors === 'unavailable', p.sensorDetail);
await none.context().close();
const manual = await newPage(phoneOpts);
await manual.goto(base + '#/controller');
check('Phone without a link shows Session ID / Code entry', await manual.locator('form.pc-form').isVisible());
await manual.context().close();

// ───────────── 3. Laptop Demo without any network ─────────────
const demo = await newPage();
await demo.goto(base + '#/motion-score');
await demo.waitForFunction(() => !!window.__motionScore);
await demo.context().route('**/*', (r) => (r.request().url().startsWith(new URL(base).origin) ? r.continue() : r.abort()));
await demo.getByRole('button', { name: '💻 Use Laptop Demo' }).click();
check('Laptop Demo badge is shown', await demo.getByText('Laptop Demo — phone sensors are not connected.').isVisible());
await demo.getByRole('button', { name: '▶ Start Audio' }).first().click();
await demo.getByRole('button', { name: 'Arm', exact: true }).first().click();
await demo.evaluate(() => window.__motionScore.demo({ tilt: 30, side: 30 }));
await wait(demo, 1200);
s = await snap(demo);
check('Laptop Demo (Tilt instrument): tilt + lean sliders drive pitch and richness', s.source === 'demo' && s.f0 > 700 && s.richness > 0.95 && s.exprGain > 0.4, `${s.f0.toFixed(0)} Hz, richness ${s.richness.toFixed(2)}, gain ${s.exprGain.toFixed(2)}`);
// Automatic demo (simulated input, real synthesis).
await demo.getByRole('button', { name: '▶ Auto demo (simulated)' }).click();
await wait(demo, 2500);
const a1 = await snap(demo);
check('Auto demo step 1: pure 200 Hz sine', a1.auto === 0 && a1.f0 === 200 && a1.liveGains.slice(1).every((g) => g < 0.01), `step ${a1.auto}, f0 ${a1.f0}`);
check('Auto demo is labeled as simulated', await demo.getByText(/AUTO DEMO · simulated input/).isVisible());
await wait(demo, 8500);
const a2 = await snap(demo);
check('Auto demo step 2: 200 Hz held while harmonics fade in', a2.auto === 1 && a2.f0 === 200 && a2.richness > 0.5, `step ${a2.auto}, richness ${a2.richness.toFixed(2)}`);
await wait(demo, 9000);
const a3 = await snap(demo);
await wait(demo, 2000);
const a3b = await snap(demo);
check('Auto demo step 3: pitch moves, harmonic balance steady', a3.auto === 2 && !a3.lock.on && Math.abs(a3.f0 - a3b.f0) > 20 && Math.abs(a3.richness - a3b.richness) < 0.03, `${a3.f0.toFixed(0)} → ${a3b.f0.toFixed(0)} Hz, richness ${a3.richness.toFixed(2)} / ${a3b.richness.toFixed(2)}`);
await demo.screenshot({ path: shots + 'motion-auto-demo.png' });
await demo.getByRole('button', { name: '■ Stop auto demo' }).click();
await demo.getByRole('button', { name: 'Movement intensity', exact: true }).click();
if (!(await snap(demo)).armed) await demo.getByRole('button', { name: 'Arm', exact: true }).first().click();
await demo.evaluate(() => window.__motionScore.demo({ tilt: 30, intensity: 0.8 }));
await wait(demo, 1200);
s = await snap(demo);
check('Laptop Demo (Movement intensity): movement drives harmonics and expression', s.f0 > 700 && s.count >= 8 && s.exprGain > 0.4, `${s.f0.toFixed(0)} Hz, ${s.count} comps, gain ${s.exprGain.toFixed(2)}`);
await demo.evaluate(() => window.__motionScore.demo({ intensity: 0 }));
await wait(demo, 1500);
check('Laptop Demo: intensity 0 → silence (movement expression)', (await snap(demo)).exprGain < 0.02);
await demo.getByRole('button', { name: 'Accents', exact: true }).click();
await wait(demo, 300);
await demo.keyboard.press('a');
await wait(demo, 300);
s = await snap(demo);
check('Laptop Demo: the A key triggers an accent', s.accentsPlayed === 1, `${s.accentsPlayed} notes, armed ${s.armed}, ${s.allowed.reason} ${s.message}`);
await demo.screenshot({ path: shots + 'motion-demo.png' });
await demo.getByRole('button', { name: '📱 Connect Phone' }).click();
await wait(demo, 300);
s = await snap(demo);
check('Switching input source silences and disarms', s.source === 'phone' && !s.armed);
await demo.getByRole('button', { name: '■ Stop Audio' }).click();
await wait(demo, 400);
s = await snap(demo);
check('Stop Audio releases all oscillators', s.liveOscillators === 0 && s.audio === 'off', `${s.liveOscillators} running`);
await demo.context().close();

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);

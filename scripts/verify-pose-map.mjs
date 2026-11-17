// Automated browser checks for the Pose Sound Map (capstone part 3).
// Usage: start the app (npm run dev -- --port 5191, or npx vite after
// `node scripts/copy-mediapipe.mjs`), then:
//   node scripts/verify-pose-map.mjs http://localhost:5191/
// Needs the `playwright` package.
//
// SIMULATED INPUT. No person stands in front of a camera here:
//   • Body landmarks are generated (a stick figure whose right elbow bend and
//     left arm lift are set by the script) and fed through the page's own
//     pose handler (window.__poseMap.feed), the same function the camera
//     tracker calls.
//   • The real MediaPipe model is also started on Chromium's fake camera
//     (a test pattern, no person), to check that the camera, WebAssembly
//     runtime and model load from this site and report "no person".
//   • The microphone is a synthetic harmonic tone.
// Sound is checked through the app's state (oscillator targets, gate level,
// clap counter), not by ear.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { playwright = require(p); break; } catch { /* try next */ }
}
if (!playwright) { console.error('Playwright not found.'); process.exit(2); }

const url = (process.argv[2] || 'http://localhost:5191/').replace(/#.*$/, '');
const shots = new URL('../verification/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await playwright.chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1300 }, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] });

// A vowel recorded in Vowel Morph, so "pick a vowel I already recorded" has something to offer.
const vmAmps = Array.from({ length: 48 }, (_, i) => (i < 8 ? [0.4, 1, 0.7, 0.3, 0.2, 0.1, 0.05, 0.02][i] : 0));
const vmProject = { format: 'vowel-morph.project', version: 1, takes: [], pair: { a: null, b: null }, slider: 0, pitchMode: 'blend', space: { power: 2, point: { x: 0.5, y: 0.5 } },
  vowels: [{ id: 'vm-mine', name: 'My Uu', recordingId: null, segment: null, pos: { x: 0.3, y: 0.3 }, analysis: { status: 'ok', f0: 260, f0Auto: 260, f0Source: 'automatic', amps: vmAmps, sampleRate: 48000, warnings: [], problems: [], facts: {} } }] };

await context.addInitScript((vm) => {
  if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vowelMorph.project.v1', JSON.stringify(vm)); sessionStorage.setItem('seeded', '1'); }
  // Synthetic microphone for audio requests; the camera stays Chromium's fake camera.
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.video) return real(c);
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 233;
    o.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(8), Float32Array.from([0, 1, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05])));
    const g = ctx.createGain(); g.gain.value = 0.25;
    const d = ctx.createMediaStreamDestination();
    o.connect(g).connect(d); o.start();
    return d.stream;
  };
  // Stick figure: right elbow bend and left arm lift in degrees; `hide` = landmark index to lose.
  window.__body = ({ bend = 0, lift = 15, hide = null } = {}) => {
    const D = Math.PI / 180;
    const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    const set = (i, x, y) => { lms[i] = { x, y, z: 0, visibility: 0.99 }; };
    set(12, 0.40, 0.35); set(11, 0.60, 0.35); set(24, 0.42, 0.70); set(23, 0.58, 0.70);
    set(14, 0.40, 0.50); set(16, 0.40 + 0.15 * Math.sin(bend * D), 0.50 + 0.15 * Math.cos(bend * D));
    const a = Math.atan2(0.35, -0.02) - lift * D;
    set(13, 0.60 + 0.15 * Math.cos(a), 0.35 + 0.15 * Math.sin(a)); set(15, 0.60 + 0.3 * Math.cos(a), 0.35 + 0.3 * Math.sin(a));
    set(0, 0.5, 0.2);
    if (hide != null) lms[hide].visibility = 0.05;
    return lms;
  };
  window.__pose = { bend: 15, lift: 15, hide: null };
  window.__feedOn = false;
  window.__feedTimer = setInterval(() => {
    if (!window.__feedOn || !window.__poseMap) return;
    window.__poseMap.feed({ landmarks: window.__body(window.__pose), world: null, width: 480, height: 480, t: performance.now() });
  }, 33);
}, vmProject);

const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
const dbg = () => page.evaluate(() => window.__poseMap.debug());
const wait = (ms) => page.waitForTimeout(ms);
const pose = (p) => page.evaluate((q) => { window.__pose = { bend: 15, lift: 15, hide: null, ...q }; }, p);

await page.goto(url + '#/pose-map');
await page.waitForFunction(() => window.__poseMap);
let d = await dbg();
check('Page opens with the starter set (ah, ee, oo, eh)', d.project.anchors.length === 4, d.project.anchors.map((a) => `${a.name} ${a.analysis.f0} Hz`).join(', '));
check('Navigation shows Pose Sound Map; the old Tilt link redirects to it', await page.locator('.app-nav a[data-route="/pose-map"]').count() === 1 && await page.locator('.app-nav a[data-route="/tilt-map"]').count() === 0);

// ── simulated body through the camera handler ──
await page.evaluate(() => { window.__feedOn = true; });
await pose({ bend: 15, lift: 15 });
await wait(500);
await page.getByRole('button', { name: /Start sound/ }).click();
await wait(400);
const base = await dbg();
check('Tracking both angles from simulated landmarks', base.tracking && Math.abs(base.angles.bend - 15) < 0.5 && Math.abs(base.angles.lift - 15) < 0.5, `bend ${base.angles.bend.toFixed(1)}°, lift ${base.angles.lift.toFixed(1)}°`);
await pose({ bend: 100, lift: 15 });
await wait(700);
const bendOnly = await dbg();
await pose({ bend: 15, lift: 100 });
await wait(700);
const liftOnly = await dbg();
await pose({ bend: 100, lift: 100 });
await wait(700);
const both = await dbg();
check('Right elbow bend alone moves the dot only left/right', Math.abs(bendOnly.dot.y - base.dot.y) < 0.01 && bendOnly.dot.x > base.dot.x + 0.5, `(${base.dot.x.toFixed(2)}, ${base.dot.y.toFixed(2)}) → (${bendOnly.dot.x.toFixed(2)}, ${bendOnly.dot.y.toFixed(2)})`);
check('Left arm lift alone moves the dot only up/down', Math.abs(liftOnly.dot.x - base.dot.x) < 0.01 && liftOnly.dot.y > base.dot.y + 0.5, `(${base.dot.x.toFixed(2)}, ${base.dot.y.toFixed(2)}) → (${liftOnly.dot.x.toFixed(2)}, ${liftOnly.dot.y.toFixed(2)})`);
const f = (x) => x.blend.params.f0;
check('The two angles together control the blend', Math.abs(both.dot.x - bendOnly.dot.x) < 0.01 && Math.abs(both.dot.y - liftOnly.dot.y) < 0.01 && new Set([f(base), f(bendOnly), f(liftOnly), f(both)].map((v) => v.toFixed(2))).size === 4,
  `f0: start ${f(base).toFixed(1)}, bend only ${f(bendOnly).toFixed(1)}, lift only ${f(liftOnly).toFixed(1)}, both ${f(both).toFixed(1)} Hz`);
check('The synthesizer plays the blended values', both.audio.kind === 'synth' && Math.abs(both.audio.params.f0 - f(both)) < 0.5);
// Held pose: 2 s still → sound sustains, unchanged.
await pose({ bend: 60, lift: 40 });
await wait(600);
const h0 = await dbg();
const held = [];
for (let i = 0; i < 10; i++) { await wait(200); held.push(await dbg()); }
check('A held pose sustains one steady sound (2 s)', held.every((x) => x.soundOn && x.tracking && x.gate > 0.95 && Math.abs(f(x) - f(h0)) < 0.01 && x.audio.kind === 'synth'), `f0 ${f(h0).toFixed(2)} Hz throughout, gate ${held[held.length - 1].gate.toFixed(2)}`);
await page.screenshot({ path: shots + 'pose-01-tracking.png' });

// ── lost joint → name it and fade ──
await pose({ bend: 60, lift: 40, hide: 15 }); // left wrist is not used → still tracking
await wait(500);
d = await dbg();
check('Losing a joint that is not used (left wrist) does not interrupt', d.tracking);
await pose({ bend: 60, lift: 40, hide: 16 }); // right wrist
await wait(900);
d = await dbg();
check('Losing the right wrist names it and fades the sound out', !d.tracking && /right wrist/.test(d.lostText) && d.gateTarget === 0 && d.gate < 0.05, `${d.lostText} gate ${d.gate.toFixed(3)}`);
await page.screenshot({ path: shots + 'pose-02-lost-joint.png' });
await pose({ bend: 60, lift: 40 });
await wait(600);
d = await dbg();
check('Sound fades back in when the joint returns', d.tracking && d.gate > 0.9, `gate ${d.gate.toFixed(3)}`);
await page.evaluate(() => { window.__feedOn = false; });
await wait(900);
d = await dbg();
check('No camera frames → tracking lost and sound faded', !d.tracking && d.gate < 0.05, d.lostText);
await page.evaluate(() => { window.__feedOn = true; });

// ── calibration with the two held poses ──
await pose({ bend: 8, lift: 20 });
await page.getByRole('button', { name: /Capture start pose/ }).click();
await wait(400);
d = await dbg();
check('Calibration counts down before reading the pose', d.busy && /Start pose/.test(d.countdown), JSON.stringify(d.countdown));
await page.waitForFunction(() => !window.__poseMap.debug().busy, null, { timeout: 8000 });
await pose({ bend: 125, lift: 140 });
await page.getByRole('button', { name: /Capture full pose/ }).click();
await page.waitForFunction(() => !window.__poseMap.debug().busy, null, { timeout: 8000 });
await wait(500);
d = await dbg();
check('Calibrated ranges come from the two held poses', Math.abs(d.project.cal.bend.lo - 8) < 1 && Math.abs(d.project.cal.bend.hi - 125) < 1 && Math.abs(d.project.cal.lift.lo - 20) < 1 && Math.abs(d.project.cal.lift.hi - 140) < 1, JSON.stringify(d.project.cal));
check('Full pose = top-right corner after calibration', d.dot.x > 0.98 && d.dot.y > 0.98, `(${d.dot.x.toFixed(2)}, ${d.dot.y.toFixed(2)})`);
await pose({ bend: 8, lift: 20 });
await wait(500);
d = await dbg();
check('Start pose = bottom-left corner', d.dot.x < 0.02 && d.dot.y < 0.02, `(${d.dot.x.toFixed(2)}, ${d.dot.y.toFixed(2)})`);

// ── the class phrase with the starter set ──
// Starter positions: ah (0.1, 0.1), ee (0.9, 0.1), oo (0.9, 0.9), eh (0.1, 0.9).
const cal = d.project.cal;
const angFor = (x, y) => ({ bend: cal.bend.lo + x * (cal.bend.hi - cal.bend.lo), lift: cal.lift.lo + y * (cal.lift.hi - cal.lift.lo) });
const phrase = [];
const sampleAt = async (label) => { const x = await dbg(); phrase.push({ label, f0: f(x), top: x.blend.weights.reduce((a, b) => (b.weight > a.weight ? b : a)) }); };
await pose(angFor(0.1, 0.1)); await wait(500); await sampleAt('1 ah');
for (let k = 1; k <= 8; k++) { await pose(angFor(0.1 + 0.1 * k, 0.1)); await wait(150); }
await wait(300); await sampleAt('2 ee');
await pose(angFor(0.9, 0.9)); await wait(500); await sampleAt('3 oo');
await wait(800); await sampleAt('4 freeze');
await pose(angFor(0.9, 0.1)); await wait(500); await sampleAt('5 back to ee');
for (let k = 7; k >= 0; k--) { await pose(angFor(0.1 + 0.1 * k, 0.1)); await wait(150); }
await wait(300); await sampleAt('6 back to ah');
const names = phrase.map((p) => `${p.label}: ${p.top.name.replace('Starter ', '')} ${p.f0.toFixed(0)} Hz`).join(' · ');
const exact = (i, nm, hz) => phrase[i].top.name.includes(nm) && phrase[i].top.weight > 0.999 && Math.abs(phrase[i].f0 - hz) < 0.05;
check('Class phrase: ah → ee → oo → freeze → backward to ee and ah, sound follows the pose', exact(0, 'ah', 196) && exact(1, 'ee', 220) && exact(2, 'oo', 175) && exact(3, 'oo', 175) && exact(4, 'ee', 220) && exact(5, 'ah', 196), names);

// ── attach a Vowel Morph vowel to a pose ──
const opt = await page.locator('.pm-vowel-sel option').first().textContent();
check('The vowel list offers vowels recorded in Vowel Morph first', /Vowel Morph: My Uu/.test(opt), opt);
await pose(angFor(0.5, 0.5));
await wait(300);
await page.getByRole('button', { name: /Attach to my pose/ }).click();
await page.waitForFunction(() => !window.__poseMap.debug().busy, null, { timeout: 8000 });
d = await dbg();
const mine = d.project.anchors.find((a) => a.name === 'My Uu');
check('Attach pins the vowel to the held pair of angles', mine && Math.abs(mine.angles.bend - angFor(0.5, 0.5).bend) < 0.5 && Math.abs(mine.angles.lift - angFor(0.5, 0.5).lift) < 0.5, mine ? JSON.stringify(mine.angles) : 'not attached');
check('Holding that pose plays exactly the attached vowel', Math.abs(f(d) - 260) < 0.05, `${f(d).toFixed(2)} Hz`);

// ── record a vowel on this page at a pose ──
await pose(angFor(0.25, 0.75));
await page.getByLabel('Name for a vowel recorded on this page').fill('Sung here');
await page.getByRole('button', { name: /Record a vowel at my pose/ }).click();
await page.waitForFunction(() => !window.__poseMap.debug().busy && /Attached|No usable|failed|short|not tracked/.test(document.querySelector('.pm-teach-msg').textContent), null, { timeout: 15000 });
d = await dbg();
const sung = d.project.anchors.find((a) => a.name === 'Sung here');
check('A vowel recorded here (simulated 233 Hz mic) is analyzed and attached at the pose', sung && Math.abs(sung.analysis.f0 - 233) < 2 && Math.abs(sung.angles.bend - angFor(0.25, 0.75).bend) < 0.5, sung ? `${sung.analysis.f0} Hz at ${JSON.stringify(sung.angles)}` : await page.locator('.pm-teach-msg').textContent());

// ── clap on the final pose ──
await page.getByRole('button', { name: /Start sound/ }).click().catch(() => {});
await pose(angFor(0.1, 0.1)); await wait(400);
await page.getByLabel(/Clap on the final pose/).check();
await wait(200);
await pose(angFor(0.9, 0.9)); await wait(1500); // enter and hold
d = await dbg();
check('Clap fires once on entering the final pose and stays quiet while held', d.claps === 1 && d.clapInside, `claps ${d.claps}`);
for (let i = 0; i < 12; i++) { await pose(angFor(0.9 - 0.16 / Math.SQRT2 + (i % 2 ? 0.02 : -0.02), 0.9 - 0.16 / Math.SQRT2 + (i % 2 ? 0.02 : -0.02))); await wait(80); }
d = await dbg();
check('Wobbling on the ring’s edge does not clap again', d.claps === 1, `claps ${d.claps}`);
await pose(angFor(0.5, 0.5)); await wait(400);
await pose(angFor(0.9, 0.9)); await wait(400);
d = await dbg();
check('Leaving and coming back claps again', d.claps === 2, `claps ${d.claps}`);
await page.screenshot({ path: shots + 'pose-03-clap.png' });

// ── tour ──
await page.getByRole('button', { name: '🧭 Tour' }).click();
await wait(300);
const steps = [];
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    const hole = document.querySelector('.tour-hole');
    const r = hole && !hole.hidden ? hole.getBoundingClientRect() : null;
    return { title: document.querySelector('.tour-title')?.textContent, count: document.querySelector('.tour-count')?.textContent, hole: r && r.width > 20 && r.height > 20, next: document.querySelector('.tour-pop .btn.primary')?.textContent };
  });
  if (!s.title) break;
  steps.push(s);
  if (s.next === 'Done') break;
  await page.locator('.tour-pop').getByRole('button', { name: /Next/ }).click();
  await wait(150);
}
check('Tour walks through camera, framing, calibration, starters, assigning, phrase and clap', steps.length === 13 && ['Turn on the camera', 'Get your arms in frame', 'Calibrate: start pose', 'Try the starter poses', 'Hold the pose and attach', 'Perform the phrase', 'Optional: clap on the final pose'].every((t) => steps.some((s) => s.title === t)), steps.map((s) => s.title).join(' → '));
check('Every tour step highlights a real control', steps.every((s) => s.hole), steps.filter((s) => !s.hole).map((s) => s.title).join(', ') || 'all highlighted');
check('Last step offers Done', steps.length && steps[steps.length - 1].next === 'Done');
await page.locator('.tour-pop').getByRole('button', { name: /Back/ }).click();
check('Back goes to the previous step', (await page.locator('.tour-title').textContent()) === steps[steps.length - 2].title);
await page.locator('.tour-pop').getByRole('button', { name: 'Next →' }).click();
await page.locator('.tour-pop').getByRole('button', { name: 'Done' }).click();
d = await dbg();
check('Done closes the tour', !d.tourOpen && (await page.locator('.tour-pop').count()) === 0);
await page.getByRole('button', { name: '🧭 Tour' }).click();
d = await dbg();
check('The tour can be reopened (starts at step 1)', d.tourOpen && d.tourStep === 0);
await page.screenshot({ path: shots + 'pose-04-tour.png' });
await page.locator('.tour-pop').getByRole('button', { name: 'Close' }).click();
d = await dbg();
check('Close closes it at any step', !d.tourOpen);

// ── real camera + MediaPipe on Chromium's fake camera (no person) ──
await page.evaluate(() => { window.__feedOn = false; });
await page.reload();
await page.waitForFunction(() => window.__poseMap);
await page.getByRole('button', { name: /Enable camera/ }).click();
const camOk = await page.waitForFunction(() => window.__poseMap.debug().camera === 'running' || window.__poseMap.debug().camera === 'error', null, { timeout: 60000 }).then(() => true).catch(() => false);
await wait(2500);
d = await dbg();
check('Real camera + MediaPipe pose model load from this site and run', camOk && d.camera === 'running' && d.fps > 0, `${d.cameraMsg} ${d.fps} frames/s`);
// Headless Chromium runs the model on a software GPU at only a few frames/s,
// so the page may report slow frames rather than "no person"; either way it
// must not track a pose that is not there.
check('With no person in view (test pattern), nothing is tracked and the sound stays silent', !d.tracking && /No person|No camera frames|Lost/.test(d.lostText), `${d.lostText} (${d.fps} frames/s in headless Chromium)`);
await page.screenshot({ path: shots + 'pose-05-real-camera.png' });

// ── the other projects still open ──
for (const [route, sel] of [['#/vowel-morph', () => window.__vowelMorph], ['#/motion-score', () => document.querySelector('h1')], ['#/frequency', () => document.querySelector('h1')]]) {
  await page.goto(url + route);
  const ok = await page.waitForFunction(sel, null, { timeout: 8000 }).then(() => true).catch(() => false);
  check(`${route} still opens`, ok, await page.locator('h1').first().textContent().catch(() => ''));
}
await page.goto(url + '#/tilt-map');
await page.waitForFunction(() => window.__poseMap, null, { timeout: 8000 }).catch(() => {});
check('Old #/tilt-map link opens the Pose Sound Map', await page.evaluate(() => !!window.__poseMap));

check('No page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

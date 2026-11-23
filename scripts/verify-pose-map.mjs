// Automated browser checks for Motion Morph (#/pose-map, capstone part 3).
// Usage: start the app (npx vite --port 5191 after `node scripts/copy-mediapipe.mjs`), then:
//   node scripts/verify-pose-map.mjs http://localhost:5191/
// Needs the `playwright` package.
//
// SIMULATED INPUT. No person stands in front of a camera and nobody sings:
//   • Body landmarks are generated (a stick figure whose right elbow bend and
//     left arm lift are set by the script) and fed through the page's own
//     pose handler (window.__poseMap.feed), the same function the camera
//     tracker calls.
//   • The microphone is a synthetic voice (harmonic oscillator, or silence,
//     or noise) whose pitch the script switches at known times.
//   • The mouse is Playwright's mouse.
//   • The real MediaPipe model is also started on Chromium's fake camera
//     (a test pattern, no person), to check that it loads and reports no person.
// Sound is checked through the app's state (oscillator targets, gate level),
// not by ear.
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

const vmAmps = Array.from({ length: 48 }, (_, i) => (i < 8 ? [0.4, 1, 0.7, 0.3, 0.2, 0.1, 0.05, 0.02][i] : 0));
const vmProject = { format: 'vowel-morph.project', version: 1, takes: [], pair: { a: null, b: null }, slider: 0, pitchMode: 'blend', space: { power: 2, point: { x: 0.5, y: 0.5 } },
  vowels: [{ id: 'vm-mine', name: 'My Uu', recordingId: null, segment: null, pos: { x: 0.3, y: 0.3 }, analysis: { status: 'ok', f0: 260, f0Auto: 260, f0Source: 'automatic', amps: vmAmps, sampleRate: 48000, warnings: [], problems: [], facts: {} } }] };

await context.addInitScript((vm) => {
  if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vowelMorph.project.v1', JSON.stringify(vm)); localStorage.removeItem('poseMap.project.v1'); sessionStorage.setItem('seeded', '1'); }
  // Synthetic microphone: a harmonic "voice" that can be switched to another pitch, to silence or to noise.
  const RECIPES = { ah: [0, 0.5, 0.8, 1, 0.9, 0.5, 0.3, 0.2, 0.15, 0.1, 0.08, 0.06], ee: [0, 1, 0.3, 0.1, 0.05, 0.04, 0.03, 0.2, 0.3, 0.25, 0.1, 0.05], hum: [0, 1, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05] };
  let voice = null;
  const make = () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain(); g.gain.value = 0;
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = nb.getChannelData(0); let seed = 7; for (let i = 0; i < ch.length; i++) { seed = (seed * 16807) % 2147483647; ch[i] = seed / 1073741823.5 - 1; }
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const ng = ctx.createGain(); ng.gain.value = 0;
    const mix = ctx.createGain();
    osc.connect(g).connect(mix); noise.connect(ng).connect(mix);
    osc.start(); noise.start();
    const waves = {};
    for (const [k, a] of Object.entries(RECIPES)) waves[k] = ctx.createPeriodicWave(new Float32Array(a.length), Float32Array.from(a));
    voice = { ctx, osc, g, ng, mix, waves, log: [] };
    return voice;
  };
  window.__fakeVoice = {
    set(freq, recipe = 'hum') {
      const v = voice || make();
      const now = v.ctx.currentTime;
      v.ng.gain.setValueAtTime(0, now);
      if (freq > 0) { v.osc.frequency.setValueAtTime(freq, now); v.osc.setPeriodicWave(v.waves[recipe]); v.g.gain.setValueAtTime(0.25, now); } else v.g.gain.setValueAtTime(0, now);
      v.log.push({ ms: performance.now(), freq });
    },
    noise() { const v = voice || make(); const now = v.ctx.currentTime; v.g.gain.setValueAtTime(0, now); v.ng.gain.setValueAtTime(0.3, now); v.log.push({ ms: performance.now(), freq: -1 }); },
    log: () => (voice ? voice.log : []),
  };
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.video) return real(c);
    const v = voice || make();
    const dest = v.ctx.createMediaStreamDestination();
    v.mix.connect(dest);
    return dest.stream;
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
page.on('dialog', (dl) => dl.accept());
const dbg = () => page.evaluate(() => window.__poseMap.debug());
const wait = (ms) => page.waitForTimeout(ms);
const pose = (p) => page.evaluate((q) => { window.__pose = { bend: 15, lift: 15, hide: null, ...q }; }, p);
const notBusy = (ms = 10000) => page.waitForFunction(() => !window.__poseMap.debug().busy, null, { timeout: ms });
const f = (x) => x.blend.params.f0;
const topGroup = (x) => x.groups[0] || { name: '', weight: 0 };
const near = (a, b, cents = 40) => Math.abs(1200 * Math.log2(a / b)) < cents;

await page.goto(url + '#/pose-map');
await page.waitForFunction(() => window.__poseMap);
let d = await dbg();
check('Page opens as “Motion Morph” with the starter sounds (ah, ee, oo, eh)', d.project.anchors.length === 4 && (await page.locator('h1').textContent()) === 'Motion Morph' && (await page.locator('.app-nav a[data-route="/pose-map"]').textContent()).includes('Motion Morph'), d.project.anchors.map((a) => `${a.name} ${a.analysis.f0} Hz`).join(', '));
check('Workflow strip shows the four steps, none done yet', d.steps.length === 4 && d.steps.every((x) => !x), (await page.locator('.pm-steps').textContent()));
check('Default range is in place without any calibration', d.calSource === 'default' && d.project.cal.bend.lo === 15 && d.project.cal.bend.hi === 130, JSON.stringify(d.project.cal));

// ── default range: playable as soon as the arms are seen ──
await page.evaluate(() => { window.__feedOn = true; });
await pose({ bend: 15, lift: 15 });
await wait(500);
await page.getByRole('button', { name: /Start sound/ }).click();
await wait(400);
const base = await dbg();
check('Tracking both angles straight away (no calibration step)', base.tracking && Math.abs(base.angles.bend - 15) < 0.5 && Math.abs(base.angles.lift - 15) < 0.5 && base.soundOn, `bend ${base.angles.bend.toFixed(1)}°, lift ${base.angles.lift.toFixed(1)}°`);
await pose({ bend: 100, lift: 15 }); await wait(700);
const bendOnly = await dbg();
await pose({ bend: 15, lift: 100 }); await wait(700);
const liftOnly = await dbg();
await pose({ bend: 100, lift: 100 }); await wait(700);
const both = await dbg();
check('Right elbow bend alone moves the marker only left/right', Math.abs(bendOnly.dot.y - base.dot.y) < 0.01 && bendOnly.dot.x > base.dot.x + 0.5, `(${base.dot.x.toFixed(2)}, ${base.dot.y.toFixed(2)}) → (${bendOnly.dot.x.toFixed(2)}, ${bendOnly.dot.y.toFixed(2)})`);
check('Left arm lift alone moves the marker only up/down', Math.abs(liftOnly.dot.x - base.dot.x) < 0.01 && liftOnly.dot.y > base.dot.y + 0.5, `(${base.dot.x.toFixed(2)}, ${base.dot.y.toFixed(2)}) → (${liftOnly.dot.x.toFixed(2)}, ${liftOnly.dot.y.toFixed(2)})`);
check('The two angles together set the blend', new Set([f(base), f(bendOnly), f(liftOnly), f(both)].map((v) => v.toFixed(2))).size === 4, `f0: start ${f(base).toFixed(1)}, bend ${f(bendOnly).toFixed(1)}, lift ${f(liftOnly).toFixed(1)}, both ${f(both).toFixed(1)} Hz`);
const sumW = both.groups.reduce((s, g) => s + g.weight, 0);
check('Percentages add up to 100 % and the synth plays exactly the blended f0 and harmonics', Math.abs(sumW - 1) < 1e-6 && both.audio.kind === 'synth' && Math.abs(both.audio.params.f0 - f(both)) < 1e-6 && both.audio.params.amps.every((a, i) => Math.abs(a - both.blend.params.amps[i]) < 1e-9),
  both.groups.map((g) => `${g.name} ${(g.weight * 100).toFixed(0)} %`).join(', '));
check('Harmonic graph and contribution bars are on the page', await page.locator('canvas.pm-harm').count() >= 1 && await page.locator('.pm-weights .pm-wrow').count() >= 2);
await pose({ bend: 60, lift: 40 }); await wait(600);
const h0 = await dbg();
const held = [];
for (let i = 0; i < 10; i++) { await wait(200); held.push(await dbg()); }
check('A held pose holds one steady sound (2 s)', held.every((x) => x.soundOn && x.tracking && x.gate > 0.95 && Math.abs(f(x) - f(h0)) < 0.01), `f0 ${f(h0).toFixed(2)} Hz throughout`);
d = await dbg();
check('Steps 1 and 2 are ticked after the camera tracks and the starters play', d.steps[0] && d.steps[1] && !d.steps[2]);

// ── tracking drops ──
await pose({ bend: 60, lift: 40, hide: 16 }); // right wrist
await wait(900);
d = await dbg();
check('Losing the right wrist names it, freezes the marker and fades the sound', !d.tracking && /right wrist/.test(d.lostText) && d.gate < 0.05 && Math.abs(d.dot.x - h0.dot.x) < 0.02, `${d.lostText} gate ${d.gate.toFixed(3)}`);
await pose({ bend: 60, lift: 40 }); await wait(600);
d = await dbg();
check('Sound fades back in when the joint returns', d.tracking && d.gate > 0.9, `gate ${d.gate.toFixed(3)}`);
await page.evaluate(() => { window.__feedOn = false; });
await wait(900);
d = await dbg();
check('No camera frames → tracking lost and sound faded', !d.tracking && d.gate < 0.05, d.lostText);
await page.evaluate(() => { window.__feedOn = true; });
await wait(400);
await page.getByRole('button', { name: /Stop sound/ }).click();

// ── Add my sound: record → check → pose ──
await page.getByRole('button', { name: /Add my sound/ }).click();
await page.getByLabel('Name of your sound').fill('Hum');
await page.evaluate(() => window.__fakeVoice.set(233, 'hum'));
await page.locator('.pm-add .pm-rec').click();
await page.waitForFunction(() => { const x = window.__poseMap.debug(); return !x.busy && x.draft && x.draft.ok != null; }, null, { timeout: 15000 });
d = await dbg();
check('A steady hum (simulated 233 Hz) is recorded and analyzed', d.draft.ok && Math.abs(d.draft.f0 - 233) < 2, `f0 ${d.draft.f0} Hz`);
const heard = await page.locator('.pm-heard').textContent();
check('The panel says what was analyzed and what will be synthesized', /What the app heard/.test(heard) && /fundamental/.test(heard) && /harmonics stood out/.test(heard) && /What it will synthesize/.test(heard) && /48 sine waves/.test(heard), heard.slice(0, 160) + '…');
await page.locator('.pm-add .pm-orig').click(); await wait(200);
const origKind = (await dbg()).audio.kind;
await page.locator('.pm-add .pm-synth').click(); await wait(200);
d = await dbg();
check('▶ Original plays the recording and ▶ Synthesized plays the rebuilt sound (even with sound off)', origKind === 'original' && d.audio.kind === 'synth' && Math.abs(d.audio.params.f0 - 233) < 2 && d.gateTarget === 1, `${origKind} then ${d.audio.kind} ${d.audio.params && d.audio.params.f0} Hz`);
await wait(1700);
const HUM = { bend: 70, lift: 75 };
await pose(HUM);
await page.locator('.pm-add .pm-pose-btn').click();
await wait(400);
d = await dbg();
check('Use my pose counts down first (time to step back)', d.busy && /Step back/.test(d.countdown) && /3/.test(d.countdown), JSON.stringify(d.countdown));
await notBusy();
d = await dbg();
let hum = d.project.anchors.find((a) => a.name === 'Hum');
check('The sound is saved at the held pose (as two angles)', hum && Math.abs(hum.angles.bend - HUM.bend) < 0.6 && Math.abs(hum.angles.lift - HUM.lift) < 0.6 && hum.placedBy === 'pose', hum ? JSON.stringify(hum.angles) : d.draft.poseMsg);
const howto = await page.locator('.pm-howto').textContent().catch(() => '');
check('Right after saving, the panel explains how to play it with your arms', /How to play “Hum” with your arms/.test(howto) && /elbow/.test(howto) && /left arm/.test(howto), howto);
check('The pose target is marked on both angle bars', await page.locator('.pm-bar-target:not([hidden])').count() === 2);
await page.getByRole('button', { name: /Start sound/ }).click();
await wait(500);
d = await dbg();
check('Holding that pose plays the hum (233 Hz, ≈100 %)', topGroup(d).name === 'Hum' && topGroup(d).weight > 0.98 && near(f(d), 233, 10), `${topGroup(d).name} ${(topGroup(d).weight * 100).toFixed(1)} %, ${f(d).toFixed(1)} Hz`);
check('Step 3 and 4 ticked once my sound is added and played', d.steps[2] && d.steps[3], JSON.stringify(d.steps));
await pose({ bend: 15, lift: 15 }); await wait(500);
const toAh = await dbg();
await pose({ bend: 42, lift: 45 }); await wait(500);
const mid = await dbg();
check('Moving back toward a starter blends toward it', topGroup(toAh).name.includes('ah') && mid.groups.find((g) => g.name === 'Hum').weight > 0.05 && mid.groups.find((g) => g.name === 'Hum').weight < 0.95, `at ah: ${topGroup(toAh).name}; halfway: Hum ${(mid.groups.find((g) => g.name === 'Hum').weight * 100).toFixed(0)} %, f0 ${f(mid).toFixed(1)} Hz`);
await page.screenshot({ path: shots + 'motion-01-my-sound.png' });

// ── redo position, with a tracking drop during the hold ──
await pose({ bend: 110, lift: 50, hide: 14 }); // right elbow lost
await page.locator('.pm-add .pm-pose-btn').click();
await notBusy();
d = await dbg();
hum = d.project.anchors.find((a) => a.name === 'Hum');
check('If tracking drops during the hold, nothing changes and the lost joint is named', /couldn’t see both arms/.test(d.draft.poseMsg) && /right elbow/.test(d.draft.poseMsg) && Math.abs(hum.angles.bend - HUM.bend) < 0.6, d.draft.poseMsg);
await pose({ bend: 110, lift: 50 });
await page.locator('.pm-add .pm-pose-btn').click();
await notBusy();
d = await dbg();
const hum2 = d.project.anchors.find((a) => a.name === 'Hum');
check('Redo position moves the same sound to the new pose', hum2.id === hum.id && Math.abs(hum2.angles.bend - 110) < 0.6 && Math.abs(hum2.angles.lift - 50) < 0.6 && d.project.anchors.filter((a) => a.name === 'Hum').length === 1, JSON.stringify(hum2.angles));

// ── a recording without a usable estimate ──
await page.evaluate(() => window.__fakeVoice.noise());
await page.locator('.pm-add .pm-rec').click();
await page.waitForFunction(() => { const x = window.__poseMap.debug(); return !x.busy && /Recording/.test(x.draft.msg) === false; }, null, { timeout: 15000 });
d = await dbg();
const failText = await page.locator('.pm-fail').textContent().catch(() => '');
check('Noise (no pitch) is rejected with a clear reason and tip; the saved hum is kept', d.draft.ok === false && /No usable estimate/.test(failText) && /pitch/.test(failText) && /try again/i.test(failText) && near(d.project.anchors.find((a) => a.name === 'Hum').analysis.f0, 233, 10), failText);
await page.evaluate(() => window.__fakeVoice.set(0));
await page.getByRole('button', { name: 'Done' }).click();

// ── click-to-place ──
await page.getByRole('button', { name: /Add my sound/ }).click();
await page.getByLabel('Name of your sound').fill('Oh');
await page.evaluate(() => window.__fakeVoice.set(300, 'ah'));
await page.locator('.pm-add .pm-rec').click();
await page.waitForFunction(() => { const x = window.__poseMap.debug(); return !x.busy && x.draft && x.draft.ok != null; }, null, { timeout: 15000 });
await page.evaluate(() => window.__fakeVoice.set(0));
await page.locator('.pm-add .pm-click-btn').click();
d = await dbg();
check('“Click the map instead” waits for a click on the map', d.mode === 'place' && /Click anywhere on the map/.test(await page.locator('.pm-map-hint').textContent()));
await page.locator('svg.pm-square').scrollIntoViewIfNeeded();
let box = await page.locator('svg.pm-square').boundingBox();
const toPx = (x, y) => [box.x + x * box.width, box.y + (1 - y) * box.height];
await page.mouse.click(...toPx(0.35, 0.8));
d = await dbg();
const oh = d.project.anchors.find((a) => a.name === 'Oh');
const ohDot = d.anchorsOnMap.find((a) => a.name === 'Oh');
const cal0 = d.project.cal;
const angOf = (x, y, c = cal0) => ({ bend: c.bend.lo + x * (c.bend.hi - c.bend.lo), lift: c.lift.lo + y * (c.lift.hi - c.lift.lo) });
check('Clicking places the sound there; it is saved as the pose that reaches that spot', oh && oh.placedBy === 'click' && Math.abs(ohDot.pos.x - 0.35) < 0.01 && Math.abs(ohDot.pos.y - 0.8) < 0.01 && Math.abs(oh.angles.bend - angOf(0.35, 0.8).bend) < 0.6, oh ? `angles ${JSON.stringify(oh.angles)}, dot (${ohDot.pos.x.toFixed(3)}, ${ohDot.pos.y.toFixed(3)})` : 'not placed');
await page.getByRole('button', { name: 'Done' }).click();

// ── Draw + record: timing alignment ──
await page.getByRole('button', { name: /Draw \+ record/ }).click();
await page.waitForFunction(() => window.__poseMap.debug().micListening, null, { timeout: 5000 });
check('Draw + record opens the microphone and stops the map sound', (await dbg()).mode === 'draw' && !(await dbg()).soundOn);
async function drawTake({ aSec, bSec, a, b, yMid = 0.45 }) {
  await page.locator('svg.pm-square').scrollIntoViewIfNeeded();
  box = await page.locator('svg.pm-square').boundingBox();
  const curve = (x) => yMid + 0.15 * Math.sin((x - 0.1) * 2 * Math.PI * 1.25);
  await page.evaluate(([fq, r]) => window.__fakeVoice.set(fq, r), a);
  await wait(150);
  await page.mouse.move(...toPx(0.1, curve(0.1)));
  await page.mouse.down();
  const seg = async (x0, x1, sec, sound) => {
    if (sound) await page.evaluate(([fq, r]) => window.__fakeVoice.set(fq, r), sound);
    const t0 = Date.now();
    for (;;) {
      const u = Math.min(1, (Date.now() - t0) / (sec * 1000));
      const x = x0 + u * (x1 - x0);
      await page.mouse.move(...toPx(x, curve(x)));
      if (u >= 1) break;
      await wait(12);
    }
  };
  await seg(0.1, 0.3, aSec, null);
  await seg(0.3, 0.9, bSec, b);
  await page.mouse.up();
  await page.evaluate(() => window.__fakeVoice.set(0));
  await page.waitForFunction(() => !window.__poseMap.debug().drawing && /usable point/.test(window.__poseMap.debug().drawStatus), null, { timeout: 20000 });
}
const calDraw = (await dbg()).project.cal;
await drawTake({ aSec: 1.6, bSec: 0.9, a: [150, 'ah'], b: [300, 'ee'] });
d = await dbg();
const take1 = d.project.takes[0];
const xOf = (p) => (p.bend - calDraw.bend.lo) / (calDraw.bend.hi - calDraw.bend.lo);
const A = take1.points.filter((p) => xOf(p) < 0.28);
const B = take1.points.filter((p) => xOf(p) > 0.33);
check('Take 1 stored with learned points (saved as poses)', take1.points.length >= 12 && take1.points.every((p) => Number.isFinite(p.bend) && Number.isFinite(p.lift)), `${take1.points.length} of ${take1.stats.snippets} snippets; ${d.drawStatus.slice(0, 90)}…`);
check('Points drawn slowly during the 150 Hz part have f0 ≈ 150 Hz', A.length >= 6 && A.every((p) => near(p.f0, 150, 60)), `${A.length} points`);
check('Points drawn fast during the 300 Hz part have f0 ≈ 300 Hz', B.length >= 3 && B.every((p) => near(p.f0, 300, 60)), `${B.length} points`);
check('Speed change: most points sit on the slow first part (aligned by time, not spread by length)', A.length / take1.points.length > 0.5, `${(100 * A.length / take1.points.length).toFixed(0)} % of points in the first 25 % of the line`);
check('After the take, the hint says how to play it with your arms', /To play it with your arms, start at/.test(d.drawStatus), d.drawStatus.slice(0, 200));
await page.screenshot({ path: shots + 'motion-02-take.png' });

// play the take with the arms
await page.getByRole('button', { name: /Draw \+ record/ }).click(); // leave draw mode
await page.getByRole('button', { name: /Start sound/ }).click();
const first = take1.points[1];
const last = take1.points[take1.points.length - 2];
await pose({ bend: first.bend, lift: first.lift }); await wait(600);
const atFirst = await dbg();
await pose({ bend: last.bend, lift: last.lift }); await wait(600);
const atLast = await dbg();
check('Moving the arms along the take plays it: ≈150 Hz at its start, ≈300 Hz at its end', topGroup(atFirst).name === 'Take 1' && near(f(atFirst), 150, 50) && near(f(atLast), 300, 50), `start ${f(atFirst).toFixed(0)} Hz (${topGroup(atFirst).name} ${(topGroup(atFirst).weight * 100).toFixed(0)} %), end ${f(atLast).toFixed(0)} Hz`);
check('Contribution bars group the take into one entry', atFirst.groups.filter((g) => g.name === 'Take 1').length === 1, atFirst.groups.map((g) => g.name).join(', '));
await page.locator('.pm-take-row .pm-replay').first().click();
const seen = [];
for (let i = 0; i < 30; i++) { await wait(100); const x = await dbg(); if (x.blend.params) seen.push(x.blend.params.f0); }
check('“Hear along the line” glides from the first sound to the second', Math.min(...seen) < 175 && Math.max(...seen) > 270, `${Math.min(...seen).toFixed(0)}–${Math.max(...seen).toFixed(0)} Hz`);
await wait(500);

// second take, then undo only that one
await page.getByRole('button', { name: /Draw \+ record/ }).click();
await page.waitForFunction(() => window.__poseMap.debug().micListening);
await drawTake({ aSec: 0.8, bSec: 0.8, a: [220, 'ee'], b: [180, 'ah'], yMid: 0.2 });
d = await dbg();
check('A second take is added', d.project.takes.length === 2 && d.project.takes[1].points.length >= 6);
await page.getByRole('button', { name: /Undo last take/ }).click();
d = await dbg();
check('Undo removes only the latest take; my sounds and starters stay', d.project.takes.length === 1 && d.project.takes[0].id === take1.id && d.project.anchors.some((a) => a.name === 'Hum') && d.project.anchors.some((a) => a.name === 'Oh') && d.project.anchors.filter((a) => a.source === 'starter').length === 4, d.drawStatus);
await page.getByRole('button', { name: /Draw \+ record/ }).click();

// ── Adjust to my movement ──
const before = (await dbg()).project.cal;
const humPose = d.project.anchors.find((a) => a.name === 'Hum').angles;
const ohPose = d.project.anchors.find((a) => a.name === 'Oh').angles;
const tk = d.project.takes[0].points[3];
const dotsBefore = (await dbg()).anchorsOnMap;
await page.getByRole('button', { name: /Adjust to my movement/ }).click();
await wait(3200); // countdown
const sweep = [];
const t0 = Date.now();
while (Date.now() - t0 < 6000) { const u = (Date.now() - t0) / 6000; const p = { bend: 40 + 75 * (0.5 - 0.5 * Math.cos(u * 6 * Math.PI)), lift: 25 + 95 * (0.5 - 0.5 * Math.cos(u * 4 * Math.PI)) }; sweep.push(p); await pose(p); await wait(30); }
await notBusy();
d = await dbg();
check('Adjust estimates the range I actually used', d.calSource === 'adjusted' && Math.abs(d.project.cal.bend.lo - 40) < 6 && Math.abs(d.project.cal.bend.hi - 115) < 6 && Math.abs(d.project.cal.lift.lo - 25) < 6 && Math.abs(d.project.cal.lift.hi - 120) < 6, `${JSON.stringify(before)} → ${JSON.stringify(d.project.cal)}`);
check('It shows how the response changed (degrees → % of the map)', /now moves the marker \d+ % of the map \(was \d+ %\)/.test(d.rangeMsg) && /moved on the map/.test(d.rangeMsg), d.rangeMsg);
const dotsAfter = d.anchorsOnMap;
const moved = (n) => { const a = dotsBefore.find((x) => x.name === n).pos; const b = dotsAfter.find((x) => x.name === n).pos; return Math.hypot(a.x - b.x, a.y - b.y); };
check('My dots moved on the map, starters stayed at their corners', moved('Hum') > 0.03 && moved('Starter “ah”') < 1e-9 && d.ghosts > 0, `Hum moved ${moved('Hum').toFixed(3)}, ah moved ${moved('Starter “ah”').toFixed(3)}`);
check('Saved poses keep their angles through the new range', JSON.stringify(d.project.anchors.find((a) => a.name === 'Hum').angles) === JSON.stringify(humPose) && JSON.stringify(d.project.takes[0].points[3].bend) === JSON.stringify(tk.bend));
await pose(humPose); await wait(600);
const humAfter = await dbg();
await pose(ohPose); await wait(600);
const ohAfter = await dbg();
await pose({ bend: tk.bend, lift: tk.lift }); await wait(600);
const tkAfter = await dbg();
check('After adjusting: holding the Hum pose still plays the hum', topGroup(humAfter).name === 'Hum' && topGroup(humAfter).weight > 0.98 && near(f(humAfter), 233, 10), `${topGroup(humAfter).name} ${(topGroup(humAfter).weight * 100).toFixed(1)} %, ${f(humAfter).toFixed(1)} Hz`);
check('After adjusting: the click-placed “Oh” still plays at its pose', topGroup(ohAfter).name === 'Oh' && topGroup(ohAfter).weight > 0.98 && near(f(ohAfter), 300, 10), `${topGroup(ohAfter).name} ${(topGroup(ohAfter).weight * 100).toFixed(1)} %, ${f(ohAfter).toFixed(1)} Hz`);
check('After adjusting: a drawn take point still plays at its pose', topGroup(tkAfter).name === 'Take 1' && near(f(tkAfter), tk.f0, 40), `${topGroup(tkAfter).name}, ${f(tkAfter).toFixed(1)} Hz (point ${tk.f0.toFixed(1)} Hz)`);
await page.screenshot({ path: shots + 'motion-03-adjusted.png' });

// tweaks afterwards
await page.locator('.pm-tune summary').click();
const c1 = (await dbg()).project.cal.bend;
await page.locator('.pm-tune-row[data-axis="bend"] .pm-widen').click();
const c2 = (await dbg()).project.cal.bend;
check('“Small moves jump too far” widens that range (less sensitive)', c2.hi - c2.lo > (c1.hi - c1.lo) * 1.2, `${c1.lo}–${c1.hi} → ${c2.lo}–${c2.hi}`);
await page.locator('.pm-tune-row[data-axis="lift"] .pm-narrow').click();
await page.locator('.pm-tune-row[data-axis="lift"] .pm-narrow').click();
await page.locator('.pm-tune-row[data-axis="lift"] .pm-narrow').click();
d = await dbg();
check('Narrowing a lot flags sounds whose pose is now outside the range', d.anchorsOnMap.some((a) => a.outside) && /Outside the new range/.test(d.rangeMsg), d.anchorsOnMap.filter((a) => a.outside).map((a) => a.name).join(', '));
await page.locator('.pm-tune-row[data-axis="lift"] input[aria-label*="end"]').evaluate((el) => { el.value = '150'; el.dispatchEvent(new Event('change')); });
d = await dbg();
check('The range-end slider sets that end', d.project.cal.lift.hi === 150, JSON.stringify(d.project.cal.lift));
await page.getByRole('button', { name: /Undo range change/ }).click();
d = await dbg();
check('Undo range change goes back one step', d.project.cal.lift.hi !== 150, JSON.stringify(d.project.cal.lift));

// adjust with tracking lost: nothing changes
const calKeep = JSON.stringify((await dbg()).project.cal);
await page.getByRole('button', { name: /Adjust to my movement/ }).click();
await wait(3200);
await page.evaluate(() => { window.__feedOn = false; });
await notBusy();
await page.evaluate(() => { window.__feedOn = true; });
d = await dbg();
check('Adjust with tracking lost changes nothing and says why', JSON.stringify(d.project.cal) === calKeep && /camera readings/.test(d.rangeMsg), d.rangeMsg);

// reload: everything persists, still lined up
await page.reload();
await page.waitForFunction(() => window.__poseMap);
await page.evaluate(() => { window.__feedOn = true; });
d = await dbg();
check('After reload: sounds, take and range are kept', d.project.anchors.some((a) => a.name === 'Hum') && d.project.takes.length === 1 && JSON.stringify(d.project.cal) === calKeep);
await page.getByRole('button', { name: /Start sound/ }).click();
await pose(humPose); await wait(700);
d = await dbg();
check('After reload: the Hum pose still plays the hum', topGroup(d).name === 'Hum' && near(f(d), 233, 10), `${f(d).toFixed(1)} Hz`);
check('After reload: ▶ Original is still available for my recording (stored in this browser)', await page.locator('.pm-row[data-id] button', { hasText: 'Original' }).count() >= 1);
await page.getByRole('button', { name: /Stop sound/ }).click();

// ── tour ──
await page.getByRole('button', { name: '🧭 Tour' }).click();
await wait(300);
const steps = [];
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    const hole = document.querySelector('.tour-hole');
    const r = hole && !hole.hidden ? hole.getBoundingClientRect() : null;
    return { title: document.querySelector('.tour-title')?.textContent, hole: r && r.width > 20 && r.height > 20, next: document.querySelector('.tour-pop .btn.primary')?.textContent };
  });
  if (!s.title) break;
  steps.push(s);
  if (s.next === 'Done') break;
  await page.locator('.tour-pop').getByRole('button', { name: /Next/ }).click();
  await wait(200);
}
const need = ['Turn on the camera', 'Try the starter sounds', 'Record a steady sound', 'Check what the app heard', 'Assign it to a pose', 'Play it with your arms', 'Draw + record a take', 'Undo a take', 'Move between your sounds', 'Optional: adjust to my movement'];
check('Tour walks through camera, starters, recording, assigning a pose, drawing a take and playing by movement', need.every((t) => steps.some((s) => s.title === t)), steps.map((s) => s.title).join(' → '));
check('Every tour step highlights a real control', steps.every((s) => s.hole), steps.filter((s) => !s.hole).map((s) => s.title).join(', ') || `all ${steps.length} highlighted`);
await page.locator('.tour-pop').getByRole('button', { name: /Back/ }).click();
check('Back goes to the previous step', (await page.locator('.tour-title').textContent()) === steps[steps.length - 2].title);
await page.locator('.tour-pop').getByRole('button', { name: 'Next →' }).click();
await page.locator('.tour-pop').getByRole('button', { name: 'Done' }).click();
d = await dbg();
check('Done closes the tour; it can be reopened at step 1 and closed', !d.tourOpen && await page.locator('.tour-pop').count() === 0 && await (async () => { await page.getByRole('button', { name: '🧭 Tour' }).click(); const z = await dbg(); await page.locator('.tour-pop').getByRole('button', { name: 'Close' }).click(); return z.tourOpen && z.tourStep === 0 && !(await dbg()).tourOpen; })());
check('The tour itself did not record, play or change sounds', d.project.anchors.length === 6 && !d.soundOn && !d.busy);
await page.locator('.pm-add button', { hasText: 'Close' }).click().catch(() => {});

// phone width: no horizontal scroll
await page.setViewportSize({ width: 390, height: 844 });
await wait(300);
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
check('Phone width (390 px): no horizontal page scroll', sw <= 392, `scrollWidth ${sw}`);
await page.screenshot({ path: shots + 'motion-04-phone.png', fullPage: false });
await page.setViewportSize({ width: 1440, height: 1300 });

// ── real camera + MediaPipe on Chromium's fake camera (no person) ──
await page.evaluate(() => { window.__feedOn = false; });
await page.reload();
await page.waitForFunction(() => window.__poseMap);
await page.getByRole('button', { name: /Enable camera/ }).click();
const camOk = await page.waitForFunction(() => ['running', 'error'].includes(window.__poseMap.debug().camera), null, { timeout: 60000 }).then(() => true).catch(() => false);
await wait(2500);
d = await dbg();
check('Real camera + MediaPipe pose model load from this site and run', camOk && d.camera === 'running' && d.fps > 0, `${d.cameraMsg} ${d.fps} frames/s`);
check('With no person in view (test pattern), nothing is tracked', !d.tracking && /No person|No camera frames|Lost/.test(d.lostText), d.lostText);
await page.screenshot({ path: shots + 'motion-05-real-camera.png' });

for (const [route, sel] of [['#/vowel-morph', () => window.__vowelMorph], ['#/motion-score', () => document.querySelector('h1')], ['#/frequency', () => document.querySelector('h1')]]) {
  await page.goto(url + route);
  const ok = await page.waitForFunction(sel, null, { timeout: 8000 }).then(() => true).catch(() => false);
  check(`${route} still opens`, ok, await page.locator('h1').first().textContent().catch(() => ''));
}
for (const old of ['#/tilt-map', '#/motion-morph']) {
  await page.goto(url + old);
  await page.waitForFunction(() => window.__poseMap, null, { timeout: 8000 }).catch(() => {});
  check(`${old} opens Motion Morph`, await page.evaluate(() => !!window.__poseMap));
}

check('No page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

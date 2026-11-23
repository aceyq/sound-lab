// Automated browser checks for Motion Morph (#/pose-map, capstone part 3):
// empty map, guided Add a sound (Record → Listen → Place → Ready), Clear map,
// labelled axes, drawn takes, range, tour.
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
let dialogs = [];
let dialogAnswer = true;
page.on('dialog', (dl) => { dialogs.push(dl.message()); return dialogAnswer ? dl.accept() : dl.dismiss(); });
const dbg = () => page.evaluate(() => window.__poseMap.debug());
const wait = (ms) => page.waitForTimeout(ms);
const pose = (p) => page.evaluate((q) => { window.__pose = { bend: 15, lift: 15, hide: null, ...q }; }, p);
const notBusy = (ms = 10000) => page.waitForFunction(() => !window.__poseMap.debug().busy, null, { timeout: ms });
const f = (x) => x.blend.params.f0;
const topGroup = (x) => x.groups[0] || { name: '', weight: 0 };
const near = (a, b, cents = 40) => Math.abs(1200 * Math.log2(a / b)) < cents;
const shownDeg = (s) => Number((s.match(/(\d+)°/) || [])[1]);
const shownCoord = (s) => Number((s.match(/= (\d\.\d\d)/) || [])[1]);
const flowStep = async () => (await page.locator('.pm-flow-steps li.current').textContent().catch(() => '')).replace(/^\d/, '');
const mapBox = async () => { await page.locator('svg.pm-square').scrollIntoViewIfNeeded(); return page.locator('svg.pm-square').boundingBox(); };
let box;
const toPx = (x, y) => [box.x + x * box.width, box.y + (1 - y) * box.height];
const clickMap = async (x, y) => { box = await mapBox(); await page.mouse.click(...toPx(x, y)); };
const sound = (x, name) => x.project.sounds.find((s) => s.name === name);
const record = async (name, voice) => {
  if (name) await page.getByLabel('Name of your sound').fill(name);
  await page.evaluate(([fq, r]) => (fq === 'noise' ? window.__fakeVoice.noise() : window.__fakeVoice.set(fq, r)), voice);
  await page.locator('.pm-add .pm-rec').click();
  await page.waitForFunction(() => { const x = window.__poseMap.debug(); return !x.busy && x.flow && (x.flow.step !== 'record' || x.flow.ok === false); }, null, { timeout: 15000 });
  await page.evaluate(() => window.__fakeVoice.set(0));
};

await page.goto(url + '#/pose-map');
await page.waitForFunction(() => window.__poseMap);
let d = await dbg();

// ── 1. empty board ──
const emptyText = await page.locator('.pm-empty').textContent();
check('Page opens as “Motion Morph” with an EMPTY map (no starter vowels)', (await page.locator('h1').textContent()) === 'Motion Morph' && d.project.sounds.length === 0 && d.project.takes.length === 0 && d.onMap.length === 0 && d.blend.weights.length === 0);
check('The empty map shows an instruction and explains what “learning” means', d.emptyShown && /Your map is empty/.test(emptyText) && /Add a sound/.test(emptyText) && /nothing is trained/.test(emptyText) && /48 harmonics/.test(emptyText), emptyText.slice(0, 140) + '…');
check("Default range is in place without any calibration", d.project.calSource === 'default' && d.project.cal.bend.lo === 15 && d.project.cal.bend.hi === 130, JSON.stringify(d.project.cal));

// ── 2. axis labels ──
const svgText = await page.locator('svg.pm-square .pm-axes').textContent();
check('Map axes are labelled: RIGHT ELBOW BEND (straighter arm ← → more bent arm) and LEFT ARM LIFT (arm down ↓ ↑ arm raised)', /RIGHT ELBOW BEND/.test(svgText) && /straighter arm/.test(svgText) && /more bent arm/.test(svgText) && /LEFT ARM LIFT/.test(svgText) && /arm down/.test(svgText) && /arm raised/.test(svgText), svgText.replace(/\s+/g, ' '));
const panelText = await page.locator('.pm-axis-panel').textContent();
check('Panel beside the map names both axes and their joints', /Horizontal \(x\) = Right elbow bend/.test(panelText) && /Vertical \(y\) = Left arm lift/.test(panelText), panelText.slice(0, 120));
const colors = await page.evaluate(() => [...document.querySelectorAll('.pm-ax-head')].map((e) => getComputedStyle(e).color));
check('Axis colours match the preview joint colours (blue = right elbow bend, pink = left arm lift)', colors[0] === 'rgb(88, 209, 255)' && colors[1] === 'rgb(255, 121, 198)', colors.join(', '));
const legend = await page.locator('.pm-camera').textContent();
check('Camera card explains mirroring and anatomical left/right', /mirrored/.test(legend) && /your right arm appears on the right/.test(legend) && /your own body/.test(legend));

// ── 3. arms → marker, readings agree with labels ──
await page.evaluate(() => { window.__feedOn = true; });
const P0 = { bend: 40, lift: 50 };
await pose(P0); await wait(600);
const base = await dbg();
await pose({ ...P0, bend: 100 }); await wait(700);
const bendOnly = await dbg();
await pose({ ...P0, lift: 100 }); await wait(700);
const liftOnly = await dbg();
await pose({ bend: 100, lift: 100 }); await wait(700);
const both = await dbg();
const cal = base.project.cal;
const expX = (b) => (b - cal.bend.lo) / (cal.bend.hi - cal.bend.lo);
const expY = (l) => (l - cal.lift.lo) / (cal.lift.hi - cal.lift.lo);
check('Bending only the right elbow (more bent) moves the marker only to the RIGHT', bendOnly.dot.x > base.dot.x + 0.4 && Math.abs(bendOnly.dot.y - base.dot.y) < 0.01, `(${base.dot.x.toFixed(2)}, ${base.dot.y.toFixed(2)}) → (${bendOnly.dot.x.toFixed(2)}, ${bendOnly.dot.y.toFixed(2)})`);
check('Lifting only the left arm (raised) moves the marker only UP', liftOnly.dot.y > base.dot.y + 0.4 && Math.abs(liftOnly.dot.x - base.dot.x) < 0.01, `(${base.dot.x.toFixed(2)}, ${base.dot.y.toFixed(2)}) → (${liftOnly.dot.x.toFixed(2)}, ${liftOnly.dot.y.toFixed(2)})`);
check('Both together move it diagonally (right and up)', both.dot.x > base.dot.x + 0.4 && both.dot.y > base.dot.y + 0.4);
const agree = [base, bendOnly, liftOnly, both].every((x) => Math.abs(shownDeg(x.shown.axis[0]) - x.angles.bend) <= 1 && Math.abs(shownDeg(x.shown.axis[1]) - x.angles.lift) <= 1
  && Math.abs(shownCoord(x.shown.axis[0]) - x.dot.x) <= 0.006 && Math.abs(shownCoord(x.shown.axis[1]) - x.dot.y) <= 0.006
  && Math.abs(x.dot.x - Math.min(1, Math.max(0, expX(x.angles.bend)))) < 0.01 && Math.abs(x.dot.y - Math.min(1, Math.max(0, expY(x.angles.lift)))) < 0.01);
check('Degrees and map coordinates shown beside the map agree with the measured angles and the marker', agree, [base, both].map((x) => x.shown.axis.join(' | ')).join('  ;  '));

// ── 4. Add a sound: failure → retry → listen → click placement (with cancel) → ready ──
await page.locator('.pm-add-btn').click();
d = await dbg();
check('Add a sound opens the guided panel at step 1 (Record) with a step indicator', d.flow && d.flow.step === 'record' && (await page.locator('.pm-flow-steps li').count()) === 4 && /Record/.test(await flowStep()), await page.locator('.pm-flow-steps').textContent());
await record('ah', ['noise']);
d = await dbg();
const failText = await page.locator('.pm-fail').textContent().catch(() => '');
check('A recording with no pitch (noise) is explained right there, with “Try again”, and nothing is saved', d.flow.step === 'record' && d.flow.ok === false && /couldn’t be analyzed/.test(failText) && /pitch/.test(failText) && (await page.locator('.pm-add .pm-rec').textContent()).includes('Try again') && d.project.sounds.length === 0, failText.slice(0, 160));
await record(null, [196, 'ah']);
d = await dbg();
check('Try again with a steady sung “ah” (simulated 196 Hz) moves on to step 2 (Listen)', d.flow.step === 'listen' && /Listen/.test(await flowStep()) && d.project.sounds.length === 1 && sound(d, 'ah').place === null && Math.abs(sound(d, 'ah').analysis.f0 - 196) < 2, `f0 ${sound(d, 'ah').analysis.f0} Hz; in the library, not on the map yet`);
const heard = await page.locator('.pm-heard').textContent();
check('Listen step says what was measured and what will be synthesized', /What the app measured/.test(heard) && /harmonics stood out/.test(heard) && /48 sine waves/.test(heard), heard.slice(0, 140) + '…');
await page.locator('.pm-add .pm-orig').click(); await wait(200);
const origKind = (await dbg()).audio.kind;
await page.locator('.pm-add .pm-synth').click(); await wait(200);
d = await dbg();
check('▶ Original recording and ▶ Synthesized version both play', origKind === 'original' && d.audio.kind === 'synth' && Math.abs(d.audio.params.f0 - 196) < 2, `${origKind}, then ${d.audio.kind} ${d.audio.params && d.audio.params.f0} Hz`);
await wait(1700);
await page.locator('.pm-add .pm-to-place').click();
d = await dbg();
check('Step 3 (Place) offers two choices: click a spot, or use my current pose', d.flow.step === 'place' && /Place/.test(await flowStep()) && await page.locator('.pm-add .pm-click-btn').count() === 1 && await page.locator('.pm-add .pm-pose-btn').count() === 1);
await page.locator('.pm-add .pm-click-btn').click();
d = await dbg();
const hint = await page.locator('.pm-map-hint').textContent();
check('“Click a spot on the map” turns on placement mode with an instruction', d.mode === 'place' && /Placement mode: click where you want “ah”/.test(hint) && await page.locator('svg.pm-square.placing').count() === 1 && !d.emptyShown, hint);
await page.getByRole('button', { name: 'Cancel placement' }).first().click();
d = await dbg();
check('Cancel placement leaves placement mode; the recording is kept and can still be placed', d.mode === 'play' && d.flow.step === 'place' && /cancelled/.test(d.flow.placeMsg) && d.project.sounds.length === 1 && d.onMap.length === 0, d.flow.placeMsg);
await page.locator('.pm-add .pm-click-btn').click();
await page.keyboard.press('Escape');
d = await dbg();
check('Esc also cancels placement', d.mode === 'play' && d.flow.step === 'place');
await page.locator('.pm-add .pm-click-btn').click();
await clickMap(0.1, 0.5);
d = await dbg();
const ahDot = d.onMap.find((a) => a.name === 'ah');
const ready = await page.locator('.pm-add .pm-howto').textContent().catch(() => '');
check('Clicking places it: labelled dot on the map, step 4 (Ready) says it is ready to play', ahDot && Math.abs(ahDot.pos.x - 0.1) < 0.01 && Math.abs(ahDot.pos.y - 0.5) < 0.01 && sound(d, 'ah').place.placedBy === 'click' && d.flow.step === 'ready' && /Ready/.test(await flowStep()) && /“ah” is on the map and ready to play/.test(ready) && (await page.locator('svg.pm-square .pm-anchors').textContent()).includes('ah') && !d.emptyShown, ready.slice(0, 160));

// ── 5. second sound by pose: countdown → ring shows where it lands → confirm ──
await page.locator('.pm-add .pm-add-another').click();
await record('ee', [300, 'ee']);
await page.locator('.pm-add .pm-to-place').click();
const EE = { bend: 0.9 * 115 + 15, lift: 0.5 * 105 + 15 }; // right edge, same height as "ah"
await pose(EE);
await page.locator('.pm-add .pm-pose-btn').click();
await wait(400);
d = await dbg();
check('“Use my current pose” counts down first', d.busy && /Step back/.test(d.countdown), JSON.stringify(d.countdown));
await notBusy();
d = await dbg();
const confirmText = await page.locator('.pm-confirm').textContent().catch(() => '');
check('After the countdown a dashed ring shows where the pose lands, and asks to confirm', d.flow.step === 'confirm' && d.pending && Math.abs(d.pending.bend - EE.bend) < 0.6 && Math.abs(d.pending.lift - EE.lift) < 0.6 && await page.locator('.pm-pending-ring').count() === 1 && /lands at the dashed ring/.test(confirmText) && sound(d, 'ee').place === null, confirmText.slice(0, 150));
await page.screenshot({ path: shots + 'motion-01-confirm-pose.png' });
await page.locator('.pm-add .pm-confirm-btn').click();
d = await dbg();
check('“Put it here” places “ee” at that pose (step Ready)', d.flow.step === 'ready' && sound(d, 'ee').place.placedBy === 'pose' && Math.abs(sound(d, 'ee').place.angles.bend - EE.bend) < 0.6 && d.onMap.length === 2 && await page.locator('.pm-pending-ring').count() === 0);
// pose with tracking lost: nothing placed, joint named, can retry
await page.locator('.pm-add .pm-redo-pos').click();
await pose({ ...EE, hide: 14 });
await page.locator('.pm-add .pm-pose-btn').click();
await notBusy();
d = await dbg();
check('If tracking drops during the pose hold, nothing moves, the joint is named and you can retry', d.flow.step === 'place' && /right elbow/.test(d.flow.placeMsg) && Math.abs(sound(d, 'ee').place.angles.bend - EE.bend) < 0.6 && await page.locator('.pm-add .pm-pose-btn').isEnabled(), d.flow.placeMsg);
await pose(EE);
await page.locator('.pm-add button', { hasText: 'Close' }).click();
d = await dbg();
check('Closing the panel mid-placement never gets stuck (back to play mode, nothing pending)', !d.flow && d.mode === 'play' && !d.pending && !d.busy);

// ── 6. play: ah on the left, ee on the right ──
await page.getByRole('button', { name: /Start sound/ }).click();
const AH = sound(d, 'ah').place.angles;
await pose(AH); await wait(600);
const atAh = await dbg();
await pose(EE); await wait(600);
const atEe = await dbg();
await pose({ bend: (AH.bend + EE.bend) / 2, lift: AH.lift }); await wait(600);
const mid = await dbg();
check('Holding the “ah” pose plays ah (196 Hz, 100 %); the “ee” pose plays ee (300 Hz)', topGroup(atAh).name === 'ah' && topGroup(atAh).weight > 0.98 && near(f(atAh), 196, 10) && topGroup(atEe).name === 'ee' && near(f(atEe), 300, 10), `${f(atAh).toFixed(1)} Hz / ${f(atEe).toFixed(1)} Hz`);
check('Bending only the right elbow halfway glides between them (marker stays at the same height)', mid.groups.length === 2 && Math.abs(mid.groups[0].weight - 0.5) < 0.05 && f(mid) > 196 && f(mid) < 300 && Math.abs(mid.dot.y - atAh.dot.y) < 0.01, mid.groups.map((g) => `${g.name} ${(g.weight * 100).toFixed(0)} %`).join(', ') + `, ${f(mid).toFixed(1)} Hz`);
const sumW = mid.groups.reduce((s, g) => s + g.weight, 0);
const pct = await page.locator('.pm-weights').textContent();
check('Contribution percentages add up to 100 % and are shown', Math.abs(sumW - 1) < 1e-6 && /ah/.test(pct) && /ee/.test(pct) && /%/.test(pct), pct);
check('Shown f0 and harmonics are what the synth is playing', mid.audio.kind === 'synth' && Math.abs(mid.audio.params.f0 - f(mid)) < 0.5 && mid.audio.params.amps.every((a, i) => Math.abs(a - mid.blend.params.amps[i]) < 1e-6) && mid.shown.f0.includes(mid.audio.params.f0.toFixed(0).slice(0, 3)), `${mid.shown.f0} (synth ${mid.audio.params.f0.toFixed(1)} Hz)`);
await page.screenshot({ path: shots + 'motion-02-two-sounds.png' });

// tracking drop while playing
await pose({ ...EE, hide: 16 });
await wait(900);
d = await dbg();
check('Losing the right wrist names it and fades the sound', !d.tracking && /right wrist/.test(d.lostText) && d.gate < 0.05, d.lostText);
await pose(EE); await wait(600);
d = await dbg();
check('Sound comes back when the joint returns', d.tracking && d.gate > 0.9);
await page.getByRole('button', { name: /Stop sound/ }).click();

// redo position from the library (no re-recording)
await page.locator(`.pm-row[data-id="${sound(d, 'ah').id}"] .pm-place`).click();
d = await dbg();
check('“Redo position” from Your recordings goes straight to Place', d.flow && d.flow.step === 'place' && d.flow.name === 'ah');
await page.locator('.pm-add .pm-click-btn').click();
await clickMap(0.1, 0.8);
d = await dbg();
check('The same sound moves to the new spot (no duplicate)', d.project.sounds.filter((s) => s.name === 'ah').length === 1 && Math.abs(d.onMap.find((a) => a.name === 'ah').pos.y - 0.8) < 0.01);
await page.locator('.pm-add button', { hasText: 'Done' }).click();

// ── 7. Draw + record ──
await page.getByRole('button', { name: /Draw \+ record/ }).click();
await page.waitForFunction(() => window.__poseMap.debug().micListening, null, { timeout: 5000 });
check('Draw + record opens the microphone and stops the map sound', (await dbg()).mode === 'draw' && !(await dbg()).soundOn);
async function drawTake({ aSec, bSec, a, b, yMid = 0.3 }) {
  box = await mapBox();
  const curve = (x) => yMid + 0.12 * Math.sin((x - 0.1) * 2 * Math.PI * 1.25);
  await page.evaluate(([fq, r]) => window.__fakeVoice.set(fq, r), a);
  await wait(150);
  await page.mouse.move(...toPx(0.2, curve(0.2)));
  await page.mouse.down();
  const seg = async (x0, x1, sec, snd) => {
    if (snd) await page.evaluate(([fq, r]) => window.__fakeVoice.set(fq, r), snd);
    const t0 = Date.now();
    for (;;) {
      const u = Math.min(1, (Date.now() - t0) / (sec * 1000));
      const x = x0 + u * (x1 - x0);
      await page.mouse.move(...toPx(x, curve(x)));
      if (u >= 1) break;
      await wait(12);
    }
  };
  await seg(0.2, 0.4, aSec, null);
  await seg(0.4, 0.85, bSec, b);
  await page.mouse.up();
  await page.evaluate(() => window.__fakeVoice.set(0));
  await page.waitForFunction(() => !window.__poseMap.debug().drawing && /learned \d+ point/.test(window.__poseMap.debug().drawStatus), null, { timeout: 20000 });
}
const calDraw = (await dbg()).project.cal;
await drawTake({ aSec: 1.6, bSec: 0.9, a: [150, 'ah'], b: [250, 'ee'] });
d = await dbg();
const take1 = d.project.takes[0];
const xOf = (p) => (p.bend - calDraw.bend.lo) / (calDraw.bend.hi - calDraw.bend.lo);
const A = take1.points.filter((p) => xOf(p) < 0.38);
const B = take1.points.filter((p) => xOf(p) > 0.43);
check('Take 1 stored with learned points', take1.points.length >= 12, `${take1.points.length} of ${take1.stats.snippets} snippets`);
check('Points drawn slowly during the 150 Hz part have f0 ≈ 150 Hz; fast 250 Hz part ≈ 250 Hz (matched by time)', A.length >= 6 && A.every((p) => near(p.f0, 150, 60)) && B.length >= 3 && B.every((p) => near(p.f0, 250, 60)) && A.length / take1.points.length > 0.5, `${A.length} slow / ${B.length} fast points`);
check('After the take, it says the dots are synthesized sounds reconstructed from the recording, and how to play it', /synthesized sound reconstructed/.test(d.drawStatus) && /start at/.test(d.drawStatus), d.drawStatus.slice(0, 220));
check('Takes list labels its points as reconstructed, not the recording', /synthesized sounds reconstructed from your recording/.test(await page.locator('.pm-take-list').textContent()));
await page.screenshot({ path: shots + 'motion-03-take.png' });
await page.getByRole('button', { name: /Draw \+ record/ }).click();
await page.locator('.pm-take-row .pm-replay').first().click();
const seen = [];
for (let i = 0; i < 30; i++) { await wait(100); const x = await dbg(); if (x.blend.params) seen.push(x.blend.params.f0); }
check('“▶ Preview along the line” glides from the first sound to the second', Math.min(...seen) < 175 && Math.max(...seen) > 220, `${Math.min(...seen).toFixed(0)}–${Math.max(...seen).toFixed(0)} Hz`);
await wait(600);
await page.getByRole('button', { name: /Start sound/ }).click();
const p1 = take1.points[1];
await pose({ bend: p1.bend, lift: p1.lift }); await wait(600);
d = await dbg();
check('Playing the take with the arms: its start pose plays its first sound, listed as “Take 1 (drawn)”', topGroup(d).name === 'Take 1 (drawn)' && near(f(d), p1.f0, 30), `${topGroup(d).name} ${(topGroup(d).weight * 100).toFixed(0)} %, ${f(d).toFixed(0)} Hz`);
await page.getByRole('button', { name: /Stop sound/ }).click();
await page.getByRole('button', { name: /Draw \+ record/ }).click();
await page.waitForFunction(() => window.__poseMap.debug().micListening);
await drawTake({ aSec: 0.8, bSec: 0.8, a: [220, 'ee'], b: [180, 'ah'], yMid: 0.15 });
await page.getByRole('button', { name: /Undo last take/ }).click();
d = await dbg();
check('Undo removes only the latest take; recordings and placed sounds stay', d.project.takes.length === 1 && d.project.takes[0].id === take1.id && d.onMap.length === 2);
await page.getByRole('button', { name: /Draw \+ record/ }).click();

// ── 8. Clear map ──
dialogAnswer = false; dialogs = [];
await page.locator('.pm-clear-btn').click();
d = await dbg();
check('Clear map asks first; saying no changes nothing', dialogs.length === 1 && /Your recordings are kept/.test(dialogs[0]) && d.onMap.length === 2 && !d.project.takes[0].hidden, dialogs[0] && dialogs[0].replace(/\s+/g, ' '));
dialogAnswer = true;
await page.locator('.pm-clear-btn').click();
d = await dbg();
check('Clear map (confirmed) removes every placed sound and take from the map', d.onMap.length === 0 && d.project.takes.every((t) => t.hidden) && d.blend.weights.length === 0 && d.emptyShown, d.mapMsg);
check('…but keeps the recordings, ready to place again', d.project.sounds.length === 2 && d.project.takes.length === 1 && await page.locator('.pm-sounds .pm-place', { hasText: 'Place on map' }).count() === 2 && await page.locator('.pm-take-toggle', { hasText: 'Put back on map' }).count() === 1);
await page.screenshot({ path: shots + 'motion-04-cleared.png' });
await page.locator(`.pm-row[data-id="${sound(d, 'ee').id}"] .pm-place`).click();
await page.locator('.pm-add .pm-click-btn').click();
await clickMap(0.85, 0.5);
await page.locator('.pm-take-toggle').click();
d = await dbg();
check('A cleared recording and a take can be put back on the map', d.onMap.length === 1 && d.onMap[0].name === 'ee' && !d.project.takes[0].hidden);
await page.locator('.pm-add button', { hasText: 'Done' }).click();
dialogs = [];
await page.locator(`.pm-row[data-id="${sound(d, 'ah').id}"] .pm-del-rec`).click();
d = await dbg();
check('🗑 Delete recording (confirmed) removes that recording only', dialogs.length === 1 && /cannot be undone/.test(dialogs[0]) && d.project.sounds.length === 1 && d.project.sounds[0].name === 'ee' && d.onMap.length === 1);
await page.locator('.pm-clear-btn').click();
await page.locator('.pm-add-btn').click();
await record('oo', [260, 'hum']);
await page.locator('.pm-add .pm-to-place').click();
await page.locator('.pm-add .pm-click-btn').click();
await page.locator('.pm-add button', { hasText: 'Close' }).click();
d = await dbg();
check('Closing the panel in placement mode keeps the new recording (unplaced) and leaves placement mode', !d.flow && d.mode === 'play' && sound(d, 'oo') && sound(d, 'oo').place === null && d.emptyShown);
await page.locator(`.pm-row[data-id="${sound(d, 'oo').id}"] .pm-place`).click();
await page.locator('.pm-add .pm-click-btn').click();
await clickMap(0.2, 0.2);
await page.locator(`.pm-row[data-id="${sound(d, 'ee').id}"] .pm-place`).click();
await page.locator('.pm-add .pm-click-btn').click();
await clickMap(0.8, 0.8);
await page.locator('.pm-add button', { hasText: 'Done' }).click();

// ── 9. range ──
d = await dbg();
const ooPose = sound(d, 'oo').place.angles;
const rangeTxt = await page.locator('.pm-range').textContent();
check('Range instructions use the same axis words (straighter/more bent arm, arm down/raised)', /RIGHT elbow/.test(rangeTxt) && /LEFT arm/.test(rangeTxt) && /straighter arm/.test(rangeTxt) && /more bent arm/.test(rangeTxt) && /arm down/.test(rangeTxt) && /arm raised/.test(rangeTxt));
const dotsBefore = d.onMap;
await page.getByRole('button', { name: /Adjust to my movement/ }).click();
await wait(3200);
const t0 = Date.now();
while (Date.now() - t0 < 6000) { const u = (Date.now() - t0) / 6000; await pose({ bend: 40 + 75 * (0.5 - 0.5 * Math.cos(u * 6 * Math.PI)), lift: 25 + 95 * (0.5 - 0.5 * Math.cos(u * 4 * Math.PI)) }); await wait(30); }
await notBusy();
d = await dbg();
check("Adjust estimates the range I actually used", d.project.calSource === 'adjusted' && Math.abs(d.project.cal.bend.lo - 40) < 6 && Math.abs(d.project.cal.bend.hi - 115) < 6 && Math.abs(d.project.cal.lift.lo - 25) < 6 && Math.abs(d.project.cal.lift.hi - 120) < 6, JSON.stringify(d.project.cal));
const movedOo = Math.hypot(dotsBefore.find((a) => a.name === 'oo').pos.x - d.onMap.find((a) => a.name === 'oo').pos.x, dotsBefore.find((a) => a.name === 'oo').pos.y - d.onMap.find((a) => a.name === 'oo').pos.y);
await page.getByRole('button', { name: /Start sound/ }).click();
await pose(ooPose); await wait(600);
const ooAfter = await dbg();
check('After adjusting, dots move but the same pose still plays the same sound', movedOo > 0.03 && topGroup(ooAfter).name === 'oo' && near(f(ooAfter), 260, 10), `oo dot moved ${movedOo.toFixed(3)}; ${f(ooAfter).toFixed(1)} Hz`);
await page.getByRole('button', { name: /Stop sound/ }).click();
await page.getByRole('button', { name: /Undo range change/ }).click();

// reload
const keep = JSON.stringify((await dbg()).project);
await page.reload();
await page.waitForFunction(() => window.__poseMap);
await page.evaluate(() => { window.__feedOn = true; });
d = await dbg();
check('After reload: recordings, placements, take and range are kept', JSON.stringify(d.project) === keep && d.onMap.length === 2);
check('After reload: ▶ Original is still available (audio stored in this browser)', await page.locator('.pm-row[data-id] button', { hasText: 'Original' }).count() >= 1);

// ── 10. tour ──
const before = JSON.stringify(d.project);
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
const titles = steps.map((s) => s.title);
const order = ['An empty map to fill with your sounds', '1. Record', '2. Listen', '3. Place: click a spot or use your pose', '4. Ready', 'Bend only your right elbow', 'Lift only your left arm', 'Both arms together', 'Optional: adjust to my movement', 'Clear map, keep recordings'];
check('Tour starts at the empty board, then record → listen → place → ready, each arm alone, then both, range, Clear map', order.every((t, i) => titles.indexOf(t) >= 0 && (i === 0 || titles.indexOf(t) > titles.indexOf(order[i - 1]))) && titles[0] === order[0], titles.join(' → '));
check('Every tour step highlights a real control', steps.every((s) => s.hole), steps.filter((s) => !s.hole).map((s) => s.title).join(', ') || `all ${steps.length} highlighted`);
await page.locator('.tour-pop').getByRole('button', { name: /Back/ }).click();
check('Back goes to the previous step', (await page.locator('.tour-title').textContent()) === titles[titles.length - 2]);
await page.locator('.tour-pop').getByRole('button', { name: 'Next →' }).click();
await page.locator('.tour-pop').getByRole('button', { name: 'Done' }).click();
d = await dbg();
check('The tour did not record, place, clear or play anything', !d.tourOpen && JSON.stringify(d.project) === before && !d.soundOn && !d.busy);
await page.locator('.pm-add button', { hasText: 'Close' }).click().catch(() => {});

// phone width
await page.setViewportSize({ width: 390, height: 844 });
await wait(300);
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
check('Phone width (390 px): no horizontal page scroll', sw <= 392, `scrollWidth ${sw}`);
await page.locator('svg.pm-square').scrollIntoViewIfNeeded();
await page.screenshot({ path: shots + 'motion-05-phone.png' });
await page.setViewportSize({ width: 1440, height: 1300 });

// empty-board screenshot (fresh project)
await page.evaluate(() => { window.__feedOn = false; localStorage.removeItem('poseMap.project.v1'); });
await page.reload();
await page.waitForFunction(() => window.__poseMap);
await page.screenshot({ path: shots + 'motion-00-empty.png' });

// real camera + MediaPipe on Chromium's fake camera (no person)
await page.getByRole('button', { name: /Enable camera/ }).click();
const camOk = await page.waitForFunction(() => ['running', 'error'].includes(window.__poseMap.debug().camera), null, { timeout: 60000 }).then(() => true).catch(() => false);
await wait(2500);
d = await dbg();
check('Real camera + MediaPipe pose model load and run', camOk && d.camera === 'running' && d.fps > 0, `${d.cameraMsg} ${d.fps} frames/s`);
check('With no person in view (test pattern), nothing is tracked', !d.tracking && /No person|No camera frames|Lost/.test(d.lostText), d.lostText);

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

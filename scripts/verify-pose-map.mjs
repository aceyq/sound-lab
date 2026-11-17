// Automated browser checks for the Pose Sound Map (capstone part 3):
// right elbow bend = vowel, head tilt (relative to the shoulders) = pitch.
// Usage: node scripts/copy-mediapipe.mjs && npx vite --port 5191, then:
//   node scripts/verify-pose-map.mjs http://localhost:5191/
// Needs the `playwright` package.
//
// SIMULATED INPUT. Nobody stands in front of a camera here:
//   • Body landmarks are generated (a stick figure whose elbow bend, head tilt,
//     sideways shift and lean are set by the script) and fed through the
//     page's own pose handler (window.__poseMap.feed), the function the
//     camera tracker calls with MediaPipe's output.
//   • The real MediaPipe model is also started on Chromium's fake camera
//     (a test pattern, no person) to check that it loads and tracks nothing.
//   • The microphone is a synthetic 233 Hz harmonic tone.
// Sound is checked through the synthesizer's own state (its f0, harmonic
// strengths and oscillator targets), not by ear.
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 1, permissions: ['camera', 'microphone'] });

const vmAmps = Array.from({ length: 48 }, (_, i) => (i < 8 ? [0.4, 1, 0.7, 0.3, 0.2, 0.1, 0.05, 0.02][i] : 0));
const vmProject = { format: 'vowel-morph.project', version: 1, takes: [], pair: { a: null, b: null }, slider: 0, pitchMode: 'blend', space: { power: 2, point: { x: 0.5, y: 0.5 } },
  vowels: [{ id: 'vm-mine', name: 'My Uu', recordingId: null, segment: null, pos: { x: 0.3, y: 0.3 }, analysis: { status: 'ok', f0: 260, f0Auto: 260, f0Source: 'automatic', amps: vmAmps, sampleRate: 48000, warnings: [], problems: [], facts: {} } }] };

await context.addInitScript((vm) => {
  if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vowelMorph.project.v1', JSON.stringify(vm)); sessionStorage.setItem('seeded', '1'); }
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.video) return real(c); // Chromium's fake camera
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 233;
    o.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(8), Float32Array.from([0, 1, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05])));
    const g = ctx.createGain(); g.gain.value = 0.25;
    const d = ctx.createMediaStreamDestination();
    o.connect(g).connect(d); o.start();
    return d.stream;
  };
  // Stick figure (image coordinates, camera not mirrored).
  window.__body = ({ bend = 10, tilt = 0, shiftX = 0, lean = 0, hide = null } = {}) => {
    const D = Math.PI / 180;
    const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
    const rot = (x, y, cx, cy, a) => ({ x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) });
    const L = (x, y) => rot(x, y, 0.5, 0.75, lean * D);
    const set = (i, p) => { lms[i] = { x: p.x + shiftX, y: p.y, z: 0, visibility: 0.99 }; };
    set(12, L(0.40, 0.40)); set(11, L(0.60, 0.40));
    const neck = L(0.5, 0.38);
    const H = (x, y) => { const q = L(x, y); return rot(q.x, q.y, neck.x, neck.y, tilt * D); };
    set(8, H(0.46, 0.27)); set(7, H(0.54, 0.27)); set(0, H(0.5, 0.29));
    set(14, L(0.40, 0.55)); set(16, L(0.40 + 0.15 * Math.sin(bend * D), 0.55 + 0.15 * Math.cos(bend * D)));
    if (hide != null) lms[hide].visibility = 0.05;
    return lms;
  };
  window.__pose = { bend: 10, tilt: 0 };
  window.__feedOn = false;
  // During guided calibration, act out whatever pose the countdown asks for.
  window.__autoCal = false;
  window.__feedTimer = setInterval(() => {
    if (!window.__feedOn || !window.__poseMap) return;
    if (window.__autoCal) {
      const t = document.querySelector('.pm-countdown')?.textContent || '';
      if (/Arm straight/.test(t)) window.__pose = { bend: 6, tilt: 2 };
      else if (/Elbow bent/.test(t)) window.__pose = { bend: 128, tilt: 2 };
      else if (/Head upright/.test(t)) window.__pose = { bend: 60, tilt: 2 };
      else if (/LOW/.test(t)) window.__pose = { bend: 60, tilt: -18 };
      else if (/HIGH/.test(t)) window.__pose = { bend: 60, tilt: 24 };
    }
    window.__poseMap.feed({ landmarks: window.__body(window.__pose), world: null, width: 480, height: 480, t: performance.now() });
  }, 33);
}, vmProject);

const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
const dbg = () => page.evaluate(() => window.__poseMap.debug());
const wait = (ms) => page.waitForTimeout(ms);
const pose = (p) => page.evaluate((q) => { window.__pose = { bend: 10, tilt: 0, ...q }; }, p);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
// The angles are smoothed (80 ms time constant), so after a pose change wait
// until they have settled (0.7 s leaves < 0.02 % of the change) before comparing.
const SETTLE = 700;
const sameAmps = (a, b, tol = 1e-9) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const vstr = (x) => x.blend.vowelShares.map((v) => `${Math.round(v * 100)}`).join('/');

await page.goto(url + '#/pose-map');
await page.waitForFunction(() => window.__poseMap);
let d = await dbg();
check('Starter map: “ah”, “ee”, “oo” columns × low/middle/high rows', d.project.columns.map((c) => c.name).join(',') === 'ah,ee,oo' && d.project.rows.map((r) => Math.round(r.f0)).join(',') === '165,220,294', `rows ${d.project.rows.map((r) => r.f0).join(' / ')} Hz`);
check('Same harmonic balance in every row of a column (one amps array per vowel)', d.project.columns.every((c) => c.amps.length === 48));

await page.evaluate(() => { window.__feedOn = true; });
await pose({ bend: 10, tilt: 0 });
await wait(500);
await page.getByRole('button', { name: /Start sound/ }).click();
await wait(400);
d = await dbg();
check('Tracking elbow bend and head tilt from simulated landmarks', d.tracking && near(d.angles.bend, 10, 0.5) && near(d.angles.tilt, 0, 0.5), `elbow ${d.angles.bend.toFixed(1)}°, head ${d.angles.tilt.toFixed(1)}°`);
check('Start pose = “ah”, middle pitch (220 Hz)', near(d.audio.params.f0, 220, 0.01) && d.blend.vowelShares[0] === 1, `${d.audio.params.f0} Hz, vowels ${vstr(d)}`);

// ── 1. elbow alone (head still) ──
const elbow = [];
for (const bend of [10, 30, 50, 65, 80, 100, 120]) { await pose({ bend, tilt: 0 }); await wait(SETTLE); elbow.push(await dbg()); }
const ef = elbow.map((x) => x.audio.params.f0);
check('Elbow alone: the pitch stays the same', ef.every((f) => near(f, 220, 0.05)), `f0 ${ef.map((f) => f.toFixed(2)).join(', ')} Hz`);
check('Elbow alone: the vowel mix moves ah → ee → oo', elbow[0].blend.vowelShares[0] === 1 && elbow[3].blend.vowelShares[1] > 0.95 && elbow[6].blend.vowelShares[2] === 1, elbow.map(vstr).join(' → '));
check('Elbow alone: the harmonic strengths change', !sameAmps(elbow[0].audio.params.amps, elbow[3].audio.params.amps, 0.01) && !sameAmps(elbow[3].audio.params.amps, elbow[6].audio.params.amps, 0.01));
await page.screenshot({ path: shots + 'pose-10-elbow.png' });

// ── 2. head alone (elbow still, between ah and ee) ──
const head = [];
for (const tilt of [-20, -10, -4, 0, 5, 12, 20]) { await pose({ bend: 37.5, tilt }); await wait(SETTLE); head.push(await dbg()); }
const hf = head.map((x) => x.audio.params.f0);
check('Head alone: the pitch moves low → middle → high', near(hf[0], 164.8, 0.05) && near(hf[3], 220, 0.05) && near(hf[6], 293.7, 0.05) && hf.every((f, i) => i === 0 || f > hf[i - 1]), `f0 ${hf.map((f) => f.toFixed(1)).join(' → ')} Hz`);
check('Head alone: the vowel mix stays the same', head.every((x) => sameAmps(x.blend.vowelShares, head[0].blend.vowelShares, 0.002)), head.map(vstr).join(', '));
check('Head alone: the harmonic strengths stay the same', head.every((x) => sameAmps(x.audio.params.amps, head[0].audio.params.amps, 0.002)));
await page.screenshot({ path: shots + 'pose-11-head.png' });

// ── sliding or leaning the whole body is not a head tilt ──
await pose({ bend: 37.5, tilt: 0, shiftX: 0.15 }); await wait(SETTLE);
const shifted = await dbg();
await pose({ bend: 37.5, tilt: 0, lean: 12 }); await wait(SETTLE);
const leaned = await dbg();
check('Shifting or leaning the whole body sideways does not change the pitch', near(shifted.angles.tilt, 0, 0.5) && near(leaned.angles.tilt, 0, 0.5) && near(shifted.audio.params.f0, 220, 0.05) && near(leaned.audio.params.f0, 220, 0.05),
  `head ${shifted.angles.tilt.toFixed(2)}° (shifted), ${leaned.angles.tilt.toFixed(2)}° (leaning 12°)`);

// ── displays match what is synthesized ──
const matches = [];
for (const [bend, tilt] of [[25, -7], [55, 9], [95, 15], [70, -15]]) {
  await pose({ bend, tilt }); await wait(SETTLE);
  const x = await dbg();
  const p = x.audio.params;
  const fOk = near(x.shown.f0, Math.round(p.f0 * 10) / 10, 0.051);
  const hOk = sameAmps(x.shown.harmonics, p.amps, 1e-6);
  const vOk = x.shown.vowels.every((v, i) => near(v.pct, Math.round(x.blend.vowelShares[i] * 100), 0.5) && near(v.width, x.blend.vowelShares[i] * 100, 0.01));
  const sumOk = near(x.shown.vowels.reduce((s, v) => s + v.width, 0), 100, 0.02);
  // The synth's own oscillators: harmonic n at n × f0, gains in proportion to the shown strengths.
  const t = x.audio.targets;
  const k = t[1].gain / p.amps[1];
  const oscOk = t.every((o, i) => near(o.freq, (i + 1) * p.f0, 1e-6) && (o.freq > 21600 || near(o.gain, p.amps[i] * k, 1e-9)));
  matches.push({ dbgV: `${JSON.stringify(x.shown.vowels.map((v) => [v.pct, v.width]))} vs ${JSON.stringify(x.blend.vowelShares)} ${vOk} ${sumOk}`, fOk, hOk, vOk, sumOk, oscOk, txt: `${x.shown.f0} Hz, ${x.shown.vowels.map((v) => `${v.name} ${v.pct}%`).join(' ')}` });
}
check('Displayed Hz matches the synth’s fundamental', matches.every((m) => m.fOk), matches.map((m) => m.txt).join(' | '));
check('Harmonic graph shows exactly the strengths the synth uses', matches.every((m) => m.hOk && m.oscOk));
check('Vowel percentages match the weights in the blend and add up to 100 %', matches.every((m) => m.vOk && m.sumOk), matches.map((m) => m.dbgV).join(' | '));

// ── held pose sustains ──
await pose({ bend: 55, tilt: 9 }); await wait(SETTLE);
const held = [];
for (let i = 0; i < 10; i++) { await wait(200); held.push(await dbg()); }
check('A held pose sustains one steady sound (2 s)', held.every((x) => x.soundOn && x.tracking && x.gate > 0.95 && near(x.audio.params.f0, held[0].audio.params.f0, 0.01) && x.audio.kind === 'synth'), `f0 ${held[0].audio.params.f0.toFixed(2)} Hz, gate ${held[9].gate.toFixed(2)}`);

// ── lost landmark ──
await pose({ bend: 55, tilt: 9, hide: 7 }); await wait(900);
d = await dbg();
check('Losing the left ear names it and fades the sound out', !d.tracking && /left ear/.test(d.lostText) && d.gate < 0.05, `${d.lostText} gate ${d.gate.toFixed(3)}`);
await page.screenshot({ path: shots + 'pose-12-lost.png' });
await pose({ bend: 55, tilt: 9 }); await wait(600);
d = await dbg();
check('Sound fades back in when it returns', d.tracking && d.gate > 0.9, `gate ${d.gate.toFixed(3)}`);

// ── 3. both together: the demo phrase ──
const phrase = [];
const snap = async (label) => { const x = await dbg(); phrase.push({ label, f0: x.audio.params.f0, v: x.blend.vowelShares }); };
await pose({ bend: 10, tilt: 0 }); await wait(SETTLE); await snap('ah, middle');
for (let b = 15; b <= 65; b += 5) { await pose({ bend: b, tilt: 0 }); await wait(120); }
await wait(SETTLE); await snap('glide to ee');
await pose({ bend: 65, tilt: 20 }); await wait(SETTLE); await snap('head tilt → high');
await wait(800); await snap('freeze');
await pose({ bend: 65, tilt: 0 }); await wait(SETTLE); await snap('head back');
for (let b = 60; b >= 10; b -= 5) { await pose({ bend: b, tilt: 0 }); await wait(120); }
await wait(SETTLE); await snap('back to ah');
const P = (i, f, vi) => near(phrase[i].f0, f, 0.1) && phrase[i].v[vi] > 0.995;
check('Demo phrase: ah → ee (same pitch) → ee high → freeze → reverse to ah', P(0, 220, 0) && P(1, 220, 1) && P(2, 293.7, 1) && P(3, 293.7, 1) && P(4, 220, 1) && P(5, 220, 0),
  phrase.map((p) => `${p.label}: ${['ah', 'ee', 'oo'][p.v.indexOf(Math.max(...p.v))]} ${p.f0.toFixed(1)} Hz`).join(' · '));

// ── guided calibration ──
await page.evaluate(() => { window.__autoCal = true; });
await page.getByRole('button', { name: /Calibrate \(guided/ }).click();
await wait(500);
d = await dbg();
check('Guided calibration shows the pose to make, with a countdown', d.busy && /1\/5 · Arm straight/.test(d.countdown), JSON.stringify(d.countdown));
await page.waitForFunction(() => !window.__poseMap.debug().busy, null, { timeout: 40000 });
await page.evaluate(() => { window.__autoCal = false; });
d = await dbg();
const cal = d.project.cal;
check('Guided calibration reads all five poses', near(cal.bend.lo, 6, 1) && near(cal.bend.hi, 128, 1) && near(cal.tilt.neutral, 2, 1) && near(cal.tilt.low, -18, 1) && near(cal.tilt.high, 24, 1), `${JSON.stringify(cal)} · ${d.calMsg}`);
check('It beeps at the start and end of each hold', d.beeps >= 10, `${d.beeps} beeps`);
await pose({ bend: 6, tilt: 2 }); await wait(SETTLE);
d = await dbg();
check('After calibrating: straight arm + upright head = “ah”, middle pitch', near(d.audio.params.f0, 220, 0.05) && d.blend.vowelShares[0] === 1);
await pose({ bend: 128, tilt: 24 }); await wait(SETTLE);
d = await dbg();
check('Fully bent + high tilt = “oo”, high pitch', near(d.audio.params.f0, 293.7, 0.05) && d.blend.vowelShares[2] === 1);

// ── customize sounds ──
await page.locator('.pm-customize summary').click();
await page.getByLabel('Name for your sound').fill('mmm');
await page.getByRole('button', { name: /Record \(up to/ }).click();
await page.waitForFunction(() => /Analyzed|No usable|failed|short/.test(document.querySelector('.pm-cust-msg').textContent), null, { timeout: 15000 });
d = await dbg();
check('Recording a hum analyzes it (simulated 233 Hz mic)', /Analyzed: f0 233/.test(d.custMsg), d.custMsg);
await page.getByRole('button', { name: '▶ Original' }).click(); await wait(200);
const o = await dbg();
await page.getByRole('button', { name: '▶ Synthesized' }).click(); await wait(200);
const s = await dbg();
check('You can hear the original and the synthesized version first', o.audio.kind === 'original' && s.audio.kind === 'synth' && near(s.audio.params.f0, 233, 1), `${o.audio.label} / ${s.audio.label}`);
await page.getByRole('button', { name: '+ Add as a new column' }).click(); await wait(300);
d = await dbg();
check('Add as a new column: ah, ee, oo, mmm', d.project.columns.map((c) => c.name).join(',') === 'ah,ee,oo,mmm' && !d.preview, d.custMsg);
await pose({ bend: 128, tilt: 2 }); await wait(SETTLE);
d = await dbg();
check('Fully bent now plays “mmm” at the middle-row pitch', d.blend.vowelShares[3] === 1 && near(d.blend.params.f0, 220, 0.05), `${vstr(d)}, ${d.blend.params.f0.toFixed(1)} Hz`);
await page.locator('.pm-vm-sel').selectOption('vm-mine');
await page.getByRole('button', { name: 'Use this vowel' }).click(); await wait(300);
await page.locator('.pm-candidate select').selectOption('1');
await page.getByRole('button', { name: 'Use for this column' }).click(); await wait(300);
d = await dbg();
check('A Vowel Morph vowel can replace a starter column (“ee” → “My Uu”)', d.project.columns.map((c) => c.name).join(',') === 'ah,My Uu,oo,mmm', d.custMsg);
await page.getByRole('button', { name: '↺ Back to starter sounds' }).click(); await wait(300);
d = await dbg();
check('“Back to starter sounds” restores ah, ee, oo', d.project.columns.map((c) => c.name).join(',') === 'ah,ee,oo');

// ── clap ──
await page.getByRole('button', { name: /Start sound/ }).click().catch(() => {});
await pose({ bend: 6, tilt: 2 }); await wait(SETTLE);
await page.getByLabel(/Clap on the final pose/).check();
await pose({ bend: 67, tilt: 24 }); await wait(1500); // ee, high: enter and hold
d = await dbg();
check('Clap fires once on reaching “ee, high” and stays quiet while held', d.claps === 1 && d.clapInside, `claps ${d.claps}`);
await pose({ bend: 67, tilt: 2 }); await wait(SETTLE);
await pose({ bend: 67, tilt: 24 }); await wait(SETTLE);
d = await dbg();
check('Leave and come back: claps again', d.claps === 2, `claps ${d.claps}`);
await page.getByLabel(/Clap on the final pose/).uncheck();

// ── tour ──
await page.getByRole('button', { name: '🧭 Tour' }).click();
await wait(300);
const steps = [];
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => {
    const hole = document.querySelector('.tour-hole');
    const r = hole && !hole.hidden ? hole.getBoundingClientRect() : null;
    return { title: document.querySelector('.tour-title')?.textContent, hole: r && r.width > 20 && r.height > 20, next: document.querySelector('.tour-pop .btn.primary')?.textContent };
  });
  if (!st.title) break;
  steps.push(st);
  if (st.next === 'Done') break;
  await page.locator('.tour-pop').getByRole('button', { name: /Next/ }).click();
  await wait(150);
}
const want = ['Turn on the camera', 'Get in frame', 'Calibrate (guided)', 'Start the sound', 'Movement 1: the elbow alone', 'Read the vowel mix', 'Read the harmonics', 'Movement 2: the head alone', 'Both at once', 'The demo phrase'];
check('Tour follows the demo: camera, calibration, each movement alone, reading the bars, then together', want.every((t) => steps.some((x) => x.title === t)) && want.every((t, i) => i === 0 || steps.findIndex((x) => x.title === t) > steps.findIndex((x) => x.title === want[i - 1])), steps.map((x) => x.title).join(' → '));
check('Every tour step highlights a real control', steps.every((x) => x.hole), steps.filter((x) => !x.hole).map((x) => x.title).join(', ') || 'all highlighted');
check('Back / Next / Done', steps.length > 1 && steps[steps.length - 1].next === 'Done');
await page.locator('.tour-pop').getByRole('button', { name: /Back/ }).click();
check('Back goes to the previous step', (await page.locator('.tour-title').textContent()) === steps[steps.length - 2].title);
await page.locator('.tour-pop').getByRole('button', { name: 'Next →' }).click();
await page.locator('.tour-pop').getByRole('button', { name: 'Done' }).click();
d = await dbg();
check('Done closes the tour; it can be reopened and closed again', !d.tourOpen && await page.getByRole('button', { name: '🧭 Tour' }).click().then(() => dbg()).then((x) => x.tourOpen && x.tourStep === 0));
await page.screenshot({ path: shots + 'pose-13-tour.png' });
await page.locator('.tour-pop').getByRole('button', { name: 'Close' }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: shots + 'pose-14-page.png' });

// ── real camera + MediaPipe on Chromium's fake camera (no person) ──
await page.evaluate(() => { window.__feedOn = false; });
await page.reload();
await page.waitForFunction(() => window.__poseMap);
await page.getByRole('button', { name: /Enable camera/ }).click();
const camOk = await page.waitForFunction(() => ['running', 'error'].includes(window.__poseMap.debug().camera), null, { timeout: 60000 }).then(() => true).catch(() => false);
await wait(2500);
d = await dbg();
check('Real camera + MediaPipe pose model load from this site and run', camOk && d.camera === 'running' && d.fps > 0, `${d.cameraMsg} ${d.fps} frames/s`);
check('With no person in view (test pattern), nothing is tracked', !d.tracking && /No person|No camera frames|Lost/.test(d.lostText), `${d.lostText} (${d.fps} frames/s in headless Chromium)`);

// ── the other projects still open ──
for (const [route, sel] of [['#/vowel-morph', () => !!window.__vowelMorph], ['#/motion-score', () => /Motion Score/.test(document.querySelector('h1')?.textContent || '')], ['#/frequency', () => !!document.querySelector('h1')]]) {
  await page.goto(url + route);
  check(`${route} still opens`, await page.waitForFunction(sel, null, { timeout: 8000 }).then(() => true).catch(() => false));
}

check('No page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

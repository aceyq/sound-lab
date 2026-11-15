// Automated browser checks for drawn takes in Vowel Morph (capstone part 2).
// Usage: start the app (npx vite --port 5191), then:
//   node scripts/verify-drawn-take.mjs http://localhost:5191/
// Needs the `playwright` package.
//
// SIMULATED INPUT: no singing and no real microphone. getUserMedia is
// replaced by a synthetic "voice" (a harmonic oscillator in its own
// AudioContext) whose pitch and harmonic recipe the script switches at known
// times while it moves the mouse. The mouse moves SLOWLY during the first
// sound and FAST during the second, so a take aligned by time and a take
// spread evenly along the drawn length give different answers.
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

const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];

// A placed vowel that must survive undo.
const amps = Array.from({ length: 48 }, (_, i) => (i < 10 ? Math.round(1000 / (i + 1)) / 1000 : 0));
const ampsB = Array.from({ length: 48 }, (_, i) => (i < 6 ? [0.2, 1, 0.6, 0.3, 0.1, 0.05][i] : 0));
const seedProject = {
  format: 'vowel-morph.project', version: 1,
  vowels: [{ id: 'vm-seed', name: 'Seed Aa', recordingId: null, segment: null, pos: { x: 0.85, y: 0.85 },
    analysis: { status: 'ok', f0: 200, f0Auto: 200, f0Source: 'automatic', amps, sampleRate: 48000, warnings: [], problems: [], facts: {} } },
  { id: 'vm-seed-b', name: 'Seed Ee', recordingId: null, segment: null, pos: { x: 0.15, y: 0.95 },
    analysis: { status: 'ok', f0: 300, f0Auto: 300, f0Source: 'automatic', amps: ampsB, sampleRate: 48000, warnings: [], problems: [], facts: {} } }],
  takes: [], pair: { a: null, b: null }, slider: 0, pitchMode: 'blend', space: { power: 2, point: { x: 0.5, y: 0.5 } },
};

await context.addInitScript((proj) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem('vowelMorph.project.v1', JSON.stringify(proj));
    sessionStorage.setItem('seeded', '1');
  }
  // Synthetic microphone: an "ah"-like and an "ee"-like harmonic recipe.
  const RECIPES = {
    ah: [0, 0.5, 0.8, 1, 0.9, 0.5, 0.3, 0.2, 0.15, 0.1, 0.08, 0.06],
    ee: [0, 1, 0.3, 0.1, 0.05, 0.04, 0.03, 0.2, 0.3, 0.25, 0.1, 0.05],
  };
  let voice = null;
  const make = () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(g).connect(dest);
    osc.start();
    const waves = {};
    for (const [k, a] of Object.entries(RECIPES)) waves[k] = ctx.createPeriodicWave(new Float32Array(a.length), Float32Array.from(a), { disableNormalization: false });
    voice = { ctx, osc, g, dest, waves, log: [] };
    return voice;
  };
  window.__fakeVoice = {
    set(freq, recipe) {
      const v = voice || make();
      const now = v.ctx.currentTime;
      if (freq > 0) { v.osc.frequency.setValueAtTime(freq, now); v.osc.setPeriodicWave(v.waves[recipe || 'ah']); v.g.gain.setValueAtTime(0.25, now); } else v.g.gain.setValueAtTime(0, now);
      v.log.push({ ms: performance.now(), freq, recipe });
    },
    log: () => (voice ? voice.log : []),
  };
  // A fresh stream per request: the app stops the tracks when it closes the microphone.
  navigator.mediaDevices.getUserMedia = async () => {
    const v = voice || make();
    const dest = v.ctx.createMediaStreamDestination();
    v.g.connect(dest);
    return dest.stream;
  };
}, seedProject);

const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const dbg = () => page.evaluate(() => window.__vowelMorph.debug());

await page.goto(url + '#/vowel-morph');
await page.waitForFunction(() => window.__vowelMorph);
await page.getByRole('button', { name: /2D sound space/ }).click();
// ── part 1: clicking on and between the two placed vowels ──
let box = await page.locator('svg.vm-square').boundingBox();
const toPx = (x, y) => [box.x + x * box.width, box.y + (1 - y) * box.height];
await page.getByRole('button', { name: /Play \/ explore/ }).click();
await page.mouse.click(...toPx(0.85 + 0.01, 0.85 - 0.01)); // a few px off the dot centre
let d0 = await page.evaluate(() => window.__vowelMorph.debug());
check('Part 1: clicking a dot snaps onto it and plays its own f0 and harmonics exactly', d0.audio.kind === 'synth' && d0.audio.params.f0 === 200 && d0.audio.params.amps.every((a, i) => a === amps[i]), `f0 ${d0.audio.params && d0.audio.params.f0} Hz`);
await page.mouse.click(...toPx(0.5, 0.9)); // equally far from both dots
d0 = await page.evaluate(() => window.__vowelMorph.debug());
const wA = d0.blend.weights.find((w) => w.id === 'vm-seed').weight;
const wB = d0.blend.weights.find((w) => w.id === 'vm-seed-b').weight;
const expF0 = wA * 200 + wB * 300;
const expH2 = wA * amps[1] + wB * ampsB[1];
check('Part 1: between dots, f0 in Hz and each harmonic are blended with the same distance weights', Math.abs(d0.audio.params.f0 - expF0) < 1e-6 && Math.abs(d0.audio.params.amps[1] - expH2) < 1e-6,
  `weights ${(wA * 100).toFixed(1)} % / ${(wB * 100).toFixed(1)} % → f0 ${d0.audio.params.f0.toFixed(2)} Hz (expected ${expF0.toFixed(2)}), h2 ${d0.audio.params.amps[1].toFixed(3)} (expected ${expH2.toFixed(3)})`);
const voicesBefore = d0.audio.counters.voicesCreated;
await page.mouse.move(...toPx(0.84, 0.86));
await page.mouse.down();
const f0s = [];
for (let i = 1; i <= 10; i++) { await page.mouse.move(...toPx(0.84 - i * 0.069, 0.86 + i * 0.009)); f0s.push((await page.evaluate(() => window.__vowelMorph.debug())).audio.params.f0); }
await page.mouse.up();
d0 = await page.evaluate(() => window.__vowelMorph.debug());
check('Part 1: dragging from one dot to the other glides f0 smoothly with one continuous voice', f0s[0] < 210 && f0s[9] > 290 && f0s.every((f, i) => i === 0 || f >= f0s[i - 1] - 0.5) && d0.audio.counters.voicesCreated === voicesBefore,
  f0s.map((f) => f.toFixed(0)).join(' → '));
await page.getByRole('button', { name: /Stop sound/ }).click();
await page.screenshot({ path: shots + 'drawn-00-part1.png' });

await page.getByRole('button', { name: /Draw \+ record a take/ }).click();
await page.waitForFunction(() => window.__vowelMorph.debug().micListening, null, { timeout: 5000 });
check('Draw mode opens the microphone', (await dbg()).micListening);

/**
 * Draws a sine-shaped curve: phase A (sound A) slowly from x 0.1 → 0.3,
 * phase B (sound B) fast from x 0.3 → 0.9. Returns the wall-clock times.
 */
async function drawTake({ aSec, bSec, a, b, yMid = 0.45 }) {
  await page.locator('svg.vm-square').scrollIntoViewIfNeeded();
  box = await page.locator('svg.vm-square').boundingBox();
  const curve = (x) => yMid + 0.2 * Math.sin((x - 0.1) * 2 * Math.PI * 1.25);
  await page.evaluate(([f, r]) => window.__fakeVoice.set(f, r), a);
  await page.waitForTimeout(150);
  await page.mouse.move(...toPx(0.1, curve(0.1)));
  await page.mouse.down();
  const seg = async (x0, x1, sec, sound) => {
    if (sound) await page.evaluate(([f, r]) => window.__fakeVoice.set(f, r), sound);
    const t0 = Date.now();
    for (;;) {
      const u = Math.min(1, (Date.now() - t0) / (sec * 1000));
      const x = x0 + u * (x1 - x0);
      await page.mouse.move(...toPx(x, curve(x)));
      if (u >= 1) break;
      await page.waitForTimeout(12);
    }
  };
  await seg(0.1, 0.3, aSec, null);
  await seg(0.3, 0.9, bSec, b);
  await page.mouse.up();
  await page.evaluate(() => window.__fakeVoice.set(0));
  await page.waitForFunction(() => !window.__vowelMorph.debug().drawing && /usable point/.test(window.__vowelMorph.debug().drawStatus), null, { timeout: 20000 })
    .catch(async (e) => { { const z = await dbg(); console.log('errors:', errors.join(' / ')); console.log('drawStatus:', z.drawStatus, z.spaceMode, z.micListening, JSON.stringify(z.drawing), z.project.takes.length); } throw e; });
}

// Take 1: 150 Hz "ah" slowly, then 300 Hz "ee" fast.
await drawTake({ aSec: 1.6, bSec: 0.9, a: [150, 'ah'], b: [300, 'ee'] });
let d = await dbg();
const take1 = d.project.takes[0];
check('Take 1 was stored with learned points', take1 && take1.points.length >= 12, take1 ? `${take1.points.length} usable of ${take1.stats.snippets} snippets; status: ${d.drawStatus}` : 'no take');
const A = take1.points.filter((p) => p.x < 0.28);
const B = take1.points.filter((p) => p.x > 0.33);
const near = (f, g, cents = 60) => Math.abs(1200 * Math.log2(f / g)) < cents;
check('Points drawn slowly during the 150 Hz sound (x < 0.28) have f0 ≈ 150 Hz', A.length >= 6 && A.every((p) => near(p.f0, 150)), `${A.length} points: ${A.map((p) => p.f0.toFixed(0)).join(', ')}`);
check('Points drawn fast during the 300 Hz sound (x > 0.33) have f0 ≈ 300 Hz', B.length >= 3 && B.every((p) => near(p.f0, 300)), `${B.length} points: ${B.map((p) => p.f0.toFixed(0)).join(', ')}`);
// With equal spacing by path length, ~2/3 of the points would sit at x > 0.3,
// although 1.6 of the 2.5 s were sung at 150 Hz. Time alignment puts most
// points in the slow first part.
const share = A.length / take1.points.length;
check('Speed change: most points sit on the slowly drawn first part (time alignment, not even spacing)', share > 0.5, `${(share * 100).toFixed(0)} % of points at x < 0.28 (path length share of that part ≈ 25 %)`);
const strongest = (a) => a.indexOf(Math.max(...a)) + 1;
check('Harmonic recipe changes along the curve too (strongest harmonic differs)', A.length && B.length && strongest(A[1].amps) !== strongest(B[B.length - 1].amps), `A strongest h${strongest(A[1].amps)}, B strongest h${strongest(B[B.length - 1].amps)}`);
const tsOk = take1.points.every((p, i, arr) => i === 0 || p.t > arr[i - 1].t);
check('Learned points are in time order along the take', tsOk);
check('Take summary shows how many usable points', /Take 1: \d+ usable points? from \d+ snippets/.test(d.drawStatus), d.drawStatus);
await page.screenshot({ path: shots + 'drawn-01-take.png' });

// Play mode: clicking near a learned point plays a blend dominated by it.
await page.getByRole('button', { name: /Play \/ explore/ }).click();
const p0 = A[2];
box = await page.locator('svg.vm-square').boundingBox();
await page.mouse.click(...toPx(p0.x + 0.005, p0.y));
d = await dbg();
check('Clicking next to a learned point plays a sound close to its f0', d.audio.kind === 'synth' && near(d.blend.params.f0, p0.f0, 80), `point ${p0.f0.toFixed(1)} Hz → playing ${d.blend.params.f0.toFixed(1)} Hz`);
// Tracing the curve: replay along the path changes f0 from ~150 to ~300.
await page.getByRole('button', { name: /Replay along path/ }).first().click();
const seen = [];
for (let i = 0; i < 30; i++) { await page.waitForTimeout(100); const x = await dbg(); if (x.blend.params) seen.push(x.blend.params.f0); }
check('Replay along the path glides from the first sound to the second', Math.min(...seen) < 175 && Math.max(...seen) > 270, `f0 seen ${Math.min(...seen).toFixed(0)}–${Math.max(...seen).toFixed(0)} Hz`);
await page.getByRole('button', { name: /Stop sound/ }).click().catch(() => {});

// Take 2, then undo: only take 2 disappears.
await page.getByRole('button', { name: /Draw \+ record a take/ }).click();
await page.waitForFunction(() => window.__vowelMorph.debug().micListening);
await drawTake({ aSec: 0.8, bSec: 0.8, a: [220, 'ee'], b: [180, 'ah'], yMid: 0.7 });
d = await dbg();
check('Second take added (after closing and reopening the microphone)', d.project.takes.length === 2 && d.project.takes[1].points.length >= 8, `${d.project.takes.length} takes, take 2 has ${d.project.takes[1] && d.project.takes[1].points.length} points`);
await page.screenshot({ path: shots + 'drawn-02-two-takes.png' });
await page.getByRole('button', { name: /Undo last take \(Take 2\)/ }).click();
d = await dbg();
check('Undo removes only the latest take', d.project.takes.length === 1 && d.project.takes[0].id === take1.id, d.project.takes.map((t) => t.name).join(', '));
check('Undo keeps the placed vowels', d.project.vowels.length === 2 && d.project.vowels.every((v) => v.pos) && d.project.vowels[0].name === 'Seed Aa');
check('Only the latest take’s recording was deleted', d.recordings.length === 1 && d.recordings[0].id === take1.recordingId);

// Silence: a take with no voice yields no points and says so.
await drawTake({ aSec: 0.6, bSec: 0.4, a: [0, 'ah'], b: [0, 'ah'] });
d = await dbg();
const silentTake = d.project.takes[d.project.takes.length - 1];
check('A silent take keeps 0 points and reports skipped silent snippets', silentTake.points.length === 0 && silentTake.stats.silent > 0, d.drawStatus);
await page.getByRole('button', { name: /Undo last take/ }).click();

// Reload: takes persist.
await page.reload();
await page.waitForFunction(() => window.__vowelMorph);
d = await dbg();
check('Takes persist after reload', d.project.takes.length === 1 && d.project.takes[0].points.length === take1.points.length);
await page.getByRole('button', { name: /2D sound space/ }).click();
await page.screenshot({ path: shots + 'drawn-03-after-reload.png' });

check('No page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

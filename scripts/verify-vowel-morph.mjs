// Automated browser checks for Vowel Morph (tasks 3 and 4).
// Usage: start the app (npx vite --port 5181), then:
//   node scripts/verify-vowel-morph.mjs http://localhost:5181/
// Needs the `playwright` package.
//
// SIMULATED INPUT: no singing. Vowels are generated WAV files built like a
// voice (a harmonic source shaped by three resonances, slight pitch wobble,
// jitter and breath noise), imported with "Import WAV". One take is also
// "recorded" through Chromium's fake microphone, which plays a generated WAV
// file as if it were the microphone. Playback is checked through the app's
// state (oscillator targets), not by listening. None of this shows that real
// recorded vowels morph convincingly; that needs listening.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav, decodeWav } from '../src/pages/frequency/wav.js';
import { analyzeVowel } from '../src/pages/frequency/auto-vowel.js';

const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { playwright = require(p); break; } catch { /* try next */ }
}
if (!playwright) {
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}

const url = (process.argv[2] || 'http://localhost:5173/').replace(/#.*$/, '');
const shots = new URL('../verification/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

// ── simulated vowels ──
const SR = 48000;
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function vowelLike(f0, formants, sec = 3) {
  const amp = (f) => (1 / (1 + (f / 400) ** 2)) * formants.reduce((s, [fc, bw, g]) => s + g / Math.sqrt(1 + ((f - fc) / (bw / 2)) ** 2), 0.01);
  const N = Math.floor(9000 / f0);
  const A = Array.from({ length: N }, (_, i) => amp((i + 1) * f0));
  const top = Math.max(...A);
  const x = new Float32Array(Math.round(SR * sec));
  let ph = 0;
  let jit = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (i % 200 === 0) jit = (rnd() - 0.5) * 0.002;
    ph += (2 * Math.PI * f0 * (1 + 0.003 * Math.sin(2 * Math.PI * 4.5 * t) + jit)) / SR;
    let s = 0;
    for (let n = 1; n <= N; n++) s += A[n - 1] * Math.sin(n * ph + 0.7 * n * n);
    const env = Math.min(1, t / 0.15, (sec - t) / 0.15);
    x[i] = env * (0.3 * s / top) + (rnd() - 0.5) * 0.002;
  }
  return x;
}
const write = (name, x) => { const p = join(tmpdir(), name); writeFileSync(p, Buffer.from(encodeWav(x, SR).buffer)); return p; };
const aaPath = write('vm-aa-200.wav', vowelLike(200, [[730, 90, 1], [1090, 110, 0.5], [2440, 160, 0.2]]));
const ooPath = write('vm-oo-300.wav', vowelLike(300, [[300, 60, 1], [870, 90, 0.35], [2240, 120, 0.12]]));
const eePath = write('vm-ee-250.wav', vowelLike(250, [[270, 60, 1], [2290, 120, 0.4], [3010, 160, 0.25]]));
const micPath = write('vm-mic-220.wav', vowelLike(220, [[730, 90, 1], [1090, 110, 0.5], [2440, 160, 0.2]], 8));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const errors = [];
const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micPath}`],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['microphone'] });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const wait = (ms) => page.waitForTimeout(ms);
const dbg = () => page.evaluate(() => window.__vowelMorph.debug());
const download = async (locator) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
};
const same = (p, q) => p && q && p.f0 === q.f0 && p.amps.length === q.amps.length && p.amps.every((a, i) => a === q.amps[i]);
const paramsOf = (v) => ({ f0: v.analysis.f0, amps: v.analysis.amps });

await page.goto(url + '#/vowel-morph');
await page.waitForSelector('.vm-page');
await wait(300);
check('Vowel Morph has its own entry in the navigation and its own route', (await page.locator('.app-nav a[href="#/vowel-morph"]').innerText()).includes('Vowel Morph') &&
  (await page.locator('.app-nav a.active').innerText()).includes('Vowel Morph'));
let d = await dbg();
check('Nothing records or plays on page load (no audio context, no microphone)', d.audio.kind === 'idle' && d.audio.sampleRate === null && d.audio.counters.contexts === 0);
check('Starts with an empty, separate project', d.project.vowels.length === 0 && (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('vowelMorph')).length)) <= 1);

// ── Stage 1: import A and B ──
await page.locator('[data-slot="a"] input[type=file]').setInputFiles(aaPath);
await page.waitForFunction(() => window.__vowelMorph.debug().project.vowels.length === 1);
await page.locator('[data-slot="b"] input[type=file]').setInputFiles(ooPath);
await page.waitForFunction(() => window.__vowelMorph.debug().project.vowels.length === 2);
await wait(200);
d = await dbg();
const [va, vb] = d.project.vowels;
check('Imported takes are named from the name box (Aa, Oo) and assigned to A and B', va.name === 'Aa' && vb.name === 'Oo' && d.project.pair.a === va.id && d.project.pair.b === vb.id);
check('A analyzed: automatic f0 ≈ 200 Hz', va.analysis.f0Source === 'automatic' && Math.abs(va.analysis.f0 - 200) < 1.5, `${va.analysis.f0} Hz`);
check('B analyzed: automatic f0 ≈ 300 Hz', Math.abs(vb.analysis.f0 - 300) < 1.5, `${vb.analysis.f0} Hz`);
check('Both have a complete 48-harmonic representation', va.analysis.amps.length === 48 && vb.analysis.amps.length === 48);
check('Analysis summary is shown for each slot', (await page.locator('[data-slot="a"] .vm-sum').innerText()).includes('f0') && (await page.locator('[data-slot="b"] .vm-sum').innerText()).includes('automatic'));
const A = paramsOf(va);
const B = paramsOf(vb);

// ── slider ──
const slider = page.locator('.vm-slider');
await slider.fill('0');
d = await dbg();
check('Slider at the left end = exactly A’s analyzed parameters', same(d.slider, A));
await slider.fill('1000');
d = await dbg();
check('Slider at the right end = exactly B’s analyzed parameters', same(d.slider, B));
await slider.fill('500');
d = await dbg();
check('Slider midpoint: f0 = √(fA·fB) (equal semitones from each end)', Math.abs(d.slider.f0 - Math.sqrt(A.f0 * B.f0)) < 1e-9, `${d.slider.f0.toFixed(2)} Hz`);
check('Midpoint harmonic strengths = dB average (floor −60 dB)', d.slider.amps.every((a, i) => {
  const e = Math.sqrt(Math.max(1e-3, A.amps[i]) * Math.max(1e-3, B.amps[i]));
  return e <= 1e-3 * (1 + 1e-9) ? a === 0 : Math.abs(a - e) < 1e-12;
}));
check('Position and weights are shown', (await page.locator('.vm-morph .vm-pos').innerText()).includes('weight A 50 %'));
await page.screenshot({ path: join(shots, 'vowel-morph-1d.png'), fullPage: true });

// ── playback while dragging ──
await slider.fill('0');
await page.getByRole('button', { name: '▶ Play blend' }).click();
await wait(200);
d = await dbg();
check('Play starts one synthesized voice of 48 sine oscillators at A’s parameters', d.audio.kind === 'synth' && d.audio.oscillators === 48 && same(d.audio.params, A) && d.audio.counters.voicesCreated === 1);
check('Oscillator n is at n × f0', d.audio.targets.every((t, i) => Math.abs(t.freq - (i + 1) * A.f0) < 1e-9));
const rmsOf = (ts) => Math.sqrt(ts.reduce((s, t) => s + t.gain * t.gain, 0) / 2);
const rmsA = rmsOf(d.audio.targets);
let finite = true;
let restarts = 0;
let rmsSpread = 0;
for (let k = 0; k <= 1000; k += 25) {
  await slider.fill(String(k));
  await wait(15);
  d = await dbg();
  if (!d.audio.targets.every((t) => Number.isFinite(t.freq) && Number.isFinite(t.gain))) finite = false;
  if (d.audio.counters.voicesCreated !== 1) restarts++;
  rmsSpread = Math.max(rmsSpread, Math.abs(rmsOf(d.audio.targets) - rmsA));
}
check('Dragging A→B updates the same voice (no restarts) with finite values', finite && restarts === 0 && same(d.audio.params, B));
check('Loudness stays constant along the slider (RMS rule)', rmsSpread < 1e-9, `max RMS change ${rmsSpread.toExponential(1)}`);
await page.getByRole('button', { name: '■ Stop', exact: true }).click();
await wait(250);
d = await dbg();
check('Stop ends the sound and releases the voice', d.audio.kind === 'idle' && d.audio.counters.voicesDisposed === 1);

// ── original vs synthesized ──
await page.locator('[data-slot="a"] .vm-orig-btn').click();
await wait(100);
d = await dbg();
check('“▶ Original” plays the ORIGINAL recording (not the synth)', d.audio.kind === 'original' && d.audio.label.includes('ORIGINAL'));
await page.locator('[data-slot="a"] .vm-synth-btn').click();
await wait(100);
d = await dbg();
check('“▶ Synthesized” replaces it with the reconstruction (one sound at a time)', d.audio.kind === 'synth' && same(d.audio.params, A) && d.audio.counters.originalsStarted === 1);
await page.getByRole('button', { name: '■ Stop sound' }).click();

// ── download the blend ──
await slider.fill('500');
const blendDl = await download(page.getByRole('button', { name: '⬇ Download this blend (WAV)' }));
const wav = decodeWav(blendDl.data.buffer.slice(blendDl.data.byteOffset, blendDl.data.byteOffset + blendDl.data.byteLength));
const an = analyzeVowel(wav.samples, wav.sampleRate, { from: 24000, to: 96000 });
d = await dbg();
check('Downloaded blend WAV is the generated midpoint sound (analysis gives its f0)', blendDl.name === 'vowel-morph_slider_050.wav' && Math.abs(an.f0 - d.slider.f0) < 0.3, `${an.f0} Hz vs ${d.slider.f0.toFixed(2)} Hz`);

// ── manual correction ──
await page.locator('[data-slot="b"] .vm-adjust summary').click();
await page.fill('[data-slot="b"] input[aria-label^="Corrected fundamental"]', '150');
await page.locator('[data-slot="b"]').getByRole('button', { name: 'Re-measure at this f0' }).click();
await wait(300);
d = await dbg();
const vbm = d.project.vowels.find((v) => v.id === vb.id);
check('Manual f0 correction is applied, re-measured and labelled MANUAL', vbm.analysis.f0 === 150 && vbm.analysis.f0Source === 'manual' && (await page.locator('[data-slot="b"] .vm-manual').count()) === 1);
await page.locator('[data-slot="b"]').getByRole('button', { name: 'Back to automatic' }).click();
await wait(300);
d = await dbg();
check('“Back to automatic” restores the automatic analysis', same(paramsOf(d.project.vowels.find((v) => v.id === vb.id)), B));

// ── a real take through the (fake) microphone ──
await page.locator('[data-slot="a"]').getByRole('button', { name: /Record \(up to/ }).click();
await page.waitForFunction(() => window.__vowelMorph.debug().project.vowels.length === 3, null, { timeout: 15000 });
await wait(300);
d = await dbg();
const take2 = d.project.vowels[2];
check('Recording another take keeps the first one and adds “Aa (take 2)”', take2.name === 'Aa (take 2)' && d.project.vowels.some((v) => v.id === va.id) && d.project.pair.a === take2.id);
check('The recorded take (fake microphone playing a 220 Hz vowel) analyzes to ≈ 220 Hz', take2.analysis && Math.abs(take2.analysis.f0 - 220) < 3, take2.analysis && `${take2.analysis.f0} Hz, ${take2.analysis.status}`);
check('The take is 4 s or less', d.recordings.find((r) => r.id === take2.recordingId).length / d.recordings.find((r) => r.id === take2.recordingId).sampleRate <= 4.01);
// Put the first take back as A for the rest of the checks.
await page.selectOption('[data-slot="a"] select', va.id);

// ── Stage 2 ──
await page.getByRole('button', { name: '◻ 2D sound space (task 4)' }).click();
await wait(200);
await page.locator('[data-take="space"] input[type=file]').setInputFiles(eePath);
await page.waitForFunction(() => window.__vowelMorph.debug().project.vowels.length === 4);
await wait(200);
d = await dbg();
const ve = d.project.vowels[3];
check('A third vowel imported in the 2D view is analyzed (≈ 250 Hz) and waits to be placed', Math.abs(ve.analysis.f0 - 250) < 1.5 && d.placingId === ve.id && d.spaceMode === 'edit', `${ve.analysis.f0} Hz`);
const sq = page.locator('.vm-square');
// The page may scroll between steps, so the square is measured every time.
const at = async (x, y) => {
  await sq.scrollIntoViewIfNeeded();
  const box = await sq.boundingBox();
  return { x: box.x + x * box.width, y: box.y + (1 - y) * box.height };
};
let p = await at(0.5, 0.85);
await page.mouse.click(p.x, p.y);
await wait(150);
// Place Aa and Oo through the list.
const placeVia = async (name, x, y) => {
  const row = page.locator('.vm-row', { has: page.getByRole('button', { name, exact: true }) });
  await row.getByRole('button', { name: 'Place in square' }).click();
  const q = await at(x, y);
  await page.mouse.click(q.x, q.y);
  await wait(150);
};
await placeVia('Aa', 0.15, 0.15);
await placeVia('Oo', 0.85, 0.15);
d = await dbg();
const pos = Object.fromEntries(d.project.vowels.filter((v) => v.pos).map((v) => [v.name, v.pos]));
check('Three dots placed where clicked (Edit mode)', Object.keys(pos).length === 3 && Math.abs(pos.Aa.x - 0.15) < 0.01 && Math.abs(pos.Oo.x - 0.85) < 0.01 && Math.abs(pos[ve.name].y - 0.85) < 0.01, JSON.stringify(pos));
check('Edit mode makes no sound', d.audio.kind === 'idle');
await page.screenshot({ path: join(shots, 'vowel-morph-2d-edit.png'), fullPage: true });

// Move a dot by dragging in Edit mode.
let q = await at(0.85, 0.15);
await page.mouse.move(q.x, q.y);
await page.mouse.down();
for (let k = 1; k <= 10; k++) { const r = await at(0.85, 0.15 + k * 0.02); await page.mouse.move(r.x, r.y); }
await page.mouse.up();
await wait(150);
d = await dbg();
const oo = d.project.vowels.find((v) => v.name === 'Oo');
check('Dragging a dot in Edit mode moves it', Math.abs(oo.pos.y - 0.35) < 0.01, `y ${oo.pos.y.toFixed(3)}`);

// Play mode
await page.getByRole('button', { name: '🔊 Play / explore' }).click();
q = await at(0.5, 0.4);
await page.mouse.click(q.x, q.y);
await wait(150);
d = await dbg();
const wsum = d.blend.weights.reduce((s, w) => s + w.weight, 0);
check('Play mode: clicking the square plays the blend there', d.audio.kind === 'synth' && d.playing.what === '2d' && Math.abs(d.project.space.point.x - 0.5) < 0.01);
check('Weights of the 3 vowels are all > 0 and sum to 1', d.blend.weights.length === 3 && d.blend.weights.every((w) => w.weight > 0) && Math.abs(wsum - 1) < 1e-12, d.blend.weights.map((w) => `${w.name} ${(w.weight * 100).toFixed(1)}%`).join(', '));
check('Weights are displayed', (await page.locator('.vm-wrow').count()) === 3);
const posBefore = JSON.stringify(d.project.vowels.map((v) => v.pos));
const voicesBefore = d.audio.counters.voicesCreated;
// Drag across the square: the same voice keeps going.
q = await at(0.2, 0.2);
await page.mouse.move(q.x, q.y);
await page.mouse.down();
let ok2d = true;
for (let k = 0; k <= 20; k++) {
  const r = await at(0.2 + k * 0.03, 0.2 + k * 0.02);
  await page.mouse.move(r.x, r.y);
  if (k % 5 === 0) { const dd = await dbg(); if (!dd.audio.targets.every((t) => Number.isFinite(t.freq) && Number.isFinite(t.gain))) ok2d = false; }
}
await page.mouse.up();
d = await dbg();
check('Dragging in Play mode changes the sound smoothly with one voice and does not move dots', ok2d && d.audio.kind === 'synth' && d.audio.counters.voicesCreated === voicesBefore && JSON.stringify(d.project.vowels.map((v) => v.pos)) === posBefore);
// Tap exactly on a dot: exact parameters.
q = await at(pos.Aa.x + 0.01, pos.Aa.y);
await page.mouse.click(q.x, q.y);
await wait(100);
d = await dbg();
check('Tapping a dot (synthesized mode) snaps to it and plays its exact analyzed parameters', same(d.audio.params, A) && d.blend.weights.find((w) => w.name === 'Aa').weight === 1);
await page.screenshot({ path: join(shots, 'vowel-morph-2d-play.png'), fullPage: true });
// Original on dot tap.
await page.locator('input[name="vm-dotclick"][value="original"]').check();
await page.mouse.click(q.x, q.y);
await wait(100);
d = await dbg();
check('With “ORIGINAL recording” chosen, tapping a dot plays that dot’s original recording', d.audio.kind === 'original' && d.audio.label.includes('ORIGINAL recording of Aa'));
q = await at(0.5, 0.5);
await page.mouse.click(q.x, q.y);
await wait(100);
d = await dbg();
check('Clicking empty space afterwards goes back to the synthesized blend', d.audio.kind === 'synth');
await page.getByRole('button', { name: '■ Stop sound' }).click();
await page.locator('input[name="vm-dotclick"][value="synth"]').check();

// Download at marker
const spaceDl = await download(page.getByRole('button', { name: '⬇ Download sound at marker (WAV)' }));
const w2 = decodeWav(spaceDl.data.buffer.slice(spaceDl.data.byteOffset, spaceDl.data.byteOffset + spaceDl.data.byteLength));
const an2 = analyzeVowel(w2.samples, w2.sampleRate, { from: 24000, to: 96000 });
d = await dbg();
check('Downloaded square WAV is the generated sound at the marker', /vowel-morph_space_x50_y50\.wav/.test(spaceDl.name) && Math.abs(an2.f0 - d.blend.params.f0) < 0.3, `${an2.f0} vs ${d.blend.params.f0.toFixed(2)} Hz`);

// Rename, select, remove one dot (no deletion)
const before = d.project.vowels.length;
const eeRow = page.locator('.vm-row', { has: page.getByRole('button', { name: ve.name, exact: true }) });
await eeRow.getByRole('button', { name: ve.name, exact: true }).click();
await page.fill(`.vm-sel-card input[aria-label="Rename ${ve.name}"]`, 'Ee');
await page.press(`.vm-sel-card input[aria-label="Rename ${ve.name}"]`, 'Enter');
await wait(150);
d = await dbg();
check('Renaming a vowel updates its dot label', d.project.vowels.find((v) => v.id === ve.id).name === 'Ee' && (await page.locator('.vm-dot text', { hasText: 'Ee' }).count()) === 1);

// ── persistence ──
await page.reload();
await page.waitForSelector('.vm-page');
await page.waitForFunction(() => window.__vowelMorph.debug().recordings.length >= 4);
d = await dbg();
check('After reload: all vowels, recordings, pair and dot positions are restored', d.project.vowels.length === before && d.recordings.length === 4 && d.project.pair.a === va.id &&
  JSON.stringify(d.project.vowels.filter((v) => v.name !== 'Ee').map((v) => v.pos)) === JSON.stringify(JSON.parse(posBefore).filter((_, i) => d.project.vowels[i].name !== 'Ee')));
check('Analyses survive reload exactly', same(paramsOf(d.project.vowels.find((v) => v.id === va.id)), A));

// ── backup ──
const backup = await download(page.getByRole('button', { name: '⬇ Download backup' }));
const doc = JSON.parse(backup.data.toString('utf8'));
check('Backup contains every vowel and its recording', doc.format === 'vowel-morph.backup' && doc.project.vowels.length === 4 && doc.recordings.length === 4, `${(backup.data.length / 1e6).toFixed(1)} MB`);
const bpath = join(tmpdir(), 'vm-backup.json');
writeFileSync(bpath, backup.data);
// A fresh browser profile (different storage) restores it.
const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
const p2 = await ctx2.newPage();
p2.on('dialog', (dl) => dl.accept());
p2.on('pageerror', (e) => errors.push(String(e)));
await p2.goto(url + '#/vowel-morph');
await p2.waitForSelector('.vm-page');
await p2.locator('input[type=file][accept^=".json"]').setInputFiles(bpath);
await p2.waitForFunction(() => window.__vowelMorph.debug().project.vowels.length === 4);
const d2 = await p2.evaluate(() => window.__vowelMorph.debug());
const orig = d.project.vowels;
check('Importing the backup in another browser profile restores recordings, analyses, pair and positions', d2.recordings.length === 4 &&
  d2.project.vowels.every((v, i) => v.name === orig[i].name && JSON.stringify(v.pos) === JSON.stringify(orig[i].pos) && same(paramsOf(v), paramsOf(orig[i]))) &&
  d2.project.vowels.find((v) => v.id === d2.project.pair.a).name === 'Aa');
const recA = d.recordings.find((r) => r.id === orig[0].recordingId);
const recA2 = d2.recordings.find((r) => r.id === d2.project.vowels[0].recordingId);
check('Restored recordings have the same length and sample rate', recA.length === recA2.length && recA.sampleRate === recA2.sampleRate);
// Importing again adds, never replaces.
await p2.locator('input[type=file][accept^=".json"]').setInputFiles(bpath);
await p2.waitForFunction(() => window.__vowelMorph.debug().project.vowels.length === 8);
const d3 = await p2.evaluate(() => window.__vowelMorph.debug());
check('Importing a second time adds copies (“(imported)”) and keeps everything', d3.project.vowels.length === 8 && d3.project.vowels.slice(4).every((v) => v.name.includes('(imported)')));
await ctx2.close();

// ── delete asks first ──
let asked = '';
page.removeAllListeners('dialog');
page.on('dialog', (dl) => { asked = dl.message(); dl.dismiss(); });
await page.getByRole('button', { name: '◻ 2D sound space (task 4)' }).click();
const eeRow2 = page.locator('.vm-row', { has: page.getByRole('button', { name: 'Ee', exact: true }) });
await eeRow2.getByRole('button', { name: 'Ee', exact: true }).click();
await page.locator('.vm-sel-card .vm-adjust summary').click();
await page.locator('.vm-sel-card').getByRole('button', { name: '🗑 Delete vowel' }).click();
await wait(150);
d = await dbg();
check('Deleting asks for confirmation, and cancelling keeps the vowel', /Delete “Ee”/.test(asked) && d.project.vowels.length === 4);
page.removeAllListeners('dialog');
page.on('dialog', (dl) => dl.accept());

// ── tour ──
await page.getByRole('button', { name: '🧭 Guided tour' }).click();
await wait(400);
const tourTitle = async () => page.locator('.tour-title').innerText();
const t1 = await tourTitle();
await page.locator('.tour-pop').getByRole('button', { name: 'Next →' }).click();
await wait(400);
const t2 = await tourTitle();
const holeVisible = await page.locator('.tour-hole').isVisible();
await page.locator('.tour-pop').getByRole('button', { name: '← Back' }).click();
await wait(200);
const t3 = await tourTitle();
let n = 0;
for (; n < 20 && (await page.locator('.tour-pop').count()); n++) {
  const title = await tourTitle();
  if (title.startsWith('Click or drag')) await page.screenshot({ path: join(shots, 'vowel-morph-tour.png') });
  await page.locator('.tour-pop').getByRole('button', { name: /Next →|Finish/ }).click();
  await wait(250);
}
check('Tour: highlights real controls with Next, Back and Finish/Close', t1 === 'What Vowel Morph does' && t2 === 'Record Vowel A' && holeVisible && t3 === t1 && n === 13, `${n} steps`);
d = await dbg();
check('The tour plays nothing by itself', d.audio.kind === 'idle');

// ── phone size + touch ──
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p3 = await ctx3.newPage();
p3.on('pageerror', (e) => errors.push(String(e)));
p3.on('dialog', (dl) => dl.accept());
await p3.goto(url + '#/vowel-morph');
await p3.waitForSelector('.vm-page');
await p3.locator('input[type=file][accept^=".json"]').setInputFiles(bpath);
await p3.waitForFunction(() => window.__vowelMorph.debug().project.vowels.length === 4);
await p3.getByRole('button', { name: '◻ 2D sound space (task 4)' }).click();
const sq3 = await p3.locator('.vm-square').boundingBox();
await p3.locator('.vm-square').scrollIntoViewIfNeeded();
const sq3b = await p3.locator('.vm-square').boundingBox();
await p3.touchscreen.tap(sq3b.x + sq3b.width * 0.5, sq3b.y + sq3b.height * 0.5);
await p3.waitForTimeout(200);
const d4 = await p3.evaluate(() => window.__vowelMorph.debug());
const overflow = await p3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('Phone size: square fits the screen, no sideways scrolling, and a tap plays the blend', sq3.width <= 390 && overflow <= 0 && d4.audio.kind === 'synth', `square ${Math.round(sq3.width)} px, overflow ${overflow}`);
await p3.screenshot({ path: join(shots, 'vowel-morph-phone.png'), fullPage: false });
await ctx3.close();

// ── other apps still mount ──
await page.goto(url + '#/frequency');
await page.waitForSelector('.mode-bar');
await page.goto(url + '#/motion-score');
await wait(500);
const msText = await page.locator('#app').innerText();
const fpKeys = await page.evaluate(() => Object.keys(localStorage));
check('Frequency Playground and Motion Score still open from the navigation', msText.length > 50);
check('Vowel Morph storage is separate (its own key, does not touch Vowel Lab keys)', fpKeys.includes('vowelMorph.project.v1') && !fpKeys.some((k) => k.startsWith('frequencyPlayground') && k.includes('orph')));

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

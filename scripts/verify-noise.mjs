// Automated browser checks for the noise source and fricatives in Vowel
// filtering. Usage: start the app (npx vite --port 5181), then:
//   node scripts/verify-noise.mjs http://localhost:5181/
// Needs the `playwright` package.
//
// SIMULATED INPUT: the "recording" is generated noise with a known shape,
// imported as a WAV. Playback is checked through the app's state and the
// browser's own offline rendering, not by listening. None of this shows that
// the result sounds like "shh" or "sss".
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../src/pages/frequency/wav.js';
import * as VF from '../src/pages/frequency/vowel-filter.js';

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
const SR = 48000;
const truth = VF.fricativeFilter('sss', SR).bands;
const simulated = VF.renderSteady({ f0: 200, count: 4, bands: truth, enabled: true, sampleRate: SR, length: 3 * SR, mix: { voiced: 0, noise: 1, voicedDirect: false } });
const simPath = join(tmpdir(), 'fp-sss-sim.wav');
writeFileSync(simPath, Buffer.from(encodeWav(simulated, SR).buffer));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const errors = [];
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(url + '#/frequency');
await page.waitForSelector('.mode-bar');
const wait = (ms) => page.waitForTimeout(ms);
const fdbg = () => page.evaluate(() => window.__frequencyPlayground.debug().vowel.filter);
await page.getByRole('button', { name: '🎚 Vowel filtering' }).click();
await wait(400);
const sec = page.locator('section.vf');

let d = await fdbg();
check('Noise is off by default, so existing experiments keep their sound', d.work.mix.noise === 0 && d.work.mix.voiced === 1 && !d.work.mix.voicedDirect);
check('Noise controls are in the page', (await sec.getByRole('slider', { name: 'Noise level' }).count()) === 1 && (await sec.getByRole('slider', { name: 'Harmonic level' }).count()) === 1);
check('Fourth workflow tab is there', (await sec.locator('button.vf-tab[data-wf="fricative"]').count()) === 1);
check('Vowel examples still show in workflow 1, fricative box does not', await sec.locator('.vf-examples').isVisible() && !(await sec.locator('.vf-fricatives').isVisible()));

// Noise alone, from workflow 1.
await sec.getByRole('button', { name: 'Play filtered noise only' }).click();
await wait(300);
d = await fdbg();
check('“Filtered noise only” plays noise with the harmonics off, through the filter', d.audio.state === 'synth' && d.filteredNow && d.audio.synth.voicedGain === 0 && d.audio.synth.noiseGain > 0, JSON.stringify({ voiced: d.audio.synth.voicedGain, noise: d.audio.synth.noiseGain }));
// Live level change without a restart.
const created = d.audio.created;
await sec.getByRole('slider', { name: 'Noise level' }).fill('30');
await wait(200);
d = await fdbg();
check('Moving the noise slider changes the live level without restarting', Math.abs(d.audio.synth.noiseGain - 0.3 * VF.NOISE_PEAK) < 0.005 && d.audio.created === created, `${d.audio.synth.noiseGain.toFixed(4)}`);
await sec.getByRole('slider', { name: 'Harmonic level' }).fill('50');
await wait(200);
d = await fdbg();
check('Blend: harmonic level is live too', Math.abs(d.audio.synth.voicedGain - 0.5) < 0.01 && d.work.mix.voiced === 0.5);
await sec.getByRole('button', { name: 'Stop (noise)' }).click();
await wait(200);
d = await fdbg();
check('Stop ends it', d.audio.state === 'idle');

// Fricative workflow.
await sec.locator('button.vf-tab[data-wf="fricative"]').click();
await wait(300);
check('Workflow 4 shows the fricative box and the recording panel, hides vowel examples', await sec.locator('.vf-fricatives').isVisible() && !(await sec.locator('.vf-examples').isVisible()) && await sec.locator('[data-step="R"]').isVisible());
const presets = {};
for (const [id, label] of [['shh', 'shoe'], ['fff', 'fan'], ['jjj', 'measure'], ['sss', 'see']]) {
  await sec.getByRole('button', { name: `Fricative starting point ${id}, as in ${label}` }).click();
  await wait(200);
  d = await fdbg();
  presets[id] = d.work;
  const want = VF.FRICATIVES.find((x) => x.id === id);
  check(`“${id}” loads its filter and levels (origin preset, labelled)`, d.work.origin === 'fricative' && d.work.vowelText === id && d.work.mix.noise === want.mix.noise && d.work.mix.voiced === want.mix.voiced && d.work.filter.enabled);
}
check('“jjj” has harmonics that skip the filter', presets.jjj.mix.voicedDirect && presets.jjj.mix.voiced > 0 && presets.jjj.count === 6);
check('Preset vs estimated is spelled out on the page', (await sec.locator('.vf-fricatives').innerText()).includes('Preset, not estimated'));
await page.screenshot({ path: join(shots, 'noise-01-fricatives.png'), fullPage: true });

// Live playback routes jjj correctly.
await sec.getByRole('button', { name: 'Fricative starting point jjj, as in measure' }).click();
await sec.getByRole('button', { name: 'Play (fricatives)' }).click();
await wait(300);
d = await fdbg();
check('“jjj” plays noise through the filter and harmonics around it', d.audio.synth.direct > 0.9 && d.audio.synth.toFilter < 0.1 && d.audio.synth.noiseGain > 0 && d.audio.synth.voicedGain > 0);
await sec.getByRole('button', { name: 'Stop (fricatives)' }).click();
await wait(200);

// The browser's own rendering equals the model, noise included.
const off = await page.evaluate(async () => {
  const hk = window.__frequencyPlayground.vowelHooks.filter;
  return { a: await hk.renderOffline(0.3), b: hk.renderModel(0.3) };
});
let e = 0;
for (let i = 0; i < Math.min(off.a.length, off.b.length); i++) e = Math.max(e, Math.abs(off.a[i] - off.b[i]));
check('Browser rendering of noise + harmonics matches the WAV model', e < 0.02, `max difference ${e.toExponential(1)}`);

// Estimate from a recording.
await sec.getByRole('button', { name: '🔍 Estimate filter from recording' }).isDisabled();
await page.locator('input[type=file][accept^=".wav"]').first().setInputFiles(simPath);
await wait(600);
await sec.locator('select[aria-label="Recording to compare with"]').selectOption({ index: 1 });
await wait(300);
await sec.getByRole('button', { name: '🔍 Estimate filter from recording' }).click();
await wait(500);
d = await fdbg();
check('Estimate opens a new experiment labelled estimated, with noise only', d.work.origin === 'estimated' && d.work.mix.noise > 0 && d.work.mix.voiced === 0 && d.fricFit && d.fricFit.ok, d.fricFit && d.fricFit.ok ? `${d.fricFit.summary.rmsErrorDb} dB RMS, strongest near ${d.fricFit.summary.peakHz} Hz` : JSON.stringify(d.fricFit));
const freqs = [1500, 3000, 6000];
const a = VF.responseDb(truth, freqs, SR);
const b = VF.responseDb(d.work.filter.bands, freqs, SR);
check('Estimated filter has the simulated recording’s broad shape (high frequencies strongest)', b[2] > b[1] && b[1] > b[0] && a[2] > a[0], `simulated ${Array.from(a).map((x) => x.toFixed(0))}, estimated ${Array.from(b).map((x) => x.toFixed(0))} dB`);
check('The page says which part was estimated', (await sec.locator('.vf-fricatives').innerText()).includes('Not estimated'));

// Back to a vowel: the vowel workflow still behaves.
await sec.locator('button.vf-tab[data-wf="explore"]').click();
await wait(300);
await sec.getByRole('slider', { name: 'Noise level' }).fill('0');
await sec.getByRole('slider', { name: 'Harmonic level' }).fill('100');
await sec.getByRole('button', { name: /Vowel example Aa/ }).click();
await sec.getByRole('button', { name: 'Play filtered (vowel examples)' }).click();
await wait(300);
d = await fdbg();
check('A vowel example still plays with noise off and harmonics at 100 %', d.audio.state === 'synth' && d.audio.synth.noiseGain === 0 && d.audio.synth.voicedGain === 1);
await sec.getByRole('button', { name: 'Stop (vowel examples)' }).click();

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (simulated; no listening test)`);
process.exit(failed.length ? 1 : 0);

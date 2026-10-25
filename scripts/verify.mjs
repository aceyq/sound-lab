// Automated browser checks for Frequency Playground (headless Chromium).
// Usage: start the app (npm run dev), then: node scripts/verify.mjs [url]
// Needs the `playwright` package (npm i -D playwright, or a global install).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { playwright = require(p); break; } catch { /* try next */ }
}
if (!playwright) {
  console.error('Playwright not found. Install it with: npm i -D playwright');
  process.exit(2);
}

const url = process.argv[2] || 'http://localhost:5173/';
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const dbg = () => page.evaluate(() => window.__frequencyPlayground.debug());
const wait = (ms) => page.waitForTimeout(ms);
const near = (peaks, f, tol) => peaks.some((p) => Math.abs(p - f) <= tol);
const row = (label) => page.locator(`tr:has(th:text-is("${label}"))`);
const setFreq = async (label, v) => { const i = row(label).locator('input').nth(0); await i.fill(String(v)); await i.press('Enter'); };
const setAmp = async (label, v) => { const i = row(label).locator('input').nth(1); await i.fill(String(v)); };
const clickText = (t) => page.getByRole('button', { name: t, exact: true }).click();

await page.goto(url);
await page.waitForSelector('canvas.wave');
await wait(300);

let d = await dbg();
check('Starts with one component 220 Hz, amplitude 1', d.comps.length === 1 && d.comps[0].freq === 220 && d.comps[0].amp === 1);
check('Spectrum shows "press Play" state before playback', d.measure.mode === 'idle');
check('Audio context reports a sample rate', d.engine.sampleRate > 0, `${d.engine.sampleRate} Hz`);
await page.screenshot({ path: shots + '01-before-play.png' });

await page.getByRole('button', { name: '▶ Play', exact: true }).click();
await wait(900);
d = await dbg();
const tol = () => Math.max(1.5 * d.measure.binHz, 2);
check('Play starts audio (context running, one oscillator)', d.engine.playing && d.engine.contextState === 'running' && d.engine.voices.length === 1, `state=${d.engine.contextState}`);
check('Measured spectrum is live', d.measure.mode === 'live');
check('Measured peak at 220 Hz', near(d.measure.peaks, 220, tol()), `peaks=${d.measure.peaks}`);

await setFreq('C1', 440);
await wait(700);
d = await dbg();
check('Typed frequency 440 changes the oscillator', d.engine.voices[0].freq === 440);
check('Measured peak moves to 440 Hz', near(d.measure.peaks, 440, tol()) && !near(d.measure.peaks, 220, tol()), `peaks=${d.measure.peaks}`);

await setAmp('C1', '0.5');
await wait(200);
d = await dbg();
check('Typed amplitude 0.5 changes the voice gain', d.engine.voices[0].target === 0.5);

await row('C1').locator('input').nth(0).fill('abc');
await row('C1').locator('input').nth(0).press('Enter');
let msg = await row('C1').locator('.msg').first().textContent();
d = await dbg();
check('Invalid "abc" shows inline message and keeps 440 Hz', /Not a number/.test(msg) && d.engine.voices[0].freq === 440, msg);
await row('C1').locator('input').nth(0).fill('30000');
await row('C1').locator('input').nth(0).press('Enter');
msg = await row('C1').locator('.msg').first().textContent();
check('Frequency at/above Nyquist or 10 kHz is rejected with a message', /Nyquist|Too high/.test(msg), msg);
await setFreq('C1', 220);

// Add / disable / remove during playback.
await page.getByRole('button', { name: '+ Add Component' }).click();
await setFreq('C2', 660);
await wait(700);
d = await dbg();
check('Add Component during playback adds an oscillator', d.engine.voices.length === 2 && d.engine.voices.some((v) => v.freq === 660));
check('Peak appears for the added 660 Hz component', near(d.measure.peaks, 660, tol()), `peaks=${d.measure.peaks}`);
await row('C2').locator('input[type=checkbox]').uncheck();
await wait(700);
d = await dbg();
check('Disable during playback mutes it (gain 0, peak gone)', d.engine.voices.find((v) => v.freq === 660).target === 0 && !near(d.measure.peaks, 660, tol()), `peaks=${d.measure.peaks}`);
await row('C2').getByRole('button').click();
await wait(300);
d = await dbg();
check('Remove during playback removes the oscillator', d.engine.voices.length === 1 && d.comps.length === 1);

// Display-only changes must not touch the audio graph.
const before = JSON.stringify({ v: d.engine.voices, n: d.engine.norm, m: d.engine.master });
for (const t of ['5 ms', '100 ms', '1 s', '5 s', '20 ms']) await clickText(t);
await page.locator('label.custom input').fill('50');
await page.locator('label.custom').getByRole('button', { name: 'Apply' }).click();
await page.getByRole('combobox', { name: 'Vertical amplitude scale' }).selectOption('0.25');
await wait(200);
d = await dbg();
const after = JSON.stringify({ v: d.engine.voices, n: d.engine.norm, m: d.engine.master });
check('Time-window and vertical-scale changes leave the sound unchanged', before === after && d.windowSec === 0.05 && d.vScale === 0.25);
await page.getByRole('combobox', { name: 'Vertical amplitude scale' }).selectOption('auto');

// Presets vs measured peaks.
for (const [name, freqs] of [['B. Harmonic Family', [100, 200, 300, 400, 500]], ['C. Non-harmonic Mixture', [137, 281, 463, 719]]]) {
  await clickText(name);
  await wait(900);
  d = await dbg();
  const ok = freqs.every((f) => near(d.measure.peaks, f, tol()));
  check(`${name}: measured peaks match expected markers within 1.5 bins`, ok && d.engine.voices.length === freqs.length, `peaks=${d.measure.peaks}`);
  await page.screenshot({ path: shots + `02-${freqs.length}-${name.slice(0, 1)}.png` });
}
d = await dbg();
check('Non-harmonic mixture normalization = 1/2.3', Math.abs(d.engine.norm - 1 / 2.3) < 0.01, d.engine.norm.toFixed(3));

// Beats.
await clickText('D. Close Frequencies / Beats');
await page.getByRole('button', { name: /Switch waveform to 1 s/ }).click();
await wait(1200);
d = await dbg();
const waveNote = await page.locator('.viz[data-viz=wave] .note').textContent();
check('Beats preset loads 220 + 224 Hz and the 1 s view', d.comps.map((c) => c.freq).join() === '220,224' && d.windowSec === 1);
check('1 s view explains dense oscillations', /too dense/.test(waveNote));
check('At FFT 8192 the 4 Hz-apart tones merge into one peak near 222 Hz', d.measure.peaks.filter((p) => p > 200 && p < 245).length === 1, `peaks=${d.measure.peaks}`);
await page.screenshot({ path: shots + '03-beats.png' });
await page.getByRole('combobox', { name: 'FFT size' }).selectOption('32768');
await wait(1500);
d = await dbg();
check('FFT 32768 bin spacing ≈ sampleRate/32768', Math.abs(d.measure.binHz - d.engine.sampleRate / 32768) < 1e-9, d.measure.binHz.toFixed(3) + ' Hz');
console.log('      (info) peaks at FFT 32768:', d.measure.peaks.filter((p) => p > 200 && p < 245));
await page.getByRole('combobox', { name: 'FFT size' }).selectOption('8192');

// Silence.
await clickText('A. Pure Tone');
await setAmp('C1', '0');
await wait(700);
d = await dbg();
check('Amplitude 0 → measured silence, no peaks, no errors', d.measure.silent && d.measure.peaks.length === 0);
await page.screenshot({ path: shots + '04-silence.png' });
await setAmp('C1', '1');

// Randomize.
await clickText('E. Randomize');
await wait(900);
d = await dbg();
check('Randomize lists 3–6 components and peaks match them', d.comps.length >= 3 && d.comps.length <= 6 && d.comps.every((c) => near(d.measure.peaks, c.freq, tol())), d.comps.map((c) => c.freq).join(', '));

// Harmonic builder.
await page.getByLabel('Base frequency in Hz').fill('110');
await page.getByLabel('Number of harmonics').fill('4');
await clickText('Replace table');
d = await dbg();
check('Harmonic Builder replaces with 110, 220, 330, 440', d.comps.map((c) => c.freq).join() === '110,220,330,440');

// Stop → frozen; repeated play/stop does not leak oscillators.
await page.getByRole('button', { name: '■ Stop', exact: true }).click();
await wait(300);
d = await dbg();
check('Stop: status stopped, spectrum labelled frozen', !d.engine.playing && d.measure.mode === 'frozen');
const stateText = await page.locator('.viz[data-viz=spec] .state-line').textContent();
check('Frozen measurement labelled honestly', /Frozen/.test(stateText), stateText);
for (let i = 0; i < 5; i++) {
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await wait(250);
  await page.getByRole('button', { name: '■ Stop', exact: true }).click();
  await wait(150);
}
await page.getByRole('button', { name: '▶ Play', exact: true }).dblclick();
await wait(400);
d = await dbg();
check('Double-click Play still runs one set of oscillators', d.engine.voices.length === 4);
await page.getByRole('button', { name: '■ Stop', exact: true }).click();
await wait(500);
d = await dbg();
check('After repeated Play/Stop all oscillators are released', d.engine.liveOscillators === 0, `live=${d.engine.liveOscillators}, created=${d.engine.createdOscillators}`);
check('Exactly one animation loop is running', d.loops === 1);

// Expand + presentation mode.
await page.locator('.viz[data-viz=spec] .expand').click();
check('Spectrum can be expanded on its own', await page.locator('.viz.expanded').count() === 1);
await page.keyboard.press('Escape');
await page.getByRole('button', { name: /Presentation Mode/ }).click();
check('Presentation Mode hides secondary settings', !(await page.locator('label.custom').isVisible()));
await page.getByRole('button', { name: '▶ Play', exact: true }).click();
await wait(1500);
await page.screenshot({ path: shots + '05-presentation-playing.png', fullPage: true });

// Page switch while playing stops audio and releases resources.
await page.getByRole('link', { name: '2. Motion Score' }).click();
await wait(400);
const last = await page.evaluate(() => ({ last: window.__frequencyPlaygroundLast, loops: window.__fpLoops, hook: !!window.__frequencyPlayground }));
check('Switching to Motion Score stops audio and closes the audio context', last.last && !last.last.playing && last.last.contextState === 'closed' && last.loops === 0 && !last.hook, JSON.stringify({ state: last.last?.contextState, loops: last.loops }));
await page.screenshot({ path: shots + '06-motion-score.png' });
await page.getByRole('link', { name: '1. Frequency Playground' }).click();
await wait(400);
d = await dbg();
check('Returning creates a fresh, stopped page with one loop', !d.engine.playing && d.loops === 1);

check('No page errors in the console', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);

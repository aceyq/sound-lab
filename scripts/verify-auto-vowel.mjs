// Automated browser checks for the automatic vowel synthesis (assignment 3).
// Usage: start the app (npm run dev), then: node scripts/verify-auto-vowel.mjs [url]
// Needs the `playwright` package (npm i -D playwright, or a global install).
//
// SIMULATED INPUT: instead of singing, the script imports generated WAV files
// through the Vowel Lab's "Import a WAV recording" button:
//   • a vowel-like tone at 248 Hz built like a voice: a source whose
//     harmonics fall off with frequency, shaped by three resonances near
//     300 / 870 / 2240 Hz (textbook values for "oo"), with a slow ±0.3 % pitch
//     wobble, small random jitter and breath-like noise. Its true harmonic
//     strengths are known, so the analysis can be scored against them.
//   • 1.5 s of silence.
// Playback is checked through the app's state, not by listening. None of this
// shows that a real recording of your voice is analyzed well or that the
// synthesis sounds like the vowel.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav, decodeWav } from '../src/pages/frequency/wav.js';

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

// ── simulated recordings ──
const SR = 48000;
const F0 = 248;
const FORMANTS = [[300, 60, 1], [870, 90, 0.35], [2240, 120, 0.12]];
// Harmonic n's true amplitude: source roll-off × resonance curve.
const trueAmp = (f) => (1 / (1 + (f / 400) ** 2)) * FORMANTS.reduce((s, [fc, bw, g]) => s + g / Math.sqrt(1 + ((f - fc) / (bw / 2)) ** 2), 0.01);
const N_TRUE = Math.floor(8000 / F0);
const TRUE = Array.from({ length: N_TRUE }, (_, i) => trueAmp((i + 1) * F0));
const TOP = Math.max(...TRUE);
const TRUE_REL = TRUE.map((a) => a / TOP);
let seed = 3;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function vowelLike(sec) {
  const x = new Float32Array(Math.round(SR * sec));
  let ph = 0;
  let jit = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (i % 200 === 0) jit = (rnd() - 0.5) * 0.002;
    const f = F0 * (1 + 0.003 * Math.sin(2 * Math.PI * 4.5 * t) + jit);
    ph += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let n = 1; n <= N_TRUE; n++) s += TRUE[n - 1] * Math.sin(n * ph + 0.7 * n * n);
    const env = Math.min(1, t / 0.15, (sec - t) / 0.15);
    x[i] = env * (0.3 * s / TOP) + (rnd() - 0.5) * 0.002;
  }
  return x;
}
const vowelPath = join(tmpdir(), 'fp-auto-oo-sim.wav');
writeFileSync(vowelPath, Buffer.from(encodeWav(vowelLike(3), SR).buffer));
const silentPath = join(tmpdir(), 'fp-auto-silence.wav');
writeFileSync(silentPath, Buffer.from(encodeWav(new Float32Array(SR * 1.5), SR).buffer));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const errors = [];
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(url + '#/frequency');
await page.waitForSelector('.mode-bar');
const dbg = () => page.evaluate(() => window.__frequencyPlayground.debug());
const vow = async () => (await dbg()).vowel;
const wait = (ms) => page.waitForTimeout(ms);
const btn = (name) => page.getByRole('button', { name, exact: true });
const auto = page.locator('.vl-stage[data-stage="auto"]');
const download = async (locator) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
};

await btn('🗣 Vowel Lab: harmonic sliders').click();
await wait(300);
check('Automatic vowel synthesis section is present with the explanation', (await auto.count()) === 1 &&
  (await auto.innerText()).includes('The app estimates the base frequency and the strengths of its harmonics from a steady part of your recording, then combines new sine waves to recreate that sound.'));
check('Analyze vowel is disabled until a recording is chosen', await auto.getByRole('button', { name: '🔍 Analyze vowel' }).isDisabled());

// 1. A "manual match" experiment, made the way Ace made hers: oo, lower pitch,
//    f0 typed by hand, sliders reset to fundamental only and three set by hand.
await page.selectOption('select[aria-label="Vowel"]', 'oo');
await page.locator('input[type=file][accept^=".wav"]').setInputFiles(vowelPath);
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 1);
await wait(300);
await page.fill('#vl-f0-s3', '247');
await page.press('#vl-f0-s3', 'Enter');
await page.locator('select[aria-label="Number of harmonics"]').selectOption('32');
await btn('Fundamental only').click();
for (const [n, a] of [[2, '0.1'], [3, '0.05'], [4, '0.01']]) {
  const box = page.locator(`input[aria-label="Harmonic ${n} amplitude from 0 to 1"]`);
  await box.fill(a);
  await box.press('Enter');
}
await page.locator('.vl-bar').getByRole('button', { name: '💾 Save experiment' }).click();
await wait(200);
let v = await vow();
const manualSaved = JSON.stringify(v.saved[0]);
const manualWork = JSON.stringify(v.work);
check('Manual experiment saved (oo, f0 247, harmonics 1, 0.1, 0.05, 0.01, rest 0)', v.saved.length === 1 && v.work.f0 === 247 && v.work.amps.slice(0, 5).join() === '1,0.1,0.05,0.01,0' && !v.dirty);

// 2. Analyze.
await auto.getByRole('button', { name: '🔍 Analyze vowel' }).click();
await wait(300);
v = await vow();
const a = v.auto;
check('Analysis returns an automatic f0 close to the simulated 248 Hz', a && a.f0Source === 'automatic' && Math.abs(a.f0 - F0) < 1.5, a && `${a.f0} Hz, status ${a.status}`);
check('Estimated fundamental (Hz) field shows it, labelled automatic', (await page.inputValue('#vl-auto-f0')) === String(a.f0) && (await auto.locator('.vl-auto-tag').innerText()).includes('automatic'));
const strong = TRUE_REL.map((t, i) => [i + 1, t]).filter(([, t]) => t >= 0.03);
const errs = strong.map(([n, t]) => Math.abs(20 * Math.log10((a.amps[n - 1] || 1e-6) / t)));
check('Every harmonic stronger than −30 dB is measured within 2 dB of its true strength', errs.every((e) => e < 2),
  strong.map(([n, t], i) => `h${n} ${a.amps[n - 1]} vs ${t.toFixed(3)} (${errs[i].toFixed(1)} dB)`).join(', '));
check('Amplitude array is complete (48) and nothing above 8 kHz (where the simulation has none) is active',
  a.amps.length === 48 && a.amps.every((x, i) => x === 0 || (i + 1) * a.f0 < 8000));
check('The open manual experiment was not changed by the analysis', JSON.stringify(v.work) === manualWork && JSON.stringify(v.saved[0]) === manualSaved && !v.dirty);
check('Reliability facts and the harmonic table are shown', (await auto.locator('.vl-auto-facts').innerText()).includes('Periodic frames') && (await auto.locator('table.vl-auto-harm tbody tr').count()) >= 8);

// 3. Playback.
await auto.getByRole('button', { name: 'Play Synthesized (automatic)' }).click();
await wait(400);
v = await vow();
check('Play Synthesized plays the automatic recipe (new sines, not the recording)', v.audio.state === 'synth' && v.audioOwner === 'auto' && v.audio.recipe && v.audio.recipe.f0 === a.f0 && JSON.stringify(v.audio.recipe.amps) === JSON.stringify(a.amps), JSON.stringify(v.audio.recipe && v.audio.recipe.amps.slice(0, 6)));
// Moving a manual slider while the automatic synthesis plays must not change it.
await page.locator('input[aria-label="Harmonic 5 amplitude from 0 to 1"]').fill('0.3');
await page.locator('input[aria-label="Harmonic 5 amplitude from 0 to 1"]').press('Enter');
await wait(200);
v = await vow();
check('Manual slider edits do not leak into the automatic playback', JSON.stringify(v.audio.recipe.amps) === JSON.stringify(a.amps));
await auto.getByRole('button', { name: 'Stop (automatic section)' }).click();
await wait(200);
check('Stop stops it', (await vow()).audio.state === 'idle');
// Undo the slider edit so the manual experiment is clean again.
await page.locator('input[aria-label="Harmonic 5 amplitude from 0 to 1"]').fill('0');
await page.locator('input[aria-label="Harmonic 5 amplitude from 0 to 1"]').press('Enter');
await auto.getByRole('button', { name: 'Original → Synthesized (automatic)' }).click();
await wait(400);
v = await vow();
check('Original → Synthesized starts with the analyzed section of the original', v.audio.state === 'ab' && v.audio.abPhase === 'original');
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.audio.abPhase === 'synth', null, { timeout: 5000 });
v = await vow();
check('…then plays the automatic synthesis', v.audio.abPhase === 'synth' && JSON.stringify(v.audio.recipe.amps) === JSON.stringify(a.amps));
await auto.getByRole('button', { name: 'Stop (automatic section)' }).click();
await auto.getByRole('button', { name: 'Play Original (analyzed section)' }).click();
await wait(300);
check('Play Original plays the recording', (await vow()).audio.state === 'original');
await auto.getByRole('button', { name: 'Stop (automatic section)' }).click();
await page.screenshot({ path: shots + 'auto-01-analyzed.png', fullPage: false, clip: await auto.boundingBox() });

// 4. Downloads before saving.
const wav = await download(auto.getByRole('button', { name: '⬇ Download synthesized WAV' }));
const dec = decodeWav(wav.data.buffer.slice(wav.data.byteOffset, wav.data.byteOffset + wav.data.byteLength));
let pk = 0;
for (const s of dec.samples) pk = Math.max(pk, Math.abs(s));
const rendered = await page.evaluate(() => window.__frequencyPlayground.vowelHooks.renderAuto());
let same = rendered.samples.length === dec.samples.length;
for (let i = 0; same && i < dec.samples.length; i += 97) if (Math.abs(rendered.samples[i] - dec.samples[i]) > 1 / 16000) same = false;
check('Synthesized WAV: named oo_lower_auto_synthesized.wav, peak 0.5, equal to the automatic recipe render', wav.name === 'oo_lower_auto_synthesized.wav' && Math.abs(pk - 0.5) < 0.01 && same, `${wav.name}, peak ${pk.toFixed(3)}`);
const js = await download(auto.getByRole('button', { name: '⬇ Download analysis/settings' }));
const doc = JSON.parse(js.data.toString());
check('Analysis/settings JSON has the recipe, the method, every harmonic and the frame-by-frame pitch',
  js.name === 'oo_lower_auto_analysis.json' && doc.format === 'frequency-playground.vowel-experiment' && doc.fundamentalHz === a.f0 && doc.harmonics.length === 48 &&
  doc.automaticAnalysisDetails && doc.automaticAnalysisDetails.frames.length > 10 && doc.automaticAnalysisDetails.harmonics.length > 10, js.name);

// 5. Save as a separate experiment.
await auto.getByRole('button', { name: '💾 Save automatic result' }).click();
await wait(300);
v = await vow();
check('Save automatic result adds a second experiment; the manual one is byte-for-byte unchanged and still open',
  v.saved.length === 2 && JSON.stringify(v.saved[0]) === manualSaved && v.work.id === v.saved[0].id && v.saved[1].origin === 'auto' && v.saved[1].id !== v.saved[0].id);
check('The saved automatic experiment has the full 48-harmonic automatic array (no leftover manual values)',
  v.saved[1].count === 48 && JSON.stringify(v.saved[1].amps) === JSON.stringify(a.amps) && v.saved[1].autoAnalysis.f0Source === 'automatic');

// 6. Manual correction (an octave down), clearly labelled.
await page.fill('#vl-auto-f0', String(Math.round(a.f0 / 2 * 100) / 100));
await auto.getByRole('button', { name: 'Re-measure harmonics at this fundamental' }).click();
await wait(300);
v = await vow();
check('Typed correction is labelled manual; harmonics re-measured at the new f0; saved results untouched',
  v.auto.f0Source === 'manual' && Math.abs(v.auto.f0 - a.f0 / 2) < 0.01 && (await auto.locator('.vl-auto-tag').innerText()).includes('manual correction') && v.saved.length === 2 && v.auto.amps[0] === 0,
  `f0 ${v.auto.f0}, first amps ${v.auto.amps.slice(0, 4)}`);
await auto.getByRole('button', { name: 'Back to the automatic estimate' }).click();
await wait(300);
check('“Back to the automatic estimate” restores the automatic value', (await vow()).auto.f0Source === 'automatic' && (await vow()).auto.f0 === a.f0);

// 7. Reload: both experiments and the recording persist; open the automatic one.
await page.reload();
await page.waitForSelector('.vowel-lab');
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 1);
v = await vow();
check('After reload: both experiments restored, the manual one unchanged', v.saved.length === 2 && v.saved.some((e) => JSON.stringify(e) === manualSaved));
const autoId = v.saved.find((e) => e.origin === 'auto').id;
await page.locator('.vl-exp-select').selectOption(autoId);
await wait(300);
v = await vow();
check('Opening the automatic experiment loads all 48 automatic sliders (manual h2–h4 values gone)', v.work.id === autoId && v.work.count === 48 &&
  (await page.locator('.vl-row').count()) === 48 && JSON.stringify(v.work.amps) === JSON.stringify(a.amps));
check('Its label says automatic', (await page.locator('.vl-exp-select option:checked').innerText()).includes('automatic'));

// 8. Silence: a clear failure, nothing to save.
await page.locator('input[type=file][accept^=".wav"]').setInputFiles(silentPath);
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 2);
await wait(200);
await page.getByRole('button', { name: /^Use “/ }).click();
await wait(200);
await auto.getByRole('button', { name: '🔍 Analyze vowel' }).click();
await wait(300);
v = await vow();
const statusText = await auto.locator('.vl-auto-status').innerText();
check('Silent recording: “No reliable result”, an explanation, no f0 and nothing to play or save',
  v.auto.status === 'failed' && v.auto.f0 == null && v.auto.problems.includes('silent') && statusText.includes('No reliable result') && statusText.includes('silent') &&
  (await auto.getByRole('button', { name: '💾 Save automatic result' }).isDisabled()) && (await auto.getByRole('button', { name: 'Play Synthesized (automatic)' }).isDisabled()) &&
  (await page.inputValue('#vl-auto-f0')) === '', statusText.split('\n')[0]);
await page.screenshot({ path: shots + 'auto-02-silence.png', fullPage: false, clip: await auto.boundingBox() });

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (simulated recordings; no listening test).`);
process.exit(failed.length ? 1 : 0);

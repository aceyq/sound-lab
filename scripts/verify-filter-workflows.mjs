// Automated browser checks for the recording-free Vowel filtering workflows,
// starting from COMPLETELY EMPTY browser storage (a fresh browser profile):
//   1. Explore vowel examples (equal-strength harmonics, no recording)
//   2. Filter my own frequencies (custom components, no recording)
// Workflow 3 (Match a recording) is checked by scripts/verify-filter.mjs.
// Usage: start the app (npm run dev), then: node scripts/verify-filter-workflows.mjs [url]
//
// Sound is checked through the app's state, the live Web Audio nodes and the
// rendered samples, not by listening. Nothing here shows that the vowel
// examples sound like the intended vowels.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { decodeWav } from '../src/pages/frequency/wav.js';
import * as M from '../src/pages/frequency/vowel-model.js';
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
const fdbg = async () => (await dbg()).vowel.filter;
const hooks = (name, ...args) => page.evaluate(([n, a]) => window.__frequencyPlayground.vowelHooks.filter[n](...a), [name, args]);
const wait = (ms) => page.waitForTimeout(ms);
const sec = page.locator('section.vf');
const btn = (name) => sec.getByRole('button', { name, exact: true });
const storage = () => page.evaluate(() => ({ ...localStorage }));
const download = async (locator) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
};
const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Level change at each component: filtered vs unfiltered spectrum with the same
// window, so window effects cancel.
function levelChanges(wet, dry, sr, comps) {
  const opt = { from: Math.round(0.3 * sr), to: Math.round(2.6 * sr), fftSize: 16384 };
  const a = M.segmentSpectrum(wet, sr, opt);
  const b = M.segmentSpectrum(dry, sr, opt);
  return comps.map((c) => M.peakNear(a.db, a.binHz, c.freq, 2).db - M.peakNear(b.db, b.binHz, c.freq, 2).db);
}

const lsBefore = await storage();
check('Fresh browser: no saved experiments, filters or recordings', Object.keys(lsBefore).filter((k) => k.includes('vowelLab')).length === 0 && (await dbg()).vowel.recordings.length === 0, Object.keys(lsBefore).join(', ') || 'empty');
await page.getByRole('button', { name: '🎚 Vowel filtering', exact: true }).click();
await wait(800);
let f = await fdbg();
check('Vowel filtering opens in workflow 1 (Explore vowel examples) with recording controls hidden', f.work.workflow === 'explore' && f.work.source === 'harmonics' &&
  await sec.locator('[data-step="R"]').isHidden() && await sec.locator('.vf-match').isHidden() && await btn('▶ Play Filtered').isVisible() && await sec.getByRole('button', { name: 'Play Original (Vowel filtering)' }).isHidden());
const labels = await sec.locator('button.vf-ex').allInnerTexts();
check('Vowel buttons use pronunciation labels with example words', same(labels.map((t) => t.replace(/\s+/g, ' ').trim()), ['Aa · “father”', 'Eh · “bed”', 'Ee · “see”', 'Oh · “go”', 'Oo · “food”']), labels.join(' | '));
check('The Oh example explains the steady pronunciation', (await sec.locator('button.vf-ex[data-vowel="O"]').getAttribute('title')).includes('held steady'));

// ── Workflow 1: an Aa-like sound from a 200 Hz fundamental ──
await page.fill('#vf-f0', '200');
await page.press('#vf-f0', 'Enter');
await sec.locator('select[aria-label="Number of components (fundamental + harmonics)"]').selectOption('32');
await btn('▶ Start with all harmonics at maximum').click();
await wait(400);
f = await fdbg();
check('W1: Start plays 32 harmonics of 200 Hz, every oscillator gain exactly 1, filter bypassed', f.audio.state === 'synth' && f.audio.synth.voices.length === 32 &&
  f.audio.synth.voices.every((v) => v.gain === 1 && Math.abs(v.freq - v.n * 200) < 0.01) && f.audio.synth.dry === 1 && f.audio.synth.wet === 0);
await sec.getByRole('button', { name: 'Vowel example Aa, as in father' }).click();
await wait(300);
f = await fdbg();
const aa = VF.exampleFilter('A', 'women', f.rate);
check('W1: clicking Aa changes only the filter (f0 200, 32 harmonics, all amplitudes 1 kept); it plays filtered at once',
  f.work.f0 === 200 && f.work.count === 32 && f.work.sourceAmps.every((a) => a === 1) && same(f.work.filter.bands, aa.bands) && f.work.origin === 'example' && f.work.vowel === 'A' &&
  f.audio.synth.wet === 1 && f.audio.synth.voices.every((v) => v.gain === 1) && f.audio.synth.bands.every((b, i) => Math.abs(b.gainDb - aa.bands[i].gainDb) < 0.05), f.nowPlaying);
await sec.getByRole('button', { name: 'Stop (vowel examples)' }).click();
await wait(200);
await sec.getByRole('button', { name: 'Play filtered (vowel examples)' }).click();
await wait(300);
f = await fdbg();
check('W1: the explicit ▶ Play next to the vowels plays the filtered source', f.audio.state === 'synth' && f.audio.synth.wet === 1 && (await sec.locator('.vf-examples .vl-now').innerText()).includes('FILTERED'));
await sec.locator('.vf-filter-box').scrollIntoViewIfNeeded();
let hs = await hooks('handles');
const b2 = f.work.filter.bands[2];
await page.mouse.move(hs[2].x, hs[2].y);
await page.mouse.down();
for (let k = 1; k <= 6; k++) { await page.mouse.move(hs[2].x, hs[2].y + k * 12); await wait(30); }
await page.mouse.up();
await wait(300);
f = await fdbg();
check('W1: dragging a point changes the filter live; f0 and harmonics untouched', f.work.filter.bands[2].gainDb < b2.gainDb - 5 && f.work.editedAfter && f.work.f0 === 200 &&
  f.audio.synth.voices.every((v) => v.gain === 1 && Math.abs(v.freq - v.n * 200) < 0.01) && Math.abs(f.audio.synth.bands[2].gainDb - f.work.filter.bands[2].gainDb) < 0.05);
const live = await hooks('liveResponse', [100, 300, 700, 1200, 2500, 4000]);
const model = await hooks('modelResponse', [100, 300, 700, 1200, 2500, 4000]);
check('W1: the drawn filter = the live nodes’ response', live.every((d, i) => Math.abs(d - model[i]) < 0.05));
await page.screenshot({ path: shots + 'workflow-01-explore-aa.png', clip: await (async () => { const a = await sec.locator('.vf-examples').boundingBox(); const b = await sec.locator('.vf-spec-box').boundingBox(); return { x: 0, y: Math.max(0, a.y - 10), width: 1440, height: Math.min(1000, b.y + b.height - a.y + 60) }; })() });
await sec.getByRole('button', { name: 'Stop (Vowel filtering)' }).click();
check('W1: spectra show filtered + unfiltered only (no recording curve), filter response drawn', (await sec.locator('.vf-spec-box').isVisible()) && await sec.locator('.vf-legend-orig, [data-step="F"] .legend span:has(.vl-key-orig)').first().isHidden());
// Save + export without a recording.
await btn('💾 Save filter experiment').click();
await wait(200);
f = await fdbg();
const w1 = f.saved[0];
check('W1: saves with no recording (workflow, f0, count, filter, origin)', f.saved.length === 1 && w1.workflow === 'explore' && w1.source === 'harmonics' && w1.f0 === 200 && w1.count === 32 && w1.origin === 'example' && w1.recordingId === null);
const w1Wav = await hooks('renderWav');
const wav1 = await download(btn('⬇ Filtered synthesized WAV'));
const dec1 = decodeWav(toAB(wav1.data));
const dry1 = VF.renderFiltered({ f0: 200, count: 32, bands: w1.filter.bands, enabled: false, sampleRate: dec1.sampleRate, duration: 3 });
const ch1 = levelChanges(dec1.samples, dry1, dec1.sampleRate, VF.harmonicComponents(200, 32).slice(0, 20));
const g1 = VF.componentGains(VF.harmonicComponents(200, 32), w1.filter.bands, dec1.sampleRate).slice(0, 20);
check('W1: WAV downloads without a recording and each harmonic is reduced by the filter’s gain (within 0.5 dB, harmonics above −40 dB)', wav1.name === 'filter_aa_200hz_example_edited_filtered.wav' &&
  g1.every((x, i) => x.gainDb < -40 || Math.abs(ch1[i] - x.gainDb) < 0.5), `${wav1.name}; max diff ${Math.max(...g1.map((x, i) => (x.gainDb < -40 ? 0 : Math.abs(ch1[i] - x.gainDb)))).toFixed(2)} dB`);
const js1 = await download(btn('⬇ Settings JSON'));
const doc1 = JSON.parse(js1.data.toString());
check('W1: settings JSON without a recording (workflow, equal-strength source, f0, filter)', doc1.workflow === 'explore' && doc1.sourceType === 'harmonics' && doc1.fundamentalHz === 200 && doc1.recording === null && doc1.source.amplitudes.length === 32);

// ── Workflow 2: my own frequencies ──
await sec.locator('button.vf-tab[data-wf="custom"]').click();
await wait(300);
f = await fdbg();
check('W2: switching starts a new unsaved experiment with my-own-frequencies rows; the saved W1 experiment is untouched', f.work.workflow === 'custom' && f.work.source === 'custom' && f.work.components.length === 8 && f.work.id !== w1.id && same(f.saved[0], w1) &&
  await sec.locator('.vf-custom').isVisible() && await sec.locator('.vf-harm').isHidden());
// Edit, add a non-harmonic row, remove one.
await sec.locator('input[aria-label="Component 1 amplitude (0–1)"]').fill('0.8');
await sec.locator('input[aria-label="Component 1 amplitude (0–1)"]').press('Enter');
await btn('Remove component 8').click();
await btn('＋ Add component').click();
await sec.locator('input[aria-label="Component 8 frequency (Hz)"]').fill('1234.5');
await sec.locator('input[aria-label="Component 8 frequency (Hz)"]').press('Enter');
await sec.locator('input[aria-label="Component 8 amplitude (0–1)"]').fill('0.3');
await sec.locator('input[aria-label="Component 8 amplitude (0–1)"]').press('Enter');
await wait(200);
f = await fdbg();
const myRows = f.work.components;
check('W2: rows edited as typed: 200 Hz × 0.8, harmonics 2–7 at 1/n, plus a non-harmonic 1234.5 Hz × 0.3', myRows.length === 8 && myRows[0].amp === 0.8 && myRows[0].freq === 200 && myRows[7].freq === 1234.5 && myRows[7].amp === 0.3 && myRows[3].amp === 0.25, JSON.stringify(myRows.map((c) => [c.freq, c.amp])));
await btn('▶ Play Unfiltered').click();
await wait(300);
f = await fdbg();
check('W2: unfiltered playback: one oscillator per row, gain = my amplitude, frequency = my frequency', f.audio.synth.voices.length === 8 && f.audio.synth.voices.every((v, i) => Math.abs(v.gain - myRows[i].amp) < 1e-6 && Math.abs(v.freq - myRows[i].freq) < 0.01) && f.audio.synth.dry === 1);
await sec.getByRole('button', { name: 'Vowel example Ee, as in see' }).click();
await wait(300);
f = await fdbg();
check('W2: Ee example on my rows: filter changed, rows unchanged (frequencies and amplitudes not reset to 1), sound now filtered', same(f.work.components, myRows) && f.work.origin === 'example' && f.audio.synth.wet === 1 &&
  f.audio.synth.voices.every((v, i) => Math.abs(v.gain - myRows[i].amp) < 1e-6));
await sec.locator('.vf-filter-box').scrollIntoViewIfNeeded();
hs = await hooks('handles');
await page.mouse.move(hs[3].x, hs[3].y);
await page.mouse.down();
for (let k = 1; k <= 6; k++) { await page.mouse.move(hs[3].x - k * 5, hs[3].y + k * 12); await wait(30); }
await page.mouse.up();
await wait(300);
f = await fdbg();
check('W2: dragging the filter leaves every row unchanged', same(f.work.components, myRows) && f.audio.synth.voices.every((v, i) => Math.abs(v.gain - myRows[i].amp) < 1e-6 && Math.abs(v.freq - myRows[i].freq) < 0.01));
check('W2: readouts call the rows “components”', (await sec.locator('.vf-custom .vf-components').innerText()).includes('8 of 8 components sound'));
await page.screenshot({ path: shots + 'workflow-02-custom.png', clip: await (async () => { const a = await sec.locator('.vf-custom').boundingBox(); return { x: 0, y: Math.max(0, a.y - 60), width: 1440, height: 1000 }; })() });
await sec.getByRole('button', { name: 'Stop (Vowel filtering)' }).click();
await btn('💾 Save filter experiment').click();
await wait(200);
f = await fdbg();
const w2 = f.saved[1];
const wav2 = await download(btn('⬇ Filtered synthesized WAV'));
const dec2 = decodeWav(toAB(wav2.data));
const rendered2 = await hooks('renderWav');
let d2 = 0;
for (let i = 0; i < dec2.samples.length; i += 37) d2 = Math.max(d2, Math.abs(dec2.samples[i] - rendered2.samples[i]));
const dry2 = VF.renderFiltered({ components: myRows, bands: w2.filter.bands, enabled: false, sampleRate: dec2.sampleRate, duration: 3 });
const ch2 = levelChanges(dec2.samples, dry2, dec2.sampleRate, myRows);
const g2 = await hooks('componentGains');
check('W2: filtering reduces each of my components by exactly the filter gain at its frequency (WAV, within 0.5 dB)', g2.every((x, i) => x.gainDb < -40 || Math.abs(ch2[i] - x.gainDb) < 0.5),
  g2.map((x, i) => `${x.freq} Hz: filter ${x.gainDb.toFixed(1)} / WAV ${ch2[i].toFixed(1)} dB`).join('; '));
check('W2: WAV = the app’s render, named for the custom source, no clipping', d2 < 1 / 16000 && wav2.name.startsWith('filter_ee_custom8_example') && VF.peakOf(dec2.samples) < VF.SAFE_PEAK, `${wav2.name}, peak ${VF.peakOf(dec2.samples).toFixed(3)}`);
const js2 = await download(btn('⬇ Settings JSON'));
const doc2 = JSON.parse(js2.data.toString());
const back2 = VF.parseFilterSettings(doc2);
check('W2: settings JSON keeps every component and parses back to the same rows and filter', doc2.sourceType === 'custom' && doc2.fundamentalHz === null && back2.ok && same(back2.experiment.components, myRows) && same(back2.experiment.filter.bands, w2.filter.bands));
// Load a copy of Manual frequencies.
const manual = (await dbg()).comps;
await btn('⧉ Load a copy of my Manual frequencies setup').click();
await wait(200);
f = await fdbg();
check('W2: “Load a copy of my Manual frequencies setup” copies the table (frequencies, amplitudes, on/off); Manual mode unchanged', same(f.work.components.map((c) => [c.freq, c.amp, c.on]), manual.map((c) => [c.freq, c.amp, c.enabled])) && same((await dbg()).comps, manual), JSON.stringify(manual));
await btn('Replace rows with these harmonics').click();
await wait(200);
f = await fdbg();
check('W2: “Generate harmonics” convenience fills rows at n × f0 (here 12 × 200 Hz, amplitude 1)', f.work.components.length === 12 && f.work.components.every((c, i) => c.freq === 200 * (i + 1) && c.amp === 1));

// Reload: both restore, with their sound.
await page.reload();
await page.waitForSelector('section.vf');
await wait(600);
f = await fdbg();
check('Reload: the latest (workflow 2) experiment reopens with my rows, filter and workflow', f.work.id === w2.id && f.work.workflow === 'custom' && same(f.work.components, myRows) && !f.dirty && await sec.locator('.vf-custom').isVisible());
check('Reload: it renders the identical sound', same((await hooks('renderWav')).samples.slice(0, 3000), rendered2.samples.slice(0, 3000)));
await sec.locator('select[aria-label="Filter experiment"]').selectOption(w1.id);
await wait(300);
f = await fdbg();
check('Reload: the workflow 1 experiment reopens as Explore with f0 200 and the identical sound', f.work.workflow === 'explore' && f.work.f0 === 200 && same((await hooks('renderWav')).samples.slice(0, 3000), w1Wav.samples.slice(0, 3000)));
const ls = await storage();
check('Only the filter-experiment key was written (no Vowel Lab experiment or recording created)', !('frequencyPlayground.vowelLab.experiments.v1' in ls) && (await dbg()).vowel.recordings.length === 0 && JSON.parse(ls['frequencyPlayground.vowelLab.filterExperiments.v1']).length === 2);

// Tour with no recordings at all.
await sec.getByRole('button', { name: '❓ Tour: vowel filtering' }).click();
let n = 0;
let ok = true;
const seen = [];
for (; n < 20; n++) {
  await wait(600);
  const t = (await fdbg()).tour;
  if (!t.open) break;
  const note = await page.locator('.vtour-note').isVisible();
  seen.push(t.stepId + (note ? '*' : ''));
  const rect = await hooks('tourTargetRect');
  if (rect && rect.height < 900 && (rect.top < -2 || rect.bottom > 1002)) ok = false;
  if (t.stepId === 'recording') await page.screenshot({ path: shots + 'workflow-03-tour-no-recording.png' });
  await page.locator('.vtour-pop .tour-buttons .btn.primary').click();
}
check('Tour works with no recordings: every step opens, controls are in view, recording steps explain and point at the workflow 3 tab', ok && n === 15 && seen.includes('recording*') && seen.includes('match*'), seen.join(' → '));

// Phone width, workflow 2.
await sec.locator('select[aria-label="Filter experiment"]').selectOption(w2.id);
await page.setViewportSize({ width: 390, height: 844 });
await wait(500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('Phone width 390 px (workflow 2): no horizontal page scroll', overflow <= 0, `${overflow}px`);
await sec.locator('.vf-tabs').scrollIntoViewIfNeeded();
await wait(400);
await page.screenshot({ path: shots + 'workflow-04-phone.png' });

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (simulated; no listening test).`);
writeFileSync(shots + 'workflow-results.json', JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);

// Automated browser checks for Vowel filtering (assignment 4).
// Usage: start the app (npm run dev), then: node scripts/verify-filter.mjs [url]
// Needs the `playwright` package (npm i -D playwright, or a global install).
//
// SIMULATED INPUT: no singing. The script imports a generated WAV through the
// Vowel Lab's "Import a WAV recording" button: a 248 Hz vowel-like tone (a
// falling source shaped by resonances near 300 / 870 / 2240 Hz, textbook
// values for "oo"), with a slow pitch wobble and a little noise. Playback is
// checked through the app's state and the Web Audio nodes, not by listening.
// None of this shows that a real recorded vowel is matched well or that the
// filtered sound is heard as the intended vowel.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav, decodeWav } from '../src/pages/frequency/wav.js';
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

// ── simulated "oo" recording ──
const SR = 48000;
const F0 = 248;
const FORMANTS = [[300, 60, 1], [870, 90, 0.35], [2240, 120, 0.12]];
const trueAmp = (f) => (1 / (1 + (f / 400) ** 2)) * FORMANTS.reduce((s, [fc, bw, g]) => s + g / Math.sqrt(1 + ((f - fc) / (bw / 2)) ** 2), 0.01);
const N_TRUE = Math.floor(8000 / F0);
const TRUE = Array.from({ length: N_TRUE }, (_, i) => trueAmp((i + 1) * F0));
const TOP = Math.max(...TRUE);
let seed = 3;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function vowelLike(sec) {
  const x = new Float32Array(Math.round(SR * sec));
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const f = F0 * (1 + 0.003 * Math.sin(2 * Math.PI * 4.5 * t));
    ph += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let n = 1; n <= N_TRUE; n++) s += TRUE[n - 1] * Math.sin(n * ph + 0.7 * n * n);
    const env = Math.min(1, t / 0.15, (sec - t) / 0.15);
    x[i] = env * (0.3 * s / TOP) + (rnd() - 0.5) * 0.002;
  }
  return x;
}
const vowelPath = join(tmpdir(), 'fp-filter-oo-sim.wav');
writeFileSync(vowelPath, Buffer.from(encodeWav(vowelLike(3), SR).buffer));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// Saved experiments like the ones made in assignments 2 and 3, seeded before
// the page loads, so we can confirm that Vowel filtering leaves them alone.
const SEEDED = [
  M.makeExperiment({ vowel: 'oo', pitch: 'lower', f0: 248, count: 32, amps: M.startRecipe('fundamental', 32).map((a, i) => (i === 1 ? 0.1 : i === 2 ? 0.05 : a)), savedAt: '2026-10-20T10:00:00.000Z' }),
  M.makeExperiment({ vowel: 'oo', pitch: 'lower', f0: 247.6, count: 48, origin: 'auto', amps: Array.from({ length: 48 }, (_, i) => (i < 6 ? 1 / (i + 1) : 0)), savedAt: '2026-10-26T10:00:00.000Z' }),
];
const SEEDED_JSON = JSON.stringify(SEEDED);

const errors = [];
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.addInitScript((seeded) => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.setItem('frequencyPlayground.vowelLab.experiments.v1', seeded);
    sessionStorage.setItem('seeded', '1');
  }
}, SEEDED_JSON);
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
const STOP = 'Stop (Vowel filtering)';
const btn = (name) => sec.getByRole('button', { name, exact: true });
const lsExperiments = () => page.evaluate(() => localStorage.getItem('frequencyPlayground.vowelLab.experiments.v1'));
const download = async (locator) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
};
const chartClip = async () => {
  await sec.locator('.vf-filter-box').scrollIntoViewIfNeeded();
  const a = await sec.locator('.vf-filter-box').boundingBox();
  const b = await sec.locator('.vf-spec-box').boundingBox();
  return { x: a.x - 10, y: a.y - 50, width: a.width + 20, height: b.y + b.height - a.y + 90 };
};
const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// 0. The mode bar's "Vowel filtering" button opens Vowel Lab at the section.
await page.getByRole('button', { name: '🎚 Vowel filtering', exact: true }).click();
await wait(800);
let v = await dbg();
check('Mode bar “🎚 Vowel filtering” opens Vowel Lab and scrolls to the section', v.mode === 'vowel' && (await sec.count()) === 1 &&
  (await sec.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })));
check('The seeded manual and automatic experiments loaded unchanged', v.vowel.saved.length === 2 && (await lsExperiments()) === SEEDED_JSON);
check('Section explains source + filter in the requested words', (await sec.innerText()).includes('The source starts with the fundamental and all active harmonics at equal strength. The filter reduces selected frequency regions, changing the balance of harmonics and the vowel-like character of the sound.'));

// 1. Import the simulated recording through the existing Vowel Lab control,
//    then choose workflow 3, “Match a recording”.
let f = await fdbg();
check('With no recordings the section opens in workflow 1 (no recording controls shown)', f.work.workflow === 'explore' && await sec.locator('[data-step="R"]').isHidden());
await page.locator('input[type=file][accept^=".wav"]').setInputFiles(vowelPath);
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 1);
await wait(400);
await sec.locator('button.vf-tab[data-wf="recording"]').click();
await wait(300);
f = await fdbg();
check('Workflow 3 shows the recording controls', f.work.workflow === 'recording' && f.work.source === 'harmonics' && await sec.locator('[data-step="R"]').isVisible());
check('A new recording is picked up by Vowel filtering, with a default middle section', !!f.work.recordingId && f.work.segment && Math.abs(f.work.segment.start - 1) < 0.01, JSON.stringify(f.work.segment));
check('Fundamental starts as a labelled default, not a guess from earlier work', f.work.f0Source === 'default' && (await sec.locator('.vf-f0 .vf-tag').innerText()).includes('default'));

// 2. Estimate f0 automatically.
await btn('🔍 Estimate from the recording').click();
await wait(300);
f = await fdbg();
check('🔍 Estimate gives an automatic f0 near the simulated 248 Hz, labelled automatic', f.work.f0Source === 'automatic' && Math.abs(f.work.f0 - F0) < 1.5 && (await sec.locator('.vf-f0 .vf-tag').innerText()).includes('automatic'), `${f.work.f0} Hz`);
const f0Auto = f.work.f0;

// 3. Start with all harmonics at maximum.
await btn('▶ Start with all harmonics at maximum').click();
await wait(500);
f = await fdbg();
const syn = f.audio.synth;
const active = VF.activeHarmonics(f.work.f0, f.work.count, f.rate);
check('Start: plays with the filter bypassed (dry 1, wet 0), labelled UNFILTERED', f.audio.state === 'synth' && syn && syn.dry === 1 && syn.wet === 0 && f.nowPlaying.includes('UNFILTERED'), f.nowPlaying);
check(`Start: every one of the ${f.work.count} oscillators has its own gain exactly 1, at n × f0`, syn.voices.length === f.work.count && syn.voices.every((x) => x.gain === 1 && Math.abs(x.freq - x.n * f.work.f0) < 0.01) && f.work.sourceAmps.every((a) => a === 1));
check('Start: one shared safety gain = 0.7 ÷ active components (not dozens of full-volume oscillators)', Math.abs(syn.sourceGain - VF.SAFE_PEAK / active.length) < 1e-6, `${syn.sourceGain} for ${active.length} components`);
check('Component readout lists the active count and frequencies', (await sec.locator('.vf-harm .vf-components').innerText()).includes(`${active.length} active components, every amplitude 1`));

// 4. Filter on, then drag point 3 down and to the right.
await btn('○ Filter BYPASSED (press to turn on)').click();
await wait(200);
f = await fdbg();
check('Filter ON switches live to the filtered path (wet 1, dry 0) and the label says FILTERED', f.audio.synth.wet === 1 && f.audio.synth.dry === 0 && f.nowPlaying.includes('FILTERED') && !f.nowPlaying.includes('UNFILTERED'), f.nowPlaying);
await sec.locator('.vf-filter-box').scrollIntoViewIfNeeded();
let hs = await hooks('handles');
const before = (await fdbg()).work.filter.bands[2];
await page.mouse.move(hs[2].x, hs[2].y);
await page.mouse.down();
for (let k = 1; k <= 8; k++) { await page.mouse.move(hs[2].x + k * 4, hs[2].y + k * 15); await wait(30); }
await page.mouse.up();
await wait(400);
f = await fdbg();
const after = f.work.filter.bands[2];
check('Dragging point 3 down and right lowers its gain and raises its centre', after.gainDb < before.gainDb - 10 && after.f > before.f && f.selected === 2, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
check('Dragging changed only the filter: f0, count, source amplitudes and harmonic spacing unchanged', f.work.f0 === f0Auto && f.work.sourceAmps.every((a) => a === 1) &&
  f.audio.synth.voices.every((x) => x.gain === 1 && Math.abs(x.freq - x.n * f0Auto) < 0.01));
check('The live BiquadFilterNodes follow the drag (type peaking, same centre/gain/Q)', f.audio.synth.bands.every((b, i) => b.type === 'peaking' && Math.abs(b.f - f.work.filter.bands[i].f) < 0.5 && Math.abs(b.gainDb - f.work.filter.bands[i].gainDb) < 0.05 && Math.abs(b.q - f.work.filter.bands[i].q) < 0.01));
// Keyboard alternative.
await sec.locator('.vf-filter-canvas').focus();
await page.keyboard.press('5');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await wait(100);
f = await fdbg();
check('Keyboard: 5 selects point 5, ↓↓ cuts it by 2 dB', f.selected === 4 && f.work.filter.bands[4].gainDb === -2);
// Number fields.
const cut = sec.locator('input[aria-label="Point 6 cut (dB)"]');
await cut.fill('-18');
await cut.press('Enter');
await sec.locator('input[aria-label="Point 6 cut (dB)"]').fill('5');
await sec.locator('input[aria-label="Point 6 cut (dB)"]').press('Enter');
await wait(200);
f = await fdbg();
check('Typed cut −18 dB applies; a typed boost (+5 dB) is refused', f.work.filter.bands[5].gainDb === -18 && (await sec.locator('input[aria-label="Point 6 cut (dB)"]').getAttribute('class')).includes('invalid'));

// 5. The drawn curve is the browser's own filter response.
await wait(300);
const freqs = [];
for (let x = 60; x < 8000; x *= 1.07) freqs.push(Math.round(x));
const live = await hooks('liveResponse', freqs);
const model = await hooks('modelResponse', freqs);
const respDiff = Math.max(...live.map((d, i) => Math.abs(d - model[i])));
check('Displayed response = BiquadFilterNode.getFrequencyResponse of the live nodes (max difference < 0.05 dB)', respDiff < 0.05, `max ${respDiff.toFixed(4)} dB over ${freqs.length} frequencies`);
const off = await hooks('renderOffline', 0.5);
const mod = await hooks('renderModel', 0.5);
let maxd = 0;
for (let i = 0; i < Math.min(off.length, mod.length); i++) maxd = Math.max(maxd, Math.abs(off[i] - mod[i]));
check('The browser’s own rendering of the graph (OfflineAudioContext) equals the WAV renderer', off.length === mod.length && maxd < 2e-3, `max sample difference ${maxd.toExponential(2)} (peak ${VF.peakOf(mod).toFixed(3)})`);
await btn(STOP).click();
await wait(200);
check('Stop stops it', (await fdbg()).audio.state === 'idle');
await page.screenshot({ path: shots + 'filter-01-manual-drag.png', clip: await chartClip() });

// 6. Compare buttons.
await btn('⇄ Original → Filtered').click();
await wait(300);
f = await fdbg();
check('Original → Filtered starts with the ORIGINAL section', f.audio.state === 'ab' && f.audio.abPhase === 'original' && f.nowPlaying.includes('ORIGINAL'));
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.filter.audio.abPhase === 'synth', null, { timeout: 5000 });
f = await fdbg();
check('…then the FILTERED source (wet path, all gains 1)', f.nowPlaying.includes('FILTERED') && f.audio.synth.wet === 1 && f.audio.synth.voices.every((x) => x.gain === 1));
await btn(STOP).click();
await btn('Play Original (Vowel filtering)').click();
await wait(300);
f = await fdbg();
check('Play Original plays the recording section, peak-matched to the filtered sound', f.audio.state === 'original' && f.nowPlaying.includes('ORIGINAL') && f.audio.originalLevel > 0);
await btn('▶ Play Unfiltered').click();
await wait(300);
f = await fdbg();
check('Play Unfiltered: bypass path, same source gain as filtered (consistent level)', f.audio.synth.dry === 1 && f.audio.synth.wet === 0 && Math.abs(f.audio.synth.sourceGain - VF.SAFE_PEAK / active.length) < 1e-6 && f.work.filter.bands[5].gainDb === -18);
await btn(STOP).click();
// Vowel Lab and filter sound never overlap.
await btn('▶ Play Filtered').click();
await wait(200);
await page.locator('.vl-bar').getByRole('button', { name: '▶ Play Synthesized' }).click();
await wait(300);
v = await dbg();
check('Starting the Vowel Lab synthesizer stops Vowel filtering (one sound at a time)', v.vowel.audio.state === 'synth' && v.vowel.filter.audio.state === 'idle');
await page.locator('.vl-bar').getByRole('button', { name: '■ Stop' }).click();

// 7. Save the manual filter experiment.
const manualBands = JSON.stringify((await fdbg()).work.filter.bands);
await btn('💾 Save filter experiment').click();
await wait(200);
f = await fdbg();
check('Save: one filter experiment stored; Vowel Lab experiments byte-for-byte unchanged', f.saved.length === 1 && !f.dirty && (await lsExperiments()) === SEEDED_JSON && (await dbg()).vowel.saved.length === 2);
const savedManual = JSON.stringify(f.saved[0]);
const wavManual = await hooks('renderWav');

// 8. Automatic fit.
await btn('🎯 Match filter to recording').click();
await wait(800);
f = await fdbg();
check('Match filter: new unsaved “fitted” experiment; saved manual filter untouched', f.work.origin === 'fitted' && f.dirty && f.saved.length === 1 && JSON.stringify(f.saved[0]) === savedManual && f.work.id !== f.saved[0].id);
check('Match filter changed only filter parameters: every source amplitude still 1, count and f0 kept', f.work.sourceAmps.length === f.work.count && f.work.sourceAmps.every((a) => a === 1) && Math.abs(f.work.f0 - f0Auto) < 0.5 && f.work.filter.bands.every((b) => b.gainDb <= 0));
check('Fit result reported with its error', f.fit && f.fit.ok && Number.isFinite(f.fit.summary.rmsErrorDb), f.fit && `RMS ${f.fit.summary.rmsErrorDb} dB, max ${f.fit.summary.maxErrorDb} dB, ${f.fit.summary.measuredPoints} measured + ${f.fit.summary.upperLimitPoints} upper-limit harmonics, offset ${f.fit.summary.levelOffsetDb} dB`);
// How close is the filtered source to the simulation's true harmonic pattern?
const g = VF.harmonicGains(f.work.f0, f.work.count, f.work.filter.bands, f.rate);
const strong = TRUE.map((t, i) => [i + 1, 20 * Math.log10(t / TOP)]).filter(([n, d]) => d > -30 && n <= g.length);
const fitErr = strong.map(([n, d]) => (g[n - 1].gainDb - f.fit.summary.levelOffsetDb) - d);
const rmsTrue = Math.sqrt(fitErr.reduce((s, e) => s + e * e, 0) / fitErr.length);
check('Fitted filter reproduces the simulation’s harmonic pattern (harmonics above −30 dB) within 3 dB RMS', rmsTrue < 3, `${rmsTrue.toFixed(2)} dB RMS over ${strong.length} harmonics; ${strong.map(([n], i) => `h${n} ${fitErr[i].toFixed(1)}`).join(', ')}`);
check('Vowel Lab sliders and experiments untouched by the fit', (await lsExperiments()) === SEEDED_JSON && JSON.stringify((await dbg()).vowel.work.amps) === JSON.stringify(SEEDED[1].amps));
await page.screenshot({ path: shots + 'filter-02-fitted.png', clip: await chartClip() });
await btn('💾 Save filter experiment').click();
await wait(200);
f = await fdbg();
check('Saving the fit adds a second, separate filter experiment', f.saved.length === 2 && JSON.stringify(f.saved[0]) === savedManual && f.saved[1].origin === 'fitted');
const fittedId = f.work.id;
const wavFitted = await hooks('renderWav');

// 9. Downloads.
const wav = await download(btn('⬇ Filtered synthesized WAV'));
const dec = decodeWav(toAB(wav.data));
let same = dec.samples.length === wavFitted.samples.length;
for (let i = 0; same && i < dec.samples.length; i += 31) if (Math.abs(dec.samples[i] - wavFitted.samples[i]) > 1 / 16000) same = false;
const ex = M.segmentSpectrum(dec.samples, dec.sampleRate, { from: Math.round(0.3 * dec.sampleRate), to: Math.round(2.6 * dec.sampleRate), fftSize: 8192 });
const src = VF.renderSource({ f0: f.work.f0, count: f.work.count, sampleRate: dec.sampleRate, duration: 3 });
const exSrc = M.segmentSpectrum(src, dec.sampleRate, { from: Math.round(0.3 * dec.sampleRate), to: Math.round(2.6 * dec.sampleRate), fftSize: 8192 });
const gw = VF.harmonicGains(f.work.f0, f.work.count, f.work.filter.bands, dec.sampleRate).filter((x) => x.gainDb > -40);
const wavErr = gw.map((x) => (M.peakNear(ex.db, ex.binHz, x.freq, 3).db - M.peakNear(exSrc.db, exSrc.binHz, x.freq, 3).db) - x.gainDb);
check('WAV includes the filter: each harmonic sits at its filter gain below the unfiltered source (within 1 dB)', wavErr.every((e) => Math.abs(e) < 1), `max ${Math.max(...wavErr.map(Math.abs)).toFixed(2)} dB over ${gw.length} harmonics`);
check('WAV = the app’s render (same source, filter and level), 16-bit, no clipping, ends with the ring-out', same && wav.name.endsWith('_filtered.wav') && VF.peakOf(dec.samples) < VF.SAFE_PEAK && dec.samples.length === Math.round((3 + VF.TAIL_SEC) * dec.sampleRate), `${wav.name}, peak ${VF.peakOf(dec.samples).toFixed(3)}`);
const js = await download(btn('⬇ Settings JSON'));
const doc = JSON.parse(js.data.toString());
const back = VF.parseFilterSettings(doc);
check('Settings JSON: all-ones source, 8 bands with coefficients, recording + section, origin; it parses back to the same filter',
  doc.format === VF.FILTER_FORMAT && doc.source.amplitudes.every((a) => a === 1) && doc.filter.bands.length === 8 && doc.filter.bands[0].coefficients && doc.recording && doc.recording.sectionSec && doc.origin === 'fitted' &&
  back.ok && JSON.stringify(back.experiment.filter.bands) === JSON.stringify(f.work.filter.bands), js.name);

// 9b. Optional makeup gain: off by default, clearly labelled, one constant factor.
check('Makeup gain is off by default (the filtered sound shows the filter’s real reduction)', (await fdbg()).makeupDb === 0 && !(await sec.locator('.vf-makeup input').isChecked()));
await sec.locator('.vf-makeup input').check();
await wait(200);
f = await fdbg();
const wavMk = await hooks('renderWav');
const ratio = VF.peakOf(wavMk.samples) / VF.peakOf(wavFitted.samples);
check('Makeup ON: one labelled constant gain; WAV = fixed-gain WAV × that gain (balance unchanged), peak at the unfiltered level',
  f.makeupDb > 6 && Math.abs(20 * Math.log10(ratio) - f.makeupDb) < 0.01 && (await sec.locator('.vf-level').innerText()).includes('Makeup gain ON'), `+${f.makeupDb.toFixed(1)} dB, peak ${VF.peakOf(wavMk.samples).toFixed(3)}`);
await btn('▶ Play Filtered').click();
await wait(300);
f = await fdbg();
check('Makeup ON: live wet gain equals the makeup factor; source gains still 1', Math.abs(20 * Math.log10(f.audio.synth.wet) - f.makeupDb) < 0.05 && f.audio.synth.voices.every((x) => x.gain === 1));
await btn(STOP).click();
await sec.locator('.vf-makeup input').uncheck();
await wait(100);
check('Makeup OFF again restores the fixed gain', (await fdbg()).makeupDb === 0);

// 10. Vowel examples.
const exBands = {};
const beforeEx = await fdbg();
for (const id of ['A', 'E', 'I', 'O', 'U']) {
  await sec.locator(`button.vf-ex[data-vowel="${id}"]`).click();
  await wait(200);
  f = await fdbg();
  exBands[id] = JSON.stringify(f.work.filter.bands);
  check(`Load vowel example ${id}: only the filter changes (f0, count, all-ones source and recording label kept; saved list unchanged)`, f.work.origin === 'example' && f.work.example.vowel === id && f.work.example.formants.length === 3 && f.saved.length === 2 &&
    f.work.f0 === beforeEx.work.f0 && f.work.count === beforeEx.work.count && f.work.sourceAmps.every((a) => a === 1) && f.work.vowel === beforeEx.work.vowel && f.work.recordingId === beforeEx.work.recordingId,
    `F1–F3 ${f.work.example.formants.join('/')}, fit ${f.work.fit.rmsErrorDb} dB RMS`);
}
check('The five examples are five different filters', new Set(Object.values(exBands)).size === 5);
await sec.locator('button.vf-ex[data-vowel="I"]').click();
await wait(300);
await page.screenshot({ path: shots + 'filter-03-example-I.png', clip: await chartClip() });
const f0Before = (await fdbg()).work.f0;
await page.fill('#vf-f0', '330');
await page.press('#vf-f0', 'Enter');
await wait(200);
f = await fdbg();
check('Changing f0 keeps the filter frequencies fixed (only the harmonics move); labelled as typed', JSON.stringify(f.work.filter.bands) === exBands.I && f.work.f0 === 330 && f.work.f0Source === 'typed', `${f0Before} → 330 Hz`);

// 11. Reload: saved filter experiments and the sound come back.
await page.reload();
await page.waitForSelector('section.vf');
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 1);
await wait(500);
f = await fdbg();
check('After reload the most recent filter experiment (the fit) reopens with the same filter', f.work.id === fittedId && f.saved.length === 2 && !f.dirty);
const wavAgain = await hooks('renderWav');
check('…and renders the identical sound', JSON.stringify(wavAgain.samples.slice(0, 4000)) === JSON.stringify(wavFitted.samples.slice(0, 4000)) && wavAgain.samples.length === wavFitted.samples.length);
await sec.locator('select[aria-label="Filter experiment"]').selectOption((await fdbg()).saved[0].id);
await wait(300);
f = await fdbg();
check('Opening the saved manual filter restores its points and its sound exactly', JSON.stringify(f.work.filter.bands) === manualBands && JSON.stringify((await hooks('renderWav')).samples.slice(0, 4000)) === JSON.stringify(wavManual.samples.slice(0, 4000)));
check('Vowel Lab experiments still byte-for-byte as seeded; recording still there', (await lsExperiments()) === SEEDED_JSON && (await dbg()).vowel.recordings.length === 1);

// 12. Guided tour (desktop).
await sec.getByRole('button', { name: '❓ Tour: vowel filtering' }).click();
await wait(400);
let tourOk = true;
const tourInfo = [];
const TOUR_N = 15;
for (let k = 0; k < TOUR_N; k++) {
  await wait(650);
  const d = (await fdbg()).tour;
  const rect = await hooks('tourTargetRect');
  const inView = !rect || (rect.top >= -2 && rect.bottom <= 1000 + 2) || rect.height > 900;
  tourInfo.push(`${d.stepId}${rect ? '' : '(card only)'}`);
  if (!d.open || !inView) tourOk = false;
  if (k === 5) await page.screenshot({ path: shots + 'filter-04-tour-desktop.png' });
  await page.getByRole('button', { name: k === TOUR_N - 1 ? 'Finish ✓' : 'Next →' }).click();
}
check(`Tour: ${TOUR_N} short steps, each highlighted control scrolled into view`, tourOk && !(await fdbg()).tour.open, tourInfo.join(' → '));

// 13. Manual mode still works.
await page.getByRole('button', { name: '🎛 Manual frequencies' }).click();
await wait(300);
v = await dbg();
check('Manual frequencies mode still opens', v.mode === 'manual');
await page.getByRole('button', { name: '🗣 Vowel Lab: harmonic sliders' }).click();
await wait(300);

// 14. Phone width.
await page.setViewportSize({ width: 390, height: 844 });
await wait(500);
await sec.scrollIntoViewIfNeeded();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('Phone width 390 px: no horizontal page scroll', overflow <= 0, `overflow ${overflow}px`);
await sec.locator('.vf-filter-box').scrollIntoViewIfNeeded();
await page.screenshot({ path: shots + 'filter-05-phone.png' });
hs = await hooks('handles');
const b0 = (await fdbg()).work.filter.bands[1];
await page.mouse.move(hs[1].x, hs[1].y);
await page.mouse.down();
for (let k = 1; k <= 6; k++) { await page.mouse.move(hs[1].x, hs[1].y + k * 10); await wait(30); }
await page.mouse.up();
await wait(200);
check('Phone width: dragging a point still works', (await fdbg()).work.filter.bands[1].gainDb < b0.gainDb - 5);
await sec.getByRole('button', { name: '❓ Tour: vowel filtering' }).click();
let phoneOk = true;
for (let k = 0; k < TOUR_N; k++) {
  await wait(650);
  const rect = await hooks('tourTargetRect');
  if (rect && rect.height < 800 && (rect.top < -2 || rect.bottom > 846)) phoneOk = false;
  const card = await page.locator('.vtour-pop').boundingBox();
  if (!card || card.x < 0 || card.x + card.width > 391) phoneOk = false;
  if (k === 5) await page.screenshot({ path: shots + 'filter-06-tour-phone.png' });
  await page.getByRole('button', { name: k === TOUR_N - 1 ? 'Finish ✓' : 'Next →' }).click();
}
check('Phone width: tour targets and cards stay on screen', phoneOk);

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
writeFileSync(shots + 'filter-results.json', JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);

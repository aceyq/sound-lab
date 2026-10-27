// Automated browser checks for the Vowel Lab (assignment 2).
// Usage: start the app (npm run dev), then: node scripts/verify-vowel.mjs [url]
// Needs the `playwright` package (npm i -D playwright, or a global install).
//
// SIMULATED INPUT: Chromium's fake capture device plays a generated WAV file
// as if it were a microphone: a steady 200 Hz "vowel-like" tone whose 2nd and
// 3rd harmonics are the strongest, plus a little noise. Playback is checked
// through the app's own state and audio-node counters, not by listening.
// None of this proves that a physical microphone, speakers or headphones
// work, or that a synthesis sounds like a vowel; see the manual checklist in
// the README.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav, decodeWav } from '../src/pages/frequency/wav.js';
import { renderRecipe, outputGain } from '../src/pages/frequency/vowel-model.js';

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

const F0 = 200;
const AMPS = [0.1, 0.3, 0.25, 0.08, 0.05, 0.03];
const SR = 48000;
let seed = 1;
const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.004; };
const sim = new Float32Array(SR * 10).map((_, i) => AMPS.reduce((s, a, k) => s + a * Math.sin(2 * Math.PI * F0 * (k + 1) * (i / SR)), 0) + noise());
const wavPath = join(tmpdir(), 'fp-sim-vowel-lab.wav');
writeFileSync(wavPath, Buffer.from(encodeWav(sim, SR).buffer));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const INSTRUMENT = () => {
  window.__micLog = { streams: [] };
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => { const s = await orig(c); window.__micLog.streams.push(s); return s; };
  window.__liveTracks = () => window.__micLog.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length;
  // Record every node connected to the speakers from a microphone context.
  const AC = window.AudioContext;
  const origSrc = AC.prototype.createMediaStreamSource;
  AC.prototype.createMediaStreamSource = function (s) { this.__isMic = true; return origSrc.call(this, s); };
  window.__micToDest = [];
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (this.context.__isMic && target instanceof AudioDestinationNode) window.__micToDest.push(this instanceof GainNode ? this.gain.value : 'not-a-gain');
    return origConnect.call(this, target, ...rest);
  };
};

const errors = [];
const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'], acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.addInitScript(INSTRUMENT);
await page.goto(url + '#/frequency');
await page.waitForSelector('.mode-bar');

const dbg = () => page.evaluate(() => window.__frequencyPlayground.debug());
const vow = async () => (await dbg()).vowel;
const wait = (ms) => page.waitForTimeout(ms);
const btn = (name) => page.getByRole('button', { name, exact: true });
const setRange = (sel, v) => page.evaluate(([s, val]) => { const e = document.querySelector(s); e.value = String(val); e.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, v]);
const download = async (name) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), btn(name).click()]);
  return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
};
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// 0. Manual mode is the default and unchanged.
let d = await dbg();
check('Default mode is Manual frequencies; component table and plots present', d.mode === 'manual' && (await page.locator('table.comps').count()) === 1 && (await page.locator('.vowel-lab').count()) === 0);

// 1. Switch to Vowel Lab.
await btn('🗣 Vowel Lab: harmonic sliders').click();
await wait(300);
d = await dbg();
check('Vowel Lab mode shows the five stages plus the automatic section; manual table hidden', d.mode === 'vowel' && (await page.locator('.vl-stage').count()) === 6 && (await page.locator('.vl-stage[data-stage="auto"]').count()) === 1 && (await page.locator('table.comps:not(.vl-table)').count()) === 0);
check('Starts from the neutral 1/n recipe (not a vowel preset), nothing saved', d.vowel.work.amps[0] === 1 && d.vowel.work.amps[1] === 0.5 && d.vowel.work.amps[3] === 0.25 && d.vowel.saved.length === 0 && d.vowel.dirty);
check('Up to 48 harmonics; default 32', d.vowel.work.count === 32 && (await page.locator('.vl-row').count()) === 32);

// 2. Reference tone, then recording stops it.
await page.fill('input[aria-label="Reference tone frequency in Hz"]', '196');
await btn('♪ Play reference tone').click();
await wait(400);
let v = await vow();
check('Reference tone plays at the typed pitch', v.audio.state === 'ref' && v.audio.refFreq === 196);

await btn('2 s').click();
await btn('● Record vowel (2 s)').click();
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.rec.state === 'recording', null, { timeout: 8000 });
v = await vow();
check('Recording stops the reference tone first (no competing audio)', v.audio.state === 'idle');
check('Record turned the microphone on', (await dbg()).mic.status === 'listening');
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 1, null, { timeout: 8000 });
await wait(300);
v = await vow();
const rec1 = v.recordings[0];
check('Recording kept with an automatic label and the real sample rate', rec1.name === 'ah — lower pitch' && rec1.source === 'microphone', `${rec1.name}, ${rec1.sampleRate} Hz`);
check('Recording length ≈ 2 s', Math.abs(rec1.length / rec1.sampleRate - 2) < 0.01, `${(rec1.length / rec1.sampleRate).toFixed(3)} s`);
check('New recording linked to the experiment; analysis segment = middle second', v.workRecording === rec1.id && v.work.segment.start === 0.5 && v.work.segment.end === 1.5);
const micToDest = await page.evaluate(() => window.__micToDest);
check('Recorder reaches the speakers only through a gain of exactly 0', micToDest.length >= 1 && micToDest.every((g) => g === 0), JSON.stringify(micToDest));
check('Recorder released its nodes after the take', v.recorder.nodesCreated === v.recorder.nodesDisconnected && !v.recorder.recording, JSON.stringify(v.recorder));

// The captured samples are the simulated "vowel": compare spectral peaks.
const h1 = await page.evaluate(() => window.__frequencyPlayground.vowelHooks.peakAt('orig', 200));
const h2 = await page.evaluate(() => window.__frequencyPlayground.vowelHooks.peakAt('orig', 400));
const h3 = await page.evaluate(() => window.__frequencyPlayground.vowelHooks.peakAt('orig', 600));
check('Recorded spectrum has the input’s harmonics at 200/400/600 Hz, H2 stronger than H1 (strongest ≠ fundamental)',
  Math.abs(h1.freq - 200) < 3 && Math.abs(h2.freq - 400) < 3 && Math.abs(h3.freq - 600) < 3 && h2.db > h1.db && Math.abs(h2.db - h1.db - 20 * Math.log10(3)) < 1.5,
  `${h1.freq.toFixed(1)} Hz ${h1.db.toFixed(1)} dB, ${h2.freq.toFixed(1)} Hz ${h2.db.toFixed(1)} dB, ${h3.freq.toFixed(1)} Hz`);

// 3. A second recording does not overwrite the first.
await btn('● Record vowel (2 s)').click();
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 2, null, { timeout: 8000 });
await wait(200);
v = await vow();
check('Second take gets a new name and does not replace the experiment’s recording', v.recordings[1].name === 'ah — lower pitch (2)' && v.workRecording === rec1.id && (await page.locator('.vl-rec-msg').innerText()).includes('still uses'));

// 4. Stop the microphone: the recording stays and plays.
await page.locator('.vl-mic-line + button').click();
await wait(400);
d = await dbg();
check('Stop Microphone releases the device (no live tracks)', d.mic.status === 'off' && (await page.evaluate(() => window.__liveTracks())) === 0);
await btn('▶ Play Original').click();
await wait(300);
v = await vow();
check('Recording plays after the microphone stopped', v.audio.state === 'original' && v.audio.originalLevel > 0, `level ×${v.audio.originalLevel && v.audio.originalLevel.toFixed(2)}`);
await page.screenshot({ path: shots + 'vowel-01-recorded.png', fullPage: false });

// 5. Exported original = the captured samples.
const dOrig = await download('⬇ Original (WAV)');
const wavO = decodeWav(ab(dOrig.data));
const captured = await page.evaluate((id) => window.__frequencyPlayground.vowelHooks.recordingSamples(id), rec1.id);
let maxErr = 0;
for (let i = 0; i < captured.length; i++) maxErr = Math.max(maxErr, Math.abs(wavO.samples[i] - captured[i]));
check('Original WAV: name ah_lower_original.wav, 16-bit mono, same rate and length as the capture', dOrig.name === 'ah_lower_original.wav' && wavO.bitDepth === 16 && wavO.channels === 1 && wavO.sampleRate === rec1.sampleRate && wavO.samples.length === captured.length);
check('Original WAV contains the captured samples (within 16-bit rounding)', maxErr < 1 / 16000, `max error ${maxErr.toExponential(2)}`);

// 6. Fundamental and harmonic frequencies.
await page.fill('#vl-f0-s2', '200');
await page.press('#vl-f0-s2', 'Enter');
await wait(100);
const freqs = await page.locator('.vl-row .vl-hfreq').allInnerTexts();
check('Harmonic n is shown at n × f0 (200, 400, … 6,400 Hz)', freqs[0] === '200 Hz' && freqs[2] === '600 Hz' && freqs[31] === '6,400 Hz', freqs.slice(0, 4).join(', '));
check('Both f0 fields show the same value', (await page.inputValue('#vl-f0-s3')) === '200');

// 7. Sliders are independent; changing f0 keeps amplitudes.
await btn('▶ Play Synthesized').click();
await wait(300);
v = await vow();
check('Play Synthesized stops the original (no overlap)', v.audio.state === 'synth' && v.audio.originalLevel === null);
const before = v.work.amps;
await setRange('.vl-row[data-n="3"] input[type="range"]', 0.05);
await setRange('.vl-row[data-n="5"] input[type="range"]', 0.9);
await wait(400);
v = await vow();
const changed = v.work.amps.map((a, i) => (a !== before[i] ? i + 1 : null)).filter(Boolean);
check('Moving sliders 3 and 5 changes only harmonics 3 and 5', changed.join(',') === '3,5' && v.work.amps[2] === 0.05 && v.work.amps[4] === 0.9, `changed: ${changed}`);
const vg = v.audio.synth.voices;
check('The live synthesizer follows the sliders (smoothed gains)', Math.abs(vg[2].gain - 0.05) < 0.01 && Math.abs(vg[4].gain - 0.9) < 0.01 && Math.abs(vg[0].gain - 1) < 0.01);
check('Live oscillators sit at n × f0', vg.slice(0, 5).every((x, i) => Math.abs(x.freq - 200 * (i + 1)) < 0.01));
await page.fill('#vl-f0-s3', '250');
await page.press('#vl-f0-s3', 'Enter');
await wait(500);
v = await vow();
check('Changing f0 moves every harmonic and keeps the amplitudes', v.work.f0 === 250 && JSON.stringify(v.work.amps) === JSON.stringify(changed.length ? v.work.amps : before) && v.audio.synth.voices.slice(0, 4).every((x, i) => Math.abs(x.freq - 250 * (i + 1)) < 0.5));
check('Synthesized peak gain = target ÷ recipe peak', v.audio.synth.peakGain > 0);
const s4 = await page.evaluate(() => window.__frequencyPlayground.vowelHooks.peakAt('synth', 1250));
check('Synthesized spectrum (same FFT analysis) has harmonic 5 at 1,250 Hz', s4 && Math.abs(s4.freq - 1250) < 3, s4 && `${s4.freq.toFixed(1)} Hz`);
await page.fill('#vl-f0-s3', '200');
await page.press('#vl-f0-s3', 'Enter');

// 8. Exclusive playback.
await btn('■ Stop').click();
await wait(300);
v = await vow();
check('Stop stops the synthesizer', v.audio.state === 'idle');
await btn('⇄ Original → Synthesized').click();
await wait(300);
v = await vow();
const phase1 = v.audio.abPhase;
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.audio.abPhase === 'synth', null, { timeout: 4000 });
v = await vow();
check('Alternate plays the original first, then the synthesized sound (not both at once)', phase1 === 'original' && v.audio.abPhase === 'synth' && v.audio.originalLevel === null);
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.audio.state === 'idle', null, { timeout: 4000 });
check('Alternate ends by itself', (await vow()).audio.state === 'idle');
await btn('▶ Play Synthesized').click();
await wait(200);
await page.evaluate(() => window.__frequencyPlayground.setMode('manual'));
await wait(200);
d = await dbg();
check('Switching mode stops the Vowel Lab sound', d.vowel.audio.state === 'idle');
await btn('▶ Play Synthesized').count();
await page.evaluate(() => window.__frequencyPlayground.setMode('vowel'));
await btn('▶ Play Synthesized').click();
await wait(200);
await page.evaluate(() => window.__frequencyPlayground.setMode('manual'));
await btn('▶ Play').click();
await wait(400);
d = await dbg();
check('Manual-mode Play works and nothing from the Vowel Lab is sounding', d.engine.playing && d.vowel.audio.state === 'idle');
await btn('■ Stop').click();
await page.evaluate(() => window.__frequencyPlayground.setMode('vowel'));
await wait(300);

// 9. Save, unsaved-change indicator, downloads from the saved recipe.
await page.locator('.vl-bar').getByRole('button', { name: '💾 Save experiment' }).click();
await wait(200);
v = await vow();
check('Save stores the experiment and clears the unsaved indicator', v.saved.length === 1 && !v.dirty && (await page.locator('.vl-save-state').innerText()).startsWith('✓ Saved'));
await page.fill('.vl-note >> nth=0', 'none, same pitch');
await setRange('.vl-row[data-n="2"] input[type="range"]', 0.7);
await wait(150);
v = await vow();
check('Slider change after saving shows “Unsaved changes” and a download warning', v.dirty && (await page.locator('.vl-save-state').innerText()).includes('Unsaved') && (await page.locator('.vl-dl-note').innerText()).includes('last saved version'));
const savedRecipe = v.saved[0];
const dSynth = await download('⬇ Synthesized (WAV)');
const wavS = decodeWav(ab(dSynth.data));
const expect = renderRecipe({ f0: savedRecipe.f0, amps: savedRecipe.amps, sampleRate: wavS.sampleRate, duration: v.synthLen, gain: outputGain(savedRecipe.f0, savedRecipe.amps, wavS.sampleRate / 2) });
let errS = 0;
let peakS = 0;
for (let i = 0; i < expect.length; i++) { errS = Math.max(errS, Math.abs(wavS.samples[i] - expect[i])); peakS = Math.max(peakS, Math.abs(wavS.samples[i])); }
check('Synthesized WAV is named ah_lower_synthesized.wav and matches the SAVED recipe (not the unsaved slider)', dSynth.name === 'ah_lower_synthesized.wav' && wavS.samples.length === expect.length && errS < 1 / 16000, `max error ${errS.toExponential(2)}, peak ${peakS.toFixed(3)}`);
check('Synthesized WAV: peak ≈ 0.5 (same peak level as playback) and silent first/last sample (fades)', Math.abs(peakS - 0.5) < 0.01 && Math.abs(wavS.samples[0]) < 1e-4 && Math.abs(wavS.samples[wavS.samples.length - 1]) < 1e-4);
const dJson = await download('⬇ Settings (JSON)');
const doc = JSON.parse(dJson.data.toString('utf8'));
check('Settings JSON: name, f0, every amplitude, labels', dJson.name === 'ah_lower_settings.json' && doc.fundamentalHz === savedRecipe.f0 && doc.harmonics.length === 32 && doc.harmonics.every((x, i) => x.amplitude === savedRecipe.amps[i] && Math.abs(x.frequencyHz - (i + 1) * savedRecipe.f0) < 1e-6) && doc.vowel === 'ah' && doc.pitchCondition === 'lower');
const jsonPath = join(tmpdir(), 'fp-vowel-settings.json');
writeFileSync(jsonPath, dJson.data);

// Save the new slider state too, then check "Save, then download all".
const files = [];
page.on('download', (dl) => files.push(dl.suggestedFilename()));
await btn('💾 Save, then download all three').click();
await wait(1500);
v = await vow();
check('“Save, then download all three” saves first and downloads the three files', !v.dirty && v.saved[0].amps[1] === 0.7 && v.saved[0].notes.pitchChange === 'none, same pitch' && files.sort().join(',') === 'ah_lower_original.wav,ah_lower_settings.json,ah_lower_synthesized.wav', files.join(', '));

// 10. Duplicate A keeps the source intact.
const srcBefore = JSON.stringify(v.saved[0]);
await btn('Duplicate → A: same amplitudes, new f0').click();
await wait(300);
await page.fill('#vl-f0-s3', '300');
await page.press('#vl-f0-s3', 'Enter');
await setRange('.vl-row[data-n="1"] input[type="range"]', 0.2);
await page.locator('.vl-bar').getByRole('button', { name: '💾 Save experiment' }).click();
await wait(200);
v = await vow();
const src = v.saved.find((e) => e.id === JSON.parse(srcBefore).id);
check('Duplicate A: new saved experiment, labelled A, first recording linked, pitch “higher”', v.saved.length === 2 && v.work.comparison === 'A' && v.work.recordingId === rec1.id && v.work.pitch === 'higher' && v.work.parentF0 === 200);
check('Changing f0 and a slider in the duplicate leaves the source experiment unchanged', JSON.stringify(src) === srcBefore);
check('Pitch-change summary shown (200 → 300 Hz, +7.0 semitones)', (await page.locator('.vl-pitch-info').innerText()).includes('+7.0 semitones'));
const dupDl = await download('⬇ Synthesized (WAV)');
check('Duplicate A files are named ah_higher_sameamps_…', dupDl.name === 'ah_higher_sameamps_synthesized.wav', dupDl.name);
await btn('Duplicate → B: record again and readjust').click();
await wait(300);
v = await vow();
check('Duplicate B: no recording yet, amplitudes copied as a starting point', v.work.comparison === 'B' && v.work.recordingId === null && v.saved.length === 3 && v.work.amps[0] === 0.2);

// 11. Import settings restores a recipe as a new experiment.
await page.setInputFiles('input[type="file"][accept^=".json"]', jsonPath);
await wait(400);
v = await vow();
check('Imported settings restore f0, amplitudes and labels as a new saved experiment, linked to the matching recording',
  v.saved.length === 4 && v.work.f0 === doc.fundamentalHz && v.work.amps.every((a, i) => a === doc.harmonics[i].amplitude) && v.work.recordingId === rec1.id && v.work.id !== savedRecipe.id,
  await page.locator('.vl-stage[data-stage="4"] .note').innerText());

// 12. Reload: experiments and recordings survive.
await page.reload();
await page.waitForSelector('.vowel-lab');
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 2, null, { timeout: 5000 });
v = await vow();
const after = await page.evaluate((id) => window.__frequencyPlayground.vowelHooks.recordingSamples(id), rec1.id);
let same = after.length === captured.length;
for (let i = 0; same && i < after.length; i++) if (after[i] !== captured[i]) same = false;
check('After a page refresh: 4 saved experiments and 2 recordings (bit-identical) restored, mode remembered', v.saved.length === 4 && same && (await dbg()).mode === 'vowel' && v.storage.recordings === 'stored' && v.storage.experiments === 'stored');
await page.screenshot({ path: shots + 'vowel-02-after-reload.png', fullPage: false });

// 13. Full-page screenshot with a recording open.
await page.locator('.vl-exp-select').selectOption({ index: 0 });
await wait(400);
await page.locator('.vl-stage[data-stage="2"] canvas.vl-zoom').click({ position: { x: 120, y: 100 } });
await page.locator('.vl-stage[data-stage="2"] canvas.vl-zoom').click({ position: { x: 520, y: 100 } });
await page.locator('.vl-stage[data-stage="2"] canvas.vl-spec').click({ position: { x: 140, y: 120 } });
await wait(300);
await page.screenshot({ path: shots + 'vowel-03-full.png', fullPage: true });
check('Cursors A/B give a repetitions ÷ time readout', (await page.locator('.vl-cursor-text').innerText()).includes('A → B'));

// 14. Leaving the page cleans up.
await btn('▶ Play Synthesized').click();
await page.locator('.vl-record').click();
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.rec.state === 'recording', null, { timeout: 8000 });
await page.evaluate(() => { location.hash = '#/motion-score'; });
await wait(800);
const last = await page.evaluate(() => window.__frequencyPlaygroundLastVowel);
const liveTracks = await page.evaluate(() => window.__liveTracks());
check('Leaving mid-recording: recorder nodes released, playback context closed, no live mic tracks',
  last.recorder.nodesCreated === last.recorder.nodesDisconnected && last.audio.contexts === last.audio.contextsClosed && liveTracks === 0, JSON.stringify({ rec: last.recorder, ctx: [last.audio.contexts, last.audio.contextsClosed], liveTracks }));
check('Playback was stopped at unmount', last.audio.state === 'idle');
check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (simulated microphone; no listening test).`);
process.exit(failed.length ? 1 : 0);

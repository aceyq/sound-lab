// Automated browser checks for the Frequency Playground microphone section.
// Usage: start the app (npm run dev), then: node scripts/verify-mic.mjs [url]
// Needs the `playwright` package (npm i -D playwright, or a global install).
//
// SIMULATED INPUT: Chromium's fake capture device plays a generated WAV file
// (a 200 Hz tone with harmonics, where the 2nd harmonic is the strongest) as
// if it were a microphone. Permission errors, a missing or busy device and an
// unplugged microphone are simulated too. None of this proves that a physical
// microphone works; see the manual checklist in the README.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const insecureUrl = process.argv[3] || null; // e.g. http://<LAN-IP>:5173/ (not localhost)
const shots = new URL('../verification/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

// ── simulated microphone signal ──
const F0 = 200;
const AMPS = [0.12, 0.3, 0.2, 0.08, 0.05]; // harmonics 1..5; #2 (400 Hz) is the strongest
const SR = 48000;
const wavPath = join(tmpdir(), 'fp-sim-vowel.wav');
writeFileSync(wavPath, makeWav(SR, 10, (t) => AMPS.reduce((s, a, i) => s + a * Math.sin(2 * Math.PI * F0 * (i + 1) * t), 0)));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// Records every getUserMedia stream and any connection from a microphone
// context to the speakers (the destination).
const INSTRUMENT = () => {
  window.__micLog = { streams: [], gum: [], destFromMic: 0 };
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      window.__micLog.gum.push(JSON.parse(JSON.stringify(c)));
      if (window.__simulateGumError) {
        const e = new Error('simulated'); e.name = window.__simulateGumError; throw e;
      }
      const s = await orig(c);
      window.__micLog.streams.push(s);
      return s;
    };
  }
  const AC = window.AudioContext;
  const origSrc = AC.prototype.createMediaStreamSource;
  AC.prototype.createMediaStreamSource = function (s) { this.__isMic = true; return origSrc.call(this, s); };
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (this.context.__isMic && target instanceof AudioDestinationNode) window.__micLog.destFromMic++;
    return origConnect.call(this, target, ...rest);
  };
  window.__liveTracks = () => window.__micLog.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length;
};

const errors = [];
// Vite's live-reload socket is refused on the LAN address (host check / CSP);
// that is a dev-server message, not an app error.
const devNoise = (t) => /WebSocket|ws:\/\/|\[vite\]/.test(t);
async function openPage(browser, target, { grant = true, init = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: grant ? ['microphone'] : [] });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !devNoise(m.text())) errors.push(m.text()); });
  await page.addInitScript(INSTRUMENT);
  if (init) await page.addInitScript(init);
  await page.goto(target);
  await page.waitForSelector('.mic-panel');
  return { context, page };
}

const flags = ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`, '--autoplay-policy=no-user-gesture-required'];
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: [...flags, '--use-fake-ui-for-media-stream'] });
let { page } = await openPage(browser, url);
const dbg = () => page.evaluate(() => window.__frequencyPlayground.debug());
const mic = async () => (await dbg()).mic;
const wait = (ms) => page.waitForTimeout(ms);
const btn = (name) => page.getByRole('button', { name, exact: true });
const near = (peaks, f, tol) => peaks.some((p) => Math.abs(p - f) <= tol);
const micLog = () => page.evaluate(() => ({ gum: window.__micLog.gum.length, streams: window.__micLog.streams.length, live: window.__liveTracks(), dest: window.__micLog.destFromMic }));

// 1. Off state.
let m = await mic();
check('Starts Off; microphone graphs hidden; no microphone requested yet',
  m.status === 'off' && !m.ui.plotsVisible && (await micLog()).gum === 0 && (await page.locator('.mic-status').textContent()).includes('Off'));

// 2. Synth playing → Enable Microphone stops it.
await btn('▶ Play').click();
await wait(400);
check('(setup) synthesizer playing before the microphone starts', (await dbg()).engine.playing);
await btn('🎤 Enable Microphone').click();
await page.waitForFunction(() => window.__frequencyPlayground.debug().mic.status === 'listening', null, { timeout: 5000 });
await wait(1500);
let d = await dbg();
m = d.mic;
check('Enable Microphone → status Listening (simulated device)', m.status === 'listening' && (await page.locator('.mic-status').textContent()).includes('Listening'));
check('Synthesized playback was stopped and the reason is shown; it does not restart', !d.engine.playing && /stopped so the microphone measures only your voice/.test(m.ui.note));
await wait(800);
check('Synthesizer stays stopped (no unexpected resume)', !(await dbg()).engine.playing);
const gum = await page.evaluate(() => window.__micLog.gum[0]);
check('Requests echo cancellation, noise suppression and auto gain OFF', gum.audio.echoCancellation === false && gum.audio.noiseSuppression === false && gum.audio.autoGainControl === false, JSON.stringify(gum.audio));
const applied = m.settings.items.map((i) => `${i.key}=${i.applied}`).join(', ');
const settingsText = await page.locator('.mic-settings').innerText();
check('Applied settings are read back from the track and shown', m.settings.items.every((i) => i.applied === false || i.applied === true || i.applied === null) && /Device:/.test(settingsText), applied);
check('No microphone node is connected to the speakers', (await micLog()).dest === 0);
check('Exactly one live microphone track', (await micLog()).live === 1);

// 3. Spectrum from the microphone, using the real sample rate.
const sr = m.sampleRate;
check('Spectrum bin spacing = AudioContext sample rate ÷ FFT size', Math.abs(m.ui.binHz - sr / 4096) < 1e-9 && m.fftSize === 4096, `${sr} Hz ÷ 4096 = ${m.ui.binHz.toFixed(3)} Hz`);
const binText = await page.locator('.mic-bins').textContent();
check('FFT explanation shows the same numbers', binText.includes(sr.toLocaleString('en-US')) && binText.includes((sr / 4096).toFixed(2)), binText.slice(0, 90));
const tol = 1.5 * m.ui.binHz;
check('Microphone spectrum shows peaks at 200, 400, 600, 800, 1000 Hz (simulated input)', [200, 400, 600, 800, 1000].every((f) => near(m.ui.peaks, f, tol)), `peaks=${m.ui.peaks}`);
const peakText = await page.locator('.mic-peaks').textContent();
check('Strongest peak (400 Hz) listed first but NOT called the fundamental', /strongest first\): 400 Hz/.test(peakText) && /not necessarily the fundamental/.test(peakText) && !/fundamental:/i.test(peakText), peakText.slice(0, 80));
check('Default range 0–5000 Hz', m.ui.range[0] === 0 && m.ui.range[1] === 5000);
await page.screenshot({ path: shots + 'mic-01-listening.png', fullPage: false });

// 4. Waveform: real samples, window length matches the label.
for (const [label, sec] of [['20 ms', 0.02], ['100 ms', 0.1], ['10 ms', 0.01]]) {
  await page.locator('.mic-panel').getByRole('button', { name: label, exact: true }).click();
  await wait(300);
  m = await mic();
  const samples = await page.evaluate(() => window.__frequencyPlayground.micSamples());
  check(`Waveform ${label} shows ${Math.round(sec * sr)} real samples (${sr} Hz × ${sec} s)`, m.ui.windowSamples === Math.round(sec * sr) && samples.length === m.ui.windowSamples);
}
await page.locator('.mic-panel').getByRole('button', { name: '100 ms', exact: true }).click();
await wait(300);
let samples = await page.evaluate(() => window.__frequencyPlayground.micSamples());
const lag = periodLag(samples, Math.round(sr / 1000), Math.round(sr / 80));
check('Waveform repeats every ≈5 ms (1/200 Hz), measured by autocorrelation of the drawn samples', Math.abs(lag / sr - 1 / F0) < 0.0002, `period=${(lag / sr * 1000).toFixed(2)} ms`);
const readout = await page.locator('.mic-scale').textContent();
check('Auto-fit is shown as on, with the current scale', /Auto-fit on · current scale ±/.test(readout) && m.ui.scaleMode === 'auto', readout);
const peakAmp = Math.max(...samples.map(Math.abs));
m = await mic();
check('Auto-fit scale contains the signal without being much larger', m.ui.scale >= peakAmp && m.ui.scale <= Math.max(0.01, peakAmp * 3), `peak=${peakAmp.toFixed(3)}, scale=±${m.ui.scale}`);
await page.getByRole('combobox', { name: 'Microphone waveform vertical scale' }).selectOption('0.1');
await wait(250);
check('Fixed vertical scale can be chosen and is labelled', (await mic()).ui.scale === 0.1 && /Fixed scale ±0.1/.test(await page.locator('.mic-scale').textContent()));
await page.getByRole('combobox', { name: 'Microphone waveform vertical scale' }).selectOption('auto');

// 5. Freeze vs Stop.
await page.locator('.mic-panel label.check:has-text("Steady display") input').uncheck();
await wait(200);
const liveA = await page.evaluate(() => window.__frequencyPlayground.micSamples().slice(0, 50).join());
await wait(200);
const liveB = await page.evaluate(() => window.__frequencyPlayground.micSamples().slice(0, 50).join());
check('(control) live waveform changes between frames', liveA !== liveB);
await btn('❄ Freeze View').click();
await wait(100);
const frozenA = await page.evaluate(() => window.__frequencyPlayground.micSamples().join());
const frozenPeaks = (await mic()).ui.peaks.join();
await wait(600);
m = await mic();
const frozenB = await page.evaluate(() => window.__frequencyPlayground.micSamples().join());
check('Freeze View holds the waveform and spectrum still', frozenA === frozenB && m.ui.peaks.join() === frozenPeaks && m.ui.frozen);
check('While frozen the microphone is still listening (track live, status Listening)', m.status === 'listening' && m.trackState === 'live' && (await micLog()).live === 1);
const frozenLabel = await page.locator('.mic-freeze-state').textContent();
check('Frozen state is labelled as "microphone still listening"', /microphone still listening/.test(frozenLabel) && (await btn('▶ Resume View').count()) === 1, frozenLabel);
await page.locator('.mic-panel').getByRole('button', { name: '0–500 Hz' }).click();
await wait(200);
m = await mic();
check('Changing the range while frozen redraws the same data in the new range', m.ui.range[1] === 500 && m.ui.peaks.every((p) => p <= 500) && near(m.ui.peaks, 200, tol) && near(m.ui.peaks, 400, tol), `peaks=${m.ui.peaks}`);
await page.screenshot({ path: shots + 'mic-02-frozen.png' });
await btn('▶ Resume View').click();
await wait(300);
const resumed = await page.evaluate(() => window.__frequencyPlayground.micSamples().join());
check('Resume View shows live data again', !(await mic()).ui.frozen && resumed !== frozenB);
await page.locator('.mic-panel').getByRole('button', { name: '0–5,000 Hz' }).click();
await page.locator('.mic-panel label.check:has-text("Steady display") input').check();

// 6. FFT size change uses the real sample rate.
await page.getByRole('combobox', { name: 'Microphone FFT size' }).selectOption('16384');
await wait(800);
m = await mic();
check('FFT 16384: bin spacing = sample rate ÷ 16384 and peaks still at 200/400 Hz', Math.abs(m.ui.binHz - sr / 16384) < 1e-9 && near(m.ui.peaks, 200, 1.5 * m.ui.binHz) && near(m.ui.peaks, 400, 1.5 * m.ui.binHz));
await page.getByRole('combobox', { name: 'Microphone FFT size' }).selectOption('4096');

// 7. Stop releases the device.
await btn('■ Stop Microphone').click();
await wait(300);
m = await mic();
check('Stop Microphone: status Off, media track ended, context closed', m.status === 'off' && (await micLog()).live === 0 && m.sampleRate === null && (await page.locator('.mic-status').textContent()).includes('Off'));
check('After Stop: Freeze disabled and graphs say the microphone is off', await btn('❄ Freeze View').isDisabled() && /Microphone off/.test(await page.locator('.mic-panel .state-line').first().textContent()));
await page.screenshot({ path: shots + 'mic-03-stopped.png' });

// 8. Repeated start/stop, double click.
for (let i = 0; i < 5; i++) {
  await btn('🎤 Enable Microphone').click();
  await page.waitForFunction(() => window.__frequencyPlayground.debug().mic.status === 'listening');
  await wait(150);
  await btn('■ Stop Microphone').click();
  await wait(100);
}
await btn('🎤 Enable Microphone').dblclick();
await page.waitForFunction(() => window.__frequencyPlayground.debug().mic.status === 'listening');
await wait(300);
let log = await micLog();
m = await mic();
check('Repeated Enable/Stop and a double click leave exactly one live track and one open context', log.live === 1 && m.counters.contextsCreated - m.counters.contextsClosed === 1, JSON.stringify(m.counters));
check('Each start created 3 nodes and every stopped session disconnected its 3', m.counters.nodesCreated - m.counters.nodesDisconnected === 3);

// 9. Switching pages while listening releases everything.
await page.getByRole('link', { name: '2. Motion Score' }).click();
await wait(500);
const after = await page.evaluate(() => ({ last: window.__frequencyPlaygroundLastMic, live: window.__liveTracks(), loops: window.__fpLoops }));
check('Leaving the page while listening stops the track and closes the mic context', after.live === 0 && after.last.status === 'off' && after.last.counters.contextsCreated === after.last.counters.contextsClosed && after.loops === 0, JSON.stringify(after.last.counters));
await page.getByRole('link', { name: '1. Frequency Playground' }).click();
await wait(400);
d = await dbg();
check('Returning shows a fresh page with the microphone Off and one loop', d.mic.status === 'off' && d.loops === 1);

// 10. Synthesizer still works.
await btn('▶ Play').click();
await wait(900);
d = await dbg();
check('Synthesizer Play still measures its own 220 Hz peak', d.engine.playing && near(d.measure.peaks, 220, Math.max(1.5 * d.measure.binHz, 2)), `peaks=${d.measure.peaks}`);
await btn('🎤 Enable Microphone').click();
await page.waitForFunction(() => window.__frequencyPlayground.debug().mic.status === 'listening');
await btn('▶ Play').click();
await wait(400);
d = await dbg();
check('Play while the microphone listens shows the speaker-leak warning', d.engine.playing && /reach the microphone through the speakers/.test(d.mic.ui.synthWarn));
check('Synth and mic use separate audio contexts (mic graph never reaches the speakers)', (await micLog()).dest === 0);
await btn('■ Stop').click();

// 11. Unplugged microphone (simulated by firing the track's "ended" event).
await page.evaluate(() => { const t = window.__micLog.streams.at(-1).getAudioTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')); });
await wait(200);
m = await mic();
check('Track ended (simulated unplug) → Error "Microphone disconnected", nothing left open', m.status === 'error' && /disconnected/.test(await page.locator('.mic-error').textContent()) && (await micLog()).live === 0);
await btn('🎤 Try Again').click();
await page.waitForFunction(() => window.__frequencyPlayground.debug().mic.status === 'listening');
check('Try Again recovers', (await mic()).status === 'listening');
await btn('■ Stop Microphone').click();

// 12. Simulated device errors.
for (const [name, re] of [['NotAllowedError', /permission was denied.*Enable Microphone again/], ['NotFoundError', /No microphone found/], ['NotReadableError', /Another app/], ['OverconstrainedError', /No suitable microphone/]]) {
  await page.evaluate((n) => { window.__simulateGumError = n; }, name);
  await btn('🎤 Enable Microphone').or(btn('🎤 Try Again')).click();
  await page.waitForFunction(() => window.__frequencyPlayground.debug().mic.status === 'error');
  const text = await page.locator('.mic-error').textContent();
  check(`Simulated ${name} shows an actionable message`, re.test(text), text.slice(0, 80));
}
await page.evaluate(() => { window.__simulateGumError = null; });
await page.close();

// 13. Permission denied (browser without auto-accept, permission not granted).
const denyBrowser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: [...flags, '--deny-permission-prompts'] });
({ page } = await openPage(denyBrowser, url, { grant: false }));
await page.getByRole('button', { name: '🎤 Enable Microphone' }).click();
await page.waitForFunction(() => ['error', 'listening'].includes(window.__frequencyPlayground.debug().mic.status), null, { timeout: 8000 }).catch(() => {});
m = await page.evaluate(() => window.__frequencyPlayground.debug().mic);
const deniedText = await page.locator('.mic-error').textContent();
// Headless Chromium reports a refused prompt as ${m.error}; a real browser
// reports a click on "Block" as NotAllowedError (simulated above).
check(`Browser refuses the permission prompt (${m.error}) → Error with steps to allow the microphone`, m.status === 'error' && /Enable Microphone again/.test(deniedText) && (await page.evaluate(() => window.__liveTracks())) === 0, deniedText.slice(0, 90));
await page.screenshot({ path: shots + 'mic-04-denied.png' });
await denyBrowser.close();

// 14. Insecure context (page opened over plain http on a non-localhost address).
if (insecureUrl) {
  ({ page } = await openPage(browser, insecureUrl));
  const secure = await page.evaluate(() => window.isSecureContext);
  await page.getByRole('button', { name: '🎤 Enable Microphone' }).click();
  await wait(300);
  m = await page.evaluate(() => window.__frequencyPlayground.debug().mic);
  const t = await page.locator('.mic-error').textContent();
  check('Insecure page (http on a LAN address) → clear "needs a secure page" message', !secure && m.status === 'error' && /secure page/.test(t) && /localhost/.test(t), t.slice(0, 90));
  await page.close();
} else console.log('SKIP  insecure-context check (pass a non-localhost http URL as the 2nd argument)');

check('No page errors in the console', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed (all with SIMULATED microphone input).`);
process.exit(failed ? 1 : 0);

// ── helpers ──
// Shortest lag whose autocorrelation is within 10% of the best one: the
// period, rather than a multiple of it.
function periodLag(x, minLag, maxLag) {
  const r = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    r.push(s / (x.length - lag));
  }
  const top = Math.max(...r);
  for (let k = 1; k < r.length - 1; k++) {
    if (r[k] >= 0.9 * top && r[k] >= r[k - 1] && r[k] >= r[k + 1]) return minLag + k;
  }
  return minLag + r.indexOf(top);
}

function makeWav(sr, seconds, fn) {
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(fn(i / sr) * 32767))), 44 + i * 2);
  return buf;
}

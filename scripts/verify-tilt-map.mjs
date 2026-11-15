// Automated browser checks for the Tilt Sound Map (capstone part 3).
// Usage: start the app (npx vite --port 5191), then:
//   node scripts/verify-tilt-map.mjs http://localhost:5191/
// Needs the `playwright` package.
//
// SIMULATED INPUT: no real phone. Phone messages are either
//   (a) fed into the page's own message handler (window.__tiltMap.feed), the
//       same function the WebRTC connection calls, or
//   (b) sent from a second browser page running the real phone controller
//       page over the real PeerJS pairing (needs internet; skipped if the
//       pairing server cannot be reached).
// The microphone is a synthetic harmonic tone. Sound is checked through the
// app's state (oscillator targets, gate level, drum counters), not by ear.
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
  console.log(`${ok ? 'PASS' : ok === null ? 'SKIP' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = 233;
    o.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(8), Float32Array.from([0, 1, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05])));
    const g = ctx.createGain(); g.gain.value = 0.25;
    const d = ctx.createMediaStreamDestination();
    o.connect(g).connect(d); o.start();
    return d.stream;
  };
});
const errors = [];
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]|peerjs|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
const dbg = () => page.evaluate(() => window.__tiltMap.debug());
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(url + '#/tilt-map');
await page.waitForFunction(() => window.__tiltMap);
let d = await dbg();
check('Page opens with four starter sounds', d.project.anchors.length === 4, d.project.anchors.map((a) => `${a.name} ${a.analysis.f0} Hz`).join(', '));

// ── laptop simulation: each angle by itself ──
await page.getByLabel(/Laptop simulation/).check();
await page.getByRole('button', { name: /Start sound/ }).click();
const setSim = async (pitch, roll) => {
  await page.evaluate(([p, r]) => {
    const set = (label, v) => { const el = document.querySelector(`input[aria-label^="${label}"]`); el.value = String(v); el.dispatchEvent(new Event('input')); };
    set('Simulated forward/back', p); set('Simulated sideways', r);
  }, [pitch, roll]);
  await wait(600);
  return dbg();
};
const c = await setSim(0, 0);
const p1 = await setSim(15, 0);
check('Forward/back tilt alone moves the dot only up/down', Math.abs(p1.dot.x - 0.5) < 0.005 && p1.dot.y > 0.7, `dot (${p1.dot.x.toFixed(3)}, ${p1.dot.y.toFixed(3)})`);
const r1 = await setSim(0, -17.5);
check('Sideways tilt alone moves the dot only left/right', Math.abs(r1.dot.y - 0.5) < 0.005 && r1.dot.x < 0.3, `dot (${r1.dot.x.toFixed(3)}, ${r1.dot.y.toFixed(3)})`);
const both = await setSim(15, -17.5);
check('Both angles together pick one point', Math.abs(both.dot.x - r1.dot.x) < 0.005 && Math.abs(both.dot.y - p1.dot.y) < 0.005, `dot (${both.dot.x.toFixed(3)}, ${both.dot.y.toFixed(3)})`);
const f = (x) => x.blend.params.f0;
check('The blend changes with either angle and with both', f(c) !== f(p1) && f(c) !== f(r1) && f(both) !== f(p1) && f(both) !== f(r1),
  `centre ${f(c).toFixed(1)} Hz, pitch only ${f(p1).toFixed(1)}, roll only ${f(r1).toFixed(1)}, both ${f(both).toFixed(1)}`);
check('The playing synth follows the blended f0', both.audio.kind === 'synth' && Math.abs(both.audio.params.f0 - f(both)) < 0.5, `${both.audio.params && both.audio.params.f0.toFixed(1)} Hz`);
const ah = await setSim(0, -21);
check('At a starter sound’s pose you hear that sound exactly', ah.blend.weights.find((w) => /ah/.test(w.name)).weight > 0.999 && Math.abs(f(ah) - 165) < 0.01, `${f(ah).toFixed(2)} Hz`);
await page.screenshot({ path: shots + 'tilt-01-sim.png' });

// ── record a sound at the current pose ──
await setSim(15, 17.5);
await page.getByLabel('Name for the new sound').fill('Demo oo');
await page.getByRole('button', { name: /Record at current pose/ }).click();
await page.waitForFunction(() => /Added|No usable|failed|too short/.test(document.querySelector('.tm-rec-msg').textContent), null, { timeout: 15000 });
d = await dbg();
const mine = d.project.anchors.find((a) => a.name === 'Demo oo');
check('A recorded sound is attached at the current pose', mine && Math.abs(mine.pos.x - 0.75) < 0.01 && Math.abs(mine.pos.y - 0.75) < 0.01 && Math.abs(mine.analysis.f0 - 233) < 2,
  mine ? `pos (${mine.pos.x.toFixed(2)}, ${mine.pos.y.toFixed(2)}), f0 ${mine.analysis.f0} Hz, angles ${JSON.stringify(mine.angles)}` : await page.locator('.tm-rec-msg').textContent());
await page.getByLabel(/Laptop simulation/).uncheck();

// Recording stopped the sound; start it again for the phone checks.
await page.getByRole('button', { name: /Start sound/ }).click();
// ── phone messages through the real handler ──
await page.evaluate(() => window.__tiltMap.setConn('connected'));
// A phone held upright-ish (20° back), calibrated as neutral, then tilted.
await page.evaluate(() => {
  const D = Math.PI / 180;
  const up = (back, lean) => { const t = back * D; const l = lean * D; return [Math.sin(l), Math.cos(l) * Math.cos(t), Math.cos(l) * Math.sin(t)]; };
  window.__pose = { back: 20, lean: 0 };
  let seq = 0;
  window.__feeding = true;
  window.__feedTimer = setInterval(() => {
    if (!window.__feeding) return;
    window.__tiltMap.feed({ type: 'sample', seq: seq++, t: performance.now(), tilt: window.__pose.back, side: window.__pose.lean, up: up(window.__pose.back, window.__pose.lean), lin: 0, jerk: 0, screen: 0, rate: 60 });
  }, 40);
  window.__tiltMap.feed({ type: 'status', sensors: 'active', hidden: false });
});
await page.getByRole('button', { name: /Set neutral/ }).click();
await wait(1400);
d = await dbg();
check('Set neutral centres the dot at the held pose', Math.abs(d.angles.pitch) < 0.5 && Math.abs(d.angles.roll) < 0.5 && Math.abs(d.dot.x - 0.5) < 0.01, `${d.calibMsg} angles ${d.angles.pitch.toFixed(2)}°, ${d.angles.roll.toFixed(2)}°`);
await page.evaluate(() => { window.__pose = { back: 5, lean: 0 }; });
await wait(500);
const ph1 = await dbg();
await page.evaluate(() => { window.__pose = { back: 20, lean: -15 }; });
await wait(500);
const ph2 = await dbg();
check('Phone: forward/back tilt changes only y', Math.abs(ph1.angles.pitch - 15) < 0.5 && Math.abs(ph1.angles.roll) < 0.5 && Math.abs(ph1.dot.x - 0.5) < 0.01 && ph1.dot.y > 0.7, `pitch ${ph1.angles.pitch.toFixed(1)}°, roll ${ph1.angles.roll.toFixed(1)}°, dot (${ph1.dot.x.toFixed(2)}, ${ph1.dot.y.toFixed(2)})`);
check('Phone: sideways tilt changes only x', Math.abs(ph2.angles.roll - 15) < 0.5 && Math.abs(ph2.angles.pitch) < 0.5 && Math.abs(ph2.dot.y - 0.5) < 0.01 && ph2.dot.x > 0.65, `pitch ${ph2.angles.pitch.toFixed(1)}°, roll ${ph2.angles.roll.toFixed(1)}°, dot (${ph2.dot.x.toFixed(2)}, ${ph2.dot.y.toFixed(2)})`);

// ── tracking drop → fade ──
d = await dbg();
check('Sound is on and the gate is open while tracking', d.soundOn && d.tracking && d.gate > 0.9, `soundOn ${d.soundOn}, gate ${d.gate && d.gate.toFixed(3)}`);
await page.evaluate(() => { window.__feeding = false; });
await wait(1000);
d = await dbg();
check('When phone readings stop, tracking is lost and the sound fades to silence', !d.tracking && d.gateTarget === 0 && d.gate < 0.05, `tracking ${d.tracking}, gate target ${d.gateTarget}, gate now ${d.gate.toFixed(4)}`);
await page.screenshot({ path: shots + 'tilt-02-tracking-lost.png' });
await page.evaluate(() => { window.__feeding = true; });
await wait(700);
d = await dbg();
check('When readings return, the sound fades back in', d.tracking && d.gate > 0.9, `gate ${d.gate.toFixed(3)}`);
await page.evaluate(() => window.__tiltMap.feed({ type: 'status', sensors: 'active', hidden: true }));
await wait(400);
d = await dbg();
check('Phone page hidden → sound fades too', !d.tracking && d.gate < 0.1, `gate ${d.gate.toFixed(3)}`);
await page.evaluate(() => window.__tiltMap.feed({ type: 'status', sensors: 'active', hidden: false }));

// ── percussion ──
await page.evaluate(() => { window.__pose = { back: 20, lean: 0 }; });
await wait(400);
await page.getByLabel(/Percussion layer/).check();
const kickPose = { back: 20 + 22.5, lean: 26 }; // pitch −22.5°, roll −26° → bottom-left (kick)
await page.evaluate((p) => { window.__pose = p; }, kickPose);
await wait(2000); // hold still in the kick region for 2 s
d = await dbg();
check('Holding the phone still in the kick region plays exactly one hit', d.drums.kick === 1 && d.lastDrum === 'kick', `kick ${d.drums.kick}, snare ${d.drums.snare}, clap ${d.drums.clap}; dot (${d.dot.x.toFixed(2)}, ${d.dot.y.toFixed(2)})`);
await page.screenshot({ path: shots + 'tilt-03-kick.png' });
// Shaky wrist on the edge: ±1.5° wobble across the region boundary for 2 s.
await page.evaluate(() => {
  let k = 0;
  // on the region's edge (distance ≈ r from the kick centre), wobbling ±3° both ways
  window.__wobble = setInterval(() => { k++; const w = k % 2 ? 1.5 : -1.5; window.__pose = { back: 20 + 17.1 + w, lean: 19.95 + w }; }, 120);
});
await wait(2000);
await page.evaluate(() => clearInterval(window.__wobble));
d = await dbg();
const dist = Math.hypot(d.dot.x - 0.13, d.dot.y - 0.13);
check('A shaky wrist across the edge does not retrigger (buffer)', d.drums.kick === 1, `kick ${d.drums.kick}; last distance from kick centre ${dist.toFixed(3)} (edge 0.12, buffer to 0.17)`);
await page.evaluate(() => { window.__pose = { back: 20, lean: 0 }; });
await wait(600);
await page.evaluate((p) => { window.__pose = p; }, kickPose);
await wait(600);
d = await dbg();
check('Leaving and coming back plays the kick again', d.drums.kick === 2, `kick ${d.drums.kick}`);
await page.evaluate(() => { window.__pose = { back: 20 - 22.5, lean: -26 }; }); // top-right: clap
await wait(600);
d = await dbg();
check('A different region plays its own drum and the page shows which one', d.drums.clap === 1 && d.lastDrum === 'clap' && /Clap/.test(await page.locator('.tm-drum-flash').textContent()), await page.locator('.tm-drum-flash').textContent());
await page.evaluate(() => { window.__pose = { back: 20 - 22.5, lean: 26 }; }); // top-left: snare
await wait(600);
d = await dbg();
check('Snare region plays a snare', d.drums.snare === 1, `snare ${d.drums.snare}`);
await page.getByLabel(/Percussion layer/).uncheck();
await page.evaluate(() => { window.__pose = { back: 20 + 22.5, lean: 26 }; });
await wait(600);
d = await dbg();
check('With percussion off, regions are silent', d.drums.kick === 2, `kick ${d.drums.kick}`);
await page.evaluate(() => { clearInterval(window.__feedTimer); });

// ── real pairing with the unchanged phone controller page (needs internet) ──
await page.reload();
await page.waitForFunction(() => window.__tiltMap);
const ready = await page.waitForFunction(() => window.__tiltMap.debug().conn === 'waiting', null, { timeout: 15000 }).then(() => true).catch(() => false);
if (!ready) {
  check('Real phone pairing over PeerJS', null, `pairing server not reachable from here (state ${(await dbg()).conn}); tested with the in-page handler above instead`);
} else {
  d = await dbg();
  const phone = await context.newPage();
  await phone.goto(d.phoneUrl);
  const ok = await phone.waitForFunction(() => window.__controller && window.__controller.snapshot().conn === 'connected', null, { timeout: 20000 }).then(() => true).catch(() => false);
  check('The Motion Score phone page pairs with the Tilt Sound Map', ok, ok ? d.phoneUrl.replace(/code=.*/, 'code=…') : JSON.stringify(await phone.evaluate(() => window.__controller && window.__controller.snapshot())));
  if (ok) {
    await phone.evaluate(() => {
      const D = Math.PI / 180;
      const up = (back, lean) => { const t = back * D; const l = lean * D; return [Math.sin(l), Math.cos(l) * Math.cos(t), Math.cos(l) * Math.sin(t)]; };
      let seq = 0;
      window.__send = (back, lean) => window.__controller.sendRaw({ type: 'sample', seq: seq++, t: performance.now(), tilt: back, tiltSrc: 'orientation', side: lean, up: up(back, lean), lin: 0, linSrc: 'sensor', jerk: 0, screen: 0, rate: 60 });
      window.__ph = setInterval(() => window.__send(window.__b ?? 20, window.__l ?? 0), 40);
      window.__controller.sendRaw({ type: 'status', sensors: 'active', hidden: false });
    });
    await wait(1200);
    await phone.evaluate(() => { window.__b = 8; });
    await wait(800);
    d = await dbg();
    check('Real pairing: phone tilt moves the dot', d.tracking && d.angles && d.angles.pitch > 8, `pitch ${d.angles && d.angles.pitch.toFixed(1)}°, dot y ${d.dot.y.toFixed(2)}`);
    const phoneState = await phone.evaluate(() => window.__controller.snapshot().laptop);
    check('Real pairing: the phone receives live angle feedback', phoneState && phoneState.tiltRel !== null, phoneState ? `phone shows tilt ${phoneState.tiltRel.toFixed(1)}°` : 'no state');
    await phone.evaluate(() => clearInterval(window.__ph));
    await wait(800);
    d = await dbg();
    check('Real pairing: readings stop → tracking lost', !d.tracking, `tracking ${d.tracking}`);
    await phone.close();
  }
}

check('No page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed${results.some((r) => r.ok === null) ? ' (some skipped)' : ''}`);
process.exit(failed.length ? 1 : 0);

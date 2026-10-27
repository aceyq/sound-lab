// Browser checks for the "How to use Vowel Lab" guided tour.
// Usage: start the app (npm run dev), then: node scripts/verify-tutorial.mjs [url]
//
// For every step, at desktop and phone size, with and without a saved
// recording: the highlight sits on a real, visible control; the card is fully
// on screen and does not cover the control; Next/Back/arrow keys/Escape/Skip
// work; focus returns; and no stored data or sound state changes.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../src/pages/frequency/wav.js';

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
const x = new Float32Array(SR * 3).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.12 * Math.sin((2 * Math.PI * 440 * i) / SR) + 0.05 * Math.sin((2 * Math.PI * 660 * i) / SR));
const wavPath = join(tmpdir(), 'fp-tour-sim.wav');
writeFileSync(wavPath, Buffer.from(encodeWav(x, SR).buffer));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const errors = [];
const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|\[vite\]/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.goto(url + '#/frequency');
await page.waitForSelector('.mode-bar');
const wait = (ms) => page.waitForTimeout(ms);
const btn = (name) => page.getByRole('button', { name, exact: true });
const pop = page.locator('.vtour-pop');
const vow = async () => (await page.evaluate(() => window.__frequencyPlayground.debug())).vowel;
const stored = () => page.evaluate(async () => {
  const exp = localStorage.getItem('frequencyPlayground.vowelLab.experiments.v1');
  const recs = await new Promise((res) => {
    const r = indexedDB.open('frequency-playground-vowel-lab', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('recordings', { keyPath: 'id' });
    r.onsuccess = () => { const t = r.result.transaction('recordings').objectStore('recordings').getAll(); t.onsuccess = () => res(t.result.map((q) => `${q.id}:${q.name}:${q.pcm.byteLength}`).join('|')); };
    r.onerror = () => res('error');
  });
  return { exp, recs };
});

/** Geometry of the current step: target, highlight, card, viewport. */
const geo = () => page.evaluate(() => {
  const r = (e) => { if (!e || e.hidden) return null; const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }; };
  const t = window.__frequencyPlayground.vowelHooks.tourTargetRect();
  const pop = document.querySelector('.vtour-pop');
  return {
    vw: window.innerWidth, vh: window.innerHeight, docW: document.documentElement.scrollWidth,
    target: t && { l: t.left, t: t.top, r: t.right, b: t.bottom, w: t.width, h: t.height },
    hole: r(document.querySelector('.vtour-hole')), pop: r(pop),
    step: pop && pop.dataset.step, side: pop && pop.dataset.side, missing: pop && pop.dataset.missing === 'true',
    note: document.querySelector('.vtour-note') && !document.querySelector('.vtour-note').hidden ? document.querySelector('.vtour-note').textContent : '',
    count: document.querySelector('.vtour-pop .tour-count').textContent,
  };
});
const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/** Walks every step with Next and checks the geometry of each. */
async function walk(tag) {
  const total = Number((await pop.locator('.tour-count').textContent()).match(/of (\d+)/)[1]);
  const bad = [];
  const seen = [];
  for (let k = 1; k <= total; k++) {
    await wait(700); // let smooth scrolling settle
    const g = await geo();
    seen.push(g.step + (g.missing ? '(note)' : ''));
    const onScreen = g.pop.l >= 0 && g.pop.t >= 0 && g.pop.r <= g.vw + 0.5 && g.pop.b <= g.vh + 0.5;
    if (!g.count.includes(`Step ${k} of ${total}`)) bad.push(`${g.step}: counter “${g.count}”`);
    if (!onScreen) bad.push(`${g.step}: card off screen`);
    if (g.step === 'wrapup') { if (g.target) bad.push('wrapup should have no target'); }
    else if (!g.target) bad.push(`${g.step}: nothing highlighted`);
    else {
      const fits = g.target.h <= g.vh - 40;
      const inView = g.target.t >= -1 && g.target.b <= g.vh + 1 && g.target.l >= -1 && g.target.r <= g.vw + 1;
      if (fits && !inView) bad.push(`${g.step}: control not fully visible (${Math.round(g.target.t)}–${Math.round(g.target.b)} of ${g.vh})`);
      const holeOk = g.hole && Math.abs(g.hole.l - (g.target.l - 8)) < 2 && Math.abs(g.hole.t - (g.target.t - 8)) < 2;
      if (!holeOk) bad.push(`${g.step}: highlight not on the control`);
      const cover = overlap(g.pop, g.target) / Math.max(1, g.target.w * g.target.h);
      if (fits && cover > 0.001) bad.push(`${g.step}: card covers ${(cover * 100).toFixed(0)} % of the control (side ${g.side})`);
    }
    if (g.docW > g.vw + 1) bad.push(`${g.step}: page scrolls sideways (${g.docW} > ${g.vw})`);
    if (k < total) await pop.getByRole('button', { name: 'Next →' }).click();
  }
  check(`${tag}: all ${total} steps highlight a visible control with the card on screen beside it`, bad.length === 0, bad.length ? bad.slice(0, 6).join('; ') : seen.join(' → '));
  return seen;
}

await btn('🗣 Vowel Lab: harmonic sliders').click();
await wait(300);
const empty = await stored();
const startWork = JSON.stringify((await vow()).work);

// ── A. No recording yet ──
const open = btn('❓ How to use Vowel Lab');
check('“How to use Vowel Lab” button is visible at the top of Vowel Lab', await open.isVisible());
await open.click();
await wait(600);
let g = await geo();
check('Starts right away on the first control (Experiment), with a step counter and Skip', g.step === 'experiment' && /Step 1 of \d+/.test(g.count) && await pop.getByRole('button', { name: 'Close the tour' }).isVisible() && await pop.getByRole('button', { name: '← Back' }).isDisabled());
const seenA = await walk('Desktop, no recording');
check('Without a recording, steps for things that are not there yet explain what to do', ['take(note)', 'segment(note)', 'auto(note)', 'auto-result(note)', 'auto-table(note)'].every((s) => seenA.includes(s)), seenA.filter((s) => s.includes('note')).join(', '));
await page.screenshot({ path: shots + 'tour-00-last-step.png' });
await pop.getByRole('button', { name: 'Finish ✓' }).click();
check('Finish closes the tour and focus returns to the button', !(await pop.count()) && await open.evaluate((b) => b === document.activeElement));
let s = await stored();
check('No recording case: nothing stored or changed', s.exp === empty.exp && s.recs === empty.recs && JSON.stringify((await vow()).work) === startWork);

// ── B. With a saved recording, a saved experiment and an automatic result ──
await page.locator('input[type=file][accept^=".wav"]').setInputFiles(wavPath);
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 1);
await page.locator('.vl-bar').getByRole('button', { name: '💾 Save experiment' }).click();
await page.locator('.vl-stage[data-stage="auto"]').getByRole('button', { name: '🔍 Analyze vowel' }).click();
await page.locator('.vl-stage[data-stage="auto"]').getByRole('button', { name: '💾 Save automatic result' }).click();
await wait(500);
const before = await stored();
const v0 = await vow();
const workBefore = JSON.stringify(v0.work);
check('Setup: one stored recording, a saved manual experiment and a saved automatic result', before.recs.split('|').length === 1 && v0.saved.length === 2);

await open.click();
const seenB = await walk('Desktop, with a recording');
check('With a recording and an analysis, no step needs a “not there yet” note', !seenB.some((x) => x.includes('note')), seenB.filter((x) => x.includes('note')).join(', '));

// Back, arrow keys, Escape.
await pop.getByRole('button', { name: '← Back' }).click();
await wait(500);
g = await geo();
check('Back moves to the previous control', g.step === 'pitch');
await page.keyboard.press('ArrowLeft');
await wait(500);
check('Left arrow goes back as well', (await geo()).step === 'return');
await page.keyboard.press('ArrowRight');
await wait(500);
check('Right arrow goes forward', (await geo()).step === 'pitch');
await page.keyboard.press('Escape');
check('Escape closes it, focus back on the button', !(await pop.count()) && await open.evaluate((b) => b === document.activeElement) && !(await page.evaluate(() => document.body.classList.contains('vtour-on'))));

// Keyboard only.
await open.focus();
await page.keyboard.press('Enter');
await wait(400);
check('Keyboard: Enter starts it and focus lands on Next', (await pop.count()) === 1 && await page.evaluate(() => document.activeElement.closest('.vtour-pop') !== null && document.activeElement.textContent.includes('Next')));
await page.keyboard.press('Enter');
await wait(500);
check('Keyboard: Enter on Next moves to step 2', (await geo()).step === 'labels');
await page.keyboard.press('Escape');

// "Explain this section" starts at the automatic step.
await page.locator('.vl-stage[data-stage="auto"]').getByRole('button', { name: '❓ Explain this section' }).click();
await wait(800);
g = await geo();
check('“Explain this section” starts the tour at the automatic step, on Analyze vowel', g.step === 'auto' && g.target && g.target.t >= 0 && g.target.b <= g.vh);
await page.screenshot({ path: shots + 'tour-01-desktop-auto.png' });

// Page scroll and window resize while a step is shown.
await page.mouse.wheel(0, 250);
await wait(300);
g = await geo();
check('Scrolling the page: the highlight follows the control', g.hole && g.target && Math.abs(g.hole.t - (g.target.t - 8)) < 2);
await page.setViewportSize({ width: 900, height: 700 });
await wait(400);
g = await geo();
check('Resizing the window: highlight and card are re-placed, card stays on screen', g.hole && Math.abs(g.hole.l - (g.target.l - 8)) < 2 && g.pop.r <= 900 && g.pop.b <= 700 && overlap(g.pop, g.target) === 0, `side ${g.side}`);
await pop.getByRole('button', { name: 'Close the tour' }).click();

// ── C. Phone size ──
await page.setViewportSize({ width: 375, height: 667 });
await wait(300);
await page.locator('.vl-intro').scrollIntoViewIfNeeded();
await open.click();
await walk('Phone 375 × 667, with a recording');
await pop.getByRole('button', { name: '← Back' }).click();
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowLeft');
await wait(800);
await page.screenshot({ path: shots + 'tour-02-phone.png' });
await pop.getByRole('button', { name: 'Close the tour' }).click();
check('Phone: Close works and the page is back to normal', !(await pop.count()) && !(await page.evaluate(() => document.body.classList.contains('vtour-on'))));
await page.setViewportSize({ width: 1280, height: 900 });

// ── Nothing changed ──
const after = await stored();
const v = await vow();
check('Stored experiments (localStorage) are byte-for-byte unchanged', after.exp === before.exp);
check('Stored recordings (IndexedDB) are unchanged', after.recs === before.recs);
check('Open experiment unchanged and saved; nothing played or recorded', JSON.stringify(v.work) === workBefore && !v.dirty && v.audio.state === 'idle' && v.rec.state === 'idle' && v.audio.contexts === v0.audio.contexts);
check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);

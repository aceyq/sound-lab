// Browser checks for the "How to use Vowel Lab" tutorial popup.
// Usage: start the app (npm run dev), then: node scripts/verify-tutorial.mjs [url]
// Checks that it opens, steps forward and back, closes (button, Escape,
// Finish), works by keyboard and at phone size, and changes no stored data.
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
const x = new Float32Array(SR * 2).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 440 * i) / SR));
const wavPath = join(tmpdir(), 'fp-tutorial-sim.wav');
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
const dlg = page.locator('dialog.vt-dialog');
const vow = async () => (await page.evaluate(() => window.__frequencyPlayground.debug())).vowel;
const stored = () => page.evaluate(async () => {
  const exp = localStorage.getItem('frequencyPlayground.vowelLab.experiments.v1');
  const recs = await new Promise((res) => {
    const r = indexedDB.open('frequency-playground-vowel-lab', 1);
    r.onsuccess = () => { const t = r.result.transaction('recordings').objectStore('recordings').getAll(); t.onsuccess = () => res(t.result.map((x) => `${x.id}:${x.name}:${x.pcm.byteLength}`).join('|')); };
    r.onerror = () => res('error');
  });
  return { exp, recs };
});

await btn('🗣 Vowel Lab: harmonic sliders').click();
await wait(300);
// Some saved data to protect: one recording, one saved experiment.
await page.locator('input[type=file][accept^=".wav"]').setInputFiles(wavPath);
await page.waitForFunction(() => window.__frequencyPlayground.debug().vowel.recordings.length === 1);
await page.locator('.vl-bar').getByRole('button', { name: '💾 Save experiment' }).click();
await wait(500);
const before = await stored();
const workBefore = JSON.stringify((await vow()).work);
check('Setup: one stored recording and one saved experiment', before.exp && before.recs.split('|').length === 1);

const open = btn('❓ How to use Vowel Lab');
check('“How to use Vowel Lab” button is visible at the top of Vowel Lab', await open.isVisible());
await open.click();
await wait(150);
check('Opens a modal popup at step 1 of 10', await dlg.evaluate((d) => d.open) && (await dlg.locator('.vt-count').innerText()).match(/Step 1 of 10/i) && (await dlg.locator('.vt-title').innerText()) === 'What Vowel Lab is for');
check('Back is disabled on step 1; Close is visible', await dlg.getByRole('button', { name: '← Back' }).isDisabled() && await dlg.getByRole('button', { name: 'Close tutorial' }).isVisible());
const titles = [await dlg.locator('.vt-title').innerText()];
for (let k = 2; k <= 10; k++) {
  await dlg.getByRole('button', { name: 'Next →' }).click();
  titles.push(await dlg.locator('.vt-title').innerText());
  if (!(await dlg.locator('.vt-count').innerText()).match(new RegExp(`Step ${k} of 10`, 'i'))) check(`Step ${k} counter`, false);
}
check('Next walks through all 10 steps', titles.length === 10 && new Set(titles).size === 10, titles.join(' | '));
check('Last step shows Finish instead of Next', await dlg.getByRole('button', { name: 'Finish ✓' }).isVisible());
await dlg.getByRole('button', { name: '← Back' }).click();
check('Back goes to step 9 (Automatic vowel synthesis)', (await dlg.locator('.vt-title').innerText()) === 'Automatic vowel synthesis');
await page.keyboard.press('ArrowLeft');
check('Left arrow key goes back too', (await dlg.locator('.vt-title').innerText()) === 'Try another pitch');
await page.keyboard.press('Escape');
await wait(100);
check('Escape closes it and focus returns to the button', !(await dlg.evaluate((d) => d.open)) && await open.evaluate((b) => b === document.activeElement));

// Keyboard only: open with Enter, Tab around, close with the Close button.
await open.focus();
await page.keyboard.press('Enter');
await wait(100);
let focusInside = true;
for (let k = 0; k < 18; k++) {
  await page.keyboard.press('Tab');
  // The page behind is inert; focus may pass through the browser's own UI (body) but never to a page control.
  if (!(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('dialog.vt-dialog')))) focusInside = false;
}
check('Keyboard: Enter opens it and Tab never reaches the page behind', await dlg.evaluate((d) => d.open) && focusInside);
await dlg.getByRole('button', { name: 'Step 5: Shape the harmonics' }).click();
check('Step dots jump straight to a step', (await dlg.locator('.vt-title').innerText()) === 'Shape the harmonics' && (await dlg.innerText()).includes('400 Hz'));
await page.screenshot({ path: shots + 'tutorial-01-desktop.png' });
await dlg.getByRole('button', { name: 'Close tutorial' }).click();
check('Close button closes it', !(await dlg.evaluate((d) => d.open)));

// Reopen any time; Finish closes.
await open.click();
for (let k = 0; k < 9; k++) await dlg.getByRole('button', { name: 'Next →' }).click();
await dlg.getByRole('button', { name: 'Finish ✓' }).click();
check('Reopens at step 1, and Finish closes it', !(await dlg.evaluate((d) => d.open)));

// The automatic section's own help button opens the automatic step.
await page.locator('.vl-stage[data-stage="auto"]').getByRole('button', { name: '❓ Explain this section' }).click();
check('“Explain this section” in the automatic section opens step 9', (await dlg.locator('.vt-title').innerText()) === 'Automatic vowel synthesis' && (await dlg.locator('.vt-count').innerText()).match(/Step 9 of 10/i));
await dlg.getByRole('button', { name: '👀 Show me on the page' }).click();
await wait(900);
const box = await page.locator('.vl-stage[data-stage="auto"]').boundingBox();
check('“Show me” closes the popup and scrolls to that part of the page', !(await dlg.evaluate((d) => d.open)) && box.y > -50 && box.y < 300, `section top at ${Math.round(box.y)} px`);

// Phone size.
await page.setViewportSize({ width: 375, height: 667 });
await wait(200);
await page.locator('.vl-intro').scrollIntoViewIfNeeded();
await open.click();
await dlg.getByRole('button', { name: 'Step 4: Find the fundamental by hand' }).click();
const r = await dlg.boundingBox();
const overflow = await dlg.evaluate((d) => d.scrollWidth > d.clientWidth + 1);
check('Phone size (375 × 667): popup fits the screen, no sideways scrolling', r.x >= 0 && r.x + r.width <= 375 && r.y >= 0 && r.y + r.height <= 667 && !overflow, `${Math.round(r.width)}×${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)}`);
check('Phone size: Next, Back and Close are all reachable', await dlg.getByRole('button', { name: 'Next →' }).isVisible() && await dlg.getByRole('button', { name: '← Back' }).isVisible() && await dlg.getByRole('button', { name: 'Close tutorial' }).isVisible());
await page.screenshot({ path: shots + 'tutorial-02-phone.png' });
await page.mouse.click(5, 5); // the dimmed backdrop
await wait(100);
check('Clicking outside the box closes it', !(await dlg.evaluate((d) => d.open)));
await page.setViewportSize({ width: 1280, height: 900 });

// Nothing changed.
const after = await stored();
const v = await vow();
check('Stored experiments (localStorage) are byte-for-byte unchanged', after.exp === before.exp);
check('Stored recordings (IndexedDB) are unchanged', after.recs === before.recs, after.recs);
check('The open experiment is unchanged and still saved; nothing played', JSON.stringify(v.work) === workBefore && !v.dirty && v.audio.state === 'idle' && v.rec.state === 'idle');
check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);

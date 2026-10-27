// "How to use Vowel Lab" tutorial: ten short steps that name only controls
// that really exist in the Vowel Lab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUTORIAL_STEPS } from '../src/pages/frequency/vowel-tutorial.js';

const lab = readFileSync(new URL('../src/pages/frequency/vowel-lab.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../src/pages/frequency/vowel-model.js', import.meta.url), 'utf8');
const text = (s) => s.paras.map((p) => (typeof p === 'string' ? p : p.list ? p.list.join(' ') : p.example)).join(' ');

test('ten steps in the requested order, each short enough to read comfortably', () => {
  assert.deepEqual(TUTORIAL_STEPS.map((s) => s.id), ['purpose', 'record', 'segment', 'fundamental', 'sliders', 'compare', 'save', 'pitch', 'auto', 'wrapup']);
  for (const s of TUTORIAL_STEPS) {
    const words = text(s).split(/\s+/).length;
    assert.ok(words <= 130, `${s.id}: ${words} words`);
    assert.ok(s.title && s.title.length <= 40, s.title);
  }
});

test('the requested examples are present', () => {
  const byId = Object.fromEntries(TUTORIAL_STEPS.map((s) => [s.id, text(s)]));
  assert.match(byId.fundamental, /4 ms/);
  assert.match(byId.fundamental, /250 Hz/);
  assert.match(byId.sliders, /200 Hz.*400 Hz.*600 Hz/);
  assert.match(byId.record, /does not change the sound/);
  assert.match(byId.auto, /manual correction/);
  assert.match(byId.auto, /No reliable result/);
});

test('every control the tutorial names exists in the app', () => {
  const labels = [
    '♪ Play reference tone', '● Record vowel', 'Use in this experiment', '⬆ Import a WAV recording', 'Middle second',
    'Synthesis fundamental f0', 'Start over from', 'Linear 0–1', 'Decibels',
    '▶ Play Original', '▶ Play Synthesized', '⇄ Original → Synthesized', '■ Stop',
    '💾 Save experiment', '● Unsaved changes', 'Original (WAV)', 'Synthesized (WAV)', 'Settings (JSON)', '⬆ Import settings (JSON)', 'Saved experiments',
    'A: same amplitudes, new f0', 'B: record again and readjust',
    'Automatic vowel synthesis', '🔍 Analyze vowel', 'Estimated fundamental (Hz)', '💾 Save automatic result', 'No reliable result', 'manual correction',
  ];
  const all = TUTORIAL_STEPS.map(text).join(' ');
  for (const l of labels) {
    const short = l.replace(/^[^\w“A-Z]+\s*/u, '');
    assert.ok(lab.includes(short), `app has “${short}”`);
  }
  for (const name of ['Neutral 1/n', 'Fundamental only', 'All zero']) {
    assert.ok(model.includes(`name: '${name}'`), `reset option ${name}`);
    assert.ok(all.includes(name), `tutorial names ${name}`);
  }
  // Selectors used by "Show me" point at real sections.
  for (const s of TUTORIAL_STEPS.filter((x) => x.target)) {
    const m = s.target.match(/data-stage="([^"]+)"/);
    if (m) assert.ok(m[1] === 'auto' ? lab.includes("'data-stage': 'auto'") : /stage\(\d/.test(lab), s.target);
  }
});

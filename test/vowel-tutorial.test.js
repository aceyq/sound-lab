// "How to use Vowel Lab" guided tour: short steps, in workflow order, each
// pointing at a control that really exists in the Vowel Lab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUTORIAL_STEPS } from '../src/pages/frequency/vowel-tutorial.js';

const lab = readFileSync(new URL('../src/pages/frequency/vowel-lab.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../src/pages/frequency/vowel-model.js', import.meta.url), 'utf8');
const SPECIAL = { take: 'recList', overview: 'overview', zoom: 'zoom', spec2: 'spec2', spec4: 'spec4', autoSpec: 'autoSpec', f0s2: null, rows: 'rows', autoResult: 'autoReliab', autoTable: 'autoTable' };

test('steps follow the workflow order Ace asked for', () => {
  const ids = TUTORIAL_STEPS.map((s) => s.id);
  const order = ['experiment', 'labels', 'reference', 'record', 'take', 'segment', 'waveform', 'f0', 'sliders', 'reset', 'listen', 'auto', 'compare-spectrum', 'save', 'pitch'];
  // Each topic is present…
  for (const id of order) assert.ok(ids.includes(id), id);
  // …and the manual workflow comes in this order.
  const manual = ['experiment', 'labels', 'reference', 'record', 'take', 'segment', 'waveform', 'spectrum', 'f0', 'sliders', 'reset', 'listen'];
  assert.deepEqual(ids.filter((x) => manual.includes(x)), manual);
  assert.ok(ids.indexOf('auto') < ids.indexOf('auto-save') && ids.indexOf('auto-save') < ids.indexOf('pitch'));
  assert.equal(ids.at(-1), 'wrapup');
});

test('every explanation is one or two short sentences', () => {
  for (const s of TUTORIAL_STEPS) {
    const sentences = s.body.split(/(?<=[.!?])\s+(?=[A-Z“▶⇄■💾🔍])/).length;
    assert.ok(sentences <= 2, `${s.id}: ${sentences} sentences`);
    assert.ok(s.body.split(/\s+/).length <= 40, `${s.id}: ${s.body.split(/\s+/).length} words`);
    assert.ok(s.title.length <= 40, s.title);
  }
});

test('the small examples are there', () => {
  const by = Object.fromEntries(TUTORIAL_STEPS.map((s) => [s.id, s.body + ' ' + (s.missing || '')]));
  assert.match(by.waveform, /4 ms.*250 Hz/);
  assert.match(by.sliders, /200 Hz.*200, 400, 600, 800 Hz/);
  assert.match(by.labels, /does not change the sound/);
  assert.match(by['auto-result'], /manual correction/);
  assert.match(by['auto-result'], /No reliable result/);
  for (const name of ['Neutral 1/n', 'Fundamental only', 'All zero']) {
    assert.ok(by.reset.includes(name), name);
    assert.ok(model.includes(`name: '${name}'`), `app has reset option ${name}`);
  }
});

test('every step points at a real Vowel Lab control', () => {
  for (const s of TUTORIAL_STEPS) {
    if (s.pick == null) { assert.equal(s.id, 'wrapup'); continue; }
    const names = typeof s.pick === 'string' && s.pick in SPECIAL ? [SPECIAL[s.pick]].filter(Boolean) : [].concat(s.pick);
    for (const n of [...names, ...[].concat(s.fallback || [])]) assert.match(lab, new RegExp(`\\bel\\.${n} = `), `${s.id}: el.${n} exists`);
    if (s.pick === 'f0s2') assert.ok(lab.includes("makeF0Control('s2')") && lab.includes("id: 'vl-f0-' + idSuffix"));
    if (s.pick === 'take') assert.ok(lab.includes("'vl-rec' + (used ? ' used' : '')"));
  }
  // Steps whose control only appears later explain what to do instead.
  for (const id of ['take', 'auto-result', 'auto-table', 'segment', 'auto']) assert.ok(TUTORIAL_STEPS.find((s) => s.id === id).missing, id);
});

// "How to use Vowel Lab": a click-through tutorial in a popup (a modal
// <dialog>). It only explains; it never records, plays, saves or changes any
// setting, recording or experiment. Each step can offer a "Show me" link that
// closes the popup and scrolls to the part of the page it describes, which
// also changes nothing.
//
// The step text is plain data (TUTORIAL_STEPS) so it is unit-tested against
// the real control labels.
import { h } from '../../lib/dom.js';

// Each step: { id, title, paras: [text | { list: [...] } | { example: text }], target? (CSS selector to "Show me") }
export const TUTORIAL_STEPS = [
  {
    id: 'purpose',
    title: 'What Vowel Lab is for',
    paras: [
      'You record yourself singing one vowel, like “ah”, “ee” or “oo”. Then you try to rebuild that sound from simple sine waves called harmonics.',
      'You can do this by hand (stages 1–5), or let the app estimate it for you (the ⚙ Automatic vowel synthesis section). Either way you listen and compare.',
      'This tutorial only explains. It does not record, play, or change any of your settings, recordings or saved experiments.',
    ],
  },
  {
    id: 'record',
    title: 'Record a vowel',
    target: '.vl-stage[data-stage="1"]',
    paras: [
      { list: [
        'In stage 1, choose a Vowel (ah, ee, oo or other) and a Pitch label (lower, higher, middle or other). These are only names for your files. The pitch label does not change the sound.',
        'Optional: type a frequency and press ♪ Play reference tone to hum along, then stop it.',
        'Pick a length (2, 3 or 4 s) and press ● Record vowel. Sing one steady vowel.',
        'Every take is kept in the Recordings list. Use “Use in this experiment” to pick which take the experiment uses. You can also ⬆ Import a WAV recording.',
      ] },
    ],
  },
  {
    id: 'segment',
    title: 'Select a steady section',
    target: '.vl-stage[data-stage="2"] .vl-overview-box',
    paras: [
      'At the start and end of a take your voice is still settling: the pitch and loudness change. Those parts make the pattern harder to read.',
      'In stage 2, drag across the overview plot (or type From/To times) to shade a steady part in the middle. “Middle second” picks the middle 1 s.',
      { example: 'Example: in a 3 s take, 1.0–2.0 s is usually steadier than 0.0–1.0 s.' },
      'The plots, Play Original, and the automatic analysis all use this shaded section.',
    ],
  },
  {
    id: 'fundamental',
    title: 'Find the fundamental by hand',
    target: '.vl-stage[data-stage="2"] .vl-two',
    paras: [
      'The fundamental (f0) is how many times per second your voice’s wave shape repeats. It is the pitch you hear.',
      { list: [
        'Waveform: zoom in until you see the shape repeat. Click A at the start of one repetition and B one or more repetitions later. The app shows f0 = repetitions ÷ time.',
        'Spectrum: the peaks are evenly spaced. The spacing between neighbouring peaks is about f0. You can click a peak and tell the app which harmonic number it is.',
      ] },
      { example: 'Example: if the pattern repeats about every 4 ms, f0 ≈ 1 ÷ 0.004 s = 250 Hz.' },
      'Type the value into Synthesis fundamental f0. The tallest peak is not always the fundamental.',
    ],
  },
  {
    id: 'sliders',
    title: 'Shape the harmonics',
    target: '.vl-stage[data-stage="3"]',
    paras: [
      'Harmonics are whole-number multiples of the fundamental. Each slider in stage 3 sets how strong one harmonic is (0 = off, 1 = strongest).',
      { example: 'Example with f0 = 200 Hz: harmonic 1 = 200 Hz, harmonic 2 = 400 Hz, harmonic 3 = 600 Hz, harmonic 4 = 800 Hz, and so on.' },
      { list: [
        'Choose how many harmonics to show (up to 48), and Linear 0–1 or Decibels for the sliders.',
        '“Start over from” resets every slider: Neutral 1/n (a gently falling, buzzy tone), Fundamental only (just harmonic 1), or All zero (silence). The app asks before replacing your values.',
      ] },
    ],
  },
  {
    id: 'compare',
    title: 'Compare the sounds',
    target: '.vl-bar',
    paras: [
      { list: [
        '▶ Play Original plays your shaded section (or the whole take, if you choose that).',
        '▶ Play Synthesized plays the sine-wave version until you press ■ Stop. Moving a slider changes it live.',
        '⇄ Original → Synthesized plays one, a short pause, then the other, for easy back-and-forth listening.',
      ] },
      'In stage 4, the spectrum shows both sounds’ harmonic strengths (orange = recording, cyan = synthesis). The waveform view shows both wave shapes.',
      'The wave shapes can look different even when the sounds are close, because the synthesis starts every sine at the same phase.',
    ],
  },
  {
    id: 'save',
    title: 'Save and download',
    target: '.vl-stage[data-stage="4"]',
    paras: [
      'Press 💾 Save experiment (top bar) to keep your settings and notes in this browser. “● Unsaved changes” means you changed something since the last save.',
      { list: [
        'Original (WAV): your recording, exactly as captured.',
        'Synthesized (WAV): the sound made from your saved sliders.',
        'Settings (JSON): the fundamental, every harmonic amplitude, the labels and your notes.',
      ] },
      'To return to an experiment, choose it in the Experiment dropdown at the top, or press Open in the Saved experiments table in stage 5. ⬆ Import settings (JSON) brings a downloaded settings file back as a new experiment.',
    ],
  },
  {
    id: 'pitch',
    title: 'Try another pitch',
    target: '.vl-stage[data-stage="5"]',
    paras: [
      'Stage 5 makes a copy so your first version stays exactly as it is.',
      { list: [
        'A: same amplitudes, new f0. Keeps every slider and the first recording. Change only the fundamental and listen: does it still sound like the same vowel?',
        'B: record again and readjust. Copies the sliders without a recording. Record the same vowel at the new pitch, then readjust the sliders to match.',
      ] },
      'Compare which harmonics stayed strong. A vowel’s character comes from mouth resonances (formants) that stay at about the same frequencies, so different harmonic numbers may need to be strong at a new pitch.',
    ],
  },
  {
    id: 'auto',
    title: 'Automatic vowel synthesis',
    target: '.vl-stage[data-stage="auto"]',
    paras: [
      'The ⚙ section below stage 2 uses the recording and shaded section of the open experiment. Press 🔍 Analyze vowel.',
      { list: [
        'Estimated fundamental (Hz): the pitch the app measured from how often the wave repeats.',
        'Harmonic strengths: how loud each multiple of that pitch was, compared with the strongest (= 1). Ones that do not stand out from the noise are 0.',
        'Listen with the section’s own ▶ Play Original, ▶ Play Synthesized, ⇄ Original → Synthesized and ■ Stop.',
        '💾 Save automatic result adds a new experiment labelled “automatic”. It never changes your sliders or other experiments.',
      ] },
      'A silent, noisy or unsteady section gives “No reliable result” or a warning, not a confident number. If you type a different fundamental and press Re-measure, it is labelled “manual correction”.',
    ],
  },
  {
    id: 'wrapup',
    title: 'Wrap-up',
    paras: [
      'Two things make a synthesized vowel sound right: the correct pitch (the fundamental) and the right balance of harmonic strengths.',
      'Even with both, it may not sound exactly like a real voice. Real voices also have breath noise, small wobbles in pitch and loudness, and their own phases.',
      'You can reopen this tutorial at any time with the “How to use Vowel Lab” button.',
    ],
  },
];

/**
 * Returns { button, dialog, open(stepIndex), close(), get step(), get isOpen() }.
 * `button` is the "How to use Vowel Lab" button that opens it.
 */
export function createVowelTutorial({ label = '❓ How to use Vowel Lab' } = {}) {
  const steps = TUTORIAL_STEPS;
  let i = 0;
  let opener = null;
  const count = h('p', { class: 'vt-count', 'aria-live': 'polite' });
  const bar = h('span', { class: 'vt-bar' });
  const progress = h('div', { class: 'vt-progress', 'aria-hidden': 'true' }, bar);
  const title = h('h2', { class: 'vt-title', id: 'vt-title' });
  const body = h('div', { class: 'vt-body', id: 'vt-body' });
  const showMe = h('button', { class: 'btn small vt-show', type: 'button', onclick: () => jump() }, '👀 Show me on the page');
  const back = h('button', { class: 'btn', type: 'button', onclick: () => go(i - 1) }, '← Back');
  const next = h('button', { class: 'btn primary', type: 'button', onclick: () => (i === steps.length - 1 ? close() : go(i + 1)) }, 'Next →');
  const closeX = h('button', { class: 'btn small vt-x', type: 'button', 'aria-label': 'Close tutorial', onclick: () => close() }, '✕ Close');
  const dots = h('div', { class: 'vt-dots', role: 'group', 'aria-label': 'Jump to step' },
    steps.map((s, k) => h('button', { type: 'button', class: 'vt-dot', 'aria-label': `Step ${k + 1}: ${s.title}`, onclick: () => go(k) })));
  const dialog = h('dialog', { class: 'vt-dialog', 'aria-labelledby': 'vt-title', 'aria-describedby': 'vt-body' },
    h('div', { class: 'vt-head' }, count, closeX),
    progress,
    title,
    body,
    h('div', { class: 'vt-foot' }, showMe, h('span', { class: 'vt-spacer' }), back, next),
    dots,
  );
  dialog.addEventListener('close', () => { if (opener && opener.isConnected) opener.focus(); });
  // Click on the dimmed backdrop (outside the box) closes it.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); if (i < steps.length - 1) go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  });

  function render() {
    const s = steps[i];
    count.textContent = `Step ${i + 1} of ${steps.length}`;
    bar.style.width = `${((i + 1) / steps.length) * 100}%`;
    title.textContent = s.title;
    body.replaceChildren(...s.paras.map((p) => {
      if (typeof p === 'string') return h('p', {}, p);
      if (p.list) return h('ul', {}, p.list.map((li) => h('li', {}, li)));
      return h('p', { class: 'vt-example' }, p.example);
    }));
    body.scrollTop = 0;
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Finish ✓' : 'Next →';
    showMe.hidden = !s.target;
    dots.querySelectorAll('.vt-dot').forEach((d, k) => d.setAttribute('aria-current', k === i ? 'step' : 'false'));
  }

  function go(k) {
    i = Math.max(0, Math.min(steps.length - 1, k));
    render();
    // Keep keyboard focus inside on the buttons that still make sense.
    if (document.activeElement === back && back.disabled) next.focus();
  }

  function open(k = 0) {
    opener = document.activeElement;
    if (!dialog.isConnected) document.body.append(dialog);
    i = Math.max(0, Math.min(steps.length - 1, k));
    render();
    if (!dialog.open) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    next.focus();
  }

  function close() {
    if (dialog.open) {
      if (dialog.close) dialog.close();
      else dialog.removeAttribute('open');
    }
  }

  /** Closes the popup and scrolls to the part of the page this step describes. */
  function jump() {
    const sel = steps[i].target;
    close();
    const el = sel && document.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('vt-flash');
    void el.offsetWidth; // restart the highlight animation
    el.classList.add('vt-flash');
    setTimeout(() => el.classList.remove('vt-flash'), 2200);
  }

  const button = h('button', { class: 'btn vt-open', type: 'button', onclick: () => open(0) }, label);

  return {
    button,
    dialog,
    open,
    close,
    get step() { return i; },
    get isOpen() { return dialog.open; },
    dispose() { close(); dialog.remove(); },
  };
}

// "How to use Vowel Lab": a guided tour over the real page, in the style of
// the Motion Score walkthrough (src/lib/tour.js). Each step scrolls to one
// control, cuts a bright highlight around it, dims the rest, and shows a short
// card right beside it, never on top of it. Next/Back/Skip, a step counter,
// arrow keys and Escape work throughout.
//
// The tour only scrolls and highlights. It never records, plays, changes a
// slider, saves or deletes anything. The page stays usable underneath, so
// you can try a control yourself while its step is shown.
//
// Steps are plain data (TUTORIAL_STEPS) so they are unit-tested against the
// real Vowel Lab element names. `pick` names entries of the Vowel Lab's `el`
// map, or is a function (el, root) => Element | Element[] | null.
import { h } from '../../lib/dom.js';

export const TUTORIAL_STEPS = [
  { id: 'experiment', pick: ['expSelect', 'newBtn'], title: 'Pick or start an experiment',
    body: 'An experiment is one vowel at one pitch: its recording, fundamental, sliders and notes. Choose a saved one here, or press ＋ New experiment.' },
  { id: 'labels', pick: ['vowel', 'pitch'], title: 'Name the vowel and pitch',
    body: 'These labels only name the experiment and its files (for example oo_lower). The pitch label does not change the sound.' },
  { id: 'reference', pick: ['refInput', 'refBtn'], title: 'Reference tone (optional)',
    body: 'Type a comfortable pitch and press ♪ Play reference tone to hum along. Stop it before you record.' },
  { id: 'record', pick: ['durButtons', 'recordBtn'], title: 'Record a vowel',
    body: 'Pick 2, 3 or 4 s, press ● Record vowel and sing one steady vowel. Nothing is recorded until you press it.' },
  { id: 'take', pick: 'take', title: 'Choose your take',
    body: 'Every take is kept here. “Use in this experiment” picks which one this experiment uses; ✓ marks the one in use.',
    missing: 'No recordings yet. Record a vowel or press ⬆ Import a WAV recording, and your takes will be listed here.', fallback: ['importWavBtn'] },
  { id: 'segment', pick: 'overview', title: 'Select a steady section',
    body: 'Drag across the steady middle of the take and skip the wobbly start and end. Example: 1.0–2.0 s of a 3 s take.',
    missing: 'This shows your take once the experiment has a recording.', needsRecording: true },
  { id: 'waveform', pick: 'zoom', title: 'Waveform: find the repetition',
    body: 'A sung vowel repeats one shape. Click A and B on matching points: if it repeats every 4 ms, f0 ≈ 1 ÷ 0.004 s = 250 Hz.',
    missing: 'The zoomed waveform appears once the experiment has a recording.', needsRecording: true },
  { id: 'spectrum', pick: 'spec2', title: 'Spectrum: evenly spaced peaks',
    body: 'Harmonics sit at f0, 2 × f0, 3 × f0…, so the spacing between peaks is about f0. The tallest peak is not always the fundamental.',
    missing: 'The spectrum appears once the experiment has a recording.', needsRecording: true },
  { id: 'f0', pick: 'f0s2', title: 'Enter the fundamental',
    body: 'Type your estimate in Hz, or nudge it with ±1 and ±0.1. Every harmonic then moves to n × f0.' },
  { id: 'sliders', pick: 'rows', title: 'Shape the harmonic strengths',
    body: 'Each slider is one harmonic’s strength (0 = off). With f0 = 200 Hz the rows are 200, 400, 600, 800 Hz and so on.' },
  { id: 'reset', pick: 'recipeButtons', title: 'Reset options',
    body: 'Start over from Neutral 1/n (buzzy), Fundamental only (a pure tone) or All zero (silence). The app asks before replacing your values.' },
  { id: 'listen', pick: ['playOrig', 'playSynth', 'playAB', 'stopBtn'], title: 'Compare by ear',
    body: '▶ Play Original plays your section, ▶ Play Synthesized plays the sliders, and ⇄ plays one after the other. ■ Stop ends any sound.' },
  { id: 'compare-spectrum', pick: 'spec4', title: 'Compare the spectra',
    body: 'Orange is your recording, cyan is the synthesis. Where the peak heights match, the harmonic strengths match.' },
  { id: 'auto', pick: 'autoAnalyze', title: 'Automatic synthesis: Analyze vowel',
    body: 'Uses this experiment’s take and shaded section. 🔍 Analyze vowel estimates f0 and the harmonic strengths without touching your sliders.',
    missing: 'Choose a recording for this experiment first; then this button becomes available.' },
  { id: 'auto-result', pick: 'autoResult', title: 'Estimated fundamental',
    body: 'The measured f0 and how steady the section was. If you type another value and press Re-measure, it is labelled “manual correction”.',
    missing: 'After you press Analyze vowel, the estimate appears below the button. A silent or noisy section shows “No reliable result” instead.', fallback: ['autoAnalyze'] },
  { id: 'auto-table', pick: 'autoTable', title: 'Measured harmonic strengths',
    body: 'One row per harmonic: the strongest is 1, and harmonics lost in the noise are 0.',
    missing: 'After an analysis, a table of harmonic strengths appears in this section.', fallback: ['autoAnalyze'] },
  { id: 'auto-play', pick: ['autoPlayOrig', 'autoPlaySynth', 'autoPlayAB', 'autoStop'], title: 'Listen to the automatic result',
    body: 'These play the analyzed section and the new sine-wave version. They do not use your sliders.' },
  { id: 'auto-spectrum', pick: 'autoSpec', title: 'Automatic: compare spectra',
    body: 'The frequency patterns of original and synthesis. Wave shapes can still differ because of phase.' },
  { id: 'auto-save', pick: ['autoSave', 'autoDlWav', 'autoDlJson'], title: 'Keep the automatic result',
    body: 'Saves it as a separate “automatic” experiment, and downloads the WAV and analysis. Your other experiments stay as they are.' },
  { id: 'save', pick: ['saveBtn', 'saveState'], title: 'Save your experiment',
    body: '💾 Save experiment keeps your settings and notes in this browser. “● Unsaved changes” means you edited since the last save.' },
  { id: 'downloads', pick: ['dlOrig', 'dlSynth', 'dlSettings'], title: 'Download the files',
    body: 'Original WAV = your take; Synthesized WAV = your saved sliders; Settings JSON = f0, every amplitude and your notes.' },
  { id: 'return', pick: 'expTable', title: 'Return to an experiment',
    body: 'Every saved experiment is listed here; press Open to continue it. The dropdown at the top does the same.' },
  { id: 'pitch', pick: ['dupA', 'dupB'], title: 'Try another pitch',
    body: 'A keeps every slider and changes only f0; B records the same vowel again so you can readjust. The original stays unchanged.' },
  { id: 'wrapup', pick: null, title: 'That’s the tour',
    body: 'Matching the pitch and the balance of harmonics both matter. Even then a synthesized vowel won’t sound exactly like a voice: it has no breath noise or wobble.' },
];

const PAD = 8; // highlight margin around the control
const GAP = 12; // space between highlight and card
const EDGE = 10; // keep clear of the window edge

/**
 * Creates the tour. `el` is the Vowel Lab's element map; `hasRecording()`
 * says whether the open experiment has a recording.
 * Returns { button, start(at), close(), get isOpen(), get step(), dispose(), resolve(i) }.
 */
export function createVowelTutorial({ el = {}, root = document, hasRecording = () => true, label = '❓ How to use Vowel Lab' } = {}) {
  const steps = TUTORIAL_STEPS;
  let i = -1;
  let opener = null;
  let raf = 0;
  let current = null; // { els, missing } for the shown step

  const hole = h('div', { class: 'tour-hole vtour-hole', 'aria-hidden': 'true' });
  const shade = h('div', { class: 'tour-shade', 'aria-hidden': 'true' });
  const count = h('div', { class: 'tour-count', 'aria-live': 'polite' });
  const title = h('div', { class: 'tour-title', id: 'vtour-title' });
  const body = h('div', { class: 'tour-body', id: 'vtour-body' });
  const note = h('div', { class: 'vtour-note' });
  const back = h('button', { class: 'btn small', type: 'button', onclick: () => go(i - 1) }, '← Back');
  const next = h('button', { class: 'btn small primary', type: 'button', onclick: () => go(i + 1) }, 'Next →');
  const skip = h('button', { class: 'btn small vtour-skip', type: 'button', 'aria-label': 'Close the tour', onclick: () => close() }, '✕ Close');
  const pop = h('div', { class: 'tour-pop vtour-pop', role: 'dialog', 'aria-labelledby': 'vtour-title', 'aria-describedby': 'vtour-body' },
    h('div', { class: 'vtour-head' }, count, skip), title, body, note,
    h('div', { class: 'tour-buttons' }, back, next));

  const onKey = (e) => {
    if (i < 0) return;
    const typing = e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (typing) return;
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  };
  const onResize = () => { if (i >= 0) bringIntoView(false); };

  /** The real elements for step k: visible ones only. */
  function resolve(k) {
    const s = steps[k];
    if (!s || !s.pick) return { els: [], missing: false };
    let els = [];
    if (typeof s.pick === 'function') els = [].concat(s.pick(el, root) || []);
    else if (s.pick === 'take') {
      const list = el.recList;
      const row = list && (list.querySelector('.vl-rec.used') || list.querySelector('.vl-rec'));
      els = row ? [row] : [];
    } else if (s.pick === 'overview') els = el.overview ? [el.overview.closest('.canvas-box') || el.overview] : [];
    else if (s.pick === 'zoom' || s.pick === 'spec2' || s.pick === 'spec4' || s.pick === 'autoSpec') els = el[s.pick] ? [el[s.pick].closest('.canvas-box') || el[s.pick]] : [];
    else if (s.pick === 'f0s2') { const inp = root.querySelector('#vl-f0-s2'); els = inp ? [inp.closest('.vl-f0') || inp] : []; }
    else if (s.pick === 'rows') els = el.rows ? [...el.rows.querySelectorAll('.vl-row')].slice(0, 4) : [];
    else if (s.pick === 'autoResult') els = el.autoReliab && el.autoReliab.querySelector('.vl-auto-facts') ? [el.autoF0.closest('.vl-f0'), el.autoReliab] : [];
    else if (s.pick === 'autoTable') els = el.autoTable && el.autoTable.querySelector('table') ? [el.autoTable.querySelector('table')] : [];
    else els = byName(s.pick);
    els = els.filter((x) => x && x.isConnected && visible(x));
    // Not there yet (for example before any recording or analysis): point at
    // the control that makes it appear instead of at empty space.
    if (!els.length && s.fallback) return { els: byName(s.fallback).filter((x) => x && x.isConnected && visible(x)), missing: true };
    const needsRec = s.needsRecording && !hasRecording();
    const disabled = els.length > 0 && els.every((x) => x.disabled);
    return { els, missing: !els.length || needsRec || (s.id === 'auto' && disabled) };
  }

  function byName(names) {
    const out = [];
    for (const name of [].concat(names)) out.push(...[].concat(el[name] || []));
    return out;
  }

  function visible(x) {
    const r = x.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    for (let p = x; p; p = p.parentElement) {
      if (p.tagName === 'DETAILS' && !p.open && p !== x && !x.matches('summary')) return false;
      if (p.hidden) return false;
    }
    return true;
  }

  function unionRect(els) {
    let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
    for (const x of els) {
      const q = x.getBoundingClientRect();
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }

  function start(at = 0) {
    const k = typeof at === 'string' ? Math.max(0, steps.findIndex((s) => s.id === at)) : at;
    if (i < 0) {
      opener = document.activeElement;
      document.body.append(shade, hole, pop);
      document.body.classList.add('vtour-on');
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onResize);
    }
    go(k);
    cancelAnimationFrame(raf);
    const loop = () => {
      if (i < 0) return;
      place();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function go(k) {
    if (k >= steps.length) { close(); return; }
    i = Math.max(0, k);
    const s = steps[i];
    current = resolve(i);
    count.textContent = `Step ${i + 1} of ${steps.length}`;
    title.textContent = s.title;
    body.textContent = s.body;
    const showNote = current.missing && s.missing;
    note.textContent = showNote ? s.missing : '';
    note.hidden = !showNote;
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Finish ✓' : 'Next →';
    skip.textContent = i === steps.length - 1 ? '✕ Close' : '✕ Skip tour';
    pop.dataset.step = s.id;
    pop.dataset.missing = String(!!current.missing);
    bringIntoView(true);
    place();
    if (!pop.contains(document.activeElement)) next.focus({ preventScroll: true });
    else if (document.activeElement === back && back.disabled) next.focus({ preventScroll: true });
  }

  /** Card size for the current viewport (measured with the real text). */
  function cardSize() {
    const vw = window.innerWidth;
    const pw = Math.min(vw >= 700 ? 340 : 420, vw - 2 * EDGE);
    pop.style.width = `${pw}px`;
    return { pw, ph: pop.offsetHeight };
  }

  /**
   * Scrolls so the control and its card both fit: beside each other on a wide
   * screen, stacked on a narrow one. Horizontal scroll areas are scrolled too.
   */
  function bringIntoView(isNewStep) {
    const els = current && current.els.length ? current.els : null;
    if (!els) return;
    const smooth = isNewStep && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
    // Inner horizontal scrollers (wide tables, rows) first.
    els[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    const r = unionRect(els);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { pw, ph } = cardSize();
    const side = r.right + PAD + GAP + pw <= vw - EDGE || r.left - PAD - GAP - pw >= EDGE;
    let wantTop;
    if (side) wantTop = (vh - r.height) / 2;
    else {
      const total = r.height + 2 * PAD + GAP + ph;
      wantTop = total <= vh - 2 * EDGE ? (vh - total) / 2 + PAD : EDGE + PAD;
    }
    wantTop = Math.max(EDGE + PAD, wantTop);
    const dy = r.top - wantTop;
    let dx = 0;
    if (r.left < EDGE + PAD) dx = r.left - EDGE - PAD;
    else if (r.right > vw - EDGE - PAD && r.width < vw) dx = r.right - (vw - EDGE - PAD);
    if (Math.abs(dy) > 2 || Math.abs(dx) > 2) window.scrollBy({ top: dy, left: dx, behavior: smooth });
  }

  /** Puts the highlight on the control and the card next to it (called every frame). */
  function place() {
    if (i < 0) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { pw, ph } = cardSize();
    const els = current && current.els.filter((x) => x.isConnected);
    if (!els || !els.length) {
      hole.hidden = true;
      shade.hidden = false;
      pop.style.left = `${(vw - pw) / 2}px`;
      pop.style.top = `${Math.max(EDGE, (vh - ph) / 2)}px`;
      pop.dataset.side = 'center';
      return;
    }
    const r = unionRect(els);
    shade.hidden = true;
    hole.hidden = false;
    Object.assign(hole.style, { left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + 2 * PAD}px`, height: `${r.height + 2 * PAD}px` });
    const clampX = (x) => Math.min(Math.max(EDGE, x), vw - pw - EDGE);
    const clampY = (y) => Math.min(Math.max(EDGE, y), vh - ph - EDGE);
    let left;
    let top;
    let side;
    if (r.right + PAD + GAP + pw <= vw - EDGE) { side = 'right'; left = r.right + PAD + GAP; top = clampY(r.top); }
    else if (r.left - PAD - GAP - pw >= EDGE) { side = 'left'; left = r.left - PAD - GAP - pw; top = clampY(r.top); }
    else if (r.bottom + PAD + GAP + ph <= vh - EDGE) { side = 'below'; top = r.bottom + PAD + GAP; left = clampX(r.left); }
    else if (r.top - PAD - GAP - ph >= EDGE) { side = 'above'; top = r.top - PAD - GAP - ph; left = clampX(r.left); }
    else {
      // The control fills the screen: put the card at the edge with more room
      // and keep as much of the control visible as possible.
      side = r.top + r.height / 2 > vh / 2 ? 'top' : 'bottom';
      left = clampX((vw - pw) / 2);
      top = side === 'top' ? EDGE : vh - ph - EDGE;
    }
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.dataset.side = side;
  }

  function close() {
    if (i < 0) return;
    i = -1;
    current = null;
    cancelAnimationFrame(raf);
    hole.remove();
    shade.remove();
    pop.remove();
    document.body.classList.remove('vtour-on');
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    const back = opener && opener.isConnected ? opener : button;
    if (back && back.isConnected) back.focus({ preventScroll: true });
    opener = null;
  }

  const button = h('button', { class: 'btn vt-open', type: 'button', onclick: () => start(0) }, label);

  return {
    button,
    start,
    close,
    resolve,
    get isOpen() { return i >= 0; },
    get step() { return i; },
    get stepId() { return i >= 0 ? steps[i].id : null; },
    /** For automated checks: the highlighted control's rectangle, or null. */
    targetRect() { const els = current && current.els.filter((x) => x.isConnected); return els && els.length ? unionRect(els) : null; },
    dispose() { close(); },
  };
}

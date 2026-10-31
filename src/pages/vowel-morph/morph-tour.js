// Guided tour for Vowel Morph: highlights real controls one at a time (the
// shared spotlight Tour from src/lib/tour.js). It never records, plays or
// changes anything by itself; it only switches the view so the control it
// describes is visible.

export function morphTourSteps({ root, setView, setSpaceMode, slider, morphPlay, square, weightsEl, backupBtn, tab2, intro }) {
  const q = (sel) => () => root.querySelector(sel);
  const in1d = () => setView('1d');
  return [
    { id: 'intro', target: () => intro, before: in1d, title: 'What Vowel Morph does',
      body: 'Each recorded vowel is analyzed into a base frequency (f0) and the strengths of its harmonics. The slider and the square blend those numbers, and the app combines new sine waves at the blended values. What you hear is an approximation of your voice, not the recording itself.' },
    { id: 'record-a', target: q('[data-slot="a"] .vm-take'), before: in1d, title: 'Record Vowel A',
      body: 'Type a name (for example Aa), press Record and sing one steady vowel for 2–4 seconds. You can also import a WAV file. Recording again adds a new take; earlier takes stay in the list.',
      tryIt: 'Record “Aa”, then do the same for “Oo” in the B box.' },
    { id: 'summary', target: q('[data-slot="a"] .vm-sum'), before: in1d, title: 'The analysis summary',
      body: 'This shows the fundamental the app found, whether it was automatic or corrected by you (MANUAL), how many harmonics stood out, and how steady the pitch was. Warnings explain unreliable input.' },
    { id: 'orig-synth', target: q('[data-slot="a"] .vm-vowel-head'), before: in1d, title: 'Original vs Synthesized',
      body: '“Original” plays your recording. “Synthesized” plays the sound rebuilt from just f0 and the harmonic strengths. Compare them: the synthesized one is close but not identical.' },
    { id: 'adjust', target: q('[data-slot="a"] .vm-adjust summary'), before: in1d, title: 'Fix the analysis if needed',
      body: 'Open this to choose a steadier section of the recording, or to type the right fundamental if the automatic one is wrong (for example an octave off). Then the harmonics are measured again.' },
    { id: 'slider', target: () => slider, before: in1d, title: 'The slider (task 3)',
      body: 'All the way left is exactly Vowel A’s analyzed values, all the way right exactly Vowel B’s. In between, pitch and every harmonic strength are blended, so you hear one voice changing, not two recordings mixed.' },
    { id: 'play1', target: () => morphPlay, before: in1d, title: 'Play and drag',
      body: 'Press Play blend, then drag the slider. The same sine waves keep running and glide to the new values, so there are no restarts or clicks. Stop ends the sound with a short fade.',
      tryIt: 'Play, then drag slowly from A to B.' },
    { id: 'readout', target: q('.vm-morph .vm-readout'), before: in1d, title: 'What is changing',
      body: 'The current fundamental, its distance from A in semitones, and the harmonic bars update as you move. The orange and teal ticks mark A’s and B’s harmonic strengths.' },
    { id: 'tab2', target: () => tab2, before: in1d, title: 'The 2D sound space (task 4)',
      body: 'The same engine, generalized: each vowel becomes a dot in a square, and any point in the square blends the nearby vowels.' },
    { id: 'modes', target: q('.vm-modes'), before: () => { setView('2d'); }, title: 'Edit mode vs Play mode',
      body: 'Edit mode places and moves dots (no sound). Play mode makes sound when you click or drag. Keeping them separate means you cannot move a dot by accident while playing.' },
    { id: 'square', target: () => square, before: () => { setView('2d'); setSpaceMode('play'); }, title: 'Click or drag in the square',
      body: 'The marker sets the position of the generated sound. Tapping exactly on a dot gives that vowel’s exact analyzed values. You can choose to hear its ORIGINAL recording instead when you tap a dot.' },
    { id: 'weights', target: () => weightsEl, before: () => setView('2d'), title: 'Who contributes',
      body: 'Each vowel’s share of the blend at the marker. Closer dots count more; the shares always add up to 100 %. The lines in the square get thicker for larger shares.' },
    { id: 'backup', target: () => backupBtn, title: 'Keep your work',
      body: 'Everything is saved in this browser automatically. Download a backup to keep it safe or move it to another browser: it contains the recordings, analyses, slider pair and dot positions. Importing a backup adds to what is here and never deletes anything.' },
  ];
}

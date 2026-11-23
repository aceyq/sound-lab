// Click-through tour for Motion Morph (shared spotlight Tour from
// src/lib/tour.js). It highlights real controls one at a time with Back,
// Next and Done. It never turns on the camera, records, plays or changes a
// sound by itself; the only thing it does is open the (empty) "Add my sound"
// panel so the recording steps have something to point at.

export function poseTourSteps({ camBtn, overlay, angleCard, square, soundBtn, weightsOut, harmCanvas, addBtn, drawBtn, undoTakeBtn, adjustBtn, rangeCard, listEl, openAdd, q }) {
  const inAdd = (sel) => () => q(`.pm-add ${sel}`);
  return [
    { id: 'camera', target: () => camBtn, title: 'Turn on the camera',
      body: 'Press Enable camera and allow it in the browser. The pose model (about 6 MB) loads the first time. The video is analyzed on this computer and never uploaded. No setup is needed after this: a default movement range is already in place.',
      tryIt: 'Press Enable camera.' },
    { id: 'frame', target: () => overlay, title: 'Get your arms in frame',
      body: 'Step back until both shoulders, elbows, wrists and hips are visible. Blue marks the right shoulder–elbow–wrist (elbow bend); pink marks the left hip–shoulder–elbow (arm lift). A red ✕ means that joint is lost: the sound fades until it comes back.',
      tryIt: 'Check that all six joints have dots and no ✕.' },
    { id: 'angles', target: () => angleCard, title: 'Your two angles',
      body: 'Right elbow bend moves the marker left ↔ right; left arm lift moves it down ↕ up. Each bar shows where you are inside the movement range, with the range ends written underneath.',
      tryIt: 'Bend only your right elbow, then lift only your left arm, and watch the marker.' },
    { id: 'starters', target: () => soundBtn, title: 'Try the starter sounds',
      body: 'Press Start sound. Four starter vowels sit near the corners of the map: “ah” (arm straight, left arm down), “ee” (elbow bent, left arm down), “oo” (elbow bent, left arm up) and “eh” (arm straight, left arm up). Hold a pose and the sound holds; move and it glides.',
      tryIt: 'Press Start sound and move slowly from “ah” toward “ee”.' },
    { id: 'mix', target: () => weightsOut.closest('.pm-sound'), title: 'See what you are hearing',
      body: 'The coloured bars show how much each sound contributes at your pose (a drawn take counts as one sound). The fundamental in Hz and the harmonic graph are exactly what the synthesizer is playing: one pitch and 48 harmonic strengths, blended from the nearby sounds.' },
    { id: 'add', target: () => addBtn, title: 'Add my sound',
      body: 'This opens a short panel for teaching the map one sound of your own: record it, check it, then choose the pose that plays it.' },
    { id: 'record', target: inAdd('.pm-rec'), before: openAdd, title: 'Record a steady sound',
      body: 'Name it and press Record: make one steady pitched sound for 3 s near the laptop. Sung vowels, humming (“mmm”) and other sustained notes work. Whispers, “s”/“sh”, clicks and speech have no single pitch, so the app tells you and lets you try again.',
      tryIt: 'Record a hum or a vowel.' },
    { id: 'check', target: () => q('.pm-add-steps > li:nth-child(2)'), before: openAdd, title: 'Check what the app heard',
      body: 'Here the app lists what it measured (the fundamental in Hz, how steady it was, how many harmonics stood out) and what it will synthesize at your pose. Compare ▶ Original with ▶ Synthesized; redo the recording if you want.' },
    { id: 'pose', target: () => q('.pm-add-steps > li:nth-child(3)'), before: openAdd, title: 'Assign it to a pose',
      body: 'Press “Use my pose”, step back during the 3 s countdown (it beeps), and hold a comfortable pose for 1 s. The two angles you held become the sound’s position. Or press “Click the map instead” and click any spot. Either can be redone later.' },
    { id: 'play-it', target: () => q('.pm-add-steps > li:nth-child(4)'), before: openAdd, title: 'Play it with your arms',
      body: 'Once the sound has a pose, this step says which pose plays it, and ◆ marks on the angle bars show the target. Get into the pose and the marker lands on its dot; hold it and the sound holds; move back toward another dot and it blends toward that one.' },
    { id: 'draw', target: () => drawBtn, title: 'Draw + record a take',
      body: 'Press this, then press down on the map and draw a line or curve while you change your voice, for example “ah → ee → oo”. Let go to finish. Every 0.1 s a 0.2 s snippet is analyzed and placed where your cursor was at that moment (matched by timestamp, so drawing speed does not matter). Silent or unpitched snippets are skipped and counted.' },
    { id: 'undo', target: () => undoTakeBtn, title: 'Undo a take',
      body: 'Undo removes only the most recent take. Your recorded sounds and the starters stay where they are. Each take is also listed below with Hide and Delete.' },
    { id: 'perform', target: () => square, title: 'Move between your sounds',
      body: 'Your sounds and takes share one map with the starters. A take’s line starts at the filled ●: to play it, start at that pose and move along the line with your arms. Freeze and the sound freezes; go back and it follows you back.',
      tryIt: 'Start sound, then move from one of your poses to another.' },
    { id: 'adjust', target: () => adjustBtn, title: 'Optional: adjust to my movement',
      body: 'If the marker is too jumpy or you cannot reach part of the map, press this. After a 3 s countdown, move both arms comfortably for 6 s; the app sets the range to what you actually used and tells you how the response changed (for example “10° of elbow bend now moves the marker 12 % of the map”). Undo range change goes back.' },
    { id: 'tune', target: () => rangeCard, title: 'Fine-tune, and what happens to saved poses',
      body: '“Fine-tune the range” has one-click fixes per angle (“Small moves jump too far”, “I can’t reach the edges”) and sliders for each end. Your saved sounds are stored as poses, so after any range change the same pose still plays the same sound; their dots just move (faint circles show where they were). Starters stay at the corners.' },
    { id: 'list', target: () => listEl, title: 'Your sounds',
      body: 'Every sound with its pose. ▶ Original and ▶ Synthesized play it on its own; ✎ Edit / redo lets you rename it, record it again, or redo its position; 🗑 removes it. Untick “Starter sounds on the map” to play only your own sounds.' },
  ];
}

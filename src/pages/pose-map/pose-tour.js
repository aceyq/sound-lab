// Click-through tour for the Pose Sound Map (shared spotlight Tour from
// src/lib/tour.js). It follows the class demo: set up the camera, calibrate,
// try each movement on its own, read the displays, then put the movements
// together. It highlights real controls and never turns on the camera,
// records, plays or changes anything by itself.

export function poseTourSteps({ camBtn, overlay, guideBtn, calCard, angleCard, square, soundBtn, vowelBars, harmCanvas, f0Out, performCard, clapCard, customize }) {
  return [
    { id: 'camera', target: () => camBtn, title: 'Turn on the camera',
      body: 'Press Enable camera and allow it. The pose model loads the first time (about 6 MB). The video is analyzed on this computer and never uploaded.',
      tryIt: 'Press Enable camera.' },
    { id: 'frame', target: () => overlay, title: 'Get in frame',
      body: 'Your head, both shoulders and your whole right arm need to be visible. Blue marks your right shoulder, elbow and wrist (the elbow angle). Pink marks the ear-to-ear line against the shoulder line (the head angle). A red ✕ means that landmark is lost, and the sound fades until it comes back.',
      tryIt: 'Check there is no red ✕.' },
    { id: 'calibrate', target: () => guideBtn, title: 'Calibrate (guided)',
      body: 'Five quick poses: arm straight, elbow bent, head upright, head tilted for a LOW pitch, head tilted for a HIGH pitch. Each one counts down 3 seconds. Hold still from the first beep to the second beep (1 second).',
      tryIt: 'Press Calibrate and follow the big text on the camera preview.' },
    { id: 'calibrate-one', target: () => calCard, title: 'Fix one pose, or swap sides',
      body: 'If one reading looks wrong, redo just that pose with its own button. “Swap low/high side” flips which shoulder lowers the pitch.' },
    { id: 'sound', target: () => soundBtn, title: 'Start the sound',
      body: 'One synthesized voice starts, at the spot your pose points to. It keeps sounding while you hold a pose.',
      tryIt: 'Press Start sound.' },
    { id: 'elbow', target: () => angleCard, title: 'Movement 1: the elbow alone',
      body: 'Keep your head upright and slowly bend your right elbow. The elbow angle grows and the dot slides from the “ah” column toward “ee” and then “oo”. The head angle should stay near 0°.',
      tryIt: 'Bend and straighten the elbow while keeping your head still.' },
    { id: 'vowel-bars', target: () => vowelBars, title: 'Read the vowel mix',
      body: 'These bars show how much “ah”, “ee” and “oo” make up the sound right now (all pitch rows of a vowel grouped together; they add up to 100 %). Only the elbow moves these.' },
    { id: 'harmonics', target: () => harmCanvas, title: 'Read the harmonics',
      body: 'The harmonic strengths the synthesizer is actually using. As you bend the elbow, the bars reshape: that is the vowel changing. The fundamental in Hz stays the same while your head is still.' },
    { id: 'head', target: () => f0Out, title: 'Movement 2: the head alone',
      body: 'Now hold your elbow still and tilt your head toward one shoulder, then the other. The fundamental moves down and up in Hz while the vowel bars and harmonic bars stay put. Head upright is the middle pitch.',
      tryIt: 'Hold the elbow, tilt the head both ways.' },
    { id: 'map', target: () => square, title: 'Both at once',
      body: 'The two angles are the two coordinates: elbow = left↔right (vowel columns), head = down↕up (pitch rows). The lines show which dots contribute; thicker means more.' },
    { id: 'perform', target: () => performCard, title: 'The demo phrase',
      body: 'Start on “ah” with your head upright. Slowly bend toward “ee”. On the next count, tilt your head to the high side. Freeze for a count, then reverse: head back upright, arm back straight. The sound follows whatever pose you are holding, so the timing is yours.' },
    { id: 'customize', target: () => customize, title: 'Optional: your own voice',
      body: 'Under Customize sounds you can record a vowel or a hum like “mmm” (or pick one from Vowel Morph), compare the original with the synthesized version, then replace a column or add a new one. “Back to starter sounds” undoes it all.' },
    { id: 'clap', target: () => clapCard, title: 'Optional: clap on the final pose',
      body: 'Turn this on to clap once when you reach “ee, high”. It stays quiet while you hold the pose and is ready again after you leave the dashed ring and come back.' },
  ];
}

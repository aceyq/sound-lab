// Click-through tour for the Pose Sound Map (shared spotlight Tour from
// src/lib/tour.js). It highlights real controls one at a time and never
// turns on the camera, records, plays or changes anything by itself.

export function poseTourSteps({ camBtn, overlay, restBtn, fullBtn, angleCard, square, soundBtn, vowelSel, attachBtn, recBtn, listEl, performCard, clapCard }) {
  return [
    { id: 'camera', target: () => camBtn, title: 'Turn on the camera',
      body: 'Press Enable camera and allow it in the browser. The pose model (about 6 MB) loads the first time. The video is analyzed on this computer and never uploaded.',
      tryIt: 'Press Enable camera.' },
    { id: 'frame', target: () => overlay, title: 'Get your arms in frame',
      body: 'Step back until your shoulders, elbows, wrists and hips are all visible. Blue marks the right shoulder–elbow–wrist (elbow bend); pink marks the left hip–shoulder–elbow (arm lift). A red ✕ means that joint is lost, and the sound fades until it comes back.',
      tryIt: 'Check that all six joints have dots, no ✕.' },
    { id: 'cal-rest', target: () => restBtn, title: 'Calibrate: start pose',
      body: 'Press this, step back during the 3-second countdown, and hold your start pose (right arm straight, left arm down) for 1 second. That becomes the bottom-left corner of the map.' },
    { id: 'cal-full', target: () => fullBtn, title: 'Calibrate: full pose',
      body: 'Then capture your full pose: right elbow bent and left arm lifted as far as is comfortable. That becomes the top-right corner. Everything in between is spread across the map.' },
    { id: 'angles', target: () => angleCard, title: 'Your two angles',
      body: 'Right elbow bend moves the dot left ↔ right; left arm lift moves it down ↕ up. Each angle changes only its own direction on the map, and the bars show where you are inside your calibrated range.',
      tryIt: 'Bend only your right elbow, then lift only your left arm, and watch the dot.' },
    { id: 'starters', target: () => square, title: 'Try the starter poses',
      body: 'The starter set is already on the map: “ah” (arm straight, left arm down), “ee” (elbow bent, left arm down), “oo” (elbow bent, left arm up) and “eh” (arm straight, left arm up). Between them, the pitch and every harmonic blend by distance into one sound.' },
    { id: 'sound', target: () => soundBtn, title: 'Start the sound',
      body: 'Press Start sound. The sound keeps playing while you hold a pose and glides as you move. Stop sound fades it out.',
      tryIt: 'Press Start sound and move slowly between the starter poses.' },
    { id: 'pick', target: () => vowelSel, title: 'Assign a vowel to your own pose',
      body: 'Choose a vowel you recorded in Vowel Morph (listed first, if this browser has any) or a starter sound.' },
    { id: 'attach', target: () => attachBtn, title: 'Hold the pose and attach',
      body: 'Press Attach, get into your pose during the countdown and hold it for 1 second. The sound is pinned to that pair of angles and appears as a dot on the map.' },
    { id: 'record', target: () => recBtn, title: 'Or record a new vowel here',
      body: 'Type a name, press Record, get into your pose, then sing one steady vowel for 3 seconds while holding it. It is analyzed like in Vowel Morph and attached to the pose you held.' },
    { id: 'list', target: () => listEl, title: 'Your sounds',
      body: 'Every sound on the map with its pose angles. Remove any you do not want; “Restore starter set” brings the starters back.' },
    { id: 'perform', target: () => performCard, title: 'Perform the phrase',
      body: 'Start with “ah”, bend the right elbow slowly toward “ee”, lift the left arm on a sharp count toward “oo”, freeze an extra count, then go backward. The sound follows the pose you are holding, so the timing is up to you.' },
    { id: 'clap', target: () => clapCard, title: 'Optional: clap on the final pose',
      body: 'Turn this on to clap once when you enter the ring around the final pose. It stays quiet while you hold the pose and is ready again after you leave past the dashed ring. “Use my current pose” moves the ring to wherever you are.' },
  ];
}

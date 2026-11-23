// Click-through tour for Motion Morph (shared spotlight Tour from
// src/lib/tour.js). It highlights real controls one at a time with Back,
// Next and Done. It never turns on the camera, records, plays, places or
// clears anything by itself; the only thing it does is open the (empty)
// "Add a sound" panel so the recording steps have something to point at.

export function poseTourSteps({ square, camBtn, overlay, addBtn, drawBtn, undoTakeBtn, clearBtn, adjustBtn, rangeCard, axisPanel, soundCard, libraryCard, openAdd, q }) {
  const flowPart = (sel) => () => q(`.pm-add ${sel}`) || q('.pm-add');
  const axisRow = (axis) => () => axisPanel.querySelector(`.pm-ax-${axis}`) || axisPanel;
  return [
    { id: 'empty', target: () => square, title: 'An empty map to fill with your sounds',
      body: 'The map starts empty. Every sound on it comes from you. “Learning” here means: the app measures a recording’s pitch (f0) and the strengths of its first 48 harmonics, and stores those numbers at the spot you choose. Nothing is trained. Between your spots it mixes the numbers by distance and synthesizes one tone.' },
    { id: 'camera', target: () => camBtn, title: 'Turn on the camera',
      body: 'Press Enable camera and allow it in the browser. The pose model (about 6 MB) loads the first time. The video is analyzed on this computer and never uploaded. “Practice without camera” gives you two sliders instead.',
      tryIt: 'Press Enable camera.' },
    { id: 'preview', target: () => overlay, title: 'Blue = right arm, pink = left arm',
      body: 'The preview is mirrored like a mirror, so your RIGHT arm appears on the right of the picture. Right and left always mean your own body. Blue marks your right shoulder–elbow–wrist (right elbow bend, the horizontal axis). Pink marks your left hip–shoulder–elbow (left arm lift, the vertical axis). A red ✕ means that joint is lost.',
      tryIt: 'Step back until all six joints have dots and no ✕.' },
    { id: 'add', target: () => addBtn, title: 'Add a sound',
      body: 'This opens one guided process with four steps: Record → Listen → Place → Ready. The step strip at the top of the panel always shows where you are.' },
    { id: 'record', target: flowPart('.pm-rec'), before: openAdd, title: '1. Record',
      body: 'Name the sound and press Record: make one steady sound for 3 s near the laptop. Pitched sounds (a sung “ah”, “ee”, “oo”, a hum) are kept as a pitch plus harmonics. Unvoiced fricatives (a steady “sss”, “shh”, “fff”) are kept as a noise spectrum with no pitch. If neither fits (speech, a “zzz”, silence, room noise), the panel says why and the button becomes “Try again”. Nothing is saved until it works.',
      tryIt: 'Record a sung “ah”.' },
    { id: 'listen', target: flowPart('.pm-flow-steps'), before: openAdd, title: '2. Listen',
      body: 'After a good recording the panel moves to Listen. Compare ▶ Original recording with ▶ Synthesized version and read what was measured. Record again if you don’t like it; otherwise press “Sounds right → choose where it goes”.' },
    { id: 'place', target: flowPart('.pm-flow-steps'), before: openAdd, title: '3. Place: click a spot or use your pose',
      body: 'Two choices. “Click a spot on the map” turns on placement mode (yellow dashed border); click anywhere and the dot appears with its name. “Use my current pose” counts down 3 s, you hold a pose for 1 s, and a dashed ring shows where that pose lands; press “Put it here” or try again. Cancel placement (or Esc) always gets you out.' },
    { id: 'ready', target: flowPart('.pm-flow-steps'), before: openAdd, title: '4. Ready',
      body: 'The panel confirms the sound is on the map and says which pose reaches it. “Redo position” moves it again without re-recording.' },
    { id: 'second', target: () => square, title: 'Add a second sound',
      body: 'One sound alone just plays that sound everywhere. Put “ah” near the left edge (straighter right arm) and “ee” near the right edge (more bent right arm). The axes are arm movements; your sounds decide the pitch and harmonics you hear at each spot.',
      tryIt: 'Add “ah” on the left and “ee” on the right.' },
    { id: 'horizontal', target: axisRow('x'), title: 'Bend only your right elbow',
      body: 'Horizontal (x) = right elbow bend, measured from your right shoulder, elbow and wrist. A relaxed straight arm is the left edge, a right-angle bend (about 90°, forearm up or toward the camera) is near the right edge. Watch the blue degrees and x = 0.00…1.00 change while y stays the same: the marker moves only sideways. If the elbow or wrist is lost, the marker stops where it was and the sound fades; it never jumps somewhere random.',
      tryIt: 'Keep your left arm still and bend your right elbow: glide from “ah” to “ee”.' },
    { id: 'vertical', target: axisRow('y'), title: 'Lift only your left arm',
      body: 'Vertical (y) = left arm lift, the angle between your upper arm and your torso. Arm down is the bottom edge, arm raised is the top. Lifting only the left arm changes the pink degrees and y, and the marker moves only up or down. A sound placed higher up is reached by lifting your left arm.',
      tryIt: 'Keep your right elbow still and raise your left arm.' },
    { id: 'both', target: () => square, title: 'Both arms together',
      body: 'Change both angles at once and the marker moves diagonally. Hold a pose and the sound holds; move toward another dot and the sound blends toward it.',
      tryIt: 'Bend your right elbow and lift your left arm together.' },
    { id: 'hear', target: () => soundCard, title: 'What you hear',
      body: 'Press Start sound. You always hear ONE synthesized sound, never two recordings at once. The bars show each sound’s share in percent (they add up to 100 % and are the weights the synthesizer uses). The f0 and the harmonic graph come from your pitched sounds only; near a fricative a noise part is mixed in, shown in its own graph. Between two sounds, the numbers glide from one to the other as you move.' },
    { id: 'draw', target: () => drawBtn, title: 'Draw + record',
      body: 'Press this, then hold the mouse down on the map and draw a line while you sing a changing pitched sound, for example “ah → ee → oo”. Let go to finish. Every 0.1 s a 0.2 s snippet is analyzed and placed where the pointer was at that moment (matched by time, so drawing speed doesn’t matter). Each dot on the line is a synthesized sound reconstructed from your recording, not the recording itself.' },
    { id: 'take', target: () => undoTakeBtn, title: 'Preview, undo and play a take',
      body: 'In Drawn takes below, “▶ Preview along the line” moves the marker along the take and plays it. Undo last take removes only the newest take. To play it with your arms, start at the filled ● and follow the line.' },
    { id: 'range', target: () => adjustBtn, title: 'Optional: adjust to my movement',
      body: 'The default range is a relaxed arm to a right-angle bend for the right elbow, and arm down to well above shoulder height for the left arm. If the marker jumps too far or you can’t reach an edge, press Adjust. After a 3 s countdown, spend 6 s straightening and bending your RIGHT elbow (horizontal: straighter arm ↔ more bent arm) and lowering and raising your LEFT arm (vertical: arm down ↔ arm raised). “Fine-tune the range” has one-click fixes and sliders per axis. Placed sounds are stored as poses, so the same pose still plays the same sound after any change.' },
    { id: 'clear', target: () => clearBtn, title: 'Clear map, keep recordings',
      body: 'Clear map asks first, then takes every sound and take off the map. The recordings stay in “Your recordings” below, each with 📍 Place on map, so you can place them again. To get rid of a recording for good, use its 🗑 Delete recording button.' },
    { id: 'library', target: () => libraryCard, title: 'Your recordings',
      body: 'Every recording, placed or not, with ▶ Original, ▶ Synthesized, Place on map / Redo position, Remove from map and Delete recording. Drawn takes are listed underneath.' },
  ];
}

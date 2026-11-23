# Capstone: 2D vowel map, drawn takes and Pose Sound Map

Three parts, all in the Sound & Signals Lab site:

| Part | Where | What |
|---|---|---|
| 1 | **3. Vowel Morph → 2D sound space** (`#/vowel-morph`) | Existing map, checked and kept as it was |
| 2 | Same square, new **✏️ Draw + record a take** mode | Record while drawing; snippets become points along the curve |
| 3 | **4. Pose Sound Map** (`#/pose-map`), a separate page | Two joint angles from the laptop camera move a dot on the vowel map, with an optional clap |

## Part 1: the 2D vowel map (checked, not changed)

What the code does (`src/pages/vowel-morph/morph-model.js`, `idwWeights`, `blendParams`, `blendAt`):

1. Every placed vowel is one f0 (Hz) plus 48 harmonic strengths (strongest = 1, unmeasured = 0).
2. For a click at point P, each dot i gets a raw weight `1 / dᵢ^p`, where dᵢ is its straight-line distance to P in the square (side = 1) and p is the "Distance influence" setting (Standard p = 2, the default; Gentle 1, Local 4). The weights are divided by their sum so they add up to 100 %.
3. One f0 = Σ wᵢ · f0ᵢ (plain weighted average in Hz), and for every harmonic n: aₙ = Σ wᵢ · aᵢₙ.
4. That single f0 and set of 48 strengths drive one bank of sine oscillators. No recordings are mixed.

**At an anchor:** if P is exactly on a dot, that dot gets 100 % and every other dot 0 %, so you hear that vowel's own analyzed f0 and harmonics. In Play mode, clicking within about 26 px of a dot snaps the marker onto the dot, so a click "on" a dot is exact even if it is a few pixels off. Two dots stacked on the exact same spot share it 50/50.

**Several nearby points:** every placed dot always contributes (there is no cut-off radius). Nearer dots get much more weight because of the squared distance; with many dots close together, they share the weight between them. Learned points from drawn takes (part 2) count as dots too.

**Numerical example (Standard, p = 2):**

- Dot A "ah" at (0.2, 0.5): f0 = 200 Hz, harmonic 2 = 0.5.
- Dot B "ee" at (0.8, 0.5): f0 = 300 Hz, harmonic 2 = 1.0.
- Click at (0.4, 0.5): distances 0.2 and 0.4 → raw weights 1/0.04 = 25 and 1/0.16 = 6.25 → normalized 25/31.25 = **80 %** and **20 %**.
- f0 = 0.8 × 200 + 0.2 × 300 = **220 Hz**; harmonic 2 = 0.8 × 0.5 + 0.2 × 1.0 = **0.6**.
- Add dot C at (0.4, 0.9), f0 = 250 Hz: its distance is 0.4 → raw 6.25. Weights become 25 : 6.25 : 6.25 = 66.7 % / 16.7 % / 16.7 %, so f0 = 133.3 + 50 + 41.7 = **225 Hz**.
- Click exactly on B → B = 100 % → 300 Hz and B's own harmonics.

The map only accepts sounds that have a usable pitch: a vowel whose analysis finds no clear f0 is marked "not usable" and cannot be placed. Fricatives stay in the Frequency Playground noise workflow.

## Part 2: draw while recording

1. Open the 2D sound space and choose **✏️ Draw + record a take**. That click opens the microphone, so pressing down can start capturing at once.
2. Press down in the square and sing while you draw. Releasing ends the take (maximum 12 s).
3. The take is cut into **0.2 s snippets, one every 0.1 s**. The pitch estimator (YIN, searching 50–1000 Hz) needs 40 ms per frame, and harmonic frames span 8 periods (80 ms at 100 Hz), so 0.2 s gives it several frames to take a median over while still following a vowel that changes over a second or two.
4. **Timestamp alignment:** every pointer event keeps its `timeStamp`. Every audio chunk's arrival time is logged with the number of samples so far. Sample 0's time is the earliest `arrival − count / sampleRate` over all chunks (delivery can only be late, so the least-delayed chunk is the best estimate). Each snippet's centre time is then looked up on the pointer path. Audio from halfway through the take lands where the pointer was halfway through the take in time, however fast you drew.
5. Each snippet goes through the **same analysis as a single vowel** (`analyzeVowel`). Silent snippets, snippets without a reliable pitch, and snippets from before or after the drawing are skipped. The page reports, for example, "Take 1: 24 usable points from 24 snippets (skipped 0 silent, 0 without a reliable pitch)".
6. The square shows the drawn path and the learned points in the take's colour. In **Play / explore**, click near or between points to hear the normal blend, drag along the curve, or press **▶ Replay along path** to move the marker along the take at its original speed.
7. **↶ Undo last take** removes only the most recent take and its recording. Placed vowels and older takes stay. Each take can also be hidden or deleted.

## Part 3: Pose Sound Map (camera)

The first version of part 3 used phone tilt (the "Tilt Sound Map"). It felt too close to Motion Score, so on November 17, 2026 (UTC) it was replaced by this camera version. The old `#/tilt-map` link now opens the Pose Sound Map.

- **Tracking:** the laptop camera is analyzed in the browser by MediaPipe Pose Landmarker (lite model, Apache 2.0). The WebAssembly runtime and the 5.8 MB model are served by this site (`public/models/`, plus `public/mediapipe/wasm/` copied from `node_modules` at build time), so no CDN is needed. Video never leaves the computer.
- **Two joint angles, not x/y positions:**
  - *Right elbow bend* = 180° − the angle at the right elbow between the right shoulder and the right wrist (0° = straight arm). It moves the dot left ↔ right.
  - *Left arm lift* = the angle at the left shoulder between the left hip and the left elbow (about 15° hanging, 90° out to the side). It moves the dot down ↕ up.
  - The angles use MediaPipe's 3D "world" landmarks, so bending toward the camera still counts. They are lightly smoothed (80 ms).
- **Calibrate:** "① Capture start pose" (right arm straight, left arm down) and "② Capture full pose" (elbow bent, arm lifted, both as far as is comfortable). Each counts down 3 s and then takes the median of 1 s of readings. The start pose becomes the bottom-left corner and the full pose the top-right.
- **Lost joints:** if any of the six joints (right shoulder, elbow, wrist; left hip, shoulder, elbow) falls below 50 % visibility for 0.25 s, or no camera frame arrives for 0.5 s, the page names the lost joint, marks it with a red ✕ in the preview, and fades the sound out (0.15 s time constant). The sound fades back in when tracking returns.
- **Sounds:** the starter set follows the class phrase: "ah" (arm straight, left arm down), "ee" (elbow bent, left arm down), "oo" (elbow bent, left arm lifted) and "eh" (arm straight, left arm lifted). **📌 Attach to my pose** pins a Vowel Morph vowel (listed first when this browser has some) or a starter to the angles you hold for 1 s after a countdown. **● Record a vowel at my pose** records 3 s while you hold a pose and analyzes it with the Vowel Morph analysis. Taught poses are stored as angles, so they stay with the pose if you recalibrate.
- **Blend:** the same `blendAt` inverse-distance rule as part 1 and the same synthesizer. There is no timeline: the sound always follows the pose you are holding, so holding still sustains it, and you can pause or go backward whenever you like.
- **Clap (toggle):** a ring around the final "oo" pose (radius 0.16). It claps once on entering, stays quiet while you hold, and re-arms only after you leave past the dashed ring (0.06 further). "Use my current pose as the clap region" moves it.
- **Tour:** 13 steps covering the camera, framing, both calibration poses, the angles, starter poses, starting the sound, picking and attaching a vowel, recording here, your sounds, the phrase and the clap. It has Back, Next and Done (plus Close), and can be reopened any time.
- **Practice without camera:** two sliders stand in for the angles.

## What was checked, and how

All checks below used **simulated input**. None of them used your voice, your microphone or a real person in front of your camera.

- `npm test`: 174 unit tests pass (17 in `test/capstone-parts.test.js`).
- `npm run build`: passes.
- `scripts/verify-drawn-take.mjs`: 20/20 checks. getUserMedia was replaced by a synthetic harmonic "voice", and the mouse was driven by Playwright. It checks part 1 clicks (on a dot = exact, midpoint = 50/50 blend of f0 and harmonics, one continuous voice while dragging). It checks a curved take drawn slowly through 1.6 s of a 150 Hz "ah" recipe, then fast through 0.9 s of a 300 Hz "ee" recipe. Every point on the slow part was 150 Hz and every point on the fast part 300 Hz, and 58 % of points sat on the slow first quarter of the path, which shows alignment by time rather than even spacing. It also checks replay, undo removing only the latest take, a silent take, and reload.
- `scripts/verify-pose-map.mjs`: 38/38 checks. Generated stick-figure landmarks are fed through the page's own pose handler. It checks each angle moving only its own axis, the two angles together setting the blend, and a held pose sustaining a steady sound for 2 s. It checks that a lost right wrist is named and fades the sound, and that sound returns with the joint. It checks the countdown calibration, the class phrase (ah → ee → oo → freeze → back to ee → ah, exactly matching each starter), attaching a Vowel Morph vowel, recording here with a synthetic 233 Hz mic, one clap per entry with no retrigger on the edge, and the full tour (Back, Next, Done, Close, reopen). It also starts the **real MediaPipe model on Chromium's fake camera** (a test pattern with no person) to confirm it loads from the site and tracks nothing. Last, it confirms Vowel Morph, Motion Score and Frequency Playground still open.
- `scripts/verify-motion.mjs`: 67/67 (Motion Score unchanged).
- `scripts/verify-vowel-morph.mjs` (older): stops at its fake-microphone recording step **with and without these changes** (checked on the previous commit too), so that is a pre-existing problem with Chromium's file-based fake microphone on this Mac, not a regression. The new drawn-take script covers the 2D clicks instead.

Not covered: listening, real singing into a real microphone, a real person in front of a real camera (tracking accuracy, lighting, clothing, distance), latency, or comfort.

## Update (November 23, 2026): Motion Morph

The camera page is now called **Motion Morph** (same `#/pose-map` link; `#/motion-morph` also works). The two-pose calibration was replaced by a default range plus an optional "Adjust to my movement" step (5th–95th percentile of 6 s of free movement, an angle that moved less than 15° keeps its range) and fine-tune buttons/sliders. "Add my sound" (record 3 s → analysis report, ▶ Original / ▶ Synthesized → pose by countdown or by clicking the map → how to play it) and "Draw + record" takes (Vowel Morph's take-model.js, stored as angles) were added. Everything a person places is stored as the two angles of its pose, so recalibrating moves dots on the map but keeps each sound on its pose; starters stay at the range corners. `scripts/verify-pose-map.mjs` was rewritten for the new workflow (69 checks); see AI_USE.md for the prompt and test summary.

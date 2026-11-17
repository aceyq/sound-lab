# Capstone: 2D vowel map, drawn takes and Pose Sound Map

Three parts, all in the Sound & Signals Lab site:

| Part | Where | What |
|---|---|---|
| 1 | **3. Vowel Morph → 2D sound space** (`#/vowel-morph`) | Existing map, checked and kept as it was |
| 2 | Same square, new **✏️ Draw + record a take** mode | Record while drawing; snippets become points along the curve |
| 3 | **4. Pose Sound Map** (`#/pose-map`), a separate page | Laptop camera: right elbow bend picks the vowel, head tilt picks the pitch, with an optional clap |

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

History: the first version of part 3 used phone tilt and felt too close to Motion Score, so it became a camera version (November 17, 2026 UTC). That version used right elbow bend and left arm lift. After trying it, it was changed the same day to **elbow = vowel, head = pitch**, which is easier to understand and to perform. The old `#/tilt-map` link opens this page.

- **Tracking:** MediaPipe Pose Landmarker (lite, Apache 2.0) runs in the browser. The model (`public/models/`) and the WebAssembly runtime (copied from `node_modules` at build time) are served by this site. Video never leaves the computer.
- **Two joint angles, not x/y positions:**
  - *Right elbow bend* = 180° − the angle at the right elbow between the right shoulder and the right wrist (0° = straight). It moves the dot left → right, from the "ah" column through "ee" to "oo".
  - *Head tilt* = the signed angle between the ear-to-ear line and the shoulder-to-shoulder line (+ = toward your left shoulder). Because it is measured against the shoulders, sliding or leaning the whole body does not count as a head tilt. It moves the dot down ↕ up through the low, middle and high pitch rows, with head upright as the middle row.
- **Starter map:** a 3 × 3 grid. The columns are "ah", "ee" and "oo", each with one harmonic recipe (textbook formants) used unchanged in every row. The rows are Low 164.8 Hz, Middle 220 Hz and High 293.7 Hz (A3 and a fourth either side), with the same pitch across each row.
- **Weights between the dots (what makes the controls predictable):** the weight of the dot in column c and row r is u_c(x) · v_r(y), where u and v are plain linear interpolation between neighbouring column or row centres (clamped beyond the outer dots). The weights add up to 100 %, and a pose exactly on a dot gives that dot 100 %. Because the rows share one pitch and the columns share one harmonic recipe, the blended f0 = Σ v_r · f0_r depends **only on the head**, and each blended harmonic = Σ u_c · a_c,n depends **only on the elbow**, including between dots. The f0 in Hz and the harmonics are still plain weighted averages, computed by Vowel Morph's `blendParams` and played by its synthesizer. Vowel Morph's free-form inverse-distance weights would let the pitch drift slightly while you bend your elbow, which is why the grid uses this rule instead.
- **Calibrate:** "🎯 Calibrate (guided, 5 poses)" walks through arm straight, elbow bent, head upright, tilt for LOW pitch and tilt for HIGH pitch. Each pose has a 3 s countdown in big text on the preview, then a beep, a 1 s hold (the median reading is used), and a second beep. Each pose also has its own button, and "⇅ Swap low/high side" flips which shoulder lowers the pitch.
- **What you hear, on screen:** the fundamental in Hz (from the synth's own parameters), how much of each pitch row is in the blend, colored **vowel-mix bars grouped by vowel** (each column's share summed over its pitch rows), and a live **graph of the 48 harmonic strengths the synth is using**.
- **Lost landmarks:** if the right shoulder, elbow or wrist, or either ear or shoulder, drops below 50 % visibility for 0.25 s (or no frame arrives for 0.5 s), the page names it, marks it with a red ✕ and fades the sound. It fades back in when tracking returns.
- **🎙 Customize sounds (optional, collapsed):** record a sound here (for example a closed-mouth "mmm") or pick a vowel from Vowel Morph. You can hear "▶ Original" and "▶ Synthesized" first, then "Use for this column" (replace ah/ee/oo) or "+ Add as a new column" (up to 6). Only the harmonic balance is used on the map, so each row keeps its matched pitch. "↺ Back to starter sounds" undoes it all.
- **Clap (optional):** a ring at the top of the "ee" column ("ee, high", the end of the demo phrase). It claps once on entering, stays quiet while you hold, and re-arms after you leave past the dashed ring.
- **Tour (Back / Next / Done):** 13 steps that follow the demo: turn on the camera, get in frame, guided calibration, fixing one pose, start the sound, the elbow alone, reading the vowel mix, reading the harmonics, the head alone, both at once, the demo phrase, customizing (optional) and the clap (optional).
- **Practice without camera:** two sliders stand in for the angles.

## What was checked, and how

All checks below used **simulated input**. None of them used your voice, your microphone or a real person in front of your camera.

- `npm test`: 175 unit tests pass (18 in `test/capstone-parts.test.js`, including both angles, whole-body shifts, calibration and the grid's separation of vowel and pitch).
- `npm run build`: passes.
- `scripts/verify-drawn-take.mjs`: 20/20 checks. getUserMedia was replaced by a synthetic harmonic "voice", and the mouse was driven by Playwright. It checks part 1 clicks (on a dot = exact, midpoint = 50/50 blend of f0 and harmonics, one continuous voice while dragging). It checks a curved take drawn slowly through 1.6 s of a 150 Hz "ah" recipe, then fast through 0.9 s of a 300 Hz "ee" recipe. Every point on the slow part was 150 Hz and every point on the fast part 300 Hz, and 58 % of points sat on the slow first quarter of the path, which shows alignment by time rather than even spacing. It also checks replay, undo removing only the latest take, a silent take, and reload.
- `scripts/verify-pose-map.mjs`: 42/42 checks with generated stick-figure landmarks fed through the page's pose handler. **Elbow alone** (head still): f0 stayed at 220.00 Hz at all seven elbow angles while the vowel mix went 100/0/0 → 0/100/0 → 0/0/100 and the harmonics changed. **Head alone** (elbow still): f0 rose 164.8 → 220 → 293.7 Hz while the vowel mix stayed 75/25/0 and the harmonics stayed the same. Sliding or leaning the whole body read 0.00° of head tilt. **Both together**: the demo phrase went ah 220 → ee 220 → ee 293.7 → freeze → ee 220 → ah 220 Hz. **Displays match the synth**: the shown Hz, the harmonic graph (to 10⁻⁶) and the vowel bars and percentages equal the synthesizer's own f0, strengths and blend weights, and its oscillators sit at n × f0. It also checks a held pose sustaining for 2 s, a lost left ear fading the sound, guided calibration reading all five poses (10 beeps), recording a hum with a synthetic 233 Hz mic (original and synthesized previews, then adding a column, replacing a column with a Vowel Morph vowel, and back to starters), the clap firing once per entry, the full tour, the **real MediaPipe model on Chromium's fake camera** (no person, nothing tracked), and that Vowel Morph, Motion Score and Frequency Playground still open.
- `scripts/verify-motion.mjs`: 67/67 (Motion Score unchanged).
- `scripts/verify-vowel-morph.mjs` (older): stops at its fake-microphone recording step **with and without these changes** (checked on the previous commit too), so that is a pre-existing problem with Chromium's file-based fake microphone on this Mac, not a regression. The new drawn-take script covers the 2D clicks instead.

Not covered: listening, real singing into a real microphone, a real person in front of a real camera (tracking accuracy, lighting, clothing, distance), latency, or comfort.

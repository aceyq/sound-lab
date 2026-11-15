# Capstone: 2D vowel map, drawn takes and Tilt Sound Map

Three parts, all in the Sound & Signals Lab site:

| Part | Where | What |
|---|---|---|
| 1 | **3. Vowel Morph → 2D sound space** (`#/vowel-morph`) | Existing map, checked and kept as it was |
| 2 | Same square, new **✏️ Draw + record a take** mode | Record while drawing; snippets become points along the curve |
| 3 | **4. Tilt Sound Map** (`#/tilt-map`), a separate page | Phone pitch and roll angles move a dot on a sound map, with an optional drum layer |

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

## Part 3: Tilt Sound Map

- **Pairing:** the same PeerJS pairing and phone page as Motion Score (unchanged). Scan the QR code and tap Enable Sensors on the phone. The phone screen still uses Motion Score's wording ("pitch", "richness"); the laptop page shows the real angles.
- **Angles:** forward/back tilt (pitch, + = top toward you) moves the dot up and down. Sideways tilt (roll, + = right edge down) moves it left and right. Both are measured from your neutral pose with Motion Score's `relativeGestures`.
- **Calibrate:** "◎ Set neutral" averages 1 s of readings. "↔ Measure my range" watches you tilt for 5 s and sets each range to the 90th percentile of the angles it saw. The range sliders (±8–80°) and flip checkboxes can be changed by hand. ±range reaches the edge of the map.
- **Sounds:** four starter vowels ("ah" 165 Hz left, "ee" 247 Hz right, "oo" 131 Hz bottom, "eh" 196 Hz top) built from textbook formants. **● Record at current pose** records 2–4 s, analyzes it with the Vowel Morph analysis and pins it where the dot was. **Copy dots from my Vowel Morph map** brings in your placed vowels.
- **Blend:** the same `blendAt` inverse-distance rule as part 1, played by the same synthesizer.
- **Tracking drop:** if no phone reading arrives for 400 ms, or the phone page is hidden, the sound fades out (about 0.12 s time constant). It fades back in when readings return.
- **Percussion (toggle):** Kick bottom-left, Snare top-left, Clap top-right (radius 0.12). Entering a region plays its drum once. The region re-arms only after the dot moves 0.05 past its edge (the dashed ring), so a shaky wrist on the boundary does not retrigger. The last drum is shown next to the toggle, and the phone flashes on each hit.
- **Laptop simulation:** two sliders stand in for the angles if the network blocks pairing.

## What was checked, and how

All checks below used **simulated input**. None of them used your voice, your microphone or your phone.

- `npm test`: 172 unit tests pass (15 new in `test/capstone-parts.test.js`).
- `npm run build`: passes.
- `scripts/verify-drawn-take.mjs`: 20/20 checks. getUserMedia was replaced by a synthetic harmonic "voice", and the mouse was driven by Playwright. It checks part 1 clicks (on a dot = exact, midpoint = 50/50 blend of f0 and harmonics, one continuous voice while dragging). It checks a curved take drawn slowly through 1.6 s of a 150 Hz "ah" recipe, then fast through 0.9 s of a 300 Hz "ee" recipe. Every point on the slow part was 150 Hz and every point on the fast part 300 Hz, and 58 % of points sat on the slow first quarter of the path, which shows alignment by time rather than even spacing. It also checks replay, undo removing only the latest take, a silent take, and reload.
- `scripts/verify-tilt-map.mjs`: 26/26 checks. It checks each angle alone moving one axis, the blend changing with either angle and with both, recording at a pose, and neutral calibration. It checks the fade on a tracking drop and on a hidden phone page, and the fade back in. It checks one kick while holding still in the region for 2 s, no retrigger during a ±1.5° wobble across the edge, re-hits after leaving, snare and clap, and percussion off. It also runs a **real PeerJS pairing** with the unchanged phone page in a second browser tab, sending synthetic orientation samples.
- `scripts/verify-vowel-morph.mjs` (older): stops at its fake-microphone recording step **with and without these changes** (checked on the previous commit too), so that is a pre-existing problem with Chromium's file-based fake microphone on this Mac, not a regression. The new drawn-take script covers the 2D clicks instead.

Not covered: listening, real singing into a real microphone, a real phone's sensors, latency or comfort.

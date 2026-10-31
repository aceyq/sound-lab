# Vowel Morph: capstone tasks 3 and 4

Vowel Morph is a third app in the Sound & Signals Lab, next to Frequency Playground and Motion Score. It has its own route (`#/vowel-morph`) and its own **3. Vowel Morph** button in the top navigation bar. It is published on GitHub Pages at https://aceyq.github.io/sound-lab/#/vowel-morph.

## 1. What was completed

**Task 3 (1D slider): done and tested with simulated vowels.**
- There are two clearly labelled areas, Vowel A and Vowel B. Each can record (up to 4 s), import a WAV, play the original, play the synthesized version and adjust the analysis: choose the steady section and correct the f0 by hand.
- The slider is labelled A on the left and B on the right, with Play blend and Stop controls. The page shows the position and weights, the current fundamental (Hz, note name, semitones from A) and a harmonic bar chart with A's and B's strengths marked.
- While the sound plays, dragging moves one running bank of 48 sine oscillators. It never restarts. Each endpoint gives that vowel's analyzed numbers exactly.
- A Pitch option, "Keep A's pitch" or "Keep B's pitch", lets you hear only the change in vowel colour. The default, "Blend pitch A → B", is the only mode in which both endpoints are exact.

**Task 4 (2D sound space): done and tested with simulated vowels.**
- The square has separate modes, ✋ Edit / place dots and 🔊 Play / explore, so you cannot move a dot by accident while playing.
- In Edit mode you place, drag, select, rename and remove dots, or type exact x/y positions. Any number of vowels can be placed. Each dot has a colour that matches the vowel list, which shows each vowel's f0, position and whether it is slider A or B.
- In Play mode, clicking sets the marker and dragging changes the sound smoothly. Lines from the marker to every dot get thicker with weight. A weights table, the fundamental and the harmonic bars are shown.
- When you tap a dot, you choose what plays: its SYNTHESIZED sound (the marker snaps onto the dot, so you hear its exact values) or its ORIGINAL recording (a one-off preview). A drag never switches to a recording.
- The distance influence can be Gentle (power 1), Standard (power 2, the default) or Local (power 4).
- With 0 usable dots you get a message and Play is disabled. With 1 dot that vowel plays everywhere, with a message saying so.

**Shared**
- Saving happens automatically in this browser, separate from the other apps.
- "Download backup" makes one JSON file with the recordings, analyses, slider pair, dot positions and names. "Import backup" adds that content and never replaces anything.
- You can download each original WAV, each synthesized WAV, the blend at the slider position and the sound at the marker.
- There is a 13-step guided tour that highlights the real controls, with Next, Back and Close.

## 2. Launching it

```bash
cd ~/Desktop/frequency-playground
npm run dev
```

Open http://localhost:5173/#/vowel-morph, or open http://localhost:5173 and click **3. Vowel Morph**. Use Chrome, Edge or Safari, and allow the microphone when asked. Headphones help, because otherwise the mic can pick up the speakers.

## 3. Recording Aa and Oo and testing the slider

1. Click **↔ 1D slider (task 3)** if it is not already selected.
2. In **Vowel A**, the Name box already says `Aa`. Click **● Record (up to 4 s)** and sing a steady "aa" (as in *father*) for about 3 seconds. Click **■ Stop recording**, or let it stop at 4 s.
3. Read the summary under it, for example "f0 196.4 Hz … automatic … 18 harmonics measured … 48/48 frames steady". Red text means the take is not usable, and it says why.
4. Click **▶ Original**, then **▶ Synthesized**, and compare.
5. If needed, open **Adjust analysis**. You can drag across the waveform to pick a steadier section, or type the right f0 if it is an octave off and click **Re-measure at this f0** (it is then labelled MANUAL).
6. In **Vowel B**, the Name box says `Oo`. Record an "oo" (as in *food*) the same way.
7. In the slider card, click **▶ Play blend**. Drag the slider slowly from A to B and back.
8. Watch "Fundamental now", the semitone line and the bars. Click **■ Stop**.
9. Optionally record both vowels again at the same pitch. You can also set **Pitch → Keep A's pitch** to hear only the vowel colour change.
10. If one take is bad, record again: the earlier take stays in the "Use" list.

## 4. Placing Aa, Oo and a third vowel in the square

1. Click **◻ 2D sound space (task 4)**. Aa and Oo already appear under "Vowels in this project".
2. Click **Place in square** next to Aa (this switches to Edit mode), then click near the bottom-left of the square. Do the same for Oo near the bottom-right.
3. Under "Record or import a new vowel", type `Ee`, click **● Record**, and sing "ee" (as in *see*). When it finishes, the app is waiting for you to place it, so click near the top-middle.
4. Drag dots to adjust them while still in Edit mode.
5. Click **🔊 Play / explore**, then click or drag around the square. Tap a dot to hear its exact synthesized values.
6. Under "Tapping a dot plays:", choose **its ORIGINAL recording** and tap a dot to hear the real recording.
7. For the video, select Synthesized again and drag slowly between the three dots while the weights and bars are visible.

## 5. A short explanation for your professor

> "Each vowel I record is analyzed into two things: its fundamental frequency and the relative strengths of its first 48 harmonics. The slider, and in 2D the position in the square, decides how much each recorded vowel counts. The app blends the numbers, not the audio: pitch is averaged on a semitone scale and each harmonic's strength is averaged in decibels. Then it builds a brand-new sound from 48 sine waves at those blended values. That's why the middle of the slider is one voice at an in-between pitch rather than two recordings playing at once. In the square, nearer vowels count more (inverse-distance weighting), and clicking exactly on a dot gives that vowel's analyzed values. The synthesized vowels are approximations, so I can also play each original recording for comparison."

## 6. The interpolation rules in plain language

Every vowel is stored the same way: **f0** plus **48 harmonic strengths** (harmonic *n* at *n × f0*). The strongest harmonic is 1. A harmonic that was not measured, or that was above the recording's Nyquist frequency, is exactly 0.

**Weights.** The slider at position *t* gives A the weight 1 − *t* and B the weight *t*. The square gives each placed vowel the weight 1/distance² and then scales the weights so they add up to 1 (Shepard's inverse-distance weighting).

**Pitch: weighted average in semitones** (a weighted geometric mean of the frequencies):
f0 = f0_A^(1−t) · f0_B^t. Equal slider steps are equal musical steps.

**Harmonic strengths: weighted average in decibels**, harmonic by harmonic (a weighted geometric mean). A missing harmonic counts as −60 dB, the floor. If the blended value ends up at the floor, it plays as silence.

**One full weight means exact values.** When one vowel's weight is 1 (a slider end, or exactly on a dot), the result is that vowel's numbers, unchanged.

**Numerical example (slider at the middle, t = 0.5):**
- A: f0 = 200 Hz, harmonic 3 = 0.25 (−12 dB). B: f0 = 300 Hz, harmonic 3 = 1 (0 dB).
- Pitch: √(200 × 300) = **244.9 Hz**. That is 3.51 semitones above A and 3.51 below B. (The plain average, 250 Hz, would be closer to B in musical terms.)
- Harmonic 3: (−12 dB + 0 dB) / 2 = −6 dB = **0.5**.
- A harmonic present only in A at 0.05 (−26 dB) becomes (−26 + −60)/2 = −43 dB ≈ 0.007. It is faint but fades out continuously.

**What the midpoint means.** It is one harmonic sound at the pitch halfway between A and B in semitones. Each of its harmonics has a strength halfway between A's and B's in decibels. The harmonics are matched by **harmonic number**, not by frequency. When A and B have different pitches, harmonic 3 of A (600 Hz) is blended with harmonic 3 of B (900 Hz). So resonances (formants) do not slide smoothly from one frequency to another. The spectrum changes shape harmonic by harmonic. This is the simple, consistent representation the class notes describe, and it is the main known limitation (see section 7).

**2D example.** Aa sits at x = 0 and Oo at x = 1, on the same height. The marker is a quarter of the way across, so the distances are 0.25 and 0.75. The weights are 1/0.25² : 1/0.75² = 16 : 1.78, which is **90 % Aa and 10 % Oo**. Halfway across, it is 50 % / 50 %, the same as the slider's midpoint (the tests check this).

**Why inverse-distance weighting.** It works for any number and arrangement of dots. The weights are positive, add up to 1 and change continuously as you move. It gives a dot's exact values on the dot. Outside the area between the dots it simply levels off toward an even blend, with nothing extrapolated and no wild values. Other methods exist, such as triangle (barycentric) interpolation over a Delaunay triangulation, or natural-neighbour interpolation (Sibson 1981). They behave more locally but are undefined outside the dots and harder to explain, so I chose IDW for the demonstration. The power control shows how much distance matters: power 1 gives broad blends, while power 4 lets the nearest dot dominate until about midway.

**Safety cases.** Two dots on exactly the same spot share it equally. Dots that are nearly on top of each other work, but the blend changes quickly between them, and the page warns about it. All weights are computed as (nearest distance / distance)^power, so tiny distances cannot overflow.

**Loudness rule.** Every synthesized sound is scaled to the same RMS level, 0.1 (−20 dBFS), before the volume control, so moving between vowels causes no loudness jumps. With at most 48 sines its peak can never exceed √96 × 0.1 ≈ 0.98, so it cannot clip. Originals are played at the same RMS (measured over the analyzed section), with their peak limited to 0.9.

**Nyquist.** Components fade out linearly between 90 % and 98 % of the playback Nyquist frequency (half the sample rate), so a high pitch never causes a harmonic to switch off abruptly. The analysis itself only measures harmonics below the recording's own Nyquist frequency.

**Smoothness.** All 48 oscillators keep running while you move. Their frequencies and gains glide to new targets with a 15 ms time constant. An oscillator keeps its phase continuous when its frequency changes, and all 48 glide on the same curve, so they stay exact multiples of one f0. Start and stop use 30–40 ms fades. Only one sound plays at a time.

## 7. Limitations, test results and what still needs listening

**Automated results (simulated signals, not listening):**
- `npm test`: **144/144 pass** (26 new Vowel Morph tests and the existing 118). The new tests check:
  - recovery of a known f0 and harmonic strengths from synthetic tones (within 1 dB)
  - Nyquist handling at 16 kHz, plus failure messages for silence and noise
  - manual f0 correction
  - exact values at both slider ends
  - the expected midpoint values, plus 1001 slider steps that are all finite and smooth
  - weights summing to 1 for 0, 1, 2 and 7 dots
  - exact values on a dot
  - continuity near and outside the dots, and coincident or nearly coincident dots
  - equal RMS and no clipping
  - Nyquist fading
  - a rendered/exported blend that analyzes back to the blended f0 and strengths
  - a backup round trip that is sample-exact
- `scripts/verify-vowel-morph.mjs` (browser, Playwright): **52/52 pass**. The vowels are generated, voice-like WAVs at 200, 250 and 300 Hz. One take is "recorded" through Chromium's fake microphone, which plays a 220 Hz vowel, and it analyzed to 219.96 Hz. The script checks:
  - endpoints exact in the running app, and the midpoint pitch √(fA·fB)
  - one voice for the whole drag, with no restarts
  - original vs synthesized playback
  - downloads of the blend and the marker sound, analyzed back
  - Edit and Play modes, dot dragging, dot snapping and original-on-tap
  - reloading, then a backup restored into a fresh browser profile
  - importing twice, which adds copies
  - delete confirmation, the tour, and phone size with a touch tap
- **Existing apps were re-run unchanged:** Frequency Playground 36/36, Motion Score 67/67, mic 45/45, Vowel Lab 49/49, automatic vowel 26/26, tutorial 24/24, vowel filtering 57/57 and 31/31. The production build (`npm run build`) succeeds.
- **Files touched outside the new folder:** only `index.html` (the nav button) and `src/main.js` (the route). Motion Score in `~/Desktop/harmonic-explorer` was not modified.

**Not yet verified, so you need to listen:**
- I have **not** heard your recorded vowels morph. Whether the middle of Aa→Oo sounds like a believable in-between vowel is still a listening test.
- Whether the synthesized endpoints sound recognizably like your vowels also needs listening (it depends on the analysis of your takes).
- Clicks: the engine is designed to avoid them, but this was checked through its state, not by ear on your speakers.

**Known limitations:**
- Because harmonics are matched by number, when A and B have quite different pitches the formants do not move smoothly. Partway through, the spectrum can briefly sound "between" in a less natural way. Recording both vowels at a similar pitch gives the cleanest vowel morph. A formant/spectral-envelope approach would fix this but is more complex, and it is not what the class notes describe.
- The synthesized sound is one constant f0 with constant harmonic strengths. It has no vibrato, breath noise, onset or natural wobble, so it is an approximation and is not sample-identical to the original.
- The analysis keeps harmonics stronger than −50 dB (relative to the strongest) that stand out from noise in at least half of the frames. Very breathy or quiet takes may lose upper harmonics.
- Browser storage can be cleared by the browser. Download a backup before important sessions. Backups store float samples in base64, so they are about 1.3 MB per 4-second take at 48 kHz.

## 8. Files

- `src/pages/vowel-morph/morph-model.js`: blending, weights, loudness, Nyquist fade, project and backup (pure, tested)
- `src/pages/vowel-morph/morph-analysis.js`: wraps the Vowel Lab's automatic analysis (`auto-vowel.js`, unchanged)
- `src/pages/vowel-morph/morph-audio.js`: Web Audio playback (oscillator bank and originals)
- `src/pages/vowel-morph/morph-store.js`: separate storage (localStorage `vowelMorph.project.v1`, IndexedDB `vowel-morph`)
- `src/pages/vowel-morph/index.js`, `morph-plots.js`, `morph-tour.js` and `vowel-morph.css`: the page
- Reused unchanged: `frequency/recorder.js`, `frequency/mic.js`, `frequency/wav.js`, `frequency/auto-vowel.js`, `frequency/vowel-model.js` and `lib/tour.js`
- `test/vowel-morph.test.js` and `scripts/verify-vowel-morph.mjs`: the tests. Screenshots are in `verification/vowel-morph-*.png`.

## Primary sources

- de Cheveigné, A., & Kawahara, H. (2002). YIN, a fundamental frequency estimator for speech and music. *JASA* 111(4), 1917–1930. (f0 estimation, reused from the Vowel Lab.)
- Harris, F. J. (1978). On the use of windows for harmonic analysis with the discrete Fourier transform. *Proc. IEEE* 66(1), 51–83. (Hann-windowed harmonic measurement.)
- Shepard, D. (1968). A two-dimensional interpolation function for irregularly-spaced data. *Proc. 23rd ACM National Conference*, 517–524. (Inverse-distance weighting.)
- Sibson, R. (1981). A brief description of natural neighbour interpolation. In V. Barnett (Ed.), *Interpreting Multivariate Data*, 21–36. (An alternative 2D method.)
- Fant, G. (1960). *Acoustic Theory of Speech Production*. Mouton. (Source–filter view of vowels: why harmonic strengths follow the vocal-tract resonances, and why matching by harmonic number does not move formants.)
- Peterson, G. E., & Barney, H. L. (1952). Control methods used in a study of the vowels. *JASA* 24(2), 175–184. (Typical vowel formant frequencies, used only to build the simulated test vowels.)
- W3C. *Web Audio API* (Recommendation). OscillatorNode, AudioParam.setTargetAtTime, AudioBufferSourceNode. https://www.w3.org/TR/webaudio/

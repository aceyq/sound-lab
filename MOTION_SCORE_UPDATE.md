# Motion Score update: independent pitch and timbre

> **Revised after phone testing (calibration and gesture separation):**
> - Tilt and lean are now measured from the direction of gravity in the phone's own frame, relative to the calibrated position. Raw Euler angles are no longer subtracted.
> - Holding the phone level (neutral) gives a **pure tone**. Leaning either way past a ±5° dead zone adds harmonics, and returning to level makes it pure again.
> - Calibration explains and checks the start position.
> - A live readout shows tilt, lean and richness together.
> - **Lock richness** holds the harmonic recipe.
>
> See "Calibration and gesture-separation revision" at the end. The sections below describe the first version; where they disagree, the revision wins.

Live: https://aceyq.github.io/sound-lab/#/motion-score

## 1. What changed

- **Mapping selector.**
  - **Tilt instrument** (new default): forward/back tilt changes pitch, exactly as before (same direction, 110–880 Hz). Sideways lean, like turning a steering wheel, changes **harmonic richness**: neutral gives a medium tone, leaning left goes toward a pure sine, and leaning right goes toward a rich tone (±30° around your calibrated neutral).
  - **Movement intensity**: the original mapping, unchanged.
- **Phone sensing.**
  - The phone now sends a sideways-lean angle, which the laptop validates.
  - Calibration records the neutral position on both axes.
  - If the phone does not report sideways lean, the app says so and holds richness at medium. It does not pretend the gesture works.
- **Synthesis.**
  - The sound is 12 sine oscillators at n × f0, all phase-locked. There are no more on/off steps.
  - Higher harmonics fade in one after another. At 0% only the fundamental sounds; at 100% all 12 sound.
  - The output is peak-normalized so it never clips.
- **Expression.**
  - **Steady sustain** (default for the Tilt instrument) holds a steady tone while armed. Its **Expression** slider appears on both the laptop and the phone, and the two stay in sync.
  - **Movement expression** keeps the old behavior.
  - Master Volume stays separate.
- **Lock fundamental at [200] Hz.** While locked, the pitch holds at that value, and tilt and Pentatonic are ignored. Sideways lean still changes the timbre. The Fundamental card shows 🔒 LOCKED.
- **Harmonics right now panel.**
  - Shows H1–H12 with each frequency (n × f0).
  - The light bar is the recipe amplitude; the thin blue bar is the output amplitude after normalization.
  - It also shows the normalization factor.
- **Movement Score.** Four tracks: pitch, a continuous richness trace (integer steps in the Movement intensity mapping), expression labeled with its source, and movement intensity. It is labeled as control history, not measured audio.
- **Auto demo** (in Laptop Demo). It runs three steps with simulated input through the real synthesizer and graphs, with a yellow "AUTO DEMO · simulated input" banner:
  1. A pure 200 Hz sine.
  2. 200 Hz held while the harmonics fade in.
  3. The harmonic balance held while the pitch moves.
- **Laptop Demo controls.** Laptop Demo also has manual sliders for forward/back tilt, sideways lean and movement intensity.
- **Updated text.** The tour (21 steps), help text, phone instructions with a drawing, PRESENTATION_NOTES.md and SPEAKER_NOTES.md all describe the new mapping.

### Checks actually performed

All of these are automated or simulated. **No physical phone, listening or Zoom test has been done.**

- **Unit tests: 43 passed** (`npm test`). They cover:
  - sideways-lean math;
  - richness weights (minimum = fundamental only, maximum = all 12, no jumps, fundamental always present);
  - the 1/n recipe, peak normalization and the Nyquist limit;
  - pitch lock, including in Pentatonic;
  - steady sustain staying independent of movement, and going silent when the phone data is stale;
  - the missing-sideways-data fallback;
  - the legacy mapping and Accents;
  - Panic, disconnect and rotation;
  - message validation.
- **Browser checks: 65 passed** (`scripts/verify-motion.mjs`). These used real PeerJS pairing and a simulated phone sending synthetic sensor events, both on localhost and on the live site. They confirmed:
  - lean left at 200 Hz measures only a 200 Hz peak;
  - leaning right fades the gains smoothly, with 12 oscillators running throughout;
  - the measured peaks are 200, 400, 600, 800 and 1000 Hz, and every oscillator runs at exactly n × 200 Hz;
  - the phone and laptop Expression sliders sync;
  - unlocking lets tilt move the pitch while richness holds;
  - the legacy mapping and Accents still work;
  - the auto demo shows all three steps;
  - Stop Audio leaves 0 oscillators running;
  - the existing pairing, Panic, stale-data, disconnect, permission-denied and cleanup checks still pass.
- **Frequency Playground: 36 browser checks passed.**
- **Production build** under `/sound-lab/` succeeded. GitHub Pages deployed it, and both check suites were re-run against the live site.

## 2. Testing on your phone

1. On the laptop, open https://aceyq.github.io/sound-lab/#/motion-score and turn the volume low. If the QR code doesn't appear, refresh.
2. Scan the QR code with the phone camera and open the link in Safari or Chrome. If you're on campus Wi-Fi and it fails, put the laptop on your phone's hotspot.
3. On the phone, tap **Enable Sensors** → **Allow**. Hold the phone upright, comfortably, and still for 3 s while it calibrates. The message should say "neutral forward/back tilt **and sideways lean**". If it says sideways lean is not available, tell me which phone and browser you're using.
4. On the laptop, press **▶ Start Audio**. On the phone, tap **Arm**. A steady tone should start. That's Steady sustain.
5. Lean the phone left and right like a steering wheel. The phone's purple "Lean → harmonic richness" bar and the laptop's harmonic panel should follow, and the pitch should not change.
6. Tilt the top toward you and away. The pitch should change while the tone stays similar.
7. Move the phone's **Expression** slider. The laptop's slider and Expression card should follow.
8. On the laptop, tick **Lock fundamental at 200 Hz** and lean again. The pitch should hold at 200 Hz and the rows should read 200, 400, 600…
9. Safety checks:
   - Lock the phone: the laptop should go silent and disarm.
   - Tap **Arm** again, then **Emergency Mute**: it should stay silent until you press Start Audio.
10. Optional: switch the mapping to **Movement intensity** and check that the old behavior still works.

If anything feels too sensitive, open **⚙ Adjust sensitivity and tilt direction** in Setup step 3. Recalibrating after you change your grip also helps.

## 3. The gesture-to-sound mappings, in plain words

"I hold my phone like a small steering wheel. Tilting the top toward me or away sets the pitch: toward me is higher, away is lower. Leaning it left or right sets the tone. Leaned left, it's a pure, flute-like sine. As I lean right, the sound gets brighter and buzzier, because more harmonics come in. The two gestures are separate, so I can hold the pitch still and change only the tone, or keep the tone and move the pitch. With Steady sustain the note keeps sounding at a level I set, so I can focus on those two gestures. In Accents mode, a sharp flick plays a short note with whatever pitch and tone I'm holding."

## 4. How richness changes the harmonic amplitudes (technical)

- **The oscillators.** The instrument always runs 12 sine oscillators at f0, 2·f0 … 12·f0. They start together at phase 0, and every pitch change moves all of them by the same ramp scaled by n, so they stay locked as true harmonics.
- **Richness to weights.** Sideways lean, relative to neutral, maps to richness: −30° = 0, neutral = 0.5, +30° = 1, smoothed over about 0.1 s.
  - Richness sets a position p = 1 + 11·richness.
  - Harmonic n gets the weight wₙ = clamp(p − (n − 1), 0, 1), except the fundamental, which always has w₁ = 1.
  - So each harmonic fades in over its own stretch: H2 while p goes from 1 to 2, H3 while p goes from 2 to 3, and so on.
- **The recipe.** Recipe amplitude = wₙ × 1/n.
- **Normalization.** Output amplitude = recipe × one shared factor, 1 ÷ (peak of the summed waveform). The mixture's peak is therefore exactly 1 and cannot clip, and all the ratios between harmonics are preserved. From a pure sine to all 12, the level drops about 2.8 dB RMS. Equal perceived loudness is not claimed.
- **Smoothing.** Each oscillator's gain glides there in about 40 ms. Harmonics at or above Nyquist get zero.
- **After the oscillators.** Expression, then Master Volume, then Mute, then the analyser that feeds the waveform, spectrum and spectrogram.

## 5. 60–90 second walkthrough

See SPEAKER_NOTES.md → "Part 2 · Motion Score" for the full version with click cues. In short:

1. **Setup.** Paired, calibrated, Tilt instrument, Flow, Steady sustain, Start Audio. **[Presentation Mode]**
2. "My phone is the instrument. Tilting forward and back is pitch, and leaning sideways is how many harmonics are in the sound."
3. **[Tick Lock fundamental at 200 Hz]**, then **[Arm on the phone]**. *(Lean left.)* "A pure 200 Hz sine: just the fundamental." *(Point at the harmonic panel.)*
4. *(Lean slowly right.)* "Harmonics fade in at 400, 600, 800 hertz, whole-number multiples of 200. The pitch stays the same and the tone gets brighter. That's timbre." *(Point at the spectrogram lines stacking up.)*
5. **[Untick the lock.]** *(Hold the lean and tilt toward and away from you.)* "Now the fundamental moves and every harmonic moves with it." *(Point at the blue line moving while the purple line stays flat.)*
6. **[Accents.]** *(Two or three sharp flicks.)* "A sharp jab plays a short note with the pitch and tone I'm holding."
7. **[Disarm or Mute / Panic.]** "Tilt moves the fundamental and everything with it; leaning changes the harmonic amplitudes while the fundamental stays fixed."

**No phone:** Laptop Demo → Start Audio → **▶ Auto demo (simulated)**. Narrate the three steps, and say the input is simulated.


---

## Calibration and gesture-separation revision

### What changed

- **Start position, explained and checked.** Setup step 3 and the phone both show a picture and steps for the start position: portrait, screen facing you, tilted back slightly (about 10–45° from upright, not flat), and level. Calibration now gives 2.5 s to get into position, then measures for 2 s.
  - A live check tells you if the position is unreliable and how to fix it: nearly flat, tilted past upright toward you, leaning, or upside down.
  - Calibration refuses an unreliable position and explains why.
  - A position that is merely "quite flat" gets a warning.
- **Orientation-relative mapping.**
  - **How it's measured:** the phone sends the direction of "up" in its own axes, computed from beta/gamma.
  - **Forward/back tilt** = rotation about the phone's left–right axis, atan2(up_z, up_y).
  - **Sideways lean** = how far the left–right axis tips from level, asin(up_x).
  - **Reference:** both are measured relative to the calibrated position. Compass heading and Euler-angle wrapping no longer matter.
  - **Separation:** a pure forward/back tilt cannot change the lean reading.
  - **Rotation:** turning the screen out of portrait still asks you to recalibrate.
- **Neutral = pure tone.** Within ±5° of level the tone stays pure; the dead zone is adjustable from 0 to 15° under ⚙ in Setup step 3. Beyond that, leaning either way raises richness smoothly from 0, with no jump, up to 100% at ±30° (also adjustable).
- **Smoother fades.** Each harmonic now fades in over an overlapping stretch, so the timbre changes more gradually.
- **Live gesture readout** under the value cards: forward/back tilt in degrees, sideways lean in degrees (inside or past the dead zone), richness, and the position check. The phone shows the same numbers.
- **Lock richness** holds the current harmonic recipe while you demonstrate pitch. It complements Lock fundamental.
- **Updated guidance.** The tour, phone instructions and illustration, the auto demo (step 3 now uses Lock richness), PRESENTATION_NOTES.md and SPEAKER_NOTES.md all describe this mapping.
- **Unchanged:** the Movement intensity mapping still works as before, and now also uses the better pitch measurement when available.

### Checks actually performed

All automated or simulated. **Physical gesture separation has NOT been verified on a phone.**

- **Unit tests: 51 passed.** They include simulated orientation cases:
  - The up vector matches the W3C rotation model.
  - Two Euler forms of the same physical orientation give identical gestures.
  - A pure forward/back rotation (about the phone's left–right axis) from start positions 0–60° back and 0–8° lean changes the lean reading by less than 0.000001°.
  - A steering-wheel turn reads as lean = asin(sin turn · cos tilt-back), at least 85% of the turn when held 25° back or less, with a pitch side effect under 5°.
  - The forward/back angle wraps correctly at ±180°.
  - The holding-position check catches flat, past-upright, leaning and upside-down positions.
  - Dead-zone and symmetry rules hold, with no jump at the edge.
  - Tilt alone keeps the tone pure; lean either way adds harmonics; returning to level makes it pure again.
  - Lock richness holds the recipe.
  - Calibration rejects a flat phone with instructions.
- **Browser checks: 67 passed**, run with a simulated phone over real PeerJS pairing, on localhost and on the live site. They covered:
  - forward/back tilt alone at 0% richness throughout;
  - level = pure, and leaning either way = full richness;
  - smooth gain fades;
  - Lock richness holding the exact recipe while the pitch moved from 573 Hz to 172 Hz;
  - everything from before.
- **Frequency Playground:** 36 checks passed.
- **Production build** succeeded.

### Physical phone test (about 3 minutes)

1. Open https://aceyq.github.io/sound-lab/#/motion-score on the laptop, then scan the QR code. On the phone, tap **Enable Sensors** and allow access.
2. **Calibration.** During the countdown, hold the start position shown in the picture: portrait, screen facing you, tilted back slightly, level. The phone should show "✓ Good position". On purpose, also try holding the phone flat on a table and calibrating. It should refuse and say "almost flat". Then recalibrate in the good position.
3. **Start Audio** on the laptop, **Arm** on the phone. Holding the start position, you should hear a pure tone and see **Richness 0%**.
4. **Tilt only.** Tilt the top toward you and away 3–4 times without turning the phone. Watch the live readout on the laptop:
   - the **forward/back tilt** number should swing a lot;
   - the **sideways lean** number should stay within about ±5° ("inside dead zone");
   - richness should stay at **0%**.

   If richness rises, check the lean number. If the lean number moved, the phone actually turned. If the lean stayed near 0° but richness rose anyway, note it down; that would be a bug.
5. **Lean only.** Turn the phone like a steering wheel, first left and then right, without tilting:
   - richness should rise in both directions;
   - the pitch should stay steady, with a small drift at most;
   - when you return to level, the tone should be pure again.
6. Optionally change **Sideways dead zone** to 10°, and check that small accidental turns no longer add harmonics.
7. **Locks.** Tick **Lock fundamental**, lean, and check that the pitch stays at 200 Hz. Untick it. Lean to a medium amount, tick **Lock richness**, then tilt: only the pitch should change.
8. Write down which steps passed. That is the only evidence that physical separation works on your phone.

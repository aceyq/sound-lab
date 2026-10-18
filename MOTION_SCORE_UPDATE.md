# Motion Score update: independent pitch and timbre

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

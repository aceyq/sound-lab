# Speaker Notes: what to say, and where to click

These are written to be said out loud. Words in quotes are what you say. **[Click …]** tells you what to do on screen at that moment. *(Point at …)* tells you where to direct people's eyes. You don't have to read them word for word; the cues matter more than the exact wording.

Before you start:
- Open https://aceyq.github.io/sound-lab/ in Chrome on the laptop.
- Put headphones on, and set the laptop volume low.
- In Zoom, go to **Share Screen**, pick the Chrome window, and tick **Share sound**.

---

## Part 1 · Frequency Playground (about 3 minutes)

**[Click the "1. Frequency Playground" tab at the top.]** **[Click "Reset", then "Presentation Mode: off" so it says "on".]**

"My first project is called Frequency Playground. The idea is simple: any sound can be built by adding together plain sine waves. Each row in this table is one sine wave. I choose its frequency, meaning how many times per second it vibrates, and its amplitude, meaning how big it is."

*(Point at the formula under "Frequency components".)*
"That's what this formula says: the sound is a sum of sine waves, one per row."

### One pure tone

**[Click "▶ Play".]**

"Right now there's just one row, 220 Hz. This is the purest sound there is, a single frequency."

*(Point at the waveform, the top graph.)*
"This is the waveform: how the air pressure goes up and down over time. We're looking at 20 milliseconds, and you can count about four waves, because 220 vibrations per second times 0.02 seconds is about 4."

*(Point at the spectrum, the middle graph.)*
"This one is the spectrum. It's a real measurement of the sound, called an FFT, and it answers the question: which frequencies are in here? There's one peak, at 220, right on the dashed line for what I typed."

**[Click the frequency box in row C1, type 440, press Enter.]**

"If I double the frequency to 440, it sounds an octave higher. Twice as many waves fit in the same window, and the peak moves to 440."

### Zooming is only a view

**[Click "1 s" under Time window, then click "20 ms".]**

"These buttons only change how much time we look at. They don't change the sound itself; I'm just zooming the camera in and out."

### Building a richer sound

**[Click "B. Harmonic Family".]**

"Now five rows: 100, 200, 300, 400 and 500 Hz. Notice they're all whole-number multiples of 100. Those are called harmonics."

*(Point at the waveform.)*
"The shape isn't a smooth sine anymore, but it still repeats every 10 milliseconds, which is the period of the 100 Hz base."

*(Point at the spectrum.)*
"And the spectrum pulls the mixture back apart into its five ingredients: five evenly spaced peaks. That's what a Fourier transform does."

### When frequencies don't fit together

**[Click "C. Non-harmonic Mixture".]**

"These frequencies are not multiples of one base. You can hear it: it sounds less like one note and more like a clang. The waveform has no short repeating pattern."

**[Click "E. Randomize".]**

"Randomize picks new frequencies. It changes the actual sound, and the measured peaks follow the new numbers in the table."

### Beats

**[Click "D. Close Frequencies / Beats", then click "Switch waveform to 1 s".]**

"Here are two tones that are almost the same, 220 and 224 Hz. Listen to the wah-wah-wah. It pulses about four times a second, which is exactly the difference between them. On the one-second waveform you can see the sound swell and pinch four times."

### Volume versus amplitude

**[Click "B. Harmonic Family" again. Drag "Master Volume" up a little, then back down.]**

"Master Volume only changes what we hear. The graphs don't move, because they show the recipe before the volume knob."

**[Change the C1 amplitude box to 0.2.]**

"But changing one ingredient does change the recipe. The waveform shape changes and the 100 Hz peak drops."

**[Click "■ Stop".]**

"So that's Frequency Playground: you build a sound from sine waves and see it three ways: in time, in frequency, and as a spectrogram over time."

---

## Part 2 · Motion Score (about 60–90 seconds)

Before your turn:
1. **[Click the "2. Motion Score" tab.]** Scan the QR code with your phone.
2. On the phone, tap **Enable Sensors** → **Allow**, then hold still while it calibrates.
3. On the laptop, check it says **Tilt instrument**, **Flow** and **Steady sustain**.
4. **[Click "▶ Start Audio".]** Leave it disarmed for now.

**[Click "🖥 Presentation Mode".]**

"For my second project my phone is the instrument. Its motion sensors stream to my laptop, which builds the sound out of harmonics, the same additive synthesis as my first project. I wanted pitch and tone color to be separate gestures, so: tilting the phone forward and back changes the pitch, and leaning it sideways, like a steering wheel, changes how many harmonics are in the sound."

**[Tick "Lock fundamental at 200 Hz". Tap "Arm" on the phone.]** *(Lean the phone all the way left.)*

"I've locked the pitch at 200 hertz. Leaning left, this is a pure sine wave: just the fundamental."

*(Point at the harmonic panel: only H1 is lit.)*

*(Lean slowly to the right.)*
"As I lean right, harmonics fade in one at a time: 400, 600, 800 hertz, each a whole-number multiple of 200. The pitch doesn't change, still 200, but the tone gets brighter. That's timbre."

*(Point at the spectrogram: new lines appearing above the 200 Hz line.)*
"Down here is the measured sound. The bottom line stays put, and the new lines stack up above it."

**[Untick "Lock fundamental".]** *(Hold a medium lean, then tilt the top toward you and away.)*

"Now I keep the lean the same and tilt instead. The fundamental moves, and every harmonic moves with it, because they're all multiples of it. Same tone, different pitch."

*(Point at the Movement Score: the blue pitch line moves while the purple richness line stays flat.)*
"This top graph is just the control data from my phone: blue is pitch, purple is richness. You can see I changed one while holding the other."

**[Click "Accents".]** *(Make two or three sharp flicks at different leans.)* "And in Accents mode each sharp jab plays a short note, using whatever pitch and tone I'm holding."

**[Tap "Disarm" on the phone, or click "🔇 Mute / Panic".]**

"So: tilt moves the fundamental and everything with it, and lean changes the harmonic amplitudes while the fundamental stays fixed. There's no machine learning; these are rules I programmed."

**No phone? Use the auto demo instead:**
1. **[Click "💻 Use Laptop Demo", then "▶ Start Audio", then "▶ Auto demo (simulated)".]**
2. Say: "This is simulated input, but it runs through the same synthesizer and graphs."
3. Narrate the three steps as the yellow banner changes:
   - a pure 200 Hz sine,
   - harmonics fading in at 200 Hz,
   - the pitch moving with the harmonic balance held steady.

## If something goes wrong mid-demo

- **The phone won't pair:**
  1. **[Click "💻 Use Laptop Demo".]** Say: "I'll switch to the simulated version so you can still see how the mappings work."
  2. **[Click "▶ Start Audio", then "Arm".]**
  3. Drag the **Tilt** and **Movement intensity** sliders, and press **A** for an accent.
- **It's connected but there's no sound:** check the status bar from left to right: Sensors, Control (Armed), Audio (On). Then check that Zoom's **Share sound** is on.
- **You've lost your place:** **[Click "🧭 Demo Guide".]** It dims the page and points at each part with what to say. Or click any **?** next to a title to jump straight to that part.

## Answers to likely questions

- **"Did you train a model?"** "No. These are rules I wrote: tilt to pitch, movement to harmonics, sharp changes to notes."
- **"How does it know the tilt?"** "The phone combines its motion sensors to work out its orientation in degrees. Movement is measured as acceleration, with gravity removed so a still phone reads zero."
- **"Why does more movement add harmonics?"** "It's a design choice. More energy makes a brighter tone, which feels natural, and it reuses the harmonics idea from my first project."
- **"What's Pentatonic?"** "A five-note scale. Snapping to it means any movement lands on notes that sound good together."
- **"Why not just one mapping?"** "The original one ties harmonics to how hard I move, which is fun for dancing, but pitch and tone change together. The tilt instrument separates them so you can actually hear what harmonics do. Both are still there."
- **"Is the loudness the same when harmonics come in?"** "I normalize the waveform so its peak never clips; the level drops about 3 dB from a pure sine to all twelve. I didn't try to match perceived loudness exactly."

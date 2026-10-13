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

## Part 2 · Motion Score (about 3–4 minutes)

Set up before your turn so you're ready to play:
1. **[Click the "2. Motion Score" tab.]** The QR code appears.
2. Scan it with your phone, tap **Enable Sensors** → **Allow**, and hold still while it calibrates.
3. Leave the laptop on **Flow** and **Continuous**, with audio still off.

### Why and what

"For my second project, the assignment was to control sound with a gesture. Professor Minces already showed hand tracking with the camera, so I wanted something different, and as a dancer I care about *how* I move, not just where my hand is. So my phone is the controller. Its motion sensors send data to this page on my laptop, and the laptop makes the sound."

*(Point at the status bar at the top.)*
"These lights tell me everything is connected. Phone connected means the phone can talk to the laptop. Sensors active means motion data is arriving. And Armed means I'm actually allowing movement to make sound. Separately, the audio engine has to be on."

**[Click "▶ Start Audio". Then tap "Arm" on the phone.]**

"Pairing on its own never makes sound. I have to turn audio on and arm it on purpose."

**[Click "🖥 Presentation Mode".]**

### The three rules

*(Point at the legend with the little phone drawing.)*
"There are three rules, and I programmed them myself. There's no machine learning. One: tilt changes pitch. Two: movement intensity changes harmonic richness. Three: sharp movements trigger notes in Accents mode."

### Flow

"I'm in Flow mode. Think of it like bowing a violin: the sound only lasts as long as I keep moving."

*(Hold the phone still.)* "If I hold still… silence."

*(Point at the Expression card showing 0%.)*

*(Make a slow, gentle arm wave.)* "A gentle movement gives a soft, simple tone."

*(Point at Harmonic components: a low number.)*

*(Keep waving, and tilt the top of the phone toward you and away.)* "Now I tilt. Toward me goes higher, away goes lower."

*(Point at the Fundamental number, then at the blue line in the Movement Score.)*
"You can see the note change here, and the blue line draws it over time, like sheet music."

*(Hold the tilt steady and move more energetically.)* "Now I keep the tilt the same and move harder. The tone gets brighter and stronger."

*(Point at Harmonic components rising, then at the green track.)*
"Harder movement adds harmonics, the same idea as in my first project: extra frequencies at 2×, 3×, 4× the base. The pitch stays the same but the color of the sound changes. That color is called timbre."

### The spectrogram

*(Point at the spectrogram.)*
"This bottom graph is the actual sound coming out of the laptop. The lowest bright line is the note I'm playing, and the lines stacked above it are the harmonics. So the Movement Score above shows what my phone told the instrument, and the spectrogram shows the sound that came out."

### Accents and Pentatonic

**[Click "Accents", then "Pentatonic".]**

"Accents mode is more like hitting a drum. Smooth movement makes no sound; a sharp jab plays one short note."

"Pentatonic means the pitch snaps to five notes, A, C, D, E and G, instead of sliding. Those five notes all sound good together, so whatever I do sounds like a melody."

*(Make three sharp flicks: one tilted down, one level, one tilted up.)*

*(Point at the three orange lines in the Movement Score, and the three notes at different heights in the spectrogram.)*
"Three hits, three notes. The tilt picked each pitch, and how hard I hit set how rich each note is."

### Ending and limitations

**[Tap "Disarm" on the phone, or click "🔇 Mute / Panic".]**

"Disarm stops it. And if anything goes wrong, Mute / Panic silences everything instantly. If the phone disconnects or locks, the laptop goes silent by itself within a fraction of a second."

"Some honest limitations. It doesn't recognize dance moves. It only measures how the phone tilts and accelerates. Tilt and movement are physically linked, so I can only separate them roughly. And pairing goes over the internet through a free service, so on some networks it can fail. That's why there's a Laptop Demo mode, which is clearly labeled as simulated."

**[Click "✕ Exit Presentation".]**

---

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

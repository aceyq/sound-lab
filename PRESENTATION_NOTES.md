# Motion Score: Presentation Notes

Motion Score is Project 2: **turn dance movement into sound.** A phone's motion and orientation sensors control an instrument that runs on the laptop. The phone is the controller; the laptop makes the sound and shows the visuals.

> This uses phone sensor measurements and explicitly programmed mappings to synthesize sound. It does not train a model to recognize dance movements.

Notes for Project 1 (Frequency Playground) are further down. For a word-for-word script with click cues for both projects, see `SPEAKER_NOTES.md`.

---

## A. Quick start

1. On the laptop, open the hosted Motion Score page (`https://…/#/motion-score`). A QR code appears by itself.
2. Scan the QR code with the phone's camera and open the link (Safari on iPhone, Chrome on Android).
3. On the phone, tap the big **Enable Sensors** button and choose **Allow**.
4. Hold the phone comfortably and still for 3 seconds: it **calibrates automatically** ("Calibration complete").
5. On the laptop, turn the volume low and press **▶ Start Audio**.
6. On the phone, tap **Arm** (or press Arm on the laptop). Move: the sound follows.
7. To stop: **Disarm** on the phone, or **🔇 Mute / Panic** on the laptop (**Emergency Mute** on the phone) for instant silence.

The phone always shows one big button for the next step ("Step 1 of 3" … "Step 3 of 3"), so you never have to guess.

No phone, or pairing fails? Press **💻 Use Laptop Demo** and use the sliders. Then **▶ Start Audio** and **Arm**.

If the laptop page is open at `localhost` (local development), a phone cannot reach it: no QR code is shown. Use the hosted site, or see "Testing with a phone before the site is hosted" in section H.

---

## B. 2–3 minute presentation script

> **What I built.** "This is Motion Score. The assignment was to control sound with a gesture. Dr. Minces already showed finger tracking with the camera, so I tried something different: my phone is the controller. Its motion sensors stream to this web page on my laptop, which synthesizes the sound and draws what's happening."
>
> **Why phone movement.** "As a dancer I care about how I move, not just where my hand is: smooth versus sharp, gentle versus energetic. A phone in my hand measures exactly that kind of motion, and it doesn't care about lighting or being in front of a camera."
>
> **What the sensors measure.** "Two things. Orientation, meaning which way the phone is tilted, in degrees; the phone computes that by combining its motion sensors. And acceleration, how fast its speed is changing, in meters per second squared. A phone at rest still feels gravity, so we use acceleration with gravity removed. That way only my movement counts."
>
> **The mappings.** "Three simple rules, written by me, no machine learning. One: tilt changes pitch. Tilting the top of the phone toward me raises the fundamental frequency, from 110 up to 880 Hz, on a logarithmic scale so equal tilts are equal musical steps. Two: movement intensity changes harmonic richness. More energetic movement adds harmonics: frequencies at whole-number multiples of the fundamental, from 1 up to 12 components. That changes the timbre, the color of the sound. Three: sharp movements trigger notes in Accents mode."
>
> **Flow versus Accents.** "In Flow, I have to keep moving to sustain the sound: stillness fades to silence, gentle movement is soft and simple, energetic movement is strong and rich. In Accents, a sharp hit plays one short note; tilt chooses its pitch and how hard I move shapes its richness."
>
> **The visuals.** "The Movement Score at the top is the control data from my phone over the last ten seconds: pitch in blue, movement in green, harmonics in purple, accents in orange. Below it is a spectrogram of the actual audio coming out of the laptop. So you can see this movement, which changed this parameter, which produced this sound."
>
> **Limitations.** "It doesn't recognize dance moves; it only measures the phone's tilt and acceleration. Tilt and movement are physically linked, since tilting is itself a movement, so I can only separate them approximately. And pairing goes through a free public service and WebRTC, which some networks block, so I keep a Laptop Demo mode as a clearly labeled fallback."

---

## C. Control reference

Labels match the app exactly.

### Laptop: always visible

| Control | What it does | When to use it | What I should observe |
| --- | --- | --- | --- |
| Status bar: **Input / Phone / Sensors / Control / Audio** | Shows the five separate states. *Connected* means the phone can talk to the laptop; *Sensors Active* means motion data is arriving; *Armed* means movement may control sound; *Audio On* means the laptop's sound engine runs. | Glance at it any time. | Green = good, yellow = waiting, red = problem. The text on the right says *♪ Playing*, *Ready…* or *Silent: reason*. |
| **🔇 Mute / Panic** | Silences immediately and disarms. Stays muted until you press Start Audio. Phone messages cannot undo it. | Anything goes wrong, or to end sharply. | Audio: *Muted by Panic*; Control: *Disarmed*. |

### Laptop: A · Setup

| Control | What it does | When to use it | What I should observe |
| --- | --- | --- | --- |
| **📱 Connect Phone** | Creates a new random session and shows the QR code, link, Session ID and Code. On the hosted site this happens automatically when the page opens. | Step 1 (only needed on a local page, or to start over). | Phone: *Creating session…* then *Waiting for phone*. |
| **💻 Use Laptop Demo** | Switches to simulated input (sliders). Disconnects any phone and disarms first. | No phone, or pairing fails. | Purple badge "Laptop Demo — phone sensors are not connected." Steps 2–3 marked "not needed". |
| **Copy link** | Copies the phone link. | To send the link to the phone another way. | "Phone link copied." |
| **New Session** | Closes the current connection and makes a fresh QR code and code. | Pairing failed, timed out, or the wrong phone joined. | New Session ID and Code. |
| **Calibrate** / **Recalibrate** | 1 s "get ready" + 2 s measuring while you hold still. Sets your neutral tilt and the sensor noise at rest. Runs automatically the first time the phone's sensors turn on. | To redo it: whenever you change how you hold the phone, after rotating it, or if it failed. | Countdown, then "Calibration complete…" in green, or a red message saying what went wrong. |
| **▶ Start Audio** | Turns on the laptop's audio engine. Also the only way out of Panic. | Step 4. | Audio: *On*. No sound yet until Armed and moving. |
| **Arm** / **Disarm** | Arm lets phone movement control the sound. Disarm pauses control and silences. | Step 4 / to pause. | Control: *Armed* / *Disarmed*. |

### Laptop: B · Play

| Control | What it does | When to use it | What I should observe |
| --- | --- | --- | --- |
| **Fundamental** card | Current fundamental frequency in Hz, nearest note, and tilt from neutral. | Point to it while tilting. | Number rises when tilting toward you. |
| **Harmonic richness** card | Tilt instrument: richness 0–100% from sideways lean ("harmonics up to ≈H6.5 of 12"). Movement intensity mapping: "N of 12" components including the fundamental. | Point to it while leaning. | Rises as you lean right. Shows ⚠ if the phone does not report sideways lean. |
| **Expression** card | Signal strength, with its source: steady sustain (slider), movement intensity, or the note envelope in Accents. Separate from Master Volume. | Point to it when explaining loudness. | Steady sustain: stays at the slider value. Movement: 0% when still. |
| **Mapping: Tilt instrument / Movement intensity** | Tilt instrument (default): forward/back tilt = pitch, sideways lean = harmonic richness, independently. Movement intensity: the original mapping (moving harder = more harmonics + stronger). | Tilt instrument to demonstrate harmonics; Movement intensity for energetic dancing. | Legend, phone instructions and Movement Score switch to match. |
| **Flow expression: Steady sustain / Movement expression** (Flow only) | Steady sustain: the tone keeps sounding at the **Expression** slider level while armed (default for Tilt instrument). Movement expression: strength follows movement. | Steady sustain for explaining timbre; Movement expression for dancing. | With Steady sustain a still phone still sounds. |
| **Expression** slider | Sets the steady sustain level. The same slider is on the phone; they stay in sync. | Before demonstrating. | Expression card and the white track change. |
| **Lock fundamental at [200] Hz** | Holds the pitch at the typed value (50–1000 Hz). Forward/back tilt and Pentatonic no longer change it; sideways lean still changes the harmonics. Untick to return to tilt control. | To show harmonics changing on a fixed fundamental. | Fundamental card shows 🔒 LOCKED; harmonic rows read 200, 400, 600 Hz… |
| **Harmonics right now** panel | One row per harmonic H1–H12: frequency (n × f0), light bar = recipe amplitude (weight × 1/n), thin blue bar = output amplitude after normalization. | When explaining what richness does. | Lower rows fill first as you lean right; all rows move together when f0 changes. |
| **Flow** / **Accents** | Chooses how movement is interpreted (see section D). | Flow for sustained sound; Accents for short notes. | The sentence under the buttons changes. |
| **Continuous** / **Pentatonic** | Continuous allows smooth pitch slides. Pentatonic selects nearby notes from A minor pentatonic: A, C, D, E, G. | Continuous to explain frequency; Pentatonic for a musical performance. | In Pentatonic the Hz value jumps between note values. |
| **■ Stop Audio** | Fades out, stops the audio engine and disarms. | When finished. | Audio: *Off*. |
| **Master Volume** | Overall listening level (starts at 15%). Does not change Expression. | Set before playing, low at first. | Louder/quieter; the spectrogram also gets brighter/darker because it measures the output. |
| **❄ Freeze Visual History** | Freezes only the Movement Score, spectrogram and audio graphs. Sound and safety checks keep running. | To explain a picture. | Yellow "VISUAL HISTORY FROZEN" label. Button becomes **▶ Unfreeze Visual History**. |
| **🧭 Demo Guide** | Guided tour: dims the page, highlights one part at a time, and shows what it is and what to try (Back / Next / Close, or Esc). It never plays sound or fakes data. | Learning the app, or as a prompt during the demo. | A bright outline around the part being explained and a card beside it. |
| **?** buttons (next to titles) | Open the Demo Guide at the step that explains that part. | When you want to explain one specific control. | Same spotlight, starting at that part. |
| **ⓘ** lines | Short explanation that opens in place, with "More detail". | Answering a "why" question. | Text expands under the line. |
| **🖥 Presentation Mode** | Hides Setup, the explanations and section C; enlarges the live values and graphs. Status bar and Panic stay visible. | While screen sharing. | Button becomes **✕ Exit Presentation** (or press Esc). |
| **Clear Movement Score** | Erases the Movement Score history. | Before a demo. | Empty tracks. |
| **Clear Spectrogram** | Erases the spectrogram history. | Before a demo. | Empty spectrogram. |

### Laptop Demo panel (only in Laptop Demo)

| Control | What it does | When to use it | What I should observe |
| --- | --- | --- | --- |
| **▶ Auto demo (simulated)** | 30 s walkthrough with simulated input through the real synthesizer: (1) pure 200 Hz sine, (2) 200 Hz held while harmonics fade in, (3) harmonic balance held while the pitch moves. A yellow banner says "AUTO DEMO · simulated input". Needs Start Audio. | No phone, or to show the concept cleanly. | Step banner; harmonic panel, Movement Score and spectrogram follow. Moving a slider or **■ Stop auto demo** stops it. |
| **Forward/back tilt** slider (−35° to +35°) | Simulated tilt → pitch. Keys ↑ ↓ | Fallback demo. | Fundamental changes (unless locked). |
| **Sideways lean** slider (−30° to +30°) | Simulated lean → harmonic richness. Keys ← → | Fallback demo (Tilt instrument). | Harmonic panel and richness change. |
| **Movement intensity** slider (0–100%) | Simulated movement → movement expression (and harmonics in the Movement intensity mapping). Keys − / = | Fallback demo. | Expression changes when Movement expression is selected. |
| **⚡ Trigger Accent (A)** | Simulated sharp movement → short note in Accents mode. Key A (or Space). | Accents mode only. | One short note, orange marker. |
| **Stop Laptop Demo** | Turns off simulated input (silences and disarms). | When done with the fallback. | Input: *None*. |

### Laptop: settings and explanations

Explanations sit next to the parts they explain (ⓘ lines). Sensitivity and Invert tilt are under **⚙ Adjust sensitivity and tilt direction** in Setup step 3; the waveform and spectrum are under **Audio graphs** below the spectrogram. Section **C · Diagnostics and presentation help** keeps the technical details.


| Control | What it does | When to use it | What I should observe |
| --- | --- | --- | --- |
| **⚙ Adjust sensitivity and tilt direction → Sensitivity** (0.5×–2×) | Higher = smaller movements reach 100% intensity and lighter flicks count as accents. | Sound too quiet → raise; never silent → lower. | Movement % changes for the same motion. |
| **Invert tilt** | Swaps the pitch direction. | If "toward me = higher" feels backwards. | Opposite pitch direction. |
| **Audio graphs** | 20 ms waveform and current spectrum of the output. | Explaining harmonics. | Peaks at 1×, 2×, 3×… the fundamental. |
| **Diagnostics** | Raw sensor values (degrees, m/s², m/s³), update rates, last-sample age, rejected messages, audio details. | Troubleshooting. | Numbers update live. |
| **Presentation help** | Zoom steps and the 30-second demo. | Before presenting. | Text. |

### Phone Controller page

The phone shows **one big button** for the next step; its label changes:

| Control | What it does | When to use it | What I should observe |
| --- | --- | --- | --- |
| **Enable Sensors** (Step 1 of 3) | Asks for motion and orientation permission and starts reading the sensors. Calibration then starts by itself. | First thing after the page opens. | "Hold your phone comfortably and stay still…", then Step 3. |
| **Calibrate Again** (Step 2 of 3) | Repeats calibration after it failed. | If you moved during the countdown. | "Calibration complete." |
| **Arm** (Step 3 of 3) | Lets movement control the sound. | After calibration (laptop audio must also be started). | Movement control: *Armed…*; the button becomes **Disarm**. |
| **Disarm** | Pauses movement control and silences. | To pause. | Button returns to **Arm**. |
| **Try Again** | Reconnects to the same laptop session. | After *Connection failed* or *lost*. | *Connecting…* then *Connected*. |
| **Recalibrate** (small) | Redoes calibration. | After changing your grip. | Countdown and "Calibration complete." |
| **Emergency Mute** | Same as Mute / Panic on the laptop. | Anything goes wrong. | Laptop audio: *Muted by Panic*. |
| **Connect** (Session ID + Code form) | Manual pairing without a QR code. | If scanning does not work. | *Connected to laptop*. |
| **Tilt → pitch** / **Movement → richness** bars, **Accent!** flash | Live feedback from the laptop. | While moving. | Bars move; "Accent!" flashes on each note. |

---

## D. Concept reference (with the real numbers)

- **Fundamental frequency:** the base frequency used to build the sound. Here 110 Hz (A2) to 880 Hz (A5), three octaves.
- **Tilt → pitch:** forward/back tilt (`beta` from DeviceOrientationEvent) while holding the phone upright in portrait. Relative to your calibrated neutral, ±35° covers the whole range: −35° = 110 Hz, neutral ≈ 311 Hz, +35° = 880 Hz. Tilt toward you = higher (can be inverted). The mapping is logarithmic: every 23⅓° is one octave.
- **Fundamental:** the base frequency of this harmonic sound. **Harmonics:** whole-number multiples of it (H2 = 2 × f0, H3 = 3 × f0…). Changing the fundamental moves all harmonic frequencies together. Changing harmonic amplitudes changes the waveform and the timbre while the fundamental can stay fixed. **Timbre** is tone quality; brightness is one aspect of it.
- **Sideways lean → harmonic richness (Tilt instrument):** lean = the angle of the phone's left–right axis from level, computed as asin(sin γ · cos β) from DeviceOrientationEvent beta and gamma (this stays reliable when the phone is upright, where gamma alone does not). Relative to your calibrated neutral: −30° = 0% (pure sine), neutral = 50%, +30° = 100% (all 12). Smoothed over ≈0.1 s.
- **How richness changes the amplitudes:** the sound is 12 sine oscillators at n × f0, all started together at phase 0. Richness sets a position p = 1 + 11 × richness. Harmonic n's weight is 1 for n = 1 (the fundamental is always on) and clamp(p − (n − 1), 0, 1) for the rest, so each harmonic fades in over its own stretch: H2 while p goes 1→2, H3 while 2→3, and so on. Recipe amplitude = weight × 1/n. Output amplitude = recipe × one normalization factor = 1 ÷ (peak of the summed wave), so the mixture's peak is exactly 1 and never clips. Measured level change from a pure sine to all 12: about −2.8 dB RMS (equal perceived loudness is not claimed). Gains glide over ≈40 ms; components at or above Nyquist are left out.
- **Movement intensity mapping (original):** harmonic count 1–12 (whole numbers, including the fundamental) from movement, with hysteresis 0.3; same synthesizer, weights 1 or 0.
- **Amplitude / Expression:** *Expression* is the signal strength the instrument produces; *Master Volume* is your listening level. Steady sustain: Expression = the slider (laptop/phone). Movement expression: follows movement intensity with a ≈0.08 s attack and ≈0.35 s release.
- **Lock fundamental:** f0 = the typed value (50–1000 Hz) exactly; while locked, tilt and Pentatonic are ignored, so the displayed and audible frequency are the same number. Accents: 15 ms attack to a fixed peak, exponential decay, forced to zero at 450 ms; a new hit restarts the note (no build-up).
- **Orientation:** which way the phone points (degrees). The phone's browser computes it by combining its motion sensors.
- **Acceleration:** how fast the phone's speed changes (m/s²). **Movement intensity** = size of the gravity-free acceleration, smoothed over ≈0.12 s, minus your stillness noise, scaled so ≈5 m/s² above rest = 100% (at Sensitivity 1.0×). It measures the phone's acceleration, not physical energy, dance quality or whole-body motion.
- **Sharp movement (accent):** jerk, the rate of change of acceleration (m/s³), above a threshold (≈120 m/s³ at 1.0×, or 4 × your calibrated jerk noise if larger). After a note: wait for jerk to drop below half the threshold and at least 300 ms.
- **Gravity removal:** most phones report acceleration with gravity removed. If not, the app estimates gravity with a 0.5 s low-pass filter and subtracts it (approximate; Diagnostics says "gravity estimated").
- **Smoothing:** averaging out tiny jitter so the sound doesn't wobble or click.
- **Calibration:** 2 s of stillness records your neutral forward/back tilt, your neutral sideways lean, and the sensor's noise at rest. It fails if you moved more than 15° on either axis. If the phone does not report sideways lean, calibration says so and richness stays at medium.
- **Pentatonic quantization:** snapping to the nearest note of A minor pentatonic (A C D E G) between A2 and A5, keeping the current note until you are clearly (0.6 semitone) closer to another.
- **Waveform:** audio amplitude over time. **Spectrum:** audio frequency content at a moment. **Spectrogram:** audio frequency content over time (here: log frequency axis, ≈10 s, brighter = louder, measured at the laptop's output after Expression, Master Volume and Mute). **Movement Score:** sensor-derived control history, not audio.

---

## E. Demonstration

### 30-second performance (Tilt instrument)

| Time | Do | Point to |
| --- | --- | --- |
| 0–10 s | Flow, Steady sustain. Tick **Lock fundamental at 200 Hz**. Lean left: pure sine. Lean slowly right. | Harmonic panel rows filling from H2 upward; new lines at 400, 600, 800 Hz in the spectrogram; Fundamental stays 200 Hz. |
| 10–20 s | Hold a medium lean, untick the lock, tilt toward/away from you. | Fundamental Hz and every harmonic row change together; the spectrogram's stack of lines moves up and down as one. |
| 20–27 s | **Accents** + **Pentatonic**. Three sharp hits at different tilts and leans. | Orange markers; three short notes with different pitch and tone. |
| 27–30 s | **Disarm** (or **🔇 Mute / Panic**). | Control: Disarmed. |

The **▶ Auto demo** in Laptop Demo performs steps like these with simulated input, through the same synthesizer.

### Dancer-inspired ideas

- **Slow arm waves** (Flow): continuous, gentle sound whose pitch follows the arm's angle.
- **Controlled wrist tilt** (Flow or Pentatonic): a melody by tilting while keeping a small, steady motion so the sound sustains.
- **Sharp hits** (Accents + Pentatonic): punctuation on beats; each hit's tilt picks the note.

### Demo Guide (in the app)

21 spotlight steps: status bar → setup → Mute / Panic → mapping → Fundamental → Harmonic richness → Expression → Flow vs Accents → Continuous vs Pentatonic → Lock fundamental → harmonic panel → audio controls → the rules → the four Movement Score tracks → spectrogram → Freeze → Presentation Mode → finish.

---

## F. Likely questions

- **Why a phone instead of finger tracking?** It measures *how* I move (smooth, sharp, energetic), works in any lighting, and doesn't need me in front of the camera. It's a different interaction from the camera demo we saw.
- **Does this recognize dance moves?** No. It measures the phone's tilt and acceleration and applies fixed rules.
- **Did I train a machine-learning model?** No. Everything is explicitly programmed mappings.
- **Why lean for harmonics instead of moving harder?** So pitch and timbre have separate gestures: you can hold one still while changing the other, which makes the harmonics audible on their own. The old mapping is still available as "Movement intensity".
- **Why does stronger movement add harmonics?** (Movement intensity mapping) It's my design choice: more energy → brighter, richer timbre feels natural. Mathematically it adds components at 2f, 3f, … with amplitudes 1/n.
- **How is gravity handled?** Most phones report acceleration with gravity already removed. Otherwise the app estimates gravity as the slowly changing part of the signal and subtracts it, which is an approximation.
- **Why does sound keep going when I hold still?** With Steady sustain (default for the Tilt instrument) the tone stays at the Expression slider level while armed, so you can explore pitch and timbre without dancing constantly. Safety still applies: disconnect, stale data, Disarm, Stop or Panic silence it.
- **Why does sound stop when I stop moving?** (Movement expression) Expression follows movement intensity, and calibration makes stillness count as 0%. It fades over ~0.35 s so short pauses don't chatter.
- **Why are Flow and Accents different?** Same sensors, two interpretations. Flow is like bowing a violin: sound lasts while you keep moving. Accents is like hitting a drum: smooth movement is silent, each sharp change (jerk) plays one short note.
- **What happens if the phone disconnects?** The laptop goes silent within about 0.15 s, cancels any accent, shows *Connection lost*, and disarms; you must Arm again. If data simply stops for 0.5 s it goes silent; after 3 s it disarms. The laptop enforces this itself, even if the phone can't send a goodbye.
- **What is simulated in Laptop Demo?** Tilt, movement intensity and accents come from sliders/keys instead of the phone. They go through the same mappings and audio. It's always labeled "Laptop Demo — phone sensors are not connected."
- **Is the connection secure?** A random session ID and pairing code keep other phones out and only one phone is accepted, but it's a classroom tool, not for sensitive data.

---

## G. Limitations and troubleshooting

- **Sensor/browser support:** needs a secure (https) page opened directly in Safari (iOS 13+ asks for permission) or Chrome (Android). Some browsers, in-app browsers or desktop computers have no motion sensors.
- **Sensor noise:** phone sensors jitter; calibration and smoothing reduce it but don't remove it.
- **Approximate gravity estimation** on phones that don't report gravity-free acceleration.
- **Physical coupling:** tilting creates acceleration and moving changes tilt, so pitch and richness are never perfectly independent.
- **Network pairing:** uses PeerJS's free public signaling server (0.peerjs.com) and WebRTC. Being on the same Wi-Fi does not guarantee success; school/corporate networks may block it. No app-specific TURN relay is configured (only PeerJS's built-in public defaults). Fallback: Laptop Demo.
- **Phone sleep/background:** if the phone locks or the page is hidden, the laptop disarms. The phone tries to keep the screen awake (Wake Lock) where supported; otherwise turn off auto-lock.
- **No dance recognition:** only tilt and acceleration.
- **"Connected but no sound"** (check in this order): Sensors not Active (tap Enable Sensors); not calibrated; Audio not On (press Start Audio); not Armed; muted by Panic (press Start Audio, then Arm); in Flow you're holding still; in Accents you haven't made a sharp movement; Master Volume or computer volume is low; Zoom "Share sound" is off.
- **iPhone permission denied:** close the tab completely and open the link again, or clear the site's data in Settings → Safari → Advanced → Website Data.
- **Android:** site settings → Motion sensors → Allow, then reload.

### Manual checklist (not verifiable from here)

These were **not** tested with a real phone, real sensors, real listening, or Zoom. Before class:

- [ ] Open the hosted page on the laptop; Connect Phone; scan the QR code on your actual phone, on the actual Wi-Fi you'll use.
- [ ] Enable Sensors: Sensors Active on both screens.
- [ ] Calibration (automatic after Enable Sensors) while holding the phone the way you'll perform; Recalibrate if needed.
- [ ] Start Audio (low volume), Arm. Still = silence; moving = sound; tilt toward you = higher.
- [ ] Accents: three sharp hits = three notes, no double notes from one hit (adjust Sensitivity if needed).
- [ ] Lock the phone: laptop goes silent and disarms. Unlock, Arm again.
- [ ] Panic from the phone (Emergency Mute) and from the laptop.
- [ ] Zoom test call with Share sound: the other side hears it.
- [ ] Laptop Demo works as the fallback.

---

## H. Hosting and reopening

### Zoom setup

1. Open the hosted Motion Score page on the laptop.
2. Scan the QR code that appears and open the link on the phone.
3. On the phone, tap **Enable Sensors** → **Allow**.
4. Hold the phone comfortably and still while it calibrates automatically.
5. Press **▶ Start Audio** on the laptop and **Arm** (laptop or phone).
6. Test the sound at a low Master Volume.
7. In Zoom: **Share Screen** → the browser window.
8. Turn on **Share sound** in Zoom's share options.
9. Keep the phone page open and unlocked.
10. Press **🖥 Presentation Mode**.

You don't need to share the phone screen, phone audio, or use the webcam. Use headphones on the laptop to avoid echo. A hosted website alone does not guarantee pairing: test on the actual network beforehand, and keep Laptop Demo ready.

### Local commands

```bash
cd ~/Desktop/frequency-playground
npm install
npm run dev
```

Open http://localhost:5173/#/motion-score. On localhost, Laptop Demo works fully, but a phone **cannot** open `localhost` (it means "this device"), so the app shows no QR code there.

### Testing with a phone before the site is hosted

```bash
npm run dev:phone
```

This serves the app over HTTPS on your Wi-Fi with a self-signed certificate. On the **laptop**, open `https://<laptop-IP>:5174/#/motion-score` (the terminal prints the "Network" address; accept the browser's certificate warning). The QR code then points the phone to the same address; accept the warning on the phone too ("Show details → visit this website" on iPhone, "Advanced → Proceed" on Android). Both devices must be on the same network, and the pairing still needs internet for 0.peerjs.com.

### GitHub Pages

See README → "Deploy to GitHub Pages". Once deployed, the pages are:

- Laptop: `https://<user>.github.io/<repo>/#/motion-score`
- Phone (made automatically by the QR code): `https://<user>.github.io/<repo>/#/controller?session=…&code=…`
- Project 1: `https://<user>.github.io/<repo>/#/frequency`

**Verified hosted URL:** https://aceyq.github.io/sound-lab/#/motion-score (Project 1: https://aceyq.github.io/sound-lab/#/frequency). Repository: https://github.com/aceyq/sound-lab. Every push to `main` redeploys automatically.

### Phone pairing without the QR code

Open `https://<user>.github.io/<repo>/#/controller` on the phone and type the **Session ID** and **Code** shown on the laptop.


---

# Frequency Playground: Presentation Notes

## Before you present

1. Run `npm run dev` and open http://localhost:5173/ in Chrome.
2. Share the browser window (or tab) in Zoom and tick **Share sound** (in Zoom: Share screen → "Share sound" checkbox). Without it, the audience sees the plots but hears nothing.
3. Press **Reset**, then turn on **Presentation Mode** (top right). It enlarges text and hides secondary settings.
4. Set Master Volume to around 15–20%. Press Play once yourself to check the level, then Stop.
5. Laptop speakers barely reproduce 100 Hz. Use headphones to listen, and rely on Zoom's shared sound for the audience.

## 2–3 minute demonstration script

**0:00. What it is (15 s).**
"This app builds a sound by adding sine waves. Each row in this table is one sine wave with a frequency I type and an amplitude from 0 to 1. The formula is x of t equals the sum of A sin 2π f t, and each row is one term."

**0:15. Pure tone (30 s).** Press **Play**.
"This is one sine at 220 Hz. On the waveform I see about 4 cycles in 20 milliseconds, because 220 cycles per second times 0.02 seconds is 4.4. The spectrum is a real FFT measurement, and it shows one peak at 220, right on the dashed line for what I typed." Type **440** and press Enter. "The pitch goes up an octave, twice as many cycles fit in the window, and the peak moves to 440."

**0:45. Zoom changes only the view (15 s).** Click **1 s**, then **20 ms**.
"Zooming changes how much of the signal we see. It does not change its frequency or playback speed. At 1 second the cycles are too dense to draw, so the plot becomes a band, and the app says so."

**1:00. A frequency and its multiples (30 s).** Click **B. Harmonic Family**.
"100, 200, 300, 400, 500 Hz, all multiples of 100. The waveform is no longer a sine, but it repeats every 10 ms, which is one period of the base frequency. The spectrum shows five evenly spaced peaks. That is the Fourier transform at work: it takes the combined signal and separates it back into its ingredients."

**1:30. Non-harmonic and random (25 s).** Click **C. Non-harmonic Mixture**, then **E. Randomize**.
"These frequencies are not multiples of one base, so in 20 or 100 ms there is no obvious repeat, and it sounds less like one note. The mixture panel says it only repeats every 1 second. Randomize changes the actual ingredients, and the measured peaks follow the new numbers in the table."

**1:55. Beats (25 s).** Click **D. Close Frequencies / Beats**, then **Switch waveform to 1 s**.
"220 and 224 Hz. Listen to the wah-wah: about 4 pulses per second, the difference between them. On the 1 s waveform the band pinches 4 times. The spectrum with an FFT size of 8192 shows only one peak, because its bins are about 5.4 Hz wide and these tones are 4 Hz apart." (Optional: set FFT size to 32768 and show two peaks appear.)

**2:20. Volume vs. amplitude (20 s).** Load **B** again. Move **Master Volume** up, then down.
"Master Volume only changes what we hear. The plots don't move because they show the signal before Master Volume." Change **C1 amplitude** to 0.2. "Changing one component changes the recipe. The waveform shape changes, the 100 Hz peak drops, and the normalization factor goes up."

**2:40. Close.** Press **Stop**. "The spectrum now says Frozen, because it shows the last real measurement. Every experiment is written up below the plots with what to listen for and what to look at."

## Every control in plain language

| Control | What it does |
| --- | --- |
| **Play / Stop** | Starts the sound built from the table, or fades it out. Space bar also toggles it when you are not typing in a box. |
| **Status pill** | Shows Playing, Stopped, or that the browser blocked audio. |
| **Master Volume** | Multiplies what you hear (18% means × 0.18). It does not change any plot. |
| **Normalization factor** | The one number the whole mixture is multiplied by so it cannot clip. It equals 1 ÷ (sum of active amplitudes) when that sum is above 1, and 1 otherwise. It keeps the balance between components unchanged. |
| **Frequency (Hz) box** | Cycles per second for this row. Any value from 20 to 10,000 Hz, decimals allowed, and always below Nyquist. Press Enter to apply. Invalid input shows a message, and the last valid value keeps playing. |
| **Amplitude (0–1) box / slider** | This row's wave height. It applies as you type. 0.5 is half the wave height of 1, not "half as loud". |
| **On** | Mutes or unmutes the row without deleting it. |
| **×** | Removes the row. |
| **+ Add Component** | Adds a row (starts at 440 Hz, 0.5; type your own). Maximum 16. |
| **About this mixture** | Lowest active frequency, the common base (if there is one at or above 20 Hz) and how often the combined waveform repeats. |
| **Presets A–D** | Replace the table with a ready-made example you can then edit. |
| **E. Randomize** | Replaces the table with 3–6 random frequencies (150–1200 Hz). This changes the actual sound, not only the picture. |
| **Harmonic Builder** | Generates base × 1, 2, 3, … with amplitudes 1, 1/2, 1/3, …. Replace table or Add to table. The rows stay editable. |
| **What changed?** | Lists each concrete change, for example "C1 frequency: 220 Hz → 440 Hz" or "display only". |
| **Time window (5 ms … 5 s, Custom)** | How much time the waveform shows. Display only. |
| **Vertical scale** | How tall the waveform's amplitude axis is. Display only. |
| **Show individual components** | Draws each row's sine in its color under the white total. Hidden above 100 ms for clarity. |
| **Expand** | Opens one plot large. Esc or Close returns. |
| **From / to Hz, Auto-fit** | The frequency range shown in the spectrum and spectrogram. |
| **Frequency axis: Linear / Logarithmic** | Linear gives equal space per Hz. Log gives equal space per doubling, which is closer to how pitch is heard. |
| **FFT size** | How many samples each measurement uses. A larger size gives finer frequency bins but slower reaction. Measurement only. |
| **Clear History** | Empties the spectrogram. |
| **Presentation Mode** | Bigger text and fewer secondary settings. |
| **Reset** | Stops the sound and restores one component at 220 Hz with amplitude 1, 18% volume, the 20 ms view, auto scales and FFT 8192. It also clears the spectrogram and the change log. |

## Guided experiments

Each one has a **Set up** button in the app.

1. **One sine wave.** Pure Tone, then change 220 to 440 Hz. Pitch rises, twice the cycles, and the peak moves.
   *Predict:* how many cycles of 110 Hz fit in 20 ms? *About 2.2.*
2. **A frequency and its multiples.** Harmonic Family. You hear one rich note, the shape repeats every 10 ms, and there are five evenly spaced peaks. Turn C1 off: the repeat stays at 10 ms (a "missing fundamental").
   *Predict:* does the repeat period change without 100 Hz? *No.*
3. **Not multiples.** 137, 281, 463, 719 Hz. No short repeat, uneven peaks, and it sounds bell-like or clangy. The exact repeat is every 1 s.
   *Predict:* does changing 281 to 274 make it harmonic? *No, 463 and 719 still aren't multiples of 137.*
4. **Beats.** 220 + 224 Hz in the 1 s view. You hear about 4 pulses per second and the envelope pinches 4 times. At FFT 8192 there is one merged peak; at 32768 there are usually two.
   *Predict:* beats per second with 220 and 226? *6.*
5. **Random frequencies.** The peaks land on whatever the table lists. There is usually no common base at or above 20 Hz.
6. **Master Volume vs. one component amplitude.** Volume changes only loudness; the plots stay unchanged. Changing C1 amplitude from 1 to 0.2 changes the shape and the spectrum, and normalization rises from 0.44 to 0.68.
   *Predict:* which change alters the waveform shape? *Only the component amplitude.*
7. **Zoom changes only the view.** Step through 5 ms … 5 s. The sound stays the same and the spectrum stays the same.
   *Predict:* cycles of 220 Hz in 100 ms? *22.*
8. **FFT resolution.** Beats at FFT 2048, 8192 and 32768. Bins shrink from about 23 Hz to about 1.4 Hz, and the peaks sharpen and separate.
   *Predict:* bin spacing at 48 kHz and FFT size 8192? *About 5.86 Hz.*

## Likely questions, short answers

- **What is a Fourier transform?** A way to rewrite a signal as a sum of sine waves. It tells you which frequencies are present and how strong each one is.
- **What is the FFT?** The fast algorithm computers use to do that on a short block of sampled audio. Here the blocks are 2048–32768 samples.
- **Why isn't the spectrum peak a perfect thin line?** The FFT sees only a short, windowed block, so energy spreads into neighbouring bins. Resolution is the sample rate ÷ FFT size.
- **What's the base (fundamental) frequency?** For a harmonic family, it is the f₀ whose multiples make up the sound. It sets the spacing between harmonics and usually the pitch. The lowest row in an arbitrary mixture is not automatically a fundamental, and a harmonic family can be missing its base (200, 300, 400 Hz has base 100 Hz).
- **Do non-harmonic or random mixtures ever repeat?** With these typed values they do, but only after a much longer time. 137/281/463/719 repeats every 1 s. Over a 20–100 ms window you see no obvious repeat.
- **Why do 220 and 224 Hz "beat"?** They drift in and out of step. In step they add and it gets loud; opposite they cancel and it gets soft. That happens 4 times a second, their difference.
- **Is amplitude 0.5 half as loud?** No. It is half the wave height. Perceived loudness is roughly logarithmic and depends on frequency and the listener.
- **What does normalization do?** It multiplies the whole mixture by one number so the peak stays within ±1 and doesn't clip. The relative balance is unchanged.
- **Why don't the plots change with Master Volume?** By design, all three plots show the signal before Master Volume, so you can see the recipe independent of listening level.
- **Is the waveform measured or calculated?** Calculated from the table, using the same formula and phase the audio uses. That is why it is visible before Play. The spectrum and spectrogram are real measurements of the audio.
- **Why can't I type 30,000 Hz?** Digital audio cannot represent frequencies at or above half the sample rate (Nyquist). The app also caps at 10 kHz for comfort.
- **What is clipping?** When a signal exceeds the maximum level, its peaks get cut off. That sounds harsh and adds frequencies that weren't in the recipe.

## Known limitations (say these honestly if asked)

- Phase alignment is accurate to about one audio sample. A component added or changed mid-playback restarts aligned with the formula, with a short crossfade.
- FFT resolution limits separation of close frequencies, and dB values are relative, not calibrated loudness.
- The app does not judge how anything sounds. The "What changed?" panel reports only numbers.
- Laptop speakers reproduce low frequencies (around 100 Hz) poorly.

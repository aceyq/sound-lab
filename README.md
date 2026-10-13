# Sound & Signals Lab: Frequency Playground and Motion Score

Two educational sound projects for DSC 180A. **Project 1, Frequency Playground:** Type frequencies and amplitudes, hear the combined sound, and see it three ways: as a waveform, as a live FFT spectrum, and as a spectrogram.

The sound is built by additive synthesis:

```
x(t) = Σ Aᵢ · sin(2π fᵢ t)
```

Every row of the table is one term with its own frequency fᵢ and amplitude Aᵢ. Unlike a harmonic-only synthesizer, the frequencies do **not** have to be multiples of a base frequency.

**Project 2, Motion Score:** a phone's motion and orientation sensors control an instrument on the laptop. Tilt changes pitch, movement intensity changes harmonic richness, and sharp movements trigger notes in Accents mode. The phone opens a lightweight Controller page (via QR code) and streams sensor values to the laptop over WebRTC (PeerJS). See [Motion Score](#motion-score-project-2) below and `PRESENTATION_NOTES.md`.

## Run it locally

You need Node.js 18 or newer.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173/** in Chrome, Edge, Firefox or Safari and press **Play**. Turn your volume down before the first Play; the default Master Volume is 18%.

Motion Score is at **http://localhost:5173/#/motion-score**. On `localhost`, Laptop Demo works fully, but a phone cannot open your laptop's `localhost`, so no QR code is shown. To pair a real phone, use the hosted HTTPS site, or `npm run dev:phone` (below).

Other commands:

| Command | What it does |
| --- | --- |
| `npm run dev:phone` | Dev server over HTTPS on your Wi-Fi (self-signed certificate) at `https://<laptop-IP>:5174/`, so a phone on the same network can open the controller page. Open the laptop page at that same address (not localhost) and accept the certificate warning on both devices. |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build at http://localhost:4173/ |
| `npm test` | Unit tests (Node's built-in test runner): Frequency Playground validation, normalization, repeat period and waveform; Motion Score message validation, gravity removal, jerk/accent detection, tilt and intensity mappings, calibration, Nyquist, pentatonic, and the safety rules (Panic latch, stale input, disconnect, rotation). |
| `node scripts/verify.mjs [url]` | Automated browser checks for Frequency Playground in headless Chromium against a running app. Needs Playwright (`npm i -D playwright`). Saves screenshots to `verification/`. |
| `node scripts/verify-motion.mjs [url]` | Motion Score end-to-end checks: a laptop page and a simulated phone page pair over the real PeerJS service; synthetic sensor events drive the audio. Covers mappings, accents, malformed messages, extra phones, wrong code, Panic, stale input, hidden phone, disconnect, permission denied, no sensors, Laptop Demo offline, and cleanup. Needs internet and Playwright. Synthetic events do not prove real phone hardware works. |

No backend, accounts, API keys, camera or microphone are used. Motion Score's pairing uses PeerJS's free public signaling server (`0.peerjs.com`); everything else is static files.

## Deploy to GitHub Pages

The build reads the sub-path from the `BASE_PATH` environment variable, so built asset URLs work at `https://<user>.github.io/<repo>/`:

```bash
BASE_PATH=/<repo-name>/ npm run build
```

Routing uses `#/frequency`, `#/motion-score` and `#/controller?session=…&code=…`, so no server rewrite rules are needed and every page works when its URL is opened directly. The phone link and QR code are generated from the page's real origin and base path, so they keep the `/<repo>/` sub-path. GitHub Pages is HTTPS, which phones require for motion sensors. GitHub Pages is static hosting only: there is no server of our own; pairing relies on the external PeerJS service.

**Status: deployed** at https://aceyq.github.io/sound-lab/ from https://github.com/aceyq/sound-lab (Motion Score: https://aceyq.github.io/sound-lab/#/motion-score). Every push to `main` redeploys. To update after editing: `git add . && git commit -m "…" && git push`.

How it was set up (for a fresh repository):

1. Create an empty repository on github.com, e.g. `sound-lab` (public, or private on a plan that allows Pages).
2. In Terminal:

   ```bash
   cd ~/Desktop/frequency-playground
   git init -b main
   git add .
   git commit -m "Sound & Signals Lab: Frequency Playground and Motion Score"
   git remote add origin https://github.com/<your-username>/sound-lab.git
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab and wait for "Deploy to GitHub Pages" to finish (re-run it if it ran before step 3).
5. Open `https://<your-username>.github.io/sound-lab/#/motion-score`.

`.github/workflows/deploy-pages.yml` installs with `npm ci` (using `package-lock.json`), runs the unit tests, builds with `BASE_PATH=/<repo-name>/` taken from the repository name, uploads `dist/` as the Pages artifact, and deploys. For a `<user>.github.io` repository, change `BASE_PATH` in the workflow to `/`. `.gitignore` excludes `node_modules/`, `dist/` and `verification/` (screenshots); no sensor data is ever stored.

## How Frequency Playground works

| Part | File | Notes |
| --- | --- | --- |
| Page router | `src/main.js` | Hash routes with query parameters. Unmounts the current page before mounting the next one: leaving either project stops its sound, closes its AudioContext, cancels its loops and (Motion Score) closes the phone connection. |
| Component validation, normalization, common base | `src/pages/frequency/state.js` | Pure functions, unit-tested. |
| Audio engine | `src/pages/frequency/audio.js` | One sine `OscillatorNode` and `GainNode` per row, then a shared normalization gain. An `AnalyserNode` reads the signal **after normalization and before Master Volume**. Master Volume then scales what you hear. |
| Waveform | `src/pages/frequency/waveform.js` | Calculated from the table with the same formula as the audio. It works before you press Play. Dense sampling plus min/max per pixel column prevents aliasing at long windows. |
| Spectrum | `src/pages/frequency/spectrum.js` | Real FFT magnitudes from the analyser, with peak detection. Dashed markers show the expected frequencies. |
| Spectrogram | `src/pages/frequency/spectrogram.js` | Successive snapshots from the same analyser. One column per 25 ms of playing time, which is measured from the audio clock rather than counted in animation frames. Keeps 10 s of history. |
| Text content | `src/pages/frequency/content.js` | Presets, guided experiments, glossary. |

Design choices worth knowing:

- **Normalization.** The factor is 1 ÷ (sum of active amplitudes) when that sum is above 1, and 1 otherwise. The peak of the mixture can never exceed that sum, so this rules out clipping. Every component gets the same factor, so their ratios stay the same.
- **Phase.** All oscillators start at the same audio-clock instant t₀ with phase 0, which matches the formula the waveform plot uses. A component that is added, or whose frequency changes during playback, gets a new oscillator. That oscillator starts a whole number of its own periods after t₀, so its phase still lines up with the formula. The old one crossfades out over about 20 ms.
- **Smoothness.** Gain and volume changes ramp smoothly (15–20 ms time constant), and Play and Stop fade over 30 ms. The engine refuses to start twice. Stopped oscillators disconnect themselves when they end.

## Frequency Playground known limitations

- **Phase alignment is approximate** at the level of single audio samples. Browsers schedule start times to roughly one sample (about 0.02 ms at 48 kHz). For high frequencies that can shift a component's phase slightly, which changes the exact waveform shape a little but not the spectrum peaks. The waveform plot is a calculation from the table. It is not a live oscilloscope trace of the speaker output.
- **FFT resolution is limited.** Bin spacing is the sample rate ÷ FFT size, about 5.4–5.9 Hz at the default 8192. Components closer than about 3 bins can merge into one peak, and every peak spreads into neighbouring bins (Blackman window). Measured peak heights in dB depend on the browser's windowing and are relative, not calibrated loudness.
- **Changing a frequency during playback** crossfades over about 20–70 ms, which can produce a brief soft click or blur in the spectrogram. Loading a preset replaces every oscillator at once.
- **Perceived loudness, pitch and timbre are not measured.** The app reports numbers, such as frequencies, amplitudes and normalization, but not how something sounds. That depends on the listener, the speakers and the volume.
- **The frequency range is limited** to 20–10,000 Hz, and always below the device's Nyquist frequency (half its sample rate, shown in the app). Laptop speakers reproduce frequencies below about 150 Hz poorly, so use headphones for the 100 Hz examples.
- **The spectrogram advances only while sound is playing.** White vertical lines mark Stop and Play. If the browser tab is hidden, the missing time shows as dark gray "no data" columns.

## Motion Score (Project 2)

| Part | File | Notes |
| --- | --- | --- |
| Laptop Performance page | `src/pages/motion-score/index.js` | Setup checklist, Play area with inline ⓘ explanations and ? buttons, diagnostics, Laptop Demo, Presentation Mode, spotlight Demo Guide (`src/lib/tour.js`). A 50 Hz control loop applies the instrument to the audio; drawing runs on animation frames. |
| Phone Controller page | `src/pages/motion-score/controller.js` | Enable Sensors (feature-detects `requestPermission` and calls both in the same tap), Calibrate, Arm/Disarm, Emergency Mute, Wake Lock where available. Sends a sample only when new sensor readings arrived, ≈25 per second. |
| Connection | `src/pages/motion-score/connection.js` | PeerJS 1.5.5. Laptop listens on a random session ID; phone sends a `hello` with the 6-character pairing code; one phone at a time; 12 s / 15 s timeouts; 1 s heartbeats, 4 s silence = lost; outgoing messages are dropped rather than queued when the channel backs up. ICE: PeerJS defaults (Google STUN + PeerJS public TURN); no TURN server of our own. |
| Message validation | `src/pages/motion-score/protocol.js` | Every incoming message is type- and range-checked; unknown fields are dropped; malformed messages are counted and ignored. |
| Sensor processing (phone) | `src/pages/motion-score/sensors.js` | Gravity-free acceleration (or gravity estimated with a 0.5 s low-pass filter), magnitude smoothed over 0.12 s; jerk (m/s³) peak per message; tilt = `beta`, wrapped to ±180°. Glitches above 100 m/s² are ignored; gaps over 0.25 s reset the filters. |
| Mappings | `src/pages/motion-score/mapping.js` | Tilt ±35° → 110–880 Hz (log), A minor pentatonic with hysteresis, intensity → 1–12 components with hysteresis, accent detector (threshold, half-threshold re-arm, 300 ms cooldown, reset on gaps), calibration (circular mean, noise percentile). |
| Safety rules | `src/pages/motion-score/instrument.js` | Sound only when audio is on, not panicked, armed, input fresh (≤ 0.5 s, laptop clock), phone connected and visible. 3 s without data, disconnect, hidden phone, rotation or source switch → disarm. Panic latches until Start Audio. |
| Audio | `src/pages/motion-score/synth.js` | One `PeriodicWave` oscillator per voice (components 1…N, amplitudes (1/n)/Σ, sine phase 0, Nyquist excluded); two voices crossfade in 40 ms when N changes. Expression gain → Master Volume → Mute → `AnalyserNode` (measurement point) → output. Accents: 15 ms attack, decay forced to 0 at 450 ms, retrigger. |
| Visuals | `src/pages/motion-score/viz.js` | Movement Score (10 s, laptop-time axis). The spectrogram and spectrum reuse Project 1's views. |

**Verified automatically** (`npm test`, `node scripts/verify-motion.mjs`, `node scripts/verify.mjs`): see the final report in the project thread. **Not verified:** a real phone's sensors and browser, listening tests, Zoom. Use the manual checklist in `PRESENTATION_NOTES.md`.

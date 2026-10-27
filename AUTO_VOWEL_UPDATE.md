# Automatic vowel synthesis (assignment 3)

> “Find an automatic way of synthesizing your vowels. That means finding the fundamental frequency and the harmonics and playing stuff back.”

This update adds an **Automatic vowel synthesis** section to the Vowel Lab in Frequency Playground. It sits between stage 2 (“Match its fundamental”) and stage 3 (“Shape its harmonics”). Motion Score was not changed.

The app now does three things by itself. It takes one steady section of a saved recording, estimates the **fundamental** (f0) and the **strengths of the harmonics**, and plays a *new* sound built from sine waves with those values. It never replays, loops or pitch-shifts the recording. Your manual experiments are left exactly as they were.

---

## 1. The ideas in plain language

**Terms used below**

- **Fundamental (f0):** how many times per second the voice’s wave shape repeats. You hear it as the pitch.
- **Harmonic n:** a sine component at exactly n × f0. A sung vowel is mostly a sum of harmonics.
- **Period:** the time of one repetition, which is 1 / f0.
- **Sample rate:** how many numbers per second the recording stores (often 48,000 or 44,100).
- **Nyquist frequency:** half the sample rate. It is the highest frequency a recording can represent.
- **Frame:** a short slice of the recording (tens of milliseconds) that is analyzed on its own.
- **FFT (Fast Fourier Transform):** an efficient way to compute a spectrum. It shows how much of each frequency a frame contains, at evenly spaced frequency points (“bins”).
- **Window:** a smooth fade-in/fade-out applied to a frame before the FFT. Without it, cutting the frame abruptly smears energy into nearby frequencies (“leakage”).
- **Formant:** a resonance of the vocal tract (throat, mouth, lips). It boosts the harmonics that fall near it. Formants are what make “oo” different from “ee”.

### 1.1 Estimating the fundamental automatically

A steady sung vowel repeats nearly the same wave shape over and over. **Periodicity methods** compare the signal with a copy of itself shifted by some time lag. When the shift equals one period, the two line up and the difference is small.

| Approach | Idea | Notes |
|---|---|---|
| **Autocorrelation** | Multiply the signal with a shifted copy and find the lag with the biggest match. | Classic. Refined in Praat by [Boersma (1993)](https://www.fon.hum.uva.nl/paul/papers/Proceedings_1993.pdf). Can choose 2 × the period (an octave too low). |
| **YIN** ✅ *implemented* | Use the *difference* between the signal and its shifted copy, normalize it, and take the **first** lag whose difference is below a threshold. Refine between samples with a parabola. | [de Cheveigné & Kawahara (2002), JASA 111(4)](https://doi.org/10.1121/1.1458024) ([PDF](https://cagnazzo.wp.imt.fr/files/2013/05/2002_JASA_YIN.pdf)). Taking the first good dip avoids most octave errors, and it is simple enough to implement and explain. |
| pYIN | Probabilistic YIN: several candidates per frame, then the most likely path through time. | Mauch & Dixon (2014), ICASSP, [doi:10.1109/ICASSP.2014.6853678](https://doi.org/10.1109/ICASSP.2014.6853678). More robust over a whole melody, but more machinery than one steady section needs. |
| Cepstrum | Take the spectrum of the log-spectrum. Evenly spaced harmonics become one peak at the period. | [Noll (1967), JASA 41(2)](https://doi.org/10.1121/1.1910339). Works on spectra, and is sensitive to noise and to high voices with few harmonics. |
| Tallest spectrum peak ❌ | Take the strongest peak as f0. | **Not used.** In vowels, harmonic 2 or 3 is often louder than harmonic 1 because it sits near a formant. |

### 1.2 Measuring harmonic strengths with Fourier analysis

Once f0 is known, the harmonics should be at f0, 2·f0, 3·f0, and so on. For each frame:

1. Apply a **Hann window** to reduce leakage ([Harris (1978), Proc. IEEE 66(1)](https://doi.org/10.1109/PROC.1978.10837)).
2. Compute an FFT, **zero-padded** to 4 × the frame length so the frequency points are closer together.
3. Near each n × f0, take the highest point and refine its frequency and height with **quadratic interpolation**: fit a parabola through the top three points. A harmonic usually falls *between* FFT points, and this recovers the level that would otherwise be lost ([J. O. Smith, *Spectral Audio Signal Processing*, CCRMA](https://ccrma.stanford.edu/~jos/sasp/Quadratic_Interpolation_Spectral_Peaks.html)).

This is the analysis half of a **sinusoidal model**: describe a sound as a sum of sines with measured frequencies and amplitudes (McAulay & Quatieri (1986), IEEE TASSP 34(4), [doi:10.1109/TASSP.1986.1164910](https://doi.org/10.1109/TASSP.1986.1164910); Serra & Smith (1990), *Spectral Modeling Synthesis*, Computer Music Journal 14(4)).

### 1.3 Adding measured harmonics vs. a source shaped by filters

**Additive resynthesis** ✅ *implemented.* Play one sine wave per harmonic at n × f0, with each measured amplitude. It is exactly what the Vowel Lab sliders already do. It matches the spectrum *at this one pitch*.

**Source-filter synthesis** *(considered, not implemented).* The voice is modelled as a **source** (the vocal folds’ buzz, rich in harmonics) passed through a **filter** (the vocal tract, whose resonances are the formants). The filter is described by a few formant frequencies and bandwidths, or by **LPC** (linear prediction), which fits an all-pole filter to the spectrum’s envelope. Sources: Fant (1960), *Acoustic Theory of Speech Production*; [Klatt (1980), JASA 67(3)](https://doi.org/10.1121/1.383940); [Atal & Hanauer (1971), JASA 50(2B)](https://doi.org/10.1121/1.1912679).

The main difference shows up when the pitch changes:

- With additive synthesis, “harmonic 3 = 0.4” moves up with the pitch, so the strong frequencies move and the vowel can drift. You saw this in assignment 2, comparison A.
- With source-filter synthesis, the filter stays at the same *frequencies*. Any pitch fed through it keeps energy near the same formants, which is closer to how a singer keeps the same mouth shape.

The source-filter approach is harder to estimate reliably, especially at sung pitches above ~250 Hz. The harmonics are then far apart, so the spectral envelope is sampled at only a few points, and LPC tends to latch onto individual harmonics.

### 1.4 Main limitations of all of these

- They assume **one steady pitch** in the section. Vibrato, scoops and wobble get averaged away.
- The additive synthesis has **no breath noise, no jitter or shimmer** (tiny cycle-to-cycle changes in pitch and loudness), and **no original phases**. So it tends to sound “cleaner” and more electronic than a voice.
- **Octave errors** remain possible with any pitch tracker, which is why the app lets you correct f0.
- **Noise, room echo, quiet or clipped recordings** make weak harmonics unreliable.
- Measured strengths describe **this one recording at this one pitch**. They are not a general model of “your oo”.

---

## 2. What was implemented

### Workflow in the app

1. Open an experiment that has a recording (or choose one in stage 1) and pick a steady segment in stage 2.
2. In **Automatic vowel synthesis**, press **🔍 Analyze vowel**.
3. The app shows:
   - the **Estimated fundamental (Hz)**, labelled “✓ automatic estimate”;
   - a status: ✓ usable / ⚠ with warnings / ✗ no reliable result, with plain-language reasons;
   - reliability facts: periodic frames, pitch spread, median aperiodicity, level, harmonics kept, strongest harmonic;
   - a table of every harmonic: frequency, measured level, amplitude used, in how many frames it stood out, and (for comparison only) the sliders of the experiment that is open;
   - the **original and synthesized spectra on one plot**.
4. **▶ Play Original**, **▶ Play Synthesized**, **⇄ Original → Synthesized**, **■ Stop**. Volume and “Match peak levels” are shared with the top bar.
5. **💾 Save automatic result** adds a **new** experiment labelled “… · automatic”, for example “oo — lower pitch · automatic”. **⬇ Download synthesized WAV** (`oo_lower_auto_synthesized.wav`) and **⬇ Download analysis/settings** (`oo_lower_auto_analysis.json`) work before or after saving.
6. **Manual correction:** type another value into *Estimated fundamental (Hz)* and press **Re-measure harmonics at this fundamental**. The result is then labelled **“✎ manual correction”** everywhere: in the app, in the saved experiment, and in the JSON. **Back to the automatic estimate** undoes it.

### The algorithm and its settings

All of this lives in `src/pages/frequency/auto-vowel.js`. It has no DOM and no Web Audio, so it is unit-tested directly.

| Step | What it does | Setting and why |
|---|---|---|
| Frames | Spreads frames evenly across the section | One every 20 ms, at most 60 frames. Many frames mean one odd moment cannot decide the result. |
| Silence check | Section RMS level | Below −60 dBFS → “silent”, no result. |
| YIN per frame | Difference function, cumulative-mean normalization, first dip below the threshold, parabolic interpolation | Search range 50–1000 Hz (the same range the app accepts for a typed f0). Threshold 0.15. Window = longest period, so a frame is 2 × 20 ms = 40 ms. Lags are counted in samples **at the recording’s own sample rate**, so 44.1 kHz and 48 kHz recordings both work. |
| Periodic frames | A frame counts if its YIN aperiodicity is < 0.3 | Fewer than 50 % periodic frames → “not periodic enough”, with no f0 shown. |
| f0 | **Median** of the periodic frames | Robust to a few wrong frames. Also reports the spread (middle 50 % of frames, in cents) and how many frames were an octave off. |
| Harmonic frames | Hann window, ≥ 8 periods and ≥ 40 ms long, FFT zero-padded to ≥ 4 × that length | 8 periods keep each harmonic’s peak narrower than half the spacing between harmonics, so neighbours don’t merge. |
| Harmonic peaks | Highest point within ±0.3 × f0 of n × f0, using **that frame’s own f0**, refined by quadratic interpolation | Using each frame’s f0 lets high harmonics be found even if the pitch drifts slightly. A maximum on the edge of the search band is a slope, not a peak, and is rejected. |
| Noise test | Peak must be ≥ 10 dB above the **local floor** (the median level between harmonics) | It must pass in ≥ 50 % of frames. A random noise peak rarely passes 10 dB, and almost never does so consistently. |
| Strength | Median amplitude over the frames where it passed | Then scaled so the strongest harmonic = 1. Anything below −50 dB re the strongest becomes 0 (the window’s own leakage is around −60 dB). |
| Limits | Only n ≤ 48 (the app’s maximum) and n × f0 + f0/2 < Nyquist | The result is a **complete array of 48 amplitudes, all zero except the measured ones**, so no leftover slider value can stay active. |
| Playback | The existing synthesizer: x(t) = g · Σ Aₙ sin(2π n f0 t) | g puts the peak at 0.5 (−6 dB). One shared factor, so the ratios between harmonics are unchanged. |

**Reliability numbers are not probabilities.**

- *Aperiodicity* is YIN’s normalized difference at the chosen period. 0 means the wave repeats exactly; around 1 means it does not repeat.
- *Pitch spread* is in cents (100 cents = one semitone).
- *Periodic frames* is a count.

Together they describe how steady and repeating the section was. None is a “% chance of being right”.

### Keeping manual work safe

- The analysis result is kept separately and is **never written into the open experiment’s sliders**.
- **Save automatic result** *appends* a new experiment. It does not replace or edit any saved one, and the open experiment stays open.
- While the automatic synthesis plays, moving a manual slider does **not** change what you hear, and the reverse holds too.
- Older saved experiments load unchanged and are treated as “manual”. Two fields were added to each experiment: `origin` (`manual` / `auto`) and `autoAnalysis` (a short summary).
- The analysis only reads the recording. It never edits or deletes recordings.

### Files changed

| File | Change |
|---|---|
| `src/pages/frequency/auto-vowel.js` | **new** — YIN, harmonic measurement, analysis summary, `autoExperiment()` |
| `src/pages/frequency/vowel-lab.js` | new section, its playback/save/download, separate playback ownership, guide text updated |
| `src/pages/frequency/vowel-model.js` | experiments carry `origin` and `autoAnalysis`; labels/file names get “automatic” / `_auto`; settings JSON includes the analysis |
| `src/pages/frequency/vowel-audio.js` | debug info reports the recipe being played (used by the checks) |
| `src/style.css` | styles for the new section |
| `test/auto-vowel.test.js` | **new** — 13 tests |
| `scripts/verify-auto-vowel.mjs` | **new** — 26 browser checks |
| `scripts/verify-vowel.mjs` | expects 6 `.vl-stage` sections instead of 5 |

---

## 3. Test results

### What was actually run

| Check | Where | Result |
|---|---|---|
| `npm test` (all unit tests: 83 existing + 13 new) | cloud copy | **96 / 96 pass** |
| `npm run build` | cloud copy | builds |
| `node scripts/verify-auto-vowel.mjs` (Chromium, simulated WAVs) | cloud copy | **26 / 26 pass** |
| `verify-vowel.mjs` / `verify-mic.mjs` / `verify.mjs` (regression) | cloud copy | 49/49, 45/45, 36/36 pass |
| `npm test` on Ace’s Mac | Mac | **96 / 96 pass** |
| `npm run build` on Ace’s Mac (vite 5.4.21) | Mac | **succeeds** (142 modules, JS 451.9 kB / 148.5 kB gzip) |

### Synthetic signals with known answers (unit tests)

| Input | Result |
|---|---|
| 220 Hz, strengths 1 / 0.5 / 0.3 / 0.2 / 0.1, light noise | f0 within 0.2 Hz. Every strength within 0.5 dB. Harmonics 6–48 = 0. |
| 243.7 Hz at 44.1 kHz (between FFT points and between samples) | f0 within 0.15 Hz. Strengths within 0.3 dB. |
| **Harmonic 2 five times stronger than harmonic 1** (180 Hz) | f0 = 180 Hz, *not* 360. Strongest = harmonic 2. Harmonic 1 measured as 0.2. |
| Harmonic 3 strongest (150 Hz) | f0 = 150 Hz. |
| Vibrato ±10 cents at 5 Hz | f0 within 1.5 Hz. Harmonic 10 still found and within 1 dB. |
| 60 ms dropout + a click inside the section | f0 within 0.3 Hz. Harmonic 2 within 0.03. |
| Three harmonics + strong broadband noise | No noise peak above harmonic 3 accepted. |
| f0 600 Hz at 16 kHz / f0 100 Hz at 48 kHz | Nothing at or above Nyquist. Capped at 48 harmonics. |
| **Silence** | ✗ “silent”, f0 = none, no amplitudes. |
| **White noise** | ✗ “not periodic”, f0 = none. |
| Too-short section | ✗ “too short”. |
| Pitch jumping between 200 and 240 Hz | ⚠ “not steady” warning. |
| Manual correction to half the f0 | Labelled manual. Odd “harmonics” come out empty, as they should. |
| Normalization | Output peak 0.5. Harmonic ratios in the output equal the measured ones (±0.002). |
| **Saving** an automatic result next to a manual experiment with all sliders at 0.7 | New id, `origin: auto`, only harmonics 1–3 non-zero. Manual experiment byte-for-byte unchanged. |

### In the browser (simulated recording)

A 248 Hz vowel-*like* tone was imported as a WAV. It was built from a falling source spectrum shaped by resonances near 300 / 870 / 2240 Hz (textbook “oo” values), with ±0.3 % wobble, jitter and noise.

- f0 was estimated as **247.98 Hz**, with 48 / 48 periodic frames and a spread of 7 cents.
- Harmonics 1–4 came out **1, 0.21, 0.115, 0.065**. True values: **1, 0.210, 0.115, 0.065** (all within 0.1 dB).
- Ten harmonics were kept. Weaker ones (below −50 dB) were set to 0.
- A manual oo-style experiment (f0 247; 1, 0.1, 0.05, 0.01) stayed unchanged through the analysis, playback, saving and a page reload.
- Silence produced “✗ No reliable result … silent”, with play and save disabled.

Screenshots: `verification/auto-01-analyzed.png`, `verification/auto-02-silence.png`.

### What these tests do **not** show

- The simulated “vowel” is itself a sum of harmonics, so the additive method is *bound* to fit it well. Real voices are harder.
- **Nothing has been analyzed from your own recordings yet.** They are stored in your browser on your Mac and the cloud copy cannot see them.
- **Nobody has listened to the result.** Whether the automatic oo *sounds* like your oo is untested.

---

## 4. Test steps on your Mac (saved “oo” recording first)

1. In Terminal: `cd ~/Desktop/frequency-playground && npm run dev`, then open the printed address (usually http://localhost:5173/) **in the same browser you used before**. Your recordings live in that browser.
2. Click **1. Frequency Playground** → **🗣 Vowel Lab: harmonic sliders**.
3. In the **Experiment** dropdown at the top, choose your lower-pitch **oo** experiment (“oo — lower pitch”).
4. In **stage 2**, check that the shaded segment is the steady part you used. If you change it, the manual experiment shows “Unsaved changes”. That is fine: just don’t press Save on it.
5. Scroll to **⚙ Automatic vowel synthesis** and press **🔍 Analyze vowel**.
6. Write down the **Estimated fundamental**, the status line and the reliability facts. Compare f0 with your manual ~248 Hz.
7. Look at the harmonic table. Compare “Amplitude used” for harmonics 2–4 with your manual 0.1 / 0.05 / 0.01 (last column).
8. Press **⇄ Original → Synthesized** a few times. Then **▶ Play Synthesized** and **■ Stop**.
9. Look at the spectrum plot: do the cyan peaks sit on the orange peaks?
10. Press **💾 Save automatic result**. Check that the dropdown now also lists “oo — lower pitch · automatic” and that your manual oo is unchanged.
11. **⬇ Download synthesized WAV** and **⬇ Download analysis/settings**.
12. Repeat for **higher oo** (~300 Hz), then **ah** and **ee**.
13. Optional: try a bad section (the very start of a take, or a silent part) and see what message appears.
14. Optional: try **Open it in the sliders** on the automatic experiment, then compare with your manual one by ear.

Record what you hear (fill in):

| Recording | Manual f0 | Automatic f0 | Status | Harmonics 2–4 (auto) | Sounds like the vowel? | Notes |
|---|---|---|---|---|---|---|
| oo lower | ~248 | | | | | |
| oo higher | ~300 | | | | | |
| ah lower | ~248 | | | | | |
| ee lower | ~243 | | | | | |

---

## 5. How it compares with the alternatives

| | Implemented: YIN + FFT + additive | Autocorrelation / cepstrum | pYIN | Source-filter (formants / LPC) |
|---|---|---|---|---|
| f0 on one steady section | robust; first-dip rule avoids most octave errors | similar, more octave-error prone | slightly more robust, more complex | needs a separate f0 method anyway |
| Harmonic strengths | measured directly at n × f0 | — | — | envelope estimated; harmonics follow from it |
| Sound at the analyzed pitch | close to the measured spectrum, but no noise or phase | — | — | similar, can add breath noise |
| Changing pitch | strengths move with the harmonics (vowel can drift) | — | — | formants stay put (better) |
| Effort / explainability | low, every step visible in the app | low | medium | high |

The implemented method is the most direct answer to “find the fundamental and the harmonics and play them back”. A natural next step would be to fit a smooth envelope through the measured harmonic levels and reuse it at a new pitch, which is a simple source-filter idea.

---

## 6. Sources

- de Cheveigné, A., & Kawahara, H. (2002). YIN, a fundamental frequency estimator for speech and music. *JASA* 111(4), 1917–1930. https://doi.org/10.1121/1.1458024
- Boersma, P. (1993). Accurate short-term analysis of the fundamental frequency and the harmonics-to-noise ratio of a sampled sound. *IFA Proceedings* 17, 97–110. https://www.fon.hum.uva.nl/paul/papers/Proceedings_1993.pdf
- Mauch, M., & Dixon, S. (2014). pYIN: A fundamental frequency estimator using probabilistic threshold distributions. *ICASSP*. https://doi.org/10.1109/ICASSP.2014.6853678
- Noll, A. M. (1967). Cepstrum pitch determination. *JASA* 41(2), 293–309. https://doi.org/10.1121/1.1910339
- Harris, F. J. (1978). On the use of windows for harmonic analysis with the discrete Fourier transform. *Proc. IEEE* 66(1), 51–83. https://doi.org/10.1109/PROC.1978.10837
- Smith, J. O. *Spectral Audio Signal Processing*, “Quadratic Interpolation of Spectral Peaks”. CCRMA, Stanford. https://ccrma.stanford.edu/~jos/sasp/Quadratic_Interpolation_Spectral_Peaks.html
- McAulay, R., & Quatieri, T. (1986). Speech analysis/synthesis based on a sinusoidal representation. *IEEE TASSP* 34(4). https://doi.org/10.1109/TASSP.1986.1164910
- Serra, X., & Smith, J. O. (1990). Spectral Modeling Synthesis. *Computer Music Journal* 14(4), 12–24.
- Fant, G. (1960). *Acoustic Theory of Speech Production*. Mouton.
- Klatt, D. H. (1980). Software for a cascade/parallel formant synthesizer. *JASA* 67(3), 971–995. https://doi.org/10.1121/1.383940
- Atal, B. S., & Hanauer, S. L. (1971). Speech analysis and synthesis by linear prediction of the speech wave. *JASA* 50(2B), 637–655. https://doi.org/10.1121/1.1912679

The links were checked by search. The DOI pages themselves could not be opened from the cloud environment.

---

## 7. Guided tour: “How to use Vowel Lab”

The **❓ How to use Vowel Lab** button sits next to the Vowel Lab title. It starts a 24-step guided tour over the real page, built the same way as the Motion Score walkthrough.

Each step:
- scrolls to one real control (vertically, and sideways where needed);
- outlines it with a bright highlight and dims the rest of the page;
- shows a one- or two-sentence card beside it, not on top of it.

The tour covers, in order: the experiment selector, the vowel/pitch labels, the reference tone, recording, choosing a take, the steady section, the waveform, the spectrum, entering f0, the harmonic sliders, the reset options, the listen buttons, the spectrum comparison, and automatic synthesis (Analyze, the estimate, the table, playback, spectra, saving). It ends with saving, downloads, returning to an experiment, trying another pitch, and a wrap-up.

How it behaves:
- **Next / ← Back / ✕ Skip tour** and a “Step N of 24” counter on every step.
- **←/→** keys move between steps, and **Escape** closes. Focus goes back to the button that opened the tour.
- **❓ Explain this section** in the automatic section starts the tour at the Analyze vowel step.
- If a control isn’t there yet (no recording, or no analysis), the step highlights the button that makes it appear (Import a WAV / Analyze vowel) and shows a yellow note explaining what to do.
- The highlight and card follow page scrolling and window resizing. On a phone the card goes above or below the control.
- While the tour is open, the sticky header and listening bar scroll with the page so they cannot hide the highlighted control. They return to normal when it closes.
- The tour only scrolls and highlights. It never records, plays, moves a slider or saves. The page stays usable underneath, so you can try the highlighted control yourself.

Fixed along the way: on phone-sized screens, parts of the Vowel Lab (harmonic rows, the two-column stages) used to stretch wider than the screen. They now fit the width.

Files:
- `src/pages/frequency/vowel-tutorial.js` (the tour)
- `src/pages/frequency/vowel-lab.js` (wiring)
- `src/style.css`
- `test/vowel-tutorial.test.js` (steps point at real controls, short text, workflow order)
- `scripts/verify-tutorial.mjs` (24 browser checks at desktop and phone size, with and without a recording, including that stored data is unchanged)

`src/lib/tour.js` and Motion Score were not changed.

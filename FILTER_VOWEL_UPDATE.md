# Vowel filtering (assignment 4)

> 1. Incorporate a filter.
> 2. Recreate vowels by starting with the fundamental and all harmonics at maximum strength, then applying a filter.

This update adds a **🎚 Vowel filtering** section to Frequency Playground. It lives inside the Vowel Lab, between “Automatic vowel synthesis” and stage 3. You can also reach it with the **🎚 Vowel filtering** button in the Mode bar, or with **🎚 Go to Vowel filtering** at the top of Vowel Lab. Motion Score was not changed.

Published to GitHub Pages with the rest of the Frequency Playground (built and tested locally first).

> **Update (follow-up): a recording is now optional.** The section opens with three workflows. Only the third uses a recording. See §0 for the changes and steps.

---

## 0. Three workflows (follow-up update)

| Workflow | Source | Recording | What you can do |
|---|---|---|---|
| **1 · Explore vowel examples** (default) | Equal-strength harmonics: f0 you type, every amplitude 1 | none | Type f0, pick the component count, press Start. Click **Aa / Eh / Ee / Oh / Oo**, then **▶ Play** right under the buttons. Drag the filter. |
| **2 · Filter my own frequencies** | **My own frequencies:** rows of frequency + amplitude (up to 48), any values, harmonic or not | none | Add, edit, remove or switch off rows. Generate harmonics as a convenience (equal or 1/n amplitudes). **⧉ Load a copy of my Manual frequencies setup**. Apply the same filter and examples. Compare unfiltered and filtered. |
| **3 · Match a recording** | Equal-strength harmonics | yes | Everything from the first version: choose a take and a steady section, 🔍 Estimate f0, 🎯 Match filter to recording, Original → Filtered. |

What changed:
- **Vowel buttons are pronunciation labels.** They read **Aa** “father”, **Eh** “bed”, **Ee** “see”, **Oh** “go” and **Oo** “food”. Oh is explained as a *steady* “oh” without the closing “w” glide, like the o in Spanish “no”. The A/E/I/O/U letters are kept only as internal ids, so experiments saved earlier still open.
- **Choosing a vowel changes only the filter.** Your f0, harmonic count or own rows stay exactly as they were. The vowel no longer opens a new experiment. If you had an unsaved hand-shaped filter, it asks first.
- **Your own frequencies are never reset or changed.** The amplitudes you type are kept. The filter and the examples only change how much of each component comes through. Arbitrary rows are labelled **components**, not harmonics. The page explains that a filter cannot create missing harmonics, so one sine or a few scattered frequencies may not sound like a vowel.
- **Automatic fitting stays with the equal-strength harmonic source (workflow 3).** In workflow 2 the page says so instead of replacing your source.
- **Recording controls appear only in workflow 3:** the recording picker, the section, Play Original, Original → Filtered, the original’s peak match, the orange recording curve, Download original, and Match. Workflows 1 and 2 show the unfiltered and filtered spectra of the source only.
- **Audio:** the same filter graph now plays any component list. Each oscillator’s gain is that row’s amplitude: exactly 1 for equal-strength harmonics, your value for your own rows. The shared safety gain is 0.7 ÷ Σ amplitudes, the same for filtered and bypassed, so nothing clips.
- **Saving:** experiments now store the workflow, source type, every component (frequency, amplitude, on/off), f0 where it applies, the filter, and recording info if any. Switching workflow on a saved experiment starts a new unsaved copy, so the saved one is never rewritten. Filtered WAV and settings JSON (format version 2) export without any recording. Version-1 files and experiments saved before this update still open.
- **The tour has 15 steps and works with no recordings.** Steps for controls of another workflow point at that workflow’s tab and say so.

### 0.1 Exact steps

**Generate an Aa-like sound from a 200 Hz fundamental, without recording**
1. `npm run dev`, open the address it prints (usually http://localhost:5173/#/frequency), and click **🎚 Vowel filtering** in the Mode bar.
2. Make sure **1 · Explore vowel examples** is selected. It is the default.
3. In the f0 box type **200** and press Enter. Leave **Components** at **32**.
4. Optional: press **▶ Start with all harmonics at maximum** to hear the buzzy starting sound.
5. Under **Load vowel example**, click **Aa · “father”**, then **▶ Play**. Use **▶ Unfiltered** to compare and **■ Stop** to end.
6. Drag the numbered points in the filter chart (down = less of that region) and listen. Then **💾 Save filter experiment**, and download **⬇ Filtered synthesized WAV** / **⬇ Settings JSON** if you like.

**Enter your own frequency components and filter them**
1. Click **2 · Filter my own frequencies**. It starts with 8 example rows you can change.
2. Edit a row’s **Frequency** and **Amplitude (0–1)** and press Enter. Use **＋ Add component** and 🗑 to add or remove rows, and the checkbox to switch one off. You can also replace the rows with generated harmonics (Convenience: f0, count, equal or falling), or press **⧉ Load a copy of my Manual frequencies setup**.
3. Press **▶ Play Unfiltered**, then click a vowel (for example **Ee · “see”**) or drag the filter points, and press **▶ Play Filtered**. The purple dots on the filter chart show how much each of your components gets through.
4. **💾 Save filter experiment** and download the WAV/JSON. Your rows are saved exactly as typed.

**Return to recording-based filter matching**
1. Click **3 · Match a recording**. The recording controls appear.
2. Pick your take under **Recording** (record or import one in stage 1 if needed), and drag across its steady middle. Set the vowel label (for “oo”: **Oo /u/ as in “food”**).
3. Press **🔍 Estimate from the recording**, and check that the purple lines sit on the orange peaks; type a correction if not.
4. Press **🎯 Match filter to recording**, then **⇄ Original → Filtered**. Adjust by dragging, then **💾 Save filter experiment**.

### 0.2 Tests for this update (actual runs)
- `npm test`: **119 / 119 pass**. The 5 new tests cover these points:
  - Custom rows are kept exactly, and an example is a filter-only change.
  - The filter reduces each custom component by exactly its own gain (within 0.1 dB), and a switched-off row doesn’t sound.
  - The safety gain is 0.7 ÷ Σ amplitudes, with no clipping.
  - A custom-source settings round trip gives sample-identical audio.
  - Pre-update experiments open in the right workflow.
  - The labels are Aa/Eh/Ee/Oh/Oo.
- `node scripts/verify-filter-workflows.mjs` in Chromium, **starting from completely empty browser storage**: **31 / 31 pass**.
  - Workflow 1: f0 200 Hz plays with 32 oscillator gains of exactly 1. Aa changes only the filter and plays filtered at once. Dragging works and the drawn curve matches the live nodes. It saves and exports with no recording. In the WAV, each harmonic drops by the filter gain within 0.03 dB.
  - Workflow 2: typed rows, including a non-harmonic 1234.5 Hz, are played with gain = your amplitude. Ee and dragging leave every row unchanged. In the WAV, each component drops by exactly its filter gain (for example 200 Hz −9.3/−9.3 dB, 1234.5 Hz −52.4/−52.4 dB). The Manual copy works and Manual mode is unchanged. Generate fills 12 × 200 Hz.
  - Both experiments reload with identical sound, and only the filter-experiment storage key was written.
  - The tour completes all 15 steps with no recordings. At 390 px phone width there is no sideways scroll.
- `node scripts/verify-filter.mjs` (workflow 3 with a simulated “oo”): **57 / 57 pass**. Existing recording-based matching still works, and examples now change only the filter there too.
- Regression checks still pass: Vowel Lab 49/49, automatic 26/26, Vowel Lab tour 24/24, microphone 45/45, Manual frequencies 36/36. `npm run build` succeeds.

**Honest limits of this update.**
- **The vowel presets have not been evaluated by listening.** Nobody has listened to them yet, and no listening test of any kind was run. They are fitted to textbook formant averages (2.6–5.0 dB RMS from those smooth envelopes), which says nothing about how they *sound*.
- A filter can only reshape components that exist. A sparse or non-harmonic custom source may not sound like a vowel at all.
- Automatic fitting is not available for custom sources.
- Only Chromium was tested (not Safari, Firefox, or a real phone).

---

## 1. The idea in plain language

> The source starts with the fundamental and all active harmonics at equal strength. The filter reduces selected frequency regions, changing the balance of harmonics and the vowel-like character of the sound.

- **Fundamental (f0):** the base frequency, the lowest component, which you hear as the pitch.
- **Harmonics:** components at whole-number multiples of the fundamental (2 × f0, 3 × f0, …).
- **Filter:** something that changes the strength of frequency regions. Here it only *reduces* (0 dB means unchanged).
- **Formants:** broad resonant regions that the vocal tract (throat, mouth, lips) emphasizes, and that help tell vowels apart. A formant is a *region*. It is not an individual harmonic.

**How the source and the filter work together.** Your voice works roughly as source × filter. The vocal folds make a buzzy, harmonic-rich source. The shape of your throat and mouth then acts as a filter: harmonics in some regions (the formants) come through strongly, and others are damped. The app copies that idea in its simplest form. It starts with the most neutral buzz possible: the fundamental and every harmonic at exactly the same strength. It then lets you push whole frequency regions down. Nothing moves sideways. With f0 fixed, harmonic n stays at n × f0. Only the *heights* of the harmonics change. Because the filter can only reduce, a region becomes *more prominent* when the regions around it are turned down. That is how a flat buzz becomes something like “oo” (keep the low region and cut everything above ~1 kHz) or “ee” (keep a low peak and a high region near 2.5–3 kHz, and cut the middle).

---

## 2. What was built

| Part | What it does |
|---|---|
| **1. Recording to compare with** | Choose any recording made or imported in stage 1. Drag across its small waveform (or type From/To) to pick the steady section. **Use the Vowel Lab segment** copies the open experiment’s section. The vowel label is A / E / I / O / U / other, each with an example word. |
| **2. Fundamental and the all-maximum source** | f0 field with ±1/±0.1 nudges. **🔍 Estimate from the recording** uses the existing YIN estimator and is labelled “✓ automatic estimate”. A typed value is labelled “✎ typed by you” or “✎ manual correction (automatic was … Hz)”. A new experiment starts at a labelled *default* (200 Hz). It never silently reuses 248 or 300 Hz. Pick 4–48 components. **▶ Start with all harmonics at maximum** sets every amplitude to 1, bypasses the filter and plays the buzzy source. The page lists how many components are active and at which frequencies, and which are dropped at the Nyquist limit. |
| **3. Shape the filter** | **Filter ON / BYPASSED** toggle (settings are kept). **↺ Reset to flat**. An editable filter chart with **8 numbered draggable points**: left/right moves the region, down cuts it. Mouse, touch, and keyboard all work (1–8 selects a point, arrows move it, Shift moves it further). There is also a table of number fields (centre Hz, cut dB, width Q). Below the chart is a second chart of the spectra: recording (orange), filtered source (cyan) and unfiltered source (grey, optional). |
| **Load vowel example** | Approximate A, E, I, O, U starting filters built from published formant averages, with a choice of adult-women or adult-men averages. Each one opens as a new, unsaved, fully editable experiment. |
| **🎯 Match filter to recording** | Analyzes the selected section and fits the 8 filter points automatically. The result opens as a new, unsaved “fitted” experiment that shows its error. |
| **4. Listen and compare** | ▶ Play Original · ▶ Play Unfiltered · ▶ Play Filtered · ⇄ Original → Filtered · ■ Stop. A “Now playing: …” label always says which sound is on. There is a volume control, an option to match the original’s peak to the filtered sound, and an **optional, off-by-default makeup gain** (see §5). |
| **5. Save and download** | Saves filter experiments separately (own storage key), with notes. Downloads: **Filtered synthesized WAV**, **Settings JSON**, **Original recording (WAV)**. JSON import restores a filter experiment. A table lists the saved filter experiments. |
| **Help** | The sentence above is at the top of the section. There is a “What the words mean” glossary, a “How the filter and the automatic fit work” panel, and a 13-step **❓ Tour: vowel filtering** that uses the same spotlight tour as Vowel Lab. |

Your existing manual and automatic Vowel Lab experiments, your recordings, the harmonic sliders and the Manual frequencies mode are untouched. Section 7 has the checks that confirm this.

---

## 3. The filter: implementation and trade-offs

**Choice: a bank of real Web Audio filters, not a hand-drawn curve.**

```
osc(f0)  → gain 1 ┐
osc(2f0) → gain 1 ┼→ sum × g → fade ─┬→ dry ─────────────────────────────→ volume → speakers
…                 ┘                  └→ peaking 1 → … → peaking 8 → wet ┘
```

- Every oscillator has its own gain node set to exactly **1**. That is the “all harmonics at maximum” source, and the automated checks read those gains from the live audio graph.
- The 8 filters are browser `BiquadFilterNode`s of type **`peaking`** in series. Each has a centre frequency, a gain from **−40 to 0 dB (cut only, never a boost)** and a width Q (0.5–8). A flat filter (all 0 dB) is exactly “no change”.
- **The chart is the real filter.** It is calculated with the same coefficient formulas the Web Audio specification defines for `peaking` (the Audio EQ Cookbook). In the browser check, the drawn curve and the live nodes’ own `getFrequencyResponse` agree to within 0.0000 dB at 73 frequencies.
- **Smooth while dragging.** Centre, gain and Q glide over ~20 ms (`setTargetAtTime`), so the sound changes continuously without clicks.
- **Bypass** routes the source around the filter instead of through it. Both paths use the same gain g, crossfaded over 30 ms, and the two crossfade gains always add up to 1.
- **The WAV** is rendered in JavaScript with the same coefficients, in double precision. The source has 20 ms fades, the filter starts at rest like the live one, and 50 ms is added for the filter to ring out. The browser check renders the same graph in an `OfflineAudioContext` and finds the same samples, within 2.3 × 10⁻⁴ at a peak of 0.19.

**Why not a free-drawn curve?** A freely drawn curve would need an FIR/convolution filter. Replacing its impulse response on every drag step glitches unless it is carefully crossfaded, and the drawn line would be an idealisation of what the FIR really does. The biquad bank glides smoothly and is exactly what is plotted.

**Trade-offs:**
- 8 broad bands cannot make narrow peaks or follow every detail.
- Where points overlap, their cuts add up, so the green total line can sit *below* a point. The chart therefore draws the total, the selected point’s own band (dashed), and a dot for each harmonic at the gain it actually receives.
- Biquads also shift phase. That changes the wave *shape* but not which frequencies are present or how strong they are.

**Level handling.** The source is scaled by one shared gain **g = 0.7 ÷ (number of active components)**. Because |Σ aₙ sin(…)| ≤ Σ |aₙ| and a cut-only filter keeps every aₙ ≤ 1, neither the unfiltered sound nor *any* filtered version can go above 0.7 of full scale. So there is no clipping, and the unfiltered buzz peaks at about 0.5. Nothing is turned back up after the filter, so heavy cuts make the filtered sound quieter. That quietness is the filter’s real effect. Filter ON/BYPASSED compare at the same gain.

---

## 4. Automatic filter fitting, in plain language

1. **Measure the recording.** The existing automatic analysis (YIN plus per-frame FFT peaks) finds f0 and the strength of each harmonic in the selected section, relative to the strongest one. If you typed an f0, that value is used and labelled a manual value.
2. **Separate reliable from weak.** Harmonics that clearly stand out from the noise become **targets**. Weak ones only give an **upper limit**: “the filter should not let more than this through here”. Their level is read from the averaged spectrum, and the fit only penalises them when exceeded. That way the fit doesn’t chase noise.
3. **Pick a reachable target level.** The filter can only cut, so the strongest harmonic’s region is the 0 dB reference. One overall offset (0 to −12 dB) lets the fit lower the whole target when cuts alone can’t otherwise reach it. Overall loudness is handled separately (§3, §5).
4. **Fit the real filter.** A least-squares search (Levenberg–Marquardt) adjusts *only* the 8 points’ centres, cuts and widths (plus that offset). The goal is for the filter’s gain at each n × f0 to follow the recording’s pattern. It runs in two stages: cuts first at the default centres, then everything free, with gentle pulls toward ordinary widths. Bounds keep it cut-only. The source amplitudes are not parameters at all.
5. **Show the result honestly.** You get the RMS error in dB (“close broad match” under 3 dB, “rough” 3–6, “poor” above 6), the largest mismatches by harmonic, and a per-harmonic table of target vs result. It opens as a **new unsaved “fitted” experiment**, so you can listen, drag points to improve it, then save it separately.

**Limitations of the fit:**
- It matches *harmonic strengths*, not phase, breathiness or vibrato.
- Eight broad bands give a broad match. Narrow or closely spaced detail stays as visible error.
- A wrong f0 means wrong targets. On a strongly low-passed synthetic tone, the existing YIN estimator picked 226 Hz instead of 220 Hz, so always check that the purple n × f0 marks sit on the orange peaks, and type a correction if they don’t.
- The fit is only as good as the section you select.

---

## 5. Vowel examples

| Label | Sustained vowel (example word) | Adult women F1 / F2 / F3 (Hz) | Adult men F1 / F2 / F3 (Hz) |
|---|---|---|---|
| Aa (A) | /ɑ/ “aa”, as in *father* | 936 / 1551 / 2815 | 768 / 1333 / 2522 |
| Eh (E) | /ɛ/ “eh”, as in *bed* | 731 / 2058 / 2979 | 580 / 1799 / 2605 |
| Ee (I) | /i/ “ee”, as in *see* | 437 / 2761 / 3372 | 342 / 2322 / 3000 |
| Oh (O) | /o/ “oh”, as in *go*, held steady without the “w” glide (like Spanish “no”) | 555 / 1035 / 2828 | 497 / 910 / 2459 |
| Oo (U) | /u/ “oo”, as in *food* | 459 / 1105 / 2735 | 378 / 997 / 2343 |

These are group averages for American English vowels in /hVd/ words (Hillenbrand et al., 1995, Table V; I transcribed them from that table, so please check them against the paper before quoting exact numbers). The English *letter names* (“ay”, “ee”, “eye”, “oh”, “you”) are not used, because several of them glide between two vowels. Vowel letters are pronounced differently across words and languages, which is why each label has an example word.

**How an example becomes a filter.** F1–F3 (plus fixed F4/F5) become a smooth vowel-like envelope: five two-pole resonances, as in Klatt’s cascade formant synthesizer, plus a −6 dB/octave slope for the voice source and lip radiation. The same fitter then fits the 8 points to that envelope. The broad match is 2.6–5.0 dB RMS. The largest misses, about 6–13 dB, are at the narrow formant peaks, which 8 broad cut-only bands cannot fully form.

- **Load vowel example** loads one of these approximate presets.
- **Match filter to recording** analyzes *your* recording.

The presets are starting points, not universal settings and not an analysis of your voice. The filter keeps its frequencies when you change f0. The same filter at another pitch lands on different harmonics, though, so the vowel may not be perceived the same at every pitch.

**Optional makeup gain (off by default).** A heavily cut vowel can be 20–30 dB quieter than the buzz. For example, the fitted simulated “oo” peaks at 0.021. If that is too quiet to judge, tick *“Optional: raise the filtered sound to the unfiltered peak”*. This applies one constant gain after the filter. It doesn’t change the balance of harmonics, but it hides the true reduction, so the page then shows a ⚠ line with the gain in dB. The gain is recalculated only when a drag ends, never continuously. The WAV and JSON use and record the same gain.

---

## 6. How to try it

Start the app (`npm run dev`, then open the address it prints, usually http://localhost:5173/#/frequency). Use the **same browser** you recorded in, because recordings and experiments live in that browser’s storage.

### 6.1 Your saved “oo” recording: manual shaping

1. Click **🎚 Vowel filtering** in the Mode bar. Vowel Lab opens and scrolls to the section.
2. **Step 1:** In **Recording**, choose your oo take. Drag across the steady middle of the small waveform, or type *From/To*, or press **Use the Vowel Lab segment** if that experiment already has a good section. Set **Vowel** to **U /u/ as in “food”**.
3. **Step 2:** Press **🔍 Estimate from the recording**. In the lower chart, check that the purple dashed n × f0 lines sit on the orange peaks all the way up. If they don’t, type your value in the f0 box and press Enter; it will be labelled a manual correction. Leave **Components** at 32.
4. Press **▶ Start with all harmonics at maximum** to hear the rich, buzzy source (the filter is bypassed).
5. Press **○ Filter BYPASSED (press to turn on)**. The filter is flat, so nothing changes yet.
6. Drag points **4–8** (1.25 kHz and up) down to around −30 to −40 dB, and point **3** (850 Hz) down about −15 dB. Watch the cyan peaks move toward the orange ones. The sound changes as you drag.
7. Press **⇄ Original → Filtered**, adjust, and repeat. Press the Filter toggle while it plays to hear exactly what the filter removes. If it is too quiet, raise **Volume** first. Use the makeup gain only knowingly.
8. Write notes, then press **💾 Save filter experiment**. Download **⬇ Filtered synthesized WAV** and **⬇ Settings JSON**.

### 6.2 Your saved “oo” recording: automatic

1. Do steps 1–2 above (recording, steady section, label U). If you typed an f0, the fit uses it; otherwise it estimates automatically.
2. Press **🎯 Match filter to recording**. A new unsaved **fitted** experiment opens, and the filter and chart update.
3. Read the result chip (RMS error) and the “Largest mismatches” line. Open **Per-harmonic targets and result** for details.
4. Press **⇄ Original → Filtered**. Drag points to improve the match, or type values in the table.
5. Press **💾 Save filter experiment**. It is stored as a separate, “fitted” experiment, and the manual one from 6.1 stays as it was. Both appear in the dropdown and in **Saved filter experiments**.

### 6.3 The five vowel examples

1. In step 3, under **Load vowel example**, choose **Formant averages** (adult women or adult men).
2. Press **A /ɑ/ “father”**. The orange F1–F3 marks show where the example’s formants are.
3. Press **▶ Play Filtered**, then try **E**, **I**, **O** and **U**. Toggle the filter to compare each with the flat buzz.
4. Change f0 (for example to 150 and then 300 Hz) and listen to how the same filter acts on different harmonics.
5. Drag any point to edit an example. It is then marked “example, then edited”. Save it if you like.

---

## 7. Test results (actual runs)

**Unit tests:** `npm test` gives **114 / 114 pass**. That is the 100 previous tests plus 14 new ones in `test/vowel-filter.test.js`:

| Check | Result |
|---|---|
| Every active source component starts at amplitude 1 | In the render, all 32 harmonics are within 0.01 dB of each other and of the expected level. A stored record that claims other amplitudes is reset to 1. |
| Safe level | 12 random cut-only filters on 48 harmonics never exceed 0.7. Components at or above Nyquist are dropped (400 Hz × 48 at 16 kHz gives 19 active). |
| Bypass preserves the source | Sample-for-sample identical. A flat filter differs by < 10⁻⁶. |
| A filter reduces the intended region | A −24 dB cut at harmonic 6 gives −24.0 dB there. Harmonics two octaves or more away lose < 1 dB. Each harmonic’s measured change equals the displayed response to within 0.01 dB. |
| f0 and harmonic spacing unchanged by the filter | Every peak stays within 0.5 Hz of n × f0. |
| Displayed response = implemented filter | Sine measurements through the JS filter at 6 frequencies match the plotted response to < 0.05 dB. The response never exceeds 0 dB, and a boost is clamped to 0. |
| Known filter recovered from a synthetic recording | **0.22 dB RMS** error against the true filter over 32 harmonics, with a little added noise and f0 given. |
| Fitting changes only filter parameters | f0, count and source amplitudes are identical before and after. |
| Silent section | Gives no fit and changes nothing. |
| Vowel examples | 10 different filters (5 vowels × 2 averages), all cut-only, deterministic, 2.6–5.0 dB RMS from their envelopes. “ee” passes > 10 dB more at 2.7 kHz than “oo”. |
| Saved settings restore the same result | Both storage and JSON round trips restore the same experiment and sample-identical audio. |
| WAV includes the filter | Each harmonic in the decoded WAV sits at its filter gain (within 0.6 dB). The file starts and ends in silence. The makeup gain is exactly one constant factor. |
| Existing data intact | Separate storage keys are confirmed. The Vowel Lab experiment record format is unchanged. |
| Tour | 13 steps of ≤ 2 sentences and ≤ 40 words, each pointing at a real control. |

**Browser checks:** `node scripts/verify-filter.mjs` in Chromium via Playwright gives **55 / 55 pass**. Highlights:
- Seeded manual and automatic experiments stay byte-for-byte unchanged through every filter action and after a reload.
- The live graph has 32 oscillator gains of exactly 1 and source gain 0.7/32.
- Drag, keyboard and typed edits work, and a typed boost is refused.
- The live `getFrequencyResponse` matches the chart (max 0.0000 dB). The `OfflineAudioContext` render matches the WAV renderer (2.3 × 10⁻⁴).
- Original → Filtered plays in order, and the Vowel Lab and filter sounds never overlap.
- Simulated “oo”: automatic f0 247.91 Hz (true 248). The fit reports 1.8 dB RMS over 10 measured harmonics plus 22 upper-limit harmonics, and matches the simulation’s true pattern within **0.51 dB RMS** for harmonics above −30 dB.
- The WAV equals the app’s render, peak 0.021 with makeup off. The makeup gain, when ticked, is +27.8 dB.
- After a reload, both filter experiments reopen with identical sound.
- At 390 px phone width: no horizontal scroll, dragging works, and the tour cards stay on screen.

Screenshots are in `verification/filter-*.png`.

**Regression checks, rerun:** `verify-vowel` 49/49, `verify-auto-vowel` 26/26, `verify-tutorial` 24/24, `verify-mic` 45/45, `verify` (Manual frequencies) 36/36. `npm run build` succeeds (it gives the same chunk-size notice as before). `verify-motion` was not rerun, because Motion Score files were not touched.

**What these tests do *not* show.** Every audio test uses synthetic signals. Nothing here shows that your real A, E, I, O, U recordings are matched well, or that the filtered sounds are heard as those vowels. That needs you to record, listen and judge. Only Chromium was tested (no Safari or Firefox). The phone checks used an emulated 390 px viewport with mouse input, not a real phone’s touch screen.

---

## 8. Limitations and what still needs testing

- **Listening tests with your own voice:** record A, E, I, O, U, try both manual shaping and **Match filter to recording**, and note what matches and what doesn’t.
- **8 broad cut-only bands:** this gives broad matches. Narrow formant peaks and fine detail show up as error, which is reported, not hidden.
- **Quiet results:** heavy cuts make the filtered sound much quieter. That is honest, but you may need the volume or the labelled makeup gain.
- **f0 estimate:** check it against the n × f0 marks. YIN can stop at an early dip on very smooth waveforms.
- **The same filter at another pitch** acts on different harmonics, so vowel perception can change. Formants are regions; they are not tied to harmonic numbers.
- **The examples** use American English adult averages and modelling choices of mine (bandwidths 90/110/170/250/300 Hz, −6 dB/octave slope). Real voices, accents and children differ.
- **Sample rate:** the page asks the browser for 48 kHz audio, so playback, chart and WAV use the same rate. A browser that refuses falls back to its own rate, and the page then uses that rate everywhere.
- **Not tested** in Safari, Firefox, or on a real phone.

---

## 9. Files

- `src/pages/frequency/vowel-filter.js`: source, filter maths, rendering, measuring targets, fitting, examples, experiment records and settings files (pure, unit-tested).
- `src/pages/frequency/filter-audio.js`: Web Audio graph (extends the Vowel Lab player), plus an offline renderer for the checks.
- `src/pages/frequency/filter-plots.js`: the filter chart with draggable points, and the spectrum chart.
- `src/pages/frequency/vowel-filter-section.js`: the section UI.
- `src/pages/frequency/filter-tour.js`: tour steps.
- Small changes to existing files:
  - `vowel-lab.js`: mounts the section, keeps one sound at a time, unsticks the sticky bar while the section is centred.
  - `vowel-audio.js`: the original can be peak-matched to a given level.
  - `vowel-store.js`: a separate storage key for filter experiments.
  - `vowel-tutorial.js`: accepts custom steps.
  - `index.js`: Mode-bar button.
  - `style.css`.
- Tests: `test/vowel-filter.test.js`. Browser check: `scripts/verify-filter.mjs`.

---

## 10. Sources

- G. Fant (1960). *Acoustic Theory of Speech Production.* Mouton. (Source–filter theory of speech.)
- K. N. Stevens (1998). *Acoustic Phonetics.* MIT Press. (Formants as vocal-tract resonances; vowel acoustics.)
- D. H. Klatt (1980). “Software for a cascade/parallel formant synthesizer.” *JASA* 67(3), 971–995. (Cascade of two-pole resonators; voice-source and radiation slopes.)
- J. Hillenbrand, L. A. Getty, M. J. Clark & K. Wheeler (1995). “Acoustic characteristics of American English vowels.” *JASA* 97(5), 3099–3111. (Formant averages used for the examples.) Data: https://homepages.wmich.edu/~hillenbr/voweldata.html
- G. E. Peterson & H. L. Barney (1952). “Control methods used in a study of the vowels.” *JASA* 24(2), 175–184. (The classic earlier vowel formant study.)
- W3C. *Web Audio API*, BiquadFilterNode (filter types and coefficient formulas): https://www.w3.org/TR/webaudio/#BiquadFilterNode
- R. Bristow-Johnson. *Audio EQ Cookbook* (W3C Note): https://www.w3.org/TR/audio-eq-cookbook/
- K. Levenberg (1944), *Quarterly of Applied Mathematics* 2(2), 164–168; D. W. Marquardt (1963), *SIAM J. Appl. Math.* 11(2), 431–441. (The least-squares method used for fitting.)
- A. de Cheveigné & H. Kawahara (2002). “YIN, a fundamental frequency estimator for speech and music.” *JASA* 111(4), 1917–1930. (The existing f0 estimator that is reused here.)

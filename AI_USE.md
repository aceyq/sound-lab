# AI Use Disclosure: DSC 180A, Quarter 1

**Student:** Acelynn (Ace) Qiao
**Repository:** https://github.com/aceyq/sound-lab
**Live site:** https://aceyq.github.io/sound-lab/

## How I worked

I built every app this quarter with Claude (Anthropic), mostly through Claude Code running on my Mac. For each assignment, I started from Professor Minces's instructions and wrote a detailed prompt. It said what the app should do, how the controls should behave, what to explain to the user, and how to check that it worked. Claude wrote the code, tests and update guides. I tried the results, then sent feedback and follow-up prompts to steer the revisions. I did not edit the code by hand.

ChatGPT helped me word some of my later prompts. I did not use ChatGPT to draft the Oct 5–6 Harmonic Explorer prompt.

Below, each app or feature starts with my main build prompt, quoted exactly. Long prompts are collapsed, so click to expand them. After the prompt, I explain what I wanted, what I clarified or changed along the way, what Claude built, and how it was tested. Most automated checks used synthetic sounds or a simulated microphone or phone, so they don't replace listening. I say where I tested something myself.

Every commit in the repository shows my Git identity, because the commits were made on my Mac. Claude ran most of them through Claude Code. I ran two in Terminal myself, Vowel Morph (`76b3ed7`) and Vowel filtering (`b4ca719`), because Claude Code's permission check blocked Claude from committing.

## Week 2 — Harmonic Explorer (Oct 5–6, 2026)

### Main build prompt (verbatim, sent Oct 5, 2026)

I attached a screenshot of my professor's app as a visual reference. The image isn't reproduced here.

<details><summary>Full prompt</summary>

```text
Build and run a complete, working web app for my undergraduate Data Science capstone assignment. The app should demonstrate how a fundamental frequency and its harmonics combine to create sound.
I’ve attached a screenshot of the app my professor made. Use it as a visual reference for the layout, controls, and visualizations. Follow the assignment requirements below even if some details are not visible in the screenshot. Implement working audio and interactive visualizations, not just a visual mockup.
Please create all necessary files, install any required dependencies, run the app, and launch it in a browser if your environment supports that. Use reasonable defaults and proceed without asking me to make routine technical decisions.
Assignment
“Create a web app. It will have sliders for the fundamental frequency and harmonics.
The app should also have:

* A control for the fundamental frequency.
* A window showing the waveform: the addition of the fundamental and all the harmonics.
* A window showing the Fourier transform, which tells you what frequencies are in a sound.”

Optional conceptual reference:
https://www.youtube.com/watch?v=YsZKvLnf7wU
If the video is unavailable, proceed using these requirements and the attached screenshot.
Goal
Create an interactive educational synthesizer called “Harmonic Explorer.”
Users should be able to:

1. Adjust the fundamental frequency.
2. Adjust the amplitudes of the fundamental and higher harmonics.
3. Hear the resulting sound.
4. See the combined waveform change.
5. See the frequencies present in the sound through a Fourier frequency spectrum.

Keep the implementation focused, understandable, and easy for me to run, explain, and modify.
Technology

* Prefer Vite with vanilla JavaScript, HTML, and CSS.
* Use the browser’s native Web Audio API for sound generation and frequency analysis.
* Use Canvas or SVG for the visualizations.
* No backend, database, accounts, microphone access, external API keys, or paid services are needed.
* If an appropriate frontend project already exists in the current folder, work within it and preserve unrelated files.

Fundamental frequency control
Provide:

* A frequency slider from 50 Hz to 1,000 Hz.
* A synchronized numeric input for precise entry.
* A default value of 220 Hz.
* A clearly visible current frequency in Hz.

Changing the fundamental must update every harmonic frequency automatically:
frequency of harmonic n = n × fundamental frequency
The fundamental is harmonic 1. Higher harmonic frequencies should remain integer multiples of the fundamental rather than being independently adjustable.
Validate numeric inputs so invalid values do not break the app.
Harmonic amplitude controls
Include 10 amplitude sliders:

* Harmonic 1: fundamental.
* Harmonics 2 through 10: higher harmonics.

Each slider should:

* Range from 0 to 1, with steps of 0.01.
* Display its harmonic number, actual frequency in Hz, and amplitude.
* Update the sound and visualizations interactively.

For a fundamental of 220 Hz, the first three frequencies should be 220, 440, and 660 Hz.
Default to a pure sine wave: harmonic 1 amplitude = 1, all other amplitudes = 0.
Use consistent colors to connect the harmonic controls with the corresponding spectrum markers.
Audio synthesis and playback
Use additive synthesis to combine sinusoidal components:
x(t) = Σ Aₙ sin(2π n f₀ t), for n = 1 through 10
Where:

* f₀ is the fundamental frequency.
* Aₙ is the amplitude of harmonic n.
* t is time in seconds.

Use a phase-consistent implementation. A Web Audio PeriodicWave with appropriate sine coefficients is one suitable approach.
Provide:

* Play and Stop controls.
* A separate master volume slider.
* A low default listening volume.
* A clear playing/stopped status.

Create or resume the AudioContext in response to a user action to comply with browser audio restrictions.
Avoid clipping when several harmonics are active. If you normalize the combined signal, use a common factor that preserves the relative harmonic amplitudes. Account for that factor consistently in the waveform visualization and briefly explain it in the interface or README.
Smooth parameter changes and briefly fade playback in and out to reduce clicks. Repeated Play clicks must not create duplicate audio sources or animation loops.
When all amplitudes are zero, produce silence and show a flat waveform.
Exclude components at or above half the actual AudioContext sample rate if necessary.
Combined waveform window
Create a large plot titled “Combined Waveform.”
Show the sum of all selected sinusoidal components.
Requirements:

* Horizontal axis: time in milliseconds.
* Vertical axis: amplitude.
* Visible zero line and readable axis labels.
* Display approximately 2–4 fundamental periods.
* Update immediately when the fundamental or amplitudes change.
* Remain visible and useful before playback and after stopping.

You may calculate a stable waveform directly from the same synthesis coefficients and normalization used for the audio. Label it as the synthesized waveform.
Use a consistent amplitude scale. Do not independently rescale every waveform in a way that hides amplitude changes.
Fourier transform / frequency spectrum window
Create a second large plot titled “Frequency Spectrum (Fourier Transform).”
Use an AnalyserNode to obtain actual FFT data from the synthesized signal while it plays. Do not substitute decorative bars or simply draw the amplitude slider values and call them a Fourier transform.
Requirements:

* Horizontal axis: frequency in Hz.
* Vertical axis: magnitude in dB.
* An FFT size that makes the harmonic peaks easy to distinguish.
* Correct mapping of FFT bins to frequencies using the actual sample rate and FFT size.
* A displayed range that includes all 10 harmonics.
* Labeled markers at the expected harmonic frequencies.
* Continuous updates during playback.
* Safe handling of silent values and negative infinity.

Before playback, display “Press Play to view the live frequency spectrum.”
After stopping, either clear the spectrum or retain the last frame with an explicit “Stopped — last measured spectrum” label.
Briefly explain that FFT resolution and windowing can spread peaks across nearby bins.
Presets and reset
Include:

* Pure Sine: only harmonic 1 is active.
* Square-like: odd harmonic amplitudes follow 1/n; even harmonics are zero.
* Sawtooth-like: harmonic amplitudes follow 1/n.
* Reset: restore 220 Hz, pure sine, and the default master volume.

Label the square and sawtooth presets as approximations because only 10 harmonics are available.
Applying a preset must update the sliders, sound, and visualizations together.
Interface and educational explanations
Use the professor’s screenshot to guide the layout and overall organization. If a detail is unclear, choose a simple, readable design that satisfies the assignment.
Include:

* A short introduction.
* Clearly grouped frequency, harmonic, and playback controls.
* Both plots side by side on larger screens and stacked on smaller screens.
* Readable typography, good contrast, and accessible labels.
* Keyboard-operable controls.

Add concise explanations:

* Fundamental: the base frequency; harmonic frequencies are its integer multiples.
* Harmonics: components that contribute to the sound’s tone quality, or timbre.
* Waveform: how the combined signal changes over time.
* Frequency spectrum: which frequencies are present and their relative strengths.

Display the synthesis equation with a brief explanation of its symbols.
Keep the interface focused on the assignment and avoid unnecessary features.
Verification
Run the app and check:

1. With only harmonic 1 active at 220 Hz, the waveform is sinusoidal and the spectrum has a main peak near 220 Hz.
2. Adding harmonic 2 creates another peak near 440 Hz and changes the waveform.
3. Changing the fundamental to 300 Hz moves harmonic frequencies to 300, 600, 900 Hz, and so on.
4. Setting every amplitude to zero produces silence and a flat waveform.
5. Presets correctly update the sliders.
6. Repeated Play and Stop actions do not create duplicate audio sources or runtime errors.
7. The layout works at desktop and mobile widths.
8. The production build succeeds.

Use browser tools to inspect behavior and console errors if available. Clearly distinguish checks you performed from checks I need to perform manually, including listening to the sound.
Run, launch, and handoff
After implementation:

* Install dependencies and start the development server.
* Open the app in the browser if your tools support it.
* Otherwise, provide the exact local URL.
* If execution is blocked, explain the specific blocker and provide exact commands for running it locally.
* Do not claim the app was launched or tested unless it actually was.

Create a short README covering:

* Installation and startup commands.
* How to use the controls.
* How additive synthesis is implemented.
* How the waveform and FFT plots are produced.
* The main files and their purposes.
* Any limitations.

End with a concise explanation of what you built, what you verified, and how I can reopen the app later.
Please complete the implementation, run it, and launch it now.
```
</details>

### What I wanted

I wanted a simple synthesizer that shows how a fundamental and its harmonics add up to one sound. I set the requirements in the prompt:
- A 50–1000 Hz fundamental, defaulting to 220 Hz.
- Ten harmonic amplitude sliders, each showing its frequency (n × f₀).
- A waveform calculated from the same numbers as the audio.
- A spectrum measured with a real FFT, not decorative bars drawn from the slider values.
- One shared normalization factor, so preventing clipping wouldn't change the balance between harmonics.
- Presets labelled as approximations, because there are only 10 harmonics.

### What Claude built

Claude wrote the whole Vite and vanilla JavaScript app. Sound comes from one Web Audio `PeriodicWave` scaled by a normalization factor g, which the page displays. The waveform plot uses the same g, and the spectrum is read live from an `AnalyserNode`. Claude also added presets, Reset, master volume, fades, input validation, a README and a published copy. The code lives in a separate folder, `~/Desktop/harmonic-explorer`, and isn't part of this repository.

### How it was tested

Claude reported 19 of 19 automated browser checks passing. For example, a 220 Hz sine peaked at 221 Hz, within one FFT bin. Adding H2 added a peak near 440 Hz. Square-like peaked only at odd multiples, and repeated Play clicks never started a second sound. The test script wasn't saved, so these results rest on Claude's report.

## Frequency Playground (Project 1, October 13)

### Main build prompt

<details>
<summary>Build prompt (verbatim, October 13)</summary>

> Implement Project 1 of my undergraduate Data Science capstone assignment: an educational sound app called “Frequency Playground.”
> I need to present this tomorrow. A previous assignment produced a working synthesizer, but I did not fully understand its controls. This project must make the relationships between frequency, amplitude, waveform, spectrum, and sound intuitive through clear labels and guided experiments.
> Build the working app, create the necessary files, install dependencies, run it, and open it if your environment supports browser access. Do not stop at a plan or code snippets.
> ASSIGNMENT
> “Make an app that allows you to add frequencies and amplitudes by typing. Make sure you can see the waveform and hear the sound.
> Play with it.
> Add random frequencies.
> Add a frequency and its multiples, e.g. 100, 200, 300.
> Compare how they sound and look.
> Understand relevant terms, including Fourier transform and base frequency.
> For the waveform window, make sure you can change the scale: many seconds, 100 ms, etc.”
> PROJECT STRUCTURE
> Use a lightweight Vite frontend with vanilla JavaScript or an existing suitable framework. Use native Web Audio and Canvas for audio and visualizations.
> Create navigation for:
>
> 1. Frequency Playground — implement now.
> 2. Air Canvas — a separate project page I will request next; show an honest placeholder for now.
>
> Keep audio engines isolated. Switching pages must stop the current page’s audio.
> No backend, accounts, database, API keys, or microphone input are needed. Preserve unrelated existing files.
>
> 1. FREQUENCY COMPONENT EDITOR
>
> Create an editable table of up to 16 sine-wave components.
> Each row needs:
>
> * A stable component label.
> * A typed frequency input in Hz.
> * A typed amplitude input from 0 to 1.
> * An optional synchronized amplitude slider.
> * Enable/disable and Remove controls.
> * A matching color for its waveform overlay.
>
> Include Add Component.
> Start with one component: 220 Hz, amplitude 1.
> Allow arbitrary frequencies, including decimals. Do not force every row to be a multiple of a base frequency. This is the main difference from my previous harmonic-slider app.
> Validate inputs with helpful inline messages. Use a practical frequency range, such as 20–10,000 Hz, and reject frequencies at or above the actual Nyquist frequency. Prevent invalid input from breaking audio or plots.
> Explain beside the table:
> “Frequency controls how quickly this component oscillates. Amplitude controls its contribution to the mixture. Changing one component’s amplitude can change both the overall sound level and the tone quality.”
> Explain that amplitude 0.5 means half the wave amplitude of 1 before shared scaling, not necessarily half perceived loudness.
>
> 2. ADDITIVE SYNTHESIS AND PLAYBACK
>
> Generate the combined sound as:
> x(t) = Σ Aᵢ sin(2π fᵢ t)
> Every row has its own frequency fᵢ and amplitude Aᵢ. Unlike a harmonic-only synthesizer, fᵢ need not equal an integer multiple of a shared base.
> Provide:
>
> * Play.
> * Stop.
> * Master Volume, default around 15–20%.
> * Clear playing/stopped status.
>
> Use phase-consistent initialization where practical so the calculated waveform matches the intended synthesis. Explain any phase limitation honestly.
> Use smooth gain and frequency changes and short start/stop fades. Avoid duplicate oscillators, leaked nodes, or repeated animation loops.
> Apply a common normalization factor when needed to avoid clipping while preserving component amplitude ratios. Show its value and explain:
> “Normalization scales the whole mixture to avoid clipping. It does not change the relative balance between components.”
> Master Volume scales the listening output separately. Explicitly identify whether each visualization is before or after master volume. Keep the measured spectrum and spectrogram consistent with that choice.
>
> 3. WAVEFORM / OSCILLOSCOPE
>
> Create a large “Waveform — signal over time” plot.
> Requirements:
>
> * Time on the horizontal axis, clearly labeled in milliseconds or seconds.
> * Signal amplitude on the vertical axis.
> * Bright combined waveform.
> * Optional colored individual-component overlays.
> * Zero line.
> * Useful display before playback, calculated from the current synthesis settings.
>
> Time-window presets:
>
> * 5 ms.
> * 20 ms.
> * 100 ms.
> * 1 second.
> * 5 seconds.
> * A validated custom time window.
>
> Also provide a clearly labeled vertical amplitude-scale control.
> Changing these display scales must not change the generated sound.
> Explain:
> “Zooming changes how much of the signal we see. It does not change its frequency or playback speed.”
> At long windows, use sufficient sampling and pixel-column min/max rendering or another appropriate method to avoid misleading aliasing. If individual oscillations become too dense to distinguish, explain that this is expected and suggest zooming in. Do not draw a sparse, misleading curve.
> Optional overlays may be disabled at long windows for clarity.
>
> 4. LIVE FREQUENCY SPECTRUM
>
> Create “Frequency Spectrum — frequencies present now.”
> Use actual FFT measurements from an AnalyserNode during playback, not bars drawn directly from input values.
> Include:
>
> * Frequency axis in Hz.
> * Magnitude axis in dB.
> * Expected component markers, distinguished from measured peaks.
> * Sensible frequency-axis range controls.
> * A labeled linear/log frequency-axis option.
> * Handling for silence and non-finite values.
>
> Explain:
> “The Fourier transform separates a short segment of the combined signal into frequency components. Peaks show frequencies present in that segment.”
> Display FFT bin spacing, calculated from sample rate / FFT size. Explain that nearby frequencies may not be separately resolved and peaks can spread across neighboring bins. Do not promise perfect separation.
> Before playback, show a prompt to press Play. Label frozen measurements honestly after stopping.
>
> 5. LIVE SPECTROGRAM
>
> Add “Spectrogram — how frequencies change over time.”
> Use successive actual FFT measurements:
>
> * Horizontal axis: elapsed time, newest data on the right.
> * Vertical axis: frequency in Hz.
> * Color: magnitude in dB.
> * A labeled color legend.
> * A rolling history of approximately 10 seconds.
> * Clear History control.
> * Clearly indicated frequency scale and range.
>
> History advancement should be tied to elapsed time, not assumed animation-frame frequency.
> Keep spectrum and spectrogram data consistent. Explain:
> “A spectrum is one snapshot. A spectrogram places many snapshots next to each other so we can see change over time.”
> Allow each visualization to be expanded individually to avoid cramming everything onto a small screen.
>
> 6. PRESETS AND GUIDED EXPERIMENTS
>
> Include presets that populate the component table, then let me edit it freely:
> A. Pure Tone:
> 220 Hz, amplitude 1.
> B. Harmonic Family:
> 100, 200, 300, 400, 500 Hz, amplitudes 1, 0.5, 0.33, 0.25, 0.2.
> C. Non-harmonic Mixture:
> 137, 281, 463, 719 Hz, amplitudes 1, 0.6, 0.4, 0.3.
> Explain that these are not all integer multiples of one selected base.
> D. Close Frequencies / Beats:
> 220 and 224 Hz, equal amplitudes.
> Explain that interference produces a repeating loud-soft pattern at approximately their 4 Hz difference. Suggest a 1-second waveform view.
> E. Randomize:
> Generate 3–6 visibly listed frequencies in a comfortable range with sensible amplitudes. Explain that this changes the actual ingredients, not just the display.
> Do not claim non-harmonic or random mixtures can never repeat. Say they can have less obvious or much longer repetition patterns over the displayed time window.
> Include a Harmonic Builder with typed base frequency, component count, and Add/Replace action. This tool generates multiples; it must not restrict arbitrary editing elsewhere.
> Each experiment must have:
>
> * Exact actions.
> * What to listen for.
> * What to observe in the waveform.
> * What to observe in the spectrum/spectrogram.
> * One short explanation.
> * One optional prediction question.
>
> Include an experiment comparing master volume with changing only one component amplitude.
>
> 7. EDUCATIONAL AND PRESENTATION DESIGN
>
> Make the page readable on a laptop screen shared through Zoom.
> Provide:
>
> * Persistent one-sentence help beneath important controls.
> * A collapsible glossary.
> * A “What changed?” panel reporting concrete changes without pretending to know exactly how they will sound.
> * A Presentation Mode that hides secondary settings while preserving essential controls and readable explanations.
> * A Reset button with explicitly stated effects.
>
> Define:
> Frequency, Hz, amplitude, perceived loudness, pitch, timbre, sine wave, component, fundamental/base frequency, harmonic, waveform, period, interference, beats, Fourier transform, FFT, spectrum, spectrogram, normalization, and clipping.
> Distinguish fundamental from lowest active frequency:
> For a chosen harmonic family, the base defines its harmonic spacing. An arbitrary frequency mixture should not automatically be assigned a meaningful musical fundamental just because one row has the lowest value.
> Explain what every button does. Avoid unexplained technical labels.
>
> 8. VERIFICATION AND HANDOFF
>
> Verify:
>
> * Typed frequencies and amplitudes control the actual sound.
> * Add/remove/disable works during playback.
> * Time and vertical scale changes affect only the display.
> * Harmonic and non-harmonic presets produce the expected component markers and measured peaks within FFT resolution.
> * The close-frequency preset supports hearing/observing beats.
> * Silence behaves correctly.
> * Repeated playback and page changes clean up resources.
> * The production build succeeds.
>
> Create README instructions and PRESENTATION_NOTES.md containing:
>
> * A 2–3 minute demonstration script.
> * A plain-language explanation of each control.
> * The guided experiments.
> * Likely questions with accurate short answers.
> * Known limitations.
>
> Configure the project so it can later be deployed to GitHub Pages, including correct repository-subpath asset handling. Do not assume a repository name or publish to an unintended repository.
> Run the app and provide the exact local URL. Distinguish checks you actually performed from listening or browser checks I must do myself.

</details>

### What I wanted

My earlier synthesizer worked, but I didn't fully understand its controls. So I wanted an app where I could type any frequencies and amplitudes, not just multiples of one base, and see how they look and sound. The main pieces I asked for:
- Waveform time windows from 5 ms to 5 seconds, so I could zoom out to see beats.
- A spectrum and spectrogram measured from the actual audio.
- Presets for a pure tone, a harmonic family, a non-harmonic mixture and beats.
- Plain-language explanations for every control, so I could present it the next day.

### What Claude built

Claude built a new Vite app. It has an editable table of up to 16 sine components, an additive audio engine with shared normalization, and a waveform plot with time-window and amplitude-scale controls. It also measures an FFT spectrum and a spectrogram, and it has presets, a harmonic builder, guided experiments, a glossary and Presentation Mode. This repository grew out of this app.

### How it was tested

Claude ran 10 unit tests and 36 browser checks in headless Chromium, and all passed. The checks confirmed that typed values change the actual sound, that measured peaks land on the expected frequencies, and that zooming the display doesn't change the audio. The production build also succeeded.

## Motion Score (Project 2, October 13–19)

### Main build prompt

<details>
<summary>Motion Score build prompt (verbatim, October 13)</summary>

> Implement a complete replacement for Project 2 in my existing sound-wave app.
> Inspect the existing repository, framework, scripts, routing, audio implementation, git status, and git remotes before making changes. Read applicable project instructions. Preserve Project 1, “Frequency Playground,” and its existing behavior.
> Replace the old “Air Canvas” finger-tracking concept with:
> MOTION SCORE — TURN DANCE MOVEMENT INTO SOUND
> CONTEXT
> I am a UC San Diego Data Science senior and dancer. This is for my DSC 180 capstone class with Dr. Victor Minces. I need to demonstrate the app tomorrow over Zoom and explain how it works.
> ASSIGNMENT
> “Get creative: control sound, such as fundamental frequency or number of harmonics, with some gesture—for example, body positions from the laptop camera or an accelerometer.”
> My professor already demonstrated finger/hand tracking. This project must have a meaningfully different interaction: a phone’s motion and orientation sensors control an instrument running on my laptop.
> Build the functioning app, not just a mockup or a plan.
> MOST IMPORTANT REQUIREMENT: COMPREHENSIVE FUNCTIONALITY, SIMPLE EXPERIENCE
> The result must be comprehensive, easy to navigate, and simple enough that I can understand it and confidently explain it during class.
> Treat usability and explainability as acceptance requirements, not finishing touches.
> “Comprehensive” means:
>
> * The core instrument works.
> * Setup, permissions, pairing, calibration, audio, visualization, fallback, deployment, and documentation are covered.
> * Every visible control has a clear purpose.
> * Important concepts are explained accurately.
>
> “Simple” means:
>
> * The main screen contains only what I need to set up, play, and demonstrate.
> * Advanced settings and technical diagnostics are expandable.
> * I can immediately tell what to do next.
> * I can tell whether the phone is connected, sensors are working, and sound is enabled.
> * I can understand how my movement changes the sound without reading source code.
>
> Do not equate comprehensiveness with adding more buttons, effects, settings, or decorative elements.
> Use consistent, plain-language labels throughout the app and documentation. Explain technical terms when they first appear.
> Every visible button or control must answer:
>
> 1. What does this do?
> 2. When should I use it?
> 3. What should change after I use it?
>
> Give the primary mappings short, visible explanations:
>
> * “Tilt changes pitch.”
> * “Movement intensity changes harmonic richness.”
> * “Sharp movements trigger notes in Accents mode.”
>
> Use progressive disclosure:
>
> * Essential controls visible.
> * Secondary settings expandable.
> * Technical details in an optional “How it works” or “Diagnostics” section.
>
> Prioritize a reliable, understandable classroom demonstration over additional features.
>
> 1. CORE CONCEPT
>
> The phone is the controller. The laptop synthesizes audio and displays the performance.
> Explore three movement qualities:
>
> * Tilt controls pitch.
> * Movement intensity controls harmonic richness.
> * Sharp movement accents trigger short sound pulses.
>
> Provide two clearly explained performance modes:
> FLOW
>
> * Phone tilt controls pitch.
> * Movement intensity controls harmonic richness and a smoothed expression envelope.
> * Gentle movement makes a softer, simpler tone.
> * Energetic movement makes a stronger, richer tone.
> * Stillness fades the sound to silence.
>
> Visible explanation:
> “Keep moving to sustain sound. Tilt changes pitch; stronger movement adds harmonics and increases expression.”
> ACCENTS
>
> * Phone tilt controls the pitch of the next triggered note.
> * A sharp acceleration change triggers a short note.
> * Movement intensity at the trigger controls that note’s richness.
> * The note has a defined attack and decay, so it ends even if the phone disconnects.
>
> Visible explanation:
> “Make a sharp movement to play a short note. Tilt chooses its pitch; movement intensity shapes its richness.”
> These are two interpretations of the same sensor inputs. Do not add unrelated instruments or effects before both modes work.
> Default to Flow. Recommend holding the phone in one hand for the demonstration. Pocket placement can be mentioned as an optional experiment, with limitations clearly explained.
>
> 2. CLEAR NAVIGATION AND PAGE STRUCTURE
>
> Keep navigation obvious and consistent.
> Main project navigation:
>
> * Frequency Playground.
> * Motion Score.
>
> The phone Controller page is a specialized companion page reached through the pairing URL. It does not need the full desktop navigation.
> On the laptop, organize Motion Score into three clearly recognizable areas:
> A. SETUP
> A compact checklist:
>
> 1. Connect Phone.
> 2. Enable Sensors on Phone.
> 3. Calibrate.
> 4. Start Audio and Arm Phone.
>
> Show which steps are complete and which action comes next. Explain where each action happens: laptop or phone.
> B. PLAY
>
> * Main performance visualization.
> * Large live pitch, harmonic count, and expression values.
> * Flow / Accents.
> * Continuous / Pentatonic.
> * Essential audio controls.
> * Compact movement legend.
>
> C. LEARN / SETTINGS
> Expandable sections:
>
> * How it works.
> * Calibration and sensitivity.
> * Audio graphs.
> * Diagnostics.
> * Presentation help.
>
> Avoid a dashboard full of equally prominent panels. Establish a clear visual hierarchy.
> Do not make users navigate away from the performance screen to stop sound, view connection status, or understand the active mode.
>
> 3. IMPLEMENT THE CONNECTION FIRST
>
> Before spending time on visual polish, prove that real phone sensor values reach the laptop and change its audio parameters.
> Architecture:
>
> * A laptop Performance page.
> * A lightweight phone Controller page.
> * The existing Frequency Playground page.
> * A real phone-to-laptop data connection using PeerJS/WebRTC.
>
> Use current official documentation for PeerJS, browser motion/orientation APIs, Web Audio, and GitHub Pages. Pin dependencies and preserve a lockfile.
> GitHub Pages is static hosting. Do not assume it provides a WebSocket server or custom backend.
> Use PeerJS’s hosted signaling service for the initial implementation, with its dependencies and limitations documented. Do not describe this as fully offline or guaranteed to connect on every network. Do not add a paid service or embed credentials.
> Pairing flow:
>
> 1. On the laptop, select “Connect Phone.”
> 2. Create an unpredictable session identifier.
> 3. Display a QR code and a copyable phone-controller URL.
> 4. Open that URL in the phone’s browser.
> 5. Tap the phone’s explicit “Enable Sensors” button.
> 6. Establish a data connection.
> 7. Show sensor and connection status on both devices.
>
> Support manually entering the laptop session ID as an alternative to scanning. Ensure the pairing token is included or entered where needed.
> Generate the phone URL from the actual deployed origin and app base path. If the laptop is on localhost, explain that the phone cannot reach the laptop’s localhost. Do not present a localhost QR code as a working cross-device sensor demo.
> Prefer the deployed HTTPS site for the real phone demonstration.
> Only accept one active controller. Check a random pairing token during the connection handshake. Validate incoming messages, numeric ranges, and message types. Reject malformed data and additional controllers. Do not claim the session is suitable for sensitive data.
> Show clear states:
>
> * Creating session.
> * Waiting for phone.
> * Phone connected.
> * Waiting for sensor permission.
> * Sensors active.
> * Permission denied.
> * Sensor unavailable.
> * Connection failed.
> * Connection lost.
>
> Avoid showing cryptic errors without explanation. Include a brief next action, such as “Keep the phone page open” or “Try creating a new session.”
> Add timeouts and a “New Session” action that cleans up the previous session.
> WebRTC may fail on restrictive networks. Do not claim that being on the same Wi-Fi guarantees success. Document whether a TURN relay is configured; if none is configured, state that clearly and provide the fallback below.
>
> 4. PHONE SENSOR PERMISSIONS AND CAPABILITY HANDLING
>
> Use DeviceMotionEvent and DeviceOrientationEvent where supported.
> Requirements:
>
> * Run as a top-level HTTPS page.
> * Request permissions from a direct user action.
> * Feature-detect requestPermission methods before calling them.
> * Structure permission requests so both retain any required user activation.
> * Catch denied permissions and errors.
> * Support browsers where these methods do not exist but events are available.
> * Detect missing or null sensor fields.
> * Distinguish a still phone from a phone producing no sensor events.
> * Show the actual measured sensor update rate in diagnostics.
> * Provide brief platform-specific troubleshooting based on official documentation.
>
> Keep the phone interface especially simple:
>
> * Large connection and sensor status.
> * Enable Sensors.
> * Calibrate.
> * Arm / Disarm.
> * Emergency Mute.
> * Compact live tilt, movement intensity, and accent feedback.
> * “Keep this page open and your phone unlocked.”
>
> Use large touch targets and short instructions.
> Clearly distinguish:
>
> * “Connected” means the phone can communicate with the laptop.
> * “Sensors active” means motion data is arriving.
> * “Armed” means movement is allowed to control sound.
> * Laptop audio must also be started.
>
> Optionally use the Screen Wake Lock API when available. Release it correctly, handle failures, and never make it a requirement.
> Do not use camera, microphone, location, or device heading unless necessary. Compass heading is not needed.
>
> 5. SENSOR PROCESSING AND CALIBRATION
>
> Keep sensor processing separate from audio and visualization so mappings can be explained and tested.
> Send timestamped sensor samples at approximately 20–30 Hz without creating an unbounded queue. Include a sequence number and sensor availability information.
> Do not compare phone and laptop wall clocks as if they were synchronized. Use laptop receipt time for stale-input safety and phone sample intervals for sensor calculations.
> A. TILT
> Use a clearly defined pitch-controlling tilt axis, such as forward/back tilt while holding the phone in portrait orientation.
>
> * Display a simple diagram explaining the physical movement.
> * Calibrate a comfortable neutral orientation.
> * Use a comfortable relative range, approximately ±35 degrees.
> * Handle angle wrapping and screen orientation changes.
> * If rotation invalidates calibration, ask for recalibration and pause sound.
> * Smooth small fluctuations.
> * Do not imply an accelerometer alone directly measures orientation.
>
> B. MOVEMENT INTENSITY
> Prefer acceleration excluding gravity when valid.
> If only accelerationIncludingGravity is available, estimate gravity with a low-pass filter and subtract it. Label this as an approximation.
>
> * Calculate the magnitude of linear acceleration.
> * Apply a short smoothing window or exponential filter.
> * Preserve responsiveness while rejecting sensor noise.
> * Calibrate stillness/noise over approximately 2 seconds.
> * Optionally ask for a few comfortable movements to estimate a useful active range.
> * Provide adjustable sensitivity with sensible defaults.
> * Handle invalid samples and unusually large values.
> * State units, such as m/s², for raw measurements.
> * Explain that this measures phone acceleration, not physical energy, dance quality, or whole-body motion directly.
>
> C. SHARP ACCENTS
> Detect rapid changes in linear acceleration using a smoothed jerk estimate or a similarly explained onset detector.
>
> * Use sample time differences correctly.
> * Apply a threshold and hysteresis.
> * Add a cooldown, approximately 250–400 ms.
> * Avoid repeated triggers from one shake.
> * Reset detector state after calibration, reconnecting, or long sample gaps.
> * Do not trigger accidentally from a stale sample.
>
> CALIBRATION EXPERIENCE
> Make calibration guided and brief:
>
> 1. “Hold your phone comfortably and stay still.”
> 2. Show a short countdown.
> 3. “Calibration complete.”
> 4. Explain what was calibrated: neutral tilt and stillness noise.
>
> If an active-range step is included, explain exactly what movement to perform.
> Do not make me guess whether calibration worked. Show clear success/failure feedback and a Recalibrate action.
> Show raw/processed measurements and their mapped musical values in an expandable diagnostics panel, not as the default main interface.
>
> 6. EXPLICIT MUSICAL MAPPINGS
>
> A. TILT → FUNDAMENTAL FREQUENCY
> Map relative tilt logarithmically across approximately 110–880 Hz.
>
> * One direction lowers pitch; the other raises it.
> * Make the direction explicit and optionally invertible.
> * Show fundamental Hz and an approximate note name.
> * Keep a clearly visible neutral/reference indicator.
>
> Provide two pitch options:
> Continuous:
> Smooth pitch slides.
> Pentatonic:
> Choose notes from A minor pentatonic: A, C, D, E, G, within the supported frequency range.
> Use stable note selection/hysteresis.
> Visible explanation:
> “Continuous allows smooth pitch slides. Pentatonic selects nearby notes from A minor pentatonic: A, C, D, E, G.”
> Default to Continuous for learning.
> Explain “fundamental” simply:
> “The fundamental is the base frequency used to build the sound.”
> B. MOVEMENT INTENSITY → HARMONIC RICHNESS
> Map normalized intensity to approximately 1–12 harmonic components.
>
> * Show harmonic count.
> * Harmonic n has frequency n × fundamental.
> * Use decreasing relative amplitudes, such as 1/n.
> * Apply common normalization to the mixture.
> * Smooth changes and use hysteresis for discrete harmonic count.
> * Exclude harmonics at or above Nyquist.
>
> Visible explanation:
> “Harmonics are frequencies at whole-number multiples of the fundamental. Adding them changes the tone’s character, or timbre.”
> Clearly say whether the displayed count includes the fundamental. Prefer “Harmonic components, including the fundamental” in detailed help.
> C. EXPRESSION AND ARTICULATION
> In Flow:
>
> * Intensity also controls a smooth expression envelope.
> * Use a noise dead zone and gentle attack/release.
> * Brief pauses should fade naturally instead of producing chatter.
> * Show expression separately from master volume.
> * Explain that intensity affects both richness and expression in this mode.
>
> In Accents:
>
> * Each detected hit triggers a short envelope, for example a 10–20 ms attack and 250–450 ms decay.
> * Sample pitch and richness at the hit.
> * Specify whether later hits retrigger or overlap; prefer simple predictable retriggering.
> * Give visual feedback for every detected hit.
> * Avoid uncontrolled gain accumulation.
>
> Explain the distinction:
>
> * Expression: movement-controlled sound strength.
> * Master Volume: overall listening level set manually.
>
> Add a low master-volume default independent of these mappings.
>
> 7. AUDIO ENGINE AND SAFETY STATES
>
> Use Web Audio additive synthesis.
> Prefer a phase-consistent harmonic implementation, such as a single fundamental oscillator with an appropriate PeriodicWave, or another approach whose phase behavior you can explain.
> Provide:
>
> * Start Audio.
> * Stop Audio.
> * Master Volume.
> * Prominent Mute / Panic.
> * Clear audio status.
> * Phone Arm / Disarm state.
>
> Use brief contextual explanations:
>
> * Start Audio: enables the laptop’s audio engine.
> * Stop Audio: stops the instrument’s output.
> * Arm: allows phone movement to control sound.
> * Disarm: pauses movement control and silences the instrument.
> * Mute / Panic: immediately silences and disarms the instrument.
>
> Connection, sensor permission, arming, and audio activation are separate states. Pairing must never automatically start sound.
> The Panic action immediately silences audio and latches the instrument into a muted/disarmed state until the user explicitly restarts it. Incoming sensor messages must not undo Panic.
> Smooth frequency and gain changes. Avoid clipping through normalization and conservative gain.
> On phone disconnect, stale sensor input, disarming, controller page hiding, or leaving the Performance page:
>
> * Fade to silence promptly.
> * Clear pending accent envelopes.
> * Show the reason.
> * Require deliberate rearming after a connection failure.
>
> Use an approximately 500 ms stale-input timeout and bounded fade-out. Enforce timeout on the laptop even if the phone cannot send a final message.
> Treat valid stillness samples as valid input.
> Use a heartbeat/status message if appropriate, but distinguish a live connection from live sensor samples.
> Clean up listeners, animation frames, timers, peer connections, and audio resources when appropriate. Switching to Frequency Playground must stop the Project 2 instrument.
>
> 8. PERFORMANCE VISUALS
>
> Create a polished dark interface with readable text and restrained, meaningful color.
> Readability is more important than visual spectacle:
>
> * Strong text contrast.
> * Clear labels and units.
> * No tiny essential text.
> * No distracting decorative animations.
> * Consistent color meanings and a small legend.
> * Responsive layout that works in a shared Zoom window.
>
> The main visualization is a scrolling “Movement Score” showing the relationship between movement and sound.
> Use aligned timelines or clearly separated tracks:
>
> * Fundamental pitch over time.
> * Normalized movement intensity over time.
> * Accent markers.
> * Optional harmonic count trace.
>
> Keep approximately 10 seconds of history, advancing according to elapsed time. Include axes and units.
> Do not label movement data as an audio waveform or spectrogram.
> Display prominently:
>
> * Fundamental Hz/note.
> * Harmonic count.
> * Expression level.
> * Current mode.
> * Connection/audio status.
>
> Keep phone tilt, movement intensity, and last-sample age available without competing with the main musical values.
> Include a real rolling audio spectrogram:
>
> * Derived from the laptop’s synthesized audio through an AnalyserNode.
> * Time horizontal, newest data at the right.
> * Frequency vertical.
> * Intensity color represents measured magnitude.
> * Visible frequency labels, time scale, and color legend.
> * Clearly label linear or logarithmic frequency display.
>
> Use an explicit audio measurement point, preferably after expression/envelope and master gain, before output, so the visualization represents the app’s output level.
> Provide an expandable short-window waveform and current spectrum from the same measurement point.
> Explain the differences in one short help panel:
>
> * Movement Score: sensor-derived control history.
> * Waveform: audio amplitude over time.
> * Spectrum: audio frequency content at a moment.
> * Spectrogram: audio frequency content over time.
>
> Provide separate Clear Movement Score and Clear Spectrogram actions, with brief explanations.
> Optional Freeze Visual History must freeze only displayed histories, not audio or safety checks. Clearly show the frozen state.
>
> 9. DEMONSTRATION FALLBACK
>
> Provide a reliable “Laptop Demo — simulated sensor input” mode.
> Use visible, understandable controls to simulate:
>
> * Tilt.
> * Movement intensity.
> * Accent trigger.
>
> Label their musical effects beside them:
>
> * Tilt → pitch.
> * Intensity → richness and Flow expression.
> * Trigger Accent → short note in Accents mode.
>
> Keyboard shortcuts can supplement controls, but controls must remain usable with the pointer. Show any shortcuts visibly.
> Send simulated input through the same mapping pipeline as phone data.
> Show a persistent badge:
> “Laptop Demo — phone sensors are not connected.”
> Never display simulation as real motion data.
> Switching input sources must first silence and disarm the instrument. Clear old input state.
> This fallback must work without PeerJS signaling or phone permissions after the app has loaded.
> Do not add a standalone phone audio mode unless all required features are complete and it would not complicate the interface or handoff.
>
> 10. PRESENTATION MODE AND EXPLANATIONS
>
> Presentation Mode is a required feature.
> It should emphasize:
>
> * Large visuals.
> * Readable live musical values.
> * Compact mapping legend.
> * Connection and audio status.
> * Start / Stop / Panic.
> * Flow / Accents.
> * Continuous / Pentatonic.
>
> Hide secondary settings and diagnostics. Do not hide essential status or safety controls.
> Provide an obvious way to enter and exit Presentation Mode.
> Include an optional “Demo Guide” with one short instruction at a time. It must not automatically play sound or pretend to receive real phone data.
> Suggested guided steps:
>
> 1. Connect and calibrate the phone.
> 2. Start audio and arm the instrument.
> 3. Stay still: observe silence.
> 4. Move gently: observe expression and harmonic count.
> 5. Change tilt: observe fundamental frequency.
> 6. Switch to Accents: trigger a short note.
> 7. Compare the Movement Score with the spectrogram.
> 8. Disarm or Panic to finish.
>
> Include plain-language help explaining:
>
> * Orientation versus acceleration.
> * Gravity removal.
> * The movement-to-sound mappings.
> * Why logarithmic frequency mapping is useful.
> * Why harmonics affect timbre.
> * Why smoothing, calibration, and trigger cooldowns are needed.
> * How the phone communicates with the laptop.
> * Which parts need internet access.
>
> Use short explanations with optional “More detail.” Avoid long paragraphs on the main screen.
> State accurately:
> “This uses phone sensor measurements and explicitly programmed mappings to synthesize sound. It does not train a model to recognize dance movements.”
> Do not add hand tracking, finger pinching, or a vocal-tract simulation.
>
> 11. GITHUB PAGES HOSTING
>
> Prepare both projects and the phone controller for GitHub Pages.
> Inspect the existing git remote and deployment setup before choosing paths or workflows.
> Requirements:
>
> * Correct production build.
> * Correct repository base path.
> * Working asset URLs under a repository subpath.
> * Directly opening phone-controller and Performance URLs must work.
> * Prefer hash routing if appropriate for the existing app rather than relying on server-side route rewrites.
> * QR-code links must preserve the production base path and route.
> * No secrets or private sensor logs committed.
> * No Node backend assumed on GitHub Pages.
> * Document external signaling dependencies.
>
> Use an appropriate GitHub Actions workflow with required Pages permissions, artifact upload, deployment, and concurrency settings. Follow current official GitHub guidance and use the repository’s package manager and lockfile.
> I authorize deploying this app to an existing GitHub repository already identified by this workspace’s remote if authenticated access and repository permissions allow it. Inspect the diff and ensure unrelated/private files are excluded before pushing. Preserve unrelated changes.
> Do not force-push or overwrite remote history.
> If no intended repository is identified, do not invent one. Complete the build and deployment files, then tell me exactly what repository information or GitHub action is still needed.
> If authentication or a repository setting blocks deployment, clearly report the blocker and provide exact setup instructions. Do not claim deployment succeeded.
> After deployment, verify the actual HTTPS URL and relevant routes. Report only verified URLs.
>
> 12. ZOOM DEMONSTRATION
>
> Write a simple Zoom setup guide:
>
> 1. Open the hosted Performance page on the laptop.
> 2. Open the phone Controller URL by QR code.
> 3. Enable sensors.
> 4. Calibrate while holding the phone comfortably.
> 5. Start Audio on the laptop and arm the phone.
> 6. Test sound at a low volume.
> 7. Share the laptop app window or screen in Zoom.
> 8. Enable Zoom’s Share Sound.
> 9. Keep the phone controller open and unlocked.
> 10. Enter Presentation Mode.
>
> The primary workflow should not require sharing the phone screen, phone audio, or using the laptop webcam.
> Recommend headphones on the laptop to reduce feedback.
> Explain that a hosted website alone does not guarantee successful phone pairing. Test pairing on the actual network before presenting. Keep Laptop Demo available.
> Provide a 30-second demonstration:
>
> * Start in Flow and Continuous.
> * Hold still: demonstrate silence.
> * Make a gentle moving gesture: demonstrate soft/simple sound.
> * Tilt while maintaining roughly similar movement intensity: demonstrate pitch change.
> * Increase movement intensity while keeping tilt roughly stable: demonstrate increased richness and expression.
> * Switch to Accents and Pentatonic.
> * Perform three deliberate sharp movements at different tilts.
> * End with Panic or Disarm.
>
> Acknowledge that tilt and movement intensity are physically coupled; demonstrations isolate them approximately, not perfectly.
>
> 13. COMPREHENSIVE, EASY-TO-USE DOCUMENTATION
>
> Create or update PRESENTATION_NOTES.md.
> This document should help me understand and present the app without needing to inspect the code.
> Include:
> A. QUICK START
> A short numbered checklist from opening the app to producing sound.
> B. 2–3 MINUTE PRESENTATION SCRIPT
> Write in natural language suitable for a student presenting in class:
>
> * What I built.
> * Why I chose phone movement as a dancer.
> * What the sensors measure.
> * How the mappings work.
> * How Flow differs from Accents.
> * What the visuals show.
> * What the limitations are.
>
> C. CONTROL REFERENCE
> Use a clear table:
> Control | What it does | When to use it | What I should observe
> Cover every visible button, selector, and slider. Match the app’s labels exactly.
> D. CONCEPT REFERENCE
> Briefly explain:
>
> * Fundamental frequency.
> * Harmonics.
> * Timbre.
> * Amplitude/expression.
> * Orientation.
> * Acceleration.
> * Gravity removal.
> * Smoothing.
> * Calibration.
> * Pentatonic quantization.
> * Waveform, spectrum, and spectrogram.
>
> Include the actual implemented ranges, scale, and envelope behavior.
> E. DEMONSTRATION
>
> * The 30-second performance sequence.
> * Dancer-inspired examples: slow arm waves, controlled wrist tilt, sharp hits.
> * Which live values or graphs to point to during each step.
>
> F. LIKELY QUESTIONS
> Provide accurate answers to questions such as:
>
> * Why use a phone instead of finger tracking?
> * Does this recognize dance moves?
> * Did I train a machine-learning model?
> * Why does stronger movement add harmonics?
> * How is gravity handled?
> * Why does sound stop when I stop moving?
> * Why are Flow and Accents different?
> * What happens if the phone disconnects?
> * What is simulated in Laptop Demo?
>
> G. LIMITATIONS AND TROUBLESHOOTING
> Cover:
>
> * Sensor/browser support.
> * Sensor noise.
> * Approximate gravity estimation.
> * Physical coupling between tilt and acceleration.
> * Network pairing.
> * Phone sleep/background behavior.
> * Lack of dance recognition.
> * Common reasons for “connected but no sound.”
>
> H. HOSTING AND REOPENING
>
> * Zoom setup.
> * GitHub Pages setup.
> * Exact local commands.
> * Verified hosted URL if available.
> * Phone pairing steps.
>
> Update README with exact install, run, build, preview, and deployment commands.
> Keep documentation organized and scannable. Make it complete without repeating the same explanations unnecessarily.
>
> 14. VERIFICATION
>
> Perform appropriate checks:
>
> * Existing Frequency Playground still works.
> * Real sensor messages use the intended mapping pipeline.
> * Permission-denied, unavailable-sensor, and connection-error states are handled.
> * Malformed data cannot produce invalid audio values.
> * Tilt mapping is logarithmic and calibrated.
> * Angle wrapping and orientation changes are handled.
> * Gravity removal and onset detection behave sensibly.
> * Accent cooldown prevents repeated firing.
> * Pitch and harmonic boundaries are stable.
> * Harmonics stay below Nyquist.
> * Panic remains latched.
> * Stale sensor input and disconnect silence output.
> * Stillness is distinguished from missing sensor data.
> * Navigation cleans up resources.
> * Laptop Demo works without a phone connection.
> * Direct routes, QR URLs, production build, and repository base paths work.
>
> Use focused tests for signal-processing, mapping, and safety logic where useful. Inspect the app in a browser if tooling is available.
> Do not claim physical phone, real sensor, listening, or Zoom tests were performed unless they actually were. Simulated event tests do not prove hardware compatibility.
> Provide a short manual phone-and-Zoom checklist for anything you cannot verify.
>
> 15. REQUIRED USABILITY REVIEW
>
> Before handing off, review the interface from the perspective of a student opening it for the first time.
> Confirm:
>
> * I can identify the next setup action immediately.
> * I know which actions happen on the laptop and which happen on the phone.
> * I can distinguish connection, sensor, armed, and audio states.
> * I can understand all three mappings from the main screen.
> * I can explain Flow and Accents in one sentence each.
> * I can explain every visible control.
> * I can find Stop and Panic immediately.
> * I can switch to the fallback quickly.
> * I can navigate between projects without confusion.
> * Presentation Mode is readable in a Zoom screen share.
> * Technical settings do not overwhelm the main experience.
> * App labels and presentation notes agree exactly.
>
> Fix confusing labels, redundant controls, crowded layouts, and missing explanations before completion.
> Do not claim a real user study was performed. Report this as an interface review unless actual user testing occurred.
>
> 16. EXECUTION AND HANDOFF
>
> Implement in this order:
>
> 1. Real phone connection and sensor reception.
> 2. Mapping and audio pipeline.
> 3. Calibration, safety states, and fallback.
> 4. Clear interface and visualizations.
> 5. Presentation Mode and explanations.
> 6. Deployment and documentation.
> 7. Verification and usability review.
>
> Do not spend the entire task polishing a nonfunctional prototype.
> Run the app and launch it if supported.
> At completion, provide:
>
> * What was implemented.
> * Exact local URL.
> * Verified hosted URL, if deployed.
> * Phone pairing instructions.
> * Exact commands to reopen the app.
> * Checks actually performed.
> * Remaining manual tests or deployment blockers.
> * A brief “How to present this tomorrow” checklist.
>
> Make reasonable implementation decisions independently. Ask only when missing repository/account information prevents a required action.
> FINAL PRIORITY
> The finished result must be comprehensive in functionality and explanation, easy to navigate, and simple enough that I can understand and demonstrate it confidently in class.
> A successful result lets me clearly explain:
> “This movement changes this sound parameter, here is why, and here is where you can see the result.”
> Keep that relationship visible throughout the experience.

</details>

### What I wanted

My first idea for Project 2 was Air Canvas, a hand-tracking instrument. Claude built it, but I replaced it the same day with Motion Score. In Motion Score my phone is the controller: its motion and orientation sensors stream to my laptop, and the laptop turns them into sound.

<details>
<summary>Air Canvas prompt, later replaced (verbatim, October 13)</summary>

> Implement Project 2 within the existing app, on the separate “Air Canvas” page. Preserve Frequency Playground and its behavior.
> PROJECT ASSIGNMENT
> “Get creative: control sound, such as fundamental frequency or number of harmonics, with some gesture—for example, body positions from the laptop camera or an accelerometer.”
> I am a dancer and want a creative, understandable instrument I can demonstrate tomorrow over Zoom.
> CONCEPT: AIR CANVAS — PAINT SOUND WITH MOVEMENT
> Turn one tracked hand into an expressive instrument:
>
> * Hand height controls fundamental frequency.
> * Horizontal hand position controls harmonic richness.
> * Thumb–index separation controls the sound’s strength.
> * Hand movement leaves a colorful trail.
> * A live spectrogram records the resulting sound as a visual musical drawing.
>
> The camera tracking must actually control the audio. Decorative animations alone do not satisfy the assignment.
> Use the attached professor screenshots as references for visible joint tracking, clear gesture feedback, and spectrogram visualization. This app has its own movement-and-sound concept; it does not need to reproduce a vocal-tract simulation.
> Prioritize reliable core functionality and a polished presentation over extra effects.
>
> 1. REAL CAMERA HAND TRACKING
>
> Use MediaPipe Hand Landmarker for browser-based tracking, following its current official documentation.
> Requirements:
>
> * Explicit Enable Camera action.
> * Track one hand locally in the browser.
> * Mirrored camera preview with correctly aligned landmark overlay.
> * Visible joint circles and connecting lines.
> * Highlight the palm position and thumb/index tips used by the mappings.
> * Clear model-loading, camera-ready, hand-detected, and tracking-lost states.
> * Helpful camera-denied and model-load failure messages.
> * No microphone recording or server upload of camera frames.
>
> Keep model, WASM, and package versions compatible. Ensure asset paths work under a GitHub Pages repository subpath. State any internet dependency for initial model loading; do not claim offline support unless implemented and tested.
> Throttle inference appropriately so audio and animation stay responsive. Clean up camera tracks, model resources, and loops when leaving the page.
>
> 2. SIMPLE, EXPLICIT GESTURE MAPPINGS
>
> Use one hand so the demo works while seated at a laptop.
> A. Palm height → pitch
>
> * Higher on the preview means a higher fundamental.
> * Lower means a lower fundamental.
> * Map to approximately 110–880 Hz using perceptually sensible logarithmic frequency mapping.
> * Show live Hz and approximate note name.
>
> B. Palm horizontal position → harmonic richness
>
> * Left means fewer harmonics and a simpler tone.
> * Right means more harmonics and a richer tone.
> * Map across 1–12 harmonic components.
> * Show the live harmonic count.
> * Define harmonic frequencies as n × fundamental.
> * Use decreasing amplitudes such as 1/n with common normalization.
>
> Implement the mapping in mirrored screen coordinates, so moving toward the visible right produces the stated effect.
> C. Thumb–index opening → expression level
>
> * Fingers together: fade to silence.
> * Wider opening: stronger sound.
> * Normalize the distance by a stable palm-size measure to reduce sensitivity to camera distance.
> * Clamp the result and smooth it.
> * Add a small closed-pinch dead zone.
> * Display the detected opening and mapped expression level.
>
> Expression Level scales the entire synthesized mixture before a separate master-volume control. Do not call it a harmonic amplitude slider.
> Use smoothing, short gain ramps, and hysteresis around discrete harmonic-count boundaries so hand jitter does not create rapid switching.
> Explain each mapping with a visible diagram or compact legend. Keep the number of primary mappings to these three.
>
> 3. CALIBRATION AND TRACKING LOSS
>
> Provide a simple optional calibration flow for comfortable palm position and pinch range. Clearly say which mappings are calibrated and which use screen-based defaults.
> If calibration is skipped, use reasonable defaults.
> If tracking is lost or confidence becomes inadequate:
>
> * Fade audio to silence promptly.
> * Stop adding trails.
> * Show “Hand not detected — sound paused.”
> * Resume smoothly after reliable tracking returns.
>
> Never sustain an uncontrolled note after the hand leaves the frame.
>
> 4. AUDIO ENGINE
>
> Use Web Audio additive synthesis with phase-consistent harmonic components.
> Provide:
>
> * Start Audio.
> * Stop Audio.
> * Master Volume with a low default.
> * A prominent Mute / Panic button that immediately silences output and leaves it muted until explicitly restarted.
>
> Camera permission and audio activation are separate actions, each clearly explained.
> Avoid clipping through common normalization. Exclude harmonics at or above Nyquist. Smooth changes in pitch, expression level, and harmonic gains.
> Use the same audio signal for the live spectrum and spectrogram. Clearly identify the measurement point.
>
> 5. CREATIVE VISUAL PERFORMANCE
>
> Create a polished dark performance canvas with readable controls and colorful motion trails.
> Use consistent visual mappings:
>
> * Trail color corresponds to pitch, with a small legend.
> * Trail width corresponds to harmonic richness.
> * Trail opacity corresponds to expression level.
> * Do not draw new strokes when expression is zero or tracking is lost.
>
> Make clear that the trail is a gesture visualization, not a waveform or spectrogram.
> Display:
>
> * Mirrored camera preview with landmarks.
> * A large motion-art canvas.
> * Live parameter cards for fundamental Hz, harmonic count, and expression level.
> * A real rolling spectrogram of the generated sound.
> * An expandable short-window waveform and current spectrum.
>
> Spectrogram:
>
> * Time horizontal, newest data at the right.
> * Frequency vertical.
> * Color intensity represents measured magnitude.
> * Visible axes and color legend.
> * Approximately 10 seconds of history, advancing according to elapsed time.
>
> Include an optional Freeze Visuals control that explicitly freezes only visual history, not sound. Label the frozen state unmistakably.
> Include Clear Trails and Clear Spectrogram as separate, clearly explained actions.
>
> 6. CONTINUOUS AND MUSICAL MODES
>
> Include two pitch modes:
>
> * Continuous: smooth pitch slides, useful for understanding frequency.
> * Pentatonic: snap pitch to a clearly specified pentatonic scale over the available range.
>
> Explain:
> “Continuous mode allows intermediate frequencies. Pentatonic mode selects nearby notes from a five-note scale.”
> Use hysteresis or stable note selection to prevent flickering between nearby notes.
> Default to Continuous for learning; allow Pentatonic for a short performance.
> Do not add other sound effects until the three gesture mappings work reliably.
>
> 7. HONEST FALLBACK FOR PRESENTATION
>
> Provide an explicitly labeled Mouse Demo mode in case the webcam, model download, or camera sharing fails.
> In Mouse Demo:
>
> * Pointer height maps to pitch.
> * Pointer horizontal position maps to harmonic count.
> * Holding the pointer button produces sound at a defined expression level; releasing fades to silence.
> * Leaving the canvas or losing window focus silences the sound.
>
> Show a persistent “Mouse Demo — camera tracking is off” badge. Never present simulated tracking as real camera tracking.
> Camera mode remains the primary project and must genuinely work.
>
> 8. EXPLANATIONS AND PRESENTATION MODE
>
> Add brief plain-language help:
>
> * What the landmark tracker estimates.
> * How each movement maps to a parameter.
> * Why harmonic count changes timbre.
> * How waveform, spectrum, spectrogram, and gesture trails differ.
> * Why smoothing and normalization are used.
>
> State that this uses a pretrained landmark detector plus explicitly programmed sound mappings. Do not imply I trained a new model to learn gesture-to-sound relationships.
> Create a Presentation Mode with:
>
> * Large visual area.
> * Readable live parameter values.
> * A compact gesture legend.
> * Essential start/stop/mute controls.
> * Minimal secondary settings.
>
> Include a guided demonstration:
>
> 1. Hold a nearly closed pinch: silence.
> 2. Open the pinch: sound fades in.
> 3. Move upward while keeping horizontal position stable: pitch rises.
> 4. Move left/right while keeping height stable: harmonic richness changes.
> 5. Trace a slow shape: the gesture trail draws the motion while the spectrogram shows the changing sound.
> 6. Close the pinch or remove the hand: sound fades out.
>
> Provide a suggested 30-second musical performance in Pentatonic mode.
>
> 9. HOSTING AND ZOOM READINESS
>
> Both project pages must work locally and be ready for GitHub Pages.
> Prepare:
>
> * A correct production build.
> * A GitHub Pages deployment workflow or appropriate deployment instructions.
> * Correct base paths for scripts, model assets, and WASM.
> * Navigation that works when the deployed URL is opened directly.
> * HTTPS camera requirements and localhost instructions.
> * Clear instructions for any repository-specific setting still needed.
>
> Inspect existing git configuration before making repository assumptions. If an intended repository is already identified and publishing is authorized, deploy there. Otherwise provide the exact remaining setup steps rather than inventing a public URL.
> Include Zoom presentation instructions:
>
> * Share the app window/screen.
> * Enable Share Sound so participants hear synthesized audio.
> * Test the browser camera with Zoom before the presentation.
> * If there is camera contention, try disabling Zoom video and letting the app use the webcam.
> * Keep Mouse Demo available as the explicit fallback.
>
> 10. VERIFY AND HAND OFF
>
> Verify:
>
> * Real camera tracking drives all three intended parameters.
> * Mirroring and landmark alignment are correct.
> * Moving only one axis mainly changes its assigned parameter.
> * Tracking loss and closed pinch silence output.
> * Harmonic gains and pitch changes are smooth.
> * Camera denial and model-loading failures are handled.
> * Mouse Demo works and is honestly labeled.
> * Page switching stops audio and camera resources.
> * Both project pages still work.
> * Production build and base-path behavior are checked.
>
> Do not claim physical-camera or listening tests were performed if the environment does not allow them. Provide a short manual test checklist.
> Extend PRESENTATION_NOTES.md with:
>
> * A 2–3 minute explanation of Air Canvas.
> * What each button and mapping does.
> * A 30-second performance sequence.
> * Likely questions and accurate answers.
> * Limitations, including sensitivity to lighting, occlusion, and hand position.
>
> Run and launch the completed app. Give me its local URL, any verified hosted URL, and precise instructions for reopening it.

</details>

### What I clarified or changed

**Easier phone pairing.** Testing pairing showed me that connecting the phone was confusing. I also pointed out that people using the hosted app wouldn't be able to run local Terminal commands:

> is there any way you could make connecting the phone more intuitive? and if i were to host on github pages, you wouldn't be able to run the terminal commands locally

After this, the hosted laptop page shows a QR code as soon as it opens, and the phone walks through numbered steps. We also moved hosting to GitHub Pages, so nobody needs Terminal to use it.

**Explaining the controls.** I found the on-page text hard to use while presenting. So I asked for a guided tour that points at each control, and for clearer movement tracks:

<details>
<summary>Tour and clarity feedback (verbatim, October 13)</summary>

> Perfect, now last thing. I know that you already put a lot of notes underneath a lot of the frequency components and explained what they do etc, but there's a lot of text and I want to be able to look at a component and explain what it does/how to walk someone through. The demo guide was very helpful but would be nice if the pop up would point to or be next to the relevant sections, and I want it to also maybe highlight and narrow down with like a dim circle or something to show what the demo is explaining how to mess around with something, especially the pentatonic which is something we haven't talked about. also don't quite understand why our only 2 options are flow and accent, what does that mean? And also, the pitch, movement, harmonics is really cool but i don't get what im seeing there, the key words you put ARE DEFINITELY Helpful but not as intuitive as i like. The spectrogram is cool too. Just wish the Part C with learn/settings were better incorporated in the whole thing instead of just istting at the end if that makes sense? Then, I'd also like you help me write notes for what to say when I'm explaining the frequency playground, and then the motion score while also adding pointers here and there that tell me where to click to demonstrate each thing, make it sound as natural as possible and I will have these notes written down somewhere.

</details>

**Separating pitch from timbre.** In the first version, movement intensity controlled both loudness and the number of harmonics, so I couldn't change tone quality on its own. I asked for a "Tilt instrument" where forward and back tilt sets pitch and sideways lean sets harmonic richness. I also asked for a pitch lock at 200 Hz for demos:

<details>
<summary>Tilt instrument request (verbatim, October 18)</summary>

> I’m improving my existing Motion Score instrument for my DSC 180 capstone with Professor Minces. Please inspect the existing implementation first, then implement the changes below in the existing project.
> Assignment:
>
> * Make an improved instrument that lets me manipulate harmonics/timbre through movement.
> * Make the relationship between gesture and sound clear.
> * Help me understand and demonstrate fundamentals, harmonics, and harmonic amplitudes.
>
> CURRENT BEHAVIOR
> The current app has phone pairing, calibration, Flow/Accents modes, Continuous/Pentatonic pitch, audio controls, a Movement Score, spectrogram, waveform, spectrum, and a demo.
> Forward/back tilt controls fundamental frequency. Movement intensity controls harmonic count (1–12, including the fundamental) and expression. This makes timbre difficult to control independently.
> MAIN IMPROVEMENT: INDEPENDENT PITCH AND TIMBRE
> Add a clearly labeled mapping selector:
>
> 1. “Tilt instrument” — new default.
> 2. “Movement intensity” — preserve the existing mapping.
>
> In the new Tilt instrument mapping:
>
> * Forward/back tilt controls fundamental frequency, preserving the existing pitch direction and range.
> * Left/right tilt controls harmonic richness independently.
> * Calibrated neutral sideways tilt gives a medium richness; leaning left reduces it toward a pure sine, and leaning right increases it toward a richer tone.
> * Use approximately ±30° around the calibrated sideways neutral, with adjustable sensitivity if needed.
> * Show clear instructions and a simple phone illustration for both gestures.
>
> Inspect the existing sensor pipeline. Add the necessary sideways orientation data to phone messages and receiver validation. Handle screen orientation consistently, calibrate both axes, smooth sensor noise, and avoid sudden jumps. Detect unavailable sensor values and explain the fallback instead of silently pretending the gesture works.
> HARMONIC SYNTHESIS
> Keep additive synthesis so the sound is actually made from harmonics:
>
> * Harmonic n has frequency n × f0.
> * Support up to 12 components, including the fundamental.
> * Use a 1/n amplitude profile as the starting recipe.
> * Sideways tilt should progressively introduce higher harmonics with smooth amplitude fades rather than abrupt switching.
> * At minimum richness, only the fundamental is audible.
> * At maximum richness, all 12 components are present, subject to the audio sample-rate limit.
> * Keep the fundamental present.
> * Smooth audio parameter changes and prevent clipping.
> * Make normalization behavior explicit. Avoid unnecessary loudness jumps, but do not claim equal perceived loudness unless that is actually implemented and verified.
> * Label the control “Harmonic richness,” since smoothly fading partials is not the same as an integer component count.
>
> EXPRESSION AND SUSTAIN
> In Flow mode, add:
>
> * “Steady sustain” — a sustained tone while armed, with a separate expression slider; this is the default for the new mapping.
> * “Movement expression” — preserve movement-controlled strength as an option.
>
> Provide the expression slider on the phone as well as the laptop, synchronized between them. Keep Master Volume separate and explain the difference simply.
> Preserve Start Audio, Arm, Stop Audio, and Mute/Panic behavior. Steady sustain must respect existing connection and sensor safety checks. A disconnected or stale phone must not leave a stuck note.
> PITCH LOCK FOR DEMONSTRATION
> Add a “Lock fundamental” toggle with an editable Hz value.
>
> * When enabled, forward/back tilt no longer changes pitch.
> * Sideways tilt still changes timbre.
> * Use 200 Hz as an easy demonstration value.
> * Clearly show when pitch is locked.
> * Define its interaction with Continuous/Pentatonic mode so the displayed and audible frequency agree.
>
> MAKE THE SOUND UNDERSTANDABLE
> Add a compact live harmonic panel showing:
>
> * Current fundamental in Hz.
> * Harmonic number, frequency, and relative amplitude for components 1–12.
> * Bars that update as higher harmonics fade in.
> * A clear distinction between recipe amplitudes and any normalization applied to the output.
>
> Example at f0 = 200 Hz:
> H1 = 200 Hz, H2 = 400 Hz, H3 = 600 Hz, H4 = 800 Hz.
> Update the existing Movement Score:
>
> * Keep the pitch track.
> * Keep movement intensity visible.
> * Show expression separately and label its current source.
> * Replace integer harmonic steps with a continuous richness trace when using the new mapping.
> * Clearly distinguish gesture/control history from measured audio.
>
> Keep the measured spectrogram, waveform, and spectrum. Ensure their labels remain accurate and their displays reflect the audio actually produced.
> UPDATE GUIDANCE AND DEMO
> Update tooltips, explanatory text, guided tour, and phone instructions so they describe the selected mapping accurately.
> Include these explanations in natural language:
>
> * Fundamental: the base frequency of this harmonic sound.
> * Harmonics: whole-number multiples of the fundamental.
> * Changing the fundamental moves all harmonic frequencies together.
> * Changing harmonic amplitudes changes the waveform and timbre while the fundamental can stay fixed.
> * Timbre is tone quality; brightness is one aspect of it.
> * Expression controls signal strength; Master Volume controls listening level.
>
> Update the existing automatic demo to show:
>
> 1. A pure 200 Hz sine.
> 2. Pitch held at 200 Hz while higher harmonics gradually fade in.
> 3. Harmonic balance held steady while the fundamental changes.
>
> The demo must use the real synthesis and visualization paths, and must clearly indicate simulated input. Keep a manual laptop fallback for pitch and richness so I can present without a connected phone.
> SCOPE AND VALIDATION
> Preserve the existing phone pairing and Frequency Playground. Keep the interface approachable and avoid adding unrelated features.
> Check:
>
> * Pitch lock holds the fundamental while richness changes.
> * Harmonic frequencies remain n × f0.
> * Minimum richness produces only the fundamental.
> * Richness fades are smooth and do not create stuck oscillators.
> * Expression operates independently in steady-sustain mode.
> * Legacy mapping and Accents still work.
> * Calibration, missing sensors, disconnect, Stop, and Panic behave correctly.
> * Demo and manual controls work without a phone.
> * Run the project’s relevant checks and production build.
>
> Report which checks you actually performed. Distinguish automated/simulated checks from physical phone tests.
> Finally, give me:
>
> 1. A short summary of what changed.
> 2. Exact steps for testing on my phone.
> 3. A natural explanation of the gesture-to-sound mappings.
> 4. A brief technical explanation of how richness changes harmonic amplitudes.
> 5. A 60–90 second presentation walkthrough with click and movement cues.

</details>

**Fixing calibration after phone testing.** When I tested on my phone, tilting forward sometimes changed richness too. I asked for clearer holding instructions and a pure tone at neutral, with a small dead zone. I also asked for a live readout and a "Lock richness" option:

<details>
<summary>Calibration and gesture fixes (verbatim, October 19)</summary>

> The improved instrument works, but physical phone testing revealed a usability issue with calibration and gesture separation.
> Depending on how I hold the phone during calibration, “toward/away” and “left/right” become unclear. When I try to change only pitch with forward/back tilt, I sometimes see harmonic richness changing too.
> Please inspect the orientation mapping and improve this behavior:
>
> 1. Make calibration instructions explicit:
>    * Hold the phone in portrait orientation, screen facing you, comfortably tilted back slightly rather than lying flat.
>    * Show a simple illustration of the recommended starting position.
>    * Define forward/back tilt and sideways lean visually.
>    * Detect unsupported or unreliable holding positions where practical and explain how to reposition.
> 2. Inspect how beta/gamma and screen orientation are converted into pitch and sideways lean. Subtracting neutral Euler angles alone may not provide intuitive separation for arbitrary starting orientations. Use an appropriate orientation-relative mapping, and handle angle wrapping and screen rotation consistently.
> 3. Change the new tilt mapping so calibrated neutral produces only the fundamental, rather than 50% harmonic richness. Deliberate sideways lean in either direction should progressively increase richness; returning to neutral should return to a pure tone. Explain this mapping clearly in the interface.
> 4. Add a small, adjustable sideways dead zone around neutral so minor unintended lean does not introduce harmonics. Start around 5 degrees and smoothly map the remaining range to richness, without a sudden jump at the boundary.
> 5. Show live forward/back tilt, sideways lean, and richness together so I can identify whether an unintended change comes from sensor readings or synthesis.
> 6. Add an optional “Lock richness” control that holds the current harmonic recipe while I demonstrate pitch, complementing the existing fundamental lock.
>
> Preserve the original movement-intensity mapping. Update the phone instructions, guided tour, and demo to match the revised tilt mapping.
> Validate the mapping with simulated orientation cases, and provide a short physical phone test procedure. Do not claim that physical gesture separation has been verified without testing on a phone.

</details>

### What Claude built

Claude built the laptop page and the phone Controller page, paired over WebRTC with PeerJS. It turned the sensor data into pitch and harmonics on an additive synthesizer, with Flow and Accents modes and Continuous and Pentatonic pitch. It also built calibration, safety rules such as going silent when the phone disconnects, a Laptop Demo and the spotlight tour. Claude also set up the Git repository and the GitHub Pages deployment. Later, it added the Tilt instrument and the orientation-relative tilt and lean.

### How it was tested

Claude ran unit tests and end-to-end browser checks, with a simulated phone paired through the real PeerJS service. They grew from 33 tests and 46 checks on Oct 13 to 51 tests and 67 checks on Oct 19, and all passed, including on the live site. I tested the Oct 18 version on my own phone. That test is what led to the Oct 19 calibration fixes.

## Frequency Playground: microphone input (assignment 1, October 25)

### Main build prompt

<details>
<summary>Build prompt (verbatim, October 25)</summary>

> I’m continuing my existing sound-lab capstone project for Professor Minces. Please inspect the repository and its instructions before making changes.
> This week’s assignments are:
>
> 1. Add a microphone button that activates the microphone and lets me visualize the waveform and frequency spectrum.
> 2. Record sustained vowels, manually adjust harmonic amplitudes to recreate them at the same fundamental, save original and synthesized sounds, and compare the vowels at another pitch.
> 3. Investigate and attempt automatic vowel analysis and resynthesis, including discussing existing approaches, Fourier transforms, and filters.
>
> IMPLEMENT ASSIGNMENT 1 ONLY NOW. I want to test and understand it before we build assignments 2 and 3. Do not implement automatic pitch detection, vowel recognition, automatic harmonic fitting, or vowel synthesis in this stage.
>
> PROJECT LOCATION AND SCOPE
>
> All three assignments belong exclusively in Frequency Playground, the FIRST app where I manually enter frequencies and amplitudes and view the waveform and spectrum.
>
> Implement assignment 1 only now: add microphone activation and live microphone waveform/spectrum visualization to Frequency Playground.
>
> Later, we will extend this same app for manual vowel reconstruction and an attempt at automatic vowel synthesis.
>
> Do not add these features to Motion Score. Do not modify its phone controls, interface, or behavior. Do not create a separate app.
>
> GOAL
> I should be able to:
>
> * Click an obvious microphone button.
> * Grant microphone permission.
> * Speak or sustain a vowel.
> * See a live waveform of the microphone signal.
> * See a live frequency spectrum of that same signal.
> * Freeze a view to inspect it.
> * Stop the microphone and clearly see that it is no longer active.
>
> MICROPHONE CONTROLS
> Add a compact, clearly labeled microphone section with:
>
> * Enable Microphone.
> * Stop Microphone.
> * A clear status such as Off, Requesting permission, Listening, or Error.
> * A simple input-level meter.
> * Freeze View / Resume View.
>
> Use the browser microphone APIs with an explicit user click to request access. Handle permission denial, missing microphones, unavailable devices, and insecure contexts with clear, actionable messages.
> Stop Microphone must stop the actual media tracks and release the device, not just hide the graphs.
> Clean up tracks, audio nodes, and animation loops when leaving the page. Repeatedly enabling and stopping the microphone must not create duplicate streams or accumulating audio nodes.
> Freeze View should pause the visual display while leaving microphone capture active. Make that distinction visible so it cannot be mistaken for stopping the microphone.
> AUDIO CAPTURE AND FEEDBACK
> Analyze the microphone without routing live microphone audio to the speakers. I do not want monitoring, echo, or feedback.
> Request that echo cancellation, noise suppression, and automatic gain control be disabled where supported, since they can alter a sustained vowel’s spectrum. Read the applied settings where available; do not claim that a browser honored a request unless its settings confirm that.
> Do not change the whole app’s audio configuration unnecessarily.
> Keep microphone analysis and synthesized playback separate:
>
> * Clearly identify which signal each graph displays.
> * Do not mix microphone input with generated sound in one measurement.
> * Prefer microphone-specific plots in this stage so the existing synthesis plots remain understandable.
> * If synthesized audio is already playing when microphone capture starts, stop or pause it and explain why. Do not resume playback unexpectedly.
> * Mention briefly that speakers can be picked up by the microphone and headphones help when comparing sounds later.
>
> WAVEFORM
> Show a genuine live waveform measured from microphone samples.
> Include:
>
> * Horizontal axis labeled in milliseconds.
> * Vertical axis labeled as relative digital amplitude, not sound pressure.
> * A few useful time-window choices, including approximately 20 ms and 100 ms.
> * A usable vertical scale so a quiet microphone signal remains visible.
> * If auto-fit is used, show that it is enabled and display the current scale.
>
> Make sure time-window changes correspond to the actual amount of sampled audio displayed. Do not label the same buffer as different durations without selecting or resampling it appropriately.
> A sustained vowel should show repeated structure at a short time scale, while ordinary speech should show a changing waveform.
> FREQUENCY SPECTRUM
> Show a genuine live spectrum calculated from the same microphone input.
> Include:
>
> * Frequency axis in Hz.
> * Magnitude axis in dB, with clear wording that these are digital signal levels and not calibrated acoustic dB SPL.
> * A readable default range suitable for voice and its harmonics, for example 0–5000 Hz.
> * A way to inspect lower frequencies more closely.
> * A sensible FFT size and moderate visual smoothing.
>
> Explain the selected FFT size in simple terms: a longer analysis window helps separate nearby frequencies but responds more slowly. If displaying bin spacing, calculate it from the actual audio context sample rate and FFT size.
> Make axes and plotted data agree when changing the frequency range or scale.
> Do not automatically label the largest peak as the fundamental. A voice’s strongest peak may be a higher harmonic. Fundamental estimation belongs to a later stage.
> Do not label every peak as a harmonic without establishing that relationship. Use neutral labels such as “frequency peak” where needed.
> STUDENT-FRIENDLY EXPLANATIONS
> Keep the main interface concise. Add a short expandable explanation containing:
>
> * “The waveform shows how the microphone signal changes over time.”
> * “The spectrum shows which frequencies are present and how strongly they appear.”
> * “A sustained vowel often contains regularly spaced harmonic components. The strongest peak is not necessarily the fundamental.”
> * “Changing the graph’s time window or frequency range changes the view, not your voice.”
> * “Freeze View holds the graphs still. Stop Microphone turns off microphone capture.”
>
> Use simple language. Put implementation details in developer notes rather than filling the interface with technical terms.
> PREPARATION FOR LATER ASSIGNMENTS
> Structure the microphone input so a later stage can record a short vowel and analyze stored samples.
> However, do not add recording/export, original-versus-synthesized comparison, vowel presets, automatic analysis, or new synthesis controls yet. Those belong to assignments 2 and 3.
> DESIGN
> Match the existing app’s visual style.
> Make the microphone controls easy to find.
> Keep input status and graph source labels visible.
> Make important controls usable on the laptop without a guided tour.
> Keep the Frequency Playground’s existing manual controls functional.
> VALIDATION
> Run the relevant existing checks and production build.
> Verify as far as the available environment allows:
>
> 1. Microphone permissions and errors are handled.
> 2. The waveform and spectrum use the microphone source.
> 3. No microphone signal is routed to the speakers.
> 4. Freeze and resume behave as labeled.
> 5. Stop releases the microphone.
> 6. Repeated start/stop and route changes clean up resources.
> 7. Existing manual synthesis and the phone instrument remain functional.
> 8. Plot scales and FFT calculations use the actual sample rate.
>
> If you use simulated microphone input, identify those checks as simulated. Do not claim that physical microphone capture or listening was tested unless it actually was.
> WHEN FINISHED
> Give me:
>
> 1. A concise summary of the changes.
> 2. Exact steps to launch and test the feature.
> 3. What I should expect when silent, speaking normally, and sustaining “ah.”
> 4. A plain-language explanation of the waveform, spectrum, and FFT.
> 5. Known limitations and which checks require my physical microphone.
> 6. A natural 45–60 second progress-video script with exact click cues.
>
> Keep the explanation clear enough that I can answer questions about what I built. Explain unfamiliar terms instead of assuming I understand them.
> Implement locally and report the result. Do not publish or deploy changes unless the repository’s established workflow or my instructions already authorize it.

</details>

### What I wanted

I wanted to see my own voice as a waveform and a spectrum before trying to recreate vowels, and I kept this stage deliberately small. I made several design decisions in the prompt:
- The microphone must never play through the speakers.
- Echo cancellation, noise suppression and auto gain should be turned off where the browser allows.
- Freeze View has to be clearly different from Stop Microphone.
- The app must not label the tallest peak as the fundamental.

### What Claude built

Claude added Enable and Stop Microphone, a status display, a level meter, and Freeze View and Resume View. It also added separate microphone-only waveform and spectrum plots.

### How it was tested

Claude's checks with a simulated microphone passed: 68 unit tests and 46 browser checks. The existing synthesizer checks also still passed. I then tested it with my real microphone before it was published.

## Frequency Playground: Vowel Lab (assignment 2, October 25)

### Main build prompt

<details>
<summary>Build prompt (verbatim, October 25)</summary>

> Implement ASSIGNMENT 2 in my existing Frequency Playground, the FIRST app, building on the completed microphone feature.
> Read the repository instructions and inspect the existing implementation before editing. Preserve the microphone feature, existing manual-frequency experiments, and Motion Score.
> PROFESSOR’S INSTRUCTIONS
> “Pick a few vowels (match the tone), make sure the fundamental is the same. Tinker with the harmonics (sliders) so you recreate your vowels. Save the original sound and the synthesized sound so you share it with the class. Try the same vowels with a different pitch. Note the differences. Send a video by Monday afternoon. Less than 3 minutes.”
> MY GOAL
> Give me an understandable workflow for manually recreating sustained vowels using harmonic amplitude sliders.
> I should do the listening, comparison, and slider adjustments myself. Do not implement automatic harmonic fitting, automatic vowel reconstruction, or a button that creates a finished match. Those belong to assignment 3.
> Keep the interface focused on this sequence:
> Record → inspect → set fundamental → adjust harmonics → compare → save → repeat at another pitch.
>
> 1. RECORD AND KEEP A VOWEL REFERENCE
>
> Extend the microphone section so I can:
>
> * Record a short sustained vowel, approximately 2–4 seconds.
> * Name it, for example “ah — lower pitch.”
> * Listen back to the actual recording.
> * Select a stable portion for inspecting its waveform and spectrum.
> * Keep the recording available after stopping the microphone.
> * Download the original recording as an audio file.
>
> Prefer WAV export for portability. If using another format, label its actual format accurately.
> Keep recordings local to the browser unless I explicitly export them. Explain whether recordings survive refresh. Do not imply that they are permanently saved if they only exist in memory.
> Support several labeled examples, such as:
>
> * “ah” as in father
> * “ee” as in see
> * “oo” as in food
>
> These should be recording labels and instructions, not presets that automatically supply the correct harmonic amplitudes.
> Do not overwrite a previous recording silently.
>
> 2. HELP ME MATCH THE FUNDAMENTAL MANUALLY
>
> Provide an editable fundamental-frequency field and a quiet reference-tone button.
> Suggested workflow:
>
> * Play a comfortable reference pitch.
> * Stop the tone.
> * Record myself sustaining a vowel at approximately that pitch.
> * Inspect the recording and adjust the synthesis fundamental to match the actual recording.
>
> Do not require me to sing an arbitrary 200 Hz if another pitch is more comfortable.
> For this stage, support manual estimation:
>
> * Let me zoom into the recorded waveform and spectrum.
> * Provide a frequency cursor/readout.
> * Let me enter a candidate fundamental and display expected harmonic positions at its multiples.
> * Explain that spacing between several harmonic peaks and waveform repetition can help estimate the fundamental.
> * Explain that the strongest spectral peak is not necessarily the fundamental.
>
> Do not silently introduce automatic fundamental estimation. If reliable matching requires an additional tool, explain the limitation rather than presenting an unverified estimate as correct.
> Show the synthesis fundamental clearly so I can demonstrate that it matches the reference approximately. Do not claim the voice maintains one perfectly constant frequency.
>
> 3. ADD A MANUAL HARMONIC EDITOR
>
> Provide a dedicated harmonic-editing mode within Frequency Playground.
> In this mode:
>
> * Each component frequency is n × the selected fundamental.
> * Each harmonic has an independently editable amplitude slider and numeric value.
> * Show harmonic number and frequency beside each slider.
> * Permit amplitude zero.
> * Changing the fundamental updates all harmonic frequencies while preserving their relative amplitude settings.
> * Keep arbitrary-frequency entry available in the original mode.
>
> Provide enough harmonics to explore vowel resonances across several kilohertz. Inspect existing limits and choose a practical adjustable count, preferably supporting up to 32 or more if the architecture handles it cleanly. Explain any limit. Exclude components at or above Nyquist.
> Do not assume that a fixed 1/n profile can recreate every vowel. Let me shape the amplitudes freely. Start from a simple neutral recipe, not a hidden vowel match.
> Smooth slider changes to avoid clicks, and manage output peaks without falsely promising equal perceived loudness.
>
> 4. COMPARE THE RECORDING AND SYNTHESIS
>
> Provide clearly labeled:
>
> * Play Original
> * Play Synthesized
> * Stop
> * An easy way to alternate between them
>
> Avoid overlapping playback by default. Stop competing audio before recording or playing a comparison.
> Show the original and synthesized spectra on a common frequency axis, either together with a clear legend or aligned side by side.
> For visual comparison:
>
> * Use compatible FFT/window settings.
> * Label any normalization or relative-level alignment.
> * Do not imply that an absolute amplitude match is calibrated across the microphone and synthesizer.
> * Clearly identify the selected recorded segment used for analysis.
> * Explain that amplitude-only synthesis may resemble the vowel without reproducing the recording’s exact waveform, phase, breathiness, or pitch fluctuations.
>
> The synthesized sound must actually come from my harmonic settings, not replay the original recording.
>
> 5. SAVE ORIGINAL AND SYNTHESIZED RESULTS
>
> For each experiment, let me save:
>
> * Original recording
> * Synthesized audio rendered from the current manual settings
> * Fundamental and harmonic amplitudes
> * Vowel label and pitch condition
> * Brief notes on what matched and what differed
>
> Use clear filenames such as:
> ah_lower_original.wav
> ah_lower_synthesized.wav
> ah_lower_settings.json
> Render synthesized exports using the same recipe and relevant gain behavior as playback. Include short onset/offset fades to avoid clicks.
> Provide settings export/import so I can restore my work. If feasible, keep experiments in browser storage, but still provide downloads and explain storage limitations.
> Make it clear when slider changes have not yet been saved to an experiment.
>
> 6. COMPARE A SECOND PITCH
>
> Let me duplicate an experiment before changing its fundamental so I preserve the first version.
> Support two clearly distinguished comparisons:
> A. Keep the same harmonic amplitude settings and change the fundamental.
> B. Record the same vowel at the new pitch and manually readjust amplitudes to recreate that new recording.
> Include a simple notes area:
>
> * What changed in pitch?
> * Did the vowel remain recognizable?
> * Which harmonic amplitudes needed adjustment?
> * What differences remain between original and synthesis?
>
> Explain this point in accessible language:
> Changing the fundamental shifts the harmonic frequencies. However, a vowel’s resonances, called formants, relate to vocal-tract shape and do not simply move in proportion to the fundamental when we try to keep the same vowel. Therefore, preserving the same amplitudes by harmonic number may change the perceived vowel at a different pitch.
> Do not claim formants stay perfectly fixed in real speech, and do not label individual harmonics as formants. Keep this explanation in expandable help.
>
> 7. MAKE IT EASY TO PRESENT
>
> Use a clear layout with these stages:
>
> 1. Record a vowel.
> 2. Match its fundamental.
> 3. Shape its harmonics.
> 4. Compare and save.
> 5. Repeat at another pitch.
>
> Keep existing advanced plots available, but prioritize the controls needed for this experiment.
> Add a short guide explaining what I should do myself. Do not replace the experiment with ready-made results.
>
> 8. VALIDATE
>
> Run relevant checks and the production build.
> Verify:
>
> * Recordings remain playable after the microphone stops.
> * Exported original audio contains the captured recording.
> * Harmonic frequencies follow n × fundamental.
> * Sliders independently change harmonic amplitudes.
> * Original and synthesized playback do not overlap unexpectedly.
> * Saved experiments and imported settings restore correctly.
> * Synthesized exports reflect the saved recipe.
> * Duplicating and changing pitch preserves the original experiment.
> * Audio nodes, streams, and recording resources clean up correctly.
> * Assignment 1 and the original manual-frequency mode still work.
> * Motion Score remains unchanged.
>
> Distinguish simulated checks from physical microphone/listening tests.
>
> 9. EXPLAIN THE RESULT TO ME
>
> When finished, provide:
>
> * A concise implementation summary.
> * Exact steps for my first “ah” experiment.
> * How to estimate and match the fundamental manually.
> * A practical strategy for adjusting harmonic sliders by looking and listening, without giving me fabricated “correct” amplitudes.
> * How to repeat with “ee” and “oo.”
> * How to compare the same vowels at another comfortable pitch.
> * Known limitations and an honest explanation of why the match may sound imperfect.
> * A suggested video outline under three minutes, leaving time to play the original and synthesized sounds.
>
> Implement assignment 2 locally first so I can test it. Do not implement assignment 3 or automatically publish this new stage yet.

</details>

### What I wanted

The assignment was to recreate vowels by hand with harmonic sliders. I wanted to do the listening and adjusting myself, so I said not to add automatic fitting or a button that makes a finished match. I asked for a record, inspect, set fundamental, adjust harmonics, compare and save workflow. I also asked for a way to duplicate an experiment, so I could compare the same vowel at a second pitch.

### What Claude built

Claude built Vowel Lab inside Frequency Playground:
- Named vowel recordings saved in the browser, with WAV export and import.
- Tools for estimating the fundamental by hand.
- Up to 48 harmonic sliders at n × f₀.
- Original and Synthesized playback with overlaid spectra.
- Saved experiments with settings files.

### How it was tested

Claude's checks with a simulated microphone passed: 83 unit tests and 49 Vowel Lab browser checks. I tested Vowel Lab myself and did the slider matching by ear. For example, my lower "ah" came out at about 248 Hz, and my "oo" matched best with only harmonics 1–4.

## Frequency Playground: automatic vowel synthesis and guided tour (assignment 3, October 25–27)

### Main build prompt

<details>
<summary>Build prompt (verbatim, October 25)</summary>

> Please help me attempt assignment 3 in my existing Frequency Playground app.
>
> Project: ~/Desktop/frequency-playground
>
> IMPORTANT: These changes belong only in Frequency Playground, the first app. Do not modify Motion Score.
>
> My professor’s instructions:
> “Find an automatic way of synthesizing your vowels. That means finding the fundamental frequency and the harmonics and playing stuff back. This might be difficult. You can fail.”
>
> He clarified:
> “This should involve discussing with Claude how to do it. How people have done it before. What are the different approaches? You might start learning about Fourier Transforms and filters. Struggling is the point.”
>
> WHAT I ALREADY HAVE
>
> The app has microphone recording, waveform and spectrum displays, and a Vowel Lab where I can:
> - Save recordings of ah, ee, and oo.
> - Select a steady section of a recording.
> - Manually estimate the fundamental.
> - Adjust up to 48 harmonic amplitudes.
> - Compare original and synthesized playback.
> - Save recordings, synthesized WAVs, and settings.
>
> Please inspect the existing code to confirm its behavior before implementing anything. Preserve my saved experiments and recordings. Do not overwrite my manual matches.
>
> My manual results:
> - Lower ah: approximately 248 Hz.
> - Lower ee: approximately 243 Hz.
> - Lower oo: approximately 248 Hz.
> - Higher oo: approximately 300 Hz.
> - Both oo matches improved when I reset to fundamental only, then added harmonic 2 at 0.1, harmonic 3 at 0.05, and harmonic 4 at 0.01, with the remaining harmonics off.
>
> These are approximate manual results for comparison, NOT values to hard-code into automatic analysis.
>
> FIRST: EXPLAIN THE APPROACHES
>
> Before implementing, give me a short, plain-language explanation of:
> 1. How an automatic method could estimate the fundamental from a recording.
> 2. How Fourier analysis can help estimate harmonic strengths.
> 3. How adding measured harmonics differs from using a sound source shaped by filters.
> 4. The main limitations of these approaches.
>
> Discuss established approaches and link to reliable primary sources, such as original papers or official technical documentation. Distinguish the approaches you considered from the one you actually implement.
>
> Explain unfamiliar terms when first used. I need to understand and present the work, not just have working code.
>
> After this explanation, proceed with a manageable first implementation. You do not need to wait for my approval.
>
> IMPLEMENTATION GOAL
>
> Start with automatic analysis and resynthesis of ONE selected steady section of a saved vowel. We do not need full speech synthesis or changing pitch throughout an entire recording yet.
>
> Add an “Automatic vowel synthesis” section or mode that fits naturally into the existing Vowel Lab.
>
> The workflow should be:
> 1. Select an existing recording and steady section.
> 2. Click “Analyze vowel.”
> 3. Automatically estimate its fundamental and harmonic strengths.
> 4. Display the estimated fundamental and the harmonic strengths.
> 5. Let me play Original, Synthesized, and Original → Synthesized.
> 6. Let me save the automatic result as a separate experiment and download the synthesized WAV and analysis/settings.
>
> This must create a new sound from estimated parameters, not simply replay, loop, or pitch-shift the original recording.
>
> TECHNICAL EXPECTATIONS
>
> Choose a practical approach after reviewing the code. A reasonable starting point would be:
> - Estimate the fundamental using a periodicity-based method, such as autocorrelation or YIN.
> - Use Fourier analysis or another justified measurement method to estimate amplitudes near whole-number multiples of the estimated fundamental.
> - Feed those estimates into the existing additive synthesizer.
>
> Please:
> - Do not assume the tallest spectrum peak is always the fundamental.
> - Analyze several short frames within the selected section where practical, so one unusual moment does not determine the whole result.
> - Account for the recording’s sample rate and explain your analysis settings.
> - Handle frequency estimates that fall between FFT bins appropriately.
> - Avoid treating every small noise peak as a harmonic.
> - Respect the app’s harmonic limit and the highest frequencies the sample rate can represent.
> - Normalize playback safely without destroying the relative harmonic strengths.
> - Reset the complete harmonic array before applying an automatic result so leftover manual harmonics cannot remain active.
> - Keep automatic analysis separate from my manual settings until I explicitly save or apply it.
>
> Let me correct the estimated fundamental and rerun harmonic analysis if necessary. Clearly label this as a manual correction rather than fully automatic detection.
>
> If the recording is silent, too noisy, or not steady enough, explain the problem clearly. Do not silently return a confident-looking result. Any reliability indicator should be explained and should not be presented as a probability unless it actually is one.
>
> INTERFACE
>
> Keep the controls simple and use plain labels:
> - Analyze vowel
> - Estimated fundamental (Hz)
> - Play Original
> - Play Synthesized
> - Original → Synthesized
> - Stop
> - Save automatic result
> - Download synthesized WAV
> - Download analysis/settings
>
> Reuse existing controls where appropriate instead of duplicating everything.
>
> Show the original and synthesized spectra together. Explain that this compares their frequency patterns, and that waveform shapes can differ because of phase even when harmonic strengths are similar.
>
> Add a short explanation inside the app:
> “The app estimates the base frequency and the strengths of its harmonics from a steady part of your recording, then combines new sine waves to recreate that sound.”
>
> TESTING
>
> Run the relevant tests and production build.
>
> Include meaningful checks using known synthetic inputs:
> - A tone with a known fundamental and known harmonic strengths.
> - A case where a higher harmonic is stronger than the fundamental.
> - Silence or unsuitable input.
> - Confirmation that automatic analysis does not overwrite saved manual experiments or leave old harmonics active.
>
> Be clear about what you can test with simulated audio and what requires me to record and listen on my Mac. Do not claim a vowel sounds accurate unless it has actually been evaluated by listening.
>
> Do not commit, push, or publish yet. Leave this locally for me to test.
>
> WHEN FINISHED
>
> Give me:
> 1. A concise summary of what you implemented.
> 2. Exact click-by-click instructions to test it with my saved oo recording first.
> 3. A natural explanation I can give my professor of how it works.
> 4. An honest account of limitations, failures, and anything not yet tested.
> 5. A short comparison of the implemented method with the alternative approaches discussed.
> 6. A markdown guide named AUTO_VOWEL_UPDATE.md documenting the approach, sources, test steps, and actual results.
>
> Please keep the first version focused and understandable. The assignment values investigating and understanding the process, even if the synthesized vowel is imperfect.

</details>

### What I wanted

My professor said this part might fail and that understanding the process was the point. So I asked Claude to explain the approaches and their sources first, then build one manageable version. I gave my manual results as a comparison and said not to hard-code them. I also asked that automatic results never overwrite my manual experiments, and that an unreliable result be explained instead of looking confident.

### What I clarified or changed

I first asked for a click-through tutorial popup. Then I decided it was too text-heavy and asked for an on-page tour like the one in Motion Score:

<details>
<summary>Tutorial request (verbatim, October 27)</summary>

> Please update my existing Frequency Playground project:
>
> ~/Desktop/frequency-playground
>
> I want two things:
> 1. A click-through tutorial popup for Vowel Lab and automatic vowel synthesis.
> 2. The automatic synthesis feature and tutorial committed, pushed, and published to my existing GitHub Pages site.
>
> These changes are for Frequency Playground only. Please do not modify Motion Score.
>
> FIRST: CHECK THE PROJECT
>
> Inspect the existing code, Git status, branch, and deployment workflow. The automatic synthesis feature is already implemented locally but has not yet been committed or published.
>
> Preserve my existing recordings, saved experiments, and manual matches. The tutorial must not change my settings or recordings unless I explicitly choose to do so.
>
> BUILD THE TUTORIAL
>
> Add a clearly visible button in Vowel Lab, such as “How to use Vowel Lab,” that opens a tutorial popup. I want to click Next and Back through short, easy-to-understand steps, with a Close button available throughout.
>
> Use plain language and small, concrete examples. Explain the actual controls and behavior you find in the current app. Do not invent controls or promise features the app does not have.
>
> Please cover:
>
> 1. What the lab is for: recording a vowel and trying to recreate it using harmonics.
>
> 2. Recording a vowel: choosing a vowel and pitch label, using the reference tone, recording, and selecting a saved take. Explain that the pitch label itself does not change the sound.
>
> 3. Selecting a steady section: explain why I should avoid the beginning and end if my voice is changing.
>
> 4. Finding the fundamental manually: explain the repeating waveform and spectrum, with a simple example. For example, a pattern that repeats about every 4 milliseconds suggests about 250 Hz.
>
> 5. Harmonic sliders: explain that the fundamental is the base frequency, the other harmonic frequencies are whole-number multiples, and the sliders change their strengths. Use a simple 200 Hz example: 200, 400, 600 Hz, and so on. Explain the reset options.
>
> 6. Comparing sounds: explain the Original, Synthesized, and Original → Synthesized buttons, plus what the waveform and spectrum show.
>
> 7. Saving and downloading: explain how experiments are saved, what the original WAV, synthesized WAV, and settings file contain, and how to return to an experiment.
>
> 8. Trying another pitch: explain the existing duplicate options accurately and what the user can compare.
>
> 9. Automatic synthesis: explain where to find it, how to analyze the selected recording section, what the estimated fundamental and harmonic strengths mean, how to listen to the result, and how to save it separately. Explain what happens if the result is uncertain and that a manually corrected fundamental is labelled as such.
>
> 10. A short wrap-up: matching pitch and adjusting harmonic strengths both matter, and a synthesized vowel may not sound exactly like a real voice.
>
> Make each screen brief enough to read comfortably. Show progress, such as “Step 3 of 10,” and allow reopening the tutorial at any time. Make it usable on a phone-sized screen, keyboard accessible, and easy to close.
>
> If helpful, point users toward relevant parts of the app, but prioritize a straightforward, readable popup over a complicated interactive tour. The tutorial should explain the current app without requiring users to record or change settings during the walkthrough.
>
> TEST AND PUBLISH
>
> Run the relevant tests and production build. Check that:
> - The tutorial opens, advances, goes back, and closes.
> - Existing manual and automatic workflows still work.
> - Saved recordings and experiments are preserved.
> - The automatic synthesis feature is included in the production build.
>
> Then commit the relevant Frequency Playground changes, push them, and publish through the repository’s existing GitHub Pages workflow. I authorize you to commit, push, and publish these changes. Do not force-push or overwrite unrelated work. Exclude personal recordings, downloaded experiment files, and secrets.
>
> Check the deployment status and, if possible, verify the published page has both the tutorial and automatic synthesis section. Distinguish a successful build/deployment from anything you could not test.
>
> WHEN FINISHED
>
> Tell me:
> 1. What you added.
> 2. The exact steps to open the tutorial and automatic synthesis on the published site.
> 3. Whether the commit, push, and deployment succeeded, and the public link.
> 4. Which checks passed and anything you could not verify.
> 5. Whether my experiments saved on localhost will appear on GitHub Pages, and how to bring them over if they do not.

</details>

<details>
<summary>Guided tour request (verbatim, October 27)</summary>

> Please improve the Vowel Lab tutorial in ~/Desktop/frequency-playground.
>
> The current tutorial is a text-heavy popup. I want it to work more like the immersive walkthrough in my Motion Score project: move around the actual page, highlight the relevant control, and give a short explanation right beside it.
>
> Please inspect the Motion Score walkthrough and the current Vowel Lab code first. Reuse its approach if practical, while making sure the tour fits Vowel Lab’s controls and layout. Do not change Motion Score itself.
>
> WHAT I WANT
>
> When I click “How to use Vowel Lab”:
>
> - Take me directly to the first relevant control on the page.
> - Scroll vertically or horizontally as needed so the control is visible.
> - Highlight the actual button, field, slider, or graph being explained.
> - Show a small, readable explanation near that control.
> - Let me click Next and Back to move through the tour.
> - Automatically move and highlight the next control at every step. I shouldn’t need to press a separate “Show me on the page” button.
> - Include a step counter and a clear Close or Skip button.
> - Keep explanations short: ideally one or two sentences per step. Use simple language and small examples only where they help.
>
> Please inspect the actual interface and cover the important parts of the workflow in a sensible order:
>
> 1. Selecting or starting an experiment.
> 2. Choosing a vowel and pitch label.
> 3. Playing a reference tone and recording a vowel.
> 4. Selecting a recorded take.
> 5. Selecting a steady portion of the recording.
> 6. Using the waveform and spectrum to estimate the fundamental.
> 7. Entering the fundamental.
> 8. Adjusting harmonic strengths and using the reset options.
> 9. Comparing the original and synthesized sounds.
> 10. Using automatic vowel synthesis: Analyze vowel, estimated results, playback, and saving separately.
> 11. Comparing the spectra.
> 12. Saving and downloading results.
> 13. Trying the same vowel at another pitch.
>
> Use more or fewer tour steps if needed, but avoid squeezing several controls into one explanation when they are far apart. You don’t need to explain every minor setting.
>
> The automatic section’s “Explain this section” button should start the tour at the relevant automatic-synthesis step.
>
> IMPORTANT DETAILS
>
> - The tour should only explain and highlight. It should never automatically record, play audio, change slider values, or save anything.
> - Preserve my saved recordings, experiments, manual matches, and automatic results.
> - Handle controls that are hidden, collapsed, unavailable, or only appear after recording. Don’t leave the tour pointing at an empty space. Explain what to do or gracefully skip the target.
> - Make sure the highlighted control and its explanation remain visible on both desktop and phone-sized screens. Position the explanation so it does not cover the control, and update it when the page scrolls or the window resizes.
> - Allow keyboard navigation and Escape to close. Return focus sensibly when the tour closes.
> - Keep the existing app’s visual style and make the highlight easy to see.
> - Check that every tour step points to the correct real control and that the walkthrough does not alter the app’s data.
>
> TEST AND PUBLISH
>
> Run the relevant tests and production build. Test the tour at desktop and phone-sized widths, including moving forward and backward, closing it, scrolling, and opening it from “Explain this section.” Check the behavior both with and without a saved recording.
>
> Then commit the relevant Frequency Playground changes, push normally, and publish using the existing GitHub Pages workflow. I authorize the commit, push, and publication. Do not force-push, include personal recordings or downloaded files, or overwrite unrelated work.
>
> When finished, tell me:
> 1. What changed and how to start the guided tour.
> 2. Which checks passed and anything you couldn’t verify.
> 3. Whether the commit, push, and deployment succeeded.
> 4. The live link so I can try it.

</details>

### What Claude built

Claude explained the options: autocorrelation, YIN and cepstrum for pitch, Fourier analysis for harmonic strengths, and additive versus source-filter synthesis. Then it implemented an "Automatic vowel synthesis" section:
- A YIN pitch estimate over many short frames.
- A windowed FFT measurement of each harmonic.
- A labelled manual pitch correction.
- Saving as a separate experiment.

It then replaced the tutorial popup with a 24-step tour that highlights the real controls.

### How it was tested

Claude ran tests with synthetic tones of known pitch, and they passed, including a case where a higher harmonic is louder than the fundamental. For a 248 Hz test tone, the app estimated 247.98 Hz. In the final version, all 100 unit tests passed, and so did 24 tour checks at desktop and phone sizes.

## Frequency Playground: Vowel filtering (assignment 4, October 31)

### Main build prompt

<details>
<summary>Build prompt (verbatim, October 31)</summary>

> Please implement the first two tasks from my professor’s new assignment in my existing Frequency Playground app.
>
> Project folder:
> ~/Desktop/frequency-playground
>
> These changes belong ONLY in Frequency Playground. Do not modify Motion Score.
>
> THE ASSIGNMENT
>
> 1. Incorporate a filter.
> 2. Recreate vowels by starting with the fundamental and all harmonics at maximum strength, then applying a filter.
>
> My professor demonstrated a filter by clicking and dragging a shape over the frequency spectrum. Moving parts of that shape up or down made different frequency regions stronger or weaker.
>
> I want an interactive version that helps me understand how filtering a harmonic sound can produce different vowels. I should be able to shape the filter manually or automatically estimate a filter from a recorded vowel. Also include approximate A, E, I, O, and U examples I can explore.
>
> FIRST: REVIEW THE EXISTING APP
>
> Inspect the existing manual frequency controls, Vowel Lab, automatic synthesis, audio generation, graphs, saving, and tutorial.
>
> Reuse the existing audio and comparison features where appropriate. Preserve all saved experiments and recordings. Existing manual and automatic workflows should continue working.
>
> Before implementing, briefly explain your proposed approach in plain language, then proceed. You do not need to wait for approval.
>
> HOW THE NEW FEATURE SHOULD WORK
>
> Add a clearly labelled “Vowel filtering” mode or section within Frequency Playground, with this workflow:
>
> 1. Choose the fundamental.
> 2. Start with the fundamental and all active harmonics at maximum strength.
> 3. Turn on the filter.
> 4. Drag the filter shape to make different frequency regions stronger or weaker in the output, or automatically fit a filter to a recording.
> 5. Compare the filtered sound with the recorded vowel.
> 6. Save the filter settings and synthesized sound.
>
> The goal is to shape whole regions of frequencies through a filter instead of manually adjusting every harmonic.
>
> STARTING SOUND
>
> Provide a button such as “Start with all harmonics at maximum.”
>
> - Set the fundamental component and every active harmonic amplitude to 1.
> - Clearly show how many components are active and their frequencies.
> - Let me choose the number of harmonics within the existing supported range.
> - Explain that equal starting strengths create a rich, buzzy sound.
> - Respect the sample rate’s frequency limit.
> - Keep playback at a safe, comfortable level through appropriate output scaling.
>
> IMPORTANT: “Maximum” means equal maximum relative component amplitudes. It must not mean summing dozens of full-volume oscillators directly into the speakers.
>
> THE FILTER
>
> Implement a real audio filter applied to the combined harmonic source, rather than only changing a graph or silently rewriting the manual harmonic sliders.
>
> Choose a practical browser audio approach after reviewing the project. Explain the implementation choice and any tradeoffs in the developer notes.
>
> My preferred interaction:
> - Show an editable filter curve over the frequency spectrum.
> - Provide a small number of visible draggable control points.
> - Drag left/right to choose the frequency region.
> - Drag up/down to change how much that region is reduced.
> - Make the relationship between the points and the actual filter response clear.
> - Make the sound update smoothly while I drag.
> - Support mouse and touch.
> - Also provide editable number fields or another accessible alternative to dragging.
>
> Prefer an attenuation-based design for the first version:
> - The top of the filter means “let this region through.”
> - Moving downward reduces that region.
> - A flat curve at the top leaves the source unchanged.
> - Avoid boost above the unfiltered level unless there is a clear reason to support it.
>
> Explain that a region can become more prominent relative to other regions because those other regions are reduced.
>
> If a fully draggable custom curve would make the first version unnecessarily fragile, use a small bank of real filters with draggable handles and a plotted combined response. The visible curve must accurately represent the actual audio processing. Do not draw an arbitrary curve that the audio does not follow.
>
> Include:
> - Filter on/off or Bypass, preserving settings.
> - Reset to flat.
> - A visible fundamental control that remains fixed while I shape the vowel.
> - Clear feedback about the selected filter point or band.
>
> Show the filter’s response separately from the measured sound spectrum, with a clear legend and scale. They can share the same chart if the axes are clearly distinguished. Do not confuse filter gain with the spectrum’s normalized peak level.
>
> MANUAL VOWEL MATCHING
>
> Let me select an existing recorded vowel and steady analysis section, or record/import a new one using the existing features.
>
> Provide:
> - Play Original
> - Play Unfiltered
> - Play Filtered
> - Original → Filtered
> - Stop
>
> Use the selected recording section for comparisons. Make it obvious which sound is playing.
>
> I should be able to:
> - Match the fundamental to my recording.
> - Keep all source harmonic strengths at maximum.
> - Shape the vowel using only the filter.
> - Hear what changes when the filter is bypassed.
>
> Do not automatically copy my old manual harmonic amplitudes into the source. My professor specifically wants the all-harmonics-at-maximum starting condition.
>
> Do not assume my previous approximate fundamentals, such as 248 or 300 Hz, are correct for every recording. Let me enter a value, and reuse existing estimation tools if appropriate. Label automatic estimates and manual corrections clearly.
>
> Show the recorded vowel’s spectrum alongside the filtered synthesized spectrum, and optionally the unfiltered spectrum if it stays readable.
>
> AUTOMATIC VOWEL FILTER MATCHING
>
> Support a second approach where the app analyzes a selected vowel recording and estimates a filter shape that makes the equal-strength harmonic source resemble it.
>
> In BOTH manual and automatic approaches, keep the source fundamental component and all active harmonic amplitudes at 1. The filter must perform the vowel shaping. Do not implement automatic matching by changing the source harmonic sliders.
>
> Automatic workflow:
> - Let me record or import a vowel and select a steady section.
> - Let me choose its label: A, E, I, O, or U.
> - Include an example word beside each label so the intended pronunciation is clear. Explain that vowel letters have different pronunciations across words and languages.
> - Reuse the existing automatic fundamental estimate where appropriate, with an option for manual correction.
> - Add a button such as “Match filter to recording.”
> - Estimate the recording’s broad frequency-strength pattern, then fit the actual filter controls to approximate that pattern from the equal-strength harmonic source.
> - Show the resulting editable filter shape and apply it to the audio.
> - Let me compare Original → Filtered, then drag the filter to improve the result.
> - Save the automatic filter result as a separate experiment.
>
> Use the recording’s measured harmonic strengths to guide filter fitting, accounting for noise and weak components. Aim to match broad frequency regions rather than reproduce every narrow FFT peak.
>
> Fit the filter that is actually implemented, so playback, the displayed response, and exported audio agree. Explain the chosen fitting method and its limitations.
>
> Because the filter only reduces frequencies, choose an appropriate overall target level so the desired relative pattern can be approximated without requiring boost. Handle overall playback level separately and clearly.
>
> VOWEL STARTING EXAMPLES
>
> Provide labelled A, E, I, O, and U starting filter shapes that I can try without recording first.
>
> Use clearly stated, sustained vowel pronunciations with example words. Avoid treating the English letter names, which may contain changing vowel sounds, as five universal steady vowels.
>
> These should be editable, approximate examples based on reliable phonetics sources. Do not present them as universal vowel settings or as analysis of my voice.
>
> Clearly distinguish:
> - “Load vowel example”: loads an approximate preset.
> - “Match filter to recording”: analyzes my actual recording and fits a filter.
>
> Keep the filter frequencies fixed when changing the source fundamental unless I deliberately edit or refit the filter. Explain that maintaining the same filter shape does not guarantee identical vowel perception at every pitch.
>
> Keep manual exploration possible. Presets should provide starting points, not replace the editable filter.
>
> LEARNING SUPPORT
>
> Add concise help inside the app:
>
> “The source starts with the fundamental and all active harmonics at equal strength. The filter reduces selected frequency regions, changing the balance of harmonics and the vowel-like character of the sound.”
>
> Explain simply:
> - Fundamental: the base frequency.
> - Harmonics: components at whole-number multiples of the fundamental.
> - Filter: changes the strength of frequency regions.
> - Formants: broad resonant regions emphasized by the vocal tract that help distinguish vowels. They are not individual harmonics.
>
> Make clear that the filter does not move the harmonic frequencies when the fundamental is fixed.
>
> Add a short guided tour that highlights the actual controls, using the existing immersive tutorial system. Keep each explanation short and automatically bring the highlighted control into view.
>
> SAVE AND EXPORT
>
> Allow saving this as a separate filter experiment without overwriting existing manual or automatic matches.
>
> Save enough information to reproduce the sound:
> - Fundamental.
> - Number of harmonics.
> - Equal source amplitudes.
> - Filter type and parameters/control points.
> - Filter enabled/bypassed state.
> - Recording association and selected section.
> - Whether the filter was manually shaped, loaded from an example, or automatically fitted.
> - Notes.
>
> Allow downloading:
> - Filtered synthesized WAV.
> - Settings JSON.
> - Original recording through the existing controls.
>
> The exported WAV must use the same source, filter processing, and level handling as playback, including sensible handling of filter startup and sound endings.
>
> A saved experiment should restore the correct filter and sound after reopening.
>
> LEVEL HANDLING
>
> Keep the comparison useful:
> - Avoid clipping.
> - Avoid automatic loudness changes that undo or hide the filter’s effects.
> - Keep unfiltered/filtered output gain consistent during a bypass comparison.
> - If optional loudness matching is available, label it clearly and explain what it changes.
> - Stop playback and handle errors cleanly.
>
> TESTING
>
> Run the relevant tests and production build.
>
> Include meaningful checks that:
> - Every active source component starts at amplitude 1.
> - Bypass preserves the unfiltered source.
> - A filter reduces the intended frequency regions.
> - Changing the filter does not change the fundamental or harmonic spacing.
> - The displayed response matches the implemented filter.
> - Automatic fitting changes only filter parameters and leaves all source amplitudes equal.
> - A known filter response can be approximately recovered from a synthetic test recording, with the fitting error reported.
> - Saved settings restore the same result.
> - WAV export includes the filter processing.
> - Existing saved experiments and other app modes remain intact.
>
> Check the interface at desktop and phone-sized widths.
>
> Be honest about the difference between tests with synthetic audio and real listening tests. Do not claim successful matching of real A, E, I, O, and U until I have recorded and listened to them.
>
> If fitting a useful filter proves difficult, show the best result with a clear explanation of the mismatch rather than silently substituting a different synthesis method.
>
> DELIVERY
>
> Keep this local for me to test first. Do not commit, push, or publish yet.
>
> When finished, give me:
> 1. A concise summary of what you built.
> 2. Exact click-by-click instructions to try matching my saved oo recording first, manually and automatically.
> 3. Instructions to try the five vowel starting examples.
> 4. A short, natural explanation of how the source and filter work together.
> 5. An explanation of the actual filter implementation and automatic fitting method in plain language.
> 6. Limitations and what still needs testing.
> 7. A FILTER_VOWEL_UPDATE.md guide with the approach, test steps, actual test results, and relevant primary sources for the filtering and vowel-synthesis concepts.
>
> Please prioritize an understandable, working first version that I can experiment with and explain to my professor.

</details>

### What I wanted

My professor showed a filter as a shape you drag over the spectrum. I wanted my own version: start from the fundamental and all harmonics at equal strength, then shape a vowel only with a real filter. I also asked for these rules:
- The filter only cuts, never boosts.
- The curve on screen has to match what the audio actually does.
- Automatic matching changes the filter, never the source harmonics.

### What I clarified or changed

After trying it, the feature felt centered on recordings. I asked to make recording optional and split it into three workflows: vowel examples, my own frequencies, and matching a recording:

<details>
<summary>Three-workflow request (verbatim, October 31)</summary>

> Please improve the Vowel filtering feature in Frequency Playground so recording my voice is clearly OPTIONAL.
>
> Project:
> ~/Desktop/frequency-playground
>
> Only modify Frequency Playground, not Motion Score.
>
> The current interface feels centered on selecting a recording. I also want to generate and filter sounds entirely from sine waves and frequencies I enter, with no microphone or recording involved.
>
> Please provide these three clear workflows:
>
> 1. EXPLORE VOWEL EXAMPLES WITHOUT A RECORDING
>
> Let me:
> - Enter a fundamental, such as 200 Hz.
> - Choose the number of harmonics.
> - Start with the fundamental and all active harmonics at amplitude 1.
> - Click a vowel button to apply a prepared filter.
> - Play the result immediately through an explicit Play button.
> - Drag the filter to explore how the sound changes.
>
> Make the existing vowel examples easy to find near the top. They must work even when there are no recordings saved.
>
> Use pronunciation labels rather than ambiguous letters alone:
> - Aa, as in “father”
> - Eh, as in “bed”
> - Ee, as in “see”
> - Oh, using a steady vowel example with its pronunciation explained
> - Oo, as in “food”
>
> Keep the A/E/I/O/U association if useful, but make the intended sound clear. Do not accidentally use English letter names as five steady vowels.
>
> Use the existing researched vowel examples if suitable. Explain briefly that these are approximate starting filters based on typical vocal resonances, not copies of my voice or guaranteed matches for every speaker.
>
> Selecting a vowel should change only the filter settings. It should preserve my chosen fundamental and source components.
>
> 2. FILTER MY OWN ENTERED FREQUENCIES
>
> Add a source choice:
> - “Equal-strength harmonics”
> - “My own frequencies”
>
> For “My own frequencies,” reuse or connect to the existing Manual frequencies mode.
>
> Let me:
> - Add, edit, and remove frequency/amplitude rows.
> - Enter a fundamental and generate harmonics as a convenience.
> - Also enter arbitrary frequencies that are not harmonics.
> - Load a copy of my current Manual frequencies setup with a clear button.
> - Apply the same draggable filter to this combined source.
> - Try the vowel example filters on it.
> - Compare unfiltered and filtered playback.
>
> Do not reset my manually entered amplitudes to 1 in this custom-source workflow. The all-at-maximum requirement belongs to the separate equal-strength-harmonics workflow.
>
> Explain that a filter changes the strengths of components already present. It cannot create missing harmonics, so a single sine wave or a sparse set of frequencies may not produce a recognizable vowel.
>
> Use accurate labels: arbitrary frequency rows are “components,” not automatically “harmonics.”
>
> 3. MATCH A RECORDING
>
> Keep the existing workflow:
> - Select or record a vowel.
> - Select a steady section.
> - Estimate the fundamental.
> - Automatically fit the filter.
> - Compare the original and filtered synthesis.
>
> Keep “Load vowel example” clearly separate from “Match filter to recording.” One loads a prepared shape; the other analyzes recorded audio.
>
> Make automatic recording-based fitting available for the equal-strength harmonic source first. If custom-source fitting is unsupported, clearly explain that rather than silently replacing my source.
>
> INTERFACE AND AUDIO
>
> - No recording should be required to play, drag a filter, load a vowel example, save, or export a generated sound.
> - Only show recording-specific controls when relevant.
> - In workflows without a recording, show the unfiltered and filtered source spectra and omit the original-recording comparison.
> - Display the actual source components and the actual filter response.
> - Keep the filter applied to the combined audio source.
> - Preserve source frequencies while dragging the filter.
> - Keep safe output scaling and consistent gain during bypass comparisons.
> - Preserve existing recordings and experiments.
>
> SAVING AND TUTORIAL
>
> Save and restore the selected workflow, source type, all source frequencies/amplitudes, fundamental where applicable, filter settings, and relevant recording information.
>
> Support filtered WAV and settings JSON export without a recording.
>
> Update the guided tour to explain these options using short text and highlights on the actual controls. It must work with no recordings present.
>
> TESTING AND DELIVERY
>
> Test all three workflows, including starting with completely empty browser storage.
>
> Verify that:
> - Vowel examples work without recording.
> - Custom frequencies and amplitudes remain unchanged when applying or dragging a filter.
> - Filtering affects the correct components.
> - Save/load and WAV export work for both source types.
> - Existing recording-based matching still works.
>
> Run the relevant tests and build.
>
> Keep this local for me to try. Do not commit, push, or publish yet.
>
> When finished, give me exact steps to:
> 1. Generate an Aa-like sound from a 200 Hz fundamental without recording.
> 2. Enter my own frequency components and filter them.
> 3. Return to recording-based filter matching.
>
> Explain any limitations honestly, especially whether the vowel presets have been evaluated by listening.

</details>

### What Claude built

Claude built the "Vowel filtering" section:
- An equal-strength harmonic source run through a chain of 8 cut-only Web Audio filters, with draggable points.
- "Match filter to recording", which fits the filter to a recording's measured harmonics.
- Aa, Eh, Ee, Oh and Oo starting examples based on published average vowel resonances.
- Saving and WAV export.

### How it was tested

Claude's checks passed: 119 unit tests and 88 browser checks across the three workflows. A filter fitted to a synthetic recording made with a known filter recovered its levels within 0.1 dB. I listened to the examples myself, and Aa, Ee and Oo sounded recognizable without a recording.

## Vowel Morph (tasks 3 and 4, October 31)

### Main build prompt

<details>
<summary>Build prompt (verbatim, October 31)</summary>

> Please build a NEW standalone web app for tasks 3 and 4 of my capstone assignment. This is separate from Frequency Playground and Motion Score.
>
> Inspect the existing project structure first. If it already contains the other apps under one landing page, add this as a separate app with its own route and entry button. Reuse useful recording and sound-analysis code where appropriate without changing the other apps’ behavior.
>
> Call it “Vowel Morph” for now.
>
> MY PROFESSOR’S INSTRUCTIONS
>
> Task 3:
> “Record two sounds, add a slider that goes between those two sounds. When the slider is all the way to one end, you will hear one sound. When it is all the way to the other end, you will hear the other sound. Along the path it will interpolate the sounds.”
>
> Task 4:
> “Generalize 3 to two dimensions. Make a square where you can record sounds and assign them to dots. When you click in the square, generate a sound representing that position. Clicking on one of the recorded sounds should let you hear that sound.”
>
> He wants a video of task 4 if we reach it, otherwise task 3.
>
> ADDITIONAL CLASS NOTES
>
> - Begin with sustained vowels that I record myself.
> - Each vowel can be represented by its fundamental frequency and harmonic strengths.
> - One slider should smoothly transition between the fundamental and harmonics of two vowels.
> - In two dimensions, each recorded vowel becomes a dot.
> - Clicking between dots should generate an intermediate sound based on the nearby vowels.
>
> BUILD IN TWO STAGES
>
> Complete and test the one-dimensional version first, then build the two-dimensional version using the same underlying sound engine.
>
> Keep the first stage usable even if the second stage has limitations.
>
> Before implementing, briefly explain your interpretation and chosen approach in plain language, then proceed without waiting for approval.
>
> IMPORTANT: WHAT “INTERPOLATE” MEANS HERE
>
> The main implementation should interpolate sound parameters:
> - Fundamental frequency.
> - Relative harmonic amplitudes.
>
> Then synthesize a NEW sound from the interpolated parameters.
>
> Simply crossfading two original recordings is not enough for this implementation. That can produce two voices or pitches at once, whereas the intended parameter-based approach produces one synthesized harmonic sound whose pitch and vowel character change.
>
> Explain this distinction in the guide.
>
> RECORDING AND ANALYSIS
>
> Let me:
> - Record a sustained vowel for about 2–4 seconds.
> - Name it, such as “Aa,” “Ee,” or “Oo.”
> - Listen to the original recording.
> - Select a steady section for analysis.
> - Import a WAV if useful.
> - Record another take without silently deleting the previous one.
>
> Reuse the existing fundamental/harmonic analysis if suitable:
> - Estimate the fundamental from several short frames.
> - Estimate harmonic strengths.
> - Explain unreliable or unsuitable input.
> - Allow manual correction of the fundamental and reanalysis.
> - Clearly label manually corrected results.
> - Show a concise analysis summary.
>
> Keep the original recordings and analyzed sound parameters associated with each vowel.
>
> Use a consistent harmonic representation for every vowel. Handle missing or rejected harmonics consistently, respect the sample rate, and avoid leftover amplitudes from other sounds.
>
> Do not hard-code my previous frequency estimates or assume a vowel always has the same fundamental.
>
> TASK 3: TWO VOWELS AND A SLIDER
>
> Provide a “1D slider” view.
>
> Interface:
> - A clearly labelled Vowel A recording area.
> - A clearly labelled Vowel B recording area.
> - Original playback for each recording.
> - Synthesized preview for each analyzed vowel.
> - A slider labelled with A on the left and B on the right.
> - Play/Start and Stop controls.
> - A visible indication of the current slider position.
>
> Behavior:
> - At the left endpoint, use exactly A’s analyzed fundamental and harmonic strengths.
> - At the right endpoint, use exactly B’s analyzed parameters.
> - In between, smoothly interpolate both.
> - While playing, dragging should update the generated sound continuously without repeatedly restarting it or making clicks.
> - The middle should be an intermediate synthesized vowel, not merely two recordings playing simultaneously.
> - If A and B have different fundamentals, pitch should move smoothly between them.
> - If they have the same fundamental, demonstrate changes in vowel character while keeping pitch steady.
>
> Choose and document sensible interpolation rules. For example:
> - Interpolate pitch on a perceptually meaningful scale.
> - Interpolate harmonic amplitudes using a clearly explained rule.
>
> Do not introduce unexplained complexity. State what the midpoint actually means under the chosen rules.
>
> Show the current fundamental and a compact harmonic spectrum so I can see what changes while moving the slider.
>
> TASK 4: RECORD VOWELS AS DOTS IN A SQUARE
>
> Provide a separate “2D sound space” view in the same app.
>
> Let me:
> - Record or import a vowel.
> - Analyze it.
> - Add it as a labelled dot at a chosen position in the square.
> - Add several vowels, including more than four.
> - Reposition, rename, select, and delete dots.
> - See which dot corresponds to which recording.
> - Preview each original recording.
>
> Make placement and playback distinct so I do not accidentally move dots while trying to play:
> - A clear Edit/place mode for adding or moving dots.
> - A Play/explore mode for clicking or dragging to generate sound.
>
> In Play/explore mode:
> - Clicking inside the square sets the generated sound’s position.
> - Dragging smoothly changes the sound.
> - Display the current position.
> - Nearby dots contribute more strongly.
> - Clicking exactly on a dot must reproduce that dot’s analyzed parameters exactly.
> - Display the contributing vowels and their weights in an understandable way.
> - Show the resulting fundamental and spectrum.
>
> INTERPOLATION IN TWO DIMENSIONS
>
> Choose a practical, continuous weighting method that:
> - Handles arbitrary dot positions.
> - Works with two, three, four, and more dots.
> - Has weights that sum to 1.
> - Reaches an individual dot’s exact parameters at that dot.
> - Behaves predictably near the edges and outside the region enclosed by the dots.
> - Avoids abrupt switching between vowels.
> - Handles dots placed very close together or at the same position safely.
>
> Explain the method and why you selected it. If using distance-based weighting, explain the influence of distance in plain language and avoid presenting it as the only possible approach.
>
> Use those weights to blend the same pitch/harmonic representation used in task 3.
>
> Handle zero or one usable dot gracefully with a clear message or appropriate single-vowel playback.
>
> ORIGINAL RECORDINGS VERSUS SYNTHESIZED ENDPOINTS
>
> Be explicit about this distinction:
>
> Parameter-based synthesis can recreate a vowel approximately, but it will not reproduce every detail of the original recording.
>
> Provide clearly labelled controls to:
> - Hear the ORIGINAL recording associated with a dot.
> - Hear its SYNTHESIZED reconstruction.
> - Explore the generated sound between dots.
>
> To meet the professor’s request to hear the recorded sound when clicking its dot, offer a clear dot-click original-preview action or mode. Keep continuous parameter morphing available as the main exploration mode.
>
> Do not silently switch from generated audio to a raw recording during a continuous drag, because that may create an abrupt change. Explain the chosen behavior briefly in the interface and guide.
>
> Do not claim a synthesized endpoint is sample-identical to the original recording.
>
> SOUND QUALITY AND LEVELS
>
> - Use smooth parameter changes to avoid clicks.
> - Preserve oscillator phase continuity where practical while moving.
> - Keep the sound at a safe, comfortable level.
> - Preserve relative harmonic strengths.
> - Avoid arbitrary loudness jumps between vowels.
> - Explain any normalization used.
> - Prevent overlapping playback sources and stop cleanly.
> - Drop or smoothly fade components that would exceed the sample rate’s frequency limit.
> - Handle microphone permissions and playback errors clearly.
> - Do not automatically begin recording or playing on page load.
>
> PRIORITIZE AN UNDERSTANDABLE INTERFACE
>
> Use simple labels and short explanations.
>
> Include a brief guided tour that highlights actual controls and moves through the page, with Next, Back, and Close. Avoid a long text-only popup.
>
> Explain:
> - A recorded vowel is analyzed into a base frequency and harmonic strengths.
> - The slider or square blends those values.
> - The app combines new sine waves to produce the intermediate sound.
> - The result is an approximation of the recorded voices.
>
> Make the square easy to use with a mouse and on a touch screen.
>
> SAVING AND EXPORT
>
> Save recordings, analyses, slider pairs, dot positions, and names in browser storage, using storage separate from the other apps.
>
> Provide a backup/export and import workflow that includes the recordings and settings needed to restore a sound space on another browser or origin. Settings alone are not enough if recordings are required.
>
> Allow downloading:
> - Original recordings.
> - A synthesized sound at the current position.
> - The saved project/settings.
>
> Do not silently replace or delete existing data.
>
> TESTING
>
> Run appropriate tests and the production build.
>
> Include meaningful checks for:
> - Exact analyzed-parameter recovery at both slider endpoints.
> - Expected intermediate parameters.
> - Smooth, finite values throughout slider movement.
> - Exact parameter recovery at a dot.
> - Continuous 2D weights that sum to 1.
> - Zero, one, two, and several dots.
> - Coincident or nearly coincident dots.
> - Playback and export using the intended generated sound.
> - Saving and restoring recordings and dot positions.
> - Existing Frequency Playground and Motion Score behavior remaining intact.
>
> Use synthetic test signals with known fundamentals and harmonics to verify the analysis and interpolation.
>
> Clearly distinguish automated test results from actual listening results. Do not claim the recorded vowels morph convincingly until I have tested them.
>
> DELIVERY
>
> Keep this local first. Do not commit, push, or publish yet.
>
> When finished, give me:
> 1. What was completed for task 3 and task 4.
> 2. Exact steps to launch the new app.
> 3. Click-by-click instructions to record Aa and Oo and test the slider.
> 4. Instructions to place those vowels and a third vowel in the square.
> 5. A short, natural explanation I can give my professor.
> 6. The interpolation rules in plain language, with a simple numerical example.
> 7. Limitations, test results, and anything that still needs listening tests.
> 8. A VOWEL_MORPH_UPDATE.md guide documenting the approach and relevant primary sources.
>
> Please prioritize a reliable, understandable demonstration over extra features.

</details>

### What I wanted

I wanted a slider between two recorded vowels and a square where recorded vowels become dots, with clicks in between producing a blended sound. The key point in my prompt was what "interpolate" means: blend the fundamental and harmonic strengths, then synthesize one new sound. Crossfading two recordings wasn't enough. I also asked:
- Clicking exactly on a dot must reproduce that vowel exactly.
- Placing dots and playing must be separate modes.
- Backups must include the recordings, so a sound space can move to the live site.

### What Claude built

Claude built Vowel Morph as a third app in the site. Each vowel is stored as a fundamental plus 48 harmonic strengths. The 1D slider blends two vowels, and the 2D square uses inverse-distance weights that always add up to 1. One bank of sine oscillators plays the result without restarting while you drag. Claude also added a guided tour, separate storage and a backup file that includes the recordings.

### How it was tested

Claude's checks passed: 144 unit tests, including 25 new ones for Vowel Morph, and 52 browser checks with simulated vowels. The existing apps' checks still passed, and the deployment succeeded. I tested Vowel Morph myself and recorded a demo of both the slider and the square.

## Linear interpolation, noise and fricatives (November 5–6, 2026)

### Main build prompt

Prompt (verbatim, sent November 6, 2026 UTC). ChatGPT helped me word it:

<details>
<summary>Full prompt</summary>

> Complete this week’s DSC 180A assignment in the existing `~/Desktop/frequency-playground` checkout for `aceyq/sound-lab`. Start by checking the branch, remote, working tree, and current Vowel Morph and Frequency Playground implementations. I think the vowel interpolation may already work, so verify it before changing it. Preserve unrelated changes and any existing uncommitted work in `AI_USE.md` or `README.md`.
> 1. Verify or fix vowel reconstruction and interpolation
>
> * In the 2D vowel space, I should be able to record a sustained vowel with my microphone, reconstruct it digitally as a fundamental frequency and a set of harmonic amplitudes, and place that reconstruction as a visible dot at a position I choose. Reuse the existing recording and analysis workflow where possible. Clicking a recorded dot should play its synthesized reconstruction.
> * Clicking elsewhere in the space should produce one synthesized sound. Compute its fundamental frequency and each harmonic amplitude using normalized weights based on distance to the recorded dots. Reuse the current weighting method if it behaves correctly. A click exactly on a dot should reproduce that dot’s parameters. Handle zero or one recorded dot cleanly.
> * Check the 1D slider separately. The left and right endpoints should reproduce their respective vowel parameters. Between them, linearly interpolate the fundamental frequency and each corresponding harmonic amplitude. The midpoint should be a 50/50 parameter blend played by one synthesizer. Do not mix, crossfade, or simultaneously play two endpoint audio signals. Verify this by inspecting the playback path as well as testing the interpolation math.
>
> 2. Add noise and explore fricatives in Frequency Playground
>
> * Add a controllable noise source to the Frequency Playground filter workflow from last week. Let me hear filtered noise on its own and blend it with the harmonic source when useful. Reuse the existing filter controls and waveform/spectrum views so I can hear and see what changes. Preserve the current vowel workflow.
> * Give me a simple manual workflow to try recreating “shh,” “fff,” “jjj,” and “sss” by adjusting the filter and the noise level. Include a way to try a voiced harmonic component alongside the noise for the sound I’m calling “jjj.” Treat the settings as starting points I can adjust by ear.
> * Make one lightweight automation attempt. Prefer reusing the microphone recorder and spectrum analysis to estimate the broad spectral shape of a sustained fricative, then use that estimate to suggest initial filter settings for the noise source. If fitting the existing filter controls is impractical, implement editable starting presets and explain which settings are preset versus estimated from a recording. Keep the experiment small and describe its limits.
>
> 3. Test, document, and publish
>
> * Run the existing tests and build. Add focused checks for the 1D endpoints and midpoint, exact and equidistant 2D clicks, and any new noise or filter behavior that can be tested reliably. Report the actual commands, counts, and results. If you can open the app, check the controls there too. Give me a short checklist for the microphone recordings, dot placement, and listening comparisons that I need to do myself. Do not count those as completed until I report back.
> * Append a dated section for this week to the existing `AI_USE.md`. Quote this entire prompt verbatim and note that ChatGPT helped draft it. Summarize what I requested, what you verified in the existing implementation, what you changed, the checks you actually ran, and the manual checks still pending. Preserve the earlier disclosure entries.
> * Once the tests and build pass, commit and push this week’s changes and its `AI_USE.md` entry to `main`. If the earlier AI-use and README edits are still uncommitted, keep those together in a separate documentation commit if you can safely separate them. Review what is staged before committing and exclude unrelated edits and personal recordings. If the push is blocked, report the blocker and preserve the local changes.
> * Send me the commit links, the `AI_USE.md` link, and the short manual checklist.

</details>

### What I wanted

I thought the vowel blending might already work, so I asked Claude to check it before changing anything. I specified linear interpolation of the fundamental and each harmonic, with the midpoint as a 50/50 blend played by one synthesizer. I also wanted a noise source in the filter workflow, to try "shh", "fff", "sss" and "jjj". The prompt also asked for one small attempt at estimating a filter from a recording.

### What Claude built

Claude found that the blending used semitones and decibels rather than the linear rule I asked for. It changed both the slider and the square to plain weighted averages. In Vowel filtering it added a noise source and a "Noise and fricatives" workflow with editable starting points. It also added "Estimate filter from recording", which fits the existing filter points to a recording's broad spectrum.

### How it was tested

Claude's checks passed: 157 unit tests, the build, and the browser checks for Vowel Morph (54), noise (22) and the existing apps. Listening tests with my own recordings were not part of these checks.

## Capstone: 2D vowel map, drawn takes and Pose Sound Map / Motion Morph (November 14–23, 2026)

### Prompt for Parts 1 and 2

Prompt (verbatim, sent November 15, 2026 UTC). ChatGPT helped me draft it. Its original Part 3 section is replaced by the revised prompt below; the bracketed line marks where it was.

<details>
<summary>Full prompt</summary>

```text
Can you help me implement all three of this week’s capstone assignments in Sound Lab? Use `~/Desktop/frequency-playground`, which should point to `aceyq/sound-lab`. Please check the branch, remote, and working tree first.
I think my 2D vowel map already does most of part 1, and part 2 might be partially there too. My professor repeated the instructions because some implementations worked differently from what he intended. Please check what my app actually does first, keep what already works, and make the changes needed for each part. I only need to record a video for parts 1 and 2. I’ll demonstrate part 3 live in class.
1. Check the existing 2D vowel map
I should be able to record a few steady vowels, place each one anywhere in the square, and click on a new spot to hear a synthesized vowel. Check that clicking directly on a dot uses that vowel’s estimated fundamental frequency and harmonic amplitudes. Between dots, the app should use its distance-based weights to blend the fundamental frequencies in Hz and the corresponding harmonic amplitudes, then use those values to synthesize one sound. Please verify that it behaves that way when I click and when I move around the map.
Give me a short explanation of the weighting rule the code actually uses, including what happens at an anchor and how the app handles multiple nearby points. A small numerical example would help me explain it in my video. For this assignment, keep the map focused on vowels and other sounds with a usable pitch. I’ll leave fricatives in their existing workflow.
2. Let me record while drawing a line or curve
I want to select a mode where I can press down in the square, draw a line or a curve with my mouse, and change the vowel I’m making while I draw. For example, I could draw a sine-wave shape while going from “ah” to “ee” to “oo.” Pressing down should start capturing audio and releasing should finish the take.
The important part is that the app should take short snippets throughout the recording and use the mouse position at the time of each snippet. Please timestamp the audio and pointer positions so the sound from halfway through my take ends up halfway through my drawing in time, even if I changed drawing speed. Estimate the fundamental and harmonic amplitudes for each usable snippet and add those as points on the curve. Reuse the pitch and harmonic analysis that already works for individual vowels. Choose a window length that gives the pitch estimator enough audio to work with. Skip silent or unreliable snippets and show me how many usable points the take produced.
Show the drawn path and the points the app actually learned. I should be able to trace the curve again to hear the changing sound, and click near or between learned points to hear the existing interpolation. Make it easy to undo a whole take if I mess up, without losing the individual vowels I already placed. Test this with a curved take where the sound changes along the path so we can tell the points actually represent different snippets.
[Part 3 section of this prompt (a phone-controlled sound map) removed here; it was replaced by the revised Part 3 prompt below.]

Test it, update AI_USE, and publish
Please run the existing tests and build, and check all three workflows as far as you can. For part 2, specifically check timestamp alignment when the mouse speed changes and confirm that undo removes only the latest take. For part 3, check that changing either angle affects the mapping and that audio fades when tracking drops. Tell me which checks used simulated inputs and which things I still need to try with my own microphone and camera.
Append this exact prompt to `AI_USE.md` under this week’s entry for my end-of-quarter report. Keep the entry simple. Credit ChatGPT for helping draft the prompt, give a short summary of what Claude implemented and verified, and leave my hands-on testing for me to confirm. Keep the earlier entries.
Commit and push the assignment changes and the `AI_USE.md` update to the Sound Lab repo. Keep my personal recordings and demo videos out of the commit. Send me the commit link and live app link once you’ve checked the deployment. Also give me a short click-by-click checklist for filming parts 1 and 2 and a separate setup checklist for demonstrating part 3 in class.
```

</details>

### Revised Part 3 prompt

Prompt (verbatim, sent November 17, 2026 UTC). ChatGPT helped me draft it:

<details>
<summary>Full prompt</summary>

```text
Can you change what I currently have for Part 3 in `aceyq/sound-lab`? I tried the Tilt Sound Map idea, but it feels too similar to the phone instrument I already made for Motion Score. I want Part 3 to use my laptop camera and feel like something I could actually choreograph. Please replace the current Part 3 page with this camera version. Keep Motion Score and the two Vowel Morph workflows available as their own projects.
The assignment is to take the 2D sound map and use two sensor measurements to control where I am on it. My professor specifically said to try to avoid using x and y positions from the camera. I want to use these two joint angles:

* Right elbow bend. Use my right shoulder, elbow, and wrist to measure how bent my right arm is.
* Left arm lift. Use my left hip, shoulder, and elbow to measure how far my left upper arm is lifted relative to my torso.

Together, those two angles should give me one spot on the sound map. I want to see my camera preview with the relevant joints marked, the two angle readings, and a dot that moves as I move. Give me a quick way to calibrate a comfortable range for both movements. If the camera loses a joint, show me which one and fade the sound until tracking comes back.
What I’m most excited about is being able to teach the app what my poses should sound like, then perform the same phrase silently. Let me pick a vowel I already recorded in Vowel Morph if it’s available, hold a pose, and attach the vowel to that pair of angles. Give me a way to record a vowel on this page too, plus a starter set I can use to try it right away. Reuse the sound blending from the 2D vowel map so I can move between poses and hear one synthesized sound change as I go.
Here’s what I want to be able to do in class:

1. Start with my right arm straight and my left arm down for “ah.”
2. Slowly bend my right elbow while keeping my left arm down and hear it glide toward “ee.”
3. Lift my left arm on a sharp count to shift toward “oo.”
4. Freeze for an extra count, then do the movement backward and hear the sound follow me back through the vowels.

I want the sound to follow the pose I’m actually holding, so I can change the timing, pause, or go backward whenever I want. Once that works, I’d love an optional clap when I enter the final pose region. It should fire once when I enter, stay quiet while I hold the pose, and be ready to play again once I leave and come back. Use the same two angles for that too. Get the vowel mapping working first since that’s the main assignment.
Could you also add the click-through tutorial like the ones in my other apps? Give it a Tour button and Back, Next, and Done controls. I want it to highlight the actual controls on the page as I go. Walk me through enabling the camera, getting my arms in frame, calibrating the angles, trying the starter poses, assigning a vowel to my own pose, and performing the short phrase. If the clap is included, show how to turn it on at the end. Let me close and reopen the tour when I want.
Please test that each angle controls its own axis, that the two angles together control the blend, and that a held pose sustains the sound. Check that the walkthrough works and that the existing Vowel Morph and Motion Score pages still work. Tell me what you checked with simulated inputs and give me a short checklist for what I need to try with my actual camera before class.
In `AI_USE.md`, update the existing entry for this week. Replace the phone-based Part 3 prompt with the exact text of this revised prompt. Keep Parts 1 and 2 and the earlier weeks in place. Add a short note in plain language that I changed direction after the phone version felt too close to Motion Score, and summarize what you actually implemented and tested. Credit ChatGPT for helping draft this prompt.
Please commit and push the update, check the deployment, and send me the commit link and the live link for the camera app.
```

</details>

### Change of direction

I first built Part 3 as a phone-tilt sound map. When I tried it, it felt too close to the phone instrument I had already made for Motion Score. So I asked Claude to replace it with a camera version that uses two joint angles and that I could choreograph.

### What I wanted

Part 1: confirm that my existing 2D vowel map blends f0 in Hz and each harmonic with distance weights, and get a short explanation with a numerical example. Part 2: record while drawing a curve, with each snippet placed on the curve by timestamp, and whole-take undo. Part 3: use my laptop camera to measure my right elbow bend and left arm lift, use those two angles to move around the vowel map, teach the app which vowel goes with which pose, and perform a short ah → ee → oo phrase, with an optional clap and a guided tour.

### What Claude implemented and verified

- Part 1: Claude checked the existing map and left it unchanged. It already uses normalized inverse-distance-squared weights, a plain weighted average of f0 in Hz and of each harmonic, and an exact snap onto a dot when you click it. The explanation and example are in `CAPSTONE_MAP_UPDATE.md`.
- Part 2: Claude added "✏️ Draw + record a take" to the Vowel Morph square. It uses 0.2 s snippets every 0.1 s, matches audio to pointer by timestamp, and reuses the single-vowel analysis. Silent or unreliable snippets are skipped and counted. The page shows the path and learned points, replays a take along its path, and undoes only the latest take.
- Part 3: Claude replaced the phone page with a "4. Pose Sound Map" page. It runs MediaPipe pose tracking in the browser, with the model hosted on the site. Right elbow bend moves the dot left/right and left arm lift moves it up/down. It has two-pose calibration with a countdown, names lost joints and fades the sound, and offers starter vowels laid out for the phrase. You can attach Vowel Morph vowels to held poses or record new ones there, turn on an optional clap that fires once on entering the final pose, and use a 13-step tour with Back, Next and Done. Motion Score and Vowel Morph are unchanged, and the old phone page link now opens the camera page.
- Checks Claude ran, all with simulated input: 174 unit tests and the build pass. The drawn-take browser script passed 20/20. The pose browser script passed 38/38, using generated body landmarks fed through the page's pose handler: each angle moved only its own axis, the two angles together set the blend, a held pose sustained the sound, a lost joint faded it, the ah → ee → oo → back phrase matched each starter, the clap fired once per entry, and the tour worked. The same script started the real pose model on Chromium's fake camera (no person). The Motion Score checks passed 67/67.

### Part 3 follow-up: elbow = vowel, head = pitch

Prompt (verbatim, sent November 17, 2026 UTC). ChatGPT helped me draft it:

<details>
<summary>Full prompt</summary>

```text
I played around with the camera sound map, and I want to make it easier to understand what I’m controlling and more fun to actually perform with. Please update the camera version of Part 3 in my `aceyq/sound-lab` repo.

**Use my elbow to change the vowel and my head to change the pitch.** Keep right elbow bend as one axis, and replace left arm lift with side-to-side head tilt for the other. I want to bend my right elbow to move between “ah,” “ee,” and “oo,” then tilt my head toward one shoulder to lower the pitch and toward the other to raise it. Use the angle of my head relative to my shoulders so shifting my whole body sideways doesn’t act like a head tilt. Show me both angles, highlight the landmarks you’re using on the camera preview, and give me a quick way to calibrate a comfortable range with my head upright as neutral. Keep the two angles as the coordinates of the map so I can move through both dimensions at once.

**Make the starter map playable right away.** I’m picturing “ah,” “ee,” and “oo” in columns, with lower, middle, and higher versions of each vowel. Keep the pitch matched across vowels in each row and use the same harmonic balance for each vowel up and down its column. Reuse the vowel synthesis I already have. I want the controls to feel predictable between the dots too. If I keep my head still and bend my elbow, I should mainly hear the vowel change. If I hold my elbow still and tilt my head, I should mainly hear the pitch change. Please check those two movements separately.

**Show me what I’m hearing.** Bring over the colored contribution bars from Vowel Morph so I can see how much “ah,” “ee,” and “oo” contribute to the sound at my current pose. Group the contributions by vowel so I don’t have to read a separate bar for every pitch version. Show the current fundamental frequency in Hz and a live graph of the harmonic strengths the synth is actually using. I want to be able to point to the screen in class and say, “Here my pitch is staying about the same, but you can see the harmonic bars and vowel percentages changing as I bend my elbow.” Then I want to hold my elbow and tilt my head to show the pitch moving.

**Make adding my own voice optional and give it a reason to be there.** The starter vowels already let me play, so put recording under something like **Customize sounds**. Let me replace one of the starter vowels with my own recording or add another pitched sound, like a closed-mouth “mmm.” Give me a way to hear the original and synthesized versions before I use it on the map. Make it easy to get back to the starter sounds while I’m experimenting.

For the dance part, I want to try a short phrase where I slowly bend my elbow to glide from “ah” toward “ee,” then hit a head tilt on the next count to take that sound higher. I can freeze there for a count and then reverse it. The sound should follow where I’m holding the pose so I can change the timing while I perform. Update the existing **Back / Next** tour to walk me through that exact demo, including camera setup, calibration, trying each movement on its own, reading the bars, and then putting the movements together.

Please test the two controls separately and together, and check that the percentages and harmonic graph match what the app is synthesizing. Tell me what you checked in code and what I should try with my actual camera before class. Add this prompt verbatim as a follow-up in the camera project’s `AI_USE.md` entry, credit ChatGPT for helping draft it, and briefly describe what changed and what you tested. Then commit and push, check the deployment, and send me the commit and live app links.
```

</details>

What changed: I replaced left arm lift with head tilt, measured as the angle between my ear line and my shoulder line, so shifting my whole body doesn't count. The elbow picks the vowel and the head picks the pitch. Claude made the starter map a grid of "ah", "ee" and "oo" columns with low, middle and high rows. Each row has one matched pitch and each column one harmonic recipe. Between the dots it blends with linear weights along each direction separately, so the elbow only changes the vowel and the head only changes the pitch. The page now shows grouped vowel-mix bars, the fundamental in Hz and a live graph of the harmonics the synth uses. It has a guided five-pose calibration with beeps, and recording moved under an optional "Customize sounds" section (preview original and synthesized, replace or add a column, back to starters). The tour now follows my demo phrase.

What Claude tested, all with simulated input: 175 unit tests and the build pass. The pose browser script passed 42/42 with generated body landmarks:
- Bending the elbow alone kept the pitch at 220 Hz while the vowel moved ah → ee → oo.
- Tilting the head alone moved the pitch 165 → 220 → 294 Hz while the vowel mix and harmonics stayed the same, and sliding or leaning the whole body didn't count as a tilt.
- The demo phrase followed the pose both ways.
- The displayed Hz, vowel percentages and harmonic graph matched what the synth was playing.
- The real pose model ran on Chromium's fake camera, and Vowel Morph, Motion Score and Frequency Playground still open.

Reverted: after trying the head-tilt version, I found it less intuitive, so I asked Claude to go back to the previous camera version (right elbow bend and left arm lift, commit `a4bd963`). The follow-up prompt above stays here as a record of what I tried.

### Motion Morph: teach my own sounds and poses

I refer to the camera page as Motion Morph, so Claude renamed it to that in the navigation (the `#/pose-map` link still works).

Prompt (verbatim, sent November 23, 2026 UTC). ChatGPT helped me draft it:

<details>
<summary>Full prompt</summary>

```text
I played around with Motion Morph more, and I want to bring it closer to our goal of producing sounds through movements that feel intuitive to the person using it. Right now, I can move between the starter vowels, but I want a clearer way to teach the app my own sounds and decide which poses should produce them.

Please check the current implementation in `aceyq/sound-lab` first and improve the existing Motion Morph page.

**Keep the two arm controls.** I’m using right elbow bend and left arm lift relative to my torso. Those two angles should still determine where I am on the sound map. Show the camera tracking, both angle readings, and the moving marker so I can understand how my pose relates to the sound.

**Let me record a sound and attach it to a pose.** I want to record a steady vowel or another pitched sound, hear the original and synthesized versions, then hold a comfortable pose and save that sound at my current position. A countdown would help so I have time to step back from the laptop before the app captures the pose. Let me name the sound and easily redo either the recording or its position. I should also be able to place the recording by clicking anywhere in the map, like in Vowel Morph.

For now, focus on vowels, humming, and other sounds that the existing pitch and harmonic analysis can reconstruct. If a recording doesn’t give a usable estimate, explain that clearly and let me try again. Make it clear what the app analyzed from my recording and what it will synthesize when I return to that pose.

**Bring over the draw-and-record workflow too.** I want to draw a curve on the map while changing my voice, like “ah → ee → oo,” and have short pieces of that recording attached along the curve. Reuse the timing approach from Vowel Morph so each piece goes where my cursor was when I made it. Then let me move through those points using my arms. Keep the individual recorded sounds and the drawn takes together on the same map, and give me an easy way to undo a take.

The experience I’m aiming for is that I can teach the app a few comfortable poses, then move between them silently and hear the sounds I assigned. If I hold a pose, the sound should hold. If I move back toward another pose, the sound should blend toward it. Reuse the existing blending of fundamental frequency and harmonic amplitudes to produce one synthesized sound.

**Please rethink calibration.** It feels tedious right now, and I’m not sure what each step is doing for me. Check whether a sensible default range would let me start playing as soon as the camera sees my arms. Give me a simple optional “Adjust to my movement” step where I move comfortably for a few seconds and the app estimates my usable range. Show me how that changes the map’s response. I also want an easy way to adjust the range afterward if a small movement sends the marker too far or I can’t reach part of the map.

If I change the calibration after placing sounds, make sure the saved poses still behave predictably. Explain how you handle that so I know whether I need to reposition anything.

**Make the main workflow easy to follow.** I’m picturing opening the camera, trying the starter sounds, then choosing “Add my sound” or “Draw + record.” Once I’ve added something, I should immediately understand how to play it with my arms. Keep the colored vowel or sound contribution percentages and the harmonic graph so I can see the components change as I move. Update the Next/Back tutorial to walk me through recording, assigning a pose, drawing a take, and playing the sounds through movement.

Please test the whole workflow, including whether recorded poses still line up after adjusting the movement range, whether drawing and recording stay aligned, and what happens when tracking drops. Tell me which checks you actually performed and what I need to try with my microphone and camera.

Add this prompt verbatim to the Motion Morph entry in `AI_USE.md`, credit ChatGPT for helping draft it, and briefly summarize the changes and testing in plain language. Then commit and push, check the deployment, and send me the commit link and live app link.
```

</details>

What changed, in plain language:
- The two arm angles still drive the map (right elbow bend left ↔ right, left arm lift down ↕ up). The page now opens with a four-step strip: camera, starter sounds, add my sound or draw + record, play with your arms. Each step gets a tick when you've done it.
- Calibration is optional now. A default range (elbow 15°–130°, arm lift 15°–120°) lets me play as soon as the camera sees my arms. "Adjust to my movement" counts down, then I move freely for 6 seconds. The app sets each range from what I actually used (ignoring the most extreme 5% at each end) and shows how the response changed, for example "10° of elbow bend now moves the marker 14% of the map (was 9%)". An angle I barely moved keeps its old range. Afterwards I can fine-tune each angle with "Small moves jump too far" / "I can't reach the edges" buttons or start/end sliders. There is also one-step undo and a reset to the default.
- "Add my sound" walks through four steps. I name and record 3 seconds of a steady sound. I check what the app heard (pitch in Hz, how steady it was, how many harmonics stood out) and what it will synthesize, and compare ▶ Original with ▶ Synthesized. If there is no usable pitch (silence, noise, whispering), it says why and how to try again. Then I choose a pose: hold it after a beeping 3 s countdown, or click a spot on the map. Last, it tells me which pose plays the sound, with target marks on the angle bars. I can redo the recording or the position later from the sound list.
- "Draw + record" uses Vowel Morph's drawn-take code. Each 0.2 s snippet goes where my cursor was at that moment. Takes share the map with my recorded sounds, have their own undo, and I can play them by moving my arms along the line.
- Saved poses after recalibrating: every sound I place (by pose, by click or by drawing) is saved as the two angles of that pose, not as a spot on the map. After a range change, its dot moves on the map, but holding the same pose still plays exactly that sound, so I don't need to reposition anything. Faint circles briefly show where the dots used to be. The blend between sounds shifts a little because the distances change. Starter sounds stay at the corners of the range. A sound whose pose falls outside a narrowed range gets a dashed ring.
- The contribution bars (a drawn take counts as one entry) and a live harmonic graph show what the synth is playing. The Back/Next tour now has 16 steps covering camera, starters, recording, checking, assigning a pose, drawing a take, undo, playing by movement and the range.

What Claude tested, all with simulated input (generated body landmarks fed through the page's own pose handler, a synthetic microphone, Playwright's mouse): 186 unit tests and the build pass. The rewritten browser script passed 69 of 69 checks:
- Default range: tracking and sound start without any calibration. Each angle moves only its own axis, a held pose keeps one steady sound, and the bars add up to 100% and match the synth exactly.
- Add my sound: a simulated 233 Hz hum was analyzed as 233 Hz, saved at the held pose after the countdown and played at 100% when that pose was held. Redo position updated the same sound, and click-to-place saved the pose that reaches the clicked spot. Noise was rejected with a reason while the earlier sound was kept.
- Draw + record: a take drawn slowly at 150 Hz and then fast at 300 Hz put the 150 Hz points on the slow part and the 300 Hz points on the fast part, so pieces are matched by time. Moving the simulated arms along the take played about 150 Hz at its start and 300 Hz at its end. Undo removed only the newest take.
- Recalibration: after "Adjust to my movement" changed both ranges, holding the poses of the recorded hum, the click-placed sound and a take point still played exactly those sounds. The starters didn't move. Narrowing the range flagged a sound as outside it.
- Tracking drops: a lost joint is named and fades the sound, and no camera frames fades it too. Losing the right elbow during "Use my pose" saved nothing and named the joint. Losing tracking during "Adjust" left the range unchanged and explained why.
- Sounds, takes, range and original recordings survive a reload. The tour works with Back, Next, Done, Close and reopening, and the page has no sideways scrolling at phone width. The real pose model loads on Chromium's fake camera and tracks nothing, and Vowel Morph, Motion Score and Frequency Playground still open.

### Motion Morph follow-up: empty map, guided recording and explicit axes

Prompt (verbatim, sent November 23, 2026 UTC). ChatGPT helped me draft it:

<details>
<summary>Full prompt</summary>

```text
I’m exploring the updated Motion Morph, and a few things still need adjusting. I want the app to clearly show how I teach it sounds and then use two arm measurements to move between them.
Start with an empty sound map. All the sounds should come from recordings I make, including individual vowels, humming, or a changing pitched sound I record while drawing. Please remove the automatically placed starter vowels. When the board is empty, show a short instruction that tells me how to add my first sound. Explain “learning” in terms of what the app actually does with my recordings.
Add a clear-board option. I need an obvious Clear map button with a confirmation before it removes the placed sounds and drawn takes. Keep my recordings available so I can place them again. Give me a separate way to delete a recording if I want to.
Make recording and placing a sound one guided process. Right now, I record something and then it’s confusing what I should click next. I want to click Add a sound, record, listen back, and then choose where it belongs. Show the steps and which one I’m on. Once the app has analyzed the recording, give me two clear choices:

* Click a spot on the map. Put the map into placement mode and tell me to click where I want the sound. After I place it, label the dot and confirm that it’s ready to play.
* Use my current pose. Give me a countdown so I can step back and hold a comfortable pose. Show where that pose lands on the map before I confirm it.

If the recording can’t be analyzed, explain what happened and let me retry right there. Let me cancel placement or redo a position easily.
Keep Draw + record as another clear option. I should be able to hold down the mouse, draw a line or shape, and sing changing vowels or other pitched sounds. Match each usable audio snippet to where my mouse was at that time. Afterward, show the learned points and let me preview the take, undo it, or play through it with my arms. Label these as synthesized sounds reconstructed from my recording.
Please make the two axes really explicit. Last week, my professor was confused about what x and y meant, what each arm was changing, and how I moved between sounds. I need the app to make that easy to explain.
Use these two measurements consistently:

* Horizontal axis — right elbow bend. Measure the angle at my right elbow using my right shoulder, elbow, and wrist. Label which end is a straighter arm and which end is a more bent arm.
* Vertical axis — left arm lift. Measure the angle between my left upper arm and my torso using my left hip, shoulder, and elbow. Label which end is arm down and which end is arm raised.

Make the marker move in the directions those labels describe. Use my actual anatomical left and right, and make that clear even if the camera preview is mirrored. Highlight the relevant joints in the preview and match their colors to the axis labels.
Beside the map, show the two measured angles in degrees and their corresponding map coordinates. When I bend only my right elbow, I should be able to see the marker move horizontally. When I lift only my left arm, it should move vertically. When I change both, it should move through both directions together.
Explain what changes the sound at each position. Since I can put my own sounds anywhere, the axes describe my arm movements. The sounds I place determine what pitch and harmonic balance I hear there. Please make that relationship clear in the interface and tutorial. For example, I could place “ah” on the left and “ee” on the right, then bend my right elbow to move between them. I could put another sound higher up and lift my left arm to move toward it.
Show the contribution percentages for my recorded sounds or drawn takes as I move. Keep the current fundamental frequency and harmonic graph visible so I can see how the synthesized sound changes between points. Make sure those displays reflect what the synth is actually playing.
Update the Next/Back walkthrough to start with the empty board, guide me through recording and placing sounds, and then demonstrate each arm separately before combining them. Keep the calibration instructions tied to these same axis labels.
Please check that I can complete the recording and placement process without getting stuck, that clearing the map works, and that the angle readings and marker agree with the axis labels. Tell me what you tested and what still needs checking with my actual camera and microphone.
Add this prompt verbatim as a follow-up in the Motion Morph section of `AI_USE.md`, credit ChatGPT for helping draft it, and summarize the changes and actual testing in plain language. Then commit and push, check the deployment, and send me the commit and live app links.
```

</details>

What changed, in plain language:
- **Empty map.** The starter vowels are gone. Motion Morph opens on an empty map with a note telling me to add a sound, and explaining what "learning" means: nothing is trained. The app measures each recording's pitch (f0) and the strengths of its first 48 harmonics, then stores those numbers at the spot I choose. Between spots it mixes the numbers by distance and synthesizes one tone. Old saved projects keep my own sounds and drop the starters.
- **Recordings vs. the map.** Every recording is kept in "Your recordings", whether it is on the map or not. 🧹 **Clear map** asks first, then removes every placed sound and drawn take from the map but keeps the recordings, so each can be placed again with "📍 Place on map" (takes with "Put back on map"). Deleting a recording is a separate 🗑 button that also asks first.
- **One guided "Add a sound" process** with a step strip: Record → Listen → Place → Ready. If the recording has no clear pitch, the panel explains why right there and the button becomes "Try again"; nothing is saved. Listen plays ▶ Original and ▶ Synthesized and says what was measured. Place offers two choices:
  - "Click a spot on the map" turns on placement mode with an instruction, and the dot appears with its name.
  - "Use my current pose" counts down, then a dashed ring shows where my pose lands. I press "Put it here" or try again.

  Ready confirms the sound is on the map and which pose plays it. Cancel placement (or Esc), Close and "Redo position" always work, and an unplaced recording stays in the library.
- **Explicit axes.** The map has a blue horizontal axis "RIGHT ELBOW BEND" (← straighter arm, more bent arm →) and a pink vertical axis "LEFT ARM LIFT" (arm down at the bottom, arm raised at the top), with the range in degrees at each end. The camera preview draws my right shoulder–elbow–wrist in blue and my left hip–shoulder–elbow in pink, labelled with the live angle. A banner says the view is mirrored, so my RIGHT arm appears on the right, and "right/left" always means my own body. A panel beside the map shows each angle in degrees and the map coordinate it gives (for example "119° → x = 0.90"). Bending only the elbow changes x, lifting only the left arm changes y, and both move the marker diagonally.
- **What changes the sound.** The "What you hear" card says that my arms only move the marker and the placed sounds decide the pitch and harmonics, with the "ah on the left, ee on the right, hum higher up" example. The percentages list my recordings and each take ("Take 1 (drawn)"), and the f0 and harmonic graph show what the synthesizer is actually playing.
- **Draw + record.** The draw-and-record mode works as before (snippets matched to the pointer by time). After a take, the status and the takes list say each dot is a synthesized sound reconstructed from 0.2 s of the recording. "▶ Preview along the line" plays it, and Undo removes only the newest take.
- **Tour.** The Back/Next tour now has 18 steps:
  - the empty board, the camera and the blue/pink preview
  - Add a sound, then Record, Listen, Place and Ready
  - adding a second sound
  - bending only the right elbow, lifting only the left arm, both together
  - what you hear, Draw + record and the take buttons
  - the range, using the same axis words
  - Clear map and the recordings list

What Claude tested, all with simulated input (generated body landmarks fed through the page's own pose handler, a synthetic microphone, Playwright's mouse): 188 unit tests and the build pass, including new tests for loading old projects, Clear map keeping recordings, and each angle moving only its own axis. The rewritten browser script passed 66 of 66 checks:
- **Empty board.** The page opens with no sounds, shows the empty-map note, and the axis labels and colours are on the map and beside it.
- **Axes.** Bending only the simulated right elbow moved the marker only right; lifting only the left arm moved it only up; both moved it diagonally. The degrees and x/y shown beside the map matched the measured angles and the marker every time.
- **Add a sound.**
  - Noise was rejected in the Record step with "Try again", and nothing was saved. A simulated sung "ah" at 196 Hz then went to Listen, where both playback buttons worked.
  - Click placement could be cancelled with the button and with Esc. Clicking placed a labelled dot and reached Ready.
  - A second sound "ee" (300 Hz) was placed by pose: countdown, dashed ring, then "Put it here". Losing the right elbow during the pose placed nothing and named the joint. Closing the panel in the middle of placing never left the page stuck.
- **Playing.** The "ah" pose played 196 Hz at 100 %, the "ee" pose 300 Hz, and halfway (elbow only) a 50/50 mix at the same height. Percentages added up to 100 %, and the shown f0 and harmonics equalled what the synth played. A lost wrist faded the sound, which came back when the wrist returned. Redo position moved the same sound without duplicating it.
- **Draw + record.** Pitch pieces landed where the pointer was at that time: a slow 150 Hz part and a fast 250 Hz part. The "reconstructed" labels showed, and the preview glided between the two pitches. The take played with the arms under the name "Take 1 (drawn)". Undo removed only the newest take.
- **Clear map.** Saying no changed nothing. Confirming emptied the map (and the empty note came back) but kept both recordings and the take, which could be placed or put back again. 🗑 Delete recording removed only that one.
- **Other checks.**
  - After "Adjust to my movement", a dot moved but its pose still played the same sound.
  - Everything survived a reload.
  - The tour order was checked, every tour step highlighted a real control, and the tour changed nothing.
  - The page has no sideways scrolling at phone width.
  - The real pose model loads on Chromium's fake camera and tracks nothing.
  - Vowel Morph, Motion Score and Frequency Playground still open.

### My own testing

To confirm: recording and drawing with my own voice and microphone, listening to the blends, and trying the pose map (right elbow bend and left arm lift) with my own body in front of my laptop camera. For Motion Morph, also: starting from the empty map, recording "ah" and "ee" and placing one by clicking and one by pose, checking that bending only my right elbow moves the marker sideways and lifting only my left arm moves it up (with the mirrored preview), using Clear map and placing a recording again, recording a hum and a vowel, holding a pose after the countdown from a few steps back, drawing a take while singing ah → ee → oo, playing everything with my arms, and running "Adjust to my movement" and checking that my saved poses still play the same sounds.

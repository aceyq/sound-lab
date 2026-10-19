// Text for Motion Score. Labels here must match PRESENTATION_NOTES.md.

export const HONESTY =
  'This uses phone sensor measurements and explicitly programmed mappings to synthesize sound. It does not train a model to recognize dance movements.';

// Legend rows per mapping: [rule, detail, color].
export const MAPPINGS = {
  tilt: [
    ['Forward/back tilt changes pitch.', 'Top of the phone toward you = higher, away = lower (±35° around your calibrated neutral).', '#58d1ff'],
    ['Sideways lean changes harmonic richness.', 'Held level (your calibrated neutral) = a pure tone, the fundamental only. Lean either way past a small dead zone (±5°) and harmonics fade in, all 12 by about 30°. Come back to level = pure again.', '#c297ff'],
    ['Sharp movements trigger notes in Accents mode.', 'A quick jab or flick plays one short note.', '#ffb74d'],
  ],
  intensity: [
    ['Tilt changes pitch.', 'Tilt the top of the phone toward you for higher, away from you for lower (±35° around your calibrated neutral).', '#58d1ff'],
    ['Movement intensity changes harmonic richness.', 'Stronger movement adds harmonic components (1 to 12). In Flow it also makes the sound stronger.', '#3fb950'],
    ['Sharp movements trigger notes in Accents mode.', 'A quick jab or flick plays one short note.', '#ffb74d'],
  ],
};

export const MAPPING_TEXT = {
  tilt: 'Tilt instrument: forward/back tilt sets the pitch; sideways lean (like a steering wheel) adds harmonics. Level = pure tone; leaning either way makes it richer; back to level = pure again. Use the locks below to change only one of them.',
  intensity: 'Movement intensity (the original mapping): tilt sets the pitch, and moving harder adds harmonics and makes the sound stronger at the same time.',
};

export const EXPR_TEXT = {
  sustain: 'Steady sustain: while armed, the tone keeps sounding at the Expression level set here or on the phone, so you can focus on pitch and richness.',
  movement: 'Movement expression: the sound gets stronger the harder you move and fades when you are still.',
};

export const MODE_TEXT = {
  flow: 'A continuous tone. Tilt changes pitch; how strong it is comes from the Flow expression setting below.',
  accents: 'Make a sharp movement to play a short note. Tilt chooses its pitch; the richness setting at that moment shapes its tone.',
};

// Automatic demo (Laptop Demo, simulated input, real synthesis).
export const AUTO_DEMO = [
  { id: 'pure', start: 0, end: 5, text: 'Phone level (neutral) with pitch locked at 200 Hz: a pure sine, only the fundamental.' },
  { id: 'fade', start: 5, end: 17, text: 'Pitch held at 200 Hz while the phone leans: higher harmonics fade in one by one (watch the harmonic bars and the spectrogram).' },
  { id: 'move', start: 17, end: 30, text: 'Richness locked (harmonic recipe held) while the fundamental moves: every harmonic moves with it.' },
];

export const PITCH_TEXT = 'Continuous allows smooth pitch slides. Pentatonic selects nearby notes from A minor pentatonic: A, C, D, E, G.';

// [title, short, more detail]
export const HOW = [
  ['How the phone talks to the laptop',
    'The phone page sends about 25 small messages per second straight to this laptop page over a WebRTC data connection.',
    'To find each other, both pages first contact PeerJS\'s free public "signaling" server (0.peerjs.com) using a random session ID. After that, data goes directly between the devices, or through PeerJS\'s free public relay (TURN) server if a direct path is blocked. This app does not run its own relay. The pairing code stops other phones from taking control, and only one phone is accepted. Internet is needed to load the site and to pair; it is not suitable for sensitive data.'],
  ['Orientation versus acceleration',
    'Orientation is which way the phone is pointing (tilt, in degrees). Acceleration is how quickly its speed is changing (in m/s²).',
    'Tilt comes from the browser\'s orientation reading (DeviceOrientationEvent beta: forward/back tilt), which the phone computes by combining its motion sensors. An accelerometer alone cannot measure orientation reliably while you move. Movement intensity comes from DeviceMotionEvent acceleration.'],
  ['Gravity removal',
    'A still phone still "feels" gravity (9.8 m/s²). We remove it so that only your movement counts.',
    'Most phones report acceleration with gravity already removed. If a phone only reports acceleration including gravity, the app estimates gravity as the slowly changing part of the signal (a 0.5 s low-pass filter) and subtracts it. That estimate is approximate, and Diagnostics says when it is being used.'],
  ['The mappings',
    'Tilt instrument: forward/back tilt → fundamental frequency (110–880 Hz); sideways lean either way → harmonic richness (level = pure tone). Movement intensity mapping: movement → harmonic components (1–12) and expression. In both, a sharp change in acceleration → a short note in Accents.',
    'The fundamental is the base frequency used to build the sound. Movement intensity is the size of the gravity-free acceleration, smoothed over about 0.12 s, minus your calibrated stillness noise, scaled so that about 5 m/s² (at Sensitivity 1.0×) is 100%. A "sharp movement" is a jerk (rate of change of acceleration) above a threshold, about 120 m/s³ at 1.0×.'],
  ['Why a logarithmic pitch mapping',
    'We hear pitch by ratios: each octave doubles the frequency. Equal tilt steps give equal musical steps.',
    '110 → 220 → 440 → 880 Hz are each one octave apart. With a logarithmic mapping each third of the tilt range is one octave; a straight (linear) mapping would squeeze the low notes together.'],
  ['Fundamental, harmonics and timbre',
    'The fundamental is the base frequency of this harmonic sound. Harmonics are whole-number multiples of it (2×, 3×, 4×…), so changing the fundamental moves all of them together. Changing how strong each harmonic is changes the waveform and the timbre, even while the fundamental stays fixed. Timbre is tone quality; brightness is one aspect of it.',
    'The sound is 12 sine waves added together; harmonic n has frequency n × f0. The starting recipe gives harmonic n the amplitude 1/n. Harmonic richness fades harmonics in one after another: at 0% only the fundamental sounds, at 100% all 12 do, each with its own smooth fade instead of an on/off switch. Then the whole mixture is multiplied by one normalization factor so the summed wave peaks at exactly 1: it cannot clip, and the level changes only a little as harmonics are added (equal perceived loudness is not claimed). Harmonics at or above the Nyquist frequency (half the sample rate) are left out.'],
  ['Why smoothing, calibration and cooldowns',
    'Sensors are noisy, so raw values would make the sound wobble and click.',
    'Smoothing averages out tiny fluctuations. Calibration records your comfortable neutral tilt and how much the sensor reads when you hold still, so that resting counts as 0%. The harmonic count and pentatonic notes only change once you clearly pass a boundary (hysteresis). In Accents, after a note fires the detector waits 300 ms and for the movement to calm down, so one shake makes one note.'],
  ['Expression versus Master Volume',
    'Expression controls the strength of the signal the instrument makes. Master Volume only controls your listening level.',
    'In Flow with Steady sustain, Expression is the slider (laptop or phone; they stay in sync). With Movement expression, Expression follows movement intensity with a gentle attack (≈0.08 s) and release (≈0.35 s), so brief pauses fade instead of chattering. In Accents, each note rises in 15 ms and decays to silence by 450 ms; a new hit restarts the note.'],
  ['Movement Score, waveform, spectrum, spectrogram',
    'Movement Score: sensor-derived control history. Waveform: audio amplitude over time. Spectrum: audio frequency content at a moment. Spectrogram: audio frequency content over time.',
    'The audio graphs are measured from the sound the laptop actually outputs (after Expression, Master Volume and Mute). The Movement Score is not audio at all: it plots the control values the app computed from the phone.'],
];

export const DEMO_GUIDE = [
  ['Connect and calibrate the phone', 'Setup steps 1–3. Point out the status bar: Connected, Sensors active.'],
  ['Start audio and arm the instrument', 'Press Start Audio, then Arm (on the laptop or phone).'],
  ['Stay still: observe silence', 'Expression drops to 0% and the Movement track goes flat.'],
  ['Move gently', 'Watch Expression and Harmonic components rise a little; the green Movement track rises.'],
  ['Change tilt', 'Tilt the top toward / away from you: the Fundamental Hz and the blue Pitch line move.'],
  ['Switch to Accents: trigger a short note', 'Make a sharp flick. An orange marker appears and a short note plays.'],
  ['Compare the Movement Score with the spectrogram', 'Same moments: the Movement Score shows the controls, the spectrogram shows the resulting frequencies.'],
  ['Disarm or Panic to finish', 'Disarm pauses control; Mute / Panic silences instantly.'],
];

export const ZOOM_STEPS = [
  'Open the hosted Motion Score page on the laptop.',
  'Scan the QR code that appears and open the link on the phone.',
  'On the phone, tap Enable Sensors and choose Allow.',
  'Hold the phone comfortably and still while it calibrates automatically.',
  'Press Start Audio on the laptop and Arm (laptop or phone).',
  'Test the sound at a low Master Volume.',
  'In Zoom, Share Screen → this browser window.',
  'Turn on "Share sound" in Zoom\'s share options.',
  'Keep the phone page open and unlocked.',
  'Press Presentation Mode.',
];

export const PERFORMANCE_30S = [
  ['0–10 s', 'Tilt instrument, Flow, Steady sustain. Tick Lock fundamental (200 Hz). Hold level: a pure sine. Lean slowly to one side: harmonics fade in; the pitch stays at 200 Hz. Back to level: pure again.'],
  ['10–20 s', 'Lean to a medium richness, tick Lock richness, untick Lock fundamental. Tilt toward/away from you: the pitch moves and every harmonic moves with it.'],
  ['20–27 s', 'Untick Lock richness. Switch to Accents and Pentatonic. Three sharp hits at different tilts and leans.'],
  ['27–30 s', 'Press Disarm (or Mute / Panic) to finish.'],
];

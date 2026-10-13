// Text for Motion Score. Labels here must match PRESENTATION_NOTES.md.

export const HONESTY =
  'This uses phone sensor measurements and explicitly programmed mappings to synthesize sound. It does not train a model to recognize dance movements.';

export const MAPPINGS = [
  ['Tilt changes pitch.', 'Tilt the top of the phone toward you for higher, away from you for lower (±35° around your calibrated neutral).'],
  ['Movement intensity changes harmonic richness.', 'Stronger movement adds harmonic components (1 to 12). In Flow it also makes the sound stronger.'],
  ['Sharp movements trigger notes in Accents mode.', 'A quick jab or flick plays one short note.'],
];

export const MODE_TEXT = {
  flow: 'Keep moving to sustain sound. Tilt changes pitch; stronger movement adds harmonics and increases expression.',
  accents: 'Make a sharp movement to play a short note. Tilt chooses its pitch; movement intensity shapes its richness.',
};

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
    'Tilt → fundamental frequency (110–880 Hz). Movement intensity → harmonic components (1–12) and, in Flow, expression. Sharp change in acceleration → a short note in Accents.',
    'The fundamental is the base frequency used to build the sound. Movement intensity is the size of the gravity-free acceleration, smoothed over about 0.12 s, minus your calibrated stillness noise, scaled so that about 5 m/s² (at Sensitivity 1.0×) is 100%. A "sharp movement" is a jerk (rate of change of acceleration) above a threshold, about 120 m/s³ at 1.0×.'],
  ['Why a logarithmic pitch mapping',
    'We hear pitch by ratios: each octave doubles the frequency. Equal tilt steps give equal musical steps.',
    '110 → 220 → 440 → 880 Hz are each one octave apart. With a logarithmic mapping each third of the tilt range is one octave; a straight (linear) mapping would squeeze the low notes together.'],
  ['Why harmonics change timbre',
    'Harmonics are frequencies at whole-number multiples of the fundamental. Adding them changes the tone\'s character, or timbre.',
    'Harmonic component n has frequency n × fundamental and amplitude 1/n. The count shown includes the fundamental (1 = pure sine). All amplitudes are divided by the same number, 1 + 1/2 + … + 1/N, so the sum never exceeds full scale. Components at or above the Nyquist frequency (half the sample rate) are left out.'],
  ['Why smoothing, calibration and cooldowns',
    'Sensors are noisy, so raw values would make the sound wobble and click.',
    'Smoothing averages out tiny fluctuations. Calibration records your comfortable neutral tilt and how much the sensor reads when you hold still, so that resting counts as 0%. The harmonic count and pentatonic notes only change once you clearly pass a boundary (hysteresis). In Accents, after a note fires the detector waits 300 ms and for the movement to calm down, so one shake makes one note.'],
  ['Expression versus Master Volume',
    'Expression is movement-controlled sound strength. Master Volume is the overall listening level you set by hand.',
    'In Flow, Expression follows movement intensity with a gentle attack (≈0.08 s) and release (≈0.35 s), so brief pauses fade instead of chattering. In Accents, each note rises in 15 ms and decays to silence by 450 ms; a new hit restarts the note.'],
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
  ['0–4 s', 'Flow + Continuous. Hold still: silence.'],
  ['4–9 s', 'Slow, gentle arm wave: a soft, simple tone.'],
  ['9–15 s', 'Keep a similar wave while tilting the phone toward/away from you: the pitch rises and falls.'],
  ['15–21 s', 'Hold the tilt steady and make bigger, more energetic movements: more harmonics, stronger sound.'],
  ['21–28 s', 'Switch to Accents and Pentatonic. Three deliberate sharp hits at three different tilts: three notes.'],
  ['28–30 s', 'Press Disarm (or Mute / Panic) to finish.'],
];

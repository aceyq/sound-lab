# Noise and fricatives

This update adds a controllable noise source to the Vowel filtering section of Frequency Playground, and a fourth workflow for trying "shh", "fff", "jjj" and "sss". Noise is off by default, so the vowel workflows sound the same as before.

## How to use it

1. `npm run dev`, open http://localhost:5173/#/frequency and click **🎚 Vowel filtering** in the Mode bar.
2. Click **4 · Noise and fricatives**.
3. Under **Try a fricative**, click **shh**, then **▶ Play**.
4. Drag the filter points and move **Noise level** and **Harmonic level** until it sounds right to you. Click **■ Stop** to end.
5. Do the same with **fff**, **sss** and **jjj**.
6. To estimate a filter, record a steady "shh" in stage 1 of Vowel Lab, choose it in the **Recording** box of this workflow, drag across a steady section, and click **🔍 Estimate filter from recording**. Then compare with **⇄ Original → Filtered**.

The **Noise source** panel is available in every workflow. **▶ Filtered noise only** plays the noise through the filter with the harmonics off.

## How it works

- **Noise.** A fixed 4-second loop of white noise, peak 0.25 × the noise level, joins the source before the filter. The same samples are used for playback, the spectra and the WAV.
- **Harmonic level.** Scales the sine components. At 100 % with noise at 0 the sound is exactly the earlier one.
- **Harmonics skip the filter.** Sends the sines around the filter, so only the noise is shaped. Without this the "shh" filter would remove the low harmonics that make "jjj" voiced.
- **Filter.** The same 8 cut-only peaking filters and the same charts as the vowels.

## Preset versus estimated

| Setting | Preset buttons | Estimate from a recording |
|---|---|---|
| 8 filter points | Hand-chosen target shape, fitted to the points | Fitted to the recording's third-octave spectrum (150 Hz to 9 kHz) |
| Noise level | Preset | Kept, or 80 % if it was off (not estimated) |
| Harmonic level and "skip the filter" | Preset | 0 and off; 40 % and on if the section repeats like a voiced sound (a default, not estimated) |
| f0 and component count | jjj sets 6 components and uses your f0 | If voiced: the section's estimated f0, and 6 components |

The presets follow the general pattern in the literature: "sss" has its energy highest, "shh" lower, and "fff" is weak and flat. I read "jjj" as the voiced sound in "measure" (/ʒ/), as a sustained sound, so it uses the "shh" shape plus low harmonics. If you meant the "j" in "jump", that sound starts with a stop, which a steady filter cannot make.

## Limits

- The presets are starting points. None was measured from a voice, and none has been checked by listening.
- The estimate is one broad average of the section. It has no timing, and the microphone and room are part of what it measures.
- The filter only cuts, with 8 broad bands and centres up to 9 kHz. Energy above that is not shaped closely.
- For a voiced recording, the harmonics are part of the measured spectrum, so the estimate is rougher.
- Peak level: full noise plus full harmonics is 0.95 before filtering. Filtering noise can change its peaks slightly, so this is checked for the presets (below 1), not proved for every filter.

## Sources

- Stevens, K. N. (1998). *Acoustic Phonetics*. MIT Press.
- Jongman, A., Wayland, R., & Wong, S. (2000). Acoustic characteristics of English fricatives. *JASA* 108(3), 1252–1263.
- Fant, G. (1960). *Acoustic Theory of Speech Production*. Mouton.
- W3C. *Web Audio API*. AudioBufferSourceNode, BiquadFilterNode. https://www.w3.org/TR/webaudio/

Test results are in `AI_USE.md`, in the November 5, 2026 entry.

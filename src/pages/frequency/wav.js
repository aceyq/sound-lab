// WAV file encoding and decoding (pure, no DOM or Web Audio), so recordings
// and synthesized sounds can be exported and re-imported exactly.
//
// Export format: RIFF/WAVE, PCM, 16-bit signed integers, mono. This plays in
// every browser, operating system and video editor.

/**
 * Encodes mono float samples (−1…1) as a 16-bit PCM WAV file. Values beyond
 * ±1 are clipped (the app keeps its own exports below that).
 * Returns { buffer: ArrayBuffer, clipped: number of clipped samples }.
 */
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buffer);
  writeStr(v, 0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  writeStr(v, 8, 'WAVE');
  writeStr(v, 12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, Math.round(sampleRate), true);
  v.setUint32(28, Math.round(sampleRate) * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeStr(v, 36, 'data');
  v.setUint32(40, n * 2, true);
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    if (Number.isNaN(s)) s = 0;
    else if (s > 1) { s = 1; clipped++; } else if (s < -1) { s = -1; clipped++; }
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return { buffer, clipped };
}

/**
 * Decodes a PCM (8/16/24/32-bit integer) or 32/64-bit float WAV file.
 * Several channels are averaged into one. Throws an Error with a readable
 * message for anything else.
 * Returns { samples: Float32Array, sampleRate, channels, bitDepth, format }.
 */
export function decodeWav(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  if (v.byteLength < 12 || readStr(v, 0, 4) !== 'RIFF' || readStr(v, 8, 4) !== 'WAVE') {
    throw new Error('This is not a WAV file (no RIFF/WAVE header).');
  }
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= v.byteLength) {
    const id = readStr(v, pos, 4);
    const size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      const bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 40) format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bits };
    } else if (id === 'data') {
      data = { offset: body, size: Math.min(size, v.byteLength - body) };
    }
    pos = body + size + (size % 2);
  }
  if (!fmt) throw new Error('The WAV file has no format (fmt) section.');
  if (!data) throw new Error('The WAV file has no audio data section.');
  const { format, channels, sampleRate, bits } = fmt;
  const isFloat = format === 3;
  if (!(format === 1 || isFloat)) throw new Error(`Unsupported WAV encoding (format code ${format}). Use PCM or 32-bit float WAV.`);
  if (isFloat ? !(bits === 32 || bits === 64) : ![8, 16, 24, 32].includes(bits)) throw new Error(`Unsupported WAV bit depth: ${bits}.`);
  if (!channels || !sampleRate) throw new Error('The WAV file reports 0 channels or a 0 Hz sample rate.');
  const bytes = bits / 8;
  const frames = Math.floor(data.size / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = data.offset + (i * channels + c) * bytes;
      let s;
      if (isFloat) s = bits === 32 ? v.getFloat32(p, true) : v.getFloat64(p, true);
      else if (bits === 8) s = (v.getUint8(p) - 128) / 128;
      else if (bits === 16) s = v.getInt16(p, true) / 32768;
      else if (bits === 24) {
        let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
        if (x & 0x800000) x -= 0x1000000;
        s = x / 8388608;
      } else s = v.getInt32(p, true) / 2147483648;
      sum += s;
    }
    out[i] = sum / channels;
  }
  return { samples: out, sampleRate, channels, bitDepth: bits, format: isFloat ? 'float' : 'pcm' };
}

function writeStr(v, at, s) {
  for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
}

function readStr(v, at, len) {
  let s = '';
  for (let i = 0; i < len && at + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(at + i));
  return s;
}

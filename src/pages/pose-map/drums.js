// Three short synthesized drums for the Pose Sound Map's clap (kick and snare are kept for later use).
// Each hit builds a few Web Audio nodes that stop and are released after
// about half a second. Nothing is sampled or loaded from files.

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const n = Math.round(ctx.sampleRate * 0.5);
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }
  return noiseBuf;
}

function env(ctx, g, t, peak, decay, attack = 0.002) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay);
}

export const drumCounters = { kick: 0, snare: 0, clap: 0 };

/** Plays one drum hit into `dest` (an AudioNode of `ctx`). */
export function playDrum(ctx, dest, kind, level = 0.9) {
  const t = ctx.currentTime + 0.005;
  const stopAt = t + 0.6;
  if (kind === 'kick') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(ctx, g, t, level, 0.11);
    o.connect(g).connect(dest);
    o.start(t); o.stop(stopAt);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  } else if (kind === 'snare') {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const gn = ctx.createGain(); env(ctx, gn, t, level * 0.6, 0.06);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(190, t);
    const go = ctx.createGain(); env(ctx, go, t, level * 0.5, 0.04);
    n.connect(hp).connect(gn).connect(dest);
    o.connect(go).connect(dest);
    n.start(t); n.stop(stopAt); o.start(t); o.stop(stopAt);
    n.onended = () => { for (const x of [n, hp, gn, o, go]) x.disconnect(); };
  } else if (kind === 'clap') {
    const n = ctx.createBufferSource(); n.buffer = noise(ctx);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
    const g = ctx.createGain();
    // three quick bursts, then a short tail: the "clap" smear
    g.gain.setValueAtTime(0, t);
    for (const [dt, a] of [[0, 1], [0.012, 0.85], [0.024, 0.95]]) {
      g.gain.setValueAtTime(level * a * 0.8, t + dt);
      g.gain.setTargetAtTime(0, t + dt + 0.001, 0.004);
    }
    g.gain.setValueAtTime(level * 0.6, t + 0.036);
    g.gain.setTargetAtTime(0, t + 0.037, 0.07);
    n.connect(bp).connect(g).connect(dest);
    n.start(t); n.stop(stopAt);
    n.onended = () => { n.disconnect(); bp.disconnect(); g.disconnect(); };
  } else return false;
  drumCounters[kind]++;
  return true;
}

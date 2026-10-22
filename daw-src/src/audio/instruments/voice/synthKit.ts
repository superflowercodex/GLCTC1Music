export const SYNTH_KINDS = ["kick", "snare", "clap", "hat", "openhat", "tom", "rim", "perc", "bass", "chords", "riser", "impact"] as const;
export type SynthKind = (typeof SYNTH_KINDS)[number];

export const SYNTH_NAMES: Record<SynthKind, string> = {
  kick: "Kick",
  snare: "Snare",
  clap: "Clap",
  hat: "Hat",
  openhat: "Open hat",
  tom: "Tom",
  rim: "Rim",
  perc: "Perc",
  bass: "Bass loop",
  chords: "Chord loop",
  riser: "Riser",
  impact: "Impact",
};

/** Looping synth sounds are cut to whole bars at this tempo; pads then stretch them to the project tempo. */
export const SYNTH_LOOP_BPM = 120;

/** Deterministic noise, so a rendered kit is identical every time and tests can compare results. */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

function expDecay(t: number, tau: number): number {
  return Math.exp(-t / tau);
}

function tone(out: Float32Array, sr: number, freqAt: (t: number) => number, ampAt: (t: number) => number): void {
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * freqAt(t)) / sr;
    out[i] += Math.sin(phase) * ampAt(t);
  }
}

function hatNoise(out: Float32Array, sr: number, tau: number, seed: number): void {
  const n = noise(seed);
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const x = n();
    // First-order high-pass keeps only the metallic top end.
    const hp = x - prev;
    prev = x;
    out[i] += hp * 0.5 * expDecay(i / sr, tau);
  }
}

export function renderSynth(kind: SynthKind, sampleRate: number): Float32Array {
  const sr = sampleRate;
  const make = (seconds: number) => new Float32Array(Math.round(seconds * sr));
  switch (kind) {
    case "kick": {
      const out = make(0.5);
      tone(out, sr, (t) => 45 + 120 * expDecay(t, 0.03), (t) => 0.95 * expDecay(t, 0.16));
      return out;
    }
    case "snare": {
      const out = make(0.35);
      const n = noise(11);
      tone(out, sr, (t) => 180 - 40 * Math.min(1, t * 20), (t) => 0.5 * expDecay(t, 0.05));
      for (let i = 0; i < out.length; i++) out[i] += n() * 0.6 * expDecay(i / sr, 0.07);
      return out;
    }
    case "clap": {
      const out = make(0.35);
      const n = noise(23);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        // Three quick bursts then a tail make the hands sound like several people.
        const burst = [0, 0.012, 0.024].reduce((sum, at) => sum + (t >= at ? expDecay(t - at, 0.008) : 0), 0);
        out[i] = n() * (0.35 * burst + 0.5 * (t > 0.03 ? expDecay(t - 0.03, 0.08) : 0));
      }
      return out;
    }
    case "hat": {
      const out = make(0.12);
      hatNoise(out, sr, 0.025, 31);
      return out;
    }
    case "openhat": {
      const out = make(0.5);
      hatNoise(out, sr, 0.14, 37);
      return out;
    }
    case "tom": {
      const out = make(0.5);
      tone(out, sr, (t) => 90 + 70 * expDecay(t, 0.05), (t) => 0.85 * expDecay(t, 0.2));
      return out;
    }
    case "rim": {
      const out = make(0.1);
      tone(out, sr, () => 1700, (t) => 0.4 * expDecay(t, 0.008));
      tone(out, sr, () => 480, (t) => 0.4 * expDecay(t, 0.012));
      return out;
    }
    case "perc": {
      const out = make(0.25);
      tone(out, sr, () => 820, (t) => 0.5 * expDecay(t, 0.05));
      tone(out, sr, () => 1230, (t) => 0.3 * expDecay(t, 0.035));
      return out;
    }
    case "bass": {
      const out = make((60 / SYNTH_LOOP_BPM) * 4);
      const notes = [55, 55, 82.4, 55, 73.4, 55, 65.4, 82.4];
      const eighth = out.length / notes.length;
      for (let i = 0; i < out.length; i++) {
        const index = Math.floor(i / eighth);
        const t = (i - index * eighth) / sr;
        const phase = ((i / sr) * notes[index]) % 1;
        const saw = phase * 2 - 1;
        out[i] = (0.55 * Math.sin(2 * Math.PI * phase) + 0.18 * saw) * Math.min(1, t * 200) * expDecay(t, 0.35);
      }
      return out;
    }
    case "chords": {
      const out = make((60 / SYNTH_LOOP_BPM) * 8);
      const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6]];
      const half = out.length / 2;
      for (let c = 0; c < 2; c++) {
        for (const f of chords[c]) {
          for (let i = 0; i < half; i++) {
            const t = i / sr;
            const env = Math.min(1, t * 8) * Math.min(1, (half - i) / (0.2 * sr));
            out[c * half + i] += 0.12 * env * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t));
          }
        }
      }
      return out;
    }
    case "riser": {
      const out = make(2);
      const n = noise(53);
      let lp = 0;
      for (let i = 0; i < out.length; i++) {
        const progress = i / out.length;
        const k = 0.02 + 0.6 * progress * progress;
        lp += (n() - lp) * k;
        out[i] = lp * progress * 1.6;
      }
      return out;
    }
    case "impact": {
      const out = make(1.5);
      const n = noise(61);
      tone(out, sr, (t) => 38 + 40 * expDecay(t, 0.1), (t) => 0.9 * expDecay(t, 0.5));
      for (let i = 0; i < out.length; i++) out[i] += n() * 0.25 * expDecay(i / sr, 0.12);
      return out;
    }
  }
}

const rendered = new Map<string, AudioBuffer>();

/** Buffer for a synth sound, rendered once per sample rate. */
export function synthBuffer(ctx: BaseAudioContext, kind: SynthKind): AudioBuffer {
  const key = `${kind}@${ctx.sampleRate}`;
  let buffer = rendered.get(key);
  if (!buffer) {
    const data = renderSynth(kind, ctx.sampleRate);
    buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    rendered.set(key, buffer);
  }
  return buffer;
}

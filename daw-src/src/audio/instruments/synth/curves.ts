import { createRng } from "./rng";

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** tanh saturation followed by optional amplitude quantising. Cached because curves are rebuilt on every knob move. */
export function saturationCurve(drive: number, crush: number, steepness = 14): Float32Array<ArrayBuffer> {
  const key = `${Math.round(drive * 40)}_${Math.round(crush * 40)}_${steepness}`;
  const cached = curveCache.get(key);
  if (cached) return cached;
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + drive * steepness;
  const levels = 2 ** Math.max(3, 16 - crush * 12);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    let y = drive > 0.001 ? Math.tanh(k * x) / Math.tanh(k) : x;
    if (crush > 0.001) y = Math.round(y * levels) / levels;
    curve[i] = y;
  }
  curveCache.set(key, curve);
  return curve;
}

/** Gentle ceiling for the last stage of every synth so resonance spikes cannot exceed full scale. */
export const SOFT_CLIP_CURVE: Float32Array<ArrayBuffer> = (() => {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i * 2) / (n - 1) - 1) * 1.6;
    curve[i] = Math.tanh(x) * 0.98;
  }
  return curve;
})();

/** Turns a saw into a pulse: sign of (saw + offset). */
export const PULSE_CURVE: Float32Array<ArrayBuffer> = (() => {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = i / 1024 - 1 < 0 ? -1 : 1;
  return curve;
})();

const bufferCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function cached(ctx: BaseAudioContext, key: string, build: () => AudioBuffer): AudioBuffer {
  let perCtx = bufferCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    bufferCache.set(ctx, perCtx);
  }
  let buffer = perCtx.get(key);
  if (!buffer) {
    buffer = build();
    perCtx.set(key, buffer);
  }
  return buffer;
}

export function noiseBuffer(ctx: BaseAudioContext, pink: boolean): AudioBuffer {
  return cached(ctx, pink ? "pink" : "white", () => {
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = createRng(pink ? 7 : 3);
    if (!pink) {
      for (let i = 0; i < length; i++) data[i] = rng() * 2 - 1;
    } else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const w = rng() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buffer;
  });
}

/** Decaying stereo noise with a darkening tail; seeded so reverb sounds the same live and bounced. */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay = 2.6): AudioBuffer {
  return cached(ctx, `ir${seconds}_${decay}`, () => {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      const rng = createRng(101 + ch);
      let y = 0;
      const fade = ctx.sampleRate * 0.012;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const x = (rng() * 2 - 1) * (1 - t) ** decay * (i < fade ? i / fade : 1);
        const a = 0.85 - 0.7 * Math.min(1, t * 1.6);
        y += (x - y) * a;
        data[i] = y;
      }
    }
    return buffer;
  });
}

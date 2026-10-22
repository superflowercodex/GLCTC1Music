import { mulberry32 } from "./rng";

const cache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Four seconds of white noise, shared by every hit so no voice allocates its own buffer. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = cache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rnd = mulberry32(0x9e3779b9);
    for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
    cache.set(ctx, buf);
  }
  return buf;
}

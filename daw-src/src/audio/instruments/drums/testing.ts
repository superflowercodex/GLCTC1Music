import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import type { Instrument } from "../../types";

export const SAMPLE_RATE = 44100;
export const nodeOffline = NodeOfflineContext as unknown as new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export function makeContext(seconds = 4): OfflineAudioContext {
  return new nodeOffline(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
}

/** Steps an instrument exactly as the clock would, then renders. */
export async function renderSteps(
  make: (ctx: BaseAudioContext) => Instrument,
  steps: number,
  options: { bpm?: number; tail?: number; setup?: (inst: Instrument) => void; from?: number } = {},
): Promise<{ buffer: AudioBuffer; stepDur: number; instrument: Instrument }> {
  const bpm = options.bpm ?? 120;
  const stepDur = 60 / bpm / 4;
  const ctx = makeContext(steps * stepDur + (options.tail ?? 1));
  const instrument = make(ctx);
  instrument.output.connect(ctx.destination);
  options.setup?.(instrument);
  for (let s = options.from ?? 0; s < steps; s++) instrument.onStep(s, s * stepDur, stepDur);
  return { buffer: await ctx.startRendering(), stepDur, instrument };
}

export function rmsBetween(buffer: AudioBuffer, from: number, to: number): number {
  const a = Math.floor(from * buffer.sampleRate);
  const b = Math.min(buffer.length, Math.floor(to * buffer.sampleRate));
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = a; i < b; i++) {
      sum += d[i] * d[i];
      n += 1;
    }
  }
  return Math.sqrt(sum / Math.max(1, n));
}

export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  return peak;
}

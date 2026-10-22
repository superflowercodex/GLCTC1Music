import { stepDuration } from "./clock";
import { AudioEngineError, type Instrument, type InstrumentState } from "./types";

export interface BounceOptions {
  bars: number;
  bpm: number;
  beatsPerBar?: number;
  sampleRate?: number;
  /** Extra seconds rendered after the last step so reverb and release tails are not cut. */
  tailSeconds?: number;
  /** Injected so tests can pass a Node implementation. */
  offlineContext?: new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

/**
 * Renders an instrument's own pattern offline by building a second copy against an
 * OfflineAudioContext and stepping it exactly as the live clock would.
 */
export async function bounceInstrument(
  create: (ctx: BaseAudioContext) => Instrument,
  state: InstrumentState,
  options: BounceOptions,
): Promise<AudioBuffer> {
  const Offline = options.offlineContext ?? (typeof OfflineAudioContext === "undefined" ? undefined : OfflineAudioContext);
  if (!Offline) throw new AudioEngineError("This browser cannot render audio offline.");

  const sampleRate = options.sampleRate ?? 44100;
  const steps = options.bars * (options.beatsPerBar ?? 4) * 4;
  const stepDur = stepDuration(options.bpm);
  const seconds = steps * stepDur + (options.tailSeconds ?? 2);

  const ctx = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
  const instrument = create(ctx);
  instrument.restore(state);
  instrument.output.connect(ctx.destination);
  for (let step = 0; step < steps; step++) instrument.onStep(step, step * stepDur, stepDur);
  return ctx.startRendering();
}

/** Peak and RMS of a rendered buffer, used by tests and by the export sheet's loudness readout. */
export function measure(buffer: AudioBuffer): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    for (const v of buffer.getChannelData(c)) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      count += 1;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, count)) };
}

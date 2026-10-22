import { GranularShifter } from "./granular";
import { freqToMidi, snapToScale, type KeySignature } from "./scales";
import { detectPitch } from "./yin";

export interface TuneSettings {
  key: KeySignature;
  /** 0 leaves the voice alone, 1 snaps fully to the scale. */
  amount: number;
  /** 0 to 1: lets this much of the singer's natural drift through, so it does not sound robotic. */
  humanise: number;
}

/** Pitch ratio that moves a sung frequency toward the nearest scale note. */
export function tuneRatio(freq: number, settings: TuneSettings): number {
  const sung = freqToMidi(freq);
  const target = snapToScale(sung, settings.key);
  const strength = Math.min(1, Math.max(0, settings.amount)) * (1 - 0.6 * Math.min(1, Math.max(0, settings.humanise)));
  return 2 ** (((target - sung) * strength) / 12);
}

/** Maps the 0 to 1 speed control to a glide time constant: instant snapping at 1, a slow slide at 0. */
export function speedToSeconds(speed: number): number {
  return 0.004 * 64 ** (1 - Math.min(1, Math.max(0, speed)));
}

/** One-pole smoother for the correction ratio, in the log domain so up and down moves feel equal. */
export class RatioSmoother {
  private logValue = 0;

  step(targetRatio: number, dt: number, timeConstant: number): number {
    const k = 1 - Math.exp(-dt / Math.max(1e-4, timeConstant));
    this.logValue += (Math.log2(targetRatio) - this.logValue) * k;
    return 2 ** this.logValue;
  }

  reset(): void {
    this.logValue = 0;
  }
}

export interface TuneBufferOptions extends TuneSettings {
  speed: number;
  /** Extra pitch shift in semitones applied on top of the correction. */
  semitones?: number;
  hopSeconds?: number;
}

/** Offline auto-tune of a whole buffer with the same detection, smoothing and shifter the live path uses. Used by tests and by file bounces. */
export function tuneBuffer(input: Float32Array, sampleRate: number, options: TuneBufferOptions): Float32Array {
  const output = new Float32Array(input.length);
  const shifter = new GranularShifter(Math.round(sampleRate * 0.03));
  const smoother = new RatioSmoother();
  const hop = Math.max(64, Math.round(sampleRate * (options.hopSeconds ?? 0.01)));
  const frameLen = Math.round(sampleRate * 0.05);
  const manual = 2 ** ((options.semitones ?? 0) / 12);
  const timeConstant = speedToSeconds(options.speed);
  let target = 1;
  let period = 0;
  for (let start = 0; start < input.length; start += hop) {
    const end = Math.min(input.length, start + hop);
    const from = Math.max(0, end - frameLen);
    const found = end - from === frameLen ? detectPitch(input.subarray(from, end), sampleRate) : null;
    if (found && found.clarity > 0.8) {
      target = tuneRatio(found.freq * manual, options);
      period = sampleRate / found.freq;
    }
    const ratio = smoother.step(target, (end - start) / sampleRate, timeConstant) * manual;
    shifter.process(input.subarray(start, end), output.subarray(start, end), ratio, period);
  }
  return output;
}

/**
 * Two-tap granular pitch shifter. Two read heads sweep through a delay line at (1 - ratio) samples
 * per sample, offset by half a window and cross-faded with sin^2/cos^2 so their gains always sum to one.
 *
 * Pitch-synchronous: when the caller passes the input's period, the window is set to a whole number
 * of periods (an even number, so half a window is also whole periods). Both heads then read the
 * waveform in phase and the cross-fade adds no beating, which is what makes a plain two-tap
 * shifter sound rough on a voice.
 *
 * The class must stay free of outside references: for live use its source text is pasted into an
 * AudioWorklet module (see workletSource), which has no access to this file's imports.
 */
export class GranularShifter {
  private readonly line: Float32Array;
  private readonly mask: number;
  private size: number;
  private readonly nominal: number;
  private write = 0;
  private phase = 0;
  private current = 1;
  private targetSize: number;

  constructor(windowSize = 1440) {
    this.nominal = windowSize;
    this.size = windowSize;
    this.targetSize = windowSize;
    // Power of two with room for the longest window (a 70 Hz voice at 96 kHz), so the read heads never catch the write head.
    let n = 1;
    while (n < windowSize * 8) n *= 2;
    this.line = new Float32Array(n);
    this.mask = n - 1;
  }

  /** Shifts `input` by `ratio` (2 is one octave up). `period` is the input's pitch period in samples, or 0 when unknown. Ratio and window glide so changes do not click. */
  process(input: Float32Array, output: Float32Array, ratio: number, period = 0): void {
    const { line, mask } = this;
    if (period >= 20 && period <= this.nominal) {
      this.targetSize = 2 * Math.max(1, Math.round(this.nominal / (2 * period))) * period;
    } else {
      this.targetSize = this.nominal;
    }
    for (let i = 0; i < output.length; i++) {
      this.current += (ratio - this.current) * 0.002;
      this.size += (this.targetSize - this.size) * 0.0008;
      const size = this.size;
      line[this.write] = input[i];
      const p1 = this.phase;
      const p2 = p1 >= 0.5 ? p1 - 0.5 : p1 + 0.5;
      const g1 = Math.sin(Math.PI * p1);
      const g2 = Math.sin(Math.PI * p2);
      output[i] = this.read(p1 * size + 1) * g1 * g1 + this.read(p2 * size + 1) * g2 * g2;
      this.write = (this.write + 1) & mask;
      this.phase += (1 - this.current) / size;
      if (this.phase >= 1) this.phase -= 1;
      else if (this.phase < 0) this.phase += 1;
    }
  }

  private read(delay: number): number {
    let pos = this.write - delay;
    if (pos < 0) pos += this.line.length;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    return this.line[i0 & this.mask] * (1 - frac) + this.line[(i0 + 1) & this.mask] * frac;
  }
}

export const SHIFTER_PROCESSOR = "gv-shifter";

/**
 * JavaScript for an AudioWorklet module that registers the shifter. It is built from this file's
 * own class text so the live node and the unit tests run the same algorithm. Live code loads it
 * through a Blob URL because the app is static files with no server route for worklet modules.
 */
export function workletSource(): string {
  return `const GranularShifter = ${GranularShifter.toString()};
class ShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ratio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" },
      { name: "period", defaultValue: 0, minValue: 0, maxValue: 2000, automationRate: "k-rate" },
    ];
  }
  constructor() { super(); this.core = new GranularShifter(1440); this.silent = new Float32Array(128); }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const input = inputs[0] && inputs[0][0] ? inputs[0][0] : this.silent;
    this.core.process(input, out, params.ratio[0], params.period[0]);
    return true;
  }
}
registerProcessor("${SHIFTER_PROCESSOR}", ShifterProcessor);`;
}

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Registers the shifter worklet on a context once. Resolves false (never throws) where worklets are unavailable, so callers can fall back to unshifted audio and tell the user. */
export function loadShifterWorklet(ctx: BaseAudioContext): Promise<boolean> {
  const existing = loaded.get(ctx);
  if (existing) return existing;
  const worklet = (ctx as { audioWorklet?: AudioWorklet }).audioWorklet;
  const attempt =
    worklet && typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? (async () => {
          const url = URL.createObjectURL(new Blob([workletSource()], { type: "text/javascript" }));
          try {
            await worklet.addModule(url);
            return true;
          } catch {
            return false;
          } finally {
            URL.revokeObjectURL(url);
          }
        })()
      : Promise.resolve(false);
  loaded.set(ctx, attempt);
  return attempt;
}

export function createShifterNode(ctx: BaseAudioContext): AudioWorkletNode {
  return new AudioWorkletNode(ctx, SHIFTER_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
}

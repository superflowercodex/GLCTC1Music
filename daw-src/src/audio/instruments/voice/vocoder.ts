export const BAND_COUNTS = [8, 12, 16, 24] as const;
export const CARRIERS = ["Saw choir", "Pulse", "Noise", "Keys", "Voice"] as const;
export type CarrierKind = (typeof CARRIERS)[number];

const LOW_HZ = 90;
const HIGH_HZ = 8500;

/** Centre frequencies of `count` bands spaced evenly on a log axis between 90 Hz and 8.5 kHz. */
export function bandCentres(count: number, shiftSemitones = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const f = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((i + 0.5) / count);
    out.push(Math.min(16000, f * 2 ** (shiftSemitones / 12)));
  }
  return out;
}

function absCurve(): Float32Array<ArrayBuffer> {
  // Odd length puts a sample exactly at zero, so silence in gives exactly zero out (no DC into the band gains).
  const curve = new Float32Array(new ArrayBuffer(4097 * 4));
  for (let i = 0; i < curve.length; i++) curve[i] = Math.abs((i / (curve.length - 1)) * 2 - 1);
  return curve;
}

interface Band {
  analysis: BiquadFilterNode;
  rectifier: WaveShaperNode;
  follower: BiquadFilterNode;
  synthesis: BiquadFilterNode;
  gain: GainNode;
}

/**
 * Channel vocoder. The modulator (the voice) is split into bands; each band's envelope drives the
 * level of the same band of the carrier. Plug the voice into `modulator` and any harmonically rich
 * source into `carrier`. A high-pass bypass lets sibilants through, since band envelopes smear them.
 */
export class Vocoder {
  readonly modulator: GainNode;
  readonly carrier: GainNode;
  readonly output: GainNode;
  private readonly bandsOut: GainNode;
  private readonly sibilance: GainNode;
  private bands: Band[] = [];
  private readonly curve = absCurve();
  private count = 16;
  private q = 9;
  private shift = 0;
  private response = 55;

  constructor(private readonly ctx: BaseAudioContext) {
    this.modulator = ctx.createGain();
    this.carrier = ctx.createGain();
    this.output = ctx.createGain();
    this.bandsOut = ctx.createGain();
    this.sibilance = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6000;
    this.modulator.connect(hp).connect(this.sibilance).connect(this.output);
    this.bandsOut.connect(this.output);
    this.sibilance.gain.value = 0.45;
    this.rebuild();
  }

  configure(options: { bands?: number; q?: number; shiftSemitones?: number; responseHz?: number; sibilance?: number; level?: number }): void {
    const structural =
      (options.bands !== undefined && options.bands !== this.count) ||
      (options.q !== undefined && options.q !== this.q) ||
      (options.shiftSemitones !== undefined && options.shiftSemitones !== this.shift);
    if (options.bands !== undefined) this.count = options.bands;
    if (options.q !== undefined) this.q = options.q;
    if (options.shiftSemitones !== undefined) this.shift = options.shiftSemitones;
    if (structural) this.rebuild();
    if (options.responseHz !== undefined && options.responseHz !== this.response) {
      this.response = options.responseHz;
      for (const b of this.bands) b.follower.frequency.value = this.response;
    }
    if (options.sibilance !== undefined) this.sibilance.gain.value = options.sibilance;
    if (options.level !== undefined) this.bandsOut.gain.value = options.level;
  }

  get bandCount(): number {
    return this.bands.length;
  }

  private rebuild(): void {
    for (const b of this.bands) {
      b.gain.disconnect();
      b.synthesis.disconnect();
      b.analysis.disconnect();
      b.rectifier.disconnect();
      b.follower.disconnect();
    }
    this.carrier.disconnect();
    const analysisFreqs = bandCentres(this.count);
    const synthFreqs = bandCentres(this.count, this.shift);
    this.bands = analysisFreqs.map((f, i) => {
      const analysis = this.ctx.createBiquadFilter();
      analysis.type = "bandpass";
      analysis.frequency.value = f;
      analysis.Q.value = this.q;
      const rectifier = this.ctx.createWaveShaper();
      rectifier.curve = this.curve;
      const follower = this.ctx.createBiquadFilter();
      follower.type = "lowpass";
      follower.frequency.value = this.response;
      const synthesis = this.ctx.createBiquadFilter();
      synthesis.type = "bandpass";
      synthesis.frequency.value = synthFreqs[i];
      synthesis.Q.value = this.q;
      const gain = this.ctx.createGain();
      // The follower output adds to this base value, so the carrier is silent until the voice speaks.
      gain.gain.value = 0;
      this.modulator.connect(analysis).connect(rectifier).connect(follower).connect(gain.gain);
      this.carrier.connect(synthesis).connect(gain).connect(this.bandsOut);
      return { analysis, rectifier, follower, synthesis, gain };
    });
  }

  dispose(): void {
    for (const b of this.bands) {
      b.gain.disconnect();
      b.analysis.disconnect();
    }
    this.modulator.disconnect();
    this.carrier.disconnect();
    this.output.disconnect();
  }
}

/** Oscillator layout of a carrier for one note: [type, frequency multiple, detune cents, gain]. */
export function carrierLayers(kind: CarrierKind): ReadonlyArray<readonly [OscillatorType, number, number, number]> {
  switch (kind) {
    case "Saw choir":
      return [["sawtooth", 1, -9, 0.3], ["sawtooth", 1, 0, 0.3], ["sawtooth", 1, 9, 0.3], ["sawtooth", 0.5, 0, 0.2]];
    case "Pulse":
      return [["square", 1, -6, 0.4], ["square", 1, 6, 0.4], ["square", 0.5, 0, 0.25]];
    case "Keys":
      return [["triangle", 1, 0, 0.5], ["sawtooth", 2, 4, 0.18], ["sine", 0.5, 0, 0.3]];
    case "Voice":
      return [["sawtooth", 1, -4, 0.35], ["sawtooth", 1, 5, 0.35], ["square", 2, 0, 0.1]];
    case "Noise":
      return [];
  }
}

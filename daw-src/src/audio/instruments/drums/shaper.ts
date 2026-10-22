/**
 * A waveshaper whose curve can change. The Web Audio spec lets a WaveShaperNode take its curve
 * only once, so a change builds a fresh node and swaps it in.
 */
export class SwappableShaper {
  readonly input: GainNode;
  readonly output: GainNode;
  private node: WaveShaperNode | undefined;
  private direct = true;

  constructor(private readonly ctx: BaseAudioContext, private readonly oversample: OverSampleType = "none") {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  /** `null` bypasses the shaper entirely. */
  setCurve(curve: Float32Array<ArrayBuffer> | null): void {
    const next = curve ? this.ctx.createWaveShaper() : undefined;
    if (next && curve) {
      next.curve = curve;
      next.oversample = this.oversample;
      this.input.connect(next);
      next.connect(this.output);
    }
    if (this.node) {
      this.input.disconnect(this.node);
      this.node.disconnect();
    }
    if (next && this.direct) {
      this.input.disconnect(this.output);
      this.direct = false;
    } else if (!next && !this.direct) {
      this.input.connect(this.output);
      this.direct = true;
    }
    this.node = next;
  }

  dispose(): void {
    this.input.disconnect();
    this.node?.disconnect();
    this.output.disconnect();
  }
}

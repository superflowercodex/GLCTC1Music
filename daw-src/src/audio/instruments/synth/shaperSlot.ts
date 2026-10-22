/**
 * A waveshaper whose curve can change. Some Web Audio implementations refuse to assign a curve twice,
 * so each change builds a fresh node and swaps it in; a null curve is a plain wire.
 */
export class ShaperSlot {
  readonly input: GainNode;
  readonly output: GainNode;
  private shaper: WaveShaperNode | null = null;
  private direct = true;
  private current: Float32Array<ArrayBuffer> | null = null;

  constructor(private readonly ctx: BaseAudioContext, private readonly oversample: OverSampleType = "4x") {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  setCurve(curve: Float32Array<ArrayBuffer> | null): void {
    // Curves are cached by setting, so an unchanged knob must not rebuild the node and click.
    if (curve === this.current) return;
    this.current = curve;
    if (this.shaper) {
      this.input.disconnect(this.shaper);
      this.shaper.disconnect();
      this.shaper = null;
    }
    if (curve === null) {
      if (!this.direct) this.input.connect(this.output);
      this.direct = true;
      return;
    }
    if (this.direct) this.input.disconnect(this.output);
    this.direct = false;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = curve;
    shaper.oversample = this.oversample;
    this.input.connect(shaper).connect(this.output);
    this.shaper = shaper;
  }

  dispose(): void {
    this.shaper?.disconnect();
    this.input.disconnect();
    this.output.disconnect();
  }
}

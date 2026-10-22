import { impulseResponse, saturationCurve, SOFT_CLIP_CURVE } from "./curves";
import { ShaperSlot } from "./shaperSlot";

/**
 * Effects bus shared by the two monosynths: drive and bit reduction, a tone filter, a tempo-synced delay, reverb
 * and a stereo chorus whose depth doubles as the width control (a mono voice has no side signal to widen otherwise).
 */
export class ToneFx {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly shaper: ShaperSlot;
  private readonly tone: BiquadFilterNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly delayTone: BiquadFilterNode;
  private readonly delayWet: GainNode;
  private readonly reverbWet: GainNode;
  private readonly chorusWet: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly clip: WaveShaperNode;
  private readonly nodes: AudioNode[] = [];

  constructor(private readonly ctx: BaseAudioContext) {
    const n = <T extends AudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    this.input = n(ctx.createGain());
    this.shaper = new ShaperSlot(ctx);
    this.tone = n(ctx.createBiquadFilter());
    this.tone.type = "lowpass";
    const sum = n(ctx.createGain());
    this.clip = n(ctx.createWaveShaper());
    this.clip.curve = SOFT_CLIP_CURVE;
    this.output = n(ctx.createGain());

    this.input.connect(this.shaper.input);
    this.shaper.output.connect(this.tone);
    this.tone.connect(sum);

    this.delay = n(ctx.createDelay(2.5));
    this.feedback = n(ctx.createGain());
    this.delayTone = n(ctx.createBiquadFilter());
    this.delayTone.type = "lowpass";
    this.delayTone.frequency.value = 4800;
    this.delayWet = n(ctx.createGain());
    this.tone.connect(this.delay);
    this.delay.connect(this.delayTone);
    this.delayTone.connect(this.feedback).connect(this.delay);
    this.delayTone.connect(this.delayWet).connect(sum);

    const convolver = n(ctx.createConvolver());
    convolver.buffer = impulseResponse(ctx, 1.8, 3);
    this.reverbWet = n(ctx.createGain());
    this.tone.connect(convolver).connect(this.reverbWet).connect(sum);

    const left = n(ctx.createDelay(0.05));
    const right = n(ctx.createDelay(0.05));
    left.delayTime.value = 0.014;
    right.delayTime.value = 0.021;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.7;
    const depthL = n(ctx.createGain());
    const depthR = n(ctx.createGain());
    depthL.gain.value = 0.0035;
    depthR.gain.value = -0.0035;
    this.lfo.connect(depthL).connect(left.delayTime);
    this.lfo.connect(depthR).connect(right.delayTime);
    this.lfo.start();
    const merger = n(ctx.createChannelMerger(2));
    this.chorusWet = n(ctx.createGain());
    this.tone.connect(left).connect(merger, 0, 0);
    this.tone.connect(right).connect(merger, 0, 1);
    merger.connect(this.chorusWet).connect(sum);

    sum.connect(this.clip).connect(this.output);
    this.setDelay(0.4, 0.2, 0);
    this.setReverb(0);
    this.setStereo(0);
    this.setDrive(0, 0);
    this.setTone(12000, 0.7);
  }

  setDrive(drive: number, crush: number): void {
    this.shaper.setCurve(drive + crush < 0.005 ? null : saturationCurve(drive, crush, 45));
  }

  setTone(hz: number, q: number): void {
    this.ramp(this.tone.frequency, hz);
    this.tone.Q.value = q;
  }

  setDelay(seconds: number, feedback: number, mix: number): void {
    this.ramp(this.delay.delayTime, Math.max(0.01, Math.min(2.4, seconds)), 0.03);
    this.ramp(this.feedback.gain, Math.min(0.85, feedback));
    this.ramp(this.delayWet.gain, mix);
  }

  setReverb(mix: number): void {
    this.ramp(this.reverbWet.gain, mix);
  }

  /** 0 is exactly dual-mono; higher values blend in two decorrelated chorus taps. */
  setStereo(amount: number): void {
    this.ramp(this.chorusWet.gain, amount);
  }

  dispose(): void {
    this.lfo.stop();
    this.lfo.disconnect();
    this.shaper.dispose();
    for (const node of this.nodes) node.disconnect();
  }

  private ramp(param: AudioParam, value: number, timeConstant = 0.015): void {
    if (this.ctx.currentTime === 0) param.value = value;
    else param.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
  }
}

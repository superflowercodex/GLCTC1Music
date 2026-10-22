import { mulberry32 } from "./rng";

/** Shared tempo-synced echo and a short room, fed by per-voice send gains. */
export class SendFx {
  readonly delayIn: GainNode;
  readonly reverbIn: GainNode;
  private readonly delay: DelayNode;
  private readonly roomGain: GainNode;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode) {
    this.delayIn = ctx.createGain();
    this.reverbIn = ctx.createGain();
    this.delay = ctx.createDelay(1.5);
    const damp = ctx.createBiquadFilter();
    const feedback = ctx.createGain();
    const wet = ctx.createGain();
    damp.type = "lowpass";
    damp.frequency.value = 3200;
    feedback.gain.value = 0.3;
    wet.gain.value = 0.4;
    this.delay.delayTime.value = 0.375;
    this.delayIn.connect(this.delay);
    this.delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(this.delay);
    damp.connect(wet);
    wet.connect(dest);

    const conv = ctx.createConvolver();
    conv.buffer = this.impulse();
    this.roomGain = ctx.createGain();
    this.roomGain.gain.value = 0.2;
    this.reverbIn.connect(conv);
    conv.connect(this.roomGain);
    this.roomGain.connect(dest);
  }

  /** A dotted eighth, i.e. three 16th steps. */
  syncTo(stepDur: number): void {
    this.delay.delayTime.setTargetAtTime(Math.min(1.4, stepDur * 3), this.ctx.currentTime, 0.02);
  }

  setRoom(level: number): void {
    this.roomGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
  }

  private impulse(): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 0.95);
    const pre = Math.floor(sr * 0.012);
    const ramp = sr * 0.004;
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      const rnd = mulberry32(0x51ed27 + ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        lp += (rnd() * 2 - 1 - lp) * (0.08 + 0.55 * (1 - x) ** 2);
        data[i] = i < pre ? 0 : lp * (1 - x) ** 2.4 * (i < pre + ramp ? (i - pre) / ramp : 1);
      }
    }
    return ir;
  }

  dispose(): void {
    this.delayIn.disconnect();
    this.reverbIn.disconnect();
  }
}

import { driveCurve } from "./curves";
import { SwappableShaper } from "./shaper";
import { smooth } from "./smooth";
import type { SendFx } from "./fx";

/** One drum voice's channel: level, tone, drive, pan and sends into the shared effects. */
export class Strip {
  readonly input: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly shelf: BiquadFilterNode;
  private readonly shaper: SwappableShaper;
  private readonly pan: StereoPannerNode;
  private readonly delaySend: GainNode;
  private readonly reverbSend: GainNode;
  private level = 1;
  private audible = true;
  private lastDrive = -1;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, fx: SendFx) {
    this.input = ctx.createGain();
    this.lp = ctx.createBiquadFilter();
    this.shelf = ctx.createBiquadFilter();
    this.shaper = new SwappableShaper(ctx);
    this.pan = ctx.createStereoPanner();
    this.delaySend = ctx.createGain();
    this.reverbSend = ctx.createGain();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 20000;
    this.lp.Q.value = 0.5;
    this.shelf.type = "highshelf";
    this.shelf.frequency.value = 3200;
    this.shelf.gain.value = 0;
    this.delaySend.gain.value = 0;
    this.reverbSend.gain.value = 0;
    this.input.connect(this.lp).connect(this.shelf).connect(this.shaper.input);
    this.shaper.output.connect(this.pan).connect(dest);
    this.pan.connect(this.delaySend).connect(fx.delayIn);
    this.pan.connect(this.reverbSend).connect(fx.reverbIn);
  }

  private apply(): void {
    smooth(this.ctx, this.input.gain, this.audible ? this.level : 0, 0.005);
  }

  setLevel(level: number): void {
    this.level = level;
    this.apply();
  }

  setAudible(audible: boolean): void {
    this.audible = audible;
    this.apply();
  }

  setPan(pan: number): void {
    this.pan.pan.value = pan;
  }

  /** Low-pass cutoff in Hz, for the 80LA8 style tone control. */
  setCutoff(hz: number): void {
    this.lp.frequency.value = hz;
  }

  /** -1 to 1: negative darkens with a low-pass, positive brightens with a high shelf. */
  setTilt(tone: number): void {
    this.lp.frequency.value = tone < 0 ? Math.max(500, 20000 * 2 ** (tone * 4.6)) : 20000;
    this.shelf.gain.value = tone * 9;
  }

  setDrive(amount: number): void {
    if (amount === this.lastDrive) return;
    this.lastDrive = amount;
    this.shaper.setCurve(amount < 0.001 ? null : driveCurve(amount));
  }

  setSends(delay: number, reverb: number): void {
    this.delaySend.gain.value = delay;
    this.reverbSend.gain.value = reverb;
  }

  dispose(): void {
    this.input.disconnect();
    this.lp.disconnect();
    this.shelf.disconnect();
    this.shaper.dispose();
    this.pan.disconnect();
    this.delaySend.disconnect();
    this.reverbSend.disconnect();
  }
}

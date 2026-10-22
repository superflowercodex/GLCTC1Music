import { createRng } from "./rng";

const LFO_TYPES: readonly (OscillatorType | "sh")[] = ["sine", "triangle", "sawtooth", "square", "sh"];

const SH_STEPS = 32;
const SH_SEGMENT = 250;
const SH_RATE = 8000;

export class LfoUnit {
  readonly out: GainNode;
  private readonly osc: OscillatorNode;
  private readonly oscGain: GainNode;
  private readonly sh: AudioBufferSourceNode;
  private readonly shGain: GainNode;

  constructor(ctx: BaseAudioContext, seed: number) {
    this.out = ctx.createGain();
    this.osc = ctx.createOscillator();
    this.oscGain = ctx.createGain();
    this.sh = ctx.createBufferSource();
    this.shGain = ctx.createGain();
    this.osc.frequency.value = 5;
    this.osc.connect(this.oscGain).connect(this.out);

    const buffer = ctx.createBuffer(1, SH_STEPS * SH_SEGMENT, SH_RATE);
    const data = buffer.getChannelData(0);
    const rng = createRng(seed);
    for (let i = 0; i < SH_STEPS; i++) {
      const value = rng() * 2 - 1;
      data.fill(value, i * SH_SEGMENT, (i + 1) * SH_SEGMENT);
    }
    this.sh.buffer = buffer;
    this.sh.loop = true;
    this.sh.connect(this.shGain).connect(this.out);
    this.shGain.gain.value = 0;
    this.osc.start();
    this.sh.start();
  }

  set(shape: number, hz: number): void {
    const type = LFO_TYPES[Math.max(0, Math.min(LFO_TYPES.length - 1, Math.round(shape)))];
    if (type === "sh") {
      this.oscGain.gain.value = 0;
      this.shGain.gain.value = 1;
      this.sh.playbackRate.value = Math.max(0.01, hz / SH_STEPS);
    } else {
      this.osc.type = type;
      this.osc.frequency.value = Math.max(0.01, hz);
      this.oscGain.gain.value = 1;
      this.shGain.gain.value = 0;
    }
  }

  dispose(): void {
    for (const s of [this.osc, this.sh]) {
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
    }
    for (const n of [this.out, this.osc, this.oscGain, this.sh, this.shGain]) n.disconnect();
  }
}

/**
 * Control signals shared by every voice of one instrument: pitch bend, tape stop, mod wheel, a global
 * cutoff offset and the LFOs. Voices tap them with their own gain nodes, so one knob move reaches
 * notes that are already sounding.
 */
export class ModBus {
  /** -1..1, scaled by each voice's bend range. */
  readonly bend: ConstantSourceNode;
  /** Pitch offset in cents, used for tape-stop dives. */
  readonly tape: ConstantSourceNode;
  /** 0..1 */
  readonly wheel: ConstantSourceNode;
  /** Filter cutoff offset in cents (macros, filter freeze). */
  readonly cutoff: ConstantSourceNode;
  readonly lfos: readonly LfoUnit[];

  constructor(private readonly ctx: BaseAudioContext, lfoCount: number) {
    const source = () => {
      const s = ctx.createConstantSource();
      s.offset.value = 0;
      s.start();
      return s;
    };
    this.bend = source();
    this.tape = source();
    this.wheel = source();
    this.cutoff = source();
    this.lfos = Array.from({ length: lfoCount }, (_, i) => new LfoUnit(ctx, 11 + i));
  }

  /** Moves a control smoothly; sets it outright when time has not started (offline rendering). */
  glide(param: AudioParam, value: number, timeConstant = 0.02): void {
    if (this.ctx.currentTime === 0) param.value = value;
    else param.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
  }

  dispose(): void {
    for (const s of [this.bend, this.tape, this.wheel, this.cutoff]) {
      s.stop();
      s.disconnect();
    }
    for (const l of this.lfos) l.dispose();
  }
}

import { impulseResponse, saturationCurve, SOFT_CLIP_CURVE } from "./curves";
import { DELAY_BEATS, GATE_BEATS, REVERB_SECONDS } from "./galacticParams";
import { ShaperSlot } from "./shaperSlot";

export interface RackSettings {
  fxDrive: number;
  fxCrush: number;
  gRate: number;
  gDepth: number;
  chMode: number;
  chMix: number;
  phMix: number;
  phRate: number;
  phDepth: number;
  phFb: number;
  dlMix: number;
  dlDiv: number;
  dlFb: number;
  dlTone: number;
  dlPing: number;
  rvMix: number;
  rvSize: number;
  rvDamp: number;
  apRate: number;
  apDepth: number;
  width: number;
  outLvl: number;
}

export interface MacroAmounts {
  /** -1..1 */
  bright: number;
  motion: number;
  space: number;
  grit: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Master effects for the whole instrument: drive and crush, trance gate, chorus, phaser, delay, reverb,
 * auto-pan, mid/side width and a limiter. The macros push several of these at once.
 */
export class GalacticRack {
  readonly input: GainNode;
  readonly output: GainNode;

  private readonly nodes: AudioNode[] = [];
  private readonly oscillators: OscillatorNode[] = [];
  private readonly shaper: ShaperSlot;
  private readonly gate: GainNode;
  private readonly gateOsc: OscillatorNode;
  private readonly gateAmount: GainNode;
  private readonly chorusDry: GainNode;
  private readonly chorusWet: GainNode;
  private readonly chorusLfo: OscillatorNode;
  private readonly chorusDepthL: GainNode;
  private readonly chorusDepthR: GainNode;
  private readonly chorusL: DelayNode;
  private readonly chorusR: DelayNode;
  private readonly phaserDry: GainNode;
  private readonly phaserWet: GainNode;
  private readonly phaserFeedback: GainNode;
  private readonly phaserLfo: OscillatorNode;
  private readonly phaserDepth: GainNode;
  private readonly delayInR: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly delayToneL: BiquadFilterNode;
  private readonly delayToneR: BiquadFilterNode;
  private readonly selfL: GainNode;
  private readonly selfR: GainNode;
  private readonly crossLR: GainNode;
  private readonly crossRL: GainNode;
  private readonly delayWet: GainNode;
  private readonly reverbSum: GainNode;
  private readonly reverbPre: DelayNode;
  private readonly reverbDamp: BiquadFilterNode;
  private readonly reverbWet: GainNode;
  private readonly rooms = new Map<number, { feed: GainNode }>();
  private readonly panner: StereoPannerNode;
  private readonly panLfo: OscillatorNode;
  private readonly panDepth: GainNode;
  private readonly sideGain: GainNode;
  private readonly outGain: GainNode;

  constructor(private readonly ctx: BaseAudioContext) {
    const n = <T extends AudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    const osc = (hz: number, type: OscillatorType = "sine"): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      this.oscillators.push(o);
      return o;
    };

    this.input = n(ctx.createGain());
    this.shaper = new ShaperSlot(ctx, "2x");
    this.input.connect(this.shaper.input);

    // Trance gate: a square LFO ducks a gain node.
    this.gate = n(ctx.createGain());
    this.gateOsc = osc(4, "square");
    this.gateAmount = n(ctx.createGain());
    this.gateAmount.gain.value = 0;
    this.gateOsc.connect(this.gateAmount).connect(this.gate.gain);
    this.gate.gain.value = 1;
    this.shaper.output.connect(this.gate);

    // Chorus: two modulated delays into the left and right channels.
    this.chorusDry = n(ctx.createGain());
    this.chorusWet = n(ctx.createGain());
    const chorusOut = n(ctx.createGain());
    this.chorusL = n(ctx.createDelay(0.05));
    this.chorusR = n(ctx.createDelay(0.05));
    this.chorusLfo = osc(0.6);
    this.chorusDepthL = n(ctx.createGain());
    this.chorusDepthR = n(ctx.createGain());
    const chorusMerge = n(ctx.createChannelMerger(2));
    this.chorusLfo.connect(this.chorusDepthL).connect(this.chorusL.delayTime);
    this.chorusLfo.connect(this.chorusDepthR).connect(this.chorusR.delayTime);
    this.gate.connect(this.chorusDry).connect(chorusOut);
    this.gate.connect(this.chorusL).connect(chorusMerge, 0, 0);
    this.gate.connect(this.chorusR).connect(chorusMerge, 0, 1);
    chorusMerge.connect(this.chorusWet).connect(chorusOut);

    // Phaser: four all-pass stages swept by an LFO, with feedback.
    this.phaserDry = n(ctx.createGain());
    this.phaserWet = n(ctx.createGain());
    const phaserOut = n(ctx.createGain());
    this.phaserFeedback = n(ctx.createGain());
    const phaserFbDelay = n(ctx.createDelay(0.02));
    phaserFbDelay.delayTime.value = 0.003;
    this.phaserLfo = osc(0.4);
    this.phaserDepth = n(ctx.createGain());
    this.phaserLfo.connect(this.phaserDepth);
    const stages = [0, 1, 2, 3].map(() => {
      const a = n(ctx.createBiquadFilter());
      a.type = "allpass";
      a.frequency.value = 700;
      a.Q.value = 0.6;
      this.phaserDepth.connect(a.detune);
      return a;
    });
    chorusOut.connect(this.phaserDry).connect(phaserOut);
    chorusOut.connect(stages[0]);
    for (let i = 0; i < 3; i++) stages[i].connect(stages[i + 1]);
    stages[3].connect(this.phaserWet).connect(phaserOut);
    stages[3].connect(phaserFbDelay).connect(this.phaserFeedback).connect(stages[0]);

    // Delay: stereo or ping-pong.
    const delayInL = n(ctx.createGain());
    this.delayInR = n(ctx.createGain());
    this.delayL = n(ctx.createDelay(2.5));
    this.delayR = n(ctx.createDelay(2.5));
    this.delayToneL = n(ctx.createBiquadFilter());
    this.delayToneR = n(ctx.createBiquadFilter());
    this.delayToneL.type = this.delayToneR.type = "lowpass";
    this.selfL = n(ctx.createGain());
    this.selfR = n(ctx.createGain());
    this.crossLR = n(ctx.createGain());
    this.crossRL = n(ctx.createGain());
    this.delayWet = n(ctx.createGain());
    const delayMerge = n(ctx.createChannelMerger(2));
    const sumDry = n(ctx.createGain());
    phaserOut.connect(sumDry);
    phaserOut.connect(delayInL).connect(this.delayL);
    phaserOut.connect(this.delayInR).connect(this.delayR);
    this.delayL.connect(this.delayToneL);
    this.delayR.connect(this.delayToneR);
    this.delayToneL.connect(this.selfL).connect(this.delayL);
    this.delayToneR.connect(this.selfR).connect(this.delayR);
    this.delayToneL.connect(this.crossLR).connect(this.delayR);
    this.delayToneR.connect(this.crossRL).connect(this.delayL);
    this.delayToneL.connect(delayMerge, 0, 0);
    this.delayToneR.connect(delayMerge, 0, 1);
    delayMerge.connect(this.delayWet).connect(sumDry);

    // Reverb: a pre-delay and damping filter feed one convolver per room size.
    this.reverbSum = n(ctx.createGain());
    this.reverbPre = n(ctx.createDelay(0.1));
    this.reverbPre.delayTime.value = 0.012;
    this.reverbDamp = n(ctx.createBiquadFilter());
    this.reverbDamp.type = "lowpass";
    this.reverbWet = n(ctx.createGain());
    sumDry.connect(this.reverbSum);
    sumDry.connect(this.reverbPre).connect(this.reverbDamp);
    this.reverbWet.connect(this.reverbSum);

    // Auto-pan, mid/side width, limiter.
    this.panner = n(ctx.createStereoPanner());
    this.panLfo = osc(0.6);
    this.panDepth = n(ctx.createGain());
    this.panDepth.gain.value = 0;
    this.panLfo.connect(this.panDepth).connect(this.panner.pan);
    this.reverbSum.connect(this.panner);

    const split = n(ctx.createChannelSplitter(2));
    const mixHalf = (gain: number) => {
      const g = n(ctx.createGain());
      g.gain.value = gain;
      return g;
    };
    const midL = mixHalf(0.5);
    const midR = mixHalf(0.5);
    const sideL = mixHalf(0.5);
    const sideR = mixHalf(-0.5);
    const mid = n(ctx.createGain());
    const side = n(ctx.createGain());
    this.sideGain = n(ctx.createGain());
    const sideInverted = mixHalf(-1);
    const widthMerge = n(ctx.createChannelMerger(2));
    this.panner.connect(split);
    split.connect(midL, 0);
    split.connect(midR, 1);
    split.connect(sideL, 0);
    split.connect(sideR, 1);
    midL.connect(mid);
    midR.connect(mid);
    sideL.connect(side);
    sideR.connect(side);
    side.connect(this.sideGain);
    this.sideGain.connect(sideInverted);
    mid.connect(widthMerge, 0, 0);
    this.sideGain.connect(widthMerge, 0, 0);
    mid.connect(widthMerge, 0, 1);
    sideInverted.connect(widthMerge, 0, 1);

    const limiter = n(ctx.createDynamicsCompressor());
    limiter.threshold.value = -5;
    limiter.knee.value = 6;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.outGain = n(ctx.createGain());
    const clip = n(ctx.createWaveShaper());
    clip.curve = SOFT_CLIP_CURVE;
    this.output = n(ctx.createGain());
    widthMerge.connect(limiter).connect(this.outGain).connect(clip).connect(this.output);

    for (const o of this.oscillators) o.start();
  }

  private set(param: AudioParam, value: number, timeConstant = 0.03): void {
    if (this.ctx.currentTime === 0) param.value = value;
    else param.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
  }

  /** Applies every effect setting, adding the macro contributions on top. */
  apply(f: RackSettings, bpm: number, macros: MacroAmounts): void {
    const beat = 60 / bpm;
    const drive = clamp(f.fxDrive + macros.grit * 0.55, 0, 1);
    const crush = clamp(f.fxCrush + macros.grit * 0.35, 0, 1);
    this.shaper.setCurve(drive + crush < 0.01 ? null : saturationCurve(drive, crush));

    const gateBeats = GATE_BEATS[Math.round(f.gRate)];
    const gateDepth = gateBeats ? f.gDepth : 0;
    this.set(this.gateAmount.gain, gateDepth / 2, 0.02);
    this.set(this.gate.gain, 1 - gateDepth / 2, 0.02);
    this.gateOsc.frequency.value = gateBeats ? 1 / (beat * gateBeats * 2) : 4;

    const mode = Math.round(f.chMode);
    const chorusMix = clamp(f.chMix + macros.motion * 0.3, 0, 1);
    this.chorusDry.gain.value = 1 - (mode ? chorusMix * 0.35 : 0);
    this.set(this.chorusWet.gain, mode ? chorusMix : 0);
    const rate = [0.6, 0.5, 0.8, 1.1][mode];
    const depth = [0.002, 0.0016, 0.0027, 0.0034][mode];
    const base = [0.007, 0.0065, 0.0085, 0.0085][mode];
    this.chorusLfo.frequency.value = rate;
    this.set(this.chorusDepthL.gain, depth, 0.05);
    this.set(this.chorusDepthR.gain, -depth, 0.05);
    this.chorusL.delayTime.value = base;
    this.chorusR.delayTime.value = base;

    this.set(this.phaserWet.gain, f.phMix);
    this.phaserDry.gain.value = 1 - f.phMix * 0.3;
    this.phaserLfo.frequency.value = f.phRate;
    this.set(this.phaserDepth.gain, 300 + f.phDepth * 2200, 0.05);
    this.set(this.phaserFeedback.gain, f.phFb, 0.05);

    const time = clamp(beat * DELAY_BEATS[Math.round(f.dlDiv)], 0.02, 2.4);
    const ping = f.dlPing >= 0.5;
    this.set(this.delayL.delayTime, time, 0.08);
    this.set(this.delayR.delayTime, time, 0.08);
    this.set(this.delayWet.gain, clamp(f.dlMix + macros.space * 0.32, 0, 1));
    this.delayInR.gain.value = ping ? 0 : 1;
    this.set(this.selfL.gain, ping ? 0 : f.dlFb, 0.05);
    this.set(this.selfR.gain, ping ? 0 : f.dlFb, 0.05);
    this.set(this.crossLR.gain, ping ? f.dlFb : 0, 0.05);
    this.set(this.crossRL.gain, ping ? f.dlFb : 0, 0.05);
    this.set(this.delayToneL.frequency, f.dlTone, 0.05);
    this.set(this.delayToneR.frequency, f.dlTone, 0.05);

    this.set(this.reverbWet.gain, clamp(f.rvMix + macros.space * 0.4, 0, 1) * 1.3, 0.04);
    this.set(this.reverbDamp.frequency, f.rvDamp, 0.05);
    this.selectRoom(Math.round(f.rvSize));

    this.panLfo.frequency.value = f.apRate;
    this.set(this.panDepth.gain, f.apDepth, 0.05);
    this.sideGain.gain.value = f.width;
    this.set(this.outGain.gain, f.outLvl, 0.03);
  }

  /** Builds a room's convolver the first time it is picked; later switches only move gains. */
  private selectRoom(size: number): void {
    if (!this.rooms.has(size)) {
      const convolver = this.ctx.createConvolver();
      convolver.buffer = impulseResponse(this.ctx, REVERB_SECONDS[size]);
      const feed = this.ctx.createGain();
      feed.gain.value = 0;
      this.reverbDamp.connect(feed).connect(convolver).connect(this.reverbWet);
      this.nodes.push(convolver, feed);
      this.rooms.set(size, { feed });
    }
    for (const [s, room] of this.rooms) this.set(room.feed.gain, s === size ? 1 : 0, 0.05);
  }

  dispose(): void {
    for (const o of this.oscillators) {
      try {
        o.stop();
      } catch {
        // Already stopped.
      }
    }
    this.shaper.dispose();
    for (const node of [...this.oscillators, ...this.nodes]) node.disconnect();
  }
}

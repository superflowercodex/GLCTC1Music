import { createShifterNode } from "./granular";

export const DELAY_DIVISIONS = ["1/4", "1/8", "1/8 dotted", "1/16", "1/4 triplet", "1/8 triplet"] as const;
const DELAY_BEATS = [1, 0.5, 0.75, 0.25, 2 / 3, 1 / 3] as const;
export const ROOM_SECONDS = [0.9, 2.2, 3.6] as const;
export const SPACE_SECONDS = [3, 5.2, 9] as const;

export function delaySeconds(division: number, bpm: number): number {
  return DELAY_BEATS[Math.min(DELAY_BEATS.length - 1, Math.max(0, Math.round(division)))] * (60 / bpm);
}

/** Synthetic stereo impulse response: decaying noise, different per ear, so reverbs need no sample files. */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, power = 2.4): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** power;
  }
  return buffer;
}

function shelf(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  return node;
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(1024 * 4));
  const k = 1 + amount * 24;
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

export interface FxSettings {
  drive: number;
  low: number;
  high: number;
  chorus: number;
  delayMix: number;
  delayDiv: number;
  delayFeedback: number;
  reverbMix: number;
  reverbSize: number;
  reverbDamp: number;
  spaceMix: number;
  spaceSize: number;
  spacePre: number;
  nebula: number;
  orbit: number;
  radiation: number;
  comet: number;
  shimmer: number;
  gravity: number;
}

/** Tone, delay, reverb and the "space" section, as one send/return rack. */
export class FxRack {
  readonly input: GainNode;
  readonly output: GainNode;
  /** Pad and sample reverb sends land here, so they share the rack's room. */
  readonly reverbReturn: GainNode;
  private readonly low: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  private readonly driveShaper: WaveShaperNode;
  private readonly driveWet: GainNode;
  private readonly driveDry: GainNode;
  private readonly chorusWet: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly feedback: GainNode;
  private readonly delaySend: GainNode;
  private readonly roomSend: GainNode;
  private readonly room: ConvolverNode;
  private readonly damp: BiquadFilterNode;
  private readonly spaceSend: GainNode;
  private readonly pre: DelayNode;
  private readonly comet: BiquadFilterNode;
  private readonly space: ConvolverNode;
  private readonly spaceTrem: GainNode;
  private readonly orbitPan: StereoPannerNode;
  private readonly spaceIn: GainNode;
  private readonly lfos: OscillatorNode[] = [];
  private readonly nebulaDepth: GainNode;
  private readonly orbitDepth: GainNode;
  private readonly tremDepth: GainNode;
  private readonly cometDepth: GainNode;
  private readonly shifters: { node: AudioWorkletNode; gain: GainNode }[] = [];
  private roomSize = -1;
  private spaceSizeIndex = -1;
  private lastDriveAmount = -1;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.low = shelf(ctx, "lowshelf", 180);
    this.high = shelf(ctx, "highshelf", 6500);
    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.oversample = "2x";
    this.driveWet = ctx.createGain();
    this.driveDry = ctx.createGain();
    const tone = ctx.createGain();
    this.input.connect(this.low).connect(this.high);
    this.high.connect(this.driveDry).connect(tone);
    this.high.connect(this.driveShaper).connect(this.driveWet).connect(tone);

    // Chorus: a short delay swept by a slow LFO, mixed back under the dry signal.
    const chorusDelay = ctx.createDelay(0.05);
    chorusDelay.delayTime.value = 0.022;
    const chorusLfo = ctx.createOscillator();
    chorusLfo.frequency.value = 0.8;
    const chorusDepth = ctx.createGain();
    chorusDepth.gain.value = 0.004;
    chorusLfo.connect(chorusDepth).connect(chorusDelay.delayTime);
    this.chorusWet = ctx.createGain();
    tone.connect(chorusDelay).connect(this.chorusWet);
    const dryBus = ctx.createGain();
    tone.connect(dryBus);
    this.chorusWet.connect(dryBus);
    dryBus.connect(this.output);

    // Ping-pong delay: each tap feeds the other, panned to opposite sides.
    this.delaySend = ctx.createGain();
    this.delayL = ctx.createDelay(4);
    this.delayR = ctx.createDelay(4);
    this.feedback = ctx.createGain();
    const merger = ctx.createChannelMerger(2);
    dryBus.connect(this.delaySend).connect(this.delayL);
    this.delayL.connect(this.delayR).connect(this.feedback).connect(this.delayL);
    this.delayL.connect(merger, 0, 0);
    this.delayR.connect(merger, 0, 1);
    merger.connect(this.output);

    this.reverbReturn = ctx.createGain();
    this.roomSend = ctx.createGain();
    this.room = ctx.createConvolver();
    this.damp = ctx.createBiquadFilter();
    this.damp.type = "lowpass";
    dryBus.connect(this.roomSend).connect(this.room);
    this.reverbReturn.connect(this.room);
    this.room.connect(this.damp).connect(this.output);

    this.spaceSend = ctx.createGain();
    this.pre = ctx.createDelay(0.5);
    this.comet = ctx.createBiquadFilter();
    this.comet.type = "lowpass";
    this.comet.frequency.value = 18000;
    this.space = ctx.createConvolver();
    this.spaceTrem = ctx.createGain();
    this.orbitPan = ctx.createStereoPanner();
    this.spaceIn = ctx.createGain();
    dryBus.connect(this.spaceSend).connect(this.pre);
    this.pre.connect(this.spaceIn);
    this.spaceIn.connect(this.comet).connect(this.space).connect(this.spaceTrem).connect(this.orbitPan).connect(this.output);

    const lfo = (rate: number): { osc: OscillatorNode; depth: GainNode } => {
      const osc = ctx.createOscillator();
      osc.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0;
      osc.connect(depth);
      this.lfos.push(osc);
      return { osc, depth };
    };
    const nebula = lfo(0.2);
    this.nebulaDepth = nebula.depth;
    this.nebulaDepth.connect(this.pre.delayTime);
    const orbit = lfo(0.25);
    this.orbitDepth = orbit.depth;
    this.orbitDepth.connect(this.orbitPan.pan);
    const trem = lfo(6);
    this.tremDepth = trem.depth;
    this.tremDepth.connect(this.spaceTrem.gain);
    const cometLfo = lfo(0.3);
    this.cometDepth = cometLfo.depth;
    this.cometDepth.connect(this.comet.frequency);
    this.lfoRates = { nebula: nebula.osc, orbit: orbit.osc, trem: trem.osc, comet: cometLfo.osc };

    chorusLfo.start();
    for (const osc of this.lfos) osc.start();
    this.lfos.push(chorusLfo);
  }

  readonly lfoRates: { nebula: OscillatorNode; orbit: OscillatorNode; trem: OscillatorNode; comet: OscillatorNode };

  apply(s: FxSettings, bpm: number): void {
    const t = this.ctx.currentTime;
    this.low.gain.setTargetAtTime(s.low, t, 0.02);
    this.high.gain.setTargetAtTime(s.high, t, 0.02);
    if (s.drive !== this.lastDriveAmount) {
      this.driveShaper.curve = driveCurve(s.drive);
      this.lastDriveAmount = s.drive;
    }
    this.driveWet.gain.value = s.drive;
    this.driveDry.gain.value = 1 - s.drive * 0.8;
    this.chorusWet.gain.value = s.chorus * 0.7;
    this.delaySend.gain.value = s.delayMix;
    const time = delaySeconds(s.delayDiv, bpm);
    this.delayL.delayTime.setTargetAtTime(time, t, 0.05);
    this.delayR.delayTime.setTargetAtTime(time, t, 0.05);
    this.feedback.gain.value = s.delayFeedback;
    this.roomSend.gain.value = s.reverbMix;
    this.damp.frequency.value = s.reverbDamp;
    if (s.reverbSize !== this.roomSize) {
      this.room.buffer = makeImpulse(this.ctx, ROOM_SECONDS[s.reverbSize] ?? 2.2);
      this.roomSize = s.reverbSize;
    }
    this.spaceSend.gain.value = s.spaceMix;
    this.pre.delayTime.value = s.spacePre;
    if (s.spaceSize !== this.spaceSizeIndex) {
      this.space.buffer = makeImpulse(this.ctx, SPACE_SECONDS[s.spaceSize] ?? 3, 1.8);
      this.spaceSizeIndex = s.spaceSize;
    }
    this.nebulaDepth.gain.value = s.nebula * 0.012;
    this.orbitDepth.gain.value = s.orbit;
    this.tremDepth.gain.value = s.radiation * 0.5;
    this.spaceTrem.gain.value = 1 - s.radiation * 0.5;
    this.cometDepth.gain.value = s.comet * 7000;
    this.comet.frequency.value = s.comet > 0 ? 9000 : 18000;
    const ratios = [2, 0.5];
    const levels = [s.shimmer, s.gravity];
    this.shifters.forEach((shifter, i) => {
      shifter.node.parameters.get("ratio")?.setValueAtTime(ratios[i], t);
      shifter.gain.gain.value = levels[i] * 0.6;
    });
  }

  /** Adds the shimmer (octave up) and gravity (octave down) shifters once the worklet is registered. */
  attachShifters(): void {
    if (this.shifters.length > 0) return;
    for (const ratio of [2, 0.5]) {
      const node = createShifterNode(this.ctx);
      node.parameters.get("ratio")?.setValueAtTime(ratio, this.ctx.currentTime);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      this.spaceSend.connect(node).connect(gain).connect(this.spaceIn);
      this.shifters.push({ node, gain });
    }
  }

  dispose(): void {
    for (const osc of this.lfos) osc.stop();
    this.input.disconnect();
    this.output.disconnect();
  }
}

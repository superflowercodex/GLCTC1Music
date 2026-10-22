import type { MasterSettings } from "../project/model";
import { dbToGain } from "./bus";
import { buildEffect, compressorAutoMakeup, smooth, type Effect } from "./effects";

export class OutputRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputRoutingError";
  }
}

/** The master delay is a dotted eighth, capped so very slow tempos do not give a seconds-long echo. */
export function masterDelayMs(bpm: number): number {
  return Math.min(1400, (60000 / bpm) * 0.75);
}

/** The ceiling shaper is linear below this and rounds off toward 1.0 above it, so peaks never reach a hard clip. */
const CEILING_KNEE = 0.9;

function ceilingCurve(): Float32Array<ArrayBuffer> {
  const points = 4097;
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = -1 + (2 * i) / (points - 1);
    const a = Math.abs(x);
    const y = a <= CEILING_KNEE ? a : CEILING_KNEE + (1 - CEILING_KNEE) * Math.tanh((a - CEILING_KNEE) / (1 - CEILING_KNEE));
    out[i] = Math.sign(x) * y;
  }
  return out;
}

interface SinkContext {
  setSinkId?(id: string): Promise<void>;
}
interface SinkElement {
  setSinkId?(id: string): Promise<void>;
}

export interface OutputSupport {
  /** Whether the whole mix can be sent to a chosen device (the booth). */
  booth: boolean;
  /** Whether the cue mix can be sent to a chosen device (the headphones). */
  headphones: boolean;
}

export function outputSupport(): OutputSupport {
  return {
    booth: typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype,
    headphones: typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype,
  };
}

const UNSUPPORTED = "This browser cannot choose an output device (Safari and Firefox do not support it yet). Sound plays on the system output.";

/** The master section: master fader, master filter / delay / reverb, shared send effects, limiter, meters, booth volume and the headphone cue output. */
export class MasterSection {
  /** Track buses and the shared effect returns connect here; carries the master fader. */
  readonly input: GainNode;
  readonly limiter: DynamicsCompressorNode;
  /** Post-limiter tap, mono sum. */
  readonly analyser: AnalyserNode;
  readonly analyserLeft: AnalyserNode;
  readonly analyserRight: AnalyserNode;
  /** Shared effects that tracks send into; they are fully wet and return into `input`. */
  readonly sharedReverb: Effect;
  readonly sharedDelay: Effect;
  /** Tracks with Cue on send here. */
  readonly cueInput: GainNode;

  private readonly filter: BiquadFilterNode;
  private readonly delay: Effect;
  private readonly reverb: Effect;
  private readonly limiterTrim: GainNode;
  private readonly ceiling: WaveShaperNode;
  private readonly ceilingOn: GainNode;
  private readonly ceilingOff: GainNode;
  private readonly booth: GainNode;
  private readonly cueVolume: GainNode;
  private headphoneStream: MediaStreamAudioDestinationNode | undefined;
  private headphoneElement: HTMLAudioElement | undefined;
  private limiterOn: boolean | undefined;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.7;
    this.filter.frequency.value = ctx.sampleRate / 2;
    this.delay = buildEffect("delay", ctx, { feedback: 0.4, tone: 5000, mix: 0 });
    this.reverb = buildEffect("reverb", ctx, { decay: 2.4, damping: 5000, preDelay: 12, mix: 0 });
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.knee.value = 0;
    this.limiterTrim = ctx.createGain();
    this.ceiling = ctx.createWaveShaper();
    // A shaper's curve can be set only once, so the ceiling is switched by crossfading two paths.
    this.ceiling.curve = ceilingCurve();
    this.ceilingOn = ctx.createGain();
    this.ceilingOff = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.analyserLeft = ctx.createAnalyser();
    this.analyserRight = ctx.createAnalyser();
    this.analyserLeft.fftSize = 512;
    this.analyserRight.fftSize = 512;
    this.booth = ctx.createGain();

    this.input.connect(this.filter).connect(this.delay.input);
    this.delay.output.connect(this.reverb.input);
    this.reverb.output.connect(this.limiter).connect(this.limiterTrim);
    this.limiterTrim.connect(this.ceiling).connect(this.ceilingOn).connect(this.analyser);
    this.limiterTrim.connect(this.ceilingOff).connect(this.analyser);
    this.analyser.connect(this.booth).connect(ctx.destination);
    const split = ctx.createChannelSplitter(2);
    this.analyser.connect(split);
    split.connect(this.analyserLeft, 0);
    split.connect(this.analyserRight, 1);

    this.sharedReverb = buildEffect("reverb", ctx, { decay: 2.8, damping: 6000, preDelay: 20, mix: 1 });
    this.sharedDelay = buildEffect("delay", ctx, { time: 375, feedback: 0.4, tone: 5000, mix: 1 });
    this.sharedReverb.output.connect(this.input);
    this.sharedDelay.output.connect(this.input);

    this.cueInput = ctx.createGain();
    this.cueVolume = ctx.createGain();
    this.cueInput.connect(this.cueVolume);

    this.setLimiter(true);
  }

  setGainDb(db: number, at?: number): void {
    smooth(this.ctx, this.input.gain, dbToGain(db), at);
  }

  setFilter(on: boolean, hz: number, at?: number): void {
    // At the Nyquist frequency a low-pass lets everything through, which is what "off" must mean.
    smooth(this.ctx, this.filter.frequency, on ? Math.min(hz, this.ctx.sampleRate / 2) : this.ctx.sampleRate / 2, at);
  }

  setDelay(on: boolean, mix: number, bpm: number): void {
    this.delay.set("time", masterDelayMs(bpm));
    this.delay.set("mix", on ? mix : 0);
    this.sharedDelay.set("time", masterDelayMs(bpm));
  }

  setReverb(on: boolean, mix: number): void {
    this.reverb.set("mix", on ? mix : 0);
  }

  setLimiter(on: boolean): void {
    if (this.limiterOn === on) return;
    this.limiterOn = on;
    const threshold = on ? -1.5 : 0;
    const ratio = on ? 20 : 1;
    this.limiter.threshold.value = threshold;
    this.limiter.ratio.value = ratio;
    this.limiter.attack.value = on ? 0.002 : 0.003;
    this.limiter.release.value = on ? 0.1 : 0.25;
    // The browser's automatic makeup would otherwise lift the whole mix by about a dB.
    this.limiterTrim.gain.value = 1 / compressorAutoMakeup(threshold, 0, ratio);
    this.ceilingOn.gain.value = on ? 1 : 0;
    this.ceilingOff.gain.value = on ? 0 : 1;
  }

  /** Monitor volume of the main output. Exports never include it: they are the mix, not what your speakers do with it. */
  setBoothVolume(volume: number): void {
    smooth(this.ctx, this.booth.gain, Math.min(1, Math.max(0, volume)));
  }

  setCueVolume(volume: number): void {
    smooth(this.ctx, this.cueVolume.gain, Math.min(1, Math.max(0, volume)));
  }

  applySettings(master: MasterSettings, bpm: number): void {
    this.setGainDb(master.gainDb);
    this.setFilter(master.filterOn, master.filterHz);
    this.setDelay(master.delayOn, master.delayMix, bpm);
    this.setReverb(master.reverbOn, master.reverbMix);
    this.setLimiter(master.limiter);
  }

  /** RMS of the mono master mix, 0 to 1. */
  level(): number {
    return rmsOf(this.analyser, this.samples);
  }

  /** [left, right] RMS levels. */
  levels(): [number, number] {
    return [rmsOf(this.analyserLeft, this.samples), rmsOf(this.analyserRight, this.samples)];
  }

  /** Highest absolute sample in the last block; 1.0 or more means the master clipped. */
  peak(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const v of this.samples) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** Sends the main output to a device. "default" is the system default. */
  async setBoothDevice(deviceId: string): Promise<void> {
    const ctx = this.ctx as BaseAudioContext & SinkContext;
    if (typeof ctx.setSinkId !== "function") throw new OutputRoutingError(UNSUPPORTED);
    try {
      await ctx.setSinkId(deviceId === "default" ? "" : deviceId);
    } catch (err) {
      throw new OutputRoutingError(`Could not route the booth output to that device${err instanceof Error ? `: ${err.message}` : "."}`);
    }
  }

  /** Sends the cue mix to a device. Starts the hidden audio element on first use. */
  async setHeadphoneDevice(deviceId: string): Promise<void> {
    const element = await this.ensureHeadphoneElement();
    const sink = element as HTMLAudioElement & SinkElement;
    if (deviceId !== "default" && typeof sink.setSinkId !== "function") throw new OutputRoutingError(UNSUPPORTED);
    try {
      if (typeof sink.setSinkId === "function") await sink.setSinkId(deviceId === "default" ? "" : deviceId);
    } catch (err) {
      throw new OutputRoutingError(`Could not route the headphones to that device${err instanceof Error ? `: ${err.message}` : "."}`);
    }
  }

  /** Connects the cue mix to the audio element that plays it; cheap to call repeatedly. */
  async ensureHeadphoneElement(): Promise<HTMLAudioElement> {
    if (this.headphoneElement) return this.headphoneElement;
    if (typeof AudioContext === "undefined" || !(this.ctx instanceof AudioContext) || typeof Audio === "undefined") {
      throw new OutputRoutingError("Headphone cue needs a live audio output, which this environment does not have.");
    }
    this.headphoneStream = this.ctx.createMediaStreamDestination();
    this.cueVolume.connect(this.headphoneStream);
    const element = new Audio();
    element.srcObject = this.headphoneStream.stream;
    element.autoplay = true;
    this.headphoneElement = element;
    try {
      await element.play();
    } catch (err) {
      throw new OutputRoutingError(`The headphone output could not start${err instanceof Error ? `: ${err.message}` : "."}`);
    }
    return element;
  }

  dispose(): void {
    this.headphoneElement?.pause();
    if (this.headphoneElement) this.headphoneElement.srcObject = null;
    this.sharedReverb.dispose();
    this.sharedDelay.dispose();
    this.delay.dispose();
    this.reverb.dispose();
  }
}

function rmsOf(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>): number {
  const view = scratch.length >= analyser.fftSize ? scratch.subarray(0, analyser.fftSize) : new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(view as Float32Array<ArrayBuffer>);
  let sum = 0;
  for (const v of view) sum += v * v;
  return Math.sqrt(sum / view.length);
}

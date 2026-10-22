import type { Insert } from "../project/model";
import { buildEffect, EFFECT_DEFS, smooth, type Effect } from "./effects";

export function dbToGain(db: number): number {
  return db <= -60 ? 0 : 10 ** (db / 20);
}

/** Where a track's signal can be sent besides its own output. */
export interface BusDestinations {
  master: AudioNode;
  reverb: AudioNode;
  delay: AudioNode;
  cue: AudioNode;
}

interface Chained {
  id: string;
  type: Insert["type"];
  bypass: boolean;
  params: Record<string, number>;
  effect: Effect;
}

/**
 * One mixer channel: input, insert effects, pan, fader, mute, sends, cue and a level meter tap.
 * Signal flow: input, inserts, pan, fader (the sends and meter follow the fader), with the cue tap
 * taken before the fader so you can hear a track in the headphones whatever its level.
 */
export class TrackBus {
  readonly input: GainNode;
  readonly panner: StereoPannerNode;
  readonly output: GainNode;
  readonly analyser: AnalyserNode;
  readonly masterSend: GainNode;
  readonly reverbSend: GainNode;
  readonly delaySend: GainNode;
  readonly cueSend: GainNode;

  private gainDb = 0;
  private muted = false;
  /** True when another track is soloed and this one is not. */
  private silencedBySolo = false;
  private chain: Chained[] = [];
  private wiring = "";
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.output = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.masterSend = ctx.createGain();
    this.reverbSend = ctx.createGain();
    this.delaySend = ctx.createGain();
    this.cueSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.delaySend.gain.value = 0;
    this.cueSend.gain.value = 0;
    this.input.connect(this.panner).connect(this.output);
    this.output.connect(this.analyser);
    this.output.connect(this.masterSend);
    this.output.connect(this.reverbSend);
    this.output.connect(this.delaySend);
    this.panner.connect(this.cueSend);
  }

  connectOutputs(dest: BusDestinations): void {
    this.masterSend.connect(dest.master);
    this.reverbSend.connect(dest.reverb);
    this.delaySend.connect(dest.delay);
    this.cueSend.connect(dest.cue);
  }

  setGainDb(db: number, at?: number): void {
    this.gainDb = db;
    this.apply(at);
  }

  setPan(pan: number, at?: number): void {
    smooth(this.ctx, this.panner.pan, Math.min(1, Math.max(-1, pan)), at);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.apply();
  }

  setSilencedBySolo(silenced: boolean): void {
    this.silencedBySolo = silenced;
    this.apply();
  }

  /** Amounts 0 to 1 into the shared reverb and delay. */
  setSends(reverb: number, delay: number): void {
    smooth(this.ctx, this.reverbSend.gain, Math.min(1, Math.max(0, reverb)));
    smooth(this.ctx, this.delaySend.gain, Math.min(1, Math.max(0, delay)));
  }

  setToMaster(on: boolean): void {
    smooth(this.ctx, this.masterSend.gain, on ? 1 : 0);
  }

  setCue(on: boolean): void {
    smooth(this.ctx, this.cueSend.gain, on ? 1 : 0);
  }

  /**
   * Makes the insert chain match the list. Effects keep their state across edits: only added or
   * retyped inserts are built, only changed parameters are touched, and the audio is re-patched
   * only when the order or a bypass switch changed.
   */
  setInserts(inserts: readonly Insert[]): void {
    const old = new Map(this.chain.map((c) => [c.id, c]));
    const next: Chained[] = [];
    for (const insert of inserts) {
      const existing = old.get(insert.id);
      if (existing && existing.type === insert.type) {
        old.delete(insert.id);
        existing.bypass = insert.bypass;
        for (const def of EFFECT_DEFS[insert.type].params) {
          const value = insert.params[def.id];
          if (typeof value === "number" && Number.isFinite(value) && value !== existing.params[def.id]) {
            existing.effect.set(def.id, value);
            existing.params[def.id] = value;
          }
        }
        next.push(existing);
      } else {
        next.push({ id: insert.id, type: insert.type, bypass: insert.bypass, params: { ...insert.params }, effect: buildEffect(insert.type, this.ctx, insert.params) });
      }
    }
    for (const gone of old.values()) gone.effect.dispose();
    this.chain = next;
    const wiring = next.map((c) => `${c.id}:${c.bypass ? 0 : 1}`).join("|");
    if (wiring !== this.wiring || old.size > 0) this.rewire();
    this.wiring = wiring;
  }

  /** RMS level from 0 to 1 over the last few milliseconds. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    return Math.sqrt(sum / this.samples.length);
  }

  dispose(): void {
    for (const c of this.chain) c.effect.dispose();
    this.chain = [];
    for (const node of [this.input, this.panner, this.output, this.analyser, this.masterSend, this.reverbSend, this.delaySend, this.cueSend]) node.disconnect();
  }

  private rewire(): void {
    this.input.disconnect();
    for (const c of this.chain) c.effect.output.disconnect();
    let tail: AudioNode = this.input;
    for (const c of this.chain) {
      if (c.bypass) continue;
      tail.connect(c.effect.input);
      tail = c.effect.output;
    }
    tail.connect(this.panner);
  }

  private apply(at?: number): void {
    const silent = this.muted || this.silencedBySolo;
    smooth(this.ctx, this.output.gain, silent ? 0 : dbToGain(this.gainDb), at);
  }
}

import { TrackBus } from "./bus";
import { Clock } from "./clock";
import { MasterSection } from "./master";
import { AudioEngineError, type Instrument } from "./types";

/**
 * Owns the one AudioContext, the master chain and the shared clock. Rooms never create their own
 * context: they ask the engine for a bus and attach instruments to it.
 */
export class Engine {
  readonly clock: Clock;
  /** The master section's input: the master fader, then filter, delay, reverb and the limiter. */
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  /** Post-limiter tap for meters and for recording the master. */
  readonly analyser: AnalyserNode;
  readonly section: MasterSection;

  private readonly buses = new Map<string, TrackBus>();
  private readonly busListeners = new Set<(trackId: string, bus: TrackBus) => void>();
  private readonly attached = new Map<string, { instrument: Instrument; detach: () => void }>();
  private readonly meterSamples: Float32Array<ArrayBuffer>;

  constructor(readonly ctx: BaseAudioContext, clock?: Clock) {
    this.clock = clock ?? new Clock(ctx);
    this.section = new MasterSection(ctx);
    this.master = this.section.input;
    this.limiter = this.section.limiter;
    this.analyser = this.section.analyser;
    this.meterSamples = new Float32Array(this.analyser.fftSize);
  }

  /** Browsers start contexts suspended until a user gesture; call this from a click or key handler. */
  async resume(): Promise<void> {
    if (this.ctx instanceof AudioContext && this.ctx.state !== "running") await this.ctx.resume();
  }

  bus(trackId: string): TrackBus {
    let bus = this.buses.get(trackId);
    if (!bus) {
      bus = new TrackBus(this.ctx);
      bus.connectOutputs({ master: this.master, reverb: this.section.sharedReverb.input, delay: this.section.sharedDelay.input, cue: this.section.cueInput });
      this.buses.set(trackId, bus);
      for (const listener of this.busListeners) listener(trackId, bus);
    }
    return bus;
  }

  /** Called for every bus created from now on, so mixer settings reach a track the moment its audio exists. */
  onBusCreated(listener: (trackId: string, bus: TrackBus) => void): () => void {
    this.busListeners.add(listener);
    return () => this.busListeners.delete(listener);
  }

  /** The bus if it already exists; meters use this so drawing never creates audio nodes. */
  peekBus(trackId: string): TrackBus | undefined {
    return this.buses.get(trackId);
  }

  busIds(): string[] {
    return [...this.buses.keys()];
  }

  removeBus(trackId: string): void {
    this.buses.get(trackId)?.dispose();
    this.buses.delete(trackId);
  }

  /** Connects an instrument to a track's bus and feeds it the clock. Re-attaching the same id replaces the old one. */
  attachInstrument(slotId: string, instrument: Instrument, trackId: string): void {
    this.detachInstrument(slotId);
    instrument.output.connect(this.bus(trackId).input);
    const unsubscribe = this.clock.subscribe((step, time, dur) => instrument.onStep(step, time, dur));
    this.attached.set(slotId, {
      instrument,
      detach: () => {
        unsubscribe();
        instrument.output.disconnect();
      },
    });
  }

  detachInstrument(slotId: string): void {
    this.attached.get(slotId)?.detach();
    this.attached.delete(slotId);
  }

  getInstrument(slotId: string): Instrument {
    const entry = this.attached.get(slotId);
    if (!entry) throw new AudioEngineError(`No instrument is attached as "${slotId}".`);
    return entry.instrument;
  }

  /** With any solo active, every non-soloed bus is silenced; with none, all buses play. */
  setSolo(soloIds: ReadonlySet<string>): void {
    for (const [id, bus] of this.buses) bus.setSilencedBySolo(soloIds.size > 0 && !soloIds.has(id));
  }

  /** Master RMS level, 0 to 1. */
  masterLevel(): number {
    this.analyser.getFloatTimeDomainData(this.meterSamples);
    let sum = 0;
    for (const v of this.meterSamples) sum += v * v;
    return Math.sqrt(sum / this.meterSamples.length);
  }
}

let shared: Engine | undefined;
const engineListeners = new Set<(engine: Engine) => void>();

export function getEngine(): Engine {
  if (!shared) {
    shared = new Engine(new AudioContext({ latencyHint: "interactive" }));
    for (const listener of engineListeners) listener(shared);
  }
  return shared;
}

/** Runs the listener now if the engine exists, and once when it is created otherwise. */
export function whenEngine(listener: (engine: Engine) => void): () => void {
  if (shared) listener(shared);
  else engineListeners.add(listener);
  return () => engineListeners.delete(listener);
}

/** The engine if a gesture has already created it; meters and playheads use this so they never force an AudioContext to start. */
export function peekEngine(): Engine | undefined {
  return shared;
}

/** Length of one 16th step in seconds. */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

export type StepListener = (step: number, time: number, stepDur: number) => void;

/** Start, stop and tempo changes, for things (clip playback) that must reschedule when the transport moves. */
export type TransportEvent = { type: "start"; step: number; time: number } | { type: "stop" } | { type: "tempo" };

export interface LoopRegion {
  startStep: number;
  endStep: number;
}

/** Fires `onTick` on a steady beat that is not throttled when the tab is hidden. */
export interface Ticker {
  start(onTick: () => void): void;
  stop(): void;
}

// A Worker keeps ticking in background tabs where setInterval is slowed to once per second or more.
// Node (tests) has no Worker, so it falls back to setInterval.
export function createTicker(intervalMs = 25): Ticker {
  if (typeof Worker === "undefined") {
    let id: ReturnType<typeof setInterval> | undefined;
    return {
      start: (onTick) => {
        id = setInterval(onTick, intervalMs);
      },
      stop: () => {
        if (id !== undefined) clearInterval(id);
      },
    };
  }
  let worker: Worker | undefined;
  return {
    start: (onTick) => {
      const src = `setInterval(() => postMessage(0), ${intervalMs});`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = onTick;
    },
    stop: () => {
      worker?.terminate();
      worker = undefined;
    },
  };
}

const LOOKAHEAD_SECONDS = 0.12;

export class Clock {
  bpm = 120;
  beatsPerBar = 4;
  loop: LoopRegion | null = null;
  playing = false;

  private listeners = new Set<StepListener>();
  private transportListeners = new Set<(event: TransportEvent) => void>();
  private nextStep = 0;
  private nextTime = 0;
  // Anchor for position(): the audio time at which anchorStep was (or will be) heard.
  private anchorTime = 0;
  private anchorStep = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly ticker: Ticker = createTicker(),
  ) {}

  subscribe(listener: StepListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeTransport(listener: (event: TransportEvent) => void): () => void {
    this.transportListeners.add(listener);
    return () => this.transportListeners.delete(listener);
  }

  /** Current position in fractional 16th steps, for playheads. */
  position(): number {
    if (!this.playing) return this.anchorStep;
    const elapsed = Math.max(0, this.ctx.currentTime - this.anchorTime);
    return this.anchorStep + elapsed / stepDuration(this.bpm);
  }

  /** `at` is an audio-clock time to begin on (a count-in ends exactly there); omitted means as soon as possible. */
  start(fromStep = this.anchorStep, at?: number): void {
    if (this.playing) return;
    this.playing = true;
    this.nextStep = fromStep;
    this.nextTime = Math.max(at ?? 0, this.ctx.currentTime + 0.05);
    this.anchorStep = fromStep;
    this.anchorTime = this.nextTime;
    this.ticker.start(() => this.tick());
    this.emitTransport({ type: "start", step: fromStep, time: this.nextTime });
  }

  stop(): void {
    if (!this.playing) return;
    this.anchorStep = this.position();
    this.playing = false;
    this.ticker.stop();
    this.emitTransport({ type: "stop" });
  }

  seek(step: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    this.anchorStep = Math.max(0, step);
    if (wasPlaying) this.start(this.anchorStep);
  }

  /** Changing tempo mid-playback must not move the playhead, so re-anchor at the current position. */
  setBpm(bpm: number): void {
    if (this.playing) {
      this.anchorStep = this.position();
      this.anchorTime = this.ctx.currentTime;
    }
    this.bpm = Math.min(300, Math.max(30, bpm));
    if (this.playing) this.emitTransport({ type: "tempo" });
  }

  private emitTransport(event: TransportEvent): void {
    for (const l of this.transportListeners) l(event);
  }

  private tick(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;
    while (this.nextTime < horizon) {
      const dur = stepDuration(this.bpm);
      for (const listener of this.listeners) listener(this.nextStep, this.nextTime, dur);
      this.nextTime += dur;
      this.nextStep += 1;
      if (this.loop && this.nextStep >= this.loop.endStep) {
        this.nextStep = this.loop.startStep;
        this.anchorStep = this.loop.startStep;
        this.anchorTime = this.nextTime;
      }
    }
  }
}

/** Tempo from tap times in seconds; needs at least two taps, ignores gaps over two seconds. */
export function tempoFromTaps(taps: readonly number[]): number | null {
  const recent: number[] = [];
  for (let i = taps.length - 1; i >= 0; i--) {
    if (i < taps.length - 1 && taps[i + 1] - taps[i] > 2) break;
    recent.unshift(taps[i]);
  }
  if (recent.length < 2) return null;
  const mean = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  return Math.round((60 / mean) * 10) / 10;
}

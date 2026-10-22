import { getEngine } from "./engine";
import type { LoopRegion, StepListener } from "./clock";
import type { Song } from "../project/model";
import { setSongOffsetDb } from "./mixSync";
import { projectStore } from "../store/project";
import { levelToDb, DEFAULT_LEVEL, sectionAtBar, sectionStarts } from "../rooms/song/songModel";

export interface SongClock {
  readonly playing: boolean;
  loop: LoopRegion | null;
  subscribe(listener: StepListener): () => void;
  subscribeTransport(listener: (event: { type: string }) => void): () => void;
  start(fromStep?: number): void;
  stop(): void;
  seek(step: number): void;
  position(): number;
}

export interface PatternTarget {
  readonly activePattern: number | null;
  setPattern(index: number | null): void;
}

export interface SongPlayerDeps {
  clock: SongClock;
  instrument(slotId: string): PatternTarget | undefined;
  beatsPerBar(): number;
  /** Mixer gain offset for a slot while the song plays; null puts the mixer back. */
  setLevelDb(slotId: string, db: number | null): void;
}

export type SongMode = "idle" | "song" | "section";

export interface SongPlayerState {
  mode: SongMode;
  section: number;
}

/**
 * Plays the Song matrix on the shared clock. Patterns switch from inside the clock's step callback,
 * which runs ahead of the audio time on a worker-driven ticker, so section changes stay on the bar line
 * in background tabs where timers are throttled.
 */
export class SongPlayer {
  private state: SongPlayerState = { mode: "idle", section: 0 };
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private song: Song | undefined;
  private saved = new Map<string, number | null>();
  private savedLoop: LoopRegion | null = null;
  private current = -1;
  private unsubscribeTransport: (() => void) | undefined;
  // Our own clock.stop() calls must not be mistaken for Arrange or the transport bar taking the clock.
  private stoppingSelf = false;

  constructor(private readonly deps: SongPlayerDeps) {}

  getState(): SongPlayerState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Plays from the top, or loops one section when `section` is given. */
  play(song: Song, section?: number): void {
    if (song.sections.length === 0) return;
    this.release();
    const { clock } = this.deps;
    if (clock.playing) this.stopClock();

    const stepsPerBar = this.deps.beatsPerBar() * 4;
    const starts = sectionStarts(song.sections);
    const first = section ?? 0;
    const startStep = (starts[first] - 1) * stepsPerBar;

    this.song = song;
    this.savedLoop = clock.loop;
    clock.loop = section === undefined ? null : { startStep, endStep: startStep + song.sections[first].bars * stepsPerBar };

    for (const slotId of Object.keys(song.matrix)) {
      const target = this.deps.instrument(slotId);
      if (target) this.saved.set(slotId, target.activePattern);
      this.deps.setLevelDb(slotId, levelToDb(song.levels?.[slotId] ?? DEFAULT_LEVEL));
    }
    this.apply(first);
    this.unsubscribe = clock.subscribe((step) => this.onStep(step, stepsPerBar));
    this.unsubscribeTransport = clock.subscribeTransport((e) => {
      if (e.type === "stop" && !this.stoppingSelf) this.release();
    });
    this.setState({ mode: section === undefined ? "song" : "section", section: first });
    clock.seek(startStep);
    clock.start(startStep);
  }

  /** Level changes made while the song plays reach the mixer straight away. */
  setLevel(slotId: string, level: number): void {
    if (this.song) this.deps.setLevelDb(slotId, levelToDb(level));
  }

  stop(): void {
    if (this.state.mode === "idle") return;
    this.stopClock();
    this.release();
  }

  private onStep(step: number, stepsPerBar: number): void {
    const song = this.song;
    if (!song) return;
    let next = step + 1;
    const loop = this.deps.clock.loop;
    if (loop && next >= loop.endStep) next = loop.startStep;
    const index = sectionAtBar(song.sections, Math.floor(next / stepsPerBar) + 1);
    if (index === -1) {
      this.finish(song);
      return;
    }
    if (index !== this.current) this.apply(index);
  }

  private apply(index: number): void {
    const song = this.song;
    if (!song) return;
    this.current = index;
    for (const [slotId, row] of Object.entries(song.matrix)) {
      const value = row[index] ?? 0;
      this.deps.instrument(slotId)?.setPattern(value === 0 ? null : value - 1);
    }
    this.setState({ mode: this.state.mode, section: index });
  }

  /** The clock keeps emitting steps already inside its lookahead after stop(), so silence first and restore after the tick ends. */
  private finish(song: Song): void {
    for (const slotId of Object.keys(song.matrix)) this.deps.instrument(slotId)?.setPattern(null);
    this.stopClock();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    queueMicrotask(() => this.release());
  }

  private stopClock(): void {
    this.stoppingSelf = true;
    try {
      this.deps.clock.stop();
    } finally {
      this.stoppingSelf = false;
    }
  }

  private release(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    if (this.song) {
      this.deps.clock.loop = this.savedLoop;
      for (const [slotId, pattern] of this.saved) this.deps.instrument(slotId)?.setPattern(pattern);
      for (const slotId of Object.keys(this.song.matrix)) this.deps.setLevelDb(slotId, null);
    }
    this.saved.clear();
    this.song = undefined;
    this.current = -1;
    this.setState({ mode: "idle", section: this.state.section });
  }

  private setState(next: SongPlayerState): void {
    if (next.mode === this.state.mode && next.section === this.state.section) return;
    this.state = next;
    for (const l of this.listeners) l();
  }
}

let shared: SongPlayer | undefined;

export function getSongPlayer(): SongPlayer {
  shared ??= new SongPlayer({
    get clock() {
      return getEngine().clock;
    },
    instrument(slotId) {
      try {
        return getEngine().getInstrument(slotId);
      } catch {
        // A slot whose audio has not been created yet is simply not part of this playback.
        return undefined;
      }
    },
    beatsPerBar: () => projectStore.get().beatsPerBar,
    setLevelDb(slotId, db) {
      const project = projectStore.get();
      const slot = project.instruments.find((s) => s.id === slotId);
      const track = project.tracks.find((t) => t.id === slot?.trackId);
      if (!slot || !track) return;
      setSongOffsetDb(track.id, db);
    },
  });
  return shared;
}

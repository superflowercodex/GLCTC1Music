import type { Project } from "../project/model";
import { projectStore } from "../store/project";
import { createStore, type Store } from "../store/store";
import { getEngine, type Engine } from "./engine";
import { FILTER_MAX_HZ, FILTER_MIN_HZ } from "./mixMath";

export class PerformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceError";
  }
}

/** A control that can be recorded and replayed. Replay can only ever touch these. */
export interface PerformanceTarget {
  id: string;
  label: string;
  min: number;
  max: number;
  get(): number;
  set(value: number): void;
}

export interface PerformanceEvent {
  /** Position in beats from the project start. */
  beat: number;
  target: string;
  value: number;
  layer: number;
}

export interface PerformanceTake {
  v: 1;
  bpm: number;
  layers: number;
  events: PerformanceEvent[];
}

export interface PerformanceClock {
  readonly playing: boolean;
  /** Position in fractional 16th steps. */
  position(): number;
  subscribe(listener: (step: number, time: number, stepDur: number) => void): () => void;
}

export interface PerformanceDeps {
  clock: PerformanceClock;
  /** The controls that exist right now; asked again whenever it matters, because instruments come and go. */
  targets(): ReadonlyMap<string, PerformanceTarget>;
  /** Called with the new value whenever something changes a target from outside (a knob drag, a fader). */
  watch(listener: (targetId: string, value: number) => void): () => void;
}

export interface PerformanceState {
  armed: boolean;
  recording: boolean;
  replaying: boolean;
  layers: number;
  events: number;
}

export const MAX_EVENTS = 20000;
const MAX_LAYERS = 100;
const MAX_BEAT = 100000;
const MAX_TAKE_BYTES = 5_000_000;
const TARGET_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reads a take from JSON text. Everything is checked and clamped; a take that is not a take is an
 * error the user sees. Targets are only names here, they are checked against the registry before replay.
 */
export function parseTake(text: string): PerformanceTake {
  if (text.length > MAX_TAKE_BYTES) throw new PerformanceError("That file is too large to be a performance take.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PerformanceError("That file is not valid JSON, so it cannot be a performance take.");
  }
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.events)) throw new PerformanceError("That file is not a GLCTC1 performance take (version 1).");
  if (raw.events.length > MAX_EVENTS) throw new PerformanceError(`That take has more than ${MAX_EVENTS} events, which is more than it can replay.`);
  const events: PerformanceEvent[] = [];
  for (const [i, e] of raw.events.entries()) {
    if (!isRecord(e)) throw new PerformanceError(`Event ${i + 1} is not an object.`);
    const { beat, target, value } = e;
    const layer = e.layer === undefined ? 1 : e.layer;
    if (typeof beat !== "number" || !Number.isFinite(beat) || beat < 0 || beat > MAX_BEAT) throw new PerformanceError(`Event ${i + 1} has an invalid position.`);
    if (typeof target !== "string" || !TARGET_PATTERN.test(target)) throw new PerformanceError(`Event ${i + 1} names an invalid control.`);
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new PerformanceError(`Event ${i + 1} has an invalid value.`);
    if (typeof layer !== "number" || !Number.isInteger(layer) || layer < 1 || layer > MAX_LAYERS) throw new PerformanceError(`Event ${i + 1} has an invalid layer.`);
    events.push({ beat, target, value, layer });
  }
  const bpm = typeof raw.bpm === "number" && Number.isFinite(raw.bpm) ? Math.min(300, Math.max(30, raw.bpm)) : 120;
  const layers = events.reduce((max, e) => Math.max(max, e.layer), 0);
  return { v: 1, bpm, layers, events };
}

export function serializeTake(take: PerformanceTake): string {
  return JSON.stringify(take);
}

/**
 * Records changes to registered controls against the transport and replays them from the shared clock.
 * Replay works from the step the clock reports, never from timers, so it cannot drift and follows
 * seeks and loops by itself.
 */
export class PerformanceRecorder {
  readonly state: Store<PerformanceState> = createStore<PerformanceState>({ armed: false, recording: false, replaying: false, layers: 0, events: 0 });

  private events: PerformanceEvent[] = [];
  private byStep = new Map<number, PerformanceEvent[]>();
  private recordingLayer = 0;
  private pending = new Map<string, PerformanceEvent>();
  private stopWatching: (() => void) | undefined;
  private stopReplay: (() => void) | undefined;
  private applying = false;
  /** Events the last replay could not apply because no registered control has that name. */
  skipped = 0;

  constructor(private readonly deps: PerformanceDeps) {}

  take(bpm: number): PerformanceTake {
    return { v: 1, bpm, layers: this.state.get().layers, events: this.events.map((e) => ({ ...e })) };
  }

  lanes(): Array<{ target: string; label: string; beats: number[] }> {
    const targets = this.deps.targets();
    const byTarget = new Map<string, number[]>();
    for (const e of this.events) {
      const list = byTarget.get(e.target) ?? [];
      list.push(e.beat);
      byTarget.set(e.target, list);
    }
    return [...byTarget].map(([target, beats]) => ({ target, label: targets.get(target)?.label ?? target, beats }));
  }

  arm(): void {
    this.patch({ armed: true });
  }

  disarm(): void {
    this.stopLayer();
    this.patch({ armed: false });
  }

  /** Starts a new layer: every move of a control from now on is stored until stopLayer. */
  startLayer(): void {
    if (!this.state.get().armed) throw new PerformanceError("Arm the recorder first.");
    if (this.state.get().recording) return;
    if (this.state.get().layers >= MAX_LAYERS) throw new PerformanceError("This take already has the maximum number of layers.");
    this.recordingLayer = this.state.get().layers + 1;
    this.pending.clear();
    this.stopWatching = this.deps.watch((id, value) => this.capture(id, value));
    this.patch({ recording: true });
  }

  stopLayer(): void {
    if (!this.state.get().recording) return;
    this.stopWatching?.();
    this.stopWatching = undefined;
    const kept = this.events.some((e) => e.layer === this.recordingLayer);
    this.recordingLayer = 0;
    this.pending.clear();
    this.reindex();
    this.patch({ recording: false, layers: kept ? this.state.get().layers + 1 : this.state.get().layers });
  }

  /** Replays the take from the clock. Safe to call twice. */
  startReplay(): void {
    if (this.stopReplay) return;
    this.stopReplay = this.deps.clock.subscribe((step) => this.playStep(step));
    this.patch({ replaying: true });
  }

  stopReplayNow(): void {
    this.stopReplay?.();
    this.stopReplay = undefined;
    this.patch({ replaying: false });
  }

  clear(): void {
    this.stopLayer();
    this.events = [];
    this.reindex();
    this.patch({ layers: 0 });
  }

  removeLastLayer(): void {
    const layers = this.state.get().layers;
    if (layers === 0 || this.state.get().recording) return;
    this.events = this.events.filter((e) => e.layer !== layers);
    this.reindex();
    this.patch({ layers: layers - 1 });
  }

  /** Replaces the take. Events for controls that do not exist here are dropped and counted, never replayed. */
  load(take: PerformanceTake): { accepted: number; rejected: number } {
    this.stopLayer();
    const targets = this.deps.targets();
    const accepted = take.events.filter((e) => targets.has(e.target));
    this.events = accepted.map((e) => ({ ...e }));
    this.reindex();
    this.patch({ layers: accepted.reduce((max, e) => Math.max(max, e.layer), 0) });
    return { accepted: accepted.length, rejected: take.events.length - accepted.length };
  }

  dispose(): void {
    this.stopLayer();
    this.stopReplayNow();
  }

  private capture(id: string, value: number): void {
    if (this.applying || !this.state.get().recording || !this.deps.clock.playing) return;
    const targets = this.deps.targets();
    if (!targets.has(id) || !Number.isFinite(value)) return;
    if (this.events.length >= MAX_EVENTS) return;
    const position = this.deps.clock.position();
    const step = Math.floor(position);
    // One event per control per 16th: a slider drag becomes a curve, not a thousand events.
    const key = `${id}@${step}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.value = value;
      return;
    }
    const event: PerformanceEvent = { beat: position / 4, target: id, value, layer: this.recordingLayer };
    this.pending.set(key, event);
    this.events.push(event);
    this.patch({ events: this.events.length });
  }

  private playStep(step: number): void {
    const due = this.byStep.get(step);
    if (!due) return;
    const targets = this.deps.targets();
    this.applying = true;
    try {
      for (const e of due) {
        if (e.layer === this.recordingLayer) continue;
        const target = targets.get(e.target);
        if (!target) {
          this.skipped += 1;
          continue;
        }
        target.set(Math.min(target.max, Math.max(target.min, e.value)));
      }
    } finally {
      this.applying = false;
    }
  }

  private reindex(): void {
    this.byStep = new Map();
    for (const e of this.events) {
      const step = Math.floor(e.beat * 4 + 1e-9);
      const list = this.byStep.get(step);
      if (list) list.push(e);
      else this.byStep.set(step, [e]);
    }
    this.patch({ events: this.events.length });
  }

  private patch(change: Partial<PerformanceState>): void {
    this.state.set((s) => ({ ...s, ...change }));
  }
}

// ---- Live wiring -------------------------------------------------------------------------------

function updateTrack(trackId: string, patch: (t: Project["tracks"][number]) => Project["tracks"][number]): void {
  projectStore.set((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? patch(t) : t)) }));
}

/** Every control the recorder may touch: track faders, pans and sends, the master section, and the parameters of attached instruments. */
export function liveTargets(engine: Engine, project: Project): Map<string, PerformanceTarget> {
  const out = new Map<string, PerformanceTarget>();
  const add = (t: PerformanceTarget): void => void out.set(t.id, t);
  for (const track of project.tracks) {
    const read = (): Project["tracks"][number] | undefined => projectStore.get().tracks.find((t) => t.id === track.id);
    add({ id: `${track.id}.gain`, label: `${track.name} · Volume`, min: -60, max: 6, get: () => read()?.gainDb ?? 0, set: (v) => updateTrack(track.id, (t) => ({ ...t, gainDb: v })) });
    add({ id: `${track.id}.pan`, label: `${track.name} · Pan`, min: -1, max: 1, get: () => read()?.pan ?? 0, set: (v) => updateTrack(track.id, (t) => ({ ...t, pan: v })) });
    add({ id: `${track.id}.reverb`, label: `${track.name} · Reverb send`, min: 0, max: 1, get: () => read()?.sends.reverb ?? 0, set: (v) => updateTrack(track.id, (t) => ({ ...t, sends: { ...t.sends, reverb: v } })) });
    add({ id: `${track.id}.delay`, label: `${track.name} · Delay send`, min: 0, max: 1, get: () => read()?.sends.delay ?? 0, set: (v) => updateTrack(track.id, (t) => ({ ...t, sends: { ...t.sends, delay: v } })) });
  }
  const master = (patch: Partial<Project["master"]>): void => projectStore.set((p) => ({ ...p, master: { ...p.master, ...patch } }));
  const m = (): Project["master"] => projectStore.get().master;
  add({ id: "master.gain", label: "Master · Volume", min: -60, max: 6, get: () => m().gainDb, set: (v) => master({ gainDb: v }) });
  add({ id: "master.filter", label: "Master · Filter", min: FILTER_MIN_HZ, max: FILTER_MAX_HZ, get: () => m().filterHz, set: (v) => master({ filterHz: v, filterOn: true }) });
  add({ id: "master.delay", label: "Master · Delay", min: 0, max: 1, get: () => m().delayMix, set: (v) => master({ delayMix: v, delayOn: true }) });
  add({ id: "master.reverb", label: "Master · Reverb", min: 0, max: 1, get: () => m().reverbMix, set: (v) => master({ reverbMix: v, reverbOn: true }) });
  for (const slot of project.instruments) {
    let instrument;
    try {
      instrument = engine.getInstrument(slot.id);
    } catch {
      // Its room has not been opened, so there is no live instrument to move.
      continue;
    }
    const name = project.tracks.find((t) => t.id === slot.trackId)?.name ?? slot.kind;
    for (const def of instrument.params) {
      add({
        id: `${slot.id}.${def.id}`,
        label: `${name} · ${def.label}`,
        min: def.min,
        max: def.max,
        get: () => instrument.getParam(def.id),
        set: (v) => instrument.setParam(def.id, v),
      });
    }
  }
  return out;
}

/** Hooks the recorder up to the real engine and project. */
export function createLivePerformanceDeps(engine: Engine): PerformanceDeps {
  return {
    clock: engine.clock,
    targets: () => liveTargets(engine, projectStore.get()),
    watch(listener) {
      const cleanups: Array<() => void> = [];
      const project = projectStore.get();
      for (const slot of project.instruments) {
        let instrument;
        try {
          instrument = engine.getInstrument(slot.id);
        } catch {
          // Not created yet; nothing to watch.
          continue;
        }
        const last = new Map(instrument.params.map((p) => [p.id, instrument.getParam(p.id)]));
        cleanups.push(
          instrument.subscribe(() => {
            for (const def of instrument.params) {
              const value = instrument.getParam(def.id);
              if (value === last.get(def.id)) continue;
              last.set(def.id, value);
              listener(`${slot.id}.${def.id}`, value);
            }
          }),
        );
      }
      let prev = projectStore.get();
      cleanups.push(
        projectStore.subscribe(() => {
          const next = projectStore.get();
          for (const t of next.tracks) {
            const old = prev.tracks.find((o) => o.id === t.id);
            if (!old || old === t) continue;
            if (t.gainDb !== old.gainDb) listener(`${t.id}.gain`, t.gainDb);
            if (t.pan !== old.pan) listener(`${t.id}.pan`, t.pan);
            if (t.sends.reverb !== old.sends.reverb) listener(`${t.id}.reverb`, t.sends.reverb);
            if (t.sends.delay !== old.sends.delay) listener(`${t.id}.delay`, t.sends.delay);
          }
          if (next.master !== prev.master) {
            if (next.master.gainDb !== prev.master.gainDb) listener("master.gain", next.master.gainDb);
            if (next.master.filterHz !== prev.master.filterHz) listener("master.filter", next.master.filterHz);
            if (next.master.delayMix !== prev.master.delayMix) listener("master.delay", next.master.delayMix);
            if (next.master.reverbMix !== prev.master.reverbMix) listener("master.reverb", next.master.reverbMix);
          }
          prev = next;
        }),
      );
      return () => cleanups.forEach((c) => c());
    },
  };
}

let shared: PerformanceRecorder | undefined;

/** The one recorder for the open project; created on first use because it needs the audio engine. */
export function getPerformanceRecorder(): PerformanceRecorder {
  shared ??= new PerformanceRecorder(createLivePerformanceDeps(getEngine()));
  return shared;
}

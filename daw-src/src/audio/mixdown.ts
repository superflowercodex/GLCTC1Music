import { timelineEndBar } from "../project/actions";
import type { Project, Track } from "../project/model";
import { DEFAULT_LEVEL, levelToDb, sectionAtBar, totalBars } from "../rooms/song/songModel";
import { scheduleClick } from "./arrangementPlayback";
import { applyAutomationStep, hasAutomation } from "./automation";
import { patternAtStep, prepareWarpedBuffers, scheduleAudioClips, slotIsArranged } from "./clipPlayer";
import { stepDuration } from "./clock";
import { Engine } from "./engine";
import { instrumentInfo } from "./instruments/registry";
import { getBuffer } from "./media";
import { audibleTrackIds } from "./mixMath";
import { applyProjectMix } from "./mixSync";
import type { Instrument, InstrumentKind } from "./types";

export class MixdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MixdownError";
  }
}

export class MixdownCancelled extends Error {
  constructor() {
    super("Export cancelled.");
    this.name = "MixdownCancelled";
  }
}

export type MixdownRange = { kind: "song" } | { kind: "loop" } | { kind: "bars"; startBar: number; endBar: number };

export interface MixdownDeps {
  offlineContext: new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
  createInstrument(kind: InstrumentKind, ctx: BaseAudioContext): Promise<Instrument>;
  loadBuffer(assetId: string): Promise<AudioBuffer | undefined>;
  scheduleClips: typeof scheduleAudioClips;
  prepareWarped: typeof prepareWarpedBuffers;
}

export interface MixdownOptions {
  range?: MixdownRange;
  /** "arrangement" renders the clips on the timeline; "song" renders the Song room's section matrix instead. */
  source?: "arrangement" | "song";
  sampleRate?: number;
  /** Instrument tracks and their patterns and notes. Off renders only recorded and imported audio. */
  includeInstruments?: boolean;
  /** Use the project's master limiter. Off bypasses it, even if the project has it on. */
  masterLimiter?: boolean;
  metronome?: boolean;
  /** Seconds of silence rendered after the end so reverb and delay tails are not cut. */
  tailSeconds?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  deps?: Partial<MixdownDeps>;
}

export interface MixdownPlan {
  startStep: number;
  endStep: number;
  stepsPerBar: number;
  /** Seconds of music, without the tail. */
  durationSec: number;
  totalSec: number;
}

export interface StemResult {
  trackId: string;
  name: string;
  buffer: AudioBuffer;
}

const DEFAULT_TAIL_SEC = 2;
const CHUNK_SEC = 2;
/** Beyond this the export sheet shows its warning card. */
export const LONG_EXPORT_SEC = 600;

export function planMixdown(project: Project, options: MixdownOptions = {}): MixdownPlan {
  const stepsPerBar = project.beatsPerBar * 4;
  const range = options.range ?? { kind: "song" };
  let startBar = 1;
  let endBar: number;
  if (range.kind === "loop") {
    startBar = project.loop.startBar;
    endBar = project.loop.endBar;
  } else if (range.kind === "bars") {
    startBar = range.startBar;
    endBar = range.endBar;
  } else if ((options.source ?? "arrangement") === "song") {
    if (project.song.sections.length === 0) throw new MixdownError("The song has no sections yet. Build one in the Song room first.");
    endBar = 1 + totalBars(project.song.sections);
  } else {
    endBar = timelineEndBar(project);
    if (endBar <= 1) throw new MixdownError("There is nothing to export yet. Add a clip to the arrangement first.");
  }
  if (!Number.isFinite(startBar) || !Number.isFinite(endBar) || startBar < 1 || endBar <= startBar) {
    throw new MixdownError("The range to export is empty. Pick a loop region that ends after it starts.");
  }
  const startStep = (Math.floor(startBar) - 1) * stepsPerBar;
  const endStep = (Math.floor(endBar) - 1) * stepsPerBar;
  const durationSec = (endStep - startStep) * stepDuration(project.bpm);
  return { startStep, endStep, stepsPerBar, durationSec, totalSec: durationSec + (options.tailSeconds ?? DEFAULT_TAIL_SEC) };
}

/** A rough guess for the export sheet; the real figure is shown once a render finishes. */
export function estimateRenderSeconds(project: Project, plan: MixdownPlan, includeInstruments: boolean): number {
  const instruments = includeInstruments ? project.instruments.length : 0;
  const speedUp = 14 / (1 + instruments * 0.18);
  return Math.max(1, Math.round(1 + plan.totalSec / speedUp));
}

function defaultDeps(overrides: Partial<MixdownDeps> | undefined): MixdownDeps {
  const offline = overrides?.offlineContext ?? (typeof OfflineAudioContext === "undefined" ? undefined : OfflineAudioContext);
  if (!offline) throw new MixdownError("This browser cannot render audio offline, so it cannot export.");
  return {
    offlineContext: offline,
    createInstrument: overrides?.createInstrument ?? ((kind, ctx) => instrumentInfo(kind).create(ctx)),
    loadBuffer: overrides?.loadBuffer ?? getBuffer,
    scheduleClips: overrides?.scheduleClips ?? scheduleAudioClips,
    prepareWarped: overrides?.prepareWarped ?? prepareWarpedBuffers,
  };
}

interface Prepared {
  buffers: Map<string, AudioBuffer>;
  warped: ReadonlyMap<string, AudioBuffer>;
}

async function prepare(project: Project, options: MixdownOptions, deps: MixdownDeps): Promise<Prepared> {
  const buffers = new Map<string, AudioBuffer>();
  if ((options.source ?? "arrangement") === "song") return { buffers, warped: new Map() };
  const names = new Map(project.assets.map((a) => [a.id, a.name]));
  const missing = new Set<string>();
  const audible = audibleTrackIds(project.tracks);
  const wanted = new Set<string>();
  for (const t of project.tracks) {
    if (!audible.has(t.id)) continue;
    for (const c of t.clips) if (c.kind === "audio" && c.assetId) wanted.add(c.assetId);
  }
  for (const id of wanted) {
    if (options.signal?.aborted) throw new MixdownCancelled();
    const buffer = await deps.loadBuffer(id);
    if (buffer) buffers.set(id, buffer);
    else missing.add(names.get(id) ?? id);
  }
  if (missing.size > 0) {
    throw new MixdownError(`These audio files are missing from this device, so the export would leave them out: ${[...missing].join(", ")}. Re-import them in the Library, or remove their clips.`);
  }
  return { buffers, warped: await deps.prepareWarped(project, buffers) };
}

interface PlannedNote {
  step: number;
  runner: Runner;
  note: number;
  velocity: number;
  durationSteps: number;
}

interface Runner {
  slotId: string;
  trackId: string;
  instrument: Instrument;
  /** Whether this slot's pattern is set by the clips (or the song matrix); otherwise the instrument keeps its own. */
  drivenPattern: boolean;
}

/** Song mode: the matrix decides each slot's pattern per section, and the slot's song level offsets its fader. */
function songProject(project: Project): Project {
  const tracks = project.tracks.map((t) => {
    const slot = project.instruments.find((s) => s.trackId === t.id);
    if (!slot || !project.song.matrix[slot.id]) return t;
    return { ...t, gainDb: t.gainDb + levelToDb(project.song.levels?.[slot.id] ?? DEFAULT_LEVEL) };
  });
  return { ...project, tracks };
}

function songPatternAt(project: Project, slotId: string, step: number): number | null {
  const row = project.song.matrix[slotId];
  if (!row) return null;
  const bar = Math.floor(step / (project.beatsPerBar * 4)) + 1;
  const index = sectionAtBar(project.song.sections, bar);
  const value = index === -1 ? 0 : (row[index] ?? 0);
  return value === 0 ? null : value - 1;
}

function planMidiNotes(project: Project, runners: readonly Runner[], plan: MixdownPlan): PlannedNote[] {
  const planned: PlannedNote[] = [];
  for (const runner of runners) {
    const track = project.tracks.find((t) => t.id === runner.trackId);
    if (!track) continue;
    for (const clip of track.clips) {
      if (clip.kind !== "midi" || !clip.notes?.length) continue;
      const clipStart = (clip.startBar - 1) * plan.stepsPerBar;
      const clipEnd = clipStart + clip.lengthBars * plan.stepsPerBar;
      for (const n of clip.notes) {
        const step = clipStart + n.startStep;
        if (step < plan.startStep || step >= plan.endStep || step >= clipEnd) continue;
        planned.push({ step, runner, note: n.pitch, velocity: n.velocity, durationSteps: Math.min(n.lengthSteps, clipEnd - step, plan.endStep - step) });
      }
    }
  }
  return planned.sort((a, b) => a.step - b.step);
}

async function renderOnce(
  project: Project,
  plan: MixdownPlan,
  options: MixdownOptions,
  deps: MixdownDeps,
  prepared: Prepared,
  report: (fraction: number) => void,
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const source = options.source ?? "arrangement";
  const includeInstruments = options.includeInstruments ?? true;
  const frames = Math.max(1, Math.ceil(plan.totalSec * sampleRate));
  const ctx = new deps.offlineContext(2, frames, sampleRate);
  const engine = new Engine(ctx);
  const mix: Project = source === "song" ? songProject(project) : project;
  const audible = audibleTrackIds(mix.tracks);
  applyProjectMix(engine, mix, { monitor: false });

  const runners: Runner[] = [];
  const stepSec = stepDuration(project.bpm);
  try {
    if (includeInstruments) {
      for (const slot of mix.instruments) {
        const track = mix.tracks.find((t) => t.id === slot.trackId);
        if (!track || !audible.has(track.id)) continue;
        if (source === "song" && !mix.song.matrix[slot.id]) continue;
        const instrument = await deps.createInstrument(slot.kind, ctx);
        instrument.restore(slot.state);
        engine.attachInstrument(slot.id, instrument, track.id);
        runners.push({ slotId: slot.id, trackId: track.id, instrument, drivenPattern: source === "song" || slotIsArranged(mix, slot.id) });
      }
    }

    // Clips go through the same scheduler live playback uses, so trim, fades, gain and warp match.
    if (source === "arrangement") {
      const clipProject: Project = { ...mix, tracks: mix.tracks.filter((t) => audible.has(t.id)) };
      deps.scheduleClips(ctx, clipProject, {
        destinationFor: (trackId) => engine.bus(trackId).input,
        buffers: prepared.buffers,
        warped: prepared.warped,
        fromSec: plan.startStep * stepSec,
        atTime: 0,
      });
    }

    const notes = source === "arrangement" ? planMidiNotes(mix, runners, plan) : [];
    const automated = hasAutomation(mix);
    const instrumentFor = (slotId: string): Instrument | undefined => runners.find((r) => r.slotId === slotId)?.instrument;
    let nextStep = plan.startStep;
    let nextNote = 0;

    const scheduleUntil = (limitSec: number): void => {
      while (nextStep < plan.endStep && (nextStep - plan.startStep) * stepSec < limitSec) {
        const step = nextStep;
        const time = (step - plan.startStep) * stepSec;
        if (automated) applyAutomationStep(mix, step, time, { engine, instrumentFor });
        for (const runner of runners) {
          if (runner.drivenPattern) {
            const pattern = source === "song" ? songPatternAt(mix, runner.slotId, step) : patternAtStep(mix, runner.slotId, step);
            // Steps are scheduled seconds ahead of the render, and a synth's setPattern(null) silences every note it
            // has scheduled, so switching off here would cut the last seconds before a gap. Not stepping it is enough.
            if (pattern === null) continue;
            runner.instrument.setPattern(pattern);
          }
          runner.instrument.onStep(step, time, stepSec);
        }
        while (nextNote < notes.length && notes[nextNote].step <= step) {
          const n = notes[nextNote++];
          n.runner.instrument.noteOn({ note: n.note, velocity: n.velocity, time: (n.step - plan.startStep) * stepSec, duration: n.durationSteps * stepSec });
        }
        if (options.metronome && step % 4 === 0) scheduleClick(ctx, time, step % plan.stepsPerBar === 0, engine.master);
        nextStep += 1;
      }
    };

    // Scheduling in slices keeps the number of live audio nodes small on long songs and gives progress and cancel points.
    scheduleUntil(CHUNK_SEC * 2);
    let cancelListener: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      const stop = (): void => reject(new MixdownCancelled());
      if (options.signal?.aborted) stop();
      options.signal?.addEventListener("abort", stop, { once: true });
      cancelListener = () => options.signal?.removeEventListener("abort", stop);
    });
    let halted = false;
    let failSlice: (error: unknown) => void = () => {};
    const sliceFailed = new Promise<never>((_, reject) => {
      failSlice = reject;
    });
    cancelled.catch(() => {
      halted = true;
    });
    const durationSec = frames / sampleRate;
    for (let k = 1; k * CHUNK_SEC < durationSec; k++) {
      void ctx.suspend(k * CHUNK_SEC).then(() => {
        // After a cancel the context is left suspended and simply dropped.
        if (halted) return;
        scheduleUntil((k + 2) * CHUNK_SEC);
        report(Math.min(0.99, (k * CHUNK_SEC) / durationSec));
        return ctx.resume();
      }).catch(failSlice);
    }
    report(0);
    try {
      const result = await Promise.race([ctx.startRendering(), cancelled, sliceFailed]);
      report(1);
      return result;
    } finally {
      cancelListener?.();
    }
  } finally {
    for (const runner of runners) {
      engine.detachInstrument(runner.slotId);
      runner.instrument.dispose();
    }
    engine.section.dispose();
  }
}

/** Renders the project offline through the same mixer graph that plays live. */
export async function mixdownProject(project: Project, options: MixdownOptions = {}): Promise<AudioBuffer> {
  const plan = planMixdown(project, options);
  const deps = defaultDeps(options.deps);
  if (options.signal?.aborted) throw new MixdownCancelled();
  const prepared = await prepare(project, options, deps);
  const master = { ...project.master, limiter: project.master.limiter && options.masterLimiter !== false };
  return renderOnce({ ...project, master }, plan, options, deps, prepared, options.onProgress ?? (() => undefined));
}

function hasSound(track: Track): boolean {
  return track.kind === "instrument" || track.clips.some((c) => c.kind === "audio" || c.kind === "midi" || c.kind === "pattern");
}

/** One file per track, before the master effects and limiter, so the stems can be mixed again elsewhere. */
export async function mixdownStems(project: Project, options: MixdownOptions = {}): Promise<StemResult[]> {
  const plan = planMixdown(project, options);
  const deps = defaultDeps(options.deps);
  const tracks = project.tracks.filter((t) => !t.muted && hasSound(t));
  if (tracks.length === 0) throw new MixdownError("There are no unmuted tracks with sound to export.");
  const prepared = await prepare({ ...project, tracks: project.tracks.map((t) => ({ ...t, solo: false })) }, options, deps);
  const results: StemResult[] = [];
  for (const [i, track] of tracks.entries()) {
    if (options.signal?.aborted) throw new MixdownCancelled();
    const variant: Project = {
      ...project,
      tracks: project.tracks.map((t) => ({ ...t, solo: t.id === track.id, muted: false, toMaster: true, cue: false })),
      master: { ...project.master, gainDb: 0, limiter: false, filterOn: false, delayOn: false, reverbOn: false },
    };
    const buffer = await renderOnce(variant, plan, options, deps, prepared, (f) => options.onProgress?.((i + f) / tracks.length));
    results.push({ trackId: track.id, name: track.name, buffer });
  }
  options.onProgress?.(1);
  return results;
}

import { slotIsArranged, patternAtStep, scheduleAudioClips, type ScheduledClips } from "./clipPlayer";
import { stepDuration } from "./clock";
import { songOffsetFor } from "./mixSync";
import { getEngine, type Engine } from "./engine";
import { loadBuffers, loadedBuffers, peekBuffer } from "./media";
import { scheduleMidiClips } from "./midiPlayer";
import type { Instrument } from "./types";
import type { Project } from "../project/model";
import { projectStore } from "../store/project";
import { createStore } from "../store/store";
import { lsGet, lsSet } from "../storage";

export const metronomeStore = createStore<{ on: boolean }>({ on: lsGet("arrange.metronome", false) });
metronomeStore.subscribe(() => lsSet("arrange.metronome", metronomeStore.get().on));

/** A short tick straight to the speakers, so it never ends up in a recording of the master or in an export. */
export function scheduleClick(ctx: BaseAudioContext, time: number, accent: boolean, destination: AudioNode = ctx.destination): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1200 : 800;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.32, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
  osc.connect(gain).connect(destination);
  osc.start(time);
  osc.stop(time + 0.05);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

interface Session {
  audio: ScheduledClips;
  midi: ScheduledClips;
  /** The step the clock should deliver next; anything else means it jumped (a loop wrap). */
  expected: number;
}

function clipsChanged(a: Project, b: Project): boolean {
  if (a.tracks.length !== b.tracks.length) return true;
  return a.tracks.some((t, i) => t.id !== b.tracks[i].id || t.clips !== b.tracks[i].clips) || a.bpm !== b.bpm || a.beatsPerBar !== b.beatsPerBar;
}

function instrumentOf(engine: Engine, slotId: string): Instrument | undefined {
  try {
    return engine.getInstrument(slotId);
  } catch {
    // Not attached yet (its room has not been opened); nothing to drive.
    return undefined;
  }
}

let active: (() => void) | undefined;

/**
 * Connects the project to the transport: audio and midi clips, pattern clips, the metronome and
 * the loop. Call it once at app start; calling it again returns the same stop function.
 *
 * Ordering matters. The clock calls its listeners in subscription order, and this one sets each
 * arranged instrument's pattern for a step. It must run BEFORE that instrument's own onStep for
 * the same step, so subscribe here before any instrument is attached.
 */
export function startArrangementPlayback(): () => void {
  if (active) return active;
  const engine = getEngine();
  const { clock, ctx } = engine;
  let session: Session | null = null;
  let token = 0;
  let previous = projectStore.get();
  let rescheduleTimer: ReturnType<typeof setTimeout> | undefined;
  const lastBus = new Map<string, string>();

  const stopSession = (at?: number): void => {
    token += 1;
    session?.audio.stop(at);
    session?.midi.stop(at);
    session = null;
  };

  const begin = (fromStep: number, atTime: number, stopOldAt?: number): void => {
    stopSession(stopOldAt);
    const mine = token;
    const project = projectStore.get();
    const fromSec = fromStep * stepDuration(project.bpm);
    const wanted = new Map<string, string>();
    for (const t of project.tracks) for (const c of t.clips) if (c.kind === "audio" && c.assetId) wanted.set(c.assetId, c.name);
    const names = new Map(project.assets.map((a) => [a.id, a.name]));

    const run = (from: number, at: number, expected: number): void => {
      if (mine !== token || !clock.playing) return;
      session = {
        audio: scheduleAudioClips(ctx, project, {
          destinationFor: (id) => engine.bus(id).input,
          buffers: loadedBuffers(),
          fromSec: from,
          atTime: at,
        }),
        midi: scheduleMidiClips(project, { instrumentFor: (slotId) => instrumentOf(engine, slotId), fromSec: from, atTime: at }),
        expected,
      };
    };

    if ([...wanted.keys()].every((id) => peekBuffer(id))) {
      run(fromSec, atTime, fromStep);
      return;
    }
    // Files not decoded yet: start late from wherever the playhead is rather than playing silence.
    void loadBuffers(wanted.keys(), names).then(() => {
      if (mine !== token) return;
      const step = clock.position();
      run(step * stepDuration(project.bpm), ctx.currentTime + 0.05, Math.floor(step) + 1);
    });
  };

  const applyPatterns = (project: Project, step: number): void => {
    for (const slot of project.instruments) {
      if (!slotIsArranged(project, slot.id)) continue;
      const instrument = instrumentOf(engine, slot.id);
      const wanted = patternAtStep(project, slot.id, step);
      if (instrument && instrument.activePattern !== wanted) instrument.setPattern(wanted);
    }
  };

  const unsubStep = clock.subscribe((step, time) => {
    const project = projectStore.get();
    applyPatterns(project, step);
    if (session && step !== session.expected) begin(step, time, time);
    if (session) session.expected = step + 1;
    if (metronomeStore.get().on && step % 4 === 0) scheduleClick(ctx, time, step % (project.beatsPerBar * 4) === 0);
  });

  const unsubTransport = clock.subscribeTransport((e) => {
    if (e.type === "start") begin(e.step, e.time);
    else if (e.type === "stop") stopSession();
    else begin(clock.position(), ctx.currentTime + 0.05);
  });

  const syncEngine = (project: Project): void => {
    if (clock.bpm !== project.bpm) clock.setBpm(project.bpm);
    clock.beatsPerBar = project.beatsPerBar;
    const spb = project.beatsPerBar * 4;
    clock.loop = project.loop.on ? { startStep: (project.loop.startBar - 1) * spb, endStep: (project.loop.endBar - 1) * spb } : null;

    const soloed = new Set(project.tracks.filter((t) => t.solo).map((t) => t.id));
    for (const t of project.tracks) {
      const sig = `${t.muted}|${t.gainDb}|${t.pan}`;
      if (lastBus.get(t.id) === sig) continue;
      lastBus.set(t.id, sig);
      const bus = engine.bus(t.id);
      bus.setMuted(t.muted);
      bus.setGainDb(t.gainDb + songOffsetFor(t.id));
      bus.setPan(t.pan);
    }
    engine.setSolo(soloed);

    const ids = new Set(project.tracks.map((t) => t.id));
    for (const old of previous.tracks) {
      if (ids.has(old.id)) continue;
      lastBus.delete(old.id);
      engine.removeBus(old.id);
    }
    const slotIds = new Set(project.instruments.map((s) => s.id));
    for (const old of previous.instruments) if (!slotIds.has(old.id)) engine.detachInstrument(old.id);
  };

  const prewarm = (project: Project): void => {
    const ids: string[] = [];
    for (const t of project.tracks) for (const c of t.clips) if (c.kind === "audio" && c.assetId && !peekBuffer(c.assetId)) ids.push(c.assetId);
    if (ids.length > 0) void loadBuffers(ids, new Map(project.assets.map((a) => [a.id, a.name])));
  };

  syncEngine(previous);
  prewarm(previous);

  const unsubProject = projectStore.subscribe(() => {
    const next = projectStore.get();
    if (next === previous) return;
    const changed = clipsChanged(previous, next);
    syncEngine(next);
    previous = next;
    if (!changed) return;
    prewarm(next);
    if (!clock.playing) return;
    // Edits while playing are heard: restart the scheduled clips from the playhead once the drag settles.
    clearTimeout(rescheduleTimer);
    rescheduleTimer = setTimeout(() => {
      if (clock.playing) begin(clock.position(), ctx.currentTime + 0.05);
    }, 150);
  });

  active = () => {
    clearTimeout(rescheduleTimer);
    unsubStep();
    unsubTransport();
    unsubProject();
    stopSession();
    active = undefined;
  };
  return active;
}

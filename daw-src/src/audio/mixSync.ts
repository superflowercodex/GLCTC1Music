import type { Project, Track } from "../project/model";
import { projectStore } from "../store/project";
import { applyAutomationStep, hasAutomation } from "./automation";
import type { TrackBus } from "./bus";
import { peekEngine, whenEngine, type Engine } from "./engine";
import { OutputRoutingError } from "./master";
import { showToast } from "./media";
import type { Instrument } from "./types";

export interface MixOptions {
  /** Live monitoring (booth volume, headphone cue). Offline renders leave it off: an export is the mix, not what your speakers do with it. */
  monitor: boolean;
}

// The Song room's per-instrument level rides on top of the Mixer fader instead of replacing it.
const songOffsetDb = new Map<string, number>();

export function songOffsetFor(trackId: string): number {
  return songOffsetDb.get(trackId) ?? 0;
}

/** Sets (or with null clears) the Song level offset for a track and applies it to the live bus. */
export function setSongOffsetDb(trackId: string, db: number | null): void {
  if (db === null) songOffsetDb.delete(trackId);
  else songOffsetDb.set(trackId, db);
  const track = projectStore.get().tracks.find((t) => t.id === trackId);
  if (track) peekEngine()?.bus(trackId).setGainDb(track.gainDb + songOffsetFor(trackId));
}

export function applyTrackMix(bus: TrackBus, track: Track, anySolo: boolean, offsetDb = 0): void {
  bus.setGainDb(track.gainDb + offsetDb);
  bus.setPan(track.pan);
  bus.setMuted(track.muted);
  bus.setSilencedBySolo(anySolo && !track.solo);
  bus.setSends(track.sends.reverb, track.sends.delay);
  bus.setToMaster(track.toMaster);
  bus.setCue(track.cue);
  bus.setInserts(track.inserts);
}

/**
 * Makes the engine's buses and master match the project. The offline mixdown uses this too, which is what
 * keeps an export sounding like playback.
 */
export function applyProjectMix(engine: Engine, project: Project, options: MixOptions): void {
  const anySolo = project.tracks.some((t) => t.solo);
  for (const track of project.tracks) applyTrackMix(engine.bus(track.id), track, anySolo, options.monitor ? songOffsetFor(track.id) : 0);
  engine.section.applySettings(project.master, project.bpm);
  if (options.monitor) {
    engine.section.setBoothVolume(project.master.boothVolume);
    engine.section.setCueVolume(project.master.headphoneVolume);
  } else {
    engine.section.setBoothVolume(1);
  }
}

interface Routing {
  booth: string;
  headphones: string;
  cueActive: boolean;
}

let started: (() => void) | undefined;

/**
 * Keeps the live engine in step with the project: faders, pan, mute, solo, sends, inserts, cue,
 * send-to-master, the master section, output devices and automation lanes. The app calls this once at
 * startup; it waits for the audio engine to exist, so it never forces an AudioContext to start.
 */
export function startMixSync(): () => void {
  if (started) return started;
  let stopEngine: (() => void) | undefined;
  const stopWaiting = whenEngine((engine) => {
    stopEngine = attachMixSync(engine);
  });
  started = () => {
    stopWaiting();
    stopEngine?.();
    started = undefined;
  };
  return started;
}

export function attachMixSync(engine: Engine): () => void {
  let project = projectStore.get();
  let previous: Project | undefined;
  const routing: Routing = { booth: "default", headphones: "default", cueActive: false };
  const reported = new Set<string>();

  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : "Audio routing failed.";
    if (reported.has(message)) return;
    reported.add(message);
    showToast(message);
  };

  const syncDevices = (next: Project): void => {
    const { master } = next;
    if (master.boothDeviceId !== routing.booth) {
      routing.booth = master.boothDeviceId;
      engine.section.setBoothDevice(master.boothDeviceId).catch(report);
    }
    const cueActive = next.tracks.some((t) => t.cue);
    if (cueActive && (!routing.cueActive || master.headphoneDeviceId !== routing.headphones)) {
      routing.headphones = master.headphoneDeviceId;
      engine.section.setHeadphoneDevice(master.headphoneDeviceId).catch((err: unknown) => {
        if (err instanceof OutputRoutingError) report(err);
        else report(new OutputRoutingError("The headphone output could not start."));
      });
    }
    routing.cueActive = cueActive;
  };

  const sync = (): void => {
    const next = projectStore.get();
    if (previous && next.tracks === previous.tracks && next.master === previous.master && next.bpm === previous.bpm) {
      project = next;
      return;
    }
    project = next;
    applyProjectMix(engine, next, { monitor: true });
    syncDevices(next);
    previous = next;
  };

  const unsubBus = engine.onBusCreated((trackId, bus) => {
    const track = projectStore.get().tracks.find((t) => t.id === trackId);
    if (track) applyTrackMix(bus, track, projectStore.get().tracks.some((t) => t.solo), songOffsetFor(trackId));
  });
  const unsubProject = projectStore.subscribe(sync);

  const originals = new Map<string, { instrument: Instrument; paramId: string; value: number }>();
  const unsubStep = engine.clock.subscribe((step, time) => {
    if (!hasAutomation(project)) return;
    applyAutomationStep(project, step, time, {
      engine,
      instrumentFor: (slotId) => {
        try {
          return engine.getInstrument(slotId);
        } catch {
          // The room has not been opened yet, so this instrument has no audio to automate.
          return undefined;
        }
      },
      remember: (instrument, paramId, value) => {
        const key = `${instrument.kind}.${paramId}`;
        if (!originals.has(key)) originals.set(key, { instrument, paramId, value });
      },
    });
  });
  const unsubTransport = engine.clock.subscribeTransport((e) => {
    if (e.type !== "stop" || !hasAutomation(project)) return;
    // Automation moves faders and knobs only while the song plays; afterwards they go back to where they were set.
    applyProjectMix(engine, projectStore.get(), { monitor: true });
    for (const { instrument, paramId, value } of originals.values()) instrument.setParam(paramId, value);
    originals.clear();
  });

  sync();
  return () => {
    unsubBus();
    unsubProject();
    unsubStep();
    unsubTransport();
  };
}

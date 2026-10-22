import { instrumentInfo } from "../audio/instruments/registry";
import { getEngine } from "../audio/engine";
import { midiRouter, registerInstrumentTargets } from "../audio/midi";
import type { Instrument, InstrumentKind } from "../audio/types";
import { projectStore } from "../store/project";
import { newId, type Track } from "./model";

const pending = new Map<InstrumentKind, Promise<Instrument>>();

interface LiveInstrument {
  slotId: string;
  trackId: string;
  instrument: Instrument;
  /** Writes the instrument's current state into the project now instead of after the debounce. */
  flush(): void;
  stop(): void;
}
const live = new Map<InstrumentKind, LiveInstrument>();

/** Called before the open project changes or the tab hides, so the saved copy never lags the sound. */
export function flushInstrumentStates(): void {
  for (const entry of live.values()) entry.flush();
}

/** Tears down every instrument of the open project so a different project can build its own. */
export async function releaseAllInstruments(): Promise<void> {
  const creations = [...pending.values()];
  pending.clear();
  await Promise.allSettled(creations);
  for (const entry of live.values()) teardown(entry);
  live.clear();
}

function teardown(entry: LiveInstrument): void {
  const engine = getEngine();
  entry.stop();
  engine.detachInstrument(entry.slotId);
  engine.removeBus(entry.trackId);
  entry.instrument.dispose();
}

/** True when the project no longer holds the slot this instance was built for (its track was deleted or the project changed). */
function isStale(kind: InstrumentKind, entry: LiveInstrument): boolean {
  const slot = projectStore.get().instruments.find((s) => s.kind === kind);
  return !slot || slot.id !== entry.slotId;
}

/**
 * Returns the project's instance of an instrument, creating its slot, track and audio on first use.
 * Concurrent callers share one creation so React strict mode cannot make two copies.
 */
export function ensureInstrument(kind: InstrumentKind): Promise<Instrument> {
  const entry = live.get(kind);
  if (entry && isStale(kind, entry)) {
    // Deleting the track removed the slot but not the audio; rebuild instead of handing back a detached instance.
    teardown(entry);
    live.delete(kind);
    pending.delete(kind);
  }
  const existing = pending.get(kind);
  if (existing) return existing;
  const created = create(kind);
  pending.set(kind, created);
  // A failed build must not stay cached, or every later call would fail the same way.
  created.catch(() => {
    if (pending.get(kind) === created) pending.delete(kind);
  });
  return created;
}

async function create(kind: InstrumentKind): Promise<Instrument> {
  const engine = getEngine();
  const info = instrumentInfo(kind);
  const project = projectStore.get();
  const slot = project.instruments.find((s) => s.kind === kind);

  const instrument = await info.create(engine.ctx);
  const slotId = slot?.id ?? newId("slot");
  const trackId = slot?.trackId ?? newId("trk");

  if (slot) {
    instrument.restore(slot.state);
  } else {
    const track: Track = {
      id: trackId,
      name: info.name,
      kind: "instrument",
      color: info.color,
      slotId,
      muted: false,
      solo: false,
      gainDb: 0,
      pan: 0,
      sends: { reverb: 0, delay: 0 },
      inserts: [],
      cue: false,
      toMaster: true,
      clips: [],
      automation: [],
    };
    projectStore.set((p) => ({
      ...p,
      tracks: [...p.tracks, track],
      instruments: [...p.instruments, { id: slotId, kind, trackId, state: instrument.serialize() }],
    }));
  }

  engine.attachInstrument(slotId, instrument, trackId);

  // Keep the saved copy current, but not on every slider tick.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let changed = false;
  const flush = (): void => {
    clearTimeout(timer);
    if (!changed) return;
    changed = false;
    projectStore.set((p) => ({
      ...p,
      instruments: p.instruments.map((s) => (s.id === slotId ? { ...s, state: instrument.serialize() } : s)),
    }));
  };
  const unlinkMidi = registerInstrumentTargets(midiRouter, info.name, instrument);
  const unsubscribe = instrument.subscribe(() => {
    changed = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  });
  live.set(kind, {
    slotId,
    trackId,
    instrument,
    flush,
    stop: () => {
      clearTimeout(timer);
      unsubscribe();
      unlinkMidi();
    },
  });

  return instrument;
}

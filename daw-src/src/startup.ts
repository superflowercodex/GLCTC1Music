import { startArrangementPlayback } from "./audio/arrangementPlayback";
import { startMixSync } from "./audio/mixSync";
import { addTrack, makeTrack } from "./project/actions";
import "./project/history";
import { ensureInstrument } from "./project/instruments";
import { startPersistence } from "./project/persist";
import { startShortcuts } from "./shortcuts";
import { projectStore, uiStore } from "./store/project";

let toastId = 0;

/** A new project starts with a small band so the room is never an empty page. */
async function seedStarterProject(): Promise<void> {
  if (projectStore.get().tracks.length > 0) return;
  await ensureInstrument("drum80la8");
  await ensureInstrument("acid30lee");
  await ensureInstrument("lead0010110");
  projectStore.set((p) => {
    const vocal = makeTrack(p, "audio", { name: "Vocal", color: "#7cf0c0" });
    const visuals = makeTrack(p, "video", { name: "Visuals", color: "#ffd36a" });
    return addTrack(addTrack(p, vocal), visuals);
  });
}

/**
 * Wires the app together. Order matters: arrangement playback must subscribe to the clock before
 * any instrument attaches, so it can set each instrument's pattern before that instrument's own
 * onStep runs for the same step.
 */
export async function startApp(): Promise<void> {
  startArrangementPlayback();
  startMixSync();
  startShortcuts();
  try {
    await startPersistence();
    await seedStarterProject();
  } catch (error) {
    // The studio must still open if saved data cannot be read; say so instead of showing a blank room.
    const message = error instanceof Error ? error.message : "unknown problem";
    uiStore.set((s) => ({ ...s, toast: { id: ++toastId, text: `Could not load your saved project: ${message}` } }));
  }
}

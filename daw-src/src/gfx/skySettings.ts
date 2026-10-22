import { lsGet, lsSet } from "../storage";
import { createStore, useStore } from "../store/store";
import type { SkyMode } from "./sky";

const KEY = "background";
const MODES: readonly SkyMode[] = ["alive", "calm", "still"];

export const SKY_MODE_LABEL: Record<SkyMode, string> = { alive: "Alive", calm: "Calm", still: "Still" };

function read(): SkyMode {
  const v = lsGet<unknown>(KEY, "alive");
  return MODES.includes(v as SkyMode) ? (v as SkyMode) : "alive";
}

/** Background: Alive (default), Calm (slower, reacts less) or Still (one static frame). Kept per browser. */
export const skyStore = createStore<{ mode: SkyMode }>({ mode: read() });

export function setSkyMode(mode: SkyMode): void {
  skyStore.set({ mode });
  // A refused write (private window) still changes the sky for this session.
  lsSet(KEY, mode);
}

export function useSkyMode(): SkyMode {
  return useStore(skyStore, (s) => s.mode);
}

export const SKY_MODES = MODES;

import { createStore } from "../store/store";
import { lsGet, lsSet } from "../storage";

export type DockAction = "toggle" | "minimise" | "expand";

export const PLAYER_MIN_KEY = "player.minimised";

/** Pure, so the state rules can be tested without a browser. */
export function nextDock(minimised: boolean, action: DockAction): boolean {
  if (action === "toggle") return !minimised;
  return action === "minimise";
}

/** Anything but a stored `true` (missing, corrupt, wrong type) opens the full player. */
export function readMinimised(): boolean {
  return lsGet<unknown>(PLAYER_MIN_KEY, false) === true;
}

/** Whether the transport is collapsed to its floating pill. The choice survives reloads. */
export const playerDock = createStore<{ minimised: boolean }>({ minimised: readMinimised() });

export function dispatchDock(action: DockAction): void {
  const minimised = nextDock(playerDock.get().minimised, action);
  if (minimised === playerDock.get().minimised) return;
  playerDock.set({ minimised });
  lsSet(PLAYER_MIN_KEY, minimised);
}

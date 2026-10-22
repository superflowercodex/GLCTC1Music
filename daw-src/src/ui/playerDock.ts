import { createStore } from "../store/store";
import { lsGet, lsSet } from "../storage";
import { layoutModeFor } from "./layoutMode";

export type DockAction = "toggle" | "minimise" | "expand";

export const PLAYER_MIN_KEY = "player.minimised";

/** Pure, so the state rules can be tested without a browser. */
export function nextDock(minimised: boolean, action: DockAction): boolean {
  if (action === "toggle") return !minimised;
  return action === "minimise";
}

/**
 * A stored choice wins: `true` is the pill, any other stored value the full player.
 * With nothing readable stored, a phone starts on the mini-player, so the room keeps its height; larger screens start open.
 */
export function readMinimised(phone = startsOnPhone()): boolean {
  const stored = lsGet<unknown>(PLAYER_MIN_KEY, null);
  if (stored === null) return phone;
  return stored === true;
}

function startsOnPhone(): boolean {
  if (typeof innerWidth === "undefined" || innerWidth <= 0 || innerHeight <= 0) return false;
  return layoutModeFor(innerWidth, innerHeight) === "phone";
}

/** Whether the transport is collapsed to its floating pill. The choice survives reloads. */
export const playerDock = createStore<{ minimised: boolean }>({ minimised: readMinimised() });

export function dispatchDock(action: DockAction): void {
  const minimised = nextDock(playerDock.get().minimised, action);
  if (minimised === playerDock.get().minimised) return;
  playerDock.set({ minimised });
  lsSet(PLAYER_MIN_KEY, minimised);
}

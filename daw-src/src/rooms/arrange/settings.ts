import { lsGet, lsSet } from "../../storage";
import { createStore } from "../../store/store";
import { clampZoom, ZOOM } from "./timeline";

export interface ArrangeSettings {
  pxPerBeat: number;
  snap: boolean;
  /** Grid in beats; 0 is one bar. */
  gridBeats: number;
}

export const arrangeSettings = createStore<ArrangeSettings>({
  pxPerBeat: clampZoom(lsGet("arrange.zoom", ZOOM.default)),
  snap: lsGet("arrange.snap", true),
  gridBeats: lsGet("arrange.grid", 1),
});

arrangeSettings.subscribe(() => {
  const s = arrangeSettings.get();
  lsSet("arrange.zoom", s.pxPerBeat);
  lsSet("arrange.snap", s.snap);
  lsSet("arrange.grid", s.gridBeats);
});

export function setZoom(pxPerBeat: number): void {
  arrangeSettings.set((s) => ({ ...s, pxPerBeat: clampZoom(pxPerBeat) }));
}

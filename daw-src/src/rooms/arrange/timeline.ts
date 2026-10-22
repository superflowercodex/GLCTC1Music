import type { Project } from "../../project/model";
import { timelineEndBar } from "../../project/actions";

export const ZOOM = { min: 4, max: 64, step: 4, default: 22 } as const;

/** Grid sizes in beats; 0 stands for one whole bar, whatever the time signature. */
export const GRID_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.25, label: "1/16" },
  { value: 0.5, label: "1/8" },
  { value: 1, label: "1/4" },
  { value: 2, label: "1/2" },
  { value: 0, label: "Bar" },
];

export const HEAD_W = { min: 176, max: 420, default: 264 } as const;

export function clampHeadWidth(px: number): number {
  return Math.min(HEAD_W.max, Math.max(HEAD_W.min, Math.round(px)));
}

export const TIME_SIGNATURES: readonly number[] = [2, 3, 4, 5, 6, 7];

export function clampZoom(pxPerBeat: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(pxPerBeat)));
}

export function pxPerBar(pxPerBeat: number, beatsPerBar: number): number {
  return pxPerBeat * beatsPerBar;
}

export function gridInBars(gridBeats: number, beatsPerBar: number): number {
  return gridBeats === 0 ? 1 : gridBeats / beatsPerBar;
}

export function barToPx(bar: number, ppb: number): number {
  return (bar - 1) * ppb;
}

export function pxToBar(px: number, ppb: number): number {
  return px / ppb + 1;
}

/** Snaps a bar position to the grid, never before bar 1. With snap off it only clamps. */
export function snapBar(bar: number, gridBars: number, snapOn: boolean): number {
  const clamped = Math.max(1, bar);
  if (!snapOn || gridBars <= 0) return clamped;
  return Math.max(1, 1 + Math.round((clamped - 1) / gridBars) * gridBars);
}

/** Bars of the song itself: from bar 1 to the end of the last clip. */
export function songBars(project: Project): number {
  return Math.max(0, Math.ceil(timelineEndBar(project) - 1 - 1e-9));
}

/** How many bars the canvas shows: the song plus a little room, never fewer than 8. */
export function visibleBars(project: Project): number {
  return Math.max(8, songBars(project) + 2, Math.ceil(project.loop.endBar) - 1);
}

/** Pixels per beat that make `bars` bars exactly fill `widthPx`. */
export function fitZoom(widthPx: number, bars: number, beatsPerBar: number): number {
  return clampZoom(widthPx / (Math.max(1, bars) * beatsPerBar));
}

export function formatBarPosition(bar: number): string {
  const whole = Math.floor(bar + 1e-9);
  const frac = bar - whole;
  return frac < 0.005 ? String(whole) : `${whole}.${String(Math.round(frac * 100)).padStart(2, "0")}`;
}

/** Index of the lane a vertical position falls in, clamped so a drag past either end sticks to the first or last lane. */
export function laneIndexAt(y: number, lanes: ReadonlyArray<{ top: number; bottom: number }>): number {
  if (lanes.length === 0) return -1;
  const i = lanes.findIndex((l) => y >= l.top && y < l.bottom);
  if (i >= 0) return i;
  return y < lanes[0].top ? 0 : lanes.length - 1;
}

/** Bars between labelled ticks so that neighbouring labels never sit closer than ~56px. */
export function barStride(ppb: number): number {
  for (const n of [1, 2, 4, 8, 16, 32]) if (ppb * n >= 56) return n;
  return 64;
}

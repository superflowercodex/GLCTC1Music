import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { findClip, moveClips, resizeClip } from "../../project/actions";
import { holdHistory } from "../../project/history";
import type { Clip } from "../../project/model";
import { projectStore } from "../../store/project";
import { freeDelta } from "./overlap";
import { arrangeSettings } from "./settings";
import { selectClips, selectionStore, toggleClip } from "./selection";
import { gridInBars, laneIndexAt, pxPerBar, snapBar } from "./timeline";

export type DragMode = "move" | "start" | "end";

const DRAG_THRESHOLD_PX = 3;

/**
 * Pointer handling for clips: move (also across tracks), and resize from either edge. Updates go
 * straight to the project store computed from the project as it was when the gesture began, so
 * the drag is live and heard while playing, and the whole gesture is a single undo step.
 */
export function useClipDrag(): (e: ReactPointerEvent, clip: Clip, mode: DragMode) => void {
  return useCallback((e, clip, mode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let ids = selectionStore.get().ids;
    if (additive) {
      toggleClip(clip.id);
      ids = selectionStore.get().ids;
      if (!ids.includes(clip.id)) return;
    } else if (!ids.includes(clip.id)) {
      selectClips([clip.id]);
      ids = [clip.id];
    }

    const base = projectStore.get();
    const startedAt = findClip(base, clip.id);
    if (!startedAt) return;
    const { beatsPerBar } = base;
    const startX = e.clientX;
    const lanes = [...document.querySelectorAll<HTMLElement>("[data-lane]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.lane ?? "", top: r.top, bottom: r.bottom };
    });
    const originLane = lanes.findIndex((l) => l.id === startedAt.track.id);
    const release = holdHistory();
    let moved = false;

    const onMove = (ev: PointerEvent): void => {
      const settings = arrangeSettings.get();
      const ppb = pxPerBar(settings.pxPerBeat, beatsPerBar);
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - e.clientY) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const grid = gridInBars(settings.gridBeats, beatsPerBar);
      const deltaBars = dx / ppb;
      if (mode === "move") {
        const target = snapBar(clip.startBar + deltaBars, grid, settings.snap);
        const deltaTracks = originLane < 0 ? 0 : laneIndexAt(ev.clientY, lanes) - originLane;
        const wanted = target - clip.startBar;
        const shift = settings.avoidOverlaps ? freeDelta(base, ids, wanted, deltaTracks) : wanted;
        projectStore.set(moveClips(base, ids, { deltaBars: shift, deltaTracks }));
      } else if (mode === "start") {
        projectStore.set(resizeClip(base, clip.id, "start", snapBar(clip.startBar + deltaBars, grid, settings.snap)));
      } else {
        const end = clip.startBar + clip.lengthBars;
        projectStore.set(resizeClip(base, clip.id, "end", snapBar(end + deltaBars, grid, settings.snap)));
      }
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      release();
      // A plain click on one of several selected clips narrows the selection to it.
      if (!moved && !additive && ids.length > 1) selectClips([clip.id]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);
}

import { useCallback, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { projectStore } from "../../store/project";
import { arrangeSettings } from "./settings";
import { seekToBar } from "./ops";
import { marqueeHits, marqueeSelection, selectClips, selectionStore, type Box } from "./selection";
import { gridInBars, pxPerBar, pxToBar, snapBar } from "./timeline";

const DRAG_PX = 4;
const EDGE_PX = 36;
const MAX_SCROLL_PX = 22;

/** Pixels to scroll this frame: zero in the middle, ramping up as the pointer reaches (or passes) an edge. */
export function edgeSpeed(pos: number, min: number, max: number, edge = EDGE_PX, top = MAX_SCROLL_PX): number {
  if (pos < min + edge) return -Math.min(top, ((min + edge - pos) / edge) * top);
  if (pos > max - edge) return Math.min(top, ((pos - (max - edge)) / edge) * top);
  return 0;
}

/**
 * Rubber-band selection over empty lane space. A drag selects every clip it touches, live, and
 * scrolls the timeline near its edges; a plain click clears the selection and moves the playhead.
 * Returns the band in canvas coordinates for drawing.
 */
export function useMarquee(scroller: RefObject<HTMLElement | null>, grid: RefObject<HTMLElement | null>) {
  const [band, setBand] = useState<Box | null>(null);

  const start = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      const box = scroller.current;
      const canvas = grid.current;
      if (e.button !== 0 || !box || !canvas) return;
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const base = additive ? [...selectionStore.get().ids] : [];
      const lane = e.currentTarget;
      const laneLeft = lane.getBoundingClientRect().left;
      const origin = { x: e.clientX, y: e.clientY };
      const headW = parseFloat(getComputedStyle(box).getPropertyValue("--head-w")) || 0;
      const rulerH = parseFloat(getComputedStyle(box).getPropertyValue("--ruler-h")) || 0;
      const at0 = canvas.getBoundingClientRect();
      const anchor = { x: e.clientX - at0.left, y: e.clientY - at0.top };
      const pointer = { x: e.clientX, y: e.clientY };
      let dragging = false;
      let raf = 0;
      const deadline = performance.now() + 5 * 60_000;

      const apply = (): void => {
        const view = box.getBoundingClientRect();
        const x = Math.min(view.right - 1, Math.max(view.left + headW, pointer.x));
        const y = Math.min(view.bottom - 1, Math.max(view.top + rulerH, pointer.y));
        const now = canvas.getBoundingClientRect();
        const cur = { x: x - now.left, y: y - now.top };
        const rect: Box = { left: Math.min(anchor.x, cur.x), right: Math.max(anchor.x, cur.x), top: Math.min(anchor.y, cur.y), bottom: Math.max(anchor.y, cur.y) };
        setBand(rect);
        const boxes = [...canvas.querySelectorAll<HTMLElement>("[data-clip]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.dataset.clip ?? "", left: r.left - now.left, right: r.right - now.left, top: r.top - now.top, bottom: r.bottom - now.top };
        });
        selectClips(marqueeSelection(base, marqueeHits(rect, boxes), additive));
      };

      const tick = (): void => {
        if (performance.now() > deadline) return finish(false);
        const view = box.getBoundingClientRect();
        const dx = edgeSpeed(pointer.x, view.left + headW, view.right);
        const dy = edgeSpeed(pointer.y, view.top + rulerH, view.bottom);
        if (dx !== 0 || dy !== 0) {
          box.scrollLeft += dx;
          box.scrollTop += dy;
          apply();
        }
        raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent): void => {
        pointer.x = ev.clientX;
        pointer.y = ev.clientY;
        if (!dragging) {
          if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < DRAG_PX) return;
          dragging = true;
          raf = requestAnimationFrame(tick);
        }
        apply();
      };
      const finish = (commit: boolean): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        cancelAnimationFrame(raf);
        setBand(null);
        if (!commit || dragging) return;
        if (!additive) selectClips([]);
        const s = arrangeSettings.get();
        const p = projectStore.get();
        const ppb = pxPerBar(s.pxPerBeat, p.beatsPerBar);
        seekToBar(snapBar(pxToBar(origin.x - laneLeft, ppb), gridInBars(s.gridBeats, p.beatsPerBar), s.snap));
      };
      const onUp = (): void => finish(true);
      const onCancel = (): void => finish(false);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [scroller, grid],
  );

  return { band, start };
}

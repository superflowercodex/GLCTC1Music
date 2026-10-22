import { useEffect, type RefObject } from "react";

export type FadeEdges = "" | "start" | "end" | "start end";

/** Which edges have more content beyond them. 1px slack absorbs sub-pixel scroll positions. */
export function fadeEdges(scrollPos: number, clientSize: number, scrollSize: number): FadeEdges {
  const start = scrollPos > 1;
  const end = scrollPos + clientSize < scrollSize - 1;
  return start && end ? "start end" : start ? "start" : end ? "end" : "";
}

/**
 * Seamless edges for a scrolling region: sets `data-fade` on the element so `.fade-x` / `.fade-y` (styles.css)
 * dissolve only the edges that still have content beyond them, instead of a hard clip.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, axis: "x" | "y" = "x", mounted: unknown = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const next = axis === "x" ? fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth) : fadeEdges(el.scrollTop, el.clientHeight, el.scrollHeight);
      if (el.dataset.fade !== next) el.dataset.fade = next;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    // Children growing (a track added) changes scrollSize without resizing the scroller itself.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mo?.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [ref, axis, mounted]);
}

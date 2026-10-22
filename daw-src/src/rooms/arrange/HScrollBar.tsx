import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Thumb size and offset as fractions of the track, from a scroller's geometry. */
export function thumbGeometry(scrollLeft: number, clientWidth: number, scrollWidth: number, minFraction = 0.06): { size: number; start: number } | null {
  if (scrollWidth <= clientWidth + 1 || clientWidth <= 0) return null;
  const size = Math.max(minFraction, clientWidth / scrollWidth);
  const travel = scrollWidth - clientWidth;
  return { size, start: (Math.min(travel, Math.max(0, scrollLeft)) / travel) * (1 - size) };
}

/**
 * The timeline's horizontal scrollbar, in its own strip between the lanes and the add bar, so it never
 * covers the last track (the native one floats over content on overlay-scrollbar systems).
 * Drag the thumb, click the track to page, or keep using the wheel and trackpad on the lanes.
 */
export function HScrollBar({ scroller }: { scroller: RefObject<HTMLDivElement> }) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    const bar = track.current;
    if (!el || !bar) return;
    const update = () => {
      const g = thumbGeometry(el.scrollLeft, el.clientWidth, el.scrollWidth);
      bar.toggleAttribute("data-idle", g === null);
      if (g && thumb.current) {
        thumb.current.style.left = `${g.start * 100}%`;
        thumb.current.style.width = `${g.size * 100}%`;
      }
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scroller]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    const bar = track.current;
    if (!el || !bar || e.button !== 0) return;
    e.preventDefault();
    const rect = bar.getBoundingClientRect();
    const g = thumbGeometry(el.scrollLeft, el.clientWidth, el.scrollWidth);
    if (!g) return;
    const travel = el.scrollWidth - el.clientWidth;
    const onThumb = e.target === thumb.current;
    if (!onThumb) {
      // Paging toward the click, like a native track.
      const at = (e.clientX - rect.left) / rect.width;
      el.scrollBy({ left: (at < g.start ? -1 : 1) * el.clientWidth * 0.9, behavior: "smooth" });
      return;
    }
    const x0 = e.clientX;
    const left0 = el.scrollLeft;
    const pxPerScroll = (rect.width * (1 - g.size)) / travel;
    bar.setPointerCapture(e.pointerId);
    bar.dataset.drag = "";
    const move = (ev: PointerEvent) => {
      el.scrollLeft = left0 + (ev.clientX - x0) / pxPerScroll;
    };
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
      delete bar.dataset.drag;
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  };

  return (
    <div className="arr-hbar" ref={track} onPointerDown={onPointerDown} aria-hidden="true">
      <div className="arr-hbar-thumb" ref={thumb} />
    </div>
  );
}

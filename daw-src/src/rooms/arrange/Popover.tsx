import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 12;
const EDGE = 10;
const ITEMS = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])';

interface Place {
  left: number;
  top: number;
  maxH: number;
  up: boolean;
  arrowX: number;
  origin: string;
}

/**
 * The one popover for Arrange: frosted glass, anchored to its trigger with a pointer, opening on whichever side has room
 * and never over the trigger. Arrow keys, Home/End and type-ahead move between items; Esc and Tab close and hand focus back.
 */
export function PopMenu({ anchor, onClose, children, label, wide }: { anchor: DOMRect; onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    const body = scroll.current;
    if (!el || !body) return;
    const natural = body.scrollHeight + 12;
    const w = el.offsetWidth;
    const below = window.innerHeight - anchor.bottom - GAP - EDGE;
    const above = anchor.top - GAP - EDGE;
    const up = natural > below && above > below;
    const room = up ? above : below;
    const h = Math.min(natural, room);
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - w - EDGE));
    setPlace({
      left,
      top: up ? anchor.top - GAP - h : anchor.bottom + GAP,
      maxH: room,
      up,
      arrowX: Math.max(22, Math.min(anchor.left + anchor.width / 2 - left, w - 22)),
      origin: `${Math.round(anchor.left + anchor.width / 2 - left)}px ${up ? "100%" : "0"}`,
    });
  }, [anchor]);

  const measureEdges = (): void => {
    const b = scroll.current;
    if (!b) return;
    setEdges({ top: b.scrollTop > 2, bottom: b.scrollTop + b.clientHeight < b.scrollHeight - 2 });
  };
  useLayoutEffect(measureEdges, [place]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const items = (): HTMLElement[] => [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const away = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    let typed = "";
    let typedAt = 0;
    const key = (e: KeyboardEvent): void => {
      if (!ref.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key === "Tab") {
        closeRef.current();
        return;
      }
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const go = (i: number): void => {
        e.preventDefault();
        e.stopPropagation();
        list[(i + list.length) % list.length]?.focus();
      };
      if (e.key === "ArrowDown" || e.key === "ArrowRight") go(at + 1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(at < 0 ? -1 : at - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(list.length - 1);
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now();
        typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
        typedAt = now;
        const hit = [...list.slice(at + 1), ...list.slice(0, at + 1)].find((n) => (n.dataset.label ?? n.textContent ?? "").trim().toLowerCase().startsWith(typed));
        if (hit) {
          e.preventDefault();
          hit.focus();
        }
      }
    };
    const resize = (): void => closeRef.current();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", resize);
    // A pointer-opened menu starts on its container so no row looks pre-selected; a keyboard-opened one starts on the first row.
    const viaKeyboard = previous?.matches(":focus-visible") ?? false;
    (viaKeyboard ? items()[0] : ref.current)?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", resize);
      if (previous?.isConnected && (!document.activeElement || document.activeElement === document.body || ref.current?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, []);

  const style = {
    left: place?.left ?? 0,
    top: place?.top ?? 0,
    visibility: place ? "visible" : "hidden",
    transformOrigin: place?.origin,
    "--arrow-x": `${place?.arrowX ?? 0}px`,
    "--pm-max": `${place?.maxH ?? 600}px`,
  } as CSSProperties;

  return createPortal(
    <div ref={ref} className={`pop-menu pm${wide ? " pm-wide" : ""}`} data-up={place?.up ? "" : undefined} role="menu" aria-label={label} tabIndex={-1} style={style}>
      <div ref={scroll} className="pm-scroll" data-top={edges.top ? "" : undefined} data-bottom={edges.bottom ? "" : undefined} onScroll={measureEdges}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A tracked caption that groups rows, like the instrument hub's columns. */
export function PopGroup({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="pm-group" role="group" aria-label={caption}>
      <div className="pm-cap" aria-hidden="true">
        {caption}
      </div>
      {children}
    </div>
  );
}

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Instrument } from "../audio/types";

/** Calls `frame` on every animation frame while mounted. Use it to write meters and playheads straight to the DOM instead of React state. */
export function useRaf(frame: (now: number) => void): void {
  const ref = useRef(frame);
  ref.current = frame;
  useEffect(() => {
    let id = requestAnimationFrame(function loop(now) {
      ref.current(now);
      id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, []);
}

/** Re-renders when the instrument's parameters, presets or data change. */
export function useInstrument(instrument: Instrument): number {
  return useSyncExternalStore(
    (listener) => instrument.subscribe(listener),
    () => instrument.version,
  );
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

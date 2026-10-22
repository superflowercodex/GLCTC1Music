import { useEffect, useRef } from "react";

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

/**
 * Computer-keyboard playing, active only while the calling component is mounted and `enabled`.
 * Keys held when the component goes away are released, so nothing is left sounding or stuck.
 */
export function useComputerKeys(enabled: boolean, onDown: (key: string) => void, onUp: (key: string) => void): void {
  const down = useRef(onDown);
  const up = useRef(onUp);
  down.current = onDown;
  up.current = onUp;

  useEffect(() => {
    if (!enabled) return;
    const held = new Set<string>();
    const keyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (held.has(key)) return;
      held.add(key);
      down.current(key);
    };
    const keyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!held.delete(key)) return;
      up.current(key);
    };
    const releaseAll = () => {
      for (const key of held) up.current(key);
      held.clear();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [enabled]);
}

/** Sizes a canvas to its element at the screen's pixel density and calls `draw` again whenever it resizes. */
export function useCanvas(draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, deps: readonly unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(draw);
  latest.current = draw;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      latest.current(g, rect.width, rect.height);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, deps);
  return ref;
}

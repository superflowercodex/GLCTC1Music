import { useRef } from "react";
import { useRaf } from "./hooks";

/**
 * Level bar that writes its own height straight to the DOM every frame. Going through React
 * state would re-render sixty times a second for something that is only a style value.
 */
export function Meter({ getLevel, horizontal = false }: { getLevel: () => number; horizontal?: boolean }) {
  const fill = useRef<HTMLDivElement>(null);
  const shown = useRef(0);

  useRaf(() => {
    const target = Math.min(1, Math.sqrt(getLevel()) * 1.4);
    // Quick attack, slow fall, like a hardware meter.
    shown.current = target > shown.current ? target : shown.current * 0.9;
    const el = fill.current;
    if (el) el.style.transform = horizontal ? `scaleX(${shown.current})` : `scaleY(${shown.current})`;
  });

  return (
    <div className={`meter ${horizontal ? "h" : "v"}`}>
      <div ref={fill} className="meter-fill" />
    </div>
  );
}

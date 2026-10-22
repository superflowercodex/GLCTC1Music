import { useRef } from "react";
import { useRaf } from "../../../ui/hooks";

/**
 * A translucent column that follows the playing step. It moves by writing a CSS variable every frame,
 * so the sequencer view never re-renders for the playhead.
 */
export function PlayheadBand({ columns, gap, read }: { columns: number; gap: number; read: () => number }) {
  const band = useRef<HTMLDivElement>(null);
  const last = useRef(-2);
  useRaf(() => {
    const col = read();
    if (col === last.current || !band.current) return;
    last.current = col;
    if (col < 0) band.current.style.display = "none";
    else {
      band.current.style.display = "block";
      band.current.style.setProperty("--col", String(col));
    }
  });
  return <div ref={band} className="sy-band" aria-hidden="true" style={{ "--columns": columns, "--gap": `${gap}px`, display: "none" } as React.CSSProperties} />;
}

import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { peekEngine } from "../../audio/engine";
import { setLoop } from "../../project/actions";
import { holdHistory } from "../../project/history";
import type { Project } from "../../project/model";
import { projectStore } from "../../store/project";
import { useRaf } from "../../ui/hooks";
import { seekToBar } from "./ops";
import { arrangeSettings } from "./settings";
import { gridInBars, pxToBar, snapBar } from "./timeline";

interface RulerProps {
  bars: number;
  ppb: number;
  loop: Project["loop"];
}

function labelEvery(ppb: number): number {
  if (ppb >= 56) return 1;
  if (ppb >= 28) return 2;
  return 4;
}

export function Ruler({ bars, ppb, loop }: RulerProps) {
  const grid = useRef<HTMLDivElement>(null);

  const barAt = (clientX: number): number => {
    const rect = grid.current?.getBoundingClientRect();
    const { snap, gridBeats } = arrangeSettings.get();
    const { beatsPerBar } = projectStore.get();
    return snapBar(pxToBar(clientX - (rect?.left ?? 0), ppb), gridInBars(gridBeats, beatsPerBar), snap);
  };

  const onRulerDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.shiftKey) {
      // Shift-drag draws the loop region.
      const anchor = barAt(e.clientX);
      const release = holdHistory();
      const move = (ev: PointerEvent): void => {
        const here = barAt(ev.clientX);
        projectStore.set((p) => setLoop(p, { on: true, startBar: Math.min(anchor, here), endBar: Math.max(anchor, here) }));
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        release();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    seekToBar(barAt(e.clientX));
    const move = (ev: PointerEvent): void => seekToBar(barAt(ev.clientX));
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragHandle = (edge: "startBar" | "endBar") => (e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const release = holdHistory();
    const move = (ev: PointerEvent): void => projectStore.set((p) => setLoop(p, { [edge]: barAt(ev.clientX) }));
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      release();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const keyHandle = (edge: "startBar" | "endBar") => (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const { beatsPerBar } = projectStore.get();
    const step = gridInBars(arrangeSettings.get().gridBeats, beatsPerBar) * (e.key === "ArrowLeft" ? -1 : 1);
    projectStore.set((p) => setLoop(p, { [edge]: p.loop[edge] + step }));
  };

  const every = labelEvery(ppb);
  const labels: number[] = [];
  for (let i = 0; i < bars; i += every) labels.push(i);

  return (
    <div className="arr-ruler-grid" ref={grid} style={{ "--ppb": `${ppb}px` } as CSSProperties} onPointerDown={onRulerDown}>
      <div className={`loop-region${loop.on ? " on" : ""}`} style={{ left: (loop.startBar - 1) * ppb, width: (loop.endBar - loop.startBar) * ppb }}>
        <span
          className="loop-handle l"
          role="slider"
          tabIndex={0}
          aria-label="Loop start bar"
          aria-valuenow={loop.startBar}
          aria-valuemin={1}
          aria-valuemax={loop.endBar}
          onPointerDown={dragHandle("startBar")}
          onKeyDown={keyHandle("startBar")}
        />
        <span
          className="loop-handle r"
          role="slider"
          tabIndex={0}
          aria-label="Loop end bar"
          aria-valuenow={loop.endBar}
          aria-valuemin={loop.startBar}
          onPointerDown={dragHandle("endBar")}
          onKeyDown={keyHandle("endBar")}
        />
      </div>
      {labels.map((i) => (
        <span key={i} className="bar-label mono" style={{ left: i * ppb }}>
          {String(i + 1).padStart(2, "0")}
        </span>
      ))}
    </div>
  );
}

interface PlayheadProps {
  ppb: number;
  beatsPerBar: number;
  scroller: React.RefObject<HTMLDivElement>;
}

/** Positioned straight on the DOM every frame: going through React state would re-render the whole timeline sixty times a second. */
export function Playhead({ ppb, beatsPerBar, scroller }: PlayheadProps) {
  const el = useRef<HTMLDivElement>(null);
  const live = useRef({ ppb, beatsPerBar });
  live.current = { ppb, beatsPerBar };

  useRaf(() => {
    const node = el.current;
    if (!node) return;
    const engine = peekEngine();
    const step = engine ? engine.clock.position() : 0;
    const x = (step / (live.current.beatsPerBar * 4)) * live.current.ppb;
    node.style.transform = `translateX(${x}px)`;
    const box = scroller.current;
    if (engine?.clock.playing && box) {
      const headW = parseFloat(getComputedStyle(box).getPropertyValue("--head-w")) || 0;
      const seen = box.scrollLeft;
      if (x + headW > seen + box.clientWidth - 48 || x < seen) box.scrollLeft = Math.max(0, x - 24);
    }
  });

  return (
    <div className="playhead-rail" aria-hidden="true">
      <div className="playhead" ref={el}>
        <span className="playhead-glow" />
        <span className="playhead-dot" />
        <span className="playhead-line" />
      </div>
    </div>
  );
}

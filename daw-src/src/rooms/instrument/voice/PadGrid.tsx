import { useRef, type CSSProperties } from "react";
import { hasSample, type PadData } from "../../../audio/instruments/voice/padPlayer";
import { useRaf } from "../../../ui/hooks";

export const PAD_KEYS = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"] as const;
const PALETTE = ["#7cf0c0", "#79ebff", "#8e7cff", "#ff63d8", "#ffd36a"];
const MODE_LABEL = { loop: "Loop", shot: "Shot", gate: "Hold" } as const;

/**
 * The 4x4 pad grid. Which pads are sounding is written straight onto the buttons every frame, so
 * lighting a pad never re-renders React.
 */
export function PadGrid({
  pads,
  selected,
  palette = PALETTE,
  stateOf,
  recordingPad,
  onDown,
  onUp,
}: {
  pads: readonly PadData[];
  selected: number;
  palette?: readonly string[];
  stateOf: (index: number) => "idle" | "playing" | "queued";
  recordingPad: number | null;
  onDown: (index: number) => void;
  onUp: (index: number) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useRaf(() => {
    refs.current.forEach((button, i) => {
      if (!button) return;
      const next = stateOf(i);
      if (button.dataset.state !== next) button.dataset.state = next;
    });
  });

  return (
    <div className="pad-grid" role="group" aria-label="Pads">
      {pads.map((pad, i) => {
        const loaded = hasSample(pad);
        const color = palette[i % palette.length];
        return (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className={`pad ${i === selected ? "sel" : ""} ${loaded ? "" : "empty"}`}
            style={{ "--c": color } as CSSProperties}
            aria-label={`Pad ${i + 1} ${loaded ? pad.name : "empty"}${loaded ? `, ${MODE_LABEL[pad.mode]}` : ""}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onDown(i);
            }}
            onPointerUp={() => onUp(i)}
            onPointerCancel={() => onUp(i)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
                e.preventDefault();
                onDown(i);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === "Enter" || e.key === " ") onUp(i);
            }}
          >
            <span className="pad-key mono">{PAD_KEYS[i].toUpperCase()}</span>
            {loaded && <span className="pad-mode">{MODE_LABEL[pad.mode]}</span>}
            <span className="pad-name">{loaded ? pad.name || `Pad ${i + 1}` : "Empty"}</span>
            {recordingPad === i && <span className="pad-rec" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

import { useMemo, useRef } from "react";
import { peaks } from "../../../audio/instruments/voice/assets";
import { normaliseSlices } from "../../../audio/instruments/voice/slice";
import type { PadData } from "../../../audio/instruments/voice/padPlayer";
import { useCanvas } from "./hooks";

type Handle = { kind: "start" } | { kind: "end" } | { kind: "slice"; index: number };
const GRAB = 12;

/** Waveform of a pad with draggable trim handles and slice markers. Double-click adds a slice at that spot or removes the one clicked. */
export function Waveform({
  buffer,
  pad,
  color,
  onChange,
}: {
  buffer: AudioBuffer | undefined;
  pad: PadData;
  color: string;
  onChange: (patch: Partial<PadData>) => void;
}) {
  const bins = 220;
  const summary = useMemo(() => (buffer ? peaks(buffer, bins) : undefined), [buffer]);
  const drag = useRef<Handle | null>(null);

  const canvas = useCanvas(
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      if (!summary) return;
      const mid = h / 2;
      const peak = Math.max(0.05, ...summary);
      const reverse = pad.reverse;
      for (let i = 0; i < summary.length; i++) {
        const v = summary[reverse ? summary.length - 1 - i : i] / peak;
        const bar = Math.max(2, v * (h - 12));
        const x = (i / summary.length) * w;
        const frac = i / summary.length;
        const inside = frac >= pad.start && frac <= pad.end;
        g.fillStyle = inside ? color : "rgba(255,255,255,.18)";
        g.fillRect(x, mid - bar / 2, Math.max(1.5, w / summary.length - 1.5), bar);
      }
      g.fillStyle = "rgba(255,211,106,.1)";
      g.fillRect(pad.start * w, 0, (pad.end - pad.start) * w, h);
      g.fillStyle = "#ffd36a";
      g.fillRect(pad.start * w - 1, 0, 3, h);
      g.fillRect(pad.end * w - 2, 0, 3, h);
      g.fillStyle = "rgba(255,255,255,.6)";
      for (const s of pad.slices) g.fillRect(s * w - 1, 0, 2, h);
    },
    [summary, pad.start, pad.end, pad.slices, pad.reverse, color],
  );

  const fractionOf = (e: React.PointerEvent | React.MouseEvent): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const nearest = (e: React.PointerEvent | React.MouseEvent): Handle | null => {
    const width = e.currentTarget.getBoundingClientRect().width;
    const f = fractionOf(e);
    const candidates: { handle: Handle; at: number }[] = [
      { handle: { kind: "start" }, at: pad.start },
      { handle: { kind: "end" }, at: pad.end },
      ...pad.slices.map((at, index) => ({ handle: { kind: "slice", index } as Handle, at })),
    ];
    let best: Handle | null = null;
    let bestDist = GRAB / width;
    for (const c of candidates) {
      const dist = Math.abs(c.at - f);
      if (dist <= bestDist) {
        best = c.handle;
        bestDist = dist;
      }
    }
    return best;
  };

  const move = (e: React.PointerEvent) => {
    const handle = drag.current;
    if (!handle) return;
    const f = fractionOf(e);
    if (handle.kind === "start") onChange({ start: Math.min(f, pad.end - 0.01) });
    else if (handle.kind === "end") onChange({ end: Math.max(f, pad.start + 0.01) });
    else {
      const slices = [...pad.slices];
      slices[handle.index] = f;
      onChange({ slices: normaliseSlices(slices) });
    }
  };

  return (
    <div
      className="wave-canvas-wrap"
      role="group"
      aria-label="Waveform. Drag the gold handles to trim, double-click to add or remove a slice."
      style={{ cursor: buffer ? "ew-resize" : "default" }}
      onPointerDown={(e) => {
        if (!buffer) return;
        drag.current = nearest(e);
        if (drag.current) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={(e) => {
        if (!buffer) return;
        const hit = nearest(e);
        if (hit?.kind === "slice") onChange({ slices: pad.slices.filter((_, i) => i !== hit.index) });
        else if (!hit) onChange({ slices: normaliseSlices([...pad.slices, fractionOf(e)]) });
      }}
    >
      <canvas ref={canvas} />
      {!buffer && <div className="wave-empty">Drop a sample here or record into it</div>}
    </div>
  );
}

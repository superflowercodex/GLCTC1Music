import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Clip } from "../../../project/model";
import { clipSeconds, stepSeconds, type TimeBase } from "./clipEdits";
import { peaksForRange, type PeakIndex } from "./peaks";
import { accent } from "./shared";
import type { View } from "./WaveformView";

interface Props {
  clip: Clip;
  buffer: AudioBuffer;
  index: PeakIndex;
  ratio: number;
  time: TimeBase;
  view: View;
  /** `base` is the clip as it was when the drag began; edges are clip-local seconds on its timeline. */
  onTrim(base: Clip, fromSec: number, toSec: number): void;
}

type Edge = "start" | "end";

/** The whole file with the part that plays between two gold handles; dragging a handle trims without deleting anything. */
export function OverviewStrip({ clip, buffer, index, ratio, time, view, onTrim }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ edge: Edge; base: Clip } | null>(null);
  const [width, setWidth] = useState(0);
  const sourceSec = buffer.duration;
  const total = clipSeconds(clip, time);
  const windowSec = total * ratio;
  const s0 = clip.offsetSec;
  const s1 = s0 + windowSec;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = el.clientHeight;
    el.width = width * dpr;
    el.height = height * dpr;
    const g = el.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const peaks = peaksForRange(index, buffer, 0, buffer.length, width);
    g.fillStyle = accent(el, "99");
    const mid = height / 2;
    for (let x = 0; x < width; x++) {
      const top = Math.max(1, peaks.max[x] * mid * 0.9);
      const bottom = Math.max(1, -peaks.min[x] * mid * 0.9);
      g.fillRect(x, mid - top, 1, top + bottom);
    }
  }, [buffer, index, width]);

  const pct = (sec: number) => `${(Math.min(sourceSec, Math.max(0, sec)) / sourceSec) * 100}%`;

  const apply = (base: Clip, edge: Edge, sourceTime: number) => {
    const baseTotal = clipSeconds(base, time);
    const bs0 = base.offsetSec;
    const bs1 = bs0 + baseTotal * ratio;
    const minSource = 0.05 * ratio;
    const n0 = edge === "start" ? Math.min(Math.max(0, sourceTime), bs1 - minSource) : bs0;
    const n1 = edge === "end" ? Math.max(Math.min(sourceSec, sourceTime), bs0 + minSource) : bs1;
    // Reversed clips read the window backwards, so source start maps to the timeline's end.
    let from = base.reversed ? (bs1 - n1) / ratio : (n0 - bs0) / ratio;
    let to = base.reversed ? (bs1 - n0) / ratio : (n1 - bs0) / ratio;
    const step = stepSeconds(time);
    if (from !== 0) from = Math.round(from / step) * step;
    if (to !== baseTotal) to = Math.round(to / step) * step;
    onTrim(base, from, to);
  };

  const timeAt = (e: { clientX: number }) => {
    const rect = host.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * sourceSec;
  };

  const onDown = (edge: Edge) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { edge, base: clip };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) apply(d.base, d.edge, timeAt(e));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKey = (edge: Edge) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    apply(clip, edge, (edge === "start" ? s0 : s1) + dir * stepSeconds(time) * ratio);
  };

  const viewA = clip.reversed ? s1 - (view.start + view.span) * ratio : s0 + view.start * ratio;
  const viewB = clip.reversed ? s1 - view.start * ratio : s0 + (view.start + view.span) * ratio;
  const zoomed = view.span < total - 1e-6;

  return (
    <div ref={host} className="ce-overview" aria-label="Whole file. Only the part between the gold handles plays.">
      <canvas ref={canvas} />
      <div className="ce-dim" style={{ left: 0, width: pct(s0) }} />
      <div className="ce-dim" style={{ left: pct(s1), right: 0 }} />
      {zoomed && <div className="ce-viewbox" style={{ left: pct(viewA), width: `calc(${pct(viewB)} - ${pct(viewA)})` }} />}
      {(["start", "end"] as const).map((edge) => (
        <div
          key={edge}
          className="ce-trim"
          role="slider"
          tabIndex={0}
          aria-label={edge === "start" ? "Trim start" : "Trim end"}
          aria-valuemin={0}
          aria-valuemax={Math.round(sourceSec * 100) / 100}
          aria-valuenow={Math.round((edge === "start" ? s0 : s1) * 100) / 100}
          style={{ left: pct(edge === "start" ? s0 : s1) }}
          onPointerDown={onDown(edge)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey(edge)}
        />
      ))}
    </div>
  );
}

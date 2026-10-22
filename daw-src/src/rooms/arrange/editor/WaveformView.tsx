import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { peekEngine } from "../../../audio/engine";
import type { Clip } from "../../../project/model";
import { useRaf } from "../../../ui/hooks";
import { clipSeconds, stepSeconds, barSeconds, type TimeBase } from "./clipEdits";
import { peaksForRange, type PeakIndex } from "./peaks";
import { fadeLabel, formatSeconds } from "./shared";

export interface Range {
  a: number;
  b: number;
}

export interface View {
  start: number;
  span: number;
}

interface Props {
  clip: Clip;
  buffer: AudioBuffer;
  index: PeakIndex;
  ratio: number;
  time: TimeBase;
  view: View;
  selection: Range | null;
  onSelection(range: Range | null): void;
  onSeek(clipSec: number): void;
  onFade(side: "in" | "out", steps: number): void;
  onView(view: View): void;
}

const HANDLE_ZONE = 30;
const HANDLE_SIZE = 14;
const COLORS = { wave: "rgba(121,235,255,0.55)", waveSel: "#bff6ff", amber: "#ffd36a" };

type Drag = { kind: "select"; anchor: number; startX: number; moved: boolean } | { kind: "fade"; side: "in" | "out" };

/** Audio-time <-> pixel mapping shared by drawing and pointer handling. */
function mapper(view: View, width: number) {
  return {
    toX: (t: number) => ((t - view.start) / view.span) * width,
    toT: (x: number) => view.start + (x / width) * view.span,
  };
}

export function WaveformView({ clip, buffer, index, ratio, time, view, selection, onSelection, onSeek, onFade, onView }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const total = clipSeconds(clip, time);
  const stepSec = stepSeconds(time);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.floor(el.clientWidth), h: Math.floor(el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = size.w * dpr;
    el.height = size.h * dpr;
    const g = el.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const { toX } = mapper(view, size.w);
    const mid = size.h / 2;

    // Beat lines first so the waveform sits on top of them.
    const beatSec = 60 / time.bpm;
    g.fillStyle = "rgba(255,255,255,0.06)";
    for (let t = Math.ceil(view.start / beatSec) * beatSec; t < view.start + view.span; t += beatSec) g.fillRect(Math.round(toX(t)), 0, 1, size.h);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(0, Math.round(mid), size.w, 1);

    // Which part of the file the visible time range covers; a reversed clip reads it backwards.
    const windowSec = total * ratio;
    const toSource = (t: number) => (clip.reversed ? clip.offsetSec + windowSec - t * ratio : clip.offsetSec + t * ratio);
    const s0 = toSource(view.start);
    const s1 = toSource(view.start + view.span);
    const lo = Math.min(s0, s1) * buffer.sampleRate;
    const hi = Math.max(s0, s1) * buffer.sampleRate;
    const peaks = peaksForRange(index, buffer, lo, hi, size.w);
    const selA = selection ? Math.floor(toX(selection.a)) : 0;
    const selB = selection ? Math.ceil(toX(selection.b)) : -1;
    const amp = (size.h / 2) * 0.92;
    for (let x = 0; x < size.w; x++) {
      const bin = clip.reversed ? size.w - 1 - x : x;
      const top = Math.max(1, peaks.max[bin] * amp);
      const bottom = Math.max(1, -peaks.min[bin] * amp);
      g.fillStyle = x >= selA && x <= selB ? COLORS.waveSel : COLORS.wave;
      g.fillRect(x, mid - top, 1, top + bottom);
    }

    // Fade ramps darken the part that is quieter than the clip's full level.
    const fadeInSec = clip.fadeInSteps * stepSec;
    const fadeOutSec = clip.fadeOutSteps * stepSec;
    g.fillStyle = "rgba(7,11,28,0.72)";
    if (fadeInSec > 0) {
      const x0 = toX(0);
      const x1 = toX(fadeInSec);
      g.beginPath();
      g.moveTo(x0, 0);
      g.lineTo(x1, 0);
      g.lineTo(x0, size.h);
      g.closePath();
      g.fill();
    }
    if (fadeOutSec > 0) {
      const x0 = toX(total - fadeOutSec);
      const x1 = toX(total);
      g.beginPath();
      g.moveTo(x1, 0);
      g.lineTo(x0, 0);
      g.lineTo(x1, size.h);
      g.closePath();
      g.fill();
    }

    g.fillStyle = COLORS.amber;
    for (const [side, t] of [["in", fadeInSec], ["out", total - fadeOutSec]] as const) {
      const x = toX(t);
      if (x < -HANDLE_SIZE || x > size.w + HANDLE_SIZE) continue;
      const left = Math.min(size.w - HANDLE_SIZE, Math.max(0, side === "in" ? x : x - HANDLE_SIZE));
      g.fillRect(left, 6, HANDLE_SIZE, HANDLE_SIZE);
    }

    if (selection) {
      g.fillStyle = "rgba(121,235,255,0.14)";
      g.fillRect(selA, 0, selB - selA, size.h);
      g.fillStyle = "#79ebff";
      g.fillRect(selA, 0, 2, size.h);
      g.fillRect(selB - 2, 0, 2, size.h);
    }
  }, [buffer, index, clip, ratio, size, view, selection, total, stepSec, time.bpm]);

  const live = useRef({ view, size, clip, time, total });
  live.current = { view, size, clip, time, total };

  useRaf(() => {
    const el = playhead.current;
    if (!el) return;
    const { view: v, size: s, time: tb, clip: c } = live.current;
    const engine = peekEngine();
    const pos = engine ? engine.clock.position() : 0;
    const clipStart = (c.startBar - 1) * barSeconds(tb);
    const t = pos * stepSeconds(tb) - clipStart;
    const x = ((t - v.start) / v.span) * s.w;
    const visible = engine !== undefined && t >= 0 && t <= live.current.total && x >= 0 && x <= s.w;
    el.style.display = visible ? "block" : "none";
    if (visible) el.style.transform = `translateX(${x}px)`;
  });

  const localX = useCallback((e: { clientX: number }) => {
    const rect = host.current!.getBoundingClientRect();
    return Math.min(rect.width, Math.max(0, e.clientX - rect.left));
  }, []);

  const clampT = useCallback((t: number) => Math.min(total, Math.max(0, t)), [total]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || size.w === 0) return;
    const x = localX(e);
    const y = e.clientY - host.current!.getBoundingClientRect().top;
    const { toX, toT } = mapper(view, size.w);
    host.current!.setPointerCapture(e.pointerId);
    if (y < HANDLE_ZONE) {
      const inX = toX(clip.fadeInSteps * stepSec);
      const outX = toX(total - clip.fadeOutSteps * stepSec);
      const nearIn = Math.abs(x - inX) < 20;
      const nearOut = Math.abs(x - outX) < 20;
      if (nearIn || nearOut) {
        drag.current = { kind: "fade", side: nearIn && (!nearOut || Math.abs(x - inX) <= Math.abs(x - outX)) ? "in" : "out" };
        return;
      }
    }
    drag.current = { kind: "select", anchor: clampT(toT(x)), startX: x, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || size.w === 0) return;
    const x = localX(e);
    const t = clampT(mapper(view, size.w).toT(x));
    if (d.kind === "fade") {
      onFade(d.side, Math.round((d.side === "in" ? t : total - t) / stepSec));
      return;
    }
    if (!d.moved && Math.abs(x - d.startX) < 3) return;
    d.moved = true;
    onSelection({ a: Math.min(d.anchor, t), b: Math.max(d.anchor, t) });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (host.current?.hasPointerCapture(e.pointerId)) host.current.releasePointerCapture(e.pointerId);
    if (d?.kind === "select" && !d.moved) {
      onSelection(null);
      onSeek(d.anchor);
    }
  };

  // React attaches wheel listeners as passive, which would stop us from keeping the page still while zooming.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { view: v, size: s, total: tot } = live.current;
      if (s.w === 0) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const anchorT = v.start + ((e.clientX - rect.left) / s.w) * v.span;
        const span = Math.min(tot, Math.max(tot / 16, v.span * Math.exp(e.deltaY * 0.01)));
        const start = Math.min(tot - span, Math.max(0, anchorT - ((e.clientX - rect.left) / s.w) * span));
        onView({ start, span });
        return;
      }
      const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / s.w;
      onView({ start: Math.min(tot - v.span, Math.max(0, v.start + delta * v.span)), span: v.span });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onView]);

  const selLength = selection ? selection.b - selection.a : 0;
  return (
    <div
      ref={host}
      className="ce-wave"
      role="application"
      aria-label="Waveform. Drag to select a range, click to move the playhead, drag the gold squares to set fades."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
      <div ref={playhead} className="ce-playhead" style={{ display: "none" }} />
      {selection && selLength > 0 && <div className="ce-pill ce-pill-sel mono">Selection · {formatSeconds(selLength)}</div>}
      <div className="ce-fade-labels mono">
        <span>Fade in {fadeLabel(clip.fadeInSteps)}</span>
        <span>Fade out {fadeLabel(clip.fadeOutSteps)}</span>
      </div>
    </div>
  );
}

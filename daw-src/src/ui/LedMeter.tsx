import { useEffect, useRef } from "react";
import { useRaf } from "./hooks";
import { ballistic, DEFAULT_METER, litSegments, segmentZone, updatePeak, type MeterScale, type PeakHold, type SegmentZone } from "./kitMath";

const LIT: Record<SegmentZone, string> = { ok: "#5fe3a1", warn: "#ffc96b", hot: "#ff3f6b" };
// The hot centre of a lit LED, a little whiter than its lens colour.
const CORE: Record<SegmentZone, string> = { ok: "#b4f7d6", warn: "#ffe2b0", hot: "#ff9db4" };
// Off segments are faint glass: one neutral with a brighter top edge. Colour appears only where the signal is.
const OFF = "rgba(255,255,255,.07)";
const GLINT = "rgba(255,255,255,.08)";
const LENS = "rgba(255,255,255,.45)";

export interface LedMeterProps {
  /** Linear peak level(s), 1 = 0 dBFS. Return two values for a stereo pair of columns. Read every frame. */
  getLevel: () => number | readonly number[];
  label?: string;
  horizontal?: boolean;
  scale?: Partial<MeterScale>;
  holdMs?: number;
  /** Fit as many segments as the meter's length allows at about this many px each (overrides scale.segments). */
  segmentPx?: number;
  className?: string;
}

/**
 * Segmented light meter drawn on a canvas from requestAnimationFrame, never through React state.
 * It sizes itself to its box (set width/height in CSS) and redraws only when the picture changes.
 */
export function LedMeter({ getLevel, label = "Level", horizontal = false, scale: scaleIn, holdMs = 1200, segmentPx, className = "" }: LedMeterProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const baseScale = { ...DEFAULT_METER, ...scaleIn };
  const state = useRef<{ shown: number[]; peaks: PeakHold[]; key: string }>({ shown: [], peaks: [], key: "" });
  const size = useRef({ w: 0, h: 0, dpr: 1 });

  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const { width, height } = entry.contentRect;
      size.current = { w: width, h: height, dpr };
      el.width = Math.max(1, Math.round(width * dpr));
      el.height = Math.max(1, Math.round(height * dpr));
      state.current.key = "";
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useRaf((now) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const { w, h, dpr } = size.current;
    if (!el || !ctx || w === 0 || h === 0) return;
    const along = horizontal ? w : h;
    const across = horizontal ? h : w;
    const gap = segmentPx !== undefined && segmentPx < 4 ? 1 : 2;
    const scale = segmentPx ? { ...baseScale, segments: Math.max(6, Math.floor((along + gap) / (segmentPx + gap))) } : baseScale;
    const raw = getLevel();
    const levels = typeof raw === "number" ? [raw] : raw;
    const s = state.current;
    const lits = levels.map((lv, i) => {
      s.shown[i] = ballistic(s.shown[i] ?? 0, Number.isFinite(lv) ? lv : 0);
      const lit = litSegments(s.shown[i], scale);
      s.peaks[i] = updatePeak(s.peaks[i] ?? { segments: 0, at: now }, lit, now, holdMs);
      return lit;
    });
    const key = `${scale.segments}|${lits.join(",")}|${s.peaks.map((p) => p.segments).join(",")}`;
    if (key === s.key) return;
    s.key = key;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cols = levels.length;
    const colW = (across - 2 * (cols - 1)) / cols;
    const segL = (along - gap * (scale.segments - 1)) / scale.segments;
    const px = (v: number): number => Math.round(v * dpr) / dpr;
    const rect = (a: number, len: number, b: number): void => {
      if (horizontal) ctx.fillRect(px(a), px(b), px(a + len) - px(a), px(b + colW) - px(b));
      else ctx.fillRect(px(b), px(along - a - len), px(b + colW) - px(b), px(along - a) - px(along - a - len));
    };
    const glint = segL >= 4;
    const drawLit = (i: number, b: number, zone: SegmentZone, peak: boolean): void => {
      // Two light layers: a soft bloom that spills onto the neighbouring glass, then the segment itself with a tight halo.
      ctx.globalAlpha = peak ? 0.7 : 0.5;
      ctx.fillStyle = LIT[zone];
      ctx.shadowColor = LIT[zone];
      ctx.shadowBlur = 7;
      rect(i * (segL + gap), segL, b);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 2.5;
      ctx.fillStyle = peak ? CORE[zone] : LIT[zone];
      rect(i * (segL + gap), segL, b);
      // Each lit segment carries a hairline of white along its top edge, as light on glass does.
      ctx.shadowBlur = 0;
      ctx.fillStyle = LENS;
      const a0 = i * (segL + gap);
      if (horizontal) ctx.fillRect(px(a0), px(b), 1, px(b + colW) - px(b));
      else ctx.fillRect(px(b), px(along - a0 - segL), px(b + colW) - px(b), 1);
    };
    for (let c = 0; c < cols; c++) {
      const b = c * (colW + 2);
      ctx.shadowBlur = 0;
      for (let i = 0; i < scale.segments; i++) {
        if (i < lits[c]) continue;
        ctx.fillStyle = OFF;
        rect(i * (segL + gap), segL, b);
        if (glint) {
          ctx.fillStyle = GLINT;
          if (horizontal) ctx.fillRect(px(i * (segL + gap)), px(b), px(segL), 1);
          else ctx.fillRect(px(b), px(along - i * (segL + gap) - segL), px(b + colW) - px(b), 1);
        }
      }
      for (let i = 0; i < lits[c]; i++) drawLit(i, b, segmentZone(i, scale), false);
      // Peak hold: the held LED stays lit on its own above the column, brighter than the bar.
      const peak = s.peaks[c]?.segments ?? 0;
      if (peak > lits[c]) drawLit(peak - 1, b, segmentZone(peak - 1, scale), true);
    }
    ctx.shadowBlur = 0;
  });

  return <canvas ref={canvas} className={`led-meter ${horizontal ? "h" : "v"} ${className}`} role="img" aria-label={label} />;
}

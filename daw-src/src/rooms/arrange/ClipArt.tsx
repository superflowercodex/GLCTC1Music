import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadBuffers, showToast } from "../../audio/media";
import { getPeaks, peekPeaks, reducePeaks, subscribePeaks, type PeakData } from "../../audio/peaks";
import type { Clip } from "../../project/model";

export function usePeaks(assetId: string | undefined, assetName: string | undefined): PeakData | undefined {
  const peaks = useSyncExternalStore(
    subscribePeaks,
    () => (assetId ? peekPeaks(assetId) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (!assetId || peekPeaks(assetId)) return;
    // loadBuffers reports a missing or undecodable file to the user once; getPeaks then only runs on success.
    void loadBuffers([assetId], new Map([[assetId, assetName ?? assetId]]))
      .then((got) => (got.has(assetId) ? getPeaks(assetId) : undefined))
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : "A waveform could not be drawn."));
  }, [assetId, assetName]);
  return peaks;
}

function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setSize((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref as React.RefObject<T>, size];
}

const MAX_CANVAS_PX = 8192;

/** Small seeded generator so a pattern clip draws the same marks every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawWave(g: CanvasRenderingContext2D, w: number, h: number, peaks: PeakData, fromSec: number, toSec: number, color: string): void {
  const step = 4;
  const bins = Math.max(1, Math.floor(w / step));
  const values = reducePeaks(peaks, fromSec, toSec, bins);
  g.fillStyle = color;
  for (let i = 0; i < bins; i++) {
    const bar = Math.max(2, Math.pow(values[i], 0.7) * h);
    g.beginPath();
    g.roundRect(i * step, (h - bar) / 2, 2.5, bar, 1.5);
    g.fill();
  }
}

function drawPatternMarks(g: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number, drums: boolean, beatPx: number): void {
  const r = rng(seed);
  if (drums) {
    for (let x = 0, i = 0; x < w - 6; x += beatPx, i++) {
      const pos = i % 4;
      g.fillStyle = color;
      if (pos === 0 || pos === 2 || (pos === 3 && r() > 0.6)) {
        g.beginPath();
        g.roundRect(x, h * 0.55, 8, h * 0.4, 4);
        g.fill();
      }
      if (pos === 1 || pos === 3) {
        g.fillStyle = `${color}cc`;
        g.beginPath();
        g.roundRect(x, h * 0.1, 8, h * 0.25, 4);
        g.fill();
      }
      g.fillStyle = `${color}88`;
      g.beginPath();
      g.arc(x + beatPx / 2, h * 0.47, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  g.fillStyle = color;
  const rows = 7;
  const rowH = Math.max(3, h / rows - 2);
  for (let x = 0; x < w - 10;) {
    const len = [10, 16, 22, 34][Math.floor(r() * 4)];
    const row = Math.floor(r() * rows);
    g.beginPath();
    g.roundRect(x, row * (h / rows), len, rowH, 3);
    g.fill();
    x += len + [4, 8, 14][Math.floor(r() * 3)];
  }
}

function drawNotes(g: CanvasRenderingContext2D, w: number, h: number, clip: Clip, stepsTotal: number, color: string): void {
  const notes = clip.notes ?? [];
  if (notes.length === 0) return;
  const lo = Math.min(...notes.map((n) => n.pitch));
  const hi = Math.max(...notes.map((n) => n.pitch));
  const span = Math.max(6, hi - lo + 1);
  const rowH = Math.min(8, h / span);
  g.fillStyle = color;
  for (const n of notes) {
    const x = (n.startStep / stepsTotal) * w;
    const y = ((hi - n.pitch + (span - (hi - lo + 1)) / 2) / span) * h;
    g.beginPath();
    g.roundRect(x, y, Math.max(3, (n.lengthSteps / stepsTotal) * w), Math.max(3, rowH - 1), 2);
    g.fill();
  }
}

export interface ClipArtProps {
  clip: Clip;
  /** Source speed relative to normal and the length of a bar, both from the project, so the waveform shows what plays. */
  rate: number;
  barSec: number;
  beatsPerBar: number;
  color: string;
  drums: boolean;
  /** CSS pixels per beat, so drum marks line up with the beat grid. */
  pxPerBeat: number;
  assetName: string | undefined;
}

export function ClipArt({ clip, rate, barSec, beatsPerBar, color, drums, pxPerBeat, assetName }: ClipArtProps) {
  const [ref, size] = useElementSize<HTMLCanvasElement>();
  const peaks = usePeaks(clip.kind === "audio" ? clip.assetId : undefined, assetName);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.min(size.w, MAX_CANVAS_PX);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.scale((cssW / size.w) * dpr, dpr);
    g.clearRect(0, 0, size.w, size.h);
    if (clip.kind === "audio" && peaks) {
      drawWave(g, size.w, size.h, peaks, clip.offsetSec, clip.offsetSec + clip.lengthBars * barSec * rate, color);
    } else if (clip.kind === "pattern") {
      drawPatternMarks(g, size.w, size.h, color, (clip.patternIndex ?? 0) * 977 + 13, drums, pxPerBeat);
    } else if (clip.kind === "midi") {
      drawNotes(g, size.w, size.h, clip, clip.lengthBars * beatsPerBar * 4, color);
    }
  }, [ref, size, peaks, clip, color, drums, pxPerBeat, barSec, rate, beatsPerBar]);

  return <canvas ref={ref} className="clip-art" aria-hidden="true" />;
}

import type { InstrumentState } from "../../audio/types";
import { drumStepCount } from "./patternEdit";

export interface PatternPreview {
  /** Steps in one pass of the pattern; 16 are one bar. */
  steps: number;
  hits: ReadonlyArray<{ step: number; row: number }>;
  /** Rows to spread the hits over: voices for drums, the pitch span for melodic patterns. */
  rows: number;
}

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw | null => (typeof v === "object" && v !== null ? (v as Raw) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** What a pattern clip really plays, read from the instrument's saved state, so the clip shows its own notes. */
export function patternPreview(state: InstrumentState | undefined, index: number): PatternPreview | null {
  if (!state) return null;
  const data = rec(state.data);
  const pitched: Array<{ step: number; pitch: number }> = [];
  let steps = 16;
  if (state.kind === "lead0010110") {
    // One pattern of scale degrees; drawn by degree, which keeps the contour.
    if (index !== 0) return null;
    list(data?.steps).forEach((d, step) => typeof d === "number" && d > 0 && pitched.push({ step, pitch: d }));
    return pitchedPreview(pitched, 16);
  }
  const pattern = list(data?.patterns)[index];
  if (pattern === undefined) return null;
  const hits: Array<{ step: number; row: number }> = [];
  if (state.kind === "drum80la8" || state.kind === "divine09" || state.kind === "pad64") {
    const voices = list(pattern);
    const len = drumStepCount(state);
    voices.forEach((row, v) => list(row).forEach((x, step) => step < len && typeof x === "number" && x > 0 && hits.push({ step, row: v })));
    return hits.length ? { steps: len, hits, rows: Math.max(8, voices.length) } : null;
  }
  if (state.kind === "acid30lee") {
    list(pattern).forEach((s, step) => rec(s)?.on === true && pitched.push({ step, pitch: Number(rec(s)?.note) || 0 }));
  } else if (state.kind === "galacticOne") {
    const pat = rec(pattern);
    steps = Math.max(1, Number(pat?.len) || 16);
    list(pat?.steps).forEach((s, step) => rec(s)?.on === true && step < steps && pitched.push({ step, pitch: Number(rec(s)?.n) || 0 }));
  } else return null;
  return pitchedPreview(pitched, steps);
}

function pitchedPreview(pitched: ReadonlyArray<{ step: number; pitch: number }>, steps: number): PatternPreview | null {
  if (!pitched.length) return null;
  const lo = Math.min(...pitched.map((h) => h.pitch));
  const hi = Math.max(...pitched.map((h) => h.pitch));
  const rows = Math.max(6, hi - lo + 1);
  return { steps, hits: pitched.map((h) => ({ step: h.step, row: hi - h.pitch })), rows };
}

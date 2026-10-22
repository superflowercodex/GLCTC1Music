/** Slice points as fractions (0 to 1) of the sample, strictly increasing and never at the very ends. */
export function normaliseSlices(points: readonly number[], minGap = 0.005): number[] {
  const sorted = [...points].filter((p) => Number.isFinite(p) && p > minGap && p < 1 - minGap).sort((a, b) => a - b);
  const out: number[] = [];
  for (const p of sorted) if (out.length === 0 || p - out[out.length - 1] >= minGap) out.push(p);
  return out;
}

export function evenSlices(count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

/**
 * Finds hits by looking for sudden rises in short-window energy. Falls back to even slices when the
 * material has no clear transients (pads, drones), so Auto-slice always gives the user something.
 */
export function autoSlice(data: Float32Array, maxSlices = 8): number[] {
  const windows = 256;
  const win = Math.max(1, Math.floor(data.length / windows));
  const energy = new Float32Array(windows);
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const end = Math.min(data.length, (w + 1) * win);
    for (let i = w * win; i < end; i++) sum += data[i] * data[i];
    energy[w] = sum / win;
  }
  const hits: { at: number; rise: number }[] = [];
  for (let w = 2; w < windows - 1; w++) {
    const before = (energy[w - 1] + energy[w - 2]) / 2 + 1e-9;
    const rise = energy[w] / before;
    if (rise > 4 && energy[w] > 1e-4) hits.push({ at: w / windows, rise });
  }
  const strongest = hits.sort((a, b) => b.rise - a.rise).slice(0, Math.max(0, maxSlices - 1));
  const found = normaliseSlices(strongest.map((h) => h.at), 0.03);
  return found.length >= 2 ? found : evenSlices(Math.min(maxSlices, 4));
}

/** Start and end fractions of slice `index`, given the cut points. */
export function sliceRange(slices: readonly number[], index: number): [number, number] {
  const edges = [0, ...slices, 1];
  const i = Math.min(Math.max(0, index), edges.length - 2);
  return [edges[i], edges[i + 1]];
}

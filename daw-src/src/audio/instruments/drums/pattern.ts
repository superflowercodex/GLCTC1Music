/** A row of step values: 0 is off, anything above is a hit (meaning depends on the instrument). */
export type Row = number[];

/** Spreads `hits` as evenly as possible over `length` steps, always starting on step 0. */
export function euclid(length: number, hits: number): boolean[] {
  const h = Math.max(0, Math.min(length, Math.round(hits)));
  const out: boolean[] = [];
  for (let i = 0; i < length; i++) out.push(h > 0 && Math.floor((i * h) / length) !== Math.floor(((i - 1) * h) / length));
  return out;
}

/** Moves every hit `by` steps later, wrapping inside the first `length` steps; later steps are untouched. */
export function rotateRow(row: Row, by: number, length: number): Row {
  const out = row.slice();
  for (let i = 0; i < length; i++) out[(((i + by) % length) + length) % length] = row[i];
  return out;
}

export function reverseRow(row: Row, length: number): Row {
  const out = row.slice();
  for (let i = 0; i < length; i++) out[i] = row[length - 1 - i];
  return out;
}

/** Plays the pattern at half speed: each step is stretched over two, working one 16-step page at a time. */
export function halfTime(row: Row, length: number): Row {
  const out = row.slice();
  for (let start = 0; start < length; start += 16) {
    for (let i = 0; i < 16 && start + i < length; i++) out[start + i] = row[start + Math.floor(i / 2)] ?? 0;
  }
  return out;
}

/** Plays the pattern at double speed: every other step is kept and the page repeats. */
export function doubleTime(row: Row, length: number): Row {
  const out = row.slice();
  for (let start = 0; start < length; start += 16) {
    for (let i = 0; i < 16 && start + i < length; i++) out[start + i] = row[start + ((i * 2) % 16)] ?? 0;
  }
  return out;
}

export function swingDelay(step: number, swing: number, stepDur: number): number {
  return step % 2 === 1 ? swing * stepDur : 0;
}

/** Parses "x...X...o..." strings: x is a normal hit, X a loud one, o a ghost note. */
export function parseRow(text: string, normal = 0.84, loud = 1, ghost = 0.5): Row {
  return [...text.replace(/\s/g, "")].map((c) => (c === "x" ? normal : c === "X" ? loud : c === "o" ? ghost : 0));
}

export function clampIndex(value: unknown, count: number, fallback = 0): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(0, Math.min(count - 1, n));
}

export type RowTool = "euclid" | "half" | "double" | "reverse" | "left" | "right" | "clear";

/** One editing tool applied to a single voice's row over its first `length` steps. */
export function applyRowTool(tool: RowTool, row: Row, length: number, hits: number, on: number): Row {
  switch (tool) {
    case "euclid": {
      const out = row.slice();
      euclid(length, hits).forEach((hit, i) => (out[i] = hit ? on : 0));
      return out;
    }
    case "half":
      return halfTime(row, length);
    case "double":
      return doubleTime(row, length);
    case "reverse":
      return reverseRow(row, length);
    case "left":
      return rotateRow(row, -1, length);
    case "right":
      return rotateRow(row, 1, length);
    case "clear": {
      const out = row.slice();
      for (let i = 0; i < length; i++) out[i] = 0;
      return out;
    }
  }
}

export function randomRow(row: Row, length: number, density: number, rnd: () => number, value: () => number): Row {
  const out = row.slice();
  for (let i = 0; i < length; i++) out[i] = rnd() < density ? value() : 0;
  return out;
}

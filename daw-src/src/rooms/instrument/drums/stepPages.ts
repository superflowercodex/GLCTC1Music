export interface StepPage {
  /** First step on the page (0-based). */
  from: number;
  /** One past the last step. */
  to: number;
}

export class StepPageError extends Error {}

/** Splits a step grid into pages of `size` steps; a grid that already fits is one page. */
export function stepPages(cols: number, size: number): StepPage[] {
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(size) || size < 1) throw new StepPageError(`Cannot page ${cols} steps by ${size}`);
  const pages: StepPage[] = [];
  for (let from = 0; from < cols; from += size) pages.push({ from, to: Math.min(cols, from + size) });
  return pages;
}

export interface Hit {
  time: number;
  dur: number;
}

export const MAX_RATCHET = 8;

/** Splits one event of `period` seconds into `count` equal hits; `gate` is the fraction of each slot that sounds. */
export function ratchetHits(time: number, period: number, count: number, gate: number): Hit[] {
  const n = Math.max(1, Math.min(MAX_RATCHET, Math.round(count)));
  const slot = period / n;
  const g = Math.max(0.05, Math.min(1.05, gate));
  return Array.from({ length: n }, (_, k) => ({ time: time + k * slot, dur: Math.max(0.012, slot * g) }));
}

/**
 * Grid events falling inside one 16th step. `periodSteps` is the event length in 16ths (0.5 for 1/32, 4/3 for 1/8T);
 * events sit on multiples of the period counted from step 0, so every instrument and every restart agree on the grid.
 */
export function gridEvents(step: number, periodSteps: number): { index: number; offset: number }[] {
  const out: { index: number; offset: number }[] = [];
  let k = Math.ceil(step / periodSteps - 1e-9);
  while (k * periodSteps < step + 1 - 1e-9) {
    out.push({ index: k, offset: Math.max(0, k * periodSteps - step) });
    k += 1;
  }
  return out;
}

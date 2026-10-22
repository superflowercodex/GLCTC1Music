export type Rng = () => number;

/** Small fast PRNG for noise buffers and impulse responses, so a live render and an offline bounce are identical. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stateless random number in [0, 1) for (seed, a, b). Sequencers key it by the absolute step, so
 * probability and arp choices come out the same whether playback starts at bar 1 or bar 9, live or bounced.
 */
export function hashRandom(seed: number, a: number, b = 0): number {
  let h = (seed ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function freshSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

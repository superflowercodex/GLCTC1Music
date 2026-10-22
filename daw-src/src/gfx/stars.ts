export interface Star {
  x: number;
  y: number;
  /** Radius in CSS px. */
  r: number;
  alpha: number;
  /** Slight colour temperature: <0 cool blue-white, >0 warm. */
  warmth: number;
}

/** Deterministic PRNG so the sky is the same on every load and every resize. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** About one star per 2,600 CSS px²: a fine field that reads as depth, never as glitter. */
export const STAR_AREA = 2600;

export function starField(width: number, height: number, seed = 0x91c7c1, area = STAR_AREA): Star[] {
  const rand = mulberry32(seed);
  const count = Math.max(0, Math.round((width * height) / area));
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    // Most stars are faint dust; one in forty is a brighter point.
    const bright = rand() < 0.025;
    const k = rand();
    stars.push({
      x: rand() * width,
      y: rand() * height,
      r: bright ? 0.9 + k * 0.5 : 0.35 + k * k * 0.5,
      alpha: bright ? 0.65 + rand() * 0.3 : 0.14 + rand() * 0.4,
      warmth: rand() * 2 - 1,
    });
  }
  return stars;
}

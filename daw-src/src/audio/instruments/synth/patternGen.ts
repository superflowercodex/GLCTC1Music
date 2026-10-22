import { hashRandom } from "./rng";
import { SCALE_INTERVALS, scaleNote, scaleNotesInRange, snapToScale } from "./scales";

export interface GStep {
  on: boolean;
  /** Semitones above the pattern root. */
  n: number;
  /** Velocity 0..1. */
  v: number;
  /** Gate length as a fraction of the step; 1 and above ties into the next step. */
  g: number;
  /** Chance the step plays, 0..1. */
  p: number;
  /** Ratchet: hits within the step. */
  r: number;
  /** Per-step filter jump, -1..1. */
  c: number;
  accent: boolean;
  slide: boolean;
}

export interface GPattern {
  len: number;
  steps: GStep[];
}

export const PATTERN_LENGTHS = [4, 8, 16, 32] as const;
export const MAX_STEPS = 32;

export const emptyStep = (): GStep => ({ on: false, n: 0, v: 0.8, g: 0.6, p: 1, r: 1, c: 0, accent: false, slide: false });
export const emptyPattern = (): GPattern => ({ len: 16, steps: Array.from({ length: MAX_STEPS }, emptyStep) });

export type Rand = () => number;

/** A rand() that always returns the same sequence for one seed, so generated patterns are reproducible when asked to be. */
export function seededRand(seed: number): Rand {
  let i = 0;
  return () => hashRandom(seed, i++, 5);
}

const pick = <T>(list: readonly T[], rand: Rand): T => list[Math.floor(rand() * list.length) % list.length];
const range = (rand: Rand, a: number, b: number) => a + rand() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Semitone offsets from the root that belong to the scale, covering about three octaves. */
export function scaleOffsets(scale: number, low = -12, high = 24): number[] {
  return scaleNotesInRange(0, scale, low, high);
}

type Generator = (pattern: GPattern, scale: number, rand: Rand) => void;

function reset(pattern: GPattern, fill: (step: GStep, i: number) => void): void {
  pattern.steps.forEach((step, i) => {
    Object.assign(step, emptyStep());
    if (i < pattern.len) fill(step, i);
  });
}

export const GENERATORS: Record<string, Generator> = {
  random: (p, scale, rand) => {
    const pool = scaleOffsets(scale).filter((x) => x >= -5 && x <= 19);
    reset(p, (s, i) => {
      s.on = rand() < (i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.65 : 0.45);
      s.n = pick(pool, rand);
      s.v = range(rand, 0.5, 1);
      s.g = range(rand, 0.3, 0.9);
      s.accent = rand() < 0.2;
      s.slide = rand() < 0.15;
      s.r = rand() < 0.08 ? 2 : 1;
      s.p = rand() < 0.15 ? 0.6 : 1;
    });
  },
  acid: (p, scale, rand) => {
    const pool = scaleOffsets(scale).filter((x) => x >= -12 && x <= 12);
    reset(p, (s) => {
      s.on = rand() < 0.78;
      s.n = rand() < 0.4 ? 0 : pick(pool, rand);
      s.accent = rand() < 0.3;
      s.slide = rand() < 0.28;
      s.g = s.slide ? 0.95 : 0.45;
      s.v = s.accent ? 1 : 0.7;
      s.c = s.accent ? 0.5 : 0;
    });
  },
  arp: (p, scale) => {
    const table = SCALE_INTERVALS[scale];
    const chord = [table[0], table[2 % table.length], table[4 % table.length], table[0] + 12, table[4 % table.length], table[2 % table.length]];
    reset(p, (s, i) => {
      s.on = true;
      s.n = chord[i % chord.length];
      s.g = 0.55;
      s.v = i % 4 === 0 ? 1 : 0.7;
      s.accent = i % 8 === 0;
    });
  },
  bounce: (p) =>
    reset(p, (s, i) => {
      s.on = true;
      s.n = i % 2 ? 12 : 0;
      s.g = 0.4;
      s.v = i % 4 === 0 ? 1 : 0.65;
    }),
  trance: (p, scale) => {
    const table = SCALE_INTERVALS[scale];
    const notes = [0, table[4 % table.length], 12, table[4 % table.length]];
    reset(p, (s, i) => {
      s.on = i % 2 === 0 || i % 8 === 7;
      s.n = notes[(i >> 1) % 4];
      s.g = 0.5;
      s.v = 0.8;
      s.accent = i % 8 === 0;
    });
  },
  clear: (p) => reset(p, () => undefined),
};

/** Evenly spread `hits` over the pattern length (Bjorklund-style), rotated by `rotation`. */
export function euclid(length: number, hits: number, rotation = 0): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < length; i++) {
    const j = (((i - rotation) % length) + length) % length;
    out.push((j * hits) % length < hits);
  }
  return out;
}

export function applyEuclid(pattern: GPattern, scale: number, hits: number, rotation: number, rand: Rand): void {
  const pool = scaleOffsets(scale).filter((x) => x >= -5 && x <= 14);
  const rhythm = euclid(pattern.len, Math.max(1, Math.min(pattern.len, hits)), rotation);
  reset(pattern, (s, i) => {
    s.on = rhythm[i];
    s.n = s.on ? pick(pool, rand) : 0;
    s.g = 0.55;
    s.v = range(rand, 0.6, 1);
  });
}

/** Changes a quarter of the steps a little: toggles, new notes, new dynamics. */
export function mutate(pattern: GPattern, scale: number, rand: Rand, count = Math.max(1, Math.round(pattern.len / 4))): void {
  const pool = scaleOffsets(scale).filter((x) => x >= -7 && x <= 19);
  for (let k = 0; k < count; k++) {
    const s = pattern.steps[Math.floor(rand() * pattern.len)];
    const r = rand();
    if (r < 0.35) s.on = !s.on;
    else if (r < 0.7) {
      s.n = pick(pool, rand);
      if (!s.on && rand() < 0.4) s.on = true;
    } else {
      s.v = clamp(s.v + range(rand, -0.2, 0.2), 0.2, 1);
      s.g = clamp(s.g + range(rand, -0.15, 0.15), 0.1, 1);
    }
  }
}

export function shiftPattern(pattern: GPattern, by: number): void {
  const copy = pattern.steps.slice(0, pattern.len).map((s) => ({ ...s }));
  for (let i = 0; i < pattern.len; i++) pattern.steps[(((i + by) % pattern.len) + pattern.len) % pattern.len] = copy[i];
}

export function reversePattern(pattern: GPattern): void {
  const copy = pattern.steps.slice(0, pattern.len).map((s) => ({ ...s }));
  for (let i = 0; i < pattern.len; i++) pattern.steps[i] = copy[pattern.len - 1 - i];
}

export function quantizePattern(pattern: GPattern, rootPitchClass: number, scale: number): void {
  for (const s of pattern.steps) s.n = snapToScale(s.n + rootPitchClass, rootPitchClass, scale) - rootPitchClass;
}

export function humanizePattern(pattern: GPattern, rand: Rand): void {
  for (const s of pattern.steps) s.v = clamp(s.v + range(rand, -0.12, 0.12), 0.2, 1);
}

/** Row (0 at the root) a note sits on in an 8-row scale grid; off-scale notes land on the nearest row. */
export function degreeOfOffset(offset: number, scale: number, rows = 8): number {
  let best = 0;
  let distance = Infinity;
  for (let d = 0; d < rows; d++) {
    const dist = Math.abs(scaleNote(0, scale, d) - offset);
    if (dist < distance) {
      distance = dist;
      best = d;
    }
  }
  return best;
}

export const offsetOfDegree = (degree: number, scale: number): number => scaleNote(0, scale, degree);

export interface Resolved {
  bank: number;
  pos: number;
  /** True on the last event of a pass through the pattern. */
  lastOfPass: boolean;
  /** Event index within the current pass. */
  within: number;
}

export interface Timeline {
  patterns: readonly GPattern[];
  active: number;
  chain: readonly number[];
  chainOn: boolean;
  direction: number;
  seed: number;
}

function directed(i: number, len: number, direction: number, seed: number, key: number, drunk: DrunkWalk): number {
  if (len < 2) return 0;
  switch (direction) {
    case 1:
      return len - 1 - (i % len);
    case 2: {
      const cycle = 2 * len - 2;
      const k = i % cycle;
      return k < len ? k : cycle - k;
    }
    case 3:
      return Math.floor(hashRandom(seed, key, 7) * len);
    case 4:
      return drunk.at(i, len, seed);
    default:
      return i % len;
  }
}

/** Random walk that remembers where it was, so playing forward costs one step; jumping back replays from the start. */
export class DrunkWalk {
  private index = -1;
  private pos = 0;
  private lengthSeen = 0;

  at(i: number, len: number, seed: number): number {
    if (len !== this.lengthSeen || i < this.index || this.index < 0) {
      this.index = -1;
      this.pos = 0;
      this.lengthSeen = len;
    }
    while (this.index < i) {
      this.index += 1;
      if (this.index > 0) {
        const r = hashRandom(seed, this.index, 9);
        const delta = (r < 0.5 ? -1 : 1) * (hashRandom(seed, this.index, 10) < 0.3 ? 2 : 1);
        this.pos = (((this.pos + delta) % len) + len) % len;
      }
    }
    return this.pos;
  }
}

/**
 * Which bank and step the n-th sequencer event plays. Pure in n, so a bounce started at event 0 and live
 * playback started anywhere land on the same notes.
 */
export function resolveEvent(n: number, t: Timeline, drunk: DrunkWalk): Resolved {
  const chain = t.chainOn && t.chain.length > 0 ? t.chain : null;
  if (!chain) {
    const bank = t.active;
    const len = t.patterns[bank].len;
    const within = n % len;
    return { bank, pos: directed(n, len, t.direction, t.seed, n, drunk), lastOfPass: within === len - 1, within };
  }
  const lengths = chain.map((b) => t.patterns[b].len);
  const total = lengths.reduce((a, b) => a + b, 0);
  let m = n % total;
  let slot = 0;
  while (m >= lengths[slot]) {
    m -= lengths[slot];
    slot += 1;
  }
  const bank = chain[slot];
  const len = lengths[slot];
  return { bank, pos: directed(m, len, t.direction, t.seed, n, drunk), lastOfPass: m === len - 1, within: m };
}

export function resolveLayer(n: number, bank: number, t: Timeline, drunk: DrunkWalk): number {
  return directed(n, t.patterns[bank].len, t.direction, t.seed, n + 100003, drunk);
}

function demoPattern(): GPattern {
  const p = emptyPattern();
  const notes = [0, 0, 12, 0, 3, 0, 7, 0, 12, 0, 10, 0, 7, 0, 3, 5];
  const on = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0];
  const vel = [1, 0.6, 0.8, 0.7, 0.95, 0.5, 0.8, 0.6, 1, 0.5, 0.85, 0.6, 0.9, 0.7, 0.8, 0.5];
  p.steps.forEach((s, i) => {
    const k = i % 16;
    s.n = notes[k];
    s.on = on[k] === 1;
    s.v = vel[k];
    s.accent = k % 4 === 0;
    s.g = k % 2 ? 0.45 : 0.7;
  });
  return p;
}

export function defaultPatterns(scale: number): GPattern[] {
  const banks = Array.from({ length: 8 }, emptyPattern);
  banks[0] = demoPattern();
  applyEuclid(banks[1], scale, 5, 0, seededRand(1));
  GENERATORS.acid(banks[2], scale, seededRand(2));
  GENERATORS.arp(banks[3], scale, seededRand(3));
  GENERATORS.bounce(banks[4], scale, seededRand(4));
  GENERATORS.trance(banks[5], scale, seededRand(5));
  return banks;
}

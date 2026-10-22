export type ArpMode = "up" | "down" | "updown" | "downup" | "random" | "played" | "chord" | "converge";

export const ARP_MODES: readonly { id: ArpMode; label: string }[] = [
  { id: "up", label: "Up" },
  { id: "down", label: "Down" },
  { id: "updown", label: "Up and down" },
  { id: "downup", label: "Down and up" },
  { id: "random", label: "Random" },
  { id: "chord", label: "Chord" },
  { id: "played", label: "As played" },
  { id: "converge", label: "Converge" },
];

export interface HeldNote {
  midi: number;
  /** Increases with press time, so "as played" can keep the player's order. */
  order: number;
}

export const MAX_CHORD_NOTES = 6;

/** The notes an arpeggiator walks through: held notes in pitch order (or press order), stacked over octaves. */
export function arpPool(held: readonly HeldNote[], mode: ArpMode, octaves: number): number[] {
  if (held.length === 0) return [];
  const base = mode === "played" ? [...held].sort((a, b) => a.order - b.order) : [...held].sort((a, b) => a.midi - b.midi);
  const out: number[] = [];
  for (let o = 0; o < Math.max(1, Math.min(4, Math.round(octaves))); o++) for (const n of base) out.push(n.midi + 12 * o);
  return out;
}

/** Note or notes for the `index`-th arp event; `rand` in [0,1) only matters for the random mode. */
export function arpPick(pool: readonly number[], mode: ArpMode, index: number, rand: number): number[] {
  const n = pool.length;
  if (n === 0) return [];
  const i = Math.max(0, Math.floor(index));
  const cycle = Math.max(1, 2 * n - 2);
  const bounce = () => {
    const k = i % cycle;
    return k < n ? k : cycle - k;
  };
  switch (mode) {
    case "up":
    case "played":
      return [pool[i % n]];
    case "down":
      return [pool[n - 1 - (i % n)]];
    case "updown":
      return [pool[bounce()]];
    case "downup":
      return [pool[n - 1 - bounce()]];
    case "random":
      return [pool[Math.min(n - 1, Math.floor(rand * n))]];
    case "chord":
      return pool.slice(0, Math.min(n, MAX_CHORD_NOTES));
    case "converge": {
      const k = i % n;
      return [pool[k % 2 === 0 ? k / 2 : n - 1 - (k - 1) / 2]];
    }
  }
}

/** Arp rate names mapped to length in beats. */
export const ARP_RATES: readonly { label: string; beats: number }[] = [
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/8T", beats: 1 / 3 },
  { label: "1/16", beats: 0.25 },
  { label: "1/16T", beats: 1 / 6 },
  { label: "1/32", beats: 0.125 },
];

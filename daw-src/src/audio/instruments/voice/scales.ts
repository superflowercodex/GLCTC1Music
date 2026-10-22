export const SCALES: Readonly<Record<string, readonly number[]>> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "minor pentatonic": [0, 3, 5, 7, 10],
  "major pentatonic": [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};

export const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

export interface KeySignature {
  /** Pitch class 0 to 11. */
  root: number;
  scale: string;
}

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Reads project key strings such as "F♯ minor", "Bb major" or "C". Unknown scales fall back to major so a typo never silences tuning. */
export function parseKey(text: string): KeySignature {
  const match = /^\s*([A-Ga-g])([#♯b♭]?)(?:\s+(.+))?\s*$/.exec(text);
  if (!match) return { root: 0, scale: "major" };
  let root = LETTERS[match[1].toUpperCase()];
  if (match[2] === "#" || match[2] === "♯") root += 1;
  if (match[2] === "b" || match[2] === "♭") root -= 1;
  const word = (match[3] ?? "").trim().toLowerCase();
  const scale = word === "" || word === "maj" ? "major" : word === "min" || word === "m" ? "minor" : word;
  return { root: ((root % 12) + 12) % 12, scale: scale in SCALES ? scale : "major" };
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function noteName(midi: number): string {
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

/** Every MIDI note in the key between two bounds, ascending. */
export function scaleNotes(key: KeySignature, low: number, high: number): number[] {
  const degrees = SCALES[key.scale] ?? SCALES.major;
  const out: number[] = [];
  for (let n = Math.ceil(low); n <= high; n++) {
    if (degrees.includes((((n - key.root) % 12) + 12) % 12)) out.push(n);
  }
  return out;
}

/** The nearest note of the scale to a fractional MIDI pitch; ties go downward so snapping is deterministic. */
export function snapToScale(midi: number, key: KeySignature): number {
  const degrees = SCALES[key.scale] ?? SCALES.major;
  const base = Math.round(midi);
  let best = base;
  let bestDist = Infinity;
  for (let n = base - 7; n <= base + 7; n++) {
    if (!degrees.includes((((n - key.root) % 12) + 12) % 12)) continue;
    const dist = Math.abs(n - midi);
    if (dist < bestDist - 1e-9) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

/** Moves `steps` scale degrees from a note; used by the harmoniser's scale-degree mode. */
export function shiftByDegrees(midi: number, steps: number, key: KeySignature): number {
  const degrees = SCALES[key.scale] ?? SCALES.major;
  let n = snapToScale(midi, key);
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    do n += dir;
    while (!degrees.includes((((n - key.root) % 12) + 12) % 12));
  }
  return n;
}

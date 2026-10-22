export const SCALE_NAMES = [
  "Chromatic",
  "Major",
  "Minor",
  "Dorian",
  "Phrygian",
  "Lydian",
  "Mixolydian",
  "Harmonic minor",
  "Minor pentatonic",
  "Major pentatonic",
  "Blues",
  "Whole tone",
] as const;

export const SCALE_INTERVALS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 9, 10],
  [0, 1, 3, 5, 7, 8, 10],
  [0, 2, 4, 6, 7, 9, 11],
  [0, 2, 4, 5, 7, 9, 10],
  [0, 2, 3, 5, 7, 8, 11],
  [0, 3, 5, 7, 10],
  [0, 2, 4, 7, 9],
  [0, 3, 5, 6, 7, 10],
  [0, 2, 4, 6, 8, 10],
];

export const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function noteName(midi: number, withOctave = false): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

function intervals(scale: number): readonly number[] {
  const table = SCALE_INTERVALS[scale];
  if (!table) throw new RangeError(`Unknown scale index ${scale}`);
  return table;
}

/** MIDI note for a scale degree counted from `rootMidi`; degrees wrap into higher or lower octaves. */
export function scaleNote(rootMidi: number, scale: number, degree: number): number {
  const table = intervals(scale);
  const whole = Math.floor(degree);
  const octave = Math.floor(whole / table.length);
  const index = whole - octave * table.length;
  return rootMidi + octave * 12 + table[index];
}

/** Nearest note that belongs to the scale; ties resolve downward so the result is stable. */
export function snapToScale(note: number, rootPitchClass: number, scale: number): number {
  const table = intervals(scale);
  let best = note;
  let bestDistance = Infinity;
  for (let d = -6; d <= 6; d++) {
    const candidate = note + d;
    const pc = (((candidate - rootPitchClass) % 12) + 12) % 12;
    if (table.includes(pc) && Math.abs(d) < bestDistance) {
      bestDistance = Math.abs(d);
      best = candidate;
    }
  }
  return best;
}

/** All scale notes between two MIDI numbers, ascending. */
export function scaleNotesInRange(rootPitchClass: number, scale: number, low: number, high: number): number[] {
  const table = intervals(scale);
  const out: number[] = [];
  for (let n = low; n <= high; n++) {
    if (table.includes((((n - rootPitchClass) % 12) + 12) % 12)) out.push(n);
  }
  return out;
}

import type { Vowel } from "./lyrics";
import { VOWELS } from "./lyrics";

export const VOICE_TYPES = ["Soprano", "Alto", "Tenor", "Bass"] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];

export interface Formant {
  freq: number;
  q: number;
  gain: number;
}

/** Five-formant tables per voice type and vowel, after the classic Csound formant data. */
const TABLE: Record<VoiceType, Record<Vowel, readonly [number, number][]>> = {
  Soprano: {
    Ah: [[800, 0], [1150, -6], [2900, -32], [3900, -20], [4950, -50]],
    Eh: [[350, 0], [2000, -20], [2800, -15], [3600, -40], [4950, -56]],
    Ee: [[270, 0], [2140, -12], [2950, -26], [3900, -26], [4950, -44]],
    Oh: [[450, 0], [800, -11], [2830, -22], [3800, -22], [4950, -50]],
    Oo: [[325, 0], [700, -16], [2700, -35], [3800, -40], [4950, -60]],
  },
  Alto: {
    Ah: [[800, 0], [1150, -4], [2800, -20], [3500, -36], [4950, -60]],
    Eh: [[400, 0], [1600, -24], [2700, -30], [3300, -35], [4950, -60]],
    Ee: [[350, 0], [1700, -20], [2700, -30], [3700, -36], [4950, -60]],
    Oh: [[450, 0], [800, -9], [2830, -16], [3500, -28], [4950, -55]],
    Oo: [[325, 0], [700, -12], [2530, -30], [3500, -40], [4950, -64]],
  },
  Tenor: {
    Ah: [[650, 0], [1080, -6], [2650, -7], [2900, -8], [3250, -22]],
    Eh: [[400, 0], [1700, -14], [2600, -12], [3200, -14], [3580, -20]],
    Ee: [[290, 0], [1870, -15], [2800, -18], [3250, -20], [3540, -30]],
    Oh: [[400, 0], [800, -10], [2600, -12], [2800, -12], [3000, -26]],
    Oo: [[350, 0], [600, -20], [2700, -17], [2900, -14], [3300, -26]],
  },
  Bass: {
    Ah: [[600, 0], [1040, -7], [2250, -9], [2450, -9], [2750, -20]],
    Eh: [[400, 0], [1620, -12], [2400, -9], [2800, -12], [3100, -18]],
    Ee: [[250, 0], [1750, -30], [2600, -16], [3050, -22], [3340, -28]],
    Oh: [[400, 0], [750, -11], [2400, -21], [2600, -20], [2900, -40]],
    Oo: [[350, 0], [600, -20], [2400, -32], [2675, -28], [2950, -36]],
  },
};

/** Octave offset that places each voice type in its own range when a played note is shared. */
export const VOICE_OCTAVE: Record<VoiceType, number> = { Soprano: 12, Alto: 0, Tenor: -12, Bass: -24 };

const Q_BY_INDEX = [10, 12, 14, 16, 18] as const;

/**
 * Formants for a vowel position. `morph` runs 0 to 1 across Ah, Eh, Ee, Oh, Oo, interpolating
 * between neighbours so a slider sweeps smoothly through every vowel.
 */
export function formantsFor(type: VoiceType, morph: number): Formant[] {
  const pos = Math.min(1, Math.max(0, morph)) * (VOWELS.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(VOWELS.length - 1, lo + 1);
  const t = pos - lo;
  const a = TABLE[type][VOWELS[lo]];
  const b = TABLE[type][VOWELS[hi]];
  return a.map(([f, g], i) => ({
    freq: f + (b[i][0] - f) * t,
    q: Q_BY_INDEX[i],
    gain: 10 ** ((g + (b[i][1] - g) * t) / 20),
  }));
}

export function vowelMorph(vowel: Vowel): number {
  return VOWELS.indexOf(vowel) / (VOWELS.length - 1);
}

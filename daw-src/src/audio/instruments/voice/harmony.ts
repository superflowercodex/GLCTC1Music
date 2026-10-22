import { freqToMidi, shiftByDegrees, snapToScale, type KeySignature } from "./scales";

export type HarmonyMode = "interval" | "scale";

export function semitoneRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/**
 * Pitch ratio for one harmony voice. Interval mode shifts by fixed semitones. Scale mode counts the
 * interval in scale degrees from the sung note (+2 is a diatonic third), so the voice stays in key.
 */
export function harmonyRatio(sungFreq: number, interval: number, mode: HarmonyMode, key: KeySignature): number {
  if (mode === "interval") return semitoneRatio(interval);
  // Scale-degree counts are small: a UI interval of +7 semitones maps to +4 degrees of a 7-note scale.
  const sung = freqToMidi(sungFreq);
  const degrees = Math.round(interval / 1.75);
  const target = shiftByDegrees(snapToScale(sung, key), degrees, key);
  return 2 ** ((target - sung) / 12);
}

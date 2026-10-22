import { dbToFader, faderToDb, FADER_MAX_DB, FADER_MIN_DB, formatDb } from "../../audio/mixMath";

/**
 * The track header's volume and pan sliders. Gain rides the console fader law from mixMath (unity at 80%
 * of the travel), so a short slider still has fine control near 0 dB; values are the same Track.gainDb and
 * Track.pan the Mixer strip edits.
 */

export const GAIN_FINE_DB = 0.1;
export const GAIN_STEP_DB = 0.5;
/** Pan this close to the middle lands on centre while dragging. */
export const PAN_DETENT = 0.04;

export const gainToPos = (db: number): number => dbToFader(db);

export function posToGain(pos: number): number {
  if (pos <= 0) return FADER_MIN_DB;
  return Math.max(FADER_MIN_DB, Math.min(FADER_MAX_DB, Math.round(faderToDb(pos) * 10) / 10));
}

export function nudgeGain(db: number, direction: 1 | -1, fine: boolean): number {
  // From silence the first step up is audible, not -59.5 dB.
  if (db <= FADER_MIN_DB && direction > 0) return posToGain(0.15);
  const next = Math.round((db + direction * (fine ? GAIN_FINE_DB : GAIN_STEP_DB)) * 10) / 10;
  return Math.max(FADER_MIN_DB, Math.min(FADER_MAX_DB, next));
}

export const panToPos = (pan: number): number => (Math.max(-1, Math.min(1, pan)) + 1) / 2;

export function posToPan(pos: number, detent = true): number {
  const pan = Math.round((Math.max(0, Math.min(1, pos)) * 2 - 1) * 100) / 100;
  return detent && Math.abs(pan) < PAN_DETENT ? 0 : pan;
}

export function nudgePan(pan: number, direction: 1 | -1, fine: boolean): number {
  return Math.max(-1, Math.min(1, Math.round((pan + direction * (fine ? 0.01 : 0.05)) * 100) / 100));
}

/** "−6.0 dB", "+1.5 dB", "0.0 dB", "−∞ dB". */
export const formatGain = (db: number): string => `${formatDb(db)} dB`;

/** "C", "L33", "R50". */
export function formatPanShort(pan: number): string {
  const p = Math.round(Math.abs(pan) * 100);
  return p === 0 ? "C" : `${pan < 0 ? "L" : "R"}${p}`;
}

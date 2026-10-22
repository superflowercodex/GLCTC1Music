import type { Track } from "../project/model";

/** Fader position 0 to 1 maps to -60 dB .. +6 dB, with unity (0 dB) at 80% like the old console. */
export const FADER_UNITY = 0.8;
export const FADER_MAX_DB = 6;
export const FADER_MIN_DB = -60;
const TAPER = 1.6;

export function faderToDb(position: number): number {
  const p = Math.min(1, Math.max(0, position));
  if (p >= FADER_UNITY) return ((p - FADER_UNITY) / (1 - FADER_UNITY)) * FADER_MAX_DB;
  return FADER_MIN_DB * (1 - p / FADER_UNITY) ** TAPER;
}

export function dbToFader(db: number): number {
  if (db >= 0) return FADER_UNITY + (Math.min(db, FADER_MAX_DB) / FADER_MAX_DB) * (1 - FADER_UNITY);
  if (db <= FADER_MIN_DB) return 0;
  return FADER_UNITY * (1 - (-db / -FADER_MIN_DB) ** (1 / TAPER));
}

export function formatDb(db: number): string {
  if (db <= FADER_MIN_DB + 0.05) return "−∞";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded < 0 ? "−" : rounded > 0 ? "+" : ""}${Math.abs(rounded).toFixed(1)}`;
}

export function formatPan(pan: number): string {
  const percent = Math.round(Math.abs(pan) * 100);
  if (percent === 0) return "C";
  return `${pan < 0 ? "L" : "R"} ${percent}`;
}

export const FILTER_MIN_HZ = 200;
export const FILTER_MAX_HZ = 20000;

/** Cutoff sliders are logarithmic: equal distances sound like equal musical steps. */
export function hzToPosition(hz: number, min = FILTER_MIN_HZ, max = FILTER_MAX_HZ): number {
  const clamped = Math.min(max, Math.max(min, hz));
  return Math.log(clamped / min) / Math.log(max / min);
}

export function positionToHz(position: number, min = FILTER_MIN_HZ, max = FILTER_MAX_HZ): number {
  return min * (max / min) ** Math.min(1, Math.max(0, position));
}

/**
 * Mute wins over solo: a track that is muted stays silent even when soloed. With any solo active,
 * only soloed tracks can be heard; with none, every unmuted track plays.
 */
export function audibleTrackIds(tracks: readonly Pick<Track, "id" | "muted" | "solo">[]): Set<string> {
  const anySolo = tracks.some((t) => t.solo);
  return new Set(tracks.filter((t) => !t.muted && (!anySolo || t.solo)).map((t) => t.id));
}

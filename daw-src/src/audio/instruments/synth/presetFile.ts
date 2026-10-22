import type { Instrument } from "../../types";
import { isRecord } from "./errors";

export class PresetFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetFileError";
  }
}

const APP = "glctc1-studio";
const VERSION = 1;

export interface ParsedPreset {
  name: string;
  category: string;
  values: Record<string, number>;
  data: unknown;
}

export function exportPresetText(instrument: Instrument, name: string, category = "Yours"): string {
  const state = instrument.serialize();
  return JSON.stringify({ app: APP, kind: instrument.kind, version: VERSION, preset: { name, category, values: state.values, data: state.data } }, null, 2);
}

/** Checks a preset file against this instrument and returns clean values; anything else is an error the player can read. */
export function parsePresetText(text: string, instrument: Instrument): ParsedPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PresetFileError("That file is not a preset: it is not valid JSON.");
  }
  if (!isRecord(raw) || raw.app !== APP || !isRecord(raw.preset)) throw new PresetFileError("That file is not a GLCTC1 Studio preset.");
  if (raw.kind !== instrument.kind) throw new PresetFileError(`That preset is for ${String(raw.kind)}, not ${instrument.kind}.`);
  if (raw.version !== VERSION) throw new PresetFileError(`That preset uses file version ${String(raw.version)}, which this app does not read.`);
  const { name, category, values, data } = raw.preset;
  if (typeof name !== "string" || name.trim() === "" || name.length > 60) throw new PresetFileError("The preset needs a name of up to 60 characters.");
  if (!isRecord(values)) throw new PresetFileError("The preset has no parameter values.");

  const byId = new Map(instrument.params.map((p) => [p.id, p]));
  const clean: Record<string, number> = {};
  const unknown: string[] = [];
  for (const [id, value] of Object.entries(values)) {
    const def = byId.get(id);
    if (!def) {
      unknown.push(id);
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) throw new PresetFileError(`Setting "${id}" is not a number.`);
    clean[id] = Math.min(def.max, Math.max(def.min, value));
  }
  if (unknown.length > 0) {
    const shown = unknown.slice(0, 3).join(", ");
    throw new PresetFileError(`The preset has settings this instrument does not know: ${shown}${unknown.length > 3 ? " and more" : ""}.`);
  }
  return { name: name.trim(), category: typeof category === "string" && category.trim() ? category.trim().slice(0, 24) : "Yours", values: clean, data };
}

/**
 * Loads a preset file and saves it among the player's own presets. If the pattern data inside is damaged,
 * the instrument goes back to how it was and the error reaches the caller.
 */
export function importPresetText(instrument: Instrument, text: string): string {
  const parsed = parsePresetText(text, instrument);
  const before = instrument.serialize();
  try {
    instrument.restore({ kind: instrument.kind, values: parsed.values, data: parsed.data });
  } catch (error) {
    instrument.restore(before);
    throw new PresetFileError(`The preset could not be loaded: ${error instanceof Error ? error.message : "its data is damaged"}`);
  }
  return instrument.saveUserPreset(parsed.name, parsed.category).name;
}

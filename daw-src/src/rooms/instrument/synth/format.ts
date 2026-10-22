import type { ParamDef } from "../../../audio/types";

export function formatParam(def: ParamDef, value: number): string {
  if (def.options) return def.options[Math.round(value)] ?? String(value);
  const signed = def.min < 0 && value > 0 ? "+" : "";
  switch (def.unit) {
    case "%":
      return `${signed}${Math.round(value * 100)}%`;
    case "ms":
      return `${Math.round(value)} ms`;
    case "s":
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    case "Hz":
      return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`;
    case "st":
    case "ct":
      return `${signed}${Math.round(value)} ${def.unit}`;
    case "oct":
      return `${Math.round(value)} ${Math.round(value) === 1 ? "octave" : "octaves"}`;
    default:
      return String(Math.round(value * 100) / 100);
  }
}

/** Knobs over a wide range of frequencies or times feel right on a log scale. */
export function usesLogScale(def: ParamDef): boolean {
  return (def.unit === "Hz" || def.unit === "s") && def.min > 0 && def.max / def.min >= 20;
}

export function toPosition(def: ParamDef, value: number): number {
  if (!usesLogScale(def)) return value;
  return Math.log(value / def.min) / Math.log(def.max / def.min);
}

export function fromPosition(def: ParamDef, position: number): number {
  if (!usesLogScale(def)) return position;
  return def.min * (def.max / def.min) ** position;
}

export function levelDb(level: number): string {
  return level <= 0.001 ? "off" : `${Math.round(20 * Math.log10(level))} dB`.replace("-", "−");
}

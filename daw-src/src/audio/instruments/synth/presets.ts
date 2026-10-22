import type { Preset } from "../../types";

/** Compact preset table: `[name, category, values]` rows become factory presets with stable ids. */
export function factoryPresets(prefix: string, rows: readonly (readonly [string, string, Record<string, number>])[]): Preset[] {
  return rows.map(([name, category, values]) => ({
    id: `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
    name,
    category,
    factory: true,
    values,
  }));
}

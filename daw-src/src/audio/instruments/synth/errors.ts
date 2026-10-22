export class SynthDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SynthDataError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

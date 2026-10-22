// Pure value math behind Knob, Fader and LedMeter, kept apart from the components so it can be property-tested.

export class KitRangeError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "KitRangeError";
  }
}

export function assertRange(min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) throw new KitRangeError(`Invalid control range ${min}..${max}`);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function toNorm(value: number, min: number, max: number): number {
  return clamp((value - min) / (max - min), 0, 1);
}

/** Snaps to the step grid anchored at `min`, so a range like 20..20000 step 10 lands on 20, 30, 40. */
export function snap(value: number, min: number, max: number, step?: number): number {
  const v = clamp(value, min, max);
  if (!step || step <= 0) return v;
  // Trim float noise (0.1 + 0.2) from the offset only, so an off-grid min like -0.333 is kept exactly.
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 2));
  const offset = Number((Math.round((v - min) / step) * step).toFixed(decimals));
  return clamp(min + offset, min, max);
}

export function fromNorm(norm: number, min: number, max: number, step?: number): number {
  return snap(min + clamp(norm, 0, 1) * (max - min), min, max, step);
}

/** Pixels of vertical travel that sweep the whole range; Shift gives a five times finer hand. */
export const DRAG_SPAN_PX = 200;
export const FINE_FACTOR = 0.2;

export function dragNorm(startNorm: number, deltaUpPx: number, fine = false, spanPx = DRAG_SPAN_PX): number {
  return clamp(startNorm + (deltaUpPx / spanPx) * (fine ? FINE_FACTOR : 1), 0, 1);
}

/** The keyboard step: the param's own step when it is coarse enough to feel, otherwise 1% of the range. */
export function keyStep(min: number, max: number, step?: number): number {
  const percent = (max - min) / 100;
  return step && step > percent ? step : percent;
}

export type NudgeKey = "ArrowUp" | "ArrowRight" | "ArrowDown" | "ArrowLeft" | "PageUp" | "PageDown" | "Home" | "End";

export function isNudgeKey(key: string): key is NudgeKey {
  return ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "PageUp", "PageDown", "Home", "End"].includes(key);
}

export function nudge(value: number, key: NudgeKey, min: number, max: number, step?: number, fine = false): number {
  const unit = keyStep(min, max, step) * (fine && !(step && step >= 1) ? 0.1 : 1);
  switch (key) {
    case "Home":
      return min;
    case "End":
      return max;
    case "PageUp":
      return snap(value + unit * 10, min, max, step);
    case "PageDown":
      return snap(value - unit * 10, min, max, step);
    case "ArrowUp":
    case "ArrowRight":
      return snap(value + unit, min, max, step);
    case "ArrowDown":
    case "ArrowLeft":
      return snap(value - unit, min, max, step);
  }
}

/** Range fraction per wheel pixel: a 100px mouse notch moves 4%, and trackpads glide in proportion. */
export const WHEEL_NORM_PER_PX = 0.0004;

/** Stepped controls (step >= 1) move one step per wheel event; continuous ones follow the wheel distance. */
export function wheelValue(value: number, deltaY: number, min: number, max: number, step?: number, fine = false): number {
  if (deltaY === 0) return value;
  if (step && step >= 1) return nudge(value, deltaY < 0 ? "ArrowUp" : "ArrowDown", min, max, step);
  const delta = clamp(-deltaY * WHEEL_NORM_PER_PX * (fine ? FINE_FACTOR : 1), -0.1, 0.1);
  const next = fromNorm(toNorm(value, min, max) + delta, min, max, step);
  // A tiny trackpad delta can round back onto the same step; it should still move by one.
  if (next === value && step && step > 0 && delta !== 0) return snap(value + Math.sign(delta) * step, min, max, step);
  return next;
}

// Knob geometry: a 270° sweep from 7:30 to 4:30, angles in degrees clockwise from 12 o'clock.
export const SWEEP_START = -135;
export const SWEEP_END = 135;

export function normToAngle(norm: number): number {
  return SWEEP_START + clamp(norm, 0, 1) * (SWEEP_END - SWEEP_START);
}

export function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/** SVG arc from a0 to a1 (degrees, clockwise). Returns "" for a zero-length arc so nothing draws. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const from = Math.min(a0, a1);
  const to = Math.max(a0, a1);
  if (to - from < 0.01) return "";
  const s = polar(cx, cy, r, from);
  const e = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${s.x.toFixed(3)} ${s.y.toFixed(3)}A${r} ${r} 0 ${large} 1 ${e.x.toFixed(3)} ${e.y.toFixed(3)}`;
}

/** Where the lit arc starts: bipolar controls (pan, detune) light outward from their centre. */
export function arcOrigin(min: number, max: number, bipolar: boolean): number {
  return bipolar && min < 0 && max > 0 ? normToAngle(toNorm(0, min, max)) : SWEEP_START;
}

// Decibels.
export const SILENCE_DB = -120;

export function gainToDb(gain: number): number {
  return gain <= 0 ? SILENCE_DB : Math.max(SILENCE_DB, 20 * Math.log10(gain));
}

export function dbToGain(db: number): number {
  return db <= SILENCE_DB ? 0 : 10 ** (db / 20);
}

// LED meter: segments cover floorDb..ceilDb evenly; amber from -12 dB, red from -3 dB, like a console.
export interface MeterScale {
  segments: number;
  floorDb: number;
  ceilDb: number;
  amberDb: number;
  redDb: number;
}

export const DEFAULT_METER: MeterScale = { segments: 24, floorDb: -48, ceilDb: 3, amberDb: -12, redDb: -3 };

/** Number of lit segments for a linear peak level. */
export function litSegments(level: number, scale: MeterScale = DEFAULT_METER): number {
  const db = gainToDb(level);
  const norm = (db - scale.floorDb) / (scale.ceilDb - scale.floorDb);
  return Math.round(clamp(norm, 0, 1) * scale.segments);
}

export type SegmentZone = "ok" | "warn" | "hot";

/** Zone of segment `index` (0 = bottom), judged by the dB value at the segment's top edge. */
export function segmentZone(index: number, scale: MeterScale = DEFAULT_METER): SegmentZone {
  const topDb = scale.floorDb + ((index + 1) / scale.segments) * (scale.ceilDb - scale.floorDb);
  return topDb > scale.redDb ? "hot" : topDb > scale.amberDb ? "warn" : "ok";
}

export interface PeakHold {
  segments: number;
  at: number;
}

/** Peak hold: a new higher peak latches; after holdMs the marker falls one segment every fallMs. */
export function updatePeak(prev: PeakHold, lit: number, now: number, holdMs = 1200, fallMs = 60): PeakHold {
  if (lit >= prev.segments) return { segments: lit, at: now };
  const since = now - prev.at - holdMs;
  if (since <= 0) return prev;
  const dropped = Math.floor(since / fallMs);
  if (dropped <= 0) return prev;
  return { segments: Math.max(lit, prev.segments - dropped), at: now - holdMs };
}

/** Meter ballistics: instant attack, exponential release per frame. */
export function ballistic(shown: number, target: number, release = 0.9): number {
  return target >= shown ? target : Math.max(target, shown * release);
}

/** Above this many steps a range is sampled instead of walked when sizing a readout. */
const READOUT_SAMPLES = 400;

/**
 * The widest text `format` produces over a range, in characters, so a live readout can reserve a slot that
 * never resizes (and never nudges its neighbours) as the value changes. Stepped ranges up to 400 steps are
 * walked exactly; continuous or finer ones are sampled at 400 points plus both ends and the reset value.
 */
export function readoutChars(format: (value: number) => string, min: number, max: number, step?: number, extra: readonly number[] = []): number {
  assertRange(min, max);
  const count = step && step > 0 ? Math.floor((max - min) / step + 1e-9) : Infinity;
  const values: number[] = [min, max, ...extra];
  if (count <= READOUT_SAMPLES) for (let i = 0; i <= count; i++) values.push(snap(min + i * step!, min, max, step));
  else for (let i = 0; i <= READOUT_SAMPLES; i++) values.push(fromNorm(i / READOUT_SAMPLES, min, max, step));
  let widest = 0;
  for (const v of values) widest = Math.max(widest, [...format(v)].length);
  return widest;
}

/**
 * Left-pads a readout with spaces to `chars` characters. In a monospace face a space is as wide as a digit,
 * so with `white-space: pre` and left alignment the text starts at the same x for every value (no layout
 * shift, no jitter) while the digits still line up on the right like a hardware display.
 */
export function padReadout(text: string, chars: number): string {
  const missing = chars - [...text].length;
  return missing > 0 ? " ".repeat(missing) + text : text;
}

/**
 * Envelope helpers. Releases are written as an explicit "hold the known level, then ramp down"
 * rather than a target curve: a release is often scheduled ahead of a note that has not started
 * (sequenced notes, offline bounces), so the gain at that moment cannot be read back, but the
 * envelope's own shape tells us what it will be.
 */

/** Rises from silence to `value`. */
export function attackTo(param: AudioParam, value: number, start: number, seconds: number): void {
  const end = start + Math.max(0.001, seconds);
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(value, end);
  param.setValueAtTime(value, end);
}

/** Level an attack reaches at `time`, so a note released mid-attack fades from where it really is. */
export function attackLevel(peak: number, start: number, seconds: number, time: number): number {
  return peak * Math.min(1, Math.max(0, (time - start) / Math.max(0.001, seconds)));
}

/** Fades from `level` to silence over `seconds`; returns when the source can be stopped. */
export function releaseFrom(param: AudioParam, level: number, time: number, seconds: number): number {
  const end = time + Math.max(0.002, seconds);
  param.cancelScheduledValues(time);
  param.setValueAtTime(level, time);
  param.linearRampToValueAtTime(0, end);
  param.setValueAtTime(0, end);
  return end + 0.02;
}

export interface Adsr {
  a: number;
  d: number;
  s: number;
  r: number;
}

export interface EnvHandle {
  /** Starts the release at audio time `t`; `r` overrides the release time (used to cut a stolen voice quickly). */
  release(t: number, r?: number): void;
  /** Time after which the envelope has decayed far enough to stop the voice without a click. */
  tailEnd(releaseAt: number, r?: number): number;
}

// The release time is when the level is ~95% down (three time constants); the voice keeps running to ~-68 dB before it stops.
const TAIL_TIME_CONSTANTS = 3;

/**
 * Schedules attack, decay and sustain on `param`. The value at any time is known in closed form, so a note
 * released during the attack starts its release from where the ramp actually got to instead of jumping.
 */
export function scheduleAdsr(param: AudioParam, t0: number, env: Adsr, peak: number, floor: number, releaseAt: number | null): EnvHandle {
  const a = Math.max(0.001, env.a);
  const d = Math.max(0.005, env.d);
  const sustain = floor + (peak - floor) * env.s;
  const attackEnd = t0 + a;
  const at = (t: number): number => (t <= attackEnd ? floor + ((peak - floor) * Math.max(0, t - t0)) / a : sustain + (peak - sustain) * Math.exp(-(t - attackEnd) / (d / 3)));

  param.setValueAtTime(floor, t0);
  const startRelease = (t: number, r: number) => {
    const rr = Math.max(0.01, r);
    param.cancelScheduledValues(t);
    param.setValueAtTime(at(t), t);
    param.setTargetAtTime(floor, t, rr / TAIL_TIME_CONSTANTS);
  };

  if (releaseAt !== null && releaseAt <= attackEnd) {
    param.linearRampToValueAtTime(at(releaseAt), releaseAt);
    param.setTargetAtTime(floor, releaseAt, Math.max(0.01, env.r) / TAIL_TIME_CONSTANTS);
  } else {
    param.linearRampToValueAtTime(peak, attackEnd);
    param.setTargetAtTime(sustain, attackEnd, d / 3);
    if (releaseAt !== null) startRelease(releaseAt, env.r);
  }

  return {
    release: (t, r) => startRelease(t, r ?? env.r),
    tailEnd: (t, r) => t + Math.max(0.01, r ?? env.r) * 2.6 + 0.08,
  };
}

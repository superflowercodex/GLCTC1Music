/** Moves a parameter without clicks; before the clock has run (construction, offline bounce) it jumps instead, so level 0 is silent from the first sample. */
export function smooth(ctx: BaseAudioContext, param: AudioParam, value: number, tau = 0.02): void {
  if (ctx.currentTime === 0) {
    param.cancelScheduledValues(0);
    param.value = value;
  } else param.setTargetAtTime(value, ctx.currentTime, tau);
}

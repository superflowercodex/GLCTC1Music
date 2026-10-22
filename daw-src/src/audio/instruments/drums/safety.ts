import { limiterCurve } from "./curves";

export interface SafetyChain {
  input: AudioNode;
  output: AudioNode;
}

/**
 * Compressor into a soft clipper: dense patterns get glued first, and whatever still peaks is
 * rounded off below full scale instead of clipping the track bus.
 */
export function createSafetyChain(ctx: BaseAudioContext): SafetyChain {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const clip = ctx.createWaveShaper();
  clip.curve = limiterCurve();
  comp.connect(clip);
  return { input: comp, output: clip };
}

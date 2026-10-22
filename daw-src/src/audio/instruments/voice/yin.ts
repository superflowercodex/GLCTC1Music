export interface PitchEstimate {
  freq: number;
  /** 1 is a perfectly periodic signal, near 0 is noise. */
  clarity: number;
}

/**
 * YIN fundamental-frequency detection (de Cheveigne and Kawahara, 2002): cumulative mean normalised
 * difference, absolute threshold, then parabolic interpolation for sub-sample lag precision.
 * Returns null for unvoiced or silent input.
 */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
  minHz = 70,
  maxHz = 1000,
  threshold = 0.15,
): PitchEstimate | null {
  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(frame.length / 2) - 1);
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxLag <= minLag + 2) return null;

  const window = frame.length - maxLag;
  const diff = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalisation removes the bias toward short lags.
  const norm = new Float32Array(maxLag + 1);
  norm[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += diff[tau];
    norm[tau] = running === 0 ? 1 : (diff[tau] * tau) / running;
  }

  let lag = -1;
  for (let tau = minLag; tau < maxLag; tau++) {
    if (norm[tau] < threshold) {
      while (tau + 1 < maxLag && norm[tau + 1] < norm[tau]) tau++;
      lag = tau;
      break;
    }
  }
  if (lag < 0) return null;

  let refined = lag;
  if (lag > 1 && lag < maxLag) {
    const a = norm[lag - 1];
    const b = norm[lag];
    const c = norm[lag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = lag + (a - c) / (2 * denom);
  }
  return { freq: sampleRate / refined, clarity: Math.max(0, 1 - norm[lag]) };
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

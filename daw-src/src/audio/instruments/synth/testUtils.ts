import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";

export const TEST_RATE = 44100;

export function offlineContext(seconds: number, sampleRate = TEST_RATE): OfflineAudioContext {
  return new NodeOfflineContext(2, Math.ceil(seconds * sampleRate), sampleRate) as unknown as OfflineAudioContext;
}

export const offlineClass = NodeOfflineContext as unknown as new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Magnitude spectrum of a window using a plain FFT (length rounded down to a power of two), with a Hann window. */
export function spectrum(data: Float32Array, start: number, size: number): Float32Array {
  const n = 2 ** Math.floor(Math.log2(size));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (data[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = i + k + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

/** Frequency of the strongest bin in a window; bin spacing is sampleRate / size. */
export function peakFrequency(data: Float32Array, start: number, size: number, sampleRate = TEST_RATE): number {
  const mags = spectrum(data, start, size);
  const n = mags.length * 2;
  let best = 1;
  for (let i = 1; i < mags.length; i++) if (mags[i] > mags[best]) best = i;
  // Parabolic interpolation recovers sub-bin accuracy.
  const a = mags[best - 1] ?? 0;
  const b = mags[best];
  const c = mags[best + 1] ?? 0;
  const shift = a + c - 2 * b === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
  return ((best + shift) * sampleRate) / n;
}

export function peakOf(data: Float32Array, from = 0, to = data.length): number {
  let peak = 0;
  for (let i = from; i < Math.min(to, data.length); i++) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
}

export function rmsOf(data: Float32Array, from = 0, to = data.length): number {
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, end - from));
}

/** Share of spectral energy above a frequency; a cutoff change moves it. */
export function energyAbove(data: Float32Array, start: number, size: number, hz: number, sampleRate = TEST_RATE): number {
  const mags = spectrum(data, start, size);
  const n = mags.length * 2;
  let high = 0;
  let total = 0;
  for (let i = 1; i < mags.length; i++) {
    const e = mags[i] * mags[i];
    total += e;
    if ((i * sampleRate) / n > hz) high += e;
  }
  return total === 0 ? 0 : high / total;
}

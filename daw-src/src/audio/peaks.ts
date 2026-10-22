import { getBuffer } from "./media";

/** Resolution kept per source: enough to draw a clip a few thousand pixels wide without going back to the samples. */
export const PEAKS_PER_SEC = 200;

export interface PeakData {
  perSec: number;
  /** Largest absolute sample in each slot, 0 to 1. */
  data: Float32Array;
}

export function computePeaks(channels: readonly Float32Array[], sampleRate: number, perSec: number = PEAKS_PER_SEC): PeakData {
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const perPeak = Math.max(1, Math.floor(sampleRate / perSec));
  const count = Math.ceil(length / perPeak);
  const data = new Float32Array(count);
  for (const ch of channels) {
    for (let i = 0; i < count; i++) {
      const from = i * perPeak;
      const to = Math.min(ch.length, from + perPeak);
      let max = data[i];
      for (let j = from; j < to; j++) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      data[i] = max;
    }
  }
  // The slot width is whole samples, so report the rate that was really used.
  return { perSec: sampleRate / perPeak, data };
}

export function peaksFromBuffer(buffer: AudioBuffer): PeakData {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return computePeaks(channels, buffer.sampleRate);
}

/** Reduces a time range of the peaks to `bins` values (the largest in each), for drawing. Past the end it yields silence. */
export function reducePeaks(peaks: PeakData, fromSec: number, toSec: number, bins: number): Float32Array {
  const out = new Float32Array(Math.max(0, Math.floor(bins)));
  if (out.length === 0 || toSec <= fromSec) return out;
  const span = (toSec - fromSec) / out.length;
  for (let b = 0; b < out.length; b++) {
    const a = Math.max(0, Math.floor((fromSec + b * span) * peaks.perSec));
    const z = Math.min(peaks.data.length, Math.max(a + 1, Math.ceil((fromSec + (b + 1) * span) * peaks.perSec)));
    let max = 0;
    for (let i = a; i < z; i++) if (peaks.data[i] > max) max = peaks.data[i];
    out[b] = max;
  }
  return out;
}

const cache = new Map<string, PeakData>();
const pending = new Map<string, Promise<PeakData | undefined>>();
const listeners = new Set<() => void>();

export function peekPeaks(assetId: string): PeakData | undefined {
  return cache.get(assetId);
}

export function subscribePeaks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPeaks(assetId: string, peaks: PeakData): void {
  cache.set(assetId, peaks);
  for (const l of listeners) l();
}

export function dropPeaks(assetId: string): void {
  cache.delete(assetId);
}

/** Peaks for a stored audio asset, computed once and then served from memory. */
export function getPeaks(assetId: string): Promise<PeakData | undefined> {
  const have = cache.get(assetId);
  if (have) return Promise.resolve(have);
  const inflight = pending.get(assetId);
  if (inflight) return inflight;
  const work = (async () => {
    const buffer = await getBuffer(assetId);
    if (!buffer) return undefined;
    const peaks = peaksFromBuffer(buffer);
    setPeaks(assetId, peaks);
    return peaks;
  })().finally(() => pending.delete(assetId));
  pending.set(assetId, work);
  return work;
}

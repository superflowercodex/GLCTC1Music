import { newId, type Asset } from "../../../project/model";
import { getAssetBlob, putAssetBlob } from "../../../project/db";
import { projectStore } from "../../../store/project";
import { AudioEngineError } from "../../types";

export class SampleDecodeError extends AudioEngineError {
  constructor(name: string, cause?: unknown) {
    super(`Could not read "${name}" as audio${cause instanceof Error && cause.message ? `: ${cause.message}` : "."}`);
    this.name = "SampleDecodeError";
  }
}

/**
 * Decoded buffers by asset id. Buffers are not tied to one context, so the offline copy that
 * bounceInstrument builds reuses what the live instrument already decoded.
 */
const cache = new Map<string, AudioBuffer>();

export function cacheBuffer(id: string, buffer: AudioBuffer): void {
  cache.set(id, buffer);
}

export function cachedBuffer(id: string): AudioBuffer | undefined {
  return cache.get(id);
}

export async function decodeBlob(ctx: BaseAudioContext, blob: Blob, name: string): Promise<AudioBuffer> {
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch (error) {
    throw new SampleDecodeError(name, error);
  }
}

/** Loads an asset's audio from IndexedDB (or the cache) and decodes it. */
export async function loadAssetBuffer(ctx: BaseAudioContext, id: string, name = id): Promise<AudioBuffer> {
  const hit = cache.get(id);
  if (hit) return hit;
  const blob = await getAssetBlob(id);
  if (!blob) throw new AudioEngineError(`The sample "${name}" is missing from this browser's storage.`);
  const buffer = await decodeBlob(ctx, blob, name);
  cache.set(id, buffer);
  return buffer;
}

export interface StoredSample {
  id: string;
  buffer: AudioBuffer;
}

/** Decodes a picked or recorded blob, saves it in the asset store and registers it with the project so it travels with it. */
export async function storeSample(ctx: BaseAudioContext, blob: Blob, name: string): Promise<StoredSample> {
  const buffer = await decodeBlob(ctx, blob, name);
  const id = newId("smp");
  await putAssetBlob(id, blob);
  cache.set(id, buffer);
  registerAsset({
    id,
    kind: "audio",
    name,
    mime: blob.type || "audio/wav",
    bytes: blob.size,
    durationSec: buffer.duration,
    addedAt: Date.now(),
  });
  return { id, buffer };
}

export function registerAsset(asset: Asset): void {
  projectStore.set((p) => ({ ...p, assets: [...p.assets, asset] }));
}

/** Shared mono-or-stereo peak summary for waveform drawing. */
export function peaks(buffer: AudioBuffer, bins: number): Float32Array {
  const out = new Float32Array(bins);
  const data = buffer.getChannelData(0);
  const per = Math.max(1, Math.floor(data.length / bins));
  for (let b = 0; b < bins; b++) {
    let max = 0;
    const end = Math.min(data.length, (b + 1) * per);
    for (let i = b * per; i < end; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
    out[b] = max;
  }
  return out;
}

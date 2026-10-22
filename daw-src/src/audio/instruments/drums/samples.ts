import { getAssetBlob } from "../../../project/db";
import { AudioEngineError } from "../../types";

export interface SampleRef {
  assetId: string;
  name: string;
}

export class DrumSampleError extends AudioEngineError {
  constructor(message: string) {
    super(message);
    this.name = "DrumSampleError";
  }
}

/** Decoded samples by asset id, shared by live instruments and their offline bounce copies. */
const decoded = new Map<string, AudioBuffer>();

export function cachedSample(assetId: string): AudioBuffer | undefined {
  return decoded.get(assetId);
}

export function cacheSample(assetId: string, buffer: AudioBuffer): void {
  decoded.set(assetId, buffer);
}

export async function loadSample(ctx: BaseAudioContext, ref: SampleRef): Promise<AudioBuffer> {
  const hit = decoded.get(ref.assetId);
  if (hit) return hit;
  const blob = await getAssetBlob(ref.assetId);
  if (!blob) throw new DrumSampleError(`The sample "${ref.name}" is missing from this project's storage.`);
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    decoded.set(ref.assetId, buffer);
    return buffer;
  } catch (err) {
    throw new DrumSampleError(`The sample "${ref.name}" could not be decoded${err instanceof Error ? `: ${err.message}` : "."}`);
  }
}

export function isSampleRef(value: unknown): value is SampleRef {
  return typeof value === "object" && value !== null && typeof (value as SampleRef).assetId === "string" && typeof (value as SampleRef).name === "string";
}

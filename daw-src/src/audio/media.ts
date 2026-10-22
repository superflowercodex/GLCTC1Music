import { getAssetBlob } from "../project/db";
import { uiStore } from "../store/project";
import { getEngine } from "./engine";

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

let toastCounter = 0;

/** The single way for audio and project code to tell the user something; the shell renders uiStore.toast. */
export function showToast(text: string): void {
  toastCounter += 1;
  uiStore.set((s) => ({ ...s, toast: { id: Date.now() * 1000 + (toastCounter % 1000), text } }));
}

const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | undefined>>();
const reported = new Set<string>();

export function peekBuffer(assetId: string): AudioBuffer | undefined {
  return buffers.get(assetId);
}

export function setBuffer(assetId: string, buffer: AudioBuffer): void {
  buffers.set(assetId, buffer);
}

export function dropBuffer(assetId: string): void {
  buffers.delete(assetId);
  loading.delete(assetId);
}

export async function decodeAudio(source: Blob, name: string, ctx: BaseAudioContext = getEngine().ctx): Promise<AudioBuffer> {
  let bytes: ArrayBuffer;
  try {
    bytes = await source.arrayBuffer();
  } catch (err) {
    throw new MediaError(`Could not read "${name}": ${err instanceof Error ? err.message : "unknown error"}.`);
  }
  try {
    return await ctx.decodeAudioData(bytes);
  } catch {
    throw new MediaError(`"${name}" could not be decoded. It may be damaged or in a format this browser cannot play.`);
  }
}

/** Decoded audio for an asset, loaded from the studio database on first use; undefined when the file is not stored. */
export function getBuffer(assetId: string): Promise<AudioBuffer | undefined> {
  const have = buffers.get(assetId);
  if (have) return Promise.resolve(have);
  const pending = loading.get(assetId);
  if (pending) return pending;
  const work = (async () => {
    const blob = await getAssetBlob(assetId);
    if (!blob) return undefined;
    const decoded = await decodeAudio(blob, assetId);
    buffers.set(assetId, decoded);
    return decoded;
  })().finally(() => loading.delete(assetId));
  loading.set(assetId, work);
  return work;
}

/**
 * Loads every asset the arrangement plays. Failures go to the user once per asset and the asset is
 * left out, so one broken file does not stop the rest from playing.
 */
export async function loadBuffers(assetIds: Iterable<string>, names?: ReadonlyMap<string, string>): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  await Promise.all(
    [...new Set(assetIds)].map(async (id) => {
      try {
        const b = await getBuffer(id);
        if (b) out.set(id, b);
        else if (!reported.has(id)) {
          reported.add(id);
          showToast(`The audio file "${names?.get(id) ?? id}" is missing from this device, so it will not play.`);
        }
      } catch (err) {
        if (!reported.has(id)) {
          reported.add(id);
          showToast(err instanceof Error ? err.message : `Could not load "${names?.get(id) ?? id}".`);
        }
      }
    }),
  );
  return out;
}

export function loadedBuffers(): ReadonlyMap<string, AudioBuffer> {
  return buffers;
}

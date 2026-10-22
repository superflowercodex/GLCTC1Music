import { getBuffer } from "../../../audio/media";

export class AudioLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioLoadError";
  }
}

/** The shared decoded buffer for an asset, so the editor and playback agree on one copy (and one warp cache key). */
export async function loadAssetBuffer(assetId: string): Promise<AudioBuffer> {
  const buffer = await getBuffer(assetId);
  if (!buffer) throw new AudioLoadError("The audio for this clip is missing from this device.");
  return buffer;
}

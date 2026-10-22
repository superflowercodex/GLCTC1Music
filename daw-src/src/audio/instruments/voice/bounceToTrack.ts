import { putAssetBlob } from "../../../project/db";
import { newId, type Clip, type Track } from "../../../project/model";
import { projectStore } from "../../../store/project";
import { cacheBuffer, registerAsset } from "./assets";
import { encodeWav } from "./wav";

/** Saves a rendered buffer as an asset and puts it on a new audio track, starting at the first bar. */
export async function addBouncedTrack(buffer: AudioBuffer, name: string, color: string): Promise<string> {
  const assetId = newId("bnc");
  await putAssetBlob(assetId, encodeWav(buffer));
  cacheBuffer(assetId, buffer);
  const project = projectStore.get();
  const barSeconds = (60 / project.bpm) * project.beatsPerBar;
  registerAsset({
    id: assetId,
    kind: "audio",
    name,
    mime: "audio/wav",
    bytes: buffer.length * Math.min(2, buffer.numberOfChannels) * 2 + 44,
    durationSec: buffer.duration,
    addedAt: Date.now(),
  });
  const clip: Clip = {
    id: newId("clip"),
    kind: "audio",
    name,
    startBar: 1,
    lengthBars: Math.max(1, Math.ceil(buffer.duration / barSeconds - 1e-6)),
    assetId,
    offsetSec: 0,
    gainDb: 0,
    pitchSemitones: 0,
    fineCents: 0,
    warp: false,
    keyLock: false,
    fadeInSteps: 0,
    fadeOutSteps: 0,
  };
  const track: Track = {
    id: newId("trk"),
    name,
    kind: "audio",
    color,
    muted: false,
    solo: false,
    gainDb: 0,
    pan: 0,
    sends: { reverb: 0, delay: 0 },
    inserts: [],
    cue: false,
    toMaster: true,
    clips: [clip],
    automation: [],
  };
  projectStore.set((p) => ({ ...p, tracks: [...p.tracks, track] }));
  return track.id;
}

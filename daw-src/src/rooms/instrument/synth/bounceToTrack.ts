import { bounceInstrument, type BounceOptions } from "../../../audio/bounce";
import { peekEngine } from "../../../audio/engine";
import { encodeWav } from "../../../audio/instruments/synth/wavEncode";
import { AudioEngineError, type Instrument } from "../../../audio/types";
import { putAssetBlob } from "../../../project/db";
import { newId, type Asset, type Clip, type Track } from "../../../project/model";
import { projectStore } from "../../../store/project";
import { messageOf, showToast } from "./toast";

export const BAR_CHOICES = [1, 2, 4, 8] as const;

export interface BounceRequest {
  instrument: Instrument;
  /** Builds a second copy of the instrument on the offline context. */
  create: (ctx: BaseAudioContext) => Instrument;
  name: string;
  color: string;
  bars: number;
  /** Overrides for the offline render, e.g. a lower sample rate. */
  render?: Partial<BounceOptions>;
}

/** Renders the instrument's pattern offline, stores it as a WAV asset and puts it on a new audio track. Failures reach the toast. */
export async function bounceToTrack({ instrument, create, name, color, bars, render }: BounceRequest): Promise<boolean> {
  try {
    if (instrument.activePattern === null) throw new AudioEngineError(`Pick a pattern for ${name} first; nothing is selected to bounce.`);
    const { bpm, beatsPerBar } = projectStore.get();
    const buffer = await bounceInstrument(create, instrument.serialize(), { bars, bpm, beatsPerBar, tailSeconds: 2, ...render });
    const blob = encodeWav(buffer);
    const assetId = newId("asset");
    await putAssetBlob(assetId, blob);

    const asset: Asset = { id: assetId, kind: "audio", name: `${name} bounce`, mime: "audio/wav", bytes: blob.size, durationSec: buffer.duration, detectedBpm: bpm, addedAt: Date.now() };
    const secondsPerBar = (60 / bpm) * beatsPerBar;
    const position = peekEngine()?.clock.position() ?? 0;
    const clip: Clip = {
      id: newId("clip"),
      kind: "audio",
      name: `${name} bounce`,
      startBar: Math.floor(position / (beatsPerBar * 4)) + 1,
      lengthBars: buffer.duration / secondsPerBar,
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
      name: `${name} bounce`,
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
    projectStore.set((p) => ({ ...p, assets: [...p.assets, asset], tracks: [...p.tracks, track] }));
    showToast(`${name} bounced to a new track.`);
    return true;
  } catch (error) {
    showToast(`Bounce failed: ${messageOf(error)}`);
    return false;
  }
}

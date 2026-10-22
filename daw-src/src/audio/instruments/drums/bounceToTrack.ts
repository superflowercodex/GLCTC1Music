import { audioBufferToWav } from "../../wav";
import { bounceInstrument } from "../../bounce";
import type { Instrument } from "../../types";
import { addAudioBlobAsset, placeAsset } from "../../../project/importMedia";
import { projectStore } from "../../../store/project";
import type { DrumBase } from "./drumBase";
import { notify } from "./notify";

/**
 * Renders the instrument's pattern offline, stores it as an audio asset and drops it on a new
 * track at bar 1. Every failure is reported in a toast; returns whether it worked.
 */
export async function bounceDrumToTrack(instrument: DrumBase, create: (ctx: BaseAudioContext) => Instrument, name: string, bars: number): Promise<boolean> {
  try {
    await instrument.preloadSamples();
    const project = projectStore.get();
    const buffer = await bounceInstrument(create, instrument.serialize(), { bars, bpm: project.bpm, beatsPerBar: project.beatsPerBar });
    const blob = new Blob([audioBufferToWav(buffer, { bitDepth: 16 })], { type: "audio/wav" });
    const { asset } = await addAudioBlobAsset(blob, `${name} bounce`);
    placeAsset(asset.id, { newTrack: true, startBar: 1 });
    notify(`Bounced ${bars} bar${bars === 1 ? "" : "s"} of ${name} to a new track.`);
    return true;
  } catch (err) {
    notify(err instanceof Error ? `Bounce failed: ${err.message}` : "Bounce failed.");
    return false;
  }
}

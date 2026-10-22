import { dropBuffer, showToast } from "../../audio/media";
import { dropPeaks } from "../../audio/peaks";
import { addClip, addTrack, makeClip, makeTrack, trackAccepts } from "../../project/actions";
import { deleteAssetBlob, getAssetBlob, putAssetBlob } from "../../project/db";
import { importMedia, placeAsset, playheadBar } from "../../project/importMedia";
import { newId, type Asset, type Project } from "../../project/model";
import { persistence } from "../../project/persist";
import { confirmSheet } from "../../sheets/confirm";
import { projectStore, uiStore } from "../../store/project";
import { parseStandardMidiFile, type ParsedMidiFile } from "./smf";

export type MediaFilter = "all" | "audio" | "midi" | "video" | "image";

export const PROJECT_FILE = /\.(glctc1studio|glctc1)$/i;

export const toast = showToast;

/** Browsers label .mid files "audio/midi", which the shared classifier would call audio, so MIDI is checked first. */
export function isMidiFile(file: { name: string; type: string }): boolean {
  return /\.midi?$/i.test(file.name) || /^audio\/(x-)?mid(i)?$/.test(file.type);
}

/** Stores a MIDI file as media after checking it parses, so a broken file is refused here rather than at Add to timeline. */
async function importMidiFile(file: File): Promise<Asset> {
  const parsed = parseStandardMidiFile(new Uint8Array(await file.arrayBuffer()), projectStore.get().beatsPerBar);
  const asset: Asset = {
    id: newId("asset"),
    kind: "midi",
    name: file.name.replace(/\.[^.]+$/, ""),
    mime: file.type || "audio/midi",
    bytes: file.size,
    detectedBpm: parsed.bpm,
    durationSec: (parsed.bars * projectStore.get().beatsPerBar * 60) / parsed.bpm,
    addedAt: Date.now(),
  };
  await putAssetBlob(asset.id, file);
  projectStore.set((p) => ({ ...p, assets: [...p.assets, asset] }));
  return asset;
}

/** Imports audio, video, images (shared importer) and MIDI. Every failure reaches the user in a toast. */
export async function importLibraryFiles(files: readonly File[]): Promise<void> {
  const midi = files.filter(isMidiFile);
  const rest = files.filter((f) => !isMidiFile(f));
  if (rest.length) await importMedia(rest);
  const failures: string[] = [];
  let added = 0;
  for (const file of midi) {
    try {
      await importMidiFile(file);
      added += 1;
    } catch (error) {
      failures.push(`"${file.name}" could not be imported: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) toast(failures.join(" "));
  else if (added) toast(added === 1 ? "MIDI file added to your media." : `${added} MIDI files added to your media.`);
}

/** Where a MIDI file's notes land: the selected instrument track, else the first, else a new one. Pure for testing. */
export function planMidiClip(project: Project, asset: Asset, parsed: ParsedMidiFile, selectedTrackId: string | null, startBar: number): { project: Project; clipId: string } {
  const clip = makeClip({ kind: "midi", name: asset.name, startBar, lengthBars: parsed.bars, notes: parsed.notes });
  const accepts = project.tracks.filter((t) => trackAccepts(t, "midi"));
  const chosen = accepts.find((t) => t.id === selectedTrackId) ?? accepts[0];
  if (chosen) return { project: addClip(project, chosen.id, clip), clipId: clip.id };
  const track = makeTrack(project, "instrument", { name: "MIDI" });
  return { project: addClip(addTrack(project, track), track.id, clip), clipId: clip.id };
}

export async function addAssetToTimeline(assetId: string): Promise<void> {
  const project = projectStore.get();
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) {
    toast("That file is no longer in this project.");
    return;
  }
  if (asset.kind !== "midi") {
    const clipId = placeAsset(assetId);
    uiStore.set((s) => ({ ...s, selectedClipId: clipId }));
    toast(`"${asset.name}" is on the timeline.`);
    return;
  }
  const blob = await getAssetBlob(asset.id);
  if (!blob) {
    toast(`The file for "${asset.name}" is missing from this device.`);
    return;
  }
  const parsed = parseStandardMidiFile(new Uint8Array(await blob.arrayBuffer()), project.beatsPerBar);
  const planned = planMidiClip(project, asset, parsed, uiStore.get().selectedTrackId, playheadBar(project));
  projectStore.set(planned.project);
  uiStore.set((s) => ({ ...s, selectedClipId: planned.clipId }));
  toast(`"${asset.name}" is on the timeline.`);
}

export function clipsUsingAsset(project: Project, assetId: string): number {
  return project.tracks.reduce((n, t) => n + t.clips.filter((c) => c.assetId === assetId).length, 0);
}

/** Removes a file from the project after asking. Clips that play it go too, and the question says so. */
export async function deleteAsset(assetId: string): Promise<boolean> {
  const project = projectStore.get();
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) return false;
  const used = clipsUsingAsset(project, assetId);
  const confirmed = await confirmSheet({
    title: `Delete "${asset.name}"?`,
    message: used
      ? `It is used by ${used} clip${used === 1 ? "" : "s"} on the timeline. Deleting it removes ${used === 1 ? "that clip" : "those clips"} too.`
      : "It will be removed from this project and from this device.",
    confirmLabel: used ? `Delete file and ${used} clip${used === 1 ? "" : "s"}` : "Delete",
    cancelLabel: "Keep it",
    danger: true,
  });
  if (!confirmed) return false;
  projectStore.set((p) => ({
    ...p,
    assets: p.assets.filter((a) => a.id !== assetId),
    tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.assetId !== assetId) })),
  }));
  // The saved project must stop pointing at the file before the file goes, or a crash would leave a dangling clip.
  await persistence().saveNow();
  await deleteAssetBlob(assetId);
  dropBuffer(assetId);
  dropPeaks(assetId);
  return true;
}

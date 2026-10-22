import { decodeAudio, MediaError, setBuffer, showToast } from "../audio/media";
import { detectTempoAndKey } from "../audio/analysis";
import { peekEngine } from "../audio/engine";
import { setPeaks, peaksFromBuffer } from "../audio/peaks";
import { projectStore, uiStore } from "../store/project";
import { StorageError } from "../storage";
import { MidiFileError, parseStandardMidiFile } from "../rooms/library/smf";
import { addClip, addTrack, barSeconds, makeClip, makeTrack, trackAccepts, trackKindForClip } from "./actions";
import { putAssetBlob } from "./db";
import { newId, type Asset, type Clip, type ClipKind, type Project } from "./model";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

const AUDIO_EXT = /\.(wav|wave|mp3|m4a|aac|ogg|oga|opus|flac|aif|aiff|caf|weba)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv|mkv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;
const MIDI_EXT = /\.(mid|midi)$/i;

/** Browsers often leave the MIME type empty for dragged files, so the extension is the fallback. */
export function classifyFile(name: string, mime: string): Asset["kind"] | null {
  // Browsers label .mid files "audio/midi", so MIDI must be decided before the generic audio/ check.
  if (/^audio\/(x-)?mid(i)?$/.test(mime) || MIDI_EXT.test(name)) return "midi";
  if (mime.startsWith("audio/") || AUDIO_EXT.test(name)) return "audio";
  if (mime.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
  if (mime.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
  return null;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

function readVideoDuration(blob: Blob, name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      fn();
    };
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      done(() => (Number.isFinite(video.duration) ? resolve(video.duration) : reject(new ImportError(`"${name}" has no readable length.`))));
    video.onerror = () => done(() => reject(new ImportError(`"${name}" could not be read as a video. Try an MP4 or WebM file.`)));
    video.src = url;
  });
}

function checkImage(blob: Blob, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImportError(`"${name}" could not be read as an image.`));
    };
    img.src = url;
  });
}

async function store(id: string, blob: Blob, name: string): Promise<void> {
  try {
    await putAssetBlob(id, blob);
  } catch (err) {
    const why = err instanceof StorageError ? err.message : "the browser refused to store it";
    throw new ImportError(`"${name}" could not be saved on this device: ${why}`);
  }
}

function addAsset(asset: Asset): void {
  projectStore.set((p) => ({ ...p, assets: [...p.assets, asset] }));
}

/** Decodes, stores and registers an audio blob (an import or a finished recording) and reads its tempo and key. */
export async function addAudioBlobAsset(blob: Blob, name: string): Promise<{ asset: Asset; buffer: AudioBuffer }> {
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudio(blob, name);
  } catch (err) {
    throw new ImportError(err instanceof MediaError ? err.message : `"${name}" could not be decoded.`);
  }
  const id = newId("asset");
  await store(id, blob, name);
  setBuffer(id, buffer);
  setPeaks(id, peaksFromBuffer(buffer));
  // Detection is a convenience: a clip with no tempo still plays, so a failure leaves the fields empty.
  const detected = await detectTempoAndKey(buffer).catch(() => ({}) as { bpm?: number; key?: string });
  const asset: Asset = {
    id,
    kind: "audio",
    name: stripExtension(name),
    mime: blob.type || "audio/wav",
    bytes: blob.size,
    durationSec: buffer.duration,
    detectedBpm: detected.bpm,
    detectedKey: detected.key,
    addedAt: Date.now(),
  };
  addAsset(asset);
  return { asset, buffer };
}

/** Stores a MIDI file as media after checking it parses, so a broken file is refused here rather than at Add to timeline. */
export async function importMidiAsset(file: File): Promise<Asset> {
  const beatsPerBar = projectStore.get().beatsPerBar;
  let parsed;
  try {
    parsed = parseStandardMidiFile(new Uint8Array(await file.arrayBuffer()), beatsPerBar);
  } catch (err) {
    throw new ImportError(`"${file.name}" could not be read as a MIDI file${err instanceof MidiFileError ? `: ${err.message}` : "."}`);
  }
  const asset: Asset = {
    id: newId("asset"),
    kind: "midi",
    name: stripExtension(file.name),
    mime: file.type || "audio/midi",
    bytes: file.size,
    detectedBpm: parsed.bpm,
    durationSec: (parsed.bars * beatsPerBar * 60) / parsed.bpm,
    addedAt: Date.now(),
  };
  await store(asset.id, file, file.name);
  addAsset(asset);
  return asset;
}

async function importOne(file: File): Promise<Asset> {
  const kind = classifyFile(file.name, file.type);
  if (kind === null) throw new ImportError(`"${file.name}" is not a file type Studio can use. Try audio, video or an image.`);
  if (kind === "midi") return importMidiAsset(file);
  if (kind === "audio") return (await addAudioBlobAsset(file, file.name)).asset;

  const id = newId("asset");
  const durationSec = kind === "video" ? await readVideoDuration(file, file.name) : (await checkImage(file, file.name), undefined);
  await store(id, file, file.name);
  const asset: Asset = { id, kind, name: stripExtension(file.name), mime: file.type, bytes: file.size, durationSec, addedAt: Date.now() };
  addAsset(asset);
  return asset;
}

/**
 * Imports files into the project's media. Every failure is reported to the user in one toast; the
 * files that did work are kept.
 */
export async function importMedia(files: Iterable<File>): Promise<Asset[]> {
  const imported: Asset[] = [];
  const failures: string[] = [];
  for (const file of files) {
    try {
      imported.push(await importOne(file));
    } catch (err) {
      failures.push(err instanceof Error ? err.message : `"${file.name}" could not be imported.`);
    }
  }
  if (failures.length > 0) {
    const more = failures.length > 1 ? ` (and ${failures.length - 1} more could not be imported)` : "";
    showToast(failures[0] + more);
  } else if (imported.length === 1) {
    const a = imported[0];
    const found = [a.detectedBpm ? `${Math.round(a.detectedBpm)} BPM` : "", a.detectedKey ?? ""].filter(Boolean).join(" · ");
    showToast(found ? `${a.name}: ${found} detected.` : `${a.name} added to your media.`);
  } else if (imported.length > 1) {
    showToast(`${imported.length} files added to your media.`);
  }
  return imported;
}

export function clipKindForAsset(asset: Asset): ClipKind {
  return asset.kind === "audio" ? "audio" : asset.kind === "video" ? "video" : asset.kind === "midi" ? "midi" : "image";
}

/** The clip an asset becomes: its own length for audio and video, two bars for a still image. */
export function clipForAsset(project: Project, asset: Asset, startBar: number): Clip {
  const kind = clipKindForAsset(asset);
  const bars = kind === "image" || !asset.durationSec ? 2 : asset.durationSec / barSeconds(project);
  return makeClip({ kind, name: asset.name, startBar, lengthBars: Math.max(0.25, bars), assetId: asset.id });
}

/** The playhead as a bar number, rounded to the nearest beat like the old DAW did when adding a clip. */
export function playheadBar(project: Project): number {
  const step = peekEngine()?.clock.position() ?? 0;
  const beat = Math.round(step / 4);
  return 1 + beat / project.beatsPerBar;
}

/**
 * Puts an asset on the timeline: on `trackId` if given and compatible, else the selected track,
 * else the first compatible one, else a new track (always a new one with `newTrack`). Returns the new clip's id.
 */
export function placeAsset(assetId: string, options: { trackId?: string; startBar?: number; newTrack?: boolean } = {}): string {
  const project = projectStore.get();
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new ImportError("That file is no longer in your media.");
  if (asset.kind === "midi") throw new ImportError(`"${asset.name}" is a MIDI file. Use Add to timeline in the Library to place its notes.`);
  const startBar = options.startBar ?? playheadBar(project);
  const clip = clipForAsset(project, asset, startBar);
  const selected = uiStore.get().selectedTrackId;
  const candidates = [options.trackId, selected ?? undefined];
  let dest = options.newTrack
    ? undefined
    : (candidates.map((id) => project.tracks.find((t) => t.id === id)).find((t) => t && trackAccepts(t, clip.kind)) ??
      project.tracks.find((t) => trackAccepts(t, clip.kind)));
  let next = project;
  if (!dest) {
    dest = makeTrack(next, trackKindForClip(clip.kind), asset.kind === "audio" ? { name: asset.name } : {});
    next = addTrack(next, dest);
  }
  next = addClip(next, dest.id, clip);
  projectStore.set(next);
  return clip.id;
}

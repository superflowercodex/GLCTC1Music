import { newId, type Asset, type Clip, type ClipKind, type Project, type Track, type TrackKind } from "./model";

export class ArrangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArrangeError";
  }
}

export const TRACK_COLORS: readonly string[] = ["#79ebff", "#8e7cff", "#ff63d8", "#7cf0c0", "#ffd36a", "#ff9a62", "#62a8ff", "#c4ff6a"];

export const GAIN_DB_RANGE = { min: -60, max: 12 } as const;
export const PITCH_RANGE = { min: -24, max: 24 } as const;

/** Playback speed of a clip's source relative to normal: only warped clips with a known tempo are sped up or slowed. */
export function clipRate(project: { bpm: number; assets: readonly Asset[] }, clip: Clip): number {
  if (!clip.warp || !clip.assetId) return 1;
  const bpm = project.assets.find((a) => a.id === clip.assetId)?.detectedBpm;
  if (!bpm) return 1;
  return Math.min(2, Math.max(0.5, project.bpm / bpm));
}

export function barSeconds(project: Pick<Project, "bpm" | "beatsPerBar">): number {
  return (project.beatsPerBar * 60) / project.bpm;
}

export function stepsPerBar(project: Pick<Project, "beatsPerBar">): number {
  return project.beatsPerBar * 4;
}

/** The shortest a clip may get: a quarter of a beat, as in the old DAW. */
export function minClipBars(project: Pick<Project, "beatsPerBar">): number {
  return 0.25 / project.beatsPerBar;
}

export function clipEndBar(clip: Pick<Clip, "startBar" | "lengthBars">): number {
  return clip.startBar + clip.lengthBars;
}

export function trackAccepts(track: Pick<Track, "kind">, clipKind: ClipKind): boolean {
  switch (track.kind) {
    case "audio":
      return clipKind === "audio";
    case "instrument":
      return clipKind === "pattern" || clipKind === "midi";
    case "video":
      return clipKind === "video" || clipKind === "image";
    case "fx":
      return false;
  }
}

export function trackKindForClip(kind: ClipKind): TrackKind {
  if (kind === "pattern" || kind === "midi") return "instrument";
  if (kind === "video" || kind === "image") return "video";
  return "audio";
}

const DEFAULT_NAMES: Record<TrackKind, string> = { audio: "Audio", instrument: "Instrument", video: "Video", fx: "FX" };

export function makeTrack(project: Project, kind: TrackKind, overrides: Partial<Track> = {}): Track {
  const sameKind = project.tracks.filter((t) => t.kind === kind).length;
  return {
    id: newId("trk"),
    name: sameKind === 0 ? DEFAULT_NAMES[kind] : `${DEFAULT_NAMES[kind]} ${sameKind + 1}`,
    kind,
    color: TRACK_COLORS[project.tracks.length % TRACK_COLORS.length],
    muted: false,
    solo: false,
    gainDb: 0,
    pan: 0,
    sends: { reverb: 0, delay: 0 },
    inserts: [],
    cue: false,
    toMaster: true,
    clips: [],
    automation: [],
    ...overrides,
  };
}

export function makeClip(spec: Pick<Clip, "kind" | "startBar" | "lengthBars"> & Partial<Clip>): Clip {
  return {
    id: newId("clip"),
    name: "Clip",
    offsetSec: 0,
    gainDb: 0,
    pitchSemitones: 0,
    fineCents: 0,
    warp: false,
    keyLock: false,
    fadeInSteps: 0,
    fadeOutSteps: 0,
    ...spec,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** Keeps a clip inside the ranges the playback code assumes; every action runs its results through this. */
export function sanitizeClip(project: Project, clip: Clip): Clip {
  const min = minClipBars(project);
  const startBar = Math.max(1, finite(clip.startBar, 1));
  const lengthBars = Math.max(min, finite(clip.lengthBars, min));
  const maxFade = lengthBars * stepsPerBar(project);
  let fadeIn = clamp(finite(clip.fadeInSteps, 0), 0, maxFade);
  let fadeOut = clamp(finite(clip.fadeOutSteps, 0), 0, maxFade);
  if (fadeIn + fadeOut > maxFade) {
    const scale = maxFade / (fadeIn + fadeOut);
    fadeIn *= scale;
    fadeOut *= scale;
  }
  return {
    ...clip,
    startBar,
    lengthBars,
    offsetSec: Math.max(0, finite(clip.offsetSec, 0)),
    gainDb: clamp(finite(clip.gainDb, 0), GAIN_DB_RANGE.min, GAIN_DB_RANGE.max),
    pitchSemitones: clamp(finite(clip.pitchSemitones, 0), PITCH_RANGE.min, PITCH_RANGE.max),
    fineCents: clamp(finite(clip.fineCents, 0), -100, 100),
    fadeInSteps: fadeIn,
    fadeOutSteps: fadeOut,
  };
}

export interface ClipLocation {
  track: Track;
  trackIndex: number;
  clip: Clip;
}

export function findClip(project: Project, clipId: string): ClipLocation | undefined {
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex++) {
    const track = project.tracks[trackIndex];
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, trackIndex, clip };
  }
  return undefined;
}

/** End of the last clip, as a bar number; 1 for an empty project. */
export function timelineEndBar(project: Project): number {
  let end = 1;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, clipEndBar(c));
  return end;
}

function touch(project: Project, next: Partial<Project>): Project {
  return { ...project, ...next, updatedAt: Date.now() };
}

function mapClips(project: Project, fn: (clip: Clip, track: Track) => Clip): Project {
  let changed = false;
  const tracks = project.tracks.map((t) => {
    let trackChanged = false;
    const clips = t.clips.map((c) => {
      const next = fn(c, t);
      if (next !== c) trackChanged = true;
      return next;
    });
    if (!trackChanged) return t;
    changed = true;
    return { ...t, clips };
  });
  return changed ? touch(project, { tracks }) : project;
}

// Tracks

export function addTrack(project: Project, track: Track, index?: number): Project {
  const at = index === undefined ? project.tracks.length : clamp(index, 0, project.tracks.length);
  const tracks = [...project.tracks.slice(0, at), track, ...project.tracks.slice(at)];
  return touch(project, { tracks });
}

/** Removing an instrument track also removes its slot, so no instrument is left without a track. */
export function removeTrack(project: Project, trackId: string): Project {
  if (!project.tracks.some((t) => t.id === trackId)) return project;
  const gone = project.instruments.filter((s) => s.trackId === trackId).map((s) => s.id);
  const matrix = { ...project.song.matrix };
  for (const id of gone) delete matrix[id];
  return touch(project, {
    tracks: project.tracks.filter((t) => t.id !== trackId),
    instruments: project.instruments.filter((s) => s.trackId !== trackId),
    song: { ...project.song, matrix },
  });
}

export function moveTrack(project: Project, trackId: string, toIndex: number): Project {
  const from = project.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return project;
  const to = clamp(toIndex, 0, project.tracks.length - 1);
  if (to === from) return project;
  const tracks = [...project.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  return touch(project, { tracks });
}

export function updateTrack(project: Project, trackId: string, patch: Partial<Omit<Track, "id" | "clips">>): Project {
  if (!project.tracks.some((t) => t.id === trackId)) return project;
  return touch(project, { tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) });
}

export function renameTrack(project: Project, trackId: string, name: string): Project {
  const trimmed = name.trim();
  return trimmed ? updateTrack(project, trackId, { name: trimmed }) : project;
}

// Clips

export function addClip(project: Project, trackId: string, clip: Clip): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new ArrangeError("That track no longer exists.");
  if (!trackAccepts(track, clip.kind)) throw new ArrangeError(`A ${clip.kind} clip cannot go on a ${track.kind} track.`);
  const clean = sanitizeClip(project, clip);
  return touch(project, { tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clean] } : t)) });
}

export function updateClip(project: Project, clipId: string, patch: Partial<Omit<Clip, "id">>): Project {
  return mapClips(project, (c) => (c.id === clipId ? sanitizeClip(project, { ...c, ...patch }) : c));
}

export function updateClips(project: Project, clipIds: readonly string[], patch: Partial<Omit<Clip, "id" | "startBar" | "lengthBars">>): Project {
  const ids = new Set(clipIds);
  return mapClips(project, (c) => (ids.has(c.id) ? sanitizeClip(project, { ...c, ...patch }) : c));
}

export function removeClips(project: Project, clipIds: readonly string[]): Project {
  const ids = new Set(clipIds);
  let changed = false;
  const tracks = project.tracks.map((t) => {
    if (!t.clips.some((c) => ids.has(c.id))) return t;
    changed = true;
    return { ...t, clips: t.clips.filter((c) => !ids.has(c.id)) };
  });
  return changed ? touch(project, { tracks }) : project;
}

/** Moves one clip to an exact start bar and, optionally, another track that accepts it. */
export function moveClip(project: Project, clipId: string, to: { startBar?: number; trackId?: string }): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const target = to.trackId ? project.tracks.find((t) => t.id === to.trackId) : found.track;
  if (!target) throw new ArrangeError("That track no longer exists.");
  if (!trackAccepts(target, found.clip.kind)) throw new ArrangeError(`A ${found.clip.kind} clip cannot go on a ${target.kind} track.`);
  const moved = sanitizeClip(project, { ...found.clip, startBar: to.startBar ?? found.clip.startBar });
  const tracks = project.tracks.map((t) => {
    if (t.id === found.track.id && t.id === target.id) return { ...t, clips: t.clips.map((c) => (c.id === clipId ? moved : c)) };
    if (t.id === found.track.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    if (t.id === target.id) return { ...t, clips: [...t.clips, moved] };
    return t;
  });
  return touch(project, { tracks });
}

/**
 * Drags a selection: all clips shift together by `deltaBars` (never before bar 1) and by
 * `deltaTracks` rows where the destination track accepts them.
 */
export function moveClips(project: Project, clipIds: readonly string[], delta: { deltaBars: number; deltaTracks: number }): Project {
  const ids = new Set(clipIds);
  const located = [...ids].map((id) => findClip(project, id)).filter((l): l is ClipLocation => l !== undefined);
  if (located.length === 0) return project;
  const minStart = Math.min(...located.map((l) => l.clip.startBar));
  const deltaBars = Math.max(delta.deltaBars, 1 - minStart);
  const dest = new Map<string, string>();
  for (const l of located) {
    const candidate = project.tracks[clamp(l.trackIndex + delta.deltaTracks, 0, project.tracks.length - 1)];
    dest.set(l.clip.id, trackAccepts(candidate, l.clip.kind) ? candidate.id : l.track.id);
  }
  const tracks = project.tracks.map((t) => {
    const stay = t.clips.filter((c) => !ids.has(c.id));
    const arriving = located
      .filter((l) => dest.get(l.clip.id) === t.id)
      .map((l) => sanitizeClip(project, { ...l.clip, startBar: l.clip.startBar + deltaBars }));
    if (stay.length === t.clips.length && arriving.length === 0) return t;
    return { ...t, clips: [...stay, ...arriving] };
  });
  return touch(project, { tracks });
}

function shiftNotes(clip: Clip, deltaSteps: number, lengthSteps: number): Clip["notes"] {
  if (!clip.notes) return clip.notes;
  const notes: NonNullable<Clip["notes"]> = [];
  for (const n of clip.notes) {
    const from = n.startStep + deltaSteps;
    const to = from + n.lengthSteps;
    const cutFrom = Math.max(0, from);
    const cutTo = Math.min(lengthSteps, to);
    if (cutTo > cutFrom) notes.push({ ...n, startStep: cutFrom, lengthSteps: cutTo - cutFrom });
  }
  return notes;
}

/**
 * Drags the left or right edge of a clip to a bar. Dragging the left edge trims the source's head,
 * so the audio under the clip stays where it was; neither edge can reveal more source than exists.
 */
export function resizeClip(project: Project, clipId: string, edge: "start" | "end", toBar: number): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const { clip } = found;
  const min = minClipBars(project);
  const barSec = barSeconds(project);
  const rate = clipRate(project, clip);
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
  const hasSource = (clip.kind === "audio" || clip.kind === "video") && asset?.durationSec !== undefined;
  const sourceBars = (sec: number) => sec / (barSec * rate);

  let next: Clip;
  if (edge === "end") {
    let length = Math.max(min, toBar - clip.startBar);
    if (hasSource) length = Math.min(length, Math.max(min, sourceBars(asset.durationSec! - clip.offsetSec)));
    next = { ...clip, lengthBars: length };
  } else {
    const end = clipEndBar(clip);
    let start = clamp(toBar, 1, end - min);
    if (hasSource) start = Math.max(start, clip.startBar - sourceBars(clip.offsetSec));
    const delta = start - clip.startBar;
    next = {
      ...clip,
      startBar: start,
      lengthBars: end - start,
      offsetSec: hasSource ? clip.offsetSec + delta * barSec * rate : clip.offsetSec,
      notes: clip.kind === "midi" ? shiftNotes(clip, -delta * stepsPerBar(project), (end - start) * stepsPerBar(project)) : clip.notes,
    };
  }
  if (clip.kind === "midi" && edge === "end") next = { ...next, notes: shiftNotes(next, 0, next.lengthBars * stepsPerBar(project)) };
  return replaceClip(project, found, sanitizeClip(project, next));
}

function replaceClip(project: Project, found: ClipLocation, clip: Clip): Project {
  return touch(project, {
    tracks: project.tracks.map((t) => (t.id === found.track.id ? { ...t, clips: t.clips.map((c) => (c.id === clip.id ? clip : c)) } : t)),
  });
}

export function canSplit(project: Project, clip: Clip, atBar: number): boolean {
  const min = minClipBars(project);
  return atBar >= clip.startBar + min && atBar <= clipEndBar(clip) - min;
}

/** Splits at a bar. Both halves keep their share of the source, so playing them back to back sounds identical. */
export function splitClip(project: Project, clipId: string, atBar: number): { project: Project; ids: string[] } {
  const found = findClip(project, clipId);
  if (!found || !canSplit(project, found.clip, atBar)) return { project, ids: [] };
  const { clip } = found;
  const leftBars = atBar - clip.startBar;
  const rightBars = clipEndBar(clip) - atBar;
  const spb = stepsPerBar(project);
  const leftSteps = leftBars * spb;
  const consumedSec = leftBars * barSeconds(project) * clipRate(project, clip);
  const hasSource = clip.kind === "audio" || clip.kind === "video";

  const left: Clip = {
    ...clip,
    lengthBars: leftBars,
    fadeOutSteps: 0,
    notes: clip.kind === "midi" ? shiftNotes(clip, 0, leftSteps) : clip.notes,
  };
  const right: Clip = {
    ...clip,
    id: newId("clip"),
    startBar: atBar,
    lengthBars: rightBars,
    offsetSec: hasSource ? clip.offsetSec + consumedSec : clip.offsetSec,
    fadeInSteps: 0,
    notes: clip.kind === "midi" ? shiftNotes(clip, -leftSteps, rightBars * spb) : clip.notes,
  };
  const cleanLeft = sanitizeClip(project, left);
  const cleanRight = sanitizeClip(project, right);
  const next = touch(project, {
    tracks: project.tracks.map((t) =>
      t.id === found.track.id ? { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [cleanLeft, cleanRight] : [c])) } : t,
    ),
  });
  return { project: next, ids: [cleanLeft.id, cleanRight.id] };
}

/** Cuts the head off a clip up to a bar, keeping the tail where it is. */
export function trimToBar(project: Project, clipId: string, atBar: number): Project {
  const found = findClip(project, clipId);
  if (!found || !canSplit(project, found.clip, atBar)) return project;
  return resizeClip(project, clipId, "start", atBar);
}

/** Each copy lands right after its original; a selection is shifted as one block so its shape is kept. */
export function duplicateClips(project: Project, clipIds: readonly string[]): { project: Project; ids: string[] } {
  const located = clipIds.map((id) => findClip(project, id)).filter((l): l is ClipLocation => l !== undefined);
  if (located.length === 0) return { project, ids: [] };
  const start = Math.min(...located.map((l) => l.clip.startBar));
  const end = Math.max(...located.map((l) => clipEndBar(l.clip)));
  const shift = end - start;
  const copies = located.map((l) => ({
    trackId: l.track.id,
    clip: sanitizeClip(project, { ...l.clip, id: newId("clip"), startBar: l.clip.startBar + shift }),
  }));
  const tracks = project.tracks.map((t) => {
    const add = copies.filter((c) => c.trackId === t.id).map((c) => c.clip);
    return add.length ? { ...t, clips: [...t.clips, ...add] } : t;
  });
  return { project: touch(project, { tracks }), ids: copies.map((c) => c.clip.id) };
}

export interface ClipboardItem {
  clip: Clip;
  trackId: string;
}

export function copyClips(project: Project, clipIds: readonly string[]): ClipboardItem[] {
  return clipIds
    .map((id) => findClip(project, id))
    .filter((l): l is ClipLocation => l !== undefined)
    .map((l) => ({ clip: l.clip, trackId: l.track.id }));
}

/**
 * Pastes at a bar. Clips go to `targetTrackId` when they all came from one track and it accepts
 * them, otherwise back to their own track, otherwise to the first track that accepts them; if
 * there is none a new track is made.
 */
export function pasteClips(
  project: Project,
  items: readonly ClipboardItem[],
  atBar: number,
  targetTrackId?: string,
): { project: Project; ids: string[] } {
  if (items.length === 0) return { project, ids: [] };
  const first = Math.min(...items.map((i) => i.clip.startBar));
  const shift = Math.max(1, atBar) - first;
  const singleSource = new Set(items.map((i) => i.trackId)).size === 1;
  let next = project;
  const ids: string[] = [];
  for (const item of items) {
    const preferred = singleSource && targetTrackId ? next.tracks.find((t) => t.id === targetTrackId) : undefined;
    const original = next.tracks.find((t) => t.id === item.trackId);
    let dest = [preferred, original].find((t) => t && trackAccepts(t, item.clip.kind)) ?? next.tracks.find((t) => trackAccepts(t, item.clip.kind));
    if (!dest) {
      dest = makeTrack(next, trackKindForClip(item.clip.kind));
      next = addTrack(next, dest);
    }
    const copy = sanitizeClip(next, { ...item.clip, id: newId("clip"), startBar: item.clip.startBar + shift });
    next = addClip(next, dest.id, copy);
    ids.push(copy.id);
  }
  return { project: next, ids };
}

export function setLoop(project: Project, loop: Partial<Project["loop"]>): Project {
  const merged = { ...project.loop, ...loop };
  const min = minClipBars(project);
  const startBar = Math.max(1, merged.startBar);
  const endBar = Math.max(startBar + min, merged.endBar);
  return touch(project, { loop: { on: merged.on, startBar, endBar } });
}

import { newId, type Clip, type Note, type Project, type Track } from "../../../project/model";

/** Shortest piece an edit may leave behind, so a stray click cannot create an inaudible sliver. */
export const MIN_CLIP_SEC = 0.05;
export const MIN_WARP_RATIO = 0.5;
export const MAX_WARP_RATIO = 2;

export class ClipEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipEditError";
  }
}

export interface TimeBase {
  bpm: number;
  beatsPerBar: number;
}

export function barSeconds(t: TimeBase): number {
  return (t.beatsPerBar * 60) / t.bpm;
}

export function stepSeconds(t: TimeBase): number {
  return 60 / t.bpm / 4;
}

export function clipSeconds(clip: Clip, t: TimeBase): number {
  return clip.lengthBars * barSeconds(t);
}

export function clipSteps(clip: Clip, t: TimeBase): number {
  return Math.round(clip.lengthBars * t.beatsPerBar * 4);
}

/** How many source seconds one timeline second of the clip consumes. */
export function warpRatio(clip: Clip, detectedBpm: number | undefined, projectBpm: number): number {
  if (!clip.warp || !detectedBpm) return 1;
  return Math.min(MAX_WARP_RATIO, Math.max(MIN_WARP_RATIO, projectBpm / detectedBpm));
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

/** Swaps one clip for zero or more clips, keeping the track's clips ordered by start. */
export function replaceClip(project: Project, clipId: string, replacements: readonly Clip[]): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      if (!track.clips.some((c) => c.id === clipId)) return track;
      const clips = track.clips.flatMap((c) => (c.id === clipId ? replacements : [c]));
      return { ...track, clips: [...clips].sort((a, b) => a.startBar - b.startBar) };
    }),
  };
}

export function patchClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  const found = findClip(project, clipId);
  return found ? replaceClip(project, clipId, [{ ...found.clip, ...patch }]) : project;
}

function clampFades(clip: Clip, t: TimeBase): Clip {
  const total = clipSteps(clip, t);
  const fadeInSteps = Math.min(Math.max(0, clip.fadeInSteps), total);
  const fadeOutSteps = Math.min(Math.max(0, clip.fadeOutSteps), Math.max(0, total - fadeInSteps));
  return { ...clip, fadeInSteps, fadeOutSteps };
}

/**
 * The part of a clip between two clip-local timeline seconds, as a clip of its own.
 * A reversed clip plays its window backwards, so the timeline's first half is the source window's second half.
 */
export function slice(clip: Clip, fromSec: number, toSec: number, ratio: number, t: TimeBase): Clip {
  const bar = barSeconds(t);
  const total = clipSeconds(clip, t);
  const windowSec = total * ratio;
  const offsetSec = clip.reversed ? clip.offsetSec + windowSec - toSec * ratio : clip.offsetSec + fromSec * ratio;
  const keepsHead = fromSec <= 1e-9;
  const keepsTail = toSec >= total - 1e-9;
  return clampFades(
    {
      ...clip,
      startBar: clip.startBar + fromSec / bar,
      lengthBars: (toSec - fromSec) / bar,
      offsetSec: Math.max(0, offsetSec),
      fadeInSteps: keepsHead ? clip.fadeInSteps : 0,
      fadeOutSteps: keepsTail ? clip.fadeOutSteps : 0,
      notes: clip.notes ? sliceNotes(clip.notes, fromSec / stepSeconds(t), toSec / stepSeconds(t)) : undefined,
    },
    t,
  );
}

function sliceNotes(notes: readonly Note[], fromStep: number, toStep: number): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    const start = Math.max(n.startStep, fromStep);
    const end = Math.min(n.startStep + n.lengthSteps, toStep);
    if (end - start >= 1) out.push({ ...n, startStep: start - fromStep, lengthSteps: end - start });
  }
  return out;
}

function inside(clip: Clip, t: TimeBase, sec: number): boolean {
  return sec >= MIN_CLIP_SEC && sec <= clipSeconds(clip, t) - MIN_CLIP_SEC;
}

/** Two clips meeting at `atSec`; undefined when the cut would leave a sliver. */
export function splitAt(clip: Clip, atSec: number, ratio: number, t: TimeBase): [Clip, Clip] | undefined {
  if (!inside(clip, t, atSec)) return undefined;
  const total = clipSeconds(clip, t);
  const left = slice(clip, 0, atSec, ratio, t);
  const right = { ...slice(clip, atSec, total, ratio, t), id: newId("clip") };
  return [left, right];
}

/** Removes a range and closes the gap, so what follows plays straight after what came before. */
export function cutOut(clip: Clip, fromSec: number, toSec: number, ratio: number, t: TimeBase): Clip[] | undefined {
  const total = clipSeconds(clip, t);
  const a = Math.max(0, Math.min(fromSec, toSec));
  const b = Math.min(total, Math.max(fromSec, toSec));
  if (b - a < MIN_CLIP_SEC) return undefined;
  const pieces: Clip[] = [];
  if (a >= MIN_CLIP_SEC) pieces.push(slice(clip, 0, a, ratio, t));
  if (total - b >= MIN_CLIP_SEC) {
    const tail = slice(clip, b, total, ratio, t);
    const closed = pieces.length ? { ...tail, id: newId("clip"), startBar: clip.startBar + a / barSeconds(t) } : tail;
    pieces.push(closed);
  }
  return pieces.length ? pieces : undefined;
}

export function keepSelection(clip: Clip, fromSec: number, toSec: number, ratio: number, t: TimeBase): Clip | undefined {
  const total = clipSeconds(clip, t);
  const a = Math.max(0, Math.min(fromSec, toSec));
  const b = Math.min(total, Math.max(fromSec, toSec));
  if (b - a < MIN_CLIP_SEC) return undefined;
  return slice(clip, a, b, ratio, t);
}

/** A copy placed straight after the original. */
export function duplicate(clip: Clip): Clip {
  return {
    ...clip,
    id: newId("clip"),
    name: clip.name.endsWith(" copy") ? clip.name : `${clip.name} copy`,
    startBar: clip.startBar + clip.lengthBars,
    notes: clip.notes?.map((n) => ({ ...n })),
  };
}

/** Swapping the fades keeps each one at the same audible end of the sound. */
export function reverse(clip: Clip): Clip {
  return { ...clip, reversed: !clip.reversed, fadeInSteps: clip.fadeOutSteps, fadeOutSteps: clip.fadeInSteps };
}

/**
 * Moves a clip's start and end edges (clip-local seconds, negative start extends the head) without
 * reaching outside the source file.
 */
export function trimTo(clip: Clip, fromSec: number, toSec: number, ratio: number, sourceSec: number, t: TimeBase): Clip {
  const total = clipSeconds(clip, t);
  let a = fromSec;
  let b = toSec;
  const windowSec = total * ratio;
  // Source seconds available before and after the current window in the direction the timeline sees them.
  const before = clip.reversed ? sourceSec - clip.offsetSec - windowSec : clip.offsetSec;
  const after = clip.reversed ? clip.offsetSec : sourceSec - clip.offsetSec - windowSec;
  a = Math.max(a, -Math.max(0, before) / ratio);
  b = Math.min(b, total + Math.max(0, after) / ratio);
  if (b - a < MIN_CLIP_SEC) {
    if (a !== fromSec) a = b - MIN_CLIP_SEC;
    else b = a + MIN_CLIP_SEC;
  }
  const bar = barSeconds(t);
  const shiftedOffset = clip.reversed ? clip.offsetSec + windowSec - b * ratio : clip.offsetSec + a * ratio;
  return clampFades(
    {
      ...clip,
      startBar: clip.startBar + a / bar,
      lengthBars: (b - a) / bar,
      offsetSec: Math.max(0, shiftedOffset),
    },
    t,
  );
}

export function setFade(clip: Clip, side: "in" | "out", steps: number, t: TimeBase): Clip {
  const total = clipSteps(clip, t);
  const other = side === "in" ? clip.fadeOutSteps : clip.fadeInSteps;
  const value = Math.round(Math.min(Math.max(0, steps), Math.max(0, total - other)));
  return side === "in" ? { ...clip, fadeInSteps: value } : { ...clip, fadeOutSteps: value };
}

export function setPitch(clip: Clip, semitones: number, cents: number): Clip {
  return {
    ...clip,
    pitchSemitones: Math.min(12, Math.max(-12, Math.round(semitones))),
    fineCents: Math.min(50, Math.max(-50, Math.round(cents))),
  };
}

/**
 * Changes the tempo the asset is believed to have. Clips that follow the project tempo are rescaled so
 * the same audio still fills them, because their playback speed changes with the detected tempo.
 */
export function setAssetBpm(project: Project, assetId: string, bpm: number): Project {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) return project;
  const next = Math.min(300, Math.max(30, bpm));
  const before = asset.detectedBpm;
  return {
    ...project,
    assets: project.assets.map((a) => (a.id === assetId ? { ...a, detectedBpm: next } : a)),
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) =>
        before && c.assetId === assetId && c.warp ? { ...c, lengthBars: (c.lengthBars * next) / before } : c,
      ),
    })),
  };
}

// Notes

export const MIN_PITCH = 0;
export const MAX_PITCH = 127;
export type NoteGrid = 1 | 2 | 4;
export const DEFAULT_VELOCITY = 0.75;

function clampNote(n: Note, totalSteps: number): Note {
  const startStep = Math.min(Math.max(0, n.startStep), Math.max(0, totalSteps - 1));
  return {
    pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.round(n.pitch))),
    startStep,
    lengthSteps: Math.max(1, Math.min(n.lengthSteps, totalSteps - startStep)),
    velocity: Math.min(1, Math.max(0.01, n.velocity)),
  };
}

export function snapStep(step: number, grid: NoteGrid): number {
  return Math.round(step / grid) * grid;
}

/** Index of the note covering a cell, or -1. */
export function noteAt(notes: readonly Note[], pitch: number, step: number): number {
  return notes.findIndex((n) => n.pitch === pitch && step >= n.startStep && step < n.startStep + n.lengthSteps);
}

export function addNote(notes: readonly Note[], note: Note, totalSteps: number): Note[] {
  return [...notes, clampNote(note, totalSteps)];
}

export function removeNote(notes: readonly Note[], index: number): Note[] {
  return notes.filter((_, i) => i !== index);
}

export function moveNote(notes: readonly Note[], index: number, pitch: number, startStep: number, totalSteps: number): Note[] {
  return notes.map((n, i) => (i === index ? clampNote({ ...n, pitch, startStep }, totalSteps) : n));
}

export function resizeNote(notes: readonly Note[], index: number, lengthSteps: number, totalSteps: number): Note[] {
  return notes.map((n, i) => (i === index ? clampNote({ ...n, lengthSteps }, totalSteps) : n));
}

export function setNoteVelocity(notes: readonly Note[], index: number, velocity: number): Note[] {
  return notes.map((n, i) => (i === index ? { ...n, velocity: Math.min(1, Math.max(0.01, velocity)) } : n));
}

/** Snaps every note start to the grid; lengths round to the grid too but never vanish. */
export function quantize(notes: readonly Note[], grid: NoteGrid, totalSteps: number): Note[] {
  return notes.map((n) => {
    const startStep = Math.min(snapStep(n.startStep, grid), Math.max(0, totalSteps - grid));
    const lengthSteps = Math.max(grid, Math.round(n.lengthSteps / grid) * grid);
    return clampNote({ ...n, startStep, lengthSteps }, totalSteps);
  });
}

/** Changing a midi clip's length drops or trims notes that no longer fit. */
export function setMidiLength(clip: Clip, lengthBars: number, t: TimeBase): Clip {
  const next = { ...clip, lengthBars };
  const total = clipSteps(next, t);
  const notes = (clip.notes ?? []).filter((n) => n.startStep < total).map((n) => clampNote(n, total));
  return clampFades({ ...next, notes }, t);
}

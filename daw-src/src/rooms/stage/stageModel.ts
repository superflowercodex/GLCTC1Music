import { newId, type Asset, type Clip, type Project, type StageClipOptions, type StageFit, type Track } from "../../project/model";

export const DEFAULT_STAGE_OPTIONS: StageClipOptions = { fit: "fill", opacity: 1, speed: 1 };
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
export const MAX_SHOW_BARS = 64;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function stageOptions(clip: Clip): StageClipOptions {
  const o = { ...DEFAULT_STAGE_OPTIONS, ...clip.stage };
  return { fit: o.fit, opacity: clamp(o.opacity, 0, 1), speed: clamp(o.speed, MIN_SPEED, MAX_SPEED) };
}

export function frameAspect(aspect: Project["stageAspect"]): number {
  return aspect === "wide" ? 16 / 9 : 9 / 16;
}

/** Media clips on video tracks by start bar; a later clip draws on top of an earlier one. */
export function stageClips(project: Project): Clip[] {
  return project.tracks
    .filter((t) => t.kind === "video")
    .flatMap((t) => t.clips.filter((c) => (c.kind === "video" || c.kind === "image") && c.assetId))
    .sort((a, b) => a.startBar - b.startBar);
}

export function barSeconds(bpm: number, beatsPerBar: number): number {
  return (beatsPerBar * 60) / bpm;
}

export function clipRangeSec(clip: Clip, bpm: number, beatsPerBar: number): { start: number; end: number } {
  const bar = barSeconds(bpm, beatsPerBar);
  return { start: (clip.startBar - 1) * bar, end: (clip.startBar - 1 + clip.lengthBars) * bar };
}

export function isActiveAt(clip: Clip, sec: number, bpm: number, beatsPerBar: number): boolean {
  const { start, end } = clipRangeSec(clip, bpm, beatsPerBar);
  return sec >= start && sec < end;
}

/** Position in the source file for a project time; a clip longer than its video loops the video. */
export function mediaTime(clip: Clip, sec: number, bpm: number, beatsPerBar: number, durationSec?: number): number {
  const { start } = clipRangeSec(clip, bpm, beatsPerBar);
  const t = Math.max(0, sec - start) * stageOptions(clip).speed + clip.offsetSec;
  return durationSec && durationSec > 0 ? t % durationSec : t;
}

/** Size of a media plane inside a frame that is `frameAspect` wide and 1 tall. */
export function planeSize(fit: StageFit, mediaAspect: number, frame: number): { w: number; h: number } {
  if (fit === "stretch") return { w: frame, h: 1 };
  const wider = mediaAspect > frame;
  const cover = fit === "fill";
  if (wider === cover) return { w: mediaAspect, h: 1 };
  return { w: frame, h: frame / mediaAspect };
}

export function timelineEndBar(project: Project): number {
  return stageClips(project).reduce((end, c) => Math.max(end, c.startBar + c.lengthBars), 1);
}

export function defaultClipBars(asset: Asset, bpm: number, beatsPerBar: number): number {
  if (asset.kind !== "video" || !asset.durationSec) return 4;
  return clamp(Math.ceil(asset.durationSec / barSeconds(bpm, beatsPerBar)), 1, MAX_SHOW_BARS);
}

/** Adds an asset as a stage clip on the first video track, creating the track when the project has none. */
export function addStageClip(project: Project, asset: Asset, startBar: number): Project {
  if (asset.kind !== "video" && asset.kind !== "image") throw new RangeError(`"${asset.name}" is not a video or a picture.`);
  const clip: Clip = {
    id: newId("clip"),
    kind: asset.kind,
    name: asset.name,
    startBar,
    lengthBars: defaultClipBars(asset, project.bpm, project.beatsPerBar),
    assetId: asset.id,
    offsetSec: 0,
    gainDb: 0,
    pitchSemitones: 0,
    fineCents: 0,
    warp: false,
    keyLock: false,
    fadeInSteps: 0,
    fadeOutSteps: 0,
    stage: { ...DEFAULT_STAGE_OPTIONS },
  };
  const existing = project.tracks.find((t) => t.kind === "video");
  if (existing) {
    return { ...project, tracks: project.tracks.map((t) => (t === existing ? { ...t, clips: [...t.clips, clip] } : t)) };
  }
  const track: Track = {
    id: newId("trk"),
    name: "Visuals",
    kind: "video",
    color: "#ff63d8",
    muted: false,
    solo: false,
    gainDb: 0,
    pan: 0,
    sends: { reverb: 0, delay: 0 },
    inserts: [],
    cue: false,
    toMaster: false,
    clips: [clip],
    automation: [],
  };
  return { ...project, tracks: [...project.tracks, track] };
}

export function updateStageClip(project: Project, clipId: string, change: (clip: Clip) => Clip): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? change(c) : c)) } : t)),
  };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

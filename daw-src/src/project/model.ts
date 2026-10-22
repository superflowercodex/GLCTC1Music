import type { InstrumentKind, InstrumentState } from "../audio/types";

export type TrackKind = "audio" | "instrument" | "video" | "fx";
export type ClipKind = "audio" | "pattern" | "midi" | "video" | "image";

/** A piano-roll note. Positions are in 16th steps from the clip start. */
export interface Note {
  pitch: number;
  startStep: number;
  lengthSteps: number;
  velocity: number;
}

export interface Clip {
  id: string;
  kind: ClipKind;
  name: string;
  /** 1-based bar the clip starts on, matching what the ruler shows. */
  startBar: number;
  lengthBars: number;
  /** Media asset for audio, video and image clips. */
  assetId?: string;
  /** Seconds into the source where playback starts (trim). */
  offsetSec: number;
  gainDb: number;
  pitchSemitones: number;
  fineCents: number;
  /** Stretch to the project tempo using the clip's detected tempo. */
  warp: boolean;
  keyLock: boolean;
  fadeInSteps: number;
  fadeOutSteps: number;
  /** Plays the trimmed window backwards. */
  reversed?: boolean;
  /** Notes for midi clips. */
  notes?: Note[];
  /** Which pattern an instrument clip plays, so the song and the clip agree. */
  patternIndex?: number;
  /** Stage options for video and image clips. */
  stage?: StageClipOptions;
}

export type StageFit = "fill" | "fit" | "stretch";

export interface StageClipOptions {
  fit: StageFit;
  /** 0 to 1. */
  opacity: number;
  /** Playback rate for video, 0.25 to 4. */
  speed: number;
}

export type InsertType = "compressor" | "eq" | "saturator" | "filter" | "chorus" | "delay" | "reverb" | "gate" | "deesser";

export interface Insert {
  id: string;
  type: InsertType;
  params: Record<string, number>;
  bypass: boolean;
}

export interface AutomationPoint {
  /** Position in beats from the project start. */
  beat: number;
  /** Normalised 0 to 1. */
  value: number;
}

export interface AutomationLane {
  id: string;
  /** What it moves: "<trackId>.gain", "<trackId>.pan", "<slotId>.<paramId>" or "master.<param>". */
  target: string;
  points: AutomationPoint[];
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  /** Set for instrument tracks: the instrument slot this track plays. */
  slotId?: string;
  muted: boolean;
  solo: boolean;
  gainDb: number;
  pan: number;
  /** Send amounts 0 to 1 into the shared reverb and delay. */
  sends: { reverb: number; delay: number };
  inserts: Insert[];
  /** Listen to this track in the headphones. */
  cue: boolean;
  toMaster: boolean;
  clips: Clip[];
  automation: AutomationLane[];
}

export interface Asset {
  id: string;
  kind: "audio" | "video" | "image" | "midi";
  name: string;
  mime: string;
  bytes: number;
  durationSec?: number;
  detectedBpm?: number;
  detectedKey?: string;
  addedAt: number;
}

export interface InstrumentSlot {
  id: string;
  kind: InstrumentKind;
  trackId: string;
  state: InstrumentState;
}

export type SongPattern = 0 | 1 | 2 | 3 | 4;

export type SectionKind = "intro" | "build" | "drop" | "break" | "outro";

export interface SongSection {
  id: string;
  name: string;
  bars: number;
  /** Drives the energy curve and colour; sections made by hand may omit it. */
  kind?: SectionKind;
}

export interface Song {
  sections: SongSection[];
  /** matrix[slotId][sectionIndex]: 0 is off, 1 to 4 are patterns A to D. */
  matrix: Record<string, SongPattern[]>;
  /** Per instrument slot, 0 to 1; missing means the default level. */
  levels?: Record<string, number>;
}

export interface MasterSettings {
  gainDb: number;
  limiter: boolean;
  filterHz: number;
  filterOn: boolean;
  delayMix: number;
  delayOn: boolean;
  reverbMix: number;
  reverbOn: boolean;
  headphoneDeviceId: string;
  headphoneVolume: number;
  boothDeviceId: string;
  boothVolume: number;
}

export interface Project {
  /** Schema version, bumped whenever the shape changes; migrate.ts upgrades older ones. */
  v: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  beatsPerBar: number;
  key: string;
  loop: { on: boolean; startBar: number; endBar: number };
  tracks: Track[];
  assets: Asset[];
  instruments: InstrumentSlot[];
  song: Song;
  master: MasterSettings;
  stageAspect: "wide" | "phone";
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newProject(name = "Untitled"): Project {
  const now = Date.now();
  return {
    v: 1,
    id: newId("proj"),
    name,
    createdAt: now,
    updatedAt: now,
    bpm: 120,
    beatsPerBar: 4,
    key: "C major",
    loop: { on: false, startBar: 1, endBar: 5 },
    tracks: [],
    assets: [],
    instruments: [],
    song: { sections: [], matrix: {} },
    master: {
      gainDb: 0,
      limiter: true,
      filterHz: 20000,
      filterOn: false,
      delayMix: 0.2,
      delayOn: false,
      reverbMix: 0.25,
      reverbOn: false,
      headphoneDeviceId: "default",
      headphoneVolume: 0.8,
      boothDeviceId: "default",
      boothVolume: 0.8,
    },
    stageAspect: "wide",
  };
}

import { newId, type Clip, type Project, type SectionKind, type Song, type SongPattern, type SongSection } from "../../project/model";

export type TemplateId = "16" | "32" | "64" | "club";

export interface Template {
  id: TemplateId;
  label: string;
  sections: ReadonlyArray<readonly [name: string, bars: number, kind: SectionKind]>;
}

export const TEMPLATES: readonly Template[] = [
  { id: "16", label: "16 bars", sections: [["Intro", 4, "intro"], ["Build", 4, "build"], ["Drop", 4, "drop"], ["Outro", 4, "outro"]] },
  {
    id: "32",
    label: "32",
    sections: [["Intro", 4, "intro"], ["Build", 4, "build"], ["Drop", 8, "drop"], ["Break", 4, "break"], ["Drop 2", 8, "drop"], ["Outro", 4, "outro"]],
  },
  {
    id: "64",
    label: "64",
    sections: [
      ["Intro", 8, "intro"], ["Build", 8, "build"], ["Drop", 8, "drop"], ["Break", 8, "break"],
      ["Build 2", 8, "build"], ["Drop 2", 16, "drop"], ["Outro", 8, "outro"],
    ],
  },
  {
    id: "club",
    label: "36 · Club",
    sections: [["Intro", 4, "intro"], ["Build", 8, "build"], ["Drop", 8, "drop"], ["Break", 4, "break"], ["Drop 2", 8, "drop"], ["Outro", 4, "outro"]],
  },
];

export const KIND_COLOR: Record<SectionKind, string> = {
  intro: "#79ebff",
  build: "#8e7cff",
  drop: "#ff63d8",
  break: "#7cf0c0",
  outro: "#ffd36a",
};

/** Energy at the start and end of a section, 0 to 1; the ribbon draws a ramp between them. */
export const KIND_ENERGY: Record<SectionKind, readonly [number, number]> = {
  intro: [0.15, 0.3],
  build: [0.3, 0.8],
  drop: [0.95, 0.9],
  break: [0.4, 0.25],
  outro: [0.5, 0.1],
};

export const PATTERN_LETTERS = ["", "A", "B", "C", "D"] as const;
export const DEFAULT_LEVEL = 0.7;

export function templateSections(id: TemplateId): SongSection[] {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new RangeError(`Unknown song template "${id}"`);
  return template.sections.map(([name, bars, kind], i) => ({ id: `sec-${i + 1}`, name, bars, kind }));
}

export function totalBars(sections: readonly SongSection[]): number {
  return sections.reduce((sum, s) => sum + s.bars, 0);
}

/** 1-based bar each section starts on. */
export function sectionStarts(sections: readonly SongSection[]): number[] {
  const starts: number[] = [];
  let bar = 1;
  for (const s of sections) {
    starts.push(bar);
    bar += s.bars;
  }
  return starts;
}

/** Index of the section that owns a 1-based bar, or -1 outside the song. */
export function sectionAtBar(sections: readonly SongSection[], bar: number): number {
  const starts = sectionStarts(sections);
  for (let i = sections.length - 1; i >= 0; i--) if (bar >= starts[i] && bar < starts[i] + sections[i].bars) return i;
  return -1;
}

export function sectionEnergy(section: SongSection): readonly [number, number] {
  return KIND_ENERGY[section.kind ?? "drop"];
}

/** Heights of `n` bars under a section's ramp, with a small deterministic ripple so the ribbon reads as music. */
export function energyCurve(section: SongSection, n: number): number[] {
  const [from, to] = sectionEnergy(section);
  return Array.from({ length: n }, (_, k) => {
    const t = n <= 1 ? 0 : k / (n - 1);
    const e = from + (to - from) * t + Math.sin(k * 1.9) * 0.04;
    return Math.min(1, Math.max(0.04, e));
  });
}

export function cyclePattern(value: SongPattern, patternCount: number): SongPattern {
  const max = Math.min(4, Math.max(0, patternCount));
  return ((value + 1) % (max + 1)) as SongPattern;
}

/**
 * Carries a matrix over to new sections: a section takes the cells of the old section of the same
 * kind and occurrence (the second drop keeps the second drop's patterns), and anything without a
 * counterpart is off. Cells beyond an instrument's pattern count are cleared.
 */
export function remapMatrix(
  oldSections: readonly SongSection[],
  newSections: readonly SongSection[],
  matrix: Song["matrix"],
  patternCounts: Readonly<Record<string, number>>,
): Song["matrix"] {
  const byKind = (sections: readonly SongSection[]) => {
    const seen = new Map<string, number>();
    return sections.map((s) => {
      const kind = s.kind ?? s.name;
      const n = seen.get(kind) ?? 0;
      seen.set(kind, n + 1);
      return `${kind}#${n}`;
    });
  };
  const oldKeys = byKind(oldSections);
  const newKeys = byKind(newSections);
  const next: Song["matrix"] = {};
  for (const [slotId, row] of Object.entries(matrix)) {
    const limit = patternCounts[slotId] ?? 4;
    next[slotId] = newKeys.map((key) => {
      const from = oldKeys.indexOf(key);
      const v = from === -1 ? 0 : (row[from] ?? 0);
      return (v > limit ? 0 : v) as SongPattern;
    });
  }
  return next;
}

export function levelToDb(level: number): number {
  return level <= 0.01 ? -60 : 20 * Math.log10(Math.min(1, level));
}

export function songDurationSec(song: Song, bpm: number, beatsPerBar: number): number {
  return totalBars(song.sections) * beatsPerBar * (60 / bpm);
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function slotHasPatterns(song: Song, slotId: string): boolean {
  return (song.matrix[slotId] ?? []).some((v) => v > 0);
}

/**
 * Pattern clips for one instrument: runs of the same pattern across neighbouring sections become one
 * clip, and off cells leave gaps, so clips can never overlap and always sit on section boundaries.
 */
export function matrixRowToClips(sections: readonly SongSection[], row: readonly SongPattern[], level: number): Clip[] {
  const clips: Clip[] = [];
  let bar = 1;
  sections.forEach((section, i) => {
    const value = row[i] ?? 0;
    const last = clips[clips.length - 1];
    if (value === 0) {
      bar += section.bars;
      return;
    }
    if (last && last.patternIndex === value - 1 && last.startBar + last.lengthBars === bar) {
      last.lengthBars += section.bars;
    } else {
      clips.push({
        id: newId("clip"),
        kind: "pattern",
        name: `Pattern ${PATTERN_LETTERS[value]}`,
        startBar: bar,
        lengthBars: section.bars,
        offsetSec: 0,
        gainDb: levelToDb(level),
        pitchSemitones: 0,
        fineCents: 0,
        warp: false,
        keyLock: false,
        fadeInSteps: 0,
        fadeOutSteps: 0,
        patternIndex: value - 1,
      });
    }
    bar += section.bars;
  });
  return clips;
}

/**
 * Writes the song's matrix onto the instrument tracks. Only pattern clips on tracks the matrix
 * covers are replaced, so audio, midi and video clips the user placed by hand survive.
 */
export function applySongToProject(project: Project): Project {
  const { sections, matrix, levels = {} } = project.song;
  const covered = new Map<string, string>();
  for (const slot of project.instruments) if (matrix[slot.id]) covered.set(slot.trackId, slot.id);
  return {
    ...project,
    updatedAt: Date.now(),
    tracks: project.tracks.map((track) => {
      const slotId = covered.get(track.id);
      if (!slotId) return track;
      const fresh = matrixRowToClips(sections, matrix[slotId], levels[slotId] ?? DEFAULT_LEVEL);
      return { ...track, clips: [...track.clips.filter((c) => c.kind !== "pattern"), ...fresh] };
    }),
  };
}

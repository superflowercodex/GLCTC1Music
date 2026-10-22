import type { InstrumentKind } from "../../audio/types";
import type { SectionKind, Song, SongPattern, SongSection } from "../../project/model";
import { templateSections, type TemplateId } from "./songModel";

export type GenreId = "techno" | "house" | "dnb" | "hiphop" | "ambient" | "pop";
export type Scale = "major" | "minor" | "phrygian";

export interface ComposerSlot {
  id: string;
  kind: InstrumentKind;
  patternCount: number;
}

export interface ComposeResult {
  genre: GenreId;
  genreMatched: boolean;
  bpm: number;
  bpmFromPrompt: boolean;
  key: string;
  scale: Scale;
  templateId: TemplateId;
  sections: SongSection[];
  matrix: Song["matrix"];
  levels: Record<string, number>;
  skipped: InstrumentKind[];
  seed: number;
  summary: string;
}

interface Genre {
  id: GenreId;
  label: string;
  words: readonly string[];
  bpm: number;
  roots: readonly string[];
  scale: Scale;
  skips: readonly InstrumentKind[];
}

const GENRES: readonly Genre[] = [
  { id: "techno", label: "Techno", words: ["techno", "warehouse", "industrial", "rave"], bpm: 130, roots: ["C", "F♯", "A", "D"], scale: "minor", skips: [] },
  { id: "house", label: "House", words: ["house", "tribal", "deep house", "disco", "groove"], bpm: 124, roots: ["A", "D", "G", "F"], scale: "minor", skips: [] },
  { id: "dnb", label: "Drum and bass", words: ["dnb", "drum and bass", "drum & bass", "jungle", "breakbeat"], bpm: 174, roots: ["F", "E", "G", "A"], scale: "minor", skips: ["vox"] },
  { id: "hiphop", label: "Hip hop", words: ["hip hop", "hip-hop", "hiphop", "trap", "boom bap", "rap"], bpm: 90, roots: ["C", "G", "A", "D"], scale: "minor", skips: ["lead0010110", "pad64"] },
  {
    id: "ambient",
    label: "Ambient",
    words: ["ambient", "meditation", "calm", "drone", "chill", "relax"],
    bpm: 80,
    roots: ["C", "D", "F", "A"],
    scale: "major",
    skips: ["looper", "drum80la8", "divine09", "acid30lee", "pad64"],
  },
  { id: "pop", label: "Pop", words: ["pop", "electronic", "synthwave", "dance", "anthem"], bpm: 118, roots: ["C", "G", "A", "E"], scale: "major", skips: [] },
];

type Role = "drums" | "perc" | "bass" | "lead" | "pad" | "vox" | "loop";

const ROLE: Record<InstrumentKind, Role> = {
  drum80la8: "drums",
  divine09: "perc",
  pad64: "perc",
  acid30lee: "bass",
  lead0010110: "lead",
  galacticOne: "pad",
  vox: "vox",
  looper: "loop",
};

const ROLE_LEVEL: Record<Role, number> = { drums: 0.82, perc: 0.6, bass: 0.74, lead: 0.62, pad: 0.55, vox: 0.58, loop: 0.48 };

/** Pattern letter (1 to 4, 0 off) per section kind; the second drop moves one letter on so it differs from the first. */
const PLAN: Record<Role, Record<SectionKind, number>> = {
  drums: { intro: 1, build: 2, drop: 3, break: 0, outro: 1 },
  perc: { intro: 0, build: 1, drop: 2, break: 0, outro: 0 },
  bass: { intro: 0, build: 1, drop: 2, break: 0, outro: 0 },
  lead: { intro: 0, build: 0, drop: 1, break: 2, outro: 0 },
  pad: { intro: 1, build: 2, drop: 1, break: 3, outro: 1 },
  vox: { intro: 0, build: 0, drop: 1, break: 1, outro: 0 },
  loop: { intro: 1, build: 1, drop: 1, break: 0, outro: 1 },
};

const DROP_ROLES_THAT_VARY: ReadonlySet<Role> = new Set(["drums", "lead", "perc"]);

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function containsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(text);
}

function detectGenre(text: string): Genre | undefined {
  let best: { genre: Genre; score: number } | undefined;
  for (const genre of GENRES) {
    const score = genre.words.filter((w) => containsWord(text, w)).length;
    if (score > 0 && (!best || score > best.score)) best = { genre, score };
  }
  return best?.genre;
}

function detectScale(text: string): Scale | undefined {
  if (/(major|happy|bright|uplift|euphor)/.test(text)) return "major";
  if (/(phrygian|spook|dark|menac)/.test(text)) return "phrygian";
  if (/(minor|sad|melanch)/.test(text)) return "minor";
  return undefined;
}

export function detectBpm(text: string): number | undefined {
  const match =
    /(\d{2,3})(?:\.\d+)?\s*bpm/.exec(text) ??
    /\bbpm\s*(?:of|at|is|:|=)?\s*(\d{2,3})/.exec(text) ??
    /tempo\s*(?:of|at|is|:)?\s*(\d{2,3})/.exec(text) ??
    /\bat\s+(\d{2,3})(?![\d:.]*\s*(?:bars?|steps?|%|pm|am|hz|k))\b/.exec(text);
  if (!match) return undefined;
  return Math.min(300, Math.max(30, Number(match[1])));
}

function detectTemplate(text: string, fallback: TemplateId): TemplateId {
  const bars = /\b(16|32|64)\s*-?\s*bars?\b/.exec(text);
  if (bars) return bars[1] as TemplateId;
  if (/\b(club|demo|36)\b/.test(text)) return "club";
  if (/\b(short|quick)\b/.test(text)) return "16";
  if (/\b(long|epic|extended)\b/.test(text)) return "64";
  return fallback;
}

function skippedKinds(text: string, genre: Genre): Set<InstrumentKind> {
  const skip = new Set<InstrumentKind>(genre.skips);
  if (/(\b(no|without)\s+drums?\b|drumless)/.test(text)) for (const k of ["drum80la8", "divine09", "pad64", "looper"] as const) skip.add(k);
  if (/\bminimal/.test(text)) for (const k of ["lead0010110", "vox", "pad64"] as const) skip.add(k);
  if (/(acid|303)/.test(text)) skip.delete("acid30lee");
  if (/(vocal|vox|choir|sing|voice)/.test(text)) skip.delete("vox");
  return skip;
}

/**
 * Rule-based song writer: keywords in the description choose genre, scale, tempo, length and which
 * instruments sit out; the same text and instruments always give the same song. It is not AI.
 */
export function compose(prompt: string, slots: readonly ComposerSlot[], fallbackTemplate: TemplateId = "club"): ComposeResult {
  const text = prompt.toLowerCase().trim();
  const matchedGenre = detectGenre(text);
  const genre = matchedGenre ?? GENRES[0];
  const seed = hashString(text);
  const rng = mulberry32(seed);

  const scale = detectScale(text) ?? genre.scale;
  const root = genre.roots[Math.floor(rng() * genre.roots.length)];
  const promptBpm = detectBpm(text);
  const bpm = promptBpm ?? genre.bpm;
  const templateId = detectTemplate(text, fallbackTemplate);
  const sections = templateSections(templateId);
  const skip = skippedKinds(text, genre);

  const matrix: Song["matrix"] = {};
  const levels: Record<string, number> = {};
  // Break pad letter is the one place the seed changes the arrangement, so a re-run with a new wording sounds different.
  const breakPadAlt = rng() < 0.5;

  for (const slot of slots) {
    if (slot.patternCount <= 0 || skip.has(slot.kind)) continue;
    const role = ROLE[slot.kind];
    let dropsSeen = 0;
    matrix[slot.id] = sections.map((section): SongPattern => {
      const kind = section.kind ?? "drop";
      let letter = PLAN[role][kind];
      if (kind === "drop") {
        if (dropsSeen > 0 && DROP_ROLES_THAT_VARY.has(role)) letter += 1;
        dropsSeen += 1;
      }
      if (role === "pad" && kind === "break" && breakPadAlt) letter = 2;
      if (letter === 0) return 0;
      return Math.min(letter, slot.patternCount, 4) as SongPattern;
    });
    levels[slot.id] = genre.id === "ambient" && role === "pad" ? 0.8 : ROLE_LEVEL[role];
  }

  const skipped = [...new Set(slots.filter((s) => skip.has(s.kind)).map((s) => s.kind))];
  const key = `${root} ${scale}`;
  const used = Object.keys(matrix).length;
  const genrePart = matchedGenre ? `${genre.label} (from your words)` : "No genre word found, used Techno";
  const bpmPart = promptBpm !== undefined ? `${bpm} BPM from your text` : `${bpm} BPM (${genre.label} default)`;
  const summary =
    `Understood: ${genrePart}, ${bpmPart}, ${key}, ` +
    `${sections.reduce((n, s) => n + s.bars, 0)} bars, ${used} instrument${used === 1 ? "" : "s"}`;

  return { genre: genre.id, genreMatched: matchedGenre !== undefined, bpm, bpmFromPrompt: promptBpm !== undefined, key, scale, templateId, sections, matrix, levels, skipped, seed, summary };
}

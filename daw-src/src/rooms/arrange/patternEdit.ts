import type { InstrumentKind, InstrumentState } from "../../audio/types";
import type { AcidStep } from "../../audio/instruments/acid30lee";
import type { GPattern, GStep } from "../../audio/instruments/synth/patternGen";
import { VOICES_80LA8 } from "../../audio/instruments/drums/voices80la8";
import { VOICES_DIVINE } from "../../audio/instruments/drums/voicesDivine";
import { PAD_COLORS, PAD_KINDS } from "../../audio/instruments/drums/voicesPad";
import { setSlotState } from "../../project/actions";
import type { Clip, InstrumentSlot, Project } from "../../project/model";

/**
 * Pattern editing from Arrange, as pure functions on an instrument's saved state. The live
 * instrument is written from the result (patternLive.ts), so the state stays the one source of truth
 * that is saved, undone and drawn on the clips.
 */

export type PatternFamily = "drums" | "acid" | "galactic" | "lead" | "none";

export class PatternEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatternEditError";
  }
}

export const PATTERN_LETTERS = "ABCDEFGHIJKLMNOP";
export const patternLetter = (index: number): string => PATTERN_LETTERS[index] ?? String(index + 1);

const DRUM_PATTERNS = 4;
const ACID_PATTERNS = 4;
const DIVINE_LENGTHS = [16, 32, 64, 128] as const;
const PAD_BARS = [1, 2, 3, 4] as const;
export const DRUM_STEP_ON = { drum80la8: 0.84, divine09: 1, pad64: 1 } as const;
/** 80LA8 velocities a Shift-tap walks through on a lit step. */
const VELOCITY_CYCLE = [0.84, 1, 0.5] as const;

export function patternFamily(kind: InstrumentKind): PatternFamily {
  if (kind === "drum80la8" || kind === "divine09" || kind === "pad64") return "drums";
  if (kind === "acid30lee") return "acid";
  if (kind === "galacticOne") return "galactic";
  if (kind === "lead0010110") return "lead";
  return "none";
}

type Data = Record<string, unknown>;

function dataOf(state: InstrumentState): Data {
  return typeof state.data === "object" && state.data !== null ? (state.data as Data) : {};
}

function patternsOf(state: InstrumentState): unknown[] {
  const list = dataOf(state).patterns;
  return Array.isArray(list) ? list : [];
}

export function patternCount(state: InstrumentState): number {
  const family = patternFamily(state.kind);
  if (family === "drums") return DRUM_PATTERNS;
  if (family === "acid") return ACID_PATTERNS;
  if (family === "galactic") return patternsOf(state).length;
  if (family === "lead") return 1;
  return 0;
}

/** One pattern's content: voice rows for drums, steps for 30LEE, `{len, steps}` for Galactic One, degrees and accents for 0010110. */
export function getPattern(state: InstrumentState, index: number): unknown {
  if (patternFamily(state.kind) === "lead") {
    const d = dataOf(state);
    return index === 0 ? { steps: d.steps, accents: d.accents } : undefined;
  }
  return patternsOf(state)[index];
}

export function withPattern(state: InstrumentState, index: number, pattern: unknown): InstrumentState {
  if (index < 0 || index >= patternCount(state)) throw new PatternEditError(`There is no pattern ${patternLetter(index)} on this instrument.`);
  const data = dataOf(state);
  if (patternFamily(state.kind) === "lead") {
    const p = pattern as { steps: unknown; accents: unknown };
    return { ...state, data: { ...data, steps: p.steps, accents: p.accents } };
  }
  const patterns = [...patternsOf(state)];
  patterns[index] = pattern;
  return { ...state, data: { ...data, patterns } };
}

/** The live instrument keeps everything else (knobs, samples, the playing pattern); only pattern content follows `target`. */
export function mergePatterns(live: InstrumentState, target: InstrumentState): InstrumentState {
  const t = dataOf(target);
  const keys = patternFamily(live.kind) === "lead" ? ["steps", "accents"] : ["patterns"];
  const data = { ...dataOf(live) };
  for (const k of keys) if (k in t) data[k] = t[k];
  return { ...live, data };
}

export function isPatternEmpty(kind: InstrumentKind, pattern: unknown): boolean {
  const family = patternFamily(kind);
  if (pattern === undefined || pattern === null) return true;
  if (family === "drums") return (pattern as number[][]).every((row) => Array.isArray(row) && row.every((v) => !(Number(v) > 0)));
  if (family === "acid") return (pattern as AcidStep[]).every((s) => !s?.on);
  if (family === "galactic") {
    const p = pattern as GPattern;
    return !Array.isArray(p.steps) || p.steps.slice(0, p.len).every((s) => !s?.on);
  }
  if (family === "lead") return !((pattern as { steps?: number[] }).steps ?? []).some((d) => d > 0);
  return true;
}

// Drums --------------------------------------------------------------------------------------

export interface DrumRow {
  label: string;
  /** The voice name when the label is a pad number (PAD-64 pads that share a sound). */
  sub?: string;
  color: string;
}

export function drumRows(state: InstrumentState): DrumRow[] {
  if (state.kind === "drum80la8") return VOICES_80LA8.map((v) => ({ label: v.name, color: v.color }));
  if (state.kind === "divine09") return VOICES_DIVINE.map((v) => ({ label: v.name, color: v.color }));
  if (state.kind === "pad64") {
    const kinds = Array.from({ length: 16 }, (_, i) => Math.round(state.values[`v${i}.kind`] ?? i));
    // Twelve rows all called "Warm bass" tell you nothing: shared sounds are numbered, the sound named beside.
    return kinds.map((kind, i) => {
      const name = PAD_KINDS[kind] ?? "Pad";
      const color = PAD_COLORS[kind] ?? "#79ebff";
      const shared = kinds.filter((k) => k === kind).length > 1;
      return shared ? { label: `Pad ${i + 1}`, sub: name, color } : { label: name, color };
    });
  }
  return [];
}

/** Steps one pass of the pattern plays: 16 on the 80LA8, the Divine09 length (16 to 128), the PAD-64 loop (1 to 4 bars). */
export function drumStepCount(state: InstrumentState): number {
  if (state.kind === "divine09") return DIVINE_LENGTHS[Math.round(state.values.length ?? 0)] ?? 16;
  if (state.kind === "pad64") return (PAD_BARS[Math.round(state.values.bars ?? 3)] ?? 4) * 16;
  return 16;
}

export function drumCell(state: InstrumentState, index: number, row: number, step: number): number {
  const p = patternsOf(state)[index] as number[][] | undefined;
  return Number(p?.[row]?.[step]) || 0;
}

/** What a tap does, the way each machine's own grid does it: on/off (accent with Shift) or the PAD-64's off, on, accent cycle. */
export function nextDrumValue(kind: InstrumentKind, current: number, accent: boolean): number {
  if (kind === "pad64") return (Math.round(current) + 1) % 3;
  if (kind === "divine09") return accent ? (current === 2 ? 0 : 2) : current ? 0 : 1;
  if (accent) {
    if (current <= 0) return 1;
    const i = VELOCITY_CYCLE.findIndex((v) => Math.abs(v - current) < 0.01);
    return VELOCITY_CYCLE[(i + 1) % VELOCITY_CYCLE.length];
  }
  return current > 0 ? 0 : DRUM_STEP_ON.drum80la8;
}

export function setDrumCell(state: InstrumentState, index: number, row: number, step: number, value: number): InstrumentState {
  const p = patternsOf(state)[index] as number[][] | undefined;
  if (!p?.[row]) throw new PatternEditError("That drum step does not exist.");
  const rows = p.map((r, i) => (i === row ? r.map((v, s) => (s === step ? value : v)) : r));
  return withPattern(state, index, rows);
}

// 30LEE ---------------------------------------------------------------------------------------

export function acidSteps(state: InstrumentState, index: number): AcidStep[] {
  return (patternsOf(state)[index] as AcidStep[] | undefined) ?? [];
}

export function setAcidStep(state: InstrumentState, index: number, step: number, change: Partial<AcidStep>): InstrumentState {
  const steps = acidSteps(state, index);
  if (!steps[step]) throw new PatternEditError("That 30LEE step does not exist.");
  return withPattern(state, index, steps.map((s, i) => (i === step ? { ...s, ...change } : s)));
}

// Galactic One --------------------------------------------------------------------------------

export function galacticPattern(state: InstrumentState, index: number): GPattern | undefined {
  return patternsOf(state)[index] as GPattern | undefined;
}

export function setGalacticStep(state: InstrumentState, index: number, step: number, change: Partial<GStep>): InstrumentState {
  const p = galacticPattern(state, index);
  if (!p?.steps[step]) throw new PatternEditError("That Galactic One step does not exist.");
  return withPattern(state, index, { ...p, steps: p.steps.map((s, i) => (i === step ? { ...s, ...change } : s)) });
}

export function setGalacticLength(state: InstrumentState, index: number, len: number): InstrumentState {
  const p = galacticPattern(state, index);
  if (!p) throw new PatternEditError("That Galactic One bank does not exist.");
  return withPattern(state, index, { ...p, len });
}

// 0010110 -------------------------------------------------------------------------------------

export function leadPattern(state: InstrumentState): { steps: number[]; accents: boolean[] } {
  const d = dataOf(state);
  return { steps: Array.isArray(d.steps) ? (d.steps as number[]) : [], accents: Array.isArray(d.accents) ? (d.accents as boolean[]) : [] };
}

/** Picking the degree a step already plays turns it off, as on the instrument; with `accent` it flips the accent instead. */
export function tapLeadStep(state: InstrumentState, step: number, degree: number, accent: boolean): InstrumentState {
  const { steps, accents } = leadPattern(state);
  if (step < 0 || step >= steps.length) throw new PatternEditError("That 0010110 step does not exist.");
  if (accent) return steps[step] > 0 ? withPattern(state, 0, { steps, accents: accents.map((a, i) => (i === step ? !a : a)) }) : state;
  return withPattern(state, 0, { steps: steps.map((d, i) => (i === step ? (d === degree ? 0 : degree) : d)), accents });
}

// The arrangement ------------------------------------------------------------------------------

export function slotForTrack(project: Project, trackId: string): InstrumentSlot | undefined {
  return project.instruments.find((s) => s.trackId === trackId);
}

export function clipsUsingPattern(project: Project, trackId: string, index: number): Clip[] {
  const track = project.tracks.find((t) => t.id === trackId);
  return track ? track.clips.filter((c) => c.kind === "pattern" && (c.patternIndex ?? 0) === index) : [];
}

/** Played by a clip, by the Song matrix, or layered/chained inside Galactic One. */
export function patternInUse(project: Project, slot: InstrumentSlot, index: number): boolean {
  if (clipsUsingPattern(project, slot.trackId, index).length > 0) return true;
  if ((project.song.matrix[slot.id] ?? []).some((v) => v === index + 1)) return true;
  if (slot.state.kind === "galacticOne") {
    if (Math.round(slot.state.values["seq.layer"] ?? 0) - 1 === index) return true;
    const chainOn = slot.state.values["seq.chain"] === 1;
    const chain = dataOf(slot.state).chain;
    if (chainOn && Array.isArray(chain) && chain.includes(index)) return true;
  }
  return false;
}

/** The first pattern nothing plays and that holds no steps, so copying into it loses nothing. */
export function freePatternIndex(project: Project, slot: InstrumentSlot): number | null {
  const count = patternCount(slot.state);
  for (let i = 0; i < count; i++) {
    if (!patternInUse(project, slot, i) && isPatternEmpty(slot.state.kind, getPattern(slot.state, i))) return i;
  }
  return null;
}

export type UniqueCopy = { ok: true; project: Project; index: number } | { ok: false; reason: string };

/** Copies the clip's pattern into a free slot and points only this clip at it, as one change. */
export function makeUniqueCopy(project: Project, clipId: string, instrumentName: string): UniqueCopy {
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip || clip.kind !== "pattern") return { ok: false, reason: "Pick a pattern clip to copy its pattern." };
  const slot = slotForTrack(project, track.id);
  if (!slot) return { ok: false, reason: "This track has no instrument to hold a copy." };
  const count = patternCount(slot.state);
  const from = clip.patternIndex ?? 0;
  if (count <= 1) return { ok: false, reason: `${instrumentName} has a single pattern, so every clip on this track plays it.` };
  const to = freePatternIndex(project, slot);
  if (to === null) {
    return {
      ok: false,
      reason: `All ${count} patterns of ${instrumentName} are in use or hold steps. Clear one in the instrument to make room for a copy.`,
    };
  }
  const state = withPattern(slot.state, to, structuredClone(getPattern(slot.state, from)));
  const autoName = /^Pattern [A-Z]$/.test(clip.name);
  const next = setSlotState(project, slot.id, state);
  const tracks = next.tracks.map((t) =>
    t.id !== track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, patternIndex: to, name: autoName ? `Pattern ${patternLetter(to)}` : c.name } : c)) },
  );
  return { ok: true, project: { ...next, tracks }, index: to };
}

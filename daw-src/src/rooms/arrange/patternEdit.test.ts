import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { InstrumentState } from "../../audio/types";
import { addClip, addTrack, makeClip, makeTrack } from "../../project/actions";
import { newProject, type Project } from "../../project/model";
import {
  clipsUsingPattern,
  drumCell,
  drumRows,
  drumStepCount,
  freePatternIndex,
  isPatternEmpty,
  makeUniqueCopy,
  mergePatterns,
  nextDrumValue,
  patternCount,
  setAcidStep,
  setDrumCell,
  setGalacticStep,
  tapLeadStep,
} from "./patternEdit";

const rows = (voices: number, steps: number, on: Array<[number, number, number]> = []) => {
  const grid = Array.from({ length: voices }, () => new Array<number>(steps).fill(0));
  for (const [v, s, x] of on) grid[v][s] = x;
  return grid;
};

function divine(patterns: number[][][], length = 0): InstrumentState {
  return { kind: "divine09", values: { length }, data: { patterns, pattern: 0, voice: 0, samples: [] } };
}

/** A drum track with clips on the given patterns. */
function project(state: InstrumentState, clipPatterns: number[]): { project: Project; clipIds: string[] } {
  let p = newProject("Test");
  const track = makeTrack(p, "instrument", { name: "Drums" });
  p = addTrack(p, track);
  p = { ...p, instruments: [{ id: "slot-d", kind: state.kind, trackId: track.id, state }] };
  const clipIds: string[] = [];
  clipPatterns.forEach((pi, i) => {
    const clip = makeClip({ kind: "pattern", name: i === 0 ? "Build" : `Pattern ${"ABCD"[pi]}`, startBar: 1 + i * 4, lengthBars: 4, patternIndex: pi });
    p = addClip(p, track.id, clip);
    clipIds.push(clip.id);
  });
  return { project: p, clipIds };
}

describe("pattern edits on saved instrument state", () => {
  it("sets one drum step and leaves every other pattern and step alone", () => {
    const state = divine([rows(15, 128), rows(15, 128, [[0, 0, 1]]), rows(15, 128), rows(15, 128)]);
    const next = setDrumCell(state, 1, 2, 5, 2);
    expect(drumCell(next, 1, 2, 5)).toBe(2);
    expect(drumCell(next, 1, 0, 0)).toBe(1);
    expect(drumCell(state, 1, 2, 5)).toBe(0);
    expect(next.data).not.toBe(state.data);
  });

  it("taps like each machine's own grid", () => {
    expect(nextDrumValue("divine09", 0, false)).toBe(1);
    expect(nextDrumValue("divine09", 1, false)).toBe(0);
    expect(nextDrumValue("divine09", 0, true)).toBe(2);
    expect(nextDrumValue("divine09", 2, true)).toBe(0);
    expect([0, 1, 2].map((v) => nextDrumValue("pad64", v, false))).toEqual([1, 2, 0]);
    expect(nextDrumValue("drum80la8", 0, false)).toBeCloseTo(0.84);
    expect(nextDrumValue("drum80la8", 0.84, false)).toBe(0);
    expect(nextDrumValue("drum80la8", 0.84, true)).toBe(1);
  });

  it("toggling a drum step twice restores the pattern (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 14 }), fc.integer({ min: 0, max: 127 }), (p, v, s) => {
        const state = divine(Array.from({ length: 4 }, () => rows(15, 128)));
        const once = setDrumCell(state, p, v, s, nextDrumValue("divine09", drumCell(state, p, v, s), false));
        const twice = setDrumCell(once, p, v, s, nextDrumValue("divine09", drumCell(once, p, v, s), false));
        expect(twice.data).toEqual(state.data);
      }),
    );
  });

  it("reads the step count each machine plays", () => {
    expect(drumStepCount(divine([], 2))).toBe(64);
    expect(drumStepCount({ kind: "pad64", values: { bars: 1 }, data: {} })).toBe(32);
    expect(drumStepCount({ kind: "drum80la8", values: {}, data: {} })).toBe(16);
  });

  it("numbers PAD-64 pads that share a sound, naming the sound beside them", () => {
    const values: Record<string, number> = {};
    for (let i = 0; i < 16; i++) values[`v${i}.kind`] = i < 12 ? 16 : i;
    const named = drumRows({ kind: "pad64", values, data: {} });
    expect(named[0]).toMatchObject({ label: "Pad 1", sub: "Warm bass" });
    expect(named[12].label).not.toMatch(/^Pad /);
  });

  it("edits 30LEE, Galactic One and 0010110 steps", () => {
    const acid: InstrumentState = { kind: "acid30lee", values: {}, data: { patterns: [[{ on: false, note: 36, oct: 0, accent: false, slide: false }]] } };
    expect((setAcidStep(acid, 0, 0, { on: true }).data as { patterns: { on: boolean }[][] }).patterns[0][0].on).toBe(true);
    const step = { on: false, n: 0, v: 0.8, g: 0.5, p: 1, r: 1, c: 0, accent: false, slide: false };
    const go: InstrumentState = { kind: "galacticOne", values: {}, data: { patterns: [{ len: 16, steps: [step] }] } };
    expect((setGalacticStep(go, 0, 0, { on: true, n: 3 }).data as { patterns: { steps: { n: number }[] }[] }).patterns[0].steps[0].n).toBe(3);
    const lead: InstrumentState = { kind: "lead0010110", values: {}, data: { steps: [0, 2], accents: [false, false] } };
    const tapped = tapLeadStep(lead, 0, 4, false);
    expect((tapped.data as { steps: number[] }).steps).toEqual([4, 2]);
    expect((tapLeadStep(tapped, 0, 4, false).data as { steps: number[] }).steps).toEqual([0, 2]);
    expect((tapLeadStep(lead, 1, 0, true).data as { accents: boolean[] }).accents).toEqual([false, true]);
    expect(patternCount(lead)).toBe(1);
  });

  it("merges only pattern content into a live state", () => {
    const live = divine([rows(1, 4)], 3);
    const target = divine([rows(1, 4, [[0, 1, 1]])], 0);
    const merged = mergePatterns(live, target);
    expect(merged.values.length).toBe(3);
    expect((merged.data as { patterns: number[][][] }).patterns[0][0][1]).toBe(1);
  });
});

describe("make unique copy", () => {
  it("copies into the first empty, unused pattern and repoints only this clip", () => {
    const state = divine([rows(15, 128, [[0, 0, 1]]), rows(15, 128, [[1, 4, 1]]), rows(15, 128), rows(15, 128)]);
    const { project: p, clipIds } = project(state, [1, 1, 0]);
    expect(clipsUsingPattern(p, p.tracks[0].id, 1)).toHaveLength(2);
    const result = makeUniqueCopy(p, clipIds[0], "Divine09");
    if (!result.ok) throw new Error(result.reason);
    expect(result.index).toBe(2);
    const clips = result.project.tracks[0].clips;
    expect(clips.find((c) => c.id === clipIds[0])?.patternIndex).toBe(2);
    expect(clips.find((c) => c.id === clipIds[1])?.patternIndex).toBe(1);
    const slot = result.project.instruments[0].state;
    expect(drumCell(slot, 2, 1, 4)).toBe(1);
    // The copy is detached: editing it leaves the original alone.
    expect(drumCell(setDrumCell(slot, 2, 1, 4, 0), 1, 1, 4)).toBe(1);
  });

  it("never overwrites a pattern that holds steps or that the Song plays", () => {
    const state = divine([rows(15, 16), rows(15, 16, [[0, 0, 1]]), rows(15, 16), rows(15, 16, [[2, 2, 1]])]);
    const { project: base, clipIds } = project(state, [1, 1]);
    const p = { ...base, song: { ...base.song, matrix: { "slot-d": [1 as const] } } };
    expect(freePatternIndex(p, p.instruments[0])).toBe(2);
    const full = { ...p, song: { ...p.song, matrix: { "slot-d": [1 as const, 3 as const] } } };
    expect(freePatternIndex(full, full.instruments[0])).toBeNull();
    const result = makeUniqueCopy(full, clipIds[0], "Divine09");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/All 4 patterns/);
  });

  it("explains that a one-pattern instrument cannot hold a copy", () => {
    const lead: InstrumentState = { kind: "lead0010110", values: {}, data: { steps: [1], accents: [false] } };
    const { project: p, clipIds } = project(lead, [0, 0]);
    const result = makeUniqueCopy(p, clipIds[0], "0010110");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/single pattern/);
  });

  it("renames an auto-named clip to its new pattern", () => {
    const state = divine([rows(15, 16, [[0, 0, 1]]), rows(15, 16), rows(15, 16), rows(15, 16)]);
    const { project: p, clipIds } = project(state, [0, 0]);
    const result = makeUniqueCopy(p, clipIds[1], "Divine09");
    if (!result.ok) throw new Error(result.reason);
    expect(result.project.tracks[0].clips.find((c) => c.id === clipIds[1])?.name).toBe("Pattern B");
  });

  it("treats empty patterns as empty for every family", () => {
    expect(isPatternEmpty("divine09", rows(2, 4))).toBe(true);
    expect(isPatternEmpty("acid30lee", [{ on: false }])).toBe(true);
    expect(isPatternEmpty("galacticOne", { len: 4, steps: [{ on: false }, { on: false }, { on: false }, { on: false }, { on: true }] })).toBe(true);
    expect(isPatternEmpty("lead0010110", { steps: [0, 3] })).toBe(false);
  });
});

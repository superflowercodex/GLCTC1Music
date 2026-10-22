import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { compose, detectBpm, type ComposerSlot } from "./composer";
import { totalBars } from "./songModel";

const ALL: ComposerSlot[] = [
  { id: "drums", kind: "drum80la8", patternCount: 4 },
  { id: "divine", kind: "divine09", patternCount: 4 },
  { id: "pad64", kind: "pad64", patternCount: 4 },
  { id: "bass", kind: "acid30lee", patternCount: 4 },
  { id: "lead", kind: "lead0010110", patternCount: 4 },
  { id: "go", kind: "galacticOne", patternCount: 8 },
  { id: "vox", kind: "vox", patternCount: 4 },
  { id: "loop", kind: "looper", patternCount: 4 },
];

describe("compose", () => {
  it("is deterministic", () => {
    fc.assert(fc.property(fc.string(), (text) => JSON.stringify(compose(text, ALL)) === JSON.stringify(compose(text, ALL))));
  });

  it("handles empty input with the default club song", () => {
    const r = compose("", ALL);
    expect(r.genreMatched).toBe(false);
    expect(totalBars(r.sections)).toBe(36);
    expect(r.bpm).toBe(130);
    expect(Object.keys(r.matrix).length).toBeGreaterThan(0);
  });

  it("never throws and keeps every cell inside the instrument's patterns", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = compose(text, ALL);
        return ALL.every((s) => (r.matrix[s.id] ?? []).every((v) => v >= 0 && v <= Math.min(4, s.patternCount))) && r.bpm >= 30 && r.bpm <= 300;
      }),
    );
  });

  it("reads the tempo from the prompt and clamps it", () => {
    expect(compose("slow techno at 98 bpm", ALL).bpm).toBe(98);
    expect(compose("tempo of 140", ALL).bpm).toBe(140);
    expect(compose("house 999 bpm", ALL).bpm).toBe(300);
    expect(detectBpm("no tempo here")).toBeUndefined();
    expect(compose("house", ALL).bpm).toBe(124);
  });

  it("picks genre defaults and scale words", () => {
    expect(compose("jungle vibes", ALL).bpm).toBe(174);
    expect(compose("happy pop", ALL).scale).toBe("major");
    expect(compose("dark techno", ALL).scale).toBe("phrygian");
    expect(compose("sad house", ALL).key).toMatch(/minor$/);
  });

  it("skips instruments the way the old composer did", () => {
    const noDrums = compose("techno with no drums", ALL);
    expect(noDrums.matrix.drums).toBeUndefined();
    expect(noDrums.matrix.divine).toBeUndefined();
    expect(noDrums.matrix.bass).toBeDefined();
    const minimal = compose("minimal techno", ALL);
    expect(minimal.matrix.lead).toBeUndefined();
    expect(minimal.matrix.vox).toBeUndefined();
    const dnb = compose("dnb", ALL);
    expect(dnb.matrix.vox).toBeUndefined();
    expect(compose("dnb with vocals", ALL).matrix.vox).toBeDefined();
    const ambient = compose("ambient meditation", ALL);
    expect(Object.keys(ambient.matrix)).toEqual(["lead", "go", "vox"]);
    expect(compose("ambient acid", ALL).matrix.bass).toBeDefined();
  });

  it("ignores instruments without patterns and picks the length from the text", () => {
    const r = compose("a 64 bars epic", [{ id: "x", kind: "looper", patternCount: 0 }, ...ALL]);
    expect(r.matrix.x).toBeUndefined();
    expect(totalBars(r.sections)).toBe(64);
    expect(totalBars(compose("short", ALL).sections)).toBe(16);
  });

  it("understands the placeholder prompt: genre word in a phrase, NNN bpm, at NNN", () => {
    const r = compose("Dark techno, 128 bpm, slow build, big drop, then ease out", ALL);
    expect(r.genreMatched).toBe(true);
    expect(r.genre).toBe("techno");
    expect(r.bpm).toBe(128);
    expect(r.summary).toContain("Techno (from your words)");
    expect(r.summary).toContain("128 BPM from your text");
    expect(compose("DEEP HOUSE 122 BPM", ALL).bpm).toBe(122);
    expect(compose("Warehouse rave at 140", ALL).bpm).toBe(140);
    expect(compose("house at 120", ALL).genre).toBe("house");
    expect(compose("house, 32 bars", ALL).bpm).toBe(124);
    expect(compose("house at 16 bars", ALL).bpm).toBe(124);
  });
});

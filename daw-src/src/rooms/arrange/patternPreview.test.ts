import { describe, expect, it } from "vitest";
import { patternPreview } from "./patternPreview";

describe("patternPreview", () => {
  it("lists drum hits by voice", () => {
    const row = (on: number[]) => Array.from({ length: 16 }, (_, i) => (on.includes(i) ? 0.8 : 0));
    const state = { kind: "drum80la8", values: {}, data: { patterns: [[row([0, 8]), row([4])]] } } as never;
    const p = patternPreview(state, 0);
    expect(p?.hits).toEqual([{ step: 0, row: 0 }, { step: 8, row: 0 }, { step: 4, row: 1 }]);
  });

  it("is null for an empty or missing pattern", () => {
    const state = { kind: "acid30lee", values: {}, data: { patterns: [Array.from({ length: 16 }, () => ({ on: false, note: 36 }))] } } as never;
    expect(patternPreview(state, 0)).toBeNull();
    expect(patternPreview(state, 3)).toBeNull();
  });

  it("puts higher pitches on higher rows", () => {
    const steps = [{ on: true, note: 36 }, { on: true, note: 48 }];
    const state = { kind: "acid30lee", values: {}, data: { patterns: [steps] } } as never;
    const p = patternPreview(state, 0);
    expect(p?.hits[1].row).toBeLessThan(p?.hits[0].row ?? 0);
  });

  it("draws Divine09 and PAD-64 hits within the steps the machine plays", () => {
    const row = (on: number[], len: number) => Array.from({ length: len }, (_, i) => (on.includes(i) ? 1 : 0));
    const state = { kind: "divine09", values: { length: 0 }, data: { patterns: [[row([0, 20], 128), row([4], 128)]] } } as never;
    const p = patternPreview(state, 0);
    expect(p?.steps).toBe(16);
    expect(p?.hits).toEqual([{ step: 0, row: 0 }, { step: 4, row: 1 }]);
  });

  it("draws the single 0010110 pattern by degree", () => {
    const state = { kind: "lead0010110", values: {}, data: { steps: [1, 0, 5], accents: [] } } as never;
    expect(patternPreview(state, 0)?.hits).toHaveLength(2);
    expect(patternPreview(state, 1)).toBeNull();
  });
});

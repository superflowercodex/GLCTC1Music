import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyRowTool, doubleTime, euclid, halfTime, parseRow, reverseRow, rotateRow } from "./pattern";

const row = (len: number) => fc.array(fc.integer({ min: 0, max: 2 }), { minLength: len, maxLength: len });

describe("euclid", () => {
  it("places exactly the requested number of hits", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 128 }), fc.integer({ min: 0, max: 128 }), (len, hits) => {
        const h = Math.min(hits, len);
        expect(euclid(len, hits).filter(Boolean)).toHaveLength(h);
      }),
    );
  });

  it("spreads hits so neighbouring gaps differ by at most one step", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 64 }), fc.integer({ min: 1, max: 64 }), (len, hits) => {
        const h = Math.min(hits, len);
        const at = euclid(len, h).flatMap((x, i) => (x ? [i] : []));
        const gaps = at.map((p, i) => (i === at.length - 1 ? at[0] + len - p : at[i + 1] - p));
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("starts on the downbeat when there is any hit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), fc.integer({ min: 1, max: 64 }), (len, hits) => {
        expect(euclid(len, hits)[0]).toBe(true);
      }),
    );
  });
});

describe("row shifting", () => {
  it("rotating forward then back restores the row", () => {
    fc.assert(
      fc.property(row(32), fc.integer({ min: -40, max: 40 }), fc.integer({ min: 1, max: 32 }), (r, by, len) => {
        expect(rotateRow(rotateRow(r, by, len), -by, len)).toEqual(r);
      }),
    );
  });

  it("rotating keeps the number of hits and leaves later steps alone", () => {
    fc.assert(
      fc.property(row(32), fc.integer({ min: -40, max: 40 }), fc.integer({ min: 1, max: 32 }), (r, by, len) => {
        const out = rotateRow(r, by, len);
        expect(out.slice(0, len).filter(Boolean)).toHaveLength(r.slice(0, len).filter(Boolean).length);
        expect(out.slice(len)).toEqual(r.slice(len));
      }),
    );
  });

  it("rotating by the length is the identity", () => {
    fc.assert(
      fc.property(row(16), (r) => {
        expect(rotateRow(r, 16, 16)).toEqual(r);
      }),
    );
  });

  it("reversing twice is the identity", () => {
    fc.assert(
      fc.property(row(40), fc.integer({ min: 1, max: 40 }), (r, len) => {
        expect(reverseRow(reverseRow(r, len), len)).toEqual(r);
      }),
    );
  });

  it("half and double time keep the row length", () => {
    fc.assert(
      fc.property(row(64), fc.integer({ min: 1, max: 64 }), (r, len) => {
        expect(halfTime(r, len)).toHaveLength(64);
        expect(doubleTime(r, len)).toHaveLength(64);
      }),
    );
  });

  it("half time stretches each step over two", () => {
    const out = halfTime([1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16);
    expect(out.slice(0, 4)).toEqual([1, 1, 0, 0]);
    expect(out.slice(4, 6)).toEqual([1, 1]);
  });

  it("tools never write outside the pattern length", () => {
    fc.assert(
      fc.property(row(64), fc.integer({ min: 1, max: 64 }), fc.constantFrom("euclid", "half", "double", "reverse", "left", "right", "clear" as const), (r, len, tool) => {
        const out = applyRowTool(tool, r, len, 5, 1);
        expect(out).toHaveLength(64);
        expect(out.slice(len)).toEqual(r.slice(len));
      }),
    );
  });
});

describe("parseRow", () => {
  it("reads x, X and o", () => {
    expect(parseRow("x.Xo")).toEqual([0.84, 0, 1, 0.5]);
  });
});

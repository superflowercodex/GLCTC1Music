import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { stepPages, StepPageError } from "./stepPages";

describe("stepPages", () => {
  it("pages sixteen steps as two eights and leaves eight as one page", () => {
    expect(stepPages(16, 8)).toEqual([{ from: 0, to: 8 }, { from: 8, to: 16 }]);
    expect(stepPages(8, 8)).toEqual([{ from: 0, to: 8 }]);
    expect(stepPages(64, 8)).toHaveLength(8);
  });

  it("covers every step exactly once, in order, never with an empty or oversized page", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 256 }), fc.integer({ min: 1, max: 32 }), (cols, size) => {
        const pages = stepPages(cols, size);
        let next = 0;
        for (const p of pages) {
          if (p.from !== next || p.to <= p.from || p.to - p.from > size) return false;
          next = p.to;
        }
        return next === cols;
      }),
    );
  });

  it("refuses sizes that cannot page", () => {
    expect(() => stepPages(0, 8)).toThrow(StepPageError);
    expect(() => stepPages(16, 0)).toThrow(StepPageError);
    expect(() => stepPages(16.5, 8)).toThrow(StepPageError);
  });
});

import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildPeakIndex, peaksForRange } from "./peaks";

function buffer(values: number[]): AudioBuffer {
  const ctx = new OfflineAudioContext(2, Math.max(1, values.length), 44100);
  const b = ctx.createBuffer(2, Math.max(1, values.length), 44100);
  b.getChannelData(0).set(values);
  b.getChannelData(1).set(values.map((v) => -v / 2));
  return b as unknown as AudioBuffer;
}

describe("peaks", () => {
  it("finds the extremes across channels", () => {
    const b = buffer([0, 0.5, -0.25, 1, 0, 0]);
    const p = peaksForRange(buildPeakIndex(b), b, 0, 6, 1);
    expect(p.max[0]).toBe(1);
    expect(p.min[0]).toBe(-0.5);
  });

  it("agrees between the block index and a direct scan", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 4000, maxLength: 6000 }), fc.integer({ min: 2, max: 8 }), (values, bins) => {
        const b = buffer(values);
        const indexed = peaksForRange(buildPeakIndex(b), b, 0, values.length, bins);
        const direct = peaksForRange(buildPeakIndex(b, 1 << 30), b, 0, values.length, bins);
        for (let i = 0; i < bins; i++) {
          // The indexed path ignores partial blocks at bin edges, so it can only be narrower.
          expect(indexed.max[i]).toBeLessThanOrEqual(direct.max[i] + 1e-6);
          expect(indexed.min[i]).toBeGreaterThanOrEqual(direct.min[i] - 1e-6);
          expect(direct.max[i]).toBeGreaterThanOrEqual(direct.min[i]);
        }
      }),
    );
  });

  it("treats the range outside the file as silence", () => {
    const b = buffer([1, 1, 1, 1]);
    const p = peaksForRange(buildPeakIndex(b), b, -4, 0, 2);
    expect(Array.from(p.max)).toEqual([0, 0]);
  });
});

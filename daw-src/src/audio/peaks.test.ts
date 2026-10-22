import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computePeaks, reducePeaks } from "./peaks";

describe("computePeaks", () => {
  it("keeps the loudest sample of each slot and stays within 0..1", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 4000 }), (samples) => {
        const ch = Float32Array.from(samples);
        const p = computePeaks([ch], 2000, 100);
        const overall = Math.max(...Array.from(ch, Math.abs));
        const peak = Math.max(...p.data);
        return p.data.every((v) => v >= 0 && v <= 1) && Math.abs(peak - overall) < 1e-6;
      }),
    );
  });

  it("covers every sample and combines channels", () => {
    const a = new Float32Array(1000);
    const b = new Float32Array(1000);
    a[10] = 0.4;
    b[10] = -0.9;
    b[999] = 0.5;
    const p = computePeaks([a, b], 1000, 100);
    expect(p.data.length).toBe(100);
    expect(p.data[1]).toBeCloseTo(0.9, 6);
    expect(p.data[99]).toBeCloseTo(0.5, 6);
  });

  it("reports the rate it really used when the sample rate does not divide evenly", () => {
    const p = computePeaks([new Float32Array(44100)], 44100, 200);
    expect(p.perSec).toBeCloseTo(44100 / Math.floor(44100 / 200), 6);
  });

  it("is silent for silence", () => {
    expect(Math.max(...computePeaks([new Float32Array(500)], 1000, 100).data)).toBe(0);
  });
});

describe("reducePeaks", () => {
  const peaks = { perSec: 10, data: Float32Array.from([0.1, 0.2, 0.9, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.2]) };

  it("takes the max of each bin", () => {
    const out = reducePeaks(peaks, 0, 1, 2);
    expect(out[0]).toBeCloseTo(0.9, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
  });

  it("returns silence past the end and nothing for an empty range", () => {
    expect(Array.from(reducePeaks(peaks, 5, 6, 3))).toEqual([0, 0, 0]);
    expect(reducePeaks(peaks, 1, 1, 4)).toEqual(new Float32Array(4));
  });

  it("never loses the global peak when reducing the whole range", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (bins) => {
        const out = reducePeaks(peaks, 0, 1, bins);
        return Math.max(...out) >= 0.9 - 1e-6;
      }),
    );
  });
});

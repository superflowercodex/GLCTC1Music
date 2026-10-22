import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { inputLatencySec, pickMimeType, planRecording, RecordingError, startRecording } from "./recorder";

const base = { beatsPerBar: 4, loop: { on: true, startBar: 3, endBar: 5 } };

describe("planRecording", () => {
  it("starts on the bar line when the transport is stopped", () => {
    const plan = planRecording(base, 40, false, { countInBars: 0, stopAfterBars: null, punchIn: false });
    expect(plan).toEqual({ startStep: 32, endStep: null, transportFrom: 32 });
  });

  it("joins a running transport exactly when there is no count-in", () => {
    expect(planRecording(base, 41.5, true, { countInBars: 0, stopAfterBars: 2, punchIn: false })).toEqual({
      startStep: 41.5,
      endStep: 41.5 + 32,
      transportFrom: 41.5,
    });
    expect(planRecording(base, 41.5, true, { countInBars: 1, stopAfterBars: null, punchIn: false }).startStep).toBe(32);
  });

  it("punches in over the loop region with a bar of lead-in", () => {
    expect(planRecording(base, 0, false, { countInBars: 0, stopAfterBars: null, punchIn: true })).toEqual({
      startStep: 32,
      endStep: 64,
      transportFrom: 16,
    });
  });

  it("refuses punch-in without a usable region", () => {
    expect(() =>
      planRecording({ ...base, loop: { on: true, startBar: 3, endBar: 3 } }, 0, false, { countInBars: 0, stopAfterBars: null, punchIn: true }),
    ).toThrow(RecordingError);
  });

  it("never starts before step 0 or ends before it starts", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5000, noNaN: true }),
        fc.boolean(),
        fc.constantFrom(0, 1, 2) as fc.Arbitrary<0 | 1 | 2>,
        fc.option(fc.integer({ min: 1, max: 64 }), { nil: null }),
        (pos, playing, countIn, bars) => {
          const plan = planRecording(base, pos, playing, { countInBars: countIn, stopAfterBars: bars, punchIn: false });
          return plan.startStep >= 0 && plan.transportFrom >= 0 && (plan.endStep === null || plan.endStep > plan.startStep);
        },
      ),
    );
  });
});

describe("pickMimeType", () => {
  it("takes the first supported type and handles none", () => {
    expect(pickMimeType((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});

describe("startRecording", () => {
  it("raises a readable RecordingError when the browser cannot record", async () => {
    await expect(startRecording({ source: { kind: "master" }, countInBars: 0, stopAfterBars: null, stems: false, punchIn: false })).rejects.toThrow(
      /can't record audio/,
    );
  });
});

describe("inputLatencySec", () => {
  it("sums base and output latency for the mic only", () => {
    const ctx = { baseLatency: 0.01, outputLatency: 0.04 };
    expect(inputLatencySec(ctx, { kind: "mic" })).toBeCloseTo(0.05);
    expect(inputLatencySec(ctx, { kind: "master" })).toBe(0);
    expect(inputLatencySec(ctx, { kind: "track", trackId: "t" })).toBe(0);
  });

  it("tolerates browsers that do not report latency and caps absurd values", () => {
    expect(inputLatencySec({}, { kind: "mic" })).toBe(0);
    expect(inputLatencySec({ baseLatency: 0.01, outputLatency: Number.NaN }, { kind: "mic" })).toBeCloseTo(0.01);
    expect(inputLatencySec({ baseLatency: 5, outputLatency: 5 }, { kind: "mic" })).toBe(0.5);
  });
});

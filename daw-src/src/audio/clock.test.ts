import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Clock, stepDuration, tempoFromTaps, type Ticker } from "./clock";

class ManualTicker implements Ticker {
  private cb: (() => void) | null = null;
  start(onTick: () => void) {
    this.cb = onTick;
  }
  stop() {
    this.cb = null;
  }
  fire() {
    this.cb?.();
  }
}

function fakeCtx() {
  return { currentTime: 0 } as unknown as BaseAudioContext;
}

describe("stepDuration", () => {
  it("is a quarter of a beat", () => {
    expect(stepDuration(120)).toBeCloseTo(0.125, 6);
    expect(stepDuration(60)).toBeCloseTo(0.25, 6);
  });
});

describe("Clock", () => {
  it("emits steps in order with evenly spaced audio times", () => {
    const ctx = fakeCtx();
    const ticker = new ManualTicker();
    const clock = new Clock(ctx, ticker);
    clock.bpm = 120;
    const seen: Array<[number, number]> = [];
    clock.subscribe((step, time) => seen.push([step, time]));
    clock.start(0);
    for (let t = 0; t < 2; t += 0.025) {
      (ctx as unknown as { currentTime: number }).currentTime = t;
      ticker.fire();
    }
    expect(seen.map((s) => s[0])).toEqual(seen.map((_, i) => i));
    for (let i = 1; i < seen.length; i++) expect(seen[i][1] - seen[i - 1][1]).toBeCloseTo(0.125, 6);
  });

  it("wraps to the loop start without skipping a step", () => {
    const ctx = fakeCtx();
    const ticker = new ManualTicker();
    const clock = new Clock(ctx, ticker);
    clock.loop = { startStep: 0, endStep: 4 };
    const steps: number[] = [];
    clock.subscribe((s) => steps.push(s));
    clock.start(0);
    for (let t = 0; t < 3; t += 0.025) {
      (ctx as unknown as { currentTime: number }).currentTime = t;
      ticker.fire();
    }
    expect(steps.slice(0, 10)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  });

  it("keeps the playhead where it is when tempo changes mid-play", () => {
    const ctx = fakeCtx();
    const clock = new Clock(ctx, new ManualTicker());
    clock.bpm = 120;
    clock.start(0);
    (ctx as unknown as { currentTime: number }).currentTime = 1.05;
    const before = clock.position();
    clock.setBpm(60);
    expect(clock.position()).toBeCloseTo(before, 6);
  });

  it("clamps tempo to a playable range", () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 5000, noNaN: true }), (bpm) => {
        const clock = new Clock(fakeCtx(), new ManualTicker());
        clock.setBpm(bpm);
        return clock.bpm >= 30 && clock.bpm <= 300;
      }),
    );
  });
});

describe("tempoFromTaps", () => {
  it("needs two taps", () => {
    expect(tempoFromTaps([0])).toBeNull();
  });
  it("reads a steady 120 bpm", () => {
    expect(tempoFromTaps([0, 0.5, 1, 1.5])).toBe(120);
  });
  it("forgets taps from before a long pause", () => {
    expect(tempoFromTaps([0, 0.9, 10, 10.5, 11])).toBe(120);
  });
});

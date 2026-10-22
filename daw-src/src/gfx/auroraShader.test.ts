import { describe, expect, it } from "vitest";
import { FramePacer } from "./auroraShader";

describe("FramePacer", () => {
  it("draws at most the target rate on a fast display", () => {
    const pacer = new FramePacer(45, 30);
    let drawn = 0;
    // 144 Hz for one second.
    for (let t = 0; t < 1000; t += 1000 / 144) if (pacer.shouldRender(t)) drawn += 1;
    expect(drawn).toBeGreaterThanOrEqual(40);
    expect(drawn).toBeLessThanOrEqual(50);
  });

  it("keeps a 60 Hz display near the cap instead of halving it", () => {
    const pacer = new FramePacer(60, 30);
    let drawn = 0;
    for (let t = 0; t < 1000; t += 1000 / 60) if (pacer.shouldRender(t)) drawn += 1;
    expect(drawn).toBeGreaterThanOrEqual(55);
  });

  it("downgrades after sustained long frames and not for one hitch", () => {
    const slow = new FramePacer(45, 30);
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += 60;
      slow.shouldRender(t);
    }
    expect(slow.downgraded).toBe(true);
    expect(slow.interval).toBeCloseTo(1000 / 30);

    const hitch = new FramePacer(45, 30);
    t = 0;
    for (let i = 0; i < 100; i++) {
      t += i === 50 ? 120 : 22.5;
      hitch.shouldRender(t);
    }
    expect(hitch.downgraded).toBe(false);
  });

  it("ignores the huge gap when a hidden tab comes back", () => {
    const pacer = new FramePacer(45, 30);
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += 22.5;
      pacer.shouldRender(t);
      if (i % 10 === 0) t += 60_000;
    }
    expect(pacer.downgraded).toBe(false);
  });
});

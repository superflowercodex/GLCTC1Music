import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { approach, ColorParseError, FramePacer, parseHex } from "./auroraShader";

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

describe("FramePacer target", () => {
  it("never climbs back above the low rate once downgraded", () => {
    const pacer = new FramePacer(30, 12);
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += 80;
      pacer.shouldRender(t);
    }
    expect(pacer.downgraded).toBe(true);
    pacer.target = 30;
    expect(pacer.interval).toBeCloseTo(1000 / 12);
  });
});

describe("parseHex", () => {
  it("reads long and short forms", () => {
    expect(parseHex("#ff0000")).toEqual([1, 0, 0]);
    expect(parseHex("#0f0")).toEqual([0, 1, 0]);
  });
  it("rejects anything that is not a hex colour", () => {
    expect(() => parseHex("rgb(1,2,3)")).toThrow(ColorParseError);
  });
  it("round-trips every byte", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffff }), (n) => {
      const hex = `#${n.toString(16).padStart(6, "0")}`;
      const [r, g, b] = parseHex(hex).map((v) => Math.round(v * 255));
      expect((r << 16) | (g << 8) | b).toBe(n);
    }));
  });
});

describe("approach", () => {
  it("moves toward the target without overshooting, whatever the step", () => {
    fc.assert(fc.property(fc.double({ min: -10, max: 10, noNaN: true }), fc.double({ min: -10, max: 10, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), (from, to, dt) => {
      const next = approach(from, to, dt, 0.7);
      expect(Math.abs(next - to)).toBeLessThanOrEqual(Math.abs(from - to) + 1e-12);
    }));
  });
  it("is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 4; i++) a = approach(a, 1, 0.25, 0.7);
    expect(a).toBeCloseTo(approach(0, 1, 1, 0.7), 10);
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { audibleTrackIds, dbToFader, FADER_UNITY, faderToDb, formatDb, formatPan, hzToPosition, positionToHz } from "./mixMath";

const track = (id: string, muted = false, solo = false) => ({ id, muted, solo });

describe("fader mapping", () => {
  it("puts unity at 80% and the ends at -60 and +6 dB", () => {
    expect(faderToDb(FADER_UNITY)).toBeCloseTo(0, 6);
    expect(faderToDb(0)).toBe(-60);
    expect(faderToDb(1)).toBeCloseTo(6, 6);
  });

  it("is monotonic and round-trips", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(faderToDb(lo)).toBeLessThanOrEqual(faderToDb(hi) + 1e-9);
        expect(dbToFader(faderToDb(a))).toBeCloseTo(a, 6);
      }),
    );
  });

  it("clamps out-of-range input", () => {
    expect(dbToFader(40)).toBe(1);
    expect(dbToFader(-200)).toBe(0);
    expect(faderToDb(7)).toBeCloseTo(6, 6);
  });
});

describe("formatting", () => {
  it("formats decibels and pan", () => {
    expect(formatDb(-3.04)).toBe("−3.0");
    expect(formatDb(0)).toBe("0.0");
    expect(formatDb(2.5)).toBe("+2.5");
    expect(formatDb(-60)).toBe("−∞");
    expect(formatPan(0)).toBe("C");
    expect(formatPan(-0.06)).toBe("L 6");
    expect(formatPan(0.18)).toBe("R 18");
  });

  it("log cutoff mapping round-trips", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (p) => {
        expect(hzToPosition(positionToHz(p))).toBeCloseTo(p, 6);
      }),
    );
  });
});

describe("solo logic", () => {
  it("plays everything unmuted when nothing is soloed", () => {
    expect([...audibleTrackIds([track("a"), track("b", true), track("c")])].sort()).toEqual(["a", "c"]);
  });

  it("plays only soloed tracks when any solo is on", () => {
    expect([...audibleTrackIds([track("a"), track("b", false, true), track("c")])]).toEqual(["b"]);
  });

  it("lets several solos play together", () => {
    expect([...audibleTrackIds([track("a", false, true), track("b", false, true), track("c")])].sort()).toEqual(["a", "b"]);
  });

  it("keeps a muted track silent even when soloed", () => {
    expect(audibleTrackIds([track("a", true, true), track("b")]).size).toBe(0);
  });

  it("nothing is audible in an empty project", () => {
    expect(audibleTrackIds([]).size).toBe(0);
  });
});

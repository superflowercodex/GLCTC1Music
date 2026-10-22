import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  arcOrigin,
  arcPath,
  assertRange,
  ballistic,
  dbToGain,
  DEFAULT_METER,
  dragNorm,
  fromNorm,
  gainToDb,
  KitRangeError,
  litSegments,
  normToAngle,
  nudge,
  padReadout,
  readoutChars,
  segmentZone,
  snap,
  SWEEP_END,
  SWEEP_START,
  toNorm,
  updatePeak,
  wheelValue,
} from "./kitMath";

const range = fc
  .tuple(fc.double({ min: -1000, max: 1000, noNaN: true }), fc.double({ min: 0.001, max: 2000, noNaN: true }))
  .map(([min, span]) => ({ min, max: min + span }));

describe("value mapping", () => {
  it("rejects empty or inverted ranges", () => {
    expect(() => assertRange(1, 1)).toThrow(KitRangeError);
    expect(() => assertRange(2, 1)).toThrow(KitRangeError);
    expect(() => assertRange(0, Number.NaN)).toThrow(KitRangeError);
  });

  it("round-trips value → norm → value without a step", () => {
    fc.assert(
      fc.property(range, fc.double({ min: 0, max: 1, noNaN: true }), ({ min, max }, t) => {
        const v = min + t * (max - min);
        expect(fromNorm(toNorm(v, min, max), min, max)).toBeCloseTo(v, 6);
      }),
    );
  });

  it("always lands inside the range and on the step grid", () => {
    fc.assert(
      fc.property(range, fc.double({ min: -5, max: 5, noNaN: true }), fc.constantFrom(0.01, 0.5, 1, 5), ({ min, max }, n, step) => {
        const v = fromNorm(n, min, max, step);
        expect(v).toBeGreaterThanOrEqual(min);
        expect(v).toBeLessThanOrEqual(max);
        if (v !== max) expect(Math.abs((v - min) / step - Math.round((v - min) / step))).toBeLessThan(1e-6);
      }),
    );
  });

  it("trims float noise from snapped values", () => {
    expect(snap(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
    expect(snap(20 + 3 * 10, 20, 20000, 10)).toBe(50);
  });
});

describe("drag, keys and wheel", () => {
  it("sweeps the whole range over the drag span and stays clamped", () => {
    expect(dragNorm(0, 200)).toBe(1);
    expect(dragNorm(0.5, -100)).toBe(0);
    expect(dragNorm(0.5, 100, true)).toBeCloseTo(0.6);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: -5000, max: 5000, noNaN: true }), fc.boolean(), (start, dy, fine) => {
        const n = dragNorm(start, dy, fine);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
        // Up is always up.
        if (dy > 0) expect(n).toBeGreaterThanOrEqual(start);
        if (dy < 0) expect(n).toBeLessThanOrEqual(start);
      }),
    );
  });

  it("moves monotonically with the arrow keys and jumps with Home/End", () => {
    fc.assert(
      fc.property(range, fc.double({ min: 0, max: 1, noNaN: true }), ({ min, max }, t) => {
        const v = min + t * (max - min);
        expect(nudge(v, "ArrowUp", min, max)).toBeGreaterThanOrEqual(v);
        expect(nudge(v, "ArrowDown", min, max)).toBeLessThanOrEqual(v);
        expect(nudge(v, "PageUp", min, max)).toBeGreaterThanOrEqual(nudge(v, "ArrowUp", min, max));
        expect(nudge(v, "Home", min, max)).toBe(min);
        expect(nudge(v, "End", min, max)).toBe(max);
      }),
    );
  });

  it("uses a coarse param step as the key step, else 1% of the range", () => {
    expect(nudge(0, "ArrowUp", -12, 12, 1)).toBe(1);
    expect(nudge(0.5, "ArrowUp", 0, 1)).toBeCloseTo(0.51);
    expect(nudge(0.5, "ArrowUp", 0, 1, undefined, true)).toBeCloseTo(0.501);
  });

  it("follows the wheel direction, one step for stepped params, and never stalls on a fine step", () => {
    expect(wheelValue(0, -100, -24, 24, 1)).toBe(1);
    expect(wheelValue(0, 100, -24, 24, 1)).toBe(-1);
    expect(wheelValue(0.5, -100, 0, 1)).toBeCloseTo(0.54);
    expect(wheelValue(0.5, -1, 0, 1, 0.01)).toBe(0.51);
    expect(wheelValue(0.5, 0, 0, 1)).toBe(0.5);
  });
});

describe("knob geometry", () => {
  it("maps the range onto a 270° sweep", () => {
    expect(normToAngle(0)).toBe(SWEEP_START);
    expect(normToAngle(1)).toBe(SWEEP_END);
    expect(normToAngle(0.5)).toBe(0);
  });

  it("lights bipolar arcs from zero", () => {
    expect(arcOrigin(-1, 1, true)).toBe(0);
    expect(arcOrigin(0, 1, true)).toBe(SWEEP_START);
    expect(arcOrigin(-1, 1, false)).toBe(SWEEP_START);
  });

  it("draws nothing for a zero-length arc and a large-arc flag past 180°", () => {
    expect(arcPath(50, 50, 40, 10, 10)).toBe("");
    expect(arcPath(50, 50, 40, -135, 135)).toContain(" 0 1 1 ");
    expect(arcPath(50, 50, 40, -45, 45)).toContain(" 0 0 1 ");
  });
});

describe("meter math", () => {
  it("converts dB and gain both ways", () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 20, noNaN: true }), (db) => {
        expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 6);
      }),
    );
    expect(gainToDb(0)).toBe(-120);
    expect(dbToGain(-120)).toBe(0);
  });

  it("lights more segments for louder signals, within bounds", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 4, noNaN: true }), fc.double({ min: 0, max: 4, noNaN: true }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(litSegments(lo)).toBeLessThanOrEqual(litSegments(hi));
        expect(litSegments(hi)).toBeLessThanOrEqual(DEFAULT_METER.segments);
        expect(litSegments(lo)).toBeGreaterThanOrEqual(0);
      }),
    );
    expect(litSegments(0)).toBe(0);
    expect(litSegments(dbToGain(3))).toBe(DEFAULT_METER.segments);
  });

  it("colours green, then amber, then red from the bottom", () => {
    const zones = Array.from({ length: DEFAULT_METER.segments }, (_, i) => segmentZone(i));
    expect(zones[0]).toBe("ok");
    expect(zones.at(-1)).toBe("hot");
    expect(zones).toContain("warn");
    const order = { ok: 0, warn: 1, hot: 2 };
    for (let i = 1; i < zones.length; i++) expect(order[zones[i]]).toBeGreaterThanOrEqual(order[zones[i - 1]]);
  });

  it("holds a peak, then lets it fall, never below the live level", () => {
    let p = updatePeak({ segments: 0, at: 0 }, 20, 0);
    expect(p.segments).toBe(20);
    p = updatePeak(p, 5, 1000);
    expect(p.segments).toBe(20);
    p = updatePeak(p, 5, 1200 + 600);
    expect(p.segments).toBe(10);
    p = updatePeak(p, 12, 5000);
    expect(p.segments).toBe(12);
  });

  it("attacks instantly and releases gradually", () => {
    expect(ballistic(0.2, 0.9)).toBe(0.9);
    expect(ballistic(0.9, 0)).toBeCloseTo(0.81);
    expect(ballistic(0.5, 0.48)).toBe(0.48);
  });
});

describe("readoutChars", () => {
  it("covers every value of a stepped range", () => {
    fc.assert(
      fc.property(fc.integer({ min: -200, max: 200 }), fc.integer({ min: 1, max: 400 }), fc.integer({ min: 0, max: 400 }), (lo, steps, pick) => {
        const fmt = (v: number) => `${Math.round(v)} st`;
        const width = readoutChars(fmt, lo, lo + steps, 1);
        const v = lo + (pick % (steps + 1));
        expect(fmt(v).length).toBeLessThanOrEqual(width);
      }),
    );
  });
  it("finds the widest dB text on a continuous fader", () => {
    const fmt = (v: number) => (v <= -60 ? "−∞" : v.toFixed(1));
    expect(readoutChars(fmt, -60, 6)).toBe(5);
  });
  it("counts code points, not UTF-16 units", () => {
    expect(readoutChars(() => "−∞", 0, 1)).toBe(2);
  });
});

describe("padReadout", () => {
  it("always yields at least the slot width and keeps the text at the end", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), fc.integer({ min: 0, max: 16 }), (text, chars) => {
        const out = padReadout(text, chars);
        expect([...out].length).toBe(Math.max(chars, [...text].length));
        expect(out.endsWith(text)).toBe(true);
      }),
    );
  });
});

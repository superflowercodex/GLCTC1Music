import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { barToPx, clampZoom, formatBarPosition, gridInBars, laneIndexAt, pxToBar, snapBar, visibleBars, ZOOM } from "./timeline";
import { newProject } from "../../project/model";

describe("snapBar", () => {
  it("lands on grid lines and never before bar 1", () => {
    fc.assert(
      fc.property(fc.double({ min: -5, max: 200, noNaN: true }), fc.constantFrom(0.0625, 0.125, 0.25, 0.5, 1), (bar, grid) => {
        const s = snapBar(bar, grid, true);
        const steps = (s - 1) / grid;
        return s >= 1 && Math.abs(steps - Math.round(steps)) < 1e-9;
      }),
    );
  });

  it("is a no-op apart from clamping when off", () => {
    expect(snapBar(3.37, 0.25, false)).toBe(3.37);
    expect(snapBar(-2, 0.25, false)).toBe(1);
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 100, noNaN: true }), (bar) => snapBar(snapBar(bar, 0.25, true), 0.25, true) === snapBar(bar, 0.25, true)),
    );
  });

  it("rounds to the nearest line", () => {
    expect(snapBar(2.1, 0.25, true)).toBe(2);
    expect(snapBar(2.2, 0.25, true)).toBe(2.25);
  });
});

describe("conversion", () => {
  it("round-trips bars and pixels", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.integer({ min: 40, max: 400 }),
        (bar, ppb) => Math.abs(pxToBar(barToPx(bar, ppb), ppb) - bar) < 1e-9,
      ),
    );
  });

  it("converts beat grids to bars for any time signature", () => {
    expect(gridInBars(1, 4)).toBe(0.25);
    expect(gridInBars(1, 3)).toBeCloseTo(1 / 3, 9);
    expect(gridInBars(0, 7)).toBe(1);
  });

  it("keeps zoom inside the old DAW's range", () => {
    fc.assert(fc.property(fc.double({ min: -100, max: 500, noNaN: true }), (z) => clampZoom(z) >= ZOOM.min && clampZoom(z) <= ZOOM.max));
  });
});

describe("layout helpers", () => {
  it("shows at least 8 bars and always room past the last clip", () => {
    expect(visibleBars(newProject())).toBe(8);
  });

  it("formats whole and fractional bars", () => {
    expect(formatBarPosition(5)).toBe("5");
    expect(formatBarPosition(5.25)).toBe("5.25");
  });

  it("picks the lane under the pointer, sticking to the ends", () => {
    const lanes = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ];
    expect(laneIndexAt(150, lanes)).toBe(1);
    expect(laneIndexAt(-30, lanes)).toBe(0);
    expect(laneIndexAt(900, lanes)).toBe(1);
    expect(laneIndexAt(5, [])).toBe(-1);
  });
});

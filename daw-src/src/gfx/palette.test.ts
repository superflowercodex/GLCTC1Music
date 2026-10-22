import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BRAND, hexToHsl, hueGap, mixHex, projectPalette } from "./palette";

const hex = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })).map((rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`);

describe("projectPalette", () => {
  it("lights the demo song in magenta, violet and cyan", () => {
    const demo = ["#8e7cff", "#7cf0c0", "#79ebff", "#ff63d8", "#f2c14e", "#5fe3a1"];
    expect(projectPalette(demo, "demo")).toEqual({ a1: "#ff63d8", a2: "#79ebff", a3: "#8e7cff" });
  });

  it("gives a project of gold tracks a gold accent", () => {
    const { h } = hexToHsl(projectPalette(["#f2c14e", "#f5c955"], "x").a1);
    expect(h).toBeGreaterThan(35);
    expect(h).toBeLessThan(50);
  });

  it("is stable for the same project and falls back to a mood when there are no tracks", () => {
    expect(projectPalette([], "proj-abc")).toEqual(projectPalette([], "proj-abc"));
    expect(projectPalette([], "proj-abc").a1).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("always returns three light, clearly different colours", () => {
    fc.assert(
      fc.property(fc.array(hex, { maxLength: 12 }), fc.string(), (colors, seed) => {
        const p = projectPalette(colors, seed);
        const hsl = [p.a1, p.a2, p.a3].map(hexToHsl);
        for (const c of hsl) expect(c.l).toBeGreaterThanOrEqual(0.59);
        expect(hueGap(hsl[0].h, hsl[1].h)).toBeGreaterThanOrEqual(30);
        expect(hueGap(hsl[0].h, hsl[2].h)).toBeGreaterThanOrEqual(30);
      }),
    );
  });

  it("ignores values that are not hex colours", () => {
    expect(projectPalette(["var(--x)", "red"], "s")).toEqual(projectPalette([], "s"));
  });
});

describe("mixHex", () => {
  it("returns the ends at 0 and 1", () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        expect(mixHex(a, b, 0)).toBe(a);
        expect(mixHex(a, b, 1)).toBe(b);
      }),
    );
  });
  it("keeps the brand palette parseable", () => {
    expect(() => mixHex(BRAND.a1, BRAND.a2, 0.5)).not.toThrow();
  });
});

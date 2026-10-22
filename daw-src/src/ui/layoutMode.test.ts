import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { COMPACT_MAX_W, layoutModeFor, LayoutSizeError, PHONE_MAX_H, PHONE_MAX_W } from "./layoutMode";

describe("layoutModeFor", () => {
  it("names the test devices", () => {
    expect(layoutModeFor(390, 844)).toBe("phone");
    expect(layoutModeFor(360, 740)).toBe("phone");
    expect(layoutModeFor(430, 932)).toBe("phone");
    expect(layoutModeFor(844, 390)).toBe("phone");
    expect(layoutModeFor(768, 1024)).toBe("tablet");
    expect(layoutModeFor(1000, 700)).toBe("tablet");
    expect(layoutModeFor(1001, 700)).toBe("desktop");
    expect(layoutModeFor(1440, 900)).toBe("desktop");
  });

  it("keeps every window wider than the compact limit on the desktop layout, however short", () => {
    fc.assert(fc.property(fc.integer({ min: COMPACT_MAX_W + 1, max: 8000 }), fc.integer({ min: 1, max: 8000 }), (w, h) => layoutModeFor(w, h) === "desktop"));
  });

  it("is a phone whenever the window is narrow or short (and not desktop wide)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: COMPACT_MAX_W }), fc.integer({ min: 1, max: 8000 }), (w, h) => {
        const phone = w <= PHONE_MAX_W || h <= PHONE_MAX_H;
        return layoutModeFor(w, h) === (phone ? "phone" : "tablet");
      }),
    );
  });

  it("refuses sizes that are not a viewport", () => {
    expect(() => layoutModeFor(0, 800)).toThrow(LayoutSizeError);
    expect(() => layoutModeFor(390, Number.NaN)).toThrow(LayoutSizeError);
  });
});

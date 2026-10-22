import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tipPosition } from "./tooltip";
import { fadeEdges } from "./useEdgeFade";

describe("fadeEdges", () => {
  it("fades only the edges that still have content beyond them", () => {
    expect(fadeEdges(0, 500, 500)).toBe("");
    expect(fadeEdges(0, 500, 900)).toBe("end");
    expect(fadeEdges(400, 500, 900)).toBe("start");
    expect(fadeEdges(200, 500, 900)).toBe("start end");
  });

  it("never fades a region that does not scroll", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 4000 }), (size) => {
        expect(fadeEdges(0, size, size)).toBe("");
      }));
  });
});

describe("tipPosition", () => {
  const viewport = { width: 1280, height: 720 };

  it("sits above the target, centred, when there is room", () => {
    const pos = tipPosition({ left: 600, top: 300, width: 80, bottom: 330 }, { width: 120, height: 28 }, viewport);
    expect(pos.below).toBe(false);
    expect(pos.left).toBe(580);
    expect(pos.top + 28).toBeLessThan(300);
  });

  it("flips below near the top edge", () => {
    const pos = tipPosition({ left: 600, top: 10, width: 80, bottom: 40 }, { width: 120, height: 28 }, viewport);
    expect(pos.below).toBe(true);
    expect(pos.top).toBeGreaterThan(40);
  });

  it("always stays inside the viewport and never covers the target from above", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1200 }), fc.integer({ min: 0, max: 680 }), fc.integer({ min: 4, max: 80 }), fc.integer({ min: 20, max: 260 }), (x, y, w, tw) => {
        const target = { left: x, top: y, width: w, bottom: y + 24 };
        const pos = tipPosition(target, { width: tw, height: 28 }, viewport);
        expect(pos.left).toBeGreaterThanOrEqual(8);
        expect(pos.left + tw).toBeLessThanOrEqual(viewport.width - 8 + 0.001);
        if (!pos.below) expect(pos.top + 28).toBeLessThanOrEqual(target.top);
      }),
    );
  });
});

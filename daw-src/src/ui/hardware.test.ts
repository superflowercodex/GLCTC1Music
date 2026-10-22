import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { keybedLayout, noteName } from "./hardware";

describe("keybedLayout", () => {
  it("lays out a two-octave C-to-C bed as 15 whites and 10 blacks", () => {
    const { whites, blacks } = keybedLayout(48, 72);
    expect(whites).toHaveLength(15);
    expect(blacks.map((b) => b.note)).toEqual([49, 51, 54, 56, 58, 61, 63, 66, 68, 70]);
  });

  it("covers every note once, and every black key sits strictly inside the white row", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 }), fc.integer({ min: 1, max: 48 }), (low, span) => {
        const high = low + span;
        const { whites, blacks } = keybedLayout(low, high);
        const all = [...whites, ...blacks.map((b) => b.note)].sort((a, b) => a - b);
        const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);
        // A black key at either end has no white beyond it, so it is dropped rather than drawn off the edge.
        expect(all.length).toBe(span + 1 - (isBlack(low) ? 1 : 0) - (isBlack(high) ? 1 : 0));
        expect(new Set(all).size).toBe(all.length);
        for (const b of blacks) {
          expect(b.x).toBeGreaterThan(0);
          expect(b.x).toBeLessThan(whites.length);
        }
      }),
    );
  });
});

describe("noteName", () => {
  it("uses scientific pitch with middle C as C4", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C♯4");
    expect(noteName(21)).toBe("A0");
  });
});

describe("GlassWindow", () => {
  it("is the layout container itself and draws nothing of its own", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { GlassWindow } = await import("./hardware");
    const html = renderToStaticMarkup(createElement(GlassWindow, { className: "ac-grid", children: createElement("button", null, "Step") }));
    expect(html).toBe('<div class="glass-win ac-grid"><button>Step</button></div>');
  });

  it("draws an area on the sheet with no brackets, cover or screws", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { Faceplate } = await import("./hardware");
    const html = renderToStaticMarkup(createElement(Faceplate, { label: "Sound", color: "#ff63d8", children: "x" }));
    expect(html).toContain("--k:#ff63d8");
    expect(html).not.toMatch(/hud|gw-glass|screw/);
  });
});

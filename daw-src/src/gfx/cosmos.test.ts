import { describe, expect, it } from "vitest";
import { INSTRUMENTS } from "../audio/instruments/registry";
import { ROOMS } from "../rooms";
import { ambienceFor } from "./ambience";
import { parseHex } from "./auroraShader";
import { STAR_AREA, starField } from "./stars";

describe("starField", () => {
  it("is deterministic and stays inside the viewport", () => {
    const a = starField(1280, 720);
    expect(a).toEqual(starField(1280, 720));
    expect(a.length).toBe(Math.round((1280 * 720) / STAR_AREA));
    for (const s of a) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1280);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(720);
      expect(s.alpha).toBeLessThanOrEqual(1);
    }
  });
  it("keeps bright stars rare so the sky never reads as glitter", () => {
    const bright = starField(1920, 1080).filter((s) => s.r > 0.9);
    expect(bright.length / starField(1920, 1080).length).toBeLessThan(0.05);
  });
});

describe("ambienceFor", () => {
  it("gives every room and instrument a parseable accent and an on-screen focus", () => {
    const routes = [...ROOMS.map((r) => ({ room: r.id })), ...INSTRUMENTS.map((i) => ({ room: "play" as const, sub: i.kind }))];
    for (const route of routes) {
      const color = route.room === "play" ? INSTRUMENTS.find((i) => i.kind === (route as { sub?: string }).sub)?.color : undefined;
      const a = ambienceFor(route, color);
      expect(() => parseHex(a.accent)).not.toThrow();
      for (const v of a.focus) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
  it("lights an instrument room in the instrument's own colour", () => {
    expect(ambienceFor({ room: "play", sub: "pad64" }, "#ff63d8").accent).toBe("#ff63d8");
  });
});

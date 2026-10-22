import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ROOMS } from "../rooms";
import { BRAND, CURATED, hexToHsl } from "./palette";
import {
  BASE_CAP,
  brightnessCap,
  envelope,
  hashSeed,
  hslRgb,
  HUE_WANDER,
  JourneyClock,
  KickFollower,
  modeScale,
  REST,
  rmsEnergy,
  sceneFor,
  sceneWeights,
  sectionEnergy,
  swell,
  twinkleRate,
  weatherAt,
  WEATHER_SLOT,
} from "./sky";

const EPOCH = 1_760_000_000;
const KINDS = ["intro", "build", "drop", "break", "outro"] as const;

function hueOf([r, g, b]: number[]): number {
  const hex = `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
  return hexToHsl(hex).h;
}
const gap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe("hashSeed", () => {
  it("is stable and spreads nearby ids apart", () => {
    expect(hashSeed("proj-abc")).toBe(hashSeed("proj-abc"));
    expect(hashSeed("proj-abc")).not.toBe(hashSeed("proj-abd"));
    fc.assert(fc.property(fc.string(), (s) => {
      const h = hashSeed(s);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    }));
  });
});

describe("JourneyClock", () => {
  it("is deterministic per project and different between projects", () => {
    const a = new JourneyClock(hashSeed("one"), BRAND).at(EPOCH);
    expect(new JourneyClock(hashSeed("one"), BRAND).at(EPOCH)).toEqual(a);
    expect(new JourneyClock(hashSeed("two"), BRAND).at(EPOCH)).not.toEqual(a);
  });

  it("keeps every pool near its own palette colour, so the pools never merge into one hue", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), fc.integer({ min: 0, max: 10_000_000 }), fc.constantFrom(...CURATED), (seed, dt, palette) => {
      const j = new JourneyClock(seed, palette).at(EPOCH + dt);
      const homes = [palette.a2, palette.a3, palette.a1].map((c) => hexToHsl(c).h);
      j.colors.forEach((c, i) => {
        for (const v of c) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        const next = homes[(i + 1) % 3];
        // Within its wander of home, or on its way to visit the next palette colour.
        expect(Math.min(gap(hueOf(c), homes[i]), gap(hueOf(c), next) + HUE_WANDER)).toBeLessThanOrEqual(HUE_WANDER + gap(homes[i], next) * 0.5 + 1);
      });
    }));
  });

  it("changes slowly: a 1/15 s frame never moves a colour by more than a hair", () => {
    const clock = new JourneyClock(hashSeed("demo"), BRAND);
    for (let t = 0; t < 3600; t += 37) {
      const a = clock.at(EPOCH + t).colors;
      const b = clock.at(EPOCH + t + 1 / 15).colors;
      for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) expect(Math.abs(a[i][k] - b[i][k])).toBeLessThan(0.002);
    }
  });

  it("never comes back to the same sky over an hour", () => {
    const clock = new JourneyClock(hashSeed("demo"), BRAND);
    const start = clock.at(EPOCH);
    const key = (t: number) => {
      const j = clock.at(EPOCH + t);
      return [...j.colors.flat(), ...j.pools.flatMap((p) => [p.dx, p.dy, p.size])];
    };
    const s = key(0);
    for (let t = 60; t < 3600; t += 60) {
      const d = key(t).reduce((sum, v, i) => sum + Math.abs(v - s[i]), 0);
      expect(d).toBeGreaterThan(0.02);
    }
    expect(start.pools.every((p) => p.size > 0.7 && p.size < 1.3)).toBe(true);
  });
});

describe("hslRgb", () => {
  it("round-trips hues through the palette's own HSL", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 359 }), (h) => {
      expect(gap(hueOf(hslRgb(h, 0.9, 0.65)), h)).toBeLessThan(2);
    }));
  });
});

describe("weather", () => {
  it("eases in and out with no step at either end", () => {
    expect(envelope(0, 0, 40)).toBe(0);
    expect(envelope(40, 0, 40)).toBe(0);
    expect(envelope(20, 0, 40)).toBeCloseTo(1);
    for (let t = 0; t < 40; t += 0.1) expect(Math.abs(envelope(t + 0.1, 0, 40) - envelope(t, 0, 40))).toBeLessThan(0.02);
  });

  it("is deterministic, bounded and occasional", () => {
    const seed = hashSeed("demo");
    let active = 0;
    let samples = 0;
    for (let t = EPOCH; t < EPOCH + 3 * 3600; t += 5) {
      const w = weatherAt(seed, t);
      expect(w).toEqual(weatherAt(seed, t));
      for (const v of [w.cloud, w.shafts, w.dust]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      if (Math.max(w.cloud, w.shafts, w.dust) > 0.3) active++;
      samples++;
    }
    // Weather some of the time, clear sky most of the time.
    expect(active / samples).toBeGreaterThan(0.1);
    expect(active / samples).toBeLessThan(0.6);
  });

  it("never jumps between frames, even across a slot boundary", () => {
    const seed = hashSeed("x");
    for (let t = EPOCH; t < EPOCH + 20 * WEATHER_SLOT; t += 0.5) {
      const a = weatherAt(seed, t);
      const b = weatherAt(seed, t + 0.5);
      expect(Math.abs(a.cloud - b.cloud) + Math.abs(a.shafts - b.shafts) + Math.abs(a.dust - b.dust)).toBeLessThan(0.08);
    }
  });
});

describe("energy mapping", () => {
  it("orders the sections the way the music feels", () => {
    const mid = (k: (typeof KINDS)[number]) => sectionEnergy(k, 0.5);
    expect(mid("drop").energy).toBeGreaterThan(mid("build").energy);
    expect(mid("build").energy).toBeGreaterThan(mid("intro").energy);
    expect(mid("break").energy).toBeLessThan(REST.energy);
    expect(mid("intro").warmth).toBeLessThan(0);
    expect(sectionEnergy("build", 1).warmth).toBeGreaterThan(sectionEnergy("build", 0).warmth);
    expect(sectionEnergy("outro", 1).energy).toBeLessThan(sectionEnergy("outro", 0).energy);
    expect(mid("drop").wide).toBe(1);
    expect(mid("break").sparse).toBe(1);
  });

  it("stays in range for any progress, including outside the section", () => {
    fc.assert(fc.property(fc.constantFrom(...KINDS), fc.double({ min: -2, max: 3, noNaN: true }), (kind, u) => {
      const e = sectionEnergy(kind, u);
      expect(e.energy).toBeGreaterThanOrEqual(0);
      expect(e.energy).toBeLessThanOrEqual(1);
      expect(Math.abs(e.warmth)).toBeLessThanOrEqual(1);
    }));
  });

  it("falls back to loudness when sections have no kind", () => {
    expect(rmsEnergy(0.3, 0.3).energy).toBeGreaterThan(rmsEnergy(0.1, 0.3).energy);
    expect(rmsEnergy(0, 0).energy).toBeGreaterThanOrEqual(0);
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (s, p) => {
      const e = rmsEnergy(s, p);
      expect(e.energy).toBeGreaterThanOrEqual(0);
      expect(e.energy).toBeLessThanOrEqual(1);
    }));
  });

  it("swells softly and never past its cap", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 50, noNaN: true }), (l) => {
      expect(swell(l, 1)).toBeLessThanOrEqual(1);
    }));
    expect(swell(0.2)).toBeGreaterThan(swell(0.1));
  });
});

describe("KickFollower", () => {
  it("breathes on a kick over several frames and settles between kicks, never strobing", () => {
    const k = new KickFollower();
    const dt = 1 / 30;
    let peak = 0;
    let firstFrame = 0;
    // 120 bpm: a kick every 15 frames, a quiet floor between.
    for (let f = 0; f < 300; f++) {
      const bass = f % 15 < 2 ? 0.9 : 0.2;
      const v = k.step(bass, dt);
      if (f === 150) firstFrame = v;
      peak = Math.max(peak, v);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(peak).toBeGreaterThan(0.3);
    // The very first frame of a kick only takes part of the way up.
    expect(firstFrame).toBeLessThan(peak);
    // Silence lets it fall away.
    let v = 0;
    for (let f = 0; f < 60; f++) v = k.step(0, dt);
    expect(v).toBeLessThan(0.05);
  });
});

describe("rooms and safety", () => {
  it("gives every room its own scene with exactly one weight lit", () => {
    const scenes = new Set(ROOMS.map((r) => sceneFor({ room: r.id }, false)));
    scenes.add(sceneFor({ room: "play", sub: "pad64" }, true));
    expect(scenes.size).toBe(6);
    for (const s of scenes) expect(sceneWeights(s).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("caps brightness at most 15% above the resting cap, plus a brief bloom", () => {
    expect(brightnessCap(REST.energy, 0)).toBeCloseTo(BASE_CAP);
    fc.assert(fc.property(fc.double({ min: -1, max: 2, noNaN: true }), fc.double({ min: -1, max: 2, noNaN: true }), (e, b) => {
      const cap = brightnessCap(e, b);
      expect(cap).toBeGreaterThanOrEqual(BASE_CAP - 1e-9);
      expect(cap).toBeLessThanOrEqual(BASE_CAP * 1.21 + 1e-9);
      expect(brightnessCap(e, 0)).toBeLessThanOrEqual(BASE_CAP * 1.15 + 1e-9);
    }));
  });

  it("Still freezes, Calm is slower and gentler, and twinkles follow the tempo", () => {
    expect(modeScale("still")).toEqual({ speed: 0, react: 0, weather: 0 });
    expect(modeScale("calm").speed).toBeLessThan(modeScale("alive").speed);
    expect(modeScale("calm").react).toBeLessThan(modeScale("alive").react);
    expect(twinkleRate(null, "alive")).toBe(1);
    expect(twinkleRate(140, "alive")).toBeGreaterThan(twinkleRate(90, "alive"));
    expect(twinkleRate(300, "alive")).toBeLessThanOrEqual(1.7);
    expect(twinkleRate(140, "still")).toBe(0);
    expect(Math.abs(twinkleRate(170, "calm") - 0.6)).toBeLessThan(Math.abs(twinkleRate(170, "alive") - 1));
  });
});

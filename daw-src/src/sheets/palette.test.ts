import { describe, expect, it } from "vitest";
import { buildPaletteItems, matchScore, searchPalette, type PaletteContext } from "./palette";
import { displayKeys, SHORTCUT_GROUPS } from "./shortcutList";

const ran: string[] = [];
const ctx = (patch: Partial<PaletteContext> = {}): PaletteContext => ({
  mac: true,
  run: (a) => void ran.push(a),
  clipBpm: 128,
  tempo: 120,
  instruments: [
    { kind: "drum80la8", name: "80LA8", tagline: "Drum machine" },
    { kind: "galacticOne", name: "Galactic One", tagline: "Full workstation synth" },
  ],
  openInstrument: (k) => void ran.push(`open:${k}`),
  presets: [{ id: "p1", name: "Warm Pad", instrumentName: "Galactic One", load: () => void ran.push("preset:p1") }],
  loopOn: false,
  metronomeOn: false,
  ...patch,
});

const labels = (q: string, c = ctx()) => searchPalette(buildPaletteItems(c), q).map((i) => i.label);

describe("matchScore", () => {
  it("matches words, substrings and letters in order", () => {
    expect(matchScore("tempo", "Tap tempo")).not.toBeNull();
    expect(matchScore("tpt", "Tap tempo")).not.toBeNull();
    expect(matchScore("zzz", "Tap tempo")).toBeNull();
    expect(matchScore("", "anything")).toBe(0);
  });

  it("prefers matches at the start of a word", () => {
    expect(matchScore("map", "Map")!).toBeGreaterThan(matchScore("map", "Roadmap")!);
    expect(matchScore("tem", "Tap tempo")!).toBeGreaterThan(matchScore("emp", "Tap tempo")!);
  });
});

describe("search", () => {
  it("finds tempo actions first, including the clip's BPM", () => {
    const found = labels("tempo");
    expect(found.slice(0, 3)).toContain("Tap tempo");
    expect(found).toContain("Set project tempo to clip’s detected BPM");
    expect(found).toContain("Halve or double tempo");
  });

  it("hides the clip tempo action when no clip has one", () => {
    expect(labels("tempo", ctx({ clipBpm: null }))).not.toContain("Set project tempo to clip’s detected BPM");
  });

  it("finds rooms, instruments and presets", () => {
    expect(labels("mixer")[0]).toBe("Mixer");
    expect(labels("galactic")).toContain("Galactic One");
    expect(labels("warm")).toEqual(["Warm Pad"]);
  });

  it("keeps each group together so headings can be drawn once", () => {
    const groups = searchPalette(buildPaletteItems(ctx()), "o").map((i) => i.group);
    const seen: string[] = [];
    for (const g of groups) if (seen[seen.length - 1] !== g) seen.push(g);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("starts with actions when the query is empty", () => {
    expect(searchPalette(buildPaletteItems(ctx()), "")[0].group).toBe("Actions");
  });

  it("shows a short list for an empty query and nothing for nonsense", () => {
    const start = labels("");
    expect(start.length).toBeGreaterThan(5);
    expect(start.length).toBeLessThan(20);
    expect(labels("qqqqzz")).toEqual([]);
  });

  it("runs the action behind an item", () => {
    ran.length = 0;
    searchPalette(buildPaletteItems(ctx()), "tap")[0].run();
    expect(ran).toEqual(["tap-tempo"]);
    searchPalette(buildPaletteItems(ctx()), "Galactic One").find((i) => i.group === "Instruments")!.run();
    expect(ran).toContain("open:galacticOne");
  });

  it("shows the right shortcut for the platform", () => {
    expect(searchPalette(buildPaletteItems(ctx({ mac: true })), "mixer")[0].hint).toBe("⌘3");
    expect(searchPalette(buildPaletteItems(ctx({ mac: false })), "mixer")[0].hint).toBe("Ctrl+3");
  });
});

describe("displayKeys", () => {
  it("formats Mac and other platforms", () => {
    expect(displayKeys("shift+mod+z", true)).toBe("⇧⌘Z");
    expect(displayKeys("shift+mod+z", false)).toBe("Ctrl+Shift+Z");
    expect(displayKeys("mod+x c v", true)).toBe("⌘X C V");
    expect(displayKeys("space", false)).toBe("Space");
    expect(displayKeys("backspace", true)).toBe("⌫");
  });

  it("every listed shortcut has text", () => {
    for (const g of SHORTCUT_GROUPS) for (const s of g.items) expect(displayKeys(s.keys, true).length).toBeGreaterThan(0);
  });
});

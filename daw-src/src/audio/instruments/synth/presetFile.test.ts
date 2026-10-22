import { describe, expect, it } from "vitest";
import { Acid30lee } from "../acid30lee";
import { GalacticOne } from "../galacticOne";
import { exportPresetText, importPresetText, parsePresetText, PresetFileError } from "./presetFile";
import { offlineContext } from "./testUtils";

describe("preset files", () => {
  it("round-trips an exported sound and its pattern into another instance", () => {
    const a = new Acid30lee(offlineContext(1));
    a.setParam("cutoff", 2222);
    a.setStep(1, 3, { on: true, note: 40 });
    const text = exportPresetText(a, "My squelch");
    const b = new Acid30lee(offlineContext(1));
    expect(importPresetText(b, text)).toBe("My squelch");
    expect(b.getParam("cutoff")).toBe(2222);
    expect(b.getStep(1, 3).note).toBe(40);
    expect(b.presets.some((p) => p.name === "My squelch" && !p.factory)).toBe(true);
  });

  it("rejects text that is not JSON, the wrong instrument, unknown settings and bad numbers", () => {
    const acid = new Acid30lee(offlineContext(1));
    const go = new GalacticOne(offlineContext(1));
    expect(() => parsePresetText("{nope", acid)).toThrow(PresetFileError);
    expect(() => parsePresetText("{}", acid)).toThrow(/not a GLCTC1/);
    expect(() => parsePresetText(exportPresetText(go, "x"), acid)).toThrow(/galacticOne/);
    const file = JSON.parse(exportPresetText(acid, "x"));
    file.preset.values.bogus = 1;
    expect(() => parsePresetText(JSON.stringify(file), acid)).toThrow(/bogus/);
    delete file.preset.values.bogus;
    file.preset.values.cutoff = "loud";
    expect(() => parsePresetText(JSON.stringify(file), acid)).toThrow(/not a number/);
  });

  it("clamps out-of-range values instead of trusting them", () => {
    const acid = new Acid30lee(offlineContext(1));
    const file = JSON.parse(exportPresetText(acid, "x"));
    file.preset.values.cutoff = 9e9;
    expect(parsePresetText(JSON.stringify(file), acid).values.cutoff).toBe(12000);
  });

  it("restores the previous sound when the pattern data inside is damaged", () => {
    const acid = new Acid30lee(offlineContext(1));
    acid.setParam("cutoff", 1111);
    const file = JSON.parse(exportPresetText(acid, "x"));
    file.preset.values.cutoff = 5000;
    file.preset.data = "garbage";
    expect(() => importPresetText(acid, JSON.stringify(file))).toThrow(/could not be loaded/);
    expect(acid.getParam("cutoff")).toBe(1111);
  });
});

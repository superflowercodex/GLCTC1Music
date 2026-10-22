import { describe, expect, it } from "vitest";
import { CURRENT_PROJECT_VERSION, MigrationError, migrateProject, remapAssetIds, type MigrationRegistry } from "./migrate";
import { newProject } from "./model";

describe("migrateProject", () => {
  it("passes a current project through unchanged", () => {
    const p = newProject("A");
    expect(migrateProject(p)).toEqual(p);
    expect(CURRENT_PROJECT_VERSION).toBe(p.v);
  });

  it("rejects projects from a newer studio with a reason a person can act on", () => {
    expect(() => migrateProject({ ...newProject(), v: 99 })).toThrow(/newer version/);
  });

  it("rejects missing or invalid versions and non-objects", () => {
    expect(() => migrateProject({ ...newProject(), v: undefined })).toThrow(MigrationError);
    expect(() => migrateProject({ ...newProject(), v: 0 })).toThrow(/version/);
    expect(() => migrateProject("nope")).toThrow(/not a project/);
  });

  it("names the damaged field when the shape is wrong", () => {
    expect(() => migrateProject({ ...newProject(), tracks: "x" })).toThrow(/"tracks"/);
    expect(() => migrateProject({ ...newProject(), tracks: [{ id: "t" }] })).toThrow(/track/);
  });

  it("applies registered steps in order, so future versions slot in", () => {
    const registry: MigrationRegistry = {
      1: (p) => ({ ...p, key: `${String(p.key)}+1to2` }),
      2: (p) => ({ ...p, key: `${String(p.key)}+2to3` }),
    };
    const out = migrateProject({ ...newProject(), key: "C" }, registry, 3);
    expect(out.key).toBe("C+1to2+2to3");
    expect(out.v).toBe(3 as never);
  });

  it("fails clearly when a step is missing", () => {
    expect(() => migrateProject(newProject(), {}, 2)).toThrow(/No upgrade path from project format 1/);
  });
});

describe("remapAssetIds", () => {
  it("gives every asset a fresh id and repoints clips", () => {
    const p = newProject();
    p.assets.push({ id: "a1", kind: "audio", name: "x", mime: "audio/wav", bytes: 1, addedAt: 0 });
    p.tracks.push({
      id: "t1", name: "T", kind: "audio", color: "#fff", muted: false, solo: false, gainDb: 0, pan: 0, sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, automation: [],
      clips: [{ id: "c1", kind: "audio", name: "c", startBar: 1, lengthBars: 1, assetId: "a1", offsetSec: 0, gainDb: 0, pitchSemitones: 0, fineCents: 0, warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0 }],
    });
    const { project, idMap } = remapAssetIds(p);
    const fresh = idMap.get("a1");
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe("a1");
    expect(project.assets[0]?.id).toBe(fresh);
    expect(project.tracks[0]?.clips[0]?.assetId).toBe(fresh);
    expect(p.assets[0]?.id).toBe("a1");
  });
});

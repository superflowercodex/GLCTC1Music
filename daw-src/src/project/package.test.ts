import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportProjectPackage, importPackageFile, PackageError, parsePackageText, type Ask, type PackageIo } from "./package";
import { newProject, type Asset, type Clip, type Project, type Track } from "./model";

const clip = (assetId?: string): Clip => ({
  id: `clip-${Math.random()}`, kind: "audio", name: "c", startBar: 1, lengthBars: 2, ...(assetId ? { assetId } : {}), offsetSec: 0, gainDb: 0, pitchSemitones: 0, fineCents: 0, warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0,
});

const track = (id: string, clips: Clip[]): Track => ({
  id, name: id, kind: "audio", color: "#fff", muted: false, solo: false, gainDb: 0, pan: 0, sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, clips, automation: [],
});

const mediaArb = fc.uint8Array({ minLength: 0, maxLength: 300 });

const projectArb = fc
  .record({
    name: fc.string({ maxLength: 20 }),
    bpm: fc.integer({ min: 30, max: 300 }),
    media: fc.array(mediaArb, { maxLength: 4 }),
    samples: fc.array(fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 40 }), { maxLength: 3 }),
    bytes: fc.uint8Array({ maxLength: 40 }),
  })
  .map(({ name, bpm, media, samples, bytes }) => {
    const base = newProject(name);
    const assets: Asset[] = media.map((m, i) => ({ id: `asset-${i}`, kind: "audio", name: `f${i}.wav`, mime: "audio/wav", bytes: m.length, addedAt: i }));
    const project: Project = {
      ...base,
      bpm,
      assets,
      tracks: [track("t1", assets.map((a) => clip(a.id)))],
      instruments: [
        {
          id: "slot-1",
          kind: "looper",
          trackId: "t1",
          // Looper and Divine09 samples live in instrument data; the old package format dropped them.
          state: { kind: "looper", values: { gain: 1 }, data: { pads: samples.map((s) => ({ name: "pad", buffer: new Float32Array(s) })), raw: bytes, nested: [[{ x: 1 }]] } },
        },
      ],
    };
    return { project, media };
  });

function io(overrides: Partial<PackageIo> & { committed?: Array<{ project: Project; media: ReadonlyMap<string, Blob>; mode: string }> } = {}): PackageIo {
  const committed = overrides.committed ?? [];
  return {
    ask: async () => "cancel",
    hasProject: async () => false,
    commit: async (project, media, mode) => {
      committed.push({ project, media, mode });
    },
    ...overrides,
  };
}

async function exportOf(project: Project, media: Uint8Array[]): Promise<Blob> {
  const exported = await exportProjectPackage(project, async (id) => {
    const i = Number(id.split("-")[1]);
    const bytes = media[i];
    return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" }) : undefined;
  });
  expect(exported.missing).toEqual([]);
  expect(exported.fileName.endsWith(".glctc1studio")).toBe(true);
  return exported.blob;
}

describe("package round trip", () => {
  it("restores any project with its media and instrument samples (property)", async () => {
    await fc.assert(
      fc.asyncProperty(projectArb, async ({ project, media }) => {
        const blob = await exportOf(project, media);
        const parsed = parsePackageText(await blob.text());
        expect(parsed.project).toEqual(project);
        expect(parsed.media.size).toBe(media.length);
        for (const [i, bytes] of media.entries()) {
          const restored = parsed.media.get(`asset-${i}`);
          expect(restored).toBeDefined();
          expect(new Uint8Array((await restored?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(bytes);
          expect(restored?.type).toBe("audio/wav");
        }
        expect(parsed.report.skipped).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("carries a Blob sample inside instrument data", async () => {
    const project = newProject("Blobby");
    project.instruments.push({ id: "s", kind: "divine09", trackId: "t", state: { kind: "divine09", values: {}, data: { slots: [{ name: "kick", file: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }) }] } } });
    const exported = await exportProjectPackage(project, async () => undefined);
    const parsed = parsePackageText(await exported.blob.text());
    const data = parsed.project.instruments[0]?.state.data as { slots: Array<{ file: Blob }> };
    expect(data.slots[0]?.file.type).toBe("audio/wav");
    expect(new Uint8Array(await data.slots[0]!.file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reports media that was not on the device instead of dropping it silently", async () => {
    const p = { ...newProject("Gap"), assets: [{ id: "asset-9", kind: "audio" as const, name: "gone.wav", mime: "audio/wav", bytes: 1, addedAt: 0 }] };
    const exported = await exportProjectPackage(p, async () => undefined);
    expect(exported.missing).toEqual(["gone.wav"]);
    const parsed = parsePackageText(await exported.blob.text());
    expect(parsed.report.skipped[0]).toMatch(/gone\.wav/);
  });
});

describe("package validation", () => {
  it.each([
    ["not json", "{nope", /could not be read as JSON/],
    ["an array", "[]", /not in the expected shape/],
    ["an unrelated object", '{"hello":1}', /not a GLCTC1 project package/],
    ["a newer package", '{"format":"glctc1studio-package","packageVersion":9}', /newer studio/],
  ])("rejects %s with a clear message", (_name, text, pattern) => {
    expect(() => parsePackageText(text)).toThrow(pattern);
    expect(() => parsePackageText(text)).toThrow(PackageError);
  });

  it("rejects a package whose project is damaged", async () => {
    const exported = await exportProjectPackage(newProject("X"), async () => undefined);
    const file = JSON.parse(await exported.blob.text()) as { project: Record<string, unknown> };
    file.project.tracks = 5;
    expect(() => parsePackageText(JSON.stringify(file))).toThrow(/"tracks"/);
  });

  it("rejects corrupt base64 media", async () => {
    const p = { ...newProject("X"), assets: [{ id: "asset-0", kind: "audio" as const, name: "a.wav", mime: "audio/wav", bytes: 1, addedAt: 0 }] };
    const exported = await exportProjectPackage(p, async () => new Blob([new Uint8Array([1])]));
    const file = JSON.parse(await exported.blob.text()) as { media: Record<string, { b64: string }> };
    file.media["asset-0"] = { b64: "!!!not base64!!!" };
    expect(() => parsePackageText(JSON.stringify(file))).toThrow(/damaged/);
  });
});

describe("importing and id collisions", () => {
  const packageOf = async (p: Project): Promise<Blob> => (await exportProjectPackage(p, async () => new Blob(["x"]))).blob;
  const withAsset = (): Project => ({ ...newProject("Song"), assets: [{ id: "asset-0", kind: "audio", name: "a.wav", mime: "audio/wav", bytes: 1, addedAt: 0 }], tracks: [track("t", [clip("asset-0")])] });

  it("adds a new project without asking, with fresh asset ids", async () => {
    const committed: Array<{ project: Project; media: ReadonlyMap<string, Blob>; mode: string }> = [];
    let asked = 0;
    const source = withAsset();
    const result = await importPackageFile(await packageOf(source), io({ committed, ask: async () => (asked++, "both") }));
    expect(asked).toBe(0);
    expect(result.status).toBe("added");
    const c = committed[0];
    expect(c?.mode).toBe("add");
    expect(c?.project.id).toBe(source.id);
    const newAssetId = c?.project.assets[0]?.id ?? "";
    expect(newAssetId).not.toBe("asset-0");
    expect(c?.project.tracks[0]?.clips[0]?.assetId).toBe(newAssetId);
    expect(c?.media.has(newAssetId)).toBe(true);
  });

  async function collide(choice: string): Promise<{ status: string; committed: Array<{ project: Project; mode: string }>; question?: { title: string; choices: string[] } }> {
    const committed: Array<{ project: Project; media: ReadonlyMap<string, Blob>; mode: string }> = [];
    let question: { title: string; choices: string[] } | undefined;
    const ask: Ask = async (q) => {
      question = { title: q.title, choices: q.choices.map((c) => c.id) };
      return choice;
    };
    const source = withAsset();
    const result = await importPackageFile(await packageOf(source), io({ committed, ask, hasProject: async (id) => id === source.id }));
    return { status: result.status, committed, question };
  }

  it("asks what to do when a saved project has the same id", async () => {
    const r = await collide("cancel");
    expect(r.question?.choices).toEqual(["both", "replace", "cancel"]);
    expect(r.question?.title).toContain("Song");
  });

  it("cancel stores nothing", async () => {
    const r = await collide("cancel");
    expect(r.status).toBe("cancelled");
    expect(r.committed).toHaveLength(0);
  });

  it("keep both gives the import a new id and name", async () => {
    const r = await collide("both");
    expect(r.status).toBe("kept-both");
    expect(r.committed[0]?.mode).toBe("add");
    expect(r.committed[0]?.project.name).toBe("Song (imported)");
  });

  it("replace commits over the same id", async () => {
    const r = await collide("replace");
    expect(r.status).toBe("replaced");
    expect(r.committed[0]?.mode).toBe("replace");
  });
});

describe("old .glctc1 packages", () => {
  const dataUrl = (text: string, mime = "audio/wav"): string => `data:${mime};base64,${btoa(text)}`;
  const legacyPackage = {
    version: 1,
    id: "legacy-1",
    name: "Old song",
    bpm: 128,
    timeSig: "4/4",
    master: 0.8,
    created: 1_700_000_000_000,
    updated: 1_700_000_100_000,
    tracks: [{ id: "tr1", name: "Drums", type: "audio", volume: 0.5, pan: 0.2, clips: [{ id: "c1", name: "loop", kind: "audio", start: 4, length: 8, assetId: "as1", offset: 0.5, gain: 1 }] }],
    assets: [{ id: "as1", name: "loop.wav", type: "audio", mime: "audio/wav", size: 5, duration: 3.5, bpm: 128, key: "Am", data: dataUrl("hello") }],
  };

  it("is read into the new model with its media", async () => {
    const parsed = parsePackageText(JSON.stringify(legacyPackage));
    expect(parsed.project.name).toBe("Old song");
    expect(parsed.project.id).not.toBe("legacy-1");
    expect(parsed.project.tracks[0]?.clips[0]?.startBar).toBe(2);
    expect(parsed.project.assets[0]?.detectedBpm).toBe(128);
    const id = parsed.project.assets[0]?.id ?? "";
    expect(await parsed.media.get(id)?.text()).toBe("hello");
  });

  it("goes through the same import path", async () => {
    const committed: Array<{ project: Project; media: ReadonlyMap<string, Blob>; mode: string }> = [];
    const result = await importPackageFile(new Blob([JSON.stringify(legacyPackage)]), io({ committed }));
    expect(result.status).toBe("added");
    expect(committed).toHaveLength(1);
  });

  it("rejects a damaged media entry", () => {
    const bad = { ...legacyPackage, assets: [{ ...legacyPackage.assets[0], data: "nonsense" }] };
    expect(() => parsePackageText(JSON.stringify(bad))).toThrow(PackageError);
  });
});

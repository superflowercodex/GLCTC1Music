import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_DB_NAME,
  LEGACY_PROJECT_STORE,
  convertLegacyProject,
  describeLegacyExtras,
  detectLegacyProjects,
  readAndConvertLegacyProject,
  readLegacyPlugins,
} from "./legacy";
import { migrateProject } from "./migrate";

function wait<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The project as the old studio's dbProject() stores it, written from the audit's description of the format. */
function legacyProject(): Record<string, unknown> {
  return {
    version: 1,
    id: "old-1",
    name: "Cosmic Lift (old)",
    bpm: 128,
    timeSig: "3/4",
    master: 0.8,
    created: 1_690_000_000_000,
    updated: 1_700_000_000_000,
    mfx: { on: true, flt: true, dly: false, rev: true },
    loop: { on: true, start: 3, end: 12 },
    stage: "phone",
    mixer: { hpVol: 0.5, boothVol: 0.7, hpDev: "off", boothDev: "dev-123", hpMix: 0 },
    beatLab: { patterns: [[1, 0, 1, 0]] },
    tracks: [
      {
        id: "tr-drums", name: "Drums", type: "audio", color: "#79ebff", volume: 0.5, pan: -0.25, mute: true, solo: false, send: false, cue: true,
        fx: { on: true, flt: true, dly: true, rev: true, cut: 4000, ds: 0.3, rs: 0.4 },
        clips: [
          { id: "c1", name: "Loop", kind: "audio", start: 6, length: 12, assetId: "as1", offset: 0.25, gain: 0.5, fadeIn: 1, fadeOut: 2, rate: 1.5, pitch: 3, fine: 10, warp: true, keyLock: true },
          { id: "c2", name: "Lost", kind: "audio", start: 0, length: 3, assetId: "no-blob" },
        ],
      },
      {
        id: "tr-bass", name: "Bass", type: "midi", color: "#8e7cff", volume: 1, pan: 0, inst: "Super Saw",
        clips: [{ id: "c3", name: "Bass Pattern", kind: "midi", start: 0, length: 12, notes: [{ pitch: 36, beat: 1, length: 0.5, velocity: 0.75 }, { pitch: 40, beat: 2, length: 1, velocity: 100 }] }],
      },
      { id: "tr-mod", name: "Looper · Module Track", type: "midi", looper: { sel: 0, pads: [] }, clips: [] },
      { id: "tr-auto", name: "Filter sweep", type: "auto", clips: [{ id: "c4", kind: "auto", start: 0, length: 4, target: "masterFilter", points: [] }] },
      { id: "tr-vid", name: "Video", type: "video", volume: 0.8, clips: [{ id: "c5", name: "clip.mp4", kind: "video", start: 0, length: 8, assetId: "as2" }] },
    ],
    assets: [
      { id: "as1", name: "loop.wav", type: "audio", mime: "audio/wav", size: 5, duration: 3.5, bpm: 128, key: "Am", analyzed: true, blob: new Blob(["hello"], { type: "audio/wav" }) },
      { id: "as2", name: "clip.mp4", type: "video", mime: "video/mp4", size: 3, duration: 8, blob: new Blob(["vid"], { type: "video/mp4" }) },
      { id: "no-blob", name: "ghost.wav", type: "audio", mime: "audio/wav", size: 9 },
    ],
  };
}

async function seedOld(factory: IDBFactory): Promise<void> {
  const open = factory.open(LEGACY_DB_NAME, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(LEGACY_PROJECT_STORE, { keyPath: "id" });
    open.result.createObjectStore("other");
  };
  const db = await wait(open);
  const tx = db.transaction([LEGACY_PROJECT_STORE, "other"], "readwrite");
  tx.objectStore(LEGACY_PROJECT_STORE).put(legacyProject());
  tx.objectStore(LEGACY_PROJECT_STORE).put({ ...legacyProject(), id: "old-2", name: "Second", updated: 1_600_000_000_000, assets: [], tracks: [] });
  tx.objectStore("other").put("keep me", "k");
  await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
  db.close();
}

/** Everything observable about the old database, so "untouched" means byte-identical. */
async function snapshot(factory: IDBFactory): Promise<string> {
  const names = (await factory.databases()).map((d) => `${d.name}@${d.version}`);
  if (!names.some((n) => n.startsWith(LEGACY_DB_NAME))) return JSON.stringify({ names });
  const db = await wait(factory.open(LEGACY_DB_NAME));
  const out: Record<string, unknown> = { names, version: db.version, stores: [...db.objectStoreNames] };
  for (const store of db.objectStoreNames) {
    const os = db.transaction(store, "readonly").objectStore(store);
    const rows = await wait(os.getAll());
    const keys = await wait(os.getAllKeys());
    const flat: unknown[] = [];
    for (const row of rows) flat.push(row && typeof row === "object" ? await flatten(row as Record<string, unknown>) : row);
    out[store] = { keys, rows: flat, keyPath: os.keyPath, indexes: [...os.indexNames] };
  }
  db.close();
  return JSON.stringify(out);
}

async function flatten(value: Record<string, unknown>): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v instanceof Blob) out[k] = { blob: await v.text(), type: v.type };
    else if (Array.isArray(v)) out[k] = await Promise.all(v.map((x) => (x && typeof x === "object" ? flatten(x as Record<string, unknown>) : x)));
    else out[k] = v;
  }
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("legacy reader is read-only", () => {
  it("leaves the old database byte-identical through detect, read and convert", async () => {
    const factory = new IDBFactory();
    await seedOld(factory);
    const before = await snapshot(factory);

    const found = await detectLegacyProjects(factory);
    expect(found.status).toBe("found");
    if (found.status !== "found") return;
    expect(found.projects.map((p) => p.name)).toEqual(["Cosmic Lift (old)", "Second"]);
    expect(found.projects[0]).toMatchObject({ id: "old-1", trackCount: 5, bpm: 128 });

    for (const p of found.projects) await readAndConvertLegacyProject(p.id, factory);
    await describeLegacyExtras(null, factory);

    expect(await snapshot(factory)).toBe(before);
  });

  it("never calls a write on any store and only opens read-only transactions", async () => {
    const factory = new IDBFactory();
    await seedOld(factory);
    const writes = ["put", "add", "delete", "clear", "createIndex", "deleteIndex"] as const;
    const spies = writes.map((name) => vi.spyOn(IDBObjectStore.prototype, name));
    const dbSpies = [vi.spyOn(IDBDatabase.prototype, "createObjectStore"), vi.spyOn(IDBDatabase.prototype, "deleteObjectStore")];
    const transactions = vi.spyOn(IDBDatabase.prototype, "transaction");
    const deleteDb = vi.spyOn(IDBFactory.prototype, "deleteDatabase");

    await detectLegacyProjects(factory);
    await readAndConvertLegacyProject("old-1", factory);

    for (const spy of [...spies, ...dbSpies, deleteDb]) expect(spy).not.toHaveBeenCalled();
    expect(transactions).toHaveBeenCalled();
    for (const call of transactions.mock.calls) expect(call[1]).toBe("readonly");
  });

  it("opens the old database without a version, so it can never be upgraded", async () => {
    const factory = new IDBFactory();
    await seedOld(factory);
    const open = vi.spyOn(IDBFactory.prototype, "open");
    await detectLegacyProjects(factory);
    expect(open).toHaveBeenCalledWith(LEGACY_DB_NAME);
    for (const call of open.mock.calls) expect(call).toHaveLength(1);
  });

  it("creates nothing when the old database does not exist", async () => {
    const factory = new IDBFactory();
    expect(await detectLegacyProjects(factory)).toEqual({ status: "none" });
    await expect(readAndConvertLegacyProject("x", factory)).rejects.toThrow(/no longer in the old studio/);
    expect(await factory.databases()).toEqual([]);
  });

  it("says so, and touches nothing, when the browser cannot list databases", async () => {
    const factory = new IDBFactory();
    await seedOld(factory);
    const before = await snapshot(factory);
    const open = vi.spyOn(IDBFactory.prototype, "open");
    const noList = { open: factory.open.bind(factory) } as unknown as IDBFactory;
    expect(await detectLegacyProjects(noList)).toEqual({ status: "unsupported" });
    expect(open).not.toHaveBeenCalled();
    expect(await snapshot(factory)).toBe(before);
  });

  it("does not create a store in an old database that has none of ours", async () => {
    const factory = new IDBFactory();
    const open = factory.open(LEGACY_DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("unrelated");
    (await wait(open)).close();
    const before = await snapshot(factory);
    expect(await detectLegacyProjects(factory)).toEqual({ status: "none" });
    expect(await snapshot(factory)).toBe(before);
  });
});

describe("old plugin list and extras", () => {
  it("reads saved plugin addresses without writing", () => {
    const store = { getItem: vi.fn(() => JSON.stringify([{ name: "Synth", url: "https://x/y.js" }, { nope: 1 }])), setItem: vi.fn(), removeItem: vi.fn() };
    expect(readLegacyPlugins(store)).toEqual([{ name: "Synth", url: "https://x/y.js" }]);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
    expect(readLegacyPlugins({ getItem: () => "{bad" })).toEqual([]);
    expect(readLegacyPlugins(null)).toEqual([]);
  });

  it("lists data that lives outside projects so the report can name it", async () => {
    const factory = new IDBFactory();
    const o = factory.open("glctc1_divine09_samples", 1);
    o.onupgradeneeded = () => o.result.createObjectStore("samples");
    (await wait(o)).close();
    const storage = { getItem: (k: string) => (k === "glctc1.midiBindings" ? "{}" : k === "glctc1.wams" ? JSON.stringify([{ name: "A", url: "https://a/b.js" }]) : null) };
    const notes = await describeLegacyExtras(storage, factory);
    expect(notes).toHaveLength(3);
    expect(notes.join(" ")).toMatch(/plugin address/);
    expect(notes.join(" ")).toMatch(/MIDI links/);
    expect(notes.join(" ")).toMatch(/DIVINE09/);
  });
});

describe("legacy to new conversion", () => {
  const converted = (): ReturnType<typeof convertLegacyProject> => convertLegacyProject(legacyProject(), 5000);

  it("produces a valid current-version project with fresh ids", () => {
    const { project } = converted();
    expect(migrateProject(project)).toEqual(project);
    expect(project.id).not.toBe("old-1");
    expect(project.name).toBe("Cosmic Lift (old)");
    expect(project.bpm).toBe(128);
    expect(project.beatsPerBar).toBe(3);
    expect(project.stageAspect).toBe("phone");
  });

  it("maps tracks and clips from beats to bars, linear gain to dB", () => {
    const { project } = converted();
    const drums = project.tracks.find((t) => t.name === "Drums");
    expect(drums).toMatchObject({ kind: "audio", muted: true, cue: true, toMaster: false, pan: -0.25 });
    expect(drums?.gainDb).toBeCloseTo(-6.02, 1);
    expect(drums?.sends).toEqual({ reverb: 0.4, delay: 0.3 });
    const clip = drums?.clips[0];
    expect(clip).toMatchObject({ startBar: 3, lengthBars: 4, offsetSec: 0.25, pitchSemitones: 3, fineCents: 10, warp: true, keyLock: true, fadeInSteps: 4, fadeOutSteps: 8 });
    expect(clip?.gainDb).toBeCloseTo(-6.02, 1);
    expect(drums?.clips).toHaveLength(1);
  });

  it("maps midi notes into 16th steps and normalises 0-127 velocities", () => {
    const { project } = converted();
    const bass = project.tracks.find((t) => t.name === "Bass");
    expect(bass?.kind).toBe("instrument");
    expect(bass?.clips[0]?.notes).toEqual([
      { pitch: 36, startStep: 4, lengthSteps: 2, velocity: 0.75 },
      { pitch: 40, startStep: 8, lengthSteps: 4, velocity: 100 / 127 },
    ]);
  });

  it("maps loop, master effects and mixer", () => {
    const { project } = converted();
    expect(project.loop).toEqual({ on: true, startBar: 2, endBar: 5 });
    expect(project.master).toMatchObject({ filterOn: true, delayOn: false, reverbOn: true, headphoneVolume: 0.5, boothVolume: 0.7, headphoneDeviceId: "default", boothDeviceId: "dev-123" });
    expect(project.master.gainDb).toBeCloseTo(-1.94, 1);
  });

  it("re-keys media to the new asset ids and keeps the bytes", async () => {
    const { project, media } = converted();
    expect(project.assets.map((a) => a.name)).toEqual(["loop.wav", "clip.mp4"]);
    const loop = project.assets[0];
    expect(loop).toMatchObject({ kind: "audio", detectedBpm: 128, detectedKey: "Am", durationSec: 3.5, bytes: 5 });
    expect(loop?.id).not.toBe("as1");
    expect(await media.get(loop?.id ?? "")?.text()).toBe("hello");
    expect(project.tracks.find((t) => t.name === "Drums")?.clips[0]?.assetId).toBe(loop?.id);
  });

  it("lists everything it could not map instead of dropping it silently", () => {
    const { report } = converted();
    const text = report.skipped.join("\n");
    expect(text).toMatch(/ghost\.wav/);
    expect(text).toMatch(/Looper · Module Track/);
    expect(text).toMatch(/Filter sweep/);
    expect(text).toMatch(/Super Saw/);
    expect(text).toMatch(/automation object/);
    expect(text).toMatch(/custom playback rate/);
    expect(text).toMatch(/track effect/);
    expect(text).toMatch(/80LA8/);
    expect(report.imported[0]).toMatch(/128 BPM/);
  });

  it("rejects something that is not a project", () => {
    expect(() => convertLegacyProject({ name: "x" })).toThrow(/not an old-studio project/);
  });

  it("copies from the old database into a new project without touching the original", async () => {
    const factory = new IDBFactory();
    await seedOld(factory);
    const before = await snapshot(factory);
    const parsed = await readAndConvertLegacyProject("old-1", factory);
    expect(parsed.project.tracks.length).toBeGreaterThan(0);
    expect(await snapshot(factory)).toBe(before);
  });
});

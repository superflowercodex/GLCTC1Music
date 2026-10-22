import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { assetBytesUsed, deleteAssetBlob, deleteProject, getAssetBlob, listProjects, loadProject, putAssetBlob, saveProject } from "./db";
import { newProject } from "./model";

describe("project database", () => {
  it("saves, lists, loads and deletes projects", async () => {
    const a = newProject("A");
    const b = { ...newProject("B"), updatedAt: Date.now() + 1000 };
    await saveProject(a);
    await saveProject(b);
    const list = await listProjects();
    expect(list.map((p) => p.name)).toEqual(["B", "A"]);
    expect((await loadProject(a.id))?.name).toBe("A");
    await deleteProject(a.id);
    expect(await loadProject(a.id)).toBeUndefined();
  });

  it("stores media blobs by id and reports their size", async () => {
    await putAssetBlob("asset-1", new Blob([new Uint8Array(1234)]));
    expect((await getAssetBlob("asset-1"))?.size).toBe(1234);
    expect(await assetBytesUsed()).toBeGreaterThanOrEqual(1234);
    await deleteAssetBlob("asset-1");
    expect(await getAssetBlob("asset-1")).toBeUndefined();
  });

  it("round trips a whole project including instrument data and media ids", async () => {
    const p = newProject("Round");
    p.assets.push({ id: "asset-rt", kind: "audio", name: "a.wav", mime: "audio/wav", bytes: 4, addedAt: 1 });
    p.instruments.push({ id: "s1", kind: "looper", trackId: "t1", state: { kind: "looper", values: { a: 1 }, data: { sample: new Float32Array([0.25, -0.5]) } } });
    await saveProject(p);
    const loaded = await loadProject(p.id);
    expect(loaded).toEqual(p);
  });

  it("saving the same id again replaces it instead of adding a second copy", async () => {
    const p = newProject("Twice");
    await saveProject(p);
    await saveProject({ ...p, name: "Twice, renamed" });
    const matches = (await listProjects()).filter((s) => s.id === p.id);
    expect(matches.map((m) => m.name)).toEqual(["Twice, renamed"]);
  });

  it("sums media sizes and drops them when deleted", async () => {
    const before = await assetBytesUsed();
    await putAssetBlob("size-a", new Blob([new Uint8Array(100)]));
    await putAssetBlob("size-b", new Blob([new Uint8Array(50)]));
    expect(await assetBytesUsed()).toBe(before + 150);
    await deleteAssetBlob("size-a");
    expect(await assetBytesUsed()).toBe(before + 50);
    await deleteAssetBlob("size-b");
  });

  it("returns undefined for things that are not stored", async () => {
    expect(await loadProject("nope")).toBeUndefined();
    expect(await getAssetBlob("nope")).toBeUndefined();
  });
});

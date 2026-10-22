import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../store/store";
import type { ProjectSummary } from "./db";
import { describeSaveStatus, Persistence, PersistError, type PersistDeps, type SaveStatus } from "./persist";
import { newProject, type Project } from "./model";

interface Fake {
  deps: PersistDeps;
  projects: Map<string, Project>;
  blobs: Map<string, Blob>;
  fail: { save: boolean };
  notices: string[];
  saves: Project[];
  released: number;
}

function makeFake(initial: Project = newProject("Start")): Fake {
  const projects = new Map<string, Project>();
  const blobs = new Map<string, Blob>();
  const fail = { save: false };
  const notices: string[] = [];
  const saves: Project[] = [];
  let lastOpened: string | null = null;
  const fake: Fake = { projects, blobs, fail, notices, saves, released: 0, deps: undefined as never };
  fake.deps = {
    store: createStore<Project>(initial),
    status: createStore<SaveStatus>({ state: "idle", savedAt: null, error: null }),
    async saveProject(p) {
      if (fail.save) throw new Error("disk full");
      projects.set(p.id, structuredClone(p));
      saves.push(p);
    },
    async loadProject(id) {
      const p = projects.get(id);
      return p ? structuredClone(p) : undefined;
    },
    async listProjects(): Promise<ProjectSummary[]> {
      return [...projects.values()].map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, bpm: p.bpm, trackCount: p.tracks.length })).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async deleteProject(id) {
      projects.delete(id);
    },
    async putAssetBlob(id, blob) {
      blobs.set(id, blob);
    },
    async getAssetBlob(id) {
      return blobs.get(id);
    },
    async deleteAssetBlob(id) {
      blobs.delete(id);
    },
    async restoreInstruments() {},
    async releaseInstruments() {
      fake.released += 1;
    },
    flushInstruments() {},
    afterOpen() {},
    lastOpened: { get: () => lastOpened, set: (id) => (lastOpened = id) },
    notify: (t) => notices.push(t),
    now: () => Date.now(),
    debounceMs: 800,
    retryMs: 5000,
  };
  return fake;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosave", () => {
  it("starts a blank project and saves it on first run", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    expect(f.deps.status.get().state).toBe("saving");
    await vi.advanceTimersByTimeAsync(900);
    expect(f.projects.size).toBe(1);
    expect(f.deps.status.get().state).toBe("saved");
    stop();
  });

  it("waits for edits to settle (debounce) and writes once", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    f.saves.length = 0;

    for (let i = 0; i < 5; i++) {
      f.deps.store.set((x) => ({ ...x, bpm: 100 + i }));
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(f.saves).toHaveLength(0);
    expect(f.deps.status.get().state).toBe("saving");
    await vi.advanceTimersByTimeAsync(900);
    expect(f.saves).toHaveLength(1);
    expect(f.saves[0]?.bpm).toBe(104);
    expect(f.deps.status.get().state).toBe("saved");
    stop();
  });

  it("surfaces a failed save in the status and a notice, and keeps retrying until it works", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);

    f.fail.save = true;
    f.deps.store.set((x) => ({ ...x, bpm: 140 }));
    await vi.advanceTimersByTimeAsync(900);
    expect(f.deps.status.get().state).toBe("error");
    expect(describeSaveStatus(f.deps.status.get())).toBe("Could not save: disk full");
    expect(f.notices).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5100);
    expect(f.notices).toHaveLength(1);
    expect(f.deps.status.get().state).toBe("error");

    f.fail.save = false;
    await vi.advanceTimersByTimeAsync(5100);
    expect(f.deps.status.get().state).toBe("saved");
    expect(f.projects.get(f.deps.store.get().id)?.bpm).toBe(140);
    stop();
  });

  it("saveNow rejects when the write fails, so callers cannot assume success", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    f.fail.save = true;
    f.deps.store.set((x) => ({ ...x, bpm: 90 }));
    await expect(p.saveNow()).rejects.toThrow("disk full");
    stop();
  });

  it("does not switch away from a project it cannot save", async () => {
    const f = makeFake();
    const other = newProject("Other");
    f.projects.set(other.id, other);
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    const openId = f.deps.store.get().id;
    f.fail.save = true;
    f.deps.store.set((x) => ({ ...x, bpm: 77 }));
    await expect(p.openProject(other.id)).rejects.toThrow(PersistError);
    expect(f.deps.store.get().id).toBe(openId);
    stop();
  });

  it("saves again when edits land during a write", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    const original = f.deps.saveProject;
    let first = true;
    f.deps.saveProject = async (proj) => {
      if (first) {
        first = false;
        f.deps.store.set((x) => ({ ...x, bpm: 111 }));
      }
      await original(proj);
    };
    f.deps.store.set((x) => ({ ...x, bpm: 99 }));
    await vi.advanceTimersByTimeAsync(900);
    expect(f.projects.get(f.deps.store.get().id)?.bpm).toBe(111);
    expect(f.deps.status.get().state).toBe("saved");
    stop();
  });
});

describe("project operations", () => {
  it("restores the last open project at startup", async () => {
    const f = makeFake();
    const a = { ...newProject("A"), updatedAt: 1000 };
    const b = { ...newProject("B"), updatedAt: 2000 };
    f.projects.set(a.id, a);
    f.projects.set(b.id, b);
    f.deps.lastOpened.set(a.id);
    const stop = await new Persistence(f.deps).start();
    expect(f.deps.store.get().name).toBe("A");
    expect(f.deps.status.get().state).toBe("saved");
    stop();
  });

  it("falls back to the newest project when the remembered one is gone", async () => {
    const f = makeFake();
    const b = { ...newProject("B"), updatedAt: 2000 };
    f.projects.set(b.id, b);
    f.deps.lastOpened.set("missing");
    const stop = await new Persistence(f.deps).start();
    expect(f.deps.store.get().name).toBe("B");
    stop();
  });

  it("new, rename, duplicate (with its own media), save as and delete", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);

    f.blobs.set("asset-1", new Blob(["abc"]));
    f.deps.store.set((x) => ({ ...x, assets: [{ id: "asset-1", kind: "audio", name: "a.wav", mime: "audio/wav", bytes: 3, addedAt: 0 }] }));
    await p.saveNow();
    const firstId = f.deps.store.get().id;

    await p.renameProject(firstId, "  Renamed  ");
    expect(f.deps.store.get().name).toBe("Renamed");
    await expect(p.renameProject(firstId, "   ")).rejects.toThrow(PersistError);

    const copy = await p.duplicateProject(firstId);
    expect(copy.id).not.toBe(firstId);
    expect(copy.name).toBe("Renamed copy");
    const copyAssetId = copy.assets[0]?.id;
    expect(copyAssetId).toBeDefined();
    expect(copyAssetId).not.toBe("asset-1");
    expect(await f.blobs.get(copyAssetId ?? "")?.text()).toBe("abc");

    const saved = await p.saveAs("Branch");
    expect(f.deps.store.get().id).toBe(saved.id);
    expect(f.deps.store.get().name).toBe("Branch");

    const fresh = await p.newProject("Fresh");
    expect(f.deps.store.get().id).toBe(fresh.id);
    expect(f.projects.has(fresh.id)).toBe(true);

    await p.deleteProject(copy.id);
    expect(f.projects.has(copy.id)).toBe(false);
    expect(f.blobs.has(copyAssetId ?? "")).toBe(false);
    expect(f.blobs.has("asset-1")).toBe(true);

    await p.deleteProject(fresh.id);
    expect(f.deps.store.get().id).not.toBe(fresh.id);
    stop();
  });

  it("deleting the only project leaves a fresh blank one open", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    const id = f.deps.store.get().id;
    await p.deleteProject(id);
    expect(f.deps.store.get().id).not.toBe(id);
    expect(f.projects.size).toBe(1);
    stop();
  });

  it("opening releases the old project's instruments and restores the new one's", async () => {
    const f = makeFake();
    const restore = vi.fn(async () => {});
    f.deps.restoreInstruments = restore;
    const other = newProject("Other");
    f.projects.set(other.id, other);
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    const before = f.released;
    await p.openProject(other.id);
    expect(f.released).toBe(before + 1);
    expect(restore).toHaveBeenLastCalledWith(expect.objectContaining({ id: other.id }));
    stop();
  });

  it("opening a project from a newer studio fails with the reason and keeps the current one", async () => {
    const f = makeFake();
    const future = { ...newProject("Future"), v: 5 } as unknown as Project;
    f.projects.set(future.id, future);
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    const current = f.deps.store.get().id;
    await expect(p.openProject(future.id)).rejects.toThrow(/newer version/);
    expect(f.deps.store.get().id).toBe(current);
    stop();
  });
});

describe("commitImport", () => {
  it("add stores media and project; replace removes the old copy's media", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);

    const imported = { ...newProject("Imp"), assets: [{ id: "n1", kind: "audio" as const, name: "x", mime: "audio/wav", bytes: 1, addedAt: 0 }] };
    await p.commitImport(imported, new Map([["n1", new Blob(["1"])]]), "add");
    expect(f.projects.has(imported.id)).toBe(true);
    expect(f.blobs.has("n1")).toBe(true);

    const replacement = { ...imported, assets: [{ id: "n2", kind: "audio" as const, name: "y", mime: "audio/wav", bytes: 1, addedAt: 0 }] };
    await p.commitImport(replacement, new Map([["n2", new Blob(["2"])]]), "replace");
    expect(f.blobs.has("n1")).toBe(false);
    expect(f.blobs.has("n2")).toBe(true);
    stop();
  });

  it("rolls back written media when saving the project fails", async () => {
    const f = makeFake();
    const p = new Persistence(f.deps);
    const stop = await p.start();
    await vi.advanceTimersByTimeAsync(900);
    f.fail.save = true;
    await expect(p.commitImport(newProject("X"), new Map([["m1", new Blob(["1"])]]), "add")).rejects.toThrow("disk full");
    expect(f.blobs.has("m1")).toBe(false);
    stop();
  });
});

describe("describeSaveStatus", () => {
  it("words each state", () => {
    const now = 1_000_000;
    expect(describeSaveStatus({ state: "saving", savedAt: null, error: null }, now)).toBe("Saving...");
    expect(describeSaveStatus({ state: "saved", savedAt: now - 2000, error: null }, now)).toBe("Saved just now");
    expect(describeSaveStatus({ state: "saved", savedAt: now - 30_000, error: null }, now)).toBe("Saved 30 seconds ago");
    expect(describeSaveStatus({ state: "saved", savedAt: now - 180_000, error: null }, now)).toBe("Saved 3 minutes ago");
    expect(describeSaveStatus({ state: "error", savedAt: null, error: "quota" }, now)).toBe("Could not save: quota");
  });
});

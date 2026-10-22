import { peekEngine } from "../audio/engine";
import { autoStartMidi } from "../audio/midi";
import { lsGet, lsSet } from "../storage";
import { projectStore, uiStore } from "../store/project";
import { createStore, type Store } from "../store/store";
import * as db from "./db";
import { ensureInstrument, flushInstrumentStates, releaseAllInstruments } from "./instruments";
import { migrateProject, remapAssetIds } from "./migrate";
import { newId, newProject as makeProject, type Project } from "./model";

export class PersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistError";
  }
}

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface SaveStatus {
  state: SaveState;
  savedAt: number | null;
  error: string | null;
}

export const saveStatusStore: Store<SaveStatus> = createStore<SaveStatus>({ state: "idle", savedAt: null, error: null });

/** The text the UI shows next to the project name. */
export function describeSaveStatus(status: SaveStatus, now: number = Date.now()): string {
  switch (status.state) {
    case "idle":
      return "Not saved yet";
    case "saving":
      return "Saving...";
    case "error":
      return `Could not save: ${status.error ?? "unknown problem"}`;
    case "saved": {
      const seconds = Math.max(0, Math.round((now - (status.savedAt ?? now)) / 1000));
      if (seconds < 10) return "Saved just now";
      if (seconds < 60) return `Saved ${seconds} seconds ago`;
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return `Saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
      return `Saved at ${new Date(status.savedAt ?? now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
  }
}

export interface PersistDeps {
  store: Store<Project>;
  status: Store<SaveStatus>;
  saveProject(project: Project): Promise<void>;
  loadProject(id: string): Promise<Project | undefined>;
  listProjects(): Promise<db.ProjectSummary[]>;
  deleteProject(id: string): Promise<void>;
  putAssetBlob(id: string, blob: Blob): Promise<void>;
  getAssetBlob(id: string): Promise<Blob | undefined>;
  deleteAssetBlob(id: string): Promise<void>;
  /** Builds the audio for every instrument slot of the project that just opened. */
  restoreInstruments(project: Project): Promise<void>;
  releaseInstruments(): Promise<void>;
  /** Pushes pending instrument edits into the project before it is written. */
  flushInstruments(): void;
  afterOpen(project: Project): void;
  lastOpened: { get(): string | null; set(id: string): void };
  notify(text: string): void;
  now(): number;
  debounceMs: number;
  retryMs: number;
}

export function defaultDeps(): PersistDeps {
  return {
    store: projectStore,
    status: saveStatusStore,
    ...db,
    async restoreInstruments(project) {
      for (const slot of project.instruments) {
        try {
          await ensureInstrument(slot.kind);
        } catch (error) {
          uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text: `Could not restore the ${slot.kind} instrument: ${error instanceof Error ? error.message : String(error)}` } }));
        }
      }
    },
    releaseInstruments: releaseAllInstruments,
    flushInstruments: flushInstrumentStates,
    afterOpen(project) {
      const clock = peekEngine()?.clock;
      if (!clock) return;
      clock.stop();
      clock.seek(0);
      clock.bpm = project.bpm;
      clock.beatsPerBar = project.beatsPerBar;
    },
    lastOpened: {
      get: () => lsGet<string | null>("lastProject", null),
      set: (id) => {
        lsSet("lastProject", id);
      },
    },
    notify: (text) => uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text } })),
    now: () => Date.now(),
    debounceMs: 800,
    retryMs: 5000,
  };
}

export type ImportMode = "add" | "replace";

export class Persistence {
  private saved: Project | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> | null = null;
  private suppress = false;
  private failureAnnounced = false;
  private started = false;

  constructor(private readonly deps: PersistDeps) {}

  /** Restores the last open project (or the newest saved one), then starts autosaving. Returns the stop function. */
  async start(): Promise<() => void> {
    if (this.started) throw new PersistError("Persistence is already running.");
    this.started = true;
    await this.restoreStartupProject();

    const unsubscribe = this.deps.store.subscribe(() => this.onStoreChange());
    const onHide = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") void this.saveNow().catch(() => undefined);
    };
    const onPageHide = (): void => void this.saveNow().catch(() => undefined);
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (this.isDirty() || this.deps.status.get().state === "error") event.preventDefault();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onHide);
      addEventListener("pagehide", onPageHide);
      addEventListener("beforeunload", onBeforeUnload);
    }
    return () => {
      unsubscribe();
      clearTimeout(this.timer);
      clearTimeout(this.retryTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onHide);
        removeEventListener("pagehide", onPageHide);
        removeEventListener("beforeunload", onBeforeUnload);
      }
      this.started = false;
    };
  }

  private async restoreStartupProject(): Promise<void> {
    try {
      const summaries = await this.deps.listProjects();
      const wanted = this.deps.lastOpened.get();
      const target = summaries.find((s) => s.id === wanted) ?? summaries[0];
      if (target) {
        await this.openProject(target.id, { skipSave: true });
        return;
      }
    } catch (error) {
      this.fail(error);
    }
    // First run, or the saved projects could not be read: start a blank one.
    this.saved = null;
    this.markDirty();
  }

  isDirty(): boolean {
    return this.saved !== this.deps.store.get();
  }

  private onStoreChange(): void {
    if (this.suppress || !this.isDirty()) return;
    this.markDirty();
  }

  private markDirty(): void {
    const status = this.deps.status.get();
    if (status.state !== "saving") this.deps.status.set({ state: "saving", savedAt: status.savedAt, error: null });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow().catch(() => undefined), this.deps.debounceMs);
  }

  /** Writes the open project now. Rejects when the write fails, after the failure has already been shown in the status. */
  async saveNow(): Promise<void> {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.deps.flushInstruments();
    if (this.writing) {
      await this.writing.catch(() => undefined);
      if (!this.isDirty() && this.deps.status.get().state === "saved") return;
    }
    if (!this.isDirty() && this.deps.status.get().state !== "error") return;
    const run = this.writeLoop();
    this.writing = run;
    try {
      await run;
    } finally {
      if (this.writing === run) this.writing = null;
    }
  }

  private async writeLoop(): Promise<void> {
    this.deps.status.set({ state: "saving", savedAt: this.deps.status.get().savedAt, error: null });
    try {
      // Edits that land during a write need another pass, so loop until the store and the disk agree.
      do {
        const snapshot = this.deps.store.get();
        const at = this.deps.now();
        await this.deps.saveProject({ ...snapshot, updatedAt: at });
        this.saved = snapshot;
        this.deps.lastOpened.set(snapshot.id);
        this.deps.status.set({ state: "saving", savedAt: at, error: null });
      } while (this.isDirty());
      this.failureAnnounced = false;
      this.deps.status.set({ state: "saved", savedAt: this.deps.now(), error: null });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.deps.status.set({ state: "error", savedAt: this.deps.status.get().savedAt, error: message });
    if (!this.failureAnnounced) {
      this.failureAnnounced = true;
      this.deps.notify(`Could not save your project: ${message}`);
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.saveNow().catch(() => undefined), this.deps.retryMs);
  }

  private adopt(project: Project): void {
    this.suppress = true;
    try {
      this.deps.store.set(project);
    } finally {
      this.suppress = false;
    }
    this.saved = this.deps.store.get();
  }

  /** A failed save of the current project blocks switching away from it: leaving would lose the edits. */
  private async settleCurrent(): Promise<void> {
    if (!this.isDirty()) return;
    try {
      await this.saveNow();
    } catch (error) {
      throw new PersistError(`The current project could not be saved, so it stays open. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async openProject(id: string, options: { skipSave?: boolean } = {}): Promise<void> {
    if (!options.skipSave) await this.settleCurrent();
    const raw = await this.deps.loadProject(id);
    if (!raw) throw new PersistError("That project is no longer saved on this device.");
    const project = migrateProject(raw);
    await this.deps.releaseInstruments();
    this.adopt(project);
    this.deps.lastOpened.set(project.id);
    this.deps.status.set({ state: "saved", savedAt: project.updatedAt, error: null });
    this.deps.afterOpen(project);
    await this.deps.restoreInstruments(project);
  }

  async newProject(name = "Untitled"): Promise<Project> {
    await this.settleCurrent();
    const project = makeProject(name);
    await this.deps.saveProject(project);
    await this.deps.releaseInstruments();
    this.adopt(project);
    this.deps.lastOpened.set(project.id);
    this.deps.status.set({ state: "saved", savedAt: project.updatedAt, error: null });
    this.deps.afterOpen(project);
    return project;
  }

  /** Copies a stored project, giving it its own id and its own copies of the media, so deleting one never breaks the other. */
  private async cloneStored(source: Project, name: string): Promise<Project> {
    const { project, idMap } = remapAssetIds({ ...source, id: newId("proj"), name, createdAt: this.deps.now(), updatedAt: this.deps.now() });
    const written: string[] = [];
    try {
      for (const [oldId, newAssetId] of idMap) {
        const blob = await this.deps.getAssetBlob(oldId);
        if (!blob) continue;
        await this.deps.putAssetBlob(newAssetId, blob);
        written.push(newAssetId);
      }
      await this.deps.saveProject(project);
    } catch (error) {
      await Promise.allSettled(written.map((id) => this.deps.deleteAssetBlob(id)));
      throw error;
    }
    return project;
  }

  /** Saves the open project under a new name and switches to the copy. */
  async saveAs(name: string): Promise<Project> {
    await this.saveNow();
    const copy = await this.cloneStored(this.deps.store.get(), name);
    await this.openProject(copy.id, { skipSave: true });
    return copy;
  }

  async duplicateProject(id: string): Promise<Project> {
    if (id === this.deps.store.get().id) await this.saveNow();
    const source = await this.deps.loadProject(id);
    if (!source) throw new PersistError("That project is no longer saved on this device.");
    return this.cloneStored(migrateProject(source), `${source.name} copy`);
  }

  async renameProject(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new PersistError("A project needs a name.");
    if (id === this.deps.store.get().id) {
      this.deps.store.set((p) => ({ ...p, name: trimmed }));
      await this.saveNow();
      return;
    }
    const stored = await this.deps.loadProject(id);
    if (!stored) throw new PersistError("That project is no longer saved on this device.");
    await this.deps.saveProject({ ...stored, name: trimmed, updatedAt: this.deps.now() });
  }

  /** Deletes a saved project and its media. Deleting the open one leaves a fresh blank project open. */
  async deleteProject(id: string): Promise<void> {
    const stored = await this.deps.loadProject(id);
    const isOpen = id === this.deps.store.get().id;
    if (isOpen) {
      clearTimeout(this.timer);
      clearTimeout(this.retryTimer);
    }
    await this.deps.deleteProject(id);
    if (stored) await Promise.allSettled(stored.assets.map((a) => this.deps.deleteAssetBlob(a.id)));
    if (isOpen) {
      const rest = await this.deps.listProjects();
      if (rest[0]) {
        await this.openProject(rest[0].id, { skipSave: true });
      } else {
        const fresh = makeProject();
        await this.deps.saveProject(fresh);
        await this.deps.releaseInstruments();
        this.adopt(fresh);
        this.deps.lastOpened.set(fresh.id);
        this.deps.status.set({ state: "saved", savedAt: fresh.updatedAt, error: null });
        this.deps.afterOpen(fresh);
      }
    }
  }

  async hasProject(id: string): Promise<boolean> {
    return (await this.deps.loadProject(id)) !== undefined;
  }

  /**
   * Stores an imported project and its media. "replace" overwrites the saved project with the same id and removes the
   * media the old copy used; if that project is open, it is reopened from the new copy.
   */
  async commitImport(project: Project, media: ReadonlyMap<string, Blob>, mode: ImportMode): Promise<void> {
    const previous = mode === "replace" ? await this.deps.loadProject(project.id) : undefined;
    const written: string[] = [];
    try {
      for (const [assetId, blob] of media) {
        await this.deps.putAssetBlob(assetId, blob);
        written.push(assetId);
      }
      await this.deps.saveProject(project);
    } catch (error) {
      await Promise.allSettled(written.map((id) => this.deps.deleteAssetBlob(id)));
      throw error;
    }
    if (previous) {
      const kept = new Set(project.assets.map((a) => a.id));
      await Promise.allSettled(previous.assets.filter((a) => !kept.has(a.id)).map((a) => this.deps.deleteAssetBlob(a.id)));
    }
    if (mode === "replace" && project.id === this.deps.store.get().id) {
      clearTimeout(this.timer);
      this.saved = this.deps.store.get();
      await this.openProject(project.id, { skipSave: true });
    }
  }
}

let shared: Persistence | undefined;

export function persistence(): Persistence {
  shared ??= new Persistence(defaultDeps());
  return shared;
}

/** Call once at startup. Restores the last project, then autosaves; the returned function stops it. */
export async function startPersistence(): Promise<() => void> {
  const stop = await persistence().start();
  void autoStartMidi();
  return stop;
}

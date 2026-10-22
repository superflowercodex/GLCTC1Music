import { DB_NAME, StorageError } from "../storage";
import type { Project } from "./model";

const PROJECTS = "projects";
const ASSETS = "assets";
const DB_VERSION = 1;

let opening: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = undefined;
      reject(new StorageError(`Could not open the studio database: ${req.error?.message ?? "unknown error"}`));
    };
    req.onblocked = () => reject(new StorageError("The studio database is blocked by another open tab."));
  });
  return opening;
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(new StorageError(`Database ${mode} failed: ${tx.error?.message ?? "unknown error"}`));
    tx.onabort = () => reject(new StorageError(`Database ${mode} was cancelled: ${tx.error?.message ?? "quota or access problem"}`));
  });
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  bpm: number;
  trackCount: number;
}

export async function saveProject(project: Project): Promise<void> {
  await run(PROJECTS, "readwrite", (s) => s.put(project));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return run<Project | undefined>(PROJECTS, "readonly", (s) => s.get(id));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await run<Project[]>(PROJECTS, "readonly", (s) => s.getAll());
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, bpm: p.bpm, trackCount: p.tracks.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await run(PROJECTS, "readwrite", (s) => s.delete(id));
}

export async function putAssetBlob(id: string, blob: Blob): Promise<void> {
  await run(ASSETS, "readwrite", (s) => s.put(blob, id));
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>(ASSETS, "readonly", (s) => s.get(id));
}

export async function deleteAssetBlob(id: string): Promise<void> {
  await run(ASSETS, "readwrite", (s) => s.delete(id));
}

/** Bytes used by stored media, for the Library's storage readout. */
export async function assetBytesUsed(): Promise<number> {
  const blobs = await run<Blob[]>(ASSETS, "readonly", (s) => s.getAll());
  return blobs.reduce((sum, b) => sum + b.size, 0);
}

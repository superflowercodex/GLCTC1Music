import { newId, type Project } from "./model";

export const CURRENT_PROJECT_VERSION = 1;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Each entry upgrades a project from version `n` to `n + 1`. Add the next one here when the model changes. */
export type MigrationStep = (project: Record<string, unknown>) => Record<string, unknown>;
export type MigrationRegistry = Readonly<Record<number, MigrationStep>>;

export const MIGRATIONS: MigrationRegistry = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireField(project: Record<string, unknown>, field: string, check: (v: unknown) => boolean, expected: string): void {
  if (!check(project[field])) throw new MigrationError(`This project is damaged: "${field}" should be ${expected}.`);
}

/** Structural check of a current-version project, so a corrupt file fails here with a clear reason instead of deep in a room. */
export function assertProjectShape(project: Record<string, unknown>): asserts project is Record<string, unknown> & Project {
  requireField(project, "id", (v) => typeof v === "string" && v.length > 0, "a text id");
  requireField(project, "name", (v) => typeof v === "string", "text");
  for (const f of ["createdAt", "updatedAt", "bpm", "beatsPerBar"]) {
    requireField(project, f, (v) => typeof v === "number" && Number.isFinite(v), "a number");
  }
  requireField(project, "key", (v) => typeof v === "string", "text");
  for (const f of ["tracks", "assets", "instruments"]) requireField(project, f, Array.isArray, "a list");
  requireField(project, "loop", isRecord, "an object");
  requireField(project, "master", isRecord, "an object");
  requireField(project, "song", (v) => isRecord(v) && Array.isArray(v.sections) && isRecord(v.matrix), "an object with sections and a matrix");
  for (const t of project.tracks as unknown[]) {
    if (!isRecord(t) || typeof t.id !== "string" || !Array.isArray(t.clips)) throw new MigrationError("This project is damaged: a track is missing its id or clips.");
  }
  for (const a of project.assets as unknown[]) {
    if (!isRecord(a) || typeof a.id !== "string") throw new MigrationError("This project is damaged: a media entry is missing its id.");
  }
  for (const s of project.instruments as unknown[]) {
    if (!isRecord(s) || typeof s.id !== "string" || typeof s.kind !== "string") throw new MigrationError("This project is damaged: an instrument slot is missing its id or kind.");
  }
}

export function migrateProject(raw: unknown, registry: MigrationRegistry = MIGRATIONS, current: number = CURRENT_PROJECT_VERSION): Project {
  if (!isRecord(raw)) throw new MigrationError("This is not a project.");
  let version = raw.v;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new MigrationError("This project has no valid version number, so it cannot be opened safely.");
  }
  if (version > current) {
    throw new MigrationError(`This project was saved by a newer version of the studio (format ${version}; this one reads up to ${current}). Reload the page to get the latest studio.`);
  }
  let working: Record<string, unknown> = raw;
  while (version < current) {
    const step = registry[version];
    if (!step) throw new MigrationError(`No upgrade path from project format ${version} to ${version + 1}.`);
    working = { ...step(working), v: version + 1 };
    version += 1;
  }
  assertProjectShape(working);
  return working;
}

export interface RemappedAssets {
  project: Project;
  /** Old asset id to new asset id. */
  idMap: Map<string, string>;
}

/**
 * Gives every asset a fresh id and repoints the clips at them. Imported or copied projects use this so media
 * blobs (keyed by asset id across the whole database) can never collide with, or be deleted by, another project.
 */
export function remapAssetIds(project: Project, makeId: (prefix: string) => string = newId): RemappedAssets {
  const idMap = new Map<string, string>();
  for (const asset of project.assets) idMap.set(asset.id, makeId("asset"));
  const remapped: Project = {
    ...project,
    assets: project.assets.map((a) => ({ ...a, id: idMap.get(a.id) ?? a.id })),
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.assetId !== undefined && idMap.has(c.assetId) ? { ...c, assetId: idMap.get(c.assetId) } : c)),
    })),
  };
  return { project: remapped, idMap };
}

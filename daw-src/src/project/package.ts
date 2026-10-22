/**
 * Project package: one `.glctc1studio` file holding a whole project.
 *
 * Container: UTF-8 JSON, so it can be inspected and survives any file transfer.
 *   { format: "glctc1studio-package", packageVersion: 1, exportedAt, project, media, missingMedia }
 * - `project` is the Project. Binary values anywhere inside it (instrument samples, looper and Divine09
 *   buffers) are replaced by { $glctc1: "bytes", type, b64 } or { $glctc1: "blob", mime, b64 } markers.
 * - `media` maps each asset id to { mime, b64 }.
 * - `missingMedia` lists assets whose file was not on the device at export time.
 * The old studio's `.glctc1` files (project fields at the top level, assets carrying a data URL) are also read.
 */
import { MigrationError, migrateProject, remapAssetIds } from "./migrate";
import { PackageError, TYPED_ARRAYS, base64ToBytes, bytesToBase64, viewBytes } from "./binary";
import { newId, type Project } from "./model";
import { isLegacyPackage, parseLegacyPackage } from "./legacy";

export const PACKAGE_FORMAT = "glctc1studio-package";
export const PACKAGE_VERSION = 1;
export const PACKAGE_EXTENSION = ".glctc1studio";

export { PackageError };

export interface ImportReport {
  /** Short statements of what came across, for the summary line. */
  imported: string[];
  /** Everything that could not be brought over, each with its reason. Never left empty by silently dropping. */
  skipped: string[];
}

export interface ParsedImport {
  project: Project;
  /** Media by the asset id used in `project`. */
  media: Map<string, Blob>;
  report: ImportReport;
}

export interface AskChoice {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "neutral";
}

export interface Question {
  title: string;
  message: string;
  choices: AskChoice[];
}

/** Resolves with the id of the chosen choice; "cancel" when the sheet is dismissed. */
export type Ask = (question: Question) => Promise<string>;

/** Replaces binary values with JSON markers. Plain data passes through unchanged. */
export async function encodeBinary(value: unknown): Promise<unknown> {
  if (value instanceof ArrayBuffer) return { $glctc1: "bytes", type: "ArrayBuffer", b64: bytesToBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) {
    const type = value.constructor.name;
    if (!(type in TYPED_ARRAYS)) throw new PackageError(`Cannot save a ${type} inside a project package.`);
    return { $glctc1: "bytes", type, b64: bytesToBase64(viewBytes(value)) };
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return { $glctc1: "blob", mime: value.type, b64: bytesToBase64(new Uint8Array(await value.arrayBuffer())) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeBinary));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = await encodeBinary(v);
    }
    return out;
  }
  return value;
}

export function decodeBinary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeBinary);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (record.$glctc1 === "bytes" && typeof record.type === "string" && typeof record.b64 === "string") {
    const bytes = base64ToBytes(record.b64);
    if (record.type === "ArrayBuffer") return bytes.buffer;
    const Ctor = TYPED_ARRAYS[record.type];
    if (!Ctor) throw new PackageError(`The package holds an unknown data type (${record.type}).`);
    if (bytes.byteLength % Ctor.BYTES_PER_ELEMENT !== 0) throw new PackageError("A sample buffer inside this package is cut short.");
    return new Ctor(bytes.buffer);
  }
  if (record.$glctc1 === "blob" && typeof record.b64 === "string") {
    return new Blob([base64ToBytes(record.b64)], { type: typeof record.mime === "string" ? record.mime : "" });
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) out[k] = decodeBinary(v);
  return out;
}


interface PackageFile {
  format: typeof PACKAGE_FORMAT;
  packageVersion: number;
  exportedAt: number;
  project: unknown;
  media: Record<string, { mime: string; b64: string }>;
  missingMedia: string[];
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-");
  return cleaned || "project";
}

export interface ExportedPackage {
  blob: Blob;
  fileName: string;
  /** Assets whose media was not on this device. The package still contains everything else. */
  missing: string[];
}

export async function exportProjectPackage(project: Project, getAssetBlob: (id: string) => Promise<Blob | undefined>, now: number = Date.now()): Promise<ExportedPackage> {
  const media: PackageFile["media"] = {};
  const missing: string[] = [];
  for (const asset of project.assets) {
    const blob = await getAssetBlob(asset.id);
    if (!blob) {
      missing.push(asset.name);
      continue;
    }
    media[asset.id] = { mime: blob.type || asset.mime, b64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
  }
  const file: PackageFile = {
    format: PACKAGE_FORMAT,
    packageVersion: PACKAGE_VERSION,
    exportedAt: now,
    project: await encodeBinary(project),
    media,
    missingMedia: project.assets.filter((a) => !(a.id in media)).map((a) => a.id),
  };
  return { blob: new Blob([JSON.stringify(file)], { type: "application/json" }), fileName: `${safeFileName(project.name)}${PACKAGE_EXTENSION}`, missing };
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PackageError(`${what} is not in the expected shape.`);
  return value as Record<string, unknown>;
}

/** Validates a package's text and turns it into a project plus its media. Throws PackageError with a reason a person can act on. */
export function parsePackageText(text: string): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PackageError("This file is not a project package: it could not be read as JSON.");
  }
  const file = asRecord(raw, "This file");
  if (file.format !== PACKAGE_FORMAT) {
    if (isLegacyPackage(file)) return parseLegacyPackage(file);
    throw new PackageError("This file is not a GLCTC1 project package.");
  }
  if (typeof file.packageVersion !== "number" || file.packageVersion > PACKAGE_VERSION) {
    throw new PackageError(`This package was made by a newer studio (package format ${String(file.packageVersion)}). Reload the page to get the latest studio.`);
  }
  const mediaRecord = asRecord(file.media, "The package's media list");
  let project: Project;
  try {
    project = migrateProject(decodeBinary(file.project));
  } catch (error) {
    if (error instanceof MigrationError) throw new PackageError(error.message);
    throw error;
  }
  const media = new Map<string, Blob>();
  const skipped: string[] = [];
  for (const asset of project.assets) {
    const entry = mediaRecord[asset.id];
    if (entry === undefined) {
      skipped.push(`"${asset.name}": its media file was not in the package.`);
      continue;
    }
    const { mime, b64 } = asRecord(entry, `The media entry for "${asset.name}"`);
    if (typeof b64 !== "string") throw new PackageError(`The media entry for "${asset.name}" has no data.`);
    media.set(asset.id, new Blob([base64ToBytes(b64)], { type: typeof mime === "string" ? mime : asset.mime }));
  }
  return { project, media, report: { imported: [`${project.tracks.length} tracks, ${media.size} media files`], skipped } };
}

export interface PackageIo {
  ask: Ask;
  hasProject(id: string): Promise<boolean>;
  commit(project: Project, media: ReadonlyMap<string, Blob>, mode: "add" | "replace"): Promise<void>;
}

export type ImportStatus = "added" | "replaced" | "kept-both" | "cancelled";

export interface ImportResult {
  status: ImportStatus;
  projectId?: string;
  projectName?: string;
  report: ImportReport;
}

/** Reads a package file, asks what to do when a saved project has the same id, and stores the result. */
export async function importPackageFile(file: Blob, io: PackageIo): Promise<ImportResult> {
  const parsed = parsePackageText(await file.text());
  const { project, report } = parsed;

  let mode: "add" | "replace" = "add";
  let status: ImportStatus = "added";
  let target: Project = project;
  if (await io.hasProject(project.id)) {
    const choice = await io.ask({
      title: `"${project.name}" is already saved here`,
      message: "A project with the same identity is on this device. Keep both, or replace the saved one with this file?",
      choices: [
        { id: "both", label: "Keep both", tone: "primary" },
        { id: "replace", label: "Replace the saved project", tone: "danger" },
        { id: "cancel", label: "Cancel", tone: "neutral" },
      ],
    });
    if (choice === "replace") {
      mode = "replace";
      status = "replaced";
    } else if (choice === "both") {
      target = { ...project, id: newId("proj"), name: `${project.name} (imported)` };
      status = "kept-both";
    } else {
      return { status: "cancelled", report };
    }
  }

  const { project: remapped, idMap } = remapAssetIds(target);
  const media = new Map<string, Blob>();
  for (const [oldId, blob] of parsed.media) {
    const fresh = idMap.get(oldId);
    if (fresh) media.set(fresh, blob);
  }
  await io.commit(remapped, media, mode);
  return { status, projectId: remapped.id, projectName: remapped.name, report };
}

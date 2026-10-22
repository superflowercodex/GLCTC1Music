/**
 * Reads projects made by the old studio (/daw.html) without ever changing its data.
 *
 * The old studio shares this site's browser storage, so everything here is strictly read-only:
 * the old database is opened without a version (so it can never be upgraded), only read-only
 * transactions are used, and a database that does not exist is never opened (opening would create it).
 */
import { PackageError, base64ToBytes } from "./binary";
import { remapAssetIds } from "./migrate";
import { newId, newProject, type Asset, type Clip, type Note, type Project, type Track, type TrackKind } from "./model";
import type { ImportReport, ParsedImport } from "./package";

export const LEGACY_DB_NAME = "glctc1-sequencer-local";
export const LEGACY_PROJECT_STORE = "projects";
export const LEGACY_WAM_KEY = "glctc1.wams";

export class LegacyReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyReadError";
  }
}

type Raw = Record<string, unknown>;

function rec(value: unknown): Raw | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : null;
}
function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function dbOf(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 0.001));
}

export interface LegacySummary {
  id: string;
  name: string;
  updated: number;
  trackCount: number;
  bpm: number;
}

export type LegacyAvailability =
  | { status: "found"; projects: LegacySummary[] }
  | { status: "none" }
  /** The browser cannot list databases, so it cannot be checked without risking creating one. */
  | { status: "unsupported" };

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new LegacyReadError(`Could not read the old studio's saved projects: ${req.error?.message ?? "unknown error"}`));
  });
}

/** Opens the old database for reading, or returns null when it does not exist or cannot be checked safely. */
async function openLegacy(idb: IDBFactory): Promise<{ db: IDBDatabase } | "none" | "unsupported"> {
  if (typeof idb.databases !== "function") return "unsupported";
  const existing = await idb.databases();
  if (!existing.some((d) => d.name === LEGACY_DB_NAME)) return "none";
  return new Promise((resolve, reject) => {
    // No version argument: an existing database opens at its own version and is never upgraded.
    const req = idb.open(LEGACY_DB_NAME);
    req.onupgradeneeded = () => {
      // Only reachable if the database vanished between the check and the open. Cancel so nothing is created.
      req.transaction?.abort();
    };
    req.onsuccess = () => resolve({ db: req.result });
    req.onerror = () => {
      if (req.error?.name === "AbortError") resolve("none");
      else reject(new LegacyReadError(`Could not open the old studio's storage: ${req.error?.message ?? "unknown error"}`));
    };
    req.onblocked = () => reject(new LegacyReadError("The old studio's storage is busy. Close the old studio tab and try again."));
  });
}

async function withLegacyStore<T>(idb: IDBFactory, work: (store: IDBObjectStore) => Promise<T>, whenAbsent: T): Promise<T> {
  const opened = await openLegacy(idb);
  if (opened === "none" || opened === "unsupported") return whenAbsent;
  const { db } = opened;
  try {
    if (!db.objectStoreNames.contains(LEGACY_PROJECT_STORE)) return whenAbsent;
    const tx = db.transaction(LEGACY_PROJECT_STORE, "readonly");
    return await work(tx.objectStore(LEGACY_PROJECT_STORE));
  } finally {
    db.close();
  }
}

export async function detectLegacyProjects(idb: IDBFactory = indexedDB): Promise<LegacyAvailability> {
  const opened = await openLegacy(idb);
  if (opened === "none") return { status: "none" };
  if (opened === "unsupported") return { status: "unsupported" };
  opened.db.close();
  const records = await withLegacyStore<unknown[]>(idb, (store) => requestResult(store.getAll()), []);
  const projects: LegacySummary[] = [];
  for (const record of records) {
    const raw = rec(record);
    if (!raw || typeof raw.id !== "string") continue;
    projects.push({
      id: raw.id,
      name: str(raw.name, "Untitled"),
      updated: num(raw.updated, num(raw.created, 0)),
      trackCount: list(raw.tracks).length,
      bpm: num(raw.bpm, 130),
    });
  }
  projects.sort((a, b) => b.updated - a.updated);
  return projects.length ? { status: "found", projects } : { status: "none" };
}

export async function readLegacyProjectRecord(id: string, idb: IDBFactory = indexedDB): Promise<Raw> {
  const record = await withLegacyStore<unknown>(idb, (store) => requestResult(store.get(id)), undefined);
  const raw = rec(record);
  if (!raw) throw new LegacyReadError("That project is no longer in the old studio.");
  return raw;
}

/** Saved plugin addresses from the old studio. Reads one key and writes nothing. */
export function readLegacyPlugins(storage: Pick<Storage, "getItem"> | null): Array<{ name: string; url: string }> {
  if (!storage) return [];
  let parsed: unknown;
  try {
    const text = storage.getItem(LEGACY_WAM_KEY);
    parsed = text ? JSON.parse(text) : [];
  } catch {
    return [];
  }
  return list(parsed).flatMap((entry) => {
    const e = rec(entry);
    return e && typeof e.url === "string" && typeof e.name === "string" ? [{ name: e.name, url: e.url }] : [];
  });
}

function dataUrlToBlob(url: string): Blob | null {
  // indexOf instead of a regex: these strings can be tens of megabytes.
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const [mime = "", ...flags] = url.slice(5, comma).split(";");
  const payload = url.slice(comma + 1);
  return new Blob([flags.includes("base64") ? base64ToBytes(payload) : decodeURIComponent(payload)], { type: mime });
}

export function isLegacyPackage(file: Raw): boolean {
  return Array.isArray(file.tracks) && Array.isArray(file.assets) && file.format === undefined;
}

export function parseLegacyPackage(file: Raw): ParsedImport {
  const assets = list(file.assets).map((a) => {
    const asset = rec(a);
    if (!asset) throw new PackageError("This old-studio package has a damaged media entry.");
    if (typeof asset.data === "string" && !asset.blob) {
      const blob = dataUrlToBlob(asset.data);
      if (!blob) throw new PackageError(`The media "${str(asset.name, "file")}" in this old-studio package is damaged.`);
      return { ...asset, blob };
    }
    return asset;
  });
  return convertLegacyProject({ ...file, assets });
}

const DEFAULT_COLORS = ["#79ebff", "#8e7cff", "#ff63d8", "#7cf0c0", "#ffd36a", "#ff8a65", "#64b5f6", "#ba68c8"];

function parseBeatsPerBar(timeSig: unknown): number {
  const match = typeof timeSig === "string" ? /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(timeSig) : null;
  if (!match) return 4;
  const bar = (Number(match[1]) * 4) / Number(match[2]);
  return Number.isFinite(bar) && bar > 0 ? bar : 4;
}

function assetKind(asset: Raw): Asset["kind"] {
  const type = str(asset.type, "");
  if (type === "audio" || type === "video" || type === "image" || type === "midi") return type;
  const mime = str(asset.mime, "");
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("midi")) return "midi";
  return "audio";
}

/**
 * Converts one old-studio project (IndexedDB record or package, with each asset's media as `blob`) into a new project.
 * The result always has fresh project and asset ids, so it can never overwrite anything. Whatever has no equivalent
 * is listed in the report.
 */
export function convertLegacyProject(raw: Raw, now: number = Date.now()): ParsedImport {
  if (!Array.isArray(raw.tracks) || !Array.isArray(raw.assets)) {
    throw new PackageError("This is not an old-studio project: it has no tracks or media list.");
  }
  const imported: string[] = [];
  const skipped: string[] = [];
  const base = newProject(str(raw.name, "Imported project"));
  const bpm = Math.min(300, Math.max(30, num(raw.bpm, 130)));
  const beatsPerBar = parseBeatsPerBar(raw.timeSig);
  const toBar = (beats: number): number => beats / beatsPerBar + 1;

  const media = new Map<string, Blob>();
  const assets: Asset[] = [];
  const lostAssets = new Set<string>();
  for (const a of raw.assets) {
    const asset = rec(a);
    if (!asset || typeof asset.id !== "string") {
      skipped.push("A media entry without an id was skipped.");
      continue;
    }
    const name = str(asset.name, "Media");
    if (!(asset.blob instanceof Blob)) {
      lostAssets.add(asset.id);
      skipped.push(`Media "${name}" has no stored file, so it and the clips that used it were skipped.`);
      continue;
    }
    media.set(asset.id, asset.blob);
    assets.push({
      id: asset.id,
      kind: assetKind(asset),
      name,
      mime: str(asset.mime, asset.blob.type),
      bytes: asset.blob.size,
      ...(typeof asset.duration === "number" ? { durationSec: asset.duration } : {}),
      ...(typeof asset.bpm === "number" && asset.bpm > 0 ? { detectedBpm: asset.bpm } : {}),
      ...(typeof asset.key === "string" && asset.key ? { detectedKey: asset.key } : {}),
      addedAt: now,
    });
  }

  let customRate = 0;
  let automation = 0;
  let inserts = 0;
  const tracks: Track[] = [];
  for (const t of raw.tracks) {
    const lt = rec(t);
    if (!lt) continue;
    const name = str(lt.name, "Track");
    const clips = list(lt.clips).flatMap((c): Clip[] => {
      const lc = rec(c);
      if (!lc) return [];
      const kind = str(lc.kind, "audio");
      if (kind === "auto") {
        automation += 1;
        return [];
      }
      if (typeof lc.assetId === "string" && lostAssets.has(lc.assetId)) return [];
      if (num(lc.rate, 1) !== 1) customRate += 1;
      const clipKind: Clip["kind"] = kind === "midi" || kind === "video" || kind === "image" ? kind : "audio";
      const notes: Note[] | undefined =
        clipKind === "midi"
          ? list(lc.notes).flatMap((n) => {
              const ln = rec(n);
              if (!ln) return [];
              const velocity = num(ln.velocity, 0.75);
              return [{ pitch: num(ln.pitch, 60), startStep: num(ln.beat, 0) * 4, lengthSteps: Math.max(0.25, num(ln.length, 0.25) * 4), velocity: velocity > 1 ? velocity / 127 : velocity }];
            })
          : undefined;
      return [
        {
          id: str(lc.id, newId("clip")),
          kind: clipKind,
          name: str(lc.name, name),
          startBar: toBar(num(lc.start, 0)),
          lengthBars: Math.max(0.0625, num(lc.length, beatsPerBar)) / beatsPerBar,
          ...(typeof lc.assetId === "string" ? { assetId: lc.assetId } : {}),
          offsetSec: num(lc.offset, 0),
          gainDb: dbOf(num(lc.gain, 1)),
          pitchSemitones: num(lc.pitch, 0),
          fineCents: num(lc.fine, 0),
          warp: lc.warp === true,
          keyLock: lc.keyLock === true,
          fadeInSteps: num(lc.fadeIn, 0) * 4,
          fadeOutSteps: num(lc.fadeOut, 0) * 4,
          ...(notes ? { notes } : {}),
        },
      ];
    });

    const type = str(lt.type, "audio");
    if (type === "auto") {
      skipped.push(`Automation track "${name}" (automation is not carried over).`);
      continue;
    }
    if (/module track/i.test(name) && clips.length === 0) {
      skipped.push(`"${name}": module settings live in the old studio's own storage and are not part of a project.`);
      continue;
    }
    if (lt.looper) skipped.push(`"${name}": looper pad settings (the old studio never saved the sample audio).`);
    if (lt.inst && type === "midi") skipped.push(`"${name}": its built-in "${str(lt.inst, "synth")}" voice. Give the track an instrument in the Play room.`);
    if (lt.wamInst) skipped.push(`"${name}": its plugin instrument. Add the plugin again from the Library.`);
    const fx = rec(lt.fx);
    const fxOn = fx?.on === true;
    if (fxOn && fx?.flt === true) inserts += 1;
    inserts += list(lt.plugs).filter((p) => rec(p)?.on === true).length;

    const kind: TrackKind = type === "midi" ? "instrument" : type === "video" ? "video" : "audio";
    tracks.push({
      id: str(lt.id, newId("trk")),
      name,
      kind,
      color: str(lt.color, DEFAULT_COLORS[tracks.length % DEFAULT_COLORS.length] ?? "#79ebff"),
      muted: lt.mute === true,
      solo: lt.solo === true,
      gainDb: dbOf(num(lt.volume, 0.8)),
      pan: Math.min(1, Math.max(-1, num(lt.pan, 0))),
      sends: { reverb: fxOn && fx?.rev === true ? num(fx?.rs, 0) : 0, delay: fxOn && fx?.dly === true ? num(fx?.ds, 0) : 0 },
      inserts: [],
      cue: lt.cue === true,
      toMaster: lt.send !== false,
      clips,
      automation: [],
    });
  }
  if (automation) skipped.push(`${automation} automation object${automation === 1 ? "" : "s"} on clips.`);
  if (inserts) skipped.push(`${inserts} track effect${inserts === 1 ? "" : "s"} (filter and insert effects) were not carried over; sends were.`);
  if (customRate) skipped.push(`${customRate} clip${customRate === 1 ? "" : "s"} used a custom playback rate and will play at normal speed.`);
  if (rec(raw.beatLab)) skipped.push("80LA8 patterns and samples (the drum lab's state is not carried over).");

  const loop = rec(raw.loop);
  const mfx = rec(raw.mfx);
  const mixer = rec(raw.mixer);
  const masterObj = rec(raw.master);
  const masterLinear = typeof raw.master === "number" ? raw.master : num(masterObj?.volume, 0.8);
  const device = (value: unknown): string => {
    const id = str(value, "");
    return id === "" || /^(off|none|main|default)$/i.test(id) ? "default" : id;
  };
  const mfxOn = mfx?.on === true;

  const project: Project = {
    ...base,
    createdAt: num(raw.created, now),
    updatedAt: now,
    bpm,
    beatsPerBar,
    loop: loop
      ? { on: loop.on === true, startBar: toBar(num(loop.start, 0)), endBar: toBar(num(loop.end, beatsPerBar * 4)) }
      : base.loop,
    tracks,
    assets,
    master: {
      ...base.master,
      gainDb: dbOf(masterLinear),
      filterOn: mfxOn && mfx?.flt === true,
      delayOn: mfxOn && mfx?.dly === true,
      reverbOn: mfxOn && mfx?.rev === true,
      headphoneVolume: num(mixer?.hpVol, base.master.headphoneVolume),
      boothVolume: num(mixer?.boothVol, base.master.boothVolume),
      headphoneDeviceId: device(mixer?.hpDev),
      boothDeviceId: device(mixer?.boothDev),
    },
    stageAspect: raw.stage === "phone" ? "phone" : "wide",
  };

  const clipCount = tracks.reduce((n, t) => n + t.clips.length, 0);
  imported.push(`${tracks.length} tracks, ${clipCount} clips, ${assets.length} media files, ${bpm} BPM`);
  const fresh = remapAssetIds(project);
  const remappedMedia = new Map<string, Blob>();
  for (const [oldId, blob] of media) {
    const id = fresh.idMap.get(oldId);
    if (id) remappedMedia.set(id, blob);
  }
  const report: ImportReport = { imported, skipped };
  return { project: fresh.project, media: remappedMedia, report };
}

/** Reads one project from the old studio's database and converts it. Nothing in the old database changes. */
export async function readAndConvertLegacyProject(id: string, idb: IDBFactory = indexedDB): Promise<ParsedImport> {
  return convertLegacyProject(await readLegacyProjectRecord(id, idb));
}

export const LEGACY_DIVINE_DB = "glctc1_divine09_samples";
const LEGACY_MIDI_KEY = "glctc1.midiBindings";

/** Notes about old-studio data that lives outside projects and is not carried over, so the import report can say so. */
export async function describeLegacyExtras(storage: Pick<Storage, "getItem"> | null, idb: IDBFactory = indexedDB): Promise<string[]> {
  const notes: string[] = [];
  const plugins = readLegacyPlugins(storage);
  if (plugins.length) notes.push(`${plugins.length} saved plugin address${plugins.length === 1 ? "" : "es"}. Add them again under Plugins and MIDI.`);
  try {
    if (storage?.getItem(LEGACY_MIDI_KEY)) notes.push("MIDI links (they were tied to the old studio's control ids).");
  } catch {
    // Unreadable storage means there is nothing to report.
  }
  if (typeof idb.databases === "function") {
    const names = (await idb.databases()).map((d) => d.name);
    if (names.includes(LEGACY_DIVINE_DB)) notes.push("DIVINE09 sample slots (the old studio kept them outside projects).");
  }
  return notes;
}

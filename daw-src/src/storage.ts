// The old DAW (/daw.html) lives on the same domain and uses its own storage names.
// Everything here uses names the old DAW never touches, so the two cannot overwrite each other.
export const DB_NAME = "glctc1-studio-v1";
export const LS_PREFIX = "glctc1studio.";

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

function ls(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private windows and blocked site data throw on access.
    return null;
  }
}

export function lsGet<T>(key: string, fallback: T): T {
  const store = ls();
  if (!store) return fallback;
  try {
    const raw = store.getItem(LS_PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Returns false when the browser refused the write (quota or blocked storage), so callers can tell the user. */
export function lsSet(key: string, value: unknown): boolean {
  const store = ls();
  if (!store) return false;
  try {
    store.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function lsRemove(key: string): void {
  try {
    ls()?.removeItem(LS_PREFIX + key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

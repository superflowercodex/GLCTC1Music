import { lsGet, lsSet } from "../storage";
import { newId } from "../project/model";
import { createStore, type Store } from "../store/store";
import { getEngine } from "./engine";

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginError";
  }
}

export type PluginRole = "instrument" | "effect";

export interface SavedPlugin {
  id: string;
  name: string;
  url: string;
  role: PluginRole;
}

export interface PluginEntry extends SavedPlugin {
  /** Loaded from a file this session. A file has no address to reload it from, so it is not remembered. */
  sessionOnly: boolean;
}

/** The parts of a Web Audio Module (WAM 2) instance this studio uses. */
export interface WamInstance {
  audioNode: AudioNode;
  descriptor?: { name?: string; isInstrument?: boolean; vendor?: string };
  createGui?(): Promise<HTMLElement>;
}

export interface WamConstructor {
  createInstance(groupId: string, ctx: BaseAudioContext, initialState?: unknown): Promise<WamInstance>;
}

const NATIVE_EXTENSION = /\.(vst3?|component|dll|au|clap|aaxplugin)(\?|#|$)/i;

/** Returns the address to import, or throws with a reason. Plain http is only allowed for the local machine. */
export function validatePluginAddress(input: string): string {
  const text = input.trim();
  if (!text) throw new PluginError("Paste the address of a plugin first.");
  if (NATIVE_EXTENSION.test(text)) {
    throw new PluginError("That is a native plugin (VST or AU) and cannot run in a browser. Use its Web Audio Module version instead.");
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new PluginError("That is not a web address. It should start with https://.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:" || url.protocol === "blob:" || (url.protocol === "http:" && local)) return url.href;
  throw new PluginError("Plugins must load over https:// (http:// is only allowed for localhost).");
}

/** Checks that a loaded module looks like a Web Audio Module and returns its constructor. */
export function validateModuleShape(mod: unknown): WamConstructor {
  const candidate = typeof mod === "object" && mod !== null ? (mod as { default?: unknown }).default : undefined;
  if (typeof candidate !== "function") {
    throw new PluginError("That file loaded, but it is not a Web Audio Module: it has no default export.");
  }
  if (typeof (candidate as { createInstance?: unknown }).createInstance !== "function") {
    throw new PluginError("That file loaded, but it is not a Web Audio Module: its default export has no createInstance function.");
  }
  return candidate as unknown as WamConstructor;
}

export interface PluginHostDeps {
  importModule(url: string): Promise<unknown>;
  /** Starts the WAM host group and returns its id. */
  initHost(ctx: BaseAudioContext): Promise<string>;
  context(): BaseAudioContext;
  load(): unknown;
  save(plugins: SavedPlugin[]): boolean;
}

const HOST_SDK_URLS = [
  "https://cdn.jsdelivr.net/npm/@webaudiomodules/sdk/src/initializeWamHost.js",
  "https://unpkg.com/@webaudiomodules/sdk/src/initializeWamHost.js",
];

export function defaultPluginDeps(): PluginHostDeps {
  let hostGroup: Promise<string> | undefined;
  return {
    importModule: (url) => import(/* @vite-ignore */ url),
    initHost(ctx) {
      hostGroup ??= (async () => {
        let last: unknown;
        for (const url of HOST_SDK_URLS) {
          try {
            const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; initializeWamHost?: unknown };
            const init = (mod.default ?? mod.initializeWamHost) as ((c: BaseAudioContext) => Promise<[string, string]>) | undefined;
            if (typeof init !== "function") throw new PluginError("The plugin host library did not have the expected shape.");
            return (await init(ctx))[0];
          } catch (error) {
            last = error;
          }
        }
        hostGroup = undefined;
        throw new PluginError(`Could not load the plugin host library (it needs an internet connection): ${last instanceof Error ? last.message : String(last)}`);
      })();
      return hostGroup;
    },
    context: () => getEngine().ctx,
    load: () => lsGet<unknown>("plugins", []),
    save: (plugins) => lsSet("plugins", plugins),
  };
}

function isSaved(value: unknown): value is SavedPlugin {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string" && typeof v.url === "string" && (v.role === "instrument" || v.role === "effect");
}

export interface PluginsState {
  plugins: PluginEntry[];
  saveError: string | null;
}

export interface LivePlugin {
  entry: PluginEntry;
  instance: WamInstance;
}

export class PluginHost {
  readonly store: Store<PluginsState>;

  constructor(private readonly deps: PluginHostDeps = defaultPluginDeps()) {
    const stored = deps.load();
    const plugins = (Array.isArray(stored) ? stored.filter(isSaved) : []).map((p) => ({ ...p, sessionOnly: false }));
    this.store = createStore<PluginsState>({ plugins, saveError: null });
  }

  list(): PluginEntry[] {
    return this.store.get().plugins;
  }

  private async open(address: string): Promise<{ ctor: WamConstructor; instance: WamInstance }> {
    let mod: unknown;
    try {
      mod = await this.deps.importModule(address);
    } catch (error) {
      throw new PluginError(`The plugin could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
    const ctor = validateModuleShape(mod);
    const ctx = this.deps.context();
    const group = await this.deps.initHost(ctx);
    let instance: WamInstance;
    try {
      instance = await ctor.createInstance(group, ctx);
    } catch (error) {
      throw new PluginError(`The plugin loaded but could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!instance || typeof instance !== "object" || !("audioNode" in instance)) {
      throw new PluginError("The plugin started but did not provide an audio node.");
    }
    return { ctor, instance };
  }

  private async register(address: string, sessionOnly: boolean, fallbackName: string): Promise<PluginEntry> {
    const { instance } = await this.open(address);
    instance.audioNode.disconnect();
    const entry: PluginEntry = {
      id: newId("plug"),
      name: instance.descriptor?.name?.trim() || fallbackName,
      url: address,
      role: instance.descriptor?.isInstrument ? "instrument" : "effect",
      sessionOnly,
    };
    const existing = this.list().find((p) => p.url === address);
    this.commit(existing ? this.list().map((p) => (p === existing ? { ...entry, id: existing.id } : p)) : [...this.list(), entry]);
    return existing ? { ...entry, id: existing.id } : entry;
  }

  async addFromUrl(input: string): Promise<PluginEntry> {
    const address = validatePluginAddress(input);
    return this.register(address, false, new URL(address).pathname.split("/").pop() || "Plugin");
  }

  async addFromFile(file: File): Promise<PluginEntry> {
    if (NATIVE_EXTENSION.test(file.name)) {
      throw new PluginError(`${file.name} is a native plugin and cannot run in a browser. Use its Web Audio Module (.js) version instead.`);
    }
    if (!/\.m?js$/i.test(file.name)) throw new PluginError("Choose a plugin module file ending in .js or .mjs.");
    const address = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: "text/javascript" }));
    try {
      return await this.register(address, true, file.name.replace(/\.m?js$/i, ""));
    } catch (error) {
      URL.revokeObjectURL(address);
      throw error;
    }
  }

  remove(id: string): void {
    const entry = this.list().find((p) => p.id === id);
    if (entry?.sessionOnly) URL.revokeObjectURL(entry.url);
    this.commit(this.list().filter((p) => p.id !== id));
  }

  /** Creates a working copy of a saved plugin on the studio's audio context. */
  async instantiate(id: string): Promise<LivePlugin> {
    const entry = this.list().find((p) => p.id === id);
    if (!entry) throw new PluginError("That plugin is not in your list any more.");
    const { instance } = await this.open(entry.url);
    return { entry, instance };
  }

  private commit(plugins: PluginEntry[]): void {
    const ok = this.deps.save(plugins.filter((p) => !p.sessionOnly).map(({ id, name, url, role }) => ({ id, name, url, role })));
    this.store.set({ plugins, saveError: ok ? null : "This browser would not store your plugin list, so it will be gone after a reload." });
  }
}

export const pluginHost = new PluginHost();

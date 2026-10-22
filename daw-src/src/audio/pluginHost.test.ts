import { describe, expect, it, vi } from "vitest";
import { PluginError, PluginHost, validateModuleShape, validatePluginAddress, type PluginHostDeps, type SavedPlugin } from "./pluginHost";

function deps(overrides: Partial<PluginHostDeps> = {}): PluginHostDeps & { saved: SavedPlugin[][] } {
  const saved: SavedPlugin[][] = [];
  const node = { disconnect: vi.fn() } as unknown as AudioNode;
  class Wam {
    static async createInstance(): Promise<{ audioNode: AudioNode; descriptor: { name: string; isInstrument: boolean } }> {
      return { audioNode: node, descriptor: { name: "Tape Saturator", isInstrument: false } };
    }
  }
  return {
    saved,
    importModule: async () => ({ default: Wam }),
    initHost: async () => "group",
    context: () => ({}) as BaseAudioContext,
    load: () => [],
    save: (p) => (saved.push(p), true),
    ...overrides,
  };
}

describe("plugin addresses", () => {
  it("accepts https, local http and blob addresses", () => {
    expect(validatePluginAddress(" https://example.com/p/index.js ")).toBe("https://example.com/p/index.js");
    expect(validatePluginAddress("http://localhost:3000/p.js")).toContain("localhost");
    expect(validatePluginAddress("blob:https://x/abc")).toContain("blob:");
  });

  it.each([
    ["", /Paste the address/],
    ["Reverb.vst3", /native plugin/],
    ["https://x.com/a.dll", /native plugin/],
    ["not a url", /not a web address/],
    ["http://example.com/p.js", /https/],
    ["javascript:alert(1)", /https/],
  ])("rejects %j", (input, pattern) => {
    expect(() => validatePluginAddress(input)).toThrow(pattern);
    expect(() => validatePluginAddress(input)).toThrow(PluginError);
  });
});

describe("module shape", () => {
  it("rejects modules that are not Web Audio Modules, saying why", () => {
    expect(() => validateModuleShape(undefined)).toThrow(/no default export/);
    expect(() => validateModuleShape({ default: 5 })).toThrow(/no default export/);
    expect(() => validateModuleShape({ default: class {} })).toThrow(/no createInstance/);
    expect(validateModuleShape({ default: class { static createInstance(): void {} } })).toBeTypeOf("function");
  });
});

describe("PluginHost", () => {
  it("adds from an address, reads its name and role, and remembers it", async () => {
    const d = deps();
    const host = new PluginHost(d);
    const entry = await host.addFromUrl("https://example.com/tape.js");
    expect(entry).toMatchObject({ name: "Tape Saturator", role: "effect", sessionOnly: false });
    expect(host.list()).toHaveLength(1);
    expect(d.saved.at(-1)).toEqual([{ id: entry.id, name: "Tape Saturator", url: "https://example.com/tape.js", role: "effect" }]);
  });

  it("does not list the same address twice", async () => {
    const host = new PluginHost(deps());
    await host.addFromUrl("https://example.com/tape.js");
    await host.addFromUrl("https://example.com/tape.js");
    expect(host.list()).toHaveLength(1);
  });

  it("surfaces import failures, bad shapes and start failures without adding anything", async () => {
    const failing = new PluginHost(deps({ importModule: async () => { throw new Error("404"); } }));
    await expect(failing.addFromUrl("https://example.com/a.js")).rejects.toThrow(/could not be loaded: 404/);

    const wrong = new PluginHost(deps({ importModule: async () => ({ default: class {} }) }));
    await expect(wrong.addFromUrl("https://example.com/a.js")).rejects.toThrow(/createInstance/);

    class Broken {
      static async createInstance(): Promise<never> {
        throw new Error("no wasm");
      }
    }
    const broken = new PluginHost(deps({ importModule: async () => ({ default: Broken }) }));
    await expect(broken.addFromUrl("https://example.com/a.js")).rejects.toThrow(/could not start: no wasm/);

    const noHost = new PluginHost(deps({ initHost: async () => { throw new PluginError("Could not load the plugin host library"); } }));
    await expect(noHost.addFromUrl("https://example.com/a.js")).rejects.toThrow(/host library/);

    for (const h of [failing, wrong, broken, noHost]) expect(h.list()).toEqual([]);
  });

  it("removes plugins and reloads the saved list, ignoring damaged entries", async () => {
    const d = deps();
    const host = new PluginHost(d);
    const entry = await host.addFromUrl("https://example.com/tape.js");
    host.remove(entry.id);
    expect(host.list()).toEqual([]);

    const good: SavedPlugin = { id: "p", name: "Pad", url: "https://x/pad.js", role: "instrument" };
    const again = new PluginHost(deps({ load: () => [good, { id: 1 }, "junk"] }));
    expect(again.list()).toEqual([{ ...good, sessionOnly: false }]);
  });

  it("reports when the list cannot be stored", async () => {
    const host = new PluginHost(deps({ save: () => false }));
    await host.addFromUrl("https://example.com/tape.js");
    expect(host.store.get().saveError).toMatch(/would not store/);
  });

  it("instantiates a saved plugin and says when it is gone", async () => {
    const host = new PluginHost(deps());
    const entry = await host.addFromUrl("https://example.com/tape.js");
    const live = await host.instantiate(entry.id);
    expect(live.instance.descriptor?.name).toBe("Tape Saturator");
    await expect(host.instantiate("missing")).rejects.toThrow(/not in your list/);
  });

  it("refuses native plugin files", async () => {
    const host = new PluginHost(deps());
    await expect(host.addFromFile(new File(["x"], "Reverb.vst3"))).rejects.toThrow(/native plugin/);
    await expect(host.addFromFile(new File(["x"], "notes.txt"))).rejects.toThrow(/\.js or \.mjs/);
  });
});

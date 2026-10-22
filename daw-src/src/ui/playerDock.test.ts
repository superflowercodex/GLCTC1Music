import { afterEach, describe, expect, it, vi } from "vitest";
import { nextDock } from "./playerDock";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("nextDock", () => {
  it("toggles, minimises and expands", () => {
    expect(nextDock(false, "toggle")).toBe(true);
    expect(nextDock(true, "toggle")).toBe(false);
    expect(nextDock(false, "minimise")).toBe(true);
    expect(nextDock(true, "minimise")).toBe(true);
    expect(nextDock(true, "expand")).toBe(false);
    expect(nextDock(false, "expand")).toBe(false);
  });
});

describe("persistence", () => {
  it("starts expanded when nothing is stored", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const { playerDock } = await import("./playerDock");
    expect(playerDock.get().minimised).toBe(false);
  });

  it("restores a stored choice under the glctc1studio. prefix", async () => {
    vi.stubGlobal("localStorage", fakeStorage({ "glctc1studio.player.minimised": "true" }));
    const { playerDock } = await import("./playerDock");
    expect(playerDock.get().minimised).toBe(true);
  });

  it("starts on the mini-player on a phone when nothing is stored, but a stored choice still wins", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const { readMinimised } = await import("./playerDock");
    expect(readMinimised(true)).toBe(true);
    expect(readMinimised(false)).toBe(false);
    vi.stubGlobal("localStorage", fakeStorage({ "glctc1studio.player.minimised": "false" }));
    expect(readMinimised(true)).toBe(false);
  });

  it("falls back to expanded for corrupt values", async () => {
    vi.stubGlobal("localStorage", fakeStorage({ "glctc1studio.player.minimised": "{nope" }));
    const { playerDock } = await import("./playerDock");
    expect(playerDock.get().minimised).toBe(false);
  });

  it("writes every change through and notifies subscribers", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const { playerDock, dispatchDock } = await import("./playerDock");
    const seen = vi.fn();
    playerDock.subscribe(seen);
    dispatchDock("toggle");
    expect(playerDock.get().minimised).toBe(true);
    expect(storage.data.get("glctc1studio.player.minimised")).toBe("true");
    dispatchDock("minimise");
    expect(seen).toHaveBeenCalledTimes(1);
    dispatchDock("expand");
    expect(storage.data.get("glctc1studio.player.minimised")).toBe("false");
  });

  it("keeps working when storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { playerDock, dispatchDock } = await import("./playerDock");
    expect(playerDock.get().minimised).toBe(false);
    dispatchDock("minimise");
    expect(playerDock.get().minimised).toBe(true);
  });
});

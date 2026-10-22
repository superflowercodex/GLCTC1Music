import { describe, expect, it, vi } from "vitest";
import { installAudioUnlock, preferPlaybackSession, type ResumableContext } from "./unlock";

function fakeContext(state: string): ResumableContext & { resume: ReturnType<typeof vi.fn> } {
  const ctx = { state, resume: vi.fn(async () => void (ctx.state = "running")) };
  return ctx;
}

describe("installAudioUnlock", () => {
  it("resumes a suspended context on the first tap and leaves a running one alone", async () => {
    const target = new EventTarget();
    const ctx = fakeContext("suspended");
    const off = installAudioUnlock(target, () => ctx);
    target.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event("touchend"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    off();
  });

  it("resumes again after iOS interrupts the context, and stops listening once removed", () => {
    const target = new EventTarget();
    const ctx = fakeContext("interrupted");
    const off = installAudioUnlock(target, () => ctx);
    target.dispatchEvent(new Event("click"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    off();
    (ctx as { state: string }).state = "suspended";
    target.dispatchEvent(new Event("click"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("does nothing before the engine exists or after the context closed", () => {
    const target = new EventTarget();
    let ctx: ReturnType<typeof fakeContext> | undefined;
    const off = installAudioUnlock(target, () => ctx);
    expect(() => target.dispatchEvent(new Event("keydown"))).not.toThrow();
    ctx = fakeContext("closed");
    target.dispatchEvent(new Event("keydown"));
    expect(ctx.resume).not.toHaveBeenCalled();
    off();
  });

  it("swallows a refused resume instead of throwing from the tap", async () => {
    const target = new EventTarget();
    const ctx = { state: "suspended", resume: vi.fn(() => Promise.reject(new Error("not allowed"))) };
    const off = installAudioUnlock(target, () => ctx);
    target.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(ctx.resume).toHaveBeenCalled();
    off();
  });
});

describe("preferPlaybackSession", () => {
  it("asks iOS for a playback session when the API exists", () => {
    const nav = { audioSession: { type: "auto" } } as unknown as Navigator;
    preferPlaybackSession(nav);
    expect((nav as unknown as { audioSession: { type: string } }).audioSession.type).toBe("playback");
    expect(() => preferPlaybackSession({} as Navigator)).not.toThrow();
    expect(() => preferPlaybackSession(undefined)).not.toThrow();
  });
});

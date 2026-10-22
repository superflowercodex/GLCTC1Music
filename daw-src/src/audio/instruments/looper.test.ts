import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { bounceInstrument, measure } from "../bounce";
import { newProject } from "../../project/model";
import { projectStore } from "../../store/project";
import { Looper, PAD_BASE_NOTE, loopBars } from "./looper";
import { cacheBuffer } from "./voice/assets";
import type { LooperData } from "./voice/looperKits";
import { emptyPad } from "./voice/padPlayer";

type Offline = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
const Ctx = NodeOfflineContext as unknown as Offline;
const SR = 44100;
const STEP = 0.125; // 120 BPM sixteenth

function setup(seconds: number): { ctx: OfflineAudioContext; looper: Looper } {
  const ctx = new Ctx(1, Math.round(seconds * SR), SR);
  const looper = new Looper(ctx);
  looper.transportRunning = () => true;
  looper.output.connect(ctx.destination);
  return { ctx, looper };
}

function energy(buffer: AudioBuffer, fromSec: number, toSec: number): number {
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = Math.floor(fromSec * SR); i < Math.floor(toSec * SR); i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, (toSec - fromSec) * SR));
}

const run = (looper: Looper, steps: number) => {
  for (let step = 0; step < steps; step++) looper.onStep(step, step * STEP, STEP);
};

beforeEach(() => {
  projectStore.set(() => ({ ...newProject(), bpm: 120, beatsPerBar: 4 }));
});

describe("Looper pads", () => {
  // Demo kit: pad 0 kick (one-shot), pad 8 bass loop (loop), pad 9 chord loop (loop).
  it("starts a loop on the next bar line, not when the pad is pressed", async () => {
    const { ctx, looper } = setup(5);
    looper.setPattern(null);
    expect(looper.pads[8].mode).toBe("loop");
    for (let step = 0; step < 5; step++) looper.onStep(step, step * STEP, STEP);
    looper.noteOn({ note: PAD_BASE_NOTE + 8, velocity: 1, time: 5 * STEP });
    expect(looper.padState(8)).toBe("queued");
    for (let step = 5; step < 30; step++) looper.onStep(step, step * STEP, STEP);
    expect(looper.padState(8)).toBe("playing");
    const out = await ctx.startRendering();
    expect(energy(out, 0, 1.95)).toBeLessThan(1e-4);
    expect(energy(out, 2.05, 2.6)).toBeGreaterThan(0.01);
  });

  it("starts at once when the transport is stopped", async () => {
    const { ctx, looper } = setup(1);
    looper.setPattern(null);
    looper.transportRunning = () => false;
    looper.noteOn({ note: PAD_BASE_NOTE + 8, velocity: 1, time: 0 });
    const out = await ctx.startRendering();
    expect(energy(out, 0.05, 0.5)).toBeGreaterThan(0.01);
  });

  it("stops a loop on the next bar when pressed again", async () => {
    const { ctx, looper } = setup(7);
    looper.setPattern(null);
    looper.noteOn({ note: PAD_BASE_NOTE + 8, velocity: 1, time: 0 });
    run(looper, 17);
    looper.noteOn({ note: PAD_BASE_NOTE + 8, velocity: 1, time: 17 * STEP });
    expect(looper.padState(8)).toBe("playing");
    for (let step = 17; step < 48; step++) looper.onStep(step, step * STEP, STEP);
    const out = await ctx.startRendering();
    expect(energy(out, 2.5, 3.9)).toBeGreaterThan(0.01);
    expect(energy(out, 4.2, 6)).toBeLessThan(1e-4);
  });

  it("plays a one-shot once and then stays silent", async () => {
    const { ctx, looper } = setup(3);
    looper.setPattern(null);
    looper.noteOn({ note: PAD_BASE_NOTE, velocity: 1, time: 0.1 });
    run(looper, 24);
    const out = await ctx.startRendering();
    expect(energy(out, 0.1, 0.4)).toBeGreaterThan(0.05);
    expect(energy(out, 1.0, 3)).toBeLessThan(1e-4);
  });

  it("holds only while pressed in hold mode", async () => {
    const render = async (release: boolean): Promise<number> => {
      const { ctx, looper } = setup(1.5);
      looper.setPattern(null);
      looper.setPad(4, { mode: "gate", fadeOut: 0.02 });
      looper.noteOn({ note: PAD_BASE_NOTE + 4, velocity: 1, time: 0 });
      if (release) looper.noteOff(PAD_BASE_NOTE + 4, 0.1);
      return energy(await ctx.startRendering(), 0.3, 0.45);
    };
    expect(await render(false)).toBeGreaterThan(0.005);
    expect(await render(true)).toBeLessThan(1e-4);
  });

  it("ignores notes outside the pad range and empty pads", () => {
    const { looper } = setup(1);
    looper.noteOn({ note: 20, velocity: 1 });
    looper.noteOn({ note: PAD_BASE_NOTE + 14, velocity: 1 });
    expect(looper.padState(14)).toBe("idle");
  });
});

describe("Looper kits and persistence", () => {
  it("round-trips pads, scenes and performance through serialize and restore", () => {
    const { looper } = setup(1);
    looper.setPad(2, { volume: 0.7, pitch: -5, start: 0.1, end: 0.8, filter: 0.4, reverb: 0.3, slices: [0.3, 0.6], mode: "gate" });
    looper.setSceneMember(1, 2, true);
    const state = looper.serialize();
    const { looper: other } = setup(1);
    other.restore(JSON.parse(JSON.stringify(state)));
    expect(other.pads[2]).toEqual(looper.pads[2]);
    expect(other.scenes[1][2]).toBe(true);
    expect(other.padBuffer(2)).toBeDefined();
    expect(other.serialize().data).toEqual(state.data);
  });

  it("keeps stored samples by asset id and resolves them from the cache", () => {
    const { ctx, looper } = setup(1);
    const buffer = ctx.createBuffer(1, 4410, SR);
    buffer.getChannelData(0).fill(0.3);
    cacheBuffer("smp-test", buffer);
    const data: LooperData = {
      pads: Array.from({ length: 16 }, (_, i) => (i === 3 ? { ...emptyPad(), name: "Mine", assetId: "smp-test" } : emptyPad())),
      scenes: [[], [], [], []],
      performance: [],
      performanceSteps: 16,
    };
    looper.restore({ kind: "looper", values: {}, data });
    expect(looper.pads[3].assetId).toBe("smp-test");
    expect(looper.padBuffer(3)).toBe(buffer);
    expect((looper.serialize().data as LooperData).pads[3].assetId).toBe("smp-test");
  });

  it("repairs damaged saved data instead of failing", () => {
    const { looper } = setup(1);
    expect(() => looper.restore({ kind: "looper", values: {}, data: { pads: [{ volume: "loud", mode: "banana", start: 5 }, null], scenes: "no" } })).not.toThrow();
    expect(looper.pads[0].mode).toBe("shot");
    expect(looper.pads[0].start).toBeLessThan(1);
    expect(looper.pads).toHaveLength(16);
  });

  it("loading a factory kit leaves the user's level and launch settings", () => {
    const { looper } = setup(1);
    looper.setParam("level", 0.3);
    looper.setParam("launch", 1);
    looper.loadPreset("kit-empty");
    expect(looper.pads.every((p) => !p.synth && !p.assetId)).toBe(true);
    expect(looper.getParam("level")).toBeCloseTo(0.3);
    expect(looper.getParam("launch")).toBe(1);
  });

  it("saves a user kit as a preset that brings the pads back", () => {
    const { looper } = setup(1);
    looper.loadPreset("kit-drums");
    looper.setPad(0, { volume: 0.5 });
    const preset = looper.saveUserPreset("Mine");
    looper.loadPreset("kit-empty");
    looper.loadPreset(preset.id);
    expect(looper.pads[0].volume).toBe(0.5);
    expect(looper.pads[0].synth).toBe("kick");
    looper.deleteUserPreset(preset.id);
  });
});

describe("Looper scenes", () => {
  it("exposes four scenes and clamps the choice", () => {
    const { looper } = setup(1);
    expect(looper.patternCount).toBe(4);
    expect(looper.activePattern).toBe(0);
    looper.setPattern(9);
    expect(looper.activePattern).toBe(3);
    looper.setPattern(null);
    expect(looper.activePattern).toBeNull();
    looper.setPattern(2);
    expect(looper.activePattern).toBe(2);
  });

  it("starts the scene's loops at bar one and stops them when the scene is silenced", async () => {
    const { ctx, looper } = setup(7);
    looper.setSceneMember(0, 8, true);
    looper.setPattern(0);
    for (let step = 0; step < 16; step++) looper.onStep(step, step * STEP, STEP);
    looper.setPattern(null);
    for (let step = 16; step < 56; step++) looper.onStep(step, step * STEP, STEP);
    const out = await ctx.startRendering();
    expect(energy(out, 0.1, 1.9)).toBeGreaterThan(0.01);
    expect(energy(out, 2.3, 7)).toBeLessThan(1e-4);
  });

  it("does not stop a loop started by hand when the scene is silenced", async () => {
    const { ctx, looper } = setup(5);
    looper.setPattern(null);
    looper.noteOn({ note: PAD_BASE_NOTE + 8, velocity: 1, time: 0 });
    for (let step = 0; step < 36; step++) looper.onStep(step, step * STEP, STEP);
    const out = await ctx.startRendering();
    expect(energy(out, 3, 4.4)).toBeGreaterThan(0.01);
  });
});

describe("Looper bounce", () => {
  it("renders the scene through bounceInstrument", async () => {
    const { looper } = setup(1);
    looper.setSceneMember(0, 8, true);
    const state = looper.serialize();
    const buffer = await bounceInstrument((ctx) => new Looper(ctx), { ...state, values: { ...state.values } }, {
      bars: 2,
      bpm: 120,
      tailSeconds: 0.5,
      offlineContext: Ctx,
    });
    expect(measure(buffer).rms).toBeGreaterThan(0.005);
    expect(measure(buffer).peak).toBeLessThan(2);
  });

  it("includes loops playing by hand when bouncing a snapshot", async () => {
    const { looper } = setup(1);
    looper.setPattern(null);
    looper.transportRunning = () => false;
    looper.noteOn({ note: PAD_BASE_NOTE + 8, velocity: 1, time: 0 });
    const state = looper.snapshotForBounce();
    expect((state.data as LooperData).launch).toEqual([8]);
    const buffer = await bounceInstrument((ctx) => new Looper(ctx), state, { bars: 1, bpm: 120, tailSeconds: 0, offlineContext: Ctx });
    expect(measure(buffer).rms).toBeGreaterThan(0.005);
  });
});

describe("loop length", () => {
  it("honours a set bar count and otherwise picks the nearest", () => {
    expect(loopBars(3.9, 2, 0)).toBe(2);
    expect(loopBars(1.9, 2, 0)).toBe(1);
    expect(loopBars(8.1, 2, 0)).toBe(4);
    expect(loopBars(1, 2, 8)).toBe(8);
  });

  it("always returns a usable bar count", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 60, noNaN: true }), fc.double({ min: 0.5, max: 4, noNaN: true }), (seconds, bar) => [1, 2, 4, 8, 16].includes(loopBars(seconds, bar, 0))),
    );
  });
});

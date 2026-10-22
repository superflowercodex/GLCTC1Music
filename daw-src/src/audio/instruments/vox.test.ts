import "fake-indexeddb/auto";
import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bounceInstrument, measure } from "../bounce";
import { newProject } from "../../project/model";
import { projectStore, uiStore } from "../../store/project";
import { Vox, type VoxData } from "./vox";
import { cacheBuffer } from "./voice/assets";
import { micErrorFor } from "./voice/mic";
import { VOX_PARAMS, VOX_PRESETS } from "./voice/voxParams";
import { encodeWav } from "./voice/wav";

type Offline = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
const Ctx = NodeOfflineContext as unknown as Offline;
const SR = 44100;

function setup(seconds: number): { ctx: OfflineAudioContext; vox: Vox } {
  const ctx = new Ctx(2, Math.round(seconds * SR), SR);
  const vox = new Vox(ctx);
  vox.output.connect(ctx.destination);
  return { ctx, vox };
}

function energy(buffer: AudioBuffer, fromSec: number, toSec: number): number {
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = Math.floor(fromSec * SR); i < Math.floor(toSec * SR); i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, (toSec - fromSec) * SR));
}

beforeEach(() => {
  projectStore.set(() => ({ ...newProject(), bpm: 120 }));
  uiStore.set((s) => ({ ...s, toast: null }));
});

afterEach(() => vi.unstubAllGlobals());

describe("Vox presets", () => {
  it("has the 19 vocal types with valid parameters", () => {
    const factory = VOX_PRESETS.filter((p) => p.factory);
    expect(factory).toHaveLength(19);
    expect(new Set(factory.map((p) => p.name)).size).toBe(19);
    const ids = new Set(VOX_PARAMS.map((p) => p.id));
    for (const preset of factory) {
      for (const [id, value] of Object.entries(preset.values)) {
        const def = VOX_PARAMS.find((p) => p.id === id);
        expect(ids.has(id), `${preset.name} uses unknown ${id}`).toBe(true);
        expect(value, `${preset.name}.${id}`).toBeGreaterThanOrEqual(def!.min);
        expect(value, `${preset.name}.${id}`).toBeLessThanOrEqual(def!.max);
      }
    }
  });

  it("applies a vocal type without touching input, keys or choir settings", () => {
    const { vox } = setup(1);
    vox.setParam("inGain", 2);
    vox.setParam("keysTarget", 2);
    vox.setParam("choirVibrato", 0.9);
    vox.loadPreset("vox-robot");
    expect(vox.getParam("vocOn")).toBe(1);
    expect(vox.getParam("voiceLevel")).toBeCloseTo(0.15);
    expect(vox.getParam("inGain")).toBe(2);
    expect(vox.getParam("keysTarget")).toBe(2);
    expect(vox.getParam("choirVibrato")).toBeCloseTo(0.9);
    vox.loadPreset("vox-natural");
    expect(vox.getParam("vocOn")).toBe(0);
  });

  it("saves and restores a user preset, including pads", () => {
    const { vox } = setup(1);
    vox.setParam("pitch", 4);
    vox.setPad(1, { name: "Mine", synth: "kick" });
    const preset = vox.saveUserPreset("My voice");
    vox.setParam("pitch", -3);
    vox.clearPad(1);
    vox.loadPreset(preset.id);
    expect(vox.getParam("pitch")).toBe(4);
    expect(vox.padData[1].synth).toBe("kick");
    vox.deleteUserPreset(preset.id);
  });
});

describe("Vox keys", () => {
  it("plays the synthesized piano and releases it", async () => {
    const { ctx, vox } = setup(3);
    vox.setParam("fxOn", 0);
    vox.noteOn({ note: 60, velocity: 0.9, time: 0, duration: 0.5 });
    const out = await ctx.startRendering();
    expect(energy(out, 0.05, 0.4)).toBeGreaterThan(0.005);
    expect(energy(out, 2.2, 3)).toBeLessThan(0.0005);
  });

  it("sings with the choir when keys are routed there", async () => {
    const { ctx, vox } = setup(3);
    vox.setParam("keysTarget", 2);
    vox.setLyrics("la");
    vox.noteOn({ note: 57, velocity: 0.9, time: 0, duration: 1 });
    const out = await ctx.startRendering();
    expect(energy(out, 0.4, 0.9)).toBeGreaterThan(0.003);
  });

  it("plays a key-mapped sample, re-pitched from its root", async () => {
    const { ctx, vox } = setup(2);
    const sample = ctx.createBuffer(1, SR, SR);
    sample.getChannelData(0).fill(0.4);
    cacheBuffer("smp-key", sample);
    vox.restore({ kind: "vox", values: { keysTarget: 1 }, data: { zones: [{ assetId: "smp-key", name: "Hold", root: 60 }], pads: [], take: [], takeSteps: 16, lyrics: "la" } });
    vox.noteOn({ note: 64, velocity: 1, time: 0, duration: 0.5 });
    const out = await ctx.startRendering();
    expect(energy(out, 0.1, 0.4)).toBeGreaterThan(0.05);
  });

  it("plays pads through hold mode and stops on release", async () => {
    const { ctx, vox } = setup(1.5);
    vox.setParam("fxOn", 0);
    vox.setPad(3, { name: "Open", synth: "openhat", mode: "gate", fadeOut: 0.02 });
    vox.triggerPad(3, 1, 0);
    vox.releasePad(3, 0.05);
    const out = await ctx.startRendering();
    expect(energy(out, 0.0, 0.04)).toBeGreaterThan(0.001);
    expect(energy(out, 0.3, 1.5)).toBeLessThan(1e-4);
  });
});

describe("Vox MIDI take and bounce", () => {
  it("records played notes onto the grid and plays them back on the transport", async () => {
    const { vox } = setup(1);
    let position = 0;
    vox.position = () => position;
    vox.startMidiRecord();
    position = 2.2;
    vox.noteOn({ note: 64, velocity: 0.8 });
    position = 6.1;
    vox.noteOff(64);
    position = 10;
    vox.stopMidiRecord();
    expect(vox.take).toEqual([{ pitch: 64, startStep: 2, lengthSteps: 4, velocity: 0.8 }]);
    expect(vox.takeSteps).toBe(16);
    const { ctx, vox: player } = setup(3);
    player.restore(JSON.parse(JSON.stringify(vox.serialize())));
    for (let step = 0; step < 16; step++) player.onStep(step, step * 0.125, 0.125);
    const out = await ctx.startRendering();
    expect(energy(out, 0, 0.2)).toBeLessThan(1e-4);
    expect(energy(out, 0.3, 0.6)).toBeGreaterThan(0.003);
  });

  it("keeps the take through serialize and restore, and silences it when the pattern is off", async () => {
    const { vox } = setup(1);
    vox.restore({ kind: "vox", values: {}, data: { take: [{ pitch: 60, startStep: 0, lengthSteps: 2, velocity: 1 }], takeSteps: 32, pads: [], zones: [], lyrics: "la" } });
    expect(vox.takeSteps).toBe(32);
    expect((vox.serialize().data as VoxData).take).toHaveLength(1);
    expect(vox.patternCount).toBe(1);
    vox.setPattern(null);
    expect(vox.activePattern).toBeNull();
  });

  it("bounces the take offline through bounceInstrument", async () => {
    const { vox } = setup(1);
    vox.restore({ kind: "vox", values: {}, data: { take: [{ pitch: 60, startStep: 0, lengthSteps: 4, velocity: 1 }], takeSteps: 16, pads: [], zones: [], lyrics: "la" } });
    const buffer = await bounceInstrument((ctx) => new Vox(ctx), vox.serialize(), { bars: 1, bpm: 120, tailSeconds: 1, offlineContext: Ctx });
    expect(measure(buffer).rms).toBeGreaterThan(0.002);
  });
});

describe("Vox persistence", () => {
  it("keeps pads and key maps by asset id across a reload", () => {
    const { ctx, vox } = setup(1);
    const pad = ctx.createBuffer(1, 1000, SR);
    const key = ctx.createBuffer(1, 1000, SR);
    cacheBuffer("smp-pad", pad);
    cacheBuffer("smp-keymap", key);
    vox.restore({
      kind: "vox",
      values: {},
      data: {
        lyrics: "one beat",
        pads: [{ name: "Hey", assetId: "smp-pad", mode: "loop", volume: 0.8 }],
        zones: [{ assetId: "smp-keymap", name: "Low", root: 48 }],
        take: [],
        takeSteps: 16,
      },
    });
    const saved = JSON.parse(JSON.stringify(vox.serialize()));
    const { vox: reloaded } = setup(1);
    reloaded.restore(saved);
    expect(reloaded.padData[0]).toMatchObject({ name: "Hey", assetId: "smp-pad", mode: "loop", volume: 0.8 });
    expect(reloaded.padBuffer(0)).toBe(pad);
    expect(reloaded.zones).toEqual([{ assetId: "smp-keymap", name: "Low", root: 48 }]);
    expect(reloaded.lyrics).toBe("one beat");
  });

  it("repairs damaged saved data", () => {
    const { vox } = setup(1);
    expect(() => vox.restore({ kind: "vox", values: {}, data: { pads: "nope", zones: [{ bad: 1 }], take: [null], takeSteps: -4 } })).not.toThrow();
    expect(vox.zones).toEqual([]);
    expect(vox.takeSteps).toBe(16);
  });
});

describe("Vox input", () => {
  it("explains a denied microphone and leaves the file input usable", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")) } });
    const { vox } = setup(1);
    expect(await vox.startMic()).toBe(false);
    expect(uiStore.get().toast?.text).toMatch(/blocked.*audio file/i);
    expect(vox.micActive).toBe(false);

    const ctx = new Ctx(1, SR, SR);
    const tone = ctx.createBuffer(1, SR, SR);
    tone.getChannelData(0).fill(0.2);
    await vox.loadInputFile(new File([encodeWav(tone)], "take.wav", { type: "audio/wav" }));
    expect(vox.hasFile).toBe(true);
    expect(vox.inputName).toBe("take.wav");
    expect((vox.serialize().data as VoxData).inputAssetId).toBeDefined();
  });

  it("tells the user when there is no microphone at all", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.reject(new DOMException("none", "NotFoundError")) } });
    const { vox } = setup(1);
    await vox.startMic();
    expect(uiStore.get().toast?.text).toMatch(/no microphone/i);
    expect(micErrorFor(new DOMException("busy", "NotReadableError")).message).toMatch(/in use/);
  });

  it("surfaces a file that cannot be decoded", async () => {
    const { vox } = setup(1);
    await vox.loadInputFile(new File([new Uint8Array([1, 2, 3, 4])], "broken.wav"));
    expect(vox.hasFile).toBe(false);
    expect(uiStore.get().toast?.text).toMatch(/broken\.wav/);
  });
});

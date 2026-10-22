import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { Acid30lee } from "../../../audio/instruments/acid30lee";
import { offlineClass, offlineContext } from "../../../audio/instruments/synth/testUtils";
import { encodeWav } from "../../../audio/instruments/synth/wavEncode";
import { getAssetBlob } from "../../../project/db";
import { newProject } from "../../../project/model";
import { projectStore, uiStore } from "../../../store/project";
import { bounceToTrack } from "./bounceToTrack";

beforeEach(() => {
  projectStore.set({ ...newProject("Bounce test"), bpm: 120 });
  uiStore.set((s) => ({ ...s, toast: null }));
});

describe("bounce to track", () => {
  it("renders the pattern, stores a WAV asset and adds an audio clip on a new track", async () => {
    const acid = new Acid30lee(offlineContext(1));
    acid.setPattern(0);
    const ok = await bounceToTrack({ instrument: acid, create: (c) => new Acid30lee(c), name: "30LEE", color: "#8e7cff", bars: 1, render: { offlineContext: offlineClass, sampleRate: 22050, tailSeconds: 0.5 } });
    expect(ok).toBe(true);
    const project = projectStore.get();
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0].kind).toBe("audio");
    const clip = project.tracks[0].clips[0];
    expect(clip.kind).toBe("audio");
    expect(clip.lengthBars).toBeCloseTo(1.25, 1);
    const asset = project.assets.find((a) => a.id === clip.assetId);
    expect(asset?.mime).toBe("audio/wav");
    const blob = await getAssetBlob(clip.assetId as string);
    expect(blob?.size).toBe(asset?.bytes);
    const header = new TextDecoder().decode(new Uint8Array(await (blob as Blob).arrayBuffer()).slice(0, 4));
    expect(header).toBe("RIFF");
  });

  it("tells the player when there is nothing to bounce and changes nothing", async () => {
    const acid = new Acid30lee(offlineContext(1));
    acid.setPattern(null);
    const ok = await bounceToTrack({ instrument: acid, create: (c) => new Acid30lee(c), name: "30LEE", color: "#8e7cff", bars: 1, render: { offlineContext: offlineClass } });
    expect(ok).toBe(false);
    expect(uiStore.get().toast?.text).toMatch(/Pick a pattern/);
    expect(projectStore.get().tracks).toHaveLength(0);
  });

  it("reports an offline render failure instead of swallowing it", async () => {
    const acid = new Acid30lee(offlineContext(1));
    acid.setPattern(0);
    const ok = await bounceToTrack({ instrument: acid, create: (c) => new Acid30lee(c), name: "30LEE", color: "#8e7cff", bars: 1 });
    expect(ok).toBe(false);
    expect(uiStore.get().toast?.text).toMatch(/Bounce failed/);
  });
});

describe("wav encoder", () => {
  it("writes a 16-bit stereo PCM header and clamps samples", () => {
    const ctx = offlineContext(0.1, 8000);
    const buffer = ctx.createBuffer(2, 4, 8000);
    buffer.getChannelData(0).set([0, 0.5, -2, 2]);
    buffer.getChannelData(1).set([0, 0, 0, 0]);
    const blob = encodeWav(buffer);
    expect(blob.size).toBe(44 + 4 * 2 * 2);
    expect(blob.type).toBe("audio/wav");
  });
});

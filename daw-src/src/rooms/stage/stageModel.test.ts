import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { newProject, type Asset, type Clip } from "../../project/model";
import { addStageClip, isActiveAt, mediaTime, planeSize, stageClips, stageOptions, timelineEndBar, updateStageClip } from "./stageModel";

const asset = (over: Partial<Asset>): Asset => ({ id: "a1", kind: "video", name: "loop.mp4", mime: "video/mp4", bytes: 1, addedAt: 0, ...over });

describe("planeSize", () => {
  const aspects = fc.double({ min: 0.2, max: 5, noNaN: true });

  it("fill covers the frame and fit stays inside it, both keeping the picture's shape", () => {
    fc.assert(
      fc.property(aspects, aspects, (media, frame) => {
        const fill = planeSize("fill", media, frame);
        const fit = planeSize("fit", media, frame);
        const eps = 1e-9;
        return (
          fill.w >= frame - eps && fill.h >= 1 - eps && fit.w <= frame + eps && fit.h <= 1 + eps &&
          Math.abs(fill.w / fill.h - media) < 1e-6 && Math.abs(fit.w / fit.h - media) < 1e-6
        );
      }),
    );
  });

  it("stretch always fills the frame exactly", () => {
    expect(planeSize("stretch", 3, 16 / 9)).toEqual({ w: 16 / 9, h: 1 });
  });
});

describe("timing", () => {
  const base = newProject();
  const clip = (over: Partial<Clip> = {}): Clip => ({
    id: "c", kind: "video", name: "c", startBar: 3, lengthBars: 2, assetId: "a", offsetSec: 1, gainDb: 0, pitchSemitones: 0, fineCents: 0,
    warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0, ...over,
  });

  it("is active from its first bar up to but not including its end", () => {
    // 120 BPM, 4/4: a bar is 2 s, so bars 3-4 cover 4 s to 8 s.
    expect(isActiveAt(clip(), 3.99, base.bpm, 4)).toBe(false);
    expect(isActiveAt(clip(), 4, base.bpm, 4)).toBe(true);
    expect(isActiveAt(clip(), 7.99, base.bpm, 4)).toBe(true);
    expect(isActiveAt(clip(), 8, base.bpm, 4)).toBe(false);
  });

  it("maps project time to source time with trim and speed, looping a short video", () => {
    expect(mediaTime(clip(), 5, 120, 4)).toBe(2);
    expect(mediaTime(clip({ stage: { fit: "fill", opacity: 1, speed: 2 } }), 5, 120, 4)).toBe(3);
    fc.assert(
      fc.property(fc.double({ min: 4, max: 8, noNaN: true }), fc.double({ min: 0.5, max: 3, noNaN: true }), (sec, dur) => {
        const t = mediaTime(clip(), sec, 120, 4, dur);
        return t >= 0 && t < dur;
      }),
    );
  });

  it("clamps stage options into range", () => {
    expect(stageOptions(clip({ stage: { fit: "fit", opacity: 4, speed: 99 } }))).toEqual({ fit: "fit", opacity: 1, speed: 4 });
    expect(stageOptions(clip())).toEqual({ fit: "fill", opacity: 1, speed: 1 });
  });
});

describe("stage clips", () => {
  it("creates a video track on first use and reuses it afterwards", () => {
    const first = addStageClip(newProject(), asset({ durationSec: 9 }), 1);
    expect(first.tracks).toHaveLength(1);
    expect(first.tracks[0].kind).toBe("video");
    // 9 s at 120 BPM is 4.5 bars, rounded up so the whole video shows.
    expect(first.tracks[0].clips[0].lengthBars).toBe(5);
    const second = addStageClip(first, asset({ id: "a2", kind: "image", name: "cover.png" }), 6);
    expect(second.tracks).toHaveLength(1);
    expect(stageClips(second).map((c) => c.assetId)).toEqual(["a1", "a2"]);
    expect(timelineEndBar(second)).toBe(10);
  });

  it("refuses audio assets instead of making a silent clip", () => {
    expect(() => addStageClip(newProject(), asset({ kind: "audio" }), 1)).toThrow(RangeError);
  });

  it("updates one clip's options", () => {
    const p = addStageClip(newProject(), asset({}), 1);
    const id = p.tracks[0].clips[0].id;
    const next = updateStageClip(p, id, (c) => ({ ...c, stage: { ...stageOptions(c), opacity: 0.5 } }));
    expect(stageOptions(next.tracks[0].clips[0]).opacity).toBe(0.5);
  });
});

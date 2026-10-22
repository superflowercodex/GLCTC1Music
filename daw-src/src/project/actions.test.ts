import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addClip,
  addTrack,
  ArrangeError,
  barSeconds,
  canSplit,
  clipEndBar,
  copyClips,
  duplicateClips,
  findClip,
  makeClip,
  makeTrack,
  minClipBars,
  moveClip,
  moveClips,
  moveTrack,
  pasteClips,
  removeClips,
  removeTrack,
  renameTrack,
  resizeClip,
  sanitizeClip,
  splitClip,
  trimToBar,
  updateClip,
} from "./actions";
import { newProject, type Clip, type Project } from "./model";

function withAudio(): { project: Project; trackId: string; clipId: string } {
  let project = newProject();
  project = { ...project, assets: [{ id: "a1", kind: "audio", name: "loop", mime: "audio/wav", bytes: 1, durationSec: 20, addedAt: 0 }] };
  const track = makeTrack(project, "audio");
  project = addTrack(project, track);
  const clip = makeClip({ kind: "audio", startBar: 2, lengthBars: 4, assetId: "a1", offsetSec: 1 });
  project = addClip(project, track.id, clip);
  return { project, trackId: track.id, clipId: clip.id };
}

const allClips = (p: Project): Clip[] => p.tracks.flatMap((t) => t.clips);

describe("tracks", () => {
  it("adds, renames, reorders and removes", () => {
    let p = newProject();
    const a = makeTrack(p, "audio");
    p = addTrack(p, a);
    const b = makeTrack(p, "video");
    p = addTrack(p, b);
    expect(p.tracks.map((t) => t.name)).toEqual(["Audio", "Video"]);
    p = moveTrack(p, b.id, 0);
    expect(p.tracks[0].id).toBe(b.id);
    p = renameTrack(p, a.id, "  Vocals ");
    expect(p.tracks.find((t) => t.id === a.id)?.name).toBe("Vocals");
    expect(renameTrack(p, a.id, "   ")).toBe(p);
    p = removeTrack(p, a.id);
    expect(p.tracks).toHaveLength(1);
  });

  it("removing an instrument track removes its slot and song row", () => {
    let p = newProject();
    const t = makeTrack(p, "instrument", { slotId: "s1" });
    p = addTrack(p, t);
    p = {
      ...p,
      instruments: [{ id: "s1", kind: "drum80la8", trackId: t.id, state: { kind: "drum80la8", values: {} } }],
      song: { sections: [], matrix: { s1: [1] } },
    };
    const next = removeTrack(p, t.id);
    expect(next.instruments).toHaveLength(0);
    expect(next.song.matrix.s1).toBeUndefined();
  });

  it("keeps track order stable under any move", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.nat(20), fc.nat(20), (count, from, to) => {
        let p = newProject();
        for (let i = 0; i < count; i++) p = addTrack(p, makeTrack(p, "audio"));
        const id = p.tracks[from % count].id;
        const moved = moveTrack(p, id, to);
        return moved.tracks.length === count && new Set(moved.tracks.map((t) => t.id)).size === count;
      }),
    );
  });
});

describe("clips", () => {
  it("rejects clips on tracks that cannot hold them", () => {
    const p = newProject();
    const t = makeTrack(p, "audio");
    const withTrack = addTrack(p, t);
    expect(() => addClip(withTrack, t.id, makeClip({ kind: "pattern", startBar: 1, lengthBars: 1 }))).toThrow(ArrangeError);
  });

  it("clamps every clip field into range", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        (start, len, gain, fade) => {
          const p = newProject();
          const c = sanitizeClip(
            p,
            makeClip({ kind: "audio", startBar: start, lengthBars: len, gainDb: gain, fadeInSteps: fade, fadeOutSteps: fade }),
          );
          return (
            c.startBar >= 1 &&
            c.lengthBars >= minClipBars(p) &&
            c.gainDb >= -60 &&
            c.gainDb <= 12 &&
            c.fadeInSteps + c.fadeOutSteps <= c.lengthBars * 16 + 1e-9
          );
        },
      ),
    );
  });

  it("never lets a move go before bar 1 and keeps ids unique", () => {
    const { project, clipId } = withAudio();
    const moved = moveClips(project, [clipId], { deltaBars: -50, deltaTracks: 0 });
    expect(findClip(moved, clipId)?.clip.startBar).toBe(1);
  });

  it("moves a clip across tracks only where it fits", () => {
    const { project, clipId } = withAudio();
    const other = makeTrack(project, "audio");
    const inst = makeTrack(project, "instrument");
    const p = addTrack(addTrack(project, other), inst);
    expect(findClip(moveClip(p, clipId, { trackId: other.id }), clipId)?.track.id).toBe(other.id);
    expect(() => moveClip(p, clipId, { trackId: inst.id })).toThrow(ArrangeError);
    const dragged = moveClips(p, [clipId], { deltaBars: 1, deltaTracks: 2 });
    expect(findClip(dragged, clipId)?.track.kind).toBe("audio");
  });

  it("resizing the right edge cannot reveal more source than exists", () => {
    const { project, clipId } = withAudio();
    const grown = resizeClip(project, clipId, "end", 500);
    const clip = findClip(grown, clipId)!.clip;
    expect(clip.lengthBars * barSeconds(project) + clip.offsetSec).toBeLessThanOrEqual(20 + 1e-9);
  });

  it("resizing the left edge shifts the source offset so the audio stays put", () => {
    const { project, clipId } = withAudio();
    const before = findClip(project, clipId)!.clip;
    const after = findClip(resizeClip(project, clipId, "start", 3), clipId)!.clip;
    expect(after.startBar).toBe(3);
    expect(after.offsetSec).toBeCloseTo(before.offsetSec + barSeconds(project), 6);
    expect(clipEndBar(after)).toBeCloseTo(clipEndBar(before), 9);
  });

  it("trims to the playhead only when it is inside the clip", () => {
    const { project, clipId } = withAudio();
    expect(trimToBar(project, clipId, 10)).toBe(project);
    expect(findClip(trimToBar(project, clipId, 4), clipId)?.clip.startBar).toBe(4);
  });

  it("deletes and updates", () => {
    const { project, clipId } = withAudio();
    expect(findClip(updateClip(project, clipId, { gainDb: 99 }), clipId)?.clip.gainDb).toBe(12);
    expect(allClips(removeClips(project, [clipId]))).toHaveLength(0);
  });
});

describe("splitClip", () => {
  it("keeps the total length and every source second", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.integer({ min: 60, max: 200 }), fc.boolean(), (frac, bpm, warp) => {
        const base = withAudio();
        const project: Project = { ...base.project, bpm, assets: base.project.assets.map((a) => ({ ...a, detectedBpm: 100 })) };
        const track = project.tracks[0];
        const seeded: Project = {
          ...project,
          tracks: [{ ...track, clips: track.clips.map((c) => ({ ...c, warp, fadeInSteps: 2, fadeOutSteps: 3 })) }],
        };
        const orig = findClip(seeded, base.clipId)!.clip;
        const at = orig.startBar + orig.lengthBars * frac;
        const { project: out, ids } = splitClip(seeded, base.clipId, at);
        if (!canSplit(seeded, orig, at)) return ids.length === 0;
        const [l, r] = ids.map((id) => findClip(out, id)!.clip);
        const rate = warp ? Math.min(2, Math.max(0.5, bpm / 100)) : 1;
        const lengthKept = Math.abs(l.lengthBars + r.lengthBars - orig.lengthBars) < 1e-9;
        const contiguous = Math.abs(clipEndBar(l) - r.startBar) < 1e-9;
        const sourceKept = Math.abs(r.offsetSec - (l.offsetSec + l.lengthBars * barSeconds(seeded) * rate)) < 1e-6;
        const fadesKept = l.fadeInSteps === orig.fadeInSteps && r.fadeOutSteps === orig.fadeOutSteps && l.fadeOutSteps === 0 && r.fadeInSteps === 0;
        return lengthKept && contiguous && sourceKept && fadesKept && allClips(out).length === 2;
      }),
    );
  });

  it("does nothing too close to either edge", () => {
    const { project, clipId } = withAudio();
    expect(splitClip(project, clipId, 2).ids).toEqual([]);
    expect(splitClip(project, clipId, 6).ids).toEqual([]);
  });

  it("splits midi notes across the cut", () => {
    let p = newProject();
    const t = makeTrack(p, "instrument");
    p = addTrack(p, t);
    const clip = makeClip({
      kind: "midi",
      startBar: 1,
      lengthBars: 2,
      notes: [{ pitch: 60, startStep: 14, lengthSteps: 4, velocity: 0.8 }],
    });
    p = addClip(p, t.id, clip);
    const { project, ids } = splitClip(p, clip.id, 2);
    const [l, r] = ids.map((id) => findClip(project, id)!.clip);
    expect(l.notes).toEqual([{ pitch: 60, startStep: 14, lengthSteps: 2, velocity: 0.8 }]);
    expect(r.notes).toEqual([{ pitch: 60, startStep: 0, lengthSteps: 2, velocity: 0.8 }]);
  });
});

describe("duplicate and paste", () => {
  it("places the copy right after the original with a new id", () => {
    const { project, clipId } = withAudio();
    const { project: out, ids } = duplicateClips(project, [clipId]);
    const copy = findClip(out, ids[0])!.clip;
    expect(copy.startBar).toBe(6);
    expect(copy.id).not.toBe(clipId);
    expect(allClips(out)).toHaveLength(2);
  });

  it("keeps ids unique across repeated duplicates and pastes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (n) => {
        const { project, clipId, trackId } = withAudio();
        let p = project;
        let ids = [clipId];
        for (let i = 0; i < n; i++) {
          const r = duplicateClips(p, ids);
          p = r.project;
          ids = r.ids;
        }
        p = pasteClips(p, copyClips(p, ids), 3, trackId).project;
        const all = allClips(p).map((c) => c.id);
        return new Set(all).size === all.length && all.length === n + 2;
      }),
    );
  });

  it("pastes at the bar and falls back to a matching or new track", () => {
    const { project, clipId, trackId } = withAudio();
    const clipboard = copyClips(project, [clipId]);
    const out = pasteClips(removeTrack(project, trackId), clipboard, 9);
    expect(out.project.tracks).toHaveLength(1);
    expect(findClip(out.project, out.ids[0])?.clip.startBar).toBe(9);
    const again = pasteClips(project, clipboard, 1, trackId);
    expect(findClip(again.project, again.ids[0])?.clip.startBar).toBe(1);
  });
});

import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { addClip, addTrack, copyClips, duplicateClips, findClip, groupTrackShift, makeClip, makeTrack, moveClips, pasteClips } from "../../project/actions";
import { newProject, type Project } from "../../project/model";
import { projectStore, uiStore } from "../../store/project";
import { edgeSpeed } from "./useMarquee";
import { marqueeHits, marqueeSelection, pickTrack, rangeBetween, selectClips, selectionStore, toggleId, tracksFor } from "./selection";

const ids = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 12 });

function seeded(rows: number, starts: number[]): Project {
  let p = newProject("T");
  for (let t = 0; t < rows; t++) {
    const track = makeTrack(p, "instrument", { name: `T${t}` });
    p = addTrack(p, track);
    starts.forEach((s, i) => {
      if (i % rows === t) p = addClip(p, track.id, makeClip({ kind: "pattern", name: `c${i}`, startBar: s, lengthBars: 2, patternIndex: 0 }));
    });
  }
  return p;
}
const all = (p: Project) => p.tracks.flatMap((t) => t.clips);
const bars = fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 9 });

describe("selection reducers", () => {
  it("toggling twice restores the selection", () => {
    fc.assert(fc.property(ids, fc.string({ minLength: 1, maxLength: 4 }), (list, id) => {
      expect(toggleId(toggleId(list, id), id).sort()).toEqual([...list].sort());
    }));
  });

  it("an additive marquee keeps the base and never duplicates", () => {
    fc.assert(
      fc.property(ids, ids, (base, hits) => {
        const out = marqueeSelection(base, hits, true);
        expect(new Set(out).size).toBe(new Set([...base, ...hits]).size);
        for (const b of new Set(base)) expect(out).toContain(b);
        for (const h of hits) expect(out).toContain(h);
      }),
    );
    expect(marqueeSelection(["a"], ["b"], false)).toEqual(["b"]);
  });

  it("marquee hits do not depend on which corner the drag started from", () => {
    const box = fc.record({ left: fc.integer({ min: 0, max: 200 }), top: fc.integer({ min: 0, max: 200 }) }).chain((o) =>
      fc.record({ id: fc.constant("x"), left: fc.constant(o.left), top: fc.constant(o.top), right: fc.integer({ min: o.left + 1, max: 300 }), bottom: fc.integer({ min: o.top + 1, max: 300 }) }),
    );
    fc.assert(
      fc.property(box, fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }), (b, x1, y1, x2, y2) => {
        const fwd = marqueeHits({ left: x1, top: y1, right: x2, bottom: y2 }, [b]);
        const back = marqueeHits({ left: x2, top: y2, right: x1, bottom: y1 }, [b]);
        expect(fwd).toEqual(back);
      }),
    );
  });

  it("a range includes both ends in list order, whichever way it is dragged", () => {
    const order = ["a", "b", "c", "d", "e"];
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, null, "c")).toEqual(["c"]);
    expect(rangeBetween(order, "zz", "c")).toEqual(["c"]);
  });

  it("edge auto-scroll is zero in the middle and bounded at the edges", () => {
    fc.assert(fc.property(fc.integer({ min: -500, max: 1500 }), (pos) => {
      expect(Math.abs(edgeSpeed(pos, 100, 900))).toBeLessThanOrEqual(22);
    }));
    expect(edgeSpeed(500, 100, 900)).toBe(0);
    expect(edgeSpeed(90, 100, 900)).toBeLessThan(0);
    expect(edgeSpeed(950, 100, 900)).toBeGreaterThan(0);
  });
});

describe("selection store", () => {
  beforeEach(() => {
    projectStore.set(seeded(3, [1, 5, 9]));
    selectClips([]);
    selectionStore.set({ ids: [], trackIds: [] });
  });

  it("keeps selectedClipId and selectedClipIds in step", () => {
    const [a, b] = all(projectStore.get());
    selectClips([b.id, a.id]);
    expect(uiStore.get().selectedClipId).toBe(b.id);
    expect(uiStore.get().selectedClipIds).toEqual([b.id, a.id]);
    selectClips([]);
    expect(uiStore.get().selectedClipId).toBeNull();
    expect(uiStore.get().selectedClipIds).toEqual([]);
  });

  it("selects tracks as a range, toggles them, and applies actions to the whole selection", () => {
    const [t0, t1, t2] = projectStore.get().tracks.map((t) => t.id);
    pickTrack(t0, "only");
    pickTrack(t2, "range");
    expect(selectionStore.get().trackIds).toEqual([t0, t1, t2]);
    expect(tracksFor(t1)).toEqual([t0, t1, t2]);
    pickTrack(t1, "toggle");
    expect(selectionStore.get().trackIds).toEqual([t0, t2]);
    expect(tracksFor(t1)).toEqual([t1]);
  });
});

describe("group move", () => {
  it("keeps every clip's offset from the others, never goes before bar 1 and keeps rows apart", () => {
    fc.assert(
      fc.property(bars, fc.integer({ min: 2, max: 4 }), fc.double({ min: -60, max: 60, noNaN: true }), fc.integer({ min: -5, max: 5 }), (starts, rows, db, dt) => {
        const p = seeded(rows, starts);
        const before = all(p);
        const moved = moveClips(p, before.map((c) => c.id), { deltaBars: db, deltaTracks: dt });
        const after = new Map(all(moved).map((c) => [c.id, c]));
        const shift = after.get(before[0].id)!.startBar - before[0].startBar;
        for (const c of before) {
          expect(after.get(c.id)!.startBar).toBeGreaterThanOrEqual(1 - 1e-9);
          expect(after.get(c.id)!.startBar - c.startBar).toBeCloseTo(shift, 6);
        }
        const rowOf = (pr: Project, id: string) => findClip(pr, id)!.trackIndex;
        const dRow = rowOf(moved, before[0].id) - rowOf(p, before[0].id);
        for (const c of before) expect(rowOf(moved, c.id) - rowOf(p, c.id)).toBe(dRow);
        expect(all(moved)).toHaveLength(before.length);
      }),
    );
  });

  it("row shift never pushes the top or bottom clip off the track list", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 6 }), fc.integer({ min: -12, max: 12 }), (idx, d) => {
        const count = Math.max(...idx) + 1 + 2;
        const r = groupTrackShift(idx, d, count);
        expect(Math.min(...idx) + r).toBeGreaterThanOrEqual(0);
        expect(Math.max(...idx) + r).toBeLessThanOrEqual(count - 1);
      }),
    );
  });

  it("a group that cannot land whole on the tracks below stays where it was", () => {
    let p = newProject("T");
    const a = makeTrack(p, "instrument");
    p = addTrack(p, a);
    const v = makeTrack(p, "video");
    p = addTrack(p, v);
    const clip = makeClip({ kind: "pattern", name: "x", startBar: 1, lengthBars: 2, patternIndex: 0 });
    p = addClip(p, a.id, clip);
    expect(findClip(moveClips(p, [clip.id], { deltaBars: 0, deltaTracks: 1 }), clip.id)!.track.id).toBe(a.id);
  });
});

describe("group duplicate and paste", () => {
  it("duplicate lands right after the group, same rows, same spacing, as new ids", () => {
    fc.assert(
      fc.property(bars, fc.integer({ min: 1, max: 3 }), (starts, rows) => {
        const p = seeded(rows, starts);
        const src = all(p);
        const { project, ids: made } = duplicateClips(p, src.map((c) => c.id));
        expect(made).toHaveLength(src.length);
        expect(new Set(all(project).map((c) => c.id)).size).toBe(src.length * 2);
        const first = Math.min(...src.map((c) => c.startBar));
        const last = Math.max(...src.map((c) => c.startBar + c.lengthBars));
        src.forEach((c, i) => {
          const copy = findClip(project, made[i])!;
          expect(copy.clip.startBar - c.startBar).toBeCloseTo(last - first, 6);
          expect(copy.track.id).toBe(findClip(project, c.id)!.track.id);
        });
      }),
    );
  });

  it("paste puts the earliest clip at the playhead and keeps spacing", () => {
    fc.assert(
      fc.property(bars, fc.integer({ min: 1, max: 3 }), fc.double({ min: 1, max: 80, noNaN: true }), (starts, rows, at) => {
        const p = seeded(rows, starts);
        const src = all(p);
        const items = copyClips(p, src.map((c) => c.id));
        const { project, ids: made } = pasteClips(p, items, at);
        const first = Math.min(...src.map((c) => c.startBar));
        src.forEach((c, i) => expect(findClip(project, made[i])!.clip.startBar - at).toBeCloseTo(c.startBar - first, 6));
      }),
    );
  });
});

describe("marquee edges", () => {
  it("boxes that only share an edge are not hit", () => {
    expect(marqueeHits({ left: 0, top: 0, right: 10, bottom: 10 }, [{ id: "a", left: 10, top: 0, right: 20, bottom: 10 }])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { addClip, addTrack, makeClip, makeTrack } from "../../project/actions";
import { newProject, type Project } from "../../project/model";
import { freeDelta, movedOverlap, overlapSpans } from "./overlap";

function lanes(...spans: Array<Array<[number, number]>>): { project: Project; ids: string[][] } {
  let p = newProject();
  const ids: string[][] = [];
  for (const lane of spans) {
    const t = makeTrack(p, "audio");
    p = addTrack(p, t);
    ids.push(
      lane.map(([startBar, lengthBars]) => {
        const c = makeClip({ kind: "audio", name: "c", startBar, lengthBars });
        p = addClip(p, t.id, c);
        return c.id;
      }),
    );
  }
  return { project: p, ids };
}

describe("overlap detection", () => {
  it("finds where clips cover each other and merges touching spans", () => {
    expect(overlapSpans([{ startBar: 1, lengthBars: 4 }, { startBar: 3, lengthBars: 4 }])).toEqual([{ startBar: 3, endBar: 5 }]);
    expect(overlapSpans([{ startBar: 1, lengthBars: 4 }, { startBar: 5, lengthBars: 4 }])).toEqual([]);
    expect(overlapSpans([{ startBar: 1, lengthBars: 8 }, { startBar: 2, lengthBars: 2 }, { startBar: 3, lengthBars: 4 }])).toEqual([{ startBar: 2, endBar: 7 }]);
  });

  it("knows when moved clips cover another clip", () => {
    const { project, ids } = lanes([[1, 4], [3, 4]]);
    expect(movedOverlap(project, new Set([ids[0][1]]))).toBe(true);
  });
});

describe("avoid overlaps", () => {
  it("keeps a shift that lands in free space", () => {
    const { project, ids } = lanes([[1, 4], [9, 4]]);
    expect(freeDelta(project, [ids[0][0]], 2, 0)).toBe(2);
  });

  it("slides to the nearest free spot beside the clip it would cover", () => {
    const { project, ids } = lanes([[1, 4], [9, 4]]);
    // Wanted bar 7 (would cover 9-13): ending at 9 is nearer than starting at 13.
    expect(freeDelta(project, [ids[0][0]], 6, 0)).toBe(4);
    // Wanted bar 12: starting at 13 is nearer.
    expect(freeDelta(project, [ids[0][0]], 11, 0)).toBe(12);
  });

  it("never pushes a clip before bar 1", () => {
    const { project, ids } = lanes([[2, 2], [5, 4]]);
    expect(freeDelta(project, [ids[0][1]], -3, 0)).toBe(-1);
  });

  it("checks the destination track when the drag also changes rows", () => {
    const { project, ids } = lanes([[1, 4]], [[1, 4]]);
    expect(freeDelta(project, [ids[0][0]], 0, 1)).toBe(4);
  });
});

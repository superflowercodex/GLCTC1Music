import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { newProject, type Project, type SongPattern } from "../../project/model";
import {
  applySongToProject,
  cyclePattern,
  energyCurve,
  matrixRowToClips,
  remapMatrix,
  sectionAtBar,
  sectionStarts,
  templateSections,
  TEMPLATES,
  totalBars,
  type TemplateId,
} from "./songModel";

const rowArb = (n: number) => fc.array(fc.integer({ min: 0, max: 4 }), { minLength: n, maxLength: n }) as fc.Arbitrary<SongPattern[]>;

describe("templates", () => {
  it("add up to their advertised length", () => {
    expect(totalBars(templateSections("16"))).toBe(16);
    expect(totalBars(templateSections("32"))).toBe(32);
    expect(totalBars(templateSections("64"))).toBe(64);
    expect(totalBars(templateSections("club"))).toBe(36);
  });

  it("start each section where the previous one ends", () => {
    for (const t of TEMPLATES) {
      const sections = templateSections(t.id);
      const starts = sectionStarts(sections);
      expect(starts[0]).toBe(1);
      for (let i = 1; i < sections.length; i++) expect(starts[i]).toBe(starts[i - 1] + sections[i - 1].bars);
    }
  });

  it("finds the section for every bar and none outside the song", () => {
    const sections = templateSections("club");
    expect(sectionAtBar(sections, 0)).toBe(-1);
    expect(sectionAtBar(sections, 37)).toBe(-1);
    expect(sectionAtBar(sections, 1)).toBe(0);
    expect(sectionAtBar(sections, 5)).toBe(1);
    expect(sectionAtBar(sections, 36)).toBe(sections.length - 1);
  });

  it("rejects an unknown template", () => {
    expect(() => templateSections("7" as TemplateId)).toThrow(RangeError);
  });
});

describe("energy curve", () => {
  it("stays inside 0 to 1 for any length", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 80 }), fc.constantFrom(...TEMPLATES.map((t) => t.id)), (n, id) => {
        const section = templateSections(id)[1];
        return energyCurve(section, n).every((v) => v >= 0 && v <= 1);
      }),
    );
  });
});

describe("cyclePattern", () => {
  it("walks off, A, B, C, D and back, limited by the instrument's patterns", () => {
    let v: SongPattern = 0;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      v = cyclePattern(v, 4);
      seen.push(v);
    }
    expect(seen).toEqual([1, 2, 3, 4, 0]);
    expect(cyclePattern(2, 2)).toBe(0);
    expect(cyclePattern(0, 0)).toBe(0);
  });
});

describe("remapMatrix", () => {
  it("keeps cells by section kind and occurrence and clears what has no counterpart", () => {
    const club = templateSections("club");
    const long = templateSections("64");
    const row: SongPattern[] = [1, 2, 3, 0, 4, 1];
    const next = remapMatrix(club, long, { a: row }, { a: 4 });
    expect(next.a).toHaveLength(long.length);
    expect(next.a[0]).toBe(1);
    expect(next.a[2]).toBe(3);
    expect(next.a[5]).toBe(4);
    expect(next.a[4]).toBe(0);
  });

  it("clears patterns an instrument does not have", () => {
    const club = templateSections("club");
    expect(remapMatrix(club, club, { a: [1, 4, 2, 0, 3, 1] }, { a: 2 }).a).toEqual([1, 0, 2, 0, 0, 1]);
  });
});

describe("matrixRowToClips", () => {
  const sections = templateSections("64");

  it("never overlaps, never covers an off cell and never exceeds the song", () => {
    fc.assert(
      fc.property(rowArb(sections.length), (row) => {
        const clips = matrixRowToClips(sections, row, 0.7);
        const starts = sectionStarts(sections);
        for (let i = 0; i < clips.length; i++) {
          if (i > 0 && clips[i].startBar < clips[i - 1].startBar + clips[i - 1].lengthBars) return false;
        }
        const lastBar = totalBars(sections) + 1;
        if (clips.some((c) => c.startBar < 1 || c.startBar + c.lengthBars > lastBar)) return false;
        return sections.every((_s, i) => {
          const covering = clips.filter((c) => starts[i] >= c.startBar && starts[i] < c.startBar + c.lengthBars);
          if (row[i] === 0) return covering.length === 0;
          return covering.length === 1 && covering[0].patternIndex === row[i] - 1;
        });
      }),
    );
  });

  it("covers exactly the bars of the sections that are on", () => {
    fc.assert(
      fc.property(rowArb(sections.length), (row) => {
        const clips = matrixRowToClips(sections, row, 0.7);
        const covered = clips.reduce((n, c) => n + c.lengthBars, 0);
        const expected = sections.reduce((n, s, i) => n + (row[i] > 0 ? s.bars : 0), 0);
        return covered === expected;
      }),
    );
  });

  it("makes no clips for an all-off row and one clip for a constant row", () => {
    expect(matrixRowToClips(sections, sections.map(() => 0), 0.7)).toEqual([]);
    const one = matrixRowToClips(sections, sections.map(() => 2 as SongPattern), 0.7);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ kind: "pattern", startBar: 1, lengthBars: 64, patternIndex: 1 });
  });
});

describe("applySongToProject", () => {
  function projectWith(row: SongPattern[]): Project {
    const p = newProject();
    p.instruments = [{ id: "s1", kind: "drum80la8", trackId: "t1", state: { kind: "drum80la8", values: {} } }];
    p.tracks = [
      {
        id: "t1", name: "80LA8", kind: "instrument", color: "#79ebff", slotId: "s1", muted: false, solo: false, gainDb: 0, pan: 0,
        sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, automation: [],
        clips: [{ id: "old", kind: "pattern", name: "old", startBar: 1, lengthBars: 1, offsetSec: 0, gainDb: 0, pitchSemitones: 0, fineCents: 0, warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0, patternIndex: 3 },
          { id: "keep", kind: "midi", name: "keep", startBar: 1, lengthBars: 2, offsetSec: 0, gainDb: 0, pitchSemitones: 0, fineCents: 0, warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0 }],
      },
    ];
    p.song = { sections: templateSections("32"), matrix: { s1: row }, levels: { s1: 1 } };
    return p;
  }

  it("replaces the track's pattern clips and keeps other clip kinds", () => {
    const next = applySongToProject(projectWith([1, 1, 2, 0, 2, 0]));
    const clips = next.tracks[0].clips;
    expect(clips.find((c) => c.id === "old")).toBeUndefined();
    expect(clips.find((c) => c.id === "keep")).toBeDefined();
    const patterns = clips.filter((c) => c.kind === "pattern");
    expect(patterns.map((c) => [c.startBar, c.lengthBars, c.patternIndex])).toEqual([
      [1, 8, 0],
      [9, 8, 1],
      [21, 8, 1],
    ]);
  });

  it("is a no-op for tracks the matrix does not cover", () => {
    const p = projectWith([1, 1, 1, 1, 1, 1]);
    p.song = { ...p.song, matrix: {} };
    expect(applySongToProject(p).tracks[0].clips).toEqual(p.tracks[0].clips);
  });
});

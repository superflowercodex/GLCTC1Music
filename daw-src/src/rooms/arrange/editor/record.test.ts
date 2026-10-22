import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { NoteGrid } from "./clipEdits";
import { isBlackKey, KEY_TO_NOTE, noteName, NoteRecorder } from "./record";

describe("NoteRecorder", () => {
  it("snaps start to the grid and never records a zero-length note", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<NoteGrid>(1, 2, 4),
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (grid, start, len) => {
          const r = new NoteRecorder(grid, 32);
          r.noteOn(60, 0.8, start);
          const n = r.noteOff(60, start + len)!;
          expect(n.startStep % grid).toBe(0);
          expect(n.lengthSteps).toBeGreaterThanOrEqual(1);
          expect(n.startStep + n.lengthSteps).toBeLessThanOrEqual(32);
        },
      ),
    );
  });

  it("ignores a release it never saw and a repeated press", () => {
    const r = new NoteRecorder(1, 32);
    expect(r.noteOff(60, 4)).toBeUndefined();
    r.noteOn(60, 0.8, 2);
    r.noteOn(60, 0.5, 3);
    expect(r.noteOff(60, 6)).toMatchObject({ startStep: 2, lengthSteps: 4, velocity: 0.8 });
  });

  it("releases every held key when recording stops", () => {
    const r = new NoteRecorder(2, 32);
    r.noteOn(60, 0.8, 0);
    r.noteOn(64, 0.8, 1);
    expect(r.releaseAll(8).map((n) => n.pitch).sort()).toEqual([60, 64]);
    expect(r.releaseAll(9)).toEqual([]);
  });
});

describe("key layout", () => {
  it("maps fifteen keys from C4 to D5", () => {
    expect(Object.keys(KEY_TO_NOTE)).toHaveLength(15);
    expect(Math.min(...Object.values(KEY_TO_NOTE))).toBe(60);
    expect(Math.max(...Object.values(KEY_TO_NOTE))).toBe(74);
  });

  it("names notes", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(61, false)).toBe("C♯");
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(62)).toBe(false);
  });
});

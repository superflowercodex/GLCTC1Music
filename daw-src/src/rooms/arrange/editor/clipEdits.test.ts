import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Clip, Note } from "../../../project/model";
import {
  addNote,
  barSeconds,
  clipSeconds,
  cutOut,
  duplicate,
  keepSelection,
  moveNote,
  noteAt,
  quantize,
  resizeNote,
  reverse,
  setAssetBpm,
  setFade,
  setMidiLength,
  splitAt,
  trimTo,
  warpRatio,
  type NoteGrid,
  type TimeBase,
} from "./clipEdits";
import { newProject } from "../../../project/model";

const T: TimeBase = { bpm: 120, beatsPerBar: 4 };

function audioClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    kind: "audio",
    name: "Take",
    startBar: 3,
    lengthBars: 4,
    assetId: "a1",
    offsetSec: 1,
    gainDb: 0,
    pitchSemitones: 0,
    fineCents: 0,
    warp: false,
    keyLock: false,
    fadeInSteps: 4,
    fadeOutSteps: 4,
    ...over,
  };
}

const ratioArb = fc.double({ min: 0.5, max: 2, noNaN: true });
const clipArb = fc.record({ reversed: fc.boolean(), lengthBars: fc.integer({ min: 1, max: 16 }), offsetSec: fc.double({ min: 0, max: 5, noNaN: true }) });
const fracArb = fc.double({ min: 0.05, max: 0.95, noNaN: true });

describe("splitAt", () => {
  it("keeps total length and places the halves edge to edge", () => {
    fc.assert(
      fc.property(clipArb, fracArb, ratioArb, (c, frac, ratio) => {
        const clip = audioClip(c);
        const total = clipSeconds(clip, T);
        const parts = splitAt(clip, total * frac, ratio, T);
        expect(parts).toBeDefined();
        const [l, r] = parts!;
        expect(l.lengthBars + r.lengthBars).toBeCloseTo(clip.lengthBars, 9);
        expect(r.startBar).toBeCloseTo(l.startBar + l.lengthBars, 9);
        expect(l.id).not.toBe(r.id);
      }),
    );
  });

  it("continues the source across the cut for a forward clip", () => {
    const clip = audioClip();
    const [l, r] = splitAt(clip, 2, 1, T)!;
    expect(l.offsetSec).toBe(1);
    expect(r.offsetSec).toBeCloseTo(3, 9);
  });

  it("continues the source across the cut for a reversed clip", () => {
    const clip = audioClip({ reversed: true });
    const total = clipSeconds(clip, T);
    const [l, r] = splitAt(clip, 2, 1, T)!;
    // The reversed timeline starts at the end of the source window.
    expect(l.offsetSec).toBeCloseTo(1 + total - 2, 9);
    expect(r.offsetSec).toBeCloseTo(1, 9);
  });

  it("refuses a cut that would leave a sliver", () => {
    expect(splitAt(audioClip(), 0.001, 1, T)).toBeUndefined();
    expect(splitAt(audioClip(), clipSeconds(audioClip(), T), 1, T)).toBeUndefined();
  });

  it("gives fades only to the outer edges", () => {
    const [l, r] = splitAt(audioClip(), 2, 1, T)!;
    expect(l.fadeInSteps).toBe(4);
    expect(l.fadeOutSteps).toBe(0);
    expect(r.fadeInSteps).toBe(0);
    expect(r.fadeOutSteps).toBe(4);
  });
});

describe("cutOut and keepSelection", () => {
  it("removes exactly the selected time", () => {
    fc.assert(
      fc.property(clipArb, fracArb, fracArb, ratioArb, (c, f1, f2, ratio) => {
        const clip = audioClip(c);
        const total = clipSeconds(clip, T);
        const a = Math.min(f1, f2) * total;
        const b = Math.max(f1, f2) * total;
        const pieces = cutOut(clip, a, b, ratio, T);
        if (!pieces) return;
        const kept = pieces.reduce((sum, p) => sum + p.lengthBars, 0);
        expect(kept).toBeCloseTo(clip.lengthBars - (b - a) / barSeconds(T), 6);
        expect(pieces.length).toBeLessThanOrEqual(2);
        if (pieces.length === 2) expect(pieces[1].startBar).toBeCloseTo(pieces[0].startBar + pieces[0].lengthBars, 9);
      }),
    );
  });

  it("keeps only the selection, in place on the timeline", () => {
    fc.assert(
      fc.property(clipArb, fracArb, fracArb, ratioArb, (c, f1, f2, ratio) => {
        const clip = audioClip(c);
        const total = clipSeconds(clip, T);
        const a = Math.min(f1, f2) * total;
        const b = Math.max(f1, f2) * total;
        const kept = keepSelection(clip, a, b, ratio, T);
        if (!kept) return;
        expect(kept.lengthBars).toBeCloseTo((b - a) / barSeconds(T), 9);
        expect(kept.startBar).toBeCloseTo(clip.startBar + a / barSeconds(T), 9);
        expect(kept.id).toBe(clip.id);
      }),
    );
  });

  it("rejects an empty selection", () => {
    expect(keepSelection(audioClip(), 1, 1, 1, T)).toBeUndefined();
    expect(cutOut(audioClip(), 1, 1, 1, T)).toBeUndefined();
  });
});

describe("duplicate, reverse, fades", () => {
  it("places the copy straight after the original with a new id", () => {
    const c = audioClip();
    const d = duplicate(c);
    expect(d.startBar).toBe(c.startBar + c.lengthBars);
    expect(d.id).not.toBe(c.id);
  });

  it("is its own inverse when reversed twice", () => {
    const c = audioClip({ fadeInSteps: 2, fadeOutSteps: 6 });
    expect(reverse(reverse(c))).toEqual({ ...c, reversed: false });
    expect(reverse(c).fadeInSteps).toBe(6);
  });

  it("never lets fades overlap or exceed the clip", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 500 }), (a, b) => {
        const c = setFade(setFade(audioClip({ fadeInSteps: 0, fadeOutSteps: 0 }), "in", a, T), "out", b, T);
        expect(c.fadeInSteps + c.fadeOutSteps).toBeLessThanOrEqual(64);
      }),
    );
  });
});

describe("trimTo", () => {
  it("never reaches outside the source file", () => {
    fc.assert(
      fc.property(clipArb, fc.double({ min: -4, max: 4, noNaN: true }), fc.double({ min: -4, max: 4, noNaN: true }), ratioArb, (c, da, db, ratio) => {
        const clip = audioClip({ ...c, lengthBars: Math.min(c.lengthBars, 2) });
        const total = clipSeconds(clip, T);
        const source = 20;
        const out = trimTo(clip, da, total + db, ratio, source, T);
        const window = clipSeconds(out, T) * ratio;
        expect(out.offsetSec).toBeGreaterThanOrEqual(-1e-9);
        expect(out.offsetSec + window).toBeLessThanOrEqual(source + 1e-6 + Math.max(0, 0.05 * ratio));
        expect(clipSeconds(out, T)).toBeGreaterThanOrEqual(0.05 - 1e-9);
      }),
    );
  });

  it("moves the head forward and the source offset with it", () => {
    const out = trimTo(audioClip(), 1, clipSeconds(audioClip(), T), 1, 30, T);
    expect(out.offsetSec).toBeCloseTo(2, 9);
    expect(out.startBar).toBeCloseTo(3 + 1 / barSeconds(T), 9);
  });
});

describe("warp helpers", () => {
  it("clamps the ratio and ignores unwarped clips", () => {
    expect(warpRatio(audioClip({ warp: false }), 100, 120)).toBe(1);
    expect(warpRatio(audioClip({ warp: true }), undefined, 120)).toBe(1);
    expect(warpRatio(audioClip({ warp: true }), 60, 200)).toBe(2);
    expect(warpRatio(audioClip({ warp: true }), 100, 120)).toBeCloseTo(1.2, 9);
  });

  it("rescales warped clips when the detected tempo is halved", () => {
    const p = newProject();
    p.assets.push({ id: "a1", kind: "audio", name: "x", mime: "audio/wav", bytes: 1, detectedBpm: 100, addedAt: 0 });
    p.tracks.push({
      id: "t1", name: "T", kind: "audio", color: "#fff", muted: false, solo: false, gainDb: 0, pan: 0,
      sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, automation: [],
      clips: [audioClip({ warp: true }), audioClip({ id: "c2", warp: false })],
    });
    const next = setAssetBpm(p, "a1", 50);
    expect(next.assets[0].detectedBpm).toBe(50);
    expect(next.tracks[0].clips[0].lengthBars).toBeCloseTo(2, 9);
    expect(next.tracks[0].clips[1].lengthBars).toBe(4);
  });
});

const noteArb = fc.record({
  pitch: fc.integer({ min: -20, max: 150 }),
  startStep: fc.integer({ min: -5, max: 80 }),
  lengthSteps: fc.integer({ min: -3, max: 80 }),
  velocity: fc.double({ min: -1, max: 2, noNaN: true }),
});
const TOTAL = 32;

function inBounds(n: Note, total = TOTAL): boolean {
  return n.pitch >= 0 && n.pitch <= 127 && n.startStep >= 0 && n.lengthSteps >= 1 && n.startStep + n.lengthSteps <= total && n.velocity > 0 && n.velocity <= 1;
}

describe("notes", () => {
  it("adds, moves and resizes without leaving the clip", () => {
    fc.assert(
      fc.property(noteArb, noteArb, fc.integer({ min: -10, max: 140 }), fc.integer({ min: -10, max: 80 }), fc.integer({ min: -5, max: 80 }), (a, b, pitch, start, len) => {
        let notes = addNote([], a, TOTAL);
        notes = addNote(notes, b, TOTAL);
        notes = moveNote(notes, 0, pitch, start, TOTAL);
        notes = resizeNote(notes, 1, len, TOTAL);
        expect(notes).toHaveLength(2);
        expect(notes.every((n) => inBounds(n))).toBe(true);
      }),
    );
  });

  it("quantize lands on the grid and is idempotent", () => {
    fc.assert(
      fc.property(fc.array(noteArb, { maxLength: 12 }), fc.constantFrom<NoteGrid>(1, 2, 4), (raw, grid) => {
        const notes = raw.map((n) => addNote([], n, TOTAL)[0]);
        const q = quantize(notes, grid, TOTAL);
        expect(q.every((n) => n.startStep % grid === 0 && inBounds(n))).toBe(true);
        expect(quantize(q, grid, TOTAL)).toEqual(q);
      }),
    );
  });

  it("finds the note covering a cell", () => {
    const notes = addNote([], { pitch: 60, startStep: 4, lengthSteps: 3, velocity: 0.8 }, TOTAL);
    expect(noteAt(notes, 60, 6)).toBe(0);
    expect(noteAt(notes, 60, 7)).toBe(-1);
    expect(noteAt(notes, 61, 5)).toBe(-1);
  });

  it("drops notes that no longer fit when the clip shrinks", () => {
    const clip = audioClip({
      kind: "midi",
      lengthBars: 4,
      notes: [
        { pitch: 60, startStep: 0, lengthSteps: 4, velocity: 0.8 },
        { pitch: 62, startStep: 40, lengthSteps: 4, velocity: 0.8 },
        { pitch: 64, startStep: 30, lengthSteps: 8, velocity: 0.8 },
      ],
    });
    const out = setMidiLength(clip, 2, T);
    expect(out.notes).toHaveLength(2);
    expect(out.notes!.every((n) => inBounds(n))).toBe(true);
  });
});

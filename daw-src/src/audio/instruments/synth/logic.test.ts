import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arpPick, arpPool, ARP_MODES, MAX_CHORD_NOTES, type ArpMode, type HeldNote } from "./arp";
import { createRng, hashRandom } from "./rng";
import { degreeOfOffset, DrunkWalk, emptyPattern, euclid, GENERATORS, offsetOfDegree, resolveEvent, type Timeline } from "./patternGen";
import { gridEvents, MAX_RATCHET, ratchetHits } from "./ratchet";
import { noteName, SCALE_INTERVALS, scaleNote, snapToScale } from "./scales";

const scaleIndex = fc.integer({ min: 0, max: SCALE_INTERVALS.length - 1 });

describe("scale mapping", () => {
  it("degree n + scale length is exactly one octave higher", () => {
    fc.assert(
      fc.property(scaleIndex, fc.integer({ min: 24, max: 60 }), fc.integer({ min: -20, max: 40 }), (scale, root, degree) => {
        const len = SCALE_INTERVALS[scale].length;
        return scaleNote(root, scale, degree + len) === scaleNote(root, scale, degree) + 12;
      }),
    );
  });

  it("is strictly increasing in the degree and always lands inside the scale", () => {
    fc.assert(
      fc.property(scaleIndex, fc.integer({ min: 24, max: 60 }), fc.integer({ min: -20, max: 40 }), (scale, root, degree) => {
        const here = scaleNote(root, scale, degree);
        const next = scaleNote(root, scale, degree + 1);
        const pc = (((here - root) % 12) + 12) % 12;
        return next > here && SCALE_INTERVALS[scale].includes(pc);
      }),
    );
  });

  it("snapping is idempotent, stays within a tritone and returns scale notes", () => {
    fc.assert(
      fc.property(scaleIndex, fc.integer({ min: 0, max: 11 }), fc.integer({ min: 20, max: 90 }), (scale, root, note) => {
        const snapped = snapToScale(note, root, scale);
        const pc = (((snapped - root) % 12) + 12) % 12;
        return SCALE_INTERVALS[scale].includes(pc) && snapToScale(snapped, root, scale) === snapped && Math.abs(snapped - note) <= 6;
      }),
    );
  });

  it("degreeOfOffset inverts offsetOfDegree for on-scale rows", () => {
    fc.assert(
      fc.property(scaleIndex, fc.integer({ min: 0, max: 7 }), (scale, degree) => degreeOfOffset(offsetOfDegree(degree, scale), scale) === degree),
    );
  });

  it("names notes", () => {
    expect(noteName(61)).toBe("C♯");
    expect(noteName(69, true)).toBe("A4");
  });
});

describe("arpeggiator ordering", () => {
  const held = fc.uniqueArray(fc.integer({ min: 30, max: 90 }), { minLength: 1, maxLength: 6 }).map((notes): HeldNote[] => notes.map((midi, order) => ({ midi, order })));
  const octaves = fc.integer({ min: 1, max: 4 });
  const mode = fc.constantFrom(...ARP_MODES.map((m) => m.id));

  it("the pool holds every note once per octave, each octave a copy shifted up by twelve", () => {
    fc.assert(
      fc.property(held, octaves, (notes, oct) => {
        const pool = arpPool(notes, "up", oct);
        const n = notes.length;
        const first = pool.slice(0, n);
        const ascending = first.every((v, i) => i === 0 || v > first[i - 1]);
        const shifted = Array.from({ length: oct }, (_, o) => first.map((v) => v + 12 * o)).flat();
        return pool.length === n * oct && ascending && pool.join() === shifted.join();
      }),
    );
  });

  it("up walks ascending and wraps, down is its mirror", () => {
    fc.assert(
      fc.property(held, octaves, (notes, oct) => {
        const pool = arpPool(notes, "up", oct);
        const up = pool.map((_, i) => arpPick(pool, "up", i, 0)[0]);
        const down = pool.map((_, i) => arpPick(pool, "down", i, 0)[0]);
        return up.join() === pool.join() && down.join() === [...pool].reverse().join() && arpPick(pool, "up", pool.length, 0)[0] === pool[0];
      }),
    );
  });

  it("up-and-down climbs to the top, comes back down and does not repeat the ends", () => {
    fc.assert(
      fc.property(held.filter((h) => h.length >= 3), (notes) => {
        const pool = arpPool(notes, "updown", 1);
        const n = pool.length;
        const cycle = 2 * n - 2;
        const seq = Array.from({ length: cycle }, (_, i) => arpPick(pool, "updown", i, 0)[0]);
        const up = seq.slice(0, n);
        const down = seq.slice(n - 1).concat(seq[0]);
        const ascending = up.every((v, i) => i === 0 || v > up[i - 1]);
        const descending = down.every((v, i) => i === 0 || v < down[i - 1] || i === down.length - 1);
        return ascending && descending && seq[n - 1] === pool[n - 1] && seq.filter((v) => v === pool[0]).length === 1;
      }),
    );
  });

  it("every pick comes from the pool, chords are capped, as-played keeps press order", () => {
    fc.assert(
      fc.property(held, octaves, mode, fc.integer({ min: 0, max: 200 }), fc.double({ min: 0, max: 0.999999, noNaN: true }), (notes, oct, m: ArpMode, index, rand) => {
        const pool = arpPool(notes, m, oct);
        const picked = arpPick(pool, m, index, rand);
        return picked.length >= 1 && picked.length <= MAX_CHORD_NOTES && picked.every((n) => pool.includes(n));
      }),
    );
    const order: HeldNote[] = [
      { midi: 67, order: 0 },
      { midi: 60, order: 1 },
      { midi: 64, order: 2 },
    ];
    expect(arpPool(order, "played", 1)).toEqual([67, 60, 64]);
  });

  it("an empty hand plays nothing", () => {
    expect(arpPool([], "up", 3)).toEqual([]);
    expect(arpPick([], "up", 4, 0.5)).toEqual([]);
  });
});

describe("ratchet and grid timing", () => {
  it("hits are evenly spaced, ordered and inside the step", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0.02, max: 1, noNaN: true }), fc.integer({ min: 1, max: 12 }), fc.double({ min: 0.1, max: 1.2, noNaN: true }), (t, period, count, gate) => {
        const hits = ratchetHits(t, period, count, gate);
        const n = Math.min(MAX_RATCHET, count);
        const slot = period / n;
        return (
          hits.length === n &&
          hits[0].time === t &&
          hits.every((h, i) => Math.abs(h.time - (t + i * slot)) < 1e-9 && h.time < t + period && h.dur > 0 && h.dur <= Math.max(0.012, slot * 1.05) + 1e-9)
        );
      }),
    );
  });

  it("grid events cover each event exactly once across consecutive steps", () => {
    fc.assert(
      fc.property(fc.constantFrom(0.5, 1, 2, 4 / 3, 2 / 3, 4), fc.integer({ min: 0, max: 64 }), (period, steps) => {
        const seen: number[] = [];
        for (let s = 0; s < steps; s++) for (const e of gridEvents(s, period)) seen.push(e.index);
        const unique = new Set(seen);
        return unique.size === seen.length && seen.every((v, i) => v === i);
      }),
    );
  });

  it("event offsets stay inside their step", () => {
    fc.assert(
      fc.property(fc.constantFrom(0.5, 1, 2, 4 / 3, 2 / 3), fc.integer({ min: 0, max: 100 }), (period, step) => gridEvents(step, period).every((e) => e.offset >= 0 && e.offset < 1)),
    );
  });
});

describe("randomness", () => {
  it("hashRandom is stateless, bounded and seed-sensitive", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.integer(), (seed, a, b) => {
        const v = hashRandom(seed, a, b);
        return v >= 0 && v < 1 && v === hashRandom(seed, a, b);
      }),
    );
    const sample = (seed: number) => Array.from({ length: 50 }, (_, i) => hashRandom(seed, i));
    expect(sample(1)).not.toEqual(sample(2));
    const mean = sample(3).reduce((a, b) => a + b, 0) / 50;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(0.7);
  });

  it("createRng repeats for one seed", () => {
    const a = createRng(5);
    const b = createRng(5);
    expect(Array.from({ length: 10 }, a)).toEqual(Array.from({ length: 10 }, b));
  });
});

describe("pattern generation and timeline", () => {
  it("euclid places exactly the requested hits", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 32 }), fc.integer({ min: 1, max: 32 }), fc.integer({ min: 0, max: 31 }), (len, hits, rotation) => {
        const h = Math.min(hits, len);
        return euclid(len, h, rotation).filter(Boolean).length === h;
      }),
    );
  });

  it("generators only turn on steps inside the pattern length", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.keys(GENERATORS)), fc.constantFrom(4, 8, 16, 32), scaleIndex, (name, len, scale) => {
        const p = emptyPattern();
        p.len = len;
        GENERATORS[name](p, scale, () => 0.37);
        return p.steps.every((s, i) => i < len || !s.on);
      }),
    );
  });

  it("a song chain plays each bank for its own length, in order, and loops", () => {
    const patterns = Array.from({ length: 8 }, (_, i) => ({ ...emptyPattern(), len: [4, 8, 16, 32][i % 4] }));
    const timeline: Timeline = { patterns, active: 0, chain: [2, 1, 2], chainOn: true, direction: 0, seed: 1 };
    const drunk = new DrunkWalk();
    const lens = [16, 8, 16];
    const order = [2, 1, 2];
    const seq: number[] = [];
    for (let n = 0; n < 40; n++) seq.push(resolveEvent(n, timeline, drunk).bank);
    const expected = order.flatMap((b, i) => Array(lens[i]).fill(b));
    expect(seq).toEqual(Array.from({ length: 40 }, (_, n) => expected[n % expected.length]));
  });

  it("directions stay inside the pattern and forward is the identity cycle", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), fc.constantFrom(4, 8, 16, 32), fc.integer({ min: 0, max: 300 }), (direction, len, n) => {
        const patterns = [{ ...emptyPattern(), len }];
        const t: Timeline = { patterns, active: 0, chain: [], chainOn: false, direction, seed: 9 };
        const pos = resolveEvent(n, t, new DrunkWalk()).pos;
        return pos >= 0 && pos < len && (direction !== 0 || pos === n % len);
      }),
    );
  });
});

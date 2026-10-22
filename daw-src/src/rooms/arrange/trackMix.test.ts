import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FADER_MAX_DB, FADER_MIN_DB } from "../../audio/mixMath";
import { addTrack, makeTrack, setTrackMix } from "../../project/actions";
import { newProject } from "../../project/model";
import { thumbGeometry } from "./HScrollBar";
import { formatGain, formatPanShort, gainToPos, nudgeGain, panToPos, posToGain, posToPan } from "./trackMix";

describe("track header volume and pan", () => {
  it("maps slider position to the same gain the Mixer fader stores, unity at 80%", () => {
    expect(posToGain(0)).toBe(FADER_MIN_DB);
    expect(posToGain(1)).toBe(FADER_MAX_DB);
    expect(posToGain(0.8)).toBe(0);
    expect(gainToPos(0)).toBeCloseTo(0.8);
  });

  it("round-trips gain through the slider within 0.1 dB (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: -59.5, max: 6, noNaN: true }), (db) => {
        expect(Math.abs(posToGain(gainToPos(db)) - db)).toBeLessThanOrEqual(0.1);
      }),
    );
  });

  it("is monotonic, so dragging right never lowers the level (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        expect(posToGain(lo)).toBeLessThanOrEqual(posToGain(hi));
      }),
    );
  });

  it("steps by 0.5 dB, 0.1 with Shift, and climbs out of silence audibly", () => {
    expect(nudgeGain(0, 1, false)).toBe(0.5);
    expect(nudgeGain(0, -1, true)).toBe(-0.1);
    expect(nudgeGain(FADER_MAX_DB, 1, false)).toBe(FADER_MAX_DB);
    expect(nudgeGain(FADER_MIN_DB, 1, false)).toBeGreaterThan(-50);
  });

  it("centres pan inside the detent while dragging", () => {
    expect(posToPan(0.51)).toBe(0);
    expect(posToPan(0.51, false)).toBe(0.02);
    expect(posToPan(0)).toBe(-1);
    expect(panToPos(1)).toBe(1);
  });

  it("formats readouts", () => {
    expect(formatGain(-6)).toBe("−6.0 dB");
    expect(formatGain(FADER_MIN_DB)).toBe("−∞ dB");
    expect(formatPanShort(-0.33)).toBe("L33");
    expect(formatPanShort(0)).toBe("C");
    expect(formatPanShort(0.5)).toBe("R50");
  });

  it("writes Track.gainDb and Track.pan clamped to the fader's range", () => {
    let p = newProject();
    const t = makeTrack(p, "audio");
    p = addTrack(p, t);
    const next = setTrackMix(p, t.id, { gainDb: 20, pan: -3 });
    expect(next.tracks[0].gainDb).toBe(FADER_MAX_DB);
    expect(next.tracks[0].pan).toBe(-1);
    expect(setTrackMix(next, t.id, { gainDb: FADER_MAX_DB })).toBe(next);
  });
});

describe("timeline scrollbar", () => {
  it("has no thumb when everything fits", () => {
    expect(thumbGeometry(0, 800, 800)).toBeNull();
  });

  it("sizes and places the thumb from the scroll position", () => {
    expect(thumbGeometry(0, 500, 1000)).toEqual({ size: 0.5, start: 0 });
    expect(thumbGeometry(500, 500, 1000)).toEqual({ size: 0.5, start: 0.5 });
    expect(thumbGeometry(0, 10, 10000)?.size).toBe(0.06);
  });
});

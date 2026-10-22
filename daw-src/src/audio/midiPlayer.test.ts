import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { newProject, type Clip, type Note, type Project, type Track } from "../project/model";
import { scheduleMidiClips } from "./midiPlayer";
import type { Instrument, NoteEvent } from "./types";

class FakeInstrument {
  calls: NoteEvent[] = [];
  offs = 0;
  ctx = { currentTime: 0 };
  noteOn(e: NoteEvent): void {
    this.calls.push(e);
  }
  allNotesOff(): void {
    this.offs++;
  }
}

function midiClip(over: Partial<Clip>, notes: Note[]): Clip {
  return {
    id: "c", kind: "midi", name: "m", startBar: 1, lengthBars: 2, offsetSec: 0, gainDb: 0, pitchSemitones: 0, fineCents: 0,
    warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0, notes, ...over,
  };
}

function setup(clips: Clip[], bpm = 120): { project: Project; inst: FakeInstrument; as: (id: string) => Instrument | undefined } {
  const project = newProject();
  project.bpm = bpm;
  const track: Track = {
    id: "t", name: "T", kind: "instrument", color: "#fff", slotId: "s", muted: false, solo: false, gainDb: 0, pan: 0,
    sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, automation: [], clips,
  };
  project.tracks.push(track);
  const inst = new FakeInstrument();
  return { project, inst, as: (id) => (id === "s" ? (inst as unknown as Instrument) : undefined) };
}

const n = (pitch: number, startStep: number, lengthSteps = 2, velocity = 0.8): Note => ({ pitch, startStep, lengthSteps, velocity });

describe("scheduleMidiClips", () => {
  it("plays notes at audio times derived from bpm and the clip's start bar", () => {
    // 120 bpm: a step is 0.125 s and a bar is 2 s.
    const { project, inst, as } = setup([midiClip({ startBar: 2 }, [n(60, 0), n(64, 4, 3, 0.5)])]);
    scheduleMidiClips(project, { instrumentFor: as, fromSec: 0, atTime: 10, lookaheadSec: Infinity });
    expect(inst.calls).toEqual([
      { note: 60, velocity: 0.8, time: 12, duration: 0.25 },
      { note: 64, velocity: 0.5, time: 12.5, duration: 0.375 },
    ]);
  });

  it("starts part-way through and skips notes already behind", () => {
    const { project, inst, as } = setup([midiClip({}, [n(60, 0), n(62, 8), n(64, 16)])]);
    scheduleMidiClips(project, { instrumentFor: as, fromSec: 1, atTime: 5, lookaheadSec: Infinity });
    expect(inst.calls.map((c) => [c.note, c.time])).toEqual([[62, 5], [64, 6]]);
  });

  it("ignores notes beyond the clip end and shortens ones that cross it", () => {
    const { project, inst, as } = setup([midiClip({ lengthBars: 1 }, [n(60, 14, 8), n(62, 16)])]);
    scheduleMidiClips(project, { instrumentFor: as, fromSec: 0, atTime: 0, lookaheadSec: Infinity });
    expect(inst.calls).toHaveLength(1);
    expect(inst.calls[0].duration).toBeCloseTo(0.25, 9);
  });

  it("follows the project tempo", () => {
    const { project, inst, as } = setup([midiClip({}, [n(60, 4)])], 60);
    scheduleMidiClips(project, { instrumentFor: as, fromSec: 0, atTime: 0, lookaheadSec: Infinity });
    expect(inst.calls[0].time).toBeCloseTo(1, 9);
  });

  it("skips muted tracks, other clip kinds and tracks without an instrument", () => {
    const { project, inst, as } = setup([midiClip({}, [n(60, 0)]), midiClip({ kind: "audio" }, [n(61, 0)])]);
    project.tracks[0].muted = true;
    scheduleMidiClips(project, { instrumentFor: as, fromSec: 0, atTime: 0, lookaheadSec: Infinity });
    expect(inst.calls).toHaveLength(0);
    project.tracks[0].muted = false;
    scheduleMidiClips(project, { instrumentFor: () => undefined, fromSec: 0, atTime: 0, lookaheadSec: Infinity });
    expect(inst.calls).toHaveLength(0);
  });

  it("only hands over notes inside the lookahead and releases the rest as time passes", () => {
    const { project, inst, as } = setup([midiClip({}, [n(60, 0), n(62, 16), n(64, 32)])]);
    const handle = scheduleMidiClips(project, { instrumentFor: as, fromSec: 0, atTime: 0, lookaheadSec: 1.5 });
    expect(inst.calls.map((c) => c.note)).toEqual([60]);
    handle.stop();
  });

  it("stop() cancels what is pending and silences the instrument", () => {
    const { project, inst, as } = setup([midiClip({}, [n(60, 0), n(62, 16)])]);
    const handle = scheduleMidiClips(project, { instrumentFor: as, fromSec: 0, atTime: 0, lookaheadSec: 0.5 });
    handle.stop();
    handle.stop();
    expect(inst.offs).toBe(1);
    expect(inst.calls.map((c) => c.note)).toEqual([60]);
  });

  it("repeats the loop region", () => {
    const { project, inst, as } = setup([midiClip({ lengthBars: 4 }, [n(60, 0), n(62, 8), n(64, 24)])]);
    project.loop = { on: true, startBar: 1, endBar: 2 };
    const handle = scheduleMidiClips(project, { instrumentFor: as, fromSec: 0, atTime: 0, lookaheadSec: 5 });
    // One bar is 2 s: notes at steps 0 and 8 repeat every 2 s, the note at step 24 is outside the loop.
    const times = inst.calls.map((c) => [c.note, c.time]);
    expect(times).toEqual([[60, 0], [62, 1], [60, 2], [62, 3], [60, 4]]);
    expect(inst.calls.some((c) => c.note === 64)).toBe(false);
    handle.stop();
  });

  it("never schedules a note before it exists in the clip, for any start offset", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 4, noNaN: true }), (from) => {
        const { project, inst, as } = setup([midiClip({}, [n(60, 0), n(62, 8), n(64, 16), n(65, 24)])]);
        scheduleMidiClips(project, { instrumentFor: as, fromSec: from, atTime: 100, lookaheadSec: Infinity });
        for (const c of inst.calls) expect(c.time!).toBeGreaterThanOrEqual(100 - 1e-9);
      }),
    );
  });
});

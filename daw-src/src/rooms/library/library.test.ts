import { describe, expect, it } from "vitest";
import { newProject, type Asset, type Track } from "../../project/model";
import { clipsUsingAsset, isMidiFile, planMidiClip } from "./media";
import { MidiFileError, parseStandardMidiFile } from "./smf";

describe("isMidiFile", () => {
  it("finds MIDI by type or extension and nothing else", () => {
    expect(isMidiFile({ name: "riff.MID", type: "" })).toBe(true);
    expect(isMidiFile({ name: "x.bin", type: "audio/midi" })).toBe(true);
    expect(isMidiFile({ name: "song.wav", type: "audio/wav" })).toBe(false);
  });
});

const midiAsset: Asset = { id: "m", kind: "midi", name: "acid", mime: "audio/midi", bytes: 1, addedAt: 0 };
const baseTrack = (id: string, kind: Track["kind"]): Track => ({ id, name: id, kind, color: "#fff", muted: false, solo: false, gainDb: 0, pan: 0, sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, clips: [], automation: [] });
const parsed = { bpm: 130, bars: 2, notes: [{ pitch: 60, startStep: 0, lengthSteps: 4, velocity: 0.8 }] };

describe("planMidiClip", () => {
  it("puts the notes on the selected instrument track, else the first, else a new one", () => {
    const p = { ...newProject(), tracks: [baseTrack("a", "audio"), baseTrack("i1", "instrument"), baseTrack("i2", "instrument")] };
    const selected = planMidiClip(p, midiAsset, parsed, "i2", 3);
    expect(selected.project.tracks.find((t) => t.id === "i2")?.clips[0]).toMatchObject({ kind: "midi", startBar: 3, lengthBars: 2, notes: parsed.notes });
    expect(planMidiClip(p, midiAsset, parsed, "a", 1).project.tracks.find((t) => t.id === "i1")?.clips).toHaveLength(1);
    const fresh = planMidiClip(newProject(), midiAsset, parsed, null, 1);
    expect(fresh.project.tracks).toHaveLength(1);
    expect(fresh.project.tracks[0]).toMatchObject({ kind: "instrument", name: "MIDI" });
    expect(fresh.project.tracks[0]?.clips[0]?.id).toBe(fresh.clipId);
  });
});

describe("clipsUsingAsset", () => {
  it("counts the clips that play an asset", () => {
    const t = baseTrack("a", "audio");
    t.clips.push({ id: "c1", kind: "audio", name: "", startBar: 1, lengthBars: 1, assetId: "a", offsetSec: 0, gainDb: 0, pitchSemitones: 0, fineCents: 0, warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0 });
    expect(clipsUsingAsset({ ...newProject(), tracks: [t] }, "a")).toBe(1);
    expect(clipsUsingAsset({ ...newProject(), tracks: [t] }, "b")).toBe(0);
  });
});

function smf(events: number[], ppq = 480, tempo?: number): Uint8Array {
  const track = [...(tempo ? [0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] : []), ...events, 0, 0xff, 0x2f, 0];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255];
  const len = track.length;
  return new Uint8Array([...header, 0x4d, 0x54, 0x72, 0x6b, 0, 0, len >> 8, len & 255, ...track]);
}

describe("parseStandardMidiFile", () => {
  it("reads tempo, notes and length in bars", () => {
    // 120 BPM (500000 us). Note 60 on at tick 0 for one beat (480), note 64 on after, running status for the off.
    const bytes = smf([0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0, 0x90, 64, 80, 0x83, 0x60, 0x90, 64, 0], 480, 500000);
    const parsed = parseStandardMidiFile(bytes, 4);
    expect(parsed.bpm).toBe(120);
    expect(parsed.notes).toEqual([
      { pitch: 60, startStep: 0, lengthSteps: 4, velocity: 100 / 127 },
      { pitch: 64, startStep: 4, lengthSteps: 4, velocity: 80 / 127 },
    ]);
    expect(parsed.bars).toBe(1);
  });

  it("rejects things that are not MIDI files, with a reason", () => {
    expect(() => parseStandardMidiFile(new Uint8Array([1, 2, 3, 4]))).toThrow(MidiFileError);
    expect(() => parseStandardMidiFile(new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x80, 0x19]))).toThrow(/timecode/);
    expect(() => parseStandardMidiFile(new Uint8Array([0x4d, 0x54, 0x68, 0x64]))).toThrow(/ends unexpectedly/);
  });
});

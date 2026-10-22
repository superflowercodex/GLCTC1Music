import { describe, expect, it } from "vitest";
import { makeClip, makeTrack } from "../project/actions";
import { newProject, type Project } from "../project/model";
import { formatBytes, formatDuration, formatRenderTime, mixdownOptionsFor, summarizeExport, type ExportChoices } from "./exportModel";

const choices: ExportChoices = { what: "song", source: "arrangement", instrumentsAndLimiter: true, metronome: false, bitDepth: 16 };

function projectWith(bars: number, bpm = 120): Project {
  const base = { ...newProject("p"), bpm };
  const track = makeTrack(base, "audio");
  track.clips = [makeClip({ kind: "audio", startBar: 1, lengthBars: bars, assetId: "a" })];
  return { ...base, tracks: [track] };
}

describe("summarizeExport", () => {
  it("reports length, size and render time for a normal project", () => {
    const s = summarizeExport(projectWith(8), choices);
    expect(s.ok).toBe(true);
    expect(s.seconds).toBeCloseTo(16, 6);
    expect(s.bytesPerFile).toBe(44 + Math.ceil(18 * 44100) * 2 * 2);
    expect(s.long).toBe(false);
    expect(s.files).toBe(1);
  });

  it("24-bit files are half again as large", () => {
    const a = summarizeExport(projectWith(8), choices).bytesPerFile;
    const b = summarizeExport(projectWith(8), { ...choices, bitDepth: 24 }).bytesPerFile;
    expect(b / a).toBeCloseTo(1.5, 2);
  });

  it("flags projects over ten minutes", () => {
    expect(summarizeExport(projectWith(310), choices).long).toBe(true);
    expect(summarizeExport(projectWith(290), choices).long).toBe(false);
  });

  it("explains an empty project instead of throwing", () => {
    const s = summarizeExport(newProject(), choices);
    expect(s.ok).toBe(false);
    expect(s.error).toMatch(/nothing to export/i);
  });

  it("counts one file per unmuted track for stems", () => {
    const p = projectWith(4);
    const second = makeTrack(p, "audio", { muted: true });
    const third = makeTrack(p, "audio");
    expect(summarizeExport({ ...p, tracks: [...p.tracks, second, third] }, { ...choices, what: "tracks" }).files).toBe(2);
  });
});

describe("options and formatting", () => {
  it("maps the switches onto the mixdown", () => {
    expect(mixdownOptionsFor({ ...choices, what: "loop", instrumentsAndLimiter: false, metronome: true })).toMatchObject({
      range: { kind: "loop" },
      includeInstruments: false,
      masterLimiter: false,
      metronome: true,
    });
  });

  it("formats", () => {
    expect(formatDuration(166)).toBe("2:46");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatBytes(29 * 1024 * 1024)).toBe("29.0 MB");
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatRenderTime(12)).toBe("~12 s");
    expect(formatRenderTime(300)).toBe("~5 min");
  });
});

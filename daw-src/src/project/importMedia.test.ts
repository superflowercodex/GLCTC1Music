import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classifyFile } from "./importMedia";

describe("classifyFile", () => {
  it("trusts the MIME type and falls back to the extension", () => {
    expect(classifyFile("take.bin", "audio/wav")).toBe("audio");
    expect(classifyFile("take.WAV", "")).toBe("audio");
    expect(classifyFile("clip.mov", "")).toBe("video");
    expect(classifyFile("cover.png", "")).toBe("image");
    expect(classifyFile("song.mid", "")).toBe("midi");
    expect(classifyFile("song.mid", "audio/midi")).toBe("midi");
    expect(classifyFile("x.bin", "audio/x-midi")).toBe("midi");
    expect(classifyFile("notes.txt", "text/plain")).toBeNull();
  });

  it("always answers with a known kind or null", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (name, mime) => [null, "audio", "video", "image", "midi"].includes(classifyFile(name, mime))));
  });
});

import { describe, expect, it } from "vitest";
import { parseMidiMessage } from "./midiInput";

describe("parseMidiMessage", () => {
  it("reads note on, note off and the zero-velocity note on that keyboards send as off", () => {
    expect(parseMidiMessage([0x90, 60, 127])).toEqual({ kind: "on", pitch: 60, velocity: 1 });
    expect(parseMidiMessage([0x93, 62, 0])).toEqual({ kind: "off", pitch: 62 });
    expect(parseMidiMessage([0x80, 64, 40])).toEqual({ kind: "off", pitch: 64 });
  });

  it("reads all-notes-off and ignores the rest", () => {
    expect(parseMidiMessage([0xb0, 123, 0])).toEqual({ kind: "allOff" });
    expect(parseMidiMessage([0xb0, 7, 90])).toBeUndefined();
    expect(parseMidiMessage([0xe0, 0, 64])).toBeUndefined();
    expect(parseMidiMessage([0x90])).toBeUndefined();
  });
});

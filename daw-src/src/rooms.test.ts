import { describe, expect, it } from "vitest";
import { ROOMS, roomFromHash } from "./rooms";

describe("roomFromHash", () => {
  it("opens Arrange when the hash is empty or unknown", () => {
    expect(roomFromHash("")).toBe("arrange");
    expect(roomFromHash("#/nowhere")).toBe("arrange");
  });

  it("finds every room with or without the slash", () => {
    for (const room of ROOMS) {
      expect(roomFromHash(`#/${room.id}`)).toBe(room.id);
      expect(roomFromHash(`#${room.id}`)).toBe(room.id);
    }
  });

  it("ignores sub-paths when picking the room", () => {
    expect(roomFromHash("#/play/galactic-one")).toBe("play");
  });
});

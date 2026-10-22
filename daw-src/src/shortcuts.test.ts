import { describe, expect, it } from "vitest";
import { halveOrDouble, isEditable, routeShortcut, type KeyLike } from "./shortcuts";

const el = (tagName: string, extra: Record<string, unknown> = {}): EventTarget => ({ tagName, isContentEditable: false, getAttribute: () => null, ...extra }) as unknown as EventTarget;
const press = (key: string, mods: Partial<KeyLike> = {}, target: EventTarget | null = el("BODY")): KeyLike => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  target,
  ...mods,
});
const none = { sheet: null } as const;

describe("playback keys", () => {
  it("routes the transport keys", () => {
    expect(routeShortcut(press(" "), none)).toBe("play-pause");
    expect(routeShortcut(press("Enter"), none)).toBe("rewind");
    expect(routeShortcut(press("l"), none)).toBe("loop");
    expect(routeShortcut(press("L"), none)).toBe("loop");
    expect(routeShortcut(press("r"), none)).toBe("record");
    expect(routeShortcut(press("t"), none)).toBe("tap-tempo");
    expect(routeShortcut(press("T", { shiftKey: true }), none)).toBe("tempo-halve-double");
    expect(routeShortcut(press("m"), none)).toBe("metronome");
  });

  it("does nothing for other keys and for held keys", () => {
    expect(routeShortcut(press("q"), none)).toBeNull();
    expect(routeShortcut(press(" ", { repeat: true }), none)).toBeNull();
    expect(routeShortcut(press("l", { repeat: true }), none)).toBeNull();
  });

  it("does not steal Space or Enter from a focused button, link or switch", () => {
    expect(routeShortcut(press(" ", {}, el("BUTTON")), none)).toBeNull();
    expect(routeShortcut(press("Enter", {}, el("A")), none)).toBeNull();
    expect(routeShortcut(press(" ", {}, el("DIV", { getAttribute: () => "switch" })), none)).toBeNull();
    expect(routeShortcut(press(" ", {}, el("DIV", { getAttribute: () => "slider" })), none)).toBe("play-pause");
    expect(routeShortcut(press(" ", {}, el("INPUT", { type: "range" })), none)).toBe("play-pause");
  });
});

describe("player dock", () => {
  it("minimises with Cmd or Ctrl and a period, and never with a plain letter the keyboard plays", () => {
    expect(routeShortcut(press(".", { metaKey: true }), none)).toBe("player-dock");
    expect(routeShortcut(press(".", { ctrlKey: true }), none)).toBe("player-dock");
    expect(routeShortcut(press("f", { metaKey: true, shiftKey: true }), none)).toBe("fullscreen");
    expect(routeShortcut(press("F", { ctrlKey: true, shiftKey: true }), none)).toBe("fullscreen");
    expect(routeShortcut(press("."), none)).toBeNull();
    expect(routeShortcut(press("p"), none)).toBeNull();
  });
});

describe("typing", () => {
  const inputs = [el("INPUT", { type: "text" }), el("INPUT", { type: "number" }), el("INPUT"), el("TEXTAREA"), el("SELECT"), el("DIV", { isContentEditable: true })];

  it("ignores every plain key inside text fields, selects and contenteditable", () => {
    for (const target of inputs) {
      expect(isEditable(target)).toBe(true);
      for (const key of [" ", "Enter", "l", "r", "t", "m"]) expect(routeShortcut(press(key, {}, target), none)).toBeNull();
    }
  });

  it("leaves undo and redo and room switching to the field", () => {
    for (const target of inputs) {
      expect(routeShortcut(press("z", { metaKey: true }, target), none)).toBeNull();
      expect(routeShortcut(press("z", { metaKey: true, shiftKey: true }, target), none)).toBeNull();
      expect(routeShortcut(press("3", { metaKey: true }, target), none)).toBeNull();
    }
  });

  it("still opens the palette, shortcuts, save and export from a field", () => {
    const target = inputs[0];
    expect(routeShortcut(press("k", { metaKey: true }, target), none)).toBe("palette");
    expect(routeShortcut(press("/", { ctrlKey: true }, target), none)).toBe("shortcuts");
    expect(routeShortcut(press("s", { metaKey: true }, target), none)).toBe("save");
    expect(routeShortcut(press("E", { metaKey: true, shiftKey: true }, target), none)).toBe("export");
  });

  it("treats checkboxes and range sliders as not editable", () => {
    expect(isEditable(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isEditable(el("INPUT", { type: "range" }))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe("chords", () => {
  it("routes history, rooms and app chords with Cmd or Ctrl", () => {
    expect(routeShortcut(press("z", { metaKey: true }), none)).toBe("undo");
    expect(routeShortcut(press("Z", { metaKey: true, shiftKey: true }), none)).toBe("redo");
    expect(routeShortcut(press("z", { ctrlKey: true }), none)).toBe("undo");
    expect(routeShortcut(press("y", { ctrlKey: true }), none)).toBe("redo");
    expect(routeShortcut(press("1", { metaKey: true }), none)).toBe("room-0");
    expect(routeShortcut(press("3", { ctrlKey: true }), none)).toBe("room-2");
    expect(routeShortcut(press("6", { metaKey: true }), none)).toBe("room-5");
    expect(routeShortcut(press("7", { metaKey: true }), none)).toBeNull();
    expect(routeShortcut(press("k", { metaKey: true }), none)).toBe("palette");
    expect(routeShortcut(press("/", { metaKey: true }), none)).toBe("shortcuts");
    expect(routeShortcut(press("s", { metaKey: true }), none)).toBe("save");
    expect(routeShortcut(press("e", { metaKey: true, shiftKey: true }), none)).toBe("export");
  });

  it("does not turn Cmd+letter into the plain-letter action", () => {
    expect(routeShortcut(press("l", { metaKey: true }), none)).toBeNull();
    expect(routeShortcut(press("r", { ctrlKey: true }), none)).toBeNull();
    expect(routeShortcut(press("m", { altKey: true }), none)).toBeNull();
  });
});

describe("with a sheet open", () => {
  it("lets only the app chords through", () => {
    expect(routeShortcut(press(" "), { sheet: "export" })).toBeNull();
    expect(routeShortcut(press("l"), { sheet: "palette" })).toBeNull();
    expect(routeShortcut(press("k", { metaKey: true }), { sheet: "palette" })).toBe("palette");
    expect(routeShortcut(press("/", { metaKey: true }), { sheet: "shortcuts" })).toBe("shortcuts");
  });

  it("blocks everything while a question is open", () => {
    expect(routeShortcut(press("k", { metaKey: true }), { sheet: "confirm" })).toBeNull();
    expect(routeShortcut(press("s", { metaKey: true }), { sheet: "confirm" })).toBeNull();
  });
});

describe("tempo helper", () => {
  it("halves fast tempos and doubles slow ones", () => {
    expect(halveOrDouble(128)).toBe(64);
    expect(halveOrDouble(64)).toBe(128);
    expect(halveOrDouble(100)).toBe(50);
  });
});

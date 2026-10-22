export interface ShortcutEntry {
  what: string;
  /** "mod" is Cmd on a Mac and Ctrl elsewhere. Parts are joined with "+". */
  keys: string;
}

export interface ShortcutGroup {
  name: string;
  items: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    name: "Playback",
    items: [
      { what: "Play or pause", keys: "space" },
      { what: "Back to start", keys: "enter" },
      { what: "Loop on or off", keys: "l" },
      { what: "Record", keys: "r" },
      { what: "Tap tempo", keys: "t" },
      { what: "Halve or double tempo", keys: "shift+t" },
      { what: "Metronome", keys: "m" },
      { what: "Minimise or expand the player", keys: "mod+." },
      { what: "Enter or leave full screen", keys: "shift+mod+f" },
    ],
  },
  {
    name: "Editing",
    items: [
      { what: "Undo", keys: "mod+z" },
      { what: "Redo", keys: "shift+mod+z" },
      { what: "Split at playhead", keys: "s" },
      { what: "Duplicate", keys: "mod+d" },
      { what: "Cut, copy, paste", keys: "mod+x c v" },
      { what: "Delete", keys: "backspace" },
    ],
  },
  {
    name: "Rooms",
    items: [
      { what: "Arrange", keys: "mod+1" },
      { what: "Instruments", keys: "mod+2" },
      { what: "Mixer", keys: "mod+3" },
      { what: "Song", keys: "mod+4" },
      { what: "Stage", keys: "mod+5" },
      { what: "Library", keys: "mod+6" },
    ],
  },
  {
    name: "Everywhere",
    items: [
      { what: "Search and commands", keys: "mod+k" },
      { what: "This list", keys: "mod+/" },
      { what: "Save now", keys: "mod+s" },
      { what: "Export", keys: "shift+mod+e" },
    ],
  },
];

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}

const WORDS: Record<string, [mac: string, other: string]> = {
  space: ["Space", "Space"],
  enter: ["Enter", "Enter"],
  backspace: ["⌫", "Backspace"],
};

/** "shift+mod+z" becomes "⇧⌘Z" on a Mac and "Ctrl+Shift+Z" elsewhere. "mod+x c v" keeps its spaces. */
export function displayKeys(spec: string, mac: boolean): string {
  return spec
    .split(" ")
    .map((chunk) => {
      const parts = chunk.split("+");
      const key = parts[parts.length - 1];
      const mods = parts.slice(0, -1);
      const label = WORDS[key]?.[mac ? 0 : 1] ?? key.toUpperCase();
      if (mac) return `${mods.includes("shift") ? "⇧" : ""}${mods.includes("mod") ? "⌘" : ""}${label}`;
      return [...(mods.includes("mod") ? ["Ctrl"] : []), ...(mods.includes("shift") ? ["Shift"] : []), label].join("+");
    })
    .join(" ");
}

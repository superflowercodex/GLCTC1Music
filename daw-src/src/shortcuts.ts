import { setLoop } from "./project/actions";
import { metronomeStore } from "./audio/arrangementPlayback";
import { showToast } from "./audio/media";
import { setProjectBpm, stopAndRewind, tapTempo, togglePlay } from "./audio/transport";
import { redo, undo } from "./project/history";
import { persistence } from "./project/persist";
import { ROOMS } from "./rooms";
import { projectStore, uiStore, type UiState } from "./store/project";

export type AppAction =
  | "play-pause"
  | "rewind"
  | "loop"
  | "record"
  | "tap-tempo"
  | "tempo-halve-double"
  | "tempo-from-clip"
  | "metronome"
  | "undo"
  | "redo"
  | "save"
  | "export"
  | "palette"
  | "shortcuts"
  | "performance"
  | `room-${number}`;

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
}

export interface RouteContext {
  /** Which sheet is open, if any. */
  sheet: UiState["sheet"];
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "time", "datetime-local", "month", "week"]);

/** True when typing here should reach the page and not the shortcuts. */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLElement> | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") return TEXT_INPUT_TYPES.has(((el as HTMLInputElement).type ?? "text").toLowerCase());
  return false;
}

/** Controls that already use Space and Enter themselves: a focused button must activate, not start playback. */
function activatesOnSpace(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLElement> | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "button" || tag === "a" || tag === "summary") return true;
  if (tag === "input") return ["checkbox", "radio", "button", "submit", "reset", "file", "color"].includes(((el as HTMLInputElement).type ?? "").toLowerCase());
  const role = el.getAttribute?.("role");
  return role === "button" || role === "switch" || role === "checkbox" || role === "radio" || role === "tab" || role === "menuitem" || role === "option";
}

/**
 * Decides what a keypress means. Pure, so the rules can be tested without a browser.
 * Plain keys never fire inside text fields; the few app-wide chords with a modifier do, except undo and
 * redo, which belong to the text field there.
 */
export function routeShortcut(event: KeyLike, ctx: RouteContext): AppAction | null {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const typing = isEditable(event.target);

  // While a question is open, only its own buttons and keys apply.
  if (ctx.sheet === "confirm") return null;

  if (mod && !event.altKey) {
    if (key === "k" && !event.shiftKey) return "palette";
    if (key === "/" || (key === "?" && event.shiftKey)) return "shortcuts";
    if (key === "s" && !event.shiftKey) return "save";
    if (key === "e" && event.shiftKey) return "export";
    if (typing) return null;
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y" && event.ctrlKey && !event.metaKey) return "redo";
    if (/^[1-9]$/.test(key) && !event.shiftKey) {
      const index = Number(key) - 1;
      return index < ROOMS.length ? `room-${index}` : null;
    }
    return null;
  }

  if (typing || mod || event.altKey || ctx.sheet !== null) return null;
  if (key === " " || key === "Enter") {
    if (event.repeat || activatesOnSpace(event.target)) return null;
    return key === " " ? "play-pause" : "rewind";
  }
  if (event.repeat) return null;
  switch (key) {
    case "l":
      return event.shiftKey ? null : "loop";
    case "r":
      return event.shiftKey ? null : "record";
    case "m":
      return event.shiftKey ? null : "metronome";
    case "t":
      return event.shiftKey ? "tempo-halve-double" : "tap-tempo";
    default:
      return null;
  }
}

function toggleSheet(name: NonNullable<UiState["sheet"]>): void {
  const current = uiStore.get().sheet;
  if (current === name) uiStore.set((s) => ({ ...s, sheet: null }));
  // A recording or an export in progress must not be swapped out from under the user.
  else if (current === null || (current !== "record" && current !== "export" && current !== "confirm")) uiStore.set((s) => ({ ...s, sheet: name }));
}

export function openSheet(name: NonNullable<UiState["sheet"]>): void {
  const current = uiStore.get().sheet;
  if (current === name) return;
  if (current === null || (current !== "record" && current !== "export" && current !== "confirm")) uiStore.set((s) => ({ ...s, sheet: name }));
}

export function halveOrDouble(bpm: number): number {
  return bpm >= 100 ? bpm / 2 : bpm * 2;
}

/** The BPM stored on the selected clip's audio file, if it has one. */
export function selectedClipBpm(): number | null {
  const clipId = uiStore.get().selectedClipId;
  if (!clipId) return null;
  const project = projectStore.get();
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip?.assetId) return project.assets.find((a) => a.id === clip.assetId)?.detectedBpm ?? null;
  }
  return null;
}

async function save(): Promise<void> {
  try {
    await persistence().saveNow();
    showToast("Project saved.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Saving failed.");
  }
}

export function runAppAction(action: AppAction): void {
  switch (action) {
    case "play-pause":
      void togglePlay();
      return;
    case "rewind":
      stopAndRewind();
      return;
    case "loop":
      projectStore.set((p) => setLoop(p, { on: !p.loop.on }));
      return;
    case "record":
      openSheet("record");
      return;
    case "tap-tempo":
      tapTempo();
      return;
    case "tempo-halve-double":
      setProjectBpm(halveOrDouble(projectStore.get().bpm));
      return;
    case "tempo-from-clip": {
      const bpm = selectedClipBpm();
      if (bpm === null) showToast("Select a clip with a detected tempo first.");
      else setProjectBpm(bpm);
      return;
    }
    case "metronome":
      metronomeStore.set((s) => ({ on: !s.on }));
      showToast(metronomeStore.get().on ? "Metronome on." : "Metronome off.");
      return;
    case "undo":
      if (!undo()) showToast("Nothing to undo.");
      return;
    case "redo":
      if (!redo()) showToast("Nothing to redo.");
      return;
    case "save":
      void save();
      return;
    case "export":
      openSheet("export");
      return;
    case "palette":
      toggleSheet("palette");
      return;
    case "shortcuts":
      toggleSheet("shortcuts");
      return;
    case "performance":
      openSheet("performance");
      return;
    default: {
      const index = Number(action.slice("room-".length));
      const room = ROOMS[index];
      if (room) location.hash = `#/${room.id}`;
    }
  }
}

/** Starts the global keyboard handling; the returned function stops it. */
export function startShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const action = routeShortcut(event, { sheet: uiStore.get().sheet });
    if (!action) return;
    event.preventDefault();
    runAppAction(action);
  };
  addEventListener("keydown", onKeyDown);
  return () => removeEventListener("keydown", onKeyDown);
}

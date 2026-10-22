import { ROOMS } from "../rooms";
import type { InstrumentInfo } from "../audio/instruments/registry";
import type { AppAction } from "../shortcuts";
import { displayKeys } from "./shortcutList";
import { setSkyMode, SKY_MODE_LABEL, SKY_MODES, skyStore } from "../gfx/skySettings";

export type PaletteGroup = "Actions" | "Go to" | "Instruments" | "Presets";

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Right-hand text: a key, or a value such as a tempo. */
  hint?: string;
  keywords?: string;
  run(): void;
}

export const GROUP_ORDER: readonly PaletteGroup[] = ["Actions", "Go to", "Instruments", "Presets"];

/**
 * Scores how well `query` matches `text`: whole words first, then substrings, then letters in order
 * ("tpt" finds "Tap tempo"). Returns null when there is no match.
 */
export function matchScore(query: string, text: string, fuzzy = true): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const t = text.toLowerCase();
  let total = 0;
  for (const word of q.split(/\s+/)) {
    const at = t.indexOf(word);
    if (at !== -1) {
      const atWordStart = at === 0 || /[\s·\-_/]/.test(t[at - 1]);
      total += (atWordStart ? 100 : 60) - Math.min(at, 40);
      continue;
    }
    if (!fuzzy) return null;
    // Letters in order, with a penalty for each gap.
    let ti = 0;
    let gaps = 0;
    for (const ch of word) {
      const found = t.indexOf(ch, ti);
      if (found === -1) return null;
      gaps += found - ti;
      ti = found + 1;
    }
    total += Math.max(5, 30 - gaps);
  }
  return total;
}

export interface PaletteContext {
  mac: boolean;
  run(action: AppAction): void;
  /** Tempo stored on the selected clip's audio, or null. */
  clipBpm: number | null;
  tempo: number;
  instruments: readonly Pick<InstrumentInfo, "kind" | "name" | "tagline">[];
  openInstrument(kind: string): void;
  /** Presets of instruments that exist in the project right now. */
  presets: ReadonlyArray<{ id: string; name: string; instrumentName: string; load(): void }>;
  loopOn: boolean;
  metronomeOn: boolean;
}

export function buildPaletteItems(ctx: PaletteContext): PaletteItem[] {
  const keys = (spec: string): string => displayKeys(spec, ctx.mac);
  const act = (id: string, label: string, action: AppAction, hint?: string, keywords?: string): PaletteItem => ({ id, group: "Actions", label, hint, keywords, run: () => ctx.run(action) });
  const items: PaletteItem[] = [];
  if (ctx.clipBpm !== null) items.push(act("tempo-from-clip", "Set project tempo to clip’s detected BPM", "tempo-from-clip", ctx.clipBpm.toFixed(1), "bpm sync match"));
  items.push(
    act("tap-tempo", "Tap tempo", "tap-tempo", keys("t"), "bpm"),
    act("tempo-halve-double", "Halve or double tempo", "tempo-halve-double", keys("shift+t"), `bpm ${ctx.tempo}`),
    act("play-pause", "Play or pause", "play-pause", keys("space"), "start stop transport"),
    act("rewind", "Back to start", "rewind", keys("enter"), "rewind stop"),
    act("loop", ctx.loopOn ? "Turn loop off" : "Turn loop on", "loop", keys("l"), "repeat cycle"),
    act("metronome", ctx.metronomeOn ? "Turn metronome off" : "Turn metronome on", "metronome", keys("m"), "click"),
    act("player-dock", "Minimise or expand the player", "player-dock", keys("mod+."), "transport pill collapse hide"),
    act("fullscreen", "Enter or leave full screen", "fullscreen", keys("shift+mod+f"), "immersive maximise window"),
    act("record", "Record…", "record", keys("r"), "mic microphone capture take"),
    act("performance", "Performance recorder", "performance", undefined, "automation knobs gestures layers take"),
    act("undo", "Undo", "undo", keys("mod+z")),
    act("redo", "Redo", "redo", keys("shift+mod+z")),
    act("save", "Save now", "save", keys("mod+s"), "store"),
    act("export", "Export…", "export", keys("shift+mod+e"), "wav bounce mixdown render stems"),
    act("shortcuts", "Keyboard shortcuts", "shortcuts", keys("mod+/"), "keys help"),
  );
  const sky = skyStore.get().mode;
  for (const mode of SKY_MODES) {
    items.push({ id: `background-${mode}`, group: "Actions", label: `Background: ${SKY_MODE_LABEL[mode]}`, hint: mode === sky ? "On" : undefined, keywords: "sky nebula stars motion animation settings", run: () => setSkyMode(mode) });
  }
  ROOMS.forEach((room, i) => {
    items.push({ id: `room-${room.id}`, group: "Go to", label: room.title, hint: keys(`mod+${i + 1}`), keywords: room.label, run: () => ctx.run(`room-${i}`) });
  });
  for (const info of ctx.instruments) {
    items.push({ id: `inst-${info.kind}`, group: "Instruments", label: info.name, hint: info.tagline, keywords: "play open instrument", run: () => ctx.openInstrument(info.kind) });
  }
  for (const preset of ctx.presets) {
    items.push({ id: `preset-${preset.id}`, group: "Presets", label: preset.name, hint: preset.instrumentName, keywords: "preset sound patch", run: preset.load });
  }
  return items;
}

const EMPTY_QUERY_LIMIT: Record<PaletteGroup, number> = { Actions: 6, "Go to": 6, Instruments: 0, Presets: 0 };
const QUERY_LIMIT: Record<PaletteGroup, number> = { Actions: 8, "Go to": 6, Instruments: 6, Presets: 8 };

/** Items to show for a query. Groups with the best match come first; inside a group, best match first. */
export function searchPalette(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const empty = query.trim() === "";
  const limits = empty ? EMPTY_QUERY_LIMIT : QUERY_LIMIT;
  const groups: Array<{ group: PaletteGroup; best: number; items: PaletteItem[] }> = [];
  for (const group of GROUP_ORDER) {
    const scored: Array<{ item: PaletteItem; score: number; order: number }> = [];
    items.forEach((item, order) => {
      if (item.group !== group) return;
      const label = matchScore(query, item.label);
      const extra = item.keywords ? matchScore(query, item.keywords, false) : null;
      const score = label !== null ? label + 10 : extra;
      if (score !== null) scored.push({ item, score, order });
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    if (scored.length > 0) groups.push({ group, best: scored[0].score, items: scored.slice(0, limits[group]).map((s) => s.item) });
  }
  if (!empty) groups.sort((a, b) => b.best - a.best);
  return groups.flatMap((g) => g.items);
}

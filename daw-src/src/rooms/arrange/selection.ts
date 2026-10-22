import { findClip, type ClipboardItem } from "../../project/actions";
import { projectStore, uiStore } from "../../store/project";
import { createStore } from "../../store/store";

export const selectionStore = createStore<{ ids: readonly string[]; trackIds: readonly string[] }>({ ids: [], trackIds: [] });

/** The clipboard outlives the room, so a clip copied in Arrange can be pasted after a visit elsewhere. */
export let clipboard: readonly ClipboardItem[] = [];

export function setClipboard(items: readonly ClipboardItem[]): void {
  clipboard = items;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Add-or-remove one id, keeping the order the clips were picked in. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Ids of the boxes a marquee touches. Touching edges do not count, so a rectangle of no area selects nothing. */
export function marqueeHits(marquee: Box, boxes: ReadonlyArray<{ id: string } & Box>): string[] {
  const l = Math.min(marquee.left, marquee.right);
  const r = Math.max(marquee.left, marquee.right);
  const t = Math.min(marquee.top, marquee.bottom);
  const b = Math.max(marquee.top, marquee.bottom);
  return boxes.filter((x) => x.left < r && x.right > l && x.top < b && x.bottom > t).map((x) => x.id);
}

/** What a live marquee selects: its hits, joined to the selection held when the drag began when the gesture is additive. */
export function marqueeSelection(base: readonly string[], hits: readonly string[], additive: boolean): string[] {
  if (!additive) return [...hits];
  const seen = new Set(base);
  return [...base, ...hits.filter((h) => !seen.has(h))];
}

/** Ids between two ends of an ordered list, either way round; falls back to the clicked one when the anchor is gone. */
export function rangeBetween(order: readonly string[], anchor: string | null, to: string): string[] {
  const a = anchor === null ? -1 : order.indexOf(anchor);
  const b = order.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function selectClips(ids: readonly string[]): void {
  if (sameIds(ids, selectionStore.get().ids)) return;
  selectionStore.set((s) => ({ ...s, ids }));
  uiStore.set((s) => ({ ...s, selectedClipId: ids[0] ?? null, selectedClipIds: [...ids] }));
  const track = ids[0] ? findClip(projectStore.get(), ids[0])?.track : undefined;
  if (track) {
    uiStore.set((s) => ({ ...s, selectedTrackId: track.id }));
    selectionStore.set((s) => ({ ...s, trackIds: [track.id] }));
  }
}

export function toggleClip(id: string): void {
  selectClips(toggleId(selectionStore.get().ids, id));
}

/** Drops ids whose clips no longer exist (deleted, or removed by undo). */
export function pruneSelection(): void {
  const project = projectStore.get();
  const ids = selectionStore.get().ids;
  const kept = ids.filter((id) => findClip(project, id));
  if (kept.length !== ids.length) selectClips(kept);
  const trackIds = selectionStore.get().trackIds;
  const tracksKept = trackIds.filter((id) => project.tracks.some((t) => t.id === id));
  if (tracksKept.length !== trackIds.length) selectionStore.set((s) => ({ ...s, trackIds: tracksKept }));
}

/** Plain click on a track header: that track alone. Cmd/Ctrl toggles it in; Shift selects the run from the last one clicked. */
export function pickTrack(trackId: string, mode: "only" | "toggle" | "range"): void {
  const project = projectStore.get();
  const { trackIds } = selectionStore.get();
  const current = uiStore.get().selectedTrackId;
  let next: string[];
  if (mode === "toggle") next = toggleId(trackIds, trackId);
  else if (mode === "range") next = rangeBetween(project.tracks.map((t) => t.id), current, trackId);
  else next = [trackId];
  selectionStore.set((s) => ({ ...s, trackIds: next }));
  uiStore.set((s) => ({ ...s, selectedTrackId: mode === "toggle" && !next.includes(trackId) ? (next[next.length - 1] ?? null) : trackId }));
}

/** The tracks an action on one header applies to: the whole selection if the header is part of it. */
export function tracksFor(trackId: string): string[] {
  const { trackIds } = selectionStore.get();
  return trackIds.includes(trackId) && trackIds.length > 1 ? [...trackIds] : [trackId];
}

export function clearTrackSelection(): void {
  const current = uiStore.get().selectedTrackId;
  selectionStore.set((s) => ({ ...s, trackIds: current ? [current] : [] }));
}

import { findClip, type ClipboardItem } from "../../project/actions";
import { projectStore, uiStore } from "../../store/project";
import { createStore } from "../../store/store";

export const selectionStore = createStore<{ ids: readonly string[] }>({ ids: [] });

/** The clipboard outlives the room, so a clip copied in Arrange can be pasted after a visit elsewhere. */
export let clipboard: readonly ClipboardItem[] = [];

export function setClipboard(items: readonly ClipboardItem[]): void {
  clipboard = items;
}

export function selectClips(ids: readonly string[]): void {
  selectionStore.set({ ids });
  uiStore.set((s) => ({ ...s, selectedClipId: ids[0] ?? null }));
  const track = ids[0] ? findClip(projectStore.get(), ids[0])?.track : undefined;
  if (track) uiStore.set((s) => ({ ...s, selectedTrackId: track.id }));
}

export function toggleClip(id: string): void {
  const ids = selectionStore.get().ids;
  selectClips(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
}

/** Drops ids whose clips no longer exist (deleted, or removed by undo). */
export function pruneSelection(): void {
  const project = projectStore.get();
  const ids = selectionStore.get().ids;
  const kept = ids.filter((id) => findClip(project, id));
  if (kept.length !== ids.length) selectClips(kept);
}

import { peekEngine, getEngine } from "../../audio/engine";
import { showToast } from "../../audio/media";
import { ensureInstrument } from "../../project/instruments";
import {
  addTrack,
  ArrangeError,
  canSplit,
  copyClips,
  duplicateClips,
  findClip,
  makeClip,
  makeTrack,
  moveClips,
  moveTrack,
  pasteClips,
  removeClips,
  removeTrack,
  splitClip,
  trimToBar,
  updateTrack,
  addClip,
} from "../../project/actions";
import { INSTRUMENTS } from "../../audio/instruments/registry";
import type { TrackKind } from "../../project/model";
import { projectStore, uiStore } from "../../store/project";
import type { InstrumentKind } from "../../audio/types";
import { importMedia, placeAsset } from "../../project/importMedia";
import { freeDelta } from "./overlap";
import { arrangeSettings } from "./settings";
import type { Project } from "../../project/model";
import { clipboard, selectClips, selectionStore, setClipboard } from "./selection";
import { gridInBars } from "./timeline";

function guard(work: () => void): void {
  try {
    work();
  } catch (err) {
    if (err instanceof ArrangeError) showToast(err.message);
    else throw err;
  }
}

/** The playhead as an exact bar number. */
export function playheadBarExact(): number {
  const spb = projectStore.get().beatsPerBar * 4;
  return (peekEngine()?.clock.position() ?? 0) / spb + 1;
}

export function seekToBar(bar: number): void {
  const spb = projectStore.get().beatsPerBar * 4;
  getEngine().clock.seek(Math.max(0, (bar - 1) * spb));
}

function selected(): readonly string[] {
  return selectionStore.get().ids;
}

export function splitAtPlayhead(): void {
  const bar = playheadBarExact();
  let project = projectStore.get();
  const ids = selected().length
    ? selected()
    : project.tracks
        .flatMap((t) => t.clips)
        .filter((c) => canSplit(project, c, bar))
        .map((c) => c.id);
  const created: string[] = [];
  for (const id of ids) {
    const clip = findClip(project, id)?.clip;
    if (!clip || !canSplit(project, clip, bar)) continue;
    const result = splitClip(project, id, bar);
    project = result.project;
    created.push(...result.ids);
  }
  if (created.length === 0) {
    showToast("Move the playhead inside a clip to split it.");
    return;
  }
  projectStore.set(project);
  selectClips(created.filter((_, i) => i % 2 === 1));
}

export function trimAtPlayhead(): void {
  const bar = playheadBarExact();
  let project = projectStore.get();
  const before = project;
  for (const id of selected()) project = trimToBar(project, id, bar);
  if (project === before) showToast("Select a clip and put the playhead inside it to trim its start.");
  else projectStore.set(project);
}

export function deleteSelected(): void {
  const ids = selected();
  if (ids.length === 0) return;
  projectStore.set((p) => removeClips(p, ids));
  selectClips([]);
}

/** With "Avoid overlaps" on, clips that just landed slide to the nearest spot where they cover nothing. */
function settle(project: Project, ids: readonly string[]): Project {
  if (!arrangeSettings.get().avoidOverlaps || ids.length === 0) return project;
  const d = freeDelta(project, ids, 0, 0);
  return d === 0 ? project : moveClips(project, ids, { deltaBars: d, deltaTracks: 0 });
}

export function duplicateSelected(): void {
  const ids = selected();
  if (ids.length === 0) return;
  const result = duplicateClips(projectStore.get(), ids);
  projectStore.set(settle(result.project, result.ids));
  selectClips(result.ids);
}

export function copySelected(): void {
  const ids = selected();
  if (ids.length === 0) return;
  setClipboard(copyClips(projectStore.get(), ids));
  showToast(ids.length === 1 ? "Clip copied." : `${ids.length} clips copied.`);
}

export function cutSelected(): void {
  const ids = selected();
  if (ids.length === 0) return;
  setClipboard(copyClips(projectStore.get(), ids));
  deleteSelected();
}

export function pasteAtPlayhead(): void {
  if (clipboard.length === 0) {
    showToast("Nothing to paste yet. Copy a clip first.");
    return;
  }
  guard(() => {
    const { selectedTrackId } = uiStore.get();
    const result = pasteClips(projectStore.get(), clipboard, playheadBarExact(), selectedTrackId ?? undefined);
    projectStore.set(settle(result.project, result.ids));
    selectClips(result.ids);
  });
}

export function selectAllClips(): void {
  selectClips(projectStore.get().tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

/** Arrow keys move the selection: left/right by a grid step (a whole bar with Shift), up/down by a track. */
export function nudgeSelected(direction: -1 | 1, opts: { bar?: boolean } = {}): void {
  const ids = selected();
  if (ids.length === 0) return;
  const { beatsPerBar } = projectStore.get();
  const { gridBeats } = arrangeSettings.get();
  const step = opts.bar ? 1 : gridInBars(gridBeats, beatsPerBar);
  guard(() => projectStore.set((p) => moveClips(p, ids, { deltaBars: direction * step, deltaTracks: 0 })));
}

export function nudgeSelectedTracks(direction: -1 | 1): void {
  const ids = selected();
  if (ids.length === 0) return;
  projectStore.set((p) => moveClips(p, ids, { deltaBars: 0, deltaTracks: direction }));
}

/** Every clip on the given tracks (the selected ones by default). */
export function selectTrackClips(trackIds: readonly string[]): void {
  const set = new Set(trackIds);
  selectClips(projectStore.get().tracks.filter((t) => set.has(t.id)).flatMap((t) => t.clips.map((c) => c.id)));
}

export function addPlainTrack(kind: Exclude<TrackKind, "instrument" | "fx">): void {
  const track = makeTrack(projectStore.get(), kind);
  projectStore.set((p) => addTrack(p, track));
  uiStore.set((s) => ({ ...s, selectedTrackId: track.id }));
}

export async function addInstrumentTrack(kind: InstrumentKind): Promise<void> {
  const info = INSTRUMENTS.find((i) => i.kind === kind);
  const existing = projectStore.get().instruments.find((s) => s.kind === kind);
  if (existing) {
    uiStore.set((s) => ({ ...s, selectedTrackId: existing.trackId }));
    showToast(`${info?.name ?? kind} is already in this project.`);
    return;
  }
  try {
    await ensureInstrument(kind);
    const slot = projectStore.get().instruments.find((s) => s.kind === kind);
    if (slot) uiStore.set((s) => ({ ...s, selectedTrackId: slot.trackId }));
  } catch (err) {
    showToast(`${info?.name ?? kind} could not be loaded: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

export function deleteTrack(trackId: string): void {
  deleteTracks([trackId]);
}

/** One undo step, however many tracks. */
export function deleteTracks(trackIds: readonly string[]): void {
  const gone = new Set(trackIds);
  projectStore.set((p) => [...gone].reduce((acc, id) => removeTrack(acc, id), p));
  uiStore.set((s) => (s.selectedTrackId && gone.has(s.selectedTrackId) ? { ...s, selectedTrackId: null } : s));
  selectionStore.set((s) => ({ ...s, trackIds: s.trackIds.filter((id) => !gone.has(id)) }));
}

export function shiftTrack(trackId: string, by: -1 | 1): void {
  projectStore.set((p) => {
    const i = p.tracks.findIndex((t) => t.id === trackId);
    return i < 0 ? p : moveTrack(p, trackId, i + by);
  });
}

/** Flips a flag on every given track to one shared value, so a mixed selection ends up uniform. */
export function toggleTrackFlag(trackId: string, flag: "muted" | "solo", all: readonly string[] = [trackId]): void {
  projectStore.set((p) => {
    const t = p.tracks.find((x) => x.id === trackId);
    if (!t) return p;
    const value = !t[flag];
    return all.reduce((acc, id) => updateTrack(acc, id, { [flag]: value }), p);
  });
}

export function colorTracks(trackIds: readonly string[], color: string): void {
  projectStore.set((p) => trackIds.reduce((acc, id) => updateTrack(acc, id, { color }), p));
}

/** A new empty pattern clip for an instrument track, four bars long, at a bar. */
export function addPatternClip(trackId: string, startBar: number): void {
  guard(() => {
    const clip = makeClip({ kind: "pattern", name: "Pattern A", startBar, lengthBars: 4, patternIndex: 0 });
    projectStore.set((p) => addClip(p, trackId, clip));
    selectClips([clip.id]);
  });
}

/**
 * Imports files and puts them on the timeline: the first at the drop point (or the playhead),
 * any others on tracks of their own at the same bar so nothing lands on top of anything.
 */
export async function importAndPlace(files: readonly File[], at?: { trackId?: string; startBar?: number }): Promise<void> {
  const assets = await importMedia(files);
  let first = true;
  for (const asset of assets) {
    if (asset.kind === "midi") continue;
    guard(() => {
      const id = placeAsset(asset.id, first ? at : { startBar: at?.startBar, newTrack: true });
      if (first) selectClips([id]);
    });
    first = false;
  }
}

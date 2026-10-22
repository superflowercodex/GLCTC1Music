import { projectStore } from "../store/project";
import { createStore, useStore, type Store } from "../store/store";
import type { Project } from "./model";

export interface HistoryOptions {
  limit?: number;
  /** Edits closer together than this share one undo step, so a slider drag is one step. */
  coalesceMs?: number;
  now?: () => number;
}

export interface History {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Everything changed until the returned function is called becomes one step; use it around a pointer gesture. */
  hold(): () => void;
  reset(): void;
  dispose(): void;
  /**
   * Runs `fn` (which sets the store) as an undoable change to these instrument slots' saved state.
   * Instrument state is normally left out of undo; this opts one edit in, such as a pattern edited from Arrange.
   */
  recordSlots(slotIds: readonly string[], fn: () => void): void;
  /** Called after undo or redo rolled instrument slots back, so their live instruments can follow. */
  onSlotsRestored(listener: (slotIds: ReadonlySet<string>, project: Project) => void): () => void;
  readonly flags: Store<{ canUndo: boolean; canRedo: boolean }>;
}

/** Instrument sound follows its own saved copy and imported media is never rolled back, so neither counts as an arrangement change. */
function arrangementChanged(a: Project, b: Project): boolean {
  for (const key of Object.keys(b) as Array<keyof Project>) {
    if (key === "updatedAt" || key === "instruments" || key === "assets") continue;
    if (!Object.is(a[key], b[key])) return true;
  }
  if (a.instruments.length !== b.instruments.length) return true;
  return a.instruments.some((s, i) => s.id !== b.instruments[i].id || s.trackId !== b.instruments[i].trackId || s.kind !== b.instruments[i].kind);
}

/**
 * Watches a project store and keeps snapshots of what it held before each change. Because it only
 * subscribes, edits made by any code through the store are undoable.
 * Imported media and instrument sound are kept as they are now when stepping back: blobs are not
 * rolled back, and restoring a stale knob position would not move the live instrument anyway.
 */
export function createHistory(store: Store<Project>, options: HistoryOptions = {}): History {
  const limit = options.limit ?? 80;
  const coalesceMs = options.coalesceMs ?? 600;
  const now = options.now ?? (() => Date.now());
  const flags = createStore({ canUndo: false, canRedo: false });

  let past: Project[] = [];
  let future: Project[] = [];
  let last = store.get();
  let applying = false;
  let lastChangeAt = -Infinity;
  let holds = 0;
  let holdPushed = false;
  let pendingSlots: ReadonlySet<string> | null = null;
  // The slots a step changed, keyed by the snapshot on its far side: `before` in past, `after` in future.
  const pastSlots = new WeakMap<Project, Set<string>>();
  const futureSlots = new WeakMap<Project, Set<string>>();
  const slotListeners = new Set<(slotIds: ReadonlySet<string>, project: Project) => void>();

  const publish = () => flags.set({ canUndo: past.length > 0, canRedo: future.length > 0 });

  const unsubscribe = store.subscribe(() => {
    const next = store.get();
    if (applying) {
      last = next;
      return;
    }
    if (next.id !== last.id) {
      past = [];
      future = [];
      last = next;
      lastChangeAt = -Infinity;
      publish();
      return;
    }
    const slots = pendingSlots;
    pendingSlots = null;
    if (!slots && !arrangementChanged(last, next)) {
      last = next;
      return;
    }
    const t = now();
    const joinsPrevious = holds > 0 ? holdPushed : t - lastChangeAt < coalesceMs && past.length > 0;
    if (!joinsPrevious) {
      past.push(last);
      if (past.length > limit) past.shift();
    }
    const owner = past[past.length - 1];
    if (slots && owner) {
      const set = pastSlots.get(owner) ?? new Set<string>();
      for (const id of slots) set.add(id);
      pastSlots.set(owner, set);
    }
    if (holds > 0) holdPushed = true;
    future = [];
    lastChangeAt = t;
    last = next;
    publish();
  });

  function restore(target: Project, slots: ReadonlySet<string> | undefined): void {
    const current = store.get();
    const reconciled: Project = {
      ...target,
      assets: current.assets,
      instruments: target.instruments.map((s) => {
        if (slots?.has(s.id)) return s;
        const live = current.instruments.find((c) => c.id === s.id);
        return live ? { ...s, state: live.state } : s;
      }),
      updatedAt: now(),
    };
    applying = true;
    try {
      store.set(reconciled);
    } finally {
      applying = false;
    }
    last = store.get();
    lastChangeAt = -Infinity;
    publish();
    if (slots && slots.size > 0) for (const listener of slotListeners) listener(slots, last);
  }

  return {
    flags,
    undo() {
      const target = past.pop();
      if (!target) return false;
      const slots = pastSlots.get(target);
      const current = store.get();
      future.push(current);
      if (slots) futureSlots.set(current, slots);
      restore(target, slots);
      return true;
    },
    redo() {
      const target = future.pop();
      if (!target) return false;
      const slots = futureSlots.get(target);
      const current = store.get();
      past.push(current);
      if (slots) pastSlots.set(current, slots);
      restore(target, slots);
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    hold() {
      holds += 1;
      if (holds === 1) holdPushed = false;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0) lastChangeAt = -Infinity;
      };
    },
    reset() {
      past = [];
      future = [];
      last = store.get();
      lastChangeAt = -Infinity;
      publish();
    },
    dispose: unsubscribe,
    recordSlots(slotIds, fn) {
      pendingSlots = new Set(slotIds);
      try {
        fn();
      } finally {
        pendingSlots = null;
      }
    },
    onSlotsRestored(listener) {
      slotListeners.add(listener);
      return () => slotListeners.delete(listener);
    },
  };
}

/** The open project's history. Importing this module starts recording, so import it at app start. */
export const history = createHistory(projectStore);

export const undo = (): boolean => history.undo();
export const redo = (): boolean => history.redo();
export const canUndo = (): boolean => history.canUndo();
export const canRedo = (): boolean => history.canRedo();
export const holdHistory = (): (() => void) => history.hold();
export const recordSlotEdit = (slotIds: readonly string[], fn: () => void): void => history.recordSlots(slotIds, fn);

export function useCanUndo(): boolean {
  return useStore(history.flags, (f) => f.canUndo);
}

export function useCanRedo(): boolean {
  return useStore(history.flags, (f) => f.canRedo);
}

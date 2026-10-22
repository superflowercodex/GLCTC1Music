import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createStore } from "../store/store";
import { createHistory } from "./history";
import { newProject, type Project } from "./model";

function setup(coalesceMs = 600) {
  let clockMs = 0;
  const store = createStore<Project>(newProject());
  const history = createHistory(store, { coalesceMs, now: () => clockMs });
  const advance = (ms: number) => {
    clockMs += ms;
  };
  const setBpm = (bpm: number) => store.set((p) => ({ ...p, bpm }));
  return { store, history, advance, setBpm };
}

describe("history", () => {
  it("steps back and forward through separate edits", () => {
    const { store, history, advance, setBpm } = setup();
    setBpm(100);
    advance(1000);
    setBpm(90);
    expect(history.undo()).toBe(true);
    expect(store.get().bpm).toBe(100);
    expect(history.undo()).toBe(true);
    expect(store.get().bpm).toBe(120);
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(store.get().bpm).toBe(100);
    expect(history.redo()).toBe(true);
    expect(store.get().bpm).toBe(90);
    expect(history.canRedo()).toBe(false);
  });

  it("coalesces rapid edits into one step", () => {
    const { store, history, advance, setBpm } = setup();
    for (let i = 0; i < 20; i++) {
      setBpm(100 + i);
      advance(50);
    }
    history.undo();
    expect(store.get().bpm).toBe(120);
    expect(history.canUndo()).toBe(false);
  });

  it("does not record the changes undo and redo make", () => {
    const { history, advance, setBpm } = setup();
    setBpm(100);
    advance(1000);
    history.undo();
    advance(1000);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it("drops the redo stack on a new edit", () => {
    const { history, advance, setBpm } = setup();
    setBpm(100);
    advance(1000);
    history.undo();
    advance(1000);
    setBpm(80);
    expect(history.canRedo()).toBe(false);
  });

  it("keeps at most 80 steps", () => {
    const { history, advance, setBpm } = setup();
    for (let i = 0; i < 120; i++) {
      advance(1000);
      setBpm(31 + i);
    }
    let steps = 0;
    while (history.undo()) steps += 1;
    expect(steps).toBe(80);
  });

  it("makes one step of a held gesture even when it pauses", () => {
    const { store, history, advance, setBpm } = setup();
    const release = history.hold();
    setBpm(100);
    advance(5000);
    setBpm(90);
    release();
    advance(10);
    setBpm(70);
    history.undo();
    expect(store.get().bpm).toBe(90);
    history.undo();
    expect(store.get().bpm).toBe(120);
  });

  it("ignores instrument sound changes but keeps the live state when stepping back", () => {
    const { store, history, advance, setBpm } = setup();
    store.set((p) => ({
      ...p,
      instruments: [{ id: "s1", kind: "drum80la8", trackId: "t1", state: { kind: "drum80la8", values: { a: 1 } } }],
    }));
    advance(1000);
    store.set((p) => ({ ...p, instruments: p.instruments.map((s) => ({ ...s, state: { ...s.state, values: { a: 2 } } })) }));
    advance(1000);
    setBpm(100);
    history.undo();
    expect(store.get().instruments[0].state.values.a).toBe(2);
    expect(store.get().bpm).toBe(120);
  });

  it("keeps imported assets when undoing and forgets history for another project", () => {
    const { store, history, advance } = setup();
    store.set((p) => ({ ...p, tracks: [], assets: [{ id: "a", kind: "audio", name: "x", mime: "audio/wav", bytes: 1, addedAt: 0 }] }));
    advance(1000);
    store.set((p) => ({ ...p, bpm: 99 }));
    history.undo();
    history.undo();
    expect(store.get().assets).toHaveLength(1);
    store.set(newProject("Other"));
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("always returns to the original after undoing everything", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 30, max: 300 }), { minLength: 1, maxLength: 30 }), (values) => {
        const { store, history, advance, setBpm } = setup();
        const original = store.get().bpm;
        for (const v of values) {
          advance(1000);
          setBpm(v);
        }
        while (history.undo());
        return store.get().bpm === original;
      }),
    );
  });
});

describe("history: instrument slot edits", () => {
  function withSlot() {
    let clockMs = 0;
    const base = newProject();
    const slot = { id: "slot-1", kind: "acid30lee" as const, trackId: "trk-1", state: { kind: "acid30lee" as const, values: {}, data: { patterns: [[0]] } } };
    const store = createStore<Project>({ ...base, instruments: [slot] });
    const history = createHistory(store, { now: () => clockMs });
    const setPattern = (v: number) => store.set((p) => ({ ...p, instruments: p.instruments.map((s) => ({ ...s, state: { ...s.state, data: { patterns: [[v]] } } })) }));
    const pattern = () => (store.get().instruments[0].state.data as { patterns: number[][] }).patterns[0][0];
    return { store, history, setPattern, pattern, advance: (ms: number) => (clockMs += ms) };
  }

  it("leaves plain instrument changes out of undo", () => {
    const { history, setPattern } = withSlot();
    setPattern(1);
    expect(history.canUndo()).toBe(false);
  });

  it("undoes and redoes a recorded slot edit, telling listeners which slots rolled back", () => {
    const { history, setPattern, pattern, advance } = withSlot();
    const seen: string[][] = [];
    history.onSlotsRestored((ids) => seen.push([...ids]));
    history.recordSlots(["slot-1"], () => setPattern(1));
    advance(1000);
    history.recordSlots(["slot-1"], () => setPattern(2));
    expect(history.undo()).toBe(true);
    expect(pattern()).toBe(1);
    expect(history.undo()).toBe(true);
    expect(pattern()).toBe(0);
    expect(history.redo()).toBe(true);
    expect(pattern()).toBe(1);
    expect(history.redo()).toBe(true);
    expect(pattern()).toBe(2);
    expect(seen).toEqual([["slot-1"], ["slot-1"], ["slot-1"], ["slot-1"]]);
  });

  it("keeps a recorded slot edit and a later untracked instrument change apart", () => {
    const { history, setPattern, pattern, advance } = withSlot();
    history.recordSlots(["slot-1"], () => setPattern(1));
    advance(100);
    setPattern(5);
    advance(1000);
    history.recordSlots(["slot-1"], () => setPattern(6));
    history.undo();
    expect(pattern()).toBe(5);
    history.undo();
    expect(pattern()).toBe(0);
  });

  it("joins taps in quick succession into one step", () => {
    const { history, setPattern, pattern, advance } = withSlot();
    history.recordSlots(["slot-1"], () => setPattern(1));
    advance(100);
    history.recordSlots(["slot-1"], () => setPattern(2));
    history.undo();
    expect(pattern()).toBe(0);
    expect(history.canUndo()).toBe(false);
  });
});

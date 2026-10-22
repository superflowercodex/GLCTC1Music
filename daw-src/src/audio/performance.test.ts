import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_EVENTS, parseTake, PerformanceError, PerformanceRecorder, serializeTake, type PerformanceClock, type PerformanceDeps, type PerformanceTarget } from "./performance";

class FakeClock implements PerformanceClock {
  playing = true;
  step = 0;
  private listeners = new Set<(step: number, time: number, dur: number) => void>();
  position(): number {
    return this.step;
  }
  subscribe(l: (step: number, time: number, dur: number) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  tick(step: number): void {
    this.step = step;
    for (const l of this.listeners) l(step, 0, 0.125);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

function rig(): {
  clock: FakeClock;
  deps: PerformanceDeps;
  rec: PerformanceRecorder;
  values: Record<string, number>;
  touch(id: string, value: number): void;
  sets: Array<[string, number]>;
} {
  const clock = new FakeClock();
  const values: Record<string, number> = { "slot-1.cutoff": 0.5, "master.reverb": 0.2 };
  const sets: Array<[string, number]> = [];
  let listener: ((id: string, value: number) => void) | undefined;
  const targets = new Map<string, PerformanceTarget>(
    Object.keys(values).map((id) => [
      id,
      {
        id,
        label: id,
        min: 0,
        max: 1,
        get: () => values[id],
        set: (v: number) => {
          values[id] = v;
          sets.push([id, v]);
          listener?.(id, v);
        },
      },
    ]),
  );
  const deps: PerformanceDeps = {
    clock,
    targets: () => targets,
    watch: (l) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    clock,
    deps,
    rec: new PerformanceRecorder(deps),
    values,
    sets,
    touch: (id, value) => {
      values[id] = value;
      listener?.(id, value);
    },
  };
}

describe("recording", () => {
  it("needs the recorder armed", () => {
    const { rec } = rig();
    expect(() => rec.startLayer()).toThrow(PerformanceError);
  });

  it("stores moves against the transport position and ignores them when stopped", () => {
    const { rec, clock, touch } = rig();
    rec.arm();
    rec.startLayer();
    clock.playing = false;
    touch("slot-1.cutoff", 0.9);
    clock.playing = true;
    clock.step = 8;
    touch("slot-1.cutoff", 0.7);
    rec.stopLayer();
    expect(rec.take(120).events).toEqual([{ beat: 2, target: "slot-1.cutoff", value: 0.7, layer: 1 }]);
    expect(rec.state.get().layers).toBe(1);
  });

  it("collapses a drag inside one 16th into one event with the last value", () => {
    const { rec, clock, touch } = rig();
    rec.arm();
    rec.startLayer();
    clock.step = 4.1;
    for (const v of [0.1, 0.2, 0.3]) touch("master.reverb", v);
    clock.step = 5.2;
    touch("master.reverb", 0.4);
    rec.stopLayer();
    expect(rec.take(120).events.map((e) => e.value)).toEqual([0.3, 0.4]);
  });

  it("ignores controls that are not registered", () => {
    const { rec, touch } = rig();
    rec.arm();
    rec.startLayer();
    touch("bpm", 200);
    touch("#deleteEverything", 1);
    rec.stopLayer();
    expect(rec.take(120).events).toHaveLength(0);
    expect(rec.state.get().layers).toBe(0);
  });

  it("caps the number of events", () => {
    const { rec, clock, touch } = rig();
    rec.arm();
    rec.startLayer();
    for (let i = 0; i < MAX_EVENTS + 50; i++) {
      clock.step = i;
      touch("master.reverb", (i % 100) / 100);
    }
    rec.stopLayer();
    expect(rec.take(120).events.length).toBe(MAX_EVENTS);
  });

  it("layers add up and the last one can be removed", () => {
    const { rec, clock, touch } = rig();
    rec.arm();
    for (const step of [0, 4]) {
      rec.startLayer();
      clock.step = step;
      touch("master.reverb", 0.5);
      rec.stopLayer();
    }
    expect(rec.state.get().layers).toBe(2);
    rec.removeLastLayer();
    expect(rec.take(120).events.map((e) => e.layer)).toEqual([1]);
  });
});

describe("replay", () => {
  function recorded() {
    const r = rig();
    r.rec.arm();
    r.rec.startLayer();
    for (let i = 0; i < 40; i++) {
      r.clock.step = i * 2;
      r.touch("slot-1.cutoff", (i % 10) / 10);
    }
    r.rec.stopLayer();
    r.sets.length = 0;
    return r;
  }

  it("applies each event on exactly its own step, with no drift", () => {
    const { rec, clock, sets } = recorded();
    rec.startReplay();
    const hits: Array<[number, number]> = [];
    for (let step = 0; step < 90; step++) {
      sets.length = 0;
      clock.tick(step);
      for (const [, v] of sets) hits.push([step, v]);
    }
    expect(hits).toHaveLength(40);
    hits.forEach(([step, v], i) => {
      expect(step).toBe(i * 2);
      expect(v).toBeCloseTo((i % 10) / 10, 6);
    });
  });

  it("follows a loop or seek because it works from the step the clock reports", () => {
    const { rec, clock, sets } = recorded();
    rec.startReplay();
    clock.tick(10);
    clock.tick(11);
    clock.tick(10);
    expect(sets.filter(([, v]) => v === 0.5)).toHaveLength(2);
  });

  it("does not replay the layer being recorded, and does not re-record its own playback", () => {
    const { rec, clock } = recorded();
    rec.startReplay();
    rec.startLayer();
    clock.tick(0);
    clock.tick(2);
    rec.stopLayer();
    expect(rec.take(120).events.filter((e) => e.layer === 2)).toHaveLength(0);
  });

  it("stops listening to the clock", () => {
    const { rec, clock } = recorded();
    rec.startReplay();
    rec.startReplay();
    expect(clock.listenerCount).toBe(1);
    rec.stopReplayNow();
    expect(clock.listenerCount).toBe(0);
  });

  it("clamps replayed values into the control's range", () => {
    const { rec, clock, values } = rig();
    rec.load({ v: 1, bpm: 120, layers: 1, events: [{ beat: 0, target: "master.reverb", value: 999, layer: 1 }] });
    rec.startReplay();
    clock.tick(0);
    expect(values["master.reverb"]).toBe(1);
  });
});

describe("imported takes", () => {
  it("only controls registered here can be replayed", () => {
    const { rec, clock, values, sets } = rig();
    const take = parseTake(
      JSON.stringify({
        v: 1,
        bpm: 128,
        events: [
          { beat: 0, target: "master.reverb", value: 0.9, layer: 1 },
          { beat: 0, target: "projectName", value: 1, layer: 1 },
          { beat: 0, target: "exportBtn", value: 1, layer: 1 },
          { beat: 0, target: "slot-9.cutoff", value: 1, layer: 1 },
        ],
      }),
    );
    expect(rec.load(take)).toEqual({ accepted: 1, rejected: 3 });
    rec.startReplay();
    clock.tick(0);
    expect(sets).toEqual([["master.reverb", 0.9]]);
    expect(values["master.reverb"]).toBe(0.9);
  });

  it("anything unknown that gets past load still cannot be applied", () => {
    const { rec, clock, sets } = rig();
    rec.load({ v: 1, bpm: 120, layers: 1, events: [{ beat: 0, target: "master.reverb", value: 0.4, layer: 1 }] });
    // Simulate the control disappearing (its room closed) after the take was loaded.
    const gone = new PerformanceRecorder({ ...rec["deps"], targets: () => new Map() });
    gone["events"] = [{ beat: 0, target: "nothing", value: 1, layer: 1 }];
    gone["reindex"]();
    gone.startReplay();
    clock.tick(0);
    expect(sets).toEqual([]);
    expect(gone.skipped).toBe(1);
  });

  it("round-trips through JSON", () => {
    const { rec, clock, touch } = rig();
    rec.arm();
    rec.startLayer();
    clock.step = 6;
    touch("slot-1.cutoff", 0.25);
    rec.stopLayer();
    const text = serializeTake(rec.take(130));
    const back = parseTake(text);
    expect(back.bpm).toBe(130);
    expect(back.events).toEqual(rec.take(130).events);
  });

  it("rejects malformed files with a message", () => {
    for (const bad of ["not json", "[]", '{"v":2,"events":[]}', '{"v":1}', '{"v":1,"events":[{"beat":-1,"target":"a","value":1}]}', '{"v":1,"events":[{"beat":1,"target":"a b","value":1}]}', '{"v":1,"events":[{"beat":1,"target":"a","value":"x"}]}', '{"v":1,"events":[{"beat":1,"target":"a","value":1,"layer":1.5}]}']) {
      expect(() => parseTake(bad)).toThrow(PerformanceError);
    }
  });

  it("rejects takes with too many events and clamps tempo", () => {
    const many = { v: 1, events: Array.from({ length: MAX_EVENTS + 1 }, () => ({ beat: 0, target: "a", value: 0 })) };
    expect(() => parseTake(JSON.stringify(many))).toThrow(PerformanceError);
    expect(parseTake('{"v":1,"bpm":9999,"events":[]}').bpm).toBe(300);
  });

  it("fuzz: parseTake either returns a valid take or throws PerformanceError", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        try {
          const take = parseTake(JSON.stringify(value));
          return take.events.every((e) => Number.isFinite(e.beat) && e.beat >= 0 && typeof e.target === "string" && Number.isFinite(e.value));
        } catch (err) {
          return err instanceof PerformanceError;
        }
      }),
    );
  });
});

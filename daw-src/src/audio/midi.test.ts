import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { MidiBindings, MidiError, MidiRouter, MidiService, parseMidiMessage, registerInstrumentTargets, type BindingPersistence, type MidiBinding, type MidiTarget } from "./midi";
import type { Instrument, ParamDef } from "./types";

function memory(initial: unknown = [], failWrites = false): BindingPersistence & { saved: MidiBinding[][] } {
  const saved: MidiBinding[][] = [];
  return {
    saved,
    load: () => initial,
    save: (b) => {
      if (failWrites) return false;
      saved.push(b);
      return true;
    },
  };
}

function rangeTarget(id = "synth.cutoff"): MidiTarget & { value: number } {
  const t = { id, label: `Label ${id}`, kind: "range" as const, value: -1, set(n: number) { t.value = n; } };
  return t;
}

const cc = (n: number, v: number, ch = 0): number[] => [0xb0 | ch, n, v];
const noteOn = (n: number, v = 100, ch = 0): number[] => [0x90 | ch, n, v];
const noteOff = (n: number, ch = 0): number[] => [0x80 | ch, n, 0];

describe("parseMidiMessage", () => {
  it("reads notes, controllers and all-notes-off", () => {
    expect(parseMidiMessage(noteOn(60, 127, 2))).toEqual({ type: "noteOn", note: 60, velocity: 1, channel: 2 });
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: "noteOff", note: 60, channel: 0 });
    expect(parseMidiMessage(noteOff(61))).toEqual({ type: "noteOff", note: 61, channel: 0 });
    expect(parseMidiMessage(cc(74, 127))).toEqual({ type: "cc", controller: 74, value: 1, channel: 0 });
    expect(parseMidiMessage(cc(123, 0))).toEqual({ type: "allNotesOff" });
    expect(parseMidiMessage([0xe0, 1, 2])).toBeNull();
  });
});

describe("binding store", () => {
  it("binds, lists, renames and clears, saving under the injected store each time", () => {
    const mem = memory();
    const b = new MidiBindings(mem);
    const bound = b.bind({ id: "t1", label: "Synth · Cutoff" }, { kind: "cc", number: 74, channel: 0 });
    expect(b.list()).toEqual([bound]);
    expect(bound.name).toBe("Synth · Cutoff");
    b.rename(bound.id, "  Filter knob ");
    expect(b.list()[0]?.name).toBe("Filter knob");
    expect(() => b.rename(bound.id, "  ")).toThrow(MidiError);
    b.clear(bound.id);
    expect(b.list()).toEqual([]);
    expect(mem.saved.length).toBe(3);
  });

  it("a controller drives one parameter and a parameter listens to one controller", () => {
    const b = new MidiBindings(memory());
    b.bind({ id: "a", label: "A" }, { kind: "cc", number: 1, channel: 0 });
    b.bind({ id: "b", label: "B" }, { kind: "cc", number: 1, channel: 0 });
    expect(b.list().map((x) => x.targetId)).toEqual(["b"]);
    b.bind({ id: "b", label: "B" }, { kind: "cc", number: 2, channel: 0 });
    expect(b.list().map((x) => x.number)).toEqual([2]);
  });

  it("keeps a renamed link's name when the control is re-learned", () => {
    const b = new MidiBindings(memory());
    const first = b.bind({ id: "a", label: "A" }, { kind: "cc", number: 1, channel: 0 });
    b.rename(first.id, "Mine");
    expect(b.bind({ id: "a", label: "A" }, { kind: "cc", number: 9, channel: 0 }).name).toBe("Mine");
  });

  it("loads saved bindings, ignoring damaged entries", () => {
    const good: MidiBinding = { id: "x", targetId: "t", name: "n", kind: "note", number: 36, channel: 1 };
    const b = new MidiBindings(memory([good, { id: 1 }, null, "junk"]));
    expect(b.list()).toEqual([good]);
    expect(new MidiBindings(memory("not a list")).list()).toEqual([]);
  });

  it("reports when the browser would not store them", () => {
    const b = new MidiBindings(memory([], true));
    b.bind({ id: "a", label: "A" }, { kind: "cc", number: 1, channel: 0 });
    expect(b.store.get().saveError).toMatch(/would not store/);
    expect(b.list()).toHaveLength(1);
  });

  it("clears everything", () => {
    const b = new MidiBindings(memory());
    b.bind({ id: "a", label: "A" }, { kind: "cc", number: 1, channel: 0 });
    b.bind({ id: "b", label: "B" }, { kind: "cc", number: 2, channel: 0 });
    b.clearAll();
    expect(b.list()).toEqual([]);
  });
});

describe("router and MIDI learn", () => {
  it("binds the next controller moved while learn is armed, then drives the parameter", () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    const t = rangeTarget();
    router.registerTarget(t);
    router.startLearn(t.id);
    expect(router.learn.get().targetId).toBe(t.id);

    router.handle(noteOff(60));
    expect(router.learn.get().targetId).toBe(t.id);

    router.handle(cc(74, 64));
    expect(router.learn.get().targetId).toBeNull();
    expect(router.bindings.list()).toMatchObject([{ targetId: t.id, kind: "cc", number: 74 }]);
    expect(t.value).toBe(-1);

    router.handle(cc(74, 127));
    expect(t.value).toBe(1);
    router.handle(cc(74, 0));
    expect(t.value).toBe(0);
    router.handle(cc(75, 127));
    expect(t.value).toBe(0);
  });

  it("matches the channel as well as the number", () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    const t = rangeTarget();
    router.registerTarget(t);
    router.startLearn(t.id);
    router.handle(cc(7, 10, 3));
    router.handle(cc(7, 127, 0));
    expect(t.value).toBe(-1);
    router.handle(cc(7, 127, 3));
    expect(t.value).toBe(1);
  });

  it("a cleared binding stops responding", () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    const t = rangeTarget();
    router.registerTarget(t);
    router.startLearn(t.id);
    router.handle(cc(1, 5));
    router.bindings.clear(router.bindings.list()[0]?.id ?? "");
    router.handle(cc(1, 127));
    expect(t.value).toBe(-1);
  });

  it("notes flip toggles and fire triggers; releases do nothing", () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    let on = 0;
    const toggle: MidiTarget = { id: "tg", label: "Toggle", kind: "toggle", set: (n) => (on = n), get: () => on };
    const hits = vi.fn();
    const trigger: MidiTarget = { id: "tr", label: "Trigger", kind: "trigger", set: hits };
    router.registerTarget(toggle);
    router.registerTarget(trigger);
    router.startLearn("tg");
    router.handle(noteOn(36));
    router.startLearn("tr");
    router.handle(noteOn(37));
    router.handle(noteOn(36));
    expect(on).toBe(1);
    router.handle(noteOff(36));
    expect(on).toBe(1);
    router.handle(noteOn(36));
    expect(on).toBe(0);
    router.handle(noteOn(37));
    expect(hits).toHaveBeenCalledWith(1);
  });

  it("unbound input goes to listeners, bound input does not", () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    const t = rangeTarget();
    router.registerTarget(t);
    const heard = vi.fn();
    router.onUnclaimed(heard);
    router.handle(noteOn(60));
    expect(heard).toHaveBeenCalledTimes(1);
    router.startLearn(t.id);
    router.handle(cc(5, 1));
    router.handle(cc(5, 100));
    expect(heard).toHaveBeenCalledTimes(1);
    router.handle(cc(123, 0));
    expect(heard).toHaveBeenLastCalledWith({ type: "allNotesOff" });
  });

  it("refuses to learn a control that is not registered and can cancel", () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    expect(() => router.startLearn("nope")).toThrow(MidiError);
    router.registerTarget(rangeTarget());
    router.startLearn("synth.cutoff");
    router.cancelLearn();
    expect(router.learn.get().targetId).toBeNull();
  });

  it("a binding to a control that is not on screen is kept but inert", () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    const t = rangeTarget();
    const off = router.registerTarget(t);
    router.startLearn(t.id);
    router.handle(cc(9, 1));
    off();
    router.handle(cc(9, 127));
    expect(t.value).toBe(-1);
    expect(router.bindings.list()).toHaveLength(1);
  });

  it("any controller value maps into 0..1 (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 127 }), (v) => {
        const router = new MidiRouter(new MidiBindings(memory()));
        const t = rangeTarget();
        router.registerTarget(t);
        router.startLearn(t.id);
        router.handle(cc(1, 1));
        router.handle(cc(1, v));
        expect(t.value).toBeGreaterThanOrEqual(0);
        expect(t.value).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("instrument parameters as targets", () => {
  it("maps 0..1 onto each parameter's range, step and options", () => {
    const params: ParamDef[] = [
      { id: "cut", label: "Cutoff", group: "F", min: 100, max: 200, step: 10, def: 100 },
      { id: "wave", label: "Wave", group: "O", min: 0, max: 3, def: 0, options: ["a", "b", "c", "d"] },
    ];
    const values: Record<string, number> = { cut: 100, wave: 0 };
    const instrument = { kind: "acid30lee", params, setParam: (id: string, v: number) => (values[id] = v), getParam: (id: string) => values[id] ?? 0 } as unknown as Instrument;
    const router = new MidiRouter(new MidiBindings(memory()));
    const remove = registerInstrumentTargets(router, "30LEE", instrument);
    expect(router.targets.get().map((t) => t.label)).toEqual(["30LEE · Cutoff", "30LEE · Wave"]);
    router.getTarget("acid30lee.cut")?.set(0.52);
    expect(values.cut).toBe(150);
    router.getTarget("acid30lee.wave")?.set(0.4);
    expect(values.wave).toBe(1);
    expect(router.getTarget("acid30lee.cut")?.get?.()).toBeCloseTo(0.5);
    remove();
    expect(router.targets.get()).toHaveLength(0);
  });
});

describe("MidiService", () => {
  it("says so plainly when the browser has no Web MIDI", () => {
    const service = new MidiService(new MidiRouter(new MidiBindings(memory())), undefined);
    expect(service.supported).toBe(false);
    expect(service.state.get().status).toBe("unsupported");
  });

  it("lists connected devices and routes their messages", async () => {
    const router = new MidiRouter(new MidiBindings(memory()));
    const input = { id: "i1", name: "Keys", manufacturer: "Acme", state: "connected", onmidimessage: null as ((e: { data: Uint8Array }) => void) | null };
    const access = { inputs: new Map([["i1", input]]), onstatechange: null };
    const service = new MidiService(router, async () => access as unknown as MIDIAccess);
    await service.enable();
    expect(service.state.get()).toMatchObject({ status: "ready", devices: [{ id: "i1", name: "Keys", manufacturer: "Acme" }] });
    const heard = vi.fn();
    router.onUnclaimed(heard);
    input.onmidimessage?.({ data: new Uint8Array(noteOn(60)) });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("explains a blocked permission", async () => {
    const service = new MidiService(new MidiRouter(new MidiBindings(memory())), async () => {
      throw new DOMException("no", "SecurityError");
    });
    await service.enable();
    expect(service.state.get().status).toBe("denied");
    expect(service.state.get().error).toMatch(/blocked/);
  });

  it("shows other failures with their reason", async () => {
    const service = new MidiService(new MidiRouter(new MidiBindings(memory())), async () => {
      throw new Error("driver crashed");
    });
    await service.enable();
    expect(service.state.get()).toMatchObject({ status: "error", error: "MIDI could not start: driver crashed" });
  });
});

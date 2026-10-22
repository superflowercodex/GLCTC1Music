import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProject } from "./model";
import { removeTrack } from "./actions";

const fake = vi.hoisted(() => ({
  created: 0,
  attached: new Map<string, { trackId: string; instrument: unknown }>(),
  detachCalls: [] as string[],
  removedBuses: [] as string[],
}));

vi.mock("../audio/instruments/registry", () => ({
  instrumentInfo: () => ({
    name: "Drums",
    color: "#fff",
    create: async () => {
      const id = ++fake.created;
      return { id, serialize: () => ({}), restore: () => undefined, subscribe: () => () => undefined, dispose: vi.fn(), params: [] };
    },
  }),
}));
vi.mock("../audio/midi", () => ({ midiRouter: {}, registerInstrumentTargets: () => () => undefined }));
vi.mock("../audio/engine", () => ({
  getEngine: () => ({
    ctx: {},
    attachInstrument: (slotId: string, instrument: unknown, trackId: string) => fake.attached.set(slotId, { trackId, instrument }),
    detachInstrument: (slotId: string) => {
      fake.detachCalls.push(slotId);
      fake.attached.delete(slotId);
    },
    removeBus: (id: string) => fake.removedBuses.push(id),
  }),
}));

import { projectStore } from "../store/project";
import { ensureInstrument, releaseAllInstruments } from "./instruments";

describe("ensureInstrument", () => {
  beforeEach(async () => {
    await releaseAllInstruments();
    fake.created = 0;
    fake.attached.clear();
    fake.detachCalls.length = 0;
    fake.removedBuses.length = 0;
    projectStore.set(newProject());
  });

  it("returns the same instance while its track exists", async () => {
    const a = await ensureInstrument("drum80la8");
    expect(await ensureInstrument("drum80la8")).toBe(a);
    expect(fake.created).toBe(1);
  });

  it("builds a fresh instrument on the new track after the old track is deleted", async () => {
    const first = await ensureInstrument("drum80la8");
    const oldSlot = projectStore.get().instruments[0];
    projectStore.set((p) => removeTrack(p, oldSlot.trackId));

    const second = await ensureInstrument("drum80la8");
    expect(second).not.toBe(first);
    expect((first as unknown as { dispose: { mock: unknown } }).dispose).toHaveBeenCalled();
    expect(fake.detachCalls).toContain(oldSlot.id);
    expect(fake.removedBuses).toContain(oldSlot.trackId);

    const p = projectStore.get();
    expect(p.instruments).toHaveLength(1);
    const slot = p.instruments[0];
    expect(slot.id).not.toBe(oldSlot.id);
    expect(p.tracks.some((t) => t.id === slot.trackId)).toBe(true);
    expect([...fake.attached.keys()]).toEqual([slot.id]);
    expect(fake.attached.get(slot.id)?.trackId).toBe(slot.trackId);
    expect(fake.attached.get(slot.id)?.instrument).toBe(second);
  });
});

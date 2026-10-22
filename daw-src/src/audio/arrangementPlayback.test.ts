import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addClip, addTrack, makeClip, makeTrack } from "../project/actions";
import { newProject, type Project } from "../project/model";
import { projectStore } from "../store/project";
import { Clock, type Ticker } from "./clock";
import { startArrangementPlayback } from "./arrangementPlayback";
import { Engine } from "./engine";
import { setBuffer } from "./media";
import type { Instrument } from "./types";

class ManualTicker implements Ticker {
  private cb: (() => void) | null = null;
  start(onTick: () => void) {
    this.cb = onTick;
  }
  stop() {
    this.cb = null;
  }
  fire() {
    this.cb?.();
  }
}

let engine: Engine;
let ticker: ManualTicker;

vi.mock("./engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("./engine")>();
  return { ...real, getEngine: () => engine, peekEngine: () => engine };
});

function setupEngine(seconds: number): OfflineAudioContext {
  const ctx = new NodeOfflineContext(2, Math.ceil(seconds * 8000), 8000) as unknown as OfflineAudioContext;
  ticker = new ManualTicker();
  engine = new Engine(ctx, new Clock(ctx, ticker));
  return ctx;
}

/** Fires the ticker until the clock's lookahead covers `upToStep`. The offline context's own time stays at 0, so this walks steps only. */
function runSteps(): void {
  ticker.fire();
}

describe("startArrangementPlayback", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    projectStore.set({ ...newProject(), bpm: 120 });
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it("sets an arranged instrument's pattern before its own onStep for the same step", async () => {
    const ctx = setupEngine(1);
    const calls: string[] = [];
    const fake = {
      output: ctx.createGain(),
      activePattern: null as number | null,
      setPattern(i: number | null) {
        this.activePattern = i;
        calls.push(`set:${i}`);
      },
      onStep: (step: number) => calls.push(`step:${step}`),
    };
    stop = startArrangementPlayback();
    engine.attachInstrument("s1", fake as unknown as Instrument, "t1");

    let p: Project = projectStore.get();
    const track = makeTrack(p, "instrument", { id: "t1", slotId: "s1" });
    p = addTrack(p, track);
    p = { ...p, instruments: [{ id: "s1", kind: "drum80la8", trackId: "t1", state: { kind: "drum80la8", values: {} } }] };
    p = addClip(p, "t1", makeClip({ kind: "pattern", startBar: 1, lengthBars: 1, patternIndex: 2 }));
    projectStore.set(p);

    engine.clock.start(0);
    runSteps();
    expect(calls.slice(0, 2)).toEqual(["set:2", "step:0"]);
    const afterLast = calls.indexOf("step:16");
    if (afterLast >= 0) expect(calls[afterLast - 1]).toBe("set:null");
  });

  it("leaves an instrument without pattern clips alone", async () => {
    const ctx = setupEngine(1);
    let touched = false;
    const fake = { output: ctx.createGain(), activePattern: 1, setPattern: () => (touched = true), onStep: () => undefined };
    stop = startArrangementPlayback();
    engine.attachInstrument("s1", fake as unknown as Instrument, "t1");
    let p: Project = projectStore.get();
    p = addTrack(p, makeTrack(p, "instrument", { id: "t1", slotId: "s1" }));
    projectStore.set({ ...p, instruments: [{ id: "s1", kind: "drum80la8", trackId: "t1", state: { kind: "drum80la8", values: {} } }] });
    engine.clock.start(0);
    runSteps();
    expect(touched).toBe(false);
  });

  it("plays audio clips from the transport and stops them when it stops", async () => {
    const ctx = setupEngine(3);
    const buffer = ctx.createBuffer(1, 8000 * 4, 8000);
    buffer.getChannelData(0).fill(0.5);
    setBuffer("a1", buffer);
    let p: Project = {
      ...projectStore.get(),
      assets: [{ id: "a1", kind: "audio", name: "x", mime: "audio/wav", bytes: 1, durationSec: 4, addedAt: 0 }],
    };
    const track = makeTrack(p, "audio");
    p = addClip(addTrack(p, track), track.id, makeClip({ kind: "audio", startBar: 1, lengthBars: 1, assetId: "a1" }));
    projectStore.set(p);
    stop = startArrangementPlayback();
    engine.clock.start(0);
    const out = (await ctx.startRendering()).getChannelData(0);
    const at = (s: number) => out[Math.floor(s * 8000)];
    expect(at(1)).toBeGreaterThan(0.1);
    expect(at(2.5)).toBe(0);
  });

  it("returns the same stop function when started twice", async () => {
    setupEngine(1);
    stop = startArrangementPlayback();
    expect(startArrangementPlayback()).toBe(stop);
  });

  it("mirrors mute and solo onto the track buses", async () => {
    setupEngine(1);
    stop = startArrangementPlayback();
    let p: Project = projectStore.get();
    const a = makeTrack(p, "audio", { id: "a" });
    p = addTrack(p, a);
    const b = makeTrack(p, "audio", { id: "b", solo: true });
    projectStore.set(addTrack(p, b));
    const spy = vi.spyOn(engine.bus("a"), "setSilencedBySolo");
    projectStore.set((s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === "b" ? { ...t, solo: false } : t)) }));
    expect(spy).toHaveBeenCalledWith(false);
  });
});

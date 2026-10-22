import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bounceInstrument, measure } from "./bounce";
import { InstrumentBase } from "./instrument";
import type { ParamDef, Preset } from "./types";

const PARAMS: readonly ParamDef[] = [
  { id: "level", label: "Level", group: "Output", min: 0, max: 1, def: 0.5 },
  { id: "wave", label: "Wave", group: "Tone", min: 0, max: 2, def: 0, options: ["Sine", "Saw", "Square"] },
];
const PRESETS: readonly Preset[] = [{ id: "loud", name: "Loud", category: "Test", factory: true, values: { level: 1, wave: 1 } }];

// A tiny instrument that plays a short blip on every step, enough to prove the plumbing.
class Blip extends InstrumentBase {
  readonly kind = "drum80la8" as const;
  constructor(ctx: BaseAudioContext) {
    super(ctx, PARAMS, PRESETS, "test-blip");
  }
  protected onParam(id: string, value: number): void {
    if (id === "level") this.output.gain.value = value;
  }
  override onStep(_step: number, time: number): void {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = 220;
    osc.connect(this.output);
    osc.start(time);
    osc.stop(time + 0.05);
  }
}

const offline = NodeOfflineContext as unknown as new (c: number, l: number, s: number) => OfflineAudioContext;
const make = (ctx: BaseAudioContext) => new Blip(ctx);

describe("InstrumentBase", () => {
  it("clamps parameters to their range and rounds option indices", () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), (value) => {
        const inst = new Blip(new NodeOfflineContext(2, 128, 44100) as unknown as BaseAudioContext);
        inst.setParam("level", value);
        inst.setParam("wave", value);
        return inst.getParam("level") >= 0 && inst.getParam("level") <= 1 && Number.isInteger(inst.getParam("wave"));
      }),
    );
  });

  it("rejects unknown parameters instead of ignoring them", () => {
    const inst = new Blip(new NodeOfflineContext(2, 128, 44100) as unknown as BaseAudioContext);
    expect(() => inst.setParam("nope", 1)).toThrow(RangeError);
    expect(() => inst.getParam("nope")).toThrow(RangeError);
  });

  it("loads a preset and notifies listeners", () => {
    const inst = new Blip(new NodeOfflineContext(2, 128, 44100) as unknown as BaseAudioContext);
    let calls = 0;
    inst.subscribe(() => (calls += 1));
    inst.loadPreset("loud");
    expect(inst.getParam("level")).toBe(1);
    expect(inst.getParam("wave")).toBe(1);
    expect(inst.serialize().presetId).toBe("loud");
    expect(calls).toBe(1);
  });

  it("round-trips through serialize and restore", () => {
    const a = new Blip(new NodeOfflineContext(2, 128, 44100) as unknown as BaseAudioContext);
    a.setParam("level", 0.25);
    a.setParam("wave", 2);
    const b = new Blip(new NodeOfflineContext(2, 128, 44100) as unknown as BaseAudioContext);
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.getParam("level")).toBe(0.25);
    expect(b.getParam("wave")).toBe(2);
  });
});

describe("bounceInstrument", () => {
  it("renders the pattern to real audio at the right length", async () => {
    const inst = new Blip(new NodeOfflineContext(2, 128, 44100) as unknown as BaseAudioContext);
    inst.setParam("level", 0.8);
    const buffer = await bounceInstrument(make, inst.serialize(), { bars: 1, bpm: 120, offlineContext: offline, tailSeconds: 0.5 });
    expect(buffer.duration).toBeCloseTo(2.5, 2);
    const { peak, rms } = measure(buffer);
    expect(peak).toBeGreaterThan(0.1);
    expect(rms).toBeGreaterThan(0.01);
  });

  it("renders silence when the level is zero", async () => {
    const inst = new Blip(new NodeOfflineContext(2, 128, 44100) as unknown as BaseAudioContext);
    inst.setParam("level", 0);
    const buffer = await bounceInstrument(make, inst.serialize(), { bars: 1, bpm: 120, offlineContext: offline, tailSeconds: 0.2 });
    expect(measure(buffer).peak).toBe(0);
  });
});

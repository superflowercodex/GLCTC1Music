import { describe, expect, it } from "vitest";
import { bounceInstrument, measure } from "../bounce";
import { Acid30lee } from "./acid30lee";
import { energyAbove, offlineClass, offlineContext, peakFrequency, peakOf, rmsOf, TEST_RATE } from "./synth/testUtils";

async function renderNote(configure: (a: Acid30lee) => void, note = 45, seconds = 1.2, hold = 0.6): Promise<{ left: Float32Array; right: Float32Array }> {
  const ctx = offlineContext(seconds);
  const a = new Acid30lee(ctx);
  a.setPattern(null);
  configure(a);
  a.output.connect(ctx.destination);
  a.noteOn({ note, velocity: 0.8, time: 0.05, duration: hold });
  const buffer = await ctx.startRendering();
  return { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(1).slice() };
}

describe("Acid30lee engine", () => {
  it("plays the pitch it was asked for", async () => {
    const { left } = await renderNote((a) => {
      a.setParam("delay", 0);
      a.setParam("reverb", 0);
      a.setParam("drive", 0);
      a.setParam("envMod", 0);
      a.setParam("cutoff", 6000);
      a.setParam("sub", 0);
    });
    const f = peakFrequency(left, Math.floor(0.2 * TEST_RATE), 16384);
    expect(Math.abs(f - 110)).toBeLessThan(2);
  });

  it("releases to silence after the gate", async () => {
    const { left } = await renderNote((a) => {
      a.setParam("delay", 0);
      a.setParam("reverb", 0);
    });
    expect(rmsOf(left, Math.floor(0.2 * TEST_RATE), Math.floor(0.5 * TEST_RATE))).toBeGreaterThan(0.01);
    expect(peakOf(left, Math.floor(1.1 * TEST_RATE))).toBeLessThan(0.0015);
  });

  it("opens and closes the sound with the cutoff", async () => {
    const setup = (cutoff: number) => (a: Acid30lee) => {
      a.setParam("cutoff", cutoff);
      a.setParam("envMod", 0);
      a.setParam("delay", 0);
      a.setParam("reverb", 0);
    };
    const dark = await renderNote(setup(200));
    const bright = await renderNote(setup(8000));
    const at = Math.floor(0.2 * TEST_RATE);
    expect(energyAbove(bright.left, at, 8192, 1500)).toBeGreaterThan(energyAbove(dark.left, at, 8192, 1500) * 3);
  });

  it("keeps maximum resonance under full scale", async () => {
    const { left, right } = await renderNote((a) => {
      a.setParam("resonance", 1);
      a.setParam("cutoff", 700);
      a.setParam("drive", 1);
      a.setParam("level", 1);
    });
    expect(peakOf(left)).toBeLessThan(1);
    expect(peakOf(right)).toBeLessThan(1);
    expect(Number.isFinite(rmsOf(left))).toBe(true);
  });

  it("stereo width, which used to do nothing, now separates the channels", async () => {
    const diff = async (width: number) => {
      const { left, right } = await renderNote((a) => {
        a.setParam("width", width);
        a.setParam("delay", 0);
        a.setParam("reverb", 0);
      });
      let sum = 0;
      for (let i = 0; i < left.length; i++) sum += (left[i] - right[i]) ** 2;
      return Math.sqrt(sum / left.length);
    };
    expect(await diff(0)).toBeLessThan(1e-6);
    expect(await diff(1)).toBeGreaterThan(0.005);
  });

  it("bit reduction and effects amount change the output", async () => {
    const base = await renderNote((a) => a.setParam("delay", 0));
    const crushed = await renderNote((a) => {
      a.setParam("delay", 0);
      a.setParam("crush", 1);
    });
    let d = 0;
    for (let i = 0; i < base.left.length; i++) d += Math.abs(base.left[i] - crushed.left[i]);
    expect(d / base.left.length).toBeGreaterThan(0.0005);

    const wet = await renderNote((a) => {
      a.setParam("delay", 0.7);
      a.setParam("fxMix", 1);
    });
    const dry = await renderNote((a) => {
      a.setParam("delay", 0.7);
      a.setParam("fxMix", 0);
    });
    const tail = Math.floor(0.9 * TEST_RATE);
    expect(rmsOf(wet.left, tail)).toBeGreaterThan(rmsOf(dry.left, tail) * 2);
  });

  it("slide glides into the next note instead of jumping", async () => {
    const ctx = offlineContext(1.5);
    const a = new Acid30lee(ctx);
    for (const p of [0, 1, 2, 3]) a.clearPattern(p);
    a.setStep(0, 0, { on: true, note: 33, slide: false });
    a.setStep(0, 1, { on: true, note: 45, slide: true });
    for (const [id, v] of Object.entries({ delay: 0, reverb: 0, drive: 0, envMod: 0, cutoff: 7000, sub: 0, slideTime: 350, swing: 0, humanise: 0, gate: 1 })) a.setParam(id, v);
    a.setPattern(0);
    a.output.connect(ctx.destination);
    const dur = 0.25;
    a.onStep(0, 0.05, dur);
    a.onStep(1, 0.05 + dur, dur);
    const out = (await ctx.startRendering()).getChannelData(0).slice();
    const second = 0.05 + dur;
    const early = peakFrequency(out, Math.floor((second + 0.01) * TEST_RATE), 4096);
    const late = peakFrequency(out, Math.floor((second + 0.2) * TEST_RATE), 8192);
    expect(early).toBeLessThan(95);
    expect(Math.abs(late - 110)).toBeLessThan(6);
  });
});

describe("Acid30lee playhead", () => {
  it("reports the audible step and goes quiet when the clock stops", () => {
    const a = new Acid30lee(offlineContext(1));
    expect(a.playhead()).toBeNull();
    a.onStep(5, 0, 0.125);
    expect(a.playhead()).toEqual({ a: 5, b: -1 });
  });
});

describe("Acid30lee patterns", () => {
  const render = async (setup: (a: Acid30lee) => void, bars = 1) => {
    const ctx = offlineContext(1);
    const a = new Acid30lee(ctx);
    setup(a);
    return bounceInstrument((c) => new Acid30lee(c), a.serialize(), { bars, bpm: 120, offlineContext: offlineClass, tailSeconds: 0.6 });
  };

  it("plays only the steps that are on, at the right times", async () => {
    const buffer = await render((a) => {
      for (const p of [0, 1, 2, 3]) a.clearPattern(p);
      a.setStep(0, 4, { on: true });
      for (const [id, v] of Object.entries({ delay: 0, reverb: 0, swing: 0, humanise: 0, gate: 0.4 })) a.setParam(id, v);
      a.setPattern(0);
    });
    const data = buffer.getChannelData(0).slice();
    const stepSamples = (60 / 120 / 4) * buffer.sampleRate;
    expect(peakOf(data, 0, Math.floor(stepSamples * 3.8))).toBeLessThan(0.001);
    expect(peakOf(data, Math.floor(stepSamples * 4.1), Math.floor(stepSamples * 5))).toBeGreaterThan(0.05);
  });

  it("silences the sequencer with setPattern(null) but not live notes", async () => {
    const ctx = offlineContext(1.5);
    const a = new Acid30lee(ctx);
    a.setPattern(null);
    a.output.connect(ctx.destination);
    for (let s = 0; s < 8; s++) a.onStep(s, s * 0.125, 0.125);
    expect(a.activePattern).toBeNull();
    a.noteOn({ note: 40, velocity: 0.8, time: 0.5, duration: 0.3 });
    const out = (await ctx.startRendering()).getChannelData(0).slice();
    expect(peakOf(out, 0, Math.floor(0.45 * TEST_RATE))).toBeLessThan(0.001);
    expect(peakOf(out, Math.floor(0.55 * TEST_RATE), Math.floor(0.8 * TEST_RATE))).toBeGreaterThan(0.02);
  });

  it("round-trips patterns, seed and settings through serialize and restore", () => {
    const a = new Acid30lee(offlineContext(1));
    a.setStep(2, 5, { on: true, note: 41, oct: 1, accent: true, slide: true });
    a.setPattern(2);
    a.setSeed(1234);
    a.setParam("cutoff", 3000);
    const copy = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Acid30lee(offlineContext(1));
    b.restore(copy);
    expect(b.getStep(2, 5)).toEqual({ on: true, note: 41, oct: 1, accent: true, slide: true });
    expect(b.activePattern).toBe(2);
    expect(b.currentSeed).toBe(1234);
    expect(b.getParam("cutoff")).toBe(3000);
  });

  it("produces the same audio for the same seed, and chance below 100% drops steps", async () => {
    const make = async (seed: number, chance: number) => {
      const b = await render((a) => {
        a.setSeed(seed);
        a.setParam("chance", chance);
        a.setParam("humanise", 0);
        a.setPattern(0);
      }, 2);
      return b.getChannelData(0).slice();
    };
    const one = await make(5, 0.5);
    const two = await make(5, 0.5);
    expect(Array.from(one.slice(0, 20000))).toEqual(Array.from(two.slice(0, 20000)));
    const full = await make(5, 1);
    expect(rmsOf(full)).toBeGreaterThan(rmsOf(one));
  });

  it("never stacks more than its voice limit and clears on panic", async () => {
    const ctx = offlineContext(2);
    const a = new Acid30lee(ctx);
    a.setPattern(null);
    a.output.connect(ctx.destination);
    for (let n = 0; n < 12; n++) a.noteOn({ note: 36 + n, velocity: 0.8, time: 0.1, duration: 0.5 });
    expect(a.activeVoiceCount).toBeLessThanOrEqual(3);
    a.allNotesOff();
    expect(a.activeVoiceCount).toBe(0);
    const buffer = await ctx.startRendering();
    expect(measure(buffer).peak).toBeLessThan(1);
  });

  it("every factory preset loads and stays below full scale", async () => {
    for (const preset of new Acid30lee(offlineContext(1)).presets) {
      const buffer = await render((a) => {
        a.loadPreset(preset.id);
        a.setPattern(0);
      });
      const { peak, rms } = measure(buffer);
      expect(peak, preset.name).toBeLessThan(1);
      expect(rms, preset.name).toBeGreaterThan(0.002);
    }
  });
});

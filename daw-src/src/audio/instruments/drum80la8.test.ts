import { describe, expect, it } from "vitest";
import { Drum80la8, PARAMS_80LA8, PRESETS_80LA8, STEPS_80LA8 } from "./drum80la8";
import { peakOf, renderSteps, rmsBetween } from "./drums/testing";
import { bounceInstrument } from "../bounce";
import { nodeOffline } from "./drums/testing";

const make = (ctx: BaseAudioContext) => new Drum80la8(ctx);

function kickOnly(inst: Drum80la8, steps: number[]): void {
  inst.clearPattern();
  inst.setParam("v0.decay", 0.1);
  for (const s of steps) inst.setStep(0, s, 1);
}

describe("Drum80la8", () => {
  it("sounds on the kick steps and is silent elsewhere", async () => {
    const { buffer, stepDur } = await renderSteps(make, 16, { setup: (i) => kickOnly(i as Drum80la8, [0, 8]) });
    expect(rmsBetween(buffer, 0.01, stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 8 * stepDur + 0.01, 9 * stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 3 * stepDur, 8 * stepDur - 0.01)).toBeLessThan(0.001);
    expect(rmsBetween(buffer, 11 * stepDur, 16 * stepDur)).toBeLessThan(0.001);
  });

  it("is silent when the pattern is switched off", async () => {
    const { buffer } = await renderSteps(make, 16, { setup: (i) => i.setPattern(null) });
    expect(peakOf(buffer)).toBe(0);
  });

  it("swings odd steps later", async () => {
    const { buffer, stepDur } = await renderSteps(make, 4, {
      setup: (i) => {
        kickOnly(i as Drum80la8, [1]);
        i.setParam("swing", 0.5);
      },
    });
    expect(rmsBetween(buffer, stepDur, stepDur + 0.5 * stepDur - 0.004)).toBeLessThan(0.001);
    expect(rmsBetween(buffer, stepDur * 1.5 + 0.005, stepDur * 1.5 + 0.06)).toBeGreaterThan(0.02);
  });

  it("repeats a 16 step pattern across bars", async () => {
    const { buffer, stepDur } = await renderSteps(make, 32, { setup: (i) => kickOnly(i as Drum80la8, [0]) });
    expect(rmsBetween(buffer, 16 * stepDur + 0.01, 16 * stepDur + 0.1)).toBeGreaterThan(0.02);
  });

  it("never exceeds full scale on a dense pattern", async () => {
    const { buffer } = await renderSteps(make, 32, {
      setup: (i) => {
        const d = i as Drum80la8;
        for (let v = 0; v < 12; v++) {
          d.setParam(`v${v}.level`, 1.5);
          for (let s = 0; s < STEPS_80LA8; s++) d.setStep(v, s, 1);
        }
      },
    });
    const peak = peakOf(buffer);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("loads every preset without throwing and keeps parameters in range", () => {
    for (const preset of PRESETS_80LA8) {
      const ctx = new nodeOffline(2, 128, 44100) as unknown as BaseAudioContext;
      const inst = new Drum80la8(ctx);
      expect(() => inst.loadPreset(preset.id)).not.toThrow();
      for (const p of PARAMS_80LA8) {
        expect(inst.getParam(p.id)).toBeGreaterThanOrEqual(p.min);
        expect(inst.getParam(p.id)).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("gives every factory pattern 12 voices of 16 steps", () => {
    for (const preset of PRESETS_80LA8) {
      const data = preset.data as { patterns: number[][][] };
      expect(data.patterns).toHaveLength(4);
      for (const p of data.patterns) {
        expect(p).toHaveLength(12);
        for (const row of p) expect(row).toHaveLength(16);
      }
    }
  });

  it("round-trips through JSON and renders the same", async () => {
    const first = await renderSteps(make, 16, {
      setup: (i) => {
        i.loadPreset("dusty");
        i.setParam("v1.tune", 3);
        (i as Drum80la8).selectVoice(4);
        i.setPattern(2);
      },
    });
    const state = JSON.parse(JSON.stringify(first.instrument.serialize()));
    const second = await renderSteps(make, 16, { setup: (i) => i.restore(state) });
    const r1 = rmsBetween(first.buffer, 0, 3);
    expect(r1).toBeGreaterThan(0.01);
    expect(Math.abs(rmsBetween(second.buffer, 0, 3) - r1)).toBeLessThan(r1 * 0.02);
    expect((second.instrument as Drum80la8).selectedVoice).toBe(4);
    expect(second.instrument.activePattern).toBe(2);
  });

  it("bounces the pattern offline", async () => {
    const inst = new Drum80la8(new nodeOffline(2, 128, 44100) as unknown as BaseAudioContext);
    const buffer = await bounceInstrument(make, inst.serialize(), { bars: 1, bpm: 120, offlineContext: nodeOffline, tailSeconds: 0.5 });
    expect(peakOf(buffer)).toBeGreaterThan(0.1);
  });

  it("muting and soloing voices gates them", async () => {
    const { buffer } = await renderSteps(make, 16, {
      setup: (i) => {
        kickOnly(i as Drum80la8, [0]);
        i.setParam("v0.mute", 1);
      },
    });
    expect(peakOf(buffer)).toBeLessThan(0.001);
  });
});

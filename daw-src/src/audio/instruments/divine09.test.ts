import { describe, expect, it } from "vitest";
import { Divine09, PARAMS_DIVINE, PRESETS_DIVINE, STEP_ACCENT } from "./divine09";
import { makeContext, nodeOffline, peakOf, renderSteps, rmsBetween } from "./drums/testing";

const make = (ctx: BaseAudioContext) => new Divine09(ctx);

function kickOnly(inst: Divine09, steps: number[]): void {
  inst.clearPattern();
  inst.setParam("v0.decay", 0.4);
  inst.setParam("v0.profile", 4);
  for (const s of steps) inst.tapStep(0, s);
}

describe("Divine09", () => {
  it("sounds on the kick steps and is silent elsewhere", async () => {
    const { buffer, stepDur } = await renderSteps(make, 16, { setup: (i) => kickOnly(i as Divine09, [0, 8]) });
    expect(rmsBetween(buffer, 0.01, stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 8 * stepDur + 0.01, 9 * stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 4 * stepDur, 8 * stepDur - 0.01)).toBeLessThan(0.002);
    expect(rmsBetween(buffer, 12 * stepDur, 16 * stepDur)).toBeLessThan(0.002);
  });

  it("is silent when the pattern is switched off", async () => {
    const { buffer } = await renderSteps(make, 16, { setup: (i) => i.setPattern(null) });
    expect(peakOf(buffer)).toBe(0);
  });

  it("follows the pattern length and loops past it", async () => {
    const { buffer, stepDur } = await renderSteps(make, 40, {
      setup: (i) => {
        kickOnly(i as Divine09, [0]);
        i.setParam("length", 0);
      },
    });
    expect(rmsBetween(buffer, 16 * stepDur + 0.01, 17 * stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 32 * stepDur + 0.01, 33 * stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 20 * stepDur, 31 * stepDur)).toBeLessThan(0.002);
  });

  it("plays steps beyond 64 when the length is 128", async () => {
    const { buffer, stepDur } = await renderSteps(make, 100, {
      setup: (i) => {
        kickOnly(i as Divine09, [96]);
        i.setParam("length", 3);
      },
    });
    expect(rmsBetween(buffer, 96 * stepDur + 0.01, 97 * stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 0, 90 * stepDur)).toBeLessThan(0.002);
  });

  it("stops the stutter with the transport: the gate re-opens after the last step", async () => {
    const play = (stutter: number) =>
      renderSteps(make, 1, {
        tail: 1.5,
        setup: (i) => {
          const d = i as Divine09;
          d.clearPattern();
          d.tapStep(10, 0);
          d.setParam("stutter", stutter);
        },
      });
    const plain = await play(0);
    const stutter = await play(1);
    // Crash rings for well over a second; after the single scheduled step the gate must be open again.
    const tailPlain = rmsBetween(plain.buffer, 0.4, 1.0);
    const tailStutter = rmsBetween(stutter.buffer, 0.4, 1.0);
    expect(tailPlain).toBeGreaterThan(0.005);
    expect(tailStutter).toBeGreaterThan(tailPlain * 0.8);
  });

  it("never exceeds full scale on a dense pattern", async () => {
    const { buffer } = await renderSteps(make, 32, {
      setup: (i) => {
        const d = i as Divine09;
        for (let v = 0; v < 11; v++) for (let s = 0; s < 16; s++) d.tapStep(v, s, true);
      },
    });
    const peak = peakOf(buffer);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("loads every preset without throwing", () => {
    for (const preset of PRESETS_DIVINE) {
      const inst = new Divine09(makeContext(0.1));
      expect(() => inst.loadPreset(preset.id)).not.toThrow();
      for (const p of PARAMS_DIVINE) {
        expect(inst.getParam(p.id)).toBeGreaterThanOrEqual(p.min);
        expect(inst.getParam(p.id)).toBeLessThanOrEqual(p.max);
      }
    }
    expect(PRESETS_DIVINE.filter((p) => p.category === "Kits")).toHaveLength(12);
  });

  it("round-trips through JSON and renders the same", async () => {
    const first = await renderSteps(make, 32, {
      setup: (i) => {
        i.loadPreset("groove-house");
        i.setParam("v1.tune", 2);
        i.setParam("length", 2);
        (i as Divine09).tapStep(0, 50, true);
        (i as Divine09).selectVoice(7);
      },
    });
    const state = JSON.parse(JSON.stringify(first.instrument.serialize()));
    const second = await renderSteps(make, 32, { setup: (i) => i.restore(state) });
    const r1 = rmsBetween(first.buffer, 0, 4);
    expect(r1).toBeGreaterThan(0.01);
    expect(Math.abs(rmsBetween(second.buffer, 0, 4) - r1)).toBeLessThan(r1 * 0.02);
    expect((second.instrument as Divine09).stepValue(0, 50)).toBe(STEP_ACCENT);
    expect((second.instrument as Divine09).selectedVoice).toBe(7);
  });

  it("keeps the pattern when only sound parameters change", () => {
    const inst = new Divine09(makeContext(0.1));
    inst.tapStep(2, 5);
    const before = inst.stepValue(2, 5);
    inst.loadPreset("kit-808");
    expect(inst.stepValue(2, 5)).toBe(before);
  });

  it("closed hat chokes the open hat", async () => {
    const make2 = async (choke: boolean) =>
      renderSteps(make, 8, {
        setup: (i) => {
          const d = i as Divine09;
          d.clearPattern();
          d.tapStep(4, 0);
          if (choke) d.tapStep(3, 2);
        },
      });
    const open = await make2(false);
    const choked = await make2(true);
    const t = 4 * 0.125;
    expect(rmsBetween(choked.buffer, t, t + 0.3)).toBeLessThan(rmsBetween(open.buffer, t, t + 0.3) * 0.7);
  });

  it("bounces through the shared offline path", async () => {
    const { bounceInstrument } = await import("../bounce");
    const inst = new Divine09(makeContext(0.1));
    const buffer = await bounceInstrument(make, inst.serialize(), { bars: 2, bpm: 120, offlineContext: nodeOffline, tailSeconds: 0.5 });
    expect(peakOf(buffer)).toBeGreaterThan(0.1);
  });
});

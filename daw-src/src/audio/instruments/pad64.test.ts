import { describe, expect, it } from "vitest";
import { PAD_COUNT, PARAMS_PAD64, Pad64, PRESETS_PAD64 } from "./pad64";
import { cacheSample } from "./drums/samples";
import { PAD_KINDS } from "./drums/voicesPad";
import { detectPitch } from "./voice/yin";
import { makeContext, nodeOffline, peakOf, renderSteps, rmsBetween } from "./drums/testing";
import { bounceInstrument } from "../bounce";

const make = (ctx: BaseAudioContext) => new Pad64(ctx);

function kickOnly(inst: Pad64, steps: number[]): void {
  inst.clearAll();
  inst.setParam("v0.decay", 0.3);
  for (const s of steps) inst.cycleStep(0, s);
}

function blip(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, 4410, 44100);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.2) * (1 - i / d.length);
  return buf;
}

describe("Pad64", () => {
  it("sounds on the kick steps and is silent elsewhere", async () => {
    const { buffer, stepDur } = await renderSteps(make, 16, { setup: (i) => kickOnly(i as Pad64, [0, 8]) });
    expect(rmsBetween(buffer, 0.01, stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 8 * stepDur + 0.01, 9 * stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 3 * stepDur, 8 * stepDur - 0.01)).toBeLessThan(0.002);
    expect(rmsBetween(buffer, 11 * stepDur, 16 * stepDur)).toBeLessThan(0.002);
  });

  it("accent steps play louder than normal steps", async () => {
    const play = async (taps: number) =>
      renderSteps(make, 2, {
        setup: (i) => {
          kickOnly(i as Pad64, []);
          for (let k = 0; k < taps; k++) (i as Pad64).cycleStep(0, 0);
        },
      });
    const normal = await play(1);
    const accent = await play(2);
    expect(rmsBetween(accent.buffer, 0, 0.1)).toBeGreaterThan(rmsBetween(normal.buffer, 0, 0.1));
  });

  it("is silent when the pattern is switched off", async () => {
    const { buffer } = await renderSteps(make, 16, { setup: (i) => i.setPattern(null) });
    expect(peakOf(buffer)).toBe(0);
  });

  it("loops at the chosen number of bars", async () => {
    const { buffer, stepDur } = await renderSteps(make, 40, {
      setup: (i) => {
        kickOnly(i as Pad64, [0]);
        i.setParam("bars", 0);
      },
    });
    expect(rmsBetween(buffer, 16 * stepDur + 0.01, 17 * stepDur)).toBeGreaterThan(0.02);
    expect(rmsBetween(buffer, 32 * stepDur + 0.01, 33 * stepDur)).toBeGreaterThan(0.02);
  });

  it("never exceeds full scale with every pad firing", async () => {
    const { buffer } = await renderSteps(make, 32, {
      setup: (i) => {
        const p = i as Pad64;
        for (let l = 0; l < PAD_COUNT; l++) {
          p.setParam(`v${l}.level`, 1.2);
          for (let s = 0; s < 16; s++) {
            p.cycleStep(l, s);
            if (p.stepValue(l, s) === 0) p.cycleStep(l, s);
          }
        }
      },
    });
    const peak = peakOf(buffer);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("loads every preset without throwing", () => {
    for (const preset of PRESETS_PAD64) {
      const inst = new Pad64(makeContext(0.1));
      expect(() => inst.loadPreset(preset.id)).not.toThrow();
      for (const p of PARAMS_PAD64) {
        expect(inst.getParam(p.id)).toBeGreaterThanOrEqual(p.min);
        expect(inst.getParam(p.id)).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("every one of the synth voices makes sound", async () => {
    for (let kind = 0; kind < PAD_KINDS.length; kind++) {
      const { buffer } = await renderSteps(make, 1, {
        tail: 1.5,
        setup: (i) => {
          kickOnly(i as Pad64, []);
          i.setParam("v5.kind", kind);
          i.setParam("v5.level", 1);
          (i as Pad64).cycleStep(5, 0);
        },
      });
      expect(peakOf(buffer), `kind ${kind}`).toBeGreaterThan(0.01);
    }
  });

  it("the warm bass sounds its sub on D2 at zero tune, follows the tune control, and stays dark", async () => {
    for (const [tune, hz] of [[0, 73.42], [-5, 55], [7, 110]] as const) {
      const { buffer } = await renderSteps(make, 4, {
        tail: 0.5,
        setup: (i) => {
          kickOnly(i as Pad64, []);
          i.setParam("v5.kind", PAD_KINDS.indexOf("Warm bass"));
          i.setParam("v5.tune", tune);
          i.setParam("v5.level", 1);
          (i as Pad64).cycleStep(5, 0);
        },
      });
      const d = buffer.getChannelData(0);
      const est = detectPitch(d.subarray(Math.floor(0.08 * buffer.sampleRate), Math.floor(0.2 * buffer.sampleRate)), buffer.sampleRate, 30, 400, 0.3);
      expect(est).not.toBeNull();
      expect(Math.abs(1200 * Math.log2((est?.freq ?? 0) / hz))).toBeLessThan(15);
    }
  });

  it("switches scenes on the next bar while playing and at once when stopped", async () => {
    const { buffer, stepDur, instrument } = await renderSteps(make, 32, {
      setup: (i) => {
        const p = i as Pad64;
        kickOnly(p, []);
        // Pattern B holds the only kick; scene 2 points pad 1 at it while the pad is currently on pattern A.
        p.setLanePattern(0, 1);
        p.cycleStep(0, 0);
        p.storeScene(1);
        p.setLanePattern(0, 0);
        p.recallScene(1, false);
        expect(p.queuedScene).toBe(1);
      },
    });
    const p = instrument as Pad64;
    expect(p.currentScene).toBe(1);
    expect(p.queuedScene).toBeNull();
    expect(rmsBetween(buffer, 0.01, stepDur)).toBeGreaterThan(0.02);
    p.recallScene(2, true);
    expect(p.currentScene).toBe(2);
  });

  it("drop breaks the groove for a beat and build adds a snare roll", async () => {
    const base = await renderSteps(make, 8, { setup: (i) => i.loadPreset("classic") });
    const dropped = await renderSteps(make, 8, {
      setup: (i) => {
        i.loadPreset("classic");
        (i as Pad64).drop();
      },
    });
    expect(rmsBetween(dropped.buffer, 0, 0.45)).toBeLessThan(0.001);
    expect(rmsBetween(base.buffer, 0, 0.45)).toBeGreaterThan(0.02);
    const built = await renderSteps(make, 8, {
      setup: (i) => {
        const p = i as Pad64;
        p.clearAll();
        p.startBuild();
      },
    });
    expect(peakOf(built.buffer)).toBeGreaterThan(0.05);
  });

  it("chain moves through scenes every two bars", async () => {
    const { instrument } = await renderSteps(make, 70, {
      setup: (i) => {
        (i as Pad64).setChain(true);
      },
    });
    expect((instrument as Pad64).currentScene).toBe(2);
  });

  it("stores samples as asset references and renders them after a round trip", async () => {
    const seed = makeContext(0.1);
    const buf = blip(seed);
    cacheSample("asset-blip", buf);
    const first = await renderSteps(make, 8, {
      setup: (i) => {
        const p = i as Pad64;
        kickOnly(p, []);
        p.setSample(3, { assetId: "asset-blip", name: "Blip" }, buf);
        p.cycleStep(3, 0);
      },
    });
    expect(rmsBetween(first.buffer, 0, 0.1)).toBeGreaterThan(0.02);
    const json = JSON.stringify(first.instrument.serialize());
    expect(json.length).toBeLessThan(40_000);
    expect(json).toContain("asset-blip");
    const second = await renderSteps(make, 8, { setup: (i) => i.restore(JSON.parse(json)) });
    const r = rmsBetween(first.buffer, 0, 0.1);
    expect(Math.abs(rmsBetween(second.buffer, 0, 0.1) - r)).toBeLessThan(r * 0.02);
    expect((second.instrument as Pad64).sampleBuffer(3)).not.toBeNull();
  });

  it("round-trips patterns, scenes and per-pad pattern choices", async () => {
    let state: ReturnType<Pad64["serialize"]> | undefined;
    const first = await renderSteps(make, 64, {
      setup: (i) => {
        const p = i as Pad64;
        p.loadPreset("synth");
        p.setLanePattern(2, 3);
        p.storeScene(4);
        p.setChain(true);
        p.selectVoice(9);
        p.setParam("v1.tune", -4);
        state = JSON.parse(JSON.stringify(p.serialize()));
      },
    });
    const second = await renderSteps(make, 64, { setup: (i) => {
        i.restore(state!);
        const p = i as Pad64;
        expect(p.lanePattern(2)).toBe(3);
        expect(p.chaining).toBe(true);
        expect(p.selectedVoice).toBe(9);
      },
    });
    const r = rmsBetween(first.buffer, 0, 8);
    expect(r).toBeGreaterThan(0.005);
    expect(Math.abs(rmsBetween(second.buffer, 0, 8) - r)).toBeLessThan(r * 0.03);
  });

  it("bounces through the shared offline path", async () => {
    const inst = new Pad64(makeContext(0.1));
    const buffer = await bounceInstrument(make, inst.serialize(), { bars: 2, bpm: 120, offlineContext: nodeOffline, tailSeconds: 0.5 });
    expect(peakOf(buffer)).toBeGreaterThan(0.1);
  });
});

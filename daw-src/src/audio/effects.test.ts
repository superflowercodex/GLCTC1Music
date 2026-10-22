import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { InsertType } from "../project/model";
import { buildEffect, compressorAutoMakeup, defaultParams, EFFECT_DEFS, EffectError, INSERT_TYPES, resolveParams } from "./effects";

const RATE = 44100;

type Source = (ctx: BaseAudioContext) => AudioNode;

const tone =
  (freq: number, amp: number): Source =>
  (ctx) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = amp;
    osc.connect(g);
    osc.start();
    return g;
  };

const impulse: Source = (ctx) => {
  const buffer = ctx.createBuffer(1, 64, RATE);
  buffer.getChannelData(0)[0] = 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.start();
  return src;
};

async function render(type: InsertType, params: Record<string, number>, source: Source, seconds: number): Promise<Float32Array> {
  const ctx = new NodeOfflineContext(1, Math.ceil(seconds * RATE), RATE) as unknown as OfflineAudioContext;
  const fx = buildEffect(type, ctx, params);
  source(ctx).connect(fx.input);
  fx.output.connect(ctx.destination);
  const out = await ctx.startRendering();
  fx.dispose();
  return out.getChannelData(0).slice();
}

const peak = (d: Float32Array, from = 0, to = d.length): number => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
};
const rms = (d: Float32Array, from = 0, to = d.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

/** Amplitude of one frequency (Goertzel), so tests can read a spectrum without an FFT. */
function amplitudeAt(d: Float32Array, freq: number, from = 0): number {
  const w = (2 * Math.PI * freq) / RATE;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  const n = d.length - from;
  for (let i = from; i < d.length; i++) {
    const s = d[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / n;
}

const finite = (d: Float32Array): boolean => d.every((v) => Number.isFinite(v));
const SETTLE = Math.floor(0.3 * RATE);

describe("compressor", () => {
  it("reduces the peak of a loud tone", async () => {
    const out = await render("compressor", { threshold: -24, ratio: 8, makeup: 0 }, tone(440, 0.9), 1);
    expect(peak(out, SETTLE)).toBeLessThan(0.9 * 0.6);
    expect(peak(out, SETTLE)).toBeGreaterThan(0.05);
  });

  it("does not boost quiet material (the browser's automatic makeup is cancelled)", async () => {
    const out = await render("compressor", { threshold: -24, ratio: 4, knee: 0, makeup: 0 }, tone(440, 0.01), 0.6);
    expect(peak(out, SETTLE) / 0.01).toBeGreaterThan(0.9);
    expect(peak(out, SETTLE) / 0.01).toBeLessThan(1.1);
  });

  it("makeup gain raises the level by the requested amount", async () => {
    const flat = await render("compressor", { threshold: 0, ratio: 1, makeup: 0 }, tone(440, 0.2), 0.6);
    const lifted = await render("compressor", { threshold: 0, ratio: 1, makeup: 6 }, tone(440, 0.2), 0.6);
    expect(peak(lifted, SETTLE) / peak(flat, SETTLE)).toBeCloseTo(10 ** (6 / 20), 1);
  });

  it("cancels the browser makeup for soft knees too", async () => {
    for (const knee of [0, 12, 30]) {
      const out = await render("compressor", { threshold: -20, ratio: 3, knee, makeup: 0 }, tone(440, 0.005), 0.6);
      const gain = peak(out, SETTLE) / 0.005;
      expect(gain).toBeGreaterThan(0.85);
      expect(gain).toBeLessThan(1.15);
    }
  });

  it("auto makeup is 1 when nothing is compressed", () => {
    expect(compressorAutoMakeup(0, 0, 1)).toBeCloseTo(1, 5);
  });
});

describe("eq", () => {
  it("boosts and cuts the bands it is told to", async () => {
    const flat80 = amplitudeAt(await render("eq", {}, tone(80, 0.3), 0.8), 80, SETTLE);
    const boosted = amplitudeAt(await render("eq", { low: 12 }, tone(80, 0.3), 0.8), 80, SETTLE);
    expect(boosted / flat80).toBeGreaterThan(2.5);
    const flat10k = amplitudeAt(await render("eq", {}, tone(10000, 0.3), 0.8), 10000, SETTLE);
    const cut = amplitudeAt(await render("eq", { high: -12 }, tone(10000, 0.3), 0.8), 10000, SETTLE);
    expect(cut / flat10k).toBeLessThan(0.4);
    const mid = amplitudeAt(await render("eq", { mid: 12, midFreq: 1000 }, tone(1000, 0.3), 0.8), 1000, SETTLE);
    const midFlat = amplitudeAt(await render("eq", {}, tone(1000, 0.3), 0.8), 1000, SETTLE);
    expect(mid / midFlat).toBeGreaterThan(3);
  });
});

describe("filter", () => {
  it("low-pass keeps lows and removes highs", async () => {
    const params = { mode: 0, cutoff: 500, resonance: 0.7 };
    const low = amplitudeAt(await render("filter", params, tone(100, 0.5), 0.6), 100, SETTLE);
    const high = amplitudeAt(await render("filter", params, tone(5000, 0.5), 0.6), 5000, SETTLE);
    expect(low).toBeGreaterThan(0.45);
    expect(high).toBeLessThan(0.05);
  });

  it("high-pass does the opposite", async () => {
    const params = { mode: 1, cutoff: 2000, resonance: 0.7 };
    const low = amplitudeAt(await render("filter", params, tone(100, 0.5), 0.6), 100, SETTLE);
    const high = amplitudeAt(await render("filter", params, tone(8000, 0.5), 0.6), 8000, SETTLE);
    expect(low).toBeLessThan(0.02);
    expect(high).toBeGreaterThan(0.45);
  });
});

describe("saturator", () => {
  it("adds harmonics, stays within full scale, and drive 0 mix 0 is clean", async () => {
    const driven = await render("saturator", { drive: 18, mix: 1 }, tone(440, 0.5), 0.6);
    expect(amplitudeAt(driven, 1320, SETTLE)).toBeGreaterThan(0.01);
    expect(peak(driven)).toBeLessThanOrEqual(1.001);
    const clean = await render("saturator", { drive: 18, mix: 0 }, tone(440, 0.5), 0.6);
    expect(amplitudeAt(clean, 1320, SETTLE)).toBeLessThan(0.002);
  });
});

describe("chorus", () => {
  it("passes signal and changes it", async () => {
    const dry = await render("chorus", { mix: 0 }, tone(440, 0.4), 0.6);
    const wet = await render("chorus", { mix: 1, depth: 1 }, tone(440, 0.4), 0.6);
    expect(rms(wet, SETTLE)).toBeGreaterThan(0.1);
    let diff = 0;
    for (let i = SETTLE; i < dry.length; i++) diff += Math.abs(dry[i] - wet[i]);
    expect(diff).toBeGreaterThan(1);
  });
});

describe("delay", () => {
  it("echoes at the set time", async () => {
    const out = await render("delay", { time: 200, feedback: 0, mix: 0.5, tone: 16000 }, impulse, 0.6);
    const expected = Math.round(0.2 * RATE);
    let best = 0;
    let at = 0;
    for (let i = 100; i < out.length; i++) {
      if (Math.abs(out[i]) > best) {
        best = Math.abs(out[i]);
        at = i;
      }
    }
    expect(Math.abs(at - expected)).toBeLessThan(40);
    expect(best).toBeGreaterThan(0.2);
    expect(Math.abs(out[0])).toBeGreaterThan(0.4);
  });

  it("feedback produces repeats and stays bounded", async () => {
    const out = await render("delay", { time: 100, feedback: 0.9, mix: 0.5 }, impulse, 2);
    expect(finite(out)).toBe(true);
    expect(peak(out, Math.round(0.35 * RATE))).toBeGreaterThan(0.05);
    expect(peak(out)).toBeLessThan(1.5);
  });
});

describe("reverb", () => {
  const burst: Source = (ctx) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, 0);
    g.gain.setValueAtTime(0, 0.1);
    osc.connect(g);
    osc.start();
    return g;
  };

  it("adds a tail after the input stops", async () => {
    const wet = await render("reverb", { mix: 0.6, decay: 2 }, burst, 1.5);
    const dry = await render("reverb", { mix: 0, decay: 2 }, burst, 1.5);
    const from = Math.round(0.5 * RATE);
    expect(rms(wet, from)).toBeGreaterThan(0.002);
    expect(rms(dry, from)).toBe(0);
  });

  it("is repeatable: two renders are identical", async () => {
    const a = await render("reverb", { mix: 1 }, impulse, 0.5);
    const b = await render("reverb", { mix: 1 }, impulse, 0.5);
    expect(a).toEqual(b);
  });

  it("a longer decay leaves more energy late", async () => {
    const short = await render("reverb", { mix: 1, decay: 0.5 }, burst, 2.5);
    const long = await render("reverb", { mix: 1, decay: 5 }, burst, 2.5);
    const from = Math.round(1.5 * RATE);
    expect(rms(long, from)).toBeGreaterThan(rms(short, from) * 3);
  });
});

describe("gate", () => {
  it("silences input below the threshold", async () => {
    const quiet = await render("gate", { threshold: -40, reduction: 60 }, tone(300, 0.002), 1);
    expect(rms(quiet, SETTLE)).toBeLessThan(0.002 * 0.7 * 0.05);
  });

  it("lets loud input through", async () => {
    const loud = await render("gate", { threshold: -40, reduction: 60 }, tone(300, 0.5), 1);
    expect(rms(loud, SETTLE) / (0.5 * Math.SQRT1_2)).toBeGreaterThan(0.9);
  });

  it("opens quickly and closes slowly", async () => {
    const burst: Source = (ctx) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.setValueAtTime(0.5, 0.2);
      g.gain.setValueAtTime(0, 0.5);
      osc.connect(g);
      osc.start();
      return g;
    };
    const out = await render("gate", { threshold: -30, release: 300, reduction: 60 }, burst, 1.2);
    expect(rms(out, Math.round(0.23 * RATE), Math.round(0.3 * RATE))).toBeGreaterThan(0.2);
    expect(rms(out, Math.round(0.85 * RATE), Math.round(0.95 * RATE))).toBeLessThan(0.01);
  });
});

describe("deesser", () => {
  it("reduces sibilance but leaves lows alone", async () => {
    const params = { frequency: 5000, threshold: -30, amount: 12 };
    const high = amplitudeAt(await render("deesser", params, tone(8000, 0.5), 0.6), 8000, SETTLE);
    const low = amplitudeAt(await render("deesser", params, tone(200, 0.5), 0.6), 200, SETTLE);
    expect(high).toBeLessThan(0.5 * 0.6);
    expect(low).toBeGreaterThan(0.45);
  });

  it("is transparent when nothing is compressed", async () => {
    const params = { frequency: 5000, threshold: 0, amount: 1 };
    for (const f of [200, 3000, 5000, 8000]) {
      const out = amplitudeAt(await render("deesser", params, tone(f, 0.5), 0.6), f, SETTLE);
      expect(out / 0.5).toBeGreaterThan(0.93);
      expect(out / 0.5).toBeLessThan(1.07);
    }
  });
});

describe("effect contract", () => {
  it("every type has defaults inside its ranges", () => {
    for (const type of INSERT_TYPES) {
      for (const def of EFFECT_DEFS[type].params) {
        expect(def.def).toBeGreaterThanOrEqual(def.min);
        expect(def.def).toBeLessThanOrEqual(def.max);
      }
    }
  });

  it("rejects unknown parameters instead of ignoring them", () => {
    const ctx = new NodeOfflineContext(1, 128, RATE) as unknown as OfflineAudioContext;
    for (const type of INSERT_TYPES) {
      const fx = buildEffect(type, ctx);
      expect(() => fx.set("nope", 1)).toThrow(EffectError);
      fx.dispose();
    }
  });

  it("accepts a change to every parameter of every effect while running, at both ends of its range", async () => {
    for (const type of INSERT_TYPES) {
      const ctx = new NodeOfflineContext(1, Math.ceil(0.3 * RATE), RATE) as unknown as OfflineAudioContext;
      const fx = buildEffect(type, ctx);
      tone(440, 0.5)(ctx).connect(fx.input);
      fx.output.connect(ctx.destination);
      for (const def of EFFECT_DEFS[type].params) {
        fx.set(def.id, def.min);
        fx.set(def.id, def.max);
        fx.set(def.id, def.def);
      }
      const out = (await ctx.startRendering()).getChannelData(0);
      expect(finite(out), type).toBe(true);
      fx.dispose();
    }
  });

  it("repairs missing or hostile saved params", () => {
    const fixed = resolveParams("delay", { time: Number.NaN, feedback: 99, extra: 1 });
    expect(fixed.time).toBe(defaultParams("delay").time);
    expect(fixed.feedback).toBe(0.9);
    expect(fixed.extra).toBeUndefined();
  });

  it("never produces NaN or Infinity for any parameters", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...INSERT_TYPES), fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 8, maxLength: 8 }), async (type, values) => {
        const params: Record<string, number> = {};
        EFFECT_DEFS[type].params.forEach((def, i) => {
          params[def.id] = def.min + ((values[i] % 1) + 1) % 1 * (def.max - def.min);
        });
        const out = await render(type, params, tone(440, 0.8), 0.15);
        return finite(out);
      }),
      { numRuns: 30 },
    );
  });
});

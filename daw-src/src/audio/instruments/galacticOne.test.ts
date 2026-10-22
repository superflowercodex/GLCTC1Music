import { describe, expect, it } from "vitest";
import { bounceInstrument, measure } from "../bounce";
import { GalacticOne } from "./galacticOne";
import { energyAbove, offlineClass, offlineContext, peakFrequency, peakOf, rmsOf, TEST_RATE } from "./synth/testUtils";

const QUIET_FX: Record<string, number> = { "fx.chMode": 0, "fx.chMix": 0, "fx.dlMix": 0, "fx.rvMix": 0, "fx.phMix": 0, "fx.apDepth": 0, "fx.fxDrive": 0, "fx.fxCrush": 0, "fx.width": 1 };
const PLAIN: Record<string, number> = {
  ...QUIET_FX,
  "a.uni": 1,
  "a.o2lvl": 0,
  "a.sub": 0,
  "a.noise": 0,
  "a.drift": 0,
  "a.cut": 16000,
  "a.fenv": 0,
  "a.drive": 0,
  "a.res": 0,
  "a.l1pitch": 0,
  "a.mwvib": 0,
  "a.o1fine": 0,
  "a.as": 1,
  "a.aa": 0.005,
  "a.ar": 0.15,
  "a.avel": 0,
  "a.key": 0,
  "a.fvel": 0,
};

function build(ctx: BaseAudioContext, settings: Record<string, number> = PLAIN): GalacticOne {
  const go = new GalacticOne(ctx);
  for (const [id, value] of Object.entries(settings)) go.setParam(id, value);
  go.output.connect(ctx.destination);
  go.setPattern(null);
  return go;
}

async function renderNote(settings: Record<string, number>, note = 69, hold = 0.6, seconds = 1.6, velocity = 0.8): Promise<Float32Array> {
  const ctx = offlineContext(seconds);
  const go = build(ctx, { ...PLAIN, ...settings });
  go.noteOn({ note, velocity, time: 0.05, duration: hold });
  return (await ctx.startRendering()).getChannelData(0).slice();
}

const meanDiff = (a: Float32Array, b: Float32Array): number => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
};

describe("GalacticOne parameters and presets", () => {
  it("exposes both patches, effects, macros and sequencer settings with grouped, prefixed ids", () => {
    const go = new GalacticOne(offlineContext(1));
    const a = go.params.filter((p) => p.id.startsWith("a."));
    const b = go.params.filter((p) => p.id.startsWith("b."));
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThanOrEqual(60);
    expect(new Set(a.map((p) => p.group)).size).toBe(4);
    expect(go.params.filter((p) => p.id.startsWith("macro.")).length).toBe(4);
    expect(go.params.filter((p) => p.id.startsWith("fx.")).length).toBeGreaterThanOrEqual(20);
  });

  it("ships 36 factory presets in five categories plus 7 performances", () => {
    const presets = new GalacticOne(offlineContext(1)).presets.filter((p) => p.factory);
    const sounds = presets.filter((p) => p.category !== "Performance");
    expect(sounds).toHaveLength(36);
    expect(new Set(sounds.map((p) => p.category))).toEqual(new Set(["Lead", "Bass", "Pad", "Pluck", "FX"]));
    expect(presets.filter((p) => p.category === "Performance")).toHaveLength(7);
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
  });

  it("a single-sound preset leaves a hand-built patch B and the arp settings alone", () => {
    const go = new GalacticOne(offlineContext(1));
    go.setParam("b.cut", 777);
    go.setParam("arp.mode", 3);
    go.loadPreset("go-jupiter-brass");
    expect(go.getParam("b.cut")).toBe(777);
    expect(go.getParam("arp.mode")).toBe(3);
    expect(go.getParam("a.cut")).toBe(1500);
    expect(go.patchName(0)).toBe("Jupiter Brass");
  });

  it("performances load both patches and the key mode", () => {
    const go = new GalacticOne(offlineContext(1));
    go.loadPreset("go-perf-lead-bass");
    expect(go.getParam("key.mode")).toBe(1);
    expect(go.patchName(0)).toBe("Supernova Lead");
    expect(go.patchName(1)).toBe("Cosmic Bass");
    expect(go.getParam("b.mode")).toBe(1);
  });

  it("copies, swaps and initialises patches", () => {
    const go = new GalacticOne(offlineContext(1));
    go.setParam("a.cut", 1234);
    go.copyPatch(0, 1);
    expect(go.getParam("b.cut")).toBe(1234);
    go.setParam("b.cut", 99);
    go.swapPatches();
    expect(go.getParam("a.cut")).toBe(99);
    expect(go.getParam("b.cut")).toBe(1234);
    go.initPatch(0);
    expect(go.getParam("a.cut")).toBe(5200);
  });

  it("every factory preset loads, renders a bar and never clips", async () => {
    const probe = new GalacticOne(offlineContext(1));
    for (const preset of probe.presets) {
      const go = new GalacticOne(offlineContext(1));
      go.loadPreset(preset.id);
      go.setPattern(0);
      const buffer = await bounceInstrument((c) => new GalacticOne(c), go.serialize(), { bars: 1, bpm: 120, sampleRate: 22050, tailSeconds: 1, offlineContext: offlineClass });
      const { peak, rms } = measure(buffer);
      expect(peak, preset.name).toBeLessThan(1);
      expect(rms, preset.name).toBeGreaterThan(0.001);
    }
  }, 120000);
});

describe("GalacticOne voice", () => {
  it("plays the pitch it was asked for", async () => {
    const data = await renderNote({});
    expect(Math.abs(peakFrequency(data, Math.floor(0.2 * TEST_RATE), 16384) - 440)).toBeLessThan(4);
  });

  it("range switches move the oscillator by octaves and FM, ring and sub add tones", async () => {
    const up = await renderNote({ "a.o1oct": 3 });
    expect(Math.abs(peakFrequency(up, Math.floor(0.2 * TEST_RATE), 16384) - 880)).toBeLessThan(8);
    const plain = await renderNote({});
    const variants: Record<string, number>[] = [{ "a.sub": 1 }, { "a.noise": 1 }, { "a.o2lvl": 0.7, "a.o2fine": 40 }, { "a.xmod": 0.5, "a.o2lvl": 0 }, { "a.ring": 1, "a.o2lvl": 0, "a.o2semi": 5 }];
    for (const settings of variants) {
      expect(meanDiff(plain, await renderNote(settings)), JSON.stringify(settings)).toBeGreaterThan(0.002);
    }
  });

  it("releases to silence", async () => {
    const data = await renderNote({ "a.ar": 0.2 });
    expect(rmsOf(data, Math.floor(0.2 * TEST_RATE), Math.floor(0.5 * TEST_RATE))).toBeGreaterThan(0.02);
    expect(peakOf(data, Math.floor(1.3 * TEST_RATE))).toBeLessThan(0.002);
  });

  it("cutoff, slope and high-pass shape the spectrum; resonance stays bounded", async () => {
    const at = Math.floor(0.2 * TEST_RATE);
    const bright = await renderNote({ "a.cut": 12000 });
    const dark = await renderNote({ "a.cut": 400 });
    expect(energyAbove(bright, at, 8192, 2500)).toBeGreaterThan(energyAbove(dark, at, 8192, 2500) * 10);
    const gentle = await renderNote({ "a.cut": 800, "a.slope": 0 });
    const steep = await renderNote({ "a.cut": 800, "a.slope": 1 });
    expect(energyAbove(gentle, at, 8192, 3000)).toBeGreaterThan(energyAbove(steep, at, 8192, 3000) * 2);
    const resonant = await renderNote({ "a.cut": 500, "a.res": 1, "a.drive": 1, "fx.outLvl": 1.2 });
    expect(peakOf(resonant)).toBeLessThan(1);
    const noHp = await renderNote({ "a.o1oct": 1 });
    const hp = await renderNote({ "a.o1oct": 1, "a.hpf": 1800 });
    expect(rmsOf(hp, at, at + 8000)).toBeLessThan(rmsOf(noHp, at, at + 8000) * 0.5);
  });

  it("a held pad follows the cutoff knob in real time", async () => {
    const ctx = offlineContext(1.2);
    const go = build(ctx, { ...PLAIN, "a.cut": 12000, "a.as": 1 });
    go.noteOn({ note: 57, velocity: 0.8, time: 0 });
    const data = (await ctx.startRendering()).getChannelData(0).slice();
    const early = energyAbove(data, Math.floor(0.2 * TEST_RATE), 8192, 2500);
    const ctx2 = offlineContext(1.2);
    const go2 = build(ctx2, { ...PLAIN, "a.cut": 12000, "a.as": 1 });
    go2.noteOn({ note: 57, velocity: 0.8, time: 0 });
    go2.setParam("a.cut", 300);
    const data2 = (await ctx2.startRendering()).getChannelData(0).slice();
    expect(energyAbove(data2, Math.floor(0.2 * TEST_RATE), 8192, 2500)).toBeLessThan(early * 0.2);
  });

  it("mod matrix routes an LFO to cutoff and velocity to volume", async () => {
    const plain = await renderNote({ "a.cut": 1500 });
    const routed = await renderNote({ "a.cut": 1500, "a.m1src": 1, "a.m1dst": 1, "a.m1amt": 1, "a.l1rate": 7 });
    expect(meanDiff(plain, routed)).toBeGreaterThan(0.004);
    const soft = await renderNote({ "a.m2src": 5, "a.m2dst": 4, "a.m2amt": 1 }, 69, 0.6, 1.6, 0.2);
    const hard = await renderNote({ "a.m2src": 5, "a.m2dst": 4, "a.m2amt": 1 }, 69, 0.6, 1.6, 1);
    expect(rmsOf(hard, 9000, 30000)).toBeGreaterThan(rmsOf(soft, 9000, 30000) * 1.5);
  });

  it("unison widens the stereo image and wheel vibrato needs the wheel", async () => {
    const ctx = offlineContext(1);
    const go = build(ctx, { ...PLAIN, "a.uni": 5, "a.spread": 30, "a.width": 1 });
    go.noteOn({ note: 57, velocity: 0.8, time: 0.05, duration: 0.6 });
    const buffer = await ctx.startRendering();
    const l = buffer.getChannelData(0).slice();
    const r = buffer.getChannelData(1).slice();
    expect(meanDiff(l, r)).toBeGreaterThan(0.005);
  });

  it("mono voice mode releases the first note when the second arrives", () => {
    const ctx = offlineContext(1);
    const go = build(ctx, { ...PLAIN, "a.mode": 1 });
    go.keyOn(null, 60, 0.8);
    go.keyOn(null, 64, 0.8);
    go.keyOn(null, 67, 0.8);
    expect(go.activeVoiceCount).toBeLessThanOrEqual(2);
  });

  it("steals voices beyond the voice limit", () => {
    const ctx = offlineContext(1);
    const go = build(ctx, { ...PLAIN, "perf.voices": 6 });
    for (let n = 0; n < 24; n++) go.keyOn(null, 40 + n, 0.8);
    expect(go.activeVoiceCount).toBeLessThanOrEqual(6);
    go.allNotesOff();
    expect(go.activeVoiceCount).toBe(0);
  });
});

describe("GalacticOne key modes", () => {
  const energy = async (mode: number, note: number, silence: "a" | "b" | null) => {
    const ctx = offlineContext(1);
    const go = build(ctx, { ...PLAIN, "b.uni": 1, "b.o2lvl": 0, "b.as": 1, "b.aa": 0.005, "key.mode": mode, "key.split": 60 });
    if (silence) go.setParam(`${silence}.vol`, 0);
    go.noteOn({ note, velocity: 0.8, time: 0.02, duration: 0.5 });
    const data = (await ctx.startRendering()).getChannelData(0).slice();
    return rmsOf(data, 4000, 20000);
  };

  it("whole plays patch A only, split sends high notes to B, dual plays both", async () => {
    expect(await energy(0, 72, "a")).toBeLessThan(0.0005);
    expect(await energy(0, 72, "b")).toBeGreaterThan(0.01);
    expect(await energy(1, 72, "b")).toBeLessThan(0.0005);
    expect(await energy(1, 72, "a")).toBeGreaterThan(0.01);
    expect(await energy(1, 48, "a")).toBeLessThan(0.0005);
    expect(await energy(2, 60, "a")).toBeGreaterThan(0.01);
    expect(await energy(2, 60, "b")).toBeGreaterThan(0.01);
  });
});

describe("GalacticOne sequencer", () => {
  const bounce = (setup: (go: GalacticOne) => void, bars = 1, seconds = 0.6) => {
    const go = new GalacticOne(offlineContext(1));
    setup(go);
    return bounceInstrument((c) => new GalacticOne(c), go.serialize(), { bars, bpm: 120, sampleRate: TEST_RATE, tailSeconds: seconds, offlineContext: offlineClass });
  };
  const stepSamples = (60 / 120 / 4) * TEST_RATE;

  it("plays the steps that are on, on time, in the chosen key and scale", async () => {
    const buffer = await bounce((go) => {
      for (const [id, v] of Object.entries({ ...PLAIN, "a.ar": 0.03, "a.ad": 0.05, "a.as": 1, "seq.root": 9, "seq.octave": 3, "seq.scale": 2, "seq.swing": 0 })) go.setParam(id, v);
      go.generate(0, "clear");
      go.updateStep(0, 0, { on: true, n: 0, g: 0.5, v: 0.9 });
      go.updateStep(0, 4, { on: true, n: 3, g: 0.5, v: 0.9 });
      go.setPattern(0);
    });
    const data = buffer.getChannelData(0).slice();
    expect(peakOf(data, Math.floor(stepSamples * 2.3), Math.floor(stepSamples * 3.8))).toBeLessThan(0.002);
    expect(Math.abs(peakFrequency(data, Math.floor(stepSamples * 0.25), 4096) - 220)).toBeLessThan(12);
    expect(Math.abs(peakFrequency(data, Math.floor(stepSamples * 4.25), 4096) - 261.6)).toBeLessThan(14);
  });

  it("ratchet splits a step into equal hits", async () => {
    const buffer = await bounce((go) => {
      for (const [id, v] of Object.entries({ ...PLAIN, "a.aa": 0.001, "a.ad": 0.01, "a.as": 0, "a.ar": 0.01, "a.avel": 0 })) go.setParam(id, v);
      go.generate(0, "clear");
      go.updateStep(0, 0, { on: true, r: 4, g: 0.5, v: 1 });
      go.setPattern(0);
    });
    const data = buffer.getChannelData(0).slice();
    const slot = Math.floor(stepSamples / 4);
    const loud = [0, 1, 2, 3].map((k) => rmsOf(data, k * slot, k * slot + slot / 2));
    for (const e of loud) expect(e).toBeGreaterThan(0.005);
    expect(rmsOf(data, slot * 4 + 200, slot * 8)).toBeLessThan(0.001);
  });

  it("probability is reproducible with a seed and drops steps", async () => {
    const run = (seed: number, chance: number) =>
      bounce(
        (go) => {
          for (const [id, v] of Object.entries({ ...PLAIN, "a.ar": 0.02 })) go.setParam(id, v);
          go.generate(0, "bounce");
          for (let i = 0; i < 16; i++) go.updateStep(0, i, { p: chance, g: 0.5 });
          go.setSeed(seed);
          go.setPattern(0);
        },
        2,
      ).then((b) => b.getChannelData(0).slice());
    const a = await run(11, 0.5);
    const b = await run(11, 0.5);
    const c = await run(12, 0.5);
    const full = await run(11, 1);
    expect(Array.from(a.slice(0, 40000))).toEqual(Array.from(b.slice(0, 40000)));
    expect(meanDiff(a, c)).toBeGreaterThan(0.001);
    const sounding = (data: Float32Array) => Array.from({ length: 32 }, (_, i) => rmsOf(data, Math.floor(i * stepSamples), Math.floor(i * stepSamples + stepSamples * 0.4)) > 0.01).filter(Boolean).length;
    expect(sounding(full)).toBe(32);
    expect(sounding(a)).toBeGreaterThan(8);
    expect(sounding(a)).toBeLessThan(26);
  });

  it("setPattern(null) silences the sequencer but not live notes", async () => {
    const ctx = offlineContext(1.5);
    const go = build(ctx);
    for (let s = 0; s < 8; s++) go.onStep(s, s * 0.125, 0.125);
    go.noteOn({ note: 60, velocity: 0.8, time: 0.6, duration: 0.3 });
    const data = (await ctx.startRendering()).getChannelData(0).slice();
    expect(peakOf(data, 0, Math.floor(0.55 * TEST_RATE))).toBeLessThan(0.001);
    expect(peakOf(data, Math.floor(0.7 * TEST_RATE), Math.floor(0.85 * TEST_RATE))).toBeGreaterThan(0.01);
  });

  it("arp mode walks the held keys at the step rhythm", () => {
    const ctx = offlineContext(2);
    const go = build(ctx, { ...PLAIN, "seq.mode": 1, "arp.mode": 0, "arp.oct": 1 });
    go.setPattern(0);
    go.generate(0, "bounce");
    const hits: number[] = [];
    const real = (go as unknown as { makeVoice: (...a: unknown[]) => unknown }).makeVoice.bind(go);
    (go as unknown as { makeVoice: (...a: unknown[]) => unknown }).makeVoice = (pi, midi, ...rest) => {
      hits.push(midi as number);
      return real(pi, midi, ...rest);
    };
    go.keyOn(null, 60, 0.8);
    go.keyOn(null, 64, 0.8);
    go.keyOn(null, 67, 0.8);
    hits.length = 0;
    for (let s = 0; s < 6; s++) go.onStep(s, 0.1 + s * 0.125, 0.125);
    expect(hits.slice(0, 6)).toEqual([60, 64, 67, 60, 64, 67]);
  });

  it("live stepping and an offline bounce agree when the seed is the same", async () => {
    const make = (ctx: BaseAudioContext) => {
      const go = build(ctx, { ...PLAIN, "a.ar": 0.03 });
      go.generate(0, "random", () => 0.31);
      for (let i = 0; i < 16; i++) go.updateStep(0, i, { on: i % 2 === 0, p: 0.6 });
      go.setSeed(99);
      go.setPattern(0);
      return go;
    };
    const ctxA = offlineContext(2.6);
    const live = make(ctxA);
    const state = live.serialize();
    for (let s = 0; s < 16; s++) live.onStep(s, s * 0.125, 0.125);
    const a = (await ctxA.startRendering()).getChannelData(0).slice();
    const bounced = (await bounceInstrument((c) => new GalacticOne(c), JSON.parse(JSON.stringify(state)), { bars: 1, bpm: 120, sampleRate: TEST_RATE, tailSeconds: 0.6, offlineContext: offlineClass })).getChannelData(0).slice();
    expect(meanDiff(a.slice(0, 60000), bounced.slice(0, 60000))).toBeLessThan(1e-6);
  });

  it("a step's filter jump and slide change the sound", async () => {
    const render = async (change: Partial<{ c: number; slide: boolean }>) => {
      const ctx = offlineContext(1);
      const go = build(ctx, { ...PLAIN, "a.cut": 1200, "a.ar": 0.05, "a.glide": 0, "seq.swing": 0 });
      go.generate(0, "clear");
      go.updateStep(0, 0, { on: true, n: 0, g: 0.6 });
      go.updateStep(0, 1, { on: true, n: 12, g: 0.6, ...change });
      go.setPattern(0);
      go.onStep(0, 0, 0.125);
      go.onStep(1, 0.125, 0.125);
      return (await ctx.startRendering()).getChannelData(0).slice();
    };
    const base = await render({});
    expect(meanDiff(base, await render({ c: 1 }))).toBeGreaterThan(0.003);
    expect(meanDiff(base, await render({ slide: true }))).toBeGreaterThan(0.003);
  });

  it("follows the song chain across banks", () => {
    const go = new GalacticOne(offlineContext(1));
    go.setChain([2, 3]);
    go.setParam("seq.chain", 1);
    expect(() => go.setChain([9])).toThrow(RangeError);
    expect(go.getChain()).toEqual([2, 3]);
  });

  it("round-trips banks, chain, names, seed and steps", () => {
    const a = new GalacticOne(offlineContext(1));
    a.updateStep(5, 7, { on: true, n: 5, r: 3, p: 0.5, c: -0.4, slide: true, accent: true });
    a.setLength(5, 8);
    a.setChain([5, 0, 5]);
    a.setPatchName(1, "My bass");
    a.setSeed(4242);
    a.setPattern(5);
    const b = new GalacticOne(offlineContext(1));
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.getPattern(5).steps[7]).toEqual(a.getPattern(5).steps[7]);
    expect(b.getPattern(5).len).toBe(8);
    expect(b.getChain()).toEqual([5, 0, 5]);
    expect(b.patchName(1)).toBe("My bass");
    expect(b.currentSeed).toBe(4242);
    expect(b.activePattern).toBe(5);
  });

  it("rejects damaged data loudly", () => {
    expect(() => new GalacticOne(offlineContext(1)).restore({ kind: "galacticOne", values: {}, data: 5 })).toThrow(/damaged/);
  });
});

describe("GalacticOne effects and macros", () => {
  it("each effect control changes the output", async () => {
    const base = await renderNote({ "a.uni": 3, "a.width": 0.8 });
    const controls: Record<string, number>[] = [
      { "fx.fxDrive": 0.9 },
      { "fx.fxCrush": 0.9 },
      { "fx.gRate": 3, "fx.gDepth": 1 },
      { "fx.chMode": 3, "fx.chMix": 1 },
      { "fx.phMix": 1, "fx.phFb": 0.7 },
      { "fx.dlMix": 0.8, "fx.dlFb": 0.7 },
      { "fx.rvMix": 0.8 },
      { "fx.apDepth": 1, "fx.apRate": 3 },
      { "fx.width": 0 },
      { "fx.outLvl": 0.3 },
      { "macro.bright": 1, "a.cut": 800 },
      { "macro.motion": 1, "fx.chMode": 2 },
      { "macro.space": 1 },
      { "macro.grit": 1 },
    ];
    for (const change of controls) {
      const out = await renderNote({ "a.uni": 3, "a.width": 0.8, ...change });
      expect(meanDiff(base, out), JSON.stringify(change)).toBeGreaterThan(0.0008);
    }
  });
});

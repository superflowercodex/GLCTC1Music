import { describe, expect, it } from "vitest";
import type { Instrument, ParamDef } from "../types";
import { Acid30lee } from "./acid30lee";
import { GalacticOne } from "./galacticOne";
import { Lead0010110 } from "./lead0010110";
import { offlineContext, TEST_RATE } from "./synth/testUtils";

/** A value clearly away from the current one, so a working control has to change the sound. */
function alternative(def: ParamDef, current: number): number {
  if (def.options) return (Math.round(current) + Math.max(1, Math.floor(def.options.length / 2))) % def.options.length;
  const range = def.max - def.min;
  const high = def.min + range * 0.85;
  const low = def.min + range * 0.15;
  return Math.abs(current - high) > Math.abs(current - low) ? high : low;
}

async function render(make: () => { inst: Instrument; play: () => void }): Promise<{ l: Float32Array; r: Float32Array }> {
  const { inst, play } = make();
  play();
  const buffer = await (inst.ctx as OfflineAudioContext).startRendering();
  return { l: buffer.getChannelData(0).slice(), r: buffer.getChannelData(1).slice() };
}

function distance(a: { l: Float32Array; r: Float32Array }, b: { l: Float32Array; r: Float32Array }): number {
  let d = 0;
  for (let i = 0; i < a.l.length; i++) d += Math.abs(a.l[i] - b.l[i]) + Math.abs(a.r[i] - b.r[i]);
  return d / (a.l.length * 2);
}

const THRESHOLD = 2e-4;

describe("every control does something", () => {
  it("30LEE: each sound, effect and feel control changes a pattern render", async () => {
    const setup = (change: Record<string, number>) => () => {
      const ctx = offlineContext(2.4);
      const a = new Acid30lee(ctx);
      for (const p of [0, 1, 2, 3]) a.clearPattern(p);
      // Accents, slides, a swung off-beat and a long gate give every control something to act on.
      [[0, 36, true, false], [2, 43, false, true], [3, 39, true, false], [5, 46, false, true], [7, 36, false, false]].forEach(([i, note, accent, slide]) => a.setStep(0, i as number, { on: true, note: note as number, accent: accent as boolean, slide: slide as boolean }));
      for (const [id, v] of Object.entries({ delay: 0.4, reverb: 0.3, drive: 0.3, crush: 0, fxMix: 0.8, width: 0.4, humanise: 0.5, chance: 0.8, gate: 0.9, swing: 0.3, slideTime: 150 })) a.setParam(id, v);
      a.setSeed(7);
      for (const [id, v] of Object.entries(change)) a.setParam(id, v);
      a.output.connect(ctx.destination);
      a.setPattern(0);
      return { inst: a, play: () => { for (let s = 0; s < 16; s++) a.onStep(s, 0.02 + s * 0.125, 0.125); } };
    };
    const base = await render(setup({}));
    const probe = new Acid30lee(offlineContext(1));
    const failures: string[] = [];
    for (const def of probe.params.filter((p) => p.group !== "Arp")) {
      const current = probe.getParam(def.id);
      const out = await render(setup({ [def.id]: alternative(def, current) }));
      if (distance(base, out) < THRESHOLD) failures.push(def.id);
    }
    expect(failures).toEqual([]);
  }, 120000);

  it("0010110: each sound, layer, effect and glitch control changes a pattern render", async () => {
    const setup = (change: Record<string, number>) => () => {
      const ctx = offlineContext(2.4);
      const l = new Lead0010110(ctx);
      const tone = ctx.createBuffer(1, TEST_RATE, TEST_RATE);
      const d = tone.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 330 * i) / TEST_RATE) * 0.5;
      l.setSample(tone, "asset-x", "tone");
      for (const [id, v] of Object.entries({ l1wave: 1, l3on: 1, noise: 0.2, lfoDepth: 0.5, glide: 0.1, sampleLevel: 0.6, delay: 0.4, reverb: 0.3, chorus: 0.4, drive: 0.3, glitchChance: 0.6, tapeStop: 0.4, cutoff: 3000, resonance: 0.4, filterEnv: 0.6 })) l.setParam(id, v);
      l.setSeed(3);
      for (const [id, v] of Object.entries(change)) l.setParam(id, v);
      l.output.connect(ctx.destination);
      l.setPattern(0);
      return { inst: l, play: () => { for (let s = 0; s < 16; s++) l.onStep(s, 0.02 + s * 0.125, 0.125); } };
    };
    const base = await render(setup({}));
    const probe = new Lead0010110(offlineContext(1));
    // Hold only matters for live key release; the arpeggiator has its own tests (it needs held keys to act on).
    const skip = new Set(["hold"]);
    const failures: string[] = [];
    for (const def of probe.params.filter((p) => p.group !== "Arp" && !skip.has(p.id))) {
      const current = setup({})().inst.getParam(def.id);
      const out = await render(setup({ [def.id]: alternative(def, current) }));
      if (distance(base, out) < THRESHOLD) failures.push(def.id);
    }
    expect(failures).toEqual([]);
  }, 180000);

  it("Galactic One patch A: each oscillator, filter, envelope and movement control changes a held note", async () => {
    const rich: Record<string, number> = {
      "a.o1wave": 2, "a.o2wave": 2, "a.uni": 3, "a.o2lvl": 0.7, "a.sub": 0.3, "a.noise": 0.12, "a.ring": 0.2, "a.xmod": 0.2, "a.fenv": 0.5, "a.drive": 0.2, "a.hpf": 120,
      "a.l1pitch": 0.3, "a.l1cut": 0.3, "a.l1pw": 0.3, "a.l1amp": 0.2, "a.l1delay": 0.3, "a.l1rate": 6,
      "a.m1src": 1, "a.m1dst": 1, "a.m1amt": 0.4, "a.m2src": 2, "a.m2dst": 3, "a.m2amt": 0.4, "a.m3src": 3, "a.m3dst": 6, "a.m3amt": 0.3, "a.m4src": 5, "a.m4dst": 4, "a.m4amt": 0.5,
      "a.penv": 3, "a.fs": 0.5, "a.ar": 0.4, "a.fr": 0.4, "a.res": 0.4,
      "fx.chMode": 0, "fx.dlMix": 0, "fx.rvMix": 0, "fx.fxDrive": 0,
    };
    const setup = (change: Record<string, number>) => () => {
      const ctx = offlineContext(2.2);
      const go = new GalacticOne(ctx);
      for (const [id, v] of Object.entries({ ...rich, ...change })) go.setParam(id, v);
      go.setSeed(5);
      go.setBend(0.5);
      go.setModWheel(1);
      go.output.connect(ctx.destination);
      go.setPattern(null);
      return { inst: go, play: () => go.noteOn({ note: 52, velocity: 0.6, time: 0.02, duration: 0.8 }) };
    };
    const base = await render(setup({}));
    const probe = new GalacticOne(offlineContext(1));
    // Voice mode and glide shape how consecutive notes join, which one held note cannot show; both have their own tests.
    const skip = new Set(["a.mode", "a.glide"]);
    const failures: string[] = [];
    for (const def of probe.params.filter((p) => p.id.startsWith("a.") && !skip.has(p.id))) {
      const current = setup({})().inst.getParam(def.id);
      const out = await render(setup({ [def.id]: alternative(def, current) }));
      if (distance(base, out) < THRESHOLD) failures.push(def.id);
    }
    expect(failures).toEqual([]);
  }, 240000);

  it("Galactic One effects and sequencer feel: each effect control changes the sound", async () => {
    const rich: Record<string, number> = { "a.uni": 3, "fx.gRate": 3, "fx.chMode": 2, "fx.phMix": 0.5, "fx.dlMix": 0.4, "fx.rvMix": 0.4, "fx.apDepth": 0.5, "fx.fxDrive": 0.2, "fx.fxCrush": 0.1 };
    const setup = (change: Record<string, number>) => () => {
      const ctx = offlineContext(2.2);
      const go = new GalacticOne(ctx);
      for (const [id, v] of Object.entries({ ...rich, ...change })) go.setParam(id, v);
      go.output.connect(ctx.destination);
      go.setPattern(null);
      return { inst: go, play: () => go.noteOn({ note: 52, velocity: 0.8, time: 0.02, duration: 0.5 }) };
    };
    const base = await render(setup({}));
    const probe = new GalacticOne(offlineContext(1));
    const failures: string[] = [];
    for (const def of probe.params.filter((p) => p.id.startsWith("fx.") || p.id.startsWith("macro."))) {
      const current = setup({})().inst.getParam(def.id);
      const out = await render(setup({ [def.id]: alternative(def, current) }));
      if (distance(base, out) < THRESHOLD) failures.push(def.id);
    }
    expect(failures).toEqual([]);
  }, 240000);
});

import { describe, expect, it } from "vitest";
import { bounceInstrument, measure } from "../bounce";
import { Lead0010110 } from "./lead0010110";
import { energyAbove, offlineClass, offlineContext, peakFrequency, peakOf, rmsOf, TEST_RATE } from "./synth/testUtils";

const CLEAN: Record<string, number> = { l2on: 0, l3on: 0, sub: 0, noise: 0, delay: 0, reverb: 0, chorus: 0, drive: 0, glide: 0, filterEnv: 0, cutoff: 12000, resonance: 0 };

function make(ctx: BaseAudioContext, settings: Record<string, number> = CLEAN): Lead0010110 {
  const lead = new Lead0010110(ctx);
  for (const [id, value] of Object.entries(settings)) lead.setParam(id, value);
  lead.output.connect(ctx.destination);
  return lead;
}

async function renderNote(settings: Record<string, number>, note = 69, hold = 0.6, seconds = 1.6): Promise<Float32Array> {
  const ctx = offlineContext(seconds);
  const lead = make(ctx, { ...CLEAN, ...settings });
  lead.setPattern(null);
  lead.noteOn({ note, velocity: 0.8, time: 0.05, duration: hold });
  return (await ctx.startRendering()).getChannelData(0).slice();
}

describe("Lead0010110 engine", () => {
  it("plays the pitch it was asked for", async () => {
    const data = await renderNote({});
    expect(Math.abs(peakFrequency(data, Math.floor(0.2 * TEST_RATE), 16384) - 440)).toBeLessThan(4);
  });

  it("layers add octaves and detune", async () => {
    const data = await renderNote({ l2on: 1, l2wave: 3, l2oct: 1, l2detune: 0, l2level: 0.8, l1level: 0.2 });
    expect(Math.abs(peakFrequency(data, Math.floor(0.2 * TEST_RATE), 16384) - 880)).toBeLessThan(8);
  });

  it("releases to silence after the note ends", async () => {
    const data = await renderNote({ release: 0.2 });
    expect(rmsOf(data, Math.floor(0.2 * TEST_RATE), Math.floor(0.5 * TEST_RATE))).toBeGreaterThan(0.02);
    expect(peakOf(data, Math.floor(1.3 * TEST_RATE))).toBeLessThan(0.002);
  });

  it("cutoff changes the spectrum and resonance stays bounded", async () => {
    const bright = await renderNote({ cutoff: 9000 });
    const dark = await renderNote({ cutoff: 300 });
    const at = Math.floor(0.2 * TEST_RATE);
    expect(energyAbove(bright, at, 8192, 2000)).toBeGreaterThan(energyAbove(dark, at, 8192, 2000) * 5);
    const resonant = await renderNote({ cutoff: 600, resonance: 1, level: 1, drive: 1 });
    expect(peakOf(resonant)).toBeLessThan(1);
  });

  it("sub level and noise add energy", async () => {
    const plain = await renderNote({});
    const subbed = await renderNote({ sub: 1 });
    expect(energyAbove(subbed, Math.floor(0.2 * TEST_RATE), 8192, 300)).toBeLessThan(energyAbove(plain, Math.floor(0.2 * TEST_RATE), 8192, 300));
    const noisy = await renderNote({ noise: 0.6 });
    expect(rmsOf(noisy, 8000, 30000)).toBeGreaterThan(rmsOf(plain, 8000, 30000) * 1.03);
  });

  it("lfo depth moves the sound while it was silent before", async () => {
    const still = await renderNote({ lfoDepth: 0, cutoff: 1500 });
    const moving = await renderNote({ lfoDepth: 1, lfoRate: 6, cutoff: 1500 });
    let diff = 0;
    for (let i = 4000; i < 40000; i++) diff += Math.abs(still[i] - moving[i]);
    expect(diff / 36000).toBeGreaterThan(0.005);
  });

  it("chorus, delay and reverb each change the output", async () => {
    const dry = await renderNote({});
    const variants: Record<string, number>[] = [{ chorus: 0.8 }, { delay: 0.8, delayFb: 0.6 }, { reverb: 0.8 }];
    for (const settings of variants) {
      const wet = await renderNote(settings);
      let d = 0;
      for (let i = 0; i < dry.length; i++) d += Math.abs(dry[i] - wet[i]);
      expect(d / dry.length, JSON.stringify(settings)).toBeGreaterThan(0.001);
    }
  });

  it("holds notes after key up while Hold is on, then lets them go", async () => {
    const ctx = offlineContext(2);
    const lead = make(ctx, { ...CLEAN, hold: 1, release: 0.1 });
    lead.setPattern(null);
    lead.noteOn({ note: 60, velocity: 0.8 });
    lead.noteOff(60, 0.2);
    expect(lead.activeVoiceCount).toBe(1);
    const data = (await ctx.startRendering()).getChannelData(0).slice();
    expect(rmsOf(data, Math.floor(0.5 * TEST_RATE), Math.floor(1.5 * TEST_RATE))).toBeGreaterThan(0.02);
  });

  it("forgets every voice once its tail has played, so nodes do not pile up", async () => {
    const ctx = offlineContext(3);
    const lead = make(ctx, { ...CLEAN, release: 0.1 });
    lead.setPattern(null);
    for (let n = 0; n < 6; n++) lead.noteOn({ note: 48 + n, velocity: 0.8, time: n * 0.2, duration: 0.1 });
    const held = lead as unknown as { voices: unknown[] };
    expect(held.voices.length).toBeGreaterThan(0);
    await ctx.startRendering();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(held.voices.length).toBe(0);
  });

  it("steals the oldest voice beyond the limit", () => {
    const ctx = offlineContext(1);
    const lead = make(ctx);
    lead.setPattern(null);
    for (let n = 0; n < 20; n++) lead.noteOn({ note: 40 + n, velocity: 0.8 });
    expect(lead.activeVoiceCount).toBeLessThanOrEqual(8);
    lead.allNotesOff();
    expect(lead.activeVoiceCount).toBe(0);
  });

  it("plays the sample layer pitched from C4", async () => {
    const ctx = offlineContext(1.5);
    const lead = make(ctx, { ...CLEAN, l1level: 0, l2on: 0, sampleLevel: 1 });
    const tone = ctx.createBuffer(1, TEST_RATE, TEST_RATE);
    const d = tone.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 220 * i) / TEST_RATE);
    lead.setSample(tone, "asset-test", "Sine 220");
    lead.setPattern(null);
    lead.noteOn({ note: 72, velocity: 1, time: 0.05, duration: 0.9 });
    const data = (await ctx.startRendering()).getChannelData(0).slice();
    expect(Math.abs(peakFrequency(data, Math.floor(0.2 * TEST_RATE), 16384) - 440)).toBeLessThan(5);
    expect(lead.serialize().data).toMatchObject({ sample: { assetId: "asset-test", name: "Sine 220" } });
  });
});

describe("Lead0010110 pattern", () => {
  const bounce = (setup: (l: Lead0010110) => void, bars = 1) => {
    const lead = new Lead0010110(offlineContext(1));
    setup(lead);
    return bounceInstrument((c) => new Lead0010110(c), lead.serialize(), { bars, bpm: 120, offlineContext: offlineClass, tailSeconds: 0.5 });
  };

  it("plays degrees on their steps in the chosen scale", async () => {
    const buffer = await bounce((l) => {
      for (const [id, v] of Object.entries({ ...CLEAN, root: 9, octave: 3, scale: 2, release: 0.02, decay: 0.05, sustain: 1 })) l.setParam(id, v);
      l.clearSteps();
      l.setDegree(0, 1);
      l.setDegree(4, 3);
      l.setPattern(0);
    });
    const data = buffer.getChannelData(0).slice();
    const step = (60 / 120 / 4) * buffer.sampleRate;
    expect(peakOf(data, Math.floor(step * 2.2), Math.floor(step * 3.8))).toBeLessThan(0.001);
    const first = peakFrequency(data, Math.floor(step * 0.3), 4096);
    const third = peakFrequency(data, Math.floor(step * 4.3), 4096);
    // A minor from A3: degree 1 is 220 Hz, degree 3 is C4.
    expect(Math.abs(first - 220)).toBeLessThan(12);
    expect(Math.abs(third - 261.6)).toBeLessThan(14);
  });

  it("loop length, which the old app ignored, shortens the cycle", async () => {
    const run = (loop: number) =>
      bounce(
        (l) => {
          for (const [id, v] of Object.entries({ ...CLEAN, loop })) l.setParam(id, v);
          l.clearSteps();
          l.setDegree(0, 1);
          l.setDegree(6, 1);
          l.setPattern(0);
        },
        2,
      );
    const short = (await run(0)).getChannelData(0).slice();
    const long = (await run(3)).getChannelData(0).slice();
    const step = (60 / 120 / 4) * 44100;
    // With a 4-step loop step 4 restarts the pattern and sounds; with 16 steps it stays silent.
    expect(peakOf(short, Math.floor(step * 4.1), Math.floor(step * 5))).toBeGreaterThan(0.05);
    expect(peakOf(long, Math.floor(step * 4.1), Math.floor(step * 5))).toBeLessThan(0.001);
  });

  it("silences the pattern with setPattern(null) but leaves live notes", async () => {
    const ctx = offlineContext(1.5);
    const lead = make(ctx);
    lead.setPattern(null);
    for (let s = 0; s < 8; s++) lead.onStep(s, s * 0.125, 0.125);
    lead.noteOn({ note: 60, velocity: 0.8, time: 0.6, duration: 0.3 });
    const data = (await ctx.startRendering()).getChannelData(0).slice();
    expect(peakOf(data, 0, Math.floor(0.55 * TEST_RATE))).toBeLessThan(0.001);
    expect(peakOf(data, Math.floor(0.7 * TEST_RATE), Math.floor(0.85 * TEST_RATE))).toBeGreaterThan(0.02);
  });

  it("arp swing, previously dead, delays every second note", () => {
    const times = (swing: number) => {
      const ctx = offlineContext(2);
      const lead = make(ctx, { ...CLEAN, arpOn: 1, arpRate: 3, arpSwing: swing, arpOct: 1 });
      lead.setPattern(null);
      const seen: number[] = [];
      const hook = lead as unknown as { makeVoice: (...a: unknown[]) => unknown };
      const real = hook.makeVoice.bind(lead);
      hook.makeVoice = (note, vel, when, dur, seq) => {
        seen.push(when as number);
        return real(note, vel, when, dur, seq);
      };
      lead.noteOn({ note: 60, velocity: 0.8 });
      seen.length = 0;
      lead.onStep(0, 0.1, 0.125);
      lead.onStep(1, 0.225, 0.125);
      lead.onStep(2, 0.35, 0.125);
      return seen;
    };
    const straight = times(0);
    const swung = times(0.4);
    expect(straight.length).toBeGreaterThanOrEqual(3);
    expect(swung[0]).toBeCloseTo(straight[0], 6);
    expect(swung[1] - straight[1]).toBeGreaterThan(0.04);
  });

  it("latch keeps the arp running after the keys are released", () => {
    const ctx = offlineContext(2);
    const lead = make(ctx, { ...CLEAN, arpOn: 1, arpLatch: 1, arpRate: 3 });
    lead.setPattern(null);
    lead.noteOn({ note: 60, velocity: 0.8 });
    lead.noteOff(60);
    lead.onStep(0, 0.1, 0.125);
    expect(lead.activeVoiceCount).toBeGreaterThan(0);
    lead.setParam("arpLatch", 0);
    lead.allNotesOff();
    lead.onStep(1, 0.225, 0.125);
    expect(lead.activeVoiceCount).toBe(0);
  });

  it("glitch with a fixed seed is reproducible and changes the rhythm", async () => {
    const run = (seed: number, chance: number) =>
      bounce((l) => {
        for (const [id, v] of Object.entries({ ...CLEAN, glitchChance: chance, glitchSize: 1 })) l.setParam(id, v);
        l.setSeed(seed);
        l.setPattern(0);
      });
    const a = (await run(9, 0.6)).getChannelData(0).slice();
    const b = (await run(9, 0.6)).getChannelData(0).slice();
    const plain = (await run(9, 0)).getChannelData(0).slice();
    expect(Array.from(a.slice(0, 30000))).toEqual(Array.from(b.slice(0, 30000)));
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - plain[i]);
    expect(diff).toBeGreaterThan(1);
  });

  it("round-trips pattern, accents and seed", () => {
    const a = new Lead0010110(offlineContext(1));
    a.setDegree(3, 7);
    a.toggleAccent(3);
    a.setSeed(77);
    a.setPattern(null);
    const b = new Lead0010110(offlineContext(1));
    b.restore(JSON.parse(JSON.stringify(a.serialize())));
    expect(b.getDegrees()[3]).toBe(7);
    expect(b.getAccents()[3]).not.toBe(new Lead0010110(offlineContext(1)).getAccents()[3]);
    expect(b.currentSeed).toBe(77);
    expect(b.activePattern).toBeNull();
  });

  it("rejects damaged pattern data loudly", () => {
    const lead = new Lead0010110(offlineContext(1));
    expect(() => lead.restore({ kind: "lead0010110", values: {}, data: "nope" })).toThrow(/damaged/);
  });

  it("every factory preset loads and stays below full scale", async () => {
    for (const preset of new Lead0010110(offlineContext(1)).presets) {
      const buffer = await bounce((l) => {
        l.loadPreset(preset.id);
        l.setPattern(0);
      });
      const { peak, rms } = measure(buffer);
      expect(peak, preset.name).toBeLessThan(1);
      expect(rms, preset.name).toBeGreaterThan(0.002);
    }
  });
});

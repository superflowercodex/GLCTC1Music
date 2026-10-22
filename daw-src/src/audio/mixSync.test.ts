import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import { afterEach, describe, expect, it } from "vitest";
import { makeTrack } from "../project/actions";
import { newProject, type Insert, type Project } from "../project/model";
import { projectStore } from "../store/project";
import { Engine } from "./engine";
import { applyProjectMix, attachMixSync, setSongOffsetDb } from "./mixSync";

const RATE = 44100;

function setup(seconds = 1): { ctx: OfflineAudioContext; engine: Engine } {
  const ctx = new NodeOfflineContext(2, Math.ceil(seconds * RATE), RATE) as unknown as OfflineAudioContext;
  return { ctx, engine: new Engine(ctx) };
}

function projectWith(patch: Partial<ReturnType<typeof makeTrack>> = {}, master: Partial<Project["master"]> = {}): { project: Project; trackId: string } {
  const base = newProject("t");
  const track = makeTrack(base, "audio", patch);
  return { project: { ...base, tracks: [track], master: { ...base.master, ...master } }, trackId: track.id };
}

function tone(ctx: BaseAudioContext, freq: number, amp: number, to: AudioNode, burstSec?: number): void {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = amp;
  if (burstSec) g.gain.setValueAtTime(0, burstSec);
  osc.connect(g).connect(to);
  osc.start();
}

const rms = (d: Float32Array, from: number, to = d.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (d: Float32Array, from = 0): number => {
  let p = 0;
  for (let i = from; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
};
const SETTLE = Math.floor(0.4 * RATE);

async function renderTone(project: Project, trackId: string, freq = 440, amp = 0.4, seconds = 1, burst?: number): Promise<Float32Array> {
  const { ctx, engine } = setup(seconds);
  applyProjectMix(engine, project, { monitor: false });
  tone(ctx, freq, amp, engine.bus(trackId).input, burst);
  return (await ctx.startRendering()).getChannelData(0).slice();
}

describe("track routing", () => {
  it("send-to-master off silences the track", async () => {
    const on = projectWith();
    const off = projectWith({ toMaster: false });
    expect(rms(await renderTone(on.project, on.trackId), SETTLE)).toBeGreaterThan(0.1);
    expect(rms(await renderTone(off.project, off.trackId), SETTLE)).toBe(0);
  });

  it("the reverb send adds a tail the dry track does not have", async () => {
    const dry = projectWith();
    const wet = projectWith({ sends: { reverb: 1, delay: 0 } });
    const tail = Math.floor(1.5 * RATE);
    const a = await renderTone(dry.project, dry.trackId, 440, 0.4, 2.5, 0.3);
    const b = await renderTone(wet.project, wet.trackId, 440, 0.4, 2.5, 0.3);
    expect(rms(a, tail)).toBe(0);
    expect(rms(b, tail)).toBeGreaterThan(0.0005);
  });

  it("the delay send echoes", async () => {
    const wet = projectWith({ sends: { reverb: 0, delay: 1 } });
    const out = await renderTone(wet.project, wet.trackId, 440, 0.4, 3, 0.2);
    // Dotted eighth at 120 bpm is 375 ms: the first echo lands at 0.575 s while the source is silent.
    expect(rms(out, Math.floor(0.65 * RATE), Math.floor(0.85 * RATE))).toBeGreaterThan(0.01);
  });

  it("cue sends the track to the headphone bus", async () => {
    for (const cue of [true, false]) {
      const { project, trackId } = projectWith({ cue });
      const { ctx, engine } = setup();
      applyProjectMix(engine, project, { monitor: false });
      const probe = ctx.createGain();
      engine.section.cueInput.connect(probe).connect(ctx.destination);
      engine.bus(trackId).masterSend.disconnect();
      tone(ctx, 440, 0.4, engine.bus(trackId).input);
      const out = (await ctx.startRendering()).getChannelData(0);
      if (cue) expect(rms(out, SETTLE)).toBeGreaterThan(0.1);
      else expect(rms(out, SETTLE)).toBe(0);
    }
  });

  it("mute and solo reach the bus", () => {
    const { engine } = setup();
    const base = newProject("t");
    const a = makeTrack(base, "audio", { muted: true });
    const b = makeTrack(base, "audio");
    const c = makeTrack(base, "audio", { solo: true });
    applyProjectMix(engine, { ...base, tracks: [a, b, c] }, { monitor: false });
    expect(engine.bus(a.id).output.gain.value).toBe(0);
    expect(engine.bus(b.id).output.gain.value).toBe(0);
    expect(engine.bus(c.id).output.gain.value).toBe(1);
  });
});

describe("insert chain", () => {
  const lowpass = (id: string, bypass = false): Insert => ({ id, type: "filter", bypass, params: { mode: 0, cutoff: 300, resonance: 0.7 } });

  it("runs inserts in order and skips bypassed ones", async () => {
    const processed = projectWith({ inserts: [lowpass("i1")] });
    const bypassed = projectWith({ inserts: [lowpass("i1", true)] });
    expect(rms(await renderTone(processed.project, processed.trackId, 6000), SETTLE)).toBeLessThan(0.02);
    expect(rms(await renderTone(bypassed.project, bypassed.trackId, 6000), SETTLE)).toBeGreaterThan(0.15);
  });

  it("keeps an effect's state when the list is edited", () => {
    const { engine } = setup();
    const { project, trackId } = projectWith({ inserts: [lowpass("i1"), { id: "i2", type: "eq", bypass: false, params: {} }] });
    applyProjectMix(engine, project, { monitor: false });
    const bus = engine.bus(trackId);
    const before = (bus as unknown as { chain: Array<{ effect: unknown }> }).chain.map((c) => c.effect);
    const reordered = { ...project, tracks: [{ ...project.tracks[0], inserts: [project.tracks[0].inserts[1], { ...project.tracks[0].inserts[0], params: { ...project.tracks[0].inserts[0].params, cutoff: 900 } }] }] };
    applyProjectMix(engine, reordered, { monitor: false });
    const after = (bus as unknown as { chain: Array<{ effect: unknown }> }).chain.map((c) => c.effect);
    expect(after).toEqual([before[1], before[0]]);
    expect(after[0]).toBe(before[1]);
  });

  it("removes effects that are no longer in the list", () => {
    const { engine } = setup();
    const { project, trackId } = projectWith({ inserts: [lowpass("i1")] });
    applyProjectMix(engine, project, { monitor: false });
    applyProjectMix(engine, { ...project, tracks: [{ ...project.tracks[0], inserts: [] }] }, { monitor: false });
    expect((engine.bus(trackId) as unknown as { chain: unknown[] }).chain).toHaveLength(0);
  });
});

describe("master section", () => {
  it("master filter cuts highs only when on", async () => {
    const off = projectWith({}, { filterOn: false, filterHz: 500 });
    const on = projectWith({}, { filterOn: true, filterHz: 500 });
    const hiOff = rms(await renderTone(off.project, off.trackId, 8000), SETTLE);
    const hiOn = rms(await renderTone(on.project, on.trackId, 8000), SETTLE);
    expect(hiOff).toBeGreaterThan(0.15);
    expect(hiOn).toBeLessThan(hiOff * 0.1);
  });

  it("master reverb and delay add a tail only when switched on, using the saved mix", async () => {
    const burst = 0.2;
    const tailFrom = Math.floor(1.2 * RATE);
    const off = projectWith({}, { reverbOn: false, reverbMix: 0.8 });
    const on = projectWith({}, { reverbOn: true, reverbMix: 0.8 });
    expect(rms(await renderTone(off.project, off.trackId, 440, 0.4, 2.5, burst), tailFrom)).toBe(0);
    expect(rms(await renderTone(on.project, on.trackId, 440, 0.4, 2.5, burst), tailFrom)).toBeGreaterThan(0.0005);
    const delayOn = projectWith({}, { delayOn: true, delayMix: 0.5 });
    const out = await renderTone(delayOn.project, delayOn.trackId, 440, 0.4, 2, burst);
    expect(rms(out, Math.floor(0.62 * RATE), Math.floor(0.8 * RATE))).toBeGreaterThan(0.01);
  });

  it("master gain scales the mix", async () => {
    const unity = projectWith({}, { gainDb: 0 });
    const quiet = projectWith({}, { gainDb: -12 });
    const a = rms(await renderTone(unity.project, unity.trackId), SETTLE);
    const b = rms(await renderTone(quiet.project, quiet.trackId), SETTLE);
    expect(b / a).toBeCloseTo(10 ** (-12 / 20), 1);
  });

  it("limiter keeps a hot mix under full scale and passes it untouched when off", async () => {
    const hotOn = projectWith({ gainDb: 6 }, { limiter: true });
    const hotOff = projectWith({ gainDb: 6 }, { limiter: false });
    const run = async (p: { project: Project; trackId: string }): Promise<Float32Array> => {
      const { ctx, engine } = setup();
      applyProjectMix(engine, p.project, { monitor: false });
      tone(ctx, 440, 1.0, engine.bus(p.trackId).input);
      tone(ctx, 660, 0.9, engine.bus(p.trackId).input);
      return (await ctx.startRendering()).getChannelData(0).slice();
    };
    const on = await run(hotOn);
    const off = await run(hotOff);
    expect(peak(on, SETTLE)).toBeLessThanOrEqual(1.0001);
    expect(peak(off, SETTLE)).toBeGreaterThan(1.3);
  });

  it("limiter off does not change quiet material", async () => {
    const a = projectWith({}, { limiter: true });
    const b = projectWith({}, { limiter: false });
    const ra = rms(await renderTone(a.project, a.trackId, 440, 0.2), SETTLE);
    const rb = rms(await renderTone(b.project, b.trackId, 440, 0.2), SETTLE);
    expect(ra / rb).toBeGreaterThan(0.98);
    expect(ra / rb).toBeLessThan(1.02);
  });
});

describe("attachMixSync", () => {
  afterEach(() => projectStore.set(newProject()));

  it("follows project edits and new buses", () => {
    const { engine } = setup();
    const { project, trackId } = projectWith({ gainDb: -6 });
    projectStore.set(project);
    const stop = attachMixSync(engine);
    expect(engine.bus(trackId).output.gain.value).toBeCloseTo(10 ** (-6 / 20), 5);
    projectStore.set((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, gainDb: -12, sends: { reverb: 0.5, delay: 0.25 } })) }));
    expect(engine.bus(trackId).output.gain.value).toBeCloseTo(10 ** (-12 / 20), 5);
    expect(engine.bus(trackId).reverbSend.gain.value).toBeCloseTo(0.5, 5);
    expect(engine.bus(trackId).delaySend.gain.value).toBeCloseTo(0.25, 5);
    const added = makeTrack(projectStore.get(), "audio", { pan: -0.5 });
    projectStore.set((p) => ({ ...p, tracks: [...p.tracks, added] }));
    expect(engine.bus(added.id).panner.pan.value).toBeCloseTo(-0.5, 5);
    stop();
    projectStore.set((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, gainDb: 0 })) }));
    expect(engine.bus(trackId).output.gain.value).toBeCloseTo(10 ** (-12 / 20), 5);
  });

  it("saves master values in the project shape, not in the sliders", () => {
    const { engine } = setup();
    projectStore.set(newProject());
    const stop = attachMixSync(engine);
    projectStore.set((p) => ({ ...p, master: { ...p.master, filterOn: true, filterHz: 1234, delayOn: true, delayMix: 0.6, reverbOn: true, reverbMix: 0.7, gainDb: -3 } }));
    expect(engine.section.input.gain.value).toBeCloseTo(10 ** (-3 / 20), 5);
    expect((engine.section as unknown as { filter: BiquadFilterNode }).filter.frequency.value).toBeCloseTo(1234, 3);
    stop();
  });
});

describe("song level offset", () => {
  it("rides on top of the mixer fader in live mixes and never reaches an export", () => {
    const { project, trackId } = projectWith({ gainDb: -6 });
    const { engine } = setup();
    const gains: number[] = [];
    const bus = engine.bus(trackId);
    const original = bus.setGainDb.bind(bus);
    bus.setGainDb = (db: number) => {
      gains.push(db);
      original(db);
    };
    setSongOffsetDb(trackId, -3);
    applyProjectMix(engine, project, { monitor: true });
    expect(gains.at(-1)).toBe(-9);
    applyProjectMix(engine, { ...project, tracks: [{ ...project.tracks[0], gainDb: -2 }] }, { monitor: true });
    expect(gains.at(-1)).toBe(-5);
    applyProjectMix(engine, project, { monitor: false });
    expect(gains.at(-1)).toBe(-6);
    setSongOffsetDb(trackId, null);
    applyProjectMix(engine, project, { monitor: true });
    expect(gains.at(-1)).toBe(-6);
  });
});

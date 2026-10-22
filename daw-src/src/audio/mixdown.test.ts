import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import { makeClip, makeTrack } from "../project/actions";
import { newProject, type Project } from "../project/model";
import { InstrumentBase } from "./instrument";
import { mixdownProject, mixdownStems, MixdownCancelled, MixdownError, planMixdown, type MixdownDeps } from "./mixdown";
import type { ScheduleOptions } from "./clipPlayer";
import type { Instrument, ParamDef } from "./types";

const RATE = 22050;
const offlineContext = NodeOfflineContext as unknown as MixdownDeps["offlineContext"];

class Blip extends InstrumentBase {
  readonly kind = "drum80la8" as const;
  pattern: number | null = null;
  steps = 0;
  constructor(ctx: BaseAudioContext) {
    super(ctx, [{ id: "level", label: "Level", group: "Output", min: 0, max: 1, def: 0.8 }] satisfies readonly ParamDef[], [], "test-mixdown-blip");
  }
  protected onParam(id: string, value: number): void {
    if (id === "level") this.output.gain.value = value;
  }
  override get patternCount(): number {
    return 2;
  }
  override get activePattern(): number | null {
    return this.pattern;
  }
  override setPattern(index: number | null): void {
    this.pattern = index;
  }
  override onStep(_step: number, time: number, stepDur: number): void {
    this.steps += 1;
    if (this.pattern === null) return;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = 220;
    osc.connect(this.output);
    osc.start(time);
    osc.stop(time + stepDur * 0.9);
  }
}

function sine(seconds: number, amp = 0.5, freq = 440): AudioBuffer {
  const ctx = new NodeOfflineContext(1, 1, RATE) as unknown as OfflineAudioContext;
  const buffer = ctx.createBuffer(1, Math.floor(seconds * RATE), RATE);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE);
  return buffer;
}

/** The real clip scheduler is another module's job; this stands in with the same contract. */
function fakeScheduleClips(ctx: BaseAudioContext, project: Project, options: ScheduleOptions) {
  const barSec = (project.beatsPerBar * 60) / project.bpm;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const buffer = clip.assetId ? options.buffers.get(clip.assetId) : undefined;
      if (clip.kind !== "audio" || !buffer) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(options.destinationFor(track.id));
      src.start(Math.max(0, (clip.startBar - 1) * barSec - options.fromSec));
    }
  }
  return { stop() {} };
}

interface Built {
  project: Project;
  audioTrackId: string;
  instTrackId: string;
}

function build(patch: { audio?: Partial<ReturnType<typeof makeTrack>>; inst?: Partial<ReturnType<typeof makeTrack>> } = {}): Built {
  let project = newProject("Test");
  const audio = makeTrack(project, "audio", { name: "Sine", ...patch.audio });
  audio.clips = [makeClip({ kind: "audio", startBar: 1, lengthBars: 2, assetId: "a1", name: "sine" })];
  project = { ...project, tracks: [audio] };
  const inst = makeTrack(project, "instrument", { name: "Blip", slotId: "slot-1", ...patch.inst });
  inst.clips = [makeClip({ kind: "pattern", startBar: 1, lengthBars: 1, patternIndex: 0 })];
  project = {
    ...project,
    tracks: [audio, inst],
    instruments: [{ id: "slot-1", kind: "drum80la8", trackId: inst.id, state: { kind: "drum80la8", values: { level: 0.8 } } }],
  };
  return { project, audioTrackId: audio.id, instTrackId: inst.id };
}

const buffers: Record<string, AudioBuffer> = { a1: sine(4) };
const deps: Partial<MixdownDeps> = {
  offlineContext,
  createInstrument: async (_kind, ctx): Promise<Instrument> => new Blip(ctx),
  loadBuffer: async (id) => buffers[id],
  scheduleClips: fakeScheduleClips,
  prepareWarped: async () => new Map(),
};
const base = { sampleRate: RATE, tailSeconds: 0, deps };

const rms = (buffer: AudioBuffer, ch: number, fromSec: number, toSec: number): number => {
  const d = buffer.getChannelData(ch);
  const a = Math.floor(fromSec * RATE);
  const b = Math.floor(toSec * RATE);
  let s = 0;
  for (let i = a; i < b; i++) s += d[i] * d[i];
  return Math.sqrt(s / (b - a));
};
// A mono sine of amplitude .5 panned to the centre: each side carries .5 * cos(pi/4), so rms = .25.
const CENTRE_RMS = 0.25;

describe("planMixdown", () => {
  it("covers the last clip", () => {
    const plan = planMixdown(build().project, { tailSeconds: 1 });
    expect(plan.durationSec).toBeCloseTo(4, 6);
    expect(plan.totalSec).toBeCloseTo(5, 6);
  });

  it("reports an empty project instead of rendering silence", () => {
    expect(() => planMixdown(newProject())).toThrow(MixdownError);
  });

  it("uses the loop region", () => {
    const { project } = build();
    const plan = planMixdown({ ...project, loop: { on: true, startBar: 2, endBar: 3 } }, { range: { kind: "loop" } });
    expect(plan.durationSec).toBeCloseTo(2, 6);
    expect(plan.startStep).toBe(16);
  });

  it("rejects empty ranges", () => {
    expect(() => planMixdown(build().project, { range: { kind: "bars", startBar: 3, endBar: 3 } })).toThrow(MixdownError);
  });
});

describe("mixdownProject", () => {
  it("renders the whole project at the expected length", async () => {
    const out = await mixdownProject(build().project, base);
    expect(out.length).toBe(4 * RATE);
    expect(out.numberOfChannels).toBe(2);
    expect(out.sampleRate).toBe(RATE);
    const withTail = await mixdownProject(build().project, { ...base, tailSeconds: 1 });
    expect(withTail.length).toBe(5 * RATE);
  });

  it("mixes the audio clip and the instrument, and nothing is NaN", async () => {
    const out = await mixdownProject(build().project, base);
    for (let c = 0; c < 2; c++) for (const v of out.getChannelData(c)) expect(Number.isFinite(v)).toBe(true);
    // Bar 1 has the clip and the pattern; bar 2 only the clip, because the pattern clip ends there.
    expect(rms(out, 0, 0.1, 1.9)).toBeGreaterThan(rms(out, 0, 2.1, 3.9) + 0.02);
    expect(rms(out, 0, 2.1, 3.9)).toBeGreaterThan(CENTRE_RMS * 0.9);
    expect(rms(out, 0, 2.1, 3.9)).toBeLessThan(CENTRE_RMS * 1.1);
  });

  it("works with the real clip scheduler: gain, fades and trim", async () => {
    const { project } = build({ audio: { gainDb: 0 } });
    project.tracks[0].clips[0] = { ...project.tracks[0].clips[0], gainDb: -6, fadeInSteps: 0, offsetSec: 0 };
    const real: Partial<MixdownDeps> = { offlineContext, createInstrument: deps.createInstrument, loadBuffer: deps.loadBuffer };
    const out = await mixdownProject(project, { ...base, includeInstruments: false, deps: real });
    expect(out.length).toBe(4 * RATE);
    expect(rms(out, 0, 0.5, 3.5) / CENTRE_RMS).toBeCloseTo(10 ** (-6 / 20), 1);
  });

  it("honours the fader", async () => {
    const out = await mixdownProject(build({ audio: { gainDb: -6 } }).project, base);
    expect(rms(out, 0, 2.1, 3.9) / CENTRE_RMS).toBeCloseTo(10 ** (-6 / 20), 1);
  });

  it("honours pan", async () => {
    const out = await mixdownProject(build({ audio: { pan: -1 } }).project, base);
    expect(rms(out, 0, 2.1, 3.9)).toBeCloseTo(0.5 * Math.SQRT1_2, 1);
    expect(rms(out, 1, 2.1, 3.9)).toBeLessThan(0.005);
  });

  it("honours mute", async () => {
    const out = await mixdownProject(build({ audio: { muted: true } }).project, base);
    expect(rms(out, 0, 2.1, 3.9)).toBeLessThan(0.001);
    expect(rms(out, 0, 0.1, 1.9)).toBeGreaterThan(0.01);
  });

  it("honours solo", async () => {
    const out = await mixdownProject(build({ inst: { solo: true } }).project, base);
    expect(rms(out, 0, 2.1, 3.9)).toBeLessThan(0.001);
    expect(rms(out, 0, 0.1, 1.9)).toBeGreaterThan(0.01);
  });

  it("can leave instruments out", async () => {
    const withInst = await mixdownProject(build().project, base);
    const without = await mixdownProject(build().project, { ...base, includeInstruments: false });
    expect(rms(without, 0, 0.1, 1.9)).toBeLessThan(rms(withInst, 0, 0.1, 1.9));
    expect(rms(without, 0, 0.1, 1.9)).toBeGreaterThan(CENTRE_RMS * 0.9);
  });

  it("renders only the chosen range", async () => {
    const out = await mixdownProject(build().project, { ...base, range: { kind: "bars", startBar: 2, endBar: 3 } });
    expect(out.length).toBe(2 * RATE);
    expect(rms(out, 0, 0.1, 1.9)).toBeGreaterThan(CENTRE_RMS * 0.9);
  });

  it("equals a hand-built graph with the same settings", async () => {
    const { project } = build({ audio: { gainDb: -6, pan: 0.5 } });
    const out = await mixdownProject(project, { ...base, includeInstruments: false });
    const ctx = new NodeOfflineContext(2, 4 * RATE, RATE) as unknown as OfflineAudioContext;
    const src = ctx.createBufferSource();
    src.buffer = buffers.a1;
    const gain = ctx.createGain();
    gain.gain.value = 10 ** (-6 / 20);
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0.5;
    src.connect(gain).connect(pan).connect(ctx.destination);
    src.start(0);
    const manual = await ctx.startRendering();
    // The master limiter's look-ahead delays the render by a few milliseconds; find that shift first.
    const a = out.getChannelData(0);
    const b = manual.getChannelData(0);
    let best = Infinity;
    for (let shift = 0; shift < 800; shift++) {
      let err = 0;
      for (let i = 4000; i < 6000; i++) err += Math.abs(a[i + shift] - b[i]);
      best = Math.min(best, err);
    }
    expect(best / 2000).toBeLessThan(0.005);
  });

  it("reports progress and finishes at 1", async () => {
    const seen: number[] = [];
    const longBuffers = { a1: sine(16) };
    const longProject = build().project;
    longProject.tracks[0].clips[0].lengthBars = 8;
    await mixdownProject(longProject, { ...base, onProgress: (f) => seen.push(f), deps: { ...deps, loadBuffer: async (id) => longBuffers[id as "a1"] } });
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBeGreaterThan(3);
    expect([...seen].sort((x, y) => x - y)).toEqual(seen);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    const longProject = build().project;
    longProject.tracks[0].clips[0].lengthBars = 8;
    const run = mixdownProject(longProject, {
      ...base,
      signal: controller.signal,
      onProgress: (f) => {
        if (f > 0.05) controller.abort();
      },
      deps: { ...deps, loadBuffer: async () => sine(16) },
    });
    await expect(run).rejects.toBeInstanceOf(MixdownCancelled);
    await expect(mixdownProject(build().project, { ...base, signal: controller.signal })).rejects.toBeInstanceOf(MixdownCancelled);
  });

  it("refuses to export with a missing audio file instead of leaving it out silently", async () => {
    await expect(mixdownProject(build().project, { ...base, deps: { ...deps, loadBuffer: async () => undefined } })).rejects.toThrow(/missing/);
  });
});

describe("mixdownStems", () => {
  it("renders one file per unmuted track, each with only its own sound", async () => {
    const stems = await mixdownStems(build().project, base);
    expect(stems.map((s) => s.name)).toEqual(["Sine", "Blip"]);
    const audio = stems[0].buffer;
    const inst = stems[1].buffer;
    expect(audio.length).toBe(4 * RATE);
    expect(rms(audio, 0, 2.1, 3.9)).toBeGreaterThan(CENTRE_RMS * 0.9);
    expect(rms(inst, 0, 2.1, 3.9)).toBeLessThan(0.001);
    expect(rms(inst, 0, 0.1, 1.9)).toBeGreaterThan(0.01);
  });

  it("skips muted tracks", async () => {
    const stems = await mixdownStems(build({ audio: { muted: true } }).project, base);
    expect(stems.map((s) => s.name)).toEqual(["Blip"]);
  });
});

describe("song source", () => {
  it("plays the pattern chosen for each section and nothing outside it", async () => {
    const { project, instTrackId } = build();
    const song: Project = {
      ...project,
      tracks: project.tracks.filter((t) => t.id === instTrackId),
      song: { sections: [{ id: "s1", name: "A", bars: 1 }, { id: "s2", name: "B", bars: 1 }], matrix: { "slot-1": [1, 0] }, levels: { "slot-1": 1 } },
    };
    const out = await mixdownProject(song, { ...base, source: "song" });
    expect(out.length).toBe(4 * RATE);
    expect(rms(out, 0, 0.1, 1.9)).toBeGreaterThan(0.01);
    expect(rms(out, 0, 2.1, 3.9)).toBeLessThan(0.001);
  });
});

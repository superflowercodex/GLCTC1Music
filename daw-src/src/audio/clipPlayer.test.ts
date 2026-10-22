import { OfflineAudioContext as NodeOfflineContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addClip, addTrack, makeClip, makeTrack } from "../project/actions";
import { newProject, type Clip, type Project } from "../project/model";
import { clipEnvelope, patternAtStep, scheduleAudioClips, slotIsArranged } from "./clipPlayer";

const SR = 8000;

function offline(seconds: number): OfflineAudioContext {
  return new NodeOfflineContext(1, Math.ceil(seconds * SR), SR) as unknown as OfflineAudioContext;
}

function constantBuffer(ctx: BaseAudioContext, seconds: number, value = 0.5): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
  b.getChannelData(0).fill(value);
  return b;
}

function projectWith(clip: Partial<Clip>): { project: Project; trackId: string } {
  let p: Project = { ...newProject(), bpm: 120 };
  const t = makeTrack(p, "audio");
  p = addTrack(p, t);
  p = addClip(p, t.id, makeClip({ kind: "audio", startBar: 2, lengthBars: 1, assetId: "a", ...clip }));
  return { project: p, trackId: t.id };
}

async function render(ctx: OfflineAudioContext): Promise<Float32Array> {
  return (await ctx.startRendering()).getChannelData(0);
}

const at = (data: Float32Array, sec: number) => data[Math.floor(sec * SR)];

describe("scheduleAudioClips", () => {
  it("plays a clip only inside its bar range, at its gain", async () => {
    const ctx = offline(6);
    const { project } = projectWith({ gainDb: -6.0206 });
    scheduleAudioClips(ctx, project, {
      destinationFor: () => ctx.destination,
      buffers: new Map([["a", constantBuffer(ctx, 4)]]),
      fromSec: 0,
      atTime: 0,
    });
    const out = await render(ctx);
    expect(at(out, 1)).toBe(0);
    expect(at(out, 3)).toBeCloseTo(0.25, 2);
    expect(at(out, 4.5)).toBe(0);
  });

  it("joins a clip part-way when starting inside it", async () => {
    const ctx = offline(3);
    const { project } = projectWith({});
    scheduleAudioClips(ctx, project, {
      destinationFor: () => ctx.destination,
      buffers: new Map([["a", constantBuffer(ctx, 4)]]),
      fromSec: 3,
      atTime: 0,
    });
    const out = await render(ctx);
    expect(at(out, 0.5)).toBeCloseTo(0.5, 2);
    expect(at(out, 1.5)).toBe(0);
  });

  it("reads the source from the clip's trim offset", async () => {
    const ctx = offline(5);
    const buffer = ctx.createBuffer(1, 4 * SR, SR);
    const d = buffer.getChannelData(0);
    d.fill(0.2);
    d.fill(0.8, 1 * SR);
    const { project } = projectWith({ offsetSec: 1 });
    scheduleAudioClips(ctx, project, { destinationFor: () => ctx.destination, buffers: new Map([["a", buffer]]), fromSec: 0, atTime: 0 });
    expect(at(await render(ctx), 2.5)).toBeCloseTo(0.8, 2);
  });

  it("ramps a fade in and a fade out", async () => {
    const ctx = offline(5);
    // 8 steps is one second at 120 bpm.
    const { project } = projectWith({ fadeInSteps: 8, fadeOutSteps: 8 });
    scheduleAudioClips(ctx, project, {
      destinationFor: () => ctx.destination,
      buffers: new Map([["a", constantBuffer(ctx, 4, 1)]]),
      fromSec: 0,
      atTime: 0,
    });
    const out = await render(ctx);
    expect(at(out, 2.5)).toBeCloseTo(0.5, 1);
    expect(at(out, 2.05)).toBeLessThan(0.15);
    expect(at(out, 3.5)).toBeCloseTo(0.5, 1);
  });

  it("skips muted tracks only when asked to", async () => {
    const { project } = projectWith({});
    const muted: Project = { ...project, tracks: project.tracks.map((t) => ({ ...t, muted: true })) };
    const peak = async (honor: boolean) => {
      const ctx = offline(5);
      scheduleAudioClips(ctx, muted, {
        destinationFor: () => ctx.destination,
        buffers: new Map([["a", constantBuffer(ctx, 4)]]),
        fromSec: 0,
        atTime: 0,
        honorMuteSolo: honor,
      });
      return Math.max(...(await render(ctx)));
    };
    expect(await peak(true)).toBe(0);
    expect(await peak(false)).toBeGreaterThan(0.4);
  });

  it("silences clips when stopped", async () => {
    const ctx = offline(5);
    const { project } = projectWith({});
    const scheduled = scheduleAudioClips(ctx, project, {
      destinationFor: () => ctx.destination,
      buffers: new Map([["a", constantBuffer(ctx, 4)]]),
      fromSec: 0,
      atTime: 0,
    });
    scheduled.stop(2.5);
    const out = await render(ctx);
    expect(at(out, 2.2)).toBeGreaterThan(0.3);
    expect(at(out, 3.2)).toBe(0);
  });

  it("uses a processed buffer when given one", async () => {
    const ctx = offline(5);
    const { project } = projectWith({ pitchSemitones: 2 });
    const clip = project.tracks[0].clips[0];
    scheduleAudioClips(ctx, project, {
      destinationFor: () => ctx.destination,
      buffers: new Map([["a", constantBuffer(ctx, 4, 0.5)]]),
      warped: new Map([[clip.id, constantBuffer(ctx, 4, 0.9)]]),
      fromSec: 0,
      atTime: 0,
    });
    expect(at(await render(ctx), 3)).toBeCloseTo(0.9, 2);
  });
});

describe("clipEnvelope", () => {
  it("stays within 0..clip gain and never exceeds it", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (fi, fo, pos) => {
          const clip = makeClip({ kind: "audio", startBar: 1, lengthBars: 1, fadeInSteps: fi, fadeOutSteps: fo });
          const env = clipEnvelope(clip, 2, 0.125);
          const v = env(pos * 2);
          return v >= 0 && v <= 1;
        },
      ),
    );
  });
});

describe("patternAtStep", () => {
  function instrumentProject(): { project: Project; slotId: string } {
    let p = newProject();
    const t = makeTrack(p, "instrument", { slotId: "s1" });
    p = addTrack(p, t);
    p = { ...p, instruments: [{ id: "s1", kind: "drum80la8", trackId: t.id, state: { kind: "drum80la8", values: {} } }] };
    p = addClip(p, t.id, makeClip({ kind: "pattern", startBar: 2, lengthBars: 2, patternIndex: 1 }));
    p = addClip(p, t.id, makeClip({ kind: "pattern", startBar: 5, lengthBars: 1, patternIndex: 3 }));
    return { project: p, slotId: "s1" };
  }

  it("is silent outside clips and picks the clip's pattern inside", () => {
    const { project, slotId } = instrumentProject();
    expect(patternAtStep(project, slotId, 0)).toBeNull();
    expect(patternAtStep(project, slotId, 15)).toBeNull();
    expect(patternAtStep(project, slotId, 16)).toBe(1);
    expect(patternAtStep(project, slotId, 47)).toBe(1);
    expect(patternAtStep(project, slotId, 48)).toBeNull();
    expect(patternAtStep(project, slotId, 64)).toBe(3);
  });

  it("follows the time signature", () => {
    const { project, slotId } = instrumentProject();
    const waltz: Project = { ...project, beatsPerBar: 3 };
    expect(patternAtStep(waltz, slotId, 11)).toBeNull();
    expect(patternAtStep(waltz, slotId, 12)).toBe(1);
  });

  it("returns null for unknown slots and only ever a valid index", () => {
    const { project, slotId } = instrumentProject();
    expect(patternAtStep(project, "nope", 20)).toBeNull();
    fc.assert(fc.property(fc.nat(400), (step) => [null, 1, 3].includes(patternAtStep(project, slotId, step))));
  });

  it("leaves instruments with no pattern clips alone", () => {
    const { project, slotId } = instrumentProject();
    expect(slotIsArranged(project, slotId)).toBe(true);
    const bare: Project = { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: [] })) };
    expect(slotIsArranged(bare, slotId)).toBe(false);
  });
});

describe("reverse, pitch and trim", () => {
  const rampBuffer = (ctx: BaseAudioContext, seconds: number): AudioBuffer => {
    const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = i / d.length;
    return b;
  };
  const sineBuffer = (ctx: BaseAudioContext, seconds: number, hz: number): AudioBuffer => {
    const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR);
    return b;
  };
  const crossings = (data: Float32Array, from: number, to: number): number => {
    let n = 0;
    for (let i = Math.floor(from * SR) + 1; i < Math.floor(to * SR); i++) if (data[i - 1] < 0 && data[i] >= 0) n++;
    return n;
  };

  it("plays a reversed clip backwards", async () => {
    const run = async (reversed: boolean) => {
      const ctx = offline(4);
      const { project } = projectWith({ reversed });
      scheduleAudioClips(ctx, project, { destinationFor: () => ctx.destination, buffers: new Map([["a", rampBuffer(ctx, 2)]]), fromSec: 0, atTime: 0 });
      return render(ctx);
    };
    const fwd = await run(false);
    const rev = await run(true);
    expect(at(fwd, 2.1)).toBeLessThan(at(fwd, 3.5));
    expect(at(rev, 2.1)).toBeGreaterThan(at(rev, 3.5));
    expect(at(rev, 2.1)).toBeCloseTo(at(fwd, 3.9), 1);
  });

  it("reverses the trimmed window, not the whole file", async () => {
    const ctx = offline(4);
    const { project } = projectWith({ reversed: true, offsetSec: 0.5, lengthBars: 0.5 });
    scheduleAudioClips(ctx, project, { destinationFor: () => ctx.destination, buffers: new Map([["a", rampBuffer(ctx, 2)]]), fromSec: 0, atTime: 0 });
    const out = await render(ctx);
    // The window is source 0.5s to 1.5s (ramp 0.25 to 0.75); backwards it starts near 0.75.
    expect(at(out, 2.01)).toBeCloseTo(0.75, 1);
    expect(at(out, 2.95)).toBeCloseTo(0.25, 1);
  });

  it("+12 semitones doubles the frequency", async () => {
    const run = async (pitchSemitones: number) => {
      const ctx = offline(4);
      const { project } = projectWith({ pitchSemitones });
      scheduleAudioClips(ctx, project, {
        destinationFor: () => ctx.destination,
        buffers: new Map([["a", sineBuffer(ctx, 2, 200)]]),
        fromSec: 0,
        atTime: 0,
        warped: new Map(),
      });
      return render(ctx);
    };
    const base = crossings(await run(0), 2.05, 2.55);
    const up = crossings(await run(12), 2.05, 2.55);
    expect(base).toBeGreaterThan(80);
    expect(up / base).toBeCloseTo(2, 1);
  });

  it("starts a clip at its trim offset", async () => {
    const ctx = offline(4);
    const { project } = projectWith({ offsetSec: 1 });
    scheduleAudioClips(ctx, project, { destinationFor: () => ctx.destination, buffers: new Map([["a", rampBuffer(ctx, 2)]]), fromSec: 0, atTime: 0 });
    expect(at(await render(ctx), 2.01)).toBeCloseTo(0.5, 1);
  });
});

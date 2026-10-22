import { IDBFactory } from "fake-indexeddb";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { Acid30lee } from "../audio/instruments/acid30lee";
import { Divine09 } from "../audio/instruments/divine09";
import { Drum80la8 } from "../audio/instruments/drum80la8";
import { GalacticOne } from "../audio/instruments/galacticOne";
import { Lead0010110 } from "../audio/instruments/lead0010110";
import { offlineContext } from "../audio/instruments/synth/testUtils";
import type { Instrument, InstrumentState } from "../audio/types";
import { bytesToBase64 } from "./binary";
import { LEGACY_DIVINE_DB, convertLegacyProject, readLegacyGlobals } from "./legacy";
import { NO_GLOBALS, mapAcid, mapBeatLab, mapDivine, mapGalacticOne, mapLead, moduleKindOf, type LegacyGlobals, type ModuleEnv } from "./legacyModules";

// Fixtures follow the shapes in daw.html: baseVoice() and defaultPatterns() (80LA8, ~1306), defaults() (90MINE ~1400),
// defaults() (30LEE ~1569), S (0010110 ~1644) and defaultState()/mergeState() (Galactic One ~2007).

const WAV_HEADER = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

function env(): ModuleEnv & { added: Array<{ name: string; size: number }> } {
  const added: Array<{ name: string; size: number }> = [];
  return {
    bpm: 120,
    added,
    addSample(bytes, name) {
      added.push({ name, size: bytes.byteLength });
      return { assetId: `asset-${added.length}`, name };
    },
  };
}

function beatLab(): Record<string, unknown> {
  const voice = (): Record<string, unknown> => ({ volume: 0.82, pan: 0, pitch: 0, decay: 0.35, tone: 10000, drive: 0, delay: 0, reverb: 0, keyLock: true, mute: false, solo: false });
  const voices = Array.from({ length: 12 }, voice);
  voices[0] = { ...voices[0], volume: 1.1, pitch: -3, decay: 0.9, tone: 4000, drive: 0.3, solo: true };
  voices[3] = { ...voices[3], keyLock: false, mute: true, pan: 0.4 };
  voices[2] = { ...voices[2], sampleData: bytesToBase64(WAV_HEADER), sampleName: "snap.wav" };
  const patterns = Array.from({ length: 4 }, () => ({ steps: Array.from({ length: 12 }, () => Array.from({ length: 16 }, () => ({ on: false, velocity: 0.8 }))) }));
  [0, 4, 8, 12].forEach((i) => (patterns[0].steps[0][i] = { on: true, velocity: 0.9 }));
  patterns[1].steps[1][4] = { on: true, velocity: 0.5 };
  return { patterns, voices, activePattern: 1, swing: 0.2, bars: 4, baseBpm: 130 };
}

function mineState(): Record<string, unknown> {
  const names = 15;
  const patterns = Array.from({ length: 4 }, () => Array.from({ length: names }, () => Array.from({ length: 128 }, () => ({ on: false, accent: false, velocity: 0.72 }))));
  [0, 4, 8, 12].forEach((i) => (patterns[0][0][i] = { on: true, accent: i === 0, velocity: 0.95 }));
  patterns[2][3][2] = { on: true, accent: false, velocity: 0.72 };
  return {
    sv: 2, active: 2, bars: 4, editBar: 0, swing: 0.3, level: 0.7, drive: 0.4, room: 0.2, hat: 0.5, bitcrush: 0.25, filter: 0.6, kit: "808",
    profiles: Array.from({ length: names }, (_, i) => (i === 0 ? "sub" : i === 1 ? "bogus" : "kit")),
    channels: Array.from({ length: names }, (_, i) => ({ level: 0.9, pan: i === 3 ? 0.18 : 0, tone: i === 0 ? -0.5 : 0, delay: 0.1, reverb: 0.05 })),
    patterns,
  };
}

function leeState(): Record<string, unknown> {
  const notes = [36, 36, 43, 36, 39, 36, 46, 34, 36, 36, 41, 36, 39, 43, 34, 36];
  const patterns = Array.from({ length: 4 }, (_, p) => Array.from({ length: 16 }, (_, i) => ({ on: p === 0 ? i % 4 === 0 : i === 3, note: notes[i], accent: i === 4, slide: i === 7, velocity: 0.78 })));
  return {
    patterns, active: 1, cutoff: 1500, resonance: 12.5, envMod: 0.5, decay: 0.3, attack: 0.01, sub: 0.4, wave: "square", octave: 1, drive: 0.55, level: 0.6,
    accent: 0.9, slideTime: 0.12, gate: 0.8, swing: 0.1, prob: 0.8, tempo: 130, length: 16, arpOn: true, arpMode: "updown", arpRate: "1/8T", arpOct: 3, arpGate: 0.5,
    filterMode: "bandpass", subWave: "sine", stutter: false, freeze: false, tape: false,
    fx: { delay: 0.3, feedback: 0.5, reverb: 0.2, bitcrush: 0.1, wet: 0.4, dist: 0.6, filter: 9000, filterRes: 1.5, stereo: 0.3 },
  };
}

function s101(): Record<string, unknown> {
  return {
    wave: "square", sub: 0.5, noise: 0.1, pulse: 0.3, cut: 2000, res: 9, env: 0.7, attack: 0.02, decay: 0.3, sustain: 0.4, release: 0.5, lfoRate: 6, lfoAmt: 0.3, glide: 0.1,
    level: 0.8, drive: 0.2, delay: 0.3, delayTime: 0.5, feedback: 0.4, reverb: 0.25, chorus: 0.3, bitcrush: 0.2, arpRate: "1/16T", arpMode: "random", arpOct: 2, arpGate: 0.6,
    arpSwing: 0.1, arpOn: false, arpLatch: true, hold: false, freeze: false, stutter: false, reverse: true, sample: null, sampleName: "No sample loaded",
    layers: [
      { on: true, oct: 0, semi: 0, detune: 0, level: 0.8, wave: "sawtooth" },
      { on: true, oct: -1, semi: 5, detune: -7, level: 0.34, wave: "square" },
      { on: true, oct: 1, semi: 0, detune: 7, level: 0.25, wave: "sine" },
    ],
  };
}

function galactic(): Record<string, unknown> {
  const mkStep = () => ({ on: 0, n: 0, v: 0.8, g: 0.6, p: 1, r: 1, c: 0, a: 0, s: 0 });
  const pats = Array.from({ length: 8 }, () => ({ len: 16, steps: Array.from({ length: 32 }, mkStep) }));
  pats[0].steps[0] = { ...mkStep(), on: 1, n: 7, v: 1, a: 1 };
  pats[0].steps[2] = { ...mkStep(), on: 1, n: -5, s: 1, r: 3 };
  pats[3].len = 8;
  return {
    v: 2, names: ["BRASS ONE", "PAD TWO"], keymode: 1, edit: 0, hold: 1, tune: 12, voices: 10,
    patches: [{ o1wave: 2, cut: 3000, res: 0.5, uni: 5, fenv: -0.4, l1sync: 4, m1src: 1, m1dst: 2, m1amt: -0.5, o1fine: 999 }, { cut: 800, mode: 1 }],
    fx: { fxDrive: 0.3, dlDiv: 3, dlMix: 0.4, width: 1.5, rvSize: 2 },
    mac: { bright: 0.5, motion: 0.25, space: 1, grit: 0 },
    seq: { mode: "arp", target: 2, root: 7, scale: "dorian", snap: 0, oct: 4, dir: 2, swing: 0.3, rate: 3, cur: 3, follow: 0, arpMode: 5, arpOct: 3, latch: 1, bars: 8, chain: [0, 3, 99], chainOn: 1, layer: 2, evolve: 1, pats },
  };
}

function expectInRange(instrument: Instrument, state: InstrumentState): void {
  for (const [id, value] of Object.entries(state.values)) {
    const def = instrument.params.find((p) => p.id === id);
    expect(def, `unknown param ${id}`).toBeDefined();
    expect(value, id).toBeGreaterThanOrEqual(def?.min ?? -Infinity);
    expect(value, id).toBeLessThanOrEqual(def?.max ?? Infinity);
  }
}

describe("80LA8", () => {
  it("carries patterns, voice settings, swing and samples", () => {
    const e = env();
    const out = mapBeatLab(beatLab(), e);
    expect(out).not.toBeNull();
    const { state } = out!;
    expect(state.values).toMatchObject({ swing: 0.2, bounceBars: 2, "v0.level": 1.1, "v0.tune": -3, "v0.decay": 0.9, "v0.tone": 4000, "v0.solo": 1, "v3.mute": 1, "v3.pan": 0.4 });
    const data = state.data as { patterns: number[][][]; pattern: number; samples: Array<{ assetId: string } | null> };
    expect(data.patterns[0][0].filter((x) => x > 0)).toHaveLength(4);
    expect(data.patterns[0][0][0]).toBeCloseTo(0.9);
    expect(data.patterns[1][1][4]).toBeCloseTo(0.5);
    expect(data.pattern).toBe(1);
    expect(data.samples[2]).toEqual({ assetId: "asset-1", name: "snap.wav" });
    expect(data.samples.filter(Boolean)).toHaveLength(1);
    expect(e.added).toEqual([{ name: "snap.wav", size: WAV_HEADER.byteLength }]);
    expect(out!.notes.join(" ")).toMatch(/key lock/);
  });

  it("restores into the real instrument", () => {
    const out = mapBeatLab(beatLab(), env())!;
    const inst = new Drum80la8(offlineContext(1));
    expectInRange(inst, out.state);
    inst.restore(out.state);
    expect(inst.getParam("swing")).toBeCloseTo(0.2);
    expect(inst.stepVelocity(0, 4, 0)).toBeCloseTo(0.9);
    expect(inst.stepVelocity(1, 4, 1)).toBeCloseTo(0.5);
    inst.dispose();
  });

  it("reports a damaged sample instead of throwing", () => {
    const bl = beatLab();
    (bl.voices as Array<Record<string, unknown>>)[5].sampleData = "***not base64***";
    const out = mapBeatLab(bl, env())!;
    expect(out.notes.join(" ")).toMatch(/damaged/);
  });
});

describe("DIVINE09 from 90MINE", () => {
  const samples: LegacyGlobals["divineSamples"] = [null, { name: "hit.wav", bytes: WAV_HEADER }, null, null];

  it("maps kit, length, mixer, profiles, patterns and samples", () => {
    const e = env();
    const out = mapDivine(mineState(), samples, e)!;
    expect(out.state.values).toMatchObject({ kit: 1, length: 2, swing: 0.3, level: 0.7, drive: 0.4, room: 0.2, hat: 0.5, crush: 0.25, filter: 0.6, "v0.profile": 2, "v1.profile": 0, "v0.tone": -0.5, "v3.pan": 0.18 });
    const data = out.state.data as { patterns: number[][][]; pattern: number; samples: Array<{ name: string } | null> };
    expect(data.patterns[0][0][0]).toBe(2);
    expect(data.patterns[0][0][4]).toBe(1);
    expect(data.patterns[2][3][2]).toBe(1);
    expect(data.pattern).toBe(2);
    expect(data.samples.map((s) => s?.name ?? null)).toEqual([null, "hit.wav", null, null]);
    expect(out.carried.join(" ")).toMatch(/DIVINE09: 5 drum hits/);
  });

  it("restores into the real instrument", () => {
    const out = mapDivine(mineState(), samples, env())!;
    const inst = new Divine09(offlineContext(1));
    expectInRange(inst, out.state);
    inst.restore(out.state);
    expect(inst.getParam("kit")).toBe(1);
    expect(inst.getParam("length")).toBe(2);
    inst.dispose();
  });

  it("carries samples alone when settings are missing, and nothing when both are missing", () => {
    const onlySamples = mapDivine(null, samples, env())!;
    expect((onlySamples.state.data as { samples: unknown[] }).samples[1]).toBeTruthy();
    expect(mapDivine(null, NO_GLOBALS.divineSamples, env())).toBeNull();
    expect(mapDivine("junk", NO_GLOBALS.divineSamples, env())).toBeNull();
  });

  it("treats a pre-v2 state's tone as neutral like the old studio did", () => {
    const old = { ...mineState(), sv: 1 };
    expect(mapDivine(old, NO_GLOBALS.divineSamples, env())!.state.values["v0.tone"]).toBe(0);
  });
});

describe("30LEE", () => {
  it("converts units (seconds to ms, resonance to a fraction) and maps selects", () => {
    const out = mapAcid(leeState())!;
    expect(out.state.values).toMatchObject({ wave: 1, octave: 2, cutoff: 1500, resonance: 0.5, decay: 300, attack: 10, slideTime: 120, filterMode: 1, subWave: 1, arpOn: 1, arpMode: 2, arpRate: 2, arpOct: 3, chance: 0.8, delay: 0.3, delayFb: 0.5, fxMix: 0.4, fxFilter: 9000, width: 0.3, drive: 0.6, crush: 0.1 });
    const data = out.state.data as { patterns: Array<Array<{ on: boolean; note: number; accent: boolean; slide: boolean }>>; active: number };
    expect(data.active).toBe(1);
    expect(data.patterns[0].filter((s) => s.on)).toHaveLength(4);
    expect(data.patterns[0][4].accent).toBe(true);
    expect(data.patterns[0][7].slide).toBe(true);
    expect(data.patterns[0][2].note).toBe(43);
  });

  it("restores into the real instrument", () => {
    const out = mapAcid(leeState())!;
    const inst = new Acid30lee(offlineContext(1));
    expectInRange(inst, out.state);
    inst.restore(out.state);
    expect(inst.getParam("cutoff")).toBe(1500);
    inst.dispose();
  });

  it("tiles an 8-step pattern and says so", () => {
    const lee = { ...leeState(), length: 8 };
    const out = mapAcid(lee)!;
    const first = (out.state.data as { patterns: Array<Array<{ on: boolean }>> }).patterns[0];
    expect(first[8].on).toBe(first[0].on);
    expect(out.notes.join(" ")).toMatch(/length 8/);
  });

  it("returns null for a state without four patterns", () => {
    expect(mapAcid({ patterns: [] })).toBeNull();
    expect(mapAcid(undefined)).toBeNull();
  });
});

describe("0010110", () => {
  it("maps layers, units and the delay time at the project tempo", () => {
    const out = mapLead(s101(), 120)!;
    expect(out.state.values).toMatchObject({
      cutoff: 2000, resonance: 0.5, filterEnv: 0.7, lfoDepth: 0.3, sampleReverse: 1, arpLatch: 1, arpMode: 4, arpRate: 4, delayFb: 0.4, crush: 0.2,
      l1wave: 1, l2wave: 1, l2oct: -1, l2semi: 5, l2detune: -7, l3wave: 3, l3oct: 1, l3on: 1,
    });
    // 0.5 s at 120 BPM is exactly one beat.
    expect(out.state.values.delayTime).toBe(3);
    expect(out.notes.join(" ")).toMatch(/never saved/);
  });

  it("restores into the real instrument", () => {
    const out = mapLead(s101(), 120)!;
    const inst = new Lead0010110(offlineContext(1));
    expectInRange(inst, out.state);
    inst.restore(out.state);
    expect(inst.getParam("l2semi")).toBe(5);
    inst.dispose();
  });

  it("returns null when there are no layers to read", () => {
    expect(mapLead({}, 120)).toBeNull();
  });
});

describe("GALACTIC ONE", () => {
  it("maps patches, effects, macros, sequencer and patterns", () => {
    const out = mapGalacticOne(galactic())!;
    const v = out.state.values;
    expect(v).toMatchObject({
      "a.o1wave": 2, "a.cut": 3000, "a.uni": 5, "a.fenv": -0.4, "a.l1sync": 4, "a.m1src": 1, "a.m1dst": 2, "a.m1amt": -0.5, "b.cut": 800, "b.mode": 1,
      "fx.fxDrive": 0.3, "fx.dlDiv": 3, "fx.width": 1.5, "fx.rvSize": 2, "macro.bright": 0.75, "macro.space": 1,
      "key.mode": 1, "perf.hold": 1, "perf.voices": 10, "perf.tune": 12,
      "seq.mode": 1, "seq.target": 2, "seq.root": 7, "seq.scale": 3, "seq.snap": 0, "seq.octave": 4, "seq.bars": 3, "seq.layer": 3, "seq.chain": 1, "seq.evolve": 1,
      "arp.mode": 6, "arp.oct": 3, "arp.latch": 1,
    });
    // Out-of-range values are clamped to the control's range.
    expect(v["a.o1fine"]).toBe(50);
    const data = out.state.data as { patterns: Array<{ len: number; steps: Array<{ on: boolean; n: number; accent: boolean; slide: boolean; r: number }> }>; active: number; chain: number[]; names: string[] };
    expect(data.names).toEqual(["BRASS ONE", "PAD TWO"]);
    expect(data.active).toBe(3);
    expect(data.chain).toEqual([0, 3]);
    expect(data.patterns).toHaveLength(8);
    expect(data.patterns[3].len).toBe(8);
    expect(data.patterns[0].steps[0]).toMatchObject({ on: true, n: 7, accent: true });
    expect(data.patterns[0].steps[2]).toMatchObject({ on: true, n: -5, slide: true, r: 3 });
  });

  it("restores into the real instrument", () => {
    const out = mapGalacticOne(galactic())!;
    const inst = new GalacticOne(offlineContext(1));
    expectInRange(inst, out.state);
    inst.restore(out.state);
    expect(inst.getParam("a.cut")).toBe(3000);
    expect(inst.getParam("seq.scale")).toBe(3);
    inst.dispose();
  });
});

describe("no throwing on bad old data", () => {
  const e = (): ModuleEnv => env();
  it("never throws for arbitrary input", () => {
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        mapBeatLab(junk, e());
        mapDivine(junk, [null, null, null, null], e());
        mapAcid(junk);
        mapLead(junk, 120);
        mapGalacticOne(junk);
      }),
      { numRuns: 200 },
    );
  });

  it("never throws or leaves a control out of range when real shapes get arbitrary field values", () => {
    const wild = fc.oneof(fc.double({ noNaN: false }), fc.string(), fc.boolean(), fc.constant(null), fc.integer());
    const mutate = (base: Record<string, unknown>, depth = 0): fc.Arbitrary<Record<string, unknown>> =>
      fc.array(fc.tuple(fc.constantFrom(...Object.keys(base)), wild), { maxLength: 8 }).map((pairs) => {
        const copy = structuredClone(base);
        for (const [k, v] of pairs) copy[k] = depth === 0 ? v : copy[k];
        return copy;
      });
    const inst = (state: InstrumentState, make: () => Instrument): void => {
      const i = make();
      expectInRange(i, state);
      i.restore(state);
      i.dispose();
    };
    fc.assert(
      fc.property(mutate(beatLab()), mutate(mineState()), mutate(leeState()), mutate(s101()), mutate(galactic()), (a, b, c, d, g) => {
        const bl = mapBeatLab(a, e());
        if (bl) inst(bl.state, () => new Drum80la8(offlineContext(1)));
        const dv = mapDivine(b, [null, null, null, null], e());
        if (dv) inst(dv.state, () => new Divine09(offlineContext(1)));
        const ac = mapAcid(c);
        if (ac) inst(ac.state, () => new Acid30lee(offlineContext(1)));
        const ld = mapLead(d, 120);
        if (ld) inst(ld.state, () => new Lead0010110(offlineContext(1)));
        const go = mapGalacticOne(g);
        if (go) inst(go.state, () => new GalacticOne(offlineContext(1)));
      }),
      { numRuns: 25 },
    );
  });
});

describe("module tracks inside a converted project", () => {
  const track = (name: string, extra: Record<string, unknown> = {}) => ({ id: `t-${name}`, name, type: "audio", volume: 0.5, pan: 0.25, mute: true, clips: [], ...extra });
  const project = (): Record<string, unknown> => ({
    name: "Old jam",
    bpm: 120,
    beatLab: beatLab(),
    glctc30lee: leeState(),
    s101Settings: s101(),
    galacticOne: galactic(),
    assets: [],
    tracks: [
      track("Looper · Module Track", { looper: true }),
      track("GLCTC1 80LA8 · Module Track"),
      track("90MINE · Module Track"),
      track("30LEE · Module Track"),
      track("0010110 · Module Track"),
      track("GALACTIC ONE · Module Track"),
    ],
  });
  const globals = (): LegacyGlobals => ({ mine: mineState(), galacticOne: null, lee: null, divineSamples: [null, { name: "hit.wav", bytes: WAV_HEADER }, null, null] });

  it("turns module tracks into instrument tracks with their state", async () => {
    const { project: p, media, report } = convertLegacyProject(project(), 5000, globals());
    expect(p.instruments.map((s) => s.kind).sort()).toEqual(["acid30lee", "divine09", "drum80la8", "galacticOne", "lead0010110"]);
    for (const slot of p.instruments) {
      const t = p.tracks.find((x) => x.id === slot.trackId);
      expect(t).toMatchObject({ kind: "instrument", slotId: slot.id, muted: true, pan: 0.25 });
      expect(t?.clips.every((c) => c.kind === "pattern" && c.patternIndex !== undefined)).toBe(true);
      expect(t?.gainDb).toBeCloseTo(-6.02, 1);
    }
    expect(p.tracks.map((t) => t.name)).toEqual(["80LA8", "Divine09", "30LEE", "0010110", "Galactic One"]);
    // Patterns that hold notes arrive as clips in order, so the timeline shows what the module plays.
    expect(p.tracks.find((t) => t.name === "80LA8")?.clips.length).toBeGreaterThan(0);
    // Two sample assets: one on an 80LA8 voice, one from DIVINE09.
    expect(p.assets.map((a) => a.name).sort()).toEqual(["hit.wav", "snap.wav"]);
    for (const a of p.assets) expect(a.mime).toBe("audio/wav");
    for (const a of p.assets) expect(media.get(a.id)?.size).toBe(WAV_HEADER.byteLength);
    const ref = (p.instruments.find((s) => s.kind === "drum80la8")?.state.data as { samples: Array<{ assetId: string } | null> }).samples[2];
    expect(p.assets.some((a) => a.id === ref?.assetId)).toBe(true);
    const text = report.skipped.join("\n");
    expect(text).toMatch(/Looper/);
    expect(text).not.toMatch(/80LA8 patterns and samples/);
    expect(text).not.toMatch(/live in the old studio's own storage and are not part of a project/);
    expect(report.imported.join("\n")).toMatch(/DIVINE09.*import time/);
    expect(report.imported.join("\n")).toMatch(/80LA8: 5 drum hits/);
  });

  it("says plainly what a package cannot carry, and keeps what it holds", () => {
    const { project: p, report } = convertLegacyProject(project(), 5000, null);
    expect(p.instruments.map((s) => s.kind)).not.toContain("divine09");
    expect(p.instruments.map((s) => s.kind)).toContain("galacticOne");
    expect(report.skipped.join("\n")).toMatch(/90MINE.*package does not include/s);
  });

  it("falls back to the old studio's global Galactic One and 30LEE and labels them", () => {
    const raw = { ...project() };
    delete raw.galacticOne;
    delete raw.glctc30lee;
    const g: LegacyGlobals = { ...globals(), galacticOne: galactic(), lee: leeState() };
    const { project: p, report } = convertLegacyProject(raw, 5000, g);
    expect(p.instruments.map((s) => s.kind)).toEqual(expect.arrayContaining(["galacticOne", "acid30lee"]));
    expect(report.imported.filter((l) => /GALACTIC ONE|30LEE/.test(l)).every((l) => /import time/.test(l))).toBe(true);
  });

  it("reports missing and corrupt module data instead of throwing", () => {
    const raw = { ...project(), beatLab: "junk", glctc30lee: { patterns: 5 }, s101Settings: [], galacticOne: { patches: "x" } };
    const { project: p, report } = convertLegacyProject(raw, 5000, { mine: "garbage", galacticOne: 3, lee: [], divineSamples: [null, null, null, null] });
    expect(p.instruments).toEqual([]);
    const text = report.skipped.join("\n");
    expect(text).toMatch(/80LA8/);
    expect(text).toMatch(/30LEE/);
    expect(text).toMatch(/0010110/);
    expect(text).toMatch(/90MINE/);
    expect(text).toMatch(/GALACTIC ONE/);
  });

  it("keeps a module track that has clips as an ordinary audio track", () => {
    const raw = project();
    (raw.tracks as Array<Record<string, unknown>>)[1] = track("GLCTC1 80LA8 · Module Track", { clips: [{ id: "c", kind: "audio", start: 0, length: 4, assetId: "x" }] });
    const { project: p } = convertLegacyProject(raw, 5000, globals());
    expect(p.instruments.map((s) => s.kind)).not.toContain("drum80la8");
  });

  it("uses one slot per instrument when a module track appears twice", () => {
    const raw = project();
    (raw.tracks as unknown[]).push(track("GLCTC1 80LA8 · Module Track", { id: "dup" }));
    const { project: p, report } = convertLegacyProject(raw, 5000, globals());
    expect(p.instruments.filter((s) => s.kind === "drum80la8")).toHaveLength(1);
    expect(report.skipped.join("\n")).toMatch(/one 80LA8 per project/);
  });

  it("recognises module track names", () => {
    expect(moduleKindOf("GALACTIC ONE · Module Track")).toBe("galacticOne");
    expect(moduleKindOf("Looper 2")).toBeNull();
    expect(moduleKindOf("Bass")).toBeNull();
  });
});

describe("reading the old studio's global settings is read-only", () => {
  function wait<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it("reads samples and local keys without creating or changing anything", async () => {
    const factory = new IDBFactory();
    const open = factory.open(LEGACY_DIVINE_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("samples");
    const db = await wait(open);
    const tx = db.transaction("samples", "readwrite");
    tx.objectStore("samples").put({ name: "kick.wav", bytes: WAV_HEADER.buffer.slice(0) }, "0");
    tx.objectStore("samples").put({ name: "typed.wav", bytes: new Uint8Array([1, 2, 3, 4]) }, "2");
    tx.objectStore("samples").put({ nonsense: true }, "3");
    await new Promise<void>((r) => (tx.oncomplete = () => r()));
    db.close();
    const before = JSON.stringify(await factory.databases());
    const setItem = vi.fn();
    const storage = { getItem: (k: string) => (k === "glctc1_90mine_state" ? JSON.stringify(mineState()) : k === "glctc1_30lee_preset" ? "{broken" : null), setItem };
    const g = await readLegacyGlobals(storage, factory);
    expect(g.divineSamples.map((s) => s?.name ?? null)).toEqual(["kick.wav", null, "typed.wav", null]);
    expect(Array.from(g.divineSamples[2]?.bytes ?? [])).toEqual([1, 2, 3, 4]);
    expect(g.mine).toMatchObject({ sv: 2 });
    expect(g.lee).toBeNull();
    expect(g.galacticOne).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(await factory.databases())).toBe(before);
  });

  it("never creates the sample database when it does not exist", async () => {
    const factory = new IDBFactory();
    const g = await readLegacyGlobals(null, factory);
    expect(g.divineSamples).toEqual([null, null, null, null]);
    expect(await factory.databases()).toEqual([]);
  });

  it("opens an existing database that has no samples store without touching it", async () => {
    const factory = new IDBFactory();
    const open = factory.open(LEGACY_DIVINE_DB, 3);
    open.onupgradeneeded = () => open.result.createObjectStore("other");
    (await wait(open)).close();
    const g = await readLegacyGlobals(null, factory);
    expect(g.divineSamples).toEqual([null, null, null, null]);
    expect((await factory.databases()).map((d) => `${d.name}@${d.version}`)).toEqual([`${LEGACY_DIVINE_DB}@3`]);
  });
});

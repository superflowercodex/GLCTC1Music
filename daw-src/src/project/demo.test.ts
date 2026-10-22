import { beforeAll, describe, expect, it } from "vitest";
import { detectTempoAndKey } from "../audio/analysis";
import { parseTarget } from "../audio/automation";
import { Acid30lee } from "../audio/instruments/acid30lee";
import { Divine09 } from "../audio/instruments/divine09";
import { Drum80la8 } from "../audio/instruments/drum80la8";
import { Lead0010110 } from "../audio/instruments/lead0010110";
import { GalacticOne } from "../audio/instruments/galacticOne";
import { Pad64 } from "../audio/instruments/pad64";
import { offlineClass } from "../audio/instruments/synth/testUtils";
import { bounceInstrument } from "../audio/bounce";
import { mixdownProject, mixdownStems, type MixdownDeps, type MixdownOptions } from "../audio/mixdown";
import type { Instrument, InstrumentKind } from "../audio/types";
import { audioBufferToWav, encodeWav } from "../audio/wav";
import { matrixRowToClips } from "../rooms/song/songModel";
import {
  A_MINOR,
  B_MINOR,
  DEMO_BPM,
  DEMO_KINDS,
  DEMO_SECTIONS,
  DEMO_TRACKS,
  PAD_NOTES,
  PAD_UPPER_INTERVAL,
  LEAD_ALTERNATIVES,
  buildDemoProject,
  chordAtBar,
  leadValues,
  keyAtStep,
  LIFT_STEP,
  demoScore,
  demoSectionStarts,
  midi,
  type ScoreNote,
} from "./demo";
import { balanceOf, hitLoudness, levelStats, loudness, lowPassed, midiToHz, monoOf, readPitch, rmsDbOf, spectralPeaks, type Balance } from "./demoMetrics";
import { migrateProject } from "./migrate";
import type { Project } from "./model";

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RATE = 44100;
const STEP = 60 / DEMO_BPM / 4;
const BAR = STEP * 16;
const starts = demoSectionStarts();
const TOTAL_BARS = DEMO_SECTIONS.reduce((n, s) => n + s.bars, 0);

const deps: Partial<MixdownDeps> = {
  offlineContext: offlineClass,
  createInstrument: async (kind: InstrumentKind, ctx: BaseAudioContext): Promise<Instrument> => {
    if (kind === "divine09") return new Divine09(ctx);
    if (kind === "pad64") return new Pad64(ctx);
    if (kind === "galacticOne") return new GalacticOne(ctx);
    if (kind === "drum80la8") return new Drum80la8(ctx);
    if (kind === "acid30lee") return new Acid30lee(ctx);
    if (kind === "lead0010110") return new Lead0010110(ctx);
    throw new RangeError(`The demo does not use ${kind}.`);
  },
};

type Stereo = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

// node-web-audio-api can reuse a finished render's memory for the next one, so every result is copied out at once.
async function render(project: Project, options: MixdownOptions): Promise<Stereo> {
  const buf = await mixdownProject(project, { sampleRate: RATE, deps, ...options });
  return [Float32Array.from(buf.getChannelData(0)), Float32Array.from(buf.getChannelData(1))];
}

function bars(startBar: number, endBar: number): MixdownOptions {
  return { range: { kind: "bars", startBar, endBar }, tailSeconds: 0.5 };
}

function soloTrack(project: Project, trackId: string): Project {
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, solo: t.id === trackId })) };
}

/** Galactic One carries both the lead (its banks) and the pad (its layer bank); this keeps one of them. */
function keysPart(project: Project, part: "lead" | "pad", dry = false): Project {
  const soloed = soloTrack(project, "demo-trk-keys");
  return {
    ...soloed,
    instruments: soloed.instruments.map((s) => {
      if (s.kind !== "galacticOne") return s;
      const data = s.state.data as { patterns: { len: number; steps: { on: boolean }[] }[] };
      const patterns = data.patterns.map((p, i) => (part === "pad" && i < 4 ? { ...p, steps: p.steps.map((st) => ({ ...st, on: false })) } : p));
      // Dry: no echoes or reverb tail overlapping the next note, so each note's pitch can be read on its own.
      const effects: Record<string, number> = dry ? { "fx.dlMix": 0, "fx.rvMix": 0, "fx.chMix": 0 } : {};
      const layer: Record<string, number> = part === "lead" ? { "seq.layer": 0 } : {};
      return { ...s, state: { ...s.state, values: { ...s.state.values, ...effects, ...layer }, data: { ...data, patterns } } };
    }),
  };
}

function sectionByName(name: string): { start: number; bars: number } {
  const i = DEMO_SECTIONS.findIndex((s) => s.name === name);
  return { start: starts[i], bars: DEMO_SECTIONS[i].bars };
}

const pc = (n: number): number => ((n % 12) + 12) % 12;

/** Reads every scored note of one part in a rendered stretch; returns the worst pitch-class error in cents. */
function worstPitchError(mono: Float32Array, notes: readonly ScoreNote[], startBar: number): { worst: number; unread: number; count: number } {
  const offset = (startBar - 1) * 16;
  let worst = 0;
  let unread = 0;
  for (const n of notes) {
    const next = notes.find((m) => m.step > n.step);
    const lenSteps = Math.min(next ? next.step - n.step : 4, 4);
    // Read from 50 ms in, once the previous note's release has mostly gone.
    const start = (n.step - offset) * STEP * RATE + 0.05 * RATE;
    const r = readPitch(mono, RATE, start, Math.min(Math.max(0.05, lenSteps * STEP - 0.06) * RATE, 4096), n.midi);
    if (r.pitchClassCents === null) unread += 1;
    else worst = Math.max(worst, Math.abs(r.pitchClassCents));
    if (r.pitchClassCents === null || Math.abs(r.pitchClassCents) > 15) console.info(`  note at step ${n.step} (midi ${n.midi}, ${lenSteps} steps): ${r.hz?.toFixed(1) ?? "unread"} Hz, ${r.pitchClassCents?.toFixed(1)} cents, clarity ${r.clarity.toFixed(2)}`);
  }
  return { worst, unread, count: notes.length };
}

/** Octave-band shape checks shared by the drop and the full-song tests. */
function expectWarmBalance(b: Balance, label: string): void {
  const [o63, o125, o250, o500, o1k, o2k, o4k, o8k] = b.octaves;
  const bump = (mid: number, lo: number, hi: number): number => mid - (lo + hi) / 2;
  console.info(`${label}: octaves ${b.octaves.map((o) => o.toFixed(1)).join(" ")} slope ${b.slope.toFixed(2)} dB/oct, air ${(b.air * 100).toFixed(2)}%, presence ${(b.presence * 100).toFixed(2)}%, 200-400 Hz ${(b.mud * 100).toFixed(1)}%`);
  // Falls steadily from the mids up, as a warm mix does; flat or rising is what sounds shrill.
  expect(b.slope).toBeLessThan(-1.8);
  expect(b.slope).toBeGreaterThan(-4.5);
  // No band stands out from its neighbours: a hump at 250 Hz is mud, one at 4 or 8 kHz is fizz.
  expect(bump(o250, o125, o500)).toBeLessThan(2);
  expect(bump(o500, o250, o1k)).toBeLessThan(3);
  expect(bump(o2k, o1k, o4k)).toBeLessThan(2);
  expect(bump(o4k, o2k, o8k)).toBeLessThan(2);
  expect(o8k - o4k).toBeLessThan(0);
  // The top octave sits well under the low end (the first attempt's sat only 8 dB under, and sounded shrill).
  expect(o8k - o125).toBeLessThan(-11);
  expect(b.air).toBeLessThan(0.02);
  expect(b.mud).toBeLessThan(0.14);
  void o63;
  void o2k;
}

describe("demo song: the project", () => {
  it("is deterministic and stamped with the given time", () => {
    expect(JSON.stringify(buildDemoProject({ now: 5 }))).toBe(JSON.stringify(buildDemoProject({ now: 5 })));
    const p = buildDemoProject({ now: 5, id: "x" });
    expect([p.createdAt, p.updatedAt, p.id]).toEqual([5, 5, "x"]);
  });

  it("uses one instrument of each kind, because the studio plays one instance per kind", () => {
    const p = buildDemoProject();
    const kinds = p.instruments.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.sort()).toEqual(Object.values(DEMO_KINDS).sort());
  });

  it("has an empty Vocal audio track ready to record on", () => {
    const vocal = buildDemoProject().tracks.find((t) => t.name === DEMO_TRACKS.vocal);
    expect(vocal?.kind).toBe("audio");
    expect(vocal?.clips).toEqual([]);
    expect(vocal?.muted).toBe(false);
  });

  it("is 48 to 64 bars with every section but the last starting on a 4-bar line", () => {
    expect(TOTAL_BARS).toBeGreaterThanOrEqual(48);
    expect(TOTAL_BARS).toBeLessThanOrEqual(64);
    for (const bar of starts) expect((bar - 1) % 4).toBe(0);
    expect(DEMO_SECTIONS.slice(0, -1).every((s) => s.bars % 4 === 0)).toBe(true);
  });

  it("lays the same song out in the Song matrix and as Arrange pattern clips", () => {
    const p = buildDemoProject();
    for (const slot of p.instruments) {
      const row = p.song.matrix[slot.id];
      expect(row).toHaveLength(p.song.sections.length);
      expect(row.every((v) => v >= 0 && v <= 4)).toBe(true);
      expect(p.song.levels?.[slot.id]).toBe(1);
      const track = p.tracks.find((t) => t.id === slot.trackId);
      const expected = matrixRowToClips(p.song.sections, row, 1).map((c) => [c.startBar, c.lengthBars, c.patternIndex]);
      expect(track?.clips.map((c) => [c.startBar, c.lengthBars, c.patternIndex])).toEqual(expected);
      expect(track?.clips.every((c) => c.kind === "pattern")).toBe(true);
    }
  });

  it("starts making sound on bar 1 and its loop region is off, so pressing Play plays the song", () => {
    const p = buildDemoProject();
    expect(p.loop.on).toBe(false);
    expect(DEMO_SECTIONS[0].parts.keys).toBeGreaterThan(0);
    expect(DEMO_SECTIONS[0].parts.drums).toBeGreaterThan(0);
  });

  it("has an arc: intro, build, drops, a stripped break, a lift, the final drops and an ending", () => {
    expect(DEMO_SECTIONS.map((s) => s.kind)).toEqual(["intro", "intro", "build", "build", "drop", "drop", "drop", "drop", "break", "build", "drop", "drop", "drop", "drop", "outro", "outro"]);
    const brk = DEMO_SECTIONS.find((s) => s.kind === "break");
    // The break keeps only the keys, with the hook (bank B) back on its own.
    expect(brk?.parts).toEqual({ drums: 0, perc: 0, bass: 0, keys: 2, arp: 0, acid: 0 });
    // The lead alternates call and answer every 4 bars through every drop.
    const drops = DEMO_SECTIONS.filter((s) => s.kind === "drop").map((s) => s.parts.keys);
    expect(drops).toEqual([2, 3, 2, 3, 2, 3, 2, 3]);
  });

  it("automation lanes point at real targets", () => {
    const p = buildDemoProject();
    const lanes = p.tracks.flatMap((t) => t.automation);
    expect(lanes.length).toBeGreaterThan(0);
    for (const lane of lanes) {
      expect(parseTarget(p, lane.target)).toBeDefined();
      for (const pt of lane.points) {
        expect(pt.value).toBeGreaterThanOrEqual(0);
        expect(pt.value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("survives migration unchanged", () => {
    const p = buildDemoProject();
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe("demo song: the notes", () => {
  const score = demoScore();

  it("keeps every note in the key of its moment: A minor, then B minor after the lift", () => {
    expect(score.length).toBeGreaterThan(1000);
    for (const n of score) {
      expect(keyAtStep(n.step).has(pc(n.midi))).toBe(true);
      if (n.upper !== undefined) expect(keyAtStep(n.step).has(pc(n.upper))).toBe(true);
    }
    expect(score.some((n) => n.step >= LIFT_STEP && B_MINOR.has(pc(n.midi)) && !A_MINOR.has(pc(n.midi)))).toBe(true);
  });

  it("puts chord tones on the lead's strong beats and keeps it above the pad", () => {
    const lead = score.filter((x) => x.role === "lead");
    for (const n of lead) {
      const posInBar = n.step % 16;
      if (posInBar === 0 || posInBar === 8) expect(chordAtBar(n.bar).tones).toContain(pc(n.midi));
      expect(n.midi).toBeGreaterThanOrEqual(midi("B4"));
      expect(n.midi).toBeLessThanOrEqual(midi("B5"));
    }
    // One clear high point, reached by the hook's single leap.
    expect(Math.max(...lead.filter((n) => n.step < LIFT_STEP).map((n) => n.midi))).toBe(midi("A5"));
  });

  it("voices the pad as shells of each chord, struck again early on the 'and' of 4", () => {
    const pad = score.filter((x) => x.role === "pad");
    for (const n of pad) {
      const pushed = n.step % 16 === 14;
      const chord = pushed ? chordAtBar(n.bar + 1) : chordAtBar(n.bar);
      // The push into the lift is the only chord struck in the new key before its bar.
      const tones = n.step === LIFT_STEP ? chordAtBar(n.bar + 1).tones : chord.tones;
      expect(tones).toContain(pc(n.midi));
      expect(tones).toContain(pc(n.upper ?? -1));
      expect(n.midi).toBeGreaterThanOrEqual(midi("A3"));
      expect((n.upper ?? 0) - LIFT_STEP * 0).toBeLessThanOrEqual(midi("C#5"));
    }
    void PAD_NOTES;
  });

  it("walks the bass: roots, the next root pushed in on the 'and' of 4, passing notes in key, and never on a kick", () => {
    const bass = score.filter((n) => n.role === "bass");
    expect(bass.length).toBeGreaterThan(200);
    const counts = { root: 0, push: 0, passing: 0 };
    for (const n of bass) {
      counts[n.function ?? "root"] += 1;
      if (n.function === "root") expect(pc(n.midi)).toBe(chordAtBar(n.bar).tones[0]);
      if (n.function === "push") expect(pc(n.midi)).toBe(chordAtBar(n.bar + 1).tones[0]);
      expect(n.step % 4).not.toBe(0);
    }
    console.info(`bass notes: ${JSON.stringify(counts)}`);
    expect(counts.push).toBeGreaterThan(20);
    expect(counts.passing).toBeGreaterThan(10);
  });

  it("runs the arpeggio in dotted eighths, three against the four of the kick", () => {
    const firstBar = score.filter((n) => n.role === "arp" && n.bar === 5).map((n) => n.step % 16);
    expect(firstBar).toEqual([0, 3, 6, 9, 12, 15]);
  });
});

/** One track alone, with some of its instrument's values changed (for example its echoes off, to read pitches). */
function soloWith(project: Project, role: string, values: Record<string, number> = {}): Project {
  const soloed = soloTrack(project, `demo-trk-${role}`);
  return { ...soloed, instruments: soloed.instruments.map((s) => (s.id === `demo-slot-${role}` ? { ...s, state: { ...s.state, values: { ...s.state.values, ...values } } } : s)) };
}

function sideToMidDb(ch: Stereo, from: number, to: number): number {
  let side = 0;
  let mid = 0;
  for (let i = from; i < to; i++) {
    side += ((ch[0][i] - ch[1][i]) / 2) ** 2;
    mid += ((ch[0][i] + ch[1][i]) / 2) ** 2;
  }
  return 10 * Math.log10(side / mid);
}

describe("demo song: the arpeggio and the key lift, as heard", () => {
  it("plays the dotted-eighth arpeggio in tune", async () => {
    const start = 25;
    const arp = monoOf(await render(soloWith(buildDemoProject(), "arp", { delay: 0, reverb: 0, chorus: 0 }), bars(start, start + 2)));
    const notes = demoScore().filter((n) => n.role === "arp" && n.bar >= start && n.bar < start + 2);
    const r = worstPitchError(arp, notes, start);
    console.info(`arp: ${r.count} notes, worst ${r.worst.toFixed(1)} cents, ${r.unread} unread`);
    expect(r.unread).toBe(0);
    expect(r.worst).toBeLessThan(20);
  }, 120_000);

  it("gives the lead a reverb and echo tail: the break's last note rings on after it stops", async () => {
    const project = buildDemoProject();
    const from = 36;
    const wet = monoOf(await render(keysPart(project, "lead"), bars(from, from + 1)));
    const dry = monoOf(await render(keysPart(project, "lead", true), bars(from, from + 1)));
    // The last note of the break starts on beat 3 of bar 36; listen 0.6 to 1 s after it starts.
    const at = 8 * STEP * RATE;
    const level = (x: Float32Array): number => rmsDbOf(x, at + 0.6 * RATE, at + 1.0 * RATE) - rmsDbOf(x, at, at + 0.2 * RATE);
    console.info(`after the note, relative to it: with effects ${level(wet).toFixed(1)} dB, dry ${level(dry).toFixed(1)} dB`);
    expect(level(wet)).toBeGreaterThan(-30);
    expect(level(wet) - level(dry)).toBeGreaterThan(10);
  }, 120_000);

  it("lifts the lead, the pad's shells and the bass a whole tone for the final drops, all in tune", async () => {
    const start = 41;
    const project = buildDemoProject();
    const lead = monoOf(await render(keysPart(project, "lead", true), bars(start, start + 2)));
    const bass = monoOf(await render(soloTrack(project, "demo-trk-bass"), bars(start, start + 2)));
    const score = demoScore().filter((n) => n.bar >= start && n.bar < start + 2);
    const l = worstPitchError(lead, score.filter((n) => n.role === "lead"), start);
    const b = worstPitchError(bass, score.filter((n) => n.role === "bass"), start);
    console.info(`after the lift: lead worst ${l.worst.toFixed(1)} cents (${l.count} notes), bass worst ${b.worst.toFixed(1)} cents (${b.count} notes)`);
    expect(score.filter((n) => n.role === "lead").every((n) => B_MINOR.has(pc(n.midi)))).toBe(true);
    expect(l.unread + b.unread).toBe(0);
    expect(Math.max(l.worst, b.worst)).toBeLessThan(20);
  }, 120_000);
});

describe("demo song: a rendered drop, as heard", () => {
  const drop = sectionByName("Drop");
  const endBar = drop.start + 4;
  const musicEnd = Math.floor(4 * BAR * RATE);
  let project: Project;
  let mix: Stereo;
  let lead: Float32Array;
  let dryLead: Float32Array;
  let pad: Float32Array;
  let bass: Float32Array;
  let drums: Float32Array;
  let keys: Stereo;

  beforeAll(async () => {
    project = buildDemoProject();
    mix = await render(project, bars(drop.start, endBar));
    lead = monoOf(await render(keysPart(project, "lead"), bars(drop.start, endBar)));
    dryLead = monoOf(await render(keysPart(project, "lead", true), bars(drop.start, endBar)));
    pad = monoOf(await render(keysPart(project, "pad"), bars(drop.start, endBar)));
    bass = monoOf(await render(soloTrack(project, "demo-trk-bass"), bars(drop.start, endBar)));
    drums = monoOf(await render(soloTrack(project, "demo-trk-drums"), bars(drop.start, endBar)));
    keys = await render(soloTrack(project, "demo-trk-keys"), bars(drop.start, endBar));
  }, 300_000);

  it("plays the lead in tune, within 20 cents of every written note", () => {
    const notes = demoScore().filter((n) => n.role === "lead" && n.bar >= drop.start && n.bar < endBar);
    const r = worstPitchError(dryLead, notes, drop.start);
    console.info(`lead: ${r.count} notes, worst ${r.worst.toFixed(1)} cents, ${r.unread} unread`);
    expect(r.unread).toBe(0);
    expect(r.worst).toBeLessThan(20);
  });

  it("plays the bass in tune, within 20 cents of every written note", () => {
    const notes = demoScore().filter((n) => n.role === "bass" && n.bar >= drop.start && n.bar < endBar);
    const r = worstPitchError(bass, notes, drop.start);
    console.info(`bass: ${r.count} notes, worst ${r.worst.toFixed(1)} cents, ${r.unread} unread`);
    expect(r.unread).toBe(0);
    expect(r.worst).toBeLessThan(20);
  });

  it("sounds only the chord's notes in the pad, each within 20 cents", () => {
    for (let b = 0; b < 4; b++) {
      const bar = drop.start + b;
      const written = PAD_NOTES[(bar - 1) % 4];
      const lo = midiToHz(midi(written) - 1.5);
      const hi = midiToHz(midi(written) + PAD_UPPER_INTERVAL + 1.5);
      const raw = spectralPeaks(pad, RATE, (b * BAR + 0.25) * RATE, 32768, lo, hi, 24);
      // Unison voices split each note into a cluster a few cents wide; the cluster's centre is what is heard.
      const groups = new Map<number, { w: number; c: number }>();
      for (const p of raw) {
        const g = groups.get(p.midi) ?? { w: 0, c: 0 };
        const w = 10 ** (p.db / 10);
        groups.set(p.midi, { w: g.w + w, c: g.c + w * p.cents });
      }
      const heard = [...groups].map(([m, g]) => ({ midi: m, cents: g.c / g.w }));
      console.info(`pad bar ${bar} ${chordAtBar(bar).name}: ${heard.map((h) => `${h.midi}${h.cents >= 0 ? "+" : ""}${h.cents.toFixed(0)}`).join(" ")}`);
      // The written shell must sound; anything else heard is a chord tone ringing on from the bar before.
      expect(heard.map((h) => h.midi)).toEqual(expect.arrayContaining([midi(written), midi(written) + PAD_UPPER_INTERVAL]));
      for (const h of heard) {
        expect(chordAtBar(bar).tones).toContain(pc(h.midi));
        expect(Math.abs(h.cents)).toBeLessThan(20);
      }
    }
  });

  it("keeps true peaks under -3.5 dBFS, so the master limiter (at -1.5) never has to act", async () => {
    const stats = levelStats(mix, 0, musicEnd);
    console.info(`drop: peak ${stats.peakDb.toFixed(2)} dBFS, true peak ${stats.truePeakDb.toFixed(2)} dBTP, ${loudness(mix, RATE, 0, musicEnd).toFixed(1)} LUFS`);
    expect(stats.clipped).toBe(0);
    expect(stats.truePeakDb).toBeLessThan(-3.5);
    const unlimited = await render(project, { ...bars(drop.start, endBar), masterLimiter: false });
    let diff = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < musicEnd; i++) diff = Math.max(diff, Math.abs(mix[c][i] - unlimited[c][i]));
    console.info(`largest difference the limiter makes: ${(20 * Math.log10(diff + 1e-12)).toFixed(1)} dB`);
    expect(diff).toBeLessThan(0.001);
  }, 120_000);

  it("has a warm, even balance: no fizz, no mud hump, a falling top end", () => {
    expectWarmBalance(balanceOf(monoOf(mix), RATE, 0, musicEnd), "drop mix");
  });

  it("sounds full rather than bare: a wide image, a harmonically rich lead and a bass with audible harmonics", () => {
    const width = sideToMidDb(mix, 0, musicEnd);
    const leadBalance = balanceOf(dryLead, RATE, 0, musicEnd);
    const bassBalance = balanceOf(bass, RATE, 0, musicEnd);
    const bassHarmonics = bassBalance.lowMid + bassBalance.mud + bassBalance.mid + bassBalance.presence + bassBalance.air;
    console.info(`side/mid ${width.toFixed(1)} dB; lead centroid ${leadBalance.centroid.toFixed(0)} Hz; bass energy above 120 Hz ${(bassHarmonics * 100).toFixed(1)}%`);
    // A centred mono mix reads -inf; a phasey one approaches 0 dB.
    expect(width).toBeGreaterThan(-16);
    expect(width).toBeLessThan(-4);
    // Against the average pitch of the notes played: a bare sine reads 1.0, a lead with real harmonics well above it;
    // under 2.5 kHz keeps it soft.
    const notes = demoScore().filter((n) => n.role === "lead" && n.bar >= drop.start && n.bar < endBar);
    const meanF0 = notes.reduce((sum, n) => sum + midiToHz(n.midi), 0) / notes.length;
    console.info(`lead centroid / mean fundamental ${(leadBalance.centroid / meanF0).toFixed(2)}`);
    expect(leadBalance.centroid / meanF0).toBeGreaterThan(1.1);
    expect(leadBalance.centroid).toBeLessThan(2500);
    expect(bassHarmonics).toBeGreaterThan(0.06);
  });

  it("leaves only the kick and the bass below 120 Hz", () => {
    const keysBalance = balanceOf(monoOf(keys), RATE, 0, musicEnd);
    expect(keysBalance.sub + keysBalance.low).toBeLessThan(0.005);
    const drumsBalance = balanceOf(drums, RATE, 0, musicEnd);
    const bassBalance = balanceOf(bass, RATE, 0, musicEnd);
    expect(drumsBalance.sub + drumsBalance.low).toBeGreaterThan(0.3);
    expect(bassBalance.sub + bassBalance.low).toBeGreaterThan(0.7);
  });

  it("keeps the bass off the kick: its low end is far quieter on the beat than between beats", () => {
    const kick = lowPassed(drums, RATE, 120);
    const low = lowPassed(bass, RATE, 120);
    let onBeat = 0;
    let offBeat = 0;
    let kickLevel = 0;
    for (let b = 0; b < 16; b++) {
      const t = b * 4 * STEP * RATE;
      kickLevel += rmsDbOf(kick, t, t + 0.08 * RATE) / 16;
      onBeat += rmsDbOf(low, t, t + 0.08 * RATE) / 16;
      offBeat += rmsDbOf(low, t + 2 * STEP * RATE, t + 2 * STEP * RATE + 0.08 * RATE) / 16;
    }
    console.info(`kick low ${kickLevel.toFixed(1)} dB; bass low on the beat ${onBeat.toFixed(1)} dB, between beats ${offBeat.toFixed(1)} dB`);
    expect(offBeat - onBeat).toBeGreaterThan(15);
  });

  it("leaves a vocal pocket: the keys stay modest between 1 and 4 kHz", () => {
    const k = balanceOf(monoOf(keys), RATE, 0, musicEnd);
    const [, , , o500, o1k, o2k, o4k] = k.octaves;
    console.info(`keys octaves 500 Hz-4 kHz: ${[o500, o1k, o2k, o4k].map((o) => o.toFixed(1)).join(" ")}`);
    expect(o2k).toBeLessThan(o500 - 6);
    expect(o4k).toBeLessThan(o500 - 9);
  });

  it("hits the kick on the grid, with the backbeat a few dB under it", () => {
    const low = lowPassed(drums, RATE, 150).map(Math.abs);
    const offsets: number[] = [];
    for (let beat = 0; beat < 16; beat++) {
      const t = beat * 4 * STEP;
      const from = Math.floor(t * RATE);
      const to = Math.floor((t + 0.1) * RATE);
      let peak = 0;
      for (let i = from; i < to; i++) peak = Math.max(peak, low[i]);
      expect(peak).toBeGreaterThan(0.01);
      let onset = from;
      while (onset < to && Math.abs(drums[onset]) < peak * 0.2) onset++;
      offsets.push((onset / RATE - t) * 1000);
      let between = 0;
      for (let i = Math.floor((t + 2 * STEP - 0.02) * RATE); i < Math.floor((t + 2 * STEP + 0.02) * RATE); i++) between = Math.max(between, low[i]);
      expect(between).toBeLessThan(peak * 0.5);
    }
    console.info(`kick onsets (ms after the grid, the kit's compressors add a fixed look-ahead): ${offsets.map((o) => o.toFixed(1)).join(" ")}`);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(4);
    expect(Math.max(...offsets)).toBeLessThan(40);
  });

  it("balances the parts: drums and lead lead, the pad sits behind", () => {
    // Mono stems counted on both channels, so they compare with the stereo mix.
    const l = (x: Float32Array): number => loudness([x, x], RATE, 0, musicEnd);
    const levels = { mix: loudness(mix, RATE, 0, musicEnd), drums: l(drums), bass: l(bass), lead: l(lead), pad: l(pad) };
    console.info(`loudness (LUFS) ${JSON.stringify(Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, +v.toFixed(1)])))}; kick-led hit ${hitLoudness([drums, drums], RATE, 0, musicEnd).toFixed(1)}`);
    expect(levels.mix).toBeGreaterThan(-21);
    expect(levels.pad).toBeLessThan(levels.lead - 1);
    expect(levels.pad).toBeLessThan(levels.drums - 2);
    for (const part of [levels.drums, levels.lead]) expect(levels.mix - part).toBeLessThan(8);
    // K-weighting discounts the sub, where most of the bass lives, so it reads lower than it sounds.
    expect(levels.mix - levels.bass).toBeLessThan(9.5);
  });
});

/** Stems are for auditioning parts, so they are kept small: mono, 22.05 kHz, 16-bit. */
function monoWav(buffer: AudioBuffer): Uint8Array {
  return new Uint8Array(encodeWav([monoOf([buffer.getChannelData(0), buffer.getChannelData(1)])], buffer.sampleRate, { bitDepth: 16, dither: true }));
}

/** The whole song, the Song-matrix version and the files for the owner. Slow, so it runs when DEMO_RENDER=1. */
describe.runIf(ENV.DEMO_RENDER === "1")("demo song: the full render", () => {
  let song: Stereo;
  const end = Math.floor(TOTAL_BARS * BAR * RATE);
  const sectionSpan = (i: number): [number, number] => [Math.floor((starts[i] - 1) * BAR * RATE), Math.floor((starts[i] - 1 + DEMO_SECTIONS[i].bars) * BAR * RATE)];

  beforeAll(async () => {
    song = await render(buildDemoProject(), { tailSeconds: 3 });
  }, 900_000);

  it("never clips and keeps true peaks under -3.5 dBTP from start to finish", () => {
    const s = levelStats(song);
    console.info(`song: true peak ${s.truePeakDb.toFixed(2)} dBTP, ${loudness(song, RATE, 0, end).toFixed(1)} LUFS integrated`);
    expect(s.clipped).toBe(0);
    expect(s.truePeakDb).toBeLessThan(-3.5);
    expect(loudness(song, RATE, 0, end)).toBeGreaterThan(-23);
  });

  it("rises and falls: build over intro, drops over build, a break well under the drops, a quiet ending", () => {
    const lufs = DEMO_SECTIONS.map((_, i) => loudness(song, RATE, ...sectionSpan(i)));
    console.info(DEMO_SECTIONS.map((s, i) => `${s.name} ${lufs[i].toFixed(1)}`).join(" | "));
    const by = (kind: string): number[] => lufs.filter((_, i) => DEMO_SECTIONS[i].kind === kind);
    const intro = Math.max(...by("intro").slice(0, 2));
    const builds = by("build");
    const drops = by("drop");
    expect(Math.min(...builds)).toBeGreaterThan(intro + 2);
    expect(Math.min(...drops)).toBeGreaterThan(Math.max(...builds));
    expect(Math.max(...by("break"))).toBeLessThan(Math.min(...drops) - 3);
    expect(lufs[lufs.length - 2]).toBeLessThan(Math.min(...drops) - 3);
  });

  it("stays warm across the whole song", () => {
    expectWarmBalance(balanceOf(monoOf(song), RATE, 0, end), "song mix");
  });

  it("never drops out: no quarter second inside the song under -50 dBFS until the final chord", () => {
    const m = monoOf(song);
    const last = Math.floor((TOTAL_BARS - 1) * BAR * RATE);
    let quietest = Infinity;
    for (let s = 0; s + 0.25 * RATE <= last; s += 0.25 * RATE) quietest = Math.min(quietest, rmsDbOf(m, s, s + 0.25 * RATE));
    console.info(`quietest quarter second ${quietest.toFixed(1)} dBFS`);
    expect(quietest).toBeGreaterThan(-50);
    // The first beat already sounds: no silent lead-in.
    expect(rmsDbOf(m, 0, 0.5 * RATE)).toBeGreaterThan(-40);
  });

  it("resolves on B minor and lets the reverb ring after it", () => {
    const m = monoOf(song);
    const peaks = spectralPeaks(m, RATE, ((TOTAL_BARS - 1) * BAR + 0.3) * RATE, 32768, 100, 300, 15);
    console.info(`final chord peaks: ${peaks.map((p) => `${p.midi}${p.cents >= 0 ? "+" : ""}${p.cents.toFixed(0)}`).join(" ")}`);
    expect(peaks.length).toBeGreaterThan(1);
    for (const p of peaks) expect([11, 2, 6]).toContain(pc(p.midi));
  });

  it("reads back as 120 BPM", async () => {
    const ctx = new offlineClass(2, song[0].length, RATE);
    const buffer = ctx.createBuffer(2, song[0].length, RATE);
    buffer.copyToChannel(song[0], 0);
    buffer.copyToChannel(song[1], 1);
    const detected = await detectTempoAndKey(buffer);
    console.info(`detected ${JSON.stringify(detected)}`);
    // The key detector sees one key for the whole file, and this song changes key, so only the tempo is held to it.
    expect(Math.abs((detected.bpm ?? 0) - DEMO_BPM)).toBeLessThan(2);
  }, 120_000);

  it("sounds the same from the Song room's matrix as from the Arrange clips", async () => {
    const matrix = await render(buildDemoProject(), { tailSeconds: 3, source: "song" });
    for (let i = 0; i < DEMO_SECTIONS.length - 1; i++) {
      const [a, b] = sectionSpan(i);
      expect(Math.abs(loudness(matrix, RATE, a, b) - loudness(song, RATE, a, b))).toBeLessThan(0.3);
    }
    expect(levelStats(matrix).truePeakDb).toBeLessThan(-3.5);
  }, 900_000);

  it("writes docs/demo-render.wav and one stem per part to docs/demo-stems", async () => {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const docs = fileURLToPath(new URL("../../../docs/", import.meta.url));
    const ctx = new offlineClass(2, song[0].length, RATE);
    const buffer = ctx.createBuffer(2, song[0].length, RATE);
    buffer.copyToChannel(song[0], 0);
    buffer.copyToChannel(song[1], 1);
    fs.writeFileSync(`${docs}demo-render.wav`, new Uint8Array(audioBufferToWav(buffer, { bitDepth: 16, dither: true })));
    fs.mkdirSync(`${docs}demo-stems`, { recursive: true });
    const project = buildDemoProject();
    const stems = await mixdownStems(project, { sampleRate: 22050, tailSeconds: 3, deps });
    for (const stem of stems) {
      const name = stem.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      fs.writeFileSync(`${docs}demo-stems/${name}.wav`, monoWav(stem.buffer));
    }
    // Lead and pad share one instrument, so they are split here too for listening on their own.
    for (const part of ["lead", "pad"] as const) {
      const buf = await mixdownProject(keysPart(project, part), { sampleRate: 22050, tailSeconds: 3, deps, masterLimiter: false });
      fs.writeFileSync(`${docs}demo-stems/keys-${part}-only.wav`, monoWav(buf));
    }
    // The hook (call and answer, 4 bars) on the chosen lead and on three alternatives, alone with its own effects.
    fs.mkdirSync(`${docs}demo-stems/lead-alternatives`, { recursive: true });
    const keys = project.instruments.find((x) => x.kind === "galacticOne");
    if (!keys) throw new Error("The demo has no Galactic One.");
    for (const name of ["chosen", ...Object.keys(LEAD_ALTERNATIVES)]) {
      const values = { ...keys.state.values, ...leadValues(name === "chosen" ? undefined : name), "seq.layer": 0, "a.cut": name === "octave-lower" ? 1900 : 1600 };
      const data = { ...(keys.state.data as Record<string, unknown>), active: 1 };
      const buf = await bounceInstrument((ctx) => new GalacticOne(ctx), { ...keys.state, values, data }, { bars: 4, bpm: DEMO_BPM, sampleRate: RATE, offlineContext: offlineClass, tailSeconds: 2 });
      fs.writeFileSync(`${docs}demo-stems/lead-alternatives/${name}.wav`, new Uint8Array(audioBufferToWav(buf, { bitDepth: 16, dither: true })));
    }
    expect(stems.map((s) => s.name).sort()).toEqual([DEMO_TRACKS.drums, DEMO_TRACKS.perc, DEMO_TRACKS.bass, DEMO_TRACKS.keys, DEMO_TRACKS.arp, DEMO_TRACKS.acid].sort());
  }, 900_000);
});

/**
 * Maps the old studio's module settings onto the new instruments' saved state.
 *
 * Pure: it reads plain objects (already parsed from the old project record, localStorage or IndexedDB) and
 * returns new `InstrumentState` values. Nothing here touches storage, so it can never change old data.
 * Every mapper tolerates missing or corrupt input: bad fields fall back to the new instrument's default and
 * the result says so in `notes` instead of throwing.
 */
import { base64ToBytes } from "./binary";
import { FX_PARAMS, GALACTIC_PARAMS } from "../audio/instruments/synth/galacticParams";
import { KITS_DIVINE, PROFILE_CHOICES } from "../audio/instruments/drums/voicesDivine";
import type { InstrumentKind, InstrumentState } from "../audio/types";

export type Raw = Record<string, unknown>;

export interface SampleRef {
  assetId: string;
  name: string;
}

/** What a mapper needs from the importer: somewhere to put sample audio, and the project tempo. */
export interface ModuleEnv {
  bpm: number;
  addSample(bytes: Uint8Array, name: string): SampleRef;
}

export interface ModuleResult {
  state: InstrumentState;
  /** What came across, as short plain phrases for the import report. */
  carried: string[];
  /** Parts of this module with no equivalent in the new instrument. */
  notes: string[];
}

/** Old-studio settings that belong to the whole studio and not to one project. */
export interface LegacyGlobals {
  /** localStorage `glctc1_90mine_state`. */
  mine: unknown;
  /** localStorage `glctc1_galactic_one_v2`. */
  galacticOne: unknown;
  /** localStorage `glctc1_30lee_preset`. */
  lee: unknown;
  /** IndexedDB `glctc1_divine09_samples`, four slots; null where a slot was empty. */
  divineSamples: Array<{ name: string; bytes: Uint8Array } | null>;
}

export const NO_GLOBALS: LegacyGlobals = { mine: null, galacticOne: null, lee: null, divineSamples: [null, null, null, null] };

function rec(value: unknown): Raw | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : null;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function clamp(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}
function bool(value: unknown): number {
  return value === true || value === 1 ? 1 : 0;
}
/** Index of `value` in `options`, or `fallback` when it is not one of them. */
function indexOf<T>(options: readonly T[], value: unknown, fallback: number): number {
  const at = options.indexOf(value as T);
  return at >= 0 ? at : fallback;
}
function sampleName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.slice(0, 80) : fallback;
}

// ---- 80LA8 ----------------------------------------------------------------------------------

const BL_VOICES = 12;
const BL_STEPS = 16;
const BL_PATTERNS = 4;
const MAX_BL_SAMPLE_BYTES = 8 * 1024 * 1024;

export function mapBeatLab(raw: unknown, env: ModuleEnv): ModuleResult | null {
  const bl = rec(raw);
  if (!bl || !Array.isArray(bl.patterns)) return null;
  const notes: string[] = [];
  const values: Record<string, number> = {};
  values.swing = clamp(bl.swing, 0, 0.6, 0.08);
  values.bounceBars = indexOf([1, 2, 4, 8], Number(bl.bars), 1);

  const samples: Array<SampleRef | null> = Array.from({ length: BL_VOICES }, () => null);
  let samplesCarried = 0;
  let keyUnlocked = 0;
  const voices = list(bl.voices);
  for (let i = 0; i < BL_VOICES; i++) {
    const v = rec(voices[i]);
    if (!v) continue;
    values[`v${i}.level`] = clamp(v.volume, 0, 1.5, 0.82);
    values[`v${i}.pan`] = clamp(v.pan, -1, 1, 0);
    values[`v${i}.tune`] = Math.round(clamp(v.pitch, -24, 24, 0));
    values[`v${i}.decay`] = clamp(v.decay, 0.04, 2.5, 0.35);
    values[`v${i}.tone`] = clamp(v.tone, 150, 18000, 10000);
    values[`v${i}.drive`] = clamp(v.drive, 0, 1, 0);
    values[`v${i}.delay`] = clamp(v.delay, 0, 1, 0);
    values[`v${i}.reverb`] = clamp(v.reverb, 0, 1, 0);
    values[`v${i}.mute`] = bool(v.mute);
    values[`v${i}.solo`] = bool(v.solo);
    if (v.keyLock === false) keyUnlocked += 1;
    if (typeof v.sampleData === "string" && v.sampleData) {
      const name = sampleName(v.sampleName, `80LA8 sample ${i + 1}`);
      try {
        const bytes = base64ToBytes(v.sampleData);
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BL_SAMPLE_BYTES) throw new RangeError("size");
        samples[i] = env.addSample(bytes, name);
        samplesCarried += 1;
      } catch {
        notes.push(`80LA8 sample "${name}" on voice ${i + 1} is damaged, so that voice plays its built-in sound.`);
      }
    }
  }
  if (keyUnlocked) notes.push(`80LA8 key lock off on ${keyUnlocked} voice${keyUnlocked === 1 ? "" : "s"} (the new 80LA8 does not detune voices with tempo).`);

  const patterns = Array.from({ length: BL_PATTERNS }, (_, p) => {
    const steps = list(rec(list(bl.patterns)[p])?.steps);
    return Array.from({ length: BL_VOICES }, (_, v) => {
      const row = list(steps[v]);
      return Array.from({ length: BL_STEPS }, (_, i) => {
        const step = row[i];
        const s = rec(step);
        const on = s ? s.on === true : step === true;
        if (!on) return 0;
        return s ? clamp(s.velocity, 0.05, 1, 0.84) : 0.84;
      });
    });
  });
  const hits = patterns.reduce((n, p) => n + p.reduce((m, r) => m + r.filter((x) => x > 0).length, 0), 0);
  const data: Raw = {
    patterns,
    pattern: Math.round(clamp(bl.activePattern, 0, BL_PATTERNS - 1, 0)),
    voice: 0,
    samples,
  };
  const carried = [`80LA8: ${hits} drum hits across 4 patterns, ${BL_VOICES} voice settings and swing`];
  if (samplesCarried) carried.push(`80LA8: ${samplesCarried} loaded sample${samplesCarried === 1 ? "" : "s"}`);
  return { state: { kind: "drum80la8", values, data }, carried, notes };
}

// ---- DIVINE09 (the old 90MINE module) ---------------------------------------------------------

const OLD_KITS = ["909", "808", "606", "707", "linn", "dmx", "electro", "industrial", "tribal", "breaks", "glitch", "hybrid"];
const OLD_PROFILES = ["kit", "808", "909", "analogue", "digital", "metallic", "noise", "sub", "tight", "wide"];
const DIVINE_VOICES = 15;
const DIVINE_SYNTH_VOICES = 11;
const DIVINE_STEPS = 128;
const DIVINE_PATTERNS = 4;

const KIT_INDEX = new Map(KITS_DIVINE.map((k, i) => [k.id, i]));
const PROFILE_INDEX = new Map(PROFILE_CHOICES.map((c, i) => [c.id, i]));

export function mapDivine(raw: unknown, samples: LegacyGlobals["divineSamples"], env: ModuleEnv): ModuleResult | null {
  const s = rec(raw);
  const samplesFound = samples.some((x) => x !== null);
  if (!s && !samplesFound) return null;
  const notes: string[] = [];
  const carried: string[] = [];
  const values: Record<string, number> = {};
  let data: Raw | undefined;
  const refs: Array<SampleRef | null> = [null, null, null, null];

  if (s && Array.isArray(s.patterns) && s.patterns.length >= 1) {
    const legacy = s.sv !== 2;
    values.kit = KIT_INDEX.get(typeof s.kit === "string" ? s.kit : "") ?? 0;
    const bars = Number(s.bars);
    values.length = indexOf([1, 2, 4, 8], bars, 1);
    values.swing = clamp(s.swing, 0, 0.6, 0.08);
    values.level = clamp(s.level, 0, 1, 0.85);
    values.drive = clamp(s.drive, 0, 1, 0.18);
    values.room = clamp(s.room, 0, 0.7, 0.12);
    values.hat = clamp(s.hat, 0.1, 1, 0.65);
    values.crush = clamp(s.bitcrush, 0, 1, 0);
    values.filter = clamp(s.filter ?? 1, 0, 1, 1);
    const channels = list(s.channels);
    const profiles = list(s.profiles);
    for (let i = 0; i < DIVINE_VOICES; i++) {
      const c = rec(channels[i]);
      if (c) {
        values[`v${i}.level`] = clamp(c.level ?? 1, 0, 1, 1);
        values[`v${i}.pan`] = clamp(c.pan, -1, 1, 0);
        values[`v${i}.tone`] = legacy ? 0 : clamp(c.tone, -1, 1, 0);
        values[`v${i}.delay`] = clamp(c.delay, 0, 1, 0);
        values[`v${i}.reverb`] = clamp(c.reverb, 0, 1, 0);
      }
      if (i < DIVINE_SYNTH_VOICES) values[`v${i}.profile`] = PROFILE_INDEX.get(OLD_PROFILES.includes(profiles[i] as string) ? (profiles[i] as string) : "kit") ?? 0;
    }
    const patterns = Array.from({ length: DIVINE_PATTERNS }, (_, p) => {
      const rows = list(list(s.patterns)[p]);
      return Array.from({ length: DIVINE_VOICES }, (_, v) => {
        const row = list(rows[v]);
        return Array.from({ length: DIVINE_STEPS }, (_, i) => {
          const step = rec(row[i]);
          return step && step.on === true ? (step.accent === true ? 2 : 1) : 0;
        });
      });
    });
    const hits = patterns.reduce((n, p) => n + p.reduce((m, r) => m + r.filter((x) => x > 0).length, 0), 0);
    data = { patterns, pattern: Math.round(clamp(s.active, 0, DIVINE_PATTERNS - 1, 0)), voice: 0 };
    carried.push(`DIVINE09: ${hits} drum hits across 4 patterns, kit "${OLD_KITS.includes(String(s.kit)) ? String(s.kit) : "909"}", mixer and master settings`);
    if (typeof s.kit === "string" && !OLD_KITS.includes(s.kit)) notes.push(`DIVINE09 kit "${s.kit}" is not one the new studio knows, so the default kit is used.`);
  } else if (s) {
    notes.push("DIVINE09 settings in the old studio are damaged or empty, so the new DIVINE09 starts from its defaults.");
  }

  let samplesCarried = 0;
  samples.slice(0, 4).forEach((item, i) => {
    if (!item) return;
    try {
      if (item.bytes.byteLength === 0) throw new RangeError("empty");
      refs[i] = env.addSample(item.bytes, sampleName(item.name, `Sample ${i + 1}`));
      samplesCarried += 1;
    } catch {
      notes.push(`DIVINE09 sample slot ${i + 1} is damaged and was left empty.`);
    }
  });
  if (samplesCarried) {
    data = { ...(data ?? {}), samples: refs };
    carried.push(`DIVINE09: ${samplesCarried} loaded sample${samplesCarried === 1 ? "" : "s"}`);
  }
  if (!data) return { state: { kind: "divine09", values }, carried, notes };
  return { state: { kind: "divine09", values, data }, carried, notes };
}

// ---- 30LEE ---------------------------------------------------------------------------------------

const ACID_ARP_MODES = ["up", "down", "updown", "played", "random"];
const ARP_RATE_LABELS = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];

export function mapAcid(raw: unknown): ModuleResult | null {
  const s = rec(raw);
  if (!s || !Array.isArray(s.patterns) || s.patterns.length !== 4) return null;
  const notes: string[] = [];
  const fx = rec(s.fx) ?? {};
  const values: Record<string, number> = {
    wave: indexOf(["sawtooth", "square", "triangle"], s.wave, 0),
    octave: Math.round(clamp(s.octave, -1, 1, 0)) + 1,
    cutoff: clamp(s.cutoff, 80, 12000, 900),
    // The old slider ran 0-25; the new one is a 0-1 fraction of that.
    resonance: clamp(typeof s.resonance === "number" ? s.resonance / 25 : undefined, 0, 1, 0.52),
    envMod: clamp(s.envMod, 0, 1, 0.72),
    decay: clamp(typeof s.decay === "number" ? s.decay * 1000 : undefined, 50, 1500, 220),
    attack: clamp(typeof s.attack === "number" ? s.attack * 1000 : undefined, 1, 150, 4),
    accent: clamp(s.accent, 0, 1, 0.7),
    filterMode: indexOf(["lowpass", "bandpass", "highpass"], s.filterMode, 0),
    sub: clamp(s.sub, 0, 1, 0.24),
    subWave: indexOf(["square", "sine", "triangle"], s.subWave, 0),
    level: clamp(s.level, 0, 1, 0.68),
    drive: clamp(fx.dist ?? s.drive, 0, 1, 0.55),
    crush: clamp(fx.bitcrush, 0, 1, 0),
    delay: clamp(fx.delay, 0, 0.75, 0.14),
    // The old delay was always a dotted eighth.
    delayTime: 2,
    delayFb: clamp(fx.feedback, 0, 0.78, 0.28),
    reverb: clamp(fx.reverb, 0, 0.65, 0.12),
    fxMix: clamp(fx.wet, 0, 1, 0.28),
    fxFilter: clamp(fx.filter, 500, 18000, 12000),
    width: clamp(fx.stereo, 0, 1, 0.22),
    swing: clamp(s.swing, 0, 0.6, 0.08),
    slideTime: clamp(typeof s.slideTime === "number" ? s.slideTime * 1000 : undefined, 0, 350, 90),
    gate: clamp(s.gate, 0.15, 1.4, 0.72),
    chance: clamp(s.prob, 0.1, 1, 1),
    arpOn: bool(s.arpOn),
    arpMode: indexOf(ACID_ARP_MODES, s.arpMode, 0),
    arpRate: indexOf(ARP_RATE_LABELS, s.arpRate, 3),
    arpOct: Math.round(clamp(s.arpOct, 1, 4, 2)),
    arpGate: clamp(s.arpGate, 0.15, 1, 0.72),
  };
  const length = s.length === 8 ? 8 : 16;
  const patterns = s.patterns.map((p) => {
    const row = list(p);
    return Array.from({ length: 16 }, (_, i) => {
      const st = rec(row[length === 8 ? i % 8 : i]);
      return {
        on: st?.on === true,
        note: Math.round(clamp(st?.note, 0, 127, 36)),
        oct: 0,
        accent: st?.accent === true,
        slide: st?.slide === true,
      };
    });
  });
  if (length === 8) notes.push("30LEE pattern length 8 was tiled to fill the new 16-step grid, so it sounds the same.");
  if (s.stutter === true || s.freeze === true || s.tape === true) notes.push("30LEE performance switches (stutter, filter freeze, tape drop) were on; they are momentary in the new studio and start off.");
  const hits = patterns.reduce((n, p) => n + p.filter((x) => x.on).length, 0);
  return {
    state: { kind: "acid30lee", values, data: { patterns, active: Math.round(clamp(s.active, 0, 3, 0)) } },
    carried: [`30LEE: ${hits} notes across 4 patterns, sound and effects, arpeggiator`],
    notes,
  };
}

// ---- 0010110 --------------------------------------------------------------------------------------

const LEAD_DELAY_BEATS = [0.25, 0.5, 0.75, 1, 1.5];

function nearestIndex(options: readonly number[], target: number): number {
  let best = 0;
  options.forEach((o, i) => {
    if (Math.abs(o - target) < Math.abs((options[best] ?? o) - target)) best = i;
  });
  return best;
}

export function mapLead(raw: unknown, bpm: number): ModuleResult | null {
  const s = rec(raw);
  if (!s || !Array.isArray(s.layers)) return null;
  const waves = ["sawtooth", "square", "triangle", "sine"];
  const values: Record<string, number> = {
    cutoff: clamp(s.cut, 40, 16000, 4200),
    // Old range 0.1-18, new is a fraction of that.
    resonance: clamp(typeof s.res === "number" ? s.res / 18 : undefined, 0, 1, 0.28),
    filterEnv: clamp(s.env, 0, 1, 0.55),
    attack: clamp(s.attack, 0.001, 1, 0.008),
    decay: clamp(s.decay, 0.01, 2, 0.18),
    sustain: clamp(s.sustain, 0, 1, 0.58),
    release: clamp(s.release, 0.01, 3, 0.22),
    pulse: clamp(s.pulse, 0.1, 0.9, 0.5),
    sub: clamp(s.sub, 0, 1, 0.6),
    noise: clamp(s.noise, 0, 0.6, 0),
    glide: clamp(s.glide, 0, 0.5, 0.025),
    lfoRate: clamp(s.lfoRate, 0.1, 20, 4.5),
    lfoDepth: clamp(s.lfoAmt, 0, 1, 0),
    level: clamp(s.level, 0, 1, 0.72),
    sampleReverse: bool(s.reverse),
    arpOn: bool(s.arpOn),
    arpLatch: bool(s.arpLatch),
    arpMode: indexOf(ACID_ARP_MODES, s.arpMode, 0),
    arpRate: indexOf(ARP_RATE_LABELS, s.arpRate, 3),
    arpOct: Math.round(clamp(s.arpOct, 1, 4, 2)),
    arpGate: clamp(s.arpGate, 0.1, 1, 0.7),
    arpSwing: clamp(s.arpSwing, 0, 0.5, 0),
    hold: bool(s.hold),
    chorus: clamp(s.chorus, 0, 0.8, 0.08),
    delay: clamp(s.delay, 0, 0.85, 0.12),
    // The old delay time was in seconds and not tempo-synced; use the closest musical value at the project tempo.
    delayTime: nearestIndex(LEAD_DELAY_BEATS, (clamp(s.delayTime, 0.04, 1, 0.28) * bpm) / 60),
    delayFb: clamp(s.feedback, 0, 0.88, 0.24),
    reverb: clamp(s.reverb, 0, 0.8, 0.12),
    drive: clamp(s.drive, 0, 1, 0.12),
    crush: clamp(s.bitcrush, 0, 1, 0),
  };
  const layers = list(s.layers);
  for (let n = 1; n <= 3; n++) {
    const l = rec(layers[n - 1]) ?? {};
    // Layer 1 follows the main oscillator choice in the old synth.
    const wave = n === 1 ? s.wave : l.wave;
    values[`l${n}on`] = bool(l.on);
    values[`l${n}wave`] = indexOf(waves, wave, n === 1 ? 0 : n === 2 ? 1 : 2);
    values[`l${n}oct`] = Math.round(clamp(l.oct, -2, 2, 0));
    values[`l${n}semi`] = Math.round(clamp(l.semi, -12, 12, 0));
    values[`l${n}detune`] = Math.round(clamp(l.detune, -50, 50, 0));
    values[`l${n}level`] = clamp(l.level, 0, 1, 0.5);
  }
  return {
    state: { kind: "lead0010110", values },
    carried: ["0010110: oscillator layers, filter, envelope, LFO, arpeggiator and effects"],
    notes: [
      "0010110 step pattern (the old studio never saved it) and sample (never saved either): the new 0010110 starts with its own pattern and no sample.",
      ...(s.stutter === true || s.freeze === true ? ["0010110 stutter or freeze was on; those are momentary in the new studio and start off."] : []),
    ],
  };
}

// ---- GALACTIC ONE -----------------------------------------------------------------------------

const GO_DEFS = new Map(GALACTIC_PARAMS.map((p) => [p.id, p]));
const GO_PATCH_IDS = GALACTIC_PARAMS.filter((p) => p.id.startsWith("a.")).map((p) => p.id.slice(2));
const GO_FX_IDS = FX_PARAMS.map((p) => p.id.slice(3));

function setGo(values: Record<string, number>, id: string, value: unknown, fallback?: number): void {
  const def = GO_DEFS.get(id);
  if (!def) return;
  const v = clamp(value, def.min, def.max, fallback ?? Number.NaN);
  if (Number.isNaN(v)) return;
  values[id] = def.options || def.step === 1 ? Math.round(v) : v;
}

const GO_SCALES = ["chromatic", "major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "harm minor", "minor pent", "major pent", "blues", "whole tone"];
// Old order: UP DOWN UP/DOWN DOWN/UP RANDOM AS-PLAYED CHORD CONVERGE. New: up down updown downup random chord played converge.
const GO_ARP_MAP = [0, 1, 2, 3, 4, 6, 5, 7];

export function mapGalacticOne(raw: unknown): ModuleResult | null {
  const st = rec(raw);
  if (!st || !Array.isArray(st.patches)) return null;
  const values: Record<string, number> = {};
  (["a", "b"] as const).forEach((letter, pi) => {
    const patch = rec(st.patches instanceof Array ? st.patches[pi] : null);
    if (!patch) return;
    for (const id of GO_PATCH_IDS) if (id in patch) setGo(values, `${letter}.${id}`, patch[id]);
  });
  const fx = rec(st.fx);
  if (fx) for (const id of GO_FX_IDS) if (id in fx) setGo(values, `fx.${id}`, fx[id]);
  const mac = rec(st.mac);
  if (mac) {
    setGo(values, "macro.bright", typeof mac.bright === "number" ? (mac.bright + 1) / 2 : undefined);
    for (const id of ["motion", "space", "grit"]) setGo(values, `macro.${id}`, mac[id]);
  }
  setGo(values, "key.mode", st.keymode);
  setGo(values, "perf.hold", bool(st.hold));
  setGo(values, "perf.voices", st.voices);
  setGo(values, "perf.tune", st.tune);

  const seq = rec(st.seq);
  const patterns: unknown[] = [];
  let hits = 0;
  let active = 0;
  let chain: number[] | undefined;
  if (seq) {
    setGo(values, "seq.mode", indexOf(["seq", "arp", "off"], seq.mode, 0));
    setGo(values, "seq.target", seq.target);
    setGo(values, "seq.root", seq.root);
    setGo(values, "seq.scale", indexOf(GO_SCALES, seq.scale, 2));
    setGo(values, "seq.snap", bool(seq.snap));
    setGo(values, "seq.octave", seq.oct);
    setGo(values, "seq.dir", seq.dir);
    setGo(values, "seq.swing", seq.swing);
    setGo(values, "seq.rate", seq.rate);
    setGo(values, "seq.follow", bool(seq.follow));
    setGo(values, "seq.evolve", bool(seq.evolve));
    setGo(values, "seq.chain", bool(seq.chainOn));
    setGo(values, "seq.layer", typeof seq.layer === "number" ? seq.layer + 1 : 0);
    setGo(values, "seq.bars", indexOf([1, 2, 4, 8], Number(seq.bars), 1));
    setGo(values, "arp.mode", GO_ARP_MAP[Math.round(clamp(seq.arpMode, 0, 7, 2))] ?? 2);
    setGo(values, "arp.oct", seq.arpOct);
    setGo(values, "arp.latch", bool(seq.latch));
    active = Math.round(clamp(seq.cur, 0, 7, 0));
    chain = list(seq.chain).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 8);
    for (const p of list(seq.pats).slice(0, 8)) {
      const pat = rec(p);
      const steps = list(pat?.steps).slice(0, 32);
      patterns.push({
        len: [4, 8, 16, 32].includes(Number(pat?.len)) ? Number(pat?.len) : 16,
        steps: steps.map((x) => {
          const s = rec(x) ?? {};
          const on = s.on === 1 || s.on === true;
          if (on) hits += 1;
          return {
            on,
            n: Math.round(clamp(s.n, -48, 48, 0)),
            v: clamp(s.v, 0, 1, 0.8),
            g: clamp(s.g, 0.02, 1.2, 0.6),
            p: clamp(s.p, 0, 1, 1),
            r: Math.round(clamp(s.r, 1, 8, 1)),
            c: clamp(s.c, -1, 1, 0),
            accent: s.a === 1 || s.a === true,
            slide: s.s === 1 || s.s === true,
          };
        }),
      });
    }
  }
  const data: Raw = { patterns, active };
  if (chain) data.chain = chain;
  const names = Array.isArray(st.names) ? st.names.filter((n): n is string => typeof n === "string").slice(0, 2) : [];
  if (names.length) data.names = names;
  const carried = [`GALACTIC ONE: patch A${names[0] ? ` "${names[0]}"` : ""} and patch B${names[1] ? ` "${names[1]}"` : ""}, effects, macros, ${hits} sequencer steps in ${patterns.length} patterns`];
  if (!patterns.length) delete data.patterns;
  return { state: { kind: "galacticOne", values, data }, carried, notes: [] };
}

export const MODULE_KIND_BY_NAME: ReadonlyArray<{ test: RegExp; kind: InstrumentKind }> = [
  { test: /looper/i, kind: "looper" },
  { test: /80la8/i, kind: "drum80la8" },
  { test: /90mine/i, kind: "divine09" },
  { test: /30lee/i, kind: "acid30lee" },
  { test: /0010110/i, kind: "lead0010110" },
  { test: /galactic one/i, kind: "galacticOne" },
];

export function moduleKindOf(trackName: string): InstrumentKind | null {
  if (!/module track/i.test(trackName)) return null;
  return MODULE_KIND_BY_NAME.find((m) => m.test.test(trackName))?.kind ?? null;
}

export const MODULE_LABEL: Record<string, { name: string; color: string }> = {
  drum80la8: { name: "80LA8", color: "#79ebff" },
  divine09: { name: "Divine09", color: "#8e7cff" },
  acid30lee: { name: "30LEE", color: "#8e7cff" },
  lead0010110: { name: "0010110", color: "#ff63d8" },
  galacticOne: { name: "Galactic One", color: "#79ebff" },
};

/** One entry per pattern that holds notes or hits, with its length in bars (16 steps are one bar). */
export function filledPatterns(state: InstrumentState): Array<{ index: number; bars: number }> {
  const data = rec(state.data);
  const patterns = list(data?.patterns);
  const out: Array<{ index: number; bars: number }> = [];
  patterns.forEach((p, index) => {
    if (state.kind === "drum80la8") {
      if (list(p).some((row) => list(row).some((v) => typeof v === "number" && v > 0))) out.push({ index, bars: 1 });
    } else if (state.kind === "acid30lee") {
      if (list(p).some((s) => rec(s)?.on === true)) out.push({ index, bars: 1 });
    } else if (state.kind === "galacticOne") {
      const pat = rec(p);
      if (list(pat?.steps).some((s) => rec(s)?.on === true)) out.push({ index, bars: Math.max(1, Number(pat?.len) || 16) / 16 });
    }
  });
  return out;
}

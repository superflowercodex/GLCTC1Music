import type { ParamDef, Preset } from "../../types";
import { SCALE_NAMES, NOTE_NAMES } from "./scales";
import { ARP_MODES } from "./arp";

export const WAVES = ["Saw", "Square", "Pulse", "Triangle", "Sine"] as const;
export const WAVE_TYPES = ["sawtooth", "square", "pulse", "triangle", "sine"] as const;
export const RANGES = ["32'", "16'", "8'", "4'", "2'"] as const;
export const LFO_SHAPE_NAMES = ["Sine", "Triangle", "Saw", "Square", "Random"] as const;
export const SYNC_NAMES = ["Free", "1/1", "1/2", "1/4", "1/8", "1/16", "1/4T", "1/8T", "1/16T"] as const;
export const SYNC_BEATS = [0, 4, 2, 1, 0.5, 0.25, 2 / 3, 1 / 3, 1 / 6] as const;
export const MATRIX_SOURCES = ["Off", "LFO 1", "LFO 2", "Envelope", "Mod wheel", "Velocity", "Key", "Random"] as const;
export const MATRIX_DESTS = ["Pitch", "Cutoff", "Resonance", "Pulse width", "Volume", "Pan", "Osc 2 pitch", "FM"] as const;
/** Size of one unit of each matrix destination: cents, cents, dB, fraction, fraction, fraction, cents, ratio. */
export const MATRIX_SCALE = [1200, 4800, 12, 0.45, 0.5, 1, 1200, 1] as const;
export const MATRIX_DEST_IDS = ["pitch", "cut", "res", "pw", "amp", "pan", "o2", "x"] as const;
export const VOICE_MODES = ["Poly", "Mono", "Legato"] as const;
export const SEQ_RATES = ["1/8", "1/16", "1/32", "1/8T", "1/16T", "1/4"] as const;
export const SEQ_RATE_BEATS = [0.5, 0.25, 0.125, 1 / 3, 1 / 6, 1] as const;
export const DIRECTIONS = ["Forward", "Reverse", "Ping-pong", "Random", "Drunk"] as const;
export const DELAY_DIVS = ["1/4", "1/8", "3/16", "1/16", "1/4T", "1/8T"] as const;
export const DELAY_BEATS = [1, 0.5, 0.75, 0.25, 2 / 3, 1 / 3] as const;
export const GATE_DIVS = ["Off", "1/4", "1/8", "1/16", "1/32"] as const;
export const GATE_BEATS = [0, 1, 0.5, 0.25, 0.125] as const;
export const CHORUS_MODES = ["Off", "I", "II", "I+II"] as const;
export const REVERB_SIZES = ["Room", "Hall", "Cathedral"] as const;
export const REVERB_SECONDS = [0.9, 2.4, 5.2] as const;
export const KEY_MODES = ["Whole", "Split", "Dual"] as const;
export const SEQ_MODES = ["Sequence", "Arp", "Off"] as const;
export const SEQ_TARGETS = ["Patch A", "Patch B", "Both"] as const;
export const BANK_COUNT = 8;

type Kind = "k" | "s";
interface Def {
  id: string;
  label: string;
  section: "Oscillators" | "Filter" | "Envelopes" | "Movement";
  type: Kind;
  min: number;
  max: number;
  def: number;
  unit?: string;
  step?: number;
  options?: readonly string[];
}

const def = (section: Def["section"], id: string, label: string, type: Kind, min: number, max: number, d: number, extra: Partial<Def> = {}): Def => ({ id, label, section, type, min, max, def: d, ...extra });

const O = "Oscillators" as const;
const F = "Filter" as const;
const E = "Envelopes" as const;
const M = "Movement" as const;

/** One patch worth of controls, shared by patch A and patch B. */
const PATCH_DEFS: readonly Def[] = [
  def(O, "o1wave", "Osc 1 wave", "s", 0, 4, 0, { options: WAVES }),
  def(O, "o1oct", "Osc 1 range", "s", 0, 4, 2, { options: RANGES }),
  def(O, "o1fine", "Osc 1 fine", "k", -50, 50, 0, { unit: "ct" }),
  def(O, "o1pw", "Osc 1 pulse width", "k", 0.05, 0.95, 0.5, { unit: "%" }),
  def(O, "o1lvl", "Osc 1 level", "k", 0, 1, 0.8, { unit: "%" }),
  def(O, "o2wave", "Osc 2 wave", "s", 0, 4, 0, { options: WAVES }),
  def(O, "o2oct", "Osc 2 range", "s", 0, 4, 2, { options: RANGES }),
  def(O, "o2semi", "Osc 2 semitone", "k", -12, 12, 0, { unit: "st", step: 1 }),
  def(O, "o2fine", "Osc 2 fine", "k", -100, 100, 8, { unit: "ct" }),
  def(O, "o2pw", "Osc 2 pulse width", "k", 0.05, 0.95, 0.5, { unit: "%" }),
  def(O, "o2lvl", "Osc 2 level", "k", 0, 1, 0.7, { unit: "%" }),
  def(O, "sub", "Sub", "k", 0, 1, 0.25, { unit: "%" }),
  def(O, "subwave", "Sub wave", "s", 0, 1, 0, { options: ["Square", "Sine"] }),
  def(O, "noise", "Noise", "k", 0, 1, 0, { unit: "%" }),
  def(O, "ncolor", "Noise colour", "s", 0, 1, 0, { options: ["White", "Pink"] }),
  def(O, "ring", "Ring mod", "k", 0, 1, 0, { unit: "%" }),
  def(O, "xmod", "FM", "k", 0, 1, 0, { unit: "%" }),
  def(O, "uni", "Unison voices", "k", 1, 7, 3, { step: 1 }),
  def(O, "spread", "Unison detune", "k", 0, 60, 14, { unit: "ct" }),
  def(O, "width", "Unison width", "k", 0, 1, 0.8, { unit: "%" }),
  def(O, "drift", "Drift", "k", 0, 1, 0.25, { unit: "%" }),

  def(F, "hpf", "High-pass", "k", 20, 2000, 20, { unit: "Hz" }),
  def(F, "cut", "Cutoff", "k", 30, 18000, 5200, { unit: "Hz" }),
  def(F, "res", "Resonance", "k", 0, 1, 0.25, { unit: "%" }),
  def(F, "drive", "Drive", "k", 0, 1, 0.1, { unit: "%" }),
  def(F, "slope", "Slope", "s", 0, 1, 1, { options: ["12 dB", "24 dB"] }),
  def(F, "fenv", "Envelope amount", "k", -1, 1, 0.45, { unit: "%" }),
  def(F, "key", "Key tracking", "k", 0, 1, 0.5, { unit: "%" }),
  def(F, "fvel", "Velocity to cutoff", "k", 0, 1, 0.3, { unit: "%" }),

  def(E, "fa", "Filter attack", "k", 0.001, 4, 0.01, { unit: "s" }),
  def(E, "fd", "Filter decay", "k", 0.01, 5, 0.4, { unit: "s" }),
  def(E, "fs", "Filter sustain", "k", 0, 1, 0.35, { unit: "%" }),
  def(E, "fr", "Filter release", "k", 0.01, 6, 0.5, { unit: "s" }),
  def(E, "aa", "Amp attack", "k", 0.001, 4, 0.01, { unit: "s" }),
  def(E, "ad", "Amp decay", "k", 0.01, 5, 0.3, { unit: "s" }),
  def(E, "as", "Amp sustain", "k", 0, 1, 0.75, { unit: "%" }),
  def(E, "ar", "Amp release", "k", 0.01, 8, 0.6, { unit: "s" }),
  def(E, "avel", "Velocity to volume", "k", 0, 1, 0.5, { unit: "%" }),
  def(E, "vol", "Volume", "k", 0, 1, 0.75, { unit: "%" }),

  def(M, "l1shape", "LFO 1 shape", "s", 0, 4, 0, { options: LFO_SHAPE_NAMES }),
  def(M, "l1rate", "LFO 1 rate", "k", 0.05, 30, 5, { unit: "Hz" }),
  def(M, "l1sync", "LFO 1 sync", "s", 0, 8, 0, { options: SYNC_NAMES }),
  def(M, "l1delay", "LFO 1 fade-in", "k", 0, 3, 0, { unit: "s" }),
  def(M, "l1pitch", "LFO 1 to pitch", "k", 0, 1, 0.08, { unit: "%" }),
  def(M, "l1cut", "LFO 1 to cutoff", "k", 0, 1, 0, { unit: "%" }),
  def(M, "l1pw", "LFO 1 to pulse width", "k", 0, 1, 0, { unit: "%" }),
  def(M, "l1amp", "LFO 1 to volume", "k", 0, 1, 0, { unit: "%" }),
  def(M, "mwvib", "Wheel to vibrato", "k", 0, 1, 0.5, { unit: "%" }),
  def(M, "mwcut", "Wheel to cutoff", "k", 0, 1, 0.3, { unit: "%" }),
  def(M, "l2shape", "LFO 2 shape", "s", 0, 4, 1, { options: LFO_SHAPE_NAMES }),
  def(M, "l2rate", "LFO 2 rate", "k", 0.05, 30, 0.5, { unit: "Hz" }),
  def(M, "l2sync", "LFO 2 sync", "s", 0, 8, 0, { options: SYNC_NAMES }),
  ...[1, 2, 3, 4].flatMap((i) => [
    def(M, `m${i}src`, `Slot ${i} source`, "s", 0, 7, 0, { options: MATRIX_SOURCES }),
    def(M, `m${i}dst`, `Slot ${i} destination`, "s", 0, 7, 1, { options: MATRIX_DESTS }),
    def(M, `m${i}amt`, `Slot ${i} amount`, "k", -1, 1, 0, { unit: "%" }),
  ]),
  def(M, "mode", "Voice mode", "s", 0, 2, 0, { options: VOICE_MODES }),
  def(M, "glide", "Glide", "k", 0, 2, 0, { unit: "s" }),
  def(M, "bend", "Bend range", "k", 1, 12, 2, { unit: "st", step: 1 }),
  def(M, "penv", "Envelope to pitch", "k", -12, 12, 0, { unit: "st" }),
];

export const PATCH_PARAM_IDS: readonly string[] = PATCH_DEFS.map((d) => d.id);

export function patchGroup(patch: "a" | "b", section: string): string {
  return `Patch ${patch.toUpperCase()} · ${section}`;
}

function patchParams(patch: "a" | "b"): ParamDef[] {
  return PATCH_DEFS.map((d) => ({
    id: `${patch}.${d.id}`,
    label: d.label,
    group: patchGroup(patch, d.section),
    min: d.min,
    max: d.max,
    step: d.step,
    def: d.def,
    unit: d.unit,
    options: d.options,
  }));
}

const fx = (id: string, label: string, min: number, max: number, d: number, extra: Partial<ParamDef> = {}): ParamDef => ({ id: `fx.${id}`, label, group: "Effects", min, max, def: d, ...extra });

export const FX_PARAMS: readonly ParamDef[] = [
  fx("fxDrive", "Drive", 0, 1, 0, { unit: "%" }),
  fx("fxCrush", "Crush", 0, 1, 0, { unit: "%" }),
  fx("gRate", "Trance gate rate", 0, 4, 0, { options: GATE_DIVS }),
  fx("gDepth", "Trance gate depth", 0, 1, 0.9, { unit: "%" }),
  fx("chMode", "Chorus type", 0, 3, 1, { options: CHORUS_MODES }),
  fx("chMix", "Chorus mix", 0, 1, 0.5, { unit: "%" }),
  fx("phMix", "Phaser mix", 0, 1, 0, { unit: "%" }),
  fx("phRate", "Phaser rate", 0.05, 8, 0.4, { unit: "Hz" }),
  fx("phDepth", "Phaser depth", 0, 1, 0.5, { unit: "%" }),
  fx("phFb", "Phaser feedback", 0, 0.9, 0.35, { unit: "%" }),
  fx("dlMix", "Delay mix", 0, 1, 0.18, { unit: "%" }),
  fx("dlDiv", "Delay time", 0, 5, 2, { options: DELAY_DIVS }),
  fx("dlFb", "Delay feedback", 0, 0.92, 0.38, { unit: "%" }),
  fx("dlTone", "Delay tone", 500, 16000, 5500, { unit: "Hz" }),
  fx("dlPing", "Delay mode", 0, 1, 1, { options: ["Stereo", "Ping-pong"] }),
  fx("rvMix", "Reverb mix", 0, 1, 0.22, { unit: "%" }),
  fx("rvSize", "Reverb size", 0, 2, 1, { options: REVERB_SIZES }),
  fx("rvDamp", "Reverb damping", 800, 16000, 7000, { unit: "Hz" }),
  fx("apRate", "Auto-pan rate", 0.05, 10, 0.6, { unit: "Hz" }),
  fx("apDepth", "Auto-pan depth", 0, 1, 0, { unit: "%" }),
  fx("width", "Stereo width", 0, 2, 1.15, { unit: "%" }),
  fx("outLvl", "Output", 0, 1.2, 0.85, { unit: "%" }),
];

const macro = (id: string, label: string): ParamDef => ({ id: `macro.${id}`, label, group: "Macros", min: 0, max: 1, def: id === "bright" ? 0.5 : 0, unit: "%" });
export const MACRO_PARAMS: readonly ParamDef[] = [macro("bright", "Bright"), macro("motion", "Movement"), macro("space", "Space"), macro("grit", "Grit")];

const seq = (id: string, label: string, min: number, max: number, d: number, extra: Partial<ParamDef> = {}): ParamDef => ({ id: `seq.${id}`, label, group: "Sequencer", min, max, def: d, ...extra });

export const SEQ_PARAMS: readonly ParamDef[] = [
  seq("mode", "Mode", 0, 2, 0, { options: SEQ_MODES }),
  seq("target", "Plays", 0, 2, 0, { options: SEQ_TARGETS }),
  seq("root", "Key", 0, 11, 6, { options: NOTE_NAMES }),
  seq("scale", "Scale", 0, SCALE_NAMES.length - 1, 4, { options: SCALE_NAMES }),
  seq("snap", "Snap to scale", 0, 1, 1, { options: ["Off", "On"] }),
  seq("octave", "Octave", 1, 5, 3, { step: 1 }),
  seq("dir", "Direction", 0, 4, 0, { options: DIRECTIONS }),
  seq("swing", "Swing", 0, 1, 0, { unit: "%" }),
  seq("rate", "Rate", 0, 5, 1, { options: SEQ_RATES }),
  seq("follow", "Keys transpose", 0, 1, 1, { options: ["Off", "On"] }),
  seq("evolve", "Evolve", 0, 1, 0, { options: ["Off", "On"] }),
  seq("chain", "Song chain", 0, 1, 0, { options: ["Off", "On"] }),
  seq("layer", "Layer on patch B", 0, BANK_COUNT, 0, { options: ["Off", ...Array.from({ length: BANK_COUNT }, (_, i) => String(i + 1))] }),
  seq("bars", "Bounce length", 0, 3, 1, { options: ["1 bar", "2 bars", "4 bars", "8 bars"] }),
  { id: "arp.mode", label: "Arp pattern", group: "Arp", min: 0, max: ARP_MODES.length - 1, def: 0, options: ARP_MODES.map((m) => m.label) },
  { id: "arp.oct", label: "Arp range", group: "Arp", min: 1, max: 4, step: 1, def: 2, unit: "oct" },
  { id: "arp.gate", label: "Arp gate", group: "Arp", min: 0.1, max: 1, def: 0.7, unit: "%" },
  { id: "arp.latch", label: "Latch", group: "Arp", min: 0, max: 1, def: 0, options: ["Off", "On"] },
  { id: "key.mode", label: "Keys play", group: "Performance", min: 0, max: 2, def: 0, options: KEY_MODES },
  { id: "key.split", label: "Split point", group: "Performance", min: 36, max: 84, step: 1, def: 60 },
  { id: "perf.voices", label: "Voice limit", group: "Performance", min: 4, max: 24, step: 1, def: 14 },
  { id: "perf.tune", label: "Master tune", group: "Performance", min: -100, max: 100, def: 0, unit: "ct" },
  { id: "perf.hold", label: "Hold", group: "Performance", min: 0, max: 1, def: 0, options: ["Off", "On"] },
];

export const GALACTIC_PARAMS: readonly ParamDef[] = [...patchParams("a"), ...patchParams("b"), ...FX_PARAMS, ...MACRO_PARAMS, ...SEQ_PARAMS];

/** Groups a factory preset leaves alone: sequencing and performance are the player's, not the sound's. */
export const GALACTIC_KEEP_GROUPS: ReadonlySet<string> = new Set(["Sequencer", "Arp", "Performance", "Macros"]);

type PresetRow = readonly [string, string, Record<string, number>, Record<string, number>];

const SOUND_ROWS: readonly PresetRow[] = [
  ["Galactic Massive", "Pad", {uni: 5, spread: 20, o2fine: 12, sub: 0.35, cut: 7200, res: 0.2, fenv: 0.35, fd: 0.5, fs: 0.5, ad: 0.4, as: 0.8, ar: 0.9, l1pitch: 0.06}, {chMode: 3, chMix: 0.55, dlMix: 0.2, rvMix: 0.3}],
  ["Jupiter Brass", "Lead", {uni: 1, spread: 6, o2fine: 7, sub: 0.2, hpf: 80, cut: 1500, res: 0.15, fenv: 0.72, fa: 0.1, fd: 0.45, fs: 0.55, aa: 0.045, ad: 0.25, as: 0.85, ar: 0.35, l1pitch: 0.05, drive: 0.08}, {chMode: 1, chMix: 0.6, dlMix: 0.08, rvMix: 0.14}],
  ["Jupiter Strings", "Pad", {uni: 4, spread: 13, o2fine: 9, sub: 0, cut: 3400, res: 0.1, fenv: 0.15, fa: 0.5, aa: 0.55, ad: 1, as: 0.9, ar: 1.3, l1pitch: 0.05, drive: 0}, {chMode: 3, chMix: 0.7, rvMix: 0.3, dlMix: 0.1}],
  ["Infinite Pad", "Pad", {uni: 6, spread: 28, o2wave: 3, o2fine: 14, sub: 0.1, cut: 3000, res: 0.12, fenv: 0.3, fa: 1.6, fd: 2, fs: 0.6, fr: 3, aa: 1.5, ad: 2, as: 0.9, ar: 4.5, m1src: 2, m1dst: 1, m1amt: 0.3, l2rate: 0.15, l2shape: 0}, {chMode: 3, chMix: 0.7, dlMix: 0.3, dlFb: 0.5, rvMix: 0.55, rvSize: 2}],
  ["Cosmic Bass", "Bass", {mode: 1, uni: 1, o2wave: 1, o2oct: 1, o2fine: -6, sub: 0.65, cut: 650, res: 0.3, fenv: 0.62, fd: 0.22, fs: 0.15, fr: 0.12, aa: 0.004, ad: 0.2, as: 0.85, ar: 0.12, drive: 0.35, glide: 0.03, l1pitch: 0, mwvib: 0.2}, {chMode: 0, dlMix: 0, rvMix: 0.05}],
  ["Supernova Lead", "Lead", {mode: 2, glide: 0.06, uni: 4, spread: 15, o2fine: 10, sub: 0.1, cut: 5200, res: 0.35, fenv: 0.3, fd: 0.5, fs: 0.6, aa: 0.006, as: 0.85, ar: 0.4, l1pitch: 0.12, l1delay: 0.35, drive: 0.15}, {chMode: 2, chMix: 0.4, dlMix: 0.32, dlFb: 0.45, rvMix: 0.22}],
  ["Poly Keys", "Pluck", {uni: 2, spread: 6, o1wave: 2, o1pw: 0.35, o2wave: 3, o2lvl: 0.5, sub: 0.1, cut: 3800, res: 0.1, fenv: 0.5, fd: 0.45, fs: 0.2, aa: 0.004, ad: 0.5, as: 0.55, ar: 0.4, l1pw: 0.2, l1rate: 0.4}, {chMode: 1, chMix: 0.4, dlMix: 0.12, rvMix: 0.14}],
  ["PWM Strings", "Pad", {uni: 3, spread: 9, o1wave: 2, o2wave: 2, o2pw: 0.4, o2fine: 6, sub: 0, cut: 3200, fenv: 0.1, fa: 0.4, aa: 0.35, ad: 0.9, as: 0.9, ar: 1, l1pw: 0.7, l1rate: 0.55, l1pitch: 0.03}, {chMode: 3, chMix: 0.65, rvMix: 0.3}],
  ["Acid Seq", "Bass", {mode: 1, glide: 0.05, uni: 1, o2lvl: 0, sub: 0.15, hpf: 30, cut: 420, res: 0.78, fenv: 0.88, fd: 0.2, fs: 0, fr: 0.1, aa: 0.002, ad: 0.18, as: 0.8, ar: 0.1, drive: 0.55, l1pitch: 0, mwvib: 0}, {chMode: 0, dlMix: 0.2, dlFb: 0.4, rvMix: 0.05}],
  ["Wobble Bass", "Bass", {mode: 1, uni: 1, o2wave: 1, o2oct: 1, sub: 0.55, cut: 420, res: 0.5, fenv: 0.1, fd: 0.2, fs: 0.8, aa: 0.004, as: 0.9, ar: 0.15, drive: 0.4, m1src: 2, m1dst: 1, m1amt: 0.85, l2shape: 1, l2rate: 2, l2sync: 4}, {chMode: 0, dlMix: 0.05}],
  ["FM Bell", "Pluck", {uni: 1, o1wave: 4, o2wave: 4, o2oct: 3, o2semi: 7, o2fine: 0, o2lvl: 0, sub: 0, xmod: 0.55, cut: 14000, res: 0, fenv: 0, fd: 1.2, fs: 0, aa: 0.002, ad: 1.6, as: 0, ar: 1.8, drive: 0, l1pitch: 0}, {chMode: 1, chMix: 0.3, dlMix: 0.25, rvMix: 0.4, rvSize: 1}],
  ["Ring Robot", "FX", {uni: 1, o2wave: 1, o2semi: 5, o2lvl: 0.2, ring: 0.85, sub: 0, cut: 3000, res: 0.35, fenv: 0.4, fd: 0.3, fs: 0.4, as: 0.7, ar: 0.3}, {chMode: 2, chMix: 0.3, dlMix: 0.2}],
  ["Space Organ", "Lead", {uni: 2, spread: 8, o1wave: 4, o2wave: 4, o2oct: 3, o2fine: 0, o2lvl: 0.5, sub: 0.4, subwave: 1, cut: 6000, fenv: 0, aa: 0.012, as: 1, ar: 0.15, l1pitch: 0.15, l1rate: 5.5, mwvib: 1}, {chMode: 2, chMix: 0.6, rvMix: 0.3}],
  ["Synthwave Lead", "Lead", {mode: 2, glide: 0.035, uni: 3, spread: 18, o2fine: 11, sub: 0.2, cut: 3800, res: 0.25, fenv: 0.4, fd: 0.4, fs: 0.55, aa: 0.008, as: 0.85, ar: 0.5, l1pitch: 0.1, l1delay: 0.4}, {chMode: 3, chMix: 0.5, dlMix: 0.35, dlDiv: 1, dlFb: 0.4, rvMix: 0.3}],
  ["Glass Keys", "Pluck", {uni: 1, o1wave: 3, o2wave: 4, o2oct: 3, o2lvl: 0.4, xmod: 0.15, sub: 0, cut: 9000, res: 0.05, fenv: 0.2, fd: 0.5, fs: 0, aa: 0.003, ad: 0.9, as: 0, ar: 0.9}, {chMode: 1, chMix: 0.4, dlMix: 0.2, rvMix: 0.4}],
  ["Dark Atmos", "FX", {uni: 7, spread: 40, o2wave: 3, o2fine: 20, noise: 0.22, ncolor: 1, sub: 0.3, cut: 900, res: 0.4, fenv: 0.35, fa: 2.5, fd: 3, fs: 0.5, fr: 5, aa: 2.5, ad: 3, as: 0.9, ar: 6, m1src: 2, m1dst: 1, m1amt: 0.5, l2rate: 0.09, l2shape: 0, m2src: 2, m2dst: 5, m2amt: 0.6}, {chMode: 3, chMix: 0.6, dlMix: 0.3, dlFb: 0.55, rvMix: 0.7, rvSize: 2}],
  ["Trance Gate Pad", "Pad", {uni: 5, spread: 22, o2fine: 13, cut: 4600, res: 0.15, fenv: 0.2, fa: 0.1, aa: 0.05, ad: 0.4, as: 1, ar: 0.5}, {chMode: 3, chMix: 0.5, gRate: 3, gDepth: 0.9, dlMix: 0.25, rvMix: 0.3}],
  ["Choir Air", "Pad", {uni: 3, spread: 10, o1wave: 2, o1pw: 0.3, o2wave: 3, noise: 0.07, ncolor: 1, sub: 0, hpf: 180, cut: 2400, res: 0.4, fenv: 0.1, fa: 0.6, aa: 0.7, as: 0.9, ar: 1.4, l1pitch: 0.08, l1rate: 5}, {chMode: 2, chMix: 0.6, rvMix: 0.5, rvSize: 2}],
  ["Vintage Solo", "Lead", {mode: 2, glide: 0.08, uni: 1, o2wave: 1, o2fine: 6, sub: 0.2, cut: 2600, res: 0.3, fenv: 0.5, fd: 0.35, fs: 0.6, aa: 0.01, as: 0.85, ar: 0.3, l1pitch: 0.15, l1delay: 0.6, l1rate: 5.2, drive: 0.2}, {chMode: 1, chMix: 0.4, dlMix: 0.2, rvMix: 0.2}],
  ["Noise Riser", "FX", {uni: 1, o1lvl: 0.1, o2lvl: 0, sub: 0, noise: 1, ncolor: 0, hpf: 200, cut: 300, res: 0.5, fenv: 1, fa: 4, fd: 2, fs: 1, aa: 2.5, as: 1, ar: 1.5}, {chMode: 0, dlMix: 0.2, rvMix: 0.4, apDepth: 0.4}],
  ["Hoover Lead", "Lead", {mode: 2, glide: 0.12, uni: 7, spread: 45, o1wave: 2, o1pw: 0.5, o2wave: 0, o2fine: -7, sub: 0.3, cut: 3200, res: 0.25, fenv: 0.25, aa: 0.008, as: 0.9, ar: 0.4, penv: -3, fa: 0.001, fd: 0.25, l1pw: 0.5, l1rate: 0.4, drive: 0.35}, {chMode: 3, chMix: 0.5, dlMix: 0.2, rvMix: 0.2}],
  ["Arp Pluck", "Pluck", {uni: 2, spread: 8, sub: 0.2, cut: 1800, res: 0.25, fenv: 0.8, fd: 0.16, fs: 0, fr: 0.15, aa: 0.002, ad: 0.22, as: 0, ar: 0.2}, {chMode: 1, chMix: 0.4, dlMix: 0.32, dlDiv: 1, dlFb: 0.42, rvMix: 0.2}],
  ["Cloud Chords", "Pad", {uni: 5, spread: 20, o1wave: 3, o2wave: 3, o2fine: 12, sub: 0.15, cut: 3600, res: 0.1, fenv: 0.2, fa: 0.5, aa: 0.8, ad: 1, as: 0.9, ar: 2.4}, {chMode: 3, chMix: 0.6, phMix: 0.45, phRate: 0.25, rvMix: 0.5, rvSize: 2, dlMix: 0.2}],
  ["Metal Drone", "FX", {uni: 3, spread: 30, o2wave: 1, o2semi: 6, ring: 0.6, xmod: 0.35, sub: 0.4, cut: 2200, res: 0.55, fenv: 0.3, aa: 0.6, as: 1, ar: 3, m1src: 2, m1dst: 6, m1amt: 0.1, l2rate: 0.2}, {chMode: 2, chMix: 0.4, rvMix: 0.5, rvSize: 2, fxDrive: 0.2}],
  ["Sunrise Arp", "Pluck", {uni: 3, spread: 12, o1wave: 2, o1pw: 0.4, o2wave: 0, sub: 0.15, cut: 2600, res: 0.3, fenv: 0.7, fd: 0.2, fs: 0.1, aa: 0.002, ad: 0.25, as: 0.1, ar: 0.4, l1pw: 0.4}, {chMode: 3, chMix: 0.5, dlMix: 0.35, dlDiv: 2, dlFb: 0.45, rvMix: 0.3}],
  ["Velvet Bass", "Bass", {mode: 1, uni: 1, o1wave: 3, o2wave: 0, o2oct: 1, o2lvl: 0.5, sub: 0.5, subwave: 1, cut: 520, res: 0.12, fenv: 0.4, fd: 0.3, fs: 0.4, aa: 0.006, as: 0.9, ar: 0.2, drive: 0.2, glide: 0.025}, {chMode: 1, chMix: 0.25, dlMix: 0, rvMix: 0.05}],
  ["Laser Harp", "Pluck", {uni: 2, spread: 10, o1wave: 4, o2wave: 3, o2oct: 3, o2lvl: 0.5, xmod: 0.25, sub: 0, cut: 9000, res: 0.15, fenv: 0.3, fd: 0.4, fs: 0, aa: 0.002, ad: 0.8, as: 0, ar: 0.8, penv: 7, fa: 0.001}, {chMode: 2, chMix: 0.4, dlMix: 0.4, dlDiv: 1, dlFb: 0.5, rvMix: 0.4}],
  ["Cathedral Choir", "Pad", {uni: 5, spread: 16, o1wave: 2, o1pw: 0.3, o2wave: 4, o2oct: 3, o2lvl: 0.4, noise: 0.05, ncolor: 1, sub: 0.1, hpf: 120, cut: 2000, res: 0.35, fenv: 0.2, fa: 0.8, aa: 0.9, as: 0.9, ar: 3, l1pitch: 0.07}, {chMode: 3, chMix: 0.6, rvMix: 0.7, rvSize: 2, dlMix: 0.15}],
  ["Chrome Stab", "Pluck", {uni: 4, spread: 14, o2fine: 12, sub: 0.2, cut: 900, res: 0.3, fenv: 0.9, fa: 0.001, fd: 0.28, fs: 0.05, fr: 0.2, aa: 0.002, ad: 0.3, as: 0.2, ar: 0.25, drive: 0.3}, {chMode: 3, chMix: 0.5, dlMix: 0.2, rvMix: 0.2}],
  ["Lofi Keys", "Pluck", {uni: 2, spread: 18, o1wave: 3, o2wave: 4, o2oct: 3, o2lvl: 0.3, sub: 0.1, cut: 2400, res: 0.1, fenv: 0.2, fd: 0.6, fs: 0.3, aa: 0.004, as: 0.5, ar: 0.5, drift: 0.9, l1pitch: 0.12, l1rate: 0.7, l1delay: 0}, {chMode: 2, chMix: 0.5, fxCrush: 0.25, rvMix: 0.2, dlMix: 0.15}],
  ["Warp Pad", "FX", {uni: 6, spread: 30, o2wave: 3, o2fine: 16, xmod: 0.12, sub: 0.1, cut: 2400, res: 0.3, fenv: 0.4, fa: 1.2, aa: 1.2, ad: 2, as: 0.9, ar: 3.5, m1src: 2, m1dst: 3, m1amt: 0.6, l2rate: 0.2, m2src: 1, m2dst: 5, m2amt: 0.5, l1rate: 0.3, l1pitch: 0.1}, {chMode: 3, chMix: 0.6, phMix: 0.5, rvMix: 0.5, rvSize: 2, dlMix: 0.25}],
  ["Sub Drop", "Bass", {mode: 1, uni: 1, o1wave: 4, o2lvl: 0, sub: 0.9, cut: 300, res: 0, fenv: 0, aa: 0.004, ad: 0.6, as: 0.8, ar: 0.3, penv: -12, fa: 0.001, fd: 0.18, fs: 0}, {chMode: 0, dlMix: 0, rvMix: 0}],
  ["Pixel Lead", "Lead", {mode: 2, glide: 0.02, uni: 1, o1wave: 1, o2wave: 1, o2oct: 3, o2semi: 7, o2lvl: 0.4, sub: 0, cut: 6000, res: 0.1, fenv: 0.2, aa: 0.003, as: 0.9, ar: 0.15, l1pitch: 0.1, l1rate: 6, l1delay: 0.2}, {chMode: 0, dlMix: 0.25, dlDiv: 1, dlFb: 0.4, rvMix: 0.12, fxCrush: 0.3}],
  ["Aurora", "Pad", {uni: 7, spread: 36, o1wave: 0, o2wave: 2, o2fine: 15, sub: 0.2, noise: 0.06, ncolor: 1, cut: 3600, res: 0.2, fenv: 0.35, fa: 2, aa: 1.8, ad: 2, as: 0.9, ar: 5, m1src: 2, m1dst: 1, m1amt: 0.4, l2rate: 0.11, m2src: 2, m2dst: 5, m2amt: 0.7}, {chMode: 3, chMix: 0.7, phMix: 0.3, dlMix: 0.35, dlFb: 0.55, rvMix: 0.6, rvSize: 2, apDepth: 0.3}],
  ["Saw Stack", "Lead", {uni: 7, spread: 26, o2fine: 14, sub: 0.15, cut: 4800, res: 0.3, fenv: 0.4, fd: 0.5, fs: 0.6, aa: 0.006, as: 0.9, ar: 0.35, l1pitch: 0.07, drive: 0.2}, {chMode: 3, chMix: 0.4, dlMix: 0.25, dlDiv: 1, rvMix: 0.25}],
  ["Deep Space", "FX", {uni: 5, spread: 34, o1wave: 3, o2wave: 4, o2oct: 1, o2fine: 5, noise: 0.1, ncolor: 1, sub: 0.2, hpf: 60, cut: 1600, res: 0.45, fenv: 0.5, fa: 1.5, fd: 3, fs: 0.4, aa: 1.8, as: 0.9, ar: 5, m1src: 2, m1dst: 1, m1amt: 0.5, l2rate: 0.07, m2src: 2, m2dst: 6, m2amt: 0.06}, {chMode: 3, chMix: 0.6, phMix: 0.4, phRate: 0.15, dlMix: 0.4, dlDiv: 0, dlFb: 0.6, rvMix: 0.7, rvSize: 2}],
];

/** Performances load patch A and B together; the third entry is the key mode (1 split, 2 dual). */
const PERFORMANCES: readonly (readonly [string, number, string, string])[] = [
  ["Brass + Strings", 2, "Jupiter Brass", "Jupiter Strings"],
  ["Lead / Bass", 1, "Supernova Lead", "Cosmic Bass"],
  ["Pad + Pluck", 2, "Infinite Pad", "Arp Pluck"],
  ["Keys / Pad", 1, "Poly Keys", "Cloud Chords"],
  ["Massive + Bell", 2, "Galactic Massive", "FM Bell"],
  ["Choir + Chrome", 2, "Cathedral Choir", "Chrome Stab"],
  ["Pixel Lead / Velvet Bass", 1, "Pixel Lead", "Velvet Bass"],
];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function soundValues(row: PresetRow, patch: "a" | "b", includeFx: boolean): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(row[2])) values[`${patch}.${k}`] = v;
  if (includeFx) for (const [k, v] of Object.entries(row[3])) values[`fx.${k}`] = v;
  return values;
}

export function buildGalacticPresets(): Preset[] {
  const byName = new Map(SOUND_ROWS.map((r) => [r[0], r]));
  const factory: Preset[] = SOUND_ROWS.map((row) => ({ id: `go-${slug(row[0])}`, name: row[0], category: row[1], factory: true, values: soundValues(row, "a", true), data: { names: [row[0]] } }));
  const performances: Preset[] = PERFORMANCES.map(([name, mode, a, b]) => {
    const rowA = byName.get(a);
    const rowB = byName.get(b);
    if (!rowA || !rowB) throw new RangeError(`Performance "${name}" names a missing patch`);
    return {
      id: `go-perf-${slug(name)}`,
      name,
      category: "Performance",
      factory: true,
      values: { ...soundValues(rowB, "b", false), ...soundValues(rowA, "a", true), "key.mode": mode },
      data: { names: [a, b] },
    };
  });
  return [...factory, ...performances];
}

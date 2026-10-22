import type { ParamDef, Preset } from "../../types";
import { CARRIERS } from "./vocoder";
import { DELAY_DIVISIONS } from "./fx";
import { BAND_COUNTS } from "./vocoder";
import { PIANO_TIMBRES } from "./piano";

type Extra = Pick<ParamDef, "step" | "unit" | "options">;
const p = (id: string, label: string, group: string, min: number, max: number, def: number, extra: Extra = {}): ParamDef => ({ id, label, group, min, max, def, ...extra });
const toggle = (id: string, label: string, group: string, def: number): ParamDef => p(id, label, group, 0, 1, def, { step: 1, options: ["Off", "On"] });

export const VOX_GROUPS = ["Input", "Gate", "Compressor", "Auto-tune", "Harmoniser", "Vocoder", "Effects", "Tone and space", "Choir", "Keys", "Pads"] as const;
export type VoxGroup = (typeof VOX_GROUPS)[number];

export const VOX_PARAMS: readonly ParamDef[] = [
  p("level", "Output level", "Input", 0, 1.2, 0.85, { step: 0.01 }),
  p("source", "Input", "Input", 0, 1, 0, { step: 1, options: ["Mic", "File"] }),
  p("inGain", "Input gain", "Input", 0, 3, 1, { step: 0.01 }),
  toggle("monitor", "Monitor", "Input", 1),
  p("voiceLevel", "Voice level", "Input", 0, 1.2, 0.9, { step: 0.01 }),

  toggle("gateOn", "Gate", "Gate", 1),
  p("gateThresh", "Threshold", "Gate", -70, -20, -46, { step: 1, unit: "dB" }),
  p("gateRelease", "Release", "Gate", 20, 500, 120, { step: 5, unit: "ms" }),

  toggle("compOn", "Compressor", "Compressor", 1),
  p("compRatio", "Amount", "Compressor", 1.5, 12, 3, { step: 0.1, unit: ": 1" }),
  p("compThresh", "Threshold", "Compressor", -40, 0, -18, { step: 1, unit: "dB" }),
  p("compMakeup", "Make-up gain", "Compressor", 0, 12, 3, { step: 0.5, unit: "dB" }),

  toggle("tuneOn", "Auto-tune", "Auto-tune", 0),
  p("tuneSpeed", "Speed", "Auto-tune", 0, 1, 0.72, { step: 0.01 }),
  p("tuneAmount", "Amount", "Auto-tune", 0, 1, 0.85, { step: 0.01 }),
  p("tuneHumanise", "Humanise", "Auto-tune", 0, 1, 0.12, { step: 0.01 }),
  p("pitch", "Pitch", "Auto-tune", -12, 12, 0, { step: 1, unit: "st" }),
  p("formant", "Formant", "Auto-tune", -12, 12, 0, { step: 1, unit: "st" }),

  toggle("harmOn", "Harmoniser", "Harmoniser", 0),
  p("harmMode", "Mode", "Harmoniser", 0, 1, 0, { step: 1, options: ["Interval", "Scale"] }),
  p("harmI1", "Voice 1", "Harmoniser", -12, 12, 4, { step: 1, unit: "st" }),
  p("harmI2", "Voice 2", "Harmoniser", -12, 12, 7, { step: 1, unit: "st" }),
  p("harmI3", "Voice 3", "Harmoniser", -12, 12, -12, { step: 1, unit: "st" }),
  p("harmL1", "Level 1", "Harmoniser", 0, 1, 0.6, { step: 0.01 }),
  p("harmL2", "Level 2", "Harmoniser", 0, 1, 0.6, { step: 0.01 }),
  p("harmL3", "Level 3", "Harmoniser", 0, 1, 0.6, { step: 0.01 }),
  p("harmP1", "Pan 1", "Harmoniser", -1, 1, -0.6, { step: 0.01 }),
  p("harmP2", "Pan 2", "Harmoniser", -1, 1, 0.6, { step: 0.01 }),
  p("harmP3", "Pan 3", "Harmoniser", -1, 1, 0, { step: 0.01 }),
  p("harmMix", "Mix", "Harmoniser", 0, 1, 0.4, { step: 0.01 }),

  toggle("vocOn", "Vocoder", "Vocoder", 0),
  p("vocBands", "Bands", "Vocoder", 0, 3, 2, { step: 1, options: BAND_COUNTS.map(String) }),
  p("vocCarrier", "Carrier", "Vocoder", 0, 4, 0, { step: 1, options: CARRIERS }),
  p("vocQ", "Band Q", "Vocoder", 2, 30, 9, { step: 0.5 }),
  p("vocShift", "Formant shift", "Vocoder", -12, 12, 0, { step: 1, unit: "st" }),
  p("vocResponse", "Response", "Vocoder", 15, 150, 55, { step: 1, unit: "Hz" }),
  p("vocSib", "Sibilance", "Vocoder", 0, 1, 0.45, { step: 0.01 }),
  p("vocMix", "Mix", "Vocoder", 0, 2, 0.9, { step: 0.01 }),

  toggle("fxOn", "Effects", "Effects", 1),
  p("delayMix", "Delay", "Effects", 0, 1, 0.15, { step: 0.01 }),
  p("reverbMix", "Reverb", "Effects", 0, 1, 0.22, { step: 0.01 }),
  p("spaceMix", "Space mod", "Effects", 0, 1, 0.3, { step: 0.01 }),

  p("delayDiv", "Delay time", "Tone and space", 0, 5, 1, { step: 1, options: DELAY_DIVISIONS }),
  p("delayFb", "Delay feedback", "Tone and space", 0, 0.9, 0.35, { step: 0.01 }),
  p("reverbSize", "Room", "Tone and space", 0, 2, 0, { step: 1, options: ["Room", "Hall", "Chamber"] }),
  p("reverbDamp", "Damping", "Tone and space", 800, 16000, 7000, { step: 100, unit: "Hz" }),
  p("spaceSize", "Space size", "Tone and space", 0, 2, 0, { step: 1, options: ["Nebula", "Cathedral", "Void"] }),
  p("spacePre", "Pre-delay", "Tone and space", 0, 0.25, 0.04, { step: 0.005, unit: "s" }),
  p("shimmer", "Shimmer", "Tone and space", 0, 1, 0, { step: 0.01 }),
  p("gravity", "Gravity", "Tone and space", 0, 1, 0, { step: 0.01 }),
  p("nebula", "Nebula mod", "Tone and space", 0, 1, 0.3, { step: 0.01 }),
  p("nebulaRate", "Nebula rate", "Tone and space", 0.05, 2, 0.2, { step: 0.05, unit: "Hz" }),
  p("orbit", "Orbit pan", "Tone and space", 0, 1, 0, { step: 0.01 }),
  p("orbitRate", "Orbit rate", "Tone and space", 0.05, 4, 0.25, { step: 0.05, unit: "Hz" }),
  p("radiation", "Radiation", "Tone and space", 0, 1, 0, { step: 0.01 }),
  p("radRate", "Radiation rate", "Tone and space", 0.5, 40, 6, { step: 0.5, unit: "Hz" }),
  p("comet", "Comet filter", "Tone and space", 0, 1, 0, { step: 0.01 }),
  p("cometRate", "Comet rate", "Tone and space", 0.05, 4, 0.3, { step: 0.05, unit: "Hz" }),
  p("drive", "Drive", "Tone and space", 0, 1, 0, { step: 0.01 }),
  p("low", "Low shelf", "Tone and space", -12, 12, 0, { step: 1, unit: "dB" }),
  p("high", "Air", "Tone and space", -12, 12, 2, { step: 1, unit: "dB" }),
  p("chorus", "Chorus", "Tone and space", 0, 1, 0.2, { step: 0.01 }),

  p("choirLyrics", "Words", "Choir", 0, 1, 1, { step: 1, options: ["Vowel slider", "Lyrics"] }),
  toggle("voiceSoprano", "Soprano", "Choir", 1),
  toggle("voiceAlto", "Alto", "Choir", 1),
  toggle("voiceTenor", "Tenor", "Choir", 0),
  toggle("voiceBass", "Bass", "Choir", 1),
  p("choirVowel", "Vowel", "Choir", 0, 1, 0, { step: 0.01 }),
  p("choirVibrato", "Vibrato", "Choir", 0, 1, 0.35, { step: 0.01 }),
  p("choirVibRate", "Vibrato rate", "Choir", 2, 8, 5.2, { step: 0.1, unit: "Hz" }),
  p("choirBreath", "Breath", "Choir", 0, 1, 0.12, { step: 0.01 }),
  p("choirSpread", "Spread", "Choir", 0, 40, 12, { step: 1, unit: "cents" }),
  p("choirVoices", "Voices per note", "Choir", 1, 4, 2, { step: 1 }),
  p("choirAttack", "Attack", "Choir", 0.005, 2, 0.12, { step: 0.005, unit: "s" }),
  p("choirRelease", "Release", "Choir", 0.05, 4, 0.9, { step: 0.05, unit: "s" }),
  p("choirLevel", "Choir level", "Choir", 0, 1.5, 0.8, { step: 0.01 }),

  p("keysTarget", "Keys play", "Keys", 0, 4, 0, { step: 1, options: ["Piano", "Sampler", "Choir", "Synth", "All"] }),
  p("pianoTimbre", "Piano", "Keys", 0, 2, 0, { step: 1, options: PIANO_TIMBRES }),
  p("pianoBright", "Brightness", "Keys", 0, 1, 0.6, { step: 0.01 }),
  p("pianoRelease", "Piano release", "Keys", 0.05, 3, 0.35, { step: 0.05, unit: "s" }),
  p("pianoHammer", "Hammer", "Keys", 0, 1, 0.45, { step: 0.01 }),
  p("pianoLevel", "Piano level", "Keys", 0, 1.5, 0.85, { step: 0.01 }),
  p("sampAttack", "Sample attack", "Keys", 0.001, 2, 0.005, { step: 0.001, unit: "s" }),
  p("sampRelease", "Sample release", "Keys", 0.05, 4, 0.4, { step: 0.05, unit: "s" }),
  toggle("sampLoop", "Sample loop", "Keys", 0),

  p("padLevel", "Pad level", "Pads", 0, 1.5, 1, { step: 0.01 }),
];

type Values = Record<string, number>;

const TYPE_DEFAULTS: Values = {
  pitch: 0, formant: 0, tuneOn: 0, tuneSpeed: 0.72, harmMode: 0, harmOn: 0,
  harmI1: 4, harmI2: 7, harmI3: -12, harmL1: 0.6, harmL2: 0.6, harmL3: 0.6, harmP1: -0.6, harmP2: 0.6, harmP3: 0,
  vocOn: 0, vocCarrier: 0, vocBands: 2, vocQ: 9, vocSib: 0.45, vocMix: 0.9, voiceLevel: 0.9,
  drive: 0, low: 0, high: 2, chorus: 0.2, delayMix: 0.15, delayDiv: 1, spaceMix: 0.3, spaceSize: 0,
  shimmer: 0, gravity: 0, nebula: 0.3, orbit: 0, radiation: 0, radRate: 6, comet: 0,
};

/** A vocal type changes only the processing keys, never the input or the keys, so switching types mid-take is safe. */
function vocal(name: string, category: string, overrides: Values): Preset {
  const values = { ...TYPE_DEFAULTS, ...overrides };
  if (values.harmL1 !== TYPE_DEFAULTS.harmL1 || values.harmI1 !== TYPE_DEFAULTS.harmI1) values.harmOn = overrides.harmOn ?? 1;
  return { id: `vox-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, category, factory: true, values };
}

/** The 19 vocal types of the old studio, expressed in this engine's parameters. */
export const VOX_PRESETS: readonly Preset[] = [
  vocal("Natural", "Natural", {}),
  vocal("Male to female", "Pitch", { pitch: 5, formant: 5 }),
  vocal("Female to male", "Pitch", { pitch: -5, formant: -5 }),
  vocal("Child", "Pitch", { pitch: 9, formant: 8 }),
  vocal("Giant", "Character", { pitch: -12, formant: -7, drive: 0.3, gravity: 0.3, spaceMix: 0.35 }),
  vocal("Demon", "Character", { pitch: -12, formant: -9, drive: 0.65, harmI1: -7, harmL1: 0.5, harmL2: 0, harmL3: 0, gravity: 0.5, spaceMix: 0.45, radiation: 0.3 }),
  vocal("Robot", "Vocoder", { vocOn: 1, vocCarrier: 0, vocBands: 2, vocQ: 12, voiceLevel: 0.15, vocMix: 1 }),
  vocal("Alien", "Character", { pitch: 3, formant: 9, radiation: 0.5, radRate: 14, chorus: 0.4, spaceMix: 0.4, orbit: 0.5 }),
  vocal("Whisper", "Vocoder", { vocOn: 1, vocCarrier: 2, vocSib: 0.8, voiceLevel: 0, vocMix: 1.3, spaceMix: 0.3 }),
  vocal("Choir of me", "Harmony", { harmMode: 1, harmI1: 2, harmI2: 4, harmI3: -7, harmL1: 0.55, harmL2: 0.5, harmL3: 0.5, harmP1: -0.7, harmP2: 0.7, harmP3: 0, tuneOn: 1, tuneSpeed: 0.7, spaceMix: 0.4 }),
  vocal("Angel", "Harmony", { harmMode: 0, harmI1: 12, harmI2: 7, harmI3: 4, harmL1: 0.4, harmL2: 0.35, harmL3: 0.3, shimmer: 0.55, spaceMix: 0.5, spaceSize: 1, high: 5 }),
  vocal("Telephone", "Lo-fi", { low: -12, high: -12, drive: 0.3, spaceMix: 0, reverbMix: 0.05 }),
  vocal("Megaphone", "Lo-fi", { low: -10, high: -6, drive: 0.6, spaceMix: 0, delayMix: 0.2 }),
  vocal("Trap autotune", "Tuned", { tuneOn: 1, tuneSpeed: 0.97, harmI1: 12, harmL1: 0.25, harmL2: 0, harmL3: 0, delayMix: 0.25, delayDiv: 1, drive: 0.1 }),
  vocal("Hyperpop", "Tuned", { pitch: 6, formant: 6, tuneOn: 1, tuneSpeed: 0.95, drive: 0.4, chorus: 0.5, harmI1: 7, harmL1: 0.3, harmI2: -12, harmL2: 0.3, harmL3: 0, spaceMix: 0.3 }),
  vocal("Dark prayer", "Space", { pitch: -4, formant: -3, harmMode: 1, harmI1: -5, harmI2: -12, harmI3: 7, harmL1: 0.4, harmL2: 0.4, harmL3: 0.3, spaceMix: 0.6, spaceSize: 2, gravity: 0.35, nebula: 0.6 }),
  vocal("Stadium double", "Harmony", { harmI1: 0, harmL1: 0.5, harmL2: 0, harmL3: 0, delayMix: 0.3, delayDiv: 1, spaceMix: 0.35, chorus: 0.4 }),
  vocal("Glitch vox", "Vocoder", { vocOn: 1, vocCarrier: 1, vocBands: 0, vocQ: 20, radiation: 0.7, radRate: 12, drive: 0.4, voiceLevel: 0.3 }),
  vocal("Vocoder choir", "Vocoder", { vocOn: 1, vocCarrier: 4, vocBands: 3, vocQ: 10, voiceLevel: 0, vocMix: 1.1, spaceMix: 0.45, shimmer: 0.3 }),
];

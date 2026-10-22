import type { InsertType } from "../project/model";
import type { ParamDef } from "./types";

/** One insert effect: audio goes in at `input`, comes out at `output`. */
export interface Effect {
  readonly input: AudioNode;
  readonly output: AudioNode;
  set(param: string, value: number): void;
  dispose(): void;
}

export type EffectBuilder = (ctx: BaseAudioContext, params: Record<string, number>) => Effect;

export interface EffectDef {
  type: InsertType;
  label: string;
  params: readonly ParamDef[];
}

export class EffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EffectError";
  }
}

const p = (id: string, label: string, min: number, max: number, def: number, unit?: string, step?: number, options?: readonly string[]): ParamDef => ({
  id,
  label,
  group: "Effect",
  min,
  max,
  def,
  unit,
  step,
  options,
});

export const EFFECT_DEFS: Readonly<Record<InsertType, EffectDef>> = {
  compressor: {
    type: "compressor",
    label: "Compressor",
    params: [
      p("threshold", "Threshold", -60, 0, -18, "dB", 0.5),
      p("ratio", "Ratio", 1, 20, 4, ":1", 0.1),
      p("attack", "Attack", 1, 100, 10, "ms", 1),
      p("release", "Release", 20, 1000, 160, "ms", 5),
      p("knee", "Knee", 0, 40, 6, "dB", 1),
      p("makeup", "Makeup", 0, 24, 0, "dB", 0.5),
    ],
  },
  eq: {
    type: "eq",
    label: "EQ",
    params: [
      p("low", "Low", -15, 15, 0, "dB", 0.5),
      p("mid", "Mid", -15, 15, 0, "dB", 0.5),
      p("midFreq", "Mid frequency", 200, 5000, 1000, "Hz", 10),
      p("high", "High", -15, 15, 0, "dB", 0.5),
    ],
  },
  saturator: {
    type: "saturator",
    label: "Saturator",
    params: [p("drive", "Drive", 0, 24, 6, "dB", 0.5), p("tone", "Tone", 1000, 20000, 12000, "Hz", 100), p("mix", "Mix", 0, 1, 1, undefined, 0.01)],
  },
  filter: {
    type: "filter",
    label: "Filter",
    params: [
      p("mode", "Mode", 0, 2, 0, undefined, 1, ["Low-pass", "High-pass", "Band-pass"]),
      p("cutoff", "Cutoff", 20, 20000, 8000, "Hz", 10),
      p("resonance", "Resonance", 0.1, 18, 0.7, undefined, 0.1),
    ],
  },
  chorus: {
    type: "chorus",
    label: "Chorus",
    params: [p("rate", "Rate", 0.05, 8, 0.8, "Hz", 0.05), p("depth", "Depth", 0, 1, 0.5, undefined, 0.01), p("mix", "Mix", 0, 1, 0.5, undefined, 0.01)],
  },
  delay: {
    type: "delay",
    label: "Delay",
    params: [
      p("time", "Time", 10, 2000, 375, "ms", 1),
      p("feedback", "Feedback", 0, 0.9, 0.35, undefined, 0.01),
      p("tone", "Tone", 500, 16000, 6000, "Hz", 100),
      p("mix", "Mix", 0, 1, 0.3, undefined, 0.01),
    ],
  },
  reverb: {
    type: "reverb",
    label: "Reverb",
    params: [
      p("decay", "Decay", 0.3, 8, 2.2, "s", 0.1),
      p("damping", "Damping", 500, 16000, 6000, "Hz", 100),
      p("preDelay", "Pre-delay", 0, 100, 15, "ms", 1),
      p("mix", "Mix", 0, 1, 0.3, undefined, 0.01),
    ],
  },
  gate: {
    type: "gate",
    label: "Gate",
    params: [p("threshold", "Threshold", -80, -10, -45, "dB", 1), p("release", "Release", 10, 1000, 120, "ms", 5), p("reduction", "Reduction", 0, 80, 60, "dB", 1)],
  },
  deesser: {
    type: "deesser",
    label: "De-esser",
    params: [p("frequency", "Frequency", 3000, 10000, 6500, "Hz", 100), p("threshold", "Threshold", -60, 0, -24, "dB", 1), p("amount", "Amount", 1, 20, 6, ":1", 0.5)],
  },
};

export const INSERT_TYPES: readonly InsertType[] = Object.keys(EFFECT_DEFS) as InsertType[];

export function defaultParams(type: InsertType): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of EFFECT_DEFS[type].params) out[def.id] = def.def;
  return out;
}

/** Saved params may be missing or out of range (older projects, hand-edited files), so every builder starts from a sanitised copy. */
export function resolveParams(type: InsertType, params: Readonly<Record<string, number>>): Record<string, number> {
  const out = defaultParams(type);
  for (const def of EFFECT_DEFS[type].params) {
    const v = params[def.id];
    if (typeof v === "number" && Number.isFinite(v)) out[def.id] = clampParam(def, v);
  }
  return out;
}

export function clampParam(def: ParamDef, value: number): number {
  const v = Math.min(def.max, Math.max(def.min, value));
  return def.options ? Math.round(v) : v;
}

const lin = (db: number): number => 10 ** (db / 20);
const toDb = (x: number): number => 20 * Math.log10(x);

/**
 * Moves a parameter without a click once audio is running; at time zero it sets the value outright so
 * offline renders start at the right value. `at` is an audio-clock time for changes scheduled ahead.
 */
export function smooth(ctx: BaseAudioContext, param: AudioParam, value: number, at: number = ctx.currentTime): void {
  if (at <= 0) param.value = value;
  else param.setTargetAtTime(value, at, 0.015);
}

/**
 * Browsers add an automatic makeup gain to DynamicsCompressorNode that boosts quiet material.
 * This is the same calculation, so an insert can cancel it and only apply the makeup the user asks for.
 */
export function compressorAutoMakeup(thresholdDb: number, kneeDb: number, ratio: number): number {
  const linThreshold = lin(thresholdDb);
  const kneeCurve = (x: number, k: number): number => (x < linThreshold ? x : linThreshold + (1 - Math.exp(-k * (x - linThreshold))) / k);
  const slopeAt = (x: number, k: number): number => {
    if (x < linThreshold) return 1;
    const x2 = x * 1.001;
    return (toDb(kneeCurve(x2, k)) - toDb(kneeCurve(x, k))) / (toDb(x2) - toDb(x));
  };
  const slope = 1 / ratio;
  const kneeStartDb = thresholdDb + kneeDb;
  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(lin(kneeStartDb), k) < slope) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const kneeThreshold = lin(kneeStartDb);
  const yKneeDb = toDb(kneeCurve(kneeThreshold, k));
  const fullRange = 1 < kneeThreshold ? kneeCurve(1, k) : lin(yKneeDb + slope * (0 - kneeStartDb));
  return (1 / fullRange) ** 0.6;
}

function curve(points: number, fn: (x: number) => number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) out[i] = fn(-1 + (2 * i) / (points - 1));
  return out;
}

function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) n.disconnect();
}

function checked(type: InsertType, param: string): ParamDef {
  const def = EFFECT_DEFS[type].params.find((d) => d.id === param);
  if (!def) throw new EffectError(`${EFFECT_DEFS[type].label} has no parameter "${param}".`);
  return def;
}

function buildCompressor(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const v = { ...init };
  const input = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const output = ctx.createGain();
  input.connect(comp).connect(output);
  const apply = (): void => {
    comp.threshold.value = v.threshold;
    comp.ratio.value = v.ratio;
    comp.knee.value = v.knee;
    comp.attack.value = v.attack / 1000;
    comp.release.value = v.release / 1000;
    output.gain.value = lin(v.makeup) / compressorAutoMakeup(v.threshold, v.knee, v.ratio);
  };
  apply();
  return {
    input,
    output,
    set(param, value) {
      v[param] = clampParam(checked("compressor", param), value);
      apply();
    },
    dispose: () => disconnectAll([input, comp, output]),
  };
}

function buildEq(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const low = ctx.createBiquadFilter();
  const mid = ctx.createBiquadFilter();
  const high = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 120;
  mid.type = "peaking";
  mid.Q.value = 1;
  high.type = "highshelf";
  high.frequency.value = 6000;
  low.connect(mid).connect(high);
  const targets: Record<string, AudioParam> = { low: low.gain, mid: mid.gain, midFreq: mid.frequency, high: high.gain };
  for (const [id, value] of Object.entries(init)) targets[id].value = value;
  return {
    input: low,
    output: high,
    set(param, value) {
      const target = targets[param];
      if (!target) throw new EffectError(`EQ has no parameter "${param}".`);
      smooth(ctx, target, clampParam(checked("eq", param), value));
    },
    dispose: () => disconnectAll([low, mid, high]),
  };
}

function buildSaturator(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const v = { ...init };
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const pre = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const tone = ctx.createBiquadFilter();
  const post = ctx.createGain();
  shaper.curve = curve(2049, (x) => Math.tanh(2.5 * x) / Math.tanh(2.5));
  shaper.oversample = "4x";
  tone.type = "lowpass";
  input.connect(dry).connect(output);
  input.connect(pre).connect(shaper).connect(tone).connect(post).connect(wet).connect(output);
  const apply = (): void => {
    const drive = lin(v.drive);
    pre.gain.value = drive;
    // Without this the wet path gets much louder as drive rises, which hides what the effect does to the tone.
    post.gain.value = 1 / Math.sqrt(drive);
    tone.frequency.value = v.tone;
    wet.gain.value = v.mix;
    dry.gain.value = 1 - v.mix;
  };
  apply();
  return {
    input,
    output,
    set(param, value) {
      v[param] = clampParam(checked("saturator", param), value);
      apply();
    },
    dispose: () => disconnectAll([input, output, dry, wet, pre, shaper, tone, post]),
  };
}

function buildFilter(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const f = ctx.createBiquadFilter();
  const types: BiquadFilterType[] = ["lowpass", "highpass", "bandpass"];
  f.type = types[init.mode];
  f.frequency.value = init.cutoff;
  f.Q.value = init.resonance;
  return {
    input: f,
    output: f,
    set(param, value) {
      const v = clampParam(checked("filter", param), value);
      if (param === "mode") f.type = types[v];
      else if (param === "cutoff") smooth(ctx, f.frequency, v);
      else smooth(ctx, f.Q, v);
    },
    dispose: () => f.disconnect(),
  };
}

function buildChorus(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const v = { ...init };
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  wet.connect(output);
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  const invert = ctx.createGain();
  invert.gain.value = -1;
  const depthA = ctx.createGain();
  const depthB = ctx.createGain();
  const nodes: AudioNode[] = [input, output, dry, wet, lfo, invert, depthA, depthB];
  // Two voices with opposite modulation and opposite pan give the stereo movement a single voice lacks.
  const voices = [
    { base: 0.016, depth: depthA, pan: -0.6 },
    { base: 0.023, depth: depthB, pan: 0.6 },
  ];
  lfo.connect(depthA);
  lfo.connect(invert).connect(depthB);
  for (const voice of voices) {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = voice.base;
    const panner = ctx.createStereoPanner();
    panner.pan.value = voice.pan;
    voice.depth.connect(delay.delayTime);
    input.connect(delay).connect(panner).connect(wet);
    nodes.push(delay, panner);
  }
  const apply = (): void => {
    lfo.frequency.value = v.rate;
    const swing = 0.0035 * v.depth;
    depthA.gain.value = swing;
    depthB.gain.value = swing;
    wet.gain.value = v.mix;
    dry.gain.value = 1;
  };
  apply();
  lfo.start();
  return {
    input,
    output,
    set(param, value) {
      v[param] = clampParam(checked("chorus", param), value);
      apply();
    },
    dispose() {
      lfo.stop();
      disconnectAll(nodes);
    },
  };
}

function buildDelay(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const v = { ...init };
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(2.5);
  const tone = ctx.createBiquadFilter();
  const feedback = ctx.createGain();
  tone.type = "lowpass";
  input.connect(dry).connect(output);
  input.connect(delay).connect(wet).connect(output);
  delay.connect(tone).connect(feedback).connect(delay);
  const apply = (): void => {
    delay.delayTime.value = v.time / 1000;
    feedback.gain.value = v.feedback;
    tone.frequency.value = v.tone;
    wet.gain.value = v.mix;
    dry.gain.value = 1 - v.mix;
  };
  apply();
  return {
    input,
    output,
    set(param, value) {
      v[param] = clampParam(checked("delay", param), value);
      if (param === "time") smooth(ctx, delay.delayTime, v.time / 1000);
      else apply();
    },
    dispose: () => disconnectAll([input, output, dry, wet, delay, tone, feedback]),
  };
}

/** Small seeded generator so a reverb sounds identical every time, including in exports. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildReverbImpulse(ctx: BaseAudioContext, decaySeconds: number, dampingHz: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * (decaySeconds * 1.15)));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  // One-pole low-pass in the tail: high frequencies die faster than lows, like a real room.
  const coeff = Math.exp((-2 * Math.PI * dampingHz) / ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    const rand = mulberry32(0x9e3779b9 + c * 7919);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const envelope = Math.exp((-6.9 * t) / decaySeconds);
      lp = (1 - coeff) * (rand() * 2 - 1) + coeff * lp;
      data[i] = lp * envelope;
    }
  }
  return buffer;
}

function buildReverb(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const v = { ...init };
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const pre = ctx.createDelay(0.2);
  const convolver = ctx.createConvolver();
  input.connect(dry).connect(output);
  input.connect(pre).connect(convolver).connect(wet).connect(output);
  const rebuild = (): void => {
    convolver.buffer = buildReverbImpulse(ctx, v.decay, v.damping);
  };
  const apply = (): void => {
    pre.delayTime.value = v.preDelay / 1000;
    wet.gain.value = v.mix;
    dry.gain.value = 1 - v.mix;
  };
  rebuild();
  apply();
  return {
    input,
    output,
    set(param, value) {
      v[param] = clampParam(checked("reverb", param), value);
      if (param === "decay" || param === "damping") rebuild();
      else apply();
    },
    dispose: () => disconnectAll([input, output, dry, wet, pre, convolver]),
  };
}

/**
 * Built only from native nodes so it renders offline exactly as it plays live: an envelope follower
 * drives a gain node. Two smoothers (fast and slow) joined by "max" give a quick open and a slow close.
 */
function buildGate(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const v = { ...init };
  const input = ctx.createGain();
  const output = ctx.createGain();
  const lookahead = ctx.createDelay(0.05);
  lookahead.delayTime.value = 0.003;
  const vca = ctx.createGain();
  input.connect(lookahead).connect(vca).connect(output);

  const abs = ctx.createWaveShaper();
  abs.curve = new Float32Array([1, 0, 1]);
  const envelope = ctx.createBiquadFilter();
  envelope.type = "lowpass";
  envelope.frequency.value = 300;
  // Scaling so the threshold always lands at 0.5 lets the comparator curve stay fixed.
  const scale = ctx.createGain();
  const compare = ctx.createWaveShaper();
  compare.curve = curve(2049, (x) => {
    const t = Math.min(1, Math.max(0, (x - 0.45) / 0.1));
    return t * t * (3 - 2 * t);
  });
  const fast = ctx.createBiquadFilter();
  fast.type = "lowpass";
  fast.frequency.value = 90;
  const slow = ctx.createBiquadFilter();
  slow.type = "lowpass";
  const negate = ctx.createGain();
  negate.gain.value = -1;
  const difference = ctx.createGain();
  const positive = ctx.createWaveShaper();
  positive.curve = new Float32Array([0, 0, 1]);
  const open = ctx.createGain();
  const span = ctx.createGain();

  input.connect(abs).connect(envelope).connect(scale).connect(compare);
  compare.connect(fast);
  compare.connect(slow);
  slow.connect(difference);
  fast.connect(negate).connect(difference);
  difference.connect(positive).connect(open);
  fast.connect(open);
  open.connect(span).connect(vca.gain);

  const apply = (): void => {
    scale.gain.value = 0.5 / lin(v.threshold);
    slow.frequency.value = 1 / (2 * Math.PI * (v.release / 1000));
    const floor = lin(-v.reduction);
    vca.gain.value = floor;
    span.gain.value = 1 - floor;
  };
  apply();
  return {
    input,
    output,
    set(param, value) {
      v[param] = clampParam(checked("gate", param), value);
      apply();
    },
    dispose: () => disconnectAll([input, output, lookahead, vca, abs, envelope, scale, compare, fast, slow, negate, difference, positive, open, span]),
  };
}

/**
 * Split-band de-esser: only the band above the crossover is turned down, so vowels are left alone.
 * The level detector and gain computer are native nodes rather than a DynamicsCompressorNode, because
 * browsers disagree on that node's built-in latency and any mismatch would cancel the bands at the crossover.
 */
function buildDeesser(ctx: BaseAudioContext, init: Record<string, number>): Effect {
  const v = { ...init };
  const input = ctx.createGain();
  const output = ctx.createGain();
  const low = ctx.createBiquadFilter();
  const high = ctx.createBiquadFilter();
  // Q of 0.5 (-6.02 dB, as biquad Q is in decibels) makes a Linkwitz-Riley crossover: low minus high sums flat.
  low.type = "lowpass";
  high.type = "highpass";
  low.Q.value = -6.0206;
  high.Q.value = -6.0206;
  const vca = ctx.createGain();
  vca.gain.value = 0;
  const invert = ctx.createGain();
  invert.gain.value = -1;
  input.connect(low).connect(output);
  input.connect(high).connect(vca).connect(invert).connect(output);

  const abs = ctx.createWaveShaper();
  abs.curve = new Float32Array([1, 0, 1]);
  const envelope = ctx.createBiquadFilter();
  envelope.type = "lowpass";
  envelope.frequency.value = 500;
  const scale = ctx.createGain();
  let computer: WaveShaperNode | undefined;
  const fast = ctx.createBiquadFilter();
  fast.type = "lowpass";
  fast.frequency.value = 160;
  const slow = ctx.createBiquadFilter();
  slow.type = "lowpass";
  slow.frequency.value = 1 / (2 * Math.PI * 0.05);
  const negate = ctx.createGain();
  negate.gain.value = -1;
  const difference = ctx.createGain();
  const positive = ctx.createWaveShaper();
  positive.curve = new Float32Array([0, 0, 1]);
  const lower = ctx.createGain();
  lower.gain.value = -1;
  const smoothed = ctx.createGain();

  high.connect(abs).connect(envelope).connect(scale);
  // min(fast, slow) = fast - relu(fast - slow): gain falls at the fast rate and recovers at the slow one.
  fast.connect(smoothed);
  fast.connect(difference);
  slow.connect(negate).connect(difference);
  difference.connect(positive).connect(lower).connect(smoothed);
  smoothed.connect(vca.gain);

  const apply = (): void => {
    low.frequency.value = v.frequency;
    high.frequency.value = v.frequency;
    // A sine's rectified-and-smoothed level is 2/pi of its peak; threshold 0.05 on the computer's input is the knee.
    scale.gain.value = 0.05 / (lin(v.threshold) * (2 / Math.PI));
    const exponent = 1 - 1 / v.amount;
    // A shaper's curve can be set only once, so a new threshold or amount swaps in a new shaper.
    const next = ctx.createWaveShaper();
    next.curve = curve(4097, (x) => {
      const u = Math.max(0, x) / 0.05;
      return u <= 1 ? 1 : u ** -exponent;
    });
    scale.connect(next);
    next.connect(fast);
    next.connect(slow);
    if (computer) {
      scale.disconnect(computer);
      computer.disconnect();
    }
    computer = next;
  };
  apply();
  return {
    input,
    output,
    set(param, value) {
      v[param] = clampParam(checked("deesser", param), value);
      apply();
    },
    dispose: () => disconnectAll([input, output, low, high, vca, invert, abs, envelope, scale, ...(computer ? [computer] : []), fast, slow, negate, difference, positive, lower, smoothed]),
  };
}

const BUILDERS: Readonly<Record<InsertType, EffectBuilder>> = {
  compressor: buildCompressor,
  eq: buildEq,
  saturator: buildSaturator,
  filter: buildFilter,
  chorus: buildChorus,
  delay: buildDelay,
  reverb: buildReverb,
  gate: buildGate,
  deesser: buildDeesser,
};

export function buildEffect(type: InsertType, ctx: BaseAudioContext, params: Readonly<Record<string, number>> = {}): Effect {
  const builder = BUILDERS[type];
  if (!builder) throw new EffectError(`Unknown effect "${String(type)}".`);
  return builder(ctx, resolveParams(type, params));
}

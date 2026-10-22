import type { ParamDef, Preset } from "../types";
import { DrumBase, PATTERN_COUNT } from "./drums/drumBase";
import { crushCurve, satCurve } from "./drums/curves";
import { GROOVES, grooveToPatterns } from "./drums/groovesDivine";
import type { Hit } from "./drums/hit";
import { applyRowTool, clampIndex, randomRow, type RowTool } from "./drums/pattern";
import { mulberry32 } from "./drums/rng";
import { SwappableShaper } from "./drums/shaper";
import { smooth } from "./drums/smooth";
import { Strip } from "./drums/strip";
import { KITS_DIVINE, PROFILES, PROFILE_CHOICES, SYNTH_VOICES, VOICES_DIVINE, playDivine } from "./drums/voicesDivine";

export const MAX_STEPS = 128;
export const LENGTHS = [16, 32, 64, 128] as const;
const VOICES = VOICES_DIVINE.length;
const PAN = [0, 0, 0, 0.18, -0.12, -0.28, 0, 0.28, 0.14, 0.3, -0.3];
const ROOM = [0, 0.06, 0.14, 0, 0.04, 0.05, 0.05, 0.05, 0.04, 0.06, 0.1];
export const STEP_ON = 1;
export const STEP_ACCENT = 2;
const ACCENT_GAIN = 1.12;
const NORMAL_VEL = 0.72;

const voiceParams = (i: number): ParamDef[] => {
  const group = VOICES_DIVINE[i].name;
  const synth = i < SYNTH_VOICES;
  return [
    { id: `v${i}.level`, label: "Level", group, min: 0, max: 1, step: 0.01, def: 1 },
    { id: `v${i}.pan`, label: "Pan", group, min: -1, max: 1, step: 0.01, def: PAN[i] ?? 0 },
    { id: `v${i}.tune`, label: "Tune", group, min: -12, max: 12, step: 1, def: 0, unit: "st" },
    { id: `v${i}.decay`, label: "Decay", group, min: 0.4, max: 2.5, step: 0.01, def: 1, unit: "x" },
    { id: `v${i}.tone`, label: "Tone", group, min: -1, max: 1, step: 0.01, def: 0 },
    { id: `v${i}.punch`, label: "Punch", group, min: 0, max: 1, step: 0.01, def: 0.5 },
    { id: `v${i}.delay`, label: "Delay send", group, min: 0, max: 1, step: 0.01, def: 0 },
    { id: `v${i}.reverb`, label: "Reverb send", group, min: 0, max: 1, step: 0.01, def: ROOM[i] ?? 0 },
    ...(synth ? [{ id: `v${i}.profile`, label: "Profile", group, min: 0, max: PROFILE_CHOICES.length - 1, def: 0, options: PROFILE_CHOICES.map((c) => c.label) } satisfies ParamDef] : []),
    { id: `v${i}.mute`, label: "Mute", group, min: 0, max: 1, def: 0, options: ["Off", "On"] },
    { id: `v${i}.solo`, label: "Solo", group, min: 0, max: 1, def: 0, options: ["Off", "On"] },
  ];
};

export const PARAMS_DIVINE: readonly ParamDef[] = [
  { id: "kit", label: "Kit", group: "Master", min: 0, max: KITS_DIVINE.length - 1, def: 0, options: KITS_DIVINE.map((k) => k.name) },
  { id: "length", label: "Length", group: "Master", min: 0, max: 3, def: 1, options: LENGTHS.map(String) },
  { id: "swing", label: "Swing", group: "Master", min: 0, max: 0.6, step: 0.01, def: 0.08 },
  { id: "level", label: "Level", group: "Master", min: 0, max: 1, step: 0.01, def: 0.85 },
  { id: "drive", label: "Drive", group: "Master", min: 0, max: 1, step: 0.01, def: 0.18 },
  { id: "room", label: "Room", group: "Master", min: 0, max: 0.7, step: 0.01, def: 0.12 },
  { id: "hat", label: "Hat tone", group: "Master", min: 0.1, max: 1, step: 0.01, def: 0.65 },
  { id: "crush", label: "Bit crush", group: "Master", min: 0, max: 1, step: 0.01, def: 0 },
  { id: "filter", label: "Filter", group: "Master", min: 0, max: 1, step: 0.01, def: 1 },
  { id: "stutter", label: "Stutter", group: "Master", min: 0, max: 1, def: 0, options: ["Off", "On"] },
  ...VOICES_DIVINE.flatMap((_, i) => voiceParams(i)),
];

const kitPreset = (i: number, extra: Record<string, number> = {}): Preset => ({
  id: `kit-${KITS_DIVINE[i].id}`,
  name: KITS_DIVINE[i].name,
  category: "Kits",
  factory: true,
  values: { kit: i, ...extra },
});

const KIT_EXTRAS: Record<number, Record<string, number>> = {
  1: { drive: 0.3, room: 0.18 },
  2: { drive: 0.4, room: 0.1, hat: 0.5 },
  3: { hat: 0.8 },
  4: { drive: 0.28, filter: 0.7 },
  8: { crush: 0.3, drive: 0.35, filter: 0.6 },
  9: { room: 0.35 },
  10: { hat: 0.9, drive: 0.1 },
};

export const PRESETS_DIVINE: readonly Preset[] = [
  ...KITS_DIVINE.map((_, i) => kitPreset(i, KIT_EXTRAS[i])),
  ...GROOVES.map(
    (g): Preset => ({
      id: `groove-${g.id}`,
      name: g.name,
      category: "Grooves",
      factory: true,
      values: { kit: g.kit, ...KIT_EXTRAS[g.kit] },
      data: { patterns: grooveToPatterns(g, VOICES, MAX_STEPS) },
    }),
  ),
];

function defaultPatterns(): number[][][] {
  const rnd = mulberry32(909);
  const hit = (p: number, v: number, step: number): boolean => {
    if (p === 0) return v === 0 ? step % 4 === 0 : v === 3 ? step % 2 === 1 : v === 6 ? step === 10 : v === 7 ? step === 13 : v === 8 ? step === 7 || step === 15 : v === 9 ? step % 4 === 0 : v === 10 ? step === 0 : false;
    if (p === 1) return v === 0 ? step % 4 === 0 : v === 1 ? step === 4 || step === 12 : v === 2 ? step === 12 : v === 3 ? step % 2 === 0 : v === 4 ? step === 6 || step === 14 : v === 9 ? step === 14 : false;
    if (p === 2) return v === 0 ? step === 0 || step === 6 || step === 10 : v === 1 ? step === 4 || step === 14 : v === 2 ? step === 8 : v === 3 ? step % 3 === 0 : v === 5 ? step === 7 || step === 15 : v === 8 ? step === 3 || step === 11 : false;
    return rnd() > 0.72;
  };
  return Array.from({ length: PATTERN_COUNT }, (_, p) =>
    Array.from({ length: VOICES }, (_, v) =>
      Array.from({ length: MAX_STEPS }, (_, i) => {
        const step = i % 16;
        // Sample voices stay silent by default: a fresh project has no samples to play.
        if (v >= SYNTH_VOICES || !hit(p, v, step)) return 0;
        return step === 0 && v === 0 ? STEP_ACCENT : STEP_ON;
      }),
    ),
  );
}

export class Divine09 extends DrumBase {
  readonly kind = "divine09" as const;
  private patterns: number[][][];
  private readonly strips: Strip[];
  private readonly levelGain: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly crusher: SwappableShaper;
  private readonly saturator: SwappableShaper;
  private readonly gate: GainNode;
  private openHat: Hit | null = null;
  private lastCrush = -1;
  private lastDrive = -1;

  constructor(ctx: BaseAudioContext) {
    super(ctx, PARAMS_DIVINE, PRESETS_DIVINE, "divine09", VOICES, 4);
    this.patterns = defaultPatterns();

    // Master bus: level, glue compressor, filter sweep, bit crusher, saturator, stutter gate.
    this.mix.disconnect();
    this.levelGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.003;
    comp.release.value = 0.14;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.crusher = new SwappableShaper(ctx);
    this.saturator = new SwappableShaper(ctx, "4x");
    this.gate = ctx.createGain();
    this.mix.connect(this.levelGain).connect(comp).connect(this.tone).connect(this.crusher.input);
    this.crusher.output.connect(this.saturator.input);
    this.saturator.output.connect(this.gate).connect(this.safety.input);

    this.strips = VOICES_DIVINE.map(() => new Strip(ctx, this.mix, this.fx));
    this.applyAllParams();
  }

  get length(): number {
    return LENGTHS[this.getParam("length")];
  }

  stepValue(voice: number, step: number, pattern = this.editIndex): number {
    return this.patterns[pattern][voice][step] ?? 0;
  }

  /** Tapping cycles a step off or on; with `accent` it turns on as a loud hit instead. */
  tapStep(voice: number, step: number, accent = false): void {
    const row = this.patterns[this.editIndex][voice];
    row[step] = accent ? (row[step] === STEP_ACCENT ? 0 : STEP_ACCENT) : row[step] ? 0 : STEP_ON;
    this.bump();
  }

  applyTool(tool: RowTool, voice: number, hits = 4): void {
    const rows = this.patterns[this.editIndex];
    rows[voice] = applyRowTool(tool, rows[voice], this.length, hits, STEP_ON);
    this.bump();
  }

  randomize(rnd: () => number = Math.random): void {
    const rows = this.patterns[this.editIndex];
    rows.forEach((row, v) => {
      if (v >= SYNTH_VOICES && !this.buffers[v - SYNTH_VOICES]) return;
      const density = v === 0 ? 0.5 : v === 3 ? 0.72 : 0.2;
      rows[v] = randomRow(row, this.length, density, rnd, () => (rnd() > 0.82 ? STEP_ACCENT : STEP_ON));
    });
    this.bump();
  }

  clearPattern(): void {
    this.patterns[this.editIndex] = this.patterns[this.editIndex].map(() => new Array<number>(MAX_STEPS).fill(0));
    this.bump();
  }

  protected playStep(step: number, time: number, stepDur: number): void {
    const len = this.length;
    const ix = step % len;
    const rows = this.patterns[this.activeIndex ?? 0];
    const when = this.swung(ix, time, stepDur, this.values.swing);
    for (let v = 0; v < VOICES; v++) {
      const s = rows[v][ix];
      if (s) this.trigger(v, s === STEP_ACCENT ? ACCENT_GAIN : NORMAL_VEL, when, this.seeded(step, v));
    }
    if (this.values.stutter === 1) this.gateStep(time, stepDur);
  }

  /**
   * The stutter is scheduled a step at a time from the clock, so it cannot outlive the transport.
   * Ramps and holds rather than chained setTarget events, which some engines evaluate wrongly.
   */
  private gateStep(time: number, stepDur: number): void {
    const g = this.gate.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(1, time);
    g.setValueAtTime(1, time + stepDur * 0.45);
    g.linearRampToValueAtTime(0, time + stepDur * 0.5);
    g.setValueAtTime(0, time + stepDur * 0.9);
    g.linearRampToValueAtTime(1, time + stepDur * 0.97);
  }

  protected trigger(voice: number, velocity: number, time: number, rng: () => number): void {
    if (!this.voiceAudible(voice)) return;
    const hit = this.newHit(time, velocity, this.strips[voice].input, rng);
    const tune = 2 ** (this.values[`v${voice}.tune`] / 12);
    if (voice >= SYNTH_VOICES) {
      const buffer = this.buffers[voice - SYNTH_VOICES];
      if (buffer) hit.buffer(buffer, tune);
      return;
    }
    const kit = KITS_DIVINE[this.values.kit];
    const choice = PROFILE_CHOICES[this.values[`v${voice}.profile`]];
    const profile = PROFILES[choice.id === "kit" ? kit.profile : choice.id];
    if (voice === 3 && this.openHat) {
      this.openHat.choke(time);
      this.openHat = null;
    }
    playDivine(hit, voice, {
      kc: kit.char,
      p: profile,
      hat: this.values.hat,
      tune,
      decay: this.values[`v${voice}.decay`],
      punch: this.values[`v${voice}.punch`] * 2,
      vel: velocity,
    });
    if (voice === 4) this.openHat = hit;
  }

  protected applyVoiceParam(voice: number, key: string, value: number): void {
    const strip = this.strips[voice];
    if (key === "level") strip.setLevel(value);
    else if (key === "pan") strip.setPan(value);
    else if (key === "tone") strip.setTilt(value);
    else if (key === "delay" || key === "reverb") strip.setSends(this.values[`v${voice}.delay`], this.values[`v${voice}.reverb`]);
  }

  protected applyGlobal(id: string, value: number): void {
    const t = this.ctx.currentTime;
    if (id === "level") smooth(this.ctx, this.levelGain.gain, value);
    else if (id === "room") this.fx.setRoom(value);
    else if (id === "filter") smooth(this.ctx, this.tone.frequency, 350 + value * value * 17650, 0.025);
    else if (id === "drive") {
      if (value !== this.lastDrive) {
        this.lastDrive = value;
        this.saturator.setCurve(satCurve(1 + value * 10));
      }
    } else if (id === "crush") {
      if (value !== this.lastCrush) {
        this.lastCrush = value;
        this.crusher.setCurve(value < 0.01 ? null : crushCurve(value));
      }
    } else if (id === "stutter" && value === 0) {
      this.gate.gain.cancelScheduledValues(t);
      this.gate.gain.setValueAtTime(1, t);
    }
  }

  protected refreshGates(): void {
    this.strips.forEach((s, i) => s.setAudible(this.voiceAudible(i)));
  }

  override allNotesOff(): void {
    super.allNotesOff();
    this.openHat = null;
    const t = this.ctx.currentTime;
    this.gate.gain.cancelScheduledValues(t);
    this.gate.gain.setValueAtTime(1, t);
  }

  protected override serializeData(): unknown {
    return {
      patterns: this.patterns.map((p) => p.map((r) => r.slice())),
      pattern: this.editIndex,
      voice: this.selectedVoice,
      samples: this.sampleRefs(),
    };
  }

  protected override restoreData(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const d = data as { patterns?: unknown; pattern?: unknown; voice?: unknown; samples?: unknown };
    if (Array.isArray(d.patterns)) {
      const src = d.patterns as unknown[][][];
      this.patterns = Array.from({ length: PATTERN_COUNT }, (_, p) =>
        Array.from({ length: VOICES }, (_, v) => {
          const row = src[p]?.[v];
          // Preset grooves ship one bar; tile it so every length plays something.
          return Array.from({ length: MAX_STEPS }, (_, i) => {
            const n = Array.isArray(row) && row.length > 0 ? Number(row[i % row.length]) : 0;
            return n === STEP_ACCENT ? STEP_ACCENT : n >= STEP_ON ? STEP_ON : 0;
          });
        }),
      );
    }
    if (d.pattern !== undefined) {
      this.editIndex = clampIndex(d.pattern, PATTERN_COUNT);
      this.activeIndex = this.editIndex;
    }
    if (d.voice !== undefined) this.restoreSelected(d.voice);
    if ("samples" in d) this.restoreSamples(d.samples);
  }

  override dispose(): void {
    this.strips.forEach((s) => s.dispose());
    this.crusher.dispose();
    this.saturator.dispose();
    this.gate.disconnect();
    super.dispose();
  }
}

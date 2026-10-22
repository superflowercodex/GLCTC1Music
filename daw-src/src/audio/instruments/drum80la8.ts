import type { ParamDef, Preset } from "../types";
import { DrumBase, PATTERN_COUNT } from "./drums/drumBase";
import { BREAKS, CLASSIC, ELECTRO, HOUSE, TRAP, type Groove, type Pattern80 } from "./drums/kits80la8";
import { applyRowTool, clampIndex, randomRow, type RowTool } from "./drums/pattern";
import { play80la8, VOICES_80LA8 } from "./drums/voices80la8";
import { Strip } from "./drums/strip";

export const STEPS_80LA8 = 16;
const VOICES = VOICES_80LA8.length;
const BOUNCE_BARS = [1, 2, 4, 8] as const;

const voiceParams = (i: number): ParamDef[] => {
  const group = VOICES_80LA8[i].name;
  return [
    { id: `v${i}.level`, label: "Level", group, min: 0, max: 1.5, step: 0.01, def: 0.82 },
    { id: `v${i}.pan`, label: "Pan", group, min: -1, max: 1, step: 0.01, def: 0 },
    { id: `v${i}.tune`, label: "Pitch", group, min: -24, max: 24, step: 1, def: 0, unit: "st" },
    { id: `v${i}.decay`, label: "Decay", group, min: 0.04, max: 2.5, step: 0.01, def: 0.35, unit: "s" },
    { id: `v${i}.tone`, label: "Tone", group, min: 150, max: 18000, step: 50, def: 10000, unit: "Hz" },
    { id: `v${i}.drive`, label: "Drive", group, min: 0, max: 1, step: 0.01, def: 0 },
    { id: `v${i}.delay`, label: "Delay send", group, min: 0, max: 1, step: 0.01, def: 0 },
    { id: `v${i}.reverb`, label: "Reverb send", group, min: 0, max: 1, step: 0.01, def: 0 },
    { id: `v${i}.mute`, label: "Mute", group, min: 0, max: 1, def: 0, options: ["Off", "On"] },
    { id: `v${i}.solo`, label: "Solo", group, min: 0, max: 1, def: 0, options: ["Off", "On"] },
  ];
};

export const PARAMS_80LA8: readonly ParamDef[] = [
  { id: "swing", label: "Swing", group: "Groove", min: 0, max: 0.6, step: 0.01, def: 0.08 },
  { id: "bounceBars", label: "Bounce length", group: "Groove", min: 0, max: 3, def: 1, options: ["1 bar", "2 bars", "4 bars", "8 bars"] },
  ...VOICES_80LA8.flatMap((_, i) => voiceParams(i)),
];

interface Tweak {
  tune?: number;
  decay?: number;
  tone?: number;
  drive?: number;
  level?: number;
  reverb?: number;
}

/** A kit shifts every voice a little in the same direction, so one number set gives it a character. */
function kit(id: string, name: string, groove: Groove, t: Tweak, extra: Record<string, number> = {}): Preset {
  const values: Record<string, number> = { ...extra };
  VOICES_80LA8.forEach((v, i) => {
    const tonal = ["kick", "toml", "tomm", "conga", "snare"].includes(v.type);
    if (t.tune !== undefined && tonal) values[`v${i}.tune`] = t.tune;
    if (t.decay !== undefined) values[`v${i}.decay`] = +(0.35 * t.decay).toFixed(2);
    if (t.tone !== undefined) values[`v${i}.tone`] = t.tone;
    if (t.drive !== undefined) values[`v${i}.drive`] = t.drive;
    if (t.level !== undefined) values[`v${i}.level`] = t.level;
    if (t.reverb !== undefined) values[`v${i}.reverb`] = t.reverb;
  });
  return { id, name, category: "Kits", factory: true, values, data: { patterns: groove.patterns.map((p) => p.map((r) => r.slice())) } };
}

export const PRESETS_80LA8: readonly Preset[] = [
  kit("solar", "Solar", CLASSIC, {}),
  kit("warehouse", "Warehouse", HOUSE, { tune: -2, decay: 1.2, tone: 12000, drive: 0.12, reverb: 0.1 }, { swing: 0.12 }),
  kit("dusty", "Dusty break", BREAKS, { tune: -1, decay: 0.9, tone: 6500, drive: 0.2 }, { swing: 0.16 }),
  kit("neon", "Neon electro", ELECTRO, { tune: 2, decay: 0.8, tone: 14000, drive: 0.08 }, { swing: 0.04 }),
  kit("lowrider", "Low rider", TRAP, { tune: -5, decay: 1.8, tone: 9000, drive: 0.25, level: 0.9 }, { swing: 0 }),
  kit("tape", "Lo-fi tape", CLASSIC, { tune: -3, decay: 1.1, tone: 3800, drive: 0.35, reverb: 0.06 }, { swing: 0.2 }),
  kit("punch", "Hard punch", HOUSE, { tune: 1, decay: 0.7, tone: 16000, drive: 0.4, level: 0.95 }, { swing: 0.02 }),
  kit("glass", "Glass room", ELECTRO, { tune: 3, decay: 1.5, tone: 18000, reverb: 0.35 }, { swing: 0.06 }),
];

/** Chance each voice fires per step when randomising, matching the old DAW's feel. */
const DENSITY = [0.27, 0.12, 0.1, 0.55, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];

export class Drum80la8 extends DrumBase {
  readonly kind = "drum80la8" as const;
  private patterns: Pattern80[];
  private readonly strips: Strip[];

  constructor(ctx: BaseAudioContext) {
    super(ctx, PARAMS_80LA8, PRESETS_80LA8, "drum80la8", VOICES, VOICES);
    this.patterns = CLASSIC.patterns.map((p) => p.map((r) => r.slice()));
    this.strips = VOICES_80LA8.map(() => new Strip(ctx, this.mix, this.fx));
    this.applyAllParams();
  }

  stepVelocity(voice: number, step: number, pattern = this.editIndex): number {
    return this.patterns[pattern][voice][step] ?? 0;
  }

  setStep(voice: number, step: number, velocity: number): void {
    this.patterns[this.editIndex][voice][step] = Math.max(0, Math.min(1, velocity));
    this.bump();
  }

  toggleStep(voice: number, step: number): number {
    const row = this.patterns[this.editIndex][voice];
    row[step] = row[step] > 0 ? 0 : 0.84;
    this.bump();
    return row[step];
  }

  applyTool(tool: RowTool, voice: number, hits = 4): void {
    const rows = this.patterns[this.editIndex];
    rows[voice] = applyRowTool(tool, rows[voice], STEPS_80LA8, hits, 0.84);
    this.bump();
  }

  randomize(rnd: () => number = Math.random): void {
    const rows = this.patterns[this.editIndex];
    rows.forEach((row, v) => (rows[v] = randomRow(row, STEPS_80LA8, DENSITY[v], rnd, () => 0.45 + rnd() * 0.5)));
    this.bump();
  }

  clearPattern(): void {
    this.patterns[this.editIndex] = this.patterns[this.editIndex].map(() => new Array<number>(STEPS_80LA8).fill(0));
    this.bump();
  }

  get bounceBars(): number {
    return BOUNCE_BARS[this.getParam("bounceBars")];
  }

  protected playStep(step: number, time: number, stepDur: number): void {
    const ix = step % STEPS_80LA8;
    const rows = this.patterns[this.activeIndex ?? 0];
    const when = this.swung(step, time, stepDur, this.values.swing);
    for (let v = 0; v < VOICES; v++) {
      const vel = rows[v][ix];
      if (vel > 0) this.trigger(v, vel, when, this.seeded(step, v));
    }
  }

  protected trigger(voice: number, velocity: number, time: number, rng: () => number): void {
    if (!this.voiceAudible(voice)) return;
    const hit = this.newHit(time, Math.max(0.02, velocity), this.strips[voice].input, rng);
    const pitch = 2 ** (this.values[`v${voice}.tune`] / 12);
    const buffer = this.buffers[voice];
    if (buffer) hit.buffer(buffer, pitch);
    else play80la8(hit, VOICES_80LA8[voice].type, pitch, this.values[`v${voice}.decay`]);
  }

  protected applyVoiceParam(voice: number, key: string, value: number): void {
    const strip = this.strips[voice];
    if (key === "level") strip.setLevel(value);
    else if (key === "pan") strip.setPan(value);
    else if (key === "tone") strip.setCutoff(value);
    else if (key === "drive") strip.setDrive(value);
    else if (key === "delay" || key === "reverb") strip.setSends(this.values[`v${voice}.delay`] * 0.65, this.values[`v${voice}.reverb`] * 0.18);
  }

  protected applyGlobal(): void {}

  protected refreshGates(): void {
    this.strips.forEach((s, i) => s.setAudible(this.voiceAudible(i)));
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
      this.patterns = Array.from({ length: PATTERN_COUNT }, (_, p) =>
        Array.from({ length: VOICES }, (_, v) => {
          const src: unknown = (d.patterns as unknown[][][])[p]?.[v];
          return Array.from({ length: STEPS_80LA8 }, (_, i) => {
            const n = Array.isArray(src) ? Number(src[i]) : 0;
            return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
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
    super.dispose();
  }
}

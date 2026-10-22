import type { ParamDef, Preset } from "../types";
import { DrumBase, PATTERN_COUNT } from "./drums/drumBase";
import { applyRowTool, clampIndex, euclid, randomRow, type RowTool } from "./drums/pattern";
import { Strip } from "./drums/strip";
import { PAD_KINDS, playPad } from "./drums/voicesPad";

export const PAD_COUNT = 16;
export const PAD_STEPS = 64;
export const SCENE_COUNT = 8;
export const SCENE_NAMES = ["Intro", "Build", "Drop", "Break", "Groove", "Fill", "Drop 2", "Outro"] as const;
const BARS_CHOICES = [1, 2, 3, 4] as const;
const PAN = [0, 0, 0, 0.18, -0.12, -0.25, 0.14, 0.28, 0, 0, -0.1, 0.1, 0.2, -0.2, 0, 0];
/** A normal step plays at 0.74 and an accent at full velocity, as the old DAW did. */
const STEP_VELOCITY = [0, 0.74, 1];
const CHAIN_STEPS = 32;
const BUILD_STEPS = 32;

const voiceParams = (i: number): ParamDef[] => {
  const group = `Pad ${i + 1}`;
  return [
    { id: `v${i}.kind`, label: "Sound", group, min: 0, max: PAD_KINDS.length - 1, def: i, options: PAD_KINDS },
    { id: `v${i}.level`, label: "Level", group, min: 0, max: 1.2, step: 0.01, def: 0.9 },
    { id: `v${i}.pan`, label: "Pan", group, min: -1, max: 1, step: 0.01, def: PAN[i] },
    { id: `v${i}.tune`, label: "Tune", group, min: -12, max: 12, step: 1, def: 0, unit: "st" },
    { id: `v${i}.decay`, label: "Decay", group, min: 0.3, max: 2, step: 0.05, def: 1, unit: "x" },
    { id: `v${i}.tone`, label: "Tone", group, min: -1, max: 1, step: 0.01, def: 0 },
    { id: `v${i}.mute`, label: "Mute", group, min: 0, max: 1, def: 0, options: ["Off", "On"] },
    { id: `v${i}.solo`, label: "Solo", group, min: 0, max: 1, def: 0, options: ["Off", "On"] },
  ];
};

export const PARAMS_PAD64: readonly ParamDef[] = [
  { id: "swing", label: "Swing", group: "Groove", min: 0, max: 0.5, step: 0.01, def: 0.06 },
  { id: "bars", label: "Loop length", group: "Groove", min: 0, max: 3, def: 3, options: BARS_CHOICES.map((b) => `${b} bar${b > 1 ? "s" : ""}`) },
  ...Array.from({ length: PAD_COUNT }, (_, i) => voiceParams(i)).flat(),
];

type Patterns = number[][][];

function emptyPatterns(): Patterns {
  return Array.from({ length: PATTERN_COUNT }, () => Array.from({ length: PAD_COUNT }, () => new Array<number>(PAD_STEPS).fill(0)));
}

function build(rule: (lane: number, s: number, i: number) => number): number[][] {
  return Array.from({ length: PAD_COUNT }, (_, l) => Array.from({ length: PAD_STEPS }, (_, i) => rule(l, i % 16, i)));
}

/** The four patterns the old DAW shipped: Club, Half-time, Broken, Fill. */
export function defaultPatterns(): Patterns {
  const a = build((l, s, i) =>
    l === 0 ? (s === 0 ? 2 : s % 4 === 0 ? 1 : 0)
    : l === 1 ? (s === 4 || s === 12 ? 1 : 0)
    : l === 2 ? ((s === 12 && ((i >= 16 && i < 32) || i >= 48)) ? 1 : 0)
    : l === 3 ? (s % 4 === 2 ? 1 : 0)
    : l === 4 ? ((s === 14 && ((i >= 16 && i < 32) || i >= 48)) ? 1 : 0)
    : l === 8 ? (s === 0 || s === 6 || s === 10 ? 1 : 0)
    : 0,
  );
  const b = build((l, s) => (l === 0 ? (s === 0 ? 2 : s === 10 ? 1 : 0) : l === 1 ? (s === 8 ? 1 : 0) : l === 3 ? (s % 2 === 0 ? 1 : 0) : l === 7 ? (s === 3 || s === 11 ? 1 : 0) : l === 8 ? (s === 0 ? 1 : 0) : 0));
  const c = build((l, s) => (l === 0 ? ([0, 3, 6, 10].includes(s) ? 1 : 0) : l === 1 ? ([4, 13].includes(s) ? 1 : 0) : l === 3 ? (s % 3 === 0 ? 1 : 0) : l === 6 ? (s === 7 || s === 15 ? 1 : 0) : 0));
  const d = build((l, s, i) => (l === 1 ? (i >= 48 && s >= 8 ? 1 : 0) : l === 0 ? (i < 48 && s === 0 ? 1 : 0) : l === 15 ? (i === 48 ? 2 : 0) : 0));
  return [a, b, c, d];
}

interface Scene {
  name: string;
  /** Which pattern (0 to 3) each pad plays while this scene is on. */
  lanes: number[];
}

const DEFAULT_SCENE_PATTERNS = [0, 1, 2, 3, 0, 3, 2, 1];

function defaultScenes(): Scene[] {
  return SCENE_NAMES.map((name, i) => ({ name, lanes: new Array<number>(PAD_COUNT).fill(DEFAULT_SCENE_PATTERNS[i]) }));
}

function kitPreset(id: string, name: string, kinds: number[], extra: Record<string, number> = {}): Preset {
  const values: Record<string, number> = { ...extra };
  kinds.forEach((k, i) => (values[`v${i}.kind`] = k));
  return { id, name, category: "Kits", factory: true, values };
}

export const PRESETS_PAD64: readonly Preset[] = [
  kitPreset("classic", "Classic pads", PAD_KINDS.map((_, i) => i)),
  kitPreset("deep", "Deep kit", [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 5, 5, 7, 15, 14, 15], { ...Object.fromEntries([0, 5, 8, 9].map((i) => [`v${i}.tune`, -3])), ...Object.fromEntries([0, 8, 15].map((i) => [`v${i}.decay`, 1.4])) }),
  kitPreset("synth", "Synth stack", [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 9, 10, 12, 8]),
  kitPreset("perc", "Percussion", [7, 6, 2, 3, 4, 5, 7, 6, 5, 7, 3, 4, 6, 7, 5, 6], { swing: 0.12 }),
  kitPreset("fx", "FX playground", [13, 14, 15, 13, 14, 15, 13, 14, 13, 14, 15, 13, 14, 15, 14, 15], { "v14.decay": 1.6, "v15.decay": 1.6 }),
  kitPreset("bright", "Bright and tight", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], { ...Object.fromEntries([...Array(PAD_COUNT).keys()].flatMap((i) => [[`v${i}.tone`, 0.35], [`v${i}.decay`, 0.7]])) }),
];

export class Pad64 extends DrumBase {
  readonly kind = "pad64" as const;
  private patterns: Patterns;
  private scenes: Scene[];
  /** The pattern each pad plays; the Song room sets them all, scenes set them per pad. */
  private laneMap: number[];
  private sceneIndex = -1;
  private pendingScene: number | null = null;
  private chain = false;
  private lastChainStep = -1;
  private dropLeft = 0;
  private dropHit = false;
  private buildLeft = 0;
  private readonly strips: Strip[];

  constructor(ctx: BaseAudioContext) {
    super(ctx, PARAMS_PAD64, PRESETS_PAD64, "pad64", PAD_COUNT, PAD_COUNT);
    this.patterns = defaultPatterns();
    this.scenes = defaultScenes();
    this.laneMap = new Array<number>(PAD_COUNT).fill(0);
    this.strips = Array.from({ length: PAD_COUNT }, () => new Strip(ctx, this.mix, this.fx));
    this.applyAllParams();
  }

  get bars(): number {
    return BARS_CHOICES[this.getParam("bars")];
  }

  get loopSteps(): number {
    return this.bars * 16;
  }

  // Patterns and steps ------------------------------------------------------

  lanePattern(lane: number): number {
    return this.laneMap[lane];
  }

  /** Switches one pad to another pattern (A to D) without touching the others. */
  setLanePattern(lane: number, pattern: number): void {
    this.laneMap[lane] = clampIndex(pattern, PATTERN_COUNT);
    this.sceneIndex = -1;
    this.bump();
  }

  protected override onPatternChange(): void {
    if (this.activeIndex !== null) this.laneMap.fill(this.activeIndex);
    this.sceneIndex = -1;
  }

  stepValue(lane: number, step: number): number {
    return this.patterns[this.laneMap[lane]][lane][step] ?? 0;
  }

  /** Off, on, accent, off: the three-state tap from the mock. Returns the new state. */
  cycleStep(lane: number, step: number): number {
    const row = this.patterns[this.laneMap[lane]][lane];
    row[step] = (row[step] + 1) % 3;
    this.bump();
    return row[step];
  }

  applyTool(tool: RowTool, lane: number, hits = 5): void {
    const row = this.patterns[this.laneMap[lane]][lane];
    const next =
      tool === "euclid"
        ? row.map((_, i) => (euclid(16, hits)[i % 16] ? 1 : 0))
        : applyRowTool(tool, row, this.loopSteps, hits, 1);
    this.patterns[this.laneMap[lane]][lane] = next;
    this.bump();
  }

  randomize(lane: number, rnd: () => number = Math.random): void {
    const kind = this.values[`v${lane}.kind`];
    const density = kind <= 2 ? 0.2 : kind <= 4 ? 0.5 : 0.22;
    const target = this.laneMap[lane];
    this.patterns[target][lane] = randomRow(this.patterns[target][lane], PAD_STEPS, density, rnd, () => (rnd() < 0.18 ? 2 : 1));
    this.bump();
  }

  clearAll(): void {
    this.patterns = emptyPatterns();
    this.bump();
  }

  // Scenes and the live strip ----------------------------------------------

  get currentScene(): number {
    return this.sceneIndex;
  }

  get queuedScene(): number | null {
    return this.pendingScene;
  }

  get chaining(): boolean {
    return this.chain;
  }

  sceneName(index: number): string {
    return this.scenes[index].name;
  }

  /** Remembers which pattern every pad plays right now under this scene. */
  storeScene(index: number): void {
    this.scenes[index].lanes = this.laneMap.slice();
    this.sceneIndex = index;
    this.bump();
  }

  /** While playing the switch waits for the next bar line; stopped, it happens at once. */
  recallScene(index: number, immediate: boolean): void {
    if (immediate) this.applyScene(index);
    else {
      this.pendingScene = index;
      this.bump();
    }
  }

  private applyScene(index: number): void {
    this.laneMap = this.scenes[index].lanes.slice();
    this.sceneIndex = index;
    this.pendingScene = null;
    if (this.activeIndex === null) this.activeIndex = 0;
    this.bump();
  }

  setChain(on: boolean): void {
    this.chain = on;
    this.bump();
  }

  /** Breaks the groove for one beat, then comes back with every pad hitting at full strength. */
  drop(): void {
    this.dropLeft = 4;
    this.dropHit = true;
  }

  /** Two bars of snare roll that speeds up and gets louder. */
  startBuild(): void {
    this.buildLeft = BUILD_STEPS;
  }

  // Playing -----------------------------------------------------------------

  protected playStep(step: number, time: number, stepDur: number): void {
    const loop = this.loopSteps;
    const ix = step % loop;
    if (step % 16 === 0 && this.pendingScene !== null) this.applyScene(this.pendingScene);
    else if (this.chain && step % CHAIN_STEPS === 0 && step !== this.lastChainStep) {
      this.lastChainStep = step;
      this.applyScene((this.sceneIndex + 1) % SCENE_COUNT);
    }
    const when = this.swung(ix, time, stepDur, this.values.swing);

    if (this.buildLeft > 0) {
      const done = BUILD_STEPS - this.buildLeft;
      const gap = done < 16 ? 4 : done < 24 ? 2 : 1;
      if (done % gap === 0) this.buildHit(when, 0.3 + 0.7 * (done / BUILD_STEPS), done, step);
      this.buildLeft -= 1;
    }

    if (this.dropLeft > 0) {
      this.dropLeft -= 1;
      return;
    }
    const accentAll = this.dropHit;
    this.dropHit = false;
    for (let l = 0; l < PAD_COUNT; l++) {
      const s = this.patterns[this.laneMap[l]][l][ix];
      if (s) this.trigger(l, accentAll ? 1 : STEP_VELOCITY[s], when, this.seeded(step, l));
    }
  }

  private buildHit(time: number, velocity: number, done: number, step: number): void {
    const lane = [...Array(PAD_COUNT).keys()].find((l) => this.values[`v${l}.kind`] === 1) ?? 1;
    // The roll climbs a few semitones as it speeds up, so it reads as tension rather than repetition.
    this.voiceHit(lane, velocity, time, this.seeded(step, 99), Math.round((done / BUILD_STEPS) * 7));
  }

  protected trigger(voice: number, velocity: number, time: number, rng: () => number): void {
    this.voiceHit(voice, velocity, time, rng, 0);
  }

  private voiceHit(voice: number, velocity: number, time: number, rng: () => number, extraSemitones: number): void {
    if (!this.voiceAudible(voice)) return;
    const hit = this.newHit(time, velocity, this.strips[voice].input, rng);
    const tune = this.values[`v${voice}.tune`] + extraSemitones;
    const decay = this.values[`v${voice}.decay`];
    const buffer = this.buffers[voice];
    if (buffer) {
      const rate = 2 ** (tune / 12);
      const dur = buffer.duration / rate;
      hit.buffer(buffer, rate);
      if (decay < 1) {
        hit.out.gain.setValueAtTime(velocity, time + dur * decay * 0.75);
        hit.out.gain.linearRampToValueAtTime(0, time + dur * decay);
      }
    } else playPad(hit, this.values[`v${voice}.kind`], 2 ** (tune / 12), decay);
  }

  protected applyVoiceParam(voice: number, key: string, value: number): void {
    const strip = this.strips[voice];
    if (key === "level") strip.setLevel(value);
    else if (key === "pan") strip.setPan(value);
    else if (key === "tone") strip.setTilt(value);
  }

  protected applyGlobal(): void {}

  protected refreshGates(): void {
    this.strips.forEach((s, i) => s.setAudible(this.voiceAudible(i)));
  }

  override allNotesOff(): void {
    super.allNotesOff();
    this.dropLeft = 0;
    this.buildLeft = 0;
  }

  // Saving ---------------------------------------------------------------------

  protected override serializeData(): unknown {
    return {
      patterns: this.patterns.map((p) => p.map((r) => r.slice())),
      scenes: this.scenes.map((s) => ({ name: s.name, lanes: s.lanes.slice() })),
      laneMap: this.laneMap.slice(),
      scene: this.sceneIndex,
      chain: this.chain,
      pattern: this.activeIndex ?? this.editIndex,
      voice: this.selectedVoice,
      samples: this.sampleRefs(),
    };
  }

  protected override restoreData(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const d = data as { patterns?: unknown; scenes?: unknown; laneMap?: unknown; scene?: unknown; chain?: unknown; pattern?: unknown; voice?: unknown; samples?: unknown };
    if (Array.isArray(d.patterns)) {
      const src = d.patterns as unknown[][][];
      this.patterns = Array.from({ length: PATTERN_COUNT }, (_, p) =>
        Array.from({ length: PAD_COUNT }, (_, l) => {
          const row = src[p]?.[l];
          return Array.from({ length: PAD_STEPS }, (_, i) => {
            const n = Array.isArray(row) ? Number(row[i]) : 0;
            return n === 2 ? 2 : n === 1 ? 1 : 0;
          });
        }),
      );
    }
    if (Array.isArray(d.scenes)) {
      const src = d.scenes as { name?: unknown; lanes?: unknown }[];
      this.scenes = Array.from({ length: SCENE_COUNT }, (_, i) => ({
        name: typeof src[i]?.name === "string" ? (src[i].name as string) : SCENE_NAMES[i],
        lanes: Array.from({ length: PAD_COUNT }, (_, l) => clampIndex(Array.isArray(src[i]?.lanes) ? (src[i].lanes as unknown[])[l] : 0, PATTERN_COUNT)),
      }));
    }
    if (Array.isArray(d.laneMap)) this.laneMap = Array.from({ length: PAD_COUNT }, (_, l) => clampIndex((d.laneMap as unknown[])[l], PATTERN_COUNT));
    else if (d.pattern !== undefined) this.laneMap.fill(clampIndex(d.pattern, PATTERN_COUNT));
    if (d.pattern !== undefined) {
      this.editIndex = clampIndex(d.pattern, PATTERN_COUNT);
      this.activeIndex = this.editIndex;
    }
    if (d.scene !== undefined) this.sceneIndex = typeof d.scene === "number" && d.scene >= 0 && d.scene < SCENE_COUNT ? d.scene : -1;
    if (typeof d.chain === "boolean") this.chain = d.chain;
    if (d.voice !== undefined) this.restoreSelected(d.voice);
    if ("samples" in d) this.restoreSamples(d.samples);
  }

  override dispose(): void {
    this.strips.forEach((s) => s.dispose());
    super.dispose();
  }
}

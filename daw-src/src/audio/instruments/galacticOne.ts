import type { NoteEvent, ParamDef, Preset } from "../types";
import { arpPick, arpPool, ARP_MODES, type HeldNote } from "./synth/arp";
import { isRecord, finiteNumber, SynthDataError } from "./synth/errors";
import { GalacticRack, type MacroAmounts, type RackSettings } from "./synth/galacticRack";
import {
  buildGalacticPresets,
  GALACTIC_KEEP_GROUPS,
  GALACTIC_PARAMS,
  MATRIX_DEST_IDS,
  MATRIX_SCALE,
  PATCH_PARAM_IDS,
  SEQ_RATE_BEATS,
  SYNC_BEATS,
  WAVE_TYPES,
} from "./synth/galacticParams";
import { ModBus } from "./synth/modbus";
import {
  DrunkWalk,
  defaultPatterns,
  emptyPattern,
  emptyStep,
  GENERATORS,
  applyEuclid,
  humanizePattern,
  mutate,
  PATTERN_LENGTHS,
  quantizePattern,
  resolveEvent,
  resolveLayer,
  reversePattern,
  seededRand,
  shiftPattern,
  MAX_STEPS,
  type GPattern,
  type GStep,
  type Rand,
  type Timeline,
} from "./synth/patternGen";
import { gridEvents, ratchetHits } from "./synth/ratchet";
import { hashRandom } from "./synth/rng";
import { midiToFreq } from "./synth/scales";
import { SynthBase } from "./synth/synthBase";
import { SynthVoice, type LaneSpec, type ModRoute, type VoiceSpec } from "./synth/voice";

export type Zone = "upper" | "lower";
export type GeneratorName = "random" | "acid" | "arp" | "bounce" | "trance" | "clear";

interface HeldKey {
  midi: number;
  vel: number;
  zone: Zone | null;
  order: number;
}

interface MonoState {
  stack: { src: string; midi: number; vel: number }[];
  voice: SynthVoice | null;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const PATCH_LETTER = ["a", "b"] as const;

function sanitiseStep(raw: unknown): GStep {
  const r = isRecord(raw) ? raw : {};
  const base = emptyStep();
  return {
    on: r.on === true,
    n: Math.round(finiteNumber(r.n, base.n, -48, 48)),
    v: finiteNumber(r.v, base.v, 0, 1),
    g: finiteNumber(r.g, base.g, 0.02, 1.2),
    p: finiteNumber(r.p, base.p, 0, 1),
    r: Math.round(finiteNumber(r.r, 1, 1, 8)),
    c: finiteNumber(r.c, 0, -1, 1),
    accent: r.accent === true,
    slide: r.slide === true,
  };
}

function sanitisePattern(raw: unknown, fallback: GPattern): GPattern {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return fallback;
  const len = (PATTERN_LENGTHS as readonly number[]).includes(raw.len as number) ? (raw.len as number) : 16;
  const steps = Array.from({ length: MAX_STEPS }, (_, i) => (raw.steps as unknown[])[i] === undefined ? emptyStep() : sanitiseStep((raw.steps as unknown[])[i]));
  return { len, steps };
}

export class GalacticOne extends SynthBase {
  readonly kind = "galacticOne" as const;
  protected override maxVoices = 14;

  private patterns: GPattern[];
  private chain: number[] = [0, 1];
  private names: [string, string] = ["Galactic Massive", "Jupiter Brass"];
  private active: number | null = 0;
  private readonly bus: ModBus;
  private readonly rack: GalacticRack;
  private readonly drunk = new DrunkWalk();
  private bpm = 120;
  private readonly held = new Map<string, HeldKey>();
  private latched: HeldKey[] = [];
  private readonly live = new Map<string, SynthVoice>();
  private readonly sustained = new Set<SynthVoice>();
  private readonly mono: [MonoState, MonoState] = [
    { stack: [], voice: null },
    { stack: [], voice: null },
  ];
  private readonly lastNote: [number | null, number | null] = [null, null];
  private pressCounter = 0;
  private noteCounter = 0;
  private arpCounter = 0;
  private lastArpEvent = -1;
  private evolveCount = 0;

  constructor(ctx: BaseAudioContext) {
    const presets = buildGalacticPresets();
    super(ctx, GALACTIC_PARAMS, presets, "galacticOne", GALACTIC_KEEP_GROUPS);
    this.patterns = defaultPatterns(Math.round(this.values["seq.scale"]));
    this.bus = new ModBus(ctx, 4);
    this.rack = new GalacticRack(ctx);
    this.rack.output.connect(this.output);
    this.applyEverything();
  }

  override get patternCount(): number {
    return this.patterns.length;
  }

  override get activePattern(): number | null {
    return this.active;
  }

  override setPattern(index: number | null): void {
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= this.patterns.length)) throw new RangeError(`Galactic One has no bank ${index}`);
    this.active = index;
    if (index === null) this.stopSequenced();
    this.bump();
  }

  // ----- pattern editing -------------------------------------------------------------------

  getPattern(bank: number): GPattern {
    return this.patterns[bank];
  }

  updateStep(bank: number, index: number, change: Partial<GStep>): void {
    this.patterns[bank].steps[index] = sanitiseStep({ ...this.patterns[bank].steps[index], ...change });
    this.bump();
  }

  setLength(bank: number, len: number): void {
    if (!(PATTERN_LENGTHS as readonly number[]).includes(len)) throw new RangeError(`Pattern length ${len} is not one of ${PATTERN_LENGTHS.join(", ")}`);
    this.patterns[bank].len = len;
    this.bump();
  }

  generate(bank: number, name: GeneratorName, rand: Rand = seededRand(Math.floor(Math.random() * 1e9))): void {
    GENERATORS[name](this.patterns[bank], this.scaleIndex, rand);
    this.bump();
  }

  euclidFill(bank: number, hits: number, rotation = 0, rand: Rand = seededRand(Math.floor(Math.random() * 1e9))): void {
    applyEuclid(this.patterns[bank], this.scaleIndex, hits, rotation, rand);
    this.bump();
  }

  mutateBank(bank: number, rand: Rand = seededRand(Math.floor(Math.random() * 1e9))): void {
    mutate(this.patterns[bank], this.scaleIndex, rand);
    this.bump();
  }

  transformBank(bank: number, op: "shiftLeft" | "shiftRight" | "reverse" | "quantize" | "humanize" | "up" | "down"): void {
    const p = this.patterns[bank];
    if (op === "shiftLeft") shiftPattern(p, -1);
    else if (op === "shiftRight") shiftPattern(p, 1);
    else if (op === "reverse") reversePattern(p);
    else if (op === "quantize") quantizePattern(p, Math.round(this.values["seq.root"]), this.scaleIndex);
    else if (op === "humanize") humanizePattern(p, seededRand(Math.floor(Math.random() * 1e9)));
    else for (const s of p.steps) s.n = clamp(s.n + (op === "up" ? 12 : -12), -24, 36);
    this.bump();
  }

  getChain(): readonly number[] {
    return this.chain;
  }

  setChain(chain: readonly number[]): void {
    if (chain.some((b) => !Number.isInteger(b) || b < 0 || b >= this.patterns.length)) throw new RangeError("The song chain names a bank that does not exist.");
    this.chain = [...chain];
    this.bump();
  }

  patchName(patch: 0 | 1): string {
    return this.names[patch];
  }

  setPatchName(patch: 0 | 1, name: string): void {
    this.names[patch] = name.slice(0, 32);
    this.bump();
  }

  copyPatch(from: 0 | 1, to: 0 | 1): void {
    if (from === to) return;
    for (const id of PATCH_PARAM_IDS) this.setValueQuiet(`${PATCH_LETTER[to]}.${id}`, this.values[`${PATCH_LETTER[from]}.${id}`]);
    this.names[to] = this.names[from];
    this.bump();
  }

  swapPatches(): void {
    for (const id of PATCH_PARAM_IDS) {
      const a = `a.${id}`;
      const b = `b.${id}`;
      const va = this.values[a];
      this.setValueQuiet(a, this.values[b]);
      this.setValueQuiet(b, va);
    }
    this.names = [this.names[1], this.names[0]];
    this.bump();
  }

  initPatch(patch: 0 | 1): void {
    for (const id of PATCH_PARAM_IDS) {
      const def = this.params.find((p) => p.id === `${PATCH_LETTER[patch]}.${id}`);
      if (def) this.setValueQuiet(def.id, def.def);
    }
    this.names[patch] = "Init";
    this.bump();
  }

  // ----- performance -----------------------------------------------------------------------

  keyOn(zone: Zone | null, midi: number, velocity: number, when = this.ctx.currentTime): void {
    const src = `${zone ?? "api"}:${midi}`;
    if (this.held.has(src)) return;
    const key: HeldKey = { midi, vel: velocity, zone, order: this.pressCounter++ };
    this.held.set(src, key);
    if (this.values["arp.latch"] === 1 && this.values["seq.mode"] === 1) {
      if (this.held.size === 1) this.latched = [];
      this.latched.push(key);
    }
    const mode = Math.round(this.values["seq.mode"]);
    const consumed = this.transportRunning && (mode === 1 || (mode === 0 && this.values["seq.follow"] === 1));
    if (consumed) return;
    for (const pi of this.targetsFor(zone, midi)) this.voiceOn(pi, src, midi, velocity, when);
  }

  keyOff(zone: Zone | null, midi: number, when = this.ctx.currentTime): void {
    const src = `${zone ?? "api"}:${midi}`;
    const key = this.held.get(src);
    if (!key) return;
    this.held.delete(src);
    for (const pi of this.targetsFor(key.zone, midi)) this.voiceOff(pi, src, when);
  }

  setBend(value: number): void {
    this.bus.glide(this.bus.bend.offset, clamp(value, -1, 1), 0.012);
  }

  setModWheel(value: number): void {
    this.bus.glide(this.bus.wheel.offset, clamp(value, 0, 1), 0.02);
  }

  override noteOn(event: NoteEvent): void {
    const velocity = event.velocity > 0 ? event.velocity : 0.85;
    if (event.duration !== undefined) {
      const when = event.time ?? this.ctx.currentTime;
      for (const pi of this.targetsFor(null, event.note)) this.makeVoice(pi, event.note, velocity, when, event.duration, {}, false);
      return;
    }
    this.keyOn(null, event.note, velocity, event.time);
  }

  override noteOff(note: number, time?: number): void {
    this.keyOff(null, note, time);
  }

  override allNotesOff(): void {
    super.allNotesOff();
    this.held.clear();
    this.latched = [];
    this.live.clear();
    this.sustained.clear();
    for (const m of this.mono) {
      m.stack = [];
      m.voice = null;
    }
  }

  override dispose(): void {
    super.dispose();
    this.bus.dispose();
    this.rack.dispose();
  }

  // ----- sequencer --------------------------------------------------------------------------

  override onStep(step: number, time: number, stepDur: number): void {
    this.markStep(stepDur);
    if (this.bpm !== 15 / stepDur) {
      this.bpm = 15 / stepDur;
      this.applyTempoDependent();
    }
    const v = this.values;
    const mode = Math.round(v["seq.mode"]);
    if (this.active === null || mode === 2) return;

    const periodSteps = SEQ_RATE_BEATS[Math.round(v["seq.rate"])] * 4;
    const period = periodSteps * stepDur;
    const timeline: Timeline = {
      patterns: this.patterns,
      active: this.active,
      chain: this.chain,
      chainOn: v["seq.chain"] === 1,
      direction: Math.round(v["seq.dir"]),
      seed: this.seed,
    };
    const layerBank = Math.round(v["seq.layer"]) - 1;
    const rootBase = (Math.round(v["seq.octave"]) + 1) * 12 + Math.round(v["seq.root"]);

    for (const { index: n, offset } of gridEvents(step, periodSteps)) {
      const swing = n % 2 === 1 ? v["seq.swing"] * period * 0.62 : 0;
      const t = time + offset * stepDur + swing;
      const r = resolveEvent(n, timeline, this.drunk);
      const layerPos = layerBank >= 0 ? resolveLayer(n, layerBank, timeline, this.drunk) : -1;
      this.mark(t, r.bank * 100 + r.pos, layerPos);
      if (n <= this.lastArpEvent) this.arpCounter = 0;
      this.lastArpEvent = n;

      const pattern = this.patterns[r.bank];
      const trans = mode === 0 && v["seq.follow"] === 1 && this.held.size > 0 ? this.lowestHeld() - rootBase : 0;
      const targets: number[] = v["seq.target"] === 2 ? [0, 1] : [Math.round(v["seq.target"])];
      this.fireStep(pattern.steps[r.pos], n, t, period, rootBase + trans, targets, mode === 1);
      if (layerBank >= 0) this.fireStep(this.patterns[layerBank].steps[layerPos], n + 500000, t, period, rootBase + trans, [1], false);
      if (r.lastOfPass && v["seq.evolve"] === 1) {
        mutate(pattern, this.scaleIndex, seededRand(this.seed + this.evolveCount++), 2);
        this.bump();
      }
    }
  }

  // ----- parameters -------------------------------------------------------------------------

  protected onParam(id: string, value: number): void {
    const dot = id.indexOf(".");
    const scope = id.slice(0, dot);
    const name = id.slice(dot + 1);
    if (scope === "a" || scope === "b") {
      const pi = scope === "a" ? 0 : 1;
      if (name.startsWith("l1") || name.startsWith("l2")) this.applyLfos();
      if (name === "cut" || name === "res" || name === "hpf") this.refreshLiveFilters(pi);
      return;
    }
    if (scope === "fx" || scope === "macro") {
      this.applyRack();
      if (scope === "macro") this.applyMacroLfo();
      return;
    }
    switch (id) {
      case "perf.voices":
        this.maxVoices = Math.round(value);
        break;
      case "perf.hold":
        if (value === 0) this.releaseSustained();
        break;
      case "arp.latch":
        if (value === 0) this.latched = [];
        break;
      case "seq.mode":
        if (value === 2) this.stopSequenced();
        break;
    }
  }

  protected override keeps(def: ParamDef, preset: Preset): boolean {
    if (super.keeps(def, preset)) return true;
    // A single-sound preset loads into patch A and leaves a hand-built patch B alone.
    return def.id.startsWith("b.") && !Object.keys(preset.values).some((k) => k.startsWith("b."));
  }

  protected override serializeData(): unknown {
    return { patterns: this.patterns, chain: this.chain, names: this.names, active: this.active, seed: this.seed };
  }

  protected override restoreData(data: unknown): void {
    if (!isRecord(data)) throw new SynthDataError("Galactic One pattern data is missing or damaged.");
    if (Array.isArray(data.patterns)) {
      const fallback = defaultPatterns(Math.round(this.values["seq.scale"]));
      this.patterns = Array.from({ length: this.patterns.length }, (_, i) => sanitisePattern((data.patterns as unknown[])[i], fallback[i] ?? emptyPattern()));
    }
    if (Array.isArray(data.chain)) this.chain = data.chain.filter((b): b is number => Number.isInteger(b) && b >= 0 && b < this.patterns.length);
    if (Array.isArray(data.names)) {
      data.names.forEach((name, i) => {
        if (typeof name === "string" && i < 2) this.names[i as 0 | 1] = name.slice(0, 32);
      });
    }
    if (data.active === null) this.active = null;
    else if (typeof data.active === "number" && data.active >= 0 && data.active < this.patterns.length) this.active = Math.floor(data.active);
    if (typeof data.seed === "number") this.seed = data.seed >>> 0;
  }

  // ----- internals --------------------------------------------------------------------------

  private get scaleIndex(): number {
    return Math.round(this.values["seq.scale"]);
  }

  private setValueQuiet(id: string, value: number): void {
    this.values[id] = value;
    this.onParam(id, value);
  }

  private P(pi: number, id: string): number {
    return this.values[`${PATCH_LETTER[pi]}.${id}`];
  }

  private lowestHeld(): number {
    let lowest = Infinity;
    for (const k of this.held.values()) lowest = Math.min(lowest, k.midi);
    return lowest;
  }

  private targetsFor(zone: Zone | null, midi: number): number[] {
    const mode = Math.round(this.values["key.mode"]);
    if (mode === 0) return [0];
    if (mode === 2) return [0, 1];
    const upper = zone ? zone === "upper" : midi >= this.values["key.split"];
    return [upper ? 1 : 0];
  }

  private applyEverything(): void {
    this.maxVoices = Math.round(this.values["perf.voices"]);
    this.applyLfos();
    this.applyMacroLfo();
    this.applyRack();
  }

  private applyTempoDependent(): void {
    this.applyLfos();
    this.applyRack();
  }

  private lfoHz(rate: number, sync: number): number {
    const beats = SYNC_BEATS[Math.round(sync)];
    return beats ? 1 / ((60 / this.bpm) * beats) : rate;
  }

  private applyLfos(): void {
    for (const pi of [0, 1]) {
      this.bus.lfos[pi * 2].set(this.P(pi, "l1shape"), this.lfoHz(this.P(pi, "l1rate"), this.P(pi, "l1sync")));
      this.bus.lfos[pi * 2 + 1].set(this.P(pi, "l2shape"), this.lfoHz(this.P(pi, "l2rate"), this.P(pi, "l2sync")));
    }
  }

  private macros(): MacroAmounts {
    return {
      bright: (this.values["macro.bright"] - 0.5) * 2,
      motion: this.values["macro.motion"],
      space: this.values["macro.space"],
      grit: this.values["macro.grit"],
    };
  }

  private applyMacroLfo(): void {
    const gain = 1 + this.macros().motion * 1.2;
    for (const lfo of this.bus.lfos) lfo.out.gain.value = gain;
  }

  private applyRack(): void {
    const f: Record<string, number> = {};
    for (const p of this.params) if (p.id.startsWith("fx.")) f[p.id.slice(3)] = this.values[p.id];
    const macros = this.macros();
    this.bus.glide(this.bus.cutoff.offset, macros.bright * 2400, 0.03);
    this.rack.apply(f as unknown as RackSettings, this.bpm, macros);
  }

  private refreshLiveFilters(pi: number): void {
    const now = this.ctx.currentTime;
    const q = -3 + this.P(pi, "res") * 26;
    for (const v of this.voices) if (v.tag === pi && v.sounding(now)) v.liveFilter(this.P(pi, "cut"), q, this.P(pi, "hpf"));
  }

  private releaseSustained(): void {
    for (const v of this.sustained) v.release(this.ctx.currentTime);
    this.sustained.clear();
  }

  private voiceOn(pi: number, src: string, midi: number, vel: number, when: number): void {
    const key = `${src}|${pi}`;
    const mode = Math.round(this.P(pi, "mode"));
    if (mode === 0) {
      this.live.get(key)?.release(when);
      this.live.set(key, this.makeVoice(pi, midi, vel, when, null, {}, false));
      return;
    }
    const m = this.mono[pi];
    m.stack = m.stack.filter((x) => x.src !== src);
    m.stack.push({ src, midi, vel });
    const glide = this.P(pi, "glide");
    const alive = m.voice !== null && !m.voice.released && !m.voice.dead;
    if (alive && m.voice && mode === 2) {
      m.voice.setNote(midi, midiToFreq(midi), glide);
    } else if (alive && m.voice) {
      const from = m.voice.midi;
      m.voice.kill(when);
      m.voice = this.makeVoice(pi, midi, vel, when, null, { from: glide > 0 ? from : null, glideT: glide }, false);
    } else {
      const last = this.lastNote[pi];
      m.voice = this.makeVoice(pi, midi, vel, when, null, { from: glide > 0 && last !== null ? last : null, glideT: glide }, false);
    }
    this.lastNote[pi] = midi;
  }

  private voiceOff(pi: number, src: string, when: number): void {
    const key = `${src}|${pi}`;
    const mode = Math.round(this.P(pi, "mode"));
    if (mode === 0) {
      const voice = this.live.get(key);
      if (!voice) return;
      this.live.delete(key);
      if (this.values["perf.hold"] === 1) this.sustained.add(voice);
      else voice.release(when);
      return;
    }
    const m = this.mono[pi];
    m.stack = m.stack.filter((x) => x.src !== src);
    const top = m.stack[m.stack.length - 1];
    if (top && m.voice && !m.voice.released && !m.voice.dead) {
      m.voice.setNote(top.midi, midiToFreq(top.midi), this.P(pi, "glide"));
    } else if (m.voice) {
      if (this.values["perf.hold"] === 1) this.sustained.add(m.voice);
      else m.voice.release(when);
      m.voice = null;
    }
  }

  private arpSource(): HeldNote[] {
    const keys = this.values["arp.latch"] === 1 ? this.latched : [...this.held.values()];
    return keys.map((k) => ({ midi: k.midi, order: k.order }));
  }

  private fireStep(st: GStep, n: number, time: number, period: number, rootBase: number, targets: number[], arp: boolean): void {
    if (!st.on) return;
    if (st.p < 1 && hashRandom(this.seed, n, 1) > st.p) return;
    const v = this.values;
    let notes: number[];
    let gate = st.g >= 0.98 ? 1.05 : st.g;
    if (arp) {
      const mode = ARP_MODES[Math.round(v["arp.mode"])].id;
      const pool = arpPool(this.arpSource(), mode, v["arp.oct"]);
      if (pool.length === 0) return;
      notes = arpPick(pool, mode, this.arpCounter++, hashRandom(this.seed, n, 31));
      gate = v["arp.gate"];
    } else {
      notes = [rootBase + st.n];
    }
    const velocity = clamp(st.v + (st.accent ? 0.22 : 0), 0.05, 1);
    const cut = clamp(st.c + (st.accent ? 0.15 : 0), -1, 1);
    const hits = ratchetHits(time, period, st.r, gate);
    for (const hit of hits) {
      for (const note of notes) {
        for (const pi of targets) {
          const from = st.slide && this.lastNote[pi] !== null ? this.lastNote[pi] : null;
          this.makeVoice(pi, note, velocity, hit.time, Math.max(0.02, hit.dur), { cut, from, glideT: 0.075 }, true);
          this.lastNote[pi] = note;
        }
      }
    }
  }

  private makeVoice(pi: number, midi: number, vel: number, when: number, duration: number | null, o: { cut?: number; from?: number | null; glideT?: number }, sequenced: boolean): SynthVoice {
    const t = Math.max(when, this.ctx.currentTime);
    const spec = this.buildSpec(pi, midi, vel, o);
    const voice = new SynthVoice(this.ctx, this.rack.input, this.bus, spec, midi, t, duration);
    voice.sequenced = sequenced;
    voice.tag = pi;
    this.track(voice);
    return voice;
  }

  private buildSpec(pi: number, midi: number, vel: number, o: { cut?: number; from?: number | null; glideT?: number }): VoiceSpec {
    const P = (id: string) => this.P(pi, id);
    const noteIndex = this.noteCounter++;
    const tune = this.values["perf.tune"];
    const freq = midiToFreq(midi);

    const base = { pitch: tune, cut: (o.cut ?? 0) * 3600, res: 0, pw: 0, amp: 0, pan: 0, o2: 0, x: 0 };
    const routes: ModRoute[] = [];
    let usesFm = false;
    for (let i = 1; i <= 4; i++) {
      const src = Math.round(P(`m${i}src`));
      const dest = Math.round(P(`m${i}dst`));
      const amount = P(`m${i}amt`);
      if (src === 0 || Math.abs(amount) < 0.005) continue;
      const destId = MATRIX_DEST_IDS[dest];
      if (destId === "x") usesFm = true;
      if (src >= 5) {
        const value = src === 5 ? vel * 2 - 1 : src === 6 ? (midi - 60) / 30 : hashRandom(this.seed, noteIndex, 3) * 2 - 1;
        base[destId] += value * amount * MATRIX_SCALE[dest];
      } else {
        const node = src === 1 ? this.bus.lfos[pi * 2].out : src === 2 ? this.bus.lfos[pi * 2 + 1].out : src === 4 ? this.bus.wheel : "env";
        routes.push({ src: node, dest: destId, amount: amount * (destId === "x" ? freq * 1.6 : MATRIX_SCALE[dest]) });
      }
    }
    const lfo1 = this.bus.lfos[pi * 2].out;
    const fade = P("l1delay");
    if (P("l1pitch") > 0.001) routes.push({ src: lfo1, dest: "pitch", amount: P("l1pitch") ** 2 * 1200, fade });
    if (P("mwvib") > 0.001) routes.push({ src: lfo1, dest: "pitch", amount: P("mwvib") ** 2 * 900, fade, scaleBy: this.bus.wheel });
    if (P("l1cut") > 0.001) routes.push({ src: lfo1, dest: "cut", amount: P("l1cut") * 3600, fade });
    if (P("l1pw") > 0.001) routes.push({ src: lfo1, dest: "pw", amount: P("l1pw") * 0.45, fade });
    if (P("l1amp") > 0.001) routes.push({ src: lfo1, dest: "amp", amount: P("l1amp") * 0.45, fade });

    const uni = Math.max(1, Math.round(P("uni")));
    const o1Ratio = 2 ** (P("o1oct") - 2);
    const o2Ratio = 2 ** (P("o2oct") - 2 + P("o2semi") / 12);
    const needSecond = P("o2lvl") > 0.001 || P("xmod") > 0.001 || P("ring") > 0.001 || usesFm;
    const lanes: LaneSpec[] = Array.from({ length: uni }, (_, u) => {
      const spread = uni === 1 ? 0 : (u / (uni - 1) * 2 - 1) * P("spread");
      const drift = () => (hashRandom(this.seed, noteIndex * 16 + u, 11) * 2 - 1) * P("drift") * 9;
      const lane: LaneSpec = {
        a: { wave: WAVE_TYPES[Math.round(P("o1wave"))], ratio: o1Ratio, cents: P("o1fine") + spread + drift() + base.pitch, level: P("o1lvl"), pw: P("o1pw") + base.pw },
        pan: uni === 1 ? 0 : clamp((u / (uni - 1) * 2 - 1) * P("width") * (u % 2 ? 1 : -1) * 0.9, -1, 1),
      };
      if (needSecond) {
        lane.b = {
          wave: WAVE_TYPES[Math.round(P("o2wave"))],
          ratio: o2Ratio,
          cents: P("o2fine") - spread * 0.8 + drift() + base.o2 + base.pitch,
          level: P("o2lvl"),
          pw: P("o2pw") + base.pw,
        };
      }
      return lane;
    });

    const gliding = o.from !== null && o.from !== undefined;
    const peak = clamp(P("vol") * (1 - P("avel") + P("avel") * vel) * (1 + clamp(base.amp, -0.9, 1)), 0, 2);
    const q = -3 + clamp(P("res") + base.res / 26, 0, 1.2) * 26;
    const subRatio = 0.5 * 2 ** Math.min(0, P("o1oct") - 2);
    return {
      freq,
      fromFreq: gliding ? midiToFreq(o.from as number) : null,
      glide: gliding ? o.glideT || 0.06 : 0,
      lanes,
      xmod: P("xmod") + (usesFm ? 0.0011 : 0),
      ring: P("ring"),
      sub: P("sub") > 0.001 ? { wave: P("subwave") >= 0.5 ? "sine" : "square", level: P("sub") * 0.5, ratio: subRatio } : null,
      noise: P("noise") > 0.001 ? { level: P("noise") * 0.45, pink: P("ncolor") >= 0.5 } : null,
      sample: null,
      filter: {
        type: "lowpass",
        cutoff: P("cut"),
        q,
        poles: P("slope") >= 0.5 ? 2 : 1,
        offsetCents: base.cut + P("key") * (midi - 60) * 100 + P("fvel") * (vel - 0.5) * 2400,
        envCents: P("fenv") * 7200,
        hp: P("hpf"),
        drive: P("drive"),
      },
      ampEnv: { a: P("aa"), d: P("ad"), s: P("as"), r: P("ar") },
      filterEnv: { a: P("fa"), d: P("fd"), s: P("fs"), r: P("fr") },
      peak,
      pan: clamp(base.pan, -1, 1),
      pitchEnvCents: P("penv") * 100,
      bendRange: P("bend"),
      wheelCutCents: P("mwcut") * 4800,
      routes,
    };
  }
}


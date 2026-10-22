import { getAssetBlob } from "../../project/db";
import { AudioEngineError, type NoteEvent, type ParamDef } from "../types";
import { arpPick, arpPool, ARP_RATES, type ArpMode, type HeldNote } from "./synth/arp";
import { isRecord, finiteNumber, SynthDataError } from "./synth/errors";
import { ModBus } from "./synth/modbus";
import { factoryPresets } from "./synth/presets";
import { gridEvents, ratchetHits } from "./synth/ratchet";
import { hashRandom } from "./synth/rng";
import { midiToFreq, NOTE_NAMES, SCALE_NAMES, scaleNote } from "./synth/scales";
import { SynthBase } from "./synth/synthBase";
import { ToneFx } from "./synth/toneFx";
import { SynthVoice, type LaneSpec, type VoiceSpec, type WaveName } from "./synth/voice";

export const LEAD_STEPS = 16;
export const LEAD_MAX_DEGREE = 8;
const LOOP_LENGTHS = [4, 8, 12, 16];
const ARP_MODE_IDS: readonly ArpMode[] = ["up", "down", "updown", "played", "random"];
const DELAY_BEATS = [0.25, 0.5, 0.75, 1, 1.5];
const STUTTER_HITS = [2, 4, 8];
const WAVES = ["Saw", "Square", "Triangle", "Sine"] as const;
const WAVE_TYPES: readonly WaveName[] = ["sawtooth", "square", "triangle", "sine"];

function layerParams(n: number, def: { on: number; wave: number; oct: number; semi: number; detune: number; level: number }): ParamDef[] {
  const group = "Layers";
  return [
    { id: `l${n}on`, label: `Layer ${n}`, group, min: 0, max: 1, def: def.on, options: ["Off", "On"] },
    { id: `l${n}wave`, label: `Layer ${n} wave`, group, min: 0, max: 3, def: def.wave, options: WAVES },
    { id: `l${n}oct`, label: `Layer ${n} octave`, group, min: -2, max: 2, step: 1, def: def.oct },
    { id: `l${n}semi`, label: `Layer ${n} semitone`, group, min: -12, max: 12, step: 1, def: def.semi, unit: "st" },
    { id: `l${n}detune`, label: `Layer ${n} detune`, group, min: -50, max: 50, step: 1, def: def.detune, unit: "ct" },
    { id: `l${n}level`, label: `Layer ${n} level`, group, min: 0, max: 1, def: def.level, unit: "%" },
  ];
}

const PARAMS: readonly ParamDef[] = [
  { id: "cutoff", label: "Cutoff", group: "Sound", min: 40, max: 16000, def: 4200, unit: "Hz" },
  { id: "resonance", label: "Resonance", group: "Sound", min: 0, max: 1, def: 0.28, unit: "%" },
  { id: "filterEnv", label: "Filter envelope", group: "Sound", min: 0, max: 1, def: 0.55, unit: "%" },
  { id: "attack", label: "Attack", group: "Sound", min: 0.001, max: 1, def: 0.008, unit: "s" },
  { id: "decay", label: "Decay", group: "Sound", min: 0.01, max: 2, def: 0.18, unit: "s" },
  { id: "sustain", label: "Sustain", group: "Sound", min: 0, max: 1, def: 0.58, unit: "%" },
  { id: "release", label: "Release", group: "Sound", min: 0.01, max: 3, def: 0.22, unit: "s" },
  { id: "pulse", label: "Pulse width", group: "Sound", min: 0.1, max: 0.9, def: 0.5, unit: "%" },
  { id: "sub", label: "Sub level", group: "Sound", min: 0, max: 1, def: 0.6, unit: "%" },
  { id: "noise", label: "Noise", group: "Sound", min: 0, max: 0.6, def: 0, unit: "%" },
  { id: "glide", label: "Glide", group: "Sound", min: 0, max: 0.5, def: 0.025, unit: "s" },
  { id: "lfoRate", label: "LFO rate", group: "Sound", min: 0.1, max: 20, def: 4.5, unit: "Hz" },
  { id: "lfoDepth", label: "LFO depth", group: "Sound", min: 0, max: 1, def: 0, unit: "%" },
  { id: "level", label: "Level", group: "Sound", min: 0, max: 1, def: 0.72, unit: "%" },
  ...layerParams(1, { on: 1, wave: 0, oct: 0, semi: 0, detune: 0, level: 0.8 }),
  ...layerParams(2, { on: 1, wave: 1, oct: -1, semi: 0, detune: -7, level: 0.34 }),
  ...layerParams(3, { on: 0, wave: 2, oct: 1, semi: 0, detune: 7, level: 0.25 }),
  { id: "sampleLevel", label: "Sample level", group: "Layers", min: 0, max: 1, def: 0.55, unit: "%" },
  { id: "sampleReverse", label: "Sample direction", group: "Layers", min: 0, max: 1, def: 0, options: ["Forward", "Reverse"] },

  { id: "root", label: "Root note", group: "Pattern", min: 0, max: 11, def: 6, options: NOTE_NAMES },
  { id: "scale", label: "Scale", group: "Pattern", min: 0, max: SCALE_NAMES.length - 1, def: 2, options: SCALE_NAMES },
  { id: "octave", label: "Pattern octave", group: "Pattern", min: 1, max: 5, step: 1, def: 3 },
  { id: "loop", label: "Loop length", group: "Pattern", min: 0, max: 3, def: 3, options: LOOP_LENGTHS.map(String) },
  { id: "patGate", label: "Pattern gate", group: "Pattern", min: 0.1, max: 1, def: 0.72, unit: "%" },

  { id: "arpOn", label: "Arpeggiator", group: "Arp", min: 0, max: 1, def: 0, options: ["Off", "On"] },
  { id: "arpLatch", label: "Latch", group: "Arp", min: 0, max: 1, def: 0, options: ["Off", "On"] },
  { id: "arpMode", label: "Pattern", group: "Arp", min: 0, max: 4, def: 0, options: ["Up", "Down", "Up and down", "As played", "Random"] },
  { id: "arpRate", label: "Rate", group: "Arp", min: 0, max: 5, def: 3, options: ARP_RATES.map((r) => r.label) },
  { id: "arpOct", label: "Range", group: "Arp", min: 1, max: 4, step: 1, def: 2, unit: "oct" },
  { id: "arpGate", label: "Gate", group: "Arp", min: 0.1, max: 1, def: 0.7, unit: "%" },
  { id: "arpSwing", label: "Swing", group: "Arp", min: 0, max: 0.5, def: 0, unit: "%" },
  { id: "hold", label: "Hold keys", group: "Arp", min: 0, max: 1, def: 0, options: ["Off", "On"] },

  { id: "chorus", label: "Chorus", group: "Effects", min: 0, max: 0.8, def: 0.08, unit: "%" },
  { id: "delay", label: "Delay", group: "Effects", min: 0, max: 0.85, def: 0.12, unit: "%" },
  { id: "delayTime", label: "Delay time", group: "Effects", min: 0, max: 4, def: 1, options: ["1/16", "1/8", "3/16", "1/4", "3/8"] },
  { id: "delayFb", label: "Delay feedback", group: "Effects", min: 0, max: 0.88, def: 0.24, unit: "%" },
  { id: "reverb", label: "Reverb", group: "Effects", min: 0, max: 0.8, def: 0.12, unit: "%" },
  { id: "drive", label: "Drive", group: "Effects", min: 0, max: 1, def: 0.12, unit: "%" },
  { id: "crush", label: "Bit crush", group: "Effects", min: 0, max: 1, def: 0, unit: "%" },

  { id: "glitchChance", label: "Chance", group: "Glitch", min: 0, max: 1, def: 0, unit: "%" },
  { id: "glitchSize", label: "Stutter size", group: "Glitch", min: 0, max: 2, def: 0, options: ["1/32", "1/64", "1/128"] },
  { id: "tapeStop", label: "Tape stop", group: "Glitch", min: 0, max: 1, def: 0, unit: "%" },
];

const PRESETS = factoryPresets("lead", [
  ["Neon Arp", "Lead", { cutoff: 2400, resonance: 0.3, filterEnv: 0.6, attack: 0.004, decay: 0.32, sustain: 0.55, release: 0.42, chorus: 0.34, delay: 0.26, reverb: 0.4, drive: 0.12, l2level: 0.52 }],
  ["Glass Pluck", "Pluck", { cutoff: 5200, filterEnv: 0.8, attack: 0.002, decay: 0.16, sustain: 0.1, release: 0.3, sub: 0.2, l1wave: 2, l2on: 0, l3on: 1, l3level: 0.5, l3oct: 1, chorus: 0.2, delay: 0.3, delayFb: 0.38, reverb: 0.3, drive: 0 }],
  ["Heat Haze", "Pad", { cutoff: 1800, resonance: 0.2, filterEnv: 0.25, attack: 0.55, decay: 0.8, sustain: 0.85, release: 1.4, sub: 0.3, l2wave: 0, l2oct: 0, l2detune: -11, l2level: 0.7, l3on: 1, l3wave: 0, l3oct: 0, l3detune: 12, l3level: 0.6, chorus: 0.6, delay: 0.2, reverb: 0.55, lfoDepth: 0.2, lfoRate: 0.4 }],
  ["Saw Choir", "Lead", { cutoff: 3400, resonance: 0.3, filterEnv: 0.35, attack: 0.03, decay: 0.4, sustain: 0.8, release: 0.6, l2wave: 0, l2oct: 0, l2detune: -14, l2level: 0.7, l3on: 1, l3wave: 0, l3oct: 0, l3detune: 14, l3level: 0.7, chorus: 0.55, delay: 0.18, reverb: 0.35 }],
  ["Bit Bell", "Bell", { cutoff: 9000, resonance: 0.1, filterEnv: 0.2, attack: 0.002, decay: 0.9, sustain: 0, release: 1.1, sub: 0, l1wave: 3, l2wave: 3, l2oct: 2, l2semi: 7, l2level: 0.35, l2detune: 0, delay: 0.3, delayFb: 0.4, reverb: 0.45, crush: 0.45, drive: 0 }],
  ["Dusk Bass", "Bass", { cutoff: 700, resonance: 0.35, filterEnv: 0.7, attack: 0.003, decay: 0.24, sustain: 0.4, release: 0.15, sub: 0.9, glide: 0.06, l1oct: -1, l2oct: -1, l2level: 0.5, chorus: 0, delay: 0.05, reverb: 0.05, drive: 0.4 }],
  ["Acid Rain", "Lead", { cutoff: 900, resonance: 0.7, filterEnv: 0.9, attack: 0.002, decay: 0.2, sustain: 0.25, release: 0.2, sub: 0.2, l2on: 0, glide: 0.08, delay: 0.3, delayFb: 0.4, reverb: 0.15, drive: 0.5, lfoDepth: 0.15 }],
  ["Hollow Wind", "Pad", { cutoff: 1200, resonance: 0.45, filterEnv: 0.15, attack: 0.9, decay: 1, sustain: 0.8, release: 2, noise: 0.18, sub: 0, l1wave: 2, l2wave: 3, l2oct: 0, l2level: 0.6, chorus: 0.4, reverb: 0.7, delay: 0.25, lfoDepth: 0.45, lfoRate: 0.3 }],
]);

export type SampleStatus = "none" | "loading" | "ready" | "error";

function defaultSteps(): number[] {
  return [1, 3, 5, 3, 6, 3, 5, 2, 1, 3, 5, 7, 8, 5, 3, 2];
}

export class Lead0010110 extends SynthBase {
  readonly kind = "lead0010110" as const;
  protected override maxVoices = 8;

  private steps: number[] = defaultSteps();
  private accents: boolean[] = Array.from({ length: LEAD_STEPS }, (_, i) => i % 4 === 0);
  private active: number | null = 0;
  private readonly fx: ToneFx;
  private readonly bus: ModBus;
  private bpm = 120;
  private physical = new Map<number, number>();
  private latched: HeldNote[] = [];
  private liveVoices = new Map<number, SynthVoice>();
  private sustained = new Set<SynthVoice>();
  private pressCounter = 0;
  private lastFreq: number | null = null;

  private sample: AudioBuffer | null = null;
  private reversed: AudioBuffer | null = null;
  private sampleAssetId: string | null = null;
  private sampleName = "";
  private status: SampleStatus = "none";
  private statusError = "";

  constructor(ctx: BaseAudioContext) {
    super(ctx, PARAMS, PRESETS, "lead0010110", new Set(["Arp", "Pattern", "Glitch"]));
    this.bus = new ModBus(ctx, 1);
    this.fx = new ToneFx(ctx);
    this.fx.output.connect(this.output);
    for (const p of this.params) this.onParam(p.id, this.values[p.id]);
  }

  override get patternCount(): number {
    return 1;
  }

  override get activePattern(): number | null {
    return this.active;
  }

  override setPattern(index: number | null): void {
    if (index !== null && index !== 0) throw new RangeError(`0010110 has one pattern, not ${index}`);
    this.active = index;
    if (index === null) this.stopSequenced();
    this.bump();
  }

  get loopLength(): number {
    return LOOP_LENGTHS[Math.round(this.values.loop)];
  }

  getDegrees(): readonly number[] {
    return this.steps;
  }

  getAccents(): readonly boolean[] {
    return this.accents;
  }

  /** 0 turns the step off; 1..8 are scale degrees. */
  setDegree(step: number, degree: number): void {
    this.steps[step] = Math.max(0, Math.min(LEAD_MAX_DEGREE, Math.round(degree)));
    this.bump();
  }

  toggleAccent(step: number): void {
    this.accents[step] = !this.accents[step];
    this.bump();
  }

  clearSteps(): void {
    this.steps = this.steps.map(() => 0);
    this.accents = this.accents.map(() => false);
    this.bump();
  }

  randomise(rand: () => number = Math.random): void {
    this.steps = this.steps.map((_, i) => (rand() < (i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.7 : 0.5) ? 1 + Math.floor(rand() * LEAD_MAX_DEGREE) : 0));
    this.accents = this.accents.map(() => rand() < 0.2);
    this.bump();
  }

  get sampleInfo(): { status: SampleStatus; name: string; error: string; assetId: string | null } {
    return { status: this.status, name: this.sampleName, error: this.statusError, assetId: this.sampleAssetId };
  }

  get sampleBuffer(): AudioBuffer | null {
    return this.sample;
  }

  /** Installs decoded audio as the sample layer. `assetId` is what a saved project stores to find the file again. */
  setSample(buffer: AudioBuffer, assetId: string, name: string): void {
    this.sample = buffer;
    this.reversed = null;
    this.sampleAssetId = assetId;
    this.sampleName = name;
    this.status = "ready";
    this.statusError = "";
    this.bump();
  }

  clearSample(): void {
    this.sample = null;
    this.reversed = null;
    this.sampleAssetId = null;
    this.sampleName = "";
    this.status = "none";
    this.statusError = "";
    this.bump();
  }

  override onStep(step: number, time: number, stepDur: number): void {
    this.markStep(stepDur);
    if (this.bpm !== 15 / stepDur) {
      this.bpm = 15 / stepDur;
      this.applyDelay();
    }
    const v = this.values;
    if (v.arpOn === 1) {
      const pool = this.arpPoolNow();
      if (pool.length > 0) {
        this.arpStep(pool, step, time, stepDur);
        return;
      }
    }
    if (this.active === null) return;
    const ix = step % this.loopLength;
    this.mark(time, ix);
    const degree = this.steps[ix];
    if (degree === 0) return;
    const root = (Math.round(v.octave) + 1) * 12 + Math.round(v.root);
    const note = scaleNote(root, Math.round(v.scale), degree - 1);
    this.playWithGlitch(note, this.accents[ix] ? 1 : 0.82, step, time, stepDur, stepDur * v.patGate, true);
  }

  override noteOn(event: NoteEvent): void {
    const velocity = event.velocity > 0 ? event.velocity : 0.85;
    const when = event.time ?? this.ctx.currentTime;
    if (event.duration !== undefined) {
      this.makeVoice(event.note, velocity, when, event.duration, false);
      return;
    }
    const v = this.values;
    if (v.arpLatch === 1 && v.arpOn === 1 && this.physical.size === 0) this.latched = [];
    this.physical.set(event.note, this.pressCounter);
    const held = { midi: event.note, order: this.pressCounter++ };
    if (v.arpLatch === 1 && v.arpOn === 1) this.latched.push(held);
    if (v.arpOn === 1 && this.transportRunning) return;
    this.liveVoices.get(event.note)?.release(when);
    this.liveVoices.set(event.note, this.makeVoice(event.note, velocity, when, null, false));
  }

  override noteOff(note: number, time?: number): void {
    this.physical.delete(note);
    const voice = this.liveVoices.get(note);
    if (!voice) return;
    this.liveVoices.delete(note);
    if (this.values.hold === 1) this.sustained.add(voice);
    else voice.release(time ?? this.ctx.currentTime);
  }

  override allNotesOff(): void {
    super.allNotesOff();
    this.physical.clear();
    this.latched = [];
    this.liveVoices.clear();
    this.sustained.clear();
  }

  override dispose(): void {
    super.dispose();
    this.bus.dispose();
    this.fx.dispose();
  }

  protected onParam(id: string, value: number): void {
    const v = this.values;
    switch (id) {
      case "level":
        this.output.gain.value = value;
        break;
      case "drive":
      case "crush":
        this.fx.setDrive(v.drive, v.crush);
        break;
      case "delay":
      case "delayFb":
      case "delayTime":
        this.applyDelay();
        break;
      case "reverb":
        this.fx.setReverb(value);
        break;
      case "chorus":
        this.fx.setStereo(value);
        break;
      case "lfoRate":
        this.bus.lfos[0].set(0, value);
        break;
      case "hold":
        if (value === 0) {
          for (const voice of this.sustained) voice.release(this.ctx.currentTime);
          this.sustained.clear();
        }
        break;
      case "arpLatch":
        if (value === 0) this.latched = [];
        break;
      case "arpOn":
        if (value === 0) this.latched = [];
        break;
    }
  }

  protected override serializeData(): unknown {
    return {
      steps: this.steps,
      accents: this.accents,
      active: this.active,
      seed: this.seed,
      sample: this.sampleAssetId ? { assetId: this.sampleAssetId, name: this.sampleName } : null,
    };
  }

  protected override restoreData(data: unknown): void {
    if (!isRecord(data)) throw new SynthDataError("0010110 pattern data is missing or damaged.");
    if (Array.isArray(data.steps)) this.steps = Array.from({ length: LEAD_STEPS }, (_, i) => Math.round(finiteNumber(data.steps instanceof Array ? data.steps[i] : 0, 0, 0, LEAD_MAX_DEGREE)));
    if (Array.isArray(data.accents)) this.accents = Array.from({ length: LEAD_STEPS }, (_, i) => (data.accents as unknown[])[i] === true);
    if (data.active === null) this.active = null;
    else if (data.active === 0) this.active = 0;
    if (typeof data.seed === "number") this.seed = data.seed >>> 0;
    if (isRecord(data.sample) && typeof data.sample.assetId === "string") {
      const assetId = data.sample.assetId;
      const name = typeof data.sample.name === "string" ? data.sample.name : "Sample";
      if (assetId !== this.sampleAssetId) void this.loadSampleAsset(assetId, name);
    } else if (data.sample === null && this.sampleAssetId !== null) {
      this.clearSample();
    }
  }

  private async loadSampleAsset(assetId: string, name: string): Promise<void> {
    this.sampleAssetId = assetId;
    this.sampleName = name;
    this.status = "loading";
    this.statusError = "";
    this.bump();
    try {
      const blob = await getAssetBlob(assetId);
      if (!blob) throw new AudioEngineError(`The sample "${name}" is no longer in this browser's storage.`);
      const decoded = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      if (this.sampleAssetId !== assetId) return;
      this.sample = decoded;
      this.reversed = null;
      this.status = "ready";
    } catch (error) {
      this.sample = null;
      this.status = "error";
      this.statusError = error instanceof Error ? error.message : "The sample could not be loaded.";
    }
    this.bump();
  }

  private applyDelay(): void {
    const v = this.values;
    this.fx.setDelay(DELAY_BEATS[Math.round(v.delayTime)] * (60 / this.bpm), v.delayFb, v.delay);
  }

  private arpPoolNow(): number[] {
    const v = this.values;
    const source: HeldNote[] = v.arpLatch === 1 ? this.latched : [...this.physical].map(([midi, order]) => ({ midi, order }));
    return arpPool(source, ARP_MODE_IDS[Math.round(v.arpMode)], v.arpOct);
  }

  private arpStep(pool: number[], step: number, time: number, stepDur: number): void {
    const v = this.values;
    const mode = ARP_MODE_IDS[Math.round(v.arpMode)];
    const period = ARP_RATES[Math.round(v.arpRate)].beats * 4;
    for (const { index, offset } of gridEvents(step, period)) {
      const swing = index % 2 === 1 ? period * stepDur * v.arpSwing : 0;
      const picked = arpPick(pool, mode, index, hashRandom(this.seed, index, 31));
      for (const note of picked) {
        this.playWithGlitch(note, 0.85, -(index + 1), time + offset * stepDur + swing, period * stepDur, period * stepDur * v.arpGate, true);
      }
    }
  }

  private playWithGlitch(note: number, velocity: number, key: number, time: number, period: number, gateSeconds: number, sequenced: boolean): void {
    const v = this.values;
    if (v.glitchChance > 0 && hashRandom(this.seed, key, 41) < v.glitchChance) {
      const hits = ratchetHits(time, period, STUTTER_HITS[Math.round(v.glitchSize)], 0.7);
      for (const h of hits) this.makeVoice(note, velocity, h.time, Math.max(0.02, h.dur), sequenced);
      if (v.tapeStop > 0) {
        const dive = this.bus.tape.offset;
        dive.setValueAtTime(0, time);
        dive.linearRampToValueAtTime(-v.tapeStop * 4800, time + period * 0.95);
        dive.setValueAtTime(0, time + period);
      }
      return;
    }
    this.makeVoice(note, velocity, time, Math.max(0.03, gateSeconds), sequenced);
  }

  private makeVoice(note: number, velocity: number, when: number, duration: number | null, sequenced: boolean): SynthVoice {
    const v = this.values;
    const t = Math.max(when, this.ctx.currentTime);
    const freq = midiToFreq(note);
    const lanes: LaneSpec[] = [];
    for (let n = 1; n <= 3; n++) {
      if (v[`l${n}on`] !== 1) continue;
      const waveIndex = Math.round(v[`l${n}wave`]);
      const usePulse = n === 1 && WAVE_TYPES[waveIndex] === "square" && Math.abs(v.pulse - 0.5) > 0.01;
      lanes.push({
        a: {
          wave: usePulse ? "pulse" : WAVE_TYPES[waveIndex],
          ratio: 2 ** (v[`l${n}oct`] + v[`l${n}semi`] / 12),
          cents: v[`l${n}detune`],
          level: v[`l${n}level`] * velocity,
          pw: v.pulse,
        },
        pan: n === 1 ? 0 : n === 2 ? -0.25 : 0.25,
      });
    }
    if (lanes.length === 0) lanes.push({ a: { wave: WAVE_TYPES[0], ratio: 1, cents: 0, level: velocity, pw: 0.5 }, pan: 0 });

    const sampleBuffer = this.currentSample();
    const q = v.resonance * 18;
    const spec: VoiceSpec = {
      freq,
      fromFreq: v.glide > 0 && this.lastFreq !== null ? this.lastFreq : null,
      glide: v.glide,
      lanes,
      xmod: 0,
      ring: 0,
      sub: v.sub > 0.001 ? { wave: "sine", level: velocity * v.sub * 0.45, ratio: 0.5 } : null,
      noise: v.noise > 0.001 ? { level: v.noise * velocity * 0.2, pink: false } : null,
      sample: sampleBuffer && v.sampleLevel > 0.001 ? { buffer: sampleBuffer, rate: 2 ** ((note - 60) / 12), level: velocity * v.sampleLevel * 0.55 } : null,
      filter: {
        type: "lowpass",
        cutoff: v.cutoff,
        q,
        poles: 2,
        offsetCents: 0,
        envCents: 1200 * Math.log2(1 + v.filterEnv * 2),
        hp: 0,
        drive: 0,
      },
      ampEnv: { a: v.attack, d: v.decay, s: v.sustain, r: v.release },
      filterEnv: { a: 0.001, d: Math.max(0.03, v.decay), s: 0, r: v.release },
      peak: 0.8 / (1 + q * 0.03),
      pan: 0,
      pitchEnvCents: 0,
      bendRange: 2,
      wheelCutCents: 0,
      routes:
        v.lfoDepth > 0.001
          ? [
              { src: this.bus.lfos[0].out, dest: "cut", amount: v.lfoDepth * 1800 },
              { src: this.bus.lfos[0].out, dest: "pitch", amount: v.lfoDepth * 25 },
            ]
          : [],
    };
    const voice = new SynthVoice(this.ctx, this.fx.input, this.bus, spec, note, t, duration);
    voice.sequenced = sequenced;
    this.lastFreq = freq;
    this.track(voice);
    return voice;
  }

  private currentSample(): AudioBuffer | null {
    if (!this.sample) return null;
    if (this.values.sampleReverse !== 1) return this.sample;
    if (!this.reversed) {
      const src = this.sample;
      const out = this.ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
      for (let c = 0; c < src.numberOfChannels; c++) out.getChannelData(c).set(src.getChannelData(c).slice().reverse());
      this.reversed = out;
    }
    return this.reversed;
  }
}

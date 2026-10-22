import type { NoteEvent, ParamDef } from "../types";
import { gridEvents } from "./synth/ratchet";
import { hashRandom } from "./synth/rng";
import { midiToFreq, scaleNote, scaleNotesInRange } from "./synth/scales";
import { arpPick, arpPool, ARP_RATES, type ArpMode, type HeldNote } from "./synth/arp";
import { isRecord, finiteNumber, SynthDataError } from "./synth/errors";
import { factoryPresets } from "./synth/presets";
import { SynthBase } from "./synth/synthBase";
import { ModBus } from "./synth/modbus";
import { ToneFx } from "./synth/toneFx";
import { SynthVoice, type VoiceSpec, type WaveName } from "./synth/voice";

export interface AcidStep {
  on: boolean;
  /** MIDI note before the octave shift. */
  note: number;
  /** -1, 0 or +1 octave shown beside the note. */
  oct: -1 | 0 | 1;
  accent: boolean;
  slide: boolean;
}

export const ACID_STEPS = 16;
export const ACID_PATTERNS = 4;
const ARP_MODE_IDS: readonly ArpMode[] = ["up", "down", "updown", "played", "random"];
const DELAY_BEATS = [0.25, 0.5, 0.75, 1, 1.5];

const PARAMS: readonly ParamDef[] = [
  { id: "wave", label: "Wave", group: "Sound", min: 0, max: 2, def: 0, options: ["Saw", "Square", "Triangle"] },
  { id: "octave", label: "Octave", group: "Sound", min: 0, max: 2, def: 1, options: ["-1", "0", "+1"] },
  { id: "tune", label: "Tune", group: "Sound", min: -12, max: 12, step: 1, def: 0, unit: "st" },
  { id: "cutoff", label: "Cutoff", group: "Sound", min: 80, max: 12000, def: 900, unit: "Hz" },
  { id: "resonance", label: "Resonance", group: "Sound", min: 0, max: 1, def: 0.52, unit: "%" },
  { id: "envMod", label: "Envelope amount", group: "Sound", min: 0, max: 1, def: 0.72, unit: "%" },
  { id: "decay", label: "Decay", group: "Sound", min: 50, max: 1500, def: 220, unit: "ms" },
  { id: "accent", label: "Accent strength", group: "Sound", min: 0, max: 1, def: 0.7, unit: "%" },
  { id: "attack", label: "Attack", group: "Sound", min: 1, max: 150, def: 4, unit: "ms" },
  { id: "filterMode", label: "Filter", group: "Sound", min: 0, max: 2, def: 0, options: ["Low-pass", "Band-pass", "High-pass"] },
  { id: "sub", label: "Sub level", group: "Sound", min: 0, max: 1, def: 0.24, unit: "%" },
  { id: "subWave", label: "Sub wave", group: "Sound", min: 0, max: 2, def: 0, options: ["Square", "Sine", "Triangle"] },
  { id: "level", label: "Level", group: "Sound", min: 0, max: 1, def: 0.68, unit: "%" },

  { id: "drive", label: "Drive", group: "Effects", min: 0, max: 1, def: 0.55, unit: "%" },
  { id: "crush", label: "Bit reduction", group: "Effects", min: 0, max: 1, def: 0, unit: "%" },
  { id: "delay", label: "Delay", group: "Effects", min: 0, max: 0.75, def: 0.14, unit: "%" },
  { id: "delayTime", label: "Delay time", group: "Effects", min: 0, max: 4, def: 2, options: ["1/16", "1/8", "3/16", "1/4", "3/8"] },
  { id: "delayFb", label: "Delay feedback", group: "Effects", min: 0, max: 0.78, def: 0.28, unit: "%" },
  { id: "reverb", label: "Reverb", group: "Effects", min: 0, max: 0.65, def: 0.12, unit: "%" },
  { id: "fxMix", label: "Effects amount", group: "Effects", min: 0, max: 1, def: 0.28, unit: "%" },
  { id: "fxFilter", label: "Effects low-pass", group: "Effects", min: 500, max: 18000, def: 12000, unit: "Hz" },
  { id: "width", label: "Stereo width", group: "Effects", min: 0, max: 1, def: 0.22, unit: "%" },

  { id: "swing", label: "Swing", group: "Feel", min: 0, max: 0.6, def: 0.08, unit: "%" },
  { id: "slideTime", label: "Slide time", group: "Feel", min: 0, max: 350, def: 90, unit: "ms" },
  { id: "gate", label: "Gate length", group: "Feel", min: 0.15, max: 1.4, def: 0.72, unit: "%" },
  { id: "humanise", label: "Humanise", group: "Feel", min: 0, max: 1, def: 0.1, unit: "%" },
  { id: "chance", label: "Chance", group: "Feel", min: 0.1, max: 1, def: 1, unit: "%" },

  { id: "arpOn", label: "Arpeggiator", group: "Arp", min: 0, max: 1, def: 0, options: ["Off", "On"] },
  { id: "arpMode", label: "Pattern", group: "Arp", min: 0, max: 4, def: 0, options: ["Up", "Down", "Up and down", "As played", "Random"] },
  { id: "arpRate", label: "Rate", group: "Arp", min: 0, max: 5, def: 3, options: ARP_RATES.map((r) => r.label) },
  { id: "arpOct", label: "Octaves", group: "Arp", min: 1, max: 4, step: 1, def: 2 },
  { id: "arpGate", label: "Arp gate", group: "Arp", min: 0.15, max: 1, def: 0.72, unit: "%" },
];

export const PRESETS = factoryPresets("acid", [
  ["Squelch Machine", "Acid", {}],
  ["Rubber Sub", "Bass", { cutoff: 420, resonance: 0.3, envMod: 0.35, decay: 380, sub: 0.6, subWave: 1, drive: 0.25, delay: 0.04, reverb: 0.04, accent: 0.4 }],
  ["Devil Walk", "Acid", { wave: 1, cutoff: 1400, resonance: 0.8, envMod: 0.9, decay: 160, accent: 1, drive: 0.7, delay: 0.22, delayFb: 0.4, slideTime: 130 }],
  ["Chrome Pluck", "Lead", { octave: 2, cutoff: 2600, resonance: 0.45, envMod: 0.6, decay: 120, sub: 0, drive: 0.2, delay: 0.3, delayTime: 1, delayFb: 0.38, reverb: 0.22, gate: 0.4 }],
  ["Mud Pulse", "Bass", { wave: 1, cutoff: 300, resonance: 0.2, envMod: 0.3, decay: 260, sub: 0.7, subWave: 2, drive: 0.5, delay: 0, reverb: 0, gate: 0.9, swing: 0 }],
  ["Laser Spit", "FX", { cutoff: 3200, resonance: 0.9, envMod: 1, decay: 90, accent: 0.9, filterMode: 1, drive: 0.4, crush: 0.35, delay: 0.4, delayTime: 3, delayFb: 0.55, reverb: 0.3, width: 0.5 }],
  ["Rave Stab", "Lead", { wave: 1, octave: 2, cutoff: 1800, resonance: 0.55, envMod: 0.8, decay: 180, sub: 0.1, drive: 0.35, delay: 0.25, reverb: 0.2, gate: 0.5, width: 0.4 }],
  ["Dub Sub", "Bass", { wave: 2, octave: 0, cutoff: 260, resonance: 0.15, envMod: 0.2, decay: 500, sub: 0.8, subWave: 1, drive: 0.1, delay: 0.35, delayTime: 3, delayFb: 0.5, reverb: 0.25, gate: 1, slideTime: 160 }],
]);

function defaultPattern(index: number): AcidStep[] {
  const notes = [36, 36, 43, 36, 39, 36, 46, 34, 36, 36, 41, 36, 39, 43, 34, 36];
  return Array.from({ length: ACID_STEPS }, (_, i) => {
    const on =
      index === 0 ? i % 4 === 0 || i % 4 === 2 || i === 7 || i === 11
      : index === 1 ? i % 2 === 0 || i === 7 || i === 15
      : index === 2 ? i % 4 === 0 || i === 5 || i === 10
      : hashRandom(4242, i) > 0.52;
    return { on, note: notes[i], oct: 0, accent: [0, 4, 7, 11, 15].includes(i), slide: [3, 7, 11, 14].includes(i) };
  });
}

function sanitiseStep(raw: unknown): AcidStep {
  const r = isRecord(raw) ? raw : {};
  const oct = finiteNumber(r.oct, 0, -1, 1);
  return {
    on: r.on === true,
    note: Math.round(finiteNumber(r.note, 36, 0, 127)),
    oct: (oct < 0 ? -1 : oct > 0 ? 1 : 0) as -1 | 0 | 1,
    accent: r.accent === true,
    slide: r.slide === true,
  };
}

export class Acid30lee extends SynthBase {
  readonly kind = "acid30lee" as const;
  protected override maxVoices = 3;

  private patterns: AcidStep[][] = Array.from({ length: ACID_PATTERNS }, (_, i) => defaultPattern(i));
  private active: number | null = 0;
  private readonly fx: ToneFx;
  private readonly bus: ModBus;
  private bpm = 120;
  private heldNotes: HeldNote[] = [];
  private heldVoice: SynthVoice | null = null;
  private lastFreq: number | null = null;
  private pressCounter = 0;
  private freezing = false;

  constructor(ctx: BaseAudioContext) {
    super(ctx, PARAMS, PRESETS, "acid30lee", new Set(["Arp"]));
    this.bus = new ModBus(ctx, 0);
    this.fx = new ToneFx(ctx);
    this.fx.output.connect(this.output);
    this.applyAll();
  }

  override get patternCount(): number {
    return ACID_PATTERNS;
  }

  override get activePattern(): number | null {
    return this.active;
  }

  override setPattern(index: number | null): void {
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= ACID_PATTERNS)) throw new RangeError(`30LEE has no pattern ${index}`);
    this.active = index;
    if (index === null) this.stopSequenced();
    this.bump();
  }

  getStep(pattern: number, step: number): AcidStep {
    return this.patterns[pattern][step];
  }

  setStep(pattern: number, step: number, change: Partial<AcidStep>): void {
    this.patterns[pattern][step] = sanitiseStep({ ...this.patterns[pattern][step], ...change });
    this.bump();
  }

  clearPattern(pattern: number): void {
    this.patterns[pattern] = this.patterns[pattern].map((s) => ({ ...s, on: false, accent: false, slide: false }));
    this.bump();
  }

  /** Fills a pattern with a new acid line in a scale; `rand` defaults to Math.random since this is an edit, not playback. */
  randomise(pattern: number, scale = 2, rand: () => number = Math.random): void {
    const pool = scaleNotesInRange(0, scale, 34, 50);
    this.patterns[pattern] = this.patterns[pattern].map((_, i) => {
      const jump = rand() < 0.16;
      return {
        on: rand() < ([0, 4, 8, 12].includes(i) ? 0.95 : 0.58),
        note: pool[Math.floor(rand() * pool.length)] ?? scaleNote(36, scale, 0),
        oct: jump ? 1 : 0,
        accent: rand() < 0.24,
        slide: rand() < 0.22,
      };
    });
    this.bump();
  }

  shiftPattern(pattern: number, direction: 1 | -1): void {
    const steps = this.patterns[pattern];
    this.patterns[pattern] = steps.map((_, i) => steps[(i + direction + ACID_STEPS) % ACID_STEPS]);
    this.bump();
  }

  /** Holds the filter closed while true and sweeps it back open on release, unlike the old one-way freeze. */
  setFreeze(on: boolean): void {
    this.freezing = on;
    this.bus.glide(this.bus.cutoff.offset, on ? -2400 : 0, on ? 0.25 : 0.4);
  }

  get frozen(): boolean {
    return this.freezing;
  }

  override onStep(step: number, time: number, stepDur: number): void {
    this.markStep(stepDur);
    if (this.bpm !== 15 / stepDur) {
      this.bpm = 15 / stepDur;
      this.applyDelay();
    }
    if (this.values.arpOn === 1) {
      this.arpStep(step, time, stepDur);
      return;
    }
    if (this.active === null) return;
    const pattern = this.patterns[this.active];
    const ix = step % ACID_STEPS;
    const st = pattern[ix];
    this.mark(time, ix);
    if (!st.on) return;
    if (hashRandom(this.seed, step, 17) > this.values.chance) return;

    const v = this.values;
    const swing = ix % 2 === 1 ? stepDur * v.swing : 0;
    const jitter = (hashRandom(this.seed, step, 23) - 0.5) * 2 * v.humanise;
    const when = time + swing + jitter * stepDur * 0.18;
    const nextSlides = this.nextActiveSlides(pattern, ix);
    // A tied note runs a little past its step so the slide into the next one never leaves a gap.
    const dur = nextSlides ? stepDur * 1.04 : Math.max(0.035, stepDur * v.gate);
    const vel = Math.min(1, Math.max(0.3, 0.9 + jitter * 0.12));
    this.playNote(st.note + st.oct * 12, vel, when, dur, st.accent, st.slide);
  }

  override noteOn(event: NoteEvent): void {
    const velocity = event.velocity > 0 ? event.velocity : 0.8;
    const when = event.time ?? this.ctx.currentTime;
    if (event.duration !== undefined) {
      this.playNote(event.note, velocity, when, event.duration, false, false);
      return;
    }
    this.heldNotes = this.heldNotes.filter((h) => h.midi !== event.note);
    this.heldNotes.push({ midi: event.note, order: this.pressCounter++ });
    if (this.values.arpOn === 1 && this.transportRunning) return;
    this.heldVoice = this.playNote(event.note, velocity, when, null, velocity > 0.9, this.heldVoice !== null && this.heldVoice.sounding(when));
  }

  override noteOff(note: number, time?: number): void {
    this.heldNotes = this.heldNotes.filter((h) => h.midi !== note);
    if (this.heldVoice && this.heldVoice.midi === note) {
      this.heldVoice.release(time ?? this.ctx.currentTime);
      this.heldVoice = null;
    }
  }

  override allNotesOff(): void {
    super.allNotesOff();
    this.heldNotes = [];
    this.heldVoice = null;
  }

  override dispose(): void {
    super.dispose();
    this.bus.dispose();
    this.fx.dispose();
  }

  protected onParam(id: string, value: number): void {
    switch (id) {
      case "level":
        this.output.gain.value = value;
        break;
      case "drive":
      case "crush":
        this.fx.setDrive(this.values.drive, this.values.crush);
        break;
      case "delay":
      case "delayFb":
      case "delayTime":
      case "reverb":
      case "fxMix":
        this.applyDelay();
        this.fx.setReverb(this.values.reverb * this.values.fxMix);
        break;
      case "fxFilter":
        this.fx.setTone(value, 0.7);
        break;
      case "width":
        this.fx.setStereo(value * 0.8);
        break;
      case "arpOn":
        if (value === 0) this.stopSequenced();
        break;
    }
  }

  protected override serializeData(): unknown {
    return { patterns: this.patterns, active: this.active, seed: this.seed };
  }

  protected override restoreData(data: unknown): void {
    if (!isRecord(data)) throw new SynthDataError("30LEE patterns are missing or damaged.");
    if (Array.isArray(data.patterns)) {
      this.patterns = Array.from({ length: ACID_PATTERNS }, (_, p) => {
        const raw = (data.patterns as unknown[])[p];
        const fallback = defaultPattern(p);
        return Array.from({ length: ACID_STEPS }, (_, i) => (Array.isArray(raw) && raw[i] !== undefined ? sanitiseStep(raw[i]) : fallback[i]));
      });
    }
    if (data.active === null) this.active = null;
    else if (typeof data.active === "number" && data.active >= 0 && data.active < ACID_PATTERNS) this.active = Math.floor(data.active);
    if (typeof data.seed === "number") this.seed = data.seed >>> 0;
  }

  private applyAll(): void {
    for (const p of this.params) this.onParam(p.id, this.values[p.id]);
  }

  private applyDelay(): void {
    const v = this.values;
    const seconds = DELAY_BEATS[Math.round(v.delayTime)] * (60 / this.bpm);
    this.fx.setDelay(seconds, v.delayFb, v.delay * v.fxMix);
  }

  private nextActiveSlides(pattern: AcidStep[], ix: number): boolean {
    const next = pattern[(ix + 1) % ACID_STEPS];
    return next.on && next.slide;
  }

  private arpStep(step: number, time: number, stepDur: number): void {
    const v = this.values;
    const mode = ARP_MODE_IDS[Math.round(v.arpMode)];
    const period = ARP_RATES[Math.round(v.arpRate)].beats * 4;
    let held = this.heldNotes;
    if (held.length === 0 && this.active !== null) {
      held = this.patterns[this.active].filter((s) => s.on).map((s, i) => ({ midi: s.note + s.oct * 12, order: i }));
    }
    const pool = arpPool(held, mode === "played" ? "played" : mode, v.arpOct);
    if (pool.length === 0) return;
    for (const { index, offset } of gridEvents(step, period)) {
      const notes = arpPick(pool, mode === "played" ? "played" : mode, index, hashRandom(this.seed, index, 31));
      const dur = Math.max(0.025, period * stepDur * v.arpGate);
      this.playNote(notes[0], 0.85, time + offset * stepDur, dur, false, false);
    }
  }

  private playNote(note: number, velocity: number, when: number, duration: number | null, accent: boolean, slide: boolean): SynthVoice {
    const v = this.values;
    const t = Math.max(when, this.ctx.currentTime);
    // Only notes already sounding at `t` can be cut or glided from; a live key must not cancel a step still waiting to start.
    const prev = [...this.voices].reverse().find((v) => v.startTime <= t && v.sounding(t)) ?? null;
    const gliding = slide && prev !== null && prev.sounding(t) && this.lastFreq !== null;
    if (prev && !gliding && prev.sounding(t)) prev.kill(t);

    const freq = midiToFreq(note + (v.octave - 1) * 12 + v.tune);
    const decay = (v.decay / 1000) * (accent ? 0.72 : 1);
    const qDb = Math.min(30, v.resonance * 25 + (accent ? 2 : 0));
    const accentGain = accent ? 1 + v.accent * 0.8 : 1;
    const mode = Math.round(v.filterMode);
    const wave: WaveName = (["sawtooth", "square", "triangle"] as const)[Math.round(v.wave)];
    const spec: VoiceSpec = {
      freq,
      fromFreq: gliding ? this.lastFreq : null,
      glide: v.slideTime / 1000,
      lanes: [{ a: { wave, ratio: 1, cents: 0, level: 1, pw: 0.5 }, pan: 0 }],
      xmod: 0,
      ring: 0,
      sub: v.sub > 0.001 ? { wave: (["square", "sine", "triangle"] as const)[Math.round(v.subWave)], level: v.sub * 0.48, ratio: 0.5 } : null,
      noise: null,
      sample: null,
      filter: {
        type: (["lowpass", "bandpass", "highpass"] as const)[mode],
        cutoff: v.cutoff,
        q: qDb,
        poles: mode === 0 ? 2 : 1,
        offsetCents: accent ? 1200 * Math.log2(1.45) : 0,
        envCents: 1200 * Math.log2(1 + v.envMod * 3),
        hp: 0,
        drive: 0,
      },
      ampEnv: { a: Math.max(0.001, v.attack / 1000), d: 0.01, s: 1, r: Math.max(0.06, Math.min(0.18, decay * 0.45)) },
      filterEnv: { a: 0.001, d: Math.max(0.025, decay), s: 0, r: 0.05 },
      peak: (Math.min(1, velocity) * accentGain * 0.45) / (1 + qDb * 0.035),
      pan: 0,
      pitchEnvCents: 0,
      bendRange: 2,
      wheelCutCents: 0,
      routes: [],
    };
    const voice = new SynthVoice(this.ctx, this.fx.input, this.bus, spec, note, t, duration);
    voice.sequenced = duration !== null;
    this.lastFreq = freq;
    this.track(voice);
    return voice;
  }
}
